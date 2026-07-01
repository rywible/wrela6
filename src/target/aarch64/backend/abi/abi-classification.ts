import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import type { AArch64BackendTargetSurface } from "../api/backend-target-surface";

export type AArch64MachineAbiBoundaryKind =
  | "public-call"
  | "firmware-call"
  | "exported-function"
  | "address-taken-function"
  | "replacement-boundary"
  | "uncertain";

export interface AArch64MachineAbiValue {
  readonly key: string;
  readonly kind:
    | "integer"
    | "pointer"
    | "bool"
    | "enum"
    | "capability"
    | "float"
    | "simd"
    | "aggregate"
    | "scalable-vector";
  readonly sizeBytes?: number;
  readonly alignmentBytes?: number;
  readonly fixedRegister?: string;
  readonly fields?: readonly AArch64MachineAbiValue[];
}

export interface AArch64PublicAbiBoundary {
  readonly boundaryKey: string;
  readonly boundaryKind: AArch64MachineAbiBoundaryKind;
  readonly parameters: readonly AArch64MachineAbiValue[];
  readonly returns: readonly AArch64MachineAbiValue[];
  readonly variadic?: boolean;
}

export type AArch64AbiLocation =
  | { readonly kind: "gpr"; readonly register: string }
  | { readonly kind: "vector"; readonly register: string }
  | { readonly kind: "vectorGroup"; readonly registers: readonly string[] }
  | {
      readonly kind: "stackArg";
      readonly ordinal: number;
      readonly offsetBytes: number;
      readonly sizeBytes: number;
      readonly alignmentBytes: number;
    };

export interface AArch64AbiLocationAssignment {
  readonly valueKey: string;
  readonly location: AArch64AbiLocation;
  readonly groupKey?: string;
}

export interface AArch64PublicAbiClassification {
  readonly boundaryKey: string;
  readonly boundaryKind: AArch64MachineAbiBoundaryKind;
  readonly parameterLocations: readonly AArch64AbiLocationAssignment[];
  readonly returnLocations: readonly AArch64AbiLocationAssignment[];
  readonly indirectResult?: { readonly kind: "gpr"; readonly register: "x8" };
  readonly clobberedGprs: readonly string[];
  readonly clobberedVectorRegisters: readonly string[];
  readonly outgoingStackSizeBytes: number;
  readonly outgoingStackAlignmentBytes: 16;
}

export function classifyAArch64PublicAbiBoundary(
  boundary: AArch64PublicAbiBoundary,
  targetSurface: AArch64BackendTargetSurface,
): AArch64BackendResult<AArch64PublicAbiClassification> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  if (boundary.variadic === true)
    diagnostics.push(diagnostic(`abi:variadic-unsupported:${boundary.boundaryKey}`));
  for (const value of boundary.parameters) {
    const fixedRegisterDiagnostic = validateFixedRegister(value, boundary.boundaryKey);
    if (fixedRegisterDiagnostic !== undefined) diagnostics.push(fixedRegisterDiagnostic);
    if (value.kind === "scalable-vector")
      diagnostics.push(
        diagnostic(`abi:scalable-vector-unsupported:${boundary.boundaryKey}:${value.key}`),
      );
  }
  for (const value of boundary.returns) {
    const fixedRegisterDiagnostic = validateFixedRegister(value, boundary.boundaryKey);
    if (fixedRegisterDiagnostic !== undefined) diagnostics.push(fixedRegisterDiagnostic);
    if (value.kind === "scalable-vector")
      diagnostics.push(
        diagnostic(`abi:scalable-vector-unsupported:${boundary.boundaryKey}:${value.key}`),
      );
  }
  if (diagnostics.length > 0) return backendError(diagnostics);

  const parameterCursor = cursor();
  const parameterLocations = boundary.parameters.flatMap((value) =>
    assignParameter(value, parameterCursor),
  );
  const returnCursor = cursor();
  let indirectResult: { readonly kind: "gpr"; readonly register: "x8" } | undefined;
  const assignedReturnLocations = assignPublicReturns(boundary.returns, returnCursor);
  const returnLocations: readonly AArch64AbiLocationAssignment[] =
    assignedReturnLocations ?? Object.freeze([]);
  if (assignedReturnLocations === undefined) {
    indirectResult = { kind: "gpr", register: "x8" };
  }

  return backendOk(
    Object.freeze({
      boundaryKey: boundary.boundaryKey,
      boundaryKind: boundary.boundaryKind,
      parameterLocations: Object.freeze(parameterLocations),
      returnLocations,
      ...(indirectResult === undefined ? {} : { indirectResult }),
      clobberedGprs: Object.freeze(
        [...targetSurface.registerModel.publicCallerSavedGprs].sort(compareCodeUnitStrings),
      ),
      clobberedVectorRegisters: Object.freeze(range("v", 0, 7)),
      outgoingStackSizeBytes: align(parameterCursor.nextStackOffset, 16),
      outgoingStackAlignmentBytes: 16,
    }),
  );
}

