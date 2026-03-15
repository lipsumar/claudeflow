import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function runCli(...args: string[]) {
  return execFileAsync("node", ["./dist/cli/index.mjs", ...args]);
}
