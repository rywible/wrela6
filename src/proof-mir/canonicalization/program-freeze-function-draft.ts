import type {
  MonoFunctionInstance,
  MonoFunctionSignature,
  MonoProofMetadata,
} from "../../mono/mono-hir";
import { type MonoInstanceId } from "../../mono/ids";
import { functionId } from "../../semantic/ids";
import { SourceSpan } from "../../shared/source-span";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";
import type {
  DraftProofMirGraphBlockSnapshot,
  DraftProofMirFunctionDraft,
  DraftProofMirGraphSnapshot,
  DraftProofMirPrivateStateGenerationRecord,
  DraftProofMirStatementRecord,
} from "../draft/draft-program";
import { freezeDraftPlaceProjection, freezeDraftPlaceRoot } from "./draft-place-freeze";
import type { FreezeDraftStatementLookups } from "./draft-statement-freeze";
import { buildCallByKeyLookup } from "./draft-statement-freeze";
import type { DraftProofMirLoanRecord } from "../domains/effects-resources";
import {
  freezeBlocksFromGraphSnapshot,
  freezeControlEdgesFromGraphSnapshot,
  freezeExitsFromGraphSnapshot,
} from "./graph-snapshot-freeze";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirExitEdgeId,
  proofMirFactId,
  proofMirLoanId,
  proofMirLayoutTermBindingId,
  proofMirLayoutTermId,
  proofMirPrivateStateGenerationId,
  type ProofMirLayoutTermBindingId,
  type ProofMirLayoutTermId,
  type ProofMirPrivateStateGenerationId,
  type ProofMirFactId,
  type ProofMirLoanId,
  proofMirOriginId,
  proofMirOwnedPlaceId,
  proofMirPlaceId,
  proofMirScopeId,
  proofMirStatementId,
  proofMirTerminatorId,
  proofMirLocalId,
  proofMirValueId,
  type ProofMirBlockId,
  type ProofMirControlEdgeId,
  type ProofMirOriginId,
  type ProofMirPlaceId,
  type ProofMirScopeId,
} from "../ids";
import type {
  ProofMirBlock,
  ProofMirControlEdge,
  ProofMirFunction,
  ProofMirLocal,
  ProofMirPlace,
  ProofMirPrivateStateGenerationReference,
  ProofMirValue,
} from "../model/graph";
import { proofMirCanonicalKey, type ProofMirCanonicalKey } from "./canonical-keys";
import { compareProofMirCanonicalKeys, proofMirDeterministicTable } from "./canonical-order";
import {
  assignProofMirDenseIds,
  buildProofMirCanonicalKeyLookup,
  requireProofMirCanonicalKeyReference,
  type ProofMirCanonicalKeyLookup,
} from "./id-assignment";
import { freezeScopesFromAssignments } from "./program-freeze-scopes";

import {
  ownerKeyForFunction,
  scopeRecordPayload,
  blockRecordPayload,
  controlEdgeRecordPayload,
  placeRecordPayload,
  valueRecordPayload,
  localRecordPayload,
  missingMonoTypePlaceholder,
  resolveMonoLocalId,
  resolveLocalTypeFromInstance,
  resolveLocalResourceKindFromInstance,
  resolveLocalStorageKind,
  exitRecordPayload,
  controlEdgeKindFromRole,
  mergeAssignmentError,
  freezeOriginAssignment,
  obligationIdByProofKey,
  sessionIdByProofKey,
  brandIdByProofKey,
} from "./program-freeze-shared";

export interface FreezeFunctionDraftProgramLookups {
  readonly factLookup: ProofMirCanonicalKeyLookup<ProofMirFactId>;
  readonly layoutTermLookup: ProofMirCanonicalKeyLookup<ProofMirLayoutTermId>;
  readonly privateStateGenerationLookup: ProofMirCanonicalKeyLookup<ProofMirPrivateStateGenerationId>;
  readonly privateStateGenerationRecords: readonly DraftProofMirPrivateStateGenerationRecord[];
  readonly resolveProgramOrigin: (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ) => ProofMirOriginId | undefined;
}

