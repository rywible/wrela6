import type { CheckedPacketFactKind } from "../../proof-check/model/fact-packet";
import type { OptimizationPassId, OptIrFactId, OptIrOriginId, OptIrRewriteRegionId } from "../ids";

export type PassDerivedFactKind = "passDerived";
export type FactPreservationRuleId = string & { readonly __brand: "FactPreservationRuleId" };
export type FactDerivationRuleId = string & { readonly __brand: "FactDerivationRuleId" };
export type RewriteLegalityObligationId = string & {
  readonly __brand: "RewriteLegalityObligationId";
};
export type PassInvariantSchemaId = string & { readonly __brand: "PassInvariantSchemaId" };
export type PassInvariantCheckerId = string & { readonly __brand: "PassInvariantCheckerId" };

export type OptIrFormOrFactPrecondition = string;
export type OptIrFormOrFactPostcondition = string;
export type OptIrAnalysisId = string;

export interface OptIrPassContract {
  readonly passId: OptimizationPassId;
  readonly invalidatesByDefault: true;
  readonly preserves: readonly FactPreservationRule[];
  readonly derives: readonly FactDerivationRule[];
  readonly rewriteObligations: readonly RewriteLegalityObligation[];
  readonly scheduling: OptIrPassSchedulingContract;
  readonly requiresVerifierAfterRun: boolean;
}

export interface OptIrPassSchedulingContract {
  readonly requires: readonly OptIrFormOrFactPrecondition[];
  readonly produces: readonly OptIrFormOrFactPostcondition[];
  readonly invalidatesAnalyses: readonly OptIrAnalysisId[];
  readonly idempotent: boolean;
  readonly fuel: OptIrPassFuelPolicy;
}

export type OptIrPassFuelPolicy =
  | { readonly kind: "none" }
  | { readonly kind: "fixedRounds"; readonly rounds: number }
  | { readonly kind: "worklist"; readonly maxItems: number };

export interface FactPreservationRule {
  readonly ruleId: FactPreservationRuleId | string;
  readonly factKind: CheckedPacketFactKind | PassDerivedFactKind;
  readonly subject: FactSubjectPreservation;
  readonly scope: FactScopePreservation;
  readonly dependencies: FactDependencyPreservation;
  readonly cfg: CfgPreservationEffect;
  readonly memory: MemoryPreservationEffect;
  readonly invalidations: InvalidationPreservationCheck;
  readonly result: FactPreservationResultKind;
}

export type FactSubjectPreservation =
  | { readonly kind: "identity" }
  | { readonly kind: "substitution"; readonly table: string }
  | { readonly kind: "projection"; readonly rule: string }
  | { readonly kind: "drop" };

export type FactScopePreservation =
  | { readonly kind: "sameScope" }
  | { readonly kind: "callerLocal"; readonly inlineSite: string }
  | { readonly kind: "cloneLocal"; readonly clone: string }
  | { readonly kind: "rewrittenRegion"; readonly region: OptIrRewriteRegionId }
  | { readonly kind: "drop" };

export type FactDependencyPreservation =
  | { readonly kind: "identity" }
  | { readonly kind: "remapped" }
  | { readonly kind: "derive" }
  | { readonly kind: "drop" };

export type CfgPreservationEffect =
  | { readonly kind: "unchanged" }
  | { readonly kind: "edited"; readonly edits: readonly string[] }
  | { readonly kind: "dropPathScopedFacts" };

export type MemoryPreservationEffect =
  | { readonly kind: "unchanged" }
  | { readonly kind: "equivalent"; readonly rule: string }
  | { readonly kind: "dropMemoryFacts" };

export type InvalidationPreservationCheck =
  | { readonly kind: "rejectTriggered" }
  | { readonly kind: "deriveAfterTrigger" }
  | { readonly kind: "dropTriggered" };

export type FactPreservationResultKind = "preserved" | "derived" | "dropped";

export interface FactDerivationRule {
  readonly ruleId: FactDerivationRuleId | string;
  readonly factKind: CheckedPacketFactKind | PassDerivedFactKind;
  readonly dependencies: readonly OptIrFactId[];
  readonly result: "newFact";
}

export type RewriteInvariant =
  | { readonly kind: "pureAlgebraicEquivalence" }
  | { readonly kind: "layoutEndianEquivalence" }
  | { readonly kind: "boundsDominanceElimination" }
  | { readonly kind: "ownershipRuntimeIdentity" }
  | { readonly kind: "noaliasMemoryEquivalence" }
  | { readonly kind: "effectBoundaryEquivalence" }
  | { readonly kind: "terminalReachabilityEquivalence" }
  | { readonly kind: "abiWrapperEquivalence" }
  | { readonly kind: "capabilityFlowEquivalence" }
  | { readonly kind: "privateStateEquivalence" }
  | { readonly kind: "vectorLaneEquivalence" }
  | { readonly kind: "conjunction"; readonly invariants: readonly RewriteInvariant[] }
  | {
      readonly kind: "passSpecificInvariant";
      readonly schema: PassInvariantSchemaId;
      readonly checker: PassInvariantCheckerId;
      readonly decomposesTo: readonly RewriteInvariant[];
    };

