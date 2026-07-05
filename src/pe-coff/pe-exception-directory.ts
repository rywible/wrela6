import { readU32Le, type Reader } from "./pe-reader";
import { sectionContainingRva, sectionContainingRvaRange } from "./pe-section-rva";
import type { ParsedPeDataDirectory, ParsedPeSectionHeader } from "./pe-parser";

const EXCEPTION_DIRECTORY_INDEX = 3;
const IMAGE_SCN_MEM_EXECUTE = 0x20000000;

export function validateExceptionDirectory(
  reader: Reader,
  dataDirectories: readonly ParsedPeDataDirectory[],
  sections: readonly ParsedPeSectionHeader[],
): string | undefined {
  const directory = dataDirectories[EXCEPTION_DIRECTORY_INDEX]!;
  if (directory.rva === 0 && directory.sizeBytes === 0) return undefined;
  if (directory.sizeBytes % 8 !== 0) {
    return `exception-directory:size-unaligned:${directory.sizeBytes}`;
  }
  return validateAArch64ExceptionDirectory(reader, directory, sections);
}

function validateAArch64ExceptionDirectory(
  reader: Reader,
  directory: ParsedPeDataDirectory,
  sections: readonly ParsedPeSectionHeader[],
): string | undefined {
  const section = sectionContainingRvaRange(sections, directory.rva, directory.sizeBytes);
  if (section === undefined) return `exception-directory:section-missing:${directory.rva}`;
  const rawOffset = section.rawDataPointerBytes + (directory.rva - section.rva);
  for (let cursor = rawOffset; cursor < rawOffset + directory.sizeBytes; cursor += 8) {
    const beginRva = readU32Le(reader, cursor);
    const unwindRva = readU32Le(reader, cursor + 4);
    if (beginRva === 0 && unwindRva === 0) {
      return `exception-directory:empty-entry:${cursor - rawOffset}`;
    }

    const beginSection = sectionContainingRva(sections, beginRva);
    if (
      beginSection === undefined ||
      (beginSection.characteristics & IMAGE_SCN_MEM_EXECUTE) === 0
    ) {
      return `exception-directory:begin-rva-not-executable:${beginRva}`;
    }

    const unwindSection = sectionContainingRva(sections, unwindRva);
    if (unwindSection === undefined) {
      return `exception-directory:unwind-rva-section-missing:${unwindRva}`;
    }
    if (unwindSection.name !== ".xdata") {
      return `exception-directory:unwind-rva-not-xdata:${unwindRva}:${unwindSection.name}`;
    }
  }
  return undefined;
}
