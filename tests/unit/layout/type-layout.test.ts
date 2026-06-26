import { describe, expect, test } from "bun:test";
import { seedPrimitiveTypeFacts } from "../../../src/layout/type-layout";
import { coreTypeId, targetTypeId } from "../../../src/semantic/ids";
import { layoutTargetSurfaceFake } from "../../support/layout/layout-fakes";

describe("seedPrimitiveTypeFacts", () => {
  test("primitive fact seeding computes stride from size and alignment", () => {
    const target = layoutTargetSurfaceFake();
    const result = seedPrimitiveTypeFacts(target);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const u16 = result.value.types.get({ kind: "core", coreTypeId: coreTypeId("u16") });
    expect(u16?.sizeBytes).toBe(2n);
    expect(u16?.alignmentBytes).toBe(2n);
    expect(u16?.strideBytes).toBe(2n);
  });

  test("Never primitive uses never representation with zero stride", () => {
    const target = layoutTargetSurfaceFake();
    const result = seedPrimitiveTypeFacts(target);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const never = result.value.types.get({ kind: "core", coreTypeId: coreTypeId("Never") });
    expect(never?.representation).toEqual({ kind: "never" });
    expect(never?.alignmentBytes).toBe(1n);
    expect(never?.strideBytes).toBe(0n);
  });

  test("primitive facts are deterministic for core and target catalogs", () => {
    const target = layoutTargetSurfaceFake();
    const first = seedPrimitiveTypeFacts(target);
    const second = seedPrimitiveTypeFacts(target);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind !== "ok" || second.kind !== "ok") return;

    const project = (result: typeof first) => {
      if (result.kind !== "ok") return [];
      return result.value.types.entries().map((entry) => ({
        key: entry.key,
        sizeBytes: entry.sizeBytes,
        alignmentBytes: entry.alignmentBytes,
        strideBytes: entry.strideBytes,
        representation: entry.representation,
      }));
    };

    expect(project(first)).toEqual(project(second));
    expect(first.value.types.entries()).toHaveLength(11);
    expect(first.value.types.get({ kind: "core", coreTypeId: coreTypeId("u16") })).toBeDefined();
    expect(
      first.value.types.get({ kind: "target", targetTypeId: targetTypeId("Ptr") }),
    ).toBeDefined();
  });

  test("target address primitive facts match pointer layout dimensions", () => {
    const target = layoutTargetSurfaceFake();
    const result = seedPrimitiveTypeFacts(target);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const pointer = result.value.types.get({ kind: "target", targetTypeId: targetTypeId("Ptr") });
    expect(pointer?.sizeBytes).toBe(8n);
    expect(pointer?.alignmentBytes).toBe(8n);
    expect(pointer?.strideBytes).toBe(8n);
    expect(pointer?.representation).toEqual({ kind: "primitive", primitive: "address" });
  });
});
