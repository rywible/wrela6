import type { MonoInstanceId } from "../mono/ids";

export const OPT_IR_CALL_TARGET_KINDS = [
  "source",
  "runtime",
  "platform",
  "intrinsic",
  "externalUnknown",
] as const;

export type OptIrCallTargetKind = (typeof OPT_IR_CALL_TARGET_KINDS)[number];

export type OptIrCallTarget =
  | {
      readonly kind: "source";
      readonly functionInstanceId: MonoInstanceId;
    }
  | {
      readonly kind: "runtime";
      readonly runtimeKey: string;
    }
  | {
      readonly kind: "platform";
      readonly platformKey: string;
    }
  | {
      readonly kind: "intrinsic";
      readonly intrinsicKey: string;
    }
  | {
      readonly kind: "externalUnknown";
      readonly symbol: string;
    };
