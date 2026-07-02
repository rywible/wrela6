import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import { stableHash, stableJson } from "../shared/stable-json";
import {
  linkerDiagnostic,
  linkerError,
  linkerOk,
  type LinkerDiagnostic,
  type LinkerResult,
} from "./diagnostics";
import {
  AARCH64_PRODUCTION_SECTION_MAPPINGS,
  AARCH64_REQUIRED_OBJECT_SECTION_CLASSES,
  WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS,
} from "./aarch64/aarch64-section-policy";
import {
  AARCH64_PRODUCTION_RELOCATION_FAMILIES,
  AARCH64_REQUIRED_LINK_RELOCATION_FAMILIES,
} from "./aarch64/aarch64-relocation-policy";
import type { AArch64InternalRelocationFamily } from "../target/aarch64/backend/object/relocation-records";
import type {
  AArch64LinkRelocationBounds,
  AArch64RelocationFieldSlice,
} from "./aarch64/aarch64-relocation-policy";

export interface AArch64LinkerTargetConstants {
  readonly preferredImageBase: bigint;
  readonly sectionAlignmentBytes: number;
  readonly firstSectionRva: number;
  readonly machine: number;
  readonly subsystem: number;
  readonly maxImageSizeBytes: number;
  readonly sectionFlags: Readonly<Record<string, number>>;
}

export interface AArch64SectionMappingPolicy {
  readonly objectSectionClass: string;
  readonly outputSectionKey: string;
}

export interface AArch64RelocationFamilyPolicy {
  readonly family: AArch64InternalRelocationFamily;
  readonly bounds: AArch64LinkRelocationBounds;
  readonly fieldSlices?: readonly AArch64RelocationFieldSlice[];
  readonly allowAbsoluteForV1?: boolean;
}

export interface AArch64EntryPolicy {
  readonly loaderEntryLinkageName: string;
  readonly requiresBootHandoff: boolean;
  readonly requiredEntrySectionClass: "executable";
}

export interface AArch64BaseRelocationPolicy {
  readonly families: readonly AArch64InternalRelocationFamily[];
  readonly kindByFamily: Partial<Record<AArch64InternalRelocationFamily, "dir64" | "highlow">>;
}

export interface AArch64ContributionAlignmentPolicy {
  readonly contributionAlignmentBytes?: number;
  readonly contributionAlignmentBytesByOutputSection?: Readonly<Record<string, number>>;
  readonly contributionAlignmentBytesByObjectSectionClass?: Readonly<Record<string, number>>;
}

export interface AArch64LinkerTargetSurfaceInput {
  readonly targetKey: string;
  readonly backendSurfaceFingerprint: string;
  readonly relocationCatalogFingerprint: string;
  readonly constants: AArch64LinkerTargetConstants;
  readonly sectionMappings: readonly AArch64SectionMappingPolicy[];
  readonly relocationFamilies: readonly AArch64RelocationFamilyPolicy[];
  readonly entryPolicy: AArch64EntryPolicy;
  readonly baseRelocationPolicy: AArch64BaseRelocationPolicy;
  readonly contributionAlignment?: AArch64ContributionAlignmentPolicy;
}

export interface AArch64LinkerTargetSurface extends AArch64LinkerTargetSurfaceInput {
  readonly outputSectionByObjectClass: ReadonlyLookupTable<string, string>;
  readonly objectClassesByOutputSection: ReadonlyLookupTable<string, readonly string[]>;
  readonly relocationPolicyByFamily: ReadonlyLookupTable<string, AArch64RelocationFamilyPolicy>;
  readonly targetPolicyFingerprint: string;
}

export interface ReadonlyLookupTable<Key, Value> {
  get(key: Key): Value | undefined;
  has(key: Key): boolean;
  entries(): IterableIterator<readonly [Key, Value]>;
}

const POLICY_VERIFICATION = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "aarch64-linker-target-surface",
      runKey: "authenticate",
      status: "passed" as const,
    }),
  ]),
});

