import type { FieldId, FunctionId, TypeId } from "../../semantic/ids";
import type { CheckedType } from "../../semantic/surface/type-model";
import { compareCodeUnitStrings } from "../deterministic-sort";
import type { MonoOutgoingEdge } from "../function-instantiator";
import { instantiatedHirIdKey, type MonoInstanceId } from "../ids";
import {
  canonicalTypeInstanceId,
  normalizeMonoCheckedType,
  type MonoTypeNormalizationContext,
} from "../instantiation-key";
import type {
  MonoCheckedType,
  MonoExpression,
  MonoExpressionId,
  MonoFunctionInstance,
  MonoInstantiationEdgeSource,
  MonoTypeInstance,
} from "../mono-hir";
import type { ReachabilityState } from "../reachability-shared";
import { processTypeWorkItem } from "./work-items";

export function recordTypeGraphEdge(input: {
  readonly state: ReachabilityState;
  readonly source: MonoInstantiationEdgeSource;
  readonly targetInstanceId: MonoInstanceId;
  readonly sourceOrigin: string;
}): void {
  input.state.graphEdges.push({
    source: input.source,
    targetInstanceId: input.targetInstanceId,
    targetKind: "type",
    sourceOrigin: input.sourceOrigin,
  });
}

export interface SourceTypeDiscovery {
  readonly typeId: TypeId;
  readonly typeArguments: readonly MonoCheckedType[];
  readonly sourceOrigin: string;
  readonly fieldId?: FieldId;
}

export function processReferencedSourceTypes(input: {
  readonly state: ReachabilityState;
  readonly source: MonoInstantiationEdgeSource;
  readonly sourceOrigin: string;
  readonly discoveries: readonly SourceTypeDiscovery[];
}): void {
  const sorted = [...input.discoveries].sort((left, right) =>
    sourceTypeDiscoveryKey(left) < sourceTypeDiscoveryKey(right)
      ? -1
      : sourceTypeDiscoveryKey(left) > sourceTypeDiscoveryKey(right)
        ? 1
        : 0,
  );
  const seen = new Set<string>();
  for (const discovery of sorted) {
    const key = sourceTypeDiscoveryKey(discovery);
    if (seen.has(key)) continue;
    seen.add(key);
    processTypeWorkItem({
      state: input.state,
      typeId: discovery.typeId,
      typeArguments: discovery.typeArguments,
      source:
        input.source.kind === "type" && discovery.fieldId !== undefined
          ? { ...input.source, fieldId: discovery.fieldId }
          : input.source,
      sourceOrigin: discovery.sourceOrigin || input.sourceOrigin,
    });
  }
}

function sourceTypeDiscoveryKey(discovery: SourceTypeDiscovery): string {
  return String(
    canonicalTypeInstanceId({
      typeId: discovery.typeId,
      typeArguments: discovery.typeArguments,
    }),
  );
}

export function collectSourceTypeDiscoveriesFromFunction(input: {
  readonly instance: MonoFunctionInstance;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly normalizationContext: MonoTypeNormalizationContext;
}): readonly SourceTypeDiscovery[] {
  const { instance } = input;
  const discoveries: SourceTypeDiscovery[] = [];
  if (instance.signature.receiver !== undefined) {
    discoveries.push(
      ...collectSourceTypeDiscoveriesFromCheckedType({
        type: instance.signature.receiver.type,
        sourceOrigin: instance.sourceOrigin,
        ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
        ownerTypeArguments: input.ownerTypeArguments,
        normalizationContext: input.normalizationContext,
      }),
    );
  }
  for (const parameter of instance.signature.parameters) {
    discoveries.push(
      ...collectSourceTypeDiscoveriesFromCheckedType({
        type: parameter.type,
        sourceOrigin: instance.sourceOrigin,
        ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
        ownerTypeArguments: input.ownerTypeArguments,
        normalizationContext: input.normalizationContext,
      }),
    );
  }
  discoveries.push(
    ...collectSourceTypeDiscoveriesFromCheckedType({
      type: instance.signature.returnType,
      sourceOrigin: instance.sourceOrigin,
      ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
      ownerTypeArguments: input.ownerTypeArguments,
      normalizationContext: input.normalizationContext,
    }),
  );
  for (const local of instance.locals.entries()) {
    discoveries.push(
      ...collectSourceTypeDiscoveriesFromCheckedType({
        type: local.type,
        sourceOrigin: local.sourceOrigin,
        ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
        ownerTypeArguments: input.ownerTypeArguments,
        normalizationContext: input.normalizationContext,
      }),
    );
  }
  for (const expression of instance.bodyIndex?.expressions.entries() ?? []) {
    discoveries.push(
      ...collectSourceTypeDiscoveriesFromCheckedType({
        type: expression.type,
        sourceOrigin: expression.sourceOrigin,
        ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
        ownerTypeArguments: input.ownerTypeArguments,
        normalizationContext: input.normalizationContext,
      }),
    );
    if (expression.place !== undefined) {
      discoveries.push(
        ...collectSourceTypeDiscoveriesFromCheckedType({
          type: expression.place.type,
          sourceOrigin: expression.place.sourceOrigin,
          ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
          ownerTypeArguments: input.ownerTypeArguments,
          normalizationContext: input.normalizationContext,
        }),
      );
    }
  }
  return discoveries;
}

