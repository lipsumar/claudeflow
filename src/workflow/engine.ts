// Workflow DAG executor
// Custom engine: walks the node graph, manages state, emits streaming events.
// No external graph framework — the execution model (filesystem side-effects
// + shallow state merge) is simple enough to own directly.

import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { $ } from "zx";
import { getConfig } from "../config.js";
import type {
  ClaudeNodeDef,
  RunContext,
  RunOptions,
  RunResult,
  State,
  WorkflowEvent,
} from "./types.js";
import { Workflow } from "./workflow.js";

const END = "__end__";

export async function runWorkflow(
  workflow: Workflow,
  options: RunOptions = {},
): Promise<RunResult> {
  const runId = randomUUID();
  const config = getConfig();
  const workspace =
    options.workspace ?? resolve(config.sandbox.workspaceRoot, runId);

  mkdirSync(workspace, { recursive: true });

  const state: State = { ...(options.initialState ?? {}) };
  const emit = options.onEvent ?? (() => {});

  const entryNode = workflow.getEntryNode();
  let current: string = entryNode;
  let status: "completed" | "failed" = "completed";

  while (current !== END) {
    const nodeDef = workflow.getNode(current);
    const log = (message: string) =>
      emit({ type: "node:chunk", nodeId: current, chunk: message });
    const shell = $({
      cwd: workspace,
      quiet: true,
      log: (entry) => {
        if (entry.kind === "cmd") log(`$ ${entry.cmd}`);
        else if (entry.kind === "stdout") log(entry.data.toString());
        else if (entry.kind === "stderr") log(entry.data.toString());
      },
    });
    const ctx: RunContext = {
      runId,
      workspace,
      state,
      log,
      $: shell,
    };

    emit({ type: "node:start", nodeId: current, runId });
    const start = Date.now();

    try {
      if (nodeDef.type === "scripted") {
        const partial = await nodeDef.fn(ctx);
        Object.assign(state, partial);
      } else {
        await executeClaudeNode(nodeDef, ctx, emit);
      }

      emit({
        type: "node:end",
        nodeId: current,
        durationMs: Date.now() - start,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      emit({ type: "node:error", nodeId: current, error: message });
      status = "failed";
      break;
    }

    current = resolveNextNode(workflow, current, ctx);
  }

  emit({ type: "run:complete", runId, status });
  return { runId, status, state };
}

function resolveNextNode(
  workflow: Workflow,
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

async function executeClaudeNode(
  _def: ClaudeNodeDef,
  _ctx: RunContext,
  _emit: (event: WorkflowEvent) => void,
): Promise<void> {
  // TODO: implement container lifecycle
  // 1. Write Squid ACL for allowed domains
  // 2. Create + start container on run network
  // 3. Exec `claude --print "<prompt>"`, stream stdout as node:chunk
  // 4. Wait for exit
  // 5. Remove container
  // 6. Remove ACL entry
  throw new Error(
    "Claude node execution not yet implemented (requires sandbox infrastructure)",
  );
}
