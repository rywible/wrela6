import {
  parsePeCoffImage,
  PE32_PLUS_MAGIC,
  PE_MACHINE_ARM64,
  PE_SUBSYSTEM_EFI_APPLICATION,
  type ParsedPeCoffImage,
  type ParsedPeSectionHeader,
} from "../../pe-coff";
import {
  fingerprintUefiAArch64ImageBytes,
  type CompileUefiAArch64ImageTrace,
  type UefiAArch64ImageArtifact,
} from "../../target/uefi-aarch64";
import type {
  FullImageValidationCheckReport,
  FullImageValidationEvidenceAuthority,
  FullImageValidationEvidenceRecord,
} from "./report";

const IMAGE_SCN_MEM_EXECUTE = 0x20000000;
const EXCEPTION_DIRECTORY_INDEX = 3;
const BASE_RELOCATION_DIRECTORY_INDEX = 5;
const DETERMINISTIC_SECTION_NAMES = new Set([
  ".text",
  ".rdata",
  ".pdata",
  ".xdata",
  ".data",
  ".reloc",
]);

export interface FullImageBinaryStructureCheckInput {
  readonly artifact: UefiAArch64ImageArtifact;
  readonly trace: CompileUefiAArch64ImageTrace;
}

export function checkFullImageBinaryStructure(
  input: FullImageBinaryStructureCheckInput,
): readonly FullImageValidationCheckReport[] {
  const parsed = parsePeCoffImage(input.artifact.peCoffArtifact.bytes);
  if (parsed.kind === "error") {
    return Object.freeze([
      report({
        checkerKey: "binary.pe.parse",
        status: "failed",
        stableDetail: `binary:pe-parse:failed:${parsed.diagnostics[0]?.stableDetail ?? "parse-failed"}`,
        authority: ["final-bytes"],
        evidence: evidence(
          "pe-parse",
          "final-bytes",
          "parsePeCoffImage:artifact.peCoffArtifact.bytes",
        ),
      }),
    ]);
  }

  const image = parsed.value;
  return Object.freeze([
    parsePassedReport(image),
    headerReport(image),
    symbolTableReport(image),
    sectionReport(image),
    entryReport(image),
    relocationReport(image),
    exceptionDirectoryReport(input, image),
    trailingBytesReport(input, image),
    metadataFingerprintReport(input),
  ]);
}

function parsePassedReport(image: ParsedPeCoffImage): FullImageValidationCheckReport {
  return report({
    checkerKey: "binary.pe.parse",
    status: "passed",
    stableDetail: "binary:pe-parse:passed",
    authority: ["final-bytes"],
    evidence: evidence(
      "pe-parse",
      "final-bytes",
      `sections:${image.sectionHeaders.length}:directories:${image.dataDirectories.length}`,
    ),
  });
}

function headerReport(image: ParsedPeCoffImage): FullImageValidationCheckReport {
  const passed =
    image.coffHeader.machine === PE_MACHINE_ARM64 &&
    image.optionalHeader.magic === PE32_PLUS_MAGIC &&
    image.optionalHeader.subsystem === PE_SUBSYSTEM_EFI_APPLICATION;
  return report({
    checkerKey: "binary.structure.headers",
    status: passed ? "passed" : "failed",
    stableDetail: passed
      ? "binary:headers:aarch64-pe32plus-efi-application"
      : `binary:headers:mismatch:${image.coffHeader.machine}:${image.optionalHeader.magic}:${image.optionalHeader.subsystem}`,
    authority: ["final-bytes"],
    evidence: evidence(
      "headers",
      "final-bytes",
      `machine:${image.coffHeader.machine}:magic:${image.optionalHeader.magic}:subsystem:${image.optionalHeader.subsystem}`,
    ),
  });
}

function symbolTableReport(image: ParsedPeCoffImage): FullImageValidationCheckReport {
  const passed =
    image.coffHeader.pointerToSymbolTable === 0 && image.coffHeader.numberOfSymbols === 0;
  return report({
    checkerKey: "binary.structure.symbol-table",
    status: passed ? "passed" : "failed",
    stableDetail: passed
      ? "binary:symbol-table:absent"
      : `binary:symbol-table:present:${image.coffHeader.pointerToSymbolTable}:${image.coffHeader.numberOfSymbols}`,
    authority: ["final-bytes"],
    evidence: evidence(
      "coff-symbol-table",
      "final-bytes",
      `pointer:${image.coffHeader.pointerToSymbolTable}:count:${image.coffHeader.numberOfSymbols}`,
    ),
  });
}

function sectionReport(image: ParsedPeCoffImage): FullImageValidationCheckReport {
  const names = image.sectionHeaders.map((section) => section.name);
  const text = image.sectionHeaders.find((section) => section.name === ".text");
  const badName = names.find((name) => !DETERMINISTIC_SECTION_NAMES.has(name));
  const textExecutable = text !== undefined && isExecutable(text);
  const passed = badName === undefined && textExecutable;
  return report({
    checkerKey: "binary.structure.sections",
    status: passed ? "passed" : "failed",
    stableDetail: passed
      ? `binary:sections:deterministic:${names.join(",")}`
      : `binary:sections:invalid:${badName ?? ".text-not-executable"}`,
    authority: ["final-bytes"],
    evidence: evidence("sections", "final-bytes", names.join(",")),
  });
}

