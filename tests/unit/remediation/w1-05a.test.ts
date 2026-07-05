import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { createDraftGraphBuilder } from "../../../src/proof-mir/draft/draft-graph-builder";

describe("W1-05a draft control-edge roles", () => {
  test("two if branch sites in one function produce distinct branch edge keys", () => {
    const graph = createDraftGraphBuilder({ functionInstanceId: monoInstanceId("fn:w1-05a") });
    const rootScope = graph.rootScopeKey();
    const firstOrigin = graph.allocateSyntheticOrigin("if:first");
    const secondOrigin = graph.allocateSyntheticOrigin("if:second");
    const firstBranch = graph.createBlock({
      role: "branch:first",
      scope: rootScope,
      origin: firstOrigin,
    });
    const secondBranch = graph.createBlock({
      role: "branch:second",
      scope: rootScope,
      origin: secondOrigin,
    });
    const thenBlock = graph.createBlock({ role: "then", scope: rootScope, origin: firstOrigin });
    const elseBlock = graph.createBlock({ role: "else", scope: rootScope, origin: firstOrigin });

    const edgeKeys = [
      graph.createBranchEdge({
        kind: "branchTrue",
        fromBlock: firstBranch,
        toBlock: thenBlock,
        sourceScope: rootScope,
        targetScope: rootScope,
        origin: firstOrigin,
      }),
      graph.createBranchEdge({
        kind: "branchFalse",
        fromBlock: firstBranch,
        toBlock: elseBlock,
        sourceScope: rootScope,
        targetScope: rootScope,
        origin: firstOrigin,
      }),
      graph.createBranchEdge({
        kind: "branchTrue",
        fromBlock: secondBranch,
        toBlock: thenBlock,
        sourceScope: rootScope,
        targetScope: rootScope,
        origin: secondOrigin,
      }),
      graph.createBranchEdge({
        kind: "branchFalse",
        fromBlock: secondBranch,
        toBlock: elseBlock,
        sourceScope: rootScope,
        targetScope: rootScope,
        origin: secondOrigin,
      }),
    ];

    expect(new Set(edgeKeys).size).toBe(edgeKeys.length);
  });
});
