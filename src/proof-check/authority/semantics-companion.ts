import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirExtensionConstruct } from "../../proof-mir/model/effects";
import type { ProofMirBlockId, ProofMirControlEdgeId } from "../../proof-mir/ids";
import type { TargetId } from "../../semantic/ids";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import type { ProofSemanticsCertificateId } from "../ids";
import type { CheckedTerminalClosureKey } from "../model/certificates";
import type { ProofCheckRequirementTerm } from "../model/fact-language";
import type { ProofCapabilityKindId } from "../model/fact-language";
import { type ProofCheckPatchKind, type ProofCheckStatePatch } from "../kernel/state-patch";
import { proofAuthorityFingerprintsEqual, type ProofAuthorityFingerprint } from "./authority-types";
import { validateSemanticsCompanionPatchEntryPermissions } from "./semantics-companion-patch-validation";

export {
  proofCheckStateDigest,
  proofMirExtensionKind,
  proofSemanticsCompanion,
} from "./semantics-companion-builders";

export const PROOF_SEMANTICS_JUDGMENT_KINDS = [
  "entailment",
  "stateJoin",
  "loopConvergence",
  "terminalClosure",
  "yieldResume",
  "crossCoreOwnership",
  "streamLoop",
  "extensionTransfer",
] as const;

export type ProofSemanticsJudgmentKind = (typeof PROOF_SEMANTICS_JUDGMENT_KINDS)[number];

const PROOF_SEMANTICS_JUDGMENT_KIND_SET: ReadonlySet<string> = new Set(
  PROOF_SEMANTICS_JUDGMENT_KINDS,
);

export function proofSemanticsJudgmentKind(value: string): ProofSemanticsJudgmentKind {
  if (!PROOF_SEMANTICS_JUDGMENT_KIND_SET.has(value)) {
    throw new RangeError(`Unknown proof-semantics judgment kind: ${value}.`);
  }
  return value as ProofSemanticsJudgmentKind;
}

export type ProofMirExtensionKind = ProofMirExtensionConstruct | "targetSpecific";

export interface ProofCheckStateDigest {
  readonly stateKey: string;
}

export interface ProofEntailmentJudgmentInput {
  readonly requestKey: string;
  readonly subjectKey: string;
  readonly environmentFactKeys: readonly string[];
  readonly requirement: ProofCheckRequirementTerm;
  readonly allowedAuthorityKeys: readonly string[];
}

export interface ProofStateJoinJudgmentInput {
  readonly requestKey: string;
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly incomingStateDigests: readonly ProofCheckStateDigest[];
  readonly allowedDropFactKeys: readonly string[];
  readonly allowedPacketSourceKeys: readonly string[];
}

export interface ProofLoopConvergenceJudgmentInput {
  readonly requestKey: string;
  readonly functionInstanceId: MonoInstanceId;
  readonly headerBlockId: ProofMirBlockId;
  readonly backedgeIds: readonly ProofMirControlEdgeId[];
  readonly incomingStateDigests: readonly ProofCheckStateDigest[];
  readonly variantKeys: readonly string[];
  readonly loopCarriedPrivateStateKeys: readonly string[];
}

export interface ProofTerminalClosureJudgmentInput {
  readonly requestKey: string;
  readonly terminalKey: CheckedTerminalClosureKey;
  readonly terminalGraphKey: string;
  readonly platformBaseKeys: readonly string[];
}

export interface ProofYieldResumeJudgmentInput {
  readonly requestKey: string;
  readonly yieldPointKey: string;
  readonly resumePointKey: string;
  readonly stableCapabilityKeys: readonly string[];
  readonly invalidatableFactKeys: readonly string[];
}

export interface ProofCrossCoreOwnershipJudgmentInput {
  readonly requestKey: string;
  readonly sourcePlaceKey: string;
  readonly destinationCoreKey: string;
  readonly capabilityKind: ProofCapabilityKindId;
  readonly orderingFactKey: string;
}

