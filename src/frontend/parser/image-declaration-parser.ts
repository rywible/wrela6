import type { GreenElement } from "../syntax/green-node";
import { GreenNode } from "../syntax/green-node";
import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import { parseBlock, tryParseStatement } from "./block-parser";
import { blockItemRecoveryKinds } from "./parser-recovery";
import { parseFieldDeclaration } from "./class-declaration-parser";
import { nodeFromMark } from "./node-claim";

export function parseImageDeclaration(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.UefiKeyword));
  children.push(context.expect(SyntaxKind.ImageKeyword));
  children.push(context.expect(SyntaxKind.IdentifierToken));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: parseImageBodyItem,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.ImageDeclaration, children });
}

export function parseDevicesSection(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.DevicesKeyword));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: parseFieldDeclaration,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.DevicesSection, children });
}

function parseImageBodyItem(context: ParserContext): GreenElement | undefined {
  if (context.currentSyntaxKind() === SyntaxKind.DevicesKeyword) {
    return parseDevicesSection(context);
  }

  const field = parseFieldDeclaration(context);
  if (field !== undefined) return field;

  return tryParseStatement(context);
}
