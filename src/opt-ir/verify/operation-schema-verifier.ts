import { optIrOperationSchemaForKind } from "../operation-schema";
import type { OptIrOperation } from "../operations";
import { makeOptIrVerifierDiagnostic, type OptIrVerifierContext } from "./structural-verifier";

export function verifyOptIrOperationSchema(input: {
  readonly operation: OptIrOperation;
  readonly context: OptIrVerifierContext;
}) {
  const diagnostics = [];
  try {
    optIrOperationSchemaForKind(input.operation.kind);
  } catch {
    diagnostics.push(
      makeOptIrVerifierDiagnostic({
        code: "OPT_IR_INPUT_CONTRACT_INVALID",
        messageTemplate: "Operation has no matching OptIR schema.",
        ownerKey: `operation:${input.operation.operationId}`,
        rootCauseKey: `operation-kind:${input.operation.kind}`,
        stableDetail: `missing-operation-schema:${input.operation.kind}`,
        originId: input.operation.originId,
        functionId: input.context.functionId,
      }),
    );
  }

  if (input.operation.resultIds.length !== input.operation.resultTypes.length) {
    diagnostics.push(
      makeOptIrVerifierDiagnostic({
        code: "OPT_IR_INPUT_CONTRACT_INVALID",
        messageTemplate: "Operation result IDs and result types must have matching arity.",
        ownerKey: `operation:${input.operation.operationId}`,
        rootCauseKey: `operation-results:${input.operation.operationId}`,
        stableDetail: `result-arity:${input.operation.resultIds.length}:${input.operation.resultTypes.length}`,
        originId: input.operation.originId,
        functionId: input.context.functionId,
      }),
    );
  }
  return diagnostics;
}
