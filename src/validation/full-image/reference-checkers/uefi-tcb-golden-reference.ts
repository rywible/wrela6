import { uefiAArch64PlatformPrimitiveNameCatalog } from "../../../target/uefi-aarch64/platform-catalog";
import type {
  UefiFirmwareTableFieldRecord,
  UefiAArch64TargetDriverSurface,
} from "../../../target/uefi-aarch64";
import type { FullImageValidationCheckReport, FullImageValidationEvidenceRecord } from "../report";
import { referenceCheckReport, referenceEvidence } from "./report-builders";
import type { FullImageReferenceChecker, FullImageReferenceCheckerInput } from "./types";
import { FULL_IMAGE_UEFI_TCB_GOLDEN } from "./uefi-tcb-golden-fixtures";

const CHECKER_KEY = "uefi-tcb-golden-reference";
const INPUT_AUTHORITY = Object.freeze(["compiler-trace", "golden"] as const);

export function uefiTcbGoldenReferenceChecker(): FullImageReferenceChecker {
  return Object.freeze({
    checkerKey: CHECKER_KEY,
    allowedAuthorities: INPUT_AUTHORITY,
    requiredWhenCompilePassed: true,
    run: runUefiTcbGoldenReferenceChecker,
  });
}

function runUefiTcbGoldenReferenceChecker(
  input: FullImageReferenceCheckerInput,
): readonly FullImageValidationCheckReport[] {
  if (input.trace === undefined) {
    return Object.freeze([
      report({
        status: "skipped",
        stableDetail: "uefi-tcb-golden:trace-missing",
        evidence: [
          evidence("compiler-trace", "trace.target", "trace target unavailable"),
          evidence("golden", "golden.fixture", "FULL_IMAGE_UEFI_TCB_GOLDEN"),
        ],
      }),
    ]);
  }

  const diagnostics = [
    ...targetKeyDiagnostics(input.trace.target),
    ...statusDiagnostics(input.trace.target),
    ...firmwareTableDiagnostics(input.trace.target),
    ...platformNameDiagnostics(),
    ...runtimeHelperDiagnostics(input.trace.target),
    ...entryProfileDiagnostics(input.trace.target),
  ];

  if (diagnostics.length > 0) {
    return Object.freeze(
      diagnostics.map((diagnostic) =>
        report({
          status: "failed",
          stableDetail: diagnostic.stableDetail,
          evidence: diagnostic.evidence,
        }),
      ),
    );
  }

  return Object.freeze([
    report({
      status: "passed",
      stableDetail: "uefi-tcb-golden:matched",
      evidence: [
        evidence("compiler-trace", "trace.target", "uefi target TCB records"),
        evidence("golden", "golden.fixture", "FULL_IMAGE_UEFI_TCB_GOLDEN"),
      ],
    }),
  ]);
}

interface GoldenDiagnostic {
  readonly stableDetail: string;
  readonly evidence: readonly FullImageValidationEvidenceRecord[];
}

function targetKeyDiagnostics(target: UefiAArch64TargetDriverSurface): readonly GoldenDiagnostic[] {
  return compareGoldenValue(
    "target-key",
    "targetKey",
    target.targetKey,
    FULL_IMAGE_UEFI_TCB_GOLDEN.targetKey,
  );
}

function statusDiagnostics(target: UefiAArch64TargetDriverSurface): readonly GoldenDiagnostic[] {
  return Object.freeze([
    ...compareGoldenValue(
      "status",
      "success",
      target.statusPolicy.success,
      FULL_IMAGE_UEFI_TCB_GOLDEN.status.success.value,
    ),
    ...compareGoldenValue(
      "status",
      "invalidParameter",
      target.statusPolicy.invalidParameter,
      FULL_IMAGE_UEFI_TCB_GOLDEN.status.invalidParameter.value,
    ),
    ...compareGoldenValue(
      "status",
      "badBufferSize",
      target.statusPolicy.badBufferSize,
      FULL_IMAGE_UEFI_TCB_GOLDEN.status.badBufferSize.value,
    ),
    ...compareGoldenValue(
      "status",
      "bufferTooSmall",
      target.statusPolicy.bufferTooSmall,
      FULL_IMAGE_UEFI_TCB_GOLDEN.status.bufferTooSmall.value,
    ),
    ...compareGoldenValue(
      "status",
      "unsupported",
      target.statusPolicy.unsupported,
      FULL_IMAGE_UEFI_TCB_GOLDEN.status.unsupported.value,
    ),
    ...compareGoldenValue(
      "status",
      "aborted",
      target.statusPolicy.aborted,
      FULL_IMAGE_UEFI_TCB_GOLDEN.status.aborted.value,
    ),
    ...compareGoldenValue(
      "status",
      "panicStatus",
      target.statusPolicy.panicStatus,
      FULL_IMAGE_UEFI_TCB_GOLDEN.status.panicStatus,
    ),
  ]);
}

