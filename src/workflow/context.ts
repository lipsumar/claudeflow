import type { Executor } from "../executor/types.js";
import type { WorkflowEvent, RunContext, Logger } from "./types.js";

export function createRunContext({
  runId,
  nodeId,
  executor,
  state,
  emit,
}: {
  runId: string;
  nodeId: string;
  executor: Executor;
  state: Record<string, unknown>;
  emit: (event: WorkflowEvent) => void;
}): RunContext {
  const log = createLogger(nodeId, emit);
  const ctx: RunContext = {
    runId,
    workspace: executor.workspace,
    state,
    log,
    async exec(cmd, args) {
      log.info(`$ ${cmd} ${args.join(" ")}`);
      const result = await executor.exec(cmd, args);
      if (result.stdout) log.info(result.stdout);
      if (result.stderr) log.error(result.stderr);
      return result;
    },
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
