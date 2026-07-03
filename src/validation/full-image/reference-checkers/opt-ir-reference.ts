import type { FullImageValidationCheckReport, FullImageValidationEvidenceRecord } from "../report";
import type { FullImageValidationScenarioKey } from "../matrix";
import { referenceCheckReport, referenceEvidence } from "./report-builders";
import type { FullImageReferenceChecker, FullImageReferenceCheckerInput } from "./types";

const CHECKER_KEY = "opt-ir-reference";
const INPUT_AUTHORITY = Object.freeze(["compiler-trace"] as const);
const UEFI_CONSOLE_OUTPUT_STRING = "uefi.console.outputString";
const UEFI_SET_WATCHDOG_TIMER = "uefi.boot.setWatchdogTimer";
const UEFI_STATUS_BAD_BUFFER_SIZE_VALUE = "4";
const PACKET_COUNTER_UEFI_SOURCE_CALLS = Object.freeze([
  Object.freeze({
    evidenceKey: "uefi-reserve-restricted-memory-platform-call",
    primitiveId: "uefi.source.reserveRestrictedMemory",
  }),
  Object.freeze({
    evidenceKey: "uefi-discover-virtio-platform-call",
    primitiveId: "uefi.source.discoverVirtio",
  }),
  Object.freeze({
    evidenceKey: "uefi-bind-virtio-net-platform-call",
    primitiveId: "uefi.source.bindVirtioNet",
  }),
  Object.freeze({
    evidenceKey: "uefi-plan-machine-platform-call",
    primitiveId: "uefi.source.planMachine",
  }),
  Object.freeze({
    evidenceKey: "uefi-exit-boot-services-platform-call",
    primitiveId: "uefi.source.exitBootServices",
  }),
  Object.freeze({
    evidenceKey: "uefi-split-network-device-platform-call",
    primitiveId: "uefi.source.splitNetworkDevice",
  }),
]);

interface OptIrRequirement {
  readonly evidenceKey: string;
  readonly stableDetail: (context: OptIrCoverageContext) => string;
  readonly isCovered: (context: OptIrCoverageContext) => boolean;
}

interface OptIrCoverageContext {
  readonly operations: readonly OptIrOperationRecord[];
  readonly staticChar16Strings: readonly StaticChar16Record[];
  readonly diagnostics: readonly DiagnosticRecord[];
}

interface OptIrOperationRecord {
  readonly kind: string;
  readonly stableDetail: string;
  readonly primitiveId?: string;
  readonly validatedBufferFieldName?: string;
}

interface StaticChar16Record {
  readonly stableKey: string;
  readonly text: string;
}

interface DiagnosticRecord {
  readonly stableDetail: string;
}

const PACKET_COUNTER_REQUIREMENTS: readonly OptIrRequirement[] = Object.freeze([
  requirement(
    "integer-binary-operations",
    (context) => countDetail(integerBinaryOperations(context).length),
    (context) => integerBinaryOperations(context).length >= 1,
  ),
  requirement(
    "integer-compare-operations",
    (context) => countDetail(integerCompareOperations(context).length),
    (context) => integerCompareOperations(context).length >= 1,
  ),
  requirement(
    "packet-memory-loads",
    (context) => countDetail(packetMemoryLoadOperations(context).length),
    (context) => packetMemoryLoadOperations(context).length >= 2,
  ),
  requirement(
    "static-char16-marker:WRELA_PACKET_COUNTER_OK",
    (context) => staticMarkerDetail(context, "WRELA_PACKET_COUNTER_OK"),
    (context) => staticMarker(context, "WRELA_PACKET_COUNTER_OK") !== undefined,
  ),
  requirement(
    "uefi-console-platform-call",
    () => UEFI_CONSOLE_OUTPUT_STRING,
    (context) => hasConsolePlatformCall(context),
  ),
  ...PACKET_COUNTER_UEFI_SOURCE_CALLS.map((call) =>
    requirement(
      call.evidenceKey,
      () => call.primitiveId,
      (context) => hasPlatformCall(context, call.primitiveId),
    ),
  ),
  requirement(
    "unsupported-operation-diagnostics",
    (context) => countDetail(unsupportedDiagnostics(context).length),
    (context) => unsupportedDiagnostics(context).length === 0,
  ),
]);

