import type { LayoutFactKey } from "../../proof-check/model/fact-packet";
import type { MonoInstanceId } from "../../mono/ids";
import type { OptIrEffectRequirement } from "../effects";
import { optIrAliasClassId, optIrOriginId, optIrRegionId, type OptIrAliasClassId } from "../ids";
import type { OptIrOrigin } from "../provenance";
import type { OptIrRegion, OptIrRegionKind } from "../regions";

export interface OptIrByteRange {
  readonly start: bigint;
  readonly end: bigint;
}

export interface OptIrRegionDeclaration {
  readonly key: string;
  readonly layoutKey?: LayoutFactKey;
  readonly addressTaken?: boolean;
  readonly callbackVisible?: boolean;
}

export interface OptIrPacketSourceDeclaration extends OptIrRegionDeclaration {
  readonly source: string;
}

export interface OptIrValidatedPayloadDeclaration extends OptIrRegionDeclaration {
  readonly backingPacket: string;
  readonly byteRange: OptIrByteRange;
}

export interface BuildOptIrRegionsInput {
  readonly functionId?: MonoInstanceId;
  readonly stackLocals?: readonly OptIrRegionDeclaration[];
  readonly sourceAggregates?: readonly OptIrRegionDeclaration[];
  readonly packetSources?: readonly OptIrPacketSourceDeclaration[];
  readonly validatedPayloadViews?: readonly OptIrValidatedPayloadDeclaration[];
  readonly constants?: readonly OptIrRegionDeclaration[];
  readonly globals?: readonly OptIrRegionDeclaration[];
  readonly imageDevices?: readonly OptIrRegionDeclaration[];
  readonly firmwareTables?: readonly OptIrRegionDeclaration[];
  readonly runtimeMemory?: readonly OptIrRegionDeclaration[];
  readonly includeExternalUnknown?: boolean;
  readonly origin?: OptIrOrigin;
}

export interface OptIrRegionEntry {
  readonly key: string;
  readonly region: OptIrRegion;
  readonly escaped: boolean;
  readonly conservative: boolean;
}

export interface OptIrValidatedPayloadRegion extends OptIrRegionEntry {
  readonly backingPacketKey: string;
  readonly backingPacketAliasClass: OptIrAliasClassId;
  readonly byteRange: OptIrByteRange;
}

export interface OptIrRegionTable {
  readonly entries: () => readonly OptIrRegion[];
  readonly regionEntries: () => readonly OptIrRegionEntry[];
  readonly lookup: (kind: OptIrRegionKind, key: string) => OptIrRegionEntry | undefined;
  readonly validatedPayload: (key: string) => OptIrValidatedPayloadRegion | undefined;
  readonly externalUnknown: () => OptIrRegion | undefined;
}

export type OptIrCatalogTokenKind = "readVersion" | "ordered";

export interface OptIrCatalogTokenThread {
  readonly tokenKey: string;
  readonly kind?: OptIrCatalogTokenKind;
}

export interface OptIrCatalogEffectInput {
  readonly effectKey: string;
  readonly readsMemory?: boolean;
  readonly writesMemory?: boolean;
  readonly platformEffect?: "unknown" | string;
  readonly placeKeys?: readonly string[];
  readonly tokenKeys?: readonly string[];
  readonly tokenThreads?: readonly OptIrCatalogTokenThread[];
}

export interface OptIrCrossRegionObservationEdge {
  readonly source: OptIrAliasClassId;
  readonly target: OptIrAliasClassId;
  readonly effectKey: string;
}

export interface NormalizedTargetEffectRequirements {
  readonly requirements: readonly OptIrEffectRequirement[];
  readonly observationEdges: readonly OptIrCrossRegionObservationEdge[];
}

interface RegionSource {
  readonly kind: OptIrRegionKind;
  readonly declaration: OptIrRegionDeclaration;
}

const REGION_ORDER: readonly OptIrRegionKind[] = [
  "stackLocal",
  "sourceAggregate",
  "packetSource",
  "validatedPayload",
  "constantData",
  "globalData",
  "imageDevice",
  "firmwareTable",
  "runtimeMemory",
  "externalUnknown",
];

function compareKeys(left: { readonly key: string }, right: { readonly key: string }): number {
  return left.key < right.key ? -1 : left.key > right.key ? 1 : 0;
}

function defaultOrigin(): OptIrOrigin {
  return { originId: optIrOriginId(0) };
}

function ownerForKind(
  kind: OptIrRegionKind,
  key: string,
  functionId: MonoInstanceId | undefined,
): OptIrRegion["owner"] {
  if (kind === "stackLocal" || kind === "sourceAggregate" || kind === "validatedPayload") {
    return functionId === undefined ? { kind: "program" } : { kind: "function", functionId };
  }
  if (kind === "imageDevice" || kind === "firmwareTable") {
    return { kind: "target", targetKey: key };
  }
  if (kind === "externalUnknown") {
    return { kind: "external", symbol: key };
  }
  return { kind: "program" };
}

