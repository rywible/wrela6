import { optIrDiagnosticCode, optIrDiagnosticOrderKey, type OptIrDiagnostic } from "../diagnostics";
import type { OptIrOperationId, OptIrRewriteRegionId } from "../ids";
import type {
  OptIrEGraphExtractionPolicy,
  OptIrEGraphExtractionPolicyRank,
} from "../policy/egraph-extraction-policy";

export interface OptIrExtractionCandidateDescriptor {
  readonly regionId: OptIrRewriteRegionId;
  readonly stableRootOperationId: OptIrOperationId;
  readonly policyRank: OptIrEGraphExtractionPolicyRank;
  readonly uncertaintyPenalty: number;
  readonly appliedRuleIds: readonly string[];
}

export interface OptIrExtractionCandidate<
  Extracted = unknown,
> extends OptIrExtractionCandidateDescriptor {
  readonly extracted: Extracted;
}

type OptIrExtractionDescriptorCarrier = OptIrExtractionCandidateDescriptor;

export interface OptIrExtractionRecord {
  readonly policyId: string;
  readonly regionId: OptIrRewriteRegionId;
  readonly stableRootOperationId: OptIrOperationId;
  readonly policyRank: OptIrEGraphExtractionPolicyRank;
  readonly uncertaintyPenalty: number;
  readonly rulesApplied: readonly string[];
  readonly appliedRuleIds: readonly string[];
}

export type OptIrEGraphExtractionDiagnostic =
  | OptIrDiagnostic
  | (Omit<OptIrDiagnostic, "severity"> & { readonly severity: "debug" });

export type OptIrExtractionResult<Original, Extracted> =
  | {
      readonly kind: "ok";
      readonly optIr: Extracted;
      readonly extracted: Extracted;
      readonly record: OptIrExtractionRecord;
      readonly diagnostics: readonly OptIrDiagnostic[];
    }
  | {
      readonly kind: "unchanged";
      readonly optIr: Original;
      readonly diagnostics: readonly OptIrEGraphExtractionDiagnostic[];
    };

export function extractOptIrEGraph<Original, Extracted>(input: {
  readonly original: Original;
  readonly candidates: readonly OptIrExtractionCandidate<Extracted>[];
  readonly policy: OptIrEGraphExtractionPolicy;
  readonly tracingEnabled: boolean;
}): OptIrExtractionResult<Original, Extracted> {
  const selected = selectOptIrExtractionCandidate(input.candidates, input.policy);
  if (selected === undefined) {
    return Object.freeze({
      kind: "unchanged",
      optIr: input.original,
      diagnostics: Object.freeze(input.tracingEnabled ? [debugDiagnostic()] : []),
    });
  }

  return Object.freeze({
    kind: "ok",
    optIr: selected.extracted,
    extracted: selected.extracted,
    record: Object.freeze({
      policyId: input.policy.policyId,
      regionId: selected.regionId,
      stableRootOperationId: selected.stableRootOperationId,
      policyRank: selected.policyRank,
      uncertaintyPenalty: selected.uncertaintyPenalty,
      rulesApplied: Object.freeze(selected.appliedRuleIds.slice()),
      appliedRuleIds: Object.freeze(selected.appliedRuleIds.slice()),
    }),
    diagnostics: Object.freeze([] as OptIrDiagnostic[]),
  });
}

export function selectOptIrExtractionCandidate<Extracted>(
  candidates: readonly OptIrExtractionCandidate<Extracted>[],
  policy: OptIrEGraphExtractionPolicy,
): OptIrExtractionCandidate<Extracted> | undefined {
  return selectOptIrExtractionDescriptor(candidates, policy);
}

export function selectOptIrExtractionDescriptor<Candidate extends OptIrExtractionDescriptorCarrier>(
  candidates: readonly Candidate[],
  policy: OptIrEGraphExtractionPolicy,
): Candidate | undefined {
  if (candidates.length === 0) {
    return undefined;
  }
  const [selected] = [...candidates].sort((left, right) =>
    compareExtractionDescriptors(left, right, policy),
  );
  return selected;
}

function compareExtractionDescriptors(
  left: OptIrExtractionDescriptorCarrier,
  right: OptIrExtractionDescriptorCarrier,
  policy: OptIrEGraphExtractionPolicy,
): number {
  return (
    policy.comparePolicyRank(left.policyRank, right.policyRank) ||
    left.uncertaintyPenalty - right.uncertaintyPenalty ||
    Number(left.stableRootOperationId) - Number(right.stableRootOperationId)
  );
}

function debugDiagnostic(): OptIrEGraphExtractionDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_REWRITE_LEGALITY_INVALID");
  return {
    severity: "debug",
    code,
    messageTemplate: "OptIR e-graph extraction failed: {reason}.",
    arguments: { reason: "no-candidate" },
    ownerKey: "egraph-extraction",
    rootCauseKey: "no-candidate",
    stableDetail: "egraph-extraction:no-candidate",
    orderKey: optIrDiagnosticOrderKey({
      originKey: "",
      functionKey: "",
      code,
      ownerKey: "egraph-extraction",
      rootCauseKey: "no-candidate",
      stableDetail: "egraph-extraction:no-candidate",
    }),
  };
}
