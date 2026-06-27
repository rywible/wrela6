import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir";
import {
  branchAndLoopProofMirFixture,
  loopReturnProofMirFixture,
  matchProofMirFixture,
  nestedBranchProofMirFixture,
  proofMirSummary,
  whileLoopMutationProofMirFixture,
} from "../../support/proof-mir/proof-mir-fixtures";

describe("buildProofMir CFG shape", () => {
  test("branch and loop shape keeps joins and loop-carried values explicit", () => {
    const result = buildProofMir(branchAndLoopProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(proofMirSummary(result.mir)).toMatchSnapshot();
  });

  test("while loop mutation keeps loop-carried scalar parameters explicit", () => {
    const result = buildProofMir(whileLoopMutationProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"scopeBreak"');
    expect(summary).toContain('"text":"1"');
    expect(summary).toMatchSnapshot();
  });

  test("nested branch shape keeps explicit branch edges and arm targets", () => {
    const result = buildProofMir(nestedBranchProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"branchTrue"');
    expect(summary).toContain('"kind":"branchFalse"');
    expect(summary).toContain('"kind":"returnExit"');
    expect(summary).toMatchSnapshot();
  });

  test("loop shape keeps header, body, and back-edge references explicit", () => {
    const result = buildProofMir(loopReturnProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"normal"');
    expect(summary).toContain('"kind":"returnExit"');
    expect(summary).toMatchSnapshot();
  });

  test("match shape keeps deterministic switch cases and arm exits explicit", () => {
    const result = buildProofMir(matchProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"switchCase"');
    expect(summary).toContain('"kind":"returnExit"');
    expect(summary).toMatchSnapshot();
  });
});
