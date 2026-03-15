import { defineCommand } from "citty";
import { loadWorkflow } from "../../workflow/loader.js";
import { runWorkflow } from "../../workflow/engine.js";
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
  },
  async run({ args }) {
    const workflow = await loadWorkflow(args.file);

    const onEvent = (event: WorkflowEvent) => {
      switch (event.type) {
        case "node:start":
          console.log(`▶ ${event.nodeId}`);
          break;
        case "node:chunk":
          process.stdout.write(event.chunk);
          break;
        case "node:end":
          console.log(`✓ ${event.nodeId} (${event.durationMs}ms)`);
          break;
        case "node:error":
          console.error(`✗ ${event.nodeId}: ${event.error}`);
          break;
        case "run:complete":
          console.log(`\nRun ${event.runId} ${event.status}`);
          break;
      }
    };

    const result = await runWorkflow(workflow, {
      onEvent,
      workspace: args.workspace,
    });

    if (result.status === "failed") {
      process.exit(1);
    }
  },
});