function assignParameter(
  value: AArch64MachineAbiValue,
  state: Cursor,
): readonly AArch64AbiLocationAssignment[] {
  const fixedRegister = assignFixedRegister(value, state);
  if (fixedRegister !== undefined) return [fixedRegister];
  const vectorAggregate = homogeneousRegisterAggregate(value);
  if (vectorAggregate !== undefined && state.nextVector + vectorAggregate.memberCount <= 8) {
    const registers = range(
      "v",
      state.nextVector,
      state.nextVector + vectorAggregate.memberCount - 1,
    );
    state.nextVector += vectorAggregate.memberCount;
    return [{ valueKey: value.key, location: { kind: "vectorGroup", registers } }];
  }
  if (usesIndirectParameterPointer(value)) {
    return [assignIndirectParameterPointer(value, state)];
  }
  if (value.kind === "float" || value.kind === "simd") {
    const register = nextVectorRegister(state);
    if (register !== undefined)
      return [{ valueKey: value.key, location: { kind: "vector", register } }];
  } else if (slotsFor(value) === 1) {
    const register = nextGprRegister(state);
    if (register !== undefined)
      return [{ valueKey: value.key, location: { kind: "gpr", register } }];
  } else if (slotsFor(value) === 2 && state.nextGpr <= 6) {
    const first = nextAlignedGprPair(state);
    if (first === undefined) return [stackLocation(value, state)];
    return [
      {
        valueKey: `${value.key}:lo`,
        groupKey: value.key,
        location: { kind: "gpr", register: `x${first}` },
      },
      {
        valueKey: `${value.key}:hi`,
        groupKey: value.key,
        location: { kind: "gpr", register: `x${first + 1}` },
      },
    ];
  }
  return [stackLocation(value, state)];
}

function usesIndirectParameterPointer(value: AArch64MachineAbiValue): boolean {
  return value.kind === "aggregate" && slotsFor(value) > 2;
}

function assignIndirectParameterPointer(
  value: AArch64MachineAbiValue,
  state: Cursor,
): AArch64AbiLocationAssignment {
  const register = nextGprRegister(state);
  if (register !== undefined) {
    return { valueKey: value.key, location: { kind: "gpr", register } };
  }
  return stackLocation(pointerSizedValue(value), state);
}

function pointerSizedValue(value: AArch64MachineAbiValue): AArch64MachineAbiValue {
  return Object.freeze({
    key: value.key,
    kind: "pointer",
    sizeBytes: 8,
    alignmentBytes: 8,
  });
}

function assignPublicReturns(
  returns: readonly AArch64MachineAbiValue[],
  state: Cursor,
): readonly AArch64AbiLocationAssignment[] | undefined {
  const assignments: AArch64AbiLocationAssignment[] = [];
  for (const value of returns) {
    const valueAssignments = assignRegisterReturn(value, state);
    if (valueAssignments === undefined) return undefined;
    assignments.push(...valueAssignments);
  }
  return Object.freeze(assignments);
}

