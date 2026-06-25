import type {
  FunctionId,
  ModuleId,
  ParameterId,
  PlatformContractId,
  PlatformPrimitiveId,
  TargetId,
} from "../../ids";
import type { SourceSpan } from "../../../frontend";
import { compareCodeUnitStrings } from "../deterministic-sort";

export interface CheckedPrivateTransitionSurface {
  readonly functionId: FunctionId;
  readonly kind: "predicate" | "advance" | "close" | "unknown";
  readonly receiverParameterId?: ParameterId;
  readonly span: SourceSpan;
}

export interface CheckedPrivateTransitionSurfaceTable {
  get(functionId: FunctionId): readonly CheckedPrivateTransitionSurface[];
  entries(): readonly CheckedPrivateTransitionSurface[];
}

export type CheckedPlatformEnsuredFact =
  | {
      readonly kind: "predicate";
      readonly predicateFunctionId: FunctionId;
      readonly argumentBindings: readonly CheckedPlatformFactArgument[];
    }
  | {
      readonly kind: "state";
      readonly stateKind: "advanced" | "closed" | "available";
      readonly argumentBindings: readonly CheckedPlatformFactArgument[];
    };

export interface CheckedPlatformFactArgument {
  readonly kind: "receiver" | "parameter" | "constant";
  readonly parameterId?: ParameterId;
  readonly placeKey?: string;
  readonly expressionText?: string;
}

export interface CheckedPlatformEnsuredFactSurface {
  readonly sourceFunctionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
  readonly fingerprint: string;
  readonly fact: CheckedPlatformEnsuredFact;
}

export interface CheckedPlatformEnsuredFactSurfaceTable {
  getByFunction(functionId: FunctionId): readonly CheckedPlatformEnsuredFactSurface[];
  getByBinding(input: {
    readonly sourceFunctionId: FunctionId;
    readonly primitiveId: PlatformPrimitiveId;
    readonly contractId: PlatformContractId;
    readonly targetId: TargetId;
  }): readonly CheckedPlatformEnsuredFactSurface[];
  entries(): readonly CheckedPlatformEnsuredFactSurface[];
}

export interface CheckedMatchRefinementSurface {
  readonly matchStatementKey: string;
  readonly scrutineeKey: string;
  readonly variantReferenceKey: string;
  readonly fieldBindingKeys: readonly string[];
  readonly span: SourceSpan;
}

export interface CheckedMatchRefinementSurfaceTable {
  entries(): readonly CheckedMatchRefinementSurface[];
}

export function matchRefinementMatchKey(input: {
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
}): string {
  return `module:${input.moduleId}:match:${input.span.start}:${input.span.end}`;
}

