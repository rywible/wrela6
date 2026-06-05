import type { GreenElement } from "../syntax/green-node";
import { GreenNode } from "../syntax/green-node";
import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import { isNameTokenSyntaxKind, parseDelimitedList } from "./parser-utils";
import { parseTypeParameterList, parseTypeReference } from "./type-parser";
import { nodeFromMark } from "./node-claim";

function isModifierKeyword(kind: SyntaxKind): boolean {
  return (
    kind === SyntaxKind.PrivateKeyword ||
    kind === SyntaxKind.PlatformKeyword ||
    kind === SyntaxKind.TerminalKeyword ||
    kind === SyntaxKind.PredicateKeyword ||
    kind === SyntaxKind.ConstructorKeyword
  );
}

export function parseFunctionModifierList(context: ParserContext): GreenNode | undefined {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  while (isModifierKeyword(context.currentSyntaxKind())) {
    children.push(context.consume());
  }

  if (children.length === 0) return undefined;

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.FunctionModifierList, children });
}

export function parseFunctionSignature(context: ParserContext): GreenElement[] {
  const elements: GreenElement[] = [];

  const modifiers = parseFunctionModifierList(context);
  if (modifiers !== undefined) elements.push(modifiers);

  elements.push(context.expect(SyntaxKind.FnKeyword));

  elements.push(context.expect(SyntaxKind.IdentifierToken));

  if (context.currentSyntaxKind() === SyntaxKind.LeftBracketToken) {
    elements.push(parseTypeParameterList(context));
  }

  elements.push(parseParameterList(context));

  const returnType = parseReturnTypeClause(context);
  if (returnType !== undefined) elements.push(returnType);

  return elements;
}

export function parseParameterList(context: ParserContext): GreenNode {
  const mark = context.mark();
  const children = parseDelimitedList(context, {
    open: SyntaxKind.LeftParenToken,
    close: SyntaxKind.RightParenToken,
    elementParser: parseParameter,
    allowTrailingComma: true,
    skipNewlines: true,
  });
  return nodeFromMark({
    factory: context.factory,
    context,
    mark,
    kind: SyntaxKind.ParameterList,
    children,
  });
}

export function parseParameter(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  if (context.currentSyntaxKind() === SyntaxKind.ConsumeKeyword) {
    children.push(context.consume());
  }

  if (
    context.currentSyntaxKind() === SyntaxKind.IdentifierToken ||
    isNameTokenSyntaxKind(context.currentSyntaxKind())
  ) {
    children.push(context.consume());
  } else {
    children.push(context.expect(SyntaxKind.IdentifierToken));
  }

  if (context.currentSyntaxKind() === SyntaxKind.ColonToken) {
    children.push(context.consume());
    children.push(parseTypeReference(context));
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.Parameter, children });
}

export function parseReturnTypeClause(context: ParserContext): GreenNode | undefined {
  if (context.currentSyntaxKind() !== SyntaxKind.ArrowToken) {
    return undefined;
  }

  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.consume());
  children.push(parseTypeReference(context));

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.ReturnTypeClause, children });
}
