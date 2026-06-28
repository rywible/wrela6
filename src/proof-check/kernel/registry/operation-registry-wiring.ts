import type { ProofCheckOperationTransferRegistry } from "../operation-dispatch";
import { checkLocalTerminalExit } from "../../domains/terminal";
import {
  proofCheckProgramPointKey,
  type ProofCheckTransition,
  type ProofCheckTransitionResult,
} from "../transition-api";
import {
  coreCertificate,
  identityTransition,
  okCoreTransition,
  entryStateCertificateSideEffect,
  originForOperation,
  patchTransition,
  recordCertificate,
  terminalReachabilityRequired,
  type BuildProofCheckOperationTransferRegistryInput,
  type ProofCheckRegistryContext,
} from "./transition-helpers";
import { handleCallTransfer } from "./call-handlers";
import { handleStatement } from "./statement-handlers";
import { handleTerminator } from "./terminator-handlers";
import { handleEdge, handleLoopHeader } from "./edge-handlers";

export type {
  ProofCheckRegistryContext,
  BuildProofCheckOperationTransferRegistryInput,
  ProofCheckPlaceResolver,
} from "./transition-helpers";
export { createProofCheckPlaceResolver } from "./transition-helpers";

export function handleFunctionEntry(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
}): ProofCheckTransitionResult {
  const ownerKey = proofCheckProgramPointKey(input.transition.location);
  const entryCoreCertificate = coreCertificate(
    input.context,
    `entry:${String(input.transition.functionInstanceId)}`,
    "initialState",
  );
  const certificate = recordCertificate(input.context, entryCoreCertificate);
  return okCoreTransition({
    transition: input.transition,
    context: input.context,
    patches: [],
    certificates: [certificate],
    packetEntries: [],
    stagedOrigins: [originForOperation(ownerKey)],
    registryEffects: [entryStateCertificateSideEffect(certificate)],
  });
}

export function buildProofCheckOperationTransferRegistry(
  input: BuildProofCheckOperationTransferRegistryInput,
): ProofCheckOperationTransferRegistry {
  const { context } = input;

  return {
    functionEntry: (handlerInput) =>
      handleFunctionEntry({ transition: handlerInput.transition, context }),
    statement: (handlerInput) =>
      handleStatement({
        transition: handlerInput.transition,
        context,
        statement: handlerInput.operation.statement,
      }),
    terminator: (handlerInput) =>
      handleTerminator({ transition: handlerInput.transition, context }),
    edge: (handlerInput) => handleEdge({ transition: handlerInput.transition, context }),
    call: (handlerInput) =>
      handleCallTransfer({
        transition: handlerInput.transition,
        context,
        call: handlerInput.operation.call,
      }),
    join: (handlerInput) => identityTransition(handlerInput.transition),
    loopHeader: (handlerInput) =>
      handleLoopHeader({ transition: handlerInput.transition, context }),
    exit: (handlerInput) => {
      if (handlerInput.operation.kind !== "exit") {
        return identityTransition(handlerInput.transition);
      }
      const ownerKey = proofCheckProgramPointKey(handlerInput.transition.location);
      return patchTransition(
        handlerInput.transition,
        context,
        checkLocalTerminalExit({
          state: handlerInput.transition.inputState,
          terminalReachabilityRequired: terminalReachabilityRequired(
            handlerInput.operation.exit.closure,
          ),
          operationOriginKey: ownerKey,
        }),
      );
    },
    terminalClosure: (handlerInput) => identityTransition(handlerInput.transition),
  };
}
