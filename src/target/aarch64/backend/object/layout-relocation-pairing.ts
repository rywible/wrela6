import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64ObjectRelocation,
  type AArch64ObjectRelocation,
  type AArch64ObjectRelocationEncodingOwner,
} from "./object-module";

export interface AArch64LayoutRelocationForPairing extends AArch64ObjectRelocation {
  readonly siteKey: string;
  readonly patchOffsetBytes: number;
  readonly bitRange: readonly [number, number];
}

export function pairAArch64PageRelocations(
  relocations: readonly AArch64LayoutRelocationForPairing[],
): readonly AArch64LayoutRelocationForPairing[] {
  const partnerByStableKey = new Map<string, string>();
  const byPosition = [...relocations].sort(compareRelocationPosition);
  const low12ByPairKey = indexLow12Relocations(byPosition);

  for (const pageRelocation of byPosition) {
    if (
      pageRelocation.family !== "pagebase-rel21" ||
      pageRelocation.pairedRelocationKey !== undefined
    ) {
      continue;
    }

    const candidates = low12ByPairKey.get(relocationPairKey(pageRelocation));
    if (candidates === undefined) continue;
    while (candidates[0] !== undefined && candidates[0].offsetBytes <= pageRelocation.offsetBytes) {
      candidates.shift();
    }
    const partner = candidates.shift();
    if (partner === undefined) continue;

    const pageKey = String(pageRelocation.stableKey);
    const partnerKey = String(partner.stableKey);
    partnerByStableKey.set(pageKey, partnerKey);
    partnerByStableKey.set(partnerKey, pageKey);
  }

  if (partnerByStableKey.size === 0) return relocations;

  return Object.freeze(
    relocations.map((relocation) => {
      const pairedRelocationKey = partnerByStableKey.get(String(relocation.stableKey));
      if (pairedRelocationKey === undefined) return relocation;
      return layoutRelocation({
        stableKey: String(relocation.stableKey),
        siteKey: relocation.siteKey,
        sectionKey: String(relocation.sectionKey),
        offsetBytes: relocation.offsetBytes,
        widthBytes: relocation.widthBytes,
        family: relocation.family,
        target: relocation.target,
        targetSymbol: targetSymbolForLayoutRelocation(relocation),
        addend: relocation.addend,
        bitRange: relocation.bitRange,
        encodingOwner: relocation.instructionPatch?.encodingOwner,
        pairedRelocationKey,
        linkerVeneer: relocation.linkerVeneer,
      });
    }),
  );
}

function indexLow12Relocations(
  byPosition: readonly AArch64LayoutRelocationForPairing[],
): Map<string, AArch64LayoutRelocationForPairing[]> {
  const low12ByPairKey = new Map<string, AArch64LayoutRelocationForPairing[]>();
  for (const relocation of byPosition) {
    if (
      relocation.pairedRelocationKey !== undefined ||
      !isLow12RelocationFamily(relocation.family)
    ) {
      continue;
    }
    const pairKey = relocationPairKey(relocation);
    const candidates = low12ByPairKey.get(pairKey);
    if (candidates === undefined) {
      low12ByPairKey.set(pairKey, [relocation]);
    } else {
      candidates.push(relocation);
    }
  }
  return low12ByPairKey;
}

function relocationPairKey(relocation: AArch64LayoutRelocationForPairing): string {
  return `${String(relocation.sectionKey)}:${targetSymbolForLayoutRelocation(relocation)}`;
}

function layoutRelocation(input: {
  readonly stableKey: string;
  readonly siteKey: string;
  readonly sectionKey: string;
  readonly offsetBytes: number;
  readonly widthBytes: number;
  readonly family: string;
  readonly target: AArch64ObjectRelocation["target"];
  readonly targetSymbol: string;
  readonly addend: bigint;
  readonly bitRange: readonly [number, number];
  readonly encodingOwner?: AArch64ObjectRelocationEncodingOwner;
  readonly pairedRelocationKey: string;
  readonly linkerVeneer?: AArch64ObjectRelocation["linkerVeneer"];
}): AArch64LayoutRelocationForPairing {
  return Object.freeze({
    ...aarch64ObjectRelocation(input),
    siteKey: input.siteKey,
    patchOffsetBytes: input.offsetBytes,
    bitRange: input.bitRange,
  });
}

function compareRelocationPosition(
  left: AArch64LayoutRelocationForPairing,
  right: AArch64LayoutRelocationForPairing,
): number {
  const sectionOrder = compareCodeUnitStrings(String(left.sectionKey), String(right.sectionKey));
  if (sectionOrder !== 0) return sectionOrder;
  const offsetOrder = left.offsetBytes - right.offsetBytes;
  if (offsetOrder !== 0) return offsetOrder;
  return compareCodeUnitStrings(String(left.stableKey), String(right.stableKey));
}

function isLow12RelocationFamily(family: string): boolean {
  return family === "pageoffset-12a" || family === "pageoffset-12l";
}

function targetSymbolForLayoutRelocation(relocation: AArch64LayoutRelocationForPairing): string {
  if (relocation.targetSymbol !== undefined) return relocation.targetSymbol;
  return relocation.target.kind === "linkage-name"
    ? relocation.target.linkageName
    : relocation.target.stableKey;
}
