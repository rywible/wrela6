import type { LayoutFactKey } from "../proof-check/model/fact-packet";
import type { MonoInstanceId } from "../mono/ids";
import type { OptIrAliasClassId, OptIrRegionId } from "./ids";
import type { OptIrRegionEffectPolicy } from "./effects";
import type { OptIrOrigin } from "./provenance";

export const OPT_IR_REGION_KINDS = [
  "stackLocal",
  "sourceAggregate",
  "packetSource",
  "validatedPayload",
  "imageDevice",
  "firmwareTable",
  "runtimeMemory",
  "constantData",
  "globalData",
  "externalUnknown",
] as const;

export type OptIrRegionKind = (typeof OPT_IR_REGION_KINDS)[number];

export type OptIrRegionOwner =
  | { readonly kind: "program" }
  | { readonly kind: "function"; readonly functionId: MonoInstanceId }
  | { readonly kind: "target"; readonly targetKey: string }
  | { readonly kind: "external"; readonly symbol: string };

export type OptIrRegionLifetime = "activation" | "program" | "external" | "constant";
export type OptIrRegionVolatility = "nonVolatile" | "volatile";

export interface OptIrRegion {
  readonly regionId: OptIrRegionId;
  readonly kind: OptIrRegionKind;
  readonly owner: OptIrRegionOwner;
  readonly lifetime: OptIrRegionLifetime;
  readonly aliasClass: OptIrAliasClassId;
  readonly layoutKey?: LayoutFactKey;
  readonly volatility: OptIrRegionVolatility;
  readonly effects: OptIrRegionEffectPolicy;
  readonly origin: OptIrOrigin;
}
