import type {
  AArch64EntryObjectFactoryInput,
  AArch64SyntheticEntryObjectFactoryResult,
  AArch64SyntheticObjectFactory,
  AArch64SyntheticUnwindObjectFactoryResult,
  AArch64UnwindObjectFactoryInput,
} from "../../linker/aarch64/aarch64-entry-objects";
import { aarch64SyntheticObjectFactoryDiagnostic } from "../../linker/aarch64/aarch64-entry-objects";
import { stableHash, stableJson } from "../../shared/stable-json";
import type { AArch64BackendTargetSurface } from "../aarch64/backend/api/backend-target-surface";
import {
  encodeAArch64PhysicalInstructionForTarget,
  type AArch64PhysicalInstructionToEncode,
} from "../aarch64/backend/object/encoding";
import {
  aarch64ObjectUnwindRecord,
  type AArch64ObjectUnwindRecord,
} from "../aarch64/backend/object/object-module";
import { uefiAArch64TargetDiagnostic } from "./diagnostics";
import type { UefiAArch64EntryProfile } from "./entry-contract";
import { validateUefiAArch64EntryProfile } from "./entry-contract";
import {
  failedVerification,
  passedVerification,
  uefiAArch64Error,
  uefiAArch64Ok,
  type UefiAArch64TargetResult,
} from "./result";
import {
  UEFI_AARCH64_ENTRY_INITIALIZE_CONTEXT_LINKAGE_NAME,
  UEFI_AARCH64_STATUS_FROM_BOOT_RESULT_LINKAGE_NAME,
} from "./runtime-catalog";

const ENTRY_THUNK_OWNER_KEY = "entry-thunk";
const ENTRY_THUNK_VERIFIER_KEY = "uefi-aarch64.entry-thunk";
const ENTRY_THUNK_RUN_KEY = "plan";
const FRAME_SIZE_BYTES = 48 as const;
const ENTRY_FRAME_SHAPE = "frame-record";

export interface PlanUefiAArch64EntryThunkInput {
  readonly entryProfile: UefiAArch64EntryProfile;
  readonly backendTarget: AArch64BackendTargetSurface;
}

export interface CreateUefiAArch64EntryThunkObjectFactoryInput extends PlanUefiAArch64EntryThunkInput {}

export interface UefiAArch64EntryThunkPlan {
  readonly strategy: "framed-call";
  readonly entrySymbol: "__wrela_uefi_entry";
  readonly imageEntryShimSymbol: "wrela.image.entry_shim";
  readonly bootFunctionSymbol: "wrela.image.boot";
  readonly frameSizeBytes: 48;
  readonly frameSlots: readonly UefiAArch64EntryThunkFrameSlot[];
  readonly instructions: readonly UefiAArch64EntryThunkInstructionPlan[];
  readonly relocations: readonly UefiAArch64EntryThunkRelocationPlan[];
  readonly unwind: UefiAArch64EntryThunkUnwindPlan;
  readonly fingerprint: string;
}

export interface UefiAArch64EntryThunkFrameSlot {
  readonly key: "image-handle" | "system-table" | "boot-result" | "saved-x29" | "saved-x30";
  readonly offsetBytes: number;
  readonly sizeBytes: 8;
}

export type UefiAArch64EntryThunkInstructionPlan =
  | { readonly operationKey: "sub-sp-frame"; readonly frameSizeBytes: 48 }
  | { readonly operationKey: "stp-x29-x30-frame"; readonly savedX29OffsetBytes: 32 }
  | { readonly operationKey: "add-x29-frame"; readonly savedX29OffsetBytes: 32 }
  | {
      readonly operationKey: "store-image-handle";
      readonly sourceRegister: "x0";
      readonly slot: "image-handle";
    }
  | {
      readonly operationKey: "store-system-table";
      readonly sourceRegister: "x1";
      readonly slot: "system-table";
    }
  | { readonly operationKey: "call-entry-initialize-context"; readonly targetLinkageName: string }
  | {
      readonly operationKey: "branch-if-entry-initialization-failed";
      readonly flagRegister: "x1";
      readonly successValue: 1n;
    }
  | {
      readonly operationKey: "reload-entry-context-for-boot";
      readonly imageHandleRegister: "x0";
      readonly systemTableRegister: "x1";
    }
  | { readonly operationKey: "call-boot-function"; readonly targetLinkageName: "wrela.image.boot" }
  | {
      readonly operationKey: "store-boot-result";
      readonly sourceRegister: "x0";
      readonly slot: "boot-result";
    }
  | {
      readonly operationKey: "reload-boot-result-for-status-conversion";
      readonly targetRegister: "x0";
      readonly slot: "boot-result";
    }
  | { readonly operationKey: "call-status-conversion"; readonly targetLinkageName: string }
  | { readonly operationKey: "ldp-x29-x30-frame"; readonly savedX29OffsetBytes: 32 }
  | { readonly operationKey: "add-sp-frame"; readonly frameSizeBytes: 48 }
  | { readonly operationKey: "ret" };

