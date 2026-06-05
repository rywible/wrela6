import type { Diagnostic } from "../../shared/diagnostics";
import type { SourceSpan, SourceText } from "../../shared";
import type { ModuleId } from "../ids";

export type NameReferenceKind =
  | "importModule"
  | "importedItem"
  | "moduleQualifiedItem"
  | "typeName"
  | "functionName"
  | "imageName"
  | "fieldName"
  | "enumCase"
  | "imageDevice"
  | "memberName"
  | "typeParameter"
  | "parameter";

export type NameResolutionDiagnosticCode =
  | "NAME_UNRESOLVED_MODULE"
  | "NAME_UNRESOLVED_IMPORT"
  | "NAME_AMBIGUOUS_IMPORT"
  | "NAME_UNRESOLVED_NAME"
  | "NAME_AMBIGUOUS_NAME"
  | "NAME_QUALIFIER_NOT_MODULE"
  | "NAME_QUALIFIER_NOT_OWNER"
  | "NAME_UNRESOLVED_MEMBER"
  | "NAME_AMBIGUOUS_MEMBER"
  | "NAME_UNKNOWN_PLATFORM_PRIMITIVE"
  | "NAME_PRIVATE_IMPORT"
  | "NAME_BUILTIN_TYPE_SHADOWED"
  | "NAME_PLATFORM_FN_NOT_FREESTANDING";

export type NameDiagnosticOrderKind = NameReferenceKind | "declaration" | "platformBinding";

export interface NameResolutionDiagnosticOrder {
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
  readonly kind: NameDiagnosticOrderKind;
  readonly ordinal: number;
}

export type NameResolutionDiagnostic = Diagnostic<NameResolutionDiagnosticCode> & {
  readonly order: NameResolutionDiagnosticOrder;
};

export interface CandidateDisplay {
  readonly modulePath: string;
  readonly itemKind: string;
  readonly name: string;
  readonly denseId: number;
}

export function candidateDisplayText(candidates: readonly CandidateDisplay[]): string {
  const sorted = [...candidates].sort((candA, candB) => {
    const byModulePath = candA.modulePath.localeCompare(candB.modulePath);
    if (byModulePath !== 0) return byModulePath;
    const byItemKind = candA.itemKind.localeCompare(candB.itemKind);
    if (byItemKind !== 0) return byItemKind;
    const byName = candA.name.localeCompare(candB.name);
    if (byName !== 0) return byName;
    return candA.denseId - candB.denseId;
  });
  return sorted
    .map(
      (candidate) =>
        `${candidate.modulePath}/${candidate.itemKind}/${candidate.name}/${candidate.denseId}`,
    )
    .join(", ");
}

export function sortNameResolutionDiagnostics(
  diagnostics: readonly NameResolutionDiagnostic[],
): readonly NameResolutionDiagnostic[] {
  return [...diagnostics].sort((diagA, diagB) => {
    const byModuleId = diagA.order.moduleId - diagB.order.moduleId;
    if (byModuleId !== 0) return byModuleId;
    const byStart = diagA.order.span.start - diagB.order.span.start;
    if (byStart !== 0) return byStart;
    const byEnd = diagA.order.span.end - diagB.order.span.end;
    if (byEnd !== 0) return byEnd;
    const byKind = diagA.order.kind.localeCompare(diagB.order.kind);
    if (byKind !== 0) return byKind;
    const byOrdinal = diagA.order.ordinal - diagB.order.ordinal;
    if (byOrdinal !== 0) return byOrdinal;
    const byCode = diagA.code.localeCompare(diagB.code);
    if (byCode !== 0) return byCode;
    return diagA.message.localeCompare(diagB.message);
  });
}

function diagnostic(
  code: NameResolutionDiagnosticCode,
  message: string,
  source: SourceText,
  span: SourceSpan,
  order: NameResolutionDiagnosticOrder,
): NameResolutionDiagnostic {
  return { code, severity: "error", message, source, span, order };
}

export function unresolvedModule(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly moduleName: string;
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_UNRESOLVED_MODULE",
    `Unresolved module '${input.moduleName}'.`,
    input.source,
    input.span,
    input.order,
  );
}

export function unresolvedImport(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly moduleName: string;
  readonly importedName: string;
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_UNRESOLVED_IMPORT",
    `Unresolved import '${input.importedName}' from module '${input.moduleName}'.`,
    input.source,
    input.span,
    input.order,
  );
}

export function ambiguousImport(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly moduleName: string;
  readonly importedName: string;
  readonly candidates: readonly CandidateDisplay[];
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_AMBIGUOUS_IMPORT",
    `Ambiguous import '${input.importedName}' from module '${input.moduleName}': ${candidateDisplayText(input.candidates)}.`,
    input.source,
    input.span,
    input.order,
  );
}

export function unresolvedName(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly name: string;
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_UNRESOLVED_NAME",
    `Unresolved name '${input.name}'.`,
    input.source,
    input.span,
    input.order,
  );
}

export function ambiguousName(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly name: string;
  readonly candidates: readonly CandidateDisplay[];
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_AMBIGUOUS_NAME",
    `Ambiguous name '${input.name}': ${candidateDisplayText(input.candidates)}.`,
    input.source,
    input.span,
    input.order,
  );
}

export function qualifierNotModule(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly qualifier: string;
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_QUALIFIER_NOT_MODULE",
    `Qualifier '${input.qualifier}' is not a module.`,
    input.source,
    input.span,
    input.order,
  );
}

export function qualifierNotOwner(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly qualifier: string;
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_QUALIFIER_NOT_OWNER",
    `Qualifier '${input.qualifier}' does not own members.`,
    input.source,
    input.span,
    input.order,
  );
}

export function unresolvedMember(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly ownerName: string;
  readonly memberName: string;
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_UNRESOLVED_MEMBER",
    `Unresolved member '${input.memberName}' on '${input.ownerName}'.`,
    input.source,
    input.span,
    input.order,
  );
}

export function ambiguousMember(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly ownerName: string;
  readonly memberName: string;
  readonly candidates: readonly CandidateDisplay[];
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_AMBIGUOUS_MEMBER",
    `Ambiguous member '${input.memberName}' on '${input.ownerName}': ${candidateDisplayText(input.candidates)}.`,
    input.source,
    input.span,
    input.order,
  );
}

export function unknownPlatformPrimitive(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly functionName: string;
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_UNKNOWN_PLATFORM_PRIMITIVE",
    `Unknown platform primitive '${input.functionName}'.`,
    input.source,
    input.span,
    input.order,
  );
}

export function privateImport(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly moduleName: string;
  readonly importedName: string;
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_PRIVATE_IMPORT",
    `Item '${input.importedName}' in module '${input.moduleName}' is private.`,
    input.source,
    input.span,
    input.order,
  );
}

export function builtinTypeShadowed(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly name: string;
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_BUILTIN_TYPE_SHADOWED",
    `Builtin type '${input.name}' cannot be shadowed by a local declaration.`,
    input.source,
    input.span,
    input.order,
  );
}

export function platformFnNotFreestanding(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly functionName: string;
}): NameResolutionDiagnostic {
  return diagnostic(
    "NAME_PLATFORM_FN_NOT_FREESTANDING",
    `Platform function '${input.functionName}' must be freestanding.`,
    input.source,
    input.span,
    input.order,
  );
}
