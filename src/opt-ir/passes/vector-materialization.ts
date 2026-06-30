import type { OptIrDiagnostic } from "../diagnostics";
import { type OptIrBlockId, type OptIrOperationId, type OptIrValueId } from "../ids";
import { createOptIrIdAllocator } from "./pipeline-candidates";
import { optIrVectorShuffleOperation, type OptIrOperation } from "../operations";
import type { OptIrProgram } from "../program";
import type { RunLoopVectorizationResult } from "./loop-vectorization";
import {
  applyOptIrOperationRewrites,
  type OptIrBlockOperationRewrite,
  type OptIrValueForward,
} from "./rewrite-materialization";
import type { RunSlpVectorizationResult } from "./slp-vectorization";
import { pipelineInfoDiagnostic } from "./pipeline-diagnostics";
import { blockContainingOperation } from "./pipeline-state";
import { optIrTypesEqual } from "../types";

export interface VectorMaterializationResult {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly valueForwards: readonly OptIrValueForward[];
  readonly removedOperationIds: readonly OptIrOperationId[];
  readonly diagnostics: readonly OptIrDiagnostic[];
}

export interface MaterializeSlpVectorizationInput {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly slpResult: RunSlpVectorizationResult;
}

interface VectorReplacementPack {
  readonly blockId: OptIrBlockId;
  readonly anchorOperationId: OptIrOperationId;
  readonly vectorOperation: OptIrOperation;
  readonly scalarOperationIds: readonly OptIrOperationId[];
  readonly diagnosticGroupId?: string;
}

interface VectorReplacementPackMaterializationResult {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly valueForwards: readonly OptIrValueForward[];
  readonly removedOperationIds: readonly OptIrOperationId[];
  readonly materializedPacks: readonly VectorReplacementPack[];
}

export function materializeSlpVectorization(
  input: MaterializeSlpVectorizationInput,
): VectorMaterializationResult {
  const vectorById = new Map(
    input.slpResult.vectorOperations.map((operation) => [operation.operationId, operation]),
  );
  const packs = input.slpResult.rewriteRecords.flatMap(
    (record): readonly VectorReplacementPack[] => {
      const vectorOperation = vectorById.get(record.vectorOperationId);
      if (vectorOperation === undefined) {
        return [];
      }
      return [
        Object.freeze({
          blockId: record.blockId,
          anchorOperationId: record.anchorOperationId,
          vectorOperation,
          scalarOperationIds: record.scalarOperationIds,
        }),
      ];
    },
  );
  const materialized = materializeVectorReplacementPacks({
    program: input.program,
    operations: input.operations,
    vectorOperations: input.slpResult.vectorOperations,
    packs,
  });

  return {
    program: materialized.program,
    operations: materialized.operations,
    valueForwards: materialized.valueForwards,
    removedOperationIds: materialized.removedOperationIds,
    diagnostics: Object.freeze(
      materialized.materializedPacks.map((pack) =>
        pipelineInfoDiagnostic(
          "opt-ir-optimization",
          "slp-vectorization",
          `slp-vectorization:materialized:${Number(pack.vectorOperation.operationId)}:${pack.scalarOperationIds.map(Number).join(",")}`,
        ),
      ),
    ),
  };
}

export interface MaterializeLoopVectorizationInput {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly loopResult: RunLoopVectorizationResult;
}

export function materializeLoopVectorization(
  input: MaterializeLoopVectorizationInput,
): VectorMaterializationResult {
  const operationById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  const vectorById = new Map(
    input.loopResult.vectorOperations.map((operation) => [operation.operationId, operation]),
  );
  const packs = input.loopResult.rewriteRecords.flatMap(
    (record): readonly VectorReplacementPack[] =>
      record.memoryScalarVectorPairs.flatMap((pair): readonly VectorReplacementPack[] => {
        const scalarOperation = operationById.get(pair.scalarOperationId);
        const vectorOperation = vectorById.get(pair.vectorOperationId);
        if (
          vectorOperation === undefined ||
          !canMaterializeLoopScalarLoad(scalarOperation, vectorOperation)
        ) {
          return [];
        }
        const blockId = blockContainingOperation(input.program, scalarOperation.operationId);
        if (blockId === undefined) {
          return [];
        }
        return [
          Object.freeze({
            blockId,
            anchorOperationId: scalarOperation.operationId,
            vectorOperation,
            scalarOperationIds: Object.freeze([scalarOperation.operationId]),
            diagnosticGroupId: record.loopId,
          }),
        ];
      }),
  );
  const materialized = materializeVectorReplacementPacks({
    program: input.program,
    operations: input.operations,
    vectorOperations: input.loopResult.vectorOperations,
    packs,
  });

  const diagnostics = input.loopResult.rewriteRecords.map((record) => {
    const materializedVectorOperationIds = materialized.materializedPacks
      .filter((pack) => pack.diagnosticGroupId === record.loopId)
      .map((pack) => pack.vectorOperation.operationId);
    const stableDetail =
      materializedVectorOperationIds.length === 0
        ? `loop-vectorization:memory-pack-deferred:${record.loopId}:no-safe-scalar-load-forward`
        : `loop-vectorization:memory-pack-materialized:${record.loopId}:${materializedVectorOperationIds.map(Number).join(",")}`;
    return pipelineInfoDiagnostic(
      "opt-ir-optimization",
      "certified-loop-vectorization",
      stableDetail,
    );
  });

  return {
    program: materialized.program,
    operations: materialized.operations,
    valueForwards: materialized.valueForwards,
    removedOperationIds: materialized.removedOperationIds,
    diagnostics: Object.freeze(diagnostics),
  };
}

