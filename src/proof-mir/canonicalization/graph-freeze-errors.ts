import type { MonoInstanceId } from "../../mono/ids";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";

export interface FreezeGraphSnapshotErrorContext {
  readonly diagnostics: ProofMirDiagnostic[];
  readonly ownerKey: string;
  readonly functionInstanceId: MonoInstanceId;
}

export function pushFreezeUnresolvedReference(
  context: FreezeGraphSnapshotErrorContext,
  referenceKind: string,
  stableDetail: string,
  message: string,
): void {
  context.diagnostics.push(
    proofMirDiagnostic({
      severity: "error",
      code: "PROOF_MIR_INVALID_TABLE_CANONICAL_KEY",
      message,
      functionInstanceId: context.functionInstanceId,
      ownerKey: context.ownerKey,
      rootCauseKey: referenceKind,
      stableDetail,
    }),
  );
}
