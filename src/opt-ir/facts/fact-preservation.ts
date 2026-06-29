import type { CheckedPacketFactKind } from "../../proof-check/model/fact-packet";
import type { FactPreservationRuleId, RewriteLegalityObligationId } from "../passes/pass-contract";
import type { OptIrCfgEditId, OptIrFactId, OptIrPathCertificateId } from "../ids";
import {
  rehomeOptIrPathCertificate,
  type OptIrEdgeImplication,
  type OptIrPathCertificate,
  type RehomePathCertificateDropReason,
} from "./path-certificates";
import {
  remapOptionalOptIrFactSubject,
  type OptIrFactSubject,
  type OptIrSubjectRemapTable,
} from "./subject-remapping";

export type OptIrFactScope =
  | { readonly kind: "function"; readonly functionId: number }
  | { readonly kind: "path"; readonly certificateId: OptIrPathCertificateId };

export interface OptIrCheckedFactForPreservation {
  readonly factId: OptIrFactId;
  readonly kind: CheckedPacketFactKind | string;
  readonly subject: OptIrFactSubject;
  readonly scope: OptIrFactScope;
  readonly dependencies: readonly OptIrFactSubject[];
  readonly invalidations: readonly unknown[];
  readonly pathCertificateId?: OptIrPathCertificateId;
  readonly origin?: unknown;
}

export interface OptIrPreservedFact {
  readonly factId: OptIrFactId;
  readonly kind: CheckedPacketFactKind | string;
  readonly subject: OptIrFactSubject;
  readonly scope: OptIrFactScope;
  readonly dependencies: readonly OptIrFactSubject[];
  readonly invalidations: readonly unknown[];
  readonly pathCertificateId?: OptIrPathCertificateId;
  readonly origin?: unknown;
  readonly lineage: OptIrPreservedFactLineage;
}

export interface OptIrPreservedFactLineage {
  readonly kind: "preservedCheckedFact";
  readonly sourceFactId: OptIrFactId;
  readonly ruleId: FactPreservationRuleId | string;
  readonly obligationId: RewriteLegalityObligationId | string;
  readonly remappedFrom: OptIrFactSubject;
}

export type OptIrDroppedFactReason =
  | "subjectDropped"
  | "dependencyDropped"
  | "pathCertificateMismatch"
  | "pathCertificateMissing"
  | "pathCertificateDropped"
  | "invalidated";

export interface OptIrDroppedFact {
  readonly sourceFactId: OptIrFactId;
  readonly reason: OptIrDroppedFactReason;
  readonly detail?: string;
}

export interface OptIrFactPreservationHooks {
  readonly afterSubject?: () => void;
  readonly afterScope?: () => void;
  readonly afterDependencies?: () => void;
  readonly afterCfg?: () => void;
  readonly afterMemory?: () => void;
  readonly afterInvalidations?: () => void;
  readonly afterResult?: () => void;
}

export interface OptIrPathRehomeContext {
  readonly implications: readonly OptIrEdgeImplication[];
  readonly nextCertificateId: () => OptIrPathCertificateId;
  readonly dominates: Parameters<typeof rehomeOptIrPathCertificate>[0]["dominates"];
  readonly survivingEdges: ReadonlySet<
    Parameters<typeof rehomeOptIrPathCertificate>[0]["survivingEdges"] extends ReadonlySet<
      infer EdgeId
    >
      ? EdgeId
      : never
  >;
  readonly crossedInvalidations: readonly Parameters<
    typeof rehomeOptIrPathCertificate
  >[0]["crossedInvalidations"][number][];
}

export interface PreserveOptIrFactsForRewriteInput {
  readonly facts: readonly OptIrCheckedFactForPreservation[];
  readonly remap: OptIrSubjectRemapTable;
  readonly nextFactId: () => OptIrFactId;
  readonly ruleId?: FactPreservationRuleId | string;
  readonly obligationId?: RewriteLegalityObligationId | string;
  readonly cfgEditId?: OptIrCfgEditId;
  readonly certificates?: readonly OptIrPathCertificate[];
  readonly pathRehome?: OptIrPathRehomeContext;
  readonly hooks?: OptIrFactPreservationHooks;
}

export interface PreserveOptIrFactsForRewriteResult {
  readonly preservedFacts: readonly OptIrPreservedFact[];
  readonly droppedFacts: readonly OptIrDroppedFact[];
  readonly pathCertificates: readonly OptIrPathCertificate[];
}

