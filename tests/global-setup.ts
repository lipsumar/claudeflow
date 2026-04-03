import { runCli } from "./helpers.js";

export async function setup() {
  await runCli(["proxy", "start"]);
}

export async function teardown() {
  await runCli(["proxy", "stop"]);
}
