import { linkerDiagnostic, sortLinkerDiagnostics, type LinkerDiagnostic } from "../diagnostics";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  type AArch64LinkInputModule,
  type AArch64SyntheticObjectProvider,
  type AArch64SyntheticObjectProviderInput,
  type AArch64SyntheticObjectProviderResult,
} from "./aarch64-linker";
import {
  AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
  AARCH64_OBJECT_SECTION_CLASS_UNWIND_PDATA,
  AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA,
  aarch64ObjectModule,
  aarch64ObjectRelocation,
  aarch64ObjectSection,
  aarch64ObjectSymbol,
  aarch64ObjectUnwindRecord,
  type AArch64ObjectModule,
  type AArch64ObjectInstructionPatch,
  type AArch64ObjectUnwindRecord,
} from "../../target/aarch64/backend/object/object-module";
import { verifyAArch64ObjectModule } from "../../target/aarch64/backend/verify/encoding-object-verifier";
import type { AArch64BackendDiagnostic } from "../../target/aarch64/backend/api/diagnostics";
import type { AArch64BackendTargetSurface } from "../../target/aarch64/backend/api/backend-target-surface";
import type {
  AArch64EncodingCatalog,
  AArch64RelocationCatalog,
} from "../../target/aarch64/backend/api/backend-catalog-interfaces";

export interface CreateAArch64SyntheticObjectProviderInput {
  readonly factory: AArch64SyntheticObjectFactory;
  readonly backendTarget?: AArch64BackendTargetSurface;
  readonly encodingCatalog?: AArch64EncodingCatalog;
  readonly relocationCatalog?: AArch64RelocationCatalog;
}

export interface AArch64SyntheticObjectFactory {
  readonly createEntryObject: (
    input: AArch64EntryObjectFactoryInput,
  ) => AArch64SyntheticEntryObjectFactoryResult;
  readonly createUnwindObjects: (
    input: AArch64UnwindObjectFactoryInput,
  ) => AArch64SyntheticUnwindObjectFactoryResult;
}

export interface AArch64EntryObjectFactoryInput {
  readonly wrelaBootLinkageName: string;
}

export type AArch64SyntheticEntryObjectFactoryResult =
  | {
      readonly kind: "ok";
      readonly codeBytes: readonly number[];
      readonly relocations: readonly AArch64EntryObjectRelocationFactoryOutput[];
      readonly unwindRecords?: readonly AArch64ObjectUnwindRecord[];
    }
  | AArch64SyntheticObjectFactoryError;

export interface AArch64EntryObjectRelocationFactoryOutput {
  readonly stableKey: string;
  readonly offsetBytes: number;
  readonly widthBytes: number;
  readonly family: string;
  readonly targetLinkageName?: string;
  readonly addend?: bigint;
  readonly instructionPatch: AArch64ObjectInstructionPatch;
}

export interface AArch64UnwindObjectFactoryInput {
  readonly unwindRecords: readonly AArch64SyntheticUnwindSourceRecord[];
}

export interface AArch64SyntheticUnwindSourceRecord {
  readonly sourceModuleKey: string;
  readonly stableKey: string;
  readonly frameShape: string;
  readonly functionStableKey?: string;
  readonly functionLinkageName?: string;
}

export type AArch64SyntheticUnwindObjectFactoryResult =
  | {
      readonly kind: "ok";
      readonly objects: readonly AArch64UnwindObjectFactoryOutput[];
    }
  | AArch64SyntheticObjectFactoryError;

export interface AArch64UnwindObjectFactoryOutput {
  readonly objectKey: string;
  readonly pdataBytes: readonly number[];
  readonly xdataBytes: readonly number[];
  readonly functionLinkageName: string;
  readonly frameShape: string;
  readonly pdataRelocation: AArch64UnwindObjectRelocationFactoryOutput;
  readonly xdataRelocation: AArch64UnwindObjectRelocationFactoryOutput;
}

