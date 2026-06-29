import { monoInstanceId } from "../../../src/mono/ids";
import {
  optIrAliasClassId,
  optIrBlockId,
  optIrCallId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import type { OptIrBlock, OptIrEdge } from "../../../src/opt-ir/cfg";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import { optIrFunctionForTest } from "./cfg-fakes";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import {
  optIrIntegerBinaryOperation,
  optIrPlatformCallOperation,
  optIrRuntimeCallOperation,
  optIrSourceCallOperation,
} from "../../../src/opt-ir/operations";
import type { OptIrRegion } from "../../../src/opt-ir/regions";
import type { OptIrFunction, OptIrProgram } from "../../../src/opt-ir/program";
import { optIrFunctionTable, optIrProgram, optIrRegionTable } from "../../../src/opt-ir/program";
import type { OptIrOperation } from "../../../src/opt-ir/operations";
import type { OptIrTerminator } from "../../../src/opt-ir/terminators";
import type { OptIrCallGraphInput } from "../../../src/opt-ir/analyses/call-graph";
import type { OptIrCallGraphSccInput } from "../../../src/opt-ir/analyses/scc";
import type { OptIrEscapeAnalysisInput } from "../../../src/opt-ir/analyses/escape-analysis";
import type { OptIrAliasAnalysisInput } from "../../../src/opt-ir/analyses/alias-analysis";
import { targetId } from "../../../src/semantic/ids";

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

export interface LoopTreeAnalysisFixture {
  readonly func: OptIrFunction;
  readonly blocks: {
    readonly entry: OptIrBlock;
    readonly header: OptIrBlock;
    readonly body: OptIrBlock;
    readonly latch: OptIrBlock;
    readonly exit: OptIrBlock;
    readonly cold: OptIrBlock;
  };
}

export interface CallGraphAnalysisFixture {
  readonly program: OptIrProgram;
  readonly operationForId: OptIrCallGraphInput["operationForId"];
  readonly callbacks: OptIrCallGraphInput["callbacks"];
  readonly unknownCalls: OptIrCallGraphInput["unknownCalls"];
  readonly recursiveGraph: OptIrCallGraphSccInput;
  readonly functions: {
    readonly entry: OptIrFunction;
    readonly worker: OptIrFunction;
  };
}

export interface EscapeAnalysisFixture {
  readonly input: OptIrEscapeAnalysisInput;
  readonly regions: Record<
    "addressTaken" | "callback" | "exported" | "unknownCall" | "externalFlow" | "localOnly",
    OptIrRegion
  >;
}

export interface AliasAnalysisFixture {
  readonly input: OptIrAliasAnalysisInput;
  readonly regions: Record<"stackA" | "stackB" | "packet" | "payload", OptIrRegion>;
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

export function loopTreeAnalysisFixture(): LoopTreeAnalysisFixture {
  const entry = block({
    blockId: optIrBlockId(101),
    operations: [],
    terminator: {
      kind: "jump",
      operationId: optIrOperationId(101),
      edge: optIrEdgeId(101),
      originId,
    },
  });
  const header = block({
    blockId: optIrBlockId(102),
    operations: [],
    terminator: {
      kind: "branch",
      operationId: optIrOperationId(102),
      condition: optIrValueId(102),
      trueEdge: optIrEdgeId(102),
      falseEdge: optIrEdgeId(105),
      originId,
    },
  });
  const body = block({
    blockId: optIrBlockId(103),
    operations: [],
    terminator: {
      kind: "jump",
      operationId: optIrOperationId(103),
      edge: optIrEdgeId(103),
      originId,
    },
  });
  const latch = block({
    blockId: optIrBlockId(104),
    operations: [],
    terminator: {
      kind: "branch",
      operationId: optIrOperationId(104),
      condition: optIrValueId(103),
      trueEdge: optIrEdgeId(104),
      falseEdge: optIrEdgeId(106),
      originId,
    },
  });
  const exit = block({
    blockId: optIrBlockId(105),
    operations: [],
    terminator: {
      kind: "return",
      operationId: optIrOperationId(105),
      values: [],
      originId,
    },
  });
  const cold = block({
    blockId: optIrBlockId(106),
    operations: [],
    terminator: {
      kind: "unreachable",
      operationId: optIrOperationId(106),
      originId,
    },
  });

  const edges = [
    edge(optIrEdgeId(101), entry.blockId, header.blockId, "normal", []),
    edge(optIrEdgeId(102), header.blockId, body.blockId, "branchTrue", []),
    edge(optIrEdgeId(103), body.blockId, latch.blockId, "normal", []),
    edge(optIrEdgeId(104), latch.blockId, header.blockId, "scopeContinue", []),
    edge(optIrEdgeId(105), header.blockId, exit.blockId, "normal", []),
    edge(optIrEdgeId(106), latch.blockId, cold.blockId, "panicExit", []),
  ];

  return {
    func: optIrFunctionForTest({
      functionId: optIrFunctionId(101),
      monoInstanceId: monoInstanceId("analysis::loop"),
      blocks: [entry, header, body, latch, exit, cold],
      edges: optIrCfgEdgeTable(edges),
      entryBlock: entry.blockId,
      originId,
    }),
    blocks: { entry, header, body, latch, exit, cold },
  };
}

export function callGraphAnalysisFixture(): CallGraphAnalysisFixture {
  const sourceCall = optIrSourceCallOperation({
    operationId: optIrOperationId(201),
    callId: optIrCallId(201),
    resultIds: [],
    resultTypes: [],
    target: { kind: "source", functionInstanceId: monoInstanceId("analysis::worker") },
    argumentIds: [],
    originId,
  });
  const runtimeCall = optIrRuntimeCallOperation({
    operationId: optIrOperationId(202),
    callId: optIrCallId(202),
    resultIds: [],
    resultTypes: [],
    target: { kind: "runtime", runtimeKey: "alloc" },
    argumentIds: [],
    originId,
  });
  const platformCall = optIrPlatformCallOperation({
    operationId: optIrOperationId(203),
    callId: optIrCallId(203),
    resultIds: [],
    resultTypes: [],
    target: { kind: "platform", platformKey: "uefi.exit-boot-services" },
    argumentIds: [],
    originId,
  });
  const worker = functionWithOperations({
    functionId: optIrFunctionId(202),
    monoInstanceId: monoInstanceId("analysis::worker"),
    operations: [],
  });
  const entry = functionWithOperations({
    functionId: optIrFunctionId(201),
    monoInstanceId: monoInstanceId("analysis::entry"),
    operations: [sourceCall.operationId, runtimeCall.operationId, platformCall.operationId],
    externalRoot: { reason: "imageEntry", originId },
  });
  const operations = new Map([
    [Number(sourceCall.operationId), sourceCall],
    [Number(runtimeCall.operationId), runtimeCall],
    [Number(platformCall.operationId), platformCall],
  ]);

  return {
    program: optIrProgram({
      programId: optIrProgramId(201),
      targetId: targetId("analysis-target"),
      functions: optIrFunctionTable([entry, worker]),
      regions: optIrRegionTable([]),
      constants: { get: () => undefined, has: () => false, entries: () => [] },
      callGraph: { calls: [] },
      provenance: { originIds: [originId] },
    }),
    operationForId(operationId) {
      return operations.get(Number(operationId));
    },
    callbacks: [
      {
        kind: "callback",
        caller: worker.functionId,
        callee: entry.functionId,
        source: "hardwareCallback",
      },
    ],
    unknownCalls: [
      {
        kind: "unknownCall",
        caller: worker.functionId,
        callee: undefined,
        source: "extern:opaque",
      },
    ],
    recursiveGraph: {
      functions: [entry.functionId, worker.functionId],
      edges: [
        { kind: "source", caller: entry.functionId, callee: worker.functionId, source: "direct" },
        {
          kind: "callback",
          caller: worker.functionId,
          callee: entry.functionId,
          source: "hardwareCallback",
        },
        { kind: "unknownCall", caller: worker.functionId, callee: undefined, source: "opaque" },
      ],
    },
    functions: { entry, worker },
  };
}

export function escapeAnalysisFixture(): EscapeAnalysisFixture {
  const regions = {
    addressTaken: region(301, 301, "stackLocal"),
    callback: region(302, 302, "stackLocal"),
    exported: region(303, 303, "globalData"),
    unknownCall: region(304, 304, "stackLocal"),
    externalFlow: region(305, 305, "runtimeMemory"),
    localOnly: region(306, 306, "stackLocal"),
  };
  return {
    input: {
      regions: Object.values(regions),
      addressTakenLocals: [regions.addressTaken.regionId],
      callbackCaptures: [regions.callback.regionId],
      exportedRoots: [regions.exported.regionId],
      unknownCallRegions: [regions.unknownCall.regionId],
      externalFlowRegions: [regions.externalFlow.regionId],
    },
    regions,
  };
}

export function aliasAnalysisFixture(): AliasAnalysisFixture {
  const stackA = region(401, 401, "stackLocal");
  const stackB = region(402, 402, "stackLocal");
  const packet = region(403, 403, "packetSource");
  const payload = region(404, 403, "validatedPayload");
  return {
    input: {
      regions: [stackA, stackB, packet, payload],
      factQuery: {
        mustNotAlias(subject) {
          return subject.kind === "regionPair" &&
            subject.left === stackA.regionId &&
            subject.right === stackB.regionId
            ? {
                kind: "yes",
                factsUsed: [],
                explanation: ["fixture noalias fact"],
              }
            : {
                kind: "unknown",
                factsUsed: [],
                explanation: ["fixture has no noalias fact"],
              };
        },
      },
    },
    regions: { stackA, stackB, packet, payload },
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

function functionWithOperations(input: {
  readonly functionId: ReturnType<typeof optIrFunctionId>;
  readonly monoInstanceId: ReturnType<typeof monoInstanceId>;
  readonly operations: readonly ReturnType<typeof optIrOperationId>[];
  readonly externalRoot?: OptIrFunction["externalRoot"];
}): OptIrFunction {
  const entry = block({
    blockId: optIrBlockId(Number(input.functionId) * 10),
    operations: input.operations,
    terminator: {
      kind: "return",
      operationId: optIrOperationId(Number(input.functionId) * 10 + 1),
      values: [],
      originId,
    },
  });
  return optIrFunctionForTest({
    functionId: input.functionId,
    monoInstanceId: input.monoInstanceId,
    blocks: [entry],
    edges: optIrCfgEdgeTable([]),
    entryBlock: entry.blockId,
    originId,
    externalRoot: input.externalRoot,
  });
}

function region(regionId: number, aliasClass: number, kind: OptIrRegion["kind"]): OptIrRegion {
  return {
    regionId: optIrRegionId(regionId),
    kind,
    owner: { kind: "program" },
    lifetime: kind === "stackLocal" ? "activation" : "program",
    aliasClass: optIrAliasClassId(aliasClass),
    volatility: "nonVolatile",
    effects: {
      mutability: kind === "constantData" ? "readOnly" : "mutable",
      ordering: kind === "runtimeMemory" ? "orderedEffectToken" : "readOnlyRegionVersion",
    },
    origin: { originId, source: { file: "analysis-fixture" } },
  };
}