export interface PassInvariantSchema {
  readonly schemaId: PassInvariantSchemaId;
  readonly passId: OptimizationPassId;
  readonly operands: readonly PassInvariantOperandSchema[];
  readonly requiredFacts: readonly FactGate[];
  readonly checker: PassInvariantCheckerId;
  readonly decomposesTo: readonly RewriteInvariant[];
}

export interface PassInvariantOperandSchema {
  readonly name: string;
  readonly kind: "value" | "operation" | "block" | "region" | "fact";
}

export interface FactGate {
  readonly factKind: CheckedPacketFactKind | PassDerivedFactKind;
  readonly subjectRole?: string;
}

export interface RewriteLegalityObligation {
  readonly obligationId: RewriteLegalityObligationId;
  readonly invariant: RewriteInvariant;
  readonly requiredFacts: readonly OptIrFactId[];
  readonly factsShape: RewriteObligationFactsShape;
  readonly original: OptIrRewriteRegionId;
  readonly replacement: OptIrRewriteRegionId;
  readonly origin: OptIrOriginId;
}

export interface RewriteObligationFactsShape {
  readonly minimumFacts: number;
  readonly acceptedFactKinds: readonly (CheckedPacketFactKind | PassDerivedFactKind)[];
}

export type OptIrPassContractValidationIssueCode =
  | "PASS_ID_MISSING"
  | "INVALIDATES_BY_DEFAULT_REQUIRED"
  | "PRESERVES_REQUIRED"
  | "DERIVES_REQUIRED"
  | "REWRITE_OBLIGATIONS_REQUIRED"
  | "SCHEDULING_REQUIRED"
  | "SCHEDULING_REQUIRES_EMPTY"
  | "SCHEDULING_PRODUCES_EMPTY"
  | "SCHEDULING_INVALIDATES_ANALYSES_REQUIRED"
  | "SCHEDULING_IDEMPOTENT_REQUIRED"
  | "FUEL_REQUIRED"
  | "FUEL_FIXED_ROUNDS_INVALID"
  | "FUEL_WORKLIST_INVALID"
  | "REQUIRES_VERIFIER_AFTER_RUN_REQUIRED"
  | "REWRITE_OBLIGATION_ID_MISSING"
  | "REWRITE_OBLIGATION_REQUIRED_FACTS_EMPTY"
  | "REWRITE_OBLIGATION_FACTS_SHAPE_EMPTY"
  | "PASS_SPECIFIC_INVARIANT_SCHEMA_MISSING"
  | "PASS_SPECIFIC_INVARIANT_CHECKER_MISSING"
  | "PASS_SPECIFIC_INVARIANT_DECOMPOSITION_EMPTY";

export interface OptIrPassContractValidationIssue {
  readonly code: OptIrPassContractValidationIssueCode;
  readonly path: string;
}

export type OptIrPassContractValidationResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly issues: readonly OptIrPassContractValidationIssue[] };

export function rewriteLegalityObligationId(value: string): RewriteLegalityObligationId {
  return nonEmptyStringId(value, "RewriteLegalityObligationId") as RewriteLegalityObligationId;
}

export function passInvariantSchemaId(value: string): PassInvariantSchemaId {
  return nonEmptyStringId(value, "PassInvariantSchemaId") as PassInvariantSchemaId;
}

export function passInvariantCheckerId(value: string): PassInvariantCheckerId {
  return nonEmptyStringId(value, "PassInvariantCheckerId") as PassInvariantCheckerId;
}

export function validateOptIrPassContract(
  contract: OptIrPassContract,
): OptIrPassContractValidationResult {
  const issues: OptIrPassContractValidationIssue[] = [];

  addIf(issues, !isPresentString(contract.passId), "PASS_ID_MISSING", "passId");
  addIf(
    issues,
    contract.invalidatesByDefault !== true,
    "INVALIDATES_BY_DEFAULT_REQUIRED",
    "invalidatesByDefault",
  );
  addIf(issues, !Array.isArray(contract.preserves), "PRESERVES_REQUIRED", "preserves");
  addIf(issues, !Array.isArray(contract.derives), "DERIVES_REQUIRED", "derives");
  addIf(
    issues,
    !Array.isArray(contract.rewriteObligations),
    "REWRITE_OBLIGATIONS_REQUIRED",
    "rewriteObligations",
  );
  addIf(
    issues,
    typeof contract.requiresVerifierAfterRun !== "boolean",
    "REQUIRES_VERIFIER_AFTER_RUN_REQUIRED",
    "requiresVerifierAfterRun",
  );

  validateScheduling(contract.scheduling, issues);

  if (Array.isArray(contract.rewriteObligations)) {
    contract.rewriteObligations.forEach((obligation, index) =>
      validateRewriteObligation(obligation, `rewriteObligations.${index}`, issues),
    );
  }

  return issues.length === 0 ? { kind: "ok" } : { kind: "error", issues };
}

