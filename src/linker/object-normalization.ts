import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerResult,
  type LinkerVerificationSummary,
} from "./diagnostics";
import type { AArch64LinkInputModule } from "./aarch64/aarch64-linker";
import type { AArch64LinkerTargetSurface } from "./image-layout-policy";
import type { LinkedFactSpendingRecord } from "./linked-image-layout";
import { malformedObjectModuleSurfaceFields } from "./object-module-surface";
import type {
  AArch64ObjectModule,
  AArch64ObjectRelocation,
  AArch64ObjectSection,
} from "../target/aarch64/backend/object/object-module";
import { isAArch64InstructionRelocationFamily } from "../target/aarch64/backend/object/relocation-records";
import { verifyAArch64ObjectModule } from "../target/aarch64/backend/verify/encoding-object-verifier";

export interface NormalizeAArch64LinkInputsInput {
  readonly target: AArch64LinkerTargetSurface;
  readonly objectModules: readonly AArch64LinkInputModule[];
}

export interface VerifyAArch64LinkInputObjectsOutput {
  readonly modules: readonly AArch64LinkInputModule[];
}

export interface NormalizedObjectModule {
  readonly moduleKey: string;
  readonly moduleFingerprint: string;
  readonly syntheticProviderKey?: string;
  readonly syntheticObjectKey?: string;
  readonly objectModule: AArch64ObjectModule;
}

export interface NormalizedLinkGraph {
  readonly modules: readonly NormalizedObjectModule[];
  readonly factSpending: readonly LinkedFactSpendingRecord[];
}

const NORMALIZATION_VERIFICATION: LinkerVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "aarch64-linker-object-normalization",
      runKey: "normalize-inputs",
      status: "passed" as const,
    }),
  ]),
});

export function normalizeAArch64LinkInputs(
  input: NormalizeAArch64LinkInputsInput,
): LinkerResult<NormalizedLinkGraph> {
  const verified = verifyAArch64LinkInputGraphShape(input);
  if (verified.kind === "error") return verified;

  const sortedModules = Object.freeze(
    verified.value.modules
      .map((module) => freezeNormalizedModule(module))
      .sort((left, right) => compareCodeUnitStrings(left.moduleKey, right.moduleKey)),
  );
  const factSpending = aggregateFactSpending(sortedModules);
  if (factSpending.kind === "error") {
    return linkerError({
      diagnostics: factSpending.diagnostics,
      verification: NORMALIZATION_VERIFICATION,
    });
  }

  return linkerOk({
    value: Object.freeze({
      modules: sortedModules,
      factSpending: factSpending.records,
    }),
    verification: NORMALIZATION_VERIFICATION,
  });
}

export function verifyAArch64LinkInputObjects(
  input: NormalizeAArch64LinkInputsInput,
): LinkerResult<VerifyAArch64LinkInputObjectsOutput> {
  const verified = verifyAArch64LinkInputGraphShape(input);
  if (verified.kind === "error") return verified;
  const diagnostics = verified.value.modules.flatMap(validateBackendObjectModule);

  if (diagnostics.length > 0) {
    return linkerError({
      diagnostics,
      verification: NORMALIZATION_VERIFICATION,
    });
  }

  return linkerOk({
    value: verified.value,
    verification: NORMALIZATION_VERIFICATION,
  });
}

function verifyAArch64LinkInputGraphShape(
  input: NormalizeAArch64LinkInputsInput,
): LinkerResult<VerifyAArch64LinkInputObjectsOutput> {
  if (!Array.isArray(input.objectModules)) {
    return linkerError({
      diagnostics: [inputDiagnostic("linker-input:malformed-object-modules")],
      verification: NORMALIZATION_VERIFICATION,
    });
  }

  const objectModules = input.objectModules;
  const moduleShapeDiagnostics = validateModuleShapes(objectModules);
  const diagnostics = [
    ...validateModuleList(objectModules),
    ...moduleShapeDiagnostics,
    ...(moduleShapeDiagnostics.length === 0 ? validateModuleKeys(objectModules) : []),
    ...(moduleShapeDiagnostics.length === 0
      ? objectModules.flatMap((module) => validateModule(input.target, module))
      : []),
  ];

  if (diagnostics.length > 0) {
    return linkerError({
      diagnostics,
      verification: NORMALIZATION_VERIFICATION,
    });
  }

  return linkerOk({
    value: Object.freeze({
      modules: Object.freeze(objectModules.map((module) => Object.freeze({ ...module }))),
    }),
    verification: NORMALIZATION_VERIFICATION,
  });
}

