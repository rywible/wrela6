import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
  type OptIrDiagnosticSeverity,
} from "./diagnostics";
import type { OptIrFunctionId } from "./ids";

export type OptIrOptimizationDiagnostic = OptIrDiagnostic & {
  readonly passName: string;
  readonly optimizationCode: string;
  readonly blockId?: string | number;
  readonly operationId?: string | number;
};

export function optIrOptimizationDiagnostic(input: {
  readonly severity?: OptIrDiagnosticSeverity;
  readonly passName: string;
  readonly optimizationCode?: string;
  readonly ownerKey: string;
  readonly stableDetail: string;
  readonly messageTemplate?: string;
  readonly functionId?: OptIrFunctionId;
  readonly blockId?: string | number;
  readonly operationId?: string | number;
}): OptIrOptimizationDiagnostic {
  const code = optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID");
  const rootCauseKey = input.passName;
  return {
    severity: input.severity ?? "info",
    code,
    passName: input.passName,
    optimizationCode: input.optimizationCode ?? String(code),
    messageTemplate: input.messageTemplate ?? input.stableDetail,
    arguments: {
      passName: input.passName,
      optimizationCode: input.optimizationCode ?? String(code),
    },
    ownerKey: input.ownerKey,
    rootCauseKey,
    stableDetail: input.stableDetail,
    functionId: input.functionId,
    blockId: input.blockId,
    operationId: input.operationId,
    orderKey: optIrDiagnosticOrderKey({
      originKey: "",
      functionKey: input.functionId === undefined ? "" : String(input.functionId),
      code,
      ownerKey: input.ownerKey,
      rootCauseKey,
      stableDetail: [
        input.blockId === undefined ? "" : `block:${input.blockId}`,
        input.operationId === undefined ? "" : `operation:${input.operationId}`,
        input.stableDetail,
      ].join("/"),
    }),
  };
}

export function optIrOptimizationInfo(
  input: Omit<Parameters<typeof optIrOptimizationDiagnostic>[0], "severity" | "ownerKey"> & {
    readonly ownerKey?: string;
  },
): OptIrOptimizationDiagnostic {
  return optIrOptimizationDiagnostic({
    ...input,
    severity: "info",
    ownerKey: input.ownerKey ?? "opt-ir-optimization",
  });
}

export function optIrOptimizationWarning(
  input: Omit<Parameters<typeof optIrOptimizationDiagnostic>[0], "severity" | "ownerKey"> & {
    readonly ownerKey?: string;
  },
): OptIrOptimizationDiagnostic {
  return optIrOptimizationDiagnostic({
    ...input,
    severity: "warning",
    ownerKey: input.ownerKey ?? "opt-ir-optimization",
  });
}

export function optIrOptimizationError(
  input: Omit<Parameters<typeof optIrOptimizationDiagnostic>[0], "severity" | "ownerKey"> & {
    readonly ownerKey?: string;
  },
): OptIrOptimizationDiagnostic {
  return optIrOptimizationDiagnostic({
    ...input,
    severity: "error",
    ownerKey: input.ownerKey ?? "opt-ir-optimization",
  });
}

export { sortOptIrDiagnostics };
