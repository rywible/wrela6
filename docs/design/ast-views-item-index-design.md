# AST Views And Item Index Design

## Purpose

The AST views and item index are the first compiler layer after parsing. This
phase turns a parsed module graph into ergonomic typed views over the CST and a
deterministic catalog of declarations. It is the bridge between lossless syntax
and later semantic passes such as name resolution, type checking, image graph
checking, HIR lowering, and intrinsic lowering.

The parser remains the source of truth for source text. AST views wrap red CST
nodes; they do not copy source data or replace syntax trees. The item index
assigns stable IDs to modules, source declarations, intrinsic declarations,
functions, types, images, fields, and parameters. It also reports duplicate
declaration diagnostics that can be found without resolving references or
checking types.

In this document, "stable ID" means deterministic for the same parsed module
graph and selected intrinsic catalog. It does not mean persistent across source
edits or incremental rebuilds.

## Goals

- Add typed CST views for declarations, expressions, statements, patterns, and
  type syntax.
- Keep typed views as thin wrappers over `RedNode` and `RedToken`.
- Preserve parser recovery behavior: malformed syntax is navigable and view
  accessors return `undefined` or empty arrays instead of throwing.
- Add deterministic `ModuleId`, `ItemId`, `TypeId`, `FunctionId`, `ImageId`,
  `FieldId`, `ParameterId`, and `IntrinsicId` handles.
- Collect declarations across a full `ParsedModuleGraph`.
- Collect compiler-owned intrinsic declarations into the same `ItemId` space as
  source declarations.
- Mark intrinsic items with intrinsic IDs, target availability, proof contract
  metadata, and lowering contracts.
- Report deterministic duplicate declaration diagnostics.
- Keep filesystem access, package root selection, target selection, and module
  loading outside this phase.
- Keep runtime source dependency-free. Tests may use `fast-check`.

## Non-Goals

- This phase does not parse source files or discover imports.
- This phase does not resolve imports, qualified references, type names, member
  names, enum cases, or image devices.
- This phase does not typecheck signatures, evaluate expressions, or validate
  proof obligations.
- This phase does not decide whether intrinsic callers are trusted.
- This phase does not lower intrinsics, generate HIR, or build image reachability
  graphs.
- This phase does not promise edit-stable incremental IDs.

## Repository Shape

```text
src/
  frontend/
    ast/
      index.ts
      ast-view.ts
      syntax-query.ts
      declaration-views.ts
      expression-views.ts
      statement-views.ts
      pattern-views.ts
      type-views.ts

  semantic/
    index.ts
    ids.ts
    item-index/
      index.ts
      diagnostics.ts
      intrinsic-catalog.ts
      item-index.ts
      item-index-builder.ts
      item-records.ts

tests/
  unit/
    frontend/
      ast/
        declaration-views.test.ts
        expression-views.test.ts
        statement-views.test.ts
        type-views.test.ts
    semantic/
      ids.test.ts
      item-index/
        intrinsic-catalog.test.ts
        item-index-builder.test.ts
        duplicates.test.ts

  integration/
    semantic/
      item-index.test.ts
      public-api.test.ts
```

`src/frontend/ast` belongs under `frontend` because it is syntax-shaped. It may
depend on `frontend/syntax` and shared source/diagnostic types, but it must not
depend on `semantic`.

`src/semantic/item-index` may depend on `frontend/ast`,
`frontend/module-graph-parser`, and shared diagnostics. It must not depend on
filesystem APIs, package loading, target backends, HIR, MIR, or code generation.

## Public API

AST views are exported from `src/frontend/ast/index.ts` and re-exported from the
frontend barrel:

```ts
import {
  SourceFileView,
  DeclarationView,
  FunctionDeclarationView,
  TypeReferenceView,
} from "./src/frontend";
```

The item index is exported from `src/semantic/item-index/index.ts` and the
semantic barrel:

```ts
import { buildItemIndex } from "./src/semantic";

const result = buildItemIndex({
  graph: parsedModuleGraph,
  intrinsics: targetIntrinsicCatalog,
});

for (const diagnostic of result.diagnostics) {
  // Present diagnostics with lexer and parser diagnostics from the caller.
}
```

The phase returns a pure result:

```ts
export interface BuildItemIndexInput {
  readonly graph: ParsedModuleGraph;
  readonly intrinsics?: IntrinsicCatalog;
}

export interface BuildItemIndexResult {
  readonly index: ItemIndex;
  readonly diagnostics: readonly ItemIndexDiagnostic[];
}

export function buildItemIndex(input: BuildItemIndexInput): BuildItemIndexResult;
```

`buildItemIndex` does not combine lexer or parser diagnostics. Callers already
receive combined frontend diagnostics from the parser layer. This phase returns
only item-index diagnostics so diagnostic ownership remains clear.

## AST View Principles

