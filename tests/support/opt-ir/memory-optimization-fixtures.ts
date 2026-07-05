import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import { OptIrDiagnosticSink } from "../../../src/opt-ir/diagnostics";
import {
  createOptIrFreshIdAllocator,
  type OptIrFreshIdAllocator,
} from "../../../src/opt-ir/id-allocation";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import {
  optIrAliasClassId,
  optIrBlockId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrMemoryLoadOperation,
  optIrMemoryStoreOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { optIrFunctionTable, optIrProgram, optIrRegionTable } from "../../../src/opt-ir/program";
import type { OptIrRegion, OptIrRegionKind } from "../../../src/opt-ir/regions";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import {
  runLicmForTest as runLicmRawForTest,
  type OptIrLicmInput,
} from "../../../src/opt-ir/passes/licm";
import type { OptIrPassContext } from "../../../src/opt-ir/passes/pass-execution";

export const originId = optIrOriginId(1);
export const byteType = optIrUnsignedIntegerType(8);
export const wordType = optIrUnsignedIntegerType(16);

export function runLicmForTest(
  input: Omit<OptIrLicmInput, "freshIds"> & {
    readonly freshIds?: OptIrFreshIdAllocator;
  },
) {
  return runLicmRawForTest({
    ...input,
    freshIds:
      input.freshIds ??
      createOptIrFreshIdAllocator({ program: input.program, operations: input.operations }),
  });
}

export function passContextForTest(
  passName: OptIrPassContext["passName"],
  program: OptIrLicmInput["program"],
  operations: OptIrLicmInput["operations"],
): OptIrPassContext {
  return {
    passName,
    verifierMode: "strict",
    diagnostics: new OptIrDiagnosticSink(),
    freshIds: createOptIrFreshIdAllocator({ program, operations }),
  };
}

export function fixture(operations: readonly OptIrOperation[], regions: readonly OptIrRegion[]) {
  const block = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: operations.map((operation) => operation.operationId),
    terminator: {
      kind: "return" as const,
      operationId: optIrOperationId(99),
      values: [],
      originId,
    },
    originId,
  };
  const func = {
    functionId: optIrFunctionId(1),
    monoInstanceId: monoInstanceId("memory-optimization::fixture"),
    signature: {} as MonoFunctionSignature,
    blocks: [block],
    edges: optIrCfgEdgeTable([]),
    entryBlock: block.blockId,
    originId,
  };
  const program = optIrProgram({
    programId: optIrProgramId(1),
    targetId: targetId("memory-optimization-test"),
    functions: optIrFunctionTable([func]),
    regions: optIrRegionTable(regions.map((region) => ({ regionId: region.regionId, originId }))),
    constants: { get: () => undefined, has: () => false, entries: () => [] },
    callGraph: { calls: [] },
    provenance: { originIds: [originId] },
  });
  return {
    program,
    regions,
    operations,
    operationForId(operationId: OptIrOperation["operationId"]) {
      return operations.find((operation) => operation.operationId === operationId);
    },
  };
}

