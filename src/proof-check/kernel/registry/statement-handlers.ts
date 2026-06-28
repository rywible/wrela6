import type { ProofMirStatement } from "../../../proof-mir/model/graph";
import { recordAttempt } from "../../domains/attempts";
import { openLoan, closeLoan } from "../../domains/loans";
import {
  advancePrivateStateInputFromMir,
  factScopeForProgramPoint,
  mirProofMetadataKey,
  mirPlaceKey,
  structuredPlaceForMirPlace,
  takeSessionTransferForTakeStatement,
  validatedBufferReadRequirementFromMir,
} from "../../domains/mir-operation-metadata";
import { advancePrivateState } from "../../domains/private-state";
import {
  observeCopyPlace,
  transferAssignPlace,
  transferConsumePlace,
  transferMovePlace,
} from "../../domains/ownership";
import {
  closeTakeSession,
  dischargeTakeObligation,
  openTakeObligation,
  transferTakeSession,
} from "../../domains/take-sessions";
import {
  checkValidatedBufferReadRequirement,
  validatedBufferPacketEntriesForRead,
} from "../../domains/validated-buffers";
import { createValidation } from "../../domains/validation";
import { normalizeProofCheckTerm } from "../../model/fact-language";
import { proofCheckDiagnostic } from "../../diagnostics";
import {
  proofCheckProgramPointKey,
  type ProofCheckTransition,
  type ProofCheckTransitionResult,
} from "../transition-api";
import { callGraphEdgeForStatement, handleCallTransfer } from "./call-handlers";
import { handleExtensionStatement } from "./extension-statement-handlers";
import {
  certificateIdForSubject,
  errorTransition,
  handleTakeSessionStatement,
  identityTransition,
  missingMirMetadataTransition,
  okCoreTransition,
  ownershipTransition,
  patchTransition,
  placeKeyForMirPlace,
  recordLayoutEntailmentCertificates,
  resolveFunctionGraph,
  structuredPlace,
  type ProofCheckRegistryContext,
} from "./transition-helpers";

