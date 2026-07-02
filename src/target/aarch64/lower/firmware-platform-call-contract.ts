export type AArch64FirmwareTableBaseKey =
  | "uefi-system-table"
  | "uefi-simple-text-output"
  | "uefi-boot-services"
  | "uefi-runtime-services";

export interface AArch64FirmwareTableFieldLayout {
  readonly base: AArch64FirmwareTableBaseKey;
  readonly fieldKey: string;
  readonly offsetBytes: number;
  readonly widthBytes: 8;
}

export interface AArch64FirmwareStaticChar16PointerRequirement {
  readonly kind: "static-char16-pointer";
  readonly lifetime: "image-readonly";
  readonly nulTerminated: true;
}

export interface AArch64FirmwareStaticChar16PointerArgument extends AArch64FirmwareStaticChar16PointerRequirement {
  readonly stableKey: string;
  readonly symbolName: string;
  readonly fingerprint: string;
}

export type AArch64FirmwareArgumentRule =
  | {
      readonly kind: "source-argument";
      readonly index: number;
      readonly pointerRequirement?: AArch64FirmwareStaticChar16PointerRequirement;
    }
  | { readonly kind: "image-handle" }
  | { readonly kind: "system-table" }
  | { readonly kind: "table-pointer" }
  | { readonly kind: "constant-u64"; readonly value: bigint }
  | {
      readonly kind: "static-char16-pointer";
      readonly pointer: AArch64FirmwareStaticChar16PointerArgument;
    };

export type AArch64FirmwareResultRule =
  | { readonly kind: "efi-status" }
  | { readonly kind: "pointer-result"; readonly capabilityKey: string }
  | { readonly kind: "terminal-status" }
  | { readonly kind: "unit" };

export type AArch64FirmwarePlatformCallLowering =
  | {
      readonly kind: "firmware-call";
      readonly primitiveId: string;
      readonly tablePointerField?: AArch64FirmwareTableFieldLayout;
      readonly tableField: AArch64FirmwareTableFieldLayout;
      readonly argumentRules: readonly AArch64FirmwareArgumentRule[];
      readonly resultRule: AArch64FirmwareResultRule;
    }
  | {
      readonly kind: "compiler-runtime-helper";
      readonly primitiveId: string;
      readonly helperLinkageName: string;
      readonly argumentRules: readonly AArch64FirmwareArgumentRule[];
      readonly resultRule: AArch64FirmwareResultRule;
    };

export interface AArch64FirmwarePlatformCallContext {
  readonly loweringFor: (
    platformPrimitiveId: string,
  ) => AArch64FirmwarePlatformCallLowering | undefined;
}

export interface AArch64FirmwareLoweringOptions {
  readonly platformCalls?: AArch64FirmwarePlatformCallContext;
  readonly staticChar16Pointers?: ReadonlyMap<string, AArch64FirmwareStaticChar16PointerArgument>;
}

export interface AArch64FirmwareLoweringContext extends AArch64FirmwareLoweringOptions {
  readonly contextRegisters: Map<string, AArch64VirtualRegister>;
}
import type { AArch64VirtualRegister } from "../machine-ir/virtual-register";
