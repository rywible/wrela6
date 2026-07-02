import { stableHash, stableJson } from "../../shared/stable-json";
import { uefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  failedVerification,
  isAsciiSymbolName,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";
import type { AArch64UefiImageProfile } from "../aarch64/lower/uefi-image-lowering";

const ENTRY_CONTRACT_OWNER_KEY = "entry-contract";
const ENTRY_CONTRACT_VERIFIER_KEY = "uefi-aarch64.entry-contract";
const ENTRY_PROFILE_RUN_KEY = "entry-profile";
const BOOT_CONTRACT_RUN_KEY = "boot-function-contract";

export interface UefiAArch64EntryProfile {
  readonly peEntryLinkageName: "__wrela_uefi_entry";
  readonly imageEntryShimSymbol: "wrela.image.entry_shim";
  readonly bootFunctionSymbol: "wrela.image.boot";
  readonly imageHandleSourceKey: "uefi.imageHandle";
  readonly systemTableSourceKey: "uefi.systemTable";
  readonly entryCallConvention: "uefi-aapcs64";
  readonly bootCallConvention: "wrela-source";
  readonly statusResultRegister: "x0";
  readonly thunkStrategy: "framed-call";
}

export type UefiAArch64BootResultShape =
  | { readonly kind: "unit-success" }
  | { readonly kind: "target-certified-result"; readonly errorTypeKey: string }
  | { readonly kind: "never" }
  | { readonly kind: "panic" };

export interface UefiAArch64SourceVisibleParameter {
  readonly name: string;
  readonly typeKey: string;
}

export interface UefiAArch64BootFunctionContractInput {
  readonly sourceVisibleParameters: readonly UefiAArch64SourceVisibleParameter[];
  readonly resultShape: UefiAArch64BootResultShape | { readonly kind: string };
}

export interface UefiAArch64BootFunctionContract {
  readonly sourceVisibleParameters: readonly [];
  readonly resultShape: UefiAArch64BootResultShape;
}

export function canonicalUefiAArch64EntryProfile(
  overrides: Partial<UefiAArch64EntryProfile> = {},
): UefiAArch64EntryProfile {
  return Object.freeze({
    peEntryLinkageName: "__wrela_uefi_entry" as const,
    imageEntryShimSymbol: "wrela.image.entry_shim" as const,
    bootFunctionSymbol: "wrela.image.boot" as const,
    imageHandleSourceKey: "uefi.imageHandle" as const,
    systemTableSourceKey: "uefi.systemTable" as const,
    entryCallConvention: "uefi-aapcs64" as const,
    bootCallConvention: "wrela-source" as const,
    statusResultRegister: "x0" as const,
    thunkStrategy: "framed-call" as const,
    ...overrides,
  });
}

export function validateUefiAArch64EntryProfile(
  profile: UefiAArch64EntryProfile,
): UefiAArch64TargetResult<UefiAArch64EntryProfile> {
  const diagnostics = entryProfileDiagnostics(profile);
  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification(ENTRY_CONTRACT_VERIFIER_KEY, ENTRY_PROFILE_RUN_KEY),
    });
  }

  return uefiAArch64Ok({
    value: profile,
    verification: passedVerification(ENTRY_CONTRACT_VERIFIER_KEY, ENTRY_PROFILE_RUN_KEY),
  });
}

export function validateUefiAArch64BootFunctionContract(
  input: UefiAArch64BootFunctionContractInput,
): UefiAArch64TargetResult<UefiAArch64BootFunctionContract> {
  const diagnostics = bootFunctionContractDiagnostics(input);
  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification(ENTRY_CONTRACT_VERIFIER_KEY, BOOT_CONTRACT_RUN_KEY),
    });
  }

  return uefiAArch64Ok({
    value: Object.freeze({
      sourceVisibleParameters: Object.freeze([]) as readonly [],
      resultShape: input.resultShape as UefiAArch64BootResultShape,
    }),
    verification: passedVerification(ENTRY_CONTRACT_VERIFIER_KEY, BOOT_CONTRACT_RUN_KEY),
  });
}

