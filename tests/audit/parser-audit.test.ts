import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../src/frontend/lexer/diagnostics";
import { KeywordTable } from "../../src/frontend/lexer/keyword-table";
import { Lexer } from "../../src/frontend/lexer/lexer";
import { SourceText } from "../../src/frontend/lexer/source-text";
import { Parser } from "../../src/frontend/parser/parser";
import { SyntaxKind } from "../../src/frontend/syntax/syntax-kind";
import { kindsInTree } from "../support/frontend/syntax-tree-queries";
import { expectValidSyntaxTree } from "../support/frontend/syntax-invariants";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

function lexAndParse(sourceText: string) {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics,
  });
  const parser = new Parser();
  const source = SourceText.from("audit.wr", sourceText);
  const lexResult = lexer.lex(source);
  const result = parser.parseLexResult({
    lexResult,
    lexerDiagnostics: diagnostics.diagnostics,
  });
  return { source, result, parserDiagnostics: result.parserDiagnostics };
}

describe("parser audit", () => {
  test("1. happy.md round-trip: reconstruct matches source and ≤10 diagnostics", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const happyPath = join(dir, "../../docs/language/happy.md");
    const fileContent = readFileSync(happyPath, "utf-8");

    const lines = fileContent.split("\n");
    const codeLines: string[] = [];
    let inFence = false;
    for (const line of lines) {
      if (line.startsWith("```")) {
        inFence = !inFence;
        continue;
      }
      if (inFence) codeLines.push(line);
    }
    const code = codeLines.join("\n");

    const { source, result } = lexAndParse(code);

    expect(result.tree.reconstruct()).toBe(source.text);

    expect(result.parserDiagnostics.length).toBeLessThanOrEqual(10);
  });

  test("1b. happy.md records non-executable language rulings kept by the plan", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const happyPath = join(dir, "../../docs/language/happy.md");
    const fileContent = readFileSync(happyPath, "utf-8");

    expect(fileContent).toContain("Valid escapes are");
    expect(fileContent).toContain("`pub` is not a language keyword");
    expect(fileContent).toContain("Block locals and pattern bindings shadow outer values");
    expect(fileContent).toContain(
      "wrela does not allow recursive functions; use loops or streams instead.",
    );
    expect(fileContent).toContain("Bounded recursion is out of this plan.");
    expect(fileContent).toContain("Bitwise operators use Rust-style precedence");
    expect(fileContent).toContain("Signed integers are deferred to a future RFC");
  });

  test("2. comment-first block bodies: comment should not shred the body", () => {
    const source = `dataclass D:\n    // c\n    error: X\n`;
    const { result } = lexAndParse(source);

    expectValidSyntaxTree({
      source: result.source,
      tree: result.tree,
      allowDiagnostics: false,
    });
    expect(result.parserDiagnostics).toHaveLength(0);
  });

  test("3. multiline parameter lists", () => {
    const source = `fn f(\n    self,\n    x: A,\n):\n    return\n`;
    const { result } = lexAndParse(source);

    expect(result.parserDiagnostics).toHaveLength(0);
    expect(result.tree.reconstruct()).toBe(result.source.text);
  });

  test("4. bodyless requires with RequiresSection and no SKIPPED_TOKENS", () => {
    const source = `private platform fn g(self) -> X\n    requires:\n        max == 64\n`;
    const { result } = lexAndParse(source);

    const kinds = kindsInTree(result.tree);
    expect(kinds).toContain(SyntaxKind.RequiresSection);

    const hasSkipped = result.parserDiagnostics.some(
      (diagnostic) => diagnostic.code === "PARSE_RECOVERY_SKIPPED_TOKENS",
    );
    expect(hasSkipped).toBe(false);
    expect(result.tree.reconstruct()).toBe(result.source.text);
  });

  test("5. infinite loop check: parses in < 1 second", () => {
    const source = `validated buffer P:\n    require:\n        :\n        x < 1\n`;
    const start = performance.now();
    const { result } = lexAndParse(source);
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(1000);
    expect(result.tree.reconstruct()).toBe(result.source.text);
  });

  test("6. diagnostic positioning: missing token is reported at current token start", () => {
    const source = `fn f():\n    let b 2\n`;
    const { result } = lexAndParse(source);

    expect(result.parserDiagnostics.length).toBeGreaterThanOrEqual(1);

    const foundDiag = result.parserDiagnostics.find(
      (diagnostic) => diagnostic.code === "PARSE_EXPECTED_TOKEN",
    );
    expect(foundDiag).toBeDefined();
    expect(foundDiag!.span.start).toBe(18);
  });

  test("7. syntax files do not import from parser/", () => {
    const syntaxFiles = [
      "green-diagnostic.ts",
      "green-token.ts",
      "green-node.ts",
      "syntax-factory.ts",
      "syntax-tree.ts",
    ];
    const dir = dirname(fileURLToPath(import.meta.url));
    const syntaxDir = join(dir, "../../src/frontend/syntax");

    for (const file of syntaxFiles) {
      const fileContentLocal = readFileSync(join(syntaxDir, file), "utf-8");
      const allLines = fileContentLocal.split("\n");
      const parserImports = allLines.filter(
        (line) => line.includes("from") && line.includes("parser"),
      );
      expect(parserImports).toHaveLength(0);
    }
  });

  test("8. public barrel only exports Parser, parse types, diagnostics, ExpressionContext", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const barrelPath = join(dir, "../../src/frontend/parser/index.ts");
    const content = readFileSync(barrelPath, "utf-8");

    expect(content).toContain("export type { ExpressionContext }");
    expect(content).toContain("export type { ParseDiagnostic, ParseDiagnosticCode }");
    expect(content).toContain("export { combineDiagnostics }");
    expect(content).toContain(
      "export type { ParseInput, ParseLexResultInput, ParseResult, ParserOptions }",
    );
    expect(content).toContain("export { Parser }");

    expect(content).not.toContain("ParserContext");
    expect(content).not.toContain("ParserMark");
    expect(content).not.toContain("nodeFromMark");
  });

  test("9. sync-set constants exist in parser-recovery.ts and are used instead of inline", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const recoveryPath = join(dir, "../../src/frontend/parser/parser-recovery.ts");
    const recoveryContent = readFileSync(recoveryPath, "utf-8");

    expect(recoveryContent).toContain("export const expressionStopKinds");
    expect(recoveryContent).toContain("export const validatedBufferSectionStarterKinds");
    expect(recoveryContent).toContain("export const matchCaseBoundaryKinds");

    const parserDir = join(dir, "../../src/frontend/parser");
    const parserFiles = [
      "expression-parser.ts",
      "validated-buffer-parser.ts",
      "match-statement-parser.ts",
    ];
    for (const file of parserFiles) {
      const content = readFileSync(join(parserDir, file), "utf-8");
      expect(content).toMatch(/from ["']\.\/parser-recovery["']/);
    }
  });

  test("10. no TODO/FIXME/HACK/any type in parser source files", () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const parserDir = join(dir, "../../src/frontend/parser");
    const files = [
      "validated-buffer-parser.ts",
      "parser-recovery.ts",
      "parser-context.ts",
      "block-parser.ts",
      "match-statement-parser.ts",
      "expression-parser.ts",
      "parser-utils.ts",
      "node-claim.ts",
      "function-declaration-parser.ts",
      "statement-parser.ts",
      "validated-buffer-section-parser.ts",
      "import-declaration-parser.ts",
      "type-parser.ts",
      "index.ts",
      "parser.ts",
      "pattern-parser.ts",
      "source-file-parser.ts",
      "parser-diagnostics.ts",
      "function-signature-parser.ts",
      "image-declaration-parser.ts",
      "enum-declaration-parser.ts",
      "control-statement-parser.ts",
      "expression-statement-parser.ts",
      "class-declaration-parser.ts",
      "declaration-parser.ts",
      "edge-stream-declaration-parser.ts",
      "binding-statement-parser.ts",
    ];
    for (const file of files) {
      const fileContentLocal = readFileSync(join(parserDir, file), "utf-8");
      const allLines = fileContentLocal.split("\n");
      for (let index = 0; index < allLines.length; index++) {
        const line = allLines[index]!;
        if (line.includes("TODO") || line.includes("FIXME") || line.includes("HACK")) {
          expect(line).not.toMatch(/TODO|FIXME|HACK/);
        }
        if (/: any\b/.test(line) || /:\s+any\b/.test(line)) {
          expect(line).not.toMatch(/: any\b/);
        }
      }
    }
  });
});