function validateBackendObjectModule(module: AArch64LinkInputModule): readonly LinkerDiagnostic[] {
  const result = verifyAArch64ObjectModule({ objectModule: module.objectModule });
  if (result.kind === "ok") return Object.freeze([]);
  return Object.freeze(
    result.diagnostics.map((diagnostic) =>
      inputDiagnostic(
        `linker-input:object-verifier:${module.moduleKey}:${diagnostic.stableDetail}`,
      ),
    ),
  );
}

function validateModuleList(
  modules: readonly AArch64LinkInputModule[],
): readonly LinkerDiagnostic[] {
  if (modules.length > 0) return Object.freeze([]);
  return Object.freeze([inputDiagnostic("linker-input:empty-object-modules")]);
}

function validateModuleShapes(
  modules: readonly AArch64LinkInputModule[],
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  for (let index = 0; index < modules.length; index += 1) {
    const module = modules[index] as unknown;
    if (module === undefined || module === null || typeof module !== "object") {
      diagnostics.push(inputDiagnostic(`linker-input:malformed-module-entry:${index}`));
      continue;
    }
    if (
      !("objectModule" in module) ||
      module.objectModule === undefined ||
      module.objectModule === null
    ) {
      const key =
        "moduleKey" in module && typeof module.moduleKey === "string"
          ? module.moduleKey
          : `<index:${index}>`;
      diagnostics.push(inputDiagnostic(`linker-input:missing-object-module:${key}`));
      continue;
    }

    const objectModule = module.objectModule as unknown;
    if (typeof objectModule !== "object") {
      const key =
        "moduleKey" in module && typeof module.moduleKey === "string"
          ? module.moduleKey
          : `<index:${index}>`;
      diagnostics.push(inputDiagnostic(`linker-input:malformed-object-module:${key}`));
      continue;
    }

    const key =
      "moduleKey" in module && typeof module.moduleKey === "string"
        ? module.moduleKey
        : `<index:${index}>`;
    for (const field of malformedObjectModuleSurfaceFields(objectModule)) {
      diagnostics.push(inputDiagnostic(`linker-input:malformed-object-module:${key}:${field}`));
    }
  }
  return Object.freeze(diagnostics);
}

function validateModuleKeys(
  modules: readonly AArch64LinkInputModule[],
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const seen = new Set<string>();

  for (const module of modules) {
    if (!("moduleKey" in module) || module.moduleKey === undefined) {
      diagnostics.push(inputDiagnostic("linker-input:missing-module-key"));
      continue;
    }
    if (module.moduleKey === "") {
      diagnostics.push(inputDiagnostic("linker-input:empty-module-key"));
      continue;
    }
    if (seen.has(module.moduleKey)) {
      diagnostics.push(inputDiagnostic(`linker-input:duplicate-module-key:${module.moduleKey}`));
    }
    seen.add(module.moduleKey);
  }

  return Object.freeze(diagnostics);
}

function validateModule(
  target: AArch64LinkerTargetSurface,
  module: AArch64LinkInputModule,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const sectionsByKey = new Map<string, AArch64ObjectSection>();

  for (const section of module.objectModule.sections) {
    sectionsByKey.set(section.stableKey, section);
    if (!target.outputSectionByObjectClass.has(section.classKey)) {
      diagnostics.push(
        inputDiagnostic(
          `linker-input:unknown-section-class:${module.moduleKey}:${section.stableKey}:${section.classKey}`,
        ),
      );
    }
  }

  if (module.objectModule.targetBackendSurfaceFingerprint !== target.backendSurfaceFingerprint) {
    diagnostics.push(
      inputDiagnostic(`linker-input:target-fingerprint-mismatch:${module.moduleKey}`),
    );
  }

  for (const symbol of module.objectModule.symbols) {
    if (symbol.kind === "external-declaration") {
      if ("sectionKey" in symbol) {
        diagnostics.push(
          inputDiagnostic(
            `linker-input:external-symbol-has-section:${module.moduleKey}:${symbol.stableKey}`,
          ),
        );
      }
      continue;
    }
    if (!sectionsByKey.has(symbol.sectionKey)) {
      diagnostics.push(
        inputDiagnostic(
          `linker-input:symbol-section-missing:${module.moduleKey}:${symbol.stableKey}:${symbol.sectionKey}`,
        ),
      );
    }
  }

  for (const relocation of module.objectModule.relocations) {
    diagnostics.push(...validateRelocation(target, module, sectionsByKey, relocation));
  }

  diagnostics.push(...validateByteProvenance(module, sectionsByKey));
  return Object.freeze(diagnostics);
}

