import { describe, expect, test } from "bun:test";

import {
  optIrCallId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrRuntimeCallOperation } from "../../../src/opt-ir/operations";
import { buildOptimizedOptIr } from "../../../src/opt-ir/public-api";
import { runWrelaMoveCopyWrapperElisionForTest } from "../../../src/opt-ir/passes/wrela-optimizations";
import { packetParserDemoInputForTest } from "../../support/opt-ir/packet-parser-demo-fixtures";

describe("OptIR fact-preserving Wrela rewrites", () => {
  test("debug explanations retain eliminated copy and wrapper fact chains", () => {
    const copy = operation(1);
    const wrapper = operation(2);
    const result = runWrelaMoveCopyWrapperElisionForTest({
      operations: [copy, wrapper],
      candidates: [
        candidate(copy.operationId, "copy", optIrValueId(10), optIrValueId(11)),
        candidate(wrapper.operationId, "wrapper", optIrValueId(12), optIrValueId(13)),
      ],
    });

    expect(result.eliminatedOperationIds).toEqual([copy.operationId, wrapper.operationId]);
    expect(result.explanations.map((explanation) => explanation.factChain)).toEqual([
      ["ownership:1", "noalias:1", "erasure:1"],
      ["ownership:2", "noalias:2", "erasure:2"],
    ]);
    expect(result.explanations.map((explanation) => explanation.invariant.kind)).toEqual([
      "ownershipRuntimeIdentity",
      "abiWrapperEquivalence",
    ]);
  });

  test("keeps ownership transfers, copy helpers, and cleanup paths when facts do not prove erasure", () => {
    const copy = operation(3);
    const cleanup = operation(4);
    const result = runWrelaMoveCopyWrapperElisionForTest({
      operations: [copy, cleanup],
      candidates: [
        {
          ...candidate(copy.operationId, "copy", optIrValueId(20), optIrValueId(21)),
          erasureFactIds: [],
        },
        {
          ...candidate(cleanup.operationId, "wrapper", optIrValueId(22), optIrValueId(23)),
          hasObservableCleanup: true,
        },
      ],
    });

    expect(result.operations.map((entry) => entry.operationId)).toEqual([
      copy.operationId,
      cleanup.operationId,
    ]);
    expect(result.eliminatedOperationIds).toEqual([]);
    expect(result.rejectedCandidates).toEqual([
      { operationId: copy.operationId, reason: "missingErasureFact" },
      { operationId: cleanup.operationId, reason: "observableCleanup" },
    ]);
  });

  test("construction fails instead of falling back when semantic-inline policy table is absent", () => {
    const input = packetParserDemoInputForTest();
    const result = buildOptimizedOptIr({
      ...input,
      handoff: { ...input.handoff, semanticInlinePolicies: undefined } as never,
    });

    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.diagnostics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            stableDetail: expect.stringContaining("semanticInlinePolicies"),
          }),
        ]),
      );
    }
  });
});

function candidate(
  operationId: ReturnType<typeof optIrOperationId>,
  kind: "copy" | "wrapper",
  sourceValue: ReturnType<typeof optIrValueId>,
  resultValue: ReturnType<typeof optIrValueId>,
) {
  return {
    operationId,
    sourceValue,
    resultValue,
    kind,
    ownershipFactIds: [`ownership:${operationId}`],
    noaliasFactIds: [`noalias:${operationId}`],
    erasureFactIds: [`erasure:${operationId}`],
    hasObservableCleanup: false,
  };
}

function operation(operationId: number) {
  return optIrRuntimeCallOperation({
    operationId: optIrOperationId(operationId),
    callId: optIrCallId(operationId),
    target: { kind: "runtime", runtimeKey: `rewrite.${operationId}` },
    argumentIds: [],
    resultIds: [],
    resultTypes: [],
    originId: optIrOriginId(1),
  });
}
