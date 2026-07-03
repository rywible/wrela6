import type { ProofCheckPlaceResolver } from "../kernel/registry/transition-helpers";
import { stableNumericSeed } from "../stable-numeric-seed";
import type { HirPlatformContractEdgeId } from "../../hir/ids";
import type { MonoInstanceId } from "../../mono/ids";
import type { MonoInstantiatedProofId, MonoPlatformContractEdge } from "../../mono/mono-hir";
import {
  proofMirOriginId,
  proofMirOwnedCallId,
  proofMirPlaceId,
  type ProofMirCallId,
} from "../../proof-mir/ids";
import type { ProofMirCallGraphEdge } from "../../proof-mir/model/calls";
import type { ProofMirCall } from "../../proof-mir/model/graph";
import type { ProofMirPlatformEdge } from "../../proof-mir/model/program";
import type { PlatformContractId, PlatformPrimitiveId, TargetId } from "../../semantic/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type {
  ProofCheckPlatformContract,
  ProofCheckPlatformContractCatalog,
} from "../authority/platform-contracts";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import { proofCheckCoreCertificateId, proofCheckPacketFactId } from "../ids";
import type { ProofCheckCertificateId } from "../model/certificates";
import type { ProofCheckCoreCertificate } from "../model/certificates";
import {
  checkedFactKindId,
  type CheckedExtensionFact,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedOriginFact,
} from "../model/fact-packet";
import type { ProofCheckPlaceBinder } from "../model/function-summary";
import {
  normalizeProofCheckTerm,
  proofCheckPlaceBinderKey,
  type ProofCheckFactTerm,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import type { CheckedCapabilityState, ProofCheckState } from "../kernel/state";
import {
  buildProofCheckFactEnvironment,
  checkCallRequirementsEntailment,
  proveCoreEntailment,
  proofCheckCoreCertificateStableKey,
} from "./facts";
import { checkUseWithLoans } from "./loans";
import {
  applyPlatformContractEffects,
  type PlatformContractEffectOperandBindings,
  type PlatformContractEffectsInput,
} from "./platform-contract-effects";
import { applySummaryPlaceEffect, type ProofCheckConcreteResourceKind } from "./ownership";

export interface PlatformContractOperandBinding {
  readonly mode: "observe" | "consume";
  readonly placeKey: string;
  readonly resourceKind: ProofCheckConcreteResourceKind;
}

export interface PlatformContractOperandBindings {
  readonly receiver?: PlatformContractOperandBinding;
  readonly arguments?: readonly PlatformContractOperandBinding[];
  readonly capabilityPlaceKeys?: ReadonlyMap<string, string>;
}

export interface PlatformContractTransferInput {
  readonly state: ProofCheckState;
  readonly call: ProofMirCallGraphEdge;
  readonly platformEdge: ProofMirPlatformEdge;
  readonly contract: ProofCheckPlatformContract;
  readonly monoEdge?: MonoPlatformContractEdge;
  readonly catalog?: ProofCheckPlatformContractCatalog;
  readonly mirCall?: ProofMirCall;
  readonly operandBindings?: PlatformContractOperandBindings;
  readonly effectOperandBindings?: PlatformContractEffectOperandBindings;
  readonly activeFactTerms?: readonly ProofCheckRequirementTerm[];
  readonly preFacts?: readonly ProofCheckFactTerm[];
  readonly programPointScope?: CheckedFactScope;
  readonly privateStateAdvance?: PlatformContractEffectsInput["privateStateAdvance"];
  readonly operationOriginKey?: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface PlatformContractResolution {
  readonly contract: ProofCheckPlatformContract;
  readonly authorityKey: string;
  readonly targetId: TargetId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
}

export type PlatformContractResolveResult =
  | { readonly kind: "ok"; readonly resolution: PlatformContractResolution }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type PlatformContractTransferResult =
  | {
      readonly kind: "ok";
      readonly resolution: PlatformContractResolution;
      readonly patches: readonly ProofCheckStatePatchEntry[];
      readonly certificates: readonly ProofCheckCertificateId[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

function defaultScope(): CheckedFactScope {
  return { kind: "wholeImage" };
}

function originForPlatformFact(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

function platformTransferCertificate(subjectKey: string): ProofCheckCoreCertificate {
  return {
    certificateId: proofCheckCoreCertificateId(stableNumericSeed(`cert:${subjectKey}`)),
    rule: "authorityMembership",
    subjectKey,
    dependencyKeys: [],
  };
}

function certificateForSubject(subjectKey: string): ProofCheckCertificateId {
  return {
    kind: "core",
    id: platformTransferCertificate(subjectKey).certificateId,
  };
}

function platformContractMissingDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_PLATFORM_CONTRACT_MISSING",
    messageTemplateId: "platform.contract-missing",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function platformPreconditionFailedDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_PLATFORM_PRECONDITION_FAILED",
    messageTemplateId: "platform.precondition-failed",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function platformCapabilityFlowMismatchDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_PLATFORM_CAPABILITY_FLOW_MISMATCH",
    messageTemplateId: "platform.capability-flow-mismatch",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function callOriginKey(input: PlatformContractTransferInput): string {
  return input.operationOriginKey ?? `platform-call:${String(input.call.callId.callId)}`;
}

function certifiedPlatformTargetMatches(input: {
  readonly call: ProofMirCallGraphEdge;
  readonly platformEdge: ProofMirPlatformEdge;
}): boolean {
  if (input.call.target.kind !== "certifiedPlatform") {
    return false;
  }
  return (
    String(input.call.target.edgeId) === String(input.platformEdge.edgeId) &&
    input.call.target.primitiveId === input.platformEdge.primitiveId &&
    input.call.target.abi.kind === "platformAbi" &&
    String(input.call.target.abi.edgeId) === String(input.platformEdge.edgeId)
  );
}

function abiReferencesMatch(
  left: ProofMirPlatformEdge["abi"],
  right: MonoPlatformContractEdge["abi"],
  monoEdge: MonoPlatformContractEdge,
): boolean {
  return (
    left.kind === "platformAbi" &&
    left.edgeId === monoEdge.edgeId &&
    right.targetId === monoEdge.targetId &&
    right.primitiveId === monoEdge.primitiveId &&
    right.contractId === monoEdge.contractId
  );
}

export function resolvePlatformContract(input: {
  readonly call: ProofMirCallGraphEdge;
  readonly platformEdge: ProofMirPlatformEdge;
  readonly monoEdge: MonoPlatformContractEdge;
  readonly catalog: ProofCheckPlatformContractCatalog;
  readonly operationOriginKey?: string;
}): PlatformContractResolveResult {
  const ownerKey = input.operationOriginKey ?? `platform-call:${String(input.call.callId.callId)}`;

  if (!certifiedPlatformTargetMatches(input)) {
    return {
      kind: "error",
      diagnostics: [
        platformContractMissingDiagnostic({
          ownerKey,
          rootCauseKey: String(input.platformEdge.edgeId),
          detail: `platform-call-target-mismatch:${String(input.platformEdge.edgeId)}`,
        }),
      ],
    };
  }

  if (
    input.platformEdge.primitiveId !== input.monoEdge.primitiveId ||
    input.platformEdge.edgeId !== input.monoEdge.edgeId ||
    !abiReferencesMatch(input.platformEdge.abi, input.monoEdge.abi, input.monoEdge)
  ) {
    return {
      kind: "error",
      diagnostics: [
        platformContractMissingDiagnostic({
          ownerKey,
          rootCauseKey: String(input.monoEdge.edgeId),
          detail: `platform-edge-mismatch:${String(input.monoEdge.edgeId)}`,
        }),
      ],
    };
  }

  const contract = input.catalog.get({
    targetId: input.monoEdge.targetId,
    primitiveId: input.monoEdge.primitiveId,
    contractId: input.monoEdge.contractId,
  });
  if (contract === undefined) {
    return {
      kind: "error",
      diagnostics: [
        platformContractMissingDiagnostic({
          ownerKey,
          rootCauseKey: `${input.monoEdge.targetId}:${input.monoEdge.primitiveId}:${input.monoEdge.contractId}`,
          detail: `platform-contract-missing:${input.monoEdge.targetId}:${input.monoEdge.primitiveId}:${input.monoEdge.contractId}`,
        }),
      ],
    };
  }

  return {
    kind: "ok",
    resolution: {
      contract,
      authorityKey: contract.authorityKey,
      targetId: contract.targetId,
      primitiveId: contract.primitiveId,
      contractId: contract.contractId,
      edgeId: input.platformEdge.edgeId,
    },
  };
}

function capabilityStateForBinder(
  state: ProofCheckState,
  binder: ProofCheckPlaceBinder,
  capabilityPlaceKeys: ReadonlyMap<string, string> | undefined,
): CheckedCapabilityState | undefined {
  const binderKey = proofCheckPlaceBinderKey(binder);
  const capabilityKey = capabilityPlaceKeys?.get(binderKey) ?? binderKey;
  for (const capability of state.capabilities.values()) {
    if (capability.capabilityKey === capabilityKey) {
      return capability;
    }
  }
  return undefined;
}

function capabilityRequirementEntailed(
  state: ProofCheckState,
  requirement: Extract<ProofCheckRequirementTerm, { readonly kind: "capability" }>,
  capabilityPlaceKeys: ReadonlyMap<string, string> | undefined,
): boolean {
  const capability = capabilityStateForBinder(state, requirement.capability, capabilityPlaceKeys);
  if (capability === undefined) {
    return false;
  }
  return capability.capabilityKind === requirement.capabilityKind;
}

function checkPlatformPreconditions(input: {
  readonly state: ProofCheckState;
  readonly contract: ProofCheckPlatformContract;
  readonly ownerKey: string;
  readonly capabilityPlaceKeys?: ReadonlyMap<string, string>;
  readonly activeFactTerms?: readonly ProofCheckRequirementTerm[];
}):
  | PlatformContractTransferResult
  | { readonly kind: "ok"; readonly certificates: readonly ProofCheckCoreCertificate[] } {
  const nonCapabilityPreconditions = input.contract.preconditions.filter(
    (precondition) => precondition.kind !== "capability",
  );
  const capabilityPreconditions = input.contract.preconditions.filter(
    (
      precondition,
    ): precondition is Extract<ProofCheckRequirementTerm, { readonly kind: "capability" }> =>
      precondition.kind === "capability",
  );

  const environment = buildProofCheckFactEnvironment({
    state: input.state,
    terms: input.activeFactTerms ?? [],
    ownerKey: input.ownerKey,
  });
  const entailmentResult = checkCallRequirementsEntailment(
    environment,
    nonCapabilityPreconditions,
    { ownerKey: input.ownerKey },
  );
  if (entailmentResult.kind === "error") {
    const diagnostics = entailmentResult.diagnostics.map((diagnostic) =>
      platformPreconditionFailedDiagnostic({
        ownerKey: diagnostic.ownerKey,
        rootCauseKey: diagnostic.rootCauseKey,
        detail: diagnostic.stableDetail,
      }),
    );
    return { kind: "error", diagnostics: sortProofCheckDiagnostics(diagnostics) };
  }

  const certificates = [...entailmentResult.certificates];
  for (const requirement of capabilityPreconditions) {
    if (!capabilityRequirementEntailed(input.state, requirement, input.capabilityPlaceKeys)) {
      const normalized = normalizeProofCheckTerm(requirement);
      return {
        kind: "error",
        diagnostics: [
          platformPreconditionFailedDiagnostic({
            ownerKey: input.ownerKey,
            rootCauseKey: normalized.key,
            detail: `missing-capability:${normalized.key}`,
          }),
        ],
      };
    }
    const proof = proveCoreEntailment(environment, requirement, {
      ownerKey: input.ownerKey,
      rootCauseKey: normalizedRequirementKey(requirement),
    });
    if (proof.kind === "ok") {
      certificates.push(proof.certificate);
    }
  }

  return { kind: "ok", certificates };
}

function normalizedRequirementKey(requirement: ProofCheckRequirementTerm): string {
  return normalizeProofCheckTerm(requirement).key;
}

function isProofCheckCoreCertificate(
  certificate: ProofCheckCertificateId | ProofCheckCoreCertificate,
): certificate is ProofCheckCoreCertificate {
  return "certificateId" in certificate;
}

function checkOperandBindings(input: {
  readonly state: ProofCheckState;
  readonly bindings: PlatformContractOperandBindings | undefined;
  readonly ownerKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}):
  | PlatformContractTransferResult
  | {
      readonly kind: "ok";
      readonly patches: ProofCheckStatePatchEntry[];
      readonly certificates: ProofCheckCertificateId[];
      readonly packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
    } {
  const patches: ProofCheckStatePatchEntry[] = [];
  const certificates: ProofCheckCertificateId[] = [];
  const packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];
  const bindings = input.bindings;
  if (bindings === undefined) {
    return { kind: "ok", patches, certificates, packetEntries };
  }

  const operands: PlatformContractOperandBinding[] = [];
  if (bindings.receiver !== undefined) {
    operands.push(bindings.receiver);
  }
  if (bindings.arguments !== undefined) {
    operands.push(...bindings.arguments);
  }

  for (const operand of operands) {
    const place = { placeKey: operand.placeKey };
    const ownershipResult =
      operand.mode === "observe"
        ? applySummaryPlaceEffect({
            state: input.state,
            place,
            resourceKind: operand.resourceKind,
            mode: "observe",
            operationOriginKey: input.ownerKey,
            placeResolver: input.placeResolver,
          })
        : applySummaryPlaceEffect({
            state: input.state,
            place,
            resourceKind: operand.resourceKind,
            mode: "consume",
            operationOriginKey: input.ownerKey,
            placeResolver: input.placeResolver,
          });
    if (ownershipResult.kind === "error") {
      return ownershipResult;
    }

    const loanResult = checkUseWithLoans({
      state: input.state,
      place,
      operationOriginKey: input.ownerKey,
    });
    if (loanResult.kind === "error") {
      return loanResult;
    }

    patches.push(...ownershipResult.patches, ...loanResult.patches);
    certificates.push(...ownershipResult.certificates);
    packetEntries.push(...ownershipResult.packetEntries, ...loanResult.packetEntries);
  }

  return { kind: "ok", patches, certificates, packetEntries };
}

function buildCapabilityFlowPacketEntry(input: {
  readonly capabilityKey: string;
  readonly capabilityKind: string;
  readonly flowKind: "produce" | "consume" | "transfer";
  readonly operationOriginKey: string;
  readonly dependencyPlaceKeys: readonly string[];
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const subjectPlaceId = proofMirPlaceId(stableNumericSeed(`capability:${input.capabilityKey}`));
  const subjectKey = `${input.flowKind}:${input.capabilityKey}:${input.capabilityKind}`;
  const certificate = certificateForSubject(subjectKey);
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`capabilityFlow:${subjectKey}`)),
    kind: checkedFactKindId("capabilityFlow"),
    subject: { kind: "place", placeId: subjectPlaceId },
    scope: defaultScope(),
    dependencies: [],
    invalidatedBy: [{ kind: "placeConsume", placeId: subjectPlaceId }],
    certificate,
    origin: originForPlatformFact(input.operationOriginKey),
  };
}

function buildPlatformPreconditionPacketEntry(input: {
  readonly resolution: PlatformContractResolution;
  readonly contract: ProofCheckPlatformContract;
  readonly operationOriginKey: string;
  readonly catalogFingerprint: NonNullable<PlatformContractTransferInput["catalog"]>["fingerprint"];
  readonly preconditionCertificates: readonly ProofCheckCoreCertificate[];
}): CheckedExtensionFact {
  const subjectKey = [
    "platform-call-precondition",
    input.resolution.targetId,
    input.resolution.primitiveId,
    input.resolution.contractId,
    input.operationOriginKey,
  ].join(":");
  const certificate = certificateForSubject(subjectKey);
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`platformPrecondition:${subjectKey}`)),
    kind: checkedFactKindId("extension"),
    subject: {
      kind: "factExtension",
      extensionKey: "platform-call-precondition",
      subjectKey,
    },
    scope: defaultScope(),
    dependencies: [
      {
        kind: "authorityEntry",
        fingerprint: input.catalogFingerprint,
        entryKey: input.resolution.authorityKey,
      },
      ...input.preconditionCertificates.map((preconditionCertificate) => ({
        kind: "coreCertificate" as const,
        certificateId: preconditionCertificate.certificateId,
      })),
    ],
    invalidatedBy: [{ kind: "authorityChange", fingerprint: input.catalogFingerprint }],
    certificate,
    origin: originForPlatformFact(input.operationOriginKey),
    extensionKey: "platform-call-precondition",
    packetKind: "platformCallPrecondition",
    authorityFingerprint: input.catalogFingerprint,
    payload: Object.freeze({
      targetId: input.resolution.targetId,
      primitiveId: input.resolution.primitiveId,
      contractId: input.resolution.contractId,
      authorityKey: input.resolution.authorityKey,
      operationOriginKey: input.operationOriginKey,
      preconditionKeys: Object.freeze(input.contract.preconditions.map(normalizedRequirementKey)),
    }),
  };
}

