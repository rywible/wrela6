import type { OptIrBlockId, OptIrOperationId } from "../ids";
import type { OptIrProgram } from "../program";
import type {
  ApplyOptIrOperationRewritesInput,
  OptIrInsertAtBlockOperationRewrite,
  OptIrReplaceSpanBlockOperationRewrite,
} from "./rewrite-materialization";

export function validateBlockRewrites(input: ApplyOptIrOperationRewritesInput): void {
  const blockOperationsById = blockOperationsByBlock(input.program);
  assertUniqueOperationTable(input.operations, "input operation table");
  assertUniqueOperationTable(input.replacedOperations ?? [], "replaced operation table");
  assertUniqueOperationTable(input.addedOperations, "added operation table");
  const originalOperationIds = new Set(input.operations.map((operation) => operation.operationId));
  const replacedOperationIds = new Set(
    (input.replacedOperations ?? []).map((operation) => operation.operationId),
  );
  const addedOperationIds = new Set(
    input.addedOperations.map((operation) => operation.operationId),
  );
  const removedOperationOwners = removedOperationOwnersFromRewrites(input.blockRewrites);
  assertProgramOperationReferencesAreValid({
    blockOperationsById,
    originalOperationIds,
  });
  assertReplacedOperationsTargetLiveOriginals({
    replacedOperationIds,
    originalOperationIds,
    removedOperationIds: new Set(removedOperationOwners.keys()),
  });
  assertAddedOperationsAreFresh({
    addedOperationIds,
    originalOperationIds,
  });
  const addedOperationReferenceCounts = new Map<OptIrOperationId, number>();

  for (const rewrite of input.blockRewrites) {
    const blockOperationIds = blockOperationsById.get(rewrite.blockId);
    if (blockOperationIds === undefined) {
      throw new Error(`OptIR block rewrite references missing block ${Number(rewrite.blockId)}.`);
    }
    if (rewrite.kind === "replaceSpan") {
      validateReplaceSpanRewrite({
        rewrite,
        blockOperationIds,
        addedOperationIds,
        addedOperationReferenceCounts,
      });
    } else {
      validateInsertAtRewrite({
        rewrite,
        blockOperationIds,
        addedOperationIds,
        addedOperationReferenceCounts,
        removedOperationOwners,
      });
    }
  }

  for (const addedOperationId of addedOperationIds) {
    const referenceCount = addedOperationReferenceCounts.get(addedOperationId) ?? 0;
    if (referenceCount !== 1) {
      throw new Error(
        `OptIR added operation ${Number(addedOperationId)} must be referenced exactly once by block rewrites.`,
      );
    }
  }
}

function validateReplaceSpanRewrite(input: {
  readonly rewrite: OptIrReplaceSpanBlockOperationRewrite;
  readonly blockOperationIds: readonly OptIrOperationId[];
  readonly addedOperationIds: ReadonlySet<OptIrOperationId>;
  readonly addedOperationReferenceCounts: Map<OptIrOperationId, number>;
}): void {
  if (input.rewrite.replacedSpanOperationIds.length === 0) {
    throw new Error("OptIR replaceSpan rewrite must replace a non-empty span.");
  }
  assertUniqueOperationIds(input.rewrite.replacedSpanOperationIds, "replacement span");
  assertUniqueOperationIds(input.rewrite.replacementOperationIds, "replacement operations");
  const spanStart = contiguousSpanStart(
    input.blockOperationIds,
    input.rewrite.replacedSpanOperationIds,
  );
  if (spanStart === undefined) {
    explainInvalidReplacementSpan(input.rewrite, input.blockOperationIds);
  }
  for (const operationId of input.rewrite.replacementOperationIds) {
    validateMaterializedBlockOperationId({
      operationId,
      addedOperationIds: input.addedOperationIds,
      addedOperationReferenceCounts: input.addedOperationReferenceCounts,
      role: "replacement",
    });
  }
}

