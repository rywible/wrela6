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

export function runSccp(input: SccpInput): SccpResult {
  const constants = new Map<OptIrValueId, OptIrConstant>();
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
        const beforeSize = constants.size + reachableBlocks.size + reachableEdges.size;
        processBlock(
          functionInput,
          block,
          input.operations,
          constants,
          reachableEdges,
          reachableBlocks,
          worklistOrder,
          logged,
          facts,
          factEdgeIds,
        );
        if (constants.size + reachableBlocks.size + reachableEdges.size !== beforeSize) {
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
  constants: Map<OptIrValueId, OptIrConstant>,
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
  }
  for (const operationId of [...block.operations].sort((left, right) => left - right)) {
    const operation = operations.get(operationId);
    if (operation === undefined) {
      continue;
    }
    pushWorkItem(worklistOrder, logged, `operation:${operation.operationId}`);
    propagateOperation(operation, constants);
    for (const valueId of [...operation.resultIds].sort((left, right) => left - right)) {
      pushWorkItem(worklistOrder, logged, `value:${valueId}`);
    }
  }
  propagateTerminator(
    functionInput,
    block.terminator,
    constants,
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
  constants: Map<OptIrValueId, OptIrConstant>,
): void {
  if (operation.kind === "constant") {
    setConstant(constants, operation.resultIds[0], operation.constant);
    return;
  }
  if (operation.kind !== "integerBinary" || operation.operator !== "add") {
    return;
  }
  const left = constants.get(operation.left);
  const right = constants.get(operation.right);
  const resultId = operation.resultIds[0];
  if (left === undefined || right === undefined || resultId === undefined) {
    return;
  }
  setConstant(constants, resultId, {
    ...left,
    normalizedValue: left.normalizedValue + right.normalizedValue,
    type: operation.resultTypes[0] ?? left.type,
  });
}

function propagateTerminator(
  functionInput: OptIrFunction,
  terminator: OptIrTerminator | undefined,
  constants: Map<OptIrValueId, OptIrConstant>,
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
  const selected = selectedSuccessorEdges(terminator, constants);
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
    propagateEdgeArguments(functionInput, edge, constants);
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
  constants: ReadonlyMap<OptIrValueId, OptIrConstant>,
): readonly OptIrEdgeId[] {
  switch (terminator.kind) {
    case "branch": {
      const condition = constants.get(terminator.condition)?.normalizedValue;
      if (condition === undefined) {
        return [terminator.trueEdge, terminator.falseEdge];
      }
      return [condition === 0n ? terminator.falseEdge : terminator.trueEdge];
    }
    case "switch": {
      const scrutinee = constants.get(terminator.scrutinee)?.normalizedValue;
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
  constants: Map<OptIrValueId, OptIrConstant>,
): void {
  const target = functionInput.blocks.find((block) => block.blockId === edge.toBlock);
  if (target === undefined) {
    return;
  }
  target.parameters.forEach((parameter, index) => {
    const argument = edge.arguments[index];
    const constant = argument === undefined ? undefined : constants.get(argument);
    if (constant !== undefined) {
      setConstant(constants, parameter.valueId, constant);
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
    return {
      kind: "jump",
      operationId: terminator.operationId,
      edge: selected[0] ?? (0 as never),
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
      const constant = constants.get(operation.resultIds[0] ?? (0 as never));
      if (constant !== undefined) {
        rewritten.set(
          operationId,
          optIrIntegerBinaryOperation({
            operationId: operation.operationId,
            resultId: operation.resultIds[0] ?? (0 as never),
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
  constants: Map<OptIrValueId, OptIrConstant>,
  valueId: OptIrValueId | undefined,
  constant: OptIrConstant,
): void {
  if (valueId === undefined) {
    return;
  }
  const existing = constants.get(valueId);
  if (
    existing === undefined ||
    optIrConstantStableKey(existing) === optIrConstantStableKey(constant)
  ) {
    constants.set(valueId, constant);
  }
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
