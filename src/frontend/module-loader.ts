import type { Diagnostic } from "../shared/diagnostics";
import { combineDiagnostics } from "./parser/parser-diagnostics";
import type { DiagnosticSink, LexDiagnostic } from "./lexer/diagnostics";
import type { FileReadResult, FileRepository } from "./lexer/file-repository";
import type { Lexer } from "./lexer/lexer";
import type { ModuleImportRequest } from "./lexer/module-import-request";
import type { ModulePath } from "./lexer/module-path";
import type { ModuleResolver } from "./lexer/module-resolver";
import { SourceText as SharedSourceText } from "../shared/source-text";
import { Parser } from "./parser/parser";
import { moduleImportRequestsFromParsedTopLevelDeclarations } from "./module-import-discovery";
import type { ParsedModule, ParsedModuleGraph } from "./module-graph-parser";

export interface LoadFrontendModuleGraphInput {
  readonly entry: ModulePath;
  readonly lexer: Lexer;
  readonly files: FileRepository;
  readonly resolver: ModuleResolver;
  readonly diagnostics: DiagnosticSink & { readonly diagnostics: readonly LexDiagnostic[] };
  readonly parser?: Parser;
}

export interface SyncFileRepository {
  read(path: ModulePath): FileReadResult;
}

export interface LoadFrontendModuleGraphSyncInput {
  readonly entry: ModulePath;
  readonly lexer: Lexer;
  readonly files: SyncFileRepository;
  readonly resolver: ModuleResolver;
  readonly diagnostics: DiagnosticSink & { readonly diagnostics: readonly LexDiagnostic[] };
  readonly parser?: Parser;
}

interface PendingModule {
  readonly path: ModulePath;
  readonly importRequest?: ModuleImportRequest;
  readonly activePath: readonly ModulePath[];
}

interface TraversalFrame {
  readonly path: ModulePath;
  readonly importRequest?: ModuleImportRequest;
  readonly expanded: boolean;
  readonly activePath: readonly ModulePath[];
}

export async function loadFrontendModuleGraph(
  input: LoadFrontendModuleGraphInput,
): Promise<ParsedModuleGraph> {
  const parser = input.parser ?? new Parser();
  const traversal = createModuleGraphTraversal(input);
  for (
    let request = traversal.nextLoadRequest();
    request !== undefined;
    request = traversal.nextLoadRequest()
  ) {
    traversal.completeLoad(
      request,
      await loadSingleModule(input, parser, request.path, request.importRequest),
    );
  }
  return traversal.parsedGraph();
}

export function loadFrontendModuleGraphSync(
  input: LoadFrontendModuleGraphSyncInput,
): ParsedModuleGraph {
  const parser = input.parser ?? new Parser();
  const traversal = createModuleGraphTraversal(input);
  for (
    let request = traversal.nextLoadRequest();
    request !== undefined;
    request = traversal.nextLoadRequest()
  ) {
    traversal.completeLoad(
      request,
      loadSingleModuleSync(input, parser, request.path, request.importRequest),
    );
  }
  return traversal.parsedGraph();
}

