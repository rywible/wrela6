import type { MonoInstanceId } from "../../mono/ids";
import type { OptIrFunction } from "../program";

export type OptIrMandatoryInlineReason =
  | "proofWrapper"
  | "validationHelper"
  | "monomorphizedShim"
  | "resourceWrapper"
  | "singleCallThunk"
  | "platformWrapper"
  | "runtimeWrapper";

export type OptIrSemanticInlinePolicy =
  | {
      readonly kind: "mandatory";
      readonly reason: OptIrMandatoryInlineReason;
      readonly source: "checkedSummary";
      readonly certificateId: unknown;
    }
  | { readonly kind: "eligible"; readonly reason?: unknown }
  | { readonly kind: "forbidden"; readonly reason?: unknown };

export interface OptIrInlinePolicySummary {
  readonly semanticInlinePolicy?: OptIrSemanticInlinePolicy;
}

export function mandatoryInlinePolicyForFunction(
  func: OptIrFunction,
): (OptIrSemanticInlinePolicy & { readonly kind: "mandatory" }) | undefined {
  const summary = optIrInlinePolicySummary(func.summary);
  const policy = summary?.semanticInlinePolicy;
  return policy?.kind === "mandatory" && policy.source === "checkedSummary" ? policy : undefined;
}

export function mandatoryInlineCalleeIds(
  functions: readonly OptIrFunction[],
): readonly MonoInstanceId[] {
  return Object.freeze(
    functions
      .filter((func) => mandatoryInlinePolicyForFunction(func) !== undefined)
      .map((func) => func.monoInstanceId)
      .sort(compareMonoInstanceIds),
  );
}

export function optIrInlinePolicySummary(value: unknown): OptIrInlinePolicySummary | undefined {
  if (value === null || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as { readonly semanticInlinePolicy?: unknown };
  if (!isInlinePolicy(candidate.semanticInlinePolicy)) {
    return undefined;
  }
  return { semanticInlinePolicy: candidate.semanticInlinePolicy };
}

function isInlinePolicy(value: unknown): value is OptIrSemanticInlinePolicy {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as { readonly kind?: unknown; readonly source?: unknown };
  if (candidate.kind === "eligible" || candidate.kind === "forbidden") {
    return true;
  }
  return candidate.kind === "mandatory" && candidate.source === "checkedSummary";
}

function compareMonoInstanceIds(left: MonoInstanceId, right: MonoInstanceId): number {
  return String(left) < String(right) ? -1 : String(left) > String(right) ? 1 : 0;
}
