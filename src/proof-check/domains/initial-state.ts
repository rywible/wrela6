import type { MonoInstanceId } from "../../mono/ids";
import type { MonoExternalRootReason } from "../../mono/mono-hir";
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import type { ProofAuthorityFingerprint } from "../authority/authority-types";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../diagnostics";
import { proofCheckCoreCertificateId, type ProofCheckCoreCertificateId } from "../ids";
import type { ProofCheckCoreCertificate } from "../model/certificates";
import {
  normalizeProofCheckTerm,
  type ProofCheckFactTerm,
  type ProofCheckRequirementTerm,
} from "../model/fact-language";
import type { ProofCheckConcreteResourceKind } from "./ownership";
import {
  createProofCheckState,
  type CheckedActiveFact,
  type CheckedCapabilityState,
  type CheckedPacketSourceFact,
  type CheckedPlaceState,
  type CheckedPrivateStateFact,
  type CheckedValidatedBufferFact,
  type ProofCheckState,
} from "../kernel/state";

export type ProofCheckEntryReason =
  | "ordinarySource"
  | "imageEntry"
  | "targetCallback"
  | "externalRoot";

export interface ProofCheckFunctionParameterInput {
  readonly index: number;
  readonly placeKey: string;
  readonly resourceKind: ProofCheckConcreteResourceKind;
  readonly mode: "observe" | "consume";
}

export interface ProofCheckFunctionReceiverInput {
  readonly placeKey: string;
  readonly resourceKind: ProofCheckConcreteResourceKind;
  readonly mode: "observe" | "consume";
}

export interface ProofCheckFunctionSignatureInput {
  readonly receiver?: ProofCheckFunctionReceiverInput;
  readonly parameters: readonly ProofCheckFunctionParameterInput[];
}

export interface ProofCheckSeededFactInput {
  readonly factKey: string;
  readonly term: ProofCheckFactTerm;
  readonly authorityKey: string;
  readonly source: "imageEntry" | "firmwareAbi" | "targetSeeded" | "catalog" | "typeIntrinsic";
}

export interface ProofCheckSeededCapabilityInput {
  readonly capabilityKey: string;
  readonly capabilityKind: string;
  readonly authorityKey: string;
  readonly source: "imageDevice" | "platform";
}

export interface ProofCheckLayoutAbiFactInput {
  readonly factKey: string;
  readonly layoutKey: string;
}

export interface BuildInitialProofCheckStateInput {
  readonly functionInstanceId: MonoInstanceId;
  readonly entryReason: ProofCheckEntryReason;
  readonly signature: ProofCheckFunctionSignatureInput;
  readonly declaredRequirements: readonly ProofCheckRequirementTerm[];
  readonly seededFacts?: readonly ProofCheckSeededFactInput[];
  readonly seededCapabilities?: readonly ProofCheckSeededCapabilityInput[];
  readonly layoutAbiFacts?: readonly ProofCheckLayoutAbiFactInput[];
  readonly entryPacketSources?: readonly CheckedPacketSourceFact[];
  readonly entryValidatedBufferLayout?: readonly CheckedValidatedBufferFact[];
  readonly intrinsicFacts?: readonly ProofCheckSeededFactInput[];
  readonly authorityFingerprints: readonly ProofAuthorityFingerprint[];
  readonly nextCertificateId?: ProofCheckCoreCertificateId;
}

export interface ProofCheckInitialStateCertificate {
  readonly core: ProofCheckCoreCertificate;
  readonly functionInstanceId: MonoInstanceId;
  readonly entryReason: ProofCheckEntryReason;
  readonly receiverPlaceKey?: string;
  readonly parameterPlaceKeys: readonly string[];
  readonly symbolicAssumptions: readonly string[];
  readonly seededCapabilities: readonly string[];
  readonly typeFactKeys: readonly string[];
  readonly layoutAbiFactKeys: readonly string[];
  readonly rootDischargeCertificateKeys: readonly string[];
  readonly authorityFingerprintKeys: readonly string[];
}

