import type { HirImage, TypedHirProgram } from "../hir/hir";
import type { FieldId, FunctionId, TypeId } from "../semantic/ids";
import type { CertifiedPlatformBinding } from "../semantic/surface/checked-program";
import type { CheckedType } from "../semantic/surface/type-model";
import { compareCodeUnitStrings } from "./deterministic-sort";
import { monoDiagnostic } from "./diagnostics";
import {
  instantiateMonoFunctionBody,
  instantiateMonoFunctionShell,
  type MonoOutgoingEdge,
} from "./function-instantiator";
import { instantiatedHirIdKey, type MonoInstanceId } from "./ids";
import {
  canonicalFunctionInstanceId,
  canonicalTypeInstanceId,
  normalizeMonoCheckedType,
  type MonoTypeNormalizationContext,
} from "./instantiation-key";
import type {
  MonoCheckedType,
  MonoExpressionId,
  MonoFunctionInstance,
  MonoInstantiatedProofId,
  MonoInstantiationEdgeSource,
  MonoPlatformContractEdge,
  MonoProofOwner,
  MonoTypeInstance,
} from "./mono-hir";
import { seedMonoRootWorkResult, type MonoRootWorkItem } from "./monomorphizer";
import {
  platformEdgeBindingMismatch,
  platformEnsuredFactMismatch,
} from "./platform-edge-consistency";
import { finalizeReachability } from "./reachability-finalization";
import { validateInstantiationGraphForCycles } from "./reachability-graph";
import {
  createReachabilityNormalizationContext,
  createReachabilityState,
  type ReachabilityResult,
  type ReachabilityState,
} from "./reachability-shared";
import { instantiateMonoType } from "./type-instantiator";

export type { ReachabilityResult } from "./reachability-shared";

export function runReachability(input: {
  readonly program: TypedHirProgram;
  readonly image: HirImage;
}): ReachabilityResult {
  const state = createReachabilityState({ program: input.program, image: input.image });
  const seedResult = seedMonoRootWorkResult({ program: input.program, image: input.image });
  state.diagnostics.push(...seedResult.diagnostics);
  for (const item of seedResult.items) {
    processRootWorkItem({ state, item });
  }
  validateInstantiationGraphForCycles(state);
  return finalizeReachability(state);
}

interface ProcessRootWorkItemInput {
  readonly state: ReachabilityState;
  readonly item: MonoRootWorkItem;
}

function processRootWorkItem(input: ProcessRootWorkItemInput): void {
  switch (input.item.kind) {
    case "imageProofMetadata":
      return;
    case "function":
      processFunctionWorkItem({
        state: input.state,
        functionId: input.item.functionId,
        ...(input.item.ownerTypeId !== undefined ? { ownerTypeId: input.item.ownerTypeId } : {}),
        ownerTypeArguments: input.item.ownerTypeArguments,
        functionTypeArguments: input.item.functionTypeArguments,
        caller: { kind: "image", imageId: input.state.image.imageId },
        sourceOrigin: input.state.imageSourceOrigin,
      });
      return;
    case "type":
      processTypeWorkItem({
        state: input.state,
        typeId: input.item.typeId,
        typeArguments: input.item.typeArguments,
        source: { kind: "image", imageId: input.state.image.imageId },
        sourceOrigin: input.state.imageSourceOrigin,
      });
      return;
  }
}

interface ProcessFunctionWorkItemInput {
  readonly state: ReachabilityState;
  readonly functionId: FunctionId;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly functionTypeArguments: readonly MonoCheckedType[];
  readonly caller: MonoInstantiationEdgeSource;
  readonly sourceOrigin: string;
}