export interface UefiAArch64EntryThunkRelocationPlan {
  readonly stableKey: string;
  readonly operationKey: UefiAArch64EntryThunkRelocationOperationKey;
  readonly offsetBytes: number;
  readonly targetLinkageName: string;
  readonly family: "branch26";
}

type UefiAArch64EntryThunkRelocationOperationKey =
  | "call-entry-initialize-context"
  | "call-boot-function"
  | "call-status-conversion";

export interface UefiAArch64EntryThunkUnwindPlan {
  readonly stableKey: "unwind:symbol:__wrela_uefi_entry";
  readonly sectionKey: ".text";
  readonly frameShape: typeof ENTRY_FRAME_SHAPE;
}

interface EncodedThunkInstruction {
  readonly operationKey: UefiAArch64EntryThunkInstructionPlan["operationKey"];
  readonly bytes: Uint8Array;
  readonly relocationTargetLinkageName?: string;
}

export function planUefiAArch64EntryThunk(
  input: PlanUefiAArch64EntryThunkInput,
): UefiAArch64TargetResult<UefiAArch64EntryThunkPlan> {
  if (input.entryProfile.thunkStrategy !== "framed-call") {
    return uefiAArch64Error({
      diagnostics: [
        entryThunkDiagnostic(
          `entry-thunk:unsupported-strategy:${input.entryProfile.thunkStrategy}`,
        ),
      ],
      verification: failedVerification(ENTRY_THUNK_VERIFIER_KEY, ENTRY_THUNK_RUN_KEY),
    });
  }

  const profileResult = validateUefiAArch64EntryProfile(input.entryProfile);
  if (profileResult.kind === "error") {
    return uefiAArch64Error({
      diagnostics: profileResult.diagnostics,
      verification: failedVerification(ENTRY_THUNK_VERIFIER_KEY, ENTRY_THUNK_RUN_KEY),
    });
  }

  const encoded = encodeThunkInstructions(input, input.entryProfile.bootFunctionSymbol);
  if (encoded.kind === "error") {
    return uefiAArch64Error({
      diagnostics: encoded.diagnostics.map((diagnostic) =>
        entryThunkDiagnostic(diagnostic.stableDetail),
      ),
      verification: failedVerification(ENTRY_THUNK_VERIFIER_KEY, ENTRY_THUNK_RUN_KEY),
    });
  }

  const planWithoutFingerprint = {
    strategy: "framed-call" as const,
    entrySymbol: input.entryProfile.peEntryLinkageName,
    imageEntryShimSymbol: input.entryProfile.imageEntryShimSymbol,
    bootFunctionSymbol: input.entryProfile.bootFunctionSymbol,
    frameSizeBytes: FRAME_SIZE_BYTES,
    frameSlots: entryThunkFrameSlots(),
    instructions: entryThunkInstructions(input.entryProfile),
    relocations: entryThunkRelocationPlans(encoded.instructions),
    unwind: entryThunkUnwindPlan(),
  };

  return uefiAArch64Ok({
    value: Object.freeze({
      ...planWithoutFingerprint,
      fingerprint: stableHash(
        stableJson({
          ...planWithoutFingerprint,
          backendSurfaceFingerprint: input.backendTarget.backendSurfaceFingerprint,
        }),
      ),
    }),
    verification: passedVerification(ENTRY_THUNK_VERIFIER_KEY, ENTRY_THUNK_RUN_KEY),
  });
}

export function createUefiAArch64EntryThunkObjectFactory(
  input: CreateUefiAArch64EntryThunkObjectFactoryInput,
): AArch64SyntheticObjectFactory {
  return Object.freeze({
    createEntryObject: (factoryInput: AArch64EntryObjectFactoryInput) =>
      createUefiAArch64EntryObject(input, factoryInput),
    createUnwindObjects: (factoryInput: AArch64UnwindObjectFactoryInput) =>
      createUefiAArch64UnwindObjects(factoryInput),
  });
}

