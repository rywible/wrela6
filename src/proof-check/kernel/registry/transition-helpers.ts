import type { MonoInstanceId } from "../../../mono/ids";
import {
  proofMirOriginId,
  proofMirPlaceId,
  type ProofMirExitEdgeId,
  type ProofMirPlaceId,
} from "../../../proof-mir/ids";
import type {
  ProofMirExitClosurePolicy,
  ProofMirExitEdge,
  ProofMirFunction,
  ProofMirControlEdge,
} from "../../../proof-mir/model/graph";
import type { ProofMirProgram } from "../../../proof-mir/model/program";
import type { LayoutEntailmentCertificate } from "../../domains/layout-entailment";
import { compareCodeUnitStrings } from "../../../shared/deterministic-sort";
import { stableDigestHex } from "../../../shared/stable-json";
import { stableNumericSeed } from "../../stable-numeric-seed";
import type { AttemptTransferResult } from "../../domains/attempts";
import { buildPlaceKeyToMirPlaceIdIndex } from "../../domains/mir-place-bindings";
import {
  resolveAttemptContextForBlock,
  resolveAttemptContextForEdge,
  resolveValidationContextForBlock,
  resolveValidationContextForEdge,
} from "../../domains/mir-operation-metadata";
import type { ProofCheckOwnershipTransferResult } from "../../domains/ownership";
import { recordSummaryPlaceEffect } from "../../domains/summary-input";
import type { ProofCheckRegistrySideEffect } from "./registry-effects";
import type { ProofCheckCertificateRegistry } from "../certificate-registry";
import type { LocalTerminalExitResult } from "../../domains/terminal";
import type { ValidationTransferResult } from "../../domains/validation";
import type { TakeSessionTransferResult } from "../../domains/take-sessions";
import {
  proofCheckDiagnostic,
  sortProofCheckDiagnostics,
  type ProofCheckDiagnostic,
} from "../../diagnostics";
import { proofCheckCoreCertificateId } from "../../ids";
import type {
  ProofCheckCertificateId,
  ProofCheckCoreCertificate,
  ProofCheckCoreCertificateRule,
} from "../../model/certificates";
import type { ProofCheckCoreCertificateId } from "../../ids";
import type {
  CheckedFactDependency,
  CheckedFactKindId,
  CheckedPacketFactKind,
  CheckedFactPacketEntry,
  CheckedFactScope,
  CheckedFactSubject,
  CheckedOriginFact,
} from "../../model/fact-packet";
import type { CheckedFunctionSummary } from "../../model/function-summary";
import { certificateProvesSubject } from "../../validation/packet-certificate-index";
import { checkedFactSubjectKey } from "../../validation/packet-validator";
import type {
  CheckProofAndResourcesInput,
  ValidateProofCheckInputResult,
} from "../../input-contract";
import type { ProofCheckStatePatchEntry } from "../state-patch";
import type { CheckedPlaceState, ProofCheckState, ProofCheckStructuredPlace } from "../state";
import {
  proofCheckProgramPointKey,
  type ProofCheckTransition,
  type ProofCheckTransitionResult,
} from "../transition-api";

export interface ProofCheckPlaceResolver {
  index: Map<string, ProofMirPlaceId>;
  placeShapeKeyByPlaceId: Map<string, string>;
  equivalentPlaceKeysByPlaceId: Map<string, readonly string[]>;
  canonicalPlaceKeyByPlaceKey: Map<string, string>;
}

export interface ProofCheckRegistryContext {
  readonly input: CheckProofAndResourcesInput;
  readonly validatedInput: ValidateProofCheckInputResult;
  readonly summaries: ReadonlyMap<MonoInstanceId, CheckedFunctionSummary>;
  readonly certificateRegistry: ProofCheckCertificateRegistry;
  readonly coreCertificates: ProofCheckCoreCertificate[];
  readonly placeResolver: ProofCheckPlaceResolver;
}

export interface BuildProofCheckOperationTransferRegistryInput {
  readonly context: ProofCheckRegistryContext;
}

export { stableNumericSeed } from "../../stable-numeric-seed";

