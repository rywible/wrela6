import type { MonoInstanceId } from "../../mono/ids";
import type { MonoParameter } from "../../mono/mono-hir";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofMirOwnedPlaceId } from "../../proof-mir/ids";
import type { ProofMirFunction } from "../../proof-mir/model/graph";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import type {
  ProofCheckFunctionParameterInput,
  ProofCheckFunctionReceiverInput,
  ProofCheckFunctionSignatureInput,
  ProofCheckSeededFactInput,
} from "./initial-state";
import { placeBinderForMirOwnedPlace } from "./mir-place-bindings";
import { requirementTermFromProofMirFact } from "./mir-requirement-terms";
import { requirementTermReferencesPlaceKey, textReferencesPlaceKey } from "./place-key-references";
import { normalizeProofCheckTerm, proofCheckPlaceBinderKey } from "../model/fact-language";
import type { ProofCheckConcreteResourceKind } from "./ownership";
import { validatedBufferLayoutInstanceIdForParameter } from "./validated-buffer-parameter-binding";

function parameterPlaceForSignature(
  functionGraph: ProofMirFunction,
  functionInstanceId: MonoInstanceId,
  parameter: MonoParameter,
  index: number,
): ProofCheckFunctionParameterInput | undefined {
  const ownedPlace = functionGraph.places
    .entries()
    .find(
      (place) =>
        place.root.kind === "parameter" &&
        String(place.root.parameterId) === String(parameter.parameterId),
    );
  if (ownedPlace === undefined) {
    return {
      index,
      placeKey: `parameter:${index}`,
      resourceKind: parameter.resourceKind as ProofCheckConcreteResourceKind,
      mode: parameter.mode === "consume" ? "consume" : "observe",
    };
  }
  const binder = placeBinderForMirOwnedPlace(
    functionGraph,
    proofMirOwnedPlaceId(functionInstanceId, ownedPlace.placeId),
  );
  return {
    index,
    placeKey: proofCheckPlaceBinderKey(binder),
    resourceKind: parameter.resourceKind as ProofCheckConcreteResourceKind,
    mode: parameter.mode === "consume" ? "consume" : "observe",
  };
}

export function functionEntrySignatureFromMir(input: {
  readonly functionGraph: ProofMirFunction;
  readonly functionInstanceId: MonoInstanceId;
}): ProofCheckFunctionSignatureInput {
  const receiverPlace = input.functionGraph.places
    .entries()
    .find((place) => place.root.kind === "receiver");
  const receiver: ProofCheckFunctionReceiverInput | undefined =
    input.functionGraph.signature.receiver === undefined || receiverPlace === undefined
      ? undefined
      : {
          placeKey: proofCheckPlaceBinderKey(
            placeBinderForMirOwnedPlace(
              input.functionGraph,
              proofMirOwnedPlaceId(input.functionInstanceId, receiverPlace.placeId),
            ),
          ),
          resourceKind: input.functionGraph.signature.receiver
            .resourceKind as ProofCheckConcreteResourceKind,
          mode: input.functionGraph.signature.receiver.mode === "consume" ? "consume" : "observe",
        };

  const parameters = input.functionGraph.signature.parameters
    .map((parameter, index) =>
      parameterPlaceForSignature(input.functionGraph, input.functionInstanceId, parameter, index),
    )
    .filter((parameter): parameter is ProofCheckFunctionParameterInput => parameter !== undefined)
    .sort((left, right) => compareCodeUnitStrings(left.placeKey, right.placeKey));

  return {
    ...(receiver === undefined ? {} : { receiver }),
    parameters,
  };
}

function validatedBufferInstanceIdForParameter(
  mir: ProofMirProgram,
  parameter: MonoParameter,
): string | undefined {
  return validatedBufferLayoutInstanceIdForParameter({ mir, parameter });
}

export function seededFactsForValidatedBufferParameters(input: {
  readonly mir: ProofMirProgram;
  readonly functionGraph: ProofMirFunction;
  readonly functionInstanceId: MonoInstanceId;
  readonly signature: ProofCheckFunctionSignatureInput;
}): readonly ProofCheckSeededFactInput[] {
  const seededFacts: ProofCheckSeededFactInput[] = [];

  for (const signatureParameter of input.signature.parameters) {
    const parameter = input.functionGraph.signature.parameters[signatureParameter.index];
    if (parameter === undefined || parameter.resourceKind !== "ValidatedBuffer") {
      continue;
    }
    const layoutInstanceId = validatedBufferInstanceIdForParameter(input.mir, parameter);
    if (layoutInstanceId === undefined) {
      continue;
    }

    for (const fact of input.mir.facts.entries()) {
      if (fact.role !== "requirement") {
        continue;
      }
      const term = requirementTermFromProofMirFact({
        mir: input.mir,
        functionGraph: input.functionGraph,
        fact,
      });
      if (term === undefined) {
        continue;
      }
      const normalized = normalizeProofCheckTerm(term, "activeFact");
      if (
        !requirementTermReferencesPlaceKey(
          term,
          signatureParameter.placeKey,
          input.functionGraph,
        ) &&
        !textReferencesPlaceKey(normalized.key, signatureParameter.placeKey)
      ) {
        continue;
      }
      seededFacts.push({
        factKey: normalized.key,
        term: normalized.term as ProofCheckSeededFactInput["term"],
        authorityKey: `validated-buffer:${layoutInstanceId}`,
        source: "typeIntrinsic",
      });
    }
  }

  return seededFacts.sort((left, right) => compareCodeUnitStrings(left.factKey, right.factKey));
}

export function entryPacketSourcesForValidatedBufferParameters(input: {
  readonly functionGraph: ProofMirFunction;
  readonly signature: ProofCheckFunctionSignatureInput;
}): readonly { readonly packetKey: string; readonly sourceKey: string }[] {
  const packetSources: { readonly packetKey: string; readonly sourceKey: string }[] = [];
  for (const signatureParameter of input.signature.parameters) {
    const parameter = input.functionGraph.signature.parameters[signatureParameter.index];
    if (parameter === undefined || parameter.resourceKind !== "ValidatedBuffer") {
      continue;
    }
    packetSources.push({
      packetKey: signatureParameter.placeKey,
      sourceKey: signatureParameter.placeKey,
    });
  }
  return packetSources.sort((left, right) =>
    compareCodeUnitStrings(
      `${left.packetKey}:${left.sourceKey}`,
      `${right.packetKey}:${right.sourceKey}`,
    ),
  );
}

export function entryLayoutFactsForValidatedBufferParameters(input: {
  readonly mir: ProofMirProgram;
  readonly functionGraph: ProofMirFunction;
  readonly signature: ProofCheckFunctionSignatureInput;
}): readonly { readonly bufferKey: string; readonly layoutKey: string }[] {
  const layoutFacts: { readonly bufferKey: string; readonly layoutKey: string }[] = [];
  for (const signatureParameter of input.signature.parameters) {
    const parameter = input.functionGraph.signature.parameters[signatureParameter.index];
    if (parameter === undefined || parameter.resourceKind !== "ValidatedBuffer") {
      continue;
    }
    const layoutInstanceId = validatedBufferInstanceIdForParameter(input.mir, parameter);
    if (layoutInstanceId === undefined) {
      continue;
    }
    layoutFacts.push({
      bufferKey: signatureParameter.placeKey,
      layoutKey: layoutInstanceId,
    });
  }
  return layoutFacts.sort((left, right) =>
    compareCodeUnitStrings(
      `${left.bufferKey}:${left.layoutKey}`,
      `${right.bufferKey}:${right.layoutKey}`,
    ),
  );
}
