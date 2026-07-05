import type { HirImage, TypedHirProgram } from "../hir/hir";
import type { HirOriginId, HirProofOwner } from "../hir/ids";
import type { FunctionId, ImageId, ItemId, TypeId } from "../semantic/ids";
import type { MonoDiagnostic } from "./diagnostics";
import { monoInstanceId, type MonoInstanceId } from "./ids";
import type { MonoTypeNormalizationContext } from "./instantiation-key";
import type {
  MonoFunctionInstance,
  MonoInstantiationEdge,
  MonomorphizedHirProgram,
  MonoPlatformContractEdge,
  MonoReachableFunction,
  MonoResolvedCallTargetEntry,
  MonoTypeInstance,
  MonoValidatedBuffer,
} from "./mono-hir";
import type { MonoTypeAncestry } from "./type-instantiator";
import { monoTypeAncestry } from "./type-instantiator";

export interface ReachabilityResult {
  readonly program: MonomorphizedHirProgram;
  readonly reachablePlatformPrimitiveIds: readonly import("../semantic/ids").PlatformPrimitiveId[];
  readonly diagnostics: readonly MonoDiagnostic[];
}

export type WorkState = "unseen" | "inProgress" | "completed" | "failed";

export interface ReachabilityState {
  readonly program: TypedHirProgram;
  readonly image: HirImage;
  readonly imageInstanceId: MonoInstanceId;
  readonly imageItemId: ItemId;
  readonly imageSourceOrigin: string;
  readonly imageHirSourceOrigin: HirOriginId;
  readonly diagnostics: MonoDiagnostic[];
  readonly functionInstances: MonoFunctionInstance[];
  readonly functionTableLookup: Map<string, MonoFunctionInstance>;
  readonly typeInstances: MonoTypeInstance[];
  readonly typeTableLookup: Map<string, MonoTypeInstance>;
  readonly validatedBuffers: MonoValidatedBuffer[];
  readonly graphEdges: MonoInstantiationEdge[];
  readonly platformContractEdges: MonoPlatformContractEdge[];
  readonly functionStates: Map<string, WorkState>;
  readonly activeFunctionKeys: Set<string>;
  readonly functionSourceForKey: Map<string, FunctionId>;
  readonly typeStates: Map<string, WorkState>;
  readonly activeTypeKeys: Set<string>;
  readonly typeSourceForKey: Map<string, TypeId>;
  readonly ancestry: MonoTypeAncestry;
  readonly canonicalInstanceKeys: ReadonlyMap<HirProofOwner, string>;
  readonly callResolvedTargets: Map<string, MonoResolvedCallTargetEntry>;
  readonly reachableFunctions: Map<string, MonoReachableFunction>;
}

export function createReachabilityNormalizationContext(
  program: TypedHirProgram,
): MonoTypeNormalizationContext {
  return {
    targetTypeKinds: program.monoClosure.targetTypeKinds,
    constructorKindRules: program.monoClosure.constructorKindRules,
    sourceOrigin: program.origins.originRecords()[0]?.originId ?? (0 as never),
  };
}

export function createReachabilityState(input: {
  readonly program: TypedHirProgram;
  readonly image: HirImage;
}): ReachabilityState {
  const canonicalInstanceKeys = new Map<HirProofOwner, string>();
  canonicalInstanceKeys.set(
    { kind: "image", imageId: input.image.imageId },
    `image:${input.image.imageId}`,
  );
  return {
    program: input.program,
    image: input.image,
    imageInstanceId: canonicalImageInstanceId(input.image.imageId),
    imageItemId: input.image.itemId,
    imageSourceOrigin: String(input.image.sourceOrigin),
    imageHirSourceOrigin: input.image.sourceOrigin,
    diagnostics: [],
    functionInstances: [],
    functionTableLookup: new Map<string, MonoFunctionInstance>(),
    typeInstances: [],
    typeTableLookup: new Map<string, MonoTypeInstance>(),
    validatedBuffers: [],
    graphEdges: [],
    platformContractEdges: [],
    functionStates: new Map<string, WorkState>(),
    activeFunctionKeys: new Set<string>(),
    functionSourceForKey: new Map<string, FunctionId>(),
    typeStates: new Map<string, WorkState>(),
    activeTypeKeys: new Set<string>(),
    typeSourceForKey: new Map<string, TypeId>(),
    ancestry: monoTypeAncestry(),
    canonicalInstanceKeys,
    callResolvedTargets: new Map<string, MonoResolvedCallTargetEntry>(),
    reachableFunctions: new Map<string, MonoReachableFunction>(),
  };
}

export function canonicalImageInstanceId(imageId: ImageId): MonoInstanceId {
  return monoInstanceId(`image:${imageId}`);
}
