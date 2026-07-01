import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import type { AArch64UnwindCatalog } from "../api/backend-catalog-interfaces";
import type { AArch64PrologueEpiloguePlan } from "./prologue-epilogue";
import type { AArch64StackFrameLayout } from "./frame-layout";

export interface AArch64UnwindPlan {
  readonly functionKey: string;
  readonly classification: "frameless-leaf" | "serializable-unwind" | "unreachable-body";
  readonly frameSizeBytes: number;
  readonly savedRegisters: readonly string[];
  readonly templateKey?: string;
}

export function planAArch64Unwind(input: {
  readonly frame: AArch64StackFrameLayout;
  readonly finalization: AArch64PrologueEpiloguePlan;
  readonly unwindCatalog: AArch64UnwindCatalog;
}): AArch64BackendResult<AArch64UnwindPlan> {
  if (
    input.finalization.exitPlans.every(
      (plan) => plan.ending === "unreachable" || plan.ending === "noreturn",
    ) &&
    input.finalization.exitPlans.length > 0
  ) {
    return backendOk(record(input.frame, "unreachable-body"));
  }
  if (
    input.frame.totalSizeBytes === 0 &&
    input.frame.savedRegisters.length === 0 &&
    !input.frame.requiresFrameRecord
  ) {
    return backendOk(record(input.frame, "frameless-leaf"));
  }
  const shape = input.frame.requiresFrameRecord
    ? "frame-record"
    : input.frame.totalSizeBytes > 2048
      ? "large-frame"
      : "prologue";
  const template =
    input.unwindCatalog.templateForFrame(shape) ??
    input.unwindCatalog.templates.find((candidate) => candidate.frameShape === shape);
  if (template === undefined)
    return backendError([
      diagnostic(
        `unwind:unrepresentable-frame:function:${input.frame.functionKey}:size:${input.frame.totalSizeBytes}`,
      ),
    ]);
  return backendOk({
    ...record(input.frame, "serializable-unwind"),
    templateKey: template.stableKey,
  });
}

function record(
  frame: AArch64StackFrameLayout,
  classification: AArch64UnwindPlan["classification"],
): AArch64UnwindPlan {
  return Object.freeze({
    functionKey: frame.functionKey,
    classification,
    frameSizeBytes: frame.totalSizeBytes,
    savedRegisters: frame.savedRegisters,
  });
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_UNWIND_INVALID",
    ownerKey: "unwind",
    rootCauseKey: stableDetail,
    stableDetail,
  });
}
