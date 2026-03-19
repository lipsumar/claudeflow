import type { Executor, ExecResult } from "../executor/types.js";
import type { Workflow } from "./workflow.js";

export type { ExecResult };

export type State = Record<string, unknown>;

export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

export interface RunContext {
  runId: string;
  workspace: string;
  state: State;
  log: Logger;
  exec(cmd: string, args: string[]): Promise<ExecResult>;
}

import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export type NodeChunk =
  | string
  | { level: "debug" | "info" | "warn" | "error"; message: string }
  | { type: "claude"; message: SDKMessage };

export type WorkflowEvent =
  | { type: "node:start"; nodeId: string; runId: string }
  | { type: "node:chunk"; nodeId: string; chunk: NodeChunk }
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
  model: string;
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
  executor: Executor;
  onEvent?: (event: WorkflowEvent) => void;
}

export type WorkflowFromFile = Workflow & { filepath: string };

export interface Run {
  runId: string;
  workflow: WorkflowFromFile;
  executor: Executor;
  currentNode: string;
  state: State;
  status: "running" | "completed" | "failed";
  startTime: string;
  endTime?: string;
  initialState: State;
  finalState?: State;
}
