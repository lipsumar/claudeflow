import { describe, it, expect } from "vitest";
import { executeInterruptNode } from "./interrupt.js";
import type { InterruptNodeDef, RunContext } from "../workflow/types.js";

function createCtx(state: Record<string, unknown> = {}): RunContext {
  return {
    runId: "test-run",
    workspace: "/tmp/test",
    state,
    log: { debug() {}, info() {}, warn() {}, error() {} },
    async exec() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
  };
}

const nodeDef: InterruptNodeDef = {
  type: "interrupt",
  question: "What is your name?",
  storeAs: "name",
};

describe("executeInterruptNode", () => {
  it("interrupts when state key is undefined and no input", () => {
    const result = executeInterruptNode("", createCtx(), nodeDef);

    expect(result.interrupted).toBe(true);
    expect(result.interruptMetadata).toEqual({
      reason: "input-required",
      question: "What is your name?",
    });
    expect(result.state).toBeUndefined();
  });

  it("returns state update when input is provided", () => {
    const result = executeInterruptNode("Alice", createCtx(), nodeDef);

    expect(result.interrupted).toBeUndefined();
    expect(result.state).toEqual({ name: "Alice" });
  });

  it("skips interrupt when state key already exists", () => {
    const result = executeInterruptNode(
      "",
      createCtx({ name: "Bob" }),
      nodeDef,
    );

    expect(result.interrupted).toBeUndefined();
    expect(result.state).toEqual({ name: "" });
  });

  it("supports dynamic question function", () => {
    const dynamicDef: InterruptNodeDef = {
      type: "interrupt",
      question: (ctx) => `Hello ${ctx.state.greeting}, what is your name?`,
      storeAs: "name",
    };

    const result = executeInterruptNode(
      "",
      createCtx({ greeting: "world" }),
      dynamicDef,
    );

    expect(result.interrupted).toBe(true);
    expect(result.interruptMetadata?.question).toBe(
      "Hello world, what is your name?",
    );
  });
});
