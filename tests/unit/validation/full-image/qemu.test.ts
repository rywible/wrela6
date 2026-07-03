import { expect, test } from "bun:test";

import {
  classifyAArch64UefiFirmwarePath,
  fullImageQemuSmokeRequestForCase,
  runFullImageValidationQemuSmoke,
  type FullImageValidationQemuLaunchMode,
} from "../../../../src/validation/full-image";
import type {
  UefiAArch64QemuHostEffects,
  UefiAArch64QemuSmokeConfig,
  UefiAArch64QemuSmokeRequest,
} from "../../../../src/target/uefi-aarch64";

test("builds shell-startup QEMU smoke requests with case markers and shell marker", () => {
  const request = fullImageQemuSmokeRequestForCase({
    caseKey: "smoke-console/toolchain-stdlib",
    launchMode: "uefi-shell-startup",
    expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
  });

  expect(request).toEqual({
    kind: "qemu",
    allowSkip: true,
    expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
    uefiShellSuccessMarker: {
      marker: "WRELA_FULL_IMAGE_SMOKE_OK",
      failureMarker: "WRELA_FULL_IMAGE_SMOKE_FAIL",
    },
    termination: "kill-after-marker",
  });
});

test("builds default-boot-path QEMU smoke requests without shell marker", () => {
  const launchMode: FullImageValidationQemuLaunchMode = "default-boot-path";

  expect(
    fullImageQemuSmokeRequestForCase({
      caseKey: "packet-counter/direct-platform",
      launchMode,
      expectedConsoleMarkers: ["WRELA_PACKET_COUNTER_OK"],
    }),
  ).toEqual({
    kind: "qemu",
    allowSkip: true,
    expectedConsoleMarkers: ["WRELA_PACKET_COUNTER_OK"],
    termination: "kill-after-marker",
  });
});

test("builds marker-only shell-startup requests for non-returning PacketCounter cases", () => {
  expect(
    fullImageQemuSmokeRequestForCase({
      caseKey: "packet-counter/toolchain-stdlib",
      launchMode: "uefi-shell-startup",
      expectedConsoleMarkers: ["WRELA_PACKET_COUNTER_OK"],
    }),
  ).toEqual({
    kind: "qemu",
    allowSkip: true,
    expectedConsoleMarkers: ["WRELA_PACKET_COUNTER_OK"],
    termination: "kill-after-marker",
  });
});

test("classifies known AArch64 firmware basenames as accepted", () => {
  expect(classifyAArch64UefiFirmwarePath("/tmp/AAVMF_CODE.fd")).toEqual({
    kind: "accepted",
    stableDetail: "qemu-smoke:firmware-arch-aarch64:AAVMF_CODE.fd",
  });
  expect(classifyAArch64UefiFirmwarePath("/tmp/QEMU_EFI.fd")).toEqual({
    kind: "accepted",
    stableDetail: "qemu-smoke:firmware-arch-aarch64:QEMU_EFI.fd",
  });
  expect(classifyAArch64UefiFirmwarePath("/tmp/vendor-AA64-code.fd")).toEqual({
    kind: "accepted",
    stableDetail: "qemu-smoke:firmware-arch-aarch64:vendor-AA64-code.fd",
  });
  expect(classifyAArch64UefiFirmwarePath("/tmp/vendor-AARCH64-code.fd")).toEqual({
    kind: "accepted",
    stableDetail: "qemu-smoke:firmware-arch-aarch64:vendor-AARCH64-code.fd",
  });
});

test("rejects x86-like firmware basenames deterministically unless AArch64 token is present", () => {
  expect(classifyAArch64UefiFirmwarePath("/tmp/OVMF_CODE.fd")).toEqual({
    kind: "rejected",
    stableDetail: "qemu-smoke:firmware-arch-likely-x86:OVMF_CODE.fd",
  });
  expect(classifyAArch64UefiFirmwarePath("/tmp/RELEASE_X64.fd")).toEqual({
    kind: "rejected",
    stableDetail: "qemu-smoke:firmware-arch-likely-x86:RELEASE_X64.fd",
  });
  expect(classifyAArch64UefiFirmwarePath("/tmp/IA32_VARS.fd")).toEqual({
    kind: "rejected",
    stableDetail: "qemu-smoke:firmware-arch-likely-x86:IA32_VARS.fd",
  });
  expect(classifyAArch64UefiFirmwarePath("/tmp/OVMF_AARCH64_CODE.fd")).toEqual({
    kind: "accepted",
    stableDetail: "qemu-smoke:firmware-arch-aarch64:OVMF_AARCH64_CODE.fd",
  });
});

