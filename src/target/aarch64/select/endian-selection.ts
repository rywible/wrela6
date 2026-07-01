export function selectAArch64EndianDecode(input: {
  readonly endian: "little" | "big" | "native";
  readonly widthBits: 16 | 32 | 64 | 128;
  readonly hostEndian?: "little" | "big";
}): { readonly opcode: "identity" | "rev" | "rev16" | "rev32" | "vector-rev" } {
  const hostEndian = input.hostEndian ?? "little";
  if (input.endian === "native" || input.endian === hostEndian) return { opcode: "identity" };
  if (input.widthBits === 16) return { opcode: "rev16" };
  if (input.widthBits === 32) return { opcode: "rev32" };
  if (input.widthBits === 128) return { opcode: "vector-rev" };
  return { opcode: "rev" };
}
