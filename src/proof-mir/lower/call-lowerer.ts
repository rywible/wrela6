import { instantiatedHirIdKey, type MonoInstanceId } from "../../mono/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import type { ProofMirPlaceId, ProofMirValueId } from "../ids";
import type { ProofMirCallGraphEdge } from "../model/calls";
import type { DraftProofMirCallReceiver } from "../draft/draft-call-operands";
import type { ProofMirDraftOperand } from "./lowering-operands";
import {
  type ProofMirCallLoweringInput,
  type ProofMirCallLowerer,
  type ProofMirExpressionLowerer,
  type ProofMirLoweringResult,
} from "./lowering-context";
import { recordCallArtifacts } from "./call-lowering-artifacts";
import { lowerMonoCallArguments, lowerMonoCallReceiver } from "./call-lowering-operands";
import { lowerCompilerRuntimeCallImpl } from "./call-lowering-runtime";
import {
  callLoweringIdAllocatorForFunction,
  callSiteRequirementsForExpression,
  loweringOk,
  originForCall,
  type CallLoweringIdAllocator,
} from "./call-lowering-shared";

import {
  createCallLoweringRecorder,
  type ProofMirCallLoweringRecorder,
} from "./call-lowering-recorder";
export {
  createCallLoweringRecorder,
  recordedCallFromFunctionDraft,
  type DraftRecordedProofMirCall,
  type DraftRecordedProofMirCallGraphEdge,
  type DraftRecordedProofMirPlatformEdge,
  type DraftRecordedProofMirRuntimeCallContract,
  type ProofMirCallLoweringRecorder,
} from "./call-lowering-recorder";

export interface CreateProofMirCallLowererInput {
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder?: ProofMirCallLoweringRecorder;
  readonly valueIdForKey?: (key: ProofMirCanonicalKey) => ProofMirValueId;
  readonly placeIdForKey?: (key: ProofMirCanonicalKey) => ProofMirPlaceId;
}

function lowerCallImpl(input: {
  readonly context: ProofMirCallLoweringInput["context"];
  readonly expression: ProofMirExpressionLowerer;
  readonly recorder: ProofMirCallLoweringRecorder;
  readonly idAllocator: CallLoweringIdAllocator;
  readonly valueIdForKey?: (key: ProofMirCanonicalKey) => ProofMirValueId;
  readonly placeIdForKey?: (key: ProofMirCanonicalKey) => ProofMirPlaceId;
  readonly callInput: ProofMirCallLoweringInput;
}): ProofMirLoweringResult<ProofMirDraftOperand> {
  const targetResult = input.context.callTargetIndex.resolveMonoCall({
    call: input.callInput.call,
    monoExpressionId: input.callInput.monoExpressionId,
  });
  if (targetResult.kind === "error") {
    return targetResult;
  }

  let receiver: DraftProofMirCallReceiver | undefined;
  if (input.callInput.call.receiver !== undefined) {
    const loweredReceiver = lowerMonoCallReceiver({
      context: input.context,
      expression: input.expression,
      receiver: input.callInput.call.receiver,
      blockKey: input.callInput.blockKey,
      idAllocator: input.idAllocator,
      valueIdForKey: input.valueIdForKey,
      placeIdForKey: input.placeIdForKey,
    });
    if (loweredReceiver.kind === "error") {
      return loweredReceiver;
    }
    receiver = loweredReceiver.value;
  }

  const loweredArgumentsResult = lowerMonoCallArguments({
    context: input.context,
    expression: input.expression,
    arguments: input.callInput.call.arguments,
    blockKey: input.callInput.blockKey,
    idAllocator: input.idAllocator,
    valueIdForKey: input.valueIdForKey,
    placeIdForKey: input.placeIdForKey,
  });
  if (loweredArgumentsResult.kind === "error") {
    return loweredArgumentsResult;
  }

  const requirements = callSiteRequirementsForExpression(
    input.context.program,
    input.callInput.monoExpressionId,
  );

  const resultValueKey = input.context.graph.createValue({
    role: `call:result:${instantiatedHirIdKey(input.callInput.monoExpressionId)}`,
    origin: originForCall(
      input.context,
      input.callInput.monoExpressionId,
      input.callInput.call.sourceOrigin ?? "source:call",
    ),
    type: input.callInput.resultType,
    resourceKind: input.callInput.resultResourceKind,
  });
  const resultOperand: ProofMirDraftOperand = {
    kind: "value",
    value: resultValueKey,
  };

  recordCallArtifacts({
    context: input.context,
    recorder: input.recorder,
    idAllocator: input.idAllocator,
    callInput: input.callInput,
    target: targetResult.target,
    receiver,
    arguments: loweredArgumentsResult.value,
    requirements,
    result: resultOperand,
  });

  return loweringOk(resultOperand);
}

export function createProofMirCallLowerer(
  input: CreateProofMirCallLowererInput,
): ProofMirCallLowerer {
  const recorder = input.recorder ?? createCallLoweringRecorder();
  const idAllocatorsByFunction = new Map<MonoInstanceId, CallLoweringIdAllocator>();
  return {
    lowerCall(callInput) {
      return lowerCallImpl({
        context: callInput.context,
        expression: input.expression,
        recorder,
        idAllocator: callLoweringIdAllocatorForFunction(
          idAllocatorsByFunction,
          callInput.context.functionInstanceId,
        ),
        valueIdForKey: input.valueIdForKey,
        placeIdForKey: input.placeIdForKey,
        callInput,
      });
    },
    lowerCompilerRuntimeCall(runtimeInput) {
      return lowerCompilerRuntimeCallImpl({
        context: runtimeInput.context,
        expression: input.expression,
        recorder,
        idAllocator: callLoweringIdAllocatorForFunction(
          idAllocatorsByFunction,
          runtimeInput.context.functionInstanceId,
        ),
        valueIdForKey: input.valueIdForKey,
        placeIdForKey: input.placeIdForKey,
        runtimeId: runtimeInput.runtimeId,
        runtimeCallId: runtimeInput.runtimeCallId,
        arguments: runtimeInput.arguments,
        blockKey: runtimeInput.blockKey,
        monoExpressionId: runtimeInput.monoExpressionId,
        resultType: runtimeInput.resultType,
        resultResourceKind: runtimeInput.resultResourceKind,
      });
    },
  };
}

export type { ProofMirCallGraphEdge };