export interface AArch64UnwindObjectRelocationFactoryOutput {
  readonly stableKey: string;
  readonly offsetBytes: number;
  readonly widthBytes: number;
  readonly family: string;
  readonly addend?: bigint;
  readonly instructionPatch?: AArch64ObjectInstructionPatch;
}

export interface AArch64SyntheticObjectFactoryError {
  readonly kind: "error";
  readonly diagnostics: readonly LinkerDiagnostic[];
}

export const AARCH64_UNWIND_PROVIDER_KEY = "aarch64-unwind";

const ENTRY_PROVIDER_KEY = "uefi-entry";
const ENTRY_OBJECT_KEY = "entry";
const UNWIND_PROVIDER_KEY = AARCH64_UNWIND_PROVIDER_KEY;

export function createAArch64UefiEntrySyntheticObjectProvider(
  input: CreateAArch64SyntheticObjectProviderInput,
): AArch64SyntheticObjectProvider {
  return Object.freeze({
    providerKey: ENTRY_PROVIDER_KEY,
    provideObjects: (providerInput: AArch64SyntheticObjectProviderInput) =>
      provideEntryObject(providerInput, input),
  });
}

export function createAArch64UnwindSyntheticObjectProvider(
  input: CreateAArch64SyntheticObjectProviderInput,
): AArch64SyntheticObjectProvider {
  return Object.freeze({
    providerKey: UNWIND_PROVIDER_KEY,
    provideObjects: (providerInput: AArch64SyntheticObjectProviderInput) =>
      provideUnwindObjects(providerInput, input),
  });
}

function provideEntryObject(
  input: AArch64SyntheticObjectProviderInput,
  provider: CreateAArch64SyntheticObjectProviderInput,
): AArch64SyntheticObjectProviderResult {
  const factoryResult = provider.factory.createEntryObject({
    wrelaBootLinkageName: input.entry.wrelaBootLinkageName,
  });
  if (factoryResult.kind === "error") return factoryResult;

  const objectModule = aarch64ObjectModule({
    targetBackendSurfaceFingerprint: input.target.backendSurfaceFingerprint,
    closedImagePlanFingerprint: `synthetic:${ENTRY_PROVIDER_KEY}:${ENTRY_OBJECT_KEY}`,
    sections: [
      aarch64ObjectSection({
        stableKey: ".text",
        classKey: AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT,
        alignmentBytes: 4,
        bytes: factoryResult.codeBytes,
        fragments: [
          {
            stableKey: "fragment:entry",
            startOffsetBytes: 0,
            sizeBytes: factoryResult.codeBytes.length,
          },
        ],
      }),
    ],
    symbols: [
      aarch64ObjectSymbol({
        kind: "external-declaration",
        stableKey: externalSymbolKey(input.entry.wrelaBootLinkageName),
        linkageName: input.entry.wrelaBootLinkageName,
      }),
      ...externalRelocationSymbols(input, factoryResult),
      aarch64ObjectSymbol({
        kind: "global-definition",
        stableKey: "symbol:__wrela_uefi_entry",
        linkageName: "__wrela_uefi_entry",
        sectionKey: ".text",
        offsetBytes: 0,
      }),
    ],
    relocations: entryRelocations(input, factoryResult),
    unwindRecords: factoryResult.unwindRecords ?? [],
  });

  return verifiedOkModules(
    [
      {
        objectKey: ENTRY_OBJECT_KEY,
        moduleKey: syntheticModuleKey(ENTRY_PROVIDER_KEY, ENTRY_OBJECT_KEY),
        objectModule,
      },
    ],
    provider,
  );
}

function entryRelocations(
  input: AArch64SyntheticObjectProviderInput,
  factoryResult: Extract<AArch64SyntheticEntryObjectFactoryResult, { readonly kind: "ok" }>,
): ReturnType<typeof aarch64ObjectRelocation>[] {
  return factoryResult.relocations.map((relocation) =>
    aarch64ObjectRelocation({
      stableKey: relocation.stableKey,
      sectionKey: ".text",
      offsetBytes: relocation.offsetBytes,
      widthBytes: relocation.widthBytes,
      family: relocation.family,
      target: {
        kind: "linkage-name",
        linkageName: relocation.targetLinkageName ?? input.entry.wrelaBootLinkageName,
      },
      addend: relocation.addend,
      instructionPatch: relocation.instructionPatch,
    }),
  );
}

