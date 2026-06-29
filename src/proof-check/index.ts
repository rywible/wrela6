export {
  checkProofAndResources,
  type CheckProofAndResourcesInput,
  type CheckProofAndResourcesResult,
  type ProofCheckNonErrorDiagnostic,
  type ProofCheckResourceLimits,
} from "./proof-checker";

export type { ValidateProofCheckInputResult } from "./input-contract";

export {
  PROOF_CHECK_DIAGNOSTIC_CODES,
  proofCheckDiagnostic,
  proofCheckDiagnosticCode,
  sortProofCheckDiagnostics,
} from "./diagnostics";
export type {
  ProofCheckDiagnostic,
  ProofCheckDiagnosticCode,
  ProofCheckDiagnosticInput,
  ProofCheckDiagnosticOrder,
  ProofCheckDiagnosticSeverity,
} from "./diagnostics";

export {
  checkedSummaryInstantiationCertificateId,
  proofCheckCoreCertificateId,
  proofCheckPacketFactId,
  proofSemanticsCertificateId,
} from "./ids";
export type {
  CheckedSummaryInstantiationCertificateId,
  ProofCheckCoreCertificateId,
  ProofSemanticsCertificateId,
} from "./ids";

export {
  checkedFunctionSummaryCertificateId,
  checkedTerminalClosureKey,
} from "./model/certificates";
export type {
  CheckedFunctionSummaryCertificateId,
  CheckedTerminalClosureKey,
  ProofCheckCertificateId,
} from "./model/certificates";

export type { ProofAuthorityFingerprint } from "../shared/proof-authority-types";
export type {
  ProofCheckPlatformContract,
  ProofCheckPlatformContractCatalog,
} from "./authority/platform-contracts";
export type {
  ProofCheckRuntimeCatalog,
  ProofCheckRuntimeOperation,
} from "./authority/runtime-authority";
export type { ProofSemanticsCompanion } from "./authority/semantics-companion";
export type {
  ProofCheckTypeFactCatalog,
  ProofCheckTypeFactLookup,
} from "./authority/type-fact-authority";

export type { CheckedMirFunction, CheckedMirProgram } from "./model/checked-mir";
export type { CheckedFunctionSummary } from "./model/function-summary";
export type {
  CheckedFactKindId,
  CheckedFactPacket,
  CheckedFactPacketEntry,
  CheckedFactScope,
  CheckedFactSubject,
  CheckedOriginFact,
  CheckedOriginMap,
  CheckedOriginPacketFact,
  CheckedPacketFactKind,
} from "./model/fact-packet";
export type { CheckedTerminalGraphCertificate } from "./model/certificates";

export {
  checkedOptIrHandoffFingerprint,
  checkedOptIrHandoffStableKey,
} from "./model/opt-ir-handoff";
export type {
  CheckedOptIrHandoff,
  CheckedOptIrHandoffFingerprint,
  CheckedOptIrHandoffFingerprintInput,
  CheckedPacketValidationAttestation,
  CheckedPathCertificate,
  CheckedSemanticInlinePolicy,
  CheckedSemanticInlinePolicyKind,
  CheckedSemanticInlinePolicySource,
} from "./model/opt-ir-handoff";
