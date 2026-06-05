# Name Resolution Design

## Purpose

Name resolution is the semantic phase after the item index. It turns
source-shaped names from CST/AST views into stable compiler references:
modules resolve to `ModuleId`s, declarations resolve to `ItemId`s, functions,
types, images, fields, enum cases, image devices, parameters, and type
parameters resolve to their existing semantic IDs, and unresolved or ambiguous
names become deterministic diagnostics.

This phase is also where module-qualified source paths become ordinary module
references. The standard library is not a special semantic root: if a project
vendors stdlib source under a path such as `std/`, then `std.io` is just the
loaded module path `std/io.wr`. Replacing the stdlib means changing source files
at ordinary module paths, not granting a different trust level.

Compiler primitives are different from stdlib source, but they are not ambient
source names. The selected target exposes a platform primitive catalog. Source
reaches a primitive by declaring a freestanding `platform fn` whose simple name
matches one primitive in that catalog. Calls still resolve to the source
`FunctionId`; the platform binding tells later lowering which compiler
primitive backs that function. The declaration is not trusted merely because it
uses the `platform` modifier. Later semantic phases must certify the source
signature and visible requirements against the target catalog before the binding
can reach HIR; proof phases consume the certified catalog contract. Name
resolution receives only the names-and-IDs view of the target catalog.

Name resolution does not decide whether code is safe. It only decides what a
name denotes and records enough context for later type checking, image graph
checking, HIR lowering, and proof phases to make their own decisions without
re-walking syntax.

## Goals

- Resolve import module paths and imported names.
- Resolve module-qualified names such as `std.io.Writer`.
- Build deterministic declaration scopes for modules, type declarations,
  functions, function bodies, parameters, type parameters, fields, enum cases,
  and image device fields.
- Resolve type names, function names, field names, enum cases, and image device
  names to semantic IDs.
- Bind freestanding `platform fn` declarations to target-selected compiler
  primitives by matching simple names.
- Keep source modules and stdlib modules semantically equal after graph
  construction.
- Produce deterministic unresolved-name and ambiguous-name diagnostics.
- Preserve source spans and syntax coordinates for every resolved or failed
  reference.
- Keep filesystem access, module graph resolution, and target selection outside
  this phase.

## Non-Goals

- This phase does not read files, discover imports, or decide where vendored
  stdlib source lives.
- This phase does not assign `ItemId`s, `TypeId`s, `FunctionId`s, `FieldId`s, or
  other declaration IDs. The item index owns ID assignment.
- This phase does not typecheck signatures or expressions.
- This phase does not infer receiver types for member access. It builds
  deterministic member tables and resolves owner-explicit member names; type
  checking and HIR lowering complete type-directed member references through
  the same tables.
- This phase does not resolve `let` bindings or other block-local variables.
  HIR-facing local scope construction owns local IDs and local reference
  binding.
- This phase does not lower or prove proof-relevant language operations such as
  `Attempt`, validation, `take`, terminal discharge, private-state threading, or
  obligation closure. It preserves the names inside those constructs that have
  ordinary name-shaped syntax; HIR and Proof MIR own the operations themselves.
- This phase does not decide whether a caller is allowed to use a platform
  primitive, and it does not certify that a platform function is safe.
  Platform function signatures and contracts are checked against the target
  primitive catalog later.
- This phase does not provide an implicit prelude or automatic `std` imports.
  Any prelude should be a separate language feature with explicit rules.
- This phase does not implement incremental name resolution.

## Repository Shape

```text
src/
  semantic/
    names/
      index.ts
      core-types.ts
      diagnostics.ts
      reference.ts
      scope.ts
      scope-builder.ts
      module-namespace.ts
      member-namespace.ts
      platform-binding.ts
      import-resolver.ts
      name-resolver.ts
      resolution-result.ts

tests/
  support/
    semantic/
      name-resolution-fakes.ts

  unit/
    semantic/
      names/
        scope.test.ts
        module-namespace.test.ts
        member-namespace.test.ts
        platform-binding.test.ts
        import-resolver.test.ts
        diagnostics.test.ts
        name-resolver.test.ts

  integration/
    semantic/
      name-resolution.test.ts
      name-resolution-determinism.test.ts
      public-api.test.ts
```