AST views are value wrappers over red CST nodes. A view is valid when the wrapped
node has the expected `SyntaxKind`.

```ts
export abstract class AstView {
  readonly node: RedNode;

  protected constructor(node: RedNode);

  get kind(): SyntaxKind;
  get span(): SourceSpan;
  get source(): SourceText;
}
```

View constructors should be private or protected where possible. Public factory
methods narrow syntax safely:

```ts
export class FunctionDeclarationView extends AstView {
  static from(node: RedNode): FunctionDeclarationView | undefined;

  nameToken(): RedToken | undefined;
  nameText(): string | undefined;
  parameters(): ParameterView[];
  typeParameters(): TypeParameterView[];
  returnType(): TypeReferenceView | undefined;
  requiresSections(): RequiresSectionView[];
  body(): BlockView | undefined;
  modifiers(): FunctionModifier[];
}
```

`FunctionModifier` is a source-shaped string union:

```ts
export type FunctionModifier = "private" | "platform" | "terminal" | "predicate" | "constructor";
```

Accessors follow these rules:

- If a required token is missing, return `undefined` for token and text accessors.
- If a repeated child list is malformed or absent, return an empty array.
- If syntax contains recovery nodes, preserve navigation around them.
- Do not throw because of parse errors.
- Do not allocate copied source strings except for explicit `nameText()` and
  similar token text helpers.
- Do not cache global state inside views.

The red tree does not promise stable object identity for repeated navigation.
Views must therefore be treated as lightweight wrappers. Later passes compare
IDs, spans, module IDs, or syntax coordinates, not object identity.

## Syntax Query Helpers

The current red node API exposes `child(index)` and `children()`. AST views need
small reusable query helpers so every view does not hand-roll traversal.

```ts
export function childNode(node: RedNode, kind: SyntaxKind): RedNode | undefined;

export function childNodes(node: RedNode, kind: SyntaxKind): RedNode[];

export function childToken(node: RedNode, kind: SyntaxKind): RedToken | undefined;

export function childTokens(node: RedNode, kind: SyntaxKind): RedToken[];

export function descendants(node: RedNode, kind: SyntaxKind): RedNode[];

export function blockStatementList(block: RedNode): RedNode | undefined;

export function blockItems(block: RedNode): RedNode[];
```

`childNode`, `childNodes`, `childToken`, and `childTokens` inspect direct
children only. `descendants` is explicit because recursive traversal is more
expensive and can accidentally cross scope boundaries. Item-index collection
should prefer view-owned accessors over arbitrary descendant searches.

`blockStatementList` and `blockItems` encode the parser's consistent
`Block -> StatementList -> item` shape. View accessors that enumerate fields,
members, validated-buffer sections, device sections, requirements, or function
body items must use this one-block traversal. They must not use `descendants`
for member collection because nested blocks can contain same-kind nodes in a
different declaration or statement scope.

Token helpers must ignore missing tokens unless the caller explicitly asks for
them:

```ts
export function presentTokenText(token: RedToken | undefined): string | undefined;
```

`presentTokenText` returns `undefined` for `undefined` and for
`token.isMissing`.

## Declaration Views

The declaration view layer should cover every current declaration-shaped CST
node:

```text
SourceFileView
ImportDeclarationView
EnumDeclarationView
EnumCaseView
DataclassDeclarationView
ClassDeclarationView
EdgeClassDeclarationView
InterfaceDeclarationView
StreamDeclarationView
ValidatedBufferDeclarationView
ImageDeclarationView
FieldDeclarationView
LayoutFieldView
FunctionDeclarationView
ParameterView
TypeParameterView
```

`DeclarationView` is a union wrapper over source declaration nodes that can
produce item-index records:

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
```

Every named declaration view exposes:

```ts
export interface NamedDeclarationView {
  nameToken(): RedToken | undefined;
  nameText(): string | undefined;
  nameSpan(): SourceSpan | undefined;
}
```

`SourceFileView` exposes top-level imports and declarations separately:

```ts
export class SourceFileView extends AstView {
  static fromRoot(root: RedNode): SourceFileView | undefined;

  imports(): ImportDeclarationView[];
  declarations(): DeclarationView[];
}
```

Import views preserve import paths as import syntax, not type syntax:

```ts
export class ImportDeclarationView extends AstView {
  moduleName(): DottedModuleNameView | undefined;
  importedNames(): RedToken[];
}
```

Declaration views expose only source-shaped children. They do not decide whether
a child declaration is legal in that location. For example, the parser can
produce `FunctionDeclaration` nodes inside statement lists. The item index may
assign a `FunctionId` to such a node, and a later semantic pass may reject the
placement if the language forbids it.

Views for declarations that carry source modifiers expose those modifiers:

```ts
export type SourceItemModifier = "private" | "unique" | FunctionModifier;