function entryReport(image: ParsedPeCoffImage): FullImageValidationCheckReport {
  const entryRva = image.optionalHeader.addressOfEntryPoint;
  const entrySection = image.sectionHeaders.find(
    (section) => isExecutable(section) && containsRva(section, entryRva),
  );
  return report({
    checkerKey: "binary.structure.entry",
    status: entrySection === undefined ? "failed" : "passed",
    stableDetail:
      entrySection === undefined
        ? `binary:entry:not-executable-section:${entryRva}`
        : `binary:entry:executable-section:${entrySection.name}:${entryRva}`,
    authority: ["final-bytes"],
    evidence: evidence("entry-rva", "final-bytes", `entry-rva:${entryRva}`),
  });
}

function relocationReport(image: ParsedPeCoffImage): FullImageValidationCheckReport {
  const directory = image.dataDirectories[BASE_RELOCATION_DIRECTORY_INDEX];
  const hasDirectory = directory !== undefined && directory.rva !== 0 && directory.sizeBytes !== 0;
  return report({
    checkerKey: "binary.structure.relocations",
    status: "passed",
    stableDetail: hasDirectory
      ? `binary:relocations:parsed:${image.baseRelocationBlocks.length}`
      : "binary:relocations:absent",
    authority: ["final-bytes"],
    evidence: evidence(
      "base-relocations",
      "final-bytes",
      `directory:${directory?.rva ?? 0}:${directory?.sizeBytes ?? 0}:blocks:${image.baseRelocationBlocks.length}`,
    ),
  });
}

function exceptionDirectoryReport(
  input: FullImageBinaryStructureCheckInput,
  image: ParsedPeCoffImage,
): FullImageValidationCheckReport {
  const unwindRequired = input.trace.binarySpine.linkedLayout.unwindRecords.length > 0;
  const directory = image.dataDirectories[EXCEPTION_DIRECTORY_INDEX];
  const pdata = image.sectionHeaders.find((section) => section.name === ".pdata");
  const pointsToPdata =
    directory !== undefined &&
    directory.rva !== 0 &&
    directory.sizeBytes !== 0 &&
    pdata !== undefined &&
    containsRvaRange(pdata, directory.rva, directory.sizeBytes);
  const passed = !unwindRequired || pointsToPdata;
  return report({
    checkerKey: "binary.structure.exception-directory",
    status: passed ? "passed" : "failed",
    stableDetail: !unwindRequired
      ? "binary:exception-directory:not-required"
      : pointsToPdata
        ? "binary:exception-directory:.pdata"
        : `binary:exception-directory:not-pdata:${directory?.rva ?? 0}:${directory?.sizeBytes ?? 0}`,
    authority: ["final-bytes", "linked-layout"],
    evidence: [
      evidence(
        "exception-directory",
        "final-bytes",
        `directory:${directory?.rva ?? 0}:${directory?.sizeBytes ?? 0}`,
      ),
      evidence(
        "unwind-required",
        "linked-layout",
        `unwind-records:${input.trace.binarySpine.linkedLayout.unwindRecords.length}`,
      ),
    ],
  });
}

function trailingBytesReport(
  input: FullImageBinaryStructureCheckInput,
  image: ParsedPeCoffImage,
): FullImageValidationCheckReport {
  const expected = finalRawDataEnd(image.sectionHeaders, image.optionalHeader.sizeOfHeadersBytes);
  const actual = input.artifact.peCoffArtifact.bytes.length;
  return report({
    checkerKey: "binary.structure.trailing-bytes",
    status: expected === actual ? "passed" : "failed",
    stableDetail:
      expected === actual
        ? `binary:trailing-bytes:none:${actual}`
        : `binary:trailing-bytes:present:${expected}:${actual}`,
    authority: ["final-bytes"],
    evidence: evidence("file-size", "final-bytes", `expected:${expected}:actual:${actual}`),
  });
}

function metadataFingerprintReport(
  input: FullImageBinaryStructureCheckInput,
): FullImageValidationCheckReport {
  const actual = fingerprintUefiAArch64ImageBytes(input.artifact.peCoffArtifact.bytes);
  const expected = input.artifact.targetMetadata?.finalImageFingerprint;
  if (expected === undefined) {
    return report({
      checkerKey: "binary.metadata.fingerprint",
      status: "skipped",
      stableDetail: "metadata:fingerprint:unavailable:targetMetadata.finalImageFingerprint",
      authority: ["final-bytes", "compiler-trace"],
      evidence: evidence("final-image-fingerprint", "final-bytes", actual),
    });
  }
  return report({
    checkerKey: "binary.metadata.fingerprint",
    status: expected === actual ? "passed" : "failed",
    stableDetail:
      expected === actual
        ? "metadata:fingerprint:matched"
        : `metadata:fingerprint:mismatch:${expected}:${actual}`,
    authority: ["final-bytes", "compiler-trace"],
    evidence: [
      evidence("final-image-fingerprint", "final-bytes", actual),
      evidence("metadata-final-image-fingerprint", "compiler-trace", expected),
    ],
  });
}

function isExecutable(section: ParsedPeSectionHeader): boolean {
  return (section.characteristics & IMAGE_SCN_MEM_EXECUTE) !== 0;
}

function containsRva(section: ParsedPeSectionHeader, rva: number): boolean {
  return rva >= section.rva && rva < section.rva + section.virtualSizeBytes;
}

function containsRvaRange(section: ParsedPeSectionHeader, rva: number, sizeBytes: number): boolean {
  return rva >= section.rva && rva + sizeBytes <= section.rva + section.virtualSizeBytes;
}

function finalRawDataEnd(
  sections: readonly ParsedPeSectionHeader[],
  sizeOfHeadersBytes: number,
): number {
  return sections.reduce(
    (endOffset, section) =>
      Math.max(endOffset, section.rawDataPointerBytes + section.rawDataSizeBytes),
    sizeOfHeadersBytes,
  );
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
