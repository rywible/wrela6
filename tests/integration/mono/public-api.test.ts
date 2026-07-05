import { expect, test } from "bun:test";
import * as mono from "../../../src/mono";
import { monomorphizeWholeImage } from "../../../src/mono";

test("whole-image monomorphization is public API", () => {
  expect(typeof monomorphizeWholeImage).toBe("function");
  expect(typeof mono.monomorphizeWholeImage).toBe("function");
});

test("mono public API does not expose root seeding internals", () => {
  expect("seedMonoRootWork" in mono).toBe(false);
  expect("selectMonoImageRoot" in mono).toBe(false);
});
