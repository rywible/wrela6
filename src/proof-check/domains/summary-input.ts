import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirFunction } from "../../proof-mir/model/graph";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofCheckRegistryAccumulator } from "../kernel/registry/registry-effects";
import type { ProofCheckFunctionRegistryArtifacts } from "../kernel/registry/registry-effects";
import type { ProofCheckState } from "../kernel/state";
import { normalizeProofCheckTerm, proofCheckPlaceBinderFromKey } from "../model/fact-language";
import {
  declaredRequirementsForFunctionWithDiagnostics,
  requirementTermFromProofMirFact,
} from "./mir-requirement-terms";
import type {
  BuildCheckedFunctionSummaryInput,
  CheckedFunctionSummaryPlaceEffectInput,
  CheckedSummaryFactDependency,
  CheckedSummaryReturnFactCandidate,
} from "./source-calls";
import {
  buildCoreTerminalGraph,
  type BuildCoreTerminalGraphInput,
  type TerminalGraphEdge,
} from "./terminal";

export interface ProofCheckSummaryPlaceEffectAccumulator {
  observed: CheckedFunctionSummaryPlaceEffectInput[];
  consumed: CheckedFunctionSummaryPlaceEffectInput[];
  mutated: CheckedFunctionSummaryPlaceEffectInput[];
  produced: CheckedFunctionSummaryPlaceEffectInput[];
}

export function emptySummaryPlaceEffectAccumulator(): ProofCheckSummaryPlaceEffectAccumulator {
  return {
    observed: [],
    consumed: [],
    mutated: [],
    produced: [],
  };
}

export function recordSummaryPlaceEffect(
  accumulator: ProofCheckSummaryPlaceEffectAccumulator,
  effect: CheckedFunctionSummaryPlaceEffectInput,
): void {
  switch (effect.kind) {
    case "observes":
      accumulator.observed.push(effect);
      break;
    case "consumes":
      accumulator.consumed.push(effect);
      break;
    case "mutates":
      accumulator.mutated.push(effect);
      break;
    case "produces":
    case "returns":
      accumulator.produced.push(effect);
      break;
    default: {
      const unreachable: never = effect.kind;
      return unreachable;
    }
  }
}

function factTermKeysForState(state: ProofCheckState): ReadonlySet<string> {
  return new Set([...state.facts.values()].map((fact) => fact.termKey));
}

function intersectFactTermKeysAcrossReturnPaths(
  exitStates: readonly ProofCheckState[],
): ReadonlySet<string> {
  if (exitStates.length === 0) {
    return new Set();
  }
  let intersection = factTermKeysForState(exitStates[0] as ProofCheckState);
  for (const exitState of exitStates.slice(1)) {
    const pathFacts = factTermKeysForState(exitState);
    intersection = new Set([...intersection].filter((termKey) => pathFacts.has(termKey)));
  }
  return intersection;
}

function summaryDependencyForPlaceBinder(
  binder: NonNullable<ReturnType<typeof proofCheckPlaceBinderFromKey>>,
): CheckedSummaryFactDependency | undefined {
  switch (binder.kind) {
    case "receiver":
      return { kind: "receiver" };
    case "parameter":
      return { kind: "parameter", index: binder.index };
    case "result":
      return { kind: "result" };
    default:
      return undefined;
  }
}

function dependenciesForExportableFact(input: {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly termKey: string;
}): readonly CheckedSummaryFactDependency[] {
  const functionGraph = input.mir.functions.get(input.functionInstanceId);
  if (functionGraph === undefined) {
    return [];
  }

  for (const fact of input.mir.facts.entries()) {
    const term = requirementTermFromProofMirFact({ mir: input.mir, functionGraph, fact });
    if (term === undefined) {
      continue;
    }
    if (normalizeProofCheckTerm(term, "sourceRequirement").key !== input.termKey) {
      continue;
    }
    const dependencies: CheckedSummaryFactDependency[] = [];
    for (const dependency of fact.dependsOn) {
      if (dependency.kind !== "place") {
        continue;
      }
      const place = functionGraph.places.get(dependency.placeId.placeId);
      if (place === undefined) {
        dependencies.push({
          kind: "internalLocal",
          key: `proofMirPlace:${String(dependency.placeId.placeId)}`,
        });
      } else if (place.root.kind === "parameter") {
        const parameterRoot = place.root;
        const index = functionGraph.signature.parameters.findIndex(
          (parameter) => String(parameter.parameterId) === String(parameterRoot.parameterId),
        );
        dependencies.push({ kind: "parameter", index: index >= 0 ? index : 0 });
      } else if (place.root.kind === "receiver") {
        dependencies.push({ kind: "receiver" });
      } else {
        dependencies.push({
          kind: "internalLocal",
          key: `proofMirPlace:${String(dependency.placeId.placeId)}`,
        });
      }
    }
    return dependencies;
  }

  const binder = proofCheckPlaceBinderFromKey(input.termKey);
  if (binder === undefined) {
    return [];
  }
  const dependency = summaryDependencyForPlaceBinder(binder);
  return dependency === undefined ? [] : [dependency];
}

