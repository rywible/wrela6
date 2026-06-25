import { expect, test } from "bun:test";
import { lowerTypedHirForTest, typedHirSummary } from "../../support/hir/typed-hir-fixtures";
import { shuffledSemanticTargetSurfaceFake } from "../../support/hir/typed-hir-fakes";
import { moduleId } from "../../../src/semantic/ids";

test("typed HIR summary is deterministic for equivalent module orderings", () => {
  const first = lowerTypedHirForTest([
    ["b.wr", "fn b() -> Never:\n    return\n"],
    ["a.wr", "fn a() -> Never:\n    return\n"],
  ]);
  const second = lowerTypedHirForTest([
    ["a.wr", "fn a() -> Never:\n    return\n"],
    ["b.wr", "fn b() -> Never:\n    return\n"],
  ]);

  expect(typedHirSummary(first)).toBe(typedHirSummary(second));
});

test("typed HIR summary is deterministic for shuffled target surface", () => {
  const sourceFiles: [string, string][] = [
    ["main.wr", "fn main() -> Never\nuefi image Boot:\n    fn main() -> Never\n"],
  ];

  const first = lowerTypedHirForTest(sourceFiles, {
    targetSurface: shuffledSemanticTargetSurfaceFake(1),
  });
  const second = lowerTypedHirForTest(sourceFiles, {
    targetSurface: shuffledSemanticTargetSurfaceFake(99),
  });

  expect(typedHirSummary(first)).toBe(typedHirSummary(second));
});

test("function body origins preserve their owning module", () => {
  const result = lowerTypedHirForTest([
    ["a.wr", "fn a() -> u32:\n    return 1\n"],
    ["b.wr", "fn b() -> u32:\n    return 2\n"],
  ]);

  const bodyExpressionOrigins = result.program.origins
    .originRecords()
    .filter((origin) => origin.ownerFunctionId !== undefined && origin.span.start === 25);

  expect(bodyExpressionOrigins.map((origin) => origin.moduleId)).toEqual([
    moduleId(0),
    moduleId(1),
  ]);
});
