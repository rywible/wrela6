import { aarch64Diagnostic } from "../../machine-ir/diagnostics";
import { authenticateAArch64TargetSurface } from "../../target-surface/profile-authentication";
import {
  appendAArch64StageTrace,
  okAArch64LoweringStage,
  type AArch64LoweringPipelineInput,
  type AArch64LoweringPipelineStage,
  type AArch64LoweringPipelineStageResult,
} from "../pipeline-stages";

export const authenticateTargetStage: AArch64LoweringPipelineStage = Object.freeze({
  stageKey: "authenticate-target",
  run(input: AArch64LoweringPipelineInput): AArch64LoweringPipelineStageResult {
    const tracedState = appendAArch64StageTrace(input.state, "authenticate-target");
    const authentication = authenticateAArch64TargetSurface(tracedState.target);
    if (authentication.kind === "error") {
      return {
        kind: "error",
        diagnostics: authentication.diagnostics.map((diagnostic) =>
          aarch64Diagnostic({
            code: "AARCH64_PROFILE_REJECTED",
            ownerKey: "target-surface",
            rootCauseKey: diagnostic.code,
            stableDetail: diagnostic.stableDetail,
          }),
        ),
      };
    }
    return okAArch64LoweringStage(
      Object.freeze({
        ...tracedState,
        authenticatedTargetFingerprint: authentication.fingerprint,
        consultedSubsurfaceFingerprints: Object.freeze([
          authentication.componentFingerprints.abi,
          authentication.componentFingerprints.memoryOrder,
          authentication.componentFingerprints.operationMatrix,
          authentication.componentFingerprints.planning,
          authentication.componentFingerprints.platform,
          authentication.componentFingerprints.profile,
          authentication.componentFingerprints.relocation,
          authentication.componentFingerprints.selection,
        ]),
      }),
    );
  },
});
