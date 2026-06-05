import { SyntaxKind } from "../syntax/syntax-kind";
import { TokenKind } from "../lexer/token-kind";
import type { ParserContext } from "./parser-context";
import type { GreenNode } from "../syntax/green-node";
import { parseImportDeclaration } from "./import-declaration-parser";
import { parseEnumDeclaration } from "./enum-declaration-parser";
import {
  parseDataclassDeclaration,
  parseClassDeclaration,
  parseInterfaceDeclaration,
} from "./class-declaration-parser";
import { parseFunctionDeclaration } from "./function-declaration-parser";
import {
  parseEdgeClassDeclaration,
  parseStreamDeclaration,
} from "./edge-stream-declaration-parser";
import { parseImageDeclaration } from "./image-declaration-parser";
import { parseValidatedBufferDeclaration } from "./validated-buffer-parser";

export function parseDeclaration(context: ParserContext): GreenNode | undefined {
  switch (context.currentSyntaxKind()) {
    case SyntaxKind.UseKeyword:
      return parseImportDeclaration(context);
    case SyntaxKind.EnumKeyword:
      return parseEnumDeclaration(context);
    case SyntaxKind.DataclassKeyword:
      return parseDataclassDeclaration(context);
    case SyntaxKind.ClassKeyword:
      return parseClassDeclaration(context);
    case SyntaxKind.PrivateKeyword:
      if (context.peek(1).kind === TokenKind.Class) {
        return parseClassDeclaration(context);
      }
      return parseFunctionDeclaration(context);
    case SyntaxKind.InterfaceKeyword:
      return parseInterfaceDeclaration(context);
    case SyntaxKind.EdgeKeyword:
      return parseEdgeClassDeclaration(context);
    case SyntaxKind.UniqueKeyword:
      return parseEdgeClassDeclaration(context);
    case SyntaxKind.StreamKeyword:
      return parseStreamDeclaration(context);
    case SyntaxKind.UefiKeyword:
      return parseImageDeclaration(context);
    case SyntaxKind.ValidatedKeyword:
      return parseValidatedBufferDeclaration(context);
    case SyntaxKind.FnKeyword:
    case SyntaxKind.ConstructorKeyword:
    case SyntaxKind.TerminalKeyword:
    case SyntaxKind.PredicateKeyword:
    case SyntaxKind.PlatformKeyword:
      return parseFunctionDeclaration(context);
    default:
      return undefined;
  }
}
