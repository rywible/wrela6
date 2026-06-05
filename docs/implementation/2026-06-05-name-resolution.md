# Name Resolution Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the name-resolution phase from `docs/design/name-resolution-design.md`, including the source-only item-index refactor required by the new `platform fn` model.

**Architecture:** Name resolution lives under `src/semantic/names`. It consumes `ParsedModuleGraph`, `ItemIndex`, `CoreTypeCatalog`, and a names-only `PlatformPrimitiveNameCatalog`, then returns resolved CST/HIR-facing references, platform primitive bindings, and deterministic diagnostics. The standard library is just loaded source at ordinary module paths. Target primitives are not modules or ambient names; source reaches them through freestanding `platform fn` declarations whose simple names match selected-target primitive names. Certification of platform signatures, proof contracts, `Attempt`, validation, `take`, terminal closure, and resource convergence remains owned by later HIR/Proof MIR phases.

**Tech Stack:** TypeScript, Bun test runner, existing frontend AST views and semantic item index, no runtime dependencies, `fast-check` only in tests.

---

## Research Notes

- `ParsedModuleGraph.modules` preserves graph traversal order. Name resolution must use `ItemIndex.modules()` order for stable traversal.
- The current item index still has intrinsic-origin modules/items/parameters and `IntrinsicId`. Those must be removed before name resolution can treat project source and vendored stdlib source uniformly.
- The current frontend module resolver maps `std.io` to `std/io.wr` by replacing dots with slashes and appending `.wr`. Name resolution should reuse that mapping convention when matching dotted syntax against already-loaded modules.
- `ImportDeclarationView.importedNames()` currently needs correction or an adapter because imported names are under `ImportNameList`; direct children of `ImportDeclaration` include the module-name node separately.
- Pattern and some statement views are intentionally thin. Name resolution needs a small AST support task for import name lists, `let` annotations/initializers, `for` iterables, `take` expressions/bodies, inline `else` statements, and pattern qualified names.
- Core builtins are type-position names only: `bool`, `u8`, `u16`, `u32`, `u64`, `usize`, and `Never`.
- Source-visible platform-related types such as `Address` are not core builtins in this design. They resolve as ordinary source declarations from vendored stdlib or project modules.
- Platform primitive names are simple identifiers, not dotted paths. Use names like `volatile_load_u32` or `aarch64_dmb_ish`.
- `platform fn` declarations are untrusted source handles. Name resolution may bind a freestanding source `FunctionId` to a selected `PlatformPrimitiveId`; later certification must prove exact source/catalog signature and proof-contract compatibility before HIR or Proof MIR can use the primitive contract.
- In v1, target-bound platform declarations are freestanding only. A method or local function may wrap a freestanding `platform fn`, but a method-shaped or local `platform fn` must receive a deterministic semantic diagnostic and no primitive binding.
- Proof constructs are not looked up by magic names. Name resolution only resolves ordinary names inside `Attempt` expressions, requirements, validated-buffer declarations, `take` bodies, terminal calls, and predicate calls.
- Let-local bindings are not assigned IDs in this phase. Do not emit unresolved-name diagnostics for ordinary non-callee value names that may be locals; HIR-facing local scope construction owns those bindings.
- Commands in this environment need Bun on PATH:

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/core-types.test.ts
PATH="/Users/ryanwible/.bun/bin:$PATH" bun run agent:check
```

## Parallel Execution Model

Use these waves to avoid merge conflicts. Tasks in the same wave can run in parallel when their listed dependencies are satisfied.

```text
Wave 0:
  Task 1: Semantic ID refactor
  Task 5: AST accessor support
  Task 8: Name diagnostic model

Wave 1:
  Task 2 after Task 1
  Task 6 after Task 1
  Task 7 after Task 1
  Task 9 after Tasks 1 and 8

Wave 2:
  Task 3 after Task 2
  Task 10 after Task 2
  Task 11 after Tasks 2, 6, and 9
  Task 13 after Tasks 2 and 9

Wave 3:
  Task 4 after Tasks 3 and 7
  Task 12 after Tasks 5, 8, 9, 10, and 11
  Task 14 after Tasks 3, 7, and 8
  Task 15 after Tasks 5, 6, 9, 10, and 11

Wave 4:
  Task 16 after Tasks 5, 9, 11, 12, 13, and 15

Wave 5:
  Task 17 after Tasks 12, 14, 15, and 16

Wave 6:
  Task 18 after all prior tasks