function validateInsertAtRewrite(input: {
  readonly rewrite: OptIrInsertAtBlockOperationRewrite;
  readonly blockOperationIds: readonly OptIrOperationId[];
  readonly addedOperationIds: ReadonlySet<OptIrOperationId>;
  readonly addedOperationReferenceCounts: Map<OptIrOperationId, number>;
  readonly removedOperationOwners: ReadonlyMap<OptIrOperationId, OptIrBlockId>;
}): void {
  if (!input.blockOperationIds.includes(input.rewrite.anchorOperationId)) {
    throw new Error(
      `OptIR insertAt rewrite anchor operation ${Number(input.rewrite.anchorOperationId)} is not in block ${Number(input.rewrite.blockId)}.`,
    );
  }
  if (input.removedOperationOwners.has(input.rewrite.anchorOperationId)) {
    throw new Error(
      `OptIR insertAt rewrite anchor operation ${Number(input.rewrite.anchorOperationId)} is inside a replacement span.`,
    );
  }
  assertUniqueOperationIds(input.rewrite.insertedOperationIds, "inserted operations");
  for (const operationId of input.rewrite.insertedOperationIds) {
    validateMaterializedBlockOperationId({
      operationId,
      addedOperationIds: input.addedOperationIds,
      addedOperationReferenceCounts: input.addedOperationReferenceCounts,
      role: "inserted",
    });
  }
}

function validateMaterializedBlockOperationId(input: {
  readonly operationId: OptIrOperationId;
  readonly addedOperationIds: ReadonlySet<OptIrOperationId>;
  readonly addedOperationReferenceCounts: Map<OptIrOperationId, number>;
  readonly role: string;
}): void {
  if (!input.addedOperationIds.has(input.operationId)) {
    throw new Error(
      `OptIR ${input.role} operation ${Number(input.operationId)} must be an added operation.`,
    );
  }
  input.addedOperationReferenceCounts.set(
    input.operationId,
    (input.addedOperationReferenceCounts.get(input.operationId) ?? 0) + 1,
  );
}

function removedOperationOwnersFromRewrites(
  blockRewrites: readonly (
    | OptIrInsertAtBlockOperationRewrite
    | OptIrReplaceSpanBlockOperationRewrite
  )[],
): ReadonlyMap<OptIrOperationId, OptIrBlockId> {
  const owners = new Map<OptIrOperationId, OptIrBlockId>();
  for (const rewrite of blockRewrites) {
    if (rewrite.kind !== "replaceSpan") {
      continue;
    }
    assertUniqueOperationIds(rewrite.replacedSpanOperationIds, "replacement span");
    for (const operationId of rewrite.replacedSpanOperationIds) {
      const previousOwner = owners.get(operationId);
      if (previousOwner !== undefined) {
        throw new Error(
          `Overlapping OptIR block rewrites both remove operation ${Number(operationId)}.`,
        );
      }
      owners.set(operationId, rewrite.blockId);
    }
  }
  return owners;
}

function explainInvalidReplacementSpan(
  rewrite: OptIrReplaceSpanBlockOperationRewrite,
  blockOperationIds: readonly OptIrOperationId[],
): never {
  const blockOperationSet = new Set(blockOperationIds);
  const missingOperationId = rewrite.replacedSpanOperationIds.find(
    (operationId) => !blockOperationSet.has(operationId),
  );
  if (missingOperationId !== undefined) {
    throw new Error(
      `OptIR replacement span references operation ${Number(missingOperationId)} outside block ${Number(rewrite.blockId)}.`,
    );
  }

  const spanOperationSet = new Set(rewrite.replacedSpanOperationIds);
  const blockOrderedSpan = blockOperationIds.filter((operationId) =>
    spanOperationSet.has(operationId),
  );
  if (!sameOperationIdSequence(blockOrderedSpan, rewrite.replacedSpanOperationIds)) {
    throw new Error(
      `OptIR replacement span for block ${Number(rewrite.blockId)} must be declared in block order.`,
    );
  }
  throw new Error(
    `OptIR replacement span for block ${Number(rewrite.blockId)} must be contiguous.`,
  );
}