export class ClassDeclarationView extends AstView implements NamedDeclarationView {
  modifiers(): readonly Extract<SourceItemModifier, "private">[];
}

export class EdgeClassDeclarationView extends AstView implements NamedDeclarationView {
  modifiers(): readonly Extract<SourceItemModifier, "unique">[];
}
```

### Type-Like Declarations

The following declarations create `TypeId` records:

```text
EnumDeclaration
DataclassDeclaration
ClassDeclaration
EdgeClassDeclaration
InterfaceDeclaration
StreamDeclaration
ValidatedBufferDeclaration
```

Most type-like views expose type parameters and declaration-local children:

```ts
export interface TypeDeclarationView extends NamedDeclarationView {
  typeParameters(): TypeParameterView[];
  enumCases(): EnumCaseView[];
  memberFunctions(): FunctionDeclarationView[];
  fields(): FieldDeclarationView[];
}
```

Not every type-like declaration has all child categories. Empty arrays are used
when a category does not apply.

`ValidatedBufferDeclarationView` is type-like because it creates a `TypeId`, but
its CST is sectioned and does not fit the common `TypeDeclarationView` shape. It
has dedicated accessors:

```ts
export class ValidatedBufferDeclarationView extends AstView implements NamedDeclarationView {
  paramsSections(): ParamsSectionView[];
  layoutSections(): LayoutSectionView[];
  deriveSections(): DeriveSectionView[];
  requireSections(): RequireSectionView[];

  paramFields(): FieldDeclarationView[];
  layoutFields(): LayoutFieldView[];
}

export class ParamsSectionView extends AstView {
  fields(): FieldDeclarationView[];
}

export class LayoutSectionView extends AstView {
  fields(): LayoutFieldView[];
}

export class DeriveSectionView extends AstView {
  fields(): DerivedFieldView[];
}

export class RequireSectionView extends AstView {
  requirements(): RequirementView[];
}
```

The section accessors return all direct sections in source order. The convenience
`paramFields()` and `layoutFields()` flatten direct fields from those sections in
section order so the item index can assign `FieldId`s without guessing which CST
path to walk.

### Image Declarations

`ImageDeclarationView` creates an `ImageId` and an `ItemId`.

Image bodies can contain fields, device fields, statements, and functions. The
view should expose fields in separate source-shaped groups:

```ts
export class ImageDeclarationView extends AstView implements NamedDeclarationView {
  fields(): FieldDeclarationView[];
  deviceFields(): FieldDeclarationView[];
  deviceSections(): DevicesSectionView[];
  memberFunctions(): FunctionDeclarationView[];
}

export class DevicesSectionView extends AstView {
  fields(): FieldDeclarationView[];
}
```

The item index records the field group so later image graph checks can
distinguish ordinary image fields from device bindings without re-walking syntax.
`fields()` returns `FieldDeclaration` nodes that are direct items of the image
body block. `deviceFields()` walks only direct `DevicesSection` items in that
same body block, then direct field items in each device section's block. It must
not collect fields from nested statement blocks.

### Function Declarations

`FunctionDeclarationView` creates a `FunctionId` and an `ItemId`.

It exposes:

```text
name
modifiers
type parameters
parameters
return type
requires section
body block
```

The item index records parameter IDs and type-parameter names, but it does not
validate parameter types or requires expressions.

`requiresSections()` returns both syntactic forms the parser can produce:

- direct `RequiresSection` children on a bodyless function
- `RequiresSection` items that are direct items of the function body's
  `StatementList`

Multiple requires sections are preserved in source order. The accessor does not
walk into nested control-flow blocks.

### Field-Like Views

`FieldDeclarationView` wraps ordinary `FieldDeclaration` nodes and is reused by
classes, dataclasses, images, image devices, and validated-buffer params.
`LayoutFieldView` wraps `LayoutField` nodes in validated-buffer layout sections.
The item index records the owning declaration and a source-shaped field role:

```ts
export type FieldRole = "field" | "imageDevice" | "validatedParam" | "layoutField";
```

Derived fields in validated-buffer `derive` sections are not ordinary field
declarations in the CST, and this phase does not assign field IDs to them. This
phase collects the currently parsed `FieldDeclaration` and `LayoutField` nodes.

Field-like views preserve the syntactic type and any field-local expressions:

```ts
export class FieldDeclarationView extends AstView implements NamedDeclarationView {
  type(): TypeReferenceView | undefined;
}

export class LayoutFieldView extends AstView implements NamedDeclarationView {
  type(): TypeReferenceView | undefined;
  offsetExpression(): ExpressionView | undefined;
  lengthExpression(): ExpressionView | undefined;
}

export class DerivedFieldView extends AstView implements NamedDeclarationView {
  type(): TypeReferenceView | undefined;
  sourceExpression(): ExpressionView | undefined;
  cases(): DeriveCaseView[];
}

