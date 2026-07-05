import type { BrandId, ObligationId, SessionId } from "../../hir/ids";
import type { MonoInstanceId } from "../../mono/ids";
import type { MonoCheckedType, MonoInstantiatedProofId } from "../../mono/mono-hir";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";
import type {
  DraftProofMirGraphBlockParameterSnapshot,
  DraftProofMirGraphBlockSnapshot,
  DraftProofMirGraphExitSnapshot,
  DraftProofMirGraphSnapshot,
  DraftProofMirScopeRecord,
} from "../draft/draft-program";
import type { DraftProofMirGraphStatementSnapshot } from "../draft/draft-statement";
import {
  freezeDraftGraphStatement,
  type FreezeDraftStatementLookups,
} from "./draft-statement-freeze";
import type {
  DraftGraphBlockTarget,
  DraftGraphEdgeState,
  DraftGraphTerminator,
  DraftGraphValidationArmBinding,
} from "../draft/draft-graph-builder";
import type { ProofMirCanonicalKey } from "./canonical-keys";
import {
  freezeEdgeEffect,
  freezeExitClosure,
  freezeScopeKeyList,
} from "./graph-edge-effect-freeze";
import type { ProofMirCanonicalKeyLookup } from "./id-assignment";
import {
  pushFreezeUnresolvedReference,
  type FreezeGraphSnapshotErrorContext,
} from "./graph-freeze-errors";
import {
  proofMirTerminatorId,
  type ProofMirBlockId,
  type ProofMirControlEdgeId,
  type ProofMirExitEdgeId,
  type ProofMirFactId,
  type ProofMirLoanId,
  type ProofMirOriginId,
  type ProofMirPlaceId,
  type ProofMirScopeId,
  type ProofMirValueId,
} from "../ids";
import type {
  ProofMirBlock,
  ProofMirBlockParameter,
  ProofMirBlockTarget,
  ProofMirControlEdge,
  ProofMirEdgeEffect,
  ProofMirExitEdge,
  ProofMirPrivateStateGenerationReference,
  ProofMirStatement,
  ProofMirSwitchCase,
  ProofMirTerminator,
  ProofMirValidationArmBinding,
  ProofMirValidationMatch,
} from "../model/graph";
import { proofMirCrossedScopes } from "../domains/scope-tree";
import { freezeBlockStateMerge } from "./graph-state-merge-freeze";
import { missingMonoTypePlaceholder } from "./program-freeze-shared";

export interface FreezeGraphSnapshotLookups {
  readonly blockLookup: ProofMirCanonicalKeyLookup<ProofMirBlockId>;
  readonly edgeLookup: ProofMirCanonicalKeyLookup<ProofMirControlEdgeId>;
  readonly exitLookup: ProofMirCanonicalKeyLookup<ProofMirExitEdgeId>;
  readonly scopeLookup: ProofMirCanonicalKeyLookup<ProofMirScopeId>;
  readonly originLookup: ProofMirCanonicalKeyLookup<ProofMirOriginId>;
  readonly placeLookup: ProofMirCanonicalKeyLookup<ProofMirPlaceId>;
  readonly valueLookup: ProofMirCanonicalKeyLookup<ProofMirValueId>;
  readonly factLookup: ProofMirCanonicalKeyLookup<ProofMirFactId>;
  readonly loanLookup: ProofMirCanonicalKeyLookup<ProofMirLoanId>;
  readonly resolveObligationId: (
    proofKey: string,
  ) => MonoInstantiatedProofId<ObligationId> | undefined;
  readonly resolveSessionId: (proofKey: string) => MonoInstantiatedProofId<SessionId> | undefined;
  readonly resolveBrandId: (proofKey: string) => MonoInstantiatedProofId<BrandId> | undefined;
  readonly resolvePrivateStateGeneration: (
    generationKey: ProofMirCanonicalKey,
  ) => ProofMirPrivateStateGenerationReference | undefined;
  readonly scopeRecords: readonly DraftProofMirScopeRecord[];
  readonly resolveBlockScopeKey: (key: ProofMirCanonicalKey) => ProofMirCanonicalKey | undefined;
  readonly resolveOrigin: (key: ProofMirCanonicalKey) => ProofMirOriginId | undefined;
  readonly resolveBlock: (key: ProofMirCanonicalKey) => ProofMirBlockId | undefined;
  readonly resolveValueType: (key: ProofMirCanonicalKey) => MonoCheckedType | undefined;
}

