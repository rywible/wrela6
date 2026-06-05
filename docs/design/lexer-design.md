# Lexer Design

## Purpose

The lexer is the first compiler layer for the language. It turns `SourceText`
into a trivia-preserving token stream and lexical diagnostics. It also provides
a lightweight module-graph lexing entry point: starting from an image main file,
it reads the root file, discovers `use ... from ...` imports, resolves imported
modules, and lexes the reachable source graph.

The source lexer should be deterministic, fuzzable, easy to test, and isolated
from filesystem, CLI, and process concerns. File discovery belongs at the edge
of the lexer module behind injected repository and resolver interfaces.

The implementation will be TypeScript running on Bun. Source code should use
standard TypeScript and Bun runtime APIs only. Test code may use Bun's built-in
test runner and `fast-check` as a dev-only property/fuzz testing dependency.

## Goals

- Keep the lexer as its own compiler module under `src/frontend/lexer`.
- Expose a small public API from `src/frontend/lexer/index.ts`.
- Use class-based TypeScript and constructor dependency injection.
- Keep technical concerns at the edge: file reads, module lookup, process
  paths, logging, and global diagnostics stay behind injected interfaces.
- Preserve trivia so diagnostics, formatting, source reconstruction, and future
  editor tooling have full source context.
- Make the lexer fuzzable by construction: deterministic inputs, deterministic
  outputs, no hidden state, no ambient dependencies.
- Support graceful error recovery for both source text and module discovery.
- Use Bun's built-in tester with fakes, not mocks.
- Use `fast-check` for property-based fuzz tests in `tests`.
- Keep unit, integration, and system tests separate by test scope.

## Non-Goals

- The lexer does not parse grammar or build AST nodes.
- The source lexer does not read files from disk.
- The module-graph lexer does not own parsing or later compiler workflow
  orchestration.
- The lexer does not decide semantic validity beyond lexical structure.
- The lexer does not require a future `CompilerFrontEnd` facade.

## Repository Shape

```text
src/
  shared/
    diagnostics.ts
    source-span.ts
    source-text.ts

  frontend/
    lexer/
      index.ts
      lexer.ts
      cursor.ts
      source-text.ts
      source-span.ts
      token.ts
      token-kind.ts
      token-stream.ts
      trivia.ts
      trivia-kind.ts
      diagnostics.ts
      keyword-table.ts
      file-repository.ts
      module-graph-lexer.ts
      module-resolver.ts
      module-path.ts
      import-discovery.ts

tests/
  unit/
    cursor.test.ts
    diagnostics.test.ts
    import-discovery.test.ts
    keyword-table.test.ts
    module-resolver.test.ts
    source-text.test.ts
    token.test.ts
    token-stream.test.ts
    trivia.test.ts

  integration/
    lexer.test.ts
    module-graph-lexer.test.ts

  system/
    front-end.test.ts
```

`tests/unit` tests individual classes and value objects. `tests/integration`
tests the lexer module through its public API. `tests/system` is reserved for
future composed compiler workflows such as lexing plus parsing.

> **Migration note:** The old `src/lexer` path is now a compatibility barrel
> (`export * from "../frontend/lexer"`). It remains temporarily so existing
> imports continue to work, but new code should import from `src/frontend/lexer`
> or the `src/frontend` barrel.

## Public API

Each compiler module should expose its public API through its own `index.ts`.
The lexer module root is `Lexer`. The target module path is
`src/frontend/lexer`; temporary compatibility exports from `src/lexer` are
acceptable during migration only.

```ts
// src/frontend/lexer/index.ts
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
export type { DiagnosticSink, LexDiagnostic } from "./diagnostics";
export type { FileReadResult, FileRepository } from "./file-repository";
export type { ModuleResolveResult, ModuleResolver } from "./module-resolver";
export type { ModuleImportRequest } from "./import-discovery";
export type { ModuleGraphLexResult } from "./module-graph-lexer";
export type { LexResult } from "./lexer";
```

