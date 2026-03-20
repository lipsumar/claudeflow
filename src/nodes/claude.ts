import { getConfig } from "../config.js";
import type { Executor } from "../executor/types.js";
import type {
  ClaudeNodeDef,
  NodeResult,
  RunContext,
  WorkflowEvent,
} from "../workflow/types.js";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
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
  resume: {
    input?: string;
    nodeData?: any;
  },
): Promise<NodeResult> {
  if (!getConfig().anthropic.apiKey) {
    throw new Error("Anthropic API key not configured");
  }

  let sessionId: string | null =
    resume.nodeData && resume.nodeData.sessionId
      ? resume.nodeData.sessionId
      : null;
  const isResume = sessionId !== null;

  let prompt: string;
  if (isResume) {
    if (!resume.input) {
      throw new Error("claude node can not resume without input");
    }
    prompt = resume.input;
  } else {
    prompt = typeof def.prompt === "function" ? def.prompt(ctx) : def.prompt;
  }

  const config = getConfig();
  const env: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    ANTHROPIC_API_KEY: config.anthropic.apiKey,
    ...def.env,
  };

  const child = executor.spawn(
    "claude",
    buildArgs({
      prompt,
      model: def.model,
      sessionId,
    }),
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const proc = new ClaudeProcess(child);

  let question: string | null = null;
  return new Promise((resolve, reject) => {
    proc.on("message", (message) => {
      emit({
        type: "node:chunk",
        nodeId,
        chunk: { type: "claude", message },
      });

      if (containsToolUse(message, "AskUserQuestion")) {
        sessionId = message.session_id;
        question = extractAskUserQuestion(message);
      }
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
        let result: NodeResult = {};
        if (question) {
          result.interrupted = true;
          result.interruptMetadata = {
            reason: "input-required",
            nodeData: { sessionId },
            question,
          };
        }
        resolve(result);
      } else {
        reject(new Error(`claude process exited with code ${code}`));
      }
    });
  });
}

function buildArgs({
  prompt,
  model,
  sessionId,
}: {
  prompt: string;
  model: string;
  sessionId: string | null;
}) {
  const args = [
    "--print",
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
  ];
  if (sessionId) {
    args.push("--resume", sessionId);
  }
  args.push(prompt);
  return args;
}

/**
 * Check if an SDK message contains a tool_use block with the given tool name.
 */
export function containsToolUse(
  message: SDKMessage,
  toolName: string,
): boolean {
  if (message.type !== "assistant") return false;
  const content = message.message?.content;
  if (!Array.isArray(content)) return false;
  return content.some(
    (block) => block.type === "tool_use" && block.name === toolName,
  );
}

/**
 * Extract a human-readable text from AskUserQuestion tool_use blocks,
 * including headers, questions, and suggested options.
 * Multiple questions are concatenated with blank lines.
 */
export function extractAskUserQuestion(message: SDKMessage): string | null {
  if (message.type !== "assistant") return null;
  const content = message.message?.content;
  if (!Array.isArray(content)) return null;

  const parts: string[] = [];

  for (const block of content) {
    if (block.type !== "tool_use" || block.name !== "AskUserQuestion") continue;
    const input = block.input as Record<string, unknown> | undefined;
    if (!input) continue;

    // Single question form: { question, header?, options? }
    if (typeof input.question === "string") {
      parts.push(formatQuestion(input));
    }

    // Multi-question form: { questions: [{ question, header?, options? }] }
    if (Array.isArray(input.questions)) {
      for (const q of input.questions as Record<string, unknown>[]) {
        if (typeof q.question === "string") {
          parts.push(formatQuestion(q));
        }
      }
    }
  }

  return parts.length > 0 ? parts.join("\n\n") : null;
}

function formatQuestion(q: Record<string, unknown>): string {
  const lines: string[] = [];

  if (typeof q.header === "string") {
    lines.push(`## ${q.header}`);
  }

  lines.push(q.question as string);

  if (Array.isArray(q.options)) {
    for (const opt of q.options as Record<string, unknown>[]) {
      if (typeof opt.label === "string") {
        let line = `- ${opt.label}`;
        if (typeof opt.description === "string") {
          line += `: ${opt.description}`;
        }
        lines.push(line);
      }
    }
  }

  return lines.join("\n");
}
