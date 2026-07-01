import { describe, expect, test } from "bun:test";

import { resolveAArch64ParallelCopies } from "../../../../../src/target/aarch64/backend/allocation/move-resolution";

describe("AArch64 move resolution", () => {
  test("resolves two-register cycle with legal temporary", () => {
    const result = resolveAArch64ParallelCopies({
      copies: [
        { sourceRegister: "x0", destinationRegister: "x1", value: "a" },
        { sourceRegister: "x1", destinationRegister: "x0", value: "b" },
      ],
      availableTemporaries: ["x9"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected moves");
    expect(
      result.moves.map((move) => `${move.sourceRegister}->${move.destinationRegister}`),
    ).toEqual(["x0->x9", "x1->x0", "x9->x1"]);
  });

  test("resolves three-register cycle with legal temporary", () => {
    const result = resolveAArch64ParallelCopies({
      copies: [
        { sourceRegister: "x0", destinationRegister: "x1", value: "a" },
        { sourceRegister: "x1", destinationRegister: "x2", value: "b" },
        { sourceRegister: "x2", destinationRegister: "x0", value: "c" },
      ],
      availableTemporaries: ["x9"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected moves");
    expect(
      result.moves.map((move) => `${move.sourceRegister}->${move.destinationRegister}`),
    ).toEqual(["x0->x9", "x2->x0", "x1->x2", "x9->x1"]);
  });

  test("cycle temporaries cannot overlap active copy registers", () => {
    const result = resolveAArch64ParallelCopies({
      copies: [
        { sourceRegister: "x0", destinationRegister: "x1", value: "a" },
        { sourceRegister: "x1", destinationRegister: "x0", value: "b" },
      ],
      availableTemporaries: ["x0", "x9"],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected non-overlapping temporary");
    expect(
      result.moves.map((move) => `${move.sourceRegister}->${move.destinationRegister}`),
    ).toEqual(["x0->x9", "x1->x0", "x9->x1"]);
  });

  test("cycle rejects when only overlapping temporaries are available", () => {
    const result = resolveAArch64ParallelCopies({
      copies: [
        { sourceRegister: "x0", destinationRegister: "x1", value: "a" },
        { sourceRegister: "x1", destinationRegister: "x0", value: "b" },
      ],
      availableTemporaries: ["x0"],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected unavailable temporary error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "move-resolution:cycle-temporary-unavailable",
    ]);
  });

  test("orders acyclic chain moves before their source is overwritten", () => {
    const result = resolveAArch64ParallelCopies({
      copies: [
        { sourceRegister: "x0", destinationRegister: "x1", value: "a" },
        { sourceRegister: "x1", destinationRegister: "x2", value: "b" },
        { sourceRegister: "x2", destinationRegister: "x3", value: "c" },
      ],
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected moves");
    expect(
      result.moves.map((move) => `${move.sourceRegister}->${move.destinationRegister}`),
    ).toEqual(["x2->x3", "x1->x2", "x0->x1"]);
  });

  test("no-spill cycle fails when only memory swap is possible", () => {
    const result = resolveAArch64ParallelCopies({
      copies: [
        { sourceRegister: "x0", destinationRegister: "x1", value: "a", noSpill: true },
        { sourceRegister: "x1", destinationRegister: "x0", value: "b" },
      ],
      availableTemporaries: [],
      memorySwapAllowed: true,
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected no-spill error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "move-resolution:no-spill-memory-swap-rejected:value:a",
    ]);
  });
});