function statementRecordPayload(record: DraftProofMirStatementRecord): string {
  return [String(record.blockKey), String(record.originKey)].join("|");
}

function buildLayoutTermBindingLookupFromGraphSnapshot(
  snapshot: DraftProofMirGraphSnapshot,
): ProofMirCanonicalKeyLookup<ProofMirLayoutTermBindingId> {
  const seen = new Set<string>();
  const bindingKeys: ProofMirCanonicalKey[] = [];
  for (const block of snapshot.blocks) {
    for (const statement of block.statements) {
      if (statement.kind.kind !== "bindLayoutTerm") {
        continue;
      }
      const keyString = String(statement.kind.binding.key);
      if (seen.has(keyString)) {
        continue;
      }
      seen.add(keyString);
      bindingKeys.push(statement.kind.binding.key);
    }
  }
  bindingKeys.sort(compareProofMirCanonicalKeys);
  return buildProofMirCanonicalKeyLookup({
    entries: bindingKeys,
    keyOf: (key) => key,
    idOf: proofMirLayoutTermBindingId,
  });
}

function buildLoanLookupFromGraphSnapshot(
  snapshot: DraftProofMirGraphSnapshot,
): ProofMirCanonicalKeyLookup<ProofMirLoanId> {
  const seen = new Set<string>();
  const loanKeys: ProofMirCanonicalKey[] = [];
  for (const edge of snapshot.edges) {
    for (const effect of edge.effects) {
      if (effect.kind !== "startLoan" && effect.kind !== "endLoan") {
        continue;
      }
      const keyString = String(effect.loanKey);
      if (seen.has(keyString)) {
        continue;
      }
      seen.add(keyString);
      loanKeys.push(effect.loanKey);
    }
  }
  loanKeys.sort(compareProofMirCanonicalKeys);
  return buildProofMirCanonicalKeyLookup({
    entries: loanKeys,
    keyOf: (key) => key,
    idOf: proofMirLoanId,
  });
}

function buildLoanRecordByKeyFromGraphSnapshot(
  snapshot: DraftProofMirGraphSnapshot,
): ReadonlyMap<string, DraftProofMirLoanRecord> {
  const records = new Map<string, DraftProofMirLoanRecord>();
  for (const block of snapshot.blocks as readonly DraftProofMirGraphBlockSnapshot[]) {
    for (const statement of block.statements) {
      if (statement.kind.kind !== "borrowPlace") {
        continue;
      }
      records.set(String(statement.kind.loanKey), {
        key: statement.kind.loanKey,
        mode: statement.kind.mode,
        placeKey: statement.kind.placeKey,
        scopeKey: statement.kind.scopeKey,
        startOriginKey: statement.kind.startOriginKey,
      });
    }
  }
  return records;
}

function buildPrivateStateGenerationResolver(input: {
  readonly records: readonly DraftProofMirPrivateStateGenerationRecord[];
  readonly generationLookup: ProofMirCanonicalKeyLookup<ProofMirPrivateStateGenerationId>;
  readonly placeLookup: ProofMirCanonicalKeyLookup<ProofMirPlaceId>;
  readonly functionInstanceId: MonoInstanceId;
  readonly resolveProgramOrigin: (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ) => ProofMirOriginId | undefined;
}): (generationKey: ProofMirCanonicalKey) => ProofMirPrivateStateGenerationReference | undefined {
  const recordByKey = new Map(input.records.map((record) => [String(record.key), record]));
  return (generationKey) => {
    const record = recordByKey.get(String(generationKey));
    const generationId = input.generationLookup.resolve(generationKey);
    const placeId = record === undefined ? undefined : input.placeLookup.resolve(record.placeKey);
    const origin =
      record === undefined ? undefined : input.resolveProgramOrigin(record.originKey, "originKey");
    if (
      record === undefined ||
      generationId === undefined ||
      origin === undefined ||
      placeId === undefined
    ) {
      return undefined;
    }
    return {
      generationId,
      place: proofMirOwnedPlaceId(input.functionInstanceId, placeId),
      ...(record.producedBy === undefined ? {} : { producedBy: record.producedBy }),
      origin,
    };
  };
}