export function createProofCheckPlaceResolver(mir?: ProofMirProgram): ProofCheckPlaceResolver {
  const placeResolver: ProofCheckPlaceResolver = {
    index: new Map<string, ProofMirPlaceId>(),
    placeShapeKeyByPlaceId: new Map<string, string>(),
    equivalentPlaceKeysByPlaceId: new Map<string, readonly string[]>(),
    canonicalPlaceKeyByPlaceKey: new Map<string, string>(),
  };
  if (mir !== undefined) {
    for (const functionGraph of mir.functions.entries()) {
      registerProofMirFunctionPlaces(placeResolver, functionGraph);
    }
  }
  return placeResolver;
}

export function createProofCheckPlaceResolverForFunction(input: {
  readonly mir: ProofMirProgram;
  readonly functionInstanceId: MonoInstanceId;
}): ProofCheckPlaceResolver {
  const placeResolver = createProofCheckPlaceResolver();
  const functionGraph = input.mir.functions.get(input.functionInstanceId);
  if (functionGraph !== undefined) {
    registerProofMirFunctionPlaces(placeResolver, functionGraph);
  }
  return placeResolver;
}

export function placeKeyForMirPlace(placeId: ProofMirPlaceId): string {
  return `proofMirPlace:${String(placeId)}`;
}

function resolverPlaceIdKey(functionGraph: ProofMirFunction, placeId: ProofMirPlaceId): string {
  return `${String(functionGraph.functionInstanceId)}:${String(placeId)}`;
}

export function proofMirPlaceShapeKey(input: {
  readonly functionGraph: ProofMirFunction;
  readonly placeId: ProofMirPlaceId;
}): string | undefined {
  const place = input.functionGraph.places.get(input.placeId);
  if (place === undefined) {
    return undefined;
  }
  return stableDigestHex({
    root: place.root,
    projection: place.projection,
  });
}

function canonicalAliasPriority(aliasKey: string): number {
  if (aliasKey === "receiver") {
    return 0;
  }
  if (/^parameter:\d+:.+/.test(aliasKey)) {
    return 1;
  }
  if (/^argument:\d+:.+/.test(aliasKey)) {
    return 2;
  }
  if (aliasKey === "result") {
    return 3;
  }
  if (aliasKey.startsWith("proofMirPlace:")) {
    return 4;
  }
  if (/^parameter:\d+$/.test(aliasKey)) {
    return 5;
  }
  if (/^argument:\d+$/.test(aliasKey)) {
    return 6;
  }
  return 7;
}

function canonicalAliasForPlaceShape(
  aliases: Iterable<string>,
  fallbackPlaceId: ProofMirPlaceId,
): string {
  return (
    [...aliases].sort((left, right) => {
      const priorityDelta = canonicalAliasPriority(left) - canonicalAliasPriority(right);
      return priorityDelta === 0 ? compareCodeUnitStrings(left, right) : priorityDelta;
    })[0] ?? placeKeyForMirPlace(fallbackPlaceId)
  );
}

export function registerProofMirFunctionPlaces(
  placeResolver: ProofCheckPlaceResolver,
  functionGraph: ProofMirFunction,
): void {
  const aliasesByPlaceIdKey = new Map<string, Set<string>>();
  const addPlaceAlias = (placeId: ProofMirPlaceId, aliasKey: string): void => {
    const key = resolverPlaceIdKey(functionGraph, placeId);
    const aliases = aliasesByPlaceIdKey.get(key) ?? new Set<string>();
    aliases.add(aliasKey);
    aliasesByPlaceIdKey.set(key, aliases);
  };

  for (const [placeKey, placeId] of buildPlaceKeyToMirPlaceIdIndex({
    functionGraph,
    functionInstanceId: functionGraph.functionInstanceId,
  }).entries()) {
    placeResolver.index.set(placeKey, placeId);
    addPlaceAlias(placeId, placeKey);
  }

  const placeIdsByShapeKey = new Map<string, ProofMirPlaceId[]>();
  const placeAliasesByShapeKey = new Map<string, Set<string>>();
  for (const place of functionGraph.places.entries()) {
    addPlaceAlias(place.placeId, placeKeyForMirPlace(place.placeId));
    const shapeKey = proofMirPlaceShapeKey({ functionGraph, placeId: place.placeId });
    if (shapeKey === undefined) {
      continue;
    }
    placeResolver.placeShapeKeyByPlaceId.set(
      resolverPlaceIdKey(functionGraph, place.placeId),
      shapeKey,
    );
    placeIdsByShapeKey.set(shapeKey, [...(placeIdsByShapeKey.get(shapeKey) ?? []), place.placeId]);
    const aliases = placeAliasesByShapeKey.get(shapeKey) ?? new Set<string>();
    for (const aliasKey of aliasesByPlaceIdKey.get(
      resolverPlaceIdKey(functionGraph, place.placeId),
    ) ?? []) {
      aliases.add(aliasKey);
    }
    placeAliasesByShapeKey.set(shapeKey, aliases);
  }

  for (const [shapeKey, placeIds] of placeIdsByShapeKey.entries()) {
    const canonicalPlaceKey = canonicalAliasForPlaceShape(
      placeAliasesByShapeKey.get(shapeKey) ?? [],
      placeIds[0]!,
    );
    const placeKeys = Object.freeze([canonicalPlaceKey]);
    for (const aliasKey of placeAliasesByShapeKey.get(shapeKey) ?? []) {
      placeResolver.canonicalPlaceKeyByPlaceKey.set(aliasKey, canonicalPlaceKey);
    }
    for (const placeId of placeIds) {
      placeResolver.equivalentPlaceKeysByPlaceId.set(
        resolverPlaceIdKey(functionGraph, placeId),
        placeKeys,
      );
    }
  }
}

