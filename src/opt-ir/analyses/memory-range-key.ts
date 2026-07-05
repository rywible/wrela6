import type { OptIrRegionId } from "../ids";

export type OptIrMemoryRangeKey = string & { readonly __optIrMemoryRangeKey: unique symbol };

export interface OptIrMemoryRangeAccess {
  readonly region: OptIrRegionId;
  readonly byteOffset: bigint;
  readonly byteWidth: number;
  readonly endian: string;
}

export function optIrMemoryRangeKey(access: OptIrMemoryRangeAccess): OptIrMemoryRangeKey {
  return `${access.region}:${access.byteOffset}:${access.byteWidth}:${access.endian}` as OptIrMemoryRangeKey;
}

export function optIrRegionIdFromMemoryRangeKey(key: OptIrMemoryRangeKey): OptIrRegionId {
  return Number(key.split(":", 1)[0]) as OptIrRegionId;
}
