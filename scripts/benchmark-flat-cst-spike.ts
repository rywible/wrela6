import { CollectingDiagnosticSink, KeywordTable, Lexer, SourceText } from "../src/frontend/lexer";
import { Parser } from "../src/frontend/parser";

interface BenchmarkResult {
  readonly label: string;
  readonly parseMs: number;
  readonly heapMb: number;
  readonly nodeCount: number;
  readonly tokenCount: number;
  readonly diagnostics: number;
}

const targetLineCount = 100_000;
const source = SourceText.from("flat-cst-spike.wr", generatedModule(targetLineCount));

const current = measure("current CST", () => {
  const diagnosticSink = new CollectingDiagnosticSink();
  const lexResult = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: diagnosticSink,
  }).lex(source);
  const parseResult = new Parser().parseLexResult({
    lexResult,
    lexerDiagnostics: diagnosticSink.diagnostics,
  });
  return {
    tokenCount: lexResult.tokens.items.length,
    diagnostics: parseResult.diagnostics.length,
    nodeCount: countCurrentCstNodes(parseResult.tree.root()),
  };
});

const prototype = measure("flat-array prototype", () => {
  const diagnosticSink = new CollectingDiagnosticSink();
  const lexResult = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: diagnosticSink,
  }).lex(source);
  const nodes = flatPrototypeFromTokens(lexResult.tokens.items);
  return {
    tokenCount: lexResult.tokens.items.length,
    diagnostics: diagnosticSink.diagnostics.length,
    nodeCount: nodes.length,
  };
});

console.log(
  JSON.stringify(
    {
      lineCount: targetLineCount,
      sourceBytes: source.length,
      results: [current, prototype],
    },
    null,
    2,
  ),
);

function generatedModule(lines: number): string {
  if (lines % 2 !== 0) {
    throw new RangeError("flat CST spike source line count must be even.");
  }
  return Array.from(
    { length: lines / 2 },
    (_unused, index) => `fn generated_${index}() -> u32:\n    return ${index}\n`,
  ).join("");
}

function measure(
  label: string,
  run: () => {
    readonly nodeCount: number;
    readonly tokenCount: number;
    readonly diagnostics: number;
  },
): BenchmarkResult {
  const heapBefore = process.memoryUsage().heapUsed;
  const started = performance.now();
  const result = run();
  const parseMs = performance.now() - started;
  const heapAfter = process.memoryUsage().heapUsed;
  return {
    label,
    parseMs: Number(parseMs.toFixed(3)),
    heapMb: Number((Math.max(0, heapAfter - heapBefore) / 1_048_576).toFixed(3)),
    nodeCount: result.nodeCount,
    tokenCount: result.tokenCount,
    diagnostics: result.diagnostics,
  };
}

function countCurrentCstNodes(node: { children(): readonly unknown[] }): number {
  let count = 1;
  for (const child of node.children()) {
    if (typeof child === "object" && child !== null && "children" in child) {
      count += countCurrentCstNodes(child as { children(): readonly unknown[] });
    }
  }
  return count;
}

function flatPrototypeFromTokens(
  tokens: readonly { readonly kind: number; reconstruct(): string }[],
): readonly { readonly kind: number; readonly start: number; readonly end: number }[] {
  let offset = 0;
  return Object.freeze(
    tokens.map((token) => {
      const start = offset;
      offset += token.reconstruct().length;
      return Object.freeze({ kind: token.kind, start, end: offset });
    }),
  );
}
