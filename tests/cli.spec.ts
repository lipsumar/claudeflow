import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { runCli } from "./helpers.js";

const { version } = JSON.parse(readFileSync("./package.json", "utf8"));

describe("cli", () => {
  it("prints version with --version", async () => {
    const { stdout } = await runCli("--version");
    expect(stdout.trim()).toBe(version);
  });
});