const emptyFactLookup = buildProofMirCanonicalKeyLookup<ProofMirCanonicalKey, ProofMirFactId>({
  entries: [],
  keyOf: (key) => key,
  idOf: proofMirFactId,
});

const emptyPrivateStateGenerationLookup = buildProofMirCanonicalKeyLookup<
  ProofMirCanonicalKey,
  ProofMirPrivateStateGenerationId
>({
  entries: [],
  keyOf: (key) => key,
  idOf: proofMirPrivateStateGenerationId,
});

export function freezeFunctionDraft(input: {
  readonly functionDraft: DraftProofMirFunctionDraft;
  readonly functionInstance?: MonoFunctionInstance;
  readonly proofMetadata: MonoProofMetadata;
  readonly programLookups?: FreezeFunctionDraftProgramLookups;
  readonly diagnostics: ProofMirDiagnostic[];
}): ProofMirFunction | "error" {
  const functionInstanceId = input.functionDraft.functionInstanceId;
  const ownerKey = ownerKeyForFunction(functionInstanceId);

  const originAssignment = freezeOriginAssignment({
    entries: input.functionDraft.origins.entries(),
  });
  if (mergeAssignmentError(originAssignment, input.diagnostics)) {
    return "error";
  }

  const scopeAssignment = assignProofMirDenseIds({
    entries: input.functionDraft.scopes.entries(),
    keyOf: (entry) => entry.key,
    idOf: proofMirScopeId,
    normalizePayload: scopeRecordPayload,
  });
  if (mergeAssignmentError(scopeAssignment, input.diagnostics)) {
    return "error";
  }

  const blockAssignment = assignProofMirDenseIds({
    entries: input.functionDraft.blocks.entries(),
    keyOf: (entry) => entry.key,
    idOf: proofMirBlockId,
    normalizePayload: blockRecordPayload,
  });
  if (mergeAssignmentError(blockAssignment, input.diagnostics)) {
    return "error";
  }

  const edgeAssignment = assignProofMirDenseIds({
    entries: input.functionDraft.controlEdges.entries(),
    keyOf: (entry) => entry.key,
    idOf: proofMirControlEdgeId,
    normalizePayload: controlEdgeRecordPayload,
  });
  if (mergeAssignmentError(edgeAssignment, input.diagnostics)) {
    return "error";
  }

  const placeAssignment = assignProofMirDenseIds({
    entries: input.functionDraft.places.entries(),
    keyOf: (entry) => entry.key,
    idOf: proofMirPlaceId,
    normalizePayload: placeRecordPayload,
  });
  if (mergeAssignmentError(placeAssignment, input.diagnostics)) {
    return "error";
  }

  const valueAssignment = assignProofMirDenseIds({
    entries: input.functionDraft.values.entries(),
    keyOf: (entry) => entry.key,
    idOf: proofMirValueId,
    normalizePayload: valueRecordPayload,
  });
  if (mergeAssignmentError(valueAssignment, input.diagnostics)) {
    return "error";
  }

  const localAssignment = assignProofMirDenseIds({
    entries: input.functionDraft.locals.entries(),
    keyOf: (entry) => entry.key,
    idOf: proofMirLocalId,
    normalizePayload: localRecordPayload,
  });
  if (mergeAssignmentError(localAssignment, input.diagnostics)) {
    return "error";
  }

  const statementAssignment = assignProofMirDenseIds({
    entries: input.functionDraft.statements.entries(),
    keyOf: (entry) => entry.key,
    idOf: proofMirStatementId,
    normalizePayload: statementRecordPayload,
  });
  if (mergeAssignmentError(statementAssignment, input.diagnostics)) {
    return "error";
  }

  const exitAssignment = assignProofMirDenseIds({
    entries: input.functionDraft.exitEdges.entries(),
    keyOf: (entry) => entry.key,
    idOf: proofMirExitEdgeId,
    normalizePayload: exitRecordPayload,
  });
  if (mergeAssignmentError(exitAssignment, input.diagnostics)) {
    return "error";
  }

  const resolveOrigin = (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ): ProofMirOriginId | undefined =>
    requireProofMirCanonicalKeyReference({
      lookup: originAssignment.lookup,
      key,
      referenceKind,
      ownerKey,
      functionInstanceId,
      diagnostics: input.diagnostics,
    });

  const resolveScope = (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ): ProofMirScopeId | undefined =>
    requireProofMirCanonicalKeyReference({
      lookup: scopeAssignment.lookup,
      key,
      referenceKind,
      ownerKey,
      functionInstanceId,
      diagnostics: input.diagnostics,
    });

  const resolveBlock = (
    key: ProofMirCanonicalKey,
    referenceKind: string,
  ): ProofMirBlockId | undefined =>
    requireProofMirCanonicalKeyReference({
      lookup: blockAssignment.lookup,
      key,
      referenceKind,
      ownerKey,
      functionInstanceId,
      diagnostics: input.diagnostics,
    });

  const scopeKeyByBlockKey = new Map(
    blockAssignment.entries.map((block) => [String(block.key), block.scopeKey]),
  );
  const obligationLookup = obligationIdByProofKey(input.proofMetadata);
  const sessionLookup = sessionIdByProofKey(input.proofMetadata);
  const brandLookup = brandIdByProofKey(input.proofMetadata);
  const programLookups = input.programLookups;
  const graphSnapshot = input.functionDraft.graphSnapshot;
  const layoutTermBindingLookup =
    graphSnapshot === undefined
      ? buildProofMirCanonicalKeyLookup({
          entries: [],
          keyOf: (key: ProofMirCanonicalKey) => key,
          idOf: proofMirLayoutTermBindingId,
        })
      : buildLayoutTermBindingLookupFromGraphSnapshot(graphSnapshot);
  const valueTypeByKey = new Map(
    valueAssignment.entries.map((record) => [String(record.key), record.type]),
  );
  const snapshotLookupsBase = {
    blockLookup: blockAssignment.lookup,
    edgeLookup: edgeAssignment.lookup,
    exitLookup: exitAssignment.lookup,
    scopeLookup: scopeAssignment.lookup,
    originLookup: originAssignment.lookup,
    placeLookup: placeAssignment.lookup,
    valueLookup: valueAssignment.lookup,
    statementLookup: statementAssignment.lookup,
    layoutTermBindingLookup,
    layoutTermLookup:
      programLookups?.layoutTermLookup ??
      buildProofMirCanonicalKeyLookup({
        entries: [],
        keyOf: (key: ProofMirCanonicalKey) => key,
        idOf: proofMirLayoutTermId,
      }),
    factLookup: programLookups?.factLookup ?? emptyFactLookup,
    loanLookup:
      graphSnapshot === undefined
        ? buildProofMirCanonicalKeyLookup({
            entries: [],
            keyOf: (key: ProofMirCanonicalKey) => key,
            idOf: proofMirLoanId,
          })
        : buildLoanLookupFromGraphSnapshot(graphSnapshot),
    loanRecordByKey:
      graphSnapshot === undefined
        ? new Map()
        : buildLoanRecordByKeyFromGraphSnapshot(graphSnapshot),
    resolveObligationId: (proofKey: string) => obligationLookup.get(proofKey),
    resolveSessionId: (proofKey: string) => sessionLookup.get(proofKey),
    resolveBrandId: (proofKey: string) => brandLookup.get(proofKey),
    resolvePrivateStateGeneration: buildPrivateStateGenerationResolver({
      records: programLookups?.privateStateGenerationRecords ?? [],
      generationLookup:
        programLookups?.privateStateGenerationLookup ?? emptyPrivateStateGenerationLookup,
      placeLookup: placeAssignment.lookup,
      functionInstanceId,
      resolveProgramOrigin:
        programLookups?.resolveProgramOrigin ?? ((_key, _referenceKind) => undefined),
    }),
    scopeRecords: scopeAssignment.entries,
    resolveBlockScopeKey: (key: ProofMirCanonicalKey) => scopeKeyByBlockKey.get(String(key)),
    resolveOrigin: (key: ProofMirCanonicalKey) => resolveOrigin(key, "originKey"),
    resolveBlock: (key: ProofMirCanonicalKey) => resolveBlock(key, "blockKey"),
    resolveValueType: (key: ProofMirCanonicalKey) => valueTypeByKey.get(String(key)),
  };
  const callByKey = buildCallByKeyLookup({
    callRecords: input.functionDraft.calls.entries(),
    resolveOrigin: (key) => resolveOrigin(key, "originKey"),
    lookups: {
      ...snapshotLookupsBase,
      callByKey: new Map(),
    },
    diagnostics: input.diagnostics,
    functionInstanceId,
    ownerKey,
  });
  const snapshotLookups: FreezeDraftStatementLookups = {
    ...snapshotLookupsBase,
    callByKey,
  };

  const frozenEdges =
    graphSnapshot === undefined
      ? (() => {
          const edges: ProofMirControlEdge[] = [];
          for (const record of edgeAssignment.entries) {
            const fromBlockId = resolveBlock(record.fromBlockKey, "fromBlockKey");
            const toBlockId = resolveBlock(record.toBlockKey, "toBlockKey");
            const origin = resolveOrigin(record.originKey, "originKey");
            if (fromBlockId === undefined || toBlockId === undefined || origin === undefined) {
              return "error" as const;
            }
            edges.push({
              edgeId: edgeAssignment.lookup.resolve(record.key)!,
              fromBlockId,
              toBlockId,
              kind: controlEdgeKindFromRole(record.role),
              arguments: [],
              facts: [],
              effects: [],
              crossedScopes: [],
              origin,
            });
          }
          return edges;
        })()
      : freezeControlEdgesFromGraphSnapshot({
          snapshot: graphSnapshot,
          edgeRecords: edgeAssignment.entries,
          lookups: snapshotLookups,
          diagnostics: input.diagnostics,
          ownerKey,
          functionInstanceId,
        });

  if (frozenEdges === "error" || input.diagnostics.length > 0) {
    return "error";
  }

  const incomingEdgesByBlock = new Map<ProofMirBlockId, ProofMirControlEdgeId[]>();
  for (const edge of frozenEdges) {
    if (edge.toBlockId === undefined) {
      continue;
    }
    const current = incomingEdgesByBlock.get(edge.toBlockId) ?? [];
    current.push(edge.edgeId);
    incomingEdgesByBlock.set(edge.toBlockId, current);
  }

  const frozenBlocks =
    graphSnapshot === undefined
      ? (() => {
          const blocks: ProofMirBlock[] = [];
          for (const record of blockAssignment.entries) {
            const blockId = blockAssignment.lookup.resolve(record.key)!;
            const scopeId = resolveScope(record.scopeKey, "scopeKey");
            const origin = resolveOrigin(record.originKey, "originKey");
            if (scopeId === undefined || origin === undefined) {
              continue;
            }
            blocks.push({
              blockId,
              scopeId,
              parameters: [],
              statements: [],
              terminator: {
                terminatorId: proofMirTerminatorId(0),
                kind: { kind: "unreachable", reason: "unreachableSource" },
                outgoingEdges: [],
                origin,
              },
              incomingEdges: incomingEdgesByBlock.get(blockId) ?? [],
              origin,
            });
          }
          return blocks;
        })()
      : (() => {
          const result = freezeBlocksFromGraphSnapshot({
            snapshot: graphSnapshot,
            blockRecords: blockAssignment.entries,
            lookups: snapshotLookups,
            incomingEdgesByBlock,
            diagnostics: input.diagnostics,
            ownerKey,
            functionInstanceId,
          });
          if (result === "error") {
            return "error" as const;
          }
          return result;
        })();

  if (frozenBlocks === "error") {
    return "error";
  }

  const frozenExits =
    graphSnapshot === undefined
      ? []
      : freezeExitsFromGraphSnapshot({
          snapshot: graphSnapshot,
          exitRecords: exitAssignment.entries,
          lookups: snapshotLookups,
          diagnostics: input.diagnostics,
          ownerKey,
          functionInstanceId,
        });

  if (frozenExits === "error") {
    return "error";
  }

  const frozenScopes = freezeScopesFromAssignments({
    scopeRecords: scopeAssignment.entries,
    localRecords: localAssignment.entries,
    functionInstance: input.functionInstance,
    functionInstanceId,
    ownerKey,
    diagnostics: input.diagnostics,
    resolveAssignedScope: (key) => scopeAssignment.lookup.resolve(key),
    resolveParentScope: resolveScope,
    resolveOrigin,
  });
  if (frozenScopes === "error") {
    return "error";
  }

  const blocksTable = proofMirDeterministicTable({
    entries: frozenBlocks,
    keyOf: (block) => proofMirCanonicalKey(`block:${String(block.blockId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`block:${String(id)}`),
    normalizePayload: (block) => String(block.blockId),
  });
  if (blocksTable.kind !== "ok") {
    for (const diagnostic of blocksTable.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error";
  }

  const edgesTable = proofMirDeterministicTable({
    entries: frozenEdges,
    keyOf: (edge) => proofMirCanonicalKey(`edge:${String(edge.edgeId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`edge:${String(id)}`),
    normalizePayload: (edge) => String(edge.edgeId),
  });
  if (edgesTable.kind !== "ok") {
    for (const diagnostic of edgesTable.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error";
  }

  const scopesTable = proofMirDeterministicTable({
    entries: frozenScopes,
    keyOf: (scope) => proofMirCanonicalKey(`scope:${String(scope.scopeId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`scope:${String(id)}`),
    normalizePayload: (scope) => String(scope.scopeId),
  });
  if (scopesTable.kind !== "ok") {
    for (const diagnostic of scopesTable.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error";
  }

  const entryBlockRecord =
    blockAssignment.entries.find((record) => record.role === "entry") ?? blockAssignment.entries[0];
  const entryBlockId =
    entryBlockRecord === undefined
      ? proofMirBlockId(0)
      : blockAssignment.lookup.resolve(entryBlockRecord.key)!;
  const functionOrigin = originAssignment.lookup.entries()[0]?.id ?? proofMirOriginId(0);

  const signature: MonoFunctionSignature = input.functionInstance?.signature ?? {
    functionId: functionId(0),
    itemId: functionId(0) as never,
    parameters: [],
    returnType: missingMonoTypePlaceholder() as never,
    returnKind: "Copy",
    modifiers: {
      isPlatform: false,
      isTerminal: false,
      isPredicate: false,
      isConstructor: false,
      isPrivate: false,
    },
    sourceSpan: SourceSpan.from(0, 0),
  };
  const sourceFunctionId = input.functionInstance?.sourceFunctionId ?? functionId(0);

  const frozenValues: ProofMirValue[] = [];
  for (const record of valueAssignment.entries) {
    const valueId = valueAssignment.lookup.resolve(record.key);
    const origin = resolveOrigin(record.originKey, "originKey");
    if (valueId === undefined || origin === undefined) {
      continue;
    }
    frozenValues.push({
      valueId,
      type: record.type ?? missingMonoTypePlaceholder(),
      resourceKind: record.resourceKind ?? "Copy",
      representation: record.representation ?? { kind: "runtime" },
      origin,
    });
  }

  const valuesTable = proofMirDeterministicTable({
    entries: frozenValues,
    keyOf: (value) => proofMirCanonicalKey(`value:${String(value.valueId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`value:${String(id)}`),
    normalizePayload: (value) => String(value.valueId),
  });
  if (valuesTable.kind !== "ok") {
    for (const diagnostic of valuesTable.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error";
  }

  const frozenLocals: ProofMirLocal[] = [];
  for (const record of localAssignment.entries) {
    const localId = localAssignment.lookup.resolve(record.key);
    const origin = resolveOrigin(record.originKey, "originKey");
    if (localId === undefined || origin === undefined) {
      continue;
    }
    const monoLocalId = resolveMonoLocalId({
      functionInstance: input.functionInstance,
      localRecord: record,
      functionInstanceId,
      ownerKey,
      diagnostics: input.diagnostics,
    });
    if (monoLocalId === undefined) {
      continue;
    }
    const storageKind = resolveLocalStorageKind(record);
    let storage: ProofMirLocal["storage"];
    if (storageKind === "placeBacked") {
      const backingPlaceKey = record.backingPlaceKey;
      const placeId =
        backingPlaceKey === undefined ? undefined : placeAssignment.lookup.resolve(backingPlaceKey);
      if (placeId === undefined) {
        input.diagnostics.push(
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_INVALID_TABLE_CANONICAL_KEY",
            message: "Proof MIR freeze could not resolve place-backed local storage.",
            functionInstanceId,
            ownerKey,
            rootCauseKey: "local-backing-place",
            stableDetail: `local:${String(record.key)}`,
          }),
        );
        continue;
      }
      storage = { kind: "placeBacked", placeId };
    } else {
      storage = { kind: "scalarSsa" };
    }
    frozenLocals.push({
      localId,
      monoLocalId,
      storage,
      type:
        record.type ??
        resolveLocalTypeFromInstance(input.functionInstance, monoLocalId) ??
        missingMonoTypePlaceholder(),
      resourceKind:
        record.resourceKind ??
        resolveLocalResourceKindFromInstance(input.functionInstance, monoLocalId) ??
        "Copy",
      origin,
    });
  }

  const localsTable = proofMirDeterministicTable({
    entries: frozenLocals,
    keyOf: (local) => proofMirCanonicalKey(`local:${String(local.localId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`local:${String(id)}`),
    normalizePayload: (local) => String(local.localId),
  });
  if (localsTable.kind !== "ok") {
    for (const diagnostic of localsTable.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error";
  }

  const frozenPlaces: ProofMirPlace[] = [];
  for (const record of placeAssignment.entries) {
    const placeId = placeAssignment.lookup.resolve(record.key);
    const origin = resolveOrigin(record.originKey, "originKey");
    if (placeId === undefined || origin === undefined) {
      continue;
    }
    if (record.root === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_TABLE_CANONICAL_KEY",
          message: "Proof MIR freeze encountered a place without structured root metadata.",
          functionInstanceId,
          ownerKey,
          rootCauseKey: "place-root",
          stableDetail: `place:${String(record.key)}`,
        }),
      );
      return "error";
    }
    const root = freezeDraftPlaceRoot({
      root: record.root,
      valueLookup: valueAssignment.lookup,
    });
    if (root === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_TABLE_CANONICAL_KEY",
          message: "Proof MIR freeze could not resolve a place root reference.",
          functionInstanceId,
          ownerKey,
          rootCauseKey: "place-root",
          stableDetail: `place:${String(record.key)}`,
        }),
      );
      return "error";
    }
    frozenPlaces.push({
      placeId,
      root,
      projection: (record.projection ?? []).map(freezeDraftPlaceProjection),
      type: record.type ?? missingMonoTypePlaceholder(),
      resourceKind: record.resourceKind ?? "Copy",
      origin,
    });
  }

  const placesTable = proofMirDeterministicTable({
    entries: frozenPlaces,
    keyOf: (place) => proofMirCanonicalKey(`place:${String(place.placeId)}`),
    lookupKeyOf: (id) => proofMirCanonicalKey(`place:${String(id)}`),
    normalizePayload: (place) => String(place.placeId),
  });
  if (placesTable.kind !== "ok") {
    for (const diagnostic of placesTable.diagnostics) {
      input.diagnostics.push(diagnostic);
    }
    return "error";
  }

  return {
    functionInstanceId,
    sourceFunctionId,
    signature,
    entryBlockId,
    blocks: blocksTable.table,
    edges: edgesTable.table,
    values: valuesTable.table,
    locals: localsTable.table,
    places: placesTable.table,
    scopes: scopesTable.table,
    exits: frozenExits,
    origin: functionOrigin,
  };
}
