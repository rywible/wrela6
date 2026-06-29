import { describe, expect, test } from "bun:test";
import { optIrBlockId, optIrValueId } from "../../../src/opt-ir/ids";
import {
  classifyLoopVectorizationShape,
  sortLoopVectorizationShapes,
} from "../../../src/opt-ir/passes/loop-vectorization/loop-shape";
import { loopVectorizationCandidateForTest } from "../../support/opt-ir/vector-fixtures";

describe("OptIR loop vectorization shape", () => {
  test("accepts certified exact trip counts with selected multiple, masked, or epilogue tails", () => {
    expect(classifyLoopVectorizationShape(loopVectorizationCandidateForTest()).kind).toBe(
      "vectorizable",
    );
    const maskedShape = classifyLoopVectorizationShape(
      loopVectorizationCandidateForTest({
        tripCount: { kind: "certifiedExact", iterations: 18 },
        tailPlan: { kind: "maskedTail", maskValueId: optIrValueId(77) },
      }),
    );
    const epilogueShape = classifyLoopVectorizationShape(
      loopVectorizationCandidateForTest({
        tripCount: { kind: "certifiedExact", iterations: 18 },
        tailPlan: { kind: "scalarEpilogue", epilogueBlockId: optIrBlockId(90) },
      }),
    );

    expect(maskedShape.kind).toBe("vectorizable");
    expect(epilogueShape.kind).toBe("vectorizable");
    expect(maskedShape.kind === "vectorizable" ? maskedShape.tailPlan : undefined).toEqual({
      kind: "maskedTail",
      maskValueId: optIrValueId(77),
    });
    expect(epilogueShape.kind === "vectorizable" ? epilogueShape.tailPlan : undefined).toEqual({
      kind: "scalarEpilogue",
      epilogueBlockId: optIrBlockId(90),
    });
  });

  test("leaves unknown-trip loops scalar without inventing guards", () => {
    const shape = classifyLoopVectorizationShape(
      loopVectorizationCandidateForTest({ tripCount: { kind: "unknown" } }),
    );

    expect(shape).toEqual({ kind: "scalar", reason: "unknownTripCount" });
  });

  test("orders shapes deterministically by real loop subjects", () => {
    const shapes = sortLoopVectorizationShapes([
      classifyLoopVectorizationShape(
        loopVectorizationCandidateForTest({ loopId: "loop:b", headerBlockId: optIrBlockId(5) }),
      ),
      classifyLoopVectorizationShape(
        loopVectorizationCandidateForTest({ loopId: "loop:a", headerBlockId: optIrBlockId(7) }),
      ),
    ]);

    expect(shapes.map((shape) => shape.loopId)).toEqual(["loop:b", "loop:a"]);
  });
});
