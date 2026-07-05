import { optIrCfgEdgeTable, type OptIrEdge } from "../cfg";
import { optIrConstantStableKey, type OptIrConstant } from "../constants";
import type { OptIrBlockId, OptIrEdgeId, OptIrOperationId, OptIrValueId } from "../ids";
import { optIrIntegerBinaryOperation, type OptIrOperation } from "../operations";
import {
  optIrFunctionTable,
  optIrProgram,
  type OptIrFunction,
  type OptIrProgram,
} from "../program";
import type { OptIrTerminator } from "../terminators";
import { optIrTerminatorSuccessorEdges } from "../terminators";
import type { OptIrCheckedDependency, OptIrFactLineage } from "../analyses/range-analysis";

export interface SccpImpossibilityFact {
  readonly kind: "impossibility";
  readonly edgeId: OptIrEdgeId;
  readonly lineage: OptIrFactLineage;
}

export interface SccpInput {
  readonly program: OptIrProgram;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
}

export interface SccpResult {
  readonly program: OptIrProgram;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly constantValues: ReadonlyMap<OptIrValueId, OptIrConstant>;
  readonly removedEdgeIds: readonly OptIrEdgeId[];
  readonly derivedFacts: readonly SccpImpossibilityFact[];
  readonly worklistOrder: readonly string[];
}

type SccpValueState =
  | { readonly kind: "unknown" }
  | { readonly kind: "constant"; readonly constant: OptIrConstant }
  | { readonly kind: "overdefined" };

export function runSccp(input: SccpInput): SccpResult {
  const states = new Map<OptIrValueId, SccpValueState>();
  const worklistOrder: string[] = [];
  const removedEdgeIds: OptIrEdgeId[] = [];
  const facts: SccpImpossibilityFact[] = [];
  const factEdgeIds = new Set<OptIrEdgeId>();
  const rewrittenFunctions: OptIrFunction[] = [];
  const logged = new Set<string>();

  for (const functionInput of input.program.functions.entries()) {
    pushWorkItem(worklistOrder, logged, `function:${functionInput.functionId}`);
    const reachableBlocks = new Set([functionInput.entryBlock]);
    const reachableEdges = new Set<OptIrEdgeId>();
    let changed = true;

    while (changed) {
      changed = false;
      for (const block of [...functionInput.blocks].sort(
        (left, right) => left.blockId - right.blockId,
      )) {
        if (!reachableBlocks.has(block.blockId)) {
          continue;
        }
        const beforeState = stateFingerprint(states, reachableBlocks, reachableEdges);
        processBlock(
          functionInput,
          block,
          input.operations,
          states,
          reachableEdges,
          reachableBlocks,
          worklistOrder,
          logged,
          facts,
          factEdgeIds,
        );
        if (stateFingerprint(states, reachableBlocks, reachableEdges) !== beforeState) {
          changed = true;
        }
      }
    }

    for (const edge of functionInput.edges.entries()) {
      if (!reachableEdges.has(edge.edgeId)) {
        removedEdgeIds.push(edge.edgeId);
      }
    }
    rewrittenFunctions.push(rewriteFunction(functionInput, reachableBlocks, reachableEdges));
  }

  const constants = constantsFromStates(states);
  const operations = rewriteOperations(input.operations, constants);
  return Object.freeze({
    program: optIrProgram({
      ...input.program,
      functions: optIrFunctionTable(rewrittenFunctions),
    }),
    operations,
    constantValues: constants,
    removedEdgeIds: Object.freeze([...new Set(removedEdgeIds)].sort((left, right) => left - right)),
    derivedFacts: Object.freeze(facts),
    worklistOrder: Object.freeze(worklistOrder),
  });
}

function processBlock(
  functionInput: OptIrFunction,
  block: OptIrFunction["blocks"][number],
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
  states: Map<OptIrValueId, SccpValueState>,
  reachableEdges: Set<OptIrEdgeId>,
  reachableBlocks: Set<OptIrBlockId>,
  worklistOrder: string[],
  logged: Set<string>,
  facts: SccpImpossibilityFact[],
  factEdgeIds: Set<OptIrEdgeId>,
): void {
  pushWorkItem(worklistOrder, logged, `block:${block.blockId}`);
  for (const parameter of [...block.parameters].sort(
    (left, right) => left.valueId - right.valueId,
  )) {
    pushWorkItem(worklistOrder, logged, `value:${parameter.valueId}`);
    if (block.blockId === functionInput.entryBlock) {
      setOverdefined(states, parameter.valueId);
    }
  }
  for (const operationId of [...block.operations].sort((left, right) => left - right)) {
    const operation = operations.get(operationId);
    if (operation === undefined) {
      continue;
    }
    pushWorkItem(worklistOrder, logged, `operation:${operation.operationId}`);
    propagateOperation(operation, states);
    for (const valueId of [...operation.resultIds].sort((left, right) => left - right)) {
      pushWorkItem(worklistOrder, logged, `value:${valueId}`);
    }
  }
  propagateTerminator(
    functionInput,
    block.terminator,
    states,
    reachableEdges,
    reachableBlocks,
    worklistOrder,
    logged,
    facts,
    factEdgeIds,
  );
}