function crossedScopeIdsForDraftEdge(input: {
  readonly scopeRecords: readonly DraftProofMirScopeRecord[];
  readonly scopeLookup: ProofMirCanonicalKeyLookup<ProofMirScopeId>;
  readonly sourceScopeKey: ProofMirCanonicalKey;
  readonly targetScopeKey: ProofMirCanonicalKey;
}): ProofMirScopeId[] {
  const parentByScopeKey = new Map(
    input.scopeRecords.map((scope) => [String(scope.key), scope.parentScopeKey]),
  );
  const scopeStack = (scopeKey: ProofMirCanonicalKey): ProofMirScopeId[] | undefined => {
    const stack: ProofMirScopeId[] = [];
    const visited = new Set<string>();
    let current: ProofMirCanonicalKey | undefined = scopeKey;
    while (current !== undefined) {
      const currentKey = String(current);
      if (visited.has(currentKey)) {
        return undefined;
      }
      visited.add(currentKey);
      const scopeId = input.scopeLookup.resolve(current);
      if (scopeId === undefined) {
        return undefined;
      }
      stack.push(scopeId);
      current = parentByScopeKey.get(currentKey);
    }
    return stack;
  };
  const sourceStack = scopeStack(input.sourceScopeKey);
  const targetStack = scopeStack(input.targetScopeKey);
  if (sourceStack === undefined || targetStack === undefined) {
    return [];
  }
  return proofMirCrossedScopes(sourceStack, targetStack);
}

function crossedScopeIdsForFunctionExit(input: {
  readonly scopeRecords: readonly DraftProofMirScopeRecord[];
  readonly scopeLookup: ProofMirCanonicalKeyLookup<ProofMirScopeId>;
  readonly sourceScopeKey: ProofMirCanonicalKey;
}): ProofMirScopeId[] {
  const parentByScopeKey = new Map(
    input.scopeRecords.map((scope) => [String(scope.key), scope.parentScopeKey]),
  );
  const stack: ProofMirScopeId[] = [];
  const visited = new Set<string>();
  let current: ProofMirCanonicalKey | undefined = input.sourceScopeKey;
  while (current !== undefined) {
    const currentKey = String(current);
    if (visited.has(currentKey)) {
      return [];
    }
    visited.add(currentKey);
    const scopeId = input.scopeLookup.resolve(current);
    if (scopeId === undefined) {
      return [];
    }
    stack.push(scopeId);
    current = parentByScopeKey.get(currentKey);
  }
  return proofMirCrossedScopes(stack, []);
}

function edgeStateMap(snapshot: DraftProofMirGraphSnapshot): Map<string, DraftGraphEdgeState> {
  const map = new Map<string, DraftGraphEdgeState>();
  for (const edge of snapshot.edges) {
    map.set(String(edge.key), edge);
  }
  return map;
}

function blockStateMap(
  snapshot: DraftProofMirGraphSnapshot,
): Map<string, DraftProofMirGraphBlockSnapshot> {
  const map = new Map<string, DraftProofMirGraphBlockSnapshot>();
  for (const block of snapshot.blocks) {
    map.set(String(block.key), block);
  }
  return map;
}

function snapshotBlockForKey(
  blockMap: Map<string, DraftProofMirGraphBlockSnapshot>,
  blockKey: ProofMirCanonicalKey,
) {
  return blockMap.get(String(blockKey));
}

function resolvePlaceKey(
  lookups: FreezeGraphSnapshotLookups,
  placeKey: ProofMirCanonicalKey,
): ProofMirPlaceId | undefined {
  return lookups.placeLookup.resolve(placeKey);
}

function resolveValueKey(
  lookups: FreezeGraphSnapshotLookups,
  valueKey: ProofMirCanonicalKey,
): ProofMirValueId | undefined {
  return lookups.valueLookup.resolve(valueKey);
}

