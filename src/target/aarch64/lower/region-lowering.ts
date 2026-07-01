import type { OptIrFactId, OptIrRegionId } from "../../../opt-ir/ids";
import type { OptIrFactRecord } from "../../../opt-ir/facts/fact-index";
import type { OptIrRegion } from "../../../opt-ir/regions";
import { aarch64Diagnostic, type AArch64LoweringDiagnostic } from "../machine-ir/diagnostics";
import {
  aarch64FrameObjectId,
  aarch64SymbolId,
  type AArch64FrameObjectId,
} from "../machine-ir/ids";
import type { AArch64RegionMemoryType } from "../machine-ir/memory-order";
import type { AArch64SymbolReference } from "../machine-ir/symbol-reference";
import { aarch64SymbolReference } from "../machine-ir/symbol-reference";
import { appendAArch64SelectionRecord, type AArch64LoweringState } from "./pipeline-stages";
import { recordAArch64StagePlanning } from "./stage-helpers";

export type AArch64RegionKind =
  | "stack"
  | "packetSource"
  | "validatedPayload"
  | "constantData"
  | "globalData"
  | "deviceMmio"
  | "firmwareTable"
  | "runtimeOwned"
  | "external";

export type AArch64RegionAddressBasis =
  | { readonly kind: "frameObject"; readonly object: AArch64FrameObjectId }
  | { readonly kind: "incomingPointer"; readonly source: string }
  | {
      readonly kind: "derivedRegionBase";
      readonly backingRegion: OptIrRegionId;
      readonly byteOffset: bigint;
      readonly copyIntroduced: false;
    }
  | { readonly kind: "globalSymbol"; readonly symbol: AArch64SymbolReference }
  | {
      readonly kind: "deviceMmioBase";
      readonly deviceKey: string;
      readonly base: AArch64SymbolReference;
    }
  | { readonly kind: "firmwareTableBase"; readonly tableKey: string; readonly base: string }
  | { readonly kind: "runtimeOwned"; readonly ownerKey: string; readonly base: string }
  | { readonly kind: "externalPointer"; readonly source: string };

export type LowerAArch64RegionResult =
  | { readonly kind: "ok"; readonly addressBasis: AArch64RegionAddressBasis }
  | { readonly kind: "error"; readonly reason: string };

export type AArch64RegionAddressBasisDecision =
  | {
      readonly kind: "ok";
      readonly addressBasis: AArch64RegionAddressBasis;
      readonly factsUsed: readonly OptIrFactId[];
      readonly explanation: readonly string[];
    }
  | { readonly kind: "error"; readonly stableDetail: string };

export function lowerAArch64Region(input: {
  readonly regionId: OptIrRegionId;
  readonly regionKind: AArch64RegionKind;
  readonly backingRegion?: OptIrRegionId;
  readonly certifiedOffset?: bigint;
  readonly provenanceKey?: string;
}): LowerAArch64RegionResult {
  switch (input.regionKind) {
    case "stack":
      return {
        kind: "ok",
        addressBasis: { kind: "frameObject", object: aarch64RegionFrameObjectId(input.regionId) },
      };
    case "packetSource":
      return {
        kind: "ok",
        addressBasis: { kind: "incomingPointer", source: `region:${String(input.regionId)}` },
      };
    case "validatedPayload":
      if (input.backingRegion === undefined || input.certifiedOffset === undefined) {
        return { kind: "error", reason: "validated-payload:missing-backing" };
      }
      return {
        kind: "ok",
        addressBasis: {
          kind: "derivedRegionBase",
          backingRegion: input.backingRegion,
          byteOffset: input.certifiedOffset,
          copyIntroduced: false,
        },
      };
    case "constantData":
    case "globalData":
      return {
        kind: "ok",
        addressBasis: {
          kind: "globalSymbol",
          symbol: aarch64SymbolReference({
            symbol: aarch64SymbolId(`region.${String(input.regionId)}`),
            visibility: input.regionKind === "constantData" ? "local" : "global",
            section: input.regionKind === "constantData" ? "rodata" : "data",
          }),
        },
      };
    case "deviceMmio":
      if ((input.provenanceKey ?? "").length === 0)
        return { kind: "error", reason: "device-mmio:missing-provenance" };
      return {
        kind: "ok",
        addressBasis: {
          kind: "deviceMmioBase",
          deviceKey: input.provenanceKey ?? "",
          base: aarch64SymbolReference({
            symbol: aarch64SymbolId(`device.${input.provenanceKey ?? "missing"}`),
            visibility: "external",
          }),
        },
      };
    case "firmwareTable":
      if ((input.provenanceKey ?? "").length === 0)
        return { kind: "error", reason: "firmware-table:missing-provenance" };
      return {
        kind: "ok",
        addressBasis: {
          kind: "firmwareTableBase",
          tableKey: input.provenanceKey ?? "",
          base: "uefi.system-table",
        },
      };
    case "runtimeOwned":
      if ((input.provenanceKey ?? "").length === 0)
        return { kind: "error", reason: "runtime-owned:missing-owner" };
      return {
        kind: "ok",
        addressBasis: {
          kind: "runtimeOwned",
          ownerKey: input.provenanceKey ?? "",
          base: "runtime.owner",
        },
      };
    case "external":
      return {
        kind: "ok",
        addressBasis: { kind: "externalPointer", source: `region:${String(input.regionId)}` },
      };
  }
}

