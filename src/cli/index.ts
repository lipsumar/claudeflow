#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import { initConfig } from "../config.js";

const { version } = require("../../package.json");

const main = defineCommand({
  meta: {
    name: "claudeflow",
    description: "Deterministic workflows for Claude Code",
    version,
  },
  async setup() {
    await initConfig();
  },
  subCommands: {
    config: () => import("./commands/config.js").then((m) => m.default),
    run: () => import("./commands/run.js").then((m) => m.default),
  },
});

runMain(main);
