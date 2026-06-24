import { expect, test } from "bun:test";
import {
  checkSemanticSurfaceForTest,
  deviceSurfaceFake,
  emptyProofContract,
  primitiveSpecFake,
  semanticSurfaceSummary,
  uefiImageProfileFake,
} from "../../support/semantic/semantic-surface-fakes";
import { imageProfileId } from "../../../src/semantic/ids";
import {
  platformPrimitiveCatalog,
  semanticTargetSurface,
} from "../../../src/semantic/surface/platform-surface";

test("semantic surface is deterministic across same inputs", () => {
  const files: readonly [string, string][] = [
    ["main.wr", "uefi image Boot:\n    fn main() -> Never\n"],
  ];

  const first = checkSemanticSurfaceForTest(files);
  const second = checkSemanticSurfaceForTest(files);

  expect(semanticSurfaceSummary(first)).toEqual(semanticSurfaceSummary(second));
});

test("semantic surface is deterministic across shuffled target surface order", () => {
  const files: readonly [string, string][] = [
    [
      "main.wr",
      "class SerialPort:\nplatform fn firmware_exit()\nuefi image Boot:\n    devices:\n        serial: SerialPort\n    fn main() -> Never\n",
    ],
  ];
  const primitive = primitiveSpecFake({
    name: "firmware_exit",
    proofContract: emptyProofContract(),
  });
  const extraPrimitive = primitiveSpecFake({
    name: "firmware_wait",
    proofContract: emptyProofContract(),
  });
  const uefiProfile = uefiImageProfileFake();
  const otherProfile = {
    ...uefiImageProfileFake(),
    profileId: imageProfileId("uefi-debug"),
    name: "uefi-debug",
  };
  const serialDevice = deviceSurfaceFake({
    name: "SerialPort",
    uniqueEdgeRoots: ["serial-root"],
  });
  const otherDevice = deviceSurfaceFake({
    name: "OtherDevice",
    uniqueEdgeRoots: ["other-root"],
  });
  const firstTarget = semanticTargetSurface({
    targetId: primitive.availability.targetId,
    platformPrimitives: platformPrimitiveCatalog([primitive, extraPrimitive]),
    imageProfiles: [uefiProfile, otherProfile],
    deviceSurfaces: [serialDevice, otherDevice],
  });
  const secondTarget = semanticTargetSurface({
    targetId: primitive.availability.targetId,
    platformPrimitives: platformPrimitiveCatalog([extraPrimitive, primitive]),
    imageProfiles: [otherProfile, uefiProfile],
    deviceSurfaces: [otherDevice, serialDevice],
  });

  const first = checkSemanticSurfaceForTest(files, {
    platformNames: ["firmware_exit", "firmware_wait"],
    targetSurface: firstTarget,
  });
  const second = checkSemanticSurfaceForTest(files, {
    platformNames: ["firmware_exit", "firmware_wait"],
    targetSurface: secondTarget,
  });

  expect(semanticSurfaceSummary(first)).toEqual(semanticSurfaceSummary(second));
});

test("diagnostics summary includes key fields", () => {
  const result = checkSemanticSurfaceForTest([["main.wr", "fn f(x: UnknownType)\n"]]);

  const summary = JSON.parse(semanticSurfaceSummary(result));
  expect(summary.diagnostics.length).toBeGreaterThan(0);
  expect(summary.diagnostics[0].code).toBeDefined();
  expect(summary.diagnostics[0].message).toBeDefined();
});

test("empty program produces empty summary", () => {
  const result = checkSemanticSurfaceForTest([["main.wr", "fn f()\n"]]);

  const summary = JSON.parse(semanticSurfaceSummary(result));
  expect(summary.functions).toBeDefined();
  expect(Array.isArray(summary.functions)).toBe(true);
});
