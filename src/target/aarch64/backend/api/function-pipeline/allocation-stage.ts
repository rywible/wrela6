import { compareCodeUnitStrings } from "../../../../../shared/deterministic-sort";
import { allocateAArch64Registers } from "../../allocation/allocator";
import type {
  AArch64AllocationResult,
  AArch64AllocatorInterval,
  AArch64BackendRegisterClass,
} from "../../allocation/allocation-result";
import type { AArch64InterferenceGraph } from "../../allocation/interference";
import type { AArch64LiveInterval } from "../../allocation/liveness";
import type { AArch64RegisterClass } from "../../../machine-ir/machine-types";
import type { AArch64BackendTargetSurface } from "../backend-target-surface";
import { backendOk, type AArch64BackendResult } from "../diagnostics";
import {
  requiredPhysicalRegisterForSegment,
  type AArch64CallLocationConstraint,
} from "../function-call-constraints";

export function runAArch64AllocationStage(input: {
  readonly allocatorIntervals: readonly AArch64AllocatorInterval[];
  readonly target: AArch64BackendTargetSurface;
  readonly physicalAliases: readonly { readonly left: string; readonly right: string }[];
  readonly scratchRegisters: readonly string[];
  readonly boundaryUnavailableRegisters: readonly string[];
}): AArch64BackendResult<AArch64AllocationResult> {
  const allocationPools = allocationRegisterPools(input.target);
  const result = allocateAArch64Registers({
    intervals: input.allocatorIntervals,
    availableGprs: allocationPools.gprs,
    availableVectorRegisters: allocationPools.vectors,
    availableFpRegisters: allocationPools.fps,
    unavailableRegisters: uniqueSortedRegisters([
      ...input.scratchRegisters,
      ...input.boundaryUnavailableRegisters,
    ]),
    aliases: input.physicalAliases,
  });
  return result.kind === "error" ? result : backendOk(result.allocation, result.diagnostics);
}

export function allocatorIntervalsFromLiveness(
  intervals: readonly AArch64LiveInterval[],
  interference: AArch64InterferenceGraph,
  callLocationConstraints: readonly AArch64CallLocationConstraint[],
): readonly AArch64AllocatorInterval[] {
  const constraintsByVreg = constraintsByVirtualRegister(callLocationConstraints);
  return Object.freeze(
    intervals.flatMap((interval) =>
      interval.segments.map((segment) => ({
        liveRangeKey: interval.liveRangeKey,
        vreg: interval.vreg,
        registerClass: registerClassForAllocation(interval.registerClass),
        startOrder: segment.startOrder,
        endOrder: segment.endOrder,
        cutPoints: interval.cutPoints,
        physicalInterferences: interference.physicalInterferencesFor(interval.vreg),
        ...requiredPhysicalRegisterForSegment(segment, constraintsByVreg.get(interval.vreg)),
        noSpill: interval.noSpill,
      })),
    ),
  );
}

export function allocationRegisterPools(
  target: Pick<AArch64BackendTargetSurface, "registerModel">,
): {
  readonly gprs: readonly string[];
  readonly vectors: readonly string[];
  readonly fps: readonly string[];
} {
  const allocatable = target.registerModel.registers.filter(
    (register) => register.isAllocatable && target.registerModel.canAllocate(register.stableKey),
  );
  return Object.freeze({
    gprs: allocatableRegisterKeys(allocatable, (register) => /^x\d+$/.test(register.stableKey)),
    vectors: allocatableRegisterKeys(allocatable, (register) => /^v\d+$/.test(register.stableKey)),
    fps: allocatableRegisterKeys(allocatable, (register) => /^d\d+$/.test(register.stableKey)),
  });
}

function allocatableRegisterKeys(
  registers: readonly { readonly stableKey: string; readonly encodingNumber: number }[],
  predicate: (register: { readonly stableKey: string; readonly encodingNumber: number }) => boolean,
): readonly string[] {
  return Object.freeze(
    registers
      .filter(predicate)
      .sort((left, right) => {
        return (
          left.encodingNumber - right.encodingNumber ||
          compareCodeUnitStrings(left.stableKey, right.stableKey)
        );
      })
      .map((register) => register.stableKey),
  );
}

function constraintsByVirtualRegister(
  constraints: readonly AArch64CallLocationConstraint[],
): ReadonlyMap<number, AArch64CallLocationConstraint[]> {
  const constraintsByVreg = new Map<number, AArch64CallLocationConstraint[]>();
  for (const constraint of constraints) {
    const existing = constraintsByVreg.get(constraint.vreg) ?? [];
    existing.push(constraint);
    constraintsByVreg.set(constraint.vreg, existing);
  }
  return constraintsByVreg;
}

function uniqueSortedRegisters(registers: readonly string[]): readonly string[] {
  return Object.freeze([...new Set(registers)].sort(compareCodeUnitStrings));
}

function registerClassForAllocation(
  registerClass: AArch64RegisterClass,
): AArch64BackendRegisterClass {
  switch (registerClass) {
    case "gpr64":
    case "gpr32":
    case "vector128":
    case "vector64":
      return registerClass;
    case "fpScalar":
      return "fp";
  }
}
