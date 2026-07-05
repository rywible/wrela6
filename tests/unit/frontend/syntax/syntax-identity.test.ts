import { describe, expect, test } from "bun:test";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { GreenNode } from "../../../../src/frontend/syntax/green-node";
import { GreenToken } from "../../../../src/frontend/syntax/green-token";
import { RedNode } from "../../../../src/frontend/syntax/red-node";
import { RedToken } from "../../../../src/frontend/syntax/red-token";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import { SyntaxTree } from "../../../../src/frontend/syntax/syntax-tree";
import {
  childIds,
  parentId,
  syntaxNodeId,
  syntaxTokenId,
} from "../../../../src/frontend/syntax/syntax-identity";

function token(kind: SyntaxKind, lexeme: string): GreenToken {
  return new GreenToken(kind, lexeme, [], [], false);
}

function sampleTree(): SyntaxTree {
  const left = new GreenNode({
    kind: SyntaxKind.NameExpression,
    children: [token(SyntaxKind.IdentifierToken, "x")],
  });
  const right = new GreenNode({
    kind: SyntaxKind.NameExpression,
    children: [token(SyntaxKind.IdentifierToken, "x")],
  });
  const root = new GreenNode({
    kind: SyntaxKind.BinaryExpression,
    children: [left, token(SyntaxKind.PlusToken, "+"), right],
  });
  return new SyntaxTree({ source: SourceText.from("test", "x+x"), greenRoot: root });
}

describe("syntax identity", () => {
  test("node ids are stable across repeated red traversal", () => {
    const tree = sampleTree();
    const root = tree.root();

    const firstLeft = root.child(0) as RedNode;
    const secondLeft = root.child(0) as RedNode;

    expect(firstLeft).not.toBe(secondLeft);
    expect(syntaxNodeId(firstLeft)).toBe(syntaxNodeId(secondLeft));
  });

  test("sibling nodes with the same kind and span width have distinct ids", () => {
    const root = sampleTree().root();
    const left = root.child(0) as RedNode;
    const right = root.child(2) as RedNode;

    expect(left.kind).toBe(right.kind);
    expect(left.width).toBe(right.width);
    expect(syntaxNodeId(left)).not.toBe(syntaxNodeId(right));
  });

  test("token ids are stable and sibling tokens are distinct", () => {
    const root = sampleTree().root();
    const firstPlus = root.child(1)! as RedToken;
    const secondPlus = root.child(1)! as RedToken;
    const leftName = (root.child(0) as RedNode).child(0)! as RedToken;
    const rightName = (root.child(2) as RedNode).child(0)! as RedToken;

    expect(syntaxTokenId(firstPlus)).toBe(syntaxTokenId(secondPlus));
    expect(syntaxTokenId(leftName)).not.toBe(syntaxTokenId(rightName));
  });

  test("parentId and childIds expose root-relative identities", () => {
    const root = sampleTree().root();
    const left = root.child(0) as RedNode;

    expect(parentId(left)).toBe(syntaxNodeId(root));
    expect(childIds(root)).toEqual([
      syntaxNodeId(left),
      syntaxTokenId(root.child(1)! as RedToken),
      syntaxNodeId(root.child(2) as RedNode),
    ]);
  });
});
