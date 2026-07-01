import type { OptIrFactId, OptIrRegionId } from "../ids";
import { createOptIrFactRecordRegistry, optIrExtensionFactRecord } from "./fact-extension-registry";
import type { OptIrFactRecord } from "./fact-index";

export type OptIrFootprintAccess = "read" | "write" | "readWrite";

const FOOTPRINT_FACT_REGISTRY = createOptIrFactRecordRegistry({
  extensionKey: "footprint",
  packetKinds: ["footprint"],
  preservationRules: ["preserve-through-address-stable-clone"],
  invalidationRules: ["invalidate-on-memory-rewrite"],
  upstreamVerifierKey: "footprint-facts",
  negativeFixtures: ["invalid-range"],
});

export interface OptIrFootprintFactInput {
  readonly factId: OptIrFactId;
  readonly regionId: OptIrRegionId;
  readonly start: bigint;
  readonly endExclusive: bigint;
  readonly access: OptIrFootprintAccess;
  readonly alignment?: number;
  readonly mayTrapContained?: boolean;
  readonly pathCertificate?: string;
  readonly dereferenceable?: boolean;
  readonly prefetchable?: boolean;
  readonly authority?: string;
}

export function footprintFactRecord(input: OptIrFootprintFactInput): OptIrFactRecord {
  if (input.endExclusive <= input.start) {
    throw new RangeError("footprint endExclusive must be greater than start.");
  }
  if (
    input.alignment !== undefined &&
    (!Number.isInteger(input.alignment) || input.alignment <= 0)
  ) {
    throw new RangeError("footprint alignment must be a positive integer.");
  }
  return optIrExtensionFactRecord({
    registry: FOOTPRINT_FACT_REGISTRY,
    factId: input.factId,
    extensionKey: "footprint",
    packetKind: "footprint",
    subject: { kind: "optIrRegion", regionId: input.regionId },
    payload: {
      access: input.access,
      ...(input.alignment === undefined ? {} : { alignment: input.alignment }),
      dereferenceable: input.dereferenceable ?? true,
      endExclusive: input.endExclusive.toString(),
      mayTrapContained: input.mayTrapContained ?? true,
      ...(input.pathCertificate === undefined ? {} : { pathCertificate: input.pathCertificate }),
      prefetchable: input.prefetchable ?? false,
      region: input.regionId,
      start: input.start.toString(),
    },
    authority: requireAuthority(input.authority ?? "proof:footprint", "footprint"),
  });
}

export function prefetchableFootprintFactRecord(
  input: Omit<OptIrFootprintFactInput, "prefetchable" | "dereferenceable">,
): OptIrFactRecord {
  return footprintFactRecord({ ...input, dereferenceable: false, prefetchable: true });
}

function requireAuthority(authority: string, family: string): string {
  if (authority.length === 0) {
    throw new RangeError(`${family} facts require non-empty authority.`);
  }
  return authority;
}
