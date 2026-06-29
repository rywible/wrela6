import {
  interpretOptIrSlice,
  validateOptIrSliceIsInterpreterComplete,
  type OptIrInterpreterEffectTrace,
  type OptIrInterpreterMemory,
  type OptIrInterpreterSlice,
  type OptIrIntegerOverflowMode,
} from "./interpreter";

export interface OptIrDifferentialInput {
  readonly before: OptIrInterpreterSlice;
  readonly after: OptIrInterpreterSlice;
  readonly memoryFactory?: () => OptIrInterpreterMemory;
  readonly effectTraceFactory?: () => OptIrInterpreterEffectTrace;
  readonly overflowMode?: OptIrIntegerOverflowMode;
}

export type OptIrDifferentialComparison =
  | { readonly kind: "equivalent" }
  | { readonly kind: "different"; readonly differences: readonly string[] }
  | { readonly kind: "rejected"; readonly reasons: readonly string[] };

export function compareOptIrSlices(input: OptIrDifferentialInput): OptIrDifferentialComparison {
  const beforeCompleteness = validateOptIrSliceIsInterpreterComplete(input.before);
  const afterCompleteness = validateOptIrSliceIsInterpreterComplete(input.after);
  const rejectionReasons = [
    ...(beforeCompleteness.kind === "rejected" ? beforeCompleteness.reasons : []),
    ...(afterCompleteness.kind === "rejected" ? afterCompleteness.reasons : []),
  ];
  if (rejectionReasons.length > 0) {
    return { kind: "rejected", reasons: [...new Set(rejectionReasons)].sort() };
  }

  const before = interpretOptIrSlice({
    slice: input.before,
    memory: input.memoryFactory?.(),
    effects: input.effectTraceFactory?.(),
    overflowMode: input.overflowMode,
  });
  const after = interpretOptIrSlice({
    slice: input.after,
    memory: input.memoryFactory?.(),
    effects: input.effectTraceFactory?.(),
    overflowMode: input.overflowMode,
  });

  const differences: string[] = [];
  if (!sameJson(before.kind, after.kind)) {
    differences.push("result-kind");
  }
  if (before.kind === "returned" && after.kind === "returned") {
    if (!sameJson(before.values, after.values)) {
      differences.push("values");
    }
    if (!sameJson(before.observations.memory, after.observations.memory)) {
      differences.push("memory");
    }
    if (!sameJson(before.observations.effects, after.observations.effects)) {
      differences.push("effects");
    }
  } else if (
    before.kind === "trapped" &&
    after.kind === "trapped" &&
    before.reason !== after.reason
  ) {
    differences.push("trap-reason");
  }

  return differences.length === 0 ? { kind: "equivalent" } : { kind: "different", differences };
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left, bigintReplacer) === JSON.stringify(right, bigintReplacer);
}

function bigintReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? `${value}n` : value;
}
