import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import type { GreenElement, GreenNode } from "../syntax/green-node";
import { canStartExpression, isNameTokenSyntaxKind, parseDelimitedList } from "./parser-utils";
import { syntaxKindFromTokenKind } from "../syntax/syntax-kind-map";
import { expressionStopKinds } from "./parser-recovery";
import { parseTypeReference } from "./type-parser";
import { nodeFromMark } from "./node-claim";
import { shouldParseIndexExpression } from "./expression-bracket-disambiguation";

export interface ExpressionContext {
  minimumBindingPower: number;
  allowElseRequirement: boolean;
  allowDeriveArrow: boolean;
  stopBeforeFatArrow: boolean;
  stopKinds: ReadonlySet<SyntaxKind>;
}

export const DEFAULT_EXPRESSION_CONTEXT: ExpressionContext = {
  minimumBindingPower: 0,
  allowElseRequirement: false,
  allowDeriveArrow: false,
  stopBeforeFatArrow: false,
  stopKinds: expressionStopKinds,
};

interface BinaryOperatorInfo {
  left: number;
  right: number;
  node: SyntaxKind;
  nonAssociative?: boolean;
}

const BINARY_OPERATORS: Partial<Record<SyntaxKind, BinaryOperatorInfo>> = {
  [SyntaxKind.StarToken]: { left: 60, right: 61, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.SlashToken]: { left: 60, right: 61, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.PercentToken]: { left: 60, right: 61, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.LeftShiftToken]: { left: 55, right: 56, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.RightShiftToken]: { left: 55, right: 56, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.AmpersandToken]: { left: 52, right: 53, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.CaretToken]: { left: 51, right: 52, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.PlusToken]: { left: 50, right: 51, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.MinusToken]: { left: 50, right: 51, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.PipeToken]: { left: 50, right: 51, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.LessToken]: {
    left: 40,
    right: 0,
    node: SyntaxKind.ComparisonExpression,
    nonAssociative: true,
  },
  [SyntaxKind.LessEqualsToken]: {
    left: 40,
    right: 0,
    node: SyntaxKind.ComparisonExpression,
    nonAssociative: true,
  },
  [SyntaxKind.GreaterToken]: {
    left: 40,
    right: 0,
    node: SyntaxKind.ComparisonExpression,
    nonAssociative: true,
  },
  [SyntaxKind.GreaterEqualsToken]: {
    left: 40,
    right: 0,
    node: SyntaxKind.ComparisonExpression,
    nonAssociative: true,
  },
  [SyntaxKind.EqualsEqualsToken]: {
    left: 35,
    right: 0,
    node: SyntaxKind.EqualityExpression,
    nonAssociative: true,
  },
  [SyntaxKind.BangEqualsToken]: {
    left: 35,
    right: 0,
    node: SyntaxKind.EqualityExpression,
    nonAssociative: true,
  },
  [SyntaxKind.AndKeyword]: { left: 30, right: 31, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.OrKeyword]: { left: 25, right: 26, node: SyntaxKind.BinaryExpression },
};

const COMPARISON_AND_EQUALITY_KINDS = new Set([
  SyntaxKind.LessToken,
  SyntaxKind.LessEqualsToken,
  SyntaxKind.GreaterToken,
  SyntaxKind.GreaterEqualsToken,
  SyntaxKind.EqualsEqualsToken,
  SyntaxKind.BangEqualsToken,
]);

function isComparisonOrEqualityOp(kind: SyntaxKind): boolean {
  return COMPARISON_AND_EQUALITY_KINDS.has(kind);
}

function getOperatorBinding(
  context: ParserContext,
  expressionContext: ExpressionContext,
): BinaryOperatorInfo | undefined {
  const kind = context.currentSyntaxKind();

  if (kind === SyntaxKind.ElseKeyword) {
    if (!expressionContext.allowElseRequirement) return undefined;
    return { left: 20, right: 19, node: SyntaxKind.ElseRequirementExpression };
  }

  if (kind === SyntaxKind.FatArrowToken) {
    if (!expressionContext.allowDeriveArrow) return undefined;
    return { left: 10, right: 9, node: SyntaxKind.BinaryExpression };
  }

  return BINARY_OPERATORS[kind];
}

function shouldStop(context: ParserContext, expressionContext: ExpressionContext): boolean {
  if (context.isAtEnd) return true;
  const kind = context.currentSyntaxKind();
  if (expressionContext.stopKinds.has(kind)) return true;
  if (expressionContext.stopBeforeFatArrow && kind === SyntaxKind.FatArrowToken) return true;
  return false;
}

export function parseExpression(context: ParserContext): GreenNode {
  return parseExpressionWithContext(context, DEFAULT_EXPRESSION_CONTEXT);
}

export function parseExpressionWithContext(
  context: ParserContext,
  expressionContext: ExpressionContext,
): GreenNode {
  if (!context.enterRecursion()) {
    return context.factory.missingNode();
  }
  try {
    return parsePratt(context, expressionContext);
  } finally {
    context.exitRecursion();
  }
}

