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
import type { WorkflowEvent } from "../workflow/types.js";
import type { StoredRun, RunListOptions } from "./types.js";
import _ from "lodash";

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

  createRun(run: StoredRun): void {
    const dir = join(this.basePath, run.runId);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");
  }

  updateRun(runId: string, patch: Partial<StoredRun>): void {
    const filePath = join(this.basePath, runId, "run.json");
    const existing = JSON.parse(readFileSync(filePath, "utf8")) as StoredRun;
    const updated = _.merge({}, existing, patch);
    writeFileSync(filePath, JSON.stringify(updated, null, 2) + "\n");
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
