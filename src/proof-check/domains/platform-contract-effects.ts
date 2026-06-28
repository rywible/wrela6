import { stableNumericSeed } from "../stable-numeric-seed";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type {
  ProofCheckContractEffect,
  ProofCheckGuardedPostcondition,
  ProofCheckPlatformContract,
} from "../authority/platform-contracts";
import type { ProofCheckDiagnostic } from "../diagnostics";
import {
  type ProofCheckPlaceResolver,
  tryResolveProofMirPlaceDependency,
  tryResolveProofMirPlaceIdForPlaceKey,
} from "../kernel/registry/transition-helpers";
import {
  proofCheckCoreCertificateId,
  proofCheckPacketFactId,
  proofCheckTransitionId,
} from "../ids";
import type { ProofCheckCertificateId, ProofCheckCoreCertificate } from "../model/certificates";
import { checkedTerminalClosureKey } from "../model/certificates";
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
  platformEffectKindId,
  type ProofCheckFactTerm,
  type ProofCheckOperandTerm,
  type ProofCheckPlaceBinder,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import {
  proofCheckPatchKind,
  type ProofCheckPatchKind,
  type ProofCheckStatePatch,
  type ProofCheckStatePatchEntry,
} from "../kernel/state-patch";
import {
  type CheckedActiveFact,
  type CheckedDivergenceFact,
  type CheckedTerminalClosureFact,
  type ProofCheckState,
} from "../kernel/state";
import { proofMirOriginId, proofMirPlaceId } from "../../proof-mir/ids";
import { buildProofCheckFactEnvironment, checkCallRequirementsEntailment } from "./facts";
import { advancePrivateState } from "./private-state";
import { factReferencesPlaceKey, textReferencesPlaceKey } from "./place-key-references";

export interface PlatformGuardedPostconditionInput {
  readonly state: ProofCheckState;
  readonly preFacts: readonly ProofCheckFactTerm[];
  readonly postconditions?: readonly ProofCheckFactTerm[];
  readonly guardedPostconditions: readonly ProofCheckGuardedPostcondition[];
  readonly operationOriginKey?: string;
}

export interface PlatformEffectInvalidationInput {
  readonly state: ProofCheckState;
  readonly effect: ProofCheckContractEffect;
  readonly preservationFacts: readonly ProofCheckFactTerm[];
  readonly operationOriginKey?: string;
}

export interface PlatformContractEffectOperandBindings {
  readonly receiver?: { readonly placeKey: string };
  readonly arguments?: readonly { readonly placeKey: string }[];
}

export interface PlatformContractEffectsInput {
  readonly state: ProofCheckState;
  readonly contract: ProofCheckPlatformContract;
  readonly preFacts?: readonly ProofCheckFactTerm[];
  readonly operationOriginKey?: string;
  readonly programPointScope?: CheckedFactScope;
  readonly placeResolver?: ProofCheckPlaceResolver;
  readonly operandBindings?: PlatformContractEffectOperandBindings;
  readonly privateStateAdvance?: {
    readonly placeKey: string;
    readonly nextGenerationKey: string;
    readonly transitionKey: string;
  };
}

export type PlatformGuardedPostconditionResult =
  | {
      readonly kind: "ok";
      readonly patch: ProofCheckStatePatch<ProofCheckPatchKind>;
      readonly certificates: readonly ProofCheckCertificateId[];
      readonly packetEntries: readonly CheckedFactPacketEntry<
        CheckedFactKindId,
        CheckedFactSubject
      >[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export type PlatformEffectInvalidationResult =
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

export type PlatformContractEffectsResult = PlatformGuardedPostconditionResult;

function defaultOwnerKey(ownerKey: string | undefined): string {
  return ownerKey ?? "proof-check:platform-effects";
}

function defaultScope(): CheckedFactScope {
  return { kind: "wholeImage" };
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
        `platform-cert:${input.rule}:${input.subjectKey}:${dependencyKeys.join(",")}`,
      ),
    ),
    rule: input.rule,
    subjectKey: input.subjectKey,
    dependencyKeys,
  };
}

function certificateForSubject(subjectKey: string): ProofCheckCertificateId {
  return {
    kind: "core",
    id: allocateCoreCertificate({
      rule: "authorityMembership",
      subjectKey,
      dependencyKeys: [],
    }).certificateId,
  };
}

