import type { OptIrFactSet } from "../facts/fact-index";
import type { OptIrBlock, OptIrEdge } from "../cfg";
import type { OptIrBlockId, OptIrEdgeId, OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrIntegerCompareOperator, OptIrOperation } from "../operations";
import type { OptIrFunction } from "../program";
import type { OptIrLoopTripCount } from "../passes/loop-vectorization/loop-shape";
import type { OptIrTerminator } from "../terminators";

export interface OptIrLoopRegion {
  readonly header: OptIrBlockId;
  readonly latches: readonly OptIrBlockId[];
  readonly blocks: readonly OptIrBlockId[];
}

export interface DeriveCertifiedLoopTripCountInput {
  readonly function: OptIrFunction;
  readonly loop: OptIrLoopRegion;
  readonly bodyOperations: readonly OptIrOperation[];
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly facts: OptIrFactSet;
}

export function deriveCertifiedLoopTripCount(
  input: DeriveCertifiedLoopTripCountInput,
): OptIrLoopTripCount {
  const header = input.function.blocks.find((block) => block.blockId === input.loop.header);
  if (header === undefined) {
    return { kind: "unknown" };
  }

  const inductionTrip = tripCountFromInductionVariable(input, header);
  if (inductionTrip !== undefined) {
    return { kind: "certifiedExact", iterations: inductionTrip };
  }

  return { kind: "unknown" };
}

function tripCountFromInductionVariable(
  input: DeriveCertifiedLoopTripCountInput,
  header: OptIrBlock,
): number | undefined {
  const inductionParameter = header.parameters.find(
    (parameter) => parameter.incomingRole === "loopCarried",
  );
  if (inductionParameter === undefined) {
    return undefined;
  }

  const parameterIndex = header.parameters.indexOf(inductionParameter);
  const backEdge = findBackEdgeToHeader(input.function, input.loop, header.blockId);
  if (backEdge === undefined) {
    return undefined;
  }

  const updatedValueId = backEdge.arguments[parameterIndex];
  if (updatedValueId === undefined) {
    return undefined;
  }

  const step = constantStepForInductionUpdate({
    inductionValueId: inductionParameter.valueId,
    updatedValueId,
    bodyOperations: input.bodyOperations,
    operations: input.operations,
  });
  if (step === undefined || step <= 0n) {
    return undefined;
  }

  const init = initialInductionValue({
    function: input.function,
    header,
    parameterIndex,
    operations: input.operations,
  });
  if (init === undefined) {
    return undefined;
  }

  const bound = inductionBoundFromHeaderBranch({
    header,
    inductionValueId: inductionParameter.valueId,
    loop: input.loop,
    function: input.function,
    operations: input.operations,
  });
  if (bound === undefined) {
    return undefined;
  }

  return certifiedIterationsForInduction(init, bound.value, bound.operator, step);
}

function findBackEdgeToHeader(
  function_: OptIrFunction,
  loop: OptIrLoopRegion,
  header: OptIrBlockId,
): OptIrEdge | undefined {
  const latchIds = new Set(loop.latches);
  return function_.edges
    .entries()
    .find((edge) => edge.toBlock === header && latchIds.has(edge.from));
}

function constantStepForInductionUpdate(input: {
  readonly inductionValueId: OptIrValueId;
  readonly updatedValueId: OptIrValueId;
  readonly bodyOperations: readonly OptIrOperation[];
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
}): bigint | undefined {
  const defining = operationDefiningValue(input.updatedValueId, input.operations);
  if (defining === undefined) {
    return undefined;
  }
  if (
    defining.kind === "integerBinary" &&
    defining.operator === "add" &&
    defining.left === input.inductionValueId
  ) {
    return constantValueFor(defining.right, input.operations);
  }
  if (
    defining.kind === "integerBinary" &&
    defining.operator === "add" &&
    defining.right === input.inductionValueId
  ) {
    return constantValueFor(defining.left, input.operations);
  }
  return undefined;
}

