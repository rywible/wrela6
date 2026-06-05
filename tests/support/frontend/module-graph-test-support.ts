import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  ModulePath,
  Parser,
  SourceText,
  type ParsedModuleGraph,
  type ParsedModule,
} from "../../../src/frontend";

export function parsedModuleForTest(path: string, sourceCode: string): ParsedModule {
  const source = SourceText.from(path, sourceCode);
  const lexer = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
  const parser = new Parser();
  const lexResult = lexer.lex(source);
  const parseResult = parser.parseLexResult({ lexResult });
  return {
    path: ModulePath.from(path),
    source,
    tokens: lexResult.tokens,
    imports: [],
    tree: parseResult.tree,
    parserDiagnostics: parseResult.parserDiagnostics,
  };
}

export function parseModuleGraphForTest(
  modules: readonly (readonly [string, string])[],
): ParsedModuleGraph {
  const parsedModules = modules.map(([path, sourceCode]) => parsedModuleForTest(path, sourceCode));
  return {
    entry: ModulePath.from(modules[0]![0]),
    modules: parsedModules,
    diagnostics: parsedModules.flatMap((mod) => mod.parserDiagnostics),
  };
}

export function parseSingleModuleGraphForTest(path: string, sourceCode: string): ParsedModuleGraph {
  return parseModuleGraphForTest([[path, sourceCode]]);
}
