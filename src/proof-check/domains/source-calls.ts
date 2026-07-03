import { stableNumericSeed } from "../stable-numeric-seed";
import type { MonoInstanceId } from "../../mono/ids";
import type { ProofMirCallId } from "../../proof-mir/ids";
import { proofMirOwnedCallId } from "../../proof-mir/ids";
import type { ProofMirCallGraphEdge } from "../../proof-mir/model/calls";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import { checkedSummaryInstantiationCertificateId } from "../ids";
import {
  checkedFunctionSummaryCertificateId,
  type ProofCheckCertificateId,
} from "../model/certificates";
import type {
  CheckedFactInvalidation,
  CheckedFactKindId,
  CheckedFactPacketEntry,
  CheckedFactSubject,
} from "../model/fact-packet";
import {
  normalizeProofCheckTerm,
  proofCheckPlaceBinderFromKey,
  proofCheckPlaceBinderKey,
  type ProofCheckPlaceBinder,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import { substituteProofCheckRequirementTerm } from "../model/fact-environment";
import type {
  CheckedDivergenceFact,
  CheckedFunctionSummary,
  CheckedRequirementFact,
  CheckedSummaryFact,
  CheckedSummaryPlaceEffect,
  ProofCheckConcreteResourceKind,
  ProofCheckValueBinder,
} from "../model/function-summary";
import type { ProofCheckStatePatchEntry } from "../kernel/state-patch";
import { factReferencesPlaceKey } from "./place-key-references";
import type {
  CheckedActiveFact,
  CheckedDivergenceFact as StateDivergenceFact,
  ProofCheckState,
} from "../kernel/state";
import {
  calleeRequirementTermsForSummary,
  returnedFactTermsForSummary,
} from "./mir-source-call-transfer";
import { buildProofCheckFactEnvironment, checkCallRequirementsEntailment } from "./facts";
import {
  applySummaryMutationEffect,
  applySummaryPlaceEffect,
  applySummaryProduceEffect,
} from "./ownership";
import { checkReturnWithLoans } from "./loans";
import { checkCrossedScopeExit } from "./take-sessions";
import type {
  BuildCheckedFunctionSummaryInput,
  BuildCheckedFunctionSummaryResult,
  CheckedFunctionSummaryAcceptanceInput,
  CheckedFunctionSummaryDivergenceInput,
  CheckedFunctionSummaryPlaceEffectInput,
  CheckedSourceCallTransferInput,
  CheckedSourceCallTransferResult,
  CheckedSummaryFactDependency,
  CheckedSummaryFactDependencyKind,
  CheckedSummaryReturnFactCandidate,
  ProofCheckCallSubstitution,
  SourceCallOperandBindings,
} from "./source-call-types";
export type {
  BuildCheckedFunctionSummaryInput,
  BuildCheckedFunctionSummaryResult,
  CheckedFunctionSummaryAcceptanceInput,
  CheckedFunctionSummaryDivergenceInput,
  CheckedFunctionSummaryPlaceEffectInput,
  CheckedSourceCallTransferInput,
  CheckedSourceCallTransferResult,
  CheckedSummaryFactDependency,
  CheckedSummaryFactDependencyKind,
  CheckedSummaryReturnFactCandidate,
  ProofCheckCallSubstitution,
  SourceCallOperandBinding,
  SourceCallOperandBindings,
} from "./source-call-types";

const EXPORTABLE_DEPENDENCY_KINDS = new Set<CheckedSummaryFactDependencyKind>([
  "receiver",
  "parameter",
  "result",
  "producedCapability",
]);

function summaryCertificateIdForFunction(functionInstanceId: MonoInstanceId) {
  return checkedFunctionSummaryCertificateId(
    stableNumericSeed(`summary:function:${String(functionInstanceId)}`),
  );
}

export function resetCheckedFunctionSummaryCertificateIdsForTest(): void {
  // Summary certificate ids are derived from stable function-instance keys.
}

function defaultAcceptance(
  acceptance: CheckedFunctionSummaryAcceptanceInput | undefined,
): Required<CheckedFunctionSummaryAcceptanceInput> {
  return {
    exits: acceptance?.exits ?? true,
    divergence: acceptance?.divergence ?? true,
    terminal: acceptance?.terminal ?? true,
    privateStateEffects: acceptance?.privateStateEffects ?? true,
    packetEntries: acceptance?.packetEntries ?? true,
  };
}

function summaryOwnerKey(functionInstanceId: MonoInstanceId): string {
  return `summary:function:${String(functionInstanceId)}`;
}

function summaryPlaceEffectStableKey(effect: CheckedSummaryPlaceEffect): string {
  switch (effect.kind) {
    case "observes":
      return `observes:${proofCheckPlaceBinderKey(effect.place)}:${effect.borrowMode ?? "none"}`;
    case "consumes":
      return `consumes:${proofCheckPlaceBinderKey(effect.place)}`;
    case "mutates":
      return `mutates:${proofCheckPlaceBinderKey(effect.place)}:${effect.invalidates.length}`;
    case "produces":
      return `produces:${proofCheckPlaceBinderKey(effect.place)}:${effect.resourceKind}`;
    case "returns":
      return `returns:${effect.value.kind}:${effect.resourceKind}`;
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

function normalizeSummaryPlaceEffects(
  effects: readonly CheckedFunctionSummaryPlaceEffectInput[] | undefined,
): readonly CheckedSummaryPlaceEffect[] {
  const normalized: CheckedSummaryPlaceEffect[] = [];
  for (const effect of effects ?? []) {
    switch (effect.kind) {
      case "observes": {
        const place = proofCheckPlaceBinderFromKey(effect.placeKey);
        if (place === undefined) {
          break;
        }
        normalized.push({
          kind: "observes",
          place,
          ...(effect.borrowMode !== undefined ? { borrowMode: effect.borrowMode } : {}),
        });
        break;
      }
      case "consumes": {
        const place = proofCheckPlaceBinderFromKey(effect.placeKey);
        if (place === undefined) {
          break;
        }
        normalized.push({
          kind: "consumes",
          place,
        });
        break;
      }
      case "mutates": {
        const place = proofCheckPlaceBinderFromKey(effect.placeKey);
        if (place === undefined) {
          break;
        }
        normalized.push({
          kind: "mutates",
          place,
          invalidates: [],
        });
        break;
      }
      case "produces": {
        const place = proofCheckPlaceBinderFromKey(effect.placeKey);
        if (place === undefined) {
          break;
        }
        normalized.push({
          kind: "produces",
          place,
          resourceKind: effect.resourceKind ?? "Copy",
        });
        break;
      }
      case "returns":
        normalized.push({
          kind: "returns",
          value: { kind: "resultValue" },
          resourceKind: effect.resourceKind ?? "Copy",
        });
        break;
      default: {
        const unreachable: never = effect.kind;
        return unreachable;
      }
    }
  }
  return [...normalized].sort((left, right) =>
    compareCodeUnitStrings(summaryPlaceEffectStableKey(left), summaryPlaceEffectStableKey(right)),
  );
}

function normalizedRequiredFacts(
  requirements: readonly ProofCheckRequirementTerm[],
): readonly CheckedRequirementFact[] {
  return [...requirements]
    .map((requirement) => {
      const normalized = normalizeProofCheckTerm(requirement, "sourceRequirement");
      return { termKey: normalized.key };
    })
    .sort((left, right) => compareCodeUnitStrings(left.termKey, right.termKey));
}

function factTermKeysForState(state: ProofCheckState): ReadonlySet<string> {
  return new Set([...state.facts.values()].map((fact) => fact.termKey));
}

function intersectFactTermKeysAcrossReturnPaths(
  exitStates: readonly ProofCheckState[],
): ReadonlySet<string> {
  if (exitStates.length === 0) {
    return new Set();
  }
  let intersection = factTermKeysForState(exitStates[0] as ProofCheckState);
  for (const exitState of exitStates.slice(1)) {
    const pathFacts = factTermKeysForState(exitState);
    intersection = new Set([...intersection].filter((termKey) => pathFacts.has(termKey)));
  }
  return intersection;
}

function dependencyIsExportable(dependency: CheckedSummaryFactDependency): boolean {
  return EXPORTABLE_DEPENDENCY_KINDS.has(dependency.kind);
}

function exportableReturnFacts(input: {
  readonly candidates: readonly CheckedSummaryReturnFactCandidate[];
  readonly factsOnAllReturnPaths: ReadonlySet<string>;
}): readonly CheckedSummaryFact[] {
  const exported: CheckedSummaryFact[] = [];
  for (const candidate of input.candidates) {
    if (!input.factsOnAllReturnPaths.has(candidate.termKey)) {
      continue;
    }
    if (!candidate.dependencies.every(dependencyIsExportable)) {
      continue;
    }
    exported.push({ termKey: candidate.termKey });
  }
  return [...exported].sort((left, right) => compareCodeUnitStrings(left.termKey, right.termKey));
}

function mergeInvalidatedFacts(
  explicit: readonly CheckedFactInvalidation[] | undefined,
  mutatedEffects: readonly CheckedSummaryPlaceEffect[],
): readonly CheckedFactInvalidation[] {
  const merged = [...(explicit ?? [])];
  for (const effect of mutatedEffects) {
    if (effect.kind !== "mutates") {
      continue;
    }
    for (const invalidation of effect.invalidates) {
      merged.push(invalidation);
    }
  }
  return merged;
}

function sortedDivergenceFacts(
  divergence: readonly CheckedFunctionSummaryDivergenceInput[] | undefined,
): readonly CheckedDivergenceFact[] {
  return [...(divergence ?? [])].sort((left, right) =>
    compareCodeUnitStrings(left.divergenceKey, right.divergenceKey),
  );
}

function acceptanceDiagnostics(
  functionInstanceId: MonoInstanceId,
  acceptance: Required<CheckedFunctionSummaryAcceptanceInput>,
): readonly ProofCheckDiagnostic[] {
  const ownerKey = summaryOwnerKey(functionInstanceId);
  const diagnostics: ProofCheckDiagnostic[] = [];
  const checks: readonly {
    readonly accepted: boolean;
    readonly component: string;
  }[] = [
    { accepted: acceptance.exits, component: "exits" },
    { accepted: acceptance.divergence, component: "divergence" },
    { accepted: acceptance.terminal, component: "terminal" },
    { accepted: acceptance.privateStateEffects, component: "privateStateEffects" },
    { accepted: acceptance.packetEntries, component: "packetEntries" },
  ];

  for (const check of checks) {
    if (check.accepted) {
      continue;
    }
    diagnostics.push(
      proofCheckDiagnostic({
        severity: "error",
        code: "PROOF_CHECK_SOURCE_CALL_SUMMARY_MISMATCH",
        messageTemplateId: "proof-check.source-call-summary.component-not-accepted",
        messageArguments: [{ kind: "text", value: check.component }],
        message: `Cannot export source-call summary before ${check.component} are accepted`,
        ownerKey,
        rootCauseKey: `summary:${check.component}`,
        stableDetail: `summary:component:${check.component}`,
      }),
    );
  }
  return diagnostics;
}

function validateNormalReturnExitStates(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly exitStates: readonly ProofCheckState[];
}): readonly ProofCheckDiagnostic[] {
  const ownerKey = summaryOwnerKey(input.functionInstanceId);
  const diagnostics: ProofCheckDiagnostic[] = [];

  for (const [index, exitState] of input.exitStates.entries()) {
    const exitOriginKey = `${ownerKey}:return:${index}`;

    const loanResult = checkReturnWithLoans({
      state: exitState,
      operationOriginKey: exitOriginKey,
    });
    if (loanResult.kind === "error") {
      diagnostics.push(...loanResult.diagnostics);
    }

    const crossedScopeResult = checkCrossedScopeExit({
      state: exitState,
      exitKind: "return",
      operationOriginKey: exitOriginKey,
    });
    if (crossedScopeResult.kind === "error") {
      diagnostics.push(...crossedScopeResult.diagnostics);
    }
  }

  return diagnostics;
}

export function buildCheckedFunctionSummary(
  input: BuildCheckedFunctionSummaryInput,
): BuildCheckedFunctionSummaryResult {
  if (input.diagnostics !== undefined && input.diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(input.diagnostics),
    };
  }

  const acceptance = defaultAcceptance(input.acceptance);

  const acceptanceErrors = acceptanceDiagnostics(input.functionInstanceId, acceptance);
  if (acceptanceErrors.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(acceptanceErrors),
    };
  }

  const exitDiagnostics = validateNormalReturnExitStates({
    functionInstanceId: input.functionInstanceId,
    exitStates: input.normalReturnExitStates,
  });
  if (exitDiagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(exitDiagnostics),
    };
  }

  const observedInputs = normalizeSummaryPlaceEffects(input.observedInputs);
  const consumedInputs = normalizeSummaryPlaceEffects(input.consumedInputs);
  const mutatedInputs = normalizeSummaryPlaceEffects(input.mutatedInputs);
  const producedPlaces = normalizeSummaryPlaceEffects(input.producedPlaces);
  const factsOnAllReturnPaths = intersectFactTermKeysAcrossReturnPaths(
    input.normalReturnExitStates,
  );
  const returnedFacts = exportableReturnFacts({
    candidates: input.returnFactCandidates,
    factsOnAllReturnPaths,
  });

  const summary: CheckedFunctionSummary = {
    functionInstanceId: input.functionInstanceId,
    requiredFacts: normalizedRequiredFacts(input.declaredRequirements),
    observedInputs,
    consumedInputs,
    mutatedInputs,
    producedPlaces,
    returnedFacts,
    invalidatedFacts: mergeInvalidatedFacts(input.invalidatedFacts, mutatedInputs),
    privateStateEffects: [...(input.privateStateEffects ?? [])],
    producedCapabilities: [...(input.producedCapabilities ?? [])],
    terminalEffects: [...(input.terminalEffects ?? [])],
    divergence: sortedDivergenceFacts(input.divergence),
    certificateId: summaryCertificateIdForFunction(input.functionInstanceId),
  };

  return { kind: "ok", summary };
}

