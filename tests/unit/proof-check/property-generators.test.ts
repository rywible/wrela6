import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { checkProofAndResources } from "../../../src/proof-check/proof-checker";
import { validateProofCheckInput } from "../../../src/proof-check/validation/input-validator";
import {
  checkProofAndResourcesForTest,
  proofCheckClosedFixture,
} from "../../support/proof-check/proof-check-fixtures";
import {
  checkedFactPacketStableKeysForTest,
  proofCheckResultStableKey,
  proofMirProgramMetricsForTest,
  proofMirProgramShapesForTest,
  proofMirProgramTemplateShapesForTest,
  proofMirProgramWithinBoundsForTest,
  PROOF_MIR_PROGRAM_BOUNDS,
  smallProofMirProgramArbitrary,
  stableJsonForTest,
  type ProofMirProgramShape,
} from "../../support/proof-check/property-generators";

const REQUIRED_SHAPES: readonly ProofMirProgramShape[] = [
  "acyclicBranch",
  "reachableSourceCall",
  "validationSplit",
  "attemptSplit",
  "terminalExit",
];

describe("smallProofMirProgramArbitrary", () => {
  test("generated programs pass proof-check input validation", () => {
    fastCheck.assert(
      fastCheck.property(smallProofMirProgramArbitrary(), (mir) => {
        const input = proofCheckClosedFixture({ mir });
        expect(validateProofCheckInput(input).diagnostics).toEqual([]);
      }),
    );
  });

  test("generated programs stay within bounded limits", () => {
    fastCheck.assert(
      fastCheck.property(smallProofMirProgramArbitrary(), (mir) => {
        const metrics = proofMirProgramMetricsForTest(mir);
        expect(metrics.functions).toBeLessThanOrEqual(PROOF_MIR_PROGRAM_BOUNDS.maxFunctions);
        expect(metrics.maxBlocksPerFunction).toBeLessThanOrEqual(
          PROOF_MIR_PROGRAM_BOUNDS.maxBlocksPerFunction,
        );
        expect(metrics.maxEdgesPerFunction).toBeLessThanOrEqual(
          PROOF_MIR_PROGRAM_BOUNDS.maxEdgesPerFunction,
        );
        expect(metrics.facts).toBeLessThanOrEqual(PROOF_MIR_PROGRAM_BOUNDS.maxFacts);
        expect(metrics.places).toBeLessThanOrEqual(PROOF_MIR_PROGRAM_BOUNDS.maxPlaces);
        expect(metrics.loans).toBeLessThanOrEqual(PROOF_MIR_PROGRAM_BOUNDS.maxLoans);
        expect(metrics.obligations).toBeLessThanOrEqual(PROOF_MIR_PROGRAM_BOUNDS.maxObligations);
        expect(metrics.validations).toBeLessThanOrEqual(PROOF_MIR_PROGRAM_BOUNDS.maxValidations);
        expect(metrics.attempts).toBeLessThanOrEqual(PROOF_MIR_PROGRAM_BOUNDS.maxAttempts);
        expect(metrics.exits).toBeLessThanOrEqual(PROOF_MIR_PROGRAM_BOUNDS.maxExits);
        expect(proofMirProgramWithinBoundsForTest(mir)).toBe(true);
      }),
    );
  });

  test("generator covers required structural shapes across 100 runs", () => {
    const seen = new Set<ProofMirProgramShape>();
    const templateShapes = proofMirProgramTemplateShapesForTest();

    fastCheck.assert(
      fastCheck.property(smallProofMirProgramArbitrary(), (mir) => {
        for (const shape of proofMirProgramShapesForTest(mir)) {
          seen.add(shape);
        }
        const templateOwnedShapes = templateShapes.get(mir);
        if (templateOwnedShapes !== undefined) {
          for (const shape of templateOwnedShapes) {
            expect(proofMirProgramShapesForTest(mir)).toContain(shape);
          }
        }
      }),
      { numRuns: 100 },
    );

    for (const shape of REQUIRED_SHAPES) {
      expect(seen.has(shape)).toBe(true);
    }
  });
});

describe("proofCheckResultStableKey", () => {
  test("stable key excludes rendered diagnostic messages for error results", () => {
    const input = proofCheckClosedFixture({ invalidCase: "missing-platform-precondition" });
    const result = checkProofAndResourcesForTest(input);

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      return;
    }

    const stableKey = proofCheckResultStableKey(result);
    for (const diagnostic of result.diagnostics) {
      expect(stableKey.includes(diagnostic.message)).toBe(false);
    }
    expect(stableKey).toContain("PROOF_CHECK");
  });

  test("stable key includes checked summaries and packet keys for accepted results", () => {
    const input = proofCheckClosedFixture();
    const result = checkProofAndResources(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }

    const stableKey = proofCheckResultStableKey(result);
    const parsed = JSON.parse(stableKey) as {
      kind: string;
      checkedFunctions: readonly unknown[];
      summaries: readonly unknown[];
      terminalGraph: string;
      packet: Record<string, readonly string[]>;
    };

    expect(parsed.kind).toBe("ok");
    expect(parsed.checkedFunctions.length).toBeGreaterThan(0);
    expect(parsed.summaries.length).toBeGreaterThan(0);
    expect(parsed.terminalGraph.length).toBeGreaterThan(0);
    expect(stableJsonForTest(parsed)).toBe(stableKey);
  });

  test("repeated runs produce identical stable keys", () => {
    fastCheck.assert(
      fastCheck.property(smallProofMirProgramArbitrary(), (mir) => {
        const input = proofCheckClosedFixture({ mir });
        const first = checkProofAndResources(input);
        const second = checkProofAndResources(input);
        expect(proofCheckResultStableKey(first)).toBe(proofCheckResultStableKey(second));
      }),
      { numRuns: 25 },
    );
  });
});

describe("checkedFactPacketStableKeysForTest", () => {
  test("returns deterministic packet entry keys grouped by kind", () => {
    const input = proofCheckClosedFixture();
    const result = checkProofAndResources(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }

    const first = checkedFactPacketStableKeysForTest(result.checked.facts);
    const second = checkedFactPacketStableKeysForTest(result.checked.facts);
    expect(first).toEqual(second);
  });
});