export class DeriveCaseView extends AstView {
  conditionExpression(): ExpressionView | undefined;
  resultExpression(): ExpressionView | undefined;
}
```

## Expression, Statement, Pattern, And Type Views

This phase needs views beyond declarations because item records should preserve
source-shaped access to signatures, field types, layout offsets, requires
clauses, and function bodies. These views are intentionally shallow.

Expression views cover current expression syntax:

```text
LiteralExpressionView
NameExpressionView
MemberAccessExpressionView
CallExpressionView
TypeApplicationExpressionView
AttemptExpressionView
UnaryExpressionView
BinaryExpressionView
ComparisonExpressionView
EqualityExpressionView
ObjectLiteralExpressionView
ObjectFieldView
CallArgumentListView
ArgumentView
NamedArgumentView
ElseRequirementExpressionView
```

Statement views cover current statement syntax:

```text
LetStatementView
IfStatementView
ElseClauseView
WhileStatementView
ForStatementView
TakeStatementView
MatchStatementView
MatchCaseView
LoopStatementView
ReturnStatementView
YieldStatementView
ContinueStatementView
ExpressionStatementView
AssignmentStatementView
ConditionView
BlockView
StatementListView
```

Pattern views cover `Pattern` and `PatternList`.

Requirement views cover both function `requires` sections and validated-buffer
`require` sections:

```text
RequiresSectionView
RequireSectionView
RequirementView
```

`RequirementView.expression()` returns the direct requirement expression when it
is present. It does not evaluate the predicate and does not normalize
`ElseRequirementExpression` syntax.

Type and name views cover:

```text
DottedModuleNameView
QualifiedNameView
TypeReferenceView
TypeParameterListView
TypeParameterView
TypeArgumentListView
ReturnTypeClauseView
```

These views should expose child syntax and token text only. They do not resolve
names or normalize types. For example, `TypeReferenceView.qualifiedNameText()`
may return `"core.memory.Buffer"` as source text, but it must not map that name
to a `TypeId`.

## ID Model

IDs should be opaque branded numbers:

```ts
export type ModuleId = number & { readonly __brand: "ModuleId" };
export type ItemId = number & { readonly __brand: "ItemId" };
export type TypeId = number & { readonly __brand: "TypeId" };
export type FunctionId = number & { readonly __brand: "FunctionId" };
export type ImageId = number & { readonly __brand: "ImageId" };
export type FieldId = number & { readonly __brand: "FieldId" };
export type ParameterId = number & { readonly __brand: "ParameterId" };
export type IntrinsicId = string & { readonly __brand: "IntrinsicId" };
```

The implementation should expose constructors instead of type casts at call
sites:

```ts
export function moduleId(value: number): ModuleId;
export function itemId(value: number): ItemId;
export function typeId(value: number): TypeId;
export function functionId(value: number): FunctionId;
export function imageId(value: number): ImageId;
export function fieldId(value: number): FieldId;
export function parameterId(value: number): ParameterId;
export function intrinsicId(value: string): IntrinsicId;
```

The numeric IDs are dense and zero-based inside one `ItemIndex`. They are
assigned deterministically by the builder. Code outside `semantic/ids.ts` should
not depend on numeric ordering except for stable sorting in tests and diagnostic
presentation.

`IntrinsicId` is a stable string because it names a compiler-owned semantic
operation across targets and lowering layers. Example intrinsic IDs:

```text
intrinsics.memory.volatile_load
intrinsics.memory.volatile_store
intrinsics.arithmetic.checked_add
intrinsics.aarch64.dmb
intrinsics.uefi.call_firmware
intrinsics.image.entry_capability
```

`intrinsicId(value)` rejects empty strings and strings with leading or trailing
whitespace.

## Item Index Records

The item index is a read-only value object built in one pass.

```ts
export class ItemIndex {
  modules(): readonly ModuleRecord[];
  items(): readonly ItemRecord[];
  types(): readonly TypeRecord[];
  functions(): readonly FunctionRecord[];
  images(): readonly ImageRecord[];
  fields(): readonly FieldRecord[];
  parameters(): readonly ParameterRecord[];

  module(id: ModuleId): ModuleRecord | undefined;
  item(id: ItemId): ItemRecord | undefined;
  type(id: TypeId): TypeRecord | undefined;
  function(id: FunctionId): FunctionRecord | undefined;
  image(id: ImageId): ImageRecord | undefined;
  field(id: FieldId): FieldRecord | undefined;
  parameter(id: ParameterId): ParameterRecord | undefined;

  moduleByPath(pathKey: string, origin: ModuleOrigin): ModuleRecord | undefined;
  itemsInModule(moduleId: ModuleId): readonly ItemRecord[];
}
```

`ItemIndex` arrays are returned as immutable copies or readonly arrays. The
builder can use mutable arrays internally, but callers should not be able to
mutate index contents.

### Module Records

```ts
export type ModuleOrigin = "source" | "intrinsic";

