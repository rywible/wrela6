import { describe, expect, test } from "bun:test";
import {
  compileUefiAArch64ImageWithTrace,
  efiErrorStatus,
  productionPackagePipelineDependencies,
} from "../../../../src/target/uefi-aarch64";
import {
  fixtureSpecForFullImageCase,
  packageInputForFullImageFixture,
  packetCounterBadPayloadFixtureSpec,
  packetCounterFixtureBytes,
} from "../../../../src/validation/full-image/fixture-catalog";
import { nodeFixtureProjectFilesystem } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

const packetCounterCases = [
  ["packet-counter", "toolchain-stdlib"],
  ["packet-counter", "ejected-stdlib"],
  ["packet-counter", "direct-platform"],
] as const;

describe("PacketCounter full-image fixture corpus", () => {
  test("declares deterministic fixture packet bytes", () => {
    expect(packetCounterFixtureBytes("packet-counter/toolchain-stdlib")).toEqual([
      0x01, 0x02, 0x03, 0x41, 0x42,
    ]);
    expect(packetCounterFixtureBytes("packet-counter/ejected-stdlib")).toEqual([
      0x01, 0x02, 0x03, 0x41, 0x42,
    ]);
    expect(packetCounterFixtureBytes("packet-counter/direct-platform")).toEqual([
      0x01, 0x02, 0x03, 0x41, 0x42,
    ]);
    expect(packetCounterFixtureBytes("packet-counter-bad-payload/toolchain-stdlib")).toEqual([
      0x01, 0x09, 0x03, 0x41,
    ]);
  });

  test("passes deterministic fixture packet bytes into PacketCounter package input", () => {
    for (const [scenario, stdlibMode] of packetCounterCases) {
      const spec = fixtureSpecForFullImageCase({ scenario, stdlibMode });
      const input = packageInputForFullImageFixture(spec, nodeFixtureProjectFilesystem);

      expect(input.kind).toBe("ok");
      if (input.kind !== "ok") continue;
      expect(input.value.validationFixturePacketSource).toEqual({
        primitiveId: "uefi.validation.fixturePacketSource",
        feature: "full-image-validation-fixture",
        stableKey: `full-image-validation:${scenario}:${stdlibMode}:fixture-packet-source`,
        bytes: [0x01, 0x02, 0x03, 0x41, 0x42],
      });
    }
  });

  test("compiles PacketCounter with validated payload byte loads in production OptIR", () => {
    const spec = fixtureSpecForFullImageCase({
      scenario: "packet-counter",
      stdlibMode: "toolchain-stdlib",
    });
    const input = packageInputForFullImageFixture(spec, nodeFixtureProjectFilesystem);

    expect(input.kind).toBe("ok");
    if (input.kind !== "ok") return;

    const compiled = compileUefiAArch64ImageWithTrace({
      packageInput: input.value,
      artifactName: "packet-counter-toolchain-stdlib.efi",
      smoke: { kind: "disabled" },
    });

    expect(compiled.kind).toBe("ok");
    if (compiled.kind !== "ok") return;

    const memoryLoads = compiled.trace.packagePipeline.optIr.operations.filter(
      (operation) => operation.kind === "memoryLoad",
    );
    expect(memoryLoads).toHaveLength(2);
    expect(
      memoryLoads.map((operation) => operation.memoryAccess.validatedBuffer?.fieldName),
    ).toEqual(["2", "3"]);
    expect(
      compiled.trace.packagePipeline.optIr.operations.find(
        (operation) => operation.kind === "integerBinary",
      )?.resultTypes[0],
    ).toEqual({ kind: "integer", signedness: "unsigned", width: 8 });
  });

  test("loads and parses every PacketCounter fixture module through production import discovery", () => {
    for (const [scenario, stdlibMode] of packetCounterCases) {
      const spec = fixtureSpecForFullImageCase({ scenario, stdlibMode });
      const input = packageInputForFullImageFixture(spec, nodeFixtureProjectFilesystem);

      expect(input.kind).toBe("ok");
      if (input.kind !== "ok") continue;

      expectRequiredFixtureModules(input.value.sourceFiles.map((source) => source.moduleName));

      const parsed = productionPackagePipelineDependencies().parseModuleGraph({
        packageInput: input.value,
      });

      expect(parsed.kind).toBe("ok");
    }
  });

  test("compiles the negative PacketCounter sibling with bad-payload bytes", () => {
    const spec = packetCounterBadPayloadFixtureSpec();
    const bytes = packetCounterFixtureBytes("packet-counter-bad-payload/toolchain-stdlib");
    const input = packageInputForFullImageFixture(spec, nodeFixtureProjectFilesystem);

    expect(spec).toMatchObject({
      scenario: "packet-counter",
      stdlibMode: "toolchain-stdlib",
      fixtureProjectPath:
        "tests/fixtures/full-image-validation/packet-counter-bad-payload/toolchain-stdlib",
      packageKey: "full-image-validation:packet-counter-bad-payload:toolchain-stdlib",
      expectedStatus: "bad_buffer_size",
      expectedConsoleMarkers: [],
    });
    expect(spec.validationFixturePacketSource?.bytes).toEqual(bytes);
    expect(badPayloadRequiresBadBufferSize(bytes)).toBe(true);
    const packetSource = spec.validationFixturePacketSource;
    expect(packetSource).toBeDefined();
    if (packetSource === undefined) return;

    expect(input.kind).toBe("ok");
    if (input.kind !== "ok") return;

    expect(input.value.validationFixturePacketSource).toEqual(packetSource);
    expectRequiredFixtureModules(input.value.sourceFiles.map((source) => source.moduleName));
    expectPacketValidationSourceReturnsBadBufferSize(input.value.sourceFiles);

    const parsed = productionPackagePipelineDependencies().parseModuleGraph({
      packageInput: input.value,
    });

    expect(parsed.kind).toBe("ok");

    const compiled = compileUefiAArch64ImageWithTrace({
      packageInput: input.value,
      artifactName: "packet-counter-bad-payload-toolchain-stdlib.efi",
      smoke: { kind: "disabled" },
    });

    expect(compiled.kind).toBe("ok");
    if (compiled.kind !== "ok") return;
    expect(compiled.trace.target.statusPolicy.badBufferSize).toBe(efiErrorStatus(4n));
    expect(compiled.trace.packagePipeline.optIr.validationFixturePacketSources).toEqual([
      packetSource,
    ]);
    const fixtureObject = compiled.trace.binarySpine.validationFixtureObjects.find(
      (module) => module.moduleKey === "uefi-validation-fixture-packet-source",
    );
    expect(fixtureObject).toBeDefined();
    const packetSection = fixtureObject?.objectModule.sections.find(
      (section) => section.stableKey === ".rdata.uefi-validation-fixture-packet-source",
    );
    expect(packetSection?.bytes).toEqual(bytes);
  });
});

const expectedFixtureModuleNames = [
  "image",
  "packet_counter.console",
  "packet_counter.counter",
  "packet_counter.fixture_source",
  "packet_counter.packet",
  "packet_counter.uefi_status",
] as const;

function expectRequiredFixtureModules(moduleNames: readonly string[]): void {
  for (const moduleName of expectedFixtureModuleNames) {
    expect(moduleNames).toContain(moduleName);
  }
}

function badPayloadRequiresBadBufferSize(bytes: readonly number[]): boolean {
  const encodedCounterDelta = bytes[1];
  if (encodedCounterDelta === undefined) return true;
  return 3 + encodedCounterDelta > bytes.length;
}

function expectPacketValidationSourceReturnsBadBufferSize(
  sourceFiles: readonly { readonly moduleName: string; readonly text: string }[],
): void {
  const packetSource = sourceFiles.find((source) => source.moduleName === "packet_counter.packet");
  expect(packetSource?.text).toContain("layout.fits else UefiStatus.bad_buffer_size");
}
