import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { CollectingDiagnosticSink } from "../../src/lexer/diagnostics";
import { ImportDiscovery } from "../../src/lexer/import-discovery";
import { KeywordTable } from "../../src/lexer/keyword-table";
import { Lexer } from "../../src/lexer/lexer";
import type { ModuleImportRequest } from "../../src/lexer/module-import-request";
import { ModulePath } from "../../src/lexer/module-path";
import { SourceText } from "../../src/lexer/source-text";

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
  const imports = new ImportDiscovery({ diagnostics }).discover({
    importer: ModulePath.from("imports.wr"),
    source,
    tokens: result.tokens,
  });

  return {
    imports: imports.map((request: ModuleImportRequest) => ({
      moduleName: request.moduleName,
      span: [request.span.start, request.span.end],
      spanText: source.slice(request.span),
    })),
    diagnostics: diagnostics.diagnostics.map((diagnostic) => diagnostic.code),
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
