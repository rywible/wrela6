import { stableNumericSeed } from "../stable-numeric-seed";
import type { BrandId } from "../../hir/ids";
import type { MonoCheckedType, MonoInstantiatedProofId } from "../../mono/mono-hir";
import { proofMirOriginId } from "../../proof-mir/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofCheckTypeFactCatalog } from "../authority/type-fact-authority";
import {
  proofMirPlaceIdForPlaceKey,
  type ProofCheckPlaceResolver,
} from "../kernel/registry/transition-helpers";
import { proofCheckLiveValueScopeId } from "../authority/type-fact-authority";
import type { ProofCheckLiveValueScopeId } from "../authority/type-fact-authority";
import type { ProofSemanticsCompanion } from "../authority/semantics-companion";
import {
  validateProofSemanticsJudgmentResult,
  type ProofCrossCoreOwnershipJudgmentInput,
  type ProofSemanticsJudgmentRequest,
} from "../authority/semantics-companion";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import {
  proofCheckCoreCertificateId,
  proofCheckPacketFactId,
  type ProofCheckTransitionId,
} from "../ids";
import type { ProofCheckCertificateId } from "../model/certificates";
import type { ProofCheckCoreCertificate } from "../model/certificates";
import {
  checkedFactKindId,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedOriginFact,
} from "../model/fact-packet";
import { platformEffectKindId, type ProofCapabilityKindId } from "../model/fact-language";
import {
  proofCheckStatePatchWithTransitionId,
  type ProofCheckStatePatch,
  type ProofCheckStatePatchEntry,
  type ProofCheckPatchKind,
} from "../kernel/state-patch";
import { reduceProofCheckState } from "../kernel/state-reducer";
import {
  type CheckedAttemptState,
  type CheckedCapabilityState,
  type CheckedLoanState,
  type CheckedObligationState,
  type CheckedSessionState,
  type CheckedValidationState,
  type ProofCheckState,
  type ProofCheckStructuredPlace,
} from "../kernel/state";
import { checkUsePlace, type ProofCheckConcreteResourceKind } from "./ownership";

export interface CrossCoreTransferCatalogSpec {
  readonly typeFacts: ProofCheckTypeFactCatalog;
  readonly concreteType: MonoCheckedType;
  readonly brand?: MonoInstantiatedProofId<BrandId>;
  readonly resourceKind: ProofCheckConcreteResourceKind;
  readonly operationAuthorityKey: string;
  readonly liveValueScope?: ProofCheckLiveValueScopeId;
}

