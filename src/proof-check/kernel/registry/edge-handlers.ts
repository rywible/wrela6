import type { ProofMirControlEdgeId, ProofMirExitEdgeId } from "../../../proof-mir/ids";
import { proofMirPlaceId } from "../../../proof-mir/ids";
import type { ProofMirExitEdge, ProofMirFunction } from "../../../proof-mir/model/graph";
import { checkAttemptErrorEdge, checkAttemptSuccessEdge } from "../../domains/attempts";
import { checkProofCheckExtensionTransfer } from "../../domains/extensions";
import { streamMemberForMirReference } from "../../domains/mir-operation-metadata";
import { transferConsumePlace } from "../../domains/ownership-transfer";
import {
  checkLocalTerminalExit,
  transferDivergenceExit,
  type LocalTerminalExitResult,
} from "../../domains/terminal";
import { transferValidationErrArm, transferValidationOkArm } from "../../domains/validation";
import {
  introducedValidationArmLayoutPlaceKeysFromEdge,
  introducedValidationArmPlaceKeysFromEdge,
  validationArmCleanupPlaceKeys,
} from "../../domains/validation-arm-cleanup";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../../diagnostics";
import type { ProofCheckCertificateId } from "../../model/certificates";
import type {
  CheckedFactKindId,
  CheckedFactPacketEntry,
  CheckedFactSubject,
} from "../../model/fact-packet";
import type { ProofCheckState } from "../state";
import type { ProofCheckStatePatchEntry } from "../state-patch";
import { reduceProofCheckState } from "../state-reducer";
import {
  proofCheckProgramPointKey,
  type ProofCheckTransition,
  type ProofCheckTransitionResult,
} from "../transition-api";
import {
  certificateIdForSubject,
  coreCertificate,
  errorTransition,
  exitClosurePacketEntry,
  exitCertificateSideEffect,
  exitStateSideEffect,
  extensionTransition,
  identityTransition,
  okCoreTransition,
  patchTransition,
  recordCertificate,
  stableNumericSeed,
  attemptIdFromEdgeSourceBlock,
  resolveAttemptContextForTransition,
  resolveExitEdge,
  resolveFunctionGraph,
  resolveValidationContextForTransition,
  terminalReachabilityRequired,
  validationIdFromEdgeSourceBlock,
  missingMirMetadataTransition,
  type ProofCheckRegistryContext,
} from "./transition-helpers";

type ReturnScopeCleanupResult =
  | {
      readonly kind: "ok";
      readonly state: ProofCheckState;
      readonly patches: readonly ProofCheckStatePatchEntry[];
      readonly certificates: readonly ProofCheckCertificateId[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export function handleReturnExitEdge(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly functionGraph: ProofMirFunction;
  readonly exitId: ProofMirExitEdgeId;
  readonly edgeId: ProofMirControlEdgeId;
}): ProofCheckTransitionResult {
  const exit = resolveExitEdge(input.functionGraph, input.exitId);
  if (exit === undefined) {
    return errorTransition([
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
        messageTemplateId: "proof-check.edge.missing-exit",
        messageArguments: [{ kind: "text", value: String(input.exitId) }],
        message: `Missing exit edge ${String(input.exitId)}`,
        ownerKey: proofCheckProgramPointKey(input.transition.location),
        rootCauseKey: proofCheckProgramPointKey(input.transition.location),
        stableDetail: `missing-exit:${String(input.exitId)}`,
        functionInstanceId: input.transition.functionInstanceId,
      }),
    ]);
  }

  const ownerKey = proofCheckProgramPointKey(input.transition.location);
  const cleanupResult =
    exit.kind === "panic"
      ? ({
          kind: "ok",
          state: input.transition.inputState,
          patches: [],
          certificates: [],
          packetEntries: [],
        } satisfies ReturnScopeCleanupResult)
      : consumeValidationArmPlacesForReturn({
          transition: input.transition,
          context: input.context,
          functionGraph: input.functionGraph,
          exit,
          operationOriginKey: ownerKey,
        });
  if (cleanupResult.kind === "error") {
    return errorTransition(cleanupResult.diagnostics);
  }

  let domainResult: LocalTerminalExitResult;
  if (exit.kind === "panic") {
    domainResult = transferDivergenceExit({
      state: cleanupResult.state,
      kind: "panic",
      divergenceKey: `panic:${String(input.edgeId)}`,
      boundary: exit.boundary,
      operationOriginKey: ownerKey,
    });
  } else {
    domainResult = checkLocalTerminalExit({
      state: cleanupResult.state,
      terminalReachabilityRequired: terminalReachabilityRequired(exit.closure),
      operationOriginKey: ownerKey,
    });
  }

  if (domainResult.kind === "error") {
    return errorTransition(domainResult.diagnostics);
  }

  const emptyExitStateKey = `${String(input.transition.functionInstanceId)}:${String(input.exitId)}`;
  const exitPlaceId = proofMirPlaceId(stableNumericSeed(`exit:${emptyExitStateKey}`));
  const exitCertificateSubjectKey = `place:${String(exitPlaceId)}`;
  const certificate = recordCertificate(
    input.context,
    coreCertificate(input.context, exitCertificateSubjectKey, "exitClosure"),
  );
  const packetEntries = [
    ...cleanupResult.packetEntries,
    ...domainResult.packetEntries,
    exitClosurePacketEntry(input.context, {
      operationOriginKey: ownerKey,
      emptyExitStateKey,
      certificate,
    }),
  ];

  return okCoreTransition({
    transition: input.transition,
    context: input.context,
    patches: [...cleanupResult.patches, ...domainResult.patches],
    certificates: cleanupResult.certificates,
    packetEntries,
    registryEffects: [
      exitStateSideEffect(cleanupResult.state),
      exitCertificateSideEffect(certificate),
    ],
  });
}

