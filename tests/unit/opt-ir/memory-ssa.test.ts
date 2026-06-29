import { describe, expect, test } from "bun:test";
import {
  buildEffectTokenIndexForTest,
  buildMemorySsaForTest,
  shouldBuildMemorySsaForFixedPipeline,
} from "../../../src/opt-ir/analyses/memory-ssa";
import { optIrFactId, optIrMemoryVersionId, optIrOperationId } from "../../../src/opt-ir/ids";
import {
  constantOnlyMemoryFixtureForTest,
  multiRegionCallDroppingOneTokenForTest,
  multiRegionCallFixtureForTest,
  outOfOrderOperationIdStoresFixtureForTest,
  packetReadFixtureForTest,
  runtimeOrderedRegionFixtureForTest,
  stackStoresFixtureForTest,
} from "../../support/opt-ir/memory-ssa-fixtures";

describe("OptIR memory SSA and effect-token indexes", () => {
  test("assigns deterministic memory versions to mutable stack stores", () => {
    const fixture = stackStoresFixtureForTest();
    const index = buildMemorySsaForTest(fixture);

    expect(index.kind).toBe("ok");
    if (index.kind !== "ok") {
      return;
    }
    expect(
      index.index.versionBefore(optIrOperationId(1), fixture.namedRegions.stack.regionId),
    ).toBe(optIrMemoryVersionId(0));
    expect(index.index.versionAfter(optIrOperationId(1), fixture.namedRegions.stack.regionId)).toBe(
      optIrMemoryVersionId(1),
    );
    expect(index.index.versionAfter(optIrOperationId(2), fixture.namedRegions.stack.regionId)).toBe(
      optIrMemoryVersionId(2),
    );
  });

  test("assigns memory versions in block operation order instead of operation id order", () => {
    const fixture = outOfOrderOperationIdStoresFixtureForTest();
    const index = buildMemorySsaForTest(fixture);

    expect(index.kind).toBe("ok");
    if (index.kind !== "ok") {
      return;
    }
    expect(index.index.versionAfter(optIrOperationId(2), fixture.namedRegions.stack.regionId)).toBe(
      optIrMemoryVersionId(1),
    );
    expect(index.index.versionAfter(optIrOperationId(1), fixture.namedRegions.stack.regionId)).toBe(
      optIrMemoryVersionId(2),
    );
  });

  test("skips immutable constant regions even when they are loaded", () => {
    const fixture = constantOnlyMemoryFixtureForTest();
    const index = buildMemorySsaForTest(fixture);

    expect(index.kind).toBe("ok");
    if (index.kind !== "ok") {
      return;
    }
    expect(index.index.trackedRegions()).toEqual([]);
    expect(
      index.index.versionBefore(optIrOperationId(1), fixture.namedRegions.constant.regionId),
    ).toBe(undefined);
  });

  test("packet and validated payload reads use read-only versions with certified bounds", () => {
    const fixture = packetReadFixtureForTest();
    const index = buildMemorySsaForTest(fixture);

    expect(index.kind).toBe("ok");
    if (index.kind !== "ok") {
      return;
    }
    expect(index.index.readOnlyVersionFor(fixture.namedRegions.packet.regionId)).toBe(
      optIrMemoryVersionId(0),
    );
    expect(
      index.index.versionBefore(optIrOperationId(1), fixture.namedRegions.packet.regionId),
    ).toBe(optIrMemoryVersionId(0));
    expect(index.index.boundsAuthorityFor(optIrOperationId(1))).toEqual({
      kind: "certifiedFact",
      factId: optIrFactId(1),
    });
  });

  test("ordered runtime regions use effect-token threads instead of memory versions", () => {
    const fixture = runtimeOrderedRegionFixtureForTest();
    const memory = buildMemorySsaForTest(fixture);
    const tokens = buildEffectTokenIndexForTest(fixture);

    expect(memory.kind).toBe("ok");
    expect(tokens.kind).toBe("ok");
    if (memory.kind !== "ok" || tokens.kind !== "ok") {
      return;
    }
    expect(memory.index.trackedRegions()).toEqual([]);
    expect(tokens.index.tokenAfter(optIrOperationId(1), "runtime:log")).toEqual({
      tokenKey: "runtime:log",
      version: 1,
    });
  });

  test("multi-region calls consume and produce every token thread from lowered metadata", () => {
    const fixture = multiRegionCallFixtureForTest();
    const tokens = buildEffectTokenIndexForTest(fixture);

    expect(tokens.kind).toBe("ok");
    if (tokens.kind !== "ok") {
      return;
    }
    expect(tokens.index.requiredTokenKeysFor(optIrOperationId(1))).toEqual([
      "device:dma-order",
      "packet:rx-version",
      "runtime:scratch-order",
    ]);
    expect(tokens.index.tokenBefore(optIrOperationId(1), "packet:rx-version")).toEqual({
      tokenKey: "packet:rx-version",
      version: 0,
    });
    expect(tokens.index.tokenAfter(optIrOperationId(1), "runtime:scratch-order")).toEqual({
      tokenKey: "runtime:scratch-order",
      version: 1,
    });
  });

  test("rejects multi-region calls whose lowered metadata dropped a required token thread", () => {
    const result = buildEffectTokenIndexForTest(multiRegionCallDroppingOneTokenForTest());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      return;
    }
    expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
      "OPT_IR_EFFECT_TOKEN_INCOMPLETE",
    ]);
  });

  test("trigger decisions depend only on operation kinds, region kinds, and fixed pipeline needs", () => {
    expect(
      shouldBuildMemorySsaForFixedPipeline({
        operationKinds: ["constant"],
        regionKinds: ["constantData"],
        pipelineRequiresMemoryPrecision: true,
      }),
    ).toBe(false);
    expect(
      shouldBuildMemorySsaForFixedPipeline({
        operationKinds: ["memoryStore"],
        regionKinds: ["stackLocal"],
        pipelineRequiresMemoryPrecision: true,
      }),
    ).toBe(true);
    expect(
      shouldBuildMemorySsaForFixedPipeline({
        operationKinds: ["memoryStore"],
        regionKinds: ["stackLocal"],
        pipelineRequiresMemoryPrecision: false,
      }),
    ).toBe(false);
  });
});
