import { stableNumericSeed } from "../stable-numeric-seed";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofMirOriginId } from "../../proof-mir/ids";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";
import { proofCheckCoreCertificateId, proofCheckPacketFactId } from "../ids";
import type { ProofCheckCertificateId } from "../model/certificates";
import type { ProofCheckCoreCertificate } from "../model/certificates";
import {
  checkedFactKindId,
  type CheckedFactDependency,
  type CheckedFactInvalidation,
  type CheckedFactKindId,
  type CheckedFactPacketEntry,
  type CheckedFactScope,
  type CheckedFactSubject,
  type CheckedOriginFact,
} from "../model/fact-packet";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import {
  type CheckedActiveFact,
  type CheckedPlaceLifecycle,
  type CheckedPlaceState,
  type ProofCheckState,
  type ProofCheckStructuredPlace,
} from "../kernel/state";
import { findLoanConflict } from "./loans";
import {
  type ProofCheckPlaceResolver,
  placeStateForKey,
  proofMirPlaceIdForPlaceKey,
  tryResolveProofMirPlaceDependency,
} from "../kernel/registry/transition-helpers";
import type { ProofMirValueId } from "../../proof-mir/ids";
import type { ProofMirFunction } from "../../proof-mir/model/graph";
import {
  compareProofCheckPlaces,
  parseProofCheckStructuredPlacePath,
  type ProofCheckConcreteResourceKind,
  type ProofCheckPlaceRelation,
} from "./ownership-place-model";
import {
  hiddenOwnedResourcePlaceKeys,
  isCopyResourceKind,
} from "./ownership-hidden-place-analysis";

export type ProofCheckOwnershipTransferResult =
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

