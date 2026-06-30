import { OPT_IR_EGRAPH_RULE_IDS } from "../egraph/rule-catalog";
import {
  isCollapsiblePlatformWrapper,
  isRemovableMoveCopyWrapper,
  operationMatchesPacketParserRuntimeKey,
} from "./wrela-operation-patterns";
import type { OptIrOperationId, OptIrValueId } from "../ids";
import {
  optIrMemoryLoadOperation,
  optIrProofErasedMarkerOperation,
  type OptIrEndian,
  type OptIrOperation,
} from "../operations";

export interface CatalogRewriteApplication {
  readonly operations: readonly OptIrOperation[];
  readonly removedOperationIds: readonly OptIrOperationId[];
  readonly addedOperationIds: readonly OptIrOperationId[];
  readonly valueForwards: ReadonlyArray<{
    readonly sourceValue: OptIrValueId;
    readonly replacementValue: OptIrValueId;
  }>;
}

export interface CatalogRewriteContext {
  readonly nextOperationId: () => OptIrOperationId;
}

export type CatalogRewriteHandler = (
  regionOperations: readonly OptIrOperation[],
  context: CatalogRewriteContext,
) => CatalogRewriteApplication | undefined;

export function catalogRewriteHandlerForRuleId(ruleId: string): CatalogRewriteHandler | undefined {
  return CATALOG_REWRITE_HANDLERS.get(ruleId);
}

export function createCatalogRewriteHandlers(): ReadonlyMap<string, CatalogRewriteHandler> {
  return CATALOG_REWRITE_HANDLERS;
}

export interface MoveCopyWrapperEliminationCandidate {
  readonly operationId: OptIrOperationId;
  readonly sourceValue: OptIrValueId;
  readonly resultValue: OptIrValueId;
}

export function eliminateMoveCopyWrapperOperations(
  operations: readonly OptIrOperation[],
  approvedCandidates?: readonly MoveCopyWrapperEliminationCandidate[],
): CatalogRewriteApplication | undefined {
  const approvedById = new Map(
    (approvedCandidates ?? []).map((candidate) => [candidate.operationId, candidate]),
  );
  const removed = new Set<OptIrOperationId>();
  const valueForwards: { sourceValue: OptIrValueId; replacementValue: OptIrValueId }[] = [];

  for (const operation of operations) {
    const approvedCandidate = approvedById.get(operation.operationId);
    if (approvedCandidates !== undefined) {
      if (approvedCandidate === undefined) {
        continue;
      }
      removed.add(operation.operationId);
      valueForwards.push({
        sourceValue: approvedCandidate.resultValue,
        replacementValue: approvedCandidate.sourceValue,
      });
      continue;
    }
    if (!isRemovableMoveCopyWrapper(operation)) {
      continue;
    }
    const sourceValue = operation.operandIds[0];
    const resultValue = operation.resultIds[0];
    if (sourceValue === undefined || resultValue === undefined) {
      continue;
    }
    removed.add(operation.operationId);
    valueForwards.push({ sourceValue: resultValue, replacementValue: sourceValue });
  }

  if (removed.size === 0) {
    return undefined;
  }

  return finalizeCatalogRewrite(
    operations.filter((operation) => !removed.has(operation.operationId)),
    removed,
    valueForwards,
  );
}

export function collapsePlatformWrapperOperations(
  operations: readonly OptIrOperation[],
): CatalogRewriteApplication | undefined {
  const removed = new Set<OptIrOperationId>();
  for (const operation of operations) {
    if (!isCollapsiblePlatformWrapper(operation)) {
      continue;
    }
    removed.add(operation.operationId);
  }
  if (removed.size === 0) {
    return undefined;
  }
  return finalizeCatalogRewrite(
    operations.filter((operation) => !removed.has(operation.operationId)),
    removed,
    [],
  );
}

