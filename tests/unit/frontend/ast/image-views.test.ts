import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode } from "../../../../src/frontend/ast/syntax-query";
import { ImageDeclarationView } from "../../../../src/frontend/ast/image-views";
import { FieldDeclarationView } from "../../../../src/frontend/ast/field-views";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("image and field views", () => {
  test("separates image fields from device fields", () => {
    const root = parseSourceRoot(
      "uefi image Boot:\n    top: ImageField\n    devices:\n        net0: NetDevice\n    fn local()\n",
    );
    const imageNode = childNode(root, SyntaxKind.ImageDeclaration)!;
    const view = ImageDeclarationView.from(imageNode)!;

    expect(view.fields().map((field) => field.nameText())).toEqual(["top"]);
    expect(view.deviceFields().map((field) => field.nameText())).toEqual(["net0"]);
    expect(view.memberFunctions().map((func) => func.nameText())).toEqual(["local"]);
  });

  test("FieldDeclarationView exposes name and type", () => {
    const root = parseSourceRoot("class Box:\n    value: U8\n");
    const classNode = childNode(root, SyntaxKind.ClassDeclaration)!;
    const block = childNode(classNode, SyntaxKind.Block)!;
    const field = childNode(block, SyntaxKind.StatementList)!.child(0)!;
    const view = FieldDeclarationView.from(
      field as import("../../../../src/frontend/syntax").RedNode,
    )!;

    expect(view.nameText()).toBe("value");
    expect(view.type()!.qualifiedNameText()).toBe("U8");
  });

  test("nested fields in unrelated blocks are not collected", () => {
    const root = parseSourceRoot(
      "uefi image Boot:\n    if flag:\n        field: U8\n    top: ImageField\n",
    );
    const imageNode = childNode(root, SyntaxKind.ImageDeclaration)!;
    const view = ImageDeclarationView.from(imageNode)!;

    expect(view.fields().map((field) => field.nameText())).toEqual(["top"]);
  });
});
