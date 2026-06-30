import { describe, expect, test } from "bun:test";

import { deriveCertifiedLoopTripCount } from "../../../src/opt-ir/analyses/loop-trip-count";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrBlockId,
  optIrCallId,
  optIrConstantId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrMemoryLoadOperation,
  optIrRuntimeCallOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { optIrBranchTerminator } from "../../../src/opt-ir/terminators";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import { emptyOptIrFactSet } from "../../../src/opt-ir/facts/fact-index";
import { optIrWrelaRuntimeKeys } from "../../../src/opt-ir/rewrites/wrela-runtime-keys";
import { operationMatchesRuntimeCatalogKey } from "../../../src/opt-ir/rewrites/wrela-operation-patterns";

describe("OptIR loop trip count", () => {
  test("derives certified trip count from loop-carried induction and constant bound", () => {
    const fixture = inductionLoopFixtureForTest();
    const tripCount = deriveCertifiedLoopTripCount({
      function: fixture.function,
      loop: fixture.loop,
      bodyOperations: fixture.bodyOperations,
      operations: fixture.operationById,
      facts: emptyOptIrFactSet(),
    });

    expect(tripCount).toEqual({ kind: "certifiedExact", iterations: 16 });
  });

  test("does not certify trip count from contiguous proven memory progression", () => {
    const fixture = memoryProgressionLoopFixtureForTest();
    const tripCount = deriveCertifiedLoopTripCount({
      function: fixture.function,
      loop: fixture.loop,
      bodyOperations: fixture.bodyOperations,
      operations: fixture.operationById,
      facts: emptyOptIrFactSet(),
    });

    expect(tripCount).toEqual({ kind: "unknown" });
  });
});

describe("OptIR wrela runtime catalog keys", () => {
  test("matches typed runtime keys instead of substring heuristics", () => {
    const boundsCheck = optIrRuntimeCallOperation({
      operationId: optIrOperationId(1),
      callId: optIrCallId(1),
      target: { kind: "runtime", runtimeKey: optIrWrelaRuntimeKeys.boundsCheck },
      argumentIds: [],
      resultIds: [],
      resultTypes: [],
      originId: optIrOriginId(1),
    });
    const unrelated = optIrRuntimeCallOperation({
      operationId: optIrOperationId(2),
      callId: optIrCallId(2),
      target: { kind: "runtime", runtimeKey: "runtime.bounds_check_shadow" },
      argumentIds: [],
      resultIds: [],
      resultTypes: [],
      originId: optIrOriginId(1),
    });

    expect(operationMatchesRuntimeCatalogKey(boundsCheck, optIrWrelaRuntimeKeys.boundsCheck)).toBe(
      true,
    );
    expect(
      operationMatchesRuntimeCatalogKey(unrelated, optIrWrelaRuntimeKeys.boundsCheck),
    ).toBeFalse();
  });
});

