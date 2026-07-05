import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { Parser } from "../../../../src/frontend/parser/parser";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { RedNode } from "../../../../src/frontend/syntax/red-node";

function createLexer(): Lexer {
  return new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
}

describe("Control statement dispatch (integration)", () => {
  test("if statement round-trips", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    if x:\n        y\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.IfStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.IfStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.IfKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.Condition);
    expect(children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[3]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("if/else block round-trips", () => {
    const source = SourceText.from(
      "test.wr",
      "fn main() -> Never:\n    if x:\n        y\n    else:\n        z\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.IfStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.IfStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.IfKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.Condition);
    expect(children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[3]!.kind).toBe(SyntaxKind.Block);
    expect(children[4]!.kind).toBe(SyntaxKind.ElseClause);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("while statement round-trips", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    while x:\n        y\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.WhileStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.WhileStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.WhileKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.Condition);
    expect(children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[3]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("for statement round-trips", () => {
    const source = SourceText.from(
      "test.wr",
      "fn main() -> Never:\n    for x in items:\n        y\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.ForStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.ForStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.ForKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.Pattern);
    expect(children[2]!.kind).toBe(SyntaxKind.InKeyword);
    expect(children[3]!.kind).toBe(SyntaxKind.NameExpression);
    expect(children[4]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[5]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("take with as clause round-trips", () => {
    const source = SourceText.from(
      "test.wr",
      "fn main() -> Never:\n    take value as x:\n        y\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.TakeStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.TakeStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.TakeKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.NameExpression);
    expect(children[2]!.kind).toBe(SyntaxKind.AsKeyword);
    expect(children[3]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(children[4]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[5]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("take without as clause round-trips", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    take value:\n        y\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.TakeStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.TakeStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.TakeKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.NameExpression);
    expect(children[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect(children[3]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("multiple control statements in source file", () => {
    const source = SourceText.from(
      "test.wr",
      "fn main() -> Never:\n    if x:\n        y\n    while z:\n        w\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    expect(collectByKind(result.tree.root(), SyntaxKind.IfStatement)).toHaveLength(1);
    expect(collectByKind(result.tree.root(), SyntaxKind.WhileStatement)).toHaveLength(1);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("break statement round-trips inside loop body", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    loop:\n        break\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const breakNodes = collectByKind(root, SyntaxKind.BreakStatement);
    expect(breakNodes).toHaveLength(1);
    expect(breakNodes[0]!.children()[0]!.kind).toBe(SyntaxKind.BreakKeyword);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("ensure statement round-trips inside block", () => {
    const source = SourceText.from("test.wr", "fn main(x: bool) -> Never:\n    ensure x\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    const ensureNodes = collectByKind(root, SyntaxKind.EnsureStatement);
    expect(ensureNodes).toHaveLength(1);
    const children = ensureNodes[0]!.children();
    expect(children[0]!.kind).toBe(SyntaxKind.EnsureKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.NameExpression);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("break and ensure surface as statements in sequence", () => {
    const source = SourceText.from(
      "test.wr",
      "fn main(x: bool) -> Never:\n    loop:\n        break\n    ensure x\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    expect(collectByKind(root, SyntaxKind.BreakStatement)).toHaveLength(1);
    expect(collectByKind(root, SyntaxKind.EnsureStatement)).toHaveLength(1);
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("malformed ensure recovery diagnostics sort deterministically", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    ensure\n    break\n");
    const parser = new Parser();

    const firstResult = parser.parseLexResult({ lexResult: createLexer().lex(source) });
    const secondResult = parser.parseLexResult({ lexResult: createLexer().lex(source) });

    expect(firstResult.parserDiagnostics.map((diagnostic) => diagnostic.code)).toEqual(
      secondResult.parserDiagnostics.map((diagnostic) => diagnostic.code),
    );
  });
});

function collectByKind(root: RedNode, kind: SyntaxKind): RedNode[] {
  const matches: RedNode[] = [];
  const stack: RedNode[] = [root];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.kind === kind) {
      matches.push(node);
    }
    for (const child of node.children()) {
      if (child instanceof RedNode) {
        stack.push(child);
      }
    }
  }
  return matches;
}
