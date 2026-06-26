import { describe, expect, test } from "bun:test";
import {
  buildLayoutReadRequirements,
  computeValidatedBufferFieldFacts,
  validateLayoutFieldDependencies,
  validateLayoutFieldIntervals,
} from "../../../src/layout/validated-buffer-fields";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import { fieldId } from "../../../src/semantic/ids";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoInstanceId } from "../../../src/mono/ids";
import { itemId, typeId } from "../../../src/semantic/ids";
import {
  computeValidatedBufferFieldFactsInputForLayoutSource,
  constantLayoutTerm,
  layoutTargetSurfaceFake,
  normalizeTargetFactsForTest,
  validatedBufferFieldFactsInputWithBuffer,
} from "../../support/layout/layout-fixtures";
import { monoCoreType } from "../../support/mono/monomorphization-fixtures";
import type { ComputeValidatedBufferFieldFactsInput } from "../../../src/layout/validated-buffer-fields";
import type { MonoLayoutExpression, MonoValidatedBuffer } from "../../../src/mono/mono-hir";

function validatedBufferFieldFactsInputForTest(
  layoutSource: readonly string[],
): ComputeValidatedBufferFieldFactsInput {
  return computeValidatedBufferFieldFactsInputForLayoutSource(layoutSource);
}

function fieldValueExpression(
  fieldIdValue: ReturnType<typeof fieldId>,
  fieldKind: "parameter" | "layout" | "derived",
): MonoLayoutExpression {
  return {
    kind: "fieldValue",
    fieldId: fieldIdValue,
    fieldKind,
    type: monoCoreType("u32"),
    sourceOrigin: "layout-fixture:0:0",
  };
}

describe("validateLayoutFieldDependencies", () => {
  test("layout field depending on a later layout field is rejected", () => {
    const diagnostics = validateLayoutFieldDependencies({
      expression: fieldValueExpression(fieldId(99), "layout"),
      fieldId: fieldId(1),
      instanceId: "validated-buffer:Packet" as MonoInstanceId,
      parameterFieldIds: new Set(),
      availableLayoutFieldIds: new Set(),
      availableDerivedFieldIds: new Set(),
      sourceOrigin: "layout-fixture:0:0",
    });

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_FIELD_FORWARD_DEPENDENCY"),
    );
    expect(diagnostics[0]?.ownerKey).toBe("validated-buffer:validated-buffer:Packet:field:1");
  });

  test("parameter field references are allowed", () => {
    const diagnostics = validateLayoutFieldDependencies({
      expression: fieldValueExpression(fieldId(1), "parameter"),
      fieldId: fieldId(2),
      instanceId: "validated-buffer:Packet" as MonoInstanceId,
      parameterFieldIds: new Set([String(fieldId(1))]),
      availableLayoutFieldIds: new Set(),
      availableDerivedFieldIds: new Set(),
      sourceOrigin: "layout-fixture:0:0",
    });

    expect(diagnostics).toHaveLength(0);
  });
});

