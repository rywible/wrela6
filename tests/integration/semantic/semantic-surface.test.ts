import { expect, test } from "bun:test";
import {
  checkSemanticSurfaceForTest,
  voidTargetSignature,
  uefiImageProfileFake,
  emptyProofContract,
} from "../../support/semantic/semantic-surface-fakes";
import {
  platformPrimitiveCatalog,
  semanticTargetSurface,
} from "../../../src/semantic/surface/platform-surface";
import type { PlatformPrimitiveSpec } from "../../../src/semantic/surface/platform-surface";
import {
  platformPrimitiveId,
  platformContractId,
  targetId,
  imageProfileId,
} from "../../../src/semantic/ids";

test("valid uefi image produces checked program and image seed", () => {
  const result = checkSemanticSurfaceForTest([
    ["main.wr", "uefi image Boot:\n    fn main() -> Never\n"],
  ]);

  expect(result.image).toBeDefined();
  expect(result.image!.entryFunctionId).toBeDefined();
  expect(result.diagnostics).toEqual([]);
  expect(result.program.functions.entries().length).toBeGreaterThan(0);
});

test("semantic image external root records the entry function item id", () => {
  const result = checkSemanticSurfaceForTest([
    ["main.wr", "uefi image Boot:\n    fn main() -> Never\n"],
  ]);
  const entryFunctionId = result.image?.entryFunctionId;
  expect(entryFunctionId).toBeDefined();
  if (entryFunctionId === undefined) return;
  const signature = result.program.functions.get(entryFunctionId);
  const root = result.program.monoClosureFacts.externalEntryRoots.get(entryFunctionId);

  expect(signature).toBeDefined();
  expect(root?.itemId).toBe(signature?.itemId);
});

test("multiple images require explicit root selection", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      "uefi image Boot:\n    fn main() -> Never\nuefi image Other:\n    fn main() -> Never\n",
    ],
  ]);

  const diagnosticCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
  expect(diagnosticCodes).toContain("SURFACE_AMBIGUOUS_IMAGE_ROOT");
  expect(result.image).toBeUndefined();
});

test("cross-module source references receive standard diagnostics", () => {
  const result = checkSemanticSurfaceForTest([
    ["lib.wr", "fn helper(x: u32) -> u32\n"],
    ["main.wr", "uefi image Boot:\n    fn main() -> Never\n"],
  ]);

  expect(result.diagnostics).toEqual([]);
  expect(result.program.functions.entries().length).toBe(2);
});

test("platform fn with wrong signature fails certification", () => {
  const primitive: PlatformPrimitiveSpec = {
    primitiveId: platformPrimitiveId("firmware_exit"),
    contractId: platformContractId("firmware_exit_contract"),
    availability: {
      targetId: targetId("uefi-aarch64"),
      profiles: [imageProfileId("uefi")],
      features: [],
    },
    signature: voidTargetSignature(),
    proofContract: emptyProofContract(),
  };

  const targetSurface = semanticTargetSurface({
    targetId: targetId("uefi-aarch64"),
    platformPrimitives: platformPrimitiveCatalog([primitive]),
    imageProfiles: [uefiImageProfileFake()],
    deviceSurfaces: [],
  });

  const result = checkSemanticSurfaceForTest(
    [
      [
        "main.wr",
        "platform fn firmware_exit(status: u64) -> Never\nuefi image Boot:\n    fn main() -> Never\n",
      ],
    ],
    { platformNames: ["firmware_exit"], targetSurface },
  );

  const diagnosticCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
  expect(diagnosticCodes).toContain("SURFACE_PLATFORM_SIGNATURE_MISMATCH");
});