`src/semantic/names` may depend on `frontend/ast`,
`frontend/module-graph-parser`, `semantic/ids`, `semantic/item-index`, and
shared diagnostics. It must not depend on filesystem APIs, Bun APIs, target
backends, HIR, MIR, proof checking, code generation, or package manifest
parsing.

Module graph resolution and target selection are compiler-edge concerns. The
compiler edge loads reachable source modules and passes the selected target's
platform primitive name catalog to name resolution.

## Public API

Name resolution is exported from `src/semantic/names/index.ts` and re-exported
from the semantic barrel:

```ts
import { buildItemIndex, resolveNames } from "./src/semantic";

const itemIndexResult = buildItemIndex({
  graph: parsedModuleGraph,
});

const nameResult = resolveNames({
  graph: parsedModuleGraph,
  index: itemIndexResult.index,
  coreTypes: CoreTypeCatalog.default(),
  platformPrimitiveNames: selectedTarget.platformPrimitiveNames,
});
```

The phase returns a pure result:

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

export function resolveNames(input: ResolveNamesInput): ResolveNamesResult;
```

`resolveNames` does not combine lexer, parser, or item-index diagnostics. The
caller owns diagnostic aggregation and source-order presentation across phases.

## Module Paths And Vendored Stdlib

The module graph resolver owns path-based module resolution. It maps import
syntax such as `std.io` to a `ModulePath` such as `std/io.wr`, reads that source
through the injected file repository, and records the reachable parsed modules.
Name resolution consumes only the parsed graph and item index.

This keeps stdlib resolution ordinary. A project can vendor source like this:

```text
project/
  app/
    image.wr
  std/
    io.wr
    memory.wr
```

In that project, `use Writer from std.io` is just a path-based import of
`std/io.wr`. A replacement stdlib is a different set of source files at ordinary
module paths. If `std/io.wr` is absent, the module graph edge reports the same
missing-module diagnostic it would report for any other missing source module.

Name resolution may still resolve qualified references such as `std.io.Writer`,
but it does so by looking for a loaded module whose path corresponds to
`std.io`, then looking for `Writer` in that module's top-level item set. It does
not know whether the file came from a default stdlib, a local fork, or project
source.

## Core Builtin Types

Core scalar and control-flow types are language builtins, not stdlib prelude
imports and not source items. Name resolution receives a small `CoreTypeCatalog`
from semantic support and resolves these names in type position before looking
in ordinary source scopes:

```ts
export type CoreTypeId = string & { readonly __brand: "CoreTypeId" };

export interface CoreTypeSpec {
  readonly id: CoreTypeId;
  readonly name: string;
}

export interface CoreTypeCatalog {
  readonly types: readonly CoreTypeSpec[];
}
```

The initial catalog should include:

```text
bool
u8
u16
u32
u64
usize
Never
```

These names are not lexer keywords. They are ordinary identifier tokens that
have a special type-position resolution rule. Source modules cannot shadow a
core builtin type in type position; attempting to declare a type with the same
name should be rejected by a semantic duplicate/builtin-name diagnostic before
type checking.

This rule is narrower than an implicit prelude. It does not import `Result`,
`Option`, `List`, `Map`, `Address`, `ReadableBuffer`, or target-specific
handles. Those are ordinary source declarations unless a later design
introduces explicit platform type declarations.

## Proof-Relevant Constructs

Some proof-critical language constructs contain names, but the constructs are
not themselves resolved as names. Name resolution handles only the
source-shaped references inside them and leaves the operation semantics to
later phases.

Examples:

```text
Attempt / `?`
  resolve callee, type names, parameters, and fields used by the expression
  HIR records the fallible consumption shape
  Proof MIR checks success/error resource convergence

validated-buffer validation
  resolve the validated-buffer type, parameter names, field names, and
  requirement expression references
  HIR records the validation source/output relationship
  Proof MIR checks single-use validation and Ok/Err resource splits

take
  resolve the stream or buffer expression and terminal functions called inside
  the body
  HIR records opened sessions, yielded member brands, and obligations
  Proof MIR checks closure on every exit path

terminal calls
  resolve the callee function like any other function name
  image/terminal graph checking proves terminal reachability
  Proof MIR checks terminal closure and no leaked proof/resource state

