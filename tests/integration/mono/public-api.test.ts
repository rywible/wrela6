import { expect, test } from "bun:test";
import { monomorphizeWholeImage } from "../../../src/mono";
import * as wrela from "../../../src";

test("whole-image monomorphization is public API", () => {
  expect(typeof monomorphizeWholeImage).toBe("function");
  expect(typeof wrela.mono.monomorphizeWholeImage).toBe("function");
});

test("mono public API does not expose root seeding internals", () => {
  expect("seedMonoRootWork" in wrela.mono).toBe(false);
  expect("selectMonoImageRoot" in wrela.mono).toBe(false);
});