export interface ModuleRecord {
  readonly id: ModuleId;
  readonly origin: ModuleOrigin;
  readonly pathKey: string;
  readonly display: string;
  readonly source?: SourceText;
}
```

Source modules use `ParsedModule.path.key`. Intrinsic modules use the module
path key exposed by the intrinsic catalog, such as `intrinsics/memory.wr`.

If a source module has the same path key as an intrinsic module, the builder
reports `ITEM_SOURCE_MODULE_SHADOWS_INTRINSIC_MODULE`. Both records may still be
created so diagnostics and later recovery can proceed. Callers must pass an
explicit `ModuleOrigin` to `moduleByPath`, so name resolution cannot silently
choose between a source module and an intrinsic module with the same path.

### Item Records

```ts
export type ItemOrigin = "source" | "intrinsic";

export type SourceItemKind =
  | "enum"
  | "enumCase"
  | "dataclass"
  | "class"
  | "edgeClass"
  | "interface"
  | "stream"
  | "validatedBuffer"
  | "image"
  | "function";

export type IntrinsicItemKind = "intrinsicFunction" | "intrinsicType";

export type ItemKind = SourceItemKind | IntrinsicItemKind;
```

Source items preserve their AST view:

```ts
export interface SourceItemRecord {
  readonly id: ItemId;
  readonly origin: "source";
  readonly kind: SourceItemKind;
  readonly moduleId: ModuleId;
  readonly parentItemId?: ItemId;
  readonly name: string;
  readonly modifiers: readonly SourceItemModifier[];
  readonly nameSpan: SourceSpan;
  readonly span: SourceSpan;
  readonly declaration: DeclarationView;
  readonly typeId?: TypeId;
  readonly functionId?: FunctionId;
  readonly imageId?: ImageId;
}
```

Intrinsic items preserve their intrinsic contract:

```ts
export interface IntrinsicItemRecord {
  readonly id: ItemId;
  readonly origin: "intrinsic";
  readonly kind: IntrinsicItemKind;
  readonly moduleId: ModuleId;
  readonly name: string;
  readonly intrinsicId: IntrinsicId;
  readonly signature: IntrinsicSignature;
  readonly targetAvailability: IntrinsicTargetAvailability;
  readonly proofContract: IntrinsicProofContract;
  readonly lowering: IntrinsicLoweringContract;
  readonly typeId?: TypeId;
  readonly functionId?: FunctionId;
}

export type ItemRecord = SourceItemRecord | IntrinsicItemRecord;
```

Source records omit malformed declarations that do not have a present name
token. Parser diagnostics already explain the missing name. This keeps item IDs
stable and avoids creating empty-name symbols that would pollute duplicate
diagnostics.

`modifiers` is empty for declarations whose grammar does not support source
modifiers.

### Type, Function, Image, Field, And Parameter Records

Type records point back to item records:

```ts
export interface TypeRecord {
  readonly id: TypeId;
  readonly itemId: ItemId;
  readonly moduleId: ModuleId;
  readonly name: string;
}
```

Function records include both source and intrinsic functions:

```ts
export interface FunctionRecord {
  readonly id: FunctionId;
  readonly itemId: ItemId;
  readonly moduleId: ModuleId;
  readonly parentItemId?: ItemId;
  readonly name: string;
  readonly parameterIds: readonly ParameterId[];
  readonly intrinsicId?: IntrinsicId;
}
```

Image records are source-only in this phase:

```ts
export interface ImageRecord {
  readonly id: ImageId;
  readonly itemId: ItemId;
  readonly moduleId: ModuleId;
  readonly name: string;
  readonly fieldIds: readonly FieldId[];
  readonly deviceFieldIds: readonly FieldId[];
}
```

Field records are scoped to an owning item:

```ts
export interface FieldRecord {
  readonly id: FieldId;
  readonly ownerItemId: ItemId;
  readonly role: FieldRole;
  readonly name: string;
  readonly nameSpan: SourceSpan;
  readonly span: SourceSpan;
  readonly type?: TypeReferenceView;
}
```

Parameter records are scoped to a function:

```ts
export type ParameterOrigin = "source" | "intrinsic";

export interface BaseParameterRecord {
  readonly id: ParameterId;
  readonly functionId: FunctionId;
  readonly origin: ParameterOrigin;
  readonly index: number;
  readonly name: string;
  readonly isConsumed: boolean;
}

export interface SourceParameterRecord extends BaseParameterRecord {
  readonly origin: "source";
  readonly nameSpan: SourceSpan;
  readonly span: SourceSpan;
  readonly type?: TypeReferenceView;
}