export function summaryPlaceBinderFromKey(placeKey: string): ProofCheckPlaceBinder | undefined {
  return proofCheckPlaceBinderFromKey(placeKey);
}

export function resetCheckedSummaryInstantiationCertificateIdsForTest(): void {
  // Summary-instantiation certificate ids are derived from stable subject keys.
}

function summaryInstantiationCertificateId(subjectKey: string, functionInstanceId: MonoInstanceId) {
  return checkedSummaryInstantiationCertificateId(
    stableNumericSeed(`summary-instantiation:${String(functionInstanceId)}:${subjectKey}`),
  );
}

function sourceCallOwnerKey(input: CheckedSourceCallTransferInput): string {
  return (
    input.operationOriginKey ?? `source-call:${String(input.call?.callId?.callId ?? "unknown")}`
  );
}

function missingOperandBindingDiagnostic(input: {
  readonly ownerKey: string;
  readonly binderKey: string;
  readonly callerFunctionInstanceId?: MonoInstanceId;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_SOURCE_CALL_SUMMARY_MISMATCH",
    messageTemplateId: "proof-check.source-call-summary.missing-operand",
    messageArguments: [{ kind: "text", value: input.binderKey }],
    message: `Missing operand binding for source call effect at ${input.binderKey}`,
    ownerKey: input.ownerKey,
    rootCauseKey: `source-call:missing-operand:${input.binderKey}`,
    stableDetail: `missing-operand-binding:${input.binderKey}`,
    ...(input.callerFunctionInstanceId !== undefined
      ? { functionInstanceId: input.callerFunctionInstanceId }
      : {}),
  });
}

