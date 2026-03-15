import { describe, it, expect, beforeEach } from "vitest";
import { Workflow } from "./workflow.js";
import { runWorkflow } from "./engine.js";
import { scriptedNode } from "../nodes/scripted.js";
import { claudeNode } from "../nodes/claude.js";
import { initConfig, resetConfig } from "../config.js";
import type { WorkflowEvent } from "./types.js";

beforeEach(async () => {
  resetConfig();
  await initConfig();
});

describe("runWorkflow", () => {
  it("runs a single scripted node", async () => {
    const wf = new Workflow({ name: "test" }).addNode(
      "greet",
      scriptedNode(async () => ({ greeting: "hello" })),
    );

    const result = await runWorkflow(wf, { initialState: {} });

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
        scriptedNode(async (ctx) => ({ value: (ctx.state.value as number) + 1 })),
      )
      .addEdge("step1", "step2");

    const result = await runWorkflow(wf, { initialState: {} });

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

    const result = await runWorkflow(wf, { initialState: {} });

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

    const result = await runWorkflow(wf, { initialState: {} });

    expect(result.status).toBe("completed");
    expect(result.state.done).toBe(true);
    expect(result.state.reached).toBeUndefined();
  });

  it("emits streaming events", async () => {
    const events: WorkflowEvent[] = [];

    const wf = new Workflow({ name: "test" })
      .addNode(
        "step1",
        scriptedNode(async (ctx) => {
          ctx.log("working...");
          return { done: true };
        }),
      );

    await runWorkflow(wf, { initialState: {}, onEvent: (e) => events.push(e) });

    expect(events).toEqual([
      expect.objectContaining({ type: "node:start", nodeId: "step1" }),
      expect.objectContaining({ type: "node:chunk", nodeId: "step1", chunk: "working..." }),
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
      expect.objectContaining({ type: "node:error", nodeId: "fail", error: "boom" }),
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

    const result = await runWorkflow(wf, { initialState: {} });

    expect(result.state).toEqual({ x: 1, y: 3, z: 4 });
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

    const result = await runWorkflow(wf, { initialState: {} });
    expect(result.status).toBe("failed");
  });
});

describe("Workflow (definition)", () => {
  it("throws on duplicate node id", () => {
    const wf = new Workflow({ name: "test" }).addNode(
      "a",
      scriptedNode(async () => ({})),
    );
    expect(() =>
      wf.addNode("a", scriptedNode(async () => ({}))),
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
      .addNode("a", scriptedNode(async () => ({})))
      .addNode("b", scriptedNode(async () => ({})))
      .addNode("c", scriptedNode(async () => ({})))
      .addEdge("a", "b");

    expect(() => wf.addEdge("a", "c")).toThrow(
      'Node "a" already has an outgoing edge',
    );
  });
});
