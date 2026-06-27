import type { HirPlatformContractEdge } from "../hir/hir";
import type { HirPlatformContractEdgeId, HirRequirementId } from "../hir/ids";
import type { FunctionId } from "../semantic/ids";
import type { CertifiedPlatformBinding } from "../semantic/surface/checked-program";
import type { MonoCheckedType } from "./mono-hir";
import { checkedTypeFingerprint } from "../semantic/surface/type-model";
import { instantiatedHirIdKey, type MonoInstanceId } from "./ids";
import type {
  MonoExpressionId,
  MonoInstantiatedProofId,
  MonoPlatformContractEdge,
  MonoPlatformContractEdgeKey,
} from "./mono-hir";
import { monoPlatformContractEdgeKey } from "./mono-hir";

export function buildMonomorphicPlatformEdgeKey(input: {
  readonly callerInstanceId: MonoInstanceId;
  readonly callExpressionId: MonoExpressionId;
  readonly calleeFunctionId: FunctionId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly functionTypeArguments: readonly MonoCheckedType[];
}): MonoPlatformContractEdgeKey {
  return monoPlatformContractEdgeKey(
    [
      `caller:${String(input.callerInstanceId)}`,
      `call:${instantiatedHirIdKey(input.callExpressionId)}`,
      `callee:${String(input.calleeFunctionId).padStart(12, "0")}`,
      `owner:${serializeMonoCheckedTypeList(input.ownerTypeArguments)}`,
      `fn:${serializeMonoCheckedTypeList(input.functionTypeArguments)}`,
    ].join("|"),
  );
}

export function buildMonoPlatformContractEdge(input: {
  readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly hirEdge: HirPlatformContractEdge;
  readonly callExpressionId: MonoExpressionId;
  readonly callerInstanceId: MonoInstanceId;
  readonly calleeFunctionId: FunctionId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly functionTypeArguments: readonly MonoCheckedType[];
  readonly certificate?: CertifiedPlatformBinding["certificate"];
  readonly sourceRequirementIds?: readonly MonoInstantiatedProofId<HirRequirementId>[];
  readonly callOrigin?: string;
}): MonoPlatformContractEdge {
  return {
    edgeId: input.edgeId,
    sourceFunctionId: input.hirEdge.sourceFunctionId,
    primitiveId: input.hirEdge.primitiveId,
    contractId: input.hirEdge.contractId,
    targetId: input.hirEdge.targetId,
    callExpressionId: input.callExpressionId,
    instantiatedOwnerTypeArguments: input.ownerTypeArguments,
    instantiatedFunctionTypeArguments: input.functionTypeArguments,
    monomorphicEdgeKey: buildMonomorphicPlatformEdgeKey({
      callerInstanceId: input.callerInstanceId,
      callExpressionId: input.callExpressionId,
      calleeFunctionId: input.calleeFunctionId,
      ownerTypeArguments: input.ownerTypeArguments,
      functionTypeArguments: input.functionTypeArguments,
    }),
    abi: {
      targetId: input.hirEdge.targetId,
      primitiveId: input.hirEdge.primitiveId,
      contractId: input.hirEdge.contractId,
    },
    ensuredFacts: input.hirEdge.ensuredFacts,
    sourceOrigin: String(input.hirEdge.sourceOrigin),
    ...(input.certificate !== undefined ? { certificate: input.certificate } : {}),
    ...(input.sourceRequirementIds !== undefined
      ? { sourceRequirementIds: input.sourceRequirementIds }
      : {}),
    ...(input.callOrigin !== undefined ? { callOrigin: input.callOrigin } : {}),
  };
}

function serializeMonoCheckedTypeList(types: readonly MonoCheckedType[]): string {
  const parts = types.map((type) => {
    const fingerprint = checkedTypeFingerprint(type);
    return `${fingerprint.length}:${fingerprint}`;
  });
  return `<${parts.join(",")}>`;
}
