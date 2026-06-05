import { describe, expect, test } from "bun:test";
import type { LexDiagnostic } from "../../../../src/frontend/lexer/diagnostics";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import type { Diagnostic } from "../../../../src/shared/diagnostics";
import {
  combineDiagnostics,
  type ParseDiagnostic,
  type ParseDiagnosticCode,
} from "../../../../src/frontend/parser/parser-diagnostics";
import type {
  ParseLexResultInput,
  ParseInput,
  ParseResult,
} from "../../../../src/frontend/parser/parser";

describe("ParseDiagnosticCode", () => {
  const allCodes: ParseDiagnosticCode[] = [
    "PARSE_EXPECTED_TOKEN",
    "PARSE_EXPECTED_DECLARATION",
    "PARSE_EXPECTED_EXPRESSION",
    "PARSE_UNEXPECTED_TOKEN",
    "PARSE_UNTERMINATED_BLOCK",
    "PARSE_RECOVERY_SKIPPED_TOKENS",
    "PARSE_NESTING_LIMIT_EXCEEDED",
  ];

  test("all codes have PARSE_ prefix", () => {
    for (const code of allCodes) {
      expect(code.startsWith("PARSE_")).toBe(true);
    }
  });

  test("every code appears exactly once", () => {
    expect(new Set(allCodes).size).toBe(allCodes.length);
  });
});

describe("ParseDiagnostic type", () => {
  test("ParseDiagnostic is assignable to Diagnostic", () => {
    const source = SourceText.from("test.wr", "x");
    const sourceDiagnostic: ParseDiagnostic = {
      code: "PARSE_EXPECTED_TOKEN" as ParseDiagnosticCode,
      severity: "error",
      message: "Expected token.",
      source,
      span: source.span(0, 1),
    };
    const base: Diagnostic = sourceDiagnostic;
    expect(base.code).toBe("PARSE_EXPECTED_TOKEN");
  });
});

describe("ParseResult type shape", () => {
  test("ParseResult fields are well-typed", () => {
    const source = SourceText.from("test.wr", "x");
    const result: ParseResult = {
      source,
      tree: null as unknown as ParseResult["tree"],
      parserDiagnostics: [],
      diagnostics: [],
    };
    expect(result.source).toBe(source);
    expect(result.parserDiagnostics).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);

    const parserDiagnostics: readonly ParseDiagnostic[] = result.parserDiagnostics;
    expect(parserDiagnostics).toHaveLength(0);
  });

  test("ParseInput accepts optional lexerDiagnostics", () => {
    const source = SourceText.from("test.wr", "x");
    const input: ParseInput = {
      source,
      tokens: null as unknown as ParseInput["tokens"],
    };
    expect(input.lexerDiagnostics).toBeUndefined();
  });

  test("ParseLexResultInput accepts optional lexerDiagnostics", () => {
    const input: ParseLexResultInput = {
      lexResult: null as unknown as ParseLexResultInput["lexResult"],
    };
    expect(input.lexerDiagnostics).toBeUndefined();
  });
});

