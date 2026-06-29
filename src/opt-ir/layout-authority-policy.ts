import type {
  CheckedFactDependency,
  CheckedFactKindId,
  CheckedFactPacketEntry,
  CheckedFactSubject,
} from "../proof-check/model/fact-packet";
import type { CheckedOptIrHandoff } from "../proof-check/model/opt-ir-handoff";
import type { ProofAuthorityFingerprint } from "../shared/proof-authority-types";
import { proofAuthorityFingerprintsEqual } from "../shared/proof-authority-types";
import { authenticatedLayoutFactKeySet } from "./layout-fact-keys";

export interface OptIrLayoutAuthorityPolicy {
  readonly authenticatedKeys: ReadonlySet<string>;
  readonly fingerprintAttested: (fingerprint: ProofAuthorityFingerprint) => boolean;
}

export function optIrLayoutAuthorityPolicy(input: {
  readonly layoutFacts: unknown;
  readonly authorityFingerprints: readonly ProofAuthorityFingerprint[];
  readonly layoutFingerprint: ProofAuthorityFingerprint;
}): OptIrLayoutAuthorityPolicy {
  return {
    authenticatedKeys: authenticatedLayoutFactKeySet(input.layoutFacts),
    fingerprintAttested(fingerprint) {
      return input.authorityFingerprints.some((candidate) =>
        proofAuthorityFingerprintsEqual(candidate, fingerprint),
      );
    },
  };
}

export function optIrLayoutAuthorityPolicyFromHandoff(input: {
  readonly handoff: CheckedOptIrHandoff;
  readonly layoutFacts: unknown;
  readonly layoutFingerprint: ProofAuthorityFingerprint;
}): OptIrLayoutAuthorityPolicy {
  return optIrLayoutAuthorityPolicy({
    layoutFacts: input.layoutFacts,
    authorityFingerprints: input.handoff.packetValidation.authorityFingerprints,
    layoutFingerprint: input.layoutFingerprint,
  });
}

type LayoutFactEntry = CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>;

export function factEntryReferencesLayout(entry: LayoutFactEntry): boolean {
  return (
    entry.subject.kind === "layout" ||
    entry.dependencies.some((dependency) => dependency.kind === "layoutFact") ||
    entry.invalidatedBy.some((invalidation) => invalidation.kind === "abiRewrite")
  );
}

export function layoutDependencyKeys(entry: LayoutFactEntry): readonly string[] {
  const keys: string[] = [];
  if (entry.subject.kind === "layout") {
    keys.push(String(entry.subject.layoutKey));
  }
  for (const dependency of entry.dependencies) {
    if (dependency.kind === "layoutFact") {
      keys.push(String(dependency.layoutKey));
    }
  }
  for (const invalidation of entry.invalidatedBy) {
    if (invalidation.kind === "abiRewrite") {
      keys.push(String(invalidation.layoutKey));
    }
  }
  return keys;
}

export function layoutDependencyMissing(
  dependency: CheckedFactDependency,
  authenticatedKeys: ReadonlySet<string>,
): boolean {
  return dependency.kind === "layoutFact" && !authenticatedKeys.has(String(dependency.layoutKey));
}