function lifetimeForKind(kind: OptIrRegionKind): OptIrRegion["lifetime"] {
  if (kind === "stackLocal" || kind === "sourceAggregate" || kind === "validatedPayload") {
    return "activation";
  }
  if (kind === "constantData") {
    return "constant";
  }
  if (kind === "externalUnknown" || kind === "imageDevice" || kind === "firmwareTable") {
    return "external";
  }
  return "program";
}

function effectsForKind(kind: OptIrRegionKind, escaped: boolean): OptIrRegion["effects"] {
  if (escaped) {
    return { mutability: "mutable", ordering: "orderedEffectToken" };
  }
  if (kind === "constantData" || kind === "packetSource" || kind === "validatedPayload") {
    return { mutability: "readOnly", ordering: "readOnlyRegionVersion" };
  }
  if (kind === "externalUnknown" || kind === "imageDevice" || kind === "firmwareTable") {
    return { mutability: "mutable", ordering: "orderedEffectToken" };
  }
  return { mutability: "mutable", ordering: "none" };
}

function makeRegionEntry(
  source: RegionSource,
  ordinal: number,
  input: BuildOptIrRegionsInput,
  forcedAliasClass?: OptIrAliasClassId,
): OptIrRegionEntry {
  const escaped =
    source.declaration.addressTaken === true || source.declaration.callbackVisible === true;
  const conservative = escaped;
  const aliasClass = forcedAliasClass ?? optIrAliasClassId(ordinal + 1);
  return {
    key: source.declaration.key,
    escaped,
    conservative,
    region: {
      regionId: optIrRegionId(ordinal + 1),
      kind: source.kind,
      owner: ownerForKind(source.kind, source.declaration.key, input.functionId),
      lifetime: lifetimeForKind(source.kind),
      aliasClass,
      layoutKey: source.declaration.layoutKey,
      volatility:
        source.kind === "imageDevice" ||
        source.kind === "firmwareTable" ||
        source.kind === "externalUnknown"
          ? "volatile"
          : "nonVolatile",
      effects: effectsForKind(source.kind, escaped),
      origin: input.origin ?? defaultOrigin(),
    },
  };
}

function addDeclarations(
  sources: RegionSource[],
  kind: OptIrRegionKind,
  declarations: readonly OptIrRegionDeclaration[] | undefined,
): void {
  for (const declaration of [...(declarations ?? [])].sort(compareKeys)) {
    sources.push({ kind, declaration });
  }
}

function tableKey(kind: OptIrRegionKind, key: string): string {
  return `${kind}:${key}`;
}

function placeKeyToLookup(
  placeKey: string,
): { readonly kind: OptIrRegionKind; readonly key: string } | undefined {
  const separator = placeKey.indexOf(":");
  if (separator < 1) {
    return undefined;
  }
  const kind = placeKey.slice(0, separator) as OptIrRegionKind;
  const key = placeKey.slice(separator + 1);
  return REGION_ORDER.includes(kind) && key.length > 0 ? { kind, key } : undefined;
}

export function buildOptIrRegionsForTest(input: BuildOptIrRegionsInput = {}): OptIrRegionTable {
  const sources: RegionSource[] = [];
  addDeclarations(sources, "stackLocal", input.stackLocals);
  addDeclarations(sources, "sourceAggregate", input.sourceAggregates);
  addDeclarations(sources, "packetSource", input.packetSources);
  addDeclarations(sources, "validatedPayload", input.validatedPayloadViews);
  addDeclarations(sources, "constantData", input.constants);
  addDeclarations(sources, "globalData", input.globals);
  addDeclarations(sources, "imageDevice", input.imageDevices);
  addDeclarations(sources, "firmwareTable", input.firmwareTables);
  addDeclarations(sources, "runtimeMemory", input.runtimeMemory);
  const needsExternalUnknown =
    input.includeExternalUnknown === true ||
    sources.some(
      (source) =>
        source.declaration.callbackVisible === true || source.declaration.addressTaken === true,
    );
  const callbackVisibleKeys = new Set(
    sources
      .filter((source) => source.declaration.callbackVisible === true)
      .map((source) => tableKey(source.kind, source.declaration.key)),
  );
  if (needsExternalUnknown) {
    sources.push({ kind: "externalUnknown", declaration: { key: "external:unknown" } });
  }

  const entries: OptIrRegionEntry[] = [];
  const byKey = new Map<string, OptIrRegionEntry>();

  for (const source of sources) {
    const external = byKey.get(tableKey("externalUnknown", "external:unknown"));
    const forcedAliasClass =
      source.declaration.callbackVisible === true && external !== undefined
        ? external.region.aliasClass
        : undefined;
    const entry = makeRegionEntry(source, entries.length, input, forcedAliasClass);
    entries.push(entry);
    byKey.set(tableKey(source.kind, source.declaration.key), entry);
  }

  const externalEntry = byKey.get(tableKey("externalUnknown", "external:unknown"));
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    if (entry === undefined || !callbackVisibleKeys.has(tableKey(entry.region.kind, entry.key))) {
      continue;
    }
    if (
      externalEntry === undefined ||
      entry.region.aliasClass === externalEntry.region.aliasClass
    ) {
      continue;
    }
    const replacement: OptIrRegionEntry = {
      ...entry,
      region: { ...entry.region, aliasClass: externalEntry.region.aliasClass },
    };
    entries[index] = replacement;
    byKey.set(tableKey(replacement.region.kind, replacement.key), replacement);
  }

  const validatedPayloads = new Map<string, OptIrValidatedPayloadRegion>();
  for (const declaration of input.validatedPayloadViews ?? []) {
    const payloadEntry = byKey.get(tableKey("validatedPayload", declaration.key));
    const packetEntry = byKey.get(tableKey("packetSource", declaration.backingPacket));
    if (payloadEntry === undefined || packetEntry === undefined) {
      continue;
    }
    validatedPayloads.set(declaration.key, {
      ...payloadEntry,
      backingPacketKey: declaration.backingPacket,
      backingPacketAliasClass: packetEntry.region.aliasClass,
      byteRange: declaration.byteRange,
    });
  }

  return {
    entries: () => entries.map((entry) => entry.region),
    regionEntries: () => entries,
    lookup: (kind, key) => byKey.get(tableKey(kind, key)),
    validatedPayload: (key) => validatedPayloads.get(key),
    externalUnknown: () => externalEntry?.region,
  };
}

