import type { OptIrCallTarget } from "../../../src/opt-ir/calls";
import type { OptIrEffectRequirement } from "../../../src/opt-ir/effects";
import { optIrAliasClassId, optIrOriginId, optIrRegionId } from "../../../src/opt-ir/ids";
import type { OptIrLayoutAccess } from "../../../src/opt-ir/layout-access";
import type { OptIrOrigin } from "../../../src/opt-ir/provenance";
import type { OptIrRegion, OptIrRegionKind } from "../../../src/opt-ir/regions";

export function optIrRegionForTest(
  input: {
    readonly kind: OptIrRegionKind | string;
  } & Partial<OptIrRegion>,
): OptIrRegion {
  return {
    kind: input.kind as OptIrRegionKind,
    owner: input.owner ?? { kind: "program" },
    lifetime: input.lifetime ?? "program",
    aliasClass: input.aliasClass ?? optIrAliasClassId(0),
    layoutKey: input.layoutKey,
    volatility: input.volatility ?? "nonVolatile",
    effects: input.effects ?? { mutability: "readOnly", ordering: "none" },
    origin: input.origin ?? optIrOriginForTest({ originId: optIrOriginId(0) }),
    regionId: input.regionId ?? optIrRegionId(0),
  };
}

export function optIrEffectRequirementForTest(
  input: OptIrEffectRequirement,
): OptIrEffectRequirement {
  return input;
}

export function optIrOriginForTest(input: OptIrOrigin): OptIrOrigin {
  return input;
}

export function optIrCallTargetForTest(input: OptIrCallTarget): OptIrCallTarget {
  return input;
}

export function optIrLayoutAccessForTest(input: OptIrLayoutAccess): OptIrLayoutAccess {
  return input;
}