```

Single-writer coordination:

- `src/semantic/ids.ts` is owned by Task 1.
- `src/semantic/item-index/*` is owned by Tasks 2 through 4 until Task 4 completes.
- `src/frontend/ast/*` is owned by Task 5.
- `src/semantic/names/index.ts`, `src/semantic/index.ts`, and public API tests are owned by Task 18.
- Before Task 18, tests should import new name-resolution files by direct path, not from the semantic barrel.

## Target File Structure

```text
src/semantic/
  ids.ts
  index.ts
  item-index/
    diagnostics.ts
    duplicate-checker.ts
    item-index.ts
    item-index-builder.ts
    item-records.ts
    source-member-collector.ts
    source-module-collector.ts
    index.ts
  names/
    core-types.ts
    diagnostics.ts
    import-resolver.ts
    index.ts
    member-namespace.ts
    module-namespace.ts
    name-resolver.ts
    platform-binding.ts
    platform-primitives.ts
    reference.ts
    reference-key.ts
    resolution-result.ts
    scope.ts
    type-reference-resolver.ts
    expression-resolver.ts

tests/support/semantic/
  name-resolution-fakes.ts

tests/unit/semantic/names/
  core-types.test.ts
  diagnostics.test.ts
  import-resolver.test.ts
  member-namespace.test.ts
  module-namespace.test.ts
  platform-binding.test.ts
  platform-primitives.test.ts
  reference-key.test.ts
  resolved-references.test.ts
  scope.test.ts
  type-reference-resolver.test.ts
  expression-resolver.test.ts

tests/integration/semantic/
  name-resolution.test.ts
  name-resolution-determinism.test.ts
  public-api.test.ts
```

## Shared Implementation Rules

- Keep runtime source dependency-free.
- Use fakes through dependency injection. Do not use mocks or spies.
- Keep filesystem access outside name resolution.
- Keep `std` resolution path-based and ordinary. Do not add a stdlib trust flag, source origin flag, replacement root flag, or intrinsic module path.
- Do not encode unresolved references as fake IDs.
- Sort outputs before returning: diagnostics, references, deferred members, and platform bindings.
- Preserve narrow source spans by using token spans where available.
- Skip malformed syntax with missing tokens when no useful present span exists.
- Do not resolve `let` locals or pattern bindings in this phase.
- Do resolve names inside proof-relevant syntax when those names are ordinary type/function/member/field references.

## Interface Contracts

These contracts are referenced by the tasks below. A subagent must not invent a
different public shape for these modules. If an implementation needs private
helpers, those helpers stay private to that module.

### Core And Platform Catalogs

```ts
export interface CoreTypeSpec {
  readonly id: CoreTypeId;
  readonly name: string;
}

export class CoreTypeCatalog {
  static default(): CoreTypeCatalog;
  static from(types: readonly CoreTypeSpec[]): CoreTypeCatalog;

  get types(): readonly CoreTypeSpec[];
  byName(name: string): CoreTypeSpec | undefined;
}
```

`CoreTypeCatalog.from` must throw `RangeError` with these exact message shapes:

```text
Duplicate core type name '<name>'.
Duplicate core type id '<coreTypeId>'.
```

```ts
export interface PlatformPrimitiveNameSpec {
  readonly primitiveId: PlatformPrimitiveId;
  readonly name: string;
}

export interface PlatformPrimitiveNameCatalog {
  readonly primitives: readonly PlatformPrimitiveNameSpec[];
  byName(name: string): PlatformPrimitiveNameSpec | undefined;
}

export function platformPrimitiveNameCatalog(
  primitives: readonly PlatformPrimitiveNameSpec[],
): PlatformPrimitiveNameCatalog;
```

`platformPrimitiveNameCatalog` is a validation boundary, not a diagnostic
producer. It must throw `RangeError` with these exact message shapes:

```text
Platform primitive names must be simple identifiers: '<name>'.
Duplicate platform primitive name '<name>'.
Duplicate platform primitive id '<primitiveId>'.
```

Name resolution may assume it receives a validated platform primitive name
catalog. Duplicate target primitive names or IDs are not name-resolution
diagnostics.

### References And Result Containers

```ts
export interface ResolveNamesInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly coreTypes: CoreTypeCatalog;
  readonly platformPrimitiveNames: PlatformPrimitiveNameCatalog;
}

export interface ResolveNamesResult {
  readonly references: ResolvedReferences;
  readonly platformBindings: ResolvedPlatformBindings;
  readonly diagnostics: readonly NameResolutionDiagnostic[];
}
```

```ts
export type NameReferenceKind =
  | "importModule"
  | "importedItem"
  | "moduleQualifiedItem"
  | "typeName"
  | "functionName"
  | "imageName"
  | "fieldName"
  | "enumCase"
  | "imageDevice"
  | "memberName"
  | "typeParameter"
  | "parameter";
```

```ts
export type ResolvedReference =
  | { readonly kind: "module"; readonly moduleId: ModuleId }
  | { readonly kind: "item"; readonly itemId: ItemId }
  | { readonly kind: "type"; readonly itemId: ItemId; readonly typeId: TypeId }
  | { readonly kind: "builtinType"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "function"; readonly itemId: ItemId; readonly functionId: FunctionId }
  | { readonly kind: "image"; readonly itemId: ItemId; readonly imageId: ImageId }
  | { readonly kind: "field"; readonly ownerItemId: ItemId; readonly fieldId: FieldId }
  | { readonly kind: "typeParameter"; readonly owner: TypeParameterOwner; readonly index: number }
  | { readonly kind: "parameter"; readonly parameterId: ParameterId };
```

```ts
export interface PlatformPrimitiveBinding {
  readonly itemId: ItemId;
  readonly functionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
}
```

```ts
export interface SyntaxReferenceKey {
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
  readonly kind: NameReferenceKind;
  readonly ordinal: number;
}

export interface ReferenceKeyInput {
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
  readonly kind: NameReferenceKind;
}

export class ReferenceKeyBuilder {
  next(input: ReferenceKeyInput): SyntaxReferenceKey;
}

export interface DeferredMemberReference {
  readonly key: SyntaxReferenceKey;
  readonly receiverExpressionKey: SyntaxReferenceKey | undefined;
  readonly memberName: string;
  readonly memberSpan: SourceSpan;
  readonly allowedNamespaces: readonly MemberNamespaceKind[];
}

export interface ResolvedReferenceEntry {
  readonly key: SyntaxReferenceKey;
  readonly reference: ResolvedReference;
}

export interface ResolvedReferences {
  get(key: SyntaxReferenceKey): ResolvedReference | undefined;
  entries(): readonly ResolvedReferenceEntry[];
  deferredMembers(): readonly DeferredMemberReference[];
}

export class ResolvedReferencesBuilder {
  add(key: SyntaxReferenceKey, reference: ResolvedReference): void;
  addDeferredMember(reference: DeferredMemberReference): void;
  merge(references: ResolvedReferences): void;
  build(): ResolvedReferences;
}

export interface ResolvedPlatformBindings {
  get(functionId: FunctionId): PlatformPrimitiveBinding | undefined;
  entries(): readonly PlatformPrimitiveBinding[];
}

export class ResolvedPlatformBindingsBuilder {
  add(binding: PlatformPrimitiveBinding): void;
  merge(bindings: ResolvedPlatformBindings): void;
  build(): ResolvedPlatformBindings;
}
```

### Diagnostics

```ts
export type NameResolutionDiagnosticCode =
  | "NAME_UNRESOLVED_MODULE"
  | "NAME_UNRESOLVED_IMPORT"
  | "NAME_AMBIGUOUS_IMPORT"
  | "NAME_UNRESOLVED_NAME"
  | "NAME_AMBIGUOUS_NAME"
  | "NAME_QUALIFIER_NOT_MODULE"
  | "NAME_QUALIFIER_NOT_OWNER"
  | "NAME_UNRESOLVED_MEMBER"
  | "NAME_AMBIGUOUS_MEMBER"
  | "NAME_UNKNOWN_PLATFORM_PRIMITIVE"
  | "NAME_PRIVATE_IMPORT"
  | "NAME_BUILTIN_TYPE_SHADOWED"
  | "NAME_PLATFORM_FN_NOT_FREESTANDING";

export type NameDiagnosticOrderKind = NameReferenceKind | "declaration" | "platformBinding";

export interface NameResolutionDiagnosticOrder {
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
  readonly kind: NameDiagnosticOrderKind;
  readonly ordinal: number;
}

export type NameResolutionDiagnostic = Diagnostic<NameResolutionDiagnosticCode> & {
  readonly order: NameResolutionDiagnosticOrder;
};

export function sortNameResolutionDiagnostics(
  diagnostics: readonly NameResolutionDiagnostic[],
): readonly NameResolutionDiagnostic[];
```

Diagnostic sort order is exactly: `order.moduleId`, `order.span.start`,
`order.span.end`, `order.kind`, `order.ordinal`, `code`, then `message`.
Constructors must accept caller-supplied `source`, `span`, and `order`; they must
not derive order from `source.name`.

Diagnostic constructors exported from `src/semantic/names/diagnostics.ts`:

```ts
export function unresolvedModule(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly moduleName: string;
}): NameResolutionDiagnostic;

export function unresolvedImport(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly moduleName: string;
  readonly importedName: string;
}): NameResolutionDiagnostic;

export function ambiguousImport(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly moduleName: string;
  readonly importedName: string;
  readonly candidates: readonly CandidateDisplay[];
}): NameResolutionDiagnostic;

export function unresolvedName(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly name: string;
}): NameResolutionDiagnostic;

export function ambiguousName(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly name: string;
  readonly candidates: readonly CandidateDisplay[];
}): NameResolutionDiagnostic;

export function qualifierNotModule(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly qualifier: string;
}): NameResolutionDiagnostic;

export function qualifierNotOwner(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly qualifier: string;
}): NameResolutionDiagnostic;

export function unresolvedMember(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly ownerName: string;
  readonly memberName: string;
}): NameResolutionDiagnostic;

export function ambiguousMember(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly ownerName: string;
  readonly memberName: string;
  readonly candidates: readonly CandidateDisplay[];
}): NameResolutionDiagnostic;

export function unknownPlatformPrimitive(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly functionName: string;
}): NameResolutionDiagnostic;

export function privateImport(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly moduleName: string;
  readonly importedName: string;
}): NameResolutionDiagnostic;

export function builtinTypeShadowed(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly name: string;
}): NameResolutionDiagnostic;

export function platformFnNotFreestanding(input: {
  readonly source: SourceText;
  readonly span: SourceSpan;
  readonly order: NameResolutionDiagnosticOrder;
  readonly functionName: string;
}): NameResolutionDiagnostic;
```

```ts
export interface CandidateDisplay {
  readonly modulePath: string;
  readonly itemKind: string;
  readonly name: string;
  readonly denseId: number;
}

export function candidateDisplayText(candidates: readonly CandidateDisplay[]): string;
```

`candidateDisplayText` sorts candidates by `modulePath`, `itemKind`, `name`, and
`denseId`, then joins them with `", "`.

### Module Namespace

```ts
export interface ModuleNamespace {
  resolveDottedModule(moduleName: string): ModuleLookupResult;
  resolveQualifiedPrefix(segments: readonly string[]): QualifiedModulePrefixResult;
}

export type ModuleLookupResult =
  | {
      readonly kind: "resolved";
      readonly moduleId: ModuleId;
      readonly pathKey: string;
      readonly moduleSegments: readonly string[];
    }
  | { readonly kind: "unresolved"; readonly moduleName: string; readonly pathKey: string };

export type QualifiedModulePrefixResult =
  | {
      readonly kind: "resolved";
      readonly moduleId: ModuleId;
      readonly pathKey: string;
      readonly moduleSegments: readonly string[];
      readonly itemSegment: string;
      readonly memberSegments: readonly string[];
    }
  | {
      readonly kind: "prefixConsumesAllSegments";
      readonly moduleId: ModuleId;
      readonly pathKey: string;
      readonly moduleSegments: readonly string[];
    }
  | { readonly kind: "noModulePrefix"; readonly segments: readonly string[] };

export function buildModuleNamespace(index: ItemIndex): ModuleNamespace;
export function dottedModuleNameToPathKey(moduleName: string): string;
```

`resolveQualifiedPrefix(["std", "io", "buffer", "Reader"])` must prefer the
longest loaded module prefix. If both `std/io.wr` and `std/io/buffer.wr` are
loaded, the result uses `std/io/buffer.wr` with item segment `Reader`.

### Scopes

```ts
export type ScopeNamespace = "type" | "value";

export interface ScopeCandidate {
  readonly namespace: ScopeNamespace;
  readonly name: string;
  readonly reference: ResolvedReference;
  readonly display: CandidateDisplay;
}

export interface ScopeTier {
  readonly name: string;
  readonly candidates: readonly ScopeCandidate[];
}

export type ScopeLookupResult =
  | { readonly kind: "resolved"; readonly reference: ResolvedReference }
  | { readonly kind: "unresolved" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly ScopeCandidate[] };

export interface Scope {
  lookup(namespace: ScopeNamespace, name: string): ScopeLookupResult;
  lookupType(name: string): ScopeLookupResult;
  lookupValue(name: string): ScopeLookupResult;
}

export class ScopeBuilder {
  addTier(name: string, candidates: readonly ScopeCandidate[]): this;
  build(): Scope;
}

export function scopeBuilder(): ScopeBuilder;
export function resolvedReferenceForItem(index: ItemIndex, item: ItemRecord): ResolvedReference;
export function typeCandidate(
  name: string,
  itemId: ItemId,
  typeId: TypeId,
  display?: CandidateDisplay,
): ScopeCandidate;
export function functionCandidate(
  name: string,
  itemId: ItemId,
  functionId: FunctionId,
  display?: CandidateDisplay,
): ScopeCandidate;
export function itemCandidate(
  namespace: ScopeNamespace,
  name: string,
  itemId: ItemId,
  display?: CandidateDisplay,
): ScopeCandidate;
export function typeParameterCandidate(
  name: string,
  owner: TypeParameterOwner,
  index: number,
  display?: CandidateDisplay,
): ScopeCandidate;
export function parameterCandidate(
  name: string,
  parameterId: ParameterId,
  display?: CandidateDisplay,
): ScopeCandidate;
```

### Imports

```ts
export interface ResolveImportsInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly moduleNamespace: ModuleNamespace;
  readonly referenceKeys: ReferenceKeyBuilder;
}

export interface ImportedScopeByModule {
  readonly moduleId: ModuleId;
  readonly candidates: readonly ScopeCandidate[];
}

export interface ImportResolutionResult {
  readonly references: ResolvedReferences;
  readonly importedScopes: readonly ImportedScopeByModule[];
  readonly diagnostics: readonly NameResolutionDiagnostic[];
}

export function resolveImports(input: ResolveImportsInput): ImportResolutionResult;
```

### Members

```ts
export type MemberNamespaceKind = "field" | "function" | "enumCase" | "imageDevice";

export interface MemberNamespace {
  resolveMember(input: ResolveMemberInput): ResolveMemberResult;
}

export interface ResolveMemberInput {
  readonly ownerItemId: ItemId;
  readonly name: string;
  readonly allowedNamespaces?: readonly MemberNamespaceKind[];
}

export type ResolveMemberResult =
  | { readonly kind: "resolved"; readonly reference: ResolvedReference }
  | { readonly kind: "unresolved" }
  | { readonly kind: "ambiguous"; readonly candidates: readonly ResolvedReference[] };

export function buildMemberNamespace(index: ItemIndex): MemberNamespace;
```

### Platform Binding

```ts
export interface BindPlatformFunctionsInput {
  readonly index: ItemIndex;
  readonly platformPrimitiveNames: PlatformPrimitiveNameCatalog;
}

export interface BindPlatformFunctionsResult {
  readonly bindings: ResolvedPlatformBindings;
  readonly diagnostics: readonly NameResolutionDiagnostic[];
}

export function bindPlatformFunctions(
  input: BindPlatformFunctionsInput,
): BindPlatformFunctionsResult;
```

### Type, Pattern, Expression, And Statement Resolution

```ts
export interface ModuleResolutionContext {
  readonly moduleId: ModuleId;
  readonly source: SourceText;
  readonly scope: Scope;
}

export interface NameResolutionPartResult {
  readonly references: ResolvedReferences;
  readonly diagnostics: readonly NameResolutionDiagnostic[];
}

export interface ResolveTypeReferencesInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly coreTypes: CoreTypeCatalog;
  readonly moduleNamespace: ModuleNamespace;
  readonly memberNamespace: MemberNamespace;
  readonly moduleContexts: readonly ModuleResolutionContext[];
  readonly referenceKeys: ReferenceKeyBuilder;
}

export function resolveTypeReferences(input: ResolveTypeReferencesInput): NameResolutionPartResult;

export interface ResolveExpressionsInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly moduleNamespace: ModuleNamespace;
  readonly memberNamespace: MemberNamespace;
  readonly moduleContexts: readonly ModuleResolutionContext[];
  readonly referenceKeys: ReferenceKeyBuilder;
}

export function resolveExpressions(input: ResolveExpressionsInput): NameResolutionPartResult;
```

### Orchestrator

```ts
export function resolveNames(input: ResolveNamesInput): ResolveNamesResult;
```

`resolveNames` is the only task that merges all part results. It must merge
references with `ResolvedReferencesBuilder.merge`, merge platform bindings with
`ResolvedPlatformBindingsBuilder.merge`, concatenate diagnostics, and then sort
diagnostics with `sortNameResolutionDiagnostics`.

---

### Task 1: Refactor Semantic IDs For Core Types And Platform Primitives

**Wave:** 0

**Dependencies:** None

**Description:** Replace the old intrinsic ID concept with explicit core type and platform primitive IDs while keeping all dense source IDs stable.

**Files:**

- Modify: `src/semantic/ids.ts`
- Modify: `tests/unit/semantic/ids.test.ts`

**Acceptance Criteria:**

- `IntrinsicId` and `intrinsicId()` are removed from runtime source.
- `CoreTypeId` and `coreTypeId()` exist and validate non-empty, trimmed strings.
- `PlatformPrimitiveId` and `platformPrimitiveId()` exist and validate non-empty, trimmed strings.
- Existing dense ID constructors still reject negative, fractional, `NaN`, and infinite values.
- Tests cover valid and invalid core/platform IDs.

**Code Example:**

```ts
expect(coreTypeId("u32")).toBe("u32");
expect(platformPrimitiveId("volatile_load_u32")).toBe("volatile_load_u32");

expect(() => coreTypeId("")).toThrow("CoreTypeId must not be empty");
expect(() => platformPrimitiveId(" volatile_load_u32 ")).toThrow(
  "PlatformPrimitiveId must not have leading or trailing whitespace",
);
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/ids.test.ts
```

### Task 2: Make Item-Index Records Source-Only

**Wave:** 1

**Dependencies:** Task 1

**Description:** Remove source/intrinsic origin distinctions from item-index records. The item index should describe loaded source modules and source declarations only.

**Files:**

- Modify: `src/semantic/item-index/item-records.ts`
- Modify: `src/semantic/item-index/item-index.ts`
- Modify: `tests/unit/semantic/item-index/item-index.test.ts`
- Modify: `tests/unit/semantic/item-index/duplicates.test.ts`
- Modify: `tests/unit/semantic/item-index/source-module-collector.test.ts`
- Modify: `tests/unit/semantic/item-index/source-member-collector.test.ts`

**Acceptance Criteria:**

- `ModuleOrigin`, `IntrinsicItemKind`, `IntrinsicItemRecord`, `ParameterOrigin`, and `IntrinsicParameterRecord` are removed.
- `ModuleRecord` has no `origin` and always has source information.
- `ItemRecord` is source-only. It keeps `kind`, `moduleId`, optional `parentItemId`, name, modifiers, spans, declaration, and optional source IDs.
- `FunctionRecord` no longer has `intrinsicId`.
- `ParameterRecord` is source-only and keeps name spans/type information.
- `ItemIndex.moduleByPath(pathKey)` no longer accepts an origin.
- `modules()`, `items()`, `parameters()`, and grouped lookup methods still return defensive copies.

**Code Example:**

```ts
const module = index.moduleByPath("std/io.wr");
expect(module?.display).toBe("std/io.wr");

const fn = index.functions()[0]!;
expect("intrinsicId" in fn).toBe(false);

const parameter = index.parametersForFunction(fn.id)[0]!;
expect(parameter.nameSpan).toBeDefined();
expect(parameter.type?.qualifiedNameText()).toBe("Address");
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/item-index/item-index.test.ts
```

### Task 3: Refactor Item-Index Builder And Duplicate Diagnostics To Source-Only

**Wave:** 2

**Dependencies:** Task 2

**Description:** Remove intrinsic collection from `buildItemIndex` and simplify duplicate checking to source modules, source declarations, source fields, source parameters, source type parameters, and enum cases.

**Files:**

- Modify: `src/semantic/item-index/item-index-builder.ts`
- Modify: `src/semantic/item-index/source-module-collector.ts`
- Modify: `src/semantic/item-index/source-member-collector.ts`
- Modify: `src/semantic/item-index/duplicate-checker.ts`
- Modify: `src/semantic/item-index/diagnostics.ts`
- Modify: `tests/unit/semantic/item-index/item-index-builder.test.ts`
- Modify: `tests/unit/semantic/item-index/duplicates.test.ts`
- Modify: `tests/unit/semantic/item-index/source-module-collector.test.ts`
- Modify: `tests/unit/semantic/item-index/source-member-collector.test.ts`
- Modify: `tests/integration/semantic/item-index.test.ts`
- Modify: `tests/integration/semantic/item-index-determinism.test.ts`

**Acceptance Criteria:**

- `BuildItemIndexInput` has only `graph: ParsedModuleGraph`.
- `buildItemIndex` never calls `collectIntrinsicItems`.
- Item IDs, function IDs, type IDs, image IDs, field IDs, and parameter IDs remain dense and deterministic for source-only graphs.
- Intrinsic duplicate diagnostic codes are removed.
- Duplicate source module/declaration/field/parameter/type-parameter/enum-case diagnostics still sort by source name, span start, span end, and code.
- Source modules with paths like `std/io.wr` do not receive shadowing diagnostics.

**Code Example:**

```ts
const graph = parseModuleGraphForTest([
  ["app/main.wr", "use Writer from std.io\nfn main(writer: Writer)\n"],
  ["std/io.wr", "class Writer:\n"],
]);

const result = buildItemIndex({ graph });

expect(result.index.modules().map((module) => module.pathKey)).toEqual([
  "app/main.wr",
  "std/io.wr",
]);
expect(result.diagnostics.map((diagnostic) => diagnostic.code)).not.toContain(
  "ITEM_SOURCE_MODULE_SHADOWS_INTRINSIC_MODULE",
);
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/item-index
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/integration/semantic/item-index.test.ts
```

### Task 4: Retire Old Intrinsic Catalog Source And Tests

**Wave:** 3

**Dependencies:** Tasks 3 and 7

**Description:** Delete the obsolete intrinsic item-index modules, remove their barrel exports, and replace old tests with platform-name-catalog tests from Task 7.

**Files:**

- Delete: `src/semantic/item-index/intrinsic-catalog.ts`
- Delete: `src/semantic/item-index/intrinsic-collector.ts`
- Delete: `src/semantic/item-index/stable-serialization.ts`
- Modify: `src/semantic/item-index/index.ts`
- Delete: `tests/unit/semantic/item-index/intrinsic-catalog.test.ts`
- Delete: `tests/unit/semantic/item-index/intrinsic-collector.test.ts`
- Delete: `tests/support/semantic/intrinsic-fakes.ts`
- Modify: `tests/integration/semantic/public-api.test.ts`

**Acceptance Criteria:**

- `src/semantic/item-index/index.ts` exports only source item-index APIs.
- `rg "Intrinsic" src tests` returns no runtime or test references. Historical docs may still mention old intrinsic scaffolding.
- Public API tests no longer expect item-index intrinsic catalog exports.
- All item-index tests pass without intrinsic fakes.

**Code Example:**

```bash
rg "Intrinsic" src tests
# expected: no matches
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/item-index
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/integration/semantic/public-api.test.ts
```

### Task 5: Add AST Accessors Needed By Name Resolution

**Wave:** 0

**Dependencies:** None

**Description:** Extend the existing AST views just enough for name resolution to walk imports, type annotations, proof-relevant expressions, and statement bodies without broad descendant scans.

**Files:**

- Modify: `src/frontend/ast/declaration-views.ts`
- Modify: `src/frontend/ast/statement-views.ts`
- Modify: `src/frontend/ast/pattern-views.ts`
- Modify: `tests/unit/frontend/ast/declaration-views.test.ts`
- Modify: `tests/unit/frontend/ast/statement-requirement-views.test.ts`
- Modify: `tests/unit/frontend/ast/name-type-views.test.ts`

**Acceptance Criteria:**

- `ImportDeclarationView.importedNames()` returns only tokens from `ImportNameList`; it must not return module-name segments.
- `LetStatementView` exposes `type()` and `value()` accessors. It may expose the pattern, but name resolution must not assign local IDs from it.
- `ForStatementView` exposes `iterable()` and `body()`.
- `TakeStatementView` exposes `expression()`, optional alias token/text/span, and `body()`.
- `ElseClauseView` exposes either `body()` for block form or `statement()` for inline form.
- `PatternView` exposes its leading `QualifiedNameView` and nested `PatternListView` when present.
- All new accessors return `undefined` or `[]` for malformed syntax rather than throwing.

**Code Example:**

```ts
const root = parseSourceRoot("use Writer, Status from std.io\n");
const sourceFile = SourceFileView.fromRoot(root)!;
const importView = sourceFile.imports()[0]!;

expect(importView.importedNames().map((token) => presentTokenText(token))).toEqual([
  "Writer",
  "Status",
]);
expect(importView.moduleName()!.text()).toBe("std.io");
```

```ts
const root = parseSourceRoot("take stream as packet:\n    close(packet)\n");
const take = TakeStatementView.from(descendants(root, SyntaxKind.TakeStatement)[0]!)!;

expect(take.expression()!.kind).toBe(SyntaxKind.NameExpression);
expect(take.aliasText()).toBe("packet");
expect(take.body()!.items()).toHaveLength(1);
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/frontend/ast
```

### Task 6: Implement Core Type Catalog

**Wave:** 1

**Dependencies:** Task 1

**Description:** Add the type-position builtin catalog used by name resolution. This is not a prelude and does not include source-visible stdlib types.

**Files:**

- Create: `src/semantic/names/core-types.ts`
- Create: `tests/unit/semantic/names/core-types.test.ts`

**Acceptance Criteria:**

- `src/semantic/names/core-types.ts` exports exactly `CoreTypeSpec` and `CoreTypeCatalog` from the interface contracts.
- `CoreTypeCatalog.default()` returns exactly `bool`, `u8`, `u16`, `u32`, `u64`, `usize`, and `Never`.
- Lookup by name returns the matching `CoreTypeSpec`.
- Returned arrays are defensive copies.
- Duplicate names throw `RangeError("Duplicate core type name '<name>'.")` when constructing a custom catalog.
- Duplicate IDs throw `RangeError("Duplicate core type id '<coreTypeId>'.")` when constructing a custom catalog.
- Core type IDs use `CoreTypeId` from Task 1.

**Code Example:**

```ts
const catalog = CoreTypeCatalog.default();

expect(catalog.byName("u32")?.id).toBe(coreTypeId("u32"));
expect(catalog.byName("Address")).toBeUndefined();
expect(catalog.types.map((type) => type.name)).toEqual([
  "Never",
  "bool",
  "u16",
  "u32",
  "u64",
  "u8",
  "usize",
]);
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/core-types.test.ts
```

### Task 7: Implement Platform Primitive Name Catalog

**Wave:** 1

**Dependencies:** Task 1

**Description:** Add a names-only target primitive catalog for name resolution. It validates primitive IDs and simple source-facing names without exposing signatures, proof contracts, or lowering contracts.

**Files:**

- Create: `src/semantic/names/platform-primitives.ts`
- Create: `tests/unit/semantic/names/platform-primitives.test.ts`
- Create: `tests/support/semantic/name-resolution-fakes.ts`

**Acceptance Criteria:**

- `PlatformPrimitiveNameCatalog` stores `PlatformPrimitiveNameSpec[]` with `primitiveId` and simple `name`.
- `src/semantic/names/platform-primitives.ts` exports exactly `PlatformPrimitiveNameSpec`, `PlatformPrimitiveNameCatalog`, and `platformPrimitiveNameCatalog` from the interface contracts.
- Primitive names must match `/^[A-Za-z_][A-Za-z0-9_]*$/`.
- Dotted names like `memory.volatile_load.u32` are invalid.
- Invalid primitive names throw `RangeError("Platform primitive names must be simple identifiers: '<name>'.")`.
- Duplicate primitive names throw `RangeError("Duplicate platform primitive name '<name>'.")`.
- Duplicate primitive IDs throw `RangeError("Duplicate platform primitive id '<primitiveId>'.")`.
- Entries are sorted by primitive name, then primitive ID.
- The catalog exposes lookup by simple name for platform binding.
- Test fakes can construct catalogs without filesystem access.
- Name resolution never emits diagnostics for duplicate platform catalog entries because validated catalog construction owns those errors.

**Code Example:**

```ts
const catalog = platformPrimitiveNameCatalog([
  {
    primitiveId: platformPrimitiveId("volatile_load_u32"),
    name: "volatile_load_u32",
  },
]);

expect(catalog.byName("volatile_load_u32")?.primitiveId).toBe(
  platformPrimitiveId("volatile_load_u32"),
);
expect(() =>
  platformPrimitiveNameCatalog([
    { primitiveId: platformPrimitiveId("bad"), name: "memory.volatile_load.u32" },
  ]),
).toThrow("Platform primitive names must be simple identifiers: 'memory.volatile_load.u32'.");

expect(() =>
  platformPrimitiveNameCatalog([
    { primitiveId: platformPrimitiveId("load_a"), name: "volatile_load_u32" },
    { primitiveId: platformPrimitiveId("load_b"), name: "volatile_load_u32" },
  ]),
).toThrow("Duplicate platform primitive name 'volatile_load_u32'.");
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/platform-primitives.test.ts
```

### Task 8: Implement Name-Resolution Diagnostics

**Wave:** 0

**Dependencies:** None

**Description:** Define the name-resolution diagnostic union, constructors, candidate formatting, and stable sorting.

**Files:**

- Create: `src/semantic/names/diagnostics.ts`
- Create: `tests/unit/semantic/names/diagnostics.test.ts`

**Acceptance Criteria:**

- `src/semantic/names/diagnostics.ts` exports exactly the diagnostic codes, order type, constructors, `CandidateDisplay`, `candidateDisplayText`, and `sortNameResolutionDiagnostics` from the interface contracts.
- Diagnostic codes include the design codes plus required v1 boundary diagnostics:

```ts
export type NameResolutionDiagnosticCode =
  | "NAME_UNRESOLVED_MODULE"
  | "NAME_UNRESOLVED_IMPORT"
  | "NAME_AMBIGUOUS_IMPORT"
  | "NAME_UNRESOLVED_NAME"
  | "NAME_AMBIGUOUS_NAME"
  | "NAME_QUALIFIER_NOT_MODULE"
  | "NAME_QUALIFIER_NOT_OWNER"
  | "NAME_UNRESOLVED_MEMBER"
  | "NAME_AMBIGUOUS_MEMBER"
  | "NAME_UNKNOWN_PLATFORM_PRIMITIVE"
  | "NAME_PRIVATE_IMPORT"
  | "NAME_BUILTIN_TYPE_SHADOWED"
  | "NAME_PLATFORM_FN_NOT_FREESTANDING";
```

- Diagnostics are `Diagnostic<NameResolutionDiagnosticCode>`.
- `NameResolutionDiagnostic` carries an `order` object with `moduleId`, `span`, `kind`, and `ordinal`.
- Sort order is exactly `order.moduleId`, `order.span.start`, `order.span.end`, `order.kind`, `order.ordinal`, diagnostic code, then message.
- Candidate text sorts by module path, item kind, item name, and dense ID.
- Constructors use narrow spans supplied by callers and never inspect the filesystem.
- Constructors do not derive ordering from `source.name`; callers must pass the `ModuleId`-based order.

**Code Example:**

```ts
const diagnostics = sortNameResolutionDiagnostics([
  unresolvedName({
    source,
    span: source.span(8, 14),
    order: {
      moduleId: moduleId(0),
      span: source.span(8, 14),
      kind: "typeName",
      ordinal: 0,
    },
    name: "Writer",
  }),
  unresolvedModule({
    source,
    span: source.span(0, 6),
    order: {
      moduleId: moduleId(0),
      span: source.span(0, 6),
      kind: "importModule",
      ordinal: 0,
    },
    moduleName: "std.io",
  }),
]);

expect(diagnostics.map((diagnostic) => diagnostic.code)).toEqual([
  "NAME_UNRESOLVED_MODULE",
  "NAME_UNRESOLVED_NAME",
]);
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/diagnostics.test.ts
```

### Task 9: Implement Reference Keys And Result Containers

**Wave:** 1

**Dependencies:** Tasks 1 and 8

**Description:** Add syntax-coordinate reference keys, ordinal assignment, immutable resolved reference tables, deferred member tables, and platform binding result containers.

**Files:**

- Create: `src/semantic/names/reference.ts`
- Create: `src/semantic/names/reference-key.ts`
- Create: `src/semantic/names/resolution-result.ts`
- Create: `tests/unit/semantic/names/reference-key.test.ts`
- Create: `tests/unit/semantic/names/resolved-references.test.ts`

**Acceptance Criteria:**

- `src/semantic/names/reference.ts`, `reference-key.ts`, and `resolution-result.ts` export exactly the reference key, reference entry, deferred member, reference-builder, resolved-references, platform-binding, and platform-binding-builder symbols from the interface contracts.
- `ReferenceKeyBuilder` assigns ordinals per `(moduleId, span.start, span.end, kind)` during stable traversal.
- Consumers can derive the same key by using the exported builder in the same walk order.
- `ResolvedReferences.get(key)` uses structural key equality, not object identity.
- `ResolvedReferences.entries()` sorts by `moduleId`, span start, span end, reference kind, and ordinal.
- Deferred members are returned in key order.
- `ResolvedPlatformBindings.get(functionId)` returns a binding by source `FunctionId`.
- Platform binding entries sort by `FunctionId`, then `ItemId`, then `PlatformPrimitiveId`.

**Code Example:**

```ts
const builder = new ReferenceKeyBuilder();
const first = builder.next({
  moduleId: moduleId(0),
  span: SourceSpan.from(10, 16),
  kind: "typeName",
});
const second = builder.next({
  moduleId: moduleId(0),
  span: SourceSpan.from(10, 16),
  kind: "typeName",
});

expect(first.ordinal).toBe(0);
expect(second.ordinal).toBe(1);
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/reference-key.test.ts
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/resolved-references.test.ts
```

### Task 10: Implement Module Namespace And Longest Prefix Lookup

**Wave:** 2

**Dependencies:** Task 2

**Description:** Build a loaded-source-module namespace from `ItemIndex.modules()` and provide exact import lookup plus longest-prefix lookup for module-qualified item/member chains.

**Files:**

- Create: `src/semantic/names/module-namespace.ts`
- Create: `tests/unit/semantic/names/module-namespace.test.ts`

**Acceptance Criteria:**

- `src/semantic/names/module-namespace.ts` exports exactly `ModuleNamespace`, `ModuleLookupResult`, `QualifiedModulePrefixResult`, `buildModuleNamespace`, and `dottedModuleNameToPathKey` from the interface contracts.
- The namespace is built from source module records only.
- `resolveDottedModule("std.io")` maps to `std/io.wr` and returns the loaded `ModuleId`.
- Missing modules return an unresolved result without reading files.
- Longest-prefix lookup tries the longest module prefix first.
- For `std.io.Writer.default`, the namespace result identifies module `std/io.wr`, item segment `Writer`, and remaining member segments `["default"]`.
- If no loaded module prefix exists, `resolveQualifiedPrefix` returns `{ kind: "noModulePrefix", segments }`.
- If the longest loaded module prefix consumes every segment, `resolveQualifiedPrefix` returns `{ kind: "prefixConsumesAllSegments", moduleId, pathKey, moduleSegments }`.
- If a loaded module prefix exists and at least one segment remains, `resolveQualifiedPrefix` returns `resolved` even when the terminal item may not exist; item existence is checked by type/expression resolution so it can emit `NAME_UNRESOLVED_IMPORT`, `NAME_UNRESOLVED_NAME`, or `NAME_QUALIFIER_NOT_OWNER` with the right context.
- Unit tests cover no prefix, prefix consuming all segments, prefix with missing terminal item, longest-prefix wins, and loaded `std` modules as ordinary source.
- Loaded `std` modules have no special trust or origin flag.

**Code Example:**

```ts
const namespace = buildModuleNamespace(index);

expect(namespace.resolveDottedModule("std.io")).toEqual({
  kind: "resolved",
  moduleId: moduleId(1),
  pathKey: "std/io.wr",
  moduleSegments: ["std", "io"],
});

expect(namespace.resolveQualifiedPrefix(["std", "io", "Writer", "default"])).toEqual({
  kind: "resolved",
  moduleId: moduleId(1),
  pathKey: "std/io.wr",
  moduleSegments: ["std", "io"],
  itemSegment: "Writer",
  memberSegments: ["default"],
});

expect(namespace.resolveQualifiedPrefix(["missing", "Writer"])).toEqual({
  kind: "noModulePrefix",
  segments: ["missing", "Writer"],
});

expect(namespace.resolveQualifiedPrefix(["std", "io"])).toEqual({
  kind: "prefixConsumesAllSegments",
  moduleId: moduleId(1),
  pathKey: "std/io.wr",
  moduleSegments: ["std", "io"],
});
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/module-namespace.test.ts
```

### Task 11: Implement Generic Scopes And Item Reference Classification

**Wave:** 2

**Dependencies:** Tasks 2, 6, and 9

**Description:** Add deterministic type/value scopes and helpers that convert item-index records into the most specific resolved reference variant.

**Files:**

- Create: `src/semantic/names/scope.ts`
- Create: `tests/unit/semantic/names/scope.test.ts`

**Acceptance Criteria:**

- `src/semantic/names/scope.ts` exports exactly `ScopeNamespace`, `ScopeCandidate`, `ScopeTier`, `ScopeLookupResult`, `Scope`, `ScopeBuilder`, `scopeBuilder`, candidate helpers, and `resolvedReferenceForItem` from the interface contracts.
- Scope lookup supports named tiers. Higher tiers shadow lower tiers.
- Same-tier multiple candidates are ambiguous.
- Type namespace can hold source types, type parameters, and core builtin types.
- Value namespace can hold functions, parameters, enum cases, and images. Other item records enter the value namespace only when a caller explicitly creates `itemCandidate("value", ...)`.
- Module declarations shadow explicit imports.
- Function type parameters shadow module type imports.
- Parameters shadow module value imports.
- Helper `resolvedReferenceForItem(index, item)` returns `type` when `item.typeId` exists, `function` when `item.functionId` exists, `image` when `item.imageId` exists, and `item` otherwise.

**Code Example:**

```ts
const scope = scopeBuilder()
  .addTier("functionTypeParameters", [
    typeParameterCandidate(
      "T",
      { kind: "function", itemId: itemId(0), functionId: functionId(0) },
      0,
    ),
  ])
  .addTier("moduleImports", [typeCandidate("T", itemId(1), typeId(1))])
  .build();

expect(scope.lookupType("T")).toEqual({
  kind: "resolved",
  reference: {
    kind: "typeParameter",
    owner: { kind: "function", itemId: itemId(0), functionId: functionId(0) },
    index: 0,
  },
});
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/scope.test.ts
```

### Task 12: Implement Import Resolver

**Wave:** 3

**Dependencies:** Tasks 5, 8, 9, 10, and 11

**Description:** Resolve import module paths and imported top-level item names, including private import rejection and deterministic import ambiguity.

**Files:**

- Create: `src/semantic/names/import-resolver.ts`
- Create: `tests/unit/semantic/names/import-resolver.test.ts`

**Acceptance Criteria:**

- `src/semantic/names/import-resolver.ts` exports exactly `ResolveImportsInput`, `ImportedScopeByModule`, `ImportResolutionResult`, and `resolveImports` from the interface contracts.
- Each import declaration records an `importModule` reference for the dotted module name.
- Each imported item token records an `importedItem` reference when resolved.
- Missing module emits `NAME_UNRESOLVED_MODULE` and skips imported item resolution from that declaration.
- Missing exported item emits `NAME_UNRESOLVED_IMPORT`.
- Private source items are importable only from their own module; external imports emit `NAME_PRIVATE_IMPORT`.
- Multiple exported items with the same name in the target module produce `NAME_AMBIGUOUS_IMPORT`.
- The resulting imported candidates can be used as a lower-priority module-scope tier.
- Importing platform primitive names directly never consults the platform catalog.

**Code Example:**

```ts
const graph = parseModuleGraphForTest([
  ["app/main.wr", "use Writer from std.io\nfn main(writer: Writer)\n"],
  ["std/io.wr", "class Writer:\n"],
]);
const itemIndexResult = buildItemIndex({ graph });
const result = resolveImports({
  graph,
  index: itemIndexResult.index,
  moduleNamespace: buildModuleNamespace(itemIndexResult.index),
  referenceKeys: new ReferenceKeyBuilder(),
});

expect(result.references.entries().map((entry) => entry.reference.kind)).toEqual([
  "module",
  "type",
]);
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/import-resolver.test.ts
```

### Task 13: Implement Member Namespace

**Wave:** 2

**Dependencies:** Tasks 2 and 9

**Description:** Build owner-indexed member tables for fields, image devices, enum cases, and member functions, with a public HIR/type-checker-facing lookup API.

**Files:**

- Create: `src/semantic/names/member-namespace.ts`
- Create: `tests/unit/semantic/names/member-namespace.test.ts`

**Acceptance Criteria:**

- `src/semantic/names/member-namespace.ts` exports exactly `MemberNamespaceKind`, `MemberNamespace`, `ResolveMemberInput`, `ResolveMemberResult`, and `buildMemberNamespace` from the interface contracts.
- `MemberNamespaceKind` is `"field" | "function" | "enumCase" | "imageDevice"`.
- Field records preserve `FieldRole`, so `imageDevice` lookup can be separated from ordinary field lookup.
- Enum cases resolve as item references owned by the enum item.
- Member functions resolve as function references owned by the parent item.
- `resolveMember` filters by `allowedNamespaces` when provided.
- Missing member returns `unresolved`.
- Multiple candidates across allowed namespaces return `ambiguous` with candidates sorted deterministically.
- This API is reusable by later type checking for deferred member references.

**Code Example:**

```ts
const members = buildMemberNamespace(index);

expect(
  members.resolveMember({
    ownerItemId: itemId(0),
    name: "bootServices",
    allowedNamespaces: ["imageDevice"],
  }),
).toEqual({
  kind: "resolved",
  reference: { kind: "field", ownerItemId: itemId(0), fieldId: fieldId(2) },
});
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/member-namespace.test.ts
```

### Task 14: Implement Platform Function Binding

**Wave:** 3

**Dependencies:** Tasks 3, 7, and 8

**Description:** Bind freestanding source `platform fn` declarations to selected target primitive names by simple function name, and diagnose v1 boundary violations.

**Files:**

- Create: `src/semantic/names/platform-binding.ts`
- Create: `tests/unit/semantic/names/platform-binding.test.ts`

**Acceptance Criteria:**

- `src/semantic/names/platform-binding.ts` exports exactly `BindPlatformFunctionsInput`, `BindPlatformFunctionsResult`, and `bindPlatformFunctions` from the interface contracts.
- Only source `FunctionRecord`s whose owning item has the `platform` modifier are considered.
- A bindable source platform function must be freestanding: its item must have no `parentItemId`.
- Freestanding `platform fn volatile_load_u32(...)` binds to catalog primitive name `volatile_load_u32`.
- Unknown primitive names emit `NAME_UNKNOWN_PLATFORM_PRIMITIVE`.
- Method-shaped or local `platform fn` declarations emit `NAME_PLATFORM_FN_NOT_FREESTANDING` and receive no binding.
- Multiple freestanding source handles for the same primitive are allowed across modules and each receives its own binding.
- Binding output is name-only. It must not inspect source signatures, requirements, proof contracts, or lowering contracts.

**Code Example:**

```ts
const catalog = platformPrimitiveNameCatalog([
  { primitiveId: platformPrimitiveId("volatile_load_u32"), name: "volatile_load_u32" },
]);

const result = bindPlatformFunctions({
  index,
  platformPrimitiveNames: catalog,
});

expect(result.bindings.get(functionId(0))).toEqual({
  itemId: itemId(0),
  functionId: functionId(0),
  primitiveId: platformPrimitiveId("volatile_load_u32"),
});
```

```wr
class Register32:
    platform fn load() -> u32

# expected diagnostic:
# NAME_PLATFORM_FN_NOT_FREESTANDING at "load"
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/platform-binding.test.ts
```

### Task 15: Implement Type Reference And Pattern Name Resolution

**Wave:** 3

**Dependencies:** Tasks 5, 6, 9, 10, and 11

**Description:** Resolve type-position names, type arguments, type-parameter bounds, and pattern names that are references rather than local binders.

**Files:**

- Create: `src/semantic/names/type-reference-resolver.ts`
- Create: `tests/unit/semantic/names/type-reference-resolver.test.ts`

**Acceptance Criteria:**

- `src/semantic/names/type-reference-resolver.ts` exports exactly `ModuleResolutionContext`, `NameResolutionPartResult`, `ResolveTypeReferencesInput`, and `resolveTypeReferences` from the interface contracts.
- Type references resolve core builtin types before source scopes.
- Source declarations cannot shadow core builtin types in type position; emit `NAME_BUILTIN_TYPE_SHADOWED` for type-like source declarations named `bool`, `u8`, `u16`, `u32`, `u64`, `usize`, or `Never`.
- Type parameters resolve in type position and shadow imported type names.
- Module-qualified type names use longest loaded-module prefix lookup.
- If `ModuleNamespace.resolveQualifiedPrefix` returns `noModulePrefix` for a dotted type name, emit `NAME_UNRESOLVED_MODULE` at the qualified-name span.
- If `resolveQualifiedPrefix` returns `prefixConsumesAllSegments` for a type name such as `std.io`, emit `NAME_UNRESOLVED_NAME` with message text shaped as `Qualified name 'std.io' resolves to a module, not an item.`
- If a module prefix resolves but the terminal item segment is not in that module, emit `NAME_UNRESOLVED_NAME` at the terminal item span.
- If a qualifier resolves as a source item but the item does not own the requested member namespace, emit `NAME_QUALIFIER_NOT_OWNER` at the qualifier span.
- If a dotted type name is written in a module-qualified context and the first segment resolves to an item instead of a module, emit `NAME_QUALIFIER_NOT_MODULE`.
- Type arguments and type-parameter bounds are recursively resolved.
- Function parameter types, return types, field types, image device field types, validated-buffer param/layout field types, and derive field types are all covered.
- Pattern qualified names such as `PacketKind.ping` resolve as owner-qualified enum/member references when possible.
- Constructor-shaped patterns such as `Ok(packet)` resolve the leading name as a value/item reference; nested simple pattern binders are not diagnosed as unresolved locals.
- Bare simple patterns that do not resolve are treated as binders and do not emit unresolved-name diagnostics.

**Code Example:**

```ts
fn parse[T: ReadableBuffer](buffer: T) -> u32
```

Expected references:

```text
ReadableBuffer -> typeName source type
T              -> typeName typeParameter
u32            -> typeName builtinType
```

```wr
match kind:
    case PacketKind.ping:
        handle_ping()
    case unknown_binding:
        handle_unknown()
```

Expected behavior:

```text
PacketKind -> owner item reference
ping       -> enumCase/member reference
unknown_binding -> no name-resolution diagnostic; pattern binding is HIR-owned
```

Failure tests required:

```text
std.io                  -> prefixConsumesAllSegments, NAME_UNRESOLVED_NAME
std.io.Missing          -> known module prefix, missing item, NAME_UNRESOLVED_NAME
missing.io.Writer       -> noModulePrefix, NAME_UNRESOLVED_MODULE
Packet.value            -> qualifier resolves but has no enum/member namespace, NAME_QUALIFIER_NOT_OWNER
LocalType.io.Writer     -> first segment resolves as item where module is required, NAME_QUALIFIER_NOT_MODULE
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/type-reference-resolver.test.ts
```

### Task 16: Implement Expression And Statement Name Resolution

**Wave:** 4

**Dependencies:** Tasks 5, 9, 11, 12, 13, and 15

**Description:** Resolve value-position names, call callees, owner-explicit member names, deferred member references, requirements, and proof-relevant expression containers without assigning local variable IDs.

**Files:**

- Create: `src/semantic/names/expression-resolver.ts`
- Create: `tests/unit/semantic/names/expression-resolver.test.ts`

**Acceptance Criteria:**

- `src/semantic/names/expression-resolver.ts` exports exactly `ResolveExpressionsInput` and `resolveExpressions` from the interface contracts.
- Name expressions resolve parameters, functions, enum cases, images, and imported value items when found in scope.
- Direct call callees such as `volatile_load_u32(address)` resolve to `functionName` references when the callee is a known function.
- Missing direct function callees emit `NAME_UNRESOLVED_NAME`.
- Non-callee missing value names inside function bodies do not emit unresolved diagnostics because they may be `let` locals owned by HIR-facing local scope construction.
- Member access chains are flattened so `std.io.Writer.default` can resolve the module-qualified item first and then the member.
- Owner-explicit members such as `PacketKind.ping`, `Image.bootServices`, and `Console.write` resolve through `MemberNamespace`.
- If a member chain starts with a loaded module prefix and the item segment is missing, emit `NAME_UNRESOLVED_NAME` at the missing item segment span.
- If a member chain starts with no loaded module prefix and the first segment is not a resolvable owner item in scope, emit `NAME_UNRESOLVED_NAME` at the qualifier span.
- If the qualifier resolves but is not an item that owns the requested member namespace, emit `NAME_QUALIFIER_NOT_OWNER` at the qualifier span.
- If the owner exists but the member name is absent, emit `NAME_UNRESOLVED_MEMBER` at the member span.
- If the owner has multiple allowed members with the same name, emit `NAME_AMBIGUOUS_MEMBER` with candidates sorted by `CandidateDisplay`.
- Receiver-typed members such as `address.valid_for_read_u32` become deferred member references when the receiver resolves to a parameter or otherwise lacks a known owner item.
- `AttemptExpressionView` recursively resolves the attempted expression and optional alternative expression; it does not resolve a magic `Attempt` name.
- Function `requires` sections and validated-buffer `require` sections are walked.
- `take` expressions and bodies are walked; take aliases are not assigned IDs in this phase.
- `let` type annotations and initializer expressions are walked, but `let` binders are not assigned IDs.
- `if`, `while`, `for`, `match`, `loop`, `return`, `yield`, assignment, object literal, call arguments, type applications, unary/binary/comparison/equality, and else-requirement expressions are walked.

**Code Example:**

```wr
private platform fn volatile_load_u32(address: Address[u32]) -> u32
    requires address.valid_for_read_u32
    requires address.aligned_for_u32

fn read_status(address: Address[u32]) -> u32:
    volatile_load_u32(address)?
```

Expected behavior:

```text
Address                  -> typeName source type
u32                      -> typeName builtinType
address                  -> parameter reference
valid_for_read_u32       -> deferred member reference
aligned_for_u32          -> deferred member reference
volatile_load_u32        -> functionName source FunctionId
Attempt / "?" operation  -> no name reference; expression contents are walked
```

```wr
fn local_example() -> u32:
    let value = 1
    return value
```

Expected behavior:

```text
value in return -> no resolved reference and no NAME_UNRESOLVED_NAME diagnostic
```

Failure tests required:

```text
std.io.Missing.default  -> known module prefix, missing item, NAME_UNRESOLVED_NAME
UnknownOwner.value      -> no module prefix and no owner item, NAME_UNRESOLVED_NAME
helper.value            -> helper resolves to function, not owner, NAME_QUALIFIER_NOT_OWNER
PacketKind.missing      -> owner exists, missing enum case/member, NAME_UNRESOLVED_MEMBER
AmbiguousOwner.name     -> same allowed member name in two namespaces, NAME_AMBIGUOUS_MEMBER
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/expression-resolver.test.ts
```

### Task 17: Implement ResolveNames Orchestrator

**Wave:** 5

**Dependencies:** Tasks 12, 14, 15, and 16

**Description:** Wire the complete phase together as `resolveNames(input)` with stable traversal, merged reference tables, merged diagnostics, and deterministic results.

**Files:**

- Create: `src/semantic/names/name-resolver.ts`
- Create: `tests/unit/semantic/names/name-resolver.test.ts`

**Acceptance Criteria:**

- `src/semantic/names/name-resolver.ts` exports exactly `ResolveNamesInput`, `ResolveNamesResult`, and `resolveNames` from the interface contracts.
- `resolveNames` accepts exactly `ResolveNamesInput` from the design.
- The resolver builds module namespace, core type lookup, platform primitive lookup, member namespace, import scopes, module scopes, declaration scopes, and function scopes.
- Modules are walked in `ModuleId` order.
- CST references are walked in source order within each module.
- Import references, type references, expression references, deferred member references, platform bindings, builtin-shadow diagnostics, platform diagnostics, and unresolved/ambiguous diagnostics are all merged.
- Output references are sorted by key order.
- Output deferred members are sorted by key order.
- Output platform bindings are sorted by function ID order.
- Output diagnostics are sorted with `sortNameResolutionDiagnostics`, using `ModuleId`, span, diagnostic order kind, ordinal, code, and message.
- `resolveNames` does not aggregate lexer, parser, or item-index diagnostics.

**Code Example:**

```ts
const itemIndexResult = buildItemIndex({ graph });
const nameResult = resolveNames({
  graph,
  index: itemIndexResult.index,
  coreTypes: CoreTypeCatalog.default(),
  platformPrimitiveNames: platformPrimitiveNameCatalog([
    { primitiveId: platformPrimitiveId("volatile_load_u32"), name: "volatile_load_u32" },
  ]),
});

expect(nameResult.diagnostics).toEqual([]);
expect(nameResult.platformBindings.entries()).toHaveLength(1);
expect(
  nameResult.references.entries().some((entry) => entry.reference.kind === "builtinType"),
).toBe(true);
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/unit/semantic/names/name-resolver.test.ts
```

### Task 18: Add Public API, Integration Tests, Determinism Tests, And Final Cleanup

**Wave:** 6

**Dependencies:** All prior tasks

**Description:** Export the new name-resolution API, update integration tests, prove determinism across shuffled inputs, and run the full project handoff check.

**Files:**

- Create: `src/semantic/names/index.ts`
- Modify: `src/semantic/index.ts`
- Modify: `tests/integration/semantic/public-api.test.ts`
- Create: `tests/integration/semantic/name-resolution.test.ts`
- Create: `tests/integration/semantic/name-resolution-determinism.test.ts`

**Acceptance Criteria:**

- `resolveNames`, `CoreTypeCatalog`, `platformPrimitiveNameCatalog`, reference/result types, diagnostics, and `MemberNamespace` APIs are exported from `src/semantic/names/index.ts`.
- The top-level semantic barrel re-exports name-resolution APIs.
- Integration tests cover:
  - project module importing another project module
  - project module importing vendored `std` source by ordinary path
  - replacement stdlib source at the same ordinary path
  - source module declaring freestanding `platform fn` that binds to a target primitive
  - stdlib-like source wrapping the same target primitive as project code
  - class/image methods wrapping freestanding platform functions without special trust
  - method-shaped and local `platform fn` declarations rejected for primitive binding
  - ambiguous imports from two modules
  - unresolved module path
  - names inside `Attempt`, requirements, validated-buffer sections, and `take` bodies
  - absence of local-variable diagnostics for `let` references
- Determinism tests build equivalent graphs with shuffled module order and shuffled platform primitive catalog entries; diagnostics, reference summaries, deferred members, and platform bindings are byte-for-byte stable.
- `rg "Intrinsic" src tests` has no matches.
- Full handoff command passes.

**Code Example:**

```ts
import {
  buildItemIndex,
  CoreTypeCatalog,
  platformPrimitiveNameCatalog,
  resolveNames,
} from "../../../src/semantic";

const graph = parseModuleGraphForTest([
  ["app/main.wr", "use Writer from std.io\nfn main(writer: Writer)\n"],
  ["std/io.wr", "class Writer:\n"],
]);
const indexResult = buildItemIndex({ graph });
const nameResult = resolveNames({
  graph,
  index: indexResult.index,
  coreTypes: CoreTypeCatalog.default(),
  platformPrimitiveNames: platformPrimitiveNameCatalog([]),
});

expect(nameResult.diagnostics).toEqual([]);
```

Determinism summary shape:

```ts
function summarize(result: ResolveNamesResult): unknown {
  return {
    references: result.references.entries(),
    deferredMembers: result.references.deferredMembers(),
    platformBindings: result.platformBindings.entries(),
    diagnostics: result.diagnostics.map((diagnostic) => ({
      code: diagnostic.code,
      source: diagnostic.source.name,
      span: diagnostic.span,
      message: diagnostic.message,
    })),
  };
}
```

**Commands:**

```bash
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/integration/semantic/name-resolution.test.ts
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/integration/semantic/name-resolution-determinism.test.ts
PATH="/Users/ryanwible/.bun/bin:$PATH" bun test ./tests/integration/semantic/public-api.test.ts
PATH="/Users/ryanwible/.bun/bin:$PATH" bun run format
PATH="/Users/ryanwible/.bun/bin:$PATH" bun run agent:check
```

## Final Verification Checklist

- [ ] `PATH="/Users/ryanwible/.bun/bin:$PATH" bun run format`
- [ ] `PATH="/Users/ryanwible/.bun/bin:$PATH" bun run agent:check`
- [ ] `rg "Intrinsic" src tests` has no runtime/test matches
- [ ] `resolveNames` exports from `src/semantic`
- [ ] Vendored stdlib source resolves only by ordinary module path
- [ ] Freestanding `platform fn` binds by simple target primitive name
- [ ] Method/local `platform fn` does not bind and receives a diagnostic
- [ ] Proof-sensitive syntax is walked for ordinary references without treating proof operations as names
