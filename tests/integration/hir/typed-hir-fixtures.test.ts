import { expect, test } from "bun:test";
import { lowerTypedHirForTest, typedHirSummary } from "../../support/hir/typed-hir-fixtures";
import { shuffledSemanticTargetSurfaceFake } from "../../support/hir/typed-hir-fakes";

test("typed HIR summary is deterministic for equivalent fixture runs", () => {
  const files: [string, string][] = [["main.wr", "fn helper() -> bool:\n    return true\n"]];
  const first = lowerTypedHirForTest(files, {
    targetSurface: shuffledSemanticTargetSurfaceFake(1),
  });
  const second = lowerTypedHirForTest(files, {
    targetSurface: shuffledSemanticTargetSurfaceFake(99),
  });

  expect(typedHirSummary(first)).toBe(typedHirSummary(second));
});
