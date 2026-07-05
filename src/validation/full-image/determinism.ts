import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type {
  FullImageValidationCaseReport,
  FullImageValidationEquivalenceEvidence,
  FullImageValidationReport,
} from "./report";

export interface FullImageValidationDeterminismComparisonInput {
  readonly left: FullImageValidationReport;
  readonly right: FullImageValidationReport;
  readonly leftArtifacts?: Readonly<Record<string, Uint8Array>>;
  readonly rightArtifacts?: Readonly<Record<string, Uint8Array>>;
}

type ComparableStatus = "passed" | "failed" | "skipped";

const ORIGIN_SENSITIVE_METADATA_KEYS = Object.freeze([
  "peCoffImageFingerprint",
  "finalImageFingerprint",
] as const);

export function compareFullImageValidationReportsForDeterminism(
  input: FullImageValidationDeterminismComparisonInput,
): readonly FullImageValidationEquivalenceEvidence[] {
  const evidence: FullImageValidationEquivalenceEvidence[] = [];
  const leftCaseKeys = input.left.cases.map((caseReport) => caseReport.caseKey);
  const rightCaseKeys = input.right.cases.map((caseReport) => caseReport.caseKey);

  if (!sameStringArray(leftCaseKeys, rightCaseKeys)) {
    evidence.push(
      failedEvidence(
        "full-image:determinism",
        uniqueStrings([...leftCaseKeys, ...rightCaseKeys]),
        `determinism:case-order:${firstStringArrayMismatch(leftCaseKeys, rightCaseKeys)}`,
      ),
    );
  }

  const rightCases = new Map(
    input.right.cases.map((caseReport) => [caseReport.caseKey, caseReport]),
  );
  for (const leftCase of input.left.cases) {
    const rightCase = rightCases.get(leftCase.caseKey);
    if (rightCase === undefined) {
      evidence.push(
        failedEvidence(
          `${leftCase.caseKey}:determinism`,
          [leftCase.caseKey],
          "determinism:case-report:missing-right",
        ),
      );
      continue;
    }

    const caseEvidence = compareCaseReportsForDeterminism(
      leftCase,
      rightCase,
      input.leftArtifacts?.[leftCase.caseKey],
      input.rightArtifacts?.[leftCase.caseKey],
    );
    evidence.push(...caseEvidence);
  }

  if (evidence.length > 0) return Object.freeze(evidence);
  return Object.freeze([
    passedEvidence("full-image:determinism", leftCaseKeys, "determinism:reports-equivalent"),
  ]);
}

export function compareFullImageValidationStdlibModeEquivalence(
  report: FullImageValidationReport,
): readonly FullImageValidationEquivalenceEvidence[] {
  const evidence: FullImageValidationEquivalenceEvidence[] = [];
  for (const scenario of [
    "smoke-console",
    "packet-counter",
    "packet-counter-real-stream",
  ] as const) {
    const cases = report.cases
      .filter((caseReport) => caseReport.scenario === scenario)
      .sort((left, right) => compareStdlibMode(left.stdlibMode, right.stdlibMode));
    const caseKeys = cases.map((caseReport) => caseReport.caseKey);

    if (caseKeys.length === 0) continue;
    if (caseKeys.length !== 3) {
      evidence.push(
        failedEvidence(
          `${scenario}:stdlib-modes`,
          caseKeys,
          `equivalence:stdlib-mode-set:expected=3:actual=${caseKeys.length}`,
        ),
      );
      continue;
    }

    const [baseline, ...others] = cases;
    if (baseline === undefined) continue;

    const mismatch = others
      .map((caseReport) => compareCasesForStdlibModeEquivalence(baseline, caseReport))
      .find((stableDetail) => stableDetail !== undefined);
    evidence.push(
      mismatch === undefined
        ? passedEvidence(
            `${scenario}:stdlib-modes`,
            caseKeys,
            "equivalence:platform-primitives-and-binary-structure",
          )
        : failedEvidence(`${scenario}:stdlib-modes`, caseKeys, mismatch),
    );
  }
  return Object.freeze(evidence);
}

