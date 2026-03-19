import type { ChildProcess } from "node:child_process";

export interface ExecOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
}

export interface SpawnOpts {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdio?: ("ignore" | "pipe" | "inherit")[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SerializedExecutor {
  type: string;
  workspace: string;
  [key: string]: unknown;
}

export interface Executor {
  init(): Promise<void>;
  workspace: string;
  exec(cmd: string, args: string[], opts?: ExecOpts): Promise<ExecResult>;
  spawn(cmd: string, args: string[], opts?: SpawnOpts): ChildProcess;
  cleanup(): Promise<void>;
  serialize(): SerializedExecutor;
}
