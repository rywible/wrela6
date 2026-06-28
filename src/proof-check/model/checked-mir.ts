import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirProgram } from "../../proof-mir/model/program";
import type {
  CheckedBlockStateCertificate,
  CheckedFunctionSummaryCertificateId,
  CheckedTerminalGraphCertificate,
  ProofCheckCertificateId,
} from "./certificates";
import type { CheckedFactPacket, CheckedOriginMap } from "./fact-packet";
import type { CheckedFunctionSummaryTable } from "./function-summary";

export interface CheckedMirFunction {
  readonly functionInstanceId: MonoInstanceId;
  readonly entryStateCertificate: ProofCheckCertificateId;
  readonly exitCertificates: readonly ProofCheckCertificateId[];
  readonly summaryCertificate: CheckedFunctionSummaryCertificateId;
  readonly acceptedBlockStates: readonly CheckedBlockStateCertificate[];
}

export type CheckedMirFunctionTable = ReadonlyMap<MonoInstanceId, CheckedMirFunction>;

export interface CheckedMirProgram {
  readonly mir: ProofMirProgram;
  readonly checkedFunctions: CheckedMirFunctionTable;
  readonly summaries: CheckedFunctionSummaryTable;
  readonly facts: CheckedFactPacket;
  readonly terminalGraph: CheckedTerminalGraphCertificate;
  readonly originMap: CheckedOriginMap;
}
