import type { OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import {
  isOptIrSourceValueOperation,
  rewriteOptIrSourceValueOperationOperands,
} from "../source-value-operations";

export interface OptIrOperationValueRewriter {
  valueFor(valueId: OptIrValueId): OptIrValueId;
}

export function rewriteOptIrOperationValues(
  operation: OptIrOperation,
  rewriter: OptIrOperationValueRewriter,
): OptIrOperation {
  const operandIds = Object.freeze(
    operation.operandIds.map((valueId) => rewriter.valueFor(valueId)),
  );
  const resultIds = Object.freeze(operation.resultIds.map((valueId) => rewriter.valueFor(valueId)));
  const base = { ...operation, operandIds, resultIds };

  if (isOptIrSourceValueOperation(operation)) {
    return rewriteOptIrSourceValueOperationOperands(operation, operandIds, resultIds);
  }

  switch (operation.kind) {
    case "constant":
    case "constAddr":
    case "memoryLoad":
    case "proofErasedMarker":
      return Object.freeze(base);
    case "integerUnary":
    case "booleanNot":
      return Object.freeze({
        ...base,
        operand: rewriter.valueFor(operation.operand),
      });
    case "integerBinary":
    case "integerCompare":
    case "booleanBinary":
      return Object.freeze({
        ...base,
        left: rewriter.valueFor(operation.left),
        right: rewriter.valueFor(operation.right),
      });
    case "aggregateConstruct":
      return Object.freeze({
        ...base,
        fieldIds: Object.freeze(operation.fieldIds.map((valueId) => rewriter.valueFor(valueId))),
      });
    case "aggregateExtract":
      return Object.freeze({
        ...base,
        aggregate: rewriter.valueFor(operation.aggregate),
      });
    case "aggregateInsert":
      return Object.freeze({
        ...base,
        aggregate: rewriter.valueFor(operation.aggregate),
        field: rewriter.valueFor(operation.field),
      });
    case "layoutOffset":
    case "layoutByteRange":
      return Object.freeze({
        ...base,
        base: rewriter.valueFor(operation.base),
      });
    case "layoutEndianDecode":
      return Object.freeze({
        ...base,
        bytes: rewriter.valueFor(operation.bytes),
      });
    case "memoryStore":
      return Object.freeze({
        ...base,
        storeValue: rewriter.valueFor(operation.storeValue),
      });
    case "sourceCall":
    case "runtimeCall":
    case "platformCall":
    case "intrinsicCall":
      return Object.freeze({
        ...base,
        argumentIds: Object.freeze(
          operation.argumentIds.map((valueId) => rewriter.valueFor(valueId)),
        ),
      });
    case "vectorLoad":
    case "vectorMaskedLoad":
      return Object.freeze({
        ...base,
        ...(operation.mask === undefined ? {} : { mask: rewriter.valueFor(operation.mask) }),
      });
    case "vectorStore":
    case "vectorMaskedStore":
      return Object.freeze({
        ...base,
        vector: rewriter.valueFor(operation.vector),
        storeValue: rewriter.valueFor(operation.storeValue),
        ...(operation.mask === undefined ? {} : { mask: rewriter.valueFor(operation.mask) }),
      });
    case "vectorByteSwap":
      return Object.freeze({
        ...base,
        vector: rewriter.valueFor(operation.vector),
      });
  }
}
