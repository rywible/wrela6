import type { OptIrValueId } from "../../../opt-ir/ids";
import type { AArch64VirtualRegisterId } from "./ids";
import {
  aarch64MachineTypeStableKey,
  aarch64RegisterClassAcceptsType,
  type AArch64MachineType,
  type AArch64RegisterClass,
} from "./machine-types";
import { type AArch64SecurityLabel } from "./security";

export type AArch64VirtualRegisterOrigin =
  | { readonly kind: "optIrValue"; readonly valueId: OptIrValueId }
  | { readonly kind: "synthetic"; readonly stableKey: string };

export interface AArch64VirtualRegister {
  readonly vreg: AArch64VirtualRegisterId;
  readonly registerClass: AArch64RegisterClass;
  readonly type: AArch64MachineType;
  readonly securityLabels: readonly AArch64SecurityLabel[];
  readonly origin?: AArch64VirtualRegisterOrigin;
  readonly stableKey: string;
}

export function aarch64VirtualRegister(input: {
  readonly vreg: AArch64VirtualRegisterId;
  readonly registerClass: AArch64RegisterClass;
  readonly type: AArch64MachineType;
  readonly securityLabels?: readonly AArch64SecurityLabel[];
  readonly origin?: AArch64VirtualRegisterOrigin;
}): AArch64VirtualRegister {
  if (!aarch64RegisterClassAcceptsType(input.registerClass, input.type)) {
    throw new RangeError(
      `Register class ${input.registerClass} cannot hold ${aarch64MachineTypeStableKey(input.type)}.`,
    );
  }
  return Object.freeze({
    vreg: input.vreg,
    registerClass: input.registerClass,
    type: Object.freeze({ ...input.type }) as AArch64MachineType,
    securityLabels: Object.freeze(
      (input.securityLabels ?? []).map((label) => Object.freeze({ ...label })),
    ),
    ...(input.origin === undefined ? {} : { origin: Object.freeze({ ...input.origin }) }),
    stableKey: `v${input.vreg}:${input.registerClass}:${aarch64MachineTypeStableKey(input.type)}`,
  });
}