Expected source lexing use:

```ts
const lexer = new Lexer({
  keywords,
  diagnostics,
});

const result = lexer.lex(source);
```

Expected image/module graph lexing use:

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

The lexer API should not require a higher-level compiler facade. Later compiler
workflow code may construct a lexer and parser separately and orchestrate the
pipeline at whatever boundary proves natural.

## Dependency Injection

The lexer root class accepts dependencies through a constructor object.

```ts
interface LexerDependencies {
  keywords: KeywordTable;
  diagnostics: DiagnosticSink;
}

class Lexer {
  constructor(private readonly dependencies: LexerDependencies) {}

  lex(source: SourceText): LexResult {
    // ...
  }
}
```

Dependencies are explicit capabilities:

- `KeywordTable` decides whether an identifier lexeme is a keyword.
- `DiagnosticSink` receives lexical diagnostics.

The lexer should not allocate or look up these dependencies globally. Tests can
inject fakes, and integration code can inject real instances.

Module graph lexing is also dependency-injected:

```ts
interface ModuleGraphLexerDependencies {
  lexer: Lexer;
  files: FileRepository;
  resolver: ModuleResolver;
  imports: ImportDiscovery;
  diagnostics: DiagnosticSink;
}
```

`FileRepository` is the file discovery edge. The production implementation may
use Bun file APIs. Tests should use a fake in-memory repository.

## Layer Boundaries

The source lexer communicates outward through value objects and interfaces only.

```text
SourceText -> Lexer -> LexResult
                 |
                 +-> KeywordTable
                 +-> DiagnosticSink
```

The module graph lexer sits at the lexer module edge:

```text
ModulePath -> ModuleGraphLexer -> ModuleGraphLexResult
                    |
                    +-> Lexer
                    +-> FileRepository
                    +-> ModuleResolver
                    +-> ImportDiscovery
                    +-> DiagnosticSink
```

Future parser code should depend on public token abstractions, not lexer
internals.

```ts
const lexResult = lexer.lex(source);
const parseResult = parser.parse({
  source: lexResult.source,
  tokens: lexResult.tokens,
  lexerDiagnostics: diagnostics.diagnostics,
});
```

The parser should not know about `Cursor`, indentation stack internals, or lexer
diagnostic implementation details.

The parser also should not perform source file discovery. It receives lexed
modules from `ModuleGraphLexResult` or a later front-end orchestration layer.

## Core Classes

### `SourceText`

Immutable source contents plus source identity.

Responsibilities:

- Store file name or logical source name.
- Store complete source text.
- Provide safe access to code units by offset.
- Convert offsets to line and column for diagnostics.

`SourceText` should not read files. File IO belongs to compiler edge code.

### `SourceSpan`

Half-open source range:

```ts
class SourceSpan {
  readonly start: number;
  readonly end: number;
}
```

Rules:

- `start <= end`.
- Offsets are source-text offsets.
- Diagnostics and tokens use spans from the same `SourceText`.

### `Cursor`

Small scanner helper over `SourceText`.

Responsibilities:

- Track current offset.
- Peek current and future code units.
- Advance by one code unit or a known span.
- Report `SourceSpan` for scanned regions.
- Never move backward.

`Cursor` should not classify language tokens. It only moves through source.

### `TokenKind`

Token kinds are stable compiler vocabulary. They should include:

- Structural tokens: `Eof`, `Newline`, `Indent`, `Dedent`.
- Identifiers and keywords.
- Literals: integer, string, bytes if needed later.
- Punctuation and operators.
- Invalid or skipped token forms if preserving exact source requires them.

Keyword token kinds are produced by `KeywordTable`.

## Initial Token Set

The first lexer implementation should support the token vocabulary used by
`docs/happy.md` and `docs/invalid.md`.

### Structural Tokens

- `Eof`
- `Newline`
- `Indent`
- `Dedent`

### Literals

