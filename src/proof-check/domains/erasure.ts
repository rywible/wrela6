import { stableNumericSeed } from "../stable-numeric-seed";
import { monoInstanceId } from "../../mono/ids";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { proofMirOriginId, proofMirValueId } from "../../proof-mir/ids";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import { proofMirPlaceIdForPlaceKey } from "../kernel/registry/transition-helpers";
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
import type { CheckedErasureFact, ProofCheckState } from "../kernel/state";

export type ProofCheckMirRepresentation =
  | { readonly kind: "proofOnly"; readonly reason: string }
  | { readonly kind: "resourceOnly"; readonly resourceKind: string }
  | { readonly kind: "runtime" }
  | { readonly kind: "fact" }
  | { readonly kind: "never" };

export type ProofCheckErasableSubject =
  | {
      readonly kind: "value";
      readonly valueKey: string;
      readonly representation: ProofCheckMirRepresentation;
    }
  | {
      readonly kind: "place";
      readonly placeKey: string;
      readonly representation: ProofCheckMirRepresentation;
    };

export type ProofCheckRuntimeUse =
  | { readonly kind: "branchCondition"; readonly valueKey: string }
  | { readonly kind: "switchScrutinee"; readonly valueKey: string }
  | { readonly kind: "panicReason"; readonly valueKey: string }
  | { readonly kind: "callTarget"; readonly valueKey: string }
  | { readonly kind: "callArgument"; readonly valueKey: string; readonly argumentIndex: number }
  | { readonly kind: "argumentOrder"; readonly valueKey: string }
  | { readonly kind: "stackSlot"; readonly valueKey: string }
  | { readonly kind: "memoryAddress"; readonly valueKey: string }
  | { readonly kind: "abi"; readonly valueKey: string }
  | { readonly kind: "runtime"; readonly valueKey: string }
  | { readonly kind: "platform"; readonly valueKey: string }
  | { readonly kind: "layout"; readonly valueKey: string }
  | { readonly kind: "observableTargetBehavior"; readonly valueKey: string };

export interface ProofErasureCertificationInput {
  readonly state: ProofCheckState;
  readonly subject: ProofCheckErasableSubject;
  readonly runtimeUses: readonly ProofCheckRuntimeUse[];
  readonly operationOriginKey?: string;
  readonly scope?: CheckedFactScope;
  readonly replacementTransitionKeys?: readonly string[];
}

export type ProofErasureCertificationResult =
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

const BLOCKING_RUNTIME_USE_KINDS = [
  "branchCondition",
  "switchScrutinee",
  "panicReason",
  "callTarget",
  "callArgument",
  "argumentOrder",
  "stackSlot",
  "memoryAddress",
  "abi",
  "runtime",
  "platform",
  "layout",
  "observableTargetBehavior",
] as const satisfies readonly ProofCheckRuntimeUse["kind"][];

export function resetProofCheckErasureCertificateIdsForTest(): void {
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
      stableNumericSeed(`erasure:${input.rule}:${input.subjectKey}:${dependencyKeys.join(",")}`),
    ),
    rule: input.rule,
    subjectKey: input.subjectKey,
    dependencyKeys,
  };
}

function proofMirValueIdForValueKey(valueKey: string) {
  return proofMirValueId(stableNumericSeed(`value:${valueKey}`));
}

function defaultScope(scope: CheckedFactScope | undefined): CheckedFactScope {
  return scope ?? { kind: "wholeImage" };
}

function defaultOwnerKey(ownerKey: string | undefined): string {
  return ownerKey ?? "proof-check:erasure";
}

function subjectKey(subject: ProofCheckErasableSubject): string {
  return subject.kind === "value" ? subject.valueKey : subject.placeKey;
}

function subjectMatchesRuntimeUse(
  subject: ProofCheckErasableSubject,
  runtimeUse: ProofCheckRuntimeUse,
): boolean {
  const runtimeValueKey = runtimeUse.valueKey;
  if (subject.kind === "value") {
    return subject.valueKey === runtimeValueKey;
  }
  return subject.placeKey === runtimeValueKey;
}

function isErasableRepresentation(representation: ProofCheckMirRepresentation): boolean {
  return representation.kind === "proofOnly" || representation.kind === "resourceOnly";
}