function firmwareTableDiagnostics(
  target: UefiAArch64TargetDriverSurface,
): readonly GoldenDiagnostic[] {
  const recordsByKey = new Map(
    target.firmwareTables.records.map((record) => [firmwareTableRecordKey(record), record]),
  );
  const diagnostics: GoldenDiagnostic[] = [];
  for (const [goldenKey, goldenRecord] of Object.entries(
    FULL_IMAGE_UEFI_TCB_GOLDEN.firmwareTables,
  )) {
    const record = recordsByKey.get(goldenKey);
    if (record === undefined) {
      diagnostics.push(goldenMismatch("firmware-table", goldenKey, "missing", goldenRecord));
      continue;
    }
    diagnostics.push(
      ...compareGoldenValue(
        "firmware-table",
        `${goldenKey}.offsetBytes`,
        record.offsetBytes,
        goldenRecord.offsetBytes,
      ),
      ...compareGoldenValue(
        "firmware-table",
        `${goldenKey}.valueKind`,
        record.valueKind,
        goldenRecord.valueKind,
      ),
      ...compareGoldenValue(
        "firmware-table",
        `${goldenKey}.requiredBeforeExitBootServices`,
        record.requiredBeforeExitBootServices,
        goldenRecord.requiredBeforeExitBootServices,
      ),
    );
  }
  return Object.freeze(diagnostics);
}

function platformNameDiagnostics(): readonly GoldenDiagnostic[] {
  const catalog = uefiAArch64PlatformPrimitiveNameCatalog();
  const diagnostics: GoldenDiagnostic[] = [];
  for (const [sourceName, primitiveId] of Object.entries(
    FULL_IMAGE_UEFI_TCB_GOLDEN.platformNames,
  )) {
    diagnostics.push(
      ...compareGoldenValue(
        "platform-name",
        sourceName,
        String(catalog.byName(sourceName)?.primitiveId ?? "missing"),
        primitiveId,
      ),
    );
  }
  return Object.freeze(diagnostics);
}

function runtimeHelperDiagnostics(
  target: UefiAArch64TargetDriverSurface,
): readonly GoldenDiagnostic[] {
  const materializationsByRuntimeId = new Map(
    target.runtimeMaterializations.map((materialization) => [
      String(materialization.runtimeId),
      materialization,
    ]),
  );
  const diagnostics: GoldenDiagnostic[] = [];
  for (const [runtimeId, goldenHelper] of Object.entries(
    FULL_IMAGE_UEFI_TCB_GOLDEN.runtimeHelpers,
  )) {
    const materialization = materializationsByRuntimeId.get(runtimeId);
    if (materialization === undefined) {
      diagnostics.push(goldenMismatch("runtime-helper", runtimeId, "missing", goldenHelper));
      continue;
    }
    diagnostics.push(
      ...compareGoldenValue(
        "runtime-helper",
        `${runtimeId}.linkageName`,
        materialization.linkageName,
        goldenHelper.linkageName,
      ),
      ...compareGoldenValue(
        "runtime-helper",
        `${runtimeId}.convention`,
        materialization.convention,
        goldenHelper.convention,
      ),
      ...compareGoldenValue(
        "runtime-helper",
        `${runtimeId}.materialization`,
        materialization.materialization,
        goldenHelper.materialization,
      ),
    );
  }
  return Object.freeze(diagnostics);
}

function entryProfileDiagnostics(
  target: UefiAArch64TargetDriverSurface,
): readonly GoldenDiagnostic[] {
  const diagnostics: GoldenDiagnostic[] = [];
  for (const [field, expected] of Object.entries(FULL_IMAGE_UEFI_TCB_GOLDEN.entryProfile)) {
    diagnostics.push(
      ...compareGoldenValue(
        "entry-profile",
        field,
        target.entryProfile[field as keyof typeof FULL_IMAGE_UEFI_TCB_GOLDEN.entryProfile],
        expected,
      ),
    );
  }
  return Object.freeze(diagnostics);
}

function compareGoldenValue(
  section: string,
  goldenKey: string,
  actual: unknown,
  expected: unknown,
): readonly GoldenDiagnostic[] {
  if (actual === expected) return Object.freeze([]);
  return Object.freeze([goldenMismatch(section, goldenKey, actual, expected)]);
}

function goldenMismatch(
  section: string,
  goldenKey: string,
  actual: unknown,
  expected: unknown,
): GoldenDiagnostic {
  return Object.freeze({
    stableDetail: `uefi-tcb-golden:${section}:${goldenKey}`,
    evidence: Object.freeze([
      evidence(
        "compiler-trace",
        `${section}:${goldenKey}`,
        `actual:${formatEvidenceValue(actual)}`,
      ),
      evidence("golden", `${section}:${goldenKey}`, `expected:${formatEvidenceValue(expected)}`),
    ]),
  });
}

function report(input: {
  readonly status: FullImageValidationCheckReport["status"];
  readonly stableDetail: string;
  readonly evidence: readonly FullImageValidationEvidenceRecord[];
}): FullImageValidationCheckReport {
  return referenceCheckReport({
    checkerKey: CHECKER_KEY,
    status: input.status,
    stableDetail: input.stableDetail,
    inputAuthority: INPUT_AUTHORITY,
    evidence: input.evidence,
  });
}

function evidence(
  authority: FullImageValidationEvidenceRecord["authority"],
  evidenceKey: string,
  stableDetail: string,
): FullImageValidationEvidenceRecord {
  return referenceEvidence({ authority, evidenceKey, stableDetail });
}

function firmwareTableRecordKey(record: UefiFirmwareTableFieldRecord): string {
  return `${record.tableKey}:${record.fieldKey}`;
}

function formatEvidenceValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString(16);
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
}
