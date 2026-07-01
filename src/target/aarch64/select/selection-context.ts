import type { OptIrFactSet } from "../../../opt-ir/facts/fact-index";
import { aarch64VirtualRegisterId } from "../machine-ir/ids";
import { aarch64IntMachineType, aarch64PointerMachineType } from "../machine-ir/machine-types";
import { aarch64VirtualRegister } from "../machine-ir/virtual-register";
import type { AArch64TargetSurface } from "../target-surface/target-surface";

export interface AArch64SelectionContext {
  readonly facts: OptIrFactSet;
  readonly target: AArch64TargetSurface;
  readonly nextVirtualRegister: number;
}

export function createAArch64SelectionContext(input: {
  readonly facts: OptIrFactSet;
  readonly target: AArch64TargetSurface;
  readonly nextVirtualRegister?: number;
}): AArch64SelectionContext {
  return Object.freeze({
    facts: input.facts,
    target: input.target,
    nextVirtualRegister: input.nextVirtualRegister ?? 0,
  });
}

export function scratchGpr64ForAArch64Selection(id: number) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(id),
    registerClass: "gpr64",
    type: aarch64IntMachineType(64),
    origin: { kind: "synthetic", stableKey: `selection.gpr64.${id}` },
  });
}

export function scratchPointerForAArch64Selection(id: number) {
  return aarch64VirtualRegister({
    vreg: aarch64VirtualRegisterId(id),
    registerClass: "gpr64",
    type: aarch64PointerMachineType("aarch64.selection"),
    origin: { kind: "synthetic", stableKey: `selection.pointer.${id}` },
  });
}
