import {
  createAArch64LinkedImageLayout,
  type AArch64LinkInputModule,
  type AArch64LinkedImageLayout,
  type ImageBaseRelocation,
  type LinkedDataDirectorySource,
  type LinkedImageSection,
  type LinkAArch64ImageInput,
} from "../../../src/linker";
import {
  authenticateAArch64PeCoffEfiWriterTargetSurface,
  planPeCoffSections,
  planPeDataDirectories,
  planPeHeaders,
  serializePeBaseRelocations,
  serializePlannedPeCoffImage,
  type AArch64PeCoffEfiWriterTargetSurfaceInput,
  type AArch64PeCoffEfiWriterTargetSurface,
  type PlannedPeCoffImage,
} from "../../../src/pe-coff";
import {
  dataSectionForLinkTest,
  globalSymbolForLinkTest,
  objectModuleForLinkTest,
  relocationForLinkTest,
  textSectionForLinkTest,
} from "../linker/aarch64-object-link-fixtures";
import {
  entryShimProviderForTest,
  targetSurfaceForTest,
  unwindProviderForTest,
} from "../linker/linker-fixtures";

export function productionWriterTargetInputForTest(
  input: Partial<AArch64PeCoffEfiWriterTargetSurfaceInput> = {},
): AArch64PeCoffEfiWriterTargetSurfaceInput {
  return {
    linkedTargetPolicyFingerprint: "stable-hash:linker-policy",
    ...input,
  };
}

export function writerTargetForTest(
  input: Partial<AArch64PeCoffEfiWriterTargetSurfaceInput> = {},
): AArch64PeCoffEfiWriterTargetSurface {
  const result = authenticateAArch64PeCoffEfiWriterTargetSurface(
    productionWriterTargetInputForTest(input),
  );
  if (result.kind !== "ok") {
    throw new Error("expected authenticated PE/COFF writer target fixture");
  }
  return result.value;
}

export function writerTargetForLinkedLayout(
  layout: AArch64LinkedImageLayout,
): AArch64PeCoffEfiWriterTargetSurface {
  return writerTargetForTest({
    linkedTargetPolicyFingerprint: layout.targetPolicyFingerprint,
  });
}

export function dir64RelocationForTest(
  input: Partial<ImageBaseRelocation> = {},
): ImageBaseRelocation {
  const rva = input.rva ?? 0x2000;
  return {
    stableKey: `base-reloc:dir64:.data:${rva}`,
    kind: "dir64",
    sectionKey: ".data",
    rva,
    widthBytes: 8,
    sourceRelocationKey: "module:test:reloc:absolute",
    ...input,
  };
}

export interface LinkedImageLayoutForPeCoffTestInput {
  readonly sections?: readonly LinkedImageSection[];
  readonly entryRva?: number;
  readonly baseRelocations?: readonly ImageBaseRelocation[];
  readonly dataDirectorySources?: readonly LinkedDataDirectorySource[];
  readonly verification?: AArch64LinkedImageLayout["verification"];
  readonly targetKey?: string;
  readonly targetFingerprint?: string;
  readonly targetPolicyFingerprint?: string;
  readonly includeDataSection?: boolean;
}

export function linkedImageLayoutForPeCoffTest(
  input: LinkedImageLayoutForPeCoffTestInput = {},
): AArch64LinkedImageLayout {
  const includeDataSection = input.includeDataSection ?? true;
  const sections = input.sections ?? [
    linkedSectionForPeCoffTest(".text", 0x1000, 0x20, 0x60000020, [0xc0, 0x03, 0x5f, 0xd6]),
    linkedSectionForPeCoffTest(".pdata", 0x2000, 0x0c, 0x40000040, [0, 0, 0, 0]),
    linkedSectionForPeCoffTest(".xdata", 0x3000, 0x08, 0x40000040, [0, 0, 0, 0]),
    ...(includeDataSection
      ? [linkedSectionForPeCoffTest(".data", 0x4000, 0x10, 0xc0000040, [0, 0, 0, 0])]
      : []),
  ];

  return createAArch64LinkedImageLayout({
    targetKey: input.targetKey ?? "wrela-uefi-aarch64-rpi5-v1",
    targetFingerprint: input.targetFingerprint ?? "stable-hash:linked-target",
    targetPolicyFingerprint: input.targetPolicyFingerprint ?? "stable-hash:linker-policy",
    inputModules: [
      {
        moduleKey: "module:test",
        moduleFingerprint: "stable-hash:module-test",
      },
    ],
    sections,
    symbols: [],
    appliedRelocations: [],
    baseRelocations: input.baseRelocations ?? [],
    entry: {
      loaderEntryLinkageName: "EfiMain",
      loaderEntryRva: input.entryRva ?? 0x1000,
      wrelaBootLinkageName: "wrela_boot",
      wrelaBootRva: input.entryRva ?? 0x1000,
    },
    unwindRecords: [],
    dataDirectorySources: input.dataDirectorySources ?? [
      {
        stableKey: "data-directory:exception:.pdata",
        directoryKind: "exception",
        sectionKey: ".pdata",
        rva: 0x2000,
        sizeBytes: 0x0c,
      },
    ],
    provenance: [],
    factSpending: [],
    verification: input.verification ?? {
      runs: [
        {
          verifierKey: "linker-fixture",
          runKey: "layout",
          status: "passed",
        },
      ],
    },
  });
}

