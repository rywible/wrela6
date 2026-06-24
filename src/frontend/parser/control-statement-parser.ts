import { SyntaxKind } from "../syntax/syntax-kind";
import { ParserContext } from "./parser-context";
import { GreenNode, type GreenElement } from "../syntax/green-node";
import { parseExpression } from "./expression-parser";
import { parsePattern, parseCondition } from "./pattern-parser";
import { parseBlock, tryParseStatement } from "./block-parser";
import { blockItemRecoveryKinds } from "./parser-recovery";
import { nodeFromMark } from "./node-claim";

export function parseIfStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.IfKeyword));
  children.push(parseCondition(context));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: tryParseStatement,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  if (context.currentSyntaxKind() === SyntaxKind.ElseKeyword) {
    children.push(parseElseClause(context));
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.IfStatement, children });
}

export function parseElseClause(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.ElseKeyword));

  if (context.currentSyntaxKind() === SyntaxKind.ColonToken) {
    children.push(context.consume());
    const block = parseBlock(context, {
      optionalColon: true,
      itemParser: tryParseStatement,
      recoveryKinds: blockItemRecoveryKinds,
    });
    children.push(block);
  } else {
    const stmt = tryParseStatement(context);
    if (stmt !== undefined) {
      children.push(stmt);
    } else {
      const skipped = context.skipUntil(blockItemRecoveryKinds);
      if (skipped.length > 0) {
        children.push(factory.skippedTokens(skipped));
      }
    }
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.ElseClause, children });
}

export function parseWhileStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.WhileKeyword));
  children.push(parseCondition(context));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: tryParseStatement,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.WhileStatement, children });
}

export function parseForStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.ForKeyword));
  children.push(parsePattern(context));
  children.push(context.expect(SyntaxKind.InKeyword));
  children.push(parseExpression(context));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: tryParseStatement,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.ForStatement, children });
}

export function parseTakeStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.TakeKeyword));
  children.push(parseExpression(context));

  if (context.currentSyntaxKind() === SyntaxKind.AsKeyword) {
    children.push(context.consume());
    children.push(context.expect(SyntaxKind.IdentifierToken));
  }

  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: tryParseStatement,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.TakeStatement, children });
}

export function parseBreakStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.BreakKeyword));

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.BreakStatement, children });
}

export function parseEnsureStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.EnsureKeyword));
  children.push(parseExpression(context));

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.EnsureStatement, children });
}
