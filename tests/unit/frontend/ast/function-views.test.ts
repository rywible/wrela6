import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode } from "../../../../src/frontend/ast/syntax-query";
import { FunctionDeclarationView } from "../../../../src/frontend/ast/function-views";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("FunctionDeclarationView", () => {
  test("exposes signature and modifiers", () => {
    const root = parseSourceRoot("private platform fn boot[T](consume image: Image) -> Result\n");
    const functionNode = childNode(root, SyntaxKind.FunctionDeclaration)!;
    const view = FunctionDeclarationView.from(functionNode)!;

    expect(view.nameText()).toBe("boot");
    expect(view.modifiers()).toEqual(["private", "platform"]);
    expect(view.typeParameters().map((param) => param.nameText())).toEqual(["T"]);
    expect(view.parameters()[0]!.isConsumed()).toBe(true);
    expect(view.parameters()[0]!.type()!.qualifiedNameText()).toBe("Image");
    expect(view.returnType()!.qualifiedNameText()).toBe("Result");
  });

  test("returns both bodyless and body requires sections", () => {
    const bodyless = FunctionDeclarationView.from(
      childNode(
        parseSourceRoot("fn check()\n    requires:\n        flag\n"),
        SyntaxKind.FunctionDeclaration,
      )!,
    )!;
    const withBody = FunctionDeclarationView.from(
      childNode(
        parseSourceRoot("fn check():\n    requires:\n        flag\n    flag\n"),
        SyntaxKind.FunctionDeclaration,
      )!,
    )!;

    expect(bodyless.requiresSections()).toHaveLength(1);
    expect(withBody.requiresSections()).toHaveLength(1);
  });

  test("body returns undefined for bodyless function", () => {
    const view = FunctionDeclarationView.from(
      childNode(parseSourceRoot("fn check()\n"), SyntaxKind.FunctionDeclaration)!,
    )!;

    expect(view.body()).toBeUndefined();
  });

  test("parameter view exposes name and type", () => {
    const root = parseSourceRoot("fn parse(x: U8, y: U16)\n");
    const functionNode = childNode(root, SyntaxKind.FunctionDeclaration)!;
    const view = FunctionDeclarationView.from(functionNode)!;

    expect(view.parameters()).toHaveLength(2);
    expect(view.parameters()[0]!.nameText()).toBe("x");
    expect(view.parameters()[0]!.type()!.qualifiedNameText()).toBe("U8");
    expect(view.parameters()[1]!.nameText()).toBe("y");
  });

  test("returnType returns undefined when absent", () => {
    const root = parseSourceRoot("fn run()\n");
    const functionNode = childNode(root, SyntaxKind.FunctionDeclaration)!;
    const view = FunctionDeclarationView.from(functionNode)!;

    expect(view.returnType()).toBeUndefined();
  });
});
