export interface ClaudeflowConfig {
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

export function defineConfig(config: ClaudeflowConfig): ClaudeflowConfig {
  throw new Error("not implemented");
}
