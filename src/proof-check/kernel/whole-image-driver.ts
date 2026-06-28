import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import {
  buildCheckedFunctionSummary,
  checkSourceCallTransfer,
  type BuildCheckedFunctionSummaryInput,
  type BuildCheckedFunctionSummaryResult,
  type CheckedSourceCallTransferInput,
} from "../domains/source-calls";
import { buildInitialProofCheckState } from "../domains/initial-state";
import {
  entryLayoutFactsForValidatedBufferParameters,
  functionEntrySignatureFromMir,
  seededFactsForValidatedBufferParameters,
} from "../domains/function-entry-state";
import type { ValidateProofCheckInputResult } from "../input-contract";
import type {
  CheckedFunctionSummary,
  CheckedFunctionSummaryTable,
} from "../model/function-summary";
import { runProofCheckFunctionKernel, type ProofCheckFunctionKernelResult } from "./checker-kernel";
import type { ProofCheckOperationTransferRegistry } from "./operation-dispatch";
import type { ProofCheckState } from "./state";
import { createProofCheckState } from "./state";

export interface ProofCheckWholeImageFunctionCheckInput {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly entryState: ProofCheckState;
  readonly summaries: CheckedFunctionSummaryTable;
  readonly registry: ProofCheckOperationTransferRegistry;
}

export interface ProofCheckWholeImageFunctionCheckResult {
  readonly kernelResult: ProofCheckFunctionKernelResult;
  readonly summaryResult: BuildCheckedFunctionSummaryResult;
}

export type ProofCheckWholeImageFunctionChecker = (
  input: ProofCheckWholeImageFunctionCheckInput,
) => ProofCheckWholeImageFunctionCheckResult;

export interface ProofCheckWholeImageDriverInput {
  readonly mir: ProofMirProgram;
  readonly validatedInput: ValidateProofCheckInputResult;
  readonly registry: ProofCheckOperationTransferRegistry;
  readonly checkFunction?: ProofCheckWholeImageFunctionChecker;
  readonly buildSummaryInput?: (
    input: ProofCheckWholeImageFunctionCheckInput & {
      readonly kernelResult: ProofCheckFunctionKernelResult;
    },
  ) => BuildCheckedFunctionSummaryInput | undefined;
}

export interface ProofCheckWholeImageDriverResult {
  readonly kind: "ok" | "error";
  readonly summaries: CheckedFunctionSummaryTable;
  readonly diagnostics: readonly ProofCheckDiagnostic[];
  readonly checkedFunctionOrder: readonly MonoInstanceId[];
}

export function resolveAcceptedSourceCallSummary(input: {
  readonly summaries: CheckedFunctionSummaryTable;
  readonly calleeFunctionInstanceId: MonoInstanceId;
}): CheckedFunctionSummary | undefined {
  return input.summaries.get(input.calleeFunctionInstanceId);
}

export function calleePrecedesCallerInOrder(input: {
  readonly order: readonly MonoInstanceId[];
  readonly calleeFunctionInstanceId: MonoInstanceId;
  readonly callerFunctionInstanceId: MonoInstanceId;
}): boolean {
  const calleeIndex = input.order.findIndex(
    (functionInstanceId) => String(functionInstanceId) === String(input.calleeFunctionInstanceId),
  );
  const callerIndex = input.order.findIndex(
    (functionInstanceId) => String(functionInstanceId) === String(input.callerFunctionInstanceId),
  );
  if (calleeIndex < 0 || callerIndex < 0) {
    return false;
  }
  return calleeIndex < callerIndex;
}

function inputValidationFailed(
  validatedInput: ValidateProofCheckInputResult,
): ProofCheckWholeImageDriverResult | undefined {
  const errors = validatedInput.diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errors.length === 0) {
    return undefined;
  }
  return {
    kind: "error",
    summaries: new Map(),
    diagnostics: sortProofCheckDiagnostics(errors),
    checkedFunctionOrder: [],
  };
}

function defaultSummaryInput(
  input: ProofCheckWholeImageFunctionCheckInput & {
    readonly kernelResult: ProofCheckFunctionKernelResult;
  },
): BuildCheckedFunctionSummaryInput | undefined {
  const functionGraph = input.mir.functions.get(input.functionInstanceId);
  if (functionGraph === undefined) {
    return undefined;
  }
  return {
    functionInstanceId: input.functionInstanceId,
    declaredRequirements: [],
    normalReturnExitStates: [input.entryState],
    returnFactCandidates: [],
  };
}

