# AST Views And Item Index Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement typed CST AST views and a deterministic semantic item index from `docs/design/ast-views-item-index-design.md`.

**Architecture:** AST views stay under `src/frontend/ast` and wrap existing red CST nodes without owning source data. Semantic item-index code lives under `src/semantic/item-index`, consumes `ParsedModuleGraph`, AST views, and intrinsic catalog fakes, then returns immutable record arrays plus item-index diagnostics. Parser, lexer, filesystem, package loading, target selection, HIR, MIR, and proof logic stay outside this phase.

**Tech Stack:** TypeScript, Bun test runner, existing lexer/parser/syntax red tree APIs, no runtime dependencies, `fast-check` only in tests.

---

## Research Notes

- The parser root is `SyntaxKind.SourceFile`; `SyntaxTree.root()` returns a `RedNode`.
- Red tree navigation is `RedNode.child(index)` and `RedNode.children()`. Repeated navigation returns new wrapper objects with stable coordinates.
- `RedToken.text` slices from `SourceText`; `RedToken.isMissing` identifies parser-inserted missing tokens.
- Every parsed `Block` stores its direct logical children through `Block -> StatementList -> item`. Declaration/member collection must use this one-block path, not broad descendant traversal.
- Function `requires` has two forms: bodyless direct `RequiresSection` child, and block-body direct item inside the body `StatementList`.
- Validated buffer sections are direct block items: `ParamsSection`, `LayoutSection`, `DeriveSection`, and `RequireSection`.
- Image device fields live in `ImageDeclaration -> Block -> StatementList -> DevicesSection -> Block -> StatementList -> FieldDeclaration`.
- Existing command requirements are from `package.json`: `bun run typecheck`, `bun run format:check`, `bun run lint`, `bun run policy:check`, and `bun test`. Handoff command is `bun run agent:check`.
- The current shell used to draft this plan did not have `bun` on PATH, but implementers should run the commands in the normal project environment.

## Parallel Execution Model

Use these waves to keep subagents from editing the same files at the same time:

```text
Wave 0: Tasks 1, 10, 11
Wave 1: Tasks 2, 3, 4 after Task 1
Wave 2: Tasks 5, 6, 7, 8 after Tasks 2-4
Wave 3: Task 9 after Tasks 5-8; Task 12 after Tasks 10-11
Wave 4: Tasks 13, 14, 15, 16 after Tasks 9 and 12
Wave 5: Tasks 17, 18 after Tasks 13-16
Wave 6: Task 19 after all prior tasks
```

Subagents should only pick tasks whose dependencies are satisfied. Each task includes its own acceptance criteria and command list. Commit messages in examples include `-Codex Automated` per repository convention.

## Target File Structure

```text
src/frontend/ast/
  ast-view.ts
  syntax-query.ts
  name-views.ts
  type-views.ts
  expression-views.ts
  statement-views.ts
  pattern-views.ts
  requirement-views.ts
  field-views.ts
  function-views.ts
  image-views.ts
  validated-buffer-views.ts
  declaration-views.ts
  index.ts

src/semantic/
  ids.ts
  index.ts
  item-index/
    diagnostics.ts
    intrinsic-catalog.ts
    item-records.ts
    item-index.ts
    stable-serialization.ts
    source-module-collector.ts
    source-member-collector.ts
    intrinsic-collector.ts
    duplicate-checker.ts
    item-index-builder.ts
    index.ts

tests/support/frontend/
  ast-test-support.ts
  module-graph-test-support.ts

tests/support/semantic/
  intrinsic-fakes.ts

tests/unit/frontend/ast/
  syntax-query.test.ts
  name-type-views.test.ts
  expression-views.test.ts
  statement-requirement-views.test.ts
  function-views.test.ts
  declaration-views.test.ts
  image-views.test.ts
  validated-buffer-views.test.ts

tests/unit/semantic/
  ids.test.ts
  item-index/
    intrinsic-catalog.test.ts
    item-index.test.ts
    source-module-collector.test.ts
    source-member-collector.test.ts
    intrinsic-collector.test.ts
    duplicates.test.ts
    item-index-builder.test.ts

tests/integration/semantic/
  item-index.test.ts
  public-api.test.ts
```

## Shared Implementation Rules

- Use descriptive names: `source`, `diagnostics`, `token`, `result`, and `context`.
- Do not import `fast-check` from `src`.
- Do not use `Bun.file` outside compiler edges.
- Do not use mocks or spies in tests. Use real parser output and plain-object fakes.
- Do not change parser behavior unless a test proves the parser already violates the AST design. This plan expects no parser changes.
- AST view methods must never throw for malformed syntax; return `undefined` or `[]`.
- Item-index builder code must be pure over `ParsedModuleGraph` and `IntrinsicCatalog`.

---

### Task 1: AST Foundation And Syntax Query Helpers

**Wave:** 0

**Dependencies:** None

**Description:** Create the AST foundation: `AstView`, direct-child query helpers, block item helpers, token text helper, `descendants`, and a parser-backed AST test helper. This task creates the surface every AST view task uses.

**Files:**

- Create: `src/frontend/ast/ast-view.ts`
- Create: `src/frontend/ast/syntax-query.ts`
- Create: `src/frontend/ast/index.ts`
- Create: `tests/support/frontend/ast-test-support.ts`
- Create: `tests/unit/frontend/ast/syntax-query.test.ts`

**Acceptance Criteria:**

- `AstView.kind`, `AstView.span`, and `AstView.source` delegate to the wrapped `RedNode`.
- `childNode`, `childNodes`, `childToken`, and `childTokens` inspect direct children only.
- `presentTokenText` returns `undefined` for absent or missing tokens.
- `descendants` recursively returns descendant `RedNode`s in source order and excludes the input node itself.
- `blockStatementList` returns the direct `StatementList` child under a `Block`.
- `blockItems` returns only direct `RedNode` items from a block's direct `StatementList`, skipping tokens and returning `[]` for malformed blocks.
- Unit tests parse real source where useful and pass with `bun test ./tests/unit/frontend/ast/syntax-query.test.ts`.

- [ ] **Step 1: Write failing syntax query tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { CollectingDiagnosticSink, SourceText, SyntaxKind } from "../../../../src/frontend";
import { Parser } from "../../../../src/frontend/parser";
import { Lexer, KeywordTable } from "../../../../src/frontend/lexer";
import {
  blockItems,
  blockStatementList,
  childNode,
  childNodes,
  childToken,
  descendants,
  presentTokenText,
} from "../../../../src/frontend/ast";
import { RedNode } from "../../../../src/frontend/syntax";

function parseRoot(sourceCode: string): RedNode {
  const source = SourceText.from("query-test.wr", sourceCode);
  const lexer = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
  const parser = new Parser();
  return parser.parseLexResult({ lexResult: lexer.lex(source) }).tree.root();
}