function missingCalleeSummaryDiagnostic(input: {
  readonly ownerKey: string;
  readonly calleeFunctionInstanceId: MonoInstanceId;
  readonly callerFunctionInstanceId?: MonoInstanceId;
}): ProofCheckDiagnostic {
  return proofCheckDiagnostic({
    severity: "error",
    code: "PROOF_CHECK_SOURCE_CALL_SUMMARY_MISMATCH",
    messageTemplateId: "proof-check.source-call-summary.missing",
    messageArguments: [{ kind: "text", value: String(input.calleeFunctionInstanceId) }],
    message: `Missing accepted callee summary for source call to ${String(input.calleeFunctionInstanceId)}`,
    ownerKey: input.ownerKey,
    rootCauseKey: `summary:missing:${String(input.calleeFunctionInstanceId)}`,
    stableDetail: `missing-summary:${String(input.calleeFunctionInstanceId)}`,
    ...(input.callerFunctionInstanceId !== undefined
      ? { functionInstanceId: input.callerFunctionInstanceId }
      : {}),
  });
}

function resolvePlaceKeyForBinder(
  binder: ProofCheckPlaceBinder,
  bindings: SourceCallOperandBindings | undefined,
): string | undefined {
  const binderKey = proofCheckPlaceBinderKey(binder);
  const explicit = bindings?.placeKeys?.get(binderKey);
  if (explicit !== undefined) {
    return explicit;
  }

  switch (binder.kind) {
    case "receiver":
      return bindings?.receiver?.placeKey;
    case "parameter":
    case "argument":
      return bindings?.arguments?.[binder.index]?.placeKey;
    case "result":
    case "subject":
      return bindings?.result?.placeKey;
    case "proofMirPlace":
      return `proofMirPlace:${String(binder.placeId)}`;
    case "synthetic":
      return String(binder.id);
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

function resourceKindForBinder(
  binder: ProofCheckPlaceBinder,
  bindings: SourceCallOperandBindings | undefined,
  fallback: ProofCheckConcreteResourceKind,
): ProofCheckConcreteResourceKind {
  switch (binder.kind) {
    case "receiver":
      return bindings?.receiver?.resourceKind ?? fallback;
    case "parameter":
    case "argument":
      return bindings?.arguments?.[binder.index]?.resourceKind ?? fallback;
    case "result":
    case "subject":
      return bindings?.result?.resourceKind ?? fallback;
    default:
      return fallback;
  }
}

function substituteRequirements(
  requirements: readonly ProofCheckRequirementTerm[],
  substitution: ProofCheckCallSubstitution,
): ProofCheckRequirementTerm[] {
  return requirements.map((requirement) =>
    substituteProofCheckRequirementTerm(requirement, substitution),
  );
}

function summaryDivergenceBehavior(
  divergence: readonly CheckedDivergenceFact[],
): "none" | "mayDiverge" | "mustDiverge" {
  if (divergence.some((fact) => fact.behavior === "mustDiverge")) {
    return "mustDiverge";
  }
  if (divergence.some((fact) => fact.behavior === "mayDiverge")) {
    return "mayDiverge";
  }
  return "none";
}

function stateDivergenceFactForSummary(divergence: CheckedDivergenceFact): StateDivergenceFact {
  return {
    divergenceKey: divergence.divergenceKey,
    kind: divergence.behavior === "mustDiverge" ? "doesNotReturn" : "panic",
  };
}

function summaryInstantiationCertificate(
  summary: CheckedFunctionSummary,
  subjectKey: string,
): ProofCheckCertificateId {
  return {
    kind: "summaryInstantiation",
    id: summaryInstantiationCertificateId(subjectKey, summary.functionInstanceId),
  };
}

function instantiateReturnedFactPatch(input: {
  readonly term: ProofCheckRequirementTerm;
  readonly ownerKey: string;
  readonly summary: CheckedFunctionSummary;
}): ProofCheckStatePatchEntry {
  const normalized = normalizeProofCheckTerm(input.term, "summaryInstantiation");
  const fact: CheckedActiveFact = {
    factKey: normalized.key,
    termKey: normalized.key,
  };
  return {
    kind: "fact",
    action: "add",
    fact,
  };
}

function resolveValuePlaceKeyForBinder(
  binder: ProofCheckValueBinder,
  bindings: SourceCallOperandBindings | undefined,
): string | undefined {
  switch (binder.kind) {
    case "resultValue":
      return bindings?.result?.placeKey;
    case "proofMirValue":
      return `proofMirValue:${String(binder.valueId)}`;
    case "synthetic":
      return String(binder.id);
    default: {
      const unreachable: never = binder;
      return unreachable;
    }
  }
}

function summaryPacketEntriesForCallSite(input: {
  readonly ownerKey: string;
  readonly entries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
}): readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] {
  return input.entries.map((entry) => ({
    ...entry,
    origin: {
      ...entry.origin,
      originKey: input.ownerKey,
    },
  }));
}

function applySummaryPlaceEffects(input: {
  readonly state: ProofCheckState;
  readonly effects: readonly CheckedSummaryPlaceEffect[];
  readonly bindings: SourceCallOperandBindings | undefined;
  readonly ownerKey: string;
  readonly callerFunctionInstanceId?: MonoInstanceId;
}):
  | CheckedSourceCallTransferResult
  | {
      readonly kind: "ok";
      readonly patches: ProofCheckStatePatchEntry[];
      readonly certificates: ProofCheckCertificateId[];
      readonly packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
    } {
  const patches: ProofCheckStatePatchEntry[] = [];
  const certificates: ProofCheckCertificateId[] = [];
  const packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];

  for (const effect of input.effects) {
    switch (effect.kind) {
      case "observes":
      case "consumes": {
        const placeKey = resolvePlaceKeyForBinder(effect.place, input.bindings);
        if (placeKey === undefined) {
          if (effect.kind === "observes" && effect.borrowMode === undefined) {
            continue;
          }
          return {
            kind: "error",
            diagnostics: sortProofCheckDiagnostics([
              missingOperandBindingDiagnostic({
                ownerKey: input.ownerKey,
                binderKey: proofCheckPlaceBinderKey(effect.place),
                ...(input.callerFunctionInstanceId !== undefined
                  ? { callerFunctionInstanceId: input.callerFunctionInstanceId }
                  : {}),
              }),
            ]),
          };
        }
        const resourceKind = resourceKindForBinder(
          effect.place,
          input.bindings,
          effect.kind === "observes" ? "Copy" : "Linear",
        );
        const ownershipResult = applySummaryPlaceEffect({
          state: input.state,
          place: { placeKey },
          resourceKind,
          mode: effect.kind === "observes" ? "observe" : "consume",
          operationOriginKey: input.ownerKey,
        });
        if (ownershipResult.kind === "error") {
          return ownershipResult;
        }
        patches.push(...ownershipResult.patches);
        certificates.push(...ownershipResult.certificates);
        packetEntries.push(...ownershipResult.packetEntries);
        break;
      }
      case "mutates": {
        const placeKey = resolvePlaceKeyForBinder(effect.place, input.bindings);
        if (placeKey === undefined) {
          return {
            kind: "error",
            diagnostics: sortProofCheckDiagnostics([
              missingOperandBindingDiagnostic({
                ownerKey: input.ownerKey,
                binderKey: proofCheckPlaceBinderKey(effect.place),
                ...(input.callerFunctionInstanceId !== undefined
                  ? { callerFunctionInstanceId: input.callerFunctionInstanceId }
                  : {}),
              }),
            ]),
          };
        }
        const ownershipResult = applySummaryMutationEffect({
          state: input.state,
          place: { placeKey },
          operationOriginKey: input.ownerKey,
          invalidates: effect.invalidates,
        });
        if (ownershipResult.kind === "error") {
          return ownershipResult;
        }
        patches.push(...ownershipResult.patches);
        certificates.push(...ownershipResult.certificates);
        packetEntries.push(...ownershipResult.packetEntries);
        patches.push(...dropInvalidatedFacts(input.state, effect.invalidates));
        break;
      }
      case "produces": {
        const placeKey = resolvePlaceKeyForBinder(effect.place, input.bindings);
        if (placeKey === undefined) {
          return {
            kind: "error",
            diagnostics: sortProofCheckDiagnostics([
              missingOperandBindingDiagnostic({
                ownerKey: input.ownerKey,
                binderKey: proofCheckPlaceBinderKey(effect.place),
                ...(input.callerFunctionInstanceId !== undefined
                  ? { callerFunctionInstanceId: input.callerFunctionInstanceId }
                  : {}),
              }),
            ]),
          };
        }
        const ownershipResult = applySummaryProduceEffect({
          state: input.state,
          place: { placeKey },
          resourceKind: effect.resourceKind,
          operationOriginKey: input.ownerKey,
        });
        if (ownershipResult.kind === "error") {
          return ownershipResult;
        }
        patches.push(...ownershipResult.patches);
        certificates.push(...ownershipResult.certificates);
        packetEntries.push(...ownershipResult.packetEntries);
        break;
      }
      case "returns": {
        const placeKey = resolveValuePlaceKeyForBinder(effect.value, input.bindings);
        if (placeKey === undefined) {
          return {
            kind: "error",
            diagnostics: sortProofCheckDiagnostics([
              missingOperandBindingDiagnostic({
                ownerKey: input.ownerKey,
                binderKey: "result",
                ...(input.callerFunctionInstanceId !== undefined
                  ? { callerFunctionInstanceId: input.callerFunctionInstanceId }
                  : {}),
              }),
            ]),
          };
        }
        const ownershipResult = applySummaryProduceEffect({
          state: input.state,
          place: { placeKey },
          resourceKind: effect.resourceKind,
          operationOriginKey: input.ownerKey,
        });
        if (ownershipResult.kind === "error") {
          return ownershipResult;
        }
        patches.push(...ownershipResult.patches);
        certificates.push(...ownershipResult.certificates);
        packetEntries.push(...ownershipResult.packetEntries);
        break;
      }
      default: {
        const unreachable: never = effect;
        return unreachable;
      }
    }
  }

  return { kind: "ok", patches, certificates, packetEntries };
}