function inductionLoopFixtureForTest() {
  const originId = optIrOriginId(1);
  const entry = optIrBlockId(1);
  const header = optIrBlockId(2);
  const body = optIrBlockId(3);
  const exit = optIrBlockId(4);

  const initConst = optIrConstantOperation({
    operationId: optIrOperationId(10),
    resultId: optIrValueId(100),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(1),
      type: optIrUnsignedIntegerType(32),
      normalizedValue: 0n,
    }),
    originId,
  });
  const boundConst = optIrConstantOperation({
    operationId: optIrOperationId(11),
    resultId: optIrValueId(101),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(2),
      type: optIrUnsignedIntegerType(32),
      normalizedValue: 16n,
    }),
    originId,
  });
  const compare = optIrIntegerCompareOperation({
    operationId: optIrOperationId(12),
    left: optIrValueId(200),
    right: optIrValueId(101),
    operator: "unsignedLessThan",
    resultId: optIrValueId(102),
    originId,
  });
  const increment = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(13),
    left: optIrValueId(200),
    right: optIrValueId(103),
    operator: "add",
    resultId: optIrValueId(201),
    resultType: optIrUnsignedIntegerType(32),
    originId,
  });
  const stepConst = optIrConstantOperation({
    operationId: optIrOperationId(14),
    resultId: optIrValueId(103),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(3),
      type: optIrUnsignedIntegerType(32),
      normalizedValue: 1n,
    }),
    originId,
  });

  const operations = [initConst, boundConst, compare, increment, stepConst];
  const operationById = new Map(operations.map((operation) => [operation.operationId, operation]));

  const entryToHeader = optIrEdgeId(1);
  const headerTrue = optIrEdgeId(2);
  const headerFalse = optIrEdgeId(3);
  const bodyToHeader = optIrEdgeId(4);

  const function_ = {
    functionId: optIrFunctionId(1),
    monoInstanceId: 0 as never,
    signature: {} as never,
    entryBlock: entry,
    originId,
    blocks: [
      {
        blockId: entry,
        parameters: [],
        operations: [initConst.operationId],
        originId,
      },
      {
        blockId: header,
        parameters: [
          optIrBlockParameter({
            valueId: optIrValueId(200),
            type: optIrUnsignedIntegerType(32),
            incomingRole: "loopCarried",
            originId,
          }),
        ],
        operations: [boundConst.operationId, compare.operationId],
        terminator: optIrBranchTerminator({
          operationId: optIrOperationId(20),
          condition: compare.resultIds[0]!,
          trueEdge: headerTrue,
          falseEdge: headerFalse,
          originId,
        }),
        originId,
      },
      {
        blockId: body,
        parameters: [],
        operations: [stepConst.operationId, increment.operationId],
        originId,
      },
      {
        blockId: exit,
        parameters: [],
        operations: [],
        originId,
      },
    ],
    edges: optIrCfgEdgeTable([
      {
        edgeId: entryToHeader,
        from: entry,
        toBlock: header,
        ordinal: 0,
        kind: "normal",
        arguments: [initConst.resultIds[0]!],
        originId,
      },
      {
        edgeId: headerTrue,
        from: header,
        toBlock: body,
        ordinal: 0,
        kind: "branchTrue",
        arguments: [],
        originId,
      },
      {
        edgeId: headerFalse,
        from: header,
        toBlock: exit,
        ordinal: 1,
        kind: "branchFalse",
        arguments: [],
        originId,
      },
      {
        edgeId: bodyToHeader,
        from: body,
        toBlock: header,
        ordinal: 0,
        kind: "normal",
        arguments: [increment.resultIds[0]!],
        originId,
      },
    ]),
  };

  return {
    function: function_,
    loop: {
      header,
      latches: [body],
      blocks: [header, body],
    },
    bodyOperations: operations.filter((operation) =>
      [compare.operationId, increment.operationId, stepConst.operationId].includes(
        operation.operationId,
      ),
    ),
    operationById,
  };
}

function memoryProgressionLoopFixtureForTest() {
  const originId = optIrOriginId(2);
  const header = optIrBlockId(10);
  const latch = optIrBlockId(11);
  const region = optIrRegionId(5);
  const load0 = requireMemoryLoadForTripCountTest({
    operationId: optIrOperationId(21),
    resultId: optIrValueId(300),
    region,
    byteOffset: 0n,
    originId,
  });
  const load1 = requireMemoryLoadForTripCountTest({
    operationId: optIrOperationId(22),
    resultId: optIrValueId(301),
    region,
    byteOffset: 4n,
    originId,
  });
  const operations = [load0, load1];
  const operationById = new Map(operations.map((operation) => [operation.operationId, operation]));
  const function_ = {
    functionId: optIrFunctionId(2),
    monoInstanceId: 0 as never,
    signature: {} as never,
    entryBlock: header,
    originId,
    blocks: [
      {
        blockId: header,
        parameters: [],
        operations: [load0.operationId],
        originId,
      },
      {
        blockId: latch,
        parameters: [],
        operations: [load1.operationId],
        originId,
      },
    ],
    edges: optIrCfgEdgeTable([
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
    ]),
  };

  return {
    function: function_,
    loop: { header, latches: [latch], blocks: [header, latch] },
    bodyOperations: operations,
    operationById,
  };
}

function requireMemoryLoadForTripCountTest(input: {
  readonly operationId: ReturnType<typeof optIrOperationId>;
  readonly resultId: ReturnType<typeof optIrValueId>;
  readonly region: ReturnType<typeof optIrRegionId>;
  readonly byteOffset: bigint;
  readonly originId: ReturnType<typeof optIrOriginId>;
}): OptIrOperation {
  const result = optIrMemoryLoadOperation({
    operationId: input.operationId,
    resultId: input.resultId,
    region: input.region,
    byteOffset: input.byteOffset,
    byteWidth: 4,
    alignment: 4,
    valueType: optIrUnsignedIntegerType(32),
    endian: "little",
    volatility: "nonVolatile",
    boundsAuthority: { kind: "targetContract", authorityKey: "loop-trip-test" },
    originId: input.originId,
  });
  if (result.kind !== "ok") {
    throw new Error("fixture memory load must be valid");
  }
  return result.operation;
}
