# Spec: Batch Execution

## Overview

A batch applies a single workflow to multiple targets sequentially. Each target provides its own inputs. The batch tracks which targets have been processed and their outcome, enabling reporting and future resumability.

---

## Concepts

### Target

A named set of workflow inputs. The inputs must conform to the workflow's `inputs` schema. The `name` field is required and used for display in status output.

### Batch

A group of workflow runs derived from a list of targets. A batch has a unique ID (prefixed with `b-` followed by a UUID, e.g. `b-a1b2c3d4-...`), references a workflow file, and maintains a list of targets with pointers to their corresponding run IDs (once started).

### Batch record

A JSON file persisted in `~/.claudeflow/batches/<batchId>/batch.json`. It maps targets to run IDs. Run status is never duplicated in the batch record — it is always read from the run store at query time.

---

## Targets File

A JSON file containing an array of objects. Each object has a `name` (display label for the batch) and an `inputs` object validated against the workflow's `inputs` schema.

```json
[
  { "name": "repo-a", "inputs": { "repoUrl": "git@github.com:org/repo-a.git" } },
  { "name": "repo-b", "inputs": { "repoUrl": "git@github.com:org/repo-b.git" } },
  { "name": "repo-c", "inputs": { "repoUrl": "git@github.com:org/repo-c.git" } }
]
```

This shape is intentionally strict so that target-level metadata (like `name`) is separate from workflow inputs, and the format is easily extendable with new top-level fields in the future.

---

## Batch Record Format

```json
{
  "batchId": "b-abc123",
  "workflowFile": "./migrate-eslint.ts",
  "startTime": "2026-04-03T10:00:00.000Z",
  "targets": [
    { "name": "repo-a", "inputs": { "repoUrl": "..." }, "runId": "run-1" },
    { "name": "repo-b", "inputs": { "repoUrl": "..." }, "runId": "run-2" },
    { "name": "repo-c", "inputs": { "repoUrl": "..." }, "runId": null }
  ]
}
```

- `runId: null` — target is pending (not yet started).
- `runId` set — look up the run store for current status (`completed`, `failed`, `interrupted`, `running`).

The batch record is updated after each run starts (to write the `runId`) and is the only file the batch system owns. All run state lives in the run store.

---

## Execution Model

Sequential. The batch runner iterates through targets one by one:

```
for each target in targets:
  if target.runId is not null:
    skip (already processed)
  run workflow with target inputs
  write runId to batch record
```

Workspace creation, executor setup, and input validation are owned by the run logic — the batch runner reuses the same codepath as `claudeflow run`. This may mean calling the run CLI internally or extracting a shared function; the batch spec does not prescribe the mechanism.

### Interrupted runs

If a workflow run ends with status `interrupted` (e.g. Claude called `AskUserQuestion`), the batch runner records the `runId` and moves on to the next target. The interrupted run can later be resumed individually via `claudeflow resume <runId>`. The batch status will reflect the updated run status automatically since it reads from the run store.

### Failed runs

Same as interrupted: record the `runId`, move on. The batch does not retry.

### Batch process killed

If the `claudeflow batch` process is killed mid-way, the batch record reflects exactly where it stopped — targets with `runId` set have been started, those with `null` have not. A future `claudeflow batch resume <batchId>` could pick up from the first pending target (not in scope for initial implementation).

---

## CLI

### `claudeflow batch <file> --targets <targets.json>`

Run a batch.

- `<file>` — path to the workflow file (same as `claudeflow run`)
- `--targets` — path to the targets JSON file

Outputs a batch ID at the start, then streams workflow output for each target with a header indicating which target is running:

```
Batch b-abc123 started (3 targets)

── repo-a ─────────────────────────────
[normal workflow output]
✓ repo-a completed (2m14s)

── repo-b ─────────────────────────────
[normal workflow output]
⧖ repo-b interrupted at node: write_code
  Question: "Should I use tabs or spaces?"

── repo-c ─────────────────────────────
[normal workflow output]
✗ repo-c failed at node: run_tests

Batch b-abc123 finished: 1 completed, 1 interrupted, 1 failed
```

### `claudeflow batch status <batchId>`

Show the current status of a batch. Reads the batch record and joins with the run store.

```
Batch b-abc123 — migrate-eslint.ts
Started: 2026-04-03 10:00:00

  repo-a  completed    2m14s
  repo-b  interrupted  node: write_code
  repo-c  failed       node: run_tests

Summary: 1 completed, 1 interrupted, 1 failed
```

If any interrupted runs have since been resumed and completed, the status reflects that.

### `claudeflow batch list`

List recent batches.

```
BATCH ID    WORKFLOW           TARGETS  COMPLETED  FAILED  INTERRUPTED  PENDING
b-abc123    migrate-eslint.ts  3        1          1       1            0
b-def456    add-ci.ts          50       48         2       0            0
```

---

## Storage

Batch records are stored under the configurable store path alongside runs:

```
~/.claudeflow/
  runs/
    <runId>/run.json
    <runId>/events.jsonl
  batches/
    <batchId>/batch.json
```

---

## Workflow Events

A new event type for batch-level progress:

```typescript
type BatchEvent =
  | { type: "batch:start"; batchId: string; targetCount: number }
  | { type: "batch:target:start"; batchId: string; targetName: string; runId: string }
  | { type: "batch:target:end"; batchId: string; targetName: string; runId: string; status: string }
  | { type: "batch:complete"; batchId: string; summary: BatchSummary };

interface BatchSummary {
  total: number;
  completed: number;
  failed: number;
  interrupted: number;
  pending: number;
}
```

These events are emitted by the batch runner, not the workflow engine. The workflow engine is unaware of batches.

---

## Limitations and Future Work

- **Sequential only.** No concurrency control in the initial implementation. A future `--concurrency N` flag would introduce parallel execution with a semaphore.
- **No batch resume.** If the batch process is killed, targets with `runId: null` are not automatically retried. A `claudeflow batch resume <batchId>` command could be added later.
- **No retry.** Failed targets are not retried. A future `--retry-failed` flag could re-run failed targets.
- **No target generation.** Targets must be provided as a static JSON file. A future enhancement could accept a script or command that produces targets dynamically.
- **Workspace isolation.** Each target gets its own workspace. There is no shared state between targets — the workflow runs are fully independent.
