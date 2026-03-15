import { Workflow, scriptedNode } from "../../../src/index.js";

export default new Workflow({ name: "text-pipeline" })
  .addNode(
    "read_input",
    scriptedNode(async (ctx) => {
      const text = (await ctx.$`cat input.txt`).stdout.trim();
      return { text };
    }),
  )
  .addNode(
    "transform",
    scriptedNode(async (ctx) => {
      const upper = (ctx.state.text as string).toUpperCase();
      await ctx.$`echo ${upper} > output.txt`;
      return { text: upper };
    }),
  )
  .addNode(
    "verify",
    scriptedNode(async (ctx) => {
      const output = (await ctx.$`cat output.txt`).stdout.trim();
      return { verified: output === ctx.state.text };
    }),
  )
  .addEdge("read_input", "transform")
  .addEdge("transform", "verify");
