import type { DiagnosticSink } from "./diagnostics";
import type { SourceText } from "./source-text";
import { Token } from "./token";
import { TokenKind } from "./token-kind";
import { TokenStream } from "./token-stream";
import { Trivia } from "./trivia";
import { TriviaKind } from "./trivia-kind";
import type { KeywordTable } from "./keyword-table";
import { Cursor } from "./cursor";

export interface LexResult {
  source: SourceText;
  tokens: TokenStream;
}

interface LexerDependencies {
  keywords: KeywordTable;
  diagnostics: DiagnosticSink;
}

export class Lexer {
  constructor(private readonly dependencies: LexerDependencies) {}

  lex(source: SourceText): LexResult {
    const cursor = new Cursor(source);
    const tokens: Token[] = [];

    let leadingTrivia = this.scanTrivia(source, cursor);

    while (!cursor.isAtEnd()) {
      const current = cursor.peek();

      if (current === "\r" || current === "\n") {
        this.scanNewline(source, cursor, tokens, leadingTrivia);
        leadingTrivia = this.scanTrivia(source, cursor);
      } else {
        const start = cursor.offset;
        cursor.advance();
        const lexeme = source.text.slice(start, cursor.offset);
        const span = source.span(start, cursor.offset);

        const trailingTrivia = this.scanTrivia(source, cursor);

        tokens.push(
          new Token({
            kind: TokenKind.Invalid,
            lexeme,
            span,
            leadingTrivia,
            trailingTrivia,
          }),
        );

        leadingTrivia = [];
      }
    }

    const remainingTrivia = this.scanTrivia(source, cursor);
    const eofSpan = source.span(source.length, source.length);

    tokens.push(
      new Token({
        kind: TokenKind.Eof,
        lexeme: "",
        span: eofSpan,
        leadingTrivia: [...leadingTrivia, ...remainingTrivia],
        trailingTrivia: [],
      }),
    );

    return {
      source,
      tokens: TokenStream.from(tokens),
    };
  }

  private scanTrivia(source: SourceText, cursor: Cursor): Trivia[] {
    const trivia: Trivia[] = [];

    while (!cursor.isAtEnd()) {
      const current = cursor.peek();

      if (current === " " || current === "\t") {
        const start = cursor.offset;
        cursor.advance();

        while (!cursor.isAtEnd()) {
          const next = cursor.peek();
          if (next === " " || next === "\t") {
            cursor.advance();
          } else {
            break;
          }
        }

        trivia.push(
          new Trivia({
            kind: TriviaKind.Whitespace,
            lexeme: source.text.slice(start, cursor.offset),
            span: cursor.spanFrom(start),
          }),
        );
      } else if (current === "/" && cursor.peek(1) === "/") {
        const start = cursor.offset;
        cursor.advanceBy(2);

        while (!cursor.isAtEnd()) {
          const next = cursor.peek();
          if (next !== "\r" && next !== "\n") {
            cursor.advance();
          } else {
            break;
          }
        }

        trivia.push(
          new Trivia({
            kind: TriviaKind.LineComment,
            lexeme: source.text.slice(start, cursor.offset),
            span: cursor.spanFrom(start),
          }),
        );
      } else {
        break;
      }
    }

    return trivia;
  }

  private scanNewline(
    source: SourceText,
    cursor: Cursor,
    tokens: Token[],
    leadingTrivia: Trivia[],
  ): void {
    const start = cursor.offset;
    const first = cursor.advance();

    if (first === "\r" && cursor.peek() === "\n") {
      cursor.advance();
    }

    const lexeme = source.text.slice(start, cursor.offset);
    const span = cursor.spanFrom(start);

    tokens.push(
      new Token({
        kind: TokenKind.Newline,
        lexeme,
        span,
        leadingTrivia,
        trailingTrivia: [],
      }),
    );
  }
}
