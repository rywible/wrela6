import { aarch64SymbolId } from "../machine-ir/ids";
import type { AArch64LoweringState } from "./pipeline-stages";
import { recordAArch64StagePlanning } from "./stage-helpers";

export type AArch64CallLoweringResult =
  | {
      readonly kind: "ok";
      readonly instructions: readonly string[];
      readonly relocations: readonly {
        readonly kind: "CALL26";
        readonly symbol: ReturnType<typeof aarch64SymbolId>;
        readonly addend: 0n;
      }[];
      readonly terminal: boolean;
    }
  | { readonly kind: "error"; readonly reason: string };

export function lowerAArch64Call(input: {
  readonly targetKind: "internal" | "runtime" | "platform" | "indirect";
  readonly symbol?: string;
  readonly terminal?: boolean;
}): AArch64CallLoweringResult {
  if (
    (input.targetKind === "internal" || input.targetKind === "runtime") &&
    (input.symbol ?? "").length === 0
  ) {
    return { kind: "error", reason: "call-lowering:missing-symbol" };
  }
  if (input.targetKind === "platform" || input.targetKind === "indirect") {
    return {
      kind: "ok",
      instructions: input.terminal ? ["blr", "trap"] : ["blr"],
      relocations: [],
      terminal: input.terminal ?? false,
    };
  }
  return {
    kind: "ok",
    instructions: Object.freeze(input.terminal ? ["bl", "trap"] : ["bl"]),
    relocations: Object.freeze([
      { kind: "CALL26", symbol: aarch64SymbolId(input.symbol ?? ""), addend: 0n },
    ]),
    terminal: input.terminal ?? false,
  };
}

export function lowerAArch64CallsStageState(state: AArch64LoweringState): AArch64LoweringState {
  return recordAArch64StagePlanning(state, "lower-calls", "calls-lowered-with-abi-clobbers");
}
