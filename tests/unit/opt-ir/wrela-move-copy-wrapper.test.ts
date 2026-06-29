import { describe, expect, test } from "bun:test";

import {
  optIrCallId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrRuntimeCallOperation } from "../../../src/opt-ir/operations";
import { runWrelaMoveCopyWrapperElisionForTest } from "../../../src/opt-ir/passes/wrela-optimizations";

describe("Wrela move/copy/wrapper elision", () => {
  test("removes moves only with ownership, noalias, erasure facts, and no observable cleanup", () => {
    const removable = callOperation(1);
    const observable = callOperation(2);

    const result = runWrelaMoveCopyWrapperElisionForTest({
      operations: [removable, observable],
      candidates: [
        {
          operationId: removable.operationId,
          sourceValue: optIrValueId(10),
          resultValue: optIrValueId(11),
          kind: "copy",
          ownershipFactIds: ["owned:packet"],
          noaliasFactIds: ["noalias:packet"],
          erasureFactIds: ["erased:copy"],
          hasObservableCleanup: false,
        },
        {
          operationId: observable.operationId,
          sourceValue: optIrValueId(12),
          resultValue: optIrValueId(13),
          kind: "copy",
          ownershipFactIds: ["owned:packet"],
          noaliasFactIds: ["noalias:packet"],
          erasureFactIds: ["erased:copy"],
          hasObservableCleanup: true,
        },
      ],
    });

    expect(result.operations.map((operation) => operation.operationId)).toEqual([
      observable.operationId,
    ]);
    expect(result.valueForwards).toEqual([
      { sourceValue: optIrValueId(11), replacementValue: optIrValueId(10) },
    ]);
    expect(result.rejectedCandidates).toEqual([
      { operationId: observable.operationId, reason: "observableCleanup" },
    ]);
    expect(result.explanations[0]).toMatchObject({
      kind: "copyEliminated",
      operationId: removable.operationId,
      factChain: ["owned:packet", "noalias:packet", "erased:copy"],
    });
  });

  test("rejects wrappers when any required fact family is absent", () => {
    const result = runWrelaMoveCopyWrapperElisionForTest({
      operations: [callOperation(1), callOperation(2), callOperation(3)],
      candidates: [
        candidate(1, [], ["noalias"], ["erased"]),
        candidate(2, ["owned"], [], ["erased"]),
        candidate(3, ["owned"], ["noalias"], []),
      ],
    });

    expect(result.eliminatedOperationIds).toEqual([]);
    expect(result.rejectedCandidates.map((candidate) => candidate.reason)).toEqual([
      "missingOwnershipFact",
      "missingNoaliasFact",
      "missingErasureFact",
    ]);
  });
});

function candidate(
  operationId: number,
  ownershipFactIds: readonly string[],
  noaliasFactIds: readonly string[],
  erasureFactIds: readonly string[],
) {
  return {
    operationId: optIrOperationId(operationId),
    sourceValue: optIrValueId(operationId + 10),
    resultValue: optIrValueId(operationId + 20),
    kind: "wrapper" as const,
    ownershipFactIds,
    noaliasFactIds,
    erasureFactIds,
    hasObservableCleanup: false,
  };
}

function callOperation(operationId: number) {
  return optIrRuntimeCallOperation({
    operationId: optIrOperationId(operationId),
    callId: optIrCallId(operationId),
    target: { kind: "runtime", runtimeKey: `runtime.${operationId}` },
    argumentIds: [],
    resultIds: [optIrValueId(operationId + 20)],
    resultTypes: [],
    originId: optIrOriginId(1),
  });
}
