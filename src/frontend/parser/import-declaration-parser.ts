import type { GreenElement } from "../syntax/green-node";
import { GreenNode } from "../syntax/green-node";
import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import { isNameTokenSyntaxKind } from "./parser-utils";
import { nodeFromMark } from "./node-claim";

export function parseImportDeclaration(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.UseKeyword));
  children.push(parseImportNameList(context));
  children.push(context.expect(SyntaxKind.FromKeyword));
  children.push(parseDottedModuleName(context));

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.ImportDeclaration, children });
}

export function parseImportNameList(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.IdentifierToken));

  while (context.currentSyntaxKind() === SyntaxKind.CommaToken) {
    children.push(context.consume());
    children.push(context.expect(SyntaxKind.IdentifierToken));
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.ImportNameList, children });
}

export function parseDottedModuleName(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  const firstKind = context.currentSyntaxKind();
  if (isNameTokenSyntaxKind(firstKind)) {
    children.push(context.consume());
  } else {
    context.reportAtCurrent("PARSE_EXPECTED_TOKEN", "Expected a module name.");
    return nodeFromMark({ factory, context, mark, kind: SyntaxKind.DottedModuleName, children });
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

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.DottedModuleName, children });
}
