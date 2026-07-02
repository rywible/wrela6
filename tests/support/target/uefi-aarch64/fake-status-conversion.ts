import type { UefiAArch64StatusPolicy } from "../../../../src/target/uefi-aarch64/status-conversion";

export type UefiAArch64SourceErrorKind =
  | "loadError"
  | "invalidParameter"
  | "unsupported"
  | "badBufferSize"
  | "bufferTooSmall"
  | "deviceError"
  | "notFound"
  | "aborted"
  | "securityViolation";

export type UefiAArch64SourceEntryResult =
  | { readonly kind: "success" }
  | { readonly kind: "target-error"; readonly errorKind: UefiAArch64SourceErrorKind }
  | { readonly kind: "panic" }
  | { readonly kind: "entry-context-invalid" };

export function mapUefiAArch64EntryResultToStatus(
  result: UefiAArch64SourceEntryResult,
  policy: UefiAArch64StatusPolicy,
): bigint {
  switch (result.kind) {
    case "success":
      return policy.success;
    case "target-error":
      return mapUefiAArch64SourceErrorKindToStatus(result.errorKind, policy);
    case "panic":
      return policy.aborted;
    case "entry-context-invalid":
      return policy.invalidParameter;
  }
}

function mapUefiAArch64SourceErrorKindToStatus(
  errorKind: UefiAArch64SourceErrorKind,
  policy: UefiAArch64StatusPolicy,
): bigint {
  switch (errorKind) {
    case "loadError":
      return policy.loadError;
    case "invalidParameter":
      return policy.invalidParameter;
    case "unsupported":
      return policy.unsupported;
    case "badBufferSize":
      return policy.badBufferSize;
    case "bufferTooSmall":
      return policy.bufferTooSmall;
    case "deviceError":
      return policy.deviceError;
    case "notFound":
      return policy.notFound;
    case "aborted":
      return policy.aborted;
    case "securityViolation":
      return policy.securityViolation;
  }
}
