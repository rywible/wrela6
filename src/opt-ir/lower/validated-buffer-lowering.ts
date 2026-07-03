import type { LayoutFactProgram, LayoutTerm } from "../../layout/layout-program";
import { layoutFactKey, type LayoutFactKey } from "../../proof-check/model/fact-packet";
import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirFactId, ProofMirPlaceId, ProofMirValueId } from "../../proof-mir/ids";
import type { ProofMirLayoutTermChild } from "../../proof-mir/model/layout-bindings";
import type { ProofMirFunction } from "../../proof-mir/model/graph";
import {
  optIrAliasClassId,
  optIrOperationId,
  optIrRegionId,
  type OptIrFactId,
  type OptIrOriginId,
  type OptIrPathCertificateId,
  type OptIrValueId,
} from "../ids";
import { regionMemoryTypeFactRecord } from "../facts/memory-order-facts";
import type { OptIrFactRecord } from "../facts/fact-index";
import {
  optIrMemoryLoadOperation,
  type OptIrEndian,
  type OptIrOperation,
  type OptIrOperationConstructionResult,
} from "../operations";
import type { OptIrRegion } from "../regions";
import type { OptIrType } from "../types";
import { lowerValidatedBufferRead } from "./validated-buffer-reads";

export interface OptIrValidatedBufferFactForLowering {
  readonly sourcePlace: ProofMirPlaceId;
  readonly layoutKey: LayoutFactKey;
  readonly factId: OptIrFactId;
  readonly pathCertificateId?: OptIrPathCertificateId;
}

export function validatedBufferFactIndexForLowering(
  facts: readonly OptIrValidatedBufferFactForLowering[],
): ReadonlyMap<string, OptIrValidatedBufferFactForLowering> {
  const index = new Map<string, OptIrValidatedBufferFactForLowering>();
  for (const fact of facts) {
    const key = validatedBufferAuthorityKey(fact.sourcePlace, fact.layoutKey);
    const existing = index.get(key);
    if (existing === undefined || fact.factId < existing.factId) {
      index.set(key, fact);
    }
  }
  return index;
}

export function validatedBufferLayoutKey(input: {
  readonly instanceId: MonoInstanceId;
}): LayoutFactKey {
  return layoutFactKey(String(input.instanceId));
}

export interface LowerValidatedBufferFieldReadInput {
  readonly function_: ProofMirFunction;
  readonly read: {
    readonly sourcePlace: ProofMirPlaceId;
    readonly validatedBufferInstanceId: MonoInstanceId;
    readonly fieldId: unknown;
    readonly result: ProofMirValueId;
    readonly readRequires: readonly ProofMirFactId[];
  };
  readonly layoutKey: LayoutFactKey;
  readonly sourceBaseValueId?: OptIrValueId;
  readonly valueType: OptIrType;
  readonly byteWidth: number;
  readonly targetEndian: "little" | "big";
  readonly layout: LayoutFactProgram;
  readonly resultId: OptIrValueId;
  readonly operationId: ReturnType<typeof optIrOperationId>;
  readonly originId: OptIrOriginId;
  readonly authorityIndex: ReadonlyMap<string, OptIrValidatedBufferFactForLowering>;
  readonly regions: OptIrRegion[];
  readonly regionsByKey: Map<string, OptIrRegion>;
  readonly generatedFacts: OptIrGeneratedFactSink;
  readonly provenance: {
    readonly get: (originId: OptIrOriginId) => OptIrRegion["origin"] | undefined;
  };
}

export interface OptIrGeneratedFactSink {
  readonly nextFactId: () => OptIrFactId;
  readonly push: (record: OptIrFactRecord) => void;
}

