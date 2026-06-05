import { SyntaxKind } from "../syntax/syntax-kind";
import { TokenKind } from "../lexer/token-kind";
import { ParserContext } from "./parser-context";
import { GreenNode, type GreenElement } from "../syntax/green-node";
import { parseFunctionSignature } from "./function-signature-parser";
import { parseExpressionWithContext } from "./expression-parser";
import { parseBlock, tryParseStatement } from "./block-parser";
import { blockItemRecoveryKinds } from "./parser-recovery";
import { nodeFromMark } from "./node-claim";

export function parseFunctionDeclaration(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  const signatureChildren = parseFunctionSignature(context);
  for (const child of signatureChildren) {
    children.push(child);
  }

  if (context.currentSyntaxKind() === SyntaxKind.ColonToken) {
    const block = parseBlock(context, {
      itemParser: parseFunctionBodyItem,
      recoveryKinds: blockItemRecoveryKinds,
    });
    children.push(block);
  } else if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    const afterNewline = context.peek(1);
    const afterIndent = context.peek(2);
    if (afterNewline.kind === TokenKind.Indent && afterIndent.kind === TokenKind.Requires) {
      children.push(context.consume());
      children.push(context.consume());
      children.push(parseRequiresSection(context));
      if (context.currentSyntaxKind() === SyntaxKind.DedentToken) {
        children.push(context.consume());
      }
    } else {
      children.push(context.consume());
    }
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.FunctionDeclaration, children });
}

function parseFunctionBodyItem(context: ParserContext): GreenElement | undefined {
  if (context.currentSyntaxKind() === SyntaxKind.RequiresKeyword) {
    return parseRequiresSection(context);
  }
  return tryParseStatement(context);
}

export function parseRequiresSection(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.RequiresKeyword));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    itemParser: parseRequirement,
    recoveryKinds: blockItemRecoveryKinds,
    optionalColon: true,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.RequiresSection, children });
}

function parseRequirement(context: ParserContext): GreenNode | undefined {
  if (
    context.currentSyntaxKind() === SyntaxKind.NewlineToken ||
    context.currentSyntaxKind() === SyntaxKind.DedentToken ||
    context.currentSyntaxKind() === SyntaxKind.EndOfFileToken
  ) {
    return undefined;
  }

  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  const expr = parseExpressionWithContext(context, {
    minimumBindingPower: 0,
    allowElseRequirement: true,
    allowDeriveArrow: false,
    stopBeforeFatArrow: false,
    stopKinds: new Set([
      SyntaxKind.NewlineToken,
      SyntaxKind.DedentToken,
      SyntaxKind.EndOfFileToken,
    ]),
  });
  children.push(expr);

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.Requirement, children });
}

export function isFunctionStarter(kind: SyntaxKind): boolean {
  return (
    kind === SyntaxKind.FnKeyword ||
    kind === SyntaxKind.ConstructorKeyword ||
    kind === SyntaxKind.TerminalKeyword ||
    kind === SyntaxKind.PredicateKeyword ||
    kind === SyntaxKind.PlatformKeyword ||
    kind === SyntaxKind.PrivateKeyword
  );
}
