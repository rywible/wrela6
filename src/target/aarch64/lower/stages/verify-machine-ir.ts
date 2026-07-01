import { aarch64Diagnostic } from "../../machine-ir/diagnostics";
import { verifyAArch64MachineProgram } from "../../verify/machine-ir-verifier";
import type { AArch64LoweringSelectionRecord } from "../pipeline-stages";
import {
  appendAArch64StageTrace,
  okAArch64LoweringStage,
  type AArch64LoweringPipelineInput,
  type AArch64LoweringPipelineStage,
  type AArch64LoweringPipelineStageResult,
} from "../pipeline-stages";

export const verifyMachineIrStage: AArch64LoweringPipelineStage = Object.freeze({
  stageKey: "verify-machine-ir",
  run(input: AArch64LoweringPipelineInput): AArch64LoweringPipelineStageResult {
    const tracedState = appendAArch64StageTrace(input.state, "verify-machine-ir");
    if (tracedState.machineProgram === undefined) {
      return {
        kind: "error",
        diagnostics: [
          aarch64Diagnostic({
            code: "AARCH64_INPUT_CONTRACT_INVALID",
            ownerKey: "verify-machine-ir",
            rootCauseKey: "machine-program",
            stableDetail: "verify-machine-ir:missing-machine-program",
          }),
        ],
      };
    }
    const verification = verifyAArch64MachineProgram({
      program: tracedState.machineProgram,
      options: { requiredVerifierKeys: [] },
      abi: tracedState.target.abi,
      preservedFacts: tracedState.preservedFacts,
      preservedOptIrFactIds: tracedState.facts.records.map((record) => Number(record.factId)),
      selectionCandidates: selectionCandidatesFromRecords(tracedState.selectionRecords),
      requiredSelectionCoverage: tracedState.program.functions
        .entries()
        .flatMap((sourceFunction) =>
          sourceFunction.blocks.flatMap((block) => block.operations.map(Number)),
        ),
      semanticCandidates: tracedState.semanticCandidates,
      semanticManifestLiveOuts: tracedState.semanticManifestLiveOuts,
      semanticOperationKindsById: Object.fromEntries(
        [...tracedState.operations.values()].map((operation) => [
          Number(operation.operationId),
          operation.kind,
        ]),
      ),
      targetProfileFeatures: ["BASE_A64", ...tracedState.target.profile.requiredFeatures],
      dependencyEdges: tracedState.dependencyEdges,
      requiredEdges: tracedState.requiredEdges,
      scheduleOrderByBlock: tracedState.scheduleOrderByBlock,
    });
    if (verification.kind === "error") {
      return { kind: "error", diagnostics: verification.diagnostics };
    }
    return okAArch64LoweringStage(tracedState);
  },
});

function selectionCandidatesFromRecords(records: readonly AArch64LoweringSelectionRecord[]) {
  return records.flatMap((record, index) => {
    const coveredOperationIds = record.coveredOperationIds ?? [];
    if (coveredOperationIds.length === 0) {
      return [];
    }
    return [
      {
        patternId: record.patternId,
        covers: coveredOperationIds,
        tier: record.tier === "planning" ? ("helper" as const) : record.tier,
        cost: index,
        factsUsed: record.factsUsed,
        emittedOpcodes: record.emittedOpcodes,
      },
    ];
  });
}
