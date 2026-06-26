import { describe, expect, test } from "bun:test";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import { validateLayoutTargetSurface } from "../../../src/layout/target-layout";
import { coreTypeId, targetId, targetTypeId } from "../../../src/semantic/ids";
import {
  corePrimitiveSpecsFake,
  enumLayoutPolicyFake,
  layoutDataModelFake,
  layoutPrimitiveCatalogFake,
  layoutTargetSurfaceFake,
  validatedBufferHandleLayoutFake,
} from "../../support/layout/layout-fakes";

describe("validateLayoutTargetSurface", () => {
  test("target validation rejects non-power-of-two primitive alignment", () => {
    const target = layoutTargetSurfaceFake({
      coreTypes: layoutPrimitiveCatalogFake([
        {
          id: coreTypeId("u16"),
          sizeBytes: 2n,
          alignmentBytes: 3n,
          representation: "unsignedInteger",
          bitWidth: 16,
          abiScalarKind: "integer",
        },
      ]),
    });

    const result = validateLayoutTargetSurface(target);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_TARGET_PRIMITIVE"),
    );
  });

  test("target validation rejects non-byte addressable unit", () => {
    const target = layoutTargetSurfaceFake();
    const invalidTarget = {
      ...target,
      dataModel: {
        ...target.dataModel,
        addressableUnit: "word" as typeof target.dataModel.addressableUnit,
      },
    };

    const result = validateLayoutTargetSurface(invalidTarget);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_TARGET_DATA_MODEL"),
    );
  });

  test("target validation rejects address primitive that mismatches pointer facts", () => {
    const target = layoutTargetSurfaceFake({
      targetTypes: layoutPrimitiveCatalogFake([
        {
          id: targetTypeId("Ptr"),
          sizeBytes: 4n,
          alignmentBytes: 8n,
          representation: "address",
          bitWidth: 64,
          abiScalarKind: "pointer",
        },
      ]),
    });

    const result = validateLayoutTargetSurface(target);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_TARGET_PRIMITIVE"),
    );
  });

  test("target validation rejects invalid enum candidate tag type", () => {
    const target = layoutTargetSurfaceFake({
      enumPolicy: enumLayoutPolicyFake({
        candidateTagTypes: [{ kind: "core", coreTypeId: coreTypeId("bool") }],
      }),
    });

    const result = validateLayoutTargetSurface(target);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_ENUM_POLICY"),
    );
  });

  test("target validation rejects invalid validated-buffer handle field names", () => {
    const target = layoutTargetSurfaceFake({
      validatedBufferHandle: validatedBufferHandleLayoutFake({
        pointerFieldName: "source_ptr" as "__source_ptr",
      }),
    });

    const result = validateLayoutTargetSurface(target);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_VALIDATED_BUFFER_HANDLE"),
    );
  });

  test("target validation rejects missing size type primitive", () => {
    const target = layoutTargetSurfaceFake({
      dataModel: layoutDataModelFake({
        sizeType: { kind: "core", coreTypeId: coreTypeId("missing") },
      }),
      coreTypes: layoutPrimitiveCatalogFake(corePrimitiveSpecsFake()),
    });

    const result = validateLayoutTargetSurface(target);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_MISSING_PRIMITIVE_TYPE"),
    );
  });

  test("target validation accepts valid fake surface and resolves size type key", () => {
    const target = layoutTargetSurfaceFake({ targetId: targetId("test-target") });
    const result = validateLayoutTargetSurface(target);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.sizeType).toEqual({ kind: "core", coreTypeId: coreTypeId("usize") });
  });

  test("target validation rejects invalid endian values", () => {
    const target = layoutTargetSurfaceFake({
      dataModel: {
        ...layoutDataModelFake(),
        endian: "middle",
      } as unknown as ReturnType<typeof layoutDataModelFake>,
    });

    const result = validateLayoutTargetSurface(target);

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_TARGET_DATA_MODEL"),
    );
  });

  test("target validation diagnostics use target owner and target-definition root cause", () => {
    const target = layoutTargetSurfaceFake({
      targetId: targetId("my-target"),
      coreTypes: layoutPrimitiveCatalogFake([
        {
          id: coreTypeId("u16"),
          sizeBytes: 2n,
          alignmentBytes: 3n,
          representation: "unsignedInteger",
          bitWidth: 16,
          abiScalarKind: "integer",
        },
      ]),
    });

    const result = validateLayoutTargetSurface(target);
    expect(result.kind).toBe("error");
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.ownerKey).toBe("target:my-target");
      expect(diagnostic.rootCauseKey).toBe("target-definition");
    }
  });

  test("invalid pointer width returns diagnostics instead of throwing", () => {
    const target = layoutTargetSurfaceFake();
    const invalidTarget = {
      ...target,
      dataModel: {
        ...target.dataModel,
        pointerWidthBits: 33 as typeof target.dataModel.pointerWidthBits,
      },
    };

    expect(() => validateLayoutTargetSurface(invalidTarget)).not.toThrow();
    const result = validateLayoutTargetSurface(invalidTarget);
    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_TARGET_DATA_MODEL"),
    );
  });

  test("non-numeric pointer width returns diagnostics instead of throwing", () => {
    const target = layoutTargetSurfaceFake();
    const invalidTarget = {
      ...target,
      dataModel: {
        ...target.dataModel,
        pointerWidthBits: "bad" as unknown as typeof target.dataModel.pointerWidthBits,
      },
    };

    expect(() => validateLayoutTargetSurface(invalidTarget)).not.toThrow();
    const result = validateLayoutTargetSurface(invalidTarget);
    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_TARGET_DATA_MODEL"),
    );
  });
});
