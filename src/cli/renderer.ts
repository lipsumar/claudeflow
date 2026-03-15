import chalk from "chalk";
import ora, { type Ora } from "ora";
import type { WorkflowEvent } from "../workflow/types.js";

export function createRenderer(): (event: WorkflowEvent) => void {
  let spinner: Ora | null = null;
  let startTime = 0;

  function elapsed(): string {
    return `${((Date.now() - startTime) / 1000).toFixed(1)}s`;
  }

  function startSpinner(nodeId: string) {
    startTime = Date.now();
    spinner = ora({
      text: chalk.dim(elapsed()),
      indent: 2,
      discardStdin: false,
    }).start();
  }

  function updateSpinner() {
    if (spinner) {
      spinner.text = chalk.dim(elapsed());
    }
  }

  let spinnerInterval: ReturnType<typeof setInterval> | null = null;

  return (event: WorkflowEvent) => {
    switch (event.type) {
      case "node:start": {
        console.log(`\n▶ ${event.nodeId}`);
        startSpinner(event.nodeId);
        spinnerInterval = setInterval(updateSpinner, 100);
        break;
      }

      case "node:chunk": {
        if (!spinner) break;
        // Persist current spinner line, print the log, restart spinner
        spinner.stop();
        const msg =
          typeof event.chunk === "string"
            ? event.chunk
            : formatLogLine(event.chunk);
        console.log(msg);
        spinner = ora({
          text: chalk.dim(elapsed()),
          indent: 2,
          discardStdin: false,
        }).start();
        break;
      }

      case "node:end": {
        if (spinnerInterval) {
          clearInterval(spinnerInterval);
          spinnerInterval = null;
        }
        if (spinner) {
          spinner.succeed(chalk.green(`done (${elapsed()})`));
          spinner = null;
        }
        break;
      }

      case "node:error": {
        if (spinnerInterval) {
          clearInterval(spinnerInterval);
          spinnerInterval = null;
        }
        if (spinner) {
          spinner.fail(chalk.red(event.error));
          spinner = null;
        }
        break;
      }

      case "run:complete": {
        console.log();
        if (event.status === "completed") {
          console.log(chalk.green(`✔ Run ${event.runId} completed`));
        } else {
          console.log(chalk.red(`✖ Run ${event.runId} failed`));
        }
        break;
      }
    }
  };
}

function formatLogLine(chunk: {
  level: "debug" | "info" | "warn" | "error";
  message: string;
}): string {
  switch (chunk.level) {
    case "debug":
      return chalk.dim(chunk.message);
    case "info":
      return chalk.blue(chunk.message);
    case "warn":
      return chalk.yellow(chunk.message);
    case "error":
      return chalk.red(chunk.message);
  }
}
