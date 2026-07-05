import { SourceFileView } from "./ast/declaration-views";
import type { ModuleImportRequest } from "./lexer/module-import-request";
import type { ModulePath } from "./lexer/module-path";
import type { SourceText } from "./lexer/source-text";
import type { ParseDiagnostic } from "./parser/parser-diagnostics";
import type { RedNode, SyntaxIndex } from "./syntax";
import type { SyntaxTree } from "./syntax/syntax-tree";

export function moduleImportRequestsFromParsedTopLevelDeclarations(context: {
  importer: ModulePath;
  source: SourceText;
  tree: SyntaxTree;
  parserDiagnostics?: readonly ParseDiagnostic[];
}): readonly ModuleImportRequest[] {
  const index = context.tree.index();
  const sourceFile = SourceFileView.fromRoot(context.tree.root());
  if (sourceFile === undefined) return [];

  return Object.freeze(
    sourceFile
      .imports()
      .map((declaration): ModuleImportRequest | undefined => {
        if (
          index.containsMissingToken(declaration.node) ||
          containsDiagnostic(index, context.parserDiagnostics ?? [], declaration.node)
        ) {
          return undefined;
        }

        const moduleName = declaration.moduleName();
        const moduleNameText = moduleName?.text();
        const moduleNameSpan = moduleName?.textSpan();
        if (moduleNameText === undefined || moduleNameSpan === undefined) return undefined;

        return {
          importer: context.importer,
          source: context.source,
          moduleName: moduleNameText,
          span: moduleNameSpan,
        };
      })
      .filter((request): request is ModuleImportRequest => request !== undefined),
  );
}

function containsDiagnostic(
  index: SyntaxIndex,
  diagnostics: readonly ParseDiagnostic[],
  node: RedNode,
): boolean {
  return diagnostics.some((diagnostic) => {
    const anchor = index.anchorForSpan(diagnostic.span);
    const span = anchor?.span ?? diagnostic.span;
    return span.start >= node.span.start && span.end <= node.span.end;
  });
}
