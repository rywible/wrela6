import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import type { GreenElement, GreenNode } from "../syntax/green-node";
import { parseBlock } from "./block-parser";
import { blockItemRecoveryKinds } from "./parser-recovery";
import { parseTypeReference } from "./type-parser";
import { canStartExpression, isNameTokenSyntaxKind } from "./parser-utils";
import {
  parseExpression,
  parseExpressionWithContext,
  DEFAULT_EXPRESSION_CONTEXT,
} from "./expression-parser";
import { nodeFromMark } from "./node-claim";

export function parseDeriveSection(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.DeriveKeyword));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    itemParser: parseDerivedField,
    recoveryKinds: blockItemRecoveryKinds,
    optionalColon: true,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.DeriveSection, children });
}

export function parseDerivedField(context: ParserContext): GreenNode | undefined {
  if (context.currentSyntaxKind() !== SyntaxKind.IdentifierToken) {
    return undefined;
  }

  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.consume());
  children.push(context.expect(SyntaxKind.ColonToken));
  children.push(parseTypeReference(context));
  children.push(context.expect(SyntaxKind.FromKeyword));
  children.push(parseExpression(context));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    itemParser: parseDeriveCase,
    recoveryKinds: blockItemRecoveryKinds,
    optionalColon: true,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.DerivedField, children });
}

export function parseDeriveCase(context: ParserContext): GreenNode | undefined {
  if (
    context.currentSyntaxKind() === SyntaxKind.NewlineToken ||
    context.currentSyntaxKind() === SyntaxKind.DedentToken ||
    context.currentSyntaxKind() === SyntaxKind.EndOfFileToken
  ) {
    return undefined;
  }

  if (
    !canStartExpression(context.currentSyntaxKind()) &&
    context.currentSyntaxKind() !== SyntaxKind.OtherwiseKeyword &&
    !isNameTokenSyntaxKind(context.currentSyntaxKind())
  ) {
    return undefined;
  }

  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  let leftExpr: GreenNode;
  if (context.currentSyntaxKind() === SyntaxKind.OtherwiseKeyword) {
    leftExpr = factory.node(SyntaxKind.NameExpression, [context.consume()]);
  } else {
    leftExpr = parseExpressionWithContext(context, {
      ...DEFAULT_EXPRESSION_CONTEXT,
      stopBeforeFatArrow: true,
    });
  }
  children.push(leftExpr);

  children.push(context.expect(SyntaxKind.FatArrowToken));

  const rightExpr = parseExpression(context);
  children.push(rightExpr);

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.DeriveCase, children });
}

export function parseRequireSection(context: ParserContext): GreenNode {
  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  children.push(context.expect(SyntaxKind.RequireKeyword));
  children.push(context.expect(SyntaxKind.ColonToken));

  const block = parseBlock(context, {
    itemParser: parseRequirement,
    recoveryKinds: blockItemRecoveryKinds,
    optionalColon: true,
  });
  children.push(block);

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.RequireSection, children });
}

export function parseRequirement(context: ParserContext): GreenNode | undefined {
  if (
    context.currentSyntaxKind() === SyntaxKind.NewlineToken ||
    context.currentSyntaxKind() === SyntaxKind.DedentToken ||
    context.currentSyntaxKind() === SyntaxKind.EndOfFileToken
  ) {
    return undefined;
  }

  if (
    !canStartExpression(context.currentSyntaxKind()) &&
    !isNameTokenSyntaxKind(context.currentSyntaxKind())
  ) {
    return undefined;
  }

  const factory = context.factory;
  const mark = context.mark();
  const children: GreenElement[] = [];

  const expr = parseExpressionWithContext(context, {
    ...DEFAULT_EXPRESSION_CONTEXT,
    allowElseRequirement: true,
  });
  children.push(expr);

  if (context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
    children.push(context.consume());
  }

  return nodeFromMark({ factory, context, mark, kind: SyntaxKind.Requirement, children });
}
