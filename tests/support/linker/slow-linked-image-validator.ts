import { expect } from "bun:test";

import { recomputeLinkedImageContributions } from "../../../src/linker/contribution-recompute";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerResult,
  type LinkerVerificationSummary,
} from "../../../src/linker/diagnostics";
import type {
  AArch64LinkedImageLayout,
  AppliedRelocation,
  ImageBaseRelocation,
  LinkedImageSection,
  ResolvedImageSymbol,
  SectionContribution,
} from "../../../src/linker/linked-image-layout";

const SLOW_VALIDATION_SUMMARY: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "slow-linked-image-validator",
      runKey: "validate-linked-image-layout",
      status: "passed" as const,
    }),
  ]),
});

export function validateLinkedImageLayoutSlowly(
  layout: AArch64LinkedImageLayout,
): LinkerResult<LinkerVerificationSummary> {
  const diagnostics: LinkerDiagnostic[] = [];
  const placement = slowPlacementFor(layout);
  diagnostics.push(...placement.diagnostics);
  diagnostics.push(...slowSymbolDiagnostics(layout, placement.contributionByKey));
  diagnostics.push(...slowRelocationDiagnostics(layout));
  diagnostics.push(...slowBaseRelocationDiagnostics(layout));
  diagnostics.push(...slowEntryDiagnostics(layout));

  if (diagnostics.length > 0) {
    return linkerError({ diagnostics, verification: SLOW_VALIDATION_SUMMARY });
  }

  return linkerOk({
    value: SLOW_VALIDATION_SUMMARY,
    verification: SLOW_VALIDATION_SUMMARY,
  });
}

export function expectSlowLinkedImageValidation(layout: AArch64LinkedImageLayout): void {
  const result = validateLinkedImageLayoutSlowly(layout);
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") {
    throw new Error(
      `expected slow linked image validation to pass: ${result.diagnostics
        .map((diagnostic) => diagnostic.stableDetail)
        .join(", ")}`,
    );
  }
}

interface SlowPlacement {
  readonly contributionByKey: ReadonlyMap<string, SlowContributionPlacement>;
  readonly diagnostics: readonly LinkerDiagnostic[];
}

interface SlowContributionPlacement {
  readonly section: LinkedImageSection;
  readonly contribution: SectionContribution;
  readonly expectedSectionRva: number;
  readonly expectedContributionOffsetBytes: number;
}

function slowPlacementFor(layout: AArch64LinkedImageLayout): SlowPlacement {
  const recomputed = recomputeLinkedImageContributions(layout, {
    detailPrefix: "slow-image-layout",
    ownerKey: "slow-linked-image-validator",
  });
  return Object.freeze({
    contributionByKey: recomputed.contributionByKey,
    diagnostics: recomputed.diagnostics,
  });
}

function slowSymbolDiagnostics(
  layout: AArch64LinkedImageLayout,
  contributionByKey: ReadonlyMap<string, SlowContributionPlacement>,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  for (const symbol of layout.symbols) {
    const placement = contributionByKey.get(symbol.contributionKey);
    if (placement === undefined) continue;
    const expectedRva =
      placement.expectedSectionRva +
      placement.expectedContributionOffsetBytes +
      symbol.objectOffsetBytes;
    if (symbol.rva !== expectedRva) {
      diagnostics.push(
        diagnostic(
          `slow-image-layout:symbol-rva-mismatch:${symbol.symbolKey}:${symbol.rva}:${expectedRva}`,
        ),
      );
    }
  }
  return diagnostics;
}

