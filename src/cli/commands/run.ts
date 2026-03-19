import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineCommand } from "citty";
import { loadWorkflow } from "../../workflow/loader.js";
import { runWorkflow } from "../../workflow/engine.js";
import { createRenderer } from "../renderer.js";
import { HostExecutor } from "../../executor/host.js";
import type { WorkflowEvent } from "../../workflow/types.js";

export default defineCommand({
  meta: {
    name: "run",
    description: "Run a workflow defined in a TypeScript/JavaScript file",
  },
  args: {
    file: {
      type: "positional",
      description: "Path to the workflow file (default export)",
      required: true,
    },
    workspace: {
      type: "string",
      description: "Path to the workspace directory",
    },
    output: {
      type: "string",
      description: "Output format: pretty (default) or json",
    },
  },
  async run({ args }) {
    const workflow = await loadWorkflow(args.file);
    const executor = new HostExecutor({
      workspace: args.workspace ?? join(tmpdir(), `claudeflow-${randomUUID()}`),
    });

    const onEvent: (event: WorkflowEvent) => void =
      args.output === "json"
        ? (event) => console.log(JSON.stringify(event))
        : createRenderer();

    const result = await runWorkflow(workflow, {
      executor,
      onEvent,
    });

    if (result.status === "failed") {
      process.exit(1);
    }
  },
});
