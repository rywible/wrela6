import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

import { checkPolicyTextForTest } from "../../scripts/check-policy";

const FORBIDDEN_RUNTIME_IMPORT =
  /from\s+["'](?:bun|node:fs|node:path|node:os|node:process|fs|path|os|process)["']|backend\/object|backend\/verify|pe-library/;

describe("PE/COFF writer audit", () => {
  test("earlier compiler phases and target internals cannot import the PE/COFF writer", () => {
    for (const filePath of [
      "src/frontend/bad.ts",
      "src/parser/bad.ts",
      "src/layout/bad.ts",
      "src/proof/bad.ts",
      "src/proof-mir/bad.ts",
      "src/proof-check/bad.ts",
      "src/opt-ir/bad.ts",
      "src/mono/bad.ts",
      "src/linker/bad.ts",
      "src/target/aarch64/bad.ts",
    ]) {
      const violations = checkPolicyTextForTest({
        filePath,
        sourceText: 'import { parsePeCoffImage } from "../pe-coff";',
      });

      expect(violations.map((violation) => violation.message)).toContain(
        "Earlier compiler phases and target internals must not import PE/COFF writer modules.",
      );
    }
  });

  test("root barrel and tests may import the public PE/COFF API", () => {
    expect(
      checkPolicyTextForTest({
        filePath: "src/index.ts",
        sourceText: 'export * as peCoff from "./pe-coff";',
      }),
    ).toEqual([]);
    expect(
      checkPolicyTextForTest({
        filePath: "tests/unit/pe-coff/public-import.test.ts",
        sourceText: 'import { parsePeCoffImage } from "../../../src/pe-coff";',
      }),
    ).toEqual([]);
  });

  test("PE/COFF runtime files stay dependency-free", async () => {
    const filePaths = await runtimePeCoffSourceFilesForAudit();

    for (const filePath of filePaths) {
      const source = await readFile(filePath, "utf8");
      expect(source).not.toMatch(FORBIDDEN_RUNTIME_IMPORT);
    }
  });

  test("PE/COFF runtime files stay below the maintainability line cap", async () => {
    const filePaths = await runtimePeCoffSourceFilesForAudit();

    for (const filePath of filePaths) {
      const source = await readFile(filePath, "utf8");
      expect(lineCount(source)).toBeLessThan(1000);
    }
  });
});

export async function runtimePeCoffSourceFilesForAudit(): Promise<readonly string[]> {
  const filePaths: string[] = [];
  const glob = new Bun.Glob("**/*.ts");
  for await (const relativePath of glob.scan({ cwd: "src/pe-coff" })) {
    filePaths.push(`src/pe-coff/${relativePath}`);
  }
  return Object.freeze(filePaths.sort());
}

function lineCount(source: string): number {
  if (source.length === 0) return 0;
  return source.split("\n").length;
}
