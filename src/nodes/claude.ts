import { getConfig } from "../config.js";
import type { Executor } from "../executor/types.js";
import type {
  ClaudeNodeDef,
  NodeResult,
  RunContext,
  WorkflowEvent,
} from "../workflow/types.js";

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

  return new Promise((resolve, reject) => {
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

    let buffer = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const message = JSON.parse(line);
          emit({
            type: "node:chunk",
            nodeId,
            chunk: { type: "claude", message },
          });
        } catch {
          // Incomplete JSON, skip
        }
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      emit({
        type: "node:chunk",
        nodeId,
        chunk: { level: "error", message: chunk.toString() },
      });
    });

    child.on("error", reject);

    child.on("close", (code) => {
      if (buffer.trim()) {
        try {
          const message = JSON.parse(buffer);
          emit({
            type: "node:chunk",
            nodeId,
            chunk: { type: "claude", message },
          });
        } catch {
          // ignore
        }
      }

      if (code === 0) {
        resolve({});
      } else {
        reject(new Error(`claude process exited with code ${code}`));
      }
    });
  });
}
