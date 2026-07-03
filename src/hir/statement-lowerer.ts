import {
  BlockView,
  BreakStatementView,
  ContinueStatementView,
  EnsureStatementView,
  ExpressionStatementView,
  AssignmentStatementView,
  ForStatementView,
  IfStatementView,
  LetStatementView,
  LoopStatementView,
  MatchStatementView,
  ReturnStatementView,
  TakeStatementView,
  WhileStatementView,
  YieldStatementView,
} from "../frontend/ast/statement-views";
import { PatternView } from "../frontend/ast/pattern-views";
import { presentTokenSpan } from "../frontend/ast/syntax-query";
import type { TypeReferenceView } from "../frontend/ast/type-views";
import { RedNode } from "../frontend/syntax/red-node";
import { SyntaxKind } from "../frontend/syntax/syntax-kind";
import {
  appliedType,
  checkedTypesEqual,
  coreCheckedType,
  genericParameterCheckedType,
  sourceCheckedType,
  targetCheckedType,
} from "../semantic/surface/type-model";
import type { CheckedType } from "../semantic/surface/type-model";
import { coreTypeId, type CoreTypeId, type TargetTypeId, type TypeId } from "../semantic/ids";
import {
  matchRefinementMatchKey,
  matchRefinementScrutineeKey,
} from "../semantic/surface/proof-contracts";
import type { HirBlock, HirMatchArm, HirStatement, HirStatementKind } from "./hir";
import type { HirLoweringContext } from "./lowering-context";
import { currentHirModuleId, hirDiagnostic } from "./lowering-context";
import type { HirOriginId, HirStatementId } from "./ids";
import { lowerExpression } from "./expression-lowerer";
import { lowerTakeStatement, classifyForIteration } from "./take-lowerer";
import { lowerValidationMatch, recordValidationResultAlias } from "./validation-lowerer";
import { recordEnsureFact, recordMatchRefinement } from "./fact-lowerer";
import { resourceKindForCheckedType } from "./type-resource-kind";

export interface LowerStatementInput {
  readonly node: RedNode;
  readonly context: HirLoweringContext;
}

function originForStatement(node: RedNode, context: HirLoweringContext) {
  return context.origins.forSyntax({
    moduleId: currentHirModuleId(context),
    node,
    ownerItemId: context.ownerItemId,
    ownerFunctionId: context.ownerFunctionId,
  });
}

function addStatement(
  context: HirLoweringContext,
  node: RedNode,
  kind: HirStatementKind,
): HirStatement {
  return addReservedStatement(context, reserveStatement(context, node), kind);
}

function reserveStatement(
  context: HirLoweringContext,
  node: RedNode,
): { readonly statementId: HirStatementId; readonly sourceOrigin: HirOriginId } {
  return {
    statementId: context.bodyIndex.nextStatementId(),
    sourceOrigin: originForStatement(node, context),
  };
}

function addReservedStatement(
  context: HirLoweringContext,
  reserved: { readonly statementId: HirStatementId; readonly sourceOrigin: HirOriginId },
  kind: HirStatementKind,
): HirStatement {
  const statement = {
    statementId: reserved.statementId,
    kind,
    sourceOrigin: reserved.sourceOrigin,
  };
  context.bodyIndex.addStatement(statement);
  return statement;
}

export function lowerBlock(input: {
  readonly block: BlockView | undefined;
  readonly context: HirLoweringContext;
  readonly sourceOrigin: import("./ids").HirOriginId;
}): HirBlock {
  if (input.block === undefined) return { statements: [], sourceOrigin: input.sourceOrigin };
  return {
    statements: input.block.items().map((node) => lowerStatement({ node, context: input.context })),
    sourceOrigin: input.sourceOrigin,
  };
}

function firstPattern(node: RedNode): PatternView | undefined {
  const patternNode = node
    .children()
    .find(
      (child): child is RedNode => child instanceof RedNode && child.kind === SyntaxKind.Pattern,
    );
  return patternNode !== undefined ? PatternView.from(patternNode) : undefined;
}

function patternText(pattern: PatternView | undefined): string {
  return pattern?.qualifiedName()?.text() ?? "_";
}

function patternBindingName(pattern: PatternView | undefined): string | undefined {
  const qualifiedName = pattern?.qualifiedName();
  if (qualifiedName === undefined) return undefined;
  if (pattern?.patternList() !== undefined) return undefined;
  const segments = qualifiedName.segments();
  if (segments.length !== 1) return undefined;
  return qualifiedName.text();
}

