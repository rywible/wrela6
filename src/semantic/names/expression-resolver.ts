import type { ParsedModuleGraph, ParsedModule } from "../../frontend/module-graph-parser";
import { SourceFileView } from "../../frontend/ast/declaration-views";
import { FunctionDeclarationView } from "../../frontend/ast/function-views";
import { BlockView } from "../../frontend/ast/statement-views";
import * as stmtViews from "../../frontend/ast/statement-views";
import * as exprViews from "../../frontend/ast/expression-views";
import type { ExpressionView } from "../../frontend/ast/expression-views";
import { PatternView } from "../../frontend/ast/pattern-views";
import { RequiresSectionView, RequireSectionView } from "../../frontend/ast/requirement-views";
import { presentTokenText, presentTokenSpan } from "../../frontend/ast/syntax-query";
import type { TypeParameterView } from "../../frontend/ast/type-views";
import { RedNode, SyntaxKind } from "../../frontend/syntax";
import { SourceSpan, SourceText } from "../../frontend";
import type { ItemIndex } from "../item-index";
import type { ItemRecord } from "../item-index/item-records";
import type { TypeParameterOwner } from "../item-index/item-records";
import type { ModuleId, ItemId } from "../ids";
import type { CoreTypeCatalog } from "./core-types";
import type { ModuleNamespace } from "./module-namespace";
import type { MemberNamespace } from "./member-namespace";
import { ReferenceKeyBuilder } from "./reference-key";
import { ResolvedReferencesBuilder } from "./resolution-result";
import type { Scope } from "./scope";
import {
  scopeBuilder,
  parameterCandidate,
  resolvedReferenceForItem,
  typeParameterCandidate,
} from "./scope";
import type { ScopeCandidate } from "./scope";
import type { NameResolutionDiagnostic, NameReferenceKind } from "./diagnostics";
import * as DiagnosticsModule from "./diagnostics";
import { resolveTypeReference, type ModuleResolutionContext } from "./type-reference-resolver";
import type { NameResolutionPartResult } from "./type-reference-resolver";
import type { ResolvedReference } from "./reference";

export interface ResolveExpressionsInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly coreTypes: CoreTypeCatalog;
  readonly moduleNamespace: ModuleNamespace;
  readonly memberNamespace: MemberNamespace;
  readonly moduleContexts: readonly ModuleResolutionContext[];
  readonly referenceKeys: ReferenceKeyBuilder;
}

interface ResolutionWalkContext {
  readonly moduleId: ModuleId;
  readonly source: SourceText;
  readonly scope: Scope;
  readonly localNames: ReadonlySet<string>;
  readonly index: ItemIndex;
  readonly coreTypes: CoreTypeCatalog;
  readonly moduleNamespace: ModuleNamespace;
  readonly memberNamespace: MemberNamespace;
  readonly referenceKeys: ReferenceKeyBuilder;
  readonly references: ResolvedReferencesBuilder;
  readonly diagnostics: NameResolutionDiagnostic[];
}

function chainScope(higher: Scope, lower: Scope): Scope {
  return {
    lookup(namespace, name) {
      const result = higher.lookup(namespace, name);
      if (result.kind !== "unresolved") return result;
      return lower.lookup(namespace, name);
    },
    lookupType(name) {
      return this.lookup("type", name);
    },
    lookupValue(name) {
      return this.lookup("value", name);
    },
  };
}

export function resolveExpressions(input: ResolveExpressionsInput): NameResolutionPartResult {
  const {
    graph,
    index,
    coreTypes,
    moduleNamespace,
    memberNamespace,
    moduleContexts,
    referenceKeys,
  } = input;
  const references = new ResolvedReferencesBuilder();
  const diagnostics: NameResolutionDiagnostic[] = [];

  const moduleByPathKey = new Map<string, ParsedModule>();
  for (const mod of graph.modules) {
    moduleByPathKey.set(mod.path.key, mod);
  }

  const contextBase: Omit<ResolutionWalkContext, "scope" | "moduleId" | "source" | "localNames"> = {
    index,
    coreTypes,
    moduleNamespace,
    memberNamespace,
    referenceKeys,
    references,
    diagnostics,
  };

  for (const context of moduleContexts) {
    const parsedModule = moduleByPathKey.get(index.module(context.moduleId)?.pathKey ?? "");
    if (parsedModule === undefined) continue;

    const root = parsedModule.tree.root();
    const sourceFile = SourceFileView.fromRoot(root);
    if (sourceFile === undefined) continue;

    const moduleItems = index
      .itemsInModule(context.moduleId)
      .filter((item) => item.parentItemId === undefined);

    const itemsByName = new Map<string, ItemRecord>();
    for (const item of moduleItems) {
      itemsByName.set(item.name, item);
    }

    const decls = sourceFile.declarations();
    for (const decl of decls) {
      const declName = decl.nameText();
      const topItem = declName !== undefined ? itemsByName.get(declName) : undefined;
      const wCtx: ResolutionWalkContext = {
        ...contextBase,
        moduleId: context.moduleId,
        source: context.source,
        scope: context.scope,
        localNames: new Set(),
      };
      walkDeclaration(decl, topItem, wCtx);
    }
  }

  return {
    references: references.build(),
    diagnostics: DiagnosticsModule.sortNameResolutionDiagnostics(diagnostics),
  };
}

