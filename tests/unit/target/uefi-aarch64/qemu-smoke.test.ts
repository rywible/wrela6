import { describe, expect, test } from "bun:test";
import {
  classifyUefiAArch64QemuSmokeRun,
  planUefiAArch64QemuSmokeCommand,
  qemuSmokeArtifactPathFromEnvironment,
  qemuSmokeConfigFromEnvironment,
  runUefiAArch64QemuSmoke,
  runUefiAArch64QemuSmokeImage,
  type UefiAArch64ImageArtifact,
  type UefiAArch64QemuHostEffects,
} from "../../../../src/target/uefi-aarch64";
import { fakeQemuRunnerOutput } from "../../../support/target/uefi-aarch64/fake-qemu-runner";

describe("UEFI AArch64 QEMU smoke", () => {
  test("plans ESP boot path and AArch64 firmware command", () => {
    const plan = planUefiAArch64QemuSmokeCommand({
      artifactName: "smoke.efi",
      artifactBytes: [0x4d, 0x5a],
      tempDirectory: "/tmp/wrela-smoke",
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        termination: "kill-after-marker",
      },
      config: {
        qemuSystemAarch64Path: "/usr/bin/qemu-system-aarch64",
        firmwareCodePath: "/usr/share/AAVMF/AAVMF_CODE.fd",
        firmwareVarsTemplatePath: "/usr/share/AAVMF/AAVMF_VARS.fd",
        machine: "virt",
        cpu: "cortex-a76",
        memoryMiB: 512,
        accel: "tcg",
      },
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;

    expect(plan.value.espImagePath).toBe("/tmp/wrela-smoke/EFI/BOOT/BOOTAA64.EFI");
    expect(plan.value.firmwareVarsPath).toBe("/tmp/wrela-smoke/AAVMF_VARS.fd");
    expect(plan.value.executable).toBe("/usr/bin/qemu-system-aarch64");
    expect(plan.value.args).toContain("-machine");
    expect(plan.value.args).toContain("virt,virtualization=off,pflash0=rom,pflash1=efivars");
    expect(plan.value.args).toContain("-cpu");
    expect(plan.value.args).toContain("cortex-a76");
    expect(plan.value.args).toContain("-m");
    expect(plan.value.args).toContain("512");
    expect(plan.value.args).toContain("-serial");
    expect(plan.value.args).toContain("mon:stdio");
    expect(plan.value.args).toContain("-display");
    expect(plan.value.args).toContain("none");
    expect(plan.value.args).toContain(
      "node-name=rom,driver=file,filename=/usr/share/AAVMF/AAVMF_CODE.fd,read-only=true",
    );
    expect(plan.value.args).toContain(
      "node-name=efivars,driver=file,filename=/tmp/wrela-smoke/AAVMF_VARS.fd",
    );
    expect(plan.value.args).toContain("if=none,id=esp,format=raw,file=fat:rw:/tmp/wrela-smoke");
    expect(plan.value.args).toContain("virtio-blk-device,drive=esp");
  });

  test("plans UEFI Shell startup script for success-gated smoke markers", () => {
    const plan = planUefiAArch64QemuSmokeCommand({
      artifactName: "smoke.efi",
      artifactBytes: [0x4d, 0x5a],
      tempDirectory: "/tmp/wrela-smoke",
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        uefiShellSuccessMarker: { marker: "WRELA_UEFI_SHELL_STARTIMAGE_OK" },
      },
      config: {
        qemuSystemAarch64Path: "/usr/bin/qemu-system-aarch64",
        firmwareCodePath: "/usr/share/AAVMF/AAVMF_CODE.fd",
        machine: "virt",
        cpu: "cortex-a76",
        memoryMiB: 512,
        accel: "tcg",
      },
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;

    expect(plan.value.espImagePath).toBe("/tmp/wrela-smoke/EFI/WRELA/SMOKEAA64.EFI");
    expect(plan.value.expectedConsoleMarkers).toEqual([
      "WRELA_UEFI_SMOKE_OK",
      "WRELA_UEFI_SHELL_STARTIMAGE_OK.wrela-smoke",
    ]);
    expect(plan.value.failureConsoleMarkers).toEqual(["WRELA_UEFI_SMOKE_FAIL.wrela-smoke"]);
    expect(plan.value.startupScriptPath).toBe("/tmp/wrela-smoke/startup.nsh");
    expect(String.fromCharCode(...(plan.value.startupScriptBytes ?? []))).toBe(
      [
        "FS0:",
        "\\EFI\\WRELA\\SMOKEAA64.EFI",
        "if %lasterror% == 0 then",
        "  echo WRELA_UEFI_SHELL_STARTIMAGE_OK.wrela-smoke",
        "else",
        "  echo WRELA_UEFI_SMOKE_FAIL.wrela-smoke %lasterror%",
        "endif",
        "",
      ].join("\r\n"),
    );
  });

  test("passes shell-gated unit-success smoke with only the nonce shell marker", () => {
    const report = classifyUefiAArch64QemuSmokeRun({
      request: {
        kind: "qemu",
        uefiShellSuccessMarker: { marker: "WRELA_UEFI_SHELL_STARTIMAGE_OK" },
      },
      expectedConsoleMarkers: ["WRELA_UEFI_SHELL_STARTIMAGE_OK.nonce"],
      output: fakeQemuRunnerOutput({
        stdout: "WRELA_UEFI_SHELL_STARTIMAGE_OK.nonce",
        terminatedByHarness: true,
      }),
    });

    expect(report.status).toBe("passed");
    expect(report.observedMarkers).toEqual(["WRELA_UEFI_SHELL_STARTIMAGE_OK.nonce"]);
  });

  test("rejects unsafe UEFI Shell success marker text", () => {
    const plan = planUefiAArch64QemuSmokeCommand({
      artifactName: "smoke.efi",
      artifactBytes: [0x4d, 0x5a],
      tempDirectory: "/tmp/wrela-smoke",
      request: {
        kind: "qemu",
        uefiShellSuccessMarker: { marker: "OK\r\necho injected" },
      },
      config: {
        qemuSystemAarch64Path: "/usr/bin/qemu-system-aarch64",
        firmwareCodePath: "/usr/share/AAVMF/AAVMF_CODE.fd",
        machine: "virt",
        cpu: "cortex-a76",
        memoryMiB: 512,
        accel: "tcg",
      },
    });

    expect(plan.kind).toBe("error");
    if (plan.kind !== "error") return;
    expect(plan.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "qemu-smoke:invalid-shell-success-marker",
    );
  });

  test("requires shell-gated marker even when extra expected markers are configured", () => {
    const report = classifyUefiAArch64QemuSmokeRun({
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["EXTRA_MARKER"],
        uefiShellSuccessMarker: { marker: "WRELA_UEFI_SHELL_STARTIMAGE_OK" },
      },
      expectedConsoleMarkers: ["EXTRA_MARKER", "WRELA_UEFI_SHELL_STARTIMAGE_OK.nonce"],
      output: fakeQemuRunnerOutput({
        stdout: "EXTRA_MARKER",
        terminatedByHarness: true,
      }),
    });

    expect(report.status).toBe("failed");
    expect(report.stableDetail).toBe(
      "qemu-smoke:missing-markers:WRELA_UEFI_SHELL_STARTIMAGE_OK.nonce",
    );
  });

  test("does not pass shell-gated smoke when only the app marker is observed", () => {
    const report = classifyUefiAArch64QemuSmokeRun({
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        uefiShellSuccessMarker: { marker: "WRELA_UEFI_SHELL_STARTIMAGE_OK" },
      },
      expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK", "WRELA_UEFI_SHELL_STARTIMAGE_OK.nonce"],
      output: fakeQemuRunnerOutput({
        stdout: "WRELA_UEFI_SMOKE_OK",
        terminatedByHarness: true,
      }),
    });

    expect(report.status).toBe("failed");
    expect(report.stableDetail).toBe(
      "qemu-smoke:missing-markers:WRELA_UEFI_SHELL_STARTIMAGE_OK.nonce",
    );
  });

  test("classifies shell failure marker before success-looking markers", () => {
    const report = classifyUefiAArch64QemuSmokeRun({
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        uefiShellSuccessMarker: { marker: "WRELA_UEFI_SHELL_STARTIMAGE_OK" },
      },
      expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK", "WRELA_UEFI_SHELL_STARTIMAGE_OK.nonce"],
      failureConsoleMarkers: ["WRELA_UEFI_SMOKE_FAIL.nonce"],
      output: fakeQemuRunnerOutput({
        stdout:
          "WRELA_UEFI_SMOKE_OK\nWRELA_UEFI_SHELL_STARTIMAGE_OK.nonce\nWRELA_UEFI_SMOKE_FAIL.nonce 14",
        terminatedByHarness: true,
      }),
    });

    expect(report.status).toBe("failed");
    expect(report.stableDetail).toBe("qemu-smoke:shell-startimage-failed");
    expect(report.observedMarkers).toEqual([
      "WRELA_UEFI_SMOKE_OK",
      "WRELA_UEFI_SHELL_STARTIMAGE_OK.nonce",
    ]);
  });

  test("omits writable efivars pflash when no vars template is configured", () => {
    const plan = planUefiAArch64QemuSmokeCommand({
      artifactName: "smoke.efi",
      artifactBytes: [0x4d, 0x5a],
      tempDirectory: "/tmp/wrela-smoke",
      request: { kind: "qemu" },
      config: {
        qemuSystemAarch64Path: "/usr/bin/qemu-system-aarch64",
        firmwareCodePath: "/usr/share/AAVMF/AAVMF_CODE.fd",
        machine: "virt",
        cpu: "max",
        memoryMiB: 256,
        accel: "tcg",
      },
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") return;

    expect(plan.value.firmwareVarsPath).toBeUndefined();
    expect(plan.value.args).toContain("virt,virtualization=off,pflash0=rom");
    expect(plan.value.args.join("\n")).not.toContain("pflash1=efivars");
    expect(plan.value.args.join("\n")).not.toContain("node-name=efivars");
  });

  test("rejects requested QEMU smoke without explicit QEMU and firmware paths", () => {
    const plan = planUefiAArch64QemuSmokeCommand({
      artifactName: "smoke.efi",
      artifactBytes: [0x4d, 0x5a],
      tempDirectory: "/tmp/wrela-smoke",
      request: { kind: "qemu", allowSkip: false },
      config: {
        qemuSystemAarch64Path: "",
        firmwareCodePath: "",
        machine: "virt",
        cpu: "max",
        memoryMiB: 512,
        accel: "tcg",
      },
    });

    expect(plan.kind).toBe("error");
    if (plan.kind !== "error") return;
    expect(plan.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "qemu-smoke:missing-config:qemuSystemAarch64Path",
    );
    expect(plan.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "qemu-smoke:missing-config:firmwareCodePath",
    );
  });

  test("classifies marker observation plus harness termination as success", () => {
    const report = classifyUefiAArch64QemuSmokeRun({
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        termination: "kill-after-marker",
      },
      output: fakeQemuRunnerOutput({
        stdout: "Booting...\nWRELA_UEFI_SMOKE_OK\r\n",
        terminatedByHarness: true,
      }),
    });

    expect(report.status).toBe("passed");
    expect(report.observedMarkers).toEqual(["WRELA_UEFI_SMOKE_OK"]);
  });

  test("fails when process cleanup fails after marker observation", () => {
    const report = classifyUefiAArch64QemuSmokeRun({
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        termination: "kill-after-marker",
      },
      output: fakeQemuRunnerOutput({
        stdout: "WRELA_UEFI_SMOKE_OK\r\n",
        terminatedByHarness: true,
        cleanupFailed: true,
      }),
    });

    expect(report.status).toBe("failed");
    expect(report.stableDetail).toBe("qemu-smoke:cleanup-failed");
  });

  test("fails on timeout, missing marker, missing harness termination, and missing tools", () => {
    expect(
      classifyUefiAArch64QemuSmokeRun({
        request: { kind: "qemu", expectedConsoleMarkers: ["OK"] },
        output: fakeQemuRunnerOutput({ timedOut: true }),
      }).stableDetail,
    ).toBe("qemu-smoke:timeout");

    expect(
      classifyUefiAArch64QemuSmokeRun({
        request: { kind: "qemu", expectedConsoleMarkers: ["OK"] },
        output: fakeQemuRunnerOutput({ stdout: "booted", terminatedByHarness: true }),
      }).stableDetail,
    ).toBe("qemu-smoke:missing-markers:OK");

    expect(
      classifyUefiAArch64QemuSmokeRun({
        request: { kind: "qemu", expectedConsoleMarkers: ["OK"] },
        output: fakeQemuRunnerOutput({ stdout: "OK" }),
      }).stableDetail,
    ).toBe("qemu-smoke:harness-termination-missing");

    expect(
      classifyUefiAArch64QemuSmokeRun({
        request: { kind: "qemu", allowSkip: false },
        output: fakeQemuRunnerOutput({ missingTools: true }),
      }).stableDetail,
    ).toBe("qemu-smoke:missing-tools");
  });

  test("skips missing tools only when allowSkip is true", () => {
    const report = classifyUefiAArch64QemuSmokeRun({
      request: { kind: "qemu", allowSkip: true },
      output: fakeQemuRunnerOutput({ missingTools: true }),
    });

    expect(report.status).toBe("skipped");
    expect(report.stableDetail).toBe("qemu-smoke:missing-tools");
  });

  test("does not downgrade invalid smoke requests to skipped when allowSkip is true", async () => {
    const report = await runUefiAArch64QemuSmokeImage({
      artifactName: "smoke.efi",
      artifactBytes: [0x4d, 0x5a],
      request: {
        kind: "qemu",
        allowSkip: true,
        uefiShellSuccessMarker: { marker: "bad marker" },
      },
      config: {
        qemuSystemAarch64Path: "/usr/bin/qemu-system-aarch64",
        firmwareCodePath: "/usr/share/AAVMF/AAVMF_CODE.fd",
        machine: "virt",
        cpu: "max",
        memoryMiB: 512,
        accel: "tcg",
      },
      hostEffects: noRunQemuHostEffects(),
    });

    expect(report.status).toBe("failed");
    expect(report.stableDetail).toBe("qemu-smoke:invalid-shell-success-marker");
  });

  test("reads only documented QEMU environment keys", () => {
    const config = qemuSmokeConfigFromEnvironment({
      WRELA_QEMU_AARCH64: "/qemu",
      WRELA_QEMU_AARCH64_EFI_CODE: "/code.fd",
      WRELA_QEMU_AARCH64_EFI_VARS_TEMPLATE: "/vars.fd",
      PATH: "/must/not/matter",
    });

    expect(config).toEqual({
      kind: "ok",
      config: {
        qemuSystemAarch64Path: "/qemu",
        firmwareCodePath: "/code.fd",
        firmwareVarsTemplatePath: "/vars.fd",
        machine: "virt",
        cpu: "cortex-a76",
        memoryMiB: 512,
        accel: "tcg",
      },
    });
  });

  test("reads explicit prebuilt EFI artifact path for CLI smoke runs", () => {
    expect(
      qemuSmokeArtifactPathFromEnvironment({
        WRELA_UEFI_AARCH64_SMOKE_EFI: "/tmp/smoke.efi",
        WRELA_QEMU_AARCH64: "/ignored-by-artifact-path",
      }),
    ).toEqual({ kind: "ok", artifactPath: "/tmp/smoke.efi" });

    expect(qemuSmokeArtifactPathFromEnvironment({})).toEqual({
      kind: "skipped",
      stableDetail: "qemu-smoke:missing-env:WRELA_UEFI_AARCH64_SMOKE_EFI",
    });
  });

  test("runs through injected host effects without mutating artifact bytes or metadata", async () => {
    const artifact = smokeArtifactFixture();
    const writes: Array<{ readonly path: string; readonly bytes: Uint8Array }> = [];
    const copies: Array<{ readonly sourcePath: string; readonly targetPath: string }> = [];
    const removed: string[] = [];
    let processTimeoutMs = 0;

    const hostEffects: UefiAArch64QemuHostEffects = {
      createTempDirectory: async (prefix) => `${prefix}abc`,
      writeFile: async (path, bytes) => {
        writes.push({ path, bytes: Uint8Array.from(bytes) });
      },
      copyFile: async (sourcePath, targetPath) => {
        copies.push({ sourcePath, targetPath });
      },
      runProcess: async (_command, timeoutMs) => {
        processTimeoutMs = timeoutMs;
        return fakeQemuRunnerOutput({
          stdout: "WRELA_UEFI_SMOKE_OK",
          terminatedByHarness: true,
        });
      },
      removeDirectory: async (path) => {
        removed.push(path);
      },
    };

    const report = await runUefiAArch64QemuSmoke({
      artifact,
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        timeoutMs: 1234,
      },
      config: {
        qemuSystemAarch64Path: "/qemu",
        firmwareCodePath: "/code.fd",
        firmwareVarsTemplatePath: "/vars-template.fd",
        machine: "virt",
        cpu: "cortex-a76",
        memoryMiB: 512,
        accel: "tcg",
      },
      hostEffects,
    });

    expect(report.status).toBe("passed");
    expect(report.targetDriverFingerprint).toBe("target-driver");
    expect(writes.map((write) => ({ path: write.path, bytes: Array.from(write.bytes) }))).toEqual([
      { path: "wrela-uefi-aarch64-abc/EFI/BOOT/BOOTAA64.EFI", bytes: [0x4d, 0x5a] },
    ]);
    expect(copies).toEqual([
      { sourcePath: "/vars-template.fd", targetPath: "wrela-uefi-aarch64-abc/AAVMF_VARS.fd" },
    ]);
    expect(processTimeoutMs).toBe(1234);
    expect(removed).toEqual(["wrela-uefi-aarch64-abc"]);
    expect(Array.from(artifact.peCoffArtifact.bytes)).toEqual([0x4d, 0x5a]);
    expect(artifact.targetMetadata.targetDriverFingerprint).toBe("target-driver");
  });

  test("writes UEFI Shell startup script through injected host effects", async () => {
    const writes: Array<{ readonly path: string; readonly bytes: Uint8Array }> = [];

    const report = await runUefiAArch64QemuSmokeImage({
      artifactName: "smoke.efi",
      artifactBytes: [0x4d, 0x5a],
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        uefiShellSuccessMarker: { marker: "WRELA_UEFI_SHELL_STARTIMAGE_OK" },
      },
      config: {
        qemuSystemAarch64Path: "/qemu",
        firmwareCodePath: "/code.fd",
        machine: "virt",
        cpu: "cortex-a76",
        memoryMiB: 512,
        accel: "tcg",
      },
      hostEffects: {
        createTempDirectory: async (prefix) => `${prefix}abc`,
        writeFile: async (path, bytes) => {
          writes.push({ path, bytes: Uint8Array.from(bytes) });
        },
        copyFile: async () => {},
        runProcess: async () =>
          fakeQemuRunnerOutput({
            stdout: "WRELA_UEFI_SMOKE_OK\nWRELA_UEFI_SHELL_STARTIMAGE_OK.wrela-uefi-aarch64-abc",
            terminatedByHarness: true,
          }),
        removeDirectory: async () => {},
      },
    });

    expect(report.status).toBe("passed");
    expect(writes.map((write) => write.path)).toEqual([
      "wrela-uefi-aarch64-abc/EFI/WRELA/SMOKEAA64.EFI",
      "wrela-uefi-aarch64-abc/startup.nsh",
    ]);
    const startupScript = writes.find((write) => write.path.endsWith("startup.nsh"));
    expect(String.fromCharCode(...(startupScript?.bytes ?? []))).toContain(
      "echo WRELA_UEFI_SHELL_STARTIMAGE_OK.wrela-uefi-aarch64-abc",
    );
  });

  test("runs prebuilt EFI bytes through injected host effects", async () => {
    const writes: Array<{ readonly path: string; readonly bytes: Uint8Array }> = [];
    let observedArtifactName = "";

    const report = await runUefiAArch64QemuSmokeImage({
      artifactName: "prebuilt.efi",
      artifactBytes: [0x4d, 0x5a, 0x90],
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
      },
      config: {
        qemuSystemAarch64Path: "/qemu",
        firmwareCodePath: "/code.fd",
        machine: "virt",
        cpu: "cortex-a76",
        memoryMiB: 512,
        accel: "tcg",
      },
      hostEffects: {
        createTempDirectory: async (prefix) => `${prefix}abc`,
        writeFile: async (path, bytes) => {
          writes.push({ path, bytes: Uint8Array.from(bytes) });
        },
        copyFile: async () => {},
        runProcess: async (command) => {
          observedArtifactName = command.artifactName;
          return fakeQemuRunnerOutput({
            stdout: "WRELA_UEFI_SMOKE_OK",
            terminatedByHarness: true,
          });
        },
        removeDirectory: async () => {},
      },
    });

    expect(report.status).toBe("passed");
    expect(observedArtifactName).toBe("prebuilt.efi");
    expect(writes.map((write) => ({ path: write.path, bytes: Array.from(write.bytes) }))).toEqual([
      { path: "wrela-uefi-aarch64-abc/EFI/BOOT/BOOTAA64.EFI", bytes: [0x4d, 0x5a, 0x90] },
    ]);
  });

  test("classifies injected host cleanup failure after process completion", async () => {
    const report = await runUefiAArch64QemuSmoke({
      artifact: smokeArtifactFixture(),
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
      },
      config: {
        qemuSystemAarch64Path: "/qemu",
        firmwareCodePath: "/code.fd",
        machine: "virt",
        cpu: "cortex-a76",
        memoryMiB: 512,
        accel: "tcg",
      },
      hostEffects: {
        createTempDirectory: async (prefix) => `${prefix}abc`,
        writeFile: async () => {},
        copyFile: async () => {},
        runProcess: async () =>
          fakeQemuRunnerOutput({
            stdout: "WRELA_UEFI_SMOKE_OK",
            terminatedByHarness: true,
          }),
        removeDirectory: async () => {
          throw new Error("cleanup failed");
        },
      },
    });

    expect(report.status).toBe("failed");
    expect(report.stableDetail).toBe("qemu-smoke:cleanup-failed");
  });
});

