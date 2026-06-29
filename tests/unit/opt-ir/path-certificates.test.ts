import { describe, expect, test } from "bun:test";

import {
  optIrCfgEditId,
  optIrEdgeId,
  optIrFactId,
  optIrPathCertificateId,
} from "../../../src/opt-ir/ids";
import {
  importCheckedPathCertificates,
  rehomeOptIrPathCertificate,
} from "../../../src/opt-ir/facts/path-certificates";
import { verifyOptIrPathCertificates } from "../../../src/opt-ir/verify/path-certificate-verifier";
import { proofMirControlEdgeId } from "../../../src/proof-mir/ids";
import {
  checkedPathCertificateForTest,
  optIrPathCertificateForTest,
  pathCertificateImportContextForTest,
  rehomePathCertificateForTest,
} from "../../support/opt-ir/path-certificate-fixtures";

describe("OptIR path certificates", () => {
  test("imports each upstream Proof MIR edge to one fresh OptIR edge", () => {
    const firstProofEdge = proofMirControlEdgeId(10);
    const secondProofEdge = proofMirControlEdgeId(20);
    const input = pathCertificateImportContextForTest({
      certificates: [
        checkedPathCertificateForTest({
          requiredEdges: [firstProofEdge, secondProofEdge],
          requiredDominators: [firstProofEdge],
          excludedEdges: [secondProofEdge],
        }),
        checkedPathCertificateForTest({
          certificateOrdinal: 2,
          requiredEdges: [firstProofEdge],
          requiredDominators: [secondProofEdge],
          excludedEdges: [firstProofEdge],
        }),
      ],
    });

    const result = importCheckedPathCertificates(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected path certificate import to succeed.");
    }
    expect(result.edgeMap.get(firstProofEdge)).toBe(optIrEdgeId(50));
    expect(result.edgeMap.get(secondProofEdge)).toBe(optIrEdgeId(51));
    expect(result.edgeMap.size).toBe(2);
    expect(result.certificates.map((certificate) => certificate.requiredEdges)).toEqual([
      [optIrEdgeId(50), optIrEdgeId(51)],
      [optIrEdgeId(50)],
    ]);
  });

  test("rejects allocator collisions across distinct upstream Proof MIR edges", () => {
    const firstProofEdge = proofMirControlEdgeId(10);
    const secondProofEdge = proofMirControlEdgeId(20);
    const result = importCheckedPathCertificates({
      certificates: [
        checkedPathCertificateForTest({
          requiredEdges: [firstProofEdge, secondProofEdge],
          requiredDominators: [],
          excludedEdges: [],
        }),
      ],
      edgeAllocator: {
        edgeForProofMirEdge() {
          return optIrEdgeId(50);
        },
      },
      nextCertificateId: () => optIrPathCertificateId(70),
    });

    expect(result).toEqual({
      kind: "error",
      reason: "duplicateOptIrEdge",
      proofMirEdge: secondProofEdge,
    });
  });

  test("stores source fact, checked source scope, edge requirements, invalidations, and origin", () => {
    const invalidatedBy = [
      {
        kind: "cfgRewrite" as const,
        functionInstanceId: pathCertificateImportContextForTest().functionInstanceId,
      },
    ];
    const checked = checkedPathCertificateForTest({ invalidatedBy });
    const result = importCheckedPathCertificates(
      pathCertificateImportContextForTest({ certificates: [checked] }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected path certificate import to succeed.");
    }
    expect(result.certificates[0]).toMatchObject({
      source: { kind: "checkedPathCertificate", certificateId: checked.certificateId },
      checkedSourceScope: {
        kind: "path",
        certificateId: checked.certificateId,
        functionInstanceId: checked.functionInstanceId,
      },
      requiredEdges: [optIrEdgeId(50)],
      requiredDominators: [optIrEdgeId(50)],
      excludedEdges: [optIrEdgeId(51)],
      invalidatedBy,
      origin: checked.origin,
    });
  });

  test("re-homes required edges to non-empty implied paths with lineage", () => {
    const certificate = optIrPathCertificateForTest({ requiredEdges: [optIrEdgeId(1)] });

    const result = rehomePathCertificateForTest({
      certificate,
      implications: [
        {
          oldEdge: optIrEdgeId(1),
          newPath: [optIrEdgeId(7), optIrEdgeId(8)],
          conditionFacts: [optIrFactId(3)],
          cfgEdit: optIrCfgEditId(2),
        },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      throw new Error("Expected path certificate re-home to succeed.");
    }
    expect(result.certificate.certificateId).not.toBe(certificate.certificateId);
    expect(result.certificate.requiredEdges).toEqual([optIrEdgeId(7), optIrEdgeId(8)]);
    expect(result.certificate.excludedEdges).toEqual([]);
    expect(result.certificate.lineage).toEqual({
      kind: "rehome",
      checkedCertificateId: certificate.source.certificateId,
      previousCertificateId: certificate.certificateId,
      cfgEditIds: [optIrCfgEditId(2)],
      factIds: [optIrFactId(3)],
    });
  });

  test("fails closed when implication evidence is incomplete or invalidated", () => {
    const certificate = optIrPathCertificateForTest({
      requiredEdges: [optIrEdgeId(1)],
      requiredDominators: [optIrEdgeId(2)],
      excludedEdges: [optIrEdgeId(3)],
    });
    const invalidation = certificate.invalidatedBy[0];
    if (invalidation === undefined) {
      throw new Error("Expected fixture to include an invalidation trigger.");
    }

    expect(rehomePathCertificateForTest({ certificate, implications: [] })).toMatchObject({
      kind: "dropped",
      reason: "missingRequiredEdgeImplication",
    });
    expect(
      rehomePathCertificateForTest({
        certificate,
        implications: [{ oldEdge: optIrEdgeId(1), newPath: [], conditionFacts: [] }],
      }),
    ).toMatchObject({ kind: "dropped", reason: "emptyRequiredEdgePath" });
    expect(
      rehomePathCertificateForTest({
        certificate,
        implications: [{ oldEdge: optIrEdgeId(1), newPath: [optIrEdgeId(4)], conditionFacts: [] }],
        survivingEdges: new Set([optIrEdgeId(3)]),
      }),
    ).toMatchObject({ kind: "dropped", reason: "excludedEdgeSurvives" });
    expect(
      rehomePathCertificateForTest({
        certificate,
        implications: [{ oldEdge: optIrEdgeId(1), newPath: [optIrEdgeId(4)], conditionFacts: [] }],
        dominates: () => false,
      }),
    ).toMatchObject({ kind: "dropped", reason: "dominatorNoLongerDominates" });
    expect(
      rehomePathCertificateForTest({
        certificate,
        implications: [{ oldEdge: optIrEdgeId(1), newPath: [optIrEdgeId(4)], conditionFacts: [] }],
        crossedInvalidations: [invalidation],
      }),
    ).toMatchObject({ kind: "dropped", reason: "invalidationTriggerCrossed" });
  });

  test("does not mutate the original certificate during re-homing", () => {
    const certificate = optIrPathCertificateForTest({ requiredEdges: [optIrEdgeId(1)] });
    const before = certificate.requiredEdges;

    const result = rehomeOptIrPathCertificate({
      certificate,
      implications: [{ oldEdge: optIrEdgeId(1), newPath: [optIrEdgeId(2)], conditionFacts: [] }],
      cfgEditId: optIrCfgEditId(1),
      nextCertificateId: () =>
        optIrPathCertificateForTest({ certificateOrdinal: 99 }).certificateId,
      dominates: () => true,
      survivingEdges: new Set(),
      crossedInvalidations: [],
    });

    expect(result.kind).toBe("ok");
    expect(certificate.requiredEdges).toBe(before);
    expect(certificate.requiredEdges).toEqual([optIrEdgeId(1)]);
    expect(Object.isFrozen(certificate)).toBe(true);
    expect(Object.isFrozen(certificate.requiredEdges)).toBe(true);
  });

  test("verifier rejects malformed path certificates", () => {
    const diagnostics = verifyOptIrPathCertificates({
      certificates: [
        optIrPathCertificateForTest({
          requiredEdges: [],
          requiredDominators: [optIrEdgeId(2)],
          excludedEdges: [],
        }),
        optIrPathCertificateForTest({
          certificateOrdinal: 2,
          requiredEdges: [optIrEdgeId(1)],
          requiredDominators: [optIrEdgeId(2)],
          excludedEdges: [],
        }),
      ],
      edges: new Set([optIrEdgeId(1)]),
      dominates: () => false,
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "OPT_IR_PATH_CERTIFICATE_EMPTY",
      "OPT_IR_PATH_CERTIFICATE_EDGE_MISSING",
      "OPT_IR_PATH_CERTIFICATE_EDGE_MISSING",
      "OPT_IR_PATH_CERTIFICATE_DOMINATOR_INVALID",
    ]);
  });
});
