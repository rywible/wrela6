import { hirExpressionId, hirStatementId, obligationId, resourcePlaceId } from "../../hir/ids";
import { instantiatedHirId, monoInstanceId } from "../../mono/ids";
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
} from "../../mono/mono-hir";
import type { ConcreteResourceKind } from "../../semantic/surface/resource-kind";
import { monoStatementIdFor } from "../../mono/function-instantiator-shell";
import { compareCodeUnitStrings } from "../../mono/deterministic-sort";
import { proofMetadataIdKey } from "../../mono/proof-metadata-tables";
import { type ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import {
  proofMirDiagnostic,
  sortProofMirDiagnostics,
  type ProofMirDiagnostic,
} from "../diagnostics";
import { type DraftProofMirFact } from "../domains/fact-recording";
import { type DraftGraphEdgeEffect, type DraftGraphEdgeView } from "../draft/draft-graph-builder";
import { rejectUnsupportedProofMirExtensionConstruct } from "../extensions/extension-gates";
import { proofMirOriginId, proofMirRuntimeCallId, proofMirRuntimeOperationId } from "../ids";
import { operandPlaceKey, operandValueKey } from "./lowering-operands";
import {
  recordedCallFromFunctionDraft,
  type DraftRecordedProofMirCall,
  type ProofMirCallLoweringRecorder,
} from "./call-lowerer";
import {
  type ActiveLoopFrame,
  type LoopLoweringSharedInput,
  finalizeStructuredLoopBody,
  setupStructuredLoopScaffold,
} from "./loop-lowerer";
import { withLoopIfStatementLowering } from "./loop-if-statement-lowering";
import {
  type ProofMirCallLowerer,
  type ProofMirExpressionLowerer,
  type ProofMirForLoweringInput,
  type ProofMirIteratorLowerer,
  type ProofMirLoweringContext,
  type ProofMirLoweringResult,
  type ProofMirStatementLowerer,
  type ProofMirTerminalLowerer,
} from "./lowering-context";
import { type ProofMirFunctionScopePlaceLowerer } from "./scope-place-lowerer";

export interface IteratorLoweringEdgeView extends DraftGraphEdgeView {
  readonly facts: readonly DraftProofMirFact[];
}

export interface CreateProofMirIteratorLowererInput {
  readonly expression: ProofMirExpressionLowerer;
  readonly call: ProofMirCallLowerer;
  readonly statement: ProofMirStatementLowerer;
  readonly terminal: ProofMirTerminalLowerer;
  readonly callRecorder: ProofMirCallLoweringRecorder;
}

interface IteratorLoweringMetadata {
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

function scalarType(): MonoCheckedType {
  return { kind: "core", coreTypeId: "u8" } as MonoCheckedType;
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

function allocateProgramRuntimeCallId(
  context: ProofMirLoweringContext,
): ReturnType<typeof proofMirRuntimeCallId> {
  const usedIds = new Set(
    context.buildContext.programDraft.runtimeCalls
      .entries()
      .map((entry) => String(entry.runtimeCallId)),
  );
  let candidate = 1;
  while (usedIds.has(String(proofMirRuntimeCallId(candidate)))) {
    candidate += 1;
  }
  return proofMirRuntimeCallId(candidate);
}

function resolveIteratorFinishRuntimeOperation(
  context: ProofMirLoweringContext,
): ReturnType<typeof proofMirRuntimeOperationId> | undefined {
  const operations = [...context.target.runtimeCatalog.entries()].sort((left, right) =>
    compareCodeUnitStrings(String(left.runtimeId), String(right.runtimeId)),
  );
  const pureOperation = operations.find((operation) =>
    operation.effectSchemas.some((effect) => effect.kind === "pure"),
  );
  return pureOperation?.runtimeId ?? operations[0]?.runtimeId;
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
    sourceOrigin: input.monoStatement.sourceOrigin as never,
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

const ITERATOR_NEXT_REQUIREMENT_PREFIX = "iterator-next:";

function resolveIteratorLoweringMetadataFromProofMetadata(input: {
  readonly context: ProofMirLoweringContext;
}): IteratorLoweringMetadata | undefined {
  const functionInstanceId = input.context.functionInstanceId;
  const program = input.context.program;

  const iteratorObligation = program.proofMetadata.obligations
    .entries()
    .find(
      (obligation) =>
        obligation.obligationId.instanceId === functionInstanceId &&
        obligation.kind === "callRequirement",
    );
  if (iteratorObligation === undefined) {
    return undefined;
  }

  const nextRequirement = program.proofMetadata.callSiteRequirements
    .entries()
    .find((requirement) => {
      if (requirement.callSiteRequirementId.instanceId !== functionInstanceId) {
        return false;
      }
      const expression = requirement.requirement.expression;
      return (
        expression.kind === "opaque" && expression.text.startsWith(ITERATOR_NEXT_REQUIREMENT_PREFIX)
      );
    });
  if (nextRequirement === undefined) {
    return undefined;
  }

  const requirementExpression = nextRequirement.requirement.expression;
  if (requirementExpression.kind !== "opaque") {
    return undefined;
  }
  const nextFunctionInstanceId = monoInstanceId(
    requirementExpression.text.slice(ITERATOR_NEXT_REQUIREMENT_PREFIX.length),
  );
  const nextExpressionId = nextRequirement.callExpressionId;
  const finishRuntimeOperationId = resolveIteratorFinishRuntimeOperation(input.context);
  if (finishRuntimeOperationId === undefined) {
    return undefined;
  }
  const finishRuntimeCallId = allocateProgramRuntimeCallId(input.context);

  return {
    nextCall: {
      callee: {
        expressionId: instantiatedHirId(functionInstanceId, hirExpressionId(101)),
        kind: { kind: "name", name: "next" },
        type: scalarType(),
        resourceKind: "Copy",
        sourceOrigin: "source:iterator:next",
      },
      ownerTypeArguments: [],
      ownerTypeArgumentSource: "none",
      arguments: [],
      typeArguments: [],
      resolvedTarget: {
        kind: "sourceFunction",
        targetFunctionInstanceId: nextFunctionInstanceId,
      },
      sourceOrigin: "source:iterator:next",
    },
    nextExpressionId,
    finishExpressionId: instantiatedHirId(functionInstanceId, hirExpressionId(102)),
    nextResultType: scalarType(),
    nextResultResourceKind: "Copy",
    finishResultType: scalarType(),
    finishResultResourceKind: "Copy",
    iteratorObligationId: iteratorObligation.obligationId,
    finishRuntimeCallId,
    finishRuntimeOperationId,
  };
}

export function lowerForImpl(input: {
  readonly context: ProofMirLoweringContext;
  readonly forStatement: MonoForStatement;
  readonly monoStatement: MonoStatement;
  readonly blockKey: ProofMirCanonicalKey;
  readonly shared: LoopLoweringSharedInput;
  readonly call: ProofMirCallLowerer;
  readonly callRecorder: ProofMirCallLoweringRecorder;
  readonly loopCarriedLocals: readonly MonoLocal[];
  readonly iteratorMetadata?: IteratorLoweringMetadata;
  readonly continuationBlockKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<void> {
  switch (input.forStatement.iteration.kind) {
    case "stream": {
      const origin = proofMirOriginId(1);
      const gate = rejectUnsupportedProofMirExtensionConstruct({
        construct: "streamLoop",
        targetFeatures: input.context.target.features,
        origin,
      });
      if (gate.kind === "error") {
        return gate;
      }
      return loweringError([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD",
          message: "Stream for-loop lowering is not implemented in the core Proof MIR builder.",
          functionInstanceId: input.context.functionInstanceId,
          ownerKey: `extension:streamLoop`,
          rootCauseKey: "streamLoop",
          stableDetail: `origin:${String(origin)}`,
          sourceOrigin: input.monoStatement.sourceOrigin,
        }),
      ]);
    }
    case "error":
      return loweringError([
        proofMirDiagnostic({
          severity: "error",
          code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
          message: "Proof MIR cannot lower a recovered for-loop iteration.",
          functionInstanceId: input.context.functionInstanceId,
          ownerKey: `function:${String(input.context.functionInstanceId)}`,
          rootCauseKey: "for-iteration",
          stableDetail: "error",
          sourceOrigin: input.monoStatement.sourceOrigin,
        }),
      ]);
    case "ordinary": {
      const iteratorMetadata =
        input.iteratorMetadata ??
        resolveIteratorLoweringMetadataFromProofMetadata({
          context: input.context,
        });
      if (iteratorMetadata === undefined) {
        return loweringError([
          proofMirDiagnostic({
            severity: "error",
            code: "PROOF_MIR_UNLOWERABLE_MONO_STATEMENT",
            message: "Proof MIR iterator lowering requires iterator metadata.",
            functionInstanceId: input.context.functionInstanceId,
            ownerKey: `function:${String(input.context.functionInstanceId)}`,
            rootCauseKey: "iterator-metadata",
            stableDetail: "missing",
            sourceOrigin: input.monoStatement.sourceOrigin,
          }),
        ]);
      }
      const lowered = lowerOrdinaryForStatement({
        context: input.context,
        monoStatement: input.monoStatement,
        forStatement: input.forStatement,
        blockKey: input.blockKey,
        continuationBlockKey: input.continuationBlockKey,
        shared: input.shared,
        call: input.call,
        callRecorder: input.callRecorder,
        loopCarriedLocals: input.loopCarriedLocals,
        iteratorMetadata,
        obligationIds: obligationIdsForIterator({
          program: input.context.program,
          iteratorMetadata,
        }),
      });
      if (lowered.kind === "error") {
        return lowered;
      }
      return loweringOk(undefined);
    }
    default: {
      const unreachable: never = input.forStatement.iteration;
      return unreachable;
    }
  }
}

export function createProofMirIteratorLowerer(
  input: CreateProofMirIteratorLowererInput,
): ProofMirIteratorLowerer {
  return {
    lowerFor(forInput: ProofMirForLoweringInput): ProofMirLoweringResult<void> {
      const continuationBlockKey = forInput.context.graph.createBlock({
        role: "continuation",
        scope: forInput.context.graph.block(forInput.blockKey).scopeKey,
        origin: forInput.context.graph.allocateSyntheticOrigin("continuation"),
      });
      forInput.context.ssa.registerBlock(continuationBlockKey);

      const activeLoopRef: { frame?: ActiveLoopFrame } = {};
      const shared = withLoopIfStatementLowering({
        scopeRoleByKey: new Map(),
        expression: input.expression,
        statementLowerer: input.statement,
        terminalLowerer: input.terminal,
        activeLoopRef,
      });

      return lowerForImpl({
        context: forInput.context,
        forStatement: forInput.statement,
        monoStatement: {
          statementId: monoStatementIdFor(forInput.context.functionInstanceId, hirStatementId(1)),
          kind: { kind: "for", statement: forInput.statement },
          sourceOrigin: "source:stmt:for",
        },
        blockKey: forInput.blockKey,
        shared,
        call: input.call,
        callRecorder: input.callRecorder,
        loopCarriedLocals: [],
        continuationBlockKey,
      });
    },
  };
}
