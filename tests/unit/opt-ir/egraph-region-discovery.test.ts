import { describe, expect, test } from "bun:test";

import { computeOptIrLoopTree } from "../../../src/opt-ir/analyses/loop-tree";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrAggregateConstructOperation,
  optIrAggregateExtractOperation,
  optIrMemoryLoadOperation,
  optIrRuntimeCallOperation,
} from "../../../src/opt-ir/operations";
import { optIrFunctionTable, optIrRegionTable } from "../../../src/opt-ir/program";
import {
  discoverOptIrEGraphRegionCandidatePool,
  discoverOptIrEGraphRegionCandidates,
} from "../../../src/opt-ir/passes/egraph-region-discovery";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import {
  optIrBlockForTest,
  optIrFunctionForTest,
  optIrProgramForTest,
} from "../../support/opt-ir/cfg-fakes";

describe("OptIR e-graph region discovery", () => {
  test("finds parser validation read dispatch slices from parser runtime and memory patterns", () => {
    const fixture = parserSliceFixtureForTest();
    const candidates = discoverOptIrEGraphRegionCandidates({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyFactSetForTest(),
    });

    expect(
      candidates.some((candidate) => candidate.kind === "parserValidationReadDispatchSlice"),
    ).toBeTrue();
    const parserSlice = candidates.find(
      (candidate) => candidate.kind === "parserValidationReadDispatchSlice",
    );
    expect(parserSlice?.operationIds).toEqual([
      optIrOperationId(11),
      optIrOperationId(12),
      optIrOperationId(13),
    ]);
  });

  test("finds vectorizable loops with vectorizable memory bodies", () => {
    const fixture = vectorizableLoopFixtureForTest();
    expect(computeOptIrLoopTree(fixture.function).loops().length).toBeGreaterThan(0);

    const candidates = discoverOptIrEGraphRegionCandidatePool({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyFactSetForTest(),
    });

    expect(candidates.some((candidate) => candidate.kind === "vectorizableLoop")).toBeTrue();
    expect(
      candidates.find((candidate) => candidate.kind === "vectorizableLoop")?.operationIds,
    ).toEqual([optIrOperationId(21), optIrOperationId(22)]);
  });

  test("discovers each vectorizable loop once instead of once per loop block", () => {
    const fixture = vectorizableLoopFixtureForTest();

    const candidates = discoverOptIrEGraphRegionCandidatePool({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyFactSetForTest(),
    });

    expect(candidates.filter((candidate) => candidate.kind === "vectorizableLoop")).toHaveLength(1);
  });

  test("selects non-overlapping parser, loop, memory, and scalar regions by priority", () => {
    const fixture = mixedRegionFixtureForTest();
    const candidates = discoverOptIrEGraphRegionCandidates({
      program: fixture.program,
      operations: fixture.operations,
      facts: emptyFactSetForTest(),
    });

    expect(candidates.map((candidate) => candidate.kind)).toEqual([
      "parserValidationReadDispatchSlice",
      "vectorizableLoop",
      "pureScalarDag",
    ]);
  });

  test("preserves program order when operation ids do not match block order", () => {
    const originId = optIrOriginId(400);
    const region = optIrRegionId(40);
    const operations = [
      runtimeCall(30, "runtime.packet_parser_state", originId),
      optIrAggregateConstructOperation({
        operationId: optIrOperationId(10),
        fieldIds: [optIrValueId(1)],
        resultId: optIrValueId(2),
        resultType: optIrUnsignedIntegerType(32),
        originId,
      }),
      memoryLoad(20, region, originId),
    ];
    const block = optIrBlockForTest({
      blockId: optIrBlockId(8),
      operations: operations.map((operation) => operation.operationId),
      originId,
    });
    const function_ = optIrFunctionForTest({
      blocks: [block],
      entryBlock: block.blockId,
      originId,
    });
    const program = optIrProgramForTest({
      functions: optIrFunctionTable([function_]),
      regions: optIrRegionTable([{ regionId: region, originId }]),
    });

    const candidates = discoverOptIrEGraphRegionCandidates({
      program,
      operations,
      facts: emptyFactSetForTest(),
    });

    const parserSlice = candidates.find(
      (candidate) => candidate.kind === "parserValidationReadDispatchSlice",
    );
    expect(parserSlice?.operationIds).toEqual([
      optIrOperationId(30),
      optIrOperationId(10),
      optIrOperationId(20),
    ]);
    expect(parserSlice?.rootOperationId).toBe(optIrOperationId(20));
  });
});

function parserSliceFixtureForTest() {
  const originId = optIrOriginId(100);
  const region = optIrRegionId(10);
  const operations = [
    runtimeCall(11, "runtime.packet_parser_state", originId),
    optIrAggregateConstructOperation({
      operationId: optIrOperationId(12),
      fieldIds: [optIrValueId(1)],
      resultId: optIrValueId(2),
      resultType: optIrUnsignedIntegerType(32),
      originId,
    }),
    memoryLoad(13, region, originId),
  ];
  const block = optIrBlockForTest({
    blockId: optIrBlockId(1),
    operations: operations.map((operation) => operation.operationId),
    originId,
  });
  const function_ = optIrFunctionForTest({ blocks: [block], entryBlock: block.blockId, originId });
  const program = optIrProgramForTest({
    functions: optIrFunctionTable([function_]),
    regions: optIrRegionTable([{ regionId: region, originId }]),
  });
  return { program, operations };
}

