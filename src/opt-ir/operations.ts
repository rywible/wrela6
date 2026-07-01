import type { LayoutFactKey } from "../proof-check/model/fact-packet";
import type { OptIrCallTarget } from "./calls";
import type { OptIrConstant } from "./constants";
import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
} from "./diagnostics";
import type {
  OptIrCallId,
  OptIrEdgeId,
  OptIrFactId,
  OptIrOperationId,
  OptIrOriginId,
  OptIrPathCertificateId,
  OptIrRegionId,
  OptIrValueId,
} from "./ids";
import type { RewriteLegalityObligationId } from "./passes/pass-contract";
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
import type { OptIrRegionVolatility } from "./regions";
import { optIrBooleanType, type OptIrType } from "./types";

export type OptIrIntegerUnaryOperator = "negate" | "bitwiseNot";
export type OptIrIntegerBinaryOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "unsignedDivide"
  | "signedDivide"
  | "and"
  | "or"
  | "xor"
  | "shiftLeft"
  | "shiftRight";
export type OptIrIntegerCompareOperator =
  | "equal"
  | "notEqual"
  | "unsignedLessThan"
  | "unsignedLessThanOrEqual"
  | "signedLessThan"
  | "signedLessThanOrEqual";
export type OptIrBooleanBinaryOperator = "and" | "or" | "xor" | "equal" | "notEqual";
export type OptIrEndian = "little" | "big" | "native";

export type OptIrBoundsAuthority =
  | { readonly kind: "certifiedFact"; readonly factId: OptIrFactId }
  | {
      readonly kind: "passDerivedFact";
      readonly factId: OptIrFactId;
      readonly obligationId: RewriteLegalityObligationId;
    }
  | { readonly kind: "runtimeGuard"; readonly guard: OptIrRuntimeBoundsGuard }
  | { readonly kind: "constructionSize" }
  | { readonly kind: "layoutFact"; readonly layoutKey: LayoutFactKey }
  | { readonly kind: "targetContract"; readonly authorityKey: string };

export interface OptIrRuntimeBoundsGuard {
  readonly guardOperation: OptIrOperationId;
  readonly successEdge: OptIrEdgeId;
  readonly checkedByteRange: {
    readonly start: bigint;
    readonly endExclusive: bigint;
  };
  readonly dominatesAccess: true;
}

export interface OptIrMemoryAccessDescriptor {
  readonly region: OptIrRegionId;
  readonly byteOffset: bigint;
  readonly byteWidth: number;
  readonly alignment: number;
  readonly valueType: OptIrType;
  readonly endian: OptIrEndian;
  readonly volatility: OptIrRegionVolatility;
  readonly layoutPath?: LayoutFactKey;
  readonly boundsAuthority: OptIrBoundsAuthority;
  readonly validatedBuffer?: OptIrValidatedBufferEvidence;
}

export interface OptIrValidatedBufferEvidence {
  readonly fieldName: string;
  readonly layoutPath: readonly string[];
  readonly readRequires: readonly string[];
  readonly pathCertificates: readonly OptIrPathCertificateId[];
}

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
  | (OptIrOperationBase<"constant"> & { readonly constant: OptIrConstant })
  | (OptIrOperationBase<"integerUnary"> & {
      readonly operator: OptIrIntegerUnaryOperator;
      readonly operand: OptIrValueId;
    })
  | (OptIrOperationBase<"integerBinary"> & {
      readonly operator: OptIrIntegerBinaryOperator;
      readonly left: OptIrValueId;
      readonly right: OptIrValueId;
    })
  | (OptIrOperationBase<"integerCompare"> & {
      readonly operator: OptIrIntegerCompareOperator;
      readonly left: OptIrValueId;
      readonly right: OptIrValueId;
    })
  | (OptIrOperationBase<"booleanNot"> & { readonly operand: OptIrValueId })
  | (OptIrOperationBase<"booleanBinary"> & {
      readonly operator: OptIrBooleanBinaryOperator;
      readonly left: OptIrValueId;
      readonly right: OptIrValueId;
    })
  | (OptIrOperationBase<"aggregateConstruct"> & { readonly fieldIds: readonly OptIrValueId[] })
  | (OptIrOperationBase<"aggregateExtract"> & {
      readonly aggregate: OptIrValueId;
      readonly fieldPath: readonly string[];
    })
  | (OptIrOperationBase<"aggregateInsert"> & {
      readonly aggregate: OptIrValueId;
      readonly field: OptIrValueId;
      readonly fieldPath: readonly string[];
    })
  | (OptIrOperationBase<"layoutOffset"> & {
      readonly base: OptIrValueId;
      readonly layoutPath: LayoutFactKey;
    })
  | (OptIrOperationBase<"layoutByteRange"> & {
      readonly base: OptIrValueId;
      readonly layoutPath: LayoutFactKey;
    })
  | (OptIrOperationBase<"layoutEndianDecode"> & {
      readonly bytes: OptIrValueId;
      readonly endian: OptIrEndian;
    })
  | (OptIrOperationBase<"memoryLoad"> & { readonly memoryAccess: OptIrMemoryAccessDescriptor })
  | (OptIrOperationBase<"memoryStore"> & {
      readonly memoryAccess: OptIrMemoryAccessDescriptor;
      readonly storeValue: OptIrValueId;
    })
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

