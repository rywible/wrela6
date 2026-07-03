import { compareCodeUnitStrings } from "../../../shared/deterministic-sort";
import { parsePeCoffImage, type ParsedPeCoffImage } from "../../../pe-coff";
import type { AArch64LinkedImageLayout } from "../../../linker";
import type { FullImageValidationCheckReport, FullImageValidationEvidenceRecord } from "../report";
import { referenceCheckReport, referenceEvidence } from "./report-builders";
import type { FullImageReferenceChecker, FullImageReferenceCheckerInput } from "./types";

const CHECKER_KEY = "pe-coff-reference";
const INPUT_AUTHORITY = Object.freeze(["final-bytes", "linked-layout"] as const);
const EXCEPTION_DIRECTORY_INDEX = 3;
const BASE_RELOCATION_DIRECTORY_INDEX = 5;

export function peCoffReferenceChecker(): FullImageReferenceChecker {
  return Object.freeze({
    checkerKey: CHECKER_KEY,
    allowedAuthorities: INPUT_AUTHORITY,
    requiredWhenCompilePassed: true,
    run: runPeCoffReferenceChecker,
  });
}

function runPeCoffReferenceChecker(
  input: FullImageReferenceCheckerInput,
): readonly FullImageValidationCheckReport[] {
  const bytes = input.artifact?.peCoffArtifact.bytes;
  const layout = input.trace?.binarySpine?.linkedLayout;
  if (bytes === undefined || layout === undefined) {
    return Object.freeze([
      report("skipped", "pe-coff:inputs-missing", [
        evidence(
          "pe-bytes",
          "final-bytes",
          bytes === undefined ? "missing" : `bytes:${bytes.length}`,
        ),
        evidence("linked-layout", "linked-layout", layout === undefined ? "missing" : "present"),
      ]),
    ]);
  }

  const parsed = parsePeCoffImage(bytes);
  if (parsed.kind === "error") {
    return Object.freeze([
      report(
        "failed",
        `pe-coff:parse:failed:${parsed.diagnostics[0]?.stableDetail ?? "parse-failed"}`,
        [evidence("pe-parse", "final-bytes", "parsePeCoffImage:artifact.peCoffArtifact.bytes")],
      ),
    ]);
  }

  const reports = [
    dataDirectoryReport(parsed.value, layout),
    relocationReport(parsed.value, layout),
    rawSectionReport(parsed.value, layout),
    sizeReport(parsed.value, bytes),
    entryReport(parsed.value, layout),
    symbolTableReport(parsed.value),
  ];
  const failures = reports.filter((candidate) => candidate.status === "failed");
  if (failures.length > 0) return Object.freeze(failures.sort(compareReports));
  return Object.freeze(reports.sort(compareReports));
}

function dataDirectoryReport(
  image: ParsedPeCoffImage,
  layout: AArch64LinkedImageLayout,
): FullImageValidationCheckReport {
  const mismatches = layout.dataDirectorySources
    .map((source) => {
      const index =
        source.directoryKind === "exception"
          ? EXCEPTION_DIRECTORY_INDEX
          : source.directoryKind === "base-relocation"
            ? BASE_RELOCATION_DIRECTORY_INDEX
            : undefined;
      if (index === undefined) return undefined;
      const directory = image.dataDirectories[index];
      if (directory?.rva === source.rva && directory.sizeBytes === source.sizeBytes)
        return undefined;
      return `${source.directoryKind}:${source.rva}:${source.sizeBytes}:${directory?.rva ?? 0}:${directory?.sizeBytes ?? 0}`;
    })
    .filter((detail): detail is string => detail !== undefined)
    .sort(compareCodeUnitStrings);
  return report(
    mismatches.length === 0 ? "passed" : "failed",
    mismatches.length === 0
      ? `pe-coff:data-directories:matched:${image.dataDirectories.length}`
      : `pe-coff:data-directories:mismatch:${mismatches.join(",")}`,
    [
      evidence("parsed-directories", "final-bytes", directoryDetail(image)),
      evidence(
        "linked-directories",
        "linked-layout",
        layout.dataDirectorySources
          .map((source) => `${source.directoryKind}:${source.rva}:${source.sizeBytes}`)
          .join(","),
      ),
    ],
  );
}

function relocationReport(
  image: ParsedPeCoffImage,
  layout: AArch64LinkedImageLayout,
): FullImageValidationCheckReport {
  const parsedRelocationRvas = image.baseRelocationBlocks
    .flatMap((block) => block.entries.map((entry) => entry.rva))
    .sort((left, right) => left - right);
  const layoutRelocationRvas = layout.baseRelocations
    .map((relocation) => relocation.rva)
    .sort((left, right) => left - right);
  const matched = parsedRelocationRvas.join(",") === layoutRelocationRvas.join(",");
  return report(
    matched ? "passed" : "failed",
    matched
      ? `pe-coff:relocations:matched:${layoutRelocationRvas.length}`
      : `pe-coff:relocations:mismatch:${layoutRelocationRvas.join(",")}:${parsedRelocationRvas.join(",")}`,
    [
      evidence("parsed-relocations", "final-bytes", parsedRelocationRvas.join(",")),
      evidence("linked-relocations", "linked-layout", layoutRelocationRvas.join(",")),
    ],
  );
}

