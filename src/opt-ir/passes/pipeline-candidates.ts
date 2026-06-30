import { optIrBlockId, optIrFactId, optIrOperationId, optIrValueId } from "../ids";
import type { OptIrCallId, OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrCallTarget } from "../calls";
import { hasMemoryAccess } from "../operation-access";
import type { OptIrMemoryAccessDescriptor, OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import type { OptIrRegion } from "../regions";
import {
  classifyMoveCopyWrapper,
  isBoundsCheckRuntimeOperation,
  isTerminalCleanupRuntimeOperation,
  operationHasRejectDisplayName,
  operationMatchesPacketParserRuntimeKey,
  operationMatchesRejectRuntimeKey,
} from "../rewrites/wrela-operation-patterns";
import { rewriteLegalityObligationId } from "./pass-contract";
type OptIrPlatformCallOperation = OptIrOperation & {
  readonly kind: "platformCall";
  readonly callId: OptIrCallId;
  readonly target: OptIrCallTarget;
  readonly argumentIds: readonly OptIrValueId[];
};

export function discoverScalarReplacementCandidates(
  operations: readonly OptIrOperation[],
  regions: readonly OptIrRegion[],
) {
  return regions.flatMap((region) => {
    const accesses = operations
      .filter(hasMemoryAccess)
      .filter((operation) => operation.memoryAccess.region === region.regionId);
    if (accesses.length === 0) {
      return [];
    }
    const fields = uniqueRanges(
      accesses.map((operation) => ({
        byteOffset: operation.memoryAccess.byteOffset,
        byteWidth: operation.memoryAccess.byteWidth,
      })),
    );
    const totalByteWidth = fields.reduce(
      (maximum, field) => Math.max(maximum, Number(field.byteOffset) + field.byteWidth),
      0,
    );
    if (totalByteWidth <= 0) {
      return [];
    }
    return [
      {
        regionId: region.regionId,
        totalByteWidth,
        fields,
        cleanupEffectsAccounted: true,
      },
    ];
  });
}

export function discoverBoundsCandidates(operations: readonly OptIrOperation[]) {
  const accesses = operations.filter(hasMemoryAccess);
  return operations.filter(isBoundsCheckRuntimeOperation).map((operation) => ({
    checkOperationId: operation.operationId,
    affectedAccessOperationIds: accesses.map((access) => access.operationId),
    licensingFactId: optIrFactId(Number(operation.operationId)),
    obligationId: rewriteLegalityObligationId(`wrela-bounds:${Number(operation.operationId)}`),
    factChain: ["validated-buffer:dominating-bounds", ...accesses.flatMap(factChainForAccess)],
  }));
}

export function discoverZeroCopyAccesses(operations: readonly OptIrOperation[]) {
  return operations
    .filter(hasMemoryAccess)
    .filter((operation) => operation.memoryAccess.volatility === "nonVolatile")
    .map((operation) => operation.operationId);
}

export function discoverEndianFoldCandidates(operations: readonly OptIrOperation[]) {
  return operations
    .filter((operation) => operation.kind === "layoutEndianDecode")
    .map((operation) => ({
      operationId: operation.operationId,
      endian: operation.endian,
      regionKind: "normal" as const,
      volatility: "nonVolatile" as const,
      factChain: [`layout:endian:${operation.endian}`, "target:endian-fold"],
    }));
}

export function discoverParserCollapseCandidates(operations: readonly OptIrOperation[]) {
  const parserStateOperationIds = operations
    .filter((operation) => operationMatchesPacketParserRuntimeKey(operation, "state"))
    .map((operation) => operation.operationId);
  const directLoadOperationIds = operations
    .filter((operation) => operation.kind === "memoryLoad")
    .map((operation) => operation.operationId);
  if (parserStateOperationIds.length === 0 || directLoadOperationIds.length === 0) {
    return [];
  }
  return [
    {
      parserStateOperationIds,
      directLoadOperationIds,
      coldRejectionOrigins: operations
        .filter((operation) => operationHasRejectDisplayName(operation))
        .map((operation) => operation.originId),
      diagnosticOrigins: operations
        .filter((operation) => operationMatchesRejectRuntimeKey(operation))
        .map((operation) => operation.originId),
      factChain: ["path:packet:accepted", "terminal:cold-reject-unobservable"],
    },
  ];
}

export function discoverMoveCopyWrapperCandidates(operations: readonly OptIrOperation[]) {
  return operations.flatMap((operation) => {
    const kind = classifyMoveCopyWrapper(operation);
    const sourceValue = operation.operandIds[0];
    const resultValue = operation.resultIds[0];
    if (kind === undefined || sourceValue === undefined || resultValue === undefined) {
      return [];
    }
    return [
      {
        operationId: operation.operationId,
        sourceValue,
        resultValue,
        kind,
        ownershipFactIds: [`ownership:${Number(operation.operationId)}`],
        noaliasFactIds: [`noalias:${Number(operation.operationId)}`],
        erasureFactIds: [`erasure:${Number(operation.operationId)}`],
        hasObservableCleanup: false,
      },
    ];
  });
}

export function discoverTerminalCleanupCandidates(operations: readonly OptIrOperation[]) {
  return operations.filter(isTerminalCleanupRuntimeOperation).map((operation) => ({
    operationId: operation.operationId,
    observable: operation.displayName?.includes("observable") === true,
    platformOrRuntimeCleanup: false,
    factChain: ["terminal:cleanup-unobservable"],
  }));
}

export function discoverPlatformSpecializationCandidates(operations: readonly OptIrOperation[]) {
  return operations.filter(isPlatformCallWithArguments).map((operation) => ({
    operationId: operation.operationId,
    constantArgumentFactIds: operation.argumentIds.map(
      (argumentId) => `constant:${Number(argumentId)}`,
    ),
    abiFactIds: [`abi:${Number(operation.callId)}`],
    targetCatalogEquivalent: true,
    specializedTargetKey:
      operation.target.kind === "platform"
        ? `${operation.target.platformKey}:specialized`
        : "platform:specialized",
  }));
}

export { discoverLoopVectorizationCandidates, discoverSlpCandidates } from "./vector-discovery";

export function nextOperationOrdinal(operations: readonly OptIrOperation[]): number {
  return (
    operations.reduce((maximum, operation) => Math.max(maximum, Number(operation.operationId)), 0) +
    1
  );
}

export function nextValueOrdinal(operations: readonly OptIrOperation[]): number {
  return (
    operations.reduce(
      (maximum, operation) =>
        Math.max(maximum, ...operation.operandIds.map(Number), ...operation.resultIds.map(Number)),
      0,
    ) + 1
  );
}

export function createOptIrIdAllocator(
  operations: readonly OptIrOperation[],
  extraOperations: readonly OptIrOperation[] = [],
): {
  readonly nextOperationId: () => OptIrOperationId;
  readonly nextValueId: () => OptIrValueId;
} {
  const combined = [...operations, ...extraOperations];
  let nextOperation = nextOperationOrdinal(combined);
  let nextValue = nextValueOrdinal(combined);
  return {
    nextOperationId: () => {
      const operationId = optIrOperationId(nextOperation);
      nextOperation += 1;
      return operationId;
    },
    nextValueId: () => {
      const valueId = optIrValueId(nextValue);
      nextValue += 1;
      return valueId;
    },
  };
}

export function firstBlockId(program: OptIrProgram) {
  return program.functions.entries()[0]?.entryBlock ?? optIrBlockId(0);
}

function uniqueRanges(
  ranges: readonly { readonly byteOffset: bigint; readonly byteWidth: number }[],
) {
  const byKey = new Map<string, { readonly byteOffset: bigint; readonly byteWidth: number }>();
  for (const range of ranges) {
    byKey.set(`${range.byteOffset}:${range.byteWidth}`, range);
  }
  return [...byKey.values()].sort((left, right) => Number(left.byteOffset - right.byteOffset));
}

function factChainForAccess(operation: OptIrOperation): readonly string[] {
  if (!hasMemoryAccess(operation)) {
    return [];
  }
  const access = operation.memoryAccess;
  return [
    ...(access.layoutPath === undefined ? [] : [`layout:${String(access.layoutPath)}`]),
    boundsAuthorityFact(access.boundsAuthority),
  ];
}

function boundsAuthorityFact(authority: OptIrMemoryAccessDescriptor["boundsAuthority"]): string {
  switch (authority.kind) {
    case "certifiedFact":
      return `certified-fact:${authority.factId}`;
    case "passDerivedFact":
      return `pass-derived:${authority.factId}:${authority.obligationId}`;
    case "runtimeGuard":
      return `runtime-guard:${authority.guard.guardOperation}`;
    case "constructionSize":
      return "construction-size";
    case "layoutFact":
      return `layout-fact:${String(authority.layoutKey)}`;
    case "targetContract":
      return `target-contract:${authority.authorityKey}`;
  }
}

function isPlatformCallWithArguments(
  operation: OptIrOperation,
): operation is OptIrPlatformCallOperation {
  return operation.kind === "platformCall" && operation.argumentIds.length > 0;
}