function returnFactCandidatesForFunction(input: {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly exitStates: readonly ProofCheckState[];
}): readonly CheckedSummaryReturnFactCandidate[] {
  const factsOnAllReturnPaths = intersectFactTermKeysAcrossReturnPaths(input.exitStates);
  const candidates: CheckedSummaryReturnFactCandidate[] = [];

  for (const termKey of factsOnAllReturnPaths) {
    candidates.push({
      termKey,
      dependencies: [
        ...dependenciesForExportableFact({
          mir: input.mir,
          functionInstanceId: input.functionInstanceId,
          termKey,
        }),
      ],
    });
  }

  const functionGraph = input.mir.functions.get(input.functionInstanceId);
  if (functionGraph !== undefined) {
    for (const fact of input.mir.facts.entries()) {
      if (fact.role !== "candidate" && fact.role !== "evidence") {
        continue;
      }
      const term = requirementTermFromProofMirFact({ mir: input.mir, functionGraph, fact });
      if (term === undefined) {
        continue;
      }
      const normalized = normalizeProofCheckTerm(term, "activeFact");
      if (!factsOnAllReturnPaths.has(normalized.key)) {
        continue;
      }
      if (candidates.some((candidate) => candidate.termKey === normalized.key)) {
        continue;
      }
      candidates.push({
        termKey: normalized.key,
        dependencies: [
          ...dependenciesForExportableFact({
            mir: input.mir,
            functionInstanceId: input.functionInstanceId,
            termKey: normalized.key,
          }),
        ],
      });
    }
  }

  return [...candidates].sort((left, right) => compareCodeUnitStrings(left.termKey, right.termKey));
}

function placeEffectsFromRegistry(input: {
  readonly registryAccumulator?: ProofCheckRegistryAccumulator;
  readonly registryArtifacts?: ProofCheckFunctionRegistryArtifacts;
  readonly functionInstanceId: MonoInstanceId;
}): ProofCheckSummaryPlaceEffectAccumulator {
  if (input.registryArtifacts !== undefined) {
    return input.registryArtifacts.summaryPlaceEffects;
  }
  return (
    input.registryAccumulator?.summaryPlaceEffectsByFunction.get(input.functionInstanceId) ??
    emptySummaryPlaceEffectAccumulator()
  );
}