export function collapseParserStateOperations(
  regionOperations: readonly OptIrOperation[],
): CatalogRewriteApplication | undefined {
  const parserStateIds = regionOperations
    .filter((operation) => operationMatchesPacketParserRuntimeKey(operation, "state"))
    .map((operation) => operation.operationId);
  if (parserStateIds.length === 0) {
    return undefined;
  }
  const aggregateIds = regionOperations
    .filter(
      (operation) =>
        operation.kind === "aggregateConstruct" || operation.kind === "aggregateExtract",
    )
    .map((operation) => operation.operationId);
  const removed = new Set<OptIrOperationId>([...parserStateIds, ...aggregateIds]);
  if (removed.size === 0) {
    return undefined;
  }
  return finalizeCatalogRewrite(
    regionOperations.filter((operation) => !removed.has(operation.operationId)),
    removed,
    [],
  );
}

const CATALOG_REWRITE_HANDLERS: ReadonlyMap<string, CatalogRewriteHandler> = new Map<
  string,
  CatalogRewriteHandler
>([
  [OPT_IR_EGRAPH_RULE_IDS[0], (regionOperations) => rewriteEndianLoadFolding(regionOperations)],
  [OPT_IR_EGRAPH_RULE_IDS[1], () => undefined],
  [
    OPT_IR_EGRAPH_RULE_IDS[2],
    (regionOperations) => eliminateMoveCopyWrapperOperations(regionOperations),
  ],
  [
    OPT_IR_EGRAPH_RULE_IDS[3],
    (regionOperations) => rewriteLayoutArithmeticFolding(regionOperations),
  ],
  [
    OPT_IR_EGRAPH_RULE_IDS[4],
    (regionOperations) => collapseParserStateOperations(regionOperations),
  ],
  [
    OPT_IR_EGRAPH_RULE_IDS[5],
    (regionOperations) => rewriteFieldDisjointMemoryCse(regionOperations),
  ],
  [
    OPT_IR_EGRAPH_RULE_IDS[6],
    (regionOperations) => collapsePlatformWrapperOperations(regionOperations),
  ],
  [
    OPT_IR_EGRAPH_RULE_IDS[7],
    (regionOperations, context) => rewriteVectorIdiomPreparation(regionOperations, context),
  ],
]);

function rewriteEndianLoadFolding(
  operations: readonly OptIrOperation[],
): CatalogRewriteApplication | undefined {
  const byResult = resultMap(operations);
  const removed = new Set<OptIrOperationId>();
  const valueForwards: { sourceValue: OptIrValueId; replacementValue: OptIrValueId }[] = [];
  const replacedLoads = new Map<OptIrOperationId, OptIrOperation>();

  for (const operation of operations) {
    if (operation.kind !== "layoutEndianDecode") {
      continue;
    }
    const load = byResult.get(operation.bytes);
    if (load === undefined || load.kind !== "memoryLoad") {
      continue;
    }
    removed.add(operation.operationId);
    valueForwards.push({
      sourceValue: operation.resultIds[0]!,
      replacementValue: load.resultIds[0]!,
    });
    if (operation.endian !== "native" && load.memoryAccess.endian !== operation.endian) {
      const folded = foldLoadEndian(load, operation.endian);
      if (folded !== undefined) {
        replacedLoads.set(load.operationId, folded);
      }
    }
  }

  if (removed.size === 0) {
    return undefined;
  }

  const rewritten: OptIrOperation[] = [];
  for (const operation of operations) {
    if (removed.has(operation.operationId)) {
      continue;
    }
    if (operation.kind === "memoryLoad" && replacedLoads.has(operation.operationId)) {
      rewritten.push(replacedLoads.get(operation.operationId)!);
      continue;
    }
    rewritten.push(operation);
  }

  return finalizeCatalogRewrite(rewritten, removed, valueForwards);
}

function rewriteLayoutArithmeticFolding(
  operations: readonly OptIrOperation[],
): CatalogRewriteApplication | undefined {
  const removed = new Set<OptIrOperationId>();
  const valueForwards: { sourceValue: OptIrValueId; replacementValue: OptIrValueId }[] = [];
  const rewritten = operations.map((operation) => {
    if (operation.kind !== "layoutByteRange") {
      return operation;
    }
    const offset = [...operations].find(
      (candidate) =>
        candidate.kind === "layoutOffset" &&
        candidate.resultIds[0] === operation.base &&
        candidate.layoutPath === operation.layoutPath,
    );
    if (offset === undefined) {
      return operation;
    }
    removed.add(offset.operationId);
    valueForwards.push({
      sourceValue: offset.resultIds[0]!,
      replacementValue: operation.resultIds[0]!,
    });
    return operation;
  });
  if (removed.size === 0) {
    return undefined;
  }
  return finalizeCatalogRewrite(rewritten, removed, valueForwards);
}

