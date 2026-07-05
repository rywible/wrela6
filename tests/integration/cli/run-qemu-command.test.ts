import { describe, expect, test } from "bun:test";

import type { RunQemuCommandDependencies } from "../../../src/cli/run-command";
import { runQemuCommand } from "../../../src/cli/run-command";
import { WRELA_EXIT_DIAGNOSTICS, WRELA_EXIT_OK } from "../../../src/cli/exit-codes";
import {
  compilerPackageInput,
  type CompileUefiAArch64ImageWithTraceResult,
  type CompilerPackageInput,
  type UefiAArch64QemuHostEffects,
  type UefiAArch64QemuSmokeCommandPlan,
} from "../../../src/target/uefi-aarch64";

describe("run --qemu command seam", () => {
  test("runs the target QEMU harness through injected host effects", async () => {
    const host = fakeQemuHostEffects((command) => command.expectedConsoleMarkers.join("\n"));

    const result = await runQemuCommand(runCommand(), {
      ...successfulPipelineDependencies(),
      environment: qemuEnvironment(),
      qemuHostEffects: host.effects,
    });

    expect(result.exitCode).toBe(WRELA_EXIT_OK);
    expect(result.error).toBe(false);
    expect(result.result).toMatchObject({
      status: "passed",
      stableDetail: "qemu-smoke:markers-observed",
      observedMarkers: [
        "WRELA_UEFI_SMOKE_OK",
        "WRELA_UEFI_SHELL_STARTIMAGE_OK.wrela-uefi-aarch64-cli-test",
      ],
    });
    expect(host.timeouts).toEqual([30000]);
    expect(host.commands).toHaveLength(1);
    expect(host.commands[0]?.expectedConsoleMarkers[0]).toBe("WRELA_UEFI_SMOKE_OK");
    expect(
      host.commands[0]?.expectedConsoleMarkers.some((marker) =>
        marker.startsWith("WRELA_UEFI_SHELL_STARTIMAGE_OK."),
      ),
    ).toBe(true);
    expect(host.writes.map((write) => write.path)).toEqual([
      "wrela-uefi-aarch64-cli-test/EFI/WRELA/SMOKEAA64.EFI",
      "wrela-uefi-aarch64-cli-test/startup.nsh",
    ]);
  });

  test("fails when the fake QEMU output omits the CLI smoke marker", async () => {
    const host = fakeQemuHostEffects((command) =>
      command.expectedConsoleMarkers
        .filter((marker) => marker.startsWith("WRELA_UEFI_SHELL_STARTIMAGE_OK."))
        .join("\n"),
    );

    const result = await runQemuCommand(runCommand(), {
      ...successfulPipelineDependencies(),
      environment: qemuEnvironment(),
      qemuHostEffects: host.effects,
    });

    expect(result.exitCode).toBe(WRELA_EXIT_DIAGNOSTICS);
    expect(result.error).toBe(true);
    expect(result.result).toMatchObject({
      status: "failed",
      stableDetail: "qemu-smoke:missing-markers:WRELA_UEFI_SMOKE_OK",
    });
  });
});

function runCommand() {
  return Object.freeze({
    kind: "run" as const,
    directory: "/project",
    qemu: true as const,
    json: true,
  });
}

function qemuEnvironment(): Record<string, string | undefined> {
  return Object.freeze({
    WRELA_QEMU_AARCH64: "/usr/bin/qemu-system-aarch64",
    WRELA_QEMU_AARCH64_EFI_CODE: "/tmp/AAVMF_CODE.fd",
    WRELA_QEMU_AARCH64_EFI_VARS_TEMPLATE: "",
  });
}

function successfulPipelineDependencies(): RunQemuCommandDependencies {
  const packageInput = packageInputForTest();
  return Object.freeze({
    loadPackage: () =>
      Object.freeze({
        kind: "ok" as const,
        value: Object.freeze({
          packageInput,
          manifest: Object.freeze({
            packageName: "cli-run-test",
            targetKey: "wrela-uefi-aarch64-rpi5-v1" as const,
            stdlibMode: "toolchain" as const,
          }),
          stdlibMode: "toolchain" as const,
        }),
      }),
    compileImage: (
      input: Parameters<NonNullable<RunQemuCommandDependencies["compileImage"]>>[0],
    ) => {
      expect(input.packageInput).toBe(packageInput);
      return compiledImageForTest();
    },
  });
}

