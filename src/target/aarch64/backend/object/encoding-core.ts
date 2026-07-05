import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import type {
  AArch64EncodingCatalog,
  AArch64PhysicalRegisterModel,
} from "../api/backend-catalog-interfaces";

export type AArch64InstructionOperand =
  | { readonly kind: "register"; readonly register: string }
  | { readonly kind: "memory-base"; readonly register: string }
  | { readonly kind: "immediate"; readonly value: bigint }
  | { readonly kind: "condition"; readonly condition: string }
  | { readonly kind: "relocation-target"; readonly target: string }
  | { readonly kind: "relocation-low12"; readonly target: string; readonly addend: bigint };

export interface AArch64PhysicalInstructionToEncode {
  readonly opcode: string;
  readonly operands: readonly AArch64InstructionOperand[];
  readonly accessWidthBytes?: number;
  readonly relocation?: { readonly family: string; readonly target: string };
}

export interface AArch64EncodeInput {
  readonly catalog: AArch64EncodingCatalog;
  readonly registerModel: AArch64PhysicalRegisterModel;
  readonly instruction: AArch64PhysicalInstructionToEncode;
}

export interface AArch64EncodedRelocationHoleMetadata {
  readonly family: string;
  readonly patchOffsetBytes: number;
  readonly bitRange: readonly [number, number];
  readonly target: string;
}

export interface AArch64EncodedInstruction {
  readonly bytes: Uint8Array;
  readonly relocationHole?: AArch64EncodedRelocationHoleMetadata;
}

export interface AArch64InstructionFamilyEncoder {
  readonly family: string;
  readonly opcodes: readonly string[];
  readonly encode: (input: AArch64EncodeInput) => AArch64BackendResult<AArch64EncodedInstruction>;
}

export function encodeAArch64PhysicalInstructionWithFamilies(
  input: AArch64EncodeInput,
  families: readonly AArch64InstructionFamilyEncoder[],
): AArch64BackendResult<AArch64EncodedInstruction> {
  const catalogEntry = input.catalog.entryForOpcode(input.instruction.opcode);
  if (catalogEntry === undefined) {
    return encodingError(`encoding:unsupported-opcode:${input.instruction.opcode}`);
  }
  const family = families.find((candidate) => candidate.opcodes.includes(input.instruction.opcode));
  if (family === undefined) {
    return encodingError(`encoding:unsupported-family:${input.instruction.opcode}`);
  }
  return family.encode(input);
}

export function writeU32Le(word: number): Uint8Array {
  return Uint8Array.of(
    word & 0xff,
    (word >>> 8) & 0xff,
    (word >>> 16) & 0xff,
    (word >>> 24) & 0xff,
  );
}

export function wordToU32Le(bytes: ArrayLike<number>): number {
  return ((bytes[3]! << 24) | (bytes[2]! << 16) | (bytes[1]! << 8) | bytes[0]!) >>> 0;
}

export function registerNumber(input: AArch64EncodeInput, register: string): number {
  return input.registerModel.encodingNumberOf(register);
}

export function encodingError(stableDetail: string): AArch64BackendResult<never> {
  return backendError([encodingDiagnostic(stableDetail)]);
}

export function encodingOk(
  value: AArch64EncodedInstruction,
): AArch64BackendResult<AArch64EncodedInstruction> {
  return backendOk(value);
}

function encodingDiagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_ENCODING_INVALID",
    stableDetail,
    ownerKey: "encoding",
    rootCauseKey: stableDetail,
  });
}