const SMOKE_CONSOLE_REQUIREMENTS: readonly OptIrRequirement[] = Object.freeze([
  requirement(
    "static-char16-marker:WRELA_UEFI_SMOKE_OK",
    (context) => staticMarkerDetail(context, "WRELA_UEFI_SMOKE_OK"),
    (context) => staticMarker(context, "WRELA_UEFI_SMOKE_OK") !== undefined,
  ),
  requirement(
    "uefi-console-platform-call",
    () => UEFI_CONSOLE_OUTPUT_STRING,
    (context) => hasConsolePlatformCall(context),
  ),
  requirement(
    "unsupported-operation-diagnostics",
    (context) => countDetail(unsupportedDiagnostics(context).length),
    (context) => unsupportedDiagnostics(context).length === 0,
  ),
]);

const STATUS_ERROR_REQUIREMENTS: readonly OptIrRequirement[] = Object.freeze([
  requirement(
    "status-constant:bad_buffer_size",
    (context) => statusConstantDetail(context, UEFI_STATUS_BAD_BUFFER_SIZE_VALUE),
    (context) => hasStatusConstant(context, UEFI_STATUS_BAD_BUFFER_SIZE_VALUE),
  ),
  requirement(
    "unsupported-operation-diagnostics",
    (context) => countDetail(unsupportedDiagnostics(context).length),
    (context) => unsupportedDiagnostics(context).length === 0,
  ),
]);

const WATCHDOG_REQUIREMENTS: readonly OptIrRequirement[] = Object.freeze([
  requirement(
    "uefi-watchdog-platform-call",
    () => UEFI_SET_WATCHDOG_TIMER,
    (context) => hasPlatformCall(context, UEFI_SET_WATCHDOG_TIMER),
  ),
  requirement(
    "unsupported-operation-diagnostics",
    (context) => countDetail(unsupportedDiagnostics(context).length),
    (context) => unsupportedDiagnostics(context).length === 0,
  ),
]);
const REQUIREMENTS_BY_SCENARIO = Object.freeze({
  "smoke-console": SMOKE_CONSOLE_REQUIREMENTS,
  "packet-counter": PACKET_COUNTER_REQUIREMENTS,
  "status-error": STATUS_ERROR_REQUIREMENTS,
  "watchdog-or-boot-policy": WATCHDOG_REQUIREMENTS,
} satisfies Record<FullImageValidationScenarioKey, readonly OptIrRequirement[]>);

export function optIrReferenceChecker(): FullImageReferenceChecker {
  return Object.freeze({
    checkerKey: CHECKER_KEY,
    allowedAuthorities: INPUT_AUTHORITY,
    requiredWhenCompilePassed: true,
    run: runOptIrReferenceChecker,
  });
}

function runOptIrReferenceChecker(
  input: FullImageReferenceCheckerInput,
): readonly FullImageValidationCheckReport[] {
  if (input.trace === undefined) {
    return Object.freeze([
      report({
        status: "skipped",
        stableDetail: "opt-ir:trace-missing",
        evidence: [evidence("opt-ir", "trace packagePipeline unavailable")],
      }),
    ]);
  }

  const context = optIrCoverageContext(input);
  const requirements = requirementsForInput(input);
  const missing = requirements.filter((expected) => !expected.isCovered(context));
  if (missing.length > 0) {
    return Object.freeze(
      missing.map((expected) =>
        report({
          status: "failed",
          stableDetail: `opt-ir:${policyKey(input)}:missing-exposed-fact:${expected.evidenceKey}`,
          evidence: [evidence("missing-exposed-fact", expected.evidenceKey)],
        }),
      ),
    );
  }

  return Object.freeze([
    report({
      status: "passed",
      stableDetail: `opt-ir:${policyKey(input)}:covered`,
      evidence: requirements.map((expected) =>
        evidence(expected.evidenceKey, expected.stableDetail(context)),
      ),
    }),
  ]);
}

function requirementsForInput(input: FullImageReferenceCheckerInput): readonly OptIrRequirement[] {
  return REQUIREMENTS_BY_SCENARIO[input.scenario];
}

