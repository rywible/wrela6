import { describe, expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirScopeId,
} from "../../../src/proof-mir/ids";
import { validateProofMirGraph } from "../../../src/proof-mir/validation/graph-validator";
import {
  proofMirControlEdgeFake,
  proofMirTerminatorFake,
  proofMirValidatorFunctionFake,
  proofMirValidatorProgramFake,
  validatorOrigin,
} from "../../support/proof-mir/validator-program-fakes";

describe("W1-06b proof MIR incoming edge mismatch diagnostics", () => {
  test("diagnoses missing, extra, duplicate, and wrong-from-block stored incoming edges", () => {
    const sourceBlock = proofMirBlockId(0);
    const otherSourceBlock = proofMirBlockId(1);
    const targetBlock = proofMirBlockId(2);
    const missingStoredEdge = proofMirControlEdgeId(1);
    const duplicateStoredEdge = proofMirControlEdgeId(2);
    const wrongFromBlockEdge = proofMirControlEdgeId(3);
    const extraStoredEdge = proofMirControlEdgeId(4);
    const scopeId = proofMirScopeId(0);
    const origin = validatorOrigin("w1-06b");
    const program = proofMirValidatorProgramFake([
      proofMirValidatorFunctionFake({
        blocks: [
          {
            blockId: sourceBlock,
            scopeId,
            parameters: [],
            statements: [],
            terminator: {
              ...proofMirTerminatorFake({
                kind: "branch",
                condition: 0 as never,
                whenTrue: { edgeId: missingStoredEdge, blockId: targetBlock },
                whenFalse: { edgeId: duplicateStoredEdge, blockId: targetBlock },
              }),
              outgoingEdges: [missingStoredEdge, duplicateStoredEdge, wrongFromBlockEdge],
            },
            incomingEdges: [],
            origin,
          },
          {
            blockId: otherSourceBlock,
            scopeId,
            parameters: [],
            statements: [],
            terminator: proofMirTerminatorFake({ kind: "unreachable", reason: "afterNever" }),
            incomingEdges: [],
            origin,
          },
          {
            blockId: targetBlock,
            scopeId,
            parameters: [],
            statements: [],
            terminator: proofMirTerminatorFake({ kind: "unreachable", reason: "afterNever" }),
            incomingEdges: [duplicateStoredEdge, duplicateStoredEdge, extraStoredEdge],
            origin,
          },
        ],
        edges: [
          proofMirControlEdgeFake({
            edgeId: missingStoredEdge,
            fromBlockId: sourceBlock,
            toBlockId: targetBlock,
            kind: "branchTrue",
          }),
          proofMirControlEdgeFake({
            edgeId: duplicateStoredEdge,
            fromBlockId: sourceBlock,
            toBlockId: targetBlock,
            kind: "branchFalse",
          }),
          proofMirControlEdgeFake({
            edgeId: wrongFromBlockEdge,
            fromBlockId: otherSourceBlock,
            toBlockId: targetBlock,
          }),
          proofMirControlEdgeFake({
            edgeId: extraStoredEdge,
            fromBlockId: otherSourceBlock,
            toBlockId: targetBlock,
          }),
        ],
      }),
    ]);

    const diagnostics = validateProofMirGraph(program).filter(
      (diagnostic) =>
        diagnostic.code === proofMirDiagnosticCode("PROOF_MIR_INCOMING_EDGES_MISMATCH"),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      `incoming-edges:${String(targetBlock)}:missing:${String(missingStoredEdge)},${String(
        wrongFromBlockEdge,
      )}:extra:${String(extraStoredEdge)}:duplicate:${String(duplicateStoredEdge)}`,
    );
  });
});
