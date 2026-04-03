import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "./helpers.js";

const fixtures = {
  allowed: resolve(__dirname, "fixtures/proxy-test/workflow-allowed.ts"),
  blocked: resolve(__dirname, "fixtures/proxy-test/workflow-blocked.ts"),
};

describe("squid proxy", () => {

  it("allows requests to domains in the allow list", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "claudeflow-proxy-"));

    await runCli([
      "run",
      fixtures.allowed,
      "--workspace",
      workspace,
      "--output",
      "json",
    ]);

    const httpCode = readFileSync(join(workspace, "curl-result.txt"), "utf8").trim();
    const exitCode = readFileSync(join(workspace, "curl-exit.txt"), "utf8").trim();

    // curl should succeed (exit 0) and get a real HTTP response
    expect(exitCode).toBe("0");
    // github.com may return 200 or 301, but not 000 (connection refused) or 403 (proxy denied)
    expect(Number(httpCode)).toBeGreaterThanOrEqual(200);
    expect(Number(httpCode)).toBeLessThan(400);
  }, 60_000);

  it("blocks requests to domains not in the allow list", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "claudeflow-proxy-"));

    await runCli([
      "run",
      fixtures.blocked,
      "--workspace",
      workspace,
      "--output",
      "json",
    ]);

    const httpCode = readFileSync(join(workspace, "curl-result.txt"), "utf8").trim();
    const exitCode = readFileSync(join(workspace, "curl-exit.txt"), "utf8").trim();

    // Squid denies the CONNECT — curl can't establish the tunnel
    // and reports 000 (no HTTP response received)
    expect(httpCode).toBe("000");
    expect(exitCode).not.toBe("0");
  }, 60_000);
});
