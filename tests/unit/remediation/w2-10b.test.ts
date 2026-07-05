import { describe, expect, test } from "bun:test";
import {
  proofMirBlockId,
  proofMirControlEdgeId,
  proofMirValueId,
} from "../../../src/proof-mir/ids";
import { validateProofMirGraphWithSummary } from "../../../src/proof-mir/validation/graph-validator";
import {
  proofMirBlockParameterFake,
  proofMirControlEdgeFake,
  proofMirTerminatorFake,
  proofMirValidatorFunctionFake,
  proofMirValidatorProgramFake,
  proofMirValueFake,
  validatorOrigin,
} from "../../support/proof-mir/validator-program-fakes";

describe("W2-10b critical edge summary", () => {
  test("counts multi-successor to multi-predecessor edges without diagnostics", () => {
    const entry = proofMirBlockId(0);
    const left = proofMirBlockId(1);
    const join = proofMirBlockId(2);
    const edgeLeft = proofMirControlEdgeId(1);
    const criticalEdge = proofMirControlEdgeId(2);
    const edgeJoin = proofMirControlEdgeId(3);
    const condition = proofMirValueId(1);
    const joinParameter = proofMirValueId(2);

    const result = validateProofMirGraphWithSummary(
      proofMirValidatorProgramFake([
        proofMirValidatorFunctionFake({
          blocks: [
            {
              blockId: entry,
              scopeId: 0 as never,
              parameters: [proofMirBlockParameterFake({ valueId: condition })],
              statements: [],
              terminator: {
                ...proofMirTerminatorFake({
                  kind: "branch",
                  condition,
                  whenTrue: { edgeId: edgeLeft, blockId: left },
                  whenFalse: { edgeId: criticalEdge, blockId: join },
                }),
                outgoingEdges: [edgeLeft, criticalEdge],
              },
              incomingEdges: [],
              origin: validatorOrigin("entry"),
            },
            {
              blockId: left,
              scopeId: 0 as never,
              parameters: [],
              statements: [],
              terminator: {
                ...proofMirTerminatorFake({
                  kind: "goto",
                  target: { edgeId: edgeJoin, blockId: join },
                }),
                outgoingEdges: [edgeJoin],
              },
              incomingEdges: [edgeLeft],
              origin: validatorOrigin("left"),
            },
            {
              blockId: join,
              scopeId: 0 as never,
              parameters: [proofMirBlockParameterFake({ valueId: joinParameter })],
              statements: [],
              terminator: proofMirTerminatorFake({ kind: "unreachable", reason: "afterNever" }),
              incomingEdges: [criticalEdge, edgeJoin],
              origin: validatorOrigin("join"),
            },
          ],
          edges: [
            proofMirControlEdgeFake({
              edgeId: edgeLeft,
              fromBlockId: entry,
              toBlockId: left,
              kind: "branchTrue",
            }),
            proofMirControlEdgeFake({
              edgeId: criticalEdge,
              fromBlockId: entry,
              toBlockId: join,
              kind: "branchFalse",
              arguments: [joinParameter],
            }),
            proofMirControlEdgeFake({
              edgeId: edgeJoin,
              fromBlockId: left,
              toBlockId: join,
              arguments: [joinParameter],
            }),
          ],
          values: [
            proofMirValueFake({ valueId: condition }),
            proofMirValueFake({ valueId: joinParameter }),
          ],
        }),
      ]),
    );

    expect(result.summary.criticalEdgeCount).toBe(1);
    expect(result.diagnostics).toEqual([]);
  });
});