function reportUnsupportedPattern(input: {
  readonly context: HirLoweringContext;
  readonly node: RedNode;
  readonly pattern: PatternView | undefined;
}): void {
  const origin = originForStatement(input.node, input.context);
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_UNSUPPORTED_PATTERN",
      message: "Pattern form is not supported by typed HIR local binding lowering.",
      originId: origin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${origin}`,
      stableDetail: patternText(input.pattern),
    }),
  );
}

function addSourceLocalForPattern(input: {
  readonly context: HirLoweringContext;
  readonly node: RedNode;
  readonly pattern: PatternView | undefined;
  readonly value: import("./hir").HirExpression;
  readonly introducedBy: import("./hir").HirLocal["introducedBy"];
}) {
  const bindingName = patternBindingName(input.pattern);
  if (bindingName === undefined) {
    reportUnsupportedPattern({
      context: input.context,
      node: input.node,
      pattern: input.pattern,
    });
  }
  const name = bindingName ?? patternText(input.pattern);
  const sourceOrigin = originForStatement(input.node, input.context);
  const result = input.context.locals.addSourceLocal({
    name,
    type: input.value.type,
    resourceKind: input.value.resourceKind,
    sourceOrigin,
    introducedBy: input.introducedBy,
  });
  for (const diagnostic of result.diagnostics) input.context.diagnostics.report(diagnostic);
  return result.local;
}

function matchArm(input: {
  readonly context: HirLoweringContext;
  readonly arm: ReturnType<MatchStatementView["arms"]>[number];
  readonly sourceOrigin: import("./ids").HirOriginId;
}): HirMatchArm {
  return {
    patternText: patternText(input.arm.pattern()),
    body: lowerBlock({
      block: input.arm.body(),
      context: input.context,
      sourceOrigin: input.sourceOrigin,
    }),
    bindingLocals: [],
    sourceOrigin: input.sourceOrigin,
  };
}

function reportBoolCondition(input: {
  readonly context: HirLoweringContext;
  readonly node: RedNode;
  readonly expressionType: import("../semantic/surface/type-model").CheckedType;
}): void {
  if (checkedTypesEqual(input.expressionType, coreCheckedType(coreTypeId("bool")))) return;
  const origin = originForStatement(input.node, input.context);
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_CONDITION_NOT_BOOL",
      message: "Condition expression must be bool.",
      originId: origin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${origin}`,
      stableDetail: "condition",
    }),
  );
}