function validateRelocation(
  target: AArch64LinkerTargetSurface,
  module: AArch64LinkInputModule,
  sectionsByKey: ReadonlyMap<string, AArch64ObjectSection>,
  relocation: AArch64ObjectRelocation,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const section = sectionsByKey.get(relocation.sectionKey);
  if (section === undefined) {
    diagnostics.push(
      inputDiagnostic(
        `linker-input:relocation-section-missing:${module.moduleKey}:${relocation.stableKey}:${relocation.sectionKey}`,
      ),
    );
  } else if (!isValidRange(relocation.offsetBytes, relocation.widthBytes, section.bytes.length)) {
    diagnostics.push(
      inputDiagnostic(
        `linker-input:relocation-patch-out-of-bounds:${module.moduleKey}:${relocation.stableKey}:${relocation.sectionKey}:${relocation.offsetBytes}:${relocation.widthBytes}`,
      ),
    );
  }

  const policy = target.relocationPolicyByFamily.get(relocation.family);
  if (policy === undefined) {
    diagnostics.push(
      inputDiagnostic(
        `linker-input:unknown-relocation-family:${module.moduleKey}:${relocation.stableKey}:${relocation.family}`,
      ),
    );
  }

  if (isAArch64InstructionRelocationFamily(relocation.family)) {
    if (relocation.instructionPatch === undefined) {
      diagnostics.push(
        inputDiagnostic(
          `linker-input:instruction-relocation-missing-patch:${module.moduleKey}:${relocation.stableKey}`,
        ),
      );
    } else if (relocation.instructionPatch.encodingOwner === undefined) {
      diagnostics.push(
        inputDiagnostic(
          `linker-input:instruction-relocation-missing-encoding-owner:${module.moduleKey}:${relocation.stableKey}`,
        ),
      );
    }
  }

  if (
    relocation.family === "pageoffset-12l" &&
    relocation.instructionPatch?.encodingOwner?.accessScaleBytes === undefined
  ) {
    diagnostics.push(
      inputDiagnostic(
        `linker-input:low12-load-store-missing-access-scale:${module.moduleKey}:${relocation.stableKey}`,
      ),
    );
  }

  return Object.freeze(diagnostics);
}

function validateByteProvenance(
  module: AArch64LinkInputModule,
  sectionsByKey: ReadonlyMap<string, AArch64ObjectSection>,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const rangesBySection = new Map<string, ByteProvenanceRange[]>();

  for (const provenance of module.objectModule.byteProvenance) {
    const section = sectionsByKey.get(provenance.sectionKey);
    if (section === undefined) {
      diagnostics.push(
        inputDiagnostic(
          `linker-input:byte-provenance-section-missing:${module.moduleKey}:${provenance.stableKey}:${provenance.sectionKey}`,
        ),
      );
      continue;
    }
    if (!isValidRange(provenance.startOffsetBytes, provenance.byteLength, section.bytes.length)) {
      diagnostics.push(
        inputDiagnostic(
          `linker-input:byte-provenance-out-of-bounds:${module.moduleKey}:${provenance.stableKey}:${provenance.sectionKey}:${provenance.startOffsetBytes}:${provenance.byteLength}`,
        ),
      );
      continue;
    }
    const ranges = rangesBySection.get(provenance.sectionKey) ?? [];
    ranges.push(
      Object.freeze({
        stableKey: String(provenance.stableKey),
        startOffsetBytes: provenance.startOffsetBytes,
        endOffsetBytes: provenance.startOffsetBytes + provenance.byteLength,
      }),
    );
    rangesBySection.set(provenance.sectionKey, ranges);
  }

  for (const section of sectionsByKey.values()) {
    if (section.bytes.length === 0) continue;
    const ranges = (rangesBySection.get(section.stableKey) ?? []).sort(compareByteProvenanceRanges);
    let coveredUntilOffset = 0;
    let gapReported = false;
    for (const range of ranges) {
      if (!gapReported && range.startOffsetBytes > coveredUntilOffset) {
        diagnostics.push(
          inputDiagnostic(
            `linker-input:byte-provenance-gap:${module.moduleKey}:${section.stableKey}:${coveredUntilOffset}`,
          ),
        );
        gapReported = true;
      }
      if (range.startOffsetBytes < coveredUntilOffset) {
        diagnostics.push(
          inputDiagnostic(
            `linker-input:byte-provenance-overlap:${module.moduleKey}:${section.stableKey}:${range.stableKey}:${range.startOffsetBytes}:${coveredUntilOffset}`,
          ),
        );
      }
      coveredUntilOffset = Math.max(coveredUntilOffset, range.endOffsetBytes);
    }
    if (!gapReported && coveredUntilOffset < section.bytes.length) {
      diagnostics.push(
        inputDiagnostic(
          `linker-input:byte-provenance-gap:${module.moduleKey}:${section.stableKey}:${coveredUntilOffset}`,
        ),
      );
    }
  }

  return Object.freeze(diagnostics);
}