export function canonicalProofCheckPlaceKey(
  placeKey: string,
  placeResolver?: ProofCheckPlaceResolver,
): string {
  return placeResolver?.canonicalPlaceKeyByPlaceKey.get(placeKey) ?? placeKey;
}

export function registerProofCheckPlaceAlias(input: {
  readonly placeResolver: ProofCheckPlaceResolver;
  readonly aliasKey: string;
  readonly placeId: ProofMirPlaceId;
  readonly targetPlaceKey?: string;
}): void {
  input.placeResolver.index.set(input.aliasKey, input.placeId);
  const targetPlaceKey = input.targetPlaceKey ?? placeKeyForMirPlace(input.placeId);
  input.placeResolver.canonicalPlaceKeyByPlaceKey.set(
    input.aliasKey,
    canonicalProofCheckPlaceKey(targetPlaceKey, input.placeResolver),
  );
}

export function equivalentProofMirPlaceKeys(input: {
  readonly functionGraph: ProofMirFunction | undefined;
  readonly placeId: ProofMirPlaceId;
  readonly placeResolver?: ProofCheckPlaceResolver;
}): readonly string[] {
  const functionGraph = input.functionGraph;
  if (functionGraph === undefined) {
    return [canonicalProofCheckPlaceKey(placeKeyForMirPlace(input.placeId), input.placeResolver)];
  }
  const resolverKey = resolverPlaceIdKey(functionGraph, input.placeId);
  const cached = input.placeResolver?.equivalentPlaceKeysByPlaceId.get(resolverKey);
  if (cached !== undefined) {
    return cached;
  }
  if (input.placeResolver !== undefined) {
    registerProofMirFunctionPlaces(input.placeResolver, functionGraph);
    return (
      input.placeResolver.equivalentPlaceKeysByPlaceId.get(resolverKey) ?? [
        canonicalProofCheckPlaceKey(placeKeyForMirPlace(input.placeId), input.placeResolver),
      ]
    );
  }
  return [placeKeyForMirPlace(input.placeId)];
}

function parseProofMirPlaceIdPrefix(placeKey: string): ProofMirPlaceId | undefined {
  const prefix = "proofMirPlace:";
  if (!placeKey.startsWith(prefix)) {
    return undefined;
  }
  const suffix = placeKey.slice(prefix.length);
  const separatorIndex = suffix.search(/[.:]/);
  const numericSuffix = separatorIndex >= 0 ? suffix.slice(0, separatorIndex) : suffix;
  const parsed = Number(numericSuffix);
  if (Number.isInteger(parsed) && parsed >= 0 && String(parsed) === numericSuffix) {
    return proofMirPlaceId(parsed);
  }
  return undefined;
}

export function tryResolveProofMirPlaceIdForPlaceKey(
  placeKey: string,
  placeResolver?: ProofCheckPlaceResolver,
): ProofMirPlaceId | undefined {
  const parsedPlaceId = parseProofMirPlaceIdPrefix(placeKey);
  if (parsedPlaceId !== undefined) {
    return parsedPlaceId;
  }
  return placeResolver?.index.get(placeKey);
}

