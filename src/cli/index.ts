#!/usr/bin/env node

import { defineCommand, runMain } from "citty";

const { version } = require("../../package.json");

const main = defineCommand({
  meta: {
    name: "claudeflow",
    description: "Deterministic workflows for Claude Code",
    version,
  },
  run() {
    console.log("claudeflow CLI - not yet implemented");
  },
});

runMain(main);
