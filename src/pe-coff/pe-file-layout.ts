import type {
  AArch64LinkedImageLayout,
  ImageBaseRelocation,
  LinkedDataDirectorySource,
  LinkedImageSection,
} from "../linker";
import type { AArch64PeCoffEfiWriterTargetSurface } from "./aarch64/aarch64-pe-coff-target";
import { AARCH64_PE_COFF_EFI_WRITER_TARGET_KEY } from "./aarch64/aarch64-pe-coff-target";
import {
  peCoffError,
  peCoffOk,
  peCoffWriterDiagnostic,
  type PeCoffWriterDiagnostic,
  type PeCoffWriterResult,
  type PeCoffWriterVerificationSummary,
} from "./diagnostics";
import {
  PE_COFF_FILE_HEADER_SIZE_BYTES,
  PE_DOS_HEADER_SIZE_BYTES,
  PE_RELOC_SECTION_CHARACTERISTICS,
  PE_SECTION_HEADER_SIZE_BYTES,
  PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES,
} from "./headers";

const IMAGE_SCN_MEM_EXECUTE = 0x20000000;
const IMAGE_SCN_CNT_INITIALIZED_DATA = 0x00000040;
const PE_SIGNATURE_SIZE_BYTES = 4;
const PE_EXCEPTION_DIRECTORY_INDEX = 3;
const PE_BASE_RELOCATION_DIRECTORY_INDEX = 5;
const PE_EXCEPTION_DIRECTORY_SECTION_KEY = ".pdata";
const PE_COFF_EXECUTABLE_IMAGE_CHARACTERISTIC = 0x0002;
const PE_COFF_LARGE_ADDRESS_AWARE_CHARACTERISTIC = 0x0020;

const LINKED_LAYOUT_VALIDATION_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "pe-coff-linked-layout",
      runKey: "validate",
      status: "passed" as const,
    }),
  ]),
});

export interface ValidateLinkedImageForPeCoffWriterInput {
  readonly target: AArch64PeCoffEfiWriterTargetSurface;
  readonly layout: AArch64LinkedImageLayout;
}

export interface ValidatedLinkedImageForPeCoffWriter {
  readonly target: AArch64PeCoffEfiWriterTargetSurface;
  readonly layout: AArch64LinkedImageLayout;
}

export function validateLinkedImageForPeCoffWriter(
  input: ValidateLinkedImageForPeCoffWriterInput,
): PeCoffWriterResult<ValidatedLinkedImageForPeCoffWriter> {
  const diagnostics: PeCoffWriterDiagnostic[] = [];
  validateTarget(diagnostics, input.target);
  validateLayoutVerification(diagnostics, input.layout);
  validateTargetPolicyFingerprint(diagnostics, input);
  validateSections(diagnostics, input);
  validateEntry(diagnostics, input.layout);
  validateDataDirectorySources(diagnostics, input.layout);
  validateBaseRelocations(diagnostics, input.layout);

  if (diagnostics.length > 0) {
    return peCoffError({
      diagnostics,
      verification: LINKED_LAYOUT_VALIDATION_VERIFICATION,
    });
  }

  return peCoffOk({
    value: Object.freeze({
      target: input.target,
      layout: input.layout,
    }),
    verification: LINKED_LAYOUT_VALIDATION_VERIFICATION,
  });
}

function inputDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_INPUT_INVALID",
    ownerKey: "pe-coff-linked-layout",
    stableDetail,
  });
}

function validateTarget(
  diagnostics: PeCoffWriterDiagnostic[],
  target: AArch64PeCoffEfiWriterTargetSurface,
): void {
  if (target.targetKey !== AARCH64_PE_COFF_EFI_WRITER_TARGET_KEY) {
    diagnostics.push(inputDiagnostic(`target:key:${target.targetKey}`));
  }

  const serializedOwners = new Map<string, string>();
  for (const [sourceName, serializedName] of Object.entries(target.serializedSectionNames)) {
    const owner = serializedOwners.get(serializedName);
    if (owner !== undefined && owner !== sourceName) {
      diagnostics.push(inputDiagnostic(`target:duplicate-section-name:${serializedName}`));
    } else {
      serializedOwners.set(serializedName, sourceName);
    }
  }
}

