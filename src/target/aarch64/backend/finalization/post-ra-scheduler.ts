import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendResult,
} from "../api/diagnostics";
import { formAArch64PairLoadPeepholes, type AArch64PeepholeApplication } from "./peepholes";

export interface AArch64SchedulableInstruction {
  readonly id: number;
  readonly stableKey: string;
  readonly opcode: string;
  readonly barrier?: boolean;
  readonly definesNzcv?: boolean;
  readonly usesNzcv?: boolean;
  readonly relocationPairKey?: string;
  readonly secretRegionKey?: string;
  readonly memoryKey?: string;
  readonly memoryOrdering?:
    | "normal"
    | "volatile"
    | "mmio"
    | "device"
    | "image-device"
    | "atomic"
    | "firmware";
  readonly callBoundary?: boolean;
  readonly observableExit?: boolean;
  readonly definesFpcr?: boolean;
  readonly usesFpcr?: boolean;
  readonly definesFpsr?: boolean;
  readonly usesFpsr?: boolean;
  readonly vectorStateKey?: string;
  readonly definedRegisters?: readonly string[];
  readonly usedRegisters?: readonly string[];
}

interface SchedulerToken {
  readonly originalIndex: number;
  readonly stableKey: string;
  readonly instructions: readonly AArch64SchedulableInstruction[];
  readonly memoryKeys: readonly string[];
  readonly touchesNzcv: boolean;
  readonly touchesFpcr: boolean;
  readonly touchesFpsr: boolean;
  readonly vectorStateKeys: readonly string[];
  readonly definedRegisterKeys: readonly string[];
  readonly usedRegisterKeys: readonly string[];
}

export function scheduleAArch64PostAllocation(input: {
  readonly instructions: readonly AArch64SchedulableInstruction[];
  readonly preferLoadLatencyHiding?: boolean;
  readonly enablePeepholes?: boolean;
}): AArch64BackendResult<{
  readonly instructions: readonly AArch64SchedulableInstruction[];
  readonly peepholes: readonly AArch64PeepholeApplication[];
}> {
  const scheduled = scheduleDependencyIslands(input.instructions, {
    preferLoadLatencyHiding: input.preferLoadLatencyHiding === true,
  });
  if (scheduled.kind === "error") return scheduled;
  if (input.enablePeepholes === true) {
    const result = formAArch64PairLoadPeepholes(scheduled.value);
    return backendOk(result);
  }
  return backendOk({ instructions: scheduled.value, peepholes: Object.freeze([]) });
}

function scheduleDependencyIslands(
  instructions: readonly AArch64SchedulableInstruction[],
  options: { readonly preferLoadLatencyHiding: boolean },
): AArch64BackendResult<readonly AArch64SchedulableInstruction[]> {
  const scheduled: AArch64SchedulableInstruction[] = [];
  let island: SchedulerToken[] = [];

  for (let index = 0; index < instructions.length; ) {
    const token = readSchedulerToken(instructions, index);
    if (isIslandBoundary(token)) {
      const islandSchedule = scheduleIsland(island, options);
      if (islandSchedule.kind === "error") return islandSchedule;
      scheduled.push(...islandSchedule.value);
      island = [];
      scheduled.push(...token.instructions);
    } else {
      island.push(token);
    }
    index += token.instructions.length;
  }

  const finalIslandSchedule = scheduleIsland(island, options);
  if (finalIslandSchedule.kind === "error") return finalIslandSchedule;
  scheduled.push(...finalIslandSchedule.value);
  return backendOk(Object.freeze(scheduled));
}

function readSchedulerToken(
  instructions: readonly AArch64SchedulableInstruction[],
  index: number,
): SchedulerToken {
  const first = instructions[index];
  if (first === undefined) {
    throw new Error("scheduler token index out of range");
  }

  const grouped: AArch64SchedulableInstruction[] = [first];
  if (first.relocationPairKey !== undefined) {
    for (let nextIndex = index + 1; nextIndex < instructions.length; nextIndex++) {
      const next = instructions[nextIndex];
      if (next?.relocationPairKey !== first.relocationPairKey) break;
      grouped.push(next);
    }
  }

  return {
    originalIndex: index,
    stableKey: grouped.map((instruction) => instruction.stableKey).join("\u0000"),
    instructions: Object.freeze(grouped),
    memoryKeys: Object.freeze(
      grouped
        .map((instruction) => instruction.memoryKey)
        .filter((memoryKey): memoryKey is string => memoryKey !== undefined),
    ),
    touchesNzcv: grouped.some(
      (instruction) => instruction.definesNzcv === true || instruction.usesNzcv === true,
    ),
    touchesFpcr: grouped.some(
      (instruction) => instruction.definesFpcr === true || instruction.usesFpcr === true,
    ),
    touchesFpsr: grouped.some(
      (instruction) => instruction.definesFpsr === true || instruction.usesFpsr === true,
    ),
    vectorStateKeys: Object.freeze(
      grouped
        .map((instruction) => instruction.vectorStateKey)
        .filter((vectorStateKey): vectorStateKey is string => vectorStateKey !== undefined)
        .sort(compareCodeUnitStrings),
    ),
    definedRegisterKeys: registerDependencyKeys(
      grouped.flatMap((instruction) => instruction.definedRegisters ?? []),
    ),
    usedRegisterKeys: registerDependencyKeys(
      grouped.flatMap((instruction) => instruction.usedRegisters ?? []),
    ),
  };
}

