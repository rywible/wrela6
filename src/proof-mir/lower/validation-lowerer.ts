import { hirStatementId } from "../../hir/ids";
import type { MonoInstanceId } from "../../mono/ids";
import { instantiatedHirId, instantiatedHirIdKey } from "../../mono/ids";
import type {
  MonoLocal,
  MonoStatement,
  MonoStatementId,
  MonoValidation,
  MonoValidationMatchStatement,
} from "../../mono/mono-hir";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import { draftLocalKey } from "../draft/draft-keys";
import { type ProofMirLayoutReference } from "../model/layout-bindings";
import type {
  DraftProofMirGraphStatementSnapshot,
  DraftProofMirStatementKind,
  DraftProofMirValidationStart,
} from "../draft/draft-statement";
import type { ProofMirProducedOperand, ProofMirValidationArmBinding } from "../model/operands";
import {
  type DraftGraphEdgeView,
  type DraftGraphTerminator,
  type DraftGraphValidationArmBinding,
} from "../draft/draft-graph-builder";

import { setEmptyArmUnreachableTerminator } from "./empty-arm-terminator";
import { blockHasExitTerminator, blockHasTerminator } from "./control-flow-terminators";
import {
  type ProofMirControlFlowLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTailReturnPolicy,
  type ProofMirTerminalLowerer,
  type ProofMirValidationLoweringInput,
  type ProofMirValidationLowerer,
} from "./lowering-context";
import {
  allocateValidationPlaces,
  createValidationLoweringIdAllocator,
  projectedPlaceKeysForBindingLocal,
  recordValidationEvidenceFacts,
  resolveValidatedBufferInstanceId,
  type LoweredValidationPlaces,
  type ValidationLoweringIdAllocator,
} from "./validation-lowerer-support";
import { lowerProofMirTailReturnStatement } from "./tail-return";

interface RecordedProofMirStatement {
  readonly statementKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly kind: DraftProofMirStatementKind;
}

interface LoweredValidationArmBlock {
  readonly finalBlockKey: ProofMirCanonicalKey;
  readonly reachesEnd: boolean;
}

export interface CreateProofMirValidationLowererInput {
  readonly statement?: ProofMirStatementLowerer;
  readonly terminal?: ProofMirTerminalLowerer;
  readonly controlFlow?: ProofMirControlFlowLowerer;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function buildValidationStart(input: {
  readonly validation: MonoValidation;
  readonly places: LoweredValidationPlaces;
  readonly bufferInstanceId: MonoInstanceId;
  readonly originKey: ProofMirCanonicalKey;
}): DraftProofMirValidationStart {
  const layout: ProofMirLayoutReference & { readonly kind: "validatedBuffer" } = {
    kind: "validatedBuffer",
    instanceId: input.bufferInstanceId,
  };

  return {
    validationId: input.validation.validationId,
    sourcePlaceKey: input.places.sourcePlaceKey,
    pendingResultPlaceKey: input.places.pendingResultPlaceKey,
    okPacketPlaceKey: input.places.okPacketPlaceKey,
    ...(input.places.okPayloadPlaceKey === undefined
      ? {}
      : { okPayloadPlaceKey: input.places.okPayloadPlaceKey }),
    ...(input.places.errPayloadPlaceKey === undefined
      ? {}
      : { errPayloadPlaceKey: input.places.errPayloadPlaceKey }),
    okPayloadType: input.validation.okPayloadType,
    errPayloadType: input.validation.errPayloadType,
    validatedBufferInstanceId: input.bufferInstanceId,
    layout,
    originKey: input.originKey,
  };
}

function recordValidateStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly blockKey: ProofMirCanonicalKey;
  readonly recorded: RecordedProofMirStatement[];
  readonly originKey: ProofMirCanonicalKey;
  readonly validationStart: DraftProofMirValidationStart;
  readonly monoStatementId: MonoStatementId;
}): DraftProofMirGraphStatementSnapshot {
  const statementKey = input.context.graph.addStatement(input.blockKey, {
    origin: input.originKey,
  });
  const snapshot: DraftProofMirGraphStatementSnapshot = {
    statementKey,
    originKey: input.originKey,
    kind: { kind: "validate", validation: input.validationStart },
  };
  input.recorded.push(snapshot);
  input.context.graph.recordLoweredStatement(input.blockKey, snapshot);
  return snapshot;
}

