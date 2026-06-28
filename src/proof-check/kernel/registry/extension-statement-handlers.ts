import type { ProofMirFunction } from "../../../proof-mir/model/graph";
import type { ProofMirConcurrencyOperation } from "../../../proof-mir/model/effects";
import type { ProofMirStatementExtension } from "../../../proof-mir/model/effects";
import { proofMirOwnedPlaceId, type ProofMirPlaceId } from "../../../proof-mir/ids";
import type { MonoInstanceId } from "../../../mono/ids";
import { checkProofCheckExtensionTransfer } from "../../domains/extensions";
import { placeBinderForMirOwnedPlace } from "../../domains/mir-place-bindings";
import { proofCapabilityKindId, proofCheckPlaceBinderKey } from "../../model/fact-language";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../../diagnostics";
import type { ProofCheckStructuredPlace } from "../state";
import {
  proofCheckProgramPointKey,
  type ProofCheckTransition,
  type ProofCheckTransitionResult,
} from "../transition-api";
import {
  errorTransition,
  extensionTransition,
  missingMirMetadataTransition,
  resolveFunctionGraph,
  type ProofCheckRegistryContext,
} from "./transition-helpers";

export type ProofCheckExtensionStatementHandler = (input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly extension: ProofMirStatementExtension;
}) => ProofCheckTransitionResult;

function structuredPlaceFromMirPlace(input: {
  readonly functionGraph: ProofMirFunction;
  readonly functionInstanceId: MonoInstanceId;
  readonly placeId: ProofMirPlaceId;
}): ProofCheckStructuredPlace {
  const binder = placeBinderForMirOwnedPlace(
    input.functionGraph,
    proofMirOwnedPlaceId(input.functionInstanceId, input.placeId),
  );
  return { placeKey: proofCheckPlaceBinderKey(binder) };
}

function crossCoreTransferFromConcurrencyOperation(input: {
  readonly functionGraph: ProofMirFunction;
  readonly functionInstanceId: MonoInstanceId;
  readonly operation: ProofMirConcurrencyOperation;
  readonly operationOriginKey: string;
}):
  | {
      readonly kind: "ok";
      readonly sourcePlace: ProofCheckStructuredPlace;
      readonly destinationCoreKey: string;
      readonly capabilityKind: ReturnType<typeof proofCapabilityKindId>;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] } {
  switch (input.operation.kind) {
    case "transferOwnership":
      return {
        kind: "ok",
        sourcePlace: structuredPlaceFromMirPlace({
          functionGraph: input.functionGraph,
          functionInstanceId: input.functionInstanceId,
          placeId: input.operation.fromPlace,
        }),
        destinationCoreKey: proofCheckPlaceBinderKey(
          placeBinderForMirOwnedPlace(
            input.functionGraph,
            proofMirOwnedPlaceId(input.functionInstanceId, input.operation.toPlace),
          ),
        ),
        capabilityKind: proofCapabilityKindId("dma"),
      };
    case "pinCore":
      return {
        kind: "ok",
        sourcePlace: structuredPlaceFromMirPlace({
          functionGraph: input.functionGraph,
          functionInstanceId: input.functionInstanceId,
          placeId: input.operation.sourcePlace,
        }),
        destinationCoreKey: proofCheckPlaceBinderKey(
          placeBinderForMirOwnedPlace(
            input.functionGraph,
            proofMirOwnedPlaceId(input.functionInstanceId, input.operation.targetCorePlace),
          ),
        ),
        capabilityKind: proofCapabilityKindId("dma"),
      };
    case "moveRingEnqueue":
    case "moveRingDequeue":
    case "spawnWorker":
      return {
        kind: "error",
        diagnostics: [
          proofCheckDiagnostic({
            severity: "error",
            code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
            messageTemplateId: "proof-check.extension.unsupported-concurrency-operation",
            messageArguments: [{ kind: "text", value: input.operation.kind }],
            message: `Unsupported concurrency extension operation ${input.operation.kind}`,
            ownerKey: input.operationOriginKey,
            rootCauseKey: input.operationOriginKey,
            stableDetail: `unsupported-concurrency-operation:${input.operation.kind}`,
          }),
        ],
      };
    default: {
      const unreachable: never = input.operation;
      return unreachable;
    }
  }
}

function handleConcurrencyExtensionStatement(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly extension: Extract<ProofMirStatementExtension, { readonly kind: "concurrency" }>;
}): ProofCheckTransitionResult {
  const ownerKey = proofCheckProgramPointKey(input.transition.location);
  const state = input.transition.inputState;
  const gateResult = checkProofCheckExtensionTransfer({
    category: "extensionGate",
    input: {
      state,
      extensionKind: "crossCoreOwnership",
      extensionSchemaKey: "schema:cross-core-ownership",
      companion: input.context.input.semantics,
      enabledFeatureGates: ["crossCoreOwnership"],
      schema: {
        allowedPatchKinds: ["crossCoreOwnership"],
        allowedExtensionEntryKinds: [],
        allowedPacketEntryKeys: [],
      },
      operationOriginKey: ownerKey,
      transitionId: input.transition.transitionId,
    },
  });
  if (gateResult.kind === "error") {
    return errorTransition(gateResult.diagnostics);
  }
  const functionGraph = resolveFunctionGraph(
    input.context.input.mir,
    input.transition.functionInstanceId,
  );
  if (functionGraph === undefined) {
    return missingMirMetadataTransition(input.transition, "extension:missing-function");
  }
  const transferInput = crossCoreTransferFromConcurrencyOperation({
    functionGraph,
    functionInstanceId: input.transition.functionInstanceId,
    operation: input.extension.operation,
    operationOriginKey: ownerKey,
  });
  if (transferInput.kind === "error") {
    return errorTransition(transferInput.diagnostics);
  }
  const extensionResult = checkProofCheckExtensionTransfer({
    category: "crossCoreOwnership",
    input: {
      state,
      companion: input.context.input.semantics,
      sourcePlace: transferInput.sourcePlace,
      destinationCoreKey: transferInput.destinationCoreKey,
      capabilityKind: transferInput.capabilityKind,
      operationOriginKey: ownerKey,
      transitionId: input.transition.transitionId,
      placeResolver: input.context.placeResolver,
    },
  });
  if (extensionResult.kind === "error") {
    return errorTransition(extensionResult.diagnostics);
  }
  return extensionTransition(input.transition, input.context, extensionResult);
}

const extensionStatementHandlers: Readonly<
  Record<ProofMirStatementExtension["kind"], ProofCheckExtensionStatementHandler>
> = {
  concurrency: handleConcurrencyExtensionStatement,
};

export function handleExtensionStatement(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly extension: ProofMirStatementExtension;
}): ProofCheckTransitionResult {
  const handler = extensionStatementHandlers[input.extension.kind];
  return handler(input);
}
