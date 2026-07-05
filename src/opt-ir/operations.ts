import type { OptIrCallTarget } from "./calls";
import type { OptIrDiagnostic } from "./diagnostics";
import type { OptIrCallId, OptIrOperationId, OptIrOriginId, OptIrValueId } from "./ids";
import type { OptIrOperationKind } from "./operation-kinds";
import {
  optIrOperationEffectMetadataForKind,
  type OptIrOperationEffectMetadata,
} from "./operation-effects";
import {
  optIrOperationSemanticsMetadataForKind,
  type OptIrOperationSemanticsMetadata,
} from "./operation-semantics";
import {
  optIrCanonicalContract,
  type OptIrNumericContract,
  type OptIrSemanticContract,
} from "./operation-contracts";
import type { OptIrType } from "./types";
import type { OptIrScalarOperation } from "./operations/scalar-operations";
import type { OptIrAggregateOperation } from "./operations/aggregate-operations";
import type {
  OptIrEndian,
  OptIrMemoryAccessDescriptor,
  OptIrMemoryOperation,
} from "./operations/memory-operations";

export type {
  OptIrBooleanBinaryOperator,
  OptIrIntegerBinaryOperator,
  OptIrIntegerCompareOperator,
  OptIrIntegerUnaryOperator,
  OptIrScalarOperation,
} from "./operations/scalar-operations";
export type { OptIrAggregateOperation } from "./operations/aggregate-operations";
export type {
  OptIrBoundsAuthority,
  OptIrEndian,
  OptIrMemoryAccessDescriptor,
  OptIrMemoryOperation,
  OptIrRuntimeBoundsGuard,
  OptIrValidatedBufferEvidence,
} from "./operations/memory-operations";

export {
  optIrBooleanBinaryOperation,
  optIrBooleanNotOperation,
  optIrConstAddrOperation,
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrIntegerUnaryOperation,
} from "./operations/scalar-operations";
export {
  optIrAggregateConstructOperation,
  optIrAggregateExtractOperation,
  optIrAggregateInsertOperation,
} from "./operations/aggregate-operations";
export {
  optIrLayoutByteRangeOperation,
  optIrLayoutEndianDecodeOperation,
  optIrLayoutOffsetOperation,
  optIrMemoryLoadOperation,
  optIrMemoryStoreOperation,
  optIrVectorLoadOperation,
  optIrVectorMaskedLoadOperation,
  optIrVectorMaskedStoreOperation,
  optIrVectorStoreOperation,
} from "./operations/memory-operations";

export interface OptIrOperationBase<Kind extends OptIrOperationKind> {
  readonly kind: Kind;
  readonly operationId: OptIrOperationId;
  readonly stableKey: Kind;
  readonly operandIds: readonly OptIrValueId[];
  readonly resultIds: readonly OptIrValueId[];
  readonly resultTypes: readonly OptIrType[];
  readonly semantics: OptIrOperationSemanticsMetadata;
  readonly effects: OptIrOperationEffectMetadata;
  readonly originId: OptIrOriginId;
  readonly displayName?: string;
}

export type OptIrOperation =
  | OptIrScalarOperation
  | OptIrAggregateOperation
  | OptIrMemoryOperation
  | (OptIrOperationBase<"sourceCall" | "runtimeCall" | "platformCall" | "intrinsicCall"> & {
      readonly callId: OptIrCallId;
      readonly target: OptIrCallTarget;
      readonly argumentIds: readonly OptIrValueId[];
    })
  | (OptIrOperationBase<"vectorLoad" | "vectorMaskedLoad"> & {
      readonly memoryAccess: OptIrMemoryAccessDescriptor;
      readonly mask?: OptIrValueId;
    })
  | (OptIrOperationBase<"vectorStore" | "vectorMaskedStore"> & {
      readonly memoryAccess: OptIrMemoryAccessDescriptor;
      readonly vector: OptIrValueId;
      readonly storeValue: OptIrValueId;
      readonly mask?: OptIrValueId;
    })
  | (OptIrOperationBase<"vectorShuffle"> & {
      readonly sourceValueIds: readonly OptIrValueId[];
      readonly shuffleIndices: readonly number[];
    })
  | (OptIrOperationBase<"vectorCompare"> & { readonly sourceValueIds: readonly OptIrValueId[] })
  | (OptIrOperationBase<"vectorSelect"> & {
      readonly mask: OptIrValueId;
      readonly sourceValueIds: readonly OptIrValueId[];
    })
  | (OptIrOperationBase<"vectorByteSwap"> & {
      readonly vector: OptIrValueId;
      readonly endian: OptIrEndian;
    })
  | (OptIrOperationBase<
      | "semanticAtomic"
      | "semanticFence"
      | "semanticChecksum"
      | "semanticPolynomial"
      | "semanticCryptoMix"
      | "semanticClassifier"
      | "semanticRegionMarker"
    > & {
      readonly sourceValueIds: readonly OptIrValueId[];
      readonly semanticContract: OptIrSemanticContract;
    })
  | (OptIrOperationBase<"fpNumeric"> & {
      readonly sourceValueIds: readonly OptIrValueId[];
      readonly numericContract: OptIrNumericContract;
    })
  | (OptIrOperationBase<"proofErasedMarker"> & { readonly erasedProof: string });

