import { SyntaxKind } from "../syntax/syntax-kind";
import { ParserContext } from "./parser-context";
import { GreenNode, type GreenElement } from "../syntax/green-node";
import { parseExpression } from "./expression-parser";
import { nodeFromMark } from "./node-claim";

export function parseExpressionOrAssignmentStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  const expr = parseExpression(context);

  if (context.currentSyntaxKind() === SyntaxKind.EqualsToken) {
    children.push(expr);
    children.push(context.consume());
    const value = parseExpression(context);
    children.push(value);

    if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
      children.push(context.consume());
    }

    return nodeFromMark({ factory, context, mark, kind: SyntaxKind.AssignmentStatement, children });
  }

  children.push(expr);

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.ExpressionStatement, children });
}