- `Identifier`
- `IntegerLiteral`
- `StringLiteral`

String literals are needed for device names, module names if quoted imports are
added later, diagnostic text, and ordinary source snippets. Integer literals are
needed for bounds, offsets, capacities, and enum-like examples.

### Keywords

Declaration and module keywords:

- `use`
- `from`
- `uefi`
- `image`
- `devices`
- `unique`
- `edge`
- `class`
- `dataclass`
- `validated`
- `buffer`
- `stream`
- `contains`
- `bound`
- `enum`
- `interface`

Function and capability keywords:

- `constructor`
- `fn`
- `private`
- `platform`
- `terminal`
- `predicate`
- `requires`
- `consume`

Validated-buffer section keywords:

- `params`
- `layout`
- `derive`
- `require`
- `at`
- `len`
- `else`
- `otherwise`

Control-flow keywords:

- `let`
- `if`
- `not`
- `while`
- `for`
- `in`
- `loop`
- `match`
- `case`
- `return`
- `yield`
- `take`
- `as`

Reserved for older examples or likely grammar continuity:

- `with`

`Ok`, `Err`, `Some`, `None`, `Result`, `Option`, `Never`, `List`, `Map`,
`MoveRing`, and user-defined type names should lex as identifiers. The parser
or later semantic layers decide whether they refer to enum cases, generic types,
or ordinary names.

### Punctuation And Operators

Single-character tokens:

- `(`
- `)`
- `{`
- `}`
- `[`
- `]`
- `:`
- `,`
- `.`
- `=`
- `+`
- `-`
- `*`
- `/`
- `%`
- `<`
- `>`
- `?`

Compound tokens:

- `->`
- `=>`
- `==`
- `!=`
- `<=`
- `>=`

Comment introducers are scanned as trivia, not ordinary tokens:

- `//` line comment

Block comments are not required by the current language docs. If added later,
they should be trivia-preserving and recover from unterminated blocks.

### Invalid Tokens

The lexer should have an `Invalid` or `Skipped` token kind for source text that
cannot be classified but must be preserved for diagnostics and fuzz
reconstruction.

### `TriviaKind` and `Trivia`

Trivia represents source text that is not the main token lexeme but must be
preserved.

Expected trivia kinds:

- whitespace
- line comment
- block comment if the language grows one
- newline
- indentation whitespace
- skipped or invalid text when diagnostics need exact recovery

Trivia has a kind, lexeme, and span.

### `Token`

Tokens are immutable value objects.

```ts
class Token {
  readonly kind: TokenKind;
  readonly lexeme: string;
  readonly span: SourceSpan;
  readonly leadingTrivia: readonly Trivia[];
  readonly trailingTrivia: readonly Trivia[];
  readonly value?: unknown;
}
```

The token stream should be full fidelity: reconstructing leading trivia,
lexemes, trailing trivia, and EOF-adjacent trivia should reproduce the original
source text.

### `TokenStream`

Immutable ordered token collection.

Responsibilities:

- Store tokens in source order.
- Provide read-only token access.
- Guarantee exactly one `Eof` token.

The parser consumes `TokenStream` together with its `SourceText`, either through
`LexResult` or through an explicit `{ source, tokens }` parse input. Tokens-only
input is not enough for parser diagnostics or syntax-tree reconstruction.

### `KeywordTable`

Maps identifier lexemes to keyword token kinds.

It should be injectable so tests can use tiny fake keyword sets and the real
compiler can use the full language keyword table.

### `DiagnosticSink`

Interface for diagnostics.

```ts
interface DiagnosticSink {
  report(diagnostic: LexDiagnostic): void;
}
```

The lexer reports diagnostics but does not own final formatting, printing, or
process exit behavior.

### `ModulePath`

Normalized module/file identity used by module discovery.

Responsibilities:

- Represent an image entry file or imported module file.
- Expose a normalized `key` for comparisons.
- Expose a human-readable `display` name for diagnostics.
- Preserve a stable display path for diagnostics.
- Compare paths by normalized identity so cycles and duplicate imports can be
  detected.

