import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import type {
  BetaTextBlock,
  BetaThinkingBlock,
  BetaToolUseBlock,
} from "@anthropic-ai/sdk/resources/beta/messages/messages";
import chalk from "chalk";
import ora, { type Ora } from "ora";
import type {
  HttpRequestEntry,
  NodeChunk,
  WorkflowEvent,
} from "../workflow/types.js";

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
        console.log(`\n▶ ${chalk.bold(event.nodeId)}`);
        startSpinner(event.nodeId);
        spinnerInterval = setInterval(updateSpinner, 100);
        break;
      }

      case "node:chunk": {
        if (!spinner) break;
        const msg = formatChunk(event.chunk);
        if (msg === null) break;
        spinner.stop();
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

      case "node:interrupted": {
        if (spinnerInterval) {
          clearInterval(spinnerInterval);
          spinnerInterval = null;
        }
        if (spinner) {
          spinner.warn(chalk.yellow(`interrupted`));
          spinner = null;
        }
        break;
      }

      case "node:http": {
        if (event.requests.length > 0) {
          console.log(formatHttpSummary(event.requests));
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

      case "run:interrupted": {
        console.log();
        console.log(chalk.yellow(`⏸ Run ${event.runId} interrupted`));
        console.log(
          chalk.dim(`  Resume with: claudeflow resume ${event.runId}`),
        );
        break;
      }
    }
  };
}

function formatHttpSummary(requests: HttpRequestEntry[]): string {
  const allowed = requests.filter((r) => r.status === "allowed");
  const denied = requests.filter((r) => r.status === "denied");
  const lines: string[] = [];
  lines.push(
    chalk.dim(`http: ${allowed.length} allowed, ${denied.length} denied`),
  );
  for (const r of denied) {
    lines.push(chalk.red(`  ✗ ${r.domain}:${r.port}`));
  }
  return lines.join("\n");
}

function formatChunk(chunk: NodeChunk): string | null {
  if (typeof chunk === "string") return chunk;
  if ("type" in chunk && chunk.type === "claude")
    return formatClaudeMessage(chunk.message);
  if ("level" in chunk) return formatLogLine(chunk);
  return null;
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

function formatClaudeMessage(message: SDKMessage): string | null {
  switch (message.type) {
    case "assistant": {
      const lines: string[] = [];
      for (const block of message.message.content) {
        switch (block.type) {
          case "thinking": {
            const { thinking } = block as BetaThinkingBlock;
            if (thinking) lines.push(chalk.dim(thinking));
            break;
          }
          case "tool_use": {
            const { name, input } = block as BetaToolUseBlock;
            let line = chalk.cyan(`  ↳ ${name}`);
            if (input && typeof input === "object") {
              const summary = formatToolInput(
                name,
                input as Record<string, unknown>,
              );
              if (summary) line += chalk.dim(` ${summary}`);
            }
            lines.push(line);
            break;
          }
          case "text": {
            const { text } = block as BetaTextBlock;
            lines.push(text);
            break;
          }
        }
      }
      return lines.length > 0 ? lines.join("\n") : null;
    }
    case "tool_use_summary":
      return chalk.dim(`  ${message.summary}`);
    case "result":
      if (message.subtype === "success") {
        return chalk.dim(
          `cost: $${message.total_cost_usd.toFixed(4)} | ${message.duration_ms}ms`,
        );
      }
      return null;
    default:
      return null;
  }
}

function formatToolInput(
  name: string,
  input: Record<string, unknown>,
): string | null {
  switch (name) {
    case "Read":
      return input.file_path as string;
    case "Edit":
      return input.file_path as string;
    case "Write":
      return input.file_path as string;
    case "Bash":
      return `$ ${input.command}`;
    case "Glob":
      return input.pattern as string;
    case "Grep":
      return `/${input.pattern}/`;
    default:
      return null;
  }
}
