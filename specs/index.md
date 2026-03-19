# Spec: Claude Workflow Orchestration Library

## Overview

A Node.js library and CLI tool for defining and running workflows composed of scripted nodes and Claude Code nodes. Claude Code nodes always run inside throwaway Docker containers with restricted network access enforced by a Squid proxy. Designed to be self-hosted and published as an npm package.

---

## Package

- **Name**: claudeflow (published as @lipsumar/claudeflow)
- **Language**: TypeScript, compiled to CJS + ESM
- **Runtime**: Node.js 24
- **License**: Open source
- **Peer dependencies**: Docker Engine (local or remote), Docker Compose

---

## Core Concepts

### Workflow

A directed acyclic graph (DAG) of nodes, defined in TypeScript using a fluent builder API. A workflow has a name, a typed (loose) state object that flows through all nodes, and a set of edges including conditional branches.

### Scripted Node

A plain async TypeScript function. Has direct read/write access to the run workspace on the host filesystem and the current state object. No container is involved.

### Claude Code Node

A node that runs the `claude` CLI inside a throwaway Docker container. The container is created fresh for each invocation and destroyed immediately after. It mounts the shared run workspace and routes all outbound traffic through Squid. The node definition includes the prompt (which can be a function of current state), the Docker image to use, and the list of allowed outbound domains.

### Run Context

The object passed to every node at execution time. Contains:

- `runId` — unique identifier for this workflow execution
- `workspace` — absolute path to the shared host directory mounted into containers
- `state` — the loose JSON state object, updated in place after each node

### Run

A single execution of a workflow. Has a unique ID, a start time, a status (`pending | running | completed | failed`), a log of all node executions, and the final state.

---

## Architecture

```
User code (TypeScript)
└── defines workflows using the library API

Library (this package)
├── Workflow engine       — executes the DAG, manages state and control flow
├── Scripted node runner  — calls the user function directly
├── Claude node runner    — manages container lifecycle + streaming
├── Sandbox manager       — Docker network + container creation/teardown
├── Proxy manager         — writes Squid ACL files, signals reload
├── Run store             — persists run history and logs (SQLite)
└── Event emitter         — streams node output and run events

Infrastructure (user-managed, started via CLI)
├── Squid container       — long-lived egress proxy, shared across all runs
├── Auth-proxy container  — long-lived, injects real API key, never exposes it to sandboxes
└── Docker bridge network — isolated per run, torn down after run completes
```

### Workflow Engine Design

The workflow engine is a custom DAG executor (~100–200 lines). No external graph framework is used — the execution model (filesystem side-effects + shallow state merge) is simple enough to own directly.

#### Execution loop

```
resolve entry node
while current !== "__end__":
  emit node:start
  if scripted node:
    call fn(ctx), shallow-merge returned partial into state
  if claude node:
    create container, exec claude, stream node:chunk events
    destroy container
  emit node:end
  resolve next node (static edge or conditional edge fn)
emit run:complete
```

#### State management

- State is a plain JSON object, initialized by the caller via `initialState`.
- Only scripted nodes update state (return a partial object, shallow-merged).
- Claude nodes produce filesystem side-effects only — they do not modify state.
- The full state is serialized to the run store after each node completes.

#### Edge resolution

Each node has exactly one outgoing edge, which is either:

- **Static**: a fixed target node ID (`addEdge("a", "b")`)
- **Conditional**: a function `(ctx) => string` returning the next node ID or `"__end__"` (`addConditionalEdge("a", fn)`)

#### Error handling

- If a node throws or a container exits non-zero, the engine emits `node:error`, sets the run status to `failed`, and stops execution.
- Container cleanup (remove container, remove ACL entry) happens in a `finally` block — always runs even on error.

#### Interruption and resumption

See [interruption-and-resumption.md](./interruption-and-resumption.md) for the full spec.

---

## Network Isolation

A dedicated Docker bridge network is created per run. Containers on this network cannot reach the internet directly. All outbound HTTP/HTTPS is routed through a long-lived Squid container running on the same Docker host.

Squid is configured with a dynamic ACL file per container, keyed by the container's IP address on the run network. Before a Claude node container starts, the library writes its ACL entry (allowed domains or a deny-all rule) and sends `squid -k reconfigure`. After the container is destroyed, the ACL entry is removed and Squid is reconfigured again.

