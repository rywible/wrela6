import { appendAArch64SelectionRecord, type AArch64LoweringState } from "../lower/pipeline-stages";
import { selectAArch64ScalarOperation, type AArch64ScalarOperationShape } from "./scalar-selection";

export function selectAArch64LocalOperation(input: {
  readonly operation: AArch64ScalarOperationShape;
}): ReturnType<typeof selectAArch64ScalarOperation> {
  return selectAArch64ScalarOperation(input.operation);
}

export function selectAArch64LocalScalarsStageState(
  state: AArch64LoweringState,
): AArch64LoweringState {
  return appendAArch64SelectionRecord(state, {
    stageKey: "select-local-scalar",
    subjectKey: "program",
    patternId: "scalar.local-baseline-cover",
    tier: "local",
    factsUsed: [],
    emittedOpcodes: [],
    explanation: ["select-local-scalar:baseline-cover-recorded"],
  });
}
