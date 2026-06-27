import type { HirPlatformContractEdgeId } from "../../hir/ids";
import type { MonoInstantiatedProofId } from "../../mono/mono-hir";
import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";
import type {
  DraftProofMirCallGraphEdgeRecord,
  DraftProofMirFactRecord,
  DraftProofMirFunctionDraft,
  DraftProofMirLayoutTermRecord,
  DraftProofMirPlatformEdgeRecord,
  DraftProofMirPrivateStateGenerationRecord,
  DraftProofMirProgramDraft,
  DraftProofMirRuntimeCallRecord,
} from "../draft/draft-program";
import {
  freezeDraftProofMirFactDependency,
  freezeDraftProofMirFactKind,
  type DraftProofMirFactOperandFreezeLookups,
} from "../draft/draft-fact-operands";
import {
  freezeDraftRuntimeCapabilityPlaceKeys,
  freezeDraftRuntimeEffect,
} from "../draft/draft-runtime-call";
import {
  proofMirOwnedPlaceId,
  proofMirFactId,
  proofMirOwnedCallIdKey,
  proofMirPrivateStateGenerationId,
  type ProofMirOwnedCallId,
  type ProofMirPrivateStateGenerationId,
  type ProofMirFactId,
  proofMirLayoutTermId,
  type ProofMirLayoutTermId,
  proofMirOriginId,
  type ProofMirOriginId,
} from "../ids";
import type { ProofMirFact, ProofMirFactRole } from "../model/facts";
import type { ProofMirCallGraphEdge, ProofMirRuntimeCallContract } from "../model/calls";
import type { ProofMirLayoutTermRecord } from "../model/layout-bindings";
import type { ProofMirOrigin } from "../model/origins";
import type { ProofMirPlatformEdge, ProofMirPrivateStateGeneration } from "../model/program";
import { proofMirCanonicalKey, type ProofMirCanonicalKey } from "./canonical-keys";
import { proofMirDeterministicTable, type ProofMirDeterministicTable } from "./canonical-order";
import {
  assignProofMirDenseIds,
  requireProofMirCanonicalKeyReference,
  type ProofMirCanonicalKeyLookup,
} from "./id-assignment";

import {
  factRecordPayload,
  layoutTermRecordPayload,
  privateStateGenerationRecordPayload,
  mergeAssignmentError,
  freezeOriginAssignment,
  buildFrozenOriginTable,
} from "./program-freeze-shared";
import {
  buildFunctionDraftOperandLookups,
  withFactKeyLookup,
  withLayoutTermKeyLookup,
} from "./program-freeze-operand-lookups";

function frozenFactFromRecord(
  record: DraftProofMirFactRecord,
  factId: ProofMirFactId,
  origin: ProofMirOriginId,
  operandLookups: DraftProofMirFactOperandFreezeLookups,
): ProofMirFact | undefined {
  if (record.factKind === undefined) {
    return undefined;
  }
  const kind = freezeDraftProofMirFactKind(record.factKind, operandLookups);
  if (kind === undefined) {
    return undefined;
  }
  const dependsOn = (record.dependsOn ?? [])
    .map((dependency) => freezeDraftProofMirFactDependency(dependency, operandLookups))
    .filter((dependency): dependency is NonNullable<typeof dependency> => dependency !== undefined);
  if (dependsOn.length !== (record.dependsOn ?? []).length) {
    return undefined;
  }
  return {
    factId,
    role: record.role as ProofMirFactRole,
    kind,
    origin,
    dependsOn,
  };
}

function frozenLayoutTermFromRecord(input: {
  readonly record: DraftProofMirLayoutTermRecord;
  readonly termId: ProofMirLayoutTermId;
  readonly origin: ProofMirOriginId;
}): ProofMirLayoutTermRecord {
  return {
    termId: input.termId,
    path: {
      root: input.record.root!,
      childPath: input.record.childPath ?? [],
    },
    unit: input.record.unit!,
    origin: input.origin,
  };
}

