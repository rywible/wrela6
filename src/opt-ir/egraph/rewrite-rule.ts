import type { CheckedPacketFactKind } from "../../proof-check/model/fact-packet";
import type { OptIrOperationKind } from "../operation-kinds";
import type { OptimizationPassId, OptIrFactId, OptIrOriginId, OptIrRewriteRegionId } from "../ids";
import type {
  FactPreservationRule,
  PassDerivedFactKind,
  PassInvariantSchema,
  RewriteInvariant,
  RewriteLegalityObligation,
} from "../passes/pass-contract";
import { rewriteLegalityObligationId } from "../passes/pass-contract";
import type {
  OptimizationRewriteRuleId,
  RewriteLegalityRecord,
  RewriteLegalityRecordId,
} from "../verify/rewrite-legality";
import type { OptIrFactGate } from "./fact-gated-rule";
import { factKindsForGate, minimumFactsForGate } from "./fact-gated-rule";

export interface OptIrRewritePatternSchema {
  readonly operationKinds: readonly OptIrOperationKind[];
  readonly subjectRoles: readonly string[];
}

export interface OptIrRewriteReplacementSchema {
  readonly operationKinds: readonly OptIrOperationKind[];
  readonly subjectRoles: readonly string[];
}

export interface OptIrRewriteRecordInput {
  readonly recordId: RewriteLegalityRecordId | string;
  readonly requiredFacts: readonly OptIrFactId[];
  readonly original: OptIrRewriteRegionId;
  readonly replacement: OptIrRewriteRegionId;
  readonly origin: OptIrOriginId;
}

export interface OptIrRewriteObligationInput {
  readonly requiredFacts: readonly OptIrFactId[];
  readonly original: OptIrRewriteRegionId;
  readonly replacement: OptIrRewriteRegionId;
  readonly origin: OptIrOriginId;
}

export interface OptIrRewriteRule {
  readonly ruleId: OptimizationRewriteRuleId | string;
  readonly name: string;
  readonly passId: OptimizationPassId;
  readonly pattern: OptIrRewritePatternSchema;
  readonly replacement: OptIrRewriteReplacementSchema;
  readonly factGate: OptIrFactGate;
  readonly invariant: RewriteInvariant;
  readonly invariantSchema: PassInvariantSchema;
  readonly preservationRules: readonly FactPreservationRule[];
  readonly primaryPreservationRuleId: string;
  readonly acceptedFactKinds: readonly (CheckedPacketFactKind | PassDerivedFactKind)[];
  readonly createRewriteObligation: (
    input: OptIrRewriteObligationInput,
  ) => RewriteLegalityObligation;
  readonly createRewriteRecord: (input: OptIrRewriteRecordInput) => RewriteLegalityRecord;
}

export function optIrRewriteRule(input: {
  readonly ruleId: OptimizationRewriteRuleId | string;
  readonly name: string;
  readonly passId: OptimizationPassId;
  readonly pattern: OptIrRewritePatternSchema;
  readonly replacement: OptIrRewriteReplacementSchema;
  readonly factGate: OptIrFactGate;
  readonly invariant: RewriteInvariant;
  readonly invariantSchema: PassInvariantSchema;
  readonly preservationRules: readonly FactPreservationRule[];
  readonly primaryPreservationRuleId: string;
}): OptIrRewriteRule {
  const acceptedFactKinds = factKindsForGate(input.factGate);
  const minimumFacts = minimumFactsForGate(input.factGate);
  const obligationId = rewriteLegalityObligationId(`${input.ruleId}:obligation`);

  return Object.freeze({
    ...input,
    pattern: freezePattern(input.pattern),
    replacement: freezeReplacement(input.replacement),
    preservationRules: Object.freeze(input.preservationRules.map(freezePreservationRule)),
    acceptedFactKinds: Object.freeze(acceptedFactKinds.slice()),
    createRewriteObligation(obligationInput: OptIrRewriteObligationInput) {
      return Object.freeze({
        obligationId,
        invariant: input.invariant,
        requiredFacts: Object.freeze(obligationInput.requiredFacts.slice()),
        factsShape: Object.freeze({
          minimumFacts,
          acceptedFactKinds: Object.freeze(acceptedFactKinds.slice()),
        }),
        original: obligationInput.original,
        replacement: obligationInput.replacement,
        origin: obligationInput.origin,
      });
    },
    createRewriteRecord(recordInput: OptIrRewriteRecordInput) {
      return Object.freeze({
        recordId: recordInput.recordId,
        passId: input.passId,
        ruleId: input.ruleId,
        obligationId,
        original: recordInput.original,
        replacement: recordInput.replacement,
        invariant: input.invariant,
        factsUsed: Object.freeze(recordInput.requiredFacts.slice()),
        cfgEdits: Object.freeze([]),
        memoryEdits: Object.freeze([]),
        callEdits: Object.freeze([]),
        origin: recordInput.origin,
      });
    },
  });
}

function freezePattern(pattern: OptIrRewritePatternSchema): OptIrRewritePatternSchema {
  return Object.freeze({
    operationKinds: Object.freeze(pattern.operationKinds.slice()),
    subjectRoles: Object.freeze(pattern.subjectRoles.slice()),
  });
}

function freezeReplacement(
  replacement: OptIrRewriteReplacementSchema,
): OptIrRewriteReplacementSchema {
  return Object.freeze({
    operationKinds: Object.freeze(replacement.operationKinds.slice()),
    subjectRoles: Object.freeze(replacement.subjectRoles.slice()),
  });
}

function freezePreservationRule(rule: FactPreservationRule): FactPreservationRule {
  return Object.freeze(rule);
}