function producedOperandForPlace(input: {
  readonly placeKey: ProofMirCanonicalKey;
  readonly idAllocator: ValidationLoweringIdAllocator;
}): ProofMirProducedOperand {
  const placeId = input.idAllocator.placeForKey(input.placeKey);
  const valueId = input.idAllocator.valueForKey(input.placeKey);
  return {
    kind: "valueAndPlace",
    value: valueId,
    place: placeId,
  };
}

function argumentValueKeyForPlace(input: {
  readonly context: ProofMirLoweringContext;
  readonly placeKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  const structured = input.context.effects.draftPlace(input.placeKey);
  if (structured.root.kind === "runtimeTemporary") {
    return structured.root.valueKey;
  }
  return input.context.graph.createValue({
    role: `place-argument:${String(input.placeKey)}`,
    origin: input.originKey,
    ...(structured.type === undefined ? {} : { type: structured.type }),
    ...(structured.resourceKind === undefined ? {} : { resourceKind: structured.resourceKind }),
  });
}

function draftBindingForArmLocal(input: {
  readonly context: ProofMirLoweringContext;
  readonly bindingKind: ProofMirValidationArmBinding["bindingKind"];
  readonly local?: MonoLocal;
  readonly placeKey: ProofMirCanonicalKey;
  readonly payloadType: MonoValidation["okPayloadType"];
  readonly originKey: ProofMirCanonicalKey;
  readonly idAllocator: ValidationLoweringIdAllocator;
}): {
  readonly draft: DraftGraphValidationArmBinding;
  readonly model: ProofMirValidationArmBinding;
  readonly argumentKeys: readonly ProofMirCanonicalKey[];
} {
  const operand = producedOperandForPlace({
    placeKey: input.placeKey,
    idAllocator: input.idAllocator,
  });
  const argumentValueKey = argumentValueKeyForPlace({
    context: input.context,
    placeKey: input.placeKey,
    originKey: input.originKey,
  });
  const monoLocalIdKey =
    input.local === undefined
      ? undefined
      : draftLocalKey({
          functionInstanceId: input.local.localId.instanceId,
          monoLocalId: input.local.localId,
        });

  return {
    draft: {
      ...(monoLocalIdKey === undefined ? {} : { monoLocalIdKey }),
      bindingKind: input.bindingKind,
      operandValueKey: argumentValueKey,
      operandPlaceKey: input.placeKey,
      operandType: input.payloadType,
      origin: input.originKey,
    },
    model: {
      ...(input.local === undefined ? {} : { monoLocalId: input.local.localId }),
      bindingKind: input.bindingKind,
      operand,
      type: input.payloadType,
      origin: input.idAllocator.nextOrigin(),
    },
    argumentKeys: [argumentValueKey],
  };
}

function validationArmScopeKey(input: {
  readonly context: ProofMirLoweringContext;
  readonly statementId: MonoStatementId;
  readonly arm: "ok" | "err";
  readonly parentScopeKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  const stmtPrefix = `stmt:${instantiatedHirIdKey(input.statementId)}`;
  return input.context.graph.createScope({
    role: `validationArm:${stmtPrefix}:${input.arm}`,
    parentScopeKey: input.parentScopeKey,
    origin: input.originKey,
  });
}

function invalidValidationBindingDiagnostic(input: {
  readonly context: ProofMirLoweringContext;
  readonly stableDetail: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_INVALID_VALIDATION_BINDING",
    message: "Validation match is missing required ok or err arm metadata.",
    functionInstanceId: input.context.functionInstanceId,
    ownerKey: `function:${String(input.context.functionInstanceId)}`,
    rootCauseKey: "validation-binding",
    stableDetail: input.stableDetail,
  });
}

function invalidValidationEdgeEffectsDiagnostic(input: {
  readonly context: ProofMirLoweringContext;
  readonly stableDetail: string;
}): ProofMirDiagnostic {
  return proofMirDiagnostic({
    severity: "error",
    code: "PROOF_MIR_INVALID_VALIDATION_EDGE_EFFECTS",
    message: "Validation match cannot construct consistent ok and err edge effects.",
    functionInstanceId: input.context.functionInstanceId,
    ownerKey: `function:${String(input.context.functionInstanceId)}`,
    rootCauseKey: "validation-edge-effects",
    stableDetail: input.stableDetail,
  });
}

function buildValidationEdgeEffects(input: {
  readonly places: LoweredValidationPlaces;
  readonly includeErrPayload: boolean;
  readonly okProjectedPlaceKeys?: readonly ProofMirCanonicalKey[];
}): {
  readonly okEffects: readonly {
    readonly kind: "consumePlace" | "introducePlace";
    readonly placeKey: ProofMirCanonicalKey;
  }[];
  readonly errEffects: readonly {
    readonly kind: "consumePlace" | "introducePlace";
    readonly placeKey: ProofMirCanonicalKey;
  }[];
} {
  const okEffects: {
    readonly kind: "consumePlace" | "introducePlace";
    readonly placeKey: ProofMirCanonicalKey;
  }[] = [];
  const pushOkEffect = (effect: {
    readonly kind: "consumePlace" | "introducePlace";
    readonly placeKey: ProofMirCanonicalKey;
  }): void => {
    if (
      okEffects.some(
        (existing) => existing.kind === effect.kind && existing.placeKey === effect.placeKey,
      )
    ) {
      return;
    }
    okEffects.push(effect);
  };

  pushOkEffect({ kind: "consumePlace", placeKey: input.places.pendingResultPlaceKey });
  pushOkEffect({ kind: "consumePlace", placeKey: input.places.sourcePlaceKey });
  pushOkEffect({ kind: "introducePlace", placeKey: input.places.okPacketPlaceKey });
  for (const projectedPlaceKey of input.okProjectedPlaceKeys ?? []) {
    pushOkEffect({ kind: "introducePlace", placeKey: projectedPlaceKey });
  }
  if (input.places.okPayloadPlaceKey !== undefined) {
    pushOkEffect({ kind: "introducePlace", placeKey: input.places.okPayloadPlaceKey });
  }

  const errEffects: {
    readonly kind: "consumePlace" | "introducePlace";
    readonly placeKey: ProofMirCanonicalKey;
  }[] = [{ kind: "consumePlace", placeKey: input.places.pendingResultPlaceKey }];
  if (input.includeErrPayload && input.places.errPayloadPlaceKey !== undefined) {
    errEffects.push({ kind: "introducePlace", placeKey: input.places.errPayloadPlaceKey });
  }

  return { okEffects, errEffects };
}

function lowerValidationArmBlock(input: {
  readonly context: ProofMirLoweringContext;
  readonly statementLowerer: ProofMirStatementLowerer | undefined;
  readonly terminalLowerer: ProofMirTerminalLowerer | undefined;
  readonly controlFlowLowerer: ProofMirControlFlowLowerer | undefined;
  readonly blockKey: ProofMirCanonicalKey;
  readonly statements: readonly MonoStatement[];
  readonly origin: ProofMirCanonicalKey;
  readonly tailReturn?: ProofMirTailReturnPolicy;
}): ProofMirLoweringResult<LoweredValidationArmBlock> {
  if (
    (input.statementLowerer === undefined || input.terminalLowerer === undefined) &&
    input.statements.length > 0
  ) {
    const unreachable = setEmptyArmUnreachableTerminator({
      context: input.context,
      blockKey: input.blockKey,
      origin: input.origin,
    });
    if (unreachable.kind === "error") {
      return unreachable;
    }
    return loweringOk({ finalBlockKey: input.blockKey, reachesEnd: false });
  }

  input.context.ssa.registerBlock(input.blockKey);
  const tracking = input.context.blockTracking;
  const previousCurrentBlock = tracking?.currentBlockRef.blockKey;
  const previousContinuationBlock = tracking?.continuationBlockRef.blockKey;
  if (tracking !== undefined) {
    tracking.currentBlockRef.blockKey = input.blockKey;
    tracking.continuationBlockRef.blockKey = undefined;
  }

  let activeBlockKey = input.blockKey;
  const restoreTracking = (): void => {
    if (tracking === undefined) {
      return;
    }
    tracking.currentBlockRef.blockKey = previousCurrentBlock;
    tracking.continuationBlockRef.blockKey = previousContinuationBlock;
  };
  const finish = (
    value: LoweredValidationArmBlock,
  ): ProofMirLoweringResult<LoweredValidationArmBlock> => {
    restoreTracking();
    return loweringOk(value);
  };

  for (const [statementIndex, statement] of input.statements.entries()) {
    if (blockHasExitTerminator(input.context, activeBlockKey)) {
      return finish({ finalBlockKey: activeBlockKey, reachesEnd: false });
    }
    const lastStatement = statementIndex === input.statements.length - 1;
    const tailReturn = lowerProofMirTailReturnStatement({
      context: input.context,
      terminalLowerer: input.terminalLowerer!,
      statement,
      blockKey: activeBlockKey,
      lastStatement,
      tailReturn: input.tailReturn,
    });
    const lowered =
      tailReturn.kind === "lowered"
        ? tailReturn.result
        : statement.kind.kind === "return"
          ? input.terminalLowerer!.lowerReturn({
              context: input.context,
              expression: statement.kind.expression,
              blockKey: activeBlockKey,
              terminal: false,
            })
          : input.controlFlowLowerer !== undefined &&
              (statement.kind.kind === "if" ||
                statement.kind.kind === "while" ||
                statement.kind.kind === "loop" ||
                statement.kind.kind === "match" ||
                statement.kind.kind === "break" ||
                statement.kind.kind === "continue")
            ? input.controlFlowLowerer.lowerControlFlowStatement({
                context: input.context,
                statement,
                blockKey: activeBlockKey,
                ...(lastStatement && input.tailReturn !== undefined
                  ? { tailReturn: input.tailReturn }
                  : {}),
              })
            : input.statementLowerer!.lowerStatement({
                context: input.context,
                statement,
                blockKey: activeBlockKey,
              });
    if (lowered.kind === "error") {
      restoreTracking();
      return lowered;
    }

    if (tracking?.currentBlockRef.blockKey !== undefined) {
      activeBlockKey = tracking.currentBlockRef.blockKey;
    }
  }

  if (blockHasTerminator(input.context, activeBlockKey)) {
    return finish({ finalBlockKey: activeBlockKey, reachesEnd: false });
  }

  return finish({ finalBlockKey: activeBlockKey, reachesEnd: true });
}

function wireValidationFallThroughEdge(input: {
  readonly context: ProofMirLoweringContext;
  readonly fromBlockKey: ProofMirCanonicalKey;
  readonly toBlockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly role: string;
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  const fromScope = input.context.graph.block(input.fromBlockKey).scopeKey;
  const toScope = input.context.graph.block(input.toBlockKey).scopeKey;
  const edgeKey = input.context.graph.createNormalEdge({
    role: input.role,
    fromBlock: input.fromBlockKey,
    toBlock: input.toBlockKey,
    sourceScope: fromScope,
    targetScope: toScope,
    origin: input.originKey,
    argumentKeys: [],
  });
  input.context.ssa.registerPredecessorEdge({
    blockKey: input.toBlockKey,
    edgeKey,
    fromBlockKey: input.fromBlockKey,
    argumentKeysBySsaKey: {},
  });
  input.context.ssa.setEdgeArguments({ edgeKey, argumentKeys: [] });
  const setTerminatorResult = input.context.graph.setTerminator(input.fromBlockKey, {
    kind: "goto",
    target: { edge: edgeKey, block: input.toBlockKey },
    origin: input.originKey,
  });
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }
  return loweringOk(edgeKey);
}

function lowerValidationCreationImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly validation: MonoValidation;
  readonly blockKey: ProofMirCanonicalKey;
  readonly materializeOkPayload: boolean;
  readonly materializeErrPayload: boolean;
  readonly okBindingLocal?: MonoLocal;
  readonly errBindingLocal?: MonoLocal;
  readonly recorded: RecordedProofMirStatement[];
  readonly idAllocator: ValidationLoweringIdAllocator;
}): ProofMirLoweringResult<{
  readonly validationStart: DraftProofMirValidationStart;
  readonly places: LoweredValidationPlaces;
  readonly validateStatement: DraftProofMirGraphStatementSnapshot;
}> {
  const bufferInstanceId = resolveValidatedBufferInstanceId(
    input.context.program,
    input.validation.validatedBufferTypeId,
  );
  if (bufferInstanceId === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_MISSING_VALIDATED_BUFFER_FACT",
        message: "Validation creation references a validated buffer with no mono instance.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "missing-validated-buffer",
        stableDetail: String(input.validation.validatedBufferTypeId),
      }),
    ]);
  }

  const originKey = input.context.originMap.fromMonoProof({
    owner: { kind: "function", functionInstanceId: input.context.functionInstanceId },
    monoProofId: input.validation.validationId,
  });

  const placesResult = allocateValidationPlaces({
    context: input.context,
    validation: input.validation,
    originKey,
    materializeOkPayload: input.materializeOkPayload,
    materializeErrPayload: input.materializeErrPayload,
    ...(input.okBindingLocal === undefined ? {} : { okBindingLocal: input.okBindingLocal }),
    ...(input.errBindingLocal === undefined ? {} : { errBindingLocal: input.errBindingLocal }),
  });
  if (placesResult.kind === "error") {
    return placesResult;
  }

  const validationStart = buildValidationStart({
    validation: input.validation,
    places: placesResult.value,
    bufferInstanceId,
    originKey,
  });

  const validateStatement = recordValidateStatement({
    context: input.context,
    blockKey: input.blockKey,
    recorded: input.recorded,
    originKey,
    validationStart,
    monoStatementId: instantiatedHirId(
      input.context.functionInstanceId,
      hirStatementId(Number(String(input.validation.validationId.hirId))),
    ),
  });

  return loweringOk({ validationStart, places: placesResult.value, validateStatement });
}

function lowerValidationMatchImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly statement: MonoValidationMatchStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly statementLowerer: ProofMirStatementLowerer | undefined;
  readonly terminalLowerer: ProofMirTerminalLowerer | undefined;
  readonly controlFlowLowerer: ProofMirControlFlowLowerer | undefined;
  readonly tailReturn?: ProofMirTailReturnPolicy;
  readonly recorded: RecordedProofMirStatement[];
  readonly idAllocator: ValidationLoweringIdAllocator;
}): ProofMirLoweringResult<{
  readonly validation: MonoValidation;
  readonly validateStatement?: DraftProofMirGraphStatementSnapshot;
  readonly terminator: DraftGraphTerminator;
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly okEdge: DraftGraphEdgeView;
  readonly errEdge: DraftGraphEdgeView;
}> {
  if (input.statement.validation === undefined) {
    return loweringError([
      invalidValidationEdgeEffectsDiagnostic({
        context: input.context,
        stableDetail: "missing-validation-metadata",
      }),
    ]);
  }

  if (input.statement.okArm === undefined || input.statement.errArm === undefined) {
    return loweringError([
      invalidValidationBindingDiagnostic({
        context: input.context,
        stableDetail: `ok:${input.statement.okArm === undefined}:err:${input.statement.errArm === undefined}`,
      }),
    ]);
  }

  const validation = input.statement.validation;
  const materializeErrPayload = input.statement.errArm.bindingLocals.length > 0;
  const okBindingLocal = input.statement.okArm.bindingLocals[0];
  const errBindingLocal = input.statement.errArm.bindingLocals[0];
  const matchStatementId = instantiatedHirId(
    input.context.functionInstanceId,
    hirStatementId(Number(String(validation.validationId.hirId))),
  );

  const creationResult = lowerValidationCreationImpl({
    context: input.context,
    validation,
    blockKey: input.blockKey,
    materializeOkPayload: false,
    materializeErrPayload,
    ...(okBindingLocal === undefined ? {} : { okBindingLocal }),
    ...(errBindingLocal === undefined ? {} : { errBindingLocal }),
    recorded: input.recorded,
    idAllocator: input.idAllocator,
  });
  if (creationResult.kind === "error") {
    return creationResult;
  }

  const places = creationResult.value.places;
  const bufferInstanceId = resolveValidatedBufferInstanceId(
    input.context.program,
    validation.validatedBufferTypeId,
  );
  if (bufferInstanceId === undefined) {
    return loweringError([
      invalidValidationEdgeEffectsDiagnostic({
        context: input.context,
        stableDetail: "missing-buffer-instance",
      }),
    ]);
  }

  const matchOriginKey = input.context.originMap.fromMonoStatement({
    owner: { kind: "function", functionInstanceId: input.context.functionInstanceId },
    monoStatementId: instantiatedHirId(
      input.context.functionInstanceId,
      hirStatementId(Number(String(validation.validationId.hirId)) + 1000),
    ),
  });

  const okArmOriginKey = input.context.graph.allocateSyntheticOrigin("validation.ok");
  const errArmOriginKey = input.context.graph.allocateSyntheticOrigin("validation.err");
  const statementOrdinal = Number(String(validation.validationId.hirId));

  const sourceScopeKey = input.context.graph.block(input.blockKey).scopeKey;
  const continuationBlockKey = input.context.graph.createBlock({
    role: "continuation",
    scope: sourceScopeKey,
    origin: matchOriginKey,
    sourceOrigin: `${input.statement.sourceOrigin}:after`,
  });
  input.context.ssa.registerBlock(continuationBlockKey);

  const okScopeKey = validationArmScopeKey({
    context: input.context,
    statementId: matchStatementId,
    arm: "ok",
    parentScopeKey: sourceScopeKey,
    originKey: okArmOriginKey,
  });
  const errScopeKey = validationArmScopeKey({
    context: input.context,
    statementId: matchStatementId,
    arm: "err",
    parentScopeKey: sourceScopeKey,
    originKey: errArmOriginKey,
  });

  const okBlockKey = input.context.graph.createBlock({
    role: `validation:ok:${statementOrdinal}`,
    scope: okScopeKey,
    origin: okArmOriginKey,
  });
  const errBlockKey = input.context.graph.createBlock({
    role: `validation:err:${statementOrdinal}`,
    scope: errScopeKey,
    origin: errArmOriginKey,
  });

  const loweredOkArm = lowerValidationArmBlock({
    context: input.context,
    statementLowerer: input.statementLowerer,
    terminalLowerer: input.terminalLowerer,
    controlFlowLowerer: input.controlFlowLowerer,
    blockKey: okBlockKey,
    statements: input.statement.okArm.body.statements,
    origin: okArmOriginKey,
    ...(input.tailReturn === undefined ? {} : { tailReturn: input.tailReturn }),
  });
  if (loweredOkArm.kind === "error") {
    return loweredOkArm;
  }
  const loweredErrArm = lowerValidationArmBlock({
    context: input.context,
    statementLowerer: input.statementLowerer,
    terminalLowerer: input.terminalLowerer,
    controlFlowLowerer: input.controlFlowLowerer,
    blockKey: errBlockKey,
    statements: input.statement.errArm.body.statements,
    origin: errArmOriginKey,
    ...(input.tailReturn === undefined ? {} : { tailReturn: input.tailReturn }),
  });
  if (loweredErrArm.kind === "error") {
    return loweredErrArm;
  }

  if (loweredOkArm.value.reachesEnd) {
    const wiredOk = wireValidationFallThroughEdge({
      context: input.context,
      fromBlockKey: loweredOkArm.value.finalBlockKey,
      toBlockKey: continuationBlockKey,
      originKey: okArmOriginKey,
      role: "validation.continuation:ok",
    });
    if (wiredOk.kind === "error") {
      return wiredOk;
    }
  }

  if (loweredErrArm.value.reachesEnd) {
    const wiredErr = wireValidationFallThroughEdge({
      context: input.context,
      fromBlockKey: loweredErrArm.value.finalBlockKey,
      toBlockKey: continuationBlockKey,
      originKey: errArmOriginKey,
      role: "validation.continuation:err",
    });
    if (wiredErr.kind === "error") {
      return wiredErr;
    }
  }

  const okProjectedPlaceKeys =
    okBindingLocal === undefined
      ? []
      : projectedPlaceKeysForBindingLocal({
          context: input.context,
          local: okBindingLocal,
        });

  const { okEffects, errEffects } = buildValidationEdgeEffects({
    places,
    includeErrPayload: materializeErrPayload,
    okProjectedPlaceKeys,
  });

  const okFactKeys = recordValidationEvidenceFacts({
    context: input.context,
    validation,
    bufferInstanceId,
    packetPlaceKey: places.okPacketPlaceKey,
    originKey: okArmOriginKey,
    idAllocator: input.idAllocator,
  });

  const okBindings: DraftGraphValidationArmBinding[] = [];
  const okModelBindings: ProofMirValidationArmBinding[] = [];
  const okArgumentKeys: ProofMirCanonicalKey[] = [];
  if (okBindingLocal !== undefined) {
    const binding = draftBindingForArmLocal({
      context: input.context,
      bindingKind: "packet",
      local: okBindingLocal,
      placeKey: places.okPacketPlaceKey,
      payloadType: validation.okPayloadType,
      originKey: okArmOriginKey,
      idAllocator: input.idAllocator,
    });
    okBindings.push(binding.draft);
    okModelBindings.push(binding.model);
    okArgumentKeys.push(...binding.argumentKeys);
  }

  const errBindings: DraftGraphValidationArmBinding[] = [];
  const errModelBindings: ProofMirValidationArmBinding[] = [];
  const errArgumentKeys: ProofMirCanonicalKey[] = [];
  if (errBindingLocal !== undefined && places.errPayloadPlaceKey !== undefined) {
    const binding = draftBindingForArmLocal({
      context: input.context,
      bindingKind: "error",
      local: errBindingLocal,
      placeKey: places.errPayloadPlaceKey,
      payloadType: validation.errPayloadType,
      originKey: errArmOriginKey,
      idAllocator: input.idAllocator,
    });
    errBindings.push(binding.draft);
    errModelBindings.push(binding.model);
    errArgumentKeys.push(...binding.argumentKeys);
  }

  const okEdgeKey = input.context.graph.createValidationEdge({
    kind: "validationOk",
    fromBlock: input.blockKey,
    toBlock: okBlockKey,
    sourceScope: sourceScopeKey,
    targetScope: okScopeKey,
    origin: okArmOriginKey,
    factKeys: okFactKeys,
    effects: okEffects,
    argumentKeys: okArgumentKeys,
  });
  const errEdgeKey = input.context.graph.createValidationEdge({
    kind: "validationErr",
    fromBlock: input.blockKey,
    toBlock: errBlockKey,
    sourceScope: sourceScopeKey,
    targetScope: errScopeKey,
    origin: errArmOriginKey,
    effects: errEffects,
    argumentKeys: errArgumentKeys,
  });

  const terminator: DraftGraphTerminator = {
    kind: "matchValidation",
    validationId: validation.validationId,
    okTarget: { edge: okEdgeKey, block: okBlockKey },
    errTarget: { edge: errEdgeKey, block: errBlockKey },
    okBindings,
    errBindings,
    origin: matchOriginKey,
  };

  const setTerminatorResult = input.context.graph.setTerminator(input.blockKey, terminator);
  if (setTerminatorResult.kind === "error") {
    return setTerminatorResult;
  }

  if (input.context.blockTracking !== undefined) {
    input.context.blockTracking.currentBlockRef.blockKey = continuationBlockKey;
    input.context.blockTracking.continuationBlockRef.blockKey = undefined;
  }

  void okModelBindings;
  void errModelBindings;

  return loweringOk({
    validation,
    validateStatement: creationResult.value.validateStatement,
    terminator,
    continuationBlockKey,
    okEdge: input.context.graph.edge(okEdgeKey),
    errEdge: input.context.graph.edge(errEdgeKey),
  });
}

