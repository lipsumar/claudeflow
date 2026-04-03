#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import { initConfig } from "../config.js";
import _ from "lodash";
const { version } = require("../../package.json");

const main = defineCommand({
  meta: {
    name: "claudeflow",
    description: "Deterministic workflows for Claude Code",
    version,
  },
  args: {
    config: {
      type: "string",
      description:
        "Config override (eg. store.path=./data/runs) - separate multiple with commas",
    },
  },
  async setup({ args }) {
    const overrides: Record<string, any> = {};
    if (args.config) {
      const pairs = args.config.split(",").map((s) => s.trim());
      for (const pair of pairs) {
        const [key, value] = pair.split("=");
        if (!key || value === undefined) {
          console.error(`Invalid config override: ${pair}`);
          process.exit(1);
        }
        // TODO: validate keys against config schema
        // TODO: cast values to correct types based on schema
        _.set(overrides, key, value);
      }
    }
    await initConfig(overrides);
  },
  subCommands: {
    config: () => import("./commands/config.js").then((m) => m.default),
    run: () => import("./commands/run.js").then((m) => m.default),
    runs: () => import("./commands/runs.js").then((m) => m.default),
    resume: () => import("./commands/resume.js").then((m) => m.default),
    proxy: () => import("./commands/proxy.js").then((m) => m.default),
  },
});

runMain(main);
