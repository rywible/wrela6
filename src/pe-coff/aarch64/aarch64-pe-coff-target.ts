import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { stableHash, stableJson } from "../../shared/stable-json";
import {
  peCoffError,
  peCoffOk,
  peCoffWriterDiagnostic,
  type PeCoffWriterDiagnostic,
  type PeCoffWriterResult,
  type PeCoffWriterVerificationSummary,
} from "../diagnostics";
import {
  PE32_PLUS_MAGIC,
  PE_DATA_DIRECTORY_COUNT,
  PE_FILE_ALIGNMENT_BYTES,
  PE_FIRST_SECTION_RVA,
  PE_HEADER_OFFSET_BYTES,
  PE_MACHINE_ARM64,
  PE_SECTION_ALIGNMENT_BYTES,
  PE_SUBSYSTEM_EFI_APPLICATION,
} from "../headers";

export const AARCH64_PE_COFF_EFI_WRITER_TARGET_KEY = "wrela-uefi-aarch64-rpi5-v1";
export const AARCH64_PE_COFF_EFI_IMAGE_SIZE_CAP_BYTES = 128 * 1024 * 1024;

const REQUIRED_SECTION_NAMES = [
  ".text",
  ".rdata",
  ".data",
  ".pdata",
  ".xdata",
  ".debug$wrela",
  ".reloc",
] as const;
const REQUIRED_SECTION_NAME_SET: ReadonlySet<string> = new Set(REQUIRED_SECTION_NAMES);

const PRODUCTION_SERIALIZED_SECTION_NAMES: Readonly<Record<string, string>> = Object.freeze({
  ".text": ".text",
  ".rdata": ".rdata",
  ".data": ".data",
  ".pdata": ".pdata",
  ".xdata": ".xdata",
  ".debug$wrela": ".debug",
  ".reloc": ".reloc",
});

export interface AArch64PeCoffEfiWriterTargetSurfaceInput {
  readonly linkedTargetPolicyFingerprint: string;
  readonly targetKey?: string;
  readonly machine?: number;
  readonly optionalHeaderMagic?: number;
  readonly subsystem?: number;
  readonly imageBase?: bigint;
  readonly sectionAlignmentBytes?: number;
  readonly fileAlignmentBytes?: number;
  readonly firstSectionRva?: number;
  readonly maxImageSizeBytes?: number;
  readonly numberOfRvaAndSizes?: number;
  readonly peHeaderOffsetBytes?: number;
  readonly coffTimestamp?: number;
  readonly majorLinkerVersion?: number;
  readonly minorLinkerVersion?: number;
  readonly majorOperatingSystemVersion?: number;
  readonly minorOperatingSystemVersion?: number;
  readonly majorImageVersion?: number;
  readonly minorImageVersion?: number;
  readonly majorSubsystemVersion?: number;
  readonly minorSubsystemVersion?: number;
  readonly sizeOfStackReserveBytes?: bigint;
  readonly sizeOfStackCommitBytes?: bigint;
  readonly sizeOfHeapReserveBytes?: bigint;
  readonly sizeOfHeapCommitBytes?: bigint;
  readonly dllCharacteristics?: number;
  readonly serializedSectionNames?: Readonly<Record<string, string>>;
}

export interface AArch64PeCoffEfiWriterTargetSurface {
  readonly targetKey: string;
  readonly linkedTargetPolicyFingerprint: string;
  readonly machine: number;
  readonly optionalHeaderMagic: number;
  readonly subsystem: number;
  readonly imageBase: bigint;
  readonly sectionAlignmentBytes: number;
  readonly fileAlignmentBytes: number;
  readonly firstSectionRva: number;
  readonly maxImageSizeBytes: number;
  readonly numberOfRvaAndSizes: number;
  readonly peHeaderOffsetBytes: number;
  readonly coffTimestamp: number;
  readonly majorLinkerVersion: number;
  readonly minorLinkerVersion: number;
  readonly majorOperatingSystemVersion: number;
  readonly minorOperatingSystemVersion: number;
  readonly majorImageVersion: number;
  readonly minorImageVersion: number;
  readonly majorSubsystemVersion: number;
  readonly minorSubsystemVersion: number;
  readonly sizeOfStackReserveBytes: bigint;
  readonly sizeOfStackCommitBytes: bigint;
  readonly sizeOfHeapReserveBytes: bigint;
  readonly sizeOfHeapCommitBytes: bigint;
  readonly dllCharacteristics: number;
  readonly serializedSectionNames: Readonly<Record<string, string>>;
  readonly targetPolicyFingerprint: string;
}

const TARGET_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "aarch64-pe-coff-writer-target",
      runKey: "authenticate",
      status: "passed" as const,
    }),
  ]),
});

