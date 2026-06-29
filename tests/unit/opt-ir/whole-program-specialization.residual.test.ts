import { describe, expect, test } from "bun:test";

import { optimizationPassId } from "../../../src/opt-ir/ids";
import {
  passInvariantCheckerId,
  passInvariantSchemaId,
} from "../../../src/opt-ir/passes/pass-contract";
import {
  specializationResidualEquivalence,
  specializationResidualEquivalenceSchema,
} from "../../../src/opt-ir/passes/specialization/residual-invariant";

describe("specialization residual invariant", () => {
  test("decomposes residual equivalence into named invariants", () => {
    const invariant = specializationResidualEquivalence({
      includeStaticEvaluation: true,
      includeStaticDriving: true,
      includeBoundedUnroll: true,
      includeCloneRehoming: true,
      touchedEffectBoundary: true,
      touchedCapabilityFacts: true,
      touchedPrivateStateFacts: true,
    });

    expect(invariant.kind).toBe("passSpecificInvariant");
    expect(invariant.decomposesTo.map((entry) => entry.kind)).toEqual([
      "pureAlgebraicEquivalence",
      "terminalReachabilityEquivalence",
      "boundsDominanceElimination",
      "boundedUnrollEquivalence",
      "ownershipRuntimeIdentity",
      "effectBoundaryEquivalence",
      "capabilityFlowEquivalence",
      "privateStateGenerationEquivalence",
    ]);
  });

  test("schema uses the same named decomposition as obligations", () => {
    const schema = specializationResidualEquivalenceSchema();

    expect(schema.schemaId).toBe(passInvariantSchemaId("specializationResidualEquivalence"));
    expect(schema.passId).toBe(optimizationPassId("whole-program-specialization"));
    expect(schema.checker).toBe(passInvariantCheckerId("specialization-residual-equivalence"));
    expect(schema.decomposesTo.map((entry) => entry.kind)).toContain(
      "terminalReachabilityEquivalence",
    );
    expect(Object.isFrozen(schema.decomposesTo)).toBe(true);
  });
});
