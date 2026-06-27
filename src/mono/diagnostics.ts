import type { ModuleId } from "../semantic/ids";
import { SourceSpan } from "../shared/source-span";
import { compareCodeUnitStrings } from "./deterministic-sort";

export const MONO_DIAGNOSTIC_CODES = [
  "MONO_MISSING_SELECTED_IMAGE",
  "MONO_AMBIGUOUS_SELECTED_IMAGE",
  "MONO_SELECTED_IMAGE_NOT_FOUND",
  "MONO_SELECTED_IMAGE_ENTRY_MISSING",
  "MONO_MISSING_REACHABLE_FUNCTION",
  "MONO_MISSING_REACHABLE_TYPE",
  "MONO_MISSING_HIR_FIELD",
  "MONO_MISSING_TARGET_TYPE_KIND",
  "MONO_MISSING_CONSTRUCTOR_KIND_RULE",
  "MONO_REACHABLE_HIR_RECOVERY",
  "MONO_GENERIC_ARITY_MISMATCH",
  "MONO_OWNER_TYPE_ARGUMENT_ARITY_MISMATCH",
  "MONO_OWNER_TYPE_ID_MISMATCH",
  "MONO_UNRESOLVED_TYPE_PARAMETER",
  "MONO_UNRESOLVED_RESOURCE_KIND",
  "MONO_MISSING_VALIDATED_BUFFER",
  "MONO_INSTANCE_KIND_ELIGIBILITY_FAILED",
  "MONO_RECURSIVE_FUNCTION_CYCLE",
  "MONO_RECURSIVE_TYPE_CYCLE",
  "MONO_POLYMORPHIC_RECURSION",
  "MONO_DANGLING_PROOF_METADATA",
  "MONO_INCONSISTENT_PROOF_METADATA",
  "MONO_UNRESOLVED_CALL_TARGET",
  "MONO_CERTIFIED_PLATFORM_BINDING_MISSING",
  "MONO_PLATFORM_CONTRACT_EDGE_MISSING",
  "MONO_DUPLICATE_PLATFORM_CONTRACT_EDGE",
  "MONO_PLATFORM_EDGE_BINDING_MISMATCH",
  "MONO_INCONSISTENT_PLATFORM_ENSURED_FACT",
  "MONO_PLATFORM_EDGE_UNRESOLVED_POLYMORPHISM",
  "MONO_DUPLICATE_CANONICAL_INSTANCE_KEY",
  "MONO_DECLARED_TYPE_PARAMETER_KEY_INVALID",
  "MONO_DROPPED_EXTERNAL_ROOT",
] as const;

export type MonoDiagnosticCode = (typeof MONO_DIAGNOSTIC_CODES)[number] & {
  readonly __brand: "MonoDiagnosticCode";
};

const MONO_DIAGNOSTIC_CODE_SET: ReadonlySet<string> = new Set(MONO_DIAGNOSTIC_CODES);

export function monoDiagnosticCode(code: string): MonoDiagnosticCode {
  if (!MONO_DIAGNOSTIC_CODE_SET.has(code)) {
    throw new RangeError(`Unknown mono diagnostic code: ${code}.`);
  }
  return code as MonoDiagnosticCode;
}

export type MonoDiagnosticSeverity = "error" | "warning" | "info";

export interface MonoDiagnosticEntry {
  readonly severity: MonoDiagnosticSeverity;
  readonly category: string;
  readonly rootCauseKey: string;
}

