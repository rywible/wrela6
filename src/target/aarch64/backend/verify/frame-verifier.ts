import {
  aarch64BackendDiagnostic,
  backendError,
  backendOk,
  type AArch64BackendDiagnostic,
  type AArch64BackendResult,
} from "../api/diagnostics";
import type { AArch64StackFrameLayout } from "../frame/frame-layout";

export function verifyAArch64FrameLayout(input: {
  readonly frame: AArch64StackFrameLayout;
}): AArch64BackendResult<{ readonly verified: true }> {
  const diagnostics: AArch64BackendDiagnostic[] = [];
  if (input.frame.totalSizeBytes % 16 !== 0)
    diagnostics.push(
      diagnostic(
        `frame-verifier:sp-unaligned:${input.frame.functionKey}:${input.frame.totalSizeBytes}`,
      ),
    );
  for (let leftIndex = 0; leftIndex < input.frame.slots.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < input.frame.slots.length; rightIndex += 1) {
      const left = input.frame.slots[leftIndex];
      const right = input.frame.slots[rightIndex];
      if (left === undefined || right === undefined || !overlaps(left, right)) continue;
      if (left.securityLabel !== right.securityLabel)
        diagnostics.push(
          diagnostic(`frame-verifier:incompatible-slot-overlap:${left.slotKey}:${right.slotKey}`),
        );
    }
  }
  return diagnostics.length === 0 ? backendOk({ verified: true }) : backendError(diagnostics);
}

function overlaps(
  left: { readonly offsetBytes: number; readonly sizeBytes: number },
  right: { readonly offsetBytes: number; readonly sizeBytes: number },
): boolean {
  return (
    left.offsetBytes < right.offsetBytes + right.sizeBytes &&
    right.offsetBytes < left.offsetBytes + left.sizeBytes
  );
}

function diagnostic(stableDetail: string): AArch64BackendDiagnostic {
  return aarch64BackendDiagnostic({
    code: "AARCH64_BACKEND_FRAME_INVALID",
    ownerKey: "frame-verifier",
    rootCauseKey: stableDetail,
    stableDetail,
  });
}
