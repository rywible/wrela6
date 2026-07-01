import { aarch64IntegerBranchEncoderFamilies } from "./encoding-integer-branch";
import { aarch64MemorySimdFpEncoderFamilies } from "./encoding-memory-simd-fp";

export const AARCH64_ENCODER_FAMILIES = Object.freeze([
  ...aarch64IntegerBranchEncoderFamilies,
  ...aarch64MemorySimdFpEncoderFamilies,
]);

export const IMPLEMENTED_AARCH64_ENCODER_OPCODES = Object.freeze(
  AARCH64_ENCODER_FAMILIES.flatMap((family) => family.opcodes),
);