export interface ProofCheckPlaceOperationInput {
  readonly state: ProofCheckState;
  readonly place: ProofCheckStructuredPlace;
  readonly operationOriginKey?: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface ProofCheckMoveTransferInput {
  readonly state: ProofCheckState;
  readonly source: ProofCheckStructuredPlace;
  readonly destination: ProofCheckStructuredPlace;
  readonly operationOriginKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface ProofCheckConsumeTransferInput {
  readonly state: ProofCheckState;
  readonly place: ProofCheckStructuredPlace;
  readonly resourceKind: ProofCheckConcreteResourceKind;
  readonly operationOriginKey: string;
  readonly replacementFacts?: readonly CheckedActiveFact[];
  readonly placeResolver?: ProofCheckPlaceResolver;
  readonly functionGraph?: ProofMirFunction;
}

export interface ProofCheckObserveTransferInput {
  readonly state: ProofCheckState;
  readonly place: ProofCheckStructuredPlace;
  readonly resourceKind: ProofCheckConcreteResourceKind;
  readonly operationOriginKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
  readonly functionGraph?: ProofMirFunction;
}

export interface ProofCheckAssignTransferInput {
  readonly state: ProofCheckState;
  readonly source: ProofCheckStructuredPlace;
  readonly destination: ProofCheckStructuredPlace;
  readonly resourceKind: ProofCheckConcreteResourceKind;
  readonly operationOriginKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}

export interface ProofCheckSummaryPlaceEffectInput {
  readonly state: ProofCheckState;
  readonly place: ProofCheckStructuredPlace;
  readonly resourceKind: ProofCheckConcreteResourceKind;
  readonly mode: "observe" | "consume";
  readonly operationOriginKey: string;
  readonly replacementFacts?: readonly CheckedActiveFact[];
  readonly placeResolver?: ProofCheckPlaceResolver;
}

const INVALID_USE_LIFECYCLES: readonly CheckedPlaceLifecycle[] = [
  "moved",
  "consumed",
  "uninitialized",
  "proofOnlyErased",
];

function structuredPlace(placeKey: string): ProofCheckStructuredPlace {
  return { placeKey };
}

function defaultScope(): CheckedFactScope {
  return { kind: "wholeImage" };
}

function originForOwnershipFact(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

function ownershipTransferCertificate(subjectKey: string): ProofCheckCoreCertificate {
  return {
    certificateId: proofCheckCoreCertificateId(stableNumericSeed(`cert:${subjectKey}`)),
    rule: "ownershipTransfer",
    subjectKey,
    dependencyKeys: [],
  };
}

function certificateForSubject(subjectKey: string): ProofCheckCertificateId {
  return {
    kind: "core",
    id: ownershipTransferCertificate(subjectKey).certificateId,
  };
}

function placeStatePatch(
  placeKey: string,
  lifecycle: CheckedPlaceLifecycle,
  placeResolver?: ProofCheckPlaceResolver,
): ProofCheckStatePatchEntry {
  return {
    kind: "placeState",
    place: proofMirPlaceIdForPlaceKey(placeKey, placeResolver),
    state: { placeKey, lifecycle },
  };
}

function factKeyReferencesPlace(factKey: string, placeKey: string): boolean {
  return factKey === `place:${placeKey}` || factKey.startsWith(`place:${placeKey}:`);
}

function factsForPlace(state: ProofCheckState, placeKey: string): readonly CheckedActiveFact[] {
  return [...state.facts.values()]
    .filter((fact) => factKeyReferencesPlace(fact.factKey, placeKey))
    .sort((left, right) => compareCodeUnitStrings(left.factKey, right.factKey));
}

function renamedFactForPlace(
  fact: CheckedActiveFact,
  sourcePlaceKey: string,
  destinationPlaceKey: string,
): CheckedActiveFact {
  const prefix = `place:${sourcePlaceKey}`;
  const nextPrefix = `place:${destinationPlaceKey}`;
  if (fact.factKey === prefix) {
    return { factKey: nextPrefix, termKey: nextPrefix };
  }
  if (fact.factKey.startsWith(`${prefix}:`)) {
    const suffix = fact.factKey.slice(prefix.length);
    const nextFactKey = `${nextPrefix}${suffix}`;
    return {
      factKey: nextFactKey,
      termKey: fact.termKey.replace(fact.factKey, nextFactKey),
    };
  }
  return fact;
}

function factDropPatch(fact: CheckedActiveFact): ProofCheckStatePatchEntry {
  return {
    kind: "fact",
    action: "drop",
    fact,
  };
}

function factAddPatch(fact: CheckedActiveFact): ProofCheckStatePatchEntry {
  return {
    kind: "fact",
    action: "add",
    fact,
  };
}

function buildOwnershipPacketEntry(input: {
  readonly subjectPlaceKey: string;
  readonly dependencyPlaceKeys: readonly string[];
  readonly dependencyValueIds?: readonly ProofMirValueId[];
  readonly operationOriginKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const subjectPlaceId = proofMirPlaceIdForPlaceKey(input.subjectPlaceKey, input.placeResolver);
  const placeSubjectKey = `place:${String(subjectPlaceId)}`;
  const certificate = certificateForSubject(placeSubjectKey);
  const dependencies: CheckedFactDependency[] = [
    ...input.dependencyPlaceKeys.flatMap((placeKey) => {
      const dependency = tryResolveProofMirPlaceDependency(placeKey, input.placeResolver);
      return dependency === undefined ? [] : [dependency];
    }),
    ...uniqueValueDependencies(input.dependencyValueIds ?? []),
  ];
  if (certificate.kind === "core") {
    dependencies.push({ kind: "coreCertificate", certificateId: certificate.id });
  }
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`ownership:${input.subjectPlaceKey}`)),
    kind: checkedFactKindId("ownership"),
    subject: { kind: "place", placeId: subjectPlaceId },
    scope: defaultScope(),
    dependencies,
    invalidatedBy: [
      { kind: "placeMove", placeId: subjectPlaceId },
      { kind: "placeConsume", placeId: subjectPlaceId },
    ],
    certificate,
    origin: originForOwnershipFact(input.operationOriginKey),
  };
}

function uniqueValueDependencies(
  valueIds: readonly ProofMirValueId[],
): readonly Extract<CheckedFactDependency, { readonly kind: "proofMirValue" }>[] {
  const byKey = new Map<string, ProofMirValueId>();
  for (const valueId of valueIds) {
    byKey.set(String(valueId), valueId);
  }
  return [...byKey.entries()]
    .sort((left, right) => compareCodeUnitStrings(left[0], right[0]))
    .map(([, valueId]) => ({ kind: "proofMirValue", valueId }) as const);
}

function directPlaceLifecycle(
  state: ProofCheckState,
  placeKey: string,
): CheckedPlaceLifecycle | undefined {
  return state.places.get(placeKey)?.lifecycle;
}

function wrapperResourceLeakDiagnostic(input: {
  readonly wrapperPlaceKey: string;
  readonly hiddenPlaceKey: string;
  readonly operationOriginKey: string;
}): ProofCheckDiagnostic {
  const stableDetail = `wrapper:${input.wrapperPlaceKey}:hidden:${input.hiddenPlaceKey}`;
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_WRAPPER_RESOURCE_LEAK",
    messageTemplateId: "ownership.wrapper-resource-leak",
    messageArguments: [
      { kind: "text", value: input.wrapperPlaceKey },
      { kind: "text", value: input.hiddenPlaceKey },
    ],
    message: `Cannot drop wrapper ${input.wrapperPlaceKey} while hidden resource ${input.hiddenPlaceKey} remains live`,
    ownerKey: input.operationOriginKey,
    rootCauseKey: input.hiddenPlaceKey,
    stableDetail,
  });
}

