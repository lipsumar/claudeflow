import type { ClaudeNodeDef } from "../workflow/types.js";

export interface ClaudeNodeOptions {
  image: string;
  prompt: ClaudeNodeDef["prompt"];
  allowedDomains?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export function claudeNode(options: ClaudeNodeOptions): ClaudeNodeDef {
  return {
    type: "claude",
    image: options.image,
    prompt: options.prompt,
    allowedDomains: options.allowedDomains ?? [],
    env: options.env ?? {},
    timeoutMs: options.timeoutMs ?? 300_000,
  };
}
