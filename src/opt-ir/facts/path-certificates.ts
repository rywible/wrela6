import type { MonoInstanceId } from "../../mono/ids";
import type { CheckedPathCertificate } from "../../proof-check/model/opt-ir-handoff";
import type {
  CheckedFactInvalidation,
  CheckedOriginFact,
} from "../../proof-check/model/fact-packet";
import type { CheckedPathCertificateId } from "../../proof-check/model/certificates";
import type { ProofMirControlEdgeId } from "../../proof-mir/ids";
import type {
  OptIrCfgEditId,
  OptIrEdgeId,
  OptIrFactId,
  OptIrOriginId,
  OptIrPathCertificateId,
} from "../ids";

export interface OptIrPathCertificateSource {
  readonly kind: "checkedPathCertificate";
  readonly certificateId: CheckedPathCertificateId;
}

export interface OptIrPathCertificateSourceScope {
  readonly kind: "path";
  readonly certificateId: CheckedPathCertificateId;
  readonly functionInstanceId: MonoInstanceId;
}

export type OptIrPathCertificateLineage =
  | {
      readonly kind: "checked";
      readonly checkedCertificateId: CheckedPathCertificateId;
    }
  | {
      readonly kind: "rehome";
      readonly checkedCertificateId: CheckedPathCertificateId;
      readonly previousCertificateId: OptIrPathCertificateId;
      readonly cfgEditIds: readonly OptIrCfgEditId[];
      readonly factIds: readonly OptIrFactId[];
    };

export interface OptIrPathCertificate {
  readonly certificateId: OptIrPathCertificateId;
  readonly source: OptIrPathCertificateSource;
  readonly checkedSourceScope: OptIrPathCertificateSourceScope;
  readonly requiredEdges: readonly OptIrEdgeId[];
  readonly requiredDominators: readonly OptIrEdgeId[];
  readonly excludedEdges: readonly OptIrEdgeId[];
  readonly invalidatedBy: readonly CheckedFactInvalidation[];
  readonly origin: CheckedOriginFact;
  readonly originId?: OptIrOriginId;
  readonly lineage: OptIrPathCertificateLineage;
}

export interface PathCertificateEdgeAllocator {
  readonly edgeForProofMirEdge: (edgeId: ProofMirControlEdgeId) => OptIrEdgeId;
}

export type ImportCheckedPathCertificatesResult =
  | {
      readonly kind: "ok";
      readonly certificates: readonly OptIrPathCertificate[];
      readonly edgeMap: ReadonlyMap<ProofMirControlEdgeId, OptIrEdgeId>;
    }
  | {
      readonly kind: "error";
      readonly reason: "duplicateOptIrEdge";
      readonly proofMirEdge: ProofMirControlEdgeId;
    };

