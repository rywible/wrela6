import { expect, test } from "bun:test";
import fastCheck from "fast-check";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import {
  monoSummary,
  shuffledClosedProgramForMonoTest,
  twoCallSitesSameGenericInstanceProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";

test("determinism summary includes full monomorphized output details", () => {
  const result = monomorphizeWholeImage({
    program: twoCallSitesSameGenericInstanceProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const summary = JSON.parse(monoSummary(result));
    expect(summary.program.instantiationGraph.edges.length).toBeGreaterThan(0);
    expect(summary.program.functions.some((func: { readonly body?: unknown }) => func.body)).toBe(
      true,
    );
    expect(summary.program.image.entryFunctionInstanceId).toBeDefined();
    expect(summary.program.proofMetadata).toBeDefined();
  }
});

test("monomorphized output is deterministic for shuffled equivalent HIR tables", () => {
  fastCheck.assert(
    fastCheck.property(fastCheck.integer({ min: 0, max: 10_000 }), (seed) => {
      const baseline = monomorphizeWholeImage({
        program: shuffledClosedProgramForMonoTest(0),
      });
      const shuffled = monomorphizeWholeImage({
        program: shuffledClosedProgramForMonoTest(seed),
      });

      expect(monoSummary(shuffled)).toBe(monoSummary(baseline));
    }),
    { numRuns: 50 },
  );
});
