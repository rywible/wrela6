import { stableNumericSeed } from "../stable-numeric-seed";
import type { MonoInstanceId } from "../../mono/ids";
import {
  proofMirOriginId,
  proofMirOwnedCallId,
  proofMirOwnedCallIdKey,
  proofMirOwnedPlaceIdKey,
  proofMirPlaceId,
  type ProofMirCallId,
  type ProofMirOwnedPlaceId,
  type ProofMirRuntimeCallId,
} from "../../proof-mir/ids";
import type { ProofMirCallGraphEdge } from "../../proof-mir/model/calls";
import type { ProofMirRuntimeCallContract } from "../../proof-mir/model/calls";
import type { ProofMirRuntimeCatalog } from "../../runtime/runtime-catalog-types";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  authenticateProofCheckRuntimeCatalog,
  convertRuntimeEffectSchemaToContractEffect,
  normalizeRuntimeFactSchemaRequirement,
  normalizeRuntimeFactSchemaTrustedAxiom,
  normalizeRuntimePlaceSchema,
  type ProofCheckRuntimeCatalog,
  type ProofCheckRuntimeOperation,
} from "../authority/runtime-authority";
import type { ProofCheckContractEffect } from "../authority/platform-contracts";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import { proofCheckCoreCertificateId, proofCheckPacketFactId } from "../ids";
import type { ProofCheckCertificateId, ProofCheckCoreCertificate } from "../model/certificates";
import {
  checkedFactKindId,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedOriginFact,
} from "../model/fact-packet";
import {
  normalizeProofCheckTerm,
  proofCheckPlaceBinderKey,
  syntheticBinderId,
  type ProofCheckFactTerm,
  type ProofCheckPlaceBinder,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import type { CheckedCapabilityState, ProofCheckState } from "../kernel/state";
import {
  buildProofCheckFactEnvironment,
  checkCallRequirementsEntailment,
  proofCheckCoreCertificateStableKey,
} from "./facts";
import { checkUseWithLoans } from "./loans";
import {
  applyPlatformEffectInvalidation,
  type PlatformContractEffectsInput,
} from "./platform-contract-effects";
import { applySummaryPlaceEffect, type ProofCheckConcreteResourceKind } from "./ownership";

export interface RuntimeContractOperandBinding {
  readonly mode: "observe" | "consume";
  readonly placeKey: string;
  readonly resourceKind: ProofCheckConcreteResourceKind;
}

export interface RuntimeContractOperandBindings {
  readonly arguments?: readonly RuntimeContractOperandBinding[];
  readonly capabilityPlaceKeys?: ReadonlyMap<string, string>;
  readonly ownedPlaceKeys?: ReadonlyMap<string, string>;
}

export interface RuntimeContractTransferInput {
  readonly state: ProofCheckState;
  readonly runtimeCall: ProofMirRuntimeCallContract;
  readonly operation: ProofCheckRuntimeOperation;
  readonly call?: ProofMirCallGraphEdge;
  readonly embeddedCatalog?: ProofMirRuntimeCatalog;
  readonly selectedCatalog?: ProofCheckRuntimeCatalog;
  readonly operandBindings?: RuntimeContractOperandBindings;
  readonly activeFactTerms?: readonly ProofCheckRequirementTerm[];
  readonly programPointScope?: CheckedFactScope;
  readonly privateStateAdvance?: PlatformContractEffectsInput["privateStateAdvance"];
  readonly operationOriginKey?: string;
}

export type RuntimeContractTransferResult =
  | {
      readonly kind: "ok";
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

function originForRuntimeFact(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

function runtimeTransferCertificate(subjectKey: string): ProofCheckCoreCertificate {
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
    id: runtimeTransferCertificate(subjectKey).certificateId,
  };
}

function callOriginKey(input: RuntimeContractTransferInput): string {
  return input.operationOriginKey ?? `runtime-call:${String(input.runtimeCall.runtimeCallId)}`;
}

function runtimePreconditionFailedDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_RUNTIME_PRECONDITION_FAILED",
    messageTemplateId: "runtime.precondition-failed",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function runtimeCapabilityFlowMismatchDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_FORGED_TRUSTED_AXIOM",
    messageTemplateId: "runtime.capability-flow-mismatch",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function runtimeCallTargetMismatchDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_RUNTIME_PRECONDITION_FAILED",
    messageTemplateId: "runtime.call-target-mismatch",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function certifiedRuntimeTargetMatches(input: {
  readonly call: ProofMirCallGraphEdge;
  readonly runtimeCall: ProofMirRuntimeCallContract;
  readonly operation: ProofCheckRuntimeOperation;
}): boolean {
  if (input.call.target.kind !== "compilerRuntime") {
    return false;
  }
  return (
    input.call.target.runtimeId === input.operation.runtimeId &&
    input.call.target.runtimeCallId === input.runtimeCall.runtimeCallId &&
    proofMirOwnedCallIdKey(input.call.callId) === proofMirOwnedCallIdKey(input.runtimeCall.callId)
  );
}

function placeBinderForOwnedPlace(
  ownedPlace: ProofMirOwnedPlaceId,
  bindings: RuntimeContractOperandBindings | undefined,
): ProofCheckPlaceBinder {
  const ownedKey = proofMirOwnedPlaceIdKey(ownedPlace);
  const placeKey = bindings?.ownedPlaceKeys?.get(ownedKey);
  if (placeKey !== undefined) {
    return { kind: "synthetic", id: syntheticBinderId(placeKey) };
  }
  return { kind: "synthetic", id: syntheticBinderId(ownedKey) };
}

function convertRuntimeCallEffectToContractEffect(
  effect: ProofMirRuntimeCallContract["effects"][number],
  bindings: RuntimeContractOperandBindings | undefined,
): ProofCheckContractEffect {
  switch (effect.kind) {
    case "pure":
    case "mayPanic":
    case "doesNotReturn":
      return { kind: effect.kind };
    case "readsMemory":
    case "writesMemory":
    case "advancesPrivateState":
      return {
        kind: effect.kind,
        place: placeBinderForOwnedPlace(effect.place, bindings),
      };
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

function runtimeRequirementTerms(
  operation: ProofCheckRuntimeOperation,
): ProofCheckRequirementTerm[] {
  return operation.requiredFactSchemas
    .filter((schema) => schema.role === "requirement")
    .sort((left, right) => compareCodeUnitStrings(left.name, right.name))
    .map((schema) => normalizeRuntimeFactSchemaRequirement(schema));
}

function runtimeTrustedAxiomTerms(operation: ProofCheckRuntimeOperation): ProofCheckFactTerm[] {
  return operation.requiredFactSchemas
    .filter((schema) => schema.role === "trustedAxiom")
    .sort((left, right) => compareCodeUnitStrings(left.name, right.name))
    .map((schema) => normalizeRuntimeFactSchemaTrustedAxiom(schema));
}

function checkRuntimePreconditions(input: {
  readonly state: ProofCheckState;
  readonly operation: ProofCheckRuntimeOperation;
  readonly ownerKey: string;
  readonly activeFactTerms?: readonly ProofCheckRequirementTerm[];
}):
  | RuntimeContractTransferResult
  | { readonly kind: "ok"; readonly certificates: readonly ProofCheckCoreCertificate[] } {
  const preconditions = runtimeRequirementTerms(input.operation);
  if (preconditions.length === 0) {
    return { kind: "ok", certificates: [] };
  }

  const environment = buildProofCheckFactEnvironment({
    state: input.state,
    terms: input.activeFactTerms ?? [],
    ownerKey: input.ownerKey,
  });
  const entailmentResult = checkCallRequirementsEntailment(environment, preconditions, {
    ownerKey: input.ownerKey,
  });
  if (entailmentResult.kind === "error") {
    const diagnostics = entailmentResult.diagnostics.map((diagnostic) =>
      runtimePreconditionFailedDiagnostic({
        ownerKey: diagnostic.ownerKey,
        rootCauseKey: diagnostic.rootCauseKey,
        detail: diagnostic.stableDetail,
      }),
    );
    return { kind: "error", diagnostics: sortProofCheckDiagnostics(diagnostics) };
  }

  return { kind: "ok", certificates: entailmentResult.certificates };
}

function checkOperandBindings(input: {
  readonly state: ProofCheckState;
  readonly bindings: RuntimeContractOperandBindings | undefined;
  readonly ownerKey: string;
}):
  | RuntimeContractTransferResult
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
  if (bindings?.arguments === undefined) {
    return { kind: "ok", patches, certificates, packetEntries };
  }

  for (const operand of bindings.arguments) {
    const place = { placeKey: operand.placeKey };
    const ownershipResult =
      operand.mode === "observe"
        ? applySummaryPlaceEffect({
            state: input.state,
            place,
            resourceKind: operand.resourceKind,
            mode: "observe",
            operationOriginKey: input.ownerKey,
          })
        : applySummaryPlaceEffect({
            state: input.state,
            place,
            resourceKind: operand.resourceKind,
            mode: "consume",
            operationOriginKey: input.ownerKey,
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

function capabilityStateForBinder(
  state: ProofCheckState,
  binderKey: string,
  capabilityPlaceKeys: ReadonlyMap<string, string> | undefined,
): CheckedCapabilityState | undefined {
  const capabilityKey = capabilityPlaceKeys?.get(binderKey) ?? binderKey;
  for (const capability of state.capabilities.values()) {
    if (capability.capabilityKey === capabilityKey) {
      return capability;
    }
  }
  return undefined;
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
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`capabilityFlow:${subjectKey}`)),
    kind: checkedFactKindId("capabilityFlow"),
    subject: { kind: "place", placeId: subjectPlaceId },
    scope: defaultScope(),
    dependencies: [],
    invalidatedBy: [{ kind: "placeConsume", placeId: subjectPlaceId }],
    certificate: certificateForSubject(subjectKey),
    origin: originForRuntimeFact(input.operationOriginKey),
  };
}

function applyRuntimeCapabilityFlow(input: {
  readonly state: ProofCheckState;
  readonly operation: ProofCheckRuntimeOperation;
  readonly runtimeCall: ProofMirRuntimeCallContract;
  readonly ownerKey: string;
  readonly capabilityPlaceKeys?: ReadonlyMap<string, string>;
}):
  | RuntimeContractTransferResult
  | {
      readonly kind: "ok";
      readonly patches: ProofCheckStatePatchEntry[];
      readonly certificates: ProofCheckCertificateId[];
      readonly packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
    } {
  const patches: ProofCheckStatePatchEntry[] = [];
  const certificates: ProofCheckCertificateId[] = [];
  const packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];

  if (
    input.runtimeCall.consumedCapabilities.length > input.operation.consumedCapabilitySchemas.length
  ) {
    return {
      kind: "error",
      diagnostics: [
        runtimeCapabilityFlowMismatchDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: input.operation.authorityKey,
          detail: "runtime-consumed-capability-without-catalog-schema",
        }),
      ],
    };
  }

  if (
    input.runtimeCall.producedCapabilities.length > input.operation.producedCapabilitySchemas.length
  ) {
    return {
      kind: "error",
      diagnostics: [
        runtimeCapabilityFlowMismatchDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: input.operation.authorityKey,
          detail: "runtime-produced-capability-without-catalog-schema",
        }),
      ],
    };
  }

  const consumedSchemas = [...input.operation.consumedCapabilitySchemas].sort((left, right) =>
    compareCodeUnitStrings(
      proofCheckPlaceBinderKey(normalizeRuntimePlaceSchema(left)),
      proofCheckPlaceBinderKey(normalizeRuntimePlaceSchema(right)),
    ),
  );
  for (const schema of consumedSchemas) {
    const binderKey = proofCheckPlaceBinderKey(normalizeRuntimePlaceSchema(schema));
    const capability = capabilityStateForBinder(input.state, binderKey, input.capabilityPlaceKeys);
    if (capability === undefined) {
      return {
        kind: "error",
        diagnostics: [
          runtimeCapabilityFlowMismatchDiagnostic({
            ownerKey: input.ownerKey,
            rootCauseKey: binderKey,
            detail: `missing-consumed-capability:${binderKey}`,
          }),
        ],
      };
    }
    patches.push({
      kind: "capability",
      action: "consume",
      capability,
    });
    certificates.push(certificateForSubject(`consume:${capability.capabilityKey}`));
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

  const producedSchemas = [...input.operation.producedCapabilitySchemas].sort((left, right) =>
    compareCodeUnitStrings(
      proofCheckPlaceBinderKey(normalizeRuntimePlaceSchema(left)),
      proofCheckPlaceBinderKey(normalizeRuntimePlaceSchema(right)),
    ),
  );
  for (const schema of producedSchemas) {
    const binderKey = proofCheckPlaceBinderKey(normalizeRuntimePlaceSchema(schema));
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
    certificates.push(certificateForSubject(`produce:${capabilityKey}`));
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

function activeFactFromTerm(term: ProofCheckFactTerm) {
  const normalized = normalizeProofCheckTerm(term);
  return {
    factKey: normalized.key,
    termKey: normalized.key,
  };
}

function applyRuntimeTrustedAxioms(input: {
  readonly operation: ProofCheckRuntimeOperation;
  readonly runtimeCall: ProofMirRuntimeCallContract;
  readonly ownerKey: string;
}):
  | RuntimeContractTransferResult
  | {
      readonly kind: "ok";
      readonly patches: ProofCheckStatePatchEntry[];
      readonly certificates: ProofCheckCertificateId[];
      readonly packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
    } {
  const trustedSchemas = input.operation.requiredFactSchemas.filter(
    (schema) => schema.role === "trustedAxiom",
  );
  if (trustedSchemas.length !== input.runtimeCall.requiredFacts.length) {
    return {
      kind: "error",
      diagnostics: [
        runtimeCapabilityFlowMismatchDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: input.operation.authorityKey,
          detail: `runtime-trusted-axiom-count-mismatch:${trustedSchemas.length}:${input.runtimeCall.requiredFacts.length}`,
        }),
      ],
    };
  }

  const patches: ProofCheckStatePatchEntry[] = [];
  const certificates: ProofCheckCertificateId[] = [];
  const trustedTerms = runtimeTrustedAxiomTerms(input.operation);

  for (const term of trustedTerms) {
    patches.push({
      kind: "fact",
      action: "add",
      fact: activeFactFromTerm(term),
    });
    certificates.push(certificateForSubject(normalizeProofCheckTerm(term).key));
  }

  return { kind: "ok", patches, certificates, packetEntries: [] };
}

