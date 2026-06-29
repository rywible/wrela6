import { optIrOriginId, type OptIrOriginId } from "../ids";
import type { OptIrOrigin, OptIrSourceOrigin } from "../provenance";
import type { MonoInstanceId } from "../../mono/ids";
import type { HirOriginId } from "../../hir/ids";
import type { ProofMirOriginId } from "../../proof-mir/ids";

export interface OptIrLoweringOriginInput {
  readonly functionInstanceId: MonoInstanceId;
  readonly checkedMirNodeKey: string;
  readonly source?: OptIrSourceOrigin;
  readonly hirOriginId?: HirOriginId;
  readonly proofMirOriginId?: ProofMirOriginId;
}

export interface OptIrProvenanceBuilder {
  readonly originFor: (input: OptIrLoweringOriginInput) => OptIrOriginId;
  readonly entries: () => readonly OptIrOrigin[];
  readonly get: (originId: OptIrOriginId) => OptIrOrigin | undefined;
}

export function optIrProvenanceBuilder(): OptIrProvenanceBuilder {
  const origins: OptIrOrigin[] = [];
  const byKey = new Map<string, OptIrOriginId>();

  return {
    originFor(input) {
      const key = originStableKey(input);
      const existing = byKey.get(key);
      if (existing !== undefined) {
        return existing;
      }

      const originId = optIrOriginId(origins.length);
      origins.push({
        originId,
        ...(input.source === undefined ? {} : { source: input.source }),
        ...(input.hirOriginId === undefined ? {} : { hir: { originId: input.hirOriginId } }),
        mono: { functionInstanceId: input.functionInstanceId },
        ...(input.proofMirOriginId === undefined
          ? {}
          : {
              proofMirNode: { kind: "node", nodeKey: `origin:${String(input.proofMirOriginId)}` },
            }),
        checkedMir: {
          functionInstanceId: input.functionInstanceId,
          nodeKey: input.checkedMirNodeKey,
        },
      });
      byKey.set(key, originId);
      return originId;
    },
    entries() {
      return origins.slice();
    },
    get(originId) {
      return origins[Number(originId)];
    },
  };
}

function originStableKey(input: OptIrLoweringOriginInput): string {
  return [
    String(input.functionInstanceId),
    input.checkedMirNodeKey,
    input.source?.file ?? "",
    input.source?.span?.start ?? "",
    input.source?.span?.end ?? "",
    input.hirOriginId === undefined ? "" : String(input.hirOriginId),
    input.proofMirOriginId === undefined ? "" : String(input.proofMirOriginId),
  ].join("|");
}