function isExportablePlaceEffect(
  functionGraph: ProofMirFunction | undefined,
  effect: CheckedFunctionSummaryPlaceEffectInput,
): boolean {
  if (effect.kind === "returns") {
    return true;
  }
  const binder = proofCheckPlaceBinderFromKey(effect.placeKey);
  if (binder === undefined) {
    return false;
  }
  if (
    (binder.kind === "parameter" || binder.kind === "argument") &&
    parameterResourceKind(functionGraph, binder.index) === "Copy"
  ) {
    return false;
  }
  switch (binder.kind) {
    case "receiver":
    case "parameter":
    case "argument":
    case "result":
      return true;
    case "proofMirPlace": {
      const place = functionGraph?.places.get(binder.placeId);
      return place?.root.kind === "receiver" || place?.root.kind === "parameter";
    }
    case "subject":
    case "synthetic":
      return false;
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

function parameterResourceKind(
  functionGraph: ProofMirFunction | undefined,
  index: number,
): string | undefined {
  return functionGraph?.signature.parameters[index]?.resourceKind;
}

function filterExportablePlaceEffects(
  functionGraph: ProofMirFunction | undefined,
  effects: ProofCheckSummaryPlaceEffectAccumulator,
): ProofCheckSummaryPlaceEffectAccumulator {
  return {
    observed: effects.observed.filter((effect) => isExportablePlaceEffect(functionGraph, effect)),
    consumed: effects.consumed.filter((effect) => isExportablePlaceEffect(functionGraph, effect)),
    mutated: effects.mutated.filter((effect) => isExportablePlaceEffect(functionGraph, effect)),
    produced: effects.produced.filter((effect) => isExportablePlaceEffect(functionGraph, effect)),
  };
}

function internalReadRequirementTermKeys(input: {
  readonly mir: ProofMirProgram;
  readonly functionGraph: ProofMirFunction | undefined;
}): ReadonlySet<string> {
  if (input.functionGraph === undefined) {
    return new Set();
  }

  const termKeys = new Set<string>();
  for (const block of input.functionGraph.blocks.entries()) {
    for (const statement of block.statements) {
      if (statement.kind.kind !== "readValidatedBufferField") {
        continue;
      }
      for (const factId of statement.kind.read.readRequires) {
        const fact = input.mir.facts.get(factId);
        if (fact === undefined) {
          continue;
        }
        const term = requirementTermFromProofMirFact({
          mir: input.mir,
          functionGraph: input.functionGraph,
          fact,
        });
        if (term === undefined) {
          continue;
        }
        termKeys.add(normalizeProofCheckTerm(term, "sourceRequirement").key);
      }
    }
  }
  return termKeys;
}

function derivePlaceEffectsFromExitStates(input: {
  readonly entryState: ProofCheckState;
  readonly exitStates: readonly ProofCheckState[];
}): ProofCheckSummaryPlaceEffectAccumulator {
  const accumulator = emptySummaryPlaceEffectAccumulator();
  if (input.exitStates.length === 0) {
    return accumulator;
  }

  const referenceExit = input.exitStates[0] as ProofCheckState;
  for (const [placeKey, exitPlace] of referenceExit.places.entries()) {
    const entryPlace = input.entryState.places.get(placeKey);
    if (entryPlace === undefined) {
      if (exitPlace.lifecycle === "owned") {
        recordSummaryPlaceEffect(accumulator, {
          kind: "produces",
          placeKey,
          resourceKind: "Copy",
        });
      }
      continue;
    }
    if (entryPlace.lifecycle === exitPlace.lifecycle) {
      continue;
    }
    if (exitPlace.lifecycle === "consumed") {
      recordSummaryPlaceEffect(accumulator, { kind: "consumes", placeKey });
    } else if (exitPlace.lifecycle === "moved") {
      recordSummaryPlaceEffect(accumulator, { kind: "mutates", placeKey });
    }
  }

  return accumulator;
}

export function buildCheckedFunctionSummaryInputFromMir(input: {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly entryState: ProofCheckState;
  readonly exitStates: readonly ProofCheckState[];
  readonly registryAccumulator?: ProofCheckRegistryAccumulator;
  readonly registryArtifacts?: ProofCheckFunctionRegistryArtifacts;
}): BuildCheckedFunctionSummaryInput {
  const declaredRequirementsResult = declaredRequirementsForFunctionWithDiagnostics({
    mir: input.mir,
    functionInstanceId: input.functionInstanceId,
  });
  const normalReturnExitStates = input.exitStates;
  const functionGraph = input.mir.functions.get(input.functionInstanceId);
  const internalReadRequirementKeys = internalReadRequirementTermKeys({
    mir: input.mir,
    functionGraph,
  });
  const returnFactCandidates = returnFactCandidatesForFunction({
    mir: input.mir,
    functionInstanceId: input.functionInstanceId,
    exitStates: normalReturnExitStates,
  });

  const registryEffects = filterExportablePlaceEffects(
    functionGraph,
    input.registryArtifacts !== undefined || input.registryAccumulator !== undefined
      ? placeEffectsFromRegistry({
          registryAccumulator: input.registryAccumulator,
          registryArtifacts: input.registryArtifacts,
          functionInstanceId: input.functionInstanceId,
        })
      : emptySummaryPlaceEffectAccumulator(),
  );
  const derivedEffects = filterExportablePlaceEffects(
    functionGraph,
    derivePlaceEffectsFromExitStates({
      entryState: input.entryState,
      exitStates: normalReturnExitStates,
    }),
  );

  return {
    functionInstanceId: input.functionInstanceId,
    declaredRequirements: declaredRequirementsResult.requirements.filter(
      (requirement) =>
        !internalReadRequirementKeys.has(
          normalizeProofCheckTerm(requirement, "sourceRequirement").key,
        ),
    ),
    diagnostics: declaredRequirementsResult.diagnostics,
    normalReturnExitStates,
    returnFactCandidates,
    observedInputs:
      registryEffects.observed.length > 0 ? registryEffects.observed : derivedEffects.observed,
    consumedInputs:
      registryEffects.consumed.length > 0 ? registryEffects.consumed : derivedEffects.consumed,
    mutatedInputs:
      registryEffects.mutated.length > 0 ? registryEffects.mutated : derivedEffects.mutated,
    producedPlaces:
      registryEffects.produced.length > 0 ? registryEffects.produced : derivedEffects.produced,
  };
}

function terminalNodeKey(functionInstanceId: MonoInstanceId): string {
  return `terminal:${String(functionInstanceId)}`;
}

function platformBaseNodeKey(primitiveId: string): string {
  return `platform:${primitiveId}`;
}

export function buildWholeImageTerminalGraphInputFromMir(input: {
  readonly mir: ProofMirProgram;
  readonly terminalGraphKey: string;
  readonly extraEdges?: readonly TerminalGraphEdge[];
}): BuildCoreTerminalGraphInput {
  const terminalFunctionIds = input.mir.functions
    .entries()
    .filter((functionGraph) => functionGraph.signature.modifiers.isTerminal)
    .map((functionGraph) => functionGraph.functionInstanceId);

  const nodes = new Set<string>();
  const edges: TerminalGraphEdge[] = [];
  const platformBaseNodes = new Set<string>();

  for (const functionInstanceId of terminalFunctionIds) {
    nodes.add(terminalNodeKey(functionInstanceId));
  }

  for (const platformEdge of input.mir.platformEdges.entries()) {
    platformBaseNodes.add(platformBaseNodeKey(String(platformEdge.primitiveId)));
    nodes.add(platformBaseNodeKey(String(platformEdge.primitiveId)));
  }

  for (const callEdge of input.mir.callGraph.entries()) {
    const callerFunctionInstanceId = callEdge.callId.functionInstanceId;
    const callerGraph = input.mir.functions.get(callerFunctionInstanceId);
    if (callerGraph === undefined || !callerGraph.signature.modifiers.isTerminal) {
      continue;
    }
    switch (callEdge.target.kind) {
      case "certifiedPlatform": {
        const platformEdge = input.mir.platformEdges.get(callEdge.target.edgeId);
        if (platformEdge === undefined) {
          break;
        }
        const platformNode = platformBaseNodeKey(String(platformEdge.primitiveId));
        nodes.add(platformNode);
        platformBaseNodes.add(platformNode);
        edges.push({
          from: terminalNodeKey(callerFunctionInstanceId),
          targetNode: platformNode,
        });
        break;
      }
      case "sourceFunction": {
        const targetGraph = input.mir.functions.get(callEdge.target.functionInstanceId);
        if (targetGraph?.signature.modifiers.isTerminal === true) {
          nodes.add(terminalNodeKey(callEdge.target.functionInstanceId));
          edges.push({
            from: terminalNodeKey(callerFunctionInstanceId),
            targetNode: terminalNodeKey(callEdge.target.functionInstanceId),
          });
        }
        break;
      }
      default:
        break;
    }
  }

  for (const edge of input.extraEdges ?? []) {
    nodes.add(edge.from);
    nodes.add(edge.targetNode);
    edges.push(edge);
  }

  const entryFunctionInstanceId = input.mir.image.entryFunctionInstanceId;
  const entryNodes = terminalFunctionIds.some(
    (functionInstanceId) => String(functionInstanceId) === String(entryFunctionInstanceId),
  )
    ? [terminalNodeKey(entryFunctionInstanceId)]
    : terminalFunctionIds.map(terminalNodeKey);

  return {
    terminalGraphKey: input.terminalGraphKey,
    nodes: [...nodes],
    edges,
    platformBaseNodes: [...platformBaseNodes],
    entryNodes,
  };
}

export function buildWholeImageTerminalGraphFromMir(input: {
  readonly mir: ProofMirProgram;
  readonly terminalGraphKey: string;
  readonly extraEdges?: readonly TerminalGraphEdge[];
}) {
  return buildCoreTerminalGraph(buildWholeImageTerminalGraphInputFromMir(input));
}