function vectorizableLoopFixtureForTest() {
  const originId = optIrOriginId(200);
  const region = optIrRegionId(20);
  const header = optIrBlockId(2);
  const latch = optIrBlockId(3);
  const operations = [memoryLoad(21, region, originId), memoryLoad(22, region, originId)];
  const headerBlock = optIrBlockForTest({
    blockId: header,
    operations: [operations[0]!.operationId],
    originId,
  });
  const latchBlock = optIrBlockForTest({
    blockId: latch,
    operations: [operations[1]!.operationId],
    originId,
  });
  const function_ = optIrFunctionForTest({
    functionId: optIrFunctionId(2),
    blocks: [headerBlock, latchBlock],
    entryBlock: header,
    edges: optIrCfgEdgeTable([
      {
        edgeId: optIrEdgeId(1),
        from: header,
        toBlock: latch,
        ordinal: 0,
        kind: "normal",
        arguments: [],
        originId,
      },
      {
        edgeId: optIrEdgeId(2),
        from: latch,
        toBlock: header,
        ordinal: 0,
        kind: "normal",
        arguments: [],
        originId,
      },
    ]),
    originId,
  });
  const program = optIrProgramForTest({
    functions: optIrFunctionTable([function_]),
    regions: optIrRegionTable([{ regionId: region, originId }]),
  });
  return { program, operations, function: function_ };
}

function mixedRegionFixtureForTest() {
  const originId = optIrOriginId(300);
  const region = optIrRegionId(30);
  const header = optIrBlockId(4);
  const latch = optIrBlockId(5);
  const parserOps = [
    runtimeCall(11, "runtime.packet_parser_state", originId),
    optIrAggregateConstructOperation({
      operationId: optIrOperationId(12),
      fieldIds: [optIrValueId(1)],
      resultId: optIrValueId(2),
      resultType: optIrUnsignedIntegerType(32),
      originId,
    }),
    memoryLoad(13, region, originId),
  ];
  const loopOps = [memoryLoad(21, region, originId), memoryLoad(22, region, originId)];
  const scalarOps = [
    optIrAggregateExtractOperation({
      operationId: optIrOperationId(31),
      aggregate: optIrValueId(2),
      fieldPath: ["field"],
      resultId: optIrValueId(3),
      resultType: optIrUnsignedIntegerType(32),
      originId,
    }),
  ];
  const operations = [...parserOps, ...loopOps, ...scalarOps];
  const parserBlock = optIrBlockForTest({
    blockId: optIrBlockId(1),
    operations: parserOps.map((operation) => operation.operationId),
    originId,
  });
  const headerBlock = optIrBlockForTest({
    blockId: header,
    operations: loopOps.map((operation) => operation.operationId),
    originId,
  });
  const latchBlock = optIrBlockForTest({
    blockId: latch,
    operations: [],
    originId,
  });
  const scalarBlock = optIrBlockForTest({
    blockId: optIrBlockId(6),
    operations: scalarOps.map((operation) => operation.operationId),
    originId,
  });
  const function_ = optIrFunctionForTest({
    blocks: [parserBlock, headerBlock, latchBlock, scalarBlock],
    entryBlock: parserBlock.blockId,
    edges: optIrCfgEdgeTable([
      {
        edgeId: optIrEdgeId(9),
        from: parserBlock.blockId,
        toBlock: header,
        ordinal: 0,
        kind: "normal",
        arguments: [],
        originId,
      },
      {
        edgeId: optIrEdgeId(10),
        from: header,
        toBlock: latch,
        ordinal: 0,
        kind: "normal",
        arguments: [],
        originId,
      },
      {
        edgeId: optIrEdgeId(11),
        from: latch,
        toBlock: header,
        ordinal: 0,
        kind: "normal",
        arguments: [],
        originId,
      },
      {
        edgeId: optIrEdgeId(12),
        from: header,
        toBlock: scalarBlock.blockId,
        ordinal: 1,
        kind: "normal",
        arguments: [],
        originId,
      },
    ]),
    originId,
  });
  const program = optIrProgramForTest({
    functions: optIrFunctionTable([function_]),
    regions: optIrRegionTable([{ regionId: region, originId }]),
  });
  return { program, operations };
}

function runtimeCall(
  operation: number,
  runtimeKey: string,
  originId: ReturnType<typeof optIrOriginId>,
) {
  return optIrRuntimeCallOperation({
    operationId: optIrOperationId(operation),
    callId: operation as never,
    target: { kind: "runtime", runtimeKey },
    argumentIds: [],
    resultIds: [],
    resultTypes: [],
    originId,
  });
}

function memoryLoad(
  operation: number,
  region: ReturnType<typeof optIrRegionId>,
  originId: ReturnType<typeof optIrOriginId>,
) {
  const result = optIrMemoryLoadOperation({
    operationId: optIrOperationId(operation),
    resultId: optIrValueId(operation),
    region,
    byteOffset: BigInt(operation),
    byteWidth: 4,
    alignment: 4,
    valueType: optIrUnsignedIntegerType(32),
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "constructionSize" },
    originId,
  });
  if (result.kind === "error") {
    throw new Error("memory load fixture must be valid");
  }
  return result.operation;
}

function emptyFactSetForTest() {
  return Object.freeze({
    records: Object.freeze([]),
    indexes: Object.freeze({
      byId: Object.freeze({}),
      byPacketFactId: Object.freeze({}),
      byPacketKind: Object.freeze({}),
      bySubjectKey: Object.freeze({}),
      byScopeKey: Object.freeze({}),
      byTypedAnswer: Object.freeze({}),
      byDependencyKind: Object.freeze({}),
    }),
  });
}
