import type { HirExpressionId, HirLocalId, HirRequirementId, HirStatementId } from "../hir/ids";
import type { MonoDiagnostic } from "./diagnostics";
import type { MonoOutgoingEdge } from "./function-instantiator-body";
import { instantiatedHirId, type MonoInstanceId } from "./ids";
import type {
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoLocalId,
  MonoProofExpressionId,
  MonoStatementId,
} from "./mono-hir";
import type { MonoFunctionRemap } from "./function-instantiator-shell";
import type { MonoResourceKindConcretizationContext } from "./resource-kind-concretizer";

export interface MutableMonoFunctionRemap {
  readonly instanceId: MonoInstanceId;
  readonly localRemap: Map<HirLocalId, MonoLocalId>;
  readonly expressionRemap: Map<HirExpressionId, MonoExpressionId>;
  readonly statementRemap: Map<HirStatementId, MonoStatementId>;
  readonly requirementIdRemap: Map<HirRequirementId, MonoInstantiatedProofId<HirRequirementId>>;
  readonly proofExpressionIdRemap: Map<number, MonoProofExpressionId>;
}

export interface MonoTransformContext {
  readonly remap: MutableMonoFunctionRemap;
  readonly resourceKinds: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}

export function monoLocalIdFor(instanceId: MonoInstanceId, hirLocalId: HirLocalId): MonoLocalId {
  return instantiatedHirId(instanceId, hirLocalId);
}

export function monoExpressionIdFor(
  instanceId: MonoInstanceId,
  hirExpressionId: HirExpressionId,
): MonoExpressionId {
  return instantiatedHirId(instanceId, hirExpressionId);
}

export function monoStatementIdFor(
  instanceId: MonoInstanceId,
  hirStatementId: HirStatementId,
): MonoStatementId {
  return instantiatedHirId(instanceId, hirStatementId);
}

export function createMonoTransformContext(input: {
  readonly remap: MonoFunctionRemap;
  readonly resourceKinds: MonoResourceKindConcretizationContext;
  readonly outgoingEdges?: MonoOutgoingEdge[];
  readonly diagnostics?: MonoDiagnostic[];
}): MonoTransformContext {
  return {
    remap: mutableRemapFrom(input.remap),
    resourceKinds: input.resourceKinds,
    outgoingEdges: input.outgoingEdges ?? [],
    diagnostics: input.diagnostics ?? [],
  };
}

export function monoTransformRemap(context: MonoTransformContext): MonoFunctionRemap {
  return immutableRemapFrom(context.remap);
}

export interface LegacyMonoCloneState {
  readonly remap: MutableMonoFunctionRemap;
  readonly resourceKinds: MonoResourceKindConcretizationContext;
  readonly outgoingEdges: MonoOutgoingEdge[];
  readonly diagnostics: MonoDiagnostic[];
}

export function monoTransformContextFromLegacyCloneState(
  input: LegacyMonoCloneState,
): MonoTransformContext {
  return {
    remap: input.remap,
    resourceKinds: input.resourceKinds,
    outgoingEdges: input.outgoingEdges,
    diagnostics: input.diagnostics,
  };
}

export function monoTransformLocalId(
  context: MonoTransformContext,
  sourceId: HirLocalId,
): MonoLocalId {
  const id = monoLocalIdFor(context.remap.instanceId, sourceId);
  context.remap.localRemap.set(sourceId, id);
  return id;
}

export function monoTransformExpressionId(
  context: MonoTransformContext,
  sourceId: HirExpressionId,
): MonoExpressionId {
  const id = monoExpressionIdFor(context.remap.instanceId, sourceId);
  context.remap.expressionRemap.set(sourceId, id);
  return id;
}

export function monoTransformStatementId(
  context: MonoTransformContext,
  sourceId: HirStatementId,
): MonoStatementId {
  const id = monoStatementIdFor(context.remap.instanceId, sourceId);
  context.remap.statementRemap.set(sourceId, id);
  return id;
}

export function mutableRemapFrom(remap: MonoFunctionRemap): MutableMonoFunctionRemap {
  return {
    instanceId: remap.instanceId,
    localRemap: new Map(remap.localRemap),
    expressionRemap: new Map(remap.expressionRemap),
    statementRemap: new Map(remap.statementRemap),
    requirementIdRemap: new Map(remap.requirementIdRemap),
    proofExpressionIdRemap: new Map(remap.proofExpressionIdRemap),
  };
}

export function immutableRemapFrom(remap: MutableMonoFunctionRemap): MonoFunctionRemap {
  return {
    instanceId: remap.instanceId,
    localRemap: new Map(remap.localRemap),
    expressionRemap: new Map(remap.expressionRemap),
    statementRemap: new Map(remap.statementRemap),
    requirementIdRemap: new Map(remap.requirementIdRemap),
    proofExpressionIdRemap: new Map(remap.proofExpressionIdRemap),
  };
}