function checkWrapperResourceLeakBeforeDrop(input: {
  readonly state: ProofCheckState;
  readonly place: ProofCheckStructuredPlace;
  readonly operationOriginKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
  readonly functionGraph?: ProofMirFunction;
}): ProofCheckOwnershipTransferResult | undefined {
  const hiddenPlaces = hiddenOwnedResourcePlaceKeys({
    state: input.state,
    place: input.place,
    placeResolver: input.placeResolver,
    functionGraph: input.functionGraph,
  });

  if (hiddenPlaces.length === 0) {
    return undefined;
  }

  const hiddenPlaceKey = hiddenPlaces[0];
  if (hiddenPlaceKey === undefined) {
    return undefined;
  }

  return {
    kind: "error",
    diagnostics: [
      wrapperResourceLeakDiagnostic({
        wrapperPlaceKey: input.place.placeKey,
        hiddenPlaceKey,
        operationOriginKey: input.operationOriginKey,
      }),
    ],
  };
}

function findRelatedPlaceConflict(input: {
  readonly state: ProofCheckState;
  readonly place: ProofCheckStructuredPlace;
  readonly relationKind: ProofCheckPlaceRelation["kind"];
}): CheckedPlaceState | undefined {
  const sortedPlaces = [...input.state.places.values()].sort((left, right) =>
    compareCodeUnitStrings(left.placeKey, right.placeKey),
  );
  for (const placeState of sortedPlaces) {
    if (!INVALID_USE_LIFECYCLES.includes(placeState.lifecycle)) {
      continue;
    }
    const relation = compareProofCheckPlaces(input.place, structuredPlace(placeState.placeKey));
    if (relation.kind === input.relationKind) {
      return placeState;
    }
  }
  return undefined;
}

function useAfterMoveDiagnostic(input: {
  readonly place: ProofCheckStructuredPlace;
  readonly operationOriginKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_USE_AFTER_MOVE",
    messageTemplateId: "ownership.use-after-move",
    messageArguments: [{ kind: "text", value: input.place.placeKey }],
    message: `Use after move of ${input.place.placeKey}`,
    ownerKey: input.operationOriginKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function useAfterConsumeDiagnostic(input: {
  readonly place: ProofCheckStructuredPlace;
  readonly operationOriginKey: string;
  readonly rootCauseKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_USE_AFTER_CONSUME",
    messageTemplateId: "ownership.use-after-consume",
    messageArguments: [{ kind: "text", value: input.place.placeKey }],
    message: `Use after consume of ${input.place.placeKey}`,
    ownerKey: input.operationOriginKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.detail,
  });
}

function lifecycleUseDiagnostic(input: {
  readonly place: ProofCheckStructuredPlace;
  readonly lifecycle: CheckedPlaceLifecycle;
  readonly operationOriginKey: string;
}): ProofCheckDiagnostic {
  const detail = `use:${input.place.placeKey}:lifecycle:${input.lifecycle}`;
  if (input.lifecycle === "consumed") {
    return useAfterConsumeDiagnostic({
      place: input.place,
      operationOriginKey: input.operationOriginKey,
      rootCauseKey: input.place.placeKey,
      detail,
    });
  }
  return useAfterMoveDiagnostic({
    place: input.place,
    operationOriginKey: input.operationOriginKey,
    rootCauseKey: input.place.placeKey,
    detail,
  });
}

function loanConflictDiagnostic(input: {
  readonly place: ProofCheckStructuredPlace;
  readonly loanKey: string;
  readonly operationOriginKey: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_CONFLICTING_LOAN",
    messageTemplateId: "ownership.conflicting-loan",
    messageArguments: [
      { kind: "text", value: input.place.placeKey },
      { kind: "text", value: input.loanKey },
    ],
    message: `Conflicting loan while using ${input.place.placeKey} with ${input.loanKey}`,
    ownerKey: input.operationOriginKey,
    rootCauseKey: input.loanKey,
    stableDetail: `operation:use:place:${input.place.placeKey}:loan:${input.loanKey}`,
  });
}