export function proofMirPlaceIdForPlaceKey(
  placeKey: string,
  placeResolver?: ProofCheckPlaceResolver,
): ProofMirPlaceId {
  const resolvedPlaceId = tryResolveProofMirPlaceIdForPlaceKey(placeKey, placeResolver);
  if (resolvedPlaceId === undefined) {
    throw new RangeError(`missing Proof MIR place binding for place key ${placeKey}`);
  }
  return resolvedPlaceId;
}

export function tryResolveProofMirPlaceDependency(
  placeKey: string,
  placeResolver?: ProofCheckPlaceResolver,
): Extract<CheckedFactDependency, { kind: "proofMirPlace" }> | undefined {
  const resolvedPlaceId = tryResolveProofMirPlaceIdForPlaceKey(placeKey, placeResolver);
  if (resolvedPlaceId === undefined) {
    return undefined;
  }
  return { kind: "proofMirPlace", placeId: resolvedPlaceId };
}

export function placeStateForKey(
  state: ProofCheckState,
  placeKey: string,
  placeResolver?: ProofCheckPlaceResolver,
): CheckedPlaceState | undefined {
  return state.places.get(canonicalProofCheckPlaceKey(placeKey, placeResolver));
}

export function structuredPlace(placeId: ProofMirPlaceId): ProofCheckStructuredPlace {
  return { placeKey: placeKeyForMirPlace(placeId) };
}

export function defaultScope(): CheckedFactScope {
  return { kind: "wholeImage" };
}

export function originForOperation(originKey: string): CheckedOriginFact {
  return {
    originKey,
    proofMirOriginId: proofMirOriginId(stableNumericSeed(`origin:${originKey}`)),
  };
}

export function coreCertificate(
  context: ProofCheckRegistryContext,
  subjectKey: string,
  rule: ProofCheckCoreCertificate["rule"] = "coreEntailment",
): ProofCheckCoreCertificate {
  return {
    certificateId: context.certificateRegistry.allocateCoreCertificateId(subjectKey),
    rule,
    subjectKey,
    dependencyKeys: [],
  };
}

export function certificateIdForSubject(
  context: ProofCheckRegistryContext,
  subjectKey: string,
): ProofCheckCertificateId {
  return {
    kind: "core",
    id: coreCertificate(context, subjectKey).certificateId,
  };
}

export function recordCertificate(
  context: ProofCheckRegistryContext,
  certificate: ProofCheckCoreCertificate,
): ProofCheckCertificateId {
  const existing = context.coreCertificates.find(
    (entry) => String(entry.certificateId) === String(certificate.certificateId),
  );
  if (existing === undefined) {
    context.coreCertificates.push(certificate);
  }
  return { kind: "core", id: certificate.certificateId };
}

export function coreCertificateSideEffect(
  certificate: ProofCheckCoreCertificate,
): ProofCheckRegistrySideEffect {
  return { kind: "recordCoreCertificate", certificate };
}

export function recordLayoutEntailmentCertificates(
  context: ProofCheckRegistryContext,
  certificates: readonly LayoutEntailmentCertificate[],
): {
  readonly certificateIds: readonly ProofCheckCertificateId[];
  readonly certificates: readonly LayoutEntailmentCertificate[];
} {
  const certificateIds: ProofCheckCertificateId[] = [];
  const remappedCertificates: LayoutEntailmentCertificate[] = [];

  for (const certificate of certificates) {
    const registrySubjectKey = `layout:${certificate.certificate.subjectKey}`;
    const certificateId = context.certificateRegistry.allocateCoreCertificateId(registrySubjectKey);
    const remappedCoreCertificate: ProofCheckCoreCertificate = {
      ...certificate.certificate,
      certificateId,
    };
    if (
      !context.coreCertificates.some(
        (entry) => String(entry.certificateId) === String(remappedCoreCertificate.certificateId),
      )
    ) {
      context.coreCertificates.push(remappedCoreCertificate);
    }
    certificateIds.push({ kind: "core", id: certificateId });
    remappedCertificates.push({
      ...certificate,
      certificate: remappedCoreCertificate,
    });
  }

  return { certificateIds, certificates: remappedCertificates };
}

export function firstOwnedPlaceForCrossCoreTransfer(
  state: ProofCheckState,
): ProofCheckStructuredPlace | undefined {
  const ownedPlaces = [...state.places.values()].sort((left, right) =>
    compareCodeUnitStrings(left.placeKey, right.placeKey),
  );
  const ownedPlace = ownedPlaces.find((place) => place.lifecycle === "owned");
  if (ownedPlace === undefined) {
    return undefined;
  }
  return { placeKey: ownedPlace.placeKey };
}

