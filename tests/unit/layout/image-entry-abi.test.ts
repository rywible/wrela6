import { describe, expect, test } from "bun:test";
import { layoutDiagnosticCode } from "../../../src/layout/diagnostics";
import {
  buildImageEntryThunkConversions,
  classifyPhysicalImageEntry,
  classifySourceImageEntry,
  computeImageEntryAbiFact,
} from "../../../src/layout/image-entry-abi";
import { seedPrimitiveTypeFacts } from "../../../src/layout/primitive-layout";
import { imageProfileId, parameterId } from "../../../src/semantic/ids";
import { coreTypeId } from "../../../src/semantic/ids";
import type { MonomorphizedHirProgram } from "../../../src/mono/mono-hir";
import {
  imageEntryAbiFixture,
  imageEntryMonoProgramForLayoutFixture,
  layoutTargetSurfaceFake,
  normalizeTargetFactsForTest,
  resolverForReachableTypesFromProgram,
  targetCallConventionId,
} from "../../support/layout/layout-fixtures";
import { layoutImageProfileCatalogFake } from "../../support/layout/layout-fakes";

function resolverForReachableCoreTypes(program: MonomorphizedHirProgram) {
  return resolverForReachableTypesFromProgram(program);
}

describe("computeImageEntryAbiFact", () => {
  test("image entry fact records firmware argument thunk conversion", () => {
    const result = computeImageEntryAbiFact(imageEntryAbiFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.value.fact.physicalCallConvention).toBe(targetCallConventionId("uefi-aarch64"));
    expect(result.value.fact.thunkConversions).toContainEqual({
      source: "firmwareArgument",
      targetParameterIndex: 0,
      sourceEntryParameterId: parameterId(0),
      shape: result.value.fact.sourceEntryArguments[0]!,
    });
  });

  test("layout rejects mono images with no entry function", () => {
    const fixture = imageEntryAbiFixture();
    const programWithoutEntry: MonomorphizedHirProgram = {
      ...fixture.program,
      image: {
        ...fixture.program.image,
        entryFunctionInstanceId: undefined,
      },
    };

    const result = computeImageEntryAbiFact({
      program: programWithoutEntry,
      target: fixture.target,
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_MISSING_IMAGE_ENTRY"),
    );
  });

  test("layout rejects missing target image profile specs", () => {
    const fixture = imageEntryAbiFixture({
      target: layoutTargetSurfaceFake({
        imageProfiles: layoutImageProfileCatalogFake([]),
      }),
    });

    const result = computeImageEntryAbiFact({
      program: fixture.program,
      target: fixture.target,
      profileId: imageProfileId("uefi"),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      layoutDiagnosticCode("LAYOUT_MISSING_IMAGE_PROFILE"),
    );
    const missingProfile = result.diagnostics.find(
      (diagnostic) => diagnostic.code === layoutDiagnosticCode("LAYOUT_MISSING_IMAGE_PROFILE"),
    );
    expect(missingProfile?.ownerKey).toBe(`image:${String(fixture.program.image.instanceId)}`);
    expect(missingProfile?.rootCauseKey).toBe(`profile:${String(imageProfileId("uefi"))}`);
    expect(missingProfile?.stableDetail).toBe(
      `${String(fixture.target.targetId)}:${String(imageProfileId("uefi"))}`,
    );
  });

  test("physical entry arguments classify under the profile call convention", () => {
    const fixture = imageEntryAbiFixture();
    const targetFacts = normalizeTargetFactsForTest(fixture.target);
    const primitiveResult = seedPrimitiveTypeFacts(fixture.target);
    expect(primitiveResult.kind).toBe("ok");
    if (primitiveResult.kind !== "ok") return;

    const profile = fixture.target.imageProfiles.get(imageProfileId("uefi"));
    expect(profile).toBeDefined();
    if (profile === undefined) return;

    const result = classifyPhysicalImageEntry({
      target: fixture.target,
      targetFacts,
      profile,
      types: primitiveResult.value.types,
    });

    expect(result.value).toBeDefined();
    expect(result.value?.arguments).toHaveLength(1);
    expect(result.value?.arguments[0]?.kind).toBe("direct");
    if (result.value?.arguments[0]?.kind === "direct") {
      expect(result.value.arguments[0].lanes[0]?.kind).toBe("pointer");
    }
    expect(result.value?.result).toEqual({
      kind: "none",
      reason: "unit",
      proofCarrying: false,
    });
  });

  test("source entry arguments classify under the target source call convention", () => {
    const fixture = imageEntryAbiFixture();
    const targetFacts = normalizeTargetFactsForTest(fixture.target);
    const primitiveResult = seedPrimitiveTypeFacts(fixture.target);
    expect(primitiveResult.kind).toBe("ok");
    if (primitiveResult.kind !== "ok") return;

    const entryFunctionInstanceId = fixture.program.image.entryFunctionInstanceId;
    expect(entryFunctionInstanceId).toBeDefined();
    if (entryFunctionInstanceId === undefined) return;

    const entryFunction = fixture.program.functions.get(entryFunctionInstanceId);
    expect(entryFunction).toBeDefined();
    if (entryFunction === undefined) return;

    const resolverResult = resolverForReachableCoreTypes(fixture.program);

    const result = classifySourceImageEntry({
      target: fixture.target,
      targetFacts,
      entryFunction,
      types: primitiveResult.value.types,
      enums: {
        get: () => undefined,
        has: () => false,
        entries: () => [],
        keyString: () => "" as never,
      },
      resolver: resolverResult,
    });

    expect(result.value).toBeDefined();
    expect(result.value?.arguments).toHaveLength(1);
    expect(result.value?.arguments[0]?.kind).toBe("direct");
    expect(result.value?.returnValue.kind).toBe("none");
  });
});

describe("buildImageEntryThunkConversions", () => {
  test("maps every non-proof source entry argument exactly once", () => {
    const fixture = imageEntryAbiFixture();
    const result = computeImageEntryAbiFact(fixture);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const entryFunctionInstanceId = fixture.program.image.entryFunctionInstanceId!;
    const entryFunction = fixture.program.functions.get(entryFunctionInstanceId)!;
    const profile = fixture.target.imageProfiles.get(imageProfileId("uefi"))!;

    const conversions = buildImageEntryThunkConversions({
      profile,
      physicalEntryArguments: profile.physicalEntryArguments,
      sourceEntryArguments: result.value.fact.sourceEntryArguments,
      entryFunction,
    });

    expect(conversions).toHaveLength(1);
    expect(conversions[0]?.source).toBe("firmwareArgument");
  });

  test("firmwareArgument thunk conversion uses physical profile index", () => {
    const fixture = imageEntryAbiFixture();
    const result = computeImageEntryAbiFact(fixture);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const entryFunctionInstanceId = fixture.program.image.entryFunctionInstanceId!;
    const entryFunction = fixture.program.functions.get(entryFunctionInstanceId)!;
    const profileWithLeadingPhysicalArg = {
      ...fixture.target.imageProfiles.get(imageProfileId("uefi"))!,
      physicalEntryArguments: [
        {
          name: "reserved",
          type: { kind: "core" as const, coreTypeId: coreTypeId("u64") },
          provenance: "scalarFirmwareValue" as const,
        },
        {
          name: "firmwareArgument",
          type: { kind: "core" as const, coreTypeId: coreTypeId("usize") },
          provenance: "scalarFirmwareValue" as const,
        },
      ],
    };

    const conversions = buildImageEntryThunkConversions({
      profile: profileWithLeadingPhysicalArg,
      physicalEntryArguments: profileWithLeadingPhysicalArg.physicalEntryArguments,
      sourceEntryArguments: result.value.fact.sourceEntryArguments,
      entryFunction,
    });

    const firmwareConversion = conversions.find(
      (conversion) => conversion.source === "firmwareArgument",
    );
    expect(firmwareConversion?.targetParameterIndex).toBe(1);
    expect(conversions).toHaveLength(1);
  });
});

describe("image entry mono fixture", () => {
  test("image entry mono fixture exposes entry parameter for thunk conversion", () => {
    const program = imageEntryMonoProgramForLayoutFixture();
    const entryFunctionInstanceId = program.image.entryFunctionInstanceId;
    expect(entryFunctionInstanceId).toBeDefined();
    if (entryFunctionInstanceId === undefined) return;
    const entryFunction = program.functions.get(entryFunctionInstanceId);
    expect(entryFunction?.signature.parameters).toHaveLength(1);
  });
});
