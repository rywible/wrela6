import { hirStatementId } from "../../hir/ids";
import { instantiatedHirId, type MonoInstanceId } from "../../mono/ids";
import type { MonoAttempt, MonoExpression, MonoStatementId } from "../../mono/mono-hir";
import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import type {
  DraftProofMirAttemptAlternative,
  DraftProofMirAttemptOperand,
  DraftProofMirAttemptStart,
  DraftProofMirGraphStatementSnapshot,
  DraftProofMirStatementKind,
} from "../draft/draft-statement";
import {
  proofMirPlaceId,
  proofMirValueId,
  type ProofMirPlaceId,
  type ProofMirValueId,
} from "../ids";
import { operandPlaceKey, operandValueKey, type ProofMirDraftOperand } from "./lowering-operands";
import { setEmptyArmUnreachableTerminator } from "./empty-arm-terminator";
import {
  type ProofMirAttemptLowerer,
  type ProofMirAttemptLoweringInput,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
} from "./lowering-context";

export interface DraftRecordedProofMirAttemptStatement {
  readonly statementKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly kind: DraftProofMirStatementKind;
}

export interface ProofMirAttemptRecorder {
  readonly entries: readonly DraftRecordedProofMirAttemptStatement[];
  record(entry: DraftRecordedProofMirAttemptStatement): void;
}

export interface CreateProofMirAttemptLowererInput {
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder?: ProofMirAttemptRecorder;
}

interface ProofMirAttemptIdAllocator {
  valueForKey(key: ProofMirCanonicalKey): ProofMirValueId;
  placeForKey(key: ProofMirCanonicalKey): ProofMirPlaceId;
  nextMonoStatementId(functionInstanceId: MonoInstanceId): MonoStatementId;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function createAttemptRecorder(): ProofMirAttemptRecorder {
  const entries: DraftRecordedProofMirAttemptStatement[] = [];
  return {
    get entries() {
      return entries.slice();
    },
    record(entry) {
      entries.push(entry);
    },
  };
}

function createAttemptIdAllocator(): ProofMirAttemptIdAllocator {
  let nextPlace = 0;
  let nextValue = 0;
  let nextMonoStatement = 1;
  const placeKeys = new Map<ProofMirCanonicalKey, ProofMirPlaceId>();
  const valueKeys = new Map<ProofMirCanonicalKey, ProofMirValueId>();

  return {
    valueForKey(key) {
      const existing = valueKeys.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id = proofMirValueId(nextValue++);
      valueKeys.set(key, id);
      return id;
    },
    placeForKey(key) {
      const existing = placeKeys.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id = proofMirPlaceId(nextPlace++);
      placeKeys.set(key, id);
      return id;
    },
    nextMonoStatementId(functionInstanceId) {
      return instantiatedHirId(functionInstanceId, hirStatementId(nextMonoStatement++));
    },
  };
}

function invalidAttemptOperandDiagnostic(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly attempt: MonoAttempt;
  readonly stableDetail: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_INVALID_ATTEMPT_OPERAND",
    message:
      "Proof MIR attempt lowering could not tie a fallible expression operand to the attempt result.",
    functionInstanceId: input.functionInstanceId,
    ownerKey: `function:${String(input.functionInstanceId)}`,
    rootCauseKey: "attempt-operand",
    stableDetail: input.stableDetail,
    sourceOrigin: input.attempt.sourceOrigin,
  });
}

function originForAttempt(
  context: ProofMirLoweringContext,
  attempt: MonoAttempt,
): ProofMirCanonicalKey {
  return context.originMap.fromMonoProof({
    owner: { kind: "function", functionInstanceId: context.functionInstanceId },
    sourceOrigin: attempt.sourceOrigin as never,
    monoProofId: attempt.attemptId,
  });
}

function originForExpression(
  context: ProofMirLoweringContext,
  expression: MonoExpression,
): ProofMirCanonicalKey {
  return context.originMap.fromMonoExpression({
    owner: { kind: "function", functionInstanceId: context.functionInstanceId },
    sourceOrigin: expression.sourceOrigin as never,
    monoExpressionId: expression.expressionId,
  });
}

