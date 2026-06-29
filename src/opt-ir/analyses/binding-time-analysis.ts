import type { OptIrConstant } from "../constants";
import type { OptIrEdgeId, OptIrFactId, OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import { optIrTerminatorSuccessorEdges } from "../terminators";

export type BindingTimeStaticSource =
  | "internedConstant"
  | "constantBlockArgument"
  | "layoutFact"
  | "abiFact"
  | "calleeIdentity"
  | "pureFoldedResult"
  | "privateStateFact"
  | "capabilityFact"
  | "impossibilityFact";

export type BindingTimeDynamicReason =
  | "dynamicOperand"
  | "unknownCallResult"
  | "outOfScopeFact"
  | "effectfulResult";

export interface BindingTimeFactSource {
  readonly valueId: OptIrValueId;
  readonly source: Exclude<
    BindingTimeStaticSource,
    "internedConstant" | "constantBlockArgument" | "pureFoldedResult"
  >;
  readonly factsUsed: readonly OptIrFactId[];
  readonly invalidationTriggers: readonly string[];
  readonly inScope?: boolean;
}

export interface StaticBindingTimeClassification {
  readonly kind: "static";
  readonly source: BindingTimeStaticSource;
  readonly factsUsed: readonly OptIrFactId[];
  readonly invalidationTriggers: readonly string[];
}

export interface DynamicBindingTimeClassification {
  readonly kind: "dynamic";
  readonly reason: BindingTimeDynamicReason;
}

export type BindingTimeClassification =
  | StaticBindingTimeClassification
  | DynamicBindingTimeClassification;

export interface BindingTimeAnalysisInput {
  readonly program: OptIrProgram;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly constantValues?: ReadonlyMap<OptIrValueId, OptIrConstant>;
  readonly factSources?: readonly BindingTimeFactSource[];
}

export interface BindingTimeAnalysisResult {
  readonly fixpointOrder: readonly string[];
  classificationOf(valueId: OptIrValueId): BindingTimeClassification;
  entries(): readonly (readonly [OptIrValueId, BindingTimeClassification])[];
}

type BindingTimeState =
  | StaticBindingTimeClassification
  | DynamicBindingTimeClassification
  | { readonly kind: "unknown" };

export function analyzeBindingTime(input: BindingTimeAnalysisInput): BindingTimeAnalysisResult {
  const states = new Map<OptIrValueId, BindingTimeState>();
  const fixpointOrder: string[] = [];
  const constants = input.constantValues ?? new Map<OptIrValueId, OptIrConstant>();

  seedFactSources(input.factSources ?? [], states);

  let changed = true;
  while (changed) {
    changed = false;
    for (const functionInput of input.program.functions.entries()) {
      pushOnce(fixpointOrder, `function:${functionInput.functionId}`);
      for (const block of [...functionInput.blocks].sort(
        (left, right) => left.blockId - right.blockId,
      )) {
        pushOnce(fixpointOrder, `block:${block.blockId}`);
        for (const parameter of [...block.parameters].sort(
          (left, right) => left.valueId - right.valueId,
        )) {
          pushOnce(fixpointOrder, `value:${parameter.valueId}`);
          const constant = constants.get(parameter.valueId);
          if (constant !== undefined) {
            changed =
              setState(states, parameter.valueId, {
                kind: "static",
                source: "constantBlockArgument",
                factsUsed: [],
                invalidationTriggers: [],
              }) || changed;
            continue;
          }
          if (states.get(parameter.valueId)?.kind === "static") {
            continue;
          }
          changed =
            setState(states, parameter.valueId, {
              kind: "dynamic",
              reason: "dynamicOperand",
            }) || changed;
        }

        for (const operationId of [...block.operations].sort((left, right) => left - right)) {
          const operation = input.operations.get(operationId);
          if (operation === undefined) {
            continue;
          }
          pushOnce(fixpointOrder, `operation:${operation.operationId}`);
          changed = classifyOperation(operation, states) || changed;
          for (const valueId of [...operation.resultIds].sort((left, right) => left - right)) {
            pushOnce(fixpointOrder, `value:${valueId}`);
          }
        }

        for (const edgeId of [...terminatorSuccessorEdges(block.terminator)].sort(
          (left, right) => left - right,
        )) {
          pushOnce(fixpointOrder, `edge:${edgeId}`);
        }
      }
    }
  }

  return Object.freeze({
    fixpointOrder: Object.freeze([...fixpointOrder]),
    classificationOf(valueId: OptIrValueId): BindingTimeClassification {
      return publicClassification(states.get(valueId));
    },
    entries(): readonly (readonly [OptIrValueId, BindingTimeClassification])[] {
      return Object.freeze(
        [...states.entries()]
          .filter((entry): entry is [OptIrValueId, BindingTimeClassification] => {
            return entry[1].kind !== "unknown";
          })
          .sort((left, right) => left[0] - right[0])
          .map(([valueId, classification]) => Object.freeze([valueId, classification] as const)),
      );
    },
  });
}

function seedFactSources(
  factSources: readonly BindingTimeFactSource[],
  states: Map<OptIrValueId, BindingTimeState>,
): void {
  for (const factSource of [...factSources].sort((left, right) => left.valueId - right.valueId)) {
    if (factSource.inScope === false) {
      setState(states, factSource.valueId, { kind: "dynamic", reason: "outOfScopeFact" });
      continue;
    }
    setState(states, factSource.valueId, {
      kind: "static",
      source: factSource.source,
      factsUsed: Object.freeze([...factSource.factsUsed].sort((left, right) => left - right)),
      invalidationTriggers: Object.freeze([...factSource.invalidationTriggers].sort()),
    });
  }
}

function classifyOperation(
  operation: OptIrOperation,
  states: Map<OptIrValueId, BindingTimeState>,
): boolean {
  if (operation.kind === "constant") {
    return setResults(operation, states, {
      kind: "static",
      source: "internedConstant",
      factsUsed: [],
      invalidationTriggers: [],
    });
  }

  if (isCallOperation(operation)) {
    return setResults(operation, states, { kind: "dynamic", reason: "unknownCallResult" });
  }

  if (!operation.effects.isRuntimePure) {
    return setResults(operation, states, { kind: "dynamic", reason: "effectfulResult" });
  }

  if (operation.resultIds.length === 0) {
    return false;
  }

  const operandStates = operation.operandIds.map((valueId) => states.get(valueId));
  if (operandStates.some((state) => state?.kind === "dynamic")) {
    return setResults(operation, states, { kind: "dynamic", reason: "dynamicOperand" });
  }

  if (requiresFactCitation(operation) && !allResultsAlreadyStatic(states, operation)) {
    return setResults(operation, states, { kind: "dynamic", reason: "outOfScopeFact" });
  }

  if (operation.operandIds.length === 0) {
    return setResults(operation, states, {
      kind: "static",
      source: "pureFoldedResult",
      factsUsed: [],
      invalidationTriggers: [],
    });
  }

  if (operandStates.every((state) => state?.kind === "static")) {
    return setResults(operation, states, {
      kind: "static",
      source: "pureFoldedResult",
      factsUsed: mergeFacts(operandStates),
      invalidationTriggers: mergeInvalidations(operandStates),
    });
  }
  return false;
}

function setResults(
  operation: OptIrOperation,
  states: Map<OptIrValueId, BindingTimeState>,
  classification: BindingTimeClassification,
): boolean {
  let changed = false;
  for (const valueId of operation.resultIds) {
    changed = setState(states, valueId, classification) || changed;
  }
  return changed;
}

function setState(
  states: Map<OptIrValueId, BindingTimeState>,
  valueId: OptIrValueId,
  next: BindingTimeState,
): boolean {
  const current = states.get(valueId);
  if (current !== undefined && stateRank(current) >= stateRank(next)) {
    return false;
  }
  states.set(valueId, freezeState(next));
  return true;
}

function stateRank(state: BindingTimeState): number {
  switch (state.kind) {
    case "unknown":
      return 0;
    case "static":
      return 1;
    case "dynamic":
      return 2;
  }
}

function freezeState(state: BindingTimeState): BindingTimeState {
  if (state.kind !== "static") {
    return Object.freeze(state);
  }
  return Object.freeze({
    ...state,
    factsUsed: Object.freeze([...state.factsUsed]),
    invalidationTriggers: Object.freeze([...state.invalidationTriggers]),
  });
}

function publicClassification(state: BindingTimeState | undefined): BindingTimeClassification {
  if (state === undefined || state.kind === "unknown") {
    return { kind: "dynamic", reason: "dynamicOperand" };
  }
  return state;
}

function isCallOperation(operation: OptIrOperation): boolean {
  return (
    operation.kind === "sourceCall" ||
    operation.kind === "runtimeCall" ||
    operation.kind === "platformCall" ||
    operation.kind === "intrinsicCall"
  );
}

function requiresFactCitation(operation: OptIrOperation): boolean {
  return operation.kind === "layoutOffset" || operation.kind === "layoutByteRange";
}

function allResultsAlreadyStatic(
  states: ReadonlyMap<OptIrValueId, BindingTimeState>,
  operation: OptIrOperation,
): boolean {
  return operation.resultIds.every((valueId) => states.get(valueId)?.kind === "static");
}

function mergeFacts(states: readonly (BindingTimeState | undefined)[]): readonly OptIrFactId[] {
  return Object.freeze(
    [
      ...new Set(states.flatMap((state) => (state?.kind === "static" ? [...state.factsUsed] : []))),
    ].sort((left, right) => left - right),
  );
}

function mergeInvalidations(states: readonly (BindingTimeState | undefined)[]): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        states.flatMap((state) =>
          state?.kind === "static" ? [...state.invalidationTriggers] : [],
        ),
      ),
    ].sort(),
  );
}

function pushOnce(target: string[], item: string): void {
  if (!target.includes(item)) {
    target.push(item);
  }
}

function terminatorSuccessorEdges(
  terminator: Parameters<typeof optIrTerminatorSuccessorEdges>[0] | undefined,
): readonly OptIrEdgeId[] {
  return terminator === undefined ? [] : optIrTerminatorSuccessorEdges(terminator);
}