export function branchJoinFixture(input: {
  readonly region: OptIrRegion;
  readonly condition: ReturnType<typeof optIrValueId>;
  readonly thenOperations: readonly OptIrOperation[];
  readonly elseOperations: readonly OptIrOperation[];
  readonly joinOperations: readonly OptIrOperation[];
}) {
  const trueEdge = optIrEdgeId(201);
  const falseEdge = optIrEdgeId(202);
  const thenJoinEdge = optIrEdgeId(203);
  const elseJoinEdge = optIrEdgeId(204);
  const entryBlock = {
    blockId: optIrBlockId(10),
    parameters: [],
    operations: [],
    terminator: {
      kind: "branch" as const,
      operationId: optIrOperationId(201),
      condition: input.condition,
      trueEdge,
      falseEdge,
      originId,
    },
    originId,
  };
  const thenBlock = {
    blockId: optIrBlockId(30),
    parameters: [],
    operations: input.thenOperations.map((operation) => operation.operationId),
    terminator: {
      kind: "jump" as const,
      operationId: optIrOperationId(202),
      edge: thenJoinEdge,
      originId,
    },
    originId,
  };
  const elseBlock = {
    blockId: optIrBlockId(20),
    parameters: [],
    operations: input.elseOperations.map((operation) => operation.operationId),
    terminator: {
      kind: "jump" as const,
      operationId: optIrOperationId(203),
      edge: elseJoinEdge,
      originId,
    },
    originId,
  };
  const joinBlock = {
    blockId: optIrBlockId(40),
    parameters: [],
    operations: input.joinOperations.map((operation) => operation.operationId),
    terminator: {
      kind: "return" as const,
      operationId: optIrOperationId(204),
      values: [],
      originId,
    },
    originId,
  };
  const operations = [...input.thenOperations, ...input.elseOperations, ...input.joinOperations];
  const func = {
    functionId: optIrFunctionId(21),
    monoInstanceId: monoInstanceId("memory-optimization::branch-join"),
    signature: {} as MonoFunctionSignature,
    blocks: [entryBlock, elseBlock, thenBlock, joinBlock],
    edges: optIrCfgEdgeTable([
      edgeForTest(trueEdge, entryBlock.blockId, thenBlock.blockId, 0, "branchTrue"),
      edgeForTest(falseEdge, entryBlock.blockId, elseBlock.blockId, 1, "branchFalse"),
      edgeForTest(thenJoinEdge, thenBlock.blockId, joinBlock.blockId, 0, "normal"),
      edgeForTest(elseJoinEdge, elseBlock.blockId, joinBlock.blockId, 0, "normal"),
    ]),
    entryBlock: entryBlock.blockId,
    originId,
  };
  const program = optIrProgram({
    programId: optIrProgramId(21),
    targetId: targetId("memory-optimization-test"),
    functions: optIrFunctionTable([func]),
    regions: optIrRegionTable([{ regionId: input.region.regionId, originId }]),
    constants: { get: () => undefined, has: () => false, entries: () => [] },
    callGraph: { calls: [] },
    provenance: { originIds: [originId] },
  });
  return {
    program,
    regions: [input.region],
    operations,
    operationForId(operationId: OptIrOperation["operationId"]) {
      return operations.find((operation) => operation.operationId === operationId);
    },
  };
}

export function storeThenLowerSuccessorLoadFixture(input: {
  readonly region: OptIrRegion;
  readonly storeOperation: OptIrOperation;
  readonly loadOperation: OptIrOperation;
}) {
  const successorEdge = optIrEdgeId(301);
  const entryBlock = {
    blockId: optIrBlockId(10),
    parameters: [],
    operations: [input.storeOperation.operationId],
    terminator: {
      kind: "jump" as const,
      operationId: optIrOperationId(301),
      edge: successorEdge,
      originId,
    },
    originId,
  };
  const successorBlock = {
    blockId: optIrBlockId(1),
    parameters: [],
    operations: [input.loadOperation.operationId],
    terminator: {
      kind: "return" as const,
      operationId: optIrOperationId(302),
      values: [],
      originId,
    },
    originId,
  };
  const operations = [input.storeOperation, input.loadOperation];
  const func = {
    functionId: optIrFunctionId(22),
    monoInstanceId: monoInstanceId("memory-optimization::cfg-order"),
    signature: {} as MonoFunctionSignature,
    blocks: [successorBlock, entryBlock],
    edges: optIrCfgEdgeTable([
      edgeForTest(successorEdge, entryBlock.blockId, successorBlock.blockId, 0, "normal"),
    ]),
    entryBlock: entryBlock.blockId,
    originId,
  };
  const program = optIrProgram({
    programId: optIrProgramId(22),
    targetId: targetId("memory-optimization-test"),
    functions: optIrFunctionTable([func]),
    regions: optIrRegionTable([{ regionId: input.region.regionId, originId }]),
    constants: { get: () => undefined, has: () => false, entries: () => [] },
    callGraph: { calls: [] },
    provenance: { originIds: [originId] },
  });
  return {
    program,
    regions: [input.region],
    operations,
    operationForId(operationId: OptIrOperation["operationId"]) {
      return operations.find((operation) => operation.operationId === operationId);
    },
  };
}

