// Workflow DAG executor
// Custom engine: walks the node graph, manages state, emits streaming events.
// No external graph framework — the execution model (filesystem side-effects
// + shallow state merge) is simple enough to own directly.

import { randomUUID } from "node:crypto";
import { getStore } from "../store/run-store.js";
import type {
  Run,
  RunContext,
  RunOptions,
  RunResult,
  State,
  WorkflowEvent,
  WorkflowFromFile,
} from "./types.js";
import { createRunContext } from "./context.js";
import { executeClaudeNode } from "./executeClaudeNode.js";

const END = "__end__";

export async function runWorkflow(
  workflow: WorkflowFromFile,
  options: RunOptions,
): Promise<RunResult> {
  const { executor } = options;

  await executor.init();

  const state: State = { ...(options.initialState ?? {}) };
  const userEmit = options.onEvent ?? (() => {});
  const store = getStore();

  const run: Run = {
    runId: randomUUID(),
    workflow,
    executor,
    currentNode: workflow.getEntryNode(),
    state,
    status: "running",
    startTime: new Date().toISOString(),
    initialState: { ...state },
  };

  store.persistRun(run);

  const emit = (event: WorkflowEvent) => {
    store.appendEvent(run.runId, event);
    userEmit(event);
  };

  run.status = await executeLoop(run, emit);

  run.endTime = new Date().toISOString();
  run.finalState = { ...state };

  emit({ type: "run:complete", runId: run.runId, status: run.status });
  store.persistRun(run);
  await executor.cleanup();

  return { runId: run.runId, status: run.status, state };
}

async function executeLoop(
  run: Run,
  emit: (event: WorkflowEvent) => void,
): Promise<"completed" | "failed"> {
  const { workflow, executor, state } = run;
  const store = getStore();

  while (run.currentNode !== END) {
    // Checkpoint before each node for future resumption
    store.persistRun(run);

    const nodeDef = workflow.getNode(run.currentNode);
    const ctx = createRunContext({
      runId: run.runId,
      nodeId: run.currentNode,
      executor,
      state,
      emit,
    });

    emit({ type: "node:start", nodeId: run.currentNode, runId: run.runId });
    const start = Date.now();

    try {
      if (nodeDef.type === "scripted") {
        const partial = await nodeDef.fn(ctx);
        Object.assign(state, partial);
      } else {
        await executeClaudeNode(nodeDef, run.currentNode, ctx, executor, emit);
      }

      emit({
        type: "node:end",
        nodeId: run.currentNode,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: "node:error", nodeId: run.currentNode, error: message });
      return "failed";
    }

    run.currentNode = resolveNextNode(workflow, run.currentNode, ctx);
  }

  return "completed";
}

function resolveNextNode(
  workflow: WorkflowFromFile,
  current: string,
  ctx: RunContext,
): string {
  const edge = workflow.getEdge(current);
  if (!edge) {
    return END;
  }
  if (edge.type === "static") {
    return edge.target;
  }
  return edge.fn(ctx);
}
