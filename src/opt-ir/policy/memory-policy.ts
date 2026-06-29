import type { OptIrOperation } from "../operations";
import type { OptIrRegion } from "../regions";

export interface OptIrMemoryTargetContract {
  readonly permitsObservableStoreRemoval?: (
    store: OptIrOperation & { readonly kind: "memoryStore" },
    region: OptIrRegion,
  ) => boolean;
}

export interface OptIrMemoryOptimizationPolicy {
  readonly targetContract?: OptIrMemoryTargetContract;
}

export function mayRemoveObservableStore(
  store: OptIrOperation & { readonly kind: "memoryStore" },
  region: OptIrRegion,
  policy: OptIrMemoryOptimizationPolicy | undefined,
): boolean {
  return policy?.targetContract?.permitsObservableStoreRemoval?.(store, region) === true;
}

export function isObservableStoreTarget(region: OptIrRegion): boolean {
  return (
    region.volatility === "volatile" ||
    region.kind === "firmwareTable" ||
    region.kind === "imageDevice" ||
    region.kind === "runtimeMemory" ||
    region.kind === "externalUnknown"
  );
}
