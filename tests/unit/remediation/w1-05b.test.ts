import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import { createDraftGraphBuilder } from "../../../src/proof-mir/draft/draft-graph-builder";

describe("W1-05b draft graph duplicate edge keys", () => {
  test("rejects duplicate control edge keys before overwriting edge state", () => {
    const graph = createDraftGraphBuilder({ functionInstanceId: monoInstanceId("fn:w1-05b") });
    const rootScope = graph.rootScopeKey();
    const origin = graph.allocateSyntheticOrigin("duplicate-edge");
    const source = graph.createBlock({ role: "source", scope: rootScope, origin });
    const firstTarget = graph.createBlock({ role: "first-target", scope: rootScope, origin });

    const edgeKey = graph.createNormalEdge({
      role: "same-role",
      fromBlock: source,
      toBlock: firstTarget,
      sourceScope: rootScope,
      targetScope: rootScope,
      origin,
    });

    expect(() =>
      graph.createNormalEdge({
        role: "same-role",
        fromBlock: source,
        toBlock: firstTarget,
        sourceScope: rootScope,
        targetScope: rootScope,
        origin,
      }),
    ).toThrow(/duplicate.*edge/i);
    expect(graph.edge(edgeKey).toBlockKey).toBe(firstTarget);
  });

  test("rejects duplicate exit keys before overwriting exit state", () => {
    const graph = createDraftGraphBuilder({ functionInstanceId: monoInstanceId("fn:w1-05b-exit") });
    const rootScope = graph.rootScopeKey();
    const origin = graph.allocateSyntheticOrigin("duplicate-exit");
    const source = graph.createBlock({ role: "source", scope: rootScope, origin });

    graph.createReturnExit({ fromBlock: source, origin, terminal: false });

    expect(() => graph.createReturnExit({ fromBlock: source, origin, terminal: false })).toThrow(
      /duplicate.*exit/i,
    );
  });
});
