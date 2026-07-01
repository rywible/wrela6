import { describe, expect, test } from "bun:test";

import { classifyAArch64PublicAbiBoundary } from "../../../../../src/target/aarch64/backend/abi/abi-classification";
import { authenticatedBackendTargetSurfaceForTest } from "../../../../../tests/support/target/aarch64/backend/backend-target-surface-fakes";

describe("AArch64 public ABI classification", () => {
  test("assigns integer registers then 16-byte aligned stack overflow", () => {
    const result = classifyAArch64PublicAbiBoundary(
      {
        boundaryKey: "call:main:callee",
        boundaryKind: "public-call",
        parameters: Array.from({ length: 9 }, (unusedValue, index) => ({
          key: `arg${index}`,
          kind: "integer",
          sizeBytes: 8,
        })),
        returns: [],
      },
      authenticatedBackendTargetSurfaceForTest(),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected classification");
    expect(result.value.parameterLocations.slice(0, 2).map((value) => value.location)).toEqual([
      { kind: "gpr", register: "x0" },
      { kind: "gpr", register: "x1" },
    ]);
    expect(result.value.parameterLocations.at(8)?.location).toEqual({
      kind: "stackArg",
      ordinal: 0,
      offsetBytes: 0,
      sizeBytes: 8,
      alignmentBytes: 8,
    });
    expect(result.value.outgoingStackSizeBytes).toBe(16);
  });

  test("classifies HFA arguments into vector registers", () => {
    const result = classifyAArch64PublicAbiBoundary(
      {
        boundaryKey: "call:hfa",
        boundaryKind: "public-call",
        parameters: [
          {
            key: "hfa",
            kind: "aggregate",
            fields: [
              { key: "hfa.0", kind: "float", sizeBytes: 8 },
              { key: "hfa.1", kind: "float", sizeBytes: 8 },
            ],
          },
        ],
        returns: [],
      },
      authenticatedBackendTargetSurfaceForTest(),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected classification");
    expect(result.value.parameterLocations[0]?.location).toEqual({
      kind: "vectorGroup",
      registers: ["v0", "v1"],
    });
  });

  test("preserves fixed public ABI register metadata", () => {
    const result = classifyAArch64PublicAbiBoundary(
      {
        boundaryKey: "call:fixed",
        boundaryKind: "public-call",
        parameters: [
          { key: "reserved", kind: "integer", sizeBytes: 8, fixedRegister: "x3" },
          { key: "next", kind: "integer", sizeBytes: 8 },
          { key: "vector", kind: "simd", sizeBytes: 16, fixedRegister: "v2" },
          { key: "next-vector", kind: "simd", sizeBytes: 16 },
        ],
        returns: [{ key: "result", kind: "integer", sizeBytes: 8, fixedRegister: "x1" }],
      },
      authenticatedBackendTargetSurfaceForTest(),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected classification");
    expect(result.value.parameterLocations.map((assignment) => assignment.location)).toEqual([
      { kind: "gpr", register: "x3" },
      { kind: "gpr", register: "x4" },
      { kind: "vector", register: "v2" },
      { kind: "vector", register: "v3" },
    ]);
    expect(result.value.returnLocations).toEqual([
      { valueKey: "result", location: { kind: "gpr", register: "x1" } },
    ]);
  });

  test("large aggregate return uses x8 indirect result", () => {
    const result = classifyAArch64PublicAbiBoundary(
      {
        boundaryKey: "call:return",
        boundaryKind: "exported-function",
        parameters: [],
        returns: [{ key: "result", kind: "aggregate", sizeBytes: 32, alignmentBytes: 8 }],
      },
      authenticatedBackendTargetSurfaceForTest(),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected classification");
    expect(result.value.indirectResult).toEqual({ kind: "gpr", register: "x8" });
    expect(result.value.returnLocations).toEqual([]);
  });

  test("large aggregate parameters are passed indirectly through pointer slots", () => {
    const result = classifyAArch64PublicAbiBoundary(
      {
        boundaryKey: "call:large-aggregate-parameter",
        boundaryKind: "public-call",
        parameters: [
          { key: "large", kind: "aggregate", sizeBytes: 32, alignmentBytes: 16 },
          { key: "next", kind: "integer", sizeBytes: 8 },
        ],
        returns: [],
      },
      authenticatedBackendTargetSurfaceForTest(),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected classification");
    expect(result.value.parameterLocations).toEqual([
      { valueKey: "large", location: { kind: "gpr", register: "x0" } },
      { valueKey: "next", location: { kind: "gpr", register: "x1" } },
    ]);
    expect(result.value.outgoingStackSizeBytes).toBe(0);
  });

  test("excess integer returns use x8 indirect result", () => {
    const result = classifyAArch64PublicAbiBoundary(
      {
        boundaryKey: "call:many-returns",
        boundaryKind: "exported-function",
        parameters: [],
        returns: Array.from({ length: 9 }, (unusedValue, index) => ({
          key: `result${index}`,
          kind: "integer",
          sizeBytes: 8,
        })),
      },
      authenticatedBackendTargetSurfaceForTest(),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected classification");
    expect(result.value.indirectResult).toEqual({ kind: "gpr", register: "x8" });
    expect(result.value.returnLocations).toEqual([]);
  });

  test("classifies homogeneous vector aggregate returns into vector groups", () => {
    const result = classifyAArch64PublicAbiBoundary(
      {
        boundaryKey: "call:hva-return",
        boundaryKind: "exported-function",
        parameters: [],
        returns: [
          {
            key: "hva",
            kind: "aggregate",
            fields: [
              { key: "hva.0", kind: "simd", sizeBytes: 16 },
              { key: "hva.1", kind: "simd", sizeBytes: 16 },
            ],
          },
        ],
      },
      authenticatedBackendTargetSurfaceForTest(),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected classification");
    expect(result.value.indirectResult).toBeUndefined();
    expect(result.value.returnLocations[0]?.location).toEqual({
      kind: "vectorGroup",
      registers: ["v0", "v1"],
    });
  });

  test("excess vector returns use x8 indirect result", () => {
    const result = classifyAArch64PublicAbiBoundary(
      {
        boundaryKey: "call:vector-return-overflow",
        boundaryKind: "exported-function",
        parameters: [],
        returns: Array.from({ length: 9 }, (unusedValue, index) => ({
          key: `result${index}`,
          kind: "simd",
          sizeBytes: 16,
          alignmentBytes: 16,
        })),
      },
      authenticatedBackendTargetSurfaceForTest(),
    );

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("expected classification");
    expect(result.value.indirectResult).toEqual({ kind: "gpr", register: "x8" });
    expect(result.value.returnLocations).toEqual([]);
  });

  test("rejects x18 and variadic public boundaries", () => {
    const result = classifyAArch64PublicAbiBoundary(
      {
        boundaryKey: "call:bad",
        boundaryKind: "firmware-call",
        variadic: true,
        parameters: [{ key: "scratch", kind: "integer", sizeBytes: 8, fixedRegister: "x18" }],
        returns: [],
      },
      authenticatedBackendTargetSurfaceForTest(),
    );

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected ABI error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "abi:reserved-x18:call:bad:scratch",
      "abi:variadic-unsupported:call:bad",
    ]);
  });
});
