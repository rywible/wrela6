import { obligationId, resourcePlaceId } from "../../../hir/ids";
import type {
  MonoCallExpression,
  MonoCheckedType,
  MonoExpressionId,
  MonoForStatement,
  MonoInstantiatedProofId,
  MonoLocal,
  MonoResourcePlace,
  MonoStatement,
  MonomorphizedHirProgram,
} from "../../../mono/mono-hir";
import type { ConcreteResourceKind } from "../../../semantic/surface/resource-kind";
import { proofMetadataIdKey } from "../../../mono/proof-metadata-tables";
import { type ProofMirCanonicalKey } from "../../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../../diagnostics";
import { type DraftProofMirFact } from "../../domains/fact-recording";
import type { DraftProofMirSessionMemberReference } from "../../domains/effects-resources";
import {
  type DraftGraphEdgeEffect,
  type DraftGraphEdgeView,
} from "../../draft/draft-graph-builder";
import { proofMirRuntimeCallId, proofMirRuntimeOperationId } from "../../ids";
import { operandPlaceKey, operandValueKey } from "../lowering-operands";
import {
  recordedCallFromFunctionDraft,
  type DraftRecordedProofMirCall,
  type ProofMirCallLoweringRecorder,
} from "../call-lowerer";
import {
  type LoopLoweringSharedInput,
  finalizeStructuredLoopBody,
  setupStructuredLoopScaffold,
} from "../loop-lowerer";
import {
  type ProofMirCallLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
} from "../lowering-context";
import { type ProofMirFunctionScopePlaceLowerer } from "../scope-place-lowerer";

export interface IteratorLoweringEdgeView extends DraftGraphEdgeView {
  readonly facts: readonly DraftProofMirFact[];
}

export interface IteratorLoweringMetadata {
  readonly nextCall: MonoCallExpression;
  readonly nextExpressionId: MonoExpressionId;
  readonly finishExpressionId: MonoExpressionId;
  readonly nextResultType: MonoCheckedType;
  readonly nextResultResourceKind: ConcreteResourceKind;
  readonly finishResultType: MonoCheckedType;
  readonly finishResultResourceKind: ConcreteResourceKind;
  readonly iteratorObligationId?: MonoInstantiatedProofId<ReturnType<typeof obligationId>>;
  readonly finishRuntimeCallId: ReturnType<typeof proofMirRuntimeCallId>;
  readonly finishRuntimeOperationId: ReturnType<typeof proofMirRuntimeOperationId>;
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}

function loweringError(diagnostics: readonly ProofMirDiagnostic[]): ProofMirLoweringResult<never> {
  return { kind: "error", diagnostics: sortProofMirDiagnostics([...diagnostics]) };
}

function resolveFacts(
  context: ProofMirLoweringContext,
  factKeys: readonly ProofMirCanonicalKey[],
): DraftProofMirFact[] {
  return factKeys
    .map((factKey) => context.factRecorder.draftFact(factKey))
    .filter((fact): fact is DraftProofMirFact => fact !== undefined);
}

function edgeViewWithFacts(
  context: ProofMirLoweringContext,
  edge: DraftGraphEdgeView,
): IteratorLoweringEdgeView {
  return {
    ...edge,
    facts: resolveFacts(context, edge.factKeys),
  };
}

function openIteratorObligations(input: {
  readonly context: ProofMirLoweringContext;
  readonly originKey: ProofMirCanonicalKey;
  readonly obligationIds: readonly MonoInstantiatedProofId<ReturnType<typeof obligationId>>[];
}): void {
  for (const obligationRef of input.obligationIds) {
    input.context.effects.recordEdgeEffect({
      kind: "openObligation",
      obligationProofKey: proofMetadataIdKey(obligationRef),
      originKey: input.originKey,
    });
  }
}

