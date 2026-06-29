import { describe, expect, test } from "bun:test";

import {
  optIrCallId,
  optIrFactId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrMemoryLoadOperation,
  optIrRuntimeCallOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { runWrelaBoundsZeroCopyForTest } from "../../../src/opt-ir/passes/wrela-optimizations";
import { rewriteLegalityObligationId } from "../../../src/opt-ir/passes/pass-contract";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";

describe("Wrela bounds and zero-copy optimization", () => {
  test("eliminates checks by re-homing bounds facts onto affected accesses", () => {
    const check = boundsCheck(1);
    const access = load(2);
    const result = runWrelaBoundsZeroCopyForTest({
      operations: [check, access],
      candidates: [
        {
          checkOperationId: check.operationId,
          affectedAccessOperationIds: [access.operationId],
          licensingFactId: optIrFactId(7),
          obligationId: rewriteLegalityObligationId("wrela:bce"),
          factChain: ["licensed-bounds:payload", "dominates:guard"],
        },
      ],
      zeroCopyAccessOperationIds: [access.operationId],
    });

    expect(result.eliminatedCheckIds).toEqual([check.operationId]);
    const rewritten = result.operations.find(
      (operation) => operation.operationId === access.operationId,
    );
    expect(rewritten?.kind).toBe("memoryLoad");
    if (rewritten?.kind !== "memoryLoad") {
      throw new Error("Expected rewritten load.");
    }
    expect(rewritten.memoryAccess.boundsAuthority).toEqual({
      kind: "passDerivedFact",
      factId: optIrFactId(7),
      obligationId: rewriteLegalityObligationId("wrela:bce"),
    });
    expect(result.explanations.map((explanation) => explanation.kind)).toEqual([
      "boundsCheckEliminated",
      "zeroCopyAccess",
    ]);
  });

  test("keeps checks unless licensing facts and rewrite obligations are present", () => {
    const result = runWrelaBoundsZeroCopyForTest({
      operations: [boundsCheck(1), boundsCheck(2)],
      candidates: [
        {
          checkOperationId: optIrOperationId(1),
          affectedAccessOperationIds: [],
          obligationId: rewriteLegalityObligationId("missing-fact"),
          factChain: [],
        },
        {
          checkOperationId: optIrOperationId(2),
          affectedAccessOperationIds: [],
          licensingFactId: optIrFactId(1),
          factChain: [],
        },
      ],
    });

    expect(result.eliminatedCheckIds).toEqual([]);
    expect(result.rejectedCandidates.map((candidate) => candidate.reason)).toEqual([
      "missingLicensingFact",
      "missingRewriteObligation",
    ]);
  });
});

function boundsCheck(operationId: number): OptIrOperation {
  return optIrRuntimeCallOperation({
    operationId: optIrOperationId(operationId),
    callId: optIrCallId(operationId),
    target: { kind: "runtime", runtimeKey: "runtime.bounds_check" },
    argumentIds: [],
    resultIds: [],
    resultTypes: [],
    originId: optIrOriginId(1),
  });
}

function load(operationId: number): OptIrOperation {
  const result = optIrMemoryLoadOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(operationId + 20),
    region: optIrRegionId(1),
    byteOffset: 0n,
    byteWidth: 4,
    alignment: 4,
    valueType: optIrUnsignedIntegerType(32),
    endian: "big",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "targetContract", authorityKey: "guarded" },
    originId: optIrOriginId(1),
  });
  if (result.kind !== "ok") {
    throw new Error("Expected load fixture.");
  }
  return result.operation;
}
