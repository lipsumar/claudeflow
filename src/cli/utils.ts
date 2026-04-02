import { createInterface } from "node:readline";

/** Parse workflow inputs from process.argv after "--" (e.g. `-- name=John age=30`). */
export function parseRawInputs(): Record<string, string> {
  const idx = process.argv.indexOf("--");
  if (idx === -1) return {};
  const raw = process.argv.slice(idx + 1);
  const result: Record<string, string> = {};
  for (const arg of raw) {
    const eq = arg.indexOf("=");
    if (eq === -1)
      throw new Error(`Invalid input "${arg}", expected key=value`);
    result[arg.slice(0, eq)] = arg.slice(eq + 1);
  }
  return result;
}

export function promptUser(prompt: string): Promise<string> {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}