function processFunctionWorkItem(input: ProcessFunctionWorkItemInput): void {
  const key = canonicalFunctionInstanceId({
    functionId: input.functionId,
    ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
    ownerTypeArguments: input.ownerTypeArguments,
    functionTypeArguments: input.functionTypeArguments,
  });
  const canonicalKey = String(key);
  const workState = input.state.functionStates.get(canonicalKey) ?? "unseen";
  const platformBinding = input.state.program.monoClosure.certifiedPlatformBindings.get(
    input.functionId,
  );

  if (workState === "inProgress") {
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_RECURSIVE_FUNCTION_CYCLE",
        message: "Recursive function cycle detected.",
        ownerKey: `function:${input.functionId}`,
        rootCauseKey: "recursion",
        stableDetail: `cycle:${canonicalKey}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
    return;
  }

  if (workState === "completed") {
    if (platformBinding !== undefined) {
      processCertifiedPlatformFunctionWorkItem({
        state: input.state,
        functionId: input.functionId,
        canonicalKey,
        instanceId: key,
        caller: input.caller,
        binding: platformBinding,
        sourceOrigin: input.sourceOrigin,
      });
      return;
    }
    input.state.graphEdges.push({
      source: input.caller,
      targetInstanceId: key,
      targetKind: "function",
      sourceOrigin: input.sourceOrigin,
    });
    return;
  }

  if (isPolymorphicFunctionRecursionInProgress(input.state, input.functionId, canonicalKey)) {
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_POLYMORPHIC_RECURSION",
        message: "Polymorphic function recursion is not allowed.",
        ownerKey: `function:${input.functionId}`,
        rootCauseKey: "polymorphic-recursion",
        stableDetail: `poly-cycle:${canonicalKey}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
    return;
  }

  if (platformBinding !== undefined) {
    const shellResult = instantiateMonoFunctionShell({
      program: input.state.program,
      key: {
        functionId: input.functionId,
        ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
        ownerTypeArguments: input.ownerTypeArguments,
        functionTypeArguments: input.functionTypeArguments,
      },
      source: { kind: "image", imageId: input.state.image.imageId },
    });
    if (shellResult.kind === "error") {
      input.state.diagnostics.push(...shellResult.diagnostics);
      input.state.functionStates.set(canonicalKey, "completed");
      return;
    }
    const instance = shellResult.instance;
    input.state.functionInstances.push(instance);
    input.state.functionTableLookup.set(canonicalKey, instance);
    processReferencedSourceTypes({
      state: input.state,
      source: { kind: "function", instanceId: instance.instanceId },
      sourceOrigin: instance.sourceOrigin,
      discoveries: collectSourceTypeDiscoveriesFromFunction({
        instance,
        ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
        ownerTypeArguments: input.ownerTypeArguments,
        normalizationContext: createReachabilityNormalizationContext(input.state.program),
      }),
    });
    if (input.ownerTypeId !== undefined) {
      processTypeWorkItem({
        state: input.state,
        typeId: input.ownerTypeId,
        typeArguments: input.ownerTypeArguments,
        source: { kind: "function", instanceId: instance.instanceId },
        sourceOrigin: instance.sourceOrigin,
      });
    }
    processCertifiedPlatformFunctionWorkItem({
      state: input.state,
      functionId: input.functionId,
      canonicalKey,
      instanceId: key,
      caller: input.caller,
      binding: platformBinding,
      sourceOrigin: input.sourceOrigin,
    });
    return;
  }

  input.state.functionStates.set(canonicalKey, "inProgress");
  input.state.activeFunctionKeys.add(canonicalKey);
  input.state.functionSourceForKey.set(canonicalKey, input.functionId);
  input.state.graphEdges.push({
    source: input.caller,
    targetInstanceId: key,
    targetKind: "function",
    sourceOrigin: input.sourceOrigin,
  });
  const shellResult = instantiateMonoFunctionShell({
    program: input.state.program,
    key: {
      functionId: input.functionId,
      ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
      ownerTypeArguments: input.ownerTypeArguments,
      functionTypeArguments: input.functionTypeArguments,
    },
    source: { kind: "image", imageId: input.state.image.imageId },
  });
  if (shellResult.kind === "error") {
    input.state.diagnostics.push(...shellResult.diagnostics);
    input.state.functionStates.set(canonicalKey, "completed");
    input.state.activeFunctionKeys.delete(canonicalKey);
    return;
  }
  const { instance, substitution, remap } = shellResult;
  const bodyResult = instantiateMonoFunctionBody({
    program: input.state.program,
    instance,
    substitution,
    remap,
    source: { kind: "image", imageId: input.state.image.imageId },
  });
  if (bodyResult.kind === "error") {
    input.state.diagnostics.push(...bodyResult.diagnostics);
    input.state.functionStates.set(canonicalKey, "completed");
    input.state.activeFunctionKeys.delete(canonicalKey);
    return;
  }
  const finalized: MonoFunctionInstance = {
    ...instance,
    body: bodyResult.body,
    bodyIndex: bodyResult.bodyIndex,
  };
  input.state.functionInstances.push(finalized);
  input.state.functionTableLookup.set(canonicalKey, finalized);
  processReferencedSourceTypes({
    state: input.state,
    source: { kind: "function", instanceId: instance.instanceId },
    sourceOrigin: instance.sourceOrigin,
    discoveries: collectSourceTypeDiscoveriesFromFunction({
      instance: finalized,
      ...(input.ownerTypeId !== undefined ? { ownerTypeId: input.ownerTypeId } : {}),
      ownerTypeArguments: input.ownerTypeArguments,
      normalizationContext: createReachabilityNormalizationContext(input.state.program),
    }),
  });
  if (input.ownerTypeId !== undefined) {
    processTypeWorkItem({
      state: input.state,
      typeId: input.ownerTypeId,
      typeArguments: input.ownerTypeArguments,
      source: { kind: "function", instanceId: instance.instanceId },
      sourceOrigin: instance.sourceOrigin,
    });
  }
  processOutgoingFunctionEdges({
    state: input.state,
    owner: instance,
    edges: bodyResult.outgoingEdges,
  });
  input.state.functionStates.set(canonicalKey, "completed");
  input.state.activeFunctionKeys.delete(canonicalKey);
}

