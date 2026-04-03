import { Workflow, scriptedNode } from "@lipsumar/claudeflow";

/**
 * Workflow that curls an allowed domain (github.com).
 * The config in tests/claudeflow.config.ts allows github.com.
 */
export default new Workflow({
  name: "proxy-allowed",
  executor: "docker",
  dockerImage: "claudeflow-sandbox",
}).addNode(
  "fetch",
  scriptedNode(async (ctx) => {
    const result = await ctx.exec("sh", [
      "-c",
      'curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://github.com > /workspace/curl-result.txt 2>&1; echo $? > /workspace/curl-exit.txt',
    ]);
    return {};
  }),
);