export type BuildInitialProofCheckStateResult =
  | {
      readonly kind: "ok";
      readonly state: ProofCheckState;
      readonly certificate: ProofCheckInitialStateCertificate;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

export interface ProofCheckUniqueRootRecord {
  readonly rootKey: string;
  readonly deviceAuthorityKey: string;
  readonly brandKey: string;
  readonly concreteTypeKey: string;
  readonly originKey: string;
}

export interface ValidateUniqueRootSeedingInput {
  readonly roots: readonly ProofCheckUniqueRootRecord[];
}

export type ValidateUniqueRootSeedingResult =
  | { readonly kind: "ok" }
  | { readonly kind: "error"; readonly diagnostics: readonly ProofCheckDiagnostic[] };

function authorityFingerprintKey(fingerprint: ProofAuthorityFingerprint): string {
  return `${fingerprint.authorityKind}:${String(fingerprint.targetId)}:${fingerprint.version}:${fingerprint.digestHex}`;
}

function sortedUnique<Value>(
  values: readonly Value[],
  keyOf: (value: Value) => string,
): readonly Value[] {
  return [...values].sort((left, right) => compareCodeUnitStrings(keyOf(left), keyOf(right)));
}

function initialStateSubjectKey(functionInstanceId: MonoInstanceId): string {
  return `initial-state:function:${String(functionInstanceId)}`;
}

function symbolicAssumptionKey(requirementKey: string): string {
  return `symbolic:${requirementKey}`;
}

function dischargeCertificateKey(
  functionInstanceId: MonoInstanceId,
  requirementKey: string,
  authorityKey: string,
): string {
  return `root-discharge:function:${String(functionInstanceId)}:requirement:${requirementKey}:authority:${authorityKey}`;
}

function isExternalEntryReason(entryReason: ProofCheckEntryReason): boolean {
  return (
    entryReason === "imageEntry" ||
    entryReason === "targetCallback" ||
    entryReason === "externalRoot"
  );
}

function allowsImageDeviceCapabilityMint(entryReason: ProofCheckEntryReason): boolean {
  return entryReason === "imageEntry" || entryReason === "targetCallback";
}

function allowsPlatformCapabilityMint(entryReason: ProofCheckEntryReason): boolean {
  return entryReason === "externalRoot" || entryReason === "targetCallback";
}

function buildOwnedPlaces(
  signature: ProofCheckFunctionSignatureInput,
): readonly CheckedPlaceState[] {
  const places: CheckedPlaceState[] = [];
  if (signature.receiver !== undefined) {
    places.push({
      placeKey: signature.receiver.placeKey,
      lifecycle: "owned",
    });
  }
  for (const parameter of sortedUnique(signature.parameters, (parameter) => parameter.placeKey)) {
    places.push({
      placeKey: parameter.placeKey,
      lifecycle: "owned",
    });
  }
  return places;
}

function normalizedRequirementEntries(
  requirements: readonly ProofCheckRequirementTerm[],
): readonly { readonly requirement: ProofCheckRequirementTerm; readonly key: string }[] {
  return sortedUnique(
    requirements.map((requirement) => {
      const normalized = normalizeProofCheckTerm(requirement, "sourceRequirement");
      return {
        requirement: normalized.term as ProofCheckRequirementTerm,
        key: normalized.key,
      };
    }),
    (entry) => entry.key,
  );
}

function normalizedSeededFacts(facts: readonly ProofCheckSeededFactInput[] | undefined): readonly {
  readonly input: ProofCheckSeededFactInput;
  readonly key: string;
}[] {
  return sortedUnique(
    (facts ?? []).map((input) => {
      const normalized = normalizeProofCheckTerm(input.term, "activeFact");
      return {
        input,
        key: normalized.key,
      };
    }),
    (entry) => entry.input.factKey,
  );
}

function findDischargingFact(
  requirementKey: string,
  seededFacts: readonly { readonly input: ProofCheckSeededFactInput; readonly key: string }[],
): { readonly input: ProofCheckSeededFactInput; readonly key: string } | undefined {
  return seededFacts.find((fact) => fact.key === requirementKey);
}

function buildActiveFactsForRequirements(input: {
  readonly functionInstanceId: MonoInstanceId;
  readonly entryReason: ProofCheckEntryReason;
  readonly requirements: readonly {
    readonly requirement: ProofCheckRequirementTerm;
    readonly key: string;
  }[];
  readonly seededFacts: readonly {
    readonly input: ProofCheckSeededFactInput;
    readonly key: string;
  }[];
}): {
  readonly facts: readonly CheckedActiveFact[];
  readonly symbolicAssumptions: readonly string[];
  readonly rootDischargeCertificateKeys: readonly string[];
  readonly typeFactKeys: readonly string[];
  readonly diagnostics: readonly ProofCheckDiagnostic[];
} {
  const facts: CheckedActiveFact[] = [];
  const symbolicAssumptions: string[] = [];
  const rootDischargeCertificateKeys: string[] = [];
  const typeFactKeys: string[] = [];
  const diagnostics: ProofCheckDiagnostic[] = [];

  for (const requirement of input.requirements) {
    if (input.entryReason === "ordinarySource") {
      const assumptionKey = symbolicAssumptionKey(requirement.key);
      facts.push({
        factKey: assumptionKey,
        termKey: requirement.key,
      });
      symbolicAssumptions.push(assumptionKey);
      continue;
    }

    const dischargingFact = findDischargingFact(requirement.key, input.seededFacts);
    if (dischargingFact === undefined) {
      diagnostics.push(
        proofCheckDiagnostic({
          severity: "error",
          code: "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
          messageTemplateId: "proof-check.initial-state.unsatisfied-requirement",
          messageArguments: [{ kind: "text", value: requirement.key }],
          message: `Declared requirement '${requirement.key}' is not discharged by authority-seeded facts.`,
          functionInstanceId: input.functionInstanceId,
          ownerKey: `initial-state:function:${String(input.functionInstanceId)}`,
          rootCauseKey: `initial-state:requirement:${requirement.key}`,
          stableDetail: `requirement:${requirement.key}`,
        }),
      );
      continue;
    }

    facts.push({
      factKey: dischargingFact.input.factKey,
      termKey: dischargingFact.key,
    });
    rootDischargeCertificateKeys.push(
      dischargeCertificateKey(
        input.functionInstanceId,
        requirement.key,
        dischargingFact.input.authorityKey,
      ),
    );
    if (dischargingFact.input.source === "typeIntrinsic") {
      typeFactKeys.push(dischargingFact.input.factKey);
    }
  }

  for (const seededFact of input.seededFacts) {
    const alreadyAdded = facts.some((fact) => fact.factKey === seededFact.input.factKey);
    if (alreadyAdded) {
      continue;
    }
    facts.push({
      factKey: seededFact.input.factKey,
      termKey: seededFact.key,
    });
    if (seededFact.input.source === "typeIntrinsic") {
      typeFactKeys.push(seededFact.input.factKey);
    }
  }

  return {
    facts: sortedUnique(facts, (fact) => fact.factKey),
    symbolicAssumptions: sortedUnique(symbolicAssumptions, (value) => value),
    rootDischargeCertificateKeys: sortedUnique(rootDischargeCertificateKeys, (value) => value),
    typeFactKeys: sortedUnique(typeFactKeys, (value) => value),
    diagnostics: sortProofCheckDiagnostics(diagnostics),
  };
}

function buildSeededCapabilities(input: {
  readonly entryReason: ProofCheckEntryReason;
  readonly seededCapabilities: readonly ProofCheckSeededCapabilityInput[] | undefined;
}): readonly CheckedCapabilityState[] {
  const capabilities: CheckedCapabilityState[] = [];
  for (const capability of sortedUnique(
    input.seededCapabilities ?? [],
    (entry) => entry.capabilityKey,
  )) {
    if (
      capability.source === "imageDevice" &&
      !allowsImageDeviceCapabilityMint(input.entryReason)
    ) {
      continue;
    }
    if (capability.source === "platform" && !allowsPlatformCapabilityMint(input.entryReason)) {
      continue;
    }
    capabilities.push({
      capabilityKey: capability.capabilityKey,
      capabilityKind: capability.capabilityKind,
    });
  }
  return capabilities;
}

function buildPrivateStateGenerations(
  signature: ProofCheckFunctionSignatureInput,
): readonly CheckedPrivateStateFact[] {
  const generations: CheckedPrivateStateFact[] = [];
  if (signature.receiver !== undefined && signature.receiver.resourceKind === "PrivateState") {
    generations.push({
      placeKey: signature.receiver.placeKey,
      generationKey: "entry",
    });
  }
  for (const parameter of signature.parameters) {
    if (parameter.resourceKind !== "PrivateState") {
      continue;
    }
    generations.push({
      placeKey: parameter.placeKey,
      generationKey: "entry",
    });
  }
  return sortedUnique(generations, (generation) => generation.placeKey);
}

export function proofCheckEntryReasonFromMonoExternalRoot(
  reason: MonoExternalRootReason,
): ProofCheckEntryReason {
  switch (reason) {
    case "imageEntry":
      return "imageEntry";
    case "deviceHandler":
    case "hardwareCallback":
      return "targetCallback";
    case "targetRequired":
      return "externalRoot";
    default: {
      const unreachable: never = reason;
      return unreachable;
    }
  }
}

export function buildInitialProofCheckState(
  input: BuildInitialProofCheckStateInput,
): BuildInitialProofCheckStateResult {
  const requirementEntries = normalizedRequirementEntries(input.declaredRequirements);
  const seededFactEntries = normalizedSeededFacts(input.seededFacts);
  const intrinsicFactEntries = normalizedSeededFacts(input.intrinsicFacts);
  const requirementFacts = buildActiveFactsForRequirements({
    functionInstanceId: input.functionInstanceId,
    entryReason: input.entryReason,
    requirements: requirementEntries,
    seededFacts: seededFactEntries,
  });

  if (requirementFacts.diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: requirementFacts.diagnostics,
    };
  }

  const capabilities = buildSeededCapabilities({
    entryReason: input.entryReason,
    seededCapabilities: input.seededCapabilities,
  });
  const layoutAbiFactKeys = sortedUnique(
    (input.layoutAbiFacts ?? []).map((fact) => fact.factKey),
    (value) => value,
  );
  const authorityFingerprintKeys = sortedUnique(
    input.authorityFingerprints.map(authorityFingerprintKey),
    (value) => value,
  );
  const parameterPlaceKeys = sortedUnique(
    input.signature.parameters.map((parameter) => parameter.placeKey),
    (value) => value,
  );
  const seededCapabilityKeys = sortedUnique(
    capabilities.map((capability) => capability.capabilityKey),
    (value) => value,
  );
  const certificateId = input.nextCertificateId ?? proofCheckCoreCertificateId(0);
  const intrinsicFacts: CheckedActiveFact[] = intrinsicFactEntries.map((entry) => ({
    factKey: entry.input.factKey,
    termKey: entry.key,
  }));
  const typeFactKeys = sortedUnique(
    [...requirementFacts.typeFactKeys, ...intrinsicFactEntries.map((entry) => entry.key)],
    (value) => value,
  );
  const dependencyKeys = sortedUnique(
    [
      ...requirementFacts.symbolicAssumptions,
      ...requirementFacts.rootDischargeCertificateKeys,
      ...seededCapabilityKeys,
      ...typeFactKeys,
      ...layoutAbiFactKeys,
      ...authorityFingerprintKeys,
    ],
    (value) => value,
  );

  const state = createProofCheckState({
    places: buildOwnedPlaces(input.signature),
    facts: [...requirementFacts.facts, ...intrinsicFacts],
    capabilities,
    privateState: buildPrivateStateGenerations(input.signature),
    layout: [
      ...(input.layoutAbiFacts ?? []).map((fact) => ({
        bufferKey: fact.factKey,
        layoutKey: fact.layoutKey,
      })),
      ...(input.entryValidatedBufferLayout ?? []),
    ],
    packetSources: input.entryPacketSources ?? [],
  });

  const certificate: ProofCheckInitialStateCertificate = {
    core: {
      certificateId,
      rule: "initialState",
      subjectKey: initialStateSubjectKey(input.functionInstanceId),
      dependencyKeys,
    },
    functionInstanceId: input.functionInstanceId,
    entryReason: input.entryReason,
    ...(input.signature.receiver === undefined
      ? {}
      : { receiverPlaceKey: input.signature.receiver.placeKey }),
    parameterPlaceKeys,
    symbolicAssumptions: requirementFacts.symbolicAssumptions,
    seededCapabilities: seededCapabilityKeys,
    typeFactKeys,
    layoutAbiFactKeys,
    rootDischargeCertificateKeys: requirementFacts.rootDischargeCertificateKeys,
    authorityFingerprintKeys,
  };

  return {
    kind: "ok",
    state,
    certificate,
  };
}