function consumeValidationArmPlacesForReturn(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly functionGraph: ProofMirFunction;
  readonly exit: ProofMirExitEdge;
  readonly operationOriginKey: string;
}): ReturnScopeCleanupResult {
  let state = input.transition.inputState;
  const patches: ProofCheckStatePatchEntry[] = [];
  const certificates: ProofCheckCertificateId[] = [];
  const packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];

  for (const placeKey of validationArmCleanupPlaceKeys({
    functionGraph: input.functionGraph,
    exit: input.exit,
    placeResolver: input.context.placeResolver,
  })) {
    if (state.places.get(placeKey)?.lifecycle !== "owned") {
      continue;
    }
    const consumeResult = transferConsumePlace({
      state,
      place: { placeKey },
      resourceKind: "Linear",
      operationOriginKey: `${input.operationOriginKey}:validation-arm-scope-exit:${placeKey}`,
      placeResolver: input.context.placeResolver,
      functionGraph: input.functionGraph,
    });
    if (consumeResult.kind === "error") {
      return consumeResult;
    }

    const certificate =
      consumeResult.certificates[0] ??
      certificateIdForSubject(
        input.context,
        `${input.operationOriginKey}:validation-arm-scope-exit:${placeKey}`,
      );
    const reduction = reduceProofCheckState(state, {
      kind: "coreTransfer",
      transitionId: input.transition.transitionId,
      certificate,
      entries: consumeResult.patches,
    });
    if (reduction.kind === "error") {
      return {
        kind: "error",
        diagnostics: reduction.diagnostics,
      };
    }

    state = reduction.state;
    patches.push(...consumeResult.patches);
    certificates.push(...consumeResult.certificates);
    packetEntries.push(...consumeResult.packetEntries);
  }

  return {
    kind: "ok",
    state,
    patches,
    certificates,
    packetEntries,
  };
}