function isIslandBoundary(token: SchedulerToken): boolean {
  return token.instructions.some(
    (instruction) =>
      instruction.barrier === true ||
      instruction.secretRegionKey !== undefined ||
      instruction.callBoundary === true ||
      instruction.observableExit === true ||
      orderedMemoryBoundary(instruction.memoryOrdering),
  );
}

function scheduleIsland(
  tokens: readonly SchedulerToken[],
  options: { readonly preferLoadLatencyHiding: boolean },
): AArch64BackendResult<readonly AArch64SchedulableInstruction[]> {
  const unscheduled = new Set(tokens);
  const scheduledTokens: SchedulerToken[] = [];

  while (unscheduled.size > 0) {
    const ready = tokens.filter(
      (token) => unscheduled.has(token) && dependenciesSatisfied(token, scheduledTokens, tokens),
    );
    ready.sort((left, right) => compareTokenPriority(left, right, options));
    const selected = ready[0];
    if (selected === undefined) {
      return backendError([
        aarch64BackendDiagnostic({
          code: "AARCH64_BACKEND_FINALIZATION_INVALID",
          ownerKey: "post-ra-scheduler",
          rootCauseKey: "dependency-cycle",
          stableDetail: "post-ra-scheduler:dependency-cycle",
        }),
      ]);
    }
    scheduledTokens.push(selected);
    unscheduled.delete(selected);
  }

  return backendOk(Object.freeze(scheduledTokens.flatMap((token) => token.instructions)));
}

function dependenciesSatisfied(
  token: SchedulerToken,
  scheduledTokens: readonly SchedulerToken[],
  allTokens: readonly SchedulerToken[],
): boolean {
  const scheduled = new Set(scheduledTokens);
  return allTokens.every(
    (candidate) =>
      candidate.originalIndex >= token.originalIndex ||
      !mustPreserveOrder(candidate, token) ||
      scheduled.has(candidate),
  );
}

function mustPreserveOrder(left: SchedulerToken, right: SchedulerToken): boolean {
  return (
    (left.touchesNzcv && right.touchesNzcv) ||
    (left.touchesFpcr && right.touchesFpcr) ||
    (left.touchesFpsr && right.touchesFpsr) ||
    left.memoryKeys.some((memoryKey) => right.memoryKeys.includes(memoryKey)) ||
    left.vectorStateKeys.some((stateKey) => right.vectorStateKeys.includes(stateKey)) ||
    hasRegisterDependency(left, right)
  );
}

function hasRegisterDependency(left: SchedulerToken, right: SchedulerToken): boolean {
  return (
    overlaps(left.definedRegisterKeys, right.usedRegisterKeys) ||
    overlaps(left.usedRegisterKeys, right.definedRegisterKeys) ||
    overlaps(left.definedRegisterKeys, right.definedRegisterKeys)
  );
}

function overlaps(left: readonly string[], right: readonly string[]): boolean {
  return left.some((key) => right.includes(key));
}

function registerDependencyKeys(registers: readonly string[]): readonly string[] {
  return Object.freeze(
    [...new Set(registers.flatMap((register) => registerDependencyKey(register) ?? []))].sort(
      compareCodeUnitStrings,
    ),
  );
}

function registerDependencyKey(register: string): string | undefined {
  const gpr = /^(?:x|w)([0-9]|[12][0-9]|30)$/.exec(register);
  if (gpr !== null) return `gpr:${gpr[1]}`;
  const simd = /^(?:v|q|d|s|h|b)([0-9]|[12][0-9]|3[01])$/.exec(register);
  if (simd !== null) return `simd:${simd[1]}`;
  if (register === "sp" || register === "wsp") return "sp";
  if (register === "fpcr") return "fpcr";
  if (register === "fpsr") return "fpsr";
  if (register === "nzcv") return "nzcv";
  if (register === "vector-state") return "vector-state";
  return undefined;
}

function compareTokenPriority(
  left: SchedulerToken,
  right: SchedulerToken,
  options: { readonly preferLoadLatencyHiding: boolean },
): number {
  if (options.preferLoadLatencyHiding) {
    const loadPreference = tokenLoadPriority(left) - tokenLoadPriority(right);
    if (loadPreference !== 0) return loadPreference;
  }
  return (
    left.originalIndex - right.originalIndex ||
    compareCodeUnitStrings(left.stableKey, right.stableKey)
  );
}

function tokenLoadPriority(token: SchedulerToken): number {
  return token.instructions.some((instruction) => isLoadOpcode(instruction.opcode)) ? 0 : 1;
}

function isLoadOpcode(opcode: string): boolean {
  return opcode === "ldr" || opcode === "ldp" || opcode.startsWith("ldr-");
}

function orderedMemoryBoundary(
  memoryOrdering: AArch64SchedulableInstruction["memoryOrdering"],
): boolean {
  return memoryOrdering !== undefined && memoryOrdering !== "normal";
}
