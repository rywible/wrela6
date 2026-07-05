import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirDiagnostic } from "../diagnostics";
import type { DraftProofMirResourceBoundarySet } from "../domains/effects-resources";
import { errorResult, type DraftGraphBuilderResult } from "./draft-graph-builder-result";

export interface DraftGraphBlockStateMerge {
  readonly kind: "loopHeader";
  readonly loopScopeKey: ProofMirCanonicalKey;
  readonly boundaryResources: DraftProofMirResourceBoundarySet;
  readonly originKey: ProofMirCanonicalKey;
}

export interface DraftGraphBlockStateMergeTarget {
  stateMerge?: DraftGraphBlockStateMerge;
}

export function setDraftGraphBlockStateMerge(input: {
  readonly block: DraftGraphBlockStateMergeTarget | undefined;
  readonly blockKey: ProofMirCanonicalKey;
  readonly stateMerge: DraftGraphBlockStateMerge;
  readonly functionInstanceId: MonoInstanceId;
  readonly acceptOrigin: (originKey: ProofMirCanonicalKey) => DraftGraphBuilderResult;
}): DraftGraphBuilderResult {
  if (input.block === undefined) {
    return errorResult([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_CFG",
        message: "Cannot set block state merge on an unknown block.",
        ownerKey: `function:${String(input.functionInstanceId)}`,
        rootCauseKey: "unknown-block",
        stableDetail: String(input.blockKey),
        functionInstanceId: input.functionInstanceId,
      }),
    ]);
  }
  input.block.stateMerge = input.stateMerge;
  return input.acceptOrigin(input.stateMerge.originKey);
}
