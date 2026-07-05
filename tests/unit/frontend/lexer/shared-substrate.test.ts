import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/shared/diagnostics";
import { SourceSpan } from "../../../../src/shared/source-span";
import { SourceText } from "../../../../src/shared/source-text";

describe("shared compiler substrate", () => {
  test("exposes source text and diagnostic collection outside the lexer module", () => {
    const source = SourceText.from("shared.wr", "abc\n");
    const diagnostics = new CollectingDiagnosticSink();

    diagnostics.report({
      code: "TEST_DIAGNOSTIC",
      severity: "warning",
      message: "shared diagnostic",
      source,
      span: SourceSpan.from(0, 3),
      ownerKey: "test:shared-substrate",
      stableDetail: "TEST_DIAGNOSTIC:shared.wr:0:3",
    });

    expect(source.positionAt(4)).toEqual({ offset: 4, line: 2, column: 1 });
    expect(diagnostics.diagnostics).toHaveLength(1);
    expect(diagnostics.diagnostics[0]!.code).toBe("TEST_DIAGNOSTIC");
  });
});
