import type { TypedHirProgram } from "../hir/hir";
import type { HirProofOwner } from "../hir/ids";
import type { ImageId } from "../semantic/ids";
import { monoDiagnostic, type MonoDiagnostic } from "./diagnostics";
import { type MonoInstanceId } from "./ids";
import type {
  MonoAttempt,
  MonoBrand,
  MonoCallSiteRequirement,
  MonoFactContent,
  MonoFactOrigin,
  MonoFunctionInstance,
  MonoImageOrigin,
  MonoObligation,
  MonoPlatformContractEdge,
  MonoPrivateStateTransition,
  MonoProofMetadata,
  MonoResourcePlace,
  MonoSession,
  MonoTerminalCall,
  MonoTypeInstance,
  MonoValidation,
} from "./mono-hir";
import {
  platformEdgeBindingMismatch,
  platformEnsuredFactMismatch,
} from "./platform-edge-consistency";

import { lookupProofMetadataOwner, monoProofOwnerFor, ownerKey } from "./proof-metadata-index";
import {
  collectInlineBodyProofReferences,
  hasCanonicalInstanceKeyForOwner,
  inlineProofReferenceExists,
} from "./proof-metadata-inline-references";
import {
  canonicalInstanceKeyForFunction,
  canonicalInstanceKeyForType,
  instantiateFactContent,
  instantiateMonoResourcePlace,
  instantiateRequirement,
  lookupClonedExpression,
  lookupInstancesForOwner,
  normalizeCheckedTypeForInstance,
  remapExpressionId,
  remapLocalId,
  shouldInstantiatePlatformEdge,
} from "./proof-metadata-instance-helpers";
import { buildMonoTable, proofMetadataIdKey } from "./proof-metadata-tables";
export {
  buildProofMetadataIndex,
  createMonoRemapIndex,
  instantiateImageOwnedRecord,
  lookupProofMetadataOwner,
  ownerKey,
  type CreateMonoRemapIndexInput,
  type ImageInstantiationKey,
  type InstantiateImageOwnedRecordInput,
  type InstantiateImageOwnedRecordResult,
  type MonoRemapIndex,
  type ProofMetadataIdFamily,
  type ProofMetadataIndex,
  type ProofMetadataLookupResult,
  type ProofMetadataOwnerLookupRequest,
  type ProofRecordsByOwner,
} from "./proof-metadata-index";
export interface InstantiateMonoProofMetadataInput {
  readonly program: TypedHirProgram;
  readonly functionInstances: readonly MonoFunctionInstance[];
  readonly typeInstances: readonly MonoTypeInstance[];
  readonly imageInstanceId: MonoInstanceId;
  readonly source?: { readonly kind: "image"; readonly imageId: ImageId };
  readonly canonicalInstanceKeys: ReadonlyMap<HirProofOwner, string>;
  readonly reachablePlatformEdgeKeys?: ReadonlySet<string>;
}