private-state calls and predicate facts
  resolve the receiver, predicate names, and requirement references
  HIR records private-state generation transitions and fact origins
  Proof MIR rejects stale facts after state advancement
```

If a word such as `Attempt` or `Validation` appears as an ordinary source type
name, it follows the normal type-name rules: core builtin type first, then
source scopes. The proof operation is not smuggled in by name lookup. This
keeps the proof model explicit in HIR/Proof MIR rather than hidden behind a
stdlib or prelude binding.

## Reference Model

Every resolved name records its source location, lookup kind, and target ID.
References are keyed by syntax coordinates rather than by red-node object
identity because repeated red-tree navigation may allocate distinct wrappers for
the same CST node.

```ts
export interface SyntaxReferenceKey {
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
  readonly kind: NameReferenceKind;
  readonly ordinal: number;
}

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

`ordinal` disambiguates rare cases where recovery or compact syntax produces
more than one reference with the same module, span, and kind. It is assigned as
the zero-based count of earlier references with the same `(moduleId, span,
kind)` during the resolver's stable traversal. Consumers must not hand-roll this
key. The name-resolution package should expose the same `ReferenceKeyBuilder`
used by the resolver so HIR lowering can derive keys while walking AST views.

The reference table stores declaration-like targets as `ItemId`s. It stores
field-like targets as `FieldId`s plus their owning `ItemId` because fields,
validated-buffer layout fields, and image devices are not item records in the
current item-index model.

```ts
export interface ResolvedReferenceEntry {
  readonly key: SyntaxReferenceKey;
  readonly reference: ResolvedReference;
}

export interface ResolvedReferences {
  get(key: SyntaxReferenceKey): ResolvedReference | undefined;
  entries(): readonly ResolvedReferenceEntry[];
  deferredMembers(): readonly DeferredMemberReference[];
}

export type ResolvedReference =
  | { readonly kind: "module"; readonly moduleId: ModuleId }
  | { readonly kind: "item"; readonly itemId: ItemId }
  | { readonly kind: "type"; readonly itemId: ItemId; readonly typeId: TypeId }
  | { readonly kind: "builtinType"; readonly coreTypeId: CoreTypeId }
  | {
      readonly kind: "function";
      readonly itemId: ItemId;
      readonly functionId: FunctionId;
    }
  | { readonly kind: "image"; readonly itemId: ItemId; readonly imageId: ImageId }
  | { readonly kind: "field"; readonly ownerItemId: ItemId; readonly fieldId: FieldId }
  | { readonly kind: "typeParameter"; readonly owner: TypeParameterOwner; readonly index: number }
  | { readonly kind: "parameter"; readonly parameterId: ParameterId };

export interface DeferredMemberReference {
  readonly key: SyntaxReferenceKey;
  readonly receiverExpressionKey: SyntaxReferenceKey | undefined;
  readonly memberName: string;
  readonly memberSpan: SourceSpan;
  readonly allowedNamespaces: readonly MemberNamespaceKind[];
}
```

The key kind describes the syntax position; the value kind describes the
semantic target. The mapping is deliberately not one-to-one:

| Reference key kind    | Possible resolved values                        |
| --------------------- | ----------------------------------------------- |
| `importModule`        | `module`                                        |
| `importedItem`        | `item`, `type`, `function`, `image`             |
| `moduleQualifiedItem` | `item`, `type`, `function`, `image`             |
| `typeName`            | `builtinType`, `type`, `typeParameter`          |
| `functionName`        | `function`                                      |
| `imageName`           | `image`                                         |
| `fieldName`           | `field`                                         |
| `enumCase`            | `item`                                          |
| `imageDevice`         | `field`                                         |
| `memberName`          | `field`, `function`, `item`, or deferred member |
| `typeParameter`       | `typeParameter`                                 |
| `parameter`           | `parameter`                                     |

`importedItem` and `moduleQualifiedItem` use the most specific value variant
available from the item index. For example, importing a class-like declaration
returns `type`, importing a function returns `function`, importing an image
returns `image`, and importing an enum case returns `item`. Later phases can
always fall back to the `itemId` carried by specific item-backed variants.

Unresolved references are not encoded as fake IDs. They appear only in
diagnostics. Later phases must ask `ResolvedReferences` for a reference and
handle absence explicitly.