function slowRelocationDiagnostics(layout: AArch64LinkedImageLayout): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  for (const relocation of layout.appliedRelocations) {
    const target = layout.symbols.find(
      (candidate) => candidate.symbolKey === relocation.targetSymbolKey,
    );
    if (target === undefined) continue;
    const expectedValue = slowRelocationValue(layout, relocation, target);
    if (expectedValue.kind === "error") {
      diagnostics.push(
        diagnostic(
          `slow-image-layout:relocation-value-invalid:${relocation.relocationKey}:${expectedValue.detail}`,
        ),
      );
      continue;
    }
    if (relocation.expectedEncodedValue !== expectedValue.value) {
      diagnostics.push(
        diagnostic(
          `slow-image-layout:relocation-value-mismatch:${relocation.relocationKey}:${relocation.expectedEncodedValue}:${expectedValue.value}`,
        ),
      );
    }
    const actualValue = slowActualRelocationValue(layout, relocation);
    if (actualValue.kind === "error") {
      diagnostics.push(
        diagnostic(
          `slow-image-layout:relocation-bytes-invalid:${relocation.relocationKey}:${actualValue.detail}`,
        ),
      );
      continue;
    }
    const expectedActualValue = BigInt.asUintN(
      slowExpectedRelocationWidthBytes(relocation.family) * 8,
      expectedValue.value,
    );
    if (actualValue.value !== expectedActualValue) {
      diagnostics.push(
        diagnostic(
          `slow-image-layout:relocation-bytes-mismatch:${relocation.relocationKey}:${actualValue.value}:${expectedActualValue}`,
        ),
      );
    }
  }
  return diagnostics;
}

function slowBaseRelocationDiagnostics(
  layout: AArch64LinkedImageLayout,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const expectedBaseRelocations = expectedBaseRelocationByKey(layout);
  const actualBaseRelocations = new Map(
    layout.baseRelocations.map((baseRelocation) => [baseRelocation.stableKey, baseRelocation]),
  );

  for (const [stableKey, expected] of expectedBaseRelocations) {
    const actual = actualBaseRelocations.get(stableKey);
    if (actual === undefined) {
      diagnostics.push(
        diagnostic(
          `slow-image-layout:base-relocation-missing:${expected.sourceRelocationKey}:${stableKey}`,
        ),
      );
      continue;
    }
    if (
      actual.kind !== expected.kind ||
      actual.sectionKey !== expected.sectionKey ||
      actual.rva !== expected.rva ||
      actual.widthBytes !== expected.widthBytes ||
      actual.sourceRelocationKey !== expected.sourceRelocationKey
    ) {
      diagnostics.push(
        diagnostic(`slow-image-layout:base-relocation-mismatch:${stableKey}:${actual.rva}`),
      );
    }
  }

  for (const baseRelocation of layout.baseRelocations) {
    if (!expectedBaseRelocations.has(baseRelocation.stableKey)) {
      diagnostics.push(
        diagnostic(
          `slow-image-layout:base-relocation-extra:${baseRelocation.stableKey}:${baseRelocation.sourceRelocationKey}`,
        ),
      );
    }
    const source = layout.appliedRelocations.find(
      (relocation) => relocation.relocationKey === baseRelocation.sourceRelocationKey,
    );
    if (source === undefined) continue;
    if (
      source.family !== "addr64" ||
      source.patchRva !== baseRelocation.rva ||
      source.patchSectionKey !== baseRelocation.sectionKey ||
      source.baseRelocationKey !== baseRelocation.stableKey
    ) {
      diagnostics.push(
        diagnostic(
          `slow-image-layout:base-relocation-mismatch:${baseRelocation.stableKey}:${baseRelocation.rva}`,
        ),
      );
    }
  }
  return diagnostics;
}

function slowEntryDiagnostics(layout: AArch64LinkedImageLayout): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const loader = layout.symbols.find(
    (symbol) =>
      symbol.binding === "global" && symbol.linkageName === layout.entry.loaderEntryLinkageName,
  );
  if (loader !== undefined && loader.rva !== layout.entry.loaderEntryRva) {
    diagnostics.push(
      diagnostic(
        `slow-image-layout:entry-rva-mismatch:${layout.entry.loaderEntryLinkageName}:${layout.entry.loaderEntryRva}:${loader.rva}`,
      ),
    );
  }
  const boot = layout.symbols.find(
    (symbol) =>
      symbol.binding === "global" && symbol.linkageName === layout.entry.wrelaBootLinkageName,
  );
  if (boot !== undefined && boot.rva !== layout.entry.wrelaBootRva) {
    diagnostics.push(
      diagnostic(
        `slow-image-layout:boot-rva-mismatch:${layout.entry.wrelaBootLinkageName}:${layout.entry.wrelaBootRva}:${boot.rva}`,
      ),
    );
  }
  return diagnostics;
}