test("classifies unknown firmware basenames as warnings that may still run", () => {
  expect(classifyAArch64UefiFirmwarePath("/tmp/firmware-code.fd")).toEqual({
    kind: "unrecognized",
    stableDetail: "qemu-smoke:firmware-arch-unrecognized:firmware-code.fd",
  });
});

test("run helper preserves unknown firmware basename diagnostics while still launching", async () => {
  const calls: Array<{ readonly request: UefiAArch64QemuSmokeRequest }> = [];
  const report = await runFullImageValidationQemuSmoke({
    artifactName: "smoke.efi",
    artifactBytes: [0x4d, 0x5a],
    request: fullImageQemuSmokeRequestForCase({
      caseKey: "smoke-console/toolchain-stdlib",
      launchMode: "uefi-shell-startup",
      expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
    }),
    config: qemuConfig({ firmwareCodePath: "/tmp/firmware-code.fd" }),
    hostEffects: noRunHostEffects([]),
    runQemuSmokeImage: async (input) => {
      calls.push({ request: input.request });
      return {
        status: "passed",
        stableDetail: "qemu-smoke:markers-observed",
        observedMarkers: ["WRELA_UEFI_SMOKE_OK"],
      };
    },
  });

  expect(report).toEqual({
    status: "passed",
    stableDetail:
      "qemu-smoke:firmware-arch-unrecognized:firmware-code.fd:smoke:qemu-smoke:markers-observed",
    observedMarkers: ["WRELA_UEFI_SMOKE_OK"],
  });
  expect(calls).toHaveLength(1);
});

test("run helper fails rejected firmware before launch even when allowSkip is true", async () => {
  const calls: string[] = [];
  const report = await runFullImageValidationQemuSmoke({
    artifactName: "smoke.efi",
    artifactBytes: [0x4d, 0x5a],
    request: fullImageQemuSmokeRequestForCase({
      caseKey: "smoke-console/toolchain-stdlib",
      launchMode: "uefi-shell-startup",
      expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
    }),
    config: qemuConfig({ firmwareCodePath: "/tmp/OVMF_CODE.fd" }),
    hostEffects: noRunHostEffects(calls),
  });

  expect(report).toEqual({
    status: "failed",
    stableDetail: "qemu-smoke:firmware-arch-likely-x86:OVMF_CODE.fd",
    observedMarkers: [],
  });
  expect(calls).toEqual([]);
});

test("run helper skips missing QEMU or firmware config only when allowSkip is true", async () => {
  const skipped = await runFullImageValidationQemuSmoke({
    artifactName: "smoke.efi",
    artifactBytes: [0x4d, 0x5a],
    request: { kind: "qemu", allowSkip: true },
    config: qemuConfig({ qemuSystemAarch64Path: "" }),
    hostEffects: noRunHostEffects([]),
  });
  const failed = await runFullImageValidationQemuSmoke({
    artifactName: "smoke.efi",
    artifactBytes: [0x4d, 0x5a],
    request: { kind: "qemu", allowSkip: false },
    config: qemuConfig({ firmwareCodePath: "" }),
    hostEffects: noRunHostEffects([]),
  });

  expect(skipped.status).toBe("skipped");
  expect(skipped.stableDetail).toBe("qemu-smoke:missing-config:qemuSystemAarch64Path");
  expect(failed.status).toBe("failed");
  expect(failed.stableDetail).toBe("qemu-smoke:missing-config:firmwareCodePath");
});

test("run helper fails invalid requests before missing config skips", async () => {
  const report = await runFullImageValidationQemuSmoke({
    artifactName: "smoke.efi",
    artifactBytes: [0x4d, 0x5a],
    request: {
      kind: "qemu",
      allowSkip: true,
      uefiShellSuccessMarker: { marker: "bad marker" },
    },
    config: qemuConfig({ qemuSystemAarch64Path: "" }),
    hostEffects: noRunHostEffects([]),
  });

  expect(report.status).toBe("failed");
  expect(report.stableDetail).toBe("qemu-smoke:invalid-shell-success-marker");
});