function productionTargetDefaults(
  input: AArch64PeCoffEfiWriterTargetSurfaceInput,
): Required<AArch64PeCoffEfiWriterTargetSurfaceInput> {
  return {
    linkedTargetPolicyFingerprint: input.linkedTargetPolicyFingerprint,
    targetKey: input.targetKey ?? AARCH64_PE_COFF_EFI_WRITER_TARGET_KEY,
    machine: input.machine ?? PE_MACHINE_ARM64,
    optionalHeaderMagic: input.optionalHeaderMagic ?? PE32_PLUS_MAGIC,
    subsystem: input.subsystem ?? PE_SUBSYSTEM_EFI_APPLICATION,
    imageBase: input.imageBase ?? 0n,
    sectionAlignmentBytes: input.sectionAlignmentBytes ?? PE_SECTION_ALIGNMENT_BYTES,
    fileAlignmentBytes: input.fileAlignmentBytes ?? PE_FILE_ALIGNMENT_BYTES,
    firstSectionRva: input.firstSectionRva ?? PE_FIRST_SECTION_RVA,
    maxImageSizeBytes: input.maxImageSizeBytes ?? AARCH64_PE_COFF_EFI_IMAGE_SIZE_CAP_BYTES,
    numberOfRvaAndSizes: input.numberOfRvaAndSizes ?? PE_DATA_DIRECTORY_COUNT,
    peHeaderOffsetBytes: input.peHeaderOffsetBytes ?? PE_HEADER_OFFSET_BYTES,
    coffTimestamp: input.coffTimestamp ?? 0,
    majorLinkerVersion: input.majorLinkerVersion ?? 0,
    minorLinkerVersion: input.minorLinkerVersion ?? 0,
    majorOperatingSystemVersion: input.majorOperatingSystemVersion ?? 0,
    minorOperatingSystemVersion: input.minorOperatingSystemVersion ?? 0,
    majorImageVersion: input.majorImageVersion ?? 0,
    minorImageVersion: input.minorImageVersion ?? 0,
    majorSubsystemVersion: input.majorSubsystemVersion ?? 0,
    minorSubsystemVersion: input.minorSubsystemVersion ?? 0,
    sizeOfStackReserveBytes: input.sizeOfStackReserveBytes ?? 0n,
    sizeOfStackCommitBytes: input.sizeOfStackCommitBytes ?? 0n,
    sizeOfHeapReserveBytes: input.sizeOfHeapReserveBytes ?? 0n,
    sizeOfHeapCommitBytes: input.sizeOfHeapCommitBytes ?? 0n,
    dllCharacteristics: input.dllCharacteristics ?? 0,
    serializedSectionNames: input.serializedSectionNames ?? PRODUCTION_SERIALIZED_SECTION_NAMES,
  };
}

function freezeSectionNames(
  names: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze(
    Object.fromEntries(
      Object.entries(names).sort(([left], [right]) => compareCodeUnitStrings(left, right)),
    ),
  );
}

function authDiagnostic(stableDetail: string): PeCoffWriterDiagnostic {
  return peCoffWriterDiagnostic({
    code: "PE_COFF_TARGET_AUTH_FAILED",
    ownerKey: AARCH64_PE_COFF_EFI_WRITER_TARGET_KEY,
    stableDetail,
  });
}

function validateNumber(
  diagnostics: PeCoffWriterDiagnostic[],
  name: string,
  actual: number,
  expected: number,
): void {
  if (!Number.isInteger(actual) || actual !== expected) {
    diagnostics.push(authDiagnostic(`target:constant:${name}:${actual}`));
  }
}

function validateBigInt(
  diagnostics: PeCoffWriterDiagnostic[],
  name: string,
  actual: bigint,
  expected: bigint,
): void {
  if (actual !== expected) {
    diagnostics.push(authDiagnostic(`target:constant:${name}:${actual.toString()}`));
  }
}

function validateSectionNames(
  diagnostics: PeCoffWriterDiagnostic[],
  names: Readonly<Record<string, string>>,
): void {
  for (const requiredName of REQUIRED_SECTION_NAMES) {
    if (names[requiredName] === undefined) {
      diagnostics.push(authDiagnostic(`target:missing-section-name:${requiredName}`));
    }
  }

  const serializedOwners = new Map<string, string>();
  for (const [source, serialized] of Object.entries(names).sort(([left], [right]) =>
    compareCodeUnitStrings(left, right),
  )) {
    if (!REQUIRED_SECTION_NAME_SET.has(source)) {
      diagnostics.push(authDiagnostic(`target:unexpected-section-name:${source}`));
    }
    if (new TextEncoder().encode(serialized).length > 8) {
      diagnostics.push(authDiagnostic(`target:section-name-too-long:${source}:${serialized}`));
    }
    if ([...serialized].some((character) => character.charCodeAt(0) > 0x7f)) {
      diagnostics.push(authDiagnostic(`target:section-name-non-ascii:${source}:${serialized}`));
    }
    if (serialized.includes("\0")) {
      diagnostics.push(authDiagnostic(`target:section-name-nul:${source}`));
    }

    const owner = serializedOwners.get(serialized);
    if (owner !== undefined && owner !== source) {
      diagnostics.push(authDiagnostic(`target:duplicate-section-name:${serialized}`));
    } else {
      serializedOwners.set(serialized, source);
    }
  }
}