function placeKeyForAttemptOperand(input: {
  readonly context: ProofMirLoweringContext;
  readonly operand: ProofMirDraftOperand;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey | undefined {
  const existingPlaceKey = operandPlaceKey(input.operand);
  if (existingPlaceKey !== undefined) {
    const isKnownPlace = input.context.effects
      .placeEntries()
      .some((place) => place.key === existingPlaceKey);
    if (!isKnownPlace) {
      return undefined;
    }
    return existingPlaceKey;
  }
  const valueKey = operandValueKey(input.operand);
  if (valueKey === undefined) {
    return undefined;
  }
  return input.context.effects.placeFromRuntimeTemporary({
    valueKey,
    originKey: input.originKey,
  });
}

function draftAttemptOperandFromLowering(input: {
  readonly context: ProofMirLoweringContext;
  readonly operand: ProofMirDraftOperand;
  readonly originKey: ProofMirCanonicalKey;
}): DraftProofMirAttemptOperand | undefined {
  const placeKey = placeKeyForAttemptOperand(input);
  if (placeKey === undefined) {
    return undefined;
  }
  return { kind: "observe", placeKey };
}

function draftAttemptAlternativeFromLowering(input: {
  readonly context: ProofMirLoweringContext;
  readonly operand: ProofMirDraftOperand;
  readonly originKey: ProofMirCanonicalKey;
}): DraftProofMirAttemptAlternative | undefined {
  const placeKey = placeKeyForAttemptOperand(input);
  if (placeKey === undefined) {
    return undefined;
  }
  return { kind: "value", placeKey };
}

function allocatePendingResultPlace(input: {
  readonly context: ProofMirLoweringContext;
  readonly attempt: MonoAttempt;
  readonly originKey: ProofMirCanonicalKey;
  readonly idAllocator: ProofMirAttemptIdAllocator;
}): ProofMirCanonicalKey {
  const placeKey = input.context.effects.placeFromTemporary({
    ordinal: Number(input.attempt.attemptId.hirId),
    originKey: input.originKey,
    type: { kind: "primitive", name: "AttemptResult" } as never,
    resourceKind: "Affine",
  });
  void input.idAllocator.placeForKey(placeKey);
  return placeKey;
}

function lowerDeclaredInputPlaces(input: {
  readonly context: ProofMirLoweringContext;
  readonly attempt: MonoAttempt;
  readonly originKey: ProofMirCanonicalKey;
  readonly idAllocator: ProofMirAttemptIdAllocator;
}): ProofMirLoweringResult<readonly ProofMirCanonicalKey[]> {
  const placeKeys: ProofMirCanonicalKey[] = [];
  for (const monoPlace of input.attempt.declaredInputPlaces) {
    const lowered = input.context.scopePlaceLowerer.lowerMonoPlace({
      context: input.context,
      monoPlace,
      originKey: input.originKey,
    });
    if (lowered.kind === "error") {
      return lowered;
    }
    placeKeys.push(lowered.value);
    input.idAllocator.placeForKey(lowered.value);
  }
  return loweringOk(placeKeys);
}

function consumePlaceEffects(
  placeKeys: readonly ProofMirCanonicalKey[],
): readonly { readonly kind: "consumePlace"; readonly placeKey: ProofMirCanonicalKey }[] {
  return placeKeys.map((placeKey) => ({
    kind: "consumePlace" as const,
    placeKey,
  }));
}

function lowerAttemptImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder: ProofMirAttemptRecorder;
  readonly attemptInput: ProofMirAttemptLoweringInput;
  readonly idAllocator: ProofMirAttemptIdAllocator;
}): ProofMirLoweringResult<void> {
  const attempt = input.attemptInput.attempt;
  const attemptOriginKey = originForAttempt(input.context, attempt);

  const loweredFallible = input.expression.lowerExpression({
    context: input.context,
    expression: attempt.fallibleExpression,
    blockKey: input.attemptInput.blockKey,
  });
  if (loweredFallible.kind === "error") {
    return loweredFallible;
  }

  const fallibleOriginKey = originForExpression(input.context, attempt.fallibleExpression);
  const fallible = draftAttemptOperandFromLowering({
    context: input.context,
    operand: loweredFallible.value,
    originKey: fallibleOriginKey,
  });
  if (fallible === undefined) {
    return loweringError([
      invalidAttemptOperandDiagnostic({
        functionInstanceId: input.context.functionInstanceId,
        attempt,
        stableDetail: "missing-fallible-operand",
      }),
    ]);
  }

  let alternative: DraftProofMirAttemptAlternative | undefined;
  if (attempt.alternativeExpression !== undefined) {
    const loweredAlternative = input.expression.lowerExpression({
      context: input.context,
      expression: attempt.alternativeExpression,
      blockKey: input.attemptInput.blockKey,
    });
    if (loweredAlternative.kind === "error") {
      return loweredAlternative;
    }
    const alternativeOriginKey = originForExpression(input.context, attempt.alternativeExpression);
    alternative = draftAttemptAlternativeFromLowering({
      context: input.context,
      operand: loweredAlternative.value,
      originKey: alternativeOriginKey,
    });
    if (alternative === undefined) {
      return loweringError([
        invalidAttemptOperandDiagnostic({
          functionInstanceId: input.context.functionInstanceId,
          attempt,
          stableDetail: "missing-alternative-operand",
        }),
      ]);
    }
  }

  const pendingResultPlaceKey = allocatePendingResultPlace({
    context: input.context,
    attempt,
    originKey: attemptOriginKey,
    idAllocator: input.idAllocator,
  });

  const inputPlacesResult = lowerDeclaredInputPlaces({
    context: input.context,
    attempt,
    originKey: attemptOriginKey,
    idAllocator: input.idAllocator,
  });
  if (inputPlacesResult.kind === "error") {
    return inputPlacesResult;
  }
  const inputPlaceKeys = inputPlacesResult.value;

  const draftAttempt: DraftProofMirAttemptStart = {
    attemptId: attempt.attemptId,
    fallible,
    ...(alternative === undefined ? {} : { alternative }),
    pendingResultPlaceKey,
    inputPlaceKeys,
    originKey: attemptOriginKey,
  };

  const statementKey = input.context.graph.addStatement(input.attemptInput.blockKey, {
    origin: attemptOriginKey,
  });
  const attemptSnapshot: DraftProofMirGraphStatementSnapshot = {
    statementKey,
    originKey: attemptOriginKey,
    kind: { kind: "attempt", attempt: draftAttempt },
  };
  input.recorder.record(attemptSnapshot);
  input.context.graph.recordLoweredStatement(input.attemptInput.blockKey, attemptSnapshot);

  const rootScope = input.context.graph.rootScopeKey();
  const currentBlock = input.context.graph.block(input.attemptInput.blockKey);
  const successOrigin = input.context.originMap.syntheticFrom(attemptOriginKey, "attempt.success");
  const errorOrigin = input.context.originMap.syntheticFrom(attemptOriginKey, "attempt.error");

  const successBlockKey = input.context.graph.createBlock({
    role: `attemptSuccess:${proofMetadataIdKey(attempt.attemptId)}`,
    scope: rootScope,
    origin: successOrigin,
    sourceOrigin: attempt.sourceOrigin,
  });
  const errorBlockKey = input.context.graph.createBlock({
    role: `attemptError:${proofMetadataIdKey(attempt.attemptId)}`,
    scope: rootScope,
    origin: errorOrigin,
    sourceOrigin: attempt.sourceOrigin,
  });

  const pendingConsume = [{ kind: "consumePlace" as const, placeKey: pendingResultPlaceKey }];
  const successEffects = [...pendingConsume, ...consumePlaceEffects(inputPlaceKeys)];
  const errorEffects = pendingConsume;

  const successEdgeKey = input.context.graph.createAttemptEdge({
    kind: "attemptSuccess",
    fromBlock: input.attemptInput.blockKey,
    toBlock: successBlockKey,
    sourceScope: currentBlock.scopeKey,
    targetScope: rootScope,
    origin: successOrigin,
    effects: successEffects,
  });
  const errorEdgeKey = input.context.graph.createAttemptEdge({
    kind: "attemptError",
    fromBlock: input.attemptInput.blockKey,
    toBlock: errorBlockKey,
    sourceScope: currentBlock.scopeKey,
    targetScope: rootScope,
    origin: errorOrigin,
    effects: errorEffects,
  });

  const finalizeSuccessArm = setEmptyArmUnreachableTerminator({
    context: input.context,
    blockKey: successBlockKey,
    origin: successOrigin,
  });
  if (finalizeSuccessArm.kind === "error") {
    return finalizeSuccessArm;
  }
  const finalizeErrorArm = setEmptyArmUnreachableTerminator({
    context: input.context,
    blockKey: errorBlockKey,
    origin: errorOrigin,
  });
  if (finalizeErrorArm.kind === "error") {
    return finalizeErrorArm;
  }

  const setTerminatorResult = input.context.graph.setTerminator(input.attemptInput.blockKey, {
    kind: "matchAttempt",
    match: {
      attemptId: attempt.attemptId,
      successTarget: { edge: successEdgeKey, block: successBlockKey },
      errorTarget: { edge: errorEdgeKey, block: errorBlockKey },
      inputPlaceKeys,
      origin: attemptOriginKey,
    },
    origin: attemptOriginKey,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }

  return loweringOk(undefined);
}

export function createProofMirAttemptLowerer(
  input: CreateProofMirAttemptLowererInput,
): ProofMirAttemptLowerer & {
  readonly recorder: ProofMirAttemptRecorder;
  readonly idAllocator: ProofMirAttemptIdAllocator;
} {
  const recorder = input.recorder ?? createAttemptRecorder();
  const idAllocator = createAttemptIdAllocator();
  return {
    recorder,
    idAllocator,
    lowerAttempt(attemptInput) {
      return lowerAttemptImpl({
        context: attemptInput.context,
        expression: input.expression,
        recorder,
        attemptInput,
        idAllocator,
      });
    },
  };
}