export interface CrossCoreOwnershipTransferInput {
  readonly state: ProofCheckState;
  readonly sourcePlace: ProofCheckStructuredPlace;
  readonly destinationCoreKey: string;
  readonly capabilityKind: ProofCapabilityKindId;
  readonly companion: ProofSemanticsCompanion;
  readonly transitionId: ProofCheckTransitionId;
  readonly catalog?: CrossCoreTransferCatalogSpec;
  readonly orderingFactKey?: string;
  readonly operationOriginKey?: string;
  readonly dependencyKeys?: ReadonlySet<string>;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export type CrossCoreOwnershipTransferResult =
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

const NON_TRANSFERABLE_RESOURCE_KINDS: ReadonlySet<ProofCheckConcreteResourceKind> = new Set([
  "UniqueEdgeRoot",
  "EdgePath",
  "Stream",
  "ValidatedBuffer",
  "PrivateState",
  "SealedPlatformToken",
]);

function defaultOwnerKey(ownerKey: string | undefined, sourcePlaceKey: string): string {
  return ownerKey ?? `cross-core:${sourcePlaceKey}`;
}

function defaultScope(): CheckedFactScope {
  return { kind: "wholeImage" };
}

function originForCrossCoreFact(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

function crossCoreCertificateForSubject(subjectKey: string): ProofCheckCoreCertificate {
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
    id: crossCoreCertificateForSubject(subjectKey).certificateId,
  };
}

function crossCoreCertificateMissingDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_CROSS_CORE_CERTIFICATE_MISSING",
    messageTemplateId: "proof-check.cross-core.certificate-missing",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function crossCoreEligibilityDiagnostic(input: {
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
    messageTemplateId: "proof-check.cross-core.ineligible-transfer",
    messageArguments: [{ kind: "text", value: input.detail }],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function invalidStatePatchDiagnostics(
  diagnostics: readonly ProofCheckDiagnostic[],
  ownerKey: string,
): readonly ProofCheckDiagnostic[] {
  return sortProofCheckDiagnostics(
    diagnostics.map((diagnostic) =>
      proofCheckDiagnostic({
        ...diagnostic,
        ownerKey,
        rootCauseKey: ownerKey,
      }),
    ),
  );
}

function placeRootKey(placeKey: string): string {
  return placeKey.split(".")[0] ?? placeKey;
}

function sortedOpenObligations(state: ProofCheckState): CheckedObligationState[] {
  return [...state.obligations.values()]
    .filter((obligation) => obligation.status === "open")
    .sort((left, right) => compareCodeUnitStrings(left.obligationKey, right.obligationKey));
}

function sortedOpenSessions(state: ProofCheckState): CheckedSessionState[] {
  return [...state.sessions.values()].sort((left, right) =>
    compareCodeUnitStrings(left.sessionKey, right.sessionKey),
  );
}

function sortedPendingValidations(state: ProofCheckState): CheckedValidationState[] {
  return [...state.validations.values()]
    .filter((validation) => validation.status === "pending")
    .sort((left, right) => compareCodeUnitStrings(left.validationKey, right.validationKey));
}

function sortedPendingAttempts(state: ProofCheckState): CheckedAttemptState[] {
  return [...state.attempts.values()]
    .filter((attempt) => attempt.status === "pending")
    .sort((left, right) => compareCodeUnitStrings(left.attemptKey, right.attemptKey));
}

function sortedLoansForPlace(state: ProofCheckState, placeKey: string): CheckedLoanState[] {
  return [...state.loans.values()]
    .filter((loan) => loan.placeKey === placeKey || loan.placeKey.startsWith(`${placeKey}.`))
    .sort((left, right) => compareCodeUnitStrings(left.loanKey, right.loanKey));
}

function isPartiallyMovedAggregate(state: ProofCheckState, placeKey: string): boolean {
  const rootKey = placeRootKey(placeKey);
  const rootLifecycle = state.places.get(rootKey)?.lifecycle;
  if (rootLifecycle === "owned") {
    for (const place of state.places.values()) {
      if (place.placeKey.startsWith(`${rootKey}.`) && place.lifecycle === "moved") {
        return true;
      }
    }
  }
  if (rootLifecycle === "moved") {
    for (const place of state.places.values()) {
      if (
        place.placeKey.startsWith(`${rootKey}.`) &&
        (place.lifecycle === "owned" || place.lifecycle === "consumed")
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasPacketSourceBinding(state: ProofCheckState, placeKey: string): boolean {
  const rootKey = placeRootKey(placeKey);
  for (const packetSource of state.packetSources.values()) {
    if (packetSource.packetKey === rootKey || packetSource.sourceKey === rootKey) {
      return true;
    }
  }
  return false;
}

function hasPrivateStateBinding(state: ProofCheckState, placeKey: string): boolean {
  return state.privateState.has(placeRootKey(placeKey));
}

function hasNonTransferableCapabilityDependency(
  state: ProofCheckState,
  sourcePlaceKey: string,
): CheckedCapabilityState | undefined {
  for (const capability of state.capabilities.values()) {
    if (
      capability.capabilityKey === sourcePlaceKey ||
      capability.capabilityKey.startsWith(`${sourcePlaceKey}.`)
    ) {
      if (
        capability.capabilityKind.includes("platform") ||
        capability.capabilityKind.includes("sealed")
      ) {
        return capability;
      }
    }
  }
  return undefined;
}

function validateCatalogTransferEligibility(input: {
  readonly catalog: CrossCoreTransferCatalogSpec;
  readonly capabilityKind: ProofCapabilityKindId;
  readonly ownerKey: string;
}): CrossCoreOwnershipTransferResult | { readonly kind: "ok" } {
  if (NON_TRANSFERABLE_RESOURCE_KINDS.has(input.catalog.resourceKind)) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: input.catalog.resourceKind,
          detail: `non-transferable-resource-kind:${input.catalog.resourceKind}`,
        }),
      ],
    };
  }

  const liveValueScope =
    input.catalog.liveValueScope ?? proofCheckLiveValueScopeId("reachable-local");
  const entries = input.catalog.typeFacts.get({
    concreteType: input.catalog.concreteType,
    brand: input.catalog.brand,
    capabilityKind: input.capabilityKind,
    liveValueScope,
  });
  if (entries.length === 0) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: input.catalog.operationAuthorityKey,
          detail: `missing-transfer-eligibility-catalog-entry:${input.catalog.operationAuthorityKey}`,
        }),
      ],
    };
  }

  const matchingEntry = entries.find(
    (entry) => entry.authorityKey === input.catalog.operationAuthorityKey,
  );
  if (matchingEntry === undefined) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: input.catalog.operationAuthorityKey,
          detail: `operation-authority-mismatch:${input.catalog.operationAuthorityKey}`,
        }),
      ],
    };
  }

  return { kind: "ok" };
}

