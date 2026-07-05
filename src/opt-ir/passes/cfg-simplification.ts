import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../cfg";
import {
  createOptIrSubjectRemapTable,
  type OptIrFactSubject,
  type OptIrSubjectRemapTable,
} from "../facts/subject-remapping";
import type { OptIrBlockId, OptIrEdgeId, OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrFunction } from "../program";
import { optIrTerminatorSuccessorEdges, type OptIrTerminator } from "../terminators";
import {
  rewriteEdgeValues,
  rewriteOperation,
  rewriteTerminatorValues,
} from "./cfg-simplification-rewrite";

export interface CfgSimplificationInput {
  readonly function: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly booleanFacts?: readonly (readonly [OptIrValueId, boolean])[];
  readonly switchFacts?: readonly (readonly [OptIrValueId, string])[];
  readonly fuel?: number;
}

export interface CfgSimplificationResult {
  readonly function: OptIrFunction;
  readonly operations: readonly OptIrOperation[];
  readonly removedBlockIds: readonly OptIrBlockId[];
  readonly removedEdgeIds: readonly OptIrEdgeId[];
  readonly subjectRemap: OptIrSubjectRemapTable;
}
interface SimplificationState {
  readonly function: OptIrFunction;
  readonly valueRemaps: readonly (readonly [OptIrValueId, OptIrValueId])[];
  readonly edgeRemaps: readonly (readonly [OptIrEdgeId, OptIrEdgeId])[];
  readonly droppedSubjects: readonly OptIrFactSubject[];
}

export function runCfgSimplification(input: CfgSimplificationInput): CfgSimplificationResult {
  const fuel = Math.max(0, Math.floor(input.fuel ?? 8));
  let state: SimplificationState = {
    function: input.function,
    valueRemaps: [],
    edgeRemaps: [],
    droppedSubjects: [],
  };

  for (let round = 0; round < fuel; round += 1) {
    const next = simplifyOnce(state, input);
    if (sameFunctionShape(next.function, state.function)) {
      state = next;
      break;
    }
    state = next;
  }

  const valueSubstitutions = canonicalValueMap(state.valueRemaps);
  const rewrittenBlocks = state.function.blocks.map((block) => ({
    ...block,
    operations: block.operations,
    terminator:
      block.terminator === undefined
        ? undefined
        : rewriteTerminatorValues(block.terminator, valueSubstitutions),
  }));
  const rewrittenEdges = state.function.edges
    .entries()
    .map((edge) => rewriteEdgeValues(edge, valueSubstitutions));
  const operationIds = rewrittenBlocks.flatMap((block) => block.operations);
  const operations = operationIds.map((operationId) =>
    rewriteOperation(requireOperation(input.operations, operationId), valueSubstitutions),
  );
  const removedBlockIds = droppedIds(state.droppedSubjects, "block");
  const removedEdgeIds = sortedUnique([
    ...droppedEdgeIds(state.droppedSubjects),
    ...state.edgeRemaps.map(([removedEdgeId]) => removedEdgeId),
  ]);

  return {
    function: {
      ...state.function,
      blocks: rewrittenBlocks,
      edges: optIrCfgEdgeTable(rewrittenEdges),
    },
    operations,
    removedBlockIds,
    removedEdgeIds,
    subjectRemap: createOptIrSubjectRemapTable({
      values: state.valueRemaps,
      edges: state.edgeRemaps,
      droppedSubjects: state.droppedSubjects,
    }),
  };
}