function originForPlatformEffect(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

function buildCoreTransferPatch(input: {
  readonly entries: readonly ProofCheckStatePatchEntry[];
  readonly operationOriginKey: string;
}): ProofCheckStatePatch<ProofCheckPatchKind> {
  const subjectKey = `platform-effects:${input.operationOriginKey}`;
  return {
    kind: proofCheckPatchKind("coreTransfer"),
    transitionId: proofCheckTransitionId(stableNumericSeed(`transition:${subjectKey}`)),
    certificate: certificateForSubject(subjectKey),
    entries: input.entries,
  };
}

function substituteStateOperand(
  operand: ProofCheckOperandTerm,
  phase: "pre" | "post",
): ProofCheckOperandTerm {
  if (operand.kind === "preState") {
    return phase === "pre" ? substituteStateOperand(operand.operand, phase) : operand;
  }
  if (operand.kind === "postState") {
    return phase === "post" ? substituteStateOperand(operand.operand, phase) : operand;
  }
  return operand;
}

function substituteStateOperandsInRequirement(
  requirement: ProofCheckRequirementTerm,
  phase: "pre" | "post",
): ProofCheckRequirementTerm {
  switch (requirement.kind) {
    case "comparison":
      return {
        kind: "comparison",
        left: substituteStateOperand(requirement.left, phase),
        operator: requirement.operator,
        right: substituteStateOperand(requirement.right, phase),
      };
    case "predicate":
      return {
        kind: "predicate",
        predicateFunctionId: requirement.predicateFunctionId,
        arguments: requirement.arguments.map((argument) => substituteStateOperand(argument, phase)),
        ...(requirement.privateState === undefined
          ? {}
          : { privateState: requirement.privateState }),
      };
    case "layoutFits":
      return {
        kind: "layoutFits",
        source: requirement.source,
        end: substituteStateOperand(requirement.end, phase),
      };
    case "payloadEnd":
      return {
        kind: "payloadEnd",
        source: requirement.source,
        end: substituteStateOperand(requirement.end, phase),
      };
    case "fieldAvailable":
      return requirement;
    case "rangeConstraint":
      return {
        kind: "rangeConstraint",
        left: substituteStateOperand(requirement.left, phase),
        relation: requirement.relation,
        right: substituteStateOperand(requirement.right, phase),
        width: requirement.width,
      };
    case "noUnsignedOverflow":
      return {
        kind: "noUnsignedOverflow",
        expression: substituteStateOperand(requirement.expression, phase),
        width: requirement.width,
      };
    case "capability":
      return requirement;
    case "packetSource":
      return requirement;
    default: {
      const unreachable: never = requirement;
      return unreachable;
    }
  }
}

function substituteStateOperandsInFactTerm(
  term: ProofCheckFactTerm,
  phase: "pre" | "post",
): ProofCheckFactTerm {
  if (term.kind === "matchRefinement") {
    return {
      kind: "matchRefinement",
      scrutinee: substituteStateOperand(term.scrutinee, phase),
      caseKey: term.caseKey,
      polarity: term.polarity,
    };
  }
  if (term.kind === "terminalCall") {
    return term;
  }
  return substituteStateOperandsInRequirement(term, phase);
}

function materializeActiveFactTerm(term: ProofCheckFactTerm): ProofCheckFactTerm {
  return substituteStateOperandsInFactTerm(term, "post");
}

function activeFactFromTerm(term: ProofCheckFactTerm): CheckedActiveFact {
  const normalized = normalizeProofCheckTerm(
    materializeActiveFactTerm(term),
    "catalogPostcondition",
  );
  return {
    factKey: normalized.key,
    termKey: normalized.key,
  };
}

function factAddPatch(term: ProofCheckFactTerm): ProofCheckStatePatchEntry {
  return {
    kind: "fact",
    action: "add",
    fact: activeFactFromTerm(term),
  };
}

function factDropPatch(fact: CheckedActiveFact): ProofCheckStatePatchEntry {
  return {
    kind: "fact",
    action: "drop",
    fact,
  };
}

function buildPlatformEffectPacketEntry(input: {
  readonly effectKind: string;
  readonly placeKey: string;
  readonly operationOriginKey: string;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> | undefined {
  const placeId = tryResolveProofMirPlaceIdForPlaceKey(input.placeKey, input.placeResolver);
  if (placeId === undefined) {
    return undefined;
  }
  const subjectKey = `${input.effectKind}:${input.placeKey}`;
  const placeDependency = tryResolveProofMirPlaceDependency(input.placeKey, input.placeResolver);
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`platformEffect:${subjectKey}`)),
    kind: checkedFactKindId("platformEffect"),
    subject: { kind: "place", placeId },
    scope: defaultScope(),
    dependencies: placeDependency === undefined ? [] : [placeDependency],
    invalidatedBy: [
      {
        kind: "platformEffect",
        effectKind: platformEffectKindId(input.effectKind),
        subject: { kind: "place", placeId },
      },
    ],
    certificate: certificateForSubject(subjectKey),
    origin: originForPlatformEffect(input.operationOriginKey),
  };
}

