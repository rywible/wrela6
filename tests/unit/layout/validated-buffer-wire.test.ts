import { describe, expect, test } from "bun:test";
import { computeWireTypeFact } from "../../../src/layout/validated-buffer-wire";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import type { TargetWireReadHelperId } from "../../../src/layout/ids";
import { coreTypeId, fieldId, itemId, typeId } from "../../../src/semantic/ids";
import { sourceCheckedType } from "../../../src/semantic/surface/type-model";
import { monoCoreType, normalizeOk } from "../../support/mono/monomorphization-fixtures";
import { coreMonoType } from "../../support/layout/layout-fixtures";
import {
  layoutTargetSurfaceFake,
  layoutWireReadHelperCatalogFake,
  targetCallConventionId,
  wireTypeFixture,
} from "../../support/layout/layout-fixtures";

function targetWireReadHelperId(value: string): TargetWireReadHelperId {
  return value as TargetWireReadHelperId;
}

describe("computeWireTypeFact", () => {
  test("multi-byte scalar wire field without encoding is rejected", () => {
    const result = computeWireTypeFact(
      wireTypeFixture({
        type: coreMonoType("u16"),
        wireEncoding: undefined,
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_MISSING_WIRE_ENCODING"),
    );
    expect(result.diagnostics[0]?.ownerKey).toBe(`wire:${String(fieldId(1))}`);
    expect(result.diagnostics[0]?.rootCauseKey).toBe(`wire:${String(fieldId(1))}`);
  });

  test("single-byte scalar wire field accepts implicit byte encoding", () => {
    const result = computeWireTypeFact(
      wireTypeFixture({
        type: monoCoreType("u8"),
        wireEncoding: undefined,
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.wire).toEqual({
      kind: "scalar",
      type: { kind: "core", coreTypeId: coreTypeId("u8") },
      scalarEncoding: { kind: "byte" },
      wireSizeBytes: 1n,
      wireStrideBytes: 1n,
      wireCompatible: true,
      reason: "scalar",
    });
    expect(result.value.readPolicy).toEqual({
      alignment: "unalignedSafe",
      lowering: "bytewiseAssemble",
    });
  });

  test("multi-byte scalar wire field with matching encoding succeeds", () => {
    const result = computeWireTypeFact(
      wireTypeFixture({
        type: coreMonoType("u16"),
        wireEncoding: {
          kind: "integer",
          endian: "little",
          signedness: "unsigned",
          bitWidth: 16,
        },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.wire.kind).toBe("scalar");
    if (result.value.wire.kind !== "scalar") return;
    expect(result.value.wire.scalarEncoding).toEqual({
      kind: "integer",
      endian: "little",
      signedness: "unsigned",
      bitWidth: 16,
    });
    expect(result.value.wire.wireSizeBytes).toBe(2n);
    expect(result.value.readPolicy).toEqual({
      alignment: "unalignedSafe",
      lowering: "targetSafeUnalignedLoad",
    });
  });

  test("wire encoding bit width mismatch is rejected", () => {
    const result = computeWireTypeFact(
      wireTypeFixture({
        type: coreMonoType("u16"),
        wireEncoding: {
          kind: "integer",
          endian: "little",
          signedness: "unsigned",
          bitWidth: 32,
        },
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_WIRE_ENCODING"),
    );
  });

  test("zero-sized wire element is rejected when element count may be non-zero", () => {
    const result = computeWireTypeFact({
      ...wireTypeFixture({
        type: monoCoreType("Never"),
        wireEncoding: { kind: "byte" },
      }),
      elementCountCanBeNonZero: true,
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_ZERO_SIZED_WIRE_ELEMENT"),
    );
  });

  test("non-primitive wire field type is rejected", () => {
    const result = computeWireTypeFact(
      wireTypeFixture({
        type: normalizeOk(
          sourceCheckedType({
            itemId: itemId(1),
            typeId: typeId(1),
          }),
        ),
        wireEncoding: { kind: "byte" },
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_INVALID_WIRE_ENCODING"),
    );
  });

  test("missing target-provided wire read helper is rejected", () => {
    const helperId = targetWireReadHelperId("read-u16-le");
    const result = computeWireTypeFact({
      ...wireTypeFixture({
        type: coreMonoType("u16"),
        wireEncoding: {
          kind: "integer",
          endian: "little",
          signedness: "unsigned",
          bitWidth: 16,
        },
      }),
      readHelperId: helperId,
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_WIRE_HELPER_MISSING"),
    );
  });

  test("target-provided wire read helper with mismatched encoding is rejected", () => {
    const helperId = targetWireReadHelperId("read-u16-be");
    const target = layoutTargetSurfaceFake({
      wireReadHelpers: layoutWireReadHelperCatalogFake([
        {
          helperId,
          callConvention: targetCallConventionId("wrela-source"),
          encoding: {
            kind: "integer",
            endian: "big",
            signedness: "unsigned",
            bitWidth: 16,
          },
          resultType: { kind: "core", coreTypeId: coreTypeId("u16") },
          contract: "requiresLayoutReadRequirements",
        },
      ]),
    });

    const result = computeWireTypeFact({
      ...wireTypeFixture({
        type: coreMonoType("u16"),
        target,
        wireEncoding: {
          kind: "integer",
          endian: "little",
          signedness: "unsigned",
          bitWidth: 16,
        },
      }),
      readHelperId: helperId,
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_WIRE_HELPER_MISMATCH"),
    );
  });

  test("target-provided wire read helper with matching contract succeeds", () => {
    const helperId = targetWireReadHelperId("read-u16-le");
    const target = layoutTargetSurfaceFake({
      wireReadHelpers: layoutWireReadHelperCatalogFake([
        {
          helperId,
          callConvention: targetCallConventionId("wrela-source"),
          encoding: {
            kind: "integer",
            endian: "big",
            signedness: "unsigned",
            bitWidth: 16,
          },
          resultType: { kind: "core", coreTypeId: coreTypeId("u16") },
          contract: "requiresLayoutReadRequirements",
        },
      ]),
    });

    const result = computeWireTypeFact({
      ...wireTypeFixture({
        type: coreMonoType("u16"),
        target,
        wireEncoding: {
          kind: "integer",
          endian: "big",
          signedness: "unsigned",
          bitWidth: 16,
        },
      }),
      readHelperId: helperId,
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.readPolicy).toEqual({
      alignment: "unalignedSafe",
      lowering: "targetProvided",
      helperId,
    });
  });

  test("big-endian wire field selects bytewise assemble when no helper is available", () => {
    const result = computeWireTypeFact(
      wireTypeFixture({
        type: coreMonoType("u16"),
        wireEncoding: {
          kind: "integer",
          endian: "big",
          signedness: "unsigned",
          bitWidth: 16,
        },
      }),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.readPolicy).toEqual({
      alignment: "unalignedSafe",
      lowering: "bytewiseAssemble",
    });
  });
});
