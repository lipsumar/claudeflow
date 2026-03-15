import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { defaultConfig } from "../src/config.js";
import { runCli } from "./helpers.js";

const fixtures = resolve(__dirname, "fixtures");

describe("claudeflow config", () => {
  it("prints default config when no config file exists", async () => {
    const { stdout } = await runCli(["config"], {
      cwd: resolve(fixtures, "config-default"),
    });
    expect(JSON.parse(stdout)).toEqual(defaultConfig);
  });

  it("merges user config file with defaults", async () => {
    const { stdout } = await runCli(["config"], {
      cwd: resolve(fixtures, "config-custom"),
    });
    const config = JSON.parse(stdout);
    expect(config.squid.port).toBe(9999);
    expect(config.squid.containerName).toBe("claudeflow-squid");
    expect(config.sandbox).toEqual(defaultConfig.sandbox);
  });
});