function hasMemberFunctions(
  decl: unknown,
): decl is { memberFunctions(): FunctionDeclarationView[] } {
  return (
    typeof decl === "object" &&
    decl !== null &&
    "memberFunctions" in decl &&
    typeof (decl as any).memberFunctions === "function"
  );
}

function walkDeclaration(
  decl: unknown,
  topItem: ItemRecord | undefined,
  context: ResolutionWalkContext,
): void {
  if (decl instanceof FunctionDeclarationView) {
    walkFunction(decl, topItem, context);
  } else if (hasMemberFunctions(decl)) {
    for (const memFunc of decl.memberFunctions()) {
      walkFunction(memFunc, topItem, context);
    }
  }
}

function buildTypeParamScopeCandidates(
  typeParams: TypeParameterView[],
  owner: TypeParameterOwner,
): ReturnType<typeof typeParameterCandidate>[] {
  return typeParams
    .map((typeParam, index) => {
      const name = typeParam.nameText();
      if (name === undefined) return undefined;
      return typeParameterCandidate(name, owner, index);
    })
    .filter(
      (candidate): candidate is ReturnType<typeof typeParameterCandidate> =>
        candidate !== undefined,
    );
}

function walkFunction(
  func: FunctionDeclarationView,
  topItem: ItemRecord | undefined,
  context: ResolutionWalkContext,
): void {
  let funcScope = context.scope;
  const typeParams = func.typeParameters();
  let typeParamOwner: TypeParameterOwner | undefined;
  if (topItem?.functionId !== undefined) {
    typeParamOwner = { kind: "function", itemId: topItem.id, functionId: topItem.functionId };
  } else if (topItem !== undefined) {
    typeParamOwner = { kind: "item", itemId: topItem.id };
  }
  if (typeParams.length > 0 && typeParamOwner !== undefined) {
    const typeParamScope = scopeBuilder()
      .addTier("functionTypeParameters", buildTypeParamScopeCandidates(typeParams, typeParamOwner))
      .build();
    funcScope = chainScope(typeParamScope, funcScope);
  }

  if (topItem?.functionId !== undefined) {
    const funcRecord = context.index.function(topItem.functionId);
    if (funcRecord !== undefined) {
      const paramRecords = context.index.parametersForFunction(funcRecord.id);
      const paramCandidates: ScopeCandidate[] = [];
      for (const paramRecord of paramRecords) {
        paramCandidates.push(parameterCandidate(paramRecord.name, paramRecord.id));
      }
      if (paramCandidates.length > 0) {
        const paramScope = scopeBuilder().addTier("parameters", paramCandidates).build();
        funcScope = chainScope(paramScope, funcScope);
      }
    }
  }

  const funcCtx: ResolutionWalkContext = { ...context, scope: funcScope, localNames: new Set() };

  const body = func.body();
  if (body !== undefined) {
    walkBlock(body, funcCtx);
  }

  const requiresSections = func.requiresSections();
  for (const section of requiresSections) {
    walkRequiresSection(section, funcCtx);
  }
}

function walkRequiresSection(
  section: RequiresSectionView | RequireSectionView,
  context: ResolutionWalkContext,
): void {
  for (const req of section.requirements()) {
    const expr = req.expression();
    if (expr !== undefined) {
      resolveExpression(expr, context);
    }
  }
}

function walkBlock(block: BlockView, context: ResolutionWalkContext): void {
  let blockContext = context;
  for (const item of block.items()) {
    blockContext = walkStatement(item, blockContext);
  }
}

