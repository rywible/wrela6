import type { AArch64BranchSiteKind, AArch64LayoutGrowthState } from "./branch-relaxation";
import { aarch64BranchReachBytes } from "./branch-reach";
import type { AArch64ObjectRelocation } from "./object-module";

export interface AArch64LinkerVeneerLayoutInstruction {
  readonly stableKey: string;
  readonly provenanceSource?: string;
  readonly branch?: {
    readonly kind: AArch64BranchSiteKind;
  };
  readonly veneerSite?: {
    readonly requestedScratchGprs: readonly string[];
  };
  readonly security?: {
    readonly branchConditionSubjectKey?: string;
    readonly tableIndexSubjectKey?: string;
    readonly helperArgumentSubjectKeys?: readonly string[];
  };
}

export function linkerVeneerRequestForInstruction(
  instruction: AArch64LinkerVeneerLayoutInstruction,
  branchState: AArch64LayoutGrowthState | undefined,
): AArch64ObjectRelocation["linkerVeneer"] {
  if (branchState !== "linker-owned" || instruction.branch === undefined) return undefined;
  const siteKind = linkerVeneerSiteKind(instruction.branch.kind);
  if (siteKind === undefined) return undefined;
  return {
    siteKind,
    scratchRegisters: instruction.veneerSite?.requestedScratchGprs ?? [],
    securityLabels: securityLabelsForInstruction(instruction),
    provenanceKeys: [instruction.provenanceSource ?? instruction.stableKey],
    maxSourceReachBytes: aarch64BranchReachBytes(instruction.branch.kind),
  };
}

function linkerVeneerSiteKind(
  branchKind: AArch64BranchSiteKind,
): NonNullable<AArch64ObjectRelocation["linkerVeneer"]>["siteKind"] | undefined {
  if (branchKind === "bl") return "branch26-call";
  if (branchKind === "b") return "branch26-jump";
  return undefined;
}

function securityLabelsForInstruction(
  instruction: AArch64LinkerVeneerLayoutInstruction,
): readonly string[] {
  const security = instruction.security;
  if (security === undefined) return Object.freeze([]);
  return Object.freeze(
    [
      security.branchConditionSubjectKey,
      security.tableIndexSubjectKey,
      ...(security.helperArgumentSubjectKeys ?? []),
    ].filter((label): label is string => label !== undefined),
  );
}