function validateCrossCoreTransferEligibility(input: {
  readonly state: ProofCheckState;
  readonly sourcePlace: ProofCheckStructuredPlace;
  readonly catalog?: CrossCoreTransferCatalogSpec;
  readonly capabilityKind: ProofCapabilityKindId;
  readonly ownerKey: string;
}): CrossCoreOwnershipTransferResult | { readonly kind: "ok" } {
  const sourcePlaceKey = input.sourcePlace.placeKey;
  const rootKey = placeRootKey(sourcePlaceKey);

  if (input.catalog !== undefined) {
    const catalogResult = validateCatalogTransferEligibility({
      catalog: input.catalog,
      capabilityKind: input.capabilityKind,
      ownerKey: input.ownerKey,
    });
    if (catalogResult.kind === "error") {
      return catalogResult;
    }
    if (
      input.catalog.resourceKind === "EdgePath" ||
      input.catalog.resourceKind === "UniqueEdgeRoot"
    ) {
      return {
        kind: "error",
        diagnostics: [
          crossCoreEligibilityDiagnostic({
            ownerKey: input.ownerKey,
            rootCauseKey: rootKey,
            detail: `path-branded:${rootKey}`,
          }),
        ],
      };
    }
  }

  const loans = sortedLoansForPlace(input.state, sourcePlaceKey);
  if (loans.length > 0) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: loans[0]!.loanKey,
          detail: `borrowed:${sourcePlaceKey}`,
        }),
      ],
    };
  }

  if (hasPacketSourceBinding(input.state, sourcePlaceKey)) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: rootKey,
          detail: `packet-source-bound:${rootKey}`,
        }),
      ],
    };
  }

  if (hasPrivateStateBinding(input.state, sourcePlaceKey)) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: rootKey,
          detail: `private-state-bound:${rootKey}`,
        }),
      ],
    };
  }

  const openObligation = sortedOpenObligations(input.state)[0];
  if (openObligation !== undefined) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: openObligation.obligationKey,
          detail: `open-obligation:${openObligation.obligationKey}`,
        }),
      ],
    };
  }

  const openSession = sortedOpenSessions(input.state)[0];
  if (openSession !== undefined) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: openSession.sessionKey,
          detail: `open-session:${openSession.sessionKey}`,
        }),
      ],
    };
  }

  const pendingValidation = sortedPendingValidations(input.state)[0];
  if (pendingValidation !== undefined) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: pendingValidation.validationKey,
          detail: `pending-validation:${pendingValidation.validationKey}`,
        }),
      ],
    };
  }

  const pendingAttempt = sortedPendingAttempts(input.state)[0];
  if (pendingAttempt !== undefined) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: pendingAttempt.attemptKey,
          detail: `pending-attempt:${pendingAttempt.attemptKey}`,
        }),
      ],
    };
  }

  const nonTransferableCapability = hasNonTransferableCapabilityDependency(
    input.state,
    sourcePlaceKey,
  );
  if (nonTransferableCapability !== undefined) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: nonTransferableCapability.capabilityKey,
          detail: `non-transferable-platform-capability:${nonTransferableCapability.capabilityKey}`,
        }),
      ],
    };
  }

  const useResult = checkUsePlace({
    state: input.state,
    place: input.sourcePlace,
    operationOriginKey: input.ownerKey,
  });
  if (useResult.kind === "error") {
    if (isPartiallyMovedAggregate(input.state, sourcePlaceKey)) {
      return {
        kind: "error",
        diagnostics: [
          crossCoreEligibilityDiagnostic({
            ownerKey: input.ownerKey,
            rootCauseKey: rootKey,
            detail: `partially-moved:${rootKey}`,
          }),
        ],
      };
    }
    return useResult;
  }

  if (isPartiallyMovedAggregate(input.state, sourcePlaceKey)) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreEligibilityDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: rootKey,
          detail: `partially-moved:${rootKey}`,
        }),
      ],
    };
  }

  return { kind: "ok" };
}

function buildCrossCoreOwnershipRequest(input: {
  readonly sourcePlaceKey: string;
  readonly destinationCoreKey: string;
  readonly capabilityKind: ProofCapabilityKindId;
  readonly orderingFactKey: string;
}): ProofSemanticsJudgmentRequest {
  const requestKey = `request:cross-core:${input.sourcePlaceKey}:${input.destinationCoreKey}`;
  const judgmentInput: ProofCrossCoreOwnershipJudgmentInput = {
    requestKey,
    sourcePlaceKey: input.sourcePlaceKey,
    destinationCoreKey: input.destinationCoreKey,
    capabilityKind: input.capabilityKind,
    orderingFactKey: input.orderingFactKey,
  };
  return { kind: "crossCoreOwnership", input: judgmentInput };
}