export interface IntrinsicParameterRecord extends BaseParameterRecord {
  readonly origin: "intrinsic";
  readonly type: IntrinsicTypeReferenceSpec;
}

export type ParameterRecord = SourceParameterRecord | IntrinsicParameterRecord;
```

The item index records syntactic type views for source fields and source
parameters, and structured intrinsic type references for intrinsic parameters.
It does not validate whether the types exist.

## Intrinsic Catalog

Intrinsic declarations are compiler-owned declarations selected by the target
before semantic analysis. They are not loaded from source files and they are not
allowed to receive hidden semantic privileges beyond their explicit contracts.

The item-index layer receives an intrinsic catalog:

```ts
export interface IntrinsicCatalog {
  readonly modules: readonly IntrinsicModuleSpec[];
}

export interface IntrinsicModuleSpec {
  readonly pathKey: string;
  readonly display: string;
  readonly declarations: readonly IntrinsicDeclarationSpec[];
}

export type IntrinsicDeclarationSpec =
  | IntrinsicFunctionDeclarationSpec
  | IntrinsicTypeDeclarationSpec;
```

Intrinsic function specs:

```ts
export interface IntrinsicFunctionDeclarationSpec {
  readonly kind: "function";
  readonly intrinsicId: IntrinsicId;
  readonly name: string;
  readonly signature: IntrinsicFunctionSignature;
  readonly targetAvailability: IntrinsicTargetAvailability;
  readonly proofContract: IntrinsicProofContract;
  readonly lowering: IntrinsicLoweringContract;
}
```

Intrinsic type specs:

```ts
export interface IntrinsicTypeDeclarationSpec {
  readonly kind: "type";
  readonly intrinsicId: IntrinsicId;
  readonly name: string;
  readonly signature: IntrinsicTypeSignature;
  readonly targetAvailability: IntrinsicTargetAvailability;
  readonly proofContract: IntrinsicProofContract;
  readonly lowering: IntrinsicLoweringContract;
}
```

`IntrinsicSignature` uses structured type references instead of source strings:

```ts
export type IntrinsicSignature = IntrinsicFunctionSignature | IntrinsicTypeSignature;

export interface IntrinsicFunctionSignature {
  readonly typeParameters: readonly IntrinsicTypeParameterSpec[];
  readonly parameters: readonly IntrinsicParameterSpec[];
  readonly returnType?: IntrinsicTypeReferenceSpec;
}

export interface IntrinsicTypeSignature {
  readonly typeParameters: readonly IntrinsicTypeParameterSpec[];
}

export interface IntrinsicTypeParameterSpec {
  readonly name: string;
  readonly bound?: IntrinsicTypeReferenceSpec;
}

export interface IntrinsicParameterSpec {
  readonly name: string;
  readonly type: IntrinsicTypeReferenceSpec;
  readonly isConsumed: boolean;
}

export interface IntrinsicTypeReferenceSpec {
  readonly name: readonly string[];
  readonly arguments: readonly IntrinsicTypeReferenceSpec[];
}
```

The item-index builder does not interpret proof or lowering contracts. It stores
them with intrinsic item records so later passes have one authoritative lookup.

```ts
export interface IntrinsicTargetAvailability {
  readonly targets: readonly string[];
}

export interface IntrinsicProofContract {
  readonly requiredFacts: readonly string[];
  readonly consumedCapabilities: readonly string[];
  readonly producedCapabilities: readonly string[];
}

export interface IntrinsicLoweringContract {
  readonly backend: string;
  readonly operation: string;
  readonly attributes: Readonly<Record<string, string>>;
}
```

The builder treats the proof and lowering strings as opaque, deterministically
stored metadata. Proof and lowering layers define their own validation rules
when they consume those records.

## Deterministic ID Assignment

The builder assigns IDs in a deterministic order:

1. Sort source modules by `path.key`, then `source.name`, then `source.text`.
2. Sort intrinsic modules by `pathKey`, then `display`, then a stable
   serialization of their declarations.
3. Assign source `ModuleId`s first, then intrinsic `ModuleId`s.
4. For each source module in sorted order, collect source items in source order.
5. For each intrinsic module in sorted order, collect intrinsic declarations
   sorted by `intrinsicId`, then declaration name, then declaration kind, then a
   stable serialization of the signature.
6. Assign `ItemId`s in collection order.
7. Assign `TypeId`, `FunctionId`, and `ImageId` when an item is created.
8. Assign `FieldId`s and `ParameterId`s in owner source order.

Source order means the order produced by direct CST child traversal, not object
identity and not map iteration order.

This assignment gives deterministic IDs even if a test constructs
`ParsedModuleGraph.modules` in a different order from the lexer traversal.
When duplicate records tie on every stable source or intrinsic field, the
records are indistinguishable for deterministic purposes and tests must not
assert an identity difference between those tied records.

## Source Declaration Collection

Collection starts from each module's `SourceFileView`.

Top-level declaration collection:

```text
SourceFileView.declarations()
  -> create one ItemRecord per well-named declaration
  -> create TypeId, FunctionId, or ImageId as appropriate
  -> collect declaration-local fields, parameters, and member functions