function materializeVectorReplacementPacks(input: {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly vectorOperations: readonly OptIrOperation[];
  readonly packs: readonly VectorReplacementPack[];
}): VectorReplacementPackMaterializationResult {
  const operationById = new Map(
    input.operations.map((operation) => [operation.operationId, operation]),
  );
  const idAllocator = createOptIrIdAllocator(input.operations, input.vectorOperations);

  const addedOperations: OptIrOperation[] = [];
  const blockRewrites: OptIrBlockOperationRewrite[] = [];
  const valueForwards: OptIrValueForward[] = [];
  const removedOperationIds: OptIrOperationId[] = [];
  const materializedPacks: VectorReplacementPack[] = [];

  for (const pack of input.packs) {
    if (blockContainingOperation(input.program, pack.anchorOperationId) !== pack.blockId) {
      continue;
    }
    addedOperations.push(pack.vectorOperation);
    const insertedOperationIds: OptIrOperationId[] = [pack.vectorOperation.operationId];
    const shuffleForwards = laneShuffleForScalarOps({
      vectorOperation: pack.vectorOperation,
      scalarOperationIds: pack.scalarOperationIds,
      operationById,
      nextOperationId: idAllocator.nextOperationId,
      nextValueId: idAllocator.nextValueId,
    });
    addedOperations.push(...shuffleForwards.operations);
    insertedOperationIds.push(
      ...shuffleForwards.operations.map((operation) => operation.operationId),
    );
    valueForwards.push(...shuffleForwards.valueForwards);
    removedOperationIds.push(...pack.scalarOperationIds);
    blockRewrites.push({
      kind: "replaceSpan",
      blockId: pack.blockId,
      replacedSpanOperationIds: Object.freeze([...pack.scalarOperationIds]),
      replacementOperationIds: Object.freeze(insertedOperationIds),
    });
    materializedPacks.push(pack);
  }

  if (blockRewrites.length === 0) {
    return {
      program: input.program,
      operations: input.operations,
      valueForwards: [],
      removedOperationIds: [],
      materializedPacks: [],
    };
  }

  const rewritten = applyOptIrOperationRewrites({
    program: input.program,
    operations: input.operations,
    addedOperations,
    blockRewrites,
    valueForwards,
  });
  return {
    program: rewritten.program,
    operations: rewritten.operations,
    valueForwards: rewritten.valueForwards,
    removedOperationIds: Object.freeze(removedOperationIds),
    materializedPacks: Object.freeze(materializedPacks),
  };
}

function canMaterializeLoopScalarLoad(
  scalarOperation: OptIrOperation | undefined,
  vectorOperation: OptIrOperation,
): scalarOperation is Extract<OptIrOperation, { readonly kind: "memoryLoad" }> {
  if (
    scalarOperation?.kind !== "memoryLoad" ||
    (vectorOperation?.kind !== "vectorLoad" && vectorOperation?.kind !== "vectorMaskedLoad")
  ) {
    return false;
  }
  const scalarResultType = scalarOperation.resultTypes[0];
  const vectorResultType = vectorOperation.resultTypes[0];
  if (scalarResultType === undefined || vectorResultType?.kind !== "vector") {
    return false;
  }
  return optIrTypesEqual(scalarResultType, vectorResultType.laneType);
}

function laneShuffleForScalarOps(input: {
  readonly vectorOperation: OptIrOperation;
  readonly scalarOperationIds: readonly OptIrOperationId[];
  readonly operationById: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly nextOperationId: () => OptIrOperationId;
  readonly nextValueId: () => OptIrValueId;
}): {
  readonly operations: readonly OptIrOperation[];
  readonly valueForwards: readonly OptIrValueForward[];
} {
  const vectorResultId = input.vectorOperation.resultIds[0];
  if (vectorResultId === undefined) {
    return { operations: [], valueForwards: [] };
  }
  const operations: OptIrOperation[] = [];
  const valueForwards: OptIrValueForward[] = [];
  let laneIndex = 0;

  for (const scalarOperationId of input.scalarOperationIds) {
    const scalarOperation = input.operationById.get(scalarOperationId);
    if (scalarOperation === undefined || scalarOperation.resultIds.length === 0) {
      continue;
    }
    const scalarResultId = scalarOperation.resultIds[0]!;
    const resultType = scalarOperation.resultTypes[0];
    if (resultType === undefined) {
      continue;
    }
    const shuffleResultId = input.nextValueId();
    operations.push(
      optIrVectorShuffleOperation({
        operationId: input.nextOperationId(),
        sourceValueIds: [vectorResultId],
        shuffleIndices: [laneIndex],
        resultId: shuffleResultId,
        resultType,
        originId: scalarOperation.originId,
      }),
    );
    valueForwards.push({
      sourceValue: scalarResultId,
      replacementValue: shuffleResultId,
    });
    laneIndex += 1;
  }

  return { operations: Object.freeze(operations), valueForwards: Object.freeze(valueForwards) };
}
