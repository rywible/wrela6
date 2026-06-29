import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  buildOptIrRegionsForTest,
  type OptIrRegionEntry,
  normalizeTargetEffectRequirementsForTest,
} from "../../../src/opt-ir/lower/region-builder";
import type { OptIrRegion } from "../../../src/opt-ir/regions";
import { layoutFactKey } from "../../../src/proof-check/model/fact-packet";

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

describe("OptIR region builder", () => {
  test("creates stable regions for every construction source", () => {
    const first = buildOptIrRegionsForTest({
      functionId: monoInstanceId("fn:parse"),
      stackLocals: [{ key: "tmp", layoutKey: layoutFactKey("layout:tmp") }],
      sourceAggregates: [{ key: "header", layoutKey: layoutFactKey("layout:header") }],
      packetSources: [
        { key: "packet", source: "bytes", layoutKey: layoutFactKey("layout:packet") },
      ],
      validatedPayloadViews: [
        { key: "payload", backingPacket: "packet", byteRange: { start: 8n, end: 24n } },
      ],
      constants: [{ key: "magic" }],
      globals: [{ key: "state" }],
      imageDevices: [{ key: "boot-services" }],
      firmwareTables: [{ key: "acpi" }],
      runtimeMemory: [{ key: "allocator" }],
      includeExternalUnknown: true,
    });
    const second = buildOptIrRegionsForTest({
      functionId: monoInstanceId("fn:parse"),
      runtimeMemory: [{ key: "allocator" }],
      firmwareTables: [{ key: "acpi" }],
      imageDevices: [{ key: "boot-services" }],
      globals: [{ key: "state" }],
      constants: [{ key: "magic" }],
      validatedPayloadViews: [
        { key: "payload", backingPacket: "packet", byteRange: { start: 8n, end: 24n } },
      ],
      packetSources: [
        { key: "packet", source: "bytes", layoutKey: layoutFactKey("layout:packet") },
      ],
      sourceAggregates: [{ key: "header", layoutKey: layoutFactKey("layout:header") }],
      stackLocals: [{ key: "tmp", layoutKey: layoutFactKey("layout:tmp") }],
      includeExternalUnknown: true,
    });

    expect(
      first.entries().map((region) => `${region.regionId}:${region.kind}:${region.aliasClass}`),
    ).toEqual(
      second.entries().map((region) => `${region.regionId}:${region.kind}:${region.aliasClass}`),
    );
    expect(first.entries().map((region) => region.kind)).toEqual([
      "stackLocal",
      "sourceAggregate",
      "packetSource",
      "validatedPayload",
      "constantData",
      "globalData",
      "imageDevice",
      "firmwareTable",
      "runtimeMemory",
      "externalUnknown",
    ]);
  });

  test("marks escaped places and classifies them conservatively", () => {
    const regions = buildOptIrRegionsForTest({
      functionId: monoInstanceId("fn:callbacks"),
      stackLocals: [
        { key: "owned" },
        { key: "addressed", addressTaken: true },
        { key: "callback", callbackVisible: true },
      ],
      sourceAggregates: [{ key: "published", callbackVisible: true }],
    });

    expect(regions.lookup("stackLocal", "owned")?.escaped).toBe(false);
    expect(regions.lookup("stackLocal", "addressed")?.escaped).toBe(true);
    expect(regions.lookup("stackLocal", "callback")?.escaped).toBe(true);
    expect(regions.lookup("sourceAggregate", "published")?.escaped).toBe(true);
    expect(regions.lookup("stackLocal", "addressed")?.region.effects).toEqual({
      mutability: "mutable",
      ordering: "orderedEffectToken",
    });
    expect(regions.lookup("stackLocal", "callback")?.region.aliasClass).toBe(
      regions.externalUnknown()?.aliasClass,
    );
    expect(regions.lookup("sourceAggregate", "published")?.region.aliasClass).toBe(
      regions.externalUnknown()?.aliasClass,
    );
  });

  test("links validated payload views to backing packet source alias classes and byte ranges", () => {
    const regions = buildOptIrRegionsForTest({
      functionId: monoInstanceId("fn:payload"),
      packetSources: [{ key: "packet", source: "bytes" }],
      validatedPayloadViews: [
        { key: "payload.header", backingPacket: "packet", byteRange: { start: 4n, end: 12n } },
      ],
    });

    const packet = requireEntry(regions.lookup("packetSource", "packet"));
    const payload = regions.validatedPayload("payload.header");

    expect(payload?.backingPacketAliasClass).toBe(packet?.region.aliasClass);
    expect(payload?.byteRange).toEqual({ start: 4n, end: 12n });
    expect(payload?.region.effects.ordering).toBe("readOnlyRegionVersion");
  });

  test("normalizes unknown place-bound effects to external unknown memory", () => {
    const regions = buildOptIrRegionsForTest({ includeExternalUnknown: true });
    const requirements = normalizeTargetEffectRequirementsForTest({
      regions,
      catalogEffect: { effectKey: "platform.opaque", readsMemory: true, writesMemory: true },
    });

    const externalUnknown = requireRegion(regions.externalUnknown());
    expect(requirements.requirements).toEqual([
      { mode: "observe", region: externalUnknown.aliasClass },
      { mode: "mutate", region: externalUnknown.aliasClass },
      { mode: "orderedEffectToken", tokenKey: "external:unknown" },
    ]);
  });

  test("keeps explicitly externally visible unknown effects ordered over that region", () => {
    const regions = buildOptIrRegionsForTest({
      imageDevices: [{ key: "framebuffer" }],
      firmwareTables: [{ key: "acpi" }],
    });
    const requirements = normalizeTargetEffectRequirementsForTest({
      regions,
      catalogEffect: {
        effectKey: "platform.repaint",
        readsMemory: true,
        writesMemory: true,
        placeKeys: ["imageDevice:framebuffer"],
      },
    });

    const framebuffer = requireEntry(regions.lookup("imageDevice", "framebuffer")).region;
    expect(requirements.requirements).toEqual([
      { mode: "observe", region: framebuffer.aliasClass },
      { mode: "mutate", region: framebuffer.aliasClass },
      { mode: "orderedEffectToken", tokenKey: "region:imageDevice:framebuffer" },
    ]);
  });
});
