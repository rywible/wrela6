import { describe, expect, test } from "bun:test";

import {
  lowerValidatedBufferReadForTest,
  validateOptIrValidatedBufferAccesses,
} from "../../../src/opt-ir/lower/validated-buffer-reads";
import { optIrEdgeId, optIrFactId, optIrOperationId } from "../../../src/opt-ir/ids";
import { rewriteLegalityObligationId } from "../../../src/opt-ir/passes/pass-contract";

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
});
