import { TokenKind } from "../lexer/token-kind";
import type { Token } from "../lexer/token";
import type { TokenStream } from "../lexer/token-stream";
import { SyntaxKind } from "../syntax/syntax-kind";
import { GreenToken } from "../syntax/green-token";
import type { SyntaxFactory } from "../syntax/syntax-factory";
import { syntaxKindFromTokenKind } from "../syntax/syntax-kind-map";
import type { ParseDiagnosticCode } from "./parser-diagnostics";
import type { ParserMark, DraftParseDiagnostic } from "./node-claim";

export class ParserContext {
  readonly factory: SyntaxFactory;
  private readonly tokens: TokenStream;
  private position: number;
  private readonly diagnostics: DraftParseDiagnostic[];
  private depth: number;
  readonly maxDepth: number;

  constructor(params: { tokens: TokenStream; factory: SyntaxFactory; maxDepth?: number }) {
    this.tokens = params.tokens;
    this.factory = params.factory;
    this.position = 0;
    this.diagnostics = [];
    this.depth = 0;
    this.maxDepth = params.maxDepth ?? 256;
  }

  get offset(): number {
    return this.currentToken().span.start;
  }

  get isAtEnd(): boolean {
    return this.currentToken().kind === TokenKind.Eof;
  }

  private currentToken(): Token {
    return this.tokens.at(this.position) ?? this.tokens.eof();
  }

  currentSyntaxKind(): SyntaxKind {
    return syntaxKindFromTokenKind(this.currentToken().kind);
  }

  peek(lookahead: number = 0): Token {
    return this.tokens.at(this.position + lookahead) ?? this.tokens.eof();
  }

  consume(): GreenToken {
    const token = this.currentToken();
    this.position++;
    return GreenToken.fromToken(token);
  }

  expect(kind: SyntaxKind): GreenToken {
    if (this.currentSyntaxKind() === kind) {
      return this.consume();
    }

    this.diagnostics.push({
      code: "PARSE_EXPECTED_TOKEN",
      severity: "error",
      message: `Expected ${SyntaxKind[kind]}.`,
      absoluteStart: this.offset,
      absoluteEnd: this.offset,
      ...stableDiagnosticParts("PARSE_EXPECTED_TOKEN", this.offset, this.offset),
      claimed: false,
    });

    return GreenToken.missing(kind);
  }

  mark(): ParserMark {
    return {
      offset: this.offset,
      diagnosticStartIndex: this.diagnostics.length,
    };
  }

  draftDiagnostics(): readonly DraftParseDiagnostic[] {
    return this.diagnostics;
  }

  reportAtCurrent(code: ParseDiagnosticCode, message: string): void {
    this.diagnostics.push({
      code,
      severity: "error",
      message,
      absoluteStart: this.offset,
      absoluteEnd: this.offset,
      ...stableDiagnosticParts(code, this.offset, this.offset),
      claimed: false,
    });
  }

  reportSpan(code: ParseDiagnosticCode, message: string, start: number, end: number): void {
    this.diagnostics.push({
      code,
      severity: "error",
      message,
      absoluteStart: start,
      absoluteEnd: end,
      ...stableDiagnosticParts(code, start, end),
      claimed: false,
    });
  }

  enterRecursion(): boolean {
    if (this.depth >= this.maxDepth) {
      this.diagnostics.push({
        code: "PARSE_NESTING_LIMIT_EXCEEDED",
        severity: "error",
        message: "Parser nesting limit exceeded.",
        absoluteStart: this.offset,
        absoluteEnd: this.offset,
        ...stableDiagnosticParts("PARSE_NESTING_LIMIT_EXCEEDED", this.offset, this.offset),
        claimed: false,
      });
      return false;
    }
    this.depth++;
    return true;
  }

  exitRecursion(): void {
    this.depth--;
  }

  skipUntil(syncKinds: ReadonlySet<SyntaxKind>): GreenToken[] {
    if (this.isAtEnd) return [];

    const start = this.offset;

    const skipped: GreenToken[] = [];
    while (!this.isAtEnd && !syncKinds.has(this.currentSyntaxKind())) {
      skipped.push(this.consume());
    }

    if (skipped.length > 0) {
      const end = this.offset;
      this.diagnostics.push({
        code: "PARSE_RECOVERY_SKIPPED_TOKENS",
        severity: "error",
        message: "Skipped unexpected tokens during recovery.",
        absoluteStart: start,
        absoluteEnd: end,
        ...stableDiagnosticParts("PARSE_RECOVERY_SKIPPED_TOKENS", start, end),
        claimed: false,
      });
    }

    return skipped;
  }
}

function stableDiagnosticParts(
  code: ParseDiagnosticCode,
  start: number,
  end: number,
): { readonly ownerKey: string; readonly stableDetail: string } {
  return {
    ownerKey: ownerKeyForParseDiagnostic(code),
    stableDetail: `span:${start}:${end}`,
  };
}

function ownerKeyForParseDiagnostic(code: ParseDiagnosticCode): string {
  switch (code) {
    case "PARSE_EXPECTED_STATEMENT_SEPARATOR":
      return "parser:statement-separator";
    case "PARSE_EXPECTED_TOP_LEVEL_DECLARATION":
      return "parser:top-level-declaration";
    case "PARSE_EXPECTED_DECLARATION":
      return "parser:declaration";
    case "PARSE_EXPECTED_EXPRESSION":
      return "parser:expression";
    case "PARSE_EXPECTED_TOKEN":
      return "parser:token";
    case "PARSE_NESTING_LIMIT_EXCEEDED":
      return "parser:nesting";
    case "PARSE_RECOVERY_SKIPPED_TOKENS":
      return "parser:recovery";
    case "PARSE_UNEXPECTED_TOKEN":
      return "parser:unexpected-token";
    case "PARSE_UNSUPPORTED_INDEX_EXPRESSION":
      return "parser:index-expression";
    case "PARSE_UNTERMINATED_BLOCK":
      return "parser:block";
  }
}
