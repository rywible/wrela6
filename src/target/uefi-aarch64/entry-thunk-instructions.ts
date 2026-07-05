import { aarch64SyntheticObjectFactoryDiagnostic } from "../../linker/aarch64/aarch64-entry-objects";
import {
  encodeAArch64PhysicalInstructionForTarget,
  type AArch64PhysicalInstructionToEncode,
} from "../aarch64/backend/object/encoding";
import type {
  CreateUefiAArch64EntryThunkObjectFactoryInput,
  UefiAArch64EntryThunkInstructionPlan,
} from "./entry-thunk";
import {
  UEFI_AARCH64_ENTRY_INITIALIZE_CONTEXT_LINKAGE_NAME,
  UEFI_AARCH64_STATUS_FROM_BOOT_RESULT_LINKAGE_NAME,
} from "./runtime-catalog";

export interface EncodedThunkInstruction {
  readonly operationKey: UefiAArch64EntryThunkInstructionPlan["operationKey"];
  readonly bytes: Uint8Array;
  readonly relocationTargetLinkageName?: string;
}

export function encodeThunkInstructions(
  input: CreateUefiAArch64EntryThunkObjectFactoryInput,
  bootLinkageName: string,
):
  | { readonly kind: "ok"; readonly instructions: readonly EncodedThunkInstruction[] }
  | {
      readonly kind: "error";
      readonly diagnostics: ReturnType<typeof aarch64SyntheticObjectFactoryDiagnostic>[];
    } {
  const encoded: EncodedThunkInstruction[] = [];
  let encodingFailureDetail: string | undefined;

  const append = (
    operationKey: EncodedThunkInstruction["operationKey"],
    instruction: AArch64PhysicalInstructionToEncode,
    relocationTargetLinkageName?: string,
  ): boolean => {
    const result = encodeAArch64PhysicalInstructionForTarget({
      instruction,
      encodingCatalog: input.backendTarget.encodingCatalog,
      registerModel: input.backendTarget.registerModel,
    });
    if (result.kind === "error") {
      encodingFailureDetail = result.diagnostics[0]?.stableDetail ?? operationKey;
      return false;
    }
    encoded.push({
      operationKey,
      bytes: Uint8Array.from(result.value.bytes),
      ...(relocationTargetLinkageName === undefined ? {} : { relocationTargetLinkageName }),
    });
    return true;
  };

  const encodingSucceeded =
    append("sub-sp-frame", instruction("sub-immediate", reg("sp"), reg("sp"), imm(48n))) &&
    append(
      "stp-x29-x30-frame",
      instruction("stp-signed-offset", reg("x29"), reg("x30"), mem("sp"), imm(32n)),
    ) &&
    append("add-x29-frame", instruction("add-immediate", reg("x29"), reg("sp"), imm(32n))) &&
    append(
      "store-image-handle",
      instruction("str-unsigned-immediate", reg("x0"), mem("sp"), imm(0n)),
    ) &&
    append(
      "store-system-table",
      instruction("str-unsigned-immediate", reg("x1"), mem("sp"), imm(8n)),
    ) &&
    append(
      "call-entry-initialize-context",
      branchInstruction("bl", UEFI_AARCH64_ENTRY_INITIALIZE_CONTEXT_LINKAGE_NAME),
      UEFI_AARCH64_ENTRY_INITIALIZE_CONTEXT_LINKAGE_NAME,
    ) &&
    append("branch-if-entry-initialization-failed", branchInstruction("cbz", "entry.epilogue")) &&
    append(
      "reload-entry-context-for-boot",
      instruction("ldr-unsigned-immediate", reg("x0"), mem("sp"), imm(0n)),
    ) &&
    append(
      "reload-entry-context-for-boot",
      instruction("ldr-unsigned-immediate", reg("x1"), mem("sp"), imm(8n)),
    ) &&
    append("call-boot-function", branchInstruction("bl", bootLinkageName), bootLinkageName) &&
    append(
      "store-boot-result",
      instruction("str-unsigned-immediate", reg("x0"), mem("sp"), imm(16n)),
    ) &&
    append(
      "reload-boot-result-for-status-conversion",
      instruction("ldr-unsigned-immediate", reg("x0"), mem("sp"), imm(16n)),
    ) &&
    append(
      "call-status-conversion",
      branchInstruction("bl", UEFI_AARCH64_STATUS_FROM_BOOT_RESULT_LINKAGE_NAME),
      UEFI_AARCH64_STATUS_FROM_BOOT_RESULT_LINKAGE_NAME,
    ) &&
    append(
      "ldp-x29-x30-frame",
      instruction("ldp-signed-offset", reg("x29"), reg("x30"), mem("sp"), imm(32n)),
    ) &&
    append("add-sp-frame", instruction("add-immediate", reg("sp"), reg("sp"), imm(48n))) &&
    append("ret", instruction("ret"));

  if (!encodingSucceeded) {
    return {
      kind: "error",
      diagnostics: [
        aarch64SyntheticObjectFactoryDiagnostic(
          `entry-thunk:instruction-encoding-failed:${encodingFailureDetail ?? "unknown"}`,
        ),
      ],
    };
  }

  const branchIndex = encoded.findIndex(
    (candidate) => candidate.operationKey === "branch-if-entry-initialization-failed",
  );
  const epilogueIndex = encoded.findIndex(
    (candidate) => candidate.operationKey === "ldp-x29-x30-frame",
  );
  if (branchIndex >= 0 && epilogueIndex >= 0) {
    const branchOffset = byteOffsetOf(encoded, branchIndex);
    const epilogueOffset = byteOffsetOf(encoded, epilogueIndex);
    encoded[branchIndex] = {
      ...encoded[branchIndex]!,
      bytes: patchBranch19(encoded[branchIndex]!.bytes, epilogueOffset - branchOffset),
    };
  }

  return { kind: "ok", instructions: Object.freeze(encoded) };
}