export function lowerValidatedBufferFieldRead(
  input: LowerValidatedBufferFieldReadInput,
):
  | { readonly kind: "ok"; readonly operation: OptIrOperation }
  | { readonly kind: "error"; readonly code: "missing-authority" | "invalid-load" } {
  const authority = input.authorityIndex.get(
    validatedBufferAuthorityKey(input.read.sourcePlace, input.layoutKey),
  );
  if (authority === undefined) {
    return { kind: "error", code: "missing-authority" };
  }

  const region = backedValidatedPayloadRegionForRead({
    function_: input.function_,
    read: input.read,
    layoutKey: input.layoutKey,
    certifiedOffset: certifiedOffsetForValidatedBufferRead({
      layout: input.layout,
      read: input.read,
    }),
    originId: input.originId,
    regions: input.regions,
    regionsByKey: input.regionsByKey,
    provenance: input.provenance,
  });
  if (region.createdPayload) {
    input.generatedFacts.push(
      regionMemoryTypeFactRecord({
        factId: input.generatedFacts.nextFactId(),
        regionId: region.payloadRegion.regionId,
        memoryType: "validatedPayload",
        backingRegion: region.backingRegion.regionId,
        certifiedOffset: region.certifiedOffset,
        provenanceKey: validatedPayloadProvenanceKey({
          function_: input.function_,
          read: input.read,
          layoutKey: input.layoutKey,
        }),
        authority: "proof:validated-buffer-region",
      }),
    );
  }

  const access = lowerValidatedBufferRead({
    regionKind: "validatedPayload",
    region: region.payloadRegion.regionId,
    fieldName: String(input.read.fieldId),
    offsetBytes: 0n,
    widthBytes: BigInt(input.byteWidth),
    wireEndian: input.targetEndian,
    alignment: 1n,
    valueType: input.valueType,
    volatility: "nonVolatile",
    layoutPath: [String(input.read.validatedBufferInstanceId), String(input.read.fieldId)],
    boundsAuthority: { kind: "certifiedFact", factId: authority.factId },
    readRequires: input.read.readRequires.map(String),
    pathCertificates:
      authority.pathCertificateId === undefined ? [] : [authority.pathCertificateId],
    originId: input.originId,
  });

  const result = optIrMemoryLoadOperation({
    operationId: input.operationId,
    resultId: input.resultId,
    ...(input.sourceBaseValueId === undefined ? {} : { baseValueId: input.sourceBaseValueId }),
    region: region.payloadRegion.regionId,
    byteOffset: 0n,
    byteWidth: input.byteWidth,
    alignment: Number(access.alignment),
    valueType: input.valueType,
    endian: optIrEndianForValidatedBufferAccess(access.endian),
    volatility: "nonVolatile",
    layoutPath: input.layoutKey,
    boundsAuthority: access.boundsAuthority,
    validatedBuffer: {
      fieldName: access.metadata.fieldName,
      layoutPath: access.layoutPath,
      readRequires: access.metadata.readRequires.map(String),
      pathCertificates: access.metadata.pathCertificates,
    },
    originId: input.originId,
  });

  if (result.kind === "error") {
    return { kind: "error", code: "invalid-load" };
  }
  return { kind: "ok", operation: result.operation };
}

function validatedBufferAuthorityKey(
  sourcePlace: ProofMirPlaceId,
  layoutKey: LayoutFactKey,
): string {
  return `${String(sourcePlace)}:${String(layoutKey)}`;
}

function optIrEndianForValidatedBufferAccess(endian: "target" | "little" | "big"): OptIrEndian {
  return endian === "target" ? "native" : endian;
}

function backedValidatedPayloadRegionForRead(input: {
  readonly function_: ProofMirFunction;
  readonly read: {
    readonly sourcePlace: ProofMirPlaceId;
    readonly validatedBufferInstanceId: MonoInstanceId;
    readonly fieldId: unknown;
  };
  readonly layoutKey: LayoutFactKey;
  readonly certifiedOffset: bigint;
  readonly originId: OptIrOriginId;
  readonly regions: OptIrRegion[];
  readonly regionsByKey: Map<string, OptIrRegion>;
  readonly provenance: {
    readonly get: (originId: OptIrOriginId) => OptIrRegion["origin"] | undefined;
  };
}): {
  readonly payloadRegion: OptIrRegion;
  readonly backingRegion: OptIrRegion;
  readonly certifiedOffset: bigint;
  readonly createdPayload: boolean;
} {
  const backingRegion = packetSourceRegionForRead(input);
  const regionKey = [
    "validatedPayload",
    String(input.function_.functionInstanceId),
    String(input.read.sourcePlace),
    String(input.read.validatedBufferInstanceId),
    String(input.read.fieldId),
  ].join("\u001f");
  const existing = input.regionsByKey.get(regionKey);
  if (existing !== undefined) {
    return {
      payloadRegion: existing,
      backingRegion,
      certifiedOffset: input.certifiedOffset,
      createdPayload: false,
    };
  }

  const ordinal = input.regions.length + 1;
  const region: OptIrRegion = {
    regionId: optIrRegionId(ordinal),
    kind: "validatedPayload",
    owner: { kind: "function", functionId: input.function_.functionInstanceId },
    lifetime: "activation",
    aliasClass: optIrAliasClassId(ordinal),
    layoutKey: input.layoutKey,
    volatility: "nonVolatile",
    effects: { mutability: "readOnly", ordering: "readOnlyRegionVersion" },
    origin: input.provenance.get(input.originId) ?? { originId: input.originId },
  };
  input.regions.push(region);
  input.regionsByKey.set(regionKey, region);
  return {
    payloadRegion: region,
    backingRegion,
    certifiedOffset: input.certifiedOffset,
    createdPayload: true,
  };
}

