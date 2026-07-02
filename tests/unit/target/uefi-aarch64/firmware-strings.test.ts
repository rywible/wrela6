import { describe, expect, test } from "bun:test";

import { stableHash, stableJson } from "../../../../src/shared/stable-json";
import {
  materializeUefiAArch64StaticChar16String,
  uefiAArch64StaticChar16StringPointer,
} from "../../../../src/target/uefi-aarch64";

describe("UEFI firmware string materialization", () => {
  test("materializes ASCII smoke marker as NUL-terminated CHAR16LE", () => {
    const result = materializeUefiAArch64StaticChar16String({
      stableKey: "smoke-marker",
      value: "WRELA_UEFI_SMOKE_OK\r\n",
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.bytes.slice(0, 10)).toEqual([
        0x57, 0x00, 0x52, 0x00, 0x45, 0x00, 0x4c, 0x00, 0x41, 0x00,
      ]);
      expect(result.value.bytes.slice(-2)).toEqual([0x00, 0x00]);
      expect(result.value.codeUnits.slice(-3)).toEqual([0x0d, 0x0a, 0x00]);
      expect(result.value.nulTerminated).toBe(true);
    }
  });

  test("rejects NUL in source strings", () => {
    const result = materializeUefiAArch64StaticChar16String({
      stableKey: "contains-nul",
      value: "bad\0string",
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "firmware-string:nul-code-point:contains-nul:3",
    );
  });

  test("rejects non-ASCII v1 strings with lowercase hex code point", () => {
    const result = materializeUefiAArch64StaticChar16String({
      stableKey: "snowman",
      value: "snowman \u2603",
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "firmware-string:unsupported-code-point:snowman:2603",
    );
  });

  test("fingerprints materialized strings from stable key code units and NUL termination", () => {
    const result = materializeUefiAArch64StaticChar16String({
      stableKey: "fingerprint",
      value: "ABC",
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.fingerprint).toBe(
        `uefi-aarch64-firmware-string:${stableHash(
          stableJson({
            stableKey: "fingerprint",
            codeUnits: [0x41, 0x42, 0x43, 0x00],
            nulTerminated: true,
          }),
        )}`,
      );
    }
  });

  test("creates a static pointer lifetime record for console output lowering", () => {
    const result = materializeUefiAArch64StaticChar16String({
      stableKey: "console-marker",
      value: "OK\r\n",
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(uefiAArch64StaticChar16StringPointer(result.value)).toEqual({
        kind: "static-char16-pointer",
        stableKey: "console-marker",
        symbolName: "__wrela_uefi_char16_console_marker",
        fingerprint: result.value.fingerprint,
        lifetime: "image-readonly",
        nulTerminated: true,
      });
    }
  });
});
