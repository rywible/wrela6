import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  optIrCallId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import {
  buildOptIrRegionsForTest,
  normalizeTargetEffectRequirementsForTest,
} from "../../../src/opt-ir/lower/region-builder";
import {
  lowerPlatformCallForTest,
  lowerRuntimeCallForTest,
  lowerSourceCallForTest,
} from "../../../src/opt-ir/lower/call-lowering";
import { optIrUnsignedIntegerType, optIrUnitType } from "../../../src/opt-ir/types";
import { targetOptimizationSurfaceForTest } from "../../support/opt-ir/target-optimization-fakes";

describe("OptIR call lowering", () => {
  test("source calls carry checked callee, ABI, summary, effects, terminal behavior, and result fact hooks", () => {
    const regions = buildOptIrRegionsForTest({
      runtimeMemory: [{ key: "session" }],
    });
    const session = regions.lookup("runtimeMemory", "session");
    if (session === undefined) {
      throw new Error("Expected session region.");
    }

    const result = lowerSourceCallForTest({
      operationId: optIrOperationId(1),
      callId: optIrCallId(2),
      originId: optIrOriginId(3),
      calleeId: monoInstanceId("fn:parse_header"),
      argumentIds: [optIrValueId(10)],
      resultIds: [optIrValueId(11)],
      resultTypes: [optIrUnsignedIntegerType(32)],
      summary: {
        summaryId: "summary:parse_header",
        parameters: ["packet"],
        resultCount: 1,
      },
      abiShape: {
        callingConvention: "wrela-fixture",
        parameters: [{ valueId: optIrValueId(10), classification: "register" }],
        results: [{ resultId: optIrValueId(11), classification: "register" }],
      },
      effectSummary: {
        requirements: [
          { mode: "observe", region: session.region.aliasClass },
          { mode: "orderedEffectToken", tokenKey: "runtime:session-order" },
        ],
      },
      terminalBehavior: { kind: "returns" },
      resultFactHooks: [{ resultId: optIrValueId(11), factKey: "bounds:header" }],
    });

    expect(result.operation.kind).toBe("sourceCall");
    expect(result.header.target).toEqual({
      kind: "source",
      functionInstanceId: monoInstanceId("fn:parse_header"),
    });
    expect(result.header.calleeId).toBe(monoInstanceId("fn:parse_header"));
    expect(result.header.summary.summaryId).toBe("summary:parse_header");
    expect(result.header.abiShape.callingConvention).toBe("wrela-fixture");
    expect(result.header.effects.orderedRegions).toEqual(["runtime:session-order"]);
    expect(result.header.terminalBehavior).toEqual({ kind: "returns" });
    expect(result.header.resultFactHooks).toEqual([
      { resultId: optIrValueId(11), factKey: "bounds:header" },
    ]);
    expect("effectTokenIndex" in result).toBe(false);
  });

  test("runtime and platform calls require matching authority fingerprints from catalogs", () => {
    const surface = targetOptimizationSurfaceForTest({
      runtimeEffects: [
        {
          runtimeKey: "runtime.write_log",
          requirements: [{ mode: "orderedEffectToken", tokenKey: "runtime:log" }],
        },
      ],
      platformEffects: [
        {
          targetKey: "platform.exit",
          requirements: [{ mode: "terminal", terminalKey: "platform:exit" }],
        },
      ],
    });

    const runtime = lowerRuntimeCallForTest({
      targetSurface: surface,
      expectedAuthority: surface.runtimeEffects.fingerprint,
      runtimeKey: "runtime.write_log",
      operationId: optIrOperationId(4),
      callId: optIrCallId(5),
      originId: optIrOriginId(6),
      argumentIds: [],
      resultIds: [],
      resultTypes: [optIrUnitType()],
    });
    const platform = lowerPlatformCallForTest({
      targetSurface: surface,
      expectedAuthority: surface.platformEffects.fingerprint,
      targetKey: "platform.exit",
      operationId: optIrOperationId(7),
      callId: optIrCallId(8),
      originId: optIrOriginId(9),
      argumentIds: [],
      resultIds: [],
      resultTypes: [optIrUnitType()],
    });
    const mismatch = lowerRuntimeCallForTest({
      targetSurface: surface,
      expectedAuthority: surface.platformEffects.fingerprint,
      runtimeKey: "runtime.write_log",
      operationId: optIrOperationId(10),
      callId: optIrCallId(11),
      originId: optIrOriginId(12),
      argumentIds: [],
      resultIds: [],
      resultTypes: [optIrUnitType()],
    });

    expect(runtime.kind).toBe("ok");
    expect(runtime.kind === "ok" ? runtime.call.header.authority : undefined).toEqual(
      surface.runtimeEffects.fingerprint,
    );
    expect(platform.kind).toBe("ok");
    expect(platform.kind === "ok" ? platform.call.terminator?.kind : undefined).toBe("unreachable");
    expect(mismatch.kind).toBe("error");
  });

  test("unknown callback-capable calls declare external and escaped ordered requirements", () => {
    const regions = buildOptIrRegionsForTest({
      stackLocals: [{ key: "callback-frame", callbackVisible: true }],
      includeExternalUnknown: true,
    });
    const external = regions.externalUnknown();
    const escaped = regions.lookup("stackLocal", "callback-frame");
    if (external === undefined || escaped === undefined) {
      throw new Error("Expected callback-visible and external regions.");
    }

    const result = lowerPlatformCallForTest({
      targetKey: "platform.callback",
      operationId: optIrOperationId(13),
      callId: optIrCallId(14),
      originId: optIrOriginId(15),
      argumentIds: [],
      resultIds: [],
      resultTypes: [optIrUnitType()],
      conservativeRegions: regions,
      callbackCapable: true,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.call.header.effects.requirements).toContainEqual({
      mode: "orderedEffectToken",
      tokenKey: "external:unknown",
    });
    expect(result.call.header.effects.requirements).toContainEqual({
      mode: "orderedEffectToken",
      tokenKey: "escaped:stackLocal:callback-frame",
    });
    expect(result.call.header.effects.mutatedRegions).toContain(external.aliasClass);
    expect(result.call.header.effects.mutatedRegions).toContain(escaped.region.aliasClass);
  });

  test("multi-region requirements from normalized catalogs are retained in metadata", () => {
    const regions = buildOptIrRegionsForTest({
      packetSources: [{ key: "packet", source: "rx" }],
      runtimeMemory: [{ key: "scratch" }],
      imageDevices: [{ key: "dma" }],
    });
    const normalized = normalizeTargetEffectRequirementsForTest({
      regions,
      catalogEffect: {
        effectKey: "runtime.copy_to_dma",
        readsMemory: true,
        writesMemory: true,
        tokenKeys: ["packet:rx-version", "runtime:scratch-order", "device:dma-order"],
        placeKeys: ["packetSource:packet", "runtimeMemory:scratch", "imageDevice:dma"],
      },
    });

    const result = lowerRuntimeCallForTest({
      runtimeKey: "runtime.copy_to_dma",
      operationId: optIrOperationId(16),
      callId: optIrCallId(17),
      originId: optIrOriginId(18),
      argumentIds: [],
      resultIds: [],
      resultTypes: [optIrUnitType()],
      requirements: normalized.requirements,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.call.header.effects.orderedRegions).toEqual([
      "region:packetSource:",
      "region:runtimeMemory:",
      "region:imageDevice:dma",
      "runtime:scratch-order",
      "device:dma-order",
    ]);
    expect(result.call.header.effects.readVersionRegions).toEqual(["packet:rx-version"]);
  });

  test("deduplicates equivalent effect requirements without dropping distinct modes", () => {
    const result = lowerRuntimeCallForTest({
      runtimeKey: "runtime.dedupe",
      operationId: optIrOperationId(30),
      callId: optIrCallId(31),
      originId: optIrOriginId(32),
      argumentIds: [],
      resultIds: [],
      resultTypes: [optIrUnitType()],
      requirements: [
        { mode: "orderedEffectToken", tokenKey: "runtime:shared" },
        { mode: "orderedEffectToken", tokenKey: "runtime:shared" },
        { mode: "readVersionToken", tokenKey: "runtime:shared" },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }
    expect(result.call.header.effects.requirements).toEqual([
      { mode: "orderedEffectToken", tokenKey: "runtime:shared" },
      { mode: "readVersionToken", tokenKey: "runtime:shared" },
    ]);
  });
});