export function matchRefinementScrutineeKey(input: {
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
}): string {
  return `module:${input.moduleId}:scrutinee:${input.span.start}:${input.span.end}`;
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

function comparePrivateTransitionSurfaces(
  left: CheckedPrivateTransitionSurface,
  right: CheckedPrivateTransitionSurface,
): number {
  if (left.functionId !== right.functionId) {
    return (left.functionId as number) - (right.functionId as number);
  }
  const kindCmp = compareCodeUnitStrings(left.kind, right.kind);
  if (kindCmp !== 0) return kindCmp;
  const receiverCmp = compareOptionalNumber(
    left.receiverParameterId as number | undefined,
    right.receiverParameterId as number | undefined,
  );
  if (receiverCmp !== 0) return receiverCmp;
  return compareSpan(left.span, right.span);
}

function comparePlatformEnsuredFactSurfaces(
  left: CheckedPlatformEnsuredFactSurface,
  right: CheckedPlatformEnsuredFactSurface,
): number {
  if (left.sourceFunctionId !== right.sourceFunctionId) {
    return (left.sourceFunctionId as number) - (right.sourceFunctionId as number);
  }
  const primitiveCmp = compareCodeUnitStrings(left.primitiveId, right.primitiveId);
  if (primitiveCmp !== 0) return primitiveCmp;
  const contractCmp = compareCodeUnitStrings(left.contractId, right.contractId);
  if (contractCmp !== 0) return contractCmp;
  const targetCmp = compareCodeUnitStrings(left.targetId, right.targetId);
  if (targetCmp !== 0) return targetCmp;
  return compareCodeUnitStrings(left.fingerprint, right.fingerprint);
}

function platformEnsuredFactBindingKey(input: {
  readonly sourceFunctionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
}): string {
  return `${input.sourceFunctionId}:${input.primitiveId}:${input.contractId}:${input.targetId}`;
}

function compareMatchRefinementSurfaces(
  left: CheckedMatchRefinementSurface,
  right: CheckedMatchRefinementSurface,
): number {
  const matchCmp = compareCodeUnitStrings(left.matchStatementKey, right.matchStatementKey);
  if (matchCmp !== 0) return matchCmp;
  const scrutineeCmp = compareCodeUnitStrings(left.scrutineeKey, right.scrutineeKey);
  if (scrutineeCmp !== 0) return scrutineeCmp;
  const variantCmp = compareCodeUnitStrings(left.variantReferenceKey, right.variantReferenceKey);
  if (variantCmp !== 0) return variantCmp;
  return compareSpan(left.span, right.span);
}

export class CheckedPrivateTransitionSurfaceTableBuilder {
  private readonly surfaces: CheckedPrivateTransitionSurface[] = [];

  add(surface: CheckedPrivateTransitionSurface): void {
    this.surfaces.push(surface);
  }

  build(): CheckedPrivateTransitionSurfaceTable {
    const sorted = [...this.surfaces].sort(comparePrivateTransitionSurfaces);
    const byFunction = new Map<FunctionId, CheckedPrivateTransitionSurface[]>();
    for (const surface of sorted) {
      const list = byFunction.get(surface.functionId) ?? [];
      list.push(surface);
      byFunction.set(surface.functionId, list);
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

export function emptyCheckedPrivateTransitionSurfaceTable(): CheckedPrivateTransitionSurfaceTable {
  return {
    get: () => [],
    entries: () => [],
  };
}

export class CheckedPlatformEnsuredFactSurfaceTableBuilder {
  private readonly surfaces: CheckedPlatformEnsuredFactSurface[] = [];

  add(surface: CheckedPlatformEnsuredFactSurface): void {
    this.surfaces.push(surface);
  }

  build(): CheckedPlatformEnsuredFactSurfaceTable {
    const sorted = [...this.surfaces].sort(comparePlatformEnsuredFactSurfaces);
    const byFunction = new Map<FunctionId, CheckedPlatformEnsuredFactSurface[]>();
    const byBinding = new Map<string, CheckedPlatformEnsuredFactSurface[]>();
    for (const surface of sorted) {
      const functionList = byFunction.get(surface.sourceFunctionId) ?? [];
      functionList.push(surface);
      byFunction.set(surface.sourceFunctionId, functionList);

      const bindingKey = platformEnsuredFactBindingKey(surface);
      const bindingList = byBinding.get(bindingKey) ?? [];
      bindingList.push(surface);
      byBinding.set(bindingKey, bindingList);
    }
    return {
      getByFunction: (functionId) => {
        const result = byFunction.get(functionId);
        return result !== undefined ? [...result] : [];
      },
      getByBinding: (input) => {
        const result = byBinding.get(platformEnsuredFactBindingKey(input));
        return result !== undefined ? [...result] : [];
      },
      entries: () => [...sorted],
    };
  }
}

export function emptyCheckedPlatformEnsuredFactSurfaceTable(): CheckedPlatformEnsuredFactSurfaceTable {
  return {
    getByFunction: () => [],
    getByBinding: () => [],
    entries: () => [],
  };
}

export class CheckedMatchRefinementSurfaceTableBuilder {
  private readonly surfaces: CheckedMatchRefinementSurface[] = [];

  add(surface: CheckedMatchRefinementSurface): void {
    this.surfaces.push(surface);
  }

  build(): CheckedMatchRefinementSurfaceTable {
    const sorted = [...this.surfaces].sort(compareMatchRefinementSurfaces);
    return {
      entries: () => [...sorted],
    };
  }
}

export function emptyCheckedMatchRefinementSurfaceTable(): CheckedMatchRefinementSurfaceTable {
  return {
    entries: () => [],
  };
}

export interface PrivateTransitionPopulationContext {
  readonly transitions: readonly CheckedPrivateTransitionSurface[];
}

export interface PlatformEnsuredFactBinding {
  readonly sourceFunctionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
  readonly ensuredFacts: readonly {
    readonly fingerprint: string;
    readonly fact: CheckedPlatformEnsuredFact;
  }[];
}

export interface PlatformEnsuredFactPopulationContext {
  readonly certifiedBindings: readonly PlatformEnsuredFactBinding[];
}

export function populatePrivateTransitionSurfaces(
  builder: CheckedPrivateTransitionSurfaceTableBuilder,
  context: PrivateTransitionPopulationContext,
): void {
  for (const transition of context.transitions) {
    builder.add(transition);
  }
}

function isSupportedPlatformFactArgument(argument: CheckedPlatformFactArgument): boolean {
  if (argument.kind === "receiver") return true;
  if (argument.kind === "parameter") return argument.parameterId !== undefined;
  return argument.expressionText !== undefined || argument.placeKey !== undefined;
}

function isSupportedPlatformEnsuredFact(fact: CheckedPlatformEnsuredFact): boolean {
  return fact.argumentBindings.every(isSupportedPlatformFactArgument);
}

export function populatePlatformEnsuredFactSurfaces(
  builder: CheckedPlatformEnsuredFactSurfaceTableBuilder,
  context: PlatformEnsuredFactPopulationContext,
): void {
  for (const binding of context.certifiedBindings) {
    for (const ensuredFact of binding.ensuredFacts) {
      if (!isSupportedPlatformEnsuredFact(ensuredFact.fact)) continue;
      builder.add({
        sourceFunctionId: binding.sourceFunctionId,
        primitiveId: binding.primitiveId,
        contractId: binding.contractId,
        targetId: binding.targetId,
        fingerprint: ensuredFact.fingerprint,
        fact: ensuredFact.fact,
      });
    }
  }
}
