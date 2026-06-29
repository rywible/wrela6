import { describe, expect, test } from "bun:test";

import {
  optIrCallId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrRuntimeCallOperation } from "../../../src/opt-ir/operations";
import { runWrelaMoveCopyWrapperElisionForTest } from "../../../src/opt-ir/passes/wrela-optimizations";

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