export function importCheckedPathCertificates(input: {
  readonly certificates: readonly CheckedPathCertificate[];
  readonly edgeAllocator: PathCertificateEdgeAllocator;
  readonly nextCertificateId: () => OptIrPathCertificateId;
  readonly originId?: OptIrOriginId;
}): ImportCheckedPathCertificatesResult {
  const edgeMap = new Map<ProofMirControlEdgeId, OptIrEdgeId>();
  const proofMirEdgeByOptIrEdge = new Map<OptIrEdgeId, ProofMirControlEdgeId>();

  const mapEdge = (
    edgeId: ProofMirControlEdgeId,
  ):
    | { readonly kind: "ok"; readonly edgeId: OptIrEdgeId }
    | { readonly kind: "error"; readonly proofMirEdge: ProofMirControlEdgeId } => {
    const existing = edgeMap.get(edgeId);
    if (existing !== undefined) {
      return { kind: "ok", edgeId: existing };
    }
    const freshEdge = input.edgeAllocator.edgeForProofMirEdge(edgeId);
    const existingProofMirEdge = proofMirEdgeByOptIrEdge.get(freshEdge);
    if (existingProofMirEdge !== undefined && existingProofMirEdge !== edgeId) {
      return { kind: "error", proofMirEdge: edgeId };
    }
    edgeMap.set(edgeId, freshEdge);
    proofMirEdgeByOptIrEdge.set(freshEdge, edgeId);
    return { kind: "ok", edgeId: freshEdge };
  };

  const certificates: OptIrPathCertificate[] = [];
  for (const certificate of input.certificates) {
    const requiredEdges = mapEdges(certificate.requiredEdges, mapEdge);
    if (requiredEdges.kind === "error") {
      return {
        kind: "error",
        reason: "duplicateOptIrEdge",
        proofMirEdge: requiredEdges.proofMirEdge,
      };
    }
    const requiredDominators = mapEdges(certificate.requiredDominators, mapEdge);
    if (requiredDominators.kind === "error") {
      return {
        kind: "error",
        reason: "duplicateOptIrEdge",
        proofMirEdge: requiredDominators.proofMirEdge,
      };
    }
    const excludedEdges = mapEdges(certificate.excludedEdges, mapEdge);
    if (excludedEdges.kind === "error") {
      return {
        kind: "error",
        reason: "duplicateOptIrEdge",
        proofMirEdge: excludedEdges.proofMirEdge,
      };
    }

    certificates.push(
      freezePathCertificate({
        certificateId: input.nextCertificateId(),
        source: {
          kind: "checkedPathCertificate",
          certificateId: certificate.certificateId,
        },
        checkedSourceScope: {
          kind: "path",
          certificateId: certificate.certificateId,
          functionInstanceId: certificate.functionInstanceId,
        },
        requiredEdges: requiredEdges.edgeIds,
        requiredDominators: requiredDominators.edgeIds,
        excludedEdges: excludedEdges.edgeIds,
        invalidatedBy: certificate.invalidatedBy,
        origin: certificate.origin,
        ...(input.originId === undefined ? {} : { originId: input.originId }),
        lineage: {
          kind: "checked",
          checkedCertificateId: certificate.certificateId,
        },
      }),
    );
  }

  return { kind: "ok", certificates, edgeMap };
}

export interface OptIrEdgeImplication {
  readonly oldEdge: OptIrEdgeId;
  readonly newPath: readonly OptIrEdgeId[];
  readonly conditionFacts: readonly OptIrFactId[];
  readonly cfgEdit?: OptIrCfgEditId;
}

export type RehomePathCertificateDropReason =
  | "missingRequiredEdgeImplication"
  | "emptyRequiredEdgePath"
  | "excludedEdgeSurvives"
  | "dominatorNoLongerDominates"
  | "invalidationTriggerCrossed";

export type RehomePathCertificateResult =
  | { readonly kind: "ok"; readonly certificate: OptIrPathCertificate }
  | {
      readonly kind: "dropped";
      readonly reason: RehomePathCertificateDropReason;
      readonly edgeId?: OptIrEdgeId;
    };

