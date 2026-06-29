import type { OptIrPolicyFactAnswer } from "./local-policy";

export type OptIrPolicyResult = "accepted" | "denied" | "deferred";
export type OptIrPolicyUncertainty = "none" | "conservative" | "missingFact";

export interface OptIrDecisionLogFactUse extends OptIrPolicyFactAnswer {}

export interface OptIrDecisionLogEntry {
  readonly candidateKey: string;
  readonly policyResult: OptIrPolicyResult;
  readonly factsUsed: readonly OptIrDecisionLogFactUse[];
  readonly uncertainty: OptIrPolicyUncertainty;
  readonly stableReason: string;
}

export interface OptIrDecisionLog {
  readonly entries: () => readonly OptIrDecisionLogEntry[];
}

export function optIrDecisionLogEntry(input: OptIrDecisionLogEntry): OptIrDecisionLogEntry {
  if (!isStableKey(input.candidateKey)) {
    throw new Error("candidate key must be a deterministic policy key");
  }
  if (!isStableKey(input.stableReason)) {
    throw new Error("stable reason must be a deterministic policy reason key");
  }
  return Object.freeze({
    candidateKey: input.candidateKey,
    policyResult: input.policyResult,
    factsUsed: Object.freeze(
      [...input.factsUsed]
        .map((fact) => Object.freeze({ ...fact }))
        .sort((left, right) => left.factKey.localeCompare(right.factKey)),
    ),
    uncertainty: input.uncertainty,
    stableReason: input.stableReason,
  });
}

export function appendOptIrDecisionLogEntry(
  log: OptIrDecisionLog | undefined,
  entry: OptIrDecisionLogEntry,
): OptIrDecisionLog {
  const entries = [...(log?.entries() ?? []), entry].sort((left, right) =>
    left.candidateKey.localeCompare(right.candidateKey),
  );
  return Object.freeze({
    entries() {
      return entries.slice();
    },
  });
}

function isStableKey(value: string): boolean {
  return /^[A-Za-z0-9:_./=-]+$/.test(value);
}