```

Declaration-local collection is recursive:

- Type-like declarations collect type parameters, fields, enum cases, and member
  functions exposed by their views.
- Image declarations collect fields, device fields, and member functions.
- Validated buffers collect params-section fields and layout-section fields.
- Function declarations collect type parameters, parameters, and requires
  sections.
- Member functions exposed as direct declaration-body items receive a
  `parentItemId`.
- Function declarations found anywhere inside another function body's statement
  tree receive a `parentItemId` for the nearest enclosing function item. The item
  index does not create lexical block IDs; duplicate diagnostics for these
  recovery/local functions are scoped to that nearest enclosing function item
  until a later local-function design introduces block scopes.
- Function declarations nested under control-flow blocks inside non-function
  declaration bodies are not member functions. Later statement validation can
  reject those placements through statement views without treating them as
  declaration-local members.

Enum cases are declaration-local symbols. They are recorded as source item
records with `kind: "enumCase"` and `parentItemId` set to the owning enum item.
They do not receive `TypeId`, `FunctionId`, or `ImageId` records.

## Duplicate Diagnostics

Duplicate checking is deterministic and scope-based. The builder reports
duplicates after collecting the relevant scope so diagnostics can be sorted by
source span and code.

Diagnostic codes live in `src/semantic/item-index/diagnostics.ts`:

```ts
export type ItemIndexDiagnosticCode =
  | "ITEM_DUPLICATE_MODULE"
  | "ITEM_SOURCE_MODULE_SHADOWS_INTRINSIC_MODULE"
  | "ITEM_DUPLICATE_DECLARATION"
  | "ITEM_DUPLICATE_FIELD"
  | "ITEM_DUPLICATE_PARAMETER"
  | "ITEM_DUPLICATE_TYPE_PARAMETER"
  | "ITEM_DUPLICATE_ENUM_CASE"
  | "ITEM_DUPLICATE_INTRINSIC_ID"
  | "ITEM_DUPLICATE_INTRINSIC_DECLARATION";
