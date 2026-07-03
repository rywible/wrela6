import { SourceSpan, presentTokenSpan } from "../../frontend";
import { FunctionDeclarationView } from "../../frontend/ast/function-views";
import type { ExpressionView } from "../../frontend/ast/expression-views";
import {
  MemberAccessExpressionView,
  expressionViewFrom,
} from "../../frontend/ast/expression-views";
import type { PatternView } from "../../frontend/ast/pattern-views";
import { MatchStatementView } from "../../frontend/ast/statement-views";
import { descendants } from "../../frontend/ast/syntax-query";
import { RedNode, SyntaxKind } from "../../frontend/syntax";
import type { FunctionId, ModuleId } from "../ids";
import type { ItemIndex } from "../item-index";
import type { ResolvedReferences } from "../names";
import { buildMemberNamespace } from "../names/member-namespace";
import type { ResolvedReference } from "../names/reference";
import {
  completeDeferredMembers,
  deriveTypedOwnersFromSignatures,
} from "./deferred-member-completer";
import type { SemanticSurfaceDiagnostic } from "./diagnostics";
import { unresolvedDeferredMember } from "./diagnostics";
import {
  matchRefinementMatchKey,
  matchRefinementScrutineeKey,
  CheckedMatchRefinementSurfaceTableBuilder,
} from "./proof-contracts";
import type { CheckedMatchRefinementSurface } from "./proof-contracts";
import {
  checkedProofSurface,
  requirementSurface,
  terminalSurface,
  type CheckedPredicateFactSurface,
} from "./proof-surface";
import type {
  CheckedProofSurface,
  CheckedRequirementExpression,
  CheckedRequirementReference,
  CheckedRequirementSurface,
  CheckedTerminalSurface,
} from "./proof-surface";
import type { SurfaceReferenceLookup } from "./reference-lookup";
import { syntaxReferenceKeyToString } from "./reference-lookup";
import type { CheckedFunctionSignatureTable, CompletedMemberReference } from "./checked-program";
import { CheckedProgramBuilder } from "./checked-program";
import type { CheckSemanticSurfaceInput } from "./semantic-surface-checker";

function requirementMemberKey(moduleId: ModuleId, span: SourceSpan): string {
  return `${moduleId}:${span.start}:${span.end}`;
}

function collectMemberAccessExpressions(expression: ExpressionView): MemberAccessExpressionView[] {
  const members: MemberAccessExpressionView[] = [];
  const visit = (view: ExpressionView): void => {
    if (view instanceof MemberAccessExpressionView) {
      members.push(view);
    }
    for (const child of view.node.children()) {
      if (child instanceof RedNode) {
        const childView = expressionViewFrom(child);
        if (childView !== undefined) visit(childView);
      }
    }
  };
  visit(expression);
  return members;
}

function reportUntrackedRequirementMembers(input: {
  readonly expression: ExpressionView;
  readonly moduleId: ModuleId;
  readonly knownMemberKeys: ReadonlySet<string>;
  readonly diagnostics: SemanticSurfaceDiagnostic[];
}): void {
  for (const memberExpression of collectMemberAccessExpressions(input.expression)) {
    const memberToken = memberExpression.memberToken();
    const memberName = memberExpression.memberName();
    const memberSpan = memberToken !== undefined ? presentTokenSpan(memberToken) : undefined;
    if (memberName === undefined || memberSpan === undefined) continue;
    if (input.knownMemberKeys.has(requirementMemberKey(input.moduleId, memberSpan))) continue;
    input.diagnostics.push(
      unresolvedDeferredMember(memberName, memberSpan, memberExpression.source, {
        moduleId: input.moduleId,
        span: memberSpan,
        codeTieBreaker: "deferred",
      }),
    );
  }
}

interface RequirementProofScope {
  readonly ownerFunctionId: FunctionId;
  readonly moduleId: ModuleId;
  readonly expression: CheckedRequirementExpression;
  readonly span: SourceSpan;
  readonly references: readonly CheckedRequirementReference[];
  readonly deferredMemberKeys: readonly string[];
}

function referencesContainedByRequirement(input: {
  readonly references: ResolvedReferences;
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
}): CheckedRequirementReference[] {
  const references: CheckedRequirementReference[] = [];
  for (const entry of input.references.entries()) {
    if (entry.key.moduleId !== input.moduleId) continue;
    if (entry.key.span.start < input.span.start || entry.key.span.end > input.span.end) continue;
    references.push({ key: entry.key, reference: entry.reference });
  }
  return references;
}

function deferredKeysContainedByRequirement(input: {
  readonly references: ResolvedReferences;
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
}): string[] {
  const keys: string[] = [];
  for (const deferredMember of input.references.deferredMembers()) {
    const ownerKey = deferredMember.receiverExpressionKey ?? deferredMember.key;
    if (ownerKey.moduleId !== input.moduleId) continue;
    if (ownerKey.span.start < input.span.start || ownerKey.span.end > input.span.end) continue;
    keys.push(syntaxReferenceKeyToString(deferredMember.key));
  }
  return keys;
}