function compareCaseReportsForDeterminism(
  left: FullImageValidationCaseReport,
  right: FullImageValidationCaseReport,
  leftArtifact?: Uint8Array,
  rightArtifact?: Uint8Array,
): readonly FullImageValidationEquivalenceEvidence[] {
  const evidence: FullImageValidationEquivalenceEvidence[] = [];
  const groupKey = `${left.caseKey}:determinism`;
  const comparedCases = [left.caseKey];

  if (leftArtifact !== undefined || rightArtifact !== undefined) {
    const byteMismatch = compareArtifactBytes(leftArtifact, rightArtifact);
    if (byteMismatch !== undefined) {
      evidence.push(failedEvidence(groupKey, comparedCases, byteMismatch));
    }
  }

  pushMismatch(
    evidence,
    groupKey,
    comparedCases,
    "artifact-fingerprint",
    left.artifactFingerprint,
    right.artifactFingerprint,
  );
  pushMismatch(
    evidence,
    groupKey,
    comparedCases,
    "artifact-byte-length",
    left.artifactByteLength,
    right.artifactByteLength,
  );
  pushMismatch(
    evidence,
    groupKey,
    comparedCases,
    "target-metadata",
    stableValue(left.targetMetadata),
    stableValue(right.targetMetadata),
  );
  pushMismatch(
    evidence,
    groupKey,
    comparedCases,
    "compiler-diagnostics",
    stableValue(left.compilerDiagnostics),
    stableValue(right.compilerDiagnostics),
  );
  pushMismatch(
    evidence,
    groupKey,
    comparedCases,
    "binary-checks",
    stableValue(left.binaryChecks),
    stableValue(right.binaryChecks),
  );
  pushMismatch(
    evidence,
    groupKey,
    comparedCases,
    "reference-checks",
    stableValue(left.referenceChecks),
    stableValue(right.referenceChecks),
  );

  const stageMismatch = stageRunsMismatch(left, right);
  if (stageMismatch !== undefined) {
    evidence.push(failedEvidence(groupKey, comparedCases, stageMismatch));
  }
  const caseDiagnosticMismatch = diagnosticMismatch(left.diagnostics, right.diagnostics);
  if (caseDiagnosticMismatch !== undefined) {
    evidence.push(failedEvidence(groupKey, comparedCases, caseDiagnosticMismatch));
  }

  return Object.freeze(evidence);
}

function compareCasesForStdlibModeEquivalence(
  baseline: FullImageValidationCaseReport,
  candidate: FullImageValidationCaseReport,
): string | undefined {
  const baselineMetadata = stableValue(
    metadataWithoutOriginSensitiveFields(baseline.targetMetadata),
  );
  const candidateMetadata = stableValue(
    metadataWithoutOriginSensitiveFields(candidate.targetMetadata),
  );
  if (baselineMetadata !== candidateMetadata) {
    return `equivalence:target-metadata:${baseline.caseKey}:${candidate.caseKey}`;
  }

  const expectedPrimitiveMismatch = compareRequiredEvidence(
    baseline,
    candidate,
    "expected-reachable-primitives",
    "expected-platform-primitives",
  );
  if (expectedPrimitiveMismatch !== undefined) return expectedPrimitiveMismatch;

  const reachablePrimitiveMismatch = compareRequiredEvidence(
    baseline,
    candidate,
    "reachable-platform-primitives",
    "platform-primitives",
  );
  if (reachablePrimitiveMismatch !== undefined) return reachablePrimitiveMismatch;

  const entryProfileMismatch = compareRequiredEvidence(
    baseline,
    candidate,
    "target-boot-symbol",
    "entry-profile",
  );
  if (entryProfileMismatch !== undefined) return entryProfileMismatch;

  const markerMismatch = compareRequiredStaticChar16Markers(baseline, candidate);
  if (markerMismatch !== undefined) return markerMismatch;

  const baselineBinaryStatuses = checkStatuses(baseline.binaryChecks);
  const candidateBinaryStatuses = checkStatuses(candidate.binaryChecks);
  if (!sameStringArray(baselineBinaryStatuses, candidateBinaryStatuses)) {
    return `equivalence:binary-check-statuses:${baseline.caseKey}:${candidate.caseKey}`;
  }

  const baselineReferenceStatuses = checkStatuses(baseline.referenceChecks);
  const candidateReferenceStatuses = checkStatuses(candidate.referenceChecks);
  if (!sameStringArray(baselineReferenceStatuses, candidateReferenceStatuses)) {
    return `equivalence:reference-check-statuses:${baseline.caseKey}:${candidate.caseKey}`;
  }

  return undefined;
}

