import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { CollectingDiagnosticSink } from "../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../src/frontend/lexer/lexer";
import { ModuleGraphLexer } from "../../src/frontend/lexer/module-graph-lexer";
import { ModulePath } from "../../src/frontend/lexer/module-path";
import { DottedModuleResolver } from "../../src/frontend/lexer/module-resolver";
import { FakeFileRepository, FakeModuleResolver } from "../support/lexer-fakes";
import { expectLosslessTokenStream, expectValidTokenSpans } from "../support/lexer-invariants";

const graphCase = fastCheck.record({
  includeA: fastCheck.boolean(),
  includeB: fastCheck.boolean(),
  mainImportsA: fastCheck.boolean(),
  mainImportsMissing: fastCheck.boolean(),
  aImportsB: fastCheck.boolean(),
  bImportsA: fastCheck.boolean(),
});

describe("module graph lexer fuzz invariants", () => {
  test("terminates and lexes each canonical module at most once", async () => {
    await fastCheck.assert(
      fastCheck.asyncProperty(graphCase, async (shape) => {
        const filesByPath: Record<string, string> = {
          "app/main.wr": [
            shape.mainImportsA ? "use A from app.a" : "",
            shape.mainImportsMissing ? "use Missing from app.missing" : "",
            "uefi image Main:",
            "",
          ]
            .filter(Boolean)
            .join("\n"),
        };

        if (shape.includeA) {
          filesByPath["app/a.wr"] = [shape.aImportsB ? "use B from app.b" : "", "class A:", ""]
            .filter(Boolean)
            .join("\n");
        }

        if (shape.includeB) {
          filesByPath["app/b.wr"] = [shape.bImportsA ? "use A from app.a" : "", "class B:", ""]
            .filter(Boolean)
            .join("\n");
        }

        const diagnostics = new CollectingDiagnosticSink();
        const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
        const graph = new ModuleGraphLexer({
          lexer,
          files: new FakeFileRepository(new Map(Object.entries(filesByPath))),
          resolver: new DottedModuleResolver(),
          diagnostics,
        });

        const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });
        const keys = result.modules.map((module) => module.path.key);

        expect(new Set(keys).size).toBe(keys.length);
        for (const module of result.modules) {
          expect(module.tokens.eofCount()).toBe(1);
          expectLosslessTokenStream(module.source, module.tokens);
          expectValidTokenSpans(module.source, module.tokens);
        }
      }),
      { numRuns: 1_000 },
    );
  });

  test("handles deep import chains without stack overflow", async () => {
    await fastCheck.assert(
      fastCheck.asyncProperty(fastCheck.integer({ min: 1, max: 20 }), async (chainLength) => {
        const filesByPath: Record<string, string> = {};

        for (let index = 0; index < chainLength; index++) {
          const next = index + 1 < chainLength ? index + 1 : -1;
          const body =
            next >= 0
              ? `use Next${next} from app.level${next}\nclass Level${index}:\n`
              : `class Level${index}:\n`;
          filesByPath[`app/level${index}.wr`] = body;
        }

        filesByPath["app/main.wr"] = `use Next0 from app.level0\nuefi image Main:\n`;

        const diagnostics = new CollectingDiagnosticSink();
        const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
        const graph = new ModuleGraphLexer({
          lexer,
          files: new FakeFileRepository(new Map(Object.entries(filesByPath))),
          resolver: new DottedModuleResolver(),
          diagnostics,
        });

        const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });
        const keys = result.modules.map((module) => module.path.key);

        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.length).toBe(chainLength + 1);

        for (const module of result.modules) {
          expectLosslessTokenStream(module.source, module.tokens);
        }
      }),
      { numRuns: 50, seed: 0x6eaf },
    );
  });

  test("handles two imports resolving to the same file", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const files = new FakeFileRepository(
      new Map([
        ["app/main.wr", "use A from utils.common\nuse B from utils.common\nuefi image Main:\n"],
        ["utils/common.wr", "class Common:\n"],
      ]),
    );
    const resolver = new FakeModuleResolver(new Map([["utils.common", "utils/common.wr"]]));

    const graph = new ModuleGraphLexer({
      lexer,
      files,
      resolver,
      diagnostics,
    });

    const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });
    const keys = result.modules.map((module) => module.path.key);

    expect(keys).toEqual(["app/main.wr", "utils/common.wr"]);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test("graph traversal is deterministic for the same repository", async () => {
    const files = new FakeFileRepository(
      new Map([
        ["app/main.wr", "use A from app.a\nuse B from app.b\nuefi image Main:\n"],
        ["app/a.wr", "class A:\n"],
        ["app/b.wr", "class B:\n"],
      ]),
    );

    const run = () => {
      const diagnostics = new CollectingDiagnosticSink();
      const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
      const graph = new ModuleGraphLexer({
        lexer,
        files,
        resolver: new DottedModuleResolver(),
        diagnostics,
      });
      return graph.lexImage({ entry: ModulePath.from("app/main.wr") });
    };

    const firstResult = await run();
    const secondResult = await run();

    expect(firstResult.modules.map((module) => module.path.key)).toEqual(
      secondResult.modules.map((module) => module.path.key),
    );

    for (let index = 0; index < firstResult.modules.length; index++) {
      expect(firstResult.modules[index]!.tokens.reconstruct()).toBe(
        secondResult.modules[index]!.tokens.reconstruct(),
      );
    }
  });
});
