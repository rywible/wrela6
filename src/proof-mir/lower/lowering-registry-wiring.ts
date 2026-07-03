import type { ProofMirCallLoweringRecorder } from "./call-lowerer";
import { createCallLoweringRecorder, createProofMirCallLowerer } from "./call-lowerer";
import { createProofMirAttemptLowerer } from "./attempt-lowerer";
import { createProofMirExtensionLowerer } from "./extension-lowerer";
import { createProofMirExpressionLowerer } from "./expression-lowerer";
import {
  createProofMirControlFlowLowerer,
  type CreateProofMirControlFlowLowererInput,
} from "./if-lowerer";
import { createProofMirIteratorLowerer } from "./iterator-lowerer";
import {
  createProofMirLoweringRegistry,
  type ProofMirControlFlowLowerer,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringRegistry,
} from "./lowering-context";
import { extendProofMirControlFlowLowererWithLoops, type ActiveLoopFrame } from "./loop-lowerer";
import { withLoopIfStatementLowering } from "./loop-if-statement-lowering";
import { createProofMirMatchLowerer } from "./match-lowerer";
import { createProofMirStatementLowerer } from "./statement-lowerer";
import { createProofMirTakeLowerer } from "./take-lowerer";
import { createProofMirTerminalLowerer } from "./terminal-lowerer";
import { createProofMirValidatedBufferReadLowerer } from "./validated-buffer-read-lowerer";
import { createProofMirValidationLowerer } from "./validation-lowerer";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { proofMirDiagnostic, type ProofMirDiagnostic } from "../diagnostics";

export type ResolvedLoweringRegistryResult =
  | {
      readonly kind: "ok";
      readonly registry: ProofMirLoweringRegistry;
      readonly callRecorder: ProofMirCallLoweringRecorder;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofMirDiagnostic[] };

export function createBranchingControlFlowLowerer(
  input: CreateProofMirControlFlowLowererInput,
): ProofMirControlFlowLowerer {
  const ifLowerer = createProofMirControlFlowLowerer(input);
  const matchLowerer = createProofMirMatchLowerer(input);

  return {
    lowerControlFlowStatement(loweringInput) {
      switch (loweringInput.statement.kind.kind) {
        case "if":
          return ifLowerer.lowerControlFlowStatement(loweringInput);
        case "match":
          return matchLowerer.lowerControlFlowStatement(loweringInput);
        default:
          return {
            kind: "error",
            diagnostics: [
              proofMirDiagnostic({
                severity: "error",
                code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
                message: "Control-flow lowerer does not handle this mono statement kind.",
                ownerKey: `function:${loweringInput.context.functionInstanceId}`,
                rootCauseKey: "mono-statement",
                stableDetail: `statement:${String(loweringInput.statement.statementId)}`,
                sourceOrigin: loweringInput.statement.sourceOrigin,
              }),
            ],
          };
      }
    },
  };
}

export function createWiredProofMirLoweringRegistry(input?: {
  readonly callRecorder?: ProofMirCallLoweringRecorder;
}): ResolvedLoweringRegistryResult {
  const currentBlockRef: { blockKey?: ProofMirCanonicalKey } = {};
  const continuationBlockRef: { blockKey?: ProofMirCanonicalKey } = {};
  const validatedBufferReadLowerer = createProofMirValidatedBufferReadLowerer();
  const callRecorder = input?.callRecorder ?? createCallLoweringRecorder();
  const wiredExpressionLowererRef: {
    current?: ReturnType<typeof createProofMirExpressionLowerer>;
  } = {};
  const expressionDelegate: ProofMirExpressionLowerer = {
    lowerExpression(loweringInput) {
      return wiredExpressionLowererRef.current!.lowerExpression(loweringInput);
    },
    lowerExpressionAsPlace(loweringInput) {
      return wiredExpressionLowererRef.current!.lowerExpressionAsPlace(loweringInput);
    },
  };
  const callLowerer = createProofMirCallLowerer({
    expression: expressionDelegate,
    recorder: callRecorder,
    valueIdForKey: (key) => wiredExpressionLowererRef.current!.valueIdForKey(key),
    placeIdForKey: (key) => wiredExpressionLowererRef.current!.placeIdForKey(key),
  });
  const wiredExpressionLowerer = createProofMirExpressionLowerer({
    validatedBufferRead: validatedBufferReadLowerer,
    call: callLowerer,
  });
  wiredExpressionLowererRef.current = wiredExpressionLowerer;
  const statementLowerer = createProofMirStatementLowerer({
    expression: wiredExpressionLowerer,
    call: callLowerer,
  });
  const terminalLowerer = createProofMirTerminalLowerer({ expression: wiredExpressionLowerer });
  const activeLoopRef: { frame?: ActiveLoopFrame } = {};

  const controlFlowInput: CreateProofMirControlFlowLowererInput = {
    expression: wiredExpressionLowerer,
    statement: statementLowerer,
    terminal: terminalLowerer,
    currentBlockRef,
    continuationBlockRef,
  };

  const loopShared = withLoopIfStatementLowering({
    scopeRoleByKey: new Map<string, string>(),
    expression: wiredExpressionLowerer,
    statementLowerer,
    terminalLowerer,
    activeLoopRef,
  });

  const controlFlow = extendProofMirControlFlowLowererWithLoops({
    inner: createBranchingControlFlowLowerer(controlFlowInput),
    shared: loopShared,
    loopCarriedLocalsByStatementId: new Map(),
    placeBackedLocals: [],
    continuationBlockRef,
    currentBlockRef,
  });

  const registryResult = createProofMirLoweringRegistry({
    expression: wiredExpressionLowerer,
    statement: statementLowerer,
    controlFlow,
    call: callLowerer,
    validation: createProofMirValidationLowerer({
      statement: statementLowerer,
      terminal: terminalLowerer,
      controlFlow,
    }),
    attempt: createProofMirAttemptLowerer({ expression: wiredExpressionLowerer }),
    take: createProofMirTakeLowerer({
      expression: wiredExpressionLowerer,
      call: callLowerer,
      statement: statementLowerer,
    }),
    terminal: terminalLowerer,
    validatedBufferRead: validatedBufferReadLowerer,
    iterator: createProofMirIteratorLowerer({
      expression: wiredExpressionLowerer,
      call: callLowerer,
      statement: statementLowerer,
      terminal: terminalLowerer,
      callRecorder,
    }),
    extension: createProofMirExtensionLowerer(),
    blockTracking: {
      currentBlockRef,
      continuationBlockRef,
    },
  });
  if (registryResult.kind === "error") {
    return registryResult;
  }
  return { kind: "ok", registry: registryResult.registry, callRecorder };
}
