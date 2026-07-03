import { stableNumericSeed } from "../../../src/proof-check/stable-numeric-seed";
import type { ProofCheckPlaceResolver } from "../../../src/proof-check/kernel/registry/transition-helpers";
import { proofMirPlaceId } from "../../../src/proof-mir/ids";
import {
  proofCheckDiagnostic,
  proofCheckDiagnosticCode,
  type ProofCheckDiagnostic,
  type ProofCheckStateSnapshot,
} from "../../../src/proof-check/diagnostics";
import { proofCheckStateSnapshot } from "../../../src/proof-check/kernel/state-key";
import {
  createProofCheckState,
  type CheckedActiveFact,
  type CheckedCapabilityState,
  type CheckedLoanState,
  type CheckedObligationState,
  type CheckedPacketSourceFact,
  type CheckedPlaceState,
  type CheckedPrivateStateFact,
  type CheckedSessionState,
  type ProofCheckPrivatePredicateRequirement,
  type ProofCheckState,
  type ProofCheckStateInput,
  type ProofCheckStreamMember,
  type ProofCheckStructuredPlace,
} from "../../../src/proof-check/kernel/state";

export function testPlaceIdForKey(placeKey: string): ReturnType<typeof proofMirPlaceId> {
  if (placeKey.startsWith("proofMirPlace:")) {
    const suffix = placeKey.slice("proofMirPlace:".length);
    const separatorIndex = suffix.search(/[.:]/);
    const numericSuffix = separatorIndex >= 0 ? suffix.slice(0, separatorIndex) : suffix;
    return proofMirPlaceId(Number(numericSuffix));
  }
  return proofMirPlaceId(stableNumericSeed(`test-place:${placeKey}`));
}

export function testPlaceResolverForKeys(placeKeys: readonly string[]): ProofCheckPlaceResolver {
  const index = new Map<string, ReturnType<typeof proofMirPlaceId>>();
  const canonicalPlaceKeyByPlaceKey = new Map<string, string>();
  for (const placeKey of placeKeys) {
    index.set(placeKey, testPlaceIdForKey(placeKey));
    canonicalPlaceKeyByPlaceKey.set(placeKey, placeKey);
  }
  return {
    index,
    placeShapeKeyByPlaceId: new Map<string, string>(),
    equivalentPlaceKeysByPlaceId: new Map<string, readonly string[]>(),
    canonicalPlaceKeyByPlaceKey,
  };
}

export function testPlaceResolverForState(
  state: ProofCheckState,
  extraPlaceKeys: readonly string[] = [],
): ProofCheckPlaceResolver {
  const placeKeys = new Set<string>([
    ...state.places.keys(),
    ...[...state.loans.values()].map((loan) => loan.placeKey),
    ...state.privateState.keys(),
    ...extraPlaceKeys,
  ]);
  return testPlaceResolverForKeys([...placeKeys]);
}

export function withTestPlaceResolver<
  Input extends {
    readonly state: ProofCheckState;
    readonly placeResolver?: ProofCheckPlaceResolver;
  },
>(
  input: Input,
  extraPlaceKeys: readonly string[] = [],
): Input & { readonly placeResolver: ProofCheckPlaceResolver } {
  return {
    ...input,
    placeResolver: input.placeResolver ?? testPlaceResolverForState(input.state, extraPlaceKeys),
  };
}

export function activeFactForTest(factKey: string): CheckedActiveFact {
  return {
    factKey,
    termKey: factKey,
  };
}

export function ownedPlaceForTest(placeKey: string): CheckedPlaceState {
  return {
    placeKey,
    lifecycle: "owned",
  };
}

export function movedPlaceForTest(placeKey: string): CheckedPlaceState {
  return {
    placeKey,
    lifecycle: "moved",
  };
}

export function consumedPlaceForTest(placeKey: string): CheckedPlaceState {
  return {
    placeKey,
    lifecycle: "consumed",
  };
}

export function uninitializedPlaceForTest(placeKey: string): CheckedPlaceState {
  return {
    placeKey,
    lifecycle: "uninitialized",
  };
}

export function proofCheckPlaceForTest(placeKey: string): ProofCheckStructuredPlace {
  return { placeKey };
}

export function exclusiveLoanForTest(placeKey: string): CheckedLoanState {
  return {
    loanKey: `loan:${placeKey}`,
    mode: "exclusive",
    placeKey,
  };
}

export function capabilityStateForTest(capabilityKey: string): CheckedCapabilityState {
  return {
    capabilityKey,
    capabilityKind: capabilityKey,
  };
}

export function obligationStateForTest(obligationKey: string): CheckedObligationState {
  return {
    obligationKey,
    status: "open",
  };
}

export function streamSessionForTest(sessionKey: string): CheckedSessionState {
  return { sessionKey };
}

export function streamMemberObligationForTest(
  memberKey: string,
  sessionKey: string,
): CheckedObligationState {
  return {
    obligationKey: memberKey,
    status: "open",
    sessionKey,
    memberKey,
  };
}

export function streamMemberForTest(memberKey: string, sessionKey: string): ProofCheckStreamMember {
  return { memberKey, sessionKey };
}

export function privateGenerationForTest(
  placeKey: string,
  generationKey: string,
): CheckedPrivateStateFact {
  return {
    placeKey,
    generationKey,
  };
}

export function privatePredicateFactForTest(
  predicateKey: string,
  generationKey: string,
): CheckedActiveFact {
  return {
    factKey: predicateKey,
    termKey: `${predicateKey}@${generationKey}`,
  };
}

export function privatePredicateRequirementForTest(
  predicateKey: string,
  generation: "current" | string,
): ProofCheckPrivatePredicateRequirement {
  return {
    predicateKey,
    generation,
  };
}

export function packetSourceForTest(packetKey: string, sourceKey: string): CheckedPacketSourceFact {
  return {
    packetKey,
    sourceKey,
  };
}

export function proofCheckStateForTest(input: ProofCheckStateInput = {}): ProofCheckState {
  return createProofCheckState(input);
}

export function proofCheckStateSnapshotForTest(
  state: ProofCheckState = proofCheckStateForTest(),
): ProofCheckStateSnapshot {
  return proofCheckStateSnapshot(state);
}

export function proofCheckDiagnosticForTest(code: string): ProofCheckDiagnostic {
  const validatedCode = proofCheckDiagnosticCode(code);
  return proofCheckDiagnostic({
    severity: "error",
    code,
    messageTemplateId: "test.template",
    messageArguments: [{ kind: "text", value: validatedCode }],
    message: validatedCode,
    ownerKey: "test:owner",
    rootCauseKey: "test:root-cause",
    stableDetail: validatedCode,
  });
}