function expectedBaseRelocationByKey(
  layout: AArch64LinkedImageLayout,
): ReadonlyMap<string, ImageBaseRelocation> {
  return new Map(
    layout.appliedRelocations
      .filter((relocation) => relocation.family === "addr64")
      .map((relocation) => {
        const stableKey = `base-reloc:dir64:${relocation.patchSectionKey}:${relocation.patchRva}`;
        return [
          stableKey,
          Object.freeze({
            stableKey,
            kind: "dir64" as const,
            sectionKey: relocation.patchSectionKey,
            rva: relocation.patchRva,
            widthBytes: 8,
            sourceRelocationKey: relocation.relocationKey,
          }),
        ] as const;
      }),
  );
}

function slowRelocationValue(
  layout: AArch64LinkedImageLayout,
  relocation: AppliedRelocation,
  targetSymbol: ResolvedImageSymbol,
):
  | { readonly kind: "ok"; readonly value: bigint }
  | { readonly kind: "error"; readonly detail: string } {
  const target = BigInt(targetSymbol.rva) + relocation.addend;
  if (relocation.family === "addr64" || relocation.family === "addr32nb")
    return { kind: "ok", value: target };
  if (relocation.family === "addr32") {
    return { kind: "error", detail: "addr32-absolute-rejected" };
  }
  if (relocation.family === "rel32")
    return { kind: "ok", value: target - BigInt(relocation.patchRva) };
  if (
    relocation.family === "branch26" ||
    relocation.family === "branch19" ||
    relocation.family === "branch14"
  ) {
    const distance = target - BigInt(relocation.patchRva);
    if (distance % 4n !== 0n) {
      return { kind: "error", detail: `unaligned-branch:${distance}` };
    }
    const bounds = branchBounds(relocation.family);
    if (distance < bounds.minimum || distance > bounds.maximum) {
      return { kind: "error", detail: `branch-out-of-range:${distance}` };
    }
    return {
      kind: "ok",
      value: BigInt.asUintN(branchBitWidth(relocation.family), distance / 4n),
    };
  }
  if (relocation.family === "pagebase-rel21")
    return { kind: "ok", value: target / 4096n - BigInt(relocation.patchRva) / 4096n };
  if (relocation.family === "pageoffset-12a") return { kind: "ok", value: target & 0xfffn };
  if (relocation.family === "pageoffset-12l") {
    if (relocation.accessScaleBytes === undefined || relocation.accessScaleBytes <= 0) {
      return { kind: "error", detail: "missing-access-scale" };
    }
    const low12 = target & 0xfffn;
    const scale = BigInt(relocation.accessScaleBytes);
    if (low12 % scale !== 0n) {
      return { kind: "error", detail: `unaligned-low12:${low12}:${relocation.accessScaleBytes}` };
    }
    return { kind: "ok", value: low12 / scale };
  }
  if (relocation.family === "section-relative") {
    const targetSection = layout.sections.find(
      (section) => section.stableKey === targetSymbol.sectionKey,
    );
    return { kind: "ok", value: target - BigInt(targetSection?.rva ?? 0) };
  }
  return { kind: "ok", value: 0n };
}

function branchBitWidth(family: "branch26" | "branch19" | "branch14"): number {
  if (family === "branch26") return 26;
  if (family === "branch19") return 19;
  return 14;
}

function branchBounds(family: "branch26" | "branch19" | "branch14"): {
  readonly minimum: bigint;
  readonly maximum: bigint;
} {
  if (family === "branch26") return { minimum: -134_217_728n, maximum: 134_217_724n };
  if (family === "branch19") return { minimum: -1_048_576n, maximum: 1_048_572n };
  return { minimum: -32_768n, maximum: 32_764n };
}

