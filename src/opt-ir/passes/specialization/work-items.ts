import type {
  OptIrWholeProgramSpecializationWorkItem,
  OptIrWholeProgramSpecializationWorkItemKind,
} from "../whole-program-specialization";
import type { OptIrFunctionId } from "../../ids";

export function specializationWorkItem(
  kind: OptIrWholeProgramSpecializationWorkItemKind,
  functionId: OptIrFunctionId,
  reason: string,
): OptIrWholeProgramSpecializationWorkItem {
  return Object.freeze({ kind, functionId, reason });
}

export function compareSpecializationWorkItems(
  left: OptIrWholeProgramSpecializationWorkItem,
  right: OptIrWholeProgramSpecializationWorkItem,
): number {
  return (
    Number(left.functionId) - Number(right.functionId) ||
    workItemKindOrder(left.kind) - workItemKindOrder(right.kind) ||
    left.reason.localeCompare(right.reason)
  );
}

function workItemKindOrder(kind: OptIrWholeProgramSpecializationWorkItemKind): number {
  return ["cleanup", "sccp", "inlining"].indexOf(kind);
}
