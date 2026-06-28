import type { HirImage, HirImageDevice, HirResourcePlace } from "../hir/hir";
import { hirTable } from "../hir/hir-table";
import type { PlatformPrimitiveId } from "../semantic/ids";
import type { CheckedType } from "../semantic/surface/type-model";
import { compareCodeUnitStrings } from "./deterministic-sort";
import type { MonoDiagnostic } from "./diagnostics";
import { sortMonoDiagnostics } from "./diagnostics";
import { instantiatedHirIdKey, type MonoInstanceId } from "./ids";
import { canonicalFunctionInstanceId, normalizeMonoCheckedType } from "./instantiation-key";
import type {
  MonoCheckedType,
  MonoDeterministicTable,
  MonoFunctionInstance,
  MonoFunctionTable,
  MonoImage,
  MonoImageDevice,
  MonoInstantiationEdge,
  MonomorphizedHirProgram,
  MonoPlaceProjection,
  MonoPlaceRoot,
  MonoProofMetadata,
  MonoProofOwner,
  MonoResourcePlace,
  MonoTypeInstance,
  MonoTypeTable,
  MonoValidatedBuffer,
  MonoValidatedBufferTable,
} from "./mono-hir";
import { collectReachablePlatformPrimitiveIds } from "./platform-primitives";
import { instantiateMonoProofMetadata } from "./proof-metadata-instantiator";
import { buildMonoExternalRoots } from "./mono-external-roots";
import { buildMonoResolvedCallTargetTable } from "./resolved-call-targets";
import { finalizeMonoReachableFunctionTable } from "./reachable-functions";
import { buildMonoTable, proofMetadataIdKey } from "./proof-metadata-tables";
import {
  createReachabilityNormalizationContext,
  type ReachabilityResult,
  type ReachabilityState,
} from "./reachability-shared";
import {
  concretizeResourceKind,
  type MonoResourceKindConcretizationContext,
} from "./resource-kind-concretizer";
import type { MonoSubstitution } from "./substitution";
import { monoTypeAncestry, recursiveFieldKindProvider } from "./type-instantiator";

export function finalizeReachability(state: ReachabilityState): ReachabilityResult {
  const sortedFunctions = sortFunctionInstances(state.functionInstances);
  const resolvedCallTargets = buildMonoResolvedCallTargetTable(state);
  const sortedTypes = sortTypeInstances(state.typeInstances);
  const entryInstanceId = entryFunctionInstanceIdFor({ state, image: state.image });
  const sortedEdges = sortInstantiationEdges(state.graphEdges);
  const imageDevices = instantiateImageDevices(state);
  const imageRecord: MonoImage = {
    instanceId: state.imageInstanceId,
    imageId: state.image.imageId,
    itemId: state.imageItemId,
    ...(entryInstanceId !== undefined ? { entryFunctionInstanceId: entryInstanceId } : {}),
    devices: imageDevices,
    sourceOrigin: state.imageSourceOrigin,
  };
  const proofMetadataResult = instantiateMonoProofMetadata({
    program: state.program,
    functionInstances: sortedFunctions,
    typeInstances: sortedTypes,
    imageInstanceId: state.imageInstanceId,
    source: { kind: "image", imageId: state.image.imageId },
    canonicalInstanceKeys: state.canonicalInstanceKeys,
  });
  if (proofMetadataResult.kind === "error") {
    state.diagnostics.push(...proofMetadataResult.diagnostics);
  }
  const baseProofMetadata =
    proofMetadataResult.kind === "ok"
      ? proofMetadataResult.proofMetadata
      : emptyMonoProofMetadata();
  const proofMetadata: MonoProofMetadata = {
    ...baseProofMetadata,
    platformContractEdges: buildMonoTable(
      state.platformContractEdges,
      (entry) => proofMetadataIdKey(entry.edgeId),
      (id) => proofMetadataIdKey(id),
    ),
  };
  const externalRoots = buildMonoExternalRoots({
    program: state.program,
    functionTableLookup: state.functionTableLookup,
    diagnostics: state.diagnostics,
  });
  const reachableFunctions = finalizeMonoReachableFunctionTable({
    state,
    externalRoots,
    functions: sortedFunctions,
  });
  const programWithoutPrimitiveIds: MonomorphizedHirProgram = {
    image: imageRecord,
    externalRoots,
    reachableFunctions,
    functions: buildMonoFunctionTable(sortedFunctions),
    types: buildMonoTypeTable(sortedTypes),
    validatedBuffers: buildMonoValidatedBufferTable(state.validatedBuffers),
    proofMetadata,
    instantiationGraph: { edges: sortedEdges },
    origins: state.program.origins,
    resolvedCallTargets,
    reachablePlatformPrimitiveIds: [],
  };
  const reachablePlatformPrimitiveIds = collectReachablePlatformPrimitiveIds(
    programWithoutPrimitiveIds,
  );
  const program: MonomorphizedHirProgram = {
    ...programWithoutPrimitiveIds,
    reachablePlatformPrimitiveIds,
  };
  assertReachablePlatformPrimitiveIdsConsistent({
    program,
    reachablePlatformPrimitiveIds,
  });
  return {
    program,
    reachablePlatformPrimitiveIds,
    diagnostics: sortMonoDiagnostics(state.diagnostics),
  };
}

