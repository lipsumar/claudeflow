import { createJiti } from "jiti";
import { dirname, resolve, parse as parsePath, basename } from "node:path";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import _ from "lodash";

// all fields containing paths must be
// fully resolved in resolvePaths()

export interface ClaudeflowConfig {
  root?: boolean;
  anthropic?: {
    apiKey?: string;
  };
  squid?: {
    containerName?: string;
    port?: number;
    allowedDomains?: string[];
  };
  authProxy?: {
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
    allowedDomains: string[];
  };
  authProxy: {
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
    allowedDomains: [],
  },
  authProxy: {
    containerName: "claudeflow-auth-proxy",
    port: 4128,
  },
  sandbox: {
    defaultImage: "claudeflow-sandbox:latest",
    defaultTimeoutMs: 300_000,
    workspaceRoot: "/tmp/claudeflow/runs",
  },
  store: {
    path: "~/.claudeflow/runs",
  },
};

export function defineConfig(config: ClaudeflowConfig): ClaudeflowConfig {
  return config;
}

export function resolveConfig(
  overrides: ClaudeflowConfig = {},
): ResolvedConfig {
  const config = {
    anthropic: { ...defaultConfig.anthropic, ...overrides.anthropic },
    squid: { ...defaultConfig.squid, ...overrides.squid },
    authProxy: { ...defaultConfig.authProxy, ...overrides.authProxy },
    sandbox: { ...defaultConfig.sandbox, ...overrides.sandbox },
    store: { ...defaultConfig.store, ...overrides.store },
  };
  return config;
}

const CONFIG_FILES = [
  "claudeflow.config.ts",
  "claudeflow.config.js",
  "claudeflow.config.mjs",
];

/** Load a single config file from a directory (first match wins among extensions). */
export async function loadConfigFromDir(
  dir: string,
): Promise<ClaudeflowConfig> {
  for (const filename of CONFIG_FILES) {
    const filepath = resolve(dir, filename);
    if (!existsSync(filepath)) continue;

    const jiti = createJiti(filepath);
    const mod = await jiti.import(filepath);
    const config = (mod as { default?: ClaudeflowConfig }).default ?? mod;

    return resolvePaths(config as ClaudeflowConfig, dirname(filepath));
  }
  return {};
}

export function resolvePaths(config: ClaudeflowConfig, dir: string) {
  const resolved = _.merge({}, config);
  if (resolved.store?.path) {
    resolved.store.path = resolve(dir, resolved.store.path);
  }
  return resolved;
}

/**
 * Walk up from `fromDir` collecting config files, then merge them.
 * Resolution order (lowest to highest priority):
 *   1. Home config (~/.claudeflow/claudeflow.config.*)
 *   2. Ancestor directories (from highest ancestor down to parent of fromDir)
 *   3. fromDir itself
 *   4. Programmatic overrides
 *
 * Walking stops early if a config with `root: true` is found.
 */
export async function loadConfigFile(
  fromDir?: string,
): Promise<ClaudeflowConfig> {
  const homeConfigDir = resolve(homedir(), ".claudeflow");
  const startDir = fromDir ? resolve(fromDir) : process.cwd();

  // 1. Home config (always loaded as base)
  const homeConfig = await loadConfigFromDir(homeConfigDir);

  // 2. Walk up from startDir, collecting configs
  const ancestors: Array<{ dir: string; config: ClaudeflowConfig }> = [];
  let dir = startDir;
  while (true) {
    // Skip home config dir — it's already loaded separately
    if (dir !== homeConfigDir) {
      const config = await loadConfigFromDir(dir);
      ancestors.push({ dir, config });
      if (config.root) break;
    }

    const parent = dirname(dir);
    if (parent === dir) break; // reached filesystem root
    dir = parent;
  }

  // Merge: home → farthest ancestor → … → startDir (closest wins)
  let merged: ClaudeflowConfig = homeConfig;
  for (let i = ancestors.length - 1; i >= 0; i--) {
    merged = _.merge({}, merged, ancestors[i]!.config);
  }

  return merged;
}

// --- singleton ---

let currentConfig: ResolvedConfig | null = null;

export async function initConfig(
  overrides?: ClaudeflowConfig,
  fromDir?: string,
): Promise<ResolvedConfig> {
  const fileConfig = await loadConfigFile(fromDir);
  currentConfig = resolveConfig(_.merge({}, fileConfig, overrides ?? {}));
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