Platform primitive bindings are keyed by source `FunctionId`, not by expression
references. Name resolution receives only primitive names and IDs:

```ts
export type PlatformPrimitiveId = string & { readonly __brand: "PlatformPrimitiveId" };

export interface PlatformPrimitiveNameCatalog {
  readonly primitives: readonly PlatformPrimitiveNameSpec[];
}

export interface PlatformPrimitiveNameSpec {
  readonly primitiveId: PlatformPrimitiveId;
  readonly name: string;
}

export interface PlatformPrimitiveBinding {
  readonly itemId: ItemId;
  readonly functionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
}

export interface ResolvedPlatformBindings {
  get(functionId: FunctionId): PlatformPrimitiveBinding | undefined;
  entries(): readonly PlatformPrimitiveBinding[];
}
```

The primitive name is a simple identifier, not a dotted path. If a family needs
disambiguation, the catalog bakes that into the identifier, such as
`memory_volatile_load_u32` or `aarch64_dmb_ish`.

`PlatformPrimitiveBinding` is a name-resolution artifact only. It says that a
source `FunctionId` has the same simple name as one selected-target primitive.
It is not a proof certificate. Semantic surface checking must turn it into a
certified semantic-surface binding by proving that the source declaration
matches the primitive's full target catalog signature and proof contract. HIR
and Proof MIR consume only certified semantic-surface bindings.

## Namespace Model

Name resolution uses separate namespaces so a spelling can be legal in one
context and invalid in another.

```text
module namespace
  loaded source module path segments

type namespace
  type declarations and type parameters

value namespace
  functions, parameters, and enum cases in value positions

member namespace
  fields, image device fields, enum cases, and member functions by owner item
```

The item index supplies declarations. Name resolution arranges them into scopes:

```text
Module scope
  explicit named imports
  top-level items in the module

Declaration scope
  type parameters
  member functions
  fields
  enum cases
  image devices

Function signature scope
  function type parameters
  parameters

Function body scope
  nested functions from the item index
  parameters
  local names later exposed by HIR-facing scope construction
```

Lexical lookup uses priority tiers. Inner lexical scopes shadow outer lexical
scopes. Module declarations shadow explicit imports. If multiple candidates
exist in the same tier and namespace, lookup fails with an ambiguous-name
diagnostic. Once a higher-priority tier contains a single match, lower-priority
tiers are ignored.

This rule gives deterministic shadowing without making imported names globally
fragile:

```text
function type parameter
  shadows module type import

module declaration
  shadows imported declaration

two imports with the same name
  ambiguous unless a module or function-scope declaration shadows both
```

## Import Resolution

An import declaration has two independent resolutions:

1. Resolve the dotted module name against the loaded source module graph.
2. Resolve each imported name inside that target module's exportable top-level
   item set.

For syntax shaped like this:

```text
use Writer, Status from std.io
```

name resolution records:

```text
std.io      -> ModuleId
Writer      -> ItemId in that module
Status      -> ItemId in that module
```

Import module lookup is exact. The module path `std.io` must resolve to one
loaded source module. If the module is missing, the import gets a module
diagnostic and imported names from that declaration are skipped. Duplicate
loaded source module paths are reported by the item index as
`ITEM_DUPLICATE_MODULE`; name resolution assumes the caller still aggregates
that diagnostic and does not emit a second duplicate-module diagnostic.

Named imports bind only top-level exportable items from the target module.
Source items marked `private` are visible only within their own module.
Import declarations do not bind target primitive catalog entries directly. They
may bind a source-declared `platform fn`, because that declaration is an ordinary
source item with a `FunctionId`.

## Module-Qualified Names

Qualified names are resolved by context.

In source-module contexts, the resolver consumes the longest loaded source
module prefix and then resolves the final segment as an item inside that module:

```text
std.io.Writer
^^^^^^ module prefix
       ^^^^^^ item name
```

If more than one prefix could work, the longest prefix wins. This allows a
source tree to contain both `std.io` and `std.io.buffer` without ambiguity:

```text
std.io.Writer        -> item Writer in module std.io
std.io.buffer.Reader -> item Reader in module std.io.buffer
```

If the prefix resolves to a module but the terminal item does not exist, the
diagnostic is an unresolved item in a known module. If no prefix resolves to a
module, the diagnostic is an unresolved module path.

