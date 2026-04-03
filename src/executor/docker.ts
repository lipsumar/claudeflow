import { mkdirSync } from "node:fs";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type {
  Executor,
  ExecOpts,
  ExecResult,
  SpawnOpts,
  SerializedExecutor,
} from "./types.js";
import type { ChildProcess } from "node:child_process";
import type { HttpRequestEntry } from "../workflow/types.js";
import Docker from "dockerode";
import { getConfig } from "../config.js";
import {
  createRunNetwork,
  destroyRunNetwork,
  connectSquidToNetwork,
  disconnectSquidFromNetwork,
} from "../sandbox/network.js";
import { parseAccessLog } from "../sandbox/proxy.js";

export class DockerExecutor implements Executor {
  workspace: string;
  docker: Docker;
  image: string;
  container?: Docker.Container;

  private runId?: string;
  private networkName?: string;
  private squidGatewayIp?: string;

  constructor({ workspace, image }: { workspace: string; image: string }) {
    this.workspace = workspace;
    this.docker = new Docker();
    this.image = image;
  }

  async init(runId: string): Promise<void> {
    mkdirSync(this.workspace, { recursive: true });

    this.runId = runId;
    const config = getConfig();
    const squidName = config.squid.containerName;

    // 1. Create internal network
    this.networkName = await createRunNetwork(this.docker, runId);

    // 2. Connect squid to the network, get its IP
    this.squidGatewayIp = await connectSquidToNetwork(
      this.docker,
      this.networkName,
      squidName,
    );

    const proxyUrl = `http://${this.squidGatewayIp}:${config.squid.port}`;

    // 3. Create container on the internal network
    this.container = await this.docker.createContainer({
      name: this.getContainerName(),
      Image: this.image,
      Cmd: ["sleep", "infinity"],
      HostConfig: {
        Binds: [`${this.workspace}:/workspace`],
        NetworkMode: this.networkName,
      },
      Env: [
        `HTTP_PROXY=${proxyUrl}`,
        `HTTPS_PROXY=${proxyUrl}`,
        `http_proxy=${proxyUrl}`,
        `https_proxy=${proxyUrl}`,
      ],
      WorkingDir: "/workspace",
    });

    // 4. Start the container
    await this.container.start();
  }

  async exec(
    cmd: string,
    args: string[],
    opts?: ExecOpts,
  ): Promise<ExecResult> {
    if (!this.container) {
      throw new Error("Container not initialized. Call init() first.");
    }

    const exec = await this.container.exec({
      Cmd: [cmd, ...args],
      WorkingDir: opts?.cwd ?? "/workspace",
      User: "agent",
      Env: opts?.env
        ? Object.entries(opts.env)
            .filter(([, v]) => v !== undefined)
            .map(([k, v]) => `${k}=${v}`)
        : undefined,
      AttachStdout: true,
      AttachStderr: true,
    });

    const stream = await exec.start({ Tty: false });

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    stdoutStream.on("data", (chunk: Buffer) => stdout.push(chunk));
    stderrStream.on("data", (chunk: Buffer) => stderr.push(chunk));

    await new Promise<void>((resolve, reject) => {
      this.docker.modem.demuxStream(stream, stdoutStream, stderrStream);
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    const inspection = await exec.inspect();

    return {
      stdout: Buffer.concat(stdout).toString(),
      stderr: Buffer.concat(stderr).toString(),
      exitCode: inspection.ExitCode ?? 0,
    };
  }

  spawn(cmd: string, args: string[], opts?: SpawnOpts): ChildProcess {
    if (!this.container) {
      throw new Error("Container not initialized. Call init() first.");
    }

    const stdio = opts?.stdio ?? ["pipe", "pipe", "pipe"];
    const stdoutStream = stdio[1] === "pipe" ? new PassThrough() : null;
    const stderrStream = stdio[2] === "pipe" ? new PassThrough() : null;

    // Build a ChildProcess-shaped EventEmitter
    const fake = new EventEmitter() as ChildProcess;
    fake.stdout = stdoutStream;
    fake.stderr = stderrStream;
    // Not used but expected on ChildProcess
    fake.stdin = null;
    Object.defineProperty(fake, "pid", { value: undefined });
    Object.defineProperty(fake, "killed", { value: false, writable: true });
    fake.kill = () => {
      // Best-effort: we can't kill a docker exec easily,
      // but callers may call this on cleanup
      return false;
    };

    const container = this.container;
    const docker = this.docker;

    (async () => {
      try {
        const exec = await container.exec({
          Cmd: [cmd, ...args],
          WorkingDir: opts?.cwd ?? "/workspace",
          User: "agent",
          Env: opts?.env
            ? Object.entries(opts.env)
                .filter(([, v]) => v !== undefined)
                .map(([k, v]) => `${k}=${v}`)
            : undefined,
          AttachStdout: !!stdoutStream,
          AttachStderr: !!stderrStream,
        });

        const stream = await exec.start({ Tty: false });

        const demuxStdout = stdoutStream ?? new PassThrough();
        const demuxStderr = stderrStream ?? new PassThrough();
        docker.modem.demuxStream(stream, demuxStdout, demuxStderr);

        stream.on("end", async () => {
          try {
            const inspection = await exec.inspect();
            fake.emit("close", inspection.ExitCode ?? 0);
          } catch {
            fake.emit("close", 1);
          }
        });

        stream.on("error", (err: Error) => {
          fake.emit("error", err);
        });
      } catch (err) {
        fake.emit("error", err);
      }
    })();

    return fake;
  }

  async cleanup(): Promise<void> {
    const config = getConfig();
    const squidName = config.squid.containerName;

    // 1. Stop and remove the sandbox container
    if (this.container) {
      try {
        await this.container.stop();
        await this.container.remove();
      } catch {
        console.log(
          `WARN: could not remove sandbox container ${this.getContainerName()}`,
        );
      }
    }

    // 2. Disconnect squid from the network
    if (this.networkName) {
      try {
        await disconnectSquidFromNetwork(
          this.docker,
          this.networkName,
          squidName,
        );
      } catch {
        console.log(
          `WARN: could not disconnect squid from network ${this.networkName}`,
        );
      }
    }

    // 3. Destroy the run network
    if (this.runId) {
      try {
        await destroyRunNetwork(this.docker, this.runId);
      } catch {
        console.log(`WARN: could not remove run network ${this.networkName}`);
      }
    }
  }

  async getHttpLog(
    startTime: number,
    endTime: number,
  ): Promise<HttpRequestEntry[]> {
    if (!this.container || !this.networkName) return [];

    const config = getConfig();
    const squidName = config.squid.containerName;

    // Get the sandbox container's IP on the internal network
    const info = await this.container.inspect();
    const networkSettings = info.NetworkSettings.Networks[this.networkName!];
    const clientIp = networkSettings?.IPAddress;
    if (!clientIp) {
      console.log(
        "WARN: could not get sandbox container IP to retrieve HTTP logs",
      );
      return [];
    }

    return parseAccessLog(this.docker, squidName, clientIp, startTime, endTime);
  }

  getContainerName() {
    return `claudflow-sandbox-${this.runId}`;
  }

  serialize(): SerializedExecutor {
    return {
      type: "docker",
      workspace: this.workspace,
      image: this.image,
      containerId: this.container?.id,
    };
  }
}