export function errorTransition(
  diagnostics: readonly ProofCheckDiagnostic[],
): ProofCheckTransitionResult {
  return {
    kind: "error",
    diagnostics: sortProofCheckDiagnostics(diagnostics),
  };
}

function recordCoreCertificateIfAbsent(
  context: ProofCheckRegistryContext,
  certificateId: ProofCheckCoreCertificate["certificateId"],
  subjectKey: string,
  rule: ProofCheckCoreCertificate["rule"] = "coreEntailment",
): void {
  if (
    context.coreCertificates.some((entry) => String(entry.certificateId) === String(certificateId))
  ) {
    return;
  }
  context.coreCertificates.push({
    certificateId,
    rule,
    subjectKey,
    dependencyKeys: [],
  });
}

export function normalizeCoreCertificateId(
  context: ProofCheckRegistryContext,
  certificate: ProofCheckCertificateId,
  subjectKey: string,
  rule: ProofCheckCoreCertificateRule = "coreEntailment",
): ProofCheckCertificateId {
  if (certificate.kind !== "core") {
    return certificate;
  }

  const existingWithSameId = context.coreCertificates.find(
    (entry) => String(entry.certificateId) === String(certificate.id),
  );
  if (
    existingWithSameId !== undefined &&
    existingWithSameId.subjectKey === subjectKey &&
    existingWithSameId.rule === rule
  ) {
    return certificate;
  }

  const registryId = context.certificateRegistry.allocateCoreCertificateId(subjectKey);
  recordCoreCertificateIfAbsent(context, registryId, subjectKey, rule);
  return { kind: "core", id: registryId };
}

export function normalizeCoreCertificateIds(
  context: ProofCheckRegistryContext,
  certificates: readonly ProofCheckCertificateId[],
  subjectKey: string,
): {
  readonly certificates: readonly ProofCheckCertificateId[];
  readonly coreCertificateIdRemap: ReadonlyMap<string, ProofCheckCoreCertificateId>;
} {
  const coreCertificateIdRemap = new Map<string, ProofCheckCoreCertificateId>();
  const normalized = certificates.map((certificate, index) => {
    const normalizedCertificate = normalizeCoreCertificateId(
      context,
      certificate,
      `${subjectKey}:cert:${index}`,
    );
    if (certificate.kind === "core" && normalizedCertificate.kind === "core") {
      coreCertificateIdRemap.set(String(certificate.id), normalizedCertificate.id);
    }
    return normalizedCertificate;
  });
  return { certificates: normalized, coreCertificateIdRemap };
}

function packetEntryCertificateRegistrySubjectKey(
  entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>,
  ownerKey: string,
  index: number,
): string {
  const subjectKey = checkedFactSubjectKey(entry.subject);
  if (subjectKey.length > 0) {
    return subjectKey;
  }
  return `${ownerKey}:packet:${index}`;
}

function packetEntryCoreCertificateRule(
  entry: CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>,
): ProofCheckCoreCertificateRule {
  switch (entry.kind as CheckedPacketFactKind) {
    case "ownership":
    case "privateState":
      return "ownershipTransfer";
    case "noalias":
    case "fieldDisjointness":
      return "loanDisjointness";
    case "erasure":
      return "erasure";
    case "validatedBuffer":
    case "layoutAbi":
      return "layoutReadRequirement";
    case "packetSource":
      return "packetSource";
    case "terminalClosure":
    case "exitClosure":
      return "exitClosure";
    case "platformEffect":
    case "capabilityFlow":
    case "extension":
    case "origin":
      return "coreEntailment";
  }
}

function remapPacketEntryCoreCertificates(
  context: ProofCheckRegistryContext,
  entries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[],
  coreCertificateIdRemap: ReadonlyMap<string, ProofCheckCoreCertificateId>,
  ownerKey: string,
): readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[] {
  return entries.map((entry, index) => {
    const registrySubjectKey = packetEntryCertificateRegistrySubjectKey(entry, ownerKey, index);
    const existingCoreCertificate =
      entry.certificate.kind === "core"
        ? context.coreCertificates.find(
            (certificate) => String(certificate.certificateId) === String(entry.certificate.id),
          )
        : undefined;
    const certificate =
      existingCoreCertificate !== undefined &&
      certificateProvesSubject(entry, existingCoreCertificate)
        ? entry.certificate
        : normalizeCoreCertificateId(
            context,
            entry.certificate,
            registrySubjectKey,
            packetEntryCoreCertificateRule(entry),
          );
    const dependencies = remapCoreCertificateDependencies({
      dependencies: entry.dependencies,
      originalCertificate: entry.certificate,
      normalizedCertificate: certificate,
      coreCertificateIdRemap,
    });
    if (entry.certificate === certificate && dependencies === entry.dependencies) {
      return entry;
    }
    return {
      ...entry,
      certificate,
      dependencies,
    };
  });
}

