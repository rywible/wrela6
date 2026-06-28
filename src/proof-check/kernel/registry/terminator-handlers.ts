import { matchAttempt } from "../../domains/attempts";
import { checkProofCheckExtensionTransfer } from "../../domains/extensions";
import { matchValidation } from "../../domains/validation";
import {
  proofCheckProgramPointKey,
  type ProofCheckTransition,
  type ProofCheckTransitionResult,
} from "../transition-api";
import {
  extensionTransition,
  errorTransition,
  identityTransition,
  missingMirMetadataTransition,
  patchTransition,
  resolveAttemptContextForTransition,
  resolveValidationContextForTransition,
  type ProofCheckRegistryContext,
} from "./transition-helpers";

export function handleTerminator(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
}): ProofCheckTransitionResult {
  const terminatorOperation =
    input.transition.operation.kind === "terminator"
      ? input.transition.operation.terminator
      : undefined;
  if (terminatorOperation === undefined) {
    return identityTransition(input.transition);
  }

  const terminatorKind = terminatorOperation.kind;
  const ownerKey = proofCheckProgramPointKey(input.transition.location);
  const state = input.transition.inputState;

  if (terminatorKind.kind === "matchValidation") {
    const validationContext = resolveValidationContextForTransition({
      transition: input.transition,
      context: input.context,
      validationId: terminatorKind.match.validationId,
    });
    if (validationContext === undefined) {
      return missingMirMetadataTransition(input.transition, "matchValidation:missing-context");
    }
    return patchTransition(
      input.transition,
      input.context,
      matchValidation({
        state,
        validationKey: validationContext.validationKey,
        sourcePlaceKey: validationContext.sourcePlaceKey,
        packetPlaceKey: validationContext.packetPlaceKey,
        pendingResultPlaceKey: validationContext.pendingResultPlaceKey,
        layoutKey: validationContext.layoutKey,
        ...(validationContext.payloadPlaceKey === undefined
          ? {}
          : { payloadPlaceKey: validationContext.payloadPlaceKey }),
        operationOriginKey: ownerKey,
      }),
    );
  }

  if (terminatorKind.kind === "matchAttempt") {
    const attemptContext = resolveAttemptContextForTransition({
      transition: input.transition,
      context: input.context,
      attemptId: terminatorKind.match.attemptId,
    });
    if (attemptContext === undefined) {
      return missingMirMetadataTransition(input.transition, "matchAttempt:missing-context");
    }
    return patchTransition(
      input.transition,
      input.context,
      matchAttempt({
        state,
        attemptKey: attemptContext.attemptKey,
        operationOriginKey: ownerKey,
      }),
    );
  }

  if (terminatorKind.kind === "yield" && terminatorKind.gate === "coroutineYield") {
    const extensionResult = checkProofCheckExtensionTransfer({
      category: "yieldResume",
      input: {
        state,
        companion: input.context.input.semantics,
        operationOriginKey: ownerKey,
      },
    });
    if (extensionResult.kind === "error") {
      return errorTransition(extensionResult.diagnostics);
    }
    return extensionTransition(input.transition, input.context, extensionResult);
  }

  return identityTransition(input.transition);
}
