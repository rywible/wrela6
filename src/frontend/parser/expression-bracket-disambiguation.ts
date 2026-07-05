import type { GreenNode } from "../syntax/green-node";
import { SyntaxKind } from "../syntax/syntax-kind";
import { syntaxKindFromTokenKind } from "../syntax/syntax-kind-map";
import type { ParserContext } from "./parser-context";
import { isNameTokenSyntaxKind } from "./parser-utils";

export function shouldParseIndexExpression(context: ParserContext, receiver: GreenNode): boolean {
  const bracketLooksLikeTypeApplication = shouldParseTypeApplication(context);
  if (!isUppercaseNameExpression(receiver)) return !bracketLooksLikeTypeApplication;
  if (bracketLooksLikeTypeApplication || shouldRecoverTypeApplication(context)) return false;

  let depth = 0;
  for (let lookahead = 1; ; lookahead++) {
    const token = context.peek(lookahead);
    const kind = syntaxKindFromTokenKind(token.kind);
    if (kind === SyntaxKind.EndOfFileToken || kind === SyntaxKind.NewlineToken) {
      return true;
    }
    if (kind === SyntaxKind.LeftBracketToken) {
      depth++;
      continue;
    }
    if (kind === SyntaxKind.RightBracketToken) {
      if (depth === 0) return false;
      depth--;
      continue;
    }
    if (
      depth === 0 &&
      kind !== SyntaxKind.IdentifierToken &&
      kind !== SyntaxKind.CommaToken &&
      kind !== SyntaxKind.DotToken
    ) {
      return true;
    }
  }
}

const CORE_TYPE_ARGUMENT_NAMES = new Set([
  "Never",
  "Unit",
  "bool",
  "u8",
  "u16",
  "u32",
  "u64",
  "usize",
  "i8",
  "i16",
  "i32",
  "i64",
  "isize",
]);

function shouldParseTypeApplication(context: ParserContext): boolean {
  let depth = 0;
  let lastNameInArgument: string | undefined;
  let sawArgument = false;

  for (let lookahead = 1; ; lookahead++) {
    const token = context.peek(lookahead);
    const kind = syntaxKindFromTokenKind(token.kind);
    if (kind === SyntaxKind.EndOfFileToken || kind === SyntaxKind.NewlineToken) return false;

    if (kind === SyntaxKind.LeftBracketToken) {
      depth++;
      continue;
    }

    if (kind === SyntaxKind.RightBracketToken) {
      if (depth > 0) {
        depth--;
        continue;
      }
      if (!isTypeArgumentName(lastNameInArgument)) return false;
      const afterBracket = syntaxKindFromTokenKind(context.peek(lookahead + 1).kind);
      return sawArgument && afterBracket === SyntaxKind.LeftParenToken;
    }

    if (depth !== 0) continue;

    if (kind === SyntaxKind.CommaToken) {
      if (!isTypeArgumentName(lastNameInArgument)) return false;
      lastNameInArgument = undefined;
      continue;
    }

    if (kind === SyntaxKind.DotToken) continue;

    if (isNameTokenSyntaxKind(kind)) {
      sawArgument = true;
      lastNameInArgument = token.lexeme.trim();
      continue;
    }

    return false;
  }
}

function shouldRecoverTypeApplication(context: ParserContext): boolean {
  let depth = 0;
  let lastNameInArgument: string | undefined;
  let sawArgument = false;

  for (let lookahead = 1; ; lookahead++) {
    const token = context.peek(lookahead);
    const kind = syntaxKindFromTokenKind(token.kind);
    if (kind === SyntaxKind.EndOfFileToken || kind === SyntaxKind.NewlineToken) {
      return sawArgument && isTypeArgumentName(lastNameInArgument);
    }

    if (kind === SyntaxKind.LeftBracketToken) {
      depth++;
      continue;
    }

    if (kind === SyntaxKind.RightBracketToken) return false;
    if (depth !== 0) continue;
    if (kind === SyntaxKind.CommaToken) {
      if (!isTypeArgumentName(lastNameInArgument)) return false;
      lastNameInArgument = undefined;
      continue;
    }
    if (kind === SyntaxKind.DotToken) continue;
    if (isNameTokenSyntaxKind(kind)) {
      sawArgument = true;
      lastNameInArgument = token.lexeme.trim();
      continue;
    }
    return false;
  }
}

function isTypeArgumentName(name: string | undefined): boolean {
  if (name === undefined || name.length === 0) return false;
  return CORE_TYPE_ARGUMENT_NAMES.has(name) || /^[A-Z]/.test(name);
}

function isUppercaseNameExpression(node: GreenNode): boolean {
  if (node.kind !== SyntaxKind.NameExpression) return false;
  const text = node.reconstruct();
  return /^[A-Z]/.test(text);
}
