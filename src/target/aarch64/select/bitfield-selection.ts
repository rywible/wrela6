export function selectAArch64BitfieldOperation(input: {
  readonly signed: boolean;
  readonly insert: boolean;
  readonly hasLayoutFact: boolean;
}): "ubfx" | "sbfx" | "bfi" | "bfxil" | "fallback" {
  if (!input.hasLayoutFact) return "fallback";
  if (input.insert) return input.signed ? "fallback" : "bfi";
  return input.signed ? "sbfx" : "ubfx";
}
