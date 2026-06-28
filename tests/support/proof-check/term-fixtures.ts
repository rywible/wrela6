import type { ProofCheckComparisonOperator } from "../../../src/proof-check/model/fact-language";
import {
  proofCapabilityKindId,
  syntheticBinderId,
  type ProofCheckCapabilityTerm,
  type ProofCheckComparisonTerm,
  type ProofCheckOperandTerm,
} from "../../../src/proof-check/model/fact-language";

export function proofCheckValueOperandForTest(name: string): ProofCheckOperandTerm {
  return {
    kind: "value",
    value: {
      kind: "synthetic",
      id: syntheticBinderId(name),
    },
  };
}

export function valueTerm(name: string): ProofCheckOperandTerm {
  return proofCheckValueOperandForTest(name);
}

export function literalInt(value: bigint): ProofCheckOperandTerm {
  return {
    kind: "literal",
    literal: {
      kind: "integer",
      text: String(value),
      value,
    },
  };
}

export function comparisonTerm(
  left: ProofCheckOperandTerm,
  operator: ProofCheckComparisonOperator,
  right: ProofCheckOperandTerm,
): ProofCheckComparisonTerm {
  return {
    kind: "comparison",
    left,
    operator,
    right,
  };
}

export function capabilityRequirementForTest(capabilityName: string): ProofCheckCapabilityTerm {
  return {
    kind: "capability",
    capability: {
      kind: "synthetic",
      id: syntheticBinderId(capabilityName),
    },
    capabilityKind: proofCapabilityKindId(capabilityName),
  };
}