function parsePratt(context: ParserContext, expressionContext: ExpressionContext): GreenNode {
  const factory = context.factory;

  let left = parsePrefixOrPrimary(context, expressionContext);

  if (left.kind === SyntaxKind.MissingNode) {
    return left;
  }

  left = parsePostfixExpression(context, left);

  while (!shouldStop(context, expressionContext)) {
    const opInfo = getOperatorBinding(context, expressionContext);
    if (opInfo === undefined || opInfo.left < expressionContext.minimumBindingPower) {
      break;
    }

    if (opInfo.nonAssociative) {
      const opToken = context.consume();
      const right = parseExpressionWithContext(context, {
        ...expressionContext,
        minimumBindingPower: opInfo.left + 1,
      });

      const expr = factory.node(opInfo.node, [left, opToken, right]);

      if (isComparisonOrEqualityOp(context.currentSyntaxKind())) {
        context.reportAtCurrent("PARSE_UNEXPECTED_TOKEN", "Unexpected token.");
        const chainedOp = context.consume();
        const chainedRight = parseExpressionWithContext(context, {
          ...expressionContext,
          minimumBindingPower: 0,
        });
        return factory.errorNode([expr, chainedOp, chainedRight]);
      }

      left = expr;
      left = parsePostfixExpression(context, left);
      continue;
    }

    const opToken = context.consume();
    const right = parseExpressionWithContext(context, {
      ...expressionContext,
      minimumBindingPower: opInfo.right,
    });

    left = factory.node(opInfo.node, [left, opToken, right]);
    left = parsePostfixExpression(context, left);
  }

  return left;
}

function parsePrefixOrPrimary(
  context: ParserContext,
  expressionContext: ExpressionContext,
): GreenNode {
  const kind = context.currentSyntaxKind();

  switch (kind) {
    case SyntaxKind.NotKeyword:
    case SyntaxKind.TildeToken:
    case SyntaxKind.MinusToken: {
      const opToken = context.consume();
      const operand = parseExpressionWithContext(context, {
        ...expressionContext,
        minimumBindingPower: 70,
      });
      return context.factory.node(SyntaxKind.UnaryExpression, [opToken, operand]);
    }
    default:
      return parsePrimaryExpression(context);
  }
}

export function parsePrimaryExpression(context: ParserContext): GreenNode {
  const factory = context.factory;

  switch (context.currentSyntaxKind()) {
    case SyntaxKind.IdentifierToken:
      return factory.node(SyntaxKind.NameExpression, [context.consume()]);

    case SyntaxKind.IntegerLiteralToken:
    case SyntaxKind.StringLiteralToken:
    case SyntaxKind.TrueKeyword:
    case SyntaxKind.FalseKeyword:
      return factory.node(SyntaxKind.LiteralExpression, [context.consume()]);

    case SyntaxKind.LeftBraceToken:
      return parseObjectLiteralExpression(context);

    case SyntaxKind.LeftParenToken:
      return parseParenthesizedExpression(context);

    default:
      if (isNameTokenSyntaxKind(context.currentSyntaxKind())) {
        return factory.node(SyntaxKind.NameExpression, [context.consume()]);
      }
      context.reportAtCurrent("PARSE_EXPECTED_EXPRESSION", "Expected expression.");
      return factory.missingNode();
  }
}

export function parsePostfixExpression(context: ParserContext, left: GreenNode): GreenNode {
  const factory = context.factory;

  while (true) {
    switch (context.currentSyntaxKind()) {
      case SyntaxKind.DotToken: {
        const dot = context.consume();
        const currentKind = context.currentSyntaxKind();
        if (isNameTokenSyntaxKind(currentKind)) {
          const name = context.consume();
          left = factory.node(SyntaxKind.MemberAccessExpression, [left, dot, name]);
        } else {
          context.reportAtCurrent("PARSE_EXPECTED_TOKEN", "Expected name after '.'.");
          left = factory.node(SyntaxKind.MemberAccessExpression, [left, dot]);
        }
        break;
      }

      case SyntaxKind.LeftParenToken: {
        const args = parseCallArgumentList(context);
        left = factory.node(SyntaxKind.CallExpression, [left, args]);
        break;
      }

      case SyntaxKind.LeftBracketToken: {
        if (shouldParseIndexExpression(context, left)) {
          left = parseIndexExpression(context, left);
        } else {
          const typeArgs = parseTypeArgumentListInExpression(context);
          left = factory.node(SyntaxKind.TypeApplicationExpression, [left, typeArgs]);
        }
        break;
      }

      case SyntaxKind.QuestionToken: {
        const question = context.consume();
        if (canStartExpression(context.currentSyntaxKind())) {
          const errorExpr = parseExpressionWithContext(context, {
            ...DEFAULT_EXPRESSION_CONTEXT,
            minimumBindingPower: 999,
          });
          left = factory.node(SyntaxKind.AttemptExpression, [left, question, errorExpr]);
        } else {
          left = factory.node(SyntaxKind.AttemptExpression, [left, question]);
        }
        break;
      }

      default:
        return left;
    }
  }
}

