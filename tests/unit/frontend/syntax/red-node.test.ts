import { describe, expect, test } from "bun:test";
import { GreenNode } from "../../../../src/frontend/syntax/green-node";
import { GreenToken } from "../../../../src/frontend/syntax/green-token";
import { GreenTrivia } from "../../../../src/frontend/syntax/green-trivia";
import { RedNode } from "../../../../src/frontend/syntax/red-node";
import { RedToken } from "../../../../src/frontend/syntax/red-token";
import { RedTrivia } from "../../../../src/frontend/syntax/red-trivia";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { TriviaKind } from "../../../../src/frontend/lexer/trivia-kind";

function token(kind: SyntaxKind, lexeme: string): GreenToken {
  return new GreenToken(kind, lexeme, [], [], false);
}

describe("RedNode", () => {
  test("span equals [offset, offset + green.width)", () => {
    const source = SourceText.from("test", "a+1");
    const green = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [
        token(SyntaxKind.IdentifierToken, "a"),
        token(SyntaxKind.PlusToken, "+"),
        token(SyntaxKind.IntegerLiteralToken, "1"),
      ],
    });
    const red = new RedNode(green, undefined, 0, source, 0);
    expect(red.span.start).toBe(0);
    expect(red.span.end).toBe(3);
  });

  test("child() returns elements with correct offsets", () => {
    const source = SourceText.from("test", "a+1");
    const green = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [
        token(SyntaxKind.IdentifierToken, "a"),
        token(SyntaxKind.PlusToken, "+"),
        token(SyntaxKind.IntegerLiteralToken, "1"),
      ],
    });
    const red = new RedNode(green, undefined, 0, source, 0);

    const child0 = red.child(0)!;
    expect(child0.kind).toBe(SyntaxKind.IdentifierToken);
    expect(child0.span.start).toBe(0);
    expect(child0.span.end).toBe(1);

    const child1 = red.child(1)!;
    expect(child1.kind).toBe(SyntaxKind.PlusToken);
    expect(child1.span.start).toBe(1);
    expect(child1.span.end).toBe(2);

    const child2 = red.child(2)!;
    expect(child2.kind).toBe(SyntaxKind.IntegerLiteralToken);
    expect(child2.span.start).toBe(2);
    expect(child2.span.end).toBe(3);
  });

  test("children() returns all children in source order", () => {
    const source = SourceText.from("test", "a+1");
    const green = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [
        token(SyntaxKind.IdentifierToken, "a"),
        token(SyntaxKind.PlusToken, "+"),
        token(SyntaxKind.IntegerLiteralToken, "1"),
      ],
    });
    const red = new RedNode(green, undefined, 0, source, 0);

    const children = red.children();
    expect(children.length).toBe(3);
    expect(children[0]!.kind).toBe(SyntaxKind.IdentifierToken);
    expect(children[1]!.kind).toBe(SyntaxKind.PlusToken);
    expect(children[2]!.kind).toBe(SyntaxKind.IntegerLiteralToken);
  });

  test("parent and childIndex are correct for child wrappers", () => {
    const source = SourceText.from("test", "x+1");
    const greenInner = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "x")],
    });
    const greenOuter = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [
        greenInner,
        token(SyntaxKind.PlusToken, "+"),
        token(SyntaxKind.IntegerLiteralToken, "1"),
      ],
    });
    const redOuter = new RedNode(greenOuter, undefined, 0, source, 0);

    const child0 = redOuter.child(0)!;
    expect(child0.parent).toBe(redOuter);
    expect(child0.childIndex).toBe(0);

    const child1 = redOuter.child(1)!;
    expect(child1.parent).toBe(redOuter);
    expect(child1.childIndex).toBe(1);
  });

  test("nested red nodes have correct absolute spans", () => {
    const source = SourceText.from("test", "x+1");
    const greenInner = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "x")],
    });
    const greenOuter = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [
        greenInner,
        token(SyntaxKind.PlusToken, "+"),
        token(SyntaxKind.IntegerLiteralToken, "1"),
      ],
    });
    const redOuter = new RedNode(greenOuter, undefined, 0, source, 0);

    const inner = redOuter.child(0)! as RedNode;
    expect(inner.span.start).toBe(0);
    expect(inner.span.end).toBe(1);

    const leaf = inner.child(0)!;
    expect(leaf.span.start).toBe(0);
    expect(leaf.span.end).toBe(1);
  });

  test("child() returns undefined for out-of-bounds index", () => {
    const source = SourceText.from("test", "a");
    const green = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "a")],
    });
    const red = new RedNode(green, undefined, 0, source, 0);

    expect(red.child(-1)).toBeUndefined();
    expect(red.child(1)).toBeUndefined();
  });

  test("children() on node with no children returns empty array", () => {
    const source = SourceText.from("test", "");
    const green = new GreenNode({
      kind: SyntaxKind.Block,
      children: [],
    });
    const red = new RedNode(green, undefined, 0, source, 0);
    expect(red.children()).toEqual([]);
  });

  test("repeated navigation returns different objects but same coordinates", () => {
    const source = SourceText.from("test", "a+1");
    const green = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [
        token(SyntaxKind.IdentifierToken, "a"),
        token(SyntaxKind.PlusToken, "+"),
        token(SyntaxKind.IntegerLiteralToken, "1"),
      ],
    });
    const red = new RedNode(green, undefined, 0, source, 0);

    const child1 = red.child(0);
    const child2 = red.child(0);

    expect(child1).not.toBe(child2);
    expect(child1!.span.start).toBe(child2!.span.start);
    expect(child1!.span.end).toBe(child2!.span.end);
    expect(child1!.kind).toBe(child2!.kind);
  });

  test("child() returns RedNode for node children", () => {
    const source = SourceText.from("test", "x");
    const inner = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "x")],
    });
    const outer = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [inner, token(SyntaxKind.PlusToken, "+")],
    });
    const red = new RedNode(outer, undefined, 0, source, 0);

    const child = red.child(0);
    expect(child).toBeInstanceOf(RedNode);
    expect(child).not.toBeInstanceOf(RedToken);
  });

  test("child() returns RedToken for token children", () => {
    const source = SourceText.from("test", "+");
    const outer = new GreenNode({
      kind: SyntaxKind.BinaryExpression,
      children: [token(SyntaxKind.PlusToken, "+")],
    });
    const red = new RedNode(outer, undefined, 0, source, 0);

    const child = red.child(0);
    expect(child).toBeInstanceOf(RedToken);
  });
});

