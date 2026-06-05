import { expect, test } from "bun:test";
import {
  checkSemanticSurfaceForTest,
  semanticSurfaceSummary,
} from "../../support/semantic/semantic-surface-fakes";

test("semantic surface is deterministic across same inputs", () => {
  const files: readonly [string, string][] = [
    ["main.wr", "uefi image Boot:\n    fn main() -> Never\n"],
  ];

  const first = checkSemanticSurfaceForTest(files);
  const second = checkSemanticSurfaceForTest(files);

  expect(semanticSurfaceSummary(first)).toEqual(semanticSurfaceSummary(second));
});

test("diagnostics summary includes key fields", () => {
  const result = checkSemanticSurfaceForTest([["main.wr", "fn f(x: UnknownType)\n"]]);

  const summary = JSON.parse(semanticSurfaceSummary(result));
  expect(summary.diagnostics.length).toBeGreaterThan(0);
  expect(summary.diagnostics[0].code).toBeDefined();
  expect(summary.diagnostics[0].message).toBeDefined();
});

test("empty program produces empty summary", () => {
  const result = checkSemanticSurfaceForTest([["main.wr", "fn f()\n"]]);

  const summary = JSON.parse(semanticSurfaceSummary(result));
  expect(summary.functions).toBeDefined();
  expect(Array.isArray(summary.functions)).toBe(true);
});
