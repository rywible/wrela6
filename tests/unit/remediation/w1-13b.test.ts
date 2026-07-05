import { expect, test } from "bun:test";
import { FakeFileRepository } from "../../support/frontend/lexer-fakes";
import { CollectingDiagnosticSink } from "../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../src/frontend/lexer/lexer";
import { ModuleGraphLexer } from "../../../src/frontend/lexer/module-graph-lexer";
import { ModulePath } from "../../../src/frontend/lexer/module-path";
import { DottedModuleResolver } from "../../../src/frontend/lexer/module-resolver";
import { parseModuleGraph } from "../../../src/frontend/module-graph-parser";

test("nested use declarations diagnose parse error without creating import edges", async () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const files = new FakeFileRepository(
    new Map([["app/main.wr", "fn main():\n    use x from evil\n"]]),
  );

  const graph = new ModuleGraphLexer({
    lexer,
    files,
    resolver: new DottedModuleResolver(),
    diagnostics,
  });

  const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

  expect(result.modules).toHaveLength(1);
  expect(result.modules[0]!.imports).toEqual([]);
  const parsed = parseModuleGraph({ graph: result, lexerDiagnostics: diagnostics.diagnostics });
  const diagnosticCodes = parsed.diagnostics.map((diagnostic) => diagnostic.code as string);
  expect(diagnosticCodes).toContain("PARSE_RECOVERY_SKIPPED_TOKENS");
  expect(diagnosticCodes).not.toContain("LEX_MODULE_MISSING");
  expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.message)).not.toContain(
    "Module not found: evil",
  );
});
