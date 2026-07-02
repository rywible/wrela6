import type { UefiAArch64PlatformPrimitiveLowering } from "./platform-catalog";
import { stableHash, stableJson } from "../../shared/stable-json";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";

const WATCHDOG_VERIFIER_KEY = "uefi-aarch64.watchdog-policy";
const SOURCE_MANAGED_PRIMITIVE_ID = "uefi.boot.setWatchdogTimer";

export type UefiAArch64EntryWatchdogPolicy =
  | { readonly kind: "disable-before-source" }
  | { readonly kind: "preserve-firmware-default" }
  | { readonly kind: "source-managed" };

export type UefiAArch64EntryContextOperation =
  | {
      readonly kind: "firmware-call";
      readonly tablePath: { readonly kind: "boot-services"; readonly field: "set-watchdog-timer" };
      readonly arguments: readonly [0n, 0n, 0n, null];
    }
  | { readonly kind: "validate-system-table" }
  | { readonly kind: "validate-boot-services" };

export interface UefiAArch64EntryContextInitializationPlan {
  readonly operations: readonly UefiAArch64EntryContextOperation[];
}

export interface PlanUefiAArch64EntryContextInitializationInput {
  readonly watchdogPolicy: UefiAArch64EntryWatchdogPolicy;
  readonly hasSystemTable: boolean;
  readonly hasBootServices: boolean;
}

export interface ValidateUefiAArch64EntryWatchdogPolicyInput {
  readonly watchdogPolicy: UefiAArch64EntryWatchdogPolicy;
  readonly platformLowerings: readonly UefiAArch64PlatformPrimitiveLowering[];
}

export function planUefiAArch64EntryContextInitialization(
  input: PlanUefiAArch64EntryContextInitializationInput,
): UefiAArch64TargetResult<UefiAArch64EntryContextInitializationPlan> {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  diagnostics.push(...watchdogPolicyKindDiagnostics(input.watchdogPolicy));
  if (!input.hasSystemTable) {
    diagnostics.push(watchdogPolicyDiagnostic("watchdog-policy:missing-system-table"));
  }
  if (!input.hasBootServices) {
    diagnostics.push(watchdogPolicyDiagnostic("watchdog-policy:missing-boot-services"));
  }

  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification(WATCHDOG_VERIFIER_KEY, "plan-entry-context"),
    });
  }

  const operations: UefiAArch64EntryContextOperation[] = [
    Object.freeze({ kind: "validate-system-table" as const }),
    Object.freeze({ kind: "validate-boot-services" as const }),
  ];
  if (input.watchdogPolicy.kind === "disable-before-source") {
    operations.push(
      Object.freeze({
        kind: "firmware-call" as const,
        tablePath: Object.freeze({
          kind: "boot-services" as const,
          field: "set-watchdog-timer" as const,
        }),
        arguments: Object.freeze([0n, 0n, 0n, null] as const),
      }),
    );
  }

  return uefiAArch64Ok({
    value: Object.freeze({ operations: Object.freeze(operations) }),
    verification: passedVerification(WATCHDOG_VERIFIER_KEY, "plan-entry-context"),
  });
}

export function validateUefiAArch64EntryWatchdogPolicy(
  input: ValidateUefiAArch64EntryWatchdogPolicyInput,
): UefiAArch64TargetResult<UefiAArch64EntryWatchdogPolicy> {
  const diagnostics = watchdogPolicyKindDiagnostics(input.watchdogPolicy);
  if (
    input.watchdogPolicy.kind === "source-managed" &&
    !input.platformLowerings.some(
      (lowering) => String(lowering.primitiveId) === SOURCE_MANAGED_PRIMITIVE_ID,
    )
  ) {
    diagnostics.push(
      watchdogPolicyDiagnostic(
        `watchdog-policy:missing-source-managed-primitive:${SOURCE_MANAGED_PRIMITIVE_ID}`,
      ),
    );
  }

  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification(WATCHDOG_VERIFIER_KEY, "validate"),
    });
  }

  return uefiAArch64Ok({
    value: Object.freeze({ ...input.watchdogPolicy }),
    verification: passedVerification(WATCHDOG_VERIFIER_KEY, "validate"),
  });
}

export function fingerprintUefiAArch64WatchdogPolicy(
  policy: UefiAArch64EntryWatchdogPolicy,
): string {
  return stableHash(stableJson(policy));
}

export function watchdogPolicyKindDiagnostics(policy: {
  readonly kind: string;
}): UefiAArch64TargetDiagnostic[] {
  if (
    policy.kind === "disable-before-source" ||
    policy.kind === "preserve-firmware-default" ||
    policy.kind === "source-managed"
  ) {
    return [];
  }
  return [watchdogPolicyDiagnostic(`watchdog-policy:unsupported-kind:${policy.kind}`)];
}

export function watchdogPolicyDiagnostic(stableDetail: string): UefiAArch64TargetDiagnostic {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
    ownerKey: "watchdog-policy",
    stableDetail,
  });
}