function freezeValidationBinding(
  lookups: FreezeGraphSnapshotLookups,
  binding: DraftGraphValidationArmBinding,
): ProofMirValidationArmBinding | undefined {
  const origin = lookups.resolveOrigin(binding.origin);
  if (origin === undefined) {
    return undefined;
  }
  const operandPlaceKey = binding.operandPlaceKey;
  const operandValueKey = binding.operandValueKey;
  if (operandPlaceKey === undefined && operandValueKey === undefined) {
    return undefined;
  }
  if (operandPlaceKey !== undefined) {
    const place = resolvePlaceKey(lookups, operandPlaceKey);
    if (place === undefined || binding.operandType === undefined) {
      return undefined;
    }
    return {
      bindingKind: binding.bindingKind,
      operand: { kind: "place", place },
      type: binding.operandType,
      origin,
    };
  }
  if (binding.operandType === undefined || operandValueKey === undefined) {
    return undefined;
  }
  const value = resolveValueKey(lookups, operandValueKey);
  if (value === undefined) {
    return undefined;
  }
  return {
    bindingKind: binding.bindingKind,
    operand: {
      kind: "value",
      value,
    },
    type: binding.operandType,
    origin,
  };
}

function freezeBlockTarget(
  lookups: FreezeGraphSnapshotLookups,
  target: DraftGraphBlockTarget,
): ProofMirBlockTarget | undefined {
  const edgeId = lookups.edgeLookup.resolve(target.edge);
  const blockId = lookups.resolveBlock(target.block);
  if (edgeId === undefined || blockId === undefined) {
    return undefined;
  }
  return { edgeId, blockId };
}

function freezeBlockParameter(
  lookups: FreezeGraphSnapshotLookups,
  parameter: DraftProofMirGraphBlockParameterSnapshot,
): ProofMirBlockParameter | undefined {
  const valueId = resolveValueKey(lookups, parameter.valueKey);
  const origin = lookups.resolveOrigin(parameter.originKey);
  if (valueId === undefined || origin === undefined) {
    return undefined;
  }
  const parameterKind =
    parameter.role === "proofFact"
      ? ({ kind: "proofFact" } as const)
      : ({ kind: "copyScalar", resourceKind: "Copy" } as const);
  return {
    valueId,
    type: lookups.resolveValueType(parameter.valueKey) ?? missingMonoTypePlaceholder(),
    parameterKind,
    origin,
  };
}

