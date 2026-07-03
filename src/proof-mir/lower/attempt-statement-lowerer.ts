import type {
  MonoExpression,
  MonoFunctionInstance,
  MonoLocal,
  MonoStatement,
} from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import { proofMirSsaLocalKey } from "../domains/graph-ssa";
import { draftLocalKey } from "../draft/draft-keys";
import { syncLoweredPlaceToFunctionDraft } from "./lowering-place-sync";
import { operandValueKey, type ProofMirDraftOperand } from "./lowering-operands";
import type {
  ProofMirAttemptValueLoweringInput,
  ProofMirLoweringContext,
  ProofMirLoweringRegistry,
  ProofMirLoweringResult,
} from "./lowering-context";
import { monoLocalPlace } from "./mono-place-builders";

type AttemptExpression = MonoExpression & { readonly kind: { readonly kind: "attempt" } };

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function localStorageKind(
  context: ProofMirLoweringContext,
  local: MonoLocal,
): "scalarSsa" | "placeBacked" | undefined {
  return context.localClassifier.storageForLocal(local.localId);
}

function lowerFunctionLocalPlace(input: {
  readonly context: ProofMirLoweringContext;
  readonly functionInstance: MonoFunctionInstance;
  readonly local: MonoLocal;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  const monoPlace = monoLocalPlace({
    functionInstance: input.functionInstance,
    local: input.local,
  });
  const lowered = input.context.functionScopePlaceLowerer.lowerMonoPlace({
    monoPlace,
    originKey: input.originKey,
  });
  if (lowered.kind !== "ok") {
    return lowered;
  }
  return loweringOk(
    syncLoweredPlaceToFunctionDraft({
      context: input.context,
      lowered: lowered.value,
      monoPlace,
    }),
  );
}

function registerFunctionLocal(input: {
  readonly context: ProofMirLoweringContext;
  readonly functionInstance: MonoFunctionInstance;
  readonly local: MonoLocal;
  readonly originKey: ProofMirCanonicalKey;
  readonly storage: "scalarSsa" | "placeBacked";
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  const localKey = draftLocalKey({
    functionInstanceId: input.functionInstance.instanceId,
    monoLocalId: input.local.localId,
  });
  let backingPlaceKey: ProofMirCanonicalKey | undefined;
  if (input.storage === "placeBacked") {
    const loweredPlace = lowerFunctionLocalPlace({
      context: input.context,
      functionInstance: input.functionInstance,
      local: input.local,
      originKey: input.originKey,
    });
    if (loweredPlace.kind === "error") {
      return loweredPlace;
    }
    backingPlaceKey = loweredPlace.value;
  }
  input.context.graph.createLocal({
    monoLocalId: input.local.localId,
    name: input.local.name,
    origin: input.originKey,
    type: input.local.type,
    resourceKind: input.local.resourceKind,
    storage: input.storage,
    ...(backingPlaceKey === undefined ? {} : { backingPlaceKey }),
  });
  return loweringOk(localKey);
}

function lowerAttemptValueForStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly registry: ProofMirLoweringRegistry;
  readonly expression: AttemptExpression;
  readonly blockKey: ProofMirCanonicalKey;
  readonly terminal: boolean;
}): ProofMirLoweringResult<{
  readonly blockKey: ProofMirCanonicalKey;
  readonly operand: ProofMirDraftOperand;
}> {
  return input.registry.attempt.lowerAttemptValue({
    context: input.context,
    attempt: input.expression.kind.attempt,
    blockKey: input.blockKey,
    resultType: input.expression.type,
    resultResourceKind: input.expression.resourceKind,
    terminal: input.terminal,
  } satisfies ProofMirAttemptValueLoweringInput);
}

