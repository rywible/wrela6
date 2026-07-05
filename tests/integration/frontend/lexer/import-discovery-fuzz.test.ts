import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { SourceFileView } from "../../../../src/frontend/ast/declaration-views";
import { CollectingDiagnosticSink } from "../../../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../../../src/frontend/lexer/lexer";
import { SourceText } from "../../../../src/frontend/lexer/source-text";
import { Parser } from "../../../../src/frontend/parser/parser";

interface ImportSnapshot {
  moduleName: string;
  span: readonly [number, number];
  spanText: string;
}

function discoverImports(input: string): {
  imports: ImportSnapshot[];
  diagnostics: string[];
} {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const source = SourceText.from("imports.wr", input);
  const result = lexer.lex(source);
  const parseResult = new Parser().parse({ source, tokens: result.tokens });
  const sourceFile = SourceFileView.fromRoot(parseResult.tree.root());
  const imports = sourceFile?.imports() ?? [];

  return {
    imports: imports.flatMap((declaration) => {
      const moduleName = declaration.moduleName();
      const moduleNameText = moduleName?.text();
      const moduleNameSpan = moduleName?.textSpan();
      if (moduleNameText === undefined || moduleNameSpan === undefined) return [];
      return [
        {
          moduleName: moduleNameText,
          span: [moduleNameSpan.start, moduleNameSpan.end] as const,
          spanText: source.slice(moduleNameSpan),
        },
      ];
    }),
    diagnostics: [
      ...diagnostics.diagnostics.map((diagnostic) => diagnostic.code),
      ...parseResult.parserDiagnostics.map((diagnostic) => diagnostic.code),
    ],
  };
}

const identifier = fastCheck.constantFrom("A", "Boot", "Machine", "UefiFirmware", "Packet9");
const moduleSegment = fastCheck.constantFrom("core", "uefi", "boot", "app", "drivers", "net9");

const validImportLine = fastCheck
  .tuple(
    fastCheck.array(identifier, { minLength: 1, maxLength: 4 }),
    fastCheck.array(moduleSegment, { minLength: 1, maxLength: 4 }),
  )
  .map(([names, segments]) => `use ${names.join(", ")} from ${segments.join(".")}\n`);

const malformedImportLine = fastCheck.constantFrom(
  "use\n",
  "use A,\n",
  "use A, from core.good\n",
  "use A from\n",
  "use A from core.\n",
  "use A from core extra\n",
  "use 1 from core.good\n",
);

describe("import discovery fuzz invariants", () => {
  test("discovers valid import module spans exactly", () => {
    fastCheck.assert(
      fastCheck.property(validImportLine, (input) => {
        const result = discoverImports(input);

        expect(result.diagnostics).toEqual([]);
        expect(result.imports).toHaveLength(1);
        expect(result.imports[0]!.spanText).toBe(result.imports[0]!.moduleName);
      }),
      { numRuns: 1_000, seed: 0x11af },
    );
  });

  test("is deterministic across mixed valid malformed and non-import lines", () => {
    const ordinaryLine = fastCheck.constantFrom(
      "class A:\n",
      "let value = 1\n",
      "// comment\n",
      "\n",
    );
    const line = fastCheck.oneof(validImportLine, malformedImportLine, ordinaryLine);

    fastCheck.assert(
      fastCheck.property(fastCheck.array(line, { minLength: 1, maxLength: 50 }), (lines) => {
        const input = lines.join("");
        expect(discoverImports(input)).toEqual(discoverImports(input));
      }),
      { numRuns: 2_000, seed: 0x12af },
    );
  });
});