function freezeTerminator(
  lookups: FreezeGraphSnapshotLookups,
  terminator: DraftGraphTerminator,
  terminatorId: number,
): ProofMirTerminator | undefined {
  const origin = lookups.resolveOrigin(terminator.origin);
  if (origin === undefined) {
    return undefined;
  }
  switch (terminator.kind) {
    case "goto": {
      const target = freezeBlockTarget(lookups, terminator.target);
      if (target === undefined) {
        return undefined;
      }
      return {
        terminatorId: proofMirTerminatorId(terminatorId),
        kind: { kind: "goto", target },
        outgoingEdges: [target.edgeId],
        origin,
      };
    }
    case "branch": {
      const condition = resolveValueKey(lookups, terminator.condition);
      const whenTrue = freezeBlockTarget(lookups, terminator.whenTrue);
      const whenFalse = freezeBlockTarget(lookups, terminator.whenFalse);
      if (condition === undefined || whenTrue === undefined || whenFalse === undefined) {
        return undefined;
      }
      return {
        terminatorId: proofMirTerminatorId(terminatorId),
        kind: { kind: "branch", condition, whenTrue, whenFalse },
        outgoingEdges: [whenTrue.edgeId, whenFalse.edgeId],
        origin,
      };
    }
    case "switch": {
      const scrutinee = resolveValueKey(lookups, terminator.scrutinee);
      if (scrutinee === undefined) {
        return undefined;
      }
      const cases: ProofMirSwitchCase[] = [];
      const outgoingEdges: ProofMirControlEdgeId[] = [];
      for (const draftCase of terminator.cases) {
        const caseTarget = freezeBlockTarget(lookups, draftCase.target);
        const caseOrigin = lookups.resolveOrigin(draftCase.origin);
        if (caseTarget === undefined || caseOrigin === undefined) {
          return undefined;
        }
        cases.push({ label: draftCase.label, target: caseTarget, origin: caseOrigin });
        outgoingEdges.push(caseTarget.edgeId);
      }
      const fallback =
        terminator.fallback === undefined
          ? undefined
          : freezeBlockTarget(lookups, terminator.fallback);
      if (terminator.fallback !== undefined && fallback === undefined) {
        return undefined;
      }
      if (fallback !== undefined) {
        outgoingEdges.push(fallback.edgeId);
      }
      return {
        terminatorId: proofMirTerminatorId(terminatorId),
        kind: {
          kind: "switch",
          scrutinee,
          cases,
          ...(fallback === undefined ? {} : { fallback }),
        },
        outgoingEdges,
        origin,
      };
    }
    case "return": {
      const edge = lookups.edgeLookup.resolve(terminator.edge);
      const exit = lookups.exitLookup.resolve(terminator.exit);
      if (edge === undefined || exit === undefined) {
        return undefined;
      }
      const returnValue =
        terminator.value === undefined ? undefined : resolveValueKey(lookups, terminator.value);
      if (terminator.value !== undefined && returnValue === undefined) {
        return undefined;
      }
      return {
        terminatorId: proofMirTerminatorId(terminatorId),
        kind: {
          kind: "return",
          ...(returnValue === undefined
            ? {}
            : {
                value: {
                  mode: "observe",
                  operand: {
                    kind: "value",
                    value: returnValue,
                  },
                },
              }),
          edgeId: edge,
          exit,
        },
        outgoingEdges: [edge],
        origin,
      };
    }
    case "panic": {
      const edge = lookups.edgeLookup.resolve(terminator.edge);
      const exit = lookups.exitLookup.resolve(terminator.exit);
      if (edge === undefined || exit === undefined) {
        return undefined;
      }
      const reason =
        terminator.reason === undefined ? undefined : resolveValueKey(lookups, terminator.reason);
      if (terminator.reason !== undefined && reason === undefined) {
        return undefined;
      }
      return {
        terminatorId: proofMirTerminatorId(terminatorId),
        kind: {
          kind: "panic",
          ...(reason === undefined ? {} : { reason }),
          edgeId: edge,
          exit,
        },
        outgoingEdges: [edge],
        origin,
      };
    }
    case "matchValidation": {
      const okTarget = freezeBlockTarget(lookups, terminator.okTarget);
      const errTarget = freezeBlockTarget(lookups, terminator.errTarget);
      if (okTarget === undefined || errTarget === undefined) {
        return undefined;
      }
      const okBindings: ProofMirValidationArmBinding[] = [];
      for (const binding of terminator.okBindings) {
        const frozenBinding = freezeValidationBinding(lookups, binding);
        if (frozenBinding === undefined) {
          return undefined;
        }
        okBindings.push(frozenBinding);
      }
      const errBindings: ProofMirValidationArmBinding[] = [];
      for (const binding of terminator.errBindings) {
        const frozenBinding = freezeValidationBinding(lookups, binding);
        if (frozenBinding === undefined) {
          return undefined;
        }
        errBindings.push(frozenBinding);
      }
      const match: ProofMirValidationMatch = {
        validationId: terminator.validationId,
        okTarget,
        errTarget,
        okBindings,
        errBindings,
        origin,
      };
      return {
        terminatorId: proofMirTerminatorId(terminatorId),
        kind: { kind: "matchValidation", match },
        outgoingEdges: [okTarget.edgeId, errTarget.edgeId],
        origin,
      };
    }
    case "matchAttempt": {
      const successTarget = freezeBlockTarget(lookups, terminator.match.successTarget);
      const errorTarget = freezeBlockTarget(lookups, terminator.match.errorTarget);
      if (successTarget === undefined || errorTarget === undefined) {
        return undefined;
      }
      const inputPlaces: ProofMirPlaceId[] = [];
      for (const placeKey of terminator.match.inputPlaceKeys) {
        const place = resolvePlaceKey(lookups, placeKey);
        if (place === undefined) {
          return undefined;
        }
        inputPlaces.push(place);
      }
      return {
        terminatorId: proofMirTerminatorId(terminatorId),
        kind: {
          kind: "matchAttempt",
          match: {
            attemptId: terminator.match.attemptId,
            successTarget,
            errorTarget,
            inputPlaces,
            origin: lookups.resolveOrigin(terminator.match.origin) ?? origin,
          },
        },
        outgoingEdges: [successTarget.edgeId, errorTarget.edgeId],
        origin,
      };
    }
    case "unreachable":
      return {
        terminatorId: proofMirTerminatorId(terminatorId),
        kind: {
          kind: "unreachable",
          reason:
            terminator.reason === "afterNever" ||
            terminator.reason === "emptyMatch" ||
            terminator.reason === "unreachableSource"
              ? terminator.reason
              : "unreachableSource",
        },
        outgoingEdges: [],
        origin,
      };
    default: {
      const unreachable: never = terminator;
      return unreachable;
    }
  }
}

