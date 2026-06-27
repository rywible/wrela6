import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  ordinaryIteratorProofMirFixture,
  proofMirSummary,
  streamForLoopProofMirFixture,
} from "../../support/proof-mir/proof-mir-fixtures";

describe("iterator protocol integration", () => {
  test("ordinary checked iterator for keeps loop and protocol edges explicit", () => {
    const result = buildProofMir(ordinaryIteratorProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") {
      return;
    }

    const summary = JSON.parse(proofMirSummary(result.mir));
    const iteratorFunction = summary.functions.find(
      (functionGraph: { functionInstanceId: string }) =>
        functionGraph.functionInstanceId === "fn:iterator-protocol",
    );
    expect(iteratorFunction).toBeDefined();
    if (iteratorFunction === undefined) {
      return;
    }

    expect(iteratorFunction.blocks.length).toBeGreaterThan(1);
    expect(iteratorFunction.edges.length).toBeGreaterThan(0);
    expect(
      iteratorFunction.edges.some((edge: { effects: readonly { kind: string }[] }) =>
        edge.effects.some((effect) => effect.kind === "introducePlace"),
      ),
    ).toBe(true);
    expect(
      iteratorFunction.edges.some((edge: { effects: readonly { kind: string }[] }) =>
        edge.effects.some((effect) => effect.kind === "dischargeObligation"),
      ),
    ).toBe(true);
    expect(summary.proofMetadata.callSiteRequirements.length).toBeGreaterThan(0);
    expect(summary.proofMetadata.obligations.length).toBeGreaterThan(0);

    expect(proofMirSummary(result.mir)).toMatchSnapshot();
  });

  test("stream for returns semantics gate without successful Proof MIR", () => {
    const result = buildProofMir(streamForLoopProofMirFixture());

    expect(result.kind).toBe("error");
    if (result.kind !== "error") {
      return;
    }

    expect("mir" in result).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_SEMANTICS_GATE"),
    );

    expect(
      JSON.stringify(
        result.diagnostics.map((diagnostic) => ({
          code: diagnostic.code,
          message: diagnostic.message,
          rootCauseKey: diagnostic.rootCauseKey,
        })),
      ),
    ).toMatchSnapshot();
  });
});
