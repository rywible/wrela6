import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import { optIrCfgEdgeTable, type OptIrBlock } from "../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import { createOptIrFreshIdAllocator } from "../../../src/opt-ir/id-allocation";
import {
  optIrBlockId,
  optIrConstantId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrConstantOperation, type OptIrOperation } from "../../../src/opt-ir/operations";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrFunction,
} from "../../../src/opt-ir/program";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { targetId } from "../../../src/semantic/ids";

const originId = optIrOriginId(1);

describe("OptIR canonical fresh ID allocation", () => {
  test("scans the whole program and operations for every foundation ID family", () => {
    const operation = optIrConstantOperation({
      operationId: optIrOperationId(17),
      resultId: optIrValueId(23),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(1),
        type: optIrUnsignedIntegerType(32),
        normalizedValue: 1n,
      }),
      originId,
    });
    const program = optIrProgram({
      programId: optIrProgramId(1),
      targetId: targetId("id-allocation"),
      functions: optIrFunctionTable([
        functionForTest({
          functionId: 9,
          blocks: [
            blockForTest(7, [operation.operationId], {
              kind: "jump",
              operationId: 31,
              edge: 11,
            }),
            blockForTest(8, [], { kind: "return", operationId: 32 }),
          ],
        }),
      ]),
      regions: optIrRegionTable([{ regionId: optIrRegionId(13), originId }]),
      constants: optIrConstantTable([]),
      callGraph: { calls: [] },
      provenance: { originIds: [originId] },
    });

    const allocator = createOptIrFreshIdAllocator({ program, operations: [operation] });

    expect(allocator.functionId()).toBe(optIrFunctionId(10));
    expect(allocator.blockId()).toBe(optIrBlockId(9));
    expect(allocator.edgeId()).toBe(optIrEdgeId(12));
    expect(allocator.operationId()).toBe(optIrOperationId(33));
    expect(allocator.valueId()).toBe(optIrValueId(24));
    expect(allocator.regionId()).toBe(optIrRegionId(14));
  });

  test("table builders reject duplicate IDs with context before entries are overwritten", () => {
    const first = functionForTest({
      functionId: 4,
      blocks: [blockForTest(1, [], { kind: "return", operationId: 1 })],
    });
    const second = functionForTest({
      functionId: 4,
      blocks: [blockForTest(2, [], { kind: "return", operationId: 2 })],
    });

    expect(() => optIrFunctionTable([first, second])).toThrow(
      "Duplicate OptIR function id 4 at functions[1]",
    );
  });
});

function functionForTest(input: {
  readonly functionId: number;
  readonly blocks: readonly OptIrBlock[];
}): OptIrFunction {
  return {
    functionId: optIrFunctionId(input.functionId),
    monoInstanceId: monoInstanceId(`id-allocation::${input.functionId}`),
    signature: {},
    blocks: input.blocks,
    edges: optIrCfgEdgeTable([
      {
        edgeId: optIrEdgeId(11),
        from: optIrBlockId(7),
        toBlock: optIrBlockId(8),
        ordinal: 0,
        kind: "normal",
        arguments: [],
        originId,
      },
    ]),
    entryBlock: input.blocks[0]!.blockId,
    originId,
  } as OptIrFunction;
}

function blockForTest(
  blockId: number,
  operations: readonly OptIrOperation["operationId"][],
  terminator:
    | { readonly kind: "jump"; readonly operationId: number; readonly edge: number }
    | { readonly kind: "return"; readonly operationId: number },
): OptIrBlock {
  return {
    blockId: optIrBlockId(blockId),
    parameters: [],
    operations,
    terminator:
      terminator.kind === "jump"
        ? {
            kind: "jump",
            operationId: optIrOperationId(terminator.operationId),
            edge: optIrEdgeId(terminator.edge),
            originId,
          }
        : {
            kind: "return",
            operationId: optIrOperationId(terminator.operationId),
            values: [],
            originId,
          },
    originId,
  };
}
