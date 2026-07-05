import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode, descendants } from "../../../../src/frontend/ast/syntax-query";
import {
  CallExpressionView,
  NameExpressionView,
  ObjectLiteralExpressionView,
  LiteralExpressionView,
  BinaryExpressionView,
  expressionViewFrom,
} from "../../../../src/frontend/ast/expression-views";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("expression views", () => {
  test("call expression exposes callee and named arguments", () => {
    const root = parseSourceRoot("fn main():\n    call(foo=1, 2)\n");
    const callNode = descendants(root, SyntaxKind.CallExpression)[0]!;
    const view = CallExpressionView.from(callNode)!;

    expect(NameExpressionView.from(view.callee()!.node)!.nameText()).toBe("call");
    expect(
      view
        .arguments()!
        .arguments()
        .map((argument) => argument.kind),
    ).toEqual([SyntaxKind.NamedArgument, SyntaxKind.Argument]);
  });

  test("object literal exposes fields", () => {
    const root = parseSourceRoot("fn main():\n    make({a: 1, b: 2})\n");
    const objectNode = descendants(root, SyntaxKind.ObjectLiteralExpression)[0]!;
    const view = ObjectLiteralExpressionView.from(objectNode)!;

    expect(view.fields().map((field) => field.nameText())).toEqual(["a", "b"]);
  });

  test("literal expression exposes text", () => {
    const root = parseSourceRoot("fn main():\n    42\n");
    const literalNode = descendants(root, SyntaxKind.LiteralExpression)[0]!;
    const view = LiteralExpressionView.from(literalNode)!;

    expect(view.literalText()).toBe("42");
  });

  test("string literal expression exposes cooked value", () => {
    const root = parseSourceRoot(String.raw`fn main():
    "A\x41\u{1F600}"
`);
    const literalNode = descendants(root, SyntaxKind.LiteralExpression)[0]!;
    const view = LiteralExpressionView.from(literalNode)!;

    expect(view.literalText()).toBe(String.raw`"A\x41\u{1F600}"`);
    expect(view.cookedStringValue()).toBe("AA😀");
  });

  test("name expression exposes name text", () => {
    const root = parseSourceRoot("fn main():\n    value\n");
    const nameNode = descendants(root, SyntaxKind.NameExpression)[0]!;
    const view = NameExpressionView.from(nameNode)!;

    expect(view.nameText()).toBe("value");
  });

  test("expressionViewFrom maps correct SyntaxKind", () => {
    const root = parseSourceRoot("fn main():\n    a + b\n");
    const binaryNode = descendants(root, SyntaxKind.BinaryExpression)[0]!;
    const view = expressionViewFrom(binaryNode);

    expect(view).toBeInstanceOf(BinaryExpressionView);
  });

  test("expressionViewFrom returns undefined for non-expression kinds", () => {
    const root = parseSourceRoot("class Box:\n");
    const classNode = childNode(root, SyntaxKind.ClassDeclaration)!;
    expect(expressionViewFrom(classNode)).toBeUndefined();
  });
});
