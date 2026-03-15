import { resolve } from "node:path";
import { createJiti } from "jiti";
import type { Workflow } from "./workflow.js";

export async function loadWorkflow(file: string): Promise<Workflow> {
  const filepath = resolve(file);
  const jiti = createJiti(filepath);
  const mod = await jiti.import(filepath);
  const workflow = (mod as { default?: Workflow }).default;

  // we can't use `instanceof` here because workflow may come from
  // a jiti instance, which means it may have a different prototype chain
  // than the Workflow class in this module.
  if (
    !workflow ||
    typeof workflow.addNode !== "function" ||
    typeof workflow.name !== "string"
  ) {
    throw new Error(`${file} must default-export a Workflow instance`);
  }

  return workflow;
}
