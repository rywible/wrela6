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

describe("Match statement dispatch (integration)", () => {
  function getMatchBlock(matchStmt: RedNode): RedNode {
    return matchStmt.children()[3] as RedNode;
  }

  function getStmtList(block: RedNode): RedNode {
    return block.children()[2] as RedNode;
  }

  test("match with single case round-trips", () => {
    const source = SourceText.from(
      "test.wr",
      "fn main() -> Never:\n    match x:\n        case a:\n            y\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.MatchStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.MatchStatement);

    const children = stmt.children();
    expect(children[0]!.kind).toBe(SyntaxKind.MatchKeyword);
    expect(children[1]!.kind).toBe(SyntaxKind.NameExpression);
    expect(children[2]!.kind).toBe(SyntaxKind.ColonToken);

    const block = children[3] as RedNode;
    expect(block.kind).toBe(SyntaxKind.Block);

    const stmtList = block.children()[2] as RedNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);

    const matchCase = stmtList.children()[0] as RedNode;
    expect(matchCase.kind).toBe(SyntaxKind.MatchCase);
    const caseChildren = matchCase.children();
    expect(caseChildren[0]!.kind).toBe(SyntaxKind.CaseKeyword);
    expect(caseChildren[1]!.kind).toBe(SyntaxKind.Pattern);
    expect(caseChildren[2]!.kind).toBe(SyntaxKind.ColonToken);
    expect(caseChildren[3]!.kind).toBe(SyntaxKind.Block);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("match with constructor pattern round-trips", () => {
    const source = SourceText.from(
      "test.wr",
      "fn main() -> Never:\n    match result:\n        case Ok(value):\n            handle\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.MatchStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.MatchStatement);

    const matchBlock = getMatchBlock(stmt);
    const stmtList = getStmtList(matchBlock);
    const matchCase = stmtList.children()[0] as RedNode;
    const pattern = matchCase.children()[1] as RedNode;
    expect(pattern.kind).toBe(SyntaxKind.Pattern);
    expect(pattern.children()[0]!.kind).toBe(SyntaxKind.QualifiedName);
    expect(pattern.children()[1]!.kind).toBe(SyntaxKind.LeftParenToken);
    expect(pattern.children()[2]!.kind).toBe(SyntaxKind.PatternList);
    expect(pattern.children()[3]!.kind).toBe(SyntaxKind.RightParenToken);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("match with multiple cases round-trips", () => {
    const source = SourceText.from(
      "test.wr",
      "fn main() -> Never:\n    match x:\n        case a:\n            y\n        case b:\n            z\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.MatchStatement)[0]!;
    const matchBlock = getMatchBlock(stmt);
    const stmtList = getStmtList(matchBlock);
    expect(stmtList.children()[0]!.kind).toBe(SyntaxKind.MatchCase);
    expect(stmtList.children()[1]!.kind).toBe(SyntaxKind.MatchCase);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("match with qualified name pattern round-trips", () => {
    const source = SourceText.from(
      "test.wr",
      "fn main() -> Never:\n    match x:\n        case PacketKind.ping:\n            handle\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const stmt = collectByKind(result.tree.root(), SyntaxKind.MatchStatement)[0]!;
    expect(stmt.kind).toBe(SyntaxKind.MatchStatement);

    const matchBlock = getMatchBlock(stmt);
    const stmtList = getStmtList(matchBlock);
    const matchCase = stmtList.children()[0] as RedNode;
    const pattern = matchCase.children()[1] as RedNode;
    expect(pattern.kind).toBe(SyntaxKind.Pattern);
    const qName = pattern.children()[0] as RedNode;
    expect(qName.kind).toBe(SyntaxKind.QualifiedName);
    expect(qName.children()).toHaveLength(3);

    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("match statement inside a block", () => {
    const source = SourceText.from(
      "test.wr",
      "fn main() -> Never:\n    if x:\n        match y:\n            case a:\n                z\n",
    );
    const lexResult = createLexer().lex(source);
    const parser = new Parser();
    const result = parser.parseLexResult({ lexResult });

    expect(result.tree.reconstruct()).toBe(source.text);

    const ifStmt = collectByKind(result.tree.root(), SyntaxKind.IfStatement)[0]!;
    expect(ifStmt.kind).toBe(SyntaxKind.IfStatement);

    const ifBlock = ifStmt.children()[3] as RedNode;
    expect(ifBlock.kind).toBe(SyntaxKind.Block);

    const stmtList = ifBlock.children()[2] as RedNode;
    expect(stmtList.kind).toBe(SyntaxKind.StatementList);

    const matchStmt = stmtList.children()[0] as RedNode;
    expect(matchStmt.kind).toBe(SyntaxKind.MatchStatement);

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
