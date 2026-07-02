import { stableHash, stableJson } from "../../shared/stable-json";
import { RPI5_BACKEND_CATALOGS } from "../aarch64/backend/catalogs/rpi5-backend-catalog-data";
import { createAArch64Aapcs64AbiTargetSurface } from "../aarch64/lower/abi-lowering";
import { uefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";

export interface UefiAArch64FirmwareAbiSurface {
  readonly callConvention: "uefi-aapcs64";
  readonly pointerWidthBits: 64;
  readonly statusWidthBits: 64;
  readonly stackAlignmentBytes: 16;
  readonly redZone: false;
  readonly backendAbiSurfaceFingerprint: string;
  readonly physicalRegisterModelFingerprint: string;
  readonly imageHandleLocation: { readonly kind: "intReg"; readonly index: 0 };
  readonly systemTableLocation: { readonly kind: "intReg"; readonly index: 1 };
  readonly returnStatusLocation: { readonly kind: "intReg"; readonly index: 0 };
}

export function canonicalUefiAArch64FirmwareAbiSurface(
  overrides: Partial<UefiAArch64FirmwareAbiSurface> = {},
): UefiAArch64FirmwareAbiSurface {
  return Object.freeze({
    callConvention: "uefi-aapcs64" as const,
    pointerWidthBits: 64 as const,
    statusWidthBits: 64 as const,
    stackAlignmentBytes: 16 as const,
    redZone: false as const,
    backendAbiSurfaceFingerprint: canonicalBackendAbiSurfaceFingerprint(),
    physicalRegisterModelFingerprint: canonicalPhysicalRegisterModelFingerprint(),
    imageHandleLocation: Object.freeze({ kind: "intReg" as const, index: 0 as const }),
    systemTableLocation: Object.freeze({ kind: "intReg" as const, index: 1 as const }),
    returnStatusLocation: Object.freeze({ kind: "intReg" as const, index: 0 as const }),
    ...overrides,
  });
}

export function validateUefiAArch64FirmwareAbiSurface(
  surface: UefiAArch64FirmwareAbiSurface,
): UefiAArch64TargetResult<UefiAArch64FirmwareAbiSurface> {
  const stableDetail = invalidFirmwareAbiDetail(surface);
  if (stableDetail !== undefined) {
    return uefiAArch64Error({
      diagnostics: [
        uefiAArch64TargetDiagnostic({
          code: "UEFI_AARCH64_FIRMWARE_ABI_FAILED",
          ownerKey: "firmware-abi",
          stableDetail,
        }),
      ],
      verification: failedVerification("firmware-abi", "surface", stableDetail),
    });
  }

  return uefiAArch64Ok({
    value: surface,
    verification: passedVerification("firmware-abi", "surface"),
  });
}

export function fingerprintUefiAArch64FirmwareAbi(surface: UefiAArch64FirmwareAbiSurface): string {
  return `uefi-aarch64-firmware-abi:${stableHash(stableJson(surface))}`;
}

function invalidFirmwareAbiDetail(surface: UefiAArch64FirmwareAbiSurface): string | undefined {
  if (surface.backendAbiSurfaceFingerprint.length === 0) {
    return "firmware-abi:missing-backend-abi-fingerprint";
  }
  if (surface.physicalRegisterModelFingerprint.length === 0) {
    return "firmware-abi:missing-physical-register-model-fingerprint";
  }
  if (surface.backendAbiSurfaceFingerprint !== canonicalBackendAbiSurfaceFingerprint()) {
    return "firmware-abi:backend-abi-fingerprint";
  }
  if (surface.physicalRegisterModelFingerprint !== canonicalPhysicalRegisterModelFingerprint()) {
    return "firmware-abi:physical-register-model-fingerprint";
  }
  if (surface.callConvention !== "uefi-aapcs64") return "firmware-abi:call-convention";
  if (surface.pointerWidthBits !== 64) return "firmware-abi:pointer-width";
  if (surface.statusWidthBits !== 64) return "firmware-abi:status-width";
  if (surface.stackAlignmentBytes !== 16) return "firmware-abi:stack-alignment";
  if (surface.redZone !== false) return "firmware-abi:red-zone";
  if (surface.imageHandleLocation.kind !== "intReg" || surface.imageHandleLocation.index !== 0) {
    return "firmware-abi:image-handle-location";
  }
  if (surface.systemTableLocation.kind !== "intReg" || surface.systemTableLocation.index !== 1) {
    return "firmware-abi:system-table-location";
  }
  if (surface.returnStatusLocation.kind !== "intReg" || surface.returnStatusLocation.index !== 0) {
    return "firmware-abi:return-status-location";
  }
  return undefined;
}

function canonicalBackendAbiSurfaceFingerprint(): string {
  return createAArch64Aapcs64AbiTargetSurface().abiFingerprint;
}

function canonicalPhysicalRegisterModelFingerprint(): string {
  return RPI5_BACKEND_CATALOGS.registerModel.fingerprint;
}
