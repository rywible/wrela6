import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
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
  type OptIrOperationId,
  type OptIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrConstantOperation,
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrMemoryLoadOperation,
  optIrRuntimeCallOperation,
  optIrProofErasedMarkerOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
  type OptIrFunction,
  type OptIrProgram,
} from "../../../src/opt-ir/program";
import { optIrSwitchTerminator } from "../../../src/opt-ir/terminators";
import { optIrSignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";

export const dataflowIntegerType = optIrSignedIntegerType(32);

export function operationTableForDataflowTest(
  operations: readonly OptIrOperation[],
): ReadonlyMap<OptIrOperationId, OptIrOperation> {
  return new Map(operations.map((operation) => [operation.operationId, operation]));
}

export function constantOperationForDataflowTest(
  operation: number,
  value: number,
  normalizedValue: bigint,
): OptIrOperation {
  return optIrConstantOperation({
    operationId: optIrOperationId(operation),
    resultId: optIrValueId(value),
    constant: optIrIntegerConstant({
      constantId: optIrConstantId(operation),
      type: dataflowIntegerType,
      normalizedValue,
    }),
    originId: optIrOriginId(1),
  });
}

export function programWithStaticSwitchForTest(input: { readonly discriminant: bigint }): {
  readonly program: OptIrProgram;
  readonly function: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
} {
  const discriminant = constantOperationForDataflowTest(1, 10, input.discriminant);
  const case4Parameter = optIrBlockParameter({
    valueId: optIrValueId(20),
    type: dataflowIntegerType,
    incomingRole: "branchArgument",
    originId: optIrOriginId(1),
  });
  const case4Addend = constantOperationForDataflowTest(2, 11, 8n);
  const case4Sum = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(3),
    resultId: optIrValueId(21),
    left: case4Parameter.valueId,
    right: case4Addend.resultIds[0] ?? optIrValueId(0),
    operator: "add",
    resultType: dataflowIntegerType,
    originId: optIrOriginId(1),
  });
  const deadCase = constantOperationForDataflowTest(4, 30, 99n);
  const defaultCase = constantOperationForDataflowTest(5, 40, -1n);
  const blocks: readonly OptIrBlock[] = [
    {
      blockId: optIrBlockId(1),
      parameters: [],
      operations: [discriminant.operationId],
      terminator: optIrSwitchTerminator({
        operationId: optIrOperationId(50),
        scrutinee: discriminant.resultIds[0] ?? optIrValueId(0),
        cases: [
          { label: "4", edge: optIrEdgeId(1) },
          { label: "9", edge: optIrEdgeId(2) },
        ],
        defaultEdge: optIrEdgeId(3),
        originId: optIrOriginId(1),
      }),
      originId: optIrOriginId(1),
    },
    {
      blockId: optIrBlockId(2),
      parameters: [case4Parameter],
      operations: [case4Addend.operationId, case4Sum.operationId],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(51),
        values: [case4Sum.resultIds[0] ?? optIrValueId(0)],
        originId: optIrOriginId(1),
      },
      originId: optIrOriginId(1),
    },
    {
      blockId: optIrBlockId(3),
      parameters: [],
      operations: [deadCase.operationId],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(52),
        values: [deadCase.resultIds[0] ?? optIrValueId(0)],
        originId: optIrOriginId(1),
      },
      originId: optIrOriginId(1),
    },
    {
      blockId: optIrBlockId(4),
      parameters: [],
      operations: [defaultCase.operationId],
      terminator: {
        kind: "return",
        operationId: optIrOperationId(53),
        values: [defaultCase.resultIds[0] ?? optIrValueId(0)],
        originId: optIrOriginId(1),
      },
      originId: optIrOriginId(1),
    },
  ];
  const edges: readonly OptIrEdge[] = [
    edge(1, 1, 2, "switchCase", [discriminant.resultIds[0] ?? optIrValueId(0)], "4"),
    edge(2, 1, 3, "switchCase", [], "9"),
    edge(3, 1, 4, "switchCase", [], undefined),
  ];
  return fixtureProgram(blocks, edges, [
    discriminant,
    case4Addend,
    case4Sum,
    deadCase,
    defaultCase,
  ]);
}

export function onlySwitchCaseSurvivesForTest(expectedLabel: string) {
  return (program: OptIrProgram): boolean => {
    const outputFunction = program.functions.entries()[0];
    return (
      outputFunction?.blocks.map((block) => block.blockId).join(",") ===
        `${optIrBlockId(1)},${optIrBlockId(2)}` &&
      outputFunction.edges.entries().every((candidate) => candidate.switchCase === expectedLabel)
    );
  };
}

export function programWithPureDuplicateOperationsForTest(): {
  readonly program: OptIrProgram;
  readonly function: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
} {
  const left = constantOperationForDataflowTest(1, 10, 2n);
  const right = constantOperationForDataflowTest(2, 11, 3n);
  const first = binaryAdd(3, 12, left, right);
  const duplicate = binaryAdd(4, 13, left, right);
  const compare = optIrIntegerCompareOperation({
    operationId: optIrOperationId(5),
    resultId: optIrValueId(14),
    left: first.resultIds[0] ?? optIrValueId(0),
    right: duplicate.resultIds[0] ?? optIrValueId(0),
    operator: "equal",
    originId: optIrOriginId(1),
  });
  return fixtureProgram(
    [
      block(
        1,
        [
          left.operationId,
          right.operationId,
          first.operationId,
          duplicate.operationId,
          compare.operationId,
        ],
        [compare.resultIds[0] ?? optIrValueId(0)],
      ),
    ],
    [],
    [left, right, first, duplicate, compare],
  );
}