function assignRegisterReturn(
  value: AArch64MachineAbiValue,
  state: Cursor,
): readonly AArch64AbiLocationAssignment[] | undefined {
  const fixedRegister = assignFixedRegister(value, state);
  if (fixedRegister !== undefined) return [fixedRegister];
  const vectorAggregate = homogeneousRegisterAggregate(value);
  if (vectorAggregate !== undefined && state.nextVector + vectorAggregate.memberCount <= 8) {
    const registers = range(
      "v",
      state.nextVector,
      state.nextVector + vectorAggregate.memberCount - 1,
    );
    state.nextVector += vectorAggregate.memberCount;
    return [{ valueKey: value.key, location: { kind: "vectorGroup", registers } }];
  }
  if (value.kind === "float" || value.kind === "simd") {
    const register = nextVectorRegister(state);
    if (register !== undefined)
      return [{ valueKey: value.key, location: { kind: "vector", register } }];
    return undefined;
  }
  const slots = slotsFor(value);
  if (slots === 1) {
    const register = nextGprRegister(state);
    if (register !== undefined)
      return [{ valueKey: value.key, location: { kind: "gpr", register } }];
  }
  if (slots === 2 && state.nextGpr <= 6) {
    const first = nextAlignedGprPair(state);
    if (first === undefined) return undefined;
    return [
      {
        valueKey: `${value.key}:0`,
        groupKey: value.key,
        location: { kind: "gpr", register: `x${first}` },
      },
      {
        valueKey: `${value.key}:1`,
        groupKey: value.key,
        location: { kind: "gpr", register: `x${first + 1}` },
      },
    ];
  }
  return undefined;
}

function validateFixedRegister(
  value: AArch64MachineAbiValue,
  boundaryKey: string,
): AArch64BackendDiagnostic | undefined {
  const fixedRegister = parseFixedRegister(value.fixedRegister);
  if (fixedRegister === undefined) return undefined;
  if (fixedRegister.kind === "gpr" && fixedRegister.index === 18) {
    return diagnostic(`abi:reserved-x18:${boundaryKey}:${value.key}`);
  }
  if (fixedRegister.index < 0 || fixedRegister.index > 7) {
    return diagnostic(
      `abi:fixed-register-unsupported:${boundaryKey}:${value.key}:${fixedRegister.register}`,
    );
  }
  if (fixedRegister.kind === "vector" && value.kind !== "float" && value.kind !== "simd") {
    return diagnostic(
      `abi:fixed-register-kind-mismatch:${boundaryKey}:${value.key}:${fixedRegister.register}`,
    );
  }
  if (fixedRegister.kind === "gpr" && (value.kind === "float" || value.kind === "simd")) {
    return diagnostic(
      `abi:fixed-register-kind-mismatch:${boundaryKey}:${value.key}:${fixedRegister.register}`,
    );
  }
  return undefined;
}

function assignFixedRegister(
  value: AArch64MachineAbiValue,
  state: Cursor,
): AArch64AbiLocationAssignment | undefined {
  const fixedRegister = parseFixedRegister(value.fixedRegister);
  if (fixedRegister === undefined) return undefined;
  if (fixedRegister.kind === "gpr") {
    state.usedGprs.add(fixedRegister.index);
    state.nextGpr = Math.max(state.nextGpr, fixedRegister.index + 1);
    return {
      valueKey: value.key,
      location: { kind: "gpr", register: fixedRegister.register },
    };
  }
  state.usedVectors.add(fixedRegister.index);
  state.nextVector = Math.max(state.nextVector, fixedRegister.index + 1);
  return {
    valueKey: value.key,
    location: { kind: "vector", register: fixedRegister.register },
  };
}

function parseFixedRegister(
  register: string | undefined,
):
  | { readonly kind: "gpr"; readonly register: string; readonly index: number }
  | { readonly kind: "vector"; readonly register: string; readonly index: number }
  | undefined {
  if (register === undefined) return undefined;
  const gpr = /^x(\d+)$/.exec(register);
  if (gpr?.[1] !== undefined) return { kind: "gpr", register, index: Number(gpr[1]) };
  const vector = /^v(\d+)$/.exec(register);
  if (vector?.[1] !== undefined) return { kind: "vector", register, index: Number(vector[1]) };
  return undefined;
}

