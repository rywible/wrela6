import type { HirPlatformContractEdgeId, CallSiteRequirementId } from "../../hir/ids";
import type { MonoCheckedType, MonoInstantiatedProofId } from "../../mono/mono-hir";
import { coreTypeId } from "../../semantic/ids";
import type { ProofMirCanonicalKey } from "../canonicalization/canonical-keys";
import { draftCallKey } from "../draft/draft-keys";
import type {
  DraftProofMirCallArgument,
  DraftProofMirCallReceiver,
} from "../draft/draft-call-operands";
import { proofMirOwnedCallId } from "../ids";
import type { ProofMirCallTarget } from "../model/calls";
import type { ProofMirDraftOperand } from "./lowering-operands";
import { type CallLoweringIdAllocator, originForCall } from "./call-lowering-shared";
import type { ProofMirCallLoweringInput, ProofMirLoweringContext } from "./lowering-context";
import {
  type DraftRecordedProofMirCall,
  type ProofMirCallLoweringRecorder,
} from "./call-lowering-recorder";

function recordPlatformEnsuredFacts(input: {
  readonly context: ProofMirLoweringContext;
  readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly originKey: ProofMirCanonicalKey;
  readonly recorder: ProofMirCallLoweringRecorder;
}): void {
  const platformEdge = input.context.program.proofMetadata.platformContractEdges.get(input.edgeId);
  if (platformEdge === undefined) {
    return;
  }
  for (const ensuredFact of platformEdge.ensuredFacts) {
    void ensuredFact;
    const factKey = input.context.factRecorder.recordPlatformEnsuredFact({
      role: "trustedAxiom",
      edgeId: input.edgeId,
      dependsOn: [{ kind: "platformEdge", edgeId: input.edgeId }],
      origin: input.originKey,
    });
    if (factKey !== undefined) {
      input.recorder.recordEnsuredFact(input.context.factRecorder.draftFact(factKey));
    }
  }
}

function callResultTypeIsNever(resultType: MonoCheckedType): boolean {
  return resultType.kind === "core" && resultType.coreTypeId === coreTypeId("Never");
}

export function recordCallArtifacts(input: {
  readonly context: ProofMirLoweringContext;
  readonly recorder: ProofMirCallLoweringRecorder;
  readonly idAllocator: CallLoweringIdAllocator;
  readonly callInput: ProofMirCallLoweringInput;
  readonly target: ProofMirCallTarget;
  readonly receiver?: DraftProofMirCallReceiver;
  readonly arguments: readonly DraftProofMirCallArgument[];
  readonly requirements: readonly MonoInstantiatedProofId<CallSiteRequirementId>[];
  readonly result?: ProofMirDraftOperand;
  readonly originSource?: string;
}): DraftRecordedProofMirCall {
  const originKey = originForCall(
    input.context,
    input.callInput.monoExpressionId,
    input.originSource ??
      input.callInput.call.sourceOrigin ??
      (input.target.kind === "compilerRuntime" ? "source:compiler-runtime" : "source:call"),
  );
  const callKey = draftCallKey({
    functionInstanceId: input.context.functionInstanceId,
    monoExpressionId: input.callInput.monoExpressionId,
  });
  const callId = proofMirOwnedCallId(
    input.context.functionInstanceId,
    input.idAllocator.callIdForKey(callKey),
  );
  const statementKey = input.context.graph.addStatement(input.callInput.blockKey, {
    origin: originKey,
  });

  input.context.graph.recordLoweredStatement(input.callInput.blockKey, {
    statementKey,
    originKey,
    kind: { kind: "call", callKey },
  });

  const callRecord: DraftRecordedProofMirCall = {
    callKey,
    callId,
    target: input.target,
    ...(input.receiver === undefined ? {} : { receiver: input.receiver }),
    arguments: input.arguments,
    requirements: input.requirements,
    ...(input.result === undefined ? {} : { result: input.result }),
    originKey,
    statementKey,
  };

  if (callResultTypeIsNever(input.callInput.resultType)) {
    const terminatorResult = input.context.graph.setTerminator(input.callInput.blockKey, {
      kind: "unreachable",
      reason: "afterNever",
      origin: originKey,
    });
    if (terminatorResult.kind === "error") {
      for (const diagnostic of terminatorResult.diagnostics) {
        input.context.buildContext.addDiagnostic(diagnostic);
      }
    }
  }

  input.recorder.recordCallGraphEdge({
    callId,
    target: input.target,
    originKey,
  });

  if (input.target.kind === "certifiedPlatform") {
    input.recorder.recordPlatformEdge({
      edgeId: input.target.edgeId,
      primitiveId: input.target.primitiveId,
      abi: input.target.abi,
      originKey,
    });
    recordPlatformEnsuredFacts({
      context: input.context,
      edgeId: input.target.edgeId,
      originKey,
      recorder: input.recorder,
    });
  }

  const acceptResult = input.context.graph.functionDraft().calls.accept({
    key: callKey,
    functionInstanceId: input.context.functionInstanceId,
    originKey,
    callId: input.idAllocator.callIdForKey(callKey),
    target: input.target,
    ...(input.receiver === undefined ? {} : { receiver: input.receiver }),
    arguments: input.arguments,
    requirements: input.requirements,
    ...(input.result === undefined ? {} : { result: input.result }),
  });
  if (acceptResult.kind === "error") {
    for (const diagnostic of acceptResult.diagnostics) {
      input.context.buildContext.addDiagnostic(diagnostic);
    }
  }

  return callRecord;
}