function invalidErasureDiagnostic(input: {
  readonly subject: ProofCheckErasableSubject;
  readonly operationOriginKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly message: string;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_INVALID_ERASURE",
    messageTemplateId: "erasure.invalid",
    messageArguments: [{ kind: "text", value: subjectKey(input.subject) }],
    message: input.message,
    ownerKey: input.operationOriginKey,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
  });
}

function replacementFactKeysForSubject(state: ProofCheckState, key: string): readonly string[] {
  const keys = [...state.facts.values()]
    .map((fact) => fact.factKey)
    .filter(
      (factKey) =>
        factKey === key ||
        factKey === `value:${key}` ||
        factKey === `place:${key}` ||
        factKey.startsWith(`value:${key}:`) ||
        factKey.startsWith(`place:${key}:`),
    );
  return [...keys].sort(compareCodeUnitStrings);
}

function stateKeyReferencesSubject(stateKey: string, subjectKey: string): boolean {
  return (
    stateKey === subjectKey ||
    stateKey.startsWith(`${subjectKey}.`) ||
    stateKey.startsWith(`${subjectKey}:`)
  );
}

function collectLiveResourceViolations(state: ProofCheckState, key: string): readonly string[] {
  const violations: string[] = [];

  const place = state.places.get(key);
  if (place !== undefined && (place.lifecycle === "owned" || place.lifecycle === "moved")) {
    violations.push(`place:${key}:${place.lifecycle}`);
  }

  for (const loan of state.loans.values()) {
    if (loan.placeKey === key || loan.placeKey.startsWith(`${key}.`)) {
      violations.push(`loan:${loan.loanKey}`);
    }
  }

  for (const obligation of state.obligations.values()) {
    if (obligation.status === "open" && stateKeyReferencesSubject(obligation.obligationKey, key)) {
      violations.push(`obligation:${obligation.obligationKey}`);
    }
  }

  for (const validation of state.validations.values()) {
    if (
      (validation.status === "pending" || validation.status === "live") &&
      stateKeyReferencesSubject(validation.validationKey, key)
    ) {
      violations.push(`validation:${validation.validationKey}`);
    }
  }

  for (const attempt of state.attempts.values()) {
    if (
      (attempt.status === "pending" || attempt.status === "live") &&
      stateKeyReferencesSubject(attempt.attemptKey, key)
    ) {
      violations.push(`attempt:${attempt.attemptKey}`);
    }
  }

  for (const session of state.sessions.values()) {
    if (
      stateKeyReferencesSubject(session.sessionKey, key) ||
      (session.brandKey !== undefined && stateKeyReferencesSubject(session.brandKey, key))
    ) {
      violations.push(`session:${session.sessionKey}`);
    }
  }

  return violations.sort(compareCodeUnitStrings);
}

function packetSubject(subject: ProofCheckErasableSubject): CheckedFactSubject {
  if (subject.kind === "value") {
    return { kind: "value", valueId: proofMirValueIdForValueKey(subject.valueKey) };
  }
  return { kind: "place", placeId: proofMirPlaceIdForPlaceKey(subject.placeKey) };
}

function originForErasureFact(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

function buildErasurePacketEntry(input: {
  readonly subject: ProofCheckErasableSubject;
  readonly certificate: ProofCheckCertificateId;
  readonly coreCertificate: ProofCheckCoreCertificate;
  readonly scope: CheckedFactScope;
  readonly operationOriginKey: string;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const key = subjectKey(input.subject);
  const subject = packetSubject(input.subject);
  const subjectDependency =
    input.subject.kind === "value"
      ? ({ kind: "proofMirValue" as const, valueId: proofMirValueIdForValueKey(key) } as const)
      : ({ kind: "proofMirPlace" as const, placeId: proofMirPlaceIdForPlaceKey(key) } as const);

  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`erasure:${key}`)),
    kind: checkedFactKindId("erasure"),
    subject,
    scope: input.scope,
    dependencies: [
      subjectDependency,
      { kind: "coreCertificate", certificateId: input.coreCertificate.certificateId },
    ],
    invalidatedBy: [{ kind: "cfgRewrite", functionInstanceId: monoInstanceId("1") }],
    certificate: input.certificate,
    origin: originForErasureFact(input.operationOriginKey),
  };
}

