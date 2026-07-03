import type { ValidationId } from "../../hir/ids";
import type { MonoInstanceId } from "../../mono/ids";
import type {
  MonoInstantiatedProofId,
  MonoLocal,
  MonoResourcePlace,
  MonoValidation,
  MonomorphizedHirProgram,
} from "../../mono/mono-hir";
import type { TypeId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { DraftProofMirLayoutTermReference } from "../draft/draft-layout-term-reference";
import {
  proofMirOriginId,
  proofMirPlaceId,
  proofMirStatementId,
  proofMirValueId,
  type ProofMirOriginId,
  type ProofMirPlaceId,
  type ProofMirStatementId,
  type ProofMirValueId,
} from "../ids";
import type {
  ProofMirLayoutReference,
  ProofMirLayoutTermReference,
} from "../model/layout-bindings";
import { monoPlaceForLocal } from "./expression-lowerer-helpers";
import { syncLoweredPlaceToFunctionDraft } from "./lowering-place-sync";
import type { ProofMirLoweringContext, ProofMirLoweringResult } from "./lowering-context";

export interface ValidationLoweringIdAllocator {
  valueForKey(key: ProofMirCanonicalKey): ProofMirValueId;
  placeForKey(key: ProofMirCanonicalKey): ProofMirPlaceId;
  nextStatementId(): ProofMirStatementId;
  nextOrigin(): ProofMirOriginId;
}

export interface LoweredValidationPlaces {
  readonly sourcePlaceKey: ProofMirCanonicalKey;
  readonly pendingResultPlaceKey: ProofMirCanonicalKey;
  readonly okPacketPlaceKey: ProofMirCanonicalKey;
  readonly okPayloadPlaceKey?: ProofMirCanonicalKey;
  readonly errPayloadPlaceKey?: ProofMirCanonicalKey;
}

export function createValidationLoweringIdAllocator(): ValidationLoweringIdAllocator {
  let nextValue = 0;
  let nextPlace = 0;
  let nextStatement = 0;
  let nextOrigin = 1;
  const valueKeys = new Map<ProofMirCanonicalKey, ProofMirValueId>();
  const placeKeys = new Map<ProofMirCanonicalKey, ProofMirPlaceId>();

  return {
    valueForKey(key) {
      const existing = valueKeys.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id = proofMirValueId(nextValue++);
      valueKeys.set(key, id);
      return id;
    },
    placeForKey(key) {
      const existing = placeKeys.get(key);
      if (existing !== undefined) {
        return existing;
      }
      const id = proofMirPlaceId(nextPlace++);
      placeKeys.set(key, id);
      return id;
    },
    nextStatementId() {
      return proofMirStatementId(nextStatement++);
    },
    nextOrigin() {
      return proofMirOriginId(nextOrigin++);
    },
  };
}

export function resolveValidatedBufferInstanceId(
  program: MonomorphizedHirProgram,
  validatedBufferTypeId: TypeId,
): MonoInstanceId | undefined {
  for (const buffer of program.validatedBuffers.entries()) {
    if (buffer.typeId === validatedBufferTypeId) {
      return buffer.instanceId;
    }
  }
  return undefined;
}

export function projectedPlaceKeysForBindingLocal(input: {
  readonly context: ProofMirLoweringContext;
  readonly local: MonoLocal;
}): readonly ProofMirCanonicalKey[] {
  return input.context.effects
    .placeEntries()
    .filter(
      (place) =>
        place.root.kind === "local" &&
        String(place.root.localId.instanceId) === String(input.local.localId.instanceId) &&
        String(place.root.localId.hirId) === String(input.local.localId.hirId) &&
        place.projection.length > 0,
    )
    .map((place) => place.key);
}

export function allocateValidationPlaces(input: {
  readonly context: ProofMirLoweringContext;
  readonly validation: MonoValidation;
  readonly originKey: ProofMirCanonicalKey;
  readonly materializeOkPayload: boolean;
  readonly materializeErrPayload: boolean;
  readonly okBindingLocal?: MonoLocal;
  readonly errBindingLocal?: MonoLocal;
}): ProofMirLoweringResult<LoweredValidationPlaces> {
  const sourcePlaceResult = lowerMonoPlaceKey({
    context: input.context,
    monoPlace: input.validation.sourcePlace,
    originKey: input.originKey,
  });
  if (sourcePlaceResult.kind === "error") {
    return sourcePlaceResult;
  }

  const pendingResultResult = lowerMonoPlaceKey({
    context: input.context,
    monoPlace: input.validation.pendingResultPlace,
    originKey: input.originKey,
  });
  if (pendingResultResult.kind === "error") {
    return pendingResultResult;
  }

  let okPacketPlaceKey = validationPacketPlaceKey({
    context: input.context,
    validationId: input.validation.validationId,
    originKey: input.originKey,
  });

  if (input.okBindingLocal !== undefined) {
    const localRootPlace = lowerMonoPlaceKey({
      context: input.context,
      monoPlace: monoLocalRootPlace({
        context: input.context,
        local: input.okBindingLocal,
      }),
      originKey: input.originKey,
    });
    if (localRootPlace.kind === "error") {
      return localRootPlace;
    }
    okPacketPlaceKey = localRootPlace.value;
  }

  let okPayloadPlaceKey: ProofMirCanonicalKey | undefined;
  if (input.materializeOkPayload) {
    okPayloadPlaceKey = input.context.effects.placeFromValidationPayload({
      validationId: input.validation.validationId,
      originKey: input.originKey,
      type: input.validation.okPayloadType,
      resourceKind: "Copy",
    });
  }

  let errPayloadPlaceKey: ProofMirCanonicalKey | undefined;
  if (input.errBindingLocal !== undefined) {
    const localRootPlace = lowerMonoPlaceKey({
      context: input.context,
      monoPlace: monoLocalRootPlace({
        context: input.context,
        local: input.errBindingLocal,
      }),
      originKey: input.originKey,
    });
    if (localRootPlace.kind === "error") {
      return localRootPlace;
    }
    errPayloadPlaceKey = localRootPlace.value;
  } else if (input.materializeErrPayload) {
    errPayloadPlaceKey = input.context.effects.placeFromValidationPayload({
      validationId: input.validation.validationId,
      originKey: input.originKey,
      type: input.validation.errPayloadType,
      resourceKind: "Copy",
    });
  }

  return loweringOk({
    sourcePlaceKey: sourcePlaceResult.value,
    pendingResultPlaceKey: pendingResultResult.value,
    okPacketPlaceKey,
    ...(okPayloadPlaceKey === undefined ? {} : { okPayloadPlaceKey }),
    ...(errPayloadPlaceKey === undefined ? {} : { errPayloadPlaceKey }),
  });
}

export function recordValidationEvidenceFacts(input: {
  readonly context: ProofMirLoweringContext;
  readonly validation: MonoValidation;
  readonly bufferInstanceId: MonoInstanceId;
  readonly packetPlaceKey: ProofMirCanonicalKey;
  readonly originKey: ProofMirCanonicalKey;
  readonly idAllocator: ValidationLoweringIdAllocator;
}): readonly ProofMirCanonicalKey[] {
  const buffer = input.context.layout.validatedBuffers.get(input.bufferInstanceId);
  if (buffer === undefined) {
    return [];
  }

  const factKeys: ProofMirCanonicalKey[] = [];

  const sourceLengthEnd = layoutTermReferenceForRoot({
    context: input.context,
    root: {
      kind: "validatedBufferSourceLength",
      instanceId: input.bufferInstanceId,
    },
    childPath: [],
    expectedUnit: "byteLength",
  });
  if (sourceLengthEnd !== undefined) {
    const factKey = input.context.factRecorder.recordLayoutFitsFact({
      role: "evidence",
      dependsOn: [
        {
          kind: "layout",
          layout: {
            kind: "validatedBuffer",
            instanceId: input.bufferInstanceId,
          } satisfies ProofMirLayoutReference,
        },
      ],
      origin: input.originKey,
      sourcePlaceKey: input.packetPlaceKey,
      end: sourceLengthEnd,
    });
    if (factKey !== undefined) {
      factKeys.push(factKey);
    }
  }

  for (const derivedField of buffer.derivedFields) {
    const payloadEnd = layoutTermReferenceForRoot({
      context: input.context,
      root: {
        kind: "validatedBufferDerivedSource",
        instanceId: input.bufferInstanceId,
        fieldId: derivedField.fieldId,
      },
      childPath: [],
      expectedUnit: derivedField.source.unit,
    });
    if (payloadEnd === undefined) {
      continue;
    }
    const factKey = input.context.factRecorder.recordPayloadEndFact({
      role: "evidence",
      dependsOn: [
        {
          kind: "layout",
          layout: {
            kind: "validatedBuffer",
            instanceId: input.bufferInstanceId,
          } satisfies ProofMirLayoutReference,
        },
      ],
      origin: input.originKey,
      sourcePlaceKey: input.packetPlaceKey,
      end: payloadEnd,
    });
    if (factKey !== undefined) {
      factKeys.push(factKey);
    }
  }

  void input.validation;
  return factKeys;
}

function lowerMonoPlaceKey(input: {
  readonly context: ProofMirLoweringContext;
  readonly monoPlace: MonoResourcePlace;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirLoweringResult<ProofMirCanonicalKey> {
  const lowered = input.context.functionScopePlaceLowerer.lowerMonoPlace({
    monoPlace: input.monoPlace,
    originKey: input.originKey,
  });
  if (lowered.kind === "error") {
    return lowered;
  }
  const effectsPlaceKey = input.context.effects.placeFromMono({
    monoPlace: input.monoPlace,
    originKey: input.originKey,
  });
  syncLoweredPlaceToFunctionDraft({
    context: input.context,
    lowered: lowered.value,
    monoPlace: input.monoPlace,
  });
  return loweringOk(effectsPlaceKey);
}

function validationPacketPlaceKey(input: {
  readonly context: ProofMirLoweringContext;
  readonly validationId: MonoInstantiatedProofId<ValidationId>;
  readonly originKey: ProofMirCanonicalKey;
}): ProofMirCanonicalKey {
  const valueKey = input.context.graph.createValue({
    role: `validation:packet:${String(input.validationId.hirId)}`,
    origin: input.originKey,
  });
  return input.context.effects.placeFromRuntimeTemporary({
    valueKey,
    originKey: input.originKey,
  });
}

function monoLocalRootPlace(input: {
  readonly context: ProofMirLoweringContext;
  readonly local: MonoLocal;
}): MonoResourcePlace {
  return monoPlaceForLocal({
    program: input.context.program,
    functionInstanceId: input.context.functionInstanceId,
    localId: input.local.localId,
    parameterId: input.local.parameterId,
    type: input.local.type,
    resourceKind: input.local.resourceKind,
    sourceOrigin: input.local.sourceOrigin,
  });
}

function layoutTermReferenceForRoot(input: {
  readonly context: ProofMirLoweringContext;
  readonly root: ProofMirLayoutTermReference["path"]["root"];
  readonly childPath: ProofMirLayoutTermReference["path"]["childPath"];
  readonly expectedUnit: ProofMirLayoutTermReference["unit"];
}): DraftProofMirLayoutTermReference | undefined {
  const resolved = input.context.layoutBindingIndex.resolveTerm({
    root: input.root,
    childPath: input.childPath,
    expectedUnit: input.expectedUnit,
  });
  if (resolved.kind !== "ok") {
    return undefined;
  }
  return {
    termKey: resolved.key,
    unit: resolved.unit,
    path: {
      root: input.root,
      childPath: input.childPath,
    },
  };
}

function loweringOk<Value>(value: Value): ProofMirLoweringResult<Value> {
  return { kind: "ok", value };
}
