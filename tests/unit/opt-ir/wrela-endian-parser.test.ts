import { describe, expect, test } from "bun:test";

import { optIrCallId, optIrOperationId, optIrOriginId } from "../../../src/opt-ir/ids";
import { optIrRuntimeCallOperation } from "../../../src/opt-ir/operations";
import { runWrelaEndianParserCollapseForTest } from "../../../src/opt-ir/passes/wrela-optimizations";

describe("Wrela endian folding and parser collapse", () => {
  test("folds only explicit endian operations and blocks volatile or firmware folds without contract", () => {
    const result = runWrelaEndianParserCollapseForTest({
      operations: [operation(1), operation(2), operation(3), operation(4)],
      endianFoldCandidates: [
        candidate(1, "big", "normal", "nonVolatile"),
        candidate(2, "native", "normal", "nonVolatile"),
        candidate(3, "little", "normal", "volatile"),
        candidate(4, "little", "firmware", "nonVolatile"),
      ],
    });

    expect(result.foldedEndianOperationIds).toEqual([optIrOperationId(1)]);
    expect(result.rejectedEndianFolds.map((fold) => fold.reason)).toEqual([
      "implicitEndian",
      "volatileFoldNotPermitted",
      "firmwareFoldNotPermitted",
    ]);
  });

  test("parser collapse removes parser states but preserves cold rejection and diagnostic origins", () => {
    const parserState = operation(1);
    const directLoad = operation(2);
    const result = runWrelaEndianParserCollapseForTest({
      operations: [parserState, directLoad],
      parserCollapseCandidates: [
        {
          parserStateOperationIds: [parserState.operationId],
          directLoadOperationIds: [directLoad.operationId],
          coldRejectionOrigins: [optIrOriginId(30)],
          diagnosticOrigins: [optIrOriginId(31)],
          factChain: ["parser-state:eth", "layout:packet"],
        },
      ],
    });

    expect(result.operations.map((remaining) => remaining.operationId)).toEqual([
      directLoad.operationId,
    ]);
    expect(result.directPacketLoadOperationIds).toEqual([directLoad.operationId]);
    expect(result.explanations[0]).toMatchObject({
      kind: "parserStateCollapsed",
      coldRejectionOrigins: [optIrOriginId(30)],
      diagnosticOrigins: [optIrOriginId(31)],
      factChain: ["parser-state:eth", "layout:packet"],
    });
  });
});

function candidate(
  operationId: number,
  endian: "little" | "big" | "native",
  regionKind: "normal" | "firmware",
  volatility: "nonVolatile" | "volatile",
) {
  return {
    operationId: optIrOperationId(operationId),
    endian,
    regionKind,
    volatility,
    factChain: [`endian:${operationId}`],
  };
}

function operation(operationId: number) {
  return optIrRuntimeCallOperation({
    operationId: optIrOperationId(operationId),
    callId: optIrCallId(operationId),
    target: { kind: "runtime", runtimeKey: `parser.${operationId}` },
    argumentIds: [],
    resultIds: [],
    resultTypes: [],
    originId: optIrOriginId(1),
  });
}
