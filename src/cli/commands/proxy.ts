import { resolve, dirname } from "node:path";
import { execFile } from "node:child_process";
import { defineCommand } from "citty";
import Docker from "dockerode";
import { getConfig } from "../../config.js";
import {
  isContainerRunning,
  writeAclFile,
  writeSquidConf,
  reconfigureSquid,
} from "../../sandbox/proxy.js";
import ora from "ora";

function getComposeFile(): string {
  const pkgDir = dirname(require.resolve("../../package.json"));
  return resolve(pkgDir, "docker/docker-compose.yml");
}

function dockerCompose(
  args: string[],
  env?: Record<string, string>,
): Promise<{ stdout: string; stderr: string }> {
  const composeFile = getComposeFile();
  return new Promise((resolve, reject) => {
    execFile(
      "docker",
      ["compose", "-f", composeFile, ...args],
      {
        env: { ...process.env, ...env },
      },
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

    if (!config.anthropic.apiKey) {
      throw new Error(
        "Anthropic API key not configured. Set it in ~/.claudeflow/claudeflow.config.ts",
      );
    }

    const spinner = ora({
      text: "Starting proxies...",
      discardStdin: false,
    }).start();

    await dockerCompose(["up", "-d", "squid", "auth-proxy"], {
      ANTHROPIC_API_KEY: config.anthropic.apiKey,
    });

    // Wait briefly for container to be ready
    //TODO: we can do better than a timeout
    await new Promise((r) => setTimeout(r, 2000));

    const containerName = config.squid.containerName;

    // Write squid.conf
    await writeSquidConf(docker, containerName);

    // Write ACL file
    const domains = config.squid.allowedDomains;
    await writeAclFile(docker, containerName, domains);

    // Reconfigure squid
    await reconfigureSquid(docker, containerName);

    spinner.succeed("Proxies running");
    console.log(`  Allowed domains: ${domains.join(", ")}`);
  },
});

const stop = defineCommand({
  meta: {
    name: "stop",
    description: "Stop the proxies",
  },
  async run() {
    const spinner = ora({
      text: "Stopping proxies...",
      discardStdin: true,
    });
    await dockerCompose(["down"]);
    spinner.succeed("Proxies stopped");
  },
});

const status = defineCommand({
  meta: {
    name: "status",
    description: "Show proxy status",
  },
  async run() {
    const config = getConfig();
    const docker = new Docker();

    // Squid proxy status
    const squidRunning = await isContainerRunning(
      docker,
      config.squid.containerName,
    );
    if (squidRunning) {
      console.log("Squid proxy is running.");
      console.log(
        `  Allowed domains: ${config.squid.allowedDomains.join(", ")}`,
      );

      try {
        const container = docker.getContainer(config.squid.containerName);
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
    } else {
      console.log("Squid proxy is not running.");
    }

    // Auth proxy status
    const authProxyRunning = await isContainerRunning(
      docker,
      config.authProxy.containerName,
    );
    if (authProxyRunning) {
      console.log(
        `Auth proxy is running. (port ${config.authProxy.port})`,
      );
    } else {
      console.log("Auth proxy is not running.");
    }

    if (!squidRunning || !authProxyRunning) {
      console.log("\n  Start with: claudeflow proxy start");
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
