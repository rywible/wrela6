import { compareCodeUnitStrings } from "../../../../../shared/deterministic-sort";
import type { AArch64AllocationResult } from "../../allocation/allocation-result";
import type { AArch64BackendTargetSurface } from "../backend-target-surface";

export function calleeSavedRegistersForFrame(input: {
  readonly allocation: AArch64AllocationResult;
  readonly registerModel: AArch64BackendTargetSurface["registerModel"];
  readonly saveLinkRegister: boolean;
}): readonly string[] {
  const canonicalCalleeSavedByAlias = canonicalCalleeSavedRegistersByAlias(input.registerModel);
  const savedRegisters = new Set<string>();
  for (const segment of input.allocation.segments) {
    const calleeSavedRegister = canonicalCalleeSavedByAlias.get(
      input.registerModel.aliasSetOf(segment.physical),
    );
    if (calleeSavedRegister !== undefined) savedRegisters.add(calleeSavedRegister);
  }
  if (input.saveLinkRegister) savedRegisters.add("x30");
  return Object.freeze([...savedRegisters].sort(compareCodeUnitStrings));
}

function canonicalCalleeSavedRegistersByAlias(
  registerModel: AArch64BackendTargetSurface["registerModel"],
): ReadonlyMap<string, string> {
  const canonicalByAlias = new Map<string, string>();
  for (const register of [
    ...registerModel.publicCalleeSavedGprs,
    ...registerModel.publicCalleeSavedSimd,
  ]) {
    const aliasSet = registerModel.aliasSetOf(register);
    const previous = canonicalByAlias.get(aliasSet);
    if (previous === undefined || compareFrameSaveRegisterPreference(register, previous) < 0) {
      canonicalByAlias.set(aliasSet, register);
    }
  }
  return canonicalByAlias;
}

function compareFrameSaveRegisterPreference(left: string, right: string): number {
  return (
    frameSaveRegisterRank(left) - frameSaveRegisterRank(right) ||
    compareCodeUnitStrings(left, right)
  );
}

function frameSaveRegisterRank(register: string): number {
  if (/^x\d+$/.test(register) || /^d\d+$/.test(register)) return 0;
  if (/^w\d+$/.test(register) || /^v\d+$/.test(register)) return 1;
  if (/^q\d+$/.test(register)) return 2;
  if (/^[shb]\d+$/.test(register)) return 3;
  return 4;
}