export function programWithOrderSensitiveOperationsForTest(): {
  readonly program: OptIrProgram;
  readonly function: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
} {
  const left = constantOperationForDataflowTest(1, 10, 7n);
  const right = constantOperationForDataflowTest(2, 11, 3n);
  const first = binarySubtract(3, 12, left, right);
  const reversed = binarySubtract(4, 13, right, left);
  return fixtureProgram(
    [block(1, [left.operationId, right.operationId, first.operationId, reversed.operationId])],
    [],
    [left, right, first, reversed],
  );
}

export function programWithNonCommonableOperationsForTest(): {
  readonly program: OptIrProgram;
  readonly function: OptIrFunction;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
} {
  const address = constantOperationForDataflowTest(1, 10, 0n);
  const firstLoad = memoryLoad(2, 11, "nonVolatile");
  const secondLoad = memoryLoad(3, 12, "nonVolatile");
  const volatileLoad = memoryLoad(4, 13, "volatile");
  const runtimeCall = optIrRuntimeCallOperation({
    operationId: optIrOperationId(5),
    callId: 1 as never,
    target: { kind: "runtime", runtimeKey: "clock" },
    argumentIds: [address.resultIds[0] ?? optIrValueId(0)],
    resultIds: [optIrValueId(14)],
    resultTypes: [dataflowIntegerType],
    originId: optIrOriginId(1),
  });
  const marker = optIrProofErasedMarkerOperation({
    operationId: optIrOperationId(6),
    erasedProof: "range-proof",
    originId: optIrOriginId(1),
  });
  return fixtureProgram(
    [
      block(1, [
        address.operationId,
        firstLoad.operationId,
        secondLoad.operationId,
        volatileLoad.operationId,
        runtimeCall.operationId,
        marker.operationId,
      ]),
    ],
    [],
    [address, firstLoad, secondLoad, volatileLoad, runtimeCall, marker],
  );
}

function fixtureProgram(
  blocks: readonly OptIrBlock[],
  edges: readonly OptIrEdge[],
  operations: readonly OptIrOperation[],
) {
  const functionInput: OptIrFunction = {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("test::dataflow"),
    signature: {} as never,
    blocks,
    edges: optIrCfgEdgeTable(edges),
    entryBlock: blocks[0]?.blockId ?? optIrBlockId(1),
    originId: optIrOriginId(1),
  };
  const program = optIrProgram({
    programId: optIrProgramId(1),
    targetId: targetId("test-target"),
    functions: optIrFunctionTable([functionInput]),
    regions: optIrRegionTable([{ regionId: optIrRegionId(1), originId: optIrOriginId(1) }]),
    constants: optIrConstantTable([]),
    callGraph: { calls: [] },
    provenance: { originIds: [optIrOriginId(1)] },
  });
  return {
    program,
    function: functionInput,
    operations: operationTableForDataflowTest(operations),
  };
}

function edge(
  edgeNumber: number,
  sourceBlock: number,
  targetBlock: number,
  kind: OptIrEdge["kind"],
  argumentsForEdge: readonly OptIrValueId[],
  switchCase: string | undefined,
): OptIrEdge {
  return {
    edgeId: optIrEdgeId(edgeNumber),
    from: optIrBlockId(sourceBlock),
    toBlock: optIrBlockId(targetBlock),
    ordinal: edgeNumber,
    kind,
    arguments: argumentsForEdge,
    ...(switchCase === undefined ? {} : { switchCase }),
    originId: optIrOriginId(1),
  };
}

function block(
  blockNumber: number,
  operations: readonly OptIrOperationId[],
  returnValues: readonly OptIrValueId[] = [],
): OptIrBlock {
  return {
    blockId: optIrBlockId(blockNumber),
    parameters: [],
    operations,
    terminator: {
      kind: "return",
      operationId: optIrOperationId(100 + blockNumber),
      values: returnValues,
      originId: optIrOriginId(1),
    },
    originId: optIrOriginId(1),
  };
}

function binaryAdd(
  operation: number,
  result: number,
  left: OptIrOperation,
  right: OptIrOperation,
): OptIrOperation {
  return optIrIntegerBinaryOperation({
    operationId: optIrOperationId(operation),
    resultId: optIrValueId(result),
    left: left.resultIds[0] ?? optIrValueId(0),
    right: right.resultIds[0] ?? optIrValueId(0),
    operator: "add",
    resultType: dataflowIntegerType,
    originId: optIrOriginId(1),
  });
}

function binarySubtract(
  operation: number,
  result: number,
  left: OptIrOperation,
  right: OptIrOperation,
): OptIrOperation {
  return optIrIntegerBinaryOperation({
    operationId: optIrOperationId(operation),
    resultId: optIrValueId(result),
    left: left.resultIds[0] ?? optIrValueId(0),
    right: right.resultIds[0] ?? optIrValueId(0),
    operator: "subtract",
    resultType: dataflowIntegerType,
    originId: optIrOriginId(1),
  });
}

function memoryLoad(
  operation: number,
  result: number,
  volatility: "volatile" | "nonVolatile",
): OptIrOperation {
  const loaded = optIrMemoryLoadOperation({
    operationId: optIrOperationId(operation),
    region: optIrRegionId(1),
    byteOffset: 0n,
    byteWidth: 4,
    alignment: 4,
    valueType: dataflowIntegerType,
    endian: "little",
    volatility,
    boundsAuthority: { kind: "targetContract", authorityKey: "test" },
    resultId: optIrValueId(result),
    originId: optIrOriginId(1),
  });
  if (loaded.kind !== "ok") {
    throw new Error("fixture memory load must be valid");
  }
  return loaded.operation;
}
