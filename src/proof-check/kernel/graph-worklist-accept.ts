import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirBlockId } from "../../proof-mir/ids";
import type { ProofCheckDiagnostic } from "../diagnostics";
import type {
  CheckedBlockStateCertificate,
  ProofCheckCoreCertificate,
  ProofCheckCertificateId,
} from "../model/certificates";
import type { ProofCheckCertificateRegistry } from "./certificate-registry";
import type { ProofCheckResourceLimitHooks } from "./resource-limits";
import type { ProofCheckPacketStage } from "./packet-stage";
import { proofCheckStateKey } from "./state-key";
import type { ProofCheckState } from "./state";

export function recordAcceptedBlockState(input: {
  readonly staged: ProofCheckPacketStage;
  readonly acceptedBlockStates: CheckedBlockStateCertificate[];
  readonly coreCertificates: ProofCheckCoreCertificate[];
  readonly certificateRegistry: ProofCheckCertificateRegistry;
  readonly resourceLimitHooks: ProofCheckResourceLimitHooks;
  readonly diagnostics: ProofCheckDiagnostic[];
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly state: ProofCheckState;
  readonly stagedPacketEntryCount: number;
  readonly counterexampleFrameCount: number;
}): boolean {
  const limitResult = input.resourceLimitHooks.beforeAcceptState?.({
    functionInstanceId: input.functionInstanceId,
    blockId: input.blockId,
    state: input.state,
    stagedPacketEntryCount: input.stagedPacketEntryCount,
    counterexampleFrameCount: input.counterexampleFrameCount,
  });
  if (limitResult?.kind === "error") {
    input.diagnostics.push(...limitResult.diagnostics);
    return false;
  }

  input.staged.commit(input.blockId);

  const stateKey = proofCheckStateKey(input.state);
  const subjectKey = `block-state:${String(input.functionInstanceId)}:${String(input.blockId)}:${stateKey}`;
  const certificateId = input.certificateRegistry.allocateCoreCertificateId(subjectKey);
  const coreCertificate: ProofCheckCoreCertificate = {
    certificateId,
    rule: "coreEntailment",
    subjectKey,
    dependencyKeys: [],
  };
  if (
    !input.coreCertificates.some((entry) => String(entry.certificateId) === String(certificateId))
  ) {
    input.coreCertificates.push(coreCertificate);
  }

  const certificate: ProofCheckCertificateId = { kind: "core", id: certificateId };
  input.acceptedBlockStates.push({
    certificateId: certificate,
    functionInstanceId: input.functionInstanceId,
    blockId: input.blockId,
    stateKey,
  });
  return true;
}
