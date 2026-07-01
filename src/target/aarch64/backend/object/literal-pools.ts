import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";

export interface AArch64LiteralPoolUser {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly literalClass: string;
  readonly valueKey: string;
  readonly valueBytes: readonly number[];
  readonly alignmentBytes: number;
  readonly useOffsetBytes: number;
  readonly maxReachBytes: number;
  readonly securityLabel?: "public" | "secret";
  readonly allowSecretLiteral?: boolean;
}

export interface AArch64LiteralPoolIsland {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly literalClass: string;
  readonly alignmentBytes: number;
  readonly offsetBytes: number;
  readonly entries: readonly AArch64LiteralPoolIslandEntry[];
  readonly userKeys: readonly string[];
}

export interface AArch64LiteralPoolIslandEntry {
  readonly stableKey: string;
  readonly valueKey: string;
  readonly valueBytes: readonly number[];
  readonly users: readonly AArch64LiteralPoolIslandUser[];
}

export interface AArch64LiteralPoolIslandUser {
  readonly stableKey: string;
  readonly useOffsetBytes: number;
  readonly maxReachBytes: number;
}

export function planAArch64LiteralPools(input: {
  readonly users: readonly AArch64LiteralPoolUser[];
  readonly sectionEndOffsets?: readonly {
    readonly sectionKey: string;
    readonly offsetBytes: number;
  }[];
}): AArch64BackendResult<readonly AArch64LiteralPoolIsland[]> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  const users = [...input.users].sort(compareUsers);
  const sectionEndOffsets = new Map(
    (input.sectionEndOffsets ?? []).map((record) => [record.sectionKey, record.offsetBytes]),
  );
  for (const user of users) {
    if (user.securityLabel === "secret" && user.allowSecretLiteral !== true) {
      diagnostics.push(
        diagnostic(`literal-pool:secret-literal-rejected:${user.stableKey}:${user.valueKey}`),
      );
    }
  }
  if (diagnostics.length > 0) return backendError(diagnostics);

  const islands: AArch64LiteralPoolIsland[] = [];
  let current: MutableIsland | undefined;
  for (const user of users) {
    const nextOffset = nextIslandOffset(user, sectionEndOffsets.get(user.sectionKey) ?? 0);
    if (Math.abs(nextOffset - user.useOffsetBytes) > user.maxReachBytes) {
      diagnostics.push(
        diagnostic(
          `literal-pool:reach-exhausted:${user.stableKey}:distance:${Math.abs(
            nextOffset - user.useOffsetBytes,
          )}:limit:${user.maxReachBytes}`,
        ),
      );
      continue;
    }
    const needsNewIsland =
      current === undefined ||
      current.sectionKey !== user.sectionKey ||
      current.literalClass !== user.literalClass ||
      Math.abs(user.useOffsetBytes - current.offsetBytes) > user.maxReachBytes;
    if (needsNewIsland) {
      current = {
        stableKey: `literal-island:${user.sectionKey}:${user.literalClass}:${islands.length}`,
        sectionKey: user.sectionKey,
        literalClass: user.literalClass,
        alignmentBytes: user.alignmentBytes,
        offsetBytes: nextOffset,
        entries: new Map(),
        userKeys: [],
      };
      islands.push(freezeMutableIsland(current));
    }
    if (current === undefined) {
      throw new RangeError(`literal-pool:missing-active-island:${user.stableKey}`);
    }
    const activeIsland: MutableIsland = current;
    activeIsland.userKeys.push(user.stableKey);
    const existingEntry = activeIsland.entries.get(user.valueKey);
    const entry =
      existingEntry ??
      ({
        stableKey: `literal:${user.sectionKey}:${user.valueKey}`,
        valueKey: user.valueKey,
        valueBytes: Object.freeze([...user.valueBytes]),
        users: [],
      } satisfies MutableIslandEntry);
    entry.users.push({
      stableKey: user.stableKey,
      useOffsetBytes: user.useOffsetBytes,
      maxReachBytes: user.maxReachBytes,
    });
    activeIsland.entries.set(user.valueKey, entry);
    islands[islands.length - 1] = freezeMutableIsland(activeIsland);
  }

  return diagnostics.length > 0 ? backendError(diagnostics) : backendOk(Object.freeze(islands));
}

interface MutableIsland {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly literalClass: string;
  readonly alignmentBytes: number;
  readonly offsetBytes: number;
  readonly entries: Map<string, MutableIslandEntry>;
  readonly userKeys: string[];
}

interface MutableIslandEntry {
  readonly stableKey: string;
  readonly valueKey: string;
  readonly valueBytes: readonly number[];
  readonly users: AArch64LiteralPoolIslandUser[];
}

function freezeMutableIsland(input: MutableIsland): AArch64LiteralPoolIsland {
  return Object.freeze({
    stableKey: input.stableKey,
    sectionKey: input.sectionKey,
    literalClass: input.literalClass,
    alignmentBytes: input.alignmentBytes,
    offsetBytes: input.offsetBytes,
    entries: Object.freeze(
      [...input.entries.values()]
        .map((entry) =>
          Object.freeze({
            stableKey: entry.stableKey,
            valueKey: entry.valueKey,
            valueBytes: entry.valueBytes,
            users: Object.freeze(
              [...entry.users].sort((left, right) =>
                compareCodeUnitStrings(left.stableKey, right.stableKey),
              ),
            ),
          }),
        )
        .sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
    ),
    userKeys: Object.freeze([...input.userKeys].sort(compareCodeUnitStrings)),
  });
}

function compareUsers(left: AArch64LiteralPoolUser, right: AArch64LiteralPoolUser): number {
  for (const [leftPart, rightPart] of [
    [left.sectionKey, right.sectionKey],
    [left.literalClass, right.literalClass],
    [String(left.useOffsetBytes).padStart(12, "0"), String(right.useOffsetBytes).padStart(12, "0")],
    [left.stableKey, right.stableKey],
  ] as const) {
    const order = compareCodeUnitStrings(leftPart, rightPart);
    if (order !== 0) return order;
  }
  return 0;
}

function alignTo(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function nextIslandOffset(user: AArch64LiteralPoolUser, sectionEndOffset: number): number {
  return alignTo(Math.max(user.useOffsetBytes + 4, sectionEndOffset), user.alignmentBytes);
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_LAYOUT_FIXED_POINT_FAILED",
    stableDetail,
    ownerKey: "literal-pool",
    rootCauseKey: stableDetail,
  });
}
