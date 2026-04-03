# Implementation Plan: Batch Execution

This document is a step-by-step implementation plan for the batch execution feature specified in [batch.md](./batch.md). Each step is independently testable. Follow them in order.

---

## Context

### How `claudeflow run` works today

The CLI command (`src/cli/commands/run.ts`) does everything:

1. Loads the workflow from file via `loadWorkflow(args.file)` → returns a `WorkflowFromFile`
2. Creates an `Executor` (host or docker) with a workspace directory
3. Resolves inputs interactively via `resolveInputs()` (prompts the user for missing inputs, coerces types, validates with `workflow.inputs.parse()`)
4. Calls `runWorkflow(workflow, { executor, onEvent, initialState })` from `src/workflow/engine.ts`
5. `runWorkflow()` generates a `runId` (UUID), enters the execution loop, persists run state to the `RunStore`, and returns `{ runId, status, state }`

### Store architecture

- `RunStore` (`src/store/run-store.ts`) is a singleton. Its `basePath` comes from `getConfig().store.path`, which currently defaults to `~/.claudeflow/runs`.
- Each run is stored at `<basePath>/<runId>/run.json` with events at `<basePath>/<runId>/events.jsonl`.
- The store is accessed via `getStore()` which lazily creates the singleton.

### Renderer

- `createRenderer()` in `src/cli/renderer.ts` returns a `(event: WorkflowEvent) => void` callback.
- It manages a spinner (via `ora`) and formats node/run events to the terminal.

### Config

- `store.path` in `ResolvedConfig` is the only store-related config. Default: `~/.claudeflow/runs`.
- Config is initialized once via `initConfig()` in the CLI entrypoint's `setup()` hook.

---

## Step 1: Change `store.path` to be the root store directory

Currently `store.path` defaults to `~/.claudeflow/runs` and `RunStore` uses it directly. We need both `runs/` and `batches/` under a single root.

### Files to modify

**`src/config.ts`**
- Change `defaultConfig.store.path` from `"~/.claudeflow/runs"` to `"~/.claudeflow"`

**`src/store/run-store.ts`**
- In the `RunStore` constructor, append `/runs` to the received `basePath`:
  ```typescript
  constructor(basePath: string) {
    this.basePath = join(expandTilde(basePath), "runs");
  }
  ```
- The rest of `RunStore` is unchanged — it still reads/writes `<basePath>/<runId>/run.json`.

**Tests** — verify existing run store tests still pass after the path change. The `getStore()` singleton uses `getConfig().store.path`, so any test that sets `store.path` to a temp dir will now need that temp dir to expect a `/runs` subdirectory.

---

## Step 2: Create batch types (`src/batch/types.ts`)

New file. Define all batch-related data structures:

```typescript
export interface BatchTarget {
  name: string;
  inputs: Record<string, unknown>;
  runId: string | null;
}

export interface BatchRecord {
  batchId: string;
  workflowFile: string;
  startTime: string; // ISO 8601
  targets: BatchTarget[];
}

export interface BatchSummary {
  total: number;
  completed: number;
  failed: number;
  interrupted: number;
  pending: number;
}

export type BatchEvent =
  | { type: "batch:start"; batchId: string; targetCount: number }
  | { type: "batch:target:start"; batchId: string; targetName: string; runId: string }
  | { type: "batch:target:end"; batchId: string; targetName: string; runId: string; status: string }
  | { type: "batch:complete"; batchId: string; summary: BatchSummary };
```

---

## Step 3: Create batch store (`src/batch/batch-store.ts`)

Follow the same patterns as `RunStore` in `src/store/run-store.ts`: singleton via `getBatchStore()`, flat-file storage, `expandTilde` for path resolution.

### Storage layout

```
<store.path>/batches/<batchId>/batch.json
<store.path>/batches/<batchId>/events.jsonl
```

### Singleton

