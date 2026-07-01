import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";

export interface AArch64VeneerSite {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly targetKey: string;
  readonly relocationFamily: string;
  readonly policy: "backend-owned" | "linker-owned";
  readonly predeclaredScratchGprs: readonly string[];
  readonly requestedScratchGprs: readonly string[];
  readonly rangeProof: "in-range" | "out-of-range";
  readonly securityLabel?: "public" | "secret";
}

export interface AArch64VeneerPlanRecord {
  readonly stableKey: string;
  readonly siteKey: string;
  readonly sectionKey: string;
  readonly targetKey: string;
  readonly relocationFamily: string;
  readonly ownership: "backend-owned" | "linker-owned";
  readonly scratchGprs: readonly string[];
}

export function planAArch64Veneers(input: {
  readonly sites: readonly AArch64VeneerSite[];
}): AArch64BackendResult<readonly AArch64VeneerPlanRecord[]> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const records: AArch64VeneerPlanRecord[] = [];

  for (const site of [...input.sites].sort(compareSites)) {
    const declared = new Set(site.predeclaredScratchGprs);
    for (const scratch of site.requestedScratchGprs) {
      if (!declared.has(scratch)) {
        diagnostics.push(diagnostic(`veneer:undeclared-scratch:${site.stableKey}:${scratch}`));
      }
    }
    if (site.securityLabel === "secret" && site.policy === "linker-owned") {
      diagnostics.push(diagnostic(`veneer:secret-linker-owned-rejected:${site.stableKey}`));
    }
    if (site.rangeProof === "in-range") continue;
    records.push(
      Object.freeze({
        stableKey: `veneer:${site.stableKey}`,
        siteKey: site.stableKey,
        sectionKey: site.sectionKey,
        targetKey: site.targetKey,
        relocationFamily: site.relocationFamily,
        ownership: site.policy,
        scratchGprs: Object.freeze([...site.requestedScratchGprs].sort(compareCodeUnitStrings)),
      }),
    );
  }

  return diagnostics.length === 0 ? backendOk(Object.freeze(records)) : backendError(diagnostics);
}

function compareSites(left: AArch64VeneerSite, right: AArch64VeneerSite): number {
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

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_LAYOUT_FIXED_POINT_FAILED",
    stableDetail,
    ownerKey: "veneer",
    rootCauseKey: stableDetail,
  });
}
