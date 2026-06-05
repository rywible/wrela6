import type { GreenElement } from "../syntax/green-node";
import { GreenNode } from "../syntax/green-node";
import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import { parseBlock, tryParseStatement } from "./block-parser";
import { parseTypeParameterList, parseTypeReference } from "./type-parser";
import { parseExpression } from "./expression-parser";
import { blockItemRecoveryKinds } from "./parser-recovery";
import { nodeFromMark } from "./node-claim";

export function parseEdgeClassDeclaration(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  if (context.currentSyntaxKind() === SyntaxKind.UniqueKeyword) {
    children.push(context.consume());
  }

  children.push(context.expect(SyntaxKind.EdgeKeyword));
  children.push(context.expect(SyntaxKind.ClassKeyword));
  children.push(context.expect(SyntaxKind.IdentifierToken));

  if (context.currentSyntaxKind() === SyntaxKind.LeftBracketToken) {
    children.push(parseTypeParameterList(context));
  }

  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: tryParseStatement,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.EdgeClassDeclaration, children });
}

export function parseStreamDeclaration(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.StreamKeyword));
  children.push(context.expect(SyntaxKind.IdentifierToken));
  children.push(context.expect(SyntaxKind.ContainsKeyword));
  children.push(parseTypeReference(context));
  children.push(context.expect(SyntaxKind.BoundKeyword));
  children.push(parseExpression(context));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: tryParseStatement,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.StreamDeclaration, children });
}