function simplifyOnce(
  state: SimplificationState,
  input: CfgSimplificationInput,
): SimplificationState {
  const withSimplifiedTerminals = simplifyTerminals(state.function, input);
  const reachable = reachableBlocks(withSimplifiedTerminals);
  const withoutUnreachable = removeUnreachable(
    withSimplifiedTerminals,
    reachable,
    input.operations,
  );
  const afterCoalesce = coalesceOneLinearJumpBlock(withoutUnreachable.function);
  const afterMerge = mergeOneTrivialBlock(afterCoalesce.function);

  return {
    function: afterMerge.function,
    valueRemaps: [...state.valueRemaps, ...afterCoalesce.valueRemaps, ...afterMerge.valueRemaps],
    edgeRemaps: [...state.edgeRemaps, ...afterCoalesce.edgeRemaps, ...afterMerge.edgeRemaps],
    droppedSubjects: [
      ...state.droppedSubjects,
      ...withoutUnreachable.droppedSubjects,
      ...afterCoalesce.droppedSubjects,
      ...afterMerge.droppedSubjects,
    ],
  };
}

function simplifyTerminals(
  functionInput: OptIrFunction,
  input: CfgSimplificationInput,
): OptIrFunction {
  const booleanFacts = new Map(input.booleanFacts ?? []);
  const switchFacts = new Map(input.switchFacts ?? []);
  const operationConstants = constantValues(input.operations);
  const blocks = functionInput.blocks.map((block) => {
    if (block.terminator === undefined) {
      return block;
    }
    const inBlockConstants = new Map<OptIrValueId, string>();
    for (const operationId of block.operations) {
      const constantValue = operationConstants.get(operationId);
      const operation = input.operations.get(operationId);
      const resultId = operation?.resultIds[0];
      if (constantValue !== undefined && resultId !== undefined) {
        inBlockConstants.set(resultId, constantValue);
      }
    }

    const terminator = simplifyTerminator(
      block.terminator,
      booleanFacts,
      switchFacts,
      inBlockConstants,
    );
    return terminator === block.terminator ? block : { ...block, terminator };
  });

  return { ...functionInput, blocks };
}

function simplifyTerminator(
  terminator: OptIrTerminator,
  booleanFacts: ReadonlyMap<OptIrValueId, boolean>,
  switchFacts: ReadonlyMap<OptIrValueId, string>,
  constants: ReadonlyMap<OptIrValueId, string>,
): OptIrTerminator {
  switch (terminator.kind) {
    case "branch": {
      const known =
        booleanFacts.get(terminator.condition) ?? booleanConstant(constants, terminator.condition);
      if (known === undefined) {
        return terminator;
      }
      return {
        kind: "jump",
        operationId: terminator.operationId,
        edge: known ? terminator.trueEdge : terminator.falseEdge,
        originId: terminator.originId,
      };
    }
    case "switch": {
      const known = switchFacts.get(terminator.scrutinee) ?? constants.get(terminator.scrutinee);
      if (known === undefined) {
        return terminator;
      }
      const selected = terminator.cases.find((switchCase) => switchCase.label === known);
      return {
        kind: "jump",
        operationId: terminator.operationId,
        edge: selected?.edge ?? terminator.defaultEdge,
        originId: terminator.originId,
      };
    }
    case "jump":
    case "return":
    case "unreachable":
      return terminator;
  }
}

function removeUnreachable(
  functionInput: OptIrFunction,
  reachable: ReadonlySet<OptIrBlockId>,
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): {
  readonly function: OptIrFunction;
  readonly droppedSubjects: readonly OptIrFactSubject[];
} {
  const reachableEdges = new Set<OptIrEdgeId>();
  const reachableBlocksById = new Set(reachable);
  for (const block of functionInput.blocks) {
    if (!reachableBlocksById.has(block.blockId) || block.terminator === undefined) {
      continue;
    }
    for (const edgeId of optIrTerminatorSuccessorEdges(block.terminator)) {
      const edge = functionInput.edges.get(edgeId);
      if (edge?.toBlock !== undefined && reachableBlocksById.has(edge.toBlock)) {
        reachableEdges.add(edgeId);
      }
    }
  }

  const droppedSubjects: OptIrFactSubject[] = [];
  const blocks = functionInput.blocks.filter((block) => {
    if (reachableBlocksById.has(block.blockId)) {
      return true;
    }
    droppedSubjects.push({ kind: "block", blockId: block.blockId });
    for (const operationId of block.operations) {
      droppedSubjects.push({ kind: "operation", operationId });
      for (const valueId of operations.get(operationId)?.resultIds ?? []) {
        droppedSubjects.push({ kind: "value", valueId });
      }
    }
    return false;
  });
  const edges = functionInput.edges.entries().filter((edge) => {
    if (reachableEdges.has(edge.edgeId)) {
      return true;
    }
    droppedSubjects.push({ kind: "edge", edgeId: edge.edgeId });
    return false;
  });

  return {
    function: { ...functionInput, blocks, edges: optIrCfgEdgeTable(edges) },
    droppedSubjects,
  };
}

