import { describe, expect, test } from "bun:test";

import { monoInstanceId } from "../../../src/mono/ids";
import { optIrConstantId } from "../../../src/opt-ir/ids";
import { optIrIntegerConstant } from "../../../src/opt-ir/constants";
import { optIrCfgEdgeTable, type OptIrBlock } from "../../../src/opt-ir/cfg";
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
import { optIrConstantOperation } from "../../../src/opt-ir/operations";
import {
  optIrConstantTable,
  optIrFunctionTable,
  optIrProgram,
  optIrRegionTable,
} from "../../../src/opt-ir/program";
import { runLicmForTest } from "../../../src/opt-ir/passes/licm";
import { optIrUnsignedIntegerType } from "../../../src/opt-ir/types";
import { targetId } from "../../../src/semantic/ids";
import type { MonoFunctionSignature } from "../../../src/mono/mono-hir";

const originId = optIrOriginId(1);
const integerType = optIrUnsignedIntegerType(32);

describe("W4-02d real LICM hoisting", () => {
  test("inserts a preheader and moves invariant operations out of a loop block", () => {
    const invariant = optIrConstantOperation({
      operationId: optIrOperationId(1),
      resultId: optIrValueId(10),
      constant: optIrIntegerConstant({
        constantId: optIrConstantId(1),
        type: integerType,
        normalizedValue: 1n,
      }),
      originId,
    });
    const firstEntry = block({
      blockId: 0,
      terminator: { kind: "jump", operationId: 90, edge: 1 },
    });
    const secondEntry = block({
      blockId: 1,
      terminator: { kind: "jump", operationId: 91, edge: 2 },
    });
    const header = block({
      blockId: 2,
      operations: [invariant.operationId],
      terminator: {
        kind: "branch",
        operationId: 92,
        condition: optIrValueId(10),
        trueEdge: 3,
        falseEdge: 4,
      },
    });
    const exit = block({
      blockId: 3,
      terminator: { kind: "return", operationId: 93, values: [] },
    });
    const program = optIrProgram({
      programId: optIrProgramId(1),
      targetId: targetId("licm-remediation"),
      functions: optIrFunctionTable([
        {
          functionId: optIrFunctionId(1),
          monoInstanceId: monoInstanceId("licm::preheader"),
          signature: {} as MonoFunctionSignature,
          blocks: [firstEntry, secondEntry, header, exit],
          edges: optIrCfgEdgeTable([
            edge(1, firstEntry.blockId, header.blockId),
            edge(2, secondEntry.blockId, header.blockId),
            edge(3, header.blockId, header.blockId, "branchTrue"),
            edge(4, header.blockId, exit.blockId, "branchFalse"),
          ]),
          entryBlock: firstEntry.blockId,
          originId,
        },
      ]),
      regions: optIrRegionTable([{ regionId: optIrRegionId(1), originId }]),
      constants: optIrConstantTable([]),
      callGraph: { calls: [] },
      provenance: { originIds: [originId] },
    });

    const result = runLicmForTest({
      program,
      operations: [invariant],
      loopOperationIds: [invariant.operationId],
      effectBoundaryOperationIds: [],
    });
    const function_ = result.program.functions.get(optIrFunctionId(1));
    const preheader = function_?.blocks.find((candidate) =>
      candidate.operations.includes(invariant.operationId),
    );

    expect(result.movedOperationIds).toEqual([invariant.operationId]);
    expect(preheader?.blockId).not.toBe(header.blockId);
    expect(function_?.edges.get(optIrEdgeId(1))?.toBlock).toBe(preheader?.blockId);
    expect(function_?.edges.get(optIrEdgeId(2))?.toBlock).toBe(preheader?.blockId);
    expect(
      function_?.edges
        .entries()
        .some(
          (candidate) =>
            candidate.from === preheader?.blockId && candidate.toBlock === header.blockId,
        ),
    ).toBe(true);
    expect(
      function_?.blocks.find((candidate) => candidate.blockId === header.blockId)?.operations,
    ).toEqual([]);
  });
});

function block(input: {
  readonly blockId: number;
  readonly operations?: readonly ReturnType<typeof optIrOperationId>[];
  readonly terminator:
    | { readonly kind: "jump"; readonly operationId: number; readonly edge: number }
    | {
        readonly kind: "branch";
        readonly operationId: number;
        readonly condition: ReturnType<typeof optIrValueId>;
        readonly trueEdge: number;
        readonly falseEdge: number;
      }
    | { readonly kind: "return"; readonly operationId: number; readonly values: readonly [] };
}): OptIrBlock {
  return {
    blockId: optIrBlockId(input.blockId),
    parameters: [],
    operations: input.operations ?? [],
    terminator:
      input.terminator.kind === "jump"
        ? {
            kind: "jump",
            operationId: optIrOperationId(input.terminator.operationId),
            edge: optIrEdgeId(input.terminator.edge),
            originId,
          }
        : input.terminator.kind === "branch"
          ? {
              kind: "branch",
              operationId: optIrOperationId(input.terminator.operationId),
              condition: input.terminator.condition,
              trueEdge: optIrEdgeId(input.terminator.trueEdge),
              falseEdge: optIrEdgeId(input.terminator.falseEdge),
              originId,
            }
          : {
              kind: "return",
              operationId: optIrOperationId(input.terminator.operationId),
              values: [],
              originId,
            },
    originId,
  };
}

function edge(
  edgeId: number,
  from: ReturnType<typeof optIrBlockId>,
  toBlock: ReturnType<typeof optIrBlockId>,
  kind: "normal" | "branchTrue" | "branchFalse" = "normal",
) {
  return {
    edgeId: optIrEdgeId(edgeId),
    from,
    toBlock,
    ordinal: edgeId,
    kind,
    arguments: [],
    originId,
  };
}