function validateLayoutVerification(
  diagnostics: PeCoffWriterDiagnostic[],
  layout: AArch64LinkedImageLayout,
): void {
  for (const run of layout.verification.runs) {
    if (run.status !== "passed") {
      diagnostics.push(
        inputDiagnostic(`layout-verification:${run.status}:${run.verifierKey}:${run.runKey}`),
      );
    }
  }
}

function validateTargetPolicyFingerprint(
  diagnostics: PeCoffWriterDiagnostic[],
  input: ValidateLinkedImageForPeCoffWriterInput,
): void {
  if (input.layout.targetKey !== AARCH64_PE_COFF_EFI_WRITER_TARGET_KEY) {
    diagnostics.push(inputDiagnostic(`layout:target-key:${input.layout.targetKey}`));
  }
  if (input.layout.targetPolicyFingerprint !== input.target.linkedTargetPolicyFingerprint) {
    diagnostics.push(
      inputDiagnostic(
        `layout:target-policy-fingerprint:${input.layout.targetPolicyFingerprint}:expected:${input.target.linkedTargetPolicyFingerprint}`,
      ),
    );
  }
}

function validateSections(
  diagnostics: PeCoffWriterDiagnostic[],
  input: ValidateLinkedImageForPeCoffWriterInput,
): void {
  const { sections } = input.layout;
  const { target } = input;
  const seenSectionKeys = new Set<string>();

  for (const section of sections) {
    if (seenSectionKeys.has(section.stableKey)) {
      diagnostics.push(inputDiagnostic(`section:duplicate-stable-key:${section.stableKey}`));
    }
    seenSectionKeys.add(section.stableKey);

    if (target.serializedSectionNames[section.stableKey] === undefined) {
      diagnostics.push(inputDiagnostic(`section:serialized-name-missing:${section.stableKey}`));
    }

    if (
      !Number.isInteger(section.rva) ||
      section.rva < 0 ||
      !Number.isInteger(section.alignmentBytes) ||
      section.alignmentBytes <= 0
    ) {
      diagnostics.push(inputDiagnostic(`section:rva-invalid:${section.stableKey}`));
    } else if (section.rva % section.alignmentBytes !== 0) {
      diagnostics.push(
        inputDiagnostic(
          `section:rva-misaligned:${section.stableKey}:${section.rva}:${section.alignmentBytes}`,
        ),
      );
    }

    if (section.alignmentBytes !== target.sectionAlignmentBytes) {
      diagnostics.push(
        inputDiagnostic(
          `section:alignment:${section.stableKey}:${section.alignmentBytes}:expected:${target.sectionAlignmentBytes}`,
        ),
      );
    }

    if (!Number.isInteger(section.virtualSizeBytes) || section.virtualSizeBytes < 0) {
      diagnostics.push(inputDiagnostic(`section:virtual-size-invalid:${section.stableKey}`));
    } else if (section.virtualSizeBytes < section.bytes.length) {
      diagnostics.push(
        inputDiagnostic(
          `section:virtual-size-too-small:${section.stableKey}:${section.virtualSizeBytes}:${section.bytes.length}`,
        ),
      );
    } else if (section.virtualSizeBytes > 0 && section.bytes.length === 0) {
      diagnostics.push(inputDiagnostic(`section:empty-initialized-bytes:${section.stableKey}`));
    }

    if (!Number.isInteger(section.flags) || section.flags < 0 || section.flags > 0xffff_ffff) {
      diagnostics.push(inputDiagnostic(`section:flags-u32:${section.stableKey}:${section.flags}`));
    }

    const virtualEnd = section.rva + section.virtualSizeBytes;
    if (virtualEnd > target.maxImageSizeBytes) {
      diagnostics.push(
        inputDiagnostic(
          `section:image-size:${section.stableKey}:${virtualEnd}:max:${target.maxImageSizeBytes}`,
        ),
      );
    }
  }

  if (sections.length === 0) {
    diagnostics.push(inputDiagnostic("section:first-rva:missing"));
    return;
  }

  const firstSection = sections[0]!;
  if (firstSection.rva !== target.firstSectionRva) {
    diagnostics.push(
      inputDiagnostic(`section:first-rva:${firstSection.rva}:expected:${target.firstSectionRva}`),
    );
  }

  for (let index = 1; index < sections.length; index += 1) {
    const previous = sections[index - 1]!;
    const next = sections[index]!;
    const expectedRva = align(
      previous.rva + previous.virtualSizeBytes,
      target.sectionAlignmentBytes,
    );
    if (next.rva !== expectedRva) {
      diagnostics.push(
        inputDiagnostic(
          `section:virtual-order:${previous.stableKey}:${next.stableKey}:${next.rva}:expected:${expectedRva}`,
        ),
      );
    }
  }
}

