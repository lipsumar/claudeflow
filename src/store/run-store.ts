import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  appendFileSync,
  readdirSync,
  existsSync,
} from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import type { WorkflowEvent, Run } from "../workflow/types.js";
import type { StoredRun, RunListOptions } from "./types.js";
import { getConfig } from "../config.js";

let instance: RunStore | null = null;

export function getStore(): RunStore {
  if (!instance) {
    instance = new RunStore(getConfig().store.path);
  }
  return instance;
}

export function resetStore(): void {
  instance = null;
}

function expandTilde(p: string): string {
  if (p.startsWith("~/")) {
    return join(homedir(), p.slice(2));
  }
  return p;
}

export class RunStore {
  readonly basePath: string;

  constructor(basePath: string) {
    this.basePath = expandTilde(basePath);
  }

  persistRun(run: Run): void {
    const stored: StoredRun = {
      runId: run.runId,
      workflowName: run.workflow.name,
      status: run.status,
      startTime: run.startTime,
      initialState: run.initialState,
      currentNode: run.currentNode,
      currentState: { ...run.state },
      executor: run.executor.serialize(),
      workflowFile: run.workflow.filepath,
    };
    if (run.endTime) stored.endTime = run.endTime;
    if (run.finalState) stored.finalState = run.finalState;
    const dir = join(this.basePath, run.runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.json"), JSON.stringify(stored, null, 2) + "\n");
  }

  appendEvent(runId: string, event: WorkflowEvent): void {
    const filePath = join(this.basePath, runId, "events.jsonl");
    appendFileSync(filePath, JSON.stringify(event) + "\n");
  }

  get(runId: string): StoredRun | null {
    const filePath = join(this.basePath, runId, "run.json");
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, "utf8")) as StoredRun;
  }

  list(opts?: RunListOptions): StoredRun[] {
    if (!existsSync(this.basePath)) return [];

    const entries = readdirSync(this.basePath, { withFileTypes: true });
    const runs: StoredRun[] = [];

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const runFile = join(this.basePath, entry.name, "run.json");
      if (!existsSync(runFile)) continue;

      const run = JSON.parse(readFileSync(runFile, "utf8")) as StoredRun;

      if (opts?.workflow && run.workflowName !== opts.workflow) continue;

      runs.push(run);
    }

    runs.sort(
      (a, b) =>
        new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
    );

    if (opts?.limit) {
      return runs.slice(0, opts.limit);
    }

    return runs;
  }

  getEvents(runId: string): WorkflowEvent[] {
    const filePath = join(this.basePath, runId, "events.jsonl");
    if (!existsSync(filePath)) return [];

    const content = readFileSync(filePath, "utf8").trimEnd();
    if (!content) return [];

    return content.split("\n").map((line) => JSON.parse(line) as WorkflowEvent);
  }
}
