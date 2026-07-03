import { parsePeCoffImage, type ParsedPeCoffImage } from "../../pe-coff";
import type { AArch64LinkedImageLayout } from "../../linker";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type {
  CompileUefiAArch64ImageTrace,
  UefiAArch64ImageArtifact,
} from "../../target/uefi-aarch64";
import type {
  FullImageValidationCheckReport,
  FullImageValidationEvidenceAuthority,
  FullImageValidationEvidenceRecord,
} from "./report";

const FORBIDDEN_REFERENCE_PATTERNS = ["stdlib/wrela-std", "src/wrela-std", "/tmp/", "/var/tmp/"];

export interface FullImageSelfContainedCheckInput {
  readonly artifact: UefiAArch64ImageArtifact;
  readonly trace: CompileUefiAArch64ImageTrace;
}

export function checkFullImageSelfContained(
  input: FullImageSelfContainedCheckInput,
): readonly FullImageValidationCheckReport[] {
  const parsed = parsePeCoffImage(input.artifact.peCoffArtifact.bytes);
  if (parsed.kind === "error") {
    return Object.freeze([
      report({
        checkerKey: "self-contained.pe-parse",
        status: "failed",
        stableDetail: `self-contained:pe-parse:failed:${parsed.diagnostics[0]?.stableDetail ?? "parse-failed"}`,
        authority: ["final-bytes"],
        evidence: evidence(
          "pe-parse",
          "final-bytes",
          "parsePeCoffImage:artifact.peCoffArtifact.bytes",
        ),
      }),
    ]);
  }

  const layout = input.trace.binarySpine.linkedLayout;
  return Object.freeze([
    objectModuleReport(input),
    unresolvedExternalReport(layout),
    runtimeHelperReport(input),
    entryReport(input),
    hostReferenceReport(layout),
    sectionRangeReport(layout, parsed.value),
  ]);
}

function objectModuleReport(
  input: FullImageSelfContainedCheckInput,
): FullImageValidationCheckReport {
  const binarySpine = input.trace.binarySpine;
  const staticChar16Required =
    input.trace.packagePipeline.optIr.staticChar16Pointers.length > 0 ||
    input.trace.packagePipeline.optIr.staticChar16Strings.length > 0;
  const missing = [
    [binarySpine.backendObjects.length > 0, "backendObjects"],
    [!staticChar16Required || binarySpine.staticChar16Objects.length > 0, "staticChar16Objects"],
    [binarySpine.helperObjects.length > 0, "helperObjects"],
    [hasSyntheticModule(binarySpine.linkedLayout, "entry"), "syntheticEntryObject"],
    [hasSyntheticModule(binarySpine.linkedLayout, "unwind"), "syntheticUnwindObject"],
  ]
    .filter(([present]) => !present)
    .map(([, key]) => key);
  return report({
    checkerKey: "self-contained.object-modules",
    status: missing.length === 0 ? "passed" : "failed",
    stableDetail:
      missing.length === 0
        ? "self-contained:object-modules:compiler-owned"
        : `self-contained:object-modules:missing:${missing.join(",")}`,
    authority: ["compiler-trace", "linked-layout"],
    evidence: [
      evidence("backend-objects", "compiler-trace", moduleKeys(binarySpine.backendObjects)),
      evidence(
        "static-char16-objects",
        "compiler-trace",
        moduleKeys(binarySpine.staticChar16Objects),
      ),
      evidence(
        "validation-fixture-objects",
        "compiler-trace",
        moduleKeys(binarySpine.validationFixtureObjects),
      ),
      evidence("helper-objects", "compiler-trace", moduleKeys(binarySpine.helperObjects)),
      evidence(
        "linked-input-modules",
        "linked-layout",
        moduleKeys(binarySpine.linkedLayout.inputModules),
      ),
    ],
  });
}

