import { describe, expect, test } from "bun:test";

import {
  compilerMetadataValue,
  createCompilerStageResult,
  runFrontendStage,
  runSemanticStage,
} from "../../../src/pipeline";
import {
  CollectingDiagnosticSink,
  DottedModuleResolver,
  KeywordTable,
  Lexer,
  ModulePath,
} from "../../../src/frontend/lexer";
import type { ParsedModuleGraph } from "../../../src/frontend/module-graph-parser";
import { FakeFileRepository } from "../../support/frontend/lexer-fakes";

describe("frontend and semantic pipeline stages", () => {
  test("frontend stage returns CompilerStageResult with module graph metadata", async () => {
    const result = await runFrontendStage({
      ...minimalFrontendInput(),
      loader: async () => parsedGraph([]),
    } as never);

    expect(result.kind).toBe("ok");
    expect(compilerMetadataValue(result.metadata, "frontendModuleGraph")).toEqual({
      moduleKeys: ["main", "dep"],
      edgeCount: 1,
    });
  });

  test("frontend errors stop semantic execution", () => {
    let semanticRuns = 0;
    const frontend = createCompilerStageResult<
      "frontend",
      ParsedModuleGraph,
      ReturnType<typeof diagnostic>
    >({
      stage: "frontend",
      diagnostics: [diagnostic("FRONTEND_BAD", "error")],
      error: true,
    });

    const semantic = runSemanticStage({
      frontend: frontend as never,
      checkSemantic: () => {
        semanticRuns += 1;
        return { value: { checked: true } };
      },
    });

    expect(semantic.kind).toBe("error");
    expect(semanticRuns).toBe(0);
    expect(semantic.diagnostics.map((item) => item.code)).toEqual(["FRONTEND_BAD"]);
  });

  test("semantic stage preserves frontend module graph metadata", async () => {
    const frontend = await runFrontendStage({
      ...minimalFrontendInput(),
      loader: async () => parsedGraph([]),
    } as never);

    const semantic = runSemanticStage({
      frontend,
      checkSemantic: () => ({ value: { checked: true }, diagnostics: [] }),
    });

    expect(semantic.kind).toBe("ok");
    expect(compilerMetadataValue(semantic.metadata, "frontendModuleGraph")).toEqual({
      moduleKeys: ["main", "dep"],
      edgeCount: 1,
    });
  });

  test("frontend stage rejects import cycles before semantic execution", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const frontend = await runFrontendStage({
      entry: ModulePath.from("app/main.wr"),
      lexer: new Lexer({ keywords: KeywordTable.default(), diagnostics }),
      files: new FakeFileRepository(
        new Map([
          ["app/main.wr", "use A from cycle.a\nfn main()\n"],
          ["cycle/a.wr", "use Main from app.main\nclass A:\n"],
        ]),
      ),
      resolver: new DottedModuleResolver(),
      diagnostics,
    });

    expect(frontend.kind).toBe("error");
    expect(frontend.diagnostics.map((item) => item.code)).toContain("LEX_IMPORT_CYCLE");
  });
});

function parsedGraph(diagnostics: readonly ReturnType<typeof diagnostic>[]): ParsedModuleGraph {
  return {
    entry: { key: "main", display: "main" },
    modules: [
      {
        path: { key: "main", display: "main" },
        imports: [{ moduleName: "dep" }],
        parserDiagnostics: [],
      },
      {
        path: { key: "dep", display: "dep" },
        imports: [],
        parserDiagnostics: [],
      },
    ],
    diagnostics,
  } as never;
}

function diagnostic(code: string, severity: "error" | "warning") {
  return {
    code,
    severity,
    message: code,
    source: { name: "fake.wrela" },
    span: { start: 0, end: 0 },
  };
}

function minimalFrontendInput() {
  return {
    entry: { key: "main", display: "main" },
    lexer: {},
    files: {},
    resolver: {},
    diagnostics: { diagnostics: [], report: () => undefined },
  };
}
