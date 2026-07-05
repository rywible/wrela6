import type { FunctionId, TypeId } from "../../semantic/ids";
import type { CertifiedPlatformBinding } from "../../semantic/surface/checked-program";
import { monoDiagnostic } from "../diagnostics";
import {
  instantiateMonoFunctionBody,
  instantiateMonoFunctionShell,
  type MonoOutgoingEdge,
} from "../function-instantiator";
import { type MonoInstanceId } from "../ids";
import { canonicalFunctionInstanceId, canonicalTypeInstanceId } from "../instantiation-key";
import type {
  MonoCheckedType,
  MonoExpressionId,
  MonoFunctionInstance,
  MonoInstantiatedProofId,
  MonoInstantiationEdgeSource,
  MonoProofOwner,
} from "../mono-hir";
import { buildMonoPlatformContractEdge } from "../platform-contract-edge";
import type { MonoRootWorkItem } from "../monomorphizer";
import {
  platformEdgeBindingMismatch,
  platformEnsuredFactMismatch,
} from "../platform-edge-consistency";
import { recordCallResolvedTarget } from "../call-resolved-target-application";
import {
  createReachabilityNormalizationContext,
  type ReachabilityState,
} from "../reachability-shared";
import { instantiateMonoType } from "../type-instantiator";
import {
  collectSourceTypeDiscoveriesFromFunction,
  collectSourceTypeDiscoveriesFromTypeInstance,
  isPolymorphicFunctionRecursionInProgress,
  isPolymorphicTypeRecursionInProgress,
  lookupMonoCallExpression,
  processReferencedSourceTypes,
  recordTypeGraphEdge,
  sortOutgoingEdges,
} from "./state-table";

interface ProcessRootWorkItemInput {
  readonly state: ReachabilityState;
  readonly item: MonoRootWorkItem;
}

export function processRootWorkItem(input: ProcessRootWorkItemInput): void {
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

  if (workState === "failed") {
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
      input.state.functionStates.set(canonicalKey, "failed");
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
    input.state.functionStates.set(canonicalKey, "failed");
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
    input.state.functionStates.set(canonicalKey, "failed");
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

  const callExpression = lookupMonoCallExpression({
    state: input.state,
    callerInstanceId,
    callExpressionId: input.caller.callExpressionId,
  });
  if (callExpression === undefined) {
    input.state.diagnostics.push(
      monoDiagnostic({
        severity: "error",
        code: "MONO_PLATFORM_CONTRACT_EDGE_MISSING",
        message:
          "Reachable call to certified platform function has no resolvable mono call expression.",
        ownerKey: `function:${input.functionId}`,
        rootCauseKey: "platform-edge",
        stableDetail: `missing-call-expression:${input.canonicalKey}`,
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
  const monoEdge = buildMonoPlatformContractEdge({
    edgeId,
    hirEdge: edge,
    callExpressionId: input.caller.callExpressionId,
    callerInstanceId: ownerInstanceId,
    calleeFunctionId: input.functionId,
    ownerTypeArguments: callExpression.call.ownerTypeArguments,
    functionTypeArguments: callExpression.call.typeArguments,
    ...(edge.certificate !== undefined ? { certificate: edge.certificate } : {}),
    ...(sourceRequirementIds !== undefined ? { sourceRequirementIds } : {}),
    ...(edge.callOrigin !== undefined ? { callOrigin: String(edge.callOrigin) } : {}),
  });
  input.state.platformContractEdges.push(monoEdge);
  const resolvedTarget = {
    kind: "certifiedPlatform" as const,
    targetPlatformEdgeId: edgeId,
    primitiveId: edge.primitiveId,
  };
  recordCallResolvedTarget({
    state: input.state,
    callerInstanceId: ownerInstanceId,
    callExpressionId: input.caller.callExpressionId,
    resolvedTarget,
  });
}

interface ProcessTypeWorkItemInput {
  readonly state: ReachabilityState;
  readonly typeId: TypeId;
  readonly typeArguments: readonly MonoCheckedType[];
  readonly source: MonoInstantiationEdgeSource;
  readonly sourceOrigin: string;
}

export function processTypeWorkItem(input: ProcessTypeWorkItemInput): void {
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

  if (workState === "failed") {
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
    input.state.typeStates.set(canonicalKey, "failed");
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
    if (callExpressionId !== undefined) {
      const calleeInstanceId = canonicalFunctionInstanceId({
        functionId: edge.targetFunctionId,
        ...(edge.targetOwnerTypeId !== undefined ? { ownerTypeId: edge.targetOwnerTypeId } : {}),
        ownerTypeArguments: edge.targetOwnerTypeArguments ?? [],
        functionTypeArguments: edge.targetFunctionTypeArguments ?? [],
      });
      recordCallResolvedTarget({
        state: input.state,
        callerInstanceId: input.owner.instanceId,
        callExpressionId,
        resolvedTarget: {
          kind: "sourceFunction",
          targetFunctionInstanceId: calleeInstanceId,
        },
      });
    }
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
