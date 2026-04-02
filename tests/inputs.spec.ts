import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { runCli } from "./helpers.js";

const fixture = resolve(__dirname, "fixtures/inputs/inputs.ts");

function parseState(stdout: string): Record<string, unknown> {
  const lines = stdout.split("\n").filter((l) => l.trim());
  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (
        event.type === "node:chunk" &&
        typeof event.chunk === "object" &&
        event.chunk.level === "info"
      ) {
        return JSON.parse(event.chunk.message);
      }
    } catch {
      // skip non-JSON lines
    }
  }
  throw new Error("No state found in output");
}

describe("inputs via arguments (-- key=value)", () => {
  it("passes all mandatory and optional inputs", async () => {
    const { stdout } = await runCli([
      "run",
      fixture,
      "--output",
      "json",
      "--",
      "name=Alice",
      "count=42",
      "flag=true",
      "nameOpt=Bob",
      "countOpt=7",
      "flagOpt=false",
    ]);

    expect(parseState(stdout)).toEqual({
      name: "Alice",
      count: 42,
      flag: true,
      nameOpt: "Bob",
      countOpt: 7,
      flagOpt: false,
    });
  });

  it("passes only mandatory inputs, optional ones are omitted", async () => {
    const { stdout } = await runCli([
      "run",
      fixture,
      "--output",
      "json",
      "--",
      "name=Charlie",
      "count=10",
      "flag=false",
      "nameOpt=",
      "countOpt=0",
      "flagOpt=0",
    ]);

    const state = parseState(stdout);
    expect(state.name).toBe("Charlie");
    expect(state.count).toBe(10);
    expect(state.flag).toBe(false);
    expect(state.nameOpt).toBe("");
    expect(state.countOpt).toBe(0);
    expect(state.flagOpt).toBe(false);
  });

  it("coerces number 0 correctly", async () => {
    const { stdout } = await runCli([
      "run",
      fixture,
      "--output",
      "json",
      "--",
      "name=test",
      "count=0",
      "flag=true",
      "nameOpt=",
      "countOpt=0",
      "flagOpt=0",
    ]);

    const state = parseState(stdout);
    expect(state.count).toBe(0);
    expect(state.countOpt).toBe(0);
  });

  it("coerces boolean from '1' to true", async () => {
    const { stdout } = await runCli([
      "run",
      fixture,
      "--output",
      "json",
      "--",
      "name=test",
      "count=5",
      "flag=1",
      "nameOpt=",
      "countOpt=0",
      "flagOpt=1",
    ]);

    const state = parseState(stdout);
    expect(state.flag).toBe(true);
    expect(state.flagOpt).toBe(true);
  });

  it("coerces boolean from 'false' and other strings to false", async () => {
    const { stdout } = await runCli([
      "run",
      fixture,
      "--output",
      "json",
      "--",
      "name=test",
      "count=1",
      "flag=false",
      "nameOpt=",
      "countOpt=0",
      "flagOpt=nope",
    ]);

    const state = parseState(stdout);
    expect(state.flag).toBe(false);
    expect(state.flagOpt).toBe(false);
  });

  it("rejects non-numeric value for number input", async () => {
    await expect(
      runCli([
        "run",
        fixture,
        "--output",
        "json",
        "--",
        "name=test",
        "count=notanumber",
        "flag=true",
        "nameOpt=",
        "countOpt=0",
        "flagOpt=0",
      ]),
    ).rejects.toThrow(/must be a number/);
  });

  it("rejects malformed argument (missing =)", async () => {
    await expect(
      runCli([
        "run",
        fixture,
        "--output",
        "json",
        "--",
        "name=test",
        "badarg",
        "flag=true",
      ]),
    ).rejects.toThrow(/expected key=value/i);
  });

  it("handles string values containing =", async () => {
    const { stdout } = await runCli([
      "run",
      fixture,
      "--output",
      "json",
      "--",
      "name=a=b=c",
      "count=1",
      "flag=true",
      "nameOpt=x=y",
      "countOpt=0",
      "flagOpt=0",
    ]);

    const state = parseState(stdout);
    expect(state.name).toBe("a=b=c");
    expect(state.nameOpt).toBe("x=y");
  });

  it("handles negative numbers", async () => {
    const { stdout } = await runCli([
      "run",
      fixture,
      "--output",
      "json",
      "--",
      "name=test",
      "count=-5",
      "flag=true",
      "nameOpt=",
      "countOpt=-99",
      "flagOpt=0",
    ]);

    const state = parseState(stdout);
    expect(state.count).toBe(-5);
    expect(state.countOpt).toBe(-99);
  });
});
