import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofCheckProgramPointKey, type ProofCheckProgramPoint } from "./transition-api";
import type { ProofCheckState } from "./state";

export interface GraphWorklistItem {
  readonly sortKey: string;
  readonly location: ProofCheckProgramPoint;
  readonly inputState: ProofCheckState;
  readonly predecessorPathFrameKey?: string;
}

export const DEFAULT_VARIANT_KEY = "";

export function graphWorklistSortKey(location: ProofCheckProgramPoint): string {
  return proofCheckProgramPointKey(location);
}

export function enqueueGraphWorklistItem(
  worklist: GraphWorklistItem[],
  queuedKeys: Set<string>,
  item: GraphWorklistItem,
): void {
  if (queuedKeys.has(item.sortKey)) {
    return;
  }
  queuedKeys.add(item.sortKey);
  worklist.push(item);
}

export function sortGraphWorklist(worklist: GraphWorklistItem[]): GraphWorklistItem[] {
  return [...worklist].sort((left, right) => compareCodeUnitStrings(left.sortKey, right.sortKey));
}
