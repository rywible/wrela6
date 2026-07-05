import { expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { lowerProofMirOrdinaryForForTest } from "../../support/proof-mir/lower-harness/iterator-lowerer-harness";

test("W1-17c reports stream-loop rejection at the real for statement origin", () => {
  const result = lowerProofMirOrdinaryForForTest({
    source: ["for event in stream packets:", "    take event"],
    iteratorProtocol: "stream",
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;

  const gateDiagnostic = result.diagnostics.find(
    (diagnostic) => diagnostic.code === proofMirDiagnosticCode("PROOF_MIR_MISSING_SEMANTICS_GATE"),
  );

  expect(gateDiagnostic?.sourceOrigin).toBe("source:stmt:for");
  expect(gateDiagnostic?.stableDetail).toBe("sourceOrigin:source:stmt:for");
});
