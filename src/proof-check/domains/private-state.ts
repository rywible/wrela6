import { stableNumericSeed } from "../stable-numeric-seed";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofMirOriginId, proofMirPrivateStateGenerationId } from "../../proof-mir/ids";
import { proofCheckDiagnostic, type ProofCheckDiagnostic } from "../diagnostics";
import {
  proofMirPlaceIdForPlaceKey,
  type ProofCheckPlaceResolver,
} from "../kernel/registry/transition-helpers";
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
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import {
  type CheckedActiveFact,
  type ProofCheckPrivatePredicateRequirement,
  type ProofCheckState,
} from "../kernel/state";

export type PrivatePredicateRequirementResult =
  | { readonly kind: "ok"; readonly certificate: ProofCheckCoreCertificate }
  | { readonly kind: "missing"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type AdvancePrivateStateResult =
  | {
      readonly kind: "ok";
      readonly patches: readonly ProofCheckStatePatchEntry[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
      readonly invalidatedFactKeys: readonly string[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export interface ProvePrivatePredicateRequirementInput {
  readonly state: ProofCheckState;
  readonly requirement: ProofCheckPrivatePredicateRequirement;
  readonly ownerKey?: string;
  readonly advanceTransitionKey?: string;
}

export interface AdvancePrivateStateInput {
  readonly state: ProofCheckState;
  readonly placeKey: string;
  readonly nextGenerationKey: string;
  readonly transitionKey: string;
  readonly operationOriginKey: string;
  readonly programPointScope: CheckedFactScope;
  readonly preservedFactKeys?: readonly string[];
  readonly placeResolver?: ProofCheckPlaceResolver;
}

function resetCoreCertificateIdsForTest(): void {
  // Certificate ids are derived from stable subject-key seeds; no module-local counter to reset.
}

function allocateCoreCertificate(input: {
  readonly rule: ProofCheckCoreCertificate["rule"];
  readonly subjectKey: string;
  readonly dependencyKeys: readonly string[];
}): ProofCheckCoreCertificate {
  const dependencyKeys = [...input.dependencyKeys].sort(compareCodeUnitStrings);
  return {
    certificateId: proofCheckCoreCertificateId(
      stableNumericSeed(
        `private-state:${input.rule}:${input.subjectKey}:${dependencyKeys.join(",")}`,
      ),
    ),
    rule: input.rule,
    subjectKey: input.subjectKey,
    dependencyKeys,
  };
}

function defaultOwnerKey(ownerKey: string | undefined): string {
  return ownerKey ?? "proof-check:private-state";
}

function privateStatePlaceKeyFromPredicate(predicateKey: string): string {
  const separatorIndex = predicateKey.lastIndexOf(".");
  if (separatorIndex === -1) {
    return predicateKey;
  }
  return predicateKey.slice(0, separatorIndex);
}

export function privatePredicateFactGeneration(termKey: string): string | undefined {
  const separatorIndex = termKey.lastIndexOf("@");
  if (separatorIndex === -1) {
    return undefined;
  }
  return termKey.slice(separatorIndex + 1);
}

function currentPrivateGenerationKey(state: ProofCheckState, placeKey: string): string | undefined {
  return state.privateState.get(placeKey)?.generationKey;
}

function resolveRequiredGeneration(
  state: ProofCheckState,
  placeKey: string,
  generation: ProofCheckPrivatePredicateRequirement["generation"],
): string | undefined {
  if (generation === "current") {
    return currentPrivateGenerationKey(state, placeKey);
  }
  return generation;
}

function findPrivatePredicateFact(
  state: ProofCheckState,
  predicateKey: string,
): CheckedActiveFact | undefined {
  const direct = state.facts.get(predicateKey);
  if (direct !== undefined) {
    return direct;
  }
  for (const fact of state.facts.values()) {
    if (fact.factKey === predicateKey) {
      return fact;
    }
  }
  return undefined;
}

function privatePredicateFactMatchesPlace(fact: CheckedActiveFact, placeKey: string): boolean {
  const generation = privatePredicateFactGeneration(fact.termKey);
  if (generation === undefined) {
    return privateStatePlaceKeyFromPredicate(fact.factKey) === placeKey;
  }
  return privateStatePlaceKeyFromPredicate(fact.factKey) === placeKey;
}

function isPrivatePredicateFactActive(input: {
  readonly state: ProofCheckState;
  readonly fact: CheckedActiveFact;
  readonly placeKey: string;
}): boolean {
  const currentGeneration = currentPrivateGenerationKey(input.state, input.placeKey);
  if (currentGeneration === undefined) {
    return false;
  }
  const factGeneration = privatePredicateFactGeneration(input.fact.termKey);
  if (factGeneration === undefined) {
    return true;
  }
  return factGeneration === currentGeneration;
}

function stalePrivatePredicateDiagnostic(input: {
  readonly requirement: ProofCheckPrivatePredicateRequirement;
  readonly fact: CheckedActiveFact;
  readonly placeKey: string;
  readonly requiredGeneration: string;
  readonly currentGeneration: string;
  readonly ownerKey: string;
  readonly advanceTransitionKey?: string;
}): ProofCheckDiagnostic {
  const transitionKey = input.advanceTransitionKey ?? "unknown";
  const stableDetail = [
    "stale-private-predicate",
    input.requirement.predicateKey,
    `fact:${input.fact.factKey}`,
    `fact-generation:${privatePredicateFactGeneration(input.fact.termKey) ?? "none"}`,
    `required-generation:${input.requiredGeneration}`,
    `current-generation:${input.currentGeneration}`,
    `transition:${transitionKey}`,
  ].join(":");
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_STALE_FACT",
    messageTemplateId: "proof-check.private-state.stale-predicate",
    messageArguments: [
      { kind: "text", value: input.requirement.predicateKey },
      { kind: "text", value: transitionKey },
    ],
    message: stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: `stale-private-predicate:${input.requirement.predicateKey}`,
    stableDetail,
  });
}

function missingPrivatePredicateDiagnostic(input: {
  readonly requirement: ProofCheckPrivatePredicateRequirement;
  readonly ownerKey: string;
}): ProofCheckDiagnostic {
  const stableDetail = `missing-private-predicate:${input.requirement.predicateKey}`;
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
    messageTemplateId: "proof-check.private-state.missing-predicate",
    messageArguments: [{ kind: "text", value: input.requirement.predicateKey }],
    message: stableDetail,
    ownerKey: input.ownerKey,
    rootCauseKey: `missing-private-predicate:${input.requirement.predicateKey}`,
    stableDetail,
  });
}