function applyContractCapabilityFlow(input: {
  readonly state: ProofCheckState;
  readonly contract: ProofCheckPlatformContract;
  readonly ownerKey: string;
  readonly capabilityPlaceKeys?: ReadonlyMap<string, string>;
}):
  | PlatformContractTransferResult
  | {
      readonly kind: "ok";
      readonly patches: ProofCheckStatePatchEntry[];
      readonly certificates: ProofCheckCertificateId[];
      readonly packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
    } {
  const patches: ProofCheckStatePatchEntry[] = [];
  const certificates: ProofCheckCertificateId[] = [];
  const packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];

  const consumedCapabilities = [...input.contract.consumedCapabilities].sort((left, right) =>
    compareCodeUnitStrings(proofCheckPlaceBinderKey(left), proofCheckPlaceBinderKey(right)),
  );
  for (const capabilityBinder of consumedCapabilities) {
    const capability = capabilityStateForBinder(
      input.state,
      capabilityBinder,
      input.capabilityPlaceKeys,
    );
    if (capability === undefined) {
      return {
        kind: "error",
        diagnostics: [
          platformCapabilityFlowMismatchDiagnostic({
            ownerKey: input.ownerKey,
            rootCauseKey: proofCheckPlaceBinderKey(capabilityBinder),
            detail: `missing-consumed-capability:${proofCheckPlaceBinderKey(capabilityBinder)}`,
          }),
        ],
      };
    }
    patches.push({
      kind: "capability",
      action: "consume",
      capability,
    });
    const subjectKey = `consume:${capability.capabilityKey}`;
    certificates.push(certificateForSubject(subjectKey));
    packetEntries.push(
      buildCapabilityFlowPacketEntry({
        capabilityKey: capability.capabilityKey,
        capabilityKind: capability.capabilityKind,
        flowKind: "consume",
        operationOriginKey: input.ownerKey,
        dependencyPlaceKeys: [capability.capabilityKey],
      }),
    );
  }

  const producedCapabilities = [...input.contract.producedCapabilities].sort((left, right) =>
    compareCodeUnitStrings(proofCheckPlaceBinderKey(left), proofCheckPlaceBinderKey(right)),
  );
  for (const capabilityBinder of producedCapabilities) {
    const binderKey = proofCheckPlaceBinderKey(capabilityBinder);
    const capabilityKey = input.capabilityPlaceKeys?.get(binderKey) ?? binderKey;
    const capability: CheckedCapabilityState = {
      capabilityKey,
      capabilityKind: binderKey,
    };
    patches.push({
      kind: "capability",
      action: "produce",
      capability,
    });
    const subjectKey = `produce:${capabilityKey}`;
    certificates.push(certificateForSubject(subjectKey));
    packetEntries.push(
      buildCapabilityFlowPacketEntry({
        capabilityKey,
        capabilityKind: capability.capabilityKind,
        flowKind: "produce",
        operationOriginKey: input.ownerKey,
        dependencyPlaceKeys: [],
      }),
    );
  }

  return { kind: "ok", patches, certificates, packetEntries };
}

