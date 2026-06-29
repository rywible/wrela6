import { describe, expect, test } from "bun:test";
import { monoInstanceId } from "../../../src/mono/ids";
import {
  optIrBlockId,
  optIrEdgeId,
  optIrFunctionId,
  optIrOperationId,
  optIrOriginId,
  optIrProgramId,
  optIrRegionId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { optIrBlockParameter } from "../../../src/opt-ir/values";
import { optIrCfgEdgeTable, optIrConstructionIdAllocator } from "../../../src/opt-ir/cfg";
import { optIrDiagnosticCode } from "../../../src/opt-ir/diagnostics";
import type { OptIrCfgEdit } from "../../../src/opt-ir/cfg-edits";
import { optIrBranchTerminator, optIrSwitchTerminator } from "../../../src/opt-ir/terminators";
import {
  edgeForTest,
  optIrBlockForTest,
  optIrFunctionForTest,
  optIrProgramForTest,
  targetIdForTest,
  verifyCfgEdgesForTest,
} from "../../support/opt-ir/cfg-fakes";

describe("OptIR CFG edges", () => {
  test("branch terminator must name existing edge records", () => {
    const result = verifyCfgEdgesForTest({
      edges: [edgeForTest({ edgeId: optIrEdgeId(1), kind: "branchTrue" })],
      terminator: optIrBranchTerminator({
        operationId: optIrOperationId(9),
        condition: optIrValueId(4),
        trueEdge: optIrEdgeId(1),
        falseEdge: optIrEdgeId(2),
        originId: optIrOriginId(1),
      }),
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      optIrDiagnosticCode("OPT_IR_CFG_EDGE_MISSING"),
    );
  });

  test("switch terminators reference edge IDs for every successor", () => {
    const result = verifyCfgEdgesForTest({
      edges: [
        edgeForTest({ edgeId: optIrEdgeId(10), kind: "switchCase", switchCase: "zero" }),
        edgeForTest({ edgeId: optIrEdgeId(11), kind: "normal" }),
      ],
      terminator: optIrSwitchTerminator({
        operationId: optIrOperationId(10),
        scrutinee: optIrValueId(5),
        cases: [
          { label: "zero", edge: optIrEdgeId(10) },
          { label: "one", edge: optIrEdgeId(12) },
        ],
        defaultEdge: optIrEdgeId(11),
        originId: optIrOriginId(1),
      }),
    });

    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "missing-edge:12",
    );
  });

  test("edge records carry destination, ordinal, kind, arguments, condition, switch case, and origin", () => {
    const edge = edgeForTest({
      edgeId: optIrEdgeId(5),
      from: optIrBlockId(1),
      toBlock: optIrBlockId(3),
      ordinal: 2,
      kind: "switchCase",
      arguments: [optIrValueId(7)],
      condition: optIrValueId(8),
      switchCase: "case:ready",
      originId: optIrOriginId(9),
    });

    expect(edge).toEqual({
      edgeId: optIrEdgeId(5),
      from: optIrBlockId(1),
      toBlock: optIrBlockId(3),
      ordinal: 2,
      kind: "switchCase",
      arguments: [optIrValueId(7)],
      condition: optIrValueId(8),
      switchCase: "case:ready",
      originId: optIrOriginId(9),
    });
  });
});

describe("OptIR program and function tables", () => {
  test("program carries IDs, target, tables, call graph, and provenance", () => {
    const program = optIrProgramForTest({ programId: optIrProgramId(42) });

    expect(program.programId).toBe(optIrProgramId(42));
    expect(program.targetId).toBe(targetIdForTest("test-target"));
    expect(program.functions.entries()).toHaveLength(1);
    expect(program.regions.entries()).toEqual([
      { regionId: optIrRegionId(1), originId: optIrOriginId(1) },
    ]);
    expect(program.constants.entries()).toHaveLength(1);
    expect(program.callGraph).toEqual({ calls: [] });
    expect(program.provenance).toEqual({ originIds: [optIrOriginId(1)] });
  });

  test("function carries mono instance, signature, blocks, edges, entry, external root, summary, and origin", () => {
    const block = optIrBlockForTest({
      blockId: optIrBlockId(7),
      parameters: [
        optIrBlockParameter({
          valueId: optIrValueId(20),
          type: optIrUnsignedIntegerType(16),
          incomingRole: "branchArgument",
          originId: optIrOriginId(4),
        }),
      ],
    });
    const edge = edgeForTest({
      edgeId: optIrEdgeId(8),
      from: optIrBlockId(7),
      toBlock: optIrBlockId(9),
    });
    const summary = { returns: "u16" };
    const func = optIrFunctionForTest({
      functionId: optIrFunctionId(3),
      monoInstanceId: monoInstanceId("image::entry"),
      blocks: [block],
      edges: optIrCfgEdgeTable([edge]),
      entryBlock: block.blockId,
      externalRoot: { reason: "imageEntry", originId: optIrOriginId(2) },
      summary,
      originId: optIrOriginId(6),
    });

    expect(func.functionId).toBe(optIrFunctionId(3));
    expect(func.monoInstanceId).toBe(monoInstanceId("image::entry"));
    expect(func.blocks).toEqual([block]);
    expect(func.edges.get(optIrEdgeId(8))).toEqual(edge);
    expect(func.entryBlock).toBe(optIrBlockId(7));
    expect(func.externalRoot).toEqual({ reason: "imageEntry", originId: optIrOriginId(2) });
    expect(func.summary).toBe(summary);
    expect(func.originId).toBe(optIrOriginId(6));
  });

  test("cfg edits preserve edge IDs when branch folding removes successors", () => {
    const edit: OptIrCfgEdit = {
      kind: "branchFold",
      oldTerminator: optIrOperationId(9),
      survivingEdge: optIrEdgeId(4),
      removedEdges: [optIrEdgeId(5)],
    };

    expect(edit.survivingEdge).toBe(optIrEdgeId(4));
    expect(edit.removedEdges).toEqual([optIrEdgeId(5)]);
  });
});

describe("OptIR construction ID allocation", () => {
  test("allocator follows checked MIR traversal order instead of map insertion order", () => {
    const allocator = optIrConstructionIdAllocator({
      functionsInTraversalOrder: [monoInstanceId("alpha"), monoInstanceId("beta")],
      blocksInTraversalOrder: new Map([
        [monoInstanceId("beta"), [10, 20]],
        [monoInstanceId("alpha"), [30]],
      ]),
      edgesInTraversalOrder: new Map([
        [monoInstanceId("beta"), [100]],
        [monoInstanceId("alpha"), [200, 300]],
      ]),
    });

    expect(allocator.functionIdFor(monoInstanceId("alpha"))).toBe(optIrFunctionId(0));
    expect(allocator.functionIdFor(monoInstanceId("beta"))).toBe(optIrFunctionId(1));
    expect(allocator.blockIdFor(monoInstanceId("alpha"), 30)).toBe(optIrBlockId(0));
    expect(allocator.blockIdFor(monoInstanceId("beta"), 10)).toBe(optIrBlockId(1));
    expect(allocator.blockIdFor(monoInstanceId("beta"), 20)).toBe(optIrBlockId(2));
    expect(allocator.edgeIdFor(monoInstanceId("alpha"), 200)).toBe(optIrEdgeId(0));
    expect(allocator.edgeIdFor(monoInstanceId("alpha"), 300)).toBe(optIrEdgeId(1));
    expect(allocator.edgeIdFor(monoInstanceId("beta"), 100)).toBe(optIrEdgeId(2));
  });
});
