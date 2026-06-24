import type { FunctionId } from "../ids";
import type { SyntaxReferenceKey, ResolvedReference } from "../names/reference";

import type { SourceSpan } from "../../frontend";
import type { CheckedResourceKind } from "./resource-kind";
import type { CheckedFunctionSignature, CertifiedPlatformBindingTable } from "./checked-program";
import type { CheckedImageDevice } from "./image-device-checker";
import type {
  CheckedConstructibilitySurfaceTable,
  CheckedTakeModeSurfaceTable,
  CheckedValidationContractSurfaceTable,
  CheckedAttemptContractSurfaceTable,
  CheckedPrivateTransitionSurfaceTable,
  CheckedPlatformEnsuredFactSurfaceTable,
  CheckedMatchRefinementSurfaceTable,
} from "./proof-contracts";
import {
  emptyCheckedConstructibilitySurfaceTable,
  emptyCheckedTakeModeSurfaceTable,
  emptyCheckedValidationContractSurfaceTable,
  emptyCheckedAttemptContractSurfaceTable,
  emptyCheckedPrivateTransitionSurfaceTable,
  emptyCheckedPlatformEnsuredFactSurfaceTable,
  emptyCheckedMatchRefinementSurfaceTable,
} from "./proof-contracts";

// ── CheckedProofSurface ─────────────────────────────────────

export interface CheckedRequirementReference {
  readonly key: SyntaxReferenceKey;
  readonly reference: ResolvedReference;
}

export type CheckedRequirementExpression =
  | { readonly kind: "opaque"; readonly text: string }
  | {
      readonly kind: "checked";
      readonly text: string;
      readonly references: readonly CheckedRequirementReference[];
      readonly completedMembers: readonly CheckedRequirementReference[];
    };

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

export interface CheckedProofSeedTable<Entry> {
  entries(): readonly Entry[];
}

export interface CheckedResourceKindByTypeSurface {
  readonly fingerprint: string;
  readonly resourceKind: CheckedResourceKind;
  readonly span?: SourceSpan;
}

export interface CheckedSignatureModeSurface {
  readonly functionId: FunctionId;
  readonly signature: CheckedFunctionSignature;
}

export interface CheckedPredicateFactSurface {
  readonly functionId: FunctionId;
  readonly span: SourceSpan;
}

export interface CheckedValidationSurface {
  readonly span: SourceSpan;
}

export interface CheckedPrivateStateSurface {
  readonly span: SourceSpan;
}

export interface CheckedImageSurface {
  readonly device: CheckedImageDevice;
}

export interface CheckedProofSurface {
  readonly resourceKindByType: CheckedProofSeedTable<CheckedResourceKindByTypeSurface>;
  readonly signatureModes: CheckedProofSeedTable<CheckedSignatureModeSurface>;
  readonly requirementSurfaces: CheckedRequirementSurfaceTable;
  readonly predicateFactSurfaces: CheckedProofSeedTable<CheckedPredicateFactSurface>;
  readonly terminalSurfaces: CheckedTerminalSurfaceTable;
  readonly validationSurfaces: CheckedProofSeedTable<CheckedValidationSurface>;
  readonly privateStateSurfaces: CheckedProofSeedTable<CheckedPrivateStateSurface>;
  readonly imageSurfaces: CheckedProofSeedTable<CheckedImageSurface>;
  readonly platformContracts: CertifiedPlatformBindingTable;
  readonly constructibilitySurfaces: CheckedConstructibilitySurfaceTable;
  readonly takeModeSurfaces: CheckedTakeModeSurfaceTable;
  readonly validationContracts: CheckedValidationContractSurfaceTable;
  readonly attemptContracts: CheckedAttemptContractSurfaceTable;
  readonly privateTransitions: CheckedPrivateTransitionSurfaceTable;
  readonly platformEnsuredFacts: CheckedPlatformEnsuredFactSurfaceTable;
  readonly matchRefinements: CheckedMatchRefinementSurfaceTable;
}

// ── Builders ────────────────────────────────────────────────

function checkedRequirementSurfaceTable(
  entries: readonly CheckedRequirementSurface[],
): CheckedRequirementSurfaceTable {
  const sorted = [...entries].sort((left, right) => {
    const aId = left.ownerFunctionId !== undefined ? (left.ownerFunctionId as number) : 0;
    const bId = right.ownerFunctionId !== undefined ? (right.ownerFunctionId as number) : 0;
    return aId - bId;
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
      const result = byFunction.get(functionId);
      return result !== undefined ? [...result] : undefined;
    },
    entries: () => [...sorted],
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
    entries: () => [...sorted],
  };
}

