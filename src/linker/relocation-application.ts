import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import {
  AARCH64_LINK_RELOCATION_BOUNDS,
  AARCH64_V1_ADDR32_ABSOLUTE_ALLOWED,
  expectedAArch64RelocationWidthBytes,
  isAArch64InstructionRelocationFamily,
} from "./aarch64/aarch64-relocation-policy";
import {
  encodeAArch64RelocationValue,
  patchAArch64InstructionRelocation,
} from "./aarch64/aarch64-relocations";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerResult,
  type LinkerVerificationSummary,
} from "./diagnostics";
import type { AArch64LinkerTargetSurface } from "./image-layout-policy";
import type {
  AppliedRelocation,
  ImageBaseRelocation,
  LinkedImageSection,
  ResolvedImageSymbol,
  SectionContribution,
} from "./linked-image-layout";
import type { NormalizedLinkGraph, NormalizedObjectModule } from "./object-normalization";
import type { ResolvedLinkRelocationTarget } from "./symbol-resolution";
import { relocationKeyFor } from "./stable-keys";
import type { AArch64ObjectRelocation } from "../target/aarch64/backend/object/object-module";
import {
  asKnownAArch64RelocationFamily,
  type AArch64InternalRelocationFamily,
} from "../target/aarch64/backend/object/relocation-records";

export interface PlanPairedRelocationsInput {
  readonly graph: NormalizedLinkGraph;
  readonly relocationTargets: readonly ResolvedLinkRelocationTarget[];
}

export interface PlannedRelocationPair {
  readonly stableKey: string;
  readonly pageRelocationKey: string;
  readonly low12RelocationKey: string;
  readonly targetSymbolKey: string;
}

export interface ApplyResolvedRelocationsInput {
  readonly target: AArch64LinkerTargetSurface;
  readonly graph: NormalizedLinkGraph;
  readonly sections: readonly LinkedImageSection[];
  readonly symbols: readonly ResolvedImageSymbol[];
  readonly relocationTargets: readonly ResolvedLinkRelocationTarget[];
  readonly plannedPairs: readonly PlannedRelocationPair[];
}

export interface ApplyResolvedRelocationsOutput {
  readonly sections: readonly LinkedImageSection[];
  readonly appliedRelocations: readonly AppliedRelocation[];
  readonly baseRelocations: readonly ImageBaseRelocation[];
}

interface IndexedRelocation {
  readonly moduleKey: string;
  readonly relocationKey: string;
  readonly relocation: AArch64ObjectRelocation;
}

const RELOCATION_APPLICATION_VERIFICATION: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "linker-relocation-application",
      runKey: "plan-paired-relocations",
      status: "passed" as const,
    }),
  ]),
});

export function planPairedRelocations(
  input: PlanPairedRelocationsInput,
): LinkerResult<readonly PlannedRelocationPair[]> {
  const relocationTargetsByKey = new Map(
    input.relocationTargets.map((target) => [target.relocationKey, target]),
  );
  const diagnostics: LinkerDiagnostic[] = [];
  const pairs: PlannedRelocationPair[] = [];
  const plannedPageRelocationKeys = new Set<string>();

  for (const module of input.graph.modules) {
    const relocationsByObjectKey = relocationsByStableKey(module);
    for (const relocation of module.objectModule.relocations) {
      if (relocation.family !== "pagebase-rel21") continue;

      const page = indexedRelocation(module.moduleKey, relocation);
      const pairDiagnostics: LinkerDiagnostic[] = [];
      const partnerObjectKey = relocation.pairedRelocationKey;
      if (partnerObjectKey === undefined) {
        pairDiagnostics.push(
          relocationDiagnostic(`relocation:pair-missing-key:${page.relocationKey}`),
        );
        diagnostics.push(...pairDiagnostics);
        continue;
      }

      const low12 = relocationsByObjectKey.get(String(partnerObjectKey));
      if (low12 === undefined) {
        pairDiagnostics.push(
          relocationDiagnostic(
            `relocation:pair-partner-missing:${page.relocationKey}:${partnerObjectKey}`,
          ),
        );
        diagnostics.push(...pairDiagnostics);
        continue;
      }

      pairDiagnostics.push(...validatePairFamilies(page, low12));
      pairDiagnostics.push(...validateReciprocalPairKeys(page, low12));
      pairDiagnostics.push(...validateResolvedPairTargets(page, low12, relocationTargetsByKey));
      diagnostics.push(...pairDiagnostics);
      if (pairDiagnostics.length > 0) continue;

      plannedPageRelocationKeys.add(page.relocationKey);
      pairs.push(
        Object.freeze({
          stableKey: `relocation-pair:${page.relocationKey}:${low12.relocationKey}`,
          pageRelocationKey: page.relocationKey,
          low12RelocationKey: low12.relocationKey,
          targetSymbolKey: relocationTargetsByKey.get(page.relocationKey)?.targetSymbolKey ?? "",
        }),
      );
    }
  }

  if (diagnostics.length > 0) {
    return linkerError({
      diagnostics,
      verification: RELOCATION_APPLICATION_VERIFICATION,
    });
  }

  return linkerOk({
    value: Object.freeze(
      pairs
        .filter((pair) => plannedPageRelocationKeys.has(pair.pageRelocationKey))
        .sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
    ),
    verification: RELOCATION_APPLICATION_VERIFICATION,
  });
}

