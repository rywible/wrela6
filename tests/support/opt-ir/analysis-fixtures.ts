import { monoInstanceId } from "../../../src/mono/ids";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import type { OptIrBlock, OptIrEdge } from "../../../src/opt-ir/cfg";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import { optIrFunctionForTest } from "./cfg-fakes";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import { optIrIntegerBinaryOperation } from "../../../src/opt-ir/operations";
import type { OptIrFunction } from "../../../src/opt-ir/program";
import type { OptIrOperation } from "../../../src/opt-ir/operations";
import type { OptIrTerminator } from "../../../src/opt-ir/terminators";

const originId = optIrOriginId(27);
const integerType = optIrUnsignedIntegerType(32);

export interface DiamondAnalysisFixture {
  readonly func: OptIrFunction;
  readonly operations: ReadonlyMap<number, OptIrOperation>;
  readonly blocks: {
    readonly entry: OptIrBlock;
    readonly thenBlock: OptIrBlock;
    readonly elseBlock: OptIrBlock;
    readonly join: OptIrBlock;
  };
}

export interface LinearAnalysisFixture {
  readonly func: OptIrFunction;
  readonly blocks: {
    readonly entry: OptIrBlock;
    readonly middle: OptIrBlock;
    readonly exit: OptIrBlock;
  };
}

export function linearAnalysisFixture(): LinearAnalysisFixture {
  const entry = block({
    blockId: optIrBlockId(11),
    operations: [],
    terminator: {
      kind: "jump",
      operationId: optIrOperationId(110),
      edge: optIrEdgeId(110),
      originId,
    },
  });
  const middle = block({
    blockId: optIrBlockId(12),
    operations: [],
    terminator: {
      kind: "jump",
      operationId: optIrOperationId(120),
      edge: optIrEdgeId(120),
      originId,
    },
  });
  const exit = block({
    blockId: optIrBlockId(13),
    operations: [],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(130),
      values: [],
      originId,
    },
  });

  return {
    func: optIrFunctionForTest({
      functionId: optIrFunctionId(28),
      monoInstanceId: monoInstanceId("analysis::linear"),
      blocks: [entry, middle, exit],
      edges: optIrCfgEdgeTable([
        edge(optIrEdgeId(110), entry.blockId, middle.blockId, "normal", []),
        edge(optIrEdgeId(120), middle.blockId, exit.blockId, "normal", []),
      ]),
      entryBlock: entry.blockId,
      originId,
    }),
    blocks: { entry, middle, exit },
  };
}

export function diamondAnalysisFixture(): DiamondAnalysisFixture {
  const entryArgument = optIrValueId(10);
  const condition = optIrValueId(11);
  const thenValue = optIrValueId(20);
  const elseValue = optIrValueId(30);
  const joinParameter = optIrValueId(40);
  const returnValue = optIrValueId(41);

  const thenOperation = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(20),
    resultId: thenValue,
    left: entryArgument,
    right: condition,
    operator: "add",
    resultType: integerType,
    originId,
  });
  const elseOperation = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(30),
    resultId: elseValue,
    left: entryArgument,
    right: condition,
    operator: "subtract",
    resultType: integerType,
    originId,
  });
  const joinOperation = optIrIntegerBinaryOperation({
    operationId: optIrOperationId(40),
    resultId: returnValue,
    left: joinParameter,
    right: entryArgument,
    operator: "add",
    resultType: integerType,
    originId,
  });

  const entry = block({
    blockId: optIrBlockId(1),
    parameters: [entryArgument, condition],
    operations: [],
    terminator: {
      kind: "branch",
      operationId: optIrOperationId(10),
      condition,
      trueEdge: optIrEdgeId(10),
      falseEdge: optIrEdgeId(11),
      originId,
    },
  });
  const thenBlock = block({
    blockId: optIrBlockId(2),
    operations: [thenOperation.operationId],
    terminator: {
      kind: "jump",
      operationId: optIrOperationId(21),
      edge: optIrEdgeId(20),
      originId,
    },
  });
  const elseBlock = block({
    blockId: optIrBlockId(3),
    operations: [elseOperation.operationId],
    terminator: {
      kind: "jump",
      operationId: optIrOperationId(31),
      edge: optIrEdgeId(30),
      originId,
    },
  });
  const join = block({
    blockId: optIrBlockId(4),
    parameters: [joinParameter],
    operations: [joinOperation.operationId],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(41),
      values: [returnValue, condition],
      originId,
    },
  });

  const edges: readonly OptIrEdge[] = [
    edge(optIrEdgeId(10), entry.blockId, thenBlock.blockId, "branchTrue", []),
    edge(optIrEdgeId(11), entry.blockId, elseBlock.blockId, "branchFalse", []),
    edge(optIrEdgeId(20), thenBlock.blockId, join.blockId, "normal", [thenValue]),
    edge(optIrEdgeId(30), elseBlock.blockId, join.blockId, "normal", [elseValue]),
  ];

  return {
    func: optIrFunctionForTest({
      functionId: optIrFunctionId(27),
      monoInstanceId: monoInstanceId("analysis::diamond"),
      blocks: [entry, thenBlock, elseBlock, join],
      edges: optIrCfgEdgeTable(edges),
      entryBlock: entry.blockId,
      originId,
    }),
    operations: new Map([
      [Number(thenOperation.operationId), thenOperation],
      [Number(elseOperation.operationId), elseOperation],
      [Number(joinOperation.operationId), joinOperation],
    ]),
    blocks: { entry, thenBlock, elseBlock, join },
  };
}

function block(input: {
  readonly blockId: OptIrBlock["blockId"];
  readonly parameters?: readonly ReturnType<typeof optIrValueId>[];
  readonly operations: readonly ReturnType<typeof optIrOperationId>[];
  readonly terminator: OptIrTerminator;
}): OptIrBlock {
  return {
    blockId: input.blockId,
    parameters: (input.parameters ?? []).map((valueId) =>
      optIrBlockParameter({
        valueId,
        type: integerType,
        incomingRole: "phi",
        originId,
      }),
    ),
    operations: input.operations,
    terminator: input.terminator,
    originId,
  };
}

function edge(
  edgeId: OptIrEdge["edgeId"],
  from: OptIrEdge["from"],
  toBlock: NonNullable<OptIrEdge["toBlock"]>,
  kind: OptIrEdge["kind"],
  args: readonly ReturnType<typeof optIrValueId>[],
): OptIrEdge {
  return {
    edgeId,
    from,
    toBlock,
    ordinal: Number(edgeId),
    kind,
    arguments: args,
    originId,
  };
}
