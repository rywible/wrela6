import type { ProofMirControlEdge, ProofMirFunction } from "../../../proof-mir/model/graph";
import { edgeScopeIntroducedPlaceCleanupKeys } from "../../domains/validation-arm-cleanup";
import { transferConsumePlace } from "../../domains/ownership-transfer";
import type { ProofCheckConcreteResourceKind } from "../../domains/ownership";
import { placeStatePatch } from "../../domains/validation-state-patches";
import type { ProofCheckCertificateId } from "../../model/certificates";
import type {
  CheckedFactKindId,
  CheckedFactPacketEntry,
  CheckedFactSubject,
} from "../../model/fact-packet";
import type { ProofCheckStatePatchEntry } from "../state-patch";
import { reduceProofCheckState } from "../state-reducer";
import type { ProofCheckTransition, ProofCheckTransitionResult } from "../transition-api";
import {
  certificateIdForSubject,
  errorTransition,
  patchTransition,
  placeStateForKey,
  tryResolveProofMirPlaceIdForPlaceKey,
  type ProofCheckRegistryContext,
} from "./transition-helpers";

function resourceKindForPlaceKey(input: {
  readonly functionGraph: ProofMirFunction;
  readonly placeKey: string;
  readonly context: ProofCheckRegistryContext;
}): ProofCheckConcreteResourceKind {
  const placeId = tryResolveProofMirPlaceIdForPlaceKey(input.placeKey, input.context.placeResolver);
  return placeId === undefined
    ? "Linear"
    : ((input.functionGraph.places.get(placeId)?.resourceKind ??
        "Linear") satisfies ProofCheckConcreteResourceKind);
}

export function replayNormalScopeExitCleanup(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly functionGraph: ProofMirFunction;
  readonly edge: ProofMirControlEdge;
  readonly operationOriginKey: string;
}): ProofCheckTransitionResult | undefined {
  if (input.edge.kind !== "normal") return undefined;
  let state = input.transition.inputState;
  const patches: ProofCheckStatePatchEntry[] = [];
  const certificates: ProofCheckCertificateId[] = [];
  const packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];

  for (const placeKey of edgeScopeIntroducedPlaceCleanupKeys({
    functionGraph: input.functionGraph,
    edge: input.edge,
    placeResolver: input.context.placeResolver,
  })) {
    if (placeStateForKey(state, placeKey, input.context.placeResolver)?.lifecycle !== "owned") {
      continue;
    }
    const consumeResult = transferConsumePlace({
      state,
      place: { placeKey },
      resourceKind: resourceKindForPlaceKey({
        functionGraph: input.functionGraph,
        placeKey,
        context: input.context,
      }),
      operationOriginKey: `${input.operationOriginKey}:scope-exit:${placeKey}`,
      placeResolver: input.context.placeResolver,
      functionGraph: input.functionGraph,
    });
    if (consumeResult.kind === "error") return errorTransition(consumeResult.diagnostics);

    const certificate =
      consumeResult.certificates[0] ??
      certificateIdForSubject(input.context, `${input.operationOriginKey}:scope-exit:${placeKey}`);
    const reduction = reduceProofCheckState(state, {
      kind: "coreTransfer",
      transitionId: input.transition.transitionId,
      certificate,
      entries: [
        ...consumeResult.patches,
        placeStatePatch(placeKey, "uninitialized", input.context.placeResolver),
      ],
    });
    if (reduction.kind === "error") return errorTransition(reduction.diagnostics);
    state = reduction.state;
    patches.push(
      ...consumeResult.patches,
      placeStatePatch(placeKey, "uninitialized", input.context.placeResolver),
    );
    certificates.push(...consumeResult.certificates);
    packetEntries.push(...consumeResult.packetEntries);
  }

  if (patches.length === 0) return undefined;
  return patchTransition(input.transition, input.context, {
    kind: "ok",
    patches,
    certificates,
    packetEntries,
  });
}
