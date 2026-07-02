import {
  AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
  AARCH64_OBJECT_SECTION_CLASS_WRITABLE_DATA,
  aarch64ObjectModule,
  aarch64ObjectRelocation,
  type AArch64ObjectModule,
  type AArch64ObjectRelocation,
  type AArch64ObjectRelocationTarget,
  type AArch64ObjectSection,
  type AArch64ObjectSymbol,
} from "../../../src/target/aarch64/backend/object/object-module";
import {
  byteProvenanceForTest,
  relocationForTest,
  sectionForTest,
  symbolForTest,
  type ObjectRelocationForTestOptions,
} from "../target/aarch64/backend/object-module-fixtures";
import type { AArch64LinkInputModule } from "../../../src/linker";

export interface TextSectionForLinkTestInput {
  readonly stableKey?: string;
  readonly bytes?: readonly number[];
  readonly alignmentBytes?: number;
}

export interface DataSectionForLinkTestInput {
  readonly stableKey?: string;
  readonly bytes?: readonly number[];
  readonly alignmentBytes?: number;
}

export interface LocalSymbolForLinkTestInput {
  readonly stableKey?: string;
  readonly sectionKey?: string;
  readonly offsetBytes?: number;
}

export interface GlobalSymbolForLinkTestInput {
  readonly stableKey?: string;
  readonly linkageName?: string;
  readonly sectionKey?: string;
  readonly offsetBytes?: number;
}

export interface ExternalSymbolForLinkTestInput {
  readonly stableKey?: string;
  readonly linkageName?: string;
}

export interface RelocationForLinkTestInput {
  readonly stableKey?: string;
  readonly sectionKey?: string;
  readonly offsetBytes?: number;
  readonly widthBytes?: number;
  readonly family?: string;
  readonly target?: AArch64ObjectRelocationTarget;
  readonly targetSymbol?: string;
  readonly addend?: bigint;
  readonly bitRange?: readonly [number, number];
  readonly encodingOwner?: ObjectRelocationForTestOptions["encodingOwner"];
  readonly pairedRelocationKey?: string;
}

export interface ObjectModuleForLinkTestInput {
  readonly moduleKey?: string;
  readonly syntheticProviderKey?: string;
  readonly syntheticObjectKey?: string;
  readonly targetBackendSurfaceFingerprint?: string;
  readonly closedImagePlanFingerprint?: string;
  readonly sections?: readonly AArch64ObjectSection[];
  readonly symbols?: readonly AArch64ObjectSymbol[];
  readonly relocations?: readonly AArch64ObjectRelocation[];
}

export function objectModuleForLinkTest(
  input: ObjectModuleForLinkTestInput = {},
): AArch64LinkInputModule {
  const sections = input.sections ?? [textSectionForLinkTest({})];
  const objectModule = aarch64ObjectModule({
    targetBackendSurfaceFingerprint:
      input.targetBackendSurfaceFingerprint ?? "backend-target-surface-fingerprint",
    closedImagePlanFingerprint:
      input.closedImagePlanFingerprint ?? `closed-image-plan:${input.moduleKey ?? "link-test"}`,
    sections,
    symbols: input.symbols ?? [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: String(sections[0]?.stableKey ?? ".text"),
      }),
    ],
    relocations: input.relocations ?? [],
    byteProvenance: byteProvenanceForSections(sections),
  });

  return Object.freeze({
    moduleKey: input.moduleKey ?? "module:test:object",
    objectModule,
    syntheticProviderKey: input.syntheticProviderKey,
    syntheticObjectKey: input.syntheticObjectKey,
  });
}

export function textSectionForLinkTest(input: TextSectionForLinkTestInput): AArch64ObjectSection {
  const stableKey = input.stableKey ?? ".text";
  const bytes = input.bytes ?? [0xc0, 0x03, 0x5f, 0xd6];
  return sectionForTest({
    stableKey,
    classKey: AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
    alignmentBytes: input.alignmentBytes ?? 4,
    bytes,
    fragments:
      bytes.length === 0
        ? []
        : [{ stableKey: `${stableKey}:fragment`, startOffsetBytes: 0, sizeBytes: bytes.length }],
  });
}