function reportMissingCondition(input: {
  readonly context: HirLoweringContext;
  readonly node: RedNode;
  readonly stableDetail: string;
}): void {
  const origin = originForStatement(input.node, input.context);
  input.context.diagnostics.report(
    hirDiagnostic({
      code: "HIR_UNSUPPORTED_EXPRESSION",
      message: "Condition statement is missing an expression.",
      originId: origin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${origin}`,
      stableDetail: input.stableDetail,
    }),
  );
}

function expectedFunctionReturnType(context: HirLoweringContext) {
  return context.ownerFunctionId !== undefined
    ? context.program.functions.get(context.ownerFunctionId)?.returnType
    : undefined;
}

function expectedFunctionReturnKind(context: HirLoweringContext) {
  return context.ownerFunctionId !== undefined
    ? context.program.functions.get(context.ownerFunctionId)?.returnKind
    : undefined;
}

type CheckedTypeConstructor =
  | { readonly kind: "source"; readonly typeId: TypeId }
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId };

function typeConstructorFor(type: CheckedType): CheckedTypeConstructor | undefined {
  if (type.kind === "source") return { kind: "source", typeId: type.typeId };
  if (type.kind === "core") return { kind: "core", coreTypeId: type.coreTypeId };
  if (type.kind === "target") return { kind: "target", targetTypeId: type.targetTypeId };
  return undefined;
}

function typeReferenceSpan(
  view: TypeReferenceView,
): { readonly start: number; readonly end: number } | undefined {
  const segments = view.qualifiedName()?.segments() ?? [];
  if (segments.length === 0) return undefined;
  const first = presentTokenSpan(segments[0]);
  const last = presentTokenSpan(segments[segments.length - 1]);
  if (first === undefined || last === undefined) return undefined;
  return { start: first.start, end: last.end };
}

function typeFromAnnotation(
  view: TypeReferenceView | undefined,
  context: HirLoweringContext,
): CheckedType | undefined {
  if (view === undefined) return undefined;
  const span = typeReferenceSpan(view);
  if (span === undefined) return undefined;
  const reference =
    context.referenceLookup.referenceForSpan({
      moduleId: currentHirModuleId(context),
      span,
      kind: "typeName",
    }) ??
    context.referenceLookup.referenceForSpan({
      moduleId: currentHirModuleId(context),
      span,
      kind: "typeParameter",
    });

  let baseType: CheckedType | undefined;
  if (reference?.kind === "builtinType") {
    baseType = coreCheckedType(reference.coreTypeId);
  } else if (reference?.kind === "type") {
    baseType = sourceCheckedType({ itemId: reference.itemId, typeId: reference.typeId });
  } else if (reference?.kind === "typeParameter") {
    baseType = genericParameterCheckedType({ owner: reference.owner, index: reference.index });
  } else if (reference?.kind === "targetType") {
    baseType = targetCheckedType(reference.targetTypeId);
  }
  if (baseType === undefined) return undefined;

  const argumentTypes = view
    .typeArguments()
    .map((argument) => typeFromAnnotation(argument, context))
    .filter((type): type is CheckedType => type !== undefined);
  if (argumentTypes.length === 0) return baseType;
  if (argumentTypes.length !== view.typeArguments().length) return undefined;

  const constructor = typeConstructorFor(baseType);
  if (constructor === undefined) return undefined;
  return appliedType({
    constructor,
    arguments: argumentTypes,
    resourceKind: resourceKindForCheckedType(context, baseType),
  });
}

function reportStatementTypeMismatch(input: {
  readonly context: HirLoweringContext;
  readonly node: RedNode;
  readonly actualType: import("../semantic/surface/type-model").CheckedType;
  readonly expectedType: import("../semantic/surface/type-model").CheckedType | undefined;
  readonly code: "HIR_RETURN_TYPE_MISMATCH" | "HIR_YIELD_TYPE_MISMATCH";
  readonly stableDetail: string;
}): void {
  if (input.expectedType === undefined) return;
  if (input.actualType.kind === "error") return;
  if (checkedTypesEqual(input.expectedType, input.actualType)) return;
  const origin = originForStatement(input.node, input.context);
  input.context.diagnostics.report(
    hirDiagnostic({
      code: input.code,
      message: "Statement expression type does not match the checked function signature.",
      originId: origin,
      ownerKey: `function:${input.context.ownerFunctionId ?? 0}`,
      originKey: `origin:${origin}`,
      stableDetail: input.stableDetail,
    }),
  );
}

export function lowerStatement(input: LowerStatementInput): HirStatement {
  const { node, context } = input;

  const loop = LoopStatementView.from(node);
  if (loop !== undefined) {
    const reserved = reserveStatement(context, node);
    return addReservedStatement(context, reserved, {
      kind: "loop",
      body: lowerBlock({ block: loop.body(), context, sourceOrigin: reserved.sourceOrigin }),
    });
  }

  if (BreakStatementView.from(node) !== undefined)
    return addStatement(context, node, { kind: "break" });
  if (ContinueStatementView.from(node) !== undefined) {
    return addStatement(context, node, { kind: "continue" });
  }

  const ensure = EnsureStatementView.from(node);
  if (ensure !== undefined) {
    const reserved = reserveStatement(context, node);
    const expressionView = ensure.expression();
    if (expressionView === undefined) {
      reportMissingCondition({ context, node, stableDetail: "missing-ensure-condition" });
      return addReservedStatement(context, reserved, {
        kind: "error",
        reason: "missing-ensure-condition",
      });
    }
    const expression = lowerExpression({
      view: expressionView,
      context,
      expectedType: coreCheckedType(coreTypeId("bool")),
    });
    reportBoolCondition({ context, node, expressionType: expression.type });
    const statement = addReservedStatement(context, reserved, { kind: "expression", expression });
    if (checkedTypesEqual(expression.type, coreCheckedType(coreTypeId("bool")))) {
      const candidate = {
        statementId: statement.statementId,
        expressionId: expression.expressionId,
        sourceStatementKind: "ensure",
        sourceOrigin: statement.sourceOrigin,
      } as const;
      context.bodyIndex.addEnsureCandidate(candidate);
      recordEnsureFact({ candidate, expression, context });
    }
    return statement;
  }

  const letStatement = LetStatementView.from(node);
  if (letStatement !== undefined) {
    const valueView = letStatement.value();
    const expectedType = typeFromAnnotation(letStatement.type(), context);
    const value =
      valueView !== undefined
        ? lowerExpression({
            view: valueView,
            context,
            ...(expectedType !== undefined ? { expectedType } : {}),
            ...(expectedType !== undefined
              ? { expectedResourceKind: resourceKindForCheckedType(context, expectedType) }
              : {}),
          })
        : undefined;
    if (value !== undefined) {
      const local = addSourceLocalForPattern({
        context,
        node,
        pattern: firstPattern(node),
        value,
        introducedBy: "sourceLet",
      });
      recordValidationResultAlias({ expression: value, local, context });
      return addStatement(context, node, {
        kind: "let",
        statement: { local, value },
      });
    }
  }

  const assignment = AssignmentStatementView.from(node);
  if (assignment !== undefined) {
    const targetView = assignment.target();
    const valueView = assignment.value();
    if (targetView !== undefined && valueView !== undefined) {
      const target = lowerExpression({ view: targetView, context });
      const value = lowerExpression({
        view: valueView,
        context,
        expectedType: target.type,
        expectedResourceKind: target.resourceKind,
      });
      if (target.place === undefined) {
        const origin = originForStatement(node, context);
        context.diagnostics.report(
          hirDiagnostic({
            code: "HIR_NON_PLACE_ASSIGNMENT_TARGET",
            message: "Assignment target is not a writable HIR resource place.",
            originId: origin,
            ownerKey: `function:${context.ownerFunctionId ?? 0}`,
            originKey: `origin:${origin}`,
            stableDetail: "assignment-target",
          }),
        );
      }
      return addStatement(context, node, {
        kind: "assignment",
        statement: {
          target,
          value,
          ...(target.place !== undefined ? { targetPlace: target.place } : {}),
        },
      });
    }
  }

  const take = TakeStatementView.from(node);
  if (take !== undefined) {
    const reserved = reserveStatement(context, node);
    const takeStatement = lowerTakeStatement({
      view: take,
      context,
      lowerExpression,
      lowerBlock,
      statementId: reserved.statementId,
    });
    return addReservedStatement(context, reserved, { kind: "take", statement: takeStatement });
  }

  const forStatement = ForStatementView.from(node);
  if (forStatement !== undefined) {
    const iterableView = forStatement.iterable();
    if (iterableView !== undefined) {
      const reserved = reserveStatement(context, node);
      const iterable = lowerExpression({ view: iterableView, context });
      const iteration = classifyForIteration({
        iterable,
        context,
        sourceOrigin: reserved.sourceOrigin,
        statementId: reserved.statementId,
      });
      const binding = addSourceLocalForPattern({
        context,
        node,
        pattern: firstPattern(node),
        value:
          iteration.kind === "stream"
            ? {
                ...iterable,
                type: iteration.itemType,
                resourceKind: iteration.itemResourceKind,
              }
            : iterable,
        introducedBy: "forBinding",
      });
      return addReservedStatement(context, reserved, {
        kind: "for",
        statement: {
          binding,
          iterable,
          iteration,
          body: lowerBlock({
            block: forStatement.body(),
            context,
            sourceOrigin: reserved.sourceOrigin,
          }),
        },
      });
    }
  }

  const expressionStatement = ExpressionStatementView.from(node);
  if (expressionStatement !== undefined) {
    const expressionView = expressionStatement.expression();
    if (expressionView !== undefined) {
      return addStatement(context, node, {
        kind: "expression",
        expression: lowerExpression({ view: expressionView, context }),
      });
    }
  }

  const returnStatement = ReturnStatementView.from(node);
  if (returnStatement !== undefined) {
    const expressionView = returnStatement.expression();
    const expectedType = expectedFunctionReturnType(context);
    const expectedResourceKind = expectedFunctionReturnKind(context);
    const expression =
      expressionView !== undefined
        ? lowerExpression({ view: expressionView, context, expectedType, expectedResourceKind })
        : undefined;
    if (expression !== undefined) {
      reportStatementTypeMismatch({
        context,
        node,
        actualType: expression.type,
        expectedType,
        code: "HIR_RETURN_TYPE_MISMATCH",
        stableDetail: "return",
      });
    }
    return addStatement(context, node, {
      kind: "return",
      ...(expression !== undefined ? { expression } : {}),
    });
  }

  const yieldStatement = YieldStatementView.from(node);
  if (yieldStatement !== undefined) {
    const expressionView = yieldStatement.expression();
    const expectedType = expectedFunctionReturnType(context);
    const expectedResourceKind = expectedFunctionReturnKind(context);
    const expression =
      expressionView !== undefined
        ? lowerExpression({ view: expressionView, context, expectedType, expectedResourceKind })
        : undefined;
    if (expression !== undefined) {
      reportStatementTypeMismatch({
        context,
        node,
        actualType: expression.type,
        expectedType,
        code: "HIR_YIELD_TYPE_MISMATCH",
        stableDetail: "yield",
      });
    }
    return addStatement(context, node, {
      kind: "yield",
      ...(expression !== undefined ? { expression } : {}),
    });
  }

  const ifStatement = IfStatementView.from(node);
  if (ifStatement !== undefined) {
    const reserved = reserveStatement(context, node);
    const conditionView = ifStatement.condition()?.expression();
    if (conditionView === undefined) {
      reportMissingCondition({ context, node, stableDetail: "missing-if-condition" });
      return addReservedStatement(context, reserved, {
        kind: "error",
        reason: "missing-if-condition",
      });
    }
    const condition = lowerExpression({
      view: conditionView,
      context,
      expectedType: coreCheckedType(coreTypeId("bool")),
    });
    reportBoolCondition({ context, node, expressionType: condition.type });
    return addReservedStatement(context, reserved, {
      kind: "if",
      statement: {
        condition,
        thenBlock: lowerBlock({
          block: ifStatement.body(),
          context,
          sourceOrigin: reserved.sourceOrigin,
        }),
        ...(ifStatement.elseClause()?.body() !== undefined
          ? {
              elseBlock: lowerBlock({
                block: ifStatement.elseClause()?.body(),
                context,
                sourceOrigin: reserved.sourceOrigin,
              }),
            }
          : {}),
      },
    });
  }

  const whileStatement = WhileStatementView.from(node);
  if (whileStatement !== undefined) {
    const reserved = reserveStatement(context, node);
    const conditionView = whileStatement.condition()?.expression();
    if (conditionView === undefined) {
      reportMissingCondition({ context, node, stableDetail: "missing-while-condition" });
      return addReservedStatement(context, reserved, {
        kind: "error",
        reason: "missing-while-condition",
      });
    }
    const condition = lowerExpression({
      view: conditionView,
      context,
      expectedType: coreCheckedType(coreTypeId("bool")),
    });
    reportBoolCondition({ context, node, expressionType: condition.type });
    return addReservedStatement(context, reserved, {
      kind: "while",
      statement: {
        condition,
        body: lowerBlock({
          block: whileStatement.body(),
          context,
          sourceOrigin: reserved.sourceOrigin,
        }),
      },
    });
  }

  const matchStatement = MatchStatementView.from(node);
  if (matchStatement !== undefined) {
    const scrutineeView = matchStatement.condition()?.expression() ?? matchStatement.expression();
    if (scrutineeView !== undefined) {
      const reserved = reserveStatement(context, node);
      const scrutinee = lowerExpression({ view: scrutineeView, context });
      const validationMatch = lowerValidationMatch({
        view: matchStatement,
        scrutinee,
        context,
        lowerBlock,
      });
      if (validationMatch !== undefined) {
        return addReservedStatement(context, reserved, {
          kind: "validationMatch",
          statement: validationMatch,
        });
      }
      const refinements = context.program.proofSurface.matchRefinements.entries();
      const matchKey = matchRefinementMatchKey({
        moduleId: currentHirModuleId(context),
        span: matchStatement.node.span,
      });
      const scrutineeKey = matchRefinementScrutineeKey({
        moduleId: currentHirModuleId(context),
        span: scrutineeView.node.span,
      });
      const surfaces = refinements.filter(
        (refinement) =>
          refinement.matchStatementKey === matchKey && refinement.scrutineeKey === scrutineeKey,
      );
      if (surfaces.length > 0) {
        for (const surface of surfaces) {
          recordMatchRefinement({
            scrutineeExpressionId: scrutinee.expressionId,
            surface,
            context,
            sourceOrigin: reserved.sourceOrigin,
          });
        }
      } else if (scrutinee.type.kind === "source") {
        recordMatchRefinement({
          scrutineeExpressionId: scrutinee.expressionId,
          context,
          sourceOrigin: reserved.sourceOrigin,
        });
      }
      return addReservedStatement(context, reserved, {
        kind: "match",
        statement: {
          scrutinee,
          arms: matchStatement
            .arms()
            .map((arm) => matchArm({ context, arm, sourceOrigin: reserved.sourceOrigin })),
        },
      });
    }
  }

  return addStatement(context, node, {
    kind: "error",
    reason: `unsupported-statement:${SyntaxKind[node.kind]}`,
  });
}