function privateStateAdvanceMismatchDiagnostic(input: {
  readonly placeKey: string;
  readonly transitionKey: string;
  readonly ownerKey: string;
  readonly detail: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_PRIVATE_STATE_ADVANCE_MISMATCH",
    messageTemplateId: "proof-check.private-state.advance-mismatch",
    messageArguments: [
      { kind: "text", value: input.placeKey },
      { kind: "text", value: input.transitionKey },
    ],
    message: input.detail,
    ownerKey: input.ownerKey,
    rootCauseKey: `private-state-advance:${input.placeKey}`,
    stableDetail: input.detail,
  });
}

function defaultCertificate(subjectKey: string): ProofCheckCertificateId {
  return {
    kind: "core",
    id: allocateCoreCertificate({
      rule: "coreEntailment",
      subjectKey,
      dependencyKeys: [],
    }).certificateId,
  };
}

function originForPrivateStateFact(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

function proofMirPrivateStateGenerationIdForKey(generationKey: string) {
  return proofMirPrivateStateGenerationId(stableNumericSeed(`generation:${generationKey}`));
}

function buildPrivateStatePacketEntry(input: {
  readonly placeKey: string;
  readonly generationKey: string;
  readonly programPointScope: CheckedFactScope;
  readonly operationOriginKey: string;
  readonly transitionKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const placeId = proofMirPlaceIdForPlaceKey(input.placeKey, input.placeResolver);
  const generationId = proofMirPrivateStateGenerationIdForKey(input.generationKey);
  const subjectKey = `${input.placeKey}:${input.generationKey}`;
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`privateState:${subjectKey}`)),
    kind: checkedFactKindId("privateState"),
    subject: {
      kind: "privateState",
      placeId,
      generation: generationId,
    },
    scope: input.programPointScope,
    dependencies: [
      { kind: "proofMirPlace", placeId },
      {
        kind: "privateGeneration",
        generation: generationId,
      },
    ],
    invalidatedBy: [{ kind: "privateStateAdvance", placeId }],
    certificate: defaultCertificate(subjectKey),
    origin: originForPrivateStateFact(input.operationOriginKey),
  };
}

function sortedActiveFacts(state: ProofCheckState): readonly CheckedActiveFact[] {
  return [...state.facts.values()].sort((left, right) =>
    compareCodeUnitStrings(left.factKey, right.factKey),
  );
}

export function collectStalePrivatePredicateFacts(input: {
  readonly state: ProofCheckState;
  readonly placeKey: string;
  readonly previousGenerationKey: string;
  readonly preservedFactKeys?: readonly string[];
}): readonly CheckedActiveFact[] {
  const preserved = new Set(input.preservedFactKeys ?? []);
  const staleFacts: CheckedActiveFact[] = [];

  for (const fact of sortedActiveFacts(input.state)) {
    if (!privatePredicateFactMatchesPlace(fact, input.placeKey)) {
      continue;
    }
    const factGeneration = privatePredicateFactGeneration(fact.termKey);
    if (factGeneration === undefined || factGeneration !== input.previousGenerationKey) {
      continue;
    }
    if (preserved.has(fact.factKey)) {
      continue;
    }
    staleFacts.push(fact);
  }

  return staleFacts;
}

