import type { OptIrValueId } from "./ids";
import type { OptIrOperation } from "./operations";

export type OptIrSourceValueOperation = Extract<
  OptIrOperation,
  { readonly sourceValueIds: readonly OptIrValueId[] }
>;

const SOURCE_VALUE_OPERATION_KINDS = new Set<OptIrOperation["kind"]>([
  "vectorShuffle",
  "vectorCompare",
  "vectorSelect",
  "semanticAtomic",
  "semanticFence",
  "semanticChecksum",
  "semanticPolynomial",
  "semanticCryptoMix",
  "semanticClassifier",
  "semanticRegionMarker",
  "fpNumeric",
]);

export function isOptIrSourceValueOperation(
  operation: OptIrOperation,
): operation is OptIrSourceValueOperation {
  return SOURCE_VALUE_OPERATION_KINDS.has(operation.kind);
}

export function rewriteOptIrSourceValueOperationOperands(
  operation: OptIrOperation,
  operandIds: readonly OptIrValueId[],
  resultIds: readonly OptIrValueId[] = operation.resultIds,
): OptIrSourceValueOperation {
  if (!isOptIrSourceValueOperation(operation)) {
    throw new RangeError(`${operation.kind} is not an OptIR source-value operation.`);
  }
  const frozenOperands = Object.freeze([...operandIds]);
  const frozenResults = Object.freeze([...resultIds]);
  if (operation.kind === "vectorSelect") {
    return Object.freeze({
      ...operation,
      operandIds: frozenOperands,
      resultIds: frozenResults,
      mask: frozenOperands[0] ?? operation.mask,
      sourceValueIds: Object.freeze(frozenOperands.slice(1)),
    });
  }
  return Object.freeze({
    ...operation,
    operandIds: frozenOperands,
    resultIds: frozenResults,
    sourceValueIds: frozenOperands,
  });
}

export function substituteOptIrSourceValueOperationOperands(
  operation: OptIrOperation,
  substituteValue: (valueId: OptIrValueId) => OptIrValueId,
): OptIrSourceValueOperation {
  return rewriteOptIrSourceValueOperationOperands(
    operation,
    operation.operandIds.map(substituteValue),
    operation.resultIds.map(substituteValue),
  );
}
