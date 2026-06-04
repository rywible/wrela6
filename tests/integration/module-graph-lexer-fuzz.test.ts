import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { CollectingDiagnosticSink } from "../../src/lexer/diagnostics";
import { ImportDiscovery } from "../../src/lexer/import-discovery";
import { KeywordTable } from "../../src/lexer/keyword-table";
import { Lexer } from "../../src/lexer/lexer";
import { ModuleGraphLexer } from "../../src/lexer/module-graph-lexer";
import { ModulePath } from "../../src/lexer/module-path";
import { DottedModuleResolver } from "../../src/lexer/module-resolver";
import { FakeFileRepository } from "../support/lexer-fakes";
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
          imports: new ImportDiscovery({ diagnostics }),
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
});