export type OptIrOperationConstructionResult =
  | { readonly kind: "ok"; readonly operation: OptIrOperation }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

export interface DefineOptIrOperationInput<Kind extends OptIrOperationKind> {
  readonly kind: Kind;
  readonly operationId: OptIrOperationId;
  readonly operandIds: readonly OptIrValueId[];
  readonly resultIds: readonly OptIrValueId[];
  readonly resultTypes: readonly OptIrType[];
  readonly attributes?: Readonly<Record<string, unknown>>;
  readonly originId: OptIrOriginId;
  readonly displayName?: string;
}

function metadataForKind<Kind extends OptIrOperationKind>(
  kind: Kind,
): OptIrOperationBase<Kind>["semantics"] {
  return optIrOperationSemanticsMetadataForKind(kind);
}

export function defineOptIrOperation<Kind extends OptIrOperationKind>(
  input: DefineOptIrOperationInput<Kind>,
): OptIrOperationBase<Kind> & { readonly attributes: Readonly<Record<string, unknown>> } {
  return Object.freeze({
    kind: input.kind,
    operationId: input.operationId,
    stableKey: input.kind,
    operandIds: Object.freeze([...input.operandIds]),
    resultIds: Object.freeze([...input.resultIds]),
    resultTypes: Object.freeze([...input.resultTypes]),
    semantics: metadataForKind(input.kind),
    effects: optIrOperationEffectMetadataForKind(input.kind),
    originId: input.originId,
    ...(input.displayName !== undefined && { displayName: input.displayName }),
    attributes: Object.freeze(input.attributes === undefined ? {} : { ...input.attributes }),
  });
}

function operation<Kind extends OptIrOperationKind, Extra extends object>(
  input: DefineOptIrOperationInput<Kind>,
  extra: Extra,
): OptIrOperationBase<Kind> & Extra {
  const base = defineOptIrOperation(input);
  const { attributes: _attributes, ...withoutAttributes } = base;
  void _attributes;
  return Object.freeze({ ...withoutAttributes, ...extra });
}

function callOperation<
  Kind extends "sourceCall" | "runtimeCall" | "platformCall" | "intrinsicCall",
>(
  kind: Kind,
  input: {
    readonly operationId: OptIrOperationId;
    readonly callId: OptIrCallId;
    readonly target: OptIrCallTarget;
    readonly argumentIds: readonly OptIrValueId[];
    readonly resultIds: readonly OptIrValueId[];
    readonly resultTypes: readonly OptIrType[];
    readonly originId: OptIrOriginId;
  },
): OptIrOperation {
  return operation(
    {
      kind,
      operationId: input.operationId,
      operandIds: input.argumentIds,
      resultIds: input.resultIds,
      resultTypes: input.resultTypes,
      originId: input.originId,
    },
    {
      callId: input.callId,
      target: input.target,
      argumentIds: Object.freeze([...input.argumentIds]),
    },
  ) as OptIrOperation;
}

export function optIrSourceCallOperation(
  input: Parameters<typeof callOperation>[1],
): OptIrOperation {
  return callOperation("sourceCall", input);
}

export function optIrRuntimeCallOperation(
  input: Parameters<typeof callOperation>[1],
): OptIrOperation {
  return callOperation("runtimeCall", input);
}

export function optIrPlatformCallOperation(
  input: Parameters<typeof callOperation>[1],
): OptIrOperation {
  return callOperation("platformCall", input);
}

export function optIrIntrinsicCallOperation(
  input: Parameters<typeof callOperation>[1],
): OptIrOperation {
  return callOperation("intrinsicCall", input);
}

export function optIrVectorShuffleOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly sourceValueIds: readonly OptIrValueId[];
  readonly shuffleIndices: readonly number[];
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "vectorShuffle",
      operationId: input.operationId,
      operandIds: input.sourceValueIds,
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    {
      sourceValueIds: Object.freeze([...input.sourceValueIds]),
      shuffleIndices: Object.freeze([...input.shuffleIndices]),
    },
  ) as OptIrOperation;
}

