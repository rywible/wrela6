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
  functionId,
  platformPrimitiveId,
  platformContractId,
  imageProfileId,
  parameterId,
  targetId,
  typeId,
} from "../../../../src/semantic/ids";
import type { CheckedProofSurface } from "../../../../src/semantic/surface/proof-surface";
import { checkedProofSurfaceEmpty } from "../../../../src/semantic/surface/proof-surface";

function emptyProofSurface(): CheckedProofSurface {
  return checkedProofSurfaceEmpty();
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

test("certification preserves structured ensured facts on exact bindings", () => {
  const fixture = parseAndResolveSurfaceFixture(
    [
      [
        "main.wr",
        "predicate fn ready(value: u32) -> bool\nplatform fn test_primitive(raw: u32) -> Never\n",
      ],
    ],
    {
      platformNames: ["test_primitive"],
    },
  );
  const { signatures } = checkAllFunctionSignatures({
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });
  const readyFunctionId = fixture.index.functions().find((record) => record.name === "ready")!.id;
  const platformSignature = signatures
    .entries()
    .find((signature) => signature.modifiers.isPlatform)!;
  const parameterIdValue = platformSignature.parameters[0]!.parameterId;
  const u32Type = coreCheckedType(coreTypeId("u32"));
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
        signature: voidPlatformTargetSignature({
          params: [{ type: u32Type, mode: "observe", resourceKind: concreteKind("Copy") }],
        }),
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [
            {
              kind: "predicate",
              predicateFunctionId: readyFunctionId,
              argumentBindings: [{ kind: "parameter", parameterId: parameterIdValue }],
            },
          ],
        },
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

  expect(result.diagnostics).toEqual([]);
  expect(result.bindings.entries()[0]!.ensuredFacts).toEqual([
    {
      fingerprint: `{"kind":"predicate","predicateFunctionId":${readyFunctionId},"argumentBindings":[{"kind":"parameter","parameterId":${parameterIdValue}}]}`,
      fact: {
        kind: "predicate",
        predicateFunctionId: readyFunctionId,
        argumentBindings: [{ kind: "parameter", parameterId: parameterIdValue }],
      },
    },
  ]);
});

test("certification rejects ensured facts whose parameter binding is not in the source signature", () => {
  const fixture = parseAndResolveSurfaceFixture(
    [
      [
        "main.wr",
        "predicate fn ready(value: u32) -> bool\nplatform fn test_primitive(raw: u32) -> Never\n",
      ],
    ],
    {
      platformNames: ["test_primitive"],
    },
  );
  const { signatures } = checkAllFunctionSignatures({
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });
  const readyFunctionId = fixture.index.functions().find((record) => record.name === "ready")!.id;
  const u32Type = coreCheckedType(coreTypeId("u32"));
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
        signature: voidPlatformTargetSignature({
          params: [{ type: u32Type, mode: "observe", resourceKind: concreteKind("Copy") }],
        }),
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [
            {
              kind: "predicate",
              predicateFunctionId: readyFunctionId,
              argumentBindings: [{ kind: "parameter", parameterId: parameterId(999) }],
            },
          ],
        },
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

  expect(result.bindings.entries()).toEqual([]);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_PLATFORM_CONTRACT_NOT_EXACT",
  );
});

test("certification rejects ensured predicate facts with unknown predicate functions", () => {
  const fixture = parseAndResolveSurfaceFixture(
    [["main.wr", "platform fn test_primitive() -> Never\n"]],
    {
      platformNames: ["test_primitive"],
    },
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
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [
            {
              kind: "predicate",
              predicateFunctionId: functionId(999),
              argumentBindings: [],
            },
          ],
        },
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

  expect(result.bindings.entries()).toEqual([]);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_PLATFORM_CONTRACT_NOT_EXACT",
  );
});

test("certification maps explicit target validation and attempt contracts to source parameter ids", () => {
  const fixture = parseAndResolveSurfaceFixture(
    [["main.wr", "platform fn test_primitive(raw: u32) -> u32\n"]],
    {
      platformNames: ["test_primitive"],
    },
  );
  const { signatures } = checkAllFunctionSignatures({
    index: fixture.index,
    referenceLookup: fixture.referenceLookup,
    coreTypes: fixture.coreTypes,
    kindContext: fixture.kindContext,
  });
  const u32Type = coreCheckedType(coreTypeId("u32"));
  const boolType = coreCheckedType(coreTypeId("bool"));
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
        signature: {
          genericArity: 0,
          receiver: undefined,
          parameters: [{ type: u32Type, mode: "observe", resourceKind: concreteKind("Copy") }],
          returnType: u32Type,
          returnKind: concreteKind("Copy"),
          requiredModifiers: ["platform"],
          forbiddenModifiers: [],
        },
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [],
          validationContracts: [
            {
              validatedBufferTypeId: typeId(3),
              resultType: u32Type,
              sourceType: u32Type,
              okPayloadType: u32Type,
              errPayloadType: boolType,
              sourceParameterIndex: 0,
            },
          ],
          attemptContracts: [
            {
              resultType: u32Type,
              okType: u32Type,
              errType: boolType,
              inputs: [{ kind: "parameter", parameterIndex: 0 }],
            },
          ],
        },
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

  expect(result.diagnostics).toEqual([]);
  const binding = result.bindings.entries()[0]!;
  const parameterIdValue = signatures.entries()[0]!.parameters[0]!.parameterId;
  expect(binding.validationContracts).toEqual([
    expect.objectContaining({ sourceParameterId: parameterIdValue }),
  ]);
  expect(binding.attemptContracts).toEqual([
    expect.objectContaining({ inputs: [{ kind: "parameter", parameterId: parameterIdValue }] }),
  ]);
});

test("certification rejects legacy raw target ensured facts", () => {
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
        proofContract: {
          requiredFacts: [],
          ensuredFacts: [{ kind: "rawText", text: "device.closed" }],
        },
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

  expect(result.bindings.entries()).toEqual([]);
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "SURFACE_PLATFORM_CONTRACT_NOT_EXACT",
  );
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
