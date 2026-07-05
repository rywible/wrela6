import { describe, expect, test } from "bun:test";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirScopeId,
} from "../../../src/proof-mir/ids";
import { deriveProofMirPredecessorSets } from "../../../src/proof-mir/validation/graph-validator";
import {
  proofMirControlEdgeFake,
  proofMirTerminatorFake,
  proofMirValidatorFunctionFake,
  validatorOrigin,
} from "../../support/proof-mir/validator-program-fakes";

describe("W1-06a proof MIR derived predecessor sets", () => {
  test("derives incoming edge sets from source terminators and edge targets", () => {
    const firstEdge = proofMirControlEdgeId(1);
    const secondEdge = proofMirControlEdgeId(2);
    const firstBlock = proofMirBlockId(0);
    const secondBlock = proofMirBlockId(1);
    const targetBlock = proofMirBlockId(2);
    const scopeId = proofMirScopeId(0);
    const origin = validatorOrigin("w1-06a");
    const functionGraph = proofMirValidatorFunctionFake({
      blocks: [
        {
          blockId: firstBlock,
          scopeId,
          parameters: [],
          statements: [],
          terminator: {
            ...proofMirTerminatorFake({
              kind: "goto",
              target: { edgeId: firstEdge, blockId: targetBlock },
            }),
            outgoingEdges: [firstEdge],
          },
          incomingEdges: [],
          origin,
        },
        {
          blockId: secondBlock,
          scopeId,
          parameters: [],
          statements: [],
          terminator: {
            ...proofMirTerminatorFake({
              kind: "goto",
              target: { edgeId: secondEdge, blockId: targetBlock },
            }),
            outgoingEdges: [secondEdge],
          },
          incomingEdges: [],
          origin,
        },
        {
          blockId: targetBlock,
          scopeId,
          parameters: [],
          statements: [],
          terminator: proofMirTerminatorFake({ kind: "unreachable", reason: "afterNever" }),
          incomingEdges: [],
          origin,
        },
      ],
      edges: [
        proofMirControlEdgeFake({
          edgeId: firstEdge,
          fromBlockId: firstBlock,
          toBlockId: targetBlock,
        }),
        proofMirControlEdgeFake({
          edgeId: secondEdge,
          fromBlockId: secondBlock,
          toBlockId: targetBlock,
        }),
      ],
    });

    expect(deriveProofMirPredecessorSets(functionGraph).get(targetBlock)).toEqual(
      new Set([firstEdge, secondEdge]),
    );
  });
});
