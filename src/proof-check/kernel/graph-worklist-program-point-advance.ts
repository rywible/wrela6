import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirBlockId } from "../../proof-mir/ids";
import type { ProofMirBlock } from "../../proof-mir/model/graph";
import {
  enqueueGraphWorklistItem,
  graphWorklistSortKey,
  type GraphWorklistItem,
} from "./graph-worklist-cfg";
import type { ProofCheckState } from "./state";

export function enqueueFirstBlockProgramPoint(
  worklist: GraphWorklistItem[],
  queuedKeys: Set<string>,
  functionInstanceId: MonoInstanceId,
  blockId: ProofMirBlockId,
  block: ProofMirBlock,
  inputState: ProofCheckState,
  predecessorPathFrameKey?: string,
): void {
  if (block.statements.length > 0) {
    enqueueGraphWorklistItem(worklist, queuedKeys, {
      sortKey: graphWorklistSortKey({
        kind: "statement",
        functionInstanceId,
        blockId,
        statementId: block.statements[0]!.statementId,
      }),
      location: {
        kind: "statement",
        functionInstanceId,
        blockId,
        statementId: block.statements[0]!.statementId,
      },
      inputState,
      ...(predecessorPathFrameKey !== undefined ? { predecessorPathFrameKey } : {}),
    });
    return;
  }

  enqueueGraphWorklistItem(worklist, queuedKeys, {
    sortKey: graphWorklistSortKey({
      kind: "terminator",
      functionInstanceId,
      blockId,
      terminatorId: block.terminator.terminatorId,
    }),
    location: {
      kind: "terminator",
      functionInstanceId,
      blockId,
      terminatorId: block.terminator.terminatorId,
    },
    inputState,
    ...(predecessorPathFrameKey !== undefined ? { predecessorPathFrameKey } : {}),
  });
}
