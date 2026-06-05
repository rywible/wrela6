import type { GreenElement } from "../syntax/green-node";
import { GreenNode } from "../syntax/green-node";
import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import { parseBlock, tryParseStatement } from "./block-parser";
import { blockItemRecoveryKinds } from "./parser-recovery";
import { parseTypeParameterList, parseTypeReference } from "./type-parser";
import { parseFunctionSignature } from "./function-signature-parser";
import { nodeFromMark } from "./node-claim";

export function parseDataclassDeclaration(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.DataclassKeyword));
  children.push(context.expect(SyntaxKind.IdentifierToken));

  if (context.currentSyntaxKind() === SyntaxKind.LeftBracketToken) {
    children.push(parseTypeParameterList(context));
  }

  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: parseFieldDeclaration,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.DataclassDeclaration, children });
}

export function parseClassDeclaration(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  if (context.currentSyntaxKind() === SyntaxKind.PrivateKeyword) {
    children.push(context.consume());
  }

  children.push(context.expect(SyntaxKind.ClassKeyword));
  children.push(context.expect(SyntaxKind.IdentifierToken));

  if (context.currentSyntaxKind() === SyntaxKind.LeftBracketToken) {
    children.push(parseTypeParameterList(context));
  }

  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: parseClassBodyItem,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.ClassDeclaration, children });
}

export function parseInterfaceDeclaration(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.InterfaceKeyword));
  children.push(context.expect(SyntaxKind.IdentifierToken));

  if (context.currentSyntaxKind() === SyntaxKind.LeftBracketToken) {
    children.push(parseTypeParameterList(context));
  }

  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    optionalColon: true,
    itemParser: parseInterfaceBodyItem,
    recoveryKinds: blockItemRecoveryKinds,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.InterfaceDeclaration, children });
}

export function parseFieldDeclaration(context: ParserContext): GreenNode | undefined {
  if (context.currentSyntaxKind() !== SyntaxKind.IdentifierToken) {
    return undefined;
  }

  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.consume());
  children.push(context.expect(SyntaxKind.ColonToken));
  children.push(parseTypeReference(context));
  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.FieldDeclaration, children });
}

function parseClassBodyItem(context: ParserContext): GreenElement | undefined {
  const field = parseFieldDeclaration(context);
  if (field !== undefined) return field;

  return tryParseStatement(context);
}

function parseInterfaceBodyItem(context: ParserContext): GreenElement | undefined {
  const field = parseFieldDeclaration(context);
  if (field !== undefined) return field;

  const kind = context.currentSyntaxKind();
  if (
    kind === SyntaxKind.FnKeyword ||
    kind === SyntaxKind.PrivateKeyword ||
    kind === SyntaxKind.PlatformKeyword ||
    kind === SyntaxKind.TerminalKeyword ||
    kind === SyntaxKind.PredicateKeyword ||
    kind === SyntaxKind.ConstructorKeyword
  ) {
    return parseBodylessFunctionDeclaration(context);
  }

  return undefined;
}

function parseBodylessFunctionDeclaration(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  const sigElements = parseFunctionSignature(context);
  children.push(...sigElements);
  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.FunctionDeclaration, children });
}