function propagateOperation(
  operation: OptIrOperation,
  states: Map<OptIrValueId, SccpValueState>,
): void {
  if (operation.kind === "constant") {
    setConstant(states, operation.resultIds[0], operation.constant);
    return;
  }
  if (operation.kind !== "integerBinary" || operation.operator !== "add") {
    markResultsOverdefined(operation, states);
    return;
  }
  const resultId = operation.resultIds[0];
  if (resultId === undefined) {
    return;
  }
  const leftState = states.get(operation.left);
  const rightState = states.get(operation.right);
  if (leftState?.kind === "overdefined" || rightState?.kind === "overdefined") {
    setOverdefined(states, resultId);
    return;
  }
  if (leftState?.kind !== "constant" || rightState?.kind !== "constant") {
    return;
  }
  setConstant(states, resultId, {
    ...leftState.constant,
    normalizedValue: leftState.constant.normalizedValue + rightState.constant.normalizedValue,
    type: operation.resultTypes[0] ?? leftState.constant.type,
  });
}

function propagateTerminator(
  functionInput: OptIrFunction,
  terminator: OptIrTerminator | undefined,
  states: Map<OptIrValueId, SccpValueState>,
  reachableEdges: Set<OptIrEdgeId>,
  reachableBlocks: Set<OptIrBlockId>,
  worklistOrder: string[],
  logged: Set<string>,
  facts: SccpImpossibilityFact[],
  factEdgeIds: Set<OptIrEdgeId>,
): void {
  if (terminator === undefined) {
    return;
  }
  const allEdges = optIrTerminatorSuccessorEdges(terminator);
  const selected = selectedSuccessorEdges(terminator, states);
  const selectedSet = new Set(selected);
  for (const edgeId of selected) {
    const edge = functionInput.edges.get(edgeId);
    if (edge === undefined) {
      continue;
    }
    pushWorkItem(worklistOrder, logged, `edge:${edgeId}`);
    reachableEdges.add(edgeId);
    if (edge.toBlock !== undefined) {
      reachableBlocks.add(edge.toBlock);
    }
    propagateEdgeArguments(functionInput, edge, states);
  }
  for (const edgeId of allEdges) {
    if (!selectedSet.has(edgeId) && !factEdgeIds.has(edgeId)) {
      factEdgeIds.add(edgeId);
      facts.push({
        kind: "impossibility",
        edgeId,
        lineage: { checkedDependencies: lineageForTerminator(terminator) },
      });
    }
  }
}

function pushWorkItem(worklistOrder: string[], logged: Set<string>, item: string): void {
  if (!logged.has(item)) {
    logged.add(item);
    worklistOrder.push(item);
  }
}

function selectedSuccessorEdges(
  terminator: OptIrTerminator,
  states: ReadonlyMap<OptIrValueId, SccpValueState>,
): readonly OptIrEdgeId[] {
  switch (terminator.kind) {
    case "branch": {
      const condition = constantFromState(states.get(terminator.condition))?.normalizedValue;
      if (condition === undefined) {
        return [terminator.trueEdge, terminator.falseEdge];
      }
      return [condition === 0n ? terminator.falseEdge : terminator.trueEdge];
    }
    case "switch": {
      const scrutinee = constantFromState(states.get(terminator.scrutinee))?.normalizedValue;
      if (scrutinee === undefined) {
        return optIrTerminatorSuccessorEdges(terminator);
      }
      const selected = terminator.cases.find(
        (switchCase) => switchCase.label === String(scrutinee),
      );
      return [selected?.edge ?? terminator.defaultEdge];
    }
    case "jump":
      return [terminator.edge];
    case "return":
    case "unreachable":
      return [];
  }
}

function propagateEdgeArguments(
  functionInput: OptIrFunction,
  edge: OptIrEdge,
  states: Map<OptIrValueId, SccpValueState>,
): void {
  const target = functionInput.blocks.find((block) => block.blockId === edge.toBlock);
  if (target === undefined) {
    return;
  }
  target.parameters.forEach((parameter, index) => {
    const argument = edge.arguments[index];
    if (argument === undefined) {
      setOverdefined(states, parameter.valueId);
      return;
    }
    const state = states.get(argument);
    if (state?.kind === "constant") {
      setConstant(states, parameter.valueId, state.constant);
      return;
    }
    if (state?.kind === "overdefined") {
      setOverdefined(states, parameter.valueId);
    }
  });
}