function instantiateImageDevices(state: ReachabilityState): readonly MonoImageDevice[] {
  const devices: MonoImageDevice[] = [];
  const sortedDevices = [...state.image.devices].sort((left, right) =>
    imageDeviceKey(left) < imageDeviceKey(right)
      ? -1
      : imageDeviceKey(left) > imageDeviceKey(right)
        ? 1
        : 0,
  );
  for (const device of sortedDevices) {
    const result = instantiateImageDevice({ state, device });
    if (result.kind === "ok") {
      devices.push(result.device);
      continue;
    }
    state.diagnostics.push(...result.diagnostics);
  }
  return devices;
}

function imageDeviceKey(device: HirImageDevice): string {
  return `${String(device.fieldId)}:${String(device.deviceSurfaceId)}`;
}

function instantiateImageDevice(input: {
  readonly state: ReachabilityState;
  readonly device: HirImageDevice;
}):
  | { readonly kind: "ok"; readonly device: MonoImageDevice }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] } {
  const diagnostics: MonoDiagnostic[] = [];
  const place = instantiateImageResourcePlace({
    state: input.state,
    place: input.device.place,
    diagnostics,
  });
  const rootPlaces: MonoResourcePlace[] = [];
  for (const rootPlace of input.device.rootPlaces) {
    const result = instantiateImageResourcePlace({
      state: input.state,
      place: rootPlace,
      diagnostics,
    });
    if (result !== undefined) {
      rootPlaces.push(result);
    }
  }
  if (place === undefined || diagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }
  const owner: MonoProofOwner = { kind: "image", instanceId: input.state.imageInstanceId };
  return {
    kind: "ok",
    device: {
      fieldId: input.device.fieldId,
      deviceSurfaceId: input.device.deviceSurfaceId,
      place,
      rootPlaces,
      brandIds: input.device.brandIds.map((brandId) => ({
        owner,
        hirId: brandId.id,
        instanceId: input.state.imageInstanceId,
      })),
      sourceOrigin: String(input.device.sourceOrigin),
    },
  };
}

function instantiateImageResourcePlace(input: {
  readonly state: ReachabilityState;
  readonly place: HirResourcePlace;
  readonly diagnostics: MonoDiagnostic[];
}): MonoResourcePlace | undefined {
  const normalized = normalizeMonoCheckedType(
    input.place.type,
    createReachabilityNormalizationContext(input.state.program),
  );
  if (normalized.kind === "error") {
    input.diagnostics.push(...normalized.diagnostics);
    return undefined;
  }
  const context = imageResourceKindContext(input.state);
  const kindResult = concretizeResourceKind({
    kind: input.place.resourceKind,
    ...(normalized.type.kind === "applied" ? { appliedType: normalized.type } : {}),
    ...(input.place.type.kind === "target" ? { targetTypeId: input.place.type.targetTypeId } : {}),
    context,
  });
  if (kindResult.kind === "error") {
    input.diagnostics.push(kindResult.diagnostic);
    return undefined;
  }
  const owner: MonoProofOwner = { kind: "image", instanceId: input.state.imageInstanceId };
  return {
    placeId: {
      owner,
      hirId: input.place.placeId.id,
      instanceId: input.state.imageInstanceId,
    },
    canonicalKey: input.place.canonicalKey,
    root: instantiateImagePlaceRoot(input.place.root, input.state.imageInstanceId),
    projection: input.place.projection.map(instantiateImagePlaceProjection),
    type: normalized.type,
    resourceKind: kindResult.value,
    sourceOrigin: String(input.place.sourceOrigin),
    kind: input.place.kind,
    ...(input.place.parameterId !== undefined ? { parameterId: input.place.parameterId } : {}),
    ...(input.place.fieldId !== undefined ? { fieldId: input.place.fieldId } : {}),
  };
}

