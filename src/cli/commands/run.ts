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
import { parseRawInputs, promptUser } from "../utils.js";

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

    const initialState = await resolveInputs(workflow);

    const result = await runWorkflow(workflow, {
      executor,
      onEvent,
      initialState,
    });

    if (result.status === "failed") {
      process.exit(1);
    }
  },
});

// TODO: make sure we're in TTY env to prompt
async function resolveInputs(
  workflow: Awaited<ReturnType<typeof loadWorkflow>>,
): Promise<Record<string, unknown>> {
  if (!workflow.inputs) return {};

  const rawInputs = parseRawInputs();
  const shape = workflow.inputs.shape;
  const coerced: Record<string, unknown> = {};
  for (const [key, schema] of Object.entries(shape)) {
    const s = schema as {
      type: string;
      def?: { innerType?: { type: string } };
    };
    const type = s.type === "optional" ? s.def!.innerType!.type : s.type;
    const raw = rawInputs[key] ?? (await promptUser(`${key} (${type}): `));
    if (type === "number") {
      const n = Number(raw);
      if (Number.isNaN(n))
        throw new Error(`Input "${key}" must be a number, got "${raw}"`);
      coerced[key] = n;
    } else if (type === "boolean") {
      coerced[key] = raw === "true" || raw === "1";
    } else {
      coerced[key] = raw;
    }
  }

  return workflow.inputs.parse(coerced);
}