If `allowedDomains` is an empty array, all outbound traffic is blocked. `api.anthropic.com` is never added to the Squid allowlist — Claude Code traffic to the Anthropic API is handled exclusively through the auth-proxy (see below).

### Auth-proxy

The real `ANTHROPIC_API_KEY` is never passed to sandbox containers. Instead:

- A long-lived `claudeflow-auth-proxy` container runs alongside Squid on the host network
- Sandbox containers receive `ANTHROPIC_BASE_URL` pointing to the auth-proxy and `ANTHROPIC_API_KEY=dummy`
- The auth-proxy strips the incoming `Authorization` header from every request and replaces it with the real key before forwarding to `api.anthropic.com`
- The real `ANTHROPIC_API_KEY` is only ever present on the host and inside the auth-proxy container

The full traffic path for Anthropic API calls:

```
Claude (sandbox)
  ANTHROPIC_BASE_URL=http://claudeflow-auth-proxy:4128
  ANTHROPIC_API_KEY=dummy
    → auth-proxy
        strips dummy Authorization header
        injects real ANTHROPIC_API_KEY
          → api.anthropic.com
```

The auth-proxy is a minimal HTTP proxy (~50 lines). It only handles traffic to `api.anthropic.com` and has no other responsibilities. The real API key is injected into it at startup from the host environment and never written to disk.

---

## API

### Defining a workflow

```typescript
import { Workflow, claudeNode, scriptedNode } from "claudeflow";

const myWorkflow = new Workflow({ name: "write-and-test" })
  .addNode("fetch", scriptedNode(fetchSpec))
  .addNode(
    "write_code",
    claudeNode({
      image: "claudeflow-sandbox:latest",
      allowedDomains: ["api.github.com"],
      prompt: (ctx) =>
        `Write code that satisfies this spec: ${JSON.stringify(ctx.state.spec)}`,
    }),
  )
  .addNode("run_tests", scriptedNode(runTests))
  .addNode(
    "fix",
    claudeNode({
      image: "claudeflow-sandbox:latest",
      allowedDomains: [],
      prompt: (ctx) => `Fix the failing tests: ${ctx.state.testOutput}`,
    }),
  )
  .addEdge("fetch", "write_code")
  .addEdge("write_code", "run_tests")
  .addConditionalEdge("run_tests", (ctx) =>
    ctx.state.testsFailed ? "fix" : "__end__",
  );
```

### Scripted node signature

```typescript
type ScriptedNodeFn = (ctx: RunContext) => Promise<Partial<State>>;

// Example
const fetchSpec: ScriptedNodeFn = async (ctx) => {
  const spec = JSON.parse(
    await fs.readFile(ctx.workspace + "/spec.json", "utf8"),
  );
  return { spec };
};
```

The returned object is shallow-merged into `ctx.state`.

### Claude node definition

```typescript
interface ClaudeNodeDef {
  image: string; // Docker image containing the claude CLI
  prompt: string | ((ctx: RunContext) => string);
  allowedDomains?: string[]; // defaults to [] (deny all except Anthropic API)
  env?: Record<string, string>; // extra env vars injected into the container
  timeoutMs?: number; // defaults to 5 minutes
}
```

### Running a workflow

```typescript
const run = await myWorkflow.run({
  initialState: { spec: null, testsFailed: false },
  onChunk: (event) => console.log(event), // streaming output
});

console.log(run.status); // 'completed' | 'failed'
console.log(run.state); // final state
```

### Streaming events

Every node emits a stream of typed events during execution:

```typescript
type WorkflowEvent =
  | { type: "node:start"; nodeId: string; runId: string }
  | { type: "node:chunk"; nodeId: string; chunk: string } // Claude stdout
  | { type: "node:end"; nodeId: string; durationMs: number }
  | { type: "node:error"; nodeId: string; error: string }
  | { type: "run:complete"; runId: string; status: "completed" | "failed" };
```

---

## Data Flow Model

Claude nodes and scripted nodes have distinct, complementary roles:

```
Claude node    →  mutates files in /workspace       (filesystem side effects)
Scripted node  →  reads /workspace, updates state   (structured extraction)
```

Claude nodes do not return anything to the orchestrator. Their entire output is the files they create or modify in the workspace. State is only ever updated by scripted nodes, which read the workspace and explicitly return a partial state object.

A typical pattern is a Claude node followed by a scripted node that inspects what Claude produced:

