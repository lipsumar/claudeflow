import type { RunContext, ScriptedNodeDef, State } from "../workflow/types.js";

export function scriptedNode(
  fn: (ctx: RunContext) => Promise<Partial<State>>,
): ScriptedNodeDef {
  return { type: "scripted", fn };
}