export function optIrConstantOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly constant: OptIrConstant;
  readonly originId: OptIrOriginId;
  readonly displayName?: string;
}): OptIrOperation {
  return operation(
    {
      kind: "constant",
      operationId: input.operationId,
      operandIds: [],
      resultIds: [input.resultId],
      resultTypes: [input.constant.type],
      originId: input.originId,
      displayName: input.displayName,
    },
    { constant: input.constant },
  ) as OptIrOperation;
}

export function optIrIntegerUnaryOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly operand: OptIrValueId;
  readonly operator: OptIrIntegerUnaryOperator;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "integerUnary",
      operationId: input.operationId,
      operandIds: [input.operand],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { operand: input.operand, operator: input.operator },
  ) as OptIrOperation;
}

export function optIrIntegerBinaryOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly left: OptIrValueId;
  readonly right: OptIrValueId;
  readonly operator: OptIrIntegerBinaryOperator;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "integerBinary",
      operationId: input.operationId,
      operandIds: [input.left, input.right],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { left: input.left, right: input.right, operator: input.operator },
  ) as OptIrOperation;
}

export function optIrIntegerCompareOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly left: OptIrValueId;
  readonly right: OptIrValueId;
  readonly operator: OptIrIntegerCompareOperator;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "integerCompare",
      operationId: input.operationId,
      operandIds: [input.left, input.right],
      resultIds: [input.resultId],
      resultTypes: [optIrBooleanType()],
      originId: input.originId,
    },
    { left: input.left, right: input.right, operator: input.operator },
  ) as OptIrOperation;
}

export function optIrBooleanNotOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly operand: OptIrValueId;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "booleanNot",
      operationId: input.operationId,
      operandIds: [input.operand],
      resultIds: [input.resultId],
      resultTypes: [optIrBooleanType()],
      originId: input.originId,
    },
    { operand: input.operand },
  ) as OptIrOperation;
}

export function optIrBooleanBinaryOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly resultId: OptIrValueId;
  readonly left: OptIrValueId;
  readonly right: OptIrValueId;
  readonly operator: OptIrBooleanBinaryOperator;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "booleanBinary",
      operationId: input.operationId,
      operandIds: [input.left, input.right],
      resultIds: [input.resultId],
      resultTypes: [optIrBooleanType()],
      originId: input.originId,
    },
    { left: input.left, right: input.right, operator: input.operator },
  ) as OptIrOperation;
}

export function optIrAggregateConstructOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly fieldIds: readonly OptIrValueId[];
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "aggregateConstruct",
      operationId: input.operationId,
      operandIds: input.fieldIds,
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { fieldIds: Object.freeze([...input.fieldIds]) },
  ) as OptIrOperation;
}

export function optIrAggregateExtractOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly aggregate: OptIrValueId;
  readonly fieldPath: readonly string[];
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "aggregateExtract",
      operationId: input.operationId,
      operandIds: [input.aggregate],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { aggregate: input.aggregate, fieldPath: Object.freeze([...input.fieldPath]) },
  ) as OptIrOperation;
}

export function optIrAggregateInsertOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly aggregate: OptIrValueId;
  readonly field: OptIrValueId;
  readonly fieldPath: readonly string[];
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "aggregateInsert",
      operationId: input.operationId,
      operandIds: [input.aggregate, input.field],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    {
      aggregate: input.aggregate,
      field: input.field,
      fieldPath: Object.freeze([...input.fieldPath]),
    },
  ) as OptIrOperation;
}

export function optIrLayoutOffsetOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly base: OptIrValueId;
  readonly layoutPath: LayoutFactKey;
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return layoutOperation("layoutOffset", input, { base: input.base, layoutPath: input.layoutPath });
}

export function optIrLayoutByteRangeOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly base: OptIrValueId;
  readonly layoutPath: LayoutFactKey;
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return layoutOperation("layoutByteRange", input, {
    base: input.base,
    layoutPath: input.layoutPath,
  });
}

function layoutOperation<Kind extends "layoutOffset" | "layoutByteRange", Extra extends object>(
  kind: Kind,
  input: {
    readonly operationId: OptIrOperationId;
    readonly base: OptIrValueId;
    readonly resultId: OptIrValueId;
    readonly resultType: OptIrType;
    readonly originId: OptIrOriginId;
  },
  extra: Extra,
): OptIrOperation {
  return operation(
    {
      kind,
      operationId: input.operationId,
      operandIds: [input.base],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    extra,
  ) as unknown as OptIrOperation;
}

export function optIrLayoutEndianDecodeOperation(input: {
  readonly operationId: OptIrOperationId;
  readonly bytes: OptIrValueId;
  readonly endian: OptIrEndian;
  readonly resultId: OptIrValueId;
  readonly resultType: OptIrType;
  readonly originId: OptIrOriginId;
}): OptIrOperation {
  return operation(
    {
      kind: "layoutEndianDecode",
      operationId: input.operationId,
      operandIds: [input.bytes],
      resultIds: [input.resultId],
      resultTypes: [input.resultType],
      originId: input.originId,
    },
    { bytes: input.bytes, endian: input.endian },
  ) as OptIrOperation;
}

type MemoryAccessInput = Omit<OptIrMemoryAccessDescriptor, "boundsAuthority"> & {
  readonly boundsAuthority?: OptIrBoundsAuthority;
};

function memoryDiagnostic(input: {
  readonly operationId: OptIrOperationId;
  readonly originId: OptIrOriginId;
}): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_MISSING_BOUNDS_AUTHORITY");
  const ownerKey = `operation:${input.operationId}`;
  const rootCauseKey = "memory-bounds-authority";
  const stableDetail = "Memory access is missing required bounds authority.";
  return {
    severity: "error",
    code,
    messageTemplate: "Memory access operation {operationId} is missing bounds authority.",
    arguments: { operationId: input.operationId },
    ownerKey,
    rootCauseKey,
    stableDetail,
    originId: input.originId,
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(input.originId),
      functionKey: "",
      code,
      ownerKey,
      rootCauseKey,
      stableDetail,
    }),
  };
}

function checkedMemoryAccess(
  input: MemoryAccessInput,
  diagnosticInput: { readonly operationId: OptIrOperationId; readonly originId: OptIrOriginId },
):
  | { readonly kind: "ok"; readonly memoryAccess: OptIrMemoryAccessDescriptor }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] } {
  if (input.boundsAuthority === undefined) {
    return {
      kind: "error",
      diagnostics: sortOptIrDiagnostics([memoryDiagnostic(diagnosticInput)]),
    };
  }
  return {
    kind: "ok",
    memoryAccess: Object.freeze({
      region: input.region,
      byteOffset: input.byteOffset,
      byteWidth: input.byteWidth,
      alignment: input.alignment,
      valueType: input.valueType,
      endian: input.endian,
      volatility: input.volatility,
      ...(input.layoutPath !== undefined && { layoutPath: input.layoutPath }),
      boundsAuthority: input.boundsAuthority,
      ...(input.validatedBuffer === undefined
        ? {}
        : {
            validatedBuffer: Object.freeze({
              fieldName: input.validatedBuffer.fieldName,
              layoutPath: Object.freeze([...input.validatedBuffer.layoutPath]),
              readRequires: Object.freeze([...input.validatedBuffer.readRequires]),
              pathCertificates: Object.freeze([...input.validatedBuffer.pathCertificates]),
            }),
          }),
    }),
  };
}

export function optIrMemoryLoadOperation(
  input: {
    readonly operationId: OptIrOperationId;
    readonly resultId: OptIrValueId;
    readonly originId: OptIrOriginId;
  } & MemoryAccessInput,
): OptIrOperationConstructionResult {
  const access = checkedMemoryAccess(input, input);
  if (access.kind === "error") {
    return access;
  }
  return {
    kind: "ok",
    operation: operation(
      {
        kind: "memoryLoad",
        operationId: input.operationId,
        operandIds: [],
        resultIds: [input.resultId],
        resultTypes: [input.valueType],
        originId: input.originId,
      },
      { memoryAccess: access.memoryAccess },
    ) as OptIrOperation,
  };
}

