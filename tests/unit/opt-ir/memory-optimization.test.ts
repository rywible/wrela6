import { describe, expect, test } from "bun:test";
import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";
import { monoInstanceId } from "../../../src/mono/ids";
import { targetId } from "../../../src/semantic/ids";
import { emptyOptIrFactSet } from "../../../src/opt-ir/facts/fact-index";
import { optIrCfgEdgeTable } from "../../../src/opt-ir/cfg";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrProgramId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  optIrIntegerBinaryOperation,
  optIrIntegerCompareOperation,
  type OptIrOperation,
} from "../../../src/opt-ir/operations";
import { optIrFunctionTable, optIrProgram, optIrRegionTable } from "../../../src/opt-ir/program";
import type { OptIrRegionKind } from "../../../src/opt-ir/regions";
import {
  runDeadStoreEliminationForTest,
  runLoadStoreForwardingForTest,
} from "../../../src/opt-ir/passes/memory-optimization";
import { runLicmStep, runStackPromotionStep } from "../../../src/opt-ir/passes/pipeline-steps";
import { runScalarReplacementForTest } from "../../../src/opt-ir/passes/scalar-replacement";
import { runStackPromotionForTest } from "../../../src/opt-ir/passes/stack-promotion";
import {
  branchJoinFixture,
  byteType,
  fixture,
  licmLoopProgramForTest,
  load,
  originId,
  passContextForTest,
  regionForTest,
  runLicmForTest,
  store,
  storeThenLowerSuccessorLoadFixture,
  wordType,
} from "../../support/opt-ir/memory-optimization-fixtures";

