import { instantiatedHirIdKey } from "../../mono/ids";
import type { MonoBlock, MonoLocal, MonoStatement } from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { sortProofMirDiagnostics, type ProofMirDiagnostic } from "../diagnostics";
import {
  proofMirSsaKeyString,
  proofMirSsaLocalKey,
  type ProofMirSsaKey,
} from "../domains/graph-ssa";
import { draftLocalKey } from "../draft/draft-keys";
import type { ProofMirLoweringContext, ProofMirLoweringResult } from "./lowering-context";
import { originForStatement } from "./lowering-origins";
import { blockHasTerminator } from "./control-flow-terminators";
import type {
  ActiveLoopFrame,
  LoopLoweringSharedInput,
  StructuredLoopScaffold,
} from "./loop-lowering-types";
import { syncLoweredPlaceToFunctionDraft } from "./lowering-place-sync";
import { monoLocalPlace } from "./mono-place-builders";

export type { StructuredLoopScaffold };

export function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

export function loweringError(
  diagnostics: readonly ProofMirDiagnostic[],
): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

export function loopRoleForStatement(statement: MonoStatement): string {
  return `loop:stmt:${instantiatedHirIdKey(statement.statementId)}`;
}

export { blockHasExitTerminator, blockHasTerminator } from "./control-flow-terminators";

export function copyScalarSsaKeysForLocals(
  context: ProofMirLoweringContext,
  locals: readonly MonoLocal[],
): readonly { readonly ssaKey: ProofMirSsaKey; readonly localKey: ProofMirCanonicalKey }[] {
  return locals
    .filter((local) => context.localClassifier.storageForLocal(local.localId) === "scalarSsa")
    .map((local) => ({
      ssaKey: proofMirSsaLocalKey(
        draftLocalKey({
          functionInstanceId: context.functionInstanceId,
          monoLocalId: local.localId,
        }),
      ),
      localKey: draftLocalKey({
        functionInstanceId: context.functionInstanceId,
        monoLocalId: local.localId,
      }),
    }));
}

export function readScalarValuesAtBlock(
  context: ProofMirLoweringContext,
  blockKey: ProofMirCanonicalKey,
  scalarKeys: readonly { readonly ssaKey: ProofMirSsaKey }[],
): Map<string, ProofMirCanonicalKey> {
  const values = new Map<string, ProofMirCanonicalKey>();
  for (const entry of scalarKeys) {
    const valueKey = context.ssa.readScalar({
      blockKey,
      ssaKey: entry.ssaKey,
    });
    if (valueKey !== undefined) {
      values.set(proofMirSsaKeyString(entry.ssaKey), valueKey);
    }
  }
  return values;
}

export function orderedEdgeArgumentKeys(
  argumentKeysBySsaKey: Readonly<Record<string, ProofMirCanonicalKey>>,
  scalarKeys: readonly { readonly ssaKey: ProofMirSsaKey }[],
): readonly ProofMirCanonicalKey[] {
  return scalarKeys
    .map((entry) => argumentKeysBySsaKey[proofMirSsaKeyString(entry.ssaKey)])
    .filter((value): value is ProofMirCanonicalKey => value !== undefined);
}

export function argumentMapForScalars(
  values: Map<string, ProofMirCanonicalKey>,
  scalarKeys: readonly { readonly ssaKey: ProofMirSsaKey }[],
): Record<string, ProofMirCanonicalKey> {
  const argumentsBySsaKey: Record<string, ProofMirCanonicalKey> = {};
  for (const entry of scalarKeys) {
    const valueKey = values.get(proofMirSsaKeyString(entry.ssaKey));
    if (valueKey !== undefined) {
      argumentsBySsaKey[proofMirSsaKeyString(entry.ssaKey)] = valueKey;
    }
  }
  return argumentsBySsaKey;
}