function collectRequirementProofScopes(input: {
  readonly surfaceInput: CheckSemanticSurfaceInput;
  readonly signatures: CheckedFunctionSignatureTable;
  readonly diagnostics: SemanticSurfaceDiagnostic[];
}): RequirementProofScope[] {
  const knownRequirementMemberKeys = new Set<string>();
  for (const entry of input.surfaceInput.references.entries()) {
    if (
      entry.key.kind === "memberName" ||
      entry.key.kind === "fieldName" ||
      entry.key.kind === "functionName" ||
      entry.key.kind === "enumCase"
    ) {
      knownRequirementMemberKeys.add(requirementMemberKey(entry.key.moduleId, entry.key.span));
    }
  }
  for (const deferredMember of input.surfaceInput.references.deferredMembers()) {
    knownRequirementMemberKeys.add(
      requirementMemberKey(deferredMember.key.moduleId, deferredMember.key.span),
    );
  }

  const scopes: RequirementProofScope[] = [];
  for (const signature of input.signatures.entries()) {
    const funcRecord = input.surfaceInput.index.function(signature.functionId);
    const moduleId = funcRecord?.moduleId ?? (0 as ModuleId);
    const item = input.surfaceInput.index.item(signature.itemId);
    const declaration = item?.declaration;
    const requiresSections =
      declaration instanceof FunctionDeclarationView ? declaration.requiresSections() : [];
    for (const section of requiresSections) {
      for (const req of section.requirements()) {
        const reqExpr = req.expression();
        if (reqExpr === undefined) continue;
        const exprSpan = reqExpr.span;
        const exprText = reqExpr.source.text.slice(exprSpan.start, exprSpan.end);
        reportUntrackedRequirementMembers({
          expression: reqExpr,
          moduleId,
          knownMemberKeys: knownRequirementMemberKeys,
          diagnostics: input.diagnostics,
        });
        scopes.push({
          ownerFunctionId: signature.functionId,
          moduleId,
          expression: { kind: "opaque", text: exprText },
          span: exprSpan,
          references: referencesContainedByRequirement({
            references: input.surfaceInput.references,
            moduleId,
            span: exprSpan,
          }),
          deferredMemberKeys: deferredKeysContainedByRequirement({
            references: input.surfaceInput.references,
            moduleId,
            span: exprSpan,
          }),
        });
      }
    }
  }
  return scopes;
}

function isEnumCaseReference(input: {
  readonly reference: ResolvedReference;
  readonly index: ItemIndex;
}): boolean {
  return (
    input.reference.kind === "item" && input.index.item(input.reference.itemId)?.kind === "enumCase"
  );
}

function enumCaseReferenceEntry(input: {
  readonly pattern: PatternView;
  readonly moduleId: ModuleId;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly index: ItemIndex;
}): CheckedRequirementReference | undefined {
  const segments = input.pattern.qualifiedName()?.segments() ?? [];
  const lastSegment = segments[segments.length - 1];
  const span = presentTokenSpan(lastSegment);
  if (span === undefined) return undefined;

  for (const kind of ["enumCase", "memberName"] as const) {
    const result = input.referenceLookup.findOne({
      moduleId: input.moduleId,
      span,
      kind,
    });
    if (
      result.kind === "found" &&
      isEnumCaseReference({ reference: result.entry.reference, index: input.index })
    ) {
      return { key: result.entry.key, reference: result.entry.reference };
    }
  }
  return undefined;
}

function bindingKeysForPattern(input: {
  readonly pattern: PatternView;
  readonly moduleId: ModuleId;
}): string[] {
  const keys: string[] = [];
  for (const nestedPattern of input.pattern.patternList()?.patterns() ?? []) {
    const name = nestedPattern.qualifiedName()?.text();
    if (name === undefined || name === "_") continue;
    const segments = nestedPattern.qualifiedName()?.segments() ?? [];
    const firstSpan = presentTokenSpan(segments[0]);
    const lastSpan = presentTokenSpan(segments[segments.length - 1]);
    if (firstSpan === undefined || lastSpan === undefined) continue;
    keys.push(`binding:${input.moduleId}:${firstSpan.start}:${lastSpan.end}`);
  }
  return keys;
}

function matchRefinementSurfacesForFunction(input: {
  readonly declaration: FunctionDeclarationView;
  readonly moduleId: ModuleId;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly index: ItemIndex;
}): CheckedMatchRefinementSurface[] {
  const surfaces: CheckedMatchRefinementSurface[] = [];
  for (const node of descendants(input.declaration.node, SyntaxKind.MatchStatement)) {
    const match = MatchStatementView.from(node);
    if (match === undefined) continue;
    const scrutinee = match.condition()?.expression() ?? match.expression();
    if (scrutinee === undefined) continue;
    for (const arm of match.arms()) {
      const pattern = arm.pattern();
      if (pattern === undefined) continue;
      const variant = enumCaseReferenceEntry({
        pattern,
        moduleId: input.moduleId,
        referenceLookup: input.referenceLookup,
        index: input.index,
      });
      if (variant === undefined) continue;
      surfaces.push({
        matchStatementKey: matchRefinementMatchKey({
          moduleId: input.moduleId,
          span: match.node.span,
        }),
        scrutineeKey: matchRefinementScrutineeKey({
          moduleId: input.moduleId,
          span: scrutinee.node.span,
        }),
        variantReferenceKey: syntaxReferenceKeyToString(variant.key),
        fieldBindingKeys: bindingKeysForPattern({ pattern, moduleId: input.moduleId }),
        span: match.node.span,
      });
    }
  }
  return surfaces;
}

