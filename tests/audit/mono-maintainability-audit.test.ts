import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../..", import.meta.url).pathname;

function sourceText(path: string): string {
  return readFileSync(join(workspaceRoot, path), "utf8");
}

function tsFilesUnder(path: string): readonly string[] {
  const absolute = join(workspaceRoot, path);
  const result: string[] = [];
  for (const entry of readdirSync(absolute)) {
    const child = join(path, entry);
    const childStat = statSync(join(workspaceRoot, child));
    if (childStat.isDirectory()) {
      result.push(...tsFilesUnder(child));
    } else if (entry.endsWith(".ts")) {
      result.push(child);
    }
  }
  return result.sort();
}

test("mono runtime modules stay below the thermo-nuclear size threshold", () => {
  const oversized = tsFilesUnder("src/mono")
    .map((path) => ({ path, lines: sourceText(path).split("\n").length }))
    .filter((entry) => entry.lines > 1_000);

  expect(oversized).toEqual([]);
});

test("mono runtime does not expose whole-program test-harness body instantiation", () => {
  const source = sourceText("src/mono/function-instantiator.ts");

  expect(source).not.toContain("instantiateMonoFunctionBodyFromProgram");
  expect(source).not.toContain("input: InstantiateMonoFunctionBodyInput | TypedHirProgram");
  expect(source).not.toContain("0 as unknown as ImageId");
});

test("closed-boundary and body-index scans use typed visitors instead of reflective object walks", () => {
  const functionSource = sourceText("src/mono/function-instantiator.ts");
  const boundarySource = sourceText("src/mono/closed-boundary-checker.ts");

  expect(functionSource).not.toContain("function visit(value: unknown)");
  expect(functionSource).not.toContain("Record<string, unknown>");
  expect(boundarySource).not.toContain("scanUnknownValue");
  expect(boundarySource).not.toContain("Record<string, unknown>");
});

test("mono closure boundaries avoid cast-heavy owner/type escape hatches", () => {
  expect(sourceText("src/hir/typed-hir-builder.ts")).not.toContain(
    "owner.itemId as unknown as TypeId",
  );
});

test("mono closure policy lives outside semantic checking and HIR orchestration", () => {
  expect(sourceText("src/semantic/surface/semantic-surface-checker.ts")).not.toContain(
    "function buildConstructorKindRules",
  );
  expect(sourceText("src/hir/typed-hir-builder.ts")).not.toContain("function lowerMonoClosure");
});