export function authenticateAArch64LinkerTargetSurface(input?: {
  readonly backendSurfaceFingerprint: string;
  readonly relocationCatalogFingerprint: string;
}): LinkerResult<AArch64LinkerTargetSurface>;
export function authenticateAArch64LinkerTargetSurface(
  input: AArch64LinkerTargetSurfaceInput,
): LinkerResult<AArch64LinkerTargetSurface>;
export function authenticateAArch64LinkerTargetSurface(
  input: unknown = {
    backendSurfaceFingerprint: "backend-target-surface-fingerprint",
    relocationCatalogFingerprint: "relocation-catalog-fingerprint",
  },
): LinkerResult<AArch64LinkerTargetSurface> {
  const shapedInput = targetSurfaceAuthenticationInput(input);
  if (shapedInput.kind === "error") {
    return linkerError({
      diagnostics: shapedInput.diagnostics,
      verification: POLICY_VERIFICATION,
    });
  }

  const surfaceInput =
    shapedInput.kind === "full"
      ? shapedInput.value
      : createAArch64ProductionTargetSurfaceInput(shapedInput.value);
  const diagnostics = [
    ...validateTargetKey(surfaceInput),
    ...validateConstants(surfaceInput.constants),
    ...validateSectionMappings(surfaceInput.sectionMappings),
    ...validateRelocationFamilies(surfaceInput.relocationFamilies),
    ...validateEntryPolicy(surfaceInput.entryPolicy),
    ...validateBaseRelocationPolicy(surfaceInput.baseRelocationPolicy),
    ...validateContributionAlignmentPolicy(surfaceInput.contributionAlignment),
  ].sort(compareDiagnosticsByStableDetail);

  if (diagnostics.length > 0) {
    return linkerError({
      diagnostics,
      verification: POLICY_VERIFICATION,
    });
  }

  return linkerOk({
    value: buildTargetSurface(surfaceInput),
    verification: POLICY_VERIFICATION,
  });
}

function buildTargetSurface(input: AArch64LinkerTargetSurfaceInput): AArch64LinkerTargetSurface {
  const sectionMappings = input.sectionMappings
    .map((mapping) => Object.freeze({ ...mapping }))
    .sort((left, right) =>
      compareCodeUnitStrings(left.objectSectionClass, right.objectSectionClass),
    );
  const relocationFamilies = input.relocationFamilies
    .map((family) =>
      Object.freeze({
        ...family,
        fieldSlices: family.fieldSlices?.map((slice) => Object.freeze({ ...slice })),
      }),
    )
    .sort((left, right) => compareCodeUnitStrings(left.family, right.family));
  const contributionAlignment = normalizeContributionAlignmentPolicy(input.contributionAlignment);

  const outputSectionByObjectClass = new Map<string, string>();
  const objectClassesByOutputSection = new Map<string, readonly string[]>();
  for (const mapping of sectionMappings) {
    outputSectionByObjectClass.set(mapping.objectSectionClass, mapping.outputSectionKey);
    objectClassesByOutputSection.set(mapping.outputSectionKey, [
      ...(objectClassesByOutputSection.get(mapping.outputSectionKey) ?? []),
      mapping.objectSectionClass,
    ]);
  }
  for (const [outputSectionKey, objectClasses] of objectClassesByOutputSection) {
    objectClassesByOutputSection.set(
      outputSectionKey,
      Object.freeze([...objectClasses].sort(compareCodeUnitStrings)),
    );
  }

  const relocationPolicyByFamily = new Map<string, AArch64RelocationFamilyPolicy>();
  for (const familyPolicy of relocationFamilies) {
    relocationPolicyByFamily.set(familyPolicy.family, familyPolicy);
  }

  const fingerprintInput = {
    targetKey: input.targetKey,
    backendSurfaceFingerprint: input.backendSurfaceFingerprint,
    relocationCatalogFingerprint: input.relocationCatalogFingerprint,
    constants: input.constants,
    sectionMappings,
    relocationFamilies,
    entryPolicy: input.entryPolicy,
    baseRelocationPolicy: input.baseRelocationPolicy,
    ...(contributionAlignment === undefined ? {} : { contributionAlignment }),
  };

  return Object.freeze({
    ...input,
    constants: freezeConstants(input.constants),
    sectionMappings: Object.freeze(sectionMappings),
    relocationFamilies: Object.freeze(relocationFamilies),
    entryPolicy: Object.freeze({ ...input.entryPolicy }),
    baseRelocationPolicy: Object.freeze({
      families: Object.freeze(
        [...input.baseRelocationPolicy.families].sort(compareCodeUnitStrings),
      ),
      kindByFamily: Object.freeze({ ...input.baseRelocationPolicy.kindByFamily }),
    }),
    ...(contributionAlignment === undefined ? {} : { contributionAlignment }),
    outputSectionByObjectClass: createReadonlyLookupTable(outputSectionByObjectClass),
    objectClassesByOutputSection: createReadonlyLookupTable(objectClassesByOutputSection),
    relocationPolicyByFamily: createReadonlyLookupTable(relocationPolicyByFamily),
    targetPolicyFingerprint: `stable-hash:${stableHash(stableJson(fingerprintInput))}`,
  });
}

