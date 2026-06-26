import { expect, test } from "bun:test";
import { imageId, itemId, targetTypeId, typeId } from "../../../src/semantic/ids";
import type { HirConstructorKindRuleRecord, HirFieldRecord } from "../../../src/hir/hir";
import { hirTable } from "../../../src/hir/hir-table";
import { instantiateMonoType } from "../../../src/mono/type-instantiator";
import { monoDiagnosticCode } from "../../../src/mono/diagnostics";
import { derivedKind } from "../../../src/semantic/surface/resource-kind";
import {
  genericParameterCheckedType,
  targetCheckedType,
  type TypeConstructorId,
} from "../../../src/semantic/surface/type-model";
import {
  emptyMonoAncestryForTest,
  eligibilityRuleTableFake,
  genericBoxProgramForMonoTest,
  genericValidatedBufferProgramForMonoTest,
  functionSignatureSourceTypeClosureProgramForMonoTest,
  monoCoreType,
  monoTypeKeyForTest,
  programWithDanglingTypeFieldForMonoTest,
} from "../../support/mono/monomorphization-fixtures";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";
import { hirOriginId } from "../../../src/hir/ids";

function constructorKey(constructor: TypeConstructorId): string {
  switch (constructor.kind) {
    case "source":
      return `source:${constructor.typeId}`;
    case "core":
      return `core:${constructor.coreTypeId}`;
    case "target":
      return `target:${constructor.targetTypeId}`;
  }
}

