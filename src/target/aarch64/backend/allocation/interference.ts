import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import type { AArch64LiveInterval } from "./liveness";

export interface AArch64InterferenceGraph {
  readonly interferes: (leftVreg: number, rightVreg: number) => boolean;
  readonly physicalInterferencesFor: (vreg: number) => readonly string[];
}

export function buildAArch64InterferenceGraph(input: {
  readonly intervals: readonly AArch64LiveInterval[];
  readonly aliases?: readonly { readonly left: string; readonly right: string }[];
}): AArch64InterferenceGraph {
  const interference = new Set<string>();
  const physicalInterference = new Map<number, Set<string>>();
  const aliasMap = buildAliasMap(input.aliases ?? []);
  for (const left of input.intervals) {
    const leftPhysical = expandedPhysicalInterferences(left, aliasMap);
    if (leftPhysical.length > 0) physicalInterference.set(left.vreg, new Set(leftPhysical));
    for (const right of input.intervals) {
      if (left.vreg >= right.vreg) continue;
      if (overlaps(left, right)) {
        interference.add(pairKey(left.vreg, right.vreg));
      }
    }
  }
  return Object.freeze({
    interferes(leftVreg: number, rightVreg: number) {
      return interference.has(pairKey(leftVreg, rightVreg));
    },
    physicalInterferencesFor(vreg: number) {
      return Object.freeze(
        [...(physicalInterference.get(vreg) ?? [])].sort(compareCodeUnitStrings),
      );
    },
  });
}

function overlaps(left: AArch64LiveInterval, right: AArch64LiveInterval): boolean {
  return left.segments.some((leftSegment) =>
    right.segments.some(
      (rightSegment) =>
        leftSegment.startOrder < rightSegment.endOrder &&
        rightSegment.startOrder < leftSegment.endOrder,
    ),
  );
}

function pairKey(left: number, right: number): string {
  return left < right ? `${left}:${right}` : `${right}:${left}`;
}

function expandedPhysicalInterferences(
  interval: AArch64LiveInterval,
  aliasMap: ReadonlyMap<string, ReadonlySet<string>>,
): readonly string[] {
  const registers = new Set(interval.clobberedPhysicalRegisters);
  const pendingRegisters = Array.from(registers);
  for (let index = 0; index < pendingRegisters.length; index += 1) {
    const register = pendingRegisters[index];
    if (register === undefined) continue;
    for (const alias of aliasMap.get(register) ?? []) {
      if (registers.has(alias)) continue;
      registers.add(alias);
      pendingRegisters.push(alias);
    }
  }
  return Object.freeze([...registers].sort(compareCodeUnitStrings));
}

function buildAliasMap(
  aliases: readonly { readonly left: string; readonly right: string }[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const map = new Map<string, Set<string>>();
  for (const alias of aliases) {
    addAlias(map, alias.left, alias.right);
    addAlias(map, alias.right, alias.left);
  }
  return new Map([...map].map(([key, value]) => [key, new Set(value)]));
}

function addAlias(map: Map<string, Set<string>>, left: string, right: string): void {
  const values = map.get(left) ?? new Set<string>([left]);
  values.add(right);
  map.set(left, values);
}
