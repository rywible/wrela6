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

test("platform calls carry certified platform resolved targets", () => {
  const result = monomorphizeWholeImage({
    program: platformPrimitiveReachabilityProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  const resolvedTarget = result.program.resolvedCallTargets
    .entries()
    .find((target) => target.kind === "certifiedPlatform");

  expect(resolvedTarget?.kind).toBe("certifiedPlatform");
  if (resolvedTarget?.kind !== "certifiedPlatform") return;
  expect(resolvedTarget.primitiveId).toBeDefined();
  expect(resolvedTarget.targetPlatformEdgeId).toBeDefined();
});

test("platform contract edges carry instantiated type arguments and abi metadata", () => {
  const result = monomorphizeWholeImage({
    program: platformPrimitiveReachabilityProgramForMonoTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  const edge = result.program.proofMetadata.platformContractEdges.entries()[0];
  expect(edge?.callExpressionId).toBeDefined();
  expect(edge?.instantiatedOwnerTypeArguments).toEqual([]);
  expect(edge?.instantiatedFunctionTypeArguments).toEqual([]);
  expect(edge?.monomorphicEdgeKey).toEqual(expect.any(String));
  expect(edge?.abi.targetId).toBeDefined();
  expect(edge?.abi.primitiveId).toBeDefined();
  expect(edge?.abi.contractId).toBeDefined();
});

test("reachable primitive ids are deduped from mono platform edges", () => {
  const program = monomorphizedProgramWithPlatformEdgesForTest(["clock_read", "event_send"]);

  expect(collectReachablePlatformPrimitiveIds(program).map(String)).toEqual([
    "clock_read",
    "event_send",
  ]);
});
