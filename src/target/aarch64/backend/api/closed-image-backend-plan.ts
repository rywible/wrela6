import { stableHash, stableJson } from "../../../../shared/stable-json";
import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  sortAArch64BackendDiagnostics,
  type AArch64BackendDiagnostic,
} from "./diagnostics";
import type { AArch64BackendTargetSurface } from "./backend-target-surface";
import type { AArch64MachineProgram } from "../../machine-ir/machine-program";
import type { AArch64AbiLocationAssignment } from "../abi/abi-classification";

export type AArch64ModuleId = string;
export type AArch64FinalSymbolVisibility = "private" | "public";

export interface AArch64FinalSymbolVisibilityRecord {
  readonly symbol: string;
  readonly visibility: AArch64FinalSymbolVisibility;
}

export interface AArch64FinalSymbolVisibilityTable {
  readonly records: readonly AArch64FinalSymbolVisibilityRecord[];
}

export interface AArch64FinalAddressTakenRecord {
  readonly symbol: string;
  readonly addressTaken: boolean;
}

export interface AArch64FinalAddressTakenTable {
  readonly records: readonly AArch64FinalAddressTakenRecord[];
}

export interface AArch64ReplacementBoundaryRecord {
  readonly symbol: string;
  readonly replacement: string;
}

export interface AArch64ReplacementBoundaryTable {
  readonly records: readonly AArch64ReplacementBoundaryRecord[];
}

export interface AArch64PublicBoundaryRecord {
  readonly caller: string;
  readonly callee: string;
}

export interface AArch64PublicBoundaryTable {
  readonly records: readonly AArch64PublicBoundaryRecord[];
}

export interface AArch64FinalPrivateConventionRecord {
  readonly caller: string;
  readonly callee: string;
  readonly argumentLocations?: readonly AArch64AbiLocationAssignment[];
  readonly resultLocations?: readonly AArch64AbiLocationAssignment[];
  readonly clobberedGprs?: readonly string[];
  readonly pinnedLiveThroughGprs?: readonly string[];
  readonly calleeSaveObligations?: readonly string[];
  readonly potentialVeneerClobberGprs?: readonly string[];
  readonly tailCallEligible?: boolean;
}

export interface AArch64ClosedImageBackendPlan {
  readonly closureKind: "closed-image" | "relocatable-public-only";
  readonly participatingModules: readonly AArch64ModuleId[];
  readonly symbolVisibility: AArch64FinalSymbolVisibilityTable;
  readonly addressTaken: AArch64FinalAddressTakenTable;
  readonly replacementBoundaries: AArch64ReplacementBoundaryTable;
  readonly publicAbiBoundaries: AArch64PublicBoundaryTable;
  readonly privateConventions: readonly AArch64FinalPrivateConventionRecord[];
  readonly authorityFingerprint: string;
}

export interface VerifyAArch64ClosedImageBackendPlanInput {
  readonly plan: AArch64ClosedImageBackendPlan;
  readonly machineProgram: AArch64MachineProgram;
  readonly target: AArch64BackendTargetSurface;
}

export type VerifyAArch64ClosedImageBackendPlanResult =
  | { readonly kind: "ok"; readonly diagnostics: readonly AArch64BackendDiagnostic[] }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] };

export function verifyAArch64ClosedImageBackendPlan(
  input: VerifyAArch64ClosedImageBackendPlanInput,
): VerifyAArch64ClosedImageBackendPlanResult {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  diagnostics.push(...duplicatePlanRecordDiagnostics(input.plan));

  const expectedAuthorityFingerprint = aarch64ClosedImageBackendPlanAuthorityFingerprint({
    closureKind: input.plan.closureKind,
    participatingModules: input.plan.participatingModules,
    symbolVisibility: input.plan.symbolVisibility,
    addressTaken: input.plan.addressTaken,
    replacementBoundaries: input.plan.replacementBoundaries,
    publicAbiBoundaries: input.plan.publicAbiBoundaries,
    privateConventions: input.plan.privateConventions,
  });

  if (expectedAuthorityFingerprint !== input.plan.authorityFingerprint) {
    diagnostics.push(diagnostic("closed-image-plan:stale-authority-fingerprint"));
  }

  if (input.plan.closureKind === "relocatable-public-only") {
    if (input.plan.privateConventions.length > 0) {
      diagnostics.push(
        diagnostic("closed-image-plan:private-convention-not-allowed:relocatable-public-only"),
      );
    }
  }

  const visibilityMap = mapBySymbolVisibility(input.plan.symbolVisibility);
  const addressTakenMap = mapByAddressTaken(input.plan.addressTaken);
  const replacementMap = mapByReplacementBoundary(input.plan.replacementBoundaries);
  const publicBoundaryMap = mapByPublicBoundary(input.plan.publicAbiBoundaries);

  for (const privateConvention of input.plan.privateConventions) {
    const visibility = visibilityMap.get(privateConvention.callee);
    if (visibility === undefined) {
      diagnostics.push(
        diagnostic(
          `closed-image-plan:private-convention-missing-visibility:${privateConvention.callee}`,
        ),
      );
      continue;
    }

    if (visibility.visibility === "public") {
      diagnostics.push(
        diagnostic(`closed-image-plan:private-convention-public:${privateConvention.callee}`),
      );
      continue;
    }

    const addressTaken = addressTakenMap.get(privateConvention.callee) ?? false;
    if (addressTaken) {
      diagnostics.push(
        diagnostic(
          `closed-image-plan:private-convention-address-taken:${privateConvention.callee}`,
        ),
      );
      continue;
    }

    const replacementBoundary = `${privateConvention.caller}:${privateConvention.callee}`;
    if (!publicBoundaryMap.has(replacementBoundary)) {
      diagnostics.push(
        diagnostic(
          `closed-image-plan:private-convention-missing-boundary:${privateConvention.caller}:${privateConvention.callee}`,
        ),
      );
      continue;
    }

    if (replacementMap.has(privateConvention.callee)) {
      diagnostics.push(
        diagnostic(`closed-image-plan:private-convention-replacement:${privateConvention.callee}`),
      );
    }
  }

  if (input.machineProgram.targetFingerprint.length === 0) {
    diagnostics.push(diagnostic("closed-image-plan:invalid-target-fingerprint"));
  }

  if (diagnostics.length > 0) {
    return { kind: "error", diagnostics: sortAArch64BackendDiagnostics(diagnostics) };
  }

  return { kind: "ok", diagnostics: [] };
}

