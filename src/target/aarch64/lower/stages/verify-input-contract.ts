import {
  appendAArch64StageTrace,
  okAArch64LoweringStage,
  type AArch64LoweringPipelineInput,
  type AArch64LoweringPipelineStage,
  type AArch64LoweringPipelineStageResult,
  type AArch64LoweringState,
} from "../pipeline-stages";
import type { AArch64LoweringDiagnostic } from "../../machine-ir/diagnostics";
import { aarch64Diagnostic } from "../../machine-ir/diagnostics";
import type { OptIrDiagnostic } from "../../../../opt-ir/diagnostics";
import type { OptIrOperation } from "../../../../opt-ir/operations";
import { verifyOptIrOperationMetadata } from "../../../../opt-ir/verify/operation-metadata-verifier";
import { verifyOptIrOperationSchema } from "../../../../opt-ir/verify/operation-schema-verifier";
import { verifyOptIrSsa } from "../../../../opt-ir/verify/ssa-verifier";
import type { OptIrVerifierContext } from "../../../../opt-ir/verify/structural-verifier";
import { aarch64StageDiagnostic } from "../stage-helpers";

export const verifyInputContractStage: AArch64LoweringPipelineStage = Object.freeze({
  stageKey: "verify-input-contract",
  run(input: AArch64LoweringPipelineInput): AArch64LoweringPipelineStageResult {
    const state = appendAArch64StageTrace(input.state, "verify-input-contract");
    if (state.authenticatedTargetFingerprint === undefined) {
      return {
        kind: "error" as const,
        diagnostics: [inputContractDiagnostic("input-contract:target-not-authenticated")],
      };
    }
    const diagnostics = verifyInputContract(state);
    return diagnostics.length === 0
      ? okAArch64LoweringStage(state)
      : { kind: "error" as const, diagnostics };
  },
});

function verifyInputContract(state: AArch64LoweringState): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  for (const operationId of state.operationInputDuplicateIds) {
    diagnostics.push(
      inputContractDiagnostic(`input-contract:duplicate-operation-id:${String(operationId)}`),
    );
  }
  for (const [operationId, operation] of state.operations.entries()) {
    if (operation.operationId !== operationId) {
      diagnostics.push(
        inputContractDiagnostic(
          `input-contract:operation-id-mismatch:${String(operationId)}:${String(operation.operationId)}`,
        ),
      );
    }
  }

  for (const sourceFunction of state.program.functions.entries()) {
    const functionId = String(sourceFunction.functionId);
    const blocksById = new Map(sourceFunction.blocks.map((block) => [block.blockId, block]));
    if (!blocksById.has(sourceFunction.entryBlock)) {
      diagnostics.push(
        inputContractDiagnostic(
          `input-contract:entry-block-missing:${functionId}:${String(sourceFunction.entryBlock)}`,
        ),
      );
    }
    for (const block of sourceFunction.blocks) {
      for (const operationId of block.operations) {
        if (!state.operations.has(operationId)) {
          diagnostics.push(
            inputContractDiagnostic(
              `input-contract:operation-missing:${functionId}:${String(operationId)}`,
            ),
          );
        }
      }
    }
    for (const edge of sourceFunction.edges.entries()) {
      if (!blocksById.has(edge.from)) {
        diagnostics.push(
          inputContractDiagnostic(
            `input-contract:cfg-edge-source-missing:${functionId}:${String(edge.edgeId)}:${String(edge.from)}`,
          ),
        );
      }
      if (edge.toBlock === undefined) {
        continue;
      }
      const targetBlock = blocksById.get(edge.toBlock);
      if (targetBlock === undefined) {
        diagnostics.push(
          inputContractDiagnostic(
            `input-contract:cfg-edge-target-missing:${functionId}:${String(edge.edgeId)}:${String(edge.toBlock)}`,
          ),
        );
      }
      const parameterCount = targetBlock?.parameters.length ?? 0;
      if (edge.arguments.length !== parameterCount) {
        diagnostics.push(
          inputContractDiagnostic(
            `input-contract:edge-argument-arity:${functionId}:${String(edge.edgeId)}:${edge.arguments.length}:${parameterCount}`,
          ),
        );
      }
    }
  }
  if (diagnostics.length === 0) {
    diagnostics.push(...verifyOptIrContract(state));
  }
  if (diagnostics.length === 0) {
    diagnostics.push(...verifyAArch64MaterializationInputShapes(state.operations.values()));
  }
  return Object.freeze(diagnostics);
}

function verifyOptIrContract(state: AArch64LoweringState): readonly AArch64LoweringDiagnostic[] {
  const options = { checkDominance: true, recomputeOperationMetadata: true };
  const diagnostics: OptIrDiagnostic[] = [];
  const programContext: OptIrVerifierContext = {
    options,
    originId: state.program.provenance.originIds[0],
  };
  for (const operation of [...state.operations.values()].sort(
    (left, right) => Number(left.operationId) - Number(right.operationId),
  )) {
    diagnostics.push(...verifyOptIrOperationSchema({ operation, context: programContext }));
    diagnostics.push(...verifyOptIrOperationMetadata({ operation, context: programContext }));
  }
  for (const sourceFunction of state.program.functions.entries()) {
    diagnostics.push(
      ...verifyOptIrSsa({
        func: sourceFunction,
        operations: state.operations,
        context: {
          options,
          functionId: sourceFunction.functionId,
          originId: sourceFunction.originId,
        },
      }).diagnostics,
    );
  }
  return diagnostics.map((diagnostic) =>
    aarch64Diagnostic({
      code: "AARCH64_INPUT_CONTRACT_INVALID",
      ownerKey: `opt-ir:${diagnostic.ownerKey}`,
      rootCauseKey: `opt-ir:${diagnostic.rootCauseKey}`,
      stableDetail: `input-contract:opt-ir:${diagnostic.stableDetail}`,
    }),
  );
}

function verifyAArch64MaterializationInputShapes(
  operations: Iterable<OptIrOperation>,
): readonly AArch64LoweringDiagnostic[] {
  const diagnostics: AArch64LoweringDiagnostic[] = [];
  for (const operation of operations) {
    switch (operation.kind) {
      case "vectorShuffle":
      case "vectorCompare":
      case "semanticChecksum":
      case "semanticPolynomial":
      case "semanticCryptoMix":
      case "semanticClassifier":
        requireMinimumSourceValues(diagnostics, operation, 2);
        break;
      case "vectorSelect":
        requireMinimumSourceValues(diagnostics, operation, 2);
        break;
      case "fpNumeric":
        requireMinimumSourceValues(diagnostics, operation, 3);
        break;
      default:
        break;
    }
  }
  return Object.freeze(diagnostics);
}

function requireMinimumSourceValues(
  diagnostics: AArch64LoweringDiagnostic[],
  operation: Extract<OptIrOperation, { readonly sourceValueIds: readonly unknown[] }>,
  minimum: number,
): void {
  if (operation.sourceValueIds.length >= minimum) {
    return;
  }
  diagnostics.push(
    inputContractDiagnostic(
      `input-contract:aarch64-source-arity:${String(operation.operationId)}:${operation.kind}:${operation.sourceValueIds.length}:${minimum}`,
    ),
  );
}

function inputContractDiagnostic(stableDetail: string): AArch64LoweringDiagnostic {
  return aarch64StageDiagnostic({
    stageKey: "verify-input-contract",
    stableDetail,
  });
}