function unresolvedExternalReport(
  layout: AArch64LinkedImageLayout,
): FullImageValidationCheckReport {
  const unresolvedNames = unresolvedExternalNames(layout);
  if (unresolvedNames.length > 0) {
    return report({
      checkerKey: "self-contained.unresolved-externals",
      status: "failed",
      stableDetail: `self-contained:unresolved-externals:present:${unresolvedNames.join(",")}`,
      authority: ["linked-layout"],
      evidence: evidence("linked-names", "linked-layout", unresolvedNames.join(",")),
    });
  }
  return report({
    checkerKey: "self-contained.unresolved-externals",
    status: "passed",
    stableDetail: "self-contained:unresolved-externals:none",
    authority: ["linked-layout"],
    evidence: evidence(
      "linked-symbol-scan",
      "linked-layout",
      `symbols:${layout.symbols.length}:applied-relocations:${layout.appliedRelocations.length}`,
    ),
  });
}

function unresolvedExternalNames(layout: AArch64LinkedImageLayout): readonly string[] {
  return Object.freeze(
    layout.symbols
      .filter(
        (symbol) =>
          symbol.sectionKey === "<external>" ||
          symbol.contributionKey === "<external>" ||
          /extern|unresolved|missing/i.test(symbol.symbolKey),
      )
      .map((symbol) => symbol.linkageName ?? symbol.symbolKey)
      .sort(compareCodeUnitStrings),
  );
}

function runtimeHelperReport(
  input: FullImageSelfContainedCheckInput,
): FullImageValidationCheckReport {
  const count = input.trace.binarySpine.helperObjects.length;
  return report({
    checkerKey: "self-contained.runtime-helpers",
    status: count > 0 ? "passed" : "failed",
    stableDetail:
      count > 0
        ? `self-contained:runtime-helpers:present:${count}`
        : "self-contained:runtime-helpers:missing",
    authority: ["compiler-trace"],
    evidence: evidence(
      "helper-objects",
      "compiler-trace",
      moduleKeys(input.trace.binarySpine.helperObjects),
    ),
  });
}

function entryReport(input: FullImageSelfContainedCheckInput): FullImageValidationCheckReport {
  const entry = input.trace.binarySpine.linkedLayout.entry;
  const expectedBoot = input.trace.target.entryProfile.bootFunctionSymbol;
  const hasBootSymbol = input.trace.binarySpine.linkedLayout.symbols.some(
    (symbol) => symbol.linkageName === expectedBoot,
  );
  const passed = entry.wrelaBootLinkageName === expectedBoot && hasBootSymbol;
  return report({
    checkerKey: "self-contained.entry",
    status: passed ? "passed" : "failed",
    stableDetail: passed
      ? `self-contained:entry:${entry.loaderEntryLinkageName}:${entry.wrelaBootLinkageName}`
      : `self-contained:entry:mismatch:${entry.loaderEntryLinkageName}:${entry.wrelaBootLinkageName}:${expectedBoot}`,
    authority: ["compiler-trace", "linked-layout"],
    evidence: [
      evidence(
        "entry-layout",
        "linked-layout",
        `${entry.loaderEntryLinkageName}:${entry.loaderEntryRva}:${entry.wrelaBootLinkageName}:${entry.wrelaBootRva}`,
      ),
      evidence("target-boot-symbol", "compiler-trace", expectedBoot),
    ],
  });
}

function hostReferenceReport(layout: AArch64LinkedImageLayout): FullImageValidationCheckReport {
  const names = linkedNames(layout);
  const bad = names.find((name) =>
    FORBIDDEN_REFERENCE_PATTERNS.some((pattern) => name.includes(pattern)),
  );
  return report({
    checkerKey: "self-contained.host-references",
    status: bad === undefined ? "passed" : "failed",
    stableDetail:
      bad === undefined
        ? "self-contained:host-references:none"
        : `self-contained:host-references:forbidden:${bad}`,
    authority: ["linked-layout"],
    evidence: evidence("linked-name-scan", "linked-layout", `names:${names.length}`),
  });
}

