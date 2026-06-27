import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  explicitOrdinaryReturnProofMirFixture,
  ifReturnProofMirFixture,
  loopReturnProofMirFixture,
  matchProofMirFixture,
  nestedBranchProofMirFixture,
  proofMirSummary,
} from "../../support/proof-mir/proof-mir-fixtures";
import { panicExitProofMirFixture } from "../../support/proof-mir/integration-fixtures";

describe("buildProofMir explicit exits", () => {
  test("ordinary return keeps returnExit control edges explicit", () => {
    const result = buildProofMir(explicitOrdinaryReturnProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"returnExit"');
    expect(summary).toMatchSnapshot();
  });

  test("conditional return arms keep returnExit edges on each exit path", () => {
    const result = buildProofMir(ifReturnProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"branchTrue"');
    expect(summary).toContain('"kind":"returnExit"');
    expect(summary).toMatchSnapshot();
  });

  test("if else returns keep both branch arms and returnExit edges explicit", () => {
    const result = buildProofMir(nestedBranchProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"branchTrue"');
    expect(summary).toContain('"kind":"branchFalse"');
    expect(summary).toContain('"kind":"returnExit"');
    expect(summary).toMatchSnapshot();
  });

  test("loop body return keeps returnExit on the loop exit path", () => {
    const result = buildProofMir(loopReturnProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"returnExit"');
    expect(summary).toMatchSnapshot();
  });

  test("reachable mono error rejects build without panic exit", () => {
    const result = buildProofMir(panicExitProofMirFixture());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_REACHABLE_MONO_ERROR"),
    );
    expect("mir" in result).toBe(false);
  });

  test("match arm returns keep switch cases and returnExit edges explicit", () => {
    const result = buildProofMir(matchProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const summary = proofMirSummary(result.mir);
    expect(summary).toContain('"kind":"switchCase"');
    expect(summary).toContain('"kind":"returnExit"');
    expect(summary).toMatchSnapshot();
  });
});
