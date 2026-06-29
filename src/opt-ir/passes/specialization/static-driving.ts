import {
  optIrCfgEdgeTable,
  type OptIrBlock,
  type OptIrCfgEdgeTable,
  type OptIrEdge,
} from "../../cfg";
import type { OptIrConstant } from "../../constants";
import type { OptIrBlockId, OptIrEdgeId, OptIrValueId } from "../../ids";

export type OptIrStaticDrivingCfgEdit =
  | {
      readonly kind: "staticBranchDriven";
      readonly fromBlock: OptIrBlockId;
      readonly keptEdges: readonly OptIrEdgeId[];
      readonly removedEdges: readonly OptIrEdgeId[];
    }
  | {
      readonly kind: "staticSwitchDriven";
      readonly fromBlock: OptIrBlockId;
      readonly keptEdges: readonly OptIrEdgeId[];
      readonly removedEdges: readonly OptIrEdgeId[];
    };

export interface OptIrPathPreservationRecord {
  readonly kind: "dominatingPathPreserved";
  readonly keptEdges: readonly OptIrEdgeId[];
  readonly removedEdges: readonly OptIrEdgeId[];
}

export interface DriveStaticControlFlowInput {
  readonly blocks: readonly OptIrBlock[];
  readonly edges: OptIrCfgEdgeTable;
  readonly staticValues: ReadonlyMap<OptIrValueId, OptIrConstant>;
}

export interface DriveStaticControlFlowResult {
  readonly changed: boolean;
  readonly blocks: readonly OptIrBlock[];
  readonly edges: OptIrCfgEdgeTable;
  readonly cfgEdits: readonly OptIrStaticDrivingCfgEdit[];
  readonly pathPreservation: readonly OptIrPathPreservationRecord[];
}

export function driveStaticControlFlow(
  input: DriveStaticControlFlowInput,
): DriveStaticControlFlowResult {
  const keptEdgeIds = new Set(input.edges.entries().map((edge) => edge.edgeId));
  const cfgEdits: OptIrStaticDrivingCfgEdit[] = [];
  const pathPreservation: OptIrPathPreservationRecord[] = [];
  const blocks = input.blocks.map((block) => {
    const terminator = block.terminator;
    if (terminator?.kind === "branch") {
      const condition = input.staticValues.get(terminator.condition);
      if (condition === undefined) {
        return block;
      }
      const keptEdge =
        condition.normalizedValue === 0n ? terminator.falseEdge : terminator.trueEdge;
      const removedEdges = [terminator.trueEdge, terminator.falseEdge].filter(
        (edgeId) => edgeId !== keptEdge,
      );
      recordDriving("staticBranchDriven", block.blockId, [keptEdge], removedEdges);
      return Object.freeze({
        ...block,
        terminator: Object.freeze({
          kind: "jump" as const,
          operationId: terminator.operationId,
          edge: keptEdge,
          originId: terminator.originId,
        }),
      });
    }
    if (terminator?.kind === "switch") {
      const scrutinee = input.staticValues.get(terminator.scrutinee);
      if (scrutinee === undefined) {
        return block;
      }
      const label = String(scrutinee.normalizedValue);
      const matchedCase = terminator.cases.find((switchCase) => switchCase.label === label);
      const keptEdge = matchedCase?.edge ?? terminator.defaultEdge;
      const allEdges = [
        ...terminator.cases.map((switchCase) => switchCase.edge),
        terminator.defaultEdge,
      ];
      const removedEdges = allEdges.filter((edgeId) => edgeId !== keptEdge);
      recordDriving("staticSwitchDriven", block.blockId, [keptEdge], removedEdges);
      return Object.freeze({
        ...block,
        terminator: Object.freeze({
          kind: "jump" as const,
          operationId: terminator.operationId,
          edge: keptEdge,
          originId: terminator.originId,
        }),
      });
    }
    return block;
  });

  function recordDriving(
    kind: OptIrStaticDrivingCfgEdit["kind"],
    fromBlock: OptIrBlockId,
    keptEdges: readonly OptIrEdgeId[],
    removedEdges: readonly OptIrEdgeId[],
  ): void {
    for (const edgeId of removedEdges) {
      keptEdgeIds.delete(edgeId);
    }
    const edit = Object.freeze({
      kind,
      fromBlock,
      keptEdges: Object.freeze([...keptEdges]),
      removedEdges: Object.freeze([...removedEdges]),
    });
    cfgEdits.push(edit);
    pathPreservation.push(
      Object.freeze({
        kind: "dominatingPathPreserved" as const,
        keptEdges: edit.keptEdges,
        removedEdges: edit.removedEdges,
      }),
    );
  }

  return Object.freeze({
    changed: cfgEdits.length > 0,
    blocks: Object.freeze(blocks),
    edges: optIrCfgEdgeTable(
      input.edges.entries().filter((edge): edge is OptIrEdge => keptEdgeIds.has(edge.edgeId)),
    ),
    cfgEdits: Object.freeze(cfgEdits),
    pathPreservation: Object.freeze(pathPreservation),
  });
}
