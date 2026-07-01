import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import type {
  AArch64AliasSetRecord,
  AArch64PhysicalRegisterModel,
  AArch64PhysicalRegisterRecord,
  AArch64PhysicalRegisterStableKey,
  AArch64RegisterOperandPermissionQuery,
} from "./backend-catalog-interfaces";

const GPR_COUNT = 31;
const SIMD_COUNT = 32;

export function createAArch64Rpi5PhysicalRegisterModel(): AArch64PhysicalRegisterModel {
  const registers = buildRegisters();
  const registerByKey = new Map(registers.map((register) => [register.stableKey, register]));
  const aliasSets = buildAliasSets(registers);

  return Object.freeze({
    fingerprint: "backend-register-model:wrela-uefi-aarch64-rpi5-v1:v1",
    registers: Object.freeze(registers),
    aliasSets: Object.freeze(aliasSets),
    publicParameterGprs: Object.freeze(rangeKeys("x", 0, 7)),
    publicResultGprs: Object.freeze(rangeKeys("x", 0, 7)),
    publicCallerSavedGprs: Object.freeze(
      [...rangeKeys("x", 0, 17), "x30"].sort(compareCodeUnitStrings),
    ),
    publicCalleeSavedGprs: Object.freeze(rangeKeys("x", 19, 28)),
    privateConventionCandidateGprs: Object.freeze(
      [...rangeKeys("x", 0, 17), ...rangeKeys("x", 19, 28)].sort(compareCodeUnitStrings),
    ),
    veneerScratchGprs: Object.freeze(["x16", "x17"]),
    encodingNumberOf: (register: AArch64PhysicalRegisterStableKey) =>
      registerByKey.get(register)?.encodingNumber ?? -1,
    aliasSetOf: (register: AArch64PhysicalRegisterStableKey) =>
      registerByKey.get(register)?.aliasSet ?? `unknown:${register}`,
    canAllocate: (register: AArch64PhysicalRegisterStableKey) =>
      registerByKey.get(register)?.isAllocatable ?? false,
    permitsOperand,
  });
}

function buildRegisters(): readonly AArch64PhysicalRegisterRecord[] {
  const records: AArch64PhysicalRegisterRecord[] = [];
  for (let index = 0; index < GPR_COUNT; index += 1) {
    const isAllocatable = index !== 18 && index !== 29 && index !== 30;
    records.push(register(`x${index}`, `gpr:${index}`, index, isAllocatable));
    records.push(register(`w${index}`, `gpr:${index}`, index, isAllocatable));
  }
  records.push(register("sp", "sp", 31, false));
  records.push(register("wsp", "sp", 31, false));
  records.push(register("xzr", "xzr", 31, false));
  records.push(register("wzr", "xzr", 31, false));

  for (let index = 0; index < SIMD_COUNT; index += 1) {
    for (const prefix of ["b", "h", "s", "d", "q", "v"]) {
      records.push(register(`${prefix}${index}`, `simd:${index}`, index, true));
    }
  }

  records.push(register("nzcv", "pstate:nzcv", 0, false));
  records.push(register("fpcr", "fp:control", 0, false));
  records.push(register("fpsr", "fp:status", 0, false));
  records.push(register("vector-state", "simd:state", 0, false));

  return records.sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey));
}

function buildAliasSets(
  registers: readonly AArch64PhysicalRegisterRecord[],
): readonly AArch64AliasSetRecord[] {
  const aliasesBySet = new Map<string, string[]>();
  for (const registerRecord of registers) {
    const aliases = aliasesBySet.get(registerRecord.aliasSet) ?? [];
    aliases.push(registerRecord.stableKey);
    aliasesBySet.set(registerRecord.aliasSet, aliases);
  }
  return [...aliasesBySet.entries()]
    .map(([stableKey, aliases]) => ({
      stableKey,
      aliases: Object.freeze(aliases.sort(compareCodeUnitStrings)),
    }))
    .sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey));
}

function permitsOperand(input: AArch64RegisterOperandPermissionQuery): boolean {
  if (input.registerKey === "sp" || input.registerKey === "wsp") {
    return input.context === "stack-access";
  }
  if (input.registerKey === "xzr" || input.registerKey === "wzr") {
    return input.context === "general" && input.operationKind === "zero-register";
  }
  return input.context !== "stack-access";
}

function register(
  stableKey: AArch64PhysicalRegisterStableKey,
  aliasSet: string,
  encodingNumber: number,
  isAllocatable: boolean,
): AArch64PhysicalRegisterRecord {
  return Object.freeze({ stableKey, aliasSet, encodingNumber, isAllocatable });
}

function rangeKeys(prefix: string, first: number, last: number): readonly string[] {
  const keys: string[] = [];
  for (let index = first; index <= last; index += 1) keys.push(`${prefix}${index}`);
  return keys;
}