interface ProcessCertifiedPlatformFunctionWorkItemInput {
  readonly state: ReachabilityState;
  readonly functionId: FunctionId;
  readonly canonicalKey: string;
  readonly instanceId: MonoInstanceId;
  readonly caller: MonoInstantiationEdgeSource;
  readonly binding: CertifiedPlatformBinding;
  readonly sourceOrigin: string;
}

function processCertifiedPlatformFunctionWorkItem(
  input: ProcessCertifiedPlatformFunctionWorkItemInput,
): void {
  input.state.functionStates.set(input.canonicalKey, "completed");
  input.state.functionSourceForKey.set(input.canonicalKey, input.functionId);
  input.state.graphEdges.push({
    source: input.caller,
    targetInstanceId: input.instanceId,
    targetKind: "function",
    sourceOrigin: input.sourceOrigin,
  });

  if (input.caller.kind === "image") {
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_CERTIFIED_PLATFORM_BINDING_MISSING",
        message:
          "Certified platform function cannot be an external entry root in the v1 monomorphizer.",
        ownerKey: `function:${input.functionId}`,
        rootCauseKey: "platform-binding",
        stableDetail: `entry-root-platform:${input.canonicalKey}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
    return;
  }

  if (input.caller.kind !== "function" || input.caller.callExpressionId === undefined) {
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_PLATFORM_CONTRACT_EDGE_MISSING",
        message:
          "Reachable call to certified platform function has no associated HIR call expression id.",
        ownerKey: `function:${input.functionId}`,
        rootCauseKey: "platform-edge",
        stableDetail: `missing-call-id:${input.canonicalKey}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
    return;
  }

  const callerInstanceId = input.caller.instanceId;
  const callerFunctionId = input.state.functionSourceForKey.get(String(callerInstanceId));
  if (callerFunctionId === undefined) {
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_PLATFORM_CONTRACT_EDGE_MISSING",
        message:
          "Reachable call to certified platform function has no resolvable caller function id.",
        ownerKey: `function:${input.functionId}`,
        rootCauseKey: "platform-edge",
        stableDetail: `missing-caller:${input.canonicalKey}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
    return;
  }

  const lookupKey = {
    owner: { kind: "function" as const, functionId: callerFunctionId },
    callExpressionId: input.caller.callExpressionId.hirId,
    calleeFunctionId: input.functionId,
  };
  const edges = input.state.program.proofMetadata.platformContractEdgesByCall.get(lookupKey);
  if (edges.length === 0) {
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_PLATFORM_CONTRACT_EDGE_MISSING",
        message: "Reachable call to certified platform function has no HIR platform contract edge.",
        ownerKey: `function:${input.functionId}`,
        rootCauseKey: "platform-edge",
        stableDetail: `missing-edge:${input.canonicalKey}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
    return;
  }
  if (edges.length > 1) {
    const edgeIds = edges.map((edge) => String(edge.edgeId.id)).join(",");
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_DUPLICATE_PLATFORM_CONTRACT_EDGE",
        message:
          "Reachable call to certified platform function has multiple HIR platform contract edges.",
        ownerKey: `function:${input.functionId}`,
        rootCauseKey: "platform-edge",
        stableDetail: `duplicate-edges:${input.canonicalKey}:${edgeIds}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
    return;
  }

  const edge = edges[0]!;
  const mismatchReason = platformEdgeBindingMismatch({
    edge,
    binding: input.binding,
  });
  if (mismatchReason !== undefined) {
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_PLATFORM_EDGE_BINDING_MISMATCH",
        message:
          "HIR platform contract edge does not match the certified platform binding for the call.",
        ownerKey: `function:${input.functionId}`,
        rootCauseKey: "platform-edge",
        stableDetail: `binding-mismatch:${input.canonicalKey}:${mismatchReason}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
    return;
  }

  const ensuredFactMismatchReason = platformEnsuredFactMismatch({
    edge,
    binding: input.binding,
  });
  if (ensuredFactMismatchReason !== undefined) {
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_INCONSISTENT_PLATFORM_ENSURED_FACT",
        message:
          "HIR platform contract edge ensured facts do not match the certified platform binding.",
        ownerKey: `function:${input.functionId}`,
        rootCauseKey: "platform-edge",
        stableDetail: `ensured-fact-mismatch:${input.canonicalKey}:${ensuredFactMismatchReason}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
    return;
  }

  const ownerInstanceId = input.caller.instanceId;
  const monoOwner: MonoProofOwner = { kind: "function", instanceId: ownerInstanceId };
  const edgeId: MonoInstantiatedProofId<typeof edge.edgeId.id> = {
    owner: monoOwner,
    hirId: edge.edgeId.id,
    instanceId: ownerInstanceId,
  };
  const sourceRequirementIds = edge.sourceRequirementIds?.map((id) => ({
    owner: monoOwner,
    hirId: id.id,
    instanceId: ownerInstanceId,
  }));
  const monoEdge: MonoPlatformContractEdge = {
    edgeId,
    sourceFunctionId: edge.sourceFunctionId,
    primitiveId: edge.primitiveId,
    contractId: edge.contractId,
    targetId: edge.targetId,
    ...(edge.certificate !== undefined ? { certificate: edge.certificate } : {}),
    ...(sourceRequirementIds !== undefined ? { sourceRequirementIds } : {}),
    ...(edge.callExpressionId !== undefined
      ? { callExpressionId: input.caller.callExpressionId }
      : {}),
    ...(edge.callOrigin !== undefined ? { callOrigin: String(edge.callOrigin) } : {}),
    ensuredFacts: edge.ensuredFacts,
    sourceOrigin: String(edge.sourceOrigin),
  };
  input.state.platformContractEdges.push(monoEdge);
}

interface ProcessTypeWorkItemInput {
  readonly state: ReachabilityState;
  readonly typeId: TypeId;
  readonly typeArguments: readonly MonoCheckedType[];
  readonly source: MonoInstantiationEdgeSource;
  readonly sourceOrigin: string;
}

function processTypeWorkItem(input: ProcessTypeWorkItemInput): void {
  const key = canonicalTypeInstanceId({
    typeId: input.typeId,
    typeArguments: input.typeArguments,
  });
  const canonicalKey = String(key);
  const workState = input.state.typeStates.get(canonicalKey) ?? "unseen";
  recordTypeGraphEdge({
    state: input.state,
    source: input.source,
    targetInstanceId: key,
    sourceOrigin: input.sourceOrigin,
  });

  if (workState === "inProgress") {
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_RECURSIVE_TYPE_CYCLE",
        message: "Recursive source type cycle detected.",
        ownerKey: `type:${input.typeId}`,
        rootCauseKey: "recursion",
        stableDetail: `cycle:${canonicalKey}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
    return;
  }

  if (workState === "completed") {
    return;
  }

  if (isPolymorphicTypeRecursionInProgress(input.state, input.typeId, canonicalKey)) {
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_POLYMORPHIC_RECURSION",
        message: "Polymorphic type recursion is not allowed.",
        ownerKey: `type:${input.typeId}`,
        rootCauseKey: "polymorphic-recursion",
        stableDetail: `poly-cycle:${canonicalKey}`,
        sourceOrigin: input.sourceOrigin,
      }),
    );
    return;
  }

  input.state.typeStates.set(canonicalKey, "inProgress");
  input.state.activeTypeKeys.add(canonicalKey);
  input.state.typeSourceForKey.set(canonicalKey, input.typeId);

  const typeResult = instantiateMonoType({
    program: input.state.program,
    key: { typeId: input.typeId, typeArguments: input.typeArguments },
    source: { kind: "image", imageId: input.state.image.imageId },
    ancestry: input.state.ancestry,
  });
  if (typeResult.kind === "error") {
    input.state.diagnostics.push(...typeResult.diagnostics);
    input.state.typeStates.set(canonicalKey, "completed");
    input.state.activeTypeKeys.delete(canonicalKey);
    return;
  }
  input.state.typeInstances.push(typeResult.instance);
  input.state.typeTableLookup.set(canonicalKey, typeResult.instance);
  if (typeResult.validatedBuffer !== undefined) {
    input.state.validatedBuffers.push(typeResult.validatedBuffer);
  }
  processReferencedSourceTypes({
    state: input.state,
    source: { kind: "type", instanceId: typeResult.instance.instanceId },
    sourceOrigin: typeResult.instance.sourceOrigin,
    discoveries: collectSourceTypeDiscoveriesFromTypeInstance({
      instance: typeResult.instance,
      normalizationContext: createReachabilityNormalizationContext(input.state.program),
    }),
  });
  input.state.typeStates.set(canonicalKey, "completed");
  input.state.activeTypeKeys.delete(canonicalKey);
}

