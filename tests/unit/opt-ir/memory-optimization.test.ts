import { describe, expect, test } from "bun:test";
import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import {
  optIrAliasClassId,
  optIrBlockId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrIntegerBinaryOperation,
  optIrMemoryLoadOperation,
  optIrMemoryStoreOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { optIrFunctionTable, optIrProgram, optIrRegionTable } from "../../../src/opt-ir/program";
import type { OptIrRegion, OptIrRegionKind } from "../../../src/opt-ir/regions";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { runLicmForTest } from "../../../src/opt-ir/passes/licm";
import { runMemoryOptimizationForTest } from "../../../src/opt-ir/passes/memory-optimization";
import { runScalarReplacementForTest } from "../../../src/opt-ir/passes/scalar-replacement";
import { runStackPromotionForTest } from "../../../src/opt-ir/passes/stack-promotion";

const originId = optIrOriginId(1);
const byteType = optIrUnsignedIntegerType(8);
const wordType = optIrUnsignedIntegerType(16);

describe("OptIR memory optimization cluster", () => {
  test("forwards loads only across matching memory versions and effect-token chains", () => {
    const region = regionForTest("stackLocal", 1);
    const firstStore = store(1, 10, region);
    const forwardedLoad = load(2, 20, region);
    const clobber = store(3, 11, region);
    const blockedLoad = load(4, 21, region, 1n);

    const result = runMemoryOptimizationForTest(
      fixture([firstStore, forwardedLoad, clobber, blockedLoad], [region]),
    );

    expect(result.valueForwards).toEqual([
      { sourceValue: optIrValueId(20), replacementValue: optIrValueId(10) },
    ]);
    expect(result.removedOperationIds).toEqual([]);
    expect(result.rewriteRecords.map((record) => record.subject)).toEqual([
      { kind: "operation", operationId: forwardedLoad.operationId },
    ]);
    expect(result.rewriteRecords.map((record) => record.invariant.kind)).toEqual([
      "noaliasMemoryEquivalence",
    ]);
  });

  test("does not forward without compatible memory/effect chains or matching value types", () => {
    const externalRegion = regionForTest("externalUnknown", 1);
    const untracked = runMemoryOptimizationForTest(
      fixture([store(1, 10, externalRegion), load(2, 20, externalRegion)], [externalRegion]),
    );

    expect(untracked.valueForwards).toEqual([]);
    expect(untracked.rewriteRecords).toEqual([]);

    const stackRegion = regionForTest("stackLocal", 2);
    const mismatchedType = runMemoryOptimizationForTest(
      fixture(
        [store(1, 10, stackRegion, byteType), load(2, 20, stackRegion, 0n, wordType)],
        [stackRegion],
      ),
    );

    expect(mismatchedType.valueForwards).toEqual([]);
    expect(mismatchedType.rewriteRecords).toEqual([]);
  });

  test("DSE refuses observable stores unless the target contract permits removing them", () => {
    for (const kind of [
      "firmwareTable",
      "imageDevice",
      "externalUnknown",
    ] satisfies readonly OptIrRegionKind[]) {
      const region = regionForTest(kind, 10);
      const result = runMemoryOptimizationForTest(
        fixture([store(1, 10, region), store(2, 11, region)], [region]),
      );
      expect(result.removedOperationIds).toEqual([]);
    }

    const volatileRegion = { ...regionForTest("stackLocal", 20), volatility: "volatile" as const };
    const volatileResult = runMemoryOptimizationForTest(
      fixture([store(1, 10, volatileRegion), store(2, 11, volatileRegion)], [volatileRegion]),
    );
    expect(volatileResult.removedOperationIds).toEqual([]);

    const allowedRegion = regionForTest("firmwareTable", 30);
    const allowed = runMemoryOptimizationForTest(
      fixture([store(1, 10, allowedRegion), store(2, 11, allowedRegion)], [allowedRegion]),
      { targetContract: { permitsObservableStoreRemoval: () => true } },
    );
    expect(allowed.removedOperationIds).toEqual([optIrOperationId(1)]);
    expect(allowed.rewriteRecords[0]?.subject).toEqual({
      kind: "operation",
      operationId: optIrOperationId(1),
    });
    expect(allowed.rewriteRecords[0]?.invariant.kind).toBe("effectBoundaryEquivalence");
  });

  test("scalar replacement requires complete byte coverage and cleanup effect accounting", () => {
    const region = regionForTest("sourceAggregate", 1);
    const complete = runScalarReplacementForTest({
      program: fixture([], [region]).program,
      regions: [region],
      candidates: [
        {
          regionId: region.regionId,
          totalByteWidth: 4,
          fields: [
            { byteOffset: 0n, byteWidth: 2 },
            { byteOffset: 2n, byteWidth: 2 },
          ],
          cleanupEffectsAccounted: true,
        },
      ],
    });

    expect(complete.replacedRegionIds).toEqual([region.regionId]);
    expect(complete.rewriteRecords[0]?.subject).toEqual({
      kind: "region",
      regionId: region.regionId,
    });
    expect(complete.rewriteRecords[0]?.invariant.kind).toBe("noaliasMemoryEquivalence");

    const incomplete = runScalarReplacementForTest({
      program: fixture([], [region]).program,
      regions: [region],
      candidates: [
        {
          regionId: region.regionId,
          totalByteWidth: 4,
          fields: [{ byteOffset: 1n, byteWidth: 2 }],
          cleanupEffectsAccounted: true,
        },
        {
          regionId: region.regionId,
          totalByteWidth: 4,
          fields: [
            { byteOffset: 0n, byteWidth: 2 },
            { byteOffset: 2n, byteWidth: 2 },
          ],
          cleanupEffectsAccounted: false,
        },
      ],
    });
    expect(incomplete.replacedRegionIds).toEqual([]);
    expect(incomplete.rejectedCandidates.map((candidate) => candidate.reason)).toEqual([
      "incompleteByteCoverage",
      "cleanupEffectsUnaccounted",
    ]);
  });

  test("stack promotion requires stack-local regions, no escapes, and valid lifetimes", () => {
    const stack = regionForTest("stackLocal", 1);
    const global = regionForTest("globalData", 2);
    const result = runStackPromotionForTest({
      program: fixture([], [stack, global]).program,
      regions: [stack, global],
      lifetimeFacts: [
        { regionId: stack.regionId, valid: true },
        { regionId: global.regionId, valid: true },
      ],
      escapedRegionIds: [],
    });

    expect(result.promotedRegionIds).toEqual([stack.regionId]);
    expect(result.rejectedRegions.map((region) => region.reason)).toEqual(["notStackLocal"]);
    expect(result.rewriteRecords[0]?.subject).toEqual({
      kind: "region",
      regionId: stack.regionId,
    });
    expect(result.rewriteRecords[0]?.invariant.kind).toBe("noaliasMemoryEquivalence");

    const escaped = runStackPromotionForTest({
      program: fixture([], [stack]).program,
      regions: [stack],
      lifetimeFacts: [{ regionId: stack.regionId, valid: false }],
      escapedRegionIds: [stack.regionId],
    });
    expect(escaped.promotedRegionIds).toEqual([]);
    expect(escaped.rejectedRegions.map((region) => region.reason)).toEqual(["escaped"]);
  });

  test("LICM moves only pure or region-safe operations across effect boundaries", () => {
    const region = regionForTest("stackLocal", 1);
    const pure = optIrIntegerBinaryOperation({
      operationId: optIrOperationId(1),
      resultId: optIrValueId(30),
      left: optIrValueId(10),
      right: optIrValueId(11),
      operator: "add",
      resultType: byteType,
      originId,
    });
    const safeLoad = load(2, 31, region);
    const storeBoundary = store(3, 12, region);

    const result = runLicmForTest({
      program: fixture([pure, safeLoad, storeBoundary], [region]).program,
      operations: [pure, safeLoad, storeBoundary],
      loopOperationIds: [pure.operationId, safeLoad.operationId, storeBoundary.operationId],
      effectBoundaryOperationIds: [storeBoundary.operationId],
      regionSafeOperationIds: [safeLoad.operationId],
    });

    expect(result.movedOperationIds).toEqual([pure.operationId, safeLoad.operationId]);
    expect(result.blockedOperationIds).toEqual([storeBoundary.operationId]);
    expect(result.rewriteRecords.map((record) => record.invariant.kind)).toEqual([
      "effectBoundaryEquivalence",
      "effectBoundaryEquivalence",
    ]);
  });
});

function fixture(operations: readonly OptIrOperation[], regions: readonly OptIrRegion[]) {
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

function regionForTest(kind: OptIrRegionKind, id: number): OptIrRegion {
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

function load(
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

function store(
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