function walkStatement(node: RedNode, context: ResolutionWalkContext): ResolutionWalkContext {
  switch (node.kind) {
    case SyntaxKind.LetStatement: {
      const letStmt = stmtViews.LetStatementView.from(node);
      if (letStmt === undefined) break;
      const annotation = letStmt.type();
      if (annotation !== undefined) {
        resolveTypeReference(annotation, context);
      }
      const init = letStmt.value();
      if (init !== undefined) {
        resolveExpression(init, context);
      }
      return contextWithLocalPatternNames(context, letStmt.pattern());
    }
    case SyntaxKind.IfStatement: {
      const ifStmt = stmtViews.IfStatementView.from(node);
      if (ifStmt === undefined) break;
      const cond = ifStmt.condition();
      let bodyContext = context;
      if (cond !== undefined) {
        const expr = cond.expression();
        if (expr !== undefined) resolveExpression(expr, context);
        bodyContext = contextWithLocalPatternNames(context, cond.pattern());
      }
      const body = ifStmt.body();
      if (body !== undefined) walkBlock(body, bodyContext);
      const elseClause = ifStmt.elseClause();
      if (elseClause !== undefined) {
        const elseBody = elseClause.body();
        if (elseBody !== undefined) walkBlock(elseBody, context);
        const elseStmt = elseClause.statement();
        if (elseStmt instanceof RedNode) walkStatement(elseStmt, context);
      }
      break;
    }
    case SyntaxKind.WhileStatement: {
      const whileStmt = stmtViews.WhileStatementView.from(node);
      if (whileStmt === undefined) break;
      const cond = whileStmt.condition();
      let bodyContext = context;
      if (cond !== undefined) {
        const expr = cond.expression();
        if (expr !== undefined) resolveExpression(expr, context);
        bodyContext = contextWithLocalPatternNames(context, cond.pattern());
      }
      const body = whileStmt.body();
      if (body !== undefined) walkBlock(body, bodyContext);
      break;
    }
    case SyntaxKind.ForStatement: {
      const forStmt = stmtViews.ForStatementView.from(node);
      if (forStmt === undefined) break;
      const iterable = forStmt.iterable();
      if (iterable !== undefined) resolveExpression(iterable, context);
      const bodyContext = contextWithLocalPatternNames(context, forStmt.pattern());
      const body = forStmt.body();
      if (body !== undefined) walkBlock(body, bodyContext);
      break;
    }
    case SyntaxKind.LoopStatement: {
      const loopStmt = stmtViews.LoopStatementView.from(node);
      if (loopStmt === undefined) break;
      const body = loopStmt.body();
      if (body !== undefined) walkBlock(body, context);
      break;
    }
    case SyntaxKind.MatchStatement: {
      const matchStmt = stmtViews.MatchStatementView.from(node);
      if (matchStmt === undefined) break;
      const expr = matchStmt.condition()?.expression() ?? matchStmt.expression();
      if (expr !== undefined) resolveExpression(expr, context);
      for (const arm of matchStmt.arms()) {
        const pattern = arm.pattern();
        if (pattern !== undefined) {
          resolvePattern(pattern, context);
        }
        const armContext = contextWithLocalPatternNames(context, pattern);
        const armBody = arm.body();
        if (armBody !== undefined) walkBlock(armBody, armContext);
      }
      break;
    }
    case SyntaxKind.ReturnStatement: {
      const returnStmt = stmtViews.ReturnStatementView.from(node);
      if (returnStmt === undefined) break;
      const expr = returnStmt.expression();
      if (expr !== undefined) resolveExpression(expr, context);
      break;
    }
    case SyntaxKind.YieldStatement: {
      const yieldStmt = stmtViews.YieldStatementView.from(node);
      if (yieldStmt === undefined) break;
      const expr = yieldStmt.expression();
      if (expr !== undefined) resolveExpression(expr, context);
      break;
    }
    case SyntaxKind.ContinueStatement: {
      break;
    }
    case SyntaxKind.EnsureStatement: {
      const ensureStmt = stmtViews.EnsureStatementView.from(node);
      if (ensureStmt === undefined) break;
      const expr = ensureStmt.expression();
      if (expr !== undefined) resolveExpression(expr, context);
      break;
    }
    case SyntaxKind.TakeStatement: {
      const takeStmt = stmtViews.TakeStatementView.from(node);
      if (takeStmt === undefined) break;
      const expr = takeStmt.expression();
      if (expr !== undefined) resolveExpression(expr, context);
      const bodyContext = contextWithLocalName(context, takeStmt.aliasText());
      const body = takeStmt.body();
      if (body !== undefined) walkBlock(body, bodyContext);
      break;
    }
    case SyntaxKind.AssignmentStatement: {
      const assignStmt = stmtViews.AssignmentStatementView.from(node);
      if (assignStmt === undefined) break;
      const target = assignStmt.target();
      if (target !== undefined) resolveExpression(target, context);
      const value = assignStmt.value();
      if (value !== undefined) resolveExpression(value, context);
      break;
    }
    case SyntaxKind.ExpressionStatement: {
      const exprStmt = stmtViews.ExpressionStatementView.from(node);
      if (exprStmt === undefined) break;
      const expr = exprStmt.expression();
      if (expr !== undefined) resolveExpression(expr, context);
      break;
    }
    case SyntaxKind.Block: {
      const innerBlock = BlockView.from(node);
      if (innerBlock !== undefined) walkBlock(innerBlock, context);
      break;
    }
  }
  return context;
}

function contextWithLocalPatternNames(
  context: ResolutionWalkContext,
  pattern: PatternView | undefined,
): ResolutionWalkContext {
  if (pattern === undefined) return context;

  const names = collectLocalPatternNames(pattern);
  if (names.length === 0) return context;

  return contextWithLocalNames(context, names);
}

function contextWithLocalName(
  context: ResolutionWalkContext,
  name: string | undefined,
): ResolutionWalkContext {
  if (name === undefined) return context;
  return contextWithLocalNames(context, [name]);
}

