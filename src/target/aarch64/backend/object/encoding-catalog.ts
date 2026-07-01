import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import { stableHash, stableJson } from "../../../../shared/stable-json";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import type {
  AArch64EncodingCatalog,
  AArch64EncodingCatalogEntry,
  AArch64InstructionWordPattern,
  AArch64KnownByteFixture,
  AArch64KnownByteFixtureId,
  AArch64PhysicalOpcode,
} from "../api/backend-catalog-interfaces";
import { IMPLEMENTED_AARCH64_ENCODER_OPCODES } from "./encoding-opcodes";
import { wordToU32Le } from "./encoding-core";

export interface AArch64AuthoredEncodingCatalogEntry extends AArch64EncodingCatalogEntry {
  readonly family: string;
  readonly requiredFeatures: readonly string[];
  readonly knownByteFixtureIds: readonly AArch64KnownByteFixtureId[];
  readonly permitsSp: boolean;
  readonly permitsZr: boolean;
}

export interface AArch64AuthoredEncodingCatalog {
  readonly supportedFeatures: readonly string[];
  readonly fixtures: readonly AArch64KnownByteFixture[];
  readonly entries: readonly AArch64AuthoredEncodingCatalogEntry[];
}

export function authenticateAArch64EncodingCatalog(
  input: AArch64AuthoredEncodingCatalog,
): AArch64BackendResult<AArch64EncodingCatalog> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const fixtures = normalizeKnownByteFixtures(input.fixtures);
  const supportedFeatureList = Object.freeze(
    [...new Set(input.supportedFeatures)].sort(compareCodeUnitStrings),
  );
  const fixtureIds = new Set(fixtures.map((fixture) => fixture.fixtureId));
  const supportedFeatures = new Set(supportedFeatureList);
  const seenEntries = new Set<string>();
  const seenOpcodeForms = new Set<string>();
  const entries = input.entries.map(normalizeEntry).sort(compareEntriesByOpcode);

  for (const entry of entries) {
    const hasSeenEntry = seenEntries.has(entry.stableKey);
    if (hasSeenEntry) {
      diagnostics.push(diagnostic(`encoding-catalog:duplicate-entry:${entry.stableKey}`));
    }
    seenEntries.add(entry.stableKey);
    const opcodeFormKey = opcodeFormStableKey(entry);
    if (!hasSeenEntry && seenOpcodeForms.has(opcodeFormKey)) {
      diagnostics.push(diagnostic(`encoding-catalog:duplicate-opcode-form:${entry.opcode}`));
    }
    if (!hasSeenEntry) seenOpcodeForms.add(opcodeFormKey);

    for (const fixtureId of entry.knownByteFixtureIds) {
      if (!fixtureIds.has(fixtureId)) {
        diagnostics.push(
          diagnostic(`encoding-catalog:missing-known-byte-fixture:${entry.opcode}:${fixtureId}`),
        );
      }
    }
    for (const feature of entry.requiredFeatures) {
      if (!supportedFeatures.has(feature)) {
        diagnostics.push(
          diagnostic(`encoding-catalog:unsupported-feature:${entry.opcode}:${feature}`),
        );
      }
    }
    if (entry.permitsSp && entry.permitsZr) {
      diagnostics.push(diagnostic(`encoding-catalog:sp-zr-ambiguous:${entry.opcode}`));
    }
    if (entry.relocationHole !== undefined && entry.relocationHole.owner === undefined) {
      diagnostics.push(
        diagnostic(
          `encoding-catalog:relocation-hole-without-owner:${entry.opcode}:${entry.relocationHole.bitRange[0]}-${entry.relocationHole.bitRange[1]}`,
        ),
      );
    }
    if (
      IMPLEMENTED_AARCH64_ENCODER_OPCODES.includes(entry.opcode) &&
      (entry.instructionWordPatterns ?? []).length === 0
    ) {
      diagnostics.push(diagnostic(`encoding-catalog:missing-word-pattern:${entry.opcode}`));
    }
    for (const pattern of entry.instructionWordPatterns ?? []) {
      if (pattern.mask >>> 0 === 0) {
        diagnostics.push(diagnostic(`encoding-catalog:empty-word-pattern:${entry.opcode}`));
      }
    }
    for (const fixtureId of entry.knownByteFixtureIds) {
      const fixture = fixtures.find((candidate) => candidate.fixtureId === fixtureId);
      if (fixture === undefined || fixture.bytes.length !== 4) continue;
      if ((entry.instructionWordPatterns ?? []).length === 0) continue;
      const word = wordToU32Le(fixture.bytes);
      const matchesEntryPattern = (entry.instructionWordPatterns ?? []).some(
        (pattern) => (word & pattern.mask) >>> 0 === pattern.value,
      );
      if (!matchesEntryPattern) {
        diagnostics.push(
          diagnostic(
            `encoding-catalog:known-byte-fixture-pattern-mismatch:${entry.opcode}:${fixtureId}`,
          ),
        );
      }
    }
  }

  if (diagnostics.length > 0) return backendError(diagnostics);

  const frozenEntries = Object.freeze(entries.map((entry) => Object.freeze({ ...entry })));
  const catalog: AArch64EncodingCatalog = Object.freeze({
    fingerprint: computeEncodingCatalogFingerprint({
      supportedFeatures: supportedFeatureList,
      fixtures,
      entries: frozenEntries,
    }),
    entries: frozenEntries,
    entryForOpcode: (opcode: AArch64PhysicalOpcode) =>
      frozenEntries.find((entry) => entry.opcode === opcode),
    knownByteFixtureFor: (fixtureId: AArch64KnownByteFixtureId) =>
      fixtures.find((fixture) => fixture.fixtureId === fixtureId),
  });
  return backendOk(catalog);
}

