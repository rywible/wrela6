import { describe, expect, test } from "bun:test";
import { optIrBlockId, optIrOperationId, optIrValueId } from "../../../src/opt-ir/ids";
import type { OptIrSlpCandidate } from "../../../src/opt-ir/passes/slp-vectorization";
import { runSlpVectorization } from "../../../src/opt-ir/passes/slp-vectorization";
import { runVectorizationCleanup } from "../../../src/opt-ir/passes/vectorization-cleanup";
import { optIrDefaultVectorPolicy } from "../../../src/opt-ir/policy/vector-policy";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { targetOptimizationSurfaceForTest } from "../../support/opt-ir/target-optimization-fakes";

describe("OptIR SLP vectorization", () => {
  test("pack discovery recognizes Wrela straight-line vector idioms", () => {
    const result = runSlpVectorization({
      blockId: optIrBlockId(1),
      scalarOperationIds: operationIds(),
      nextOperationId: 100,
      nextValueId: 200,
      candidates: [
        candidate("adjacentPacketFieldRead"),
        candidate("adjacentSourceFieldRead"),
        candidate("endianDecode", { sourceValueIds: [optIrValueId(10)] }),
        candidate("validationComparison", {
          sourceValueIds: [optIrValueId(10), optIrValueId(11), optIrValueId(12), optIrValueId(13)],
        }),
        candidate("fixedWidthCopy", { sourceValueIds: [optIrValueId(10)] }),
        candidate("fixedWidthSet", { sourceValueIds: [optIrValueId(10), optIrValueId(11)] }),
        candidate("parserTableCheck", {
          sourceValueIds: [optIrValueId(20), optIrValueId(21), optIrValueId(22), optIrValueId(23)],
        }),
      ],
      policy: optIrDefaultVectorPolicy(targetOptimizationSurfaceForTest({ vectorEnabled: true })),
    });

    expect(result.vectorOperations.map((operation) => operation.kind)).toEqual([
      "vectorLoad",
      "vectorLoad",
      "vectorByteSwap",
      "vectorCompare",
      "vectorLoad",
      "vectorStore",
      "vectorCompare",
    ]);
    expect(result.rewriteRecords).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ invariant: { kind: "vectorLaneEquivalence" } }),
      ]),
    );
  });

  test("legality requires bounds, alias and effects, endian, target, alignment, and pressure", () => {
    const policy = {
      ...optIrDefaultVectorPolicy(targetOptimizationSurfaceForTest({ vectorEnabled: true })),
      allowUnalignedPacketLoads: false,
    };
    const result = runSlpVectorization({
      blockId: optIrBlockId(1),
      scalarOperationIds: operationIds(),
      nextOperationId: 100,
      nextValueId: 200,
      candidates: [
        candidate("adjacentPacketFieldRead", { laneBoundsProven: false }),
        candidate("fixedWidthCopy", { aliasSafe: false }),
        candidate("fixedWidthSet", { effectSafe: false }),
        candidate("endianDecode", { endianLegal: false }),
        candidate("parserTableCheck", { targetFeatureLegal: false }),
        candidate("adjacentSourceFieldRead", { alignment: 1, unalignedAccess: true }),
        candidate("validationComparison", { estimatedLiveVectorRegisters: 99 }),
        candidate("fixedWidthSet", { sourceValueIds: [optIrValueId(10)] }),
      ],
      policy,
    });

    expect(result.vectorOperations).toEqual([]);
    expect(result.rejections.map((rejection) => rejection.reason)).toEqual([
      "missingLaneBounds",
      "aliasUnsafe",
      "effectUnsafe",
      "endianIllegal",
      "targetFeatureMissing",
      "unalignedAccessRejected",
      "registerPressureTooHigh",
      "missingSourceValues",
    ]);
  });

  test("cleanup preserves unknown vector values and only removes dead shuffles", () => {
    const result = runSlpVectorization({
      blockId: optIrBlockId(1),
      scalarOperationIds: operationIds(),
      nextOperationId: 100,
      nextValueId: 200,
      candidates: [
        candidate("adjacentPacketFieldRead"),
        candidate("validationComparison", {
          sourceValueIds: [
            optIrValueId(999),
            optIrValueId(1000),
            optIrValueId(1001),
            optIrValueId(1002),
          ],
        }),
      ],
      policy: optIrDefaultVectorPolicy(targetOptimizationSurfaceForTest({ vectorEnabled: true })),
    });

    const cleanup = runVectorizationCleanup({
      operations: result.vectorOperations,
      liveValueIds: [optIrValueId(201)],
    });

    expect(cleanup.operations.map((operation) => operation.kind)).toEqual([
      "vectorLoad",
      "vectorCompare",
    ]);
    expect(cleanup.preservedUnknownVectorValueIds).toEqual([
      optIrValueId(999),
      optIrValueId(1000),
      optIrValueId(1001),
      optIrValueId(1002),
    ]);
  });
});

type CandidateOverrides = Partial<Omit<OptIrSlpCandidate, "idiom">>;

function candidate(
  idiom: OptIrSlpCandidate["idiom"],
  overrides: CandidateOverrides = {},
): OptIrSlpCandidate {
  return {
    idiom,
    laneType: optIrUnsignedIntegerType(8),
    lanes: 4,
    byteOffset: 0n,
    byteWidth: 4,
    alignment: 4,
    laneBoundsProven: true,
    aliasSafe: true,
    effectSafe: true,
    endianLegal: true,
    targetFeatureLegal: true,
    unalignedAccess: false,
    estimatedLiveVectorRegisters: 1,
    sourceValueIds: [],
    ...overrides,
  };
}

function operationIds() {
  return [optIrOperationId(1), optIrOperationId(2), optIrOperationId(3), optIrOperationId(4)];
}