function mergeOneTrivialBlock(functionInput: OptIrFunction): {
  readonly function: OptIrFunction;
  readonly valueRemaps: readonly (readonly [OptIrValueId, OptIrValueId])[];
  readonly edgeRemaps: readonly (readonly [OptIrEdgeId, OptIrEdgeId])[];
  readonly droppedSubjects: readonly OptIrFactSubject[];
} {
  const edges = functionInput.edges.entries();
  const incomingByBlock = incomingEdgesByBlock(edges);
  const blocksById = new Map(functionInput.blocks.map((block) => [block.blockId, block]));

  for (const block of functionInput.blocks) {
    if (block.blockId === functionInput.entryBlock || block.operations.length > 0) {
      continue;
    }
    if (block.terminator?.kind !== "jump") {
      continue;
    }
    const incomingEdges = incomingByBlock.get(block.blockId) ?? [];
    if (incomingEdges.length !== 1) {
      continue;
    }
    const incomingEdge = incomingEdges[0];
    const outgoingEdge = functionInput.edges.get(block.terminator.edge);
    if (incomingEdge === undefined || outgoingEdge?.toBlock === undefined) {
      continue;
    }
    if (outgoingEdge.toBlock === block.blockId || outgoingEdge.toBlock === incomingEdge.from) {
      continue;
    }
    if (!blocksById.has(outgoingEdge.toBlock)) {
      continue;
    }

    const parameterValues = parameterReplacementValues(block.parameters, incomingEdge.arguments);
    if (parameterValues === undefined) {
      continue;
    }
    const mergedEdge: OptIrEdge = {
      ...incomingEdge,
      toBlock: outgoingEdge.toBlock,
      arguments: outgoingEdge.arguments.map(
        (argumentId) => parameterValues.get(argumentId) ?? argumentId,
      ),
    };
    const nextEdges = edges
      .filter((edge) => edge.edgeId !== outgoingEdge.edgeId)
      .map((edge) => (edge.edgeId === incomingEdge.edgeId ? mergedEdge : edge));
    const nextBlocks = functionInput.blocks.filter(
      (candidate) => candidate.blockId !== block.blockId,
    );

    return {
      function: {
        ...functionInput,
        blocks: nextBlocks,
        edges: optIrCfgEdgeTable(nextEdges),
      },
      valueRemaps: [...parameterValues.entries()].sort((left, right) => left[0] - right[0]),
      edgeRemaps: [[outgoingEdge.edgeId, incomingEdge.edgeId]],
      droppedSubjects: [{ kind: "block", blockId: block.blockId }],
    };
  }

  return {
    function: functionInput,
    valueRemaps: [],
    edgeRemaps: [],
    droppedSubjects: [],
  };
}