export function checkUsePlace(
  input: ProofCheckPlaceOperationInput,
): ProofCheckOwnershipTransferResult {
  const operationOriginKey = input.operationOriginKey ?? "operation:use";
  const placeState = placeStateForKey(input.state, input.place.placeKey, input.placeResolver);
  const directLifecycle = placeState?.lifecycle;

  if (directLifecycle === undefined || directLifecycle !== "owned") {
    const lifecycle = directLifecycle ?? "uninitialized";
    return {
      kind: "error",
      diagnostics: [
        lifecycleUseDiagnostic({
          place: input.place,
          lifecycle,
          operationOriginKey,
        }),
      ],
    };
  }

  const movedDescendant = findRelatedPlaceConflict({
    state: input.state,
    place: input.place,
    relationKind: "ancestor",
  });
  if (movedDescendant !== undefined) {
    return {
      kind: "error",
      diagnostics: [
        lifecycleUseDiagnostic({
          place: input.place,
          lifecycle: movedDescendant.lifecycle,
          operationOriginKey,
        }),
      ],
    };
  }

  const movedAncestor = findRelatedPlaceConflict({
    state: input.state,
    place: input.place,
    relationKind: "descendant",
  });
  if (movedAncestor !== undefined) {
    return {
      kind: "error",
      diagnostics: [
        lifecycleUseDiagnostic({
          place: input.place,
          lifecycle: movedAncestor.lifecycle,
          operationOriginKey,
        }),
      ],
    };
  }

  const loanConflict = findLoanConflict({
    state: input.state,
    place: input.place,
    operation: { kind: "observe" },
  });
  if (loanConflict !== undefined) {
    return {
      kind: "error",
      diagnostics: [
        loanConflictDiagnostic({
          place: input.place,
          loanKey: loanConflict.loanKey,
          operationOriginKey,
        }),
      ],
    };
  }

  return {
    kind: "ok",
    patches: [],
    certificates: [],
    packetEntries: [],
  };
}

function requiresConsumeOnTransfer(kind: ProofCheckConcreteResourceKind): boolean {
  switch (kind) {
    case "Copy":
    case "Never":
      return false;
    case "Affine":
    case "Linear":
    case "UniqueEdgeRoot":
    case "EdgePath":
    case "Stream":
    case "ValidatedBuffer":
    case "PrivateState":
    case "SealedPlatformToken":
      return true;
  }
}

