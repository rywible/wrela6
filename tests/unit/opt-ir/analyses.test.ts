import { describe, expect, test } from "bun:test";
import { computeOptIrAliasAnalysis } from "../../../src/opt-ir/analyses/alias-analysis";
import { computeOptIrCallGraph } from "../../../src/opt-ir/analyses/call-graph";
import { computeOptIrDominance } from "../../../src/opt-ir/analyses/dominance";
import { computeOptIrEscapeAnalysis } from "../../../src/opt-ir/analyses/escape-analysis";
import { computeOptIrLiveness } from "../../../src/opt-ir/analyses/liveness";
import { computeOptIrLoopTree } from "../../../src/opt-ir/analyses/loop-tree";
import { computeOptIrCallGraphSccs } from "../../../src/opt-ir/analyses/scc";
import type { OptIrBlockParameter } from "../../../src/opt-ir/values";
import type { OptIrValueId } from "../../../src/opt-ir/ids";
import {
  aliasAnalysisFixture,
  callGraphAnalysisFixture,
  diamondAnalysisFixture,
  escapeAnalysisFixture,
  linearAnalysisFixture,
  loopTreeAnalysisFixture,
} from "../../support/opt-ir/analysis-fixtures";

describe("OptIR dominance and liveness analyses", () => {
  test("dominance and liveness handle diamond block arguments and return values", () => {
    const fixture = diamondAnalysisFixture();
    const dominance = computeOptIrDominance(fixture.func);
    const liveness = computeOptIrLiveness({
      func: fixture.func,
      operationForId(operationId) {
        return fixture.operations.get(Number(operationId));
      },
    });

    expect(dominance.dominates(fixture.blocks.entry.blockId, fixture.blocks.join.blockId)).toBe(
      true,
    );
    expect(dominance.dominates(fixture.blocks.thenBlock.blockId, fixture.blocks.join.blockId)).toBe(
      false,
    );
    expect(
      dominance.strictlyDominates(fixture.blocks.entry.blockId, fixture.blocks.join.blockId),
    ).toBe(true);
    expect(dominance.immediateDominator(fixture.blocks.join.blockId)).toBe(
      fixture.blocks.entry.blockId,
    );
    expect(dominance.dominators(fixture.blocks.join.blockId)).toEqual([
      fixture.blocks.entry.blockId,
      fixture.blocks.join.blockId,
    ]);

    const entryArgument = requireParameter(fixture.blocks.entry.parameters[0]);
    const condition = requireParameter(fixture.blocks.entry.parameters[1]);
    const thenValue = requireValueId(fixture.operations.get(20)?.resultIds[0]);

    expect(liveness.liveIn(fixture.blocks.thenBlock.blockId)).toEqual([
      entryArgument.valueId,
      condition.valueId,
    ]);
    expect(liveness.liveOut(fixture.blocks.thenBlock.blockId)).toEqual([
      entryArgument.valueId,
      condition.valueId,
      thenValue,
    ]);
    expect(liveness.liveIn(fixture.blocks.join.blockId)).toEqual([
      entryArgument.valueId,
      condition.valueId,
    ]);
    expect(liveness.liveOut(fixture.blocks.join.blockId)).toEqual([]);
  });

  test("dominance chooses the closest immediate dominator in a linear chain", () => {
    const fixture = linearAnalysisFixture();
    const dominance = computeOptIrDominance(fixture.func);

    expect(dominance.dominators(fixture.blocks.exit.blockId)).toEqual([
      fixture.blocks.entry.blockId,
      fixture.blocks.middle.blockId,
      fixture.blocks.exit.blockId,
    ]);
    expect(dominance.immediateDominator(fixture.blocks.exit.blockId)).toBe(
      fixture.blocks.middle.blockId,
    );
  });
});

describe("OptIR loop tree analysis", () => {
  test("loop tree identifies headers, latches, loop depth, and cold terminal paths", () => {
    const fixture = loopTreeAnalysisFixture();
    const loopTree = computeOptIrLoopTree(fixture.func);

    expect(loopTree.loops()).toEqual([
      {
        header: fixture.blocks.header.blockId,
        latches: [fixture.blocks.latch.blockId],
        blocks: [
          fixture.blocks.header.blockId,
          fixture.blocks.body.blockId,
          fixture.blocks.latch.blockId,
        ],
      },
    ]);
    expect(Object.isFrozen(loopTree.loops()[0])).toBe(true);
    expect(loopTree.loopDepth(fixture.blocks.entry.blockId)).toBe(0);
    expect(loopTree.loopDepth(fixture.blocks.body.blockId)).toBe(1);
    expect(loopTree.latchesForHeader(fixture.blocks.header.blockId)).toEqual([
      fixture.blocks.latch.blockId,
    ]);
    expect(loopTree.isColdPath(fixture.blocks.cold.blockId)).toBe(true);
    expect(loopTree.isTerminalPath(fixture.blocks.cold.blockId)).toBe(true);
    expect(loopTree.isTerminalPath(fixture.blocks.exit.blockId)).toBe(true);
  });
});