function dropInvalidatedFacts(
  state: ProofCheckState,
  invalidations: readonly CheckedFactInvalidation[],
): ProofCheckStatePatchEntry[] {
  const patches: ProofCheckStatePatchEntry[] = [];
  for (const fact of state.facts.values()) {
    for (const invalidation of invalidations) {
      if (invalidation.kind === "placeMutation" || invalidation.kind === "placeConsume") {
        const placeKey = `proofMirPlace:${String(invalidation.placeId)}`;
        if (factReferencesPlaceKey(fact, placeKey)) {
          patches.push({ kind: "fact", action: "drop", fact });
        }
      }
    }
  }
  return patches;
}

export function sourceCallIdForTest(
  functionInstanceId: MonoInstanceId,
  callId: ProofMirCallId,
): ProofMirCallGraphEdge["callId"] {
  return proofMirOwnedCallId(functionInstanceId, callId);
}

export function checkSourceCallTransfer(
  input: CheckedSourceCallTransferInput,
): CheckedSourceCallTransferResult {
  const ownerKey = sourceCallOwnerKey(input);

  if (input.diagnostics !== undefined && input.diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(input.diagnostics),
    };
  }

  if (input.summary === undefined) {
    const calleeFunctionInstanceId =
      input.call.target.kind === "sourceFunction"
        ? input.call.target.functionInstanceId
        : input.call.callId.functionInstanceId;
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics([
        missingCalleeSummaryDiagnostic({
          ownerKey,
          calleeFunctionInstanceId,
          callerFunctionInstanceId: input.call.callId.functionInstanceId,
        }),
      ]),
    };
  }

  const summary = input.summary;
  const bindings = input.operandBindings;
  const calleeRequirementTerms =
    input.requirementTerms.length > 0
      ? input.requirementTerms
      : input.mir === undefined
        ? []
        : calleeRequirementTermsForSummary({ mir: input.mir, summary });
  const returnedFactTerms =
    input.returnedFactTerms !== undefined && input.returnedFactTerms.length > 0
      ? input.returnedFactTerms
      : input.mir === undefined
        ? []
        : returnedFactTermsForSummary({ mir: input.mir, summary });
  const substitutedRequirements = substituteRequirements(
    calleeRequirementTerms,
    input.substitution,
  );
  const substitutedCallRequirements = substituteRequirements(
    input.callRequirements ?? [],
    input.substitution,
  );
  const allRequirements = [...substitutedRequirements, ...substitutedCallRequirements];

  const environment = buildProofCheckFactEnvironment({
    terms: input.activeFactTerms ?? [],
    state: input.state,
    ownerKey,
  });
  const requirementResult = checkCallRequirementsEntailment(environment, allRequirements, {
    ownerKey,
  });
  if (requirementResult.kind === "error") {
    return { kind: "error", diagnostics: requirementResult.diagnostics };
  }

  const patches: ProofCheckStatePatchEntry[] = [];
  const certificates: ProofCheckCertificateId[] = requirementResult.certificates.map(
    (certificate) => ({
      kind: "core" as const,
      id: certificate.certificateId,
    }),
  );
  const packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];

  const placeEffects = [
    ...summary.observedInputs,
    ...summary.consumedInputs,
    ...summary.mutatedInputs,
    ...summary.producedPlaces,
  ] as readonly CheckedSummaryPlaceEffect[];
  const effectResult = applySummaryPlaceEffects({
    state: input.state,
    effects: placeEffects,
    bindings,
    ownerKey,
    callerFunctionInstanceId: input.call.callId.functionInstanceId,
  });
  if (effectResult.kind === "error") {
    return effectResult;
  }
  patches.push(...effectResult.patches);
  certificates.push(...effectResult.certificates);
  packetEntries.push(...effectResult.packetEntries);

  const divergenceBehavior = summaryDivergenceBehavior(summary.divergence);
  const doesNotReturnNormally = divergenceBehavior === "mustDiverge";

  if (divergenceBehavior !== "none") {
    for (const divergence of summary.divergence) {
      patches.push({
        kind: "divergence",
        divergence: stateDivergenceFactForSummary(divergence),
      });
    }
  }

  if (!doesNotReturnNormally) {
    const exportedTermKeys = new Set(summary.returnedFacts.map((fact) => fact.termKey));
    for (const returnedFactTerm of returnedFactTerms) {
      const sourceNormalized = normalizeProofCheckTerm(returnedFactTerm, "sourceRequirement");
      if (!exportedTermKeys.has(sourceNormalized.key)) {
        continue;
      }
      const substituted = substituteProofCheckRequirementTerm(returnedFactTerm, input.substitution);
      patches.push(
        instantiateReturnedFactPatch({
          term: substituted,
          ownerKey,
          summary,
        }),
      );
      const normalized = normalizeProofCheckTerm(substituted, "summaryInstantiation");
      const instantiationCertificate = summaryInstantiationCertificate(summary, normalized.key);
      certificates.push(instantiationCertificate);
    }
  }

  patches.push(...dropInvalidatedFacts(input.state, summary.invalidatedFacts));

  packetEntries.push(
    ...summaryPacketEntriesForCallSite({
      ownerKey,
      entries: summary.privateStateEffects,
    }),
    ...summaryPacketEntriesForCallSite({
      ownerKey,
      entries: summary.producedCapabilities,
    }),
    ...summaryPacketEntriesForCallSite({
      ownerKey,
      entries: summary.terminalEffects,
    }),
  );

  return {
    kind: "ok",
    patches,
    certificates: [...certificates].sort((left, right) =>
      compareCodeUnitStrings(String(left.id), String(right.id)),
    ),
    packetEntries,
    doesNotReturnNormally,
  };
}
