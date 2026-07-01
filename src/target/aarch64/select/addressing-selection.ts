export function selectAArch64AddressingMode(input: {
  readonly byteOffset: bigint;
  readonly scale: number;
  readonly indexWidthBits?: number;
}):
  | "base-signed-immediate"
  | "base-unsigned-immediate"
  | "base-extended-index"
  | "materialized-address" {
  if (!Number.isInteger(input.scale) || input.scale <= 0) return "materialized-address";
  const scale = BigInt(input.scale);
  if (
    input.byteOffset >= 0n &&
    input.byteOffset <= 4095n * scale &&
    input.byteOffset % scale === 0n
  )
    return "base-unsigned-immediate";
  if (input.byteOffset >= -256n && input.byteOffset <= 255n) return "base-signed-immediate";
  if ((input.indexWidthBits ?? 0) > 0) return "base-extended-index";
  return "materialized-address";
}