function uniqueRootIdentityKey(root: ProofCheckUniqueRootRecord): string {
  return `${root.deviceAuthorityKey}:${root.brandKey}`;
}

export function validateUniqueRootSeeding(
  input: ValidateUniqueRootSeedingInput,
): ValidateUniqueRootSeedingResult {
  const seenRoots = new Map<string, ProofCheckUniqueRootRecord>();
  const diagnostics: ProofCheckDiagnostic[] = [];
  const sortedRoots = sortedUnique(input.roots, (root) => root.rootKey);

  for (const root of sortedRoots) {
    const identityKey = uniqueRootIdentityKey(root);
    const previous = seenRoots.get(identityKey);
    if (previous !== undefined) {
      diagnostics.push(
        proofCheckDiagnostic({
          severity: "error",
          code: "PROOF_CHECK_UNIQUE_ROOT_DUPLICATE",
          messageTemplateId: "proof-check.initial-state.duplicate-unique-root",
          messageArguments: [
            { kind: "text", value: root.deviceAuthorityKey },
            { kind: "text", value: root.brandKey },
          ],
          message: `Duplicate unique root for device authority '${root.deviceAuthorityKey}' and brand '${root.brandKey}'.`,
          ownerKey: "initial-state:unique-root",
          rootCauseKey: `unique-root:${identityKey}`,
          stableDetail: `duplicate:${identityKey}:previous:${previous.rootKey}:next:${root.rootKey}`,
        }),
      );
      continue;
    }
    seenRoots.set(identityKey, root);
  }

  if (diagnostics.length > 0) {
    return {
      kind: "error",
      diagnostics: sortProofCheckDiagnostics(diagnostics),
    };
  }

  return { kind: "ok" };
}

export function isAuthoritySeededEntryReason(entryReason: ProofCheckEntryReason): boolean {
  return isExternalEntryReason(entryReason);
}
