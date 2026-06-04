import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  SourceText,
  TokenKind,
  ModuleGraphLexer,
  ModulePath,
  DottedModuleResolver,
  ImportDiscovery,
  TokenStream,
} from "../../src/lexer";

describe("lexer public api", () => {
  test("lexes through the public barrel", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });

    const result = lexer.lex(SourceText.from("main.wr", "uefi image Main:\n"));

    expect(result.tokens.kinds()[0]).toBe(TokenKind.Uefi);
  });
});