function createUefiAArch64EntryObject(
  input: CreateUefiAArch64EntryThunkObjectFactoryInput,
  factoryInput: Parameters<AArch64SyntheticObjectFactory["createEntryObject"]>[0],
): AArch64SyntheticEntryObjectFactoryResult {
  const plan = planUefiAArch64EntryThunk(input);
  if (plan.kind === "error") {
    return {
      kind: "error",
      diagnostics: plan.diagnostics.map((diagnostic) =>
        aarch64SyntheticObjectFactoryDiagnostic(diagnostic.stableDetail),
      ),
    };
  }

  const encoded = encodeThunkInstructions(input, factoryInput.wrelaBootLinkageName);
  if (encoded.kind === "error") return encoded;

  const relocations = entryThunkRelocationPlans(encoded.instructions).map((relocation) => ({
    ...relocation,
    widthBytes: 4,
    instructionPatch: {
      bitRange: [0, 25] as const,
      encodingOwner: { opcode: "bl", catalogEntryKey: "encoding:bl" },
    },
  }));

  return {
    kind: "ok",
    codeBytes: concatInstructionBytes(encoded.instructions),
    relocations: Object.freeze(relocations),
    unwindRecords: Object.freeze([entryThunkObjectUnwindRecord()]),
  };
}

function createUefiAArch64UnwindObjects(
  input: AArch64UnwindObjectFactoryInput,
): AArch64SyntheticUnwindObjectFactoryResult {
  const missingLinkage = input.unwindRecords.find(
    (record) => record.functionLinkageName === undefined,
  );
  if (missingLinkage !== undefined) {
    return Object.freeze({
      kind: "error" as const,
      diagnostics: Object.freeze([
        aarch64SyntheticObjectFactoryDiagnostic(
          `unwind:function-linkage-missing:${missingLinkage.stableKey}`,
        ),
      ]),
    });
  }

  return Object.freeze({
    kind: "ok" as const,
    objects: Object.freeze(
      input.unwindRecords.map((record, index) =>
        Object.freeze({
          objectKey: `unwind-${index}`,
          pdataBytes: entryThunkPdataBytes(index),
          xdataBytes: entryThunkXdataBytes(record.frameShape),
          functionLinkageName: record.functionLinkageName!,
          frameShape: record.frameShape,
          pdataRelocation: Object.freeze({
            stableKey: `reloc:pdata:function:${index}`,
            offsetBytes: 0,
            widthBytes: 4,
            family: "rel32",
          }),
          xdataRelocation: Object.freeze({
            stableKey: `reloc:xdata:function:${index}`,
            offsetBytes: 0,
            widthBytes: 4,
            family: "rel32",
          }),
        }),
      ),
    ),
  });
}

