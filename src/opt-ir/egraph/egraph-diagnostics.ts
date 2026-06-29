import { optIrDiagnosticCode, optIrDiagnosticOrderKey, type OptIrDiagnostic } from "../diagnostics";
import type { OptIrOperationId, OptIrOriginId } from "../ids";

export type OptIrEGraphDiagnosticReason =
  | "boundary"
  | "effect-token-window"
  | "missing-operation"
  | "unsupported-region";

export function optIrEGraphDiagnostic(input: {
  readonly reason: OptIrEGraphDiagnosticReason;
  readonly operationId?: OptIrOperationId;
  readonly originId?: OptIrOriginId;
  readonly stableDetail: string;
}): OptIrDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_EGRAPH_REGION_REJECTED");
  const ownerKey =
    input.operationId === undefined ? `egraph:${input.reason}` : `operation:${input.operationId}`;
  return {
    severity: "info",
    code,
    messageTemplate: "E-graph candidate was rejected: {reason}.",
    arguments: { reason: input.reason },
    ownerKey,
    rootCauseKey: input.reason,
    stableDetail: input.stableDetail,
    ...(input.originId === undefined ? {} : { originId: input.originId }),
    orderKey: optIrDiagnosticOrderKey({
      originKey: input.originId === undefined ? "" : String(input.originId),
      functionKey: "",
      code,
      ownerKey,
      rootCauseKey: input.reason,
      stableDetail: input.stableDetail,
    }),
  };
}
