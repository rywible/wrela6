import type { DiagnosticSink } from "./diagnostics";
import type { SourceText } from "./source-text";
import { Token } from "./token";
import { TokenKind } from "./token-kind";
import { TokenStream } from "./token-stream";
import { Trivia } from "./trivia";
import { TriviaKind } from "./trivia-kind";
import type { KeywordTable } from "./keyword-table";
import { Cursor } from "./cursor";
import { stableDiagnosticDetail } from "../../shared/diagnostics";
import { scanIntegerToken } from "./integer-scanner";
import { scanStringToken } from "./string-scanner";

export interface LexResult {
  source: SourceText;
  tokens: TokenStream;
}

interface LexerDependencies {
  keywords: KeywordTable;
  diagnostics: DiagnosticSink;
}

const COMPOUND_OPERATORS: Record<string, TokenKind> = {
  "->": TokenKind.Arrow,
  "=>": TokenKind.FatArrow,
  "==": TokenKind.EqualsEquals,
  "!=": TokenKind.BangEquals,
  "<=": TokenKind.LessEquals,
  ">=": TokenKind.GreaterEquals,
  "<<": TokenKind.LeftShift,
  ">>": TokenKind.RightShift,
};

const SINGLE_PUNCTUATION: Record<string, TokenKind> = {
  "(": TokenKind.LeftParen,
  ")": TokenKind.RightParen,
  "{": TokenKind.LeftBrace,
  "}": TokenKind.RightBrace,
  "[": TokenKind.LeftBracket,
  "]": TokenKind.RightBracket,
  ":": TokenKind.Colon,
  ",": TokenKind.Comma,
  ".": TokenKind.Dot,
  "=": TokenKind.Equals,
  "+": TokenKind.Plus,
  "-": TokenKind.Minus,
  "*": TokenKind.Star,
  "/": TokenKind.Slash,
  "%": TokenKind.Percent,
  "&": TokenKind.Ampersand,
  "|": TokenKind.Pipe,
  "^": TokenKind.Caret,
  "~": TokenKind.Tilde,
  "<": TokenKind.Less,
  ">": TokenKind.Greater,
  "?": TokenKind.Question,
  "@": TokenKind.At,
};

interface LinePreamble {
  indentation: Trivia | null;
  trivia: Trivia[];
}

export class Lexer {
  constructor(private readonly dependencies: LexerDependencies) {}

  lex(source: SourceText): LexResult {
    const cursor = new Cursor(source);
    const tokens: Token[] = [];
    const indentationStack: number[] = [0];

    let linePreamble = this.collectLinePreamble(source, cursor);

    while (!cursor.isAtEnd()) {
      const next = cursor.peek();

      if (next === "\r" || next === "\n") {
        this.emitNewlineWithTrivia(source, cursor, tokens, linePreamble);
        linePreamble = this.collectLinePreamble(source, cursor);
      } else {
        const indentationConsumed = this.processLineIndentation(
          source,
          cursor,
          tokens,
          linePreamble.indentation,
          indentationStack,
        );

        let currentLeading = indentationConsumed
          ? [...linePreamble.trivia]
          : this.collectLeadingFromPreamble(linePreamble);
        linePreamble = { indentation: null, trivia: [] };

        while (!cursor.isAtEnd()) {
          if (cursor.peek() === "\r" || cursor.peek() === "\n") {
            break;
          }

          const token = this.scanContentToken(source, cursor, currentLeading);
          tokens.push(token);

          currentLeading = [];

          const trailingTrivia = this.scanTrivia(source, cursor);

          if (cursor.isAtEnd() || cursor.peek() === "\r" || cursor.peek() === "\n") {
            if (trailingTrivia.length > 0) {
              tokens[tokens.length - 1] = new Token({
                kind: token.kind,
                lexeme: token.lexeme,
                span: token.span,
                leadingTrivia: token.leadingTrivia,
                trailingTrivia,
                cookedValue: token.cookedValue,
              });
            }

            break;
          }

          currentLeading = trailingTrivia;
        }

        if (!cursor.isAtEnd()) {
          this.emitNewlineWithTrivia(source, cursor, tokens, {
            indentation: null,
            trivia: [],
          });
          linePreamble = this.collectLinePreamble(source, cursor);
        }
      }
    }

    while (indentationStack.length > 1) {
      indentationStack.pop();
      tokens.push(
        new Token({
          kind: TokenKind.Dedent,
          lexeme: "",
          span: source.span(source.length, source.length),
          leadingTrivia: [],
          trailingTrivia: [],
        }),
      );
    }

    const eofTrivia = this.collectLeadingFromPreamble(linePreamble);
    tokens.push(
      new Token({
        kind: TokenKind.Eof,
        lexeme: "",
        span: source.span(source.length, source.length),
        leadingTrivia: eofTrivia,
        trailingTrivia: [],
      }),
    );

    return {
      source,
      tokens: TokenStream.from(tokens),
    };
  }

