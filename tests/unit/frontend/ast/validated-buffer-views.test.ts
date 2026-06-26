import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode } from "../../../../src/frontend/ast/syntax-query";
import { ValidatedBufferDeclarationView } from "../../../../src/frontend/ast/validated-buffer-views";
import type { WireEndian, WireIntegerEncoding, WireScalarEncoding } from "../../../../src/shared";
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

  test("LayoutFieldView exposes contextual wire endian marker", () => {
    const root = parseSourceRoot(
      "validated buffer Packet:\n    layout:\n        size: be u16 @ 0\n",
    );
    const bufferNode = childNode(root, SyntaxKind.ValidatedBufferDeclaration)!;
    const view = ValidatedBufferDeclarationView.from(bufferNode)!;
    const field = view.layoutFields()[0]!;

    expect(field.nameText()).toBe("size");
    expect(field.type()?.qualifiedNameText()).toBe("u16");
    expect(field.wireEndian()).toBe("big");
  });

  test("LayoutFieldView returns undefined wire endian without marker", () => {
    const root = parseSourceRoot("validated buffer Packet:\n    layout:\n        data: u8 @ 0\n");
    const bufferNode = childNode(root, SyntaxKind.ValidatedBufferDeclaration)!;
    const view = ValidatedBufferDeclarationView.from(bufferNode)!;
    const field = view.layoutFields()[0]!;

    expect(field.wireEndian()).toBeUndefined();
  });

  test("LayoutFieldView exposes little-endian marker", () => {
    const root = parseSourceRoot(
      "validated buffer Packet:\n    layout:\n        size: le u16 @ 0\n",
    );
    const bufferNode = childNode(root, SyntaxKind.ValidatedBufferDeclaration)!;
    const view = ValidatedBufferDeclarationView.from(bufferNode)!;
    const field = view.layoutFields()[0]!;

    expect(field.wireEndian()).toBe("little");
  });

  test("non-layout le and be names remain ordinary identifiers", () => {
    const root = parseSourceRoot("validated buffer Packet:\n    params:\n        le: be\n");
    const bufferNode = childNode(root, SyntaxKind.ValidatedBufferDeclaration)!;
    const view = ValidatedBufferDeclarationView.from(bufferNode)!;
    const field = view.paramFields()[0]!;

    expect(field.nameText()).toBe("le");
    expect(field.type()?.qualifiedNameText()).toBe("be");
  });
});

describe("shared wire layout exports", () => {
  test("exports wire encoding model types from shared barrel", () => {
    const endian: WireEndian = "little";
    const integerEncoding: WireIntegerEncoding = {
      kind: "integer",
      endian,
      signedness: "unsigned",
      bitWidth: 16,
    };
    const scalarEncoding: WireScalarEncoding = integerEncoding;

    expect(endian).toBe("little");
    expect(integerEncoding.kind).toBe("integer");
    expect(scalarEncoding.kind).toBe("integer");
  });
});
