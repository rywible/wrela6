import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const workspaceRoot = new URL("../..", import.meta.url).pathname;

function sourceText(path: string): string {
  return readFileSync(join(workspaceRoot, path), "utf8");
}

function monoSource(path: string): string {
  return sourceText(`src/mono/${path}`);
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
  const source = monoSource("function-instantiator.ts");

  expect(source).not.toContain("instantiateMonoFunctionBodyFromProgram");
  expect(source).not.toContain("input: InstantiateMonoFunctionBodyInput | TypedHirProgram");
  expect(source).not.toContain("0 as unknown as ImageId");
});

test("closed-boundary and body-index scans use typed visitors instead of reflective object walks", () => {
  const functionSource = monoSource("function-instantiator.ts");
  const boundarySource = monoSource("closed-boundary-checker.ts");

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

test("generic substitution uses the small checked-type transform adapter only", () => {
  expect(sourceText("src/hir/checked-type-transform.ts")).toContain("transformCheckedType");
  expect(sourceText("src/hir/checked-type-transform.ts")).toContain("transformCheckedResourceKind");
  expect(sourceText("src/hir/generic-substitution.ts")).toContain("./checked-type-transform");
});

test("mono remap map storage is centralized in the transform context adapter", () => {
  const approved = new Set([
    "src/mono/mono-transform-context.ts",
    "src/mono/function-instantiator-body.ts",
    "src/mono/function-instantiator-shell.ts",
  ]);
  const offenders = tsFilesUnder("src/mono").filter((path) => {
    if (approved.has(path)) return false;
    const source = sourceText(path);
    return (
      source.includes("new Map(remap.") ||
      source.includes("new Map(input.remap") ||
      source.includes("Map<HirLocalId") ||
      source.includes("Map<HirExpressionId") ||
      source.includes("Map<HirStatementId")
    );
  });

  expect(offenders).toEqual([]);
});

test("new recursive mono HIR traversal stays in approved cloner modules", () => {
  const approved = new Set([
    "src/mono/body-walker.ts",
    "src/mono/function-call-cloner.ts",
    "src/mono/function-expression-cloner.ts",
    "src/mono/function-place-cloner.ts",
    "src/mono/function-instantiator-body.ts",
    "src/mono/function-statement-cloner.ts",
    "src/mono/function-validation-statement-cloner.ts",
    "src/mono/mono-transform-context.ts",
  ]);
  const offenders = tsFilesUnder("src/mono").filter((path) => {
    if (approved.has(path)) return false;
    const source = sourceText(path);
    return source.includes("cloneExpression({") || source.includes("cloneBlock({");
  });

  expect(offenders).toEqual([]);
});

test("mono expression and call cloners expose context-first clone entry points", () => {
  const expressionSource = monoSource("function-expression-cloner.ts");
  const callSource = monoSource("function-call-cloner.ts");

  expect(expressionSource).toContain("export function cloneExpressionWithContext");
  expect(expressionSource).toContain("export function cloneValidationWithContext");
  expect(expressionSource).toContain("transformContext: MonoTransformContext");
  expect(expressionSource).toContain("monoTransformExpressionId(");

  expect(callSource).toContain("export function cloneCallExpressionWithContext");
  expect(callSource).toContain("export function cloneCallWithContext");
  expect(callSource).toContain("function cloneCallArgumentWithContext");
  expect(callSource).toContain("transformContext: MonoTransformContext");
});

test("mono statement cloner exposes context-first block and match-arm entry points", () => {
  const source = monoSource("function-statement-cloner.ts");

  expect(source).toContain("export function cloneBlockWithContext");
  expect(source).toContain("export function cloneMatchArmWithContext");
  expect(source).toContain("transformContext: MonoTransformContext");
  expect(source).toContain("monoTransformStatementId(");
});

test("mono place take and validation-statement cloners expose context-first entry points", () => {
  const placeSource = monoSource("function-place-cloner.ts");
  const validationSource = monoSource("function-validation-statement-cloner.ts");

  expect(placeSource).toContain("export function cloneResourcePlaceWithContext");
  expect(placeSource).toContain("function cloneTakeOperandWithContext");
  expect(placeSource).toContain("function cloneTakeKindWithContext");
  expect(placeSource).toContain("function cloneForIterationWithContext");
  expect(placeSource).toContain("transformContext: MonoTransformContext");

  expect(validationSource).toContain("export function cloneValidationMatchStatementWithContext");
  expect(validationSource).toContain("transformContext: MonoTransformContext");
});
