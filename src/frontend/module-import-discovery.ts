import { SourceFileView } from "./ast/declaration-views";
import type { ModuleImportRequest } from "./lexer/module-import-request";
import type { ModulePath } from "./lexer/module-path";
import type { SourceText } from "./lexer/source-text";
import type { SyntaxTree } from "./syntax/syntax-tree";

export function moduleImportRequestsFromParsedTopLevelDeclarations(context: {
  importer: ModulePath;
  source: SourceText;
  tree: SyntaxTree;
}): readonly ModuleImportRequest[] {
  const sourceFile = SourceFileView.fromRoot(context.tree.root());
  if (sourceFile === undefined) return [];

  return Object.freeze(
    sourceFile
      .imports()
      .map((declaration): ModuleImportRequest | undefined => {
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