function encodeThunkInstructions(
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

function byteOffsetOf(instructions: readonly EncodedThunkInstruction[], endIndex: number): number {
  return instructions
    .slice(0, endIndex)
    .reduce((sum, instruction) => sum + instruction.bytes.length, 0);
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

function entryThunkPdataBytes(index: number): Uint8Array {
  return Uint8Array.of(0, 0, 0, 0, 1 + (index & 0xff), 0, 0, 0);
}

function entryThunkXdataBytes(frameShape: string): Uint8Array {
  const frameShapeByte = stableHash(frameShape).charCodeAt(0) & 0xff;
  return Uint8Array.of(1, FRAME_SIZE_BYTES, frameShapeByte, 0xe4);
}

function concatInstructionBytes(instructions: readonly EncodedThunkInstruction[]): Uint8Array {
  const byteLength = instructions.reduce((sum, instruction) => sum + instruction.bytes.length, 0);
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const instruction of instructions) {
    output.set(instruction.bytes, offset);
    offset += instruction.bytes.length;
  }
  return output;
}

function entryThunkFrameSlots(): readonly UefiAArch64EntryThunkFrameSlot[] {
  return Object.freeze([
    Object.freeze({ key: "image-handle" as const, offsetBytes: 0, sizeBytes: 8 as const }),
    Object.freeze({ key: "system-table" as const, offsetBytes: 8, sizeBytes: 8 as const }),
    Object.freeze({ key: "boot-result" as const, offsetBytes: 16, sizeBytes: 8 as const }),
    Object.freeze({ key: "saved-x29" as const, offsetBytes: 32, sizeBytes: 8 as const }),
    Object.freeze({ key: "saved-x30" as const, offsetBytes: 40, sizeBytes: 8 as const }),
  ]);
}

function entryThunkInstructions(
  profile: UefiAArch64EntryProfile,
): readonly UefiAArch64EntryThunkInstructionPlan[] {
  return Object.freeze([
    Object.freeze({ operationKey: "sub-sp-frame" as const, frameSizeBytes: FRAME_SIZE_BYTES }),
    Object.freeze({ operationKey: "stp-x29-x30-frame" as const, savedX29OffsetBytes: 32 }),
    Object.freeze({ operationKey: "add-x29-frame" as const, savedX29OffsetBytes: 32 }),
    Object.freeze({
      operationKey: "store-image-handle" as const,
      sourceRegister: "x0" as const,
      slot: "image-handle" as const,
    }),
    Object.freeze({
      operationKey: "store-system-table" as const,
      sourceRegister: "x1" as const,
      slot: "system-table" as const,
    }),
    Object.freeze({
      operationKey: "call-entry-initialize-context" as const,
      targetLinkageName: UEFI_AARCH64_ENTRY_INITIALIZE_CONTEXT_LINKAGE_NAME,
    }),
    Object.freeze({
      operationKey: "branch-if-entry-initialization-failed" as const,
      flagRegister: "x1" as const,
      successValue: 1n,
    }),
    Object.freeze({
      operationKey: "reload-entry-context-for-boot" as const,
      imageHandleRegister: "x0" as const,
      systemTableRegister: "x1" as const,
    }),
    Object.freeze({
      operationKey: "call-boot-function" as const,
      targetLinkageName: profile.bootFunctionSymbol,
    }),
    Object.freeze({
      operationKey: "store-boot-result" as const,
      sourceRegister: "x0" as const,
      slot: "boot-result" as const,
    }),
    Object.freeze({
      operationKey: "reload-boot-result-for-status-conversion" as const,
      targetRegister: "x0" as const,
      slot: "boot-result" as const,
    }),
    Object.freeze({
      operationKey: "call-status-conversion" as const,
      targetLinkageName: UEFI_AARCH64_STATUS_FROM_BOOT_RESULT_LINKAGE_NAME,
    }),
    Object.freeze({ operationKey: "ldp-x29-x30-frame" as const, savedX29OffsetBytes: 32 }),
    Object.freeze({ operationKey: "add-sp-frame" as const, frameSizeBytes: FRAME_SIZE_BYTES }),
    Object.freeze({ operationKey: "ret" as const }),
  ]);
}

function entryThunkRelocationPlans(
  instructions: readonly EncodedThunkInstruction[],
): readonly UefiAArch64EntryThunkRelocationPlan[] {
  const relocations: UefiAArch64EntryThunkRelocationPlan[] = [];
  let offsetBytes = 0;
  for (const instruction of instructions) {
    if (
      instruction.relocationTargetLinkageName !== undefined &&
      isEntryThunkRelocationOperationKey(instruction.operationKey)
    ) {
      relocations.push(
        Object.freeze({
          stableKey: `reloc:entry:${instruction.operationKey}`,
          operationKey: instruction.operationKey,
          offsetBytes,
          targetLinkageName: instruction.relocationTargetLinkageName,
          family: "branch26" as const,
        }),
      );
    }
    offsetBytes += instruction.bytes.length;
  }
  return Object.freeze(relocations);
}

function isEntryThunkRelocationOperationKey(
  operationKey: UefiAArch64EntryThunkInstructionPlan["operationKey"],
): operationKey is UefiAArch64EntryThunkRelocationOperationKey {
  return (
    operationKey === "call-entry-initialize-context" ||
    operationKey === "call-boot-function" ||
    operationKey === "call-status-conversion"
  );
}

function entryThunkUnwindPlan(): UefiAArch64EntryThunkUnwindPlan {
  return Object.freeze({
    stableKey: "unwind:symbol:__wrela_uefi_entry" as const,
    sectionKey: ".text" as const,
    frameShape: ENTRY_FRAME_SHAPE,
  });
}

function entryThunkObjectUnwindRecord(): AArch64ObjectUnwindRecord {
  const unwind = entryThunkUnwindPlan();
  return aarch64ObjectUnwindRecord({
    stableKey: unwind.stableKey,
    sectionKey: unwind.sectionKey,
    frameShape: unwind.frameShape,
  });
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

function entryThunkDiagnostic(stableDetail: string) {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_ENTRY_THUNK_FAILED",
    ownerKey: ENTRY_THUNK_OWNER_KEY,
    stableDetail,
  });
}
