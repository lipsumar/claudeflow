import { spawn } from "node:child_process";
import { getConfig } from "../../config.js";
import type { ClaudeExecutor } from "../types.js";

/**
 * The simplest executor: runs claude code directly on the host machine.
 * This is not secure and should not be used in production!
 * This is mostly useful for testing and development.
 */
export const claudeExecutorHost: ClaudeExecutor = async (
  def,
  nodeId,
  ctx,
  emit,
) => {
  const prompt =
    typeof def.prompt === "function" ? def.prompt(ctx) : def.prompt;

  return new Promise((resolve, reject) => {
    const config = getConfig();
    const env = {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      ANTHROPIC_API_KEY: config.anthropic.apiKey,
      ...def.env,
    };
    const child = spawn(
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
        cwd: ctx.workspace,
        env,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let buffer = "";

    child.stdout.on("data", (chunk: Buffer) => {
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

    child.stderr.on("data", (chunk: Buffer) => {
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
        resolve();
      } else {
        reject(new Error(`claude process exited with code ${code}`));
      }
    });
  });
};
