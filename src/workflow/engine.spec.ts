import { describe, it, expect, beforeEach, vi } from "vitest";
import { Workflow } from "./workflow.js";
import { runWorkflow } from "./engine.js";
import { scriptedNode } from "../nodes/scripted.js";
import { claudeNode } from "../nodes/claude.js";
import { initConfig, resetConfig } from "../config.js";
import type { WorkflowEvent } from "./types.js";

const store = {
  createRun: vi.fn(),
  updateRun: vi.fn(),
  appendEvent: vi.fn(),
};

vi.mock("../store/run-store.js", async (importOriginal) => {
  const mod = await importOriginal<typeof import("../store/run-store.js")>();
  return {
    ...mod,
    getStore: () => store,
  };
});

beforeEach(async () => {
  resetConfig();
  await initConfig();
  store.createRun.mockReset();
  store.updateRun.mockReset();
  store.appendEvent.mockReset();
});

describe("runWorkflow", () => {
  it("runs a single scripted node", async () => {
    const wf = new Workflow({ name: "test" }).addNode(
      "greet",
      scriptedNode(async () => ({ greeting: "hello" })),
    );

    const result = await runWorkflow(wf, {
      initialState: {},
    });

    expect(result.status).toBe("completed");
    expect(result.state.greeting).toBe("hello");
  });

  it("chains scripted nodes with edges", async () => {
    const wf = new Workflow({ name: "test" })
      .addNode(
        "step1",
        scriptedNode(async () => ({ value: 1 })),
      )
      .addNode(
        "step2",
        scriptedNode(async (ctx) => ({
          value: (ctx.state.value as number) + 1,
        })),
      )
      .addEdge("step1", "step2");

    const result = await runWorkflow(wf, {
      initialState: {},
    });

    expect(result.status).toBe("completed");
    expect(result.state.value).toBe(2);
  });

  it("follows conditional edges", async () => {
    const wf = new Workflow({ name: "test" })
      .addNode(
        "check",
        scriptedNode(async () => ({ shouldFix: true })),
      )
      .addNode(
        "fix",
        scriptedNode(async () => ({ fixed: true })),
      )
      .addNode(
        "skip",
        scriptedNode(async () => ({ skipped: true })),
      )
      .addConditionalEdge("check", (ctx) =>
        ctx.state.shouldFix ? "fix" : "skip",
      );

    const result = await runWorkflow(wf, {
      initialState: {},
    });

    expect(result.status).toBe("completed");
    expect(result.state.fixed).toBe(true);
    expect(result.state.skipped).toBeUndefined();
  });

  it("conditional edge can end the workflow", async () => {
    const wf = new Workflow({ name: "test" })
      .addNode(
        "check",
        scriptedNode(async () => ({ done: true })),
      )
      .addNode(
        "unreachable",
        scriptedNode(async () => ({ reached: true })),
      )
      .addConditionalEdge("check", () => "__end__");

    const result = await runWorkflow(wf, {
      initialState: {},
    });

    expect(result.status).toBe("completed");
    expect(result.state.done).toBe(true);
    expect(result.state.reached).toBeUndefined();
  });

  it("emits streaming events", async () => {
    const events: WorkflowEvent[] = [];

    const wf = new Workflow({ name: "test" }).addNode(
      "step1",
      scriptedNode(async (ctx) => {
        ctx.log.info("working...");
        return { done: true };
      }),
    );

    await runWorkflow(wf, {
      initialState: {},
      onEvent: (e) => events.push(e),
    });

    expect(events).toEqual([
      expect.objectContaining({ type: "node:start", nodeId: "step1" }),
      expect.objectContaining({
        type: "node:chunk",
        nodeId: "step1",
        chunk: {
          level: "info",
          message: "working...",
        },
      }),
      expect.objectContaining({ type: "node:end", nodeId: "step1" }),
      expect.objectContaining({ type: "run:complete", status: "completed" }),
    ]);
  });

  it("handles node errors gracefully", async () => {
    const events: WorkflowEvent[] = [];

    const wf = new Workflow({ name: "test" })
      .addNode(
        "fail",
        scriptedNode(async () => {
          throw new Error("boom");
        }),
      )
      .addNode(
        "after",
        scriptedNode(async () => ({ reached: true })),
      )
      .addEdge("fail", "after");

    const result = await runWorkflow(wf, {
      initialState: {},
      onEvent: (e) => events.push(e),
    });

    expect(result.status).toBe("failed");
    expect(result.state.reached).toBeUndefined();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "node:error",
        nodeId: "fail",
        error: "boom",
      }),
    );
  });

  it("shallow-merges state across nodes", async () => {
    const wf = new Workflow({ name: "test" })
      .addNode(
        "a",
        scriptedNode(async () => ({ x: 1, y: 2 })),
      )
      .addNode(
        "b",
        scriptedNode(async () => ({ y: 3, z: 4 })),
      )
      .addEdge("a", "b");

    const result = await runWorkflow(wf, {
      initialState: {},
    });

    expect(result.state).toEqual({ x: 1, y: 3, z: 4 });
  });

  it("provides ctx.$ bound to workspace", async () => {
    const wf = new Workflow({ name: "test" }).addNode(
      "bash",
      scriptedNode(async (ctx) => {
        await ctx.$`echo hello > greeting.txt`;
        const result = await ctx.$`cat greeting.txt`;
        return { greeting: result.stdout.trim() };
      }),
    );

    const result = await runWorkflow(wf, {
      initialState: {},
    });

    expect(result.status).toBe("completed");
    expect(result.state.greeting).toBe("hello");
  });

  it("streams ctx.$ output as node:chunk events", async () => {
    const events: WorkflowEvent[] = [];

    const wf = new Workflow({ name: "test" }).addNode(
      "bash",
      scriptedNode(async (ctx) => {
        await ctx.$`echo hello`;
        return {};
      }),
    );

    await runWorkflow(wf, {
      initialState: {},
      onEvent: (e) => events.push(e),
    });

    const chunks = events.filter((e) => e.type === "node:chunk");
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "node:chunk",
        chunk: {
          level: "info",
          message: expect.stringContaining("echo hello"),
        },
      }),
    );
    expect(chunks).toContainEqual(
      expect.objectContaining({
        type: "node:chunk",
        chunk: {
          level: "info",
          message: expect.stringContaining("hello"),
        },
      }),
    );
  });

  it("throws when running an empty workflow", async () => {
    const wf = new Workflow({ name: "test" });
    await expect(runWorkflow(wf)).rejects.toThrow("Workflow has no nodes");
  });

  it("claude node throws not-implemented error", async () => {
    const wf = new Workflow({ name: "test" }).addNode(
      "claude",
      claudeNode({
        image: "test:latest",
        prompt: "do something",
      }),
    );

    const result = await runWorkflow(wf, {
      initialState: {},
    });
    expect(result.status).toBe("failed");
  });
});

