import { SourceText } from "../lexer/source-text";
import { TokenStream } from "../lexer/token-stream";
import { SyntaxFactory } from "../syntax/syntax-factory";
import { SyntaxTree } from "../syntax/syntax-tree";
import { ParserContext } from "./parser-context";
import { parseSourceFile } from "./source-file-parser";
import type { LexResult } from "../lexer/lexer";
import type { LexDiagnostic } from "../lexer/diagnostics";
import type { Diagnostic } from "../../shared/diagnostics";
import { combineDiagnostics, toParseDiagnostics, type ParseDiagnostic } from "./parser-diagnostics";

export interface ParseInput {
  source: SourceText;
  tokens: TokenStream;
  lexerDiagnostics?: readonly LexDiagnostic[];
}

export interface ParseLexResultInput {
  lexResult: LexResult;
  lexerDiagnostics?: readonly LexDiagnostic[];
}

export interface ParseResult {
  source: SourceText;
  tree: SyntaxTree;
  parserDiagnostics: readonly ParseDiagnostic[];
  diagnostics: readonly Diagnostic[];
}

export interface ParserOptions {
  maxDepth?: number;
}

const DEFAULT_MAX_PARSE_DEPTH = 256;

export class Parser {
  private readonly maxDepth: number;

  constructor(options?: ParserOptions) {
    this.maxDepth = Math.max(1, options?.maxDepth ?? DEFAULT_MAX_PARSE_DEPTH);
  }

  parse(input: ParseInput): ParseResult {
    const factory = new SyntaxFactory();
    const context = new ParserContext({
      tokens: input.tokens,
      factory,
      maxDepth: this.maxDepth,
    });

    const greenRoot = parseSourceFile(context);
    const tree = new SyntaxTree({ source: input.source, greenRoot });

    const parserDiagnostics = toParseDiagnostics(tree.diagnostics);
    const diagnostics = combineDiagnostics(input.lexerDiagnostics ?? [], parserDiagnostics);

    return {
      source: input.source,
      tree,
      parserDiagnostics,
      diagnostics,
    };
  }

  parseLexResult(input: ParseLexResultInput): ParseResult {
    return this.parse({
      source: input.lexResult.source,
      tokens: input.lexResult.tokens,
      lexerDiagnostics: input.lexerDiagnostics,
    });
  }
}