export function createProofMirValidationLowerer(
  input: CreateProofMirValidationLowererInput = {},
): ProofMirValidationLowerer & {
  readonly statements: () => readonly DraftProofMirGraphStatementSnapshot[];
  lowerValidationCreation(input: {
    readonly context: ProofMirLoweringContext;
    readonly validation: MonoValidation;
    readonly blockKey: ProofMirCanonicalKey;
    readonly materializeOkPayload?: boolean;
    readonly materializeErrPayload?: boolean;
  }): ProofMirLoweringResult<DraftProofMirGraphStatementSnapshot>;
} {
  const recorded: RecordedProofMirStatement[] = [];
  const idAllocator = createValidationLoweringIdAllocator();

  return {
    lowerValidation(lowererInput: ProofMirValidationLoweringInput): ProofMirLoweringResult<void> {
      const result = lowerValidationMatchImpl({
        context: lowererInput.context,
        statement: lowererInput.statement,
        blockKey: lowererInput.blockKey,
        statementLowerer: input.statement,
        terminalLowerer: input.terminal,
        controlFlowLowerer: input.controlFlow,
        ...(lowererInput.tailReturn === undefined ? {} : { tailReturn: lowererInput.tailReturn }),
        recorded,
        idAllocator,
      });
      if (result.kind === "error") {
        return result;
      }
      return loweringOk(undefined);
    },
    lowerValidationCreation(input) {
      const creationRecorded: RecordedProofMirStatement[] = [];
      const result = lowerValidationCreationImpl({
        context: input.context,
        validation: input.validation,
        blockKey: input.blockKey,
        materializeOkPayload: input.materializeOkPayload ?? false,
        materializeErrPayload: input.materializeErrPayload ?? false,
        recorded: creationRecorded,
        idAllocator,
      });
      if (result.kind === "error") {
        return result;
      }
      recorded.push(result.value.validateStatement);
      return loweringOk(result.value.validateStatement);
    },
    statements(): readonly DraftProofMirGraphStatementSnapshot[] {
      return recorded.map((entry) => ({
        statementKey: entry.statementKey,
        originKey: entry.originKey,
        kind: entry.kind,
      }));
    },
  };
}
