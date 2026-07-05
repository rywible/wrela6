import type { DiagnosticSink } from "./diagnostics";
import type { FileRepository } from "./file-repository";
import { ImportDiscovery } from "./import-discovery";
import type { Lexer } from "./lexer";
import type { ModuleImportRequest } from "./module-import-request";
import type { ModulePath } from "./module-path";
import type { ModuleResolver } from "./module-resolver";
import type { SourceText } from "./source-text";
import type { TokenStream } from "./token-stream";
import { SourceText as SharedSourceText } from "../../shared/source-text";

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
  diagnostics: DiagnosticSink;
}

export class ModuleGraphLexer {
  constructor(private readonly dependencies: ModuleGraphLexerDependencies) {}

  async lexImage(context: { entry: ModulePath }): Promise<ModuleGraphLexResult> {
    const modules: LexedModule[] = [];
    const loaded = new Set<string>();
    const inProgress = new Set<string>();

    await this.traverse(context.entry, modules, loaded, inProgress);

    return { entry: context.entry, modules };
  }

  private async traverse(
    path: ModulePath,
    modules: LexedModule[],
    loaded: Set<string>,
    inProgress: Set<string>,
    importRequest?: ModuleImportRequest,
  ): Promise<void> {
    if (loaded.has(path.key)) {
      return;
    }

    inProgress.add(path.key);

    try {
      const readResult = await this.dependencies.files.read(path);

      if (readResult.kind === "missing") {
        this.reportModuleReadFailed(path, "missing", importRequest);
        return;
      }

      if (readResult.kind === "unreadable") {
        this.reportModuleReadFailed(path, "unreadable", importRequest, readResult.message);
        return;
      }

      const { source } = readResult;
      const lexResult = this.dependencies.lexer.lex(source);
      const { tokens } = lexResult;
      const imports = new ImportDiscovery({
        diagnostics: this.dependencies.diagnostics,
      }).discover({
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
      loaded.add(path.key);

      for (const nextImport of imports) {
        const resolveResult = this.dependencies.resolver.resolve(nextImport);

        if (resolveResult.kind === "unresolved") {
          this.dependencies.diagnostics.report({
            code: "LEX_MODULE_UNRESOLVED",
            severity: "error",
            message: `Could not resolve module: ${nextImport.moduleName}`,
            source: nextImport.source,
            span: nextImport.span,
            ownerKey: `module:${nextImport.importer.key}`,
            stableDetail: `module-unresolved:${nextImport.moduleName}:${nextImport.span.start}:${nextImport.span.end}`,
          });
          continue;
        }

        if (resolveResult.kind === "pathInvalid") {
          this.dependencies.diagnostics.report({
            code: "LEX_MODULE_PATH_INVALID",
            severity: "error",
            message: `Invalid module path: ${resolveResult.path}`,
            source: nextImport.source,
            span: nextImport.span,
            ownerKey: resolveResult.ownerKey,
            stableDetail: resolveResult.stableDetail,
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
            ownerKey: `module:${resolvedPath.key}`,
            stableDetail: `import-cycle:${nextImport.importer.key}:${resolvedPath.key}:${nextImport.span.start}:${nextImport.span.end}`,
          });
          continue;
        }

        await this.traverse(resolvedPath, modules, loaded, inProgress, nextImport);
      }
    } finally {
      inProgress.delete(path.key);
    }
  }

  private reportModuleReadFailed(
    path: ModulePath,
    reason: "missing" | "unreadable",
    importRequest?: ModuleImportRequest,
    detail?: string,
  ): void {
    const source = importRequest?.source ?? SharedSourceText.from(path.display, "");
    const span = importRequest?.span ?? source.span(0, 0);
    const site = importRequest === undefined ? "entry" : "import";
    const importDetail =
      importRequest === undefined
        ? ""
        : `:${importRequest.importer.key}:${importRequest.moduleName}:${span.start}:${span.end}`;

    this.dependencies.diagnostics.report({
      code: "LEX_MODULE_READ_FAILED",
      severity: "error",
      message:
        detail === undefined
          ? `Could not read module ${path.key}: ${reason}`
          : `Could not read module ${path.key}: ${detail}`,
      source,
      span,
      ownerKey: `module:${path.key}`,
      stableDetail: `module-read:${site}:${reason}:${path.key}${importDetail}`,
    });
  }
}