function remapCompanionDiagnostics(input: {
  readonly diagnostics: readonly ProofCheckDiagnostic[];
  readonly ownerKey: string;
}): readonly ProofCheckDiagnostic[] {
  return sortProofCheckDiagnostics(
    input.diagnostics.map((diagnostic) => {
      if (diagnostic.code === "PROOF_CHECK_MISSING_COMPANION_JUDGMENT") {
        return crossCoreCertificateMissingDiagnostic({
          ownerKey: input.ownerKey,
          rootCauseKey: input.ownerKey,
          detail: diagnostic.stableDetail,
        });
      }
      return proofCheckDiagnostic({
        ...diagnostic,
        ownerKey: input.ownerKey,
        rootCauseKey: input.ownerKey,
      });
    }),
  );
}

function applyCompanionPatch(input: {
  readonly state: ProofCheckState;
  readonly patch: ProofCheckStatePatch<ProofCheckPatchKind>;
  readonly transitionId: ProofCheckTransitionId;
  readonly ownerKey: string;
}):
  | {
      readonly kind: "ok";
      readonly state: ProofCheckState;
      readonly patches: ProofCheckStatePatchEntry[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] } {
  const reduction = reduceProofCheckState(
    input.state,
    proofCheckStatePatchWithTransitionId(input.patch, input.transitionId),
  );
  if (reduction.kind === "error") {
    return {
      kind: "error",
      diagnostics: invalidStatePatchDiagnostics(reduction.diagnostics, input.ownerKey),
    };
  }
  return {
    kind: "ok",
    state: reduction.state,
    patches: [...input.patch.entries],
  };
}

function buildCapabilityFlowPacketEntry(input: {
  readonly capabilityKey: string;
  readonly capabilityKind: ProofCapabilityKindId;
  readonly operationOriginKey: string;
  readonly dependencyPlaceKeys: readonly string[];
  readonly placeResolver?: ProofCheckPlaceResolver;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const subjectPlaceId = proofMirPlaceIdForPlaceKey(input.capabilityKey, input.placeResolver);
  const subjectKey = `transfer:${input.capabilityKey}:${input.capabilityKind}`;
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`capabilityFlow:${subjectKey}`)),
    kind: checkedFactKindId("capabilityFlow"),
    subject: { kind: "place", placeId: subjectPlaceId },
    scope: defaultScope(),
    dependencies: [],
    invalidatedBy: [{ kind: "placeConsume", placeId: subjectPlaceId }],
    certificate: certificateForSubject(subjectKey),
    origin: originForCrossCoreFact(input.operationOriginKey),
  };
}

function buildCrossCoreOrderingPacketEntry(input: {
  readonly sourcePlaceKey: string;
  readonly destinationCoreKey: string;
  readonly orderingFactKey: string;
  readonly operationOriginKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const subjectPlaceId = proofMirPlaceIdForPlaceKey(input.sourcePlaceKey, input.placeResolver);
  const subjectKey = `cross-core-ordering:${input.sourcePlaceKey}:${input.destinationCoreKey}:${input.orderingFactKey}`;
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`crossCoreOrdering:${subjectKey}`)),
    kind: checkedFactKindId("platformEffect"),
    subject: { kind: "place", placeId: subjectPlaceId },
    scope: defaultScope(),
    dependencies: [],
    invalidatedBy: [
      {
        kind: "platformEffect",
        effectKind: platformEffectKindId("crossCoreOrdering"),
        subject: { kind: "place", placeId: subjectPlaceId },
      },
    ],
    certificate: certificateForSubject(subjectKey),
    origin: originForCrossCoreFact(input.operationOriginKey),
  };
}

function patchIncludesCapabilityTransfer(
  patch: ProofCheckStatePatch<ProofCheckPatchKind>,
  sourcePlaceKey: string,
): boolean {
  return patch.entries.some(
    (entry) =>
      entry.kind === "capability" &&
      entry.action === "transfer" &&
      entry.capability.capabilityKey === sourcePlaceKey,
  );
}

function patchIncludesOrderingFact(
  patch: ProofCheckStatePatch<ProofCheckPatchKind>,
  orderingFactKey: string,
): boolean {
  return patch.entries.some(
    (entry) =>
      entry.kind === "fact" && entry.action === "add" && entry.fact.factKey === orderingFactKey,
  );
}