`ModulePath` should not read the filesystem.

### `FileRepository`

File discovery interface.

```ts
interface FileRepository {
  read(path: ModulePath): Promise<FileReadResult>;
}
```

`FileReadResult` should distinguish:

- found source text
- missing file
- unreadable file

The production repository can use Bun's file APIs. Tests should use an
in-memory fake repository. The lexer module should not call `Bun.file(...)`
outside the production repository implementation.

### `ModuleResolver`

Resolves import specifiers relative to the importing module.

```ts
interface ModuleResolver {
  resolve(request: ModuleImportRequest): ModuleResolveResult;
}
```

For the initial language shape, imports come from syntax like:

```wr
use UefiFirmware from core.uefi
use BootError, Machine from core.boot
```

The resolver should support dotted module names such as `core.uefi` and local
module paths when the language grows them. It should normalize module identity
and report diagnostics for invalid or unresolved module requests.

### `ImportDiscovery`

Finds module import requests in a token stream.

Responsibilities:

- Scan only public lexer output.
- Find `use ... from <module>` forms.
- Return import requests with source spans for diagnostics.
- Recover gracefully from malformed import syntax.

`ImportDiscovery` is intentionally lighter than a parser. It only discovers
module fan-out; the real parser remains responsible for validating import
syntax completely.

### `ModuleGraphLexer`

Coordinates module graph lexing.

Responsibilities:

- Start from one image main file.
- Read it through `FileRepository`.
- Lex it with `Lexer`.
- Discover imports with `ImportDiscovery`.
- Resolve imports with `ModuleResolver`.
- Recurse through imported modules.
- Detect duplicate modules and cycles.
- Continue after missing or unreadable modules when possible.
- Return all lexed modules plus graph-level diagnostics.

`ModuleGraphLexer` should be deterministic for a given repository and resolver.
It should not directly use filesystem APIs.

## Lex Result

```ts
interface LexResult {
  source: SourceText;
  tokens: TokenStream;
}
```

Diagnostics are delivered through `DiagnosticSink`. Tests that need diagnostics
inject a fake sink and inspect what it captured.

## Module Graph Result

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

Diagnostics are delivered through `DiagnosticSink`. Missing imports, unreadable
files, duplicate canonical paths, import cycles, and malformed import discovery
should all produce diagnostics with useful spans when possible.

## Trivia Preservation

The lexer should preserve all source text.

This is required for:

- precise diagnostics
- future source maps
- future formatter support
- future editor tooling
- fuzz invariants
- lossless debugging of lexer behavior

Trivia preservation means comments and whitespace are not discarded. They are
attached to nearby tokens or stored in a well-defined EOF trivia position.

Trivia attachment rule for the first implementation:

- indentation whitespace is leading trivia on `Indent`, `Dedent`, or the first
  non-layout token of a logical line
- inline whitespace is leading trivia on the following token
- comments are leading trivia on the following token unless they appear after a
  token on the same line, in which case they are trailing trivia on that token
- physical line breaks are represented by explicit `Newline` tokens
- trivia after the last non-EOF token attaches to `Eof`

This gives the parser explicit layout tokens while preserving enough source
structure for exact reconstruction.

## Layout Tokens

The language examples use indentation. The lexer should emit layout tokens:

- `Newline`
- `Indent`
- `Dedent`

The parser should not need to count leading spaces itself.

Indentation rules:

- The lexer owns an indentation stack.
- A line with greater indentation emits `Indent`.
- A line with lower indentation emits one or more `Dedent`.
- Blank lines and comment-only lines do not change indentation.
- EOF emits any remaining `Dedent` tokens before `Eof`.
- Inconsistent indentation reports diagnostics and recovers deterministically.

The layout system can later be split into a separate layout processor if it
grows too large. For the first implementation, keeping it in `Lexer` is fine.

## Error Recovery

