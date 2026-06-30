import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import { optIrCfgEdgeTable, type OptIrBlock } from "../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrBlockId,
  optIrConstantId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrConstantOperation, type OptIrOperation } from "../../../src/opt-ir/operations";
import { applyOptIrOperationRewrites } from "../../../src/opt-ir/passes/rewrite-materialization";
import {
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrProgram,
} from "../../../src/opt-ir/program";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";

describe("OptIR rewrite materialization", () => {
  test("applyOptIrOperationRewrites inserts each replacement at its removed span", () => {
    const blockId = optIrBlockId(1);
    const operations = [1, 2, 3, 4].map((id) => constantOperationForTest(id));
    const addedOperations = [101, 103].map((id) => constantOperationForTest(id));
    const program = programForRewriteMaterializationTest({
      blockId,
      operationIds: operations.map((operation) => operation.operationId),
    });

    const result = applyOptIrOperationRewrites({
      program,
      operations,
      addedOperations,
      blockRewrites: [
        {
          kind: "replaceSpan",
          blockId,
          replacedSpanOperationIds: [optIrOperationId(1)],
          replacementOperationIds: [optIrOperationId(101)],
        },
        {
          kind: "replaceSpan",
          blockId,
          replacedSpanOperationIds: [optIrOperationId(3)],
          replacementOperationIds: [optIrOperationId(103)],
        },
      ],
    });

    expect(result.program.functions.entries()[0]?.blocks[0]?.operations).toEqual([
      optIrOperationId(101),
      optIrOperationId(2),
      optIrOperationId(103),
      optIrOperationId(4),
    ]);
  });

  test("applyOptIrOperationRewrites inserts operations at an explicit anchor", () => {
    const blockId = optIrBlockId(1);
    const operations = [1, 2].map((id) => constantOperationForTest(id));
    const addedOperations = [101].map((id) => constantOperationForTest(id));
    const program = programForRewriteMaterializationTest({
      blockId,
      operationIds: operations.map((operation) => operation.operationId),
    });

    const result = applyOptIrOperationRewrites({
      program,
      operations,
      addedOperations,
      blockRewrites: [
        {
          kind: "insertAt",
          blockId,
          anchorOperationId: optIrOperationId(1),
          placement: "after",
          insertedOperationIds: [optIrOperationId(101)],
        },
      ],
    });

    expect(result.program.functions.entries()[0]?.blocks[0]?.operations).toEqual([
      optIrOperationId(1),
      optIrOperationId(101),
      optIrOperationId(2),
    ]);
  });

  test("applyOptIrOperationRewrites rejects non-contiguous replacement spans", () => {
    const blockId = optIrBlockId(1);
    const operations = [1, 2, 3, 4].map((id) => constantOperationForTest(id));
    const addedOperations = [101].map((id) => constantOperationForTest(id));
    const program = programForRewriteMaterializationTest({
      blockId,
      operationIds: operations.map((operation) => operation.operationId),
    });

    expect(() =>
      applyOptIrOperationRewrites({
        program,
        operations,
        addedOperations,
        blockRewrites: [
          {
            kind: "replaceSpan",
            blockId,
            replacedSpanOperationIds: [optIrOperationId(2), optIrOperationId(4)],
            replacementOperationIds: [optIrOperationId(101)],
          },
        ],
      }),
    ).toThrow("contiguous");
  });

  test("applyOptIrOperationRewrites rejects replacement spans declared out of block order", () => {
    const blockId = optIrBlockId(1);
    const operations = [1, 2, 3].map((id) => constantOperationForTest(id));
    const addedOperations = [101].map((id) => constantOperationForTest(id));
    const program = programForRewriteMaterializationTest({
      blockId,
      operationIds: operations.map((operation) => operation.operationId),
    });

    expect(() =>
      applyOptIrOperationRewrites({
        program,
        operations,
        addedOperations,
        blockRewrites: [
          {
            kind: "replaceSpan",
            blockId,
            replacedSpanOperationIds: [optIrOperationId(3), optIrOperationId(2)],
            replacementOperationIds: [optIrOperationId(101)],
          },
        ],
      }),
    ).toThrow("block order");
  });

  test("applyOptIrOperationRewrites rejects added operations not referenced by any rewrite", () => {
    const blockId = optIrBlockId(1);
    const operations = [1, 2].map((id) => constantOperationForTest(id));
    const addedOperations = [101].map((id) => constantOperationForTest(id));
    const program = programForRewriteMaterializationTest({
      blockId,
      operationIds: operations.map((operation) => operation.operationId),
    });

    expect(() =>
      applyOptIrOperationRewrites({
        program,
        operations,
        addedOperations,
        blockRewrites: [],
      }),
    ).toThrow("added operation 101");
  });

  test("applyOptIrOperationRewrites rejects replacement ids removed from the final operation table", () => {
    const blockId = optIrBlockId(1);
    const operations = [1, 2].map((id) => constantOperationForTest(id));
    const program = programForRewriteMaterializationTest({
      blockId,
      operationIds: operations.map((operation) => operation.operationId),
    });

    expect(() =>
      applyOptIrOperationRewrites({
        program,
        operations,
        addedOperations: [],
        blockRewrites: [
          {
            kind: "replaceSpan",
            blockId,
            replacedSpanOperationIds: [optIrOperationId(1)],
            replacementOperationIds: [optIrOperationId(1)],
          },
        ],
      }),
    ).toThrow("operation 1");
  });

  test("applyOptIrOperationRewrites rejects insert anchors inside replacement spans regardless of order", () => {
    const blockId = optIrBlockId(1);
    const operations = [1, 2, 3].map((id) => constantOperationForTest(id));
    const addedOperations = [101].map((id) => constantOperationForTest(id));
    const program = programForRewriteMaterializationTest({
      blockId,
      operationIds: operations.map((operation) => operation.operationId),
    });

    expect(() =>
      applyOptIrOperationRewrites({
        program,
        operations,
        addedOperations,
        blockRewrites: [
          {
            kind: "insertAt",
            blockId,
            anchorOperationId: optIrOperationId(2),
            placement: "after",
            insertedOperationIds: [optIrOperationId(101)],
          },
          {
            kind: "replaceSpan",
            blockId,
            replacedSpanOperationIds: [optIrOperationId(2)],
            replacementOperationIds: [],
          },
        ],
      }),
    ).toThrow("inside a replacement span");
  });

  test("applyOptIrOperationRewrites rejects added operation ids that collide with live operations", () => {
    const blockId = optIrBlockId(1);
    const operations = [1, 2].map((id) => constantOperationForTest(id));
    const program = programForRewriteMaterializationTest({
      blockId,
      operationIds: operations.map((operation) => operation.operationId),
    });

    expect(() =>
      applyOptIrOperationRewrites({
        program,
        operations,
        addedOperations: [constantOperationForTest(1)],
        blockRewrites: [
          {
            kind: "insertAt",
            blockId,
            anchorOperationId: optIrOperationId(1),
            placement: "after",
            insertedOperationIds: [optIrOperationId(1)],
          },
        ],
      }),
    ).toThrow("collides with existing operation");
  });

  test("applyOptIrOperationRewrites rejects added operations placed more than once", () => {
    const blockId = optIrBlockId(1);
    const operations = [1, 2].map((id) => constantOperationForTest(id));
    const addedOperations = [101].map((id) => constantOperationForTest(id));
    const program = programForRewriteMaterializationTest({
      blockId,
      operationIds: operations.map((operation) => operation.operationId),
    });

    expect(() =>
      applyOptIrOperationRewrites({
        program,
        operations,
        addedOperations,
        blockRewrites: [
          {
            kind: "insertAt",
            blockId,
            anchorOperationId: optIrOperationId(1),
            placement: "after",
            insertedOperationIds: [optIrOperationId(101)],
          },
          {
            kind: "insertAt",
            blockId,
            anchorOperationId: optIrOperationId(2),
            placement: "after",
            insertedOperationIds: [optIrOperationId(101)],
          },
        ],
      }),
    ).toThrow("must be referenced exactly once");
  });

  test("applyOptIrOperationRewrites rejects replacement ids that are not added operations", () => {
    const blockId = optIrBlockId(1);
    const operations = [1, 2].map((id) => constantOperationForTest(id));
    const program = programForRewriteMaterializationTest({
      blockId,
      operationIds: operations.map((operation) => operation.operationId),
    });

    expect(() =>
      applyOptIrOperationRewrites({
        program,
        operations,
        addedOperations: [],
        blockRewrites: [
          {
            kind: "replaceSpan",
            blockId,
            replacedSpanOperationIds: [optIrOperationId(1)],
            replacementOperationIds: [optIrOperationId(2)],
          },
        ],
      }),
    ).toThrow("must be an added operation");
  });
});

