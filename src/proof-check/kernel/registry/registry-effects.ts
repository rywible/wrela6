import type { MonoInstanceId } from "../../../mono/ids";
import type { ProofCheckCoreCertificate } from "../../model/certificates";
import type { CheckedFunctionSummary } from "../../model/function-summary";
import type { ProofCheckCertificateId } from "../../model/certificates";
import {
  emptySummaryPlaceEffectAccumulator,
  recordSummaryPlaceEffect,
  type ProofCheckSummaryPlaceEffectAccumulator,
} from "../../domains/summary-input";
import type { ProofCheckState } from "../state";

export interface ProofCheckFunctionRegistryArtifacts {
  readonly exitStates: readonly ProofCheckState[];
  readonly entryStateCertificate: ProofCheckCertificateId | undefined;
  readonly exitCertificates: readonly ProofCheckCertificateId[];
  readonly summaryPlaceEffects: ProofCheckSummaryPlaceEffectAccumulator;
  readonly coreCertificates: readonly ProofCheckCoreCertificate[];
}

export interface ProofCheckFunctionRegistryArtifactsMutable {
  exitStates: ProofCheckState[];
  entryStateCertificate: ProofCheckCertificateId | undefined;
  exitCertificates: ProofCheckCertificateId[];
  summaryPlaceEffects: ProofCheckSummaryPlaceEffectAccumulator;
  coreCertificates: ProofCheckCoreCertificate[];
}

export function createProofCheckFunctionRegistryArtifacts(): ProofCheckFunctionRegistryArtifactsMutable {
  return {
    exitStates: [],
    entryStateCertificate: undefined,
    exitCertificates: [],
    summaryPlaceEffects: emptySummaryPlaceEffectAccumulator(),
    coreCertificates: [],
  };
}

export function finalizeProofCheckFunctionRegistryArtifacts(
  artifacts: ProofCheckFunctionRegistryArtifactsMutable,
): ProofCheckFunctionRegistryArtifacts {
  return {
    exitStates: [...artifacts.exitStates],
    entryStateCertificate: artifacts.entryStateCertificate,
    exitCertificates: [...artifacts.exitCertificates],
    summaryPlaceEffects: artifacts.summaryPlaceEffects,
    coreCertificates: [...artifacts.coreCertificates],
  };
}

export type ProofCheckRegistrySideEffect =
  | { readonly kind: "recordExitState"; readonly state: ProofCheckState }
  | { readonly kind: "recordExitCertificate"; readonly certificate: ProofCheckCertificateId }
  | { readonly kind: "recordEntryStateCertificate"; readonly certificate: ProofCheckCertificateId }
  | {
      readonly kind: "recordSummaryPlaceEffect";
      readonly effect: Parameters<typeof recordSummaryPlaceEffect>[1];
    }
  | { readonly kind: "recordCoreCertificate"; readonly certificate: ProofCheckCoreCertificate };

export interface ProofCheckRegistryAccumulator {
  readonly summaries: Map<MonoInstanceId, CheckedFunctionSummary>;
  readonly exitStatesByFunction: Map<MonoInstanceId, ProofCheckState[]>;
  readonly entryStateCertificates: Map<MonoInstanceId, ProofCheckCertificateId>;
  readonly exitCertificatesByFunction: Map<MonoInstanceId, ProofCheckCertificateId[]>;
  readonly summaryPlaceEffectsByFunction: Map<
    MonoInstanceId,
    ProofCheckSummaryPlaceEffectAccumulator
  >;
  readonly coreCertificates: ProofCheckCoreCertificate[];
}

export function createProofCheckRegistryAccumulator(): ProofCheckRegistryAccumulator {
  return {
    summaries: new Map(),
    exitStatesByFunction: new Map(),
    entryStateCertificates: new Map(),
    exitCertificatesByFunction: new Map(),
    summaryPlaceEffectsByFunction: new Map(),
    coreCertificates: [],
  };
}