function opcodeFormStableKey(entry: AArch64AuthoredEncodingCatalogEntry): string {
  return stableJson({
    opcode: entry.opcode,
    family: entry.family,
    permitsSp: entry.permitsSp,
    permitsZr: entry.permitsZr,
    relocationHole: entry.relocationHole,
  });
}

function computeEncodingCatalogFingerprint(input: {
  readonly supportedFeatures: readonly string[];
  readonly fixtures: readonly AArch64KnownByteFixture[];
  readonly entries: readonly AArch64AuthoredEncodingCatalogEntry[];
}): string {
  return `encoding-catalog:${stableHash(stableJson(input))}`;
}

function compareEntriesByOpcode(
  left: AArch64AuthoredEncodingCatalogEntry,
  right: AArch64AuthoredEncodingCatalogEntry,
): number {
  const opcode = compareCodeUnitStrings(left.opcode, right.opcode);
  if (opcode !== 0) return opcode;
  return compareCodeUnitStrings(left.stableKey, right.stableKey);
}

function normalizeEntry(
  entry: AArch64AuthoredEncodingCatalogEntry,
): AArch64AuthoredEncodingCatalogEntry {
  return Object.freeze({
    ...entry,
    requiredFeatures: Object.freeze([...entry.requiredFeatures].sort(compareCodeUnitStrings)),
    knownByteFixtureIds: Object.freeze([...entry.knownByteFixtureIds].sort(compareCodeUnitStrings)),
    ...(entry.relocationHole === undefined
      ? {}
      : {
          relocationHole: Object.freeze({
            ...entry.relocationHole,
            bitRange: Object.freeze([...entry.relocationHole.bitRange]) as readonly [
              number,
              number,
            ],
          }),
        }),
    instructionWordPatterns: Object.freeze(
      [...(entry.instructionWordPatterns ?? [])]
        .map((pattern) => normalizeInstructionWordPattern(pattern))
        .sort(compareInstructionWordPatterns),
    ),
  });
}

function normalizeInstructionWordPattern(
  pattern: AArch64InstructionWordPattern,
): AArch64InstructionWordPattern {
  const mask = pattern.mask >>> 0;
  return Object.freeze({
    ...pattern,
    mask,
    value: ((pattern.value >>> 0) & mask) >>> 0,
  });
}

function compareInstructionWordPatterns(
  left: AArch64InstructionWordPattern,
  right: AArch64InstructionWordPattern,
): number {
  return (
    left.mask - right.mask ||
    left.value - right.value ||
    compareCodeUnitStrings(left.source, right.source)
  );
}

function normalizeKnownByteFixtures(
  fixtures: readonly AArch64KnownByteFixture[],
): readonly AArch64KnownByteFixture[] {
  return Object.freeze(
    fixtures
      .map((fixture) =>
        Object.freeze({
          ...fixture,
          ...(fixture.operands === undefined
            ? {}
            : { operands: Object.freeze([...fixture.operands]) }),
          bytes: Object.freeze([...fixture.bytes]),
        }),
      )
      .sort((left, right) => compareCodeUnitStrings(left.fixtureId, right.fixtureId)),
  );
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_ENCODING_INVALID",
    stableDetail,
    ownerKey: "encoding-catalog",
    rootCauseKey: stableDetail,
  });
}
