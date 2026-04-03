import { defineConfig } from "@lipsumar/claudeflow";

export default defineConfig({
  squid: {
    allowedDomains: ["github.com"],
  },
  store: {
    path: "./data/runs",
  },
});
