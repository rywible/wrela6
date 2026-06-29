import type { MonoInstanceId } from "../../mono/ids";
import {
  proofAuthorityFingerprintsEqual,
  type ProofAuthorityFingerprint,
} from "../../shared/proof-authority-types";
import type { OptIrCallTarget } from "../calls";
import {
  optIrDiagnosticCode,
  optIrDiagnosticOrderKey,
  sortOptIrDiagnostics,
  type OptIrDiagnostic,
} from "../diagnostics";
import type { OptIrEffectRequirement } from "../effects";
import type {
  OptIrCallId,
  OptIrOperationId,
  OptIrOriginId,
  OptIrValueId,
  OptIrAliasClassId,
} from "../ids";
import {
  optIrPlatformCallOperation,
  optIrRuntimeCallOperation,
  optIrSourceCallOperation,
  type OptIrOperation,
} from "../operations";
import type { OptIrTargetEffectDescription, OptIrTargetSurface } from "../target-surface";
import type { OptIrTerminator } from "../terminators";
import type { OptIrType } from "../types";
import type { OptIrRegionEntry, OptIrRegionTable } from "./region-builder";

export interface OptIrCallSummary {
  readonly summaryId: string;
  readonly parameters: readonly string[];
  readonly resultCount: number;
}

export interface OptIrCallAbiValue {
  readonly valueId?: OptIrValueId;
  readonly resultId?: OptIrValueId;
  readonly classification: string;
}

export interface OptIrCallAbiShape {
  readonly callingConvention: string;
  readonly parameters: readonly OptIrCallAbiValue[];
  readonly results: readonly OptIrCallAbiValue[];
}

export type OptIrCallTerminalBehavior =
  | { readonly kind: "returns" }
  | { readonly kind: "terminal"; readonly terminalKey: string };

export interface OptIrCallResultFactHook {
  readonly resultId: OptIrValueId;
  readonly factKey: string;
}

export interface OptIrLoweredCallEffects {
  readonly requirements: readonly OptIrEffectRequirement[];
  readonly priorObservableEffects: readonly OptIrEffectRequirement[];
  readonly observedRegions: readonly OptIrAliasClassId[];
  readonly mutatedRegions: readonly OptIrAliasClassId[];
  readonly readVersionRegions: readonly string[];
  readonly orderedRegions: readonly string[];
  readonly privateStateKeys: readonly string[];
  readonly terminalKeys: readonly string[];
}

export interface OptIrLoweredCallHeader {
  readonly callId: OptIrCallId;
  readonly target: OptIrCallTarget;
  readonly calleeId?: MonoInstanceId;
  readonly summary: OptIrCallSummary;
  readonly abiShape: OptIrCallAbiShape;
  readonly effects: OptIrLoweredCallEffects;
  readonly terminalBehavior: OptIrCallTerminalBehavior;
  readonly resultFactHooks: readonly OptIrCallResultFactHook[];
  readonly authority?: ProofAuthorityFingerprint;
}

export interface OptIrLoweredCall {
  readonly operation: OptIrOperation;
  readonly header: OptIrLoweredCallHeader;
  readonly terminator?: OptIrTerminator;
}

export type OptIrCallLoweringResult =
  | { readonly kind: "ok"; readonly call: OptIrLoweredCall }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] };

interface CommonCallInput {
  readonly operationId: OptIrOperationId;
  readonly callId: OptIrCallId;
  readonly originId: OptIrOriginId;
  readonly argumentIds: readonly OptIrValueId[];
  readonly resultIds: readonly OptIrValueId[];
  readonly resultTypes: readonly OptIrType[];
  readonly abiShape?: OptIrCallAbiShape;
  readonly summary?: OptIrCallSummary;
  readonly requirements?: readonly OptIrEffectRequirement[];
  readonly priorObservableEffects?: readonly OptIrEffectRequirement[];
  readonly resultFactHooks?: readonly OptIrCallResultFactHook[];
  readonly callbackCapable?: boolean;
  readonly conservativeRegions?: OptIrRegionTable;
}

export interface LowerSourceCallForTestInput extends CommonCallInput {
  readonly calleeId: MonoInstanceId;
  readonly summary: OptIrCallSummary;
  readonly effectSummary: { readonly requirements: readonly OptIrEffectRequirement[] };
  readonly terminalBehavior: OptIrCallTerminalBehavior;
}