function coalesceOneLinearJumpBlock(functionInput: OptIrFunction): {
  readonly function: OptIrFunction;
  readonly valueRemaps: readonly (readonly [OptIrValueId, OptIrValueId])[];
  readonly edgeRemaps: readonly (readonly [OptIrEdgeId, OptIrEdgeId])[];
  readonly droppedSubjects: readonly OptIrFactSubject[];
} {
  const edges = functionInput.edges.entries();
  const incomingByBlock = incomingEdgesByBlock(edges);
  const blocksById = new Map(functionInput.blocks.map((block) => [block.blockId, block]));
  const blockIndexById = new Map(
    functionInput.blocks.map((block, index) => [block.blockId, index]),
  );

  for (const block of functionInput.blocks) {
    if (block.terminator?.kind !== "jump") {
      continue;
    }
    const outgoingEdge = functionInput.edges.get(block.terminator.edge);
    const successor =
      outgoingEdge?.toBlock === undefined ? undefined : blocksById.get(outgoingEdge.toBlock);
    if (outgoingEdge === undefined || successor === undefined) {
      continue;
    }
    const blockIndex = blockIndexById.get(block.blockId);
    const successorIndex = blockIndexById.get(successor.blockId);
    if (
      outgoingEdge.from !== block.blockId ||
      successor.blockId === functionInput.entryBlock ||
      successor.blockId === block.blockId ||
      blockIndex === undefined ||
      successorIndex === undefined ||
      successorIndex <= blockIndex ||
      !hasOnlyForwardIncomingEdges({
        block,
        entryBlock: functionInput.entryBlock,
        blockIndex,
        blockIndexById,
        incomingByBlock,
      })
    ) {
      continue;
    }
    const incomingEdges = incomingByBlock.get(successor.blockId) ?? [];
    if (incomingEdges.length !== 1 || incomingEdges[0]?.edgeId !== outgoingEdge.edgeId) {
      continue;
    }
    const parameterValues = parameterReplacementValues(
      successor.parameters,
      outgoingEdge.arguments,
    );
    if (parameterValues === undefined) {
      continue;
    }
    const coalescedBlock: OptIrBlock = {
      ...block,
      operations: [...block.operations, ...successor.operations],
      ...(successor.terminator === undefined ? {} : { terminator: successor.terminator }),
    };
    const nextBlocks = functionInput.blocks
      .filter((candidate) => candidate.blockId !== successor.blockId)
      .map((candidate) => (candidate.blockId === block.blockId ? coalescedBlock : candidate));
    const nextEdges = edges
      .filter((edge) => edge.edgeId !== outgoingEdge.edgeId)
      .map((edge) => (edge.from === successor.blockId ? { ...edge, from: block.blockId } : edge));

    return {
      function: {
        ...functionInput,
        blocks: nextBlocks,
        edges: optIrCfgEdgeTable(nextEdges),
      },
      valueRemaps: [...parameterValues.entries()].sort((left, right) => left[0] - right[0]),
      edgeRemaps: [],
      droppedSubjects: [
        { kind: "block", blockId: successor.blockId },
        { kind: "edge", edgeId: outgoingEdge.edgeId },
      ],
    };
  }

  return {
    function: functionInput,
    valueRemaps: [],
    edgeRemaps: [],
    droppedSubjects: [],
  };
}

function hasOnlyForwardIncomingEdges(input: {
  readonly block: OptIrBlock;
  readonly entryBlock: OptIrBlockId;
  readonly blockIndex: number;
  readonly blockIndexById: ReadonlyMap<OptIrBlockId, number>;
  readonly incomingByBlock: ReadonlyMap<OptIrBlockId, readonly OptIrEdge[]>;
}): boolean {
  if (input.block.blockId === input.entryBlock) {
    return true;
  }
  return (input.incomingByBlock.get(input.block.blockId) ?? []).every((edge) => {
    const predecessorIndex = input.blockIndexById.get(edge.from);
    return predecessorIndex !== undefined && predecessorIndex < input.blockIndex;
  });
}