export function optIrVectorCompareOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly sourceValueIds: readonly OptIrValueId[];
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "vectorCompare",
      operationId: input.operationId,
      operandIds: input.sourceValueIds,
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { sourceValueIds: Object.freeze([...input.sourceValueIds]) },
  ) as OptIrOperation;
}

export function optIrVectorSelectOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly mask: OptIrValueId;
  readonly sourceValueIds: readonly OptIrValueId[];
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "vectorSelect",
      operationId: input.operationId,
      operandIds: [input.mask, ...input.sourceValueIds],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { mask: input.mask, sourceValueIds: Object.freeze([...input.sourceValueIds]) },
  ) as OptIrOperation;
}

export function optIrVectorByteSwapOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly vector: OptIrValueId;
  readonly endian: OptIrEndian;
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "vectorByteSwap",
      operationId: input.operationId,
      operandIds: [input.vector],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { vector: input.vector, endian: input.endian },
  ) as OptIrOperation;
}

function optIrSemanticOperation(
  kind:
    | "semanticAtomic"
    | "semanticFence"
    | "semanticChecksum"
    | "semanticPolynomial"
    | "semanticCryptoMix"
    | "semanticClassifier"
    | "semanticRegionMarker",
  input: {
    readonly operationId: OptIrOperationId;
    readonly operands: readonly OptIrValueId[];
    readonly resultIds: readonly OptIrValueId[];
    readonly resultTypes: readonly OptIrType[];
    readonly semanticContract: Readonly<Record<string, unknown>>;
    readonly originId: OptIrOriginId;
  },
): OptIrOperation {
  return operation(
    {
      kind,
      operationId: input.operationId,
      operandIds: input.operands,
      resultIds: input.resultIds,
      resultTypes: input.resultTypes,
      originId: input.originId,
    },
    {
      sourceValueIds: Object.freeze([...input.operands]),
      semanticContract: optIrCanonicalContract(input.semanticContract, kind),
    },
  ) as OptIrOperation;
}

export function optIrSemanticAtomicOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly operands: readonly OptIrValueId[];
  readonly resultIds: readonly OptIrValueId[];
  readonly resultTypes: readonly OptIrType[];
  readonly semanticContract: Readonly<Record<string, unknown>>;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return optIrSemanticOperation("semanticAtomic", input);
}

export function optIrSemanticChecksumOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly operands: readonly OptIrValueId[];
  readonly resultIds: readonly OptIrValueId[];
  readonly resultTypes: readonly OptIrType[];
  readonly semanticContract: Readonly<Record<string, unknown>>;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return optIrSemanticOperation("semanticChecksum", input);
}

export function optIrSemanticPolynomialOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly operands: readonly OptIrValueId[];
  readonly resultIds: readonly OptIrValueId[];
  readonly resultTypes: readonly OptIrType[];
  readonly semanticContract: Readonly<Record<string, unknown>>;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return optIrSemanticOperation("semanticPolynomial", input);
}

export function optIrSemanticCryptoMixOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly operands: readonly OptIrValueId[];
  readonly resultIds: readonly OptIrValueId[];
  readonly resultTypes: readonly OptIrType[];
  readonly semanticContract: Readonly<Record<string, unknown>>;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return optIrSemanticOperation("semanticCryptoMix", input);
}

export function optIrSemanticClassifierOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly operands: readonly OptIrValueId[];
  readonly resultIds: readonly OptIrValueId[];
  readonly resultTypes: readonly OptIrType[];
  readonly semanticContract: Readonly<Record<string, unknown>>;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return optIrSemanticOperation("semanticClassifier", input);
}

export function optIrSemanticFenceOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly operands: readonly OptIrValueId[];
  readonly resultIds: readonly OptIrValueId[];
  readonly resultTypes: readonly OptIrType[];
  readonly semanticContract: Readonly<Record<string, unknown>>;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return optIrSemanticOperation("semanticFence", input);
}

export function optIrFpNumericOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly operands: readonly OptIrValueId[];
  readonly resultIds: readonly OptIrValueId[];
  readonly resultTypes: readonly OptIrType[];
  readonly numericContract: Readonly<Record<string, unknown>>;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "fpNumeric",
      operationId: input.operationId,
      operandIds: input.operands,
      resultIds: input.resultIds,
      resultTypes: input.resultTypes,
      originId: input.originId,
    },
    {
      sourceValueIds: Object.freeze([...input.operands]),
      numericContract: optIrCanonicalContract(input.numericContract, "fpNumeric"),
    },
  ) as OptIrOperation;
}

export function optIrProofErasedMarkerOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly erasedProof: string;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "proofErasedMarker",
      operationId: input.operationId,
      operandIds: [],
      resultIds: [],
      resultTypes: [],
      originId: input.originId,
    },
    { erasedProof: input.erasedProof },
  ) as OptIrOperation;
}