function aggregateUnavailablePatchIfNeeded(input: {
  readonly state: ProofCheckState;
  readonly source: ProofCheckStructuredPlace;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): ProofCheckStatePatchEntry | undefined {
  const sourcePath = parseProofCheckStructuredPlacePath(input.source);
  if (sourcePath.projections.length === 0) {
    return undefined;
  }
  const aggregateKey = sourcePath.rootKey;
  const aggregateLifecycle = directPlaceLifecycle(input.state, aggregateKey);
  if (aggregateLifecycle !== "owned") {
    return undefined;
  }
  return placeStatePatch(aggregateKey, "moved", input.placeResolver);
}

function moveFactTransferPatches(input: {
  readonly state: ProofCheckState;
  readonly sourcePlaceKey: string;
  readonly destinationPlaceKey: string;
}): ProofCheckStatePatchEntry[] {
  const patches: ProofCheckStatePatchEntry[] = [];
  for (const fact of factsForPlace(input.state, input.sourcePlaceKey)) {
    patches.push(factDropPatch(fact));
    patches.push(
      factAddPatch(renamedFactForPlace(fact, input.sourcePlaceKey, input.destinationPlaceKey)),
    );
  }
  return patches;
}

export function transferMovePlace(
  input: ProofCheckMoveTransferInput,
): ProofCheckOwnershipTransferResult {
  const useResult = checkUsePlace({
    state: input.state,
    place: input.source,
    operationOriginKey: input.operationOriginKey,
  });
  if (useResult.kind === "error") {
    return useResult;
  }

  const subjectKey = `${input.source.placeKey}->${input.destination.placeKey}`;
  const patches: ProofCheckStatePatchEntry[] = [
    placeStatePatch(input.source.placeKey, "moved", input.placeResolver),
  ];
  const aggregatePatch = aggregateUnavailablePatchIfNeeded({
    state: input.state,
    source: input.source,
    placeResolver: input.placeResolver,
  });
  if (aggregatePatch !== undefined) {
    patches.push(aggregatePatch);
  }
  patches.push(placeStatePatch(input.destination.placeKey, "owned", input.placeResolver));
  patches.push(
    ...moveFactTransferPatches({
      state: input.state,
      sourcePlaceKey: input.source.placeKey,
      destinationPlaceKey: input.destination.placeKey,
    }),
  );

  const certificate = certificateForSubject(subjectKey);
  return {
    kind: "ok",
    patches,
    certificates: [certificate],
    packetEntries: [
      buildOwnershipPacketEntry({
        subjectPlaceKey: input.destination.placeKey,
        dependencyPlaceKeys: [input.source.placeKey, input.destination.placeKey],
        operationOriginKey: input.operationOriginKey,
        placeResolver: input.placeResolver,
      }),
    ],
  };
}

export function observeCopyPlace(
  input: ProofCheckObserveTransferInput,
): ProofCheckOwnershipTransferResult {
  const wrapperLeak = checkWrapperResourceLeakBeforeDrop(input);
  if (wrapperLeak !== undefined) {
    return wrapperLeak;
  }

  if (!isCopyResourceKind(input.resourceKind)) {
    return {
      kind: "error",
      diagnostics: [
        proofCheckDiagnostic({
          severity: "error",
          code: "PROOF_CHECK_USE_AFTER_MOVE",
          messageTemplateId: "ownership.observe-non-copy",
          messageArguments: [{ kind: "text", value: input.place.placeKey }],
          message: `Copy observation requires a copy resource at ${input.place.placeKey}`,
          ownerKey: input.operationOriginKey,
          rootCauseKey: input.place.placeKey,
          stableDetail: `observe:non-copy:${input.place.placeKey}:${input.resourceKind}`,
        }),
      ],
    };
  }

  return checkUsePlace({
    state: input.state,
    place: input.place,
    operationOriginKey: input.operationOriginKey,
    placeResolver: input.placeResolver,
  });
}

export function transferConsumePlace(
  input: ProofCheckConsumeTransferInput,
): ProofCheckOwnershipTransferResult {
  if (!requiresConsumeOnTransfer(input.resourceKind)) {
    return observeCopyPlace({
      state: input.state,
      place: input.place,
      resourceKind: input.resourceKind,
      operationOriginKey: input.operationOriginKey,
      placeResolver: input.placeResolver,
      functionGraph: input.functionGraph,
    });
  }

  const wrapperLeak = checkWrapperResourceLeakBeforeDrop(input);
  if (wrapperLeak !== undefined) {
    return wrapperLeak;
  }

  const useResult = checkUsePlace({
    state: input.state,
    place: input.place,
    operationOriginKey: input.operationOriginKey,
    placeResolver: input.placeResolver,
  });
  if (useResult.kind === "error") {
    return useResult;
  }

  const consumeConflict = findLoanConflict({
    state: input.state,
    place: input.place,
    operation: { kind: "consume" },
  });
  if (consumeConflict !== undefined) {
    return {
      kind: "error",
      diagnostics: [
        loanConflictDiagnostic({
          place: input.place,
          loanKey: consumeConflict.loanKey,
          operationOriginKey: input.operationOriginKey,
        }),
      ],
    };
  }

  const patches: ProofCheckStatePatchEntry[] = [
    placeStatePatch(input.place.placeKey, "consumed", input.placeResolver),
  ];
  const aggregatePatch = aggregateUnavailablePatchIfNeeded({
    state: input.state,
    source: input.place,
    placeResolver: input.placeResolver,
  });
  if (aggregatePatch !== undefined) {
    patches.push(aggregatePatch);
  }

  for (const fact of factsForPlace(input.state, input.place.placeKey)) {
    patches.push(factDropPatch(fact));
  }
  for (const replacementFact of input.replacementFacts ?? []) {
    patches.push(factAddPatch(replacementFact));
  }

  const subjectKey = `consume:${input.place.placeKey}`;
  return {
    kind: "ok",
    patches,
    certificates: [certificateForSubject(subjectKey)],
    packetEntries: [],
  };
}

export function transferAssignPlace(
  input: ProofCheckAssignTransferInput,
): ProofCheckOwnershipTransferResult {
  if (isCopyResourceKind(input.resourceKind)) {
    const observeResult = observeCopyPlace({
      state: input.state,
      place: input.source,
      resourceKind: input.resourceKind,
      operationOriginKey: input.operationOriginKey,
    });
    if (observeResult.kind === "error") {
      return observeResult;
    }
    return {
      kind: "ok",
      patches: [],
      certificates: [],
      packetEntries: [],
    };
  }

  return transferMovePlace({
    state: input.state,
    source: input.source,
    destination: input.destination,
    operationOriginKey: input.operationOriginKey,
  });
}

export function applySummaryPlaceEffect(
  input: ProofCheckSummaryPlaceEffectInput,
): ProofCheckOwnershipTransferResult {
  if (input.mode === "observe") {
    if (isCopyResourceKind(input.resourceKind)) {
      return observeCopyPlace({
        state: input.state,
        place: input.place,
        resourceKind: input.resourceKind,
        operationOriginKey: input.operationOriginKey,
      });
    }
    return checkUsePlace({
      state: input.state,
      place: input.place,
      operationOriginKey: input.operationOriginKey,
    });
  }

  return transferConsumePlace({
    state: input.state,
    place: input.place,
    resourceKind: input.resourceKind,
    operationOriginKey: input.operationOriginKey,
    replacementFacts: input.replacementFacts,
    placeResolver: input.placeResolver,
  });
}

export function applySummaryMutationEffect(
  input: ProofCheckPlaceOperationInput & {
    readonly operationOriginKey: string;
    readonly invalidates?: readonly CheckedFactInvalidation[];
  },
): ProofCheckOwnershipTransferResult {
  const useResult = checkUsePlace({
    state: input.state,
    place: input.place,
    operationOriginKey: input.operationOriginKey,
    placeResolver: input.placeResolver,
  });
  if (useResult.kind === "error") {
    return useResult;
  }

  const patches: ProofCheckStatePatchEntry[] = [...useResult.patches];
  for (const fact of factsForPlace(input.state, input.place.placeKey)) {
    let shouldDrop = false;
    for (const invalidation of input.invalidates ?? []) {
      if (invalidation.kind === "placeMutation" || invalidation.kind === "placeConsume") {
        shouldDrop = true;
        break;
      }
    }
    if (shouldDrop) {
      patches.push(factDropPatch(fact));
    }
  }

  const subjectKey = `mutate:${input.place.placeKey}`;
  return {
    kind: "ok",
    patches,
    certificates: [certificateForSubject(subjectKey), ...useResult.certificates],
    packetEntries: useResult.packetEntries,
  };
}

export function applySummaryProduceEffect(
  input: ProofCheckPlaceOperationInput & {
    readonly resourceKind: ProofCheckConcreteResourceKind;
    readonly operationOriginKey: string;
    readonly dependencyValueIds?: readonly ProofMirValueId[];
  },
): ProofCheckOwnershipTransferResult {
  const placeKey = input.place.placeKey;
  const patches: ProofCheckStatePatchEntry[] = [
    placeStatePatch(placeKey, "owned", input.placeResolver),
  ];
  const packetEntry = buildOwnershipPacketEntry({
    subjectPlaceKey: placeKey,
    dependencyPlaceKeys: [placeKey],
    dependencyValueIds: input.dependencyValueIds,
    operationOriginKey: input.operationOriginKey,
    placeResolver: input.placeResolver,
  });
  return {
    kind: "ok",
    patches,
    certificates: [],
    packetEntries: [packetEntry],
  };
}
