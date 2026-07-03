import { resourcePlaceId } from "../../hir/ids";
import { hirResourcePlaceCanonicalKey } from "../../hir/place";
import type {
  MonoFunctionInstance,
  MonoLocal,
  MonoParameter,
  MonoResourcePlace,
} from "../../mono/mono-hir";
import { concreteKind } from "../../semantic/surface/resource-kind";

export function monoParameterPlace(input: {
  readonly functionInstance: MonoFunctionInstance;
  readonly parameter: MonoParameter;
  readonly local: MonoLocal;
}): MonoResourcePlace {
  const functionInstanceId = input.functionInstance.instanceId;
  const root = { kind: "parameter" as const, parameterId: input.parameter.parameterId };
  return {
    placeId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: resourcePlaceId(Number(input.parameter.parameterId)),
      instanceId: functionInstanceId,
    },
    canonicalKey: hirResourcePlaceCanonicalKey({
      owner: { kind: "function", functionId: input.functionInstance.signature.functionId },
      root,
      projection: [],
      type: input.parameter.type,
      resourceKind: concreteKind(input.parameter.resourceKind),
    }),
    root,
    projection: [],
    type: input.parameter.type,
    resourceKind: input.parameter.resourceKind,
    sourceOrigin: input.local.sourceOrigin,
    kind: "parameter",
    parameterId: input.parameter.parameterId,
  };
}

export function monoLocalPlace(input: {
  readonly functionInstance: MonoFunctionInstance;
  readonly local: MonoLocal;
}): MonoResourcePlace {
  const functionInstanceId = input.functionInstance.instanceId;
  const root = { kind: "local" as const, localId: input.local.localId };
  const canonicalRoot = { kind: "local" as const, localId: input.local.localId.hirId };
  return {
    placeId: {
      owner: { kind: "function", instanceId: functionInstanceId },
      hirId: resourcePlaceId(Number(String(input.local.localId.hirId))),
      instanceId: functionInstanceId,
    },
    canonicalKey: hirResourcePlaceCanonicalKey({
      owner: { kind: "function", functionId: input.functionInstance.signature.functionId },
      root: canonicalRoot,
      projection: [],
      type: input.local.type,
      resourceKind: concreteKind(input.local.resourceKind),
    }),
    root,
    projection: [],
    type: input.local.type,
    resourceKind: input.local.resourceKind,
    sourceOrigin: input.local.sourceOrigin,
    kind: "local",
    localId: input.local.localId,
  };
}