type SlowActualRelocationValue =
  | { readonly kind: "ok"; readonly value: bigint }
  | { readonly kind: "error"; readonly detail: string };

interface SlowRelocationFieldSlice {
  readonly encodedValueStartBit: number;
  readonly instructionStartBit: number;
  readonly bitCount: number;
}

const SLOW_RELOCATION_FIELD_SLICES = Object.freeze({
  branch26: Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 0, bitCount: 26 }),
  ]),
  branch19: Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 5, bitCount: 19 }),
  ]),
  branch14: Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 5, bitCount: 14 }),
  ]),
  "pagebase-rel21": Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 29, bitCount: 2 }),
    Object.freeze({ encodedValueStartBit: 2, instructionStartBit: 5, bitCount: 19 }),
  ]),
  "pageoffset-12a": Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 10, bitCount: 12 }),
  ]),
  "pageoffset-12l": Object.freeze([
    Object.freeze({ encodedValueStartBit: 0, instructionStartBit: 10, bitCount: 12 }),
  ]),
} satisfies Partial<Record<AppliedRelocation["family"], readonly SlowRelocationFieldSlice[]>>);

type SlowInstructionRelocationFamily = keyof typeof SLOW_RELOCATION_FIELD_SLICES;

function slowActualRelocationValue(
  layout: AArch64LinkedImageLayout,
  relocation: AppliedRelocation,
): SlowActualRelocationValue {
  const section = layout.sections.find(
    (candidate) => candidate.stableKey === relocation.patchSectionKey,
  );
  if (section === undefined) {
    return { kind: "error", detail: `missing-section:${relocation.patchSectionKey}` };
  }
  const offset = relocation.patchRva - section.rva;
  const widthBytes = slowExpectedRelocationWidthBytes(relocation.family);
  if (offset < 0 || offset + widthBytes > section.bytes.length) {
    return { kind: "error", detail: `range:${offset}:${widthBytes}` };
  }
  const bytes = section.bytes.slice(offset, offset + widthBytes);

  if (slowIsInstructionRelocationFamily(relocation.family)) {
    const fieldSlices = SLOW_RELOCATION_FIELD_SLICES[relocation.family];
    if (fieldSlices === undefined || fieldSlices.length === 0) {
      return { kind: "error", detail: `missing-field-slices:${relocation.family}` };
    }
    const word = slowWordToU32Le(bytes);
    let value = 0n;
    for (const slice of fieldSlices) {
      const mask = (1n << BigInt(slice.bitCount)) - 1n;
      const fieldValue = (word >> BigInt(slice.instructionStartBit)) & mask;
      value |= fieldValue << BigInt(slice.encodedValueStartBit);
    }
    return { kind: "ok", value };
  }

  let value = 0n;
  for (let index = 0; index < bytes.length; index += 1) {
    value |= BigInt(bytes[index]! & 0xff) << BigInt(index * 8);
  }
  return { kind: "ok", value };
}

function slowExpectedRelocationWidthBytes(family: AppliedRelocation["family"]): number {
  return family === "addr64" ? 8 : 4;
}

function slowIsInstructionRelocationFamily(
  family: AppliedRelocation["family"],
): family is SlowInstructionRelocationFamily {
  return (
    family === "branch26" ||
    family === "branch19" ||
    family === "branch14" ||
    family === "pagebase-rel21" ||
    family === "pageoffset-12a" ||
    family === "pageoffset-12l"
  );
}

function slowWordToU32Le(bytes: ArrayLike<number>): bigint {
  return BigInt(((bytes[3]! << 24) | (bytes[2]! << 16) | (bytes[1]! << 8) | bytes[0]!) >>> 0);
}

function diagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_IMAGE_LAYOUT_INVALID",
    ownerKey: "slow-linked-image-validator",
    stableDetail,
  });
}
