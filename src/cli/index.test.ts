import { describe, it, expect, vi } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

describe("cli", () => {
  it("prints to stdout", async () => {
    const { stdout } = await execFileAsync("node", ["./dist/cli/index.mjs"]);
    expect(stdout.trim()).toBe("claudeflow CLI - not yet implemented");
  });
});
