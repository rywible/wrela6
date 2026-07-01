import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";

export interface AArch64PhysicalRegisterAliasPair {
  readonly left: string;
  readonly right: string;
}

export function aarch64PhysicalRegisterStorageKey(
  registerKey: string,
  aliasSet?: string,
): string | undefined {
  const gpr = /^(?:x|w)(\d+)$/.exec(registerKey);
  if (gpr?.[1] !== undefined) return `gpr:${gpr[1]}`;
  const vector = /^(?:v|q|d|s|h|b)(\d+)$/.exec(registerKey);
  if (vector?.[1] !== undefined) return `vector:${vector[1]}`;
  if (registerKey === "sp" || registerKey === "wsp") return "sp";
  if (registerKey === "xzr" || registerKey === "wzr") return "xzr";
  return aliasSet?.includes(":") === true ? aliasSet : undefined;
}

export function aarch64PhysicalAliasMap(
  aliases: readonly AArch64PhysicalRegisterAliasPair[],
): ReadonlyMap<string, ReadonlySet<string>> {
  const graph = new Map<string, Set<string>>();
  for (const alias of aliases) {
    addAliasEdge(graph, alias.left, alias.right);
    addAliasEdge(graph, alias.right, alias.left);
  }
  const closure = new Map<string, ReadonlySet<string>>();
  for (const register of graph.keys()) {
    closure.set(
      register,
      new Set([...reachableAliases(register, graph)].sort(compareCodeUnitStrings)),
    );
  }
  return closure;
}

export function aarch64ExpandUnavailableRegisters(
  unavailable: readonly string[],
  aliasMap: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const expanded = new Set(unavailable);
  for (const register of unavailable) {
    for (const alias of aliasMap.get(register) ?? []) expanded.add(alias);
  }
  return expanded;
}

export function aarch64RegisterAliasesAny(
  register: string,
  unavailable: ReadonlySet<string>,
  aliasMap: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (unavailable.has(register)) return true;
  for (const alias of aliasMap.get(register) ?? []) {
    if (unavailable.has(alias)) return true;
  }
  for (const unavailableRegister of unavailable) {
    if (aarch64RegistersAlias(register, unavailableRegister, aliasMap)) return true;
  }
  return false;
}

export function aarch64RegistersAlias(
  left: string,
  right: string,
  aliasMap: ReadonlyMap<string, ReadonlySet<string>>,
): boolean {
  if (left === right || (aliasMap.get(left)?.has(right) ?? false)) return true;
  const leftStorage = aarch64PhysicalRegisterStorageKey(left);
  return leftStorage !== undefined && leftStorage === aarch64PhysicalRegisterStorageKey(right);
}

function addAliasEdge(graph: Map<string, Set<string>>, left: string, right: string): void {
  const edges = graph.get(left) ?? new Set<string>();
  edges.add(right);
  graph.set(left, edges);
}

function reachableAliases(
  register: string,
  graph: ReadonlyMap<string, ReadonlySet<string>>,
): ReadonlySet<string> {
  const visited = new Set<string>();
  const pending = [...(graph.get(register) ?? [])];
  while (pending.length > 0) {
    const next = pending.pop();
    if (next === undefined || visited.has(next)) continue;
    visited.add(next);
    pending.push(...(graph.get(next) ?? []));
  }
  visited.delete(register);
  return visited;
}
