import { describe, expect, test } from "bun:test";

import {
  lowerValidatedBufferReadForTest,
  validateOptIrValidatedBufferAccesses,
  type OptIrValidatedBufferAccess,
} from "../../../src/opt-ir/lower/validated-buffer-reads";
import {
  optIrEdgeId,
  optIrFactId,
  optIrOperationId,
  optIrPathCertificateId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { rewriteLegalityObligationId } from "../../../src/opt-ir/passes/pass-contract";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";

describe("OptIR validated-buffer read lowering", () => {
  test("lowers check-free packet reads with certified bounds and layout metadata", () => {
    const access = lowerValidatedBufferReadForTest({
      fieldName: "ethertype",
      offsetBytes: 12n,
      widthBytes: 2n,
      wireEndian: "big",
      boundsAuthority: { kind: "certifiedFact", factId: optIrFactId(1) },
      readRequires: [{ kind: "fieldAvailable", fieldId: "field:ethertype" }],
      pathCertificates: [optIrPathCertificateId(7)],
    });

    expect(access.regionKind).toBe("packetSource");
    expect(access.boundsAuthority).toEqual({
      kind: "certifiedFact",
      factId: optIrFactId(1),
    });
    expect(access.endian).toBe("big");
    expect(access.layoutPath).toEqual(["ethertype"]);
    expect(access.metadata.readRequires).toEqual([
      { kind: "fieldAvailable", fieldId: "field:ethertype" },
    ]);
    expect(access.metadata.pathCertificates).toEqual([optIrPathCertificateId(7)]);
    expect(Object.isFrozen(access)).toBe(true);
    expect(Object.isFrozen(access.metadata)).toBe(true);
    expect(Object.isFrozen(access.metadata.readRequires)).toBe(true);
    expect(Object.isFrozen(access.metadata.pathCertificates)).toBe(true);
  });

  test("keeps pass-derived authority explicit when a later pass removes the guard", () => {
    const access = lowerValidatedBufferReadForTest({
      fieldName: "payload",
      offsetBytes: 14n,
      widthBytes: 20n,
      wireEndian: "target",
      boundsAuthority: {
        kind: "passDerivedFact",
        factId: optIrFactId(3),
        obligationId: rewriteLegalityObligationId("bce:guard-10"),
      },
    });

    expect(access.boundsAuthority).toEqual({
      kind: "passDerivedFact",
      factId: optIrFactId(3),
      obligationId: rewriteLegalityObligationId("bce:guard-10"),
    });
    expect(validateOptIrValidatedBufferAccesses({ accesses: [access] })).toEqual({ kind: "ok" });
  });

  test("rejects check-free source reads without certified or pass-derived facts", () => {
    const access = lowerValidatedBufferReadForTest({
      regionKind: "sourceAggregate",
      fieldName: "payload",
      offsetBytes: 0n,
      widthBytes: 1n,
      wireEndian: "target",
      boundsAuthority: { kind: "constructionSize" },
    });

    const result = validateOptIrValidatedBufferAccesses({ accesses: [access] });

    expect(result.kind).toBe("error");
    expect(result.kind === "error" ? result.diagnostics[0]?.stableDetail : "").toBe(
      "validated-buffer-authority:construction-size",
    );
  });

  test("records runtime guard operation, success edge, byte range, and dominance", () => {
    const access = lowerValidatedBufferReadForTest({
      fieldName: "ihl",
      offsetBytes: 0n,
      widthBytes: 1n,
      wireEndian: "little",
      boundsAuthority: {
        kind: "runtimeGuard",
        guard: {
          guardOperation: optIrOperationId(10),
          successEdge: optIrEdgeId(20),
          checkedByteRange: { start: 0n, endExclusive: 1n },
          dominatesAccess: true,
        },
      },
    });

    expect(access.boundsAuthority).toEqual({
      kind: "runtimeGuard",
      guard: {
        guardOperation: optIrOperationId(10),
        successEdge: optIrEdgeId(20),
        checkedByteRange: { start: 0n, endExclusive: 1n },
        dominatesAccess: true,
      },
    });
  });

  test("rejects runtime-guarded access after the guard operation is removed", () => {
    const access = packetLoadWithRemovedRuntimeGuardForTest();

    const result = validateOptIrValidatedBufferAccesses({
      accesses: [access],
      guardOperations: new Set(),
      successEdges: new Set([optIrEdgeId(20)]),
      dominates: () => true,
    });

    expect(result.kind).toBe("error");
    expect(result.kind === "error" ? result.diagnostics[0]?.stableDetail : "").toBe(
      "validated-buffer-runtime-guard-missing:10",
    );
  });
});

function packetLoadWithRemovedRuntimeGuardForTest(): OptIrValidatedBufferAccess {
  return lowerValidatedBufferReadForTest({
    region: optIrRegionId(1),
    byteOffset: optIrValueId(2),
    valueType: optIrUnsignedIntegerType(8),
    fieldName: "ihl",
    offsetBytes: 0n,
    widthBytes: 1n,
    wireEndian: "little",
    boundsAuthority: {
      kind: "runtimeGuard",
      guard: {
        guardOperation: optIrOperationId(10),
        successEdge: optIrEdgeId(20),
        checkedByteRange: { start: 0n, endExclusive: 1n },
        dominatesAccess: true,
      },
    },
  });
}