export function lowerAttemptLetStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly registry: ProofMirLoweringRegistry;
  readonly statement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly functionInstance: MonoFunctionInstance;
  readonly local: MonoLocal;
  readonly value: AttemptExpression;
}): ProofMirLoweringResult<void> {
  const originKey = input.context.originMap.fromMonoStatement({
    owner: { kind: "function", functionInstanceId: input.context.functionInstanceId },
    sourceOrigin: input.statement.sourceOrigin as never,
    monoStatementId: input.statement.statementId,
  });
  const storage = localStorageKind(input.context, input.local);
  if (storage === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
        message: "Proof MIR attempt let lowering could not resolve local storage.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "attempt-let",
        stableDetail: `local:${input.local.name}`,
        sourceOrigin: input.statement.sourceOrigin,
      }),
    ]);
  }

  const localKey = registerFunctionLocal({
    context: input.context,
    functionInstance: input.functionInstance,
    local: input.local,
    originKey,
    storage,
  });
  if (localKey.kind === "error") {
    return localKey;
  }

  const loweredAttempt = lowerAttemptValueForStatement({
    context: input.context,
    registry: input.registry,
    expression: input.value,
    blockKey: input.blockKey,
    terminal: input.functionInstance.signature.modifiers.isTerminal,
  });
  if (loweredAttempt.kind === "error") {
    return loweredAttempt;
  }

  const valueKey = operandValueKey(loweredAttempt.value.operand);
  if (valueKey === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
        message: "Proof MIR attempt let requires a success value operand.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "attempt-let",
        stableDetail: `local:${input.local.name}`,
        sourceOrigin: input.statement.sourceOrigin,
      }),
    ]);
  }

  if (storage === "scalarSsa") {
    input.context.ssa.defineScalar({
      blockKey: loweredAttempt.value.blockKey,
      ssaKey: proofMirSsaLocalKey(localKey.value),
      valueKey,
    });
    return loweringOk(undefined);
  }

  const targetPlaceKey = lowerFunctionLocalPlace({
    context: input.context,
    functionInstance: input.functionInstance,
    local: input.local,
    originKey,
  });
  if (targetPlaceKey.kind === "error") {
    return targetPlaceKey;
  }
  const statementKey = input.context.graph.addStatement(loweredAttempt.value.blockKey, {
    origin: originKey,
  });
  input.context.graph.recordLoweredStatement(loweredAttempt.value.blockKey, {
    statementKey,
    originKey,
    kind: {
      kind: "store",
      placeKey: targetPlaceKey.value,
      valueKey,
    },
  });
  return loweringOk(undefined);
}

export function lowerAttemptReturnStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly registry: ProofMirLoweringRegistry;
  readonly expression: AttemptExpression;
  readonly blockKey: ProofMirCanonicalKey;
  readonly terminal: boolean;
  readonly sourceOrigin: string;
}): ProofMirLoweringResult<void> {
  const loweredAttempt = lowerAttemptValueForStatement({
    context: input.context,
    registry: input.registry,
    expression: input.expression,
    blockKey: input.blockKey,
    terminal: input.terminal,
  });
  if (loweredAttempt.kind === "error") {
    return loweredAttempt;
  }
  const valueKey = operandValueKey(loweredAttempt.value.operand);
  if (valueKey === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
        message: "Proof MIR attempt return requires a success value operand.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "attempt-return",
        stableDetail: "missing-success-value",
        sourceOrigin: input.sourceOrigin,
      }),
    ]);
  }
  const originKey = input.context.graph.allocateSyntheticOrigin(
    input.terminal ? "return:terminal" : "return:ordinary",
  );
  const exitBundle = input.context.graph.createReturnExit({
    fromBlock: loweredAttempt.value.blockKey,
    origin: originKey,
    terminal: input.terminal,
  });
  const setTerminatorResult = input.context.graph.setTerminator(loweredAttempt.value.blockKey, {
    kind: "return",
    value: valueKey,
    edge: exitBundle.edge,
    exit: exitBundle.exit,
    origin: originKey,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }
  return loweringOk(undefined);
}
