import type { ObligationId, SessionId, BrandId } from "../../hir/ids";
import type {
  MonoInstantiatedProofId,
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
import { type DraftProofMirEdgeEffect } from "../domains/effects-resources";
import type {
  DraftProofMirGraphStatementSnapshot,
  DraftProofMirObligationReference,
  DraftProofMirSessionMemberReference,
  DraftProofMirStatementKind,
  DraftProofMirTakeOperand,
  DraftProofMirTakeStart,
} from "../draft/draft-statement";
import type { ProofMirExitClosurePolicy } from "../model/graph";
import { wireGotoEdge } from "./loop-scaffold";
import { operandPlaceKey, type ProofMirDraftOperand } from "./lowering-operands";
import {
  type ProofMirCallLowerer,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTakeLowerer,
} from "./lowering-context";

export interface DraftRecordedProofMirTakeStatement {
  readonly statementKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly kind: DraftProofMirStatementKind;
}

export interface DraftRecordedProofMirTakeExit {
  readonly exitKey: ProofMirCanonicalKey;
  readonly crossedScopes: readonly ProofMirCanonicalKey[];
  readonly closure: ProofMirExitClosurePolicy;
  readonly allowedTransfers: readonly DraftProofMirEdgeEffect[];
}

export interface ProofMirTakeBodyRecorder {
  readonly statements: readonly DraftRecordedProofMirTakeStatement[];
  readonly exits: readonly DraftRecordedProofMirTakeExit[];
  recordStatement(
    blockKey: ProofMirCanonicalKey,
    originKey: ProofMirCanonicalKey,
    kind: DraftProofMirStatementKind,
  ): void;
  recordExit(entry: DraftRecordedProofMirTakeExit): void;
}

export interface CreateProofMirTakeLowererInput {
  readonly expression: ProofMirExpressionLowerer;
  readonly call?: ProofMirCallLowerer;
  readonly statement?: ProofMirStatementLowerer;
  readonly recorder?: ProofMirTakeBodyRecorder;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

export function createTakeBodyRecorder(graph: {
  addStatement(
    blockKey: ProofMirCanonicalKey,
    input: {
      readonly origin: ProofMirCanonicalKey;
    },
  ): ProofMirCanonicalKey;
  recordLoweredStatement(
    blockKey: ProofMirCanonicalKey,
    statement: DraftProofMirGraphStatementSnapshot,
  ): void;
}): ProofMirTakeBodyRecorder {
  const statements: DraftRecordedProofMirTakeStatement[] = [];
  const exits: DraftRecordedProofMirTakeExit[] = [];
  return {
    get statements() {
      return statements.slice();
    },
    get exits() {
      return exits.slice();
    },
    recordStatement(blockKey, originKey, kind) {
      const statementKey = graph.addStatement(blockKey, {
        origin: originKey,
      });
      const snapshot: DraftProofMirGraphStatementSnapshot = {
        statementKey,
        originKey,
        kind,
      };
      statements.push(snapshot);
      graph.recordLoweredStatement(blockKey, snapshot);
    },
    recordExit(entry) {
      exits.push(entry);
    },
  };
}

function originForTake(input: {
  readonly context: ProofMirLoweringContext;
  readonly takeStatement: MonoTakeStatement;
  readonly monoStatement?: MonoStatement;
}): ProofMirCanonicalKey {
  if (input.monoStatement !== undefined) {
    return input.context.originMap.fromMonoStatement({
      owner: { kind: "function", functionInstanceId: input.context.functionInstanceId },
      sourceOrigin: input.monoStatement.sourceOrigin as never,
      monoStatementId: input.monoStatement.statementId,
    });
  }
  return input.context.originMap.fromHirOrigin({
    owner: { kind: "function", functionInstanceId: input.context.functionInstanceId },
    sourceOrigin: input.takeStatement.sourceOrigin as never,
  });
}

function draftObligationReference(input: {
  readonly obligationId: MonoInstantiatedProofId<ObligationId>;
  readonly originKey: ProofMirCanonicalKey;
}): DraftProofMirObligationReference {
  return {
    obligationId: input.obligationId,
    originKey: input.originKey,
  };
}

function draftSessionMemberReference(input: {
  readonly sessionId: MonoInstantiatedProofId<SessionId>;
  readonly brandId: MonoInstantiatedProofId<BrandId>;
  readonly obligationId?: MonoInstantiatedProofId<ObligationId>;
  readonly placeKey?: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}): DraftProofMirSessionMemberReference {
  return {
    sessionId: input.sessionId,
    brandId: input.brandId,
    ...(input.obligationId === undefined ? {} : { obligationId: input.obligationId }),
    ...(input.placeKey === undefined ? {} : { placeKey: input.placeKey }),
    originKey: input.originKey,
  };
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
      return input.call.lowerCall({
        context: input.context,
        call: input.operand.call,
        monoExpressionId: input.operand.callExpressionId,
        blockKey: input.blockKey,
        resultType: input.operand.resultType,
        resultResourceKind: input.operand.resultResourceKind,
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

function lowerTakeImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly expression: ProofMirExpressionLowerer;
  readonly call?: ProofMirCallLowerer;
  readonly statement?: ProofMirStatementLowerer;
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
        ...(operandPlace === undefined ? {} : { placeKey: operandPlace }),
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
        ...(operandPlace === undefined ? {} : { placeKey: operandPlace }),
        originKey,
      });
      break;
    case "validatedBuffer":
      sessionMember = draftSessionMemberReference({
        sessionId: input.takeStatement.takeKind.sessionId,
        brandId: input.takeStatement.takeKind.memberBrandId,
        obligationId: input.takeStatement.takeKind.closureObligationId,
        ...(operandPlace === undefined ? {} : { placeKey: operandPlace }),
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
        ...(operandPlace === undefined ? {} : { placeKey: operandPlace }),
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

  let _aliasStorage: "scalarSsa" | "placeBacked" | undefined;
  if (input.takeStatement.aliasLocal !== undefined) {
    const aliasLocal = input.takeStatement.aliasLocal;
    input.context.graph.createLocal({
      monoLocalId: aliasLocal.localId,
      name: aliasLocal.name,
      origin: originKey,
    });
    const storage = input.context.localClassifier.storageForLocal(aliasLocal.localId);
    _aliasStorage = storage;
    if (storage === "placeBacked" && operandPlace !== undefined) {
      input.context.graph.createPlace({
        monoPlaceCanonicalKey: `take-alias:${aliasLocal.name}`,
        origin: originKey,
      });
    }
  }

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

  if (input.statement !== undefined) {
    for (const bodyStatement of input.takeStatement.body.statements) {
      const loweredBody = input.statement.lowerStatement({
        context: input.context,
        statement: bodyStatement,
        blockKey: takeBodyBlockKey,
      });
      if (loweredBody.kind === "error") {
        return loweredBody;
      }
    }
  }

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
      ...(operandPlace === undefined ? {} : { placeKey: operandPlace }),
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
    input.recorder.recordStatement(takeBodyBlockKey, exitOriginKey, {
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
    input.recorder.recordStatement(takeBodyBlockKey, exitOriginKey, {
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
      ...(operandPlace === undefined ? {} : { placeKey: operandPlace }),
      originKey: exitOriginKey,
    });
  }

  const exitBundle = input.context.graph.createScopeExit({
    role: "take.exit",
    fromBlock: takeBodyBlockKey,
    toBlock: afterTakeBlockKey,
    sourceScope: takeScopeKey,
    targetScope: parentScopeKey,
    origin: exitOriginKey,
    crossedScopes,
    closure: {
      kind: "scopeExit",
      checkedScopes: crossedScopes as never,
      evaluateAfterEdgeEffects: true,
      allowedTransfers: allowedTransfers as never,
    },
  });

  const setTerminatorResult = input.context.graph.setTerminator(takeBodyBlockKey, {
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
      checkedScopes: crossedScopes as never,
      evaluateAfterEdgeEffects: true,
      allowedTransfers: allowedTransfers as never,
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
        recorder,
        takeStatement: takeInput.statement,
        blockKey: takeInput.blockKey,
      });
    },
  };
}