function validateEntry(
  diagnostics: PeCoffWriterDiagnostic[],
  layout: AArch64LinkedImageLayout,
): void {
  const entryRva = layout.entry.loaderEntryRva;
  const executableSection = layout.sections.find(
    (section) =>
      (section.flags & IMAGE_SCN_MEM_EXECUTE) !== 0 && containsRange(section, entryRva, 1),
  );
  if (executableSection === undefined) {
    diagnostics.push(inputDiagnostic(`entry:outside-executable-section:${entryRva}`));
  }
}

function validateDataDirectorySources(
  diagnostics: PeCoffWriterDiagnostic[],
  layout: AArch64LinkedImageLayout,
): void {
  const sourceByDirectoryKind = new Map<string, LinkedDataDirectorySource>();
  for (const source of layout.dataDirectorySources) {
    const previousSource = sourceByDirectoryKind.get(source.directoryKind);
    if (previousSource !== undefined) {
      diagnostics.push(
        inputDiagnostic(
          `data-directory:duplicate-kind:${source.directoryKind}:${previousSource.stableKey}:${source.stableKey}`,
        ),
      );
    } else {
      sourceByDirectoryKind.set(source.directoryKind, source);
    }

    if (
      source.directoryKind === "exception" &&
      source.sectionKey !== PE_EXCEPTION_DIRECTORY_SECTION_KEY
    ) {
      diagnostics.push(
        inputDiagnostic(
          `data-directory:exception-section:${source.sectionKey}:expected:${PE_EXCEPTION_DIRECTORY_SECTION_KEY}`,
        ),
      );
    }

    const section = sectionByKey(layout.sections, source.sectionKey);
    if (section === undefined || !dataDirectorySourceIsContained(source, section)) {
      diagnostics.push(inputDiagnostic(`data-directory:range-outside-section:${source.stableKey}`));
    }
  }
}

function validateBaseRelocations(
  diagnostics: PeCoffWriterDiagnostic[],
  layout: AArch64LinkedImageLayout,
): void {
  for (const relocation of layout.baseRelocations) {
    const section = sectionByKey(layout.sections, relocation.sectionKey);
    if (section === undefined || !baseRelocationIsContained(relocation, section)) {
      diagnostics.push(
        inputDiagnostic(`base-relocation:range-outside-section:${relocation.stableKey}`),
      );
    }
  }
}

function sectionByKey(
  sections: readonly LinkedImageSection[],
  sectionKey: string,
): LinkedImageSection | undefined {
  return sections.find((section) => section.stableKey === sectionKey);
}