The lexer should prefer recovery over throwing. This applies to both source
lexing and module graph discovery.

Source lexing rules:

- Invalid characters produce diagnostics and an invalid/skipped token or trivia
  entry that preserves the source text.
- Unterminated strings produce diagnostics and a token spanning the recovered
  text.
- Invalid indentation produces diagnostics and deterministic layout tokens.
- Lexing should always reach exactly one `Eof`.

Module graph recovery rules:

- Missing imports produce diagnostics and do not stop lexing other reachable
  modules.
- Unreadable files produce diagnostics and do not stop lexing other reachable
  modules.
- Import cycles are recorded and not re-lexed. Lexing a cycle is not fatal; a
  later compiler layer can decide whether cycles are semantically legal.
- Duplicate imports resolve to one canonical `ModulePath` and are lexed once.
- Malformed import discovery produces diagnostics and continues scanning the
  rest of the file for later imports.
- A module with lexical errors can still contribute discovered imports when the
  import tokens are recoverable.

Only programmer errors in the TypeScript implementation should throw.

## Fuzzability

The lexer should be designed so fuzz tests can call:

```ts
import fc from "fast-check";

const diagnostics = new FakeDiagnosticSink();
const lexer = new Lexer({ keywords, diagnostics });
const result = lexer.lex(SourceText.from("fuzz.wr", input));
```

Fuzz tests should use `fast-check` and assert invariants, not specific token
sequences.

Core invariants:

- Lexing never throws for arbitrary string input.
- The token stream contains exactly one `Eof`.
- Token spans are monotonic.
- Token and trivia spans are within the source bounds.
- Token and trivia text reconstructs the original input.
- No token span overlaps incoherently with another token span.
- Diagnostics always have valid spans.
- `Indent` and `Dedent` tokens balance by EOF.
- All non-EOF tokens make progress.

Example Bun plus `fast-check` property:

```ts
import { describe, expect, test } from "bun:test";
import fc from "fast-check";

describe("lexer fuzz invariants", () => {
  test("never throws and preserves source text", () => {
    fc.assert(
      fc.property(fc.string(), (input) => {
        const diagnostics = new FakeDiagnosticSink();
        const lexer = new Lexer({ keywords, diagnostics });

        const result = lexer.lex(SourceText.from("fuzz.wr", input));

        expect(result.tokens.eofCount()).toBe(1);
        expect(result.tokens.reconstruct()).toBe(input);
      }),
      { numRuns: 5_000 },
    );
  });
});
```

Module graph fuzzing should use an in-memory fake `FileRepository`:

```ts
const files = new FakeFileRepository({
  "app/main.wr": "use A from app.a\nuefi image Main:",
  "app/a.wr": "use Main from app.main\n",
});

const result = await moduleLexer.lexImage({
  entry: ModulePath.from("app/main.wr"),
});
```

Module graph invariants:

- graph lexing never throws for arbitrary repository contents
- each canonical module path is lexed at most once
- missing modules produce diagnostics instead of exceptions
- cycles terminate
- import diagnostics have valid source spans when the importing source exists
- graph traversal order is deterministic
- all returned module token streams satisfy the source lexer invariants

## Testing Strategy

Use Bun's built-in test runner:

```ts
import { describe, expect, test } from "bun:test";
```

Property-based tests may import `fast-check`:

```ts
import fc from "fast-check";
```

### Unit Tests

Unit tests live in `tests/unit`.

Examples:

- `cursor.test.ts`: movement, peeking, EOF behavior, span creation.
- `source-text.test.ts`: line/column lookup, bounds behavior.
- `diagnostics.test.ts`: fake sink capture, diagnostic value shape.
- `import-discovery.test.ts`: `use ... from ...` discovery and malformed
  import recovery.
- `keyword-table.test.ts`: keyword lookup and identifier fallback.
- `module-resolver.test.ts`: dotted module names, local module names,
  normalization, and failed resolution.