Longest-prefix resolution is intentionally module-first for source-module
contexts. If `std.io.buffer.Reader` could be interpreted either as item
`buffer` in module `std.io` followed by member `Reader`, or as item `Reader` in
module `std.io.buffer`, the loaded module prefix `std.io.buffer` wins. This
keeps module-qualified item lookup deterministic. Mixed item/member chains are
handled after the item reference is resolved:

```text
std.io.Writer.default
^^^^^^^^^^^^^ module-qualified item
              ^^^^^^^ member completed from owner Writer
```

If a program needs the item/member interpretation where a longer module prefix
also exists, it should use an aliasing import or a shorter owner-qualified name
that makes the owner item explicit in the local scope.

Qualified names may also denote owner-qualified members:

```text
PacketKind.ping
Image.bootServices
Console.write
```

For owner-qualified member references, the left side must resolve to an item
that owns the requested member namespace. The right side resolves through the
member table for that owner. If the owner is not known until a typed layer, the
resolver records a deferred member reference. Semantic surface checking
completes declaration-level deferred sites whose receiver owner is known from
checked signatures, constraints, platform surfaces, or image surfaces. HIR
lowering completes body-local deferred sites after it builds local scopes and
expression types. Both layers pass the owner `ItemId` back into the same member
table.

## Member Tables

The member namespace is built from item-index records:

```text
Type item
  fields
  member functions
  type parameters

Enum item
  enum cases

Image item
  fields
  image device fields
  member functions

Validated buffer item
  validated params
  layout fields
```

Field records keep their `FieldRole`, so lookup can distinguish ordinary fields
from image device fields without re-walking the CST:

```text
field          -> ordinary field access
imageDevice    -> device binding in an image declaration
validatedParam -> validated-buffer parameter field
layoutField     -> validated-buffer layout field
```

Owner-explicit member references are resolved during the CST-facing pass when
the owner name itself resolves to an item. Type-directed member references are
completed through this interface:

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
  | {
      readonly kind: "ambiguous";
      readonly candidates: readonly ResolvedReference[];
    };
```

This keeps the member lookup algorithm deterministic and central while letting
typed layers provide information that syntax alone cannot know. If
`allowedNamespaces` is omitted, the lookup searches every member namespace for
that owner. If more than one candidate remains, the result is ambiguous and the
caller emits `NAME_AMBIGUOUS_MEMBER` when the source context cannot narrow the
kind. If the source context expects only fields, functions, enum cases, or image
devices, the caller passes the relevant namespace subset.

Deferred member references are returned from
`ResolvedReferences.deferredMembers()` in stable source order. Semantic surface
checking resolves declaration-level sites by first determining the receiver
owner item, then calling `MemberNamespace.resolveMember`. HIR lowering uses the
same flow for body-local sites. A deferred site is therefore not silently
dropped: it is either completed into a normal `ResolvedReference` at a typed
layer or reported as unresolved/ambiguous with the original member span.

## Platform Functions And Target Primitives

The selected target exposes a platform primitive catalog. Each primitive has a
simple name, a signature, a proof contract, and a lowering contract. These
primitives are not source modules and do not receive `ModuleId`s or `ItemId`s.
Name resolution receives only the names-and-IDs projection of this catalog; the
full signatures, proof contracts, and lowering contracts are consumed later
when bindings are certified and lowered.

Source exposes a primitive by declaring a freestanding `platform fn` with the
same simple name:

```wr
use Address from std.memory

private platform fn volatile_load_u32(address: Address[u32]) -> u32
    requires address.valid_for_read_u32
    requires address.aligned_for_u32
```

Name resolution sees the `platform` modifier and binds this source function to
the selected target primitive named `volatile_load_u32`. The call surface stays
ordinary:

```wr
fn read_status(address: Address[u32]) -> u32:
    volatile_load_u32(address)
```

The call to `volatile_load_u32` resolves to the source function's `FunctionId`.
HIR lowering can then see that the callee function has a platform binding:

```text
FunctionId(17) -> PlatformPrimitiveId("volatile_load_u32")
```

Later phases use that binding:

```text
type checking
  checks the source platform fn signature against the primitive signature
  certifies an exact source/catalog contract match