function remapCoreCertificateDependencies(input: {
  readonly dependencies: readonly CheckedFactDependency[];
  readonly originalCertificate: ProofCheckCertificateId;
  readonly normalizedCertificate: ProofCheckCertificateId;
  readonly coreCertificateIdRemap: ReadonlyMap<string, ProofCheckCoreCertificateId>;
}): readonly CheckedFactDependency[] {
  let changed = false;
  const dependencies = input.dependencies.map((dependency) => {
    if (dependency.kind !== "coreCertificate") {
      return dependency;
    }
    const remappedByPacketCertificate =
      input.originalCertificate.kind === "core" &&
      input.normalizedCertificate.kind === "core" &&
      String(dependency.certificateId) === String(input.originalCertificate.id)
        ? input.normalizedCertificate.id
        : undefined;
    const remappedByTransition =
      remappedByPacketCertificate === undefined
        ? input.coreCertificateIdRemap.get(String(dependency.certificateId))
        : undefined;
    const nextCertificateId = remappedByTransition ?? remappedByPacketCertificate;
    if (
      nextCertificateId === undefined ||
      String(nextCertificateId) === String(dependency.certificateId)
    ) {
      return dependency;
    }
    changed = true;
    return { ...dependency, certificateId: nextCertificateId };
  });
  return changed ? dependencies : input.dependencies;
}

export function ensureCoreCertificatesRecorded(
  context: ProofCheckRegistryContext,
  certificates: readonly ProofCheckCertificateId[],
  subjectKey: string,
): void {
  normalizeCoreCertificateIds(context, certificates, subjectKey);
}

export function okCoreTransition(input: {
  readonly transition: ProofCheckTransition;
  readonly context?: ProofCheckRegistryContext;
  readonly patches: readonly ProofCheckStatePatchEntry[];
  readonly certificates: readonly ProofCheckCertificateId[];
  readonly packetEntries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
  readonly stagedOrigins?: readonly CheckedOriginFact[];
  readonly registryEffects?: readonly ProofCheckRegistrySideEffect[];
  readonly patchKind?: "coreTransfer";
}): ProofCheckTransitionResult {
  const ownerKey = proofCheckProgramPointKey(input.transition.location);
  let certificates = input.certificates;
  let packetEntries = input.packetEntries;
  if (input.context !== undefined) {
    const normalized = normalizeCoreCertificateIds(input.context, certificates, ownerKey);
    certificates = normalized.certificates;
    packetEntries = remapPacketEntryCoreCertificates(
      input.context,
      packetEntries,
      normalized.coreCertificateIdRemap,
      ownerKey,
    );
  }
  const certificate =
    certificates[0] ??
    (input.context === undefined
      ? { kind: "core" as const, id: proofCheckCoreCertificateId(1) }
      : certificateIdForSubject(input.context, ownerKey));
  return {
    kind: "ok",
    patch: {
      kind: input.patchKind ?? "coreTransfer",
      transitionId: input.transition.transitionId,
      certificate,
      entries: [...input.patches],
    },
    certificates: [...certificates],
    packetEntries: [...packetEntries],
    ...(input.stagedOrigins !== undefined ? { stagedOrigins: [...input.stagedOrigins] } : {}),
    ...(input.registryEffects !== undefined && input.registryEffects.length > 0
      ? { registryEffects: [...input.registryEffects] }
      : {}),
    diagnostics: [],
  };
}

export function withRegistryEffects(
  result: ProofCheckTransitionResult,
  effects: readonly ProofCheckRegistrySideEffect[],
): ProofCheckTransitionResult {
  if (result.kind === "error" || effects.length === 0) {
    return result;
  }
  return {
    ...result,
    registryEffects: [...(result.registryEffects ?? []), ...effects],
  };
}

