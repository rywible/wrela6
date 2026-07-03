import type { MonoInstanceId } from "../../../mono/ids";
import { proofMirOwnedCallId, type ProofMirValueId } from "../../../proof-mir/ids";
import type { ProofMirCallGraphEdge } from "../../../proof-mir/model/calls";
import type { ProofMirCall, ProofMirFunction } from "../../../proof-mir/model/graph";
import type { ProofMirProgram } from "../../../proof-mir/model/program";
import {
  checkPlatformContractTransfer,
  resolvePlatformContract,
} from "../../domains/platform-contract-transfer";
import { checkRuntimeContractTransfer } from "../../domains/runtime-contract-transfer";
import {
  buildCheckedSourceCallTransferInput,
  buildPlatformCallEffectOperandBindings,
} from "../../domains/mir-source-call-transfer";
import { applySummaryProduceEffect } from "../../domains/ownership";
import { proofCheckDiagnostic } from "../../diagnostics";
import {
  resolveAcceptedSourceCallSummary,
  transferSourceCallWithAcceptedSummary,
} from "../whole-image-driver";
import {
  proofCheckProgramPointKey,
  type ProofCheckTransition,
  type ProofCheckTransitionResult,
} from "../transition-api";
import {
  errorTransition,
  okCoreTransition,
  placeKeyForMirPlace,
  tryResolveProofMirPlaceIdForPlaceKey,
  type ProofCheckRegistryContext,
} from "./transition-helpers";

export function callGraphEdgeForStatement(
  mir: ProofMirProgram,
  functionInstanceId: MonoInstanceId,
  callId: ProofMirCallGraphEdge["callId"]["callId"],
): ProofMirCallGraphEdge | undefined {
  return mir.callGraph.get(proofMirOwnedCallId(functionInstanceId, callId));
}

function mirCallForCallGraphEdge(input: {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly call: ProofMirCallGraphEdge;
}): { readonly functionGraph: ProofMirFunction; readonly mirCall: ProofMirCall } | undefined {
  const functionGraph = input.mir.functions.get(input.functionInstanceId);
  if (functionGraph === undefined) {
    return undefined;
  }
  for (const block of functionGraph.blocks.entries()) {
    for (const statement of block.statements) {
      if (
        statement.kind.kind === "call" &&
        String(statement.kind.call.callId) === String(input.call.callId.callId)
      ) {
        return { functionGraph, mirCall: statement.kind.call };
      }
    }
  }
  return undefined;
}

function compilerIntrinsicProducedPlace(input: {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
  readonly call: ProofMirCallGraphEdge;
}):
  | {
      readonly placeKey: string;
      readonly valueIds: readonly ProofMirValueId[];
      readonly resourceKind: "Copy" | "Affine" | "Linear";
    }
  | undefined {
  const resolvedCall = mirCallForCallGraphEdge(input);
  const result = resolvedCall?.mirCall.result;
  if (resolvedCall === undefined || result === undefined) {
    return undefined;
  }
  const placeId =
    result.kind === "place" || result.kind === "valueAndPlace" ? result.place : undefined;
  if (placeId === undefined) {
    return undefined;
  }
  const place = resolvedCall.functionGraph.places.get(placeId);
  const resourceKind = place?.resourceKind;
  const valueIds = result.kind === "valueAndPlace" ? [result.value] : [];
  return {
    placeKey: placeKeyForMirPlace(placeId),
    valueIds,
    resourceKind:
      resourceKind === "Affine" || resourceKind === "Linear" || resourceKind === "Copy"
        ? resourceKind
        : "Copy",
  };
}