function optIrCoverageContext(input: FullImageReferenceCheckerInput): OptIrCoverageContext {
  const optIr = (input.trace?.packagePipeline as Record<string, unknown> | undefined)?.optIr;
  return Object.freeze({
    operations: Object.freeze(recordsAtPath(optIr, ["operations"]).map(normalizeOperation)),
    staticChar16Strings: Object.freeze(
      [
        ...recordsAtPath(optIr, ["staticChar16Strings"]),
        ...recordsAtPath(optIr, ["staticStringTable"]),
        ...recordsAtPath(optIr, ["staticChar16Table"]),
      ]
        .map(normalizeStaticChar16)
        .filter((record): record is StaticChar16Record => record !== undefined),
    ),
    diagnostics: Object.freeze(
      [
        ...recordsAtPath(optIr, ["diagnostics"]),
        ...recordsAtPath(optIr, ["program", "diagnostics"]),
      ].map(normalizeDiagnostic),
    ),
  });
}

function integerBinaryOperations(context: OptIrCoverageContext): readonly OptIrOperationRecord[] {
  return context.operations.filter(
    (operation) => operation.kind === "integerBinary" || operation.kind === "integer-binary",
  );
}

function integerCompareOperations(context: OptIrCoverageContext): readonly OptIrOperationRecord[] {
  return context.operations.filter(
    (operation) => operation.kind === "integerCompare" || operation.kind === "integer-compare",
  );
}

function packetMemoryLoadOperations(
  context: OptIrCoverageContext,
): readonly OptIrOperationRecord[] {
  return context.operations.filter(
    (operation) =>
      (operation.kind === "memoryLoad" || operation.kind === "memory-load") &&
      (operation.validatedBufferFieldName !== undefined ||
        operation.stableDetail.toLowerCase().includes("packet")),
  );
}

function hasConsolePlatformCall(context: OptIrCoverageContext): boolean {
  return hasPlatformCall(context, UEFI_CONSOLE_OUTPUT_STRING);
}

function hasPlatformCall(context: OptIrCoverageContext, primitiveId: string): boolean {
  return context.operations.some(
    (operation) =>
      (operation.kind === "platformCall" || operation.kind === "platform-call") &&
      operation.primitiveId === primitiveId,
  );
}

function hasStatusConstant(context: OptIrCoverageContext, normalizedValue: string): boolean {
  return statusConstantOperation(context, normalizedValue) !== undefined;
}

function statusConstantDetail(context: OptIrCoverageContext, normalizedValue: string): string {
  const operation = statusConstantOperation(context, normalizedValue);
  return operation === undefined ? "missing" : operation.stableDetail;
}

function statusConstantOperation(
  context: OptIrCoverageContext,
  normalizedValue: string,
): OptIrOperationRecord | undefined {
  return context.operations.find(
    (operation) =>
      operation.kind === "constant" &&
      operation.stableDetail.includes(`normalizedValue:${normalizedValue}`),
  );
}

function unsupportedDiagnostics(context: OptIrCoverageContext): readonly DiagnosticRecord[] {
  return context.diagnostics.filter((diagnostic) =>
    diagnostic.stableDetail.toLowerCase().includes("unsupported"),
  );
}

function staticMarker(
  context: OptIrCoverageContext,
  marker: string,
): StaticChar16Record | undefined {
  return context.staticChar16Strings.find((record) => record.text.includes(marker));
}

function staticMarkerDetail(context: OptIrCoverageContext, marker: string): string {
  const record = staticMarker(context, marker);
  return record === undefined ? "missing" : `${record.stableKey}:${escaped(record.text)}`;
}

function normalizeOperation(value: unknown): OptIrOperationRecord {
  if (!isRecord(value)) return { kind: "", stableDetail: "" };
  const kind = stringField(value, "kind") ?? stringField(value, "operationKind") ?? "";
  return {
    kind,
    stableDetail: stableRecordDetail(value),
    primitiveId: primitiveId(value),
    validatedBufferFieldName: validatedBufferFieldName(value),
  };
}

function validatedBufferFieldName(
  operation: Readonly<Record<string, unknown>>,
): string | undefined {
  const memoryAccess = operation.memoryAccess;
  if (!isRecord(memoryAccess)) return undefined;
  const validatedBuffer = memoryAccess.validatedBuffer;
  if (!isRecord(validatedBuffer)) return undefined;
  return stringField(validatedBuffer, "fieldName");
}

