import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode } from "../../../../src/frontend/ast/syntax-query";
import { ValidatedBufferDeclarationView } from "../../../../src/frontend/ast/validated-buffer-views";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("ValidatedBufferDeclarationView", () => {
  test("exposes section groups and flattened field records", () => {
    const root = parseSourceRoot(
      "validated buffer Packet:\n    params:\n        size: U16\n    layout:\n        data: U8 @ 0 len 4\n    derive:\n        kind: U8 from data:\n            1 => 2\n    require:\n        size > 0\n",
    );
    const bufferNode = childNode(root, SyntaxKind.ValidatedBufferDeclaration)!;
    const view = ValidatedBufferDeclarationView.from(bufferNode)!;

    expect(view.nameText()).toBe("Packet");
    expect(view.paramsSections()).toHaveLength(1);
    expect(view.layoutSections()).toHaveLength(1);
    expect(view.deriveSections()).toHaveLength(1);
    expect(view.requireSections()).toHaveLength(1);
    expect(view.paramFields().map((field) => field.nameText())).toEqual(["size"]);
    expect(view.layoutFields().map((field) => field.nameText())).toEqual(["data"]);
  });

  test("returns empty arrays when validated buffer has no body", () => {
    const root = parseSourceRoot("validated buffer Packet\n");
    const bufferNode = childNode(root, SyntaxKind.ValidatedBufferDeclaration)!;
    const view = ValidatedBufferDeclarationView.from(bufferNode)!;

    expect(view.nameText()).toBe("Packet");
    expect(view.paramsSections()).toEqual([]);
    expect(view.layoutSections()).toEqual([]);
  });
});
