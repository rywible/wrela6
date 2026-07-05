import type { ObligationId } from "../../hir/ids";
import type {
  MonoInstantiatedProofId,
  MonoLocal,
  MonoObligation,
  MonoStatement,
  MonoTakeKind,
  MonoTakeOperand,
  MonoTakeStatement,
  MonomorphizedHirProgram,
} from "../../mono/mono-hir";
import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import type { DraftProofMirEdgeEffect } from "../domains/effects-resources";
import type {
  DraftProofMirSessionMemberReference,
  DraftProofMirTakeOperand,
  DraftProofMirTakeStart,
} from "../draft/draft-statement";
import { wireGotoEdge } from "./loop-scaffold";
import { operandPlaceKey, operandValueKey, type ProofMirDraftOperand } from "./lowering-operands";
import { monoPlaceForStatementLocal } from "./expression-lowerer-helpers";
import { syncLoweredPlaceToFunctionDraft } from "./lowering-place-sync";
import {
  type ProofMirCallLowerer,
  type ProofMirControlFlowLowerer,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTakeLowerer,
  type ProofMirTerminalLowerer,
  type ProofMirValidationLowerer,
} from "./lowering-context";
import { createTakeBodyRecorder, type ProofMirTakeBodyRecorder } from "./take-body-recorder";
import { lowerProofMirTakeBodyStatements } from "./take-body-statement-lowering";
import { draftObligationReference, draftSessionMemberReference } from "./take-reference-builders";

export {
  createTakeBodyRecorder,
  type DraftRecordedProofMirTakeExit,
  type DraftRecordedProofMirTakeStatement,
  type ProofMirTakeBodyRecorder,
} from "./take-body-recorder";

export interface CreateProofMirTakeLowererInput {
  readonly expression: ProofMirExpressionLowerer;
  readonly call?: ProofMirCallLowerer;
  readonly statement?: ProofMirStatementLowerer;
  readonly controlFlow?: ProofMirControlFlowLowerer;
  readonly terminal?: ProofMirTerminalLowerer;
  readonly validation?: ProofMirValidationLowerer;
  readonly recorder?: ProofMirTakeBodyRecorder;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function originForTake(input: {
  readonly context: ProofMirLoweringContext;
  readonly takeStatement: MonoTakeStatement;
  readonly monoStatement?: MonoStatement;
}): ProofMirCanonicalKey {
  if (input.monoStatement !== undefined) {
    return input.context.originMap.fromMonoStatement({
      owner: { kind: "function", functionInstanceId: input.context.functionInstanceId },
      sourceOrigin: input.monoStatement.sourceOrigin,
      monoStatementId: input.monoStatement.statementId,
    });
  }
  return input.context.originMap.fromHirOrigin({
    owner: { kind: "function", functionInstanceId: input.context.functionInstanceId },
    sourceOrigin: input.takeStatement.sourceOrigin,
  });
}

function closureObligationIdForTakeKind(
  takeKind: MonoTakeKind,
): MonoInstantiatedProofId<ObligationId> | undefined {
  switch (takeKind.kind) {
    case "stream":
    case "validatedBuffer":
      return takeKind.closureObligationId;
    case "buffer":
      return takeKind.obligationId;
    case "error":
      return undefined;
    default: {
      const unreachable: never = takeKind;
      return unreachable;
    }
  }
}

function lookupMonoObligation(
  program: MonomorphizedHirProgram,
  obligationIdValue: MonoInstantiatedProofId<ObligationId>,
): MonoObligation | undefined {
  return program.proofMetadata.obligations.get(obligationIdValue);
}

function shouldDischargeAtTakeExit(obligation: MonoObligation): boolean {
  switch (obligation.kind) {
    case "streamClosure":
    case "bufferDischarge":
    case "validatedBufferClosure":
      return true;
    case "takeClosure":
    case "terminalClosure":
    case "callRequirement":
    case "error":
      return false;
    default: {
      const unreachable: never = obligation.kind;
      return unreachable;
    }
  }
}

function shouldCloseSessionAtTakeExit(obligation: MonoObligation): boolean {
  switch (obligation.kind) {
    case "streamClosure":
    case "validatedBufferClosure":
      return true;
    case "bufferDischarge":
    case "takeClosure":
    case "terminalClosure":
    case "callRequirement":
    case "error":
      return false;
    default: {
      const unreachable: never = obligation.kind;
      return unreachable;
    }
  }
}

function lowerTakeOperand(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly call?: ProofMirCallLowerer;
  readonly operand: MonoTakeOperand;
  readonly blockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  switch (input.operand.kind) {
    case "place":
      return input.expression.lowerExpressionAsPlace({
        context: input.context,
        expression: input.operand.expression,
        blockKey: input.blockKey,
      });
    case "takeOnlyCall": {
      if (input.call === undefined) {
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_MISSING_LOWERER",
            message: "Missing call lowerer callback.",
            functionInstanceId: input.context.functionInstanceId,
            ownerKey: `function:${String(input.context.functionInstanceId)}`,
            rootCauseKey: "missing-call-lowerer",
            stableDetail: "take:takeOnlyCall",
          }),
        ]);
      }
      const lowered = input.call.lowerCall({
        context: input.context,
        call: input.operand.call,
        monoExpressionId: input.operand.callExpressionId,
        blockKey: input.blockKey,
        resultType: input.operand.resultType,
        resultResourceKind: input.operand.resultResourceKind,
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      if (operandPlaceKey(lowered.value) !== undefined) {
        return lowered;
      }
      const valueKey = operandValueKey(lowered.value);
      if (valueKey === undefined) {
        return lowered;
      }
      return loweringOk({
        kind: "valueAndPlace" as const,
        value: valueKey,
        place: input.context.effects.placeFromRuntimeTemporary({
          valueKey,
          originKey: input.originKey,
        }),
      });
    }
    case "error":
      return loweringError([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
          message: "Proof MIR take lowering does not handle an error operand.",
          functionInstanceId: input.context.functionInstanceId,
          ownerKey: `function:${String(input.context.functionInstanceId)}`,
          rootCauseKey: "take-operand",
          stableDetail: "error",
        }),
      ]);
    default: {
      const unreachable: never = input.operand;
      return unreachable;
    }
  }
}

