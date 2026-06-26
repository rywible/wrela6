import { describe, expect, test } from "bun:test";
import { computeValidatedBufferValueStorage } from "../../../src/layout/validated-buffer-value-storage";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import { instantiateMonoType } from "../../../src/mono/type-instantiator";
import { imageId } from "../../../src/semantic/ids";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";
import {
  layoutTargetSurfaceFake,
  validatedBufferHandleLayoutFake,
} from "../../support/layout/layout-fakes";
import { normalizeTargetFactsForTest } from "../../support/layout/layout-fixtures";
import {
  emptyMonoAncestryForTest,
  monoTypeKeyForTest,
} from "../../support/mono/monomorphization-fixtures";
import type { ComputeValidatedBufferValueStorageInput } from "../../../src/layout/validated-buffer-value-storage";
import type { LayoutTargetSurface } from "../../../src/layout/target-layout";
import { coreTypeId, targetTypeId } from "../../../src/semantic/ids";
import { layoutPrimitiveCatalogFake } from "../../support/layout/layout-fakes";

function validatedBufferValueStorageInputForTest(
  target: LayoutTargetSurface = layoutTargetSurfaceFake(),
): ComputeValidatedBufferValueStorageInput {
  const program = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    params:",
        "        expected_len: u16",
        "    layout:",
        "        payload: u8 @ 3 len expected_len",
      ].join("\n"),
    ],
  ]).program;
  const bufferType = program.types
    .entries()
    .find((record) => record.sourceKind === "validatedBuffer");
  if (bufferType === undefined) {
    throw new Error("expected validated buffer type");
  }

  const result = instantiateMonoType({
    program,
    key: monoTypeKeyForTest({ typeId: bufferType.typeId, typeArguments: [] }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });
  if (result.kind !== "ok" || result.validatedBuffer === undefined) {
    throw new Error("expected instantiated validated buffer");
  }

  return {
    buffer: result.validatedBuffer,
    typeInstance: result.instance,
    target,
    targetFacts: normalizeTargetFactsForTest(target),
  };
}

describe("computeValidatedBufferValueStorage", () => {
  test("validated-buffer value storage repeats hidden aggregate storage fields", () => {
    const result = computeValidatedBufferValueStorage(validatedBufferValueStorageInputForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const hiddenFields = result.value.ownerTypeFact.aggregateStorage?.hiddenFields ?? [];
    expect(hiddenFields).toHaveLength(2);
    expect(result.value.valueStorage.sourcePointer).toBe(hiddenFields[0]!);
    expect(result.value.valueStorage.sourceLength).toBe(hiddenFields[1]!);
    expect(result.value.valueStorage.parameterFieldsStartOffsetBytes).toBeGreaterThanOrEqual(0n);
  });

  test("validated-buffer wrapper storage begins with target hidden pointer and length fields", () => {
    const target = layoutTargetSurfaceFake();
    const result = computeValidatedBufferValueStorage(
      validatedBufferValueStorageInputForTest(target),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const hiddenFields = result.value.ownerTypeFact.aggregateStorage?.hiddenFields ?? [];
    expect(hiddenFields.map((field) => field.name)).toEqual([
      target.validatedBufferHandle.pointerFieldName,
      target.validatedBufferHandle.lengthFieldName,
    ]);
    expect(hiddenFields[0]?.offsetBytes).toBe(0n);
    expect(hiddenFields[1]?.offsetBytes).toBe(8n);
    expect(hiddenFields[0]?.type).toEqual({
      kind: "target",
      targetTypeId: targetTypeId("Ptr"),
    });
    expect(hiddenFields[1]?.type).toEqual({ kind: "core", coreTypeId: coreTypeId("usize") });
  });

  test("validated-buffer wrapper records trailing padding after final alignment", () => {
    const program = lowerTypedHirForTest([
      [
        "main.wr",
        ["validated buffer Packet:", "    layout:", "        payload: u8 @ 0"].join("\n"),
      ],
    ]).program;
    const bufferType = program.types
      .entries()
      .find((record) => record.sourceKind === "validatedBuffer");
    if (bufferType === undefined) {
      throw new Error("expected validated buffer type");
    }

    const monoResult = instantiateMonoType({
      program,
      key: monoTypeKeyForTest({ typeId: bufferType.typeId, typeArguments: [] }),
      source: { kind: "image", imageId: imageId(1) },
      ancestry: emptyMonoAncestryForTest(),
    });
    if (monoResult.kind !== "ok" || monoResult.validatedBuffer === undefined) {
      throw new Error("expected instantiated validated buffer");
    }

    const target = layoutTargetSurfaceFake({
      validatedBufferHandle: validatedBufferHandleLayoutFake({
        lengthType: { kind: "core", coreTypeId: coreTypeId("u32") },
      }),
    });
    const result = computeValidatedBufferValueStorage({
      buffer: monoResult.validatedBuffer,
      typeInstance: monoResult.instance,
      target,
      targetFacts: normalizeTargetFactsForTest(target),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.ownerTypeFact.sizeBytes).toBe(16n);
    expect(result.value.ownerTypeFact.aggregateStorage?.trailingPaddingBytes).toBe(4n);
    expect(result.value.ownerTypeFact.aggregateStorage?.paddingRanges).toContainEqual({
      offsetBytes: 12n,
      sizeBytes: 4n,
      kind: "trailing",
    });
  });

  test("parameter fields follow hidden fields in declaration order", () => {
    const result = computeValidatedBufferValueStorage(validatedBufferValueStorageInputForTest());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.parameterFieldFacts.map((field) => field.fieldName)).toEqual([
      "expected_len",
    ]);
    expect(result.value.parameterFieldFacts[0]?.offsetBytes).toBe(
      result.value.valueStorage.parameterFieldsStartOffsetBytes,
    );
    expect(result.value.parameterFieldFacts[0]?.offsetBytes).toBeGreaterThanOrEqual(16n);
  });

  test("layout and derived fields never receive wrapper source field offsets", () => {
    const input = validatedBufferValueStorageInputForTest();
    const result = computeValidatedBufferValueStorage(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const layoutFieldNames = input.buffer.layoutFields.map((field) => field.field.name);
    const derivedFieldNames = input.buffer.derivedFields.map((field) => field.field.name);
    const storedFieldNames = result.value.parameterFieldFacts.map((field) => field.fieldName);

    expect(layoutFieldNames).toContain("payload");
    expect(storedFieldNames).not.toContain("payload");
    for (const name of derivedFieldNames) {
      expect(storedFieldNames).not.toContain(name);
    }
  });

  test("missing pointer or length primitive specs emit deterministic diagnostics", () => {
    const target = layoutTargetSurfaceFake({
      validatedBufferHandle: validatedBufferHandleLayoutFake({
        pointerType: { kind: "target", targetTypeId: targetTypeId("MissingPtr") },
      }),
      targetTypes: layoutPrimitiveCatalogFake([]),
    });
    const result = computeValidatedBufferValueStorage(
      validatedBufferValueStorageInputForTest(target),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_MISSING_PRIMITIVE_TYPE"),
    );
    expect(result.diagnostics[0]?.ownerKey).toContain(":value-storage");
    expect(result.diagnostics[0]?.rootCauseKey).toMatch(/^validated-buffer:/);
  });

  test("missing validated-buffer type instance is rejected", () => {
    const input = validatedBufferValueStorageInputForTest();
    const result = computeValidatedBufferValueStorage({
      ...input,
      typeInstance: {
        ...input.typeInstance,
        sourceKind: "class",
      },
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_VALIDATED_BUFFER_STORAGE_MISMATCH"),
    );
  });
});
