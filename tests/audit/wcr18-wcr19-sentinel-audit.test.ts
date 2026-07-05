import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..");

test("targeted runtime sources avoid WCR-18 neutral sentinel fallbacks", () => {
  const files = [
    "src/hir/attempt-lowerer.ts",
    "src/hir/call-lowerer.ts",
    "src/hir/call-proof-metadata.ts",
    "src/hir/expression-lowerer.ts",
    "src/hir/expression-type-diagnostics.ts",
    "src/hir/fact-lowerer.ts",
    "src/hir/layout-expression-lowerer.ts",
    "src/hir/requirement-lowerer.ts",
    "src/hir/statement-lowerer.ts",
    "src/hir/take-lowerer.ts",
    "src/hir/validation-lowerer.ts",
    "src/target/aarch64/lower/constant-materialization.ts",
  ];
  const forbidden = [
    /ownerFunctionId \?\? 0/,
    /ownerFunctionId \?\? functionId\(0\)/,
    /\?\? ""/,
    /\?\? 0n/,
    /0 as never/,
  ];
  const hits: string[] = [];

  for (const file of files) {
    const source = readFileSync(join(repoRoot, file), "utf8");
    for (const pattern of forbidden) {
      if (pattern.test(source)) hits.push(`${file}: ${pattern.source}`);
    }
  }

  expect(hits).toEqual([]);
});

test("runtime sources do not use impossible never-casts as sentinels", () => {
  const hits: string[] = [];
  for (const file of sourceFiles(join(repoRoot, "src"))) {
    const source = readFileSync(file, "utf8");
    if (!source.includes("as never")) {
      continue;
    }
    const relative = file.slice(repoRoot.length + 1);
    const lines = source.split("\n");
    for (const [index, line] of lines.entries()) {
      if (line.includes("as never")) {
        hits.push(`${relative}:${index + 1}: ${line.trim()}`);
      }
    }
  }

  expect(hits).toEqual([]);
});

function sourceFiles(root: string): readonly string[] {
  const pending = [root];
  const files: string[] = [];
  while (pending.length > 0) {
    const directory = pending.pop()!;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) {
        pending.push(path);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith(".ts")) {
        files.push(path);
      }
    }
  }
  return files.sort();
}
