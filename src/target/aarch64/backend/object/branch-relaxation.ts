import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import { stableJson } from "../../../../shared/stable-json";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import {
  AARCH64_BRANCH26_REACH_BYTES,
  aarch64BranchReachBytes,
  isWithinAArch64SignedScaledBranchReach,
  type AArch64ReachBranchKind,
} from "./branch-reach";

export type AArch64BranchSiteKind = AArch64ReachBranchKind;
export type AArch64LayoutGrowthState =
  | "unchanged"
  | "expanded-invert-and-b"
  | "expanded-test-branch-and-b"
  | "veneer-requested"
  | "linker-owned"
  | "range-exhausted";

export interface AArch64BranchRelaxationSite {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly targetKey: string;
  readonly kind: AArch64BranchSiteKind;
  readonly distanceBytes: number;
  readonly previousState?: AArch64LayoutGrowthState;
  readonly veneerPolicy?: "backend-owned" | "linker-owned" | "none";
}

export interface AArch64BranchRelaxationDecision {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly targetKey: string;
  readonly kind: AArch64BranchSiteKind;
  readonly state: AArch64LayoutGrowthState;
  readonly encodedSizeBytes: number;
}

export function relaxAArch64Branches(input: {
  readonly branches: readonly AArch64BranchRelaxationSite[];
}): AArch64BackendResult<readonly AArch64BranchRelaxationDecision[]> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const decisions = [...input.branches]
    .sort(compareBranchSites)
    .map((site): AArch64BranchRelaxationDecision => {
      const state = nextState(site);
      if (state === "range-exhausted") {
        diagnostics.push(rangeExhaustedDiagnostic(site));
      }
      return Object.freeze({
        stableKey: site.stableKey,
        sectionKey: site.sectionKey,
        targetKey: site.targetKey,
        kind: site.kind,
        state,
        encodedSizeBytes: encodedSizeForState(state),
      });
    });

  return diagnostics.length === 0 ? backendOk(Object.freeze(decisions)) : backendError(diagnostics);
}

function nextState(site: AArch64BranchRelaxationSite): AArch64LayoutGrowthState {
  if (site.previousState !== undefined && site.previousState !== "unchanged") {
    if (
      isExpandedState(site.previousState) &&
      !isWithinAArch64SignedScaledBranchReach(site.distanceBytes, AARCH64_BRANCH26_REACH_BYTES)
    ) {
      return "range-exhausted";
    }
    return site.previousState;
  }
  if (
    isWithinAArch64SignedScaledBranchReach(site.distanceBytes, aarch64BranchReachBytes(site.kind))
  ) {
    return "unchanged";
  }
  if (site.kind === "b-cond" || site.kind === "cbz" || site.kind === "cbnz") {
    if (!isWithinAArch64SignedScaledBranchReach(site.distanceBytes, AARCH64_BRANCH26_REACH_BYTES)) {
      return "range-exhausted";
    }
    return "expanded-invert-and-b";
  }
  if (site.kind === "tbz" || site.kind === "tbnz") {
    if (!isWithinAArch64SignedScaledBranchReach(site.distanceBytes, AARCH64_BRANCH26_REACH_BYTES)) {
      return "range-exhausted";
    }
    return "expanded-test-branch-and-b";
  }
  if (site.veneerPolicy === "backend-owned") return "veneer-requested";
  if (site.veneerPolicy === "linker-owned") return "linker-owned";
  return "range-exhausted";
}

function isExpandedState(state: AArch64LayoutGrowthState): boolean {
  return state === "expanded-invert-and-b" || state === "expanded-test-branch-and-b";
}

function encodedSizeForState(state: AArch64LayoutGrowthState): number {
  if (state === "expanded-invert-and-b" || state === "expanded-test-branch-and-b") return 8;
  if (state === "veneer-requested") return 4;
  return 4;
}

function compareBranchSites(
  left: AArch64BranchRelaxationSite,
  right: AArch64BranchRelaxationSite,
): number {
  for (const [leftPart, rightPart] of [
    [left.sectionKey, right.sectionKey],
    [left.stableKey, right.stableKey],
    [left.targetKey, right.targetKey],
  ] as const) {
    const order = compareCodeUnitStrings(leftPart, rightPart);
    if (order !== 0) return order;
  }
  return 0;
}

function rangeExhaustedDiagnostic(site: AArch64BranchRelaxationSite): AArch64BackendDiagnostic {
  return diagnostic(
    `branch-relaxation:range-exhausted:${site.kind}:${site.stableKey}:section:${site.sectionKey}:target:${site.targetKey}`,
    [
      stableJson({
        kind: "branch-relaxation-range-exhausted",
        branchKind: site.kind,
        siteKey: site.stableKey,
        sectionKey: site.sectionKey,
        targetKey: site.targetKey,
      }),
    ],
  );
}

function diagnostic(
  stableDetail: string,
  provenance: readonly string[] = [],
): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_LAYOUT_FIXED_POINT_FAILED",
    stableDetail,
    ownerKey: "branch-relaxation",
    rootCauseKey: stableDetail,
    provenance,
  });
}
