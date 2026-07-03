import type { ProofMirLoweringContext } from "./lowering-context";
import type { ProofMirCallLoweringRecorder } from "./call-lowering-recorder";
import { proofMirRuntimeCallId, type ProofMirRuntimeCallId } from "../ids";

export function allocateProofMirRuntimeCallId(input: {
  readonly context: ProofMirLoweringContext;
  readonly recorder?: ProofMirCallLoweringRecorder;
}): ProofMirRuntimeCallId {
  const usedIds = new Set(
    input.context.buildContext.programDraft.runtimeCalls
      .entries()
      .map((entry) => String(entry.runtimeCallId)),
  );
  for (const entry of input.recorder?.runtimeCalls ?? []) {
    usedIds.add(String(entry.runtimeCallId));
  }

  let candidate = 1;
  while (usedIds.has(String(proofMirRuntimeCallId(candidate)))) {
    candidate += 1;
  }
  return proofMirRuntimeCallId(candidate);
}