```typescript
.addNode('write_code',     claudeNode({ ... }))
.addNode('check_outputs',  scriptedNode(async (ctx) => {
  const files = await glob(ctx.workspace + '/src/**/*.ts');
  return { generatedFiles: files };
}))
```

Claude's final stdout message (a natural language summary of what it did) is captured through the existing streaming output and available in the run logs. No special parsing or result file is needed.

---

## Observability

### Streaming output

All Claude node stdout is streamed in real time via the `onChunk` callback and the event emitter. Scripted nodes can emit log lines by calling `ctx.log(message)`.

### Run history

All runs are persisted to local files (default: `~/.claudeflow/runs`). Flat files persist:

- Run ID, workflow name, start/end time, status
- Full event log (node starts, chunks, errors)
- Initial and final state snapshots

The storage path is configurable.

### Querying runs programmatically

```typescript
import { RunStore } from "claudeflow";

const store = new RunStore();
const runs = store.list({ workflow: "write-and-test", limit: 10 });
const run = store.get(runId);
const logs = store.getLogs(runId);
```

---

## CLI

The CLI is available as `claudeflow` after installation.

```bash
# Start the Squid proxy container (required before running workflows)
claudeflow proxy start
claudeflow proxy stop
claudeflow proxy status

# Run a workflow defined in a file
claudeflow run ./my-workflow.ts

# List recent runs
claudeflow runs list
claudeflow runs list --workflow write-and-test --limit 20

# Inspect a specific run
claudeflow runs show <runId>
claudeflow runs logs <runId>

# Tail a live run's output
claudeflow runs tail <runId>
```

### `claudeflow run` file format

The target file default-exports a workflow instance:

```typescript
// my-workflow.ts
import { Workflow, claudeNode, scriptedNode } from 'claudeflow';
export default new Workflow({ name: 'my-workflow' })
  .addNode(...)
  ...
```

---

## Sandbox Docker Image

The library ships a base Dockerfile (`claudeflow-sandbox`) that includes:

- Node.js 20
- The `claude` CLI (`@anthropic-ai/claude-code`)
- Common dev tools (git, curl, python3, pip)
- A non-root user (`agent`) that owns `/workspace`

Users extend it for their use case:

```dockerfile
FROM claudeflow-sandbox:latest
RUN pip install pytest requests
```

At runtime, sandbox containers receive:

- `ANTHROPIC_BASE_URL` pointing to the auth-proxy — never the real Anthropic API directly
- `ANTHROPIC_API_KEY=dummy` — a placeholder that satisfies the Claude CLI's key presence check
- The real API key is injected by the auth-proxy and never visible inside the sandbox

---

## Infrastructure Lifecycle

### Proxy (Squid + auth-proxy)

Both are started together via `claudeflow proxy start`. They run as named Docker containers (`claudeflow-squid` and `claudeflow-auth-proxy`) and persist across workflow runs.

- **Squid** exposes port 3128 on the Docker host's internal bridge IP. The ACL directory is mounted from the host so the library can write per-container rules without exec-ing into the container. `api.anthropic.com` is not in any Squid allowlist — that traffic goes directly to the auth-proxy.
- **Auth-proxy** exposes port 4128. It receives the real `ANTHROPIC_API_KEY` as an environment variable at startup (from the host environment) and never writes it to disk. It only forwards traffic to `api.anthropic.com`.

### Run network

A Docker bridge network (`claudeflow-{runId}`) is created at run start and destroyed at run end (success or failure). All Claude node containers for that run are attached to this network.

### Container lifecycle (per Claude node invocation)

1. Write Squid ACL for this node, signal reconfigure
2. Create and start container (attached to run network, workspace mounted)
3. Exec `claude --print "<prompt>"` inside container, stream stdout as `node:chunk` events
4. Wait for exit — non-zero exit code emits `node:error`
5. Remove container (always, even on error)
6. Remove Squid ACL entry, signal reconfigure

---

## Configuration

A `claudeflow.config.ts` file at the project root (optional):

```typescript
import { defineConfig } from "claudeflow";

export default defineConfig({
  squid: {
    containerName: "claudeflow-squid", // default
    port: 3128, // default
  },
  sandbox: {
    defaultImage: "claudeflow-sandbox:latest",
    defaultTimeoutMs: 300_000, // 5 minutes
    workspaceRoot: "/tmp/claudeflow/runs", // where run workspaces are created
  },
  store: {
    path: "~/.claudeflow/runs.db",
  },
});
```
