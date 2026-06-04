import type { DiagnosticSink } from "./diagnostics";
import type { FileRepository } from "./file-repository";
import type { ImportDiscovery } from "./import-discovery";
import type { Lexer } from "./lexer";
import type { ModuleImportRequest } from "./module-import-request";
import type { ModulePath } from "./module-path";
import type { ModuleResolver } from "./module-resolver";
import type { SourceText } from "./source-text";
import type { TokenStream } from "./token-stream";

export interface LexedModule {
  path: ModulePath;
  source: SourceText;
  tokens: TokenStream;
  imports: readonly ModuleImportRequest[];
}

export interface ModuleGraphLexResult {
  entry: ModulePath;
  modules: readonly LexedModule[];
}

interface ModuleGraphLexerDependencies {
  lexer: Lexer;
  files: FileRepository;
  resolver: ModuleResolver;
  imports: ImportDiscovery;
  diagnostics: DiagnosticSink;
}

export class ModuleGraphLexer {
  constructor(private readonly dependencies: ModuleGraphLexerDependencies) {}

  async lexImage(context: { entry: ModulePath }): Promise<ModuleGraphLexResult> {
    const modules: LexedModule[] = [];
    const visited = new Set<string>();
    const inProgress = new Set<string>();

    await this.traverse(context.entry, modules, visited, inProgress);

    return { entry: context.entry, modules };
  }

  private async traverse(
    path: ModulePath,
    modules: LexedModule[],
    visited: Set<string>,
    inProgress: Set<string>,
    importRequest?: ModuleImportRequest,
  ): Promise<void> {
    if (visited.has(path.key)) {
      return;
    }

    visited.add(path.key);
    inProgress.add(path.key);

    const readResult = await this.dependencies.files.read(path);

    if (readResult.kind === "missing") {
      if (importRequest) {
        this.dependencies.diagnostics.report({
          code: "LEX_MODULE_MISSING",
          severity: "error",
          message: `Module not found: ${path.key}`,
          source: importRequest.source,
          span: importRequest.span,
        });
      }

      return;
    }

    if (readResult.kind === "unreadable") {
      if (importRequest) {
        this.dependencies.diagnostics.report({
          code: "LEX_MODULE_UNREADABLE",
          severity: "error",
          message: `Could not read module: ${readResult.message}`,
          source: importRequest.source,
          span: importRequest.span,
        });
      }

      return;
    }

    const { source } = readResult;
    const lexResult = this.dependencies.lexer.lex(source);
    const { tokens } = lexResult;
    const imports = this.dependencies.imports.discover({
      importer: path,
      source,
      tokens,
    });

    modules.push({
      path,
      source,
      tokens,
      imports,
    });

    for (const nextImport of imports) {
      const resolveResult = this.dependencies.resolver.resolve(nextImport);

      if (resolveResult.kind === "unresolved") {
        this.dependencies.diagnostics.report({
          code: "LEX_MODULE_UNRESOLVED",
          severity: "error",
          message: `Could not resolve module: ${nextImport.moduleName}`,
          source: nextImport.source,
          span: nextImport.span,
        });
        continue;
      }

      const resolvedPath = resolveResult.path;

      if (inProgress.has(resolvedPath.key)) {
        this.dependencies.diagnostics.report({
          code: "LEX_IMPORT_CYCLE",
          severity: "warning",
          message: `Import cycle detected: ${resolvedPath.key}`,
          source: nextImport.source,
          span: nextImport.span,
        });
        continue;
      }

      await this.traverse(resolvedPath, modules, visited, inProgress, nextImport);
    }

    inProgress.delete(path.key);
  }
}
