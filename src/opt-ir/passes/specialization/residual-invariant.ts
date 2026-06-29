import { optimizationPassId } from "../../ids";
import { passInvariantCheckerId, passInvariantSchemaId } from "../pass-contract";

export interface SpecializationResidualEquivalenceInput {
  readonly includeStaticEvaluation?: boolean;
  readonly includeStaticDriving?: boolean;
  readonly includeBoundedUnroll?: boolean;
  readonly includeCloneRehoming?: boolean;
  readonly touchedEffectBoundary?: boolean;
  readonly touchedCapabilityFacts?: boolean;
  readonly touchedPrivateStateFacts?: boolean;
}

export interface SpecializationResidualInvariant {
  readonly kind: "passSpecificInvariant";
  readonly schema: ReturnType<typeof passInvariantSchemaId>;
  readonly checker: ReturnType<typeof passInvariantCheckerId>;
  readonly decomposesTo: readonly { readonly kind: string }[];
}

export function specializationResidualEquivalence(
  input: SpecializationResidualEquivalenceInput = {},
): SpecializationResidualInvariant {
  return Object.freeze({
    kind: "passSpecificInvariant" as const,
    schema: passInvariantSchemaId("specializationResidualEquivalence"),
    checker: passInvariantCheckerId("specialization-residual-equivalence"),
    decomposesTo: Object.freeze(decomposition(input)),
  });
}

export function specializationResidualEquivalenceSchema() {
  return Object.freeze({
    schemaId: passInvariantSchemaId("specializationResidualEquivalence"),
    passId: optimizationPassId("whole-program-specialization"),
    operands: Object.freeze([
      Object.freeze({ name: "original", kind: "operation" as const }),
      Object.freeze({ name: "replacement", kind: "operation" as const }),
    ]),
    requiredFacts: Object.freeze([]),
    checker: passInvariantCheckerId("specialization-residual-equivalence"),
    decomposesTo: Object.freeze(
      decomposition({
        includeStaticEvaluation: true,
        includeStaticDriving: true,
        includeBoundedUnroll: true,
        includeCloneRehoming: true,
        touchedEffectBoundary: true,
        touchedCapabilityFacts: true,
        touchedPrivateStateFacts: true,
      }),
    ),
  });
}

function decomposition(
  input: SpecializationResidualEquivalenceInput,
): readonly { readonly kind: string }[] {
  const kinds: string[] = [];
  if (input.includeStaticEvaluation === true) {
    kinds.push("pureAlgebraicEquivalence");
  }
  if (input.includeStaticDriving === true) {
    kinds.push("terminalReachabilityEquivalence", "boundsDominanceElimination");
  }
  if (input.includeBoundedUnroll === true) {
    kinds.push("boundedUnrollEquivalence");
  }
  if (input.includeCloneRehoming === true) {
    kinds.push("ownershipRuntimeIdentity");
  }
  if (input.touchedEffectBoundary === true) {
    kinds.push("effectBoundaryEquivalence");
  }
  if (input.touchedCapabilityFacts === true) {
    kinds.push("capabilityFlowEquivalence");
  }
  if (input.touchedPrivateStateFacts === true) {
    kinds.push("privateStateGenerationEquivalence");
  }
  return kinds.map((kind) => Object.freeze({ kind }));
}
