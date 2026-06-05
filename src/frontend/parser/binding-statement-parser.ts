import { SyntaxKind } from "../syntax/syntax-kind";
import { ParserContext } from "./parser-context";
import { GreenNode, type GreenElement } from "../syntax/green-node";
import { parseExpression } from "./expression-parser";
import { parsePattern } from "./pattern-parser";
import { parseTypeReference } from "./type-parser";
import { parseBlock, tryParseStatement } from "./block-parser";
import { blockItemRecoveryKinds } from "./parser-recovery";
import { nodeFromMark } from "./node-claim";

export function parseLetStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.LetKeyword));
  children.push(parsePattern(context));

  if (context.currentSyntaxKind() === SyntaxKind.ColonToken) {
    children.push(context.consume());
    children.push(parseTypeReference(context));
  }

  children.push(context.expect(SyntaxKind.EqualsToken));
  children.push(parseExpression(context));

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.LetStatement, children });
}

export function parseReturnStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.ReturnKeyword));

  if (
    context.currentSyntaxKind() !== SyntaxKind.NewlineToken &&
    context.currentSyntaxKind() !== SyntaxKind.EndOfFileToken &&
    context.currentSyntaxKind() !== SyntaxKind.DedentToken
  ) {
    children.push(parseExpression(context));
  }

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.ReturnStatement, children });
}

export function parseYieldStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.YieldKeyword));
  children.push(parseExpression(context));

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.YieldStatement, children });
}

export function parseContinueStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.ContinueKeyword));

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.ContinueStatement, children });
}

export function parseLoopStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.LoopKeyword));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: tryParseStatement,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.LoopStatement, children });
}
