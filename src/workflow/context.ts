import { $ } from "zx";
import type { WorkflowEvent, RunContext, Logger } from "./types.js";

export function createRunContext({
  runId,
  nodeId,
  workspace,
  state,
  emit,
}: {
  runId: string;
  nodeId: string;
  workspace: string;
  state: Record<string, unknown>;
  emit: (event: WorkflowEvent) => void;
}): RunContext {
  const log = createLogger(nodeId, emit);
  const shell = $({
    cwd: workspace,
    quiet: true,
    log: (entry) => {
      if (entry.kind === "cmd") log.info(`$ ${entry.cmd}`);
      else if (entry.kind === "stdout") log.info(entry.data.toString());
      else if (entry.kind === "stderr") log.error(entry.data.toString());
    },
  });
  const ctx: RunContext = {
    runId,
    workspace,
    state,
    log,
    $: shell,
  };
  return ctx;
}

function createLogger(nodeId: string, emit: (event: WorkflowEvent) => void) {
  const logger = ["debug", "info", "warn", "error"].reduce(
    (acc, level) => {
      acc[level] = (message: string) =>
        emit({
          type: "node:chunk",
          nodeId,
          chunk: {
            level: level as "debug" | "info" | "warn" | "error",
            message,
          },
        });
      return acc;
    },
    {} as Record<string, (message: string) => void>,
  );
  return logger as unknown as Logger;
}
