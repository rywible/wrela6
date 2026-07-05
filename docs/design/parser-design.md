# Parser Design

## Purpose

The parser is the second compiler layer. It consumes a lexer `TokenStream` and
produces a lossless concrete syntax tree for each source file. The parser is
responsible for grammar structure, parse diagnostics, and recovery, but it must
not discard trivia or turn malformed source into an absent tree.

The parser should be built around a full red/green CST model. The green tree is
the immutable structural representation. The red tree is the ergonomic view used
by tooling, diagnostics, formatter, linter, and later compiler stages.

## Goals

- Produce a complete trivia-preserving CST for valid and invalid source.
- Keep parse output lossless: reconstructing a syntax tree reproduces the
  source text exactly.
- Use immutable green nodes and red wrapper nodes with parent and offset
  context.
- Support deterministic parse diagnostics and deterministic recovery.
- Preserve lexer token and trivia identity as syntax tokens rather than
  flattening or reclassifying source text.
- Keep syntax tree APIs shared and reusable by formatter, linter, editor, and
  semantic layers.
- Design for a later typed AST view without making AST the parser's primary
  output.
- Keep filesystem and module traversal outside the source parser.

## Non-Goals

- The parser does not typecheck, resolve names, or validate semantic rules.
- The parser does not read files or discover modules.
- The initial parser does not need incremental reparsing, although the green
  tree shape should not block it.
- The parser does not produce a standalone semantic AST as its primary result.

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
      ...

    syntax/
      index.ts
      syntax-kind.ts
      green-node.ts
      green-token.ts
      green-trivia.ts
      red-node.ts
      red-token.ts
      syntax-tree.ts
      syntax-factory.ts

    parser/
      index.ts
      parser.ts
      parser-diagnostics.ts
      parser-context.ts
      declaration-parser.ts
      expression-parser.ts
      type-parser.ts
      statement-parser.ts

tests/
  unit/
    syntax-*.test.ts
    parser-*.test.ts

  integration/
    parser.test.ts
    parser-fuzz.test.ts

  system/
    front-end.test.ts
```

`src/frontend` contains source front-end layers: lexing, syntax trees, parsing,
and later front-end orchestration. `src/frontend/syntax` is shared frontend
substrate. The parser creates syntax trees, but future formatter and linter code
should use syntax APIs directly without depending on parser internals.

`src/shared` remains outside the frontend because source text, source spans, and
diagnostics are cross-stack concerns used by parser, semantic analysis,
tooling, and later back-end stages.

The `tests` tree mirrors source module boundaries. Lexer code has moved from
`src/lexer` to `src/frontend/lexer`, and lexer tests have moved into matching
frontend-focused paths. New parser and syntax tests follow the same pattern so
readers can map source modules to tests without archaeology.

```text
tests/
  unit/
    shared/
    frontend/
      lexer/
      syntax/
      parser/

  integration/
    frontend/
      lexer/
      parser/

  system/
    frontend/
```

## Public API

Public types and classes are available through the frontend barrel:

```ts
import {
  Lexer,
  Parser,
  SourceText,
  KeywordTable,
  CollectingDiagnosticSink,
  SyntaxKind,
  SyntaxTree,
} from "./src/frontend";
```

Expected parser use with a lexer result:

```ts
const parser = new Parser();
const result = parser.parseLexResult({
  lexResult,
  lexerDiagnostics,
});

const tree = result.tree;
const root = tree.root();
```

Expected parser use with explicit source and tokens:

```ts
const result = parser.parse({
  source,
  tokens,
  lexerDiagnostics,
});
```

`parseLexResult` is a convenience for the common lexer-to-parser path.
`parse({ source, tokens })` remains the core shape because source text is needed
for absolute diagnostics and syntax-tree reconstruction. Tokens-only input is
not sufficient for the public parser API.

Expected syntax tree use:

```ts
tree.reconstruct() === source.text;