export function applyResolvedRelocations(
  input: ApplyResolvedRelocationsInput,
): LinkerResult<ApplyResolvedRelocationsOutput> {
  const sections = cloneSections(input.sections);
  const sectionByKey = new Map(sections.map((section) => [section.stableKey, section]));
  const symbolsByKey = new Map(input.symbols.map((symbol) => [symbol.symbolKey, symbol]));
  const relocationTargetsByKey = new Map(
    input.relocationTargets.map((target) => [target.relocationKey, target]),
  );
  const pairedRelocationKeys = new Set(
    input.plannedPairs.flatMap((pair) => [pair.pageRelocationKey, pair.low12RelocationKey]),
  );
  const diagnostics: LinkerDiagnostic[] = [];
  const appliedRelocations: AppliedRelocation[] = [];
  const baseRelocations: ImageBaseRelocation[] = [];
  const baseRelocationsByKey = new Map<string, ImageBaseRelocation>();

  for (const indexed of indexedRelocations(input.graph).sort(compareIndexedRelocations)) {
    const relocation = indexed.relocation;
    const family = asKnownAArch64RelocationFamily(relocation.family);
    if (family === undefined || !(family in AARCH64_LINK_RELOCATION_BOUNDS)) {
      diagnostics.push(
        relocationDiagnostic(
          `relocation:unsupported-family:${indexed.relocationKey}:${relocation.family}`,
        ),
      );
      continue;
    }

    if (requiresPlannedPair(family) && !pairedRelocationKeys.has(indexed.relocationKey)) {
      diagnostics.push(
        relocationDiagnostic(`relocation:planned-pair-missing:${indexed.relocationKey}`),
      );
      continue;
    }

    if (family === "addr32" && !AARCH64_V1_ADDR32_ABSOLUTE_ALLOWED) {
      diagnostics.push(
        relocationDiagnostic(`relocation:addr32-not-permitted:${indexed.relocationKey}`),
      );
      continue;
    }

    const context = relocationContext({
      indexed,
      sectionByKey,
      symbolsByKey,
      relocationTargetsByKey,
    });
    if (context.kind === "error") {
      diagnostics.push(context.diagnostic);
      continue;
    }

    const expectedWidthBytes = expectedAArch64RelocationWidthBytes(family);
    if (relocation.widthBytes !== expectedWidthBytes) {
      diagnostics.push(relocationWidthDiagnostic(context.value, family, expectedWidthBytes));
      continue;
    }

    const result = applyRelocation({
      target: input.target,
      family,
      context: context.value,
    });
    if (result.kind === "error") {
      diagnostics.push(result.diagnostic);
      continue;
    }

    if (result.baseRelocation !== undefined) {
      const existingBaseRelocation = baseRelocationsByKey.get(result.baseRelocation.stableKey);
      if (existingBaseRelocation !== undefined) {
        diagnostics.push(
          relocationDiagnostic(
            `relocation:base-relocation-duplicate:${result.baseRelocation.stableKey}:${existingBaseRelocation.sourceRelocationKey}:${result.baseRelocation.sourceRelocationKey}`,
          ),
        );
        continue;
      }
      baseRelocationsByKey.set(result.baseRelocation.stableKey, result.baseRelocation);
      baseRelocations.push(result.baseRelocation);
    }
    appliedRelocations.push(
      Object.freeze({
        relocationKey: indexed.relocationKey,
        sourceModuleKey: indexed.moduleKey,
        family,
        patchSectionKey: context.value.patchSection.stableKey,
        patchRva: context.value.patchRva,
        targetSymbolKey: context.value.targetSymbol.symbolKey,
        targetRva: context.value.targetSymbol.rva,
        addend: relocation.addend,
        ...(relocation.instructionPatch?.encodingOwner?.accessScaleBytes === undefined
          ? {}
          : { accessScaleBytes: relocation.instructionPatch.encodingOwner.accessScaleBytes }),
        expectedEncodedValue: result.expectedEncodedValue,
        patchedBytes: Uint8Array.from(result.patchedBytes),
        ...(result.baseRelocation === undefined
          ? {}
          : { baseRelocationKey: result.baseRelocation.stableKey }),
      }),
    );
  }

  if (diagnostics.length > 0) {
    return linkerError({ diagnostics, verification: RELOCATION_APPLICATION_VERIFICATION });
  }

  return linkerOk({
    value: Object.freeze({
      sections: Object.freeze(sections.map(freezeSection)),
      appliedRelocations: Object.freeze(appliedRelocations.sort(compareAppliedRelocations)),
      baseRelocations: Object.freeze(baseRelocations.sort(compareBaseRelocations)),
    }),
    verification: RELOCATION_APPLICATION_VERIFICATION,
  });
}

