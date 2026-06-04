# Lexer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Each task is atomic and includes dependencies, acceptance criteria, and code examples; track status in the execution tool.

**Goal:** Build the first compiler layer: a class-based, dependency-injected, trivia-preserving lexer plus a lightweight module graph lexer for image entry files and imported modules.

**Architecture:** The source lexer is pure compiler core: it accepts `SourceText`, emits `TokenStream`, and reports diagnostics through an injected sink. File discovery, Bun file IO, and module resolution live at the lexer module edge behind injected interfaces. Tests use Bun's built-in runner, fakes instead of mocks, and `fast-check` only as a dev/test dependency.

**Tech Stack:** TypeScript, Bun, `bun:test`, Bun file APIs at the repository edge, `fast-check` for property-based fuzz tests, `oxlint` for fast linting, `oxfmt` for fast formatting, and a small Bun policy checker for repository-specific rules.

---

## Research Notes

- Bun's built-in test runner uses `import { describe, expect, test } from "bun:test"` and runs with `bun test`. It discovers `*.test.ts` recursively and can run a specific file with `bun test ./tests/unit/source-text.test.ts`. Source: [Bun test runner](https://bun.com/docs/cli/test).
- Bun type assertions are runtime no-ops and require a separate TypeScript check. Use `bunx tsc --noEmit` or a `typecheck` script. Source: [Bun writing tests](https://bun.com/docs/test/writing-tests).
- Bun file IO should be isolated inside the production `FileRepository`: `Bun.file(path)`, `await file.exists()`, and `await file.text()`. Source: [Bun File I/O](https://bun.com/docs/api/file-io).
- `fast-check` supports Bun directly as a dev dependency via `bun add --dev fast-check`. Source: [fast-check getting started](https://fast-check.dev/docs/introduction/getting-started/).
- `fast-check` property tests use `fastCheck.assert(fastCheck.property(...), { numRuns })`. Source: [fast-check runners](https://fast-check.dev/docs/core-blocks/runners/) and [fast-check properties](https://fast-check.dev/docs/core-blocks/properties/).
- Oxlint is a high-performance JavaScript and TypeScript linter built on the Oxc compiler stack; its docs cite benchmark results around 50-100x faster than ESLint. Source: [Oxlint usage](https://oxc.rs/docs/guide/usage/linter).
- Oxlint supports committed project configuration through `.oxlintrc.json` or `oxlint.config.ts`, and supports the `id-length` rule for minimum identifier length. Sources: [Oxlint configuration](https://oxc.rs/docs/guide/usage/linter/config.html) and [Oxlint id-length](https://oxc.rs/docs/guide/usage/linter/rules/eslint/id-length.html).
- Oxfmt is the Oxc formatter for JavaScript and TypeScript; its docs cite benchmark results around 30x faster than Prettier and 2x faster than Biome. Source: [Oxfmt usage](https://oxc.rs/docs/guide/usage/formatter.html).

## Parallel Execution Map

Use this table as a topological dispatch map. Tasks in the same wave may run in parallel because all listed dependencies are already satisfied and the wave avoids shared-file edits.

| Wave | Tasks | Notes |
| --- | --- | --- |
| Bootstrap | 1 | Adds initial scripts and `fast-check`; run first so every worker has the same base commands. |
| Tooling Gate | 1A | Adds `oxlint`, `oxfmt`, and the repository policy checker; run before dispatching implementation tasks. |
| Source Foundation | 2 | `SourceSpan` and `SourceText` are prerequisites for most other files. Depends on Task 1A. |
| Independent Core | 3, 4, 6 | Diagnostics, token/trivia values, and cursor can run in parallel after Task 2. |
| Derived Core And Module Contracts | 5, 7, 14 | Token stream, keyword table, and module path/resolution contracts can run in parallel after their dependencies. |
| Parallel Implementation | 8, 13, 15 | Lexer skeleton, import discovery, and file repository touch different files and can run in parallel. |
| Source Lexer Completion | 9, 10, 11, 12 | These all modify `src/lexer/lexer.ts`; execute sequentially or assign one subagent to the whole source lexer chain. |
| Test Support | 17 | Run after Task 15 and the lexer skeleton. Shared fakes and invariants support graph, fuzz, and system tests. |
| Graph Traversal And Source Fuzz | 16, 18 | Task 16 depends on the completed lexer and fakes. Source fuzz can run in parallel with graph traversal. |
| Graph Fuzz | 19 | Run after Task 16 and Task 17. |
| Public API Assembly | 20 | Single writer for `src/lexer/index.ts` and `src/index.ts`; prevents parallel barrel merge conflicts. |
| System Smoke | 21 | Run after the public API barrel exists. |
| Final Hardening | 22 | Run after Task 1A and all implementation tasks. |

## File Responsibility Map

Create or modify these files.

```text
package.json
  Adds Bun test, typecheck, format, lint, policy, and agent gate scripts plus dev-only tooling dependencies.

.oxlintrc.json
  Oxlint project configuration, including the descriptive identifier rule.

scripts/check-policy.ts
  Bun policy checker for project-specific architectural rules that do not belong in source code.

src/index.ts
  Top-level compiler package API. Re-export lexer public API in Task 20.

src/lexer/index.ts
  Public API barrel for the lexer module, assembled in Task 20.

src/lexer/source-span.ts
  Immutable half-open source ranges.

src/lexer/source-text.ts
  Immutable source text, logical source identity, and offset-to-position helpers.

src/lexer/diagnostics.ts
  Diagnostic contracts and in-memory diagnostic sink for tests and integration.

src/lexer/trivia-kind.ts
  Trivia vocabulary.

src/lexer/trivia.ts
  Immutable trivia value object.

src/lexer/token-kind.ts
  Token vocabulary.

src/lexer/token.ts
  Immutable token value object.

src/lexer/token-stream.ts
  Immutable token sequence with EOF and reconstruction helpers.

src/lexer/cursor.ts
  Forward-only scanner cursor over SourceText.

src/lexer/keyword-table.ts
  Keyword lookup table and default language keyword set.

src/lexer/lexer.ts
  Root Lexer class and LexResult.

src/lexer/import-discovery.ts
  Lightweight `use ... from ...` scanner over public tokens.

src/lexer/module-path.ts
  Normalized module identity.

src/lexer/module-import-request.ts
  Shared import request contract used by ImportDiscovery and ModuleResolver.

src/lexer/module-resolver.ts
  Module resolver interface and dotted-name resolver.

src/lexer/file-repository.ts
  File repository interface and read result contracts.

src/lexer/bun-file-repository.ts
  Production Bun-backed FileRepository.

src/lexer/module-graph-lexer.ts
  Image entry/module graph lexing coordinator.

tests/support/lexer-fakes.ts
  Shared fakes for diagnostics, files, resolver, and lexer construction.

tests/support/lexer-invariants.ts
  Shared token-stream, diagnostic, layout, and reconstruction invariant assertions.

tests/unit/*.test.ts
  Unit tests for focused lexer classes.

tests/integration/*.test.ts
  Public API integration tests and fuzz tests.

tests/system/front-end.test.ts
  Public workflow smoke test for image entry lexing.
```

## Shared Contract Decisions

Every task must use these names and shapes so independently implemented pieces compose cleanly.

### Source Positions

```ts
interface SourcePosition {
  offset: number;
  line: number;   // 1-based
  column: number; // 1-based UTF-16 code-unit column
}
```

### Diagnostics

```ts
type DiagnosticSeverity = "error" | "warning";

type LexDiagnosticCode =
  | "LEX_INVALID_CHARACTER"
  | "LEX_UNTERMINATED_STRING"
  | "LEX_INCONSISTENT_INDENT"
  | "LEX_IMPORT_MALFORMED"
  | "LEX_MODULE_MISSING"
  | "LEX_MODULE_UNREADABLE"
  | "LEX_MODULE_UNRESOLVED"
  | "LEX_IMPORT_CYCLE";

interface LexDiagnostic {
  code: LexDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  source: SourceText;
  span: SourceSpan;
}

interface DiagnosticSink {
  report(diagnostic: LexDiagnostic): void;
}
```

### Token Vocabulary

Token names are stable compiler vocabulary. Use enum member names exactly as shown.

```ts
enum TokenKind {
  Eof,
  Newline,
  Indent,
  Dedent,
  Identifier,
  IntegerLiteral,
  StringLiteral,
  Invalid,

  Use,
  From,
  Uefi,
  Image,
  Devices,
  Unique,
  Edge,
  Class,
  Dataclass,
  Validated,
  Buffer,
  Stream,
  Contains,
  Bound,
  Enum,
  Interface,
  Constructor,
  Fn,
  Private,
  Platform,
  Terminal,
  Predicate,
  Requires,
  Consume,
  Params,
  Layout,
  Derive,
  Require,
  At,
  Len,
  Else,
  Otherwise,
  Let,
  If,
  Not,
  While,
  For,
  In,
  Loop,
  Match,
  Case,
  Return,
  Yield,
  Take,
  As,
  With,

  LeftParen,
  RightParen,
  LeftBrace,
  RightBrace,
  LeftBracket,
  RightBracket,
  Colon,
  Comma,
  Dot,
  Equals,
  Plus,
  Minus,
  Star,
  Slash,
  Percent,
  Less,
  Greater,
  Question,
  Arrow,
  FatArrow,
  EqualsEquals,
  BangEquals,
  LessEquals,
  GreaterEquals,
}
```

`Ok`, `Err`, `Some`, `None`, `Result`, `Option`, `Never`, `List`, `Map`, `MoveRing`, and user-defined type names lex as `Identifier`.

### Trivia Vocabulary

```ts
enum TriviaKind {
  Whitespace,
  IndentationWhitespace,
  LineComment,
  BlockComment,
  Newline,
  Skipped,
}
```

Block comments are vocabulary only in this implementation. The lexer does not need to recognize block comments until the language adds them.

Newline trivia is reserved vocabulary in the first implementation. Physical line breaks are emitted as `TokenKind.Newline`, not `TriviaKind.Newline`, including blank lines and comment-only lines. `TriviaKind.Newline` must not be emitted until a later design explicitly needs newline trivia inside a larger trivia construct such as a future block comment.

### Token Reconstruction

`TokenStream.reconstruct()` must reproduce the input exactly.

```ts
function reconstruct(tokens: readonly Token[]): string {
  return tokens
    .map((token) =>
      token.leadingTrivia.map((trivia) => trivia.lexeme).join("") +
      token.lexeme +
      token.trailingTrivia.map((trivia) => trivia.lexeme).join(""),
    )
    .join("");
}
```

`Eof` has an empty lexeme and may carry trailing source trivia through its leading trivia.

### Layout Span And Trivia Contract

Source text must be represented exactly once across token lexemes and trivia lexemes.

Layout token rules:

- `Newline` is a real token. Its lexeme is the exact physical line break: `\n` or `\r\n`.
- `Indent` and `Dedent` are layout tokens with empty lexemes.
- `Indent` and `Dedent` spans are zero-width at the offset of the first non-layout token on the logical line.
- Final EOF `Dedent` tokens are zero-width at `source.length`.
- Indentation whitespace is leading trivia on the first emitted layout token for a logical line. If the line emits no layout token, it is leading trivia on the first non-layout token.
- When a line emits multiple `Dedent` tokens, only the first `Dedent` owns that line's indentation trivia.
- Token spans exclude trivia spans. Trivia attaches to a token but is not part of that token's `span`.
- Zero-width layout tokens may share an offset with neighboring tokens. Non-layout, non-EOF tokens must have `span.end > span.start`.
- Invalid tokens must make progress and preserve the invalid source text in their lexeme.

### Indentation Algorithm

Indentation is four-space based.

- Only spaces count as indentation. A tab in leading indentation reports `LEX_INCONSISTENT_INDENT`, is preserved as indentation trivia, and is counted as four columns for deterministic recovery.
- A valid indentation width is a multiple of four spaces.
- The indentation stack starts as `[0]` and stores column widths.
- Blank lines and comment-only lines emit their `Newline` token but do not compare against or mutate the indentation stack.
- For each non-blank logical line, scan the leading indentation prefix before the first non-layout token.
- If the measured indentation width is not a multiple of four, report `LEX_INCONSISTENT_INDENT` over the indentation prefix.
- Recovery canonicalizes an invalid indentation width to the greatest existing stack level less than or equal to the measured width. If none exists, recover to `0`.
- If the canonical width is greater than the current stack top, emit one `Indent` and push the canonical width.
- If the canonical width equals the current stack top, emit no layout token.
- If the canonical width is less than the current stack top and exists in the stack, emit `Dedent` tokens until the top equals that width.
- If the canonical width is less than the current stack top and does not exist in the stack, report `LEX_INCONSISTENT_INDENT`, recover to the greatest existing stack level less than the measured width, and emit `Dedent` tokens to that recovered level.
- EOF emits remaining `Dedent` tokens until the stack is `[0]`, then emits `Eof`.

Example recovery:

```wr
image Main:
    a
  b
```

The third line has two spaces. The lexer reports `LEX_INCONSISTENT_INDENT`, recovers to stack level `0`, emits one `Dedent`, preserves the two spaces as leading indentation trivia on that `Dedent`, then emits `Identifier("b")`.

### Lexer Public Use

```ts
const diagnostics = new CollectingDiagnosticSink();
const keywords = KeywordTable.default();
const lexer = new Lexer({ keywords, diagnostics });
const result = lexer.lex(SourceText.from("app/main.wr", "uefi image Main:\n"));
```

### Module Graph Public Use

```ts
const moduleLexer = new ModuleGraphLexer({
  lexer,
  files,
  resolver,
  imports,
  diagnostics,
});

const result = await moduleLexer.lexImage({
  entry: ModulePath.from("app/main.wr"),
});
```

### Tooling And Naming Policy

Runtime source remains dependency-free. Tooling dependencies are dev-only and stay in `package.json` `devDependencies`.

Use descriptive identifiers everywhere. The linter and policy checker reject abbreviated names so compiler code reads like compiler prose:

- Use `source`, not `src`.
- Use `diagnostic` or `diagnostics`, not `diag` or `diags`.
- Use `token` or `tokens`, not `tok` or `toks`.
- Use `result`, not `res`.
- Use `context`, not `ctx`.
- Use `repository`, not `repo`.
- Use `position`, not `pos`.
- Use `implementation`, not `impl`.
- Use `options`, not `opts`.
- Use `error`, not `err`.
- Use `fastCheck`, not `fc`.
- Use `index`, `lineIndex`, or `columnIndex`, not one-letter loop names.

Oxlint's `id-length` rule enforces a minimum identifier length. The project policy checker enforces the domain-specific abbreviation denylist, fakes-over-mocks, test-only `fast-check`, and filesystem-at-the-edge rules.

## Task 1: Add Test Scripts And Fuzz Dependency

**Dependencies:** None.

**Description:** Add the initial test/typecheck scripts and `fast-check` as a dev-only dependency. Task 1A expands the agent gate with formatting, linting, and policy checks. Keep runtime source dependency-free except Bun/TypeScript standard APIs.

**Files:**

- Verify or modify: `agents.md`
- Modify: `package.json`
- Modify: `bun.lock`

**Acceptance Criteria:**

- `package.json` has scripts for all tests, unit tests, integration tests, system tests, typechecking, and an initial agent gate.
- `agents.md` exists at the repository root with lightweight handoff instructions.
- `bun run agent:check` runs typecheck plus the test suite until Task 1A expands it.
- `fast-check` is in `devDependencies`, not `dependencies`.
- No source file imports `fast-check`.
- `bun run typecheck` runs TypeScript with no emit.
- `bun test ./tests/unit`, `bun test ./tests/integration`, and `bun test ./tests/system` are valid commands.

**Code Examples:**

Merge these keys into `package.json`; do not replace unrelated existing fields such as `name`, `module`, `type`, or `private`:

```json
{
  "scripts": {
    "agent:check": "bun run typecheck && bun test",
    "test": "bun test",
    "test:unit": "bun test ./tests/unit",
    "test:integration": "bun test ./tests/integration",
    "test:system": "bun test ./tests/system",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "fast-check": "latest",
    "typescript": "^5"
  }
}
```

Target `agents.md` shape:

```md
# Agent Notes

- Run `bun run agent:check` before handing work back.
- Use narrower commands like `bun test ./tests/unit/cursor.test.ts` while iterating.
- Keep runtime source dependency-free; `fast-check` is for tests only.
- Use fakes through dependency injection. Do not use mocks.
- Keep filesystem access at compiler edges.
```

Commands:

```bash
bun add --dev fast-check typescript
bun run agent:check
```

Expected result after this task:

```text
bun run agent:check exits 0
```

Commit:

```bash
git add agents.md package.json bun.lock
git commit -m "chore: add lexer test tooling -Codex Automated"
```

## Task 1A: Add Oxc Formatting, Linting, And Policy Checks

**Dependencies:** Task 1.

**Description:** Add the fast Oxc developer tooling pass and a small repository policy checker. `oxfmt` handles formatting, `oxlint` handles fast JavaScript/TypeScript linting, and `scripts/check-policy.ts` enforces project-specific rules that should not leak into production source. This task expands `bun run agent:check` into the full handoff gate used by every later task.

**Files:**

- Create: `.oxlintrc.json`
- Create: `scripts/check-policy.ts`
- Modify: `agents.md`
- Modify: `package.json`
- Modify: `bun.lock`

**Acceptance Criteria:**

- `oxlint` and `oxfmt` are in `devDependencies`, not `dependencies`.
- `package.json` has `format`, `format:check`, `lint`, `policy:check`, and full `agent:check` scripts.
- `bun run agent:check` runs typecheck, format check, oxlint, policy check, and the full Bun test suite.
- `.oxlintrc.json` enables `id-length` with a minimum of three characters and no identifier exceptions.
- One-letter loop variables and aliases such as `fc` fail lint; use `index`, `lineIndex`, `columnIndex`, and `fastCheck`.
- `scripts/check-policy.ts` rejects project-specific abbreviations: `src`, `diag`, `diags`, `tok`, `toks`, `res`, `ctx`, `opts`, `repo`, `impl`, `pos`, `err`, and `fc`.
- `scripts/check-policy.ts` rejects `fast-check` imports outside `tests`.
- `scripts/check-policy.ts` rejects mocks and spies in tests.
- `scripts/check-policy.ts` rejects `Bun.file` outside `src/lexer/bun-file-repository.ts` and itself.
- `agents.md` tells agents to run `bun run agent:check` before handoff and to prefer descriptive names.

**Code Examples:**

Merge these keys into `package.json`; keep unrelated existing fields intact:

```json
{
  "scripts": {
    "agent:check": "bun run typecheck && bun run format:check && bun run lint && bun run policy:check && bun test",
    "format": "oxfmt .",
    "format:check": "oxfmt --check .",
    "lint": "oxlint .",
    "policy:check": "bun scripts/check-policy.ts",
    "test": "bun test",
    "test:unit": "bun test ./tests/unit",
    "test:integration": "bun test ./tests/integration",
    "test:system": "bun test ./tests/system",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@types/bun": "latest",
    "fast-check": "latest",
    "oxfmt": "latest",
    "oxlint": "latest",
    "typescript": "^5"
  }
}
```

Target `.oxlintrc.json` shape:

```json
{
  "rules": {
    "id-length": [
      "error",
      {
        "min": 3,
        "properties": "never",
        "exceptions": [],
        "exceptionPatterns": []
      }
    ],
    "prefer-const": "error",
    "eqeqeq": "error"
  }
}
```

Target `scripts/check-policy.ts` shape:

```ts
import * as typescript from "typescript";

interface PolicyViolation {
  filePath: string;
  line: number;
  column: number;
  message: string;
}

const policyScriptPath = "scripts/check-policy.ts";
const checkedRoots = ["src", "tests", "scripts"] as const;
const allowedBunFilePaths = new Set([
  "src/lexer/bun-file-repository.ts",
  policyScriptPath,
]);

const bannedIdentifierSuggestions = new Map<string, string>([
  ["src", "source"],
  ["diag", "diagnostic"],
  ["diags", "diagnostics"],
  ["tok", "token"],
  ["toks", "tokens"],
  ["res", "result"],
  ["ctx", "context"],
  ["opts", "options"],
  ["repo", "repository"],
  ["impl", "implementation"],
  ["pos", "position"],
  ["err", "error"],
  ["fc", "fastCheck"],
]);

async function collectTypeScriptFiles(rootDirectory: string): Promise<string[]> {
  const files: string[] = [];
  const glob = new Bun.Glob("**/*.ts");

  for await (const relativePath of glob.scan({ cwd: rootDirectory })) {
    files.push(`${rootDirectory}/${relativePath}`);
  }

  return files;
}

async function readText(filePath: string): Promise<string> {
  return await Bun.file(filePath).text();
}

function normalizePath(filePath: string): string {
  return filePath.replaceAll("\\", "/");
}

function locationOf(
  sourceFile: typescript.SourceFile,
  offset: number,
): { line: number; column: number } {
  const location = sourceFile.getLineAndCharacterOfPosition(offset);

  return {
    line: location.line + 1,
    column: location.character + 1,
  };
}

function isPropertyNameIdentifier(identifier: typescript.Identifier): boolean {
  const parent = identifier.parent;

  return (
    typescript.isPropertyAccessExpression(parent) && parent.name === identifier
  ) || (
    typescript.isPropertyAssignment(parent) && parent.name === identifier
  ) || (
    typescript.isMethodDeclaration(parent) && parent.name === identifier
  ) || (
    typescript.isPropertyDeclaration(parent) && parent.name === identifier
  );
}

function checkIdentifiers(
  filePath: string,
  sourceText: string,
): PolicyViolation[] {
  const sourceFile = typescript.createSourceFile(
    filePath,
    sourceText,
    typescript.ScriptTarget.Latest,
    true,
    typescript.ScriptKind.TS,
  );
  const violations: PolicyViolation[] = [];

  function visit(syntaxNode: typescript.Node): void {
    if (
      typescript.isIdentifier(syntaxNode) &&
      !isPropertyNameIdentifier(syntaxNode)
    ) {
      const suggestion = bannedIdentifierSuggestions.get(syntaxNode.text);

      if (suggestion !== undefined) {
        const location = locationOf(sourceFile, syntaxNode.getStart(sourceFile));
        violations.push({
          filePath,
          line: location.line,
          column: location.column,
          message: `Use "${suggestion}" instead of shortened name "${syntaxNode.text}".`,
        });
      }
    }

    typescript.forEachChild(syntaxNode, visit);
  }

  visit(sourceFile);
  return violations;
}

function checkTextPolicies(
  filePath: string,
  sourceText: string,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const normalizedPath = normalizePath(filePath);

  if (
    !normalizedPath.startsWith("tests/") &&
    /from\s+["']fast-check["']/.test(sourceText)
  ) {
    violations.push({
      filePath,
      line: 1,
      column: 1,
      message: "fast-check is test-only and must not be imported outside tests.",
    });
  }

  if (
    normalizedPath.startsWith("tests/") &&
    /\b(mock|spyOn|jest\.fn)\b/.test(sourceText)
  ) {
    violations.push({
      filePath,
      line: 1,
      column: 1,
      message: "Use fakes through dependency injection. Do not use mocks or spies.",
    });
  }

  if (
    /\bBun\.file\s*\(/.test(sourceText) &&
    !allowedBunFilePaths.has(normalizedPath)
  ) {
    violations.push({
      filePath,
      line: 1,
      column: 1,
      message: "Bun.file is only allowed at the file repository edge.",
    });
  }

  return violations;
}

async function main(): Promise<void> {
  const files = (
    await Promise.all(checkedRoots.map((root) => collectTypeScriptFiles(root)))
  ).flat();
  const violations: PolicyViolation[] = [];

  for (const filePath of files) {
    const sourceText = await readText(filePath);
    violations.push(...checkIdentifiers(filePath, sourceText));
    violations.push(...checkTextPolicies(filePath, sourceText));
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      console.error(
        `${violation.filePath}:${violation.line}:${violation.column} ${violation.message}`,
      );
    }

    process.exit(1);
  }
}

await main();
```

Target `agents.md` additions:

```md
- Run `bun run format` before large handoffs when formatting changed.
- Keep names descriptive. Prefer `source`, `diagnostics`, `token`, `result`, and `context` over shortened names.
```

Commands:

```bash
bun add --dev oxlint oxfmt
bun run format:check
bun run lint
bun run policy:check
bun run agent:check
```

Expected result after this task:

```text
bun run format:check exits 0
bun run lint exits 0
bun run policy:check exits 0
bun run agent:check exits 0
```

Commit:

```bash
git add .oxlintrc.json agents.md package.json bun.lock scripts/check-policy.ts
git commit -m "chore: add fast lint format and policy tooling -Codex Automated"
```

## Task 2: Implement SourceSpan And SourceText

**Dependencies:** Task 1A.

**Description:** Add immutable source primitives. `SourceSpan` represents half-open ranges. `SourceText` owns logical source identity and offset-to-line/column lookup.

**Files:**

- Create: `src/lexer/source-span.ts`
- Create: `src/lexer/source-text.ts`
- Create: `tests/unit/source-text.test.ts`

**Acceptance Criteria:**

- `SourceSpan.from(start, end)` rejects negative offsets and `end < start`.
- `SourceSpan.length` returns `end - start`.
- `SourceText.from(name, text)` stores `name`, `text`, and `length`.
- `SourceText.charAt(offset)` returns `undefined` out of bounds.
- `SourceText.slice(span)` returns the exact source substring for valid spans.
- `SourceText.positionAt(offset)` returns 1-based line and column.
- `SourceText.span(start, end)` returns a `SourceSpan`.
- Handles `\n`, `\r\n`, and final lines without trailing newline.

**Code Examples:**

Unit test examples:

```ts
import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../src/lexer/source-span";
import { SourceText } from "../../src/lexer/source-text";

describe("SourceText", () => {
  test("reads characters and slices spans", () => {
    const source = SourceText.from("app/main.wr", "one\ntwo");
    const span = SourceSpan.from(4, 7);

    expect(source.name).toBe("app/main.wr");
    expect(source.length).toBe(7);
    expect(source.charAt(4)).toBe("t");
    expect(source.slice(span)).toBe("two");
  });

  test("reports 1-based line and column", () => {
    const source = SourceText.from("app/main.wr", "one\r\ntwo\nthree");

    expect(source.positionAt(0)).toEqual({ offset: 0, line: 1, column: 1 });
    expect(source.positionAt(5)).toEqual({ offset: 5, line: 2, column: 1 });
    expect(source.positionAt(source.length)).toEqual({
      offset: source.length,
      line: 3,
      column: 6,
    });
  });
});
```

Expected public API:

```ts
const source = SourceText.from("fuzz.wr", input);
const span = source.span(0, source.length);
const wholeText = source.slice(span);
```

Commit:

```bash
git add src/lexer/source-span.ts src/lexer/source-text.ts tests/unit/source-text.test.ts
git commit -m "feat: add lexer source text primitives -Codex Automated"
```

## Task 3: Implement Diagnostics Contracts

**Dependencies:** Task 1A, Task 2.

**Description:** Add diagnostic types and a simple collecting sink. The collecting sink is real behavior, not a mock; it is useful in tests and integration examples.

**Files:**

- Create: `src/lexer/diagnostics.ts`
- Create: `tests/unit/diagnostics.test.ts`

**Acceptance Criteria:**

- Exports `DiagnosticSink`, `LexDiagnostic`, `LexDiagnosticCode`, `DiagnosticSeverity`, and `CollectingDiagnosticSink`.
- `CollectingDiagnosticSink.report` appends diagnostics in order.
- `CollectingDiagnosticSink.diagnostics` is read-only to callers.
- Diagnostics always include `code`, `severity`, `message`, `source`, and `span`.
- Tests verify capture order and source/span preservation.

**Code Examples:**

Unit test examples:

```ts
import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../src/lexer/diagnostics";
import { SourceText } from "../../src/lexer/source-text";

describe("CollectingDiagnosticSink", () => {
  test("captures diagnostics in report order", () => {
    const source = SourceText.from("bad.wr", "@");
    const diagnostics = new CollectingDiagnosticSink();

    diagnostics.report({
      code: "LEX_INVALID_CHARACTER",
      severity: "error",
      message: "Invalid character '@'.",
      source,
      span: source.span(0, 1),
    });

    expect(diagnostics.diagnostics).toHaveLength(1);
    expect(diagnostics.diagnostics[0]?.code).toBe("LEX_INVALID_CHARACTER");
    expect(diagnostics.diagnostics[0]?.span.start).toBe(0);
  });
});
```

Expected contract:

```ts
interface DiagnosticSink {
  report(diagnostic: LexDiagnostic): void;
}
```

Commit:

```bash
git add src/lexer/diagnostics.ts tests/unit/diagnostics.test.ts
git commit -m "feat: add lexer diagnostics contracts -Codex Automated"
```

## Task 4: Implement Token And Trivia Value Objects

**Dependencies:** Task 1A, Task 2.

**Description:** Add token/trivia vocabulary and immutable value objects. These are compiler public vocabulary and should not depend on `Lexer`.

**Files:**

- Create: `src/lexer/token-kind.ts`
- Create: `src/lexer/trivia-kind.ts`
- Create: `src/lexer/trivia.ts`
- Create: `src/lexer/token.ts`
- Create: `tests/unit/token.test.ts`
- Create: `tests/unit/trivia.test.ts`

**Acceptance Criteria:**

- `TokenKind` includes every token listed in Shared Contract Decisions.
- `TriviaKind` includes every trivia kind listed in Shared Contract Decisions.
- `Trivia` stores `kind`, `lexeme`, and `span`.
- `Token` stores `kind`, `lexeme`, `span`, `leadingTrivia`, and `trailingTrivia`.
- Constructor copies trivia arrays so callers cannot mutate stored token trivia.
- `Token.reconstruct()` returns leading trivia + token lexeme + trailing trivia.
- `Trivia.reconstruct()` returns its lexeme.

**Code Examples:**

Unit test examples:

```ts
import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../src/lexer/source-span";
import { Token } from "../../src/lexer/token";
import { TokenKind } from "../../src/lexer/token-kind";
import { Trivia } from "../../src/lexer/trivia";
import { TriviaKind } from "../../src/lexer/trivia-kind";

describe("Token", () => {
  test("reconstructs leading trivia, lexeme, and trailing trivia", () => {
    const leading = [
      new Trivia({
        kind: TriviaKind.Whitespace,
        lexeme: "  ",
        span: SourceSpan.from(0, 2),
      }),
    ];

    const token = new Token({
      kind: TokenKind.Identifier,
      lexeme: "name",
      span: SourceSpan.from(2, 6),
      leadingTrivia: leading,
      trailingTrivia: [],
    });

    leading.pop();

    expect(token.reconstruct()).toBe("  name");
    expect(token.leadingTrivia).toHaveLength(1);
  });
});
```

Expected construction:

```ts
const token = new Token({
  kind: TokenKind.Identifier,
  lexeme: "HelloWorld",
  span: SourceSpan.from(11, 21),
  leadingTrivia: [],
  trailingTrivia: [],
});
```

Commit:

```bash
git add src/lexer/token-kind.ts src/lexer/trivia-kind.ts src/lexer/trivia.ts src/lexer/token.ts tests/unit/token.test.ts tests/unit/trivia.test.ts
git commit -m "feat: add lexer token and trivia values -Codex Automated"
```

## Task 5: Implement TokenStream

**Dependencies:** Task 2, Task 4.

**Description:** Add immutable token stream behavior with EOF enforcement and reconstruction helpers.

**Files:**

- Create: `src/lexer/token-stream.ts`
- Create: `tests/unit/token-stream.test.ts`

**Acceptance Criteria:**

- `TokenStream.from(tokens)` rejects streams without exactly one `Eof`.
- `TokenStream.from(tokens)` rejects any token after `Eof`.
- `TokenStream.items` exposes a read-only copy.
- `TokenStream.at(index)` returns `Token | undefined`.
- `TokenStream.eof()` returns the EOF token.
- `TokenStream.eofCount()` returns `1` for valid streams.
- `TokenStream.reconstruct()` reproduces all token/trivia text.
- `TokenStream.kinds()` returns token kinds in order for readable tests.

**Code Examples:**

Unit test examples:

```ts
import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../src/lexer/source-span";
import { Token } from "../../src/lexer/token";
import { TokenKind } from "../../src/lexer/token-kind";
import { TokenStream } from "../../src/lexer/token-stream";

describe("TokenStream", () => {
  test("requires exactly one EOF at the end", () => {
    const stream = TokenStream.from([
      new Token({
        kind: TokenKind.Identifier,
        lexeme: "image",
        span: SourceSpan.from(0, 5),
        leadingTrivia: [],
        trailingTrivia: [],
      }),
      new Token({
        kind: TokenKind.Eof,
        lexeme: "",
        span: SourceSpan.from(5, 5),
        leadingTrivia: [],
        trailingTrivia: [],
      }),
    ]);

    expect(stream.eofCount()).toBe(1);
    expect(stream.kinds()).toEqual([TokenKind.Identifier, TokenKind.Eof]);
  });
});
```

Expected reconstruction example:

```ts
expect(result.tokens.reconstruct()).toBe(source.text);
```

Commit:

```bash
git add src/lexer/token-stream.ts tests/unit/token-stream.test.ts
git commit -m "feat: add lexer token stream -Codex Automated"
```

## Task 6: Implement Cursor

**Dependencies:** Task 2.

**Description:** Add a small forward-only cursor over `SourceText`. The cursor moves through source text but does not classify language tokens.

**Files:**

- Create: `src/lexer/cursor.ts`
- Create: `tests/unit/cursor.test.ts`

**Acceptance Criteria:**

- `Cursor` starts at offset `0`.
- `cursor.isAtEnd()` is true only at or past source length.
- `cursor.peek()` returns current code unit or `undefined`.
- `cursor.peek(offset)` can look ahead without advancing.
- `cursor.advance()` advances one code unit and returns the consumed character.
- `cursor.advanceBy(count)` advances multiple code units and rejects negative counts.
- Advancing past end clamps at source length.
- `cursor.spanFrom(start)` returns a half-open span from `start` to current offset.
- Cursor never moves backward.

**Code Examples:**

Unit test examples:

```ts
import { describe, expect, test } from "bun:test";
import { Cursor } from "../../src/lexer/cursor";
import { SourceText } from "../../src/lexer/source-text";

describe("Cursor", () => {
  test("peeks and advances through source", () => {
    const cursor = new Cursor(SourceText.from("main.wr", "abc"));

    expect(cursor.offset).toBe(0);
    expect(cursor.peek()).toBe("a");
    expect(cursor.peek(2)).toBe("c");
    expect(cursor.advance()).toBe("a");
    expect(cursor.offset).toBe(1);
  });

  test("clamps at end", () => {
    const cursor = new Cursor(SourceText.from("main.wr", "a"));

    cursor.advanceBy(99);

    expect(cursor.offset).toBe(1);
    expect(cursor.isAtEnd()).toBe(true);
  });
});
```

Expected use:

```ts
const start = cursor.offset;
while (isIdentifierPart(cursor.peek())) {
  cursor.advance();
}
const span = cursor.spanFrom(start);
```

Commit:

```bash
git add src/lexer/cursor.ts tests/unit/cursor.test.ts
git commit -m "feat: add lexer cursor -Codex Automated"
```

## Task 7: Implement KeywordTable

**Dependencies:** Task 4.

**Description:** Add keyword lookup. Public barrel assembly is intentionally deferred to Task 20 so parallel implementation tasks do not merge-conflict on `src/lexer/index.ts`.

**Files:**

- Create: `src/lexer/keyword-table.ts`
- Create: `tests/unit/keyword-table.test.ts`

**Acceptance Criteria:**

- `KeywordTable.default()` maps every language keyword to its keyword `TokenKind`.
- `KeywordTable.from(entries)` supports tiny fake keyword tables in tests.
- `KeywordTable.lookup(lexeme)` returns `TokenKind.Identifier` for non-keywords.
- `Ok`, `Err`, `Some`, `None`, `Result`, `Option`, `Never`, `List`, `Map`, and `MoveRing` return `TokenKind.Identifier`.
- Tests import `KeywordTable` and `TokenKind` directly from their implementation files.

**Code Examples:**

Unit test examples:

```ts
import { describe, expect, test } from "bun:test";
import { KeywordTable } from "../../src/lexer/keyword-table";
import { TokenKind } from "../../src/lexer/token-kind";

describe("KeywordTable", () => {
  test("maps language keywords", () => {
    const keywords = KeywordTable.default();

    expect(keywords.lookup("image")).toBe(TokenKind.Image);
    expect(keywords.lookup("take")).toBe(TokenKind.Take);
    expect(keywords.lookup("Option")).toBe(TokenKind.Identifier);
  });

  test("supports injected tiny tables", () => {
    const keywords = KeywordTable.from([["class", TokenKind.Class]]);

    expect(keywords.lookup("class")).toBe(TokenKind.Class);
    expect(keywords.lookup("image")).toBe(TokenKind.Identifier);
  });
});
```

Commit:

```bash
git add src/lexer/keyword-table.ts tests/unit/keyword-table.test.ts
git commit -m "feat: add lexer keyword table -Codex Automated"
```

## Task 8: Implement Lexer Skeleton, EOF, Newlines, Whitespace, And Comments

**Dependencies:** Task 2, Task 3, Task 4, Task 5, Task 6, Task 7.

**Description:** Add the root `Lexer` class, `LexResult`, scanning loop, EOF handling, newline tokens, whitespace trivia, and `//` line comments. This task establishes the main scanning architecture before identifiers and literals are added.

**Files:**

- Create: `src/lexer/lexer.ts`
- Create: `tests/integration/lexer.test.ts`

**Acceptance Criteria:**

- `new Lexer({ keywords, diagnostics })` constructs without global services.
- `lexer.lex(source)` returns `{ source, tokens }`.
- Empty input returns exactly one EOF token.
- Physical `\n` and `\r\n` are emitted as `Newline` tokens with exact lexemes.
- Consecutive blank lines emit consecutive `Newline` tokens.
- The first implementation does not emit `TriviaKind.Newline`.
- Inline spaces and tabs become leading trivia on the next token.
- `//` comments become line comment trivia.
- Comments after a token on the same line become trailing trivia on that token.
- Comments before the next token become leading trivia on that next token.
- Lexing never throws for whitespace/comment-only input.
- `TokenStream.reconstruct()` matches the original source.

**Code Examples:**

Integration test examples:

```ts
import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../src/lexer/diagnostics";
import { KeywordTable } from "../../src/lexer/keyword-table";
import { Lexer } from "../../src/lexer/lexer";
import { SourceText } from "../../src/lexer/source-text";
import { TokenKind } from "../../src/lexer/token-kind";

describe("Lexer", () => {
  test("lexes empty source as EOF", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });

    const result = lexer.lex(SourceText.from("empty.wr", ""));

    expect(result.tokens.kinds()).toEqual([TokenKind.Eof]);
    expect(result.tokens.reconstruct()).toBe("");
    expect(diagnostics.diagnostics).toEqual([]);
  });

  test("preserves comments and newlines", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const source = SourceText.from("comments.wr", "// top\n// next\r\n");

    const result = lexer.lex(source);

    expect(result.tokens.eofCount()).toBe(1);
    expect(result.tokens.reconstruct()).toBe(source.text);
  });

  test("emits one Newline token per physical blank line", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const source = SourceText.from("blank-lines.wr", "\n\n");

    const result = lexer.lex(source);

    expect(result.tokens.kinds()).toEqual([
      TokenKind.Newline,
      TokenKind.Newline,
      TokenKind.Eof,
    ]);
    expect(result.tokens.reconstruct()).toBe(source.text);
  });
});
```

Expected source use:

```ts
const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
const result = lexer.lex(SourceText.from("layout.wr", "\n// comment\n"));
```

Commit:

```bash
git add src/lexer/lexer.ts tests/integration/lexer.test.ts
git commit -m "feat: add lexer root and trivia scanning -Codex Automated"
```

## Task 9: Add Identifiers And Keywords

**Dependencies:** Task 8.

**Description:** Teach `Lexer` to scan identifiers and map them through the injected `KeywordTable`.

**Files:**

- Modify: `src/lexer/lexer.ts`
- Modify: `tests/integration/lexer.test.ts`

**Acceptance Criteria:**

- Identifiers match `[A-Za-z_][A-Za-z0-9_]*`.
- Keywords are classified through the injected `KeywordTable`.
- Unknown names lex as `TokenKind.Identifier`.
- Uppercase type names such as `HelloWorld`, `Option`, and `Packet` lex as identifiers unless explicitly registered in the injected table.
- Reconstruction remains exact.
- Diagnostics remain empty for valid identifiers and keywords.

**Code Examples:**

Integration test examples:

```ts
test("lexes identifiers and injected keywords", () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const source = SourceText.from("main.wr", "uefi image HelloWorld:\n");

  const result = lexer.lex(source);

  expect(result.tokens.kinds()).toEqual([
    TokenKind.Uefi,
    TokenKind.Image,
    TokenKind.Identifier,
    TokenKind.Colon,
    TokenKind.Newline,
    TokenKind.Eof,
  ]);
  expect(result.tokens.reconstruct()).toBe(source.text);
  expect(diagnostics.diagnostics).toEqual([]);
});
```

Implementation behavior example:

```ts
const kind = dependencies.keywords.lookup(lexeme);
```

Commit:

```bash
git add src/lexer/lexer.ts tests/integration/lexer.test.ts
git commit -m "feat: lex identifiers and keywords -Codex Automated"
```

## Task 10: Add Punctuation And Operators

**Dependencies:** Task 9.

**Description:** Add single-character punctuation and compound operators used in the language docs.

**Files:**

- Modify: `src/lexer/lexer.ts`
- Modify: `tests/integration/lexer.test.ts`

**Acceptance Criteria:**

- Lexes `(`, `)`, `{`, `}`, `[`, `]`, `:`, `,`, `.`, `=`, `+`, `-`, `*`, `/`, `%`, `<`, `>`, and `?`.
- Lexes compound tokens `->`, `=>`, `==`, `!=`, `<=`, and `>=`.
- Compound tokens are preferred over their single-character prefixes.
- `//` still scans as line comment trivia, not two slash tokens.
- Reconstruction remains exact.

**Code Examples:**

Integration test examples:

```ts
test("lexes punctuation and compound operators", () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const source = SourceText.from("operators.wr", "(a) -> b => c == d != e <= f >= g ?\n");

  const result = lexer.lex(source);

  expect(result.tokens.kinds()).toEqual([
    TokenKind.LeftParen,
    TokenKind.Identifier,
    TokenKind.RightParen,
    TokenKind.Arrow,
    TokenKind.Identifier,
    TokenKind.FatArrow,
    TokenKind.Identifier,
    TokenKind.EqualsEquals,
    TokenKind.Identifier,
    TokenKind.BangEquals,
    TokenKind.Identifier,
    TokenKind.LessEquals,
    TokenKind.Identifier,
    TokenKind.GreaterEquals,
    TokenKind.Identifier,
    TokenKind.Question,
    TokenKind.Newline,
    TokenKind.Eof,
  ]);
  expect(result.tokens.reconstruct()).toBe(source.text);
});
```

Compound preference example:

```ts
// Input "->" produces [TokenKind.Arrow], not [TokenKind.Minus, TokenKind.Greater].
```

Commit:

```bash
git add src/lexer/lexer.ts tests/integration/lexer.test.ts
git commit -m "feat: lex punctuation and operators -Codex Automated"
```

## Task 11: Add Integer Literals, String Literals, And Invalid Character Recovery

**Dependencies:** Task 10.

**Description:** Add decimal integer literals, double-quoted string literals, unterminated string recovery, and invalid-character diagnostics.

**Files:**

- Modify: `src/lexer/lexer.ts`
- Modify: `tests/integration/lexer.test.ts`

**Acceptance Criteria:**

- Decimal digit runs lex as `IntegerLiteral`.
- `-1` lexes as `Minus`, `IntegerLiteral`; the parser decides signed values.
- Double-quoted strings lex as `StringLiteral`.
- Escaped `\"` and `\\` are consumed as part of a string.
- Other backslash escapes are preserved in the string lexeme and do not decode in the first implementation.
- Unterminated strings stop at newline or EOF, report `LEX_UNTERMINATED_STRING`, emit a `StringLiteral` token for the recovered span, and continue.
- Unknown source characters report `LEX_INVALID_CHARACTER` and emit `Invalid` tokens preserving exact text.
- Bare `!` reports `LEX_INVALID_CHARACTER` and emits `Invalid`; only `!=` is an operator token.
- Hex, binary, octal, underscore-separated, and signed numeric literal forms are future lexer extensions and are not in scope for this implementation.
- Lexing arbitrary invalid input still reaches exactly one EOF.
- Reconstruction remains exact for valid and invalid sources.

**Code Examples:**

Integration test examples:

```ts
test("lexes integer and string literals", () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const source = SourceText.from("literals.wr", "name=\"nic0\" max=9000\n");

  const result = lexer.lex(source);

  expect(result.tokens.kinds()).toEqual([
    TokenKind.Identifier,
    TokenKind.Equals,
    TokenKind.StringLiteral,
    TokenKind.Identifier,
    TokenKind.Equals,
    TokenKind.IntegerLiteral,
    TokenKind.Newline,
    TokenKind.Eof,
  ]);
  expect(result.tokens.reconstruct()).toBe(source.text);
  expect(diagnostics.diagnostics).toEqual([]);
});

test("recovers from invalid characters", () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const source = SourceText.from("bad.wr", "image @ Main\n");

  const result = lexer.lex(source);

  expect(result.tokens.kinds()).toContain(TokenKind.Invalid);
  expect(result.tokens.reconstruct()).toBe(source.text);
  expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "LEX_INVALID_CHARACTER",
  );
});
```

Recovery behavior example:

```ts
// Input "\"unterminated\nnext" reports LEX_UNTERMINATED_STRING and then continues at Newline.
```

Commit:

```bash
git add src/lexer/lexer.ts tests/integration/lexer.test.ts
git commit -m "feat: lex literals and recover invalid text -Codex Automated"
```

## Task 12: Add Indent And Dedent Layout Tokens

**Dependencies:** Task 11.

**Description:** Add indentation stack handling and layout tokens for the language's indentation-sensitive examples.

**Files:**

- Modify: `src/lexer/lexer.ts`
- Modify: `tests/integration/lexer.test.ts`

**Acceptance Criteria:**

- A line with greater indentation emits one `Indent`.
- A line with lower indentation emits one or more `Dedent`.
- A line with equal indentation emits no layout token.
- Valid indentation uses spaces only and indentation widths must be multiples of four.
- Tabs in indentation report `LEX_INCONSISTENT_INDENT` and recover according to the shared Indentation Algorithm.
- Blank lines do not change indentation.
- Comment-only lines do not change indentation.
- EOF emits remaining `Dedent` tokens before `Eof`.
- Inconsistent indentation reports `LEX_INCONSISTENT_INDENT` and recovers deterministically.
- Layout token spans and trivia attachment follow the shared Layout Span And Trivia Contract.
- Indentation whitespace is preserved exactly as trivia on `Indent`, first `Dedent`, or the first non-layout token for that line.
- Non-layout, non-EOF tokens always make source progress.
- Reconstruction remains exact.

**Code Examples:**

Integration test examples:

```ts
test("emits indentation layout tokens", () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const source = SourceText.from(
    "layout.wr",
    "image Main:\n    fn boot():\n        loop:\n    fn stop():\n",
  );

  const result = lexer.lex(source);

  expect(result.tokens.kinds()).toEqual([
    TokenKind.Image,
    TokenKind.Identifier,
    TokenKind.Colon,
    TokenKind.Newline,
    TokenKind.Indent,
    TokenKind.Fn,
    TokenKind.Identifier,
    TokenKind.LeftParen,
    TokenKind.RightParen,
    TokenKind.Colon,
    TokenKind.Newline,
    TokenKind.Indent,
    TokenKind.Loop,
    TokenKind.Colon,
    TokenKind.Newline,
    TokenKind.Dedent,
    TokenKind.Fn,
    TokenKind.Identifier,
    TokenKind.LeftParen,
    TokenKind.RightParen,
    TokenKind.Colon,
    TokenKind.Newline,
    TokenKind.Dedent,
    TokenKind.Eof,
  ]);
  expect(result.tokens.reconstruct()).toBe(source.text);
  expect(diagnostics.diagnostics).toEqual([]);
});
```

Invalid indentation example:

```ts
test("reports inconsistent indentation", () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const source = SourceText.from("bad-indent.wr", "image Main:\n    a\n  b\n");

  const result = lexer.lex(source);

  expect(result.tokens.eofCount()).toBe(1);
  expect(result.tokens.kinds()).toEqual([
    TokenKind.Image,
    TokenKind.Identifier,
    TokenKind.Colon,
    TokenKind.Newline,
    TokenKind.Indent,
    TokenKind.Identifier,
    TokenKind.Newline,
    TokenKind.Dedent,
    TokenKind.Identifier,
    TokenKind.Newline,
    TokenKind.Eof,
  ]);
  expect(result.tokens.reconstruct()).toBe(source.text);
  expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "LEX_INCONSISTENT_INDENT",
  );
});
```

Commit:

```bash
git add src/lexer/lexer.ts tests/integration/lexer.test.ts
git commit -m "feat: lex indentation layout -Codex Automated"
```

## Task 13: Implement ImportDiscovery

**Dependencies:** Task 3, Task 4, Task 5, Task 14.

**Description:** Add lightweight module import discovery over public token streams. This is not a parser; it only finds fan-out from `use ... from <module>`.

**Files:**

- Create: `src/lexer/import-discovery.ts`
- Create: `tests/unit/import-discovery.test.ts`

**Acceptance Criteria:**

- Exports `ImportDiscovery`.
- Returns the shared `ModuleImportRequest` type from `module-import-request.ts`.
- Discovers `use UefiFirmware from core.uefi`.
- Discovers `use BootError, Machine from core.boot`.
- Returns module name text such as `core.uefi` and `core.boot`.
- Includes importer path, source, and module span in each request.
- Scans only `TokenStream`; it must not rescan raw `SourceText`.
- Malformed `use` forms report `LEX_IMPORT_MALFORMED` and continue scanning later imports.
- Stops malformed import recovery at `Newline` or `Eof`.

**Code Examples:**

Unit test examples:

```ts
import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink } from "../../src/lexer/diagnostics";
import { ImportDiscovery } from "../../src/lexer/import-discovery";
import { ModulePath } from "../../src/lexer/module-path";
import { SourceSpan } from "../../src/lexer/source-span";
import { SourceText } from "../../src/lexer/source-text";
import { Token } from "../../src/lexer/token";
import { TokenKind } from "../../src/lexer/token-kind";
import { TokenStream } from "../../src/lexer/token-stream";

function token(kind: TokenKind, lexeme: string, start: number, end: number): Token {
  return new Token({
    kind,
    lexeme,
    span: SourceSpan.from(start, end),
    leadingTrivia: [],
    trailingTrivia: [],
  });
}

describe("ImportDiscovery", () => {
  test("discovers use-from module names from public tokens", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const source = SourceText.from(
      "app/main.wr",
      "use BootError, Machine from core.boot\n",
    );
    const tokens = TokenStream.from([
      token(TokenKind.Use, "use", 0, 3),
      token(TokenKind.Identifier, "BootError", 4, 13),
      token(TokenKind.Comma, ",", 13, 14),
      token(TokenKind.Identifier, "Machine", 15, 22),
      token(TokenKind.From, "from", 23, 27),
      token(TokenKind.Identifier, "core", 28, 32),
      token(TokenKind.Dot, ".", 32, 33),
      token(TokenKind.Identifier, "boot", 33, 37),
      token(TokenKind.Newline, "\n", 37, 38),
      token(TokenKind.Eof, "", 38, 38),
    ]);

    const imports = new ImportDiscovery({ diagnostics }).discover({
      importer: ModulePath.from("app/main.wr"),
      source,
      tokens,
    });

    expect(imports.map((request) => request.moduleName)).toEqual(["core.boot"]);
    expect(diagnostics.diagnostics).toEqual([]);
  });
});
```

Malformed recovery example:

```ts
// Input:
// use Bad from
// use Good from core.good
//
// Expected: one LEX_IMPORT_MALFORMED diagnostic and one request for core.good.
```

Commit:

```bash
git add src/lexer/import-discovery.ts tests/unit/import-discovery.test.ts
git commit -m "feat: discover lexer module imports -Codex Automated"
```

## Task 14: Implement ModulePath And ModuleResolver

**Dependencies:** Task 2, Task 3.

**Description:** Add normalized module identity and a dotted-name resolver. The resolver maps language import specifiers to canonical module paths without touching the filesystem.

**Files:**

- Create: `src/lexer/module-path.ts`
- Create: `src/lexer/module-import-request.ts`
- Create: `src/lexer/module-resolver.ts`
- Create: `tests/unit/module-resolver.test.ts`

**Acceptance Criteria:**

- `ModulePath.from(path)` normalizes backslashes to `/`, removes duplicate slashes, removes leading `./`, and exposes `key` and `display`.
- `ModulePath.from(path)` rejects empty paths, `..` segments, absolute paths, Windows drive prefixes, NUL bytes, and empty path segments after normalization.
- `ModulePath.equals(other)` compares `key`.
- `ModuleImportRequest` lives in `module-import-request.ts` so `ModuleResolver` and `ImportDiscovery` do not depend on each other.
- `ModuleResolver` interface exposes `resolve(request)`.
- `DottedModuleResolver` maps `core.uefi` to `core/uefi.wr`.
- `DottedModuleResolver` maps `app.main` to `app/main.wr`.
- Invalid module names return exactly `{ kind: "unresolved", reason }`.
- Resolved module names return exactly `{ kind: "resolved", path }`.
- Resolver does not read files.

**Code Examples:**

Expected contracts:

```ts
type ModuleResolveResult =
  | { kind: "resolved"; path: ModulePath }
  | { kind: "unresolved"; reason: string };

interface ModuleResolver {
  resolve(request: ModuleImportRequest): ModuleResolveResult;
}
```

Unit test examples:

```ts
import { describe, expect, test } from "bun:test";
import { DottedModuleResolver } from "../../src/lexer/module-resolver";
import { ModulePath } from "../../src/lexer/module-path";
import { SourceText } from "../../src/lexer/source-text";

describe("DottedModuleResolver", () => {
  test("resolves dotted module names to normalized files", () => {
    const resolver = new DottedModuleResolver();
    const source = SourceText.from("app/main.wr", "use Uefi from core.uefi\n");

    const result = resolver.resolve({
      importer: ModulePath.from("app/main.wr"),
      source,
      moduleName: "core.uefi",
      span: source.span(14, 23),
    });

    if (result.kind !== "resolved") {
      throw new Error(result.reason);
    }

    expect(result.path.key).toBe("core/uefi.wr");
  });
});
```

Normalization examples:

```ts
expect(ModulePath.from("./core//uefi.wr").key).toBe("core/uefi.wr");
expect(ModulePath.from("core\\uefi.wr").key).toBe("core/uefi.wr");
expect(() => ModulePath.from("../secrets.wr")).toThrow();
expect(() => ModulePath.from("/tmp/secrets.wr")).toThrow();
```

Commit:

```bash
git add src/lexer/module-path.ts src/lexer/module-import-request.ts src/lexer/module-resolver.ts tests/unit/module-resolver.test.ts
git commit -m "feat: add lexer module path resolution -Codex Automated"
```

## Task 15: Implement FileRepository And BunFileRepository

**Dependencies:** Task 2, Task 14.

**Description:** Add file read contracts and the Bun-backed production repository. This is the only lexer module file allowed to call `Bun.file`.

**Files:**

- Create: `src/lexer/file-repository.ts`
- Create: `src/lexer/bun-file-repository.ts`
- Create: `tests/unit/file-repository.test.ts`

**Acceptance Criteria:**

- `FileRepository.read(path)` returns a `Promise<FileReadResult>`.
- `FileReadResult` has exact variants: `found`, `missing`, `unreadable`.
- `found` contains `SourceText`.
- `missing` contains `path`.
- `unreadable` contains `path` and an error message.
- `BunFileRepository` uses `Bun.file`, `exists()`, and `text()`.
- `BunFileRepository` accepts a root directory and resolves `ModulePath.key` beneath that root.
- `BunFileRepository` rejects any resolved path whose normalized absolute path is outside the configured root.
- No other `src/lexer` file calls `Bun.file`.
- Contract tests use an in-memory fake.
- `BunFileRepository` tests use a real temporary directory to verify found, missing, unreadable, and root-containment behavior.

**Code Examples:**

Expected contracts:

```ts
type FileReadResult =
  | { kind: "found"; path: ModulePath; source: SourceText }
  | { kind: "missing"; path: ModulePath }
  | { kind: "unreadable"; path: ModulePath; message: string };

interface FileRepository {
  read(path: ModulePath): Promise<FileReadResult>;
}
```

Fake repository example:

```ts
class FakeFileRepository implements FileRepository {
  constructor(private readonly files: ReadonlyMap<string, string>) {}

  async read(path: ModulePath): Promise<FileReadResult> {
    const text = this.files.get(path.key);

    if (text === undefined) {
      return { kind: "missing", path };
    }

    return {
      kind: "found",
      path,
      source: SourceText.from(path.display, text),
    };
  }
}
```

Production edge behavior example:

```ts
const repository = new BunFileRepository({ root: "/Users/ryanwible/projects/wrela6" });
const result = await repository.read(ModulePath.from("app/main.wr"));
```

Root containment example:

```ts
// If root is "/repo", ModulePath.from("app/main.wr") may resolve to "/repo/app/main.wr".
// A path resolving outside "/repo" must return { kind: "unreadable", ... } rather than reading.
```

Production edge test example:

```ts
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BunFileRepository } from "../../src/lexer/bun-file-repository";
import { ModulePath } from "../../src/lexer/module-path";

describe("BunFileRepository", () => {
  let root: string | undefined;

  afterEach(async () => {
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
    }
  });

  test("reads files beneath the configured root", async () => {
    root = await mkdtemp(join(tmpdir(), "wrela-lexer-"));
    await writeFile(join(root, "main.wr"), "uefi image Main:\n");

    const repository = new BunFileRepository({ root });
    const result = await repository.read(ModulePath.from("main.wr"));

    expect(result.kind).toBe("found");
  });
});
```

Search check:

```bash
rg "Bun\\.file" src/lexer
```

Expected search result:

```text
src/lexer/bun-file-repository.ts:<line with Bun.file>
```

Commit:

```bash
git add src/lexer/file-repository.ts src/lexer/bun-file-repository.ts tests/unit/file-repository.test.ts
git commit -m "feat: add lexer file repository edge -Codex Automated"
```

## Task 16: Implement ModuleGraphLexer

**Dependencies:** Task 12, Task 13, Task 14, Task 15, Task 17.

**Description:** Add image entry lexing that reads the root module, lexes it, discovers imports, resolves modules, and recursively lexes reachable modules with deterministic recovery.

**Files:**

- Create: `src/lexer/module-graph-lexer.ts`
- Create: `tests/integration/module-graph-lexer.test.ts`

**Acceptance Criteria:**

- `ModuleGraphLexer` is constructed with `{ lexer, files, resolver, imports, diagnostics }`.
- `lexImage({ entry })` reads the entry through `FileRepository`.
- Found modules are lexed with `Lexer`.
- Imports are discovered with `ImportDiscovery`.
- Imports are resolved with `ModuleResolver`.
- Traversal is deterministic depth-first in source import order.
- Each canonical `ModulePath.key` is lexed at most once.
- Cycles report `LEX_IMPORT_CYCLE` and terminate.
- Missing modules report `LEX_MODULE_MISSING` and do not stop other imports.
- Unreadable modules report `LEX_MODULE_UNREADABLE` and do not stop other imports.
- Unresolved imports report `LEX_MODULE_UNRESOLVED` and do not stop other imports.
- Returns modules in first successful lex order.

**Code Examples:**

Expected result contracts:

```ts
interface ModuleGraphLexResult {
  entry: ModulePath;
  modules: readonly LexedModule[];
}

interface LexedModule {
  path: ModulePath;
  source: SourceText;
  tokens: TokenStream;
  imports: readonly ModuleImportRequest[];
}
```

Integration test examples:

```ts
test("lexes an image entry and reachable imports", async () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const files = new FakeFileRepository(
    new Map([
      ["app/main.wr", "use Boot from core.boot\nuefi image Main:\n"],
      ["core/boot.wr", "class Boot:\n"],
    ]),
  );

  const graph = new ModuleGraphLexer({
    lexer,
    files,
    resolver: new DottedModuleResolver(),
    imports: new ImportDiscovery({ diagnostics }),
    diagnostics,
  });

  const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

  expect(result.modules.map((module) => module.path.key)).toEqual([
    "app/main.wr",
    "core/boot.wr",
  ]);
  expect(diagnostics.diagnostics).toEqual([]);
});

test("reports missing modules and continues", async () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const files = new FakeFileRepository(
    new Map([
      ["app/main.wr", "use Missing from core.missing\nuse Ok from core.ok\n"],
      ["core/ok.wr", "class Ok:\n"],
    ]),
  );

  const graph = new ModuleGraphLexer({
    lexer,
    files,
    resolver: new DottedModuleResolver(),
    imports: new ImportDiscovery({ diagnostics }),
    diagnostics,
  });

  const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

  expect(result.modules.map((module) => module.path.key)).toEqual([
    "app/main.wr",
    "core/ok.wr",
  ]);
  expect(diagnostics.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "LEX_MODULE_MISSING",
  );
});
```

Cycle behavior example:

```ts
// app/main.wr imports app.a
// app/a.wr imports app.main
// Expected: main and a are lexed once, a cycle diagnostic is reported, traversal terminates.
```

Commit:

```bash
git add src/lexer/module-graph-lexer.ts tests/integration/module-graph-lexer.test.ts
git commit -m "feat: add lexer module graph traversal -Codex Automated"
```

## Task 17: Add Shared Test Fakes And Invariants

**Dependencies:** Task 3, Task 7, Task 8, Task 14, Task 15.

**Description:** Add reusable fakes and token-stream invariant helpers under `tests/support` so unit, integration, and fuzz tests do not duplicate DI setup or copy-paste validation logic.

**Files:**

- Create: `tests/support/lexer-fakes.ts`
- Create: `tests/support/lexer-invariants.ts`
- Modify: tests from Tasks 13, 15, and 16 to import shared fakes where useful

**Acceptance Criteria:**

- Exports `FakeFileRepository`.
- Exports `FakeModuleResolver` for tests that need exact path mappings.
- Exports `makeLexerHarness(sourceName, sourceText)` for concise source lexer integration tests.
- Exports `expectLosslessTokenStream(source, tokens)`.
- Exports `expectValidTokenSpans(source, tokens)`.
- Exports `expectDiagnosticsInBounds(source, diagnostics)`.
- Exports `expectBalancedLayout(tokens)`.
- Exports `expectValidLexerResult(source, tokens, diagnostics)` that composes the source lexer invariants.
- Fakes are concrete classes with behavior; no `mock`, `spyOn`, or call-count assertions.
- Existing tests pass after replacing duplicate fake definitions.

**Code Examples:**

Expected fake use:

```ts
import { FakeFileRepository, makeLexerHarness } from "../support/lexer-fakes";

test("uses a lexer harness", () => {
  const { lexer, diagnostics, source } = makeLexerHarness(
    "main.wr",
    "uefi image Main:\n",
  );

  const result = lexer.lex(source);

  expect(result.tokens.reconstruct()).toBe(source.text);
  expect(diagnostics.diagnostics).toEqual([]);
});
```

Expected fake resolver use:

```ts
const resolver = new FakeModuleResolver(
  new Map([
    ["core.boot", "core/boot.wr"],
    ["core.uefi", "core/uefi.wr"],
  ]),
);
```

Expected invariant helper use:

```ts
import { expectValidLexerResult } from "../support/lexer-invariants";

const { lexer, diagnostics, source } = makeLexerHarness("main.wr", "uefi image Main:\n");
const result = lexer.lex(source);

expectValidLexerResult(source, result.tokens, diagnostics.diagnostics);
```

Invariant helper shape:

```ts
import { expect } from "bun:test";
import { TokenKind } from "../../src/lexer/token-kind";
import type { LexDiagnostic } from "../../src/lexer/diagnostics";
import type { SourceText } from "../../src/lexer/source-text";
import type { TokenStream } from "../../src/lexer/token-stream";

export function expectLosslessTokenStream(source: SourceText, tokens: TokenStream): void {
  expect(tokens.reconstruct()).toBe(source.text);
  expect(tokens.eofCount()).toBe(1);
}

export function expectValidTokenSpans(source: SourceText, tokens: TokenStream): void {
  let previousEnd = 0;

  for (const token of tokens.items) {
    expect(token.span.start).toBeGreaterThanOrEqual(previousEnd);
    expect(token.span.end).toBeGreaterThanOrEqual(token.span.start);
    expect(token.span.end).toBeLessThanOrEqual(source.length);

    if (
      token.kind !== TokenKind.Eof &&
      token.kind !== TokenKind.Indent &&
      token.kind !== TokenKind.Dedent
    ) {
      expect(token.span.end).toBeGreaterThan(token.span.start);
    }

    for (const trivia of [...token.leadingTrivia, ...token.trailingTrivia]) {
      expect(trivia.span.start).toBeGreaterThanOrEqual(0);
      expect(trivia.span.end).toBeGreaterThanOrEqual(trivia.span.start);
      expect(trivia.span.end).toBeLessThanOrEqual(source.length);
    }

    previousEnd = token.span.end;
  }
}

export function expectDiagnosticsInBounds(
  source: SourceText,
  diagnostics: readonly LexDiagnostic[],
): void {
  for (const diagnostic of diagnostics) {
    expect(diagnostic.source).toBe(source);
    expect(diagnostic.span.start).toBeGreaterThanOrEqual(0);
    expect(diagnostic.span.end).toBeGreaterThanOrEqual(diagnostic.span.start);
    expect(diagnostic.span.end).toBeLessThanOrEqual(source.length);
  }
}

export function expectBalancedLayout(tokens: TokenStream): void {
  let depth = 0;

  for (const token of tokens.items) {
    if (token.kind === TokenKind.Indent) {
      depth += 1;
    }

    if (token.kind === TokenKind.Dedent) {
      depth -= 1;
      expect(depth).toBeGreaterThanOrEqual(0);
    }
  }

  expect(depth).toBe(0);
}

export function expectValidLexerResult(
  source: SourceText,
  tokens: TokenStream,
  diagnostics: readonly LexDiagnostic[],
): void {
  expectLosslessTokenStream(source, tokens);
  expectValidTokenSpans(source, tokens);
  expectDiagnosticsInBounds(source, diagnostics);
  expectBalancedLayout(tokens);
}
```

Commit:

```bash
git add tests/support/lexer-fakes.ts tests/support/lexer-invariants.ts tests/unit tests/integration
git commit -m "test: add lexer fakes and invariants -Codex Automated"
```

## Task 18: Add Source Lexer Fuzz Tests

**Dependencies:** Task 1A, Task 12, Task 17.

**Description:** Add property-based tests for source lexing invariants. These tests should never inspect private lexer internals.

**Files:**

- Create: `tests/integration/lexer-fuzz.test.ts`

**Acceptance Criteria:**

- Imports `fast-check` only from test code.
- Asserts lexing arbitrary strings never throws.
- Asserts exactly one EOF token.
- Asserts token spans are monotonic.
- Asserts token and trivia spans are within source bounds.
- Asserts reconstruction equals original input.
- Asserts diagnostics have valid source spans.
- Asserts indent/dedent balance by EOF.
- Uses at least `5_000` runs for the main arbitrary string property.
- Uses a deterministic seed in at least one regression-style fuzz test example.

**Code Examples:**

Fuzz test shape:

```ts
import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { makeLexerHarness } from "../support/lexer-fakes";
import { expectValidLexerResult } from "../support/lexer-invariants";

describe("lexer fuzz invariants", () => {
  test("never throws and preserves source text", () => {
    fastCheck.assert(
      fastCheck.property(fastCheck.string(), (input) => {
        const { lexer, diagnostics, source } = makeLexerHarness("fuzz.wr", input);

        const result = lexer.lex(source);

        expect(result.tokens.eofCount()).toBe(1);
        expect(result.tokens.reconstruct()).toBe(input);
        expectValidLexerResult(source, result.tokens, diagnostics.diagnostics);
      }),
      { numRuns: 5_000, seed: 0x1eaf },
    );
  });
});
```

Span invariant helper example from `tests/support/lexer-invariants.ts`:

```ts
function expectMonotonicTokenSpans(tokens: TokenStream): void {
  let previousEnd = 0;

  for (const token of tokens.items) {
    expect(token.span.start).toBeGreaterThanOrEqual(previousEnd);
    expect(token.span.end).toBeGreaterThanOrEqual(token.span.start);
    previousEnd = token.span.end;
  }
}
```

Run command:

```bash
bun test ./tests/integration/lexer-fuzz.test.ts
```

Commit:

```bash
git add tests/integration/lexer-fuzz.test.ts
git commit -m "test: fuzz lexer source invariants -Codex Automated"
```

## Task 19: Add Module Graph Fuzz Tests

**Dependencies:** Task 16, Task 17.

**Description:** Add property-based tests for module graph recovery, duplicate handling, and deterministic traversal over generated in-memory repositories.

**Files:**

- Create: `tests/integration/module-graph-lexer-fuzz.test.ts`

**Acceptance Criteria:**

- Imports `fast-check` only from test code.
- Generated repositories use in-memory `FakeFileRepository`.
- Graph lexing never throws.
- Each canonical path appears at most once in `result.modules`.
- Cycles terminate.
- Missing modules produce diagnostics instead of exceptions.
- Returned modules are deterministic for the same generated repository.
- Every returned module token stream passes source lexer invariants from Task 17.
- Uses at least `1_000` runs for graph fuzzing.

**Code Examples:**

Fuzz test shape:

```ts
import { describe, expect, test } from "bun:test";
import fastCheck from "fast-check";
import { CollectingDiagnosticSink } from "../../src/lexer/diagnostics";
import { ImportDiscovery } from "../../src/lexer/import-discovery";
import { KeywordTable } from "../../src/lexer/keyword-table";
import { Lexer } from "../../src/lexer/lexer";
import { ModuleGraphLexer } from "../../src/lexer/module-graph-lexer";
import { ModulePath } from "../../src/lexer/module-path";
import { DottedModuleResolver } from "../../src/lexer/module-resolver";
import { FakeFileRepository } from "../support/lexer-fakes";
import { expectLosslessTokenStream, expectValidTokenSpans } from "../support/lexer-invariants";

const graphCase = fastCheck.record({
  includeA: fastCheck.boolean(),
  includeB: fastCheck.boolean(),
  mainImportsA: fastCheck.boolean(),
  mainImportsMissing: fastCheck.boolean(),
  aImportsB: fastCheck.boolean(),
  bImportsA: fastCheck.boolean(),
});

describe("module graph lexer fuzz invariants", () => {
  test("terminates and lexes each canonical module at most once", async () => {
    await fastCheck.assert(
      fastCheck.asyncProperty(
        graphCase,
        async (shape) => {
          const filesByPath: Record<string, string> = {
            "app/main.wr": [
              shape.mainImportsA ? "use A from app.a" : "",
              shape.mainImportsMissing ? "use Missing from app.missing" : "",
              "uefi image Main:",
              "",
            ].filter(Boolean).join("\n"),
          };

          if (shape.includeA) {
            filesByPath["app/a.wr"] = [
              shape.aImportsB ? "use B from app.b" : "",
              "class A:",
              "",
            ].filter(Boolean).join("\n");
          }

          if (shape.includeB) {
            filesByPath["app/b.wr"] = [
              shape.bImportsA ? "use A from app.a" : "",
              "class B:",
              "",
            ].filter(Boolean).join("\n");
          }

          const diagnostics = new CollectingDiagnosticSink();
          const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
          const graph = new ModuleGraphLexer({
            lexer,
            files: new FakeFileRepository(new Map(Object.entries(filesByPath))),
            resolver: new DottedModuleResolver(),
            imports: new ImportDiscovery({ diagnostics }),
            diagnostics,
          });

          const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });
          const keys = result.modules.map((module) => module.path.key);

          expect(new Set(keys).size).toBe(keys.length);
          for (const module of result.modules) {
            expect(module.tokens.eofCount()).toBe(1);
            expectLosslessTokenStream(module.source, module.tokens);
            expectValidTokenSpans(module.source, module.tokens);
          }
        },
      ),
      { numRuns: 1_000 },
    );
  });
});
```

Run command:

```bash
bun test ./tests/integration/module-graph-lexer-fuzz.test.ts
```

Commit:

```bash
git add tests/integration/module-graph-lexer-fuzz.test.ts
git commit -m "test: fuzz lexer module graph invariants -Codex Automated"
```

## Task 20: Assemble Public API Barrels

**Dependencies:** Task 7, Task 8, Task 13, Task 14, Task 15, Task 16.

**Description:** Assemble the public API barrels in one task after all lexer module files exist. This task is the only writer to `src/lexer/index.ts` and `src/index.ts`, preventing parallel merge conflicts.

**Files:**

- Create: `src/lexer/index.ts`
- Modify: `src/index.ts`
- Create: `tests/integration/public-api.test.ts`

**Acceptance Criteria:**

- `src/lexer/index.ts` exports every public lexer API listed in `docs/design/lexer-design.md`.
- `src/lexer/index.ts` also exports implementation-edge helpers introduced by this plan: `CollectingDiagnosticSink`, `DottedModuleResolver`, and `BunFileRepository`.
- `src/index.ts` re-exports the lexer module public API and has no `console.log`.
- Public API integration test imports from `../../src/lexer` only.
- No earlier task modifies `src/lexer/index.ts` or `src/index.ts`.

**Code Examples:**

Target `src/lexer/index.ts` shape:

```ts
export { Lexer } from "./lexer";
export { SourceText } from "./source-text";
export { SourceSpan } from "./source-span";
export { Token } from "./token";
export { TokenKind } from "./token-kind";
export { TokenStream } from "./token-stream";
export { Trivia } from "./trivia";
export { TriviaKind } from "./trivia-kind";
export { KeywordTable } from "./keyword-table";
export { ModuleGraphLexer } from "./module-graph-lexer";
export { ModulePath } from "./module-path";
export { ImportDiscovery } from "./import-discovery";
export { CollectingDiagnosticSink } from "./diagnostics";
export { DottedModuleResolver } from "./module-resolver";
export { BunFileRepository } from "./bun-file-repository";
export type { DiagnosticSink, LexDiagnostic, LexDiagnosticCode, DiagnosticSeverity } from "./diagnostics";
export type { FileReadResult, FileRepository } from "./file-repository";
export type { ModuleImportRequest } from "./module-import-request";
export type { ModuleResolveResult, ModuleResolver } from "./module-resolver";
export type { ModuleGraphLexResult } from "./module-graph-lexer";
export type { LexResult } from "./lexer";
```

Public API test example:

```ts
import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  SourceText,
  TokenKind,
} from "../../src/lexer";

describe("lexer public api", () => {
  test("lexes through the public barrel", () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });

    const result = lexer.lex(SourceText.from("main.wr", "uefi image Main:\n"));

    expect(result.tokens.kinds()[0]).toBe(TokenKind.Uefi);
  });
});
```

Commit:

```bash
git add src/lexer/index.ts src/index.ts tests/integration/public-api.test.ts
git commit -m "feat: assemble lexer public api -Codex Automated"
```

## Task 21: Add System Front-End Smoke Test

**Dependencies:** Task 16, Task 17, Task 20.

**Description:** Add a public-API-only smoke test that models the current compiler front-end workflow without creating a parser facade.

**Files:**

- Create: `tests/system/front-end.test.ts`

**Acceptance Criteria:**

- Test imports only from `src/lexer` public API and test fakes.
- Constructs `Lexer`, `ImportDiscovery`, `DottedModuleResolver`, `FakeFileRepository`, and `ModuleGraphLexer`.
- Lexes an image main file that imports one module.
- Asserts modules are returned in deterministic order.
- Asserts token streams reconstruct their source text.
- Does not reach into `Cursor`, private scanner state, or lexer internals.

**Code Examples:**

System test example:

```ts
import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  DottedModuleResolver,
  ImportDiscovery,
  KeywordTable,
  Lexer,
  ModuleGraphLexer,
  ModulePath,
} from "../../src/lexer";
import { FakeFileRepository } from "../support/lexer-fakes";

describe("front-end smoke", () => {
  test("lexes an image entry through public APIs", async () => {
    const diagnostics = new CollectingDiagnosticSink();
    const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
    const graph = new ModuleGraphLexer({
      lexer,
      files: new FakeFileRepository(
        new Map([
          ["app/main.wr", "use Boot from core.boot\nuefi image Main:\n"],
          ["core/boot.wr", "class Boot:\n"],
        ]),
      ),
      resolver: new DottedModuleResolver(),
      imports: new ImportDiscovery({ diagnostics }),
      diagnostics,
    });

    const result = await graph.lexImage({ entry: ModulePath.from("app/main.wr") });

    expect(result.modules.map((module) => module.path.key)).toEqual([
      "app/main.wr",
      "core/boot.wr",
    ]);
    for (const module of result.modules) {
      expect(module.tokens.reconstruct()).toBe(module.source.text);
    }
  });
});
```

Run command:

```bash
bun test ./tests/system/front-end.test.ts
```

Commit:

```bash
git add tests/system/front-end.test.ts
git commit -m "test: add lexer front-end smoke test -Codex Automated"
```

## Task 22: Final Hardening And Documentation Alignment

**Dependencies:** Task 1A and Tasks 1 through 21.

**Description:** Run final verification, check that source imports stay dependency-free, and align implementation with `docs/design/lexer-design.md`.

**Files:**

- Modify only files needed to fix discovered verification failures.

**Acceptance Criteria:**

- `bun run typecheck` exits 0.
- `bun run format:check` exits 0.
- `bun run lint` exits 0.
- `bun run policy:check` exits 0.
- `bun test` exits 0.
- `bun run agent:check` exits 0 and includes typecheck, formatting, linting, policy checks, and all tests.
- `agents.md` tells agents to run `bun run agent:check` before handoff.
- `rg "from \"fast-check\"|from 'fast-check'" src` returns no matches.
- `rg "Bun\\.file" src/lexer` returns only `src/lexer/bun-file-repository.ts`.
- `rg "mock\\(|spyOn|jest\\.fn" tests` returns no matches.
- `bun run policy:check` rejects abbreviated identifiers such as `src`, `diag`, `tok`, `res`, `ctx`, `opts`, `repo`, `impl`, `pos`, `err`, and `fc`.
- `.oxlintrc.json` keeps `id-length` enabled with `min` set to `3`.
- `src/lexer/index.ts` exports all public API listed in `docs/design/lexer-design.md`, plus implementation-edge helpers introduced by this plan such as `CollectingDiagnosticSink`, `DottedModuleResolver`, and `BunFileRepository`.
- `TokenKind` covers every keyword, punctuation, operator, structural token, literal token, and invalid token listed in `docs/design/lexer-design.md`.
- Integration tests include at least one snippet drawn from `docs/language/happy.md` or `docs/language/invalid.md`.

**Code Examples:**

Verification commands:

```bash
bun run typecheck
bun run format:check
bun run lint
bun run policy:check
bun test
bun run agent:check
rg "from \"fast-check\"|from 'fast-check'" src
rg "Bun\\.file" src/lexer
rg "mock\\(|spyOn|jest\\.fn" tests
rg "\"id-length\"" .oxlintrc.json
```

Expected search results:

```text
rg "from \"fast-check\"|from 'fast-check'" src
# no output

rg "Bun\\.file" src/lexer
src/lexer/bun-file-repository.ts:<line number>:const file = Bun.file(...)

rg "mock\\(|spyOn|jest\\.fn" tests
# no output
```

Documentation cross-check example:

```ts
const source = SourceText.from(
  "happy-snippet.wr",
  [
    "use UefiFirmware from core.uefi",
    "",
    "uefi image HelloWorld:",
    "    fn boot(image_handle: UefiImageHandle, system: UefiSystemTable):",
    "        let firmware = UefiFirmware(image_handle=image_handle, system=system)",
    "",
  ].join("\n"),
);
```

Commit:

```bash
git add .oxlintrc.json agents.md package.json bun.lock scripts src tests docs
git commit -m "test: harden lexer implementation -Codex Automated"
```

## Execution Notes For Subagents

- Use `bun test ./tests/unit/<file>.test.ts` while developing a focused task.
- Run `bun run agent:check` before handing a task back.
- Run `bun run format` when formatting changes.
- Do not import `fast-check` from `src`.
- Do not use mocks. Add or reuse fakes in `tests/support/lexer-fakes.ts`.
- Do not add parser concepts to the lexer. `ImportDiscovery` is allowed to scan import fan-out only.
- Do not add filesystem access outside `BunFileRepository`.
- Use descriptive names. Prefer `source`, `diagnostic`, `token`, `result`, `context`, and `repository` over abbreviations.
- Preserve source text exactly. If a tokenization choice risks losing a character, emit `Invalid` and report a diagnostic.
- `tsconfig.json` uses strict module syntax. Use `import type` for type-only imports such as `LexDiagnostic`, `SourceText`, and `TokenStream` when they are used only in signatures.
- Keep `Lexer` constructor dependencies explicit:

```ts
const lexer = new Lexer({
  keywords: KeywordTable.default(),
  diagnostics,
});
```

- Keep module graph dependencies explicit:

```ts
const graph = new ModuleGraphLexer({
  lexer,
  files,
  resolver,
  imports,
  diagnostics,
});
```

## Self-Review Checklist

- The plan covers value objects, diagnostics, cursor, keyword table, lexer root, trivia preservation, layout tokens, literals, recovery, import discovery, module resolution, file repository, graph lexing, fakes, fuzzing, integration tests, and system tests.
- Every task has concrete files, acceptance criteria, and code examples.
- No task asks for open-ended exploration or unresolved design decisions.
- Runtime source remains free of external npm packages.
- The test layout matches the requested `tests/unit`, `tests/integration`, and `tests/system` structure.
