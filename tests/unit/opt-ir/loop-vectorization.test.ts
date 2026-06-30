import { describe, expect, test } from "bun:test";
import { optIrFactSetFromRecords } from "../../../src/opt-ir/facts/fact-index";
import { optIrBlockId, optIrOperationId, optIrValueId } from "../../../src/opt-ir/ids";
import { runLoopVectorization } from "../../../src/opt-ir/passes/loop-vectorization";
import { discoverLoopVectorizationCandidates } from "../../../src/opt-ir/passes/vector-discovery";
import { optIrDefaultVectorPolicy } from "../../../src/opt-ir/policy/vector-policy";
import { optIrVectorType } from "../../../src/opt-ir/vector-types";
import { targetOptimizationSurfaceForTest } from "../../support/opt-ir/target-optimization-fakes";
import {
  discoveredLoadLoopProgramForTest,
  loopVectorizationCandidateForTest,
} from "../../support/opt-ir/vector-fixtures";

describe("OptIR certified loop vectorization", () => {
  test("rewrites legal certified loops and records tail, lane, memory, and effect invariants", () => {
    const result = runLoopVectorization({
      candidates: [
        loopVectorizationCandidateForTest({ loopId: "loop:z" }),
        loopVectorizationCandidateForTest({ loopId: "loop:a", headerBlockId: optIrBlockId(1) }),
      ],
      policy: optIrDefaultVectorPolicy(targetOptimizationSurfaceForTest({ vectorEnabled: true })),
    });

    expect(result.vectorOperations.map((operation) => operation.kind)).toEqual([
      "vectorLoad",
      "vectorLoad",
    ]);
    const load = result.vectorOperations[0];
    if (load?.kind !== "vectorLoad") {
      throw new Error("Expected legal loop memory-pack vectorization to emit a vector load.");
    }
    expect(load.memoryAccess.valueType).toEqual(
      optIrVectorType(loopVectorizationCandidateForTest().laneType, 4),
    );
    expect(result.rewriteRecords.map((record) => record.loopId)).toEqual(["loop:a", "loop:z"]);
    expect(result.rewriteRecords[0]).toMatchObject({
      tailPlan: { kind: "certifiedMultiple" },
      invariant: {
        kind: "conjunction",
        invariants: [
          { kind: "vectorLaneEquivalence" },
          { kind: "noaliasMemoryEquivalence" },
          { kind: "effectBoundaryEquivalence" },
        ],
      },
    });
  });

  test("uses masked vector operations for masked-tail plans and leaves unknown-trip loops scalar", () => {
    const result = runLoopVectorization({
      candidates: [
        loopVectorizationCandidateForTest({ tripCount: { kind: "unknown" } }),
        loopVectorizationCandidateForTest({
          loopId: "masked",
          tripCount: { kind: "certifiedExact", iterations: 18 },
          tailPlan: { kind: "maskedTail", maskValueId: optIrValueId(77) },
        }),
      ],
      policy: optIrDefaultVectorPolicy(targetOptimizationSurfaceForTest({ vectorEnabled: true })),
    });

    expect(result.vectorOperations.map((operation) => operation.kind)).toEqual([
      "vectorMaskedLoad",
    ]);
    expect(result.scalarLoopIds).toEqual(["loop:payload-copy"]);
    expect(result.rejections).toEqual([]);
  });

  test("widens vector memory access byte width from scalar lane width", () => {
    const baseCandidate = loopVectorizationCandidateForTest();
    const result = runLoopVectorization({
      candidates: [
        loopVectorizationCandidateForTest({
          memoryAccesses: baseCandidate.memoryAccesses.map((access) => ({
            ...access,
            byteWidth: 1,
            vectorByteWidth: 4,
            alignment: 1,
          })),
        }),
      ],
      policy: optIrDefaultVectorPolicy(targetOptimizationSurfaceForTest({ vectorEnabled: true })),
    });

    const load = result.vectorOperations[0];
    expect(load?.kind).toBe("vectorLoad");
    if (load?.kind !== "vectorLoad") {
      throw new Error("Expected vectorized loop to emit a vector load.");
    }
    expect(load.memoryAccess.byteWidth).toBe(4);
  });

  test("discovers proven scalar memory loops as vector load targets", () => {
    const { program, operations } = discoveredLoadLoopProgramForTest();
    const target = targetOptimizationSurfaceForTest({ vectorEnabled: true });
    const candidates = discoverLoopVectorizationCandidates({
      program,
      operations,
      facts: optIrFactSetFromRecords([]),
      target,
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.scalarOperationIds).toEqual([optIrOperationId(14)]);
    expect(candidates[0]?.memoryAccesses.map((access) => access.kind)).toEqual(["load"]);
    expect(candidates[0]?.targetOperationKinds).toEqual(["vectorLoad"]);

    const result = runLoopVectorization({
      candidates,
      policy: optIrDefaultVectorPolicy(target),
    });
    expect(result.rejections).toEqual([]);
    expect(result.vectorOperations.map((operation) => operation.kind)).toEqual(["vectorLoad"]);
  });
});
