import { parseWrIntegerLiteral } from "../../shared/integer-literal";
import { stableDiagnosticDetail } from "../../shared/diagnostics";
import type { DiagnosticSink } from "./diagnostics";
import type { Cursor } from "./cursor";
import type { SourceText } from "./source-text";
import { Token } from "./token";
import { TokenKind } from "./token-kind";
import type { Trivia } from "./trivia";

export function scanIntegerToken(input: {
  readonly source: SourceText;
  readonly cursor: Cursor;
  readonly leadingTrivia: readonly Trivia[];
  readonly diagnostics: DiagnosticSink;
}): Token {
  const start = input.cursor.offset;
  const text = input.source.text;
  const length = text.length;
  let offset = start;

  input.cursor.advance();
  offset++;

  while (offset < length && isIntegerLiteralPart(text[offset]!)) {
    offset++;
  }

  input.cursor.advanceBy(offset - input.cursor.offset);
  const lexeme = text.slice(start, offset);

  if (parseWrIntegerLiteral(lexeme) === undefined) {
    const span = input.source.span(start, offset);
    input.diagnostics.report({
      code: "LEX_MALFORMED_INTEGER",
      severity: "error",
      message: "Malformed integer literal.",
      source: input.source,
      span,
      ownerKey: "lexer:integer",
      stableDetail: stableDiagnosticDetail({
        code: "LEX_MALFORMED_INTEGER",
        source: input.source,
        span,
      }),
    });
  }

  return new Token({
    kind: TokenKind.IntegerLiteral,
    lexeme,
    span: input.source.span(start, offset),
    leadingTrivia: [...input.leadingTrivia],
    trailingTrivia: [],
  });
}

function isIntegerLiteralPart(character: string): boolean {
  return (
    (character >= "0" && character <= "9") ||
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    character === "_"
  );
}
