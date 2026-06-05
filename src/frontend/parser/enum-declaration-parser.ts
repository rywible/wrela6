import type { GreenElement } from "../syntax/green-node";
import { GreenNode } from "../syntax/green-node";
import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import { parseBlock } from "./block-parser";
import { blockItemRecoveryKinds } from "./parser-recovery";
import { nodeFromMark } from "./node-claim";

export function parseEnumDeclaration(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.EnumKeyword));
  children.push(context.expect(SyntaxKind.IdentifierToken));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: parseEnumCase,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.EnumDeclaration, children });
}

export function parseEnumCase(context: ParserContext): GreenNode | undefined {
  if (context.currentSyntaxKind() !== SyntaxKind.IdentifierToken) {
    return undefined;
  }

  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.consume());
  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.EnumCase, children });
}