function packageInputForTest(): CompilerPackageInput {
  const result = compilerPackageInput({
    packageKey: "cli-run-test",
    entryModuleName: "image",
    sourceRoots: [],
    sourceFiles: [],
  });
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected package input fixture");
  return result.value;
}

function compiledImageForTest(): Extract<CompileUefiAArch64ImageWithTraceResult, { kind: "ok" }> {
  return Object.freeze({
    kind: "ok" as const,
    artifact: Object.freeze({
      artifactName: "cli-run-test.efi",
      peCoffArtifact: Object.freeze({
        artifactName: "cli-run-test.efi",
        mediaType: "application/vnd.microsoft.portable-executable",
        fileExtension: ".efi",
        bytes: Uint8Array.from([0x4d, 0x5a, 0x00, 0x00]),
        deterministicMetadata: Object.freeze({
          schema: "wrela.pe-coff-efi-image" as const,
          schemaVersion: 1 as const,
          linkedLayoutFingerprint: "fixture:layout",
          writerTargetFingerprint: "fixture:writer",
          sectionTableFingerprint: "fixture:sections",
          dataDirectoryFingerprint: "fixture:directories",
          baseRelocationTableFingerprint: "fixture:relocations",
          headerFingerprint: "fixture:headers",
          imageFingerprint: "fixture:image",
        }),
        verification: Object.freeze({ runs: [] }),
      }),
      targetMetadata: Object.freeze({
        schema: "wrela.uefi-aarch64-image" as const,
        schemaVersion: 1 as const,
        targetDriverFingerprint: "fixture:target-driver",
        aarch64TargetFingerprint: "fixture:aarch64",
        backendTargetFingerprint: "fixture:backend",
        linkerTargetFingerprint: "fixture:linker",
        peCoffWriterTargetFingerprint: "fixture:pe-coff",
        semanticPlatformCatalogFingerprint: "fixture:semantic",
        proofMirRuntimeCatalogFingerprint: "fixture:proof-runtime",
        entryThunkFingerprint: "fixture:entry",
        firmwareAbiFingerprint: "fixture:firmware",
        statusPolicyFingerprint: "fixture:status",
        watchdogPolicyFingerprint: "fixture:watchdog",
        peCoffImageFingerprint: "fixture:pe-image",
        finalImageFingerprint: "fixture:final-image",
      }),
      smoke: Object.freeze({
        status: "disabled" as const,
        stableDetail: "qemu-smoke:disabled",
        observedMarkers: [],
        targetDriverFingerprint: "fixture:target-driver",
      }),
    }),
    diagnostics: [],
    verification: Object.freeze({ runs: [] }),
    trace: Object.freeze({
      target: Object.freeze({}) as Extract<
        CompileUefiAArch64ImageWithTraceResult,
        { kind: "ok" }
      >["trace"]["target"],
      packagePipeline: Object.freeze({}) as Extract<
        CompileUefiAArch64ImageWithTraceResult,
        { kind: "ok" }
      >["trace"]["packagePipeline"],
      binarySpine: Object.freeze({}) as Extract<
        CompileUefiAArch64ImageWithTraceResult,
        { kind: "ok" }
      >["trace"]["binarySpine"],
    }),
  });
}

function fakeQemuHostEffects(
  stdoutForCommand: (command: UefiAArch64QemuSmokeCommandPlan) => string,
) {
  const commands: UefiAArch64QemuSmokeCommandPlan[] = [];
  const timeouts: number[] = [];
  const writes: Array<{ readonly path: string; readonly bytes: Uint8Array }> = [];
  const effects: UefiAArch64QemuHostEffects = Object.freeze({
    createTempDirectory: async (prefix: string) => `${prefix}cli-test`,
    writeFile: async (path: string, bytes: Uint8Array | readonly number[]) => {
      writes.push(Object.freeze({ path, bytes: Uint8Array.from(bytes) }));
    },
    copyFile: async () => {},
    runProcess: async (command: UefiAArch64QemuSmokeCommandPlan, timeoutMs: number) => {
      commands.push(command);
      timeouts.push(timeoutMs);
      return Object.freeze({
        stdout: stdoutForCommand(command),
        stderr: "",
        timedOut: false,
        cleanupFailed: false,
        missingTools: false,
        terminatedByHarness: true,
      });
    },
    removeDirectory: async () => {},
  });
  return Object.freeze({ effects, commands, timeouts, writes });
}