export function runProofCheckWholeImageDriver(
  input: ProofCheckWholeImageDriverInput,
): ProofCheckWholeImageDriverResult {
  const validationFailure = inputValidationFailed(input.validatedInput);
  if (validationFailure !== undefined) {
    return validationFailure;
  }

  const summaries = new Map<MonoInstanceId, CheckedFunctionSummary>();
  const diagnostics: ProofCheckDiagnostic[] = [];
  const checkedFunctionOrder: MonoInstanceId[] = [];
  const checkFunction = input.checkFunction ?? defaultWholeImageFunctionChecker(input);

  for (const functionInstanceId of input.validatedInput.reachableFunctionOrder) {
    const functionGraph = input.mir.functions.get(functionInstanceId);
    if (functionGraph === undefined && input.checkFunction === undefined) {
      diagnostics.push(
        proofCheckDiagnostic({
          severity: "error",
          code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
          messageTemplateId: "proof-check.whole-image.missing-function",
          messageArguments: [{ kind: "text", value: String(functionInstanceId) }],
          message: `Whole-image driver cannot check missing function ${String(functionInstanceId)}`,
          ownerKey: `function:${String(functionInstanceId)}`,
          rootCauseKey: "proof-check:whole-image",
          stableDetail: `missing-function:${String(functionInstanceId)}`,
          functionInstanceId,
        }),
      );
      continue;
    }

    let entryState: ProofCheckState;
    if (functionGraph === undefined) {
      entryState = createProofCheckState({});
    } else {
      const signature = functionEntrySignatureFromMir({
        functionGraph,
        functionInstanceId,
      });
      const entryStateResult = buildInitialProofCheckState({
        functionInstanceId,
        entryReason: "ordinarySource",
        signature,
        declaredRequirements: [],
        authorityFingerprints: [],
        intrinsicFacts: seededFactsForValidatedBufferParameters({
          mir: input.mir,
          functionGraph,
          functionInstanceId,
          signature,
        }),
        entryValidatedBufferLayout: entryLayoutFactsForValidatedBufferParameters({
          mir: input.mir,
          functionGraph,
          signature,
        }),
      });
      if (entryStateResult.kind === "error") {
        diagnostics.push(...entryStateResult.diagnostics);
        continue;
      }
      entryState = entryStateResult.state;
    }

    const checkResult = checkFunction({
      mir: input.mir,
      functionInstanceId,
      entryState,
      summaries,
      registry: input.registry,
    });

    diagnostics.push(...checkResult.kernelResult.diagnostics);
    checkedFunctionOrder.push(functionInstanceId);

    if (checkResult.summaryResult.kind === "error") {
      diagnostics.push(...checkResult.summaryResult.diagnostics);
      continue;
    }

    summaries.set(functionInstanceId, checkResult.summaryResult.summary);
  }

  const hasErrors = diagnostics.some((diagnostic) => diagnostic.severity === "error");
  return {
    kind: hasErrors ? "error" : "ok",
    summaries,
    diagnostics: sortProofCheckDiagnostics(diagnostics),
    checkedFunctionOrder,
  };
}

function defaultWholeImageFunctionChecker(
  driverInput: ProofCheckWholeImageDriverInput,
): ProofCheckWholeImageFunctionChecker {
  return (input) => {
    const kernelResult = runProofCheckFunctionKernel({
      mir: input.mir,
      functionInstanceId: input.functionInstanceId,
      entryState: input.entryState,
      registry: input.registry,
    });
    const summaryInput =
      driverInput.buildSummaryInput?.({ ...input, kernelResult }) ??
      defaultSummaryInput({ ...input, kernelResult });
    const summaryResult =
      summaryInput === undefined
        ? {
            kind: "error" as const,
            diagnostics: [
              proofCheckDiagnostic({
                severity: "error",
                code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
                messageTemplateId: "proof-check.whole-image.summary-input-missing",
                messageArguments: [{ kind: "text", value: String(input.functionInstanceId) }],
                message: `Cannot build summary input for ${String(input.functionInstanceId)}`,
                ownerKey: `function:${String(input.functionInstanceId)}`,
                rootCauseKey: "proof-check:whole-image",
                stableDetail: `summary-input-missing:${String(input.functionInstanceId)}`,
                functionInstanceId: input.functionInstanceId,
              }),
            ],
          }
        : buildCheckedFunctionSummary(summaryInput);
    return { kernelResult, summaryResult };
  };
}

export function transferSourceCallWithAcceptedSummary(
  input: CheckedSourceCallTransferInput & {
    readonly summaries: CheckedFunctionSummaryTable;
  },
): ReturnType<typeof checkSourceCallTransfer> {
  if (input.summary !== undefined) {
    return checkSourceCallTransfer(input);
  }
  if (input.call.target.kind !== "sourceFunction") {
    return checkSourceCallTransfer(input);
  }
  const acceptedSummary = resolveAcceptedSourceCallSummary({
    summaries: input.summaries,
    calleeFunctionInstanceId: input.call.target.functionInstanceId,
  });
  return checkSourceCallTransfer({
    ...input,
    summary: acceptedSummary,
  });
}
