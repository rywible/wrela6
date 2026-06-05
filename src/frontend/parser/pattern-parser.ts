import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import type { GreenElement, GreenNode } from "../syntax/green-node";
import { parseQualifiedName } from "./type-parser";
import { parseExpression } from "./expression-parser";
import { nodeFromMark } from "./node-claim";

export function parsePattern(context: ParserContext): GreenNode {
  if (!context.enterRecursion()) {
    return context.factory.missingNode();
  }
  try {
    const factory = context.factory;
    const mark = context.mark();

    const name = parseQualifiedName(context);

    if (context.currentSyntaxKind() === SyntaxKind.LeftParenToken) {
      const children: GreenElement[] = [name];
      children.push(context.consume());

      if (context.currentSyntaxKind() !== SyntaxKind.RightParenToken) {
        children.push(parsePatternList(context));
      }

      children.push(context.expect(SyntaxKind.RightParenToken));

      return nodeFromMark({ factory, context, mark, kind: SyntaxKind.Pattern, children });
    }

    return nodeFromMark({ factory, context, mark, kind: SyntaxKind.Pattern, children: [name] });
  } finally {
    context.exitRecursion();
  }
}

export function parsePatternList(context: ParserContext): GreenNode {
  if (!context.enterRecursion()) {
    return context.factory.missingNode();
  }
  try {
    const factory = context.factory;
    const mark = context.mark();
    const children: GreenElement[] = [];

    children.push(parsePattern(context));

    while (context.currentSyntaxKind() === SyntaxKind.CommaToken && !context.isAtEnd) {
      children.push(context.consume());
      if (context.currentSyntaxKind() === SyntaxKind.RightParenToken || context.isAtEnd) break;
      children.push(parsePattern(context));
    }

    return nodeFromMark({ factory, context, mark, kind: SyntaxKind.PatternList, children });
  } finally {
    context.exitRecursion();
  }
}

export function parseCondition(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();

  if (context.currentSyntaxKind() === SyntaxKind.LetKeyword) {
    const children: GreenElement[] = [];
    children.push(context.consume());
    children.push(parsePattern(context));
    children.push(context.expect(SyntaxKind.EqualsToken));
    children.push(parseExpression(context));

    return nodeFromMark({ factory, context, mark, kind: SyntaxKind.Condition, children });
  }

  const expr = parseExpression(context);
  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.Condition, children: [expr] });
}
