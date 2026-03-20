import { randomUUID } from "node:crypto";
import { getStore } from "../store/run-store.js";
import type {
  NodeResult,
  ResumeOptions,
  Run,
  RunContext,
  RunOptions,
  RunResult,
  State,
  WorkflowEvent,
  WorkflowFromFile,
} from "./types.js";
import { createRunContext } from "./context.js";

import { loadWorkflow } from "./loader.js";
import type { StoredRun } from "../store/types.js";
import { HostExecutor } from "../executor/index.js";
import { executeInterruptNode } from "../nodes/interrupt.js";
import { executeClaudeNode } from "../nodes/claude.js";

const END = "__end__";

export async function runWorkflow(
  workflow: WorkflowFromFile,
  options: RunOptions,
): Promise<RunResult> {
  const { executor } = options;

  await executor.init();

  const state: State = { ...(options.initialState ?? {}) };

  const run: Run = {
    runId: randomUUID(),
    workflow,
    executor,
    currentNode: workflow.getEntryNode(),
    state,
    status: "running",
    startTime: new Date().toISOString(),
    initialState: { ...state }, // maybe remove ? what is it used for ?
  };

  return executeLoop(run, options.onEvent);
}

export async function resumeWorkflow(
  storedRun: StoredRun,
  options: ResumeOptions,
): Promise<RunResult> {
  if (!storedRun.workflowFile) {
    throw new Error("Can not resume run without workflowFile");
  }
  if (!storedRun.executor) {
    throw new Error("Can not resume run without executor");
  }
  if (!storedRun.currentNode) {
    throw new Error("Can not resume run without currentNode");
  }
  const workflow = await loadWorkflow(storedRun.workflowFile);
  // we need to know which type of executor to properly hydrate
  const executor = HostExecutor.hydrate(storedRun.executor);
  const run: Run = {
    runId: storedRun.runId,
    workflow,
    executor,
    currentNode: storedRun.currentNode,
    state: { ...storedRun.currentState },
    status: storedRun.status,
    startTime: storedRun.startTime,
    initialState: { ...storedRun.initialState },
    resumeInput: options.input,
    interruptMetadata: storedRun.interruptMetadata,
  };

  return executeLoop(run, options.onEvent);
}

async function executeLoop(
  run: Run,
  onEvent?: (event: WorkflowEvent) => void,
): Promise<RunResult> {
  const { workflow, executor, state } = run;
  const store = getStore();

  const userEmit = onEvent ?? (() => {});
  const emit = (event: WorkflowEvent) => {
    store.appendEvent(run.runId, event);
    userEmit(event);
  };

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
      let nodeResult: NodeResult;
      if (nodeDef.type === "scripted") {
        //todo: scripted nodes should be able to interrupt.
        // either by returning interrupt or maybe throwing
        const partial = await nodeDef.fn(ctx);
        nodeResult = { state: partial };
      } else if (nodeDef.type === "interrupt") {
        nodeResult = executeInterruptNode(run.resumeInput || "", ctx, nodeDef);
      } else {
        const resume = {
          input: run.resumeInput,
          nodeData: run.interruptMetadata?.nodeData,
        };
        nodeResult = await executeClaudeNode(
          nodeDef,
          run.currentNode,
          ctx,
          executor,
          emit,
          resume,
        );
      }

      // detect interruption
      if (nodeResult.interrupted) {
        run.status = "interrupted";
        run.endTime = new Date().toISOString();
        run.interruptMetadata = nodeResult.interruptMetadata;
        store.persistRun(run);
        emit({
          type: "node:interrupted",
          nodeId: run.currentNode,
        });
        emit({
          type: "run:interrupted",
          runId: run.runId,
          status: "interrupted",
        });
        return { runId: run.runId, status: run.status, state: run.state };
      }

      // if might not be needed
      if (nodeResult.state) {
        Object.assign(state, nodeResult.state);
      }

      emit({
        type: "node:end",
        nodeId: run.currentNode,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      run.status = "failed";
      run.endTime = new Date().toISOString();
      store.persistRun(run);
      // cleanup executor ?
      emit({ type: "node:error", nodeId: run.currentNode, error: message });
      return { runId: run.runId, status: run.status, state: run.state };
    }

    run.currentNode = resolveNextNode(workflow, run.currentNode, ctx);
  }

  run.status = "completed";
  run.endTime = new Date().toISOString();
  run.finalState = { ...state }; // remove finalState ? what is it used for ?
  store.persistRun(run);
  await executor.cleanup();
  emit({ type: "run:complete", runId: run.runId, status: run.status });

  return { runId: run.runId, status: run.status, state: run.state };
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
