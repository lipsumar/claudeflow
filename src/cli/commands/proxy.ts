import { resolve, dirname } from "node:path";
import { execFile } from "node:child_process";
import { defineCommand } from "citty";
import Docker from "dockerode";
import { getConfig } from "../../config.js";
import {
  ensureSquidRunning,
  writeAclFile,
  writeSquidConf,
  reconfigureSquid,
} from "../../sandbox/proxy.js";

function getComposeFile(): string {
  const pkgDir = dirname(require.resolve("../../package.json"));
  return resolve(pkgDir, "docker/docker-compose.yml");
}

function dockerCompose(
  args: string[],
): Promise<{ stdout: string; stderr: string }> {
  const composeFile = getComposeFile();
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      ["compose", "-f", composeFile, ...args],
      (error, stdout, stderr) => {
        if (error) {
          reject(
            new Error(`docker compose failed: ${stderr || error.message}`),
          );
          return;
        }
        resolve({ stdout, stderr });
      },
    );
  });
}

const start = defineCommand({
  meta: {
    name: "start",
    description: "Start the Squid proxy",
  },
  async run() {
    const config = getConfig();
    const docker = new Docker();

    console.log("Starting Squid proxy...");
    await dockerCompose(["up", "-d", "squid"]);

    // Wait briefly for container to be ready
    //TODO: we can do better than a timeout
    await new Promise((r) => setTimeout(r, 2000));

    const containerName = config.squid.containerName;

    // Write squid.conf
    console.log("Writing config...");
    await writeSquidConf(docker, containerName);

    // Write ACL file
    const domains = config.squid.allowedDomains;
    await writeAclFile(docker, containerName, domains);

    // Reconfigure squid
    await reconfigureSquid(docker, containerName);

    console.log("Squid proxy is running.");
    console.log(`  Allowed domains: ${domains.join(", ")}`);
  },
});

const stop = defineCommand({
  meta: {
    name: "stop",
    description: "Stop the Squid proxy",
  },
  async run() {
    console.log("Stopping Squid proxy...");
    await dockerCompose(["down"]);
    console.log("Squid proxy stopped.");
  },
});

const status = defineCommand({
  meta: {
    name: "status",
    description: "Show Squid proxy status",
  },
  async run() {
    const config = getConfig();
    const docker = new Docker();
    const containerName = config.squid.containerName;

    const running = await ensureSquidRunning(docker, containerName);
    if (!running) {
      console.log("Squid proxy is not running.");
      console.log("  Start with: claudeflow proxy start");
      return;
    }

    console.log("Squid proxy is running.");

    // Show allowed domains
    console.log(`  Allowed domains: ${config.squid.allowedDomains.join(", ")}`);

    // Show connected networks
    try {
      const container = docker.getContainer(containerName);
      const info = await container.inspect();
      const networks = Object.keys(info.NetworkSettings.Networks);
      const runNetworks = networks.filter((n) =>
        n.startsWith("claudeflow-run-"),
      );
      if (runNetworks.length > 0) {
        console.log(`  Active run networks: ${runNetworks.join(", ")}`);
      } else {
        console.log("  No active run networks.");
      }
    } catch {
      // best effort
    }
  },
});

export default defineCommand({
  meta: {
    name: "proxy",
    description: "Manage the Squid proxy for network isolation",
  },
  subCommands: {
    //TODO do we really need these promises ?
    start: () => Promise.resolve(start),
    stop: () => Promise.resolve(stop),
    status: () => Promise.resolve(status),
  },
});