function nextGprRegister(state: Cursor): string | undefined {
  while (state.nextGpr < 8 && state.usedGprs.has(state.nextGpr)) state.nextGpr += 1;
  if (state.nextGpr >= 8) return undefined;
  const register = `x${state.nextGpr}`;
  state.usedGprs.add(state.nextGpr);
  state.nextGpr += 1;
  return register;
}

function nextVectorRegister(state: Cursor): string | undefined {
  while (state.nextVector < 8 && state.usedVectors.has(state.nextVector)) state.nextVector += 1;
  if (state.nextVector >= 8) return undefined;
  const register = `v${state.nextVector}`;
  state.usedVectors.add(state.nextVector);
  state.nextVector += 1;
  return register;
}

function nextAlignedGprPair(state: Cursor): number | undefined {
  if (state.nextGpr % 2 !== 0) state.nextGpr += 1;
  while (
    state.nextGpr <= 6 &&
    (state.usedGprs.has(state.nextGpr) || state.usedGprs.has(state.nextGpr + 1))
  ) {
    state.nextGpr += 2;
  }
  if (state.nextGpr > 6) return undefined;
  const first = state.nextGpr;
  state.usedGprs.add(first);
  state.usedGprs.add(first + 1);
  state.nextGpr += 2;
  return first;
}

function stackLocation(value: AArch64MachineAbiValue, state: Cursor): AArch64AbiLocationAssignment {
  const alignmentBytes = Math.max(8, value.alignmentBytes ?? 8);
  state.nextStackOffset = align(state.nextStackOffset, alignmentBytes);
  const sizeBytes = align(value.sizeBytes ?? 8, 8);
  const location = {
    kind: "stackArg" as const,
    ordinal: state.stackOrdinal++,
    offsetBytes: state.nextStackOffset,
    sizeBytes,
    alignmentBytes,
  };
  state.nextStackOffset += sizeBytes;
  return { valueKey: value.key, location };
}

function slotsFor(value: AArch64MachineAbiValue): number {
  return Math.max(1, Math.ceil((value.sizeBytes ?? aggregateSize(value)) / 8));
}

function homogeneousRegisterAggregate(
  value: AArch64MachineAbiValue,
): { readonly memberCount: number } | undefined {
  if (
    value.kind !== "aggregate" ||
    value.fields === undefined ||
    value.fields.length < 1 ||
    value.fields.length > 4
  )
    return undefined;
  const firstField = value.fields[0];
  if (firstField === undefined || (firstField.kind !== "float" && firstField.kind !== "simd")) {
    return undefined;
  }
  return value.fields.every(
    (field) => field.kind === firstField.kind && field.sizeBytes === firstField.sizeBytes,
  )
    ? { memberCount: value.fields.length }
    : undefined;
}

function aggregateSize(value: AArch64MachineAbiValue): number {
  return value.fields?.reduce((total, field) => total + (field.sizeBytes ?? 8), 0) ?? 8;
}

function cursor(): Cursor {
  return {
    nextGpr: 0,
    nextVector: 0,
    nextStackOffset: 0,
    stackOrdinal: 0,
    usedGprs: new Set(),
    usedVectors: new Set(),
  };
}

interface Cursor {
  nextGpr: number;
  nextVector: number;
  nextStackOffset: number;
  stackOrdinal: number;
  usedGprs: Set<number>;
  usedVectors: Set<number>;
}

function align(value: number, alignment: number): number {
  return Math.ceil(value / alignment) * alignment;
}

function range(prefix: string, first: number, last: number): readonly string[] {
  return Object.freeze(
    Array.from({ length: last - first + 1 }, (unusedValue, index) => `${prefix}${first + index}`),
  );
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_ABI_INVALID",
    ownerKey: "abi-classification",
    rootCauseKey: stableDetail,
    stableDetail,
  });
}