export function licmLoopProgramForTest(
  operations: readonly OptIrOperation[],
  regions: readonly OptIrRegion[],
) {
  const entryEdge = optIrEdgeId(101);
  const backEdge = optIrEdgeId(102);
  const exitEdge = optIrEdgeId(103);
  const entryBlock = {
    blockId: optIrBlockId(10),
    parameters: [],
    operations: [],
    terminator: {
      kind: "jump" as const,
      operationId: optIrOperationId(190),
      edge: entryEdge,
      originId,
    },
    originId,
  };
  const loopBlock = {
    blockId: optIrBlockId(11),
    parameters: [],
    operations: operations.map((operation) => operation.operationId),
    terminator: {
      kind: "branch" as const,
      operationId: optIrOperationId(191),
      condition: optIrValueId(10),
      trueEdge: backEdge,
      falseEdge: exitEdge,
      originId,
    },
    originId,
  };
  const exitBlock = {
    blockId: optIrBlockId(12),
    parameters: [],
    operations: [],
    terminator: {
      kind: "return" as const,
      operationId: optIrOperationId(192),
      values: [],
      originId,
    },
    originId,
  };
  const func = {
    functionId: optIrFunctionId(11),
    monoInstanceId: monoInstanceId("memory-optimization::licm-policy"),
    signature: {} as MonoFunctionSignature,
    blocks: [entryBlock, loopBlock, exitBlock],
    edges: optIrCfgEdgeTable([
      {
        edgeId: entryEdge,
        from: entryBlock.blockId,
        toBlock: loopBlock.blockId,
        ordinal: 0,
        kind: "normal" as const,
        arguments: [],
        originId,
      },
      {
        edgeId: backEdge,
        from: loopBlock.blockId,
        toBlock: loopBlock.blockId,
        ordinal: 0,
        kind: "normal" as const,
        arguments: [],
        condition: optIrValueId(10),
        originId,
      },
      {
        edgeId: exitEdge,
        from: loopBlock.blockId,
        toBlock: exitBlock.blockId,
        ordinal: 1,
        kind: "normal" as const,
        arguments: [],
        condition: optIrValueId(10),
        originId,
      },
    ]),
    entryBlock: entryBlock.blockId,
    originId,
  };
  return optIrProgram({
    programId: optIrProgramId(11),
    targetId: targetId("memory-optimization-test"),
    functions: optIrFunctionTable([func]),
    regions: optIrRegionTable(regions.map((region) => ({ regionId: region.regionId, originId }))),
    constants: { get: () => undefined, has: () => false, entries: () => [] },
    callGraph: { calls: [] },
    provenance: { originIds: [originId] },
  });
}

export function regionForTest(kind: OptIrRegionKind, id: number): OptIrRegion {
  return {
    regionId: optIrRegionId(id),
    kind,
    owner: { kind: "function", functionId: monoInstanceId("memory-optimization::fixture") },
    lifetime:
      kind === "constantData"
        ? "constant"
        : kind === "externalUnknown"
          ? "external"
          : kind === "globalData"
            ? "program"
            : "activation",
    aliasClass: optIrAliasClassId(id),
    volatility: "nonVolatile",
    effects: { mutability: "mutable", ordering: "none" },
    origin: { originId, source: { file: `region-${kind}-${id}.wr` } },
  };
}

export function load(
  operationId: number,
  resultId: number,
  region: OptIrRegion,
  byteOffset = 0n,
  valueType = byteType,
): OptIrOperation {
  const result = optIrMemoryLoadOperation({
    operationId: optIrOperationId(operationId),
    resultId: optIrValueId(resultId),
    region: region.regionId,
    byteOffset,
    byteWidth: 1,
    alignment: 1,
    valueType,
    endian: "native",
    volatility: region.volatility,
    boundsAuthority: { kind: "targetContract", authorityKey: `region:${region.regionId}` },
    originId,
  });
  if (result.kind !== "ok") {
    throw new Error("expected load construction to succeed");
  }
  return result.operation;
}

export function store(
  operationId: number,
  valueId: number,
  region: OptIrRegion,
  valueType = byteType,
): OptIrOperation {
  const result = optIrMemoryStoreOperation({
    operationId: optIrOperationId(operationId),
    storeValue: optIrValueId(valueId),
    region: region.regionId,
    byteOffset: 0n,
    byteWidth: 1,
    alignment: 1,
    valueType,
    endian: "native",
    volatility: region.volatility,
    boundsAuthority: { kind: "targetContract", authorityKey: `region:${region.regionId}` },
    originId,
  });
  if (result.kind !== "ok") {
    throw new Error("expected store construction to succeed");
  }
  return result.operation;
}

function edgeForTest(
  edgeId: ReturnType<typeof optIrEdgeId>,
  from: ReturnType<typeof optIrBlockId>,
  toBlock: ReturnType<typeof optIrBlockId>,
  ordinal: number,
  kind: "branchTrue" | "branchFalse" | "normal",
) {
  return {
    edgeId,
    from,
    toBlock,
    ordinal,
    kind,
    arguments: [],
    originId,
  };
}
