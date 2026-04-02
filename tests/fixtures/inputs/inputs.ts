import { Workflow, z } from "@lipsumar/claudeflow";

export default new Workflow({
  name: "inputs",
  executor: "host",
  inputs: z.object({
    name: z.string(),
    count: z.number(),
    flag: z.boolean(),
    nameOpt: z.string().optional(),
    countOpt: z.number().optional(),
    flagOpt: z.boolean().optional(),
  }),
}).addNode("ECHO", {
  type: "scripted",
  fn: async ({ state, log }) => {
    log.info(JSON.stringify(state));
    return {};
  },
});
