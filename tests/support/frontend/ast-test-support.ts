import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  Parser,
  SourceText,
} from "../../../src/frontend";
import type { RedNode } from "../../../src/frontend/syntax";

export function parseSourceRoot(sourceCode: string, name = "test.wr"): RedNode {
  const source = SourceText.from(name, sourceCode);
  const lexer = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
  const parser = new Parser();
  return parser.parseLexResult({ lexResult: lexer.lex(source) }).tree.root();
}