function buildTerminalClosurePacketEntry(input: {
  readonly terminalKey: CheckedTerminalClosureFact["terminalKey"];
  readonly operationOriginKey: string;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(`terminal:${input.terminalKey}`)),
    kind: checkedFactKindId("terminalClosure"),
    subject: { kind: "terminal", terminalKey: checkedTerminalClosureKey(input.terminalKey) },
    scope: defaultScope(),
    dependencies: [],
    invalidatedBy: [],
    certificate: certificateForSubject(`terminal:${input.terminalKey}`),
    origin: originForPlatformEffect(input.operationOriginKey),
  };
}

function buildDivergencePacketEntry(input: {
  readonly divergence: CheckedDivergenceFact;
  readonly operationOriginKey: string;
}): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const subjectKey = `divergence:${input.divergence.divergenceKey}:${input.divergence.kind}`;
  return {
    factId: proofCheckPacketFactId(stableNumericSeed(subjectKey)),
    kind: checkedFactKindId("exitClosure"),
    subject: { kind: "place", placeId: proofMirPlaceId(stableNumericSeed(subjectKey)) },
    scope: defaultScope(),
    dependencies: [],
    invalidatedBy: [],
    certificate: certificateForSubject(subjectKey),
    origin: originForPlatformEffect(input.operationOriginKey),
  };
}

function guardedPostconditionsEntailed(
  input: PlatformGuardedPostconditionInput,
  ownerKey: string,
): readonly ProofCheckFactTerm[] {
  const preEnvironment = buildProofCheckFactEnvironment({
    state: input.state,
    terms: input.preFacts,
    ownerKey,
  });
  const producedFacts: ProofCheckFactTerm[] = [];

  const guardedPostconditions = [...input.guardedPostconditions].sort((left, right) =>
    compareCodeUnitStrings(left.authorityKey, right.authorityKey),
  );

  for (const guarded of guardedPostconditions) {
    const substitutedWhen = guarded.when.map((whenTerm) =>
      substituteStateOperandsInRequirement(whenTerm, "pre"),
    );
    const whenResult = checkCallRequirementsEntailment(preEnvironment, substitutedWhen, {
      ownerKey,
    });

    if (whenResult.kind === "ok") {
      producedFacts.push(...guarded.consequentTerms);
      continue;
    }

    if (guarded.otherwisePreserves !== undefined) {
      producedFacts.push(...guarded.otherwisePreserves);
    }
  }

  return producedFacts;
}

export function applyPlatformGuardedPostconditions(
  input: PlatformGuardedPostconditionInput,
): PlatformGuardedPostconditionResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey);
  const producedFacts = guardedPostconditionsEntailed(input, ownerKey);
  const postconditionFacts = [...(input.postconditions ?? []), ...producedFacts];

  const entries = postconditionFacts
    .map((term) => factAddPatch(term))
    .sort((left, right) => {
      if (left.kind !== "fact" || right.kind !== "fact") {
        return 0;
      }
      return compareCodeUnitStrings(left.fact.factKey, right.fact.factKey);
    });

  const certificates = postconditionFacts.map((term) =>
    certificateForSubject(normalizeProofCheckTerm(materializeActiveFactTerm(term)).key),
  );

  return {
    kind: "ok",
    patch: buildCoreTransferPatch({ entries, operationOriginKey: ownerKey }),
    certificates,
    packetEntries: [],
  };
}

