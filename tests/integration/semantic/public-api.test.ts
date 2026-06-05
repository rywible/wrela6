import { expect, test } from "bun:test";
import * as packageRoot from "../../../src";
import * as semantic from "../../../src/semantic";
import { buildItemIndex, itemId, moduleId } from "../../../src/semantic";

test("semantic namespace exports item-index API", () => {
  expect(semantic.buildItemIndex).toBeDefined();
  expect(semantic.ItemIndex).toBeDefined();
  expect(semantic.moduleId).toBeDefined();
  expect(buildItemIndex).toBeDefined();
  expect(typeof moduleId(0)).toBe("number");
  expect(typeof itemId(0)).toBe("number");
});

test("top-level package exports semantic namespace", () => {
  expect(packageRoot.semantic.buildItemIndex).toBeDefined();
});