function validateProvidedContract(
  input: PlatformContractTransferInput,
): PlatformContractResolveResult {
  const ownerKey = callOriginKey(input);
  if (!certifiedPlatformTargetMatches(input)) {
    return {
      kind: "error",
      diagnostics: [
        platformContractMissingDiagnostic({
          ownerKey,
          rootCauseKey: String(input.platformEdge.edgeId),
          detail: `platform-call-target-mismatch:${String(input.platformEdge.edgeId)}`,
        }),
      ],
    };
  }

  if (input.monoEdge !== undefined) {
    if (
      input.monoEdge.primitiveId !== input.platformEdge.primitiveId ||
      input.monoEdge.edgeId !== input.platformEdge.edgeId ||
      !abiReferencesMatch(input.platformEdge.abi, input.monoEdge.abi, input.monoEdge)
    ) {
      return {
        kind: "error",
        diagnostics: [
          platformContractMissingDiagnostic({
            ownerKey,
            rootCauseKey: String(input.monoEdge.edgeId),
            detail: `platform-edge-mismatch:${String(input.monoEdge.edgeId)}`,
          }),
        ],
      };
    }
    if (
      input.contract.targetId !== input.monoEdge.targetId ||
      input.contract.primitiveId !== input.monoEdge.primitiveId ||
      input.contract.contractId !== input.monoEdge.contractId
    ) {
      return {
        kind: "error",
        diagnostics: [
          platformContractMissingDiagnostic({
            ownerKey,
            rootCauseKey: input.contract.authorityKey,
            detail: `platform-contract-mismatch:${input.contract.authorityKey}`,
          }),
        ],
      };
    }
  }

  if (input.catalog !== undefined && input.monoEdge !== undefined) {
    const catalogContract = input.catalog.get({
      targetId: input.monoEdge.targetId,
      primitiveId: input.monoEdge.primitiveId,
      contractId: input.monoEdge.contractId,
    });
    if (
      catalogContract === undefined ||
      catalogContract.authorityKey !== input.contract.authorityKey
    ) {
      return {
        kind: "error",
        diagnostics: [
          platformContractMissingDiagnostic({
            ownerKey,
            rootCauseKey: `${input.monoEdge.targetId}:${input.monoEdge.primitiveId}:${input.monoEdge.contractId}`,
            detail: `platform-contract-missing:${input.monoEdge.targetId}:${input.monoEdge.primitiveId}:${input.monoEdge.contractId}`,
          }),
        ],
      };
    }
  }

  return {
    kind: "ok",
    resolution: {
      contract: input.contract,
      authorityKey: input.contract.authorityKey,
      targetId: input.contract.targetId,
      primitiveId: input.contract.primitiveId,
      contractId: input.contract.contractId,
      edgeId: input.platformEdge.edgeId,
    },
  };
}

