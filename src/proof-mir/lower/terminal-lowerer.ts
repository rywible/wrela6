import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirDiagnostic } from "../diagnostics";
import type { ProofMirExitBoundary, ProofMirExitClosurePolicy } from "../model/graph";
import { operandValueKey } from "./lowering-operands";
import {
  reportProofMirLoweringDiagnostic,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirPanicLoweringInput,
  type ProofMirReachableMonoErrorLoweringInput,
  type ProofMirReturnLoweringInput,
  type ProofMirTerminalLowerer,
} from "./lowering-context";

export interface DraftRecordedProofMirExit {
  readonly exitKey: ProofMirCanonicalKey;
  readonly fromBlockKey: ProofMirCanonicalKey;
  readonly kind: "ordinaryReturn" | "terminalReturn" | "panic";
  readonly boundary: ProofMirExitBoundary;
  readonly crossedScopes: readonly ProofMirCanonicalKey[];
  readonly closure: ProofMirExitClosurePolicy;
  readonly originKey: ProofMirCanonicalKey;
}

export interface ProofMirExitRecorder {
  readonly entries: readonly DraftRecordedProofMirExit[];
  record(entry: DraftRecordedProofMirExit): void;
}

export interface CreateProofMirTerminalLowererInput {
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder?: ProofMirExitRecorder;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function createExitRecorder(): ProofMirExitRecorder {
  const entries: DraftRecordedProofMirExit[] = [];
  return {
    get entries() {
      return entries.slice();
    },
    record(entry) {
      entries.push(entry);
    },
  };
}

function functionExitClosurePolicy(terminal: boolean): ProofMirExitClosurePolicy {
  return {
    kind: "functionExit",
    requireNoLiveLoans: true,
    requireNoOpenObligations: true,
    requireNoLiveSessionMembers: true,
    requireNoPendingValidationResults: true,
    terminalReachability: terminal ? "required" : "notRequired",
  };
}

function activeBlockKey(
  context: ProofMirLoweringContext,
  fallbackBlockKey: ProofMirCanonicalKey,
): ProofMirCanonicalKey {
  return context.blockTracking?.currentBlockRef.blockKey ?? fallbackBlockKey;
}

function lowerReturnImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder: ProofMirExitRecorder;
  readonly returnInput: ProofMirReturnLoweringInput;
}): ProofMirLoweringResult<void> {
  const originKey = input.context.graph.allocateSyntheticOrigin(
    input.returnInput.terminal ? "return:terminal" : "return:ordinary",
  );
  let returnValueKey: ProofMirCanonicalKey | undefined;
  let fromBlockKey = input.returnInput.blockKey;

  if (input.returnInput.expression !== undefined) {
    const lowered = input.expression.lowerExpression({
      context: input.context,
      expression: input.returnInput.expression,
      blockKey: input.returnInput.blockKey,
    });
    if (lowered.kind === "error") {
      return lowered;
    }
    returnValueKey = operandValueKey(lowered.value);
    fromBlockKey = activeBlockKey(input.context, input.returnInput.blockKey);
  }

  const exitBundle = input.context.graph.createReturnExit({
    fromBlock: fromBlockKey,
    origin: originKey,
    terminal: input.returnInput.terminal,
  });

  const setTerminatorResult = input.context.graph.setTerminator(fromBlockKey, {
    kind: "return",
    value: returnValueKey,
    edge: exitBundle.edge,
    exit: exitBundle.exit,
    origin: originKey,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }

  input.recorder.record({
    exitKey: exitBundle.exit,
    fromBlockKey,
    kind: input.returnInput.terminal ? "terminalReturn" : "ordinaryReturn",
    boundary: { kind: "function", unwind: "none" },
    crossedScopes: [],
    closure: functionExitClosurePolicy(input.returnInput.terminal),
    originKey,
  });

  return loweringOk(undefined);
}

function lowerPanicImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly panicInput: ProofMirPanicLoweringInput;
  readonly recorder: ProofMirExitRecorder;
}): ProofMirLoweringResult<void> {
  const originKey = input.context.graph.allocateSyntheticOrigin("panic");
  const fromBlockKey = activeBlockKey(input.context, input.panicInput.blockKey);
  const exitBundle = input.context.graph.createPanicExit({
    fromBlock: fromBlockKey,
    origin: originKey,
  });

  const setTerminatorResult = input.context.graph.setTerminator(fromBlockKey, {
    kind: "panic",
    reason: undefined,
    edge: exitBundle.edge,
    exit: exitBundle.exit,
    origin: originKey,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }

  input.recorder.record({
    exitKey: exitBundle.exit,
    fromBlockKey,
    kind: "panic",
    boundary: { kind: "function", unwind: "none" },
    crossedScopes: [],
    closure: functionExitClosurePolicy(false),
    originKey,
  });

  return loweringOk(undefined);
}

function lowerReachableMonoErrorImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly errorInput: ProofMirReachableMonoErrorLoweringInput;
}): ProofMirLoweringResult<void> {
  const stableDetail =
    input.errorInput.reason === undefined || input.errorInput.reason.length === 0
      ? "mono-error-statement"
      : `mono-error-statement:${input.errorInput.reason}`;
  const diagnosticInput = {
    severity: "error" as const,
    code: "PROOF_MIR_REACHABLE_MONO_ERROR" as const,
    message: "Reachable mono error statement cannot be lowered to Proof MIR.",
    ownerKey: `function:${input.context.functionInstanceId}`,
    rootCauseKey: "mono-error-statement",
    stableDetail,
    sourceOrigin: undefined,
  };
  const diagnostic = proofMirDiagnostic(diagnosticInput);
  reportProofMirLoweringDiagnostic(input.context, diagnosticInput);
  input.context.buildContext.markFunctionFailed(input.context.functionInstanceId);
  return { kind: "error", diagnostics: [diagnostic] };
}

export function createProofMirTerminalLowerer(
  input: CreateProofMirTerminalLowererInput,
): ProofMirTerminalLowerer {
  const recorder = input.recorder ?? createExitRecorder();
  return {
    lowerReturn(returnInput) {
      return lowerReturnImpl({
        context: returnInput.context,
        expression: input.expression,
        recorder,
        returnInput,
      });
    },
    lowerPanic(panicInput) {
      return lowerPanicImpl({ context: panicInput.context, panicInput, recorder });
    },
    lowerReachableMonoError(errorInput) {
      return lowerReachableMonoErrorImpl({ context: errorInput.context, errorInput });
    },
  };
}
