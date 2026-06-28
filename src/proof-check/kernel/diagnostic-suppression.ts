import { sortProofCheckDiagnostics, type ProofCheckDiagnostic } from "../diagnostics";
import type {
  ProofCheckDiagnosticSuppressionHooks,
  ProofCheckSuppressionCandidate,
} from "./graph-worklist";

export interface ProofCheckSuppressionRecord {
  readonly suppressedRootCauseKey: string;
  readonly suppressingRootCauseKey: string;
}

export interface ApplyProofCheckDiagnosticSuppressionInput {
  readonly diagnostics: readonly ProofCheckDiagnostic[];
  readonly suppressionCandidates: readonly ProofCheckSuppressionCandidate[];
}

export interface ApplyProofCheckDiagnosticSuppressionResult {
  readonly publicDiagnostics: readonly ProofCheckDiagnostic[];
  readonly suppressionRecords: readonly ProofCheckSuppressionRecord[];
}

function computeSuppressedRootCauseKeys(input: {
  readonly diagnostics: readonly ProofCheckDiagnostic[];
  readonly suppressionCandidates: readonly ProofCheckSuppressionCandidate[];
}): ReadonlySet<string> {
  const diagnosticRootCauseKeys = new Set(
    input.diagnostics.map((diagnostic) => diagnostic.rootCauseKey),
  );
  const suppressed = new Set<string>();
  let changed = true;

  while (changed) {
    changed = false;
    for (const candidate of input.suppressionCandidates) {
      if (candidate.rootCauseKey === candidate.suppressedRootCauseKey) {
        continue;
      }
      if (!diagnosticRootCauseKeys.has(candidate.rootCauseKey)) {
        continue;
      }
      if (suppressed.has(candidate.rootCauseKey)) {
        continue;
      }
      if (suppressed.has(candidate.suppressedRootCauseKey)) {
        continue;
      }
      suppressed.add(candidate.suppressedRootCauseKey);
      changed = true;
    }
  }

  return suppressed;
}

export function applyProofCheckDiagnosticSuppression(
  input: ApplyProofCheckDiagnosticSuppressionInput,
): ApplyProofCheckDiagnosticSuppressionResult {
  const suppressedRootCauseKeys = computeSuppressedRootCauseKeys({
    diagnostics: input.diagnostics,
    suppressionCandidates: input.suppressionCandidates,
  });

  const suppressionRecords: ProofCheckSuppressionRecord[] = [];
  const publicDiagnostics: ProofCheckDiagnostic[] = [];

  for (const diagnostic of sortProofCheckDiagnostics(input.diagnostics)) {
    if (suppressedRootCauseKeys.has(diagnostic.rootCauseKey)) {
      const suppressingCandidate = input.suppressionCandidates.find(
        (candidate) =>
          candidate.suppressedRootCauseKey === diagnostic.rootCauseKey &&
          !suppressedRootCauseKeys.has(candidate.rootCauseKey),
      );
      if (suppressingCandidate !== undefined) {
        suppressionRecords.push({
          suppressedRootCauseKey: diagnostic.rootCauseKey,
          suppressingRootCauseKey: suppressingCandidate.rootCauseKey,
        });
      }
      continue;
    }
    publicDiagnostics.push(diagnostic);
  }

  return {
    publicDiagnostics,
    suppressionRecords,
  };
}

export function proofCheckDiagnosticSuppressionHooks(): ProofCheckDiagnosticSuppressionHooks {
  return {
    filterPublicDiagnostics: (input) =>
      applyProofCheckDiagnosticSuppression({
        diagnostics: input.diagnostics,
        suppressionCandidates: input.suppressionCandidates,
      }).publicDiagnostics,
  };
}