function sectionRangeReport(
  layout: AArch64LinkedImageLayout,
  image: ParsedPeCoffImage,
): FullImageValidationCheckReport {
  const mismatches = layout.sections
    .map((section) => {
      const parsed = image.sectionHeaders.find((candidate) => candidate.name === section.stableKey);
      if (parsed === undefined) return `missing:${section.stableKey}`;
      if (parsed.rva !== section.rva || parsed.virtualSizeBytes !== section.virtualSizeBytes) {
        return `range:${section.stableKey}:${section.rva}:${section.virtualSizeBytes}:${parsed.rva}:${parsed.virtualSizeBytes}`;
      }
      return undefined;
    })
    .filter((detail): detail is string => detail !== undefined);
  return report({
    checkerKey: "self-contained.section-ranges",
    status: mismatches.length === 0 ? "passed" : "failed",
    stableDetail:
      mismatches.length === 0
        ? `self-contained:section-ranges:matched:${layout.sections.length}`
        : `self-contained:section-ranges:mismatch:${mismatches.join(",")}`,
    authority: ["final-bytes", "linked-layout"],
    evidence: [
      evidence("linked-sections", "linked-layout", sectionRanges(layout)),
      evidence(
        "parsed-sections",
        "final-bytes",
        image.sectionHeaders
          .map((section) => `${section.name}:${section.rva}:${section.virtualSizeBytes}`)
          .join(","),
      ),
    ],
  });
}

function hasSyntheticModule(layout: AArch64LinkedImageLayout, namePart: string): boolean {
  return layout.inputModules.some(
    (module) =>
      module.syntheticProviderKey?.includes(namePart) === true ||
      module.moduleKey.includes(`synthetic-${namePart}`),
  );
}

function linkedNames(layout: AArch64LinkedImageLayout): readonly string[] {
  return Object.freeze(
    [
      ...layout.inputModules.flatMap((module) => [
        module.moduleKey,
        module.syntheticProviderKey ?? "",
      ]),
      ...layout.sections.flatMap((section) => [
        section.stableKey,
        section.classKey,
        ...section.contributions.flatMap((contribution) => [
          contribution.stableKey,
          contribution.sourceModuleKey,
          contribution.sourceObjectSectionKey,
          contribution.outputSectionKey,
        ]),
      ]),
      ...layout.symbols.flatMap((symbol) => [
        symbol.symbolKey,
        symbol.linkageName ?? "",
        symbol.sourceModuleKey,
        symbol.sectionKey,
        symbol.contributionKey,
      ]),
      ...layout.appliedRelocations.flatMap((relocation) => [
        relocation.relocationKey,
        relocation.sourceModuleKey,
        relocation.patchSectionKey,
        relocation.targetSymbolKey,
        relocation.baseRelocationKey ?? "",
      ]),
      ...layout.provenance.flatMap((record) => [
        record.stableKey,
        record.sectionKey,
        record.sourceModuleKey ?? "",
        record.sourceObjectSectionKey ?? "",
        record.sourceObjectProvenanceKey ?? "",
        record.sourceRelocationKey ?? "",
        record.sourceSyntheticObjectKey ?? "",
        record.machineSubjectKey ?? "",
      ]),
      ...layout.factSpending.flatMap((record) => [
        record.stableKey,
        record.authority,
        record.payload,
        ...record.sourceModuleKeys,
      ]),
    ].filter((name) => name.length > 0),
  );
}

function moduleKeys(modules: readonly { readonly moduleKey: string }[]): string {
  return modules.map((module) => module.moduleKey).join(",");
}

function sectionRanges(layout: AArch64LinkedImageLayout): string {
  return layout.sections
    .map((section) => `${section.stableKey}:${section.rva}:${section.virtualSizeBytes}`)
    .join(",");
}

function report(input: {
  readonly checkerKey: string;
  readonly status: FullImageValidationCheckReport["status"];
  readonly stableDetail: string;
  readonly authority: readonly FullImageValidationEvidenceAuthority[];
  readonly evidence:
    | FullImageValidationEvidenceRecord
    | readonly FullImageValidationEvidenceRecord[];
}): FullImageValidationCheckReport {
  return Object.freeze({
    checkerKey: input.checkerKey,
    status: input.status,
    stableDetail: input.stableDetail,
    inputAuthority: Object.freeze([...input.authority]),
    evidence: Object.freeze(Array.isArray(input.evidence) ? [...input.evidence] : [input.evidence]),
  });
}

function evidence(
  evidenceKey: string,
  authority: FullImageValidationEvidenceAuthority,
  stableDetail: string,
): FullImageValidationEvidenceRecord {
  return Object.freeze({ evidenceKey, authority, stableDetail });
}
