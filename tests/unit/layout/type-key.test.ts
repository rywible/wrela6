import { describe, expect, test } from "bun:test";
import { buildLayoutTypeResolver } from "../../../src/layout/layout-type-resolver";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import type { LayoutCanonicalKeyString } from "../../../src/layout/ids";
import { seedPrimitiveTypeFacts } from "../../../src/layout/type-layout";
import { monoInstanceId } from "../../../src/mono/ids";
import type { LayoutTypeResolution } from "../../../src/layout/layout-type-resolution";
import { coreTypeId, fieldId, targetTypeId } from "../../../src/semantic/ids";
import {
  layoutDeterministicTable,
  layoutFieldKeyString,
  layoutImageDeviceKeyString,
  layoutTypeKeyString,
} from "../../../src/layout/type-key";
import {
  closedMonoProgramWithPacketType,
  layoutTargetSurfaceFake,
  layoutTypeResolutionsForTest,
  layoutTypeResolverWithResolutions,
  monoProgramWithoutTypeInstance,
  monoProgramWithSourceLayoutResolutions,
  normalizeTargetFactsForTest,
} from "../../support/layout/layout-fixtures";
import { monoCoreType } from "../../support/mono/monomorphization-fixtures";

describe("layoutTypeKeyString", () => {
  test("serializes source keys as length-delimited kind-prefixed strings", () => {
    const key = { kind: "source" as const, instanceId: monoInstanceId("type:Packet") };

    expect(layoutTypeKeyString(key)).toBe("source:len(11):type:Packet" as LayoutCanonicalKeyString);
  });

  test("serializes core and target keys as length-delimited kind-prefixed strings", () => {
    expect(layoutTypeKeyString({ kind: "core", coreTypeId: coreTypeId("u16") })).toBe(
      "core:len(3):u16" as LayoutCanonicalKeyString,
    );
    expect(layoutTypeKeyString({ kind: "target", targetTypeId: targetTypeId("Handle") })).toBe(
      "target:len(6):Handle" as LayoutCanonicalKeyString,
    );
  });
});

describe("layoutFieldKeyString", () => {
  test("embeds the owner type key and field id deterministically", () => {
    const owner = { kind: "source" as const, instanceId: monoInstanceId("type:Packet") };

    expect(layoutFieldKeyString({ owner, fieldId: fieldId(1) })).toBe(
      "field:owner:source:len(11):type:Packet:fieldId:len(1):1" as LayoutCanonicalKeyString,
    );
  });
});

describe("layoutImageDeviceKeyString", () => {
  test("serializes image instance and field id as length-delimited fields", () => {
    expect(
      layoutImageDeviceKeyString({
        imageInstanceId: monoInstanceId("image:0"),
        fieldId: fieldId(3),
      }),
    ).toBe(
      "image-device:imageInstanceId:len(7):image:0:fieldId:len(1):3" as LayoutCanonicalKeyString,
    );
  });
});

describe("layoutDeterministicTable", () => {
  test("field table lookup is structural and deterministic", () => {
    const owner = { kind: "source" as const, instanceId: monoInstanceId("type:Packet") };
    const firstKey = { owner, fieldId: fieldId(1) };
    const secondKey = { owner: { ...owner }, fieldId: fieldId(1) };
    const table = layoutDeterministicTable({
      entries: [{ owner, fieldId: fieldId(1), fieldName: "size" }],
      keyOf: (entry) => ({ owner: entry.owner, fieldId: entry.fieldId }),
      keyString: layoutFieldKeyString,
    });

    expect(table.get(firstKey)?.fieldName).toBe("size");
    expect(table.get(secondKey)?.fieldName).toBe("size");
    expect(table.has(firstKey)).toBe(true);
    expect(table.has({ owner, fieldId: fieldId(99) })).toBe(false);
    expect(table.keyString(firstKey)).toBe(layoutFieldKeyString(firstKey));
    expect(table.entries().map((entry) => entry.fieldName)).toEqual(["size"]);
  });

  test("entries sort by canonical key code-unit order", () => {
    const table = layoutDeterministicTable({
      entries: [
        { key: { kind: "core" as const, coreTypeId: coreTypeId("u32") }, name: "u32" },
        { key: { kind: "core" as const, coreTypeId: coreTypeId("u16") }, name: "u16" },
        { key: { kind: "core" as const, coreTypeId: coreTypeId("u8") }, name: "u8" },
      ],
      keyOf: (entry) => entry.key,
      keyString: layoutTypeKeyString,
    });

    expect(table.entries().map((entry) => entry.name)).toEqual(["u8", "u16", "u32"]);
    expect(
      table
        .entries()
        .map((entry) => table.keyString(entry.key))
        .every((key, index, keys) => index === 0 || keys[index - 1]! <= key),
    ).toBe(true);
  });
});