export interface ProofStreamLoopJudgmentInput {
  readonly requestKey: string;
  readonly streamSessionKey: string;
  readonly yieldedMemberKey: string;
  readonly memberLocalFactKeys: readonly string[];
}

export interface ProofExtensionTransferJudgmentInput {
  readonly requestKey: string;
  readonly extensionKind: ProofMirExtensionKind;
  readonly extensionSchemaKey: string;
  readonly operandKeys: readonly string[];
  readonly allowedPatchKinds: readonly ProofCheckPatchKind[];
}

export type ProofSemanticsJudgmentRequest =
  | { readonly kind: "entailment"; readonly input: ProofEntailmentJudgmentInput }
  | { readonly kind: "stateJoin"; readonly input: ProofStateJoinJudgmentInput }
  | { readonly kind: "loopConvergence"; readonly input: ProofLoopConvergenceJudgmentInput }
  | { readonly kind: "terminalClosure"; readonly input: ProofTerminalClosureJudgmentInput }
  | { readonly kind: "yieldResume"; readonly input: ProofYieldResumeJudgmentInput }
  | { readonly kind: "crossCoreOwnership"; readonly input: ProofCrossCoreOwnershipJudgmentInput }
  | { readonly kind: "streamLoop"; readonly input: ProofStreamLoopJudgmentInput }
  | { readonly kind: "extensionTransfer"; readonly input: ProofExtensionTransferJudgmentInput };

export interface ProofSemanticsJudgmentEnvelope {
  readonly requestKind: ProofSemanticsJudgmentRequest["kind"];
  readonly requestKey: string;
  readonly companionFingerprint: ProofAuthorityFingerprint;
  readonly subjectKey: string;
  readonly dependencyKeys: readonly string[];
  readonly certificateId: ProofSemanticsCertificateId;
}

export type ProofSemanticsJudgmentResult =
  | (ProofSemanticsJudgmentEnvelope & { readonly kind: "entailment"; readonly entailed: true })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "stateJoin";
      readonly patch: ProofCheckStatePatch<"stateJoin">;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "loopConvergence";
      readonly patch: ProofCheckStatePatch<"loopConvergence">;
      readonly replayWitnessKey: string;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "terminalClosure";
      readonly terminalClosureKey: CheckedTerminalClosureKey;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "yieldResume";
      readonly patch: ProofCheckStatePatch<"yieldResume">;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "crossCoreOwnership";
      readonly patch: ProofCheckStatePatch<"crossCoreOwnership">;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "streamLoop";
      readonly patch: ProofCheckStatePatch<"streamLoop">;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "extensionTransfer";
      readonly patch: ProofCheckStatePatch<"extensionTransfer">;
      readonly packetEntryKeys: readonly string[];
    });

export type ProofEntailmentJudgmentResult = Extract<
  ProofSemanticsJudgmentResult,
  { readonly kind: "entailment" }
>;
export type ProofStateJoinJudgmentResult = Extract<
  ProofSemanticsJudgmentResult,
  { readonly kind: "stateJoin" }
>;
export type ProofLoopConvergenceJudgmentResult = Extract<
  ProofSemanticsJudgmentResult,
  { readonly kind: "loopConvergence" }
>;
export type ProofTerminalClosureJudgmentResult = Extract<
  ProofSemanticsJudgmentResult,
  { readonly kind: "terminalClosure" }
>;
export type ProofYieldResumeJudgmentResult = Extract<
  ProofSemanticsJudgmentResult,
  { readonly kind: "yieldResume" }
>;
export type ProofCrossCoreOwnershipJudgmentResult = Extract<
  ProofSemanticsJudgmentResult,
  { readonly kind: "crossCoreOwnership" }
>;
export type ProofStreamLoopJudgmentResult = Extract<
  ProofSemanticsJudgmentResult,
  { readonly kind: "streamLoop" }
