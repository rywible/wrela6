import { describe, expect, test } from "bun:test";

import { optIrCfgEdgeTable, type OptIrBlock, type OptIrEdge } from "../../../src/opt-ir/cfg";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import {
  optIrBlockId,
  optIrConstantId,
  optIrEdgeId,
  optIrOperationId,
  optIrOriginId,
  optIrValueId,
} from "../../../src/opt-ir/ids";
import { driveStaticControlFlow } from "../../../src/opt-ir/passes/specialization/static-driving";
import { optIrSignedIntegerType } from "../../../src/opt-ir/types";

const integer1 = optIrSignedIntegerType(1);
const integer32 = optIrSignedIntegerType(32);

describe("whole-program specialization static driving", () => {
  test("drives a static branch to one successor and records CFG/path preservation edits", () => {
    const blocks = [
      block(1, {
        kind: "branch",
        operationId: optIrOperationId(90),
        condition: optIrValueId(10),
        trueEdge: optIrEdgeId(1),
        falseEdge: optIrEdgeId(2),
        originId: optIrOriginId(90),
      }),
      block(2),
      block(3),
    ];

    const result = driveStaticControlFlow({
      blocks,
      edges: optIrCfgEdgeTable([edge(1, 1, 2, "branchTrue"), edge(2, 1, 3, "branchFalse")]),
      staticValues: new Map([
        [
          optIrValueId(10),
          optIrIntegerConstant({
            constantId: optIrConstantId(1),
            type: integer1,
            normalizedValue: 0n,
          }),
        ],
      ]),
    });

    expect(result.changed).toBe(true);
    expect(result.blocks[0]?.terminator).toMatchObject({ kind: "jump", edge: optIrEdgeId(2) });
    expect(result.edges.entries().map((entry) => entry.edgeId)).toEqual([optIrEdgeId(2)]);
    expect(result.cfgEdits).toEqual([
      {
        kind: "staticBranchDriven",
        fromBlock: optIrBlockId(1),
        keptEdges: [optIrEdgeId(2)],
        removedEdges: [optIrEdgeId(1)],
      },
    ]);
    expect(result.pathPreservation).toEqual([
      {
        kind: "dominatingPathPreserved",
        keptEdges: [optIrEdgeId(2)],
        removedEdges: [optIrEdgeId(1)],
      },
    ]);
  });

  test("drives a static switch case and removes non-taken successors", () => {
    const result = driveStaticControlFlow({
      blocks: [
        block(1, {
          kind: "switch",
          operationId: optIrOperationId(91),
          scrutinee: optIrValueId(11),
          cases: [
            { label: "1", edge: optIrEdgeId(1) },
            { label: "2", edge: optIrEdgeId(2) },
          ],
          defaultEdge: optIrEdgeId(3),
          originId: optIrOriginId(91),
        }),
        block(2),
        block(3),
        block(4),
      ],
      edges: optIrCfgEdgeTable([
        edge(1, 1, 2, "switchCase", "1"),
        edge(2, 1, 3, "switchCase", "2"),
        edge(3, 1, 4, "normal"),
      ]),
      staticValues: new Map([
        [
          optIrValueId(11),
          optIrIntegerConstant({
            constantId: optIrConstantId(2),
            type: integer32,
            normalizedValue: 2n,
          }),
        ],
      ]),
    });

    expect(result.blocks[0]?.terminator).toMatchObject({ kind: "jump", edge: optIrEdgeId(2) });
    expect(result.edges.entries().map((entry) => entry.edgeId)).toEqual([optIrEdgeId(2)]);
    expect(result.cfgEdits[0]).toMatchObject({
      kind: "staticSwitchDriven",
      keptEdges: [optIrEdgeId(2)],
      removedEdges: [optIrEdgeId(1), optIrEdgeId(3)],
    });
  });
});

function block(blockId: number, terminator?: OptIrBlock["terminator"]): OptIrBlock {
  return {
    blockId: optIrBlockId(blockId),
    parameters: [],
    operations: [],
    ...(terminator === undefined ? {} : { terminator }),
    originId: optIrOriginId(blockId),
  };
}

function edge(
  edgeId: number,
  from: number,
  toBlock: number,
  kind: OptIrEdge["kind"],
  switchCase?: string,
): OptIrEdge {
  return {
    edgeId: optIrEdgeId(edgeId),
    from: optIrBlockId(from),
    toBlock: optIrBlockId(toBlock),
    ordinal: edgeId,
    kind,
    arguments: [],
    ...(switchCase === undefined ? {} : { switchCase }),
    originId: optIrOriginId(edgeId),
  };
}
