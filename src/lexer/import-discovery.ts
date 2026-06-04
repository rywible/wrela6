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
      const hasTrailingComma = this.collectImportNames(items, index, importNames);
      index = hasTrailingComma.index;

      if (importNames.length === 0) {
        this.reportMalformed(source, useToken.span);
        index = this.advancePastStatement(items, hasTrailingComma.index);
        continue;
      }

      if (hasTrailingComma.trailingComma) {
        this.reportMalformed(source, items[hasTrailingComma.index - 1]!.span);
        index = this.advancePastStatement(items, hasTrailingComma.index);
        continue;
      }

      if (index >= items.length || items[index]!.kind !== TokenKind.From) {
        this.reportMalformed(source, useToken.span);
        index = this.advancePastStatement(items, index);
        continue;
      }

      index++;

      const moduleParts: { text: string; token: Token }[] = [];
      const moduleResult = this.collectModuleName(items, index, moduleParts);
      index = moduleResult.index;

      if (moduleParts.length === 0) {
        this.reportMalformed(source, useToken.span);
        index = this.advancePastStatement(items, moduleResult.index);
        continue;
      }

      if (moduleResult.trailingDot) {
        this.reportMalformed(source, items[moduleResult.index - 1]!.span);
        index = this.advancePastStatement(items, moduleResult.index);
        continue;
      }

      const hasExtraTokens = this.checkExtraTokens(items, index);
      if (hasExtraTokens) {
        this.reportMalformed(source, items[index]!.span);
        index = this.advancePastStatement(items, index);
        continue;
      }

      const moduleSpan = SourceSpan.from(
        moduleParts[0]!.token.span.start,
        moduleParts[moduleParts.length - 1]!.token.span.end,
      );

      result.push({
        importer,
        source,
        moduleName: moduleParts.map((part) => part.text).join("."),
        span: moduleSpan,
      });

      index = this.advancePastStatement(items, index);
    }

    return result;
  }

  private collectImportNames(
    items: readonly Token[],
    startIndex: number,
    names: Token[],
  ): { index: number; trailingComma: boolean } {
    let index = startIndex;

    if (index >= items.length) {
      return { index, trailingComma: false };
    }

    if (items[index]!.kind !== TokenKind.Identifier) {
      return { index, trailingComma: false };
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
        return { index, trailingComma: true };
      }
    }

    return { index, trailingComma: false };
  }

  private checkExtraTokens(items: readonly Token[], index: number): boolean {
    return (
      index < items.length &&
      items[index]!.kind !== TokenKind.Newline &&
      items[index]!.kind !== TokenKind.Eof
    );
  }

  private collectModuleName(
    items: readonly Token[],
    startIndex: number,
    parts: { text: string; token: Token }[],
  ): { index: number; trailingDot: boolean } {
    let index = startIndex;

    if (index >= items.length) {
      return { index, trailingDot: false };
    }

    if (!this.isModuleNameToken(items[index]!)) {
      return { index, trailingDot: false };
    }

    parts.push({ text: items[index]!.lexeme, token: items[index]! });
    index++;

    while (index < items.length) {
      if (items[index]!.kind !== TokenKind.Dot) {
        break;
      }

      index++;

      if (index < items.length && this.isModuleNameToken(items[index]!)) {
        parts.push({ text: items[index]!.lexeme, token: items[index]! });
        index++;
      } else {
        return { index, trailingDot: true };
      }
    }

    return { index, trailingDot: false };
  }

  private isModuleNameToken(token: Token): boolean {
    if (token.kind === TokenKind.Identifier) {
      return true;
    }

    if (token.kind === TokenKind.Newline || token.kind === TokenKind.Eof) {
      return false;
    }

    if (token.kind === TokenKind.Indent || token.kind === TokenKind.Dedent) {
      return false;
    }

    if (
      token.kind === TokenKind.IntegerLiteral ||
      token.kind === TokenKind.StringLiteral ||
      token.kind === TokenKind.Invalid
    ) {
      return false;
    }

    if (
      token.kind === TokenKind.LeftParen ||
      token.kind === TokenKind.RightParen ||
      token.kind === TokenKind.LeftBrace ||
      token.kind === TokenKind.RightBrace ||
      token.kind === TokenKind.LeftBracket ||
      token.kind === TokenKind.RightBracket
    ) {
      return false;
    }

    if (
      token.kind === TokenKind.Colon ||
      token.kind === TokenKind.Comma ||
      token.kind === TokenKind.Dot
    ) {
      return false;
    }

    if (
      token.kind === TokenKind.Equals ||
      token.kind === TokenKind.Plus ||
      token.kind === TokenKind.Minus ||
      token.kind === TokenKind.Star ||
      token.kind === TokenKind.Slash ||
      token.kind === TokenKind.Percent ||
      token.kind === TokenKind.Less ||
      token.kind === TokenKind.Greater ||
      token.kind === TokenKind.Question
    ) {
      return false;
    }

    if (
      token.kind === TokenKind.Arrow ||
      token.kind === TokenKind.FatArrow ||
      token.kind === TokenKind.EqualsEquals ||
      token.kind === TokenKind.BangEquals ||
      token.kind === TokenKind.LessEquals ||
      token.kind === TokenKind.GreaterEquals
    ) {
      return false;
    }

    return true;
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
