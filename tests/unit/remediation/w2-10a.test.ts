import { describe, expect, test } from "bun:test";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { proofMirBlockId, proofMirControlEdgeId } from "../../../src/proof-mir/ids";
import { validateProofMirGraph } from "../../../src/proof-mir/validation/graph-validator";
import {
  proofMirControlEdgeFake,
  proofMirTerminatorFake,
  proofMirValidatorFunctionFake,
  proofMirValidatorProgramFake,
  validatorOrigin,
} from "../../support/proof-mir/validator-program-fakes";

describe("W2-10a reducibility tripwire", () => {
  test("rejects a retreating edge whose target does not dominate its source", () => {
    const block0 = proofMirBlockId(0);
    const block1 = proofMirBlockId(1);
    const block2 = proofMirBlockId(2);
    const edge01 = proofMirControlEdgeId(1);
    const edge02 = proofMirControlEdgeId(2);
    const edge12 = proofMirControlEdgeId(3);
    const edge21 = proofMirControlEdgeId(4);

    const diagnostics = validateProofMirGraph(
      proofMirValidatorProgramFake([
        proofMirValidatorFunctionFake({
          blocks: [
            {
              blockId: block0,
              scopeId: 0 as never,
              parameters: [],
              statements: [],
              terminator: {
                ...proofMirTerminatorFake({
                  kind: "branch",
                  condition: 0 as never,
                  whenTrue: { edgeId: edge01, blockId: block1 },
                  whenFalse: { edgeId: edge02, blockId: block2 },
                }),
                outgoingEdges: [edge01, edge02],
              },
              incomingEdges: [],
              origin: validatorOrigin("b0"),
            },
            {
              blockId: block1,
              scopeId: 0 as never,
              parameters: [],
              statements: [],
              terminator: {
                ...proofMirTerminatorFake({
                  kind: "goto",
                  target: { edgeId: edge12, blockId: block2 },
                }),
                outgoingEdges: [edge12],
              },
              incomingEdges: [edge01, edge21],
              origin: validatorOrigin("b1"),
            },
            {
              blockId: block2,
              scopeId: 0 as never,
              parameters: [],
              statements: [],
              terminator: {
                ...proofMirTerminatorFake({
                  kind: "goto",
                  target: { edgeId: edge21, blockId: block1 },
                }),
                outgoingEdges: [edge21],
              },
              incomingEdges: [edge02, edge12],
              origin: validatorOrigin("b2"),
            },
          ],
          values: [
            {
              valueId: 0 as never,
              type: {} as never,
              resourceKind: "Copy",
              representation: { kind: "runtime" },
              origin: validatorOrigin("cond"),
            },
          ],
          edges: [
            proofMirControlEdgeFake({
              edgeId: edge01,
              fromBlockId: block0,
              toBlockId: block1,
              kind: "branchTrue",
            }),
            proofMirControlEdgeFake({
              edgeId: edge02,
              fromBlockId: block0,
              toBlockId: block2,
              kind: "branchFalse",
            }),
            proofMirControlEdgeFake({ edgeId: edge12, fromBlockId: block1, toBlockId: block2 }),
            proofMirControlEdgeFake({ edgeId: edge21, fromBlockId: block2, toBlockId: block1 }),
          ],
        }),
      ]),
    );

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      proofMirDiagnosticCode("PROOF_MIR_IRREDUCIBLE_CFG"),
    );
  });
});
