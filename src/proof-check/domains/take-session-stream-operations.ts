import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import { openLoan } from "./loans";
import type { OpenTakeStreamInput, TakeSessionTransferResult } from "./take-session-types";
import {
  defaultOwnerKey,
  errorTakeTransfer,
  openObligationPatch,
  openSessionAlreadyExistsDiagnostic,
  openSessionPatch,
  streamLoanForProducer,
} from "./take-session-support";
import { placeStatePatch } from "./validation-state-patches";

export function openTakeStream(input: OpenTakeStreamInput): TakeSessionTransferResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey, "proof-check:take-stream");
  if (input.state.sessions.has(input.sessionKey)) {
    return errorTakeTransfer([
      openSessionAlreadyExistsDiagnostic({ sessionKey: input.sessionKey, ownerKey }),
    ]);
  }

  const streamLoan = streamLoanForProducer(input.producerEdgePathKey);
  const loanResult = openLoan({
    state: input.state,
    loan: streamLoan,
    operationOriginKey: ownerKey,
  });
  if (loanResult.kind === "error") {
    return loanResult;
  }

  const patches: ProofCheckStatePatchEntry[] = [
    openSessionPatch({
      sessionKey: input.sessionKey,
      brandKey: input.brandKey,
      streamLoanKey: streamLoan.loanKey,
    }),
    ...loanResult.patches,
  ];
  if (input.memberPlaceKey !== undefined) {
    patches.push(placeStatePatch(input.memberPlaceKey, "owned"));
  }
  if (!input.state.obligations.has(input.closureObligationKey)) {
    patches.splice(
      1,
      0,
      openObligationPatch({
        obligationKey: input.closureObligationKey,
        status: "open",
        sessionKey: input.sessionKey,
      }),
    );
  }

  return { kind: "ok", patches, packetEntries: loanResult.packetEntries };
}
