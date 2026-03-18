import { defineCommand } from "citty";
import { getStore } from "../../store/run-store.js";

const list = defineCommand({
  meta: {
    name: "list",
    description: "List recent runs",
  },
  args: {
    workflow: {
      type: "string",
      description: "Filter by workflow name",
    },
    limit: {
      type: "string",
      description: "Maximum number of runs to show (default: 20)",
    },
  },
  run({ args }) {
    const store = getStore();
    const runs = store.list({
      workflow: args.workflow,
      limit: args.limit ? parseInt(args.limit, 10) : 20,
    });

    if (runs.length === 0) {
      console.log("No runs found.");
      return;
    }

    for (const run of runs) {
      const time = run.startTime.replace("T", " ").replace(/\.\d+Z$/, "Z");
      console.log(
        `${run.runId}  ${run.status.padEnd(9)}  ${run.workflowName}  ${time}`,
      );
    }
  },
});

const show = defineCommand({
  meta: {
    name: "show",
    description: "Show details of a specific run",
  },
  args: {
    runId: {
      type: "positional",
      description: "Run ID",
      required: true,
    },
  },
  run({ args }) {
    const store = getStore();
    const run = store.get(args.runId);

    if (!run) {
      console.error(`Run not found: ${args.runId}`);
      process.exit(1);
    }

    console.log(JSON.stringify(run, null, 2));
  },
});

const logs = defineCommand({
  meta: {
    name: "logs",
    description: "Show event logs for a specific run",
  },
  args: {
    runId: {
      type: "positional",
      description: "Run ID",
      required: true,
    },
  },
  run({ args }) {
    const store = getStore();
    const events = store.getEvents(args.runId);

    if (events.length === 0) {
      console.error(`No events found for run: ${args.runId}`);
      process.exit(1);
    }

    for (const event of events) {
      console.log(JSON.stringify(event));
    }
  },
});

export default defineCommand({
  meta: {
    name: "runs",
    description: "Manage and inspect workflow runs",
  },
  subCommands: {
    list,
    show,
    logs,
  },
});
