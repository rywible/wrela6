import { OPT_IR_OPERATION_KINDS } from "../../../../opt-ir/operation-kinds";
import { aarch64Diagnostic } from "../../machine-ir/diagnostics";
import {
  verifyAArch64OperationMatrixCoverage,
  WRELA_UEFI_AARCH64_RPI5_OPERATION_MATRIX,
} from "../../target-surface/operation-matrix";
import { verifyAArch64OperationSupportContractsForState } from "../operation-support";
import {
  appendAArch64StageTrace,
  okAArch64LoweringStage,
  type AArch64LoweringPipelineInput,
  type AArch64LoweringPipelineStage,
  type AArch64LoweringPipelineStageResult,
} from "../pipeline-stages";
import { prepareAArch64SemanticSuperselectionState } from "../../select/semantic-superselector";

export const verifyOperationMatrixStage: AArch64LoweringPipelineStage = Object.freeze({
  stageKey: "verify-operation-matrix",
  run(input: AArch64LoweringPipelineInput): AArch64LoweringPipelineStageResult {
    const tracedState = appendAArch64StageTrace(input.state, "verify-operation-matrix");
    const coverage = verifyAArch64OperationMatrixCoverage({
      operationKinds: OPT_IR_OPERATION_KINDS,
      matrix: WRELA_UEFI_AARCH64_RPI5_OPERATION_MATRIX,
    });
    if (coverage.kind === "error") {
      return {
        kind: "error",
        diagnostics: coverage.diagnostics.map((diagnostic) =>
          aarch64Diagnostic({
            code: "AARCH64_OPERATION_MATRIX_MISSING_KIND",
            ownerKey: "operation-matrix",
            rootCauseKey: diagnostic.code,
            stableDetail: diagnostic.stableDetail,
          }),
        ),
      };
    }
    const semanticState = prepareAArch64SemanticSuperselectionState(tracedState);
    const supportContracts = verifyAArch64OperationSupportContractsForState(semanticState);
    if (supportContracts.kind === "error") {
      return { kind: "error", diagnostics: supportContracts.diagnostics };
    }
    return okAArch64LoweringStage(
      Object.freeze({ ...semanticState, operationSupportContracts: supportContracts.contracts }),
    );
  },
});
