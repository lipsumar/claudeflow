import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["./src/index.ts", "./src/cli/index.ts"],
  deps: {
    neverBundle: ["@anthropic-ai/claude-agent-sdk", "@anthropic-ai/sdk"],
  },
});