function constantOperationForTest(id: number): OptIrOperation {
  return optIrConstantOperation({
    operationId: optIrOperationId(id),
    resultId: optIrValueId(id),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(id),
      type: optIrUnsignedIntegerType(32),
      normalizedValue: BigInt(id),
    }),
    originId: optIrOriginId(1),
  });
}

function programForRewriteMaterializationTest(input: {
  readonly blockId: ReturnType<typeof optIrBlockId>;
  readonly operationIds: readonly ReturnType<typeof optIrOperationId>[];
}): OptIrProgram {
  const block: OptIrBlock = {
    blockId: input.blockId,
    parameters: [],
    operations: input.operationIds,
    originId: optIrOriginId(1),
  };
  return optIrProgram({
    programId: optIrProgramId(1),
    targetId: targetId("rewrite-materialization-test"),
    functions: optIrFunctionTable([
      {
        functionId: optIrFunctionId(1),
        monoInstanceId: monoInstanceId("test::rewrite-materialization"),
        signature: {} as never,
        blocks: [block],
        edges: optIrCfgEdgeTable([]),
        entryBlock: block.blockId,
        originId: optIrOriginId(1),
      },
    ]),
    regions: optIrRegionTable([]),
    constants: { get: () => undefined, has: () => false, entries: () => [] },
    callGraph: { calls: [] },
    provenance: { originIds: [optIrOriginId(1)] },
  });
}