function freezeExitEdge(
  lookups: FreezeGraphSnapshotLookups,
  exit: DraftProofMirGraphExitSnapshot,
  exitId: ProofMirExitEdgeId,
  errorContext: FreezeGraphSnapshotErrorContext,
): ProofMirExitEdge | "error" {
  const fromBlockId = lookups.resolveBlock(exit.fromBlockKey);
  const origin = lookups.resolveOrigin(exit.originKey);
  const fromBlockScopeKey = lookups.resolveBlockScopeKey(exit.fromBlockKey);
  if (fromBlockId === undefined || origin === undefined) {
    pushFreezeUnresolvedReference(
      errorContext,
      "exit-from-block",
      String(exit.key),
      "Proof MIR freeze could not resolve an exit edge block or origin reference.",
    );
    return "error";
  }
  const crossedScopes =
    exit.crossedScopeKeys !== undefined
      ? freezeScopeKeyList({
          lookups,
          scopeKeys: exit.crossedScopeKeys,
          errorContext,
          diagnosticRole: "exit-crossed-scope",
          message: "Proof MIR freeze could not resolve an exit crossed scope reference.",
        })
      : fromBlockScopeKey === undefined
        ? []
        : crossedScopeIdsForFunctionExit({
            scopeRecords: lookups.scopeRecords,
            scopeLookup: lookups.scopeLookup,
            sourceScopeKey: fromBlockScopeKey,
          });
  if (crossedScopes === "error") {
    return "error";
  }
  const targetScopeId =
    exit.targetScopeKey === undefined
      ? undefined
      : lookups.scopeLookup.resolve(exit.targetScopeKey);
  const boundary =
    targetScopeId === undefined
      ? ({ kind: "function", unwind: "none" } as const)
      : ({ kind: "scope", targetScopeId } as const);
  const closure = freezeExitClosure({
    lookups,
    exitKey: exit.key,
    closure: exit.closure,
    errorContext,
  });
  if (closure === "error") {
    return "error";
  }
  return {
    exitId,
    fromBlockId,
    kind: exit.exitKind,
    boundary,
    crossedScopes,
    closure,
    origin,
  };
}