test("run helper delegates valid image requests through injected runner", async () => {
  const calls: Array<{ readonly request: UefiAArch64QemuSmokeRequest }> = [];
  const report = await runFullImageValidationQemuSmoke({
    artifactName: "smoke.efi",
    artifactBytes: [0x4d, 0x5a],
    request: fullImageQemuSmokeRequestForCase({
      caseKey: "smoke-console/toolchain-stdlib",
      launchMode: "uefi-shell-startup",
      expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
    }),
    config: qemuConfig({ firmwareCodePath: "/tmp/AAVMF_CODE.fd" }),
    hostEffects: noRunHostEffects([]),
    runQemuSmokeImage: async (input) => {
      calls.push({ request: input.request });
      return {
        status: "passed",
        stableDetail: "qemu-smoke:markers-observed",
        observedMarkers: ["WRELA_UEFI_SMOKE_OK", "WRELA_FULL_IMAGE_SMOKE_OK"],
      };
    },
  });

  expect(report.status).toBe("passed");
  expect(calls).toHaveLength(1);
  expect(calls[0]?.request.uefiShellSuccessMarker?.marker).toBe("WRELA_FULL_IMAGE_SMOKE_OK");
});

test("run helper defaults to UEFI shell startup path through real target harness with fakes", async () => {
  const writes: Array<{ readonly path: string; readonly bytes: readonly number[] }> = [];

  const report = await runFullImageValidationQemuSmoke({
    artifactName: "smoke-console-toolchain-stdlib.efi",
    artifactBytes: [0x4d, 0x5a],
    request: fullImageQemuSmokeRequestForCase({
      caseKey: "smoke-console/toolchain-stdlib",
      launchMode: "uefi-shell-startup",
      expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
    }),
    config: qemuConfig({ firmwareCodePath: "/tmp/AAVMF_CODE.fd" }),
    hostEffects: {
      createTempDirectory: async (prefix) => `${prefix}full-image`,
      writeFile: async (path, bytes) => {
        writes.push({ path, bytes });
      },
      copyFile: async () => {},
      runProcess: async () => ({
        stdout: "WRELA_UEFI_SMOKE_OK\nWRELA_FULL_IMAGE_SMOKE_OK.wrela-uefi-aarch64-full-image",
        stderr: "",
        timedOut: false,
        cleanupFailed: false,
        missingTools: false,
        terminatedByHarness: true,
      }),
      removeDirectory: async () => {},
    },
  });

  expect(report.status).toBe("passed");
  expect(report.observedMarkers).toEqual([
    "WRELA_UEFI_SMOKE_OK",
    "WRELA_FULL_IMAGE_SMOKE_OK.wrela-uefi-aarch64-full-image",
  ]);
  expect(writes[0]).toEqual({
    path: "wrela-uefi-aarch64-full-image/EFI/WRELA/SMOKEAA64.EFI",
    bytes: [0x4d, 0x5a],
  });
  expect(String.fromCharCode(...(writes[1]?.bytes ?? []))).toContain("\\EFI\\WRELA\\SMOKEAA64.EFI");
});

function qemuConfig(overrides: Partial<UefiAArch64QemuSmokeConfig>): UefiAArch64QemuSmokeConfig {
  return {
    qemuSystemAarch64Path: "/usr/bin/qemu-system-aarch64",
    firmwareCodePath: "/usr/share/AAVMF/AAVMF_CODE.fd",
    machine: "virt",
    cpu: "cortex-a76",
    memoryMiB: 512,
    accel: "tcg",
    ...overrides,
  };
}

function noRunHostEffects(calls: string[]): UefiAArch64QemuHostEffects {
  return {
    createTempDirectory: async () => {
      calls.push("createTempDirectory");
      return "/tmp/full-image";
    },
    writeFile: async () => {
      calls.push("writeFile");
    },
    copyFile: async () => {
      calls.push("copyFile");
    },
    runProcess: async () => {
      calls.push("runProcess");
      return {
        stdout: "",
        stderr: "",
        timedOut: false,
        cleanupFailed: false,
        missingTools: false,
        terminatedByHarness: false,
      };
    },
    removeDirectory: async () => {
      calls.push("removeDirectory");
    },
  };
}