```

All item-index diagnostics use the shared diagnostic shape:

```ts
export interface ItemIndexDiagnostic extends Diagnostic<ItemIndexDiagnosticCode> {}
```

Source duplicate diagnostics point at the duplicate declaration's name span.
Messages name both the duplicate and the scope:

```text
Duplicate declaration 'Packet' in module app/main.wr.
Duplicate field 'rx' in class NetworkPaths.
Duplicate parameter 'buffer' in function drop_rx.
```

If useful, messages may mention the first declaration's position. The diagnostic
span remains on the duplicate name.

Intrinsic duplicate diagnostics do not have source text. The implementation
should create a synthetic `SourceText` for intrinsic catalog diagnostics:

```text
<intrinsics>
```

The span may be zero-width at the start of that synthetic source. This keeps all
diagnostics in the shared substrate without adding a second diagnostic shape.

Duplicate rules:

- Two source modules with the same `path.key` produce `ITEM_DUPLICATE_MODULE`.
- A source module whose `path.key` equals an intrinsic module `pathKey` produces
  `ITEM_SOURCE_MODULE_SHADOWS_INTRINSIC_MODULE`.
- Two source items with the same name in the same declaration scope produce
  `ITEM_DUPLICATE_DECLARATION`.
- Two fields with the same name and owner item produce `ITEM_DUPLICATE_FIELD`.
- Two parameters with the same name and function produce
  `ITEM_DUPLICATE_PARAMETER`.
- Two type parameters with the same name and owner item or function produce
  `ITEM_DUPLICATE_TYPE_PARAMETER`.
- Two enum cases with the same name and enum owner produce
  `ITEM_DUPLICATE_ENUM_CASE`.
- Two intrinsic declarations with the same `intrinsicId` produce
  `ITEM_DUPLICATE_INTRINSIC_ID`.
- Two intrinsic declarations with the same module path and declaration name
  produce `ITEM_DUPLICATE_INTRINSIC_DECLARATION`.

Missing names do not participate in duplicate checking.

When a compiler driver merges lexer, parser, and item-index diagnostics, it
sorts by `source.name`, then span start, span end, and diagnostic code. This
gives intrinsic diagnostics from the synthetic `<intrinsics>` source a stable
position relative to real source files.

## Error Handling And Recovery

This phase must be total over parser output. It should return an `ItemIndex`
even when the parsed graph contains syntax errors.

Rules:

- Do not throw for malformed source syntax.
- Skip unnamed source declarations, fields, parameters, and type parameters.
- Preserve records for well-named declarations even if their body or signature is
  malformed.
- Keep intrinsic catalog validation in diagnostics when possible.
- Bounds-check ID lookups and return `undefined` for unknown numeric IDs.
- Throw only for programmer errors that violate TypeScript-level invariants that
  can actually be detected at runtime.

Opaque branded numeric IDs do not carry an index identity. This design does not
attempt to detect an `ItemId` from another `ItemIndex`.

The item index should not suppress parser diagnostics. A compiler driver should
present lexer, parser, and item-index diagnostics together after sorting.

## Dependency Injection And Fakes

The main builder is a pure function over `ParsedModuleGraph` and
`IntrinsicCatalog`. It does not need injected filesystem or target services.

Tests should use real lexer/parser output for integration coverage and small
fakes for intrinsic catalogs. Do not use mocks. Intrinsic fakes should be plain
objects that satisfy `IntrinsicCatalog`.

## Testing Strategy

Unit tests for AST views:

- `SourceFileView` returns imports and top-level declarations in source order.
- Named declaration views return `undefined` for missing names.
- Function views expose modifiers, type parameters, parameters, return type,
  body, and `requires` sections in both bodyless and block-body forms without
  resolving names.
- Validated-buffer views expose params, layout, derive, and require sections.
- Image views keep ordinary fields separate from device fields when both appear
  in nested blocks.
- Type views expose qualified name segments and type arguments.
- Statement and expression views wrap current `SyntaxKind` nodes without
  throwing on recovery nodes.

Unit tests for IDs:

- Branded constructor helpers return dense numeric IDs.
- `IntrinsicId` rejects empty strings.
- ID values are stable for the same builder input.

Unit tests for item indexing:

- Source modules are sorted by `ModulePath.key` before module IDs are assigned.
- Top-level declarations receive `ItemId`s in source order within sorted
  modules.
- Duplicate module and intrinsic declaration inputs use stable secondary
  tie-breaks for ID assignment.
- Type-like declarations receive `TypeId`s.
- Function declarations receive `FunctionId`s and parameter IDs.
- Intrinsic function parameters receive intrinsic `ParameterRecord`s without
  source spans.
- Image declarations receive `ImageId`s, field IDs, and device field IDs.
- Validated buffers receive `TypeId`s plus field IDs for params-section fields
  and layout-section fields.
- Intrinsic declarations receive `ItemId`s in the same item array as source
  items.
- Intrinsic functions receive `FunctionId`s and preserve intrinsic IDs.
- Source item records preserve source modifiers such as `private` and `unique`.
- Malformed declarations without names are skipped and do not throw.

Duplicate diagnostics tests:

- Duplicate module path.
- Source module shadowing intrinsic module path.
- Duplicate top-level declarations.
- Duplicate fields in a class or image.
- Duplicate parameters in a function.
- Duplicate type parameters.
- Duplicate enum cases.
- Duplicate intrinsic IDs.
- Duplicate intrinsic declaration names in one intrinsic module.

Integration tests:

- Parse a multi-module graph, build an item index, and assert deterministic IDs
  and records.
- Build an item index for source modules plus an intrinsic catalog and assert
  source and intrinsic records share the same item space.
- Verify item-index diagnostics can be concatenated with parser diagnostics and
  sorted by source position.

Property tests may generate small module graphs with declaration names to check
ID determinism and duplicate diagnostic determinism. `fast-check` stays in
tests only.

## Implementation Milestones

1. Add `src/frontend/ast` with syntax query helpers and declaration, section,
   and type views.
2. Add expression, statement, pattern, requirement, and name views for current
   `SyntaxKind` coverage.
3. Add `src/semantic/ids.ts` and item-index record types.
4. Add intrinsic catalog types and small test catalogs.
5. Implement source module sorting and `ModuleRecord` creation.
6. Implement source declaration collection and ID assignment.
7. Implement field, parameter, type-parameter, and enum-case collection.
8. Implement intrinsic module and declaration collection.
9. Implement duplicate diagnostics.
10. Export public API from frontend and semantic barrels.
11. Add unit, integration, and property tests.

Each milestone should keep `bun run agent:check` passing before handoff.

## Expected Output

For a successful build, this phase outputs:

- stable module IDs for all source and intrinsic modules
- stable item IDs for source declarations and intrinsic declarations
- stable type IDs for source type declarations and intrinsic type declarations
- stable function IDs for source and intrinsic function declarations
- stable image IDs for source image declarations
- stable field IDs for source fields, image devices, validated-buffer params,
  and layout fields
- stable parameter IDs for source and intrinsic function parameters
- intrinsic item records marked with intrinsic IDs, proof contracts, target
  availability, and lowering contracts
- deterministic duplicate declaration diagnostics

Later phases consume this output instead of re-scanning raw CST for declaration
identity.