export function normalizeAArch64ClosedImageBackendPlan(
  input: AArch64ClosedImageBackendPlan,
): AArch64ClosedImageBackendPlan {
  const normalizedSymbolVisibility = normalizeAArch64FinalSymbolVisibilityTable(
    input.symbolVisibility,
  );
  const normalizedAddressTaken = normalizeAArch64FinalAddressTakenTable(input.addressTaken);
  const normalizedReplacementBoundaries = normalizeAArch64ReplacementBoundaryTable(
    input.replacementBoundaries,
  );
  const normalizedPublicBoundaries = normalizeAArch64PublicBoundaryTable(input.publicAbiBoundaries);
  const normalizedPrivateConventions = normalizePrivateConventions(input.privateConventions);

  return Object.freeze({
    closureKind: input.closureKind,
    participatingModules: Object.freeze(
      [...input.participatingModules].sort(compareCodeUnitStrings),
    ),
    symbolVisibility: normalizedSymbolVisibility,
    addressTaken: normalizedAddressTaken,
    replacementBoundaries: normalizedReplacementBoundaries,
    publicAbiBoundaries: normalizedPublicBoundaries,
    privateConventions: Object.freeze(normalizedPrivateConventions),
    authorityFingerprint: aarch64ClosedImageBackendPlanAuthorityFingerprint({
      closureKind: input.closureKind,
      participatingModules: [...input.participatingModules].sort(compareCodeUnitStrings),
      symbolVisibility: normalizedSymbolVisibility,
      addressTaken: normalizedAddressTaken,
      replacementBoundaries: normalizedReplacementBoundaries,
      publicAbiBoundaries: normalizedPublicBoundaries,
      privateConventions: Object.freeze(normalizedPrivateConventions),
    }),
  });
}

export function aarch64ClosedImageBackendPlanAuthorityFingerprint(input: {
  readonly closureKind: "closed-image" | "relocatable-public-only";
  readonly participatingModules: readonly AArch64ModuleId[];
  readonly symbolVisibility: AArch64FinalSymbolVisibilityTable;
  readonly addressTaken: AArch64FinalAddressTakenTable;
  readonly replacementBoundaries: AArch64ReplacementBoundaryTable;
  readonly publicAbiBoundaries: AArch64PublicBoundaryTable;
  readonly privateConventions: readonly AArch64FinalPrivateConventionRecord[];
}): string {
  return stableHash(
    stableJson({
      closureKind: input.closureKind,
      participatingModules: [...input.participatingModules].sort(compareCodeUnitStrings),
      symbolVisibility: input.symbolVisibility.records,
      addressTaken: input.addressTaken.records,
      replacementBoundaries: input.replacementBoundaries.records,
      publicAbiBoundaries: input.publicAbiBoundaries.records,
      privateConventions: [...input.privateConventions].sort((left, right) =>
        compareCodeUnitStrings(`${left.caller}|${left.callee}`, `${right.caller}|${right.callee}`),
      ),
    }),
  );
}

function duplicatePlanRecordDiagnostics(
  plan: AArch64ClosedImageBackendPlan,
): readonly AArch64BackendDiagnostic[] {
  return Object.freeze([
    ...duplicateRecordDiagnostics(
      plan.participatingModules,
      (moduleId) => moduleId,
      (moduleId) => `closed-image-plan:duplicate-module:${moduleId}`,
    ),
    ...duplicateRecordDiagnostics(
      plan.symbolVisibility.records,
      (record) => record.symbol,
      (symbol) => `closed-image-plan:duplicate-symbol-visibility:${symbol}`,
    ),
    ...duplicateRecordDiagnostics(
      plan.addressTaken.records,
      (record) => record.symbol,
      (symbol) => `closed-image-plan:duplicate-address-taken:${symbol}`,
    ),
    ...duplicateRecordDiagnostics(
      plan.replacementBoundaries.records,
      (record) => record.symbol,
      (symbol) => `closed-image-plan:duplicate-replacement-boundary:${symbol}`,
    ),
    ...duplicateRecordDiagnostics(
      plan.publicAbiBoundaries.records,
      (record) => `${record.caller}:${record.callee}`,
      (boundaryKey) => `closed-image-plan:duplicate-public-boundary:${boundaryKey}`,
    ),
    ...duplicateRecordDiagnostics(
      plan.privateConventions,
      (record) => `${record.caller}:${record.callee}`,
      (boundaryKey) => `closed-image-plan:duplicate-private-convention:${boundaryKey}`,
    ),
  ]);
}

