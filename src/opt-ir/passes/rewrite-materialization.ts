import { optIrFunctionTable, optIrProgram, type OptIrProgram } from "../program";
import { stableJson } from "./pipeline-support";
import type { OptIrBlockId, OptIrOperationId, OptIrValueId } from "../ids";
import type { OptIrOperation } from "../operations";
import { runCopyPropagation } from "./copy-propagation";
import { mapPerFunctionPassOnOperations, sortedOperations } from "./pipeline-state";
import { validateBlockRewrites } from "./rewrite-materialization-validation";

export interface OptIrValueForward {
  readonly sourceValue: OptIrValueId;
  readonly replacementValue: OptIrValueId;
}

export interface OptIrReplaceSpanBlockOperationRewrite {
  readonly kind: "replaceSpan";
  readonly blockId: OptIrBlockId;
  readonly replacedSpanOperationIds: readonly OptIrOperationId[];
  readonly replacementOperationIds: readonly OptIrOperationId[];
}

export interface OptIrInsertAtBlockOperationRewrite {
  readonly kind: "insertAt";
  readonly blockId: OptIrBlockId;
  readonly anchorOperationId: OptIrOperationId;
  readonly placement: "before" | "after";
  readonly insertedOperationIds: readonly OptIrOperationId[];
}

export type OptIrBlockOperationRewrite =
  | OptIrReplaceSpanBlockOperationRewrite
  | OptIrInsertAtBlockOperationRewrite;

export interface ApplyOptIrOperationRewritesInput {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly addedOperations: readonly OptIrOperation[];
  readonly replacedOperations?: readonly OptIrOperation[];
  readonly blockRewrites: readonly OptIrBlockOperationRewrite[];
  readonly valueForwards?: readonly OptIrValueForward[];
}

export interface ApplyOptIrOperationRewritesResult {
  readonly program: OptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly valueForwards: readonly OptIrValueForward[];
}

export function applyOptIrOperationRewrites(
  input: ApplyOptIrOperationRewritesInput,
): ApplyOptIrOperationRewritesResult {
  validateBlockRewrites(input);
  const removedOperationIds = removedOperationIdsFromRewrites(input.blockRewrites);
  const replacementById = new Map(
    (input.replacedOperations ?? []).map((operation) => [operation.operationId, operation]),
  );
  const operations = sortedOperations([
    ...input.operations
      .filter((operation) => !removedOperationIds.has(operation.operationId))
      .map((operation) => replacementById.get(operation.operationId) ?? operation),
    ...input.addedOperations.filter((operation) => !replacementById.has(operation.operationId)),
  ]);
  const program = spliceBlockRewrites({
    program: input.program,
    blockRewrites: input.blockRewrites,
  });
  const valueForwards = input.valueForwards ?? [];
  if (valueForwards.length === 0) {
    return { program, operations, valueForwards };
  }
  const propagated = mapPerFunctionPassOnOperations(
    program,
    operations,
    (function_, operationById) =>
      runCopyPropagation({
        function: function_,
        operations: operationById,
        valueCopies: valueForwards.map(
          (forward) => [forward.sourceValue, forward.replacementValue] as const,
        ),
      }),
  );
  return {
    program: propagated.program,
    operations: propagated.operations,
    valueForwards,
  };
}

export function replacedOperationsFromRewrite(
  before: readonly OptIrOperation[],
  after: readonly OptIrOperation[],
): readonly OptIrOperation[] {
  const afterById = new Map(after.map((operation) => [operation.operationId, operation]));
  return Object.freeze(
    before.flatMap((operation) => {
      const updated = afterById.get(operation.operationId);
      if (updated === undefined) {
        return [];
      }
      return stableJson(operation) !== stableJson(updated) ? [updated] : [];
    }),
  );
}

export function addedOperationsFromRewrite(
  before: readonly OptIrOperation[],
  after: readonly OptIrOperation[],
): readonly OptIrOperation[] {
  const beforeIds = new Set(before.map((operation) => operation.operationId));
  return Object.freeze(after.filter((operation) => !beforeIds.has(operation.operationId)));
}

