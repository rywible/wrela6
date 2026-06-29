export type OptIrEGraphExtractionPolicyRank = number & {
  readonly __brand: "OptIrEGraphExtractionPolicyRank";
};

export interface OptIrEGraphExtractionPolicy {
  readonly policyId: string;
  readonly comparePolicyRank: (
    left: OptIrEGraphExtractionPolicyRank,
    right: OptIrEGraphExtractionPolicyRank,
  ) => number;
}

export function defaultOptIrEGraphExtractionPolicy(): OptIrEGraphExtractionPolicy {
  return Object.freeze({
    policyId: "opt-ir.egraph.extraction-policy.v1",
    comparePolicyRank(
      left: OptIrEGraphExtractionPolicyRank,
      right: OptIrEGraphExtractionPolicyRank,
    ) {
      return Number(left) - Number(right);
    },
  });
}