function applyRuntimeEffects(input: {
  readonly state: ProofCheckState;
  readonly operation: ProofCheckRuntimeOperation;
  readonly runtimeCall: ProofMirRuntimeCallContract;
  readonly ownerKey: string;
  readonly operandBindings?: RuntimeContractOperandBindings;
  readonly programPointScope?: CheckedFactScope;
  readonly privateStateAdvance?: PlatformContractEffectsInput["privateStateAdvance"];
}):
  | RuntimeContractTransferResult
  | {
      readonly kind: "ok";
      readonly patches: ProofCheckStatePatchEntry[];
      readonly certificates: ProofCheckCertificateId[];
      readonly packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
    } {
  const patches: ProofCheckStatePatchEntry[] = [];
  const certificates: ProofCheckCertificateId[] = [];
  const packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];

  const contractEffects =
    input.runtimeCall.effects.length > 0
      ? input.runtimeCall.effects.map((effect) =>
          convertRuntimeCallEffectToContractEffect(effect, input.operandBindings),
        )
      : input.operation.effectSchemas.map((effect) =>
          convertRuntimeEffectSchemaToContractEffect(effect),
        );

  const sortedEffects = [...contractEffects].sort((left, right) =>
    compareCodeUnitStrings(left.kind, right.kind),
  );

  for (const effect of sortedEffects) {
    const invalidation = applyPlatformEffectInvalidation({
      state: input.state,
      effect,
      preservationFacts: [],
      operationOriginKey: input.ownerKey,
    });
    if (invalidation.kind === "error") {
      return invalidation;
    }
    patches.push(...invalidation.patches);
    certificates.push(...invalidation.certificates);
  }

  return { kind: "ok", patches, certificates, packetEntries };
}

