import type { OptIrAliasClassId } from "./ids";

export const OPT_IR_EFFECT_REQUIREMENT_MODES = [
  "observe",
  "mutate",
  "advancePrivateState",
  "terminal",
  "readVersionToken",
  "orderedEffectToken",
] as const;

export type OptIrEffectRequirementMode = (typeof OPT_IR_EFFECT_REQUIREMENT_MODES)[number];

export type OptIrEffectRequirement =
  | {
      readonly mode: "observe";
      readonly region: OptIrAliasClassId;
    }
  | {
      readonly mode: "mutate";
      readonly region: OptIrAliasClassId;
    }
  | {
      readonly mode: "advancePrivateState";
      readonly stateKey: string;
    }
  | {
      readonly mode: "terminal";
      readonly terminalKey: string;
    }
  | {
      readonly mode: "readVersionToken";
      readonly tokenKey: string;
    }
  | {
      readonly mode: "orderedEffectToken";
      readonly tokenKey: string;
    };

export type OptIrRegionMutability = "readOnly" | "mutable";
export type OptIrRegionEffectOrdering = "none" | "readOnlyRegionVersion" | "orderedEffectToken";

export interface OptIrRegionEffectPolicy {
  readonly mutability: OptIrRegionMutability;
  readonly ordering: OptIrRegionEffectOrdering;
}
