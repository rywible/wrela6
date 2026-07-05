import { describe, expect, test } from "bun:test";

import { optIrIntegerConstant } from "../../../../src/opt-ir/constants";
import { fixtureSpecForFullImageCase } from "../../../../src/validation/full-image";
import {
  compareFixtureOptIrObservationsForTest,
  loadFixtureOptIrObservationInputForTest,
} from "../../../support/opt-ir/fixture-observation";
import { nodeFixtureProjectFilesystem } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("full-image fixture OptIR observation differential", () => {
  test("compares unoptimized and optimized observations for a real fixture artifact", () => {
    const input = loadFixtureOptIrObservationInputForTest({
      spec: fixtureSpecForFullImageCase({
        scenario: "status-error",
        stdlibMode: "toolchain-stdlib",
      }),
      filesystem: nodeFixtureProjectFilesystem,
    });

    const comparison = compareFixtureOptIrObservationsForTest(input);

    expect(input.caseKey).toBe("status-error/toolchain-stdlib");
    expect(input.slices).toHaveLength(1);
    expect(input.slices[0]?.unoptimizedObservation.exitStatus).toBe("returned");
    expect(input.slices[0]?.optimizedObservation).toEqual(input.slices[0]?.unoptimizedObservation);
    expect(comparison).toEqual({ kind: "equivalent" });
  });

  test("catches a deliberate optimized observation mismatch", () => {
    const input = loadFixtureOptIrObservationInputForTest({
      spec: fixtureSpecForFullImageCase({
        scenario: "status-error",
        stdlibMode: "toolchain-stdlib",
      }),
      filesystem: nodeFixtureProjectFilesystem,
    });
    const slice = input.slices[0];
    if (slice === undefined) {
      throw new Error("expected the status-error fixture to expose a comparable OptIR slice");
    }
    const optimizedConstant = slice.optimized.operations.find(
      (operation) => "constant" in operation,
    );
    if (optimizedConstant === undefined || !("constant" in optimizedConstant)) {
      throw new Error("expected a constant operation in the optimized observation slice");
    }
    const mismatchedOptimized = {
      ...slice.optimized,
      operations: Object.freeze(
        slice.optimized.operations.map((operation) =>
          operation.operationId === optimizedConstant.operationId
            ? {
                ...operation,
                constant: optIrIntegerConstant({
                  ...optimizedConstant.constant,
                  normalizedValue: optimizedConstant.constant.normalizedValue + 1n,
                }),
              }
            : operation,
        ),
      ),
    };

    const comparison = compareFixtureOptIrObservationsForTest({
      ...input,
      slices: Object.freeze([{ ...slice, optimized: mismatchedOptimized }]),
    });

    expect(comparison).toEqual({
      kind: "different",
      differences: ["status-error/toolchain-stdlib:function:0:values"],
    });
  });
});
