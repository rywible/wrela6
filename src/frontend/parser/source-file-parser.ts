import { SyntaxKind } from "../syntax/syntax-kind";
import { ParserContext } from "./parser-context";
import { GreenNode, type GreenElement } from "../syntax/green-node";
import { parseDeclaration } from "./declaration-parser";
import { nodeFromMark } from "./node-claim";

export function parseSourceFile(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  while (!context.isAtEnd && context.currentSyntaxKind() !== SyntaxKind.EndOfFileToken) {
    if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
      children.push(context.consume());
      continue;
    }

    const declarationStart = context.offset;
    const decl = tryParseDeclaration(context);
    if (decl !== undefined) {
      children.push(decl);
      if (context.offset === declarationStart && decl.width === 0) {
        children.push(factory.errorNode([context.consume()]));
      }
      continue;
    }

    const unexpectedToken = context.peek();
    context.reportSpan(
      "PARSE_EXPECTED_TOP_LEVEL_DECLARATION",
      "Expected a top-level declaration.",
      unexpectedToken.span.start,
      unexpectedToken.span.end,
    );

    const skipped: GreenElement[] = [];
    while (
      !context.isAtEnd &&
      context.currentSyntaxKind() !== SyntaxKind.NewlineToken &&
      context.currentSyntaxKind() !== SyntaxKind.EndOfFileToken &&
      !isTopLevelDeclarationStarter(context.currentSyntaxKind())
    ) {
      skipped.push(context.consume());
    }

    if (skipped.length === 0 && context.currentSyntaxKind() !== SyntaxKind.EndOfFileToken) {
      skipped.push(context.consume());
    }

    if (skipped.length > 0) {
      children.push(factory.errorNode(skipped));
    }
  }

  children.push(context.consume());

  return nodeFromMark({
    factory,
    context,
    mark,
    kind: SyntaxKind.SourceFile,
    children,
  });
}

export function tryParseDeclaration(context: ParserContext): GreenNode | undefined {
  return parseDeclaration(context);
}

function isTopLevelDeclarationStarter(kind: SyntaxKind): boolean {
  switch (kind) {
    case SyntaxKind.UseKeyword:
    case SyntaxKind.EnumKeyword:
    case SyntaxKind.DataclassKeyword:
    case SyntaxKind.ClassKeyword:
    case SyntaxKind.PrivateKeyword:
    case SyntaxKind.InterfaceKeyword:
    case SyntaxKind.EdgeKeyword:
    case SyntaxKind.UniqueKeyword:
    case SyntaxKind.StreamKeyword:
    case SyntaxKind.UefiKeyword:
    case SyntaxKind.ValidatedKeyword:
    case SyntaxKind.FnKeyword:
    case SyntaxKind.ConstructorKeyword:
    case SyntaxKind.TerminalKeyword:
    case SyntaxKind.PredicateKeyword:
    case SyntaxKind.PlatformKeyword:
      return true;
    default:
      return false;
  }
}