describe("syntax query helpers", () => {
  test("direct child helpers do not cross nested scopes", () => {
    const root = parseRoot("class Box:\n    field: U8\n");
    const classNode = childNode(root, SyntaxKind.ClassDeclaration)!;

    expect(childNode(classNode, SyntaxKind.FieldDeclaration)).toBeUndefined();
    expect(descendants(classNode, SyntaxKind.FieldDeclaration)).toHaveLength(1);
  });

  test("blockItems returns direct statement-list node items", () => {
    const root = parseRoot("class Box:\n    field: U8\n");
    const classNode = childNode(root, SyntaxKind.ClassDeclaration)!;
    const block = childNode(classNode, SyntaxKind.Block)!;

    expect(blockStatementList(block)!.kind).toBe(SyntaxKind.StatementList);
    expect(blockItems(block).map((node) => node.kind)).toEqual([SyntaxKind.FieldDeclaration]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/frontend/ast/syntax-query.test.ts
```

Expected: fails because `src/frontend/ast` exports do not exist.

- [ ] **Step 3: Implement the AST foundation**

Use this implementation pattern:

```ts
// src/frontend/ast/syntax-query.ts
import { RedNode, RedToken, SyntaxKind } from "../syntax";

export function childNode(node: RedNode, kind: SyntaxKind): RedNode | undefined {
  return node
    .children()
    .find((child): child is RedNode => child instanceof RedNode && child.kind === kind);
}

export function blockItems(block: RedNode): RedNode[] {
  const statementList = blockStatementList(block);
  if (statementList === undefined) return [];
  return statementList.children().filter((child): child is RedNode => child instanceof RedNode);
}
```

- [ ] **Step 4: Add parser-backed AST test support**

Use this support shape:

```ts
// tests/support/frontend/ast-test-support.ts
import {
  CollectingDiagnosticSink,
  Lexer,
  KeywordTable,
  Parser,
  SourceText,
} from "../../../src/frontend";
import type { RedNode } from "../../../src/frontend/syntax";

export function parseSourceRoot(sourceCode: string, name = "test.wr"): RedNode {
  const source = SourceText.from(name, sourceCode);
  const lexer = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
  const parser = new Parser();
  return parser.parseLexResult({ lexResult: lexer.lex(source) }).tree.root();
}
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
bun test ./tests/unit/frontend/ast/syntax-query.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/frontend/ast/ast-view.ts src/frontend/ast/syntax-query.ts src/frontend/ast/index.ts tests/support/frontend/ast-test-support.ts tests/unit/frontend/ast/syntax-query.test.ts
git commit -m "feat: add AST syntax query foundation -Codex Automated"
```

---

### Task 2: Name And Type Views

**Wave:** 1

**Dependencies:** Task 1

**Description:** Implement source-shaped name and type views for import module names, qualified type names, type references, type parameter lists, type parameters, type argument lists, and return type clauses.

**Files:**

- Create: `src/frontend/ast/name-views.ts`
- Create: `src/frontend/ast/type-views.ts`
- Modify: `src/frontend/ast/index.ts`
- Create: `tests/unit/frontend/ast/name-type-views.test.ts`

**Acceptance Criteria:**

- `DottedModuleNameView.segments()` returns present name tokens in source order.
- `DottedModuleNameView.text()` joins segment token text with `"."`.
- `QualifiedNameView.segments()` and `QualifiedNameView.text()` behave the same for type names.
- `TypeReferenceView.qualifiedName()` returns a `QualifiedNameView` when present.
- `TypeReferenceView.qualifiedNameText()` returns source-shaped dotted text.
- `TypeReferenceView.typeArguments()` returns direct type arguments in source order.
- `TypeParameterView.nameText()` and `bound()` handle missing names and absent bounds.
- `ReturnTypeClauseView.type()` returns the direct `TypeReferenceView`.

- [ ] **Step 1: Write failing type view tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode } from "../../../../src/frontend/ast";
import {
  DottedModuleNameView,
  QualifiedNameView,
  TypeParameterView,
  TypeReferenceView,
} from "../../../../src/frontend/ast";
import { RedNode } from "../../../../src/frontend/syntax";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("name and type views", () => {
  test("DottedModuleNameView preserves import path text", () => {
    const root = parseSourceRoot("use Packet from core.net.driver\n");
    const importNode = childNode(root, SyntaxKind.ImportDeclaration)!;
    const moduleName = childNode(importNode, SyntaxKind.DottedModuleName)!;
    const view = DottedModuleNameView.from(moduleName)!;

    expect(view.segments().map((token) => token.text)).toEqual(["core", "net", "driver"]);
    expect(view.text()).toBe("core.net.driver");
  });

  test("TypeReferenceView exposes qualified name and type arguments", () => {
    const root = parseSourceRoot("dataclass Box[T: core.Value]:\n    item: core.List[T]\n");
    const dataclassNode = childNode(root, SyntaxKind.DataclassDeclaration)!;
    const block = childNode(dataclassNode, SyntaxKind.Block)!;
    const statementList = childNode(block, SyntaxKind.StatementList)!;
    const field = statementList.child(0)! as RedNode;
    const typeReference = childNode(field, SyntaxKind.TypeReference)!;
    const view = TypeReferenceView.from(typeReference)!;

    expect(view.qualifiedNameText()).toBe("core.List");
    expect(view.typeArguments()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/frontend/ast/name-type-views.test.ts
```

Expected: fails because name/type views are not exported.

- [ ] **Step 3: Implement name and type views**

Use this access pattern:

```ts
export class QualifiedNameView extends AstView {
  static from(node: RedNode): QualifiedNameView | undefined {
    return node.kind === SyntaxKind.QualifiedName ? new QualifiedNameView(node) : undefined;
  }

  segments(): RedToken[] {
    return childTokens(this.node, SyntaxKind.IdentifierToken).filter((token) => !token.isMissing);
  }

  text(): string | undefined {
    const segments = this.segments().map((token) => token.text);
    return segments.length === 0 ? undefined : segments.join(".");
  }
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/frontend/ast/name-type-views.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/frontend/ast/name-views.ts src/frontend/ast/type-views.ts src/frontend/ast/index.ts tests/unit/frontend/ast/name-type-views.test.ts
git commit -m "feat: add AST name and type views -Codex Automated"
```

---

### Task 3: Expression Views

**Wave:** 1

**Dependencies:** Task 1 and Task 2

**Description:** Implement shallow expression views for every expression-shaped `SyntaxKind`, including call arguments and object fields.

**Files:**

- Create: `src/frontend/ast/expression-views.ts`
- Modify: `src/frontend/ast/index.ts`
- Create: `tests/unit/frontend/ast/expression-views.test.ts`

**Acceptance Criteria:**

- `ExpressionView.from(node)` returns a specific expression view for every current expression `SyntaxKind`.
- Name and literal views expose their primary token text.
- Member access exposes receiver expression and member token.
- Call expressions expose callee and `CallArgumentListView`.
- `CallArgumentListView.arguments()` returns both positional `ArgumentView` and `NamedArgumentView` wrappers in source order.
- Object literals expose `ObjectFieldView` entries with name token and value expression.
- Unary/binary/comparison/equality views expose operator token and operand expressions.
- Malformed or missing child syntax returns `undefined` or `[]`.

- [ ] **Step 1: Write failing expression view tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode, descendants } from "../../../../src/frontend/ast";
import {
  CallExpressionView,
  NameExpressionView,
  ObjectLiteralExpressionView,
} from "../../../../src/frontend/ast";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("expression views", () => {
  test("call expression exposes callee and named arguments", () => {
    const root = parseSourceRoot("fn main():\n    call(foo=1, 2)\n");
    const callNode = descendants(root, SyntaxKind.CallExpression)[0]!;
    const view = CallExpressionView.from(callNode)!;

    expect(NameExpressionView.from(view.callee()!.node)!.nameText()).toBe("call");
    expect(
      view
        .arguments()!
        .arguments()
        .map((argument) => argument.kind),
    ).toEqual([SyntaxKind.NamedArgument, SyntaxKind.Argument]);
  });

  test("object literal exposes fields", () => {
    const root = parseSourceRoot("fn main():\n    make({a: 1, b: 2})\n");
    const objectNode = descendants(root, SyntaxKind.ObjectLiteralExpression)[0]!;
    const view = ObjectLiteralExpressionView.from(objectNode)!;

    expect(view.fields().map((field) => field.nameText())).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/frontend/ast/expression-views.test.ts
```

Expected: fails because expression views do not exist.

- [ ] **Step 3: Implement expression view wrappers**

Use this wrapper pattern:

```ts
export type ExpressionView =
  | LiteralExpressionView
  | NameExpressionView
  | MemberAccessExpressionView
  | CallExpressionView
  | TypeApplicationExpressionView
  | AttemptExpressionView
  | UnaryExpressionView
  | BinaryExpressionView
  | ComparisonExpressionView
  | EqualityExpressionView
  | ObjectLiteralExpressionView
  | ElseRequirementExpressionView;

export function expressionViewFrom(node: RedNode): ExpressionView | undefined {
  switch (node.kind) {
    case SyntaxKind.NameExpression:
      return NameExpressionView.from(node);
    case SyntaxKind.CallExpression:
      return CallExpressionView.from(node);
    default:
      return undefined;
  }
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/frontend/ast/expression-views.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/frontend/ast/expression-views.ts src/frontend/ast/index.ts tests/unit/frontend/ast/expression-views.test.ts
git commit -m "feat: add AST expression views -Codex Automated"
```

---

### Task 4: Statement, Pattern, Block, And Requirement Views

**Wave:** 1

**Dependencies:** Task 1, Task 2, and Task 3

**Description:** Implement shallow views for statements, blocks, statement lists, patterns, and requirements. These views are needed by function `requires`, validated-buffer `require`, and nested function collection.

**Files:**

- Create: `src/frontend/ast/statement-views.ts`
- Create: `src/frontend/ast/pattern-views.ts`
- Create: `src/frontend/ast/requirement-views.ts`
- Modify: `src/frontend/ast/index.ts`
- Create: `tests/unit/frontend/ast/statement-requirement-views.test.ts`

**Acceptance Criteria:**

- `BlockView.items()` returns direct block items through `blockItems`.
- `StatementListView.items()` returns direct node children in source order.
- Statement wrappers exist for every statement `SyntaxKind` in the design.
- `ConditionView.expression()` exposes the direct condition expression when present.
- `PatternView` and `PatternListView` wrap current pattern syntax.
- `RequiresSectionView.requirements()` and `RequireSectionView.requirements()` return direct `RequirementView`s through the section block.
- `RequirementView.expression()` returns the direct expression.

- [ ] **Step 1: Write failing statement and requirement tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode, descendants } from "../../../../src/frontend/ast";
import { BlockView, RequireSectionView, RequiresSectionView } from "../../../../src/frontend/ast";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("statement and requirement views", () => {
  test("BlockView returns only direct items", () => {
    const root = parseSourceRoot(
      "fn main():\n    if flag:\n        fn nested()\n    fn direct()\n",
    );
    const functionNode = childNode(root, SyntaxKind.FunctionDeclaration)!;
    const block = childNode(functionNode, SyntaxKind.Block)!;
    const view = BlockView.from(block)!;

    expect(view.items().map((item) => item.kind)).toEqual([
      SyntaxKind.IfStatement,
      SyntaxKind.FunctionDeclaration,
    ]);
  });

  test("function requires sections expose requirements", () => {
    const root = parseSourceRoot("fn check():\n    requires:\n        flag else backup\n");
    const section = descendants(root, SyntaxKind.RequiresSection)[0]!;
    const view = RequiresSectionView.from(section)!;

    expect(view.requirements()).toHaveLength(1);
    expect(view.requirements()[0]!.expression()!.kind).toBe(SyntaxKind.ElseRequirementExpression);
  });

  test("validated-buffer require sections expose requirements", () => {
    const root = parseSourceRoot("validated buffer Packet:\n    require:\n        size > 0\n");
    const section = descendants(root, SyntaxKind.RequireSection)[0]!;
    const view = RequireSectionView.from(section)!;

    expect(view.requirements()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/frontend/ast/statement-requirement-views.test.ts
```

Expected: fails because statement and requirement views do not exist.

- [ ] **Step 3: Implement block and requirement traversal**

Use this traversal pattern:

```ts
export class RequiresSectionView extends AstView {
  requirements(): RequirementView[] {
    const block = childNode(this.node, SyntaxKind.Block);
    if (block === undefined) return [];
    return blockItems(block)
      .filter((node) => node.kind === SyntaxKind.Requirement)
      .map((node) => RequirementView.from(node)!)
      .filter((view) => view !== undefined);
  }
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/frontend/ast/statement-requirement-views.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/frontend/ast/statement-views.ts src/frontend/ast/pattern-views.ts src/frontend/ast/requirement-views.ts src/frontend/ast/index.ts tests/unit/frontend/ast/statement-requirement-views.test.ts
git commit -m "feat: add AST statement and requirement views -Codex Automated"
```

---

### Task 5: Function And Parameter Views

**Wave:** 2

**Dependencies:** Tasks 2 and 4

**Description:** Implement `FunctionDeclarationView`, `ParameterView`, function modifier extraction, return type extraction, type parameter extraction, and the two-form `requiresSections()` accessor.

**Files:**

- Create: `src/frontend/ast/function-views.ts`
- Modify: `src/frontend/ast/index.ts`
- Create: `tests/unit/frontend/ast/function-views.test.ts`

**Acceptance Criteria:**

- `FunctionDeclarationView.from` narrows only `SyntaxKind.FunctionDeclaration`.
- `nameToken`, `nameText`, and `nameSpan` ignore missing name tokens.
- `modifiers()` returns only present function modifiers in source order.
- `parameters()` returns direct `ParameterView`s from the direct `ParameterList`.
- `typeParameters()` returns direct `TypeParameterView`s from the direct `TypeParameterList`.
- `returnType()` returns the return `TypeReferenceView` when present.
- `body()` returns the direct `BlockView` when present.
- `requiresSections()` returns direct bodyless sections and direct body-block sections in source order.
- `ParameterView` exposes `nameText`, `nameSpan`, `type`, and `isConsumed`.

- [ ] **Step 1: Write failing function view tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode } from "../../../../src/frontend/ast";
import { FunctionDeclarationView } from "../../../../src/frontend/ast";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("FunctionDeclarationView", () => {
  test("exposes signature and modifiers", () => {
    const root = parseSourceRoot("private platform fn boot[T](consume image: Image) -> Result\n");
    const functionNode = childNode(root, SyntaxKind.FunctionDeclaration)!;
    const view = FunctionDeclarationView.from(functionNode)!;

    expect(view.nameText()).toBe("boot");
    expect(view.modifiers()).toEqual(["private", "platform"]);
    expect(view.typeParameters().map((param) => param.nameText())).toEqual(["T"]);
    expect(view.parameters()[0]!.isConsumed()).toBe(true);
    expect(view.parameters()[0]!.type()!.qualifiedNameText()).toBe("Image");
    expect(view.returnType()!.qualifiedNameText()).toBe("Result");
  });

  test("returns both bodyless and body requires sections", () => {
    const bodyless = FunctionDeclarationView.from(
      childNode(
        parseSourceRoot("fn check()\n    requires:\n        flag\n"),
        SyntaxKind.FunctionDeclaration,
      )!,
    )!;
    const withBody = FunctionDeclarationView.from(
      childNode(
        parseSourceRoot("fn check():\n    requires:\n        flag\n    flag\n"),
        SyntaxKind.FunctionDeclaration,
      )!,
    )!;

    expect(bodyless.requiresSections()).toHaveLength(1);
    expect(withBody.requiresSections()).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/frontend/ast/function-views.test.ts
```

Expected: fails because function views do not exist.

- [ ] **Step 3: Implement function accessors**

Use this `requiresSections()` shape:

```ts
requiresSections(): RequiresSectionView[] {
  const directSections = childNodes(this.node, SyntaxKind.RequiresSection);
  const bodySections = this.body()?.items()
    .filter((item) => item.kind === SyntaxKind.RequiresSection) ?? [];

  return [...directSections, ...bodySections]
    .map((node) => RequiresSectionView.from(node))
    .filter((view): view is RequiresSectionView => view !== undefined);
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/frontend/ast/function-views.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/frontend/ast/function-views.ts src/frontend/ast/index.ts tests/unit/frontend/ast/function-views.test.ts
git commit -m "feat: add AST function views -Codex Automated"
```

---

### Task 6: Field, Image, And Device Views

**Wave:** 2

**Dependencies:** Tasks 2, 3, and 4

**Description:** Implement source field views, layout field views, derived field views, derive case views, image declaration views, and devices section views.

**Files:**

- Create: `src/frontend/ast/field-views.ts`
- Create: `src/frontend/ast/image-views.ts`
- Modify: `src/frontend/ast/index.ts`
- Create: `tests/unit/frontend/ast/image-views.test.ts`

**Acceptance Criteria:**

- `FieldDeclarationView` exposes name and syntactic type.
- `LayoutFieldView` exposes name, syntactic type, offset expression, and optional length expression.
- `DerivedFieldView` exposes name, syntactic type, source expression, and derive cases.
- `DeriveCaseView` exposes condition and result expressions.
- `ImageDeclarationView.fields()` returns only direct image body fields.
- `ImageDeclarationView.deviceSections()` returns direct device sections.
- `ImageDeclarationView.deviceFields()` returns only fields inside direct device sections.
- Nested fields in unrelated statement blocks are not returned as image fields or device fields.

- [ ] **Step 1: Write failing image and field tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode } from "../../../../src/frontend/ast";
import { ImageDeclarationView } from "../../../../src/frontend/ast";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("image and field views", () => {
  test("separates image fields from device fields", () => {
    const root = parseSourceRoot(
      "uefi image Boot:\n    top: ImageField\n    devices:\n        net0: NetDevice\n    fn local()\n",
    );
    const imageNode = childNode(root, SyntaxKind.ImageDeclaration)!;
    const view = ImageDeclarationView.from(imageNode)!;

    expect(view.fields().map((field) => field.nameText())).toEqual(["top"]);
    expect(view.deviceFields().map((field) => field.nameText())).toEqual(["net0"]);
    expect(view.memberFunctions().map((fn) => fn.nameText())).toEqual(["local"]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/frontend/ast/image-views.test.ts
```

Expected: fails because image/field views do not exist.

- [ ] **Step 3: Implement scoped image traversal**

Use this traversal shape:

```ts
fields(): FieldDeclarationView[] {
  return this.bodyItems()
    .filter((node) => node.kind === SyntaxKind.FieldDeclaration)
    .map((node) => FieldDeclarationView.from(node)!)
    .filter((view) => view !== undefined);
}

deviceFields(): FieldDeclarationView[] {
  return this.deviceSections().flatMap((section) => section.fields());
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/frontend/ast/image-views.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/frontend/ast/field-views.ts src/frontend/ast/image-views.ts src/frontend/ast/index.ts tests/unit/frontend/ast/image-views.test.ts
git commit -m "feat: add AST image and field views -Codex Automated"
```

---

### Task 7: Validated Buffer Section Views

**Wave:** 2

**Dependencies:** Tasks 2, 3, 4, and 6

**Description:** Implement `ValidatedBufferDeclarationView` plus params, layout, derive, and require section accessors.

**Files:**

- Create: `src/frontend/ast/validated-buffer-views.ts`
- Modify: `src/frontend/ast/index.ts`
- Create: `tests/unit/frontend/ast/validated-buffer-views.test.ts`

**Acceptance Criteria:**

- `ValidatedBufferDeclarationView` exposes name, params sections, layout sections, derive sections, and require sections.
- `paramFields()` flattens direct fields from direct params sections in source order.
- `layoutFields()` flattens direct layout fields from direct layout sections in source order.
- `DeriveSectionView.fields()` returns direct `DerivedFieldView`s.
- `RequireSectionView.requirements()` reuses the requirement view behavior from Task 4.
- Multiple sections of the same kind are preserved in source order.

- [ ] **Step 1: Write failing validated-buffer tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { SyntaxKind } from "../../../../src/frontend";
import { childNode } from "../../../../src/frontend/ast";
import { ValidatedBufferDeclarationView } from "../../../../src/frontend/ast";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("ValidatedBufferDeclarationView", () => {
  test("exposes section groups and flattened field records", () => {
    const root = parseSourceRoot(
      "validated buffer Packet:\n    params:\n        size: U16\n    layout:\n        data: U8 @ 0 len 4\n    derive:\n        kind: U8 from data:\n            1 => 2\n    require:\n        size > 0\n",
    );
    const bufferNode = childNode(root, SyntaxKind.ValidatedBufferDeclaration)!;
    const view = ValidatedBufferDeclarationView.from(bufferNode)!;

    expect(view.nameText()).toBe("Packet");
    expect(view.paramsSections()).toHaveLength(1);
    expect(view.layoutSections()).toHaveLength(1);
    expect(view.deriveSections()).toHaveLength(1);
    expect(view.requireSections()).toHaveLength(1);
    expect(view.paramFields().map((field) => field.nameText())).toEqual(["size"]);
    expect(view.layoutFields().map((field) => field.nameText())).toEqual(["data"]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/frontend/ast/validated-buffer-views.test.ts
```

Expected: fails because validated-buffer views do not exist.

- [ ] **Step 3: Implement validated-buffer scoped traversal**

Use this flattening pattern:

```ts
paramFields(): FieldDeclarationView[] {
  return this.paramsSections().flatMap((section) => section.fields());
}

layoutFields(): LayoutFieldView[] {
  return this.layoutSections().flatMap((section) => section.fields());
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/frontend/ast/validated-buffer-views.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/frontend/ast/validated-buffer-views.ts src/frontend/ast/index.ts tests/unit/frontend/ast/validated-buffer-views.test.ts
git commit -m "feat: add AST validated buffer views -Codex Automated"
```

---

### Task 8: Source Declaration Views And Declaration Union

**Wave:** 2

**Dependencies:** Tasks 2, 5, 6, and 7

**Description:** Implement source-file, import, enum, enum case, dataclass, class, edge class, interface, stream, and declaration-union views. Re-export all AST view modules through the AST barrel.

**Files:**

- Create: `src/frontend/ast/declaration-views.ts`
- Modify: `src/frontend/ast/index.ts`
- Create: `tests/unit/frontend/ast/declaration-views.test.ts`

**Acceptance Criteria:**

- `SourceFileView.fromRoot` narrows only `SyntaxKind.SourceFile`.
- `SourceFileView.imports()` returns top-level import declarations only.
- `SourceFileView.declarations()` returns top-level declaration views in source order and excludes imports and top-level statements.
- `ImportDeclarationView.moduleName()` returns a `DottedModuleNameView`.
- Named declaration views expose present names and spans.
- Class modifier extraction returns `["private"]` only when the class has a private token.
- Edge class modifier extraction returns `["unique"]` only when the edge class has a unique token.
- Common type-like views expose direct fields, enum cases, member functions, and type parameters through one-block traversal.

- [ ] **Step 1: Write failing declaration view tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { SourceFileView } from "../../../../src/frontend/ast";
import { parseSourceRoot } from "../../../support/frontend/ast-test-support";

describe("source declaration views", () => {
  test("SourceFileView separates imports and declarations", () => {
    const root = parseSourceRoot("use Packet from core.net\n\nprivate class Box:\n    field: U8\n");
    const view = SourceFileView.fromRoot(root)!;

    expect(view.imports().map((item) => item.moduleName()!.text())).toEqual(["core.net"]);
    expect(view.declarations().map((item) => item.nameText())).toEqual(["Box"]);
    expect(view.declarations()[0]!.modifiers()).toEqual(["private"]);
  });

  test("enum cases are declaration-local children", () => {
    const root = parseSourceRoot("enum Color:\n    Red\n    Blue\n");
    const view = SourceFileView.fromRoot(root)!;
    const enumView = view.declarations()[0]!;

    expect(enumView.kind).toBe("enum");
    expect(enumView.enumCases().map((item) => item.nameText())).toEqual(["Red", "Blue"]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/frontend/ast/declaration-views.test.ts
```

Expected: fails because declaration union views do not exist.

- [ ] **Step 3: Implement declaration union conversion**

Use this conversion shape:

```ts
export type DeclarationView =
  | EnumDeclarationView
  | EnumCaseView
  | DataclassDeclarationView
  | ClassDeclarationView
  | EdgeClassDeclarationView
  | InterfaceDeclarationView
  | StreamDeclarationView
  | ValidatedBufferDeclarationView
  | ImageDeclarationView
  | FunctionDeclarationView;

export function declarationViewFrom(node: RedNode): DeclarationView | undefined {
  switch (node.kind) {
    case SyntaxKind.EnumDeclaration:
      return EnumDeclarationView.from(node);
    case SyntaxKind.FunctionDeclaration:
      return FunctionDeclarationView.from(node);
    default:
      return undefined;
  }
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/frontend/ast/declaration-views.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/frontend/ast/declaration-views.ts src/frontend/ast/index.ts tests/unit/frontend/ast/declaration-views.test.ts
git commit -m "feat: add AST declaration views -Codex Automated"
```

---

### Task 9: Frontend AST Barrel Integration

**Wave:** 3

**Dependencies:** Tasks 1-8

**Description:** Export AST views from the frontend barrel while preserving existing lexer/parser/syntax exports and compatibility imports.

**Files:**

- Modify: `src/frontend/index.ts`
- Modify: `tests/integration/frontend/public-api.test.ts`

**Acceptance Criteria:**

- `src/frontend/index.ts` exports `./ast`.
- Existing frontend public API tests still pass.
- New public API assertions can import `SourceFileView`, `FunctionDeclarationView`, and `TypeReferenceView` from `src/frontend`.
- Compatibility imports from legacy `src/lexer` remain untouched.

- [ ] **Step 1: Write failing public API assertions**

Use this test addition:

```ts
import { FunctionDeclarationView, SourceFileView, TypeReferenceView } from "../../../src/frontend";

test("frontend namespace exports AST views", () => {
  expect(frontend.SourceFileView).toBeDefined();
  expect(frontend.FunctionDeclarationView).toBeDefined();
  expect(frontend.TypeReferenceView).toBeDefined();
  expect(SourceFileView).toBeDefined();
  expect(FunctionDeclarationView).toBeDefined();
  expect(TypeReferenceView).toBeDefined();
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/integration/frontend/public-api.test.ts
```

Expected: fails because frontend does not export AST views yet.

- [ ] **Step 3: Export AST views**

Use this barrel shape:

```ts
export * from "./lexer";
export * from "./syntax";
export * from "./parser";
export * from "./ast";
export { parseModuleGraph } from "./module-graph-parser";
export type { ParsedModule, ParsedModuleGraph, ModuleGraphParseInput } from "./module-graph-parser";
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/integration/frontend/public-api.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/frontend/index.ts tests/integration/frontend/public-api.test.ts
git commit -m "feat: export AST views from frontend API -Codex Automated"
```

---

### Task 10: Semantic ID Constructors

**Wave:** 0

**Dependencies:** None

**Description:** Implement opaque branded numeric ID constructors and `IntrinsicId` validation.

**Files:**

- Create: `src/semantic/ids.ts`
- Create: `tests/unit/semantic/ids.test.ts`

**Acceptance Criteria:**

- Exports `ModuleId`, `ItemId`, `TypeId`, `FunctionId`, `ImageId`, `FieldId`, `ParameterId`, and `IntrinsicId`.
- Numeric constructors reject negative values, non-integers, and non-finite values.
- Numeric constructors return dense branded numbers for valid zero-based values.
- `intrinsicId(value)` rejects empty strings and strings with leading or trailing whitespace.
- Tests pass with `bun test ./tests/unit/semantic/ids.test.ts`.

- [ ] **Step 1: Write failing ID tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { intrinsicId, itemId, moduleId } from "../../../src/semantic/ids";

describe("semantic IDs", () => {
  test("numeric IDs preserve dense values", () => {
    expect(moduleId(0)).toBe(0);
    expect(itemId(2)).toBe(2);
  });

  test("numeric IDs reject invalid values", () => {
    expect(() => moduleId(-1)).toThrow("non-negative integer");
    expect(() => itemId(1.5)).toThrow("non-negative integer");
  });

  test("IntrinsicId rejects empty or padded strings", () => {
    expect(intrinsicId("intrinsics.memory.load")).toBe("intrinsics.memory.load");
    expect(() => intrinsicId("")).toThrow("must not be empty");
    expect(() => intrinsicId(" intrinsics.memory.load")).toThrow("whitespace");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/semantic/ids.test.ts
```

Expected: fails because `src/semantic/ids.ts` does not exist.

- [ ] **Step 3: Implement ID constructors**

Use this constructor pattern:

```ts
function denseId(value: number, label: string): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer.`);
  }
  return value;
}

export function moduleId(value: number): ModuleId {
  return denseId(value, "ModuleId") as ModuleId;
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/semantic/ids.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/semantic/ids.ts tests/unit/semantic/ids.test.ts
git commit -m "feat: add semantic ID constructors -Codex Automated"
```

---

### Task 11: Intrinsic Catalog Contracts And Stable Serialization

**Wave:** 0

**Dependencies:** Task 10

**Description:** Implement intrinsic catalog types, opaque proof/lowering contracts, and a stable serializer used for deterministic tie-breaks.

**Files:**

- Create: `src/semantic/item-index/intrinsic-catalog.ts`
- Create: `src/semantic/item-index/stable-serialization.ts`
- Create: `src/semantic/item-index/index.ts`
- Create: `tests/support/semantic/intrinsic-fakes.ts`
- Create: `tests/unit/semantic/item-index/intrinsic-catalog.test.ts`

**Acceptance Criteria:**

- Intrinsic function declarations use `IntrinsicFunctionSignature` with type parameters, parameters, and optional return type.
- Intrinsic type declarations use `IntrinsicTypeSignature` with type parameters only.
- `stableSerializeIntrinsicDeclaration` sorts object keys recursively and preserves array order.
- Stable serialization output is deterministic for equivalent plain objects with different property insertion order.
- `tests/support/semantic/intrinsic-fakes.ts` exports `intrinsicFunctionFake` and `intrinsicCatalogFake` for later item-index tests.
- No runtime dependency is introduced.

- [ ] **Step 1: Write failing intrinsic catalog tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { intrinsicId } from "../../../../src/semantic/ids";
import {
  stableSerializeIntrinsicDeclaration,
  type IntrinsicCatalog,
} from "../../../../src/semantic/item-index";

describe("intrinsic catalog contracts", () => {
  test("stable serialization sorts object keys recursively", () => {
    const left = { b: "two", a: { z: "last", c: "first" } };
    const right = { a: { c: "first", z: "last" }, b: "two" };

    expect(stableSerializeIntrinsicDeclaration(left)).toBe(
      stableSerializeIntrinsicDeclaration(right),
    );
  });

  test("catalog fake satisfies function and type contracts", () => {
    const catalog: IntrinsicCatalog = {
      modules: [
        {
          pathKey: "intrinsics/memory.wr",
          display: "intrinsics/memory.wr",
          declarations: [
            {
              kind: "function",
              intrinsicId: intrinsicId("intrinsics.memory.load"),
              name: "load",
              signature: {
                typeParameters: [],
                parameters: [
                  {
                    name: "address",
                    type: { name: ["Address"], arguments: [] },
                    isConsumed: false,
                  },
                ],
                returnType: { name: ["U8"], arguments: [] },
              },
              targetAvailability: { targets: ["test"] },
              proofContract: {
                requiredFacts: [],
                consumedCapabilities: [],
                producedCapabilities: [],
              },
              lowering: { backend: "test", operation: "load", attributes: {} },
            },
          ],
        },
      ],
    };

    expect(catalog.modules[0]!.declarations[0]!.name).toBe("load");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/semantic/item-index/intrinsic-catalog.test.ts
```

Expected: fails because intrinsic catalog files do not exist.

- [ ] **Step 3: Implement contracts and serializer**

Use this serializer shape:

```ts
export function stableSerializeIntrinsicDeclaration(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerializeIntrinsicDeclaration).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableSerializeIntrinsicDeclaration(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}
```

Add this fake-support shape for later tests:

```ts
// tests/support/semantic/intrinsic-fakes.ts
import { intrinsicId, type IntrinsicId } from "../../../src/semantic/ids";
import type {
  IntrinsicCatalog,
  IntrinsicFunctionDeclarationSpec,
} from "../../../src/semantic/item-index";

const testType = { name: ["U8"], arguments: [] };

export function intrinsicFunctionFake(
  name: string,
  id: IntrinsicId = intrinsicId(`intrinsics.test.${name}`),
): IntrinsicFunctionDeclarationSpec {
  return {
    kind: "function",
    intrinsicId: id,
    name,
    signature: {
      typeParameters: [],
      parameters: [{ name: "value", type: testType, isConsumed: false }],
      returnType: testType,
    },
    targetAvailability: { targets: ["test"] },
    proofContract: { requiredFacts: [], consumedCapabilities: [], producedCapabilities: [] },
    lowering: { backend: "test", operation: name, attributes: {} },
  };
}

export function intrinsicCatalogFake(names: readonly string[]): IntrinsicCatalog {
  return {
    modules: [
      {
        pathKey: "intrinsics/test.wr",
        display: "intrinsics/test.wr",
        declarations: names.map((name) => intrinsicFunctionFake(name)),
      },
    ],
  };
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/semantic/item-index/intrinsic-catalog.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/semantic/item-index/intrinsic-catalog.ts src/semantic/item-index/stable-serialization.ts src/semantic/item-index/index.ts tests/support/semantic/intrinsic-fakes.ts tests/unit/semantic/item-index/intrinsic-catalog.test.ts
git commit -m "feat: add intrinsic catalog contracts -Codex Automated"
```

---

### Task 12: Item Records And Immutable ItemIndex

**Wave:** 3

**Dependencies:** Tasks 10 and 11

**Description:** Implement record types and the read-only `ItemIndex` value object with lookup methods.

**Files:**

- Create: `src/semantic/item-index/item-records.ts`
- Create: `src/semantic/item-index/item-index.ts`
- Modify: `src/semantic/item-index/index.ts`
- Create: `tests/unit/semantic/item-index/item-index.test.ts`

**Acceptance Criteria:**

- Record types match the design, including source/intrinsic item variants and source/intrinsic parameter variants.
- `ItemIndex` methods return readonly arrays or copies that callers cannot mutate into internal state.
- ID lookup methods bounds-check and return `undefined` for unknown numeric IDs.
- `moduleByPath(pathKey, origin)` requires explicit origin and returns the matching module only.
- `itemsInModule(moduleId)` returns items in item order.

- [ ] **Step 1: Write failing ItemIndex tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { SourceSpan } from "../../../../src/frontend";
import { itemId, moduleId } from "../../../../src/semantic/ids";
import {
  ItemIndex,
  type ModuleRecord,
  type SourceItemRecord,
} from "../../../../src/semantic/item-index";

describe("ItemIndex", () => {
  test("returns copies for arrays and bounds-checks lookups", () => {
    const declaration = {} as SourceItemRecord["declaration"];
    const moduleRecord: ModuleRecord = {
      id: moduleId(0),
      origin: "source",
      pathKey: "app/main.wr",
      display: "app/main.wr",
    };
    const itemRecord: SourceItemRecord = {
      id: itemId(0),
      origin: "source",
      kind: "class",
      moduleId: moduleId(0),
      name: "Box",
      modifiers: [],
      nameSpan: SourceSpan.from(0, 3),
      span: SourceSpan.from(0, 10),
      declaration,
      typeId: undefined,
      functionId: undefined,
      imageId: undefined,
    };

    const index = new ItemIndex({
      modules: [moduleRecord],
      items: [itemRecord],
      types: [],
      functions: [],
      images: [],
      fields: [],
      parameters: [],
    });
    const modules = index.modules() as ModuleRecord[];
    modules.pop();

    expect(index.modules()).toHaveLength(1);
    expect(index.item(itemId(99))).toBeUndefined();
    expect(index.moduleByPath("app/main.wr", "source")!.id).toBe(moduleId(0));
    expect(index.moduleByPath("app/main.wr", "intrinsic")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/semantic/item-index/item-index.test.ts
```

Expected: fails because item-index records do not exist.

- [ ] **Step 3: Implement record types and ItemIndex**

Use this constructor shape:

```ts
export class ItemIndex {
  private readonly moduleRecords: readonly ModuleRecord[];
  private readonly itemRecords: readonly ItemRecord[];

  constructor(records: ItemIndexRecords) {
    this.moduleRecords = [...records.modules];
    this.itemRecords = [...records.items];
  }

  modules(): readonly ModuleRecord[] {
    return [...this.moduleRecords];
  }

  item(id: ItemId): ItemRecord | undefined {
    return this.itemRecords[id as number];
  }
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/semantic/item-index/item-index.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/semantic/item-index/item-records.ts src/semantic/item-index/item-index.ts src/semantic/item-index/index.ts tests/unit/semantic/item-index/item-index.test.ts
git commit -m "feat: add immutable item index records -Codex Automated"
```

---

### Task 13: Source Module And Top-Level Item Collector

**Wave:** 4

**Dependencies:** Tasks 8, 10, and 12

**Description:** Implement source module sorting, module record creation, top-level declaration collection, source item records, and primary `TypeId`, `FunctionId`, and `ImageId` assignment for top-level declarations.

**Files:**

- Create: `src/semantic/item-index/source-module-collector.ts`
- Modify: `src/semantic/item-index/index.ts`
- Create: `tests/support/frontend/module-graph-test-support.ts`
- Create: `tests/unit/semantic/item-index/source-module-collector.test.ts`

**Acceptance Criteria:**

- Source modules sort by `path.key`, then `source.name`, then `source.text`.
- Source `ModuleRecord`s are dense and zero-based.
- Well-named top-level declarations produce `SourceItemRecord`s in source order within sorted modules.
- Unnamed malformed declarations are skipped.
- Top-level type-like declarations receive `TypeId`s.
- Top-level function declarations receive `FunctionId`s.
- Top-level image declarations receive `ImageId`s.
- Source modifiers are copied into source item records.
- `tests/support/frontend/module-graph-test-support.ts` exports parser-backed graph helpers for later semantic tests.
- This task does not collect fields, parameters, enum cases, member functions, or duplicates; those are handled by later collector tasks.

- [ ] **Step 1: Add graph support and write failing source module collector tests**

Use this support shape in `tests/support/frontend/module-graph-test-support.ts`:

```ts
import {
  CollectingDiagnosticSink,
  KeywordTable,
  Lexer,
  ModulePath,
  Parser,
  SourceText,
  type ParsedModuleGraph,
  type ParsedModule,
} from "../../../src/frontend";

export function parsedModuleForTest(path: string, sourceCode: string): ParsedModule {
  const source = SourceText.from(path, sourceCode);
  const lexer = new Lexer({
    keywords: KeywordTable.default(),
    diagnostics: new CollectingDiagnosticSink(),
  });
  const parser = new Parser();
  const lexResult = lexer.lex(source);
  const parseResult = parser.parseLexResult({ lexResult });
  return {
    path: ModulePath.from(path),
    source,
    tokens: lexResult.tokens,
    imports: [],
    tree: parseResult.tree,
    parserDiagnostics: parseResult.parserDiagnostics,
  };
}

export function parseModuleGraphForTest(
  modules: readonly (readonly [string, string])[],
): ParsedModuleGraph {
  const parsedModules = modules.map(([path, sourceCode]) => parsedModuleForTest(path, sourceCode));
  return {
    entry: ModulePath.from(modules[0]![0]),
    modules: parsedModules,
    diagnostics: parsedModules.flatMap((module) => module.parserDiagnostics),
  };
}

export function parseSingleModuleGraphForTest(path: string, sourceCode: string): ParsedModuleGraph {
  return parseModuleGraphForTest([[path, sourceCode]]);
}
```

Use this test shape in `tests/unit/semantic/item-index/source-module-collector.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { collectSourceModulesAndTopLevelItems } from "../../../../src/semantic/item-index";
import { parsedModuleForTest } from "../../../support/frontend/module-graph-test-support";

describe("source module collector", () => {
  test("sorts modules and creates top-level item records", () => {
    const result = collectSourceModulesAndTopLevelItems([
      parsedModuleForTest("b.wr", "fn b()\n"),
      parsedModuleForTest("a.wr", "private class A:\n"),
    ]);

    expect(result.modules.map((module) => module.pathKey)).toEqual(["a.wr", "b.wr"]);
    expect(result.items.map((item) => item.name)).toEqual(["A", "b"]);
    expect(result.items[0]!.modifiers).toEqual(["private"]);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/semantic/item-index/source-module-collector.test.ts
```

Expected: fails because source collector does not exist.

- [ ] **Step 3: Implement the collector**

Use this data-shape pattern:

```ts
export interface SourceCollectionResult {
  readonly modules: readonly ModuleRecord[];
  readonly items: readonly ItemRecord[];
  readonly types: readonly TypeRecord[];
  readonly functions: readonly FunctionRecord[];
  readonly images: readonly ImageRecord[];
  readonly declarationWorkItems: readonly SourceDeclarationWorkItem[];
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/semantic/item-index/source-module-collector.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/semantic/item-index/source-module-collector.ts src/semantic/item-index/index.ts tests/support/frontend/module-graph-test-support.ts tests/unit/semantic/item-index/source-module-collector.test.ts
git commit -m "feat: collect source modules and top-level items -Codex Automated"
```

---

### Task 14: Source Member, Field, Parameter, Enum Case, And Nested Function Collector

**Wave:** 4

**Dependencies:** Tasks 5, 6, 7, 8, 10, 12, and 13

**Description:** Implement declaration-local collection for fields, parameters, enum cases, member functions, validated-buffer params/layout fields, image device fields, and nested function declarations.

**Files:**

- Create: `src/semantic/item-index/source-member-collector.ts`
- Modify: `src/semantic/item-index/index.ts`
- Create: `tests/unit/semantic/item-index/source-member-collector.test.ts`

**Acceptance Criteria:**

- Enum cases become `SourceItemRecord`s with `kind: "enumCase"` and `parentItemId` set to the enum item.
- Class/dataclass/interface fields receive `FieldRecord`s with role `"field"`.
- Image direct fields receive role `"field"` and image device fields receive role `"imageDevice"`.
- Validated-buffer param fields receive role `"validatedParam"` and layout fields receive role `"layoutField"`.
- Source function parameters receive `SourceParameterRecord`s in parameter order.
- Function declarations inside declaration bodies receive `parentItemId`.
- Function declarations anywhere inside another function body's statement tree receive `parentItemId` for the nearest enclosing function item.
- Function declarations inside control-flow blocks under non-function declaration bodies are not collected as members.
- Missing names are skipped without throwing.

- [ ] **Step 1: Write failing source member collector tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { ItemIndex } from "../../../../src/semantic/item-index";
import {
  collectSourceMembers,
  collectSourceModulesAndTopLevelItems,
} from "../../../../src/semantic/item-index";
import { parseSingleModuleGraphForTest } from "../../../support/frontend/module-graph-test-support";

function collectSourceIndexForTest(path: string, sourceCode: string): ItemIndex {
  const graph = parseSingleModuleGraphForTest(path, sourceCode);
  const source = collectSourceModulesAndTopLevelItems(graph.modules);
  const withMembers = collectSourceMembers(source);
  return new ItemIndex(withMembers);
}

describe("source member collector", () => {
  test("collects enum cases, fields, image devices, validated-buffer fields, and parameters", () => {
    const index = collectSourceIndexForTest(
      "main.wr",
      [
        "enum Color:",
        "    Red",
        "class Box:",
        "    field: U8",
        "uefi image Boot:",
        "    top: ImageField",
        "    devices:",
        "        net0: NetDevice",
        "validated buffer Packet:",
        "    params:",
        "        size: U16",
        "    layout:",
        "        data: U8 @ 0 len 4",
        "fn run(consume packet: Packet)",
      ].join("\n") + "\n",
    );

    expect(index.items().map((item) => item.name)).toContain("Red");
    expect(index.fields().map((field) => field.role)).toEqual([
      "field",
      "field",
      "imageDevice",
      "validatedParam",
      "layoutField",
    ]);
    expect(index.parameters()[0]!.origin).toBe("source");
    expect(index.parameters()[0]!.isConsumed).toBe(true);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/semantic/item-index/source-member-collector.test.ts
```

Expected: fails because source member collector does not exist.

- [ ] **Step 3: Implement source member collection**

Use this collector split:

```ts
export function collectSourceMembers(
  context: SourceMemberCollectionContext,
): SourceMemberCollectionResult {
  for (const workItem of context.declarationWorkItems) {
    collectDeclarationLocalRecords(workItem, context);
  }
  return context.toResult();
}
```

Use a statement-tree walk only for nested functions inside function bodies:

```ts
function collectNestedFunctionsInFunctionBody(owner: FunctionRecord, body: BlockView): void {
  for (const item of walkStatementTree(body.items())) {
    if (item.kind === SyntaxKind.FunctionDeclaration) {
      collectFunctionDeclaration(item, owner.itemId);
    }
  }
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/semantic/item-index/source-member-collector.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/semantic/item-index/source-member-collector.ts src/semantic/item-index/index.ts tests/unit/semantic/item-index/source-member-collector.test.ts
git commit -m "feat: collect source declaration members -Codex Automated"
```

---

### Task 15: Intrinsic Module, Declaration, And Parameter Collector

**Wave:** 4

**Dependencies:** Tasks 10, 11, and 12

**Description:** Implement intrinsic module sorting, intrinsic declaration sorting, intrinsic item records, intrinsic type/function records, and intrinsic parameter records.

**Files:**

- Create: `src/semantic/item-index/intrinsic-collector.ts`
- Modify: `src/semantic/item-index/index.ts`
- Create: `tests/unit/semantic/item-index/intrinsic-collector.test.ts`

**Acceptance Criteria:**

- Intrinsic modules sort by `pathKey`, then `display`, then stable declaration serialization.
- Intrinsic declarations sort by `intrinsicId`, then declaration name, then declaration kind, then stable signature serialization.
- Intrinsic items receive `origin: "intrinsic"`.
- Intrinsic function declarations receive `FunctionId`s and intrinsic parameter records without source spans.
- Intrinsic type declarations receive `TypeId`s and no function record.
- Proof contract, lowering contract, target availability, and intrinsic ID are preserved by reference or value without interpretation.

- [ ] **Step 1: Write failing intrinsic collector tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { intrinsicId } from "../../../../src/semantic/ids";
import { collectIntrinsicItems, type IntrinsicCatalog } from "../../../../src/semantic/item-index";

const testType = { name: ["U8"], arguments: [] };

describe("intrinsic collector", () => {
  test("collects intrinsic functions, types, and parameters deterministically", () => {
    const catalog: IntrinsicCatalog = {
      modules: [
        {
          pathKey: "intrinsics/memory.wr",
          display: "intrinsics/memory.wr",
          declarations: [
            {
              kind: "function",
              intrinsicId: intrinsicId("intrinsics.memory.load"),
              name: "load",
              signature: {
                typeParameters: [],
                parameters: [{ name: "address", type: testType, isConsumed: false }],
                returnType: testType,
              },
              targetAvailability: { targets: ["test"] },
              proofContract: {
                requiredFacts: [],
                consumedCapabilities: [],
                producedCapabilities: [],
              },
              lowering: { backend: "test", operation: "load", attributes: {} },
            },
            {
              kind: "type",
              intrinsicId: intrinsicId("intrinsics.memory.Address"),
              name: "Address",
              signature: { typeParameters: [] },
              targetAvailability: { targets: ["test"] },
              proofContract: {
                requiredFacts: [],
                consumedCapabilities: [],
                producedCapabilities: [],
              },
              lowering: { backend: "test", operation: "type", attributes: {} },
            },
          ],
        },
      ],
    };

    const result = collectIntrinsicItems(catalog, { moduleIdOffset: 0, itemIdOffset: 0 });
    expect(result.items.map((item) => item.origin)).toEqual(["intrinsic", "intrinsic"]);
    expect(result.parameters[0]!.origin).toBe("intrinsic");
    expect(result.parameters[0]!).not.toHaveProperty("span");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/semantic/item-index/intrinsic-collector.test.ts
```

Expected: fails because intrinsic collector does not exist.

- [ ] **Step 3: Implement intrinsic collection**

Use this output shape:

```ts
export interface IntrinsicCollectionResult {
  readonly modules: readonly ModuleRecord[];
  readonly items: readonly IntrinsicItemRecord[];
  readonly types: readonly TypeRecord[];
  readonly functions: readonly FunctionRecord[];
  readonly parameters: readonly IntrinsicParameterRecord[];
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/semantic/item-index/intrinsic-collector.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/semantic/item-index/intrinsic-collector.ts src/semantic/item-index/index.ts tests/unit/semantic/item-index/intrinsic-collector.test.ts
git commit -m "feat: collect intrinsic item records -Codex Automated"
```

---

### Task 16: Duplicate Diagnostics

**Wave:** 4

**Dependencies:** Tasks 10, 11, and 12

**Description:** Implement item-index diagnostic codes, duplicate detection, synthetic intrinsic diagnostic source, and deterministic diagnostic sorting.

**Files:**

- Create: `src/semantic/item-index/diagnostics.ts`
- Create: `src/semantic/item-index/duplicate-checker.ts`
- Modify: `src/semantic/item-index/index.ts`
- Create: `tests/unit/semantic/item-index/duplicates.test.ts`

**Acceptance Criteria:**

- Exports all item-index diagnostic codes from the design.
- Duplicate source modules produce `ITEM_DUPLICATE_MODULE`.
- Source module shadowing an intrinsic module path produces `ITEM_SOURCE_MODULE_SHADOWS_INTRINSIC_MODULE`.
- Duplicate source declarations in one declaration scope produce `ITEM_DUPLICATE_DECLARATION`.
- Duplicate fields by owner item produce `ITEM_DUPLICATE_FIELD`.
- Duplicate parameters by function produce `ITEM_DUPLICATE_PARAMETER`.
- Duplicate type parameters by owner item/function produce `ITEM_DUPLICATE_TYPE_PARAMETER`.
- Duplicate enum cases by enum owner produce `ITEM_DUPLICATE_ENUM_CASE`.
- Duplicate intrinsic IDs produce `ITEM_DUPLICATE_INTRINSIC_ID`.
- Duplicate intrinsic declaration names in one intrinsic module produce `ITEM_DUPLICATE_INTRINSIC_DECLARATION`.
- Intrinsic diagnostics use `SourceText.from("<intrinsics>", "")` and zero-width span.
- Diagnostics sort by `source.name`, span start, span end, and code.

- [ ] **Step 1: Write failing duplicate tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { SourceSpan, SourceText } from "../../../../src/frontend";
import {
  fieldId,
  functionId,
  intrinsicId,
  itemId,
  moduleId,
  parameterId,
} from "../../../../src/semantic/ids";
import {
  checkItemIndexDuplicates,
  type IntrinsicItemRecord,
  type ItemIndexRecords,
  type SourceItemRecord,
} from "../../../../src/semantic/item-index";
import { intrinsicFunctionFake } from "../../../support/semantic/intrinsic-fakes";

const declaration = {} as SourceItemRecord["declaration"];
const source = SourceText.from("main.wr", "class Box:\nclass Box:\n");

function sourceItem(id: number, name: string, start: number): SourceItemRecord {
  return {
    id: itemId(id),
    origin: "source",
    kind: "class",
    moduleId: moduleId(0),
    name,
    modifiers: [],
    nameSpan: SourceSpan.from(start, start + name.length),
    span: SourceSpan.from(start, start + name.length),
    declaration,
  };
}

describe("item-index duplicate diagnostics", () => {
  test("reports duplicate source declarations and parameters from records", () => {
    const records: ItemIndexRecords = {
      modules: [
        { id: moduleId(0), origin: "source", pathKey: "main.wr", display: "main.wr", source },
      ],
      items: [sourceItem(0, "Box", 6), sourceItem(1, "Box", 17)],
      types: [],
      functions: [
        {
          id: functionId(0),
          itemId: itemId(0),
          moduleId: moduleId(0),
          name: "run",
          parameterIds: [parameterId(0), parameterId(1)],
        },
      ],
      images: [],
      fields: [],
      parameters: [
        {
          id: parameterId(0),
          functionId: functionId(0),
          origin: "source",
          index: 0,
          name: "x",
          isConsumed: false,
          nameSpan: SourceSpan.from(30, 31),
          span: SourceSpan.from(30, 36),
        },
        {
          id: parameterId(1),
          functionId: functionId(0),
          origin: "source",
          index: 1,
          name: "x",
          isConsumed: false,
          nameSpan: SourceSpan.from(38, 39),
          span: SourceSpan.from(38, 44),
        },
      ],
    };

    const diagnostics = checkItemIndexDuplicates(records);

    expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
      "ITEM_DUPLICATE_DECLARATION",
      "ITEM_DUPLICATE_PARAMETER",
    ]);
  });

  test("reports intrinsic duplicates on synthetic source", () => {
    const first = intrinsicFunctionFake("first", intrinsicId("intrinsics.dup"));
    const second = intrinsicFunctionFake("second", intrinsicId("intrinsics.dup"));
    const intrinsicItem = (id: number, spec: typeof first): IntrinsicItemRecord => ({
      id: itemId(id),
      origin: "intrinsic",
      kind: "intrinsicFunction",
      moduleId: moduleId(0),
      name: spec.name,
      intrinsicId: spec.intrinsicId,
      signature: spec.signature,
      targetAvailability: spec.targetAvailability,
      proofContract: spec.proofContract,
      lowering: spec.lowering,
      functionId: functionId(id),
    });
    const records: ItemIndexRecords = {
      modules: [
        {
          id: moduleId(0),
          origin: "intrinsic",
          pathKey: "intrinsics/test.wr",
          display: "intrinsics/test.wr",
        },
      ],
      items: [intrinsicItem(0, first), intrinsicItem(1, second)],
      types: [],
      functions: [],
      images: [],
      fields: [],
      parameters: [],
    };

    const diagnostics = checkItemIndexDuplicates(records);
    expect(diagnostics[0]!.code).toBe("ITEM_DUPLICATE_INTRINSIC_ID");
    expect(diagnostics[0]!.source.name).toBe("<intrinsics>");
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/semantic/item-index/duplicates.test.ts
```

Expected: fails because duplicate diagnostics do not exist.

- [ ] **Step 3: Implement duplicate checker**

Use this grouping pattern:

```ts
function reportDuplicatesByKey<T>(
  records: readonly T[],
  keyOf: (record: T) => string,
  report: (record: T) => void,
): void {
  const firstByKey = new Map<string, T>();
  for (const record of records) {
    const key = keyOf(record);
    if (firstByKey.has(key)) {
      report(record);
    } else {
      firstByKey.set(key, record);
    }
  }
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/semantic/item-index/duplicates.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/semantic/item-index/diagnostics.ts src/semantic/item-index/duplicate-checker.ts src/semantic/item-index/index.ts tests/unit/semantic/item-index/duplicates.test.ts
git commit -m "feat: add item index duplicate diagnostics -Codex Automated"
```

---

### Task 17: BuildItemIndex Composition

**Wave:** 5

**Dependencies:** Tasks 13, 14, 15, and 16

**Description:** Implement `buildItemIndex(input)` by composing source collection, intrinsic collection, duplicate diagnostics, and immutable `ItemIndex` construction.

**Files:**

- Create: `src/semantic/item-index/item-index-builder.ts`
- Modify: `src/semantic/item-index/index.ts`
- Create: `tests/unit/semantic/item-index/item-index-builder.test.ts`

**Acceptance Criteria:**

- `buildItemIndex({ graph })` returns an `ItemIndex` plus only item-index diagnostics.
- `buildItemIndex({ graph, intrinsics })` merges source and intrinsic records into one dense item space.
- Source module IDs are assigned before intrinsic module IDs.
- Source item IDs are assigned before intrinsic item IDs.
- Field and parameter IDs remain dense across source and intrinsic records.
- Parser diagnostics are not copied into `BuildItemIndexResult.diagnostics`.
- Returned index is valid even when diagnostics are present.

- [ ] **Step 1: Write failing builder tests**

Use this test shape:

```ts
import { describe, expect, test } from "bun:test";
import { buildItemIndex, intrinsicId, type IntrinsicCatalog } from "../../../../src/semantic";
import { parseSingleModuleGraphForTest } from "../../../support/frontend/module-graph-test-support";
import { intrinsicFunctionFake } from "../../../support/semantic/intrinsic-fakes";

describe("buildItemIndex", () => {
  test("builds source and intrinsic records in one item space", () => {
    const graph = parseSingleModuleGraphForTest(
      "main.wr",
      "class Packet:\nfn parse(packet: Packet)\n",
    );
    const intrinsics: IntrinsicCatalog = {
      modules: [
        {
          pathKey: "intrinsics/test.wr",
          display: "intrinsics/test.wr",
          declarations: [intrinsicFunctionFake("load", intrinsicId("intrinsics.test.load"))],
        },
      ],
    };

    const result = buildItemIndex({ graph, intrinsics });

    expect(result.diagnostics).toEqual([]);
    expect(result.index.modules().map((module) => module.origin)).toEqual(["source", "intrinsic"]);
    expect(result.index.items().map((item) => item.origin)).toEqual([
      "source",
      "source",
      "intrinsic",
    ]);
    expect(result.index.functions()).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the failing test**

Run:

```bash
bun test ./tests/unit/semantic/item-index/item-index-builder.test.ts
```

Expected: fails because `buildItemIndex` does not exist.

- [ ] **Step 3: Implement builder composition**

Use this composition shape:

```ts
export function buildItemIndex(input: BuildItemIndexInput): BuildItemIndexResult {
  const source = collectSourceModulesAndTopLevelItems(input.graph.modules);
  const sourceWithMembers = collectSourceMembers(source);
  const intrinsic = collectIntrinsicItems(
    input.intrinsics ?? { modules: [] },
    offsetsFrom(sourceWithMembers),
  );
  const records = mergeRecords(sourceWithMembers, intrinsic);
  const diagnostics = checkItemIndexDuplicates(records);

  return { index: new ItemIndex(records), diagnostics };
}
```

- [ ] **Step 4: Verify and commit**

Run:

```bash
bun test ./tests/unit/semantic/item-index/item-index-builder.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/semantic/item-index/item-index-builder.ts src/semantic/item-index/index.ts tests/unit/semantic/item-index/item-index-builder.test.ts
git commit -m "feat: compose item index builder -Codex Automated"
```

---

### Task 18: Semantic Public API And Integration Tests

**Wave:** 5

**Dependencies:** Tasks 9 and 17

**Description:** Add the semantic barrel, top-level exports, integration tests over real multi-module parser output, and public API assertions.

**Files:**

- Create: `src/semantic/index.ts`
- Modify: `src/index.ts`
- Create: `tests/integration/semantic/item-index.test.ts`
- Create: `tests/integration/semantic/public-api.test.ts`

**Acceptance Criteria:**

- `buildItemIndex`, `ItemIndex`, ID constructors, record types, diagnostics, and intrinsic catalog types are importable from `src/semantic`.
- Top-level `src/index.ts` exports `semantic` namespace and direct semantic exports.
- Integration test parses a multi-module graph, builds an item index, and asserts deterministic module/item/function/type/field/parameter records.
- Integration test verifies item-index diagnostics can be concatenated with parser diagnostics and sorted by `source.name`, span start, span end, and code.
- Existing frontend public API tests still pass.

- [ ] **Step 1: Write failing semantic public API tests**

Use this test shape:

```ts
import { expect, test } from "bun:test";
import * as packageRoot from "../../../src";
import * as semantic from "../../../src/semantic";
import { buildItemIndex, itemId, moduleId } from "../../../src/semantic";

test("semantic namespace exports item-index API", () => {
  expect(semantic.buildItemIndex).toBeDefined();
  expect(semantic.ItemIndex).toBeDefined();
  expect(semantic.moduleId).toBeDefined();
  expect(buildItemIndex).toBeDefined();
  expect(moduleId(0)).toBe(0);
  expect(itemId(0)).toBe(0);
});

test("top-level package exports semantic namespace", () => {
  expect(packageRoot.semantic.buildItemIndex).toBeDefined();
});
```

- [ ] **Step 2: Write failing semantic integration test**

Use this assertion shape:

```ts
import { expect, test } from "bun:test";
import { buildItemIndex } from "../../../src/semantic";
import { parseModuleGraphForTest } from "../../support/frontend/module-graph-test-support";

test("builds deterministic item index from parsed module graph", () => {
  const graph = parseModuleGraphForTest([
    ["app/main.wr", "use Packet from app.packet\nfn main(packet: Packet)\n"],
    [
      "app/packet.wr",
      "validated buffer Packet:\n    params:\n        size: U16\n    layout:\n        data: U8 @ 0 len 4\n",
    ],
  ]);

  const result = buildItemIndex({ graph });

  expect(result.index.modules().map((module) => module.pathKey)).toEqual([
    "app/main.wr",
    "app/packet.wr",
  ]);
  expect(result.index.items().map((item) => item.name)).toEqual(["main", "Packet"]);
  expect(result.index.fields().map((field) => field.role)).toEqual([
    "validatedParam",
    "layoutField",
  ]);
});
```

- [ ] **Step 3: Run the failing integration tests**

Run:

```bash
bun test ./tests/integration/semantic/public-api.test.ts ./tests/integration/semantic/item-index.test.ts
```

Expected: fails because semantic exports do not exist.

- [ ] **Step 4: Implement semantic exports and integration helpers**

Use this top-level export shape:

```ts
export * from "./frontend";
export * from "./semantic";
export * as frontend from "./frontend";
export * as semantic from "./semantic";
export * as shared from "./shared";
```

- [ ] **Step 5: Verify and commit**

Run:

```bash
bun test ./tests/integration/semantic/public-api.test.ts ./tests/integration/semantic/item-index.test.ts
bun run typecheck
```

Expected: both commands pass.

Commit:

```bash
git add src/semantic/index.ts src/index.ts tests/integration/semantic/public-api.test.ts tests/integration/semantic/item-index.test.ts
git commit -m "feat: export semantic item index API -Codex Automated"
```

---

### Task 19: Determinism, Property Coverage, Formatting, And Handoff Verification

**Wave:** 6

**Dependencies:** Tasks 1-18

**Description:** Add final determinism/property coverage and run the full repository handoff checks.

**Files:**

- Modify: `tests/unit/semantic/item-index/item-index-builder.test.ts`
- Create: `tests/integration/semantic/item-index-determinism.test.ts`

**Acceptance Criteria:**

- Builder determinism is covered for source module input order variations.
- Builder determinism is covered for intrinsic module/declaration input order variations.
- Duplicate diagnostic determinism is covered.
- `fast-check` is imported only from test files.
- `bun run format` is run before handoff if formatting changed.
- `bun run agent:check` passes before work is handed back.

- [ ] **Step 1: Add deterministic source order tests**

Use this test shape:

```ts
import { expect, test } from "bun:test";
import { buildItemIndex } from "../../../src/semantic";
import {
  parseModuleGraphForTest,
  parseSingleModuleGraphForTest,
} from "../../support/frontend/module-graph-test-support";
import { intrinsicCatalogFake } from "../../support/semantic/intrinsic-fakes";

test("source module input order does not change item names or IDs", () => {
  const left = buildItemIndex({
    graph: parseModuleGraphForTest([
      ["b.wr", "fn b()\n"],
      ["a.wr", "fn a()\n"],
    ]),
  });
  const right = buildItemIndex({
    graph: parseModuleGraphForTest([
      ["a.wr", "fn a()\n"],
      ["b.wr", "fn b()\n"],
    ]),
  });

  expect(left.index.modules().map((module) => module.pathKey)).toEqual(
    right.index.modules().map((module) => module.pathKey),
  );
  expect(left.index.items().map((item) => [item.id, item.name])).toEqual(
    right.index.items().map((item) => [item.id, item.name]),
  );
});
```

- [ ] **Step 2: Add intrinsic order determinism tests**

Use this test shape:

```ts
test("intrinsic declaration input order does not change item order", () => {
  const left = buildItemIndex({
    graph: parseSingleModuleGraphForTest("main.wr", "fn main()\n"),
    intrinsics: intrinsicCatalogFake(["zeta", "alpha"]),
  });
  const right = buildItemIndex({
    graph: parseSingleModuleGraphForTest("main.wr", "fn main()\n"),
    intrinsics: intrinsicCatalogFake(["alpha", "zeta"]),
  });

  expect(left.index.items().map((item) => item.name)).toEqual(
    right.index.items().map((item) => item.name),
  );
});
```

- [ ] **Step 3: Run targeted determinism tests**

Run:

```bash
bun test ./tests/unit/semantic/item-index/item-index-builder.test.ts ./tests/integration/semantic/item-index-determinism.test.ts
```

Expected: pass.

- [ ] **Step 4: Run formatting and full handoff checks**

Run:

```bash
bun run format
bun run agent:check
```

Expected: both commands pass. `agent:check` must run `typecheck`, `format:check`, `lint`, `policy:check`, and all tests.

- [ ] **Step 5: Commit final verification coverage**

Commit:

```bash
git add tests/unit/semantic/item-index/item-index-builder.test.ts tests/integration/semantic/item-index-determinism.test.ts
git commit -m "test: add item index determinism coverage -Codex Automated"
```

---

## Final Handoff Checklist

Run these commands after all tasks are merged:

```bash
bun run format
bun run agent:check
git status --short
```

Expected:

```text
bun run agent:check exits 0
git status --short shows only intentional changes or is clean after commits
```

The implementation is complete when:

- AST views are importable from `src/frontend`.
- `buildItemIndex` is importable from `src/semantic` and top-level `src`.
- Source and intrinsic declarations share one deterministic item space.
- Source fields, image device fields, validated-buffer params/layout fields, source parameters, and intrinsic parameters receive stable IDs.
- Duplicate diagnostics are deterministic and use the shared diagnostic shape.
- `bun run agent:check` passes.
