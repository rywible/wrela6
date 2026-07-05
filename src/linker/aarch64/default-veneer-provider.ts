import {
  AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
  aarch64ObjectByteProvenance,
  aarch64ObjectFragment,
  aarch64ObjectModule,
  aarch64ObjectRelocation,
  aarch64ObjectSection,
  aarch64ObjectSymbol,
  verifierRun,
  type AArch64ObjectModule,
} from "../../target/aarch64/backend/object/object-module";
import { aarch64BackendVerificationSummary } from "../../target/aarch64/backend/api/verification-summary";
import type {
  AArch64LinkerVeneerProvider,
  AArch64LinkerVeneerProviderInput,
  AArch64SyntheticObjectModule,
} from "./aarch64-linker";

const PROVIDER_KEY = "veneer";
const OBJECT_KEY = "veneer";
const TEXT_SECTION_KEY = ".text.veneer";
const TEXT_FRAGMENT_KEY = ".text.veneer:fragment";
const VENEER_SYMBOL_KEY = "veneer";
const TARGET_SYMBOL_KEY = "extern:target";
const TARGET_PAGE_RELOCATION_KEY = "reloc:veneer:target:0:page";
const TARGET_LOW12_RELOCATION_KEY = "reloc:veneer:target:1:low12";
const VENEER_INSTRUCTION_BYTES = Object.freeze([
  0x10, 0x00, 0x00, 0x90, 0x10, 0x02, 0x00, 0x91, 0x00, 0x02, 0x1f, 0xd6,
] as const);

export function createDefaultAArch64LinkerVeneerProvider(): AArch64LinkerVeneerProvider {
  return Object.freeze({
    providerKey: PROVIDER_KEY,
    provideVeneer: (input: AArch64LinkerVeneerProviderInput) => ({
      kind: "ok" as const,
      modules: Object.freeze([defaultVeneerModule(input)]),
    }),
  });
}

function defaultVeneerModule(
  input: AArch64LinkerVeneerProviderInput,
): AArch64SyntheticObjectModule {
  const objectModule = createDefaultVeneerObjectModule(input);
  return Object.freeze({
    objectKey: OBJECT_KEY,
    moduleKey: `module:synthetic:${input.providerKey}:${OBJECT_KEY}`,
    objectModule,
  });
}

function createDefaultVeneerObjectModule(
  input: AArch64LinkerVeneerProviderInput,
): AArch64ObjectModule {
  const targetLinkageName = input.targetLinkageName ?? input.targetSymbolKey;
  return aarch64ObjectModule({
    targetBackendSurfaceFingerprint: input.target.backendSurfaceFingerprint,
    closedImagePlanFingerprint: `linker-veneer:${input.sourceRelocationKey}`,
    sections: [
      aarch64ObjectSection({
        stableKey: TEXT_SECTION_KEY,
        classKey: AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
        alignmentBytes: 4,
        bytes: VENEER_INSTRUCTION_BYTES,
        fragments: [
          aarch64ObjectFragment({
            stableKey: TEXT_FRAGMENT_KEY,
            sectionKey: TEXT_SECTION_KEY,
            startOffsetBytes: 0,
            sizeBytes: VENEER_INSTRUCTION_BYTES.length,
          }),
        ],
      }),
    ],
    symbols: [
      aarch64ObjectSymbol({
        kind: "global-definition",
        stableKey: VENEER_SYMBOL_KEY,
        linkageName: `${input.sourceRelocationKey}.veneer`,
        sectionKey: TEXT_SECTION_KEY,
        offsetBytes: 0,
      }),
      aarch64ObjectSymbol({
        kind: "external-declaration",
        stableKey: TARGET_SYMBOL_KEY,
        linkageName: targetLinkageName,
      }),
    ],
    relocations: [
      aarch64ObjectRelocation({
        stableKey: TARGET_PAGE_RELOCATION_KEY,
        sectionKey: TEXT_SECTION_KEY,
        offsetBytes: 0,
        widthBytes: 4,
        family: "pagebase-rel21",
        target: { kind: "linkage-name", linkageName: targetLinkageName },
        addend: 0n,
        bitRange: [5, 30],
        encodingOwner: {
          opcode: "adrp",
          catalogEntryKey: "encoding:adrp",
        },
        pairedRelocationKey: TARGET_LOW12_RELOCATION_KEY,
      }),
      aarch64ObjectRelocation({
        stableKey: TARGET_LOW12_RELOCATION_KEY,
        sectionKey: TEXT_SECTION_KEY,
        offsetBytes: 4,
        widthBytes: 4,
        family: "pageoffset-12a",
        target: { kind: "linkage-name", linkageName: targetLinkageName },
        addend: 0n,
        bitRange: [10, 21],
        encodingOwner: {
          opcode: "add-pageoff",
          catalogEntryKey: "encoding:add-pageoff",
        },
        pairedRelocationKey: TARGET_PAGE_RELOCATION_KEY,
      }),
    ],
    byteProvenance: [
      aarch64ObjectByteProvenance({
        stableKey: "byte:veneer:branch",
        sectionKey: TEXT_SECTION_KEY,
        startOffsetBytes: 0,
        byteLength: VENEER_INSTRUCTION_BYTES.length,
        source: input.sourceRelocationKey,
        factFamilies: input.request.provenanceKeys,
      }),
    ],
    verification: aarch64BackendVerificationSummary({
      runs: [
        verifierRun({
          verifierKey: "default-aarch64-linker-veneer-provider",
          runKey: "adrp-add-br-x16-veneer",
          status: "passed",
        }),
      ],
    }),
  });
}
