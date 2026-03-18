import { createJiti } from "jiti";
import { resolve } from "node:path";
import { existsSync } from "node:fs";

export interface ClaudeflowConfig {
  anthropic?: {
    apiKey?: string;
  };
  squid?: {
    containerName?: string;
    port?: number;
  };
  sandbox?: {
    defaultImage?: string;
    defaultTimeoutMs?: number;
    workspaceRoot?: string;
  };
  store?: {
    path?: string;
  };
}

export interface ResolvedConfig {
  anthropic: {
    apiKey: string;
  };
  squid: {
    containerName: string;
    port: number;
  };
  sandbox: {
    defaultImage: string;
    defaultTimeoutMs: number;
    workspaceRoot: string;
  };
  store: {
    path: string;
  };
}

export const defaultConfig: ResolvedConfig = {
  anthropic: {
    apiKey: "",
  },
  squid: {
    containerName: "claudeflow-squid",
    port: 3128,
  },
  sandbox: {
    defaultImage: "claudeflow-sandbox:latest",
    defaultTimeoutMs: 300_000,
    workspaceRoot: "/tmp/claudeflow/runs",
  },
  store: {
    path: "~/.claudeflow/runs.db",
  },
};

export function defineConfig(config: ClaudeflowConfig): ClaudeflowConfig {
  return config;
}

export function resolveConfig(
  overrides: ClaudeflowConfig = {},
): ResolvedConfig {
  return {
    anthropic: { ...defaultConfig.anthropic, ...overrides.anthropic },
    squid: { ...defaultConfig.squid, ...overrides.squid },
    sandbox: { ...defaultConfig.sandbox, ...overrides.sandbox },
    store: { ...defaultConfig.store, ...overrides.store },
  };
}

const CONFIG_FILES = [
  "claudeflow.config.ts",
  "claudeflow.config.js",
  "claudeflow.config.mjs",
];

export async function loadConfigFile(
  cwd: string = process.cwd(),
): Promise<ClaudeflowConfig> {
  for (const filename of CONFIG_FILES) {
    const filepath = resolve(cwd, filename);
    if (!existsSync(filepath)) continue;

    const jiti = createJiti(filepath);
    const mod = await jiti.import(filepath);
    const config = (mod as { default?: ClaudeflowConfig }).default ?? mod;
    return config as ClaudeflowConfig;
  }
  return {};
}

// --- singleton ---

let currentConfig: ResolvedConfig | null = null;

export async function initConfig(
  overrides?: ClaudeflowConfig,
): Promise<ResolvedConfig> {
  const fileConfig = await loadConfigFile();
  // file-level config is the base, explicit overrides win
  const merged: ClaudeflowConfig = {
    anthropic: { ...fileConfig.anthropic, ...overrides?.anthropic },
    squid: { ...fileConfig.squid, ...overrides?.squid },
    sandbox: { ...fileConfig.sandbox, ...overrides?.sandbox },
    store: { ...fileConfig.store, ...overrides?.store },
  };
  currentConfig = resolveConfig(merged);
  return currentConfig;
}

export function getConfig(): ResolvedConfig {
  if (!currentConfig) {
    throw new Error(
      "Config not initialized. Call initConfig() before getConfig().",
    );
  }
  return currentConfig;
}

/** Reset config (useful for tests). */
export function resetConfig(): void {
  currentConfig = null;
}