function compareRequiredEvidence(
  baseline: FullImageValidationCaseReport,
  candidate: FullImageValidationCaseReport,
  evidenceKey: string,
  label: string,
): string | undefined {
  const baselineEvidence = evidenceStableDetails(baseline, evidenceKey);
  const candidateEvidence = evidenceStableDetails(candidate, evidenceKey);
  if (baselineEvidence.length === 0 || candidateEvidence.length === 0) {
    return `equivalence:${label}:missing:${baseline.caseKey}:${candidate.caseKey}:${evidenceKey}`;
  }
  if (!sameStringArray(baselineEvidence, candidateEvidence)) {
    return `equivalence:${label}:${baseline.caseKey}:${candidate.caseKey}`;
  }
  return undefined;
}

function compareRequiredStaticChar16Markers(
  baseline: FullImageValidationCaseReport,
  candidate: FullImageValidationCaseReport,
): string | undefined {
  const baselineMarkers = staticChar16MarkerKeys(baseline);
  const candidateMarkers = staticChar16MarkerKeys(candidate);
  if (baselineMarkers.length === 0 || candidateMarkers.length === 0) {
    return `equivalence:required-markers:missing:${baseline.caseKey}:${candidate.caseKey}`;
  }
  if (!sameStringArray(baselineMarkers, candidateMarkers)) {
    return `equivalence:required-markers:${baseline.caseKey}:${candidate.caseKey}`;
  }
  return undefined;
}

function pushMismatch(
  evidence: FullImageValidationEquivalenceEvidence[],
  groupKey: string,
  comparedCases: readonly string[],
  label: string,
  left: unknown,
  right: unknown,
): void {
  if (left === right) return;
  evidence.push(failedEvidence(groupKey, comparedCases, `determinism:${label}:mismatch`));
}

function compareArtifactBytes(left?: Uint8Array, right?: Uint8Array): string | undefined {
  if (left === undefined || right === undefined) {
    return `determinism:artifact-bytes:missing:${left === undefined ? "left" : "right"}`;
  }
  if (left.byteLength !== right.byteLength) {
    return `determinism:artifact-bytes:length:left=${left.byteLength}:right=${right.byteLength}`;
  }
  for (let index = 0; index < left.byteLength; index += 1) {
    const leftByte = left[index] ?? 0;
    const rightByte = right[index] ?? 0;
    if (leftByte !== rightByte) {
      return `determinism:artifact-bytes:first-mismatch:index=${index}:left=${leftByte}:right=${rightByte}`;
    }
  }
  return undefined;
}

function stageRunsMismatch(
  left: FullImageValidationCaseReport,
  right: FullImageValidationCaseReport,
): string | undefined {
  const length = Math.max(left.stageRuns.length, right.stageRuns.length);
  for (let index = 0; index < length; index += 1) {
    const leftRun = left.stageRuns[index];
    const rightRun = right.stageRuns[index];
    const leftLabel = leftRun === undefined ? "missing" : `${leftRun.runKey}/${leftRun.status}`;
    const rightLabel = rightRun === undefined ? "missing" : `${rightRun.runKey}/${rightRun.status}`;
    if (leftLabel !== rightLabel) {
      return `determinism:stage-runs:index=${index}:left=${leftLabel}:right=${rightLabel}`;
    }
  }
  return undefined;
}

