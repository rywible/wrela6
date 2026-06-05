import { describe, expect, test } from "bun:test";
import { buildItemIndex } from "../../../../src/semantic/item-index/item-index-builder";
import { buildMemberNamespace } from "../../../../src/semantic/names/member-namespace";
import type { ResolveMemberResult } from "../../../../src/semantic/names/member-namespace";
import { parseSingleModuleGraphForTest } from "../../../support/frontend/module-graph-test-support";

function buildForTest(sourceCode: string) {
  const graph = parseSingleModuleGraphForTest("main.wr", sourceCode);
  const { index } = buildItemIndex({ graph });
  return { index, memberNs: buildMemberNamespace(index) };
}

describe("member namespace", () => {
  test("field lookup resolved", () => {
    const { index, memberNs } = buildForTest("dataclass Box:\n    x: U8\n");
    const boxItem = index.items().find((item) => item.name === "Box")!;
    const result = memberNs.resolveMember({
      ownerItemId: boxItem.id,
      name: "x",
      allowedNamespaces: ["field"],
    });
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.reference.kind).toBe("field");
    }
  });

  test("image device lookup filtered by allowed namespaces", () => {
    const { index, memberNs } = buildForTest(
      "uefi image Boot:\n    top: ImageField\n    devices:\n        net0: NetDevice\n",
    );
    const bootItem = index.items().find((item) => item.name === "Boot")!;

    const fieldResult = memberNs.resolveMember({
      ownerItemId: bootItem.id,
      name: "top",
      allowedNamespaces: ["field"],
    });
    expect(fieldResult.kind).toBe("resolved");

    const deviceResult = memberNs.resolveMember({
      ownerItemId: bootItem.id,
      name: "net0",
      allowedNamespaces: ["imageDevice"],
    });
    expect(deviceResult.kind).toBe("resolved");
    if (deviceResult.kind === "resolved") {
      expect(deviceResult.reference.kind).toBe("field");
    }

    const fieldAsDevice = memberNs.resolveMember({
      ownerItemId: bootItem.id,
      name: "top",
      allowedNamespaces: ["imageDevice"],
    });
    expect(fieldAsDevice.kind).toBe("unresolved");

    const deviceAsField = memberNs.resolveMember({
      ownerItemId: bootItem.id,
      name: "net0",
      allowedNamespaces: ["field"],
    });
    expect(deviceAsField.kind).toBe("unresolved");
  });

  test("enum case resolved", () => {
    const { index, memberNs } = buildForTest("enum Color:\n    Red\n    Blue\n");
    const colorItem = index.items().find((item) => item.name === "Color")!;

    const result = memberNs.resolveMember({
      ownerItemId: colorItem.id,
      name: "Red",
      allowedNamespaces: ["enumCase"],
    });
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.reference.kind).toBe("item");
    }
  });

  test("member function resolved", () => {
    const { index, memberNs } = buildForTest("class Box:\n    fn wrap()\n");
    const boxItem = index.items().find((item) => item.name === "Box")!;

    const result = memberNs.resolveMember({
      ownerItemId: boxItem.id,
      name: "wrap",
      allowedNamespaces: ["function"],
    });
    expect(result.kind).toBe("resolved");
    if (result.kind === "resolved") {
      expect(result.reference.kind).toBe("function");
    }
  });

  test("unresolved member", () => {
    const { index, memberNs } = buildForTest("dataclass Box:\n    x: U8\n");
    const boxItem = index.items().find((item) => item.name === "Box")!;

    const result = memberNs.resolveMember({
      ownerItemId: boxItem.id,
      name: "nonexistent",
      allowedNamespaces: ["field"],
    });
    expect(result.kind).toBe("unresolved");
  });

  test("ambiguous member (field and function with same name)", () => {
    const { index, memberNs } = buildForTest("class Box:\n    name: U8\n    fn name()\n");
    const boxItem = index.items().find((item) => item.name === "Box")!;

    const result: ResolveMemberResult = memberNs.resolveMember({
      ownerItemId: boxItem.id,
      name: "name",
    });
    expect(result.kind).toBe("ambiguous");
    if (result.kind === "ambiguous") {
      expect(result.candidates).toHaveLength(2);
      expect(result.candidates[0]!.kind).toBe("field");
      expect(result.candidates[1]!.kind).toBe("function");
    }
  });
});
