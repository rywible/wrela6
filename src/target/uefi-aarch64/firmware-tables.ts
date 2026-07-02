import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { stableHash, stableJson } from "../../shared/stable-json";
import { uefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";

export type UefiSystemTableField =
  | "hdr"
  | "firmware-vendor"
  | "firmware-revision"
  | "con-out"
  | "boot-services"
  | "runtime-services";

export type UefiSimpleTextOutputField = "output-string";

export type UefiBootServicesField =
  | "allocate-pages"
  | "free-pages"
  | "allocate-pool"
  | "free-pool"
  | "get-memory-map"
  | "exit-boot-services"
  | "set-watchdog-timer"
  | "handle-protocol"
  | "locate-protocol"
  | "open-protocol"
  | "close-protocol"
  | "create-event"
  | "set-timer"
  | "wait-for-event"
  | "stall"
  | "exit";

export type UefiRuntimeServicesField = "hdr" | "get-time" | "set-time" | "reset-system";

export type UefiFirmwareTablePath =
  | { readonly kind: "system-table"; readonly field: UefiSystemTableField }
  | { readonly kind: "simple-text-output"; readonly field: UefiSimpleTextOutputField }
  | { readonly kind: "boot-services"; readonly field: UefiBootServicesField }
  | { readonly kind: "runtime-services"; readonly field: UefiRuntimeServicesField }
  | { readonly kind: "protocol"; readonly guid: string; readonly field: string };

export interface UefiFirmwareTableFieldRecord {
  readonly tableKey: string;
  readonly fieldKey: string;
  readonly offsetBytes: number;
  readonly valueKind: "pointer" | "functionPointer" | "u32" | "u64";
  readonly requiredBeforeExitBootServices: boolean;
}

export interface UefiAArch64FirmwareTableSurface {
  readonly records: readonly UefiFirmwareTableFieldRecord[];
}

export function canonicalUefiAArch64FirmwareTableSurface(
  overrides: Partial<UefiAArch64FirmwareTableSurface> = {},
): UefiAArch64FirmwareTableSurface {
  return Object.freeze({
    records: sortedFrozenRecords(overrides.records ?? CANONICAL_UEFI_FIRMWARE_TABLE_RECORDS),
  });
}

export function lookupUefiFirmwareTableField(
  surface: UefiAArch64FirmwareTableSurface,
  path: UefiFirmwareTablePath,
): UefiFirmwareTableFieldRecord | undefined {
  return surface.records.find((record) => recordKey(record) === pathKey(path));
}

export function validateUefiAArch64FirmwareTableSurface(
  surface: UefiAArch64FirmwareTableSurface,
): UefiAArch64TargetResult<UefiAArch64FirmwareTableSurface> {
  const stableDetail = invalidFirmwareTableDetail(surface);
  if (stableDetail !== undefined) {
    return uefiAArch64Error({
      diagnostics: [
        uefiAArch64TargetDiagnostic({
          code: "UEFI_AARCH64_FIRMWARE_ABI_FAILED",
          ownerKey: "firmware-tables",
          stableDetail,
        }),
      ],
      verification: failedVerification("firmware-tables", "surface", stableDetail),
    });
  }

  return uefiAArch64Ok({
    value: surface,
    verification: passedVerification("firmware-tables", "surface"),
  });
}

export function fingerprintUefiAArch64FirmwareTables(
  surface: UefiAArch64FirmwareTableSurface,
): string {
  return `uefi-aarch64-firmware-tables:${stableHash(stableJson(sortedFrozenRecords(surface.records)))}`;
}

const CANONICAL_UEFI_FIRMWARE_TABLE_RECORDS: readonly UefiFirmwareTableFieldRecord[] =
  Object.freeze([
    record("system-table", "hdr", 0, "pointer", false),
    record("system-table", "firmware-vendor", 24, "pointer", false),
    record("system-table", "firmware-revision", 32, "u32", false),
    record("system-table", "con-out", 64, "pointer", false),
    record("system-table", "runtime-services", 88, "pointer", false),
    record("system-table", "boot-services", 96, "pointer", true),
    record("simple-text-output", "output-string", 8, "functionPointer", false),
    record("boot-services", "allocate-pages", 40, "functionPointer", true),
    record("boot-services", "free-pages", 48, "functionPointer", true),
    record("boot-services", "get-memory-map", 56, "functionPointer", true),
    record("boot-services", "allocate-pool", 64, "functionPointer", true),
    record("boot-services", "free-pool", 72, "functionPointer", true),
    record("boot-services", "create-event", 80, "functionPointer", true),
    record("boot-services", "set-timer", 88, "functionPointer", true),
    record("boot-services", "wait-for-event", 96, "functionPointer", true),
    record("boot-services", "handle-protocol", 152, "functionPointer", true),
    record("boot-services", "stall", 248, "functionPointer", true),
    record("boot-services", "exit-boot-services", 232, "functionPointer", true),
    record("boot-services", "set-watchdog-timer", 256, "functionPointer", true),
    record("boot-services", "open-protocol", 280, "functionPointer", true),
    record("boot-services", "close-protocol", 288, "functionPointer", true),
    record("boot-services", "locate-protocol", 320, "functionPointer", true),
    record("boot-services", "exit", 216, "functionPointer", true),
    record("runtime-services", "hdr", 0, "pointer", false),
    record("runtime-services", "get-time", 24, "functionPointer", false),
    record("runtime-services", "set-time", 32, "functionPointer", false),
    record("runtime-services", "reset-system", 104, "functionPointer", false),
  ]);

function record(
  tableKey: string,
  fieldKey: string,
  offsetBytes: number,
  valueKind: UefiFirmwareTableFieldRecord["valueKind"],
  requiredBeforeExitBootServices: boolean,
): UefiFirmwareTableFieldRecord {
  return Object.freeze({
    tableKey,
    fieldKey,
    offsetBytes,
    valueKind,
    requiredBeforeExitBootServices,
  });
}

function sortedFrozenRecords(
  records: readonly UefiFirmwareTableFieldRecord[],
): readonly UefiFirmwareTableFieldRecord[] {
  return Object.freeze(
    records
      .map((entry) =>
        record(
          entry.tableKey,
          entry.fieldKey,
          entry.offsetBytes,
          entry.valueKind,
          entry.requiredBeforeExitBootServices,
        ),
      )
      .sort((left, right) => compareCodeUnitStrings(recordKey(left), recordKey(right))),
  );
}

function invalidFirmwareTableDetail(surface: UefiAArch64FirmwareTableSurface): string | undefined {
  const canonicalRecordsByKey = new Map(
    CANONICAL_UEFI_FIRMWARE_TABLE_RECORDS.map((entry) => [recordKey(entry), entry] as const),
  );
  const seen = new Set<string>();
  for (const entry of surface.records) {
    const key = recordKey(entry);
    if (seen.has(key)) return `firmware-tables:duplicate-field:${key}`;
    seen.add(key);
    if (entry.tableKey.length === 0) return "firmware-tables:missing-table-key";
    if (entry.fieldKey.length === 0) return `firmware-tables:missing-field-key:${entry.tableKey}`;
    if (!Number.isInteger(entry.offsetBytes) || entry.offsetBytes < 0) {
      return `firmware-tables:invalid-offset:${key}`;
    }
    if (!isFirmwareTableValueKind(entry.valueKind)) {
      return `firmware-tables:invalid-value-kind:${key}`;
    }
    const canonical = canonicalRecordsByKey.get(key);
    if (canonical === undefined) {
      return `firmware-tables:unexpected-field:${key}`;
    }
    if (
      entry.offsetBytes !== canonical.offsetBytes ||
      entry.valueKind !== canonical.valueKind ||
      entry.requiredBeforeExitBootServices !== canonical.requiredBeforeExitBootServices
    ) {
      return `firmware-tables:canonical-mismatch:${key}`;
    }
  }

  for (const path of CANONICAL_UEFI_FIRMWARE_TABLE_PATHS) {
    if (lookupUefiFirmwareTableField(surface, path) === undefined) {
      return `firmware-tables:missing-field:${pathKey(path)}`;
    }
  }

  return undefined;
}

function isFirmwareTableValueKind(
  value: string,
): value is UefiFirmwareTableFieldRecord["valueKind"] {
  return value === "pointer" || value === "functionPointer" || value === "u32" || value === "u64";
}

function recordKey(record: UefiFirmwareTableFieldRecord): string {
  return `${record.tableKey}:${record.fieldKey}`;
}

function pathKey(path: UefiFirmwareTablePath): string {
  switch (path.kind) {
    case "system-table":
    case "simple-text-output":
    case "boot-services":
    case "runtime-services":
      return `${path.kind}:${path.field}`;
    case "protocol":
      return `protocol:${path.guid}:${path.field}`;
  }
}

const CANONICAL_UEFI_FIRMWARE_TABLE_PATHS: readonly UefiFirmwareTablePath[] = Object.freeze([
  { kind: "system-table", field: "hdr" },
  { kind: "system-table", field: "firmware-vendor" },
  { kind: "system-table", field: "firmware-revision" },
  { kind: "system-table", field: "con-out" },
  { kind: "system-table", field: "boot-services" },
  { kind: "system-table", field: "runtime-services" },
  { kind: "simple-text-output", field: "output-string" },
  { kind: "boot-services", field: "allocate-pages" },
  { kind: "boot-services", field: "free-pages" },
  { kind: "boot-services", field: "allocate-pool" },
  { kind: "boot-services", field: "free-pool" },
  { kind: "boot-services", field: "get-memory-map" },
  { kind: "boot-services", field: "exit-boot-services" },
  { kind: "boot-services", field: "set-watchdog-timer" },
  { kind: "boot-services", field: "handle-protocol" },
  { kind: "boot-services", field: "locate-protocol" },
  { kind: "boot-services", field: "open-protocol" },
  { kind: "boot-services", field: "close-protocol" },
  { kind: "boot-services", field: "create-event" },
  { kind: "boot-services", field: "set-timer" },
  { kind: "boot-services", field: "wait-for-event" },
  { kind: "boot-services", field: "stall" },
  { kind: "boot-services", field: "exit" },
  { kind: "runtime-services", field: "hdr" },
  { kind: "runtime-services", field: "get-time" },
  { kind: "runtime-services", field: "set-time" },
  { kind: "runtime-services", field: "reset-system" },
]);
