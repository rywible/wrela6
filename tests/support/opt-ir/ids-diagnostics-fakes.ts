import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  type OptIrDiagnostic,
  type OptIrDiagnosticCode,
  type OptIrDiagnosticSeverity,
} from "../../../src/opt-ir/diagnostics";
import {
  optIrOriginId,
  optIrProgramId,
  type OptIrFunctionId,
  type OptIrOriginId,
  type OptIrProgramId,
} from "../../../src/opt-ir/ids";

export function optIrProgramIdForTest(value = 0): OptIrProgramId {
  return optIrProgramId(value);
}

export function optIrDiagnosticForTest(
  input: {
    readonly severity?: OptIrDiagnosticSeverity;
    readonly code?: OptIrDiagnosticCode;
    readonly messageTemplate?: string;
    readonly arguments?: Readonly<Record<string, string | number | boolean>>;
    readonly ownerKey?: string;
    readonly rootCauseKey?: string;
    readonly stableDetail?: string;
    readonly originId?: OptIrOriginId;
    readonly functionId?: OptIrFunctionId;
  } = {},
): OptIrDiagnostic {
  const code = input.code ?? optIrDiagnosticCode("OPT_IR_INPUT_CONTRACT_INVALID");
  const originId = input.originId ?? optIrOriginId(0);
  const functionId = input.functionId;
  const ownerKey = input.ownerKey ?? "owner";
  const rootCauseKey = input.rootCauseKey ?? "root";
  const stableDetail = input.stableDetail ?? "detail";

  return {
    severity: input.severity ?? "error",
    code,
    messageTemplate: input.messageTemplate ?? "message {value}",
    arguments: input.arguments ?? { value: "test" },
    ownerKey,
    rootCauseKey,
    stableDetail,
    originId,
    ...(functionId !== undefined ? { functionId } : {}),
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(originId),
      functionKey: functionId === undefined ? "" : String(functionId),
      code,
      ownerKey,
      rootCauseKey,
      stableDetail,
    }),
  };
}