describe("OptIR memory optimization cluster", () => {
  test("forwards loads only across matching memory versions and effect-token chains", () => {
    const region = regionForTest("stackLocal", 1);
    const firstStore = store(1, 10, region);
    const forwardedLoad = load(2, 20, region);
    const clobber = store(3, 11, region);
    const blockedLoad = load(4, 21, region, 1n);

    const result = runLoadStoreForwardingForTest(
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
    const untracked = runLoadStoreForwardingForTest(
      fixture([store(1, 10, externalRegion), load(2, 20, externalRegion)], [externalRegion]),
    );

    expect(untracked.valueForwards).toEqual([]);
    expect(untracked.rewriteRecords).toEqual([]);

    const stackRegion = regionForTest("stackLocal", 2);
    const mismatchedType = runLoadStoreForwardingForTest(
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
    const result = runLoadStoreForwardingForTest(
      fixture([store(1, 10, region, storedType), load(2, 20, region, 0n, loadedType)], [region]),
    );

    expect(result.valueForwards).toEqual([
      { sourceValue: optIrValueId(20), replacementValue: optIrValueId(10) },
    ]);
  });

  test("does not forward a join load when incoming stores disagree", () => {
    const region = regionForTest("stackLocal", 4);
    const condition = optIrValueId(900);
    const thenStore = store(1, 10, region);
    const elseStore = store(2, 11, region);
    const joinLoad = load(3, 20, region);
    const result = runLoadStoreForwardingForTest(
      branchJoinFixture({
        region,
        condition,
        thenOperations: [thenStore],
        elseOperations: [elseStore],
        joinOperations: [joinLoad],
      }),
    );

    expect(result.valueForwards).toEqual([]);
    expect(result.removedOperationIds).toEqual([]);
  });

  test("forwards from a dominating store when successor block id is lower", () => {
    const region = regionForTest("stackLocal", 44);
    const firstStore = store(1, 10, region);
    const successorLoad = load(2, 20, region);
    const result = runLoadStoreForwardingForTest(
      storeThenLowerSuccessorLoadFixture({
        region,
        storeOperation: firstStore,
        loadOperation: successorLoad,
      }),
    );

    expect(result.valueForwards).toEqual([
      { sourceValue: optIrValueId(20), replacementValue: optIrValueId(10) },
    ]);
    expect(result.removedOperationIds).toEqual([]);
  });

  test("does not forward through a join when only one predecessor stores", () => {
    const region = regionForTest("stackLocal", 45);
    const condition = optIrValueId(902);
    const thenStore = store(1, 10, region);
    const joinLoad = load(2, 20, region);
    const result = runLoadStoreForwardingForTest(
      branchJoinFixture({
        region,
        condition,
        thenOperations: [thenStore],
        elseOperations: [],
        joinOperations: [joinLoad],
      }),
    );

    expect(result.valueForwards).toEqual([]);
    expect(result.removedOperationIds).toEqual([]);
  });

  test("preserves a branch store that is visible on one incoming path", () => {
    const region = regionForTest("stackLocal", 5);
    const condition = optIrValueId(901);
    const thenStore = store(1, 10, region);
    const joinStore = store(2, 11, region);
    const result = runDeadStoreEliminationForTest(
      branchJoinFixture({
        region,
        condition,
        thenOperations: [thenStore],
        elseOperations: [],
        joinOperations: [joinStore],
      }),
    );

    expect(result.removedOperationIds).toEqual([]);
  });

  test("DSE refuses observable stores unless the target contract permits removing them", () => {
    for (const kind of [
      "firmwareTable",
      "imageDevice",
      "externalUnknown",
    ] satisfies readonly OptIrRegionKind[]) {
      const region = regionForTest(kind, 10);
      const result = runDeadStoreEliminationForTest(
        fixture([store(1, 10, region), store(2, 11, region)], [region]),
      );
      expect(result.removedOperationIds).toEqual([]);
    }

    const volatileRegion = { ...regionForTest("stackLocal", 20), volatility: "volatile" as const };
    const volatileResult = runDeadStoreEliminationForTest(
      fixture([store(1, 10, volatileRegion), store(2, 11, volatileRegion)], [volatileRegion]),
    );
    expect(volatileResult.removedOperationIds).toEqual([]);

    const allowedRegion = regionForTest("firmwareTable", 30);
    const allowed = runDeadStoreEliminationForTest(
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
      nonEscapingRegionIds: [stack.regionId, global.regionId],
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
      nonEscapingRegionIds: [],
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
      nonEscapingRegionIds: [stack.regionId],
    });
    expect(liveReferenced.promotedRegionIds).toEqual([stack.regionId]);
    expect(liveReferenced.program.regions.has(stack.regionId)).toBe(true);
    expect(liveReferenced.rejectedRegions).toEqual([]);
  });

  test("stack promotion fails closed without explicit non-escape evidence", () => {
    const stack = regionForTest("stackLocal", 51);
    const program = fixture([], [stack]).program;

    const result = runStackPromotionForTest({
      program,
      regions: [stack],
      lifetimeFacts: [{ regionId: stack.regionId, valid: true }],
      escapedRegionIds: [],
    });

    expect(result.promotedRegionIds).toEqual([]);
    expect(result.rejectedRegions).toEqual([{ regionId: stack.regionId, reason: "escaped" }]);
    expect(result.rewriteRecords).toEqual([]);
  });

  test("production stack promotion fails closed when escape evidence is incomplete", () => {
    const stack = regionForTest("stackLocal", 52);
    const program = fixture([], [stack]).program;

    const result = runStackPromotionStep({
      program,
      operations: [],
      optimizationRegions: [stack],
      facts: emptyOptIrFactSet(),
      diagnostics: [],
      decisionLog: undefined,
      verificationCheckpoints: [],
    });

    expect(result.program).toBe(program);
    expect(result.optimizationRegions).toEqual([stack]);
    expect(result.diagnostics).toEqual([]);
  });

  test("production stack promotion preserves ordered-effect escape boundaries", () => {
    const escapedStack = {
      ...regionForTest("stackLocal", 53),
      effects: { mutability: "mutable", ordering: "orderedEffectToken" } as const,
    };
    const program = fixture([], [escapedStack]).program;

    const result = runStackPromotionStep({
      program,
      operations: [],
      optimizationRegions: [escapedStack],
      facts: emptyOptIrFactSet(),
      diagnostics: [],
      decisionLog: undefined,
      verificationCheckpoints: [],
    });

    expect(result.program).toBe(program);
    expect(result.optimizationRegions).toEqual([escapedStack]);
    expect(result.diagnostics).toEqual([]);
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

    const result = runLicmStep(
      {
        program,
        operations: [unsafeLoad, storeBoundary],
        optimizationRegions: [region],
        facts: emptyOptIrFactSet(),
        diagnostics: [],
        decisionLog: undefined,
        verificationCheckpoints: [],
      },
      passContextForTest("licm", program, [unsafeLoad, storeBoundary]),
    );

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
      effectBoundaryOperationIds: [],
      regionSafeOperationIds: [],
    });

    expect(result.program).toBe(program);
    expect(result.movedOperationIds).toEqual([]);
    expect(result.blockedOperationIds).toEqual([checkedAdd.operationId]);
  });

  test("LICM hoists selected operations in dependency order", () => {
    const consumer = optIrIntegerCompareOperation({
      operationId: optIrOperationId(61),
      resultId: optIrValueId(71),
      left: optIrValueId(70),
      right: optIrValueId(11),
      operator: "equal",
      originId,
    });
    const producer = optIrIntegerCompareOperation({
      operationId: optIrOperationId(62),
      resultId: optIrValueId(70),
      left: optIrValueId(10),
      right: optIrValueId(11),
      operator: "equal",
      originId,
    });
    const program = licmLoopProgramForTest([consumer, producer], []);

    const result = runLicmForTest({
      program,
      operations: [consumer, producer],
      effectBoundaryOperationIds: [],
      regionSafeOperationIds: [],
    });

    expect(result.movedOperationIds).toEqual([consumer.operationId, producer.operationId]);
    expect(result.program.functions.entries()[0]?.blocks[0]?.operations).toEqual([
      producer.operationId,
      consumer.operationId,
    ]);
  });

  test("LICM derives loop operations from the loop tree instead of caller filters", () => {
    const invariant = optIrIntegerCompareOperation({
      operationId: optIrOperationId(81),
      resultId: optIrValueId(91),
      left: optIrValueId(10),
      right: optIrValueId(11),
      operator: "equal",
      originId,
    });
    const program = licmLoopProgramForTest([invariant], []);
    const legacyCallerInput = {
      program,
      operations: [invariant],
      loopOperationIds: [],
      effectBoundaryOperationIds: [],
      regionSafeOperationIds: [],
    };

    const result = runLicmForTest(legacyCallerInput);

    expect(result.movedOperationIds).toEqual([invariant.operationId]);
    expect(result.program.functions.entries()[0]?.blocks[0]?.operations).toEqual([
      invariant.operationId,
    ]);
  });
});
