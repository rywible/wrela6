import { describe, expect, test } from "bun:test";
import { compareOptIrAndAArch64Fragment } from "../../../../src/target/aarch64/interpreter/machine-ir-differential";
import {
  aarch64AddFragmentForTest,
  memoryRoundTripFunctionForTest,
  optIrAddFragmentForTest,
  orderedStoreLoadFunctionForTest,
  semanticBinaryFunctionForTest,
  unsupportedMachineFragmentForTest,
  vectorLoadStoreFunctionForTest,
} from "../../../support/target/aarch64/interpreter/machine-ir-interpreter-fixtures";

describe("AArch64 machine IR differential seed", () => {
  test("reports scalar add equivalence", () => {
    const result = compareOptIrAndAArch64Fragment({
      optIr: optIrAddFragmentForTest(),
      machine: aarch64AddFragmentForTest(),
      inputs: [{ values: [1n, 2n] }, { values: [10n, 20n] }],
      interpreterOptions: { maxSteps: 32 },
    });

    expect(result).toEqual({ kind: "equivalent", cases: 2 });
  });

  test("reports deterministic mismatches", () => {
    const result = compareOptIrAndAArch64Fragment({
      optIr: optIrAddFragmentForTest(),
      machine: aarch64AddFragmentForTest(),
      inputs: [{ values: [4n, 5n], expected: 10n }],
      interpreterOptions: { maxSteps: 32 },
    });

    expect(result).toEqual({
      kind: "mismatch",
      caseIndex: 0,
      expected: 10n,
      actual: 9n,
      trace: ["add-shifted-register", "ret"],
    });
  });

  test("reports deterministic mismatches for completed constant materialization opcodes", () => {
    const result = compareOptIrAndAArch64Fragment({
      optIr: optIrAddFragmentForTest(),
      machine: unsupportedMachineFragmentForTest(),
      inputs: [{ values: [1n, 2n] }],
      interpreterOptions: { maxSteps: 32 },
    });

    expect(result).toEqual({
      kind: "mismatch",
      caseIndex: 0,
      expected: 3n,
      actual: 18446744073709551614n,
      trace: ["movn", "ret"],
    });
  });

  test("compares memory round-trip return value, memory bytes, and effect token", () => {
    const result = compareOptIrAndAArch64Fragment({
      optIr: {
        kind: "memoryRoundTrip",
        address: 40n,
        value: 0x1234n,
        effectToken: 2,
        trace: ["movz", "movz", "str-unsigned-immediate", "ldr-unsigned-immediate", "ret"],
      },
      machine: memoryRoundTripFunctionForTest(),
      inputs: [{ values: [] }],
      interpreterOptions: { maxSteps: 32 },
    });

    expect(result).toEqual({ kind: "equivalent", cases: 1 });
  });

  test("compares acquire-release ordered store/load traces and effect token", () => {
    const result = compareOptIrAndAArch64Fragment({
      optIr: {
        kind: "orderedStoreLoad",
        address: 16n,
        value: 0x55aan,
        effectToken: 3,
        trace: ["movz", "movz", "stlr", "dmb", "ldar", "ret"],
      },
      machine: orderedStoreLoadFunctionForTest(),
      inputs: [{ values: [] }],
      interpreterOptions: { maxSteps: 32 },
    });

    expect(result).toEqual({ kind: "equivalent", cases: 1 });
  });

  test("compares vector load/store memory observations", () => {
    const result = compareOptIrAndAArch64Fragment({
      optIr: {
        kind: "vectorLoadStore",
        address: 24n,
        value: 0xaa55n,
        byteWidth: 16,
        effectToken: 2,
        trace: ["movz", "movi", "st1", "ld1", "ret"],
      },
      machine: vectorLoadStoreFunctionForTest(),
      inputs: [{ values: [] }],
      interpreterOptions: { maxSteps: 32 },
    });

    expect(result).toEqual({ kind: "equivalent", cases: 1 });
  });

  test("does not claim semantic pseudo-op equivalence without faithful interpreter semantics", () => {
    const result = compareOptIrAndAArch64Fragment({
      optIr: {
        kind: "semanticBinary",
        effectToken: 0,
        trace: ["crc32", "ret"],
      },
      machine: semanticBinaryFunctionForTest("crc32"),
      inputs: [{ values: [0x12n, 0x34n] }],
      interpreterOptions: { maxSteps: 32 },
    });

    expect(result).toEqual({
      kind: "unsupported",
      diagnostic: {
        code: "aarch64.interpreter.unsupported-opcode",
        message: "Unsupported AArch64 interpreter opcode: crc32.",
        opcode: "crc32",
      },
    });
  });
});
