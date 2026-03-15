import { defineCommand } from "citty";
import { loadWorkflow } from "../../workflow/loader.js";
import { runWorkflow } from "../../workflow/engine.js";
import { createRenderer } from "../renderer.js";
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
    const onEvent: (event: WorkflowEvent) => void =
      args.output === "json"
        ? (event) => console.log(JSON.stringify(event))
        : createRenderer();

    const result = await runWorkflow(workflow, {
      onEvent,
      workspace: args.workspace,
    });

    if (result.status === "failed") {
      process.exit(1);
    }
  },
});
