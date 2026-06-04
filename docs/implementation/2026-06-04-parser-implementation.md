# Parser Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> `superpowers:subagent-driven-development` (recommended) or
> `superpowers:executing-plans` to implement this plan task by task. Each task
> is atomic, includes dependencies, acceptance criteria, and code examples, and
> is written so a junior engineer can take the task end to end.

**Goal:** Build the second compiler layer: a lossless, trivia-preserving parser
that consumes lexer `TokenStream` values and produces a red/green concrete
syntax tree with deterministic parser diagnostics and recovery.

**Architecture:** The source parser is pure compiler core. It accepts
`SourceText`, public lexer tokens, and optional lexer diagnostics. It returns a
`ParseResult` containing a `SyntaxTree` and a combined diagnostic view. The
parser does not read files, discover modules, typecheck, resolve names, or build
an independent semantic AST.

**Tech Stack:** TypeScript, Bun, `bun:test`, existing shared diagnostics and
source text/span value objects, existing lexer token streams, `fast-check` for
tests only, `oxlint`, and `oxfmt`.

---

## Research Notes

- `docs/design/parser-design.md` is the authoritative design for this plan.
- The current lexer implementation still lives in `src/lexer`, while the parser
  design expects `src/frontend/lexer`, `src/frontend/syntax`, and
  `src/frontend/parser`.
- Existing lexer tokens are immutable, preserve leading and trailing trivia, and
  reconstruct through `Token.reconstruct()` and `TokenStream.reconstruct()`.
- Existing `TokenStream.from(...)` enforces exactly one `TokenKind.Eof` as the
  final token.
- Existing diagnostics use the shared generic shape in `src/shared/diagnostics.ts`.
  Parser diagnostics should be `Diagnostic<ParseDiagnosticCode>` values.
- Current `TokenKind` does not include `break`, `ensure`, `true`, or `false`.
  Current parser tasks should treat those lexemes as identifiers unless a later
  lexer design explicitly adds keyword tokens.
- `docs/language/happy.md` covers the parser's current valid grammar surface:
  imports, enums, dataclasses, classes, edge classes, interfaces, streams,
  validated buffers, image declarations, fields, functions, platform signatures,
  requirements, multiline parameter lists, generics, blocks, `take`, `for`,
  `if let`, `match`, calls, object literals, type application, and `?` attempts.
- `docs/language/invalid.md` is mostly semantic invalid programs. Parser tests
  should still parse its code fences losslessly and should only emit parse
  diagnostics for structural syntax problems.
- `scripts/check-policy.ts` currently allows `Bun.file` only in
  `src/lexer/bun-file-repository.ts`; the frontend migration must update this
  path.
- Repository rules require fakes through dependency injection, no mocks, and
  `fast-check` only in tests.

## Parallel Execution Map

Use this map as a topological dispatch guide. Tasks in the same wave have no
intra-wave dependencies and own disjoint primary implementation files. If two
subagents discover they need the same file, stop and merge that work into one
task chain instead of racing edits.

| Wave | Tasks      | Notes                                                                     |
| ---- | ---------- | ------------------------------------------------------------------------- |
| 1    | 1          | Move lexer runtime source to the frontend layout.                         |
| 2    | 2, 3       | Move lexer tests and add public frontend barrels.                         |
| 3    | 4          | Define syntax vocabulary and total token mapping first.                   |
| 4    | 5, 6       | Green tokens/trivia and green nodes/diagnostics can run together.         |
| 5    | 7, 8       | Syntax factory and red wrappers can run together after green types exist. |
| 6    | 9          | SyntaxTree projection depends on red wrappers.                            |
| 7    | 10         | Test helpers depend on the complete syntax surface.                       |
| 8    | 11         | Parser diagnostic/result contracts depend on SyntaxTree.                  |
| 9    | 12         | ParserContext depends on diagnostics and factory contracts.               |
| 10   | 13, 14, 16 | Source-file skeleton, block helpers, and type parser own separate files.  |
| 11   | 15, 17, 22 | Import parsing, expression primary/postfix, and enums own separate files. |
| 12   | 18         | Pratt operators build on expression primary/postfix parsing.              |
| 13   | 19, 29     | Patterns and expression statements own separate files.                    |
| 14   | 20, 28     | Function signatures and starter-keyword statements own separate files.    |
| 15   | 21, 23, 24 | Function declarations, class declarations, and edge/stream declarations.  |
| 16   | 25, 26     | Images and validated-buffer params/layout own separate files.             |
| 17   | 27         | Validated-buffer derive/require builds on validated-buffer shell.         |
| 18   | 30         | If/while/for/take builds on statement and expression packets.             |
| 19   | 31         | Match builds on control statement foundations.                            |
| 20   | 32         | Full dispatcher wiring is single-owner.                                   |
| 21   | 33         | Recovery hardening is single-owner after real dispatch exists.            |
| 22   | 34         | Public API assembly is single-owner.                                      |
| 23   | 35, 39     | Graph parsing and docs can run after public APIs exist.                   |
| 24   | 36, 38     | Parser integration tests and system smoke can run after graph parsing.    |
| 25   | 37         | Fuzz tests build on parser integration helpers and invariants.            |
| 26   | 40         | Final gate is single-owner.                                               |

## File Responsibility Map

Create or modify these files as tasks require.

```text
src/index.ts
  Top-level package API. Re-export frontend and temporary compatibility APIs.

src/frontend/index.ts
  Frontend package barrel for lexer, syntax, parser, and graph parse helpers.

src/frontend/lexer/**
  Target location for existing lexer implementation.

src/lexer/**
  Temporary compatibility barrels only after migration.

src/frontend/syntax/index.ts
src/frontend/syntax/syntax-kind.ts
src/frontend/syntax/syntax-kind-map.ts
src/frontend/syntax/green-diagnostic.ts
src/frontend/syntax/green-trivia.ts
src/frontend/syntax/green-token.ts
src/frontend/syntax/green-node.ts
src/frontend/syntax/syntax-factory.ts
src/frontend/syntax/red-trivia.ts
src/frontend/syntax/red-token.ts
src/frontend/syntax/red-node.ts
src/frontend/syntax/syntax-tree.ts
  Reusable red/green syntax tree substrate.

src/frontend/parser/index.ts
src/frontend/parser/parser.ts
src/frontend/parser/parser-context.ts
src/frontend/parser/parser-diagnostics.ts
src/frontend/parser/expression-parser.ts
src/frontend/parser/type-parser.ts
src/frontend/parser/source-file-parser.ts
src/frontend/parser/declaration-parser.ts
src/frontend/parser/import-declaration-parser.ts
src/frontend/parser/function-signature-parser.ts
src/frontend/parser/function-declaration-parser.ts
src/frontend/parser/enum-declaration-parser.ts
src/frontend/parser/class-declaration-parser.ts
src/frontend/parser/edge-stream-declaration-parser.ts
src/frontend/parser/image-declaration-parser.ts
src/frontend/parser/validated-buffer-parser.ts
src/frontend/parser/validated-buffer-section-parser.ts
src/frontend/parser/block-parser.ts
src/frontend/parser/pattern-parser.ts
src/frontend/parser/statement-parser.ts
src/frontend/parser/binding-statement-parser.ts
src/frontend/parser/expression-statement-parser.ts
src/frontend/parser/control-statement-parser.ts
src/frontend/parser/match-statement-parser.ts
src/frontend/parser/parser-recovery.ts
  Parser implementation split by narrow file ownership. Leaf grammar tasks own
  their leaf parser file. Dispatcher and recovery tasks own the cross-module
  integration points.

src/frontend/module-graph-parser.ts
  Optional frontend orchestration over an already lexed module graph. It does
  not read files or resolve modules.

tests/support/frontend/**
  Fakes and invariants shared by frontend lexer, syntax, and parser tests.

tests/unit/frontend/lexer/**
tests/unit/frontend/syntax/**
tests/unit/frontend/parser/**
tests/integration/frontend/lexer/**
tests/integration/frontend/parser/**
tests/system/frontend/**
  Target test layout matching source module boundaries.

scripts/check-policy.ts
  Update the Bun.file allowlist for the frontend lexer repository edge.
```

## Shared Contract Decisions

All workers must use these names and contracts so separately implemented tasks
compose without later renaming.

### Parser Public API

```ts
const parser = new Parser();

const resultFromLex = parser.parseLexResult({
  lexResult,
  lexerDiagnostics,
});

const resultFromTokens = parser.parse({
  source,
  tokens,
  lexerDiagnostics,
});

expect(resultFromTokens.tree.reconstruct()).toBe(source.text);
```

### Parser Result Shape

```ts
interface ParseInput {
  source: SourceText;
  tokens: TokenStream;
  lexerDiagnostics?: readonly LexDiagnostic[];
}

interface ParseLexResultInput {
  lexResult: LexResult;
  lexerDiagnostics?: readonly LexDiagnostic[];
}

interface ParseResult {
  source: SourceText;
  tree: SyntaxTree;
  parserDiagnostics: readonly ParseDiagnostic[];
  diagnostics: readonly Diagnostic[];
}
```

### Existing Lexer Contract Imports

After Task 1 moves the lexer, parser code imports these contracts from
`src/frontend/lexer`.

```ts
import type { LexDiagnostic, LexResult, ModuleGraphLexResult } from "../lexer";
import type { ModulePath } from "../lexer";
import type { SourceText, TokenStream } from "../lexer";
```

The fields used by parser tasks are fixed.

```ts
interface LexResult {
  source: SourceText;
  tokens: TokenStream;
}

interface LexedModule {
  path: ModulePath;
  source: SourceText;
  tokens: TokenStream;
  imports: readonly ModuleImportRequest[];
}

interface ModuleGraphLexResult {
  entry: ModulePath;
  modules: readonly LexedModule[];
}
```

### Green Diagnostic Shape

```ts
interface GreenDiagnostic {
  code: ParseDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  relativeStart: number;
  relativeEnd: number;
}
```

### Parser Diagnostic Data Flow

Parser diagnostics have exactly one data path.

```text
ParserContext absolute draft diagnostics
  -> SyntaxFactory claims diagnostics while creating a GreenNode
  -> GreenNode stores GreenDiagnostic relative to that node
  -> SyntaxTree projects GreenDiagnostic to public ParseDiagnostic
  -> ParseResult combines parser diagnostics with caller lexer diagnostics
```

`ParserContext` may expose draft diagnostics to unit tests, but draft
diagnostics are not the public parser result. `ParseResult.parserDiagnostics`
must come from `SyntaxTree.diagnostics`.

```ts
interface DraftParseDiagnostic {
  code: ParseDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  absoluteStart: number;
  absoluteEnd: number;
}

interface ParserMark {
  offset: number;
  diagnosticStartIndex: number;
}
```

Every parser method that creates a green node follows this pattern.

```ts
const mark = context.mark();
const children: GreenElement[] = [];

children.push(context.expect(SyntaxKind.IdentifierToken));

return factory.nodeFromMark({
  context,
  mark,
  kind: SyntaxKind.NameExpression,
  children,
});
```

`nodeFromMark` computes the node absolute range from `mark.offset` to the current
parser offset and attaches only diagnostics claimed by this node. Claiming rules
are exact:

- Each draft diagnostic has an internal `claimed` boolean initialized to false.
- A node may claim only diagnostics with index greater than or equal to
  `mark.diagnosticStartIndex`.
- A node may claim only diagnostics whose absolute span is fully inside the node
  range. Zero-width diagnostics at the node end are inside the node.
- If a nested node already claimed a diagnostic, an outer node must not claim it
  again.
- Claimed diagnostics are converted to `GreenDiagnostic` by subtracting
  `mark.offset` from `absoluteStart` and `absoluteEnd`.
- Green-node diagnostic order is draft creation order. `SyntaxTree.diagnostics`
  projects and sorts by absolute start, absolute end, then code.
- Any unclaimed diagnostics left after source-file parsing are attached to the
  `SourceFile` root.

Parser diagnostic messages are deterministic and should use these templates
unless a task states a narrower message.

