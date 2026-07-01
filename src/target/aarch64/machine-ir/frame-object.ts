import type { AArch64FrameObjectId } from "./ids";
import { emptyAArch64SecurityMetadata, type AArch64SecurityMetadata } from "./security";

export type AArch64FrameObjectKind = "incomingArg" | "outgoingArgArea" | "local" | "regionBacked";

export interface AArch64FrameObject {
  readonly frameObjectId: AArch64FrameObjectId;
  readonly kind: AArch64FrameObjectKind;
  readonly size: number;
  readonly alignment: number;
  readonly regionKey?: string;
  readonly mutability: "immutable" | "mutable";
  readonly security: AArch64SecurityMetadata;
}

export function aarch64FrameObject(input: {
  readonly frameObjectId: AArch64FrameObjectId;
  readonly kind: AArch64FrameObjectKind;
  readonly size: number;
  readonly alignment: number;
  readonly regionKey?: string;
  readonly mutability?: "immutable" | "mutable";
  readonly security?: AArch64SecurityMetadata;
}): AArch64FrameObject {
  if (!Number.isInteger(input.size) || input.size < 0) {
    throw new RangeError("frame object size must be a non-negative integer.");
  }
  if (!Number.isInteger(input.alignment) || input.alignment <= 0) {
    throw new RangeError("frame object alignment must be positive.");
  }
  return Object.freeze({
    frameObjectId: input.frameObjectId,
    kind: input.kind,
    size: input.size,
    alignment: input.alignment,
    ...(input.regionKey === undefined ? {} : { regionKey: input.regionKey }),
    mutability: input.mutability ?? "mutable",
    security: input.security ?? emptyAArch64SecurityMetadata(),
  });
}
