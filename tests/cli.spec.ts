import { describe, it, expect } from "vitest";
import { runCli } from "./helpers.js";

describe("cli", () => {
  it("prints to stdout", async () => {
    const { stdout } = await runCli();
    expect(stdout.trim()).toBe("claudeflow CLI - not yet implemented");
  });
});
