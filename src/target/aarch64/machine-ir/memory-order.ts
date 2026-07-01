export type AArch64MemoryOrder =
  | "relaxed"
  | "acquire"
  | "release"
  | "acquireRelease"
  | "sequentiallyConsistent"
  | "deviceOrdered"
  | "compilerOnlyOrdered";

export type AArch64RegionMemoryType =
  | "normalCacheable"
  | "deviceMmio"
  | "firmwareTable"
  | "runtimeOwned"
  | "externalConservative"
  | "packetSource"
  | "validatedPayload";

export interface AArch64BarrierDomain {
  readonly domain: "nonShareable" | "innerShareable" | "outerShareable" | "system";
  readonly access: "loads" | "stores" | "loadsAndStores";
}

export type AArch64Atomicity = "nonAtomic" | "singleCopyAtomic" | "lseAtomic";

export interface AArch64MemoryFootprint {
  readonly regionKey: string;
  readonly start: bigint;
  readonly widthBytes: number;
  readonly alignment: number;
}

export interface AArch64MemoryOrderingMetadata {
  readonly order: AArch64MemoryOrder;
  readonly regionMemoryType: AArch64RegionMemoryType;
  readonly barrierDomain: AArch64BarrierDomain;
  readonly atomicity: AArch64Atomicity;
}

export function aarch64MemoryFootprint(input: AArch64MemoryFootprint): AArch64MemoryFootprint {
  if (input.regionKey.length === 0) {
    throw new RangeError("memory footprint regionKey must be non-empty.");
  }
  if (!Number.isInteger(input.widthBytes) || input.widthBytes <= 0) {
    throw new RangeError("memory footprint widthBytes must be positive.");
  }
  if (!Number.isInteger(input.alignment) || input.alignment <= 0) {
    throw new RangeError("memory footprint alignment must be positive.");
  }
  return Object.freeze({ ...input });
}

export function aarch64MemoryOrderingMetadata(
  input: AArch64MemoryOrderingMetadata,
): AArch64MemoryOrderingMetadata {
  return Object.freeze({
    order: input.order,
    regionMemoryType: input.regionMemoryType,
    barrierDomain: Object.freeze({ ...input.barrierDomain }),
    atomicity: input.atomicity,
  });
}