function syncLoopHeaderBlockParameters(input: {
  readonly context: ProofMirLoweringContext;
  readonly headerBlockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<void> {
  for (const parameter of input.context.ssa.blockParameters(input.headerBlockKey)) {
    const addResult = input.context.graph.addBlockParameter(input.headerBlockKey, {
      valueKey: parameter.valueKey,
      role: parameter.parameterKind,
      origin: input.originKey,
    });
    if (addResult.kind === "error") {
      return addResult;
    }
  }
  return loweringOk(undefined);
}

export function wireGotoEdge(input: {
  readonly context: ProofMirLoweringContext;
  readonly fromBlockKey: ProofMirCanonicalKey;
  readonly toBlockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly argumentKeysBySsaKey?: Readonly<Record<string, ProofMirCanonicalKey>>;
  readonly scalarKeys?: readonly { readonly ssaKey: ProofMirSsaKey }[];
  readonly role: string;
  readonly createEdge: (edgeInput: {
    readonly fromBlock: ProofMirCanonicalKey;
    readonly toBlock: ProofMirCanonicalKey;
    readonly sourceScope: ProofMirCanonicalKey;
    readonly targetScope: ProofMirCanonicalKey;
    readonly origin: ProofMirCanonicalKey;
    readonly argumentKeys?: readonly ProofMirCanonicalKey[];
    readonly role?: string;
  }) => ProofMirCanonicalKey;
  readonly registerTarget?: boolean;
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  const fromScope = input.context.graph.block(input.fromBlockKey).scopeKey;
  const toScope = input.context.graph.block(input.toBlockKey).scopeKey;
  const scalarKeys = input.scalarKeys ?? [];
  const orderedArguments =
    input.argumentKeysBySsaKey === undefined
      ? []
      : orderedEdgeArgumentKeys(input.argumentKeysBySsaKey, scalarKeys);
  const edgeKey = input.createEdge({
    role: input.role,
    fromBlock: input.fromBlockKey,
    toBlock: input.toBlockKey,
    sourceScope: fromScope,
    targetScope: toScope,
    origin: input.originKey,
    argumentKeys: orderedArguments,
  });
  if (input.registerTarget !== false) {
    input.context.ssa.registerPredecessorEdge({
      blockKey: input.toBlockKey,
      edgeKey,
      fromBlockKey: input.fromBlockKey,
      argumentKeysBySsaKey: input.argumentKeysBySsaKey,
    });
    input.context.ssa.setEdgeArguments({
      edgeKey,
      argumentKeys: orderedArguments,
    });
  }
  const setTerminatorResult = input.context.graph.setTerminator(input.fromBlockKey, {
    kind: "goto",
    target: { edge: edgeKey, block: input.toBlockKey },
    origin: input.originKey,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }
  return loweringOk(edgeKey);
}

export function predeclareLoopHeaderParameters(input: {
  readonly context: ProofMirLoweringContext;
  readonly headerBlockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly entryBlockKey: ProofMirCanonicalKey;
  readonly loopCarriedScalarKeys: readonly {
    readonly ssaKey: ProofMirSsaKey;
    readonly localKey: ProofMirCanonicalKey;
  }[];
}): ProofMirLoweringResult<void> {
  input.context.ssa.registerBlock(input.headerBlockKey);
  const entryScalars = readScalarValuesAtBlock(
    input.context,
    input.entryBlockKey,
    input.loopCarriedScalarKeys,
  );
  const parameters = input.loopCarriedScalarKeys.map((entry) => {
    const valueKey =
      entryScalars.get(proofMirSsaKeyString(entry.ssaKey)) ??
      input.context.graph.createValue({
        role: `loop.header:${proofMirSsaKeyString(entry.ssaKey)}`,
        origin: input.originKey,
      });
    return {
      ssaKey: entry.ssaKey,
      valueKey,
      parameterKind: "copyScalar" as const,
    };
  });
  input.context.ssa.declareLoopHeaderParameters({
    blockKey: input.headerBlockKey,
    parameters,
  });
  return syncLoopHeaderBlockParameters({
    context: input.context,
    headerBlockKey: input.headerBlockKey,
    originKey: input.originKey,
  });
}

export function collectPlaceBackedBoundaryKeys(input: {
  readonly context: ProofMirLoweringContext;
  readonly body: MonoBlock;
  readonly placeBackedLocals: readonly MonoLocal[];
}): readonly ProofMirCanonicalKey[] {
  const assignedLocalIds = new Set<string>();
  for (const statement of input.body.statements) {
    if (statement.kind.kind !== "assignment") {
      continue;
    }
    const assignment = statement.kind.statement;
    if (assignment.target.kind.kind === "name" && assignment.target.kind.localId !== undefined) {
      assignedLocalIds.add(instantiatedHirIdKey(assignment.target.kind.localId));
    }
  }
  const placeKeys: ProofMirCanonicalKey[] = [];
  for (const local of input.placeBackedLocals) {
    if (assignedLocalIds.size > 0 && !assignedLocalIds.has(instantiatedHirIdKey(local.localId))) {
      continue;
    }
    const localRecord = input.context.graph.functionDraft().locals.get(
      draftLocalKey({
        functionInstanceId: input.context.functionInstanceId,
        monoLocalId: local.localId,
      }),
    );
    if (localRecord?.backingPlaceKey !== undefined) {
      placeKeys.push(localRecord.backingPlaceKey);
      continue;
    }
    const functionInstance = input.context.program.functions.get(input.context.functionInstanceId);
    if (functionInstance === undefined) {
      continue;
    }
    const originKey = input.context.graph.allocateSyntheticOrigin(`loop.boundary:${local.name}`);
    const monoPlace = monoLocalPlace({ functionInstance, local });
    const loweredPlace = input.context.functionScopePlaceLowerer.lowerMonoPlace({
      monoPlace,
      originKey,
    });
    if (loweredPlace.kind === "ok") {
      placeKeys.push(
        syncLoweredPlaceToFunctionDraft({
          context: input.context,
          lowered: loweredPlace.value,
          monoPlace,
        }),
      );
    }
  }
  return placeKeys;
}

export function setupStructuredLoopScaffold(input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly shared: LoopLoweringSharedInput;
  readonly loopCarriedLocals: readonly MonoLocal[];
  readonly boundaryPlaceKeys: readonly ProofMirCanonicalKey[];
  readonly skipStatementRegistration?: boolean;
}): ProofMirLoweringResult<StructuredLoopScaffold> {
  const originKey = originForStatement(input.context, input.statement);
  if (input.skipStatementRegistration !== true) {
    input.context.graph.addStatement(input.blockKey, {
      origin: originKey,
    });
  }

  const parentScopeKey = input.context.graph.block(input.blockKey).scopeKey;
  const loopRole = loopRoleForStatement(input.statement);
  const loopScopeKey = input.context.graph.createScope({
    role: loopRole,
    parentScopeKey,
    origin: originKey,
  });
  const exitBlockKey = input.continuationBlockKey;
  const headerBlockKey = input.context.graph.createBlock({
    role: "loop.header",
    scope: loopScopeKey,
    origin: originKey,
    sourceOrigin: `${input.statement.sourceOrigin}:header`,
  });
  const bodyBlockKey = input.context.graph.createBlock({
    role: "loop.body",
    scope: loopScopeKey,
    origin: originKey,
    sourceOrigin: `${input.statement.sourceOrigin}:body`,
  });
  input.context.ssa.registerBlock(bodyBlockKey);

  const loopCarriedScalarKeys = copyScalarSsaKeysForLocals(input.context, input.loopCarriedLocals);
  const boundaryResources = input.context.functionScopePlaceLowerer.collectLoopBoundarySet({
    loopRole,
    places: input.boundaryPlaceKeys,
  });

  const predeclared = predeclareLoopHeaderParameters({
    context: input.context,
    headerBlockKey,
    originKey,
    entryBlockKey: input.blockKey,
    loopCarriedScalarKeys,
  });
  if (predeclared.kind === "error") {
    return predeclared;
  }

  const entryScalars = readScalarValuesAtBlock(
    input.context,
    input.blockKey,
    loopCarriedScalarKeys,
  );
  const entryEdge = wireGotoEdge({
    context: input.context,
    fromBlockKey: input.blockKey,
    toBlockKey: headerBlockKey,
    originKey,
    argumentKeysBySsaKey: argumentMapForScalars(entryScalars, loopCarriedScalarKeys),
    scalarKeys: loopCarriedScalarKeys,
    role: "loop.entry",
    createEdge: (edgeInput) =>
      input.context.graph.createNormalEdge({
        role: edgeInput.role ?? "loop.entry",
        fromBlock: edgeInput.fromBlock,
        toBlock: edgeInput.toBlock,
        sourceScope: edgeInput.sourceScope,
        targetScope: edgeInput.targetScope,
        origin: edgeInput.origin,
        argumentKeys: edgeInput.argumentKeys,
      }),
  });
  if (entryEdge.kind === "error") {
    return entryEdge;
  }

  const frame: ActiveLoopFrame = {
    headerBlockKey,
    bodyBlockKey,
    exitBlockKey,
    loopScopeKey,
    loopRole,
    loopCarriedScalarKeys,
    boundaryResources,
  };

  return loweringOk({
    originKey,
    loopScopeKey,
    loopRole,
    headerBlockKey,
    bodyBlockKey,
    exitBlockKey,
    loopCarriedScalarKeys,
    boundaryResources,
    frame,
  });
}

export function wireLoopBackEdge(input: {
  readonly context: ProofMirLoweringContext;
  readonly frame: ActiveLoopFrame;
  readonly bodyBlockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  if (blockHasTerminator(input.context, input.bodyBlockKey)) {
    return loweringOk(input.frame.headerBlockKey);
  }
  const bodyScalars = readScalarValuesAtBlock(
    input.context,
    input.bodyBlockKey,
    input.frame.loopCarriedScalarKeys,
  );
  return wireGotoEdge({
    context: input.context,
    fromBlockKey: input.bodyBlockKey,
    toBlockKey: input.frame.headerBlockKey,
    originKey: input.originKey,
    argumentKeysBySsaKey: argumentMapForScalars(bodyScalars, input.frame.loopCarriedScalarKeys),
    scalarKeys: input.frame.loopCarriedScalarKeys,
    role: "loop.back-edge",
    createEdge: (edgeInput) =>
      input.context.graph.createNormalEdge({
        role: edgeInput.role ?? "loop.back-edge",
        fromBlock: edgeInput.fromBlock,
        toBlock: edgeInput.toBlock,
        sourceScope: edgeInput.sourceScope,
        targetScope: edgeInput.targetScope,
        origin: edgeInput.origin,
        argumentKeys: edgeInput.argumentKeys,
      }),
  });
}