  private collectLeadingFromPreamble(preamble: LinePreamble): Trivia[] {
    const result: Trivia[] = [];

    if (preamble.indentation !== null) {
      result.push(preamble.indentation);
    }

    for (const item of preamble.trivia) {
      result.push(item);
    }

    return result;
  }

  private measureIndentation(text: string): number {
    let width = 0;

    for (const character of text) {
      if (character === " ") {
        width += 1;
      } else if (character === "\t") {
        width += 4;
      }
    }

    return width;
  }

  private canonicalizeIndent(measuredWidth: number, indentationStack: number[]): number {
    let result = 0;

    for (const level of indentationStack) {
      if (level <= measuredWidth && level > result) {
        result = level;
      }
    }

    return result;
  }

  private processLineIndentation(
    source: SourceText,
    cursor: Cursor,
    tokens: Token[],
    indentationTrivia: Trivia | null,
    indentationStack: number[],
  ): boolean {
    const indentText = indentationTrivia !== null ? indentationTrivia.lexeme : "";
    const width = indentationTrivia !== null ? this.measureIndentation(indentText) : 0;
    const containsTab = indentText.includes("\t");

    if (indentationTrivia !== null && width > 0 && (containsTab || width % 4 !== 0)) {
      this.dependencies.diagnostics.report({
        code: "LEX_INCONSISTENT_INDENT",
        severity: "error",
        message: containsTab
          ? "Inconsistent indentation: tab character in indentation."
          : `Inconsistent indentation: ${width} spaces is not a multiple of 4.`,
        source,
        span: indentationTrivia.span,
        ownerKey: "lexer:indentation",
        stableDetail: stableDiagnosticDetail({
          code: "LEX_INCONSISTENT_INDENT",
          source,
          span: indentationTrivia.span,
        }),
      });
    }

    const effectiveWidth =
      width % 4 === 0 ? width : this.canonicalizeIndent(width, indentationStack);

    const stackTop = indentationStack[indentationStack.length - 1]!;

    if (effectiveWidth > stackTop) {
      indentationStack.push(effectiveWidth);
      const leadingTrivia = indentationTrivia !== null ? [indentationTrivia] : [];
      tokens.push(
        new Token({
          kind: TokenKind.Indent,
          lexeme: "",
          span: source.span(cursor.offset, cursor.offset),
          leadingTrivia,
          trailingTrivia: [],
        }),
      );

      return true;
    } else if (effectiveWidth < stackTop) {
      let isFirstDedent = true;

      while (indentationStack[indentationStack.length - 1]! > effectiveWidth) {
        indentationStack.pop();
        const leadingTrivia =
          isFirstDedent && indentationTrivia !== null ? [indentationTrivia] : [];
        tokens.push(
          new Token({
            kind: TokenKind.Dedent,
            lexeme: "",
            span: source.span(cursor.offset, cursor.offset),
            leadingTrivia,
            trailingTrivia: [],
          }),
        );
        isFirstDedent = false;
      }

      if (indentationTrivia !== null && !indentationStack.includes(effectiveWidth)) {
        this.dependencies.diagnostics.report({
          code: "LEX_INCONSISTENT_INDENT",
          severity: "error",
          message: `Inconsistent indentation: width ${effectiveWidth} does not match any existing indentation level.`,
          source,
          span: indentationTrivia.span,
          ownerKey: "lexer:indentation",
          stableDetail: stableDiagnosticDetail({
            code: "LEX_INCONSISTENT_INDENT",
            source,
            span: indentationTrivia.span,
          }),
        });
      }

      return true;
    }

    return false;
  }

  private emitNewlineWithTrivia(
    source: SourceText,
    cursor: Cursor,
    tokens: Token[],
    linePreamble: LinePreamble,
  ): void {
    const start = cursor.offset;
    const first = cursor.advance();

    if (first === "\r" && cursor.peek() === "\n") {
      cursor.advance();
    }

    const leadingTrivia: Trivia[] = [];

    if (linePreamble.indentation !== null) {
      leadingTrivia.push(linePreamble.indentation);
    }

    for (const item of linePreamble.trivia) {
      leadingTrivia.push(item);
    }

    tokens.push(
      new Token({
        kind: TokenKind.Newline,
        lexeme: source.text.slice(start, cursor.offset),
        span: cursor.spanFrom(start),
        leadingTrivia,
        trailingTrivia: [],
      }),
    );
  }

  private collectLinePreamble(source: SourceText, cursor: Cursor): LinePreamble {
    const indentation = this.scanIndentation(source, cursor);
    const trivia = this.scanTrivia(source, cursor);

    return { indentation, trivia };
  }

  private scanIndentation(source: SourceText, cursor: Cursor): Trivia | null {
    const start = cursor.offset;
    const text = source.text;
    const length = text.length;
    let offset = start;

    while (offset < length && (text[offset] === " " || text[offset] === "\t")) {
      offset++;
    }

    if (offset === start) {
      return null;
    }

    cursor.advanceBy(offset - start);

    return new Trivia({
      kind: TriviaKind.IndentationWhitespace,
      lexeme: text.slice(start, offset),
      span: source.span(start, offset),
    });
  }