function instantiateImagePlaceRoot(
  root: HirResourcePlace["root"],
  imageInstanceId: MonoInstanceId,
): MonoPlaceRoot {
  switch (root.kind) {
    case "receiver":
      return { kind: "receiver", parameterId: root.parameterId };
    case "parameter":
      return { kind: "parameter", parameterId: root.parameterId };
    case "temporary":
      return { kind: "temporary", ordinal: root.ordinal };
    case "imageDevice":
      return { kind: "imageDevice", imageId: root.imageId, fieldId: root.fieldId };
    case "validationPayload":
      return {
        kind: "validationPayload",
        validationId: {
          owner: { kind: "image", instanceId: imageInstanceId },
          hirId: root.validationId.id,
          instanceId: imageInstanceId,
        },
      };
    case "local":
    case "error":
      return { kind: "error" };
  }
}

function instantiateImagePlaceProjection(
  projection: HirResourcePlace["projection"][number],
): MonoPlaceProjection {
  switch (projection.kind) {
    case "field":
      return { kind: "field", fieldId: projection.fieldId };
    case "deref":
      return { kind: "deref" };
    case "variant":
      return { kind: "variant", name: projection.name };
  }
}

function imageResourceKindContext(state: ReachabilityState): MonoResourceKindConcretizationContext {
  const substitution: MonoSubstitution = { map: new Map(), sourceOrigin: state.image.sourceOrigin };
  return {
    program: state.program,
    substitution,
    fieldKindProvider: recursiveFieldKindProvider({
      program: state.program,
      source: { kind: "image", imageId: state.image.imageId },
      ancestry: monoTypeAncestry(),
    }),
    canonicalInstanceKey: String(state.imageInstanceId),
  };
}

function assertReachablePlatformPrimitiveIdsConsistent(input: {
  readonly program: MonomorphizedHirProgram;
  readonly reachablePlatformPrimitiveIds: readonly PlatformPrimitiveId[];
}): void {
  const fromEdges = collectReachablePlatformPrimitiveIds(input.program);
  if (fromEdges.length !== input.reachablePlatformPrimitiveIds.length) {
    throw new Error(
      `reachablePlatformPrimitiveIds length mismatch: ${fromEdges.length} vs ${input.reachablePlatformPrimitiveIds.length}`,
    );
  }
  for (let index = 0; index < fromEdges.length; index += 1) {
    if (fromEdges[index] !== input.reachablePlatformPrimitiveIds[index]) {
      throw new Error(
        `reachablePlatformPrimitiveIds mismatch at ${index}: ${String(fromEdges[index])} vs ${String(input.reachablePlatformPrimitiveIds[index])}`,
      );
    }
  }
}

function sortFunctionInstances(
  entries: readonly MonoFunctionInstance[],
): readonly MonoFunctionInstance[] {
  return [...entries].sort((left, right) =>
    String(left.instanceId) < String(right.instanceId)
      ? -1
      : String(left.instanceId) > String(right.instanceId)
        ? 1
        : 0,
  );
}

function sortTypeInstances(entries: readonly MonoTypeInstance[]): readonly MonoTypeInstance[] {
  return [...entries].sort((left, right) =>
    String(left.instanceId) < String(right.instanceId)
      ? -1
      : String(left.instanceId) > String(right.instanceId)
        ? 1
        : 0,
  );
}

function sortInstantiationEdges(
  edges: readonly MonoInstantiationEdge[],
): readonly MonoInstantiationEdge[] {
  return [...edges].sort((left, right) =>
    compareCodeUnitStrings(instantiationEdgeSortKey(left), instantiationEdgeSortKey(right)),
  );
}

function instantiationEdgeSortKey(edge: MonoInstantiationEdge): string {
  return [
    edgeSourceKey(edge),
    edge.targetKind,
    String(edge.targetInstanceId),
    edge.sourceOrigin,
  ].join("|");
}