export function applyProofCheckRegistrySideEffectsToArtifacts(input: {
  readonly artifacts: ProofCheckFunctionRegistryArtifactsMutable;
  readonly effects: readonly ProofCheckRegistrySideEffect[];
}): void {
  for (const effect of input.effects) {
    switch (effect.kind) {
      case "recordExitState":
        input.artifacts.exitStates.push(effect.state);
        break;
      case "recordExitCertificate":
        input.artifacts.exitCertificates.push(effect.certificate);
        break;
      case "recordEntryStateCertificate":
        input.artifacts.entryStateCertificate = effect.certificate;
        break;
      case "recordSummaryPlaceEffect":
        recordSummaryPlaceEffect(input.artifacts.summaryPlaceEffects, effect.effect);
        break;
      case "recordCoreCertificate": {
        const duplicate = input.artifacts.coreCertificates.some(
          (entry) => String(entry.certificateId) === String(effect.certificate.certificateId),
        );
        if (!duplicate) {
          input.artifacts.coreCertificates.push(effect.certificate);
        }
        break;
      }
      default: {
        const unreachable: never = effect;
        return unreachable;
      }
    }
  }
}

export function mergeProofCheckFunctionRegistryArtifactsIntoAccumulator(input: {
  readonly accumulator: ProofCheckRegistryAccumulator;
  readonly functionInstanceId: MonoInstanceId;
  readonly artifacts: ProofCheckFunctionRegistryArtifacts;
}): void {
  if (input.artifacts.exitStates.length > 0) {
    const existing = input.accumulator.exitStatesByFunction.get(input.functionInstanceId) ?? [];
    input.accumulator.exitStatesByFunction.set(input.functionInstanceId, [
      ...existing,
      ...input.artifacts.exitStates,
    ]);
  }
  if (input.artifacts.exitCertificates.length > 0) {
    const existing =
      input.accumulator.exitCertificatesByFunction.get(input.functionInstanceId) ?? [];
    input.accumulator.exitCertificatesByFunction.set(input.functionInstanceId, [
      ...existing,
      ...input.artifacts.exitCertificates,
    ]);
  }
  if (input.artifacts.entryStateCertificate !== undefined) {
    input.accumulator.entryStateCertificates.set(
      input.functionInstanceId,
      input.artifacts.entryStateCertificate,
    );
  }
  if (
    input.artifacts.summaryPlaceEffects.observed.length > 0 ||
    input.artifacts.summaryPlaceEffects.consumed.length > 0 ||
    input.artifacts.summaryPlaceEffects.mutated.length > 0 ||
    input.artifacts.summaryPlaceEffects.produced.length > 0
  ) {
    const existing =
      input.accumulator.summaryPlaceEffectsByFunction.get(input.functionInstanceId) ??
      emptySummaryPlaceEffectAccumulator();
    for (const effect of input.artifacts.summaryPlaceEffects.observed) {
      recordSummaryPlaceEffect(existing, effect);
    }
    for (const effect of input.artifacts.summaryPlaceEffects.consumed) {
      recordSummaryPlaceEffect(existing, effect);
    }
    for (const effect of input.artifacts.summaryPlaceEffects.mutated) {
      recordSummaryPlaceEffect(existing, effect);
    }
    for (const effect of input.artifacts.summaryPlaceEffects.produced) {
      recordSummaryPlaceEffect(existing, effect);
    }
    input.accumulator.summaryPlaceEffectsByFunction.set(input.functionInstanceId, existing);
  }
  for (const certificate of input.artifacts.coreCertificates) {
    const duplicate = input.accumulator.coreCertificates.some(
      (entry) => String(entry.certificateId) === String(certificate.certificateId),
    );
    if (!duplicate) {
      input.accumulator.coreCertificates.push(certificate);
    }
  }
}

export function applyProofCheckRegistrySideEffects(input: {
  readonly accumulator: ProofCheckRegistryAccumulator;
  readonly functionInstanceId: MonoInstanceId;
  readonly effects: readonly ProofCheckRegistrySideEffect[];
}): void {
  const artifacts = createProofCheckFunctionRegistryArtifacts();
  applyProofCheckRegistrySideEffectsToArtifacts({ artifacts, effects: input.effects });
  mergeProofCheckFunctionRegistryArtifactsIntoAccumulator({
    accumulator: input.accumulator,
    functionInstanceId: input.functionInstanceId,
    artifacts: finalizeProofCheckFunctionRegistryArtifacts(artifacts),
  });
}