```text
PARSE_EXPECTED_TOKEN: Expected {expected}.
PARSE_EXPECTED_DECLARATION: Expected declaration.
PARSE_EXPECTED_EXPRESSION: Expected expression.
PARSE_UNEXPECTED_TOKEN: Unexpected token.
PARSE_UNTERMINATED_BLOCK: Unterminated block.
PARSE_RECOVERY_SKIPPED_TOKENS: Skipped unexpected tokens during recovery.
PARSE_NESTING_LIMIT_EXCEEDED: Parser nesting limit exceeded.
```

Diagnostic spans are exact:

```text
missing token before current token:
  zero-width at current token span.start

missing token at EOF:
  zero-width at source.length

unexpected consumed token:
  consumed token full span

skipped token group:
  span from first skipped token span.start to last skipped token span.end

unterminated block:
  zero-width at current token span.start, or source.length at EOF

nesting limit:
  zero-width at current token span.start
```

### Parser Depth Limit

`Parser` accepts an optional depth limit and defaults to 256.

```ts
interface ParserOptions {
  maxDepth?: number;
}

const DEFAULT_MAX_PARSE_DEPTH = 256;
```

`ParserContext.enterRecursion()` returns false when the current nested parse
depth is already at the limit. The caller must report
`PARSE_NESTING_LIMIT_EXCEEDED`, consume at least one token into an `ErrorNode` or
return a zero-width `MissingNode` at EOF, and then recover to the nearest
context synchronization set. Tests should also cover a small injected limit such
as `maxDepth: 3` so the behavior is deterministic and fast.

### Token Mapping Exhaustiveness

Task 4 must implement token mapping as a compile-time-total record.

```ts
const TOKEN_KIND_TO_SYNTAX_KIND = {
  [TokenKind.Identifier]: SyntaxKind.IdentifierToken,
  [TokenKind.Eof]: SyntaxKind.EndOfFileToken,
  // every TokenKind member appears here
} satisfies Record<TokenKind, SyntaxKind>;
```

Runtime tests still use `allTokenKinds()` to prove enum iteration and mapping
behavior, but the compile-time `satisfies Record<TokenKind, SyntaxKind>` check
is the primary exhaustiveness mechanism.

### Syntax Element Shape

```text
GreenNode
  kind: SyntaxKind
  width: number
  children: readonly GreenElement[]
  diagnostics: readonly GreenDiagnostic[]

GreenToken
  kind: SyntaxKind
  lexeme: string
  width: number
  leadingTrivia: readonly GreenTrivia[]
  trailingTrivia: readonly GreenTrivia[]
  isMissing: boolean

RedNode
  green: GreenNode
  parent: RedNode | undefined
  offset: number
  source: SourceText
  childIndex: number
```

### Token Kind Mapping

The `TokenKind -> SyntaxKind` map must be total. Use this naming pattern.

```text
TokenKind.Identifier -> SyntaxKind.IdentifierToken
TokenKind.IntegerLiteral -> SyntaxKind.IntegerLiteralToken
TokenKind.StringLiteral -> SyntaxKind.StringLiteralToken
TokenKind.Invalid -> SyntaxKind.InvalidToken
TokenKind.Use -> SyntaxKind.UseKeyword
TokenKind.From -> SyntaxKind.FromKeyword
TokenKind.Uefi -> SyntaxKind.UefiKeyword
TokenKind.Image -> SyntaxKind.ImageKeyword
TokenKind.Devices -> SyntaxKind.DevicesKeyword
TokenKind.Unique -> SyntaxKind.UniqueKeyword
TokenKind.Edge -> SyntaxKind.EdgeKeyword
TokenKind.Class -> SyntaxKind.ClassKeyword
TokenKind.Dataclass -> SyntaxKind.DataclassKeyword
TokenKind.Validated -> SyntaxKind.ValidatedKeyword
TokenKind.Buffer -> SyntaxKind.BufferKeyword
TokenKind.Stream -> SyntaxKind.StreamKeyword
TokenKind.Contains -> SyntaxKind.ContainsKeyword
TokenKind.Bound -> SyntaxKind.BoundKeyword
TokenKind.Enum -> SyntaxKind.EnumKeyword
TokenKind.Interface -> SyntaxKind.InterfaceKeyword
TokenKind.Constructor -> SyntaxKind.ConstructorKeyword
TokenKind.Fn -> SyntaxKind.FnKeyword
TokenKind.Private -> SyntaxKind.PrivateKeyword
TokenKind.Platform -> SyntaxKind.PlatformKeyword
TokenKind.Terminal -> SyntaxKind.TerminalKeyword
TokenKind.Predicate -> SyntaxKind.PredicateKeyword
TokenKind.Requires -> SyntaxKind.RequiresKeyword
TokenKind.Consume -> SyntaxKind.ConsumeKeyword
TokenKind.Params -> SyntaxKind.ParamsKeyword
TokenKind.Layout -> SyntaxKind.LayoutKeyword
TokenKind.Derive -> SyntaxKind.DeriveKeyword
TokenKind.Require -> SyntaxKind.RequireKeyword
TokenKind.At -> SyntaxKind.AtKeyword
TokenKind.Len -> SyntaxKind.LenKeyword
TokenKind.Else -> SyntaxKind.ElseKeyword
TokenKind.Otherwise -> SyntaxKind.OtherwiseKeyword
TokenKind.Let -> SyntaxKind.LetKeyword
TokenKind.If -> SyntaxKind.IfKeyword
TokenKind.Not -> SyntaxKind.NotKeyword
TokenKind.While -> SyntaxKind.WhileKeyword
TokenKind.For -> SyntaxKind.ForKeyword
TokenKind.In -> SyntaxKind.InKeyword
TokenKind.Loop -> SyntaxKind.LoopKeyword
TokenKind.Match -> SyntaxKind.MatchKeyword
TokenKind.Case -> SyntaxKind.CaseKeyword
TokenKind.Return -> SyntaxKind.ReturnKeyword
TokenKind.Yield -> SyntaxKind.YieldKeyword
TokenKind.Continue -> SyntaxKind.ContinueKeyword
TokenKind.Take -> SyntaxKind.TakeKeyword
TokenKind.As -> SyntaxKind.AsKeyword
TokenKind.With -> SyntaxKind.WithKeyword
TokenKind.LeftParen -> SyntaxKind.LeftParenToken
TokenKind.RightParen -> SyntaxKind.RightParenToken
TokenKind.LeftBrace -> SyntaxKind.LeftBraceToken
TokenKind.RightBrace -> SyntaxKind.RightBraceToken
TokenKind.LeftBracket -> SyntaxKind.LeftBracketToken
TokenKind.RightBracket -> SyntaxKind.RightBracketToken
TokenKind.Colon -> SyntaxKind.ColonToken
TokenKind.Comma -> SyntaxKind.CommaToken
TokenKind.Dot -> SyntaxKind.DotToken
TokenKind.Equals -> SyntaxKind.EqualsToken
TokenKind.Plus -> SyntaxKind.PlusToken
TokenKind.Minus -> SyntaxKind.MinusToken
TokenKind.Star -> SyntaxKind.StarToken
TokenKind.Slash -> SyntaxKind.SlashToken
TokenKind.Percent -> SyntaxKind.PercentToken
TokenKind.Less -> SyntaxKind.LessToken
TokenKind.Greater -> SyntaxKind.GreaterToken
TokenKind.Question -> SyntaxKind.QuestionToken
TokenKind.Arrow -> SyntaxKind.ArrowToken
TokenKind.FatArrow -> SyntaxKind.FatArrowToken
TokenKind.EqualsEquals -> SyntaxKind.EqualsEqualsToken
TokenKind.BangEquals -> SyntaxKind.BangEqualsToken
TokenKind.LessEquals -> SyntaxKind.LessEqualsToken
TokenKind.GreaterEquals -> SyntaxKind.GreaterEqualsToken
TokenKind.Newline -> SyntaxKind.NewlineToken
TokenKind.Indent -> SyntaxKind.IndentToken
TokenKind.Dedent -> SyntaxKind.DedentToken
TokenKind.Eof -> SyntaxKind.EndOfFileToken
```

### Node Kind Vocabulary

Workers may add a narrowly needed node kind while implementing a task, but these
names are the expected baseline.

```text
SourceFile
ImportDeclaration
ImportNameList
DottedModuleName
EnumDeclaration
EnumCase
DataclassDeclaration
ClassDeclaration
EdgeClassDeclaration
InterfaceDeclaration
StreamDeclaration
ValidatedBufferDeclaration
ImageDeclaration
FieldDeclaration
FunctionDeclaration
FunctionModifierList
ParameterList
Parameter
ReturnTypeClause
RequiresSection
DevicesSection
ParamsSection
LayoutSection
LayoutField
DeriveSection
DerivedField
DeriveCase
RequireSection
Requirement
Block
StatementList
LetStatement
IfStatement
ElseClause
WhileStatement
ForStatement
TakeStatement
MatchStatement
MatchCase
LoopStatement
ReturnStatement
YieldStatement
ContinueStatement
ExpressionStatement
AssignmentStatement
Condition
TypeReference
QualifiedName
TypeParameterList
TypeParameter
TypeArgumentList
Pattern
PatternList
ObjectLiteralExpression
ObjectField
CallArgumentList
NamedArgument
LiteralExpression
NameExpression
MemberAccessExpression
CallExpression
TypeApplicationExpression
AttemptExpression
UnaryExpression
BinaryExpression
ComparisonExpression
EqualityExpression
ElseRequirementExpression
ErrorNode
MissingNode
SkippedTokens
```

### CST Child Slot Schema

Children are ordered exactly as source appears. Optional syntax is represented
by an omitted child only when the grammar truly has no syntax at that position;
missing required syntax is represented by a missing token or `MissingNode`.
Repeated items include separator tokens as children so reconstruction remains
lossless.

