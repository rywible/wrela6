import { describe, expect, test } from "bun:test";
import { buildProofMir } from "../../../src/proof-mir";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { targetId } from "../../../src/semantic/ids";
import { closedProofMirFixture } from "../../support/proof-mir/proof-mir-fixtures";

describe("buildProofMir", () => {
  test("successful minimal program returns frozen Proof MIR", () => {
    const result = buildProofMir(closedProofMirFixture());

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.mir.image.externalRoots.map((root) => root.reason)).toContain("imageEntry");
    expect(result.mir.functions.entries().length).toBeGreaterThan(0);
    expect(result.mir.layout).toBeDefined();
    expect(result.mir.proofMetadata).toBeDefined();
    expect(result.mir.origins).toBeDefined();
    expect(result.mir.facts).toBeDefined();
    expect(result.mir.layoutTerms).toBeDefined();
    expect(result.mir.privateStateGenerations).toBeDefined();
    expect(result.mir.callGraph).toBeDefined();
    expect(result.mir.platformEdges).toBeDefined();
    expect(result.mir.runtimeCatalog).toBeDefined();
    expect(result.mir.runtimeCalls).toBeDefined();
    expect(result.mir.reachableFunctions).toBeDefined();
    expect(result.diagnostics.every((diagnostic) => diagnostic.severity !== "error")).toBe(true);
  });

  test("proof mir preserves explicit reachable function closure", () => {
    const input = closedProofMirFixture();
    const result = buildProofMir(input);

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    expect(result.mir.reachableFunctions.entries().map((entry) => entry.reason)).toEqual([
      "imageEntry",
    ]);
    expect(result.mir.reachableFunctions.has(result.mir.image.entryFunctionInstanceId)).toBe(true);
  });

  test("compatibility failure returns error diagnostics without mir", () => {
    const input = closedProofMirFixture();
    const result = buildProofMir({
      ...input,
      target: {
        ...input.target,
        targetId: targetId("different-target"),
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") return;
    expect("mir" in result).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_INPUT_LAYOUT_MISMATCH"),
    );
  });
});
