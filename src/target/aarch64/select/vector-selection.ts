import { appendAArch64SelectionRecord, type AArch64LoweringState } from "../lower/pipeline-stages";

export function selectAArch64VectorOperation(input: {
  readonly policy: "scalarOnly" | "ownsVectorState" | "callsVectorHelper";
  readonly operationKind: "load" | "store" | "shuffle" | "compare" | "select" | "byteSwap";
}): {
  readonly kind: "ok";
  readonly instructions: readonly string[];
  readonly rejectedAlternatives: readonly { readonly patternId: string; readonly reason: string }[];
} {
  if (input.policy === "scalarOnly") {
    return {
      kind: "ok",
      instructions: Object.freeze(["scalar-helper"]),
      rejectedAlternatives: Object.freeze([
        { patternId: "vector.direct-load", reason: "vector-state-policy:scalarOnly" },
      ]),
    };
  }
  if (input.policy === "callsVectorHelper") {
    return {
      kind: "ok",
      instructions: Object.freeze(["vector-helper"]),
      rejectedAlternatives: Object.freeze([
        {
          patternId: `vector.direct-${input.operationKind}`,
          reason: "vector-state-policy:callsVectorHelper",
        },
      ]),
    };
  }
  const opcode = opcodeForDirectVectorOperation(input.operationKind);
  return {
    kind: "ok",
    instructions: Object.freeze([opcode]),
    rejectedAlternatives: Object.freeze([]),
  };
}

function opcodeForDirectVectorOperation(
  operationKind: "load" | "store" | "shuffle" | "compare" | "select" | "byteSwap",
): string {
  switch (operationKind) {
    case "load":
      return "ld1";
    case "store":
      return "st1";
    case "shuffle":
      return "tbl";
    case "compare":
      return "cmeq";
    case "select":
      return "bsl";
    case "byteSwap":
      return "rev16";
  }
}

export function selectAArch64VectorsStageState(state: AArch64LoweringState): AArch64LoweringState {
  const vectorRecords = state.selectionRecords.filter((record) =>
    record.explanation.some((entry) => entry.startsWith("vector-selection:")),
  );
  const emittedOpcodes = vectorRecords.flatMap((record) => record.emittedOpcodes);
  return appendAArch64SelectionRecord(state, {
    stageKey: "select-vectors",
    subjectKey: "program",
    patternId: "vector.policy-gated",
    tier: "helper",
    factsUsed: state.facts.records
      .filter((record) => record.extensionKey === "vector-state")
      .map((record) => Number(record.factId)),
    emittedOpcodes,
    explanation:
      emittedOpcodes.length === 0
        ? ["select-vectors:no-vector-operations"]
        : [`select-vectors:materialized:${emittedOpcodes.join(",")}`],
  });
}