describe("RedToken", () => {
  test("span, kind, text, isMissing from green token", () => {
    const source = SourceText.from("test", "foo");
    const green = new GreenToken(SyntaxKind.IdentifierToken, "foo", [], [], false);
    const red = new RedToken(green, undefined, 0, source, 0);

    expect(red.kind).toBe(SyntaxKind.IdentifierToken);
    expect(red.span.start).toBe(0);
    expect(red.span.end).toBe(3);
    expect(red.text).toBe("foo");
    expect(red.isMissing).toBe(false);
  });

  test("isMissing for missing token", () => {
    const source = SourceText.from("test", "");
    const green = new GreenToken(SyntaxKind.IdentifierToken, "", [], [], true);
    const red = new RedToken(green, undefined, 0, source, 0);

    expect(red.isMissing).toBe(true);
    expect(red.span.start).toBe(0);
    expect(red.span.end).toBe(0);
  });

  test("leadingTrivia returns wrappers with correct spans", () => {
    const source = SourceText.from("test", "  foo");
    const leading = [new GreenTrivia(TriviaKind.Whitespace, "  ")];
    const green = new GreenToken(SyntaxKind.IdentifierToken, "foo", leading, [], false);
    const red = new RedToken(green, undefined, 0, source, 0);

    const trivia = red.leadingTrivia();
    expect(trivia.length).toBe(1);
    expect(trivia[0]!).toBeInstanceOf(RedTrivia);
    expect(trivia[0]!.span.start).toBe(0);
    expect(trivia[0]!.span.end).toBe(2);
    expect(trivia[0]!.text).toBe("  ");
  });

  test("trailingTrivia returns wrappers with correct spans", () => {
    const source = SourceText.from("test", "foo ");
    const trailing = [new GreenTrivia(TriviaKind.Whitespace, " ")];
    const green = new GreenToken(SyntaxKind.IdentifierToken, "foo", [], trailing, false);
    const red = new RedToken(green, undefined, 0, source, 0);

    const trivia = red.trailingTrivia();
    expect(trivia.length).toBe(1);
    expect(trivia[0]!).toBeInstanceOf(RedTrivia);
    expect(trivia[0]!.span.start).toBe(3);
    expect(trivia[0]!.span.end).toBe(4);
    expect(trivia[0]!.text).toBe(" ");
  });

  test("leadingTrivia and trailingTrivia with multiple trivia pieces", () => {
    const source = SourceText.from("test", "  foo  ");
    const leading = [
      new GreenTrivia(TriviaKind.Whitespace, " "),
      new GreenTrivia(TriviaKind.Whitespace, " "),
    ];
    const trailing = [
      new GreenTrivia(TriviaKind.Whitespace, " "),
      new GreenTrivia(TriviaKind.Whitespace, " "),
    ];
    const green = new GreenToken(SyntaxKind.IdentifierToken, "foo", leading, trailing, false);
    const red = new RedToken(green, undefined, 0, source, 0);

    const leadingT = red.leadingTrivia();
    expect(leadingT.length).toBe(2);
    expect(leadingT[0]!.span.start).toBe(0);
    expect(leadingT[0]!.span.end).toBe(1);
    expect(leadingT[1]!.span.start).toBe(1);
    expect(leadingT[1]!.span.end).toBe(2);

    const trailingT = red.trailingTrivia();
    expect(trailingT.length).toBe(2);
    expect(trailingT[0]!.span.start).toBe(5);
    expect(trailingT[0]!.span.end).toBe(6);
    expect(trailingT[1]!.span.start).toBe(6);
    expect(trailingT[1]!.span.end).toBe(7);
  });
});
