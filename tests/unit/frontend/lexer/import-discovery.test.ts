import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { ImportDiscovery } from "../../../../src/frontend/lexer/import-discovery";
import { ModulePath } from "../../../../src/frontend/lexer/module-path";
import { SourceSpan } from "../../../../src/frontend/lexer/source-span";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { Token } from "../../../../src/frontend/lexer/token";
import { TokenKind } from "../../../../src/frontend/lexer/token-kind";
import { TokenStream } from "../../../../src/frontend/lexer/token-stream";

function token(kind: TokenKind, lexeme: string, start: number, end: number): Token {
  return new Token({
    kind,
    lexeme,
    span: SourceSpan.from(start, end),
    leadingTrivia: [],
    trailingTrivia: [],
  });
}

describe("ImportDiscovery", () => {
  test("discovers use-from module names from public tokens", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use BootError, Machine from core.boot\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "BootError", 4, 13),
      token(TokenKind.Comma, ",", 13, 14),
      token(TokenKind.Identifier, "Machine", 15, 22),
      token(TokenKind.From, "from", 23, 27),
      token(TokenKind.Identifier, "core", 28, 32),
      token(TokenKind.Dot, ".", 32, 33),
      token(TokenKind.Identifier, "boot", 33, 37),
      token(TokenKind.Newline, "\n", 37, 38),
      token(TokenKind.Eof, "", 38, 38),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports.map((request) => request.moduleName)).toEqual(["core.boot"]);
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("single import", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use Foo from bar.baz\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "Foo", 4, 7),
      token(TokenKind.From, "from", 8, 12),
      token(TokenKind.Identifier, "bar", 13, 16),
      token(TokenKind.Dot, ".", 16, 17),
      token(TokenKind.Identifier, "baz", 17, 20),
      token(TokenKind.Newline, "\n", 20, 21),
      token(TokenKind.Eof, "", 21, 21),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(1);
    expect(imports[0]!.moduleName).toBe("bar.baz");
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("multiple comma-separated names", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use A, B, C from module.name\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "A", 4, 5),
      token(TokenKind.Comma, ",", 5, 6),
      token(TokenKind.Identifier, "B", 7, 8),
      token(TokenKind.Comma, ",", 8, 9),
      token(TokenKind.Identifier, "C", 10, 11),
      token(TokenKind.From, "from", 12, 16),
      token(TokenKind.Identifier, "module", 17, 23),
      token(TokenKind.Dot, ".", 23, 24),
      token(TokenKind.Identifier, "name", 24, 28),
      token(TokenKind.Newline, "\n", 28, 29),
      token(TokenKind.Eof, "", 29, 29),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(1);
    expect(imports[0]!.moduleName).toBe("module.name");
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("dotted module names", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use Foo from a.b.c\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "Foo", 4, 7),
      token(TokenKind.From, "from", 8, 12),
      token(TokenKind.Identifier, "a", 13, 14),
      token(TokenKind.Dot, ".", 14, 15),
      token(TokenKind.Identifier, "b", 15, 16),
      token(TokenKind.Dot, ".", 16, 17),
      token(TokenKind.Identifier, "c", 17, 18),
      token(TokenKind.Newline, "\n", 18, 19),
      token(TokenKind.Eof, "", 19, 19),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(1);
    expect(imports[0]!.moduleName).toBe("a.b.c");
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("malformed: use Bad from missing module name", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use Bad from\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "Bad", 4, 7),
      token(TokenKind.From, "from", 8, 12),
      token(TokenKind.Newline, "\n", 12, 13),
      token(TokenKind.Eof, "", 13, 13),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(0);
    expect(diagnostics.diagnostics).toHaveLength(1);
    expect(diagnostics.diagnostics[0]!.code).toBe("LEX_IMPORT_MALFORMED");
  });

  test("malformed: use alone on a line", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Newline, "\n", 3, 4),
      token(TokenKind.Eof, "", 4, 4),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(0);
    expect(diagnostics.diagnostics).toHaveLength(1);
    expect(diagnostics.diagnostics[0]!.code).toBe("LEX_IMPORT_MALFORMED");
  });

  test("malformed: use at end of file", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Eof, "", 3, 3),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(0);
    expect(diagnostics.diagnostics).toHaveLength(1);
    expect(diagnostics.diagnostics[0]!.code).toBe("LEX_IMPORT_MALFORMED");
  });

  test("recovery: malformed import followed by valid import on next line", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use Bad from\nuse Good from ok.module\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "Bad", 4, 7),
      token(TokenKind.From, "from", 8, 12),
      token(TokenKind.Newline, "\n", 12, 13),
      token(TokenKind.Use, "use", 13, 16),
      token(TokenKind.Identifier, "Good", 17, 21),
      token(TokenKind.From, "from", 22, 26),
      token(TokenKind.Identifier, "ok", 27, 29),
      token(TokenKind.Dot, ".", 29, 30),
      token(TokenKind.Identifier, "module", 30, 36),
      token(TokenKind.Newline, "\n", 36, 37),
      token(TokenKind.Eof, "", 37, 37),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(1);
    expect(imports[0]!.moduleName).toBe("ok.module");
    expect(diagnostics.diagnostics).toHaveLength(1);
    expect(diagnostics.diagnostics[0]!.code).toBe("LEX_IMPORT_MALFORMED");
  });

  test("no use statements returns empty array", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "let x = 5\n");
    const tokens = TokenStream.from([
      token(TokenKind.Let, "let", 0, 3),
      token(TokenKind.Identifier, "x", 4, 5),
      token(TokenKind.Equals, "=", 6, 7),
      token(TokenKind.IntegerLiteral, "5", 8, 9),
      token(TokenKind.Newline, "\n", 9, 10),
      token(TokenKind.Eof, "", 10, 10),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(0);
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("non-use content is skipped", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "let x = 5\nuse Foo from bar.baz\nreturn x\n");
    const tokens = TokenStream.from([
      token(TokenKind.Let, "let", 0, 3),
      token(TokenKind.Identifier, "x", 4, 5),
      token(TokenKind.Equals, "=", 6, 7),
      token(TokenKind.IntegerLiteral, "5", 8, 9),
      token(TokenKind.Newline, "\n", 9, 10),
      token(TokenKind.Use, "use", 10, 13),
      token(TokenKind.Identifier, "Foo", 14, 17),
      token(TokenKind.From, "from", 18, 22),
      token(TokenKind.Identifier, "bar", 23, 26),
      token(TokenKind.Dot, ".", 26, 27),
      token(TokenKind.Identifier, "baz", 27, 30),
      token(TokenKind.Newline, "\n", 30, 31),
      token(TokenKind.Return, "return", 31, 37),
      token(TokenKind.Identifier, "x", 38, 39),
      token(TokenKind.Newline, "\n", 39, 40),
      token(TokenKind.Eof, "", 40, 40),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(1);
    expect(imports[0]!.moduleName).toBe("bar.baz");
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("discovers keyword tokens as module name parts", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use UefiFirmware from core.uefi\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "UefiFirmware", 4, 16),
      token(TokenKind.From, "from", 17, 21),
      token(TokenKind.Identifier, "core", 22, 26),
      token(TokenKind.Dot, ".", 26, 27),
      token(TokenKind.Uefi, "uefi", 27, 31),
      token(TokenKind.Newline, "\n", 31, 32),
      token(TokenKind.Eof, "", 32, 32),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports.map((request) => request.moduleName)).toEqual(["core.uefi"]);
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("module specifier span covers only module name", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use Foo from bar.baz\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "Foo", 4, 7),
      token(TokenKind.From, "from", 8, 12),
      token(TokenKind.Identifier, "bar", 13, 16),
      token(TokenKind.Dot, ".", 16, 17),
      token(TokenKind.Identifier, "baz", 17, 20),
      token(TokenKind.Newline, "\n", 20, 21),
      token(TokenKind.Eof, "", 21, 21),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(1);
    expect(source.slice(imports[0]!.span)).toBe("bar.baz");
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("malformed: trailing comma before from reports diagnostic", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use A, from core.good\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "A", 4, 5),
      token(TokenKind.Comma, ",", 5, 6),
      token(TokenKind.From, "from", 7, 11),
      token(TokenKind.Identifier, "core", 12, 16),
      token(TokenKind.Dot, ".", 16, 17),
      token(TokenKind.Identifier, "good", 17, 21),
      token(TokenKind.Newline, "\n", 21, 22),
      token(TokenKind.Eof, "", 22, 22),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(0);
    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "LEX_IMPORT_MALFORMED",
    );
  });

  test("malformed: trailing dot in module name", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use Foo from core.\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "Foo", 4, 7),
      token(TokenKind.From, "from", 8, 12),
      token(TokenKind.Identifier, "core", 13, 17),
      token(TokenKind.Dot, ".", 17, 18),
      token(TokenKind.Newline, "\n", 18, 19),
      token(TokenKind.Eof, "", 19, 19),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(0);
    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "LEX_IMPORT_MALFORMED",
    );
  });

  test("malformed: extra tokens after module name", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from("app/main.wr", "use Foo from core extra\n");
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "Foo", 4, 7),
      token(TokenKind.From, "from", 8, 12),
      token(TokenKind.Identifier, "core", 13, 17),
      token(TokenKind.Identifier, "extra", 18, 23),
      token(TokenKind.Newline, "\n", 23, 24),
      token(TokenKind.Eof, "", 24, 24),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports).toHaveLength(0);
    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "LEX_IMPORT_MALFORMED",
    );
  });
});