function contextWithLocalNames(
  context: ResolutionWalkContext,
  names: readonly string[],
): ResolutionWalkContext {
  const localNames = new Set(context.localNames);
  for (const name of names) {
    localNames.add(name);
  }
  return { ...context, localNames };
}

function collectLocalPatternNames(pattern: PatternView): string[] {
  const patternList = pattern.patternList();
  if (patternList !== undefined) {
    return patternList.patterns().flatMap((child) => collectLocalPatternNames(child));
  }

  const qualifiedName = pattern.qualifiedName();
  if (qualifiedName === undefined) return [];

  const segments = qualifiedName.segments();
  if (segments.length !== 1) return [];

  const name = presentTokenText(segments[0]);
  return name === undefined ? [] : [name];
}

function resolveExpression(expr: ExpressionView, context: ResolutionWalkContext): void {
  if (expr instanceof exprViews.NameExpressionView) {
    resolveSimpleNameExpression(expr, context);
  } else if (expr instanceof exprViews.MemberAccessExpressionView) {
    resolveMemberAccessExpression(expr, context);
  } else if (expr instanceof exprViews.CallExpressionView) {
    resolveCallExpression(expr, context);
  } else if (expr instanceof exprViews.TypeApplicationExpressionView) {
    const subExpr = expr.expression();
    if (subExpr !== undefined) resolveExpression(subExpr, context);
    for (const typeArg of expr.typeArguments()) {
      resolveTypeReference(typeArg, context);
    }
  } else if (expr instanceof exprViews.AttemptExpressionView) {
    const subExpr = expr.expression();
    if (subExpr !== undefined) resolveExpression(subExpr, context);
    const altExpr = expr.alternative();
    if (altExpr !== undefined) resolveExpression(altExpr, context);
  } else if (expr instanceof exprViews.UnaryExpressionView) {
    const operand = expr.operand();
    if (operand !== undefined) resolveExpression(operand, context);
  } else if (expr instanceof exprViews.BinaryExpressionView) {
    const left = expr.left();
    if (left !== undefined) resolveExpression(left, context);
    const right = expr.right();
    if (right !== undefined) resolveExpression(right, context);
  } else if (expr instanceof exprViews.ComparisonExpressionView) {
    const left = expr.left();
    if (left !== undefined) resolveExpression(left, context);
    const right = expr.right();
    if (right !== undefined) resolveExpression(right, context);
  } else if (expr instanceof exprViews.EqualityExpressionView) {
    const left = expr.left();
    if (left !== undefined) resolveExpression(left, context);
    const right = expr.right();
    if (right !== undefined) resolveExpression(right, context);
  } else if (expr instanceof exprViews.ObjectLiteralExpressionView) {
    for (const field of expr.fields()) {
      const value = field.value();
      if (value !== undefined) resolveExpression(value, context);
    }
  } else if (expr instanceof exprViews.ElseRequirementExpressionView) {
    const cond = expr.condition();
    if (cond !== undefined) resolveExpression(cond, context);
    const alt = expr.alternative();
    if (alt !== undefined) resolveExpression(alt, context);
  }
}

function resolveSimpleNameExpression(
  expr: exprViews.NameExpressionView,
  context: ResolutionWalkContext,
): void {
  const name = expr.nameText();
  if (name === undefined) return;
  if (name === "true" || name === "false") return;
  const nameToken = expr.nameToken();
  if (nameToken === undefined) return;
  const span = presentTokenSpan(nameToken);
  if (span === undefined) return;

  const scopeResult = context.scope.lookupValue(name);
  if (scopeResult.kind === "resolved") {
    const kind = referenceKindFromResolved(scopeResult.reference, context);
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span,
      kind,
    });
    context.references.add(key, scopeResult.reference);
  } else if (context.localNames.has(name)) {
    return;
  } else {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span,
      kind: "functionName",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span,
        order: {
          moduleId: context.moduleId,
          span,
          kind: "functionName",
          ordinal: key.ordinal,
        },
        name,
      }),
    );
  }
}

function resolveCallExpression(
  expr: exprViews.CallExpressionView,
  context: ResolutionWalkContext,
): void {
  const callee = expr.callee();
  if (callee === undefined) return;

  if (callee instanceof exprViews.NameExpressionView) {
    resolveCalleeName(callee, context);
  } else {
    resolveExpression(callee, context);
  }

  const argList = expr.argumentList();
  if (argList !== undefined) {
    for (const arg of argList.arguments()) {
      if (arg instanceof exprViews.ArgumentView) {
        const argExpr = arg.expression();
        if (argExpr !== undefined) resolveExpression(argExpr, context);
      } else if (arg instanceof exprViews.NamedArgumentView) {
        const argExpr = arg.value();
        if (argExpr !== undefined) resolveExpression(argExpr, context);
      }
    }
  }
}

