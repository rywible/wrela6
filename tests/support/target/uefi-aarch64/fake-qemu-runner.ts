import type { UefiAArch64QemuRunnerOutput } from "../../../../src/target/uefi-aarch64";

export function fakeQemuRunnerOutput(
  overrides: Partial<UefiAArch64QemuRunnerOutput> = {},
): UefiAArch64QemuRunnerOutput {
  return Object.freeze({
    stdout: "",
    stderr: "",
    exitCode: undefined,
    timedOut: false,
    cleanupFailed: false,
    missingTools: false,
    terminatedByHarness: false,
    ...overrides,
  });
}
