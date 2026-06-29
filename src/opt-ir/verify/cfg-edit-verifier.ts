import type { OptIrCfgEdit } from "../cfg-edits";
import type { OptIrDiagnostic } from "../diagnostics";
import type { OptIrBlockId, OptIrEdgeId, OptIrOperationId } from "../ids";
import type { OptIrOperation } from "../operations";
import { makeOptIrVerifierDiagnostic, type OptIrVerifierContext } from "./structural-verifier";

export interface OptIrCfgSnapshotReferenceSet {
  readonly edges?: ReadonlySet<OptIrEdgeId>;
  readonly blocks?: ReadonlySet<OptIrBlockId>;
}

export function verifyOptIrCfgEdits(input: {
  readonly cfgEdits: readonly OptIrCfgEdit[];
  readonly oldCfg?: OptIrCfgSnapshotReferenceSet;
  readonly newCfg?: OptIrCfgSnapshotReferenceSet;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly context: OptIrVerifierContext;
}): readonly OptIrDiagnostic[] {
  const diagnostics: OptIrDiagnostic[] = [];
  for (const edit of input.cfgEdits) {
    verifyOperationReference({
      diagnostics,
      operationId: edit.oldTerminator,
      operations: input.operations,
      editKind: edit.kind,
      role: "old-terminator",
      context: input.context,
    });
    switch (edit.kind) {
      case "branchFold":
        verifyEdgeReference({
          diagnostics,
          edgeId: edit.survivingEdge,
          edgeSet: input.newCfg?.edges,
          editKind: edit.kind,
          role: "surviving-edge",
          context: input.context,
        });
        for (const edgeId of edit.removedEdges) {
          verifyEdgeReference({
            diagnostics,
            edgeId,
            edgeSet: input.oldCfg?.edges,
            editKind: edit.kind,
            role: "removed-edge",
            context: input.context,
          });
        }
        break;
      case "redirectEdge":
        verifyEdgeReference({
          diagnostics,
          edgeId: edit.edge,
          edgeSet: input.oldCfg?.edges,
          editKind: edit.kind,
          role: "redirected-edge",
          context: input.context,
        });
        verifyOperationReference({
          diagnostics,
          operationId: edit.newTerminator,
          operations: input.operations,
          editKind: edit.kind,
          role: "new-terminator",
          context: input.context,
        });
        break;
    }
  }
  return diagnostics;
}

function verifyEdgeReference(input: {
  readonly diagnostics: OptIrDiagnostic[];
  readonly edgeId: OptIrEdgeId;
  readonly edgeSet: ReadonlySet<OptIrEdgeId> | undefined;
  readonly editKind: OptIrCfgEdit["kind"];
  readonly role: string;
  readonly context: OptIrVerifierContext;
}): void {
  if (input.edgeSet?.has(input.edgeId) !== false) {
    return;
  }
  input.diagnostics.push(
    makeOptIrVerifierDiagnostic({
      code: "OPT_IR_CFG_EDGE_MISSING",
      messageTemplate:
        "CFG edit references an edge that is missing from the expected CFG snapshot.",
      ownerKey: `cfg-edit:${input.editKind}:${input.role}`,
      rootCauseKey: `edge:${input.edgeId}`,
      stableDetail: `cfg-edit-edge:${input.editKind}:${input.role}:${input.edgeId}`,
      originId: input.context.originId,
      functionId: input.context.functionId,
    }),
  );
}

function verifyOperationReference(input: {
  readonly diagnostics: OptIrDiagnostic[];
  readonly operationId: OptIrOperationId;
  readonly operations: ReadonlyMap<OptIrOperationId, OptIrOperation>;
  readonly editKind: OptIrCfgEdit["kind"];
  readonly role: string;
  readonly context: OptIrVerifierContext;
}): void {
  if (input.operations.has(input.operationId)) {
    return;
  }
  input.diagnostics.push(
    makeOptIrVerifierDiagnostic({
      code: "OPT_IR_INPUT_CONTRACT_INVALID",
      messageTemplate: "CFG edit references an operation that is missing from the verifier input.",
      ownerKey: `cfg-edit:${input.editKind}:${input.role}`,
      rootCauseKey: `operation:${input.operationId}`,
      stableDetail: `cfg-edit-operation:${input.editKind}:${input.role}:${input.operationId}`,
      originId: input.context.originId,
      functionId: input.context.functionId,
    }),
  );
}