for (const diagnostic of tree.diagnostics) {
  const position = diagnostic.source.positionAt(diagnostic.span.start);
}
```

The parser is pull-based: diagnostics are part of the returned parse result and
syntax tree. A caller that already has lexer diagnostics may pass them into
`parse` so `ParseResult.diagnostics` can expose a combined, source-ordered view,
but parser diagnostics remain distinguishable from lexer diagnostics by code.

The parser module exposes parser-specific types from
`src/frontend/parser/index.ts`. The syntax module exposes reusable tree
primitives from `src/frontend/syntax/index.ts`.

## Red And Green Trees

The green tree is immutable, context-free, and compact. Green nodes know their
kind, width, relative diagnostics attached directly to that subtree, and ordered
child slots. Green nodes do not know their parent, absolute offset, or source
file.

The red tree wraps green nodes with context. Red nodes know their parent,
absolute offset, source, child index, and navigation helpers. Red nodes may be
created lazily so common parsing paths do not allocate a full wrapper tree
eagerly.

```text
GreenNode
  kind
  width
  children

RedNode
  green
  parent
  offset
  source
```

This split gives later tooling a stable model:

- formatter uses red nodes for navigation and source ranges
- linter uses red nodes and typed views for structural queries
- semantic stages can use typed AST views over red nodes
- incremental parsing can compare or reuse green subtrees later

Red node wrappers are value views over green nodes and context. The first
implementation should not promise stable object identity for repeated
navigation: two calls that navigate to the same child may return distinct
wrapper objects that describe the same source range. Equality-sensitive tooling
should compare stable coordinates such as syntax tree identity, span, kind, and
child path. Per-node child caching can be added later without changing this
semantic contract.

## Syntax Elements

The syntax tree has three core element categories:

- `GreenNode` / `RedNode`: grammar structure such as image declarations,
  function declarations, blocks, expressions, and parameter lists.
- `GreenToken` / `RedToken`: lexer tokens placed into syntax context.
- `GreenTrivia` / red trivia accessors: trivia preserved from lexer tokens.

Tokens remain first-class syntax elements. The parser should not concatenate
tokens or discard trivia when building nodes. Missing tokens are represented
explicitly so the tree shape remains useful after recovery.

## Syntax Kind Vocabulary

`SyntaxKind` should include both token-like and node-like vocabulary.

Token-like syntax kinds should map from lexer `TokenKind`:

```text
IdentifierToken
IntegerLiteralToken
StringLiteralToken
InvalidToken
UseKeyword
FromKeyword
ImageKeyword
ColonToken
NewlineToken
IndentToken
DedentToken
EndOfFileToken
```

The `TokenKind -> SyntaxKind` map must be total. Every lexer token kind,
including `Invalid`, layout tokens, punctuation, operators, and every keyword,
gets a syntax token kind. Missing tokens use the expected syntax token kind plus
an `isMissing` flag; they should not be represented only as one undifferentiated
`MissingToken`.

Node-like syntax kinds should describe grammar structure:

```text
SourceFile
ImportDeclaration
ImportNameList
DottedModuleName
ImageDeclaration
ClassDeclaration
FunctionDeclaration
ParameterList
Parameter
Block
StatementList
ExpressionStatement
NameExpression
CallExpression
ErrorNode
MissingNode
SkippedTokens
```

The vocabulary should cover the whole current grammar while keeping a clear
distinction between source tokens and grammar nodes.

## Losslessness

The parser must preserve source text exactly. Reconstruction walks the tree in
source order and concatenates token leading trivia, token lexeme, and token
trailing trivia. Missing tokens and missing nodes have zero width and reconstruct
to an empty string.

Required invariant:

```ts
expect(result.tree.reconstruct()).toBe(source.text);
```

This invariant applies to valid code, invalid code, fuzz input, and files with
lexical diagnostics.

## Newlines And Layout

The lexer emits physical line breaks as `TokenKind.Newline` tokens. The parser
must treat those newline tokens as significant syntax for statement
termination, section bodies, multiline signatures, and indentation-delimited
blocks. `Indent` and `Dedent` tokens are also significant syntax tokens.

Block parsing rules:

- A block normally starts with `Colon Newline Indent`, contains zero or more
  block items, and ends at the matching `Dedent`.
- Bodyless signatures, such as interface and platform function declarations,
  may end at `Newline` without a following `Indent`.
- Blank lines and comment-only lines still contain `Newline` tokens and should
  be preserved in the CST. Grammar productions that consume statement lists
  should allow extra newline tokens between items.
- EOF-generated `Dedent` tokens close open blocks before the final `Eof`.
- EOF-adjacent trivia remains attached to the `Eof` token and reconstructs
  through that token; it is not a statement terminator.
- When recovery loses track inside a block, synchronize on `Newline`, `Dedent`,
  or `Eof` and preserve skipped tokens under the nearest error node.

## Diagnostics

Parser diagnostics should use the shared diagnostic substrate at the public API
edge. Parser-specific codes live in
`src/frontend/parser/parser-diagnostics.ts`.

Green nodes are context-free, so they cannot store shared absolute diagnostics
directly. Instead, green nodes may carry relative diagnostics:

```ts
interface GreenDiagnostic {
  code: ParseDiagnosticCode;
  severity: DiagnosticSeverity;
  message: string;
  relativeStart: number;
  relativeEnd: number;
}
```

`SyntaxTree` projects green diagnostics into shared absolute diagnostics by
adding each red node's absolute offset and attaching the tree's `SourceText`.
`tree.diagnostics` returns parser diagnostics in source order.
`ParseResult.diagnostics` may combine caller-provided lexer diagnostics with
parser diagnostics, preserving code prefixes so downstream tools can separate
`LEX_*` from `PARSE_*`.

Example code vocabulary:

```text
PARSE_EXPECTED_TOKEN
PARSE_EXPECTED_DECLARATION
PARSE_EXPECTED_EXPRESSION
PARSE_UNEXPECTED_TOKEN
PARSE_UNTERMINATED_BLOCK
PARSE_RECOVERY_SKIPPED_TOKENS
```

Diagnostics should point at the narrowest useful span. If the parser inserts a
missing token at EOF or before another token, the diagnostic span may be
zero-width at the insertion point.

## Error Recovery

The parser should always produce a tree. Recovery uses explicit missing tokens
and skipped-token nodes rather than dropping source.

Recovery rules:

- If a required token is absent, create a missing token with zero width and emit
  `PARSE_EXPECTED_TOKEN`.
- If unexpected tokens appear inside a construct, collect them into
  `SkippedTokens` or an `ErrorNode` and continue at the next synchronization
  token.
- Synchronization tokens include `Newline`, `Dedent`, `Eof`, and construct
  starters such as `use`, `uefi`, `image`, `class`, `fn`, `enum`, and
  `interface`.
- Recovery should be deterministic and should always make progress.
- If no parse rule applies and no synchronization token is reached, consume at
  least one token into `SkippedTokens` before retrying.
- Parser diagnostics describe structural grammar problems. They should not try
  to de-duplicate lexer diagnostics from tokens alone; combined diagnostic
  presentation happens at `ParseResult` or a later front-end orchestration
  boundary.
- The parser should enforce a nesting-depth limit for recursive descent and
  Pratt parsing. Inputs that exceed the limit produce a parse diagnostic and
  recover instead of throwing a JavaScript stack error.

## Grammar Coverage

The parser should cover the whole current grammar rather than a deliberately
small declaration-only subset. The current grammar is example-derived from
`docs/language/happy.md` and `docs/language/invalid.md`; until a formal grammar
file exists, "whole grammar" means every syntactic form represented by those
documents. It is still acceptable to implement the grammar incrementally, but
each implementation phase should move toward a complete CST for those forms and
should preserve all syntax it does not yet understand through explicit recovery
nodes.

The parser should use explicit error recovery for incomplete grammar work rather
than silently accepting placeholders as complete language coverage.

## Current Grammar Table

This table is the parser-facing grammar inventory derived from the current
language examples. It is intentionally implementation-oriented: each row names
the construct, its starter tokens, its expected shape, synchronization points,
and the CST node it should produce.

| Construct                    | Starts With                                                                                | Shape                                                                                        | Synchronizes On                                 | CST Node                     |
| ---------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | ----------------------------------------------- | ---------------------------- |
| Source file                  | first token                                                                                | `TopLevelItem* Eof`                                                                          | `Eof`                                           | `SourceFile`                 |
| Import declaration           | `use`                                                                                      | `use ImportName ("," ImportName)* from DottedModuleName Newline`                             | `Newline`, `Eof`                                | `ImportDeclaration`          |
| Enum declaration             | `enum`                                                                                     | `enum Identifier ":" Newline Indent EnumCase+ Dedent`                                        | `Dedent`, top-level starter, `Eof`              | `EnumDeclaration`            |
| Enum case                    | identifier                                                                                 | `Identifier Newline`                                                                         | `Newline`, `Dedent`                             | `EnumCase`                   |
| Dataclass declaration        | `dataclass`                                                                                | `dataclass TypeName TypeParameterList? ":" Block`                                            | `Dedent`, top-level starter, `Eof`              | `DataclassDeclaration`       |
| Class declaration            | `class`, `private class`                                                                   | `private? class TypeName TypeParameterList? ":" Block`                                       | `Dedent`, top-level starter, `Eof`              | `ClassDeclaration`           |
| Edge class declaration       | `edge class`, `unique edge class`                                                          | `unique? edge class TypeName TypeParameterList? ":" Block`                                   | `Dedent`, top-level starter, `Eof`              | `EdgeClassDeclaration`       |
| Interface declaration        | `interface`                                                                                | `interface TypeName TypeParameterList? ":" Block`                                            | `Dedent`, top-level starter, `Eof`              | `InterfaceDeclaration`       |
| Stream declaration           | `stream`                                                                                   | `stream TypeName contains TypeReference bound Expression ":" Block`                          | `Dedent`, top-level starter, `Eof`              | `StreamDeclaration`          |
| Validated buffer declaration | `validated buffer`                                                                         | `validated buffer TypeName ":" ValidatedBufferSection*`                                      | `Dedent`, top-level starter, `Eof`              | `ValidatedBufferDeclaration` |
| Image declaration            | `uefi image`                                                                               | `uefi image TypeName ":" Block`                                                              | `Dedent`, top-level starter, `Eof`              | `ImageDeclaration`           |
| Field declaration            | identifier in type body                                                                    | `Identifier ":" TypeReference Newline`                                                       | `Newline`, `Dedent`                             | `FieldDeclaration`           |
| Function declaration         | `fn`, `constructor fn`, `terminal fn`, `predicate fn`, `private fn`, `private platform fn` | `FunctionModifier* fn Identifier TypeParameterList? ParameterList ReturnType? FunctionBody?` | `Newline`, `Dedent`, declaration starter, `Eof` | `FunctionDeclaration`        |
| Function modifier            | modifier keyword                                                                           | `constructor`, `terminal`, `predicate`, `private`, `platform` before `fn`                    | `fn`, `Newline`                                 | `FunctionModifierList`       |
| Parameter list               | `(`                                                                                        | `"(" Parameter ("," Parameter)* ","? ")"`                                                    | `)`, `Newline`, `:`                             | `ParameterList`              |
| Parameter                    | identifier or `consume`                                                                    | `consume? Identifier ":" TypeReference` or receiver-like `self`                              | `,`, `)`                                        | `Parameter`                  |
| Return type                  | `->`                                                                                       | `-> TypeReference`                                                                           | `Newline`, `:`, declaration body starter        | `ReturnTypeClause`           |
| Requires section             | `requires`                                                                                 | `requires ":" Newline Indent Requirement+ Dedent`                                            | `Dedent`, declaration starter                   | `RequiresSection`            |
| Devices section              | `devices`                                                                                  | `devices ":" Newline Indent FieldDeclaration+ Dedent`                                        | `Dedent`, declaration starter                   | `DevicesSection`             |
| Params section               | `params`                                                                                   | `params ":" Newline Indent FieldDeclaration+ Dedent`                                         | `Dedent`, validated-buffer section starter      | `ParamsSection`              |
| Layout section               | `layout`                                                                                   | `layout ":" Newline Indent LayoutField+ Dedent`                                              | `Dedent`, validated-buffer section starter      | `LayoutSection`              |
| Layout field                 | identifier                                                                                 | `Identifier ":" WireLayoutTypeReference at Expression (len Expression)? Newline`             | `Newline`, `Dedent`                             | `LayoutField`                |
| Wire layout type reference   | type reference or contextual endian marker                                                 | `("le" or "be")? TypeReference`                                                              | `at`, `Newline`                                 | `WireLayoutTypeReference`    |
| Derive section               | `derive`                                                                                   | `derive ":" Newline Indent DerivedField+ Dedent`                                             | `Dedent`, validated-buffer section starter      | `DeriveSection`              |
| Derived field                | identifier                                                                                 | `Identifier ":" TypeReference from Expression ":" Newline Indent DeriveCase+ Dedent`         | `Dedent`, derive section starter                | `DerivedField`               |
| Derive case                  | expression or `otherwise`                                                                  | `Expression => Expression Newline` or `otherwise => Expression Newline`                      | `Newline`, `Dedent`                             | `DeriveCase`                 |
| Require section              | `require`                                                                                  | `require ":" Newline Indent Requirement+ Dedent`                                             | `Dedent`, validated-buffer section starter      | `RequireSection`             |
| Requirement                  | expression                                                                                 | `Expression (else Expression)? Newline`                                                      | `Newline`, `Dedent`                             | `Requirement`                |
| Block                        | `:` then newline/indent                                                                    | `":" Newline Indent Statement* Dedent` or declaration-specific empty body                    | `Dedent`, `Eof`                                 | `Block`                      |
| Let statement                | `let`                                                                                      | `let Pattern TypeAnnotation? "=" Expression Newline`                                         | `Newline`, `Dedent`                             | `LetStatement`               |
| If statement                 | `if`                                                                                       | `if Condition ":" Block ElseClause?`                                                         | `Dedent`, statement starter                     | `IfStatement`                |
| While statement              | `while`                                                                                    | `while Condition ":" Block`                                                                  | `Dedent`, statement starter                     | `WhileStatement`             |
| For statement                | `for`                                                                                      | `for Pattern in Expression ":" Block`                                                        | `Dedent`, statement starter                     | `ForStatement`               |
| Take statement               | `take`                                                                                     | `take Expression (as Identifier)? ":" Block`                                                 | `Dedent`, statement starter                     | `TakeStatement`              |
| Match statement              | `match`                                                                                    | `match Expression ":" Newline Indent MatchCase+ Dedent`                                      | `Dedent`, statement starter                     | `MatchStatement`             |
| Match case                   | `case`                                                                                     | `case Pattern ":" Block`                                                                     | `Dedent`, `case`, statement starter             | `MatchCase`                  |
| Loop statement               | `loop`                                                                                     | `loop ":" Block`                                                                             | `Dedent`, statement starter                     | `LoopStatement`              |
| Return statement             | `return`                                                                                   | `return Expression? Newline`                                                                 | `Newline`, `Dedent`                             | `ReturnStatement`            |
| Yield statement              | `yield`                                                                                    | `yield Expression Newline`                                                                   | `Newline`, `Dedent`                             | `YieldStatement`             |
| Continue statement           | `continue`                                                                                 | `continue Newline`                                                                           | `Newline`, `Dedent`                             | `ContinueStatement`          |
| Expression statement         | expression starter                                                                         | `Expression Newline`                                                                         | `Newline`, `Dedent`                             | `ExpressionStatement`        |
| Assignment statement         | expression starter                                                                         | `Expression "=" Expression Newline`                                                          | `Newline`, `Dedent`                             | `AssignmentStatement`        |
| Condition                    | expression or `let`                                                                        | `Expression` or `let Pattern "=" Expression`                                                 | `:`, `Newline`                                  | `Condition`                  |
| Type reference               | identifier/type starter                                                                    | `QualifiedName TypeArgumentList?`                                                            | `,`, `)`, `]`, `:`, `Newline`                   | `TypeReference`              |
| Type parameter list          | `[` after declaration/type name                                                            | `"[" TypeParameter ("," TypeParameter)* "]"`                                                 | `]`, `(`, `:`                                   | `TypeParameterList`          |
| Type parameter               | identifier                                                                                 | `Identifier (":" TypeReference)?`                                                            | `,`, `]`                                        | `TypeParameter`              |
| Type argument list           | `[` in type/expression callee context                                                      | `"[" TypeReference ("," TypeReference)* "]"`                                                 | `]`, `.`, `(`, `Newline`                        | `TypeArgumentList`           |
| Pattern                      | identifier or constructor                                                                  | `Identifier` or `QualifiedName "(" PatternList? ")"`                                         | `=`, `:`, `in`, `)`                             | `Pattern`                    |
| Object literal               | `{`                                                                                        | `"{" ObjectField* "}"` where fields are `Identifier ":" Expression ","?`                     | `}`, `Newline`                                  | `ObjectLiteralExpression`    |
| Call argument list           | `(` after expression                                                                       | `"(" NamedArgument ("," NamedArgument)* ","? ")"`                                            | `)`, `Newline`                                  | `CallArgumentList`           |
| Named argument               | identifier                                                                                 | `Identifier "=" Expression`                                                                  | `,`, `)`                                        | `NamedArgument`              |
| Else clause                  | `else`                                                                                     | `else ":" Block` or `else Statement` where allowed                                           | `Dedent`, statement starter                     | `ElseClause`                 |

Notes:

- Member names after `.` must accept keyword tokens as name tokens. Examples
  include `source.len`, `layout.fits`, and layout fields using `at` and `len` in
  section-specific roles.
- `le` and `be` are contextual wire-endian markers only in validated-buffer
  layout field type position. They are not global keywords. Semantic checking
  requires one of them for multi-byte integer layout fields and rejects them for
  single-byte or opaque byte fields where byte order has no meaning.
- Function declarations may be bodyless when they describe platform or interface
  signatures.
- Delimited lists such as parameter lists, call arguments, object fields, type
  arguments, and multiline signatures may contain `Newline` tokens between
  elements. Those newlines are preserved as syntax tokens, not trivia.
- Return type arrows may appear after a multiline parameter list and may be
  separated from the closing `)` by one or more `Newline` tokens.
- The grammar table is intentionally broader than the first implementation
  order; missing grammar support must recover through explicit error nodes.

## Expression And Operator Table

Expressions should use a Pratt parser with an explicit binding-power table. The
parser must treat all rows below as syntax, not semantics; semantic stages decide
whether a form is legal for a specific type or context.

| Binding Power | Form                                               | Associativity   | CST Node                              | Notes                                                                                                                                |
| ------------: | -------------------------------------------------- | --------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
|           100 | primary literals and names                         | n/a             | `LiteralExpression`, `NameExpression` | identifiers, integers, strings, `true`/`false` as identifiers until keyworded                                                        |
|            95 | object literal `{ name: expr, ... }`               | n/a             | `ObjectLiteralExpression`             | used in named arguments such as `devices={ net0: net0 }`                                                                             |
|            90 | member access `expr.name`                          | left            | `MemberAccessExpression`              | member name may be identifier or keyword token                                                                                       |
|            90 | call `expr(args)`                                  | left            | `CallExpression`                      | current language examples use named arguments only                                                                                   |
|            90 | type application/member callee `Name[Type].member` | left            | `TypeApplicationExpression`           | needed for forms such as `MoveRing[Packet].new(max=64)`                                                                              |
|            80 | postfix attempt mapping `expr? ErrorExpr`          | left            | `AttemptExpression`                   | right side parses as a high-precedence error expression ending at newline, comma, `)`, `]`, `}`, `:`, or a lower-precedence boundary |
|            70 | unary `not expr`, `-expr`                          | right           | `UnaryExpression`                     | `not` is a keyword; `-` applies to numeric expressions                                                                               |
|            60 | `*`, `/`, `%`                                      | left            | `BinaryExpression`                    | arithmetic                                                                                                                           |
|            50 | `+`, `-`                                           | left            | `BinaryExpression`                    | arithmetic                                                                                                                           |
|            40 | `<`, `<=`, `>`, `>=`                               | non-associative | `ComparisonExpression`                | chained comparisons should recover or become explicit error nodes until specified                                                    |
|            35 | `==`, `!=`                                         | non-associative | `EqualityExpression`                  | no implicit chaining                                                                                                                 |
|            20 | requirement fallback `expr else expr`              | right           | `ElseRequirementExpression`           | only valid inside requirement contexts, but parsed explicitly                                                                        |
|            10 | derive arm `expr => expr`                          | right           | `DeriveCase` child expression         | only valid inside derive cases                                                                                                       |

Expression stopping rules:

- Stop at `Newline`, `Indent`, `Dedent`, `Eof`, `,`, `)`, `]`, `}`, and `:`
  unless the active expression context explicitly owns that delimiter.
- Stop before `case`, `else`, `otherwise`, and section/declaration starters when
  they appear at statement or section boundaries.
- The postfix `? ErrorExpr` right side is intentionally narrow: parse member
  access, calls, type applications, and names/literals, but stop before statement
  delimiters and block delimiters so `return foo()? Err` remains a single
  statement and does not consume following statements.

## Bracket Disambiguation

`[` is used for type parameters, type arguments, and generic callee forms. The
parser should disambiguate by syntactic context rather than semantic knowledge:

- After declaration names such as `class MoveRingPaths[T: CoreMovableOwned]`,
  parse a `TypeParameterList`.
- In type-reference contexts, parse `TypeArgumentList` after a type name.
- In expression contexts, parse `TypeApplicationExpression` only when `[` is
  attached to a simple name/member callee and is followed by type-like syntax
  that closes before a call/member continuation.
- Index expressions are not part of the current valid grammar. Inputs such as
  `batch[0]` should still parse losslessly, but as an explicit error or
  unsupported bracket expression so semantic diagnostics can reject it cleanly.

## AST View

A typed AST view is worth designing for, but it should be derived from the CST.
The AST view should hold references to red syntax nodes and tokens rather than
copying source data into an independent tree.

Example view shape:

```ts
class ImageDeclarationView {
  constructor(readonly node: RedNode) {}

  name(): RedToken | undefined {
    // read from CST slots
  }
}
```

Later compiler stages can use typed views for clarity:

```ts
const image = AstView.from(tree).images()[0];
const name = image?.name()?.text;
```

The CST remains the source of truth for formatting, linting, diagnostics, and
source reconstruction. Invalid code produces partial views rather than a failed
parse.

## Parser Architecture

The parser should be a forward-only recursive descent parser over `TokenStream`.
It should use a small parser context for token navigation, expected-token
helpers, missing-token creation, and recovery.

```text
TokenStream -> ParserContext -> Parser -> SyntaxTree
```

Suggested responsibilities:

- `Parser`: owns top-level parse entry points.
- `ParserContext`: wraps token navigation, lookahead, consume, expect, and
  diagnostics.
- `declaration-parser.ts`: imports, image declarations, type declarations, and
  function declarations.
- `statement-parser.ts`: blocks and statement-level recovery.
- `expression-parser.ts`: expression forms and precedence.
- `type-parser.ts`: type references and parameter type annotations.
- `syntax-factory.ts`: centralizes green node and token creation.

The parser should not depend on lexer internals such as `Cursor`. It consumes
public lexer tokens only.

Lexer implementation APIs live under `src/frontend/lexer` so parser work starts
in the intended module layout. Frontend code should import through
`src/frontend/lexer` or the frontend barrel; public callers may use root barrels
when those barrels intentionally expose the lexer API.

## Testing Strategy

Unit tests should cover syntax value objects, red/green navigation, missing
tokens, and recovery helpers. Integration tests should parse representative
language snippets and assert tree shape, diagnostics, and reconstruction.

Fuzz tests should check:

- parsing arbitrary lexed input never throws
- parse tree reconstruction equals source text
- green node widths equal child widths
- red node offsets are monotonic and in bounds
- diagnostics are in bounds
- repeated parse snapshots are deterministic
- repeated red-node navigation produces equivalent coordinates even if wrapper
  object identity differs
- deep grouping, type nesting, call nesting, and indentation nesting hit
  depth-limit diagnostics rather than JavaScript stack overflows
- malformed declarations recover and continue parsing later declarations

System tests should run the front-end workflow from file repository through
module graph lexing and parsing once parser/module integration exists.

## Resolved Design Defaults

- Grammar coverage: target the whole current grammar. Implementation may be
  phased, but the design and tests should treat complete grammar coverage as the
  parser's destination.
- Expression parsing: implement precedence in the first parser rather than using
  a broad placeholder expression node. A Pratt parser is the preferred default
  because it keeps operator precedence local, testable, and easy to extend.
- Named accessors: keep core syntax nodes generic and slot-based. Put semantic
  names such as `ImageDeclarationView.name()` in the later typed AST view so the
  CST stays regular and tooling-friendly.
- Red-node caching: start with lazy child wrapper creation and no global cache.
  Add per-node child caching only if profiling shows repeated traversal
  allocation matters.