function rewriteFieldDisjointMemoryCse(
  operations: readonly OptIrOperation[],
): CatalogRewriteApplication | undefined {
  const seen = new Map<string, OptIrOperation>();
  const removed = new Set<OptIrOperationId>();
  const valueForwards: { sourceValue: OptIrValueId; replacementValue: OptIrValueId }[] = [];
  for (const operation of operations) {
    if (operation.kind !== "memoryLoad") {
      continue;
    }
    const key = memoryAccessKey(operation.memoryAccess);
    const previous = seen.get(key);
    if (previous === undefined) {
      seen.set(key, operation);
      continue;
    }
    removed.add(operation.operationId);
    valueForwards.push({
      sourceValue: operation.resultIds[0]!,
      replacementValue: previous.resultIds[0]!,
    });
  }
  if (removed.size === 0) {
    return undefined;
  }
  return finalizeCatalogRewrite(
    operations.filter((operation) => !removed.has(operation.operationId)),
    removed,
    valueForwards,
  );
}

function rewriteVectorIdiomPreparation(
  operations: readonly OptIrOperation[],
  context: CatalogRewriteContext,
): CatalogRewriteApplication | undefined {
  const loads = operations.filter((operation) => operation.kind === "memoryLoad");
  const compares = operations.filter((operation) => operation.kind === "integerCompare");
  if (loads.length < 2 || compares.length === 0) {
    return undefined;
  }
  const marker = optIrProofErasedMarkerOperation({
    operationId: context.nextOperationId(),
    erasedProof: "vector-idiom-prep",
    originId: operations[0]!.originId,
  });
  return finalizeCatalogRewrite(
    [...operations, marker],
    new Set(),
    [],
    new Set([marker.operationId]),
  );
}

function finalizeCatalogRewrite(
  operations: readonly OptIrOperation[],
  removedOperationIds: ReadonlySet<OptIrOperationId>,
  valueForwards: readonly {
    readonly sourceValue: OptIrValueId;
    readonly replacementValue: OptIrValueId;
  }[],
  addedOperationIds: ReadonlySet<OptIrOperationId> = new Set(),
): CatalogRewriteApplication {
  return Object.freeze({
    operations: Object.freeze(
      operations.filter((operation) => !removedOperationIds.has(operation.operationId)),
    ),
    removedOperationIds: Object.freeze([...removedOperationIds]),
    addedOperationIds: Object.freeze([...addedOperationIds]),
    valueForwards: Object.freeze(valueForwards.slice()),
  });
}

function resultMap(operations: readonly OptIrOperation[]): Map<OptIrValueId, OptIrOperation> {
  const map = new Map<OptIrValueId, OptIrOperation>();
  for (const operation of operations) {
    for (const resultId of operation.resultIds) {
      map.set(resultId, operation);
    }
  }
  return map;
}

function foldLoadEndian(
  load: Extract<OptIrOperation, { kind: "memoryLoad" }>,
  endian: OptIrEndian,
) {
  const result = optIrMemoryLoadOperation({
    operationId: load.operationId,
    resultId: load.resultIds[0]!,
    region: load.memoryAccess.region,
    byteOffset: load.memoryAccess.byteOffset,
    byteWidth: load.memoryAccess.byteWidth,
    alignment: load.memoryAccess.alignment,
    valueType: load.memoryAccess.valueType,
    endian,
    volatility: load.memoryAccess.volatility,
    layoutPath: load.memoryAccess.layoutPath,
    boundsAuthority: load.memoryAccess.boundsAuthority,
    originId: load.originId,
  });
  return result.kind === "ok" ? result.operation : undefined;
}

function memoryAccessKey(access: {
  readonly region: unknown;
  readonly byteOffset: bigint;
  readonly byteWidth: number;
  readonly endian: string;
}): string {
  return `${String(access.region)}:${access.byteOffset}:${access.byteWidth}:${access.endian}`;
}
