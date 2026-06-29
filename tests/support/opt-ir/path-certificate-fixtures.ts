import { monoInstanceId } from "../../../src/mono/ids";
import {
  importCheckedPathCertificates,
  rehomeOptIrPathCertificate,
  freezePathCertificate,
  type OptIrEdgeImplication,
  type OptIrPathCertificate,
  type RehomePathCertificateResult,
} from "../../../src/opt-ir/facts/path-certificates";
import {
  optIrCfgEditId,
  optIrEdgeId,
  optIrOriginId,
  optIrPathCertificateId,
  type OptIrEdgeId,
  type OptIrOriginId,
} from "../../../src/opt-ir/ids";
import { proofCheckPathCertificateId } from "../../../src/proof-check/ids";
import type { CheckedPathCertificate } from "../../../src/proof-check/model/opt-ir-handoff";
import type { CheckedFactInvalidation } from "../../../src/proof-check/model/fact-packet";
import {
  proofMirControlEdgeId,
  proofMirOriginId,
  type ProofMirControlEdgeId,
} from "../../../src/proof-mir/ids";

export function checkedPathCertificateForTest(
  input: Partial<CheckedPathCertificate> & { readonly certificateOrdinal?: number } = {},
): CheckedPathCertificate {
  const functionInstanceId = input.functionInstanceId ?? monoInstanceId("test::path");
  return {
    certificateId:
      input.certificateId ?? proofCheckPathCertificateId(input.certificateOrdinal ?? 1),
    functionInstanceId,
    requiredEdges: input.requiredEdges ?? [proofMirControlEdgeId(1)],
    requiredDominators: input.requiredDominators ?? [proofMirControlEdgeId(1)],
    excludedEdges: input.excludedEdges ?? [proofMirControlEdgeId(2)],
    invalidatedBy: input.invalidatedBy ?? [{ kind: "cfgRewrite", functionInstanceId }],
    origin: input.origin ?? {
      originKey: `opt-ir:path-certificate:${input.certificateOrdinal ?? 1}`,
      proofMirOriginId: proofMirOriginId(input.certificateOrdinal ?? 1),
    },
  };
}

export function pathCertificateImportContextForTest(
  input: {
    readonly certificates?: readonly CheckedPathCertificate[];
    readonly firstEdgeId?: number;
    readonly firstCertificateId?: number;
    readonly originId?: OptIrOriginId;
  } = {},
) {
  const certificates = input.certificates ?? [checkedPathCertificateForTest()];
  const edgeIdsByProofEdge = new Map<ProofMirControlEdgeId, OptIrEdgeId>();
  let nextEdgeOrdinal = input.firstEdgeId ?? 50;
  let nextCertificateOrdinal = input.firstCertificateId ?? 70;

  return {
    certificates,
    functionInstanceId: certificates[0]?.functionInstanceId ?? monoInstanceId("test::path"),
    originId: input.originId ?? optIrOriginId(1),
    edgeAllocator: {
      edgeForProofMirEdge(edgeId: ProofMirControlEdgeId): OptIrEdgeId {
        const existing = edgeIdsByProofEdge.get(edgeId);
        if (existing !== undefined) {
          return existing;
        }
        const nextEdgeId = optIrEdgeId(nextEdgeOrdinal);
        nextEdgeOrdinal += 1;
        edgeIdsByProofEdge.set(edgeId, nextEdgeId);
        return nextEdgeId;
      },
    },
    nextCertificateId() {
      const certificateId = optIrPathCertificateId(nextCertificateOrdinal);
      nextCertificateOrdinal += 1;
      return certificateId;
    },
  };
}

export function optIrPathCertificateForTest(
  input: Partial<OptIrPathCertificate> & { readonly certificateOrdinal?: number } = {},
): OptIrPathCertificate {
  const checked = checkedPathCertificateForTest({
    certificateOrdinal: input.certificateOrdinal ?? 1,
  });
  return freezePathCertificate({
    certificateId: input.certificateId ?? optIrPathCertificateId(input.certificateOrdinal ?? 1),
    source: input.source ?? {
      kind: "checkedPathCertificate",
      certificateId: checked.certificateId,
    },
    checkedSourceScope: input.checkedSourceScope ?? {
      kind: "path",
      certificateId: checked.certificateId,
      functionInstanceId: checked.functionInstanceId,
    },
    requiredEdges: input.requiredEdges ?? [optIrEdgeId(1)],
    requiredDominators: input.requiredDominators ?? [optIrEdgeId(1)],
    excludedEdges: input.excludedEdges ?? [optIrEdgeId(2)],
    invalidatedBy: input.invalidatedBy ?? checked.invalidatedBy,
    origin: input.origin ?? checked.origin,
    originId: input.originId ?? optIrOriginId(1),
    lineage: input.lineage ?? {
      kind: "checked",
      checkedCertificateId: checked.certificateId,
    },
  });
}

export function rehomePathCertificateForTest(input: {
  readonly certificate: OptIrPathCertificate;
  readonly implications: readonly OptIrEdgeImplication[];
  readonly survivingEdges?: ReadonlySet<OptIrEdgeId>;
  readonly crossedInvalidations?: readonly CheckedFactInvalidation[];
  readonly dominates?: (dominator: OptIrEdgeId, edge: OptIrEdgeId) => boolean;
}): RehomePathCertificateResult {
  return rehomeOptIrPathCertificate({
    certificate: input.certificate,
    implications: input.implications,
    cfgEditId: optIrCfgEditId(2),
    nextCertificateId: () => optIrPathCertificateId(100),
    dominates: input.dominates ?? (() => true),
    survivingEdges: input.survivingEdges ?? new Set(),
    crossedInvalidations: input.crossedInvalidations ?? [],
  });
}

export function importPathCertificatesForTest(
  input: Parameters<typeof pathCertificateImportContextForTest>[0] = {},
) {
  return importCheckedPathCertificates(pathCertificateImportContextForTest(input));
}