function finishFactKeys(input: {
  readonly context: ProofMirLoweringContext;
  readonly call: ProofMirCallLowerer;
  readonly blockKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly runtimeCallId: ReturnType<typeof proofMirRuntimeCallId>;
  readonly runtimeOperationId: ReturnType<typeof proofMirRuntimeOperationId>;
  readonly finishExpressionId: MonoExpressionId;
  readonly finishResultType: MonoCheckedType;
  readonly finishResultResourceKind: ConcreteResourceKind;
}): ProofMirLoweringResult<readonly ProofMirCanonicalKey[]> {
  const lowered = input.call.lowerCompilerRuntimeCall({
    context: input.context,
    runtimeId: input.runtimeOperationId,
    runtimeCallId: input.runtimeCallId,
    arguments: [],
    blockKey: input.blockKey,
    monoExpressionId: input.finishExpressionId,
    resultType: input.finishResultType,
    resultResourceKind: input.finishResultResourceKind,
  });
  if (lowered.kind === "error") {
    return lowered;
  }
  const factKey = input.context.factRecorder.recordRuntimeEnsuredFact({
    role: "trustedAxiom",
    runtimeCallId: input.runtimeCallId,
    dependsOn: [{ kind: "runtimeCall", runtimeCallId: input.runtimeCallId }],
    origin: input.originKey,
  });
  return loweringOk(factKey === undefined ? [] : [factKey]);
}

function dischargeIteratorObligations(input: {
  readonly context: ProofMirLoweringContext;
  readonly originKey: ProofMirCanonicalKey;
  readonly obligationIds: readonly MonoInstantiatedProofId<ReturnType<typeof obligationId>>[];
}): readonly DraftGraphEdgeEffect[] {
  return input.obligationIds.map((obligationRef) => ({
    kind: "dischargeObligation" as const,
    obligationProofKey: proofMetadataIdKey(obligationRef),
    originKey: input.originKey,
  }));
}

