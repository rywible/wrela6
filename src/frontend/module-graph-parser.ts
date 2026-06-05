import { Parser } from "./parser/parser";
import { combineDiagnostics } from "./parser/parser-diagnostics";
import type { ModuleGraphLexResult } from "./lexer/module-graph-lexer";
import type { ModulePath } from "./lexer/module-path";
import type { SourceText } from "./lexer/source-text";
import type { TokenStream } from "./lexer/token-stream";
import type { ModuleImportRequest } from "./lexer/module-import-request";
import type { SyntaxTree } from "./syntax/syntax-tree";
import type { LexDiagnostic } from "./lexer/diagnostics";
import type { Diagnostic } from "../shared/diagnostics";
import type { ParseDiagnostic } from "./parser/parser-diagnostics";

export interface ParsedModule {
  path: ModulePath;
  source: SourceText;
  tokens: TokenStream;
  imports: readonly ModuleImportRequest[];
  tree: SyntaxTree;
  parserDiagnostics: readonly ParseDiagnostic[];
}

export interface ParsedModuleGraph {
  entry: ModulePath;
  modules: readonly ParsedModule[];
  diagnostics: readonly Diagnostic[];
}

export interface ModuleGraphParseInput {
  graph: ModuleGraphLexResult;
  lexerDiagnostics?: readonly LexDiagnostic[];
}

export function parseModuleGraph(input: ModuleGraphParseInput): ParsedModuleGraph {
  const parser = new Parser();
  const parsedModules: ParsedModule[] = [];

  for (const lexedModule of input.graph.modules) {
    const parseResult = parser.parse({
      source: lexedModule.source,
      tokens: lexedModule.tokens,
    });

    parsedModules.push({
      path: lexedModule.path,
      source: lexedModule.source,
      tokens: lexedModule.tokens,
      imports: lexedModule.imports,
      tree: parseResult.tree,
      parserDiagnostics: parseResult.parserDiagnostics,
    });
  }

  const allDiagnostics = combineDiagnostics(
    input.lexerDiagnostics ?? [],
    parsedModules.flatMap((module) => module.parserDiagnostics),
  );

  return {
    entry: input.graph.entry,
    modules: parsedModules,
    diagnostics: allDiagnostics,
  };
}
