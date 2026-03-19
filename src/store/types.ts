import type { SerializedExecutor } from "../executor/types.js";
import type { State } from "../workflow/types.js";

export interface StoredRun {
  runId: string;
  workflowName: string;
  status: "running" | "completed" | "failed";
  startTime: string; // ISO 8601
  endTime?: string;
  initialState: State;
  finalState?: State;
  currentNode?: string;
  currentState?: State;
  executor?: SerializedExecutor;
  workflowFile?: string;
}

export interface RunListOptions {
  workflow?: string | undefined;
  limit?: number | undefined;
}
