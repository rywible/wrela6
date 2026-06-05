import { describe, expect, test } from "bun:test";
import { ItemIndex } from "../../../../src/semantic/item-index/item-index";
import {
  collectSourceMembers,
  createSourceMemberContext,
} from "../../../../src/semantic/item-index/source-member-collector";
import { collectSourceModulesAndTopLevelItems } from "../../../../src/semantic/item-index/source-module-collector";
import { parseSingleModuleGraphForTest } from "../../../support/frontend/module-graph-test-support";
import type { SourceItemRecord } from "../../../../src/semantic/item-index/item-records";

function collectSourceIndexForTest(path: string, sourceCode: string): ItemIndex {
  const graph = parseSingleModuleGraphForTest(path, sourceCode);
  const source = collectSourceModulesAndTopLevelItems(graph.modules);
  const context = createSourceMemberContext(source);
  const records = collectSourceMembers(context);
  return new ItemIndex(records);
}

describe("source member collector", () => {
  test("collects enum cases, fields, image devices, validated-buffer fields, and parameters", () => {
    const index = collectSourceIndexForTest(
      "main.wr",
      [
        "enum Color:",
        "    Red",
        "dataclass Box[T]:",
        "    field: U8",
        "uefi image Boot:",
        "    top: ImageField",
        "    devices:",
        "        net0: NetDevice",
        "validated buffer Packet:",
        "    params:",
        "        size: U16",
        "    layout:",
        "        data: U8 @ 0 len 4",
        "fn run[U](consume packet: Packet)",
      ].join("\n") + "\n",
    );

    expect(index.items().map((item) => item.name)).toEqual([
      "Color",
      "Red",
      "Box",
      "Boot",
      "Packet",
      "run",
    ]);
    expect(index.typeParameters().map((param) => param.name)).toEqual(["T", "U"]);
    expect(index.fields().map((field) => field.role)).toEqual([
      "field",
      "field",
      "imageDevice",
      "validatedParam",
      "layoutField",
    ]);
    expect(index.parameters()[0]!.isConsumed).toBe(true);
  });

  test("nested functions inside function body are collected with parentItemId", () => {
    const index = collectSourceIndexForTest(
      "main.wr",
      "fn outer():\n    fn inner():\n        fn innermost()\n",
    );

    const items = index.items() as readonly SourceItemRecord[];
    expect(items.map((item) => item.name)).toEqual(["outer", "inner", "innermost"]);
    expect(items[1]!.parentItemId).toBe(items[0]!.id);
    expect(items[2]!.parentItemId).toBe(items[1]!.id);
  });

  test("missing names are skipped without throwing", () => {
    const index = collectSourceIndexForTest("main.wr", "fn outer():\n    fn ()\n");

    const items = index.items();
    expect(items.map((item) => item.name)).toEqual(["outer"]);
  });

  test("collects type parameters on declarations", () => {
    const index = collectSourceIndexForTest(
      "main.wr",
      "dataclass Pair[A, B]:\n    first: A\n    second: B\nfn wrap[T]()\n",
    );

    const typeParams = index.typeParameters();
    expect(typeParams.length).toBe(3);
    expect(typeParams.map((param) => param.name)).toEqual(["A", "B", "T"]);
    expect(typeParams[0]!.owner.kind).toBe("item");
    expect(typeParams[2]!.owner.kind).toBe("function");
  });
});