interface ByteProvenanceRange {
  readonly stableKey: string;
  readonly startOffsetBytes: number;
  readonly endOffsetBytes: number;
}

function compareByteProvenanceRanges(
  left: ByteProvenanceRange,
  right: ByteProvenanceRange,
): number {
  const startDifference = left.startOffsetBytes - right.startOffsetBytes;
  if (startDifference !== 0) return startDifference;

  const endDifference = left.endOffsetBytes - right.endOffsetBytes;
  return endDifference === 0
    ? compareCodeUnitStrings(left.stableKey, right.stableKey)
    : endDifference;
}

function isValidRange(
  startOffsetBytes: number,
  byteLength: number,
  containerLength: number,
): boolean {
  return (
    Number.isInteger(startOffsetBytes) &&
    Number.isInteger(byteLength) &&
    startOffsetBytes >= 0 &&
    byteLength > 0 &&
    startOffsetBytes + byteLength <= containerLength
  );
}

function aggregateFactSpending(
  modules: readonly NormalizedObjectModule[],
):
  | { readonly kind: "ok"; readonly records: readonly LinkedFactSpendingRecord[] }
  | { readonly kind: "error"; readonly diagnostics: readonly LinkerDiagnostic[] } {
  const recordsByStableKey = new Map<
    string,
    { readonly authority: string; readonly payload: string; readonly sourceModuleKeys: Set<string> }
  >();
  const diagnostics: LinkerDiagnostic[] = [];

  for (const module of modules) {
    for (const record of module.objectModule.factSpending) {
      const existing = recordsByStableKey.get(record.stableKey);
      if (existing === undefined) {
        recordsByStableKey.set(record.stableKey, {
          authority: record.authority,
          payload: record.payload,
          sourceModuleKeys: new Set([module.moduleKey]),
        });
        continue;
      }
      if (existing.authority !== record.authority || existing.payload !== record.payload) {
        diagnostics.push(
          inputDiagnostic(`linker-input:fact-spending-conflict:${record.stableKey}`),
        );
        continue;
      }
      existing.sourceModuleKeys.add(module.moduleKey);
    }
  }

  if (diagnostics.length > 0) return { kind: "error", diagnostics: Object.freeze(diagnostics) };

  return {
    kind: "ok",
    records: Object.freeze(
      [...recordsByStableKey.entries()]
        .map(([stableKey, record]) =>
          Object.freeze({
            stableKey,
            authority: record.authority,
            payload: record.payload,
            sourceModuleKeys: Object.freeze(
              [...record.sourceModuleKeys].sort(compareCodeUnitStrings),
            ),
          }),
        )
        .sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
    ),
  };
}

function freezeNormalizedModule(module: AArch64LinkInputModule): NormalizedObjectModule {
  return Object.freeze({
    moduleKey: module.moduleKey,
    moduleFingerprint: module.objectModule.deterministicMetadata.moduleFingerprint,
    syntheticProviderKey: module.syntheticProviderKey,
    syntheticObjectKey: module.syntheticObjectKey,
    objectModule: module.objectModule,
  });
}

function inputDiagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_INPUT_INVALID",
    ownerKey: "object-normalization",
    stableDetail,
  });
}