export function rehomeOptIrPathCertificate(input: {
  readonly certificate: OptIrPathCertificate;
  readonly implications: readonly OptIrEdgeImplication[];
  readonly cfgEditId?: OptIrCfgEditId;
  readonly nextCertificateId: () => OptIrPathCertificateId;
  readonly dominates: (dominator: OptIrEdgeId, edge: OptIrEdgeId) => boolean;
  readonly survivingEdges: ReadonlySet<OptIrEdgeId>;
  readonly crossedInvalidations: readonly CheckedFactInvalidation[];
}): RehomePathCertificateResult {
  if (input.crossedInvalidations.length > 0) {
    return { kind: "dropped", reason: "invalidationTriggerCrossed" };
  }

  for (const excludedEdge of input.certificate.excludedEdges) {
    if (input.survivingEdges.has(excludedEdge)) {
      return { kind: "dropped", reason: "excludedEdgeSurvives", edgeId: excludedEdge };
    }
  }

  const implicationsByOldEdge = new Map<OptIrEdgeId, OptIrEdgeImplication>(
    input.implications.map((implication) => [implication.oldEdge, implication]),
  );
  const requiredEdges: OptIrEdgeId[] = [];
  const factIds: OptIrFactId[] = [];
  const cfgEditIds: OptIrCfgEditId[] = [];

  for (const edgeId of input.certificate.requiredEdges) {
    const implication = implicationsByOldEdge.get(edgeId);
    if (implication === undefined) {
      return { kind: "dropped", reason: "missingRequiredEdgeImplication", edgeId };
    }
    if (implication.newPath.length === 0) {
      return { kind: "dropped", reason: "emptyRequiredEdgePath", edgeId };
    }
    requiredEdges.push(...implication.newPath);
    factIds.push(...implication.conditionFacts);
    if (implication.cfgEdit !== undefined) {
      cfgEditIds.push(implication.cfgEdit);
    }
  }

  const requiredDominators = [...input.certificate.requiredDominators];
  for (const dominator of requiredDominators) {
    for (const edgeId of requiredEdges) {
      if (!input.dominates(dominator, edgeId)) {
        return { kind: "dropped", reason: "dominatorNoLongerDominates", edgeId: dominator };
      }
    }
  }

  const cfgEditLineage = uniqueIds([
    ...(input.cfgEditId === undefined ? [] : [input.cfgEditId]),
    ...cfgEditIds,
  ]);

  return {
    kind: "ok",
    certificate: freezePathCertificate({
      ...input.certificate,
      certificateId: input.nextCertificateId(),
      requiredEdges,
      requiredDominators,
      excludedEdges: [],
      lineage: {
        kind: "rehome",
        checkedCertificateId: input.certificate.source.certificateId,
        previousCertificateId: input.certificate.certificateId,
        cfgEditIds: cfgEditLineage,
        factIds: uniqueIds(factIds),
      },
    }),
  };
}

function mapEdges(
  edgeIds: readonly ProofMirControlEdgeId[],
  mapEdge: (
    edgeId: ProofMirControlEdgeId,
  ) =>
    | { readonly kind: "ok"; readonly edgeId: OptIrEdgeId }
    | { readonly kind: "error"; readonly proofMirEdge: ProofMirControlEdgeId },
):
  | { readonly kind: "ok"; readonly edgeIds: readonly OptIrEdgeId[] }
  | { readonly kind: "error"; readonly proofMirEdge: ProofMirControlEdgeId } {
  const mappedEdges: OptIrEdgeId[] = [];
  for (const edgeId of edgeIds) {
    const mappedEdge = mapEdge(edgeId);
    if (mappedEdge.kind === "error") {
      return mappedEdge;
    }
    mappedEdges.push(mappedEdge.edgeId);
  }
  return { kind: "ok", edgeIds: mappedEdges };
}

export function freezePathCertificate(certificate: OptIrPathCertificate): OptIrPathCertificate {
  return Object.freeze({
    ...certificate,
    source: Object.freeze({ ...certificate.source }),
    checkedSourceScope: Object.freeze({ ...certificate.checkedSourceScope }),
    requiredEdges: Object.freeze([...certificate.requiredEdges]),
    requiredDominators: Object.freeze([...certificate.requiredDominators]),
    excludedEdges: Object.freeze([...certificate.excludedEdges]),
    invalidatedBy: Object.freeze([...certificate.invalidatedBy]),
    origin: Object.freeze({ ...certificate.origin }),
    lineage: Object.freeze({
      ...certificate.lineage,
      ...(certificate.lineage.kind === "rehome"
        ? {
            cfgEditIds: Object.freeze([...certificate.lineage.cfgEditIds]),
            factIds: Object.freeze([...certificate.lineage.factIds]),
          }
        : {}),
    }),
  });
}

function uniqueIds<Identifier extends number>(ids: readonly Identifier[]): readonly Identifier[] {
  return [...new Set(ids)];
}
