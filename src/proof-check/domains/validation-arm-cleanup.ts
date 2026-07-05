import type { ProofMirScopeId } from "../../proof-mir/ids";
import type {
  ProofMirControlEdge,
  ProofMirExitEdge,
  ProofMirFunction,
} from "../../proof-mir/model/graph";
import { instantiatedHirIdKey } from "../../mono/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  equivalentProofMirPlaceKeys,
  tryResolveProofMirPlaceIdForPlaceKey,
  type ProofCheckPlaceResolver,
} from "../kernel/registry/transition-helpers";

export function introducedValidationArmPlaceKeysFromEdge(input: {
  readonly functionGraph: ProofMirFunction | undefined;
  readonly edge: ProofMirControlEdge | undefined;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): readonly string[] {
  if (input.edge === undefined) {
    return [];
  }

  const placeKeys = new Set<string>();
  for (const effect of input.edge.effects) {
    if (effect.kind !== "introducePlace") {
      continue;
    }
    for (const placeKey of equivalentProofMirPlaceKeys({
      functionGraph: input.functionGraph,
      placeId: effect.placeId,
      placeResolver: input.placeResolver,
    })) {
      placeKeys.add(placeKey);
    }
  }
  return [...placeKeys].sort(compareCodeUnitStrings);
}

export function introducedValidationArmLayoutPlaceKeysFromEdge(input: {
  readonly functionGraph: ProofMirFunction | undefined;
  readonly edge: ProofMirControlEdge | undefined;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): readonly string[] {
  if (input.edge === undefined || input.functionGraph === undefined) {
    return [];
  }

  const placeKeys = new Set<string>();
  for (const effect of input.edge.effects) {
    if (effect.kind !== "introducePlace") {
      continue;
    }
    const place = input.functionGraph.places.get(effect.placeId);
    if (place === undefined || place.projection.length > 0) {
      continue;
    }
    for (const placeKey of equivalentProofMirPlaceKeys({
      functionGraph: input.functionGraph,
      placeId: effect.placeId,
      placeResolver: input.placeResolver,
    })) {
      placeKeys.add(placeKey);
    }
  }
  return [...placeKeys].sort(compareCodeUnitStrings);
}

function crossedValidationCleanupScopeIds(input: {
  readonly functionGraph: ProofMirFunction;
  readonly exit: ProofMirExitEdge;
}): ReadonlySet<ProofMirScopeId> {
  if (input.exit.boundary.kind !== "function") {
    return new Set();
  }

  const validationArmScopeIds = new Set(
    input.exit.crossedScopes.filter(
      (scopeId) => input.functionGraph.scopes.get(scopeId)?.kind === "validationArm",
    ),
  );
  return validationArmScopeIds;
}

function crossedNonFunctionCleanupScopeIds(input: {
  readonly functionGraph: ProofMirFunction;
  readonly exit: ProofMirExitEdge;
}): ReadonlySet<ProofMirScopeId> {
  if (input.exit.boundary.kind !== "function") {
    return new Set();
  }

  return nonFunctionCleanupScopeIds({
    functionGraph: input.functionGraph,
    crossedScopes: input.exit.crossedScopes,
  });
}

function nonFunctionCleanupScopeIds(input: {
  readonly functionGraph: ProofMirFunction;
  readonly crossedScopes: readonly ProofMirScopeId[];
}): ReadonlySet<ProofMirScopeId> {
  return new Set(
    input.crossedScopes.filter(
      (scopeId) => input.functionGraph.scopes.get(scopeId)?.kind !== "function",
    ),
  );
}

function scopeOwnedLocalPlaceKeys(input: {
  readonly functionGraph: ProofMirFunction;
  readonly crossedScopeIds: ReadonlySet<ProofMirScopeId>;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): readonly string[] {
  const ownedLocalKeys = new Set<string>();
  for (const scopeId of input.crossedScopeIds) {
    const scope = input.functionGraph.scopes.get(scopeId);
    if (scope === undefined) {
      continue;
    }
    for (const localId of scope.ownedLocals) {
      ownedLocalKeys.add(instantiatedHirIdKey(localId));
    }
  }
  if (ownedLocalKeys.size === 0) {
    return [];
  }

  const placeKeys = new Set<string>();
  for (const place of input.functionGraph.places.entries()) {
    if (
      place.root.kind !== "local" ||
      !ownedLocalKeys.has(instantiatedHirIdKey(place.root.localId))
    ) {
      continue;
    }
    for (const placeKey of equivalentProofMirPlaceKeys({
      functionGraph: input.functionGraph,
      placeId: place.placeId,
      placeResolver: input.placeResolver,
    })) {
      placeKeys.add(placeKey);
    }
  }

  return [...placeKeys].sort((left, right) => {
    const depthDelta =
      projectionDepthForPlaceKey({
        functionGraph: input.functionGraph,
        placeKey: right,
        placeResolver: input.placeResolver,
      }) -
      projectionDepthForPlaceKey({
        functionGraph: input.functionGraph,
        placeKey: left,
        placeResolver: input.placeResolver,
      });
    return depthDelta === 0 ? compareCodeUnitStrings(left, right) : depthDelta;
  });
}

function scopeDescendsFromAny(input: {
  readonly functionGraph: ProofMirFunction;
  readonly scopeId: ProofMirScopeId;
  readonly ancestorScopeIds: ReadonlySet<ProofMirScopeId>;
}): boolean {
  const seen = new Set<ProofMirScopeId>();
  let currentScopeId: ProofMirScopeId | undefined = input.scopeId;
  while (currentScopeId !== undefined && !seen.has(currentScopeId)) {
    if (input.ancestorScopeIds.has(currentScopeId)) {
      return true;
    }
    seen.add(currentScopeId);
    currentScopeId = input.functionGraph.scopes.get(currentScopeId)?.parentScopeId;
  }
  return false;
}

function edgeTargetsCrossedScope(input: {
  readonly functionGraph: ProofMirFunction;
  readonly edge: ProofMirControlEdge;
  readonly crossedScopeIds: ReadonlySet<ProofMirScopeId>;
}): boolean {
  if (input.edge.toBlockId === undefined) {
    return false;
  }
  const targetBlock = input.functionGraph.blocks.get(input.edge.toBlockId);
  if (targetBlock === undefined) {
    return false;
  }
  return scopeDescendsFromAny({
    functionGraph: input.functionGraph,
    scopeId: targetBlock.scopeId,
    ancestorScopeIds: input.crossedScopeIds,
  });
}

function projectionDepthForPlaceKey(input: {
  readonly functionGraph: ProofMirFunction;
  readonly placeKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): number {
  const placeId = tryResolveProofMirPlaceIdForPlaceKey(input.placeKey, input.placeResolver);
  if (placeId === undefined) {
    return 0;
  }
  return input.functionGraph.places.get(placeId)?.projection.length ?? 0;
}

export function validationArmCleanupPlaceKeys(input: {
  readonly functionGraph: ProofMirFunction;
  readonly exit: ProofMirExitEdge;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): readonly string[] {
  const crossedScopeIds = crossedValidationCleanupScopeIds(input);
  if (crossedScopeIds.size === 0) {
    return [];
  }

  const placeKeys = new Set<string>();
  for (const placeKey of scopeOwnedLocalPlaceKeys({
    functionGraph: input.functionGraph,
    crossedScopeIds,
    placeResolver: input.placeResolver,
  })) {
    placeKeys.add(placeKey);
  }
  for (const edge of input.functionGraph.edges.entries()) {
    if (
      edge.kind !== "validationOk" ||
      !edgeTargetsCrossedScope({
        functionGraph: input.functionGraph,
        edge,
        crossedScopeIds,
      })
    ) {
      continue;
    }
    for (const placeKey of introducedValidationArmPlaceKeysFromEdge({
      functionGraph: input.functionGraph,
      edge,
      placeResolver: input.placeResolver,
    })) {
      placeKeys.add(placeKey);
    }
  }

  return [...placeKeys].sort((left, right) => {
    const depthDelta =
      projectionDepthForPlaceKey({
        functionGraph: input.functionGraph,
        placeKey: right,
        placeResolver: input.placeResolver,
      }) -
      projectionDepthForPlaceKey({
        functionGraph: input.functionGraph,
        placeKey: left,
        placeResolver: input.placeResolver,
      });
    return depthDelta === 0 ? compareCodeUnitStrings(left, right) : depthDelta;
  });
}

export function exitScopeIntroducedPlaceCleanupKeys(input: {
  readonly functionGraph: ProofMirFunction;
  readonly exit: ProofMirExitEdge;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): readonly string[] {
  const crossedScopeIds = crossedNonFunctionCleanupScopeIds(input);
  if (crossedScopeIds.size === 0) {
    return [];
  }

  const placeKeys = new Set<string>();
  for (const placeKey of scopeOwnedLocalPlaceKeys({
    functionGraph: input.functionGraph,
    crossedScopeIds,
    placeResolver: input.placeResolver,
  })) {
    placeKeys.add(placeKey);
  }
  for (const edge of input.functionGraph.edges.entries()) {
    if (
      !edgeTargetsCrossedScope({
        functionGraph: input.functionGraph,
        edge,
        crossedScopeIds,
      })
    ) {
      continue;
    }
    for (const placeKey of introducedValidationArmPlaceKeysFromEdge({
      functionGraph: input.functionGraph,
      edge,
      placeResolver: input.placeResolver,
    })) {
      placeKeys.add(placeKey);
    }
  }

  return [...placeKeys].sort((left, right) => {
    const depthDelta =
      projectionDepthForPlaceKey({
        functionGraph: input.functionGraph,
        placeKey: right,
        placeResolver: input.placeResolver,
      }) -
      projectionDepthForPlaceKey({
        functionGraph: input.functionGraph,
        placeKey: left,
        placeResolver: input.placeResolver,
      });
    return depthDelta === 0 ? compareCodeUnitStrings(left, right) : depthDelta;
  });
}

export function edgeScopeIntroducedPlaceCleanupKeys(input: {
  readonly functionGraph: ProofMirFunction;
  readonly edge: ProofMirControlEdge;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): readonly string[] {
  const crossedScopeIds = nonFunctionCleanupScopeIds({
    functionGraph: input.functionGraph,
    crossedScopes: input.edge.crossedScopes,
  });
  if (crossedScopeIds.size === 0) {
    return [];
  }

  const placeKeys = new Set<string>();
  for (const placeKey of scopeOwnedLocalPlaceKeys({
    functionGraph: input.functionGraph,
    crossedScopeIds,
    placeResolver: input.placeResolver,
  })) {
    placeKeys.add(placeKey);
  }
  for (const edge of input.functionGraph.edges.entries()) {
    if (
      !edgeTargetsCrossedScope({
        functionGraph: input.functionGraph,
        edge,
        crossedScopeIds,
      })
    ) {
      continue;
    }
    for (const placeKey of introducedValidationArmPlaceKeysFromEdge({
      functionGraph: input.functionGraph,
      edge,
      placeResolver: input.placeResolver,
    })) {
      placeKeys.add(placeKey);
    }
  }

  return [...placeKeys].sort(compareCodeUnitStrings);
}
