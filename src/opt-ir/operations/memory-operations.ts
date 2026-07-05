import type { LayoutFactKey } from "../../proof-check/model/fact-packet";
import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
} from "../diagnostics";
import type {
  OptIrEdgeId,
  OptIrFactId,
  OptIrOperationId,
  OptIrOriginId,
  OptIrPathCertificateId,
  OptIrRegionId,
  OptIrValueId,
} from "../ids";
import type { RewriteLegalityObligationId } from "../passes/pass-contract";
import type { OptIrRegionVolatility } from "../regions";
import type { OptIrType } from "../types";
import {
  defineOptIrOperation,
  type OptIrOperation,
  type OptIrOperationBase,
  type OptIrOperationConstructionResult,
} from "../operations.ts";

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

function operation<Kind extends OptIrMemoryOperation["kind"], Extra extends object>(
  input: Parameters<typeof defineOptIrOperation<Kind>>[0],
  extra: Extra,
): OptIrOperationBase<Kind> & Extra {
  const base = defineOptIrOperation(input);
  const { attributes: _attributes, ...withoutAttributes } = base;
  void _attributes;
  return Object.freeze({ ...withoutAttributes, ...extra });
}

export type OptIrMemoryOperation =
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
  | (OptIrOperationBase<"vectorLoad" | "vectorMaskedLoad"> & {
      readonly memoryAccess: OptIrMemoryAccessDescriptor;
      readonly mask?: OptIrValueId;
    })
  | (OptIrOperationBase<"vectorStore" | "vectorMaskedStore"> & {
      readonly memoryAccess: OptIrMemoryAccessDescriptor;
      readonly vector: OptIrValueId;
      readonly storeValue: OptIrValueId;
      readonly mask?: OptIrValueId;
    });

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
    readonly baseValueId?: OptIrValueId;
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
        operandIds: input.baseValueId === undefined ? [] : [input.baseValueId],
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
