import { compareCodeUnitStrings } from "../../shared/deterministic-sort";

export const WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS = Object.freeze({
  preferredImageBase: 0n,
  sectionAlignmentBytes: 4096,
  firstSectionRva: 4096,
  machine: 0xaa64,
  subsystem: 10,
  maxImageSizeBytes: 128 * 1024 * 1024,
  sectionFlags: Object.freeze({
    ".text": 0x60000020,
    ".rdata": 0x40000040,
    ".data": 0xc0000040,
    ".pdata": 0x40000040,
    ".xdata": 0x40000040,
    ".debug$wrela": 0x42000040,
  }),
});

export const AARCH64_PRODUCTION_SECTION_MAPPINGS = Object.freeze([
  Object.freeze({ objectSectionClass: "executable-text", outputSectionKey: ".text" }),
  Object.freeze({ objectSectionClass: "read-only-data", outputSectionKey: ".rdata" }),
  Object.freeze({ objectSectionClass: "writable-data", outputSectionKey: ".data" }),
  Object.freeze({ objectSectionClass: "unwind-pdata", outputSectionKey: ".pdata" }),
  Object.freeze({ objectSectionClass: "unwind-xdata", outputSectionKey: ".xdata" }),
  Object.freeze({ objectSectionClass: "debug-provenance", outputSectionKey: ".debug$wrela" }),
]);

export const AARCH64_REQUIRED_OBJECT_SECTION_CLASSES = Object.freeze(
  AARCH64_PRODUCTION_SECTION_MAPPINGS.map((mapping) => mapping.objectSectionClass).sort(
    compareCodeUnitStrings,
  ),
);
