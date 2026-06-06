import { expect, test } from "bun:test";
import { certifyPlatformBindings } from "../../../../src/semantic/surface/platform-certifier";
import { parseAndResolveSurfaceFixture } from "../../../support/semantic/semantic-surface-fakes";
import { checkAllFunctionSignatures } from "../../../../src/semantic/surface/signature-checker";
import {
  platformPrimitiveCatalog,
  semanticTargetSurface,
} from "../../../../src/semantic/surface/platform-surface";
import type { TargetFunctionSignature } from "../../../../src/semantic/surface/platform-surface";
import { coreCheckedType } from "../../../../src/semantic/surface/type-model";
import { concreteKind } from "../../../../src/semantic/surface/resource-kind";
import {
  coreTypeId,
  platformPrimitiveId,
  platformContractId,
  imageProfileId,
  targetId,
} from "../../../../src/semantic/ids";
import type { CheckedProofSurface } from "../../../../src/semantic/surface/proof-surface";

function emptyProofSurface(): CheckedProofSurface {
  return {
    requirementSurfaces: { entries: () => [], get: () => undefined },
    predicateFactSurfaces: { entries: () => [], get: () => undefined },
    terminalSurfaces: { entries: () => [], get: () => undefined },
    validationSurfaces: { entries: () => [] },
    privateStateSurfaces: { entries: () => [] },
    imageSurfaces: { entries: () => [] },
  };
}

const defaultAvailability = {
  targetId: targetId("uefi-aarch64"),
  profileId: imageProfileId("uefi"),
  features: [] as readonly string[],
};

function voidPlatformTargetSignature(extra?: {
  params?: { type: any; mode: string; resourceKind: any }[];
}): TargetFunctionSignature {
  return {
    genericArity: 0,
    receiver: undefined,
    parameters: (extra?.params ?? []) as any,
    returnType: coreCheckedType(coreTypeId("Never")),
    returnKind: concreteKind("Never"),
    requiredModifiers: ["platform"],
    forbiddenModifiers: [],
  };
}

test("certify with no platform functions produces no bindings and no diagnostics", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn no_platform()\n"]]);
  const { signatures } = checkAllFunctionSignatures({
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  const result = certifyPlatformBindings({
    index: fixture.index,
    platformBindings: fixture.platformBindings,
    signatures,
    proofSurface: emptyProofSurface(),
    targetSurface: fixture.targetSurface,
    availability: defaultAvailability,
  });

  expect(result.bindings.entries()).toHaveLength(0);
  expect(result.diagnostics).toHaveLength(0);
});

test("certify with non-platform function produces no bindings and no diagnostics", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "fn regular_function()\n"]]);
  const { signatures } = checkAllFunctionSignatures({
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  const result = certifyPlatformBindings({
    index: fixture.index,
    platformBindings: fixture.platformBindings,
    signatures,
    proofSurface: emptyProofSurface(),
    targetSurface: fixture.targetSurface,
    availability: defaultAvailability,
  });

  expect(result.bindings.entries()).toHaveLength(0);
  expect(result.diagnostics).toHaveLength(0);
});

test("successful certification produces exactCatalogMatch binding", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "platform fn test_primitive()\n"]], {
    platformNames: ["test_primitive"],
  });

  const { signatures } = checkAllFunctionSignatures({
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  const targetSurface = semanticTargetSurface({
    targetId: targetId("uefi-aarch64"),
    platformPrimitives: platformPrimitiveCatalog([
      {
        primitiveId: platformPrimitiveId("test_primitive"),
        contractId: platformContractId("test_primitive_contract"),
        availability: {
          targetId: targetId("uefi-aarch64"),
          profiles: [imageProfileId("uefi")],
          features: [],
        },
        signature: voidPlatformTargetSignature(),
        proofContract: { requiredFacts: [], ensuredFacts: [] },
      },
    ]),
    imageProfiles: [],
    deviceSurfaces: [],
  });

  const result = certifyPlatformBindings({
    index: fixture.index,
    platformBindings: fixture.platformBindings,
    signatures,
    proofSurface: emptyProofSurface(),
    targetSurface,
    availability: defaultAvailability,
  });

  expect(result.diagnostics).toHaveLength(0);
  expect(result.bindings.entries()).toHaveLength(1);

  const binding = result.bindings.get(fixture.index.functions()[0]!.id);
  expect(binding).toBeDefined();
  expect(binding!.certificate.kind).toBe("exactCatalogMatch");
  expect(binding!.primitiveId).toBe(platformPrimitiveId("test_primitive"));
  expect(binding!.targetId).toBe(targetId("uefi-aarch64"));
});