function draftTakeOperandForStart(input: {
  readonly operand: ProofMirDraftOperand;
  readonly originKey: ProofMirCanonicalKey;
}): DraftProofMirTakeOperand | undefined {
  const placeKey = operandPlaceKey(input.operand);
  if (placeKey === undefined) {
    return undefined;
  }
  return { kind: "observe", placeKey, originKey: input.originKey };
}

function lowerTakeAliasPlace(input: {
  readonly context: ProofMirLoweringContext;
  readonly aliasLocal: MonoLocal;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  const monoPlace = monoPlaceForStatementLocal(input.context, input.aliasLocal);
  const lowered = input.context.functionScopePlaceLowerer.lowerMonoPlace({
    monoPlace,
    originKey: input.originKey,
  });
  if (lowered.kind === "error") {
    return lowered;
  }
  const placeKey = input.context.effects.placeFromMono({
    monoPlace,
    originKey: input.originKey,
  });
  syncLoweredPlaceToFunctionDraft({
    context: input.context,
    lowered: lowered.value,
    monoPlace,
  });
  return loweringOk(placeKey);
}

function lowerTakeImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly call?: ProofMirCallLowerer;
  readonly statement?: ProofMirStatementLowerer;
  readonly controlFlow?: ProofMirControlFlowLowerer;
  readonly terminal?: ProofMirTerminalLowerer;
  readonly validation?: ProofMirValidationLowerer;
  readonly recorder: ProofMirTakeBodyRecorder;
  readonly monoStatement?: MonoStatement;
  readonly takeStatement: MonoTakeStatement;
  readonly blockKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<void> {
  const originKey = originForTake({
    context: input.context,
    takeStatement: input.takeStatement,
    ...(input.monoStatement === undefined ? {} : { monoStatement: input.monoStatement }),
  });

  if (input.takeStatement.takeKind.kind === "error") {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
        message: "Proof MIR take lowering does not handle an error take kind.",
        functionInstanceId: input.context.functionInstanceId,
        sourceOrigin: input.takeStatement.sourceOrigin,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "take-kind",
        stableDetail: "error",
      }),
    ]);
  }

  const loweredOperand = lowerTakeOperand({
    context: input.context,
    expression: input.expression,
    call: input.call,
    operand: input.takeStatement.operand,
    blockKey: input.blockKey,
    originKey,
  });
  if (loweredOperand.kind === "error") {
    return loweredOperand;
  }

  const closureObligationId = closureObligationIdForTakeKind(input.takeStatement.takeKind);
  if (closureObligationId === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
        message: "Proof MIR take lowering requires a closure obligation.",
        functionInstanceId: input.context.functionInstanceId,
        sourceOrigin: input.takeStatement.sourceOrigin,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "take-obligation",
        stableDetail: "missing",
      }),
    ]);
  }

  const obligation = draftObligationReference({
    obligationId: closureObligationId,
    originKey,
  });
  const operandPlace = operandPlaceKey(loweredOperand.value);
  let aliasPlaceKey: ProofMirCanonicalKey | undefined;
  if (input.takeStatement.aliasLocal !== undefined) {
    const loweredAliasPlace = lowerTakeAliasPlace({
      context: input.context,
      aliasLocal: input.takeStatement.aliasLocal,
      originKey,
    });
    if (loweredAliasPlace.kind === "error") {
      return loweredAliasPlace;
    }
    aliasPlaceKey = loweredAliasPlace.value;
  }
  const sessionMemberPlaceKey = aliasPlaceKey ?? operandPlace;

  input.recorder.recordStatement(input.blockKey, originKey, {
    kind: "openObligation",
    obligation,
  });
  input.context.effects.recordEdgeEffect({
    kind: "openObligation",
    obligationProofKey: proofMetadataIdKey(closureObligationId),
    originKey,
  });

  let sessionMember: DraftProofMirSessionMemberReference | undefined;
  switch (input.takeStatement.takeKind.kind) {
    case "stream":
      sessionMember = draftSessionMemberReference({
        sessionId: input.takeStatement.takeKind.sessionId,
        brandId: input.takeStatement.takeKind.itemBrandId,
        obligationId: input.takeStatement.takeKind.closureObligationId,
        ...(sessionMemberPlaceKey === undefined ? {} : { placeKey: sessionMemberPlaceKey }),
        originKey,
      });
      input.recorder.recordStatement(input.blockKey, originKey, {
        kind: "openSessionMember",
        member: sessionMember,
      });
      input.context.effects.recordEdgeEffect({
        kind: "openSessionMember",
        sessionProofKey: proofMetadataIdKey(input.takeStatement.takeKind.sessionId),
        brandProofKey: proofMetadataIdKey(input.takeStatement.takeKind.itemBrandId),
        obligationProofKey: proofMetadataIdKey(input.takeStatement.takeKind.closureObligationId),
        ...(sessionMemberPlaceKey === undefined ? {} : { placeKey: sessionMemberPlaceKey }),
        originKey,
      });
      break;
    case "validatedBuffer":
      sessionMember = draftSessionMemberReference({
        sessionId: input.takeStatement.takeKind.sessionId,
        brandId: input.takeStatement.takeKind.memberBrandId,
        obligationId: input.takeStatement.takeKind.closureObligationId,
        ...(sessionMemberPlaceKey === undefined ? {} : { placeKey: sessionMemberPlaceKey }),
        originKey,
      });
      input.recorder.recordStatement(input.blockKey, originKey, {
        kind: "openSessionMember",
        member: sessionMember,
      });
      input.context.effects.recordEdgeEffect({
        kind: "openSessionMember",
        sessionProofKey: proofMetadataIdKey(input.takeStatement.takeKind.sessionId),
        brandProofKey: proofMetadataIdKey(input.takeStatement.takeKind.memberBrandId),
        obligationProofKey: proofMetadataIdKey(input.takeStatement.takeKind.closureObligationId),
        ...(sessionMemberPlaceKey === undefined ? {} : { placeKey: sessionMemberPlaceKey }),
        originKey,
      });
      break;
    case "buffer":
      break;
    default: {
      const unreachable: never = input.takeStatement.takeKind;
      return unreachable;
    }
  }

  const takeOperand = draftTakeOperandForStart({
    operand: loweredOperand.value,
    originKey,
  });
  if (takeOperand === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
        message: "Proof MIR take lowering requires a place-backed operand.",
        functionInstanceId: input.context.functionInstanceId,
        sourceOrigin: input.takeStatement.sourceOrigin,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "take-operand",
        stableDetail: "missing-place",
      }),
    ]);
  }

  const takeStart: DraftProofMirTakeStart = {
    operand: takeOperand,
    obligation,
    ...(sessionMember === undefined ? {} : { sessionMember }),
    ...(input.takeStatement.aliasLocal === undefined
      ? {}
      : { aliasMonoLocalId: input.takeStatement.aliasLocal.localId }),
    originKey,
  };
  input.recorder.recordStatement(input.blockKey, originKey, {
    kind: "take",
    take: takeStart,
  });

  const takeScopeRole = `take:${String(originKey)}`;
  const parentScopeKey = input.context.graph.block(input.blockKey).scopeKey;
  const takeScopeKey = input.context.graph.createScope({
    role: takeScopeRole,
    parentScopeKey,
    origin: originKey,
  });
  const takeBodyBlockKey = input.context.graph.createBlock({
    role: takeScopeRole,
    scope: takeScopeKey,
    origin: originKey,
    sourceOrigin: input.takeStatement.sourceOrigin,
  });
  input.context.ssa.registerBlock(takeBodyBlockKey);

  let _aliasStorage: "scalarSsa" | "placeBacked" | undefined;
  if (input.takeStatement.aliasLocal !== undefined) {
    const aliasLocal = input.takeStatement.aliasLocal;
    const storage = input.context.localClassifier.storageForLocal(aliasLocal.localId);
    _aliasStorage = storage;
    input.context.graph.createLocal({
      monoLocalId: aliasLocal.localId,
      name: aliasLocal.name,
      origin: originKey,
      scopeKey: takeScopeKey,
      type: aliasLocal.type,
      resourceKind: aliasLocal.resourceKind,
      ...(storage === undefined ? {} : { storage }),
      ...(storage === "placeBacked" && aliasPlaceKey !== undefined
        ? { backingPlaceKey: aliasPlaceKey }
        : {}),
    });
  }

  const loweredBody = lowerProofMirTakeBodyStatements({
    context: input.context,
    takeStatement: input.takeStatement,
    takeBodyBlockKey,
    statement: input.statement,
    controlFlow: input.controlFlow,
    terminal: input.terminal,
    validation: input.validation,
  });
  if (loweredBody.kind === "error") {
    return loweredBody;
  }
  const finalTakeBodyBlockKey = loweredBody.value;

  const exitOriginKey = input.context.originMap.syntheticFrom(originKey, "take.exit");
  const afterTakeBlockKey = input.context.graph.createBlock({
    role: "continuation",
    scope: parentScopeKey,
    origin: exitOriginKey,
    sourceOrigin: input.takeStatement.sourceOrigin,
  });
  input.context.ssa.registerBlock(afterTakeBlockKey);
  const allowedTransfers: DraftProofMirEdgeEffect[] = [
    {
      kind: "openObligation",
      obligationProofKey: proofMetadataIdKey(closureObligationId),
      originKey: exitOriginKey,
    },
  ];
  if (sessionMember !== undefined) {
    allowedTransfers.push({
      kind: "openSessionMember",
      sessionProofKey: proofMetadataIdKey(sessionMember.sessionId),
      brandProofKey: proofMetadataIdKey(sessionMember.brandId),
      ...(sessionMember.obligationId === undefined
        ? {}
        : { obligationProofKey: proofMetadataIdKey(sessionMember.obligationId) }),
      ...(sessionMemberPlaceKey === undefined ? {} : { placeKey: sessionMemberPlaceKey }),
      originKey: exitOriginKey,
    });
  }

  const crossedScopes: readonly ProofMirCanonicalKey[] = [takeScopeKey];

  const monoObligation = lookupMonoObligation(input.context.program, closureObligationId);
  if (monoObligation !== undefined && shouldDischargeAtTakeExit(monoObligation)) {
    const dischargeObligation = draftObligationReference({
      obligationId: closureObligationId,
      originKey: exitOriginKey,
    });
    input.recorder.recordStatement(finalTakeBodyBlockKey, exitOriginKey, {
      kind: "dischargeObligation",
      obligation: dischargeObligation,
    });
    allowedTransfers.push({
      kind: "dischargeObligation",
      obligationProofKey: proofMetadataIdKey(closureObligationId),
      originKey: exitOriginKey,
    });
  }

  if (
    monoObligation !== undefined &&
    shouldCloseSessionAtTakeExit(monoObligation) &&
    sessionMember !== undefined
  ) {
    input.recorder.recordStatement(finalTakeBodyBlockKey, exitOriginKey, {
      kind: "closeSessionMember",
      member: sessionMember,
    });
    allowedTransfers.push({
      kind: "closeSessionMember",
      sessionProofKey: proofMetadataIdKey(sessionMember.sessionId),
      brandProofKey: proofMetadataIdKey(sessionMember.brandId),
      ...(sessionMember.obligationId === undefined
        ? {}
        : { obligationProofKey: proofMetadataIdKey(sessionMember.obligationId) }),
      ...(sessionMemberPlaceKey === undefined ? {} : { placeKey: sessionMemberPlaceKey }),
      originKey: exitOriginKey,
    });
  }

  const exitBundle = input.context.graph.createScopeExit({
    role: "take.exit",
    fromBlock: finalTakeBodyBlockKey,
    toBlock: afterTakeBlockKey,
    sourceScope: input.context.graph.block(finalTakeBodyBlockKey).scopeKey,
    targetScope: parentScopeKey,
    origin: exitOriginKey,
    crossedScopes,
    closure: {
      kind: "scopeExit",
      checkedScopeKeys: crossedScopes,
      evaluateAfterEdgeEffects: true,
      allowedTransfers,
    },
  });

  const setTerminatorResult = input.context.graph.setTerminator(finalTakeBodyBlockKey, {
    kind: "goto",
    target: { edge: exitBundle.edge, block: afterTakeBlockKey },
    origin: exitOriginKey,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }

  input.recorder.recordExit({
    exitKey: exitBundle.exit,
    crossedScopes,
    closure: {
      kind: "scopeExit",
      checkedScopeKeys: crossedScopes,
      evaluateAfterEdgeEffects: true,
      allowedTransfers,
    },
    allowedTransfers,
  });

  const wiredEntry = wireGotoEdge({
    context: input.context,
    fromBlockKey: input.blockKey,
    toBlockKey: takeBodyBlockKey,
    originKey,
    role: "take.entry",
    createEdge: (edgeInput) => input.context.graph.createNormalEdge(edgeInput),
  });
  if (wiredEntry.kind === "error") {
    return wiredEntry;
  }

  if (input.context.blockTracking !== undefined) {
    input.context.blockTracking.currentBlockRef.blockKey = afterTakeBlockKey;
  }

  return loweringOk(undefined);
}

export function createProofMirTakeLowerer(
  input: CreateProofMirTakeLowererInput,
): ProofMirTakeLowerer {
  return {
    lowerTake(takeInput) {
      const recorder = input.recorder ?? createTakeBodyRecorder(takeInput.context.graph);
      return lowerTakeImpl({
        context: takeInput.context,
        expression: input.expression,
        call: input.call,
        statement: input.statement,
        controlFlow: input.controlFlow,
        terminal: input.terminal,
        validation: input.validation,
        recorder,
        takeStatement: takeInput.statement,
        blockKey: takeInput.blockKey,
      });
    },
  };
}
