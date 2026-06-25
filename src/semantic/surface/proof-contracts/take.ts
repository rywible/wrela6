import type { FunctionId, TypeId } from "../../ids";
import type { SourceSpan } from "../../../frontend";
import type { CheckedType } from "../type-model";
import type { CheckedResourceKind, ConcreteResourceKind } from "../resource-kind";
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

// ── Take-mode population ─────────────────────────────────────

export interface TakeModeStreamProducer {
  readonly producerFunctionId: FunctionId;
  readonly itemType: CheckedType;
  readonly itemResourceKind: CheckedResourceKind;
  readonly takeOnlyStream: boolean;
  readonly span: SourceSpan;
}

export interface TakeModeBufferSource {
  readonly sourceTypeId: TypeId;
  readonly bufferResourceKind: CheckedResourceKind;
  readonly bufferObligation: boolean;
  readonly span: SourceSpan;
}

export interface TakeModeValidatedBufferDeclaration {
  readonly validatedBufferTypeId: TypeId;
  readonly span: SourceSpan;
}

export interface TakeModePopulationContext {
  readonly streamProducers: readonly TakeModeStreamProducer[];
  readonly bufferSources: readonly TakeModeBufferSource[];
  readonly validatedBuffers: readonly TakeModeValidatedBufferDeclaration[];
}

const bufferObligationKinds: ReadonlySet<ConcreteResourceKind> = new Set([
  "Affine",
  "Linear",
  "EdgePath",
  "SealedPlatformToken",
]);

function isBufferObligationKind(kind: CheckedResourceKind): boolean {
  return kind.kind === "concrete" && bufferObligationKinds.has(kind.value);
}

export function populateTakeModeSurfaces(
  builder: CheckedTakeModeSurfaceTableBuilder,
  context: TakeModePopulationContext,
): void {
  for (const producer of context.streamProducers) {
    if (!producer.takeOnlyStream) continue;
    builder.add({
      kind: "stream",
      producerFunctionId: producer.producerFunctionId,
      itemType: producer.itemType,
      itemResourceKind: producer.itemResourceKind,
      span: producer.span,
    });
  }
  for (const source of context.bufferSources) {
    if (!source.bufferObligation) continue;
    if (!isBufferObligationKind(source.bufferResourceKind)) continue;
    builder.add({
      kind: "buffer",
      sourceTypeId: source.sourceTypeId,
      bufferResourceKind: source.bufferResourceKind,
      span: source.span,
    });
  }
  for (const validatedBuffer of context.validatedBuffers) {
    builder.add({
      kind: "validatedBuffer",
      validatedBufferTypeId: validatedBuffer.validatedBufferTypeId,
      span: validatedBuffer.span,
    });
  }
}
