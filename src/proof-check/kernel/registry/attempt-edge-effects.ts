import type { ProofMirControlEdge, ProofMirFunction } from "../../../proof-mir/model/graph";
import { transferConsumePlace } from "../../domains/ownership-transfer";
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
import type { ProofCheckTransition } from "../transition-api";
import {
  certificateIdForSubject,
  structuredPlace,
  type ProofCheckRegistryContext,
} from "./transition-helpers";

type AttemptEdgeEffectReplayResult =
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

function unsupportedAttemptEdgeEffectDiagnostic(input: {
  readonly transition: ProofCheckTransition;
  readonly ownerKey: string;
  readonly effectKind: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
    messageTemplateId: "proof-check.attempt.unsupported-edge-effect",
    messageArguments: [{ kind: "text", value: input.effectKind }],
    message: `Unsupported attempt edge effect ${input.effectKind}`,
    ownerKey: input.ownerKey,
    rootCauseKey: input.ownerKey,
    stableDetail: `attempt-edge-effect:unsupported:${input.effectKind}`,
    functionInstanceId: input.transition.functionInstanceId,
  });
}

export function replayAttemptEdgeEffects(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly functionGraph: ProofMirFunction;
  readonly edge: ProofMirControlEdge;
  readonly operationOriginKey: string;
}): AttemptEdgeEffectReplayResult {
  let state = input.transition.inputState;
  const patches: ProofCheckStatePatchEntry[] = [];
  const certificates: ProofCheckCertificateId[] = [];
  const packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];

  for (const effect of input.edge.effects) {
    const effectOriginKey = `${input.operationOriginKey}:edge-effect:${effect.kind}`;
    if (effect.kind !== "consumePlace") {
      return {
        kind: "error",
        diagnostics: [
          unsupportedAttemptEdgeEffectDiagnostic({
            transition: input.transition,
            ownerKey: input.operationOriginKey,
            effectKind: effect.kind,
          }),
        ],
      };
    }

    const place = input.functionGraph.places.get(effect.placeId);
    const consumeResult = transferConsumePlace({
      state,
      place: structuredPlace(effect.placeId),
      resourceKind: place?.resourceKind ?? "Linear",
      operationOriginKey: `${effectOriginKey}:${String(effect.placeId)}`,
      placeResolver: input.context.placeResolver,
      functionGraph: input.functionGraph,
    });
    if (consumeResult.kind === "error") {
      return consumeResult;
    }

    const certificate =
      consumeResult.certificates[0] ??
      certificateIdForSubject(input.context, `${effectOriginKey}:${String(effect.placeId)}`);
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
