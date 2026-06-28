import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { checkProofAndResources } from "../../../src/proof-check/proof-checker";
import { proofCheckClosedFixture } from "../../support/proof-check/proof-check-fixtures";
import {
  proofCheckResultStableKey,
  smallProofMirProgramArbitrary,
} from "../../support/proof-check/property-generators";

describe("proof-check property determinism", () => {
  test("small generated proof-check programs are deterministic", () => {
    fastCheck.assert(
      fastCheck.property(smallProofMirProgramArbitrary(), (program) => {
        const input = proofCheckClosedFixture({ mir: program });
        const first = checkProofAndResources(input);
        const second = checkProofAndResources(input);
        expect(proofCheckResultStableKey(first)).toBe(proofCheckResultStableKey(second));
      }),
    );
  });
});
