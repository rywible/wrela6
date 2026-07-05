import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { computeEnumLayout } from "../../../src/layout/enum-layout";
import { layoutDiagnosticCode, type LayoutDiagnosticCode } from "../../../src/layout/diagnostics";
import { coreTypeId, itemId } from "../../../src/semantic/ids";
import type { CoreTypeId } from "../../../src/semantic/ids";
import { enumLayoutFixture, sourceLayoutTypeKey } from "../../support/layout/layout-fixtures";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoEnumCaseRecord, MonoTypeInstance } from "../../../src/mono/mono-hir";
import type { LayoutTargetSurface } from "../../../src/layout/target-layout";
import type { LayoutTypeKey } from "../../../src/layout/layout-program";
import { monoCoreType } from "../../support/mono/monomorphization-fixtures";

describe("computeEnumLayout", () => {
  test("enum layout selects smallest unsigned tag type that fits cases", () => {
    const result = computeEnumLayout(
      enumLayoutFixture({
        cases: ["Arp", "Ipv4", "Ipv6"],
        candidateTagTypes: [coreTypeId("u8"), coreTypeId("u16")],
        discriminantStart: 0n,
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.enumFact.tagType).toEqual({ kind: "core", coreTypeId: coreTypeId("u8") });
    expect(result.value.enumFact.cases.map((caseFact) => caseFact.discriminant)).toEqual([
      0n,
      1n,
      2n,
    ]);
  });

  test("enum layout assigns discriminants from discriminant start plus source ordinal", () => {
    const result = computeEnumLayout(
      enumLayoutFixture({
        cases: ["A", "B"],
        candidateTagTypes: [coreTypeId("u8")],
        discriminantStart: 10n,
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.enumFact.cases.map((caseFact) => caseFact.discriminant)).toEqual([
      10n,
      11n,
    ]);
  });

  test("enum layout sorts cases by source ordinal", () => {
    const owner = sourceLayoutTypeKey("PacketKind");
    const typeInstance = monoTypeInstanceForEnumTest({
      owner,
      cases: [
        enumCaseRecord(owner.instanceId, "Ipv6", 2, 3),
        enumCaseRecord(owner.instanceId, "Arp", 0, 1),
        enumCaseRecord(owner.instanceId, "Ipv4", 1, 2),
      ],
    });

    const result = computeEnumLayout({
      ...enumLayoutFixture(),
      typeInstance,
      owner,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.enumFact.cases.map((caseFact) => caseFact.name)).toEqual([
      "Arp",
      "Ipv4",
      "Ipv6",
    ]);
    expect(result.value.enumFact.cases.map((caseFact) => caseFact.ordinal)).toEqual([0, 1, 2]);
  });

  test("enum layout selects u16 when u8 cannot represent all discriminants", () => {
    const result = computeEnumLayout(
      enumLayoutFixture({
        cases: Array.from({ length: 300 }, (_unused, index) => `Case${index}`),
        candidateTagTypes: [coreTypeId("u8"), coreTypeId("u16")],
        discriminantStart: 0n,
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.enumFact.tagType).toEqual({ kind: "core", coreTypeId: coreTypeId("u16") });
  });

  test("enum layout records enum representation and zero tag offset", () => {
    const result = computeEnumLayout(enumLayoutFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.typeFact.representation).toEqual({ kind: "enum" });
    expect(result.value.enumFact.tagOffsetBytes).toBe(0n);
    expect(result.value.typeFact.sizeBytes).toBe(1n);
    expect(result.value.typeFact.alignmentBytes).toBe(1n);
  });

  test("empty enum is rejected", () => {
    const result = computeEnumLayout(
      enumLayoutFixture({
        cases: [],
        candidateTagTypes: [coreTypeId("u8")],
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_EMPTY_ENUM_REJECTED"),
    );
    expect(result.diagnostics[0]?.ownerKey).toBe(
      `enum:${String(sourceLayoutTypeKey("Enum").instanceId)}`,
    );
  });

  test("negative discriminant start is rejected", () => {
    const result = computeEnumLayout(
      enumLayoutFixture({
        cases: ["A"],
        candidateTagTypes: [coreTypeId("u8")],
        discriminantStart: -1n,
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_ENUM_NEGATIVE_DISCRIMINANT_START"),
    );
  });

  test("discriminant overflow is rejected when no candidate fits", () => {
    const result = computeEnumLayout(
      enumLayoutFixture({
        cases: ["A"],
        candidateTagTypes: [coreTypeId("u8")],
        discriminantStart: 512n,
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_ENUM_DISCRIMINANT_OVERFLOW"),
    );
  });

  test("discriminant overflow is rejected when addition exceeds target size type", () => {
    const result = computeEnumLayout(
      enumLayoutFixture({
        cases: ["A", "B"],
        candidateTagTypes: [coreTypeId("u64")],
        discriminantStart: (1n << 64n) - 1n,
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_ENUM_DISCRIMINANT_OVERFLOW"),
    );
  });

  test("non-unsigned candidate tag type is rejected", () => {
    const result = computeEnumLayout(
      enumLayoutFixture({
        cases: ["A"],
        candidateTagTypes: [coreTypeId("bool")],
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_ENUM_POLICY"),
    );
  });

  test("payload-bearing enum records tag and per-case payload offsets", () => {
    const owner = sourceLayoutTypeKey("PayloadEnum");
    const typeInstance = monoTypeInstanceForEnumTest({
      owner,
      cases: [enumCaseRecord(owner.instanceId, "A", 0, 1, [1 as never])],
      fields: [
        {
          fieldId: 1 as never,
          ownerTypeInstanceId: owner.instanceId,
          name: "payload",
          type: monoCoreType("u8"),
          resourceKind: "Copy",
          sourceOrigin: "test:0:0",
        },
      ],
    });

    const result = computeEnumLayout({
      ...enumLayoutFixture({ cases: ["A"] }),
      typeInstance,
      owner,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.enumFact.tagOffsetBytes).toBe(0n);
    expect(result.value.enumFact.cases[0]?.payloadOffsetBytes).toBe(1n);
    expect(result.value.enumFact.cases[0]?.payloadFields).toEqual([
      {
        fieldId: 1 as never,
        name: "payload",
        type: { kind: "core", coreTypeId: coreTypeId("u8") },
        offsetBytes: 1n,
        sizeBytes: 1n,
        alignmentBytes: 1n,
        sourceOrigin: "test:0:0",
      },
    ]);
    expect(result.value.fieldFacts).toEqual([
      {
        owner,
        fieldId: 1 as never,
        fieldName: "payload",
        fieldType: { kind: "core", coreTypeId: coreTypeId("u8") },
        offsetBytes: 1n,
        sizeBytes: 1n,
        alignmentBytes: 1n,
        index: 0,
        paddingBeforeBytes: 0n,
        sourceOrigin: "test:0:0",
      },
    ]);
    expect(result.value.typeFact.sizeBytes).toBe(2n);
    expect(result.value.typeFact.alignmentBytes).toBe(1n);
  });

  test("payload-bearing enum lays out per-case union payloads instead of all fields per case", () => {
    const owner = sourceLayoutTypeKey("Result");
    const typeInstance = monoTypeInstanceForEnumTest({
      owner,
      cases: [
        enumCaseRecord(owner.instanceId, "Ok", 0, 1, [1 as never]),
        enumCaseRecord(owner.instanceId, "Err", 1, 2, [2 as never]),
      ],
      fields: [
        {
          fieldId: 1 as never,
          ownerTypeInstanceId: owner.instanceId,
          name: "value",
          type: monoCoreType("u8"),
          resourceKind: "Copy",
          sourceOrigin: "test:0:0",
        },
        {
          fieldId: 2 as never,
          ownerTypeInstanceId: owner.instanceId,
          name: "error",
          type: monoCoreType("u32"),
          resourceKind: "Copy",
          sourceOrigin: "test:0:0",
        },
      ],
    });

    const result = computeEnumLayout({
      ...enumLayoutFixture({ cases: ["Ok", "Err"] }),
      typeInstance,
      owner,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const okCase = result.value.enumFact.cases[0];
    const errCase = result.value.enumFact.cases[1];
    expect(okCase?.payloadFields?.map((field) => field.name)).toEqual(["value"]);
    expect(errCase?.payloadFields?.map((field) => field.name)).toEqual(["error"]);
    expect(errCase?.payloadFields?.[0]?.offsetBytes).toBe(4n);
    expect(result.value.fieldFacts.map((field) => [field.fieldName, field.offsetBytes])).toEqual([
      ["value", 1n],
      ["error", 4n],
    ]);
    expect(result.value.typeFact.sizeBytes).toBe(8n);
    expect(result.value.typeFact.alignmentBytes).toBe(4n);
  });

  test("enum discriminants and tag type match independent finite-range oracle", () => {
    fastCheck.assert(
      fastCheck.property(enumLayoutInputArbitrary(), (input) => {
        const oracle = enumLayoutOracle(input);
        const result = computeEnumLayout(input);

        if (oracle.kind === "error") {
          expect(result.kind).toBe("error");
          if (result.kind === "error") {
            expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(oracle.code);
          }
          return;
        }

        expect(result.kind).toBe("ok");
        if (result.kind !== "ok") return;
        expect(result.value.enumFact.tagType).toEqual(oracle.tagType);
        expect(result.value.enumFact.cases.map((caseFact) => caseFact.discriminant)).toEqual([
          ...oracle.discriminants,
        ]);
      }),
      { numRuns: 100 },
    );
  });
});

function enumCaseRecord(
  enumTypeInstanceId: ReturnType<typeof monoInstanceId>,
  name: string,
  ordinal: number,
  caseItemIdValue: number,
  payloadFieldIds: MonoEnumCaseRecord["payloadFieldIds"] = [],
): MonoEnumCaseRecord {
  return {
    enumTypeInstanceId,
    caseItemId: itemId(caseItemIdValue),
    name,
    ordinal,
    payloadFieldIds,
    sourceOrigin: "test:0:0",
  };
}

function monoTypeInstanceForEnumTest(input: {
  readonly owner: ReturnType<typeof sourceLayoutTypeKey>;
  readonly cases: readonly MonoEnumCaseRecord[];
  readonly fields?: MonoTypeInstance["fields"];
}): MonoTypeInstance {
  return {
    instanceId: input.owner.instanceId,
    sourceTypeId: 1 as never,
    sourceItemId: itemId(1),
    sourceKind: "enum",
    typeArguments: [],
    fields: input.fields ?? [],
    enumCases: input.cases,
    resourceKind: "Copy",
    sourceOrigin: "test:0:0",
  };
}

function enumLayoutInputArbitrary(): fastCheck.Arbitrary<ReturnType<typeof enumLayoutFixture>> {
  return fastCheck
    .record({
      caseCount: fastCheck.integer({ min: 1, max: 50 }),
      discriminantStart: fastCheck.bigInt({ min: 0n, max: 200n }),
      candidateTagTypes: fastCheck.constantFrom(
        [coreTypeId("u8"), coreTypeId("u16")] as const,
        [coreTypeId("u16")] as const,
        [coreTypeId("u8")] as const,
      ),
    })
    .map(({ caseCount, discriminantStart, candidateTagTypes }) =>
      enumLayoutFixture({
        cases: Array.from({ length: caseCount }, (_unused, index) => `Case${index}`),
        candidateTagTypes: [...candidateTagTypes],
        discriminantStart,
      }),
    );
}

type EnumLayoutOracleResult =
  | {
      readonly kind: "ok";
      readonly tagType: LayoutTypeKey;
      readonly discriminants: readonly bigint[];
    }
  | { readonly kind: "error"; readonly code: LayoutDiagnosticCode };

function enumLayoutOracle(input: ReturnType<typeof enumLayoutFixture>): EnumLayoutOracleResult {
  const { cases, candidateTagTypes, discriminantStart, target } = input;

  if (cases.length === 0) {
    return { kind: "error", code: layoutDiagnosticCode("LAYOUT_EMPTY_ENUM_REJECTED") };
  }
  if (discriminantStart < 0n) {
    return { kind: "error", code: layoutDiagnosticCode("LAYOUT_ENUM_NEGATIVE_DISCRIMINANT_START") };
  }

  for (const candidate of candidateTagTypes) {
    const spec = primitiveSpecForCoreType(target, candidate);
    if (spec !== undefined && spec.representation !== "unsignedInteger") {
      return { kind: "error", code: layoutDiagnosticCode("LAYOUT_INVALID_ENUM_POLICY") };
    }
  }

  const sizeTypeMaximum = sizeTypeMaximumForTarget(target);
  const discriminants = cases.map((_unused, ordinal) => discriminantStart + BigInt(ordinal));

  for (const discriminant of discriminants) {
    if (discriminant > sizeTypeMaximum) {
      return { kind: "error", code: layoutDiagnosticCode("LAYOUT_ENUM_DISCRIMINANT_OVERFLOW") };
    }
  }

  const minimum = discriminants[0] ?? 0n;
  const maximum = discriminants[discriminants.length - 1] ?? 0n;

  for (const candidate of candidateTagTypes) {
    const spec = primitiveSpecForCoreType(target, candidate);
    if (spec === undefined || spec.bitWidth === undefined) {
      continue;
    }
    if (spec.representation !== "unsignedInteger") {
      continue;
    }
    const candidateMaximum = unsignedMaximumForBitWidth(spec.bitWidth);
    if (minimum >= 0n && maximum <= candidateMaximum) {
      return {
        kind: "ok",
        tagType: { kind: "core", coreTypeId: candidate },
        discriminants,
      };
    }
  }

  return { kind: "error", code: layoutDiagnosticCode("LAYOUT_ENUM_DISCRIMINANT_OVERFLOW") };
}

function primitiveSpecForCoreType(target: LayoutTargetSurface, candidate: CoreTypeId) {
  return target.coreTypes.get(candidate);
}

function sizeTypeMaximumForTarget(target: LayoutTargetSurface): bigint {
  const sizeTypeRef = target.dataModel.sizeType;
  const sizeTypeSpec =
    sizeTypeRef.kind === "core"
      ? target.coreTypes.get(sizeTypeRef.coreTypeId)
      : target.targetTypes.get(sizeTypeRef.targetTypeId);
  if (sizeTypeSpec?.bitWidth !== undefined) {
    return unsignedMaximumForBitWidth(sizeTypeSpec.bitWidth);
  }
  return target.dataModel.maximumObjectSizeBytes;
}

function unsignedMaximumForBitWidth(bitWidth: number): bigint {
  return (1n << BigInt(bitWidth)) - 1n;
}