describe("combineDiagnostics", () => {
  const source = SourceText.from("test.wr", "aaaa");

  function lexDiag(code: string, start: number, end: number): LexDiagnostic {
    return {
      code: code as LexDiagnostic["code"],
      severity: "error",
      message: `lex: ${code}`,
      source,
      span: source.span(start, end),
    };
  }

  function parseDiag(code: ParseDiagnosticCode, start: number, end: number): ParseDiagnostic {
    return {
      code,
      severity: "error",
      message: `parse: ${code}`,
      source,
      span: source.span(start, end),
    };
  }

  test("returns empty array for no diagnostics", () => {
    const result = combineDiagnostics([], []);
    expect(result).toHaveLength(0);
  });

  test("includes only parser diagnostics", () => {
    const parserDiags = [
      parseDiag("PARSE_EXPECTED_TOKEN", 0, 1),
      parseDiag("PARSE_UNEXPECTED_TOKEN", 2, 3),
    ];
    const result = combineDiagnostics([], parserDiags);
    expect(result).toHaveLength(2);
    expect(result[0]?.code).toBe("PARSE_EXPECTED_TOKEN");
    expect(result[1]?.code).toBe("PARSE_UNEXPECTED_TOKEN");
  });

  test("includes only lexer diagnostics", () => {
    const lexerDiags = [
      lexDiag("LEX_INVALID_CHARACTER", 0, 1),
      lexDiag("LEX_UNTERMINATED_STRING", 2, 4),
    ];
    const result = combineDiagnostics(lexerDiags, []);
    expect(result).toHaveLength(2);
    expect(result[0]?.code).toBe("LEX_INVALID_CHARACTER");
    expect(result[1]?.code).toBe("LEX_UNTERMINATED_STRING");
  });

  test("preserves code prefixes in combined diagnostics", () => {
    const lexerDiags = [lexDiag("LEX_INVALID_CHARACTER", 0, 1)];
    const parserDiags = [parseDiag("PARSE_EXPECTED_TOKEN", 2, 3)];
    const result = combineDiagnostics(lexerDiags, parserDiags);
    expect(result[0]?.code).toBe("LEX_INVALID_CHARACTER");
    expect(result[1]?.code).toBe("PARSE_EXPECTED_TOKEN");
  });

  test("sorts by span start, then span end, then code", () => {
    const lexerDiags = [
      lexDiag("LEX_INVALID_CHARACTER", 3, 4),
      lexDiag("LEX_UNTERMINATED_STRING", 0, 5),
    ];
    const parserDiags = [
      parseDiag("PARSE_EXPECTED_TOKEN", 3, 4),
      parseDiag("PARSE_EXPECTED_DECLARATION", 1, 2),
    ];
    const result = combineDiagnostics(lexerDiags, parserDiags);
    expect(result).toHaveLength(4);
    expect(result[0]?.code).toBe("LEX_UNTERMINATED_STRING");
    expect(result[0]?.span.start).toBe(0);
    expect(result[1]?.code).toBe("PARSE_EXPECTED_DECLARATION");
    expect(result[1]?.span.start).toBe(1);
    expect(result[2]?.code).toBe("LEX_INVALID_CHARACTER");
    expect(result[2]?.span.start).toBe(3);
    expect(result[3]?.code).toBe("PARSE_EXPECTED_TOKEN");
    expect(result[3]?.span.start).toBe(3);
  });

  test("sorts by span end within same start position", () => {
    const sourceDiagnostics = [
      parseDiag("PARSE_EXPECTED_TOKEN", 0, 5),
      parseDiag("PARSE_EXPECTED_DECLARATION", 0, 3),
    ];
    const result = combineDiagnostics([], sourceDiagnostics);
    expect(result[0]?.code).toBe("PARSE_EXPECTED_DECLARATION");
    expect(result[0]?.span.end).toBe(3);
    expect(result[1]?.code).toBe("PARSE_EXPECTED_TOKEN");
    expect(result[1]?.span.end).toBe(5);
  });

  test("sorts by code when start and end match", () => {
    const sourceDiagnostics = [
      parseDiag("PARSE_UNEXPECTED_TOKEN", 0, 3),
      parseDiag("PARSE_EXPECTED_TOKEN", 0, 3),
    ];
    const result = combineDiagnostics([], sourceDiagnostics);
    expect(result[0]?.code).toBe("PARSE_EXPECTED_TOKEN");
    expect(result[1]?.code).toBe("PARSE_UNEXPECTED_TOKEN");
  });

  test("mixes lexer and parser diagnostics at same position sorted by code", () => {
    const lexerDiags = [lexDiag("LEX_INVALID_CHARACTER", 2, 4)];
    const parserDiags = [parseDiag("PARSE_EXPECTED_EXPRESSION", 2, 4)];
    const result = combineDiagnostics(lexerDiags, parserDiags);
    expect(result).toHaveLength(2);
    expect(result[0]?.code).toBe("LEX_INVALID_CHARACTER");
    expect(result[0]?.span.start).toBe(2);
    expect(result[0]?.span.end).toBe(4);
    expect(result[1]?.code).toBe("PARSE_EXPECTED_EXPRESSION");
    expect(result[1]?.span.start).toBe(2);
    expect(result[1]?.span.end).toBe(4);
  });

  test("does not mutate input arrays", () => {
    const lexerDiags = Object.freeze([lexDiag("LEX_INVALID_CHARACTER", 0, 1)]);
    const parserDiags = Object.freeze([parseDiag("PARSE_EXPECTED_TOKEN", 0, 1)]);
    const result = combineDiagnostics(lexerDiags, parserDiags);
    expect(result).toHaveLength(2);
  });
});
