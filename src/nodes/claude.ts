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
import { z, type ZodType } from "zod";

export interface ClaudeNodeOptions {
  prompt: ClaudeNodeDef["prompt"];
  env?: Record<string, string>;
  timeoutMs?: number;
  model?: string;
  storeOutputAs?: string | { key: string; schema: ZodType };
}

export function claudeNode(options: ClaudeNodeOptions): ClaudeNodeDef {
  return {
    type: "claude",
    prompt: options.prompt,
    env: options.env ?? {},
    timeoutMs: options.timeoutMs ?? 300_000,
    model: options.model ?? "sonnet",
    storeOutputAs: options.storeOutputAs,
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

  const nodeStartTime = Date.now();

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
    ANTHROPIC_API_KEY: config.anthropic.apiKey,
    ...def.env,
  };

  let jsonSchema: string | null = null;
  if (def.storeOutputAs && typeof def.storeOutputAs !== "string") {
    const { $schema, ...schema } = z.toJSONSchema(def.storeOutputAs.schema);
    jsonSchema = JSON.stringify(schema);
  }

  const child = executor.spawn(
    "claude",
    buildArgs({
      prompt,
      model: def.model,
      sessionId,
      jsonSchema,
    }),
    {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const proc = new ClaudeProcess(child);

  let question: string | null = null;
  let resultOutput: string | null = null;
  let structuredOutput: unknown = null;
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

      if (message.type === "result" && message.subtype === "success") {
        resultOutput = message.result;
        if (message.structured_output !== undefined) {
          structuredOutput = (message as any).structured_output;
        }
      }

      //TODO handle non success result
    });

    proc.on("stderr", (data) => {
      emit({
        type: "node:chunk",
        nodeId,
        chunk: { level: "error", message: data },
      });
    });

    proc.on("error", reject);

    proc.on("close", async (code) => {
      // Emit HTTP log after node completes
      const nodeEndTime = Date.now();
      try {
        const requests = await executor.getHttpLog(nodeStartTime, nodeEndTime);
        if (requests.length > 0) {
          emit({ type: "node:http", nodeId, requests });
        }
      } catch {
        // best effort — don't fail the node over log parsing
      }

      if (code === 0) {
        let result: NodeResult = { state: {} };
        if (question) {
          result.interrupted = true;
          result.interruptMetadata = {
            reason: "input-required",
            nodeData: { sessionId },
            question,
          };
        }
        if (
          def.storeOutputAs &&
          (resultOutput !== null || structuredOutput !== null)
        ) {
          if (typeof def.storeOutputAs === "string") {
            result.state![def.storeOutputAs] = resultOutput;
          } else {
            result.state![def.storeOutputAs.key] = structuredOutput;
          }
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
  jsonSchema,
}: {
  prompt: string;
  model: string;
  sessionId: string | null;
  jsonSchema: string | null;
}) {
  const args = [
    "--print",
    "--model",
    model,
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
  ];
  if (jsonSchema) {
    args.push("--json-schema", jsonSchema);
  }
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