function relocationsByStableKey(
  module: NormalizedObjectModule,
): ReadonlyMap<string, IndexedRelocation> {
  return new Map(
    module.objectModule.relocations.map((relocation) => [
      String(relocation.stableKey),
      indexedRelocation(module.moduleKey, relocation),
    ]),
  );
}

interface RelocationApplicationContext {
  readonly indexed: IndexedRelocation;
  readonly patchSection: LinkedImageSection;
  readonly patchContribution: SectionContribution;
  readonly patchRva: number;
  readonly patchOffsetInSection: number;
  readonly targetSymbol: ResolvedImageSymbol;
  readonly targetSection: LinkedImageSection;
}

function indexedRelocations(graph: NormalizedLinkGraph): IndexedRelocation[] {
  return graph.modules.flatMap((module) =>
    module.objectModule.relocations.map((relocation) =>
      indexedRelocation(module.moduleKey, relocation),
    ),
  );
}

function relocationContext(input: {
  readonly indexed: IndexedRelocation;
  readonly sectionByKey: ReadonlyMap<string, LinkedImageSection>;
  readonly symbolsByKey: ReadonlyMap<string, ResolvedImageSymbol>;
  readonly relocationTargetsByKey: ReadonlyMap<string, ResolvedLinkRelocationTarget>;
}):
  | { readonly kind: "ok"; readonly value: RelocationApplicationContext }
  | { readonly kind: "error"; readonly diagnostic: LinkerDiagnostic } {
  const relocation = input.indexed.relocation;
  const relocationTarget = input.relocationTargetsByKey.get(input.indexed.relocationKey);
  if (relocationTarget === undefined) {
    return missingContext(`relocation:target-missing:${input.indexed.relocationKey}`);
  }

  const targetSymbol = input.symbolsByKey.get(relocationTarget.targetSymbolKey);
  if (targetSymbol === undefined) {
    return missingContext(
      `relocation:target-symbol-missing:${input.indexed.relocationKey}:${relocationTarget.targetSymbolKey}`,
    );
  }

  const targetSection = input.sectionByKey.get(targetSymbol.sectionKey);
  if (targetSection === undefined) {
    return missingContext(
      `relocation:target-section-missing:${input.indexed.relocationKey}:${targetSymbol.sectionKey}`,
    );
  }

  const patchContribution = findPatchContribution(
    input.sectionByKey,
    input.indexed.moduleKey,
    String(relocation.sectionKey),
  );
  if (patchContribution === undefined) {
    return missingContext(
      `relocation:patch-contribution-missing:${input.indexed.relocationKey}:${input.indexed.moduleKey}:${String(relocation.sectionKey)}`,
    );
  }

  const patchSection = input.sectionByKey.get(patchContribution.outputSectionKey);
  if (patchSection === undefined) {
    return missingContext(
      `relocation:patch-section-missing:${input.indexed.relocationKey}:${patchContribution.outputSectionKey}`,
    );
  }

  const patchOffsetInSection = patchContribution.offsetBytes + relocation.offsetBytes;
  if (
    patchOffsetInSection < 0 ||
    patchOffsetInSection + relocation.widthBytes > patchSection.bytes.length
  ) {
    return missingContext(
      `relocation:patch-range-missing:${input.indexed.relocationKey}:${patchSection.stableKey}:${patchOffsetInSection}:${relocation.widthBytes}`,
    );
  }

  return {
    kind: "ok",
    value: Object.freeze({
      indexed: input.indexed,
      patchSection,
      patchContribution,
      patchRva: patchSection.rva + patchOffsetInSection,
      patchOffsetInSection,
      targetSymbol,
      targetSection,
    }),
  };
}

