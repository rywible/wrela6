import { optIrOperationId, optIrValueId, type OptIrOperationId } from "../../ids";
import {
  optIrVectorLoadOperation,
  optIrVectorMaskedLoadOperation,
  type OptIrOperation,
} from "../../operations";
import type { RewriteInvariant } from "../pass-contract";
import { optIrVectorType } from "../../vector-types";
import {
  classifyLoopVectorizationShape,
  type OptIrLoopLoadMemoryAccess,
  type OptIrLoopLoadPackCandidate,
  type OptIrLoopVectorTailPlan,
} from "./loop-shape";

export interface OptIrLoopVectorRewriteRecord {
  readonly loopId: string;
  readonly headerBlockId: OptIrLoopLoadPackCandidate["headerBlockId"];
  readonly bodyBlockIds: readonly OptIrLoopLoadPackCandidate["bodyBlockIds"][number][];
  readonly scalarOperationIds: readonly OptIrOperationId[];
  readonly vectorOperationIds: readonly OptIrOperationId[];
  readonly memoryScalarVectorPairs: readonly {
    readonly scalarOperationId: OptIrOperationId;
    readonly vectorOperationId: OptIrOperationId;
  }[];
  readonly vectorIterationCount: number;
  readonly tailPlan: OptIrLoopVectorTailPlan;
  readonly invariant: RewriteInvariant;
}

export interface RewriteLoopVectorizationResult {
  readonly vectorOperations: readonly OptIrOperation[];
  readonly rewriteRecords: readonly OptIrLoopVectorRewriteRecord[];
}

export function rewriteLoopVectorizationCandidates(
  candidates: readonly OptIrLoopLoadPackCandidate[],
): RewriteLoopVectorizationResult {
  const vectorOperations: OptIrOperation[] = [];
  const rewriteRecords: OptIrLoopVectorRewriteRecord[] = [];
  let nextOperationId = 0;
  let nextValueId = 0;

  for (const candidate of candidates) {
    const shape = classifyLoopVectorizationShape(candidate);
    if (shape.kind !== "vectorizable") {
      continue;
    }
    nextOperationId = Math.max(nextOperationId, candidate.nextOperationId);
    nextValueId = Math.max(nextValueId, candidate.nextValueId);
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
      bodyBlockIds: Object.freeze([...candidate.bodyBlockIds]),
      scalarOperationIds: Object.freeze([...candidate.scalarOperationIds]),
      vectorOperationIds: Object.freeze(vectorOperationIds),
      memoryScalarVectorPairs: Object.freeze(
        candidate.memoryAccesses.map((access, index) =>
          Object.freeze({
            scalarOperationId: access.operationId,
            vectorOperationId: vectorOperationIds[index]!,
          }),
        ),
      ),
      vectorIterationCount: shape.vectorIterationCount,
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
  readonly candidate: OptIrLoopLoadPackCandidate;
  readonly access: OptIrLoopLoadMemoryAccess;
  readonly operationId: OptIrOperationId;
  readonly nextValueId: number;
}): OptIrOperation {
  const valueType = optIrVectorType(input.candidate.laneType, input.candidate.lanes);
  const common = {
    operationId: input.operationId,
    region: input.access.region,
    byteOffset: input.access.byteOffset,
    byteWidth: input.access.vectorByteWidth,
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
  const resultId = optIrValueId(input.nextValueId);
  const result =
    mask === undefined
      ? optIrVectorLoadOperation({ ...common, resultId, resultType: valueType })
      : optIrVectorMaskedLoadOperation({ ...common, resultId, resultType: valueType, mask });
  return requireConstructedOperation(result);
}

function requireConstructedOperation(
  result:
    | ReturnType<typeof optIrVectorLoadOperation>
    | ReturnType<typeof optIrVectorMaskedLoadOperation>,
): OptIrOperation {
  if (result.kind === "error") {
    throw new Error("Loop vector operation construction failed after legality.");
  }
  return result.operation;
}
