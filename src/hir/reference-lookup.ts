import type { CompletedMemberReferenceTable } from "../semantic/surface/checked-program";
import type { CheckedRequirementReference } from "../semantic/surface/proof-surface";
import type { ResolvedReferences } from "../semantic/names/resolution-result";
import type { ResolvedReference, SyntaxReferenceKey } from "../semantic/names/reference";
import type { NameReferenceKind } from "../semantic/names/reference";
import { moduleId, type ModuleId } from "../semantic/ids";
import { compareCodeUnitStrings } from "./deterministic-sort";
import { HirDiagnosticSink, hirDiagnosticCode, hirDiagnosticTieBreaker } from "./diagnostics";
import type { HirDiagnostic } from "./diagnostics";

export interface HirReferenceLookup {
  referenceFor(key: SyntaxReferenceKey): ResolvedReference | undefined;
  completedMemberFor(key: SyntaxReferenceKey): ResolvedReference | undefined;
  requirementReferenceFor(key: SyntaxReferenceKey): ResolvedReference | undefined;
  referenceEntryForSpan(input: {
    readonly moduleId: ModuleId;
    readonly span: SpanLike;
    readonly kind?: NameReferenceKind;
  }): { readonly key: SyntaxReferenceKey; readonly reference: ResolvedReference } | undefined;
  referenceForSpan(input: {
    readonly moduleId: ModuleId;
    readonly span: SpanLike;
    readonly kind?: NameReferenceKind;
  }): ResolvedReference | undefined;
  completedMemberForSpan(input: {
    readonly moduleId: ModuleId;
    readonly span: SpanLike;
    readonly kind?: NameReferenceKind;
  }): ResolvedReference | undefined;
}

export interface BuildHirReferenceLookupInput {
  readonly references: ResolvedReferences;
  readonly completedMembers: CompletedMemberReferenceTable;
  readonly requirementReferences: readonly CheckedRequirementReference[];
  readonly diagnostics: HirDiagnosticSink;
}

function keyToString(key: SyntaxReferenceKey): string {
  return `${key.moduleId}:${key.span.start}:${key.span.end}:${key.kind}:${key.ordinal}`;
}

function referenceFingerprint(reference: ResolvedReference): string {
  switch (reference.kind) {
    case "module":
      return `module:${reference.moduleId}`;
    case "item":
      return `item:${reference.itemId}`;
    case "type":
      return `type:${reference.itemId}:${reference.typeId}`;
    case "builtinType":
      return `builtinType:${reference.coreTypeId}`;
    case "targetType":
      return `targetType:${reference.targetTypeId}`;
    case "compilerIntrinsic":
      return `compilerIntrinsic:${reference.intrinsicKey}`;
    case "function":
      return `function:${reference.itemId}:${reference.functionId}`;
    case "image":
      return `image:${reference.itemId}:${reference.imageId}`;
    case "field":
      return `field:${reference.ownerItemId}:${reference.fieldId}`;
    case "typeParameter":
      return `typeParameter:${reference.owner.kind}:${
        reference.owner.kind === "item" ? reference.owner.itemId : reference.owner.functionId
      }:${reference.index}`;
    case "parameter":
      return `parameter:${reference.parameterId}`;
  }
}

function disagreementDiagnostic(input: {
  readonly key: SyntaxReferenceKey;
  readonly left: ResolvedReference;
  readonly right: ResolvedReference;
}): HirDiagnostic {
  const code = hirDiagnosticCode("HIR_INPUT_SURFACE_DISAGREEMENT");
  const ownerKey = "program";
  const originKey = keyToString(input.key);
  const left = referenceFingerprint(input.left);
  const right = referenceFingerprint(input.right);
  const stableDetail = [left, right].sort(compareCodeUnitStrings).join("|");
  return {
    code,
    message: `HIR input surfaces disagree for ${originKey}: ${left} vs ${right}.`,
    stableDetail,
    moduleId: input.key.moduleId,
    span: input.key.span,
    order: {
      moduleId: input.key.moduleId ?? moduleId(0),
      spanStart: input.key.span.start,
      spanEnd: input.key.span.end,
      ownerKey,
      originKey,
      code,
      tieBreaker: hirDiagnosticTieBreaker({
        ownerKey,
        originKey,
        code,
        stableDetail,
      }),
    },
  };
}

function indexEntries(
  entries: readonly { readonly key: SyntaxReferenceKey; readonly reference: ResolvedReference }[],
) {
  const indexed = new Map<string, ResolvedReference>();
  for (const entry of entries) {
    indexed.set(keyToString(entry.key), entry.reference);
  }
  return indexed;
}

interface SpanLike {
  readonly start: number;
  readonly end: number;
}

function spanKey(input: {
  readonly moduleId: ModuleId;
  readonly span: SpanLike;
  readonly kind?: NameReferenceKind;
}): string {
  return `${input.moduleId}:${input.span.start}:${input.span.end}:${input.kind ?? "*"}`;
}

function indexSpanEntries(
  entries: readonly { readonly key: SyntaxReferenceKey; readonly reference: ResolvedReference }[],
) {
  const indexed = new Map<
    string,
    { readonly key: SyntaxReferenceKey; readonly reference: ResolvedReference }
  >();
  for (const entry of entries) {
    const base = {
      moduleId: entry.key.moduleId,
      span: entry.key.span,
    };
    const anyKindKey = spanKey(base);
    if (!indexed.has(anyKindKey)) {
      indexed.set(anyKindKey, entry);
    }

    const kindKey = spanKey({ ...base, kind: entry.key.kind });
    if (!indexed.has(kindKey)) {
      indexed.set(kindKey, entry);
    }
  }
  return indexed;
}

export function buildHirReferenceLookup(input: BuildHirReferenceLookupInput): HirReferenceLookup {
  const referenceEntries = input.references.entries();
  const completedEntries = input.completedMembers.entries();
  const references = indexEntries(referenceEntries);
  const completed = indexEntries(completedEntries);
  const requirements = indexEntries(input.requirementReferences);
  const referencesBySpan = indexSpanEntries(referenceEntries);
  const completedBySpan = indexSpanEntries(completedEntries);

  for (const completedEntry of input.completedMembers.entries()) {
    const base = references.get(keyToString(completedEntry.key));
    if (
      base !== undefined &&
      referenceFingerprint(base) !== referenceFingerprint(completedEntry.reference)
    ) {
      input.diagnostics.report(
        disagreementDiagnostic({
          key: completedEntry.key,
          left: base,
          right: completedEntry.reference,
        }),
      );
    }
  }

  for (const requirementEntry of input.requirementReferences) {
    const base = references.get(keyToString(requirementEntry.key));
    if (
      base !== undefined &&
      referenceFingerprint(base) !== referenceFingerprint(requirementEntry.reference)
    ) {
      input.diagnostics.report(
        disagreementDiagnostic({
          key: requirementEntry.key,
          left: base,
          right: requirementEntry.reference,
        }),
      );
    }
  }

  return {
    referenceFor(key) {
      return references.get(keyToString(key));
    },
    completedMemberFor(key) {
      return completed.get(keyToString(key));
    },
    requirementReferenceFor(key) {
      return requirements.get(keyToString(key));
    },
    referenceEntryForSpan(spanInput) {
      return referencesBySpan.get(spanKey(spanInput));
    },
    referenceForSpan(spanInput) {
      return referencesBySpan.get(spanKey(spanInput))?.reference;
    },
    completedMemberForSpan(spanInput) {
      return completedBySpan.get(spanKey(spanInput))?.reference;
    },
  };
}
