export interface PeSectionRvaRange {
  readonly name: string;
  readonly rva: number;
  readonly virtualSizeBytes: number;
}

export function containsRvaRange(
  section: PeSectionRvaRange,
  rva: number,
  sizeBytes: number,
): boolean {
  return rva >= section.rva && rva + sizeBytes <= section.rva + section.virtualSizeBytes;
}

export function sectionContainingRva<Section extends PeSectionRvaRange>(
  sections: readonly Section[],
  rva: number,
): Section | undefined {
  return sections.find(
    (section) => rva >= section.rva && rva < section.rva + section.virtualSizeBytes,
  );
}

export function sectionContainingRvaRange<Section extends PeSectionRvaRange>(
  sections: readonly Section[],
  rva: number,
  sizeBytes: number,
): Section | undefined {
  return sections.find((section) => containsRvaRange(section, rva, sizeBytes));
}
