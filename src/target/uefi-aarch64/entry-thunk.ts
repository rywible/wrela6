import type {
  AArch64EntryObjectFactoryInput,
  AArch64SyntheticEntryObjectFactoryResult,
  AArch64SyntheticObjectFactory,
  AArch64UnwindObjectFactoryInput,
} from "../../linker/aarch64/aarch64-entry-objects";
import { aarch64SyntheticObjectFactoryDiagnostic } from "../../linker/aarch64/aarch64-entry-objects";
import { stableHash, stableJson } from "../../shared/stable-json";
import type { AArch64BackendTargetSurface } from "../aarch64/backend/api/backend-target-surface";
import { uefiAArch64TargetDiagnostic } from "./diagnostics";
import {
  concatInstructionBytes,
  encodeThunkInstructions,
  type EncodedThunkInstruction,
} from "./entry-thunk-instructions";
import {
  createUefiAArch64UnwindObjects,
  entryThunkObjectUnwindRecord,
  entryThunkUnwindPlan,
  type UefiAArch64EntryThunkUnwindPlan,
} from "./entry-thunk-unwind";
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

function entryThunkDiagnostic(stableDetail: string) {
  return uefiAArch64TargetDiagnostic({
    code: "UEFI_AARCH64_ENTRY_THUNK_FAILED",
    ownerKey: ENTRY_THUNK_OWNER_KEY,
    stableDetail,
  });
}