function externalRelocationSymbols(
  input: AArch64SyntheticObjectProviderInput,
  factoryResult: Extract<AArch64SyntheticEntryObjectFactoryResult, { readonly kind: "ok" }>,
) {
  const linkageNames = new Set(
    factoryResult.relocations.map(
      (relocation) => relocation.targetLinkageName ?? input.entry.wrelaBootLinkageName,
    ),
  );
  linkageNames.delete(input.entry.wrelaBootLinkageName);
  return [...linkageNames].sort(compareCodeUnitStrings).map((linkageName) =>
    aarch64ObjectSymbol({
      kind: "external-declaration",
      stableKey: externalSymbolKey(linkageName),
      linkageName,
    }),
  );
}

function provideUnwindObjects(
  input: AArch64SyntheticObjectProviderInput,
  provider: CreateAArch64SyntheticObjectProviderInput,
): AArch64SyntheticObjectProviderResult {
  const factoryResult = provider.factory.createUnwindObjects({
    unwindRecords: unwindSourceRecords(input.objectModules),
  });
  if (factoryResult.kind === "error") return factoryResult;

  return verifiedOkModules(
    factoryResult.objects.map((object) => ({
      objectKey: object.objectKey,
      moduleKey: syntheticModuleKey(UNWIND_PROVIDER_KEY, object.objectKey),
      objectModule: unwindObjectModule(input, object),
    })),
    provider,
  );
}

function unwindObjectModule(
  input: AArch64SyntheticObjectProviderInput,
  object: AArch64UnwindObjectFactoryOutput,
): AArch64ObjectModule {
  return aarch64ObjectModule({
    targetBackendSurfaceFingerprint: input.target.backendSurfaceFingerprint,
    closedImagePlanFingerprint: `synthetic:${UNWIND_PROVIDER_KEY}:${object.objectKey}`,
    sections: [
      aarch64ObjectSection({
        stableKey: ".pdata",
        classKey: AARCH64_OBJECT_SECTION_CLASS_UNWIND_PDATA,
        alignmentBytes: 4,
        bytes: object.pdataBytes,
        fragments: [
          {
            stableKey: "fragment:pdata",
            startOffsetBytes: 0,
            sizeBytes: object.pdataBytes.length,
          },
        ],
      }),
      aarch64ObjectSection({
        stableKey: ".xdata",
        classKey: AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA,
        alignmentBytes: 4,
        bytes: object.xdataBytes,
        fragments: [
          {
            stableKey: "fragment:xdata",
            startOffsetBytes: 0,
            sizeBytes: object.xdataBytes.length,
          },
        ],
      }),
    ],
    symbols: [
      aarch64ObjectSymbol({
        kind: "external-declaration",
        stableKey: externalSymbolKey(object.functionLinkageName),
        linkageName: object.functionLinkageName,
      }),
    ],
    relocations: [
      aarch64ObjectRelocation({
        stableKey: object.pdataRelocation.stableKey,
        sectionKey: ".pdata",
        offsetBytes: object.pdataRelocation.offsetBytes,
        widthBytes: object.pdataRelocation.widthBytes,
        family: object.pdataRelocation.family,
        target: { kind: "linkage-name", linkageName: object.functionLinkageName },
        addend: object.pdataRelocation.addend,
        ...(object.pdataRelocation.instructionPatch === undefined
          ? {}
          : { instructionPatch: object.pdataRelocation.instructionPatch }),
      }),
      aarch64ObjectRelocation({
        stableKey: object.xdataRelocation.stableKey,
        sectionKey: ".xdata",
        offsetBytes: object.xdataRelocation.offsetBytes,
        widthBytes: object.xdataRelocation.widthBytes,
        family: object.xdataRelocation.family,
        target: { kind: "linkage-name", linkageName: object.functionLinkageName },
        addend: object.xdataRelocation.addend,
        ...(object.xdataRelocation.instructionPatch === undefined
          ? {}
          : { instructionPatch: object.xdataRelocation.instructionPatch }),
      }),
    ],
    unwindRecords: [
      aarch64ObjectUnwindRecord({
        stableKey: `unwind:${externalSymbolKey(object.functionLinkageName)}`,
        sectionKey: ".xdata",
        frameShape: object.frameShape,
      }),
    ],
  });
}