export function aarch64UefiImageProfileFromEntryProfile(
  profile: UefiAArch64EntryProfile,
): AArch64UefiImageProfile {
  return Object.freeze({
    entryShimSymbol: profile.imageEntryShimSymbol,
    bootFunctionSymbol: profile.bootFunctionSymbol,
    imageHandleLocation: Object.freeze({ kind: "intReg" as const, index: 0 as const }),
    systemTableLocation: Object.freeze({ kind: "intReg" as const, index: 1 as const }),
    firmwareTableKeys: Object.freeze(["uefi.boot-services", "uefi.system-table"]),
  });
}

export function fingerprintUefiAArch64EntryProfile(profile: UefiAArch64EntryProfile): string {
  return stableHash(stableJson(profile));
}

function entryProfileDiagnostics(profile: UefiAArch64EntryProfile) {
  const details: string[] = [];
  const symbolFields = [
    ["peEntryLinkageName", profile.peEntryLinkageName],
    ["imageEntryShimSymbol", profile.imageEntryShimSymbol],
    ["bootFunctionSymbol", profile.bootFunctionSymbol],
  ] as const;

  for (const [field, value] of symbolFields) {
    if (!isAsciiSymbolName(value)) {
      details.push(`entry-contract:invalid-ascii-symbol:${field}:${value}`);
    }
  }

  for (let leftIndex = 0; leftIndex < symbolFields.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < symbolFields.length; rightIndex += 1) {
      const left = symbolFields[leftIndex];
      const right = symbolFields[rightIndex];
      if (left !== undefined && right !== undefined && left[1] === right[1]) {
        details.push(`entry-contract:duplicate-symbol:${right[0]}:${left[0]}:${left[1]}`);
      }
    }
  }

  if (profile.imageHandleSourceKey !== "uefi.imageHandle") {
    details.push("entry-contract:image-handle-source-key");
  }
  if (profile.systemTableSourceKey !== "uefi.systemTable") {
    details.push("entry-contract:system-table-source-key");
  }
  if (profile.entryCallConvention !== "uefi-aapcs64") {
    details.push("entry-contract:entry-call-convention");
  }
  if (profile.bootCallConvention !== "wrela-source") {
    details.push("entry-contract:boot-call-convention");
  }
  if (profile.statusResultRegister !== "x0") {
    details.push("entry-contract:status-result-register");
  }
  if (profile.thunkStrategy !== "framed-call") {
    details.push("entry-contract:thunk-strategy");
  }

  return details.map(entryContractDiagnostic);
}

function bootFunctionContractDiagnostics(input: UefiAArch64BootFunctionContractInput) {
  const details: string[] = [];

  for (const parameter of input.sourceVisibleParameters) {
    if (isRawFirmwareParameter(parameter.typeKey)) {
      details.push(`entry-contract:raw-firmware-parameter:${parameter.name}:${parameter.typeKey}`);
    }
  }

  if (input.sourceVisibleParameters.length > 0) {
    details.push("entry-contract:source-visible-parameters-must-be-empty");
  }

  if (!isAllowedBootResultShape(input.resultShape)) {
    details.push(`entry-contract:unsupported-result-shape:${input.resultShape.kind}`);
  }

  return details.map(entryContractDiagnostic);
}

function isRawFirmwareParameter(typeKey: string): boolean {
  return typeKey === "EFI_HANDLE" || typeKey === "EFI_SYSTEM_TABLE*";
}

function isAllowedBootResultShape(
  resultShape: UefiAArch64BootFunctionContractInput["resultShape"],
): resultShape is UefiAArch64BootResultShape {
  switch (resultShape.kind) {
    case "unit-success":
    case "never":
    case "panic":
      return true;
    case "target-certified-result":
      return "errorTypeKey" in resultShape && typeof resultShape.errorTypeKey === "string";
    default:
      return false;
  }
}

function entryContractDiagnostic(stableDetail: string) {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
    ownerKey: ENTRY_CONTRACT_OWNER_KEY,
    stableDetail,
  });
}
