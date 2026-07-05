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
import { SourceText } from "../../frontend";
import type { ItemIndex } from "../item-index";
import type { ItemRecord } from "../item-index/item-records";
import type { TypeParameterOwner } from "../item-index/item-records";
import type { ModuleId, ItemId } from "../ids";
import type { CoreTypeCatalog } from "./core-types";
import type { ModuleNamespace } from "./module-namespace";
import type { MemberNamespace } from "./member-namespace";
import { ReferenceKeyBuilder } from "./reference-key";
import { ResolvedReferencesBuilder } from "./resolution-result";
import type { LocalBindingInput, LocalScope, Scope } from "./scope";
import {
  localReference,
  localScope,
  scopeBuilder,
  parameterCandidate,
  typeParameterCandidate,
} from "./scope";
import type { ScopeCandidate } from "./scope";
import { buildMemberFunctionScope, findMemberFunctionItem } from "./member-function-scope";
import type { NameResolutionDiagnostic, NameReferenceKind } from "./diagnostics";
import * as DiagnosticsModule from "./diagnostics";
import { resolveTypeReference, type ModuleResolutionContext } from "./type-reference-resolver";
import type { NameResolutionPartResult } from "./type-reference-resolver";
import type { ResolvedReference } from "./reference";
import { resolveSimpleNameExpression } from "./expression-resolver/simple-name-resolver";
import { resolveMemberAccessExpression } from "./expression-resolver/member-chain-resolver";
import { resolvePattern } from "./expression-resolver/pattern-resolver";

export { resolveSimpleNameExpression, resolveMemberAccessExpression, resolvePattern };

export interface ResolveExpressionsInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly coreTypes: CoreTypeCatalog;
  readonly moduleNamespace: ModuleNamespace;
  readonly memberNamespace: MemberNamespace;
  readonly moduleContexts: readonly ModuleResolutionContext[];
  readonly referenceKeys: ReferenceKeyBuilder;
}

export interface ResolutionWalkContext {
  readonly moduleId: ModuleId;
  readonly source: SourceText;
  readonly scope: Scope;
  readonly localNames: LocalScope;
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
        localNames: localScope(),
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
  const candidate = decl as { memberFunctions?: unknown } | null;
  return (
    candidate !== null &&
    typeof candidate === "object" &&
    "memberFunctions" in candidate &&
    typeof candidate.memberFunctions === "function"
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
    walkMemberFunctions(decl.memberFunctions(), topItem, context);
  }
}

function walkMemberFunctions(
  memberFunctions: readonly FunctionDeclarationView[],
  ownerItem: ItemRecord | undefined,
  context: ResolutionWalkContext,
): void {
  const memberFunctionScope =
    ownerItem === undefined
      ? undefined
      : buildMemberFunctionScope({ index: context.index, ownerItem });
  const memberContext =
    memberFunctionScope === undefined
      ? context
      : { ...context, scope: chainScope(memberFunctionScope, context.scope) };

  for (const memberFunction of memberFunctions) {
    const functionItem =
      ownerItem === undefined
        ? undefined
        : findMemberFunctionItem({
            index: context.index,
            ownerItem,
            functionView: memberFunction,
          });
    walkFunction(memberFunction, functionItem ?? ownerItem, memberContext);
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

  const funcCtx: ResolutionWalkContext = { ...context, scope: funcScope, localNames: localScope() };

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
      const init = letInitializer(letStmt);
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
      const bodyContext = contextWithLocalName(context, localBindingFromTakeAlias(takeStmt));
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

function letInitializer(letStmt: stmtViews.LetStatementView): ExpressionView | undefined {
  const expressionChildren = letStmt.node
    .children()
    .filter((child): child is RedNode => child instanceof RedNode)
    .map((child) => exprViews.expressionViewFrom(child))
    .filter((expression): expression is ExpressionView => expression !== undefined);
  return expressionChildren[expressionChildren.length - 1];
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

function localBindingFromTakeAlias(
  takeStmt: stmtViews.TakeStatementView,
): LocalBindingInput | undefined {
  const name = takeStmt.aliasText();
  const span = takeStmt.aliasSpan();
  if (name === undefined || span === undefined) return undefined;
  return { name, span };
}

function contextWithLocalName(
  context: ResolutionWalkContext,
  binding: LocalBindingInput | undefined,
): ResolutionWalkContext {
  if (binding === undefined) return context;
  return contextWithLocalNames(context, [binding]);
}

function contextWithLocalNames(
  context: ResolutionWalkContext,
  bindings: readonly LocalBindingInput[],
): ResolutionWalkContext {
  const localNames = context.localNames.add(bindings);
  return { ...context, localNames };
}

function collectLocalPatternNames(pattern: PatternView): LocalBindingInput[] {
  const patternList = pattern.patternList();
  if (patternList !== undefined) {
    return patternList.patterns().flatMap((child) => collectLocalPatternNames(child));
  }

  const qualifiedName = pattern.qualifiedName();
  if (qualifiedName === undefined) return [];

  const segments = qualifiedName.segments();
  if (segments.length !== 1) return [];

  const name = presentTokenText(segments[0]);
  const span = presentTokenSpan(segments[0]);
  return name === undefined || span === undefined ? [] : [{ name, span }];
}

function resolveExpression(expr: ExpressionView, context: ResolutionWalkContext): void {
  if (expr instanceof exprViews.NameExpressionView) {
    resolveSimpleNameExpression(expr, context);
  } else if (expr instanceof exprViews.MemberAccessExpressionView) {
    resolveMemberAccessExpression(expr, context, resolveExpression);
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

  const local = context.localNames.lookup(name);
  if (local !== undefined) {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span,
      kind: "local",
    });
    context.references.add(key, localReference(local));
    return;
  }

  const scopeResult = context.scope.lookupValue(name);
  if (scopeResult.kind === "resolved") {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span,
      kind: "functionName",
    });
    context.references.add(key, scopeResult.reference);
  } else if (scopeResult.kind === "ambiguous") {
    const key = context.referenceKeys.next({
      moduleId: context.moduleId,
      span,
      kind: "functionName",
    });
    context.diagnostics.push(
      DiagnosticsModule.ambiguousName({
        source: context.source,
        span,
        order: {
          moduleId: context.moduleId,
          span,
          kind: "functionName",
          ordinal: key.ordinal,
        },
        name,
        candidates: scopeResult.candidates.map((candidate) => candidate.display),
      }),
    );
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

export function getOwnerItemId(
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

export function referenceKindFromResolved(
  ref: ResolvedReference,
  context: Pick<ResolutionWalkContext, "index">,
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
    case "local":
      return "local";
  }
}
