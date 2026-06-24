import type { FunctionId, ParameterId, TypeId } from "../../ids";
import type { SourceSpan } from "../../../frontend";
import type { CheckedType } from "../type-model";
import { compareCodeUnitStrings } from "../deterministic-sort";

export type CheckedAttemptInputPosition =
  | { readonly kind: "receiver" }
  | { readonly kind: "parameter"; readonly parameterId: ParameterId };

export interface CheckedAttemptContractSurface {
  readonly fallibleFunctionId: FunctionId;
  readonly resultType: CheckedType;
  readonly okType: CheckedType;
  readonly errType: CheckedType;
  readonly inputs: readonly CheckedAttemptInputPosition[];
  readonly span: SourceSpan;
}

export interface CheckedValidationContractSurface {
  readonly validatedBufferTypeId: TypeId;
  readonly resultType: CheckedType;
  readonly sourceType: CheckedType;
  readonly okPayloadType: CheckedType;
  readonly errPayloadType: CheckedType;
  readonly sourceParameterId?: ParameterId;
  readonly span: SourceSpan;
}

export interface CheckedAttemptContractSurfaceTable {
  get(functionId: FunctionId): readonly CheckedAttemptContractSurface[];
  entries(): readonly CheckedAttemptContractSurface[];
}

export interface CheckedValidationContractSurfaceTable {
  entries(): readonly CheckedValidationContractSurface[];
}

function compareOptionalNumber(left: number | undefined, right: number | undefined): number {
  if (left === right) return 0;
  if (left === undefined) return -1;
  if (right === undefined) return 1;
  return left - right;
}

function compareSpan(left: SourceSpan, right: SourceSpan): number {
  if (left.start !== right.start) return left.start - right.start;
  return left.end - right.end;
}

function attemptInputKey(position: CheckedAttemptInputPosition): string {
  return position.kind === "receiver" ? "receiver" : `parameter:${position.parameterId}`;
}

function compareAttemptContractSurfaces(
  left: CheckedAttemptContractSurface,
  right: CheckedAttemptContractSurface,
): number {
  if (left.fallibleFunctionId !== right.fallibleFunctionId) {
    return (left.fallibleFunctionId as number) - (right.fallibleFunctionId as number);
  }
  const spanCmp = compareSpan(left.span, right.span);
  if (spanCmp !== 0) return spanCmp;
  const leftInputs = left.inputs.map(attemptInputKey).join(",");
  const rightInputs = right.inputs.map(attemptInputKey).join(",");
  return compareCodeUnitStrings(leftInputs, rightInputs);
}

function compareValidationContractSurfaces(
  left: CheckedValidationContractSurface,
  right: CheckedValidationContractSurface,
): number {
  if (left.validatedBufferTypeId !== right.validatedBufferTypeId) {
    return (left.validatedBufferTypeId as number) - (right.validatedBufferTypeId as number);
  }
  const parameterCmp = compareOptionalNumber(
    left.sourceParameterId as number | undefined,
    right.sourceParameterId as number | undefined,
  );
  if (parameterCmp !== 0) return parameterCmp;
  return compareSpan(left.span, right.span);
}

export class CheckedAttemptContractSurfaceTableBuilder {
  private readonly surfaces: CheckedAttemptContractSurface[] = [];

  add(surface: CheckedAttemptContractSurface): void {
    this.surfaces.push(surface);
  }

  build(): CheckedAttemptContractSurfaceTable {
    const sorted = [...this.surfaces].sort(compareAttemptContractSurfaces);
    const byFunction = new Map<FunctionId, CheckedAttemptContractSurface[]>();
    for (const surface of sorted) {
      const list = byFunction.get(surface.fallibleFunctionId) ?? [];
      list.push(surface);
      byFunction.set(surface.fallibleFunctionId, list);
    }
    return {
      get: (functionId) => {
        const result = byFunction.get(functionId);
        return result !== undefined ? [...result] : [];
      },
      entries: () => [...sorted],
    };
  }
}

export function emptyCheckedAttemptContractSurfaceTable(): CheckedAttemptContractSurfaceTable {
  return {
    get: () => [],
    entries: () => [],
  };
}

export class CheckedValidationContractSurfaceTableBuilder {
  private readonly surfaces: CheckedValidationContractSurface[] = [];

  add(surface: CheckedValidationContractSurface): void {
    this.surfaces.push(surface);
  }

  build(): CheckedValidationContractSurfaceTable {
    const sorted = [...this.surfaces].sort(compareValidationContractSurfaces);
    return {
      entries: () => [...sorted],
    };
  }
}

export function emptyCheckedValidationContractSurfaceTable(): CheckedValidationContractSurfaceTable {
  return {
    entries: () => [],
  };
}