function duplicateRecordDiagnostics<RecordValue>(
  records: readonly RecordValue[],
  keyOf: (record: RecordValue) => string,
  stableDetail: (key: string) => string,
): readonly AArch64BackendDiagnostic[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const record of records) {
    const key = keyOf(record);
    if (seen.has(key)) duplicated.add(key);
    seen.add(key);
  }
  return Object.freeze(
    [...duplicated].sort(compareCodeUnitStrings).map((key) => diagnostic(stableDetail(key))),
  );
}

function normalizeAArch64FinalSymbolVisibilityTable(
  input: AArch64FinalSymbolVisibilityTable,
): AArch64FinalSymbolVisibilityTable {
  return {
    records: Object.freeze(
      [...input.records]
        .map((entry) => Object.freeze({ ...entry }))
        .sort((left, right) => compareCodeUnitStrings(left.symbol, right.symbol)),
    ),
  };
}

function normalizeAArch64FinalAddressTakenTable(
  input: AArch64FinalAddressTakenTable,
): AArch64FinalAddressTakenTable {
  return {
    records: Object.freeze(
      [...input.records]
        .map((entry) => Object.freeze({ ...entry }))
        .sort((left, right) => compareCodeUnitStrings(left.symbol, right.symbol)),
    ),
  };
}

function normalizeAArch64ReplacementBoundaryTable(
  input: AArch64ReplacementBoundaryTable,
): AArch64ReplacementBoundaryTable {
  return {
    records: Object.freeze(
      [...input.records]
        .map((entry) => Object.freeze({ ...entry }))
        .sort((left, right) =>
          compareCodeUnitStrings(
            `${left.symbol}:${left.replacement}`,
            `${right.symbol}:${right.replacement}`,
          ),
        ),
    ),
  };
}

function normalizeAArch64PublicBoundaryTable(
  input: AArch64PublicBoundaryTable,
): AArch64PublicBoundaryTable {
  return {
    records: Object.freeze(
      [...input.records]
        .map((entry) => Object.freeze({ ...entry }))
        .sort((left, right) =>
          compareCodeUnitStrings(
            `${left.caller}:${left.callee}`,
            `${right.caller}:${right.callee}`,
          ),
        ),
    ),
  };
}

function normalizePrivateConventions(
  privateConventions: readonly AArch64FinalPrivateConventionRecord[],
): readonly AArch64FinalPrivateConventionRecord[] {
  return Object.freeze(
    [...privateConventions]
      .map((convention) => Object.freeze({ ...convention }))
      .sort((left, right) => {
        const boundary = compareCodeUnitStrings(
          `${left.caller}:${left.callee}`,
          `${right.caller}:${right.callee}`,
        );
        if (boundary !== 0) return boundary;
        return compareCodeUnitStrings(stableJson(left), stableJson(right));
      }),
  );
}

function mapBySymbolVisibility(
  input: AArch64FinalSymbolVisibilityTable,
): Map<string, AArch64FinalSymbolVisibilityRecord> {
  const bySymbol = new Map<string, AArch64FinalSymbolVisibilityRecord>();
  for (const visibility of input.records) {
    bySymbol.set(visibility.symbol, visibility);
  }
  return bySymbol;
}

function mapByAddressTaken(input: AArch64FinalAddressTakenTable): Map<string, boolean> {
  const bySymbol = new Map<string, boolean>();
  for (const record of input.records) {
    bySymbol.set(record.symbol, record.addressTaken);
  }
  return bySymbol;
}

function mapByReplacementBoundary(
  input: AArch64ReplacementBoundaryTable,
): Map<string, AArch64ReplacementBoundaryRecord> {
  const bySymbol = new Map<string, AArch64ReplacementBoundaryRecord>();
  for (const record of input.records) {
    bySymbol.set(record.symbol, record);
  }
  return bySymbol;
}

function mapByPublicBoundary(
  input: AArch64PublicBoundaryTable,
): Map<string, AArch64PublicBoundaryRecord> {
  const byBoundary = new Map<string, AArch64PublicBoundaryRecord>();
  for (const record of input.records) {
    byBoundary.set(`${record.caller}:${record.callee}`, record);
  }
  return byBoundary;
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_CLOSED_IMAGE_PLAN_INVALID",
    ownerKey: "closed-image-backend-plan",
    rootCauseKey: "closed-image-plan",
    stableDetail,
  });
}
