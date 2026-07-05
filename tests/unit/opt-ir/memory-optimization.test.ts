import { describe, expect, test } from "bun:test";
import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import { emptyOptIrFactSet } from "../../../src/opt-ir/facts/fact-index";
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
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  optIrMemoryLoadOperation,
  optIrMemoryStoreOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { optIrFunctionTable, optIrProgram, optIrRegionTable } from "../../../src/opt-ir/program";
import type { OptIrRegion, OptIrRegionKind } from "../../../src/opt-ir/regions";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { runLicmForTest } from "../../../src/opt-ir/passes/licm";
import { runMemoryOptimizationForTest } from "../../../src/opt-ir/passes/memory-optimization";
import { runLicmStep } from "../../../src/opt-ir/passes/pipeline-steps";
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

  test("forwards loads across structurally equal value types with different property order", () => {
    const region = regionForTest("stackLocal", 3);
    const storedType = { kind: "integer" as const, signedness: "unsigned" as const, width: 8 };
    const loadedType = { width: 8, signedness: "unsigned" as const, kind: "integer" as const };
    const result = runMemoryOptimizationForTest(
      fixture([store(1, 10, region, storedType), load(2, 20, region, 0n, loadedType)], [region]),
    );

    expect(result.valueForwards).toEqual([
      { sourceValue: optIrValueId(20), replacementValue: optIrValueId(10) },
    ]);
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
    const program = fixture([load(9, 90, region)], [region]).program;
    const complete = runScalarReplacementForTest({
      program,
      operations: [load(9, 90, region)],
      regions: [region],
      candidates: [
        {
          regionId: region.regionId,
          totalByteWidth: 1,
          fields: [{ byteOffset: 0n, byteWidth: 1 }],
          cleanupEffectsAccounted: true,
        },
      ],
    });

    expect(complete.replacedRegionIds).toEqual([region.regionId]);
    expect(complete.program).not.toBe(program);
    expect(complete.program.regions.has(region.regionId)).toBe(true);
    expect(complete.program.regions.entries()).toHaveLength(2);
    const rewrittenLoad = complete.operations.find(
      (operation) => operation.operationId === optIrOperationId(9),
    );
    expect(rewrittenLoad?.kind).toBe("memoryLoad");
    expect(
      rewrittenLoad && "memoryAccess" in rewrittenLoad
        ? rewrittenLoad.memoryAccess.region
        : undefined,
    ).not.toBe(region.regionId);
    const typedSourceOptimization = complete.optimizationRegions?.find(
      (optimizedRegion) => optimizedRegion.regionId === region.regionId,
    )?.optimization;

    expect(typedSourceOptimization?.kind).toBe("scalarReplaced");
    expect("optimizationRegions" in complete.program).toBe(false);
    expect(complete.rewriteRecords[0]?.subject).toEqual({
      kind: "region",
      regionId: region.regionId,
    });
    expect(complete.rewriteRecords[0]?.invariant.kind).toBe("noaliasMemoryEquivalence");

    const incomplete = runScalarReplacementForTest({
      program,
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
    expect(incomplete.program).toBe(program);
    expect(incomplete.program.regions.has(region.regionId)).toBe(true);
    expect(incomplete.rejectedCandidates.map((candidate) => candidate.reason)).toEqual([
      "incompleteByteCoverage",
      "cleanupEffectsUnaccounted",
    ]);

    const scalarProgramWithOperations: typeof program & {
      readonly operations: readonly OptIrOperation[];
    } = { ...program, operations: [load(9, 90, region)] };
    const liveReferenced = runScalarReplacementForTest({
      program: scalarProgramWithOperations,
      operations: scalarProgramWithOperations.operations,
      regions: [region],
      candidates: [
        {
          regionId: region.regionId,
          totalByteWidth: 1,
          fields: [{ byteOffset: 0n, byteWidth: 1 }],
          cleanupEffectsAccounted: true,
        },
      ],
    });
    expect(liveReferenced.replacedRegionIds).toEqual([region.regionId]);
    expect(liveReferenced.program.regions.has(region.regionId)).toBe(true);
    expect(liveReferenced.rejectedCandidates).toEqual([]);

    const unmatchedLiveReference = runScalarReplacementForTest({
      program: scalarProgramWithOperations,
      operations: scalarProgramWithOperations.operations,
      regions: [region],
      candidates: [
        {
          regionId: region.regionId,
          totalByteWidth: 2,
          fields: [{ byteOffset: 0n, byteWidth: 2 }],
          cleanupEffectsAccounted: true,
        },
      ],
    });
    expect(unmatchedLiveReference.replacedRegionIds).toEqual([]);
    expect(unmatchedLiveReference.rejectedCandidates.map((candidate) => candidate.reason)).toEqual([
      "unmatchedLiveRegionReference",
    ]);
  });

  test("stack promotion requires stack-local regions, no escapes, and valid lifetimes", () => {
    const stack = regionForTest("stackLocal", 1);
    const global = regionForTest("globalData", 2);
    const program = fixture([], [stack, global]).program;
    const result = runStackPromotionForTest({
      program,
      regions: [stack, global],
      lifetimeFacts: [
        { regionId: stack.regionId, valid: true },
        { regionId: global.regionId, valid: true },
      ],
      escapedRegionIds: [],
    });

    expect(result.promotedRegionIds).toEqual([stack.regionId]);
    expect(result.program).toBe(program);
    expect(result.program.regions.has(stack.regionId)).toBe(true);
    expect(result.program.regions.has(global.regionId)).toBe(true);
    const promotedRegion = result.optimizationRegions.find(
      (regionEntry) => regionEntry.regionId === stack.regionId,
    );
    expect(promotedRegion?.kind).toBe("stackLocal");
    expect(promotedRegion?.optimization?.kind).toBe("stackPromoted");
    expect(result.rejectedRegions.map((region) => region.reason)).toEqual(["invalidLifetime"]);
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
    expect(escaped.program.regions.has(stack.regionId)).toBe(true);
    expect(escaped.rejectedRegions.map((region) => region.reason)).toEqual(["escaped"]);

    const stackProgramWithOperations: typeof program & {
      readonly operations: readonly OptIrOperation[];
    } = { ...program, operations: [load(9, 90, stack)] };
    const liveReferenced = runStackPromotionForTest({
      program: stackProgramWithOperations,
      regions: [stack],
      lifetimeFacts: [{ regionId: stack.regionId, valid: true }],
      escapedRegionIds: [],
    });
    expect(liveReferenced.promotedRegionIds).toEqual([stack.regionId]);
    expect(liveReferenced.program.regions.has(stack.regionId)).toBe(true);
    expect(liveReferenced.rejectedRegions).toEqual([]);
  });

  test("LICM moves only pure or region-safe operations across effect boundaries", () => {
    const region = regionForTest("stackLocal", 1);
    const loopVariant = load(1, 29, region, 0n);
    const pure = optIrIntegerCompareOperation({
      operationId: optIrOperationId(2),
      resultId: optIrValueId(30),
      left: optIrValueId(10),
      right: optIrValueId(11),
      operator: "equal",
      originId,
    });
    const safeLoad = load(3, 31, region, 2n);
    const storeBoundary = store(4, 12, region);
    const entryEdge = optIrEdgeId(1);
    const backEdge = optIrEdgeId(2);
    const exitEdge = optIrEdgeId(3);
    const entryBlock = {
      blockId: optIrBlockId(0),
      parameters: [],
      operations: [],
      terminator: {
        kind: "jump" as const,
        operationId: optIrOperationId(90),
        edge: entryEdge,
        originId,
      },
      originId,
    };
    const loopBlock = {
      blockId: optIrBlockId(1),
      parameters: [],
      operations: [
        loopVariant.operationId,
        pure.operationId,
        safeLoad.operationId,
        storeBoundary.operationId,
      ],
      terminator: {
        kind: "branch" as const,
        operationId: optIrOperationId(91),
        condition: optIrValueId(10),
        trueEdge: backEdge,
        falseEdge: exitEdge,
        originId,
      },
      originId,
    };
    const exitBlock = {
      blockId: optIrBlockId(2),
      parameters: [],
      operations: [],
      terminator: {
        kind: "return" as const,
        operationId: optIrOperationId(92),
        values: [],
        originId,
      },
      originId,
    };
    const func = {
      functionId: optIrFunctionId(1),
      monoInstanceId: monoInstanceId("memory-optimization::licm"),
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
    const program = optIrProgram({
      programId: optIrProgramId(1),
      targetId: targetId("memory-optimization-test"),
      functions: optIrFunctionTable([func]),
      regions: optIrRegionTable([{ regionId: region.regionId, originId }]),
      constants: { get: () => undefined, has: () => false, entries: () => [] },
      callGraph: { calls: [] },
      provenance: { originIds: [originId] },
    });

    const result = runLicmForTest({
      program,
      operations: [loopVariant, pure, safeLoad, storeBoundary],
      loopOperationIds: [
        loopVariant.operationId,
        pure.operationId,
        safeLoad.operationId,
        storeBoundary.operationId,
      ],
      effectBoundaryOperationIds: [storeBoundary.operationId],
      regionSafeOperationIds: [safeLoad.operationId],
    });

    expect(result.movedOperationIds).toEqual([pure.operationId, safeLoad.operationId]);
    expect(result.program).not.toBe(program);
    expect(result.program.functions.entries()[0]?.blocks[0]?.operations).toEqual([
      pure.operationId,
      safeLoad.operationId,
    ]);
    expect(result.program.functions.entries()[0]?.blocks[1]?.operations).toEqual([
      loopVariant.operationId,
      storeBoundary.operationId,
    ]);
    expect(result.blockedOperationIds).toEqual([
      loopVariant.operationId,
      storeBoundary.operationId,
    ]);
    expect(result.rewriteRecords.map((record) => record.invariant.kind)).toEqual([
      "effectBoundaryEquivalence",
      "effectBoundaryEquivalence",
    ]);
  });

  test("production LICM does not infer memory loads are safe across loop effects", () => {
    const region = regionForTest("stackLocal", 11);
    const unsafeLoad = load(11, 41, region);
    const storeBoundary = store(12, 42, region);
    const program = licmLoopProgramForTest([unsafeLoad, storeBoundary], [region]);

    const result = runLicmStep({
      program,
      operations: [unsafeLoad, storeBoundary],
      optimizationRegions: [region],
      facts: emptyOptIrFactSet(),
      diagnostics: [],
      decisionLog: undefined,
      verificationCheckpoints: [],
    });

    expect(result.program).toBe(program);
    expect(result.diagnostics).toEqual([]);
  });

  test("LICM does not speculate potentially trapping integer arithmetic", () => {
    const checkedAdd = optIrIntegerBinaryOperation({
      operationId: optIrOperationId(21),
      resultId: optIrValueId(51),
      left: optIrValueId(10),
      right: optIrValueId(11),
      operator: "add",
      resultType: byteType,
      originId,
    });
    const program = licmLoopProgramForTest([checkedAdd], []);

    const result = runLicmForTest({
      program,
      operations: [checkedAdd],
      loopOperationIds: [checkedAdd.operationId],
      effectBoundaryOperationIds: [],
      regionSafeOperationIds: [],
    });

    expect(result.program).toBe(program);
    expect(result.movedOperationIds).toEqual([]);
    expect(result.blockedOperationIds).toEqual([checkedAdd.operationId]);
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

function licmLoopProgramForTest(
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