>;
export type ProofExtensionTransferJudgmentResult = Extract<
  ProofSemanticsJudgmentResult,
  { readonly kind: "extensionTransfer" }
>;

export interface ProofSemanticsCompanion {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly targetId: TargetId;
  readonly schemaVersion: string;
  readonly providedJudgments: readonly ProofSemanticsJudgmentKind[];
  judge(request: ProofSemanticsJudgmentRequest): ProofSemanticsJudgmentResult | undefined;
}

export type ValidateProofSemanticsJudgmentResult =
  | { readonly kind: "ok"; readonly result: ProofSemanticsJudgmentResult }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export interface ValidateProofSemanticsJudgmentResultInput {
  readonly companion: ProofSemanticsCompanion;
  readonly request: ProofSemanticsJudgmentRequest;
  readonly dependencyKeys: ReadonlySet<string>;
}

const JUDGMENT_INPUT_ALLOWED_FIELDS: Record<ProofSemanticsJudgmentKind, ReadonlySet<string>> = {
  entailment: new Set([
    "requestKey",
    "subjectKey",
    "environmentFactKeys",
    "requirement",
    "allowedAuthorityKeys",
  ]),
  stateJoin: new Set([
    "requestKey",
    "functionInstanceId",
    "blockId",
    "incomingStateDigests",
    "allowedDropFactKeys",
    "allowedPacketSourceKeys",
  ]),
  loopConvergence: new Set([
    "requestKey",
    "functionInstanceId",
    "headerBlockId",
    "backedgeIds",
    "incomingStateDigests",
    "variantKeys",
    "loopCarriedPrivateStateKeys",
  ]),
  terminalClosure: new Set(["requestKey", "terminalKey", "terminalGraphKey", "platformBaseKeys"]),
  yieldResume: new Set([
    "requestKey",
    "yieldPointKey",
    "resumePointKey",
    "stableCapabilityKeys",
    "invalidatableFactKeys",
  ]),
  crossCoreOwnership: new Set([
    "requestKey",
    "sourcePlaceKey",
    "destinationCoreKey",
    "capabilityKind",
    "orderingFactKey",
  ]),
  streamLoop: new Set([
    "requestKey",
    "streamSessionKey",
    "yieldedMemberKey",
    "memberLocalFactKeys",
  ]),
  extensionTransfer: new Set([
    "requestKey",
    "extensionKind",
    "extensionSchemaKey",
    "operandKeys",
    "allowedPatchKinds",
  ]),
};

const JUDGMENT_RESULT_ALLOWED_FIELDS: Record<ProofSemanticsJudgmentKind, ReadonlySet<string>> = {
  entailment: new Set([
    "kind",
    "requestKind",
    "requestKey",
    "companionFingerprint",
    "subjectKey",
    "dependencyKeys",
    "certificateId",
    "entailed",
  ]),
  stateJoin: new Set([
    "kind",
    "requestKind",
    "requestKey",
    "companionFingerprint",
    "subjectKey",
    "dependencyKeys",
    "certificateId",
    "patch",
  ]),
  loopConvergence: new Set([
    "kind",
    "requestKind",
    "requestKey",
    "companionFingerprint",
    "subjectKey",
    "dependencyKeys",
    "certificateId",
    "patch",
    "replayWitnessKey",
  ]),
  terminalClosure: new Set([
    "kind",
    "requestKind",
    "requestKey",
    "companionFingerprint",
    "subjectKey",
    "dependencyKeys",
    "certificateId",
    "terminalClosureKey",
  ]),
  yieldResume: new Set([
    "kind",
    "requestKind",
    "requestKey",
    "companionFingerprint",
    "subjectKey",
    "dependencyKeys",
    "certificateId",
    "patch",
  ]),
  crossCoreOwnership: new Set([
    "kind",
    "requestKind",
    "requestKey",
    "companionFingerprint",
    "subjectKey",
    "dependencyKeys",
    "certificateId",
    "patch",
  ]),
  streamLoop: new Set([
    "kind",
    "requestKind",
    "requestKey",
    "companionFingerprint",
    "subjectKey",
    "dependencyKeys",
    "certificateId",
    "patch",
  ]),
  extensionTransfer: new Set([
    "kind",
    "requestKind",
    "requestKey",
    "companionFingerprint",
    "subjectKey",
    "dependencyKeys",
    "certificateId",
    "patch",
    "packetEntryKeys",
  ]),
};

