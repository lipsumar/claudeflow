import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { defineCommand } from "citty";
import { loadWorkflow } from "../../workflow/loader.js";
import { runWorkflow } from "../../workflow/engine.js";
import { createRenderer } from "../renderer.js";
import { HostExecutor } from "../../executor/host.js";
import type { WorkflowEvent } from "../../workflow/types.js";
import type { Executor } from "../../executor/types.js";
import { DockerExecutor } from "../../executor/docker.js";

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

    let executor: Executor;
    const workspace =
      args.workspace ?? join(tmpdir(), `claudeflow-${randomUUID()}`);

    if (workflow.executor === "host") {
      executor = new HostExecutor({ workspace });
    } else if (workflow.executor === "docker") {
      if (!workflow.dockerImage) {
        throw new Error("Docker image is required for docker executor");
      }
      executor = new DockerExecutor({ workspace, image: workflow.dockerImage });
    } else {
      throw new Error(`Unsupported executor: ${workflow.executor}`);
    }

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