export const MONO_DIAGNOSTIC_REGISTRY: Record<MonoDiagnosticCode, MonoDiagnosticEntry> = {
  MONO_MISSING_SELECTED_IMAGE: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "image-selection",
  },
  MONO_AMBIGUOUS_SELECTED_IMAGE: {
    severity: "error",
    category: "inconsistent-HIR",
    rootCauseKey: "image-selection",
  },
  MONO_SELECTED_IMAGE_NOT_FOUND: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "image-selection",
  },
  MONO_SELECTED_IMAGE_ENTRY_MISSING: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "image-entry",
  },
  MONO_MISSING_REACHABLE_FUNCTION: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "source-function",
  },
  MONO_MISSING_REACHABLE_TYPE: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "source-type",
  },
  MONO_MISSING_HIR_FIELD: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "source-field",
  },
  MONO_MISSING_TARGET_TYPE_KIND: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "target-type-kind",
  },
  MONO_MISSING_CONSTRUCTOR_KIND_RULE: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "constructor-kind-rule",
  },
  MONO_REACHABLE_HIR_RECOVERY: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "hir-recovery",
  },
  MONO_GENERIC_ARITY_MISMATCH: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "generic-arity",
  },
  MONO_OWNER_TYPE_ARGUMENT_ARITY_MISMATCH: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "owner-arity",
  },
  MONO_OWNER_TYPE_ID_MISMATCH: {
    severity: "error",
    category: "inconsistent-HIR",
    rootCauseKey: "owner-type-id",
  },
  MONO_UNRESOLVED_TYPE_PARAMETER: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "substitution",
  },
  MONO_UNRESOLVED_RESOURCE_KIND: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "resource-kind",
  },
  MONO_MISSING_VALIDATED_BUFFER: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "validated-buffer",
  },
  MONO_INSTANCE_KIND_ELIGIBILITY_FAILED: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "eligibility",
  },
  MONO_RECURSIVE_FUNCTION_CYCLE: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "recursion",
  },
  MONO_RECURSIVE_TYPE_CYCLE: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "recursion",
  },
  MONO_POLYMORPHIC_RECURSION: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "polymorphic-recursion",
  },
  MONO_DANGLING_PROOF_METADATA: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "proof-metadata",
  },
  MONO_INCONSISTENT_PROOF_METADATA: {
    severity: "error",
    category: "inconsistent-HIR",
    rootCauseKey: "proof-metadata",
  },
  MONO_UNRESOLVED_CALL_TARGET: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "call-target",
  },
  MONO_CERTIFIED_PLATFORM_BINDING_MISSING: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "platform-binding",
  },
  MONO_PLATFORM_CONTRACT_EDGE_MISSING: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "platform-edge",
  },
  MONO_DUPLICATE_PLATFORM_CONTRACT_EDGE: {
    severity: "error",
    category: "inconsistent-HIR",
    rootCauseKey: "platform-edge",
  },
  MONO_PLATFORM_EDGE_BINDING_MISMATCH: {
    severity: "error",
    category: "inconsistent-HIR",
    rootCauseKey: "platform-edge",
  },
  MONO_INCONSISTENT_PLATFORM_ENSURED_FACT: {
    severity: "error",
    category: "inconsistent-HIR",
    rootCauseKey: "platform-edge",
  },
  MONO_PLATFORM_EDGE_UNRESOLVED_POLYMORPHISM: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "platform-edge",
  },
  MONO_DUPLICATE_CANONICAL_INSTANCE_KEY: {
    severity: "error",
    category: "inconsistent-HIR",
    rootCauseKey: "canonical-key",
  },
  MONO_DECLARED_TYPE_PARAMETER_KEY_INVALID: {
    severity: "error",
    category: "inconsistent-HIR",
    rootCauseKey: "generic-parameter-order",
  },
  MONO_DROPPED_EXTERNAL_ROOT: {
    severity: "error",
    category: "user-closure",
    rootCauseKey: "external-root",
  },
};

export interface MonoDiagnosticRelatedInformation {
  readonly message: string;
  readonly span?: SourceSpan;
  readonly canonicalInstanceKey?: string;
}

export interface MonoDiagnostic {
  readonly code: MonoDiagnosticCode;
  readonly severity: MonoDiagnosticSeverity;
  readonly message: string;
  readonly sourceOrigin?: string;
  readonly span?: SourceSpan;
  readonly moduleId?: ModuleId;
  readonly relatedInformation?: readonly MonoDiagnosticRelatedInformation[];
  readonly order: MonoDiagnosticOrder;
}

export interface MonoDiagnosticOrder {
  readonly moduleId: ModuleId;
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly ownerKey: string;
  readonly code: MonoDiagnosticCode;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly tieBreaker: string;
}

export interface MonoDiagnosticInput {
  readonly severity: MonoDiagnosticSeverity;
  readonly code: string;
  readonly message: string;
  readonly sourceOrigin?: string;
  readonly moduleId?: ModuleId;
  readonly spanStart?: number;
  readonly spanEnd?: number;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly relatedInformation?: readonly MonoDiagnosticRelatedInformation[];
}

export function monoDiagnosticTieBreaker(input: {
  readonly ownerKey: string;
  readonly code: MonoDiagnosticCode;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}): string {
  return `owner:${input.ownerKey}/code:${input.code}/cause:${input.rootCauseKey}/detail:${input.stableDetail}`;
}

export function monoDiagnosticSuppressionKey(input: {
  readonly canonicalInstanceKey: string;
  readonly code: MonoDiagnosticCode;
  readonly rootCauseKey: string;
}): string {
  return `${input.canonicalInstanceKey}|${input.code}|${input.rootCauseKey}`;
}

