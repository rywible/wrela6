import { expect, test } from "bun:test";
import { parseModuleGraph } from "../../../../src/frontend/module-graph-parser";
import {
  Lexer,
  SourceText,
  CollectingDiagnosticSink,
  KeywordTable,
  SourceSpan,
} from "../../../../src/frontend/lexer";
import type { LexDiagnostic } from "../../../../src/frontend/lexer/diagnostics";
import { ModulePath } from "../../../../src/frontend/lexer/module-path";

test("module graph parser parses all modules", () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });

  const source1 = SourceText.from("main.wr", "use logger from core.log\nuefi image Main:\n");
  const lexResult1 = lexer.lex(source1);

  const source2 = SourceText.from("core/log.wr", "uefi image Logger:\n");
  const lexResult2 = lexer.lex(source2);

  const graph = {
    entry: ModulePath.from("main.wr"),
    modules: [
      {
        path: ModulePath.from("main.wr"),
        source: source1,
        tokens: lexResult1.tokens,
        imports: [],
      },
      {
        path: ModulePath.from("core/log.wr"),
        source: source2,
        tokens: lexResult2.tokens,
        imports: [],
      },
    ],
  };

  const result = parseModuleGraph({
    graph,
    lexerDiagnostics: diagnostics.diagnostics,
  });

  expect(result.entry.key).toBe("main.wr");
  expect(result.modules.length).toBe(2);
  expect(result.modules[0]!.path.key).toBe("main.wr");
  expect(result.modules[1]!.path.key).toBe("core/log.wr");
  expect(result.modules[0]!.tree.reconstruct()).toBe(source1.text);
  expect(result.modules[1]!.tree.reconstruct()).toBe(source2.text);
  expect(result.diagnostics.length).toBe(0);
});

test("lexer diagnostics are not duplicated across modules", () => {
  const lexerDiagnostics: LexDiagnostic[] = [
    {
      code: "LEX_INVALID_CHARACTER",
      severity: "error",
      message: "Invalid character.",
      source: SourceText.from("test.wr", ""),
      span: SourceSpan.from(0, 1),
    },
  ];

  const lexer = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });

  const source1 = SourceText.from("a.wr", "x\n");
  const lexResult1 = lexer.lex(source1);

  const source2 = SourceText.from("b.wr", "y\n");
  const lexResult2 = lexer.lex(source2);

  const graph = {
    entry: ModulePath.from("a.wr"),
    modules: [
      {
        path: ModulePath.from("a.wr"),
        source: source1,
        tokens: lexResult1.tokens,
        imports: [],
      },
      {
        path: ModulePath.from("b.wr"),
        source: source2,
        tokens: lexResult2.tokens,
        imports: [],
      },
    ],
  };

  const result = parseModuleGraph({ graph, lexerDiagnostics });

  const lexInvalidCodes = result.diagnostics.filter(
    (diagnostic) => diagnostic.code === "LEX_INVALID_CHARACTER",
  );
  expect(lexInvalidCodes.length).toBe(1);
});