```text
SourceFile:
  [topLevelItemOrNewlineOrError..., EndOfFileToken]

ImportDeclaration:
  [UseKeyword, ImportNameList, FromKeyword, DottedModuleName, NewlineToken?]
ImportNameList:
  [nameToken, (CommaToken, nameToken)*, CommaToken?]
DottedModuleName:
  [nameToken, (DotToken, nameToken)*]

EnumDeclaration:
  [EnumKeyword, nameToken, ColonToken, Block]
EnumCase:
  [nameToken, NewlineToken]

DataclassDeclaration:
  [DataclassKeyword, nameToken, TypeParameterList?, ColonToken, Block]
ClassDeclaration:
  [PrivateKeyword?, ClassKeyword, nameToken, TypeParameterList?, ColonToken, Block]
EdgeClassDeclaration:
  [UniqueKeyword?, EdgeKeyword, ClassKeyword, nameToken, TypeParameterList?, ColonToken, Block]
InterfaceDeclaration:
  [InterfaceKeyword, nameToken, TypeParameterList?, ColonToken, Block]
StreamDeclaration:
  [StreamKeyword, nameToken, ContainsKeyword, TypeReference, BoundKeyword, expression, ColonToken, Block]
ImageDeclaration:
  [UefiKeyword, ImageKeyword, nameToken, ColonToken, Block]

ValidatedBufferDeclaration:
  [ValidatedKeyword, BufferKeyword, nameToken, ColonToken, NewlineToken, IndentToken, sectionOrNewline*, DedentToken]
ParamsSection:
  [ParamsKeyword, ColonToken, Block]
LayoutSection:
  [LayoutKeyword, ColonToken, Block]
DeriveSection:
  [DeriveKeyword, ColonToken, Block]
RequireSection:
  [RequireKeyword, ColonToken, Block]
LayoutField:
  [nameToken, ColonToken, TypeReference, AtKeyword, expression, (LenKeyword, expression)?, NewlineToken]
DerivedField:
  [nameToken, ColonToken, TypeReference, FromKeyword, expression, ColonToken, Block]
DeriveCase:
  [expressionOrOtherwiseToken, FatArrowToken, expression, NewlineToken]
Requirement:
  [expression, NewlineToken]

FieldDeclaration:
  [nameToken, ColonToken, TypeReference, NewlineToken]
DevicesSection:
  [DevicesKeyword, ColonToken, Block]

FunctionDeclaration:
  [FunctionModifierList?, FnKeyword, nameToken, TypeParameterList?, ParameterList, ReturnTypeClause?, functionBodyOrRequiresOrNewline?]
FunctionModifierList:
  [modifierKeyword+]
ParameterList:
  [LeftParenToken, parameterOrNewline*, (CommaToken, parameterOrNewline*)*, CommaToken?, RightParenToken]
Parameter:
  [ConsumeKeyword?, nameToken, (ColonToken, TypeReference)?]
ReturnTypeClause:
  [ArrowToken, TypeReference]
RequiresSection:
  [RequiresKeyword, ColonToken, Block]

Block:
  [ColonToken?, NewlineToken?, IndentToken?, StatementList, DedentToken?]
StatementList:
  [statementOrDeclarationOrNewlineOrError*]

LetStatement:
  [LetKeyword, Pattern, (ColonToken, TypeReference)?, EqualsToken, expression, NewlineToken]
AssignmentStatement:
  [targetExpression, EqualsToken, valueExpression, NewlineToken]
ExpressionStatement:
  [expression, NewlineToken]
ReturnStatement:
  [ReturnKeyword, expression?, NewlineToken]
YieldStatement:
  [YieldKeyword, expression, NewlineToken]
ContinueStatement:
  [ContinueKeyword, NewlineToken]
LoopStatement:
  [LoopKeyword, ColonToken, Block]
IfStatement:
  [IfKeyword, Condition, ColonToken, Block, ElseClause?]
ElseClause:
  [ElseKeyword, (ColonToken, Block) | statement]
WhileStatement:
  [WhileKeyword, Condition, ColonToken, Block]
ForStatement:
  [ForKeyword, Pattern, InKeyword, expression, ColonToken, Block]
TakeStatement:
  [TakeKeyword, expression, (AsKeyword, nameToken)?, ColonToken, Block]
MatchStatement:
  [MatchKeyword, expression, ColonToken, NewlineToken, IndentToken, MatchCase*, DedentToken]
MatchCase:
  [CaseKeyword, Pattern, ColonToken, Block]
Condition:
  [expression] | [LetKeyword, Pattern, EqualsToken, expression]

TypeReference:
  [QualifiedName, TypeArgumentList?]
QualifiedName:
  [nameToken, (DotToken, nameToken)*]
TypeParameterList:
  [LeftBracketToken, TypeParameter (CommaToken, TypeParameter)*, CommaToken?, RightBracketToken]
TypeParameter:
  [nameToken, (ColonToken, TypeReference)?]
TypeArgumentList:
  [LeftBracketToken, TypeReference (CommaToken, TypeReference)*, CommaToken?, RightBracketToken]

Pattern:
  [QualifiedName, (LeftParenToken, PatternList?, RightParenToken)?]
PatternList:
  [Pattern (CommaToken, Pattern)*, CommaToken?]

LiteralExpression:
  [literalToken]
NameExpression:
  [nameToken]
MemberAccessExpression:
  [expression, DotToken, nameToken]
CallExpression:
  [calleeExpression, CallArgumentList]
CallArgumentList:
  [LeftParenToken, namedArgumentOrNewline*, (CommaToken, namedArgumentOrNewline*)*, CommaToken?, RightParenToken]
NamedArgument:
  [nameToken, EqualsToken, expression]
TypeApplicationExpression:
  [calleeExpression, TypeArgumentList]
ObjectLiteralExpression:
  [LeftBraceToken, objectFieldOrNewline*, (CommaToken, objectFieldOrNewline*)*, CommaToken?, RightBraceToken]
ObjectField:
  [nameToken, ColonToken, expression]
AttemptExpression:
  [expression, QuestionToken, errorExpression]
UnaryExpression:
  [operatorToken, expression]
BinaryExpression:
  [leftExpression, operatorToken, rightExpression]
ComparisonExpression:
  [leftExpression, operatorToken, rightExpression]
EqualityExpression:
  [leftExpression, operatorToken, rightExpression]
ElseRequirementExpression:
  [leftExpression, ElseKeyword, rightExpression]

ErrorNode:
  [preservedTokenOrNode+]
MissingNode:
  []
SkippedTokens:
  [preservedToken+]
```

### Diagnostic Codes

```text
PARSE_EXPECTED_TOKEN
PARSE_EXPECTED_DECLARATION
PARSE_EXPECTED_EXPRESSION
PARSE_UNEXPECTED_TOKEN
PARSE_UNTERMINATED_BLOCK
PARSE_RECOVERY_SKIPPED_TOKENS
PARSE_NESTING_LIMIT_EXCEEDED
```

### Expression Context Decisions

The Pratt parser is context-gated. Operators that are only legal in a grammar
section are disabled by default and enabled only by that section parser.

```ts
interface ExpressionContext {
  minimumBindingPower: number;
  allowElseRequirement: boolean;
  allowDeriveArrow: boolean;
  stopBeforeFatArrow: boolean;
  stopKinds: ReadonlySet<SyntaxKind>;
}
```

- `else` is active only when `allowElseRequirement === true`, used by
  `Requirement` parsing.
- `=>` is active only when `allowDeriveArrow === true`. The initial
  validated-buffer parser should parse derive cases explicitly by stopping the
  left expression before `=>`, consuming the arrow token, and parsing the right
  expression. Do not enable `=>` in ordinary expression contexts.
- Chained comparison and equality operators produce an `ErrorNode` containing
  the second operator and right expression, plus `PARSE_UNEXPECTED_TOKEN`. Do
  not silently build nested comparison/equality expressions.
- `case PacketKind.ping:` is parsed as a qualified-name `Pattern`, not as an
  expression case.

### Bracket Disambiguation Algorithm

Use this exact syntax-only decision procedure.

```text
Declaration context:
  after a declaration/type name, "[" starts TypeParameterList.

Type-reference context:
  after a QualifiedName, "[" starts TypeArgumentList.

Expression context:
  after a simple name/member callee, "[" may start TypeApplicationExpression
  only if lookahead can parse one or more TypeReference entries separated by
  commas and closed by "]" before newline, indent, dedent, EOF, or ":".

Otherwise:
  preserve the bracketed tokens under ErrorNode or SkippedTokens and emit
  PARSE_UNEXPECTED_TOKEN. Index expressions are not valid grammar yet.
```

Expression tasks must not use semantic information to decide between these
cases.

### Recovery And Synchronization Sets

Use these named constants rather than ad hoc arrays in parser code.

```ts
const topLevelStarterKinds = new Set([
  SyntaxKind.UseKeyword,
  SyntaxKind.EnumKeyword,
  SyntaxKind.DataclassKeyword,
  SyntaxKind.PrivateKeyword,
  SyntaxKind.UniqueKeyword,
  SyntaxKind.EdgeKeyword,
  SyntaxKind.ClassKeyword,
  SyntaxKind.InterfaceKeyword,
  SyntaxKind.StreamKeyword,
  SyntaxKind.ValidatedKeyword,
  SyntaxKind.UefiKeyword,
  SyntaxKind.FnKeyword,
]);

const declarationStarterKinds = new Set([
  ...topLevelStarterKinds,
  SyntaxKind.ConstructorKeyword,
  SyntaxKind.TerminalKeyword,
  SyntaxKind.PredicateKeyword,
  SyntaxKind.PlatformKeyword,
]);

const statementStarterKinds = new Set([
  SyntaxKind.LetKeyword,
  SyntaxKind.IfKeyword,
  SyntaxKind.WhileKeyword,
  SyntaxKind.ForKeyword,
  SyntaxKind.TakeKeyword,
  SyntaxKind.MatchKeyword,
  SyntaxKind.LoopKeyword,
  SyntaxKind.ReturnKeyword,
  SyntaxKind.YieldKeyword,
  SyntaxKind.ContinueKeyword,
]);

const blockBoundaryKinds = new Set([
  SyntaxKind.NewlineToken,
  SyntaxKind.DedentToken,
  SyntaxKind.EndOfFileToken,
]);

const expressionStopKinds = new Set([
  SyntaxKind.NewlineToken,
  SyntaxKind.IndentToken,
  SyntaxKind.DedentToken,
  SyntaxKind.EndOfFileToken,
  SyntaxKind.CommaToken,
  SyntaxKind.RightParenToken,
  SyntaxKind.RightBracketToken,
  SyntaxKind.RightBraceToken,
  SyntaxKind.ColonToken,
]);

const validatedBufferSectionStarterKinds = new Set([
  SyntaxKind.ParamsKeyword,
  SyntaxKind.LayoutKeyword,
  SyntaxKind.DeriveKeyword,
  SyntaxKind.RequireKeyword,
]);

const matchCaseBoundaryKinds = new Set([
  SyntaxKind.CaseKeyword,
  SyntaxKind.DedentToken,
  SyntaxKind.EndOfFileToken,
]);
```

Recovery helpers must always consume at least one token when the current token
is not a synchronization token and not EOF.

### Test Helper Contracts

Task 4 creates `allTokenKinds()` before token-mapping tests reference it. Task
10 creates the tree traversal helpers before parser tasks reference them.

```ts
function allTokenKinds(): TokenKind[];

function kindsInTree(tree: SyntaxTree): SyntaxKind[];

function findKind(tree: SyntaxTree, kind: SyntaxKind): RedNode | RedToken | undefined;

function expectValidSyntaxTree(context: {
  source: SourceText;
  tree: SyntaxTree;
  allowDiagnostics: boolean;
}): void;
```

`allTokenKinds()` filters the numeric values of the TypeScript enum. Tree
helpers traverse red nodes in source order and include both node and token
kinds.

### Per-Task Execution Checklist

Each task is one natural commit boundary for implementation work. If the branch
workflow uses commits, commit only after the task's acceptance criteria and
narrow tests pass.

```text
- [ ] Read this task, its dependencies, and referenced shared contracts.
- [ ] Write or update the narrow failing tests named in the task.
- [ ] Run the narrow test command and confirm the expected failure.
- [ ] Implement only the files owned by the task.
- [ ] Run the narrow test command and confirm it passes.
- [ ] Run related tests for direct dependencies if the task touched shared behavior.
- [ ] Update the task handoff note with files changed, tests run, and dependent-task notes.
```

Implementation tasks that add parser behavior must state exact owned files,
exported functions/classes, TDD steps with narrow `bun test ...` commands, AC,
and code examples or snippets. If a future task cannot name its narrow test
command yet, split it again before implementation.

### Reconstruction Invariant

```ts
expect(parseResult.tree.reconstruct()).toBe(source.text);
```

This invariant applies to valid code, invalid code, lexically invalid code,
fuzz input, files with comments, and files with EOF-generated dedents.

---

## Task 1: Move Lexer To Frontend Layout

**Dependencies:** None.

**Description:** Move existing lexer runtime source from `src/lexer` to
`src/frontend/lexer`, update imports to use the frontend path, and leave
`src/lexer` as temporary compatibility barrels. Update `scripts/check-policy.ts`
so the Bun file repository allowlist points at the new production file.

**Files:**

```text
src/frontend/lexer/**
src/frontend/index.ts
src/lexer/index.ts
src/lexer/*.ts
src/index.ts
scripts/check-policy.ts
```

**AC:**

- Existing lexer tests pass from the new `src/frontend/lexer` implementation.
- `import { Lexer } from "../../src/frontend/lexer"` works in tests.
- Existing public compatibility imports from `src/lexer` still work.
- `src/index.ts` exposes the frontend API without dropping current lexer exports.
- `scripts/check-policy.ts` allows `Bun.file` only at
  `src/frontend/lexer/bun-file-repository.ts` and the policy script itself.
- No runtime source outside the file repository edge calls `Bun.file`.
- Do not move tests in this task; Task 2 owns all test-path churn.

**Code Examples:**

```ts
// New preferred import path.
import { Lexer, SourceText, TokenKind } from "../../src/frontend/lexer";

// Temporary compatibility path remains valid during parser work.
import { Lexer as CompatLexer } from "../../src/lexer";
```

```ts
// Compatibility barrel shape only. Do not duplicate implementation logic here.
export * from "../frontend/lexer";
```

