import { RPI5_BACKEND_CATALOGS } from "../catalogs/rpi5-backend-catalog-data";
import type {
  AArch64EncodingCatalog,
  AArch64PhysicalRegisterModel,
} from "../api/backend-catalog-interfaces";
import {
  encodeAArch64PhysicalInstructionWithFamilies,
  type AArch64EncodedInstruction,
  type AArch64PhysicalInstructionToEncode,
} from "./encoding-core";
import { AARCH64_ENCODER_FAMILIES } from "./encoding-opcodes";

export { encodeAArch64PhysicalInstructionWithFamilies } from "./encoding-core";
export { aarch64IntegerBranchEncoderFamilies } from "./encoding-integer-branch";
export { aarch64MemorySimdFpEncoderFamilies } from "./encoding-memory-simd-fp";
export { AARCH64_ENCODER_FAMILIES, IMPLEMENTED_AARCH64_ENCODER_OPCODES } from "./encoding-opcodes";

export function encodeAArch64PhysicalInstruction(instruction: AArch64PhysicalInstructionToEncode) {
  return encodeAArch64PhysicalInstructionForTarget({
    instruction,
    encodingCatalog: RPI5_BACKEND_CATALOGS.encodingCatalog,
    registerModel: RPI5_BACKEND_CATALOGS.registerModel,
  });
}

export function encodeAArch64PhysicalInstructionForTarget(input: {
  readonly instruction: AArch64PhysicalInstructionToEncode;
  readonly encodingCatalog: AArch64EncodingCatalog;
  readonly registerModel: AArch64PhysicalRegisterModel;
}) {
  return encodeAArch64PhysicalInstructionWithFamilies(
    {
      catalog: input.encodingCatalog,
      registerModel: input.registerModel,
      instruction: input.instruction,
    },
    AARCH64_ENCODER_FAMILIES,
  );
}

export type { AArch64EncodedInstruction, AArch64PhysicalInstructionToEncode };
