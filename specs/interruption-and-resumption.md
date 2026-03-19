# Spec: Interruption and Resumption

## Overview

Workflows can be interrupted mid-execution and resumed later. Interruption can happen at the engine level (between nodes) or inside a Claude node (mid-conversation). In all cases the engine receives a uniform signal and persists enough state to resume.

---

## Use Cases

### 1. Process killed during a long-running scripted node

A scripted node (e.g., CI polling) is running when the `claudeflow` process is stopped. On restart, the workflow resumes from the interrupted node.

### 2. Claude Code wants to ask the user a question (emergent HITL)

Claude decides it needs human input and calls `AskUserQuestion`. Since Claude runs in non-interactive `--print` mode, there is no human on the other end. The tool call is intercepted, the run is interrupted, and the question is surfaced to the operator. When the human answers, the session is resumed.

### 3. Predefined HITL step

The workflow author defines a node that requires human input before the workflow can continue. The workflow finishes with status `"interrupted"` and is resumed when the human provides an answer.

### 4. Claude Code crashes mid-work

The Claude CLI exits non-zero (API 500, network error, OOM, etc.) in the middle of a multi-turn conversation. The session is persisted by the CLI and can be resumed from where it left off.

---

## Design Principles

1. **The engine is node-type-agnostic.** It does not parse Claude messages or know about `AskUserQuestion`. It only receives a uniform result from each node: success, failure, or interruption.
2. **Nodes own their interruption semantics.** A Claude node detects its own interruption conditions (blocked tool call, non-zero exit) and reports them uniformly. A scripted HITL node does the same.
3. **Resume is re-entry.** Resuming a workflow means re-entering the engine loop at the interrupted node with restored state. The node itself decides how to handle being re-executed (e.g., a Claude node resumes the CLI session; a scripted node re-runs from scratch).
4. **Sessions are the resume mechanism for Claude nodes.** The Claude CLI persists session state in `--print` mode by default. Resuming a Claude node means calling `claude --resume <sessionId>` with a prompt.

---

## Run Status

The `StoredRun.status` field gains a new value:

```
"running" | "completed" | "failed" | "interrupted"
```

- `"interrupted"` means the run stopped cleanly and can be resumed.
- `"failed"` means the run stopped due to a non-resumable error.

The distinction between `"failed"` and `"interrupted"` is made by the node that caused the stop. Resumable errors (API 500, blocked HITL tool call) produce `"interrupted"`. Non-resumable errors (invalid config, missing workspace) produce `"failed"`.

---

## Engine Changes

### Checkpoint before each node

Before executing a node, the engine persists `currentNode` to the run store. This is the node **about to be executed**. On resume, that node is always re-executed. One rule, no ambiguity.

```typescript
// in run.json
{
  "currentNode": "check-ci",     // node about to execute (or being re-executed)
  "state": { ... },              // state snapshot at time of checkpoint
  "sessionId": "...",            // if interrupted inside a Claude node
}
```

### Node result type

Nodes currently return `void` (Claude) or `Partial<State>` (scripted). This changes to a uniform result:

```typescript
interface NodeResult {
  /** State updates to shallow-merge (scripted nodes only). */
  state?: Partial<State>;

  /** If true, the engine stops the loop with status "interrupted". */
  interrupted?: boolean;

  /**
   * Metadata about the interruption.
   * Opaque to the engine — stored in run.json for the resume path.
   */
  interruptMetadata?: {
    reason: "hitl" | "error" | "process-killed";
    /** The question Claude wanted to ask (emergent HITL). */
    question?: string;
    /** Claude CLI session ID, needed for --resume. */
    sessionId?: string;
    /** Error message if reason is "error". */
    error?: string;
  };
}
```

### Engine loop with interruption

```
resolve start node (entry node, or interrupted node on resume)
while current !== "__end__":
  persist { currentNode: current, state }
  execute node → NodeResult
  if result.interrupted:
    persist { status: "interrupted", interruptMetadata }
    emit run:interrupted
    return
  shallow-merge result.state into state
  resolve next node
emit run:complete
```

On resume, the engine re-executes the node stored in `currentNode`. Since the checkpoint is written before execution, this is always the node that was interrupted (or never started).

### `resumeWorkflow(runId, opts?)`

```typescript
interface ResumeOptions {
  /** Human's answer for HITL interruptions. */
  input?: string;
  onEvent?: (event: WorkflowEvent) => void;
  store?: RunStore;
}

function resumeWorkflow(runId: string, opts?: ResumeOptions): Promise<RunResult>;
```

1. Load `run.json` — assert status is `"interrupted"`.
2. Restore `state` and `currentNode` from the stored checkpoint.
3. Re-enter the engine loop at `currentNode`, passing `opts.input` and stored `interruptMetadata` to the node via the run context.
4. The node decides what to do:
   - **Claude node with `sessionId`**: calls `claude --resume <sessionId> -p <input or "please continue">`.
   - **HITL scripted node**: reads `input` from context, returns it in state.
   - **Scripted node (process-killed)**: re-executes from scratch (idempotent by design).

---

## Claude Node Interruption

The Claude executor is responsible for detecting interruption conditions and returning a `NodeResult` with `interrupted: true`. The engine never inspects Claude's message stream.

### Session ID capture

