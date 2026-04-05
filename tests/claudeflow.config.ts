import { defineConfig } from "@lipsumar/claudeflow";

export default defineConfig({
  anthropic: {
    apiKey: "test-dummy-key",
  },
  squid: {
    allowedDomains: ["github.com"],
  },
  store: {
    path: "./data/runs",
  },
});
