import { stableHash, stableJson } from "../../shared/stable-json";
import { uefiAArch64TargetDiagnostic, type UefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";

export interface UefiAArch64StaticChar16StringInput {
  readonly stableKey: string;
  readonly value: string;
}

export interface UefiAArch64StaticChar16String {
  readonly stableKey: string;
  readonly codeUnits: readonly number[];
  readonly bytes: readonly number[];
  readonly nulTerminated: true;
  readonly fingerprint: string;
}

export interface UefiAArch64StaticChar16StringPointer {
  readonly kind: "static-char16-pointer";
  readonly stableKey: string;
  readonly symbolName: string;
  readonly fingerprint: string;
  readonly lifetime: "image-readonly";
  readonly nulTerminated: true;
}

export function materializeUefiAArch64StaticChar16String(
  input: UefiAArch64StaticChar16StringInput,
): UefiAArch64TargetResult<UefiAArch64StaticChar16String> {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const codeUnits: number[] = [];

  for (let index = 0; index < input.value.length; index += 1) {
    const codePoint = input.value.codePointAt(index);
    if (codePoint === undefined) continue;

    if (codePoint === 0) {
      diagnostics.push(
        firmwareStringDiagnostic(`firmware-string:nul-code-point:${input.stableKey}:${index}`),
      );
      continue;
    }

    if (!isV1FirmwareStringCodePoint(codePoint)) {
      diagnostics.push(
        firmwareStringDiagnostic(
          `firmware-string:unsupported-code-point:${input.stableKey}:${codePoint.toString(16)}`,
        ),
      );
      if (codePoint > 0xffff) index += 1;
      continue;
    }

    codeUnits.push(codePoint);
  }

  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification("uefi-aarch64-firmware-string", input.stableKey),
    });
  }

  codeUnits.push(0);

  return uefiAArch64Ok({
    value: freezeStaticChar16String({
      stableKey: input.stableKey,
      codeUnits,
      bytes: char16CodeUnitsToBytes(codeUnits),
      nulTerminated: true,
      fingerprint: fingerprintUefiAArch64StaticChar16String({
        stableKey: input.stableKey,
        codeUnits,
        nulTerminated: true,
      }),
    }),
    verification: passedVerification("uefi-aarch64-firmware-string", input.stableKey),
  });
}

export function fingerprintUefiAArch64StaticChar16String(input: {
  readonly stableKey: string;
  readonly codeUnits: readonly number[];
  readonly nulTerminated: true;
}): string {
  return `uefi-aarch64-firmware-string:${stableHash(
    stableJson({
      stableKey: input.stableKey,
      codeUnits: input.codeUnits,
      nulTerminated: input.nulTerminated,
    }),
  )}`;
}

export function uefiAArch64StaticChar16StringPointer(
  value: UefiAArch64StaticChar16String,
): UefiAArch64StaticChar16StringPointer {
  return Object.freeze({
    kind: "static-char16-pointer" as const,
    stableKey: value.stableKey,
    symbolName: `__wrela_uefi_char16_${symbolSuffix(value.stableKey)}`,
    fingerprint: value.fingerprint,
    lifetime: "image-readonly" as const,
    nulTerminated: true as const,
  });
}

function isV1FirmwareStringCodePoint(codePoint: number): boolean {
  return codePoint === 0x0d || codePoint === 0x0a || (codePoint >= 0x20 && codePoint <= 0x7e);
}

function char16CodeUnitsToBytes(codeUnits: readonly number[]): readonly number[] {
  return Object.freeze(codeUnits.flatMap((codeUnit) => [codeUnit & 0xff, (codeUnit >>> 8) & 0xff]));
}

function freezeStaticChar16String(
  value: UefiAArch64StaticChar16String,
): UefiAArch64StaticChar16String {
  return Object.freeze({
    stableKey: value.stableKey,
    codeUnits: Object.freeze([...value.codeUnits]),
    bytes: Object.freeze([...value.bytes]),
    nulTerminated: true,
    fingerprint: value.fingerprint,
  });
}

function firmwareStringDiagnostic(stableDetail: string): UefiAArch64TargetDiagnostic {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
    ownerKey: "firmware-string",
    stableDetail,
  });
}

function symbolSuffix(stableKey: string): string {
  const suffix = stableKey
    .replaceAll(/[^A-Za-z0-9_]+/g, "_")
    .replaceAll(/^_+|_+$/g, "")
    .toLowerCase();
  return suffix.length === 0 ? "string" : suffix;
}