export interface LowerRuntimeCallForTestInput extends CommonCallInput {
  readonly runtimeKey: string;
  readonly targetSurface?: OptIrTargetSurface;
  readonly expectedAuthority?: ProofAuthorityFingerprint;
}

export interface LowerPlatformCallForTestInput extends CommonCallInput {
  readonly targetKey: string;
  readonly targetSurface?: OptIrTargetSurface;
  readonly expectedAuthority?: ProofAuthorityFingerprint;
}

function defaultSummary(resultCount: number, summaryId: string): OptIrCallSummary {
  return { summaryId, parameters: [], resultCount };
}

function defaultAbiShape(): OptIrCallAbiShape {
  return { callingConvention: "unknown", parameters: [], results: [] };
}

function freezeEffects(input: {
  readonly requirements: readonly OptIrEffectRequirement[];
  readonly priorObservableEffects?: readonly OptIrEffectRequirement[];
}): OptIrLoweredCallEffects {
  const requirements = Object.freeze([...input.requirements]);
  return Object.freeze({
    requirements,
    priorObservableEffects: Object.freeze([...(input.priorObservableEffects ?? [])]),
    observedRegions: Object.freeze(
      requirements
        .filter((requirement) => requirement.mode === "observe")
        .map((requirement) => requirement.region),
    ),
    mutatedRegions: Object.freeze(
      requirements
        .filter((requirement) => requirement.mode === "mutate")
        .map((requirement) => requirement.region),
    ),
    readVersionRegions: Object.freeze(
      requirements
        .filter((requirement) => requirement.mode === "readVersionToken")
        .map((requirement) => requirement.tokenKey),
    ),
    orderedRegions: Object.freeze(
      requirements
        .filter((requirement) => requirement.mode === "orderedEffectToken")
        .map((requirement) => requirement.tokenKey),
    ),
    privateStateKeys: Object.freeze(
      requirements
        .filter((requirement) => requirement.mode === "advancePrivateState")
        .map((requirement) => requirement.stateKey),
    ),
    terminalKeys: Object.freeze(
      requirements
        .filter((requirement) => requirement.mode === "terminal")
        .map((requirement) => requirement.terminalKey),
    ),
  });
}

function terminalBehaviorForRequirements(
  requirements: readonly OptIrEffectRequirement[],
): OptIrCallTerminalBehavior {
  const terminal = requirements.find((requirement) => requirement.mode === "terminal");
  return terminal === undefined
    ? { kind: "returns" }
    : { kind: "terminal", terminalKey: terminal.terminalKey };
}

function terminalFor(
  operationId: OptIrOperationId,
  originId: OptIrOriginId,
  terminalBehavior: OptIrCallTerminalBehavior,
): OptIrTerminator | undefined {
  return terminalBehavior.kind === "terminal"
    ? { kind: "unreachable", operationId, originId }
    : undefined;
}

function dedupeRequirements(
  requirements: readonly OptIrEffectRequirement[],
): readonly OptIrEffectRequirement[] {
  const seen = new Set<string>();
  const result: OptIrEffectRequirement[] = [];
  for (const requirement of requirements) {
    const key = effectRequirementKey(requirement);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(requirement);
  }
  return Object.freeze(result);
}

function effectRequirementKey(requirement: OptIrEffectRequirement): string {
  switch (requirement.mode) {
    case "observe":
    case "mutate":
      return `${requirement.mode}:${requirement.region}`;
    case "advancePrivateState":
      return `advancePrivateState:${requirement.stateKey}`;
    case "terminal":
      return `terminal:${requirement.terminalKey}`;
    case "readVersionToken":
      return `readVersionToken:${requirement.tokenKey}`;
    case "orderedEffectToken":
      return `orderedEffectToken:${requirement.tokenKey}`;
  }
}

