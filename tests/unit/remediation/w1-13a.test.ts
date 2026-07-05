import { expect, test } from "bun:test";
import { FakeFileRepository } from "../../support/frontend/lexer-fakes";
import { CollectingDiagnosticSink } from "../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../src/frontend/lexer/lexer";
import { ModuleGraphLexer } from "../../../src/frontend/lexer/module-graph-lexer";
import { ModulePath } from "../../../src/frontend/lexer/module-path";
import { DottedModuleResolver } from "../../../src/frontend/lexer/module-resolver";

test("module graph loader builds import requests from parsed top-level declarations", async () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const files = new FakeFileRepository(
    new Map([
      ["app/main.wr", "use Core from wrela_std.core\nuefi image Main:\n"],
      ["wrela_std/core.wr", "class Core:\n"],
    ]),
  );

  const graph = new ModuleGraphLexer({
    lexer,
    files,
    resolver: new DottedModuleResolver(),
    diagnostics,
  });

  const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

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
  expect(diagnostics.diagnostics).toEqual([]);
});