function buildErasureStatePatch(key: string): ProofCheckStatePatchEntry {
  const erasure: CheckedErasureFact = {
    erasureKey: `erasure:${key}`,
    subjectKey: key,
  };
  return { kind: "erasure", erasure };
}

export function certifyProofErasure(
  input: ProofErasureCertificationInput,
): ProofErasureCertificationResult {
  const operationOriginKey = defaultOwnerKey(input.operationOriginKey);
  const key = subjectKey(input.subject);

  if (!isErasableRepresentation(input.subject.representation)) {
    return {
      kind: "error",
      diagnostics: [
        invalidErasureDiagnostic({
          subject: input.subject,
          operationOriginKey,
          rootCauseKey: key,
          stableDetail: `erasure:representation:${input.subject.representation.kind}:${key}`,
          message: `Subject ${key} does not have proof-only or resource-only representation`,
        }),
      ],
    };
  }

  const blockingRuntimeUses = input.runtimeUses
    .filter((runtimeUse) => subjectMatchesRuntimeUse(input.subject, runtimeUse))
    .filter((runtimeUse) =>
      BLOCKING_RUNTIME_USE_KINDS.includes(
        runtimeUse.kind as (typeof BLOCKING_RUNTIME_USE_KINDS)[number],
      ),
    )
    .sort((left, right) => compareCodeUnitStrings(left.kind, right.kind));

  if (blockingRuntimeUses.length > 0) {
    const runtimeUse = blockingRuntimeUses[0] as ProofCheckRuntimeUse;
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([
        invalidErasureDiagnostic({
          subject: input.subject,
          operationOriginKey,
          rootCauseKey: key,
          stableDetail: `erasure:runtime-use:${runtimeUse.kind}:${key}`,
          message: `Subject ${key} is used by runtime dependency ${runtimeUse.kind}`,
        }),
      ]),
    };
  }

  const liveResourceViolations = collectLiveResourceViolations(input.state, key);
  if (liveResourceViolations.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([
        invalidErasureDiagnostic({
          subject: input.subject,
          operationOriginKey,
          rootCauseKey: liveResourceViolations[0] ?? key,
          stableDetail: `erasure:live-resource:${liveResourceViolations.join(",")}:${key}`,
          message: `Subject ${key} still has live resources at exit`,
        }),
      ]),
    };
  }

  const replacementFactKeys = replacementFactKeysForSubject(input.state, key);
  const replacementTransitionKeys = [...(input.replacementTransitionKeys ?? [])].sort(
    compareCodeUnitStrings,
  );
  const certificateDependencyKeys = [...replacementFactKeys, ...replacementTransitionKeys].sort(
    compareCodeUnitStrings,
  );

  const coreCertificate = allocateCoreCertificate({
    rule: "erasure",
    subjectKey: key,
    dependencyKeys: certificateDependencyKeys,
  });
  const certificate: ProofCheckCertificateId = {
    kind: "core",
    id: coreCertificate.certificateId,
  };
  const scope = defaultScope(input.scope);

  return {
    kind: "ok",
    patches: [buildErasureStatePatch(key)],
    certificates: [certificate],
    packetEntries: [
      buildErasurePacketEntry({
        subject: input.subject,
        certificate,
        coreCertificate,
        scope,
        operationOriginKey,
      }),
    ],
  };
}

export function proofOnlyValueForTest(valueKey: string): ProofCheckErasableSubject {
  return {
    kind: "value",
    valueKey,
    representation: { kind: "proofOnly", reason: "factToken" },
  };
}

export function resourceOnlyValueForTest(
  valueKey: string,
  resourceKind = "Linear",
): ProofCheckErasableSubject {
  return {
    kind: "value",
    valueKey,
    representation: { kind: "resourceOnly", resourceKind },
  };
}

export function proofOnlyPlaceForTest(placeKey: string): ProofCheckErasableSubject {
  return {
    kind: "place",
    placeKey,
    representation: { kind: "proofOnly", reason: "obligation" },
  };
}
