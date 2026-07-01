export type AArch64SingletonResourceKind = "NZCV" | "vectorState" | "FPCR" | "FPSR" | "SP";

export type AArch64MachineResource =
  | { readonly kind: AArch64SingletonResourceKind }
  | { readonly kind: "platform"; readonly key: string };

export function aarch64Resource(
  input:
    | AArch64SingletonResourceKind
    | { readonly kind: AArch64SingletonResourceKind }
    | { readonly kind: "platform"; readonly key: string },
): AArch64MachineResource {
  if (typeof input === "string") {
    return Object.freeze({ kind: input });
  }
  if (input.kind !== "platform") {
    return Object.freeze({ kind: input.kind });
  }
  if (input.key.length === 0) {
    throw new RangeError("platform resource key must be non-empty.");
  }
  return Object.freeze({ kind: "platform", key: input.key });
}

export function aarch64ResourceStableKey(resource: AArch64MachineResource): string {
  return resource.kind === "platform" ? `platform:${resource.key}` : resource.kind;
}
