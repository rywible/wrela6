import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  buildOptIrRegionsForTest,
  type OptIrRegionEntry,
  normalizeTargetEffectRequirementsForTest,
} from "../../../src/opt-ir/lower/region-builder";
import type { OptIrRegion } from "../../../src/opt-ir/regions";

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
});
