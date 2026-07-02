import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";

import { nodeUefiAArch64QemuHostEffects } from "../../../../src/target/uefi-aarch64/qemu-smoke-host";

describe("UEFI AArch64 QEMU smoke CLI and host runner", () => {
  test("CLI fails when required QEMU environment is absent", () => {
    const result = spawnSync(process.execPath, ["scripts/smoke-uefi-aarch64.ts"], {
      cwd: process.cwd(),
      env: { PATH: process.env.PATH ?? "" },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "qemu-smoke:missing-env:WRELA_QEMU_AARCH64",
    );
  });

  test("CLI fails when the required prebuilt EFI artifact path is absent", () => {
    const result = spawnSync(process.execPath, ["scripts/smoke-uefi-aarch64.ts"], {
      cwd: process.cwd(),
      env: {
        PATH: process.env.PATH ?? "",
        WRELA_QEMU_AARCH64: "/qemu",
        WRELA_QEMU_AARCH64_EFI_CODE: "/code.fd",
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain(
      "qemu-smoke:missing-env:WRELA_UEFI_AARCH64_SMOKE_EFI",
    );
  });

  test("host runner resolves timeout when a child ignores SIGTERM", async () => {
    const output = await nodeUefiAArch64QemuHostEffects().runProcess(
      {
        artifactName: "ignore-term.efi",
        espImagePath: "",
        executable: process.execPath,
        args: ["--eval", "process.on('SIGTERM', () => {}); setInterval(() => {}, 1000);"],
        expectedConsoleMarkers: [],
        failureConsoleMarkers: [],
        termination: "kill-after-marker",
      },
      20,
    );

    expect(output.timedOut).toBe(true);
    expect(output.terminatedByHarness).toBe(true);
    expect(output.missingTools).toBe(false);
  });
});
