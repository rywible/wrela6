import type { GreenElement } from "../syntax/green-node";
import { GreenNode } from "../syntax/green-node";
import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import { parseBlock } from "./block-parser";
import { validatedBufferSectionStarterKinds, blockItemRecoveryKinds } from "./parser-recovery";
import { parseFieldDeclaration } from "./class-declaration-parser";
import { parseLayoutFieldType } from "./type-parser";
import { parseExpression } from "./expression-parser";
import { parseDeriveSection, parseRequireSection } from "./validated-buffer-section-parser";
import { nodeFromMark } from "./node-claim";

export function parseValidatedBufferDeclaration(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.ValidatedKeyword));
  children.push(context.expect(SyntaxKind.BufferKeyword));
  children.push(context.expect(SyntaxKind.IdentifierToken));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: parseValidatedBufferSection,
    recoveryKinds: new Set([...blockItemRecoveryKinds, ...validatedBufferSectionStarterKinds]),
  });
  children.push(block);

  return nodeFromMark({
    factory,
    context,
    mark,
    kind: SyntaxKind.ValidatedBufferDeclaration,
    children,
  });
}

function parseValidatedBufferSection(context: ParserContext): GreenNode | undefined {
  switch (context.currentSyntaxKind()) {
    case SyntaxKind.ParamsKeyword:
      return parseParamsSection(context);
    case SyntaxKind.LayoutKeyword:
      return parseLayoutSection(context);
    case SyntaxKind.DeriveKeyword:
      return parseDeriveSection(context);
    case SyntaxKind.RequireKeyword:
      return parseRequireSection(context);
    default:
      return undefined;
  }
}

export function parseParamsSection(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.ParamsKeyword));

  if (context.currentSyntaxKind() === SyntaxKind.ColonToken) {
    children.push(context.consume());
  }

  const block = parseBlock(context, {
    itemParser: parseFieldDeclaration,
    recoveryKinds: blockItemRecoveryKinds,
    optionalColon: true,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.ParamsSection, children });
}

export function parseLayoutSection(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.LayoutKeyword));

  if (context.currentSyntaxKind() === SyntaxKind.ColonToken) {
    children.push(context.consume());
  }

  const block = parseBlock(context, {
    itemParser: parseLayoutField,
    recoveryKinds: blockItemRecoveryKinds,
    optionalColon: true,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.LayoutSection, children });
}

export function parseLayoutField(context: ParserContext): GreenNode | undefined {
  if (context.currentSyntaxKind() !== SyntaxKind.IdentifierToken) {
    return undefined;
  }

  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.consume());
  children.push(context.expect(SyntaxKind.ColonToken));
  children.push(...parseLayoutFieldType(context));
  children.push(context.expect(SyntaxKind.AtKeyword));
  children.push(parseExpression(context));

  if (context.currentSyntaxKind() === SyntaxKind.LenKeyword) {
    children.push(context.consume());
    children.push(parseExpression(context));
  }

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.LayoutField, children });
}
