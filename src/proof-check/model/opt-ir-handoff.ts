import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirControlEdgeId } from "../../proof-mir/ids";
import { targetId } from "../../semantic/ids";
import type { ProofAuthorityFingerprint } from "../../shared/proof-authority-types";
import { proofAuthorityFingerprintFromValue } from "../authority/canonical-serialization";
import type { CheckedFunctionSummaryCertificateId, CheckedPathCertificateId } from "./certificates";
import type { CheckedFactInvalidation, CheckedOriginFact } from "./fact-packet";
import type { CheckedMirProgram } from "./checked-mir";
import type { ProofCheckCertificate } from "../validation/packet-certificate-types";
import type { ProofSemanticsCertificateId } from "../ids";

export type CheckedSemanticInlinePolicyKind = "mandatory";
export type CheckedSemanticInlinePolicySource = "checkedSummary";

export interface CheckedPacketValidationAttestation {
  readonly checkedFactPacketStableKey: string;
  readonly acceptedFunctionInstanceIds: readonly MonoInstanceId[];
  readonly summaryCertificateIds: readonly CheckedFunctionSummaryCertificateId[];
  readonly terminalGraphCertificateId: ProofSemanticsCertificateId;
  readonly originMapStableKey: string;
  readonly authorityFingerprints: readonly ProofAuthorityFingerprint[];
}

export interface CheckedPathCertificate {
  readonly certificateId: CheckedPathCertificateId;
  readonly functionInstanceId: MonoInstanceId;
  readonly requiredEdges: readonly ProofMirControlEdgeId[];
  readonly requiredDominators: readonly ProofMirControlEdgeId[];
  readonly excludedEdges: readonly ProofMirControlEdgeId[];
  readonly invalidatedBy: readonly CheckedFactInvalidation[];
  readonly origin: CheckedOriginFact;
}

export interface CheckedSemanticInlinePolicy {
  readonly functionInstanceId: MonoInstanceId;
  readonly kind: CheckedSemanticInlinePolicyKind;
  readonly reason: string;
  readonly source: CheckedSemanticInlinePolicySource;
  readonly summaryCertificateId: CheckedFunctionSummaryCertificateId;
}

export type CheckedOptIrHandoffFingerprint = ProofAuthorityFingerprint;

export interface CheckedOptIrHandoffFingerprintInput {
  readonly checkedMir: CheckedMirProgram;
  readonly certificates: readonly ProofCheckCertificate[];
  readonly packetValidation: CheckedPacketValidationAttestation;
  readonly pathCertificates: readonly CheckedPathCertificate[];
  readonly semanticInlinePolicies: readonly CheckedSemanticInlinePolicy[];
}

export interface CheckedOptIrHandoff extends CheckedOptIrHandoffFingerprintInput {
  readonly handoffFingerprint: CheckedOptIrHandoffFingerprint;
}

export function checkedOptIrHandoffStableJson(value: unknown): string {
  return JSON.stringify(toStableValue(value));
}

function stableJson(value: unknown): string {
  return checkedOptIrHandoffStableJson(value);
}

function toStableValue(value: unknown): unknown {
  if (typeof value === "bigint") {
    return { kind: "bigint", value: value.toString() };
  }

  if (value instanceof Map) {
    return [...value.entries()]
      .map(([key, entry]) => [toStableValue(key), toStableValue(entry)] as const)
      .sort((left, right) => stableJson(left[0]).localeCompare(stableJson(right[0])));
  }

  if (value instanceof Set) {
    return [...value]
      .map(toStableValue)
      .sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
  }

  if (Array.isArray(value)) {
    return value.map(toStableValue);
  }

  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, toStableValue(entry)]),
    );
  }

  return value;
}

function sortedByStableJson<Value>(values: readonly Value[]): readonly Value[] {
  return [...values].sort((left, right) => stableJson(left).localeCompare(stableJson(right)));
}

function pathCertificateStableKey(certificate: CheckedPathCertificate): string {
  return `pathCertificate:${String(certificate.certificateId)}`;
}

function semanticInlinePolicyStableKey(policy: CheckedSemanticInlinePolicy): string {
  return `semanticInline:${policy.kind}:${policy.reason}:${String(policy.functionInstanceId)}:${String(
    policy.summaryCertificateId,
  )}`;
}

function fingerprintInput(input: CheckedOptIrHandoffFingerprintInput): unknown {
  return {
    checkedMir: input.checkedMir,
    certificates: sortedByStableJson(input.certificates),
    packetValidation: {
      ...input.packetValidation,
      acceptedFunctionInstanceIds: [...input.packetValidation.acceptedFunctionInstanceIds].sort(),
      authorityFingerprints: sortedByStableJson(input.packetValidation.authorityFingerprints),
      summaryCertificateIds: [...input.packetValidation.summaryCertificateIds].sort(
        (left, right) => left - right,
      ),
    },
    pathCertificates: sortedByStableJson(input.pathCertificates),
    semanticInlinePolicies: sortedByStableJson(input.semanticInlinePolicies),
  };
}

export function checkedOptIrHandoffStableKey(handoff: CheckedOptIrHandoffFingerprintInput): string {
  return [
    `packet:${handoff.packetValidation.checkedFactPacketStableKey}`,
    `terminalGraph:${String(handoff.packetValidation.terminalGraphCertificateId)}`,
    `originMap:${handoff.packetValidation.originMapStableKey}`,
    ...sortedByStableJson(handoff.pathCertificates).map(pathCertificateStableKey),
    ...sortedByStableJson(handoff.semanticInlinePolicies).map(semanticInlinePolicyStableKey),
    ...sortedByStableJson(handoff.packetValidation.authorityFingerprints).map(
      (fingerprint) =>
        `authority:${fingerprint.authorityKind}:${String(fingerprint.targetId)}:${fingerprint.digestHex}`,
    ),
  ].join("|");
}

export function checkedOptIrHandoffFingerprint(
  handoff: CheckedOptIrHandoffFingerprintInput,
): CheckedOptIrHandoffFingerprint {
  return proofAuthorityFingerprintFromValue({
    authorityKind: "semantics",
    targetId: targetId("opt-ir-handoff"),
    version: "v1",
    value: {
      kind: "record",
      recordKind: "CheckedOptIrHandoff",
      fields: [
        {
          name: "stableKey",
          value: { kind: "string", value: checkedOptIrHandoffStableKey(handoff) },
        },
        {
          name: "content",
          value: { kind: "string", value: stableJson(fingerprintInput(handoff)) },
        },
      ],
    },
  });
}
