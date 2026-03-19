import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { RunStore } from "./run-store.js";
import type { StoredRun } from "./types.js";
import type { WorkflowEvent } from "../workflow/types.js";

let store: RunStore;
let tempDir: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "claudeflow-test-"));
  store = new RunStore(tempDir);
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

function makeRun(overrides: Partial<StoredRun> = {}): StoredRun {
  return {
    runId: "run-1",
    workflowName: "test-workflow",
    status: "running",
    startTime: "2026-03-17T10:00:00.000Z",
    initialState: { foo: "bar" },
    ...overrides,
  };
}

/** Seed a StoredRun directly to disk (replaces old createRun in tests) */
function seedRun(run: StoredRun): void {
  const dir = join(tempDir, run.runId);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "run.json"), JSON.stringify(run, null, 2) + "\n");
}

describe("RunStore", () => {
  describe("get", () => {
    it("round-trips a run", () => {
      const run = makeRun();
      seedRun(run);

      const retrieved = store.get("run-1");
      expect(retrieved).toEqual(run);
    });

    it("returns null for missing runId", () => {
      expect(store.get("nonexistent")).toBeNull();
    });
  });

  describe("appendEvent + getEvents", () => {
    it("appends and retrieves events in order", () => {
      seedRun(makeRun());

      const events: WorkflowEvent[] = [
        { type: "node:start", nodeId: "step1", runId: "run-1" },
        { type: "node:end", nodeId: "step1", durationMs: 100 },
        { type: "run:complete", runId: "run-1", status: "completed" },
      ];

      for (const event of events) {
        store.appendEvent("run-1", event);
      }

      expect(store.getEvents("run-1")).toEqual(events);
    });

    it("returns empty array for missing runId", () => {
      expect(store.getEvents("nonexistent")).toEqual([]);
    });
  });

  describe("list", () => {
    it("lists all runs sorted by startTime descending", () => {
      seedRun(
        makeRun({
          runId: "run-old",
          startTime: "2026-03-17T08:00:00.000Z",
        }),
      );
      seedRun(
        makeRun({
          runId: "run-new",
          startTime: "2026-03-17T12:00:00.000Z",
        }),
      );
      seedRun(
        makeRun({
          runId: "run-mid",
          startTime: "2026-03-17T10:00:00.000Z",
        }),
      );

      const runs = store.list();
      expect(runs.map((r) => r.runId)).toEqual([
        "run-new",
        "run-mid",
        "run-old",
      ]);
    });

    it("filters by workflow name", () => {
      seedRun(makeRun({ runId: "r1", workflowName: "alpha" }));
      seedRun(makeRun({ runId: "r2", workflowName: "beta" }));
      seedRun(makeRun({ runId: "r3", workflowName: "alpha" }));

      const runs = store.list({ workflow: "beta" });
      expect(runs).toHaveLength(1);
      expect(runs[0]!.runId).toBe("r2");
    });

    it("respects limit", () => {
      seedRun(makeRun({ runId: "r1" }));
      seedRun(makeRun({ runId: "r2" }));
      seedRun(makeRun({ runId: "r3" }));

      const runs = store.list({ limit: 2 });
      expect(runs).toHaveLength(2);
    });

    it("returns empty array when base path does not exist", () => {
      const emptyStore = new RunStore(join(tempDir, "nonexistent"));
      expect(emptyStore.list()).toEqual([]);
    });
  });
});
