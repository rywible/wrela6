import type { UefiAArch64StatusPolicy } from "../../../../src/target/uefi-aarch64/status-conversion";
import type { UefiAArch64EntryWatchdogPolicy } from "../../../../src/target/uefi-aarch64/watchdog-policy";

export interface FakeUefiFirmwareTables {
  readonly systemTable: bigint | null;
  readonly bootServices: bigint | null;
  readonly setWatchdogTimerStatus: bigint;
}

export interface EvaluateUefiAArch64EntryContextInitializationInput {
  readonly firmware: FakeUefiFirmwareTables;
  readonly statusPolicy: UefiAArch64StatusPolicy;
  readonly watchdogPolicy: UefiAArch64EntryWatchdogPolicy;
}

export function fakeFirmwareWithBootServices(
  overrides: Partial<FakeUefiFirmwareTables> = {},
): FakeUefiFirmwareTables {
  return Object.freeze({
    systemTable: 0x1000n,
    bootServices: 0x2000n,
    setWatchdogTimerStatus: 0n,
    ...overrides,
  });
}

export function evaluateUefiAArch64WatchdogDisableResult(
  status: bigint,
  policy: UefiAArch64StatusPolicy,
): { readonly kind: "continue" } | { readonly kind: "return-status"; readonly status: bigint } {
  if (status === policy.success || status === policy.unsupported) {
    return Object.freeze({ kind: "continue" as const });
  }
  return Object.freeze({ kind: "return-status" as const, status });
}

export function evaluateUefiAArch64EntryContextInitialization(
  input: EvaluateUefiAArch64EntryContextInitializationInput,
): { readonly status: bigint; readonly continueFlag: 0n | 1n } {
  if (input.firmware.systemTable === null || input.firmware.bootServices === null) {
    return Object.freeze({ status: input.statusPolicy.invalidParameter, continueFlag: 0n });
  }
  if (input.watchdogPolicy.kind !== "disable-before-source") {
    return Object.freeze({ status: input.statusPolicy.success, continueFlag: 1n });
  }

  const watchdogResult = evaluateUefiAArch64WatchdogDisableResult(
    input.firmware.setWatchdogTimerStatus,
    input.statusPolicy,
  );
  if (watchdogResult.kind === "continue") {
    return Object.freeze({ status: input.statusPolicy.success, continueFlag: 1n });
  }
  return Object.freeze({ status: watchdogResult.status, continueFlag: 0n });
}
