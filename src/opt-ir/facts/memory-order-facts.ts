import type { OptIrFactId, OptIrOperationId, OptIrRegionId } from "../ids";
import { createOptIrFactRecordRegistry, optIrExtensionFactRecord } from "./fact-extension-registry";
import type { OptIrFactRecord } from "./fact-index";

export type OptIrMemoryOrder =
  | "relaxed"
  | "acquire"
  | "release"
  | "acquireRelease"
  | "sequentiallyConsistent"
  | "deviceOrdered"
  | "compilerOnlyOrdered";
export type OptIrMemoryAccessKind = "load" | "store" | "readModifyWrite" | "fence";
export type OptIrRegionMemoryType =
  | "normalCacheable"
  | "deviceMmio"
  | "firmwareTable"
  | "runtimeOwned"
  | "externalConservative"
  | "packetSource"
  | "validatedPayload";
export type OptIrBarrierDomain = "innerShareable" | "outerShareable" | "nonShareable" | "system";
export type OptIrPublicationShape =
  | "descriptorWrite"
  | "virtioAvailIndexPublication"
  | "usedRingObservation"
  | "mmioNotification"
  | "interruptStatusRead"
  | "firmwareCallBoundary"
  | "ordinarySynchronization"
  | "ringDoorbellPublication";

const MEMORY_ORDER_FACT_REGISTRY = createOptIrFactRecordRegistry({
  extensionKey: "memory-order",
  packetKinds: ["memory-order", "region-memory-type", "barrier-domain"],
  preservationRules: ["preserve-through-effect-stable-clone"],
  invalidationRules: ["invalidate-on-effect-rewrite"],
  upstreamVerifierKey: "memory-order-facts",
  negativeFixtures: ["missing-authority"],
});

export interface OptIrMemoryOrderFactInput {
  readonly factId: OptIrFactId;
  readonly operationId: OptIrOperationId;
  readonly order: OptIrMemoryOrder;
  readonly accessKind: OptIrMemoryAccessKind;
  readonly publicationShape?: OptIrPublicationShape;
  readonly authority?: string;
}

export function memoryOrderFactRecord(input: OptIrMemoryOrderFactInput): OptIrFactRecord {
  if (input.order === "acquire" && input.accessKind === "store") {
    throw new RangeError("memory-order acquire facts require a load or read-modify-write access.");
  }
  if (input.order === "release" && input.accessKind === "load") {
    throw new RangeError("memory-order release facts require a store or read-modify-write access.");
  }
  if (input.publicationShape !== undefined && input.publicationShape.length === 0) {
    throw new RangeError("memory-order publication shape must be non-empty.");
  }
  return optIrExtensionFactRecord({
    registry: MEMORY_ORDER_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "memory-order",
    packetKind: "memory-order",
    subject: { kind: "operation", operationId: input.operationId },
    payload: {
      accessKind: input.accessKind,
      order: input.order,
      ...(input.publicationShape === undefined ? {} : { publicationShape: input.publicationShape }),
    },
    authority: requireAuthority(input.authority ?? "proof:memory-order", "memory-order"),
  });
}

export interface OptIrRegionMemoryTypeFactInput {
  readonly factId: OptIrFactId;
  readonly regionId: OptIrRegionId;
  readonly memoryType: OptIrRegionMemoryType;
  readonly backingRegion?: OptIrRegionId;
  readonly certifiedOffset?: bigint;
  readonly provenanceKey?: string;
  readonly authority?: string;
}

export function regionMemoryTypeFactRecord(input: OptIrRegionMemoryTypeFactInput): OptIrFactRecord {
  if (input.provenanceKey !== undefined && input.provenanceKey.length === 0) {
    throw new RangeError("region memory-type provenance key must be non-empty.");
  }
  return optIrExtensionFactRecord({
    registry: MEMORY_ORDER_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "memory-order",
    packetKind: "region-memory-type",
    subject: { kind: "optIrRegion", regionId: input.regionId },
    payload: {
      memoryType: input.memoryType,
      ...(input.backingRegion === undefined ? {} : { backingRegion: input.backingRegion }),
      ...(input.certifiedOffset === undefined ? {} : { certifiedOffset: input.certifiedOffset }),
      ...(input.provenanceKey === undefined ? {} : { provenanceKey: input.provenanceKey }),
    },
    authority: requireAuthority(input.authority ?? "proof:memory-order", "memory-order"),
  });
}

export interface OptIrBarrierDomainFactInput {
  readonly factId: OptIrFactId;
  readonly operationId: OptIrOperationId;
  readonly domain: OptIrBarrierDomain;
  readonly authority?: string;
}

export function barrierDomainFactRecord(input: OptIrBarrierDomainFactInput): OptIrFactRecord {
  return optIrExtensionFactRecord({
    registry: MEMORY_ORDER_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "memory-order",
    packetKind: "barrier-domain",
    subject: { kind: "operation", operationId: input.operationId },
    payload: { domain: input.domain },
    authority: requireAuthority(input.authority ?? "proof:memory-order", "memory-order"),
  });
}

function requireAuthority(authority: string, family: string): string {
  if (authority.length === 0) {
    throw new RangeError(`${family} facts require non-empty authority.`);
  }
  return authority;
}
