import { stableHash, stableJson } from "../../shared/stable-json";
import { uefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";

const EFI_ERROR_BIT_64 = 1n << 63n;
const STATUS_POLICY_VERIFIER_KEY = "uefi-aarch64.status-conversion";
const STATUS_POLICY_RUN_KEY = "status-policy";

export interface UefiAArch64StatusPolicy {
  readonly success: bigint;
  readonly loadError: bigint;
  readonly invalidParameter: bigint;
  readonly unsupported: bigint;
  readonly badBufferSize: bigint;
  readonly bufferTooSmall: bigint;
  readonly deviceError: bigint;
  readonly notFound: bigint;
  readonly aborted: bigint;
  readonly securityViolation: bigint;
  readonly panicStatus: "aborted";
}

export type UefiAArch64StatusPolicyOverrides = Partial<UefiAArch64StatusPolicy>;

export function efiErrorStatus(value: bigint): bigint {
  if (value <= 0n || value >= EFI_ERROR_BIT_64) {
    throw new RangeError(`EFI error value must be in 1..2^63-1, got ${value}.`);
  }
  return EFI_ERROR_BIT_64 | value;
}

export function canonicalUefiAArch64StatusPolicy(
  overrides: UefiAArch64StatusPolicyOverrides = {},
): UefiAArch64StatusPolicy {
  return Object.freeze({
    success: 0n,
    loadError: efiErrorStatus(1n),
    invalidParameter: efiErrorStatus(2n),
    unsupported: efiErrorStatus(3n),
    badBufferSize: efiErrorStatus(4n),
    bufferTooSmall: efiErrorStatus(5n),
    deviceError: efiErrorStatus(7n),
    notFound: efiErrorStatus(0xen),
    aborted: efiErrorStatus(0x15n),
    securityViolation: efiErrorStatus(0x1an),
    panicStatus: "aborted" as const,
    ...overrides,
  });
}

export function validateUefiAArch64StatusPolicy(
  policy: UefiAArch64StatusPolicy,
): UefiAArch64TargetResult<UefiAArch64StatusPolicy> {
  const malformedConstant = firstMalformedStatusPolicyConstant(policy);
  if (malformedConstant !== undefined) {
    return uefiAArch64Error({
      diagnostics: [
        uefiAArch64TargetDiagnostic({
          code: "UEFI_AARCH64_STATUS_CONVERSION_FAILED",
          ownerKey: STATUS_POLICY_VERIFIER_KEY,
          stableDetail: malformedConstant,
        }),
      ],
      verification: failedVerification(
        STATUS_POLICY_VERIFIER_KEY,
        STATUS_POLICY_RUN_KEY,
        malformedConstant,
      ),
    });
  }

  return uefiAArch64Ok({
    value: policy,
    verification: passedVerification(STATUS_POLICY_VERIFIER_KEY, STATUS_POLICY_RUN_KEY),
  });
}

export function fingerprintUefiAArch64StatusPolicy(policy: UefiAArch64StatusPolicy): string {
  return stableHash(stableJson(policy));
}

function firstMalformedStatusPolicyConstant(policy: UefiAArch64StatusPolicy): string | undefined {
  const expectedConstants = [
    ["success", 0n, "0"],
    ["loadError", efiErrorStatus(1n), "EFIERR(1)"],
    ["invalidParameter", efiErrorStatus(2n), "EFIERR(2)"],
    ["unsupported", efiErrorStatus(3n), "EFIERR(3)"],
    ["badBufferSize", efiErrorStatus(4n), "EFIERR(4)"],
    ["bufferTooSmall", efiErrorStatus(5n), "EFIERR(5)"],
    ["deviceError", efiErrorStatus(7n), "EFIERR(7)"],
    ["notFound", efiErrorStatus(0xen), "EFIERR(14)"],
    ["aborted", efiErrorStatus(0x15n), "EFIERR(21)"],
    ["securityViolation", efiErrorStatus(0x1an), "EFIERR(26)"],
  ] as const;

  for (const [key, expectedValue, expectedDescription] of expectedConstants) {
    if (policy[key] !== expectedValue) {
      return `${key} must equal ${expectedDescription}`;
    }
  }

  if (policy.panicStatus !== "aborted") {
    return "panicStatus must equal aborted";
  }

  return undefined;
}
