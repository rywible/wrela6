import { describe, expect, test } from "bun:test";

import {
  lowerValidatedBufferReadForTest,
  validateOptIrValidatedBufferAccesses,
} from "../../../src/opt-ir/lower/validated-buffer-reads";
import { optIrEdgeId, optIrFactId, optIrOperationId } from "../../../src/opt-ir/ids";
import { rewriteLegalityObligationId } from "../../../src/opt-ir/passes/pass-contract";
import { runWrelaBoundsZeroCopyForTest } from "../../../src/opt-ir/passes/wrela-optimizations";
import {
  optIrMemoryLoadOperation,
  optIrRuntimeCallOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { optIrCallId, optIrOriginId, optIrRegionId, optIrValueId } from "../../../src/opt-ir/ids";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";

describe("OptIR validated-buffer optimization integration", () => {
  test("requires access authority to be updated when bounds-check elimination removes a guard", () => {
    const guarded = lowerValidatedBufferReadForTest({
      fieldName: "payload",
      offsetBytes: 14n,
      widthBytes: 4n,
      wireEndian: "big",
      boundsAuthority: {
        kind: "runtimeGuard",
        guard: {
          guardOperation: optIrOperationId(10),
          successEdge: optIrEdgeId(20),
          checkedByteRange: { start: 14n, endExclusive: 18n },
          dominatesAccess: true,
        },
      },
    });

    expect(
      validateOptIrValidatedBufferAccesses({
        accesses: [guarded],
        guardOperations: new Set(),
        successEdges: new Set([optIrEdgeId(20)]),
        dominates: () => true,
      }).kind,
    ).toBe("error");

    const rewritten = {
      ...guarded,
      boundsAuthority: {
        kind: "passDerivedFact" as const,
        factId: optIrFactId(4),
        obligationId: rewriteLegalityObligationId("bce:payload"),
      },
    };

    expect(
      validateOptIrValidatedBufferAccesses({
        accesses: [rewritten],
        guardOperations: new Set(),
      }),
    ).toEqual({ kind: "ok" });
  });

  test("Wrela bounds optimization rewrites guarded loads into check-free accesses", () => {
    const check = optIrRuntimeCallOperation({
      operationId: optIrOperationId(10),
      callId: optIrCallId(10),
      target: { kind: "runtime", runtimeKey: "runtime.bounds_check" },
      argumentIds: [],
      resultIds: [],
      resultTypes: [],
      originId: optIrOriginId(1),
    });
    const access = loadOperation();

    const result = runWrelaBoundsZeroCopyForTest({
      operations: [check, access],
      candidates: [
        {
          checkOperationId: check.operationId,
          affectedAccessOperationIds: [access.operationId],
          licensingFactId: optIrFactId(4),
          obligationId: rewriteLegalityObligationId("bce:payload"),
          factChain: ["licensed:payload", "path:success"],
        },
      ],
    });

    expect(result.eliminatedCheckIds).toEqual([check.operationId]);
    const rewritten = result.operations.find(
      (operation) => operation.operationId === access.operationId,
    );
    expect(rewritten?.kind).toBe("memoryLoad");
    if (rewritten?.kind !== "memoryLoad") {
      throw new Error("Expected load after rewrite.");
    }
    expect(rewritten.memoryAccess.boundsAuthority).toEqual({
      kind: "validatedBuffer",
      authorityKey: "pass-derived:4:bce:payload",
    });
  });
});

function loadOperation(): OptIrOperation {
  const result = optIrMemoryLoadOperation({
    operationId: optIrOperationId(11),
    resultId: optIrValueId(30),
    region: optIrRegionId(1),
    byteOffset: 14n,
    byteWidth: 4,
    alignment: 4,
    valueType: optIrUnsignedIntegerType(32),
    endian: "big",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "targetContract", authorityKey: "guarded" },
    originId: optIrOriginId(1),
  });
  if (result.kind !== "ok") {
    throw new Error("Expected validated-buffer load fixture.");
  }
  return result.operation;
}