function resolveCalleeName(
  expr: exprViews.NameExpressionView,
  context: ResolutionWalkContext,
): void {
  const name = expr.nameText();
  if (name === undefined) return;
  const nameToken = expr.nameToken();
  if (nameToken === undefined) return;
  const span = presentTokenSpan(nameToken);
  if (span === undefined) return;

  const scopeResult = context.scope.lookupValue(name);
  if (scopeResult.kind === "resolved") {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span,
      kind: "functionName",
    });
    context.references.add(key, scopeResult.reference);
  } else {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span,
      kind: "functionName",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span,
        order: {
          moduleId: context.moduleId,
          span,
          kind: "functionName",
          ordinal: key.ordinal,
        },
        name,
      }),
    );
  }
}

interface FlattenedChain {
  readonly base: ExpressionView;
  readonly segments: string[];
  readonly memberSpans: SourceSpan[];
}

function flattenMemberChain(
  expr: exprViews.MemberAccessExpressionView,
): FlattenedChain | undefined {
  const segments: string[] = [];
  const memberSpans: SourceSpan[] = [];
  let current: ExpressionView = expr;

  while (current instanceof exprViews.MemberAccessExpressionView) {
    const memberName = current.memberName();
    const memberToken = current.memberToken();
    const memberSpan = memberToken ? presentTokenSpan(memberToken) : undefined;
    if (memberName === undefined || memberSpan === undefined) return undefined;

    segments.unshift(memberName);
    memberSpans.unshift(memberSpan);

    const receiver = current.receiver();
    if (receiver === undefined) return undefined;
    current = receiver;
  }

  return { base: current, segments, memberSpans };
}

function resolveMemberAccessExpression(
  expr: exprViews.MemberAccessExpressionView,
  context: ResolutionWalkContext,
): void {
  const flattened = flattenMemberChain(expr);
  if (flattened === undefined) return;

  const { base, segments, memberSpans } = flattened;

  let baseName: string | undefined;
  let baseSpan: SourceSpan | undefined;
  if (base instanceof exprViews.NameExpressionView) {
    baseName = base.nameText();
    const baseToken = base.nameToken();
    if (baseToken !== undefined) {
      baseSpan = presentTokenSpan(baseToken);
    }
  }

  if (baseName === undefined || baseSpan === undefined) {
    resolveExpression(base, context);
    for (let index = 0; index < segments.length; index++) {
      const memberSpan = memberSpans[index]!;
      context.references.addDeferredMember({
        key: context.referenceKeys.next({
          moduleId: context.moduleId,
          span: memberSpan,
          kind: "memberName",
        }),
        receiverExpressionKey: undefined,
        memberName: segments[index]!,
        memberSpan,
        allowedNamespaces: ["field", "function", "enumCase", "imageDevice"],
      });
    }
    return;
  }

  const fullSegments = [baseName, ...segments];

  if (context.localNames.has(baseName)) {
    return;
  }

  const prefixResult = context.moduleNamespace.resolveQualifiedPrefix(fullSegments);

  if (prefixResult.kind === "resolved") {
    resolveModuleQualifiedChain(prefixResult, segments, memberSpans, baseSpan, baseName, context);
    return;
  }

  if (prefixResult.kind === "prefixConsumesAllSegments") {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: baseSpan,
      kind: "moduleQualifiedItem",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: baseSpan,
        order: {
          moduleId: context.moduleId,
          span: baseSpan,
          kind: "moduleQualifiedItem",
          ordinal: key.ordinal,
        },
        name: fullSegments.join("."),
      }),
    );
    return;
  }

  let ownerResult = context.scope.lookupValue(baseName);
  if (ownerResult.kind === "unresolved") {
    const typeResult = context.scope.lookupType(baseName);
    if (typeResult.kind === "resolved" || typeResult.kind === "ambiguous") {
      ownerResult = typeResult;
    }
  }

  if (ownerResult.kind === "resolved") {
    const ownerRef = ownerResult.reference;
    const ownerKind = referenceKindFromResolved(ownerRef, context);
    const ownerKey = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: baseSpan,
      kind: ownerKind,
    });
    context.references.add(ownerKey, ownerRef);

    const ownerItemId = getOwnerItemId(ownerRef, context);
    if (ownerItemId !== undefined) {
      resolveMembersOnOwner(ownerItemId, segments, memberSpans, baseName, ownerKey, context);
    } else if (ownerRef.kind === "function") {
      const key = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: baseSpan,
        kind: "functionName",
      });
      context.diagnostics.push(
        DiagnosticsModule.qualifierNotOwner({
          source: context.source,
          span: baseSpan,
          order: {
            moduleId: context.moduleId,
            span: baseSpan,
            kind: "functionName",
            ordinal: key.ordinal,
          },
          qualifier: baseName,
        }),
      );
    } else {
      deferAllMembers(segments, memberSpans, ownerKey, context);
    }
  } else if (ownerResult.kind === "ambiguous") {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: baseSpan,
      kind: "functionName",
    });
    context.diagnostics.push(
      DiagnosticsModule.ambiguousName({
        source: context.source,
        span: baseSpan,
        order: {
          moduleId: context.moduleId,
          span: baseSpan,
          kind: "functionName",
          ordinal: key.ordinal,
        },
        name: baseName,
        candidates: ownerResult.candidates.map((candidate) => candidate.display),
      }),
    );
  } else {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: baseSpan,
      kind: "functionName",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: baseSpan,
        order: {
          moduleId: context.moduleId,
          span: baseSpan,
          kind: "functionName",
          ordinal: key.ordinal,
        },
        name: baseName,
      }),
    );
  }
}

