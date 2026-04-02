import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { tmpdir } from "node:os";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultConfig,
  defineConfig,
  resolveConfig,
  loadConfigFile,
  resolvePaths,
  initConfig,
  getConfig,
  resetConfig,
} from "./config.js";

describe("defineConfig", () => {
  it("returns the config as-is", () => {
    const cfg = { squid: { port: 9999 } };
    expect(defineConfig(cfg)).toBe(cfg);
  });
});

describe("resolveConfig", () => {
  it("returns defaults when called with no overrides", () => {
    expect(resolveConfig()).toEqual(defaultConfig);
  });

  it("overrides specific fields while keeping other defaults", () => {
    const resolved = resolveConfig({ squid: { port: 5555 } });
    expect(resolved.squid.port).toBe(5555);
    expect(resolved.squid.containerName).toBe("claudeflow-squid");
    expect(resolved.sandbox).toEqual(defaultConfig.sandbox);
  });
});

describe("resolvePaths", () => {
  it("does not add undefined keys for unset paths", () => {
    const result = resolvePaths({ squid: { port: 7777 } }, "/some/dir");
    expect(result).toEqual({ squid: { port: 7777 } });
  });

  it("resolves a relative store.path against the given dir", () => {
    const result = resolvePaths({ store: { path: "./my-runs" } }, "/some/dir");
    expect(result.store?.path).toBe("/some/dir/my-runs");
  });
});

describe("loadConfigFile", () => {
  it("returns empty object when no config file exists", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-test-"));
    expect(await loadConfigFile(dir)).toEqual({});
  });

  it("loads a .ts config file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-test-"));
    writeFileSync(
      join(dir, "claudeflow.config.ts"),
      `export default { squid: { port: 7777 } };`,
    );
    const cfg = await loadConfigFile(dir);
    expect(cfg).toEqual({ squid: { port: 7777 } });
  });

  it("resolves relative store.path against the config file directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-test-"));
    writeFileSync(
      join(dir, "claudeflow.config.ts"),
      `export default { store: { path: "./my-runs" } };`,
    );
    const cfg = await loadConfigFile(dir);
    expect(cfg.store?.path).toBe(join(dir, "my-runs"));
  });

  it("loads a .js config file", async () => {
    const dir = mkdtempSync(join(tmpdir(), "cf-test-"));
    writeFileSync(
      join(dir, "claudeflow.config.js"),
      `module.exports = { store: { path: "/custom/db" } };`,
    );
    const cfg = await loadConfigFile(dir);
    expect(cfg).toEqual({ store: { path: "/custom/db" } });
  });
});

describe("singleton (initConfig / getConfig / resetConfig)", () => {
  beforeEach(() => resetConfig());
  afterEach(() => resetConfig());

  it("throws when getConfig is called before initConfig", () => {
    expect(() => getConfig()).toThrow("Config not initialized");
  });

  it("initConfig resolves defaults and makes config available via getConfig", async () => {
    await initConfig();
    expect(getConfig()).toEqual(defaultConfig);
  });

  it("initConfig merges overrides", async () => {
    await initConfig({ sandbox: { defaultTimeoutMs: 60_000 } });
    const cfg = getConfig();
    expect(cfg.sandbox.defaultTimeoutMs).toBe(60_000);
    expect(cfg.sandbox.defaultImage).toBe("claudeflow-sandbox:latest");
  });
});