## Task 2: Move Existing Lexer Tests Into Frontend Test Layout

**Dependencies:** Task 1.

**Description:** Move existing lexer unit, integration, support, and system tests
into the target `tests/**/frontend/lexer` and `tests/support/frontend` layout.
Update all imports to preferred frontend source paths.

**Files:**

```text
tests/unit/frontend/lexer/**
tests/integration/frontend/lexer/**
tests/system/frontend/**
tests/support/frontend/**
```

**AC:**

- No lexer tests remain in broad legacy locations except temporary forwarding
  files if needed for a short transition.
- Test names still describe the same behavior as before the move.
- `bun test ./tests/unit/frontend/lexer` passes.
- `bun test ./tests/integration/frontend/lexer` passes.
- `bun test ./tests/system/frontend` passes.

**Code Examples:**

```ts
import { describe, expect, test } from "bun:test";
import { KeywordTable, Lexer, SourceText, TokenKind } from "../../../../src/frontend/lexer";
import { expectValidLexerResult } from "../../../support/frontend/lexer-invariants";
```

## Task 3: Add Frontend Barrel And Public Compatibility Tests

**Dependencies:** Task 1.

**Description:** Add a frontend-level barrel that re-exports `lexer`, `syntax`,
and `parser` as they become available. Start with lexer exports and add tests
that pin the preferred public paths.

**Files:**

```text
src/frontend/index.ts
src/index.ts
tests/integration/frontend/public-api.test.ts
```

**AC:**

- `src/frontend/index.ts` exists and exports lexer symbols.
- `src/index.ts` exports `frontend` as a namespace and keeps current top-level
  lexer exports compatible.
- Public API tests can import from both `src/frontend` and `src/frontend/lexer`.
- The task does not introduce parser or syntax stub behavior beyond barrels
  that compile.

**Code Examples:**

```ts
import * as frontend from "../../../src/frontend";

expect(frontend.Lexer).toBeDefined();
expect(frontend.TokenKind).toBeDefined();
```

## Task 4: Add SyntaxKind And Total Token Mapping

**Dependencies:** Task 1.

**Description:** Create the syntax kind vocabulary and a total mapping from
lexer `TokenKind` to token-like `SyntaxKind`. Include predicates for token-like
and node-like kinds.

**Files:**

```text
src/frontend/syntax/syntax-kind.ts
src/frontend/syntax/syntax-kind-map.ts
src/frontend/syntax/index.ts
tests/unit/frontend/syntax/syntax-kind.test.ts
tests/support/frontend/token-kind-helpers.ts
```

**AC:**

- Every current `TokenKind` member maps to exactly one `SyntaxKind`.
- Mapping is implemented with
  `satisfies Record<TokenKind, SyntaxKind>` so TypeScript catches missing
  entries at compile time.
- Missing tokens use the expected syntax token kind plus an `isMissing` flag,
  not a single undifferentiated missing token kind.
- Tests fail if a future lexer token is added without a syntax mapping.
- `isTokenSyntaxKind` returns true only for token-like syntax kinds.
- `isNodeSyntaxKind` returns true only for node-like syntax kinds.
- `allTokenKinds()` is available from test support and returns all numeric
  `TokenKind` enum values exactly once.

**Code Examples:**

```ts
const TOKEN_KIND_TO_SYNTAX_KIND = {
  [TokenKind.Identifier]: SyntaxKind.IdentifierToken,
  [TokenKind.Eof]: SyntaxKind.EndOfFileToken,
  // include every TokenKind member
} satisfies Record<TokenKind, SyntaxKind>;
```

```ts
function allTokenKinds(): TokenKind[] {
  return Object.values(TokenKind).filter((value): value is TokenKind => typeof value === "number");
}
```

```ts
expect(syntaxKindFromTokenKind(TokenKind.Identifier)).toBe(SyntaxKind.IdentifierToken);
expect(syntaxKindFromTokenKind(TokenKind.Uefi)).toBe(SyntaxKind.UefiKeyword);
expect(syntaxKindFromTokenKind(TokenKind.Eof)).toBe(SyntaxKind.EndOfFileToken);
```

```ts
for (const tokenKind of allTokenKinds()) {
  expect(() => syntaxKindFromTokenKind(tokenKind)).not.toThrow();
}
```

## Task 5: Implement Green Trivia And Green Tokens

**Dependencies:** Tasks 1, 4.

**Description:** Add immutable green trivia and green token value objects that
wrap lexer trivia/token information without losing identity, trivia text, token
lexeme, width, or missing-token behavior.

**Files:**

```text
src/frontend/syntax/green-trivia.ts
src/frontend/syntax/green-token.ts
src/frontend/syntax/index.ts
tests/unit/frontend/syntax/green-token.test.ts
```

**AC:**

- `GreenTrivia` preserves trivia kind, lexeme, span length, and reconstruction.
- `GreenToken.fromToken(token)` preserves token syntax kind, lexeme, trivia, and
  total reconstructed text.
- `GreenToken.missing(expectedKind)` has zero width, empty reconstruction, and
  `isMissing === true`.
- Constructed green tokens are immutable from caller-owned array mutation.
- Tests cover regular tokens, tokens with leading/trailing trivia, EOF tokens,
  and missing tokens.

**Code Examples:**

```ts
const greenToken = GreenToken.fromToken(token);

expect(greenToken.kind).toBe(SyntaxKind.IdentifierToken);
expect(greenToken.reconstruct()).toBe(token.reconstruct());
expect(greenToken.width).toBe(token.reconstruct().length);
```

```ts
const missingColon = GreenToken.missing(SyntaxKind.ColonToken);

expect(missingColon.isMissing).toBe(true);
expect(missingColon.width).toBe(0);
expect(missingColon.reconstruct()).toBe("");
```

## Task 6: Implement Green Nodes And Relative Diagnostics

**Dependencies:** Task 4.

**Description:** Add immutable green nodes that store kind, ordered children,
width, and relative diagnostics. Width must always equal the sum of child
widths. Diagnostics must be immutable and relative to the node.

**Files:**

```text
src/frontend/syntax/green-diagnostic.ts
src/frontend/syntax/green-node.ts
src/frontend/syntax/index.ts
tests/unit/frontend/syntax/green-node.test.ts
```

**AC:**

- `GreenNode` accepts only node-like `SyntaxKind` values.
- Width is computed from child widths and cannot be manually corrupted.
- Children and diagnostics are defensively copied.
- Relative diagnostics reject negative starts and end-before-start ranges.
- A node reconstructs by concatenating child reconstruction in source order.

**Code Examples:**

```ts
const node = new GreenNode({
  kind: SyntaxKind.SourceFile,
  children: [identifierToken, eofToken],
  diagnostics: [],
});

expect(node.width).toBe(identifierToken.width + eofToken.width);
expect(node.reconstruct()).toBe("Name");
```

## Task 7: Implement Syntax Factory Builders

**Dependencies:** Tasks 5, 6.

**Description:** Add a central syntax factory for creating green tokens, missing
tokens, green nodes, error nodes, missing nodes, and skipped-token nodes. Parser
modules must use the factory rather than constructing syntax classes directly.

**Files:**

```text
src/frontend/syntax/syntax-factory.ts
src/frontend/syntax/index.ts
tests/unit/frontend/syntax/syntax-factory.test.ts
```

**AC:**

- Factory can wrap lexer tokens into green tokens.
- Factory can create missing tokens with `PARSE_EXPECTED_TOKEN` diagnostics when
  caller supplies expected context.
- Factory can create `SkippedTokens` nodes from one or more tokens.
- Factory can create `ErrorNode` and `MissingNode` without source text loss.
- Tests prove skipped tokens reconstruct exactly to their source tokens.

**Code Examples:**

```ts
const skipped = factory.skippedTokens([unexpectedToken], {
  code: "PARSE_RECOVERY_SKIPPED_TOKENS",
  message: "Skipped unexpected token.",
  severity: "error",
});

expect(skipped.kind).toBe(SyntaxKind.SkippedTokens);
expect(skipped.reconstruct()).toBe(unexpectedToken.reconstruct());
```

## Task 8: Implement Red Tokens, Red Trivia, And Red Nodes

**Dependencies:** Tasks 5, 6.

**Description:** Add red wrappers over green tokens, trivia, and nodes. Red
wrappers provide source, parent, child index, absolute offset, spans, text, and
navigation. Do not promise stable wrapper identity for repeated navigation.

**Files:**

```text
src/frontend/syntax/red-trivia.ts
src/frontend/syntax/red-token.ts
src/frontend/syntax/red-node.ts
src/frontend/syntax/index.ts
tests/unit/frontend/syntax/red-node.test.ts
```

**AC:**

- Red node span is absolute and equals `[offset, offset + green.width)`.
- `child(index)` returns red nodes or red tokens with correct offsets.
- `children()` returns all red child elements in source order.
- `parent` and `childIndex` are correct for child wrappers.
- Repeated navigation may return different wrapper objects but equivalent
  coordinates.
- Red tokens expose leading/trailing trivia accessors with correct absolute
  spans.

**Code Examples:**

```ts
const root = tree.root();
const childA = root.child(0);
const childB = root.child(0);

expect(childA?.kind).toBe(childB?.kind);
expect(childA?.span.start).toBe(childB?.span.start);
expect(childA).not.toBeUndefined();
```

## Task 9: Implement SyntaxTree Projection And Reconstruction

**Dependencies:** Tasks 6, 8.

**Description:** Add `SyntaxTree` as the public owner of a green root and source
text. It should produce red roots lazily, reconstruct source text, and project
relative green diagnostics into shared absolute diagnostics.

**Files:**

```text
src/frontend/syntax/syntax-tree.ts
src/frontend/syntax/index.ts
tests/unit/frontend/syntax/syntax-tree.test.ts
```

**AC:**

- `tree.root()` returns a red root node with offset 0 and the tree source.
- `tree.reconstruct()` concatenates the green tree and equals source text in
  tests.
- `tree.diagnostics` returns parser diagnostics sorted by absolute source span
  start, then end, then code.
- Projected diagnostics use the tree `SourceText` object.
- Diagnostic projection handles zero-width diagnostics at EOF.

**Code Examples:**

```ts
const tree = new SyntaxTree({ source, greenRoot });

expect(tree.root().span.start).toBe(0);
expect(tree.root().span.end).toBe(source.length);
expect(tree.reconstruct()).toBe(source.text);
expect(tree.diagnostics[0]?.source).toBe(source);
```

## Task 10: Add Syntax Test Invariants

**Dependencies:** Tasks 7, 8, 9.

**Description:** Add reusable test helpers for syntax-tree invariants, enum
exhaustiveness, and tree queries that parser and fuzz tests can call. These
helpers belong in test support only.

**Files:**

```text
tests/support/frontend/syntax-invariants.ts
tests/support/frontend/syntax-tree-queries.ts
```

**AC:**

- Helper verifies reconstruction equals source text.
- Helper verifies green node widths equal child widths recursively.
- Helper verifies red spans are monotonic and in source bounds.
- Helper verifies diagnostics are in source bounds.
- Helper verifies repeated red navigation returns equivalent coordinates.
- `kindsInTree(tree)` traverses red syntax in source order and includes node and
  token kinds.
- `findKind(tree, kind)` returns the first red node or token with that kind.

**Code Examples:**

```ts
expectValidSyntaxTree({
  source,
  tree,
  allowDiagnostics: true,
});
```

```ts
expect(kindsInTree(tree)).toContain(SyntaxKind.SourceFile);
expect(findKind(tree, SyntaxKind.EndOfFileToken)).toBeDefined();
```

```ts
function kindsInTree(tree: SyntaxTree): SyntaxKind[] {
  const result: SyntaxKind[] = [];
  visit(tree.root(), result);
  return result;
}

function visit(element: RedNode | RedToken, result: SyntaxKind[]): void {
  result.push(element.kind);
  if (element instanceof RedNode) {
    for (const child of element.children()) {
      visit(child, result);
    }
  }
}
```

## Task 11: Add Parser Diagnostics And ParseResult Contracts

**Dependencies:** Task 9.