export function provePrivatePredicateRequirement(
  input: ProvePrivatePredicateRequirementInput,
): PrivatePredicateRequirementResult {
  const ownerKey = defaultOwnerKey(input.ownerKey);
  const placeKey = privateStatePlaceKeyFromPredicate(input.requirement.predicateKey);
  const requiredGeneration = resolveRequiredGeneration(
    input.state,
    placeKey,
    input.requirement.generation,
  );

  if (requiredGeneration === undefined) {
    return {
      kind: "missing",
      diagnostics: [
        missingPrivatePredicateDiagnostic({
          requirement: input.requirement,
          ownerKey,
        }),
      ],
    };
  }

  const fact = findPrivatePredicateFact(input.state, input.requirement.predicateKey);
  if (fact === undefined) {
    return {
      kind: "missing",
      diagnostics: [
        missingPrivatePredicateDiagnostic({
          requirement: input.requirement,
          ownerKey,
        }),
      ],
    };
  }

  const factGeneration = privatePredicateFactGeneration(fact.termKey);
  const currentGeneration = currentPrivateGenerationKey(input.state, placeKey);
  if (
    currentGeneration !== undefined &&
    factGeneration !== undefined &&
    factGeneration !== currentGeneration
  ) {
    return {
      kind: "missing",
      diagnostics: [
        stalePrivatePredicateDiagnostic({
          requirement: input.requirement,
          fact,
          placeKey,
          requiredGeneration,
          currentGeneration,
          ownerKey,
          advanceTransitionKey: input.advanceTransitionKey,
        }),
      ],
    };
  }

  if (factGeneration !== undefined && factGeneration !== requiredGeneration) {
    return {
      kind: "missing",
      diagnostics: [
        stalePrivatePredicateDiagnostic({
          requirement: input.requirement,
          fact,
          placeKey,
          requiredGeneration,
          currentGeneration: currentGeneration ?? requiredGeneration,
          ownerKey,
          advanceTransitionKey: input.advanceTransitionKey,
        }),
      ],
    };
  }

  if (!isPrivatePredicateFactActive({ state: input.state, fact, placeKey })) {
    return {
      kind: "missing",
      diagnostics: [
        stalePrivatePredicateDiagnostic({
          requirement: input.requirement,
          fact,
          placeKey,
          requiredGeneration,
          currentGeneration: currentGeneration ?? "none",
          ownerKey,
          advanceTransitionKey: input.advanceTransitionKey,
        }),
      ],
    };
  }

  return {
    kind: "ok",
    certificate: allocateCoreCertificate({
      rule: "coreEntailment",
      subjectKey: `${input.requirement.predicateKey}@${requiredGeneration}`,
      dependencyKeys: [fact.factKey],
    }),
  };
}

export function advancePrivateState(input: AdvancePrivateStateInput): AdvancePrivateStateResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey);
  const current = input.state.privateState.get(input.placeKey);
  if (current === undefined) {
    return {
      kind: "error",
      diagnostics: [
        privateStateAdvanceMismatchDiagnostic({
          placeKey: input.placeKey,
          transitionKey: input.transitionKey,
          ownerKey,
          detail: `missing-private-state-place:${input.placeKey}`,
        }),
      ],
    };
  }

  if (current.generationKey === input.nextGenerationKey) {
    return {
      kind: "error",
      diagnostics: [
        privateStateAdvanceMismatchDiagnostic({
          placeKey: input.placeKey,
          transitionKey: input.transitionKey,
          ownerKey,
          detail: `duplicate-private-state-generation:${input.placeKey}:${input.nextGenerationKey}`,
        }),
      ],
    };
  }

  const staleFacts = collectStalePrivatePredicateFacts({
    state: input.state,
    placeKey: input.placeKey,
    previousGenerationKey: current.generationKey,
    preservedFactKeys: input.preservedFactKeys,
  });

  const patches: ProofCheckStatePatchEntry[] = [
    {
      kind: "privateState",
      advance: {
        placeKey: input.placeKey,
        previous: current.generationKey,
        next: input.nextGenerationKey,
        transitionKey: input.transitionKey,
      },
    },
    ...staleFacts.map(
      (fact): ProofCheckStatePatchEntry => ({
        kind: "fact",
        action: "drop",
        fact,
      }),
    ),
  ];

  return {
    kind: "ok",
    patches,
    packetEntries: [
      buildPrivateStatePacketEntry({
        placeKey: input.placeKey,
        generationKey: input.nextGenerationKey,
        programPointScope: input.programPointScope,
        operationOriginKey: input.operationOriginKey,
        transitionKey: input.transitionKey,
        placeResolver: input.placeResolver,
      }),
    ],
    invalidatedFactKeys: staleFacts.map((fact) => fact.factKey),
  };
}

export function resetProofCheckPrivateStateCertificateIdsForTest(): void {
  resetCoreCertificateIdsForTest();
}