function dataDirectorySourceIsContained(
  source: LinkedDataDirectorySource,
  section: LinkedImageSection,
): boolean {
  return containsRange(section, source.rva, source.sizeBytes);
}

function baseRelocationIsContained(
  relocation: ImageBaseRelocation,
  section: LinkedImageSection,
): boolean {
  return containsRange(section, relocation.rva, relocation.widthBytes);
}

function containsRange(section: LinkedImageSection, rva: number, sizeBytes: number): boolean {
  const sectionEnd = section.rva + section.virtualSizeBytes;
  const rangeEnd = rva + sizeBytes;
  return (
    Number.isInteger(rva) &&
    Number.isInteger(sizeBytes) &&
    sizeBytes >= 0 &&
    rva >= section.rva &&
    rangeEnd <= sectionEnd
  );
}

export function alignPe(value: number, alignmentBytes: number): number {
  return Math.ceil(value / alignmentBytes) * alignmentBytes;
}

function align(value: number, alignmentBytes: number): number {
  return alignPe(value, alignmentBytes);
}

const SECTION_PLANNING_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "pe-coff-section-planner",
      runKey: "plan",
      status: "passed" as const,
    }),
  ]),
});

const DATA_DIRECTORY_PLANNING_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "pe-coff-data-directory-planner",
      runKey: "plan",
      status: "passed" as const,
    }),
  ]),
});

const HEADER_PLANNING_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "pe-coff-header-planner",
      runKey: "plan",
      status: "passed" as const,
    }),
  ]),
});

export interface PlanPeCoffSectionsInput {
  readonly target: AArch64PeCoffEfiWriterTargetSurface;
  readonly layout: AArch64LinkedImageLayout;
  readonly baseRelocationTableBytes: readonly number[];
}

export interface PlannedPeCoffSection {
  readonly sectionKey: string;
  readonly serializedName: string;
  readonly rva: number;
  readonly virtualSizeBytes: number;
  readonly rawDataPointerBytes: number;
  readonly rawDataSizeBytes: number;
  readonly characteristics: number;
  readonly bytes: readonly number[];
  readonly generated: boolean;
}

export interface PlannedPeCoffSections {
  readonly sections: readonly PlannedPeCoffSection[];
  readonly sizeOfHeadersBytes: number;
  readonly sizeOfImageBytes: number;
}

export interface PlannedPeCoffDataDirectory {
  readonly rva: number;
  readonly sizeBytes: number;
}

export interface PlanPeDataDirectoriesInput {
  readonly target: AArch64PeCoffEfiWriterTargetSurface;
  readonly layout: AArch64LinkedImageLayout;
  readonly sections: readonly PlannedPeCoffSection[];
  readonly baseRelocationTableSizeBytes: number;
}

export interface PlannedPeCoffDataDirectories {
  readonly directories: readonly PlannedPeCoffDataDirectory[];
}

export interface PlannedPeDosHeader {
  readonly sizeBytes: number;
  readonly peHeaderOffsetBytes: number;
}

export interface PlannedPeCoffFileHeader {
  readonly machine: number;
  readonly numberOfSections: number;
  readonly timeDateStamp: number;
  readonly pointerToSymbolTable: number;
  readonly numberOfSymbols: number;
  readonly sizeOfOptionalHeader: number;
  readonly characteristics: number;
}