export function exitStateSideEffect(state: ProofCheckState): ProofCheckRegistrySideEffect {
  return { kind: "recordExitState", state };
}

export function exitCertificateSideEffect(
  certificate: ProofCheckCertificateId,
): ProofCheckRegistrySideEffect {
  return { kind: "recordExitCertificate", certificate };
}

export function entryStateCertificateSideEffect(
  certificate: ProofCheckCertificateId,
): ProofCheckRegistrySideEffect {
  return { kind: "recordEntryStateCertificate", certificate };
}

export function summaryPlaceEffectSideEffect(
  effect: Parameters<typeof recordSummaryPlaceEffect>[1],
): ProofCheckRegistrySideEffect {
  return { kind: "recordSummaryPlaceEffect", effect };
}

export function identityTransition(
  transition: ProofCheckTransition,
  context?: ProofCheckRegistryContext,
): ProofCheckTransitionResult {
  const ownerKey = proofCheckProgramPointKey(transition.location);
  const certificate =
    context === undefined
      ? { kind: "core" as const, id: proofCheckCoreCertificateId(1) }
      : certificateIdForSubject(context, ownerKey);
  return okCoreTransition({
    transition,
    context,
    patches: [],
    certificates: [certificate],
    packetEntries: [],
  });
}

export function ownershipTransition(
  transition: ProofCheckTransition,
  context: ProofCheckRegistryContext,
  result: ProofCheckOwnershipTransferResult,
  effect?: Parameters<typeof recordSummaryPlaceEffect>[1],
): ProofCheckTransitionResult {
  if (result.kind === "error") {
    return errorTransition(result.diagnostics);
  }
  const registryEffects: ProofCheckRegistrySideEffect[] = [];
  if (effect !== undefined) {
    registryEffects.push(summaryPlaceEffectSideEffect(effect));
  }
  return okCoreTransition({
    transition,
    context,
    patches: result.patches,
    certificates: result.certificates,
    packetEntries: result.packetEntries,
    ...(registryEffects.length > 0 ? { registryEffects } : {}),
  });
}

export function patchTransition(
  transition: ProofCheckTransition,
  context: ProofCheckRegistryContext,
  result:
    | ValidationTransferResult
    | AttemptTransferResult
    | LocalTerminalExitResult
    | TakeSessionTransferResult
    | {
        readonly kind: "ok";
        readonly patches: readonly ProofCheckStatePatchEntry[];
        readonly packetEntries?: readonly CheckedFactPacketEntry<
          CheckedFactKindId,
          CheckedFactSubject
        >[];
        readonly certificates?: readonly ProofCheckCertificateId[];
      },
): ProofCheckTransitionResult {
  if (result.kind === "error") {
    return errorTransition(result.diagnostics);
  }
  const certificates =
    "certificates" in result && result.certificates !== undefined
      ? result.certificates
      : [certificateIdForSubject(context, proofCheckProgramPointKey(transition.location))];
  return okCoreTransition({
    transition,
    context,
    patches: result.patches,
    certificates,
    packetEntries: "packetEntries" in result ? (result.packetEntries ?? []) : [],
  });
}

export function extensionTransition(
  transition: ProofCheckTransition,
  context: ProofCheckRegistryContext,
  result: Extract<ProofCheckTransitionResult, { readonly kind: "ok" }>,
): ProofCheckTransitionResult {
  const ownerKey = proofCheckProgramPointKey(transition.location);
  const normalized = normalizeCoreCertificateIds(context, result.certificates, ownerKey);
  const packetEntries = remapPacketEntryCoreCertificates(
    context,
    result.packetEntries,
    normalized.coreCertificateIdRemap,
    ownerKey,
  );
  return {
    ...result,
    certificates: [...normalized.certificates],
    packetEntries: [...packetEntries],
  };
}

export function takeSessionTransition(
  transition: ProofCheckTransition,
  context: ProofCheckRegistryContext,
  result: TakeSessionTransferResult,
): ProofCheckTransitionResult {
  return patchTransition(transition, context, result);
}

export function missingMirMetadataTransition(
  transition: ProofCheckTransition,
  detail: string,
): ProofCheckTransitionResult {
  const ownerKey = proofCheckProgramPointKey(transition.location);
  return errorTransition([
    proofCheckDiagnostic({
      severity: "error",
      code: "PROOF_CHECK_INPUT_CONTRACT_INVALID",
      messageTemplateId: "proof-check.mir-metadata.missing",
      messageArguments: [{ kind: "text", value: detail }],
      message: detail,
      ownerKey,
      rootCauseKey: ownerKey,
      stableDetail: detail,
      functionInstanceId: transition.functionInstanceId,
    }),
  ]);
}