function conservativeRequirements(input: CommonCallInput): readonly OptIrEffectRequirement[] {
  if (input.callbackCapable !== true || input.conservativeRegions === undefined) {
    return [];
  }
  const requirements: OptIrEffectRequirement[] = [];
  const external = input.conservativeRegions.externalUnknown();
  if (external !== undefined) {
    requirements.push({ mode: "mutate", region: external.aliasClass });
    requirements.push({ mode: "orderedEffectToken", tokenKey: "external:unknown" });
  }
  for (const entry of input.conservativeRegions.regionEntries().filter(isEscapedRegion)) {
    requirements.push({ mode: "mutate", region: entry.region.aliasClass });
    requirements.push({
      mode: "orderedEffectToken",
      tokenKey: `escaped:${entry.region.kind}:${entry.key}`,
    });
  }
  return dedupeRequirements(requirements);
}

function isEscapedRegion(entry: OptIrRegionEntry): boolean {
  return entry.escaped && entry.region.kind !== "externalUnknown";
}

function callHeader(input: {
  readonly common: CommonCallInput;
  readonly target: OptIrCallTarget;
  readonly summary: OptIrCallSummary;
  readonly requirements: readonly OptIrEffectRequirement[];
  readonly terminalBehavior: OptIrCallTerminalBehavior;
  readonly authority?: ProofAuthorityFingerprint;
  readonly calleeId?: MonoInstanceId;
}): OptIrLoweredCallHeader {
  return Object.freeze({
    callId: input.common.callId,
    target: input.target,
    ...(input.calleeId !== undefined && { calleeId: input.calleeId }),
    summary: Object.freeze(input.summary),
    abiShape: Object.freeze(input.common.abiShape ?? defaultAbiShape()),
    effects: freezeEffects({
      requirements: dedupeRequirements([
        ...input.requirements,
        ...conservativeRequirements(input.common),
      ]),
      priorObservableEffects: input.common.priorObservableEffects,
    }),
    terminalBehavior: input.terminalBehavior,
    resultFactHooks: Object.freeze([...(input.common.resultFactHooks ?? [])]),
    ...(input.authority !== undefined && { authority: input.authority }),
  });
}

export function lowerSourceCallForTest(input: LowerSourceCallForTestInput): OptIrLoweredCall {
  const target: OptIrCallTarget = {
    kind: "source",
    functionInstanceId: input.calleeId,
  };
  const operation = optIrSourceCallOperation({
    operationId: input.operationId,
    callId: input.callId,
    target,
    argumentIds: input.argumentIds,
    resultIds: input.resultIds,
    resultTypes: input.resultTypes,
    originId: input.originId,
  });
  const header = callHeader({
    common: input,
    target,
    calleeId: input.calleeId,
    summary: input.summary,
    requirements: input.effectSummary.requirements,
    terminalBehavior: input.terminalBehavior,
  });
  const terminator = terminalFor(input.operationId, input.originId, input.terminalBehavior);
  return Object.freeze({
    operation,
    header,
    ...(terminator === undefined ? {} : { terminator }),
  });
}

export function lowerRuntimeCallForTest(
  input: LowerRuntimeCallForTestInput,
): OptIrCallLoweringResult {
  const resolved = resolveCatalogEffect({
    catalog: input.targetSurface?.runtimeEffects,
    key: input.runtimeKey,
    expectedAuthority: input.expectedAuthority,
    originId: input.originId,
    operationId: input.operationId,
    authorityKind: "runtime",
  });
  if (resolved.kind === "error") {
    return resolved;
  }
  const target: OptIrCallTarget = { kind: "runtime", runtimeKey: input.runtimeKey };
  const requirements = input.requirements ?? resolved.effect?.requirements ?? [];
  const terminalBehavior = terminalBehaviorForRequirements(requirements);
  const operation = optIrRuntimeCallOperation({
    operationId: input.operationId,
    callId: input.callId,
    target,
    argumentIds: input.argumentIds,
    resultIds: input.resultIds,
    resultTypes: input.resultTypes,
    originId: input.originId,
  });
  const terminator = terminalFor(input.operationId, input.originId, terminalBehavior);
  return {
    kind: "ok",
    call: Object.freeze({
      operation,
      header: callHeader({
        common: input,
        target,
        summary: input.summary ?? defaultSummary(input.resultIds.length, input.runtimeKey),
        requirements,
        terminalBehavior,
        authority: resolved.authority,
      }),
      ...(terminator === undefined ? {} : { terminator }),
    }),
  };
}