**Description:** Add parser diagnostic code types, parser diagnostic aliases,
diagnostic creation helpers, `ParseInput`, `ParseLexResultInput`, and
`ParseResult` contracts.

**Files:**

```text
src/frontend/parser/parser-diagnostics.ts
src/frontend/parser/parser.ts
src/frontend/parser/index.ts
tests/unit/frontend/parser/parser-diagnostics.test.ts
```

**AC:**

- Parser diagnostic codes match the shared contract list in this plan.
- Parser diagnostics use `Diagnostic<ParseDiagnosticCode>` at public API edges.
- ParserContext draft diagnostics are claimed into green nodes through
  `SyntaxFactory.nodeFromMark`; `ParseResult.parserDiagnostics` is projected
  from `SyntaxTree.diagnostics`.
- `ParseResult.diagnostics` can combine lexer diagnostics and parser diagnostics
  while preserving code prefixes.
- Combined diagnostics are sorted by source span start, span end, then code.
- Tests cover parser-only diagnostics, lexer-only diagnostics, and mixed
  diagnostics at the same source position.

**Code Examples:**

```ts
expect(result.parserDiagnostics.every((diagnostic) => diagnostic.code.startsWith("PARSE_"))).toBe(
  true,
);
expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
  "LEX_INVALID_CHARACTER",
  "PARSE_EXPECTED_TOKEN",
]);
```

## Task 12: Implement ParserContext Navigation, Expectation, And Depth Limits

**Dependencies:** Tasks 7, 11.

**Description:** Add `ParserContext` to wrap token navigation, lookahead,
consume, expected-token insertion, diagnostics, synchronization, and recursion
depth guards. It consumes public lexer tokens only.

**Files:**

```text
src/frontend/parser/parser-context.ts
src/frontend/parser/parser-recovery.ts
tests/unit/frontend/parser/parser-context.test.ts
```

**AC:**

- `peek(0)` returns the current lexer token and never skips source tokens.
- `consume()` advances exactly one token and returns a green token.
- `expect(kind)` consumes matching tokens or returns a missing token with
  `PARSE_EXPECTED_TOKEN`.
- Missing-token diagnostics are zero width at the current token start.
- Recovery helpers collect unexpected tokens into `SkippedTokens` and always
  make progress unless at EOF.
- Depth guard emits `PARSE_NESTING_LIMIT_EXCEEDED` and recovers without throwing
  JavaScript stack errors.

**Code Examples:**

```ts
const mark = parserContext.mark();
const colon = parserContext.expect(SyntaxKind.ColonToken);

expect(colon.isMissing).toBe(true);
expect(parserContext.draftDiagnostics()[0]?.code).toBe("PARSE_EXPECTED_TOKEN");
expect(parserContext.currentSyntaxKind()).toBe(SyntaxKind.NewlineToken);

const node = factory.nodeFromMark({
  context: parserContext,
  mark,
  kind: SyntaxKind.MissingNode,
  children: [colon],
});

expect(node.diagnostics[0]?.code).toBe("PARSE_EXPECTED_TOKEN");
```

```ts
const skipped = parserContext.skipUntil([
  SyntaxKind.NewlineToken,
  SyntaxKind.DedentToken,
  SyntaxKind.EndOfFileToken,
]);

expect(skipped.kind).toBe(SyntaxKind.SkippedTokens);
expect(skipped.width).toBeGreaterThan(0);
```

```ts
function parseWithDepthLimit<T>(context: ParserContext, parseNested: () => T, recover: () => T): T {
  if (!context.enterRecursion()) {
    context.reportAtCurrent("PARSE_NESTING_LIMIT_EXCEEDED", "Parser nesting limit exceeded.");
    return recover();
  }

  try {
    return parseNested();
  } finally {
    context.exitRecursion();
  }
}
```

## Task 13: Implement Parser Entry And SourceFile Dispatch

**Dependencies:** Tasks 11, 12.

**Description:** Implement `Parser.parse(...)`, `Parser.parseLexResult(...)`,
`SourceFile` parsing, top-level newline preservation, EOF handling, and
top-level recovery. This task creates the source-file loop and a declaration
dispatcher seam. Leaf grammar tasks may wire their own starter for narrow
integration tests; Task 32 owns the final full-dispatch audit.

**Files:**

```text
src/frontend/parser/parser.ts
src/frontend/parser/source-file-parser.ts
tests/unit/frontend/parser/parser-entry.test.ts
tests/integration/frontend/parser/source-file.test.ts
```

**AC:**

- Empty source parses to `SourceFile` containing EOF and reconstructs exactly.
- Top-level newlines are preserved as syntax tokens.
- Non-newline, non-EOF top-level tokens become `SkippedTokens` or `ErrorNode`
  children until a later grammar task wires a concrete parser.
- EOF is consumed exactly once as `SyntaxKind.EndOfFileToken`.
- `parseLexResult` uses `lexResult.source` and `lexResult.tokens`.
- Unit tests for leaf grammar tasks may call leaf parser functions directly
  before their narrow dispatch integration test exists.

**Code Examples:**

```ts
const result = parser.parse({
  source: SourceText.from("main.wr", "\nuefi image Main:\n"),
  tokens,
});

expect(result.tree.root().kind).toBe(SyntaxKind.SourceFile);
expect(result.tree.reconstruct()).toBe(source.text);
```

## Task 14: Implement Newline, Layout, And Block Helpers

**Dependencies:** Task 12.

**Description:** Implement shared block parsing helpers for `":" Newline Indent
... Dedent`, bodyless signatures that end at newline, extra blank-line
preservation, EOF-generated dedent handling, and unterminated block diagnostics.

**Files:**

```text
src/frontend/parser/block-parser.ts
src/frontend/parser/parser-recovery.ts
tests/unit/frontend/parser/block-parser.test.ts
```

**AC:**

- A normal block consumes colon, newline, indent, block items, and matching
  dedent.
- Blank lines inside blocks remain syntax tokens in the block or statement list.
- Bodyless declarations may consume a terminating newline without requiring an
  indent.
- Missing dedent or EOF inside a block emits `PARSE_UNTERMINATED_BLOCK`.
- Recovery inside a block synchronizes on newline, dedent, or EOF and preserves
  skipped tokens.

**Code Examples:**

```wr
fn tick(self):
    loop:
        continue
```

```ts
expect(findKind(tree, SyntaxKind.Block)).toBeDefined();
expect(result.tree.reconstruct()).toBe(source.text);
```

## Task 15: Implement Import Declarations

**Dependencies:** Tasks 12, 13.

**Description:** Parse `use` declarations with one or more import names,
commas, `from`, dotted module names, and terminating newlines. Dotted module
segments may be identifiers or keyword tokens such as `uefi`.

**Files:**

```text
src/frontend/parser/import-declaration-parser.ts
tests/unit/frontend/parser/import-declaration-parser.test.ts
tests/integration/frontend/parser/import-dispatch.test.ts
```

**Exports:**

```ts
parseImportDeclaration(context: ParserContext): GreenNode;
parseImportNameList(context: ParserContext): GreenNode;
parseDottedModuleName(context: ParserContext): GreenNode;
```

**TDD Steps:**

```text
- [ ] Add unit tests for single import, multiple imports, keyword module segment, missing name, and missing module segment.
- [ ] Run `bun test ./tests/unit/frontend/parser/import-declaration-parser.test.ts`; expect failure.
- [ ] Implement import-declaration-parser.ts.
- [ ] Wire `use` into declaration-parser.ts and add import-dispatch integration assertion.
- [ ] Run `bun test ./tests/unit/frontend/parser/import-declaration-parser.test.ts ./tests/integration/frontend/parser/import-dispatch.test.ts`; expect pass.
```

**AC:**

- `use UefiFirmware from core.uefi` produces `ImportDeclaration`,
  `ImportNameList`, and `DottedModuleName`.
- Multiple imported names preserve comma tokens.
- Missing import names, missing `from`, and missing module segments emit parser
  diagnostics and recover at newline or EOF.
- Keywords are accepted as dotted module name segments after dots.
- Reconstruction is exact for valid and malformed import declarations.
- Integration test wires `use` through the declaration dispatcher and asserts
  `Parser.parse(...)` reaches `ImportDeclaration`.

**Code Examples:**

```wr
use BootError, Machine from core.boot
use UefiFirmware from core.uefi
```

```ts
expect(kindsInTree(tree)).toContain(SyntaxKind.ImportDeclaration);
expect(kindsInTree(tree)).toContain(SyntaxKind.DottedModuleName);
```

## Task 16: Implement Qualified Names, Type References, And Generic Lists

**Dependencies:** Task 12.

**Description:** Implement `type-parser.ts` for qualified names, type
references, type parameter lists, type parameters with bounds, type argument
lists, and context-based bracket disambiguation.

**Files:**

```text
src/frontend/parser/type-parser.ts
tests/unit/frontend/parser/type-parser.test.ts
```

**AC:**

- `Result[Never, BootError]` parses as `TypeReference` with `TypeArgumentList`.
- `MoveRing[T: CoreMovableOwned]` in declaration context parses
  `TypeParameterList`.
- Qualified type names preserve dot tokens and allow keyword member names after
  dots.
- Multiline generic lists preserve newline tokens between elements.
- Missing closing `]` emits `PARSE_EXPECTED_TOKEN` and recovers at `]`, `)`,
  `:`, comma, newline, or EOF.
- Index expressions are not accepted as valid type syntax; unsupported brackets
  are preserved through error nodes when they appear outside type contexts.

**Code Examples:**

```ts
function parseBracketAfterName(context: TypeParseContext): GreenNode {
  if (context.mode === "declaration") {
    return parseTypeParameterList(context);
  }

  if (context.mode === "type-reference") {
    return parseTypeArgumentList(context);
  }

  return parseUnsupportedBracketError(context);
}
```

```wr
class MoveRing[T: CoreMovableOwned]:
    fn split(consume self) -> MoveRingPaths[T]
```

```ts
expect(kindsInTree(tree)).toContain(SyntaxKind.TypeParameterList);
expect(kindsInTree(tree)).toContain(SyntaxKind.TypeArgumentList);
```

## Task 17: Implement Expression Primary, Postfix, Calls, And Objects

**Dependencies:** Tasks 12, 16.

**Description:** Implement expression primaries and postfix forms: literals,
names, object literals, member access, named call arguments, call expressions,
and expression-context type application.

**Files:**

```text
src/frontend/parser/expression-parser.ts
tests/unit/frontend/parser/expression-postfix.test.ts
```

**AC:**

- Identifiers, integer literals, string literals, and keyword-like boolean
  lexemes that currently lex as identifiers parse as expressions.
- Member access accepts identifiers and keyword tokens as member names.
- Named argument calls parse `callee(name=value, other=value)` and preserve
  commas and multiline newlines.
- Object literals parse `{ name: expression, ... }` and preserve optional
  trailing commas.
- `MoveRing[Packet].new(max=64)` parses as type application followed by member
  access and call.
- Invalid or unsupported postfix brackets recover without losing source text.

**Code Examples:**

```wr
PacketCounter.new(paths=paths)
u64.saturating_add(
    lhs=self.ping_count,
    rhs=1,
)
devices={
    net0: net0,
}
```

```ts
expect(kindsInTree(tree)).toContain(SyntaxKind.CallExpression);
expect(kindsInTree(tree)).toContain(SyntaxKind.MemberAccessExpression);
expect(kindsInTree(tree)).toContain(SyntaxKind.ObjectLiteralExpression);
```

## Task 18: Implement Pratt Operators And Expression Recovery

**Dependencies:** Task 17.

**Description:** Complete Pratt parsing for the design binding-power table:
unary `not` and `-`, arithmetic, comparison, equality, requirement `else`,
derive `=>`, and postfix attempt `? ErrorExpr`. Add deterministic expression
stopping rules.

**Files:**

```text
src/frontend/parser/expression-parser.ts
tests/unit/frontend/parser/expression-operators.test.ts
```

**AC:**

- Arithmetic precedence follows the design table.
- Comparison and equality are non-associative; chained forms produce an
  `ErrorNode` for the second operator/right operand and emit
  `PARSE_UNEXPECTED_TOKEN`.
