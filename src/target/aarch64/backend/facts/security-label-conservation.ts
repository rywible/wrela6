import {
  aarch64BackendDiagnostic,
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
} from "../api/diagnostics";

export type AArch64SecurityLabelKind = "no-spill" | "wipe-on-spill" | "secret";

export interface AArch64SecurityLabelImage {
  readonly kind: AArch64SecurityLabelKind;
  readonly subjectKey: string;
  readonly slotKey?: string;
  readonly exitScopeKey?: string;
}

export interface AArch64SecurityPlacement {
  readonly subjectKey: string;
  readonly locationKind: "register" | "stack-slot" | "spill-slot" | "literal-pool" | "memory-remat";
  readonly locationKey: string;
}

export interface AArch64ObservableExit {
  readonly exitKey: string;
  readonly exitKind: "return" | "error" | "tail-call" | "noreturn" | "trap" | "veneer";
}

export interface AArch64SecurityWipeEvent {
  readonly subjectKey: string;
  readonly slotKey: string;
  readonly beforeExitKey: string;
}

export interface AArch64SecretBranchSite {
  readonly branchKey: string;
  readonly conditionSubjectKey: string;
}

export interface AArch64SecretTableAccess {
  readonly tableKey: string;
  readonly indexSubjectKey: string;
}

export interface AArch64HelperCallSecurity {
  readonly helperKey: string;
  readonly argumentSubjectKeys: readonly string[];
}

export interface AArch64SecurityLabelConservationInput {
  readonly labels?: readonly AArch64SecurityLabelImage[];
  readonly placements?: readonly AArch64SecurityPlacement[];
  readonly exits?: readonly AArch64ObservableExit[];
  readonly wipes?: readonly AArch64SecurityWipeEvent[];
  readonly branches?: readonly AArch64SecretBranchSite[];
  readonly tableAccesses?: readonly AArch64SecretTableAccess[];
  readonly helperCalls?: readonly AArch64HelperCallSecurity[];
  readonly constantTimeHelpers?: readonly string[];
}

export type AArch64SecurityLabelConservationResult =
  | { readonly kind: "ok"; readonly diagnostics: readonly AArch64BackendDiagnostic[] }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] };

export function verifyAArch64SecurityLabelConservation(
  input: AArch64SecurityLabelConservationInput,
): AArch64SecurityLabelConservationResult {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const labels = Object.freeze([...(input.labels ?? [])]);
  const noSpill = new Set(labels.filter((label) => label.kind === "no-spill").map(labelSubject));
  const secret = new Set(labels.filter((label) => label.kind === "secret").map(labelSubject));

  for (const placement of input.placements ?? []) {
    if (noSpill.has(placement.subjectKey) && placement.locationKind !== "register") {
      diagnostics.push(
        securityDiagnostic(
          `security:no-spill-memory-placement:${placement.subjectKey}:${placement.locationKind}:${placement.locationKey}`,
          placement.subjectKey,
        ),
      );
    }
  }

  for (const label of labels.filter((candidate) => candidate.kind === "wipe-on-spill")) {
    const slotKey = label.slotKey ?? label.subjectKey;
    for (const exit of input.exits ?? []) {
      if (label.exitScopeKey !== undefined && label.exitScopeKey !== exit.exitKey) continue;
      const hasWipe = (input.wipes ?? []).some(
        (wipe) =>
          wipe.subjectKey === label.subjectKey &&
          wipe.slotKey === slotKey &&
          wipe.beforeExitKey === exit.exitKey,
      );
      if (!hasWipe) {
        diagnostics.push(
          securityDiagnostic(
            `security:wipe-on-spill-missing-before-exit:${label.subjectKey}:${slotKey}:${exit.exitKey}`,
            label.subjectKey,
          ),
        );
      }
    }
  }

  for (const branch of input.branches ?? []) {
    if (secret.has(branch.conditionSubjectKey)) {
      diagnostics.push(
        securityDiagnostic(
          `security:secret-branch-condition:${branch.branchKey}:${branch.conditionSubjectKey}`,
          branch.branchKey,
        ),
      );
    }
  }

  for (const access of input.tableAccesses ?? []) {
    if (secret.has(access.indexSubjectKey)) {
      diagnostics.push(
        securityDiagnostic(
          `security:secret-table-index:${access.tableKey}:${access.indexSubjectKey}`,
          access.tableKey,
        ),
      );
    }
  }

  const helpers = new Set(input.constantTimeHelpers ?? []);
  for (const call of input.helperCalls ?? []) {
    const hasSecretArgument = call.argumentSubjectKeys.some((subjectKey) => secret.has(subjectKey));
    if (hasSecretArgument && !helpers.has(call.helperKey)) {
      diagnostics.push(
        securityDiagnostic(
          `security:secret-helper-not-constant-time:${call.helperKey}`,
          call.helperKey,
        ),
      );
    }
  }

  const sorted = sortAArch64BackendDiagnostics(diagnostics);
  return Object.freeze(
    sorted.length === 0 ? { kind: "ok", diagnostics: [] } : { kind: "error", diagnostics: sorted },
  );
}

function labelSubject(label: AArch64SecurityLabelImage): string {
  return label.subjectKey;
}

function securityDiagnostic(stableDetail: string, ownerKey: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_SECURITY_CONSERVATION_FAILED",
    ownerKey,
    rootCauseKey: "security-label-conservation",
    stableDetail,
  });
}
