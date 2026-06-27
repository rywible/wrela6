import { describe, expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { lowerProofMirOrdinaryForForTest } from "../../support/proof-mir/lower-harness/iterator-lowerer-harness";

describe("ProofMirIteratorLowerer", () => {
  test("ordinary iterator for lowers next result into item and finished edges", () => {
    const lowered = lowerProofMirOrdinaryForForTest({
      source: ["for byte in packet.bytes():", "    sum = sum + byte", "return sum"],
      iteratorProtocol: "checkedIterator",
      scalarLocals: ["sum", "byte"],
      loopCarriedLocals: ["sum"],
      placeBackedLocals: ["packet"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.header.kind).toBe("loopHeader");
    expect(lowered.nextCall.target.kind).toBe("sourceFunction");
    expect(lowered.itemEdge.effects.map((effect) => effect.kind)).toContain("introducePlace");
    expect(lowered.finishedEdge.facts.map((fact) => fact.kind.kind)).toContain("runtimeEnsured");
  });

  test("stream for remains gated in the core lowerer", () => {
    const result = lowerProofMirOrdinaryForForTest({
      source: ["for event in stream packets:", "    take event"],
      iteratorProtocol: "stream",
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_MISSING_SEMANTICS_GATE"),
    );
  });

  test("iterator state stays in boundary resources not header parameters", () => {
    const lowered = lowerProofMirOrdinaryForForTest({
      source: ["for byte in packet.bytes():", "    sum = sum + byte", "return sum"],
      iteratorProtocol: "checkedIterator",
      scalarLocals: ["sum", "byte"],
      loopCarriedLocals: ["sum"],
      placeBackedLocals: ["packet"],
    });

    expect(lowered.kind).toBe("ok");
    if (lowered.kind !== "ok") return;

    expect(lowered.header.parameters).toHaveLength(1);
    expect(lowered.header.boundaryResources?.places.length).toBeGreaterThan(0);
  });
});