function effectPlaceKey(effect: ProofCheckContractEffect): string | undefined {
  switch (effect.kind) {
    case "readsMemory":
    case "writesMemory":
    case "advancesPrivateState":
      return proofCheckPlaceBinderKey(effect.place);
    case "platformEffect":
      return undefined;
    case "pure":
    case "mayPanic":
    case "doesNotReturn":
      return undefined;
    default: {
      const unreachable: never = effect;
      return unreachable;
    }
  }
}

function factDependsOnPlaceKey(fact: CheckedActiveFact, placeKey: string): boolean {
  return factReferencesPlaceKey(fact, placeKey);
}

function preservedFactKeys(
  input: PlatformEffectInvalidationInput,
  _ownerKey: string,
): ReadonlySet<string> {
  const preserved = new Set<string>();
  for (const preservationFact of input.preservationFacts) {
    const materialized = materializeActiveFactTerm(preservationFact);
    const normalizedKey = normalizeProofCheckTerm(materialized, "catalogPostcondition").key;
    preserved.add(normalizedKey);
    collectPreservedFactKeysFromTerm(materialized, preserved);
  }
  return preserved;
}

function collectPreservedFactKeysFromTerm(term: ProofCheckFactTerm, preserved: Set<string>): void {
  if (term.kind === "comparison") {
    for (const operand of [term.left, term.right]) {
      collectPreservedOperandKeys(operand, preserved);
    }
    return;
  }
  if (term.kind === "packetSource") {
    preserved.add(proofCheckPlaceBinderKey(term.packet));
    preserved.add(proofCheckPlaceBinderKey(term.source));
  }
}

function collectPreservedOperandKeys(operand: ProofCheckOperandTerm, preserved: Set<string>): void {
  if (operand.kind === "value" && operand.value.kind === "synthetic") {
    preserved.add(String(operand.value.id));
    return;
  }
  if (operand.kind === "place") {
    preserved.add(proofCheckPlaceBinderKey(operand.place));
    return;
  }
  if (operand.kind === "preState" || operand.kind === "postState") {
    collectPreservedOperandKeys(operand.operand, preserved);
  }
}

function normalizedSubjectKey(value: string): string {
  return value.replaceAll(".", ":");
}

function isPreservedActiveFact(
  fact: CheckedActiveFact,
  preservedKeys: ReadonlySet<string>,
): boolean {
  for (const preservedKey of preservedKeys) {
    const normalizedPreserved = normalizedSubjectKey(preservedKey);
    if (
      fact.factKey === preservedKey ||
      fact.termKey === preservedKey ||
      fact.factKey === normalizedPreserved ||
      fact.termKey === normalizedPreserved
    ) {
      return true;
    }
    if (
      textReferencesPlaceKey(fact.factKey, preservedKey) ||
      textReferencesPlaceKey(fact.termKey, preservedKey) ||
      textReferencesPlaceKey(fact.factKey, normalizedPreserved) ||
      textReferencesPlaceKey(fact.termKey, normalizedPreserved)
    ) {
      return true;
    }
  }
  return false;
}

export function applyPlatformEffectInvalidation(
  input: PlatformEffectInvalidationInput,
): PlatformEffectInvalidationResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey);
  const placeKey = effectPlaceKey(input.effect);
  if (placeKey === undefined && input.effect.kind !== "platformEffect") {
    return { kind: "ok", patches: [], certificates: [], packetEntries: [] };
  }

  const preserved = preservedFactKeys(input, ownerKey);
  const patches: ProofCheckStatePatchEntry[] = [];
  const sortedFacts = [...input.state.facts.values()].sort((left, right) =>
    compareCodeUnitStrings(left.factKey, right.factKey),
  );

  for (const fact of sortedFacts) {
    if (placeKey !== undefined && !factDependsOnPlaceKey(fact, placeKey)) {
      continue;
    }
    if (isPreservedActiveFact(fact, preserved)) {
      continue;
    }
    if (input.effect.kind === "platformEffect") {
      patches.push(factDropPatch(fact));
      continue;
    }
    patches.push(factDropPatch(fact));
  }

  const certificates = patches
    .filter(
      (patch): patch is Extract<ProofCheckStatePatchEntry, { kind: "fact" }> =>
        patch.kind === "fact",
    )
    .map((patch) => certificateForSubject(`invalidate:${patch.fact.factKey}`));

  return {
    kind: "ok",
    patches,
    certificates,
    packetEntries: [],
  };
}