function createAArch64ProductionTargetSurfaceInput(input: {
  readonly backendSurfaceFingerprint: string;
  readonly relocationCatalogFingerprint: string;
}): AArch64LinkerTargetSurfaceInput {
  return Object.freeze({
    targetKey: "wrela-uefi-aarch64-rpi5-v1",
    backendSurfaceFingerprint: input.backendSurfaceFingerprint,
    relocationCatalogFingerprint: input.relocationCatalogFingerprint,
    constants: WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS,
    sectionMappings: AARCH64_PRODUCTION_SECTION_MAPPINGS,
    relocationFamilies: AARCH64_PRODUCTION_RELOCATION_FAMILIES,
    entryPolicy: Object.freeze({
      loaderEntryLinkageName: "__wrela_uefi_entry",
      requiresBootHandoff: true,
      requiredEntrySectionClass: "executable",
    }),
    baseRelocationPolicy: Object.freeze({
      families: Object.freeze(["addr64" as AArch64InternalRelocationFamily]),
      kindByFamily: Object.freeze({
        addr64: "dir64",
      }),
    }),
  });
}

function validateTargetKey(input: AArch64LinkerTargetSurfaceInput): readonly LinkerDiagnostic[] {
  if (input.targetKey === "wrela-uefi-aarch64-rpi5-v1") return [];
  return [diagnostic(`target-policy:invalid-target-key:${input.targetKey}`)];
}

function validateConstants(constants: AArch64LinkerTargetConstants): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const expected = WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS;
  const constantKeys = [
    "firstSectionRva",
    "machine",
    "maxImageSizeBytes",
    "preferredImageBase",
    "sectionAlignmentBytes",
    "subsystem",
  ] as const;
  diagnostics.push(
    ...validateExactKeys(
      Object.keys(constants).filter((key) => key !== "sectionFlags"),
      constantKeys,
      "constant",
    ),
  );
  for (const key of constantKeys) {
    if (constants[key] !== expected[key]) {
      diagnostics.push(
        diagnostic(`target-policy:invalid-constant:${key}:${String(constants[key])}`),
      );
    }
  }
  const expectedSectionFlags: Readonly<Record<string, number>> = expected.sectionFlags;
  diagnostics.push(
    ...validateExactKeys(Object.keys(constants.sectionFlags), Object.keys(expectedSectionFlags), {
      missing: "missing-section-flag",
      unexpected: "unexpected-section-flag",
    }),
  );
  for (const sectionKey of Object.keys(expectedSectionFlags).sort(compareCodeUnitStrings)) {
    if (
      Object.hasOwn(constants.sectionFlags, sectionKey) &&
      constants.sectionFlags[sectionKey] !== expectedSectionFlags[sectionKey]
    ) {
      diagnostics.push(
        diagnostic(
          `target-policy:invalid-section-flag:${sectionKey}:${String(constants.sectionFlags[sectionKey])}`,
        ),
      );
    }
  }
  return diagnostics;
}

