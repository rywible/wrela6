import { appendAArch64SelectionRecord, type AArch64LoweringState } from "../lower/pipeline-stages";

export function selectAArch64MemoryWindow(input: {
  readonly operationCount: number;
  readonly completeFootprint: boolean;
  readonly noalias: boolean;
  readonly alignment: number;
  readonly regionMemoryType: string;
  readonly volatile?: boolean;
}):
  | { readonly kind: "ok"; readonly instructions: readonly string[] }
  | { readonly kind: "rejected"; readonly reason: string } {
  if (input.volatile || input.regionMemoryType !== "normalCacheable")
    return { kind: "rejected", reason: "ordered-or-non-normal-memory" };
  if (!input.completeFootprint) return { kind: "rejected", reason: "missingCompleteFootprint" };
  if (!input.noalias) return { kind: "rejected", reason: "missing-noalias" };
  if (input.operationCount >= 2 && input.alignment >= 8)
    return { kind: "ok", instructions: Object.freeze(["ldp-signed-offset"]) };
  return { kind: "ok", instructions: Object.freeze(["ldr-unsigned-immediate"]) };
}

export function selectAArch64MemoryAndEndianStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  const records = state.selectionRecords.filter((record) =>
    record.explanation.some(
      (entry) =>
        entry.startsWith("endian-selection:") ||
        entry.startsWith("validated-buffer:") ||
        entry.startsWith("region-memory-type:"),
    ),
  );
  const emittedOpcodes = records.flatMap((record) => record.emittedOpcodes);
  return appendAArch64SelectionRecord(state, {
    stageKey: "select-smart-memory-and-endian",
    subjectKey: "program",
    patternId: "memory.smart-addressing-endian",
    tier: "window",
    factsUsed: state.facts.records
      .filter((record) => record.extensionKey === "footprint")
      .map((record) => Number(record.factId)),
    emittedOpcodes,
    explanation:
      emittedOpcodes.length === 0
        ? ["select-smart-memory-and-endian:no-materialized-memory-endian-decisions"]
        : [`select-smart-memory-and-endian:materialized:${emittedOpcodes.join(",")}`],
  });
}
