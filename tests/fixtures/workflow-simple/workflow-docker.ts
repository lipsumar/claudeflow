import { Workflow, scriptedNode } from "@lipsumar/claudeflow";

export default new Workflow({
  name: "text-pipeline",
  executor: "docker",
  dockerImage: "claudeflow-sandbox",
})
  .addNode(
    "read_input",
    scriptedNode(async (ctx) => {
      const result = await ctx.exec("cat", ["input.txt"]);
      return { text: result.stdout.trim() };
    }),
  )
  .addNode(
    "transform",
    scriptedNode(async (ctx) => {
      const upper = (ctx.state.text as string).toUpperCase();
      await ctx.exec("sh", ["-c", `echo ${upper} > output.txt`]);
      return { text: upper };
    }),
  )
  .addNode(
    "verify",
    scriptedNode(async (ctx) => {
      const result = await ctx.exec("cat", ["output.txt"]);
      return { verified: result.stdout.trim() === ctx.state.text };
    }),
  )
  .addEdge("read_input", "transform")
  .addEdge("transform", "verify");
