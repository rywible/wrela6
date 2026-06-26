import { describe, expect, test } from "bun:test";
import { computeRepresentationLayoutFacts } from "../../../src/layout";
import type { ComputeRepresentationLayoutFactsInput } from "../../../src/layout";
import { monoInstanceId } from "../../../src/mono/ids";
import type { MonoTypeInstance } from "../../../src/mono/mono-hir";
import { buildMonoTable } from "../../../src/mono/proof-metadata-tables";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import { itemId, typeId } from "../../../src/semantic/ids";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";
import {
  aggregateProgramLayoutFixture,
  closedMonoProgramWithPacketType,
  genericPacketProgramForMonoTest,
  layoutTargetWithUefiProfile,
} from "../../support/layout/layout-fixtures";
import { layoutTargetSurfaceFake } from "../../support/layout/layout-fakes";
import { targetId } from "../../../src/semantic/ids";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";

function closedAggregateLayoutInput() {
  const monoResult = monomorphizeWholeImage({ program: genericPacketProgramForMonoTest() });
  if (monoResult.kind !== "ok") {
    throw new Error(
      `expected monomorphization to succeed: ${monoResult.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
    );
  }

  return aggregateProgramLayoutFixture({
    program: monoResult.program,
  });
}

function validatedBufferLayoutInput(layoutSource: readonly string[]) {
  const layoutLines = layoutSource.map((line) => `        ${line}`).join("\n");
  const source = [
    "validated buffer Packet:",
    "    params:",
    "        expected_len: u16",
    "    layout:",
    layoutLines,
    "",
    "fn touch(_: Packet) -> Never:",
    "    return",
    "uefi image Boot:",
    "    fn main() -> Never:",
    "        return",
  ].join("\n");
  const base = lowerTypedHirForTest([["main.wr", source]]).program;
  const touch = base.functions.entries().find((func) => func.signature.parameters.length === 1);
  if (touch === undefined) {
    throw new Error("expected validated buffer touch function");
  }

  const monoResult = monomorphizeWholeImage({
    program: {
      ...base,
      monoClosure: {
        ...base.monoClosure,
        externalEntryRoots: [
          ...base.monoClosure.externalEntryRoots,
          {
            functionId: touch.functionId,
            ownerTypeArguments: [],
            functionTypeArguments: [],
            reason: "targetRequired",
            sourceOrigin: touch.sourceOrigin,
          },
        ],
      },
    },
  });
  if (monoResult.kind !== "ok") {
    throw new Error(
      `expected validated buffer monomorphization to succeed: ${monoResult.diagnostics.map((diagnostic) => String(diagnostic.code)).join(",")}`,
    );
  }

  return {
    program: monoResult.program,
    target: layoutTargetWithUefiProfile(),
  };
}

function programWithReachableInterfaceType(
  input: ComputeRepresentationLayoutFactsInput,
): ComputeRepresentationLayoutFactsInput {
  const interfaceInstance: MonoTypeInstance = {
    instanceId: monoInstanceId("type:Runnable"),
    sourceTypeId: typeId(99),
    sourceItemId: itemId(99),
    sourceKind: "interface",
    typeArguments: [],
    fields: [],
    enumCases: [],
    resourceKind: "Copy",
    sourceOrigin: "interface-fixture:0:0",
  };

  return {
    ...input,
    program: {
      ...input.program,
      types: buildMonoTable(
        [...input.program.types.entries(), interfaceInstance],
        (entry) => String(entry.instanceId),
        (id) => String(id),
      ),
    },
  };
}

describe("representation layout facts", () => {
  test("closed aggregate program produces complete layout fact program", () => {
    const result = computeRepresentationLayoutFacts(closedAggregateLayoutInput());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.facts.types.entries().length).toBeGreaterThan(0);
    expect(result.facts.fields.entries().map((field) => field.fieldName)).toContain("size");
    expect(result.facts.functions.entries().length).toBeGreaterThan(0);
  });

  test("monomorphized aggregate has distinct concrete field facts", () => {
    const result = computeRepresentationLayoutFacts(closedAggregateLayoutInput());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const fieldSizes = Object.fromEntries(
      result.facts.fields
        .entries()
        .filter((field) => field.fieldName === "kind" || field.fieldName === "size")
        .map((field) => [field.fieldName, field.sizeBytes]),
    );
    expect(fieldSizes).toEqual({ kind: 1n, size: 4n });
  });

  test("enum type facts are available when declared after an aggregate field type", () => {
    const source = [
      "class Packet:",
      "    kind: PacketKind",
      "",
      "enum PacketKind:",
      "    Arp",
      "    Ipv4",
      "",
      "fn touch(_: Packet) -> Never:",
      "    return",
      "uefi image Boot:",
      "    fn main() -> Never:",
      "        return",
    ].join("\n");
    const base = lowerTypedHirForTest([["main.wr", source]]).program;
    const touch = base.functions.entries().find((func) => func.signature.parameters.length === 1);
    if (touch === undefined) {
      throw new Error("expected touch function in enum-order fixture");
    }

    const monoResult = monomorphizeWholeImage({
      program: {
        ...base,
        monoClosure: {
          ...base.monoClosure,
          externalEntryRoots: [
            ...base.monoClosure.externalEntryRoots,
            {
              functionId: touch.functionId,
              ownerTypeArguments: [],
              functionTypeArguments: [],
              reason: "targetRequired",
              sourceOrigin: touch.sourceOrigin,
            },
          ],
        },
      },
    });
    expect(monoResult.kind).toBe("ok");
    if (monoResult.kind !== "ok") return;

    const result = computeRepresentationLayoutFacts({
      program: monoResult.program,
      target: layoutTargetWithUefiProfile(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const kindField = result.facts.fields.entries().find((field) => field.fieldName === "kind");
    expect(kindField?.sizeBytes).toBe(1n);
  });

  test("aggregate trailing padding is recorded in layout fact program", () => {
    const source = [
      "class Padded:",
      "    leading: u32",
      "    trailing: u8",
      "fn consumePadded(_: Padded) -> Never:",
      "    return",
      "uefi image Boot:",
      "    fn main() -> Never:",
      "        return",
    ].join("\n");
    const base = lowerTypedHirForTest([["main.wr", source]]).program;
    const consumePadded = base.functions
      .entries()
      .find((func) => func.bodyStatus === "sourceBody" && func.signature.parameters.length === 1);
    if (consumePadded === undefined) {
      throw new Error("expected consumePadded function in padding fixture");
    }

    const monoResult = monomorphizeWholeImage({
      program: {
        ...base,
        monoClosure: {
          ...base.monoClosure,
          externalEntryRoots: [
            ...base.monoClosure.externalEntryRoots,
            {
              functionId: consumePadded.functionId,
              ownerTypeArguments: [],
              functionTypeArguments: [],
              reason: "targetRequired",
              sourceOrigin: consumePadded.sourceOrigin,
            },
          ],
        },
      },
    });
    expect(monoResult.kind).toBe("ok");
    if (monoResult.kind !== "ok") return;

    const result = computeRepresentationLayoutFacts({
      program: monoResult.program,
      target: layoutTargetWithUefiProfile(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const paddedType = result.facts.types
      .entries()
      .find((typeFact) => (typeFact.aggregateStorage?.trailingPaddingBytes ?? 0n) > 0n);
    expect(paddedType?.aggregateStorage?.trailingPaddingBytes).toBe(3n);
    expect(
      paddedType?.aggregateStorage?.paddingRanges.some((range) => range.kind === "trailing"),
    ).toBe(true);
  });

  test("unsupported runtime interface values are rejected before Proof MIR", () => {
    const result = computeRepresentationLayoutFacts(
      programWithReachableInterfaceType(closedAggregateLayoutInput()),
    );

    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some(
        (diagnostic) =>
          String(diagnostic.code) === "LAYOUT_UNSUPPORTED_INTERFACE_VALUE" &&
          diagnostic.stableDetail === "interface",
      ),
    ).toBe(true);
  });

  test("validated-buffer value storage references aggregate hidden fields", () => {
    const layoutSource = ["kind: u8 @ 0", "length: be u16 @ 1", "payload: u8 @ 3 len length"];
    const result = computeRepresentationLayoutFacts(validatedBufferLayoutInput(layoutSource));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const buffer = result.facts.validatedBuffers.entries()[0]!;
    const ownerType = result.facts.types.get(buffer.typeKey);
    const hiddenFields = ownerType?.aggregateStorage?.hiddenFields ?? [];

    expect(hiddenFields).toHaveLength(2);
    const sourcePointer = hiddenFields[0]!;
    const sourceLength = hiddenFields[1]!;
    expect(buffer.valueStorage.sourcePointer).toBe(sourcePointer);
    expect(buffer.valueStorage.sourceLength).toBe(sourceLength);
  });

  test("ABI classifier failures retain actionable diagnostics in the full layout pipeline", () => {
    const result = computeRepresentationLayoutFacts({
      program: closedMonoProgramWithPacketType(),
      target: layoutTargetSurfaceFake({
        targetId: targetId("uefi-aarch64"),
        forceClassifierError: "forced classifier failure",
      }),
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.length).toBeGreaterThan(0);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_ABI_CLASSIFICATION_FAILED"),
    );
  });
});
