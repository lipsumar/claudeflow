import { Workflow, scriptedNode } from "../../../src/index.js";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export default new Workflow({ name: "text-pipeline" })
  .addNode(
    "read_input",
    scriptedNode(async (ctx) => {
      const text = readFileSync(join(ctx.workspace, "input.txt"), "utf8");
      return { text };
    }),
  )
  .addNode(
    "transform",
    scriptedNode(async (ctx) => {
      const upper = (ctx.state.text as string).toUpperCase();
      writeFileSync(join(ctx.workspace, "output.txt"), upper);
      return { text: upper };
    }),
  )
  .addNode(
    "verify",
    scriptedNode(async (ctx) => {
      const output = readFileSync(join(ctx.workspace, "output.txt"), "utf8");
      return { verified: output === ctx.state.text };
    }),
  )
  .addEdge("read_input", "transform")
  .addEdge("transform", "verify");
