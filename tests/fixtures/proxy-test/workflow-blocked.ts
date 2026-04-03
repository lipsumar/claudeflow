import { Workflow, scriptedNode } from "@lipsumar/claudeflow";

/**
 * Workflow that curls a domain NOT in the allow list.
 * The proxy should deny the CONNECT request.
 */
export default new Workflow({
  name: "proxy-blocked",
  executor: "docker",
  dockerImage: "claudeflow-sandbox",
}).addNode(
  "fetch",
  scriptedNode(async (ctx) => {
    const result = await ctx.exec("sh", [
      "-c",
      'curl -s -o /dev/null -w "%{http_code}" --max-time 10 https://example.com > /workspace/curl-result.txt 2>&1; echo $? > /workspace/curl-exit.txt',
    ]);
    return {};
  }),
);