- `source.len >= 2 else PacketReject(...)` parses with
  `ElseRequirementExpression`.
- `0 => PacketKind.ping` parses in derive-case context without consuming the
  next line.
- `firmware.exit(machine_plan=machine_plan)? BootError.ExitFailed` parses as a
  single statement expression with `AttemptExpression`.
- Expressions stop at newline, indent, dedent, EOF, comma, `)`, `]`, `}`, and
  `:` unless the active expression context owns the delimiter.

**Code Examples:**

```ts
const BINARY_OPERATORS = {
  [SyntaxKind.StarToken]: { left: 60, right: 61, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.PlusToken]: { left: 50, right: 51, node: SyntaxKind.BinaryExpression },
  [SyntaxKind.LessEqualsToken]: {
    left: 40,
    right: 41,
    node: SyntaxKind.ComparisonExpression,
    nonAssociative: true,
  },
  [SyntaxKind.EqualsEqualsToken]: {
    left: 35,
    right: 36,
    node: SyntaxKind.EqualityExpression,
    nonAssociative: true,
  },
} satisfies Partial<Record<SyntaxKind, BinaryOperatorInfo>>;
```

```ts
function parseExpression(context: ParserContext, expressionContext: ExpressionContext): GreenNode {
  let left = parsePrefixOrPrimary(context, expressionContext);

  while (!shouldStopExpression(context, expressionContext)) {
    const operator = currentOperatorInfo(context, expressionContext);
    if (operator === undefined || operator.left < expressionContext.minimumBindingPower) {
      break;
    }

    const operatorToken = context.consume();
    const right = parseExpression(context, {
      ...expressionContext,
      minimumBindingPower: operator.right,
    });

    left = factory.node(operator.node, [left, operatorToken, right]);
  }

  return left;
}
```

```ts
function currentOperatorInfo(
  context: ParserContext,
  expressionContext: ExpressionContext,
): BinaryOperatorInfo | undefined {
  if (context.currentSyntaxKind() === SyntaxKind.ElseKeyword) {
    return expressionContext.allowElseRequirement
      ? { left: 20, right: 20, node: SyntaxKind.ElseRequirementExpression }
      : undefined;
  }

  if (context.currentSyntaxKind() === SyntaxKind.FatArrowToken) {
    return expressionContext.allowDeriveArrow
      ? { left: 10, right: 10, node: SyntaxKind.DeriveCase }
      : undefined;
  }

  return BINARY_OPERATORS[context.currentSyntaxKind()];
}
```

```wr
source.len >= 2 else PacketReject(error=PacketError.too_short)
firmware.reserve_restricted_memory()? BootError.Memory
layout.fits
```

```ts
expect(kindsInTree(tree)).toContain(SyntaxKind.ComparisonExpression);
expect(kindsInTree(tree)).toContain(SyntaxKind.ElseRequirementExpression);
expect(kindsInTree(tree)).toContain(SyntaxKind.AttemptExpression);
```

## Task 19: Implement Patterns And Conditions

**Dependencies:** Tasks 16, 18.

**Description:** Implement pattern parsing for identifiers, qualified
constructor patterns with nested pattern lists, receiver-like `self`, and
condition parsing for plain expressions and `let Pattern = Expression`.

**Files:**

```text
src/frontend/parser/pattern-parser.ts
tests/unit/frontend/parser/pattern-condition-parser.test.ts
```

**AC:**

- `let validation = ...` parses a pattern in let statements.
- `if let slot = self.claim_tx_slot():` parses a `Condition` with `let`.
- `case Ok(packet):` parses a constructor pattern.
- `case PacketKind.ping:` parses as a qualified-name `Pattern`.
- Pattern lists preserve commas and missing closing parens recover.
- Conditions stop before colon or newline.

**Code Examples:**

```wr
if let buffer = self.tx.acquire_tx():
    take buffer:
        return

case Ok(packet):
    batch.return_rx(packet=packet)
```

## Task 20: Implement Function Signatures

**Dependencies:** Tasks 14, 16, 19.

**Description:** Parse reusable function signature pieces: modifier lists,
`fn`, function names, type parameters, parameter lists, parameters, and return
type clauses. This task does not parse blocks or `requires` sections.

**Files:**

```text
src/frontend/parser/function-signature-parser.ts
tests/unit/frontend/parser/function-signature-parser.test.ts
```

**Exports:**

```ts
parseFunctionSignature(context: ParserContext): GreenElement[];
parseFunctionModifierList(context: ParserContext): GreenNode | undefined;
parseParameterList(context: ParserContext): GreenNode;
parseParameter(context: ParserContext): GreenNode;
parseReturnTypeClause(context: ParserContext): GreenNode | undefined;
```

**TDD Steps:**

```text
- [ ] Add function-signature-parser.test.ts cases for one-line, multiline, receiver, consume, and return type signatures.
- [ ] Run `bun test ./tests/unit/frontend/parser/function-signature-parser.test.ts`; expect missing export or failing assertions.
- [ ] Implement only function-signature-parser.ts.
- [ ] Rerun the same command; expect pass.
```

**AC:**

- Modifier sequences parse into `FunctionModifierList` in source order.
- Parameters parse `consume? Identifier ":" TypeReference` and receiver-like
  `self`.
- Multiline parameter lists preserve newline tokens.
- Return arrows after multiline parameter lists parse as `ReturnTypeClause`.
- Reconstruction is exact.

**Code Examples:**

```wr
private platform fn attach_readable(
    self,
    consume ready: SyncedRxBuffer,
) -> RxBatch
```

## Task 21: Implement Function Declarations And Requires Sections

**Dependencies:** Tasks 14, 18, 20.

**Description:** Parse full `FunctionDeclaration` nodes using Task 20 signature
helpers, normal blocks, bodyless signatures, and indented `requires` sections.

**Files:**

```text
src/frontend/parser/function-declaration-parser.ts
tests/unit/frontend/parser/function-declaration-parser.test.ts
tests/integration/frontend/parser/function-dispatch.test.ts
```

**Exports:**

```ts
parseFunctionDeclaration(context: ParserContext): GreenNode;
parseRequiresSection(context: ParserContext): GreenNode;
isFunctionStarter(kind: SyntaxKind): boolean;
```

**TDD Steps:**

```text
- [ ] Add unit tests for bodyless platform signatures, normal function blocks, and requires sections.
- [ ] Run `bun test ./tests/unit/frontend/parser/function-declaration-parser.test.ts`; expect failure.
- [ ] Implement function-declaration-parser.ts and wire only function starters into declaration-parser.ts.
- [ ] Run `bun test ./tests/unit/frontend/parser/function-declaration-parser.test.ts ./tests/integration/frontend/parser/function-dispatch.test.ts`; expect pass.
```

**AC:**

- `FunctionDeclaration` child slots follow the slot schema.
- Bodyless signatures end at newline without requiring a block.
- `requires:` sections parse as `RequiresSection` with `Requirement` children.
- Invalid modifier ordering is preserved and reported through parser recovery.
- Source-file parsing can reach this parser through the declaration dispatcher.

**Code Examples:**

```ts
expect(kindsInTree(tree)).toContain(SyntaxKind.FunctionDeclaration);
expect(kindsInTree(tree)).toContain(SyntaxKind.RequiresSection);
```

## Task 22: Implement Enum Declarations

**Dependencies:** Tasks 13, 14.

**Description:** Parse enum declarations and enum cases. Keep this task limited
to `enum` syntax.

**Files:**

```text
src/frontend/parser/enum-declaration-parser.ts
tests/unit/frontend/parser/enum-declaration-parser.test.ts
tests/integration/frontend/parser/enum-dispatch.test.ts
```

**Exports:**

```ts
parseEnumDeclaration(context: ParserContext): GreenNode;
parseEnumCase(context: ParserContext): GreenNode;
```

**TDD Steps:**

```text
- [ ] Add enum tests for two cases, blank lines, missing case names, and missing dedent.
- [ ] Run `bun test ./tests/unit/frontend/parser/enum-declaration-parser.test.ts`; expect failure.
- [ ] Implement enum-declaration-parser.ts.
- [ ] Wire only `enum` into declaration-parser.ts and add enum-dispatch integration assertion.
- [ ] Run `bun test ./tests/unit/frontend/parser/enum-declaration-parser.test.ts ./tests/integration/frontend/parser/enum-dispatch.test.ts`; expect pass.
```

**AC:**

- `enum PacketError:` parses as `EnumDeclaration`.
- Identifier lines inside the enum block parse as `EnumCase`.
- Blank lines inside the enum block are preserved.
- Malformed enum cases recover at newline, dedent, or EOF.

## Task 23: Implement Dataclass, Class, And Interface Declarations

**Dependencies:** Tasks 14, 16, 20.

**Description:** Parse field-bearing dataclasses, classes, private classes, and
interfaces. Do not implement edge classes, streams, images, or validated
buffers here.

**Files:**

```text
src/frontend/parser/class-declaration-parser.ts
tests/unit/frontend/parser/class-declaration-parser.test.ts
tests/integration/frontend/parser/class-dispatch.test.ts
```

**Exports:**

```ts
parseDataclassDeclaration(context: ParserContext): GreenNode;
parseClassDeclaration(context: ParserContext): GreenNode;
parseInterfaceDeclaration(context: ParserContext): GreenNode;
parseFieldDeclaration(context: ParserContext): GreenNode;
```

**TDD Steps:**

```text
- [ ] Add tests for dataclass fields, private class, interface bodyless function, and malformed field recovery.
- [ ] Run `bun test ./tests/unit/frontend/parser/class-declaration-parser.test.ts`; expect failure.
- [ ] Implement class-declaration-parser.ts.
- [ ] Wire dataclass/class/interface starters into declaration-parser.ts.
- [ ] Run `bun test ./tests/unit/frontend/parser/class-declaration-parser.test.ts ./tests/integration/frontend/parser/class-dispatch.test.ts`; expect pass.
```

**AC:**

- `dataclass PacketLimits:` parses field declarations in its block.
- `private class RxBatchBuilder:` preserves the `private` token.
- `interface Runnable:` parses bodyless function declarations in its block.
- Unknown body items become error nodes without blocking later fields/functions.

## Task 24: Implement Edge Class And Stream Declarations

**Dependencies:** Tasks 14, 16, 18, 20.

**Description:** Parse `edge class`, `unique edge class`, and `stream`
declarations. Do not implement image devices or validated-buffer sections here.

**Files:**

```text
src/frontend/parser/edge-stream-declaration-parser.ts
tests/unit/frontend/parser/edge-stream-declaration-parser.test.ts
tests/integration/frontend/parser/edge-stream-dispatch.test.ts
```

**Exports:**

```ts
parseEdgeClassDeclaration(context: ParserContext): GreenNode;
parseStreamDeclaration(context: ParserContext): GreenNode;
```

**TDD Steps:**

```text
- [ ] Add tests for edge class, unique edge class, generic edge class, and stream contains/bound syntax.
- [ ] Run `bun test ./tests/unit/frontend/parser/edge-stream-declaration-parser.test.ts`; expect failure.
- [ ] Implement edge-stream-declaration-parser.ts.
- [ ] Wire edge/unique/stream starters into declaration-parser.ts.
- [ ] Run `bun test ./tests/unit/frontend/parser/edge-stream-declaration-parser.test.ts ./tests/integration/frontend/parser/edge-stream-dispatch.test.ts`; expect pass.
```

**AC:**

- `unique edge class NetworkDevice:` parses `EdgeClassDeclaration`.
- Generic edge classes preserve `TypeParameterList`.
- `stream RxBatch contains ReadableBuffer bound 64:` parses contained type,
  bound expression, and block.
- Recovery synchronizes at dedent, declaration starter, or EOF.

## Task 25: Implement Image Declarations And Devices Sections

**Dependencies:** Tasks 14, 16, 23.

**Description:** Parse `uefi image` declarations and image `devices:` sections.
Keep image-specific section parsing here so type declaration tasks stay small.

**Files:**

```text
src/frontend/parser/image-declaration-parser.ts
tests/unit/frontend/parser/image-declaration-parser.test.ts
tests/integration/frontend/parser/image-dispatch.test.ts
```

