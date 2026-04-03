export { defineConfig } from "./config.js";
export type { ClaudeflowConfig } from "./config.js";

export { Workflow } from "./workflow/workflow.js";
export { runWorkflow } from "./workflow/engine.js";
export type {
  ClaudeNodeDef,
  ExecResult,
  HttpRequestEntry,
  Run,
  RunContext,
  RunOptions,
  RunResult,
  ScriptedNodeDef,
  State,
  WorkflowEvent,
  WorkflowFromFile,
} from "./workflow/types.js";

export { HostExecutor } from "./executor/host.js";
export type { Executor } from "./executor/types.js";

export { claudeNode } from "./nodes/claude.js";
export type { ClaudeNodeOptions } from "./nodes/claude.js";
export { scriptedNode } from "./nodes/scripted.js";
export { interruptNode } from "./nodes/interrupt.js";

export { RunStore, getStore } from "./store/run-store.js";
export type { StoredRun, RunListOptions } from "./store/types.js";

// re-export zod for convenience
export { z } from "zod";