function bindingPlaceKey(input: {
  readonly context: ProofMirLoweringContext;
  readonly binding: MonoLocal;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  const monoPlace: MonoResourcePlace = {
    placeId: {
      owner: { kind: "function", instanceId: input.context.functionInstanceId },
      hirId: resourcePlaceId(Number(String(input.binding.localId.hirId))),
      instanceId: input.context.functionInstanceId,
    },
    canonicalKey: `function:${String(input.context.functionInstanceId)}/for:item:${input.binding.name}`,
    root: { kind: "local", localId: input.binding.localId },
    projection: [],
    type: input.binding.type,
    resourceKind: input.binding.resourceKind,
    sourceOrigin: input.binding.sourceOrigin,
    kind: "local",
    localId: input.binding.localId,
  };
  return input.context.effects.placeFromMono({
    monoPlace,
    originKey: input.originKey,
  });
}

export function lowerOrdinaryForStatement(input: {
  readonly context: ProofMirLoweringContext;
  readonly monoStatement: MonoStatement;
  readonly forStatement: MonoForStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly continuationBlockKey: ProofMirCanonicalKey;
  readonly shared: LoopLoweringSharedInput;
  readonly call: ProofMirCallLowerer;
  readonly callRecorder: ProofMirCallLoweringRecorder;
  readonly loopCarriedLocals: readonly MonoLocal[];
  readonly iteratorMetadata: IteratorLoweringMetadata;
  readonly obligationIds: readonly MonoInstantiatedProofId<ReturnType<typeof obligationId>>[];
  readonly boundarySessionMembers?: readonly DraftProofMirSessionMemberReference[];
  readonly fallible?: boolean;
}): ProofMirLoweringResult<{
  readonly headerBlockKey: ProofMirCanonicalKey;
  readonly bodyBlockKey: ProofMirCanonicalKey;
  readonly exitBlockKey: ProofMirCanonicalKey;
  readonly nextCall: DraftRecordedProofMirCall;
  readonly itemEdge: IteratorLoweringEdgeView;
  readonly finishedEdge: IteratorLoweringEdgeView;
  readonly errorEdge?: IteratorLoweringEdgeView;
  readonly iteratorPlaceKey: ProofMirCanonicalKey;
  readonly boundaryResources: ReturnType<
    ProofMirFunctionScopePlaceLowerer["collectLoopBoundarySet"]
  >;
}> {
  const originKey = input.context.originMap.fromMonoStatement({
    owner: { kind: "function", functionInstanceId: input.context.functionInstanceId },
    sourceOrigin: input.monoStatement.sourceOrigin,
    monoStatementId: input.monoStatement.statementId,
  });
  input.context.graph.addStatement(input.blockKey, {
    origin: originKey,
  });

  const loweredIterable =
    input.forStatement.iterable.kind.kind === "call"
      ? input.call.lowerCall({
          context: input.context,
          call: input.forStatement.iterable.kind.call,
          monoExpressionId: input.forStatement.iterable.expressionId,
          blockKey: input.blockKey,
          resultType: input.forStatement.iterable.type,
          resultResourceKind: input.forStatement.iterable.resourceKind,
        })
      : input.shared.expression.lowerExpression({
          context: input.context,
          expression: input.forStatement.iterable,
          blockKey: input.blockKey,
        });
  if (loweredIterable.kind === "error") {
    return loweredIterable;
  }
  let iteratorPlaceKey = operandPlaceKey(loweredIterable.value);
  if (iteratorPlaceKey === undefined) {
    const iterableValueKey = operandValueKey(loweredIterable.value);
    if (iterableValueKey !== undefined) {
      iteratorPlaceKey = input.context.effects.placeFromRuntimeTemporary({
        valueKey: iterableValueKey,
        originKey,
      });
    } else if (input.forStatement.iterable.place !== undefined) {
      iteratorPlaceKey = input.context.effects.placeFromMono({
        monoPlace: input.forStatement.iterable.place,
        originKey,
      });
    }
  }
  if (iteratorPlaceKey === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
        message: "Proof MIR iterator for-loop iterable must lower to a place-backed operand.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "iterator-iterable",
        stableDetail: "missing-place-operand",
        sourceOrigin: input.monoStatement.sourceOrigin,
      }),
    ]);
  }

  const scaffold = setupStructuredLoopScaffold({
    context: input.context,
    statement: input.monoStatement,
    blockKey: input.blockKey,
    continuationBlockKey: input.continuationBlockKey,
    shared: input.shared,
    loopCarriedLocals: input.loopCarriedLocals,
    boundaryPlaceKeys: [iteratorPlaceKey],
    boundarySessionMembers: input.boundarySessionMembers,
    skipStatementRegistration: true,
  });
  if (scaffold.kind === "error") {
    return scaffold;
  }

  const { loopScopeKey, headerBlockKey, bodyBlockKey, exitBlockKey, boundaryResources, frame } =
    scaffold.value;

  openIteratorObligations({
    context: input.context,
    originKey,
    obligationIds: input.obligationIds,
  });

  const loweredNext = input.call.lowerCall({
    context: input.context,
    call: input.iteratorMetadata.nextCall,
    monoExpressionId: input.iteratorMetadata.nextExpressionId,
    blockKey: headerBlockKey,
    resultType: input.iteratorMetadata.nextResultType,
    resultResourceKind: input.iteratorMetadata.nextResultResourceKind,
  });
  if (loweredNext.kind === "error") {
    return loweredNext;
  }
  const nextResultValueKey = operandValueKey(loweredNext.value);
  if (nextResultValueKey === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_INVALID_VALUE_RESOURCE_KIND",
        message: "Proof MIR iterator next call must lower to a value operand.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "iterator-next",
        stableDetail: "missing-value-operand",
        sourceOrigin: input.monoStatement.sourceOrigin,
      }),
    ]);
  }

  const nextCall = recordedCallFromFunctionDraft({
    context: input.context,
    blockKey: headerBlockKey,
  });
  if (nextCall === undefined) {
    return loweringError([
      proofMirDiagnostic({
        severity: "error",
        code: "PROOF_MIR_UNLOWERABLE_MONO_EXPRESSION",
        message: "Proof MIR iterator lowering did not record a next call.",
        functionInstanceId: input.context.functionInstanceId,
        ownerKey: `function:${String(input.context.functionInstanceId)}`,
        rootCauseKey: "iterator-next-call",
        stableDetail: "missing-call-record",
        sourceOrigin: input.monoStatement.sourceOrigin,
      }),
    ]);
  }

  const itemPlaceKey =
    input.forStatement.binding === undefined
      ? undefined
      : bindingPlaceKey({
          context: input.context,
          binding: input.forStatement.binding,
          originKey: originKey,
        });
  const itemEffects: DraftGraphEdgeEffect[] =
    itemPlaceKey === undefined ? [] : [{ kind: "introducePlace", placeKey: itemPlaceKey }];
  const finishedFactKeysResult = finishFactKeys({
    context: input.context,
    call: input.call,
    blockKey: headerBlockKey,
    originKey,
    runtimeCallId: input.iteratorMetadata.finishRuntimeCallId,
    runtimeOperationId: input.iteratorMetadata.finishRuntimeOperationId,
    finishExpressionId: input.iteratorMetadata.finishExpressionId,
    finishResultType: input.iteratorMetadata.finishResultType,
    finishResultResourceKind: input.iteratorMetadata.finishResultResourceKind,
  });
  if (finishedFactKeysResult.kind === "error") {
    return finishedFactKeysResult;
  }
  const finishedEffects = dischargeIteratorObligations({
    context: input.context,
    originKey,
    obligationIds: input.obligationIds,
  });

  const itemEdgeKey = input.context.graph.createNormalEdge({
    role: "iterator.item",
    fromBlock: headerBlockKey,
    toBlock: bodyBlockKey,
    sourceScope: loopScopeKey,
    targetScope: loopScopeKey,
    origin: originKey,
    effects: itemEffects,
  });
  const finishedEdgeKey = input.context.graph.createNormalEdge({
    role: "iterator.finished",
    fromBlock: headerBlockKey,
    toBlock: exitBlockKey,
    sourceScope: loopScopeKey,
    targetScope: input.context.graph.block(exitBlockKey).scopeKey,
    origin: originKey,
    factKeys: finishedFactKeysResult.value,
    effects: finishedEffects,
  });

  let errorEdge: IteratorLoweringEdgeView | undefined;
  if (input.fallible === true) {
    const errorBlockKey = input.context.graph.createBlock({
      role: "iterator.error",
      scope: loopScopeKey,
      origin: originKey,
      sourceOrigin: `${input.monoStatement.sourceOrigin}:error`,
    });
    const errorEdgeKey = input.context.graph.createAttemptEdge({
      kind: "attemptError",
      fromBlock: headerBlockKey,
      toBlock: errorBlockKey,
      sourceScope: loopScopeKey,
      targetScope: loopScopeKey,
      origin: originKey,
    });
    const setErrorTerminator = input.context.graph.setTerminator(errorBlockKey, {
      kind: "goto",
      target: { edge: finishedEdgeKey, block: exitBlockKey },
      origin: originKey,
    });
    if (setErrorTerminator.kind === "error") {
      return setErrorTerminator;
    }
    errorEdge = edgeViewWithFacts(input.context, input.context.graph.edge(errorEdgeKey));
  }

  const switchCases = [
    {
      label: "item",
      target: { edge: itemEdgeKey, block: bodyBlockKey },
      origin: originKey,
    },
    {
      label: "finished",
      target: { edge: finishedEdgeKey, block: exitBlockKey },
      origin: originKey,
    },
    ...(errorEdge === undefined
      ? []
      : [
          {
            label: "error",
            target: { edge: errorEdge.key, block: errorEdge.toBlockKey! },
            origin: originKey,
          },
        ]),
  ];
  const setSwitchResult = input.context.graph.setTerminator(headerBlockKey, {
    kind: "switch",
    scrutinee: nextResultValueKey,
    cases: switchCases,
    origin: originKey,
  });
  if (setSwitchResult.kind === "error") {
    return setSwitchResult;
  }

  const finalized = finalizeStructuredLoopBody({
    context: input.context,
    shared: input.shared,
    frame,
    originKey,
    bodyBlockKey,
    bodyStatements: input.forStatement.body.statements,
    loopCarriedLocals: input.loopCarriedLocals,
    continuationBlockKey: exitBlockKey,
    statementLowerer: input.shared.statementLowerer,
  });
  if (finalized.kind === "error") {
    return finalized;
  }

  return loweringOk({
    headerBlockKey,
    bodyBlockKey,
    exitBlockKey,
    nextCall,
    itemEdge: edgeViewWithFacts(input.context, input.context.graph.edge(itemEdgeKey)),
    finishedEdge: edgeViewWithFacts(input.context, input.context.graph.edge(finishedEdgeKey)),
    ...(errorEdge === undefined ? {} : { errorEdge }),
    iteratorPlaceKey,
    boundaryResources,
  });
}

export function obligationIdsForIterator(input: {
  readonly program: MonomorphizedHirProgram;
  readonly iteratorMetadata: IteratorLoweringMetadata;
}): readonly MonoInstantiatedProofId<ReturnType<typeof obligationId>>[] {
  const obligationIds: MonoInstantiatedProofId<ReturnType<typeof obligationId>>[] = [];
  if (input.iteratorMetadata.iteratorObligationId !== undefined) {
    obligationIds.push(input.iteratorMetadata.iteratorObligationId);
  }
  for (const obligation of input.program.proofMetadata.obligations.entries()) {
    if (obligation.kind === "callRequirement") {
      obligationIds.push(obligation.obligationId);
    }
  }
  return obligationIds;
}
