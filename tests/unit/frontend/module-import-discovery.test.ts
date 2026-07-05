import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  ModulePath,
  Parser,
  SourceText,
} from "../../../src/frontend";
import { moduleImportRequestsFromParsedTopLevelDeclarations } from "../../../src/frontend/module-import-discovery";

function discover(sourceText: string) {
  const diagnostics = new CollectingDiagnosticSink();
  const source = SourceText.from("app/main.wr", sourceText);
  const lexResult = new Lexer({ keywords: KeywordTable.default(), diagnostics }).lex(source);
  const parseResult = new Parser().parseLexResult({ lexResult });

  const imports = moduleImportRequestsFromParsedTopLevelDeclarations({
    importer: ModulePath.from("app/main.wr"),
    source,
    tree: parseResult.tree,
    parserDiagnostics: parseResult.parserDiagnostics,
  });

  return { imports, parseResult };
}

describe("moduleImportRequestsFromParsedTopLevelDeclarations", () => {
  test("discovers imports from parsed top-level declarations", () => {
    const { imports } = discover("use Writer, Reader from std.io\nfn main()\n");

    expect(imports.map((request) => request.moduleName)).toEqual(["std.io"]);
  });

  test("does not discover malformed parser-recovered imports", () => {
    const { imports } = discover("use Writer from std.\nfn main()\n");

    expect(imports).toEqual([]);
  });

  test("uses syntax-index anchored diagnostics to reject recovered import declarations", () => {
    const { imports, parseResult } = discover("use Writer from std.\nfn main()\n");
    const diagnosticAnchors = parseResult.parserDiagnostics.map((diagnostic) =>
      parseResult.tree.index().anchorForSpan(diagnostic.span),
    );

    expect(imports).toEqual([]);
    expect(diagnosticAnchors.every((anchor) => anchor !== undefined)).toBe(true);
  });
});