function parameterReplacementValues(
  parameters: OptIrBlock["parameters"],
  arguments_: readonly OptIrValueId[],
): ReadonlyMap<OptIrValueId, OptIrValueId> | undefined {
  const parameterValues = new Map<OptIrValueId, OptIrValueId>();
  for (const [index, parameter] of parameters.entries()) {
    const incomingArgument = arguments_[index];
    if (incomingArgument === undefined || incomingArgument === parameter.valueId) {
      return undefined;
    }
    parameterValues.set(parameter.valueId, incomingArgument);
  }
  return parameterValues;
}

function reachableBlocks(functionInput: OptIrFunction): ReadonlySet<OptIrBlockId> {
  const reachable = new Set<OptIrBlockId>();
  const worklist: OptIrBlockId[] = [functionInput.entryBlock];
  const blocksById = new Map(functionInput.blocks.map((block) => [block.blockId, block]));
  while (worklist.length > 0) {
    const blockId = worklist.shift();
    if (blockId === undefined || reachable.has(blockId)) {
      continue;
    }
    const block = blocksById.get(blockId);
    if (block === undefined) {
      continue;
    }
    reachable.add(blockId);
    if (block.terminator === undefined) {
      continue;
    }
    for (const edgeId of optIrTerminatorSuccessorEdges(block.terminator)) {
      const edge = functionInput.edges.get(edgeId);
      if (edge?.toBlock !== undefined && !reachable.has(edge.toBlock)) {
        worklist.push(edge.toBlock);
      }
    }
  }
  return reachable;
}

function incomingEdgesByBlock(
  edges: readonly OptIrEdge[],
): ReadonlyMap<OptIrBlockId, readonly OptIrEdge[]> {
  const result = new Map<OptIrBlockId, OptIrEdge[]>();
  for (const edge of edges) {
    if (edge.toBlock === undefined) {
      continue;
    }
    result.set(edge.toBlock, [...(result.get(edge.toBlock) ?? []), edge]);
  }
  return result;
}

function constantValues(
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): ReadonlyMap<OptIrOperationId, string> {
  const result = new Map<OptIrOperationId, string>();
  for (const operation of operations.values()) {
    if (operation.kind === "constant") {
      result.set(operation.operationId, operation.constant.normalizedValue.toString());
    }
  }
  return result;
}

function booleanConstant(
  constants: ReadonlyMap<OptIrValueId, string>,
  valueId: OptIrValueId,
): boolean | undefined {
  const constant = constants.get(valueId);
  if (constant === "1") {
    return true;
  }
  if (constant === "0") {
    return false;
  }
  return undefined;
}

function canonicalValueMap(
  remaps: readonly (readonly [OptIrValueId, OptIrValueId])[],
): ReadonlyMap<OptIrValueId, OptIrValueId> {
  const direct = new Map<OptIrValueId, OptIrValueId>();
  for (const [source, target] of [...remaps].sort((left, right) => left[0] - right[0])) {
    if (source !== target) {
      direct.set(source, target);
    }
  }
  const canonical = new Map<OptIrValueId, OptIrValueId>();
  for (const source of [...direct.keys()].sort((left, right) => left - right)) {
    const target = resolveValue(source, direct);
    if (target !== source) {
      canonical.set(source, target);
    }
  }
  return canonical;
}