export function aarch64RegionFrameObjectId(regionId: OptIrRegionId): AArch64FrameObjectId {
  return aarch64FrameObjectId(10_000 + Number(regionId));
}

export function aarch64RegionMemoryTypeForOptIrRegion(
  region: OptIrRegion | undefined,
): AArch64RegionMemoryType | undefined {
  switch (region?.kind) {
    case "stackLocal":
    case "sourceAggregate":
    case "constantData":
    case "globalData":
      return "normalCacheable";
    case "packetSource":
      return "packetSource";
    case "validatedPayload":
      return "validatedPayload";
    case "imageDevice":
      return "deviceMmio";
    case "firmwareTable":
      return "firmwareTable";
    case "runtimeMemory":
      return "runtimeOwned";
    case "externalUnknown":
      return "externalConservative";
    case undefined:
      return undefined;
  }
}

export function resolveAArch64RegionAddressBasisForState(
  state: AArch64LoweringState,
  regionId: OptIrRegionId,
): AArch64RegionAddressBasisDecision {
  const regionRecord = state.program.regions
    .entries()
    .find((candidate) => candidate.regionId === regionId);
  if (regionRecord === undefined) {
    return { kind: "error", stableDetail: `region-address-basis:missing-region:${regionId}` };
  }
  const memoryTypeFact = regionMemoryTypeFactFor(state, regionId);
  const footprint = footprintFactFor(state, regionId);
  const input = regionLoweringInputForRegion(state, regionRecord);
  const lowered = lowerAArch64Region(input);
  if (lowered.kind === "error") {
    return { kind: "error", stableDetail: lowered.reason };
  }
  return {
    kind: "ok",
    addressBasis: lowered.addressBasis,
    factsUsed: [memoryTypeFact, footprint]
      .flatMap((record) => (record === undefined ? [] : [record.factId]))
      .sort((left, right) => Number(left) - Number(right)),
    explanation: Object.freeze([
      `region-address-basis:${String(regionId)}:${regionAddressBasisStableKey(lowered.addressBasis)}`,
    ]),
  };
}

export function lowerAArch64RegionsStageState(state: AArch64LoweringState): AArch64LoweringState {
  const regionRecords = state.selectionRecords.filter((record) =>
    record.explanation.some((entry) => entry.startsWith("validated-buffer:zero-copy:")),
  );
  const planned = recordAArch64StagePlanning(state, "lower-regions", "region-bases-preserved");
  return appendAArch64SelectionRecord(planned, {
    stageKey: "lower-regions",
    subjectKey: "program",
    patternId: "region.validated-payload-zero-copy",
    tier: "planning",
    factsUsed: regionRecords.flatMap((record) => record.factsUsed),
    emittedOpcodes: regionRecords.flatMap((record) => record.emittedOpcodes),
    explanation:
      regionRecords.length === 0
        ? ["lower-regions:no-validated-payload-accesses"]
        : ["lower-regions:validated-payload-zero-copy-preserved"],
  });
}

export function validateAArch64RegionLoweringState(
  state: AArch64LoweringState,
): readonly AArch64LoweringDiagnostic[] {
  return regionLoweringInputs(state).flatMap((input) => {
    const result = lowerAArch64Region(input);
    return result.kind === "ok"
      ? []
      : [
          aarch64Diagnostic({
            code: "AARCH64_REGION_CONTRACT_INVALID",
            ownerKey: `region:${String(input.regionId)}`,
            rootCauseKey: "lower-regions",
            stableDetail: result.reason,
          }),
        ];
  });
}

function regionLoweringInputs(
  state: AArch64LoweringState,
): readonly Parameters<typeof lowerAArch64Region>[0][] {
  return state.program.regions
    .entries()
    .map((regionRecord) => regionLoweringInputForRegion(state, regionRecord));
}

function regionLoweringInputForRegion(
  state: AArch64LoweringState,
  regionRecord: { readonly regionId: OptIrRegionId },
): Parameters<typeof lowerAArch64Region>[0] {
  const optimizationRegions = (
    state.program as { readonly optimizationRegions?: readonly OptIrRegion[] }
  ).optimizationRegions;
  const optimizationById = new Map(
    (optimizationRegions ?? []).map((region) => [region.regionId, region] as const),
  );
  const validatedAccessRegions = validatedBufferAccessRegions(state);
  const optimizationRegion = optimizationById.get(regionRecord.regionId);
  const memoryTypeFact = regionMemoryTypeFactFor(state, regionRecord.regionId);
  const footprint = footprintFactFor(state, regionRecord.regionId);
  const regionKind =
    regionKindForOptimizationRegion(optimizationRegion) ??
    (validatedAccessRegions.has(Number(regionRecord.regionId)) ? "validatedPayload" : undefined) ??
    regionKindForMemoryType(extensionPayload(memoryTypeFact).memoryType) ??
    "stack";
  return {
    regionId: regionRecord.regionId,
    regionKind,
    ...(regionKind === "validatedPayload"
      ? {
          backingRegion: optIrRegionIdFromPayload(
            extensionPayload(memoryTypeFact).backingRegion ??
              extensionPayload(footprint).backingRegion,
          ),
          certifiedOffset: bigintFromPayload(
            extensionPayload(memoryTypeFact).certifiedOffset ?? extensionPayload(footprint).start,
          ),
        }
      : {}),
    ...(regionKind === "deviceMmio" ||
    regionKind === "firmwareTable" ||
    regionKind === "runtimeOwned"
      ? {
          provenanceKey:
            provenanceKeyForRegion(optimizationRegion) ??
            stringFromPayload(extensionPayload(memoryTypeFact).provenanceKey),
        }
      : {}),
  };
}

