import type { CheckedFunctionSummary } from "../proof-check/model/function-summary";
import type { MonoFunctionSignature } from "../mono/mono-hir";
import type { MonoInstanceId } from "../mono/ids";
import type { TargetId } from "../semantic/ids";
import type { OptIrConstant } from "./constants";
import type { OptIrBlock, OptIrCfgEdgeTable } from "./cfg";
import type { OptIrCallGraphEdge } from "./analyses/call-graph";
import type {
  OptIrBlockId,
  OptIrConstantId,
  OptIrFunctionId,
  OptIrOriginId,
  OptIrProgramId,
  OptIrRegionId,
} from "./ids";

export interface OptIrRegionRecord {
  readonly regionId: OptIrRegionId;
  readonly originId: OptIrOriginId;
}

export interface OptIrCallGraph {
  readonly calls: readonly OptIrCallGraphEdge[];
}

export interface OptIrProgramProvenance {
  readonly originIds: readonly OptIrOriginId[];
}

export interface OptIrExternalRoot {
  readonly reason: "imageEntry" | "deviceHandler" | "hardwareCallback" | "targetRequired";
  readonly originId: OptIrOriginId;
}

export interface OptIrProgram {
  readonly programId: OptIrProgramId;
  readonly targetId: TargetId;
  readonly functions: OptIrTable<OptIrFunctionId, OptIrFunction>;
  readonly regions: OptIrTable<OptIrRegionId, OptIrRegionRecord>;
  readonly constants: OptIrTable<OptIrConstantId, OptIrConstant>;
  readonly callGraph: OptIrCallGraph;
  readonly provenance: OptIrProgramProvenance;
}

export interface OptIrFunction {
  readonly functionId: OptIrFunctionId;
  readonly monoInstanceId: MonoInstanceId;
  readonly signature: MonoFunctionSignature;
  readonly blocks: readonly OptIrBlock[];
  readonly edges: OptIrCfgEdgeTable;
  readonly entryBlock: OptIrBlockId;
  readonly externalRoot?: OptIrExternalRoot;
  readonly summary?: CheckedFunctionSummary;
  readonly originId: OptIrOriginId;
}

export interface OptIrTable<LookupId, Entry> {
  readonly get: (lookupId: LookupId) => Entry | undefined;
  readonly has: (lookupId: LookupId) => boolean;
  readonly entries: () => readonly Entry[];
}

export function optIrProgram(input: OptIrProgram): OptIrProgram {
  return input;
}

export function optIrFunctionTable(functions: readonly OptIrFunction[]) {
  return optIrTable(functions, (entry) => entry.functionId, "function", "functions");
}

export function optIrRegionTable(regions: readonly OptIrRegionRecord[]) {
  return optIrTable(regions, (entry) => entry.regionId, "region", "regions");
}

export function optIrConstantTable(constants: readonly OptIrConstant[]) {
  return optIrTableAllowingDuplicateLastWrite(constants, (entry) => entry.constantId);
}

function optIrTable<LookupId, Entry>(
  entries: readonly Entry[],
  idOf: (entry: Entry) => LookupId,
  idLabel = "entry",
  tableLabel = "entries",
): OptIrTable<LookupId, Entry> {
  const sortedEntries = [...entries].sort(
    (left, right) => Number(idOf(left)) - Number(idOf(right)),
  );
  const byId = new Map<LookupId, Entry>();
  for (const [index, entry] of entries.entries()) {
    const id = idOf(entry);
    if (byId.has(id)) {
      throw new RangeError(
        `Duplicate OptIR ${idLabel} id ${String(id)} at ${tableLabel}[${index}].`,
      );
    }
    byId.set(id, entry);
  }
  return {
    get(id) {
      return byId.get(id);
    },
    has(id) {
      return byId.has(id);
    },
    entries() {
      return sortedEntries.slice();
    },
  };
}

function optIrTableAllowingDuplicateLastWrite<LookupId, Entry>(
  entries: readonly Entry[],
  idOf: (entry: Entry) => LookupId,
): OptIrTable<LookupId, Entry> {
  const sortedEntries = [...entries].sort(
    (left, right) => Number(idOf(left)) - Number(idOf(right)),
  );
  const byId = new Map<LookupId, Entry>();
  for (const entry of sortedEntries) {
    byId.set(idOf(entry), entry);
  }
  return {
    get(id) {
      return byId.get(id);
    },
    has(id) {
      return byId.has(id);
    },
    entries() {
      return sortedEntries.slice();
    },
  };
}