function freezeCallGraphTable(input: {
  readonly entries: readonly DraftProofMirCallGraphEdgeRecord[];
  readonly resolveOrigin: (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ) => ProofMirOriginId | undefined;
  readonly diagnostics: ProofMirDiagnostic[];
}): ProofMirDeterministicTable<ProofMirOwnedCallId, ProofMirCallGraphEdge> | "error" {
  const frozenEdges: ProofMirCallGraphEdge[] = [];
  for (const record of input.entries) {
    const origin = input.resolveOrigin(record.originKey, "originKey");
    if (origin === undefined) {
      continue;
    }
    frozenEdges.push({
      callId: record.callId,
      target: record.target,
      origin,
    });
  }
  const table = proofMirDeterministicTable<ProofMirOwnedCallId, ProofMirCallGraphEdge>({
    entries: frozenEdges,
    keyOf: (edge) => proofMirCanonicalKey(`callGraph:${proofMirOwnedCallIdKey(edge.callId)}`),
    lookupKeyOf: (id: ProofMirOwnedCallId) =>
      proofMirCanonicalKey(`callGraph:${proofMirOwnedCallIdKey(id)}`),
    normalizePayload: (edge) => proofMirOwnedCallIdKey(edge.callId),
  });
  if (table.kind !== "ok") {
    for (const diagnostic of table.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error";
  }
  return table.table;
}

function freezePlatformEdgeTable(input: {
  readonly entries: readonly DraftProofMirPlatformEdgeRecord[];
  readonly resolveOrigin: (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ) => ProofMirOriginId | undefined;
  readonly diagnostics: ProofMirDiagnostic[];
}):
  | ProofMirDeterministicTable<
      MonoInstantiatedProofId<HirPlatformContractEdgeId>,
      ProofMirPlatformEdge
    >
  | "error" {
  const frozenEdges: ProofMirPlatformEdge[] = [];
  for (const record of input.entries) {
    const origin = input.resolveOrigin(record.originKey, "originKey");
    if (origin === undefined) {
      continue;
    }
    frozenEdges.push({
      edgeId: record.edgeId,
      primitiveId: record.primitiveId,
      abi: record.abi,
      origin,
    });
  }
  const table = proofMirDeterministicTable<
    MonoInstantiatedProofId<HirPlatformContractEdgeId>,
    ProofMirPlatformEdge
  >({
    entries: frozenEdges,
    keyOf: (edge) => proofMirCanonicalKey(`platformEdge:${proofMetadataIdKey(edge.edgeId)}`),
    lookupKeyOf: (id: MonoInstantiatedProofId<HirPlatformContractEdgeId>) =>
      proofMirCanonicalKey(`platformEdge:${proofMetadataIdKey(id)}`),
    normalizePayload: (edge) => proofMetadataIdKey(edge.edgeId),
  });
  if (table.kind !== "ok") {
    for (const diagnostic of table.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error";
  }
  return table.table;
}

function freezeRuntimeCallTable(input: {
  readonly entries: readonly DraftProofMirRuntimeCallRecord[];
  readonly resolveOrigin: (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ) => ProofMirOriginId | undefined;
  readonly factLookup: ProofMirCanonicalKeyLookup<ProofMirFactId>;
  readonly operandLookups: DraftProofMirFactOperandFreezeLookups;
  readonly diagnostics: ProofMirDiagnostic[];
}):
  | ProofMirDeterministicTable<
      ProofMirRuntimeCallContract["runtimeCallId"],
      ProofMirRuntimeCallContract
    >
  | "error" {
  const frozenCalls: ProofMirRuntimeCallContract[] = [];
  for (const record of input.entries) {
    const origin = input.resolveOrigin(record.originKey, "originKey");
    if (origin === undefined) {
      continue;
    }
    const requiredFacts: ProofMirFactId[] = [];
    let missingRequiredFact = false;
    for (const factKey of record.requiredFactKeys) {
      const factId = requireProofMirCanonicalKeyReference({
        lookup: input.factLookup,
        key: factKey,
        referenceKind: "runtimeCallRequiredFactKey",
        ownerKey: `runtimeCall:${String(record.runtimeCallId)}`,
        functionInstanceId: record.functionInstanceId,
        diagnostics: input.diagnostics,
      });
      if (factId === undefined) {
        missingRequiredFact = true;
        break;
      }
      requiredFacts.push(factId);
    }
    if (missingRequiredFact) {
      continue;
    }
    const consumedCapabilities = freezeDraftRuntimeCapabilityPlaceKeys(
      record.consumedCapabilityPlaceKeys,
      input.operandLookups,
    );
    if (consumedCapabilities === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
          message:
            "Proof MIR runtime call consumed capability could not be frozen from draft place keys.",
          functionInstanceId: record.functionInstanceId,
          ownerKey: `runtimeCall:${String(record.runtimeCallId)}`,
          rootCauseKey: "runtime-call",
          stableDetail: "missing-consumed-capability-place",
        }),
      );
      continue;
    }
    const producedCapabilities = freezeDraftRuntimeCapabilityPlaceKeys(
      record.producedCapabilityPlaceKeys,
      input.operandLookups,
    );
    if (producedCapabilities === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
          message:
            "Proof MIR runtime call produced capability could not be frozen from draft place keys.",
          functionInstanceId: record.functionInstanceId,
          ownerKey: `runtimeCall:${String(record.runtimeCallId)}`,
          rootCauseKey: "runtime-call",
          stableDetail: "missing-produced-capability-place",
        }),
      );
      continue;
    }
    const effects = [];
    let missingEffectPlace = false;
    for (const effect of record.effects) {
      const frozenEffect = freezeDraftRuntimeEffect(effect, input.operandLookups);
      if (frozenEffect === undefined) {
        missingEffectPlace = true;
        break;
      }
      effects.push(frozenEffect);
    }
    if (missingEffectPlace) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_RUNTIME_CATALOG_ENTRY",
          message: "Proof MIR runtime call effect could not be frozen from draft place keys.",
          functionInstanceId: record.functionInstanceId,
          ownerKey: `runtimeCall:${String(record.runtimeCallId)}`,
          rootCauseKey: "runtime-call",
          stableDetail: "missing-effect-place",
        }),
      );
      continue;
    }
    frozenCalls.push({
      runtimeCallId: record.runtimeCallId,
      runtimeId: record.runtimeId,
      callId: record.callId,
      requiredFacts,
      consumedCapabilities: [...consumedCapabilities],
      producedCapabilities: [...producedCapabilities],
      effects,
      origin,
    });
  }
  const table = proofMirDeterministicTable({
    entries: frozenCalls,
    keyOf: (call) => proofMirCanonicalKey(`runtimeCall:${String(call.runtimeCallId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`runtimeCall:${String(id)}`),
    normalizePayload: (call) => String(call.runtimeCallId),
  });
  if (table.kind !== "ok") {
    for (const diagnostic of table.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error";
  }
  return table.table;
}

function freezePrivateStateGenerationTable(input: {
  readonly entries: readonly DraftProofMirPrivateStateGenerationRecord[];
  readonly resolveOrigin: (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ) => ProofMirOriginId | undefined;
  readonly generationLookup: ProofMirCanonicalKeyLookup<ProofMirPrivateStateGenerationId>;
  readonly operandLookups: DraftProofMirFactOperandFreezeLookups;
  readonly diagnostics: ProofMirDiagnostic[];
}) {
  const frozenGenerations: ProofMirPrivateStateGeneration[] = [];
  for (const record of input.entries) {
    const origin = input.resolveOrigin(record.originKey, "originKey");
    const generationId = input.generationLookup.resolve(record.key);
    const resolvedPlace = input.operandLookups.placeKeyLookup.resolve(record.placeKey);
    if (origin === undefined || generationId === undefined || resolvedPlace === undefined) {
      continue;
    }
    const previous =
      record.previousGenerationKey === undefined
        ? undefined
        : input.generationLookup.resolve(record.previousGenerationKey);
    frozenGenerations.push({
      generationId,
      place: proofMirOwnedPlaceId(resolvedPlace.functionInstanceId, resolvedPlace.placeId),
      ...(previous === undefined ? {} : { previous }),
      ...(record.producedBy === undefined ? {} : { producedBy: record.producedBy }),
      origin,
    });
  }
  const table = proofMirDeterministicTable({
    entries: frozenGenerations,
    keyOf: (generation) =>
      proofMirCanonicalKey(`privateStateGeneration:${String(generation.generationId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`privateStateGeneration:${String(id)}`),
    normalizePayload: (generation) => String(generation.generationId),
  });
  if (table.kind !== "ok") {
    for (const diagnostic of table.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error" as const;
  }
  return table.table;
}

export function freezeProgramLevelTables(input: {
  readonly programDraft: DraftProofMirProgramDraft;
  readonly functionDrafts: readonly DraftProofMirFunctionDraft[];
  readonly diagnostics: ProofMirDiagnostic[];
}):
  | {
      readonly originLookup: ProofMirCanonicalKeyLookup<ProofMirOriginId>;
      readonly factLookup: ProofMirCanonicalKeyLookup<ProofMirFactId>;
      readonly privateStateGenerationLookup: ProofMirCanonicalKeyLookup<ProofMirPrivateStateGenerationId>;
      readonly privateStateGenerationRecords: readonly DraftProofMirPrivateStateGenerationRecord[];
      readonly origins: ProofMirDeterministicTable<ProofMirOriginId, ProofMirOrigin>;
      readonly facts: ProofMirDeterministicTable<ProofMirFactId, ProofMirFact>;
      readonly layoutTerms: ProofMirDeterministicTable<
        ProofMirLayoutTermId,
        ProofMirLayoutTermRecord
      >;
      readonly layoutTermLookup: ProofMirCanonicalKeyLookup<ProofMirLayoutTermId>;
      readonly callGraph: ProofMirDeterministicTable<ProofMirOwnedCallId, ProofMirCallGraphEdge>;
      readonly platformEdges: ProofMirDeterministicTable<
        MonoInstantiatedProofId<HirPlatformContractEdgeId>,
        ProofMirPlatformEdge
      >;
      readonly runtimeCalls: ProofMirDeterministicTable<
        ProofMirRuntimeCallContract["runtimeCallId"],
        ProofMirRuntimeCallContract
      >;
      readonly privateStateGenerations: ProofMirDeterministicTable<
        ProofMirPrivateStateGenerationId,
        ProofMirPrivateStateGeneration
      >;
    }
  | "error" {
  const operandLookupsBase = buildFunctionDraftOperandLookups({
    functionDrafts: input.functionDrafts,
    diagnostics: input.diagnostics,
  });
  if (operandLookupsBase === "error") {
    return "error";
  }

  const originAssignment = freezeOriginAssignment({
    entries: input.programDraft.origins.entries(),
  });
  if (mergeAssignmentError(originAssignment, input.diagnostics)) {
    return "error";
  }

  const factAssignment = assignProofMirDenseIds({
    entries: input.programDraft.facts.entries(),
    keyOf: (entry) => entry.key,
    idOf: proofMirFactId,
    normalizePayload: factRecordPayload,
  });
  if (mergeAssignmentError(factAssignment, input.diagnostics)) {
    return "error";
  }

  const layoutTermAssignment = assignProofMirDenseIds({
    entries: input.programDraft.layoutTerms.entries(),
    keyOf: (entry) => entry.key,
    idOf: proofMirLayoutTermId,
    normalizePayload: layoutTermRecordPayload,
  });
  if (mergeAssignmentError(layoutTermAssignment, input.diagnostics)) {
    return "error";
  }

  const generationAssignment = assignProofMirDenseIds({
    entries: input.programDraft.privateStateGenerations.entries(),
    keyOf: (entry) => entry.key,
    idOf: proofMirPrivateStateGenerationId,
    normalizePayload: privateStateGenerationRecordPayload,
  });
  if (mergeAssignmentError(generationAssignment, input.diagnostics)) {
    return "error";
  }

  const resolveProgramOrigin = (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ): ProofMirOriginId | undefined =>
    requireProofMirCanonicalKeyReference({
      lookup: originAssignment.lookup,
      key,
      referenceKind,
      ownerKey: "program",
      diagnostics: input.diagnostics,
    });

  const operandLookups = withFactKeyLookup(
    withLayoutTermKeyLookup(operandLookupsBase, layoutTermAssignment.lookup),
    factAssignment.lookup,
  );

  const frozenFacts: ProofMirFact[] = [];
  for (const record of factAssignment.entries) {
    const origin = resolveProgramOrigin(record.originKey, "originKey");
    const factId = factAssignment.lookup.resolve(record.key);
    if (origin === undefined || factId === undefined) {
      continue;
    }
    if (record.factKind === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_FACT_ROLE",
          message: "Proof MIR fact record is missing a frozen fact kind.",
          ownerKey: "program",
          rootCauseKey: "fact",
          stableDetail: record.kind,
        }),
      );
      continue;
    }
    const frozenFact = frozenFactFromRecord(record, factId, origin, operandLookups);
    if (frozenFact === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_FACT_ROLE",
          message: "Proof MIR fact record could not be frozen from draft operands.",
          ownerKey: "program",
          rootCauseKey: "fact",
          stableDetail: record.kind,
        }),
      );
      continue;
    }
    frozenFacts.push(frozenFact);
  }

  const factsTable = proofMirDeterministicTable({
    entries: frozenFacts,
    keyOf: (fact) => proofMirCanonicalKey(`fact:${String(fact.factId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`fact:${String(id)}`),
    normalizePayload: (fact) => String(fact.factId),
  });
  if (factsTable.kind !== "ok") {
    for (const diagnostic of factsTable.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error";
  }

  const programOrigin = originAssignment.lookup.entries()[0]?.id ?? proofMirOriginId(0);
  const frozenLayoutTerms: ProofMirLayoutTermRecord[] = [];
  for (const record of layoutTermAssignment.entries) {
    const termId = layoutTermAssignment.lookup.resolve(record.key);
    if (termId === undefined) {
      continue;
    }
    const origin =
      record.originKey === undefined
        ? programOrigin
        : (resolveProgramOrigin(record.originKey, "originKey") ?? programOrigin);
    if (record.root === undefined || record.unit === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_MISSING_LAYOUT_TERM_BINDING",
          message: "Proof MIR layout term record is missing root or unit metadata.",
          ownerKey: "program",
          rootCauseKey: "layout-term",
          stableDetail: record.termPath,
        }),
      );
      continue;
    }
    frozenLayoutTerms.push(
      frozenLayoutTermFromRecord({
        record,
        termId,
        origin,
      }),
    );
  }

  const layoutTermsTable = proofMirDeterministicTable({
    entries: frozenLayoutTerms,
    keyOf: (term) => proofMirCanonicalKey(`layoutTerm:${String(term.termId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`layoutTerm:${String(id)}`),
    normalizePayload: (term) => String(term.termId),
  });
  if (layoutTermsTable.kind !== "ok") {
    for (const diagnostic of layoutTermsTable.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error";
  }

  const callGraphTable = freezeCallGraphTable({
    entries: input.programDraft.callGraph.entries(),
    resolveOrigin: resolveProgramOrigin,
    diagnostics: input.diagnostics,
  });
  if (callGraphTable === "error") {
    return "error";
  }

  const platformEdgesTable = freezePlatformEdgeTable({
    entries: input.programDraft.platformEdges.entries(),
    resolveOrigin: resolveProgramOrigin,
    diagnostics: input.diagnostics,
  });
  if (platformEdgesTable === "error") {
    return "error";
  }

  const runtimeCallsTable = freezeRuntimeCallTable({
    entries: input.programDraft.runtimeCalls.entries(),
    resolveOrigin: resolveProgramOrigin,
    factLookup: factAssignment.lookup,
    operandLookups,
    diagnostics: input.diagnostics,
  });
  if (runtimeCallsTable === "error") {
    return "error";
  }

  const privateStateGenerationsTable = freezePrivateStateGenerationTable({
    entries: input.programDraft.privateStateGenerations.entries(),
    resolveOrigin: resolveProgramOrigin,
    generationLookup: generationAssignment.lookup,
    operandLookups: operandLookupsBase,
    diagnostics: input.diagnostics,
  });
  if (privateStateGenerationsTable === "error") {
    return "error";
  }

  if (input.diagnostics.length > 0) {
    return "error";
  }

  return {
    originLookup: originAssignment.lookup,
    factLookup: factAssignment.lookup,
    privateStateGenerationLookup: generationAssignment.lookup,
    privateStateGenerationRecords: generationAssignment.entries,
    origins: buildFrozenOriginTable(originAssignment),
    facts: factsTable.table,
    layoutTerms: layoutTermsTable.table,
    layoutTermLookup: layoutTermAssignment.lookup,
    callGraph: callGraphTable,
    platformEdges: platformEdgesTable,
    runtimeCalls: runtimeCallsTable,
    privateStateGenerations: privateStateGenerationsTable,
  };
}
