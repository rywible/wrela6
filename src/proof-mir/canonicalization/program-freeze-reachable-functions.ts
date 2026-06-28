import type { MonoInstanceId } from "../../mono/ids";
import type { MonoReachableFunction } from "../../mono/mono-hir";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";
import { proofMirDeterministicTable } from "./canonical-order";
import { functionCanonicalKey } from "./program-freeze-shared";
import type { ProofMirReachableFunction, ProofMirReachableFunctionTable } from "../model/program";
import type { ProofMirOriginTable } from "../model/origins";

function reachableFunctionOriginNote(reachableFunction: MonoReachableFunction): string {
  return reachableFunction.reason === "sourceCall"
    ? "reachable-function:sourceCall"
    : `external-root:${reachableFunction.reason}`;
}

function proofMirOriginForReachableFunction(input: {
  readonly origins: ProofMirOriginTable;
  readonly reachableFunction: MonoReachableFunction;
}): ProofMirReachableFunction["origin"] | undefined {
  const expectedNote = reachableFunctionOriginNote(input.reachableFunction);
  for (const origin of input.origins.entries()) {
    if (origin.owner.kind !== "function") {
      continue;
    }
    if (origin.owner.functionInstanceId !== input.reachableFunction.functionInstanceId) {
      continue;
    }
    if (origin.note !== expectedNote) {
      continue;
    }
    return origin.originId;
  }
  return undefined;
}

export function freezeProofMirReachableFunctionTable(input: {
  readonly reachableFunctions: readonly MonoReachableFunction[];
  readonly origins: ProofMirOriginTable;
  readonly diagnostics: ProofMirDiagnostic[];
}):
  | { readonly kind: "ok"; readonly table: ProofMirReachableFunctionTable }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] } {
  const entries: ProofMirReachableFunction[] = [];
  for (const reachableFunction of input.reachableFunctions) {
    const origin = proofMirOriginForReachableFunction({
      origins: input.origins,
      reachableFunction,
    });
    if (origin === undefined) {
      input.diagnostics.push(
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_ORIGIN_MISSING",
          message: "Reachable function closure entry is missing a Proof MIR origin reference.",
          ownerKey: `function:${String(reachableFunction.functionInstanceId)}`,
          rootCauseKey: "reachable-function",
          stableDetail: `reachable:${String(reachableFunction.functionInstanceId)}:${reachableFunction.reason}`,
          functionInstanceId: reachableFunction.functionInstanceId,
        }),
      );
      continue;
    }
    entries.push({
      functionInstanceId: reachableFunction.functionInstanceId,
      reason: reachableFunction.reason,
      origin,
    });
  }
  if (input.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { kind: "error", diagnostics: input.diagnostics };
  }
  const tableResult = proofMirDeterministicTable<MonoInstanceId, ProofMirReachableFunction>({
    entries,
    keyOf: (entry) => functionCanonicalKey(entry.functionInstanceId),
    lookupKeyOf: (functionInstanceId) => functionCanonicalKey(functionInstanceId),
    normalizePayload: (entry) =>
      `${String(entry.functionInstanceId)}|${entry.reason}|${String(entry.origin)}`,
  });
  if (tableResult.kind === "error") {
    return { kind: "error", diagnostics: [...input.diagnostics, ...tableResult.diagnostics] };
  }
  return { kind: "ok", table: tableResult.table };
}