- `token.test.ts`: immutable token construction and span behavior.
- `trivia.test.ts`: trivia construction and reconstruction.
- `token-stream.test.ts`: EOF guarantee and read-only access.

Unit tests should instantiate the class under test directly. Use small fakes for
dependencies. Do not use mocks.

### Integration Tests

Integration tests live in `tests/integration`.

`tests/integration/lexer.test.ts` should lex real snippets and assert full token
streams, trivia, diagnostics, and layout tokens.

`tests/integration/module-graph-lexer.test.ts` should start from an image main
file in a fake repository, fan out through imports, and assert lexed modules,
missing-file diagnostics, cycles, duplicate imports, and traversal order.

Coverage examples:

- keywords and identifiers
- import discovery from `use ... from ...`
- class and function declarations
- indentation and dedentation
- comments
- string and numeric literals
- invalid characters
- unterminated strings
- snippets from `docs/happy.md`
- property-based fuzz cases through `fast-check`

### System Tests

System tests live in `tests/system`.

These tests compose compiler layers through public APIs only. They are future
tests for workflows such as lex plus parse. They should not reach into lexer
internals.

## Fakes

Tests should use fakes instead of mocks.

Example fake diagnostic sink:

```ts
class FakeDiagnosticSink implements DiagnosticSink {
  readonly diagnostics: LexDiagnostic[] = [];

  report(diagnostic: LexDiagnostic): void {
    this.diagnostics.push(diagnostic);
  }
}
```

Example fake keyword table:

```ts
class FakeKeywordTable extends KeywordTable {
  constructor() {
    super(new Map([["class", TokenKind.Class]]));
  }
}
```

Fakes are small concrete classes with real behavior. They should not assert
call order or inspect private implementation details.

Example fake file repository:

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
      source: SourceText.from(path.display, text),
    };
  }
}
```

Example fake resolver:

```ts
class FakeModuleResolver implements ModuleResolver {
  resolve(request: ModuleImportRequest): ModuleResolveResult {
    return {
      kind: "resolved",
      path: ModulePath.from(`${request.moduleName}.wr`),
    };
  }
}
```

## Implementation Order

1. Add value objects: `SourceSpan`, `SourceText`, `Trivia`, `Token`.
2. Add `DiagnosticSink`, `LexDiagnostic`, and fakes for tests.
3. Add `Cursor`.
4. Add `KeywordTable`.
5. Add `TokenStream`.
6. Add `Lexer` with identifiers, keywords, punctuation, newlines, and EOF.
7. Add trivia preservation.
8. Add indentation tokens.
9. Add literals and error recovery.
10. Add `ImportDiscovery` for `use ... from ...`.
11. Add `ModulePath`, `FileRepository`, and `ModuleResolver`.
12. Add `ModuleGraphLexer`.
13. Add `fast-check` property tests for source lexing and module graph lexing.

## Design Constraints

- No external npm packages in `src`.
- `fast-check` is allowed as a dev-only dependency for tests.
- No filesystem access in source lexer core.
- No direct filesystem access in module graph code outside `FileRepository`
  implementations.
- No global mutable compiler services.
- No static singleton diagnostics.
- No hidden process state.
- No mocks in tests.
- No parser dependencies inside the lexer.
- No parser assumptions beyond public token shapes.

## Parser Boundary

The parser consumes lexer output through public values.

Preferred convenience path (recommended):

```ts
const lexResult = lexer.lex(source);
const parseResult = parser.parseLexResult({
  lexResult,
  lexerDiagnostics: diagnostics.diagnostics,
});
```

Explicit source-and-tokens path:

```ts
const parseResult = parser.parse({
  source: lexResult.source,
  tokens: lexResult.tokens,
  lexerDiagnostics: diagnostics.diagnostics,
});
```

The parser layer has its own root class, dependency object, tests, and
public module API at `src/frontend/parser/index.ts`. The compiler workflow
composes lexer and parser through the `src/frontend` barrel.