export function freezeControlEdgesFromGraphSnapshot(input: {
  readonly snapshot: DraftProofMirGraphSnapshot;
  readonly edgeRecords: readonly { readonly key: ProofMirCanonicalKey }[];
  readonly lookups: FreezeGraphSnapshotLookups;
  readonly diagnostics: ProofMirDiagnostic[];
  readonly ownerKey: string;
  readonly functionInstanceId: MonoInstanceId;
}): ProofMirControlEdge[] | "error" {
  const errorContext: FreezeGraphSnapshotErrorContext = {
    diagnostics: input.diagnostics,
    ownerKey: input.ownerKey,
    functionInstanceId: input.functionInstanceId,
  };
  const edgeStates = edgeStateMap(input.snapshot);
  const frozenEdges: ProofMirControlEdge[] = [];
  for (const record of input.edgeRecords) {
    const state = edgeStates.get(String(record.key));
    if (state === undefined) {
      pushFreezeUnresolvedReference(
        errorContext,
        "edge-state",
        String(record.key),
        "Proof MIR freeze encountered a control edge without snapshot state.",
      );
      return "error";
    }
    const edgeId = input.lookups.edgeLookup.resolve(record.key);
    const fromBlockId = input.lookups.resolveBlock(state.fromBlockKey);
    const toBlockKey = state.toBlockKey ?? state.fromBlockKey;
    const toBlockId = input.lookups.resolveBlock(toBlockKey);
    const origin = input.lookups.resolveOrigin(state.originKey);
    if (
      edgeId === undefined ||
      fromBlockId === undefined ||
      toBlockId === undefined ||
      origin === undefined
    ) {
      pushFreezeUnresolvedReference(
        errorContext,
        "edge-reference",
        String(record.key),
        "Proof MIR freeze could not resolve a control edge reference.",
      );
      return "error";
    }
    const effects: ProofMirEdgeEffect[] = [];
    for (const effect of state.effects) {
      const frozenEffect = freezeEdgeEffect(input.lookups, effect);
      if (frozenEffect === undefined) {
        pushFreezeUnresolvedReference(
          errorContext,
          "edge-effect",
          `${String(record.key)}:${effect.kind}`,
          "Proof MIR freeze could not resolve a control edge effect reference.",
        );
        return "error";
      }
      effects.push(frozenEffect);
    }
    const edgeArguments: ProofMirValueId[] = [];
    for (const argumentKey of state.argumentKeys) {
      const valueId = input.lookups.valueLookup.resolve(argumentKey);
      if (valueId === undefined) {
        pushFreezeUnresolvedReference(
          errorContext,
          "edge-argument",
          String(argumentKey),
          "Proof MIR freeze could not resolve a control edge argument reference.",
        );
        return "error";
      }
      edgeArguments.push(valueId);
    }
    const facts: ProofMirFactId[] = [];
    for (const factKey of state.factKeys) {
      const factId = input.lookups.factLookup.resolve(factKey);
      if (factId === undefined) {
        pushFreezeUnresolvedReference(
          errorContext,
          "edge-fact",
          String(factKey),
          "Proof MIR freeze could not resolve a control edge fact reference.",
        );
        return "error";
      }
      facts.push(factId);
    }
    const exit =
      state.exitKey === undefined ? undefined : input.lookups.exitLookup.resolve(state.exitKey);
    if (state.exitKey !== undefined && exit === undefined) {
      pushFreezeUnresolvedReference(
        errorContext,
        "edge-exit",
        String(state.exitKey),
        "Proof MIR freeze could not resolve a control edge exit reference.",
      );
      return "error";
    }
    frozenEdges.push({
      edgeId,
      fromBlockId,
      toBlockId,
      kind: state.kind,
      arguments: edgeArguments,
      facts,
      effects,
      crossedScopes: crossedScopeIdsForDraftEdge({
        scopeRecords: input.lookups.scopeRecords,
        scopeLookup: input.lookups.scopeLookup,
        sourceScopeKey: state.sourceScopeKey,
        targetScopeKey: state.targetScopeKey,
      }),
      ...(exit === undefined ? {} : { exit }),
      origin,
    });
  }
  return frozenEdges;
}