function applyRelocation(input: {
  readonly target: AArch64LinkerTargetSurface;
  readonly family: AArch64InternalRelocationFamily;
  readonly context: RelocationApplicationContext;
}):
  | {
      readonly kind: "ok";
      readonly expectedEncodedValue: bigint;
      readonly patchedBytes: Uint8Array;
      readonly baseRelocation?: ImageBaseRelocation;
    }
  | { readonly kind: "error"; readonly diagnostic: LinkerDiagnostic } {
  const relocation = input.context.indexed.relocation;
  const valueInput = {
    family: input.family,
    relocationKey: input.context.indexed.relocationKey,
    symbolRva: BigInt(input.context.targetSymbol.rva),
    patchRva: BigInt(input.context.patchRva),
    addend: relocation.addend,
    preferredImageBase: input.target.constants.preferredImageBase,
    containingSectionRva: BigInt(input.context.targetSection.rva),
    accessScaleBytes: relocation.instructionPatch?.encodingOwner?.accessScaleBytes,
  };

  if (isAArch64InstructionRelocationFamily(input.family)) {
    const bitRange = relocation.instructionPatch?.bitRange;
    if (bitRange === undefined) {
      return {
        kind: "error",
        diagnostic: relocationDiagnostic(
          `relocation:instruction-patch-missing:${input.context.indexed.relocationKey}`,
        ),
      };
    }
    const originalBytes = readPatchBytes(
      input.context.patchSection,
      input.context.patchOffsetInSection,
      4,
    );
    const result = patchAArch64InstructionRelocation({
      ...valueInput,
      originalBytes,
      bitRange,
    });
    if (result.kind === "error") {
      return relocationApplicationError(input.context, input.family, result.diagnostics);
    }
    writePatchBytes(
      input.context.patchSection,
      input.context.patchOffsetInSection,
      result.value.patchedBytes,
    );
    return {
      kind: "ok",
      expectedEncodedValue: result.value.encodedValue,
      patchedBytes: result.value.patchedBytes,
    };
  }

  const result = encodeAArch64RelocationValue(valueInput);
  if (result.kind === "error") {
    return relocationApplicationError(input.context, input.family, result.diagnostics);
  }

  const patchedBytes =
    relocation.widthBytes === 8
      ? writeU64LeBytes(result.value.encodedValue)
      : writeU32LeBytes(result.value.encodedValue);
  writePatchBytes(input.context.patchSection, input.context.patchOffsetInSection, patchedBytes);
  const baseRelocation =
    input.family === "addr64"
      ? Object.freeze({
          stableKey: `base-reloc:dir64:${input.context.patchSection.stableKey}:${input.context.patchRva}`,
          kind: "dir64" as const,
          sectionKey: input.context.patchSection.stableKey,
          rva: input.context.patchRva,
          widthBytes: 8,
          sourceRelocationKey: input.context.indexed.relocationKey,
        })
      : undefined;

  return {
    kind: "ok",
    expectedEncodedValue: result.value.encodedValue,
    patchedBytes,
    baseRelocation,
  };
}

function indexedRelocation(
  moduleKey: string,
  relocation: AArch64ObjectRelocation,
): IndexedRelocation {
  return Object.freeze({
    moduleKey,
    relocationKey: relocationKeyFor(moduleKey, String(relocation.stableKey)),
    relocation,
  });
}

