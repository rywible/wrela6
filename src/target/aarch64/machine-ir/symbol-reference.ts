import type { AArch64SymbolId } from "./ids";

export interface AArch64SymbolReference {
  readonly symbol: AArch64SymbolId;
  readonly visibility: "local" | "global" | "external";
  readonly section?: "text" | "rodata" | "data" | "bss";
}

export function aarch64SymbolReference(input: AArch64SymbolReference): AArch64SymbolReference {
  return Object.freeze({ ...input });
}