export function collectSourceTypeDiscoveriesFromTypeInstance(input: {
  readonly instance: MonoTypeInstance;
  readonly normalizationContext: MonoTypeNormalizationContext;
}): readonly SourceTypeDiscovery[] {
  const discoveries: SourceTypeDiscovery[] = [];
  for (const field of input.instance.fields) {
    discoveries.push(
      ...collectSourceTypeDiscoveriesFromCheckedType({
        type: field.type,
        sourceOrigin: field.sourceOrigin,
        fieldId: field.fieldId,
        normalizationContext: input.normalizationContext,
      }),
    );
  }
  return discoveries;
}

function collectSourceTypeDiscoveriesFromCheckedType(input: {
  readonly type: CheckedType;
  readonly sourceOrigin: string;
  readonly fieldId?: FieldId;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments?: readonly MonoCheckedType[];
  readonly normalizationContext: MonoTypeNormalizationContext;
}): readonly SourceTypeDiscovery[] {
  const discoveries: SourceTypeDiscovery[] = [];
  switch (input.type.kind) {
    case "source":
      discoveries.push({
        typeId: input.type.typeId,
        typeArguments:
          input.ownerTypeId !== undefined && input.type.typeId === input.ownerTypeId
            ? (input.ownerTypeArguments ?? [])
            : [],
        sourceOrigin: input.sourceOrigin,
        ...(input.fieldId !== undefined ? { fieldId: input.fieldId } : {}),
      });
      return discoveries;
    case "applied": {
      for (const argument of input.type.arguments) {
        discoveries.push(
          ...collectSourceTypeDiscoveriesFromCheckedType({
            type: argument,
            sourceOrigin: input.sourceOrigin,
            ...(input.fieldId !== undefined ? { fieldId: input.fieldId } : {}),
            ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
            ...(input.ownerTypeArguments !== undefined
              ? { ownerTypeArguments: input.ownerTypeArguments }
              : {}),
            normalizationContext: input.normalizationContext,
          }),
        );
      }
      if (input.type.constructor.kind !== "source") return discoveries;
      const normalizedArguments: MonoCheckedType[] = [];
      for (const argument of input.type.arguments) {
        const normalized = normalizeMonoCheckedType(argument, input.normalizationContext);
        if (normalized.kind === "ok") {
          normalizedArguments.push(normalized.type);
        }
      }
      discoveries.push({
        typeId: input.type.constructor.typeId,
        typeArguments: normalizedArguments,
        sourceOrigin: input.sourceOrigin,
        ...(input.fieldId !== undefined ? { fieldId: input.fieldId } : {}),
      });
      return discoveries;
    }
    case "core":
    case "target":
    case "genericParameter":
    case "error":
      return discoveries;
  }
}

export function isPolymorphicFunctionRecursionInProgress(
  state: ReachabilityState,
  functionId: FunctionId,
  canonicalKey: string,
): boolean {
  for (const activeKey of state.activeFunctionKeys) {
    if (activeKey === canonicalKey) continue;
    if (state.functionSourceForKey.get(activeKey) === functionId) {
      return true;
    }
  }
  return false;
}

export function isPolymorphicTypeRecursionInProgress(
  state: ReachabilityState,
  typeId: TypeId,
  canonicalKey: string,
): boolean {
  for (const activeKey of state.activeTypeKeys) {
    if (activeKey === canonicalKey) continue;
    if (state.typeSourceForKey.get(activeKey) === typeId) {
      return true;
    }
  }
  return false;
}

export function sortOutgoingEdges(edges: readonly MonoOutgoingEdge[]): readonly MonoOutgoingEdge[] {
  return [...edges].sort((left, right) =>
    compareCodeUnitStrings(outgoingEdgeSortKey(left), outgoingEdgeSortKey(right)),
  );
}

function outgoingEdgeSortKey(edge: MonoOutgoingEdge): string {
  return [
    edge.targetKey,
    edge.targetKind,
    edge.targetFunctionId === undefined ? "" : String(edge.targetFunctionId).padStart(12, "0"),
    edge.targetOwnerTypeId === undefined ? "" : String(edge.targetOwnerTypeId).padStart(12, "0"),
    edge.callExpressionId === undefined ? "" : instantiatedHirIdKey(edge.callExpressionId),
    edge.sourceOrigin,
  ].join("|");
}

export function lookupMonoCallExpression(input: {
  readonly state: ReachabilityState;
  readonly callerInstanceId: MonoInstanceId;
  readonly callExpressionId: MonoExpressionId;
}): Extract<MonoExpression["kind"], { readonly kind: "call" }> | undefined {
  const callerKey = String(input.callerInstanceId);
  if (input.state.functionStates.get(callerKey) === "failed") return undefined;
  const caller = input.state.functionTableLookup.get(callerKey);
  const expression = caller?.bodyIndex?.expressions.get(input.callExpressionId);
  if (expression?.kind.kind !== "call") return undefined;
  return expression.kind;
}