function createModuleGraphTraversal(
  input: Pick<LoadFrontendModuleGraphInput, "entry" | "resolver" | "diagnostics">,
): {
  readonly nextLoadRequest: () => PendingModule | undefined;
  readonly completeLoad: (request: PendingModule, module: ParsedModule | undefined) => void;
  readonly parsedGraph: () => ParsedModuleGraph;
} {
  const modules: ParsedModule[] = [];
  const loaded = new Set<string>();
  const inProgress = new Set<string>();
  const stack: TraversalFrame[] = [
    { path: input.entry, expanded: false, activePath: [input.entry] },
  ];

  return {
    nextLoadRequest() {
      while (stack.length > 0) {
        const frame = stack.pop()!;

        if (frame.expanded) {
          inProgress.delete(frame.path.key);
          continue;
        }

        if (loaded.has(frame.path.key)) {
          continue;
        }

        inProgress.add(frame.path.key);
        return {
          path: frame.path,
          importRequest: frame.importRequest,
          activePath: frame.activePath,
        };
      }
      return undefined;
    },
    completeLoad(request, module) {
      if (module === undefined) {
        inProgress.delete(request.path.key);
        return;
      }

      modules.push(module);
      loaded.add(module.path.key);

      stack.push({
        path: request.path,
        importRequest: request.importRequest,
        expanded: true,
        activePath: request.activePath,
      });

      const nextModules: PendingModule[] = [];
      for (const nextImport of sortedModuleImports(module.imports)) {
        const resolveResult = input.resolver.resolve(nextImport);

        if (resolveResult.kind === "unresolved") {
          input.diagnostics.report({
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
          input.diagnostics.report({
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
          const cyclePath = moduleCyclePath(request.activePath, resolvedPath);
          const cyclePathKey = cyclePath.map((path) => path.key).join(">");
          input.diagnostics.report({
            code: "LEX_IMPORT_CYCLE",
            severity: "error",
            message: `Import cycle detected: ${cyclePathKey}`,
            source: nextImport.source,
            span: nextImport.span,
            ownerKey: `module:${resolvedPath.key}`,
            stableDetail: `import-cycle:${nextImport.importer.key}:${resolvedPath.key}:${nextImport.span.start}:${nextImport.span.end}:path=${cyclePathKey}`,
          });
          continue;
        }

        if (!loaded.has(resolvedPath.key)) {
          nextModules.push({
            path: resolvedPath,
            importRequest: nextImport,
            activePath: [...request.activePath, resolvedPath],
          });
        }
      }

      for (let index = nextModules.length - 1; index >= 0; index--) {
        const nextModule = nextModules[index]!;
        stack.push({
          path: nextModule.path,
          importRequest: nextModule.importRequest,
          expanded: false,
          activePath: nextModule.activePath,
        });
      }
    },
    parsedGraph() {
      return parsedGraphFromLoadedModules(input, modules);
    },
  };
}

function parsedGraphFromLoadedModules(
  input: Pick<LoadFrontendModuleGraphInput, "entry" | "diagnostics">,
  modules: readonly ParsedModule[],
): ParsedModuleGraph {
  const parserDiagnostics = modules.flatMap((module) => module.parserDiagnostics);
  const lexerDiagnostics = input.diagnostics.diagnostics.filter(
    (diagnostic) =>
      !parserDiagnostics.some((parserDiagnostic) => diagnosticsMatch(diagnostic, parserDiagnostic)),
  );

  return {
    entry: input.entry,
    modules,
    diagnostics: combineDiagnostics(lexerDiagnostics, parserDiagnostics),
  };
}

function sortedModuleImports(
  imports: readonly ModuleImportRequest[],
): readonly ModuleImportRequest[] {
  return Object.freeze(
    [...imports].sort(
      (left, right) =>
        left.span.start - right.span.start ||
        left.span.end - right.span.end ||
        left.moduleName.localeCompare(right.moduleName),
    ),
  );
}

function moduleCyclePath(
  activePath: readonly ModulePath[],
  repeatedPath: ModulePath,
): readonly ModulePath[] {
  const cycleStart = activePath.findIndex((path) => path.key === repeatedPath.key);
  const cyclePrefix = cycleStart >= 0 ? activePath.slice(cycleStart) : activePath;
  return Object.freeze([...cyclePrefix, repeatedPath]);
}

async function loadSingleModule(
  input: LoadFrontendModuleGraphInput,
  parser: Parser,
  path: ModulePath,
  importRequest?: ModuleImportRequest,
): Promise<ParsedModule | undefined> {
  const readResult = await input.files.read(path);

  if (readResult.kind === "missing") {
    reportModuleReadFailed(input.diagnostics, path, "missing", importRequest);
    return undefined;
  }

  if (readResult.kind === "unreadable") {
    reportModuleReadFailed(
      input.diagnostics,
      path,
      "unreadable",
      importRequest,
      readResult.message,
    );
    return undefined;
  }

  return parseLoadedModule({
    lexer: input.lexer,
    parser,
    path,
    readResult,
  });
}

function loadSingleModuleSync(
  input: LoadFrontendModuleGraphSyncInput,
  parser: Parser,
  path: ModulePath,
  importRequest?: ModuleImportRequest,
): ParsedModule | undefined {
  const readResult = input.files.read(path);

  if (readResult.kind === "missing") {
    reportModuleReadFailed(input.diagnostics, path, "missing", importRequest);
    return undefined;
  }

  if (readResult.kind === "unreadable") {
    reportModuleReadFailed(
      input.diagnostics,
      path,
      "unreadable",
      importRequest,
      readResult.message,
    );
    return undefined;
  }

  return parseLoadedModule({
    lexer: input.lexer,
    parser,
    path,
    readResult,
  });
}

function parseLoadedModule(input: {
  readonly lexer: Lexer;
  readonly parser: Parser;
  readonly path: ModulePath;
  readonly readResult: Extract<FileReadResult, { readonly kind: "found" }>;
}): ParsedModule {
  const lexResult = input.lexer.lex(input.readResult.source);
  const parseResult = input.parser.parse({
    source: input.readResult.source,
    tokens: lexResult.tokens,
  });
  const imports = moduleImportRequestsFromParsedTopLevelDeclarations({
    importer: input.path,
    source: input.readResult.source,
    tree: parseResult.tree,
    parserDiagnostics: parseResult.parserDiagnostics,
  });

  return {
    path: input.path,
    source: input.readResult.source,
    tokens: lexResult.tokens,
    imports,
    tree: parseResult.tree,
    parserDiagnostics: parseResult.parserDiagnostics,
  };
}

function reportModuleReadFailed(
  diagnostics: DiagnosticSink,
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

  diagnostics.report({
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

function diagnosticsMatch(left: Diagnostic, right: Diagnostic): boolean {
  return (
    left.code === right.code &&
    left.message === right.message &&
    left.source.name === right.source.name &&
    left.span.start === right.span.start &&
    left.span.end === right.span.end
  );
}
