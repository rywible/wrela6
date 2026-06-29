import { layoutFactKey, type LayoutFactKey } from "../../proof-check/model/fact-packet";
import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirFactId, ProofMirPlaceId, ProofMirValueId } from "../../proof-mir/ids";
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
  readonly valueType: OptIrType;
  readonly byteWidth: number;
  readonly targetEndian: "little" | "big";
  readonly resultId: OptIrValueId;
  readonly operationId: ReturnType<typeof optIrOperationId>;
  readonly originId: OptIrOriginId;
  readonly authorityIndex: ReadonlyMap<string, OptIrValidatedBufferFactForLowering>;
  readonly regions: OptIrRegion[];
  readonly regionsByKey: Map<string, OptIrRegion>;
  readonly provenance: {
    readonly get: (originId: OptIrOriginId) => OptIrRegion["origin"] | undefined;
  };
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

  const region = validatedPayloadRegionForRead({
    function_: input.function_,
    read: input.read,
    layoutKey: input.layoutKey,
    originId: input.originId,
    regions: input.regions,
    regionsByKey: input.regionsByKey,
    provenance: input.provenance,
  });

  const access = lowerValidatedBufferRead({
    regionKind: "validatedPayload",
    region: region.regionId,
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
    region: region.regionId,
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

function validatedPayloadRegionForRead(input: {
  readonly function_: ProofMirFunction;
  readonly read: {
    readonly validatedBufferInstanceId: MonoInstanceId;
    readonly fieldId: unknown;
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
    String(input.function_.functionInstanceId),
    String(input.read.validatedBufferInstanceId),
    String(input.read.fieldId),
  ].join("\u001f");
  const existing = input.regionsByKey.get(regionKey);
  if (existing !== undefined) {
    return existing;
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
  return region;
}

export function compareRegions(left: OptIrRegion, right: OptIrRegion): number {
  return left.regionId - right.regionId;
}

export type { OptIrOperationConstructionResult };
