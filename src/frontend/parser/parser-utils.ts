import { SyntaxKind } from "../syntax/syntax-kind";
import type { ParserContext } from "./parser-context";
import { type GreenElement } from "../syntax/green-node";
import { syntaxKindFromTokenKind } from "../syntax/syntax-kind-map";

export interface DelimitedListOptions {
  open: SyntaxKind;
  close: SyntaxKind;
  elementParser: (context: ParserContext) => GreenElement;
  allowTrailingComma?: boolean;
  skipNewlines?: boolean;
}

export function parseDelimitedList(
  context: ParserContext,
  options: DelimitedListOptions,
): GreenElement[] {
  const children: GreenElement[] = [];

  children.push(context.expect(options.open));

  while (!context.isAtEnd && context.currentSyntaxKind() !== options.close) {
    if (options.skipNewlines && context.currentSyntaxKind() === SyntaxKind.NewlineToken) {
      children.push(context.consume());
      continue;
    }

    if (options.skipNewlines && context.currentSyntaxKind() === SyntaxKind.IndentToken) {
      children.push(context.consume());
      continue;
    }

    if (context.currentSyntaxKind() === SyntaxKind.DedentToken) {
      const next = context.peek(1);
      if (next && syntaxKindFromTokenKind(next.kind) === options.close) {
        children.push(context.consume());
        break;
      }
      break;
    }

    const element = options.elementParser(context);
    children.push(element);

    if (context.currentSyntaxKind() === SyntaxKind.CommaToken) {
      children.push(context.consume());
      if (options.allowTrailingComma && context.currentSyntaxKind() === options.close) {
        break;
      }
    } else {
      break;
    }
  }

  children.push(context.expect(options.close));

  return children;
}

const NAME_TOKEN_KINDS = new Set<SyntaxKind>([
  SyntaxKind.IdentifierToken,
  SyntaxKind.UseKeyword,
  SyntaxKind.FromKeyword,
  SyntaxKind.UefiKeyword,
  SyntaxKind.ImageKeyword,
  SyntaxKind.DevicesKeyword,
  SyntaxKind.UniqueKeyword,
  SyntaxKind.EdgeKeyword,
  SyntaxKind.ClassKeyword,
  SyntaxKind.DataclassKeyword,
  SyntaxKind.ValidatedKeyword,
  SyntaxKind.BufferKeyword,
  SyntaxKind.StreamKeyword,
  SyntaxKind.ContainsKeyword,
  SyntaxKind.BoundKeyword,
  SyntaxKind.EnumKeyword,
  SyntaxKind.InterfaceKeyword,
  SyntaxKind.ConstructorKeyword,
  SyntaxKind.FnKeyword,
  SyntaxKind.PrivateKeyword,
  SyntaxKind.PlatformKeyword,
  SyntaxKind.TerminalKeyword,
  SyntaxKind.PredicateKeyword,
  SyntaxKind.RequiresKeyword,
  SyntaxKind.ConsumeKeyword,
  SyntaxKind.ParamsKeyword,
  SyntaxKind.LayoutKeyword,
  SyntaxKind.DeriveKeyword,
  SyntaxKind.RequireKeyword,
  SyntaxKind.AtKeyword,
  SyntaxKind.LenKeyword,
  SyntaxKind.ElseKeyword,
  SyntaxKind.OtherwiseKeyword,
  SyntaxKind.LetKeyword,
  SyntaxKind.IfKeyword,
  SyntaxKind.NotKeyword,
  SyntaxKind.WhileKeyword,
  SyntaxKind.ForKeyword,
  SyntaxKind.InKeyword,
  SyntaxKind.LoopKeyword,
  SyntaxKind.MatchKeyword,
  SyntaxKind.CaseKeyword,
  SyntaxKind.ReturnKeyword,
  SyntaxKind.YieldKeyword,
  SyntaxKind.ContinueKeyword,
  SyntaxKind.TakeKeyword,
  SyntaxKind.AsKeyword,
  SyntaxKind.WithKeyword,
]);

export function isNameTokenSyntaxKind(kind: SyntaxKind): boolean {
  return NAME_TOKEN_KINDS.has(kind);
}

const EXPRESSION_STARTER_KINDS = new Set<SyntaxKind>([
  SyntaxKind.IdentifierToken,
  SyntaxKind.IntegerLiteralToken,
  SyntaxKind.StringLiteralToken,
  SyntaxKind.TrueKeyword,
  SyntaxKind.FalseKeyword,
  SyntaxKind.LeftBraceToken,
  SyntaxKind.NotKeyword,
  SyntaxKind.TildeToken,
  SyntaxKind.MinusToken,
]);

export function canStartExpression(kind: SyntaxKind): boolean {
  return EXPRESSION_STARTER_KINDS.has(kind);
}
