import { SyntaxKind } from "../syntax/syntax-kind";
import { ParserContext } from "./parser-context";
import { GreenNode, type GreenElement } from "../syntax/green-node";
import { topLevelStarterKinds } from "./parser-recovery";
import { parseDeclaration } from "./declaration-parser";
import { tryParseStatement } from "./block-parser";
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

    const statementStart = context.offset;
    const stmt = tryParseStatement(context);
    if (stmt !== undefined) {
      children.push(stmt);
      if (context.offset === statementStart && stmt.width === 0) {
        children.push(factory.errorNode([context.consume()]));
      }
      continue;
    }

    const before = context.offset;
    const skipped = context.skipUntil(topLevelStarterKinds);
    if (skipped.length > 0) {
      children.push(factory.errorNode(skipped));
    } else if (context.offset === before) {
      children.push(factory.errorNode([context.consume()]));
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