function resolveModuleQualifiedChain(
  prefixResult: {
    moduleId: ModuleId;
    moduleSegments: readonly string[];
    itemSegment: string;
    memberSegments: readonly string[];
  },
  segments: string[],
  memberSpans: SourceSpan[],
  baseSpan: SourceSpan,
  baseName: string,
  context: ResolutionWalkContext,
): void {
  const targetItems = context.index.itemsInModule(prefixResult.moduleId);
  const matchedItems = targetItems.filter((item) => item.name === prefixResult.itemSegment);

  const itemSegIdx = prefixResult.moduleSegments.length;
  const segmentIndex = itemSegIdx - 1;

  let itemSpan: SourceSpan;
  if (segmentIndex >= 0 && segments.length > segmentIndex) {
    itemSpan = memberSpans[segmentIndex]!;
  } else {
    itemSpan = baseSpan;
  }

  if (matchedItems.length === 0) {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: itemSpan,
      kind: "moduleQualifiedItem",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: itemSpan,
        order: {
          moduleId: context.moduleId,
          span: itemSpan,
          kind: "moduleQualifiedItem",
          ordinal: key.ordinal,
        },
        name: prefixResult.itemSegment,
      }),
    );
    return;
  }

  const item = matchedItems[0]!;
  const ref = resolvedReferenceForItem(context.index, item);
  const refKey = context.referenceKeys.next({
    moduleId: context.moduleId,
    span: itemSpan,
    kind: "moduleQualifiedItem",
  });
  context.references.add(refKey, ref);

  if (prefixResult.memberSegments.length > 0) {
    resolveRemainingMembers(item.id, prefixResult.memberSegments, segments, memberSpans, context);
  }
}

function resolveRemainingMembers(
  ownerItemId: ItemId,
  memberSegments: readonly string[],
  allMemberSegments: string[],
  memberSpans: SourceSpan[],
  context: ResolutionWalkContext,
): void {
  const knownOwner = context.index.item(ownerItemId);
  const ownerName = knownOwner?.name ?? "";

  for (let index = 0; index < memberSegments.length; index++) {
    const memberName = memberSegments[index]!;
    const memberSpan = memberSpans[allMemberSegments.length - memberSegments.length + index]!;

    const memberResult = context.memberNamespace.resolveMember({
      ownerItemId,
      name: memberName,
    });

    if (memberResult.kind === "resolved") {
      const ref = memberResult.reference;
      const refKind: NameReferenceKind =
        ref.kind === "field"
          ? "fieldName"
          : ref.kind === "function"
            ? "functionName"
            : "memberName";
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: refKind,
      });
      context.references.add(memberKey, ref);
    } else if (memberResult.kind === "ambiguous") {
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: "memberName",
      });
      context.diagnostics.push(
        DiagnosticsModule.ambiguousMember({
          source: context.source,
          span: memberSpan,
          order: {
            moduleId: context.moduleId,
            span: memberSpan,
            kind: "memberName",
            ordinal: memberKey.ordinal,
          },
          ownerName,
          memberName,
          candidates: memberResult.candidates.map((candidate) => ({
            modulePath: "",
            itemKind: candidate.kind,
            name: memberName,
            denseId:
              "itemId" in candidate
                ? (candidate.itemId as number)
                : "fieldId" in candidate
                  ? (candidate.fieldId as number)
                  : 0,
          })),
        }),
      );
    } else {
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: "memberName",
      });
      context.diagnostics.push(
        DiagnosticsModule.unresolvedMember({
          source: context.source,
          span: memberSpan,
          order: {
            moduleId: context.moduleId,
            span: memberSpan,
            kind: "memberName",
            ordinal: memberKey.ordinal,
          },
          ownerName,
          memberName,
        }),
      );
    }
  }
}

