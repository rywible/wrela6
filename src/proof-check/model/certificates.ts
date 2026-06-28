import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirBlockId } from "../../proof-mir/ids";
import type {
  CheckedSummaryInstantiationCertificateId,
  ProofCheckCoreCertificateId,
  ProofPathCertificateId,
  ProofSemanticsCertificateId,
} from "../ids";

export type CheckedPathCertificateId = ProofPathCertificateId;

export type CheckedFunctionSummaryCertificateId = number & {
  readonly __brand: "CheckedFunctionSummaryCertificateId";
};

export type ProofCheckCertificateId =
  | { readonly kind: "core"; readonly id: ProofCheckCoreCertificateId }
  | { readonly kind: "semantics"; readonly id: ProofSemanticsCertificateId }
  | {
      readonly kind: "summaryInstantiation";
      readonly id: CheckedSummaryInstantiationCertificateId;
    };

export type ProofCheckCoreCertificateRule =
  | "coreEntailment"
  | "authorityMembership"
  | "ownershipTransfer"
  | "loanDisjointness"
  | "layoutReadRequirement"
  | "erasure"
  | "packetSource"
  | "initialState"
  | "exitClosure";

export interface ProofCheckCoreCertificate {
  readonly certificateId: ProofCheckCoreCertificateId;
  readonly rule: ProofCheckCoreCertificateRule;
  readonly subjectKey: string;
  readonly dependencyKeys: readonly string[];
}

export interface CheckedBlockStateCertificate {
  readonly certificateId: ProofCheckCertificateId;
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly stateKey: string;
}

export interface CheckedTerminalGraphCertificate {
  readonly certificateId: ProofSemanticsCertificateId;
  readonly terminalKey: CheckedTerminalClosureKey;
  readonly closurePath: readonly string[];
  readonly platformEffectKey: string;
}

export type CheckedTerminalClosureKey = string & {
  readonly __brand: "CheckedTerminalClosureKey";
};

function denseId(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer, got ${value}.`);
  }
  return value;
}

export function checkedFunctionSummaryCertificateId(
  value: number,
): CheckedFunctionSummaryCertificateId {
  return denseId(
    value,
    "CheckedFunctionSummaryCertificateId",
  ) as CheckedFunctionSummaryCertificateId;
}

export function checkedTerminalClosureKey(value: string): CheckedTerminalClosureKey {
  if (value.length === 0) {
    throw new RangeError("CheckedTerminalClosureKey must be a non-empty string.");
  }
  return value as CheckedTerminalClosureKey;
}