export function lowerPlatformCallForTest(
  input: LowerPlatformCallForTestInput,
): OptIrCallLoweringResult {
  const resolved = resolveCatalogEffect({
    catalog: input.targetSurface?.platformEffects,
    key: input.targetKey,
    expectedAuthority: input.expectedAuthority,
    originId: input.originId,
    operationId: input.operationId,
    authorityKind: "platform",
  });
  if (resolved.kind === "error") {
    return resolved;
  }
  const target: OptIrCallTarget = { kind: "platform", platformKey: input.targetKey };
  const requirements = input.requirements ?? resolved.effect?.requirements ?? [];
  const terminalBehavior = terminalBehaviorForRequirements(requirements);
  const operation = optIrPlatformCallOperation({
    operationId: input.operationId,
    callId: input.callId,
    target,
    argumentIds: input.argumentIds,
    resultIds: input.resultIds,
    resultTypes: input.resultTypes,
    originId: input.originId,
  });
  const terminator = terminalFor(input.operationId, input.originId, terminalBehavior);
  return {
    kind: "ok",
    call: Object.freeze({
      operation,
      header: callHeader({
        common: input,
        target,
        summary: input.summary ?? defaultSummary(input.resultIds.length, input.targetKey),
        requirements,
        terminalBehavior,
        authority: resolved.authority,
      }),
      ...(terminator === undefined ? {} : { terminator }),
    }),
  };
}

function resolveCatalogEffect(input: {
  readonly catalog:
    | {
        readonly fingerprint: ProofAuthorityFingerprint;
        readonly resolve: (effectKey: string) => OptIrTargetEffectDescription | undefined;
      }
    | undefined;
  readonly key: string;
  readonly expectedAuthority: ProofAuthorityFingerprint | undefined;
  readonly originId: OptIrOriginId;
  readonly operationId: OptIrOperationId;
  readonly authorityKind: "runtime" | "platform";
}):
  | {
      readonly kind: "ok";
      readonly authority?: ProofAuthorityFingerprint;
      readonly effect?: OptIrTargetEffectDescription;
    }
  | { readonly kind: "error"; readonly diagnostics: readonly OptIrDiagnostic[] } {
  if (input.catalog === undefined) {
    return { kind: "ok" };
  }
  if (!proofAuthorityFingerprintsEqual(input.catalog.fingerprint, input.expectedAuthority)) {
    return {
      kind: "error",
      diagnostics: sortOptIrDiagnostics([
        diagnostic({
          code: "OPT_IR_TARGET_MISMATCH",
          message: "Call target catalog fingerprint does not match the checked authority.",
          stableDetail: `${input.authorityKind}:${input.key}:fingerprint-mismatch`,
          operationId: input.operationId,
          originId: input.originId,
        }),
      ]),
    };
  }
  const effect = input.catalog.resolve(input.key);
  if (effect === undefined) {
    return {
      kind: "error",
      diagnostics: sortOptIrDiagnostics([
        diagnostic({
          code: "OPT_IR_INPUT_CONTRACT_INVALID",
          message: "Call target was not present in the selected target effect catalog.",
          stableDetail: `${input.authorityKind}:${input.key}:missing-effect`,
          operationId: input.operationId,
          originId: input.originId,
        }),
      ]),
    };
  }
  return { kind: "ok", authority: input.catalog.fingerprint, effect };
}

function diagnostic(input: {
  readonly code: string;
  readonly message: string;
  readonly stableDetail: string;
  readonly operationId: OptIrOperationId;
  readonly originId: OptIrOriginId;
}): OptIrDiagnostic {
  const code = optIrDiagnosticCode(input.code);
  const ownerKey = `operation:${input.operationId}`;
  const rootCauseKey = input.stableDetail;
  return {
    severity: "error",
    code,
    messageTemplate: input.message,
    arguments: { operationId: input.operationId },
    ownerKey,
    rootCauseKey,
    stableDetail: input.stableDetail,
    originId: input.originId,
    orderKey: optIrDiagnosticOrderKey({
      originKey: String(input.originId),
      functionKey: "",
      code,
      ownerKey,
      rootCauseKey,
      stableDetail: input.stableDetail,
    }),
  };
}