function hasExtraFields(value: object, allowedFields: ReadonlySet<string>): string | undefined {
  for (const key of Object.keys(value)) {
    if (!allowedFields.has(key)) {
      return key;
    }
  }
  return undefined;
}

function invalidSemanticsCertificateDiagnostic(stableDetail: string): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INVALID_SEMANTICS_CERTIFICATE",
    messageTemplateId: "proof-check.semantics-certificate.invalid",
    messageArguments: [{ kind: "text", value: stableDetail }],
    message: stableDetail,
    ownerKey: "proof-check:semantics-companion",
    rootCauseKey: "proof-check:semantics-companion",
    stableDetail,
  });
}

function missingCompanionJudgmentDiagnostic(judgmentKind: string): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_MISSING_COMPANION_JUDGMENT",
    messageTemplateId: "proof-check.semantics-companion.missing-judgment",
    messageArguments: [{ kind: "text", value: judgmentKind }],
    message: `Missing companion judgment: ${judgmentKind}.`,
    ownerKey: `semantics:${judgmentKind}`,
    rootCauseKey: "proof-check:semantics-companion",
    stableDetail: `missing-judgment:${judgmentKind}`,
  });
}

function semanticsValidationError(stableDetail: string): ValidateProofSemanticsJudgmentResult {
  return {
    kind: "error",
    diagnostics: sortProofCheckDiagnostics([invalidSemanticsCertificateDiagnostic(stableDetail)]),
  };
}

export function semanticsJudgmentSubjectKey(request: ProofSemanticsJudgmentRequest): string {
  switch (request.kind) {
    case "entailment":
      return request.input.subjectKey;
    case "stateJoin":
      return `join:${request.input.functionInstanceId}:${request.input.blockId}`;
    case "loopConvergence":
      return `loop:${request.input.functionInstanceId}:${request.input.headerBlockId}`;
    case "terminalClosure":
      return request.input.terminalKey;
    case "yieldResume":
      return `yield:${request.input.yieldPointKey}:${request.input.resumePointKey}`;
    case "crossCoreOwnership":
      return request.input.sourcePlaceKey;
    case "streamLoop":
      return request.input.yieldedMemberKey;
    case "extensionTransfer":
      return request.input.extensionSchemaKey;
    default: {
      const _exhaustive: never = request;
      return _exhaustive;
    }
  }
}

function validateJudgmentInputSchema(request: ProofSemanticsJudgmentRequest): string | undefined {
  const extraField = hasExtraFields(request.input, JUDGMENT_INPUT_ALLOWED_FIELDS[request.kind]);
  if (extraField !== undefined) {
    return `input-extra-field:${request.kind}:${extraField}`;
  }
  return undefined;
}

function validateJudgmentResultSchema(result: ProofSemanticsJudgmentResult): string | undefined {
  const extraField = hasExtraFields(result, JUDGMENT_RESULT_ALLOWED_FIELDS[result.kind]);
  if (extraField !== undefined) {
    return `result-extra-field:${result.kind}:${extraField}`;
  }
  return undefined;
}

function validateDependencyKeys(
  result: ProofSemanticsJudgmentResult,
  dependencyKeys: ReadonlySet<string>,
): string | undefined {
  for (const dependencyKey of result.dependencyKeys) {
    if (!dependencyKeys.has(dependencyKey)) {
      return `unknown-dependency:${dependencyKey}`;
    }
  }
  return undefined;
}

