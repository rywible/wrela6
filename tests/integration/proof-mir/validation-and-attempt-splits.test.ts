import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir";
import { validationAttemptProofMirFixture } from "../../support/proof-mir/integration-fixtures";
import { proofMirSummary } from "../../support/proof-mir/proof-mir-fixtures";

describe("buildProofMir validation and attempt splits", () => {
  test("validation and attempt splits preserve edge-local bindings", () => {
    const result = buildProofMir(validationAttemptProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"validate"');
    expect(summary).toContain('"kind":"matchValidation"');
    expect(summary).toContain('"kind":"validationOk"');
    expect(summary).toContain('"kind":"validationErr"');
    expect(summary).toContain('"kind":"consumePlace"');
    expect(summary).toContain('"kind":"attempt"');
    expect(summary).toContain('"kind":"matchAttempt"');
    expect(summary).toContain('"kind":"attemptSuccess"');
    expect(summary).toContain('"kind":"attemptError"');
    expect(summary).toContain('"kind":"literal"');
    expect(summary).toMatchSnapshot();
  });
});
