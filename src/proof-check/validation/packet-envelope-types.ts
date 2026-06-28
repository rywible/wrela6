import type { ProofAuthorityFingerprint } from "../authority/authority-types";
import type {
  CheckedSummaryInstantiationCertificateId,
  ProofCheckCoreCertificateId,
  ProofSemanticsCertificateId,
} from "../ids";

export const CHECKED_FACT_PACKET_DEPENDENCY_KINDS = [
  "proofMirNode",
  "layoutFact",
  "authorityFingerprint",
  "coreCertificate",
  "semanticsCertificate",
  "summaryInstantiationCertificate",
  "packetSource",
  "privateGeneration",
] as const;

export type CheckedFactPacketDependencyKind = (typeof CHECKED_FACT_PACKET_DEPENDENCY_KINDS)[number];

export type CheckedFactPacketDependency =
  | { readonly kind: "proofMirNode"; readonly nodeKey: string }
  | { readonly kind: "layoutFact"; readonly layoutKey: string }
  | { readonly kind: "authorityFingerprint"; readonly fingerprint: ProofAuthorityFingerprint }
  | { readonly kind: "coreCertificate"; readonly certificateId: ProofCheckCoreCertificateId }
  | { readonly kind: "semanticsCertificate"; readonly certificateId: ProofSemanticsCertificateId }
  | {
      readonly kind: "summaryInstantiationCertificate";
      readonly certificateId: CheckedSummaryInstantiationCertificateId;
    }
  | { readonly kind: "packetSource"; readonly packetSourceKey: string }
  | { readonly kind: "privateGeneration"; readonly generationKey: string };

export const CHECKED_FACT_PACKET_INVALIDATION_KINDS = [
  "placeMutation",
  "placeMove",
  "placeConsume",
  "loanConflict",
  "privateStateAdvance",
  "platformEffect",
  "runtimeEffect",
  "packetSourceSplit",
  "callResultRewrite",
  "cfgRewrite",
  "abiRewrite",
  "authorityChange",
] as const;

export type CheckedFactPacketInvalidationKind =
  (typeof CHECKED_FACT_PACKET_INVALIDATION_KINDS)[number];

export type CheckedFactPacketInvalidation =
  | { readonly kind: "placeMutation"; readonly placeIdKey: string }
  | { readonly kind: "placeMove"; readonly placeIdKey: string }
  | { readonly kind: "placeConsume"; readonly placeIdKey: string }
  | { readonly kind: "loanConflict"; readonly placeIdKey: string }
  | { readonly kind: "privateStateAdvance"; readonly placeIdKey: string }
  | {
      readonly kind: "platformEffect";
      readonly effectKindKey: string;
      readonly subjectKey: string;
    }
  | {
      readonly kind: "runtimeEffect";
      readonly effectKindKey: string;
      readonly subjectKey: string;
    }
  | { readonly kind: "packetSourceSplit"; readonly packetSourceKey: string }
  | { readonly kind: "callResultRewrite"; readonly callIdKey: string }
  | { readonly kind: "cfgRewrite"; readonly functionInstanceIdKey: string }
  | { readonly kind: "abiRewrite"; readonly layoutKey: string }
  | { readonly kind: "authorityChange"; readonly fingerprintKey: string };
