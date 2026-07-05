import { describe, expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { proofMirPlaceId } from "../../../src/proof-mir/ids";
import { validateProofMirGraph } from "../../../src/proof-mir/validation/graph-validator";
import {
  proofMirValidatorFunctionFake,
  proofMirValidatorProgramFake,
  validatorOrigin,
} from "../../support/proof-mir/validator-program-fakes";

describe("W2-01c non-scalar reference validation", () => {
  test("reports deterministic dangling-reference diagnostics with the reference category", () => {
    const missingPlace = proofMirPlaceId(404);
    const diagnostics = validateProofMirGraph(
      proofMirValidatorProgramFake([
        proofMirValidatorFunctionFake({
          statements: [
            {
              statementId: 0 as never,
              origin: validatorOrigin("missing-place"),
              kind: { kind: "consumePlace", place: missingPlace, reason: "move" },
            },
          ],
        }),
      ]),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_DANGLING_REFERENCE"),
    );
    expect(diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      `category:place:statement:0:${String(missingPlace)}`,
    );
  });
});
