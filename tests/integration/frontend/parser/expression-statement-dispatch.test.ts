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

describe("Expression statement dispatch (integration)", () => {
  test("identifier expression statement round-trips", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    x\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    expect(root.kind).toBe(SyntaxKind.SourceFile);

    const stmt = collectByKind(root, SyntaxKind.ExpressionStatement)[0]!;
    const stmtChildren = stmt.children();
    expect(stmtChildren).toHaveLength(2);
    expect(stmtChildren[0]!.kind).toBe(SyntaxKind.NameExpression);
    expect(stmtChildren[1]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("assignment statement in function body", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    x = 42\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    expect(root.kind).toBe(SyntaxKind.SourceFile);

    const stmt = collectByKind(root, SyntaxKind.AssignmentStatement)[0]!;
    const stmtChildren = stmt.children();
    expect(stmtChildren).toHaveLength(4);
    expect(stmtChildren[0]!.kind).toBe(SyntaxKind.NameExpression);
    expect(stmtChildren[1]!.kind).toBe(SyntaxKind.EqualsToken);
    expect(stmtChildren[2]!.kind).toBe(SyntaxKind.LiteralExpression);
    expect(stmtChildren[3]!.kind).toBe(SyntaxKind.NewlineToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("assignment and expression statements in function body", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    a = 1\n    b\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const root = result.tree.root();
    expect(root.kind).toBe(SyntaxKind.SourceFile);

    const assign = collectByKind(root, SyntaxKind.AssignmentStatement)[0]!;
    expect(assign.children()[0]!.kind).toBe(SyntaxKind.NameExpression);
    expect(assign.children()[2]!.kind).toBe(SyntaxKind.LiteralExpression);

    const expr = collectByKind(root, SyntaxKind.ExpressionStatement)[0]!;
    expect(expr.children()[0]!.kind).toBe(SyntaxKind.NameExpression);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("call expression as statement round-trips", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    foo()\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.ExpressionStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.ExpressionStatement);

    const expr = stmt.children()[0] as RedNode;
    expect(expr.kind).toBe(SyntaxKind.CallExpression);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("comparison (==) does not trigger assignment", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    x == 5\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.ExpressionStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.ExpressionStatement);

    const expr = stmt.children()[0] as RedNode;
    expect(expr.kind).toBe(SyntaxKind.EqualityExpression);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("member assignment round-trips", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    obj.field = 42\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.AssignmentStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.AssignmentStatement);

    const target = stmt.children()[0] as RedNode;
    expect(target.kind).toBe(SyntaxKind.MemberAccessExpression);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("source preservation across multiple expression statements", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    x\n    y\n    z\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    expect(collectByKind(result.tree.root(), SyntaxKind.ExpressionStatement)).toHaveLength(3);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("identifier followed by assignment in function body is not an error", () => {
    const source = SourceText.from("test.wr", "fn main() -> Never:\n    counter = counter + 1\n");
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.AssignmentStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.AssignmentStatement);

    expect(result.parserDiagnostics).toHaveLength(0);
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

  return matches.reverse();
}