function initialInductionValue(input: {
  readonly function: OptIrFunction;
  readonly header: OptIrBlock;
  readonly parameterIndex: number;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
}): bigint | undefined {
  for (const edge of input.function.edges.entries()) {
    if (edge.toBlock !== input.header.blockId) {
      continue;
    }
    const fromBlock = input.function.blocks.find((block) => block.blockId === edge.from);
    if (fromBlock === undefined || fromBlock.blockId === input.header.blockId) {
      continue;
    }
    const initialValueId = edge.arguments[input.parameterIndex];
    if (initialValueId === undefined) {
      continue;
    }
    const constant = constantValueFor(initialValueId, input.operations);
    if (constant !== undefined) {
      return constant;
    }
  }
  return undefined;
}

function inductionBoundFromHeaderBranch(input: {
  readonly header: OptIrBlock;
  readonly inductionValueId: OptIrValueId;
  readonly loop: OptIrLoopRegion;
  readonly function: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
}): { readonly value: bigint; readonly operator: OptIrIntegerCompareOperator } | undefined {
  const terminator = input.header.terminator;
  if (terminator?.kind !== "branch") {
    return undefined;
  }

  const compare = operationDefiningValue(terminator.condition, input.operations);
  if (compare?.kind !== "integerCompare") {
    return undefined;
  }

  let boundValueId: OptIrValueId | undefined;
  const operator = compare.operator;
  if (compare.left === input.inductionValueId) {
    boundValueId = compare.right;
  } else {
    return undefined;
  }

  const bound = constantValueFor(boundValueId, input.operations);
  if (bound === undefined) {
    return undefined;
  }

  if (!branchContinuesLoop(terminator, input.loop, input.function)) {
    return undefined;
  }

  return { value: bound, operator };
}

function branchContinuesLoop(
  terminator: Extract<OptIrTerminator, { readonly kind: "branch" }>,
  loop: OptIrLoopRegion,
  function_: OptIrFunction,
): boolean {
  const loopBlocks = new Set(loop.blocks);
  const trueTarget = edgeTargetBlock(function_, terminator.trueEdge);
  const falseTarget = edgeTargetBlock(function_, terminator.falseEdge);
  if (trueTarget !== undefined && loopBlocks.has(trueTarget)) {
    return true;
  }
  return falseTarget !== undefined && !loopBlocks.has(falseTarget);
}

function edgeTargetBlock(function_: OptIrFunction, edgeId: OptIrEdgeId): OptIrBlockId | undefined {
  return function_.edges.entries().find((edge) => edge.edgeId === edgeId)?.toBlock;
}

function certifiedIterationsForInduction(
  init: bigint,
  bound: bigint,
  operator: OptIrIntegerCompareOperator,
  step: bigint,
): number | undefined {
  if (step <= 0n) {
    return undefined;
  }
  let span: bigint;
  switch (operator) {
    case "unsignedLessThan":
    case "signedLessThan":
      span = bound - init;
      break;
    case "unsignedLessThanOrEqual":
    case "signedLessThanOrEqual":
      span = bound - init + 1n;
      break;
    default:
      return undefined;
  }
  if (span <= 0n) {
    return 0;
  }
  if (span % step !== 0n) {
    return undefined;
  }
  const iterations = Number(span / step);
  return Number.isInteger(iterations) && iterations >= 0 ? iterations : undefined;
}

function operationDefiningValue(
  valueId: OptIrValueId,
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): OptIrOperation | undefined {
  for (const operation of operations.values()) {
    if (operation.resultIds.includes(valueId)) {
      return operation;
    }
  }
  return undefined;
}

function constantValueFor(
  valueId: OptIrValueId,
  operations: ReadonlyMap<OptIrOperationId, OptIrOperation>,
): bigint | undefined {
  const operation = operationDefiningValue(valueId, operations);
  if (operation?.kind !== "constant") {
    return undefined;
  }
  return operation.constant.normalizedValue;
}
