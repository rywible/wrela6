import type { AArch64MachineFunction } from "../machine-ir/machine-function";
import {
  runAArch64MachineIrInterpreter,
  type AArch64InterpreterDiagnostic,
  type AArch64MachineIrInterpreterResult,
} from "./machine-ir-interpreter";
import {
  aarch64MachineMemoryState,
  writeLittleEndianInteger,
  type AArch64MachineMemoryState,
} from "./machine-memory-state";

export type AArch64DifferentialOptIrFragment =
  | { readonly kind: "add" | "sub" | "const"; readonly value?: bigint }
  | {
      readonly kind: "memoryRoundTrip" | "orderedStoreLoad" | "vectorLoadStore";
      readonly address: bigint;
      readonly value: bigint;
      readonly byteWidth?: number;
      readonly effectToken: number;
      readonly trace?: readonly string[];
    }
  | {
      readonly kind: "semanticBinary";
      readonly effectToken?: number;
      readonly trace?: readonly string[];
    };

export interface AArch64DifferentialObservation {
  readonly returnValue?: bigint;
  readonly memoryBytes?: readonly number[];
  readonly effectToken?: number;
  readonly trace?: readonly string[];
}

export type AArch64MachineIrDifferentialResult =
  | { readonly kind: "equivalent"; readonly cases: number }
  | {
      readonly kind: "mismatch";
      readonly caseIndex: number;
      readonly expected: bigint | AArch64DifferentialObservation | undefined;
      readonly actual: bigint | AArch64DifferentialObservation | undefined;
      readonly trace: readonly string[];
    }
  | { readonly kind: "unsupported"; readonly diagnostic: AArch64InterpreterDiagnostic };

export function compareOptIrAndAArch64Fragment(input: {
  readonly optIr: AArch64DifferentialOptIrFragment;
  readonly machine: AArch64MachineFunction;
  readonly inputs: readonly {
    readonly values: readonly bigint[];
    readonly memory?: AArch64MachineMemoryState;
    readonly expected?: bigint | AArch64DifferentialObservation;
  }[];
  readonly interpreterOptions: { readonly maxSteps: number };
}): AArch64MachineIrDifferentialResult {
  for (const [caseIndex, testInput] of input.inputs.entries()) {
    const expectedObservation =
      observationFromExpected(testInput.expected) ??
      evaluateExpectedObservation(input.optIr, testInput.values, testInput.memory);
    const result = runAArch64MachineIrInterpreter({
      function: input.machine,
      inputs: testInput.values,
      memory: testInput.memory,
      maxSteps: input.interpreterOptions.maxSteps,
    });
    if (result.kind === "unsupported") {
      return { kind: "unsupported", diagnostic: result.diagnostic };
    }
    const actualObservation = observeMachineResult(result);
    if (!sameObservation(expectedObservation, actualObservation)) {
      const legacyReport =
        isLegacyScalarFragment(input.optIr) && typeof testInput.expected !== "object";
      return {
        kind: "mismatch",
        caseIndex,
        expected: legacyReport ? expectedObservation.returnValue : expectedObservation,
        actual: legacyReport ? actualObservation.returnValue : actualObservation,
        trace: result.trace,
      };
    }
  }
  return { kind: "equivalent", cases: input.inputs.length };
}

function evaluateExpectedObservation(
  fragment: AArch64DifferentialOptIrFragment,
  values: readonly bigint[],
  memory: AArch64MachineMemoryState | undefined,
): AArch64DifferentialObservation {
  switch (fragment.kind) {
    case "add":
      return { returnValue: (values[0] ?? 0n) + (values[1] ?? 0n) };
    case "sub":
      return { returnValue: (values[0] ?? 0n) - (values[1] ?? 0n) };
    case "const":
      return { returnValue: fragment.value ?? 0n };
    case "memoryRoundTrip":
    case "orderedStoreLoad":
    case "vectorLoadStore":
      return {
        returnValue: fragment.value,
        memoryBytes: writeLittleEndianInteger(
          memory ?? aarch64MachineMemoryState(),
          fragment.address,
          fragment.byteWidth ?? 8,
          fragment.value,
        ).bytes,
        effectToken: fragment.effectToken,
        ...(fragment.trace === undefined ? {} : { trace: fragment.trace }),
      };
    case "semanticBinary":
      return {
        effectToken: fragment.effectToken ?? 0,
        ...(fragment.trace === undefined ? {} : { trace: fragment.trace }),
      };
  }
}

function observationFromExpected(
  expected: bigint | AArch64DifferentialObservation | undefined,
): AArch64DifferentialObservation | undefined {
  if (expected === undefined) {
    return undefined;
  }
  return typeof expected === "bigint" ? { returnValue: expected } : expected;
}

function observeMachineResult(
  result: Exclude<AArch64MachineIrInterpreterResult, { readonly kind: "unsupported" }>,
): AArch64DifferentialObservation {
  return {
    ...(result.kind === "returned" && result.returnValue !== undefined
      ? { returnValue: result.returnValue }
      : {}),
    memoryBytes: result.memoryBytes,
    effectToken: result.effects.nextToken,
    trace: result.trace,
  };
}

function sameObservation(
  expected: AArch64DifferentialObservation,
  actual: AArch64DifferentialObservation,
): boolean {
  if (expected.returnValue !== undefined && expected.returnValue !== actual.returnValue) {
    return false;
  }
  if (expected.effectToken !== undefined && expected.effectToken !== actual.effectToken) {
    return false;
  }
  if (
    expected.memoryBytes !== undefined &&
    !sameNumberList(expected.memoryBytes, actual.memoryBytes ?? [])
  ) {
    return false;
  }
  if (expected.trace !== undefined && !sameStringList(expected.trace, actual.trace ?? [])) {
    return false;
  }
  return true;
}

function sameNumberList(left: readonly number[], right: readonly number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function sameStringList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isLegacyScalarFragment(fragment: AArch64DifferentialOptIrFragment): boolean {
  return fragment.kind === "add" || fragment.kind === "sub" || fragment.kind === "const";
}