export interface PlannedPe32PlusOptionalHeader {
  readonly magic: number;
  readonly majorLinkerVersion: number;
  readonly minorLinkerVersion: number;
  readonly sizeOfCodeBytes: number;
  readonly sizeOfInitializedDataBytes: number;
  readonly sizeOfUninitializedDataBytes: number;
  readonly addressOfEntryPoint: number;
  readonly baseOfCode: number;
  readonly imageBase: bigint;
  readonly sectionAlignmentBytes: number;
  readonly fileAlignmentBytes: number;
  readonly majorOperatingSystemVersion: number;
  readonly minorOperatingSystemVersion: number;
  readonly majorImageVersion: number;
  readonly minorImageVersion: number;
  readonly majorSubsystemVersion: number;
  readonly minorSubsystemVersion: number;
  readonly win32VersionValue: number;
  readonly sizeOfImageBytes: number;
  readonly sizeOfHeadersBytes: number;
  readonly checksum: number;
  readonly subsystem: number;
  readonly dllCharacteristics: number;
  readonly sizeOfStackReserveBytes: bigint;
  readonly sizeOfStackCommitBytes: bigint;
  readonly sizeOfHeapReserveBytes: bigint;
  readonly sizeOfHeapCommitBytes: bigint;
  readonly loaderFlags: number;
  readonly numberOfRvaAndSizes: number;
  readonly dataDirectories: readonly PlannedPeCoffDataDirectory[];
}

export interface PlannedPeHeaders {
  readonly dosHeader: PlannedPeDosHeader;
  readonly coffHeader: PlannedPeCoffFileHeader;
  readonly optionalHeader: PlannedPe32PlusOptionalHeader;
  readonly sizeOfHeadersBytes: number;
  readonly sizeOfImageBytes: number;
}

export interface PlanPeHeadersInput {
  readonly target: AArch64PeCoffEfiWriterTargetSurface;
  readonly layout: AArch64LinkedImageLayout;
  readonly sections: readonly PlannedPeCoffSection[];
  readonly dataDirectories: readonly PlannedPeCoffDataDirectory[];
}

function sectionPlanningDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_SECTION_PLANNING_FAILED",
    ownerKey: "pe-coff-section-planner",
    stableDetail,
  });
}

function dataDirectoryPlanningDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_DATA_DIRECTORY_PLANNING_FAILED",
    ownerKey: "pe-coff-data-directory-planner",
    stableDetail,
  });
}

function headerPlanningDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_HEADER_PLANNING_FAILED",
    ownerKey: "pe-coff-header-planner",
    stableDetail,
  });
}

function sectionTableEndOffset(peHeaderOffsetBytes: number, sectionCount: number): number {
  return (
    peHeaderOffsetBytes +
    PE_SIGNATURE_SIZE_BYTES +
    PE_COFF_FILE_HEADER_SIZE_BYTES +
    PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES +
    PE_SECTION_HEADER_SIZE_BYTES * sectionCount
  );
}

function plannedImageSize(
  sections: readonly Pick<PlannedPeCoffSection, "rva" | "virtualSizeBytes">[],
  sectionAlignmentBytes: number,
): number {
  const sectionEnd = sections.reduce(
    (maxEnd, section) => Math.max(maxEnd, section.rva + section.virtualSizeBytes),
    0,
  );
  return alignPe(Math.max(sectionAlignmentBytes, sectionEnd), sectionAlignmentBytes);
}