export function checkRuntimeContractTransfer(
  input: RuntimeContractTransferInput,
): RuntimeContractTransferResult {
  const ownerKey = callOriginKey(input);

  if (input.embeddedCatalog !== undefined && input.selectedCatalog !== undefined) {
    const authentication = authenticateProofCheckRuntimeCatalog({
      embedded: input.embeddedCatalog,
      selected: input.selectedCatalog,
      operationOriginKey: ownerKey,
    });
    if (authentication.kind === "error") {
      return authentication;
    }
  }

  if (input.runtimeCall.runtimeId !== input.operation.runtimeId) {
    return {
      kind: "error",
      diagnostics: [
        runtimeCallTargetMismatchDiagnostic({
          ownerKey,
          rootCauseKey: String(input.runtimeCall.runtimeId),
          detail: `runtime-operation-mismatch:${String(input.runtimeCall.runtimeId)}:${String(input.operation.runtimeId)}`,
        }),
      ],
    };
  }

  if (
    input.call !== undefined &&
    !certifiedRuntimeTargetMatches({
      call: input.call,
      runtimeCall: input.runtimeCall,
      operation: input.operation,
    })
  ) {
    return {
      kind: "error",
      diagnostics: [
        runtimeCallTargetMismatchDiagnostic({
          ownerKey,
          rootCauseKey: String(input.runtimeCall.runtimeCallId),
          detail: `runtime-call-target-mismatch:${String(input.runtimeCall.runtimeCallId)}`,
        }),
      ],
    };
  }

  const operandResult = checkOperandBindings({
    state: input.state,
    bindings: input.operandBindings,
    ownerKey,
  });
  if (operandResult.kind === "error") {
    return operandResult;
  }

  const preconditionResult = checkRuntimePreconditions({
    state: input.state,
    operation: input.operation,
    ownerKey,
    activeFactTerms: input.activeFactTerms,
  });
  if (preconditionResult.kind === "error") {
    return preconditionResult;
  }

  const trustedAxiomResult = applyRuntimeTrustedAxioms({
    operation: input.operation,
    runtimeCall: input.runtimeCall,
    ownerKey,
  });
  if (trustedAxiomResult.kind === "error") {
    return trustedAxiomResult;
  }

  const capabilityFlowResult = applyRuntimeCapabilityFlow({
    state: input.state,
    operation: input.operation,
    runtimeCall: input.runtimeCall,
    ownerKey,
    capabilityPlaceKeys: input.operandBindings?.capabilityPlaceKeys,
  });
  if (capabilityFlowResult.kind === "error") {
    return capabilityFlowResult;
  }

  const effectsResult = applyRuntimeEffects({
    state: input.state,
    operation: input.operation,
    runtimeCall: input.runtimeCall,
    ownerKey,
    operandBindings: input.operandBindings,
    programPointScope: input.programPointScope,
    privateStateAdvance: input.privateStateAdvance,
  });
  if (effectsResult.kind === "error") {
    return effectsResult;
  }

  const certificates = [
    ...operandResult.certificates,
    ...(preconditionResult.kind === "ok"
      ? (preconditionResult.certificates as readonly ProofCheckCoreCertificate[]).map(
          (certificate) => certificateForSubject(proofCheckCoreCertificateStableKey(certificate)),
        )
      : []),
    ...trustedAxiomResult.certificates,
    ...capabilityFlowResult.certificates,
    ...effectsResult.certificates,
  ].sort((left, right) => compareCodeUnitStrings(String(left.id), String(right.id)));

  const packetEntries = [
    ...operandResult.packetEntries,
    ...trustedAxiomResult.packetEntries,
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
    patches: [
      ...operandResult.patches,
      ...trustedAxiomResult.patches,
      ...capabilityFlowResult.patches,
      ...effectsResult.patches,
    ],
    certificates,
    packetEntries,
  };
}

export function runtimeCallGraphEdgeForTest(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly callId: ProofMirCallId;
  readonly runtimeId: ProofCheckRuntimeOperation["runtimeId"];
  readonly runtimeCallId: ProofMirRuntimeCallId;
}): ProofMirCallGraphEdge {
  return {
    callId: proofMirOwnedCallId(input.functionInstanceId, input.callId),
    target: {
      kind: "compilerRuntime",
      runtimeId: input.runtimeId,
      runtimeCallId: input.runtimeCallId,
    },
    origin: proofMirOriginId(stableNumericSeed(`runtime-call:${String(input.runtimeCallId)}`)),
  };
}
