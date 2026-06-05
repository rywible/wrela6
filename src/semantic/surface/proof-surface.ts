import type { FunctionId } from "../ids";

import type { SourceSpan } from "../../frontend";

// ── CheckedProofSurface ─────────────────────────────────────

export interface CheckedRequirementExpression {
  readonly kind: "opaque";
  readonly text: string;
}

export interface CheckedRequirementSurface {
  readonly ownerFunctionId?: FunctionId;
  readonly expression: CheckedRequirementExpression;
  readonly span: SourceSpan;
}

export interface CheckedRequirementSurfaceTable {
  get(functionId: FunctionId): readonly CheckedRequirementSurface[] | undefined;
  entries(): readonly CheckedRequirementSurface[];
}

export interface CheckedTerminalSurface {
  readonly functionId: FunctionId;
  readonly span: SourceSpan;
}

export interface CheckedTerminalSurfaceTable {
  get(functionId: FunctionId): CheckedTerminalSurface | undefined;
  entries(): readonly CheckedTerminalSurface[];
}

export interface CheckedPredicateFactSurface {
  readonly functionId: FunctionId;
  readonly span: SourceSpan;
}

export interface CheckedPredicateFactSurfaceTable {
  get(functionId: FunctionId): readonly CheckedPredicateFactSurface[] | undefined;
  entries(): readonly CheckedPredicateFactSurface[];
}

export interface CheckedValidationSurface {
  readonly functionId: FunctionId;
  readonly span: SourceSpan;
}

export interface CheckedValidationSurfaceTable {
  entries(): readonly CheckedValidationSurface[];
}

export interface CheckedPrivateStateSurface {
  readonly functionId: FunctionId;
  readonly span: SourceSpan;
}

export interface CheckedPrivateStateSurfaceTable {
  entries(): readonly CheckedPrivateStateSurface[];
}

export interface CheckedImageSurface {
  readonly functionId: FunctionId;
  readonly span: SourceSpan;
}

export interface CheckedImageSurfaceTable {
  entries(): readonly CheckedImageSurface[];
}

export interface CheckedProofSurface {
  readonly resourceKindByType: ReadonlyMap<string, any>;
  readonly signatureModes: ReadonlyMap<string, any>;
  readonly requirementSurfaces: CheckedRequirementSurfaceTable;
  readonly predicateFactSurfaces: CheckedPredicateFactSurfaceTable;
  readonly terminalSurfaces: CheckedTerminalSurfaceTable;
  readonly validationSurfaces: CheckedValidationSurfaceTable;
  readonly privateStateSurfaces: CheckedPrivateStateSurfaceTable;
  readonly imageSurfaces: CheckedImageSurfaceTable;
}

// ── Builders ────────────────────────────────────────────────

function checkedRequirementSurfaceTable(
  entries: readonly CheckedRequirementSurface[],
): CheckedRequirementSurfaceTable {
  const sorted = [...entries].sort((left, right) => {
    const aId = left.ownerFunctionId ?? (0 as any);
    const bId = right.ownerFunctionId ?? (0 as any);
    return (aId as number) - (bId as number);
  });
  const byFunction = new Map<FunctionId, CheckedRequirementSurface[]>();
  for (const entry of sorted) {
    if (entry.ownerFunctionId !== undefined) {
      const list = byFunction.get(entry.ownerFunctionId) ?? [];
      list.push(entry);
      byFunction.set(entry.ownerFunctionId, list);
    }
  }
  return {
    get(functionId) {
      return byFunction.get(functionId);
    },
    entries: () => sorted,
  };
}

function checkedTerminalSurfaceTable(
  entries: readonly CheckedTerminalSurface[],
): CheckedTerminalSurfaceTable {
  const sorted = [...entries].sort(
    (left, right) => (left.functionId as number) - (right.functionId as number),
  );
  const byFunction = new Map(sorted.map((entry) => [entry.functionId, entry]));
  return {
    get(functionId) {
      return byFunction.get(functionId);
    },
    entries: () => sorted,
  };
}

function checkedPredicateFactSurfaceTable(
  entries: readonly CheckedPredicateFactSurface[],
): CheckedPredicateFactSurfaceTable {
  const sorted = [...entries].sort(
    (left, right) => (left.functionId as number) - (right.functionId as number),
  );
  const byFunction = new Map<FunctionId, CheckedPredicateFactSurface[]>();
  for (const entry of sorted) {
    const list = byFunction.get(entry.functionId) ?? [];
    list.push(entry);
    byFunction.set(entry.functionId, list);
  }
  return {
    get(functionId) {
      return byFunction.get(functionId);
    },
    entries: () => sorted,
  };
}

function emptyReadonlyTable<TableEntry>(): { entries(): readonly TableEntry[] } {
  return { entries: () => [] };
}

export function requirementSurface(input: {
  ownerFunctionId: FunctionId;
  expression: CheckedRequirementExpression;
  span: SourceSpan;
}): CheckedRequirementSurface {
  return {
    ownerFunctionId: input.ownerFunctionId,
    expression: input.expression,
    span: input.span,
  };
}

export function terminalSurface(input: {
  functionId: FunctionId;
  span: SourceSpan;
}): CheckedTerminalSurface {
  return {
    functionId: input.functionId,
    span: input.span,
  };
}

export function checkedProofSurface(input: {
  readonly requirements?: readonly CheckedRequirementSurface[];
  readonly terminalSurfaces?: readonly CheckedTerminalSurface[];
}): CheckedProofSurface {
  return {
    resourceKindByType: new Map(),
    signatureModes: new Map(),
    requirementSurfaces: checkedRequirementSurfaceTable(input.requirements ?? []),
    predicateFactSurfaces: checkedPredicateFactSurfaceTable([]),
    terminalSurfaces: checkedTerminalSurfaceTable(input.terminalSurfaces ?? []),
    validationSurfaces: emptyReadonlyTable(),
    privateStateSurfaces: emptyReadonlyTable(),
    imageSurfaces: emptyReadonlyTable(),
  };
}