describe("validateLayoutFieldIntervals", () => {
  const targetFacts = normalizeTargetFactsForTest(layoutTargetSurfaceFake());

  test("constant overlapping intervals are rejected", () => {
    const result = validateLayoutFieldIntervals({
      intervals: [
        {
          fieldId: fieldId(1),
          name: "a",
          offset: constantLayoutTerm(0n, "byteOffset"),
          end: constantLayoutTerm(4n, "byteOffset"),
          instanceId: "validated-buffer:Packet" as MonoInstanceId,
          sourceOrigin: "layout-fixture:0:0",
        },
        {
          fieldId: fieldId(2),
          name: "b",
          offset: constantLayoutTerm(2n, "byteOffset"),
          end: constantLayoutTerm(6n, "byteOffset"),
          instanceId: "validated-buffer:Packet" as MonoInstanceId,
          sourceOrigin: "layout-fixture:0:0",
        },
      ],
      targetFacts,
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_FIELD_OVERLAP"),
    );
  });

  test("touching constant intervals are accepted", () => {
    const result = validateLayoutFieldIntervals({
      intervals: [
        {
          fieldId: fieldId(1),
          name: "kind",
          offset: constantLayoutTerm(0n, "byteOffset"),
          end: constantLayoutTerm(1n, "byteOffset"),
          instanceId: "validated-buffer:Packet" as MonoInstanceId,
          sourceOrigin: "layout-fixture:0:0",
        },
        {
          fieldId: fieldId(2),
          name: "length",
          offset: constantLayoutTerm(1n, "byteOffset"),
          end: constantLayoutTerm(3n, "byteOffset"),
          instanceId: "validated-buffer:Packet" as MonoInstanceId,
          sourceOrigin: "layout-fixture:0:0",
        },
      ],
      targetFacts,
    });

    expect(result.diagnostics).toHaveLength(0);
  });

  test("affine dynamic intervals emit interval order constraints", () => {
    const offsetA = {
      kind: "fieldValue" as const,
      fieldId: fieldId(10),
      source: "layout" as const,
      type: { kind: "core" as const, coreTypeId: "u16" as never },
      unit: "byteOffset" as const,
      encoding: {
        kind: "integer" as const,
        endian: "little" as const,
        signedness: "unsigned" as const,
        bitWidth: 16,
      },
      range: { minimum: 0n, maximum: 65_535n, provenance: "wireEncoding" as const },
    };
    const result = validateLayoutFieldIntervals({
      intervals: [
        {
          fieldId: fieldId(1),
          name: "a",
          offset: offsetA,
          end: constantLayoutTerm(8n, "byteOffset"),
          instanceId: "validated-buffer:Packet" as MonoInstanceId,
          sourceOrigin: "layout-fixture:0:0",
        },
        {
          fieldId: fieldId(2),
          name: "b",
          offset: offsetA,
          end: constantLayoutTerm(16n, "byteOffset"),
          instanceId: "validated-buffer:Packet" as MonoInstanceId,
          sourceOrigin: "layout-fixture:0:0",
        },
      ],
      targetFacts,
    });

    const laterRequirements = result.intervalRequirementsByFieldId.get(fieldId(2)) ?? [];
    expect(
      laterRequirements.some(
        (requirement) =>
          requirement.kind === "rangeConstraint" &&
          requirement.relation === "<=" &&
          requirement.left.kind === "constant" &&
          requirement.left.value === 8n,
      ),
    ).toBe(true);
    expect(result.diagnostics).toHaveLength(0);
  });
});

describe("buildLayoutReadRequirements", () => {
  test("dynamic fields emit payloadEnd and layoutFits", () => {
    const end = constantLayoutTerm(5n, "byteOffset");
    const requirements = buildLayoutReadRequirements({
      fieldId: fieldId(3),
      end,
      isFixed: false,
      translationRequirements: [],
      dependencyFieldIds: [fieldId(2)],
    });

    expect(requirements.map((requirement) => requirement.kind)).toEqual([
      "fieldAvailable",
      "layoutFits",
      "payloadEnd",
    ]);
    expect(requirements.find((requirement) => requirement.kind === "layoutFits")).toEqual({
      kind: "layoutFits",
      end,
    });
    expect(requirements.find((requirement) => requirement.kind === "payloadEnd")).toEqual({
      kind: "payloadEnd",
      end,
    });
  });

  test("fixed fields omit payloadEnd", () => {
    const requirements = buildLayoutReadRequirements({
      fieldId: fieldId(1),
      end: constantLayoutTerm(1n, "byteOffset"),
      isFixed: true,
      translationRequirements: [],
      dependencyFieldIds: [],
    });

    expect(requirements.map((requirement) => requirement.kind)).toEqual(["layoutFits"]);
  });
});

describe("computeValidatedBufferFieldFacts", () => {
  test("layout fields without len use constant element count one", () => {
    const result = computeValidatedBufferFieldFacts(
      validatedBufferFieldFactsInputForTest(["kind: u8 @ 0"]),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const kind = result.value.layoutFields[0]!;
    expect(kind.elementCount).toEqual(constantLayoutTerm(1n, "elementCount"));
    expect(kind.byteLength).toEqual(constantLayoutTerm(1n, "byteLength"));
    expect(kind.end).toEqual(constantLayoutTerm(1n, "byteOffset"));
    expect(result.value.fixedEndBytes).toBe(1n);
  });

  test("fixed fields are processed in declaration order", () => {
    const result = computeValidatedBufferFieldFacts(
      validatedBufferFieldFactsInputForTest([
        "kind: u8 @ 0",
        "length: be u16 @ 1",
        "payload: u8 @ 3 len length",
      ]),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.layoutFields.map((field) => field.name)).toEqual([
      "kind",
      "length",
      "payload",
    ]);
    expect(result.value.fixedEndBytes).toBe(3n);
  });

  test("dynamic payload references earlier length field", () => {
    const result = computeValidatedBufferFieldFacts(
      validatedBufferFieldFactsInputForTest([
        "kind: u8 @ 0",
        "length: be u16 @ 1",
        "payload: u8 @ 3 len length",
      ]),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const payload = result.value.layoutFields.find((field) => field.name === "payload")!;
    expect(payload.readRequires.some((requirement) => requirement.kind === "fieldAvailable")).toBe(
      true,
    );
    expect(payload.readRequires.map((requirement) => requirement.kind)).toContain("payloadEnd");
    expect(payload.readRequires.map((requirement) => requirement.kind)).toContain("layoutFits");
  });

  test("forward dependency on later layout field is rejected", () => {
    const trailerFieldId = fieldId(20);
    const payloadFieldId = fieldId(21);
    const instanceId = monoInstanceId("type:Packet");
    const trailerLengthExpression = fieldValueExpression(trailerFieldId, "layout");
    const target = layoutTargetSurfaceFake();
    const buffer: MonoValidatedBuffer = {
      instanceId,
      typeId: typeId(1),
      itemId: itemId(1),
      parameterFields: [],
      layoutDerivedFieldOrder: [payloadFieldId, trailerFieldId],
      layoutFields: [
        {
          field: {
            fieldId: payloadFieldId,
            ownerTypeInstanceId: instanceId,
            name: "payload",
            type: monoCoreType("u8"),
            resourceKind: "Copy",
            sourceOrigin: "layout-fixture:0:0",
          },
          offset: {
            kind: "integerLiteral",
            value: 2n,
            width: { kind: "type", type: monoCoreType("u32") },
            sourceOrigin: "layout-fixture:0:0",
          },
          length: trailerLengthExpression,
          sourceOrigin: "layout-fixture:0:0",
        },
        {
          field: {
            fieldId: trailerFieldId,
            ownerTypeInstanceId: instanceId,
            name: "trailer_len",
            type: monoCoreType("u8"),
            resourceKind: "Copy",
            sourceOrigin: "layout-fixture:0:0",
          },
          offset: {
            kind: "integerLiteral",
            value: 0n,
            width: { kind: "type", type: monoCoreType("u32") },
            sourceOrigin: "layout-fixture:0:0",
          },
          sourceOrigin: "layout-fixture:0:0",
        },
      ],
      derivedFields: [],
      requirements: [],
      sourceOrigin: "layout-fixture:0:0",
    };

    const result = computeValidatedBufferFieldFacts(
      validatedBufferFieldFactsInputWithBuffer(buffer),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_FIELD_FORWARD_DEPENDENCY"),
    );
  });

  test("forward dependency on later derived field is rejected", () => {
    const derivedFieldId = fieldId(32);
    const payloadFieldId = fieldId(31);
    const instanceId = monoInstanceId("type:Packet");
    const target = layoutTargetSurfaceFake();
    const buffer: MonoValidatedBuffer = {
      instanceId,
      typeId: typeId(1),
      itemId: itemId(1),
      parameterFields: [],
      layoutDerivedFieldOrder: [payloadFieldId, derivedFieldId],
      layoutFields: [
        {
          field: {
            fieldId: payloadFieldId,
            ownerTypeInstanceId: instanceId,
            name: "payload",
            type: monoCoreType("u8"),
            resourceKind: "Copy",
            sourceOrigin: "layout-fixture:0:0",
          },
          offset: {
            kind: "integerLiteral",
            value: 0n,
            width: { kind: "type", type: monoCoreType("u32") },
            sourceOrigin: "layout-fixture:0:0",
          },
          length: fieldValueExpression(derivedFieldId, "derived"),
          sourceOrigin: "layout-fixture:0:0",
        },
      ],
      derivedFields: [
        {
          field: {
            fieldId: derivedFieldId,
            ownerTypeInstanceId: instanceId,
            name: "trailer_len",
            type: monoCoreType("u8"),
            resourceKind: "Copy",
            sourceOrigin: "layout-fixture:0:0",
          },
          source: {
            kind: "integerLiteral",
            value: 1n,
            width: { kind: "type", type: monoCoreType("u32") },
            sourceOrigin: "layout-fixture:0:0",
          },
          cases: [
            {
              condition: { kind: "otherwise" },
              result: {
                kind: "integerLiteral",
                value: 1n,
                width: { kind: "type", type: monoCoreType("u32") },
                sourceOrigin: "layout-fixture:0:0",
              },
              sourceOrigin: "layout-fixture:0:0",
            },
          ],
          sourceOrigin: "layout-fixture:0:0",
        },
      ],
      requirements: [],
      sourceOrigin: "layout-fixture:0:0",
    };

    const result = computeValidatedBufferFieldFacts(
      validatedBufferFieldFactsInputWithBuffer(buffer),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_FIELD_FORWARD_DEPENDENCY"),
    );
  });

  test("layout field can depend on an earlier derived field", () => {
    const fieldFacts = computeValidatedBufferFieldFacts(
      computeValidatedBufferFieldFactsInputForLayoutSource(["payload: u8 @ 0 len count"], {
        deriveSource: ["count: u32 from 0:", "    otherwise => 4"],
      }),
    );

    expect(fieldFacts.kind).toBe("ok");
    if (fieldFacts.kind !== "ok") return;
    expect(fieldFacts.value.layoutFields.find((field) => field.name === "payload")).toBeDefined();
  });

  test("source length minus constant emits range constraint on dynamic body field", () => {
    const result = computeValidatedBufferFieldFacts(
      validatedBufferFieldFactsInputForTest([
        "header: u8 @ 0 len 14",
        "body: u8 @ 14 len source.len - 14",
      ]),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const body = result.value.layoutFields.find((field) => field.name === "body")!;
    expect(
      body.readRequires.some(
        (requirement) =>
          requirement.kind === "rangeConstraint" &&
          requirement.relation === "<=" &&
          requirement.left.kind === "constant" &&
          requirement.left.value === 14n,
      ),
    ).toBe(true);
  });
});
