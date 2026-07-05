import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";

function lexText(text: string) {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const result = lexer.lex(SourceText.from("string.wr", text));
  return { diagnostics, result };
}

describe("string literal lexing", () => {
  test("stores cooked values while preserving raw reconstruction", () => {
    const source = String.raw`"\\" "\"" "\n" "\r" "\t" "\0" "\x41" "\u{1F600}"`;

    const { diagnostics, result } = lexText(source);
    const strings = result.tokens.items.filter((token) => token.kind === TokenKind.StringLiteral);

    expect(strings.map((token) => token.cookedValue)).toEqual([
      "\\",
      '"',
      "\n",
      "\r",
      "\t",
      "\0",
      "A",
      "😀",
    ]);
    expect(result.tokens.reconstruct()).toBe(source);
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("reports one invalid escape and substitutes replacement character", () => {
    const { diagnostics, result } = lexText(String.raw`"bad\q"`);
    const stringToken = result.tokens.items.find((token) => token.kind === TokenKind.StringLiteral);

    expect(stringToken?.cookedValue).toBe("bad\uFFFD");
    expect(result.tokens.reconstruct()).toBe(String.raw`"bad\q"`);
    expect(diagnostics.diagnostics).toHaveLength(1);
    expect(diagnostics.diagnostics[0]?.code).toBe("LEX_INVALID_ESCAPE");
    expect(diagnostics.diagnostics[0]?.source.slice(diagnostics.diagnostics[0]!.span)).toBe(
      String.raw`\q`,
    );
    expect(diagnostics.diagnostics[0]?.ownerKey).toBe("lexer:string:escape");
    expect(diagnostics.diagnostics[0]?.stableDetail).toBe("LEX_INVALID_ESCAPE:string.wr:4:6");
  });

  test("short hex escape before closing quote does not consume the terminator", () => {
    const source = String.raw`"bad\x"`;
    const { diagnostics, result } = lexText(source);
    const stringToken = result.tokens.items.find((token) => token.kind === TokenKind.StringLiteral);

    expect(stringToken?.cookedValue).toBe("bad\uFFFD");
    expect(result.tokens.kinds()).toEqual([TokenKind.StringLiteral, TokenKind.Eof]);
    expect(result.tokens.reconstruct()).toBe(source);
    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "LEX_INVALID_ESCAPE",
    ]);
    expect(diagnostics.diagnostics[0]?.source.slice(diagnostics.diagnostics[0]!.span)).toBe(
      String.raw`\x`,
    );
  });

  test("reports one unterminated string for trailing backslash at eof", () => {
    const source = '"abc\\';
    const { diagnostics, result } = lexText(source);

    expect(result.tokens.kinds()).toEqual([TokenKind.StringLiteral, TokenKind.Eof]);
    expect(result.tokens.reconstruct()).toBe(source);
    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "LEX_UNTERMINATED_STRING",
    ]);
  });
});