function validateExactKeys(
  actualKeys: readonly string[],
  expectedKeys: readonly string[],
  recordKind: string | { readonly missing: string; readonly unexpected: string },
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const expected = new Set(expectedKeys);
  const actual = new Set(actualKeys);
  const missingKind = typeof recordKind === "string" ? `missing-${recordKind}` : recordKind.missing;
  const unexpectedKind =
    typeof recordKind === "string" ? `unexpected-${recordKind}` : recordKind.unexpected;

  for (const key of [...expected].sort(compareCodeUnitStrings)) {
    if (!actual.has(key)) {
      diagnostics.push(diagnostic(`target-policy:${missingKind}:${key}`));
    }
  }
  for (const key of [...actual].sort(compareCodeUnitStrings)) {
    if (!expected.has(key)) {
      diagnostics.push(diagnostic(`target-policy:${unexpectedKind}:${key}`));
    }
  }
  return diagnostics;
}

type TargetSurfaceAuthenticationInput =
  | {
      readonly kind: "basic";
      readonly value: {
        readonly backendSurfaceFingerprint: string;
        readonly relocationCatalogFingerprint: string;
      };
    }
  | { readonly kind: "full"; readonly value: AArch64LinkerTargetSurfaceInput }
  | { readonly kind: "error"; readonly diagnostics: readonly LinkerDiagnostic[] };

function targetSurfaceAuthenticationInput(input: unknown): TargetSurfaceAuthenticationInput {
  if (!isRecord(input)) {
    return invalidInputShape();
  }

  if (!Object.hasOwn(input, "targetKey")) {
    if (
      hasExactKeys(input, ["backendSurfaceFingerprint", "relocationCatalogFingerprint"]) &&
      typeof input.backendSurfaceFingerprint === "string" &&
      typeof input.relocationCatalogFingerprint === "string"
    ) {
      return {
        kind: "basic",
        value: {
          backendSurfaceFingerprint: input.backendSurfaceFingerprint,
          relocationCatalogFingerprint: input.relocationCatalogFingerprint,
        },
      };
    }
    return invalidInputShape();
  }

  if (
    !allowedKeysOnly(input, [
      "backendSurfaceFingerprint",
      "baseRelocationPolicy",
      "contributionAlignment",
      "constants",
      "entryPolicy",
      "relocationCatalogFingerprint",
      "relocationFamilies",
      "sectionMappings",
      "targetKey",
    ]) ||
    typeof input.targetKey !== "string" ||
    typeof input.backendSurfaceFingerprint !== "string" ||
    typeof input.relocationCatalogFingerprint !== "string" ||
    !isConstantsLike(input.constants) ||
    !isSectionMappingsLike(input.sectionMappings) ||
    !isRelocationFamiliesLike(input.relocationFamilies) ||
    !isEntryPolicyLike(input.entryPolicy) ||
    !isBaseRelocationPolicyLike(input.baseRelocationPolicy) ||
    (input.contributionAlignment !== undefined &&
      !isContributionAlignmentPolicyLike(input.contributionAlignment))
  ) {
    return invalidInputShape();
  }

  return {
    kind: "full",
    value: {
      targetKey: input.targetKey,
      backendSurfaceFingerprint: input.backendSurfaceFingerprint,
      relocationCatalogFingerprint: input.relocationCatalogFingerprint,
      constants: input.constants,
      sectionMappings: input.sectionMappings,
      relocationFamilies: input.relocationFamilies,
      entryPolicy: input.entryPolicy,
      baseRelocationPolicy: input.baseRelocationPolicy,
      ...(input.contributionAlignment === undefined
        ? {}
        : { contributionAlignment: input.contributionAlignment }),
    },
  };
}

function invalidInputShape(): TargetSurfaceAuthenticationInput {
  return { kind: "error", diagnostics: [diagnostic("target-policy:invalid-input-shape")] };
}

function isConstantsLike(value: unknown): value is AArch64LinkerTargetConstants {
  return isRecord(value) && isRecord(value.sectionFlags);
}

function isSectionMappingsLike(value: unknown): value is readonly AArch64SectionMappingPolicy[] {
  return (
    Array.isArray(value) &&
    value.every(
      (mapping) =>
        isRecord(mapping) &&
        hasExactKeys(mapping, ["objectSectionClass", "outputSectionKey"]) &&
        typeof mapping.objectSectionClass === "string" &&
        typeof mapping.outputSectionKey === "string",
    )
  );
}