export function handleStatement(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly statement: ProofMirStatement;
}): ProofCheckTransitionResult {
  const ownerKey = proofCheckProgramPointKey(input.transition.location);
  const state = input.transition.inputState;
  const statementKind = input.statement.kind;

  switch (statementKind.kind) {
    case "literal":
    case "unary":
    case "binary":
    case "comparison":
    case "requireFact":
    case "recordFactEvidence":
    case "bindLayoutTerm":
      return identityTransition(input.transition);
    case "load":
      return ownershipTransition(
        input.transition,
        input.context,
        observeCopyPlace({
          state,
          place: structuredPlace(statementKind.place),
          resourceKind: "Copy",
          operationOriginKey: ownerKey,
          placeResolver: input.context.placeResolver,
        }),
        {
          kind: "observes",
          placeKey: placeKeyForMirPlace(statementKind.place),
          borrowMode: "shared",
        },
      );
    case "store":
      return ownershipTransition(
        input.transition,
        input.context,
        transferAssignPlace({
          state,
          source: structuredPlace(statementKind.place),
          destination: structuredPlace(statementKind.place),
          resourceKind: "Copy",
          operationOriginKey: ownerKey,
          placeResolver: input.context.placeResolver,
        }),
        { kind: "mutates", placeKey: placeKeyForMirPlace(statementKind.place) },
      );
    case "movePlace":
      return ownershipTransition(
        input.transition,
        input.context,
        transferMovePlace({
          state,
          source: structuredPlace(statementKind.place),
          destination: structuredPlace(statementKind.place),
          operationOriginKey: ownerKey,
          placeResolver: input.context.placeResolver,
        }),
        { kind: "mutates", placeKey: placeKeyForMirPlace(statementKind.place) },
      );
    case "consumePlace": {
      const functionGraph = resolveFunctionGraph(
        input.context.input.mir,
        input.transition.functionInstanceId,
      );
      return ownershipTransition(
        input.transition,
        input.context,
        transferConsumePlace({
          state,
          place: structuredPlace(statementKind.place),
          resourceKind: "Linear",
          operationOriginKey: ownerKey,
          placeResolver: input.context.placeResolver,
          ...(functionGraph === undefined ? {} : { functionGraph }),
        }),
        { kind: "consumes", placeKey: placeKeyForMirPlace(statementKind.place) },
      );
    }
    case "borrowPlace":
      return patchTransition(
        input.transition,
        input.context,
        openLoan({
          state,
          loan: {
            loanKey: String(statementKind.loan.loanId),
            placeKey: placeKeyForMirPlace(statementKind.loan.placeId),
            mode: statementKind.loan.mode,
          },
          operationOriginKey: ownerKey,
          placeResolver: input.context.placeResolver,
        }),
      );
    case "releaseLoan":
      return patchTransition(
        input.transition,
        input.context,
        closeLoan({
          state,
          loanKey: String(statementKind.loan.loanId),
          operationOriginKey: ownerKey,
        }),
      );
    case "call": {
      const callEdge = callGraphEdgeForStatement(
        input.context.input.mir,
        input.transition.functionInstanceId,
        statementKind.call.callId,
      );
      if (callEdge === undefined) {
        return errorTransition([
          proofCheckDiagnostic({
            severity: "error",
            code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
            messageTemplateId: "proof-check.call.missing",
            messageArguments: [{ kind: "text", value: String(statementKind.call.callId) }],
            message: "Missing call graph edge for statement call",
            ownerKey,
            rootCauseKey: ownerKey,
            stableDetail: `missing-call:${String(statementKind.call.callId)}`,
          }),
        ]);
      }
      return handleCallTransfer({
        transition: input.transition,
        context: input.context,
        call: callEdge,
      });
    }
    case "validate":
      return patchTransition(
        input.transition,
        input.context,
        createValidation({
          state,
          validationKey: mirProofMetadataKey(statementKind.validation.validationId),
          sourcePlaceKey: mirPlaceKey(statementKind.validation.sourcePlace),
          pendingResultPlaceKey: mirPlaceKey(statementKind.validation.pendingResultPlace),
          packetPlaceKey: mirPlaceKey(statementKind.validation.okPacketPlace),
          layoutKey: String(statementKind.validation.validatedBufferInstanceId),
          operationOriginKey: ownerKey,
          placeResolver: input.context.placeResolver,
        }),
      );
    case "attempt":
      return patchTransition(
        input.transition,
        input.context,
        recordAttempt({
          state,
          attemptKey: mirProofMetadataKey(statementKind.attempt.attemptId),
          declaredInputs: statementKind.attempt.inputPlaces.map((place) =>
            structuredPlaceForMirPlace(place),
          ),
          operationOriginKey: ownerKey,
        }),
      );
    case "take": {
      const transferInput = takeSessionTransferForTakeStatement({
        mir: input.context.input.mir,
        take: statementKind.take,
      });
      if (transferInput === undefined) {
        return missingMirMetadataTransition(input.transition, "take:missing-transfer-input");
      }
      return handleTakeSessionStatement({
        transition: input.transition,
        context: input.context,
        transfer: transferTakeSession({
          state,
          ...transferInput,
          operationOriginKey: ownerKey,
        }),
        missingDetail: "take:missing-transfer-input",
      });
    }
    case "openSessionMember": {
      const member = statementKind.member;
      if (member.obligationId === undefined) {
        return identityTransition(input.transition);
      }
      return handleTakeSessionStatement({
        transition: input.transition,
        context: input.context,
        transfer: openTakeObligation({
          state,
          obligationKey: mirProofMetadataKey(member.obligationId),
          sessionKey: mirProofMetadataKey(member.sessionId),
          operationOriginKey: ownerKey,
        }),
        missingDetail: "openSessionMember:missing-obligation",
      });
    }
    case "closeSessionMember":
      return handleTakeSessionStatement({
        transition: input.transition,
        context: input.context,
        transfer: closeTakeSession({
          state,
          sessionKey: mirProofMetadataKey(statementKind.member.sessionId),
          operationOriginKey: ownerKey,
        }),
        missingDetail: "closeSessionMember:missing-session",
      });
    case "openObligation":
      return handleTakeSessionStatement({
        transition: input.transition,
        context: input.context,
        transfer: openTakeObligation({
          state,
          obligationKey: mirProofMetadataKey(statementKind.obligation.obligationId),
          operationOriginKey: ownerKey,
        }),
        missingDetail: "openObligation:missing-target",
      });
    case "dischargeObligation":
      return handleTakeSessionStatement({
        transition: input.transition,
        context: input.context,
        transfer: dischargeTakeObligation({
          state,
          obligationKey: mirProofMetadataKey(statementKind.obligation.obligationId),
          operationOriginKey: ownerKey,
        }),
        missingDetail: "dischargeObligation:missing-target",
      });
    case "advancePrivateState": {
      const advanceInput = advancePrivateStateInputFromMir({
        mir: input.context.input.mir,
        functionInstanceId: input.transition.functionInstanceId,
        transition: statementKind.transition,
        operationOriginKey: ownerKey,
        programPointScope: factScopeForProgramPoint(input.transition.location),
      });
      if (advanceInput === undefined) {
        return missingMirMetadataTransition(
          input.transition,
          "advancePrivateState:missing-generation",
        );
      }
      const advanceResult = advancePrivateState({
        state,
        ...advanceInput,
      });
      if (advanceResult.kind === "error") {
        return errorTransition(advanceResult.diagnostics);
      }
      return okCoreTransition({
        transition: input.transition,
        context: input.context,
        patches: advanceResult.patches,
        certificates: [certificateIdForSubject(input.context, ownerKey)],
        packetEntries: advanceResult.packetEntries,
      });
    }
    case "readValidatedBufferField": {
      const functionGraph = resolveFunctionGraph(
        input.context.input.mir,
        input.transition.functionInstanceId,
      );
      if (functionGraph === undefined) {
        return missingMirMetadataTransition(
          input.transition,
          "readValidatedBufferField:missing-function",
        );
      }
      const readRequirement = validatedBufferReadRequirementFromMir({
        mir: input.context.input.mir,
        functionGraph,
        functionInstanceId: input.transition.functionInstanceId,
        read: statementKind.read,
      });
      if (readRequirement === undefined) {
        return missingMirMetadataTransition(
          input.transition,
          "readValidatedBufferField:missing-layout-field",
        );
      }
      const dischargedRequirementTerms = readRequirement.readRequirements.filter((requirement) =>
        [...state.facts.values()].some(
          (fact) => fact.termKey === normalizeProofCheckTerm(requirement).key,
        ),
      );
      const readResult = checkValidatedBufferReadRequirement({
        state,
        read: readRequirement,
        factTerms: dischargedRequirementTerms,
        layoutProgram: input.context.input.mir.layout,
        ownerKey,
      });
      if (readResult.kind === "error") {
        return errorTransition(readResult.diagnostics);
      }
      const recordedLayoutCertificates = recordLayoutEntailmentCertificates(
        input.context,
        readResult.certificates,
      );
      const packetEntries = validatedBufferPacketEntriesForRead({
        certificates: recordedLayoutCertificates.certificates,
        validatedBufferInstanceId: String(statementKind.read.validatedBufferInstanceId),
        placeId: statementKind.read.sourcePlace,
        operationOriginKey: ownerKey,
      });
      return okCoreTransition({
        transition: input.transition,
        context: input.context,
        patches: [],
        certificates:
          recordedLayoutCertificates.certificateIds.length > 0
            ? [...recordedLayoutCertificates.certificateIds]
            : [certificateIdForSubject(input.context, ownerKey)],
        packetEntries,
      });
    }
    case "extension":
      return handleExtensionStatement({
        transition: input.transition,
        context: input.context,
        extension: statementKind.extension,
      });
    default: {
      const unreachable: never = statementKind;
      return unreachable;
    }
  }
}