function concretePlaceKeyForContractPlace(input: {
  readonly place: ProofCheckPlaceBinder;
  readonly operandBindings?: PlatformContractEffectOperandBindings;
}): string {
  switch (input.place.kind) {
    case "receiver":
      return input.operandBindings?.receiver?.placeKey ?? proofCheckPlaceBinderKey(input.place);
    case "parameter":
    case "argument": {
      const argument = input.operandBindings?.arguments?.[input.place.index];
      return argument?.placeKey ?? proofCheckPlaceBinderKey(input.place);
    }
    default:
      return proofCheckPlaceBinderKey(input.place);
  }
}

function applyContractEffect(input: {
  readonly state: ProofCheckState;
  readonly effect: ProofCheckContractEffect;
  readonly preservationFacts: readonly ProofCheckFactTerm[];
  readonly operationOriginKey: string;
  readonly programPointScope: CheckedFactScope;
  readonly placeResolver?: ProofCheckPlaceResolver;
  readonly operandBindings?: PlatformContractEffectOperandBindings;
  readonly privateStateAdvance?: PlatformContractEffectsInput["privateStateAdvance"];
}): PlatformEffectInvalidationResult {
  const patches: ProofCheckStatePatchEntry[] = [];
  const certificates: ProofCheckCertificateId[] = [];
  const packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [];

  const invalidation = applyPlatformEffectInvalidation({
    state: input.state,
    effect: input.effect,
    preservationFacts: input.preservationFacts,
    operationOriginKey: input.operationOriginKey,
  });
  if (invalidation.kind === "error") {
    return invalidation;
  }
  patches.push(...invalidation.patches);
  certificates.push(...invalidation.certificates);

  switch (input.effect.kind) {
    case "pure":
      break;
    case "readsMemory": {
      const placeKey = concretePlaceKeyForContractPlace({
        place: input.effect.place,
        operandBindings: input.operandBindings,
      });
      const packetEntry = buildPlatformEffectPacketEntry({
        effectKind: "readsMemory",
        placeKey,
        operationOriginKey: input.operationOriginKey,
        placeResolver: input.placeResolver,
      });
      if (packetEntry !== undefined) {
        packetEntries.push(packetEntry);
      }
      break;
    }
    case "writesMemory": {
      const placeKey = concretePlaceKeyForContractPlace({
        place: input.effect.place,
        operandBindings: input.operandBindings,
      });
      const packetEntry = buildPlatformEffectPacketEntry({
        effectKind: "writesMemory",
        placeKey,
        operationOriginKey: input.operationOriginKey,
        placeResolver: input.placeResolver,
      });
      if (packetEntry !== undefined) {
        packetEntries.push(packetEntry);
      }
      break;
    }
    case "advancesPrivateState": {
      const placeKey = concretePlaceKeyForContractPlace({
        place: input.effect.place,
        operandBindings: input.operandBindings,
      });
      const advanceInput = input.privateStateAdvance ?? {
        placeKey,
        nextGenerationKey: `${placeKey}:next`,
        transitionKey: `platform:${input.operationOriginKey}`,
      };
      const advance = advancePrivateState({
        state: input.state,
        placeKey: advanceInput.placeKey,
        nextGenerationKey: advanceInput.nextGenerationKey,
        transitionKey: advanceInput.transitionKey,
        operationOriginKey: input.operationOriginKey,
        programPointScope: input.programPointScope,
        placeResolver: input.placeResolver,
      });
      if (advance.kind === "error") {
        return advance;
      }
      patches.push(...advance.patches);
      packetEntries.push(...advance.packetEntries);
      certificates.push(
        certificateForSubject(
          `private-state:${advanceInput.placeKey}:${advanceInput.nextGenerationKey}`,
        ),
      );
      break;
    }
    case "platformEffect": {
      const placeKey = concretePlaceKeyForContractPlace({
        place: { kind: "subject" },
        operandBindings: input.operandBindings,
      });
      const packetEntry = buildPlatformEffectPacketEntry({
        effectKind: String(input.effect.effectKind),
        placeKey,
        operationOriginKey: input.operationOriginKey,
        placeResolver: input.placeResolver,
      });
      if (packetEntry !== undefined) {
        packetEntries.push(packetEntry);
      }
      break;
    }
    case "mayPanic":
    case "doesNotReturn": {
      const divergence: CheckedDivergenceFact = {
        divergenceKey: `${input.operationOriginKey}:${input.effect.kind}`,
        kind: input.effect.kind === "mayPanic" ? "panic" : "doesNotReturn",
      };
      patches.push({ kind: "divergence", divergence });
      packetEntries.push(
        buildDivergencePacketEntry({
          divergence,
          operationOriginKey: input.operationOriginKey,
        }),
      );
      certificates.push(certificateForSubject(divergence.divergenceKey));
      break;
    }
    default: {
      const unreachable: never = input.effect;
      return unreachable;
    }
  }

  return {
    kind: "ok",
    patches,
    certificates,
    packetEntries,
  };
}