export function plannedImageForWriterTest(
  input: Partial<PlannedPeCoffImage> = {},
): PlannedPeCoffImage {
  const target = writerTargetForTest();
  const layout = linkedImageLayoutForPeCoffTest({
    sections: [
      linkedSectionForPeCoffTest(".text", 0x1000, 0x20, 0x60000020, [0xc0, 0x03, 0x5f, 0xd6]),
      linkedSectionForPeCoffTest(
        ".pdata",
        0x2000,
        0x0c,
        0x40000040,
        [0x00, 0x10, 0x00, 0x00, 0x20, 0x10, 0x00, 0x00, 0x00, 0x30, 0x00, 0x00],
      ),
      linkedSectionForPeCoffTest(".xdata", 0x3000, 0x08, 0x40000040, [0x01, 0x02, 0x03, 0x04]),
      linkedSectionForPeCoffTest(".data", 0x4000, 0x10, 0xc0000040, [0xaa, 0xbb, 0xcc, 0xdd]),
    ],
    baseRelocations: [],
  });
  const relocations = serializePeBaseRelocations({
    target,
    relocations: layout.baseRelocations,
  });
  if (relocations.kind !== "ok") {
    throw new Error("expected serialized relocation fixture");
  }
  const plannedSections = planPeCoffSections({
    target,
    layout,
    baseRelocationTableBytes: relocations.value.bytes,
  });
  if (plannedSections.kind !== "ok") {
    throw new Error("expected planned section fixture");
  }
  const dataDirectories = planPeDataDirectories({
    target,
    layout,
    sections: plannedSections.value.sections,
    baseRelocationTableSizeBytes: relocations.value.bytes.length,
  });
  if (dataDirectories.kind !== "ok") {
    throw new Error("expected planned data directory fixture");
  }
  const headers = planPeHeaders({
    target,
    layout,
    sections: plannedSections.value.sections,
    dataDirectories: dataDirectories.value.directories,
  });
  if (headers.kind !== "ok") {
    throw new Error("expected planned header fixture");
  }

  return Object.freeze({
    headers: headers.value,
    sections: plannedSections.value.sections,
    ...input,
  });
}

export function serializedBytesForPlannedImage(image: PlannedPeCoffImage): readonly number[] {
  const result = serializePlannedPeCoffImage(image);
  if (result.kind !== "ok") {
    throw new Error("expected serialized planned PE/COFF image fixture");
  }
  return result.value.bytes;
}

export function serializedImageBytesForParserTest(): readonly number[] {
  return serializedBytesForPlannedImage(plannedImageForWriterTest());
}

export function bootModuleForPeCoffIntegrationTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:boot",
    sections: [textSectionForLinkTest({ stableKey: ".text.boot" })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".text.boot",
      }),
    ],
  });
}

export function peCoffDataRelocationLinkInputForTest(): LinkAArch64ImageInput {
  return {
    objectModules: [bootModuleForPeCoffIntegrationTest(), dataRelocationModuleForPeCoffTest()],
    target: targetSurfaceForTest(),
    entry: { wrelaBootLinkageName: "Boot.main" },
    syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
  };
}

function linkedSectionForPeCoffTest(
  stableKey: string,
  rva: number,
  virtualSizeBytes: number,
  flags: number,
  bytes: readonly number[],
): LinkedImageSection {
  return {
    stableKey,
    classKey: stableKey,
    flags,
    alignmentBytes: 4096,
    rva,
    virtualSizeBytes,
    bytes,
    contributions: [
      {
        stableKey: `contribution:${stableKey}`,
        sourceModuleKey: "module:test",
        sourceObjectSectionKey: stableKey,
        sourceObjectSectionClass: stableKey,
        outputSectionKey: stableKey,
        offsetBytes: 0,
        sizeBytes: virtualSizeBytes,
        alignmentBytes: 1,
      },
    ],
  };
}

function dataRelocationModuleForPeCoffTest(): AArch64LinkInputModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:data-ref",
    sections: [
      dataSectionForLinkTest({
        stableKey: ".data.pointer",
        bytes: [0xc0, 0x03, 0x5f, 0xd6, 0xc0, 0x03, 0x5f, 0xd6],
      }),
      textSectionForLinkTest({ stableKey: ".text.target" }),
    ],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "pointer",
        linkageName: "Data.pointer",
        sectionKey: ".data.pointer",
      }),
      globalSymbolForLinkTest({
        stableKey: "target",
        linkageName: "Data.target",
        sectionKey: ".text.target",
      }),
    ],
    relocations: [
      relocationForLinkTest({
        stableKey: "absolute-target",
        sectionKey: ".data.pointer",
        family: "addr64",
        widthBytes: 8,
        target: { kind: "linkage-name", linkageName: "Data.target" },
      }),
    ],
  });
}
