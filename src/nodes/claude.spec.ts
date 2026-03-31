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

import {
  executeClaudeNode,
  containsToolUse,
  extractAskUserQuestion,
} from "./claude.js";

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
    const promise = executeClaudeNode(
      def,
      "node-1",
      createCtx(),
      executor,
      emit,
      {},
    );

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
      {},
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
      {},
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
      {},
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
      {},
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
      {},
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
      {},
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
      {},
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
      {},
    );

    child.emit("error", new Error("spawn failed"));

    await expect(promise).rejects.toThrow("spawn failed");
  });
});

function assistantMessage(
  content: Record<string, unknown>[],
  sessionId = "sess-1",
) {
  return {
    type: "assistant",
    message: { content },
    session_id: sessionId,
  } as unknown as Parameters<typeof containsToolUse>[0];
}

describe("containsToolUse", () => {
  it("returns true when tool_use block matches", () => {
    const msg = assistantMessage([
      { type: "text", text: "hello" },
      { type: "tool_use", name: "AskUserQuestion", input: {} },
    ]);
    expect(containsToolUse(msg, "AskUserQuestion")).toBe(true);
  });

  it("returns false when tool name does not match", () => {
    const msg = assistantMessage([
      { type: "tool_use", name: "Read", input: {} },
    ]);
    expect(containsToolUse(msg, "AskUserQuestion")).toBe(false);
  });

  it("returns false for non-assistant messages", () => {
    const msg = { type: "system", subtype: "init" } as unknown as Parameters<
      typeof containsToolUse
    >[0];
    expect(containsToolUse(msg, "AskUserQuestion")).toBe(false);
  });

  it("returns false when content is empty", () => {
    const msg = assistantMessage([]);
    expect(containsToolUse(msg, "AskUserQuestion")).toBe(false);
  });
});

describe("extractAskUserQuestion", () => {
  it("returns null for non-assistant messages", () => {
    const msg = { type: "user" } as unknown as Parameters<
      typeof extractAskUserQuestion
    >[0];
    expect(extractAskUserQuestion(msg)).toBeNull();
  });

  it("returns null when no AskUserQuestion block exists", () => {
    const msg = assistantMessage([{ type: "text", text: "hello" }]);
    expect(extractAskUserQuestion(msg)).toBeNull();
  });

  it("extracts a simple question string", () => {
    const msg = assistantMessage([
      {
        type: "tool_use",
        name: "AskUserQuestion",
        input: { question: "What should I do?" },
      },
    ]);
    expect(extractAskUserQuestion(msg)).toBe("What should I do?");
  });

  it("extracts question with header", () => {
    const msg = assistantMessage([
      {
        type: "tool_use",
        name: "AskUserQuestion",
        input: { question: "What should I do?", header: "Next Task" },
      },
    ]);
    expect(extractAskUserQuestion(msg)).toBe("## Next Task\nWhat should I do?");
  });

  it("extracts question with options", () => {
    const msg = assistantMessage([
      {
        type: "tool_use",
        name: "AskUserQuestion",
        input: {
          question: "Pick one",
          options: [
            { label: "Option A", description: "First option" },
            { label: "Option B" },
          ],
        },
      },
    ]);
    expect(extractAskUserQuestion(msg)).toBe(
      "Pick one\n- Option A: First option\n- Option B",
    );
  });

  it("extracts from questions array (multi-question form)", () => {
    const msg = assistantMessage([
      {
        type: "tool_use",
        name: "AskUserQuestion",
        input: {
          questions: [
            { question: "First question", header: "Q1" },
            { question: "Second question" },
          ],
        },
      },
    ]);
    expect(extractAskUserQuestion(msg)).toBe(
      "## Q1\nFirst question\n\nSecond question",
    );
  });

  it("extracts full AskUserQuestion matching fixture data", () => {
    const msg = assistantMessage([
      {
        type: "tool_use",
        id: "toolu_01NbEXYUyyUEkoNQY1NpXZdg",
        name: "AskUserQuestion",
        input: {
          questions: [
            {
              question: "What would you like me to work on next?",
              header: "Next Task",
              options: [
                {
                  label: "Explore the codebase",
                  description:
                    "Get familiar with the project structure and architecture",
                },
                {
                  label: "Fix a bug",
                  description: "Identify and fix an existing issue",
                },
                {
                  label: "Add a feature",
                  description: "Implement new functionality",
                },
                {
                  label: "Other (custom task)",
                  description: "Tell me what you'd like to do",
                },
              ],
              multiSelect: false,
            },
          ],
        },
        caller: { type: "direct" },
      },
    ]);
    expect(extractAskUserQuestion(msg)).toBe(
      [
        "## Next Task",
        "What would you like me to work on next?",
        "- Explore the codebase: Get familiar with the project structure and architecture",
        "- Fix a bug: Identify and fix an existing issue",
        "- Add a feature: Implement new functionality",
        "- Other (custom task): Tell me what you'd like to do",
      ].join("\n"),
    );
  });

  it("concatenates multiple AskUserQuestion blocks", () => {
    const msg = assistantMessage([
      {
        type: "tool_use",
        name: "AskUserQuestion",
        input: { question: "Question one" },
      },
      {
        type: "tool_use",
        name: "AskUserQuestion",
        input: { question: "Question two" },
      },
    ]);
    expect(extractAskUserQuestion(msg)).toBe("Question one\n\nQuestion two");
  });
});
