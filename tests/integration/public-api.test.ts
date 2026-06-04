import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  DottedModuleResolver,
  ImportDiscovery,
  KeywordTable,
  Lexer,
  ModuleGraphLexer,
  ModulePath,
  SourceText,
  SourceSpan,
  Token,
  TokenKind,
  TokenStream,
  Trivia,
  TriviaKind,
} from "../../src/lexer";

describe("lexer public api", () => {
  test("lexes through the public barrel", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });

    const result = lexer.lex(SourceText.from("main.wr", "uefi image Main:\n"));

    expect(result.tokens.kinds()[0]).toBe(TokenKind.Uefi);
  });

  test("exports all expected public symbols", () => {
    expect(CollectingDiagnosticSink).toBeDefined();
    expect(DottedModuleResolver).toBeDefined();
    expect(ImportDiscovery).toBeDefined();
    expect(KeywordTable).toBeDefined();
    expect(Lexer).toBeDefined();
    expect(ModuleGraphLexer).toBeDefined();
    expect(ModulePath).toBeDefined();
    expect(SourceText).toBeDefined();
    expect(SourceSpan).toBeDefined();
    expect(Token).toBeDefined();
    expect(TokenKind).toBeDefined();
    expect(TokenStream).toBeDefined();
    expect(Trivia).toBeDefined();
    expect(TriviaKind).toBeDefined();
  });
});