proof checking
  checks call sites against the primitive proof contract from the catalog

lowering
  lowers calls through the primitive lowering contract
```

The low-trust rule is:

```text
trusted:
  selected target primitive catalog

not trusted:
  project source
  vendored stdlib source
  replacement stdlib source
  source platform fn declarations
  source wrappers around platform functions
```

The source declaration is a handle, not an authority. The target catalog owns
the real signature, required facts, consumed capabilities, produced
capabilities, effects, and lowering behavior. The first implementation should
require the source `platform fn` declaration to exactly mirror the catalog
signature and proof contract. A later checker may allow a source declaration to
state a provably stronger contract, but it must never allow source to weaken the
catalog contract.

Every accepted binding should have a small certificate:

```text
source FunctionId
  matches selected PlatformPrimitiveId by simple name
  has exact catalog signature
  has exact catalog required facts/capability effects
```

Calls to a certified platform function are checked as calls to the catalog
primitive. Source-written `requires` clauses are visible documentation and
ordinary call-site obligations, but they are not the trust root. If source omits
or weakens a primitive requirement, the declaration is rejected before HIR, and
Proof MIR still gets obligations from the catalog contract.

No source syntax may call a target primitive directly, and no import may bind a
primitive catalog entry directly:

```wr
use volatile_load_u32 from intrinsics.memory  // invalid
intrinsic volatile_load_u32(address)          // invalid
```

If source wants a friendlier or more domain-specific API, stdlib code wraps the
`platform fn` in ordinary source and exports that wrapper through normal module
imports. The wrapper is not trusted; it typechecks and proves obligations like
any other source function.

Freestanding platform declarations may appear in any source module. There is no
stdlib privilege. Multiple modules may declare source handles for the same
primitive, and each handle receives its own `FunctionId`; each declaration must
independently certify against the same target catalog entry. Normal duplicate
declaration rules still apply within a single lexical scope.

In v1, target-bound platform functions are freestanding only. A class, image,
interface, or local function may wrap a freestanding platform function, but a
method-shaped `platform fn` does not bind directly to a target primitive:

```wr
class Register32:
    address: Address[u32]

    fn load(self) -> u32
        requires self.address.valid_for_read_u32
        requires self.address.aligned_for_u32:
            volatile_load_u32(self.address)
```

This wrapper is ordinary source. Its proof obligations are checked normally,
and the call inside the wrapper uses the certified freestanding primitive.

A later language version may allow method-shaped platform declarations only if
they desugar to a freestanding primitive call with the receiver as the first
argument. The primitive catalog should still use globally unique simple names
such as `volatile_load_u32` or `aarch64_dmb_ish`, not method-local names such as
`load` or dotted intrinsic paths.

A `platform fn` that is missing from the catalog, has the wrong signature, has
a non-exact visible proof contract, or appears in a non-freestanding
target-bound position receives a semantic diagnostic. Name resolution owns only
the name-to-primitive binding; semantic surface checking owns certification and
contract compatibility, and proof phases own call-site entailment.

## Diagnostics

Name-resolution diagnostics are deterministic by construction. The resolver
sorts all diagnostic output by stable source order, then diagnostic code, then
stable reference kind. Stable source order means `ModuleId` order, then span
start, span end, reference kind, and reference ordinal. Candidate lists inside
messages are sorted by module path, item kind, item name, and dense ID.

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
  | "NAME_PRIVATE_IMPORT";
```

Representative diagnostics:

```text
NAME_UNRESOLVED_MODULE
  Cannot resolve module 'std.io'.

NAME_UNRESOLVED_IMPORT
  Module 'std.io' has no exported item named 'Writer'.

NAME_AMBIGUOUS_NAME
  Name 'Status' is ambiguous between std.io.Status and app.status.Status.

NAME_PRIVATE_IMPORT
  Item 'Secret' is private to module 'std.crypto'.

NAME_UNKNOWN_PLATFORM_PRIMITIVE
  No selected platform primitive named 'volatile_load_u32'.
```

Diagnostics use the narrowest useful source span:

- missing module root: the first segment of the module name
- unresolved module suffix: the whole dotted module path
- unresolved imported item: the imported name token
- unresolved type/function name: the name or qualified-name span
- unresolved member: the member name segment
- unknown platform primitive: the platform function name token
- ambiguous name: the name segment shared by all candidates