function unwindSourceRecords(
  modules: readonly AArch64LinkInputModule[],
): readonly AArch64SyntheticUnwindSourceRecord[] {
  return Object.freeze(
    modules.flatMap((module) =>
      module.objectModule.unwindRecords.map((record) => {
        const functionStableKey = functionStableKeyFromUnwindRecord(record.stableKey);
        const functionSymbol = module.objectModule.symbols.find(
          (symbol) => String(symbol.stableKey) === functionStableKey,
        );
        return Object.freeze({
          sourceModuleKey: module.moduleKey,
          stableKey: record.stableKey,
          frameShape: record.frameShape,
          functionStableKey,
          functionLinkageName:
            functionSymbol?.kind === "global-definition" ||
            functionSymbol?.kind === "external-declaration"
              ? functionSymbol.linkageName
              : undefined,
        });
      }),
    ),
  );
}

function functionStableKeyFromUnwindRecord(stableKey: string): string | undefined {
  return stableKey.startsWith("unwind:") ? stableKey.slice("unwind:".length) : undefined;
}

function okModules(
  modules: readonly {
    readonly objectKey: string;
    readonly moduleKey: string;
    readonly objectModule: AArch64ObjectModule;
  }[],
): AArch64SyntheticObjectProviderResult {
  return Object.freeze({
    kind: "ok" as const,
    modules: Object.freeze(modules.map((module) => Object.freeze({ ...module }))),
  });
}

function verifiedOkModules(
  modules: readonly {
    readonly objectKey: string;
    readonly moduleKey: string;
    readonly objectModule: AArch64ObjectModule;
  }[],
  verification: {
    readonly backendTarget?: AArch64BackendTargetSurface;
    readonly encodingCatalog?: AArch64EncodingCatalog;
    readonly relocationCatalog?: AArch64RelocationCatalog;
  },
): AArch64SyntheticObjectProviderResult {
  const diagnostics = modules.flatMap((module) => {
    const result = verifyAArch64ObjectModule({
      objectModule: module.objectModule,
      target: verification.backendTarget,
      encodingCatalog: verification.encodingCatalog,
      relocationCatalog: verification.relocationCatalog,
    });
    return result.kind === "ok"
      ? []
      : result.diagnostics.map((diagnostic) =>
          linkerDiagnosticFromBackendDiagnostic(module.moduleKey, diagnostic),
        );
  });

  if (diagnostics.length > 0) {
    return Object.freeze({
      kind: "error" as const,
      diagnostics: sortLinkerDiagnostics(diagnostics),
    });
  }

  return okModules(modules);
}

function syntheticModuleKey(providerKey: string, objectKey: string): string {
  return `module:synthetic:${providerKey}:${objectKey}`;
}

function externalSymbolKey(linkageName: string): string {
  return `extern:${linkageName}`;
}

export function aarch64SyntheticObjectFactoryDiagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_INPUT_INVALID",
    ownerKey: "aarch64-synthetic-object-factory",
    stableDetail,
  });
}

function linkerDiagnosticFromBackendDiagnostic(
  moduleKey: string,
  diagnostic: AArch64BackendDiagnostic,
): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_INPUT_INVALID",
    ownerKey: "aarch64-synthetic-object-provider",
    rootCauseKey: diagnostic.rootCauseKey,
    stableDetail: `synthetic-object:verification-failed:${moduleKey}:${diagnostic.stableDetail}`,
    provenance: diagnostic.provenance,
  });
}
