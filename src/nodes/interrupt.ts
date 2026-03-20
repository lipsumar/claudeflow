import type {
  InterruptNodeDef,
  NodeResult,
  RunContext,
} from "../workflow/types.js";

export function interruptNode(def: {
  question: string | ((ctx: RunContext) => string);
  storeAs: string;
}): InterruptNodeDef {
  return { type: "interrupt", ...def };
}

export function executeInterruptNode(
  input: string,
  ctx: RunContext,
  nodeDef: InterruptNodeDef,
): NodeResult {
  if (ctx.state[nodeDef.storeAs] === undefined && !input) {
    const question =
      typeof nodeDef.question === "function"
        ? nodeDef.question(ctx)
        : nodeDef.question;
    return {
      interrupted: true,
      interruptMetadata: {
        reason: "input-required",
        question,
      },
    };
  }

  return { state: { [nodeDef.storeAs]: input } };
}
