import {
  optIrBlockId,
  optIrEdgeId,
  optIrFunctionId,
  type OptIrBlockId,
  type OptIrEdgeId,
  type OptIrFunctionId,
  type OptIrOperationId,
  type OptIrOriginId,
  type OptIrValueId,
} from "./ids";
import type { OptIrBlockParameter } from "./values";
import type { OptIrTerminator } from "./terminators";
import type { MonoInstanceId } from "../mono/ids";

export type OptIrEdgeKind =
  | "normal"
  | "branchTrue"
  | "branchFalse"
  | "switchCase"
  | "validationOk"
  | "validationErr"
  | "attemptSuccess"
  | "attemptError"
  | "scopeBreak"
  | "scopeContinue"
  | "yieldSuspend"
  | "yieldResume"
  | "returnExit"
  | "panicExit";

export interface OptIrEdge {
  readonly edgeId: OptIrEdgeId;
  readonly from: OptIrBlockId;
  readonly toBlock?: OptIrBlockId;
  readonly ordinal: number;
  readonly kind: OptIrEdgeKind;
  readonly arguments: readonly OptIrValueId[];
  readonly condition?: OptIrValueId;
  readonly switchCase?: string;
  readonly originId: OptIrOriginId;
}

export interface OptIrBlock {
  readonly blockId: OptIrBlockId;
  readonly parameters: readonly OptIrBlockParameter[];
  readonly operations: readonly OptIrOperationId[];
  readonly terminator?: OptIrTerminator;
  readonly originId: OptIrOriginId;
}

export interface OptIrCfgEdgeTable {
  readonly get: (edgeId: OptIrEdgeId) => OptIrEdge | undefined;
  readonly has: (edgeId: OptIrEdgeId) => boolean;
  readonly entries: () => readonly OptIrEdge[];
}

export function optIrCfgEdgeTable(edges: readonly OptIrEdge[]): OptIrCfgEdgeTable {
  const entries = [...edges].sort((left, right) => left.edgeId - right.edgeId);
  const byId = new Map<OptIrEdgeId, OptIrEdge>();
  for (const [index, edge] of edges.entries()) {
    if (byId.has(edge.edgeId)) {
      throw new RangeError(`Duplicate OptIR edge id ${String(edge.edgeId)} at edges[${index}].`);
    }
    byId.set(edge.edgeId, edge);
  }

  return {
    get(edgeId) {
      return byId.get(edgeId);
    },
    has(edgeId) {
      return byId.has(edgeId);
    },
    entries() {
      return entries.slice();
    },
  };
}

export interface OptIrConstructionIdAllocatorInput<BlockKey = number, EdgeKey = number> {
  readonly functionsInTraversalOrder: readonly MonoInstanceId[];
  readonly blocksInTraversalOrder: ReadonlyMap<MonoInstanceId, readonly BlockKey[]>;
  readonly edgesInTraversalOrder: ReadonlyMap<MonoInstanceId, readonly EdgeKey[]>;
}

export interface OptIrConstructionIdAllocator<BlockKey = number, EdgeKey = number> {
  readonly functionIdFor: (functionInstanceId: MonoInstanceId) => OptIrFunctionId;
  readonly blockIdFor: (functionInstanceId: MonoInstanceId, blockKey: BlockKey) => OptIrBlockId;
  readonly edgeIdFor: (functionInstanceId: MonoInstanceId, edgeKey: EdgeKey) => OptIrEdgeId;
}

export function optIrConstructionIdAllocator<BlockKey = number, EdgeKey = number>(
  input: OptIrConstructionIdAllocatorInput<BlockKey, EdgeKey>,
): OptIrConstructionIdAllocator<BlockKey, EdgeKey> {
  const functionIds = new Map<MonoInstanceId, OptIrFunctionId>();
  input.functionsInTraversalOrder.forEach((functionInstanceId, index) => {
    functionIds.set(functionInstanceId, optIrFunctionId(index));
  });

  const blockIds = new Map<string, OptIrBlockId>();
  let nextBlockId = 0;
  for (const functionInstanceId of input.functionsInTraversalOrder) {
    for (const blockKey of input.blocksInTraversalOrder.get(functionInstanceId) ?? []) {
      blockIds.set(scopedKey(functionInstanceId, blockKey), optIrBlockId(nextBlockId));
      nextBlockId += 1;
    }
  }

  const edgeIds = new Map<string, OptIrEdgeId>();
  let nextEdgeId = 0;
  for (const functionInstanceId of input.functionsInTraversalOrder) {
    for (const edgeKey of input.edgesInTraversalOrder.get(functionInstanceId) ?? []) {
      edgeIds.set(scopedKey(functionInstanceId, edgeKey), optIrEdgeId(nextEdgeId));
      nextEdgeId += 1;
    }
  }

  return {
    functionIdFor(functionInstanceId) {
      return requireId(functionIds.get(functionInstanceId), `function:${functionInstanceId}`);
    },
    blockIdFor(functionInstanceId, blockKey) {
      return requireId(blockIds.get(scopedKey(functionInstanceId, blockKey)), `block:${blockKey}`);
    },
    edgeIdFor(functionInstanceId, edgeKey) {
      return requireId(edgeIds.get(scopedKey(functionInstanceId, edgeKey)), `edge:${edgeKey}`);
    },
  };
}

function scopedKey(functionInstanceId: MonoInstanceId, localKey: unknown): string {
  return `${functionInstanceId}/${String(localKey)}`;
}

function requireId<AllocatedId>(allocatedId: AllocatedId | undefined, label: string): AllocatedId {
  if (allocatedId === undefined) {
    throw new RangeError(`No OptIR construction ID allocated for ${label}.`);
  }
  return allocatedId;
}
