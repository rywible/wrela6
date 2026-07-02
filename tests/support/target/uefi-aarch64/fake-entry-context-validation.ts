import type { UefiAArch64StatusPolicy } from "../../../../src/target/uefi-aarch64/status-conversion";

export type UefiAArch64EntryContextValidationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "return-status"; readonly status: bigint };

export function evaluateUefiAArch64EntryContextValidation(input: {
  readonly systemTable: bigint | null;
  readonly policy: UefiAArch64StatusPolicy;
}): UefiAArch64EntryContextValidationResult {
  if (input.systemTable === null) {
    return Object.freeze({ kind: "return-status" as const, status: input.policy.invalidParameter });
  }
  return Object.freeze({ kind: "ok" as const });
}