**Exports:**

```ts
parseImageDeclaration(context: ParserContext): GreenNode;
parseDevicesSection(context: ParserContext): GreenNode;
```

**TDD Steps:**

```text
- [ ] Add tests for empty image, image with devices, duplicate device syntax preservation, and malformed device field recovery.
- [ ] Run `bun test ./tests/unit/frontend/parser/image-declaration-parser.test.ts`; expect failure.
- [ ] Implement image-declaration-parser.ts.
- [ ] Wire `uefi image` starter into declaration-parser.ts.
- [ ] Run `bun test ./tests/unit/frontend/parser/image-declaration-parser.test.ts ./tests/integration/frontend/parser/image-dispatch.test.ts`; expect pass.
```

**AC:**

- `uefi image PacketCounterImage:` parses `ImageDeclaration`.
- `devices:` parses `DevicesSection`.
- Device rows use `FieldDeclaration` slot order.
- Malformed device rows recover at newline, dedent, or EOF.

## Task 26: Implement Validated Buffer Declaration, Params, And Layout Sections

**Dependencies:** Tasks 14, 16, 18, 23.

**Description:** Parse the validated-buffer declaration shell plus `params:`
and `layout:` sections. Leave `derive:` and `require:` for Task 27.

**Files:**

```text
src/frontend/parser/validated-buffer-parser.ts
tests/unit/frontend/parser/validated-buffer-parser.test.ts
tests/integration/frontend/parser/validated-buffer-dispatch.test.ts
```

**Exports:**

```ts
parseValidatedBufferDeclaration(context: ParserContext): GreenNode;
parseParamsSection(context: ParserContext): GreenNode;
parseLayoutSection(context: ParserContext): GreenNode;
parseLayoutField(context: ParserContext): GreenNode;
```

**TDD Steps:**

```text
- [ ] Add tests for validated-buffer shell, params fields, layout fields with `at`, and layout fields with `len`.
- [ ] Run `bun test ./tests/unit/frontend/parser/validated-buffer-parser.test.ts`; expect failure.
- [ ] Implement validated-buffer-parser.ts with params/layout dispatch only.
- [ ] Wire `validated buffer` starter into declaration-parser.ts.
- [ ] Run `bun test ./tests/unit/frontend/parser/validated-buffer-parser.test.ts ./tests/integration/frontend/parser/validated-buffer-dispatch.test.ts`; expect pass.
```

**AC:**

- `validated buffer Packet:` parses `ValidatedBufferDeclaration`.
- `params:` parses `ParamsSection` with `FieldDeclaration` children.
- `layout:` parses `LayoutSection` and `LayoutField` with `at` and optional
  `len`.
- Unknown sections recover at dedent, next section starter, declaration starter,
  or EOF.

## Task 27: Implement Validated Buffer Derive And Require Sections

**Dependencies:** Tasks 18, 26.

**Description:** Add `derive:` and `require:` section parsing for validated
buffers, including derived fields, derive cases, and requirements.

**Files:**

```text
src/frontend/parser/validated-buffer-section-parser.ts
tests/unit/frontend/parser/validated-buffer-section-parser.test.ts
tests/integration/frontend/parser/validated-buffer-sections.test.ts
```

**Exports:**

```ts
parseDeriveSection(context: ParserContext): GreenNode;
parseDerivedField(context: ParserContext): GreenNode;
parseDeriveCase(context: ParserContext): GreenNode;
parseRequireSection(context: ParserContext): GreenNode;
parseRequirement(context: ParserContext): GreenNode;
```

**TDD Steps:**

```text
- [ ] Add tests for derived field, `otherwise =>`, numeric derive arm, and requirement with `else`.
- [ ] Run `bun test ./tests/unit/frontend/parser/validated-buffer-section-parser.test.ts`; expect failure.
- [ ] Implement validated-buffer-section-parser.ts.
- [ ] Connect derive/require section dispatch from validated-buffer-parser.ts.
- [ ] Run `bun test ./tests/unit/frontend/parser/validated-buffer-section-parser.test.ts ./tests/integration/frontend/parser/validated-buffer-sections.test.ts`; expect pass.
```

**AC:**

- `derive:` parses `DeriveSection`, `DerivedField`, and nested `DeriveCase`.
- `require:` parses `RequireSection` and `Requirement`.
- Requirement expressions enable `allowElseRequirement`.
- Derive cases stop the left expression before `=>`, consume the arrow token,
  and parse the right expression.
- Section-specific keywords may still appear as member names after dots
  elsewhere.

**Code Examples:**

```ts
function parseValidatedBufferSection(context: ParserContext): GreenNode {
  switch (context.currentSyntaxKind()) {
    case SyntaxKind.ParamsKeyword:
      return parseParamsSection(context);
    case SyntaxKind.LayoutKeyword:
      return parseLayoutSection(context);
    case SyntaxKind.DeriveKeyword:
      return parseDeriveSection(context);
    case SyntaxKind.RequireKeyword:
      return parseRequireSection(context);
    default:
      return recoverUnexpectedValidatedBufferSection(context);
  }
}
```

## Task 28: Implement Binding, Return, Yield, Continue, And Loop Statements

**Dependencies:** Tasks 14, 18, 19.

**Description:** Implement the statement forms with distinctive starter tokens:
`let`, `return`, `yield`, `continue`, and `loop`.

**Files:**

```text
src/frontend/parser/binding-statement-parser.ts
tests/unit/frontend/parser/binding-statement-parser.test.ts
tests/integration/frontend/parser/binding-statement-dispatch.test.ts
```

**Exports:**

```ts
parseLetStatement(context: ParserContext): GreenNode;
parseReturnStatement(context: ParserContext): GreenNode;
parseYieldStatement(context: ParserContext): GreenNode;
parseContinueStatement(context: ParserContext): GreenNode;
parseLoopStatement(context: ParserContext): GreenNode;
```

**TDD Steps:**

```text
- [ ] Add tests for let, typed let, empty return, return expression, yield, continue, and loop block.
- [ ] Run `bun test ./tests/unit/frontend/parser/binding-statement-parser.test.ts`; expect failure.
- [ ] Implement binding-statement-parser.ts.
- [ ] Wire these starters into statement-parser.ts.
- [ ] Run `bun test ./tests/unit/frontend/parser/binding-statement-parser.test.ts ./tests/integration/frontend/parser/binding-statement-dispatch.test.ts`; expect pass.
```

**AC:**

- Statements follow the child slot schema.
- Statement recovery preserves unexpected tokens until newline, dedent, or EOF.
- Full parser dispatch reaches these statements inside a function block.

## Task 29: Implement Assignment And Expression Statements

**Dependencies:** Tasks 14, 18.

**Description:** Implement expression-starting statements: assignment and plain
expression statements.

**Files:**

```text
src/frontend/parser/expression-statement-parser.ts
tests/unit/frontend/parser/expression-statement-parser.test.ts
tests/integration/frontend/parser/expression-statement-dispatch.test.ts
```

**Exports:**

```ts
parseExpressionOrAssignmentStatement(context: ParserContext): GreenNode;
```

**TDD Steps:**

```text
- [ ] Add tests for member assignment, call expression statement, attempt expression statement, and malformed missing newline recovery.
- [ ] Run `bun test ./tests/unit/frontend/parser/expression-statement-parser.test.ts`; expect failure.
- [ ] Implement expression-statement-parser.ts.
- [ ] Wire expression starters into statement-parser.ts.
- [ ] Run `bun test ./tests/unit/frontend/parser/expression-statement-parser.test.ts ./tests/integration/frontend/parser/expression-statement-dispatch.test.ts`; expect pass.
```

**AC:**

- `Expression "=" Expression Newline` parses `AssignmentStatement`.
- Plain expressions followed by newline parse `ExpressionStatement`.
- Assignment parsing does not reparse or drop the left expression.
- Recovery preserves source text exactly.

## Task 30: Implement If, While, For, And Take Statements

**Dependencies:** Tasks 14, 18, 19, 28, 29.

**Description:** Implement control statements except `match`: `if`, `else`,
`while`, `for`, and `take`.

**Files:**

```text
src/frontend/parser/control-statement-parser.ts
tests/unit/frontend/parser/control-statement-parser.test.ts
tests/integration/frontend/parser/control-statement-dispatch.test.ts
```

**Exports:**

```ts
parseIfStatement(context: ParserContext): GreenNode;
parseElseClause(context: ParserContext): GreenNode;
parseWhileStatement(context: ParserContext): GreenNode;
parseForStatement(context: ParserContext): GreenNode;
parseTakeStatement(context: ParserContext): GreenNode;
```

**TDD Steps:**

```text
- [ ] Add tests for if-let, if/else block, while-let, for-in, and take-as block.
- [ ] Run `bun test ./tests/unit/frontend/parser/control-statement-parser.test.ts`; expect failure.
- [ ] Implement control-statement-parser.ts.
- [ ] Wire these starters into statement-parser.ts.
- [ ] Run `bun test ./tests/unit/frontend/parser/control-statement-parser.test.ts ./tests/integration/frontend/parser/control-statement-dispatch.test.ts`; expect pass.
```

**AC:**

- Conditions stop before colon or newline.
- `else ":" Block` and single-statement else forms parse where allowed.
- `take Expression (as Identifier)? ":" Block` preserves `as` syntax.
- Invalid nested control statements recover and continue parsing siblings.

## Task 31: Implement Match Statements And Cases

**Dependencies:** Tasks 14, 18, 19, 30.

**Description:** Implement `match` statements and `case` blocks as a separate
packet because they have their own case-boundary recovery rules.

**Files:**

```text
src/frontend/parser/match-statement-parser.ts
tests/unit/frontend/parser/match-statement-parser.test.ts
tests/integration/frontend/parser/match-statement-dispatch.test.ts
```

**Exports:**

```ts
parseMatchStatement(context: ParserContext): GreenNode;
parseMatchCase(context: ParserContext): GreenNode;
```

**TDD Steps:**

```text
- [ ] Add tests for qualified-name case, constructor case, multiple cases, and malformed case recovery.
- [ ] Run `bun test ./tests/unit/frontend/parser/match-statement-parser.test.ts`; expect failure.
- [ ] Implement match-statement-parser.ts.
- [ ] Wire `match` into statement-parser.ts.
- [ ] Run `bun test ./tests/unit/frontend/parser/match-statement-parser.test.ts ./tests/integration/frontend/parser/match-statement-dispatch.test.ts`; expect pass.
```

**AC:**

- `match Expression ":" Newline Indent MatchCase+ Dedent` parses.
- `case Pattern ":" Block` parses with qualified-name and constructor patterns.
- Recovery synchronizes on next `case`, dedent, statement starter, or EOF.

## Task 32: Wire Source, Declaration, And Statement Dispatchers

**Dependencies:** Tasks 13, 15, 21 through 31.

**Description:** Finish real parser integration by wiring all completed leaf
parsers into source-file, declaration, and statement dispatchers. This task
does not invent new grammar; it connects existing packets.

**Files:**

```text
src/frontend/parser/source-file-parser.ts
src/frontend/parser/declaration-parser.ts
src/frontend/parser/statement-parser.ts
tests/integration/frontend/parser/full-dispatch.test.ts
```

**TDD Steps:**

```text
- [ ] Add full-dispatch.test.ts with one snippet containing import, class, function, let, if, match, and image.
- [ ] Run `bun test ./tests/integration/frontend/parser/full-dispatch.test.ts`; expect failure.
- [ ] Wire dispatchers only; do not change leaf parser behavior.
- [ ] Rerun the same command; expect pass.
```

**AC:**

- Source-file dispatch calls every top-level declaration parser for its starter.
- Declaration dispatch calls function, field, section, and nested declaration
  parsers where grammar allows them.
- Statement dispatch calls every statement parser for its starter and falls back
  to expression/assignment statements for expression starters.
- The dispatch integration snippet reconstructs exactly and contains the
  expected key node kinds.

## Task 33: Harden Error Recovery Across Grammar Modules

**Dependencies:** Task 32.

