import { factDiagnostic } from "./fact-diagnostics";
import type { FactDiagnostic } from "./fact-diagnostics";

export type FactVerifierKey = string & { readonly __brand: "FactVerifierKey" };

export type FactTransferBehavior =
  | "identity"
  | "move"
  | "split"
  | "copy"
  | "weaken"
  | "invalidate"
  | "reject"
  | "rederive-from-catalog";

export interface FactTransferRule<Subject, RewrittenSubject, Payload> {
  readonly behavior: FactTransferBehavior;
  readonly stableKey: string;
  readonly reason?: string;
  readonly strength?: string;
  readonly catalogKey?: string;
  readonly canApply?: (input: {
    readonly subject: Subject;
    readonly rewrittenSubjects: readonly RewrittenSubject[];
    readonly payload: Payload;
  }) => boolean;
}

export function factVerifierKey(value: string): FactVerifierKey {
  return nonEmptyFactString(value, "FactVerifierKey") as FactVerifierKey;
}

export interface ApplyFactTransferRuleInput<Subject, RewrittenSubject, Payload> {
  readonly extensionKey: string;
  readonly rewriteKind: string;
  readonly subject: Subject;
  readonly rewrittenSubjects: readonly RewrittenSubject[];
  readonly payload: Payload;
}

export interface AppliedFactTransfer<RewrittenSubject, Payload> {
  readonly behavior: FactTransferBehavior;
  readonly rewrittenSubjects: readonly RewrittenSubject[];
  readonly payload: Payload;
  readonly reason?: string;
  readonly strength?: string;
  readonly catalogKey?: string;
}

export type AppliedFactTransferResult<RewrittenSubject, Payload> =
  | {
      readonly kind: "ok";
      readonly transfer: AppliedFactTransfer<RewrittenSubject, Payload>;
      readonly diagnostics: readonly FactDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly FactDiagnostic[];
    };

export function identityFactTransferRule<Subject, RewrittenSubject, Payload>(): FactTransferRule<
  Subject,
  RewrittenSubject,
  Payload
> {
  return Object.freeze({ behavior: "identity", stableKey: "transfer:identity" });
}

export function moveFactTransferRule<Subject, RewrittenSubject, Payload>(): FactTransferRule<
  Subject,
  RewrittenSubject,
  Payload
> {
  return Object.freeze({ behavior: "move", stableKey: "transfer:move" });
}

export function splitFactTransferRule<Subject, RewrittenSubject, Payload>(): FactTransferRule<
  Subject,
  RewrittenSubject,
  Payload
> {
  return Object.freeze({ behavior: "split", stableKey: "transfer:split" });
}

export function copyFactTransferRule<Subject, RewrittenSubject, Payload>(): FactTransferRule<
  Subject,
  RewrittenSubject,
  Payload
> {
  return Object.freeze({ behavior: "copy", stableKey: "transfer:copy" });
}

export function weakenFactTransferRule<Subject, RewrittenSubject, Payload>(input: {
  readonly strength: string;
}): FactTransferRule<Subject, RewrittenSubject, Payload> {
  return Object.freeze({
    behavior: "weaken",
    stableKey: `transfer:weaken:${input.strength}`,
    strength: input.strength,
  });
}

export function invalidateFactTransferRule<Subject, RewrittenSubject, Payload>(input: {
  readonly reason: string;
}): FactTransferRule<Subject, RewrittenSubject, Payload> {
  return Object.freeze({
    behavior: "invalidate",
    stableKey: `transfer:invalidate:${input.reason}`,
    reason: input.reason,
  });
}

export function rejectFactTransferRule<Subject, RewrittenSubject, Payload>(input: {
  readonly reason: string;
}): FactTransferRule<Subject, RewrittenSubject, Payload> {
  return Object.freeze({
    behavior: "reject",
    stableKey: `transfer:reject:${input.reason}`,
    reason: input.reason,
  });
}

export function rederiveFromCatalogFactTransferRule<Subject, RewrittenSubject, Payload>(input: {
  readonly catalogKey: string;
}): FactTransferRule<Subject, RewrittenSubject, Payload> {
  return Object.freeze({
    behavior: "rederive-from-catalog",
    stableKey: `transfer:rederive-from-catalog:${input.catalogKey}`,
    catalogKey: input.catalogKey,
  });
}

export function applyFactTransferRule<Subject, RewrittenSubject, Payload>(
  rule: FactTransferRule<Subject, RewrittenSubject, Payload>,
  input: ApplyFactTransferRuleInput<Subject, RewrittenSubject, Payload>,
): AppliedFactTransferResult<RewrittenSubject, Payload> {
  if (
    rule.canApply !== undefined &&
    !rule.canApply({
      subject: input.subject,
      rewrittenSubjects: input.rewrittenSubjects,
      payload: input.payload,
    })
  ) {
    return rejectedTransfer(rule, input, rule.reason ?? "predicate");
  }
  switch (rule.behavior) {
    case "identity":
    case "move":
    case "split":
    case "copy":
    case "weaken":
    case "invalidate":
    case "rederive-from-catalog":
      return Object.freeze({
        kind: "ok",
        transfer: Object.freeze({
          behavior: rule.behavior,
          rewrittenSubjects: Object.freeze([...input.rewrittenSubjects]),
          payload: input.payload,
          ...(rule.reason === undefined ? {} : { reason: rule.reason }),
          ...(rule.strength === undefined ? {} : { strength: rule.strength }),
          ...(rule.catalogKey === undefined ? {} : { catalogKey: rule.catalogKey }),
        }),
        diagnostics: [],
      });
    case "reject":
      return rejectedTransfer(rule, input, rule.reason ?? "rejected");
  }
}

function rejectedTransfer<Subject, RewrittenSubject, Payload>(
  rule: FactTransferRule<Subject, RewrittenSubject, Payload>,
  input: ApplyFactTransferRuleInput<Subject, RewrittenSubject, Payload>,
  reason: string,
): AppliedFactTransferResult<RewrittenSubject, Payload> {
  return Object.freeze({
    kind: "error",
    diagnostics: [
      factDiagnostic({
        code: "FACT_TRANSFER_REJECTED",
        stableDetail: `fact-transfer:rejected:${input.extensionKey}:${input.rewriteKind}:${subjectStableKey(
          input.subject,
        )}:${reason}`,
      }),
    ],
  });
}

function subjectStableKey(subject: unknown): string {
  if (subject !== null && typeof subject === "object") {
    if ("kind" in subject && typeof subject.kind === "string") {
      if ("stableKey" in subject && typeof subject.stableKey === "string") {
        return `${subject.kind}:${subject.stableKey}`;
      }
      return Object.entries(subject)
        .filter(([key]) => key !== "kind")
        .map(([, value]) => String(value))
        .join(":")
        .replace(/^/, `${subject.kind}:`);
    }
    if ("stableKey" in subject && typeof subject.stableKey === "string") {
      return subject.stableKey;
    }
  }
  return String(subject);
}

function nonEmptyFactString(value: string, label: string): string {
  if (value.length === 0 || value.trim() !== value) {
    throw new RangeError(`${label} must be non-empty and trimmed.`);
  }
  return value;
}
