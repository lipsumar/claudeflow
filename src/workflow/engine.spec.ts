import { describe, it, expect, beforeEach, vi } from "vitest";
import { Workflow } from "./workflow.js";
import { runWorkflow } from "./engine.js";
import { scriptedNode } from "../nodes/scripted.js";
import { claudeNode } from "../nodes/claude.js";
import { initConfig, resetConfig } from "../config.js";
import { HostExecutor } from "../executor/host.js";
import type { WorkflowEvent, WorkflowFromFile } from "./types.js";

const store = {
  persistRun: vi.fn().mockImplementation((run) => {
    // Snapshot the run state at call time since the object is mutable
    store._snapshots.push(JSON.parse(JSON.stringify(run)));
  }),
  appendEvent: vi.fn(),
  _snapshots: [] as unknown[],
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
  store.persistRun.mockClear();
  store._snapshots = [];
  store.appendEvent.mockReset();
});

function withFilepath(wf: Workflow): WorkflowFromFile {
  return Object.assign(wf, { filepath: "/test/workflow.ts" }) as WorkflowFromFile;
}

function createExecutor() {
  return new HostExecutor({ workspace: "/tmp/claudeflow-test-" + Date.now() });
}

describe("runWorkflow", () => {
  it("runs a single scripted node", async () => {
    const wf = withFilepath(
      new Workflow({ name: "test" }).addNode(
        "greet",
        scriptedNode(async () => ({ greeting: "hello" })),
      ),
    );

    const result = await runWorkflow(wf, {
      executor: createExecutor(),
      initialState: {},
    });

    expect(result.status).toBe("completed");
    expect(result.state.greeting).toBe("hello");
  });

  it("chains scripted nodes with edges", async () => {
    const wf = withFilepath(
      new Workflow({ name: "test" })
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
        .addEdge("step1", "step2"),
    );

    const result = await runWorkflow(wf, {
      executor: createExecutor(),
      initialState: {},
    });

    expect(result.status).toBe("completed");
    expect(result.state.value).toBe(2);
  });

  it("follows conditional edges", async () => {
    const wf = withFilepath(
      new Workflow({ name: "test" })
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
        ),
    );

    const result = await runWorkflow(wf, {
      executor: createExecutor(),
      initialState: {},
    });

    expect(result.status).toBe("completed");
    expect(result.state.fixed).toBe(true);
    expect(result.state.skipped).toBeUndefined();
  });

  it("conditional edge can end the workflow", async () => {
    const wf = withFilepath(
      new Workflow({ name: "test" })
        .addNode(
          "check",
          scriptedNode(async () => ({ done: true })),
        )
        .addNode(
          "unreachable",
          scriptedNode(async () => ({ reached: true })),
        )
        .addConditionalEdge("check", () => "__end__"),
    );

    const result = await runWorkflow(wf, {
      executor: createExecutor(),
      initialState: {},
    });

    expect(result.status).toBe("completed");
    expect(result.state.done).toBe(true);
    expect(result.state.reached).toBeUndefined();
  });

  it("emits streaming events", async () => {
    const events: WorkflowEvent[] = [];

    const wf = withFilepath(
      new Workflow({ name: "test" }).addNode(
        "step1",
        scriptedNode(async (ctx) => {
          ctx.log.info("working...");
          return { done: true };
        }),
      ),
    );

    await runWorkflow(wf, {
      executor: createExecutor(),
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

    const wf = withFilepath(
      new Workflow({ name: "test" })
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
        .addEdge("fail", "after"),
    );

    const result = await runWorkflow(wf, {
      executor: createExecutor(),
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
    const wf = withFilepath(
      new Workflow({ name: "test" })
        .addNode(
          "a",
          scriptedNode(async () => ({ x: 1, y: 2 })),
        )
        .addNode(
          "b",
          scriptedNode(async () => ({ y: 3, z: 4 })),
        )
        .addEdge("a", "b"),
    );

    const result = await runWorkflow(wf, {
      executor: createExecutor(),
      initialState: {},
    });

    expect(result.state).toEqual({ x: 1, y: 3, z: 4 });
  });

  it("provides ctx.exec bound to workspace", async () => {
    const wf = withFilepath(
      new Workflow({ name: "test" }).addNode(
        "bash",
        scriptedNode(async (ctx) => {
          await ctx.exec("sh", ["-c", "echo hello > greeting.txt"]);
          const result = await ctx.exec("cat", ["greeting.txt"]);
          return { greeting: result.stdout.trim() };
        }),
      ),
    );

    const result = await runWorkflow(wf, {
      executor: createExecutor(),
      initialState: {},
    });

    expect(result.status).toBe("completed");
    expect(result.state.greeting).toBe("hello");
  });

  it("streams ctx.exec output as node:chunk events", async () => {
    const events: WorkflowEvent[] = [];

    const wf = withFilepath(
      new Workflow({ name: "test" }).addNode(
        "bash",
        scriptedNode(async (ctx) => {
          await ctx.exec("echo", ["hello"]);
          return {};
        }),
      ),
    );

    await runWorkflow(wf, {
      executor: createExecutor(),
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
    const wf = withFilepath(new Workflow({ name: "test" }));
    await expect(
      runWorkflow(wf, { executor: createExecutor() }),
    ).rejects.toThrow("Workflow has no nodes");
  });

  it("claude node throws not-implemented error", async () => {
    const wf = withFilepath(
      new Workflow({ name: "test" }).addNode(
        "claude",
        claudeNode({
          image: "test:latest",
          prompt: "do something",
        }),
      ),
    );

    const result = await runWorkflow(wf, {
      executor: createExecutor(),
      initialState: {},
    });
    expect(result.status).toBe("failed");
  });
});

describe("runWorkflow (store integration)", () => {
  it("calls persistRun at start and end", async () => {
    const wf = withFilepath(
      new Workflow({ name: "my-wf" }).addNode(
        "step",
        scriptedNode(async () => ({ done: true })),
      ),
    );

    const result = await runWorkflow(wf, {
      executor: createExecutor(),
      initialState: { x: 1 },
    });

    // persistRun is called: initial + checkpoint before node + final
    const snapshots = store._snapshots;
    expect(snapshots.length).toBeGreaterThanOrEqual(2);

    const first = snapshots[0] as Record<string, unknown>;
    expect(first.runId).toBe(result.runId);
    expect(first.status).toBe("running");
    expect(first.initialState).toEqual({ x: 1 });
    expect(first.startTime).toBeDefined();

    const last = snapshots[snapshots.length - 1] as Record<string, unknown>;
    expect(last.status).toBe("completed");
    expect(last.finalState).toEqual({ x: 1, done: true });
    expect(last.endTime).toBeDefined();
  });

  it("calls appendEvent for every emitted event", async () => {
    const wf = withFilepath(
      new Workflow({ name: "test" }).addNode(
        "step",
        scriptedNode(async () => ({ done: true })),
      ),
    );

    const result = await runWorkflow(wf, {
      executor: createExecutor(),
      initialState: {},
    });

    // At minimum: node:start, node:end, run:complete
    expect(store.appendEvent.mock.calls.length).toBeGreaterThanOrEqual(3);
    // All calls should use the correct runId
    for (const call of store.appendEvent.mock.calls) {
      expect(call[0]).toBe(result.runId);
    }
  });

  it("records failed status on error", async () => {
    const wf = withFilepath(
      new Workflow({ name: "test" }).addNode(
        "fail",
        scriptedNode(async () => {
          throw new Error("boom");
        }),
      ),
    );

    await runWorkflow(wf, {
      executor: createExecutor(),
      initialState: {},
    });

    const last = store._snapshots[store._snapshots.length - 1] as Record<string, unknown>;
    expect(last.status).toBe("failed");
  });

  it("still calls onEvent alongside store.appendEvent", async () => {
    const events: WorkflowEvent[] = [];
    const wf = withFilepath(
      new Workflow({ name: "test" }).addNode(
        "step",
        scriptedNode(async () => ({ done: true })),
      ),
    );

    await runWorkflow(wf, {
      executor: createExecutor(),
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
