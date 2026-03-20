import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeProcessEvents {
  message: [message: SDKMessage];
  stderr: [data: string];
  error: [err: Error];
  close: [code: number | null];
}

/**
 * Wraps a child process running `claude --output-format stream-json`.
 * Handles JSON-line buffering and emits parsed messages.
 */
export class ClaudeProcess extends EventEmitter<ClaudeProcessEvents> {
  constructor(child: ChildProcess) {
    super();

    let buffer = "";

    child.stdout!.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        this.parseLine(line);
      }
    });

    child.stderr!.on("data", (chunk: Buffer) => {
      this.emit("stderr", chunk.toString());
    });

    child.on("error", (err) => {
      this.emit("error", err);
    });

    child.on("close", (code) => {
      // Flush remaining buffer
      if (buffer.trim()) {
        this.parseLine(buffer);
        buffer = "";
      }
      this.emit("close", code);
    });
  }

  private parseLine(line: string) {
    if (!line.trim()) return;
    try {
      const message = JSON.parse(line);
      this.emit("message", message);
    } catch {
      // Incomplete or invalid JSON, skip
    }
  }
}