export function preserveOptIrFactsForRewrite(
  input: PreserveOptIrFactsForRewriteInput,
): PreserveOptIrFactsForRewriteResult {
  const preservedFacts: OptIrPreservedFact[] = [];
  const droppedFacts: OptIrDroppedFact[] = [];
  const pathCertificates: OptIrPathCertificate[] = [];
  const certificatesById = new Map(
    (input.certificates ?? []).map((certificate) => [certificate.certificateId, certificate]),
  );

  for (const fact of input.facts) {
    if (input.remap.isDropped(fact.subject)) {
      droppedFacts.push(dropFact(fact, "subjectDropped"));
      continue;
    }
    const subject = remapOptionalOptIrFactSubject(input.remap, fact.subject);
    input.hooks?.afterSubject?.();

    const scopeBeforeCfg = freezeFactScope(fact.scope);
    input.hooks?.afterScope?.();

    const dependencies = remapDependencies(input.remap, fact.dependencies);
    if (dependencies === undefined) {
      droppedFacts.push(dropFact(fact, "dependencyDropped"));
      continue;
    }
    input.hooks?.afterDependencies?.();

    const pathResult = preservePathCertificate(input, fact, certificatesById);
    if (pathResult.kind === "dropped") {
      droppedFacts.push(dropFact(fact, pathResult.reason, pathResult.detail));
      continue;
    }
    input.hooks?.afterCfg?.();
    const scope = scopeAfterPathPreservation(scopeBeforeCfg, pathResult.certificate);

    input.hooks?.afterMemory?.();

    if (fact.invalidations.length > 0) {
      droppedFacts.push(dropFact(fact, "invalidated"));
      continue;
    }
    input.hooks?.afterInvalidations?.();

    const preservedFact = freezePreservedFact({
      factId: input.nextFactId(),
      kind: fact.kind,
      subject,
      scope,
      dependencies,
      invalidations: fact.invalidations,
      pathCertificateId: pathResult.certificate?.certificateId,
      origin: fact.origin,
      lineage: {
        kind: "preservedCheckedFact",
        sourceFactId: fact.factId,
        ruleId: input.ruleId ?? "preserve",
        obligationId: input.obligationId ?? "rewrite",
        remappedFrom: fact.subject,
      },
    });
    input.hooks?.afterResult?.();

    preservedFacts.push(preservedFact);
    if (pathResult.certificate !== undefined) {
      pathCertificates.push(pathResult.certificate);
    }
  }

  return Object.freeze({
    preservedFacts: Object.freeze(preservedFacts),
    droppedFacts: Object.freeze(droppedFacts),
    pathCertificates: Object.freeze(pathCertificates),
  });
}

function preservePathCertificate(
  input: PreserveOptIrFactsForRewriteInput,
  fact: OptIrCheckedFactForPreservation,
  certificatesById: ReadonlyMap<OptIrPathCertificateId, OptIrPathCertificate>,
):
  | { readonly kind: "ok"; readonly certificate?: OptIrPathCertificate }
  | {
      readonly kind: "dropped";
      readonly reason:
        | "pathCertificateMismatch"
        | "pathCertificateMissing"
        | "pathCertificateDropped";
      readonly detail?: RehomePathCertificateDropReason | string;
    } {
  const certificateId = pathCertificateIdForFact(fact);
  if (certificateId.kind === "mismatch") {
    return { kind: "dropped", reason: "pathCertificateMismatch" };
  }
  if (certificateId.certificateId === undefined) {
    return { kind: "ok" };
  }

  const certificate = certificatesById.get(certificateId.certificateId);
  if (certificate === undefined || input.pathRehome === undefined) {
    return { kind: "dropped", reason: "pathCertificateMissing" };
  }

  const rehome = rehomeOptIrPathCertificate({
    certificate,
    implications: input.pathRehome.implications,
    cfgEditId: input.cfgEditId,
    nextCertificateId: input.pathRehome.nextCertificateId,
    dominates: input.pathRehome.dominates,
    survivingEdges: input.pathRehome.survivingEdges,
    crossedInvalidations: input.pathRehome.crossedInvalidations,
  });

  if (rehome.kind === "dropped") {
    return {
      kind: "dropped",
      reason: "pathCertificateDropped",
      detail: rehome.reason,
    };
  }

  return { kind: "ok", certificate: rehome.certificate };
}

function pathCertificateIdForFact(
  fact: OptIrCheckedFactForPreservation,
):
  | { readonly kind: "ok"; readonly certificateId?: OptIrPathCertificateId }
  | { readonly kind: "mismatch" } {
  if (fact.scope.kind !== "path") {
    return { kind: "ok", certificateId: fact.pathCertificateId };
  }

  if (fact.pathCertificateId !== undefined && fact.pathCertificateId !== fact.scope.certificateId) {
    return { kind: "mismatch" };
  }

  return { kind: "ok", certificateId: fact.scope.certificateId };
}

function scopeAfterPathPreservation(
  scope: OptIrFactScope,
  certificate: OptIrPathCertificate | undefined,
): OptIrFactScope {
  if (scope.kind !== "path") {
    return scope;
  }
  if (certificate === undefined) {
    return scope;
  }
  return Object.freeze({ kind: "path", certificateId: certificate.certificateId });
}

function freezeFactScope(scope: OptIrFactScope): OptIrFactScope {
  return Object.freeze({ ...scope });
}

function remapDependencies(
  table: OptIrSubjectRemapTable,
  dependencies: readonly OptIrFactSubject[],
): readonly OptIrFactSubject[] | undefined {
  const remapped: OptIrFactSubject[] = [];
  for (const dependency of dependencies) {
    if (table.isDropped(dependency)) {
      return undefined;
    }
    remapped.push(remapOptionalOptIrFactSubject(table, dependency));
  }
  return Object.freeze(remapped);
}

function dropFact(
  fact: OptIrCheckedFactForPreservation,
  reason: OptIrDroppedFactReason,
  detail?: string,
): OptIrDroppedFact {
  return Object.freeze({
    sourceFactId: fact.factId,
    reason,
    ...(detail === undefined ? {} : { detail }),
  });
}

export function freezePreservedFact(fact: OptIrPreservedFact): OptIrPreservedFact {
  return Object.freeze({
    ...fact,
    subject: Object.freeze({ ...fact.subject }),
    scope: Object.freeze({ ...fact.scope }),
    dependencies: Object.freeze(
      fact.dependencies.map((dependency) => Object.freeze({ ...dependency })),
    ),
    invalidations: Object.freeze([...fact.invalidations]),
    lineage: Object.freeze({
      ...fact.lineage,
      remappedFrom: Object.freeze({ ...fact.lineage.remappedFrom }),
    }),
  });
}
