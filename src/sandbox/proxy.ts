import { PassThrough } from "node:stream";
import type Docker from "dockerode";
import type { HttpRequestEntry } from "../workflow/types.js";

const SQUID_CONF = `
# Forward proxy on port 3128
http_port 3128

# Domain allow list
acl allowed_domains dstdomain "/etc/squid/acl/allowed-domains.txt"
http_access allow CONNECT allowed_domains
http_access allow allowed_domains
http_access deny all
`.trim();

/**
 * Run `docker exec` and wait for it to finish, properly draining output.
 * With `Tty: false`, dockerode returns a multiplexed stream that must be
 * demuxed before the `end` event fires reliably.
 */
async function dockerExec(
  docker: Docker,
  container: Docker.Container,
  cmd: string[],
): Promise<string> {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ Tty: false });
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const chunks: Buffer[] = [];
  stdout.on("data", (c: Buffer) => chunks.push(c));
  docker.modem.demuxStream(stream, stdout, stderr);
  await new Promise<void>((resolve) => stream.on("end", resolve));
  return Buffer.concat(chunks).toString();
}

/**
 * Run `docker exec` with stdin piped in, then close.
 */
async function dockerExecStdin(
  container: Docker.Container,
  cmd: string[],
  input: string,
): Promise<void> {
  const exec = await container.exec({
    Cmd: cmd,
    AttachStdin: true,
    AttachStdout: true,
    AttachStderr: true,
  });
  const stream = await exec.start({ hijack: true, stdin: true });
  stream.write(input);
  stream.end();
  await new Promise<void>((resolve) => stream.on("end", resolve));
}

export async function ensureSquidRunning(
  docker: Docker,
  containerName: string,
): Promise<boolean> {
  try {
    const container = docker.getContainer(containerName);
    const info = await container.inspect();
    return info.State.Running;
  } catch {
    return false;
  }
}

export async function writeAclFile(
  docker: Docker,
  containerName: string,
  domains: string[],
): Promise<void> {
  const allDomains = Array.from(new Set(domains));
  const content = allDomains.join("\n") + "\n";
  const container = docker.getContainer(containerName);
  await dockerExecStdin(
    container,
    [
      "sh",
      "-c",
      "mkdir -p /etc/squid/acl && cat > /etc/squid/acl/allowed-domains.txt",
    ],
    content,
  );
}

export async function writeSquidConf(
  docker: Docker,
  containerName: string,
): Promise<void> {
  const container = docker.getContainer(containerName);
  await dockerExecStdin(
    container,
    ["sh", "-c", "cat > /etc/squid/squid.conf"],
    SQUID_CONF + "\n",
  );
}

export async function reconfigureSquid(
  docker: Docker,
  containerName: string,
): Promise<void> {
  const container = docker.getContainer(containerName);
  await dockerExec(docker, container, ["squid", "-k", "reconfigure"]);
}

export async function parseAccessLog(
  docker: Docker,
  containerName: string,
  clientIp: string,
  startTime: number,
  endTime: number,
): Promise<HttpRequestEntry[]> {
  const container = docker.getContainer(containerName);
  const raw = await dockerExec(docker, container, [
    "cat",
    "/var/log/squid/access.log",
  ]);

  const entries: HttpRequestEntry[] = [];
  const startEpoch = startTime / 1000;
  const endEpoch = endTime / 1000;

  for (const line of raw.split("\n")) {
    if (!line.trim()) continue;
    // Squid log format:
    // timestamp duration clientIp status/code bytes method url ...
    const parts = line.trim().split(/\s+/);
    if (parts.length < 7) continue;

    const timestamp = parseFloat(parts[0]!);
    const duration = parseInt(parts[1]!, 10);
    const ip = parts[2]!;
    const statusCode = parts[3]!;
    const bytes = parseInt(parts[4]!, 10);
    const url = parts[6]!;

    if (ip !== clientIp) continue;
    if (timestamp < startEpoch || timestamp > endEpoch) continue;

    // Parse domain and port from URL (e.g. "api.github.com:443")
    const [domain, portStr] = url.split(":");
    const port = portStr ? parseInt(portStr, 10) : 80;

    const status: "allowed" | "denied" = statusCode.includes("DENIED")
      ? "denied"
      : "allowed";

    entries.push({
      timestamp: new Date(timestamp * 1000).toISOString(),
      domain: domain!,
      port,
      status,
      durationMs: duration,
      bytes: isNaN(bytes) ? 0 : bytes,
    });
  }

  return entries;
}
