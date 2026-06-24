import type { FunctionId, TypeId } from "../../ids";
import type { SourceSpan } from "../../../frontend";
import type { CheckedType } from "../type-model";
import type { CheckedResourceKind } from "../resource-kind";
import { compareCodeUnitStrings } from "../deterministic-sort";

export type CheckedTakeModeSurface =
  | {
      readonly kind: "stream";
      readonly producerFunctionId: FunctionId;
      readonly itemType: CheckedType;
      readonly itemResourceKind: CheckedResourceKind;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "buffer";
      readonly sourceTypeId: TypeId;
      readonly bufferResourceKind: CheckedResourceKind;
      readonly span: SourceSpan;
    }
  | {
      readonly kind: "validatedBuffer";
      readonly validatedBufferTypeId: TypeId;
      readonly span: SourceSpan;
    };

export interface CheckedTakeModeSurfaceTable {
  entries(): readonly CheckedTakeModeSurface[];
}

function compareSpan(left: SourceSpan, right: SourceSpan): number {
  if (left.start !== right.start) return left.start - right.start;
  return left.end - right.end;
}

function takeSurfaceId(surface: CheckedTakeModeSurface): number {
  switch (surface.kind) {
    case "stream":
      return surface.producerFunctionId as number;
    case "buffer":
      return surface.sourceTypeId as number;
    case "validatedBuffer":
      return surface.validatedBufferTypeId as number;
  }
}

function compareTakeModeSurfaces(
  left: CheckedTakeModeSurface,
  right: CheckedTakeModeSurface,
): number {
  const kindCmp = compareCodeUnitStrings(left.kind, right.kind);
  if (kindCmp !== 0) return kindCmp;
  const idCmp = takeSurfaceId(left) - takeSurfaceId(right);
  if (idCmp !== 0) return idCmp;
  return compareSpan(left.span, right.span);
}

export class CheckedTakeModeSurfaceTableBuilder {
  private readonly surfaces: CheckedTakeModeSurface[] = [];

  add(surface: CheckedTakeModeSurface): void {
    this.surfaces.push(surface);
  }

  build(): CheckedTakeModeSurfaceTable {
    const sorted = [...this.surfaces].sort(compareTakeModeSurfaces);
    return {
      entries: () => [...sorted],
    };
  }
}

export function emptyCheckedTakeModeSurfaceTable(): CheckedTakeModeSurfaceTable {
  return {
    entries: () => [],
  };
}