export function dataSectionForLinkTest(input: DataSectionForLinkTestInput): AArch64ObjectSection {
  const stableKey = input.stableKey ?? ".data";
  const bytes = input.bytes ?? [1, 2, 3, 4];
  return sectionForTest({
    stableKey,
    classKey: AARCH64_OBJECT_SECTION_CLASS_WRITABLE_DATA,
    alignmentBytes: input.alignmentBytes ?? 4,
    bytes,
    fragments:
      bytes.length === 0
        ? []
        : [{ stableKey: `${stableKey}:fragment`, startOffsetBytes: 0, sizeBytes: bytes.length }],
  });
}

export function localSymbolForLinkTest(input: LocalSymbolForLinkTestInput): AArch64ObjectSymbol {
  return symbolForTest({
    kind: "local-definition",
    stableKey: input.stableKey ?? "local",
    sectionKey: input.sectionKey ?? ".text",
    offsetBytes: input.offsetBytes ?? 0,
  });
}

export function globalSymbolForLinkTest(input: GlobalSymbolForLinkTestInput): AArch64ObjectSymbol {
  return symbolForTest({
    kind: "global-definition",
    stableKey: input.stableKey ?? "main",
    linkageName: input.linkageName ?? "Boot.main",
    sectionKey: input.sectionKey ?? ".text",
    offsetBytes: input.offsetBytes ?? 0,
  });
}

export function externalSymbolForLinkTest(
  input: ExternalSymbolForLinkTestInput,
): AArch64ObjectSymbol {
  const linkageName = input.linkageName ?? "External.main";
  return symbolForTest({
    kind: "external-declaration",
    stableKey: input.stableKey ?? `extern:${linkageName}`,
    linkageName,
  });
}

export function relocationForLinkTest(input: RelocationForLinkTestInput): AArch64ObjectRelocation {
  if (input.target !== undefined && input.targetSymbol === undefined) {
    return aarch64ObjectRelocation({
      stableKey: input.stableKey ?? "reloc:call",
      sectionKey: input.sectionKey ?? ".text",
      offsetBytes: input.offsetBytes ?? 0,
      widthBytes: input.widthBytes ?? 4,
      family: input.family ?? "branch26",
      target: input.target,
      addend: input.addend ?? 0n,
      bitRange: input.bitRange ?? [0, 25],
      encodingOwner: input.encodingOwner,
      pairedRelocationKey: input.pairedRelocationKey,
    });
  }

  return relocationForTest({
    stableKey: input.stableKey ?? "reloc:call",
    sectionKey: input.sectionKey ?? ".text",
    offsetBytes: input.offsetBytes ?? 0,
    widthBytes: input.widthBytes ?? 4,
    family: input.family ?? "branch26",
    target: input.target ?? { kind: "linkage-name", linkageName: "Boot.main" },
    targetSymbol: input.targetSymbol,
    addend: input.addend ?? 0n,
    bitRange: input.bitRange ?? [0, 25],
    encodingOwner: input.encodingOwner,
    pairedRelocationKey: input.pairedRelocationKey,
  });
}

export function bootObjectModuleForLinkTest(): AArch64ObjectModule {
  return objectModuleForLinkTest({
    moduleKey: "module:test:boot",
    sections: [textSectionForLinkTest({ stableKey: ".text" })],
    symbols: [
      globalSymbolForLinkTest({
        stableKey: "main",
        linkageName: "Boot.main",
        sectionKey: ".text",
      }),
    ],
  }).objectModule;
}

function byteProvenanceForSections(sections: readonly AArch64ObjectSection[]) {
  return sections.flatMap((section) =>
    section.bytes.length === 0
      ? []
      : [
          byteProvenanceForTest({
            stableKey: `provenance:${section.stableKey}`,
            sectionKey: String(section.stableKey),
            startOffsetBytes: 0,
            byteLength: section.bytes.length,
            source: `fixture:${section.stableKey}`,
            factFamilies: ["fixture-bytes"],
          }),
        ],
  );
}
