import { expect, test } from "bun:test";
import { FakeFileRepository } from "../../support/frontend/lexer-fakes";
import { CollectingDiagnosticSink } from "../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../src/frontend/lexer/lexer";
import { ModuleGraphLexer } from "../../../src/frontend/lexer/module-graph-lexer";
import { ModulePath } from "../../../src/frontend/lexer/module-path";
import { DottedModuleResolver } from "../../../src/frontend/lexer/module-resolver";

test("missing entry module reports a read failure diagnostic", async () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const graph = new ModuleGraphLexer({
    lexer,
    files: new FakeFileRepository(new Map()),
    resolver: new DottedModuleResolver(),
    diagnostics,
  });

  const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

  expect(result.modules).toEqual([]);
  expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "LEX_MODULE_READ_FAILED",
  ]);
  expect(diagnostics.diagnostics[0]).toMatchObject({
    ownerKey: "module:app/main.wr",
    stableDetail: "module-read:entry:missing:app/main.wr",
  });
});

test("each missing import site reports its own read failure diagnostic", async () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const graph = new ModuleGraphLexer({
    lexer,
    files: new FakeFileRepository(
      new Map([["app/main.wr", "use First from core.missing\nuse Second from core.missing\n"]]),
    ),
    resolver: new DottedModuleResolver(),
    diagnostics,
  });

  const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

  expect(result.modules.map((module) => module.path.key)).toEqual(["app/main.wr"]);
  expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
    "LEX_MODULE_READ_FAILED",
    "LEX_MODULE_READ_FAILED",
  ]);
  expect(
    diagnostics.diagnostics.map((diagnostic) => diagnostic.source.slice(diagnostic.span)),
  ).toEqual(["core.missing", "core.missing"]);
  expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "module-read:import:missing:core/missing.wr:app/main.wr:core.missing:15:27",
    "module-read:import:missing:core/missing.wr:app/main.wr:core.missing:44:56",
  ]);
});
