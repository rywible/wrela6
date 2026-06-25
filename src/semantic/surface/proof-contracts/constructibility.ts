import type { FunctionId, TypeId } from "../../ids";
import type { SourceSpan } from "../../../frontend";
import type { CheckedResourceKind, ConcreteResourceKind } from "../resource-kind";
import { compareCodeUnitStrings } from "../deterministic-sort";

export interface CheckedConstructibilitySurface {
  readonly typeId: TypeId;
  readonly constructorFunctionId?: FunctionId;
  readonly authorization:
    | "ordinary"
    | "sealedPlatformTokenMint"
    | "validatedBufferMint"
    | "privateStateMint"
    | "streamMint"
    | "imageCapabilityMint"
    | "edgeInternalTokenMint";
  readonly sourceOrigin: SourceSpan;
}

export interface CheckedConstructibilitySurfaceTable {
  get(typeId: TypeId): readonly CheckedConstructibilitySurface[];
  entries(): readonly CheckedConstructibilitySurface[];
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

function compareConstructibilitySurfaces(
  left: CheckedConstructibilitySurface,
  right: CheckedConstructibilitySurface,
): number {
  if (left.typeId !== right.typeId) return (left.typeId as number) - (right.typeId as number);
  const constructorCmp = compareOptionalNumber(
    left.constructorFunctionId as number | undefined,
    right.constructorFunctionId as number | undefined,
  );
  if (constructorCmp !== 0) return constructorCmp;
  const originCmp = compareSpan(left.sourceOrigin, right.sourceOrigin);
  if (originCmp !== 0) return originCmp;
  return compareCodeUnitStrings(left.authorization, right.authorization);
}

export class CheckedConstructibilitySurfaceTableBuilder {
  private readonly surfaces: CheckedConstructibilitySurface[] = [];

  add(surface: CheckedConstructibilitySurface): void {
    this.surfaces.push(surface);
  }

  build(): CheckedConstructibilitySurfaceTable {
    const sorted = [...this.surfaces].sort(compareConstructibilitySurfaces);
    const byType = new Map<TypeId, CheckedConstructibilitySurface[]>();
    for (const surface of sorted) {
      const list = byType.get(surface.typeId) ?? [];
      list.push(surface);
      byType.set(surface.typeId, list);
    }
    return {
      get: (typeId) => {
        const result = byType.get(typeId);
        return result !== undefined ? [...result] : [];
      },
      entries: () => [...sorted],
    };
  }
}

export function emptyCheckedConstructibilitySurfaceTable(): CheckedConstructibilitySurfaceTable {
  return {
    get: () => [],
    entries: () => [],
  };
}

export type CheckedConstructibilityAuthorization = CheckedConstructibilitySurface["authorization"];

export interface ConstructibilitySourceType {
  readonly typeId: TypeId;
  readonly resourceKind: CheckedResourceKind;
  readonly span: SourceSpan;
}

export interface ConstructibilityConstructorAuthority {
  readonly typeId: TypeId;
  readonly constructorFunctionId?: FunctionId;
  readonly authorization: Exclude<CheckedConstructibilityAuthorization, "ordinary">;
  readonly span: SourceSpan;
}

export interface ConstructibilityPopulationContext {
  readonly sourceTypes: readonly ConstructibilitySourceType[];
  readonly constructors: readonly ConstructibilityConstructorAuthority[];
  readonly validatedBuffers: readonly {
    readonly typeId: TypeId;
    readonly constructorFunctionId?: FunctionId;
    readonly span: SourceSpan;
  }[];
  readonly explicitSpecialAuthorities: readonly ConstructibilityConstructorAuthority[];
}

const specialConstructibilityKinds: ReadonlySet<ConcreteResourceKind> = new Set([
  "SealedPlatformToken",
  "ValidatedBuffer",
  "PrivateState",
  "Stream",
  "UniqueEdgeRoot",
  "EdgePath",
]);

function isSpecialConstructibilityKind(kind: CheckedResourceKind): boolean {
  return kind.kind === "concrete" && specialConstructibilityKinds.has(kind.value);
}

export function populateConstructibilitySurfaces(
  builder: CheckedConstructibilitySurfaceTableBuilder,
  context: ConstructibilityPopulationContext,
): void {
  for (const sourceType of context.sourceTypes) {
    if (isSpecialConstructibilityKind(sourceType.resourceKind)) continue;
    builder.add({
      typeId: sourceType.typeId,
      authorization: "ordinary",
      sourceOrigin: sourceType.span,
    });
  }

  for (const validatedBuffer of context.validatedBuffers) {
    builder.add({
      typeId: validatedBuffer.typeId,
      constructorFunctionId: validatedBuffer.constructorFunctionId,
      authorization: "validatedBufferMint",
      sourceOrigin: validatedBuffer.span,
    });
  }

  for (const authority of [...context.constructors, ...context.explicitSpecialAuthorities]) {
    builder.add({
      typeId: authority.typeId,
      constructorFunctionId: authority.constructorFunctionId,
      authorization: authority.authorization,
      sourceOrigin: authority.span,
    });
  }
}