  private scanTrivia(source: SourceText, cursor: Cursor): Trivia[] {
    const trivia: Trivia[] = [];
    const text = source.text;
    const length = text.length;

    while (!cursor.isAtEnd()) {
      const current = text[cursor.offset]!;

      if (current === " " || current === "\t") {
        const start = cursor.offset;
        let offset = start;

        while (offset < length && (text[offset] === " " || text[offset] === "\t")) {
          offset++;
        }

        cursor.advanceBy(offset - start);

        trivia.push(
          new Trivia({
            kind: TriviaKind.Whitespace,
            lexeme: text.slice(start, offset),
            span: source.span(start, offset),
          }),
        );
      } else if (current === "/" && cursor.peek(1) === "/") {
        const start = cursor.offset;
        cursor.advanceBy(2);

        const currentOffset = cursor.offset;
        const newlinePos = text.indexOf("\n", currentOffset);
        const crPos = text.indexOf("\r", currentOffset);
        let stopPos = text.length;

        if (newlinePos !== -1 && crPos !== -1) {
          stopPos = newlinePos < crPos ? newlinePos : crPos;
        } else if (newlinePos !== -1) {
          stopPos = newlinePos;
        } else if (crPos !== -1) {
          stopPos = crPos;
        }

        cursor.advanceBy(stopPos - currentOffset);

        trivia.push(
          new Trivia({
            kind: TriviaKind.LineComment,
            lexeme: text.slice(start, cursor.offset),
            span: source.span(start, cursor.offset),
          }),
        );
      } else {
        break;
      }
    }

    return trivia;
  }

  private scanContentToken(source: SourceText, cursor: Cursor, leadingTrivia: Trivia[]): Token {
    const current = cursor.peek()!;

    if (isIdentifierStart(current)) {
      return this.scanIdentifierOrKeyword(source, cursor, leadingTrivia);
    }

    if (isDigit(current)) {
      return scanIntegerToken({
        source,
        cursor,
        leadingTrivia,
        diagnostics: this.dependencies.diagnostics,
      });
    }

    if (current === '"') {
      return scanStringToken({
        source,
        cursor,
        leadingTrivia,
        diagnostics: this.dependencies.diagnostics,
      });
    }

    const punctuationResult = this.tryScanPunctuationOrOperator(source, cursor);

    if (punctuationResult !== null) {
      return new Token({
        kind: punctuationResult.kind,
        lexeme: source.text.slice(punctuationResult.start, cursor.offset),
        span: cursor.spanFrom(punctuationResult.start),
        leadingTrivia,
        trailingTrivia: [],
      });
    }

    return this.scanInvalid(source, cursor, leadingTrivia);
  }

  private scanIdentifierOrKeyword(
    source: SourceText,
    cursor: Cursor,
    leadingTrivia: Trivia[],
  ): Token {
    const start = cursor.offset;
    const text = source.text;
    const length = text.length;
    let offset = start;

    cursor.advance();
    offset++;

    while (offset < length && isIdentifierPart(text[offset]!)) {
      offset++;
    }

    cursor.advanceBy(offset - cursor.offset);
    const lexeme = text.slice(start, offset);
    const kind = this.dependencies.keywords.lookup(lexeme);

    return new Token({
      kind,
      lexeme,
      span: source.span(start, offset),
      leadingTrivia,
      trailingTrivia: [],
    });
  }

  private tryScanPunctuationOrOperator(
    source: SourceText,
    cursor: Cursor,
  ): { kind: TokenKind; start: number } | null {
    const first = cursor.peek()!;
    const start = cursor.offset;

    if (first === "!" || first === "=" || first === "<" || first === ">" || first === "-") {
      const twoChar = first + (cursor.peek(1) ?? "");

      const compoundKind = COMPOUND_OPERATORS[twoChar];
      if (compoundKind !== undefined) {
        cursor.advanceBy(2);
        return { kind: compoundKind, start };
      }
    }

    const singleKind = SINGLE_PUNCTUATION[first];
    if (singleKind !== undefined) {
      cursor.advance();
      return { kind: singleKind, start };
    }

    return null;
  }

  private scanInvalid(source: SourceText, cursor: Cursor, leadingTrivia: Trivia[]): Token {
    const start = cursor.offset;
    cursor.advance();
    const span = cursor.spanFrom(start);

    this.dependencies.diagnostics.report({
      code: "LEX_INVALID_CHARACTER",
      severity: "error",
      message: `Invalid character '${source.text.slice(start, cursor.offset)}'.`,
      source,
      span,
      ownerKey: "lexer:character",
      stableDetail: stableDiagnosticDetail({
        code: "LEX_INVALID_CHARACTER",
        source,
        span,
      }),
    });

    return new Token({
      kind: TokenKind.Invalid,
      lexeme: source.text.slice(start, cursor.offset),
      span: cursor.spanFrom(start),
      leadingTrivia,
      trailingTrivia: [],
    });
  }
}

function isIdentifierStart(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z") ||
    character === "_"
  );
}

function isIdentifierPart(character: string): boolean {
  return isIdentifierStart(character) || (character >= "0" && character <= "9");
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}