export function resolveValidationContextForTransition(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly validationId: Parameters<typeof resolveValidationContextForBlock>[0]["validationId"];
  readonly edge?: ProofMirControlEdge;
}) {
  const functionGraph = resolveFunctionGraph(
    input.context.input.mir,
    input.transition.functionInstanceId,
  );
  if (functionGraph === undefined) {
    return undefined;
  }
  if (input.edge !== undefined) {
    return resolveValidationContextForEdge({
      functionGraph,
      edge: input.edge,
      validationId: input.validationId,
    });
  }
  if (input.transition.location.kind === "terminator") {
    return resolveValidationContextForBlock({
      functionGraph,
      blockId: input.transition.location.blockId,
      validationId: input.validationId,
    });
  }
  return undefined;
}

export function resolveAttemptContextForTransition(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly attemptId: Parameters<typeof resolveAttemptContextForBlock>[0]["attemptId"];
  readonly edge?: ProofMirControlEdge;
}) {
  const functionGraph = resolveFunctionGraph(
    input.context.input.mir,
    input.transition.functionInstanceId,
  );
  if (functionGraph === undefined) {
    return undefined;
  }
  if (input.edge !== undefined) {
    return resolveAttemptContextForEdge({
      functionGraph,
      edge: input.edge,
      attemptId: input.attemptId,
    });
  }
  if (input.transition.location.kind === "terminator") {
    return resolveAttemptContextForBlock({
      functionGraph,
      blockId: input.transition.location.blockId,
      attemptId: input.attemptId,
    });
  }
  return undefined;
}

export function handleTakeSessionStatement(input: {
  readonly transition: ProofCheckTransition;
  readonly context: ProofCheckRegistryContext;
  readonly transfer: TakeSessionTransferResult | undefined;
  readonly missingDetail: string;
}): ProofCheckTransitionResult {
  if (input.transfer === undefined) {
    return missingMirMetadataTransition(input.transition, input.missingDetail);
  }
  return takeSessionTransition(input.transition, input.context, input.transfer);
}

export function exitClosurePacketEntry(
  context: ProofCheckRegistryContext,
  input: {
    readonly operationOriginKey: string;
    readonly emptyExitStateKey: string;
    readonly certificate: ProofCheckCertificateId;
  },
): CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject> {
  const subjectKey = `exit:${input.emptyExitStateKey}`;
  return {
    factId: context.certificateRegistry.allocatePacketFactId(subjectKey),
    kind: "exitClosure" as CheckedFactKindId,
    subject: { kind: "place", placeId: proofMirPlaceId(stableNumericSeed(subjectKey)) },
    scope: defaultScope(),
    dependencies: [],
    invalidatedBy: [],
    certificate: input.certificate,
    origin: originForOperation(input.operationOriginKey),
  };
}

export function resolveFunctionGraph(
  mir: ProofMirProgram,
  functionInstanceId: MonoInstanceId,
): ProofMirFunction | undefined {
  return mir.functions.get(functionInstanceId);
}

export function resolveExitEdge(
  functionGraph: ProofMirFunction,
  exitId: ProofMirExitEdgeId,
): ProofMirExitEdge | undefined {
  return functionGraph.exits.find((exit) => exit.exitId === exitId);
}

export function terminalReachabilityRequired(closure: ProofMirExitClosurePolicy): boolean {
  return closure.kind === "functionExit" && closure.terminalReachability === "required";
}

export function validationIdFromEdgeSourceBlock(
  functionGraph: ProofMirFunction,
  edge: ProofMirControlEdge,
) {
  const block = functionGraph.blocks.get(edge.fromBlockId);
  if (block === undefined || block.terminator.kind.kind !== "matchValidation") {
    return undefined;
  }
  return block.terminator.kind.match.validationId;
}

export function attemptIdFromEdgeSourceBlock(
  functionGraph: ProofMirFunction,
  edge: ProofMirControlEdge,
) {
  const block = functionGraph.blocks.get(edge.fromBlockId);
  if (block === undefined || block.terminator.kind.kind !== "matchAttempt") {
    return undefined;
  }
  return block.terminator.kind.match.attemptId;
}