test("target-unavailable primitive reports target-availability diagnostic", () => {
  const primitive: PlatformPrimitiveSpec = {
    primitiveId: platformPrimitiveId("firmware_exit"),
    contractId: platformContractId("firmware_exit_contract"),
    availability: {
      targetId: targetId("other-target"),
      profiles: [imageProfileId("uefi")],
      features: [],
    },
    signature: voidTargetSignature(),
    proofContract: emptyProofContract(),
  };

  const targetSurface = semanticTargetSurface({
    targetId: targetId("uefi-aarch64"),
    platformPrimitives: platformPrimitiveCatalog([primitive]),
    imageProfiles: [uefiImageProfileFake()],
    deviceSurfaces: [],
  });

  const result = checkSemanticSurfaceForTest(
    [
      [
        "main.wr",
        "platform fn firmware_exit(status: u64) -> Never\nuefi image Boot:\n    fn main() -> Never\n",
      ],
    ],
    { platformNames: ["firmware_exit"], targetSurface },
  );

  const diagnosticCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
  expect(diagnosticCodes).toContain("SURFACE_TARGET_UNAVAILABLE_PLATFORM_PRIMITIVE");
});

test("image device unavailable for selected profile reports image-device diagnostic", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      "uefi image Boot:\n    fn main() -> Never\n    devices:\n        serial: SerialPort\n",
    ],
  ]);

  const diagnosticCodes = result.diagnostics.map((diagnostic) => diagnostic.code);
  expect(diagnosticCodes).toContain("SURFACE_TARGET_UNAVAILABLE_IMAGE_DEVICE");
});

test("proof-surface seeds accessible from checked program", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      "fn is_valid() -> bool\nfn checked_entry() -> Never:\n    requires:\n        is_valid\nuefi image Boot:\n    fn main() -> Never\n",
    ],
  ]);

  expect(result.program.proofSurface.requirementSurfaces).toBeDefined();
  expect(typeof result.program.proofSurface.requirementSurfaces.entries).toBe("function");
  expect(Array.isArray(result.program.proofSurface.requirementSurfaces.entries())).toBe(true);
  expect(result.program.functions.entries().length).toBeGreaterThan(1);
});

test("proof surface preserves unique edge and private state source forms", () => {
  const result = checkSemanticSurfaceForTest([
    ["main.wr", "unique edge class NetworkDevice:\nprivate class RxBatchBuilder:\n"],
  ]);

  const resourceKinds = result.program.proofSurface.resourceKindByType
    .entries()
    .map((entry) => entry.resourceKind);

  expect(resourceKinds).toContainEqual({ kind: "concrete", value: "UniqueEdgeRoot" });
  expect(resourceKinds).toContainEqual({ kind: "concrete", value: "PrivateState" });
  expect(result.program.proofSurface.privateStateSurfaces.entries()).toHaveLength(1);
});

test("integration stores checked wire marker for validated-buffer layout fields", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    layout:",
        "        size: be u16 @ 0",
        "        payload: u8 @ 2",
        "uefi image Boot:",
        "    fn main() -> Never",
      ].join("\n"),
    ],
  ]);

  const sizeField = result.program.fields.entries().find((field) => field.name === "size");
  const payloadField = result.program.fields.entries().find((field) => field.name === "payload");

  expect(sizeField?.layoutWireEndian).toBe("big");
  expect(payloadField?.layoutWireEndian).toBeUndefined();
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
    "SURFACE_INVALID_WIRE_ENCODING",
  );
});

test("integration reports wire encoding errors for invalid layout fields", () => {
  const result = checkSemanticSurfaceForTest([
    [
      "main.wr",
      [
        "validated buffer Packet:",
        "    layout:",
        "        size: u16 @ 0",
        "        flag: le bool @ 2",
        "uefi image Boot:",
        "    fn main() -> Never",
      ].join("\n"),
    ],
  ]);

  const wireDiagnostics = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === "SURFACE_INVALID_WIRE_ENCODING",
  );
  expect(wireDiagnostics.length).toBeGreaterThanOrEqual(2);
  expect(wireDiagnostics[0]?.span?.start).toBeLessThan(wireDiagnostics[1]?.span?.start ?? 0);
});
