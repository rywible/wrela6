import { expect, test } from "bun:test";
import {
  deviceSurfaceId,
  imageProfileId,
  platformContractId,
  platformPrimitiveId,
  targetId,
  uniqueEdgeRootKey,
} from "../../../../src/semantic/ids";
import {
  platformPrimitiveCatalog,
  semanticTargetSurface,
} from "../../../../src/semantic/surface/platform-surface";
import { coreCheckedType } from "../../../../src/semantic/surface/type-model";
import { concreteKind } from "../../../../src/semantic/surface/resource-kind";

function allProfilesAvailability() {
  return {
    targetId: targetId("uefi-aarch64"),
    profiles: [imageProfileId("uefi")],
    features: [] as readonly string[],
  };
}

function emptyProofContract() {
  return { requiredFacts: [] as const, ensuredFacts: [] as const };
}

function voidTargetSignature() {
  return {
    genericArity: 0,
    receiver: undefined,
    parameters: [] as const,
    returnType: coreCheckedType(platformPrimitiveId("void") as unknown as any),
    returnKind: concreteKind("Copy"),
    requiredModifiers: [] as const,
    forbiddenModifiers: [] as const,
  };
}

function uefiProfileFake() {
  return {
    profileId: imageProfileId("uefi"),
    name: "uefi",
    declarationKind: "uefi" as const,
    entryFunctionName: "main",
    entrySignature: {
      genericArity: 0,
      receiver: undefined,
      parameters: [],
      returnType: coreCheckedType(platformPrimitiveId("Never") as unknown as any),
      returnKind: concreteKind("Never"),
      requiredModifiers: [],
      forbiddenModifiers: [],
    },
    availableDeviceSurfaces: [],
    availablePlatformFamilies: [],
  };
}

test("platform primitive catalog sorts by primitive id", () => {
  const catalog = platformPrimitiveCatalog([
    {
      primitiveId: platformPrimitiveId("b_primitive"),
      contractId: platformContractId("b_contract"),
      availability: allProfilesAvailability(),
      signature: voidTargetSignature(),
      proofContract: emptyProofContract(),
    },
    {
      primitiveId: platformPrimitiveId("a_primitive"),
      contractId: platformContractId("a_contract"),
      availability: allProfilesAvailability(),
      signature: voidTargetSignature(),
      proofContract: emptyProofContract(),
    },
  ]);

  expect(catalog.entries().map((entry) => entry.primitiveId)).toEqual([
    platformPrimitiveId("a_primitive"),
    platformPrimitiveId("b_primitive"),
  ]);
});

test("platform primitive catalog rejects duplicates", () => {
  expect(() =>
    platformPrimitiveCatalog([
      {
        primitiveId: platformPrimitiveId("dup"),
        contractId: platformContractId("c1"),
        availability: allProfilesAvailability(),
        signature: voidTargetSignature(),
        proofContract: emptyProofContract(),
      },
      {
        primitiveId: platformPrimitiveId("dup"),
        contractId: platformContractId("c2"),
        availability: allProfilesAvailability(),
        signature: voidTargetSignature(),
        proofContract: emptyProofContract(),
      },
    ]),
  ).toThrow("Duplicate platform primitive id 'dup'.");
});

test("semantic target surface rejects duplicate image profile names", () => {
  expect(() =>
    semanticTargetSurface({
      targetId: targetId("uefi-aarch64"),
      platformPrimitives: platformPrimitiveCatalog([]),
      imageProfiles: [uefiProfileFake(), uefiProfileFake()],
      deviceSurfaces: [],
    }),
  ).toThrow("Duplicate image profile name 'uefi'.");
});

test("semantic target surface rejects duplicate device surface names", () => {
  expect(() =>
    semanticTargetSurface({
      targetId: targetId("uefi-aarch64"),
      platformPrimitives: platformPrimitiveCatalog([]),
      imageProfiles: [],
      deviceSurfaces: [
        {
          deviceSurfaceId: deviceSurfaceId("net0"),
          name: "net",
          sourceTypeName: "NetDevice",
          availability: allProfilesAvailability(),
          resourceKind: "UniqueEdgeRoot",
          uniqueEdgeRoots: [uniqueEdgeRootKey("root1")],
        },
        {
          deviceSurfaceId: deviceSurfaceId("net1"),
          name: "net",
          sourceTypeName: "OtherNetDevice",
          availability: allProfilesAvailability(),
          resourceKind: "UniqueEdgeRoot",
          uniqueEdgeRoots: [uniqueEdgeRootKey("root2")],
        },
      ],
    }),
  ).toThrow("Duplicate device surface name 'net'.");
});

test("catalog get returns undefined for missing id", () => {
  const catalog = platformPrimitiveCatalog([]);
  expect(catalog.get(platformPrimitiveId("missing"))).toBeUndefined();
});

test("platform primitive catalog get finds entry", () => {
  const catalog = platformPrimitiveCatalog([
    {
      primitiveId: platformPrimitiveId("exists"),
      contractId: platformContractId("c1"),
      availability: allProfilesAvailability(),
      signature: voidTargetSignature(),
      proofContract: emptyProofContract(),
    },
  ]);
  expect(catalog.get(platformPrimitiveId("exists"))).toBeDefined();
});

test("semanticTargetSurface sorts image profiles by name", () => {
  const surface = semanticTargetSurface({
    targetId: targetId("test"),
    platformPrimitives: platformPrimitiveCatalog([]),
    imageProfiles: [
      { ...uefiProfileFake(), name: "b_profile" },
      { ...uefiProfileFake(), name: "a_profile", profileId: imageProfileId("a") },
    ],
    deviceSurfaces: [],
  });

  expect(surface.imageProfiles.map((profile) => profile.name)).toEqual(["a_profile", "b_profile"]);
});
