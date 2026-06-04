import type { DiagnosticSink } from "./diagnostics";
import { TokenKind } from "./token-kind";
import type { Token } from "./token";
import type { TokenStream } from "./token-stream";
import type { ModuleImportRequest } from "./module-import-request";
import type { ModulePath } from "./module-path";
import type { SourceText } from "./source-text";
import { SourceSpan } from "./source-span";

interface ImportDiscoveryDependencies {
  diagnostics: DiagnosticSink;
}

export class ImportDiscovery {
  constructor(private readonly dependencies: ImportDiscoveryDependencies) {}

  discover(context: {
    importer: ModulePath;
    source: SourceText;
    tokens: TokenStream;
  }): readonly ModuleImportRequest[] {
    const { importer, source, tokens } = context;
    const items = tokens.items;
    const result: ModuleImportRequest[] = [];
    let index = 0;

    while (index < items.length) {
      const token = items[index]!;

      if (token.kind === TokenKind.Eof) {
        break;
      }

      if (token.kind !== TokenKind.Use) {
        index++;
        continue;
      }

      const useToken = token;

      index++;

      const importNames: Token[] = [];
      index = this.collectImportNames(items, index, importNames);

      if (importNames.length === 0) {
        this.reportMalformed(source, useToken.span);
        index = this.advancePastStatement(items, index);
        continue;
      }

      if (index >= items.length || items[index]!.kind !== TokenKind.From) {
        this.reportMalformed(source, useToken.span);
        index = this.advancePastStatement(items, index);
        continue;
      }

      index++;

      const moduleParts: string[] = [];
      index = this.collectModuleName(items, index, moduleParts);

      if (moduleParts.length === 0) {
        this.reportMalformed(source, useToken.span);
        index = this.advancePastStatement(items, index);
        continue;
      }

      const lastConsumed = index - 1;
      const span = SourceSpan.from(useToken.span.start, items[lastConsumed]!.span.end);

      result.push({
        importer,
        source,
        moduleName: moduleParts.join("."),
        span,
      });

      index = this.advancePastStatement(items, index);
    }

    return result;
  }

  private collectImportNames(items: readonly Token[], startIndex: number, names: Token[]): number {
    let index = startIndex;

    if (index >= items.length) {
      return index;
    }

    if (items[index]!.kind !== TokenKind.Identifier) {
      return index;
    }

    names.push(items[index]!);
    index++;

    while (index < items.length) {
      if (items[index]!.kind !== TokenKind.Comma) {
        break;
      }

      index++;

      if (index < items.length && items[index]!.kind === TokenKind.Identifier) {
        names.push(items[index]!);
        index++;
      } else {
        break;
      }
    }

    return index;
  }

  private collectModuleName(items: readonly Token[], startIndex: number, parts: string[]): number {
    let index = startIndex;

    if (index >= items.length) {
      return index;
    }

    if (items[index]!.kind !== TokenKind.Identifier) {
      return index;
    }

    parts.push(items[index]!.lexeme);
    index++;

    while (index < items.length) {
      if (items[index]!.kind !== TokenKind.Dot) {
        break;
      }

      index++;

      if (index < items.length && items[index]!.kind === TokenKind.Identifier) {
        parts.push(items[index]!.lexeme);
        index++;
      } else {
        break;
      }
    }

    return index;
  }

  private advancePastStatement(items: readonly Token[], startIndex: number): number {
    let index = startIndex;

    while (index < items.length) {
      const token = items[index]!;

      if (token.kind === TokenKind.Newline || token.kind === TokenKind.Eof) {
        return index + 1;
      }

      index++;
    }

    return index;
  }

  private reportMalformed(source: SourceText, span: SourceSpan): void {
    this.dependencies.diagnostics.report({
      code: "LEX_IMPORT_MALFORMED",
      severity: "error",
      message: "Malformed import statement.",
      source,
      span,
    });
  }
}
