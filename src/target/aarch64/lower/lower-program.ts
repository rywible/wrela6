import { emptyAArch64PreservedFactSet } from "../machine-ir/fact-set";
import {
  aarch64Diagnostic,
  sortAArch64Diagnostics,
  type AArch64LoweringDiagnostic,
} from "../machine-ir/diagnostics";
import { defaultAArch64LoweringPipeline } from "./default-pipeline";
import { createAArch64LoweringState } from "./lowering-context";
import type { LowerOptIrToAArch64Input, LowerOptIrToAArch64Result } from "../public-api";
import type { AArch64LoweringPipelineStage } from "./pipeline-stages";

export interface LowerOptIrToAArch64ProgramInternalInput extends LowerOptIrToAArch64Input {
  readonly pipeline?: readonly AArch64LoweringPipelineStage[];
}

export function lowerOptIrToAArch64Program(
  input: LowerOptIrToAArch64ProgramInternalInput,
): LowerOptIrToAArch64Result {
  let state = createAArch64LoweringState({
    program: input.program,
    operations: input.operations,
    optimizationRegions: input.optimizationRegions,
    facts: input.facts,
    target: input.target,
    options: input.options ?? {},
    preservedFacts: emptyAArch64PreservedFactSet(),
  });
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  for (const stage of input.pipeline ?? defaultAArch64LoweringPipeline) {
    const result = stage.run({ state });
    if (result.kind === "error") {
      return { kind: "error", diagnostics: sortAArch64Diagnostics(result.diagnostics) };
    }
    state = result.output.state;
    diagnostics.push(...result.diagnostics);
  }
  if (state.machineProgram === undefined || state.preservedFacts === undefined) {
    return {
      kind: "error",
      diagnostics: sortAArch64Diagnostics([
        aarch64Diagnostic({
          code: "AARCH64_INPUT_CONTRACT_INVALID",
          ownerKey: "lower-program",
          rootCauseKey: "pipeline",
          stableDetail: "lowering-pipeline:missing-output",
        }),
      ]),
    };
  }
  return {
    kind: "ok",
    machineProgram: state.machineProgram,
    preservedFacts: state.preservedFacts,
    provenance: state.provenance,
    ...(input.options?.debugTrace === true || input.options?.deterministicDump === true
      ? { debugOutput: state.debugOutput }
      : {}),
    diagnostics: sortAArch64Diagnostics(diagnostics),
  };
}