function isRelocationFamiliesLike(
  value: unknown,
): value is readonly AArch64RelocationFamilyPolicy[] {
  return (
    Array.isArray(value) &&
    value.every(
      (policy) =>
        isRecord(policy) &&
        allowedKeysOnly(policy, ["allowAbsoluteForV1", "bounds", "family", "fieldSlices"]) &&
        typeof policy.family === "string" &&
        isRecord(policy.bounds) &&
        (policy.fieldSlices === undefined || isRelocationFieldSlicesLike(policy.fieldSlices)) &&
        (policy.allowAbsoluteForV1 === undefined || typeof policy.allowAbsoluteForV1 === "boolean"),
    )
  );
}

function isRelocationFieldSlicesLike(
  value: unknown,
): value is readonly AArch64RelocationFieldSlice[] {
  return (
    Array.isArray(value) &&
    value.every(
      (slice) =>
        isRecord(slice) &&
        hasExactKeys(slice, ["bitCount", "encodedValueStartBit", "instructionStartBit"]) &&
        typeof slice.bitCount === "number" &&
        typeof slice.encodedValueStartBit === "number" &&
        typeof slice.instructionStartBit === "number",
    )
  );
}

function isEntryPolicyLike(value: unknown): value is AArch64EntryPolicy {
  return (
    isRecord(value) &&
    hasExactKeys(value, [
      "loaderEntryLinkageName",
      "requiredEntrySectionClass",
      "requiresBootHandoff",
    ]) &&
    typeof value.loaderEntryLinkageName === "string" &&
    typeof value.requiresBootHandoff === "boolean" &&
    typeof value.requiredEntrySectionClass === "string"
  );
}

function isBaseRelocationPolicyLike(value: unknown): value is AArch64BaseRelocationPolicy {
  return (
    isRecord(value) &&
    hasExactKeys(value, ["families", "kindByFamily"]) &&
    Array.isArray(value.families) &&
    value.families.every((family) => typeof family === "string") &&
    isRecord(value.kindByFamily) &&
    Object.values(value.kindByFamily).every(
      (relocationKind) => relocationKind === "dir64" || relocationKind === "highlow",
    )
  );
}

function isContributionAlignmentPolicyLike(
  value: unknown,
): value is AArch64ContributionAlignmentPolicy {
  return (
    isRecord(value) &&
    allowedKeysOnly(value, [
      "contributionAlignmentBytes",
      "contributionAlignmentBytesByObjectSectionClass",
      "contributionAlignmentBytesByOutputSection",
    ]) &&
    (value.contributionAlignmentBytes === undefined ||
      typeof value.contributionAlignmentBytes === "number") &&
    (value.contributionAlignmentBytesByOutputSection === undefined ||
      isNumberRecordLike(value.contributionAlignmentBytesByOutputSection)) &&
    (value.contributionAlignmentBytesByObjectSectionClass === undefined ||
      isNumberRecordLike(value.contributionAlignmentBytesByObjectSectionClass))
  );
}

function isNumberRecordLike(value: unknown): value is Readonly<Record<string, number>> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === "number");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  return (
    Object.keys(value).sort(compareCodeUnitStrings).join("\0") ===
    [...expectedKeys].sort(compareCodeUnitStrings).join("\0")
  );
}

function allowedKeysOnly(value: Record<string, unknown>, expectedKeys: readonly string[]): boolean {
  const expected = new Set(expectedKeys);
  return Object.keys(value).every((key) => expected.has(key));
}

