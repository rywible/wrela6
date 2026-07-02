import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import type { AArch64RelocationCatalog } from "../api/backend-catalog-interfaces";
import type { AArch64PhysicalOpcode } from "../api/backend-catalog-interfaces";
import {
  aarch64ObjectRelocationId,
  aarch64ObjectSectionId,
  type AArch64ObjectRelocationId,
  type AArch64ObjectSectionId,
} from "../api/ids";

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

export type AArch64InstructionRelocationFamily =
  | "branch26"
  | "branch19"
  | "branch14"
  | "pagebase-rel21"
  | "pageoffset-12a"
  | "pageoffset-12l";

const AARCH64_INTERNAL_RELOCATION_FAMILIES: ReadonlySet<string> = new Set([
  "branch26",
  "branch19",
  "branch14",
  "pagebase-rel21",
  "pageoffset-12a",
  "pageoffset-12l",
  "addr64",
  "addr32",
  "addr32nb",
  "rel32",
  "section-relative",
]);

const AARCH64_INSTRUCTION_RELOCATION_FAMILIES: ReadonlySet<string> = new Set([
  "branch26",
  "branch19",
  "branch14",
  "pagebase-rel21",
  "pageoffset-12a",
  "pageoffset-12l",
]);

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

export interface AArch64ObjectRelocation {
  readonly stableKey: AArch64ObjectRelocationId;
  readonly sectionKey: AArch64ObjectSectionId;
  readonly offsetBytes: number;
  readonly widthBytes: number;
  readonly family: string;
  readonly target: AArch64ObjectRelocationTarget;
  readonly targetSymbol?: string;
  readonly addend: bigint;
  readonly instructionPatch?: AArch64ObjectInstructionPatch;
  readonly pairedRelocationKey?: AArch64ObjectRelocationId;
  readonly linkerVeneer?: AArch64ObjectLinkerVeneerRequest;
}

export type AArch64ObjectRelocationTarget =
  | { readonly kind: "symbol-stable-key"; readonly stableKey: string }
  | { readonly kind: "linkage-name"; readonly linkageName: string };

export interface AArch64ObjectRelocationEncodingOwner {
  readonly opcode: AArch64PhysicalOpcode;
  readonly catalogEntryKey: string;
  readonly accessScaleBytes?: number;
}

export interface AArch64ObjectInstructionPatch {
  readonly bitRange: readonly [number, number];
  readonly encodingOwner?: AArch64ObjectRelocationEncodingOwner;
}

export interface AArch64ObjectLinkerVeneerRequest {
  readonly siteKind: "branch26-call" | "branch26-jump";
  readonly scratchRegisters: readonly string[];
  readonly securityLabels: readonly string[];
  readonly provenanceKeys: readonly string[];
  readonly maxSourceReachBytes: number;
}