function patchIncludesSourcePlaceTransfer(
  patch: ProofCheckStatePatch<ProofCheckPatchKind>,
  sourcePlaceKey: string,
): boolean {
  return patch.entries.some(
    (entry) => entry.kind === "placeState" && entry.state.placeKey === sourcePlaceKey,
  );
}

export function checkCrossCoreOwnershipTransfer(
  input: CrossCoreOwnershipTransferInput,
): CrossCoreOwnershipTransferResult {
  const sourcePlaceKey = input.sourcePlace.placeKey;
  const ownerKey = defaultOwnerKey(input.operationOriginKey, sourcePlaceKey);
  const orderingFactKey =
    input.orderingFactKey ?? `ordering:${sourcePlaceKey}->${input.destinationCoreKey}`;

  const eligibility = validateCrossCoreTransferEligibility({
    state: input.state,
    sourcePlace: input.sourcePlace,
    catalog: input.catalog,
    capabilityKind: input.capabilityKind,
    ownerKey,
  });
  if (eligibility.kind === "error") {
    return eligibility;
  }

  const dependencyKeys = input.dependencyKeys ?? new Set<string>();
  const request = buildCrossCoreOwnershipRequest({
    sourcePlaceKey,
    destinationCoreKey: input.destinationCoreKey,
    capabilityKind: input.capabilityKind,
    orderingFactKey,
  });

  const validation = validateProofSemanticsJudgmentResult({
    companion: input.companion,
    request,
    dependencyKeys,
  });
  if (validation.kind === "error") {
    return {
      kind: "error",
      diagnostics: remapCompanionDiagnostics({
        diagnostics: validation.diagnostics,
        ownerKey,
      }),
    };
  }
  if (validation.result.kind !== "crossCoreOwnership") {
    return {
      kind: "error",
      diagnostics: [
        crossCoreCertificateMissingDiagnostic({
          ownerKey,
          rootCauseKey: ownerKey,
          detail: "missing-judgment:crossCoreOwnership",
        }),
      ],
    };
  }

  const patch = validation.result.patch as ProofCheckStatePatch<"crossCoreOwnership">;
  if (
    !patchIncludesSourcePlaceTransfer(patch, sourcePlaceKey) &&
    !patchIncludesCapabilityTransfer(patch, sourcePlaceKey)
  ) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreCertificateMissingDiagnostic({
          ownerKey,
          rootCauseKey: sourcePlaceKey,
          detail: `companion-patch-missing-source-transfer:${sourcePlaceKey}`,
        }),
      ],
    };
  }
  if (!patchIncludesOrderingFact(patch, orderingFactKey)) {
    return {
      kind: "error",
      diagnostics: [
        crossCoreCertificateMissingDiagnostic({
          ownerKey,
          rootCauseKey: orderingFactKey,
          detail: `companion-patch-missing-ordering-fact:${orderingFactKey}`,
        }),
      ],
    };
  }

  const applied = applyCompanionPatch({
    state: input.state,
    patch,
    transitionId: input.transitionId,
    ownerKey,
  });
  if (applied.kind === "error") {
    return applied;
  }

  const certificates: ProofCheckCertificateId[] = [
    {
      kind: "semantics" as const,
      id: validation.result.certificateId,
    },
    certificateForSubject(`${sourcePlaceKey}:${input.destinationCoreKey}:${orderingFactKey}`),
  ].sort((left, right) => compareCodeUnitStrings(String(left.id), String(right.id)));

  const packetEntries = [
    buildCapabilityFlowPacketEntry({
      capabilityKey: sourcePlaceKey,
      capabilityKind: input.capabilityKind,
      operationOriginKey: ownerKey,
      dependencyPlaceKeys: [sourcePlaceKey, input.destinationCoreKey],
      placeResolver: input.placeResolver,
    }),
    buildCrossCoreOrderingPacketEntry({
      sourcePlaceKey,
      destinationCoreKey: input.destinationCoreKey,
      orderingFactKey,
      operationOriginKey: ownerKey,
      placeResolver: input.placeResolver,
    }),
  ].sort((left, right) => {
    const kindCmp = compareCodeUnitStrings(left.kind, right.kind);
    if (kindCmp !== 0) {
      return kindCmp;
    }
    return compareCodeUnitStrings(String(left.factId), String(right.factId));
  });

  return {
    kind: "ok",
    patches: applied.patches,
    certificates,
    packetEntries,
  };
}

export function crossCoreOwnershipOrderingFactKeyForTest(input: {
  readonly sourcePlaceKey: string;
  readonly destinationCoreKey: string;
}): string {
  return `ordering:${input.sourcePlaceKey}->${input.destinationCoreKey}`;
}