function smokeArtifactFixture(): UefiAArch64ImageArtifact {
  return Object.freeze({
    artifactName: "smoke.efi",
    peCoffArtifact: Object.freeze({
      artifactName: "smoke.efi",
      mediaType: "application/vnd.microsoft.portable-executable",
      fileExtension: ".efi",
      bytes: Uint8Array.of(0x4d, 0x5a),
      deterministicMetadata: Object.freeze({
        schema: "wrela.pe-coff-efi-image",
        schemaVersion: 1,
        linkedLayoutFingerprint: "linked",
        writerTargetFingerprint: "writer",
        sectionTableFingerprint: "sections",
        dataDirectoryFingerprint: "directories",
        baseRelocationTableFingerprint: "relocations",
        headerFingerprint: "headers",
        imageFingerprint: "image",
      }),
      verification: Object.freeze({ runs: Object.freeze([]) }),
    }),
    targetMetadata: Object.freeze({
      schema: "wrela.uefi-aarch64-image",
      schemaVersion: 1,
      targetDriverFingerprint: "target-driver",
      aarch64TargetFingerprint: "aarch64",
      backendTargetFingerprint: "backend",
      linkerTargetFingerprint: "linker",
      peCoffWriterTargetFingerprint: "pe",
      semanticPlatformCatalogFingerprint: "semantic",
      proofMirRuntimeCatalogFingerprint: "runtime",
      entryThunkFingerprint: "entry",
      firmwareAbiFingerprint: "abi",
      statusPolicyFingerprint: "status",
      watchdogPolicyFingerprint: "watchdog",
      peCoffImageFingerprint: "image",
      finalImageFingerprint: "final",
    }),
  });
}

function noRunQemuHostEffects(): UefiAArch64QemuHostEffects {
  return Object.freeze({
    createTempDirectory: async (prefix: string) => `${prefix}abc`,
    writeFile: async () => {
      throw new Error("invalid smoke request should not write files");
    },
    copyFile: async () => {
      throw new Error("invalid smoke request should not copy firmware vars");
    },
    runProcess: async () => {
      throw new Error("invalid smoke request should not launch QEMU");
    },
    removeDirectory: async () => {},
  });
}