function targetRegionsForEffect(
  regions: OptIrRegionTable,
  catalogEffect: OptIrCatalogEffectInput,
): readonly OptIrRegion[] {
  const explicitRegions = (catalogEffect.placeKeys ?? [])
    .map(placeKeyToLookup)
    .filter(
      (place): place is { readonly kind: OptIrRegionKind; readonly key: string } =>
        place !== undefined,
    )
    .map((place) => regions.lookup(place.kind, place.key)?.region)
    .filter((region): region is OptIrRegion => region !== undefined);

  if (explicitRegions.length > 0) {
    return explicitRegions;
  }

  const unknownEffect =
    catalogEffect.platformEffect === "unknown" ||
    (catalogEffect.readsMemory === true && catalogEffect.writesMemory === true);
  const external = regions.externalUnknown();
  return unknownEffect && external !== undefined ? [external] : [];
}

function tokenRequirement(tokenKey: string): OptIrEffectRequirement {
  return tokenKey.includes("version")
    ? { mode: "readVersionToken", tokenKey }
    : { mode: "orderedEffectToken", tokenKey };
}

function addRequirement(
  requirements: OptIrEffectRequirement[],
  requirement: OptIrEffectRequirement,
): void {
  if (requirements.some((existing) => JSON.stringify(existing) === JSON.stringify(requirement))) {
    return;
  }
  requirements.push(requirement);
}

function observationEdges(
  effectKey: string,
  regions: readonly OptIrRegion[],
): readonly OptIrCrossRegionObservationEdge[] {
  const edges: OptIrCrossRegionObservationEdge[] = [];
  for (let fromIndex = 0; fromIndex < regions.length; fromIndex += 1) {
    for (let toIndex = fromIndex + 1; toIndex < regions.length; toIndex += 1) {
      const source = regions[fromIndex];
      const target = regions[toIndex];
      if (source === undefined || target === undefined || source.aliasClass === target.aliasClass) {
        continue;
      }
      edges.push({ source: source.aliasClass, target: target.aliasClass, effectKey });
    }
  }
  return edges;
}

export function normalizeTargetEffectRequirementsForTest(input: {
  readonly regions: OptIrRegionTable;
  readonly catalogEffect: OptIrCatalogEffectInput;
}): NormalizedTargetEffectRequirements {
  const affectedRegions = targetRegionsForEffect(input.regions, input.catalogEffect);
  const requirements: OptIrEffectRequirement[] = [];

  for (const region of affectedRegions) {
    if (input.catalogEffect.readsMemory === true) {
      addRequirement(requirements, { mode: "observe", region: region.aliasClass });
    }
    if (input.catalogEffect.writesMemory === true) {
      addRequirement(requirements, { mode: "mutate", region: region.aliasClass });
    }
    if (
      region.effects.ordering === "orderedEffectToken" ||
      input.catalogEffect.writesMemory === true
    ) {
      addRequirement(requirements, {
        mode: "orderedEffectToken",
        tokenKey:
          region.kind === "externalUnknown"
            ? "external:unknown"
            : `region:${region.kind}:${region.owner.kind === "target" ? region.owner.targetKey : ""}`,
      });
    }
  }

  for (const tokenKey of input.catalogEffect.tokenKeys ?? []) {
    addRequirement(requirements, tokenRequirement(tokenKey));
  }
  for (const tokenThread of input.catalogEffect.tokenThreads ?? []) {
    addRequirement(
      requirements,
      tokenThread.kind === "readVersion"
        ? { mode: "readVersionToken", tokenKey: tokenThread.tokenKey }
        : { mode: "orderedEffectToken", tokenKey: tokenThread.tokenKey },
    );
  }

  return {
    requirements,
    observationEdges: observationEdges(input.catalogEffect.effectKey, affectedRegions),
  };
}
