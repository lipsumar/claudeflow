import { mkdirSync } from "node:fs";
import {
  execFile,
  spawn as cpSpawn,
  type ChildProcess,
} from "node:child_process";
import type {
  Executor,
  ExecOpts,
  ExecResult,
  SpawnOpts,
  SerializedExecutor,
} from "./types.js";

export class HostExecutor implements Executor {
  workspace: string;

  constructor({ workspace }: { workspace: string }) {
    this.workspace = workspace;
  }

  async init(): Promise<void> {
    mkdirSync(this.workspace, { recursive: true });
  }

  private buildEnv(env?: Record<string, string | undefined>): NodeJS.ProcessEnv {
    return {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ...env,
    } as NodeJS.ProcessEnv;
  }

  exec(cmd: string, args: string[], opts?: ExecOpts): Promise<ExecResult> {
    return new Promise((resolve, reject) => {
      execFile(
        cmd,
        args,
        {
          cwd: opts?.cwd ?? this.workspace,
          env: this.buildEnv(opts?.env),
        },
        (error, stdout, stderr) => {
          if (error && error.code === undefined) {
            reject(error);
            return;
          }
          resolve({
            stdout: stdout ?? "",
            stderr: stderr ?? "",
            exitCode: error ? (error as unknown as { status: number }).status ?? 1 : 0,
          });
        },
      );
    });
  }

  spawn(cmd: string, args: string[], opts?: SpawnOpts): ChildProcess {
    return cpSpawn(cmd, args, {
      cwd: opts?.cwd ?? this.workspace,
      env: this.buildEnv(opts?.env),
      stdio: opts?.stdio as Parameters<typeof cpSpawn>[2] extends { stdio?: infer S } ? S : never,
    });
  }

  async cleanup(): Promise<void> {
    // Host executor doesn't need cleanup — workspace persists on disk
  }

  serialize(): SerializedExecutor {
    return { type: "host", workspace: this.workspace };
  }

  static hydrate(serialized: SerializedExecutor): HostExecutor {
    return new HostExecutor({ workspace: serialized.workspace });
  }
}
