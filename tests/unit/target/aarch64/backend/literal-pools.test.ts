import { describe, expect, test } from "bun:test";

import { planAArch64LiteralPools } from "../../../../../src/target/aarch64/backend/object/literal-pools";

describe("AArch64 literal pool planning", () => {
  test("splits section-local islands when reach windows do not overlap", () => {
    const result = planAArch64LiteralPools({
      users: [literalUser("use:a", 0), literalUser("use:b", 9000)],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected literal islands");
    expect(result.value.map((island) => island.stableKey)).toEqual([
      "literal-island:.text:default:0",
      "literal-island:.text:default:1",
    ]);
  });

  test("places islands after the rendered section end and rejects exhausted reach", () => {
    const placed = planAArch64LiteralPools({
      users: [literalUser("use:after-code", 0, { maxReachBytes: 128 })],
      sectionEndOffsets: [{ sectionKey: ".text", offsetBytes: 40 }],
    });

    expect(placed.kind).toBe("ok");
    if (placed.kind !== "ok") throw new Error("expected placed literal island");
    expect(placed.value[0]?.offsetBytes).toBe(40);
    expect(placed.value[0]?.entries[0]?.users).toEqual([
      { stableKey: "use:after-code", useOffsetBytes: 0, maxReachBytes: 128 },
    ]);

    const exhausted = planAArch64LiteralPools({
      users: [literalUser("use:too-far", 0, { maxReachBytes: 4 })],
      sectionEndOffsets: [{ sectionKey: ".text", offsetBytes: 40 }],
    });

    expect(exhausted.kind).toBe("error");
    if (exhausted.kind !== "error") throw new Error("expected literal reach error");
    expect(exhausted.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "literal-pool:reach-exhausted:use:too-far:distance:40:limit:4",
    ]);
  });

  test("alignment can make an otherwise adjacent literal unreachable", () => {
    const result = planAArch64LiteralPools({
      users: [literalUser("use:aligned", 0, { maxReachBytes: 4 })],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected literal alignment reach error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "literal-pool:reach-exhausted:use:aligned:distance:8:limit:4",
    ]);
  });

  test("rejects secret literals without target approval", () => {
    const result = planAArch64LiteralPools({
      users: [literalUser("secret", 0, { securityLabel: "secret" })],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected secret literal rejection");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "literal-pool:secret-literal-rejected:secret:value:secret",
    ]);
  });
});

function literalUser(
  stableKey: string,
  useOffsetBytes: number,
  overrides: { readonly securityLabel?: "public" | "secret"; readonly maxReachBytes?: number } = {},
) {
  return {
    stableKey,
    sectionKey: ".text",
    literalClass: "default",
    valueKey: `value:${stableKey}`,
    valueBytes: [1, 2, 3, 4, 5, 6, 7, 8],
    alignmentBytes: 8,
    useOffsetBytes,
    maxReachBytes: overrides.maxReachBytes ?? 128,
    ...overrides,
  };
}
