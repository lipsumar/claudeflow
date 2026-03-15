import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "./helpers.js";

const fixtureWorkflow = resolve(
  __dirname,
  "fixtures/workflow-simple/workflow.ts",
);

describe("claudeflow run", () => {
  it("runs a scripted workflow via the CLI", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "claudeflow-test-"));
    writeFileSync(join(workspace, "input.txt"), "hello world");

    const { stdout } = await runCli([
      "run",
      fixtureWorkflow,
      "--workspace",
      workspace,
    ]);

    // Verify file was written to workspace
    const output = readFileSync(join(workspace, "output.txt"), "utf8");
    expect(output).toBe("HELLO WORLD");

    // Verify events are emitted in the correct order
    const lines = stdout.split("\n").filter((l) => l.trim());
    expect(lines).toEqual([
      expect.stringContaining("▶ read_input"),
      expect.stringContaining("✓ read_input"),
      expect.stringContaining("▶ transform"),
      expect.stringContaining("✓ transform"),
      expect.stringContaining("▶ verify"),
      expect.stringContaining("✓ verify"),
      expect.stringContaining("completed"),
    ]);
  });
});
