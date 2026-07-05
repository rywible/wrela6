import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  SourceText,
} from "../../../../src/frontend/lexer";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { parseWrIntegerLiteral } from "../../../../src/shared/integer-literal";

function lexInteger(sourceText: string) {
  const source = SourceText.from("integer.wr", sourceText);
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const result = lexer.lex(source);
  return { diagnostics, result };
}

describe("parseWrIntegerLiteral", () => {
  test("parses decimal separators and base prefixes canonically", () => {
    expect(parseWrIntegerLiteral("1_000_000")).toBe(1_000_000n);
    expect(parseWrIntegerLiteral("0x1F")).toBe(31n);
    expect(parseWrIntegerLiteral("0b1010_0101")).toBe(165n);
  });

  test("rejects malformed literals", () => {
    expect(parseWrIntegerLiteral("1__0")).toBeUndefined();
    expect(parseWrIntegerLiteral("0x")).toBeUndefined();
    expect(parseWrIntegerLiteral("0b102")).toBeUndefined();
    expect(parseWrIntegerLiteral("1_")).toBeUndefined();
  });
});

describe("Lexer integer literals", () => {
  test("preserves raw reconstruction for valid integer forms", () => {
    const source = "1_000 0x1F 0b1010_0101";
    const { diagnostics, result } = lexInteger(source);

    expect(diagnostics.diagnostics).toEqual([]);
    expect(result.tokens.reconstruct()).toBe(source);
    expect(
      result.tokens.items
        .filter((token) => token.kind === TokenKind.IntegerLiteral)
        .map((token) => token.lexeme),
    ).toEqual(["1_000", "0x1F", "0b1010_0101"]);
  });

  test("reports LEX_MALFORMED_INTEGER for malformed integer forms", () => {
    const { diagnostics, result } = lexInteger("1__0 0x 0b102");

    expect(result.tokens.reconstruct()).toBe("1__0 0x 0b102");
    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "LEX_MALFORMED_INTEGER",
      "LEX_MALFORMED_INTEGER",
      "LEX_MALFORMED_INTEGER",
    ]);
    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.ownerKey)).toEqual([
      "lexer:integer",
      "lexer:integer",
      "lexer:integer",
    ]);
    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "LEX_MALFORMED_INTEGER:integer.wr:0:4",
      "LEX_MALFORMED_INTEGER:integer.wr:5:7",
      "LEX_MALFORMED_INTEGER:integer.wr:8:13",
    ]);
  });
});