function validatePairFamilies(
  page: IndexedRelocation,
  low12: IndexedRelocation,
): readonly LinkerDiagnostic[] {
  if (
    page.relocation.family === "pagebase-rel21" &&
    (low12.relocation.family === "pageoffset-12a" || low12.relocation.family === "pageoffset-12l")
  ) {
    return Object.freeze([]);
  }

  return Object.freeze([
    relocationDiagnostic(
      `relocation:pair-family-mismatch:${page.relocationKey}:${low12.relocationKey}:${page.relocation.family}:${low12.relocation.family}`,
    ),
  ]);
}

function validateReciprocalPairKeys(
  page: IndexedRelocation,
  low12: IndexedRelocation,
): readonly LinkerDiagnostic[] {
  if (String(low12.relocation.pairedRelocationKey ?? "") === String(page.relocation.stableKey)) {
    return Object.freeze([]);
  }

  return Object.freeze([
    relocationDiagnostic(
      `relocation:pair-reciprocal-mismatch:${page.relocationKey}:${low12.relocationKey}:${String(
        low12.relocation.pairedRelocationKey ?? "<missing>",
      )}`,
    ),
  ]);
}

function validateResolvedPairTargets(
  page: IndexedRelocation,
  low12: IndexedRelocation,
  relocationTargetsByKey: ReadonlyMap<string, ResolvedLinkRelocationTarget>,
): readonly LinkerDiagnostic[] {
  const pageTarget = relocationTargetsByKey.get(page.relocationKey);
  const low12Target = relocationTargetsByKey.get(low12.relocationKey);

  if (pageTarget === undefined) {
    return Object.freeze([relocationDiagnostic(`relocation:target-missing:${page.relocationKey}`)]);
  }
  if (low12Target === undefined) {
    return Object.freeze([
      relocationDiagnostic(`relocation:target-missing:${low12.relocationKey}`),
    ]);
  }
  if (pageTarget.targetSymbolKey === low12Target.targetSymbolKey) return Object.freeze([]);

  return Object.freeze([
    relocationDiagnostic(
      `relocation:pair-target-mismatch:${page.relocationKey}:${low12.relocationKey}`,
    ),
  ]);
}

function cloneSections(sections: readonly LinkedImageSection[]): LinkedImageSection[] {
  return sections.map((section) => ({
    ...section,
    bytes: Uint8Array.from(section.bytes),
    contributions: section.contributions.map((contribution) => Object.freeze({ ...contribution })),
  }));
}

function freezeSection(section: LinkedImageSection): LinkedImageSection {
  return Object.freeze({
    ...section,
    bytes: Uint8Array.from(section.bytes),
    contributions: Object.freeze(
      section.contributions.map((contribution) => Object.freeze({ ...contribution })),
    ),
  });
}

function findPatchContribution(
  sections: ReadonlyMap<string, LinkedImageSection>,
  moduleKey: string,
  objectSectionKey: string,
): SectionContribution | undefined {
  for (const section of sections.values()) {
    const contribution = section.contributions.find(
      (candidate) =>
        candidate.sourceModuleKey === moduleKey &&
        candidate.sourceObjectSectionKey === objectSectionKey,
    );
    if (contribution !== undefined) return contribution;
  }
  return undefined;
}

function requiresPlannedPair(family: AArch64InternalRelocationFamily): boolean {
  return family === "pagebase-rel21" || family === "pageoffset-12a" || family === "pageoffset-12l";
}

function readPatchBytes(
  section: LinkedImageSection,
  offsetBytes: number,
  widthBytes: number,
): Uint8Array {
  return section.bytes.slice(offsetBytes, offsetBytes + widthBytes);
}

function writePatchBytes(
  section: LinkedImageSection,
  offsetBytes: number,
  patchedBytes: ArrayLike<number>,
): void {
  for (let index = 0; index < patchedBytes.length; index += 1) {
    section.bytes[offsetBytes + index] = patchedBytes[index] ?? 0;
  }
}