export function authenticateAArch64PeCoffEfiWriterTargetSurface(
  input: AArch64PeCoffEfiWriterTargetSurfaceInput,
): PeCoffWriterResult<AArch64PeCoffEfiWriterTargetSurface> {
  const target = productionTargetDefaults(input);
  const diagnostics: PeCoffWriterDiagnostic[] = [];

  if (target.targetKey !== AARCH64_PE_COFF_EFI_WRITER_TARGET_KEY) {
    diagnostics.push(authDiagnostic(`target:key:${target.targetKey}`));
  }
  if (
    typeof target.linkedTargetPolicyFingerprint !== "string" ||
    target.linkedTargetPolicyFingerprint.length === 0
  ) {
    diagnostics.push(authDiagnostic("target:linked-target-policy-fingerprint:missing"));
  }
  validateNumber(diagnostics, "machine", target.machine, PE_MACHINE_ARM64);
  validateNumber(diagnostics, "optionalHeaderMagic", target.optionalHeaderMagic, PE32_PLUS_MAGIC);
  validateNumber(diagnostics, "subsystem", target.subsystem, PE_SUBSYSTEM_EFI_APPLICATION);
  validateBigInt(diagnostics, "imageBase", target.imageBase, 0n);
  validateNumber(
    diagnostics,
    "sectionAlignmentBytes",
    target.sectionAlignmentBytes,
    PE_SECTION_ALIGNMENT_BYTES,
  );
  validateNumber(
    diagnostics,
    "fileAlignmentBytes",
    target.fileAlignmentBytes,
    PE_FILE_ALIGNMENT_BYTES,
  );
  validateNumber(diagnostics, "firstSectionRva", target.firstSectionRva, PE_FIRST_SECTION_RVA);
  validateNumber(
    diagnostics,
    "maxImageSizeBytes",
    target.maxImageSizeBytes,
    AARCH64_PE_COFF_EFI_IMAGE_SIZE_CAP_BYTES,
  );
  validateNumber(
    diagnostics,
    "numberOfRvaAndSizes",
    target.numberOfRvaAndSizes,
    PE_DATA_DIRECTORY_COUNT,
  );
  validateNumber(
    diagnostics,
    "peHeaderOffsetBytes",
    target.peHeaderOffsetBytes,
    PE_HEADER_OFFSET_BYTES,
  );
  validateNumber(diagnostics, "coffTimestamp", target.coffTimestamp, 0);
  validateNumber(diagnostics, "majorLinkerVersion", target.majorLinkerVersion, 0);
  validateNumber(diagnostics, "minorLinkerVersion", target.minorLinkerVersion, 0);
  validateNumber(diagnostics, "majorOperatingSystemVersion", target.majorOperatingSystemVersion, 0);
  validateNumber(diagnostics, "minorOperatingSystemVersion", target.minorOperatingSystemVersion, 0);
  validateNumber(diagnostics, "majorImageVersion", target.majorImageVersion, 0);
  validateNumber(diagnostics, "minorImageVersion", target.minorImageVersion, 0);
  validateNumber(diagnostics, "majorSubsystemVersion", target.majorSubsystemVersion, 0);
  validateNumber(diagnostics, "minorSubsystemVersion", target.minorSubsystemVersion, 0);
  validateBigInt(diagnostics, "sizeOfStackReserveBytes", target.sizeOfStackReserveBytes, 0n);
  validateBigInt(diagnostics, "sizeOfStackCommitBytes", target.sizeOfStackCommitBytes, 0n);
  validateBigInt(diagnostics, "sizeOfHeapReserveBytes", target.sizeOfHeapReserveBytes, 0n);
  validateBigInt(diagnostics, "sizeOfHeapCommitBytes", target.sizeOfHeapCommitBytes, 0n);
  validateNumber(diagnostics, "dllCharacteristics", target.dllCharacteristics, 0);
  validateSectionNames(diagnostics, target.serializedSectionNames);

  if (diagnostics.length > 0) {
    return peCoffError({ diagnostics, verification: TARGET_VERIFICATION });
  }

  const serializedSectionNames = freezeSectionNames(target.serializedSectionNames);
  const fingerprintSource = {
    ...target,
    serializedSectionNames,
  };
  const surface: AArch64PeCoffEfiWriterTargetSurface = Object.freeze({
    ...target,
    serializedSectionNames,
    targetPolicyFingerprint: `stable-hash:${stableHash(stableJson(fingerprintSource))}`,
  });

  return peCoffOk({
    value: surface,
    verification: TARGET_VERIFICATION,
  });
}