function validateSectionMappings(
  mappings: readonly AArch64SectionMappingPolicy[],
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const seenClasses = new Set<string>();
  const seenOutputSections = new Set<string>();
  const classCounts = countBy(mappings, (mapping) => mapping.objectSectionClass);
  const outputSectionCounts = countBy(mappings, (mapping) => mapping.outputSectionKey);
  const canonicalOutputSectionByClass: ReadonlyMap<string, string> = new Map(
    AARCH64_PRODUCTION_SECTION_MAPPINGS.map((mapping) => [
      mapping.objectSectionClass,
      mapping.outputSectionKey,
    ]),
  );
  const canonicalOutputSections: ReadonlySet<string> = new Set(
    AARCH64_PRODUCTION_SECTION_MAPPINGS.map((mapping) => mapping.outputSectionKey),
  );

  for (const mapping of [...mappings].sort((left, right) =>
    compareCodeUnitStrings(
      `${left.objectSectionClass}:${left.outputSectionKey}`,
      `${right.objectSectionClass}:${right.outputSectionKey}`,
    ),
  )) {
    if (seenClasses.has(mapping.objectSectionClass)) {
      diagnostics.push(
        diagnostic(`target-policy:duplicate-section-mapping:${mapping.objectSectionClass}`),
      );
    }
    seenClasses.add(mapping.objectSectionClass);

    if (seenOutputSections.has(mapping.outputSectionKey)) {
      diagnostics.push(
        diagnostic(`target-policy:duplicate-output-section:${mapping.outputSectionKey}`),
      );
    }
    seenOutputSections.add(mapping.outputSectionKey);

    const expectedOutputSection = canonicalOutputSectionByClass.get(mapping.objectSectionClass);
    if (expectedOutputSection === undefined) {
      diagnostics.push(
        diagnostic(
          `target-policy:unexpected-section-mapping:${mapping.objectSectionClass}:${mapping.outputSectionKey}`,
        ),
      );
    } else if (
      classCounts.get(mapping.objectSectionClass) === 1 &&
      outputSectionCounts.get(mapping.outputSectionKey) === 1 &&
      mapping.outputSectionKey !== expectedOutputSection
    ) {
      diagnostics.push(
        diagnostic(
          `target-policy:invalid-section-mapping:${mapping.objectSectionClass}:${mapping.outputSectionKey}:expected:${expectedOutputSection}`,
        ),
      );
    }

    if (!canonicalOutputSections.has(mapping.outputSectionKey)) {
      diagnostics.push(
        diagnostic(`target-policy:unexpected-output-section:${mapping.outputSectionKey}`),
      );
    }
  }

  for (const requiredClass of AARCH64_REQUIRED_OBJECT_SECTION_CLASSES) {
    if (!seenClasses.has(requiredClass)) {
      diagnostics.push(diagnostic(`target-policy:missing-section-mapping:${requiredClass}`));
    }
  }

  return diagnostics;
}

function validateRelocationFamilies(
  families: readonly AArch64RelocationFamilyPolicy[],
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const seenFamilies = new Set<string>();
  const familyCounts = countBy(families, (policy) => policy.family);
  const canonicalPolicyByFamily: ReadonlyMap<
    AArch64InternalRelocationFamily,
    AArch64RelocationFamilyPolicy
  > = new Map(AARCH64_PRODUCTION_RELOCATION_FAMILIES.map((policy) => [policy.family, policy]));

  for (const policy of [...families].sort((left, right) =>
    compareCodeUnitStrings(left.family, right.family),
  )) {
    if (seenFamilies.has(policy.family)) {
      diagnostics.push(diagnostic(`target-policy:duplicate-relocation-family:${policy.family}`));
    }
    seenFamilies.add(policy.family);

    const expectedPolicy = canonicalPolicyByFamily.get(policy.family);
    if (expectedPolicy === undefined) {
      diagnostics.push(diagnostic(`target-policy:unexpected-relocation-family:${policy.family}`));
    } else if (familyCounts.get(policy.family) === 1) {
      if (stableJson(policy.bounds) !== stableJson(expectedPolicy.bounds)) {
        diagnostics.push(diagnostic(`target-policy:invalid-relocation-bounds:${policy.family}`));
      }
      if (
        stableJson(policy.fieldSlices ?? null) !== stableJson(expectedPolicy.fieldSlices ?? null)
      ) {
        diagnostics.push(
          diagnostic(`target-policy:invalid-relocation-field-slices:${policy.family}`),
        );
      }
      if ((policy.allowAbsoluteForV1 ?? false) !== (expectedPolicy.allowAbsoluteForV1 ?? false)) {
        diagnostics.push(
          diagnostic(
            `target-policy:invalid-relocation-allow-absolute-for-v1:${policy.family}:${String(policy.allowAbsoluteForV1)}`,
          ),
        );
      }
    }
  }

  for (const requiredFamily of AARCH64_REQUIRED_LINK_RELOCATION_FAMILIES) {
    if (!seenFamilies.has(requiredFamily)) {
      diagnostics.push(diagnostic(`target-policy:missing-relocation-family:${requiredFamily}`));
    }
  }

  return diagnostics;
}

