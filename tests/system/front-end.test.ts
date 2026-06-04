import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  DottedModuleResolver,
  ImportDiscovery,
  KeywordTable,
  Lexer,
  ModuleGraphLexer,
  ModulePath,
} from "../../src/lexer";
import { FakeFileRepository } from "../support/lexer-fakes";

describe("front-end smoke", () => {
  test("lexes an image entry through public APIs", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const graph = new ModuleGraphLexer({
      lexer,
      files: new FakeFileRepository(
        new Map([
          ["app/main.wr", "use Boot from core.boot\nuefi image Main:\n"],
          ["core/boot.wr", "class Boot:\n"],
        ]),
      ),
      resolver: new DottedModuleResolver(),
      imports: new ImportDiscovery({ diagnostics }),
      diagnostics,
    });

    const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

    expect(result.modules.map((module) => module.path.key)).toEqual([
      "app/main.wr",
      "core/boot.wr",
    ]);
    for (const module of result.modules) {
      expect(module.tokens.reconstruct()).toBe(module.source.text);
    }
  });
});
