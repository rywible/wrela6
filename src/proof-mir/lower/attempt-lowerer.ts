import { hirStatementId } from "../../hir/ids";
import { instantiatedHirId, type MonoInstanceId } from "../../mono/ids";
import type {
  MonoAttempt,
  MonoCheckedType,
  MonoExpression,
  MonoStatementId,
} from "../../mono/mono-hir";
import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import type { ConcreteResourceKind } from "../../semantic/surface/resource-kind";
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
  type ProofMirAttemptValueLoweringInput,
  type ProofMirAttemptValueLoweringOutput,
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

interface LoweredAttemptStart {
  readonly attemptOriginKey: ProofMirCanonicalKey;
  readonly pendingResultPlaceKey: ProofMirCanonicalKey;
  readonly inputPlaceKeys: readonly ProofMirCanonicalKey[];
  readonly alternativeOperand?: ProofMirDraftOperand;
}

interface InstalledAttemptSplit {
  readonly successBlockKey: ProofMirCanonicalKey;
  readonly errorBlockKey: ProofMirCanonicalKey;
  readonly successOriginKey: ProofMirCanonicalKey;
  readonly errorOriginKey: ProofMirCanonicalKey;
  readonly successValueKey?: ProofMirCanonicalKey;
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

function lowerAttemptStart(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder: ProofMirAttemptRecorder;
  readonly attempt: MonoAttempt;
  readonly blockKey: ProofMirCanonicalKey;
  readonly idAllocator: ProofMirAttemptIdAllocator;
}): ProofMirLoweringResult<LoweredAttemptStart> {
  const attempt = input.attempt;
  const attemptOriginKey = originForAttempt(input.context, attempt);

  const loweredFallible = input.expression.lowerExpression({
    context: input.context,
    expression: attempt.fallibleExpression,
    blockKey: input.blockKey,
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
  let alternativeOperand: ProofMirDraftOperand | undefined;
  if (attempt.alternativeExpression !== undefined) {
    const loweredAlternative = input.expression.lowerExpression({
      context: input.context,
      expression: attempt.alternativeExpression,
      blockKey: input.blockKey,
    });
    if (loweredAlternative.kind === "error") {
      return loweredAlternative;
    }
    alternativeOperand = loweredAlternative.value;
    const alternativeOriginKey = originForExpression(input.context, attempt.alternativeExpression);
    alternative = draftAttemptAlternativeFromLowering({
      context: input.context,
      operand: alternativeOperand,
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
    input.idAllocator.placeForKey(alternative.placeKey);
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

  const statementKey = input.context.graph.addStatement(input.blockKey, {
    origin: attemptOriginKey,
  });
  const attemptSnapshot: DraftProofMirGraphStatementSnapshot = {
    statementKey,
    originKey: attemptOriginKey,
    kind: { kind: "attempt", attempt: draftAttempt },
  };
  input.recorder.record(attemptSnapshot);
  input.context.graph.recordLoweredStatement(input.blockKey, attemptSnapshot);

  return loweringOk({
    attemptOriginKey,
    pendingResultPlaceKey,
    inputPlaceKeys,
    ...(alternativeOperand === undefined ? {} : { alternativeOperand }),
  });
}

function installAttemptSplit(input: {
  readonly context: ProofMirLoweringContext;
  readonly attempt: MonoAttempt;
  readonly blockKey: ProofMirCanonicalKey;
  readonly attemptOriginKey: ProofMirCanonicalKey;
  readonly pendingResultPlaceKey: ProofMirCanonicalKey;
  readonly inputPlaceKeys: readonly ProofMirCanonicalKey[];
  readonly successResult?: {
    readonly type: MonoCheckedType;
    readonly resourceKind: ConcreteResourceKind;
  };
}): ProofMirLoweringResult<InstalledAttemptSplit> {
  const currentBlock = input.context.graph.block(input.blockKey);
  const splitScopeKey = currentBlock.scopeKey;
  const successOrigin = input.context.originMap.syntheticFrom(
    input.attemptOriginKey,
    "attempt.success",
  );
  const errorOrigin = input.context.originMap.syntheticFrom(
    input.attemptOriginKey,
    "attempt.error",
  );

  const successBlockKey = input.context.graph.createBlock({
    role: `attemptSuccess:${proofMetadataIdKey(input.attempt.attemptId)}`,
    scope: splitScopeKey,
    origin: successOrigin,
    sourceOrigin: input.attempt.sourceOrigin,
  });
  const errorBlockKey = input.context.graph.createBlock({
    role: `attemptError:${proofMetadataIdKey(input.attempt.attemptId)}`,
    scope: splitScopeKey,
    origin: errorOrigin,
    sourceOrigin: input.attempt.sourceOrigin,
  });
  input.context.ssa.registerBlock(successBlockKey);
  input.context.ssa.registerBlock(errorBlockKey);

  const pendingConsume = [{ kind: "consumePlace" as const, placeKey: input.pendingResultPlaceKey }];
  const successEffects = [...pendingConsume, ...consumePlaceEffects(input.inputPlaceKeys)];
  const errorEffects = pendingConsume;
  const successValueKey =
    input.successResult === undefined
      ? undefined
      : createAttemptSuccessValue({
          context: input.context,
          attempt: input.attempt,
          originKey: successOrigin,
          resultType: input.successResult.type,
          resultResourceKind: input.successResult.resourceKind,
        });

  const successEdgeKey = input.context.graph.createAttemptEdge({
    kind: "attemptSuccess",
    role: `attemptSuccess:${proofMetadataIdKey(input.attempt.attemptId)}`,
    fromBlock: input.blockKey,
    toBlock: successBlockKey,
    sourceScope: currentBlock.scopeKey,
    targetScope: splitScopeKey,
    origin: successOrigin,
    effects: successEffects,
    ...(successValueKey === undefined ? {} : { argumentKeys: [successValueKey] }),
  });
  const errorEdgeKey = input.context.graph.createAttemptEdge({
    kind: "attemptError",
    role: `attemptError:${proofMetadataIdKey(input.attempt.attemptId)}`,
    fromBlock: input.blockKey,
    toBlock: errorBlockKey,
    sourceScope: currentBlock.scopeKey,
    targetScope: splitScopeKey,
    origin: errorOrigin,
    effects: errorEffects,
  });

  input.context.ssa.registerPredecessorEdge({
    blockKey: successBlockKey,
    edgeKey: successEdgeKey,
    fromBlockKey: input.blockKey,
    argumentKeysBySsaKey: {},
  });
  input.context.ssa.registerPredecessorEdge({
    blockKey: errorBlockKey,
    edgeKey: errorEdgeKey,
    fromBlockKey: input.blockKey,
    argumentKeysBySsaKey: {},
  });
  input.context.ssa.sealBlock(successBlockKey);
  input.context.ssa.sealBlock(errorBlockKey);

  const setTerminatorResult = input.context.graph.setTerminator(input.blockKey, {
    kind: "matchAttempt",
    match: {
      attemptId: input.attempt.attemptId,
      successTarget: { edge: successEdgeKey, block: successBlockKey },
      errorTarget: { edge: errorEdgeKey, block: errorBlockKey },
      inputPlaceKeys: input.inputPlaceKeys,
      origin: input.attemptOriginKey,
    },
    origin: input.attemptOriginKey,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }

  return loweringOk({
    successBlockKey,
    errorBlockKey,
    successOriginKey: successOrigin,
    errorOriginKey: errorOrigin,
    ...(successValueKey === undefined ? {} : { successValueKey }),
  });
}

function lowerAttemptImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder: ProofMirAttemptRecorder;
  readonly attemptInput: ProofMirAttemptLoweringInput;
  readonly idAllocator: ProofMirAttemptIdAllocator;
}): ProofMirLoweringResult<void> {
  const attempt = input.attemptInput.attempt;
  const start = lowerAttemptStart({
    context: input.context,
    expression: input.expression,
    recorder: input.recorder,
    attempt,
    blockKey: input.attemptInput.blockKey,
    idAllocator: input.idAllocator,
  });
  if (start.kind === "error") {
    return start;
  }

  const split = installAttemptSplit({
    context: input.context,
    attempt,
    blockKey: input.attemptInput.blockKey,
    attemptOriginKey: start.value.attemptOriginKey,
    pendingResultPlaceKey: start.value.pendingResultPlaceKey,
    inputPlaceKeys: start.value.inputPlaceKeys,
  });
  if (split.kind === "error") {
    return split;
  }

  const finalizeSuccessArm = setEmptyArmUnreachableTerminator({
    context: input.context,
    blockKey: split.value.successBlockKey,
    origin: split.value.successOriginKey,
  });
  if (finalizeSuccessArm.kind === "error") {
    return finalizeSuccessArm;
  }
  const finalizeErrorArm = setEmptyArmUnreachableTerminator({
    context: input.context,
    blockKey: split.value.errorBlockKey,
    origin: split.value.errorOriginKey,
  });
  if (finalizeErrorArm.kind === "error") {
    return finalizeErrorArm;
  }

  return loweringOk(undefined);
}

function setAttemptErrorReturnTerminator(input: {
  readonly context: ProofMirLoweringContext;
  readonly errorBlockKey: ProofMirCanonicalKey;
  readonly errorOriginKey: ProofMirCanonicalKey;
  readonly alternativeOperand?: ProofMirDraftOperand;
  readonly terminal: boolean;
}): ProofMirLoweringResult<void> {
  const returnValueKey =
    input.alternativeOperand === undefined ? undefined : operandValueKey(input.alternativeOperand);
  const exitBundle = input.context.graph.createReturnExit({
    fromBlock: input.errorBlockKey,
    origin: input.errorOriginKey,
    terminal: input.terminal,
  });
  const setTerminatorResult = input.context.graph.setTerminator(input.errorBlockKey, {
    kind: "return",
    ...(returnValueKey === undefined ? {} : { value: returnValueKey }),
    edge: exitBundle.edge,
    exit: exitBundle.exit,
    origin: input.errorOriginKey,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }

  return loweringOk(undefined);
}

function createAttemptSuccessValue(input: {
  readonly context: ProofMirLoweringContext;
  readonly attempt: MonoAttempt;
  readonly originKey: ProofMirCanonicalKey;
  readonly resultType: MonoCheckedType;
  readonly resultResourceKind: ConcreteResourceKind;
}): ProofMirCanonicalKey {
  return input.context.graph.createValue({
    role: `attempt.result:${proofMetadataIdKey(input.attempt.attemptId)}`,
    origin: input.originKey,
    type: input.resultType,
    resourceKind: input.resultResourceKind,
  });
}

function lowerAttemptValueImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder: ProofMirAttemptRecorder;
  readonly attemptInput: ProofMirAttemptValueLoweringInput;
  readonly idAllocator: ProofMirAttemptIdAllocator;
}): ProofMirLoweringResult<ProofMirAttemptValueLoweringOutput> {
  const attempt = input.attemptInput.attempt;
  const start = lowerAttemptStart({
    context: input.context,
    expression: input.expression,
    recorder: input.recorder,
    attempt,
    blockKey: input.attemptInput.blockKey,
    idAllocator: input.idAllocator,
  });
  if (start.kind === "error") {
    return start;
  }

  const split = installAttemptSplit({
    context: input.context,
    attempt,
    blockKey: input.attemptInput.blockKey,
    attemptOriginKey: start.value.attemptOriginKey,
    pendingResultPlaceKey: start.value.pendingResultPlaceKey,
    inputPlaceKeys: start.value.inputPlaceKeys,
    successResult: {
      type: input.attemptInput.resultType,
      resourceKind: input.attemptInput.resultResourceKind,
    },
  });
  if (split.kind === "error") {
    return split;
  }

  const errorReturn = setAttemptErrorReturnTerminator({
    context: input.context,
    errorBlockKey: split.value.errorBlockKey,
    errorOriginKey: split.value.errorOriginKey,
    alternativeOperand: start.value.alternativeOperand,
    terminal: input.attemptInput.terminal,
  });
  if (errorReturn.kind === "error") {
    return errorReturn;
  }

  const successValueKey = split.value.successValueKey;
  if (successValueKey === undefined) {
    return loweringError([
      invalidAttemptOperandDiagnostic({
        functionInstanceId: input.context.functionInstanceId,
        attempt,
        stableDetail: "missing-success-value",
      }),
    ]);
  }

  if (input.context.blockTracking !== undefined) {
    input.context.blockTracking.currentBlockRef.blockKey = split.value.successBlockKey;
    input.context.blockTracking.continuationBlockRef.blockKey = undefined;
  }

  return loweringOk({
    blockKey: split.value.successBlockKey,
    operand: { kind: "value", value: successValueKey },
  });
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
    lowerAttemptValue(attemptInput) {
      return lowerAttemptValueImpl({
        context: attemptInput.context,
        expression: input.expression,
        recorder,
        attemptInput,
        idAllocator,
      });
    },
  };
}
