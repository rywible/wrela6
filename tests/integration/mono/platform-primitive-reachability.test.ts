import { expect, test } from "bun:test";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import {
  monomorphizedProgramWithPlatformEdgesForTest,
  platformPrimitiveReachabilityProgramForMonoTest,
} from "../../support/mono/monomorphization-fixtures";
import { collectReachablePlatformPrimitiveIds } from "../../../src/mono/platform-primitives";

test("reachable primitive ids match instantiated platform contract edges", () => {
  const program = platformPrimitiveReachabilityProgramForMonoTest();
  const result = monomorphizeWholeImage({ program });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const platformFunctionId =
      program.monoClosure.certifiedPlatformBindings.entries()[0]?.functionId;
    expect(platformFunctionId).toBeDefined();
    expect(
      result.program.functions
        .entries()
        .some(
          (entry) =>
            entry.sourceFunctionId === platformFunctionId &&
            entry.bodyStatus === "certifiedPlatform",
        ),
    ).toBe(true);

    const edgePrimitiveIds = result.program.proofMetadata.platformContractEdges
      .entries()
      .map((edge) => edge.primitiveId)
      .sort();

    expect(result.program.reachablePlatformPrimitiveIds).toEqual(edgePrimitiveIds);
    expect(result.reachablePlatformPrimitiveIds).toEqual(edgePrimitiveIds);
  }
});

test("reachable primitive ids are deduped from mono platform edges", () => {
  const program = monomorphizedProgramWithPlatformEdgesForTest(["clock_read", "event_send"]);

  expect(collectReachablePlatformPrimitiveIds(program).map(String)).toEqual([
    "clock_read",
    "event_send",
  ]);
});
