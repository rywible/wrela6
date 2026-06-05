import { describe, expect, test } from "bun:test";
import { GreenNode, type GreenElement } from "../../../../src/frontend/syntax/green-node";
import { GreenToken } from "../../../../src/frontend/syntax/green-token";
import { SyntaxKind } from "../../../../src/frontend/syntax/syntax-kind";
import type { GreenDiagnostic } from "../../../../src/frontend/syntax/green-diagnostic";

function token(kind: SyntaxKind, lexeme: string): GreenToken {
  return new GreenToken(kind, lexeme, [], [], false);
}

describe("GreenNode", () => {
  test("creates a node with token children and correct width", () => {
    const children: GreenElement[] = [
      token(SyntaxKind.IdentifierToken, "foo"),
      token(SyntaxKind.PlusToken, "+"),
      token(SyntaxKind.IntegerLiteralToken, "42"),
    ];
    const node = new GreenNode({ kind: SyntaxKind.BinaryExpression, children });
    expect(node.width).toBe(6);
    expect(node.kind).toBe(SyntaxKind.BinaryExpression);
  });

  test("creates a node with zero children", () => {
    const node = new GreenNode({ kind: SyntaxKind.Block, children: [] });
    expect(node.width).toBe(0);
    expect(node.reconstruct()).toBe("");
  });

  test("nested node reconstruction equals source", () => {
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
    expect(outer.reconstruct()).toBe("x+1");
  });

  test("children are defensively copied", () => {
    const children: GreenElement[] = [token(SyntaxKind.IdentifierToken, "a")];
    const node = new GreenNode({ kind: SyntaxKind.NameExpression, children });
    children.push(token(SyntaxKind.IdentifierToken, "b"));
    expect(node.children.length).toBe(1);
    expect(node.reconstruct()).toBe("a");
  });

  test("diagnostics are defensively copied", () => {
    const inputDiagnostics: GreenDiagnostic[] = [
      {
        code: "PARSE_EXPECTED_TOKEN",
        severity: "error",
        message: "test",
        relativeStart: 0,
        relativeEnd: 1,
      },
    ];
    const node = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "x")],
      diagnostics: inputDiagnostics,
    });
    inputDiagnostics.push({
      code: "PARSE_UNEXPECTED_TOKEN",
      severity: "warning",
      message: "test2",
      relativeStart: 0,
      relativeEnd: 1,
    });
    expect(node.diagnostics.length).toBe(1);
  });

  test("rejects non-node SyntaxKind", () => {
    expect(() => {
      new GreenNode({
        kind: SyntaxKind.IdentifierToken,
        children: [],
      });
    }).toThrow("node SyntaxKind");
  });

  test("rejects negative diagnostic relativeStart", () => {
    expect(() => {
      new GreenNode({
        kind: SyntaxKind.NameExpression,
        children: [token(SyntaxKind.IdentifierToken, "x")],
        diagnostics: [
          {
            code: "PARSE_EXPECTED_TOKEN",
            severity: "error",
            message: "test",
            relativeStart: -1,
            relativeEnd: 0,
          },
        ],
      });
    }).toThrow("negative");
  });

  test("rejects diagnostic with end before start", () => {
    expect(() => {
      new GreenNode({
        kind: SyntaxKind.NameExpression,
        children: [token(SyntaxKind.IdentifierToken, "x")],
        diagnostics: [
          {
            code: "PARSE_EXPECTED_TOKEN",
            severity: "error",
            message: "test",
            relativeStart: 3,
            relativeEnd: 1,
          },
        ],
      });
    }).toThrow("before relativeStart");
  });

  test("stores diagnostics correctly", () => {
    const diagnostic: GreenDiagnostic = {
      code: "PARSE_EXPECTED_TOKEN",
      severity: "error",
      message: "Something went wrong",
      relativeStart: 0,
      relativeEnd: 1,
    };
    const node = new GreenNode({
      kind: SyntaxKind.NameExpression,
      children: [token(SyntaxKind.IdentifierToken, "x")],
      diagnostics: [diagnostic],
    });
    expect(node.diagnostics.length).toBe(1);
    const nodeDiagnostic = node.diagnostics[0]!;
    expect(nodeDiagnostic.code).toBe("PARSE_EXPECTED_TOKEN");
    expect(nodeDiagnostic.severity).toBe("error");
    expect(nodeDiagnostic.message).toBe("Something went wrong");
    expect(nodeDiagnostic.relativeStart).toBe(0);
    expect(nodeDiagnostic.relativeEnd).toBe(1);
  });
});