export function handleEdge(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
}): ProofCheckTransitionResult {
  if (input.transition.operation.kind !== "edge") {
    return identityTransition(input.transition);
  }

  const edge = input.transition.operation.edge;
  const functionGraph = resolveFunctionGraph(
    input.context.input.mir,
    input.transition.functionInstanceId,
  );
  if (functionGraph === undefined) {
    return identityTransition(input.transition);
  }

  const ownerKey = proofCheckProgramPointKey(input.transition.location);
  const state = input.transition.inputState;

  if (edge.exit !== undefined) {
    return handleReturnExitEdge({
      transition: input.transition,
      context: input.context,
      functionGraph,
      exitId: edge.exit,
      edgeId: edge.edgeId,
    });
  }

  switch (edge.kind) {
    case "validationOk": {
      const validationId = validationIdFromEdgeSourceBlock(functionGraph, edge);
      if (validationId === undefined) {
        return missingMirMetadataTransition(input.transition, "validationOk:missing-validation-id");
      }
      const validationContext = resolveValidationContextForTransition({
        transition: input.transition,
        context: input.context,
        validationId,
        edge,
      });
      if (validationContext === undefined) {
        return missingMirMetadataTransition(input.transition, "validationOk:missing-context");
      }
      return patchTransition(
        input.transition,
        input.context,
        transferValidationOkArm({
          state,
          validationKey: validationContext.validationKey,
          sourcePlaceKey: validationContext.sourcePlaceKey,
          packetPlaceKey: validationContext.packetPlaceKey,
          layoutKey: validationContext.layoutKey,
          ...(validationContext.payloadPlaceKey === undefined
            ? {}
            : { payloadPlaceKey: validationContext.payloadPlaceKey }),
          additionalOwnedPlaceKeys: introducedValidationArmPlaceKeysFromEdge({
            functionGraph,
            edge,
            placeResolver: input.context.placeResolver,
          }),
          additionalLayoutPlaceKeys: introducedValidationArmLayoutPlaceKeysFromEdge({
            functionGraph,
            edge,
            placeResolver: input.context.placeResolver,
          }),
          operationOriginKey: ownerKey,
          ...(input.context.placeResolver === undefined
            ? {}
            : { placeResolver: input.context.placeResolver }),
        }),
      );
    }
    case "validationErr": {
      const validationId = validationIdFromEdgeSourceBlock(functionGraph, edge);
      if (validationId === undefined) {
        return missingMirMetadataTransition(
          input.transition,
          "validationErr:missing-validation-id",
        );
      }
      const validationContext = resolveValidationContextForTransition({
        transition: input.transition,
        context: input.context,
        validationId,
        edge,
      });
      if (validationContext === undefined) {
        return missingMirMetadataTransition(input.transition, "validationErr:missing-context");
      }
      return patchTransition(
        input.transition,
        input.context,
        transferValidationErrArm({
          state,
          validationKey: validationContext.validationKey,
          sourcePlaceKey: validationContext.sourcePlaceKey,
          ...(validationContext.errPayloadPlaceKey === undefined
            ? {}
            : { errPayloadPlaceKey: validationContext.errPayloadPlaceKey }),
          additionalOwnedPlaceKeys: introducedValidationArmPlaceKeysFromEdge({
            functionGraph,
            edge,
            placeResolver: input.context.placeResolver,
          }),
          operationOriginKey: ownerKey,
          ...(input.context.placeResolver === undefined
            ? {}
            : { placeResolver: input.context.placeResolver }),
        }),
      );
    }
    case "attemptSuccess": {
      const attemptId = attemptIdFromEdgeSourceBlock(functionGraph, edge);
      if (attemptId === undefined) {
        return missingMirMetadataTransition(input.transition, "attemptSuccess:missing-attempt-id");
      }
      const attemptContext = resolveAttemptContextForTransition({
        transition: input.transition,
        context: input.context,
        attemptId,
        edge,
      });
      if (attemptContext === undefined) {
        return missingMirMetadataTransition(input.transition, "attemptSuccess:missing-context");
      }
      return patchTransition(
        input.transition,
        input.context,
        checkAttemptSuccessEdge({
          originalState: state,
          armState: state,
          declaredInputs: attemptContext.declaredInputs,
          operationOriginKey: ownerKey,
        }),
      );
    }
    case "attemptError": {
      const attemptId = attemptIdFromEdgeSourceBlock(functionGraph, edge);
      if (attemptId === undefined) {
        return missingMirMetadataTransition(input.transition, "attemptError:missing-attempt-id");
      }
      const attemptContext = resolveAttemptContextForTransition({
        transition: input.transition,
        context: input.context,
        attemptId,
        edge,
      });
      if (attemptContext === undefined) {
        return missingMirMetadataTransition(input.transition, "attemptError:missing-context");
      }
      return patchTransition(
        input.transition,
        input.context,
        checkAttemptErrorEdge({
          originalState: state,
          edgeState: state,
          declaredInputs: attemptContext.declaredInputs,
          operationOriginKey: ownerKey,
        }),
      );
    }
    default:
      return identityTransition(input.transition);
  }
}

export function handleLoopHeader(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
}): ProofCheckTransitionResult {
  if (input.transition.location.kind !== "loopHeader") {
    return identityTransition(input.transition);
  }

  const functionGraph = resolveFunctionGraph(
    input.context.input.mir,
    input.transition.functionInstanceId,
  );
  if (functionGraph === undefined) {
    return identityTransition(input.transition);
  }

  const block = functionGraph.blocks.get(input.transition.location.blockId);
  const sessionMembers = block?.stateMerge?.boundaryResources.sessionMembers ?? [];
  if (sessionMembers.length === 0) {
    return identityTransition(input.transition);
  }

  const yieldedMember = sessionMembers[0];
  if (yieldedMember === undefined) {
    return identityTransition(input.transition);
  }

  const ownerKey = proofCheckProgramPointKey(input.transition.location);
  const { memberKey, sessionKey } = streamMemberForMirReference(yieldedMember);
  const extensionResult = checkProofCheckExtensionTransfer({
    category: "streamLoop",
    input: {
      state: input.transition.inputState,
      streamSessionKey: sessionKey,
      yieldedMemberKey: memberKey,
      companion: input.context.input.semantics,
      operationOriginKey: ownerKey,
      transitionId: input.transition.transitionId,
    },
  });
  if (extensionResult.kind === "error") {
    return errorTransition(extensionResult.diagnostics);
  }
  return extensionTransition(input.transition, input.context, extensionResult);
}
