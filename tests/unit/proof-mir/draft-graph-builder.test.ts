import { describe, expect, test } from "bun:test";
import { hirLocalId } from "../../../src/hir/ids";
import { proofMirDiagnosticCode } from "../../../src/proof-mir/diagnostics";
import { createDraftGraphBuilder } from "../../../src/proof-mir/draft/draft-graph-builder";
import {
  draftBlockKey,
  draftControlEdgeKey,
  draftSiteDiscriminatedEdgeRole,
  draftScopeKey,
} from "../../../src/proof-mir/draft/draft-keys";
import { instantiatedHirId, monoInstanceId } from "../../../src/mono/ids";

describe("draft graph builder", () => {
  test("draft graph builder records explicit return edge and exit", () => {
    const graph = createDraftGraphBuilder({ functionInstanceId: monoInstanceId("fn:main") });
    const origin = graph.allocateSyntheticOrigin("return");
    const entry = graph.createBlock({ role: "entry", scope: graph.rootScopeKey(), origin });
    const exit = graph.createReturnExit({ fromBlock: entry, origin, terminal: false });

    graph.setTerminator(entry, {
      kind: "return",
      value: undefined,
      edge: exit.edge,
      exit: exit.exit,
      origin,
    });

    expect(graph.block(entry).terminator?.kind).toBe("return");
    expect(graph.edge(exit.edge).kind).toBe("returnExit");
  });

  test("creates root scope, entry block, parameters, statements, and branch edges", () => {
    const functionInstanceId = monoInstanceId("fn:main");
    const graph = createDraftGraphBuilder({ functionInstanceId });
    const origin = graph.allocateSyntheticOrigin("if");
    const rootScope = graph.rootScopeKey();
    const entry = graph.createBlock({ role: "entry", scope: rootScope, origin });
    const thenScope = graph.createScope({ role: "block", parentScopeKey: rootScope, origin });
    const thenBlock = graph.createBlock({ role: "then", scope: thenScope, origin });
    const elseBlock = graph.createBlock({ role: "else", scope: rootScope, origin });
    const joinBlock = graph.createBlock({ role: "join", scope: rootScope, origin });
    const thenValue = graph.createValue({ role: "then:x", origin });
    const elseValue = graph.createValue({ role: "else:x", origin });
    const joinValue = graph.createValue({ role: "join:x", origin });

    graph.addBlockParameter(joinBlock, {
      valueKey: joinValue,
      role: "copyScalar",
      origin,
    });
    graph.addStatement(thenBlock, {
      origin,
    });
    graph.addStatement(elseBlock, {
      origin,
    });

    const thenEdge = graph.createBranchEdge({
      kind: "branchTrue",
      fromBlock: entry,
      toBlock: thenBlock,
      sourceScope: rootScope,
      targetScope: thenScope,
      origin,
    });
    const elseEdge = graph.createBranchEdge({
      kind: "branchFalse",
      fromBlock: entry,
      toBlock: elseBlock,
      sourceScope: rootScope,
      targetScope: rootScope,
      origin,
    });
    const thenJoin = graph.createNormalEdge({
      fromBlock: thenBlock,
      toBlock: joinBlock,
      sourceScope: thenScope,
      targetScope: rootScope,
      origin,
      argumentKeys: [thenValue],
    });
    const elseJoin = graph.createNormalEdge({
      fromBlock: elseBlock,
      toBlock: joinBlock,
      sourceScope: rootScope,
      targetScope: rootScope,
      origin,
      argumentKeys: [elseValue],
    });

    graph.setTerminator(entry, {
      kind: "branch",
      condition: graph.createValue({ role: "cond", origin }),
      whenTrue: { edge: thenEdge, block: thenBlock },
      whenFalse: { edge: elseEdge, block: elseBlock },
      origin,
    });
    graph.setTerminator(thenBlock, {
      kind: "goto",
      target: { edge: thenJoin, block: joinBlock },
      origin,
    });
    graph.setTerminator(elseBlock, {
      kind: "goto",
      target: { edge: elseJoin, block: joinBlock },
      origin,
    });

    expect(graph.functionDraft().scopes.has(rootScope)).toBe(true);
    expect(graph.functionDraft().blocks.has(entry)).toBe(true);
    expect(graph.blockParameters(joinBlock)).toHaveLength(1);
    expect(graph.functionDraft().statements.entries()).toHaveLength(2);
    expect(graph.edge(thenEdge).kind).toBe("branchTrue");
    expect(graph.edge(elseEdge).kind).toBe("branchFalse");
    expect(graph.edge(thenJoin).argumentKeys).toEqual([thenValue]);
  });

  test("creates panic exit records", () => {
    const graph = createDraftGraphBuilder({ functionInstanceId: monoInstanceId("fn:main") });
    const origin = graph.allocateSyntheticOrigin("panic");
    const entry = graph.createBlock({ role: "entry", scope: graph.rootScopeKey(), origin });
    const exit = graph.createPanicExit({ fromBlock: entry, origin });

    graph.setTerminator(entry, {
      kind: "panic",
      reason: undefined,
      edge: exit.edge,
      exit: exit.exit,
      origin,
    });

    expect(graph.edge(exit.edge).kind).toBe("panicExit");
    expect(graph.functionDraft().exitEdges.has(exit.exit)).toBe(true);
  });

  test("creates locals and places", () => {
    const functionInstanceId = monoInstanceId("fn:main");
    const graph = createDraftGraphBuilder({ functionInstanceId });
    const origin = graph.allocateSyntheticOrigin("local");
    const local = graph.createLocal({
      monoLocalId: instantiatedHirId(functionInstanceId, hirLocalId(0)),
      name: "x",
      origin,
    });
    const place = graph.createPlace({
      monoPlaceCanonicalKey: "function:main/root:local:0/projection:/type:core:u8/kind:Copy",
      origin,
    });

    expect(graph.functionDraft().locals.has(local)).toBe(true);
    expect(graph.functionDraft().places.has(place)).toBe(true);
  });

  test("rejects setting a terminator twice", () => {
    const graph = createDraftGraphBuilder({ functionInstanceId: monoInstanceId("fn:main") });
    const origin = graph.allocateSyntheticOrigin("entry");
    const entry = graph.createBlock({ role: "entry", scope: graph.rootScopeKey(), origin });

    graph.setTerminator(entry, {
      kind: "unreachable",
      reason: "afterNever",
      origin,
    });

    const second = graph.setTerminator(entry, {
      kind: "unreachable",
      reason: "duplicate-attempt",
      origin,
    });
    expect(second.kind).toBe("error");
    if (second.kind === "error") {
      expect(second.diagnostics[0]?.code).toBe(proofMirDiagnosticCode("PROOF_MIR_INVALID_CFG"));
      expect(second.diagnostics[0]?.rootCauseKey).toBe("duplicate-terminator");
    }
  });

  test("rejects finalizing a block twice", () => {
    const graph = createDraftGraphBuilder({ functionInstanceId: monoInstanceId("fn:main") });
    const origin = graph.allocateSyntheticOrigin("entry");
    const entry = graph.createBlock({ role: "entry", scope: graph.rootScopeKey(), origin });

    graph.setTerminator(entry, {
      kind: "unreachable",
      reason: "afterNever",
      origin,
    });

    expect(graph.finalizeBlock(entry).kind).toBe("ok");
    const second = graph.finalizeBlock(entry);
    expect(second.kind).toBe("error");
    if (second.kind === "error") {
      expect(second.diagnostics[0]?.code).toBe(proofMirDiagnosticCode("PROOF_MIR_INVALID_CFG"));
    }
  });

  test("rejects finalizing a block without a terminator", () => {
    const graph = createDraftGraphBuilder({ functionInstanceId: monoInstanceId("fn:main") });
    const origin = graph.allocateSyntheticOrigin("entry");
    const entry = graph.createBlock({ role: "entry", scope: graph.rootScopeKey(), origin });

    const result = graph.finalizeBlock(entry);
    expect(result.kind).toBe("error");
    if (result.kind === "error") {
      expect(result.diagnostics[0]?.code).toBe(
        proofMirDiagnosticCode("PROOF_MIR_MISSING_TERMINATOR_ID"),
      );
    }
  });

  test("edge records store facts, effects, argument keys, scope keys, and origin", () => {
    const functionInstanceId = monoInstanceId("fn:main");
    const graph = createDraftGraphBuilder({ functionInstanceId });
    const origin = graph.allocateSyntheticOrigin("edge");
    const rootScope = graph.rootScopeKey();
    const entry = graph.createBlock({ role: "entry", scope: rootScope, origin });
    const targetScope = graph.createScope({ role: "loop", parentScopeKey: rootScope, origin });
    const targetBlockKey = draftBlockKey({
      functionInstanceId,
      role: "loop.header",
      sourceOrigin: "synthetic:loop.header",
    });
    const factKey = graph.allocateRequirementFactKey("requirement:loop");
    const placeKey = graph.createPlace({
      monoPlaceCanonicalKey: "function:main/root:local:0/projection:/type:core:u8/kind:Copy",
      origin,
    });
    const argumentKey = graph.createValue({ role: "loop:carried", origin });

    const edge = graph.createNormalEdge({
      fromBlock: entry,
      toBlock: targetBlockKey,
      sourceScope: rootScope,
      targetScope,
      origin,
      factKeys: [factKey],
      effects: [{ kind: "consumePlace", placeKey }],
      argumentKeys: [argumentKey],
    });

    const record = graph.edge(edge);
    expect(record.factKeys).toEqual([factKey]);
    expect(record.effects).toEqual([{ kind: "consumePlace", placeKey }]);
    expect(record.argumentKeys).toEqual([argumentKey]);
    expect(record.sourceScopeKey).toBe(rootScope);
    expect(record.targetScopeKey).toBe(targetScope);
    expect(record.originKey).toBe(origin);
    expect(record.toBlockKey).toBe(targetBlockKey);
    expect(graph.functionDraft().blocks.has(targetBlockKey)).toBe(false);
  });

  test("draft edges can reference target blocks before they are created", () => {
    const functionInstanceId = monoInstanceId("fn:main");
    const graph = createDraftGraphBuilder({ functionInstanceId });
    const origin = graph.allocateSyntheticOrigin("forward");
    const rootScope = graph.rootScopeKey();
    const entry = graph.createBlock({ role: "entry", scope: rootScope, origin });
    const futureBlockKey = draftBlockKey({
      functionInstanceId,
      role: "join",
      sourceOrigin: "synthetic:if.join",
    });
    const edge = graph.createNormalEdge({
      fromBlock: entry,
      toBlock: futureBlockKey,
      sourceScope: rootScope,
      targetScope: rootScope,
      origin,
    });

    expect(graph.edge(edge).toBlockKey).toBe(futureBlockKey);
    expect(graph.functionDraft().blocks.has(futureBlockKey)).toBe(false);

    graph.createBlock({
      role: "join",
      scope: rootScope,
      origin,
      sourceOrigin: "synthetic:if.join",
    });

    expect(graph.functionDraft().blocks.has(futureBlockKey)).toBe(true);
    expect(graph.edge(edge).toBlockKey).toBe(futureBlockKey);
  });

  test("root scope key is stable for the function", () => {
    const functionInstanceId = monoInstanceId("fn:main");
    const graph = createDraftGraphBuilder({ functionInstanceId });
    expect(graph.rootScopeKey()).toBe(draftScopeKey({ functionInstanceId, role: "function" }));
  });

  test("edge keys are deterministic for the same role allocation", () => {
    const functionInstanceId = monoInstanceId("fn:main");
    const first = createDraftGraphBuilder({ functionInstanceId });
    const second = createDraftGraphBuilder({ functionInstanceId });
    const origin = first.allocateSyntheticOrigin("edge");
    const entry = first.createBlock({ role: "entry", scope: first.rootScopeKey(), origin });
    const secondEntry = second.createBlock({ role: "entry", scope: second.rootScopeKey(), origin });
    const edge = first.createNormalEdge({
      fromBlock: entry,
      toBlock: draftBlockKey({
        functionInstanceId,
        role: "target",
        sourceOrigin: "synthetic:target",
      }),
      sourceScope: first.rootScopeKey(),
      targetScope: first.rootScopeKey(),
      origin,
      role: "goto:target",
    });
    const secondEdge = second.createNormalEdge({
      fromBlock: secondEntry,
      toBlock: draftBlockKey({
        functionInstanceId,
        role: "target",
        sourceOrigin: "synthetic:target",
      }),
      sourceScope: second.rootScopeKey(),
      targetScope: second.rootScopeKey(),
      origin,
      role: "goto:target",
    });

    expect(edge).toBe(secondEdge);
    expect(edge).toBe(
      draftControlEdgeKey({
        functionInstanceId,
        role: draftSiteDiscriminatedEdgeRole({
          edgeKind: "goto:target",
          fromBlock: entry,
        }),
        fromBlockKey: entry,
        toBlockKey: draftBlockKey({
          functionInstanceId,
          role: "target",
          sourceOrigin: "synthetic:target",
        }),
        originKey: origin,
      }),
    );
  });
});