function resolveMembersOnOwner(
  ownerItemId: ItemId,
  segments: string[],
  memberSpans: SourceSpan[],
  ownerName: string,
  ownerKey: { moduleId: ModuleId; span: SourceSpan; kind: NameReferenceKind; ordinal: number },
  context: ResolutionWalkContext,
): void {
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const memberName = segments[segmentIndex]!;
    const memberSpan = memberSpans[segmentIndex]!;

    const memberResult = context.memberNamespace.resolveMember({
      ownerItemId,
      name: memberName,
    });

    if (memberResult.kind === "resolved") {
      const ref = memberResult.reference;
      const refKind: NameReferenceKind =
        ref.kind === "field"
          ? "fieldName"
          : ref.kind === "function"
            ? "functionName"
            : ref.kind === "item"
              ? "enumCase"
              : "memberName";
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: refKind,
      });
      context.references.add(memberKey, ref);
    } else if (memberResult.kind === "ambiguous") {
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: "memberName",
      });
      context.diagnostics.push(
        DiagnosticsModule.ambiguousMember({
          source: context.source,
          span: memberSpan,
          order: {
            moduleId: context.moduleId,
            span: memberSpan,
            kind: "memberName",
            ordinal: memberKey.ordinal,
          },
          ownerName,
          memberName,
          candidates: memberResult.candidates.map((candidate) => ({
            modulePath: "",
            itemKind: candidate.kind,
            name: memberName,
            denseId:
              "itemId" in candidate
                ? (candidate.itemId as number)
                : "fieldId" in candidate
                  ? (candidate.fieldId as number)
                  : 0,
          })),
        }),
      );
    } else {
      const memberKey = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: memberSpan,
        kind: "memberName",
      });
      context.diagnostics.push(
        DiagnosticsModule.unresolvedMember({
          source: context.source,
          span: memberSpan,
          order: {
            moduleId: context.moduleId,
            span: memberSpan,
            kind: "memberName",
            ordinal: memberKey.ordinal,
          },
          ownerName,
          memberName,
        }),
      );
    }
  }
}

function deferAllMembers(
  segments: string[],
  memberSpans: SourceSpan[],
  previousKey:
    | { moduleId: ModuleId; span: SourceSpan; kind: NameReferenceKind; ordinal: number }
    | undefined,
  context: ResolutionWalkContext,
): void {
  let currentReceiverKey = previousKey;
  for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
    const memberName = segments[segmentIndex]!;
    const memberSpan = memberSpans[segmentIndex]!;
    const deferKey = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: memberSpan,
      kind: "memberName",
    });
    context.references.addDeferredMember({
      key: deferKey,
      receiverExpressionKey: currentReceiverKey,
      memberName,
      memberSpan,
      allowedNamespaces: ["field", "function", "enumCase", "imageDevice"],
    });
    currentReceiverKey = deferKey;
  }
}

function getOwnerItemId(
  ref: ResolvedReference,
  context: ResolutionWalkContext,
): ItemId | undefined {
  switch (ref.kind) {
    case "type":
    case "item":
      return ref.itemId;
    case "image": {
      const imageRec = context.index.image(ref.imageId);
      return imageRec?.itemId;
    }
    default:
      return undefined;
  }
}

function referenceKindFromResolved(
  ref: ResolvedReference,
  context: ResolutionWalkContext,
): NameReferenceKind {
  switch (ref.kind) {
    case "function":
      return "functionName";
    case "parameter":
      return "parameter";
    case "image":
      return "imageName";
    case "item": {
      const itemRecord = context.index.item(ref.itemId);
      if (itemRecord?.parentItemId !== undefined) {
        return "enumCase";
      }
      return "importedItem";
    }
    case "type":
      return "typeName";
    case "builtinType":
    case "targetType":
      return "typeName";
    case "compilerIntrinsic":
      return "functionName";
    case "typeParameter":
      return "typeParameter";
    case "field":
      return "fieldName";
    case "module":
      return "importModule";
  }
}

