import { expect, test } from "bun:test";
import { loadFrontendModuleGraph } from "../../../src";
import * as frontend from "../../../src/frontend";
import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  Parser,
  SourceText,
  SyntaxKind,
  SyntaxTree,
  Token,
  TokenKind,
  TokenStream,
  Trivia,
  TriviaKind,
  FunctionDeclarationView,
  SourceFileView,
  TypeReferenceView,
} from "../../../src/frontend";
import { GreenNode, GreenToken, RedNode, RedToken } from "../../../src/frontend/syntax";

test("frontend namespace exports lexer symbols", () => {
  expect(frontend.Lexer).toBeDefined();
  expect(frontend.TokenKind).toBeDefined();
  expect(frontend.SourceText).toBeDefined();
});

test("top-level package exports frontend loader facade", () => {
  expect(typeof loadFrontendModuleGraph).toBe("function");
});

test("direct imports from frontend/lexer work", () => {
  expect(Lexer).toBeDefined();
  expect(TokenKind).toBeDefined();
  expect(SourceText).toBeDefined();
  expect(TokenStream).toBeDefined();
  expect(Token).toBeDefined();
  expect(Trivia).toBeDefined();
  expect(TriviaKind).toBeDefined();
  expect(KeywordTable).toBeDefined();
  expect(CollectingDiagnosticSink).toBeDefined();
});

test("frontend namespace exports parser and syntax symbols", () => {
  expect(frontend.Parser).toBeDefined();
  expect(frontend.SyntaxKind).toBeDefined();
  expect(frontend.SyntaxTree).toBeDefined();
});

test("direct imports from frontend/parser work", () => {
  expect(Parser).toBeDefined();
});

test("direct imports from frontend/syntax work", () => {
  expect(SyntaxKind).toBeDefined();
  expect(SyntaxTree).toBeDefined();
});

test("syntax types are importable from syntax barrel", () => {
  expect(GreenNode).toBeDefined();
  expect(GreenToken).toBeDefined();
  expect(RedNode).toBeDefined();
  expect(RedToken).toBeDefined();
});

test("full lexer to parser pipeline through public API", () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const parser = new Parser();
  const source = SourceText.from(
    "main.wr",
    "uefi image Main:\n    devices:\n        net0: NetworkDevice\n",
  );
  const lexResult = lexer.lex(source);
  const result = parser.parseLexResult({
    lexResult,
    lexerDiagnostics: diagnostics.diagnostics,
  });

  expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
  expect(result.tree.reconstruct()).toBe(source.text);
  expect(result.parserDiagnostics.length).toBe(0);
});

test("frontend namespace exports AST views", () => {
  expect(frontend.SourceFileView).toBeDefined();
  expect(frontend.FunctionDeclarationView).toBeDefined();
  expect(frontend.TypeReferenceView).toBeDefined();
  expect(SourceFileView).toBeDefined();
  expect(FunctionDeclarationView).toBeDefined();
  expect(TypeReferenceView).toBeDefined();
});
