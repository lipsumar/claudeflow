import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const cliBin = resolve(__dirname, "../dist/cli/index.mjs");

export interface RunCliOptions {
  cwd?: string;
}

export function runCli(args: string[], options: RunCliOptions = {}) {
  return execFileAsync("node", [cliBin, ...args], {
    cwd: options.cwd || __dirname,
  });
}