function edgeSourceKey(edge: MonoInstantiationEdge): string {
  switch (edge.source.kind) {
    case "image":
      return `image:${String(edge.source.imageId).padStart(12, "0")}`;
    case "function":
      return [
        "function",
        String(edge.source.instanceId),
        edge.source.callExpressionId === undefined
          ? ""
          : instantiatedHirIdKey(edge.source.callExpressionId),
      ].join(":");
    case "type":
      return [
        "type",
        String(edge.source.instanceId),
        edge.source.fieldId === undefined ? "" : String(edge.source.fieldId).padStart(12, "0"),
      ].join(":");
  }
}

function entryFunctionInstanceIdFor(input: {
  readonly state: ReachabilityState;
  readonly image: HirImage;
}): MonoInstanceId | undefined {
  if (input.image.entryFunctionId === undefined) return undefined;
  const imageEntryRoot = input.state.program.monoClosure.externalEntryRoots.find(
    (root) => root.reason === "imageEntry" && root.functionId === input.image.entryFunctionId,
  );
  const ownerTypeArguments =
    imageEntryRoot !== undefined
      ? normalizeEntryRootArguments({
          state: input.state,
          arguments: imageEntryRoot.ownerTypeArguments,
        })
      : [];
  const functionTypeArguments =
    imageEntryRoot !== undefined
      ? normalizeEntryRootArguments({
          state: input.state,
          arguments: imageEntryRoot.functionTypeArguments,
        })
      : [];
  if (ownerTypeArguments === undefined || functionTypeArguments === undefined) return undefined;
  const sourceFunction = input.state.program.functions.get(input.image.entryFunctionId);
  const ownerTypeId = sourceFunction?.ownerTypeId;
  const key = canonicalFunctionInstanceId({
    functionId: input.image.entryFunctionId,
    ...(ownerTypeId !== undefined ? { ownerTypeId } : {}),
    ownerTypeArguments,
    functionTypeArguments,
  });
  const instance = input.state.functionTableLookup.get(String(key));
  return instance?.instanceId;
}

function normalizeEntryRootArguments(input: {
  readonly state: ReachabilityState;
  readonly arguments: readonly CheckedType[];
}): readonly MonoCheckedType[] | undefined {
  const normalizedArguments: MonoCheckedType[] = [];
  const normalizationContext = createReachabilityNormalizationContext(input.state.program);
  for (const argument of input.arguments) {
    const normalized = normalizeMonoCheckedType(argument, normalizationContext);
    if (normalized.kind === "error") return undefined;
    normalizedArguments.push(normalized.type);
  }
  return normalizedArguments;
}

function buildMonoFunctionTable(entries: readonly MonoFunctionInstance[]): MonoFunctionTable {
  return hirTable<MonoInstanceId, MonoFunctionInstance>({
    entries,
    keyOf: (entry) => String(entry.instanceId),
    lookupKeyOf: (id) => String(id),
  });
}

function buildMonoTypeTable(entries: readonly MonoTypeInstance[]): MonoTypeTable {
  return hirTable<MonoInstanceId, MonoTypeInstance>({
    entries,
    keyOf: (entry) => String(entry.instanceId),
    lookupKeyOf: (id) => String(id),
  });
}

function buildMonoValidatedBufferTable(
  entries: readonly MonoValidatedBuffer[],
): MonoValidatedBufferTable {
  return hirTable<MonoInstanceId, MonoValidatedBuffer>({
    entries,
    keyOf: (entry) => String(entry.instanceId),
    lookupKeyOf: (id) => String(id),
  });
}

function emptyMonoProofMetadata(): MonoProofMetadata {
  return {
    obligations: emptyTable(),
    sessions: emptyTable(),
    brands: emptyTable(),
    resourcePlaces: emptyTable(),
    callSiteRequirements: emptyTable(),
    validations: emptyTable(),
    attempts: emptyTable(),
    terminalCalls: emptyTable(),
    privateStateTransitions: emptyTable(),
    factOrigins: emptyTable(),
    platformContractEdges: emptyTable(),
    imageOrigins: emptyTable(),
  };
}

function emptyTable<Key, Value>(): MonoDeterministicTable<Key, Value> {
  return {
    get: () => undefined,
    entries: () => [],
  };
}