function terminalFactsFromPostconditions(
  postconditions: readonly ProofCheckFactTerm[],
): readonly CheckedTerminalClosureFact[] {
  const terminals: CheckedTerminalClosureFact[] = [];
  for (const postcondition of postconditions) {
    if (postcondition.kind !== "terminalCall") {
      continue;
    }
    terminals.push({
      terminalKey: checkedTerminalClosureKey(
        `terminal:${String(postcondition.call)}:${postcondition.terminalKind}`,
      ),
    });
  }
  return terminals;
}

export function applyPlatformContractEffects(
  input: PlatformContractEffectsInput,
): PlatformContractEffectsResult {
  const ownerKey = defaultOwnerKey(input.operationOriginKey);
  const programPointScope = input.programPointScope ?? defaultScope();
  const preFacts = input.preFacts ?? [];

  const guardedResult = applyPlatformGuardedPostconditions({
    state: input.state,
    preFacts,
    postconditions: input.contract.postconditions,
    guardedPostconditions: input.contract.guardedPostconditions,
    operationOriginKey: ownerKey,
  });
  if (guardedResult.kind === "error") {
    return guardedResult;
  }

  const patches: ProofCheckStatePatchEntry[] = [...guardedResult.patch.entries];
  const certificates: ProofCheckCertificateId[] = [...guardedResult.certificates];
  const packetEntries: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] = [
    ...guardedResult.packetEntries,
  ];

  const sortedEffects = [...input.contract.effects].sort((left, right) =>
    compareCodeUnitStrings(left.kind, right.kind),
  );

  for (const effect of sortedEffects) {
    const effectResult = applyContractEffect({
      state: input.state,
      effect,
      preservationFacts: input.contract.postconditions,
      operationOriginKey: ownerKey,
      programPointScope,
      placeResolver: input.placeResolver,
      operandBindings: input.operandBindings,
      privateStateAdvance: input.privateStateAdvance,
    });
    if (effectResult.kind === "error") {
      return effectResult;
    }
    patches.push(...effectResult.patches);
    certificates.push(...effectResult.certificates);
    packetEntries.push(...effectResult.packetEntries);
  }

  for (const terminal of terminalFactsFromPostconditions(input.contract.postconditions)) {
    patches.push({ kind: "terminal", terminal });
    packetEntries.push(
      buildTerminalClosurePacketEntry({
        terminalKey: terminal.terminalKey,
        operationOriginKey: ownerKey,
      }),
    );
    certificates.push(certificateForSubject(`terminal:${terminal.terminalKey}`));
  }

  return {
    kind: "ok",
    patch: buildCoreTransferPatch({ entries: patches, operationOriginKey: ownerKey }),
    certificates: certificates.sort((left, right) =>
      compareCodeUnitStrings(String(left.id), String(right.id)),
    ),
    packetEntries: packetEntries.sort((left, right) => {
      const kindCmp = compareCodeUnitStrings(left.kind, right.kind);
      if (kindCmp !== 0) {
        return kindCmp;
      }
      return compareCodeUnitStrings(String(left.factId), String(right.factId));
    }),
  };
}

export function resetPlatformEffectCertificateIdsForTest(): void {
  resetPlatformEffectCertificateIdsForTestInternal();
}

function resetPlatformEffectCertificateIdsForTestInternal(): void {
  // Platform effect certificates use stable subject-key seeds; nothing to reset.
}