**Description:** Audit recovery behavior across the now-wired parser. Ensure
every malformed input path either consumes a token, inserts a missing token, or
reaches EOF.

**Files:**

```text
src/frontend/parser/parser-recovery.ts
src/frontend/parser/source-file-parser.ts
src/frontend/parser/declaration-parser.ts
src/frontend/parser/statement-parser.ts
tests/unit/frontend/parser/recovery.test.ts
tests/integration/frontend/parser/recovery-dispatch.test.ts
```

**TDD Steps:**

```text
- [ ] Add recovery tests for broken top-level declaration followed by image, broken block item followed by statement, and depth limit.
- [ ] Run `bun test ./tests/unit/frontend/parser/recovery.test.ts ./tests/integration/frontend/parser/recovery-dispatch.test.ts`; expect failure.
- [ ] Harden only recovery helpers and dispatcher recovery branches.
- [ ] Rerun the same command; expect pass.
```

**AC:**

- Parser never enters an infinite loop on repeated unexpected tokens.
- Every skipped source token appears under `SkippedTokens` or `ErrorNode`.
- Missing required tokens are represented as missing green tokens with zero
  width.
- Top-level malformed declarations do not prevent later top-level declarations
  from parsing.
- Malformed block items do not prevent later block items from parsing.
- Nesting-depth tests produce `PARSE_NESTING_LIMIT_EXCEEDED` instead of
  throwing.
- Recovery diagnostics are deterministic across repeated parses.

**Code Examples:**

```wr
class Broken:
    fn bad(

uefi image StillParses:
    devices:
        net0: NetworkDevice
```

```ts
expect(() => parser.parse({ source, tokens })).not.toThrow();
expect(result.tree.reconstruct()).toBe(source.text);
expect(kindsInTree(result.tree)).toContain(SyntaxKind.ImageDeclaration);
```

## Task 34: Publish Parser And Syntax Public APIs

**Dependencies:** Tasks 4 through 33.

**Description:** Assemble public barrels for syntax and parser modules, update
frontend and top-level API exports, and add public API tests for parser use from
lexer output.

**Files:**

```text
src/frontend/syntax/index.ts
src/frontend/parser/index.ts
src/frontend/index.ts
src/index.ts
tests/integration/frontend/public-api.test.ts
```

**AC:**

- `src/frontend/syntax/index.ts` exports reusable syntax primitives.
- `src/frontend/parser/index.ts` exports parser-specific public types and
  `Parser`.
- `src/frontend/index.ts` re-exports lexer, syntax, and parser public APIs.
- `src/index.ts` keeps compatibility with existing package imports.
- Public API test constructs a lexer, parses the lex result, gets a root, and
  verifies reconstruction.

**Code Examples:**

```ts
import { describe, expect, test } from "bun:test";
import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  Parser,
  SourceText,
  SyntaxKind,
} from "../../../src/frontend";

test("parses through public frontend api", () => {
  const diagnostics = new CollectingDiagnosticSink();
  const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
  const parser = new Parser();
  const lexResult = lexer.lex(SourceText.from("main.wr", "uefi image Main:\n"));
  const parseResult = parser.parseLexResult({
    lexResult,
    lexerDiagnostics: diagnostics.diagnostics,
  });

  expect(parseResult.tree.root().kind).toBe(SyntaxKind.SourceFile);
  expect(parseResult.tree.reconstruct()).toBe(lexResult.source.text);
});
```

## Task 35: Add Module Graph Parse Orchestration

**Dependencies:** Task 34.

**Description:** Add a frontend orchestration helper that parses every module in
an existing `ModuleGraphLexResult`. It must not read files or resolve modules;
it receives already lexed modules and optional lexer diagnostics from the
caller.

**Files:**

```text
src/frontend/module-graph-parser.ts
src/frontend/index.ts
tests/integration/frontend/parser/module-graph-parser.test.ts
```

**AC:**

- Helper accepts `ModuleGraphLexResult` and returns parsed modules with
  `ModulePath`, `SourceText`, `TokenStream`, `imports`, `SyntaxTree`, and
  diagnostics.
- Modules are parsed in the same order as the lex graph result.
- Parsed modules preserve each lexed module's `imports` array unchanged.
- Per-module parser diagnostics remain attached to each source.
- Combined graph diagnostics preserve lexer and parser codes.
- No filesystem, resolver, or Bun runtime APIs are used in parser orchestration.

**Code Examples:**

```ts
const parsedGraph = moduleGraphParser.parse({
  graph: graphLexResult,
  lexerDiagnostics: diagnostics.diagnostics,
});

expect(parsedGraph.modules.map((module) => module.path.key)).toEqual([
  "app/main.wr",
  "core/boot.wr",
]);
expect(parsedGraph.modules[0]!.imports).toBe(graphLexResult.modules[0]!.imports);
```

## Task 36: Add Representative Parser Integration Tests

**Dependencies:** Tasks 22 through 35.

**Description:** Add integration tests that parse representative valid snippets
from `docs/language/happy.md` and structurally invalid snippets that exercise
recovery. Keep tests focused and deterministic instead of snapshotting the whole
tree text.

**Files:**

```text
tests/integration/frontend/parser/parser.test.ts
tests/integration/frontend/parser/happy-snippets.test.ts
tests/integration/frontend/parser/invalid-recovery.test.ts
```

**AC:**

- Tests include these exact fixture names and key node assertions:
  `imports-and-enums`, `class-and-functions`, `edge-stream-and-generics`,
  `validated-buffer-sections`, `image-devices-and-boot`, `control-flow-match`,
  `malformed-declaration-recovers`, and `semantic-invalid-still-parses`.
- Fixture key node kinds are fixed:

```text
imports-and-enums:
  ImportDeclaration, EnumDeclaration, EnumCase
class-and-functions:
  DataclassDeclaration, ClassDeclaration, InterfaceDeclaration, FunctionDeclaration
edge-stream-and-generics:
  EdgeClassDeclaration, StreamDeclaration, TypeParameterList, TypeArgumentList
validated-buffer-sections:
  ValidatedBufferDeclaration, ParamsSection, LayoutSection, DeriveSection, RequireSection
image-devices-and-boot:
  ImageDeclaration, DevicesSection, FunctionDeclaration, LoopStatement
control-flow-match:
  TakeStatement, ForStatement, MatchStatement, MatchCase
malformed-declaration-recovers:
  ErrorNode or SkippedTokens, ImageDeclaration
semantic-invalid-still-parses:
  ClassDeclaration, FunctionDeclaration, ReturnStatement
```

- Every test asserts reconstruction equals source text.
- Valid snippets produce no parser diagnostics.
- Structurally malformed snippets produce parser diagnostics but still produce
  a `SourceFile` root.
- Semantic-invalid but syntactically valid snippets from `docs/language/invalid.md`
  parse with no parser diagnostics.
- Tests assert important node kinds rather than relying only on reconstruction.

**Code Examples:**

```ts
const fixtures = [
  {
    name: "validated-buffer-sections",
    source: VALIDATED_BUFFER_SNIPPET,
    diagnostics: false,
    kinds: [
      SyntaxKind.ValidatedBufferDeclaration,
      SyntaxKind.LayoutSection,
      SyntaxKind.DeriveSection,
      SyntaxKind.RequireSection,
    ],
  },
  {
    name: "control-flow-match",
    source: CONTROL_FLOW_SNIPPET,
    diagnostics: false,
    kinds: [SyntaxKind.TakeStatement, SyntaxKind.ForStatement, SyntaxKind.MatchStatement],
  },
];
```

## Task 37: Add Parser Fuzz And Invariant Tests

**Dependencies:** Tasks 10, 33, 36.

**Description:** Add `fast-check` parser fuzz tests over arbitrary source text
and structured deep nesting generators. Fuzz tests must use the public lexer and
parser APIs and test shared invariants.

**Files:**

```text
tests/integration/frontend/parser/parser-fuzz.test.ts
tests/support/frontend/parser-fuzz-generators.ts
```

**AC:**

- Arbitrary lexed input never causes parser throws.
- Parse tree reconstruction equals source text for every fuzz case.
- Green widths equal child widths for every fuzz case.
- Red node offsets are monotonic and in bounds.
- Diagnostics are in bounds and sorted deterministically.
- Repeated parse snapshots are equivalent for the same input.
- Deep grouping, type nesting, call nesting, and indentation nesting trigger
  parser depth-limit diagnostics instead of JavaScript stack errors.
- Fuzz support imports `fast-check` only from tests/support or test files.

**Code Examples:**

```ts
fastCheck.assert(
  fastCheck.property(fastCheck.string(), (text) => {
    const source = SourceText.from("fuzz.wr", text);
    const lexResult = lexer.lex(source);
    const parseResult = parser.parseLexResult({
      lexResult,
      lexerDiagnostics: diagnostics.diagnostics,
    });

    expect(parseResult.tree.reconstruct()).toBe(source.text);
  }),
  { numRuns: 250 },
);
```

## Task 38: Add System Frontend Parse Smoke Test

**Dependencies:** Task 35.

**Description:** Extend the system frontend smoke test to run file repository
read, module graph lexing, module graph parsing, and syntax reconstruction for
each parsed module.

**Files:**

```text
tests/system/frontend/front-end.test.ts
```

**AC:**

- Test uses fakes for files through dependency injection.
- Test runs from an image entry module through imported modules.
- Every module token stream reconstructs its source.
- Every module syntax tree reconstructs its source.
- Diagnostics from lexer and parser are visible and code-prefixed.
- No test uses mocks, spies, or filesystem access.

**Code Examples:**

```ts
for (const module of parsedGraph.modules) {
  expect(module.tokens.reconstruct()).toBe(module.source.text);
  expect(module.tree.reconstruct()).toBe(module.source.text);
}
```

## Task 39: Update Documentation Cross-References

**Dependencies:** Task 34.

**Description:** Update README and design/implementation references so new
frontend paths and parser APIs are discoverable. Do not change parser behavior
in this task.

**Files:**

```text
README.md
docs/design/parser-design.md
docs/design/lexer-design.md
docs/implementation/2026-06-04-parser-implementation.md
```

**AC:**

- README shows the preferred lexer-to-parser API.
- Parser design remains consistent with final file paths.
- Lexer design notes compatibility exports only as temporary migration support.
- Implementation plan status or notes reflect completed path names if paths
  changed during implementation.

**Code Examples:**

```ts
const lexer = new Lexer({ keywords: KeywordTable.default(), diagnostics });
const parser = new Parser();
const lexResult = lexer.lex(source);
const parseResult = parser.parseLexResult({
  lexResult,
  lexerDiagnostics: diagnostics.diagnostics,
});
```

## Task 40: Final Hardening And Required Gate

**Dependencies:** All implementation tasks.

**Description:** Run the repository gate, fix failures, and leave a short final
handoff note listing parser coverage and any intentionally unsupported semantic
validation. This task is not complete until the gate passes.

**Files:**

```text
package.json
src/**
tests/**
docs/**
```

**AC:**

- `bun run format` has been run if formatting changed.
- `bun run agent:check` passes.
- No runtime source imports `fast-check`.
- No parser code reads files or depends on Bun file APIs.
- No tests use mocks, spies, or `jest.fn`.
- The final handoff states that semantic validation remains outside the parser.

**Code Examples:**

```sh
bun run format
bun run agent:check
```

---

## Subagent Handoff Template

Each subagent should report completion in this shape.

```text
Task:
Files changed:
Tests run:
Acceptance criteria satisfied:
Notes for dependent tasks:
```

## Implementation Notes For Junior Engineers

- Keep source parsing lossless first. If syntax is malformed, preserve it under
  missing tokens, `SkippedTokens`, or `ErrorNode`.
- Prefer `source`, `diagnostics`, `token`, `result`, and `context` in code.
  Avoid shortened names blocked by the repository policy checker.
- Use fakes through dependency injection in tests. Do not use mocks.
- Keep filesystem access at lexer/front-end edges. Parser modules must be pure
  over source text and token streams.
- Run narrow tests while iterating, such as
  `bun test ./tests/unit/frontend/parser/expression-operators.test.ts`.
- Run `bun run agent:check` before handing parser implementation work back.
