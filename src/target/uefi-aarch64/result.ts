import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { UefiAArch64TargetDiagnostic } from "./diagnostics";
import { sortUefiAArch64TargetDiagnostics } from "./diagnostics";

export interface UefiAArch64TargetVerifierRun {
  readonly verifierKey: string;
  readonly runKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail?: string;
}

export interface UefiAArch64TargetVerificationSummary {
  readonly runs: readonly UefiAArch64TargetVerifierRun[];
}

export type UefiAArch64TargetResult<Value> =
  | {
      readonly kind: "ok";
      readonly value: Value;
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
      readonly verification: UefiAArch64TargetVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
      readonly verification: UefiAArch64TargetVerificationSummary;
    };

export function passedVerification(
  verifierKey: string,
  runKey: string,
): UefiAArch64TargetVerificationSummary {
  return Object.freeze({
    runs: Object.freeze([
      Object.freeze({
        verifierKey,
        runKey,
        status: "passed" as const,
      }),
    ]),
  });
}

export function failedVerification(
  verifierKey: string,
  runKey: string,
  stableDetail?: string,
): UefiAArch64TargetVerificationSummary {
  return Object.freeze({
    runs: Object.freeze([
      Object.freeze({
        verifierKey,
        runKey,
        status: "failed" as const,
        stableDetail,
      }),
    ]),
  });
}

export function verificationSummaryFromRuns(
  runs: readonly UefiAArch64TargetVerifierRun[],
): UefiAArch64TargetVerificationSummary {
  return Object.freeze({
    runs: Object.freeze(runs.map((run) => Object.freeze({ ...run }))),
  });
}

export function uefiAArch64Ok<Value>(input: {
  readonly value: Value;
  readonly diagnostics?: readonly UefiAArch64TargetDiagnostic[];
  readonly verification: UefiAArch64TargetVerificationSummary;
}): UefiAArch64TargetResult<Value> {
  return Object.freeze({
    kind: "ok" as const,
    value: input.value,
    diagnostics: sortUefiAArch64TargetDiagnostics(input.diagnostics ?? []),
    verification: input.verification,
  });
}

export function uefiAArch64Error<Value = never>(input: {
  readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
  readonly verification: UefiAArch64TargetVerificationSummary;
}): UefiAArch64TargetResult<Value> {
  return Object.freeze({
    kind: "error" as const,
    diagnostics: sortUefiAArch64TargetDiagnostics(input.diagnostics),
    verification: input.verification,
  });
}

export function finishCatalogAuthentication<Value>(input: {
  readonly verifierKey: string;
  readonly runKey: string;
  readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
  readonly values: readonly Value[];
  readonly sortKey: (value: Value) => string;
}): UefiAArch64TargetResult<readonly Value[]> {
  if (input.diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics: input.diagnostics,
      verification: failedVerification(input.verifierKey, input.runKey),
    });
  }

  return uefiAArch64Ok({
    value: Object.freeze(
      [...input.values].sort((left, right) =>
        compareCodeUnitStrings(input.sortKey(left), input.sortKey(right)),
      ),
    ),
    verification: passedVerification(input.verifierKey, input.runKey),
  });
}

export function isAsciiSymbolName(value: string): boolean {
  return /^[A-Za-z_.$][A-Za-z0-9_.$]*$/.test(value);
}