export function collectProofSurfaces(input: {
  readonly surfaceInput: CheckSemanticSurfaceInput;
  readonly builder: CheckedProgramBuilder;
  readonly signatures: CheckedFunctionSignatureTable;
  readonly referenceLookup: SurfaceReferenceLookup;
  readonly diagnostics: SemanticSurfaceDiagnostic[];
}): CheckedProofSurface {
  const terminalSurfaces: CheckedTerminalSurface[] = [];
  const predicateFactSurfaces: CheckedPredicateFactSurface[] = [];
  const matchRefinementBuilder = new CheckedMatchRefinementSurfaceTableBuilder();
  const requirementScopes = collectRequirementProofScopes({
    surfaceInput: input.surfaceInput,
    signatures: input.signatures,
    diagnostics: input.diagnostics,
  });
  const { byKey: typedOwners, byParameterId: parameterOwners } = deriveTypedOwnersFromSignatures({
    signatures: input.signatures,
    references: input.surfaceInput.references,
    index: input.surfaceInput.index,
  });

  for (const signature of input.signatures.entries()) {
    if (signature.modifiers.isTerminal) {
      terminalSurfaces.push(
        terminalSurface({ functionId: signature.functionId, span: signature.sourceSpan }),
      );
    }
    if (signature.modifiers.isPredicate) {
      predicateFactSurfaces.push({
        functionId: signature.functionId,
        span: signature.sourceSpan,
      });
    }
    const functionRecord = input.surfaceInput.index.function(signature.functionId);
    const item = input.surfaceInput.index.item(signature.itemId);
    if (functionRecord !== undefined && item?.declaration instanceof FunctionDeclarationView) {
      for (const surface of matchRefinementSurfacesForFunction({
        declaration: item.declaration,
        moduleId: functionRecord.moduleId,
        referenceLookup: input.referenceLookup,
        index: input.surfaceInput.index,
      })) {
        matchRefinementBuilder.add(surface);
      }
    }
  }

  const declarationKeys = new Set<string>();
  for (const scope of requirementScopes) {
    for (const key of scope.deferredMemberKeys) {
      declarationKeys.add(key);
    }
  }
  for (const deferredMember of input.surfaceInput.references.deferredMembers()) {
    declarationKeys.add(syntaxReferenceKeyToString(deferredMember.key));
  }

  const deferredResult = completeDeferredMembers({
    index: input.surfaceInput.index,
    references: input.surfaceInput.references,
    memberNamespace: buildMemberNamespace(input.surfaceInput.index),
    typedOwners,
    parameterOwners,
    declarationKeys,
  });
  input.diagnostics.push(...deferredResult.diagnostics);

  for (const completed of deferredResult.completed.entries()) {
    input.builder.addCompletedMember(completed);
  }

  const completedByModule = new Map<ModuleId, CompletedMemberReference[]>();
  for (const completedEntry of deferredResult.completed.entries()) {
    const list = completedByModule.get(completedEntry.key.moduleId) ?? [];
    list.push(completedEntry);
    completedByModule.set(completedEntry.key.moduleId, list);
  }
  const builtRequirements: CheckedRequirementSurface[] = [];
  for (const req of requirementScopes) {
    const completedMembers: CheckedRequirementReference[] = [];
    for (const completedEntry of completedByModule.get(req.moduleId) ?? []) {
      if (
        completedEntry.key.span.start >= req.span.start &&
        completedEntry.key.span.end <= req.span.end
      ) {
        completedMembers.push({ key: completedEntry.key, reference: completedEntry.reference });
      }
    }
    const expression: CheckedRequirementExpression =
      req.references.length > 0 || completedMembers.length > 0
        ? {
            kind: "checked",
            text: req.expression.text,
            references: req.references,
            completedMembers,
          }
        : req.expression;
    builtRequirements.push(
      requirementSurface({ ownerFunctionId: req.ownerFunctionId, expression, span: req.span }),
    );
  }

  for (const failed of deferredResult.failedDeferred) {
    input.diagnostics.push(
      unresolvedDeferredMember(failed.memberName, failed.memberSpan, undefined, {
        moduleId: failed.key.moduleId,
        span: failed.memberSpan,
        codeTieBreaker: "deferred",
      }),
    );
  }

  return checkedProofSurface({
    requirements: builtRequirements,
    predicateFactSurfaces,
    terminalSurfaces,
    matchRefinements: matchRefinementBuilder.build(),
  });
}