export function regionAddressBasisStableKey(addressBasis: AArch64RegionAddressBasis): string {
  switch (addressBasis.kind) {
    case "frameObject":
      return `frame:${addressBasis.object}`;
    case "incomingPointer":
      return `incoming:${addressBasis.source}`;
    case "derivedRegionBase":
      return `derived:${addressBasis.backingRegion}:${addressBasis.byteOffset}`;
    case "globalSymbol":
      return `global:${addressBasis.symbol.symbol}`;
    case "deviceMmioBase":
      return `device:${addressBasis.deviceKey}:${addressBasis.base.symbol}`;
    case "firmwareTableBase":
      return `firmware:${addressBasis.tableKey}:${addressBasis.base}`;
    case "runtimeOwned":
      return `runtime:${addressBasis.ownerKey}:${addressBasis.base}`;
    case "externalPointer":
      return `external:${addressBasis.source}`;
  }
}

function validatedBufferAccessRegions(state: AArch64LoweringState): ReadonlySet<number> {
  return new Set(
    [...state.operations.values()].flatMap((operation) => {
      const access = (
        operation as {
          readonly memoryAccess?: { readonly region?: unknown; readonly validatedBuffer?: unknown };
        }
      ).memoryAccess;
      return access?.validatedBuffer !== undefined && typeof access.region === "number"
        ? [access.region]
        : [];
    }),
  );
}

function regionKindForOptimizationRegion(
  region: OptIrRegion | undefined,
): AArch64RegionKind | undefined {
  switch (region?.kind) {
    case "stackLocal":
    case "sourceAggregate":
      return "stack";
    case "packetSource":
      return "packetSource";
    case "validatedPayload":
      return "validatedPayload";
    case "constantData":
      return "constantData";
    case "globalData":
      return "globalData";
    case "imageDevice":
      return "deviceMmio";
    case "firmwareTable":
      return "firmwareTable";
    case "runtimeMemory":
      return "runtimeOwned";
    case "externalUnknown":
      return "external";
    case undefined:
      return undefined;
  }
}

function regionKindForMemoryType(memoryType: unknown): AArch64RegionKind | undefined {
  switch (memoryType) {
    case "deviceMmio":
      return "deviceMmio";
    case "firmwareTable":
      return "firmwareTable";
    case "runtimeOwned":
      return "runtimeOwned";
    case "packetSource":
      return "packetSource";
    case "validatedPayload":
      return "validatedPayload";
    case "externalConservative":
      return "external";
    case "normalCacheable":
      return "stack";
    default:
      return undefined;
  }
}

function provenanceKeyForRegion(region: OptIrRegion | undefined): string | undefined {
  if (region?.owner.kind === "target") {
    return region.owner.targetKey;
  }
  if (region?.owner.kind === "external") {
    return region.owner.symbol;
  }
  return undefined;
}

function regionMemoryTypeFactFor(
  state: AArch64LoweringState,
  regionId: OptIrRegionId,
): OptIrFactRecord | undefined {
  return state.facts.records.find(
    (record) =>
      record.extensionKey === "memory-order" &&
      record.extensionPacketKind === "region-memory-type" &&
      record.subjectKey === `region:${String(regionId)}`,
  );
}

function footprintFactFor(
  state: AArch64LoweringState,
  regionId: OptIrRegionId,
): OptIrFactRecord | undefined {
  return state.facts.records.find(
    (record) =>
      record.extensionKey === "footprint" && record.subjectKey === `region:${String(regionId)}`,
  );
}

function extensionPayload(record: OptIrFactRecord | undefined): Readonly<Record<string, unknown>> {
  return record?.extensionPayload !== undefined && typeof record.extensionPayload === "object"
    ? (record.extensionPayload as Readonly<Record<string, unknown>>)
    : {};
}

function optIrRegionIdFromPayload(value: unknown): OptIrRegionId | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? (value as OptIrRegionId)
    : undefined;
}

function bigintFromPayload(value: unknown): bigint | undefined {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isInteger(value)) return BigInt(value);
  if (typeof value === "string" && /^-?\d+$/.test(value)) return BigInt(value);
  return undefined;
}

function stringFromPayload(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}