function writeU32LeBytes(value: bigint): Uint8Array {
  const unsigned = BigInt.asUintN(32, value);
  return Uint8Array.of(
    Number(unsigned & 0xffn),
    Number((unsigned >> 8n) & 0xffn),
    Number((unsigned >> 16n) & 0xffn),
    Number((unsigned >> 24n) & 0xffn),
  );
}

function writeU64LeBytes(value: bigint): Uint8Array {
  const unsigned = BigInt.asUintN(64, value);
  return Uint8Array.of(
    Number(unsigned & 0xffn),
    Number((unsigned >> 8n) & 0xffn),
    Number((unsigned >> 16n) & 0xffn),
    Number((unsigned >> 24n) & 0xffn),
    Number((unsigned >> 32n) & 0xffn),
    Number((unsigned >> 40n) & 0xffn),
    Number((unsigned >> 48n) & 0xffn),
    Number((unsigned >> 56n) & 0xffn),
  );
}

function relocationApplicationError(
  context: RelocationApplicationContext,
  family: AArch64InternalRelocationFamily,
  diagnostics: readonly LinkerDiagnostic[],
): { readonly kind: "error"; readonly diagnostic: LinkerDiagnostic } {
  const sourceDetail = diagnostics[0]?.stableDetail;
  if (sourceDetail !== undefined && !sourceDetail.startsWith("relocation:out-of-range:")) {
    return {
      kind: "error",
      diagnostic: relocationDiagnostic(
        `relocation:encoding-failed:${sourceDetail}:${relocationContextStableDetail(
          context,
          family,
        )}`,
      ),
    };
  }

  return {
    kind: "error",
    diagnostic: relocationDiagnostic(
      `relocation:out-of-range:${relocationContextStableDetail(context, family)}`,
    ),
  };
}

function relocationContextStableDetail(
  context: RelocationApplicationContext,
  family: AArch64InternalRelocationFamily,
): string {
  const bounds = AARCH64_LINK_RELOCATION_BOUNDS[family];
  return `${context.indexed.moduleKey}:${String(context.indexed.relocation.sectionKey)}:${String(
    context.indexed.relocation.stableKey,
  )}:${family}:${context.targetSymbol.symbolKey}:patch-rva:${context.patchRva}:target-rva:${context.targetSymbol.rva}:addend:${context.indexed.relocation.addend}:allowed:${bounds.minimum}..${bounds.maximum}`;
}

function relocationWidthDiagnostic(
  context: RelocationApplicationContext,
  family: AArch64InternalRelocationFamily,
  expectedWidthBytes: number,
): LinkerDiagnostic {
  return relocationDiagnostic(
    `relocation:width-invalid:${context.indexed.moduleKey}:${String(
      context.indexed.relocation.sectionKey,
    )}:${String(context.indexed.relocation.stableKey)}:${family}:${context.targetSymbol.symbolKey}:patch-rva:${context.patchRva}:target-rva:${context.targetSymbol.rva}:addend:${context.indexed.relocation.addend}:width:${context.indexed.relocation.widthBytes}:expected:${expectedWidthBytes}`,
  );
}

function missingContext(stableDetail: string): {
  readonly kind: "error";
  readonly diagnostic: LinkerDiagnostic;
} {
  return { kind: "error", diagnostic: relocationDiagnostic(stableDetail) };
}

function compareIndexedRelocations(left: IndexedRelocation, right: IndexedRelocation): number {
  return compareCodeUnitStrings(left.relocationKey, right.relocationKey);
}

function compareAppliedRelocations(left: AppliedRelocation, right: AppliedRelocation): number {
  return compareCodeUnitStrings(left.relocationKey, right.relocationKey);
}

function compareBaseRelocations(left: ImageBaseRelocation, right: ImageBaseRelocation): number {
  const rvaComparison = left.rva - right.rva;
  if (rvaComparison !== 0) return rvaComparison;

  const sectionComparison = compareCodeUnitStrings(left.sectionKey, right.sectionKey);
  if (sectionComparison !== 0) return sectionComparison;

  const sourceComparison = compareCodeUnitStrings(
    left.sourceRelocationKey,
    right.sourceRelocationKey,
  );
  return sourceComparison === 0
    ? compareCodeUnitStrings(left.stableKey, right.stableKey)
    : sourceComparison;
}

function relocationDiagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_RELOCATION_FAILED",
    ownerKey: "relocation-application",
    stableDetail,
  });
}