function diagnosticMismatch(
  left: FullImageValidationCaseReport["diagnostics"],
  right: FullImageValidationCaseReport["diagnostics"],
): string | undefined {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftDiagnostic = left[index];
    const rightDiagnostic = right[index];
    const leftLabel =
      leftDiagnostic === undefined
        ? "missing"
        : `${leftDiagnostic.ownerKey}/${leftDiagnostic.code}/${leftDiagnostic.stableDetail}`;
    const rightLabel =
      rightDiagnostic === undefined
        ? "missing"
        : `${rightDiagnostic.ownerKey}/${rightDiagnostic.code}/${rightDiagnostic.stableDetail}`;
    if (leftLabel !== rightLabel) {
      return `determinism:case-diagnostics:index=${index}:left=${leftLabel}:right=${rightLabel}`;
    }
  }
  return undefined;
}

function evidenceStableDetails(
  caseReport: FullImageValidationCaseReport,
  evidenceKey: string,
): readonly string[] {
  return Object.freeze(
    [...caseReport.binaryChecks, ...caseReport.referenceChecks]
      .flatMap((check) => check.evidence)
      .filter((record) => record.evidenceKey === evidenceKey)
      .map((record) => record.stableDetail)
      .sort(compareCodeUnitStrings),
  );
}

function staticChar16MarkerKeys(caseReport: FullImageValidationCaseReport): readonly string[] {
  return Object.freeze(
    [...caseReport.binaryChecks, ...caseReport.referenceChecks]
      .flatMap((check) => check.evidence)
      .map((record) => record.evidenceKey)
      .filter((evidenceKey) => evidenceKey.startsWith("static-char16-marker:"))
      .map((evidenceKey) => evidenceKey.slice("static-char16-marker:".length))
      .sort(compareCodeUnitStrings),
  );
}

function checkStatuses(checks: FullImageValidationCaseReport["binaryChecks"]): readonly string[] {
  return Object.freeze(
    checks
      .map((check) => `${check.checkerKey}:${check.status satisfies ComparableStatus}`)
      .sort(compareCodeUnitStrings),
  );
}

function metadataWithoutOriginSensitiveFields(
  metadata: FullImageValidationCaseReport["targetMetadata"],
): unknown {
  if (metadata === undefined) return undefined;
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (
      ORIGIN_SENSITIVE_METADATA_KEYS.includes(
        key as (typeof ORIGIN_SENSITIVE_METADATA_KEYS)[number],
      )
    ) {
      continue;
    }
    result[key] = value;
  }
  return result;
}

function stableValue(value: unknown): string {
  if (value === undefined) return "undefined";
  return JSON.stringify(sortJsonValue(value));
}

function sortJsonValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => sortJsonValue(entry));
  if (value === null || typeof value !== "object") return value;
  const result: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort(compareCodeUnitStrings)) {
    result[key] = sortJsonValue((value as Record<string, unknown>)[key]);
  }
  return result;
}

function firstStringArrayMismatch(left: readonly string[], right: readonly string[]): string {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const leftValue = left[index] ?? "missing";
    const rightValue = right[index] ?? "missing";
    if (leftValue !== rightValue) return `index=${index}:left=${leftValue}:right=${rightValue}`;
  }
  return "none";
}

function sameStringArray(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((value, index) => value === right[index]);
}

function uniqueStrings(values: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(values)].sort(compareCodeUnitStrings));
}

function compareStdlibMode(
  left: FullImageValidationCaseReport["stdlibMode"],
  right: FullImageValidationCaseReport["stdlibMode"],
): number {
  return stdlibModeRank(left) - stdlibModeRank(right);
}

function stdlibModeRank(mode: FullImageValidationCaseReport["stdlibMode"]): number {
  if (mode === "toolchain-stdlib") return 0;
  if (mode === "ejected-stdlib") return 1;
  return 2;
}

function passedEvidence(
  groupKey: string,
  comparedCases: readonly string[],
  stableDetail: string,
): FullImageValidationEquivalenceEvidence {
  return Object.freeze({
    groupKey,
    comparedCases: Object.freeze([...comparedCases]),
    status: "passed",
    stableDetail,
  });
}

function failedEvidence(
  groupKey: string,
  comparedCases: readonly string[],
  stableDetail: string,
): FullImageValidationEquivalenceEvidence {
  return Object.freeze({
    groupKey,
    comparedCases: Object.freeze([...comparedCases]),
    status: "failed",
    stableDetail,
  });
}