function recordTypeGraphEdge(input: {
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

interface SourceTypeDiscovery {
  readonly typeId: TypeId;
  readonly typeArguments: readonly MonoCheckedType[];
  readonly sourceOrigin: string;
  readonly fieldId?: FieldId;
}

function processReferencedSourceTypes(input: {
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

function collectSourceTypeDiscoveriesFromFunction(input: {
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

function collectSourceTypeDiscoveriesFromTypeInstance(input: {
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

function isPolymorphicFunctionRecursionInProgress(
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

function isPolymorphicTypeRecursionInProgress(
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

interface ProcessOutgoingFunctionEdgesInput {
  readonly state: ReachabilityState;
  readonly owner: MonoFunctionInstance;
  readonly edges: readonly MonoOutgoingEdge[];
}

function processOutgoingFunctionEdges(input: ProcessOutgoingFunctionEdgesInput): void {
  const sorted = sortOutgoingEdges(input.edges);
  for (const edge of sorted) {
    if (edge.targetKind !== "function") {
      continue;
    }
    if (edge.targetFunctionId === undefined) {
      continue;
    }
    const callExpressionId: MonoExpressionId | undefined = edge.callExpressionId;
    const caller: MonoInstantiationEdgeSource =
      callExpressionId !== undefined
        ? {
            kind: "function",
            instanceId: input.owner.instanceId,
            callExpressionId,
          }
        : { kind: "function", instanceId: input.owner.instanceId };
    processFunctionWorkItem({
      state: input.state,
      functionId: edge.targetFunctionId,
      ...(edge.targetOwnerTypeId !== undefined ? { ownerTypeId: edge.targetOwnerTypeId } : {}),
      ownerTypeArguments: edge.targetOwnerTypeArguments ?? [],
      functionTypeArguments: edge.targetFunctionTypeArguments ?? [],
      caller,
      sourceOrigin: edge.sourceOrigin,
    });
  }
}

function sortOutgoingEdges(edges: readonly MonoOutgoingEdge[]): readonly MonoOutgoingEdge[] {
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