export type InstantiateMonoProofMetadataResult =
  | {
      readonly kind: "ok";
      readonly proofMetadata: MonoProofMetadata;
      readonly diagnostics: readonly MonoDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function instantiateMonoProofMetadata(
  input: InstantiateMonoProofMetadataInput,
): InstantiateMonoProofMetadataResult {
  const diagnostics: MonoDiagnostic[] = [];
  const functionInstanceByCanonicalKey = new Map<string, MonoFunctionInstance>();
  for (const instance of input.functionInstances) {
    functionInstanceByCanonicalKey.set(
      canonicalInstanceKeyForFunction(
        instance.sourceFunctionId,
        instance.ownerTypeArguments,
        instance.functionTypeArguments,
        instance.ownerTypeInstanceId,
        input.typeInstances,
      ),
      instance,
    );
  }
  const typeInstanceByCanonicalKey = new Map<string, MonoTypeInstance>();
  for (const instance of input.typeInstances) {
    typeInstanceByCanonicalKey.set(
      canonicalInstanceKeyForType(instance.sourceTypeId, instance.typeArguments),
      instance,
    );
  }

  const obligations: MonoObligation[] = [];
  for (const record of input.program.proofMetadata.obligations.entries()) {
    const owner = record.obligationId.owner;
    const matchingInstances = lookupInstancesForOwner({
      owner,
      functionInstanceByCanonicalKey,
      typeInstanceByCanonicalKey,
      imageInstanceId: input.imageInstanceId,
      canonicalInstanceKeys: input.canonicalInstanceKeys,
    });
    if (matchingInstances.length === 0) continue;
    for (const instance of matchingInstances) {
      let place: MonoResourcePlace | undefined;
      if (record.place !== undefined) {
        const placeResult = instantiateMonoResourcePlace({
          place: record.place,
          functionInstance: instance,
          input,
        });
        if (placeResult.kind === "error") {
          diagnostics.push(...placeResult.diagnostics);
          continue;
        }
        place = placeResult.place;
      }
      obligations.push({
        obligationId: {
          owner: monoProofOwnerFor(instance.instanceId, owner),
          hirId: record.obligationId.id,
          instanceId: instance.instanceId,
        },
        kind: record.kind,
        sourceOrigin: String(record.sourceOrigin),
        ...(place !== undefined ? { place } : {}),
      });
    }
  }

  const sessions: MonoSession[] = [];
  for (const record of input.program.proofMetadata.sessions.entries()) {
    const owner = record.sessionId.owner;
    const matchingInstances = lookupInstancesForOwner({
      owner,
      functionInstanceByCanonicalKey,
      typeInstanceByCanonicalKey,
      imageInstanceId: input.imageInstanceId,
      canonicalInstanceKeys: input.canonicalInstanceKeys,
    });
    for (const instance of matchingInstances) {
      let place: MonoResourcePlace | undefined;
      if (record.place !== undefined) {
        const placeResult = instantiateMonoResourcePlace({
          place: record.place,
          functionInstance: instance,
          input,
        });
        if (placeResult.kind === "error") {
          diagnostics.push(...placeResult.diagnostics);
          continue;
        }
        place = placeResult.place;
      }
      sessions.push({
        sessionId: {
          owner: monoProofOwnerFor(instance.instanceId, owner),
          hirId: record.sessionId.id,
          instanceId: instance.instanceId,
        },
        kind: record.kind,
        sourceOrigin: String(record.sourceOrigin),
        ...(place !== undefined ? { place } : {}),
      });
    }
  }

  const brands: MonoBrand[] = [];
  for (const record of input.program.proofMetadata.brands.entries()) {
    const owner = record.brandId.owner;
    const matchingInstances = lookupInstancesForOwner({
      owner,
      functionInstanceByCanonicalKey,
      typeInstanceByCanonicalKey,
      imageInstanceId: input.imageInstanceId,
      canonicalInstanceKeys: input.canonicalInstanceKeys,
    });
    for (const instance of matchingInstances) {
      brands.push({
        brandId: {
          owner: monoProofOwnerFor(instance.instanceId, owner),
          hirId: record.brandId.id,
          instanceId: instance.instanceId,
        },
        canonicalKey: record.canonicalKey,
        origin: record.origin,
        ...(record.sourceOrigin !== undefined ? { sourceOrigin: String(record.sourceOrigin) } : {}),
      });
    }
  }

  const resourcePlaces: MonoResourcePlace[] = [];
  for (const record of input.program.proofMetadata.resourcePlaces.entries()) {
    const owner = record.placeId.owner;
    const matchingInstances = lookupInstancesForOwner({
      owner,
      functionInstanceByCanonicalKey,
      typeInstanceByCanonicalKey,
      imageInstanceId: input.imageInstanceId,
      canonicalInstanceKeys: input.canonicalInstanceKeys,
    });
    for (const instance of matchingInstances) {
      const placeResult = instantiateMonoResourcePlace({
        place: record,
        functionInstance: instance,
        input,
      });
      if (placeResult.kind === "error") {
        diagnostics.push(...placeResult.diagnostics);
        continue;
      }
      resourcePlaces.push(placeResult.place);
    }
  }

  const callSiteRequirements: MonoCallSiteRequirement[] = [];
  for (const record of input.program.proofMetadata.callSiteRequirements.entries()) {
    const owner = record.callSiteRequirementId.owner;
    const matchingInstances = lookupInstancesForOwner({
      owner,
      functionInstanceByCanonicalKey,
      typeInstanceByCanonicalKey,
      imageInstanceId: input.imageInstanceId,
      canonicalInstanceKeys: input.canonicalInstanceKeys,
    });
    for (const instance of matchingInstances) {
      const callExpressionId = remapExpressionId(record.callExpressionId, instance);
      const requirementResult = instantiateRequirement({
        requirement: record.requirement,
        instance,
        input,
      });
      if (requirementResult.kind === "error") {
        diagnostics.push(...requirementResult.diagnostics);
        continue;
      }
      callSiteRequirements.push({
        callSiteRequirementId: {
          owner: monoProofOwnerFor(instance.instanceId, owner),
          hirId: record.callSiteRequirementId.id,
          instanceId: instance.instanceId,
        },
        callExpressionId,
        requirement: requirementResult.requirement,
        sourceOrigin: String(record.sourceOrigin),
      });
    }
  }

  const validations: MonoValidation[] = [];
  for (const record of input.program.proofMetadata.validations.entries()) {
    const owner = record.validationId.owner;
    const matchingInstances = lookupInstancesForOwner({
      owner,
      functionInstanceByCanonicalKey,
      typeInstanceByCanonicalKey,
      imageInstanceId: input.imageInstanceId,
      canonicalInstanceKeys: input.canonicalInstanceKeys,
    });
    for (const instance of matchingInstances) {
      const sourcePlace = instantiateMonoResourcePlace({
        place: record.sourcePlace,
        functionInstance: instance,
        input,
      });
      if (sourcePlace.kind === "error") {
        diagnostics.push(...sourcePlace.diagnostics);
        continue;
      }
      const pendingResultPlace = instantiateMonoResourcePlace({
        place: record.pendingResultPlace,
        functionInstance: instance,
        input,
      });
      if (pendingResultPlace.kind === "error") {
        diagnostics.push(...pendingResultPlace.diagnostics);
        continue;
      }
      const okType = normalizeCheckedTypeForInstance(record.okPayloadType, instance, input);
      const errType = normalizeCheckedTypeForInstance(record.errPayloadType, instance, input);
      if (okType.kind === "error" || errType.kind === "error") {
        if (okType.kind === "error") diagnostics.push(...okType.diagnostics);
        if (errType.kind === "error") diagnostics.push(...errType.diagnostics);
        continue;
      }
      const resultLocalId =
        record.resultLocalId !== undefined
          ? remapLocalId(record.resultLocalId, instance)
          : undefined;
      validations.push({
        validationId: {
          owner: monoProofOwnerFor(instance.instanceId, owner),
          hirId: record.validationId.id,
          instanceId: instance.instanceId,
        },
        validationExpressionId: remapExpressionId(record.validationExpressionId, instance),
        sourcePlace: sourcePlace.place,
        pendingResultPlace: pendingResultPlace.place,
        ...(resultLocalId !== undefined ? { resultLocalId } : {}),
        validatedBufferTypeId: record.validatedBufferTypeId,
        okPayloadType: okType.type,
        errPayloadType: errType.type,
        sourceOrigin: String(record.sourceOrigin),
      });
    }
  }

  const attempts: MonoAttempt[] = [];
  for (const record of input.program.proofMetadata.attempts.entries()) {
    const owner = record.attemptId.owner;
    const matchingInstances = lookupInstancesForOwner({
      owner,
      functionInstanceByCanonicalKey,
      typeInstanceByCanonicalKey,
      imageInstanceId: input.imageInstanceId,
      canonicalInstanceKeys: input.canonicalInstanceKeys,
    });
    for (const instance of matchingInstances) {
      const declaredInputPlaces: MonoResourcePlace[] = [];
      for (const declaredPlace of record.declaredInputPlaces) {
        const placeResult = instantiateMonoResourcePlace({
          place: declaredPlace,
          functionInstance: instance,
          input,
        });
        if (placeResult.kind === "error") {
          diagnostics.push(...placeResult.diagnostics);
          declaredInputPlaces.length = 0;
          break;
        }
        declaredInputPlaces.push(placeResult.place);
      }
      const fallibleExpression = lookupClonedExpression(record.fallibleExpression, instance);
      if (fallibleExpression.kind === "error") {
        diagnostics.push(...fallibleExpression.diagnostics);
        continue;
      }
      const alternativeExpression =
        record.alternativeExpression !== undefined
          ? lookupClonedExpression(record.alternativeExpression, instance)
          : undefined;
      if (alternativeExpression?.kind === "error") {
        diagnostics.push(...alternativeExpression.diagnostics);
        continue;
      }
      attempts.push({
        attemptId: {
          owner: monoProofOwnerFor(instance.instanceId, owner),
          hirId: record.attemptId.id,
          instanceId: instance.instanceId,
        },
        attemptExpressionId: remapExpressionId(record.attemptExpressionId, instance),
        fallibleExpression: fallibleExpression.expression,
        ...(alternativeExpression !== undefined
          ? { alternativeExpression: alternativeExpression.expression }
          : {}),
        declaredInputPlaces,
        sourceOrigin: String(record.sourceOrigin),
      });
    }
  }

  const terminalCalls: MonoTerminalCall[] = [];
  for (const record of input.program.proofMetadata.terminalCalls.entries()) {
    const owner = record.terminalCallId.owner;
    const matchingInstances = lookupInstancesForOwner({
      owner,
      functionInstanceByCanonicalKey,
      typeInstanceByCanonicalKey,
      imageInstanceId: input.imageInstanceId,
      canonicalInstanceKeys: input.canonicalInstanceKeys,
    });
    for (const instance of matchingInstances) {
      const closureObligation = lookupProofMetadataOwner(input.program.proofMetadata, {
        family: "obligation",
        id: record.closureObligationId,
      });
      if (closureObligation.kind !== "ok") {
        diagnostics.push(...closureObligation.diagnostics);
        continue;
      }
      terminalCalls.push({
        terminalCallId: {
          owner: monoProofOwnerFor(instance.instanceId, owner),
          hirId: record.terminalCallId.id,
          instanceId: instance.instanceId,
        },
        callExpressionId: remapExpressionId(record.callExpressionId, instance),
        calleeFunctionId: record.calleeFunctionId,
        closureObligationId: {
          owner: monoProofOwnerFor(instance.instanceId, record.closureObligationId.owner),
          hirId: record.closureObligationId.id,
          instanceId: instance.instanceId,
        },
        sourceOrigin: String(record.sourceOrigin),
      });
    }
  }

  const privateStateTransitions: MonoPrivateStateTransition[] = [];
  for (const record of input.program.proofMetadata.privateStateTransitions.entries()) {
    const owner = record.transitionId.owner;
    const matchingInstances = lookupInstancesForOwner({
      owner,
      functionInstanceByCanonicalKey,
      typeInstanceByCanonicalKey,
      imageInstanceId: input.imageInstanceId,
      canonicalInstanceKeys: input.canonicalInstanceKeys,
    });
    for (const instance of matchingInstances) {
      let place: MonoResourcePlace | undefined;
      if (record.place !== undefined) {
        const placeResult = instantiateMonoResourcePlace({
          place: record.place,
          functionInstance: instance,
          input,
        });
        if (placeResult.kind === "error") {
          diagnostics.push(...placeResult.diagnostics);
          continue;
        }
        place = placeResult.place;
      }
      privateStateTransitions.push({
        transitionId: {
          owner: monoProofOwnerFor(instance.instanceId, owner),
          hirId: record.transitionId.id,
          instanceId: instance.instanceId,
        },
        functionId: record.functionId,
        kind: record.kind,
        ...(place !== undefined ? { place } : {}),
        transitionOrdinalForPlace: record.transitionOrdinalForPlace,
        sourceOrigin: String(record.sourceOrigin),
      });
    }
  }

  const factOrigins: MonoFactOrigin[] = [];
  for (const record of input.program.proofMetadata.factOrigins.entries()) {
    const owner = record.factOriginId.owner;
    const matchingInstances = lookupInstancesForOwner({
      owner,
      functionInstanceByCanonicalKey,
      typeInstanceByCanonicalKey,
      imageInstanceId: input.imageInstanceId,
      canonicalInstanceKeys: input.canonicalInstanceKeys,
    });
    for (const instance of matchingInstances) {
      const contentRecord = record.fact ?? record.content;
      let content: MonoFactContent | undefined;
      if (contentRecord !== undefined) {
        const contentResult = instantiateFactContent({
          content: contentRecord,
          instance,
          input,
        });
        if (contentResult.kind === "error") {
          diagnostics.push(...contentResult.diagnostics);
          continue;
        }
        content = contentResult.content;
      }
      factOrigins.push({
        factOriginId: {
          owner: monoProofOwnerFor(instance.instanceId, owner),
          hirId: record.factOriginId.id,
          instanceId: instance.instanceId,
        },
        ...(content !== undefined ? { content } : {}),
        sourceOrigin: String(record.sourceOrigin),
      });
    }
  }

  const platformContractEdges: MonoPlatformContractEdge[] = [];
  for (const record of input.program.proofMetadata.platformContractEdges.entries()) {
    const owner = record.edgeId.owner;
    const matchingInstances = lookupInstancesForOwner({
      owner,
      functionInstanceByCanonicalKey,
      typeInstanceByCanonicalKey,
      imageInstanceId: input.imageInstanceId,
      canonicalInstanceKeys: input.canonicalInstanceKeys,
    }).filter((instance) =>
      shouldInstantiatePlatformEdge({
        record,
        instance,
        reachablePlatformEdgeKeys: input.reachablePlatformEdgeKeys,
      }),
    );
    if (matchingInstances.length === 0) continue;
    const binding = input.program.monoClosure.certifiedPlatformBindings.get(
      record.sourceFunctionId,
    );
    if (binding === undefined) {
      diagnostics.push(
        monoDiagnostic({
          severity: "error",
          code: "MONO_CERTIFIED_PLATFORM_BINDING_MISSING",
          message: "HIR platform contract edge references a missing certified platform binding.",
          ownerKey: `function:${record.sourceFunctionId}`,
          rootCauseKey: "platform-binding",
          stableDetail: `missing-binding:${ownerKey(owner)}:${String(record.edgeId.id)}`,
          sourceOrigin: String(record.sourceOrigin),
        }),
      );
      continue;
    }
    const bindingMismatchReason = platformEdgeBindingMismatch({ edge: record, binding });
    if (bindingMismatchReason !== undefined) {
      diagnostics.push(
        monoDiagnostic({
          severity: "error",
          code: "MONO_PLATFORM_EDGE_BINDING_MISMATCH",
          message:
            "HIR platform contract edge does not match the certified platform binding for the call.",
          ownerKey: `function:${record.sourceFunctionId}`,
          rootCauseKey: "platform-edge",
          stableDetail: `binding-mismatch:${ownerKey(owner)}:${String(record.edgeId.id)}:${bindingMismatchReason}`,
          sourceOrigin: String(record.sourceOrigin),
        }),
      );
      continue;
    }
    const ensuredFactMismatchReason = platformEnsuredFactMismatch({ edge: record, binding });
    if (ensuredFactMismatchReason !== undefined) {
      diagnostics.push(
        monoDiagnostic({
          severity: "error",
          code: "MONO_INCONSISTENT_PLATFORM_ENSURED_FACT",
          message:
            "HIR platform contract edge ensured facts do not match the certified platform binding.",
          ownerKey: `function:${record.sourceFunctionId}`,
          rootCauseKey: "platform-edge",
          stableDetail: `ensured-fact-mismatch:${ownerKey(owner)}:${String(
            record.edgeId.id,
          )}:${ensuredFactMismatchReason}`,
          sourceOrigin: String(record.sourceOrigin),
        }),
      );
      continue;
    }
    for (const instance of matchingInstances) {
      platformContractEdges.push({
        edgeId: {
          owner: monoProofOwnerFor(instance.instanceId, owner),
          hirId: record.edgeId.id,
          instanceId: instance.instanceId,
        },
        sourceFunctionId: record.sourceFunctionId,
        primitiveId: record.primitiveId,
        contractId: record.contractId,
        targetId: record.targetId,
        ...(record.certificate !== undefined ? { certificate: record.certificate } : {}),
        ...(record.sourceRequirementIds !== undefined
          ? {
              sourceRequirementIds: record.sourceRequirementIds.map((id) => ({
                owner: monoProofOwnerFor(instance.instanceId, id.owner),
                hirId: id.id,
                instanceId: instance.instanceId,
              })),
            }
          : {}),
        ...(record.callExpressionId !== undefined
          ? { callExpressionId: remapExpressionId(record.callExpressionId, instance) }
          : {}),
        ...(record.callOrigin !== undefined ? { callOrigin: String(record.callOrigin) } : {}),
        ensuredFacts: record.ensuredFacts,
        sourceOrigin: String(record.sourceOrigin),
      });
    }
  }

  const imageOrigins: MonoImageOrigin[] = [];
  for (const record of input.program.proofMetadata.imageOrigins.entries()) {
    const owner = record.imageOriginId.owner;
    if (owner.kind !== "image") continue;
    if (!hasCanonicalInstanceKeyForOwner(input.canonicalInstanceKeys, owner)) continue;
    imageOrigins.push({
      imageOriginId: {
        owner: { kind: "image", instanceId: input.imageInstanceId },
        hirId: record.imageOriginId.id,
        instanceId: input.imageInstanceId,
      },
      imageId: record.imageId,
      ...(record.fieldId !== undefined ? { fieldId: record.fieldId } : {}),
      ...(record.deviceSurfaceId !== undefined ? { deviceSurfaceId: record.deviceSurfaceId } : {}),
      sourceOrigin: String(record.sourceOrigin),
    });
  }

  for (const instance of input.functionInstances) {
    if (instance.body === undefined) continue;
    for (const reference of collectInlineBodyProofReferences(instance.body)) {
      const owner: HirProofOwner = { kind: "function", functionId: instance.sourceFunctionId };
      if (inlineProofReferenceExists(input.program.proofMetadata, owner, reference)) continue;
      diagnostics.push(
        monoDiagnostic({
          severity: "error",
          code: "MONO_DANGLING_PROOF_METADATA",
          message: "Inline body proof reference is missing from global proof metadata.",
          ownerKey: ownerKey(owner),
          rootCauseKey: "proof-metadata",
          stableDetail: `missing-inline:${reference.family}:${String(reference.id.hirId)}`,
        }),
      );
    }
  }

  const errorDiagnostics = diagnostics.filter((diagnostic) => diagnostic.severity === "error");
  if (errorDiagnostics.length > 0) {
    return { kind: "error", diagnostics };
  }

  return {
    kind: "ok",
    proofMetadata: {
      obligations: buildMonoTable(
        obligations,
        (entry) => proofMetadataIdKey(entry.obligationId),
        (id) => proofMetadataIdKey(id),
      ),
      sessions: buildMonoTable(
        sessions,
        (entry) => proofMetadataIdKey(entry.sessionId),
        (id) => proofMetadataIdKey(id),
      ),
      brands: buildMonoTable(
        brands,
        (entry) => proofMetadataIdKey(entry.brandId),
        (id) => proofMetadataIdKey(id),
      ),
      resourcePlaces: buildMonoTable(
        resourcePlaces,
        (entry) => proofMetadataIdKey(entry.placeId),
        (id) => proofMetadataIdKey(id),
      ),
      callSiteRequirements: buildMonoTable(
        callSiteRequirements,
        (entry) => proofMetadataIdKey(entry.callSiteRequirementId),
        (id) => proofMetadataIdKey(id),
      ),
      validations: buildMonoTable(
        validations,
        (entry) => proofMetadataIdKey(entry.validationId),
        (id) => proofMetadataIdKey(id),
      ),
      attempts: buildMonoTable(
        attempts,
        (entry) => proofMetadataIdKey(entry.attemptId),
        (id) => proofMetadataIdKey(id),
      ),
      terminalCalls: buildMonoTable(
        terminalCalls,
        (entry) => proofMetadataIdKey(entry.terminalCallId),
        (id) => proofMetadataIdKey(id),
      ),
      privateStateTransitions: buildMonoTable(
        privateStateTransitions,
        (entry) => proofMetadataIdKey(entry.transitionId),
        (id) => proofMetadataIdKey(id),
      ),
      factOrigins: buildMonoTable(
        factOrigins,
        (entry) => proofMetadataIdKey(entry.factOriginId),
        (id) => proofMetadataIdKey(id),
      ),
      platformContractEdges: buildMonoTable(
        platformContractEdges,
        (entry) => proofMetadataIdKey(entry.edgeId),
        (id) => proofMetadataIdKey(id),
      ),
      imageOrigins: buildMonoTable(
        imageOrigins,
        (entry) => proofMetadataIdKey(entry.imageOriginId),
        (id) => proofMetadataIdKey(id),
      ),
    },
    diagnostics,
  };
}
