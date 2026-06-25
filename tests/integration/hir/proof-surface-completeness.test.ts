import { expect, test } from "bun:test";
import { lowerTypedHirForTest } from "../../support/hir/typed-hir-fixtures";
import { targetWithCertifiedExit } from "../../support/hir/typed-hir-fakes";

function recognizeProofConstructs(source: string) {
  return {
    ensureCount: (source.match(/^\s*ensure\s+/gm) ?? []).length,
    terminalCalls: (source.match(/^\s*done\(\)/gm) ?? []).length,
    predicateCalls: (source.match(/^\s*ready\(\)/gm) ?? []).length,
    requirementCalls: (source.match(/^\s*guarded\(\)/gm) ?? []).length,
    platformCalls: (source.match(/^\s*exit\(\)/gm) ?? []).length,
    imageRoots: (source.match(/^\s*uefi image /gm) ?? []).length,
  };
}

test("proof-relevant source constructs have HIR metadata or fail-closed diagnostics", () => {
  const source = [
    "predicate fn ready() -> bool",
    "terminal fn done() -> Never",
    "platform fn exit() -> Never",
    "fn guarded() -> Never:",
    "    requires:",
    "        ready",
    "    done()",
    "fn caller(flag: bool) -> Never:",
    "    ensure flag",
    "    ready()",
    "    guarded()",
    "    exit()",
    "uefi image Boot:",
    "    fn main() -> Never",
  ].join("\n");
  const recognized = recognizeProofConstructs(source);
  const result = lowerTypedHirForTest([["main.wr", source]], {
    platformNames: ["exit"],
    targetSurface: targetWithCertifiedExit(),
  });
  const factKinds = result.program.proofMetadata.factOrigins
    .entries()
    .map((fact) => fact.fact?.kind);
  const diagnosticCodes = result.diagnostics.map((diagnostic) => diagnostic.code);

  expect(recognized.ensureCount).toBeGreaterThan(0);
  expect(factKinds).toContain("ensure");
  expect(recognized.predicateCalls).toBeGreaterThan(0);
  expect(factKinds).toContain("predicateCall");
  expect(recognized.terminalCalls).toBeGreaterThan(0);
  expect(result.program.proofMetadata.terminalCalls.entries().length).toBeGreaterThan(0);
  expect(recognized.requirementCalls).toBeGreaterThan(0);
  expect(result.program.proofMetadata.callSiteRequirements.entries().length).toBeGreaterThan(0);
  expect(recognized.platformCalls).toBeGreaterThan(0);
  expect(result.program.proofMetadata.platformContractEdges.entries().length).toBeGreaterThan(0);
  expect(recognized.imageRoots).toBeGreaterThan(0);
  expect(result.program.images.entries().length).toBeGreaterThan(0);
  expect(diagnosticCodes.filter((code) => code.startsWith("HIR_"))).toEqual([]);
});
