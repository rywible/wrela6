import { describe, expect, test } from "bun:test";
import { compileUefiAArch64ImageWithTrace } from "../../../../src/target/uefi-aarch64";
import {
  fixtureSpecForFullImageCase,
  packageInputForFullImageFixture,
} from "../../../../src/validation/full-image/fixture-catalog";
import { nodeFixtureProjectFilesystem } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("PacketCounter UEFI source lifecycle negatives", () => {
  test("rejects invalid phase use before restricted memory is reserved", () => {
    const result = compileMutatedPacketCounterImage("invalid-phase-use", (source) =>
      source.replace(
        [
          "let reserved = firmware.reserve_restricted_memory()? BootError.Memory",
          "        let discovered = reserved.discover_virtio()? BootError.DeviceDiscovery",
        ].join("\n"),
        "let discovered = firmware.discover_virtio()? BootError.DeviceDiscovery",
      ),
    );

    expectPipelineFailure(result, "SURFACE_UNRESOLVED_DEFERRED_MEMBER");
    expectPipelineFailure(result, "discover_virtio");
  });

  test("rejects missing net0 binding in the machine plan", () => {
    const result = compileMutatedPacketCounterImage("missing-device-binding", (source) =>
      source.replace(
        "let device_bindings: MachineDeviceBindings = { net0: binding.net0 }",
        "let device_bindings: MachineDeviceBindings = { }",
      ),
    );

    expectPipelineFailure(result, "HIR_OBJECT_FIELD_TYPE_MISMATCH:missing:net0");
  });

  test("rejects firmware reuse after exiting through bringup", () => {
    const result = compileMutatedPacketCounterImage("invalid-post-exit-firmware-use", (source) =>
      source.replace(
        "let machine = bringup(firmware=firmware)? BootError.Bringup",
        [
          "let machine = bringup(firmware=firmware)? BootError.Bringup",
          "        let second = bringup(firmware=firmware)? BootError.Bringup",
        ].join("\n"),
      ),
    );

    expectPipelineFailure(result, "PROOF_CHECK_USE_AFTER_CONSUME");
  });
});

function compileMutatedPacketCounterImage(
  caseKey: string,
  mutateImageSource: (source: string) => string,
): ReturnType<typeof compileUefiAArch64ImageWithTrace> {
  const spec = fixtureSpecForFullImageCase({
    scenario: "packet-counter",
    stdlibMode: "toolchain-stdlib",
  });
  const input = packageInputForFullImageFixture(spec, nodeFixtureProjectFilesystem);
  expect(input.kind).toBe("ok");
  if (input.kind !== "ok") throw new Error("expected PacketCounter package input");

  return compileUefiAArch64ImageWithTrace({
    packageInput: {
      ...input.value,
      sourceFiles: input.value.sourceFiles.map((sourceFile) =>
        sourceFile.moduleName === "image"
          ? { ...sourceFile, text: mutateImageSource(sourceFile.text) }
          : sourceFile,
      ),
    },
    artifactName: `${caseKey}.efi`,
    smoke: { kind: "disabled" },
  });
}

function expectPipelineFailure(
  result: ReturnType<typeof compileUefiAArch64ImageWithTrace>,
  stableDetailFragment: string,
): void {
  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail).join("\n")).toContain(
    stableDetailFragment,
  );
}
