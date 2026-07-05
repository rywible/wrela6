import { computeOptIrLoopTree } from "../analyses/loop-tree";
import type { OptIrOperationId } from "../ids";
import type { PipelineState } from "./pipeline-types";
import { operationsInProgramOrder } from "./pipeline-state";

export function licmLoopOperationIdsInProgramOrder(
  state: Pick<PipelineState, "program" | "operations">,
): readonly OptIrOperationId[] {
  const operationIds = new Set<OptIrOperationId>();
  for (const function_ of state.program.functions.entries()) {
    const loopTree = computeOptIrLoopTree(function_);
    const loopBlockIds = new Set(loopTree.loops().flatMap((loop) => loop.blocks));
    for (const block of function_.blocks) {
      if (!loopBlockIds.has(block.blockId)) {
        continue;
      }
      for (const operationId of block.operations) {
        operationIds.add(operationId);
      }
    }
  }
  return operationsInProgramOrder(state.program, state.operations)
    .map((operation) => operation.operationId)
    .filter((operationId) => operationIds.has(operationId));
}
