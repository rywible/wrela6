import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import { aarch64BackendVerifierRunKey, type AArch64BackendVerifierRunKey } from "./ids";

export type AArch64BackendVerifierStatus = "passed" | "failed" | "skipped";

export interface AArch64BackendVerifierRun {
  readonly verifierKey: string;
  readonly runKey: AArch64BackendVerifierRunKey;
  readonly status: AArch64BackendVerifierStatus;
  readonly stableDetail?: string;
}

export interface AArch64BackendVerificationSummary {
  readonly runs: readonly AArch64BackendVerifierRun[];
}

export function aarch64BackendVerificationSummary(
  input: {
    readonly runs?: readonly AArch64BackendVerifierRun[];
  } = {},
): AArch64BackendVerificationSummary {
  return Object.freeze({
    runs: Object.freeze(
      [...(input.runs ?? [])]
        .map((run) =>
          Object.freeze({
            verifierKey: run.verifierKey,
            runKey: run.runKey,
            status: run.status,
            ...(run.stableDetail === undefined ? {} : { stableDetail: run.stableDetail }),
          }),
        )
        .sort((left, right) => {
          const verifier = compareCodeUnitStrings(left.verifierKey, right.verifierKey);
          if (verifier !== 0) return verifier;
          return compareCodeUnitStrings(left.runKey, right.runKey);
        }),
    ),
  });
}

export function verifierRun(input: {
  readonly verifierKey: string;
  readonly runKey?: string;
  readonly status?: AArch64BackendVerifierStatus;
  readonly stableDetail?: string;
}): AArch64BackendVerifierRun {
  return Object.freeze({
    verifierKey: input.verifierKey,
    runKey: aarch64BackendVerifierRunKey(input.runKey ?? input.verifierKey),
    status: input.status ?? "passed",
    ...(input.stableDetail === undefined ? {} : { stableDetail: input.stableDetail }),
  });
}