export function freezeBlocksFromGraphSnapshot(input: {
  readonly snapshot: DraftProofMirGraphSnapshot;
  readonly blockRecords: readonly {
    readonly key: ProofMirCanonicalKey;
    readonly scopeKey: ProofMirCanonicalKey;
    readonly originKey: ProofMirCanonicalKey;
  }[];
  readonly lookups: FreezeDraftStatementLookups;
  readonly incomingEdgesByBlock: ReadonlyMap<ProofMirBlockId, ProofMirControlEdgeId[]>;
  readonly diagnostics: ProofMirDiagnostic[];
  readonly ownerKey: string;
  readonly functionInstanceId: MonoInstanceId;
}): ProofMirBlock[] | "error" {
  const frozenBlocks: ProofMirBlock[] = [];
  let blockOrdinal = 0;
  let terminatorOrdinal = 0;
  const blockMap = blockStateMap(input.snapshot);
  for (const record of input.blockRecords) {
    const blockId = input.lookups.blockLookup.resolve(record.key)!;
    const scopeId = input.lookups.scopeLookup.resolve(record.scopeKey);
    const origin = input.lookups.resolveOrigin(record.originKey);
    if (scopeId === undefined || origin === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_TABLE_CANONICAL_KEY",
          message: "Proof MIR freeze could not resolve a block scope or origin reference.",
          functionInstanceId: input.functionInstanceId,
          ownerKey: input.ownerKey,
          rootCauseKey: "block-scope",
          stableDetail: String(record.key),
        }),
      );
      return "error";
    }
    const snapshotBlock = snapshotBlockForKey(blockMap, record.key);
    const statements: ProofMirStatement[] = [];
    if (snapshotBlock?.statements !== undefined) {
      for (const draftStatement of snapshotBlock.statements as readonly DraftProofMirGraphStatementSnapshot[]) {
        const frozenStatement = freezeDraftGraphStatement(input.lookups, draftStatement);
        if (frozenStatement === undefined) {
          input.diagnostics.push(
            proofMirDiagnostic({
              severity: "error",
              code: "PROOF_MIR_INVALID_TABLE_CANONICAL_KEY",
              message: `Proof MIR freeze could not resolve a draft statement reference (${draftStatement.kind.kind}).`,
              functionInstanceId: input.functionInstanceId,
              ownerKey: input.ownerKey,
              rootCauseKey: "statement",
              stableDetail: String(draftStatement.statementKey),
            }),
          );
          return "error";
        }
        statements.push(frozenStatement);
      }
    }
    const parameters: ProofMirBlockParameter[] = [];
    if (snapshotBlock?.parameters !== undefined) {
      for (const parameter of snapshotBlock.parameters) {
        const frozenParameter = freezeBlockParameter(input.lookups, parameter);
        if (frozenParameter === undefined) {
          input.diagnostics.push(
            proofMirDiagnostic({
              severity: "error",
              code: "PROOF_MIR_INVALID_TABLE_CANONICAL_KEY",
              message: "Proof MIR freeze could not resolve a block parameter reference.",
              functionInstanceId: input.functionInstanceId,
              ownerKey: input.ownerKey,
              rootCauseKey: "block-parameter",
              stableDetail: String(record.key),
            }),
          );
          return "error";
        }
        parameters.push(frozenParameter);
      }
    }
    const draftTerminator = snapshotBlock?.terminator;
    if (draftTerminator === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_MISSING_TERMINATOR_ID",
          message: "Proof MIR freeze encountered a block without a terminator.",
          functionInstanceId: input.functionInstanceId,
          ownerKey: input.ownerKey,
          rootCauseKey: "missing-terminator",
          stableDetail: String(record.key),
        }),
      );
      return "error";
    }
    const terminator = freezeTerminator(input.lookups, draftTerminator, terminatorOrdinal++);
    if (terminator === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_INVALID_CFG",
          message: "Proof MIR freeze could not resolve a block terminator.",
          functionInstanceId: input.functionInstanceId,
          ownerKey: input.ownerKey,
          rootCauseKey: "terminator",
          stableDetail: String(record.key),
        }),
      );
      return "error";
    }
    const stateMerge =
      snapshotBlock === undefined
        ? undefined
        : freezeBlockStateMerge(input.lookups, snapshotBlock, {
            diagnostics: input.diagnostics,
            ownerKey: input.ownerKey,
            functionInstanceId: input.functionInstanceId,
          });
    if (snapshotBlock?.stateMerge !== undefined && stateMerge === undefined) {
      return "error";
    }
    frozenBlocks.push({
      blockId,
      scopeId,
      parameters,
      statements,
      terminator,
      incomingEdges: input.incomingEdgesByBlock.get(blockId) ?? [],
      ...(stateMerge === undefined ? {} : { stateMerge }),
      origin,
    });
    blockOrdinal += 1;
    void blockOrdinal;
  }
  return frozenBlocks;
}

export function freezeExitsFromGraphSnapshot(input: {
  readonly snapshot: DraftProofMirGraphSnapshot;
  readonly exitRecords: readonly { readonly key: ProofMirCanonicalKey }[];
  readonly lookups: FreezeGraphSnapshotLookups;
  readonly diagnostics: ProofMirDiagnostic[];
  readonly ownerKey: string;
  readonly functionInstanceId: MonoInstanceId;
}): ProofMirExitEdge[] | "error" {
  const errorContext: FreezeGraphSnapshotErrorContext = {
    diagnostics: input.diagnostics,
    ownerKey: input.ownerKey,
    functionInstanceId: input.functionInstanceId,
  };
  const exitStateByKey = new Map(input.snapshot.exits.map((exit) => [String(exit.key), exit]));
  const frozenExits: ProofMirExitEdge[] = [];
  for (const record of input.exitRecords) {
    const exit = exitStateByKey.get(String(record.key));
    if (exit === undefined) {
      pushFreezeUnresolvedReference(
        errorContext,
        "exit-state",
        String(record.key),
        "Proof MIR freeze encountered an exit edge without snapshot state.",
      );
      return "error";
    }
    const exitId = input.lookups.exitLookup.resolve(record.key);
    if (exitId === undefined) {
      pushFreezeUnresolvedReference(
        errorContext,
        "exit-id",
        String(record.key),
        "Proof MIR freeze could not resolve an exit edge ID.",
      );
      return "error";
    }
    const frozen = freezeExitEdge(input.lookups, exit, exitId, errorContext);
    if (frozen === "error") {
      return "error";
    }
    frozenExits.push(frozen);
  }
  return frozenExits;
}