function parseParenthesizedExpression(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.LeftParenToken));
  children.push(
    parseExpressionWithContext(context, {
      ...DEFAULT_EXPRESSION_CONTEXT,
      stopKinds: new Set([
        SyntaxKind.RightParenToken,
        SyntaxKind.NewlineToken,
        SyntaxKind.DedentToken,
        SyntaxKind.EndOfFileToken,
      ]),
    }),
  );
  children.push(context.expect(SyntaxKind.RightParenToken));

  return nodeFromMark({
    factory,
    context,
    mark,
    kind: SyntaxKind.ParenthesizedExpression,
    children,
  });
}

function parseIndexExpression(context: ParserContext, receiver: GreenNode): GreenNode {
  const factory = context.factory;
  const mark = { ...context.mark(), offset: context.offset - receiver.width };
  const children: GreenElement[] = [receiver];

  children.push(context.expect(SyntaxKind.LeftBracketToken));
  children.push(
    parseExpressionWithContext(context, {
      ...DEFAULT_EXPRESSION_CONTEXT,
      stopKinds: new Set([
        SyntaxKind.RightBracketToken,
        SyntaxKind.NewlineToken,
        SyntaxKind.DedentToken,
        SyntaxKind.EndOfFileToken,
      ]),
    }),
  );
  children.push(context.expect(SyntaxKind.RightBracketToken));

  return nodeFromMark({
    factory,
    context,
    mark,
    kind: SyntaxKind.IndexExpression,
    children,
  });
}

function parseObjectLiteralExpression(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.LeftBraceToken));

  while (context.currentSyntaxKind() !== SyntaxKind.RightBraceToken && !context.isAtEnd) {
    if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
      children.push(context.consume());
      continue;
    }

    if (
      context.currentSyntaxKind() === SyntaxKind.IndentToken ||
      context.currentSyntaxKind() === SyntaxKind.DedentToken
    ) {
      children.push(context.consume());
      continue;
    }

    let name: GreenElement;
    if (isNameTokenSyntaxKind(context.currentSyntaxKind())) {
      name = context.consume();
    } else {
      name = context.expect(SyntaxKind.IdentifierToken);
    }
    const colon = context.expect(SyntaxKind.ColonToken);
    const value = parseExpression(context);
    children.push(factory.node(SyntaxKind.ObjectField, [name, colon, value]));

    if (context.currentSyntaxKind() === SyntaxKind.CommaToken) {
      children.push(context.consume());
    } else {
      break;
    }
  }

  children.push(context.expect(SyntaxKind.RightBraceToken));

  return nodeFromMark({
    factory,
    context,
    mark,
    kind: SyntaxKind.ObjectLiteralExpression,
    children,
  });
}

function parseCallArgument(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  if (isNameTokenSyntaxKind(context.currentSyntaxKind())) {
    const lookahead = context.peek(1);
    if (lookahead && syntaxKindFromTokenKind(lookahead.kind) === SyntaxKind.EqualsToken) {
      children.push(context.consume());
      children.push(context.expect(SyntaxKind.EqualsToken));
      children.push(parseExpression(context));
      return nodeFromMark({ factory, context, mark, kind: SyntaxKind.NamedArgument, children });
    }
  }

  const expr = parseExpression(context);
  children.push(expr);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.Argument, children });
}

function parseCallArgumentList(context: ParserContext): GreenNode {
  const mark = context.mark();
  const children = parseDelimitedList(context, {
    open: SyntaxKind.LeftParenToken,
    close: SyntaxKind.RightParenToken,
    elementParser: parseCallArgument,
    allowTrailingComma: true,
    skipNewlines: true,
  });
  return nodeFromMark({
    factory: context.factory,
    context,
    mark,
    kind: SyntaxKind.CallArgumentList,
    children,
  });
}

function parseTypeArgumentListInExpression(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.LeftBracketToken));

  while (!context.isAtEnd) {
    const currentKind = context.currentSyntaxKind();

    if (currentKind === SyntaxKind.RightBracketToken) {
      break;
    }

    if (currentKind === SyntaxKind.NewlineToken) {
      children.push(context.consume());
      continue;
    }

    if (currentKind === SyntaxKind.CommaToken) {
      children.push(context.consume());
      continue;
    }

    if (
      currentKind === SyntaxKind.RightParenToken ||
      currentKind === SyntaxKind.ColonToken ||
      currentKind === SyntaxKind.EndOfFileToken
    ) {
      break;
    }

    const beforeOffset = context.offset;

    children.push(parseTypeReference(context));

    if (context.offset === beforeOffset) {
      context.reportAtCurrent("PARSE_EXPECTED_TOKEN", "Expected type.");
      children.push(context.consume());
    }

    const afterKind = context.currentSyntaxKind();
    if (afterKind === SyntaxKind.CommaToken) {
      children.push(context.consume());
    } else if (afterKind === SyntaxKind.NewlineToken) {
      // preserved in next iteration
    }
  }

  children.push(context.expect(SyntaxKind.RightBracketToken));

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.TypeArgumentList, children });
}
