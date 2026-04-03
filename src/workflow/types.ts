import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ZodObject, ZodType } from "zod";
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

export type NodeChunk =
  | string
  | { level: "debug" | "info" | "warn" | "error"; message: string }
  | { type: "claude"; message: SDKMessage };

export interface WorkflowOptions {
  name: string;
  executor: "host" | "docker";
  dockerImage?: string; // required if executor is "docker" - type could be nicer
  inputs?: ZodObject;
}

export type WorkflowEvent =
  | { type: "node:start"; nodeId: string; runId: string }
  | { type: "node:chunk"; nodeId: string; chunk: NodeChunk }
  | { type: "node:end"; nodeId: string; durationMs: number }
  | { type: "node:error"; nodeId: string; error: string }
  | { type: "node:interrupted"; nodeId: string }
  | { type: "node:http"; nodeId: string; requests: HttpRequestEntry[] }
  | {
      type: "run:complete";
      runId: string;
      status: "completed" | "failed";
    }
  | {
      type: "run:interrupted";
      runId: string;
      status: "interrupted";
    };

export interface ScriptedNodeDef {
  type: "scripted";
  fn: (ctx: RunContext) => Promise<Partial<State>>;
}

export interface ClaudeNodeDef {
  type: "claude";
  prompt: string | ((ctx: RunContext) => string);
  env: Record<string, string>;
  timeoutMs: number;
  model: string;
  storeOutputAs?: string | { key: string; schema: ZodType };
}

export interface InterruptNodeDef {
  type: "interrupt";
  question: string | ((ctx: RunContext) => string);
  storeAs: string;
}

export type NodeDef = ScriptedNodeDef | ClaudeNodeDef | InterruptNodeDef;

export interface NodeResult {
  /** State updates to shallow-merge (scripted nodes only). */
  state?: Partial<State>;
  /** If true, the engine stops the loop with status "interrupted". */
  interrupted?: boolean;
  /** Metadata about the interruption. Opaque to the engine. */
  interruptMetadata?: InterruptMetadata;
}

export interface InterruptMetadata {
  reason: "input-required" | "error";
  question?: string;
  nodeData?: unknown;
}

export interface HttpRequestEntry {
  timestamp: string;
  domain: string;
  port: number;
  status: "allowed" | "denied";
  durationMs: number;
  bytes: number;
}

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
  status: "completed" | "failed" | "interrupted";
  state: State;
}

export interface RunOptions {
  initialState?: State;
  executor: Executor;
  onEvent?: (event: WorkflowEvent) => void;
}

export interface ResumeOptions {
  input?: string;
  onEvent?: (event: WorkflowEvent) => void;
}

export type WorkflowFromFile = Workflow & { filepath: string };

export interface Run {
  runId: string;
  workflow: WorkflowFromFile;
  executor: Executor;
  currentNode: string;
  state: State;
  status: "running" | "completed" | "failed" | "interrupted";
  startTime: string;
  endTime?: string;
  initialState: State;
  finalState?: State;
  interruptMetadata?: InterruptMetadata;
  resumeInput?: string;
}
