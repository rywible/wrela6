import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../cfg";
import {
  createOptIrSubjectRemapTable,
  type OptIrSubjectRemapTable,
} from "../facts/subject-remapping";
import type { OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import type { OptIrFunction } from "../program";
import {
  isOptIrSourceValueOperation,
  rewriteOptIrSourceValueOperationOperands,
} from "../source-value-operations";
import type { OptIrTerminator } from "../terminators";

export interface CopyPropagationInput {
  readonly function: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly valueCopies?: readonly (readonly [OptIrValueId, OptIrValueId])[];
}

export interface CopyPropagationResult {
  readonly function: OptIrFunction;
  readonly operations: readonly OptIrOperation[];
  readonly rewrittenValueIds: readonly OptIrValueId[];
  readonly removedBlockParameterValueIds: readonly OptIrValueId[];
  readonly subjectRemap: OptIrSubjectRemapTable;
}

export function runCopyPropagation(input: CopyPropagationInput): CopyPropagationResult {
  const explicitCopies = canonicalCopyMap(input.valueCopies ?? []);
  const edgesAfterExplicitCopies = rewriteEdges(input.function.edges.entries(), explicitCopies);
  const blockArgumentSimplification = removableBlockArguments(
    input.function.blocks,
    edgesAfterExplicitCopies,
  );
  const substitutions = canonicalCopyMap([
    ...explicitCopies.entries(),
    ...blockArgumentSimplification.valueCopies,
  ]);
  const rewrittenEdges = removeBlockArgumentPositions(
    rewriteEdges(input.function.edges.entries(), substitutions),
    blockArgumentSimplification.removedParameterIndexes,
  );
  const rewrittenBlocks = input.function.blocks.map((block) =>
    rewriteBlock(block, substitutions, blockArgumentSimplification.removedParameterIndexes),
  );
  const blockOperationIds = rewrittenBlocks.flatMap((block) => block.operations);
  const operations = blockOperationIds.map((operationId) =>
    rewriteOperation(requireOperation(input.operations, operationId), substitutions),
  );
  const rewrittenValueIds = rewrittenValueSources(
    input,
    operations,
    rewrittenBlocks,
    rewrittenEdges,
  );
  const removedBlockParameterValueIds = blockArgumentSimplification.valueCopies.map(
    ([valueId]) => valueId,
  );

  return {
    function: {
      ...input.function,
      blocks: rewrittenBlocks,
      edges: optIrCfgEdgeTable(rewrittenEdges),
    },
    operations,
    rewrittenValueIds,
    removedBlockParameterValueIds,
    subjectRemap: createOptIrSubjectRemapTable({
      values: [...explicitCopies.entries(), ...blockArgumentSimplification.valueCopies],
    }),
  };
}

function canonicalCopyMap(
  copies: readonly (readonly [OptIrValueId, OptIrValueId])[],
): ReadonlyMap<OptIrValueId, OptIrValueId> {
  const orderedCopies = [...copies].sort((left, right) => left[0] - right[0]);
  const direct = new Map<OptIrValueId, OptIrValueId>();
  for (const [source, target] of orderedCopies) {
    if (source !== target) {
      direct.set(source, target);
    }
  }

  const canonical = new Map<OptIrValueId, OptIrValueId>();
  for (const source of [...direct.keys()].sort((left, right) => left - right)) {
    const target = resolveValueCopy(source, direct);
    if (target !== source) {
      canonical.set(source, target);
    }
  }
  return canonical;
}

function resolveValueCopy(
  valueId: OptIrValueId,
  direct: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrValueId {
  const seen = new Set<OptIrValueId>();
  let current = valueId;
  while (true) {
    const next = direct.get(current);
    if (next === undefined) {
      return current;
    }
    if (seen.has(next)) {
      return valueId;
    }
    seen.add(current);
    current = next;
  }
}

function substituteValue(
  valueId: OptIrValueId,
  substitutions: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrValueId {
  return substitutions.get(valueId) ?? valueId;
}

function substituteValues(
  valueIds: readonly OptIrValueId[],
  substitutions: ReadonlyMap<OptIrValueId, OptIrValueId>,
): readonly OptIrValueId[] {
  return valueIds.map((valueId) => substituteValue(valueId, substitutions));
}

function rewriteEdges(
  edges: readonly OptIrEdge[],
  substitutions: ReadonlyMap<OptIrValueId, OptIrValueId>,
): readonly OptIrEdge[] {
  return edges.map((edge) => {
    const nextArguments = substituteValues(edge.arguments, substitutions);
    const nextCondition =
      edge.condition === undefined ? undefined : substituteValue(edge.condition, substitutions);
    if (arraysEqual(nextArguments, edge.arguments) && nextCondition === edge.condition) {
      return edge;
    }
    return {
      ...edge,
      arguments: nextArguments,
      ...(nextCondition === undefined ? {} : { condition: nextCondition }),
    };
  });
}

function removableBlockArguments(
  blocks: readonly OptIrBlock[],
  edges: readonly OptIrEdge[],
): {
  readonly valueCopies: readonly (readonly [OptIrValueId, OptIrValueId])[];
  readonly removedParameterIndexes: ReadonlyMap<OptIrBlock["blockId"], ReadonlySet<number>>;
} {
  const edgesByTarget = new Map<OptIrBlock["blockId"], OptIrEdge[]>();
  for (const edge of edges) {
    if (edge.toBlock === undefined) {
      continue;
    }
    edgesByTarget.set(edge.toBlock, [...(edgesByTarget.get(edge.toBlock) ?? []), edge]);
  }

  const valueCopies: (readonly [OptIrValueId, OptIrValueId])[] = [];
  const removedParameterIndexes = new Map<OptIrBlock["blockId"], ReadonlySet<number>>();
  for (const block of blocks) {
    const incomingEdges = edgesByTarget.get(block.blockId) ?? [];
    if (incomingEdges.length === 0 || block.parameters.length === 0) {
      continue;
    }
    const removableIndexes = new Set<number>();
    block.parameters.forEach((parameter, index) => {
      const incomingValue = commonIncomingArgument(incomingEdges, index);
      if (incomingValue === undefined || incomingValue === parameter.valueId) {
        return;
      }
      removableIndexes.add(index);
      valueCopies.push([parameter.valueId, incomingValue]);
    });
    if (removableIndexes.size > 0) {
      removedParameterIndexes.set(block.blockId, removableIndexes);
    }
  }

  return {
    valueCopies: valueCopies.sort((left, right) => left[0] - right[0]),
    removedParameterIndexes,
  };
}

function commonIncomingArgument(
  incomingEdges: readonly OptIrEdge[],
  index: number,
): OptIrValueId | undefined {
  const first = incomingEdges[0]?.arguments[index];
  if (first === undefined) {
    return undefined;
  }
  return incomingEdges.every((edge) => edge.arguments[index] === first) ? first : undefined;
}

function removeBlockArgumentPositions(
  edges: readonly OptIrEdge[],
  removedParameterIndexes: ReadonlyMap<OptIrBlock["blockId"], ReadonlySet<number>>,
): readonly OptIrEdge[] {
  return edges.map((edge) => {
    const removedIndexes =
      edge.toBlock === undefined ? undefined : removedParameterIndexes.get(edge.toBlock);
    if (removedIndexes === undefined || removedIndexes.size === 0) {
      return edge;
    }
    return {
      ...edge,
      arguments: edge.arguments.filter((argumentId, index) => {
        void argumentId;
        return !removedIndexes.has(index);
      }),
    };
  });
}

function rewriteBlock(
  block: OptIrBlock,
  substitutions: ReadonlyMap<OptIrValueId, OptIrValueId>,
  removedParameterIndexes: ReadonlyMap<OptIrBlock["blockId"], ReadonlySet<number>>,
): OptIrBlock {
  const removedIndexes = removedParameterIndexes.get(block.blockId);
  const parameters =
    removedIndexes === undefined
      ? block.parameters
      : block.parameters.filter((parameter, index) => {
          void parameter;
          return !removedIndexes.has(index);
        });
  const terminator =
    block.terminator === undefined ? undefined : rewriteTerminator(block.terminator, substitutions);
  return {
    ...block,
    parameters,
    ...(terminator === undefined ? {} : { terminator }),
  };
}

function rewriteTerminator(
  terminator: OptIrTerminator,
  substitutions: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrTerminator {
  switch (terminator.kind) {
    case "branch":
      return { ...terminator, condition: substituteValue(terminator.condition, substitutions) };
    case "switch":
      return { ...terminator, scrutinee: substituteValue(terminator.scrutinee, substitutions) };
    case "return":
      return { ...terminator, values: substituteValues(terminator.values, substitutions) };
    case "jump":
    case "unreachable":
      return terminator;
  }
}

function rewriteOperation(
  operation: OptIrOperation,
  substitutions: ReadonlyMap<OptIrValueId, OptIrValueId>,
): OptIrOperation {
  const operandIds = substituteValues(operation.operandIds, substitutions);
  if (arraysEqual(operandIds, operation.operandIds)) {
    return operation;
  }

  if (isOptIrSourceValueOperation(operation)) {
    return rewriteOptIrSourceValueOperationOperands(operation, operandIds);
  }

  switch (operation.kind) {
    case "constant":
    case "constAddr":
    case "proofErasedMarker":
      return operation;
    case "memoryLoad":
      return { ...operation, operandIds };
    case "integerUnary":
      return { ...operation, operandIds, operand: operandIds[0] ?? operation.operand };
    case "integerBinary":
    case "integerCompare":
    case "booleanBinary":
      return {
        ...operation,
        operandIds,
        left: operandIds[0] ?? operation.left,
        right: operandIds[1] ?? operation.right,
      };
    case "booleanNot":
      return { ...operation, operandIds, operand: operandIds[0] ?? operation.operand };
    case "aggregateConstruct":
      return { ...operation, operandIds, fieldIds: operandIds };
    case "aggregateExtract":
      return { ...operation, operandIds, aggregate: operandIds[0] ?? operation.aggregate };
    case "aggregateInsert":
      return {
        ...operation,
        operandIds,
        aggregate: operandIds[0] ?? operation.aggregate,
        field: operandIds[1] ?? operation.field,
      };
    case "layoutOffset":
    case "layoutByteRange":
      return { ...operation, operandIds, base: operandIds[0] ?? operation.base };
    case "layoutEndianDecode":
      return { ...operation, operandIds, bytes: operandIds[0] ?? operation.bytes };
    case "memoryStore":
      return { ...operation, operandIds, storeValue: operandIds[0] ?? operation.storeValue };
    case "sourceCall":
    case "runtimeCall":
    case "platformCall":
    case "intrinsicCall":
      return { ...operation, operandIds, argumentIds: operandIds };
    case "vectorLoad":
    case "vectorMaskedLoad":
      return {
        ...operation,
        operandIds,
        mask: operation.mask === undefined ? undefined : operandIds[0],
      };
    case "vectorStore":
    case "vectorMaskedStore":
      return {
        ...operation,
        operandIds,
        vector: operandIds[0] ?? operation.vector,
        storeValue: operandIds[1] ?? operation.storeValue,
        mask: operation.mask === undefined ? undefined : operandIds[2],
      };
    case "vectorByteSwap":
      return { ...operation, operandIds, vector: operandIds[0] ?? operation.vector };
  }
}

function rewrittenValueSources(
  input: CopyPropagationInput,
  operations: readonly OptIrOperation[],
  blocks: readonly OptIrBlock[],
  edges: readonly OptIrEdge[],
): readonly OptIrValueId[] {
  const rewritten = new Set<OptIrValueId>();
  const originalOperations = new Map(input.operations);
  for (const operation of operations) {
    const original = originalOperations.get(operation.operationId);
    if (original !== undefined) {
      collectChangedValues(original.operandIds, operation.operandIds, rewritten);
    }
  }

  const originalBlocks = new Map(input.function.blocks.map((block) => [block.blockId, block]));
  for (const block of blocks) {
    const original = originalBlocks.get(block.blockId);
    if (original?.terminator !== undefined && block.terminator !== undefined) {
      collectChangedValues(
        terminatorValues(original.terminator),
        terminatorValues(block.terminator),
        rewritten,
      );
    }
  }

  const originalEdges = new Map(input.function.edges.entries().map((edge) => [edge.edgeId, edge]));
  for (const edge of edges) {
    const original = originalEdges.get(edge.edgeId);
    if (original !== undefined) {
      collectChangedValues(original.arguments, edge.arguments, rewritten);
      if (original.condition !== edge.condition && original.condition !== undefined) {
        rewritten.add(original.condition);
      }
    }
  }
  return [...rewritten].sort((left, right) => left - right);
}

function terminatorValues(terminator: OptIrTerminator): readonly OptIrValueId[] {
  switch (terminator.kind) {
    case "branch":
      return [terminator.condition];
    case "switch":
      return [terminator.scrutinee];
    case "return":
      return terminator.values;
    case "jump":
    case "unreachable":
      return [];
  }
}

function collectChangedValues(
  before: readonly OptIrValueId[],
  after: readonly OptIrValueId[],
  rewritten: Set<OptIrValueId>,
): void {
  before.forEach((valueId, index) => {
    if (after[index] !== valueId) {
      rewritten.add(valueId);
    }
  });
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