function resolvePattern(pattern: PatternView, context: ResolutionWalkContext): void {
  const qualifiedName = pattern.qualifiedName();
  if (qualifiedName === undefined) return;

  const segmentsNodes = qualifiedName.segments();
  const segTexts = segmentsNodes
    .map((token) => presentTokenText(token))
    .filter((text): text is string => text !== undefined);

  if (segTexts.length === 0) return;

  if (segTexts.length === 1) {
    const name = segTexts[0]!;
    const scopeResult = context.scope.lookupValue(name);
    if (scopeResult.kind === "resolved") {
      const firstSpan = presentTokenSpan(segmentsNodes[0]);
      if (firstSpan === undefined) return;
      const nameSpan = SourceSpan.from(firstSpan.start, firstSpan.end);
      const kind = referenceKindFromResolved(scopeResult.reference, context);
      const key = context.referenceKeys.next({
        moduleId: context.moduleId,
        span: nameSpan,
        kind,
      });
      context.references.add(key, scopeResult.reference);
    }
    return;
  }

  const firstSpan = presentTokenSpan(segmentsNodes[0]);
  const lastSpan = presentTokenSpan(segmentsNodes[segmentsNodes.length - 1]);
  if (firstSpan === undefined || lastSpan === undefined) return;
  const qnSpan = SourceSpan.from(firstSpan.start, lastSpan.end);
  const modulePrefixResult = context.moduleNamespace.resolveQualifiedPrefix(segTexts);

  if (modulePrefixResult.kind === "noModulePrefix") {
    let ownerResult = context.scope.lookupValue(segTexts[0]!);
    if (ownerResult.kind === "unresolved") {
      const typeResult = context.scope.lookupType(segTexts[0]!);
      if (typeResult.kind === "resolved" || typeResult.kind === "ambiguous") {
        ownerResult = typeResult;
      }
    }
    if (ownerResult.kind === "resolved") {
      const ownerRef = ownerResult.reference;
      const ownerItemId = getOwnerItemId(ownerRef, context);
      if (ownerItemId !== undefined) {
        const ownerKey = context.referenceKeys.next({
          moduleId: context.moduleId,
          span: qnSpan,
          kind: "enumCase",
        });
        context.references.add(ownerKey, ownerRef);

        const memberSegments = segTexts.slice(1);
        for (let memberIndex = 0; memberIndex < memberSegments.length; memberIndex++) {
          const memberName = memberSegments[memberIndex]!;
          const memberSpan = getSegmentSpan(segmentsNodes, segTexts.indexOf(memberName));
          if (memberSpan === undefined) continue;

          const memberResult = context.memberNamespace.resolveMember({
            ownerItemId,
            name: memberName,
          });
          if (memberResult.kind === "resolved") {
            const refKind: NameReferenceKind =
              memberResult.reference.kind === "field"
                ? "fieldName"
                : memberResult.reference.kind === "function"
                  ? "functionName"
                  : "enumCase";
            const memKey = context.referenceKeys.next({
              moduleId: context.moduleId,
              span: memberSpan,
              kind: refKind,
            });
            context.references.add(memKey, memberResult.reference);
          }
        }
      }
    }
    return;
  }

  if (modulePrefixResult.kind === "prefixConsumesAllSegments") {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: qnSpan,
      kind: "enumCase",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: qnSpan,
        order: {
          moduleId: context.moduleId,
          span: qnSpan,
          kind: "enumCase",
          ordinal: key.ordinal,
        },
        name: `Qualified name '${segTexts.join(".")}' resolves to a module, not an item.`,
      }),
    );
    return;
  }

  const targetItems = context.index.itemsInModule(modulePrefixResult.moduleId);
  const matchedItems = targetItems.filter((item) => item.name === modulePrefixResult.itemSegment);

  if (matchedItems.length === 0) {
    const itemSegIdx = modulePrefixResult.moduleSegments.length;
    const itemSpan = getSegmentSpan(segmentsNodes, itemSegIdx);
    if (itemSpan === undefined) return;
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span: itemSpan,
      kind: "moduleQualifiedItem",
    });
    context.diagnostics.push(
      DiagnosticsModule.unresolvedName({
        source: context.source,
        span: itemSpan,
        order: {
          moduleId: context.moduleId,
          span: itemSpan,
          kind: "moduleQualifiedItem",
          ordinal: key.ordinal,
        },
        name: modulePrefixResult.itemSegment,
      }),
    );
    return;
  }

  const item = matchedItems[0]!;
  const itemSegIdx = modulePrefixResult.moduleSegments.length;
  const itemSpanResolved = getSegmentSpan(segmentsNodes, itemSegIdx);
  if (itemSpanResolved === undefined) return;

  const ref = resolvedReferenceForItem(context.index, item);
  const refKey = context.referenceKeys.next({
    moduleId: context.moduleId,
    span: itemSpanResolved,
    kind: "moduleQualifiedItem",
  });
  context.references.add(refKey, ref);

  const memberSegmentsToResolve = /* member segments after item */ [];
  const offset = modulePrefixResult.moduleSegments.length + 1;
  for (let segIndex = offset; segIndex < segmentsNodes.length; segIndex++) {
    const memberSpan = getSegmentSpan(segmentsNodes, segIndex);
    if (memberSpan === undefined) continue;
    const memberName = segTexts[segIndex]!;
    memberSegmentsToResolve.push({ name: memberName, span: memberSpan });
  }

  if (item.typeId !== undefined) {
    for (const { name, span } of memberSegmentsToResolve) {
      const memberResult = context.memberNamespace.resolveMember({
        ownerItemId: item.id,
        name,
      });
      if (memberResult.kind === "resolved") {
        const refKind: NameReferenceKind =
          memberResult.reference.kind === "field"
            ? "fieldName"
            : memberResult.reference.kind === "function"
              ? "functionName"
              : "memberName";
        const memKey = context.referenceKeys.next({
          moduleId: context.moduleId,
          span,
          kind: refKind,
        });
        context.references.add(memKey, memberResult.reference);
      }
    }
  }
}

function getSegmentSpan(
  segments: ReturnType<
    typeof import("../../frontend/ast/name-views").QualifiedNameView.prototype.segments
  >,
  index: number,
): SourceSpan | undefined {
  const seg = segments[index];
  if (seg === undefined) return undefined;
  const span = presentTokenSpan(seg);
  if (span === undefined) return undefined;
  return SourceSpan.from(span.start, span.end);
}
