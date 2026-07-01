import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import type { AArch64RelocationCatalog } from "../api/backend-catalog-interfaces";

export type AArch64InternalRelocationFamily =
  | "branch26"
  | "branch19"
  | "branch14"
  | "pagebase-rel21"
  | "pageoffset-12a"
  | "pageoffset-12l"
  | "addr64"
  | "addr32"
  | "addr32nb"
  | "rel32"
  | "section-relative";

export interface AArch64EncodedRelocationHole {
  readonly stableKey: string;
  readonly sectionStableKey: string;
  readonly fragmentStableKey: string;
  readonly patchOffsetBytes: number;
  readonly bitRange: readonly [number, number];
  readonly family: AArch64InternalRelocationFamily;
  readonly targetSymbol: string;
  readonly addend: bigint;
  readonly pairKey?: string;
}

export interface AArch64ObjectRelocationRecord {
  readonly stableKey: string;
  readonly sectionStableKey: string;
  readonly fragmentStableKey: string;
  readonly patchOffsetBytes: number;
  readonly bitRange: readonly [number, number];
  readonly family: AArch64InternalRelocationFamily;
  readonly targetSymbol: string;
  readonly addend: bigint;
  readonly peCoffFamilies: readonly string[];
  readonly pairedRelocationKey?: string;
}

export interface BuildAArch64RelocationRecordsInput {
  readonly relocationCatalog: AArch64RelocationCatalog;
  readonly encodedHoles: readonly AArch64EncodedRelocationHole[];
}

export function buildAArch64RelocationRecords(
  input: BuildAArch64RelocationRecordsInput,
): AArch64BackendResult<readonly AArch64ObjectRelocationRecord[]> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const holes = [...input.encodedHoles].sort(compareHoles);
  const duplicateKeys = new Set<string>();
  const patchOwners = new Set<string>();

  for (const hole of holes) {
    if (duplicateKeys.has(hole.stableKey)) {
      diagnostics.push(diagnostic(`relocation:duplicate-stable-key:${hole.stableKey}`));
    }
    duplicateKeys.add(hole.stableKey);

    const patchKey = `${hole.sectionStableKey}:${hole.fragmentStableKey}:${hole.patchOffsetBytes}:${hole.bitRange[0]}-${hole.bitRange[1]}`;
    if (patchOwners.has(patchKey))
      diagnostics.push(diagnostic(`relocation:duplicate-patch-owner:${patchKey}`));
    patchOwners.add(patchKey);

    const mapping = input.relocationCatalog.mappingFor(hole.family);
    if (mapping === undefined || mapping.peCoffFamilies.length === 0) {
      diagnostics.push(diagnostic(`relocation:missing-pe-coff-mapping:${hole.family}`));
    }
  }

  const pairedKeys = new Map<string, readonly AArch64EncodedRelocationHole[]>();
  for (const hole of holes) {
    if (hole.pairKey === undefined) continue;
    pairedKeys.set(hole.pairKey, [...(pairedKeys.get(hole.pairKey) ?? []), hole]);
  }
  for (const [pairKey, pair] of pairedKeys) {
    if (pair.length !== 2) {
      diagnostics.push(diagnostic(`relocation:paired-count-mismatch:${pairKey}:${pair.length}`));
      continue;
    }
    const left = pair[0];
    const right = pair[1];
    if (left === undefined || right === undefined) continue;
    if (left.targetSymbol !== right.targetSymbol) {
      diagnostics.push(
        diagnostic(
          `relocation:paired-target-mismatch:${pairKey}:${left.targetSymbol}:${right.targetSymbol}`,
        ),
      );
    }
    if (!hasPagebaseAndLow12(pair)) {
      diagnostics.push(diagnostic(`relocation:paired-family-mismatch:${pairKey}`));
    }
  }

  if (diagnostics.length > 0) return backendError(diagnostics);

  const pairPartnerByKey = new Map<string, string>();
  for (const pair of pairedKeys.values()) {
    if (pair.length === 2) {
      const left = pair[0];
      const right = pair[1];
      if (left !== undefined && right !== undefined) {
        pairPartnerByKey.set(left.stableKey, right.stableKey);
        pairPartnerByKey.set(right.stableKey, left.stableKey);
      }
    }
  }

  const records = holes.map((hole) => {
    const mapping = input.relocationCatalog.mappingFor(hole.family);
    return Object.freeze({
      stableKey: hole.stableKey,
      sectionStableKey: hole.sectionStableKey,
      fragmentStableKey: hole.fragmentStableKey,
      patchOffsetBytes: hole.patchOffsetBytes,
      bitRange: hole.bitRange,
      family: hole.family,
      targetSymbol: hole.targetSymbol,
      addend: hole.addend,
      peCoffFamilies: Object.freeze([...(mapping?.peCoffFamilies ?? [])]),
      pairedRelocationKey: pairPartnerByKey.get(hole.stableKey),
    });
  });

  return backendOk(Object.freeze(records));
}

function compareHoles(
  left: AArch64EncodedRelocationHole,
  right: AArch64EncodedRelocationHole,
): number {
  for (const [leftPart, rightPart] of [
    [left.sectionStableKey, right.sectionStableKey],
    [left.fragmentStableKey, right.fragmentStableKey],
    [
      String(left.patchOffsetBytes).padStart(12, "0"),
      String(right.patchOffsetBytes).padStart(12, "0"),
    ],
    [left.family, right.family],
    [left.targetSymbol, right.targetSymbol],
    [left.stableKey, right.stableKey],
  ] as const) {
    const order = compareCodeUnitStrings(leftPart, rightPart);
    if (order !== 0) return order;
  }
  return 0;
}

function hasPagebaseAndLow12(pair: readonly AArch64EncodedRelocationHole[]): boolean {
  const families = new Set(pair.map((hole) => hole.family));
  return (
    families.has("pagebase-rel21") &&
    (families.has("pageoffset-12a") || families.has("pageoffset-12l"))
  );
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_RELOCATION_INVALID",
    stableDetail,
    ownerKey: "relocation",
    rootCauseKey: stableDetail,
  });
}
