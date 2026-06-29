import { describe, expect, test } from "bun:test";
import { optIrBlockId, optIrValueId } from "../../../src/opt-ir/ids";
import { runLoopVectorization } from "../../../src/opt-ir/passes/loop-vectorization";
import { optIrDefaultVectorPolicy } from "../../../src/opt-ir/policy/vector-policy";
import { optIrVectorType } from "../../../src/opt-ir/vector-types";
import { targetOptimizationSurfaceForTest } from "../../support/opt-ir/target-optimization-fakes";
import { loopVectorizationCandidateForTest } from "../../support/opt-ir/vector-fixtures";

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
      "vectorStore",
      "vectorLoad",
      "vectorStore",
    ]);
    const store = result.vectorOperations[1];
    if (store?.kind !== "vectorStore") {
      throw new Error("Expected legal loop vectorization to emit a vector store.");
    }
    expect(store.memoryAccess.valueType).toEqual(
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
      "vectorMaskedStore",
    ]);
    expect(result.scalarLoopIds).toEqual(["loop:payload-copy"]);
    expect(result.rejections).toEqual([]);
  });
});