export function optIrMemoryStoreOperation(
  input: {
    readonly operationId: OptIrOperationId;
    readonly storeValue: OptIrValueId;
    readonly originId: OptIrOriginId;
  } & MemoryAccessInput,
): OptIrOperationConstructionResult {
  const access = checkedMemoryAccess(input, input);
  if (access.kind === "error") {
    return access;
  }
  return {
    kind: "ok",
    operation: operation(
      {
        kind: "memoryStore",
        operationId: input.operationId,
        operandIds: [input.storeValue],
        resultIds: [],
        resultTypes: [],
        originId: input.originId,
      },
      { memoryAccess: access.memoryAccess, storeValue: input.storeValue },
    ) as OptIrOperation,
  };
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

export function optIrVectorLoadOperation(
  input: {
    readonly operationId: OptIrOperationId;
    readonly resultId: OptIrValueId;
    readonly resultType: OptIrType;
    readonly originId: OptIrOriginId;
  } & MemoryAccessInput,
): OptIrOperationConstructionResult {
  return vectorMemoryLoadOperation("vectorLoad", input);
}

export function optIrVectorMaskedLoadOperation(
  input: {
    readonly operationId: OptIrOperationId;
    readonly resultId: OptIrValueId;
    readonly resultType: OptIrType;
    readonly mask: OptIrValueId;
    readonly originId: OptIrOriginId;
  } & MemoryAccessInput,
): OptIrOperationConstructionResult {
  return vectorMemoryLoadOperation("vectorMaskedLoad", input);
}

function vectorMemoryLoadOperation(
  kind: "vectorLoad" | "vectorMaskedLoad",
  input: {
    readonly operationId: OptIrOperationId;
    readonly resultId: OptIrValueId;
    readonly resultType: OptIrType;
    readonly mask?: OptIrValueId;
    readonly originId: OptIrOriginId;
  } & MemoryAccessInput,
): OptIrOperationConstructionResult {
  const access = checkedMemoryAccess(input, input);
  if (access.kind === "error") {
    return access;
  }
  return {
    kind: "ok",
    operation: operation(
      {
        kind,
        operationId: input.operationId,
        operandIds: input.mask === undefined ? [] : [input.mask],
        resultIds: [input.resultId],
        resultTypes: [input.resultType],
        originId: input.originId,
      },
      {
        memoryAccess: access.memoryAccess,
        ...(input.mask !== undefined && { mask: input.mask }),
      },
    ) as OptIrOperation,
  };
}

export function optIrVectorStoreOperation(
  input: {
    readonly operationId: OptIrOperationId;
    readonly vector: OptIrValueId;
    readonly storeValue: OptIrValueId;
    readonly originId: OptIrOriginId;
  } & MemoryAccessInput,
): OptIrOperationConstructionResult {
  return vectorMemoryStoreOperation("vectorStore", input);
}

export function optIrVectorMaskedStoreOperation(
  input: {
    readonly operationId: OptIrOperationId;
    readonly vector: OptIrValueId;
    readonly storeValue: OptIrValueId;
    readonly mask: OptIrValueId;
    readonly originId: OptIrOriginId;
  } & MemoryAccessInput,
): OptIrOperationConstructionResult {
  return vectorMemoryStoreOperation("vectorMaskedStore", input);
}

function vectorMemoryStoreOperation(
  kind: "vectorStore" | "vectorMaskedStore",
  input: {
    readonly operationId: OptIrOperationId;
    readonly vector: OptIrValueId;
    readonly storeValue: OptIrValueId;
    readonly mask?: OptIrValueId;
    readonly originId: OptIrOriginId;
  } & MemoryAccessInput,
): OptIrOperationConstructionResult {
  const access = checkedMemoryAccess(input, input);
  if (access.kind === "error") {
    return access;
  }
  const operands =
    input.mask === undefined
      ? [input.vector, input.storeValue]
      : [input.vector, input.storeValue, input.mask];
  return {
    kind: "ok",
    operation: operation(
      {
        kind,
        operationId: input.operationId,
        operandIds: operands,
        resultIds: [],
        resultTypes: [],
        originId: input.originId,
      },
      {
        memoryAccess: access.memoryAccess,
        vector: input.vector,
        storeValue: input.storeValue,
        ...(input.mask !== undefined && { mask: input.mask }),
      },
    ) as OptIrOperation,
  };
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