describe("buildLayoutTypeResolver", () => {
  test("layout resolver uses layout-computed source type key", () => {
    const program = monoProgramWithSourceLayoutResolutions();
    const targetFacts = normalizeTargetFactsForTest(layoutTargetSurfaceFake());
    const resolver = buildLayoutTypeResolver({ program, targetFacts });
    const packetType = layoutTypeResolutionsForTest(program).find(
      (entry) => entry.key.kind === "source",
    )!;

    expect(resolver.kind).toBe("ok");
    if (resolver.kind !== "ok") return;
    if (packetType.key.kind !== "source") {
      throw new Error("expected source layout type resolution");
    }
    expect(resolver.value.resolver.get(packetType.type)).toEqual({
      kind: "source",
      instanceId: packetType.key.instanceId,
    });
  });

  test("reachable core Function does not require layout type resolution", () => {
    const program = closedMonoProgramWithPacketType();
    const target = layoutTargetSurfaceFake();
    const targetFacts = normalizeTargetFactsForTest(target);
    const primitiveResult = seedPrimitiveTypeFacts(target);
    expect(primitiveResult.kind).toBe("ok");
    if (primitiveResult.kind !== "ok") return;

    const result = buildLayoutTypeResolver({
      program,
      targetFacts,
      primitiveTypes: primitiveResult.value.types,
    });

    expect(result.kind).toBe("ok");
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          diagnostic.code === "LAYOUT_MISSING_TYPE_RESOLUTION" ||
          diagnostic.code === "LAYOUT_INVALID_PUBLISHED_TYPE_KEY",
      ),
    ).toBe(false);
  });

  test("unresolved reachable checked type emits LAYOUT_MISSING_TYPE_RESOLUTION", () => {
    const program = closedMonoProgramWithPacketType();
    const targetFacts = normalizeTargetFactsForTest(layoutTargetSurfaceFake());
    const packetResolution = layoutTypeResolutionsForTest(program).find(
      (entry) => entry.key.kind === "source",
    )!;
    if (packetResolution.key.kind !== "source") {
      throw new Error("expected source layout type resolution");
    }
    const programWithoutPacketType = monoProgramWithoutTypeInstance(
      program,
      packetResolution.key.instanceId,
    );
    const result = buildLayoutTypeResolver({ program: programWithoutPacketType, targetFacts });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_MISSING_TYPE_RESOLUTION"),
    );
    expect(
      result.diagnostics.some(
        (diagnostic) => diagnostic.stableDetail === packetResolution.checkedTypeFingerprint,
      ),
    ).toBe(true);
  });

  test("conflicting layout resolutions emit LAYOUT_DUPLICATE_TYPE_RESOLUTION", () => {
    const program = closedMonoProgramWithPacketType();
    const targetFacts = normalizeTargetFactsForTest(layoutTargetSurfaceFake());
    const neverResolution = layoutTypeResolutionsForTest(program).find(
      (entry) => entry.key.kind === "core" && entry.key.coreTypeId === coreTypeId("Never"),
    )!;
    const duplicateResolution: LayoutTypeResolution = {
      ...neverResolution,
      key: { kind: "core", coreTypeId: coreTypeId("Function") },
    };
    const result = layoutTypeResolverWithResolutions(
      program,
      [...layoutTypeResolutionsForTest(program), duplicateResolution],
      targetFacts,
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_DUPLICATE_TYPE_RESOLUTION"),
    );
  });

  test("published source keys must reference reachable mono type instances", () => {
    const program = monoProgramWithSourceLayoutResolutions();
    const targetFacts = normalizeTargetFactsForTest(layoutTargetSurfaceFake());
    const packetResolution = layoutTypeResolutionsForTest(program).find(
      (entry) => entry.key.kind === "source",
    )!;
    const invalidResolution: LayoutTypeResolution = {
      ...packetResolution,
      key: { kind: "source", instanceId: monoInstanceId("type:Missing") },
    };
    const programWithoutPacketType =
      packetResolution.key.kind === "source"
        ? monoProgramWithoutTypeInstance(program, packetResolution.key.instanceId)
        : program;
    const result = layoutTypeResolverWithResolutions(
      programWithoutPacketType,
      [invalidResolution],
      targetFacts,
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_PUBLISHED_TYPE_KEY"),
    );
  });

  test("published core keys must reference target primitive facts", () => {
    const program = closedMonoProgramWithPacketType();
    const targetFacts = normalizeTargetFactsForTest(layoutTargetSurfaceFake());
    const primitiveFacts = seedPrimitiveTypeFacts(layoutTargetSurfaceFake());
    expect(primitiveFacts.kind).toBe("ok");
    if (primitiveFacts.kind !== "ok") return;

    const invalidResolution: LayoutTypeResolution = {
      checkedTypeFingerprint: "layout-test:missing-core-primitive",
      type: monoCoreType("u8"),
      key: { kind: "core", coreTypeId: coreTypeId("missing-primitive") },
      sourceOrigin: "layout-test:0:0",
    };
    const result = layoutTypeResolverWithResolutions(
      program,
      [invalidResolution],
      targetFacts,
      primitiveFacts.value.types,
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_PUBLISHED_TYPE_KEY"),
    );
  });

  test("published target keys must reference target primitive facts", () => {
    const program = closedMonoProgramWithPacketType();
    const targetFacts = normalizeTargetFactsForTest(layoutTargetSurfaceFake());
    const primitiveFacts = seedPrimitiveTypeFacts(layoutTargetSurfaceFake());
    expect(primitiveFacts.kind).toBe("ok");
    if (primitiveFacts.kind !== "ok") return;

    const invalidResolution: LayoutTypeResolution = {
      checkedTypeFingerprint: "layout-test:missing-target-primitive",
      type: monoCoreType("u8"),
      key: { kind: "target", targetTypeId: targetTypeId("MissingTarget") },
      sourceOrigin: "layout-test:0:0",
    };
    const result = layoutTypeResolverWithResolutions(
      program,
      [invalidResolution],
      targetFacts,
      primitiveFacts.value.types,
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_PUBLISHED_TYPE_KEY"),
    );
  });

  test("resolver maps core primitive fingerprints from derived resolutions", () => {
    const program = monoProgramWithSourceLayoutResolutions();
    const targetFacts = normalizeTargetFactsForTest(layoutTargetSurfaceFake());
    const coreResolution = layoutTypeResolutionsForTest(program).find(
      (entry) => entry.key.kind === "core" && entry.key.coreTypeId === coreTypeId("u32"),
    )!;
    const result = buildLayoutTypeResolver({ program, targetFacts });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.resolver.get(coreResolution.type)).toEqual({
      kind: "core",
      coreTypeId: coreTypeId("u32"),
    });
    expect(result.value.resolver.getByFingerprint(coreResolution.checkedTypeFingerprint)).toEqual({
      kind: "core",
      coreTypeId: coreTypeId("u32"),
    });
  });
});
