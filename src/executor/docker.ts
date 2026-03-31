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
import Docker from "dockerode";

export class DockerExecutor implements Executor {
  workspace: string;
  docker: Docker;
  image: string;
  container?: Docker.Container;

  constructor({ workspace, image }: { workspace: string; image: string }) {
    // workspace is a directory on the host
    // that will be mounted into the Docker container
    this.workspace = workspace;

    // we may want to get this injected at some point
    // but for now we'll just create it here
    this.docker = new Docker();

    this.image = image;
  }

  async init(): Promise<void> {
    mkdirSync(this.workspace, { recursive: true });

    // start the Docker container with the workspace mounted
    this.container = await this.docker.createContainer({
      Image: this.image,
      Cmd: ["sleep", "infinity"],
      HostConfig: {
        Binds: [`${this.workspace}:/workspace`],
      },
      WorkingDir: "/workspace",
    });
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
    if (!this.container) return;
    await this.container.stop();
    await this.container.remove();
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
