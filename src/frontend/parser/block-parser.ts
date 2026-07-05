import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import { GreenNode, type GreenElement } from "../syntax/green-node";
import type { GreenToken } from "../syntax/green-token";
import { blockItemRecoveryKinds, recoverUntil } from "./parser-recovery";
import { parseStatement } from "./statement-parser";
import { nodeFromMark } from "./node-claim";

export interface BlockOptions {
  optionalColon?: boolean;
  itemParser: (context: ParserContext) => GreenElement | undefined;
  recoveryKinds: ReadonlySet<SyntaxKind>;
}

export function parseBlock(context: ParserContext, options: BlockOptions): GreenNode {
  const factory = context.factory;

  if (!context.enterRecursion()) {
    return factory.node(SyntaxKind.Block, []);
  }

  try {
    const mark = context.mark();
    const children: GreenElement[] = [];

    if (options.optionalColon) {
      if (context.currentSyntaxKind() === SyntaxKind.ColonToken) {
        children.push(context.consume());
      }
    } else {
      children.push(context.expect(SyntaxKind.ColonToken));
    }

    while (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
      children.push(context.consume());
    }

    if (context.currentSyntaxKind() === SyntaxKind.IndentToken) {
      children.push(context.consume());

      const stmtList = parseStatementList(context, options.itemParser, options.recoveryKinds);
      children.push(stmtList);

      if (context.currentSyntaxKind() === SyntaxKind.DedentToken) {
        children.push(context.consume());
      } else {
        context.reportAtCurrent("PARSE_UNTERMINATED_BLOCK", "Unterminated block.");
      }
    }

    return nodeFromMark({ factory, context, mark, kind: SyntaxKind.Block, children });
  } finally {
    context.exitRecursion();
  }
}

export function parseStatementList(
  context: ParserContext,
  itemParser?: (context: ParserContext) => GreenElement | undefined,
  recoveryKinds?: ReadonlySet<SyntaxKind>,
): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  while (
    !context.isAtEnd &&
    context.currentSyntaxKind() !== SyntaxKind.DedentToken &&
    context.currentSyntaxKind() !== SyntaxKind.EndOfFileToken
  ) {
    if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
      children.push(context.consume());
      continue;
    }

    const parseFn = itemParser ?? tryParseStatement;
    const before = context.offset;
    const item = parseFn(context);
    if (item !== undefined) {
      children.push(item);
      if (context.offset === before && item.width === 0) {
        children.push(factory.skippedTokens([context.consume()]));
      }
      if (
        !elementEndsWithStatementSeparator(item) &&
        !isStatementSeparator(context.currentSyntaxKind())
      ) {
        const unexpectedToken = context.peek();
        context.reportSpan(
          "PARSE_EXPECTED_STATEMENT_SEPARATOR",
          "Expected a statement separator.",
          unexpectedToken.span.start,
          unexpectedToken.span.end,
        );
        const skipped: GreenToken[] = [];
        while (!context.isAtEnd && !isStatementSeparator(context.currentSyntaxKind())) {
          skipped.push(context.consume());
        }
        if (skipped.length > 0) {
          children.push(factory.skippedTokens(skipped));
        }
      }
      continue;
    }

    const beforeRecovery = context.offset;
    const syncKinds = recoveryKinds ?? blockItemRecoveryKinds;
    const skipped = recoverUntil(context, syncKinds);
    if (skipped.length > 0) {
      children.push(factory.skippedTokens(skipped));
    } else if (context.offset === beforeRecovery) {
      children.push(factory.skippedTokens([context.consume()]));
    }
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.StatementList, children });
}

export function tryParseStatement(context: ParserContext): GreenElement | undefined {
  return parseStatement(context);
}

export function expectNewline(context: ParserContext): GreenToken {
  return context.expect(SyntaxKind.NewlineToken);
}

function isStatementSeparator(kind: SyntaxKind): boolean {
  return (
    kind === SyntaxKind.NewlineToken ||
    kind === SyntaxKind.DedentToken ||
    kind === SyntaxKind.EndOfFileToken
  );
}

function elementEndsWithStatementSeparator(element: GreenElement): boolean {
  const lastKind = lastElementSyntaxKind(element);
  return lastKind !== undefined && isStatementSeparator(lastKind);
}

function lastElementSyntaxKind(element: GreenElement): SyntaxKind | undefined {
  if (element instanceof GreenNode) {
    for (let index = element.children.length - 1; index >= 0; index--) {
      const lastKind = lastElementSyntaxKind(element.children[index]!);
      if (lastKind !== undefined) return lastKind;
    }
    return undefined;
  }
  return element.kind;
}
