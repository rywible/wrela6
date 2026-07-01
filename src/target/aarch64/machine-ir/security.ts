export type AArch64SecurityLabel =
  | { readonly kind: "secret"; readonly key: string }
  | { readonly kind: "constantTime"; readonly key: string }
  | { readonly kind: "keyLifetime"; readonly key: string }
  | { readonly kind: "noSpill"; readonly key: string }
  | { readonly kind: "wipeOnSpill"; readonly key: string }
  | { readonly kind: "zeroization"; readonly key: string };

export interface AArch64ZeroizationPlan {
  readonly required: boolean;
  readonly reason: string;
}

export interface AArch64SecurityMetadata {
  readonly labels: readonly AArch64SecurityLabel[];
  readonly constantTime: boolean;
  readonly spillPolicy: "ordinary" | "noSpill" | "wipeOnSpill";
  readonly zeroization?: AArch64ZeroizationPlan;
}

function freezeLabel(label: AArch64SecurityLabel): AArch64SecurityLabel {
  if (label.key.length === 0) {
    throw new RangeError("security label key must be non-empty.");
  }
  return Object.freeze({ ...label });
}

export function aarch64SecurityMetadata(input: AArch64SecurityMetadata): AArch64SecurityMetadata {
  return Object.freeze({
    labels: Object.freeze(input.labels.map(freezeLabel)),
    constantTime: input.constantTime,
    spillPolicy: input.spillPolicy,
    ...(input.zeroization === undefined
      ? {}
      : {
          zeroization: Object.freeze({
            ...input.zeroization,
          }),
        }),
  });
}

export function emptyAArch64SecurityMetadata(): AArch64SecurityMetadata {
  return aarch64SecurityMetadata({ labels: [], constantTime: false, spillPolicy: "ordinary" });
}