function normalizeStaticChar16(value: unknown): StaticChar16Record | undefined {
  if (!isRecord(value)) return undefined;
  const stableKey =
    stringField(value, "stableKey") ??
    stringField(value, "symbolName") ??
    stringField(value, "key");
  const text =
    stringField(value, "text") ??
    stringField(value, "value") ??
    textFromCodeUnits(numberArrayField(value, "codeUnits")) ??
    textFromUtf16LeBytes(numberArrayField(value, "bytes"));
  if (stableKey === undefined || text === undefined) return undefined;
  return { stableKey, text };
}

function normalizeDiagnostic(value: unknown): DiagnosticRecord {
  if (typeof value === "string") return { stableDetail: value };
  if (!isRecord(value)) return { stableDetail: "" };
  return { stableDetail: stableRecordDetail(value) };
}

function primitiveId(operation: Readonly<Record<string, unknown>>): string | undefined {
  const direct = stringField(operation, "primitiveId");
  if (direct !== undefined) return direct;
  const target = operation.target;
  if (isRecord(target)) {
    return (
      stringField(target, "primitiveId") ??
      stringField(target, "platformKey") ??
      stringField(target, "intrinsicKey")
    );
  }
  return undefined;
}

function textFromCodeUnits(codeUnits: readonly number[] | undefined): string | undefined {
  if (codeUnits === undefined) return undefined;
  let text = "";
  for (const codeUnit of codeUnits) {
    if (!Number.isInteger(codeUnit) || codeUnit < 0 || codeUnit > 0xffff) return undefined;
    if (codeUnit === 0) return text;
    text += String.fromCharCode(codeUnit);
  }
  return text;
}

function textFromUtf16LeBytes(bytes: readonly number[] | undefined): string | undefined {
  if (bytes === undefined) return undefined;
  if (bytes.length % 2 !== 0) return undefined;
  const codeUnits: number[] = [];
  for (let index = 0; index < bytes.length; index += 2) {
    const low = bytes[index]!;
    const high = bytes[index + 1]!;
    if (!Number.isInteger(low) || !Number.isInteger(high)) return undefined;
    if (low < 0 || low > 0xff || high < 0 || high > 0xff) return undefined;
    codeUnits.push(low | (high << 8));
  }
  return textFromCodeUnits(codeUnits);
}

function stableRecordDetail(record: Readonly<Record<string, unknown>>): string {
  const stableDetail = stringField(record, "stableDetail");
  if (stableDetail !== undefined) return stableDetail;
  return Object.entries(record)
    .map(([key, value]) => `${key}:${stableValue(value)}`)
    .sort()
    .join(",");
}

function stableValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value);
  }
  if (isRecord(value)) return stableRecordDetail(value);
  if (Array.isArray(value)) return value.map(stableValue).join("|");
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  return String(value);
}

function recordsAtPath(root: unknown, path: readonly string[]): readonly unknown[] {
  let value = root;
  for (const key of path) {
    if (!isRecord(value)) return Object.freeze([]);
    value = value[key];
  }
  if (Array.isArray(value)) return value;
  if (value instanceof Map) return [...value.values()];
  if (value instanceof Set) return [...value.values()];
  if (isRecord(value) && typeof value.entries === "function") {
    const entries = value.entries as () => Iterable<unknown>;
    return [...entries()];
  }
  return Object.freeze([]);
}

function requirement(
  evidenceKey: string,
  stableDetail: (context: OptIrCoverageContext) => string,
  isCovered: (context: OptIrCoverageContext) => boolean,
): OptIrRequirement {
  return Object.freeze({ evidenceKey, stableDetail, isCovered });
}

function countDetail(count: number): string {
  return `count:${count}`;
}

function escaped(value: string): string {
  return value.replaceAll("\r", "\\r").replaceAll("\n", "\\n");
}

function stringField(record: Readonly<Record<string, unknown>>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

function numberArrayField(
  record: Readonly<Record<string, unknown>>,
  key: string,
): readonly number[] | undefined {
  const value = record[key];
  if (!Array.isArray(value)) return undefined;
  return value.every((item): item is number => typeof item === "number") ? value : undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null;
}

function policyKey(input: FullImageReferenceCheckerInput): string {
  return input.scenario;
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

function evidence(evidenceKey: string, stableDetail: string): FullImageValidationEvidenceRecord {
  return referenceEvidence({
    evidenceKey,
    authority: "compiler-trace" as const,
    stableDetail,
  });
}
