import { describe, expect, test } from "bun:test";
import { GreenNode } from "../../../../src/frontend/syntax/green-node";
import { GreenToken } from "../../../../src/frontend/syntax/green-token";
import { SyntaxTree } from "../../../../src/frontend/syntax/syntax-tree";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { RedNode } from "../../../../src/frontend/syntax/red-node";

function token(kind: SyntaxKind, lexeme: string): GreenToken {
  return new GreenToken(kind, lexeme, [], [], false);
}

describe("SyntaxTree", () => {
  test("root() returns a red root node with offset 0 and tree source", () => {
    const source = SourceText.from("test", "x + 1");
    const green = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [
        token(SyntaxKind.IdentifierToken, "x"),
        token(SyntaxKind.PlusToken, " + "),
        token(SyntaxKind.IntegerLiteralToken, "1"),
      ],
    });
    const tree = new SyntaxTree({ source, greenRoot: green });

    const root = tree.root();
    expect(root).toBeInstanceOf(RedNode);
    expect(root.offset).toBe(0);
    expect(root.source).toBe(source);
    expect(root.kind).toBe(SyntaxKind.BinaryExpression);
  });

  test("root() caches the red root", () => {
    const source = SourceText.from("test", "x");
    const green = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "x")],
    });
    const tree = new SyntaxTree({ source, greenRoot: green });

    const root1 = tree.root();
    const root2 = tree.root();
    expect(root1).toBe(root2);
  });

  test("reconstruct() concatenates the green tree", () => {
    const source = SourceText.from("test", "foo + bar");
    const inner = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "foo")],
    });
    const green = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [
        inner,
        token(SyntaxKind.PlusToken, " + "),
        token(SyntaxKind.NameExpression, "bar"),
      ],
    });
    const tree = new SyntaxTree({ source, greenRoot: green });
    expect(tree.reconstruct()).toBe("foo + bar");
  });

  test("reconstruct() with nested nodes equals original source text", () => {
    const inner = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "x")],
    });
    const outer = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [
        inner,
        token(SyntaxKind.PlusToken, "+"),
        token(SyntaxKind.IntegerLiteralToken, "1"),
      ],
    });
    const source = SourceText.from("test", "x+1");
    const tree = new SyntaxTree({ source, greenRoot: outer });
    expect(tree.reconstruct()).toBe(source.text);
  });

  test("diagnostics returns empty array when there are no diagnostics", () => {
    const source = SourceText.from("test", "x");
    const green = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "x")],
    });
    const tree = new SyntaxTree({ source, greenRoot: green });
    expect(tree.diagnostics).toEqual([]);
  });

  test("diagnostics are projected with absolute spans using tree source", () => {
    const source = SourceText.from("test", "x + 1");
    const green = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [
        token(SyntaxKind.IdentifierToken, "x"),
        token(SyntaxKind.PlusToken, " + "),
        token(SyntaxKind.IntegerLiteralToken, "1"),
      ],
      diagnostics: [
        {
          code: "PARSE_EXPECTED_TOKEN",
          severity: "error",
          message: "test diagnostic",
          relativeStart: 0,
          relativeEnd: 5,
        },
      ],
    });
    const tree = new SyntaxTree({ source, greenRoot: green });

    const sourceDiagnostics = tree.diagnostics;
    expect(sourceDiagnostics.length).toBe(1);
    expect(sourceDiagnostics[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
    expect(sourceDiagnostics[0]!.severity).toBe("error");
    expect(sourceDiagnostics[0]!.message).toBe("test diagnostic");
    expect(sourceDiagnostics[0]!.source).toBe(source);
    expect(sourceDiagnostics[0]!.span.start).toBe(0);
    expect(sourceDiagnostics[0]!.span.end).toBe(5);
  });

  test("diagnostics are collected recursively from nested children", () => {
    const source = SourceText.from("test", "x + y");
    const inner = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "x")],
      diagnostics: [
        {
          code: "PARSE_EXPECTED_TOKEN",
          severity: "warning",
          message: "inner sourceDiagnostic",
          relativeStart: 0,
          relativeEnd: 1,
        },
      ],
    });
    const outer = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [inner, token(SyntaxKind.PlusToken, " + "), token(SyntaxKind.IdentifierToken, "y")],
    });
    const tree = new SyntaxTree({ source, greenRoot: outer });

    const sourceDiagnostics = tree.diagnostics;
    expect(sourceDiagnostics.length).toBe(1);
    expect(sourceDiagnostics[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
    expect(sourceDiagnostics[0]!.span.start).toBe(0);
    expect(sourceDiagnostics[0]!.span.end).toBe(1);
    expect(sourceDiagnostics[0]!.source).toBe(source);
  });

  test("diagnostics are sorted by span start, then end, then code", () => {
    const source = SourceText.from("test", "abcdef");
    const outer = new GreenNode({
      kind: SyntaxKind.SourceFile,
      children: [
        new GreenNode({
          kind: SyntaxKind.Block,
          children: [token(SyntaxKind.IdentifierToken, "abcdef")],
          diagnostics: [
            {
              code: "PARSE_UNTERMINATED_BLOCK",
              severity: "error",
              message: "should be last",
              relativeStart: 0,
              relativeEnd: 3,
            },
            {
              code: "PARSE_EXPECTED_DECLARATION",
              severity: "warning",
              message: "start tie, end tie, code sort",
              relativeStart: 0,
              relativeEnd: 3,
            },
            {
              code: "PARSE_EXPECTED_EXPRESSION",
              severity: "error",
              message: "start tie, earlier end",
              relativeStart: 0,
              relativeEnd: 2,
            },
            {
              code: "PARSE_EXPECTED_TOKEN",
              severity: "error",
              message: "later start",
              relativeStart: 3,
              relativeEnd: 6,
            },
          ],
        }),
      ],
    });
    const tree = new SyntaxTree({ source, greenRoot: outer });

    const sourceDiagnostics = tree.diagnostics;
    expect(sourceDiagnostics.length).toBe(4);

    // Expected order:
    // 1. start=0 end=2 PARSE_EXPECTED_EXPRESSION
    // 2. start=0 end=3 PARSE_EXPECTED_DECLARATION
    // 3. start=0 end=3 PARSE_UNTERMINATED_BLOCK
    // 4. start=3 end=6 PARSE_EXPECTED_TOKEN

    expect(sourceDiagnostics[0]!.code).toBe("PARSE_EXPECTED_EXPRESSION");
    expect(sourceDiagnostics[1]!.code).toBe("PARSE_EXPECTED_DECLARATION");
    expect(sourceDiagnostics[2]!.code).toBe("PARSE_UNTERMINATED_BLOCK");
    expect(sourceDiagnostics[3]!.code).toBe("PARSE_EXPECTED_TOKEN");
  });

  test("zero-width diagnostics at EOF", () => {
    const source = SourceText.from("test", "x");
    const outer = new GreenNode({
      kind: SyntaxKind.SourceFile,
      children: [token(SyntaxKind.IdentifierToken, "x")],
      diagnostics: [
        {
          code: "PARSE_EXPECTED_TOKEN",
          severity: "error",
          message: "error at EOF",
          relativeStart: 1,
          relativeEnd: 1,
        },
      ],
    });
    const tree = new SyntaxTree({ source, greenRoot: outer });

    const sourceDiagnostics = tree.diagnostics;
    expect(sourceDiagnostics.length).toBe(1);
    expect(sourceDiagnostics[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
    expect(sourceDiagnostics[0]!.span.start).toBe(1);
    expect(sourceDiagnostics[0]!.span.end).toBe(1);
    expect(sourceDiagnostics[0]!.source).toBe(source);
  });

  test("diagnostics from multiple nested nodes are collected and sorted", () => {
    const source = SourceText.from("test", "abcxyz");
    const inner1 = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "abc")],
      diagnostics: [
        {
          code: "PARSE_EXPECTED_TOKEN",
          severity: "error",
          message: "inner1 error",
          relativeStart: 0,
          relativeEnd: 1,
        },
      ],
    });
    const inner2 = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "xyz")],
      diagnostics: [
        {
          code: "PARSE_UNEXPECTED_TOKEN",
          severity: "warning",
          message: "inner2 warning",
          relativeStart: 0,
          relativeEnd: 3,
        },
      ],
    });
    const outer = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [inner1, token(SyntaxKind.PlusToken, ""), inner2],
      diagnostics: [
        {
          code: "PARSE_EXPECTED_EXPRESSION",
          severity: "error",
          message: "outer sourceDiagnostic",
          relativeStart: 0,
          relativeEnd: 6,
        },
      ],
    });
    const tree = new SyntaxTree({ source, greenRoot: outer });

    const sourceDiagnostics = tree.diagnostics;
    expect(sourceDiagnostics.length).toBe(3);

    // 1. PARSE_EXPECTED_TOKEN at (0, 1) — smallest end among start=0
    expect(sourceDiagnostics[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
    expect(sourceDiagnostics[0]!.span.start).toBe(0);
    expect(sourceDiagnostics[0]!.span.end).toBe(1);

    // 2. PARSE_EXPECTED_EXPRESSION at (0, 6) — same start as above but larger end
    expect(sourceDiagnostics[1]!.code).toBe("PARSE_EXPECTED_EXPRESSION");
    expect(sourceDiagnostics[1]!.span.start).toBe(0);
    expect(sourceDiagnostics[1]!.span.end).toBe(6);

    // 3. PARSE_UNEXPECTED_TOKEN at (3, 6) — later start
    expect(sourceDiagnostics[2]!.code).toBe("PARSE_UNEXPECTED_TOKEN");
    expect(sourceDiagnostics[2]!.span.start).toBe(3);
    expect(sourceDiagnostics[2]!.span.end).toBe(6);
  });

  test("diagnostics use the tree SourceText object", () => {
    const source = SourceText.from("test-file.wre", "x");
    const green = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "x")],
      diagnostics: [
        {
          code: "PARSE_EXPECTED_TOKEN",
          severity: "error",
          message: "test",
          relativeStart: 0,
          relativeEnd: 1,
        },
      ],
    });
    const tree = new SyntaxTree({ source, greenRoot: green });

    const sourceDiagnostics = tree.diagnostics;
    expect(sourceDiagnostics[0]!.code).toBe("PARSE_EXPECTED_TOKEN");
    expect(sourceDiagnostics[0]!.source.name).toBe("test-file.wre");
    expect(sourceDiagnostics[0]!.source).toBe(source);
  });
});
