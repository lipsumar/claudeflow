import { getConfig } from "../config.js";
import type { Executor } from "../executor/types.js";
import type {
  ClaudeNodeDef,
  NodeResult,
  RunContext,
  WorkflowEvent,
} from "../workflow/types.js";
import { ClaudeProcess } from "./claude-process.js";

export interface ClaudeNodeOptions {
  image: string;
  prompt: ClaudeNodeDef["prompt"];
  allowedDomains?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  model?: string;
}

export function claudeNode(options: ClaudeNodeOptions): ClaudeNodeDef {
  return {
    type: "claude",
    image: options.image,
    prompt: options.prompt,
    allowedDomains: options.allowedDomains ?? [],
    env: options.env ?? {},
    timeoutMs: options.timeoutMs ?? 300_000,
    model: options.model ?? "sonnet",
  };
}

export async function executeClaudeNode(
  def: ClaudeNodeDef,
  nodeId: string,
  ctx: RunContext,
  executor: Executor,
  emit: (event: WorkflowEvent) => void,
): Promise<NodeResult> {
  if (!getConfig().anthropic.apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  const prompt =
    typeof def.prompt === "function" ? def.prompt(ctx) : def.prompt;

  const config = getConfig();
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ANTHROPIC_API_KEY: config.anthropic.apiKey,
    ...def.env,
  };

  const child = executor.spawn(
    "claude",
    [
      "--print",
      "--model",
      def.model,
      "--output-format",
      "stream-json",
      "--verbose",
      prompt,
    ],
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const proc = new ClaudeProcess(child);

  return new Promise((resolve, reject) => {
    proc.on("message", (message) => {
      emit({
        type: "node:chunk",
        nodeId,
        chunk: { type: "claude", message },
      });
    });

    proc.on("stderr", (data) => {
      emit({
        type: "node:chunk",
        nodeId,
        chunk: { level: "error", message: data },
      });
    });

    proc.on("error", reject);

    proc.on("close", (code) => {
      if (code === 0) {
        resolve({});
      } else {
        reject(new Error(`claude process exited with code ${code}`));
      }
    });
  });
}
