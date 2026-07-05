import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  DottedModuleResolver,
  KeywordTable,
  Lexer,
  ModulePath,
} from "../../../src/frontend/lexer";
import { loadFrontendModuleGraph } from "../../../src/frontend/module-loader";
import { FakeFileRepository, FakeModuleResolver } from "../../support/frontend/lexer-fakes";

describe("front-end smoke", () => {
  test("lexes an image entry through public APIs", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const result = await loadFrontendModuleGraph({
      entry: ModulePath.from("app/main.wr"),
      lexer,
      files: new FakeFileRepository(
        new Map([
          ["app/main.wr", "use Boot from core.boot\nuefi image Main:\n"],
          ["core/boot.wr", "class Boot:\n"],
        ]),
      ),
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    expect(result.modules.map((module) => module.path.key)).toEqual([
      "app/main.wr",
      "core/boot.wr",
    ]);
    for (const module of result.modules) {
      expect(module.tokens.reconstruct()).toBe(module.source.text);
    }
  });

  test("module graph parse round-trip", async () => {
    const files = new Map([
      [
        "main.wr",
        "use logger from core.log\nuefi image Main:\n    devices:\n        net0: NetworkDevice\n",
      ],
      ["core/log.wr", "uefi image Logger:\n"],
    ]);

    const fileRepository = new FakeFileRepository(files);
    const moduleResolver = new FakeModuleResolver(new Map([["core.log", "core/log.wr"]]));

    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const parsedGraph = await loadFrontendModuleGraph({
      entry: ModulePath.from("main.wr"),
      lexer,
      files: fileRepository,
      resolver: moduleResolver,
      diagnostics,
    });

    for (const module of parsedGraph.modules) {
      expect(module.tokens.reconstruct()).toBe(module.source.text);
      expect(module.tree.reconstruct()).toBe(module.source.text);
    }

    const allCodes = parsedGraph.diagnostics.map((diagnostic) => diagnostic.code);
    for (const code of allCodes) {
      expect(code.startsWith("LEX_") || code.startsWith("PARSE_")).toBe(true);
    }

    expect(parsedGraph.entry.key).toBe("main.wr");
  });
});
