import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink, type LexDiagnostic } from "../../src/lexer/diagnostics";
import { SourceText } from "../../src/lexer/source-text";

describe("CollectingDiagnosticSink", () => {
  test("captures diagnostics in report order", () => {
    const source = SourceText.from("bad.wr", "@");
    const diagnostics = new CollectingDiagnosticSink();

    diagnostics.report({
      code: "LEX_INVALID_CHARACTER",
      severity: "error",
      message: "Invalid character '@'.",
      source,
      span: source.span(0, 1),
    });

    expect(diagnostics.diagnostics).toHaveLength(1);
    expect(diagnostics.diagnostics[0]?.code).toBe("LEX_INVALID_CHARACTER");
    expect(diagnostics.diagnostics[0]?.span.start).toBe(0);
  });

  test("starts with no diagnostics", () => {
    const diagnostics = new CollectingDiagnosticSink();
    expect(diagnostics.diagnostics).toHaveLength(0);
  });

  test("preserves insertion order across multiple reports", () => {
    const source = SourceText.from("multi.wr", "@\n'unterminated");
    const diagnostics = new CollectingDiagnosticSink();

    diagnostics.report({
      code: "LEX_INVALID_CHARACTER",
      severity: "error",
      message: "Invalid character '@'.",
      source,
      span: source.span(0, 1),
    });

    diagnostics.report({
      code: "LEX_UNTERMINATED_STRING",
      severity: "error",
      message: "Unterminated string literal.",
      source,
      span: source.span(2, 14),
    });

    expect(diagnostics.diagnostics).toHaveLength(2);
    expect(diagnostics.diagnostics[0]?.code).toBe("LEX_INVALID_CHARACTER");
    expect(diagnostics.diagnostics[1]?.code).toBe("LEX_UNTERMINATED_STRING");
  });

  test("exposes diagnostics as readonly", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const result: readonly LexDiagnostic[] = diagnostics.diagnostics;
    expect(result).toHaveLength(0);
  });
});