function validateEntryPolicy(policy: AArch64EntryPolicy): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  if (policy.loaderEntryLinkageName !== "__wrela_uefi_entry") {
    diagnostics.push(
      diagnostic(
        `target-policy:invalid-loader-entry-linkage-name:${policy.loaderEntryLinkageName}`,
      ),
    );
  }
  if (policy.requiredEntrySectionClass !== "executable") {
    diagnostics.push(
      diagnostic(
        `target-policy:invalid-required-entry-section-class:${policy.requiredEntrySectionClass}`,
      ),
    );
  }
  if (policy.requiresBootHandoff !== true) {
    diagnostics.push(
      diagnostic(`target-policy:invalid-requires-boot-handoff:${policy.requiresBootHandoff}`),
    );
  }
  return Object.freeze(diagnostics);
}

function validateBaseRelocationPolicy(
  policy: AArch64BaseRelocationPolicy,
): readonly LinkerDiagnostic[] {
  const diagnostics: LinkerDiagnostic[] = [];
  const families = Object.freeze([...policy.families].sort(compareCodeUnitStrings));

  if (stableJson(families) !== stableJson(["addr64"])) {
    diagnostics.push(diagnostic(`target-policy:invalid-base-relocation-families:${families}`));
  }
  if (policy.kindByFamily.addr64 !== "dir64") {
    diagnostics.push(
      diagnostic(`target-policy:invalid-base-relocation-kind:addr64:${policy.kindByFamily.addr64}`),
    );
  }
  for (const family of Object.keys(policy.kindByFamily).sort(compareCodeUnitStrings)) {
    if (family !== "addr64") {
      diagnostics.push(diagnostic(`target-policy:unexpected-base-relocation-kind:${family}`));
    }
  }

  return diagnostics;
}

function validateContributionAlignmentPolicy(
  policy: AArch64ContributionAlignmentPolicy | undefined,
): readonly LinkerDiagnostic[] {
  if (policy === undefined) return Object.freeze([]);

  const diagnostics: LinkerDiagnostic[] = [];
  pushContributionAlignmentValueDiagnostic(
    diagnostics,
    "default",
    policy.contributionAlignmentBytes,
  );

  const outputSectionKeys = new Set(
    Object.keys(WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS.sectionFlags),
  );
  for (const [outputSectionKey, alignmentBytes] of sortedNumberRecordEntries(
    policy.contributionAlignmentBytesByOutputSection,
  )) {
    if (!outputSectionKeys.has(outputSectionKey)) {
      diagnostics.push(
        diagnostic(`target-policy:unexpected-contribution-alignment-output:${outputSectionKey}`),
      );
    }
    pushContributionAlignmentValueDiagnostic(
      diagnostics,
      `output:${outputSectionKey}`,
      alignmentBytes,
    );
  }

  const objectSectionClasses = new Set(AARCH64_REQUIRED_OBJECT_SECTION_CLASSES.map(String));
  for (const [objectSectionClass, alignmentBytes] of sortedNumberRecordEntries(
    policy.contributionAlignmentBytesByObjectSectionClass,
  )) {
    if (!objectSectionClasses.has(objectSectionClass)) {
      diagnostics.push(
        diagnostic(`target-policy:unexpected-contribution-alignment-class:${objectSectionClass}`),
      );
    }
    pushContributionAlignmentValueDiagnostic(
      diagnostics,
      `class:${objectSectionClass}`,
      alignmentBytes,
    );
  }

  return Object.freeze(diagnostics);
}

