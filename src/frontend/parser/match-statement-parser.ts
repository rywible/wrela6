import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import type { GreenElement, GreenNode } from "../syntax/green-node";
import { parseExpression } from "./expression-parser";
import { parsePattern } from "./pattern-parser";
import { parseBlock, tryParseStatement } from "./block-parser";
import { matchCaseBoundaryKinds } from "./parser-recovery";
import { nodeFromMark } from "./node-claim";

export function parseMatchStatement(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.MatchKeyword));
  children.push(parseExpression(context));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: parseMatchCase,
    recoveryKinds: matchCaseBoundaryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.MatchStatement, children });
}

export function parseMatchCase(context: ParserContext): GreenNode | undefined {
  if (context.currentSyntaxKind() !== SyntaxKind.CaseKeyword) {
    return undefined;
  }

  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.consume());
  children.push(parsePattern(context));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: tryParseStatement,
    recoveryKinds: matchCaseBoundaryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.MatchCase, children });
}
