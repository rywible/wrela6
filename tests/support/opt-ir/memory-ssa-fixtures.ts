import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import type { OptIrLoweredCallHeaderWithTokenExpectations } from "../../../src/opt-ir/analyses/effect-tokens";
import { buildOptIrRegionsForTest } from "../../../src/opt-ir/lower/region-builder";
import {
  optIrBlockId,
  optIrCallId,
  optIrEdgeId,
  optIrFactId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import type { OptIrRegion } from "../../../src/opt-ir/regions";
import type { OptIrOperation } from "../../../src/opt-ir/operations";
import {
  optIrMemoryLoadOperation,
  optIrMemoryStoreOperation,
  optIrRuntimeCallOperation,
} from "../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType, optIrUnitType } from "../../../src/opt-ir/types";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import { edgeForTest, optIrBlockForTest, optIrFunctionForTest } from "./cfg-fakes";
import { optIrFunctionTable, optIrProgram } from "../../../src/opt-ir/program";
import type { OptIrMemorySsaBuildInput } from "../../../src/opt-ir/analyses/memory-ssa";

const originId = optIrOriginId(1);
const byteType = optIrUnsignedIntegerType(8);

export function stackStoresFixtureForTest(): OptIrMemorySsaBuildInput & {
  readonly namedRegions: { readonly stack: OptIrRegion };
} {
  const regions = buildOptIrRegionsForTest({ stackLocals: [{ key: "slot" }] });
  const stack = requiredRegion(regions.lookup("stackLocal", "slot")?.region);
  const operations = [
    requiredOperation(
      optIrMemoryStoreOperation({
        operationId: optIrOperationId(1),
        storeValue: optIrValueId(10),
        region: stack.regionId,
        byteOffset: 0n,
        byteWidth: 1,
        alignment: 1,
        valueType: byteType,
        endian: "native",
        volatility: stack.volatility,
        boundsAuthority: { kind: "targetContract", authorityKey: "stack.slot" },
        originId,
      }),
    ),
    requiredOperation(
      optIrMemoryStoreOperation({
        operationId: optIrOperationId(2),
        storeValue: optIrValueId(11),
        region: stack.regionId,
        byteOffset: 1n,
        byteWidth: 1,
        alignment: 1,
        valueType: byteType,
        endian: "native",
        volatility: stack.volatility,
        boundsAuthority: { kind: "targetContract", authorityKey: "stack.slot" },
        originId,
      }),
    ),
  ];
  return { ...inputFor(operations, regions.entries()), namedRegions: { stack } };
}

export function outOfOrderOperationIdStoresFixtureForTest(): OptIrMemorySsaBuildInput & {
  readonly namedRegions: { readonly stack: OptIrRegion };
} {
  const regions = buildOptIrRegionsForTest({ stackLocals: [{ key: "slot" }] });
  const stack = requiredRegion(regions.lookup("stackLocal", "slot")?.region);
  const firstInBlock = requiredOperation(
    optIrMemoryStoreOperation({
      operationId: optIrOperationId(2),
      storeValue: optIrValueId(10),
      region: stack.regionId,
      byteOffset: 0n,
      byteWidth: 1,
      alignment: 1,
      valueType: byteType,
      endian: "native",
      volatility: stack.volatility,
      boundsAuthority: { kind: "targetContract", authorityKey: "stack.slot" },
      originId,
    }),
  );
  const secondInBlock = requiredOperation(
    optIrMemoryStoreOperation({
      operationId: optIrOperationId(1),
      storeValue: optIrValueId(11),
      region: stack.regionId,
      byteOffset: 1n,
      byteWidth: 1,
      alignment: 1,
      valueType: byteType,
      endian: "native",
      volatility: stack.volatility,
      boundsAuthority: { kind: "targetContract", authorityKey: "stack.slot" },
      originId,
    }),
  );
  return {
    ...inputFor([firstInBlock, secondInBlock], regions.entries()),
    namedRegions: { stack },
  };
}

export function cfgOrderedStoreLoadFixtureForTest(): OptIrMemorySsaBuildInput & {
  readonly namedRegions: { readonly stack: OptIrRegion };
} {
  const regions = buildOptIrRegionsForTest({ stackLocals: [{ key: "slot" }] });
  const stack = requiredRegion(regions.lookup("stackLocal", "slot")?.region);
  const storeOperation = requiredOperation(
    optIrMemoryStoreOperation({
      operationId: optIrOperationId(1),
      storeValue: optIrValueId(10),
      region: stack.regionId,
      byteOffset: 0n,
      byteWidth: 1,
      alignment: 1,
      valueType: byteType,
      endian: "native",
      volatility: stack.volatility,
      boundsAuthority: { kind: "targetContract", authorityKey: "stack.slot" },
      originId,
    }),
  );
  const loadOperation = requiredOperation(
    optIrMemoryLoadOperation({
      operationId: optIrOperationId(2),
      resultId: optIrValueId(20),
      region: stack.regionId,
      byteOffset: 0n,
      byteWidth: 1,
      alignment: 1,
      valueType: byteType,
      endian: "native",
      volatility: stack.volatility,
      boundsAuthority: { kind: "targetContract", authorityKey: "stack.slot" },
      originId,
    }),
  );
  const edgeId = optIrEdgeId(1);
  const entryBlock = optIrBlockForTest({
    blockId: optIrBlockId(10),
    parameters: [],
    operations: [storeOperation.operationId],
    terminator: { kind: "jump", operationId: optIrOperationId(90), edge: edgeId, originId },
    originId,
  });
  const successorBlock = optIrBlockForTest({
    blockId: optIrBlockId(1),
    parameters: [],
    operations: [loadOperation.operationId],
    terminator: { kind: "return", operationId: optIrOperationId(91), values: [], originId },
    originId,
  });
  return {
    ...inputForBlocks({
      blocks: [entryBlock, successorBlock],
      edges: [edgeForTest({ edgeId, from: entryBlock.blockId, toBlock: successorBlock.blockId })],
      entryBlock: entryBlock.blockId,
      operations: [storeOperation, loadOperation],
      regions: regions.entries(),
    }),
    namedRegions: { stack },
  };
}

export function joinWithPartialStoreFixtureForTest(): OptIrMemorySsaBuildInput & {
  readonly namedRegions: { readonly stack: OptIrRegion };
} {
  const regions = buildOptIrRegionsForTest({ stackLocals: [{ key: "slot" }] });
  const stack = requiredRegion(regions.lookup("stackLocal", "slot")?.region);
  const storeOperation = requiredOperation(
    optIrMemoryStoreOperation({
      operationId: optIrOperationId(1),
      storeValue: optIrValueId(10),
      region: stack.regionId,
      byteOffset: 0n,
      byteWidth: 1,
      alignment: 1,
      valueType: byteType,
      endian: "native",
      volatility: stack.volatility,
      boundsAuthority: { kind: "targetContract", authorityKey: "stack.slot" },
      originId,
    }),
  );
  const loadOperation = requiredOperation(
    optIrMemoryLoadOperation({
      operationId: optIrOperationId(2),
      resultId: optIrValueId(20),
      region: stack.regionId,
      byteOffset: 0n,
      byteWidth: 1,
      alignment: 1,
      valueType: byteType,
      endian: "native",
      volatility: stack.volatility,
      boundsAuthority: { kind: "targetContract", authorityKey: "stack.slot" },
      originId,
    }),
  );
  const trueEdge = optIrEdgeId(1);
  const falseEdge = optIrEdgeId(2);
  const thenJoinEdge = optIrEdgeId(3);
  const elseJoinEdge = optIrEdgeId(4);
  const entryBlock = optIrBlockForTest({
    blockId: optIrBlockId(10),
    parameters: [],
    operations: [],
    terminator: {
      kind: "branch",
      operationId: optIrOperationId(90),
      condition: optIrValueId(99),
      trueEdge,
      falseEdge,
      originId,
    },
    originId,
  });
  const thenBlock = optIrBlockForTest({
    blockId: optIrBlockId(20),
    parameters: [],
    operations: [storeOperation.operationId],
    terminator: { kind: "jump", operationId: optIrOperationId(91), edge: thenJoinEdge, originId },
    originId,
  });
  const elseBlock = optIrBlockForTest({
    blockId: optIrBlockId(30),
    parameters: [],
    operations: [],
    terminator: { kind: "jump", operationId: optIrOperationId(92), edge: elseJoinEdge, originId },
    originId,
  });
  const joinBlock = optIrBlockForTest({
    blockId: optIrBlockId(40),
    parameters: [],
    operations: [loadOperation.operationId],
    terminator: { kind: "return", operationId: optIrOperationId(93), values: [], originId },
    originId,
  });
  return {
    ...inputForBlocks({
      blocks: [entryBlock, thenBlock, elseBlock, joinBlock],
      edges: [
        edgeForTest({ edgeId: trueEdge, from: entryBlock.blockId, toBlock: thenBlock.blockId }),
        edgeForTest({ edgeId: falseEdge, from: entryBlock.blockId, toBlock: elseBlock.blockId }),
        edgeForTest({ edgeId: thenJoinEdge, from: thenBlock.blockId, toBlock: joinBlock.blockId }),
        edgeForTest({ edgeId: elseJoinEdge, from: elseBlock.blockId, toBlock: joinBlock.blockId }),
      ],
      entryBlock: entryBlock.blockId,
      operations: [storeOperation, loadOperation],
      regions: regions.entries(),
    }),
    namedRegions: { stack },
  };
}

export function constantOnlyMemoryFixtureForTest(): OptIrMemorySsaBuildInput & {
  readonly namedRegions: { readonly constant: OptIrRegion };
} {
  const regions = buildOptIrRegionsForTest({ constants: [{ key: "table" }] });
  const constant = requiredRegion(regions.lookup("constantData", "table")?.region);
  const operation = requiredOperation(
    optIrMemoryLoadOperation({
      operationId: optIrOperationId(1),
      resultId: optIrValueId(12),
      region: constant.regionId,
      byteOffset: 0n,
      byteWidth: 1,
      alignment: 1,
      valueType: byteType,
      endian: "native",
      volatility: constant.volatility,
      boundsAuthority: { kind: "targetContract", authorityKey: "constant.table" },
      originId,
    }),
  );
  return { ...inputFor([operation], regions.entries()), namedRegions: { constant } };
}

export function packetReadFixtureForTest(): OptIrMemorySsaBuildInput & {
  readonly namedRegions: { readonly packet: OptIrRegion };
} {
  const regions = buildOptIrRegionsForTest({ packetSources: [{ key: "packet", source: "rx" }] });
  const packet = requiredRegion(regions.lookup("packetSource", "packet")?.region);
  const operation = requiredOperation(
    optIrMemoryLoadOperation({
      operationId: optIrOperationId(1),
      resultId: optIrValueId(13),
      region: packet.regionId,
      byteOffset: 4n,
      byteWidth: 1,
      alignment: 1,
      valueType: byteType,
      endian: "big",
      volatility: packet.volatility,
      boundsAuthority: { kind: "certifiedFact", factId: optIrFactId(1) },
      originId,
    }),
  );
  return { ...inputFor([operation], regions.entries()), namedRegions: { packet } };
}

export function runtimeOrderedRegionFixtureForTest(): OptIrMemorySsaBuildInput {
  const regions = buildOptIrRegionsForTest({ runtimeMemory: [{ key: "log" }] });
  const operation = optIrRuntimeCallOperation({
    operationId: optIrOperationId(1),
    callId: optIrCallId(1),
    target: { kind: "runtime", runtimeKey: "runtime.write_log" },
    argumentIds: [],
    resultIds: [],
    resultTypes: [optIrUnitType()],
    originId,
  });
  return inputFor([operation], regions.entries(), [
    callHeader({
      callId: optIrCallId(1),
      runtimeKey: "runtime.write_log",
      orderedTokenKeys: ["runtime:log"],
    }),
  ]);
}

export function multiRegionCallFixtureForTest(): OptIrMemorySsaBuildInput {
  const regions = buildOptIrRegionsForTest({
    packetSources: [{ key: "packet", source: "rx" }],
    runtimeMemory: [{ key: "scratch" }],
    imageDevices: [{ key: "dma" }],
  });
  const operation = optIrRuntimeCallOperation({
    operationId: optIrOperationId(1),
    callId: optIrCallId(1),
    target: { kind: "runtime", runtimeKey: "runtime.copy_to_dma" },
    argumentIds: [],
    resultIds: [],
    resultTypes: [optIrUnitType()],
    originId,
  });
  return inputFor([operation], regions.entries(), [
    callHeader({
      callId: optIrCallId(1),
      runtimeKey: "runtime.copy_to_dma",
      readVersionTokenKeys: ["packet:rx-version"],
      orderedTokenKeys: ["runtime:scratch-order", "device:dma-order"],
      expectedTokenKeys: ["packet:rx-version", "runtime:scratch-order", "device:dma-order"],
    }),
  ]);
}

export function multiRegionCallDroppingOneTokenForTest(): OptIrMemorySsaBuildInput {
  const regions = buildOptIrRegionsForTest({
    packetSources: [{ key: "packet", source: "rx" }],
    runtimeMemory: [{ key: "scratch" }],
    imageDevices: [{ key: "dma" }],
  });
  const operation = optIrRuntimeCallOperation({
    operationId: optIrOperationId(1),
    callId: optIrCallId(1),
    target: { kind: "runtime", runtimeKey: "runtime.copy_to_dma" },
    argumentIds: [],
    resultIds: [],
    resultTypes: [optIrUnitType()],
    originId,
  });
  return inputFor([operation], regions.entries(), [
    callHeader({
      callId: optIrCallId(1),
      runtimeKey: "runtime.copy_to_dma",
      readVersionTokenKeys: ["packet:rx-version"],
      orderedTokenKeys: ["runtime:scratch-order"],
      expectedTokenKeys: ["packet:rx-version", "runtime:scratch-order", "device:dma-order"],
    }),
  ]);
}

function inputFor(
  operations: readonly OptIrOperation[],
  regions: readonly OptIrRegion[],
  loweredCallHeaders: readonly OptIrLoweredCallHeaderWithTokenExpectations[] = [],
): OptIrMemorySsaBuildInput {
  const block = optIrBlockForTest({
    blockId: optIrBlockId(1),
    parameters: [],
    operations: operations.map((operation) => operation.operationId),
    terminator: { kind: "return", operationId: optIrOperationId(99), values: [], originId },
    originId,
  });
  const func = optIrFunctionForTest({
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("memory::fixture"),
    blocks: [block],
    entryBlock: block.blockId,
    originId,
  });
  return {
    program: optIrProgram({
      programId: optIrProgramId(1),
      targetId: targetId("memory-ssa-test"),
      functions: optIrFunctionTable([func]),
      regions: {
        get: (regionId) =>
          regions.find((region) => region.regionId === regionId) === undefined
            ? undefined
            : { regionId, originId },
        has: (regionId) => regions.some((region) => region.regionId === regionId),
        entries: () => regions.map((region) => ({ regionId: region.regionId, originId })),
      },
      constants: { get: () => undefined, has: () => false, entries: () => [] },
      callGraph: { calls: [] },
      provenance: { originIds: [originId] },
    }),
    regions,
    operationForId: (operationId) =>
      operations.find((operation) => operation.operationId === operationId),
    loweredCallHeaderForId: (callId) =>
      loweredCallHeaders.find((header) => header.callId === callId),
  };
}

function inputForBlocks(input: {
  readonly blocks: readonly ReturnType<typeof optIrBlockForTest>[];
  readonly edges: readonly ReturnType<typeof edgeForTest>[];
  readonly entryBlock: ReturnType<typeof optIrBlockId>;
  readonly operations: readonly OptIrOperation[];
  readonly regions: readonly OptIrRegion[];
}): OptIrMemorySsaBuildInput {
  const func = optIrFunctionForTest({
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("memory::cfg-fixture"),
    blocks: input.blocks,
    edges: optIrCfgEdgeTable(input.edges),
    entryBlock: input.entryBlock,
    originId,
  });
  return {
    program: optIrProgram({
      programId: optIrProgramId(1),
      targetId: targetId("memory-ssa-test"),
      functions: optIrFunctionTable([func]),
      regions: {
        get: (regionId) =>
          input.regions.find((region) => region.regionId === regionId) === undefined
            ? undefined
            : { regionId, originId },
        has: (regionId) => input.regions.some((region) => region.regionId === regionId),
        entries: () => input.regions.map((region) => ({ regionId: region.regionId, originId })),
      },
      constants: { get: () => undefined, has: () => false, entries: () => [] },
      callGraph: { calls: [] },
      provenance: { originIds: [originId] },
    }),
    regions: input.regions,
    operationForId: (operationId) =>
      input.operations.find((operation) => operation.operationId === operationId),
  };
}

function callHeader(input: {
  readonly callId: ReturnType<typeof optIrCallId>;
  readonly runtimeKey: string;
  readonly readVersionTokenKeys?: readonly string[];
  readonly orderedTokenKeys?: readonly string[];
  readonly expectedTokenKeys?: readonly string[];
}): OptIrLoweredCallHeaderWithTokenExpectations {
  const requirements = [
    ...(input.readVersionTokenKeys ?? []).map((tokenKey) => ({
      mode: "readVersionToken" as const,
      tokenKey,
    })),
    ...(input.orderedTokenKeys ?? []).map((tokenKey) => ({
      mode: "orderedEffectToken" as const,
      tokenKey,
    })),
  ];
  return {
    callId: input.callId,
    target: { kind: "runtime", runtimeKey: input.runtimeKey },
    summary: { summaryId: input.runtimeKey, parameters: [], resultCount: 0 },
    abiShape: { callingConvention: "fixture", parameters: [], results: [] },
    effects: {
      requirements,
      priorObservableEffects: [],
      observedRegions: [],
      mutatedRegions: [],
      readVersionRegions: [...(input.readVersionTokenKeys ?? [])],
      orderedRegions: [...(input.orderedTokenKeys ?? [])],
      privateStateKeys: [],
      terminalKeys: [],
    },
    terminalBehavior: { kind: "returns" },
    resultFactHooks: [],
    ...(input.expectedTokenKeys === undefined
      ? {}
      : { expectedTokenKeys: input.expectedTokenKeys }),
  };
}

function requiredOperation(
  result:
    | ReturnType<typeof optIrMemoryLoadOperation>
    | ReturnType<typeof optIrMemoryStoreOperation>,
): OptIrOperation {
  if (result.kind !== "ok") {
    throw new Error("Expected fixture memory operation to construct.");
  }
  return result.operation;
}

function requiredRegion(region: OptIrRegion | undefined): OptIrRegion {
  if (region === undefined) {
    throw new Error("Expected fixture region.");
  }
  return region;
}