describe("OptIR call graph and SCC analyses", () => {
  test("call graph records source, runtime, platform, callback, external-root, and unknown-call edges", () => {
    const fixture = callGraphAnalysisFixture();
    const graph = computeOptIrCallGraph({
      program: fixture.program,
      operationForId: fixture.operationForId,
      callbacks: fixture.callbacks,
      unknownCalls: fixture.unknownCalls,
    });

    expect(graph.edges()).toEqual([
      {
        kind: "externalRoot",
        caller: undefined,
        callee: fixture.functions.entry.functionId,
        source: "imageEntry",
      },
      {
        kind: "source",
        caller: fixture.functions.entry.functionId,
        callee: fixture.functions.worker.functionId,
        source: "direct-call",
      },
      {
        kind: "runtime",
        caller: fixture.functions.entry.functionId,
        callee: undefined,
        source: "runtime:alloc",
      },
      {
        kind: "platform",
        caller: fixture.functions.entry.functionId,
        callee: undefined,
        source: "platform:uefi.exit-boot-services",
      },
      {
        kind: "callback",
        caller: fixture.functions.worker.functionId,
        callee: fixture.functions.entry.functionId,
        source: "hardwareCallback",
      },
      {
        kind: "unknownCall",
        caller: fixture.functions.worker.functionId,
        callee: undefined,
        source: "extern:opaque",
      },
    ]);
  });

  test("SCC analysis rejects recursive and maybe-recursive expansion by default", () => {
    const fixture = callGraphAnalysisFixture();
    const sccs = computeOptIrCallGraphSccs(fixture.recursiveGraph);

    expect(sccs.entries()).toEqual([
      {
        kind: "maybeRecursive",
        functions: [fixture.functions.entry.functionId, fixture.functions.worker.functionId],
        reason: "callback-or-unknown-call",
        allowInlining: false,
        allowSpecialization: false,
      },
    ]);
  });

  test("SCC analysis treats unknown calls as maybe-recursive even without a concrete cycle", () => {
    const fixture = callGraphAnalysisFixture();
    const sccs = computeOptIrCallGraphSccs({
      functions: [fixture.functions.worker.functionId],
      edges: [
        {
          kind: "unknownCall",
          caller: fixture.functions.worker.functionId,
          callee: undefined,
          source: "extern:opaque",
        },
      ],
    });

    expect(sccs.entries()).toEqual([
      {
        kind: "maybeRecursive",
        functions: [fixture.functions.worker.functionId],
        reason: "callback-or-unknown-call",
        allowInlining: false,
        allowSpecialization: false,
      },
    ]);
    expect(Object.isFrozen(sccs.entries()[0]?.functions)).toBe(true);
  });
});

describe("OptIR escape and alias analyses", () => {
  test("escape analysis marks address-taken locals, callbacks, exported roots, unknown calls, and external flow", () => {
    const fixture = escapeAnalysisFixture();
    const escape = computeOptIrEscapeAnalysis(fixture.input);

    expect(escape.escapedRegions()).toEqual([
      fixture.regions.addressTaken.regionId,
      fixture.regions.callback.regionId,
      fixture.regions.exported.regionId,
      fixture.regions.unknownCall.regionId,
      fixture.regions.externalFlow.regionId,
    ]);
    expect(escape.reasonFor(fixture.regions.addressTaken.regionId)).toBe("addressTakenLocal");
    expect(escape.reasonFor(fixture.regions.callback.regionId)).toBe("callbackCapture");
    expect(escape.reasonFor(fixture.regions.exported.regionId)).toBe("exportedRoot");
    expect(escape.reasonFor(fixture.regions.unknownCall.regionId)).toBe("unknownCall");
    expect(escape.reasonFor(fixture.regions.externalFlow.regionId)).toBe("externalFlow");
    expect(escape.hasEscaped(fixture.regions.localOnly.regionId)).toBe(false);
    expect(escape.doesNotEscape(fixture.regions.localOnly.regionId)).toBe(true);
    expect(escape.missingEvidenceKinds()).toEqual([]);

    const incomplete = computeOptIrEscapeAnalysis({ regions: fixture.input.regions });
    expect(incomplete.hasEscaped(fixture.regions.localOnly.regionId)).toBe(false);
    expect(incomplete.doesNotEscape(fixture.regions.localOnly.regionId)).toBe(false);
    expect(incomplete.missingEvidenceKinds()).toEqual([
      "addressTakenLocals",
      "callbackCaptures",
      "exportedRoots",
      "unknownCallRegions",
      "externalFlowRegions",
    ]);
  });

  test("alias analysis combines region alias classes with fact-query answers", () => {
    const fixture = aliasAnalysisFixture();
    const alias = computeOptIrAliasAnalysis(fixture.input);

    expect(alias.mayAlias(fixture.regions.stackA.regionId, fixture.regions.stackB.regionId)).toBe(
      false,
    );
    expect(
      alias.mustNotAlias(fixture.regions.stackA.regionId, fixture.regions.stackB.regionId).kind,
    ).toBe("yes");
    expect(alias.mayAlias(fixture.regions.packet.regionId, fixture.regions.payload.regionId)).toBe(
      true,
    );
    expect(alias.aliasClassFor(fixture.regions.payload.regionId)).toBe(
      fixture.regions.packet.aliasClass,
    );
  });
});

function requireParameter(parameter: OptIrBlockParameter | undefined): OptIrBlockParameter {
  if (parameter === undefined) {
    throw new Error("Expected analysis fixture to contain block parameter.");
  }
  return parameter;
}

function requireValueId(valueId: OptIrValueId | undefined): OptIrValueId {
  if (valueId === undefined) {
    throw new Error("Expected analysis fixture to contain operation result.");
  }
  return valueId;
}