function packetSourceRegionForRead(input: {
  readonly function_: ProofMirFunction;
  readonly read: {
    readonly sourcePlace: ProofMirPlaceId;
  };
  readonly layoutKey: LayoutFactKey;
  readonly originId: OptIrOriginId;
  readonly regions: OptIrRegion[];
  readonly regionsByKey: Map<string, OptIrRegion>;
  readonly provenance: {
    readonly get: (originId: OptIrOriginId) => OptIrRegion["origin"] | undefined;
  };
}): OptIrRegion {
  const regionKey = [
    "packetSource",
    String(input.function_.functionInstanceId),
    String(input.read.sourcePlace),
  ].join("\u001f");
  const existing = input.regionsByKey.get(regionKey);
  if (existing !== undefined) {
    return existing;
  }

  const ordinal = input.regions.length + 1;
  const region: OptIrRegion = {
    regionId: optIrRegionId(ordinal),
    kind: "packetSource",
    owner: { kind: "function", functionId: input.function_.functionInstanceId },
    lifetime: "activation",
    aliasClass: optIrAliasClassId(ordinal),
    layoutKey: input.layoutKey,
    volatility: "nonVolatile",
    effects: { mutability: "readOnly", ordering: "readOnlyRegionVersion" },
    origin: input.provenance.get(input.originId) ?? { originId: input.originId },
  };
  input.regions.push(region);
  input.regionsByKey.set(regionKey, region);
  return region;
}

function certifiedOffsetForValidatedBufferRead(input: {
  readonly layout: LayoutFactProgram;
  readonly read: {
    readonly validatedBufferInstanceId: MonoInstanceId;
    readonly fieldId: unknown;
    readonly offsetTerm?: {
      readonly path: {
        readonly root: {
          readonly kind: string;
          readonly instanceId?: MonoInstanceId;
          readonly fieldId?: unknown;
          readonly slot?: string;
        };
        readonly childPath: readonly ProofMirLayoutTermChild[];
      };
      readonly unit: string;
    };
  };
}): bigint {
  const term = layoutTermForValidatedBufferRead(input);
  return term?.kind === "constant" && term.unit === "byteOffset" && term.value >= 0n
    ? term.value
    : 0n;
}

function layoutTermForValidatedBufferRead(input: {
  readonly layout: LayoutFactProgram;
  readonly read: {
    readonly validatedBufferInstanceId: MonoInstanceId;
    readonly fieldId: unknown;
    readonly offsetTerm?: {
      readonly path: {
        readonly root: {
          readonly kind: string;
          readonly instanceId?: MonoInstanceId;
          readonly fieldId?: unknown;
          readonly slot?: string;
        };
        readonly childPath: readonly ProofMirLayoutTermChild[];
      };
      readonly unit: string;
    };
  };
}): LayoutTerm | undefined {
  const offsetTerm = input.read.offsetTerm;
  if (offsetTerm === undefined) {
    return undefined;
  }
  const root = offsetTerm.path.root;
  if (
    root?.kind !== "validatedBufferFieldTerm" ||
    root.slot !== "offset" ||
    root.instanceId !== input.read.validatedBufferInstanceId ||
    root.fieldId !== input.read.fieldId
  ) {
    return undefined;
  }

  const buffer = input.layout.validatedBuffers?.get(input.read.validatedBufferInstanceId);
  const field = buffer?.layoutFields.find((candidate) => candidate.fieldId === input.read.fieldId);
  if (field === undefined) {
    return undefined;
  }

  return offsetTerm.path.childPath.reduce<LayoutTerm | undefined>(
    (term, child) => layoutTermChild(term, child),
    field.offset,
  );
}

function layoutTermChild(
  term: LayoutTerm | undefined,
  child: ProofMirLayoutTermChild,
): LayoutTerm | undefined {
  if (term?.kind !== "add" && term?.kind !== "subtract" && term?.kind !== "multiply") {
    return undefined;
  }
  return child === "left" ? term.left : term.right;
}

function validatedPayloadProvenanceKey(input: {
  readonly function_: ProofMirFunction;
  readonly read: {
    readonly sourcePlace: ProofMirPlaceId;
    readonly validatedBufferInstanceId: MonoInstanceId;
    readonly fieldId: unknown;
  };
  readonly layoutKey: LayoutFactKey;
}): string {
  return [
    "validated-buffer",
    String(input.function_.functionInstanceId),
    String(input.read.sourcePlace),
    String(input.read.validatedBufferInstanceId),
    String(input.read.fieldId),
    String(input.layoutKey),
  ].join(":");
}

export function compareRegions(left: OptIrRegion, right: OptIrRegion): number {
  return left.regionId - right.regionId;
}

export type { OptIrOperationConstructionResult };