export function planPeCoffSections(
  input: PlanPeCoffSectionsInput,
): PeCoffWriterResult<PlannedPeCoffSections> {
  const sectionCount =
    input.layout.sections.length + (input.baseRelocationTableBytes.length > 0 ? 1 : 0);
  const sizeOfHeadersBytes = alignPe(
    sectionTableEndOffset(input.target.peHeaderOffsetBytes, sectionCount),
    input.target.fileAlignmentBytes,
  );
  if (sizeOfHeadersBytes > input.target.firstSectionRva) {
    return peCoffError({
      diagnostics: [
        sectionPlanningDiagnostic(
          `sections:headers-overlap:${sizeOfHeadersBytes}:first-section:${input.target.firstSectionRva}`,
        ),
      ],
      verification: SECTION_PLANNING_VERIFICATION,
    });
  }
  let rawDataPointerBytes = sizeOfHeadersBytes;
  const sections: PlannedPeCoffSection[] = [];

  for (const section of input.layout.sections) {
    const rawDataSizeBytes = alignPe(section.bytes.length, input.target.fileAlignmentBytes);
    sections.push(
      Object.freeze({
        sectionKey: section.stableKey,
        serializedName: input.target.serializedSectionNames[section.stableKey] ?? section.stableKey,
        rva: section.rva,
        virtualSizeBytes: section.virtualSizeBytes,
        rawDataPointerBytes,
        rawDataSizeBytes,
        characteristics: section.flags,
        bytes: Object.freeze([...section.bytes]),
        generated: false,
      }),
    );
    rawDataPointerBytes += rawDataSizeBytes;
  }

  if (input.baseRelocationTableBytes.length > 0) {
    if (sections.some((section) => section.sectionKey === ".reloc")) {
      return peCoffError({
        diagnostics: [sectionPlanningDiagnostic("sections:duplicate-generated-reloc")],
        verification: SECTION_PLANNING_VERIFICATION,
      });
    }

    const previousVirtualEnd = sections.reduce(
      (maxEnd, section) => Math.max(maxEnd, section.rva + section.virtualSizeBytes),
      0,
    );
    const relocRva = alignPe(previousVirtualEnd, input.target.sectionAlignmentBytes);
    const rawDataSizeBytes = alignPe(
      input.baseRelocationTableBytes.length,
      input.target.fileAlignmentBytes,
    );
    sections.push(
      Object.freeze({
        sectionKey: ".reloc",
        serializedName: input.target.serializedSectionNames[".reloc"] ?? ".reloc",
        rva: relocRva,
        virtualSizeBytes: input.baseRelocationTableBytes.length,
        rawDataPointerBytes,
        rawDataSizeBytes,
        characteristics: PE_RELOC_SECTION_CHARACTERISTICS,
        bytes: Object.freeze([...input.baseRelocationTableBytes]),
        generated: true,
      }),
    );
  }

  const sizeOfImageBytes = plannedImageSize(sections, input.target.sectionAlignmentBytes);
  if (sizeOfImageBytes > input.target.maxImageSizeBytes) {
    return peCoffError({
      diagnostics: [
        sectionPlanningDiagnostic(
          `sections:image-size:${sizeOfImageBytes}:max:${input.target.maxImageSizeBytes}`,
        ),
      ],
      verification: SECTION_PLANNING_VERIFICATION,
    });
  }

  return peCoffOk({
    value: Object.freeze({
      sections: Object.freeze(sections),
      sizeOfHeadersBytes,
      sizeOfImageBytes,
    }),
    verification: SECTION_PLANNING_VERIFICATION,
  });
}

export function planPeDataDirectories(
  input: PlanPeDataDirectoriesInput,
): PeCoffWriterResult<PlannedPeCoffDataDirectories> {
  const diagnostics: PeCoffWriterDiagnostic[] = [];
  const directories: PlannedPeCoffDataDirectory[] = Array.from(
    { length: input.target.numberOfRvaAndSizes },
    () => Object.freeze({ rva: 0, sizeBytes: 0 }),
  );

  for (const source of input.layout.dataDirectorySources) {
    if (source.directoryKind === "exception") {
      directories[PE_EXCEPTION_DIRECTORY_INDEX] = Object.freeze({
        rva: source.rva,
        sizeBytes: source.sizeBytes,
      });
    } else {
      diagnostics.push(
        dataDirectoryPlanningDiagnostic(
          `data-directory:unsupported-kind:${source.stableKey}:${source.directoryKind}`,
        ),
      );
    }
  }

  if (input.baseRelocationTableSizeBytes > 0) {
    const relocSection = input.sections.find((section) => section.sectionKey === ".reloc");
    if (relocSection === undefined) {
      diagnostics.push(
        dataDirectoryPlanningDiagnostic("data-directory:base-relocation-section:missing"),
      );
    } else {
      directories[PE_BASE_RELOCATION_DIRECTORY_INDEX] = Object.freeze({
        rva: relocSection.rva,
        sizeBytes: input.baseRelocationTableSizeBytes,
      });
    }
  }

  if (diagnostics.length > 0) {
    return peCoffError({
      diagnostics,
      verification: DATA_DIRECTORY_PLANNING_VERIFICATION,
    });
  }

  return peCoffOk({
    value: Object.freeze({ directories: Object.freeze(directories) }),
    verification: DATA_DIRECTORY_PLANNING_VERIFICATION,
  });
}

