import { describe, expect, test } from "bun:test";
import { optIrOperationId, optIrValueId } from "../../../src/opt-ir/ids";
import { validateLoopVectorizationLegality } from "../../../src/opt-ir/passes/loop-vectorization/loop-legality";
import { optIrDefaultVectorPolicy } from "../../../src/opt-ir/policy/vector-policy";
import { targetOptimizationSurfaceForTest } from "../../support/opt-ir/target-optimization-fakes";
import { loopVectorizationCandidateForTest } from "../../support/opt-ir/vector-fixtures";

describe("OptIR loop vectorization legality", () => {
  test("requires certified lane bounds, memory independence, safe effects, carried values, and target ops", () => {
    const policy = optIrDefaultVectorPolicy(
      targetOptimizationSurfaceForTest({ vectorEnabled: true }),
    );
    const sourceValueCandidate = loopVectorizationCandidateForTest();
    const malformedStore = sourceValueCandidate.memoryAccesses.find(
      (access) => access.kind === "store",
    );
    if (malformedStore === undefined) {
      throw new Error("Invalid loop vectorization test fixture.");
    }
    const result = validateLoopVectorizationLegality(
      [
        loopVectorizationCandidateForTest({
          loopId: "missing-bounds",
          laneBounds: [{ operationId: optIrOperationId(1), proven: false }],
        }),
        loopVectorizationCandidateForTest({ loopId: "memory", memoryIndependenceProven: false }),
        loopVectorizationCandidateForTest({
          loopId: "effect",
          effectSafety: {
            safe: false,
            carriedValues: [],
            blockedEffects: ["volatile"],
            vectorPermittedEffects: [],
          },
        }),
        loopVectorizationCandidateForTest({
          loopId: "carried",
          effectSafety: {
            safe: true,
            carriedValues: [{ valueId: optIrValueId(9), kind: "unknown" }],
            blockedEffects: [],
            vectorPermittedEffects: [],
          },
        }),
        loopVectorizationCandidateForTest({
          loopId: "target",
          targetOperationKinds: ["runtimeCall"],
        }),
        loopVectorizationCandidateForTest({
          loopId: "malformed-store",
          memoryAccesses: [
            {
              ...malformedStore,
              sourceValueIds: [optIrValueId(20)],
            },
          ],
        }),
      ],
      policy,
    );

    expect(result.accepted).toEqual([]);
    expect(result.rejections.map((rejection) => rejection.candidate.loopId)).toEqual([
      "carried",
      "effect",
      "malformed-store",
      "memory",
      "missing-bounds",
      "target",
    ]);
    expect(result.rejections.map((rejection) => rejection.reason)).toEqual([
      "illegalCarriedValue",
      "effectUnsafe",
      "malformedMemoryAccess",
      "memoryDependence",
      "missingLaneBounds",
      "targetVectorOperationMissing",
    ]);
  });

  test("rejects sensitive effects unless the target catalog permits vector form", () => {
    const policy = optIrDefaultVectorPolicy(
      targetOptimizationSurfaceForTest({ vectorEnabled: true }),
    );
    const rejected = validateLoopVectorizationLegality(
      [
        loopVectorizationCandidateForTest({
          effectSafety: {
            safe: true,
            carriedValues: [],
            blockedEffects: ["firmwareTable"],
            vectorPermittedEffects: [],
          },
        }),
      ],
      policy,
    );
    const accepted = validateLoopVectorizationLegality(
      [
        loopVectorizationCandidateForTest({
          effectSafety: {
            safe: true,
            carriedValues: [],
            blockedEffects: ["firmwareTable"],
            vectorPermittedEffects: ["firmwareTable"],
          },
        }),
      ],
      policy,
    );

    expect(rejected.rejections[0]?.reason).toBe("effectUnsafe");
    expect(accepted.accepted.map((candidate) => candidate.loopId)).toEqual(["loop:payload-copy"]);
  });
});