function validateScheduling(
  scheduling: OptIrPassSchedulingContract | undefined,
  issues: OptIrPassContractValidationIssue[],
): void {
  if (scheduling === undefined) {
    addIssue(issues, "SCHEDULING_REQUIRED", "scheduling");
    return;
  }

  addIf(
    issues,
    !Array.isArray(scheduling.requires) || scheduling.requires.length === 0,
    "SCHEDULING_REQUIRES_EMPTY",
    "scheduling.requires",
  );
  addIf(
    issues,
    !Array.isArray(scheduling.produces) || scheduling.produces.length === 0,
    "SCHEDULING_PRODUCES_EMPTY",
    "scheduling.produces",
  );
  addIf(
    issues,
    !Array.isArray(scheduling.invalidatesAnalyses),
    "SCHEDULING_INVALIDATES_ANALYSES_REQUIRED",
    "scheduling.invalidatesAnalyses",
  );
  addIf(
    issues,
    typeof scheduling.idempotent !== "boolean",
    "SCHEDULING_IDEMPOTENT_REQUIRED",
    "scheduling.idempotent",
  );

  validateFuel(scheduling.fuel, issues);
}

function validateFuel(
  fuel: OptIrPassFuelPolicy | undefined,
  issues: OptIrPassContractValidationIssue[],
): void {
  if (fuel === undefined) {
    addIssue(issues, "FUEL_REQUIRED", "scheduling.fuel");
    return;
  }
  if (fuel.kind === "fixedRounds") {
    addIf(
      issues,
      !Number.isInteger(fuel.rounds) || fuel.rounds < 1,
      "FUEL_FIXED_ROUNDS_INVALID",
      "scheduling.fuel.rounds",
    );
  }
  if (fuel.kind === "worklist") {
    addIf(
      issues,
      !Number.isInteger(fuel.maxItems) || fuel.maxItems < 1,
      "FUEL_WORKLIST_INVALID",
      "scheduling.fuel.maxItems",
    );
  }
}

function validateRewriteObligation(
  obligation: RewriteLegalityObligation,
  path: string,
  issues: OptIrPassContractValidationIssue[],
): void {
  addIf(
    issues,
    !isPresentString(obligation.obligationId),
    "REWRITE_OBLIGATION_ID_MISSING",
    `${path}.obligationId`,
  );
  addIf(
    issues,
    !Array.isArray(obligation.requiredFacts) || obligation.requiredFacts.length === 0,
    "REWRITE_OBLIGATION_REQUIRED_FACTS_EMPTY",
    `${path}.requiredFacts`,
  );
  addIf(
    issues,
    obligation.factsShape === undefined ||
      !Number.isInteger(obligation.factsShape.minimumFacts) ||
      obligation.factsShape.minimumFacts < 1 ||
      !Array.isArray(obligation.factsShape.acceptedFactKinds) ||
      obligation.factsShape.acceptedFactKinds.length === 0,
    "REWRITE_OBLIGATION_FACTS_SHAPE_EMPTY",
    `${path}.factsShape`,
  );
  validateInvariant(obligation.invariant, `${path}.invariant`, issues);
}

function validateInvariant(
  invariant: RewriteInvariant,
  path: string,
  issues: OptIrPassContractValidationIssue[],
): void {
  if (invariant.kind === "conjunction") {
    addIf(
      issues,
      invariant.invariants.length === 0,
      "PASS_SPECIFIC_INVARIANT_DECOMPOSITION_EMPTY",
      `${path}.invariants`,
    );
    invariant.invariants.forEach((child, index) =>
      validateInvariant(child, `${path}.invariants.${index}`, issues),
    );
    return;
  }

  if (invariant.kind !== "passSpecificInvariant") {
    return;
  }

  addIf(
    issues,
    !isPresentString(invariant.schema),
    "PASS_SPECIFIC_INVARIANT_SCHEMA_MISSING",
    `${path}.schema`,
  );
  addIf(
    issues,
    !isPresentString(invariant.checker),
    "PASS_SPECIFIC_INVARIANT_CHECKER_MISSING",
    `${path}.checker`,
  );
  addIf(
    issues,
    invariant.decomposesTo.length === 0,
    "PASS_SPECIFIC_INVARIANT_DECOMPOSITION_EMPTY",
    `${path}.decomposesTo`,
  );
  invariant.decomposesTo.forEach((child, index) =>
    validateInvariant(child, `${path}.decomposesTo.${index}`, issues),
  );
}

function nonEmptyStringId(value: string, label: string): string {
  if (value.length === 0) {
    throw new RangeError(`${label} must be non-empty.`);
  }
  return value;
}

function addIf(
  issues: OptIrPassContractValidationIssue[],
  condition: boolean,
  code: OptIrPassContractValidationIssueCode,
  path: string,
): void {
  if (condition) {
    addIssue(issues, code, path);
  }
}

function addIssue(
  issues: OptIrPassContractValidationIssue[],
  code: OptIrPassContractValidationIssueCode,
  path: string,
): void {
  issues.push({ code, path });
}

function isPresentString(value: string): boolean {
  return typeof value === "string" && value.length > 0;
}