function checkedU16(diagnostics: PeCoffWriterDiagnostic[], fieldName: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
    diagnostics.push(headerPlanningDiagnostic(`${fieldName}:u16:${value}`));
  }
}

function checkedU32(diagnostics: PeCoffWriterDiagnostic[], fieldName: string, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffff_ffff) {
    diagnostics.push(headerPlanningDiagnostic(`${fieldName}:u32:${value}`));
  }
}

function checkedU64(diagnostics: PeCoffWriterDiagnostic[], fieldName: string, value: bigint): void {
  if (value < 0n || value > 0xffff_ffff_ffff_ffffn) {
    diagnostics.push(headerPlanningDiagnostic(`${fieldName}:u64:${value.toString()}`));
  }
}

function isExecutable(section: PlannedPeCoffSection): boolean {
  return (section.characteristics & IMAGE_SCN_MEM_EXECUTE) !== 0;
}

function isInitializedData(section: PlannedPeCoffSection): boolean {
  return !isExecutable(section) && (section.characteristics & IMAGE_SCN_CNT_INITIALIZED_DATA) !== 0;
}

export function planPeHeaders(input: PlanPeHeadersInput): PeCoffWriterResult<PlannedPeHeaders> {
  const diagnostics: PeCoffWriterDiagnostic[] = [];
  const executableSections = input.sections.filter(isExecutable);
  const baseOfCode = executableSections[0]?.rva;
  if (baseOfCode === undefined) {
    diagnostics.push(headerPlanningDiagnostic("optional-header:missing-executable-section"));
  }

  const sizeOfCodeBytes = executableSections.reduce(
    (sum, section) => sum + section.rawDataSizeBytes,
    0,
  );
  const sizeOfInitializedDataBytes = input.sections
    .filter(isInitializedData)
    .reduce((sum, section) => sum + section.rawDataSizeBytes, 0);
  const sizeOfHeadersBytes = alignPe(
    sectionTableEndOffset(input.target.peHeaderOffsetBytes, input.sections.length),
    input.target.fileAlignmentBytes,
  );
  const sizeOfImageBytes = plannedImageSize(input.sections, input.target.sectionAlignmentBytes);

  checkedU16(diagnostics, "coff-header:number-of-sections", input.sections.length);
  checkedU32(diagnostics, "optional-header:size-of-code", sizeOfCodeBytes);
  checkedU32(diagnostics, "optional-header:size-of-initialized-data", sizeOfInitializedDataBytes);
  checkedU32(
    diagnostics,
    "optional-header:address-of-entry-point",
    input.layout.entry.loaderEntryRva,
  );
  checkedU32(diagnostics, "optional-header:base-of-code", baseOfCode ?? 0);
  checkedU32(diagnostics, "optional-header:size-of-image", sizeOfImageBytes);
  checkedU32(diagnostics, "optional-header:size-of-headers", sizeOfHeadersBytes);
  checkedU32(diagnostics, "optional-header:number-of-rva-and-sizes", input.dataDirectories.length);
  if (input.dataDirectories.length !== input.target.numberOfRvaAndSizes) {
    diagnostics.push(
      headerPlanningDiagnostic(
        `optional-header:number-of-rva-and-sizes:${input.dataDirectories.length}:expected:${input.target.numberOfRvaAndSizes}`,
      ),
    );
  }
  checkedU64(diagnostics, "optional-header:image-base", input.target.imageBase);
  checkedU64(
    diagnostics,
    "optional-header:size-of-stack-reserve",
    input.target.sizeOfStackReserveBytes,
  );
  checkedU64(
    diagnostics,
    "optional-header:size-of-stack-commit",
    input.target.sizeOfStackCommitBytes,
  );
  checkedU64(
    diagnostics,
    "optional-header:size-of-heap-reserve",
    input.target.sizeOfHeapReserveBytes,
  );
  checkedU64(
    diagnostics,
    "optional-header:size-of-heap-commit",
    input.target.sizeOfHeapCommitBytes,
  );

  for (const [index, directory] of input.dataDirectories.entries()) {
    checkedU32(diagnostics, `data-directory:${index}:rva`, directory.rva);
    checkedU32(diagnostics, `data-directory:${index}:size`, directory.sizeBytes);
  }

  if (diagnostics.length > 0) {
    return peCoffError({
      diagnostics,
      verification: HEADER_PLANNING_VERIFICATION,
    });
  }

  const dosHeader: PlannedPeDosHeader = Object.freeze({
    sizeBytes: PE_DOS_HEADER_SIZE_BYTES,
    peHeaderOffsetBytes: input.target.peHeaderOffsetBytes,
  });
  const coffHeader: PlannedPeCoffFileHeader = Object.freeze({
    machine: input.target.machine,
    numberOfSections: input.sections.length,
    timeDateStamp: input.target.coffTimestamp,
    pointerToSymbolTable: 0,
    numberOfSymbols: 0,
    sizeOfOptionalHeader: PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES,
    characteristics:
      PE_COFF_EXECUTABLE_IMAGE_CHARACTERISTIC | PE_COFF_LARGE_ADDRESS_AWARE_CHARACTERISTIC,
  });
  const optionalHeader: PlannedPe32PlusOptionalHeader = Object.freeze({
    magic: input.target.optionalHeaderMagic,
    majorLinkerVersion: input.target.majorLinkerVersion,
    minorLinkerVersion: input.target.minorLinkerVersion,
    sizeOfCodeBytes,
    sizeOfInitializedDataBytes,
    sizeOfUninitializedDataBytes: 0,
    addressOfEntryPoint: input.layout.entry.loaderEntryRva,
    baseOfCode: baseOfCode!,
    imageBase: input.target.imageBase,
    sectionAlignmentBytes: input.target.sectionAlignmentBytes,
    fileAlignmentBytes: input.target.fileAlignmentBytes,
    majorOperatingSystemVersion: input.target.majorOperatingSystemVersion,
    minorOperatingSystemVersion: input.target.minorOperatingSystemVersion,
    majorImageVersion: input.target.majorImageVersion,
    minorImageVersion: input.target.minorImageVersion,
    majorSubsystemVersion: input.target.majorSubsystemVersion,
    minorSubsystemVersion: input.target.minorSubsystemVersion,
    win32VersionValue: 0,
    sizeOfImageBytes,
    sizeOfHeadersBytes,
    checksum: 0,
    subsystem: input.target.subsystem,
    dllCharacteristics: input.target.dllCharacteristics,
    sizeOfStackReserveBytes: input.target.sizeOfStackReserveBytes,
    sizeOfStackCommitBytes: input.target.sizeOfStackCommitBytes,
    sizeOfHeapReserveBytes: input.target.sizeOfHeapReserveBytes,
    sizeOfHeapCommitBytes: input.target.sizeOfHeapCommitBytes,
    loaderFlags: 0,
    numberOfRvaAndSizes: input.dataDirectories.length,
    dataDirectories: input.dataDirectories,
  });

  return peCoffOk({
    value: Object.freeze({
      dosHeader,
      coffHeader,
      optionalHeader,
      sizeOfHeadersBytes,
      sizeOfImageBytes,
    }),
    verification: HEADER_PLANNING_VERIFICATION,
  });
}
