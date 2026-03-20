import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter, Readable } from "node:stream";
import type { ChildProcess } from "node:child_process";
import type { Executor } from "../executor/types.js";
import type {
  ClaudeNodeDef,
  RunContext,
  WorkflowEvent,
} from "../workflow/types.js";

vi.mock("../config.js", () => ({
  getConfig: () => ({
    anthropic: { apiKey: "test-key" },
  }),
}));

import { executeClaudeNode } from "./claude.js";

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

function createDef(overrides: Partial<ClaudeNodeDef> = {}): ClaudeNodeDef {
  return {
    type: "claude",
    image: "test-image",
    prompt: "do something",
    allowedDomains: [],
    env: {},
    timeoutMs: 300_000,
    model: "sonnet",
    ...overrides,
  };
}

function createMockChild(): ChildProcess {
  const child = new EventEmitter() as ChildProcess;
  child.stdout = new Readable({ read() {} });
  child.stderr = new Readable({ read() {} });
  child.stdin = null;
  Object.defineProperty(child, "pid", { value: 1234 });
  Object.defineProperty(child, "killed", { value: false });
  child.kill = vi.fn();
  return child;
}

function createMockExecutor(child: ChildProcess): Executor {
  return {
    workspace: "/tmp/test",
    async init() {},
    async exec() {
      return { stdout: "", stderr: "", exitCode: 0 };
    },
    spawn: vi.fn().mockReturnValue(child),
    async cleanup() {},
    serialize() {
      return { type: "mock", workspace: "/tmp/test" };
    },
  };
}

describe("executeClaudeNode", () => {
  let child: ChildProcess;
  let executor: Executor;
  let events: WorkflowEvent[];
  let emit: (event: WorkflowEvent) => void;

  beforeEach(() => {
    child = createMockChild();
    executor = createMockExecutor(child);
    events = [];
    emit = (event) => events.push(event);
  });

  it("spawns claude with correct arguments", async () => {
    const def = createDef({ prompt: "hello world", model: "opus" });
    const promise = executeClaudeNode(def, "node-1", createCtx(), executor, emit);

    child.emit("close", 0);
    await promise;

    expect(executor.spawn).toHaveBeenCalledWith(
      "claude",
      [
        "--print",
        "--model",
        "opus",
        "--output-format",
        "stream-json",
        "--verbose",
        "hello world",
      ],
      expect.objectContaining({
        env: expect.objectContaining({ ANTHROPIC_API_KEY: "test-key" }),
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  });

  it("resolves on exit code 0", async () => {
    const promise = executeClaudeNode(
      createDef(),
      "node-1",
      createCtx(),
      executor,
      emit,
    );

    child.emit("close", 0);
    const result = await promise;

    expect(result).toEqual({});
  });

  it("rejects on non-zero exit code", async () => {
    const promise = executeClaudeNode(
      createDef(),
      "node-1",
      createCtx(),
      executor,
      emit,
    );

    child.emit("close", 1);

    await expect(promise).rejects.toThrow("claude process exited with code 1");
  });

  it("emits node:chunk events for stdout JSON lines", async () => {
    const promise = executeClaudeNode(
      createDef(),
      "node-1",
      createCtx(),
      executor,
      emit,
    );

    const msg = { type: "assistant", message: "hi" };
    child.stdout!.emit("data", Buffer.from(JSON.stringify(msg) + "\n"));
    child.emit("close", 0);
    await promise;

    expect(events).toContainEqual({
      type: "node:chunk",
      nodeId: "node-1",
      chunk: { type: "claude", message: msg },
    });
  });

  it("emits node:chunk events for stderr", async () => {
    const promise = executeClaudeNode(
      createDef(),
      "node-1",
      createCtx(),
      executor,
      emit,
    );

    child.stderr!.emit("data", Buffer.from("something went wrong"));
    child.emit("close", 0);
    await promise;

    expect(events).toContainEqual({
      type: "node:chunk",
      nodeId: "node-1",
      chunk: { level: "error", message: "something went wrong" },
    });
  });

  it("flushes remaining buffer on close", async () => {
    const promise = executeClaudeNode(
      createDef(),
      "node-1",
      createCtx(),
      executor,
      emit,
    );

    const msg = { type: "result", text: "done" };
    // Send data without trailing newline
    child.stdout!.emit("data", Buffer.from(JSON.stringify(msg)));
    child.emit("close", 0);
    await promise;

    expect(events).toContainEqual({
      type: "node:chunk",
      nodeId: "node-1",
      chunk: { type: "claude", message: msg },
    });
  });

  it("supports dynamic prompt function", async () => {
    const def = createDef({
      prompt: (ctx) => `state is ${ctx.state.value}`,
    });
    const promise = executeClaudeNode(
      def,
      "node-1",
      createCtx({ value: "42" }),
      executor,
      emit,
    );

    child.emit("close", 0);
    await promise;

    expect(executor.spawn).toHaveBeenCalledWith(
      "claude",
      expect.arrayContaining(["state is 42"]),
      expect.anything(),
    );
  });

  it("merges def.env into spawn env", async () => {
    const def = createDef({ env: { MY_VAR: "hello" } });
    const promise = executeClaudeNode(
      def,
      "node-1",
      createCtx(),
      executor,
      emit,
    );

    child.emit("close", 0);
    await promise;

    expect(executor.spawn).toHaveBeenCalledWith(
      "claude",
      expect.anything(),
      expect.objectContaining({
        env: expect.objectContaining({ MY_VAR: "hello" }),
      }),
    );
  });

  it("rejects on spawn error", async () => {
    const promise = executeClaudeNode(
      createDef(),
      "node-1",
      createCtx(),
      executor,
      emit,
    );

    child.emit("error", new Error("spawn failed"));

    await expect(promise).rejects.toThrow("spawn failed");
  });
});