function checkedProofSeedTable<Entry>(entries: readonly Entry[]): CheckedProofSeedTable<Entry> {
  const stableEntries = [...entries];
  return {
    entries: () => [...stableEntries],
  };
}

function emptyCertifiedPlatformBindingTable(): CertifiedPlatformBindingTable {
  return {
    get() {
      return undefined;
    },
    entries: () => [],
  };
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

export function checkedProofSurfaceEmpty(): CheckedProofSurface {
  return {
    resourceKindByType: checkedProofSeedTable([]),
    signatureModes: checkedProofSeedTable([]),
    requirementSurfaces: checkedRequirementSurfaceTable([]),
    predicateFactSurfaces: checkedProofSeedTable([]),
    terminalSurfaces: checkedTerminalSurfaceTable([]),
    validationSurfaces: checkedProofSeedTable([]),
    privateStateSurfaces: checkedProofSeedTable([]),
    imageSurfaces: checkedProofSeedTable([]),
    platformContracts: emptyCertifiedPlatformBindingTable(),
    constructibilitySurfaces: emptyCheckedConstructibilitySurfaceTable(),
    takeModeSurfaces: emptyCheckedTakeModeSurfaceTable(),
    validationContracts: emptyCheckedValidationContractSurfaceTable(),
    attemptContracts: emptyCheckedAttemptContractSurfaceTable(),
    privateTransitions: emptyCheckedPrivateTransitionSurfaceTable(),
    platformEnsuredFacts: emptyCheckedPlatformEnsuredFactSurfaceTable(),
    matchRefinements: emptyCheckedMatchRefinementSurfaceTable(),
  };
}

export function checkedProofSurface(input: {
  readonly resourceKindByType?: readonly CheckedResourceKindByTypeSurface[];
  readonly signatureModes?: readonly CheckedSignatureModeSurface[];
  readonly requirements?: readonly CheckedRequirementSurface[];
  readonly predicateFactSurfaces?: readonly CheckedPredicateFactSurface[];
  readonly terminalSurfaces?: readonly CheckedTerminalSurface[];
  readonly validationSurfaces?: readonly CheckedValidationSurface[];
  readonly privateStateSurfaces?: readonly CheckedPrivateStateSurface[];
  readonly imageSurfaces?: readonly CheckedImageSurface[];
  readonly platformContracts?: CertifiedPlatformBindingTable;
  readonly constructibilitySurfaces?: CheckedConstructibilitySurfaceTable;
  readonly takeModeSurfaces?: CheckedTakeModeSurfaceTable;
  readonly validationContracts?: CheckedValidationContractSurfaceTable;
  readonly attemptContracts?: CheckedAttemptContractSurfaceTable;
  readonly privateTransitions?: CheckedPrivateTransitionSurfaceTable;
  readonly platformEnsuredFacts?: CheckedPlatformEnsuredFactSurfaceTable;
  readonly matchRefinements?: CheckedMatchRefinementSurfaceTable;
}): CheckedProofSurface {
  return {
    resourceKindByType: checkedProofSeedTable(input.resourceKindByType ?? []),
    signatureModes: checkedProofSeedTable(input.signatureModes ?? []),
    requirementSurfaces: checkedRequirementSurfaceTable(input.requirements ?? []),
    predicateFactSurfaces: checkedProofSeedTable(input.predicateFactSurfaces ?? []),
    terminalSurfaces: checkedTerminalSurfaceTable(input.terminalSurfaces ?? []),
    validationSurfaces: checkedProofSeedTable(input.validationSurfaces ?? []),
    privateStateSurfaces: checkedProofSeedTable(input.privateStateSurfaces ?? []),
    imageSurfaces: checkedProofSeedTable(input.imageSurfaces ?? []),
    platformContracts: input.platformContracts ?? emptyCertifiedPlatformBindingTable(),
    constructibilitySurfaces:
      input.constructibilitySurfaces ?? emptyCheckedConstructibilitySurfaceTable(),
    takeModeSurfaces: input.takeModeSurfaces ?? emptyCheckedTakeModeSurfaceTable(),
    validationContracts: input.validationContracts ?? emptyCheckedValidationContractSurfaceTable(),
    attemptContracts: input.attemptContracts ?? emptyCheckedAttemptContractSurfaceTable(),
    privateTransitions: input.privateTransitions ?? emptyCheckedPrivateTransitionSurfaceTable(),
    platformEnsuredFacts:
      input.platformEnsuredFacts ?? emptyCheckedPlatformEnsuredFactSurfaceTable(),
    matchRefinements: input.matchRefinements ?? emptyCheckedMatchRefinementSurfaceTable(),
  };
}