export function monoDiagnostic(input: MonoDiagnosticInput): MonoDiagnostic {
  const validatedCode = monoDiagnosticCode(input.code);
  const span =
    input.spanStart !== undefined && input.spanEnd !== undefined
      ? SourceSpan.from(input.spanStart, input.spanEnd)
      : undefined;
  const order: MonoDiagnosticOrder = {
    moduleId: input.moduleId ?? (0 as ModuleId),
    spanStart: input.spanStart ?? 0,
    spanEnd: input.spanEnd ?? 0,
    ownerKey: input.ownerKey,
    code: validatedCode,
    rootCauseKey: input.rootCauseKey,
    stableDetail: input.stableDetail,
    tieBreaker: monoDiagnosticTieBreaker({
      ownerKey: input.ownerKey,
      code: validatedCode,
      rootCauseKey: input.rootCauseKey,
      stableDetail: input.stableDetail,
    }),
  };
  return {
    code: validatedCode,
    severity: input.severity,
    message: input.message,
    ...(input.sourceOrigin !== undefined ? { sourceOrigin: input.sourceOrigin } : {}),
    ...(span !== undefined ? { span } : {}),
    ...(input.moduleId !== undefined ? { moduleId: input.moduleId } : {}),
    ...(input.relatedInformation !== undefined
      ? { relatedInformation: input.relatedInformation }
      : {}),
    order,
  };
}

export function sortMonoDiagnostics(diagnostics: readonly MonoDiagnostic[]): MonoDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const moduleCmp = (left.order.moduleId as number) - (right.order.moduleId as number);
    if (moduleCmp !== 0) return moduleCmp;

    const spanStartCmp = left.order.spanStart - right.order.spanStart;
    if (spanStartCmp !== 0) return spanStartCmp;

    const spanEndCmp = left.order.spanEnd - right.order.spanEnd;
    if (spanEndCmp !== 0) return spanEndCmp;

    const ownerCmp = compareCodeUnitStrings(left.order.ownerKey, right.order.ownerKey);
    if (ownerCmp !== 0) return ownerCmp;

    const codeCmp = compareCodeUnitStrings(left.order.code, right.order.code);
    if (codeCmp !== 0) return codeCmp;

    const rootCauseCmp = compareCodeUnitStrings(left.order.rootCauseKey, right.order.rootCauseKey);
    if (rootCauseCmp !== 0) return rootCauseCmp;

    const detailCmp = compareCodeUnitStrings(left.order.stableDetail, right.order.stableDetail);
    if (detailCmp !== 0) return detailCmp;

    return compareCodeUnitStrings(left.order.tieBreaker, right.order.tieBreaker);
  });
}

export function suppressMonoDiagnostics(
  diagnostics: readonly MonoDiagnostic[],
): readonly MonoDiagnostic[] {
  const bySuppressionKey = new Map<string, MonoDiagnostic>();
  for (const diagnostic of sortMonoDiagnostics(diagnostics)) {
    const canonicalInstanceKey =
      diagnostic.relatedInformation?.find((info) => info.canonicalInstanceKey !== undefined)
        ?.canonicalInstanceKey ?? diagnostic.order.ownerKey;
    const key = monoDiagnosticSuppressionKey({
      canonicalInstanceKey,
      code: diagnostic.code,
      rootCauseKey: diagnostic.order.rootCauseKey,
    });
    const existing = bySuppressionKey.get(key);
    if (existing === undefined) {
      bySuppressionKey.set(key, diagnostic);
      continue;
    }
    bySuppressionKey.set(key, mergeRelatedInformation(existing, diagnostic, canonicalInstanceKey));
  }
  return sortMonoDiagnostics([...bySuppressionKey.values()]);
}

function mergeRelatedInformation(
  primary: MonoDiagnostic,
  duplicate: MonoDiagnostic,
  canonicalInstanceKey: string,
): MonoDiagnostic {
  const existing = primary.relatedInformation ?? [];
  const duplicateInfo = duplicate.relatedInformation ?? [];
  const related: MonoDiagnosticRelatedInformation[] = [
    ...existing,
    {
      message: duplicate.message,
      ...(duplicate.span !== undefined ? { span: duplicate.span } : {}),
      canonicalInstanceKey,
    },
    ...duplicateInfo,
  ];
  return { ...primary, relatedInformation: dedupeRelatedInformation(related) };
}

function dedupeRelatedInformation(
  related: readonly MonoDiagnosticRelatedInformation[],
): readonly MonoDiagnosticRelatedInformation[] {
  const seen = new Set<string>();
  const result: MonoDiagnosticRelatedInformation[] = [];
  for (const entry of related) {
    const key = `${entry.message}|${entry.span?.start ?? ""}|${entry.span?.end ?? ""}|${
      entry.canonicalInstanceKey ?? ""
    }`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}