function rawSectionReport(
  image: ParsedPeCoffImage,
  layout: AArch64LinkedImageLayout,
): FullImageValidationCheckReport {
  const mismatches = layout.sections
    .map((section) => {
      const parsed = image.sectionHeaders.find((candidate) => candidate.name === section.stableKey);
      if (parsed === undefined) return `missing:${section.stableKey}`;
      if (parsed.rva !== section.rva || parsed.virtualSizeBytes !== section.virtualSizeBytes) {
        return `range:${section.stableKey}:${section.rva}:${section.virtualSizeBytes}:${parsed.rva}:${parsed.virtualSizeBytes}`;
      }
      const expectedPrefix = section.bytes.join(",");
      const parsedPrefix = parsed.bytes.slice(0, section.bytes.length).join(",");
      if (expectedPrefix !== parsedPrefix) return `bytes:${section.stableKey}`;
      return undefined;
    })
    .filter((detail): detail is string => detail !== undefined)
    .sort(compareCodeUnitStrings);
  return report(
    mismatches.length === 0 ? "passed" : "failed",
    mismatches.length === 0
      ? `pe-coff:raw-sections:matched:${layout.sections.length}`
      : `pe-coff:raw-sections:mismatch:${mismatches.join(",")}`,
    [
      evidence(
        "parsed-sections",
        "final-bytes",
        image.sectionHeaders
          .map((section) => `${section.name}:${section.rva}:${section.virtualSizeBytes}`)
          .join(","),
      ),
      evidence(
        "linked-sections",
        "linked-layout",
        layout.sections
          .map((section) => `${section.stableKey}:${section.rva}:${section.virtualSizeBytes}`)
          .join(","),
      ),
    ],
  );
}

function sizeReport(
  image: ParsedPeCoffImage,
  bytes: readonly number[],
): FullImageValidationCheckReport {
  const expectedFileSize = image.sectionHeaders.reduce(
    (max, section) => Math.max(max, section.rawDataPointerBytes + section.rawDataSizeBytes),
    image.optionalHeader.sizeOfHeadersBytes,
  );
  const expectedImageSize = image.sectionHeaders.reduce(
    (max, section) =>
      Math.max(
        max,
        align(section.rva + section.virtualSizeBytes, image.optionalHeader.sectionAlignmentBytes),
      ),
    image.optionalHeader.sizeOfHeadersBytes,
  );
  const matched =
    expectedFileSize === bytes.length &&
    expectedImageSize === image.optionalHeader.sizeOfImageBytes;
  return report(
    matched ? "passed" : "failed",
    matched
      ? `pe-coff:sizes:matched:${image.optionalHeader.sizeOfHeadersBytes}:${image.optionalHeader.sizeOfImageBytes}`
      : `pe-coff:sizes:mismatch:${expectedFileSize}:${bytes.length}:${expectedImageSize}:${image.optionalHeader.sizeOfImageBytes}`,
    [
      evidence(
        "sizes",
        "final-bytes",
        `headers:${image.optionalHeader.sizeOfHeadersBytes}:file:${bytes.length}:image:${image.optionalHeader.sizeOfImageBytes}`,
      ),
    ],
  );
}

function entryReport(
  image: ParsedPeCoffImage,
  layout: AArch64LinkedImageLayout,
): FullImageValidationCheckReport {
  const matched = image.optionalHeader.addressOfEntryPoint === layout.entry.loaderEntryRva;
  return report(
    matched ? "passed" : "failed",
    matched
      ? `pe-coff:entry-rva:matched:${image.optionalHeader.addressOfEntryPoint}`
      : `pe-coff:entry-rva:mismatch:${layout.entry.loaderEntryRva}:${image.optionalHeader.addressOfEntryPoint}`,
    [
      evidence("parsed-entry-rva", "final-bytes", String(image.optionalHeader.addressOfEntryPoint)),
      evidence("linked-entry-rva", "linked-layout", String(layout.entry.loaderEntryRva)),
    ],
  );
}

function symbolTableReport(image: ParsedPeCoffImage): FullImageValidationCheckReport {
  const absent =
    image.coffHeader.pointerToSymbolTable === 0 && image.coffHeader.numberOfSymbols === 0;
  return report(
    absent ? "passed" : "failed",
    absent
      ? "pe-coff:symbol-table:absent"
      : `pe-coff:symbol-table:present:${image.coffHeader.pointerToSymbolTable}:${image.coffHeader.numberOfSymbols}`,
    [
      evidence(
        "coff-symbol-table",
        "final-bytes",
        `pointer:${image.coffHeader.pointerToSymbolTable}:count:${image.coffHeader.numberOfSymbols}`,
      ),
    ],
  );
}

function directoryDetail(image: ParsedPeCoffImage): string {
  return image.dataDirectories
    .map((directory, index) => `${index}:${directory.rva}:${directory.sizeBytes}`)
    .join(",");
}

function align(value: number, alignment: number): number {
  if (alignment <= 0) return value;
  return Math.ceil(value / alignment) * alignment;
}

function report(
  status: FullImageValidationCheckReport["status"],
  stableDetail: string,
  evidenceRecords: readonly FullImageValidationEvidenceRecord[],
): FullImageValidationCheckReport {
  return referenceCheckReport({
    checkerKey: CHECKER_KEY,
    status,
    stableDetail,
    inputAuthority: INPUT_AUTHORITY,
    evidence: evidenceRecords,
  });
}

function evidence(
  evidenceKey: string,
  authority: FullImageValidationEvidenceRecord["authority"],
  stableDetail: string,
): FullImageValidationEvidenceRecord {
  return referenceEvidence({ evidenceKey, authority, stableDetail });
}

function compareReports(
  left: FullImageValidationCheckReport,
  right: FullImageValidationCheckReport,
): number {
  return compareCodeUnitStrings(left.stableDetail, right.stableDetail);
}
