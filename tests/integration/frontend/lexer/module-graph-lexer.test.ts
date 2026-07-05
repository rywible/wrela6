import { describe, expect, test } from "bun:test";
import { FakeFileRepository } from "../../../support/frontend/lexer-fakes";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { DottedModuleResolver } from "../../../../src/frontend/lexer/module-resolver";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { ModuleGraphLexer } from "../../../../src/frontend/lexer/module-graph-lexer";
import { ModulePath } from "../../../../src/frontend/lexer/module-path";

describe("ModuleGraphLexer", () => {
  test("lexes an image entry and reachable imports", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const files = new FakeFileRepository(
      new Map([
        ["app/main.wr", "use Boot from core.boot\nuefi image Main:\n"],
        ["core/boot.wr", "class Boot:\n"],
      ]),
    );

    const graph = new ModuleGraphLexer({
      lexer,
      files,
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

    expect(result.modules.map((module) => module.path.key)).toEqual([
      "app/main.wr",
      "core/boot.wr",
    ]);
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("reports missing modules and continues", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const files = new FakeFileRepository(
      new Map([
        ["app/main.wr", "use Missing from core.missing\nuse Ok from core.ok\n"],
        ["core/ok.wr", "class Ok:\n"],
      ]),
    );

    const graph = new ModuleGraphLexer({
      lexer,
      files,
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

    expect(result.modules.map((module) => module.path.key)).toEqual(["app/main.wr", "core/ok.wr"]);
    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "LEX_MODULE_READ_FAILED",
    );
  });

  test("detects import cycles", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const files = new FakeFileRepository(
      new Map([
        ["app/main.wr", "use A from app.a\nuefi image Main:\n"],
        ["app/a.wr", "use Main from app.main\nclass A:\n"],
      ]),
    );

    const graph = new ModuleGraphLexer({
      lexer,
      files,
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

    expect(result.modules.length).toBe(2);
    expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "LEX_IMPORT_CYCLE",
    );
  });

  test("each module is lexed at most once", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const files = new FakeFileRepository(
      new Map([
        ["app/main.wr", "use A from app.a\nuse B from app.b\nuefi image Main:\n"],
        ["app/a.wr", "use B from app.b\nclass A:\n"],
        ["app/b.wr", "class B:\n"],
      ]),
    );

    const graph = new ModuleGraphLexer({
      lexer,
      files,
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

    const keys = result.modules.map((module) => module.path.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("lexed modules have valid token streams", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const files = new FakeFileRepository(
      new Map([
        ["app/main.wr", "use Boot from core.boot\nuefi image Main:\n"],
        ["core/boot.wr", "class Boot:\n"],
      ]),
    );

    const graph = new ModuleGraphLexer({
      lexer,
      files,
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

    for (const module of result.modules) {
      expect(module.tokens.eofCount()).toBe(1);
      expect(module.tokens.reconstruct()).toBe(module.source.text);
      expect(module.imports.length).toBeGreaterThanOrEqual(0);
    }
  });
});
