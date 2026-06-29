import { optIrValueId, type OptIrOriginId, type OptIrValueId } from "../ids";
import { optIrBlockParameter, type OptIrBlockParameter } from "../values";
import type { OptIrType } from "../types";

export interface OptIrLoweredParameterInput {
  readonly valueKey: string;
  readonly type: OptIrType;
  readonly incomingRole: OptIrBlockParameter["incomingRole"];
  readonly runtime: boolean;
  readonly proofOnlyReason?: string;
  readonly originId: OptIrOriginId;
}

export interface OptIrProofOnlyValueMarker {
  readonly valueId: OptIrValueId;
  readonly reason: string;
}

export interface OptIrBlockArgumentBuilder {
  readonly parameterFor: (input: OptIrLoweredParameterInput) => OptIrBlockParameter;
  readonly valueIdFor: (valueKey: string) => OptIrValueId | undefined;
  readonly executableValueIds: () => readonly OptIrValueId[];
  readonly proofOnlyValueIds: () => readonly OptIrValueId[];
  readonly valuesMarkedForErasure: () => readonly OptIrProofOnlyValueMarker[];
  readonly valueEntries: () => readonly [string, OptIrValueId][];
}

export function optIrBlockArgumentBuilder(): OptIrBlockArgumentBuilder {
  const valueIdsByKey = new Map<string, OptIrValueId>();
  const executableValueIds = new Set<OptIrValueId>();
  const proofOnlyValueIds = new Set<OptIrValueId>();
  const erasureMarkers = new Map<OptIrValueId, OptIrProofOnlyValueMarker>();

  function valueIdForKey(valueKey: string): OptIrValueId {
    const existing = valueIdsByKey.get(valueKey);
    if (existing !== undefined) {
      return existing;
    }

    const valueId = optIrValueId(valueIdsByKey.size);
    valueIdsByKey.set(valueKey, valueId);
    return valueId;
  }

  return {
    parameterFor(input) {
      const valueId = valueIdForKey(input.valueKey);
      if (input.runtime) {
        executableValueIds.add(valueId);
      } else {
        proofOnlyValueIds.add(valueId);
        erasureMarkers.set(valueId, {
          valueId,
          reason: input.proofOnlyReason ?? "proofOnly",
        });
      }

      return optIrBlockParameter({
        valueId,
        type: input.type,
        incomingRole: input.incomingRole,
        originId: input.originId,
      });
    },
    valueIdFor(valueKey) {
      return valueIdsByKey.get(valueKey);
    },
    executableValueIds() {
      return [...executableValueIds].sort(compareDenseIds);
    },
    proofOnlyValueIds() {
      return [...proofOnlyValueIds].sort(compareDenseIds);
    },
    valuesMarkedForErasure() {
      return [...erasureMarkers.values()].sort((left, right) => left.valueId - right.valueId);
    },
    valueEntries() {
      return [...valueIdsByKey.entries()];
    },
  };
}

function compareDenseIds(left: OptIrValueId, right: OptIrValueId): number {
  return left - right;
}