describe("runWorkflow (store integration)", () => {
  it("calls createRun at start with correct args", async () => {
    const wf = new Workflow({ name: "my-wf" }).addNode(
      "step",
      scriptedNode(async () => ({ done: true })),
    );

    const result = await runWorkflow(wf, {
      initialState: { x: 1 },
    });

    expect(store.createRun).toHaveBeenCalledOnce();
    const call = store.createRun.mock.calls[0]![0];
    expect(call.runId).toBe(result.runId);
    expect(call.workflowName).toBe("my-wf");
    expect(call.status).toBe("running");
    expect(call.initialState).toEqual({ x: 1 });
    expect(call.startTime).toBeDefined();
  });

  it("calls appendEvent for every emitted event", async () => {
    const wf = new Workflow({ name: "test" }).addNode(
      "step",
      scriptedNode(async () => ({ done: true })),
    );

    const result = await runWorkflow(wf, {
      initialState: {},
    });

    // At minimum: node:start, node:end, run:complete
    expect(store.appendEvent.mock.calls.length).toBeGreaterThanOrEqual(3);
    // All calls should use the correct runId
    for (const call of store.appendEvent.mock.calls) {
      expect(call[0]).toBe(result.runId);
    }
  });

  it("calls updateRun at end with final status and state", async () => {
    const wf = new Workflow({ name: "test" }).addNode(
      "step",
      scriptedNode(async () => ({ result: 42 })),
    );

    await runWorkflow(wf, {
      initialState: { x: 1 },
    });

    expect(store.updateRun).toHaveBeenCalledOnce();
    const [runId, patch] = store.updateRun.mock.calls[0]!;
    expect(runId).toBeDefined();
    expect(patch.status).toBe("completed");
    expect(patch.finalState).toEqual({ x: 1, result: 42 });
    expect(patch.endTime).toBeDefined();
  });

  it("records failed status on error", async () => {
    const wf = new Workflow({ name: "test" }).addNode(
      "fail",
      scriptedNode(async () => {
        throw new Error("boom");
      }),
    );

    await runWorkflow(wf, { initialState: {} });

    const [, patch] = store.updateRun.mock.calls[0]!;
    expect(patch.status).toBe("failed");
  });

  it("still calls onEvent alongside store.appendEvent", async () => {
    const events: WorkflowEvent[] = [];
    const wf = new Workflow({ name: "test" }).addNode(
      "step",
      scriptedNode(async () => ({ done: true })),
    );

    await runWorkflow(wf, {
      initialState: {},
      onEvent: (e) => events.push(e),
    });

    // onEvent should receive the same events as appendEvent
    expect(events.length).toBe(store.appendEvent.mock.calls.length);
  });
});

describe("Workflow (definition)", () => {
  it("throws on duplicate node id", () => {
    const wf = new Workflow({ name: "test" }).addNode(
      "a",
      scriptedNode(async () => ({})),
    );
    expect(() =>
      wf.addNode(
        "a",
        scriptedNode(async () => ({})),
      ),
    ).toThrow('Node "a" already exists');
  });

  it("throws on edge to nonexistent node", () => {
    const wf = new Workflow({ name: "test" }).addNode(
      "a",
      scriptedNode(async () => ({})),
    );
    expect(() => wf.addEdge("a", "b")).toThrow('Node "b" does not exist');
  });

  it("throws on duplicate outgoing edge", () => {
    const wf = new Workflow({ name: "test" })
      .addNode(
        "a",
        scriptedNode(async () => ({})),
      )
      .addNode(
        "b",
        scriptedNode(async () => ({})),
      )
      .addNode(
        "c",
        scriptedNode(async () => ({})),
      )
      .addEdge("a", "b");

    expect(() => wf.addEdge("a", "c")).toThrow(
      'Node "a" already has an outgoing edge',
    );
  });
});
