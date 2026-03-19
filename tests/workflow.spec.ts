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

    const result = await runCli([
      "run",
      fixtureWorkflow,
      "--workspace",
      workspace,
      "--output",
      "json",
    ]);

    // Verify file was written to workspace
    const output = readFileSync(join(workspace, "output.txt"), "utf8");
    expect(output).toBe("HELLO WORLD\n");

    // Parse JSON events from stdout
    const events = result.stdout
      .split("\n")
      .filter((l) => l.trim())
      .map((l) => JSON.parse(l));

    const types = events.map(
      (e: { type: string; nodeId?: string }) =>
        `${e.type}${e.nodeId ? `:${e.nodeId}` : ""}`,
    );
    expect(types).toEqual([
      "node:start:read_input",
      "node:chunk:read_input", // $ cat input.txt
      "node:chunk:read_input", // hello world
      "node:end:read_input",
      "node:start:transform",
      "node:chunk:transform", // $ sh -c echo ...
      "node:end:transform",
      "node:start:verify",
      "node:chunk:verify", // $ cat output.txt
      "node:chunk:verify", // HELLO WORLD
      "node:end:verify",
      "run:complete",
    ]);
  });
});