function resolveValue(
  source: OptIrValueId,
  direct: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrValueId {
  const seen = new Set<OptIrValueId>();
  let current = source;
  while (true) {
    const next = direct.get(current);
    if (next === undefined) {
      return current;
    }
    if (seen.has(next)) {
      return source;
    }
    seen.add(current);
    current = next;
  }
}

function droppedIds(subjects: readonly OptIrFactSubject[], kind: "block"): readonly OptIrBlockId[] {
  const ids = new Set<OptIrBlockId>();
  for (const subject of subjects) {
    if (subject.kind === kind) {
      ids.add(subject.blockId);
    }
  }
  return [...ids].sort((left, right) => left - right);
}

function droppedEdgeIds(subjects: readonly OptIrFactSubject[]): readonly OptIrEdgeId[] {
  const ids = new Set<OptIrEdgeId>();
  for (const subject of subjects) {
    if (subject.kind === "edge") {
      ids.add(subject.edgeId);
    }
  }
  return [...ids].sort((left, right) => left - right);
}

function sortedUnique<Value extends number>(values: readonly Value[]): readonly Value[] {
  return [...new Set(values)].sort((left, right) => left - right);
}

function sameFunctionShape(left: OptIrFunction, right: OptIrFunction): boolean {
  return (
    left.entryBlock === right.entryBlock &&
    sameBlocks(left.blocks, right.blocks) &&
    sameEdges(left.edges.entries(), right.edges.entries())
  );
}

function sameBlocks(left: readonly OptIrBlock[], right: readonly OptIrBlock[]): boolean {
  return (
    left.length === right.length &&
    left.every((block, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        block.blockId === other.blockId &&
        block.originId === other.originId &&
        sameBlockParameters(block.parameters, other.parameters) &&
        arraysEqual(block.operations, other.operations) &&
        sameTerminator(block.terminator, other.terminator)
      );
    })
  );
}

function sameBlockParameters(
  left: OptIrBlock["parameters"],
  right: OptIrBlock["parameters"],
): boolean {
  return (
    left.length === right.length &&
    left.every((parameter, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        parameter.valueId === other.valueId &&
        parameter.incomingRole === other.incomingRole &&
        parameter.originId === other.originId
      );
    })
  );
}

function sameEdges(left: readonly OptIrEdge[], right: readonly OptIrEdge[]): boolean {
  return (
    left.length === right.length &&
    left.every((edge, index) => {
      const other = right[index];
      return (
        other !== undefined &&
        edge.edgeId === other.edgeId &&
        edge.from === other.from &&
        edge.toBlock === other.toBlock &&
        edge.ordinal === other.ordinal &&
        edge.kind === other.kind &&
        edge.condition === other.condition &&
        edge.switchCase === other.switchCase &&
        edge.originId === other.originId &&
        arraysEqual(edge.arguments, other.arguments)
      );
    })
  );
}

function sameTerminator(
  left: OptIrTerminator | undefined,
  right: OptIrTerminator | undefined,
): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  if (left.kind !== right.kind || left.operationId !== right.operationId) {
    return false;
  }
  switch (left.kind) {
    case "branch":
      return (
        right.kind === "branch" &&
        left.condition === right.condition &&
        left.trueEdge === right.trueEdge &&
        left.falseEdge === right.falseEdge &&
        left.originId === right.originId
      );
    case "switch":
      return (
        right.kind === "switch" &&
        left.scrutinee === right.scrutinee &&
        left.defaultEdge === right.defaultEdge &&
        left.originId === right.originId &&
        sameSwitchCases(left.cases, right.cases)
      );
    case "jump":
      return right.kind === "jump" && left.edge === right.edge && left.originId === right.originId;
    case "return":
      return (
        right.kind === "return" &&
        left.originId === right.originId &&
        arraysEqual(left.values, right.values)
      );
    case "unreachable":
      return right.kind === "unreachable" && left.originId === right.originId;
  }
}

function sameSwitchCases(
  left: Extract<OptIrTerminator, { readonly kind: "switch" }>["cases"],
  right: Extract<OptIrTerminator, { readonly kind: "switch" }>["cases"],
): boolean {
  return (
    left.length === right.length &&
    left.every((switchCase, index) => {
      const other = right[index];
      return (
        other !== undefined && switchCase.label === other.label && switchCase.edge === other.edge
      );
    })
  );
}

function arraysEqual<Value>(left: readonly Value[], right: readonly Value[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function requireOperation(
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
  operationId: OptIrOperationId,
): OptIrOperation {
  const operation = operations.get(operationId);
  if (operation === undefined) {
    throw new RangeError(`Missing OptIR operation ${operationId}.`);
  }
  return operation;
}
