import type { Shell as ZxShell } from "zx";

export type State = Record<string, unknown>;

export type Shell = ZxShell;

export interface RunContext {
  runId: string;
  workspace: string;
  state: State;
  log: (message: string) => void;
  $: Shell;
}

export type WorkflowEvent =
  | { type: "node:start"; nodeId: string; runId: string }
  | { type: "node:chunk"; nodeId: string; chunk: string }
  | { type: "node:end"; nodeId: string; durationMs: number }
  | { type: "node:error"; nodeId: string; error: string }
  | { type: "run:complete"; runId: string; status: "completed" | "failed" };

export interface ScriptedNodeDef {
  type: "scripted";
  fn: (ctx: RunContext) => Promise<Partial<State>>;
}

export interface ClaudeNodeDef {
  type: "claude";
  image: string;
  prompt: string | ((ctx: RunContext) => string);
  allowedDomains: string[];
  env: Record<string, string>;
  timeoutMs: number;
}

export type NodeDef = ScriptedNodeDef | ClaudeNodeDef;

export type EdgeTarget = string;

export interface StaticEdge {
  type: "static";
  target: string;
}

export interface ConditionalEdge {
  type: "conditional";
  fn: (ctx: RunContext) => string;
}

export type Edge = StaticEdge | ConditionalEdge;

export interface RunResult {
  runId: string;
  status: "completed" | "failed";
  state: State;
}

export interface RunOptions {
  initialState?: State;
  workspace?: string | undefined;
  onEvent?: (event: WorkflowEvent) => void;
}