function contiguousSpanStart(
  blockOperationIds: readonly OptIrOperationId[],
  spanOperationIds: readonly OptIrOperationId[],
): number | undefined {
  for (let start = 0; start <= blockOperationIds.length - spanOperationIds.length; start += 1) {
    const candidate = blockOperationIds.slice(start, start + spanOperationIds.length);
    if (sameOperationIdSequence(candidate, spanOperationIds)) {
      return start;
    }
  }
  return undefined;
}

function assertUniqueOperationIds(
  operationIds: readonly OptIrOperationId[],
  description: string,
): void {
  const unique = new Set(operationIds);
  if (unique.size !== operationIds.length) {
    throw new Error(`OptIR ${description} contains duplicate operation ids.`);
  }
}

function assertUniqueOperationTable(
  operations: readonly { readonly operationId: OptIrOperationId }[],
  description: string,
): void {
  assertUniqueOperationIds(
    operations.map((operation) => operation.operationId),
    description,
  );
}

function assertProgramOperationReferencesAreValid(input: {
  readonly blockOperationsById: ReadonlyMap<OptIrBlockId, readonly OptIrOperationId[]>;
  readonly originalOperationIds: ReadonlySet<OptIrOperationId>;
}): void {
  const owningBlocks = new Map<OptIrOperationId, OptIrBlockId>();
  for (const [blockId, blockOperationIds] of input.blockOperationsById) {
    for (const operationId of blockOperationIds) {
      if (!input.originalOperationIds.has(operationId)) {
        throw new Error(
          `OptIR block ${Number(blockId)} references operation ${Number(operationId)} missing from the materialization operation table.`,
        );
      }
      const previousBlockId = owningBlocks.get(operationId);
      if (previousBlockId !== undefined) {
        throw new Error(
          `OptIR operation ${Number(operationId)} is referenced by multiple blocks (${Number(previousBlockId)} and ${Number(blockId)}).`,
        );
      }
      owningBlocks.set(operationId, blockId);
    }
  }
}

function assertReplacedOperationsTargetLiveOriginals(input: {
  readonly replacedOperationIds: ReadonlySet<OptIrOperationId>;
  readonly originalOperationIds: ReadonlySet<OptIrOperationId>;
  readonly removedOperationIds: ReadonlySet<OptIrOperationId>;
}): void {
  for (const operationId of input.replacedOperationIds) {
    if (!input.originalOperationIds.has(operationId)) {
      throw new Error(
        `OptIR replaced operation ${Number(operationId)} is not present in the original operation table.`,
      );
    }
    if (input.removedOperationIds.has(operationId)) {
      throw new Error(
        `OptIR replaced operation ${Number(operationId)} is also removed by a block rewrite.`,
      );
    }
  }
}

function assertAddedOperationsAreFresh(input: {
  readonly addedOperationIds: ReadonlySet<OptIrOperationId>;
  readonly originalOperationIds: ReadonlySet<OptIrOperationId>;
}): void {
  for (const operationId of input.addedOperationIds) {
    if (input.originalOperationIds.has(operationId)) {
      throw new Error(
        `OptIR added operation ${Number(operationId)} collides with existing operation ${Number(operationId)}.`,
      );
    }
  }
}

function sameOperationIdSequence(
  left: readonly OptIrOperationId[],
  right: readonly OptIrOperationId[],
): boolean {
  return (
    left.length === right.length && left.every((operationId, index) => operationId === right[index])
  );
}

function blockOperationsByBlock(
  program: OptIrProgram,
): ReadonlyMap<OptIrBlockId, readonly OptIrOperationId[]> {
  const operationsByBlock = new Map<OptIrBlockId, readonly OptIrOperationId[]>();
  for (const function_ of program.functions.entries()) {
    for (const block of function_.blocks) {
      operationsByBlock.set(block.blockId, block.operations);
    }
  }
  return operationsByBlock;
}
