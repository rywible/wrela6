import type { GreenElement } from "../syntax/green-node";
import { GreenNode } from "../syntax/green-node";
import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import { isNameTokenSyntaxKind, parseDelimitedList } from "./parser-utils";
import { nodeFromMark } from "./node-claim";

export type TypeParseContext = "declaration" | "type-reference" | "expression";

export function parseQualifiedName(context: ParserContext): GreenNode {
  const mark = context.mark();
  const children: GreenElement[] = [];

  const firstKind = context.currentSyntaxKind();
  if (isNameTokenSyntaxKind(firstKind)) {
    children.push(context.consume());
  } else {
    context.reportAtCurrent("PARSE_EXPECTED_TOKEN", "Expected a type name.");
    return nodeFromMark({
      factory: context.factory,
      context,
      mark,
      kind: SyntaxKind.QualifiedName,
      children,
    });
  }

  while (context.currentSyntaxKind() === SyntaxKind.DotToken) {
    children.push(context.consume());
    const nextKind = context.currentSyntaxKind();
    if (isNameTokenSyntaxKind(nextKind)) {
      children.push(context.consume());
    } else {
      context.reportAtCurrent("PARSE_EXPECTED_TOKEN", "Expected a name after '.'.");
      break;
    }
  }

  return nodeFromMark({
    factory: context.factory,
    context,
    mark,
    kind: SyntaxKind.QualifiedName,
    children,
  });
}

export function parseTypeReference(context: ParserContext): GreenNode {
  if (!context.enterRecursion()) {
    return context.factory.missingNode();
  }
  try {
    const mark = context.mark();
    const children: GreenElement[] = [];

    children.push(parseQualifiedName(context));

    if (context.currentSyntaxKind() === SyntaxKind.LeftBracketToken) {
      children.push(parseTypeArgumentList(context));
    }

    return nodeFromMark({
      factory: context.factory,
      context,
      mark,
      kind: SyntaxKind.TypeReference,
      children,
    });
  } finally {
    context.exitRecursion();
  }
}

export function parseTypeParameter(context: ParserContext): GreenNode {
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.IdentifierToken));

  if (context.currentSyntaxKind() === SyntaxKind.ColonToken) {
    children.push(context.consume());
    children.push(parseTypeReference(context));
  }

  return nodeFromMark({
    factory: context.factory,
    context,
    mark,
    kind: SyntaxKind.TypeParameter,
    children,
  });
}

export function parseTypeParameterList(context: ParserContext): GreenNode {
  const mark = context.mark();
  const children = parseDelimitedList(context, {
    open: SyntaxKind.LeftBracketToken,
    close: SyntaxKind.RightBracketToken,
    elementParser: parseTypeParameter,
    allowTrailingComma: true,
    skipNewlines: true,
  });
  return nodeFromMark({
    factory: context.factory,
    context,
    mark,
    kind: SyntaxKind.TypeParameterList,
    children,
  });
}

export function parseTypeArgumentList(context: ParserContext): GreenNode {
  const mark = context.mark();
  const children = parseDelimitedList(context, {
    open: SyntaxKind.LeftBracketToken,
    close: SyntaxKind.RightBracketToken,
    elementParser: parseTypeReference,
    allowTrailingComma: true,
    skipNewlines: true,
  });
  return nodeFromMark({
    factory: context.factory,
    context,
    mark,
    kind: SyntaxKind.TypeArgumentList,
    children,
  });
}

export function parseBracketAfterName(
  context: ParserContext,
  mode: TypeParseContext,
): GreenNode | undefined {
  if (mode === "declaration") {
    return parseTypeParameterList(context);
  }
  return parseTypeArgumentList(context);
}
