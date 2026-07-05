import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  DottedModuleResolver,
  KeywordTable,
  Lexer,
  ModulePath,
} from "../../../src/frontend/lexer";
import { loadFrontendModuleGraph } from "../../../src/frontend/module-loader";
import { FakeFileRepository } from "../../support/frontend/lexer-fakes";

describe("loadFrontendModuleGraph", () => {
  test("builds import requests from parsed top-level declarations", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const result = await loadFrontendModuleGraph({
      entry: ModulePath.from("app/main.wr"),
      lexer: new Lexer({ keywords: KeywordTable.default(), diagnostics }),
      files: new FakeFileRepository(
        new Map([
          ["app/main.wr", "use Core from wrela_std.core\nuefi image Main:\n"],
          ["wrela_std/core.wr", "class Core:\n"],
        ]),
      ),
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    expect(result.modules[0]!.imports.map((request) => request.moduleName)).toEqual([
      "wrela_std.core",
    ]);
    expect(
      result.modules[0]!.imports.map((request) => ({
        importer: request.importer.key,
        source: request.source.name,
        moduleName: request.moduleName,
        spanText: request.source.slice(request.span),
      })),
    ).toEqual([
      {
        importer: "app/main.wr",
        source: "app/main.wr",
        moduleName: "wrela_std.core",
        spanText: "wrela_std.core",
      },
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  test("uses parser-backed import discovery and does not load malformed phantom imports", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const files = new Map([
      ["app/main.wr", "use Helper from lib.\nfn main()\n"],
      ["lib.wr", "class Helper:\n"],
    ]);

    const result = await loadFrontendModuleGraph({
      entry: ModulePath.from("app/main.wr"),
      lexer: new Lexer({ keywords: KeywordTable.default(), diagnostics }),
      files: new FakeFileRepository(files),
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    expect(result.modules.map((module) => module.path.key)).toEqual(["app/main.wr"]);
    expect(result.modules[0]!.imports).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
      "PARSE_EXPECTED_TOKEN",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "LEX_MODULE_UNRESOLVED",
    );
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "LEX_MODULE_READ_FAILED",
    );
  });

  test("nested use declarations diagnose parse error without creating import edges", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const result = await loadFrontendModuleGraph({
      entry: ModulePath.from("app/main.wr"),
      lexer: new Lexer({ keywords: KeywordTable.default(), diagnostics }),
      files: new FakeFileRepository(
        new Map([["app/main.wr", "fn main():\n    use x from evil\n"]]),
      ),
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    expect(result.modules).toHaveLength(1);
    expect(result.modules[0]!.imports).toEqual([]);
    const diagnosticCodes = result.diagnostics.map((diagnostic) => diagnostic.code as string);
    expect(diagnosticCodes).toContain("PARSE_RECOVERY_SKIPPED_TOKENS");
    expect(diagnosticCodes).not.toContain("LEX_MODULE_UNRESOLVED");
    expect(diagnosticCodes).not.toContain("LEX_MODULE_READ_FAILED");
  });

  test("traverses imports iteratively in deterministic order and reports cycles", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const files = new Map([
      ["app/main.wr", "use A from graph.a\nuse B from graph.b\nfn main()\n"],
      ["graph/a.wr", "use C from graph.c\nclass A:\n"],
      ["graph/b.wr", "use C from graph.c\nclass B:\n"],
      ["graph/c.wr", "use A from graph.a\nclass C:\n"],
    ]);

    const result = await loadFrontendModuleGraph({
      entry: ModulePath.from("app/main.wr"),
      lexer: new Lexer({ keywords: KeywordTable.default(), diagnostics }),
      files: new FakeFileRepository(files),
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    expect(result.modules.map((module) => module.path.key)).toEqual([
      "app/main.wr",
      "graph/a.wr",
      "graph/c.wr",
      "graph/b.wr",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "import-cycle:graph/c.wr:graph/a.wr:11:18:path=graph/a.wr>graph/c.wr>graph/a.wr",
    );
    expect(
      result.diagnostics.find((diagnostic) => diagnostic.code === "LEX_IMPORT_CYCLE"),
    ).toMatchObject({ severity: "error" });
  });

  test("reports a direct self import cycle with the exact cycle path", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const result = await loadFrontendModuleGraph({
      entry: ModulePath.from("app/main.wr"),
      lexer: new Lexer({ keywords: KeywordTable.default(), diagnostics }),
      files: new FakeFileRepository(
        new Map([["app/main.wr", "use Main from app.main\nclass Main:\n"]]),
      ),
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    expect(result.modules.map((module) => module.path.key)).toEqual(["app/main.wr"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "import-cycle:app/main.wr:app/main.wr:14:22:path=app/main.wr>app/main.wr",
    ]);
  });

  test("reports a three-module cycle with the exact active path", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const result = await loadFrontendModuleGraph({
      entry: ModulePath.from("app/main.wr"),
      lexer: new Lexer({ keywords: KeywordTable.default(), diagnostics }),
      files: new FakeFileRepository(
        new Map([
          ["app/main.wr", "use A from cycle.a\nfn main()\n"],
          ["cycle/a.wr", "use B from cycle.b\nclass A:\n"],
          ["cycle/b.wr", "use C from cycle.c\nclass B:\n"],
          ["cycle/c.wr", "use A from cycle.a\nclass C:\n"],
        ]),
      ),
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    expect(result.modules.map((module) => module.path.key)).toEqual([
      "app/main.wr",
      "cycle/a.wr",
      "cycle/b.wr",
      "cycle/c.wr",
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "import-cycle:cycle/c.wr:cycle/a.wr:11:18:path=cycle/a.wr>cycle/b.wr>cycle/c.wr>cycle/a.wr",
    ]);
  });

  test("loads a diamond import graph once without reporting a cycle", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const result = await loadFrontendModuleGraph({
      entry: ModulePath.from("app/main.wr"),
      lexer: new Lexer({ keywords: KeywordTable.default(), diagnostics }),
      files: new FakeFileRepository(
        new Map([
          ["app/main.wr", "use A from graph.a\nuse B from graph.b\nfn main()\n"],
          ["graph/a.wr", "use C from graph.c\nclass A:\n"],
          ["graph/b.wr", "use C from graph.c\nclass B:\n"],
          ["graph/c.wr", "class C:\n"],
        ]),
      ),
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    expect(result.modules.map((module) => module.path.key)).toEqual([
      "app/main.wr",
      "graph/a.wr",
      "graph/c.wr",
      "graph/b.wr",
    ]);
    expect(result.modules.filter((module) => module.path.key === "graph/c.wr")).toHaveLength(1);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
      "LEX_IMPORT_CYCLE",
    );
  });

  test("missing entry module reports a read failure diagnostic", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const result = await loadFrontendModuleGraph({
      entry: ModulePath.from("app/main.wr"),
      lexer: new Lexer({ keywords: KeywordTable.default(), diagnostics }),
      files: new FakeFileRepository(new Map()),
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    expect(result.modules).toEqual([]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "LEX_MODULE_READ_FAILED",
    ]);
    expect(result.diagnostics[0]).toMatchObject({
      ownerKey: "module:app/main.wr",
      stableDetail: "module-read:entry:missing:app/main.wr",
    });
  });

  test("each missing import site reports its own read failure diagnostic", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const result = await loadFrontendModuleGraph({
      entry: ModulePath.from("app/main.wr"),
      lexer: new Lexer({ keywords: KeywordTable.default(), diagnostics }),
      files: new FakeFileRepository(
        new Map([["app/main.wr", "use First from core.missing\nuse Second from core.missing\n"]]),
      ),
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    expect(result.modules.map((module) => module.path.key)).toEqual(["app/main.wr"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "LEX_MODULE_READ_FAILED",
      "LEX_MODULE_READ_FAILED",
    ]);
    expect(
      result.diagnostics.map((diagnostic) => diagnostic.source.slice(diagnostic.span)),
    ).toEqual(["core.missing", "core.missing"]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "module-read:import:missing:core/missing.wr:app/main.wr:core.missing:15:27",
      "module-read:import:missing:core/missing.wr:app/main.wr:core.missing:44:56",
    ]);
  });
});