```typescript
let instance: BatchStore | null = null;

export function getBatchStore(): BatchStore {
  if (!instance) {
    instance = new BatchStore(getConfig().store.path);
  }
  return instance;
}

export function resetBatchStore(): void {
  instance = null;
}
```

### Class

```typescript
export class BatchStore {
  readonly basePath: string;

  constructor(basePath: string) {
    // Append "batches" — basePath is the root store dir (e.g. ~/.claudeflow)
    this.basePath = join(expandTilde(basePath), "batches");
  }
}
```

### Methods

- **`persistBatch(record: BatchRecord): void`** — Write `batch.json` to `<basePath>/<batchId>/batch.json`. Creates the directory if needed.
- **`get(batchId: string): BatchRecord | null`** — Read and parse `batch.json`. Return `null` if not found.
- **`list(): BatchRecord[]`** — Read all batch directories, parse each `batch.json`, sort by `startTime` descending.
- **`updateTargetRunId(batchId: string, targetName: string, runId: string): void`** — Read the batch record, find the target by name, set its `runId`, and re-persist. (Using `targetName` rather than index is safer since it's the unique identifier per the spec.)
- **`appendEvent(batchId: string, event: BatchEvent): void`** — Append a JSON line to `<basePath>/<batchId>/events.jsonl`.
- **`getEvents(batchId: string): BatchEvent[]`** — Read and parse `events.jsonl`. Return `[]` if not found.

### Tests (`src/batch/batch-store.spec.ts`)

Test persist, get, list, updateTargetRunId, appendEvent, getEvents using a temp directory.

---

## Step 4: Extract `initWorkflowRun()` (`src/workflow/init.ts`)

Extract the executor creation and input validation logic out of the CLI `run` command into a shared function. This function returns everything needed to call `runWorkflow()` except `onEvent` (which is CLI-specific).

### New file: `src/workflow/init.ts`

```typescript
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { HostExecutor } from "../executor/host.js";
import { DockerExecutor } from "../executor/docker.js";
import type { Executor } from "../executor/types.js";
import type { WorkflowFromFile, State } from "./types.js";

export interface InitWorkflowRunOptions {
  workflow: WorkflowFromFile;
  inputs: Record<string, unknown>;
  workspace?: string;
}

export interface InitWorkflowRunResult {
  executor: Executor;
  initialState: State;
}

export function initWorkflowRun(options: InitWorkflowRunOptions): InitWorkflowRunResult {
  const { workflow, inputs } = options;
  const workspace = options.workspace ?? join(tmpdir(), `claudeflow-${randomUUID()}`);

  let executor: Executor;
  if (workflow.executor === "host") {
    executor = new HostExecutor({ workspace });
  } else if (workflow.executor === "docker") {
    if (!workflow.dockerImage) {
      throw new Error("Docker image is required for docker executor");
    }
    executor = new DockerExecutor({ workspace, image: workflow.dockerImage });
  } else {
    throw new Error(`Unsupported executor: ${workflow.executor}`);
  }

  // Validate inputs against workflow schema
  const initialState = workflow.inputs ? workflow.inputs.parse(inputs) : { ...inputs };

  return { executor, initialState };
}
```

### Refactor `src/cli/commands/run.ts`

Replace lines 37–63 with:

```typescript
const onEvent = args.output === "json"
  ? (event) => console.log(JSON.stringify(event))
  : createRenderer();

const inputs = await resolveInputs(workflow); // still handles prompting
const { executor, initialState } = initWorkflowRun({ workflow, inputs, workspace: args.workspace });

const result = await runWorkflow(workflow, { executor, onEvent, initialState });
```

The `resolveInputs()` function stays in `run.ts` — it's CLI-specific (prompts the user). The batch runner will skip it entirely since inputs come from the targets file.

### Tests

Verify `claudeflow run` still works end-to-end after the refactor (existing integration tests should cover this).

---

## Step 5: Create batch runner (`src/batch/runner.ts`)

The core batch execution logic. Orchestrates the sequential loop over targets.

### Function signature

```typescript
import type { WorkflowEvent } from "../workflow/types.js";
import type { BatchEvent, BatchRecord, BatchSummary } from "./types.js";

export interface RunBatchOptions {
  workflowFile: string;
  targets: Array<{ name: string; inputs: Record<string, unknown> }>;
  onBatchEvent?: (event: BatchEvent) => void;
  onWorkflowEvent?: (event: WorkflowEvent) => void;
}

export interface RunBatchResult {
  batchId: string;
  summary: BatchSummary;
}

export async function runBatch(options: RunBatchOptions): Promise<RunBatchResult>
```

### Algorithm

1. Load the workflow once via `loadWorkflow(options.workflowFile)`.
2. **Validate all targets up-front**: for each target, call `workflow.inputs.parse(target.inputs)`. If any fail, throw before starting any runs.
3. Generate batch ID: `b-${randomUUID()}`.
4. Create initial `BatchRecord` with all targets having `runId: null`. Persist it via `BatchStore`.
5. Emit `batch:start` event (and persist it).
6. For each target:
   - If `target.runId` is not null, skip (for future resume support).
   - Emit `batch:target:start` (with a placeholder runId — see note below).
   - Call `initWorkflowRun({ workflow, inputs: target.inputs })` to get `{ executor, initialState }`.
   - Call `runWorkflow(workflow, { executor, onEvent: options.onWorkflowEvent, initialState })`.
   - The `runId` comes back from `runWorkflow()`'s result. Update the batch record: set `target.runId = result.runId`, persist.
   - Emit `batch:target:end` with `result.status`.
7. Compute `BatchSummary` by counting statuses. `interrupted` counts as non-failed but the exit code logic treats only `completed` and `interrupted` as success.
8. Emit `batch:complete` with summary.
9. Return `{ batchId, summary }`.

**Note on `batch:target:start` event**: The spec shows `runId` in the `batch:target:start` event, but `runWorkflow()` generates the `runId` internally. Two options: (a) emit `batch:target:start` after `runWorkflow` returns (but then it's not really "start"), or (b) generate the `runId` before calling `runWorkflow` and pass it in. Since `runWorkflow` currently generates its own `runId` (line 35 of `engine.ts`), the simplest approach is to emit `batch:target:start` before the run with `runId: ""` or to adjust `runWorkflow` to accept an optional `runId`. Recommend adding an optional `runId` to `RunOptions` so the batch runner can pre-generate it. This is a small change to `engine.ts` line 35: `runId: options.runId ?? randomUUID()`.

### Tests (`src/batch/runner.spec.ts`)

Mock `runWorkflow` (or use a trivial workflow with scripted nodes) to test:
- Sequential execution order
- Batch record is updated after each target
- Failed/interrupted targets don't stop the batch
- Up-front validation rejects bad inputs before any runs start
- Events are emitted in the correct order

---

## Step 6: Extend the renderer (`src/cli/renderer.ts`)

Widen `createRenderer()` to handle both `WorkflowEvent` and `BatchEvent`.

### Changes

1. Change the return type from `(event: WorkflowEvent) => void` to `(event: WorkflowEvent | BatchEvent) => void`.

2. Add cases to the switch statement for batch events:

```typescript
case "batch:start":
  console.log(`\nBatch ${event.batchId} started (${event.targetCount} targets)\n`);
  break;

case "batch:target:start":
  console.log(`── ${event.targetName} ${"─".repeat(Math.max(0, 40 - event.targetName.length))}`);
  break;

case "batch:target:end": {
  const icon = event.status === "completed" ? "✓"
    : event.status === "interrupted" ? "⧖"
    : "✗";
  const color = event.status === "completed" ? chalk.green
    : event.status === "interrupted" ? chalk.yellow
    : chalk.red;
  console.log(color(`${icon} ${event.targetName} ${event.status}`));
  console.log();
  break;
}

case "batch:complete":
  console.log(`Batch ${event.batchId} finished: ${event.summary.completed} completed, ${event.summary.interrupted} interrupted, ${event.summary.failed} failed`);
  break;
```

3. The existing `WorkflowEvent` cases remain unchanged. Between `batch:target:start` and `batch:target:end`, the workflow events for that target's run flow through the same renderer — the existing node/run rendering works as-is.

4. The `run:complete` and `run:interrupted` events from individual workflow runs will still render. Consider whether the per-run completion line is redundant when followed by the `batch:target:end` line. If so, the batch CLI command could filter out `run:complete`/`run:interrupted` events before passing to the renderer, or the renderer could suppress them when in batch mode. This is a polish decision — start simple (let both render) and adjust if the output feels noisy.

### Type update

The `WorkflowEvent` type is defined in `src/workflow/types.ts`. Do NOT add `BatchEvent` to the `WorkflowEvent` union — they are separate concerns (the spec is explicit: "the workflow engine is unaware of batches"). Instead, create a union type for the renderer:

```typescript
// in renderer.ts
import type { BatchEvent } from "../batch/types.js";

type RenderableEvent = WorkflowEvent | BatchEvent;

export function createRenderer(): (event: RenderableEvent) => void {
```

---

## Step 7: Create batch CLI command (`src/cli/commands/batch.ts`)

Follow the pattern of `src/cli/commands/runs.ts` (subcommands via citty's `subCommands`).

### Structure

```typescript
import { defineCommand } from "citty";

const run = defineCommand({ /* ... */ });
const status = defineCommand({ /* ... */ });
const list = defineCommand({ /* ... */ });

export default defineCommand({
  meta: { name: "batch", description: "Run workflows in batch" },
  subCommands: { run, status, list },
});
```

### `batch run` subcommand

```typescript
const run = defineCommand({
  meta: { name: "run", description: "Run a batch of workflow targets" },
  args: {
    file: { type: "positional", description: "Path to the workflow file", required: true },
    targets: { type: "string", description: "Path to the targets JSON file", required: true },
    output: { type: "string", description: "Output format: pretty (default) or json" },
  },
  async run({ args }) {
    // 1. Read and parse targets file: JSON.parse(readFileSync(args.targets, "utf8"))
    // 2. Validate it's an array of { name: string, inputs: object }
    // 3. Create the renderer (pretty or json)
    //    - For pretty: createRenderer() (handles both batch and workflow events)
    //    - For json: (event) => console.log(JSON.stringify(event))
    // 4. Call runBatch({
    //      workflowFile: args.file,
    //      targets: parsed,
    //      onBatchEvent: renderer,
    //      onWorkflowEvent: renderer,
    //    })
    // 5. Exit code: 0 if all targets are completed or interrupted, 1 if any failed
    //    - Check summary.failed > 0 → process.exit(1)
  },
});
```

### `batch status` subcommand

```typescript
const status = defineCommand({
  meta: { name: "status", description: "Show the status of a batch" },
  args: {
    batchId: { type: "positional", description: "Batch ID", required: true },
  },
  run({ args }) {
    // 1. Load batch record from getBatchStore().get(args.batchId)
    // 2. For each target with a runId, look up status from getStore().get(target.runId)
    // 3. Print formatted output matching the spec:
    //    Batch b-abc123 — workflow-name
    //    Started: 2026-04-03 10:00:00
    //
    //      repo-a  completed    2m14s
    //      repo-b  interrupted  node: write_code
    //      repo-c  failed       node: run_tests
    //
    //    Summary: 1 completed, 1 interrupted, 1 failed
    //
    // Note: duration comes from StoredRun's startTime/endTime.
    //       "node: write_code" for interrupted/failed comes from StoredRun's currentNode.
  },
});
```

### `batch list` subcommand

```typescript
const list = defineCommand({
  meta: { name: "list", description: "List recent batches" },
  run() {
    // 1. Load all batch records from getBatchStore().list()
    // 2. For each batch, compute summary by joining with run store
    // 3. Print formatted table matching the spec:
    //    BATCH ID    WORKFLOW           TARGETS  COMPLETED  FAILED  INTERRUPTED  PENDING
    //    b-abc123    migrate-eslint.ts  3        1          1       1            0
  },
});
```

---

## Step 8: Register batch command (`src/cli/index.ts`)

Add to the `subCommands` object:

```typescript
subCommands: {
  config: () => import("./commands/config.js").then((m) => m.default),
  run: () => import("./commands/run.js").then((m) => m.default),
  runs: () => import("./commands/runs.js").then((m) => m.default),
  resume: () => import("./commands/resume.js").then((m) => m.default),
  batch: () => import("./commands/batch.js").then((m) => m.default),
},
```

---

## Step 9: Export from public API (`src/index.ts`)

Add exports:

```typescript
export { runBatch } from "./batch/runner.js";
export type { BatchRecord, BatchTarget, BatchSummary, BatchEvent } from "./batch/types.js";
export { BatchStore, getBatchStore } from "./batch/batch-store.js";
export { initWorkflowRun } from "./workflow/init.js";
export type { InitWorkflowRunOptions, InitWorkflowRunResult } from "./workflow/init.js";
```

---

## Step 10: Tests

### Unit tests

- **`src/batch/batch-store.spec.ts`** — CRUD operations on batch records and events using a temp directory
- **`src/batch/runner.spec.ts`** — Sequential execution, event emission order, batch record updates, fail-fast validation, handling of failed/interrupted targets

### Integration tests

- **`tests/batch-cli.spec.ts`** — Using the `runCli()` helper from `tests/helpers.ts`:
  - `claudeflow batch run <workflow> --targets <file>` with a simple scripted workflow
  - `claudeflow batch status <batchId>` after a batch run
  - `claudeflow batch list` showing the batch
  - Verify exit code is 1 when a target fails
  - Verify exit code is 0 when all targets complete (including interrupted ones)

---

## Minor changes to existing code

### `src/workflow/engine.ts`

Add optional `runId` to `RunOptions` so the batch runner can pre-generate it (needed for the `batch:target:start` event):

```typescript
// In RunOptions (src/workflow/types.ts):
export interface RunOptions {
  initialState?: State;
  executor: Executor;
  onEvent?: (event: WorkflowEvent) => void;
  runId?: string; // NEW — if provided, use this instead of generating one
}

// In runWorkflow (src/workflow/engine.ts), line 35:
runId: options.runId ?? randomUUID(),
```

---

## Summary of new files

| File | Purpose |
|------|---------|
| `src/batch/types.ts` | `BatchTarget`, `BatchRecord`, `BatchSummary`, `BatchEvent` |
| `src/batch/batch-store.ts` | Flat-file persistence for batch records and events |
| `src/batch/runner.ts` | Core batch execution loop |
| `src/workflow/init.ts` | Shared `initWorkflowRun()` — executor + input validation |
| `src/cli/commands/batch.ts` | CLI commands: `batch run`, `batch status`, `batch list` |
| `src/batch/batch-store.spec.ts` | Unit tests for batch store |
| `src/batch/runner.spec.ts` | Unit tests for batch runner |
| `tests/batch-cli.spec.ts` | Integration tests for batch CLI |

## Summary of modified files

| File | Change |
|------|--------|
| `src/config.ts` | `store.path` default: `~/.claudeflow/runs` → `~/.claudeflow` |
| `src/store/run-store.ts` | Constructor appends `/runs` to basePath |
| `src/workflow/engine.ts` | Use `options.runId ?? randomUUID()` |
| `src/workflow/types.ts` | Add optional `runId` to `RunOptions` |
| `src/cli/commands/run.ts` | Refactor to use `initWorkflowRun()` |
| `src/cli/renderer.ts` | Widen to accept `BatchEvent`, add batch event rendering |
| `src/cli/index.ts` | Register `batch` subcommand |
| `src/index.ts` | Export batch types, store, runner, and `initWorkflowRun` |