export interface AArch64RelocationTargetSymbolCandidate {
  readonly stableKey: string;
  readonly kind?: "local-definition" | "global-definition" | "external-declaration";
  readonly linkageName?: string;
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

export function compatibilityTargetForSymbol(
  targetSymbol: string | undefined,
): AArch64ObjectRelocationTarget | undefined {
  return relocationTargetForSymbolReference({ targetSymbol, symbols: [] });
}

export function compatibilitySymbolForTarget(target: AArch64ObjectRelocationTarget): string {
  return target.kind === "symbol-stable-key" ? target.stableKey : target.linkageName;
}

export function relocationTargetForSymbolReference(input: {
  readonly targetSymbol: string | undefined;
  readonly symbols: readonly AArch64RelocationTargetSymbolCandidate[];
}): AArch64ObjectRelocationTarget | undefined {
  if (input.targetSymbol === undefined) return undefined;
  const symbol = input.symbols.find((candidate) => candidate.stableKey === input.targetSymbol);
  if (symbol?.kind === "local-definition") {
    return Object.freeze({ kind: "symbol-stable-key", stableKey: input.targetSymbol });
  }
  if (symbol?.kind === "global-definition" || symbol?.kind === "external-declaration") {
    return Object.freeze({
      kind: "linkage-name",
      linkageName: symbol.linkageName ?? input.targetSymbol,
    });
  }
  return Object.freeze({ kind: "linkage-name", linkageName: input.targetSymbol });
}

export function relocationTargetsAreEquivalent(
  left: AArch64ObjectRelocationTarget,
  right: AArch64ObjectRelocationTarget,
): boolean {
  return (
    left.kind === right.kind &&
    compatibilitySymbolForTarget(left) === compatibilitySymbolForTarget(right)
  );
}

export function freezeRelocationTarget(
  target: AArch64ObjectRelocationTarget,
): AArch64ObjectRelocationTarget {
  return target.kind === "symbol-stable-key"
    ? Object.freeze({ kind: target.kind, stableKey: target.stableKey })
    : Object.freeze({ kind: target.kind, linkageName: target.linkageName });
}

export function freezeRelocationEncodingOwner(
  encodingOwner: AArch64ObjectRelocationEncodingOwner,
): AArch64ObjectRelocationEncodingOwner {
  return Object.freeze({
    opcode: encodingOwner.opcode,
    catalogEntryKey: encodingOwner.catalogEntryKey,
    ...(encodingOwner.accessScaleBytes === undefined
      ? {}
      : { accessScaleBytes: encodingOwner.accessScaleBytes }),
  });
}

export function freezeRelocationInstructionPatch(
  instructionPatch: AArch64ObjectInstructionPatch,
): AArch64ObjectInstructionPatch {
  return Object.freeze({
    bitRange: Object.freeze([instructionPatch.bitRange[0], instructionPatch.bitRange[1]] as const),
    ...(instructionPatch.encodingOwner === undefined
      ? {}
      : { encodingOwner: freezeRelocationEncodingOwner(instructionPatch.encodingOwner) }),
  });
}

export function asKnownAArch64RelocationFamily(
  family: string,
): AArch64InternalRelocationFamily | undefined {
  return AARCH64_INTERNAL_RELOCATION_FAMILIES.has(family)
    ? (family as AArch64InternalRelocationFamily)
    : undefined;
}

export function isAArch64InstructionRelocationFamily(
  family: string,
): family is AArch64InstructionRelocationFamily {
  return AARCH64_INSTRUCTION_RELOCATION_FAMILIES.has(family);
}

export function expectedAArch64RelocationWidthBytes(
  family: AArch64InternalRelocationFamily,
): number {
  return family === "addr64" ? 8 : 4;
}

export function freezeLinkerVeneerRequest(
  linkerVeneer: AArch64ObjectLinkerVeneerRequest,
): AArch64ObjectLinkerVeneerRequest {
  return Object.freeze({
    siteKind: linkerVeneer.siteKind,
    scratchRegisters: Object.freeze(
      [...linkerVeneer.scratchRegisters].sort(compareCodeUnitStrings),
    ),
    securityLabels: Object.freeze([...linkerVeneer.securityLabels].sort(compareCodeUnitStrings)),
    provenanceKeys: Object.freeze([...linkerVeneer.provenanceKeys].sort(compareCodeUnitStrings)),
    maxSourceReachBytes: linkerVeneer.maxSourceReachBytes,
  });
}

export function aarch64ObjectRelocation(input: {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly offsetBytes: number;
  readonly widthBytes: number;
  readonly family: string;
  readonly target?: AArch64ObjectRelocationTarget;
  readonly targetSymbol?: string;
  readonly addend?: bigint;
  readonly instructionPatch?: AArch64ObjectInstructionPatch;
  readonly bitRange?: readonly [number, number];
  readonly encodingOwner?: AArch64ObjectRelocationEncodingOwner;
  readonly pairedRelocationKey?: string;
  readonly linkerVeneer?: AArch64ObjectLinkerVeneerRequest;
}): AArch64ObjectRelocation {
  if (!Number.isInteger(input.offsetBytes) || input.offsetBytes < 0) {
    throw new RangeError("relocation offset must be a non-negative integer.");
  }
  if (!Number.isInteger(input.widthBytes) || input.widthBytes <= 0) {
    throw new RangeError("relocation width must be a positive integer.");
  }
  const instructionPatch = instructionPatchFromInput(input);
  if (instructionPatch !== undefined && !isValidBitRange(instructionPatch.bitRange)) {
    throw new RangeError("relocation bitRange must be an ordered non-negative integer pair.");
  }
  const target = input.target ?? compatibilityTargetForSymbol(input.targetSymbol);
  if (target === undefined) throw new RangeError("relocation target is required.");
  if (input.addend !== undefined && typeof input.addend !== "bigint") {
    throw new RangeError("relocation addend must be a bigint.");
  }
  if (
    instructionPatch?.encodingOwner?.accessScaleBytes !== undefined &&
    (!Number.isInteger(instructionPatch.encodingOwner.accessScaleBytes) ||
      instructionPatch.encodingOwner.accessScaleBytes <= 0)
  ) {
    throw new RangeError("relocation encodingOwner accessScaleBytes must be a positive integer.");
  }
  if (
    input.linkerVeneer !== undefined &&
    (!Number.isInteger(input.linkerVeneer.maxSourceReachBytes) ||
      input.linkerVeneer.maxSourceReachBytes < 0)
  ) {
    throw new RangeError("relocation linkerVeneer maxSourceReachBytes must be non-negative.");
  }
  if (
    input.linkerVeneer !== undefined &&
    input.linkerVeneer.siteKind !== "branch26-call" &&
    input.linkerVeneer.siteKind !== "branch26-jump"
  ) {
    throw new RangeError("relocation linkerVeneer siteKind must be a known branch26 site.");
  }
  return Object.freeze({
    stableKey: aarch64ObjectRelocationId(input.stableKey),
    sectionKey: aarch64ObjectSectionId(input.sectionKey),
    offsetBytes: input.offsetBytes,
    widthBytes: input.widthBytes,
    family: input.family,
    target: freezeRelocationTarget(target),
    targetSymbol: input.targetSymbol ?? compatibilitySymbolForTarget(target),
    addend: input.addend ?? 0n,
    ...(instructionPatch === undefined
      ? {}
      : { instructionPatch: freezeRelocationInstructionPatch(instructionPatch) }),
    ...(input.pairedRelocationKey === undefined
      ? {}
      : { pairedRelocationKey: aarch64ObjectRelocationId(input.pairedRelocationKey) }),
    ...(input.linkerVeneer === undefined
      ? {}
      : { linkerVeneer: freezeLinkerVeneerRequest(input.linkerVeneer) }),
  });
}

function instructionPatchFromInput(input: {
  readonly instructionPatch?: AArch64ObjectInstructionPatch;
  readonly bitRange?: readonly [number, number];
  readonly encodingOwner?: AArch64ObjectRelocationEncodingOwner;
}): AArch64ObjectInstructionPatch | undefined {
  if (input.instructionPatch !== undefined) return input.instructionPatch;
  if (input.bitRange === undefined && input.encodingOwner === undefined) return undefined;
  if (input.bitRange === undefined) {
    throw new RangeError("relocation instructionPatch bitRange is required when present.");
  }
  return Object.freeze({
    bitRange: input.bitRange,
    ...(input.encodingOwner === undefined ? {} : { encodingOwner: input.encodingOwner }),
  });
}

function isValidBitRange(bitRange: readonly [number, number]): boolean {
  return (
    Number.isInteger(bitRange[0]) &&
    Number.isInteger(bitRange[1]) &&
    bitRange[0] >= 0 &&
    bitRange[1] >= bitRange[0]
  );
}