export function checkPlatformContractTransfer(
  input: PlatformContractTransferInput,
): PlatformContractTransferResult {
  const ownerKey = callOriginKey(input);
  const resolutionResult = validateProvidedContract(input);
  if (resolutionResult.kind === "error") {
    return resolutionResult;
  }

  const operandResult = checkOperandBindings({
    state: input.state,
    bindings: input.operandBindings,
    ownerKey,
    placeResolver: input.placeResolver,
  });
  if (operandResult.kind === "error") {
    return operandResult;
  }

  const preconditionResult = checkPlatformPreconditions({
    state: input.state,
    contract: input.contract,
    ownerKey,
    capabilityPlaceKeys: input.operandBindings?.capabilityPlaceKeys,
    activeFactTerms: input.activeFactTerms,
  });
  if (preconditionResult.kind === "error") {
    return preconditionResult;
  }

  const capabilityFlowResult = applyContractCapabilityFlow({
    state: input.state,
    contract: input.contract,
    ownerKey,
    capabilityPlaceKeys: input.operandBindings?.capabilityPlaceKeys,
  });
  if (capabilityFlowResult.kind === "error") {
    return capabilityFlowResult;
  }

  const effectsResult = applyPlatformContractEffects({
    state: input.state,
    contract: input.contract,
    preFacts: input.preFacts ?? input.activeFactTerms,
    operationOriginKey: ownerKey,
    programPointScope: input.programPointScope,
    privateStateAdvance: input.privateStateAdvance,
    placeResolver: input.placeResolver,
    operandBindings: input.effectOperandBindings,
  });
  if (effectsResult.kind === "error") {
    return effectsResult;
  }
  const preconditionCertificates = preconditionResult.certificates.filter(
    isProofCheckCoreCertificate,
  );

  const platformPreconditionPacketEntries =
    input.catalog === undefined
      ? []
      : [
          buildPlatformPreconditionPacketEntry({
            resolution: resolutionResult.resolution,
            contract: input.contract,
            operationOriginKey: ownerKey,
            catalogFingerprint: input.catalog.fingerprint,
            preconditionCertificates,
          }),
        ];

  const certificates = [
    ...operandResult.certificates,
    ...preconditionCertificates.map((certificate) =>
      certificateForSubject(proofCheckCoreCertificateStableKey(certificate)),
    ),
    ...capabilityFlowResult.certificates,
    ...effectsResult.certificates,
  ].sort((left, right) => compareCodeUnitStrings(String(left.id), String(right.id)));

  const packetEntries = [
    ...operandResult.packetEntries,
    ...platformPreconditionPacketEntries,
    ...capabilityFlowResult.packetEntries,
    ...effectsResult.packetEntries,
  ].sort((left, right) => {
    const kindCmp = compareCodeUnitStrings(left.kind, right.kind);
    if (kindCmp !== 0) {
      return kindCmp;
    }
    return compareCodeUnitStrings(String(left.factId), String(right.factId));
  });

  return {
    kind: "ok",
    resolution: resolutionResult.resolution,
    patches: [
      ...operandResult.patches,
      ...capabilityFlowResult.patches,
      ...effectsResult.patch.entries,
    ],
    certificates,
    packetEntries,
  };
}

export function platformCallIdForTest(
  functionInstanceId: MonoInstanceId,
  callId: ProofMirCallId,
): ProofMirCallGraphEdge["callId"] {
  return proofMirOwnedCallId(functionInstanceId, callId);
}