The executor already parses `stream-json` output. The `init` message contains `session_id`. The executor captures this and includes it in the `NodeResult` metadata when interruption occurs.

### Condition: `AskUserQuestion` blocked by hook

A `PreToolUse` hook (matcher: `AskUserQuestion`) is configured to block the tool call:

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'This question will be answered by the workflow operator. Please stop and wait.' >&2; exit 2"
          }
        ]
      }
    ]
  }
}
```

The hook script:
1. Prints to stderr: `"This question will be answered by the workflow operator. Please stop and wait."`
2. Exits with code 2 (block).

Claude receives the block feedback, stops (`end_turn`), and the process exits 0.

The executor already sees the `AskUserQuestion` tool_use in the `stream-json` output (including the question). It detects that the tool was blocked and returns `{ interrupted: true, interruptMetadata: { reason: "hitl", question, sessionId } }`.

### Condition: Claude CLI exits non-zero (API error, crash)

The executor catches the non-zero exit:
1. If a `sessionId` was captured from the stream before the crash → the error is resumable.
2. Returns `{ interrupted: true, interruptMetadata: { reason: "error", sessionId, error: message } }`.
3. If no `sessionId` was captured (crash before init) → this is a non-resumable failure. The executor throws normally, and the engine sets status to `"failed"`.

### Resuming a Claude node

When the engine re-executes a Claude node during `resumeWorkflow`:

1. Check if `interruptMetadata.sessionId` exists in the run context.
2. Build the resume prompt:
   - HITL: the human's answer from `opts.input` (e.g., `"The user answered: approve"`)
   - Error: `"Please continue where you left off."`
3. Spawn: `claude --resume <sessionId> -p "<prompt>" --output-format stream-json --verbose`
4. Proceed as normal (stream parsing, event emission).

---

## HITL Scripted Node

A new node type for workflow-level human-in-the-loop steps:

```typescript
function hitlNode(def: {
  question: string | ((ctx: RunContext) => string);
}): HitlNodeDef;
```

### Behavior

**First execution** (no `input` in context):
1. Resolve the question string.
2. Return `{ interrupted: true, interruptMetadata: { reason: "hitl", question } }`.

**Re-execution on resume** (`input` available in context):
1. Return `{ state: { [nodeId + "Response"]: input } }`.

### Usage

```typescript
const workflow = new Workflow({ name: "review-loop" })
  .addNode("generate-pr", claudeNode({ ... }))
  .addNode("human-review", hitlNode({
    question: "Does the PR look good?",
  }))
  .addNode("apply-feedback", claudeNode({
    prompt: (ctx) => `Apply this feedback: ${ctx.state["human-reviewResponse"]}`,
  }))
  .addEdge("generate-pr", "human-review")
  .addEdge("human-review", "apply-feedback");
```

---

## CLI

### `claudeflow resume <runId>`

```bash
# Resume after HITL interruption
claudeflow resume <runId> --input "approve"

# Resume after error
claudeflow resume <runId>
```

If `--input` is not provided and the interruption reason is `"hitl"`, the CLI prints the stored question and prompts the operator interactively.

### `claudeflow runs show <runId>`

When status is `"interrupted"`, additionally displays:
- The interrupt reason
- The current node
- The question (if HITL)
- The error (if error)

---

## Hook Configuration

Hook settings are kept **outside** the workspace to avoid Claude modifying or committing them.

- **Host executor**: points to a static settings file bundled with the claudeflow npm package via `claude --settings <path>`.
- **Docker executor**: writes a settings file outside the workspace (e.g., `/etc/claudeflow/settings.json`) and passes `--settings` to the CLI.

This keeps the hook setup internal to claudeflow — workflow authors don't need to configure hooks manually.

### Generated settings

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": "AskUserQuestion",
        "hooks": [
          {
            "type": "command",
            "command": "echo 'This question will be answered by the workflow operator. Please stop and wait.' >&2; exit 2"
          }
        ]
      }
    ]
  }
}
```

The question extraction happens in the executor via the `stream-json` output, not in the hook.

---

## Event Types

Two new workflow events:

```typescript
type WorkflowEvent =
  | { type: "node:start"; nodeId: string; runId: string }
  | { type: "node:chunk"; nodeId: string; chunk: NodeChunk }
  | { type: "node:end"; nodeId: string; durationMs: number }
  | { type: "node:error"; nodeId: string; error: string }
  | { type: "node:interrupted"; nodeId: string; reason: string; question?: string }
  | { type: "run:complete"; runId: string; status: "completed" | "failed" }
  | { type: "run:interrupted"; runId: string; nodeId: string; reason: string };
```

---

## Limitations and Future Work

- **Scripted nodes are not resumable.** If a scripted node is interrupted (process killed), it re-executes from scratch. Workflow authors should design scripted nodes to be idempotent.
- **Multiple HITL questions in a single Claude turn.** If Claude calls `AskUserQuestion` multiple times before stopping, only the last question is captured. This is unlikely in practice since the hook blocks the first call and Claude stops.
- **Session expiry.** Claude CLI sessions may expire after some time. If a resume is attempted on an expired session, the executor should detect the failure and report it as non-resumable.
- **Concurrent runs.** Hook configuration is per-workspace. Concurrent runs in different workspaces are fine; concurrent Claude nodes in the same workspace would conflict. This is already prevented by the sequential engine loop.