Malformed CST nodes remain navigable. If an AST accessor returns `undefined`
because a token is missing, name resolution skips that specific reference unless
there is a present token span where a useful diagnostic can be attached.

## Determinism Rules

All name-resolution tables are built from stable item-index arrays and stable
source coordinates:

1. Build source module namespaces from `ItemIndex.modules()` in `ModuleId`
   order. Use the parsed graph only to retrieve each module's CST by stable
   path key.
2. Build core builtin type lookup tables from `CoreTypeCatalog.types`, sorted
   by builtin name, then `CoreTypeId`.
3. Build platform primitive lookup tables from `PlatformPrimitiveNameCatalog`,
   sorted by primitive name, then primitive ID. The catalog must already be
   validated for duplicate names and IDs before name resolution runs. Only
   freestanding source `platform fn` declarations are candidates for primitive
   binding in v1.
4. Build source item scopes from source-origin item records in
   `ItemIndex.items()` dense-ID order.
5. Build member scopes from `ItemIndex.fields()`, `ItemIndex.functions()`,
   `ItemIndex.images()`, and parent item IDs in dense-ID order.
6. Build import scopes in stable source order within each module.
7. Resolve references by walking modules in `ModuleId` order, then CST source
   order within each module.
8. Sort `ResolvedReferences.entries()` by key order: `moduleId`, span start,
   span end, reference kind, and ordinal.
9. Sort deferred member references by their key order.
10. Sort platform bindings by source `FunctionId`, then `ItemId`, then
    `PlatformPrimitiveId`.
11. Sort diagnostics before returning them.

If two candidates tie on every user-facing property, the dense semantic ID is
the final tie-break. This is acceptable because the item index already defines
those IDs deterministically for the same parsed module graph.

## Layer Boundaries

```text
ParsedModuleGraph
  + ItemIndex
  + CoreTypeCatalog
  + PlatformPrimitiveNameCatalog
    -> NameResolution
      -> ResolvedReferences
      -> ResolvedPlatformBindings
      -> NameResolutionDiagnostic[]
```

Name resolution consumes AST views but does not mutate CST nodes or item-index
records. Later phases consume `ResolvedReferences`:

```text
semantic surface checking
  uses resolved type/function/image references, checks source signatures and
  resource kinds, certifies exact source/catalog platform contracts, validates
  the selected image root, and completes declaration-level deferred members

HIR lowering
  stores ItemId, TypeId, FunctionId, FieldId, ImageId, ParameterId, and
  TypeParameterOwner references instead of source text names, and emits platform
  primitive contract edges only from certified platform bindings. It also
  completes body-local deferred members after local scopes and expression types
  are known.

proof and lowering
  consume HIR/MIR references and catalog-owned platform primitive contracts, not
  source path names or source-written platform contracts
```

The important boundary is that stdlib source receives no semantic privilege.
Once vendored stdlib source has loaded as modules and items, it is just another
set of source modules.

## Testing Strategy

Unit tests should cover:

- path-based source module lookup for vendored stdlib modules
- module-prefix lookup and longest-prefix behavior
- import module resolution and imported-item binding
- private source item import rejection
- lexical scope shadowing and same-tier ambiguity
- type namespace versus value namespace lookup
- core builtin type-name resolution and rejection of source builtin shadowing
- no local-variable resolution in this phase
- key-to-value mapping for imports, type names, function names, enum cases, and
  images
- `ReferenceKeyBuilder` ordinal assignment for same-span recovery cases
- `ResolvedReferences` lookup, stable entry ordering, and deferred-member
  enumeration
- field, enum-case, and image-device member table lookup
- member lookup across all namespaces, including ambiguous field/function names
- platform function binding through selected platform primitive name catalogs
- platform binding remains name-only until later exact source/catalog
  certification
- rejection or later semantic diagnostics for method-shaped and local
  target-bound `platform fn` declarations in v1
- rejection of import-based primitive lookup
- rejection of direct primitive-call syntax if such syntax appears in recovered
  CST
- diagnostic code, span, message, and candidate ordering
- malformed syntax that omits name tokens

Integration tests should parse small module graphs and assert resolved IDs:

- project module importing another project module
- project module importing vendored `std` source by ordinary path
- replacement stdlib source at the same ordinary path
- source module declaring a `platform fn` that binds to a target primitive
- stdlib-like source module wrapping the same target primitive as project code
- ordinary class/image methods wrapping freestanding platform functions without
  receiving special trust
- ambiguous imports from two modules
- unresolved module path

Determinism tests should build equivalent graphs with shuffled module order,
shuffled platform primitive name catalog entries, and shuffled import
declaration order where the language permits it. The resulting diagnostics,
resolved reference entries, deferred member references, platform bindings, and
resolved reference summaries must be byte-for-byte stable for semantically
equivalent inputs.

Tests use fakes through dependency injection. They do not use mocks, spies,
filesystem reads, or runtime dependencies. `fast-check` may fuzz scope and
diagnostic ordering in tests only.

## Existing Paradigm Refactors

The current item-index implementation already supports an `IntrinsicCatalog`,
`IntrinsicModuleSpec`, `IntrinsicItemRecord`, intrinsic-origin module records,
and intrinsic-origin parameter records. That was useful scaffolding, but it no
longer matches the source model.

The implementation should be refactored as follows:

- Replace item-index `IntrinsicCatalog` input with a names-only
  `PlatformPrimitiveNameCatalog` for name resolution. Full target primitive
  signatures, proof contracts, and lowering contracts are consumed by later
  certification/proof/lowering phases.
- Replace `IntrinsicId` with `PlatformPrimitiveId` for target primitive
  lowering keys.
- Remove `IntrinsicModuleSpec`; target primitives are not modules and do not
  have `pathKey` or `display` module paths.
- Remove intrinsic-origin `ModuleRecord`s. `ItemIndex.modules()` should describe
  loaded source modules only.
- Remove intrinsic-origin `ItemRecord`s, `TypeRecord`s, `FunctionRecord`s, and
  `ParameterRecord`s from the item index. Target primitives are catalog entries,
  not source items.
- Preserve `platform` as a source function modifier. Source `platform fn`
  declarations keep ordinary source `ItemId`s, `FunctionId`s, parameters,
  source spans, and visibility rules.
- Add a name-resolution result table that binds source `FunctionId`s for
  freestanding platform functions to `PlatformPrimitiveId`s. Treat this as a
  name-only binding until later semantic phases certify the signature and proof
  contract against the target catalog.
- Add declaration-legality diagnostics for method-shaped or local target-bound
  `platform fn` declarations in v1. Ordinary methods may still wrap certified
  freestanding platform functions.
- Remove diagnostics that compare source module paths against intrinsic module
  paths, such as source modules shadowing intrinsic modules.
- Replace duplicate intrinsic-module diagnostics with target primitive catalog
  validation diagnostics for duplicate primitive names or IDs.
- Replace tests that build fake intrinsic modules with fake platform primitive
  catalogs and source `platform fn` declarations.
- Keep deterministic target primitive catalog summaries in tests so duplicate
  diagnostics and binding order remain stable without depending on item-index
  serialization helpers.

Source-visible opaque platform types should also be revisited under this model.
If a type is visible to Wrela source, prefer declaring it as ordinary vendored
source or as a future explicit platform type declaration with source spans and
normal name resolution. If a type exists only to describe primitive contracts,
keep it inside the platform primitive catalog and do not allocate a source item
ID for it.

## Implementation Notes

The first implementation can stay narrow:

1. Add diagnostic types, reference keys, and result containers.
2. Replace intrinsic catalog/module records with names-only platform primitive
   catalog support for name resolution.
3. Add core builtin type catalog support.
4. Build source module namespaces.
5. Resolve import module paths.
6. Resolve imported top-level items.
7. Build lexical declaration scopes for modules and type/function signatures.
8. Bind freestanding `platform fn` declarations to selected target primitives
   by simple name.
9. Resolve type names and owner-explicit function names.
10. Build member tables for fields, enum cases, image devices, and member
    functions.
11. Add the HIR-facing member-resolution API and deferred-member result table.
12. Add platform-primitive binding integration tests.
13. Add determinism tests and public-barrel exports.

Each step should keep the runtime dependency-free and use direct unit tests
while iterating. The handoff check is `bun run agent:check`.