function rewriteFunction(
  functionInput: OptIrFunction,
  reachableBlocks: ReadonlySet<OptIrBlockId>,
  reachableEdges: ReadonlySet<OptIrEdgeId>,
): OptIrFunction {
  return {
    ...functionInput,
    blocks: functionInput.blocks
      .filter((block) => reachableBlocks.has(block.blockId))
      .map((block) => ({
        ...block,
        terminator: rewriteTerminator(block.terminator, reachableEdges),
      })),
    edges: optIrCfgEdgeTable(
      functionInput.edges.entries().filter((edge) => reachableEdges.has(edge.edgeId)),
    ),
  };
}

function rewriteTerminator(
  terminator: OptIrTerminator | undefined,
  reachableEdges: ReadonlySet<OptIrEdgeId>,
): OptIrTerminator | undefined {
  if (terminator === undefined) {
    return undefined;
  }
  const selected = optIrTerminatorSuccessorEdges(terminator).filter((edgeId) =>
    reachableEdges.has(edgeId),
  );
  if (selected.length === 1 && (terminator.kind === "branch" || terminator.kind === "switch")) {
    const edge = selected[0];
    if (edge === undefined) {
      return terminator;
    }
    return {
      kind: "jump",
      operationId: terminator.operationId,
      edge,
      originId: terminator.originId,
    };
  }
  return terminator;
}

function rewriteOperations(
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
  constants: ReadonlyMap<OptIrValueId, OptIrConstant>,
): ReadonlyMap<OptIrOperationId, OptIrOperation> {
  const rewritten = new Map<OptIrOperationId, OptIrOperation>();
  for (const [operationId, operation] of [...operations.entries()].sort(
    (left, right) => left[0] - right[0],
  )) {
    if (operation.kind === "integerBinary" && operation.operator === "add") {
      const resultId = operation.resultIds[0];
      if (resultId === undefined) {
        rewritten.set(operationId, operation);
        continue;
      }
      const constant = constants.get(resultId);
      if (constant !== undefined) {
        rewritten.set(
          operationId,
          optIrIntegerBinaryOperation({
            operationId: operation.operationId,
            resultId,
            left: operation.left,
            right: operation.right,
            operator: operation.operator,
            resultType: operation.resultTypes[0] ?? constant.type,
            originId: operation.originId,
          }),
        );
        continue;
      }
    }
    rewritten.set(operationId, operation);
  }
  return rewritten;
}

function setConstant(
  states: Map<OptIrValueId, SccpValueState>,
  valueId: OptIrValueId | undefined,
  constant: OptIrConstant,
): void {
  if (valueId === undefined) {
    return;
  }
  const existing = states.get(valueId);
  if (existing?.kind === "overdefined") {
    return;
  }
  if (existing?.kind === "constant") {
    if (optIrConstantStableKey(existing.constant) !== optIrConstantStableKey(constant)) {
      states.set(valueId, { kind: "overdefined" });
    }
    return;
  }
  states.set(valueId, { kind: "constant", constant });
}

function setOverdefined(states: Map<OptIrValueId, SccpValueState>, valueId: OptIrValueId): void {
  states.set(valueId, { kind: "overdefined" });
}

function markResultsOverdefined(
  operation: OptIrOperation,
  states: Map<OptIrValueId, SccpValueState>,
): void {
  for (const resultId of operation.resultIds) {
    setOverdefined(states, resultId);
  }
}

function constantFromState(state: SccpValueState | undefined): OptIrConstant | undefined {
  return state?.kind === "constant" ? state.constant : undefined;
}

function constantsFromStates(
  states: ReadonlyMap<OptIrValueId, SccpValueState>,
): ReadonlyMap<OptIrValueId, OptIrConstant> {
  const constants = new Map<OptIrValueId, OptIrConstant>();
  for (const [valueId, state] of states) {
    if (state.kind === "constant") {
      constants.set(valueId, state.constant);
    }
  }
  return constants;
}

function stateFingerprint(
  states: ReadonlyMap<OptIrValueId, SccpValueState>,
  reachableBlocks: ReadonlySet<OptIrBlockId>,
  reachableEdges: ReadonlySet<OptIrEdgeId>,
): string {
  const values = [...states.entries()]
    .sort((left, right) => left[0] - right[0])
    .map(([valueId, state]) =>
      state.kind === "constant"
        ? `${valueId}:constant:${optIrConstantStableKey(state.constant)}`
        : `${valueId}:${state.kind}`,
    );
  return [
    values.join(","),
    [...reachableBlocks].sort((left, right) => left - right).join(","),
    [...reachableEdges].sort((left, right) => left - right).join(","),
  ].join("|");
}

function lineageForTerminator(terminator: OptIrTerminator): readonly OptIrCheckedDependency[] {
  switch (terminator.kind) {
    case "branch":
      return [{ kind: "value", valueId: terminator.condition }];
    case "switch":
      return [{ kind: "value", valueId: terminator.scrutinee }];
    case "jump":
    case "return":
    case "unreachable":
      return [];
  }
}