function spliceBlockRewrites(input: {
  readonly program: OptIrProgram;
  readonly blockRewrites: readonly OptIrBlockOperationRewrite[];
}): OptIrProgram {
  const rewritesByBlock = groupBlockRewrites(input.blockRewrites);
  return optIrProgram({
    programId: input.program.programId,
    targetId: input.program.targetId,
    functions: optIrFunctionTable(
      input.program.functions.entries().map((function_) => ({
        ...function_,
        blocks: function_.blocks.map((block) => {
          const blockRewrites = rewritesByBlock.get(block.blockId);
          if (blockRewrites === undefined || blockRewrites.length === 0) {
            return block;
          }
          const replaceByFirstOperation = replaceSpanByFirstOperation(blockRewrites);
          const beforeInserts = insertionsByAnchor(blockRewrites, "before");
          const afterInserts = insertionsByAnchor(blockRewrites, "after");
          const merged: OptIrOperationId[] = [];
          for (let index = 0; index < block.operations.length; index += 1) {
            const operationId = block.operations[index]!;
            merged.push(...(beforeInserts.get(operationId) ?? []));
            const rewrite = replaceByFirstOperation.get(operationId);
            if (rewrite !== undefined) {
              merged.push(...rewrite.replacementOperationIds);
              index += rewrite.replacedSpanOperationIds.length - 1;
            } else {
              merged.push(operationId);
            }
            merged.push(...(afterInserts.get(operationId) ?? []));
          }
          return { ...block, operations: merged };
        }),
      })),
    ),
    regions: input.program.regions,
    constants: input.program.constants,
    callGraph: input.program.callGraph,
    provenance: input.program.provenance,
  });
}

function groupBlockRewrites(
  blockRewrites: readonly OptIrBlockOperationRewrite[],
): ReadonlyMap<OptIrBlockId, readonly OptIrBlockOperationRewrite[]> {
  const rewriteByBlock = new Map<OptIrBlockId, OptIrBlockOperationRewrite[]>();
  for (const rewrite of blockRewrites) {
    const rewrites = rewriteByBlock.get(rewrite.blockId) ?? [];
    rewrites.push(rewrite);
    rewriteByBlock.set(rewrite.blockId, rewrites);
  }
  return rewriteByBlock;
}

function replaceSpanByFirstOperation(
  blockRewrites: readonly OptIrBlockOperationRewrite[],
): ReadonlyMap<OptIrOperationId, OptIrReplaceSpanBlockOperationRewrite> {
  const rewriteByFirstOperation = new Map<
    OptIrOperationId,
    OptIrReplaceSpanBlockOperationRewrite
  >();
  for (const rewrite of blockRewrites) {
    if (rewrite.kind !== "replaceSpan") {
      continue;
    }
    const firstOperationId = rewrite.replacedSpanOperationIds[0];
    if (firstOperationId !== undefined) {
      rewriteByFirstOperation.set(firstOperationId, rewrite);
    }
  }
  return rewriteByFirstOperation;
}

function insertionsByAnchor(
  blockRewrites: readonly OptIrBlockOperationRewrite[],
  placement: OptIrInsertAtBlockOperationRewrite["placement"],
): ReadonlyMap<OptIrOperationId, readonly OptIrOperationId[]> {
  const insertedByAnchor = new Map<OptIrOperationId, OptIrOperationId[]>();
  for (const rewrite of blockRewrites) {
    if (rewrite.kind !== "insertAt" || rewrite.placement !== placement) {
      continue;
    }
    const inserted = insertedByAnchor.get(rewrite.anchorOperationId) ?? [];
    inserted.push(...rewrite.insertedOperationIds);
    insertedByAnchor.set(rewrite.anchorOperationId, inserted);
  }
  return insertedByAnchor;
}

export function removedOperationIdsFromRewrites(
  blockRewrites: readonly OptIrBlockOperationRewrite[],
): ReadonlySet<OptIrOperationId> {
  return new Set(
    blockRewrites.flatMap((rewrite) =>
      rewrite.kind === "replaceSpan" ? rewrite.replacedSpanOperationIds : [],
    ),
  );
}
