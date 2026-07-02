import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64FirmwareTableSurface,
  canonicalUefiAArch64PlatformLowerings,
  materializeUefiAArch64StaticChar16String,
  uefiAArch64StaticChar16StringPointer,
} from "../../../../src/target/uefi-aarch64";
import { materializeUefiAArch64FirmwarePlatformCallForTest } from "../../../support/target/uefi-aarch64/firmware-lowering-fixtures";
import {
  optIrCallId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../../src/opt-ir/ids";
import { platformPrimitiveId } from "../../../../src/semantic/ids";
import { optIrPlatformCallOperation } from "../../../../src/opt-ir/operations";
import { optIrUnsignedIntegerType } from "../../../../src/opt-ir/types";
import type { OptIrOperation } from "../../../../src/opt-ir/operations";

describe("UEFI firmware platform-call lowering", () => {
  test("rejects console output without a certified static CHAR16 pointer record", () => {
    const result = materializeUefiAArch64FirmwarePlatformCallForTest({
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      platformLowerings: canonicalUefiAArch64PlatformLowerings(),
      operation: platformCallOperationForTest("uefi.console.outputString", {
        arguments: [optIrValueId(1)],
      }),
    });

    expect(result).toEqual({
      kind: "error",
      stableDetail: "firmware-platform-call:missing-static-char16-pointer:1:optir.value:1",
    });
  });

  test("emits table-path load plus indirect firmware call for console output", () => {
    const pointer = staticChar16PointerForTest();
    const result = materializeUefiAArch64FirmwarePlatformCallForTest({
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      platformLowerings: canonicalUefiAArch64PlatformLowerings(),
      staticChar16Pointers: new Map([["optir.value:1", pointer]]),
      operation: platformCallOperationForTest("uefi.console.outputString", {
        arguments: [optIrValueId(1)],
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.instructions.map((instruction) => String(instruction.opcode))).toEqual(
        expect.arrayContaining(["ldr-unsigned-immediate", "blr"]),
      );
      expect(
        result.value.relocationReferences.map((relocation) => String(relocation.symbol)),
      ).toContain(pointer.symbolName);
    }
  });

  test("lowers helper-owned platform calls to runtime helper relocations", () => {
    const result = materializeUefiAArch64FirmwarePlatformCallForTest({
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      platformLowerings: canonicalUefiAArch64PlatformLowerings(),
      operation: platformCallOperationForTest("uefi.boot.exitBootServices", {
        arguments: [],
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(
        result.value.relocationReferences.map((relocation) => String(relocation.symbol)),
      ).toContain("__wrela_uefi_exit_boot_services_with_fresh_map");
    }
  });

  test("reports missing authenticated platform lowering before generic platform emission", () => {
    const result = materializeUefiAArch64FirmwarePlatformCallForTest({
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      platformLowerings: [],
      operation: platformCallOperationForTest("uefi.console.outputString", {
        arguments: [optIrValueId(1)],
      }),
    });

    expect(result).toEqual({
      kind: "error",
      stableDetail: "uefi-platform-lowering:missing:uefi.console.outputString",
    });
  });

  test("materializes constant firmware arguments instead of reading source argument zero", () => {
    const result = materializeUefiAArch64FirmwarePlatformCallForTest({
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      platformLowerings: [
        {
          primitiveId: platformPrimitiveId("test.boot.stall.constant"),
          semanticPrimitiveFingerprint: "test:fingerprint",
          lowering: {
            kind: "firmware-call",
            tablePath: { kind: "boot-services", field: "stall" },
            arguments: [{ kind: "constant-u64", value: 50n }],
            result: { kind: "efi-status" },
          },
        },
      ],
      operation: platformCallOperationForTest("test.boot.stall.constant", {
        arguments: [],
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.instructions.map((instruction) => String(instruction.opcode))).toEqual(
        expect.arrayContaining(["movz", "blr"]),
      );
    }
  });

  test("rejects unit firmware results that still expose an OptIR result", () => {
    const result = materializeUefiAArch64FirmwarePlatformCallForTest({
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      platformLowerings: [
        {
          primitiveId: platformPrimitiveId("test.boot.stall.unit"),
          semanticPrimitiveFingerprint: "test:fingerprint",
          lowering: {
            kind: "firmware-call",
            tablePath: { kind: "boot-services", field: "stall" },
            arguments: [{ kind: "constant-u64", value: 50n }],
            result: { kind: "unit" },
          },
        },
      ],
      operation: platformCallOperationForTest("test.boot.stall.unit", {
        arguments: [],
      }),
    });

    expect(result).toEqual({
      kind: "error",
      stableDetail: "firmware-platform-call-result-mismatch:1:unit:expected:0:actual:1",
    });
  });

  test("loads runtime-services table pointers from the authenticated system table path", () => {
    const result = materializeUefiAArch64FirmwarePlatformCallForTest({
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      platformLowerings: [
        {
          primitiveId: platformPrimitiveId("test.runtime.getTime"),
          semanticPrimitiveFingerprint: "test:fingerprint",
          lowering: {
            kind: "firmware-call",
            tablePath: { kind: "runtime-services", field: "get-time" },
            arguments: [
              { kind: "source-argument", index: 0 },
              { kind: "source-argument", index: 1 },
            ],
            result: { kind: "efi-status" },
          },
        },
      ],
      operation: platformCallOperationForTest("test.runtime.getTime", {
        arguments: [optIrValueId(1), optIrValueId(2)],
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(
        result.value.instructions
          .map((instruction) =>
            instruction.origin.kind === "syntheticLowering" ? instruction.origin.stableKey : "",
          )
          .filter((stableKey) => stableKey.length > 0),
      ).toContain("opt-ir:1:firmware-table-load:runtime-services:0");
    }
  });

  test("static CHAR16 pointer arguments materialize as symbol-address firmware arguments", () => {
    const pointer = staticChar16PointerForTest();

    const result = materializeUefiAArch64FirmwarePlatformCallForTest({
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      platformLowerings: [
        {
          primitiveId: platformPrimitiveId("test.console.static"),
          semanticPrimitiveFingerprint: "test:fingerprint",
          lowering: {
            kind: "firmware-call",
            tablePath: { kind: "simple-text-output", field: "output-string" },
            arguments: [{ kind: "static-char16-pointer", pointer }],
            result: { kind: "efi-status" },
          },
        },
      ],
      operation: platformCallOperationForTest("test.console.static", {
        arguments: [],
      }),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(
        result.value.relocationReferences.map((relocation) => String(relocation.symbol)),
      ).toContain("__wrela_uefi_char16_console_marker");
      expect(result.value.selectionRecord.explanation).toContain(
        "firmware-static-char16-pointer:console-marker:image-readonly:nul-terminated",
      );
    }
  });
});

function staticChar16PointerForTest() {
  const string = materializeUefiAArch64StaticChar16String({
    stableKey: "console-marker",
    value: "OK\r\n",
  });
  expect(string.kind).toBe("ok");
  if (string.kind !== "ok") throw new Error("expected static string");
  return uefiAArch64StaticChar16StringPointer(string.value);
}

function platformCallOperationForTest(
  platformKey: string,
  options: { readonly arguments: readonly ReturnType<typeof optIrValueId>[] },
): OptIrOperation & { readonly kind: "platformCall" } {
  return optIrPlatformCallOperation({
    operationId: optIrOperationId(1),
    callId: optIrCallId(1),
    target: { kind: "platform", platformKey },
    argumentIds: options.arguments,
    resultIds: [optIrValueId(100)],
    resultTypes: [optIrUnsignedIntegerType(64)],
    originId: optIrOriginId(1),
  }) as OptIrOperation & { readonly kind: "platformCall" };
}
