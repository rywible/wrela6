import { optIrOperationId, optIrValueId, type OptIrOperationId } from "../../ids";
import {
  optIrVectorLoadOperation,
  optIrVectorMaskedLoadOperation,
  optIrVectorMaskedStoreOperation,
  optIrVectorStoreOperation,
  type OptIrOperation,
} from "../../operations";
import type { RewriteInvariant } from "../pass-contract";
import { optIrVectorType } from "../../vector-types";
import {
  classifyLoopVectorizationShape,
  type OptIrLoopMemoryAccess,
  type OptIrLoopVectorTailPlan,
  type OptIrLoopVectorizationCandidate,
} from "./loop-shape";

export interface OptIrLoopVectorRewriteRecord {
  readonly loopId: string;
  readonly headerBlockId: OptIrLoopVectorizationCandidate["headerBlockId"];
  readonly scalarOperationIds: readonly OptIrOperationId[];
  readonly vectorOperationIds: readonly OptIrOperationId[];
  readonly tailPlan: OptIrLoopVectorTailPlan;
  readonly invariant: RewriteInvariant;
}

export interface RewriteLoopVectorizationResult {
  readonly vectorOperations: readonly OptIrOperation[];
  readonly rewriteRecords: readonly OptIrLoopVectorRewriteRecord[];
}

export function rewriteLoopVectorizationCandidates(
  candidates: readonly OptIrLoopVectorizationCandidate[],
): RewriteLoopVectorizationResult {
  const vectorOperations: OptIrOperation[] = [];
  const rewriteRecords: OptIrLoopVectorRewriteRecord[] = [];

  for (const candidate of candidates) {
    const shape = classifyLoopVectorizationShape(candidate);
    if (shape.kind !== "vectorizable") {
      continue;
    }
    let nextOperationId = candidate.nextOperationId;
    let nextValueId = candidate.nextValueId;
    const vectorOperationIds: OptIrOperationId[] = [];

    for (const access of candidate.memoryAccesses) {
      const operationId = optIrOperationId(nextOperationId);
      nextOperationId += 1;
      const operation = operationForAccess({
        candidate,
        access,
        operationId,
        nextValueId,
      });
      if (operation.resultIds.length > 0) {
        nextValueId += operation.resultIds.length;
      }
      vectorOperations.push(operation);
      vectorOperationIds.push(operation.operationId);
    }

    rewriteRecords.push({
      loopId: candidate.loopId,
      headerBlockId: candidate.headerBlockId,
      scalarOperationIds: Object.freeze([...candidate.scalarOperationIds]),
      vectorOperationIds: Object.freeze(vectorOperationIds),
      tailPlan: shape.tailPlan,
      invariant: {
        kind: "conjunction",
        invariants: [
          { kind: "vectorLaneEquivalence" },
          { kind: "noaliasMemoryEquivalence" },
          { kind: "effectBoundaryEquivalence" },
        ],
      },
    });
  }

  return {
    vectorOperations: Object.freeze(vectorOperations),
    rewriteRecords: Object.freeze(rewriteRecords),
  };
}

function operationForAccess(input: {
  readonly candidate: OptIrLoopVectorizationCandidate;
  readonly access: OptIrLoopMemoryAccess;
  readonly operationId: OptIrOperationId;
  readonly nextValueId: number;
}): OptIrOperation {
  const valueType = optIrVectorType(input.candidate.laneType, input.candidate.lanes);
  const common = {
    operationId: input.operationId,
    region: input.access.region,
    byteOffset: input.access.byteOffset,
    byteWidth: input.access.byteWidth,
    alignment: input.access.alignment,
    valueType,
    endian: "native" as const,
    volatility: "nonVolatile" as const,
    boundsAuthority: input.access.boundsAuthority,
    originId: input.candidate.originId,
  };
  const shape = classifyLoopVectorizationShape(input.candidate);
  if (shape.kind !== "vectorizable") {
    throw new Error("Cannot rewrite a scalar loop shape.");
  }
  const mask = shape.tailPlan.kind === "maskedTail" ? shape.tailPlan.maskValueId : undefined;

  if (input.access.kind === "load") {
    const resultId = optIrValueId(input.nextValueId);
    const result =
      mask === undefined
        ? optIrVectorLoadOperation({ ...common, resultId, resultType: valueType })
        : optIrVectorMaskedLoadOperation({ ...common, resultId, resultType: valueType, mask });
    return requireConstructedOperation(result);
  }

  const vector = requiredSource(input.access, 0);
  const storeValue = requiredSource(input.access, 1);
  const result =
    mask === undefined
      ? optIrVectorStoreOperation({ ...common, vector, storeValue })
      : optIrVectorMaskedStoreOperation({
          ...common,
          vector,
          storeValue,
          mask,
        });
  return requireConstructedOperation(result);
}

function requiredSource(access: OptIrLoopMemoryAccess, index: number) {
  const valueId = access.sourceValueIds[index];
  if (valueId === undefined) {
    throw new Error("Loop vector operation construction missing source values after legality.");
  }
  return valueId;
}

function requireConstructedOperation(
  result:
    | ReturnType<typeof optIrVectorLoadOperation>
    | ReturnType<typeof optIrVectorMaskedLoadOperation>
    | ReturnType<typeof optIrVectorStoreOperation>
    | ReturnType<typeof optIrVectorMaskedStoreOperation>,
): OptIrOperation {
  if (result.kind === "error") {
    throw new Error("Loop vector operation construction failed after legality.");
  }
  return result.operation;
}
