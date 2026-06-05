import { describe, expect, test } from "bun:test";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SyntaxFactory } from "../../../../src/frontend/syntax/syntax-factory";
import { nodeFromMark, type ParserMark } from "../../../../src/frontend/parser/node-claim";
import { ParserContext } from "../../../../src/frontend/parser/parser-context";

function makeToken(kind: TokenKind, lexeme: string, start: number, end: number): Token {
  return new Token({
    kind,
    lexeme,
    span: SourceSpan.from(start, end),
    leadingTrivia: [],
    trailingTrivia: [],
  });
}

function makeContext(tokens: Token[]): ParserContext {
  const stream = TokenStream.from(tokens);
  const factory = new SyntaxFactory();
  return new ParserContext({ tokens: stream, factory });
}

describe("ParserContext", () => {
  const ident1 = makeToken(TokenKind.Identifier, "hello", 0, 5);
  const ident2 = makeToken(TokenKind.Identifier, "world", 6, 11);
  const eof = makeToken(TokenKind.Eof, "", 11, 11);

  describe("peek", () => {
    test("peek(0) returns the current token", () => {
      const context = makeContext([ident1, ident2, eof]);
      expect(context.peek(0).kind).toBe(TokenKind.Identifier);
      expect(context.peek(0).lexeme).toBe("hello");
    });

    test("peek(1) returns the next token", () => {
      const context = makeContext([ident1, ident2, eof]);
      expect(context.peek(1).kind).toBe(TokenKind.Identifier);
      expect(context.peek(1).lexeme).toBe("world");
    });

    test("peek past end returns EOF", () => {
      const context = makeContext([eof]);
      expect(context.peek(0).kind).toBe(TokenKind.Eof);
      expect(context.peek(5).kind).toBe(TokenKind.Eof);
    });

    test("peek does not advance position", () => {
      const context = makeContext([ident1, ident2, eof]);
      expect(context.peek(1).lexeme).toBe("world");
      expect(context.peek(0).lexeme).toBe("hello");
    });
  });

  describe("consume", () => {
    test("advances position and returns a GreenToken", () => {
      const context = makeContext([ident1, ident2, eof]);
      const token = context.consume();
      expect(token.lexeme).toBe("hello");
      expect(token.isMissing).toBe(false);
      expect(context.peek(0).lexeme).toBe("world");
    });

    test("advances exactly one token per call", () => {
      const context = makeContext([ident1, ident2, eof]);
      const first = context.consume();
      expect(first.lexeme).toBe("hello");
      const second = context.consume();
      expect(second.lexeme).toBe("world");
      expect(context.isAtEnd).toBe(true);
    });
  });

  describe("expect", () => {
    test("consumes matching token and returns GreenToken", () => {
      const context = makeContext([ident1, ident2, eof]);
      const token = context.expect(SyntaxKind.IdentifierToken);
      expect(token.lexeme).toBe("hello");
      expect(token.isMissing).toBe(false);
      expect(context.peek(0).lexeme).toBe("world");
      expect(context.draftDiagnostics()).toHaveLength(0);
    });

    test("returns missing token and emits diagnostic when kinds mismatch", () => {
      const context = makeContext([ident1, ident2, eof]);
      const token = context.expect(SyntaxKind.IntegerLiteralToken);
      expect(token.isMissing).toBe(true);
      expect(token.kind).toBe(SyntaxKind.IntegerLiteralToken);
      expect(context.draftDiagnostics()).toHaveLength(1);
    });

    test("diagnostic is zero-width at current token start", () => {
      const context = makeContext([ident1, ident2, eof]);
      context.expect(SyntaxKind.IntegerLiteralToken);
      const diagnostic = context.draftDiagnostics()[0]!;
      expect(diagnostic.absoluteStart).toBe(0);
      expect(diagnostic.absoluteEnd).toBe(0);
    });

    test("diagnostic after consumed token is zero-width at current token start", () => {
      const context = makeContext([ident1, ident2, eof]);
      context.consume();
      context.expect(SyntaxKind.IntegerLiteralToken);
      const diagnostic = context.draftDiagnostics()[0]!;
      expect(diagnostic.absoluteStart).toBe(6);
      expect(diagnostic.absoluteEnd).toBe(6);
    });

    test("diagnostic has PARSE_EXPECTED_TOKEN code", () => {
      const context = makeContext([ident1, ident2, eof]);
      context.expect(SyntaxKind.StringLiteralToken);
      const diagnostic = context.draftDiagnostics()[0]!;
      expect(diagnostic.code).toBe("PARSE_EXPECTED_TOKEN");
    });

    test("does not consume a token when kinds mismatch", () => {
      const context = makeContext([ident1, ident2, eof]);
      context.expect(SyntaxKind.IntegerLiteralToken);
      expect(context.peek(0).lexeme).toBe("hello");
    });
  });

  describe("isAtEnd", () => {
    test("returns true when at EOF", () => {
      const context = makeContext([eof]);
      expect(context.isAtEnd).toBe(true);
    });

    test("returns false when there are more tokens", () => {
      const context = makeContext([ident1, eof]);
      expect(context.isAtEnd).toBe(false);
    });

    test("returns true after consuming all tokens", () => {
      const context = makeContext([ident1, ident2, eof]);
      context.consume();
      context.consume();
      expect(context.isAtEnd).toBe(true);
    });
  });

  describe("offset", () => {
    test("returns the start of the current token", () => {
      const context = makeContext([ident1, ident2, eof]);
      expect(context.offset).toBe(0);
    });

    test("updates as position changes", () => {
      const context = makeContext([ident1, ident2, eof]);
      context.consume();
      expect(context.offset).toBe(6);
    });
  });

  describe("mark", () => {
    test("returns current offset and diagnostic count", () => {
      const context = makeContext([ident1, ident2, eof]);
      const mark = context.mark();
      expect(mark.offset).toBe(0);
      expect(mark.diagnosticStartIndex).toBe(0);
    });

    test("diagnosticStartIndex reflects added diagnostics", () => {
      const context = makeContext([ident1, ident2, eof]);
      context.expect(SyntaxKind.IntegerLiteralToken);
      const mark = context.mark();
      expect(mark.diagnosticStartIndex).toBe(1);
    });
  });

  describe("draftDiagnostics", () => {
    test("returns empty array initially", () => {
      const context = makeContext([eof]);
      expect(context.draftDiagnostics()).toHaveLength(0);
    });

    test("reflects reported diagnostics", () => {
      const context = makeContext([ident1, eof]);
      context.reportAtCurrent("PARSE_UNEXPECTED_TOKEN", "Unexpected token.");
      expect(context.draftDiagnostics()).toHaveLength(1);
      expect(context.draftDiagnostics()[0]!.code).toBe("PARSE_UNEXPECTED_TOKEN");
    });
  });

  describe("reportAtCurrent", () => {
    test("creates zero-width diagnostic at current offset", () => {
      const context = makeContext([ident1, eof]);
      context.reportAtCurrent("PARSE_UNEXPECTED_TOKEN", "Unexpected token.");
      const diagnostic = context.draftDiagnostics()[0]!;
      expect(diagnostic.absoluteStart).toBe(0);
      expect(diagnostic.absoluteEnd).toBe(0);
    });
  });

  describe("reportSpan", () => {
    test("creates diagnostic with given span", () => {
      const context = makeContext([ident1, eof]);
      context.reportSpan("PARSE_UNTERMINATED_BLOCK", "Unterminated block.", 0, 5);
      const diagnostic = context.draftDiagnostics()[0]!;
      expect(diagnostic.absoluteStart).toBe(0);
      expect(diagnostic.absoluteEnd).toBe(5);
    });
  });

  describe("skipUntil", () => {
    test("collects skipped tokens and makes progress", () => {
      const context = makeContext([ident1, ident2, eof]);
      const syncSet = new Set([SyntaxKind.EndOfFileToken]);
      const skipped = context.skipUntil(syncSet);
      expect(skipped).toHaveLength(2);
      expect(skipped[0]!.lexeme).toBe("hello");
      expect(skipped[1]!.lexeme).toBe("world");
      expect(context.isAtEnd).toBe(true);
    });

    test("reports diagnostic when tokens are skipped", () => {
      const context = makeContext([ident1, ident2, eof]);
      const syncSet = new Set([SyntaxKind.EndOfFileToken]);
      context.skipUntil(syncSet);
      const diagnostic = context.draftDiagnostics()[0]!;
      expect(diagnostic.code).toBe("PARSE_RECOVERY_SKIPPED_TOKENS");
    });

    test("does not report diagnostic when no tokens skipped", () => {
      const context = makeContext([ident1, eof]);
      const syncSet = new Set([SyntaxKind.IdentifierToken]);
      context.skipUntil(syncSet);
      expect(context.draftDiagnostics()).toHaveLength(0);
    });

    test("skipped range covers all consumed tokens", () => {
      const context = makeContext([ident1, ident2, eof]);
      const syncSet = new Set([SyntaxKind.EndOfFileToken]);
      context.skipUntil(syncSet);
      const diagnostic = context.draftDiagnostics()[0]!;
      expect(diagnostic.absoluteStart).toBe(0);
      expect(diagnostic.absoluteEnd).toBe(11);
    });

    test("returns empty when already at EOF", () => {
      const context = makeContext([eof]);
      const syncSet = new Set([SyntaxKind.EndOfFileToken]);
      const skipped = context.skipUntil(syncSet);
      expect(skipped).toHaveLength(0);
      expect(context.draftDiagnostics()).toHaveLength(0);
    });

    test("makes progress by consuming at least one token", () => {
      const context = makeContext([ident1, eof]);
      const syncSet = new Set([SyntaxKind.EndOfFileToken]);
      context.skipUntil(syncSet);
      expect(context.isAtEnd).toBe(true);
    });
  });

  describe("recursion depth", () => {
    test("enterRecursion returns true when under limit", () => {
      const context = makeContext([eof]);
      expect(context.enterRecursion()).toBe(true);
    });

    test("exitRecursion decrements depth", () => {
      const context = makeContext([eof]);
      context.enterRecursion();
      context.exitRecursion();
      expect(context.enterRecursion()).toBe(true);
    });

    test("enterRecursion returns false at limit", () => {
      const maxDepth = 3;
      const limitedCtx = new ParserContext({
        tokens: TokenStream.from([eof]),
        factory: new SyntaxFactory(),
        maxDepth,
      });
      for (let idx = 0; idx < maxDepth; idx++) {
        expect(limitedCtx.enterRecursion()).toBe(true);
      }
      expect(limitedCtx.enterRecursion()).toBe(false);
    });

    test("emits PARSE_NESTING_LIMIT_EXCEEDED diagnostic when limit reached", () => {
      const context = new ParserContext({
        tokens: TokenStream.from([ident1, eof]),
        factory: new SyntaxFactory(),
        maxDepth: 1,
      });
      context.enterRecursion();
      context.enterRecursion();
      const diagnostics = context.draftDiagnostics();
      const nestingDiag = diagnostics.find(
        (diagnostic) => diagnostic.code === "PARSE_NESTING_LIMIT_EXCEEDED",
      );
      expect(nestingDiag).toBeDefined();
      expect(nestingDiag!.absoluteStart).toBe(0);
      expect(nestingDiag!.absoluteEnd).toBe(0);
    });

    test("depth limit with maxDepth default", () => {
      const depthCtx = makeContext([eof]);
      const maxDefault = 256;
      for (let idx = 0; idx < maxDefault; idx++) {
        expect(depthCtx.enterRecursion()).toBe(true);
      }
      expect(depthCtx.enterRecursion()).toBe(false);
    });
  });

  describe("factory access", () => {
    test("provides access to SyntaxFactory", () => {
      const context = makeContext([eof]);
      expect(context.factory).toBeInstanceOf(SyntaxFactory);
    });

    test("factory can create tokens and nodes", () => {
      const context = makeContext([eof]);
      const token = context.factory.missingToken(SyntaxKind.IdentifierToken);
      expect(token.isMissing).toBe(true);
      expect(token.kind).toBe(SyntaxKind.IdentifierToken);
    });
  });

  describe("currentSyntaxKind", () => {
    test("returns SyntaxKind matching current token", () => {
      const context = makeContext([ident1, eof]);
      expect(context.currentSyntaxKind()).toBe(SyntaxKind.IdentifierToken);
    });

    test("returns EndOfFileToken at EOF", () => {
      const context = makeContext([eof]);
      expect(context.currentSyntaxKind()).toBe(SyntaxKind.EndOfFileToken);
    });
  });

  describe("nodeFromMark compatibility", () => {
    test("ParserMark shape matches syntax-factory ParserMark", () => {
      const context = makeContext([ident1, eof]);
      const mark: ParserMark = context.mark();
      expect(mark).toHaveProperty("offset");
      expect(mark).toHaveProperty("diagnosticStartIndex");
    });

    test("ParserContext satisfies context shape for nodeFromMark", () => {
      const context = makeContext([ident1, ident2, eof]);
      const mark = context.mark();
      const first = context.consume();
      const second = context.consume();
      const node = nodeFromMark({
        factory: context.factory,
        context,
        mark,
        kind: SyntaxKind.SourceFile,
        children: [first, second],
      });
      expect(node.kind).toBe(SyntaxKind.SourceFile);
      expect(node.width).toBe(10);
    });
  });
});
