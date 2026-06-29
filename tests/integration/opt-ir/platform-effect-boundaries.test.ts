import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  buildOptIrRegionsForTest,
  type OptIrRegionEntry,
  normalizeTargetEffectRequirementsForTest,
} from "../../../src/opt-ir/lower/region-builder";
import { optIrCallId, optIrOperationId, optIrOriginId } from "../../../src/opt-ir/ids";
import { lowerPlatformCallForTest } from "../../../src/opt-ir/lower/call-lowering";
import type { OptIrRegion } from "../../../src/opt-ir/regions";
import { optIrUnitType } from "../../../src/opt-ir/types";

function requireRegion(region: OptIrRegion | undefined): OptIrRegion {
  if (region === undefined) {
    throw new Error("Expected test fixture to contain region.");
  }
  return region;
}

function requireEntry(entry: OptIrRegionEntry | undefined): OptIrRegionEntry {
  if (entry === undefined) {
    throw new Error("Expected test fixture to contain region entry.");
  }
  return entry;
}

describe("OptIR platform effect boundaries", () => {
  test("multi-region runtime effects require every token thread and cross-region observation edge", () => {
    const regions = buildOptIrRegionsForTest({
      functionId: monoInstanceId("fn:copy-packet"),
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

    expect(normalized.requirements).toContainEqual({
      mode: "readVersionToken",
      tokenKey: "packet:rx-version",
    });
    expect(normalized.requirements).toContainEqual({
      mode: "orderedEffectToken",
      tokenKey: "runtime:scratch-order",
    });
    expect(normalized.requirements).toContainEqual({
      mode: "orderedEffectToken",
      tokenKey: "device:dma-order",
    });
    const packet = requireEntry(regions.lookup("packetSource", "packet")).region;
    const scratch = requireEntry(regions.lookup("runtimeMemory", "scratch")).region;
    const dma = requireEntry(regions.lookup("imageDevice", "dma")).region;
    expect(normalized.observationEdges).toEqual([
      {
        source: packet.aliasClass,
        target: scratch.aliasClass,
        effectKey: "runtime.copy_to_dma",
      },
      {
        source: packet.aliasClass,
        target: dma.aliasClass,
        effectKey: "runtime.copy_to_dma",
      },
      {
        source: scratch.aliasClass,
        target: dma.aliasClass,
        effectKey: "runtime.copy_to_dma",
      },
    ]);
  });

  test("unknown platform calls over external places stay outside packet alias classes", () => {
    const regions = buildOptIrRegionsForTest({
      packetSources: [{ key: "packet", source: "rx" }],
      includeExternalUnknown: true,
    });

    const normalized = normalizeTargetEffectRequirementsForTest({
      regions,
      catalogEffect: {
        effectKey: "platform.vendor_call",
        readsMemory: true,
        writesMemory: true,
        platformEffect: "unknown",
      },
    });

    const externalUnknown = requireRegion(regions.externalUnknown());
    const packet = requireEntry(regions.lookup("packetSource", "packet")).region;
    expect(normalized.requirements).toContainEqual({
      mode: "mutate",
      region: externalUnknown.aliasClass,
    });
    expect(normalized.requirements).not.toContainEqual({
      mode: "mutate",
      region: packet.aliasClass,
    });
  });

  test("terminal platform calls emit terminal terminators without dropping earlier ordered effects", () => {
    const first = lowerPlatformCallForTest({
      targetKey: "platform.flush_console",
      operationId: optIrOperationId(20),
      callId: optIrCallId(21),
      originId: optIrOriginId(22),
      argumentIds: [],
      resultIds: [],
      resultTypes: [optIrUnitType()],
      requirements: [{ mode: "orderedEffectToken", tokenKey: "platform:console" }],
    });
    const terminal = lowerPlatformCallForTest({
      targetKey: "platform.exit",
      operationId: optIrOperationId(23),
      callId: optIrCallId(24),
      originId: optIrOriginId(25),
      argumentIds: [],
      resultIds: [],
      resultTypes: [optIrUnitType()],
      requirements: [
        { mode: "orderedEffectToken", tokenKey: "platform:console" },
        { mode: "terminal", terminalKey: "platform:exit" },
      ],
      priorObservableEffects: first.kind === "ok" ? first.call.header.effects.requirements : [],
    });

    expect(first.kind).toBe("ok");
    expect(terminal.kind).toBe("ok");
    if (terminal.kind !== "ok") {
      return;
    }
    expect(terminal.call.terminator).toEqual({
      kind: "unreachable",
      operationId: optIrOperationId(23),
      originId: optIrOriginId(25),
    });
    expect(terminal.call.header.effects.priorObservableEffects).toContainEqual({
      mode: "orderedEffectToken",
      tokenKey: "platform:console",
    });
    expect(terminal.call.header.terminalBehavior).toEqual({
      kind: "terminal",
      terminalKey: "platform:exit",
    });
  });
});
