import { expect, test } from "bun:test";
import {
  checkSemanticSurfaceForTest,
  platformVoidTargetSignature,
} from "../../support/semantic/semantic-surface-fakes";
import {
  platformPrimitiveCatalog,
  semanticTargetSurface,
} from "../../../src/semantic/surface/platform-surface";
import {
  imageProfileId,
  platformContractId,
  platformPrimitiveId,
  targetId,
} from "../../../src/semantic/ids";

function targetSurfaceWithTestPrimitive() {
  return semanticTargetSurface({
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
        signature: platformVoidTargetSignature(),
        proofContract: { requiredFacts: [], ensuredFacts: [] },
      },
    ]),
    imageProfiles: [
      {
        profileId: imageProfileId("uefi"),
        name: "uefi",
        declarationKind: "uefi",
        entryFunctionName: "main",
        entrySignature: platformVoidTargetSignature(),
        availableDeviceSurfaces: [],
        availablePlatformFamilies: [],
      },
    ],
    deviceSurfaces: [],
  });
}

test("requires sections still appear in proofSurface.requirementSurfaces", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      "fn is_valid() -> bool\nfn checked_entry() -> Never:\n    requires:\n        is_valid\nuefi image Boot:\n    fn main() -> Never\n",
    ],
  ]);

  const requirements = result.program.proofSurface.requirementSurfaces.entries();
  expect(requirements.length).toBeGreaterThanOrEqual(1);
  const requirementTexts = requirements.map((requirement) => requirement.expression.text);
  expect(requirementTexts.some((text) => text.includes("is_valid"))).toBe(true);
});

test("terminal functions still appear in proofSurface.terminalSurfaces", () => {
  const result = checkSemanticSurfaceForTest([
    ["main.wr", "terminal fn done() -> Never\nuefi image Boot:\n    fn main() -> Never\n"],
  ]);

  const terminals = result.program.proofSurface.terminalSurfaces.entries();
  expect(terminals).toHaveLength(1);
  expect(result.program.proofSurface.terminalSurfaces.get(terminals[0]!.functionId)).toBeDefined();
});

test("certified platform bindings still appear in proofSurface.platformContracts", () => {
  const result = checkSemanticSurfaceForTest(
    [
      [
        "main.wr",
        "platform fn test_primitive() -> Never\nuefi image Boot:\n    fn main() -> Never\n",
      ],
    ],
    { platformNames: ["test_primitive"], targetSurface: targetSurfaceWithTestPrimitive() },
  );

  const bindings = result.program.proofSurface.platformContracts.entries();
  expect(bindings).toHaveLength(1);
  expect(bindings[0]!.primitiveId).toBe(platformPrimitiveId("test_primitive"));
  expect(bindings[0]!.certificate.kind).toBe("exactCatalogMatch");
});

test("requires, terminal, and platform bindings coexist and scaffold tables remain empty", () => {
  const result = checkSemanticSurfaceForTest(
    [
      [
        "main.wr",
        "platform fn test_primitive() -> Never\nterminal fn done() -> Never\nfn is_valid() -> bool\nfn checked_entry() -> Never:\n    requires:\n        is_valid\nuefi image Boot:\n    fn main() -> Never\n",
      ],
    ],
    { platformNames: ["test_primitive"], targetSurface: targetSurfaceWithTestPrimitive() },
  );

  expect(result.program.proofSurface.requirementSurfaces.entries().length).toBeGreaterThanOrEqual(
    1,
  );
  expect(result.program.proofSurface.terminalSurfaces.entries()).toHaveLength(1);
  expect(result.program.proofSurface.platformContracts.entries()).toHaveLength(1);

  expect(result.program.proofSurface.constructibilitySurfaces.entries()).toEqual([]);
  expect(result.program.proofSurface.takeModeSurfaces.entries()).toEqual([]);
  expect(result.program.proofSurface.validationContracts.entries()).toEqual([]);
  expect(result.program.proofSurface.attemptContracts.entries()).toEqual([]);
  expect(result.program.proofSurface.privateTransitions.entries()).toEqual([]);
  expect(result.program.proofSurface.platformEnsuredFacts.entries()).toEqual([]);
  expect(result.program.proofSurface.matchRefinements.entries()).toEqual([]);
});
