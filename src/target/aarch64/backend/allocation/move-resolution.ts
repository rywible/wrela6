import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import { aarch64BackendDiagnostic, type AArch64BackendDiagnostic } from "../api/diagnostics";

const DEFAULT_TEMPORARIES = Object.freeze(["x9", "x10", "x16", "x17"]);
const PSEUDO_STACK_TEMPORARY = "__aarch64_parallel_copy_stack_temp";

export interface AArch64ParallelCopy {
  readonly sourceRegister: string;
  readonly destinationRegister: string;
  readonly value: string;
  readonly noSpill?: boolean;
}

export interface AArch64ResolvedMove {
  readonly sourceRegister: string;
  readonly destinationRegister: string;
  readonly value: string;
}

export type ResolveAArch64ParallelCopiesResult =
  | {
      readonly kind: "ok";
      readonly moves: readonly AArch64ResolvedMove[];
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] };

type SelectAArch64MemoryTemporaryResult =
  | { readonly kind: "ok"; readonly temporary: string }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64BackendDiagnostic[] };

export function resolveAArch64ParallelCopies(input: {
  readonly copies: readonly AArch64ParallelCopy[];
  readonly availableTemporaries?: readonly string[];
  readonly unavailableTemporaries?: readonly string[];
  readonly memorySwapAllowed?: boolean;
}): ResolveAArch64ParallelCopiesResult {
  const copies = input.copies.filter((copy) => copy.sourceRegister !== copy.destinationRegister);
  const duplicateDestination = findDuplicateDestination(copies);
  if (duplicateDestination !== undefined) {
    return {
      kind: "error",
      diagnostics: [
        aarch64BackendDiagnostic({
          code: "AARCH64_BACKEND_ALLOCATION_FAILED",
          ownerKey: duplicateDestination,
          rootCauseKey: "move-resolution",
          stableDetail: `move-resolution:duplicate-destination:destination:${duplicateDestination}`,
        }),
      ],
    };
  }

  const moves: AArch64ResolvedMove[] = [];
  const remaining = new Map(copies.map((copy) => [copy.destinationRegister, copy]));

  while (remaining.size > 0) {
    const remainingSources = new Set([...remaining.values()].map((copy) => copy.sourceRegister));
    const ready = sortCopies([...remaining.values()]).filter(
      (copy) => !remainingSources.has(copy.destinationRegister),
    );

    if (ready.length > 0) {
      for (const copy of ready) {
        moves.push(toMove(copy));
        remaining.delete(copy.destinationRegister);
      }
      continue;
    }

    const cycle = selectCycle(remaining);
    const registerTemporary = selectRegisterTemporary(input, [...remaining.values()]);
    const temporarySelection =
      registerTemporary === undefined
        ? selectMemoryTemporary(input, cycle)
        : { kind: "ok" as const, temporary: registerTemporary };
    if (temporarySelection.kind === "error") return temporarySelection;
    const cycleTemporary = temporarySelection.temporary;

    const first = cycle[0];
    if (first === undefined) break;
    moves.push({
      sourceRegister: first.sourceRegister,
      destinationRegister: cycleTemporary,
      value: first.value,
    });
    for (let index = 1; index < cycle.length; index++) {
      const copy = cycle[index];
      if (copy === undefined) continue;
      moves.push(toMove(copy));
      remaining.delete(copy.destinationRegister);
    }
    moves.push({
      sourceRegister: cycleTemporary,
      destinationRegister: first.destinationRegister,
      value: first.value,
    });
    remaining.delete(first.destinationRegister);
  }

  return {
    kind: "ok",
    moves: Object.freeze(moves),
    diagnostics: [],
  };
}

function selectRegisterTemporary(
  input: {
    readonly availableTemporaries?: readonly string[];
    readonly unavailableTemporaries?: readonly string[];
  },
  activeCopies: readonly AArch64ParallelCopy[],
): string | undefined {
  const unavailable = new Set(input.unavailableTemporaries ?? []);
  const blocked = new Set(
    activeCopies.flatMap((copy) => [copy.sourceRegister, copy.destinationRegister]),
  );
  return (input.availableTemporaries ?? DEFAULT_TEMPORARIES).find(
    (candidate) => !unavailable.has(candidate) && !blocked.has(candidate),
  );
}

function findDuplicateDestination(copies: readonly AArch64ParallelCopy[]): string | undefined {
  const seen = new Set<string>();
  for (const copy of sortCopies(copies)) {
    if (seen.has(copy.destinationRegister)) return copy.destinationRegister;
    seen.add(copy.destinationRegister);
  }
  return undefined;
}

function selectMemoryTemporary(
  input: {
    readonly memorySwapAllowed?: boolean;
  },
  cycle: readonly AArch64ParallelCopy[],
): SelectAArch64MemoryTemporaryResult {
  const noSpill = sortCopies(cycle).find((copy) => copy.noSpill === true);
  if (noSpill !== undefined) {
    return {
      kind: "error",
      diagnostics: [
        aarch64BackendDiagnostic({
          code: "AARCH64_BACKEND_ALLOCATION_FAILED",
          ownerKey: noSpill.value,
          rootCauseKey: "move-resolution",
          stableDetail: `move-resolution:no-spill-memory-swap-rejected:value:${noSpill.value}`,
        }),
      ],
    };
  }
  if (input.memorySwapAllowed === true) {
    return { kind: "ok", temporary: PSEUDO_STACK_TEMPORARY };
  }
  return {
    kind: "error",
    diagnostics: [
      aarch64BackendDiagnostic({
        code: "AARCH64_BACKEND_ALLOCATION_FAILED",
        rootCauseKey: "move-resolution",
        stableDetail: "move-resolution:cycle-temporary-unavailable",
      }),
    ],
  };
}

function selectCycle(
  remaining: ReadonlyMap<string, AArch64ParallelCopy>,
): readonly AArch64ParallelCopy[] {
  const start = sortCopies([...remaining.values()])[0];
  if (start === undefined) return Object.freeze([]);

  const cycle: AArch64ParallelCopy[] = [];
  let copy: AArch64ParallelCopy | undefined = start;
  while (copy !== undefined && !cycle.includes(copy)) {
    cycle.push(copy);
    copy = remaining.get(copy.sourceRegister);
  }

  const repeatedIndex = copy === undefined ? -1 : cycle.indexOf(copy);
  if (repeatedIndex > 0) return Object.freeze(cycle.slice(repeatedIndex));
  return Object.freeze(cycle);
}

function sortCopies(copies: readonly AArch64ParallelCopy[]): readonly AArch64ParallelCopy[] {
  return Object.freeze(
    [...copies].sort(
      (left, right) =>
        compareCodeUnitStrings(left.sourceRegister, right.sourceRegister) ||
        compareCodeUnitStrings(left.destinationRegister, right.destinationRegister) ||
        compareCodeUnitStrings(left.value, right.value),
    ),
  );
}

function toMove(copy: AArch64ParallelCopy): AArch64ResolvedMove {
  return {
    sourceRegister: copy.sourceRegister,
    destinationRegister: copy.destinationRegister,
    value: copy.value,
  };
}