function resultHasPatch(result: ProofSemanticsJudgmentResult): boolean {
  return (
    result.kind === "stateJoin" ||
    result.kind === "loopConvergence" ||
    result.kind === "yieldResume" ||
    result.kind === "crossCoreOwnership" ||
    result.kind === "streamLoop" ||
    result.kind === "extensionTransfer"
  );
}

function validateKindSpecificPayload(
  request: ProofSemanticsJudgmentRequest,
  result: ProofSemanticsJudgmentResult,
): string | undefined {
  if (result.kind === "entailment") {
    if (result.entailed !== true) {
      return "entailment:entailed-not-true";
    }
    return undefined;
  }
  if (result.kind === "terminalClosure") {
    if (request.kind !== "terminalClosure") {
      return "terminalClosure:request-kind-mismatch";
    }
    if (result.terminalClosureKey !== request.input.terminalKey) {
      return `terminalClosure:terminal-key-mismatch:${result.terminalClosureKey}`;
    }
    return undefined;
  }
  if (resultHasPatch(result)) {
    return validateSemanticsCompanionPatchEntryPermissions(result.kind, request, result.patch);
  }
  return undefined;
}

export function validateProofSemanticsJudgmentResult(
  input: ValidateProofSemanticsJudgmentResultInput,
): ValidateProofSemanticsJudgmentResult {
  const { companion, request, dependencyKeys } = input;

  if (!companion.providedJudgments.includes(proofSemanticsJudgmentKind(request.kind))) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([missingCompanionJudgmentDiagnostic(request.kind)]),
    };
  }

  const inputSchemaViolation = validateJudgmentInputSchema(request);
  if (inputSchemaViolation !== undefined) {
    return semanticsValidationError(inputSchemaViolation);
  }

  const judgmentResult = companion.judge(request);
  if (judgmentResult === undefined) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([missingCompanionJudgmentDiagnostic(request.kind)]),
    };
  }

  const resultSchemaViolation = validateJudgmentResultSchema(judgmentResult);
  if (resultSchemaViolation !== undefined) {
    return semanticsValidationError(resultSchemaViolation);
  }

  if (judgmentResult.kind !== request.kind) {
    return semanticsValidationError(
      `request-kind-mismatch:expected:${request.kind}:actual:${judgmentResult.kind}`,
    );
  }

  if (judgmentResult.requestKind !== request.kind) {
    return semanticsValidationError(
      `result-request-kind-mismatch:expected:${request.kind}:actual:${judgmentResult.requestKind}`,
    );
  }

  if (
    !proofAuthorityFingerprintsEqual(judgmentResult.companionFingerprint, companion.fingerprint)
  ) {
    return semanticsValidationError("companion-fingerprint-mismatch");
  }

  if (judgmentResult.requestKey !== request.input.requestKey) {
    return semanticsValidationError(
      `request-key-mismatch:expected:${request.input.requestKey}:actual:${judgmentResult.requestKey}`,
    );
  }

  const expectedSubjectKey = semanticsJudgmentSubjectKey(request);
  if (judgmentResult.subjectKey !== expectedSubjectKey) {
    return semanticsValidationError(
      `subject-key-mismatch:expected:${expectedSubjectKey}:actual:${judgmentResult.subjectKey}`,
    );
  }

  const dependencyViolation = validateDependencyKeys(judgmentResult, dependencyKeys);
  if (dependencyViolation !== undefined) {
    return semanticsValidationError(dependencyViolation);
  }

  if (judgmentResult.kind === "entailment" || judgmentResult.kind === "terminalClosure") {
    if ("patch" in judgmentResult) {
      return semanticsValidationError(`patch-not-allowed:${judgmentResult.kind}`);
    }
  }

  const payloadViolation = validateKindSpecificPayload(request, judgmentResult);
  if (payloadViolation !== undefined) {
    return semanticsValidationError(payloadViolation);
  }

  return { kind: "ok", result: judgmentResult };
}