export function byteOffsetOf(
  instructions: readonly EncodedThunkInstruction[],
  endIndex: number,
): number {
  return instructions
    .slice(0, endIndex)
    .reduce((sum, instruction) => sum + instruction.bytes.length, 0);
}

export function concatInstructionBytes(
  instructions: readonly EncodedThunkInstruction[],
): Uint8Array {
  const byteLength = instructions.reduce((sum, instruction) => sum + instruction.bytes.length, 0);
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const instruction of instructions) {
    output.set(instruction.bytes, offset);
    offset += instruction.bytes.length;
  }
  return output;
}

function patchBranch19(bytes: Uint8Array, distanceBytes: number): Uint8Array {
  const word = ((bytes[3]! << 24) | (bytes[2]! << 16) | (bytes[1]! << 8) | bytes[0]!) >>> 0;
  const immediate = (distanceBytes / 4) & 0x7ffff;
  const patched = (word & ~0x00ffffe0) | (immediate << 5);
  return Uint8Array.of(
    patched & 0xff,
    (patched >>> 8) & 0xff,
    (patched >>> 16) & 0xff,
    (patched >>> 24) & 0xff,
  );
}

function instruction(
  opcode: string,
  ...operands: AArch64PhysicalInstructionToEncode["operands"]
): AArch64PhysicalInstructionToEncode {
  return { opcode, operands, accessWidthBytes: 8 };
}

function branchInstruction(opcode: string, target: string): AArch64PhysicalInstructionToEncode {
  const family = opcode === "cbz" ? "branch19" : "branch26";
  return {
    opcode,
    operands:
      opcode === "cbz"
        ? [reg("x1"), { kind: "relocation-target", target }]
        : [{ kind: "relocation-target", target }],
    relocation: { family, target },
  };
}

function reg(register: string) {
  return { kind: "register" as const, register };
}

function mem(register: string) {
  return { kind: "memory-base" as const, register };
}

function imm(value: bigint) {
  return { kind: "immediate" as const, value };
}
