import { describe, expect, test } from "bun:test";

import {
  canonicalUefiAArch64PlatformLowerings,
  canonicalUefiAArch64StatusPolicy,
  planUefiAArch64EntryContextInitialization,
  validateUefiAArch64EntryWatchdogPolicy,
} from "../../../../src/target/uefi-aarch64";
import { platformPrimitiveId } from "../../../../src/semantic/ids";
import {
  evaluateUefiAArch64EntryContextInitialization,
  evaluateUefiAArch64WatchdogDisableResult,
  fakeFirmwareWithBootServices,
} from "../../../support/target/uefi-aarch64/fake-watchdog-firmware";

describe("UEFI watchdog policy", () => {
  test("plans SetWatchdogTimer disable before source for production default", () => {
    const plan = planUefiAArch64EntryContextInitialization({
      watchdogPolicy: { kind: "disable-before-source" },
      hasSystemTable: true,
      hasBootServices: true,
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") throw new Error("expected watchdog plan");
    expect(plan.value.operations).toContainEqual({
      kind: "firmware-call",
      tablePath: { kind: "boot-services", field: "set-watchdog-timer" },
      arguments: [0n, 0n, 0n, null],
    });
  });

  test("treats success and unsupported as non-fatal", () => {
    const policy = canonicalUefiAArch64StatusPolicy();

    expect(evaluateUefiAArch64WatchdogDisableResult(policy.success, policy)).toEqual({
      kind: "continue",
    });
    expect(evaluateUefiAArch64WatchdogDisableResult(policy.unsupported, policy)).toEqual({
      kind: "continue",
    });
  });

  test("maps device errors before source code runs", () => {
    const policy = canonicalUefiAArch64StatusPolicy();

    expect(evaluateUefiAArch64WatchdogDisableResult(policy.deviceError, policy)).toEqual({
      kind: "return-status",
      status: policy.deviceError,
    });
  });

  test("preserve firmware default emits no automatic watchdog call", () => {
    const plan = planUefiAArch64EntryContextInitialization({
      watchdogPolicy: { kind: "preserve-firmware-default" },
      hasSystemTable: true,
      hasBootServices: true,
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind !== "ok") throw new Error("expected watchdog plan");
    expect(plan.value.operations).toEqual([
      { kind: "validate-system-table" },
      { kind: "validate-boot-services" },
    ]);
  });

  test("source-managed requires the watchdog primitive lowering", () => {
    const lowerings = canonicalUefiAArch64PlatformLowerings().filter(
      (lowering) => String(lowering.primitiveId) !== "uefi.boot.setWatchdogTimer",
    );

    const result = validateUefiAArch64EntryWatchdogPolicy({
      watchdogPolicy: { kind: "source-managed" },
      platformLowerings: lowerings,
    });

    expect(result.kind).toBe("error");
    expect(result.kind === "error" ? result.diagnostics[0]?.stableDetail : undefined).toBe(
      "watchdog-policy:missing-source-managed-primitive:uefi.boot.setWatchdogTimer",
    );
    expect(
      validateUefiAArch64EntryWatchdogPolicy({
        watchdogPolicy: { kind: "source-managed" },
        platformLowerings: [
          ...lowerings,
          {
            primitiveId: platformPrimitiveId("uefi.boot.setWatchdogTimer"),
            semanticPrimitiveFingerprint: "test",
            lowering: {
              kind: "firmware-call",
              tablePath: { kind: "boot-services", field: "set-watchdog-timer" },
              arguments: [],
              result: { kind: "efi-status" },
            },
          },
        ],
      }).kind,
    ).toBe("ok");
  });

  test("entry context validation returns invalid parameter for null table pointers", () => {
    const statusPolicy = canonicalUefiAArch64StatusPolicy();

    expect(
      evaluateUefiAArch64EntryContextInitialization({
        firmware: fakeFirmwareWithBootServices({ systemTable: null }),
        statusPolicy,
        watchdogPolicy: { kind: "disable-before-source" },
      }),
    ).toEqual({ status: statusPolicy.invalidParameter, continueFlag: 0n });

    expect(
      evaluateUefiAArch64EntryContextInitialization({
        firmware: fakeFirmwareWithBootServices({ bootServices: null }),
        statusPolicy,
        watchdogPolicy: { kind: "disable-before-source" },
      }),
    ).toEqual({ status: statusPolicy.invalidParameter, continueFlag: 0n });
  });
});