function pushContributionAlignmentValueDiagnostic(
  diagnostics: LinkerDiagnostic[],
  key: string,
  alignmentBytes: number | undefined,
): void {
  if (alignmentBytes === undefined) return;
  if (!Number.isSafeInteger(alignmentBytes) || alignmentBytes < 1) {
    diagnostics.push(
      diagnostic(`target-policy:invalid-contribution-alignment:${key}:${alignmentBytes}`),
    );
  }
}

function normalizeContributionAlignmentPolicy(
  policy: AArch64ContributionAlignmentPolicy | undefined,
): AArch64ContributionAlignmentPolicy | undefined {
  if (policy === undefined) return undefined;

  const contributionAlignmentBytesByOutputSection = freezeSortedNumberRecord(
    policy.contributionAlignmentBytesByOutputSection,
  );
  const contributionAlignmentBytesByObjectSectionClass = freezeSortedNumberRecord(
    policy.contributionAlignmentBytesByObjectSectionClass,
  );
  const normalized = Object.freeze({
    ...(policy.contributionAlignmentBytes === undefined
      ? {}
      : { contributionAlignmentBytes: policy.contributionAlignmentBytes }),
    ...(contributionAlignmentBytesByOutputSection === undefined
      ? {}
      : { contributionAlignmentBytesByOutputSection }),
    ...(contributionAlignmentBytesByObjectSectionClass === undefined
      ? {}
      : { contributionAlignmentBytesByObjectSectionClass }),
  });

  return Object.keys(normalized).length === 0 ? undefined : normalized;
}

function freezeSortedNumberRecord(
  record: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> | undefined {
  const entries = sortedNumberRecordEntries(record);
  if (entries.length === 0) return undefined;
  const sorted: Record<string, number> = {};
  for (const [key, value] of entries) sorted[key] = value;
  return Object.freeze(sorted);
}

function sortedNumberRecordEntries(
  record: Readonly<Record<string, number>> | undefined,
): readonly (readonly [string, number])[] {
  if (record === undefined) return Object.freeze([]);
  return Object.freeze(
    Object.entries(record)
      .sort(([left], [right]) => compareCodeUnitStrings(left, right))
      .map((entry) => Object.freeze(entry)),
  );
}

function diagnostic(stableDetail: string): LinkerDiagnostic {
  return linkerDiagnostic({
    code: "LINKER_INPUT_INVALID",
    ownerKey: "target-policy",
    rootCauseKey: stableDetail,
    stableDetail,
  });
}

function compareDiagnosticsByStableDetail(left: LinkerDiagnostic, right: LinkerDiagnostic): number {
  return compareCodeUnitStrings(left.stableDetail, right.stableDetail);
}

function freezeConstants(constants: AArch64LinkerTargetConstants): AArch64LinkerTargetConstants {
  return Object.freeze({
    ...constants,
    sectionFlags: Object.freeze(canonicalSectionFlags(constants.sectionFlags)),
  });
}

function canonicalSectionFlags(
  sectionFlags: Readonly<Record<string, number>>,
): Readonly<Record<string, number>> {
  const ordered: Record<string, number> = {};
  for (const sectionKey of Object.keys(WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS.sectionFlags)) {
    const flags = sectionFlags[sectionKey];
    if (flags === undefined) {
      throw new RangeError(`Missing section flags after authentication: ${sectionKey}.`);
    }
    ordered[sectionKey] = flags;
  }
  return ordered;
}

function createReadonlyLookupTable<Key, Value>(
  entries: ReadonlyMap<Key, Value>,
): ReadonlyLookupTable<Key, Value> {
  const frozenEntries = Object.freeze([...entries.entries()].map((entry) => Object.freeze(entry)));
  return Object.freeze({
    get(key: Key): Value | undefined {
      return entries.get(key);
    },
    has(key: Key): boolean {
      return entries.has(key);
    },
    entries(): IterableIterator<readonly [Key, Value]> {
      return frozenEntries[Symbol.iterator]();
    },
  });
}

function countBy<Value>(
  values: readonly Value[],
  keyForValue: (value: Value) => string,
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = keyForValue(value);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}
