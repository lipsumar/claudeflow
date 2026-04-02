import { defineCommand } from "citty";
import { resumeWorkflow } from "../../workflow/engine.js";
import { createRenderer } from "../renderer.js";
import type { WorkflowEvent } from "../../workflow/types.js";
import { getStore } from "../../store/run-store.js";
import { promptUser } from "../utils.js";

export default defineCommand({
  meta: {
    name: "resume",
    description: "Resume a run",
  },
  args: {
    runId: {
      type: "positional",
      description: "Run id to resume",
      required: true,
    },
    input: {
      type: "string",
      description: "Input to provide (e.g., answer to a HITL question)",
    },
    output: {
      type: "string",
      description: "Output format: pretty (default) or json",
    },
  },
  async run({ args }) {
    const store = getStore();
    const run = store.get(args.runId);
    if (!run) {
      throw new Error(`Run ${args.runId} not found`);
    }

    const onEvent: (event: WorkflowEvent) => void =
      args.output === "json"
        ? (event) => console.log(JSON.stringify(event))
        : createRenderer();

    let input = args.input;

    // If no input provided and the interruption is HITL, prompt interactively
    if (
      input === undefined &&
      run.interruptMetadata?.reason === "input-required" &&
      run.interruptMetadata.question
    ) {
      if (!process.stdin.isTTY) {
        console.error(
          "HITL question requires input. Use --input or run interactively.",
        );
        console.error(`Question: ${run.interruptMetadata.question}`);
        process.exit(1);
      }

      console.log(`\nQuestion: ${run.interruptMetadata.question}`);
      input = await promptUser("Your answer: ");
    }

    const result = await resumeWorkflow(run, {
      onEvent,
      input,
    });

    if (result.status === "failed") {
      process.exit(1);
    }
  },
});
