import type { DiagnosticSink } from "./diagnostics";
import type { Cursor } from "./cursor";
import type { SourceText } from "./source-text";
import { stableDiagnosticDetail } from "../../shared/diagnostics";
import { Token } from "./token";
import { TokenKind } from "./token-kind";
import type { Trivia } from "./trivia";

type StringEscapeDecodeResult =
  | { readonly kind: "valid"; readonly value: string; readonly end: number }
  | { readonly kind: "invalid"; readonly end: number };

export function scanStringToken(input: {
  readonly source: SourceText;
  readonly cursor: Cursor;
  readonly leadingTrivia: readonly Trivia[];
  readonly diagnostics: DiagnosticSink;
}): Token {
  const start = input.cursor.offset;
  input.cursor.advance();
  const text = input.source.text;
  const length = text.length;
  let offset = input.cursor.offset;
  let cookedValue = "";

  while (offset < length) {
    const char = text[offset]!;

    if (char === '"') {
      input.cursor.advanceBy(offset + 1 - input.cursor.offset);
      return stringToken(input.source, start, offset + 1, input.leadingTrivia, cookedValue);
    }

    if (char === "\r" || char === "\n") {
      input.cursor.advanceBy(offset - input.cursor.offset);
      const span = input.cursor.spanFrom(start);
      input.diagnostics.report({
        code: "LEX_UNTERMINATED_STRING",
        severity: "error",
        message: "Unterminated string literal.",
        source: input.source,
        span,
        ownerKey: "lexer:string",
        stableDetail: stableDiagnosticDetail({
          code: "LEX_UNTERMINATED_STRING",
          source: input.source,
          span,
        }),
      });
      return stringToken(
        input.source,
        start,
        input.cursor.offset,
        input.leadingTrivia,
        cookedValue,
      );
    }

    if (char === "\\") {
      const escapeStart = offset;
      const after = text[offset + 1];

      if (after === "\r" || after === "\n" || after === undefined) {
        input.cursor.advanceBy(offset + 1 - input.cursor.offset);
        const span = input.cursor.spanFrom(start);
        input.diagnostics.report({
          code: "LEX_UNTERMINATED_STRING",
          severity: "error",
          message: "Unterminated string literal after trailing escape.",
          source: input.source,
          span,
          ownerKey: "lexer:string",
          stableDetail: stableDiagnosticDetail({
            code: "LEX_UNTERMINATED_STRING",
            source: input.source,
            span,
          }),
        });
        return stringToken(
          input.source,
          start,
          input.cursor.offset,
          input.leadingTrivia,
          cookedValue,
        );
      }

      const escape = decodeStringEscape(text, escapeStart);
      if (escape.kind === "valid") {
        cookedValue += escape.value;
        offset = escape.end;
      } else {
        const span = input.source.span(escapeStart, escape.end);
        input.diagnostics.report({
          code: "LEX_INVALID_ESCAPE",
          severity: "error",
          message: `Invalid string escape '${text.slice(escapeStart, escape.end)}'.`,
          source: input.source,
          span,
          ownerKey: "lexer:string:escape",
          stableDetail: stableDiagnosticDetail({
            code: "LEX_INVALID_ESCAPE",
            source: input.source,
            span,
          }),
        });
        cookedValue += "\uFFFD";
        offset = escape.end;
      }
      continue;
    }

    cookedValue += char;
    offset++;
  }

  input.cursor.advanceBy(offset - input.cursor.offset);
  const span = input.cursor.spanFrom(start);
  input.diagnostics.report({
    code: "LEX_UNTERMINATED_STRING",
    severity: "error",
    message: "Unterminated string literal at end of file.",
    source: input.source,
    span,
    ownerKey: "lexer:string",
    stableDetail: stableDiagnosticDetail({
      code: "LEX_UNTERMINATED_STRING",
      source: input.source,
      span,
    }),
  });
  return stringToken(input.source, start, input.cursor.offset, input.leadingTrivia, cookedValue);
}

function stringToken(
  source: SourceText,
  start: number,
  end: number,
  leadingTrivia: readonly Trivia[],
  cookedValue: string,
): Token {
  return new Token({
    kind: TokenKind.StringLiteral,
    lexeme: source.text.slice(start, end),
    span: source.span(start, end),
    leadingTrivia: [...leadingTrivia],
    trailingTrivia: [],
    cookedValue,
  });
}

function decodeStringEscape(text: string, start: number): StringEscapeDecodeResult {
  const escaped = text[start + 1];
  if (escaped === undefined) return { kind: "invalid", end: start + 1 };

  switch (escaped) {
    case "\\":
      return { kind: "valid", value: "\\", end: start + 2 };
    case '"':
      return { kind: "valid", value: '"', end: start + 2 };
    case "n":
      return { kind: "valid", value: "\n", end: start + 2 };
    case "r":
      return { kind: "valid", value: "\r", end: start + 2 };
    case "t":
      return { kind: "valid", value: "\t", end: start + 2 };
    case "0":
      return { kind: "valid", value: "\0", end: start + 2 };
    case "x":
      return decodeHexByteEscape(text, start);
    case "u":
      return decodeUnicodeScalarEscape(text, start);
    default:
      return { kind: "invalid", end: start + 2 };
  }
}

function decodeHexByteEscape(text: string, start: number): StringEscapeDecodeResult {
  const first = text[start + 2];
  const second = text[start + 3];
  const end = start + 4;
  if (first === undefined || !isHexDigit(first)) {
    return { kind: "invalid", end: start + 2 };
  }
  if (second === undefined || !isHexDigit(second)) {
    return { kind: "invalid", end: start + 3 };
  }
  return {
    kind: "valid",
    value: String.fromCharCode(Number.parseInt(first + second, 16)),
    end,
  };
}

function decodeUnicodeScalarEscape(text: string, start: number): StringEscapeDecodeResult {
  if (text[start + 2] !== "{") {
    return { kind: "invalid", end: Math.min(start + 3, text.length) };
  }

  let offset = start + 3;
  while (offset < text.length && isHexDigit(text[offset]!) && offset < start + 9) {
    offset++;
  }

  const digits = text.slice(start + 3, offset);
  if (digits.length === 0 || text[offset] !== "}") {
    return { kind: "invalid", end: Math.min(offset + 1, text.length) };
  }

  const scalarValue = Number.parseInt(digits, 16);
  const isValidScalar =
    scalarValue <= 0x10ffff && !(scalarValue >= 0xd800 && scalarValue <= 0xdfff);
  if (!isValidScalar) return { kind: "invalid", end: offset + 1 };

  return { kind: "valid", value: String.fromCodePoint(scalarValue), end: offset + 1 };
}

function isHexDigit(character: string): boolean {
  return (
    (character >= "0" && character <= "9") ||
    (character >= "a" && character <= "f") ||
    (character >= "A" && character <= "F")
  );
}