test("missing name-only binding emits SURFACE_MISSING_PLATFORM_BINDING", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "platform fn unknown_fn()\n"]], {
    platformNames: [],
  });

  const { signatures } = checkAllFunctionSignatures({
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  const result = certifyPlatformBindings({
    index: fixture.index,
    platformBindings: fixture.platformBindings,
    signatures,
    proofSurface: emptyProofSurface(),
    targetSurface: fixture.targetSurface,
    availability: defaultAvailability,
  });

  expect(result.bindings.entries()).toHaveLength(0);
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_MISSING_PLATFORM_BINDING",
  );
});

test("missing catalog entry emits SURFACE_PLATFORM_CATALOG_ENTRY_MISSING", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "platform fn test_primitive()\n"]], {
    platformNames: ["test_primitive"],
  });

  const { signatures } = checkAllFunctionSignatures({
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  const emptyTargetSurface = semanticTargetSurface({
    targetId: targetId("uefi-aarch64"),
    platformPrimitives: platformPrimitiveCatalog([]),
    imageProfiles: [],
    deviceSurfaces: [],
  });

  const result = certifyPlatformBindings({
    index: fixture.index,
    platformBindings: fixture.platformBindings,
    signatures,
    proofSurface: emptyProofSurface(),
    targetSurface: emptyTargetSurface,
    availability: defaultAvailability,
  });

  expect(result.bindings.entries()).toHaveLength(0);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_PLATFORM_CATALOG_ENTRY_MISSING",
  );
});

test("signature mismatch emits SURFACE_PLATFORM_SIGNATURE_MISMATCH", () => {
  const fixture = parseAndResolveSurfaceFixture(
    [["main.wr", "platform fn test_primitive(x: u32)\n"]],
    { platformNames: ["test_primitive"] },
  );

  const { signatures } = checkAllFunctionSignatures({
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  const targetSurface = semanticTargetSurface({
    targetId: targetId("uefi-aarch64"),
    platformPrimitives: platformPrimitiveCatalog([
      {
        primitiveId: platformPrimitiveId("test_primitive"),
        contractId: platformContractId("test_primitive_contract"),
        availability: {
          targetId: targetId("uefi-aarch64"),
          profiles: [imageProfileId("uefi")],
          features: [],
        },
        signature: voidPlatformTargetSignature(),
        proofContract: { requiredFacts: [], ensuredFacts: [] },
      },
    ]),
    imageProfiles: [],
    deviceSurfaces: [],
  });

  const result = certifyPlatformBindings({
    index: fixture.index,
    platformBindings: fixture.platformBindings,
    signatures,
    proofSurface: emptyProofSurface(),
    targetSurface,
    availability: defaultAvailability,
  });

  expect(result.bindings.entries()).toHaveLength(0);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_PLATFORM_SIGNATURE_MISMATCH",
  );
});

test("unavailable target emits SURFACE_TARGET_UNAVAILABLE_PLATFORM_PRIMITIVE", () => {
  const fixture = parseAndResolveSurfaceFixture([["main.wr", "platform fn test_primitive()\n"]], {
    platformNames: ["test_primitive"],
  });

  const { signatures } = checkAllFunctionSignatures({
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });

  const targetSurface = semanticTargetSurface({
    targetId: targetId("uefi-aarch64"),
    platformPrimitives: platformPrimitiveCatalog([
      {
        primitiveId: platformPrimitiveId("test_primitive"),
        contractId: platformContractId("test_primitive_contract"),
        availability: {
          targetId: targetId("uefi-aarch64"),
          profiles: [imageProfileId("different_profile")],
          features: [],
        },
        signature: voidPlatformTargetSignature(),
        proofContract: { requiredFacts: [], ensuredFacts: [] },
      },
    ]),
    imageProfiles: [],
    deviceSurfaces: [],
  });

  const result = certifyPlatformBindings({
    index: fixture.index,
    platformBindings: fixture.platformBindings,
    signatures,
    proofSurface: emptyProofSurface(),
    targetSurface,
    availability: defaultAvailability,
  });

  expect(result.bindings.entries()).toHaveLength(0);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_TARGET_UNAVAILABLE_PLATFORM_PRIMITIVE",
  );
});
