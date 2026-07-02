import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64FirmwareTableSurface,
  fingerprintUefiAArch64FirmwareTables,
  lookupUefiFirmwareTableField,
  validateUefiAArch64FirmwareTableSurface,
} from "../../../../src/target/uefi-aarch64";
import { UEFI_TABLE_FIELD_GOLDEN } from "../../../support/target/uefi-aarch64/firmware-table-golden-fixtures";

describe("UEFI firmware table surface", () => {
  test("includes watchdog, memory map, and exit boot services fields", () => {
    const surface = canonicalUefiAArch64FirmwareTableSurface();

    expect(
      lookupUefiFirmwareTableField(surface, { kind: "boot-services", field: "set-watchdog-timer" }),
    ).toMatchObject(UEFI_TABLE_FIELD_GOLDEN.bootServices.setWatchdogTimer);
    expect(
      lookupUefiFirmwareTableField(surface, { kind: "boot-services", field: "get-memory-map" }),
    ).toMatchObject(UEFI_TABLE_FIELD_GOLDEN.bootServices.getMemoryMap);
    expect(
      lookupUefiFirmwareTableField(surface, { kind: "boot-services", field: "exit-boot-services" }),
    ).toMatchObject(UEFI_TABLE_FIELD_GOLDEN.bootServices.exitBootServices);
  });

  test("includes canonical system table golden offsets", () => {
    const surface = canonicalUefiAArch64FirmwareTableSurface();

    expect(
      lookupUefiFirmwareTableField(surface, { kind: "system-table", field: "con-out" }),
    ).toMatchObject(UEFI_TABLE_FIELD_GOLDEN.systemTable.conOut);
    expect(
      lookupUefiFirmwareTableField(surface, { kind: "system-table", field: "boot-services" }),
    ).toMatchObject(UEFI_TABLE_FIELD_GOLDEN.systemTable.bootServices);
  });

  test("returns undefined for unknown paths", () => {
    const surface = canonicalUefiAArch64FirmwareTableSurface();
    expect(
      lookupUefiFirmwareTableField(surface, {
        kind: "boot-services",
        field: "not-a-service" as never,
      }),
    ).toBeUndefined();
  });

  test("contains sorted frozen records for every canonical path", () => {
    const surface = canonicalUefiAArch64FirmwareTableSurface();
    const keys = surface.records.map((record) => `${record.tableKey}:${record.fieldKey}`);

    expect(Object.isFrozen(surface.records)).toBe(true);
    expect(keys).toEqual([...keys].sort());
    expect(
      lookupUefiFirmwareTableField(surface, { kind: "system-table", field: "hdr" }),
    ).toBeDefined();
    expect(
      lookupUefiFirmwareTableField(surface, { kind: "simple-text-output", field: "output-string" }),
    ).toBeDefined();
    expect(
      lookupUefiFirmwareTableField(surface, { kind: "runtime-services", field: "reset-system" }),
    ).toBeDefined();
  });

  test("rejects duplicate table paths and fingerprints deterministically", () => {
    const surface = canonicalUefiAArch64FirmwareTableSurface();
    const duplicateSurface = canonicalUefiAArch64FirmwareTableSurface({
      records: [...surface.records, surface.records[0] ?? surface.records[1]].filter(
        (record) => record !== undefined,
      ),
    });

    const result = validateUefiAArch64FirmwareTableSurface(duplicateSurface);

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "firmware-tables:duplicate-field:boot-services:allocate-pages",
    );
    expect(fingerprintUefiAArch64FirmwareTables(surface)).toBe(
      fingerprintUefiAArch64FirmwareTables(canonicalUefiAArch64FirmwareTableSurface()),
    );
  });

  test("rejects changed canonical offsets in firmware table TCB records", () => {
    const surface = canonicalUefiAArch64FirmwareTableSurface();
    const changedSurface = canonicalUefiAArch64FirmwareTableSurface({
      records: surface.records.map((record) =>
        record.tableKey === "boot-services" && record.fieldKey === "set-watchdog-timer"
          ? { ...record, offsetBytes: 0 }
          : record,
      ),
    });

    const result = validateUefiAArch64FirmwareTableSurface(changedSurface);

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "firmware-tables:canonical-mismatch:boot-services:set-watchdog-timer",
    );
  });
});
