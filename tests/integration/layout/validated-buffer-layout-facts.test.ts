import { describe, expect, test } from "bun:test";
import { computeRepresentationLayoutFacts } from "../../../src/layout";
import { computeValidatedBufferFieldFacts } from "../../../src/layout/validated-buffer-fields";
import { monomorphizeWholeImage } from "../../../src/mono/monomorphizer";
import {
  layoutTargetSurfaceFake,
  layoutImageProfileCatalogFake,
  targetCallConventionId,
} from "../../support/layout/layout-fakes";
import { imageProfileId } from "../../../src/semantic/ids";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";
import { computeValidatedBufferFieldFactsInputForLayoutSource } from "../../support/layout/layout-fixtures";

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
    target: layoutTargetSurfaceFake({
      imageProfiles: layoutImageProfileCatalogFake([
        {
          profileId: imageProfileId("uefi"),
          physicalEntryCallConvention: targetCallConventionId("wrela-source"),
          physicalEntryArguments: [],
          physicalEntryResult: { kind: "unit" },
        },
      ]),
    }),
  };
}

function computeFieldFactsFromLayoutSource(layoutSource: readonly string[]) {
  return computeValidatedBufferFieldFacts(
    computeValidatedBufferFieldFactsInputForLayoutSource(layoutSource),
  );
}

describe("validated-buffer layout field facts", () => {
  test("dynamic payload emits payloadEnd and layoutFits read requirements", () => {
    const layoutSource = ["kind: u8 @ 0", "length: be u16 @ 1", "payload: u8 @ 3 len length"];
    const result = computeFieldFactsFromLayoutSource(layoutSource);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const payload = result.value.layoutFields.find((field) => field.name === "payload")!;
    expect(payload.readRequires.map((requirement) => requirement.kind)).toContain("payloadEnd");
    expect(payload.readRequires.map((requirement) => requirement.kind)).toContain("layoutFits");
  });

  test("closed validated-buffer program produces ordered layout field facts", () => {
    const layoutSource = ["kind: u8 @ 0", "length: be u16 @ 1", "payload: u8 @ 3 len length"];
    const result = computeFieldFactsFromLayoutSource(layoutSource);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.layoutFields).toHaveLength(3);
    expect(result.value.layoutFields.map((field) => field.name)).toEqual([
      "kind",
      "length",
      "payload",
    ]);
    expect(result.value.fixedEndBytes).toBe(3n);
    expect(result.value.sourceLengthTerm.kind).toBe("sourceLength");
  });

  test("dynamic payload emits payloadEnd and layoutFits through public layout API", () => {
    const layoutSource = ["kind: u8 @ 0", "length: be u16 @ 1", "payload: u8 @ 3 len length"];
    const result = computeRepresentationLayoutFacts(validatedBufferLayoutInput(layoutSource));

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    const buffer = result.facts.validatedBuffers.entries()[0]!;
    const payload = buffer.layoutFields.find((field) => field.name === "payload")!;
    expect(payload.readRequires.map((requirement) => requirement.kind)).toContain("payloadEnd");
    expect(payload.readRequires.map((requirement) => requirement.kind)).toContain("layoutFits");
  });
});
