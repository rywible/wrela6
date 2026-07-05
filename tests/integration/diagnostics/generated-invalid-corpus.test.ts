import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { parseModuleGraph } from "../../../src/frontend/module-graph-parser";
import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  ModulePath,
  SourceText,
} from "../../../src/frontend/lexer";
import type { Diagnostic } from "../../../src/shared/diagnostics";

interface ExpectedFixture {
  readonly sourceSection: string;
  readonly stage: "parse";
  readonly diagnostics: readonly { readonly code: string; readonly count?: number }[];
}

const generatedRoot = path.join(process.cwd(), "tests", "fixtures", "diagnostics", "generated");

describe("generated invalid language corpus", async () => {
  const fixtures = await loadGeneratedFixtures();

  test("contains generated fixtures from docs/language/invalid.md", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const fixture of fixtures) {
    test(fixture.name, async () => {
      const expected = await readExpected(fixture.directory);
      const sourceText = await readFile(path.join(fixture.directory, "input.wr"), "utf8");
      const diagnostics = parseDiagnostics(fixture.name, sourceText);

      for (const expectedDiagnostic of expected.diagnostics) {
        const actualCount = diagnostics.filter(
          (diagnostic) => diagnostic.code === expectedDiagnostic.code,
        ).length;
        expect(actualCount).toBe(expectedDiagnostic.count ?? 1);
      }
    });
  }
});

async function loadGeneratedFixtures(): Promise<
  readonly { readonly name: string; readonly directory: string }[]
> {
  const entries = await readdir(generatedRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => ({
      name: entry.name,
      directory: path.join(generatedRoot, entry.name),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

async function readExpected(directory: string): Promise<ExpectedFixture> {
  const expected = JSON.parse(await readFile(path.join(directory, "expected.json"), "utf8")) as
    | ExpectedFixture
    | undefined;
  if (expected?.stage !== "parse") {
    throw new Error(`${directory}/expected.json must declare parse stage.`);
  }
  if (!Array.isArray(expected.diagnostics) || expected.diagnostics.length === 0) {
    throw new Error(`${directory}/expected.json must declare at least one expected diagnostic.`);
  }
  return expected;
}

function parseDiagnostics(name: string, text: string): readonly Diagnostic[] {
  const source = SourceText.from(`${name}.wr`, text);
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const lexResult = lexer.lex(source);
  const parseResult = parseModuleGraph({
    graph: {
      entry: ModulePath.from(`${name}.wr`),
      modules: [
        {
          path: ModulePath.from(`${name}.wr`),
          source,
          tokens: lexResult.tokens,
          imports: [],
        },
      ],
    },
    lexerDiagnostics: diagnostics.diagnostics,
  });
  return parseResult.diagnostics;
}