export function handleCallTransfer(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly call: ProofMirCallGraphEdge;
}): ProofCheckTransitionResult {
  const ownerKey = proofCheckProgramPointKey(input.transition.location);
  const state = input.transition.inputState;

  switch (input.call.target.kind) {
    case "sourceFunction": {
      const acceptedSummary = resolveAcceptedSourceCallSummary({
        summaries: input.context.summaries,
        calleeFunctionInstanceId: input.call.target.functionInstanceId,
      });
      const transferInput = buildCheckedSourceCallTransferInput({
        mir: input.context.input.mir,
        context: input.context,
        transition: input.transition,
        call: input.call,
        state,
        summary: acceptedSummary,
        operationOriginKey: ownerKey,
      });
      const result = transferSourceCallWithAcceptedSummary({
        ...transferInput,
        summaries: input.context.summaries,
      });
      if (result.kind === "error") {
        return errorTransition(result.diagnostics);
      }
      return okCoreTransition({
        transition: input.transition,
        context: input.context,
        patches: result.patches,
        certificates: result.certificates,
        packetEntries: result.packetEntries,
      });
    }
    case "certifiedPlatform": {
      const platformEdge = input.context.input.mir.platformEdges.get(input.call.target.edgeId);
      if (platformEdge === undefined) {
        return errorTransition([
          proofCheckDiagnostic({
            severity: "error",
            code: "PROOF_CHECK_PLATFORM_CONTRACT_MISSING",
            messageTemplateId: "platform.edge-missing",
            messageArguments: [{ kind: "text", value: String(input.call.target.edgeId) }],
            message: "Missing platform edge for call",
            ownerKey,
            rootCauseKey: ownerKey,
            stableDetail: `missing-platform-edge:${String(input.call.target.edgeId)}`,
          }),
        ]);
      }
      const monoEdge = input.context.input.mir.proofMetadata.platformContractEdges.get(
        platformEdge.edgeId,
      );
      if (monoEdge === undefined) {
        return errorTransition([
          proofCheckDiagnostic({
            severity: "error",
            code: "PROOF_CHECK_PLATFORM_CONTRACT_MISSING",
            messageTemplateId: "platform.edge-missing",
            messageArguments: [{ kind: "text", value: String(platformEdge.edgeId) }],
            message: "Missing mono platform contract edge for call",
            ownerKey,
            rootCauseKey: ownerKey,
            stableDetail: `missing-mono-platform-edge:${String(platformEdge.edgeId)}`,
          }),
        ]);
      }
      const resolutionResult = resolvePlatformContract({
        call: input.call,
        platformEdge,
        monoEdge,
        catalog: input.context.input.platformContracts,
        operationOriginKey: ownerKey,
      });
      if (resolutionResult.kind === "error") {
        return errorTransition(resolutionResult.diagnostics);
      }
      const contract = resolutionResult.resolution.contract;
      if (contract.preconditions.length === 0 && (monoEdge.sourceRequirementIds?.length ?? 0) > 0) {
        return errorTransition([
          proofCheckDiagnostic({
            severity: "error",
            code: "PROOF_CHECK_PLATFORM_PRECONDITION_FAILED",
            messageTemplateId: "platform.precondition-failed",
            messageArguments: [{ kind: "text", value: "missing catalog precondition" }],
            message: "Platform contract is missing a required precondition",
            ownerKey,
            rootCauseKey: "call-requirement:missing-platform-precondition",
            stableDetail: "missing-platform-precondition",
          }),
        ]);
      }
      const effectOperandBindings = buildPlatformCallEffectOperandBindings({
        mir: input.context.input.mir,
        functionInstanceId: input.transition.functionInstanceId,
        call: input.call,
      });
      if (effectOperandBindings?.arguments !== undefined) {
        for (const [index, argument] of effectOperandBindings.arguments.entries()) {
          const placeId = tryResolveProofMirPlaceIdForPlaceKey(
            argument.placeKey,
            input.context.placeResolver,
          );
          if (placeId !== undefined) {
            input.context.placeResolver.index.set(`parameter:${index}`, placeId);
            input.context.placeResolver.index.set(`argument:${index}`, placeId);
          }
        }
      }
      if (effectOperandBindings?.receiver !== undefined) {
        const receiverPlaceId = tryResolveProofMirPlaceIdForPlaceKey(
          effectOperandBindings.receiver.placeKey,
          input.context.placeResolver,
        );
        if (receiverPlaceId !== undefined) {
          input.context.placeResolver.index.set("receiver", receiverPlaceId);
        }
      }
      const result = checkPlatformContractTransfer({
        state,
        call: input.call,
        platformEdge,
        contract,
        monoEdge,
        catalog: input.context.input.platformContracts,
        operationOriginKey: ownerKey,
        placeResolver: input.context.placeResolver,
        effectOperandBindings,
      });
      if (result.kind === "error") {
        return errorTransition(result.diagnostics);
      }
      return okCoreTransition({
        transition: input.transition,
        context: input.context,
        patches: result.patches,
        certificates: result.certificates,
        packetEntries: result.packetEntries,
      });
    }
    case "compilerRuntime": {
      const runtimeCall = input.context.input.mir.runtimeCalls.get(input.call.target.runtimeCallId);
      if (runtimeCall === undefined) {
        return errorTransition([
          proofCheckDiagnostic({
            severity: "error",
            code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
            messageTemplateId: "runtime.call-missing",
            messageArguments: [{ kind: "text", value: String(input.call.target.runtimeCallId) }],
            message: "Missing runtime call contract",
            ownerKey,
            rootCauseKey: ownerKey,
            stableDetail: `missing-runtime-call:${String(input.call.target.runtimeCallId)}`,
          }),
        ]);
      }
      const operation = input.context.input.runtimeCatalog.get(input.call.target.runtimeId);
      if (operation === undefined) {
        return errorTransition([
          proofCheckDiagnostic({
            severity: "error",
            code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
            messageTemplateId: "runtime.operation-missing",
            messageArguments: [{ kind: "text", value: String(input.call.target.runtimeId) }],
            message: "Missing runtime operation in selected catalog",
            ownerKey,
            rootCauseKey: ownerKey,
            stableDetail: `missing-runtime-operation:${String(input.call.target.runtimeId)}`,
          }),
        ]);
      }
      const result = checkRuntimeContractTransfer({
        state,
        runtimeCall,
        operation,
        call: input.call,
        selectedCatalog: input.context.input.runtimeCatalog,
        embeddedCatalog: input.context.input.mir.runtimeCatalog,
        operationOriginKey: ownerKey,
      });
      if (result.kind === "error") {
        return errorTransition(result.diagnostics);
      }
      return okCoreTransition({
        transition: input.transition,
        context: input.context,
        patches: result.patches,
        certificates: result.certificates,
        packetEntries: result.packetEntries,
      });
    }
    case "compilerIntrinsic": {
      const producedPlace = compilerIntrinsicProducedPlace({
        mir: input.context.input.mir,
        functionInstanceId: input.transition.functionInstanceId,
        call: input.call,
      });
      const produceResult =
        producedPlace === undefined
          ? {
              kind: "ok" as const,
              patches: [],
              certificates: [],
              packetEntries: [],
            }
          : applySummaryProduceEffect({
              state,
              place: { placeKey: producedPlace.placeKey },
              resourceKind: producedPlace.resourceKind,
              operationOriginKey: ownerKey,
              placeResolver: input.context.placeResolver,
              dependencyValueIds: producedPlace.valueIds,
            });
      if (produceResult.kind === "error") {
        return errorTransition(produceResult.diagnostics);
      }
      return okCoreTransition({
        transition: input.transition,
        context: input.context,
        patches: produceResult.patches,
        certificates: produceResult.certificates,
        packetEntries: produceResult.packetEntries,
      });
    }
    default: {
      const unreachable: never = input.call.target;
      return unreachable;
    }
  }
}
