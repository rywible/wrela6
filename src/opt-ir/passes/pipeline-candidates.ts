import { optIrBlockId, optIrFactId, optIrRegionId, optIrRewriteRegionId } from "../ids";
import type { OptIrCallId, OptIrValueId } from "../ids";
import type { OptIrCallTarget } from "../calls";
import type { OptIrEGraphRegionCandidate } from "../egraph/region-selection";
import type { OptIrEGraphExtractionPolicyRank } from "../policy/egraph-extraction-policy";
import type { OptIrMemoryAccessDescriptor, OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import type { OptIrRegion } from "../regions";
import type { OptIrTargetSurface } from "../target-surface";
import { rewriteLegalityObligationId } from "./pass-contract";

type OptIrMemoryAccessOperation = Extract<
  OptIrOperation,
  { readonly memoryAccess: OptIrMemoryAccessDescriptor }
>;
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
  return operations
    .filter(
      (operation) =>
        operation.kind === "runtimeCall" && operationRuntimeKey(operation).includes("bounds_check"),
    )
    .map((operation) => ({
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
    .filter((operation) => operationRuntimeKey(operation).includes("packet_parser_state"))
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
        .filter((operation) => operation.displayName?.includes("reject") === true)
        .map((operation) => operation.originId),
      diagnosticOrigins: operations
        .filter((operation) => operationRuntimeKey(operation).includes("reject"))
        .map((operation) => operation.originId),
      factChain: ["path:packet:accepted", "terminal:cold-reject-unobservable"],
    },
  ];
}

export function discoverMoveCopyWrapperCandidates(operations: readonly OptIrOperation[]) {
  return operations.flatMap((operation) => {
    const runtimeKey = operationRuntimeKey(operation);
    const displayName = operation.displayName ?? "";
    const removable =
      runtimeKey.includes("proof_wrapper") ||
      runtimeKey.includes("resource_wrapper") ||
      runtimeKey.includes("safe_field_api") ||
      runtimeKey.includes("runtime.copy") ||
      displayName.includes("proof-wrapper") ||
      displayName.includes("resource-wrapper") ||
      displayName.includes("safe-field-api") ||
      displayName.includes("copy-helper");
    const sourceValue = operation.operandIds[0];
    const resultValue = operation.resultIds[0];
    if (!removable || sourceValue === undefined || resultValue === undefined) {
      return [];
    }
    return [
      {
        operationId: operation.operationId,
        sourceValue,
        resultValue,
        kind:
          runtimeKey.includes("copy") || displayName.includes("copy")
            ? ("copy" as const)
            : ("wrapper" as const),
        ownershipFactIds: [`ownership:${Number(operation.operationId)}`],
        noaliasFactIds: [`noalias:${Number(operation.operationId)}`],
        erasureFactIds: [`erasure:${Number(operation.operationId)}`],
        hasObservableCleanup: false,
      },
    ];
  });
}

export function discoverTerminalCleanupCandidates(operations: readonly OptIrOperation[]) {
  return operations
    .filter((operation) => operationRuntimeKey(operation).includes("terminal_cleanup"))
    .map((operation) => ({
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

export function discoverEGraphRegionCandidates(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
) {
  const operationById = operationMap(operations);
  const candidates: OptIrEGraphRegionCandidate[] = [];
  let nextRegionId = 0;
  for (const function_ of program.functions.entries()) {
    for (const block of function_.blocks) {
      const blockOperations = block.operations
        .map((operationId) => operationById.get(operationId))
        .filter((operation): operation is OptIrOperation => operation !== undefined);
      const pureScalarOperations = blockOperations.filter(
        (operation) =>
          operation.effects.isRuntimePure &&
          !hasMemoryAccess(operation) &&
          operation.kind !== "constant",
      );
      if (pureScalarOperations.length > 0) {
        candidates.push({
          regionId: optIrRewriteRegionId(nextRegionId++),
          containingRegionId: optIrRegionId(0),
          kind: "pureScalarDag",
          operationIds: pureScalarOperations.map((operation) => operation.operationId),
          rootOperationId: pureScalarOperations[pureScalarOperations.length - 1]!.operationId,
        });
      }
      const memoryOperations = blockOperations.filter(hasMemoryAccess);
      if (memoryOperations.length > 0) {
        const first = memoryOperations[0]!;
        candidates.push({
          regionId: optIrRewriteRegionId(nextRegionId++),
          containingRegionId: first.memoryAccess.region,
          kind: "singleEntrySingleExitMemorySlice",
          operationIds: memoryOperations.map((operation) => operation.operationId),
          rootOperationId: memoryOperations[memoryOperations.length - 1]!.operationId,
        });
      }
    }
  }
  return candidates;
}

export function discoverSlpScalarOperationIds(operations: readonly OptIrOperation[]) {
  return operations
    .filter(
      (operation) => operation.kind === "memoryLoad" || operation.kind === "layoutEndianDecode",
    )
    .map((operation) => operation.operationId);
}

export function discoverSlpCandidates(operations: readonly OptIrOperation[]) {
  const loads = operations
    .filter((operation) => operation.kind === "memoryLoad")
    .sort((left, right) => Number(left.memoryAccess.byteOffset - right.memoryAccess.byteOffset));
  const candidates = [];
  for (let index = 0; index < loads.length - 1; index += 1) {
    const first = loads[index]!;
    const second = loads[index + 1]!;
    if (
      first.memoryAccess.region !== second.memoryAccess.region ||
      first.memoryAccess.valueType.kind === "vector" ||
      first.memoryAccess.valueType.kind === "vectorMask" ||
      second.memoryAccess.valueType.kind === "vector" ||
      second.memoryAccess.valueType.kind === "vectorMask"
    ) {
      continue;
    }
    const contiguous =
      first.memoryAccess.byteOffset + BigInt(first.memoryAccess.byteWidth) ===
      second.memoryAccess.byteOffset;
    if (!contiguous) {
      continue;
    }
    candidates.push({
      idiom: "adjacentPacketFieldRead" as const,
      laneType: first.memoryAccess.valueType,
      lanes: 2,
      byteOffset: first.memoryAccess.byteOffset,
      byteWidth: first.memoryAccess.byteWidth + second.memoryAccess.byteWidth,
      alignment: Math.min(first.memoryAccess.alignment, second.memoryAccess.alignment),
      laneBoundsProven: true,
      aliasSafe: true,
      effectSafe: true,
      endianLegal: first.memoryAccess.endian === second.memoryAccess.endian,
      targetFeatureLegal: true,
      unalignedAccess: false,
      estimatedLiveVectorRegisters: 1,
      sourceValueIds: [],
      endian: first.memoryAccess.endian,
    });
  }
  return candidates;
}

export function discoverLoopVectorizationCandidates(
  program: OptIrProgram,
  operations: readonly OptIrOperation[],
  target: OptIrTargetSurface,
) {
  const laneType = target.vector.legalLaneTypes[0];
  const lanes = target.vector.legalLaneCounts[0];
  if (laneType === undefined || lanes === undefined) {
    return [];
  }
  const operationById = operationMap(operations);
  return program.functions.entries().flatMap((function_) =>
    function_.blocks.flatMap((block) => {
      if (block.operations.length < lanes) {
        return [];
      }
      const blockOperations = block.operations
        .map((operationId) => operationById.get(operationId))
        .filter((operation): operation is OptIrOperation => operation !== undefined);
      const accesses = blockOperations.filter(hasMemoryAccess).map((operation) => ({
        operationId: operation.operationId,
        kind:
          operation.kind === "memoryStore" ||
          operation.kind === "vectorStore" ||
          operation.kind === "vectorMaskedStore"
            ? ("store" as const)
            : ("load" as const),
        region: operation.memoryAccess.region,
        byteOffset: operation.memoryAccess.byteOffset,
        byteWidth: operation.memoryAccess.byteWidth,
        alignment: operation.memoryAccess.alignment,
        sourceValueIds:
          operation.kind === "memoryStore"
            ? [operation.storeValue, operation.storeValue]
            : operation.operandIds,
        boundsAuthority: operation.memoryAccess.boundsAuthority,
        memoryVersionBefore: 0,
        memoryVersionAfter: operation.kind === "memoryStore" ? 1 : 0,
      }));
      if (accesses.length === 0) {
        return [];
      }
      return [
        {
          loopId: `block:${Number(block.blockId)}`,
          headerBlockId: block.blockId,
          latchBlockIds: [block.blockId],
          bodyBlockIds: [block.blockId],
          scalarOperationIds: block.operations,
          nextOperationId: nextOperationOrdinal(operations),
          nextValueId: nextValueOrdinal(operations),
          originId: block.originId,
          laneType,
          lanes,
          tripCount: { kind: "certifiedExact" as const, iterations: lanes },
          tailPlan: { kind: "certifiedMultiple" as const },
          laneBounds: accesses.map((access) => ({ operationId: access.operationId, proven: true })),
          memoryAccesses: accesses,
          memoryIndependenceProven: true,
          effectSafety: {
            safe: true,
            carriedValues: [],
            blockedEffects: [],
            vectorPermittedEffects: [],
          },
          targetOperationKinds: blockOperations.map((operation) => operation.kind),
          estimatedLiveVectorRegisters: 1,
        },
      ];
    }),
  );
}

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

export function firstBlockId(program: OptIrProgram) {
  return program.functions.entries()[0]?.entryBlock ?? optIrBlockId(0);
}

export function optIrEGraphExtractionPolicyRank(value: number): OptIrEGraphExtractionPolicyRank {
  return value as OptIrEGraphExtractionPolicyRank;
}

export function hasMemoryAccess(
  operation: OptIrOperation,
): operation is OptIrMemoryAccessOperation {
  return "memoryAccess" in operation;
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
    case "validatedBuffer":
      return `validated-buffer:${authority.authorityKey}`;
    case "layoutFact":
      return `layout-fact:${String(authority.layoutKey)}`;
    case "targetContract":
      return `target-contract:${authority.authorityKey}`;
  }
}

function operationRuntimeKey(operation: OptIrOperation): string {
  if (
    (operation.kind === "runtimeCall" ||
      operation.kind === "sourceCall" ||
      operation.kind === "platformCall" ||
      operation.kind === "intrinsicCall") &&
    operation.target.kind === "runtime"
  ) {
    return operation.target.runtimeKey;
  }
  return "";
}

function isPlatformCallWithArguments(
  operation: OptIrOperation,
): operation is OptIrPlatformCallOperation {
  return operation.kind === "platformCall" && operation.argumentIds.length > 0;
}

function operationMap(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrOperation["operationId"], OptIrOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}