test("generic source type instantiates field types with concrete arguments", () => {
  const result = instantiateMonoType({
    program: genericBoxProgramForMonoTest(),
    key: monoTypeKeyForTest({
      typeId: typeId(1),
      typeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.instance.fields.map((field) => field.type.kind)).toEqual(["core"]);
    expect(result.instance.resourceKind).toBe("Copy");
  }
});

test("target-declared field kinds read direct target type kind data", () => {
  const base = genericBoxProgramForMonoTest();
  const mmioRegister = targetTypeId("mmio-register");
  const targetField = base.fields.entries().find((field) => field.ownerTypeId === typeId(1));
  if (targetField === undefined) throw new Error("expected generic Box field");
  const program = {
    ...base,
    fields: hirTable({
      entries: base.fields.entries().map((field) =>
        field.fieldId === targetField.fieldId
          ? {
              ...field,
              type: targetCheckedType(mmioRegister),
              resourceKind: derivedKind("targetDeclared", []),
            }
          : field,
      ),
      keyOf: (field: HirFieldRecord) => String(field.fieldId).padStart(12, "0"),
      lookupKeyOf: (id: HirFieldRecord["fieldId"]) => String(id).padStart(12, "0"),
    }),
    monoClosure: {
      ...base.monoClosure,
      targetTypeKinds: hirTable({
        entries: [
          { targetTypeId: mmioRegister, kind: "Linear" as const, sourceOrigin: hirOriginId(0) },
        ],
        keyOf: (entry) => `${entry.targetTypeId}`,
        lookupKeyOf: (id) => `${id}`,
      }),
    },
  };

  const result = instantiateMonoType({
    program,
    key: monoTypeKeyForTest({
      typeId: typeId(1),
      typeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.instance.fields[0]?.resourceKind).toBe("Linear");
  }
});

test("source field substitution preserves unresolved parameter diagnostics", () => {
  const base = genericBoxProgramForMonoTest();
  const boxField = base.fields.entries().find((field) => field.ownerTypeId === typeId(1));
  if (boxField === undefined) throw new Error("expected generic Box field");
  const unresolvedType = genericParameterCheckedType({
    owner: { kind: "item", itemId: itemId(909) },
    index: 0,
  });
  const program = {
    ...base,
    fields: hirTable({
      entries: base.fields
        .entries()
        .map((field) =>
          field.fieldId === boxField.fieldId ? { ...field, type: unresolvedType } : field,
        ),
      keyOf: (field: HirFieldRecord) => String(field.fieldId).padStart(12, "0"),
      lookupKeyOf: (id: HirFieldRecord["fieldId"]) => String(id).padStart(12, "0"),
    }),
  };

  const result = instantiateMonoType({
    program,
    key: monoTypeKeyForTest({
      typeId: typeId(1),
      typeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_UNRESOLVED_TYPE_PARAMETER"),
    );
  }
});

test("type instantiation preserves constructor normalization diagnostics for fieldless types", () => {
  const base = functionSignatureSourceTypeClosureProgramForMonoTest();
  const program = {
    ...base,
    monoClosure: {
      ...base.monoClosure,
      constructorKindRules: hirTable<TypeConstructorId, HirConstructorKindRuleRecord>({
        entries: base.monoClosure.constructorKindRules
          .entries()
          .filter(
            (entry) =>
              !(entry.constructor.kind === "source" && entry.constructor.typeId === typeId(41)),
          ),
        keyOf: (entry) => constructorKey(entry.constructor),
        lookupKeyOf: (id) => constructorKey(id),
      }),
    },
  };

  const result = instantiateMonoType({
    program,
    key: monoTypeKeyForTest({ typeId: typeId(41), typeArguments: [] }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_MISSING_CONSTRUCTOR_KIND_RULE"),
    );
  }
});

test("generic source type enforces instance eligibility rules", () => {
  const program = genericBoxProgramForMonoTest();
  const sourceType = program.types.get(typeId(1));
  expect(sourceType?.declaredTypeParameters).toHaveLength(1);
  if (sourceType === undefined) return;
  const restrictedProgram = {
    ...program,
    monoClosure: {
      ...program.monoClosure,
      instanceEligibilityRules: eligibilityRuleTableFake([
        {
          owner: { kind: "type", typeId: typeId(1) },
          parameter: sourceType.declaredTypeParameters[0]!,
          allowedConcreteKinds: ["Linear"],
          sourceOrigin: hirOriginId(0),
        },
      ]),
    },
  };

  const result = instantiateMonoType({
    program: restrictedProgram,
    key: monoTypeKeyForTest({
      typeId: typeId(1),
      typeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error") {
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      monoDiagnosticCode("MONO_INSTANCE_KIND_ELIGIBILITY_FAILED"),
    );
  }
});

test("missing source field data is a closure error", () => {
  const result = instantiateMonoType({
    program: programWithDanglingTypeFieldForMonoTest(),
    key: monoTypeKeyForTest({ typeId: typeId(2), typeArguments: [] }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("error");
  if (result.kind === "error")
    expect(result.diagnostics[0]?.code).toBe(monoDiagnosticCode("MONO_MISSING_HIR_FIELD"));
});

test("validated buffer metadata attaches to canonical type instance", () => {
  const result = instantiateMonoType({
    program: genericValidatedBufferProgramForMonoTest(),
    key: monoTypeKeyForTest({
      typeId: typeId(10),
      typeArguments: [monoCoreType("u8")],
    }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const buffer = result.validatedBuffer;
    expect(buffer?.instanceId).toBe(result.instance.instanceId);
    expect(buffer?.parameterFields.map((field) => field.type.kind)).toEqual(["core"]);
  }
});

test("fieldless proof-relevant source types retain their source resource kind", () => {
  const result = instantiateMonoType({
    program: functionSignatureSourceTypeClosureProgramForMonoTest(),
    key: monoTypeKeyForTest({ typeId: typeId(41), typeArguments: [] }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.instance.fields).toEqual([]);
    expect(result.instance.resourceKind).toBe("UniqueEdgeRoot");
  }
});

test("enum source type instantiates enumCases in source order", () => {
  const program = lowerTypedHirForTest([
    ["main.wr", "enum PacketKind:\n    Arp\n    Ipv4\n"],
  ]).program;
  const enumType = program.types.entries().find((record) => record.sourceKind === "enum");
  if (enumType === undefined) throw new Error("expected enum type");

  const result = instantiateMonoType({
    program,
    key: monoTypeKeyForTest({ typeId: enumType.typeId, typeArguments: [] }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(result.instance.enumCases.map((caseRecord) => caseRecord.name)).toEqual(["Arp", "Ipv4"]);
    expect(result.instance.enumCases.map((caseRecord) => caseRecord.ordinal)).toEqual([0, 1]);
  }
});

test("validated buffer layout fields with usize wire markers instantiate successfully", () => {
  const program = lowerTypedHirForTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    layout:",
        "        length: le usize @ 0",
        "        payload: u8 @ 8 len length",
      ].join("\n"),
    ],
  ]).program;
  const bufferType = program.types
    .entries()
    .find((record) => record.sourceKind === "validatedBuffer");
  if (bufferType === undefined) throw new Error("expected validated buffer type");

  const result = instantiateMonoType({
    program,
    key: monoTypeKeyForTest({ typeId: bufferType.typeId, typeArguments: [] }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const lengthField = result.validatedBuffer?.layoutFields.find(
      (field) => field.field.name === "length",
    );
    const payloadField = result.validatedBuffer?.layoutFields.find(
      (field) => field.field.name === "payload",
    );
    expect(lengthField?.layoutWireEndian).toBe("little");
    expect(payloadField?.length?.kind).toBe("fieldValue");
    if (payloadField?.length?.kind === "fieldValue") {
      expect(payloadField.length.fieldKind).toBe("layout");
    }
  }
});

test("validated buffer layout fields carry substituted layout expressions", () => {
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
  if (bufferType === undefined) throw new Error("expected validated buffer type");

  const result = instantiateMonoType({
    program,
    key: monoTypeKeyForTest({ typeId: bufferType.typeId, typeArguments: [] }),
    source: { kind: "image", imageId: imageId(1) },
    ancestry: emptyMonoAncestryForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    const payload = result.validatedBuffer?.layoutFields[0];
    expect(payload?.field.name).toBe("payload");
    expect(payload?.offset.kind).toBe("integerLiteral");
    expect(payload?.offset.kind === "integerLiteral" ? payload.offset.value : undefined).toBe(3n);
    expect(payload?.length?.kind).toBe("fieldValue");
    expect(payload?.layoutWireEndian).toBeUndefined();
    if (payload?.length?.kind === "fieldValue") {
      expect(payload.length.fieldKind).toBe("parameter");
    }
  }
});
