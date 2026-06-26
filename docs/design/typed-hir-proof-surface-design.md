# Typed HIR And Proof-Relevant Surface Design

## Purpose

Typed HIR is the compiler phase after semantic surface checking and before
whole-image monomorphization. It lowers the loaded parsed source graph from AST
views into a typed, source-origin-preserving representation that is simpler
than CST/AST, but still source-shaped enough to explain diagnostics and retain
proof-relevant language meaning.

For Wrela, HIR is also the last layer that fully understands proof-relevant
source constructs before control-flow normalization. It must preserve `take`,
`requires`, validation, attempt, terminal calls, private-state transitions,
image/device origins, predicate facts, `ensure` facts, receiver modes, resource
kinds, and certified platform primitive contract edges as explicit compiler
data. Later phases instantiate and check that data; they should not have to
reverse-engineer it from ordinary calls, fields, or booleans.

HIR is not a proof checker. It assigns stable source-scoped IDs, records typed
operations and origins, and makes the proof surface explicit enough for
monomorphization, layout, and Proof MIR to prove path-sensitive properties.

In this document, "stable ID" means deterministic for the same parsed module
graph and checked semantic surface. It does not mean persistent across source
edits or incremental rebuilds.

## Goals

- Lower source AST views to typed HIR while preserving source spans, syntax
  origins, semantic IDs, and diagnostic context.
- Consume `CheckedSemanticProgram`, `CheckedImageSeed`, completed member
  references, certified platform bindings, and proof-surface seeds from
  semantic surface checking.
- Lower function bodies, validated-buffer declarations, image roots, image
  devices, field accesses, calls, assignments, and source control-flow
  constructs into regular typed HIR nodes.
- Preserve proof-relevant constructs as distinct HIR operations, including
  `take`, `requires`, validation, attempt, terminal calls, private-state
  transitions, predicate facts, `ensure` facts, and image/device origins.
- Assign stable obligation, session, brand, resource-place, validation,
  attempt, private-state transition, fact-origin, and call-site requirement IDs.
- Retain resource kinds, parameter modes, receiver modes, return resource
  kinds, field kinds, generic signatures, and certified platform primitive
  contract edges.
- Make field-sensitive receiver access explicit enough for later place and loan
  tracking, including whole-receiver and field receiver places.
- Keep diagnostics source-level by attaching source spans and HIR origins to
  every lowered proof-relevant operation.
- Produce deterministic HIR tables and deterministic diagnostics.
- Keep filesystem access, target selection, package loading, monomorphization,
  layout, Proof MIR, proof checking, code generation, and binary emission
  outside this phase.

## Non-Goals

- This phase does not parse source files, discover imports, load modules, or
  read the filesystem.
- This phase does not assign module, item, type, function, image, field, or
  parameter IDs. Earlier phases own those IDs.
- This phase does not perform name resolution. It consumes the
  `ResolvedReferences` table from name resolution plus member completions from
  semantic surface checking.
- This phase does not validate type-reference syntax, generic parameter
  declarations, generic bound declarations, function signatures, platform
  declaration legality, image root selection, image device legality, or
  platform primitive certification. Semantic surface checking owns those
  checks. HIR may still check a call-site instantiation against already-checked
  bounds when lowering a typed call.
- This phase does not instantiate generics or compute whole-image call-graph
  reachability. Monomorphization owns closed-image instantiation and pruning.
- This phase does not compute representation size, alignment, field offsets,
  ABI facts, or validated-buffer layout facts. Layout owns those facts.
- This phase does not prove moves, consumes, loans, `take` closure, terminal
  closure, stale-fact rejection, branch convergence, validation/attempt
  convergence, or `requires` discharge. Proof MIR owns path-sensitive checks.
- This phase does not lower platform primitives to target instructions, firmware
  ABI calls, generated entry thunks, or backend-specific IR.
- This phase does not give stdlib source special authority. Project source,
  vendored stdlib source, and replacement stdlib source lower through the same
  HIR rules.
- This phase does not implement incremental compilation.

## Repository Shape

```text
src/
  hir/
    index.ts
    ids.ts
    origin.ts
    hir.ts
    hir-table.ts
    lowering-context.ts
    reference-lookup.ts
    typed-hir-builder.ts
    diagnostics.ts
    deterministic-sort.ts
    brand-registry.ts
    constructibility.ts
    body-lowerer.ts
    expression-lowerer.ts
    statement-lowerer.ts
    generic-inference.ts
    generic-substitution.ts
    local-scope.ts
    place.ts
    call-lowerer.ts
    call-proof-metadata.ts
    requirement-lowerer.ts
    take-lowerer.ts
    attempt-lowerer.ts
    validation-lowerer.ts
    fact-lowerer.ts
    proof-metadata.ts
    image-lowerer.ts
    validated-buffer-lowerer.ts

tests/
  support/
    hir/
      typed-hir-fakes.ts
      typed-hir-fixtures.ts

  unit/
    hir/
      ids.test.ts
      origin.test.ts
      lowering-context.test.ts
      reference-lookup.test.ts
      place.test.ts
      local-scope.test.ts
      expression-lowerer.test.ts
      generic-inference.test.ts
      constructibility.test.ts
      statement-lowerer.test.ts
      call-lowerer.test.ts
      call-proof-metadata.test.ts
      requirement-lowerer.test.ts
      take-lowerer.test.ts
      attempt-lowerer.test.ts
      validation-lowerer.test.ts
      fact-lowerer.test.ts
      proof-metadata.test.ts
      image-lowerer.test.ts
      validated-buffer-lowerer.test.ts
      diagnostics.test.ts
      typed-hir-fixtures.test.ts

  integration/
    hir/
      declaration-lowering.test.ts
      typed-hir-fixtures.test.ts
      lower-typed-hir-orchestration.test.ts
      typed-hir-proof-integration.test.ts
      typed-hir-determinism.test.ts
      proof-surface-completeness.test.ts
      public-api.test.ts
```

`src/hir` may depend on `frontend/ast`, `frontend/module-graph-parser`,
`semantic/ids`, `semantic/item-index`, `semantic/names` reference keys,
`semantic/surface`, and shared diagnostics/source types.

It must not depend on filesystem APIs, Bun APIs, package manifest parsing,
target backends, MIR, Proof MIR, proof checkers, layout, monomorphization,
code generation, linkers, or PE/COFF emission.

This repository shape refines the short roadmap sketch in
`docs/design/compiler-pipeline-design.md`. The roadmap remains the end-to-end
phase map; this document is the more specific HIR module contract.

## Public API

Typed HIR lowering is exported from `src/hir/index.ts`. Once a top-level
compiler barrel exists, it should re-export this API alongside the earlier
pipeline phases:

```ts
import { lowerTypedHir } from "./src/hir";
import { buildItemIndex, resolveNames, checkSemanticSurface } from "./src/semantic";

const surfaceResult = checkSemanticSurface({
  graph: parsedModuleGraph,
  index,
  references: nameResult.references,
  platformBindings: nameResult.platformBindings,
  coreTypes,
  targetSurface: selectedTarget.semanticSurface,
  imageRoot: requestedImageRoot,
});

const hirResult = lowerTypedHir({
  graph: parsedModuleGraph,
  index,
  references: nameResult.references,
  coreTypes,
  program: surfaceResult.program,
  image: surfaceResult.image,
});
```

The phase returns a pure result:

```ts
export interface LowerTypedHirInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly coreTypes: CoreTypeCatalog;
  readonly program: CheckedSemanticProgram;
  readonly image?: CheckedImageSeed;
}

export interface LowerTypedHirResult {
  readonly program: TypedHirProgram;
  readonly diagnostics: readonly HirDiagnostic[];
}

export function lowerTypedHir(input: LowerTypedHirInput): LowerTypedHirResult;
```

`lowerTypedHir` does not combine diagnostics from lexer, parser, item-index,
name-resolution, or semantic surface phases. The caller owns diagnostic
aggregation and source-order presentation across phases.

The result remains total over recovered syntax and failed local lowering. When
a body expression or statement cannot be lowered, the builder records an error
HIR node with an error type/resource kind, emits diagnostics, and continues
lowering surrounding source where that is deterministic.

## Input Contract

HIR lowering consumes source and semantic information, but it does not trust raw
source text when a checked semantic table already exists.

Required inputs:

- `ParsedModuleGraph` for AST views and source spans
- `ItemIndex` for deterministic source declaration IDs and declaration records
- `ResolvedReferences` for body-local, expression, and statement references
  resolved by name resolution
- `CoreTypeCatalog` for core type lookup, default integer typing, and use of
  `bool`, `Never`, and the semantic-surface error sentinels
- `CheckedSemanticProgram` for checked types, function signatures, fields,
  generic signatures, completed member references, resource kinds,
  proof-surface seeds, and certified platform bindings
- optional `CheckedImageSeed` for the selected image root, entry function,
  device origins, profile ID, and unique-edge roots

The HIR builder may read AST view structure to lower bodies and source-shaped
constructs. It must use semantic surface tables for declaration and signature
facts. For example, a parameter's consume/observe mode comes from
`CheckedFunctionSignature`; a platform call's certification comes from
`CertifiedPlatformBinding`; a field access whose member was deferred in name
resolution comes from `CompletedMemberReferenceTable`. When HIR needs helper
logic for type references, call-site generic bound checks, or member lookup, it
must call shared pure semantic-surface helpers rather than reimplementing a
second resolver.

`ResolvedReferences` remains a HIR input because semantic surface checking does
not copy every resolved body reference into `CheckedSemanticProgram`. HIR builds
its own lookup index over `references.entries()` by syntax key/span and uses
`program.completedMembers` only for member references that semantic surface
completed after owner typing. HIR must not re-resolve identifier text.

When `ResolvedReferences`, `CheckedRequirementExpression.references`, and
`program.completedMembers` contain the same `SyntaxReferenceKey`, HIR must
deduplicate by key and require agreement on the resolved semantic target.
Completed members win only for member references that name resolution left
deferred. If two checked inputs disagree for the same key, HIR emits a
deterministic diagnostic and lowers the affected expression or requirement as
error recovery.

HIR is also the first typed body phase. Semantic surface checking validates
declarations, signatures, fields, resource kinds, platform bindings, image
surfaces, and requirement seeds; it intentionally does not type every
block-local expression. HIR therefore performs local type synthesis and checking
for bodies using checked signatures, checked fields, completed member
references, local scopes, and call targets. This is not a repeat of declaration
validation. It is the body typing needed to fill `HirExpression.type` and
`HirExpression.resourceKind`.

HIR body lowering requires a usable `CheckedFunctionSignature`. If semantic
surface could not produce one for a function, HIR records a recovered
`HirFunction` with `bodyStatus: "bodylessRecovery"`, preserves the function
origin and declared requirement seeds when possible, emits a HIR recovery
diagnostic, and does not type-lower that body. This keeps HIR total without
inventing parameter or return facts that semantic surface rejected.

HIR body lowering is single-pass over functions in deterministic order. It does
not need a fixpoint for recursive or mutually recursive bodies because calls
read checked signatures from `CheckedSemanticProgram`, not partially lowered
callee bodies.

The proof-relevant input surface is not uniform. HIR must treat each construct
by its real upstream source:

| Construct                                                          | Upstream source                                                                                          | HIR responsibility                                                                                                                                    |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Function signatures, parameter modes, receiver modes, return kinds | `CheckedFunctionSignature`, `CheckedParameter`, and `CheckedReceiver`                                    | Preserve and attach to body places, call lowering, and typed expressions.                                                                             |
| Field types and field resource kinds                               | `CheckedFieldRecord`                                                                                     | Preserve on field places, object literals, and member access.                                                                                         |
| `requires` declarations                                            | `CheckedRequirementSurface` plus original AST requirement nodes                                          | Lower to structured HIR requirement expressions, preserving checked references and completed members.                                                 |
| Predicate declarations                                             | function signatures with `modifiers.isPredicate`; current proof surface may also carry predicate seeds   | Classify predicate calls and create fact-origin candidates.                                                                                           |
| Terminal declarations                                              | `CheckedTerminalSurface` and function signatures with `modifiers.isTerminal`                             | Mark terminal functions and terminal call candidates; do not prove terminal reachability.                                                             |
| Certified platform calls                                           | `CertifiedPlatformBindingTable`                                                                          | Attach target contract edges only for certified source functions.                                                                                     |
| Image devices and unique roots                                     | `CheckedImageSeed` and `CheckedImageDevice`                                                              | Create image/device origins, root places, and origin-keyed brands.                                                                                    |
| `take`                                                             | AST `TakeStatementView` plus typed operand lowering                                                      | Discover stream, buffer, and validated-buffer take modes; allocate only the session, brand, or obligation identities required by the classified mode. |
| Attempt / `?`                                                      | AST `AttemptExpressionView` plus checked `Attempt[Ok, Err, Inputs]` contract                             | Discover in HIR and record the success/error split plus declared input places for Proof MIR.                                                          |
| Validation                                                         | AST call/match shape plus validated-buffer declaration data and current span-like validation seeds       | Discover validation creation and matching; record source/result relationships without proving single-use or convergence.                              |
| `ensure`                                                           | parser-backed source `EnsureStatementView`, name resolution, and body expression typing                  | Emit source fact-origin candidates only from typed `ensure` expressions.                                                                              |
| Platform ensured facts                                             | certified structured target proof contracts                                                              | Emit platform fact-origin candidates only from semantic-surface-certified structured ensured facts.                                                   |
| Private-state transitions                                          | private class/type classification, receiver mode, call target, and current span-like private-state seeds | Record transition candidates on private-state calls; Proof MIR computes live fact invalidation.                                                       |

Several HIR responsibilities require richer checked-surface facts than the
current implementation exposes. Those are explicit prerequisites, not hidden
HIR inference:

| HIR responsibility                         | Current upstream state                         | Required upstream contract before implementation                                                                                                                                                                                                   |
| ------------------------------------------ | ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No-forgery construction gate               | resource kinds and constructor modifiers       | `CheckedConstructibilitySurface` keyed by `TypeId`/constructor `FunctionId`, with `ordinary`, `sealedPlatformTokenMint`, `validatedBufferMint`, `privateStateMint`, `streamMint`, `imageCapabilityMint`, or `edgeInternalTokenMint` authorization. |
| Take-mode classification                   | AST `take` plus checked operand type/kind      | `CheckedTakeModeSurface` or equivalent predicates for stream take-only call results, buffer obligations, and validated-buffer sessions.                                                                                                            |
| Validation creation and match              | span-like validation seeds today               | checked validation result type, source type, ok/err constructors, payload fields, and source-place parameter mapping.                                                                                                                              |
| Attempt input preservation                 | `AttemptExpressionView` only                   | checked `Attempt[Ok, Err, Inputs]` contract that maps each declared input to receiver/parameter positions so HIR can bind concrete caller places.                                                                                                  |
| Private-state transition classification    | private item spans plus receiver modes         | checked transition annotation or conservative checked rule distinguishing predicate, advance, close, and unknown transitions.                                                                                                                      |
| Platform contract diagnostics and auditing | certified IDs plus exact-match fingerprints    | Production HIR preserves certificate fingerprints and consumes structured certified target required/ensured facts when semantic surface proves them.                                                                                               |
| Cross-core transfer and `MoveRing`         | ordinary source declarations and resource kind | Production HIR lowers these as ordinary affine/edge calls until a checked cross-core proof surface exposes core-owner transfer facts and ring endpoint brands.                                                                                     |

If the optional image seed is absent, HIR still lowers source declarations and
function bodies, but `HirImageTable` and image-origin proof metadata are empty.
Whole-image reachability cannot start until a later compile invocation provides
an image seed.

The production `HirImageTable` contains the selected `CheckedImageSeed` only.
It is a table because the closed-image pipeline may later support multiple
image roots or analysis of unselected image declarations, but HIR must not
fabricate image origin metadata without an image seed.

The phrase "loaded source graph" means the parsed module graph and selected
image seed produced by earlier compiler edges. HIR lowering may lower all
checked source declarations in that graph while marking image roots and entry
points. Closed call-graph reachability, generic instantiation, and dead-code
pruning belong to whole-image monomorphization.

## Typed HIR Program Model

`TypedHirProgram` is a deterministic table set keyed by earlier semantic IDs
and by HIR-owned proof IDs:

```ts
export interface TypedHirProgram {
  readonly declarations: HirDeclarationTable;
  readonly functions: HirFunctionTable;
  readonly validatedBuffers: HirValidatedBufferTable;
  readonly images: HirImageTable;
  readonly proofMetadata: HirProofMetadata;
  readonly origins: HirOriginTable;
}
```

HIR tables expose deterministic lookup and ordered iteration:

```ts
export interface HirTable<Key, Entry> {
  get(key: Key): Entry | undefined;
  keyOf(entry: Entry): HirTableKey;
  lookupKeyOf(key: Key): HirTableKey;
  entries(): readonly Entry[];
}

export type HirTableKey = string & { readonly __brand: "HirTableKey" };

export type HirFunctionTable = HirTable<FunctionId, HirFunction>;
export type HirImageTable = HirTable<ImageId, HirImage>;
export type HirOriginTable = HirTable<HirOriginId, HirOrigin>;
export type HirDeclarationTable = HirTable<ItemId, HirDeclaration>;
export type HirValidatedBufferTable = HirTable<TypeId, HirValidatedBuffer>;
```

Tables store entries by canonical key strings derived from key values. They
must not use object identity for `HirOwnedId` or other compound keys. `entries()`
returns the immutable order fixed when the table is constructed; it must not
sort from mutable `Map` insertion order on every call.

`keyOf` exposes the canonical key string used for table construction,
deterministic summaries, diagnostics, and test fixtures. Callers must not parse
or concatenate `HirTableKey` values to recover semantics; semantic access goes
through typed keys and table entries. For compound keys, the key string is a
code-unit-sorted rendering of the typed key, for example
`function:12/obligation:3`.

Function HIR is source-shaped and typed:

```ts
export interface HirDeclaration {
  readonly itemId: ItemId;
  readonly kind: "type" | "function" | "image" | "validatedBuffer" | "error";
  readonly sourceOrigin: HirOriginId;
}

export interface HirValidatedBuffer {
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly parameterFields: readonly FieldId[];
  readonly layoutFields: readonly FieldId[];
  readonly derivedFields: readonly FieldId[];
  readonly requirements: readonly HirRequirement[];
  readonly sourceOrigin: HirOriginId;
}

export interface HirFunction {
  readonly functionId: FunctionId;
  readonly itemId: ItemId;
  readonly signature: CheckedFunctionSignature;
  readonly bodyStatus: "sourceBody" | "certifiedPlatform" | "bodylessRecovery";
  readonly locals: HirLocalTable;
  readonly body?: HirBlock;
  readonly bodyIndex?: HirBodyIndex;
  readonly declaredRequirements: readonly HirRequirement[];
  readonly sourceOrigin: HirOriginId;
}

export type HirLocalTable = HirTable<HirLocalId, HirLocal>;
export type HirExpressionTable = HirTable<HirExpressionId, HirExpression>;
export type HirStatementTable = HirTable<HirStatementId, HirStatement>;

export interface HirBodyIndex {
  readonly expressions: HirExpressionTable;
  readonly statements: HirStatementTable;
  readonly ensureCandidates: readonly HirEnsureCandidate[];
}

export interface HirEnsureCandidate {
  readonly statementId: HirStatementId;
  readonly expressionId: HirExpressionId;
  readonly sourceStatementKind: "ensure";
  readonly sourceOrigin: HirOriginId;
}

export interface HirLocal {
  readonly localId: HirLocalId;
  readonly name?: string;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly mode: "ordinary" | "consumeAlias" | "observeAlias" | "error";
  readonly introducedBy:
    | "sourceLet"
    | "parameter"
    | "receiver"
    | "pattern"
    | "forBinding"
    | "takeAlias"
    | "validationArm"
    | "compilerTemporary"
    | "errorRecovery";
  readonly annotationType?: CheckedType;
  readonly sourceOrigin: HirOriginId;
}

export interface HirBlock {
  readonly statements: readonly HirStatement[];
  readonly sourceOrigin: HirOriginId;
}

export interface HirStatement {
  readonly statementId: HirStatementId;
  readonly kind: HirStatementKind;
  readonly sourceOrigin: HirOriginId;
}

export type HirStatementKind =
  | { readonly kind: "let"; readonly localId: HirLocalId; readonly value?: HirExpression }
  | {
      readonly kind: "assign";
      readonly target: HirResourcePlace;
      readonly value: HirExpression;
    }
  | { readonly kind: "expression"; readonly expression: HirExpression }
  | {
      readonly kind: "if";
      readonly condition: HirExpression;
      readonly thenBody: HirBlock;
      readonly elseBody?: HirBlock;
    }
  | { readonly kind: "while"; readonly condition: HirExpression; readonly body: HirBlock }
  | { readonly kind: "loop"; readonly body: HirBlock }
  | {
      readonly kind: "for";
      readonly statement: HirForStatement;
    }
  | {
      readonly kind: "match";
      readonly scrutinee: HirExpression;
      readonly arms: readonly HirMatchArm[];
    }
  | { readonly kind: "take"; readonly statement: HirTakeStatement }
  | { readonly kind: "validationMatch"; readonly statement: HirValidationMatchStatement }
  | { readonly kind: "return"; readonly value?: HirExpression }
  | { readonly kind: "yield"; readonly value?: HirExpression }
  | { readonly kind: "break" }
  | { readonly kind: "continue" }
  | { readonly kind: "error"; readonly diagnosticOrigin: HirOriginId };

export interface HirForStatement {
  readonly statementId: HirStatementId;
  readonly binding: HirLocalId;
  readonly iterable: HirExpression;
  readonly iteration: HirForIteration;
  readonly body: HirBlock;
  readonly sourceOrigin: HirOriginId;
}

export type HirForIteration =
  | { readonly kind: "ordinary" }
  | {
      readonly kind: "stream";
      readonly sessionId: HirOwnedId<SessionId>;
      readonly itemBrandId: HirOwnedId<BrandId>;
      readonly closureObligationId: HirOwnedId<ObligationId>;
    }
  | { readonly kind: "error"; readonly diagnosticOrigin: HirOriginId };

export interface HirExpression {
  readonly expressionId: HirExpressionId;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly kind: HirExpressionKind;
  readonly sourceOrigin: HirOriginId;
}

export type HirExpressionKind =
  | { readonly kind: "literal"; readonly value: HirLiteralValue }
  | { readonly kind: "name"; readonly reference: HirNameReference }
  | { readonly kind: "place"; readonly place: HirResourcePlace }
  | {
      readonly kind: "member";
      readonly receiver: HirExpression;
      readonly memberReference?: ResolvedReference;
      readonly memberPlace?: HirResourcePlace;
    }
  | { readonly kind: "call"; readonly call: HirCallExpression }
  | {
      readonly kind: "typeApplication";
      readonly expression: HirExpression;
      readonly typeArguments: readonly CheckedType[];
    }
  | { readonly kind: "attempt"; readonly attempt: HirAttempt }
  | { readonly kind: "unary"; readonly operator: HirUnaryOperator; readonly operand: HirExpression }
  | {
      readonly kind: "binary";
      readonly operator: HirBinaryOperator;
      readonly left: HirExpression;
      readonly right: HirExpression;
    }
  | { readonly kind: "object"; readonly fields: readonly HirObjectField[] }
  | { readonly kind: "error"; readonly diagnosticOrigin: HirOriginId };

export type HirLiteralValue =
  | {
      readonly kind: "integer";
      readonly decimalText: string;
      readonly sourceRadix: 2 | 10 | 16;
    }
  | { readonly kind: "string"; readonly value: string }
  | { readonly kind: "boolean"; readonly value: boolean }
  | { readonly kind: "error" };

export interface HirCallExpression {
  readonly callee: HirExpression;
  readonly calleeFunctionId?: FunctionId;
  readonly arguments: readonly HirCallArgument[];
  readonly typeArguments: readonly CheckedType[];
  readonly callSiteRequirements: readonly HirOwnedId<CallSiteRequirementId>[];
  readonly platformContractEdge?: HirOwnedId<HirPlatformContractEdgeId>;
  readonly terminalCall?: HirOwnedId<HirTerminalCallId>;
  readonly predicateFactOrigin?: HirOwnedId<FactOriginId>;
  readonly privateStateTransition?: HirOwnedId<PrivateStateTransitionId>;
}

export interface HirMatchArm {
  readonly pattern: HirPattern;
  readonly body: HirBlock;
  readonly sourceOrigin: HirOriginId;
}

export interface HirObjectField {
  readonly name: string;
  readonly fieldId?: FieldId;
  readonly value: HirExpression;
  readonly sourceOrigin: HirOriginId;
}

export interface HirCallArgument {
  readonly name?: string;
  readonly value: HirExpression;
  readonly sourceOrigin: HirOriginId;
}

export type HirNameReference =
  | { readonly kind: "parameter"; readonly parameterId: ParameterId }
  | { readonly kind: "local"; readonly localId: HirLocalId }
  | { readonly kind: "item"; readonly itemId: ItemId }
  | { readonly kind: "typeParameter"; readonly parameter: TypeParameterKey }
  | { readonly kind: "function"; readonly functionId: FunctionId }
  | { readonly kind: "field"; readonly fieldId: FieldId }
  | { readonly kind: "image"; readonly imageId: ImageId }
  | { readonly kind: "error" };

export type HirPattern =
  | { readonly kind: "identifier"; readonly localId: HirLocalId }
  | {
      readonly kind: "constructor";
      readonly reference: HirNameReference;
      readonly fields: readonly HirPattern[];
    }
  | { readonly kind: "wildcard" }
  | { readonly kind: "error" };

export type HirUnaryOperator = "negate" | "not" | "deref" | "error";
export type HirBinaryOperator =
  | "add"
  | "subtract"
  | "multiply"
  | "divide"
  | "remainder"
  | "lessThan"
  | "lessThanOrEqual"
  | "greaterThan"
  | "greaterThanOrEqual"
  | "equal"
  | "notEqual"
  | "error";
```

`HirFunction.body` is the source-shaped tree. `HirFunction.bodyIndex` is an
index over the same immutable statement and expression nodes, keyed by
`HirStatementId` and `HirExpressionId`. Proof metadata may reference statement
or expression IDs, but consumers must resolve those IDs through `bodyIndex`
rather than building ad hoc traversals. Bodyless and recovered functions have
no body index.

`HirExpressionKind.name` represents a resolved symbol that is not itself a
tracked place, such as a function, item, image, type parameter, recovered
reference, or copy-only value whose place is not proof-relevant. A reference to
a parameter, receiver, local, or field that must participate in assignment,
consume/observe modes, `take`, validation, or proof-state tracking lowers to
`HirExpressionKind.place` with a canonical `HirResourcePlace`. Member
expressions that are place-like carry `memberPlace`; non-place members carry
only the resolved member reference.

`break` is part of the HIR control-flow surface because proof/resource exits
must treat it like `return`, `yield`, `continue`, and `?`. Current frontend code
does not yet expose a `break` token, parser node, or AST view; adding that
frontend support is a prerequisite for implementing this HIR design.

HIR should keep source control flow as structured HIR. It may normalize small
syntax differences, but it should not build a CFG. Proof MIR owns CFG blocks,
dominance, joins, and exit-edge resource states.

`yield` remains a source statement in HIR. HIR records its typed value and
source origin only; it does not decide whether the yield is legal across live
linear obligations. When a `yield` occurs inside a stream or `take` body, Proof
MIR uses the enclosing structured blocks, active `takeKind`, and obligation
metadata to check session closure and scheduler-borrow rules.

HIR nodes must use checked type and resource-kind models from semantic surface.
They must not pass raw type strings, raw CST nodes, or source text as semantic
facts. Source text may be preserved only as diagnostic context.

`CheckedResourceKind` values on HIR nodes may still be parametric or derived.
HIR preserves those expressions. It must not assume every resource kind is
concrete; monomorphization instantiates generic kind expressions for the closed
image.

## Body Type And Resource Synthesis

HIR body lowering uses a small bidirectional checker. Declaration and signature
checking remain semantic-surface work; HIR checks only body-local expressions,
statements, patterns, and control-flow surfaces.

The body checker runs per function:

1. Seed local scope from `CheckedFunctionSignature`: receiver, parameters,
   generic parameters, return type, return resource kind, and parameter modes.
2. Build a syntax-reference lookup from the `ResolvedReferences` input and
   completed member references from `CheckedSemanticProgram`.
3. Lower statements in source order, extending local scope for successful
   pattern and let bindings. Before introducing a source local name, check it
   against every receiver, parameter, local, pattern binding, `for` binding,
   `take` alias, validation-arm binding, and named compiler temporary already
   introduced in the function. Duplicate source names emit a no-shadowing
   diagnostic and create an error local for recovery. Unsupported patterns
   create error locals.
4. Lower expressions with an optional expected type. Let annotations,
   assignment targets, return/yield statements, call parameters, object-literal
   expected types, conditions, and match scrutinees provide expected types.
5. Synthesize expression type and resource kind from the lowered expression. If
   synthesis fails, emit an error expression using `errorCheckedType()` and
   `errorKind()`.
6. Check statement-specific constraints that do not require path-sensitive
   state: condition expressions must be `bool`, return/yield expressions must
   match the checked function return type, assignment targets must be place-like,
   and object literals must target a constructible source type.
7. Preserve proof-relevant candidates for Proof MIR, but do not simulate moves,
   drops, loans, branch joins, or exit-state closure.

Expression rules:

- literals synthesize their literal type when unambiguous; integer literals use
  the expected integer type when one exists, otherwise the configured default
  core integer type for the production implementation
- name expressions use `ResolvedReferences` for source symbols and local scope
  for HIR locals
- member expressions use completed member references when available; HIR emits
  a deterministic diagnostic when no completed member reference is available
  and does not run a second member resolver
- type applications lower explicit type arguments through semantic-surface type
  checking helpers
- generic calls with explicit type arguments use those arguments directly after
  call-site arity and bound checks through shared semantic-surface helpers
- generic calls without explicit type arguments run local first-order inference:
  collect constraints from argument expressions and expected return type against
  the callee's checked generic signature, solve only type-parameter equalities
  and direct applied-type argument equalities, and diagnose unresolved or
  conflicting type parameters
- call result type and result resource kind are the callee return type/kind
  after substituting inferred or explicit type arguments
- object literals require an expected source type or constructor target; each
  field lowers to a checked `FieldId` when one exists
- object literals and constructor calls cannot construct sealed platform tokens,
  validated buffers, private-state wrappers, or image-root capabilities unless
  the checked declaration/target surface explicitly authorizes that construction

### Body Typing Rules

Production HIR uses exact checked-type equality plus literal typing. It does
not perform implicit subtyping, numeric coercions, auto-borrowing, or overload
resolution. If a later language revision adds coercions, they must be
represented as explicit HIR nodes with source origins rather than hidden
type-checker effects.

Integer literal typing is expected-type first. If an expected core integer type
is present, HIR checks that the literal value fits that type and uses it. If no
expected integer type exists, HIR uses the configured default core integer type.
If the literal does not fit, HIR emits a deterministic diagnostic and lowers the
expression with `errorCheckedType()` and `errorKind()`.

Generic inference is deterministic and first-order. Constraint collection walks
receiver, positional arguments, named arguments sorted by checked parameter
order, and expected return type in that order. It emits only these constraint
forms:

- `T = checkedType` for a direct generic parameter occurrence
- `C<A...> = C<B...>` for matching applied type constructors, recursively
  collecting constraints for corresponding arguments
- exact checked-type equality for non-generic positions

Solving is order-independent: collect all constraints first, group them by type
parameter in checked generic signature order, then solve each group. A group
with no candidates is unresolved. A group with multiple non-equal candidates is
conflicting. HIR emits `HIR_UNRESOLVED_GENERIC_ARGUMENT` or
`HIR_CONFLICTING_GENERIC_ARGUMENT` for the first failing parameter in signature
order, then lowers the call result with `errorCheckedType()` and `errorKind()`.

HIR does not independently infer resource-kind parameters. It infers checked
type arguments, substitutes them through the callee signature, and then reads
the resulting checked resource kinds from semantic-surface helpers. If a
proof-relevant classification depends on a parametric or derived
`CheckedResourceKind` that has not become concrete, HIR lowers the
proof-relevant construct as fail-closed recovery instead of choosing a mode.

HIR call-site bound checks are not declaration validation. Semantic surface
validates generic declarations, declared bounds, and type constructors. HIR
checks only that explicit or inferred call-site type arguments satisfy the
already checked callee bounds, using shared semantic-surface helpers.

`errorCheckedType()` and `errorKind()` come from semantic surface. HIR reuses
those sentinels so later phases can recognize recovered body nodes without
special HIR-only error types.

### No-Forgery Construction Gate

HIR is responsible for the path-insensitive no-forgery gate for body
construction. Body typing must reject object literals and constructor calls that
would fabricate sealed platform tokens, validated buffers, private-state
wrappers, image-root capabilities, stream/session tokens, or edge-internal proof
tokens unless semantic surface exposes an explicit constructible declaration or
constructor signature for that exact type. This is not proof checking; it is a
type-directed construction legality check. Failures use a closed diagnostic code
such as `HIR_FORGED_SEALED_CONSTRUCTION` and lower an error expression.

If no semantic-surface authorization field exists for a sealed/proof-relevant
type in the current implementation, the HIR default is reject. Adding new
constructible proof-relevant types requires adding the checked-surface fact
first, then teaching HIR to consume that fact.

The required checked-surface fact should have this shape:

```ts
export interface CheckedConstructibilitySurface {
  readonly typeId: TypeId;
  readonly constructorFunctionId?: FunctionId;
  readonly authorization:
    | "ordinary"
    | "sealedPlatformTokenMint"
    | "validatedBufferMint"
    | "privateStateMint"
    | "streamMint"
    | "imageCapabilityMint"
    | "edgeInternalTokenMint";
  readonly sourceOrigin: SourceSpan;
}
```

Assignment to a resource-bearing place is not erased. HIR records the target
place and new value. The target place's static `resourceKind` is the previous
resource kind visible to HIR; path-sensitive old-value state belongs to Proof
MIR. Proof MIR treats overwriting an affine, linear, or proof-relevant place as
a drop/consume edge that must be legal in the current resource state.

## Type-Directed Discovery Predicates

HIR proof discovery is type-directed, but the predicates must be explicit:

- Stream iteration and `take stream` require a concrete
  `CheckedResourceKind` of `Stream` plus a checked take-only return surface for
  stream-producing calls. A return kind of `Stream` without take-only
  authorization is a HIR diagnostic.
- `take buffer` requires a concrete checked kind of `Affine`, `Linear`,
  `EdgePath`, or `SealedPlatformToken` plus a checked declaration surface that
  marks the operand as a buffer obligation. Ordinary affine values are not
  guessed to be buffers.
- `take` on a validated buffer requires concrete `ValidatedBuffer` kind and a
  checked validated-buffer declaration for the source type.
- Validation creation requires a checked validation contract tying the callee,
  validation result type, source parameter, `Ok` payload, and `Err` payload
  together.
- Attempt lowering requires a checked attempt contract tying the fallible call,
  `Ok` type, `Err` type, and declared input positions together.
- Private-state transition discovery requires concrete `PrivateState` kind and
  a checked private-transition classification. Predicate calls on private state
  are facts, not transitions.
- Cross-core and `MoveRing` calls lower as ordinary affine/edge calls until a
  checked cross-core proof contract exists. Cross-core proof metadata must be
  driven by checked owner-transfer facts, not by name matching `MoveRing`.

If any predicate depends on `CheckedResourceKind.kind: "parametric"` or a
non-concrete derived kind after local type substitution, HIR emits a
fail-closed diagnostic and lowers the proof-relevant construct to its error
variant. Proof MIR does not receive a deferred "maybe stream" or "maybe private
state" proof surface.

## Fail-Closed Proof Discovery

Proof-relevant discovery must fail closed. If a source shape is ambiguous
between an ordinary construct and a proof-relevant construct, HIR must emit a
diagnostic and lower an error node or proof candidate that cannot authorize
later phases. It must not silently lower the construct as ordinary control flow
or an ordinary call.

Examples:

- a match over a validation result must lower to `validationMatch`; if HIR
  cannot identify the `Ok`/`Err` arms, it emits an error validation match
- a `for` over a `Stream` or proof-relevant iterable lowers to stream
  iteration; if HIR cannot decide whether the iterable is stream-like, it emits
  a diagnostic and lowers `HirForIteration.kind: "error"` instead of lowering
  an ordinary `for`
- a private-state receiver call with unknown transition kind lowers to
  `transitionKind: "unknown"` and cannot produce fresh facts until Proof MIR
  validates it
- a requirement expression is lowered in requirement mode, where calls and
  member references are references only; requirement lowering must not mint
  predicate fact origins, private-state transitions, terminal metadata, or
  platform contract edges
- an error-typed scrutinee for validation, stream iteration, private state, or
  requirement lowering is treated as fail-closed proof-relevant recovery, not as
  evidence that the source construct is ordinary code

## Source Origins

Every HIR node that can appear in a diagnostic or proof trace carries a
`HirOriginId`. Origin records point back to source-level context:

```ts
export interface HirOrigin {
  readonly originId: HirOriginId;
  readonly moduleId: ModuleId;
  readonly span: SourceSpan;
  readonly syntaxKind?: SyntaxKind;
  readonly ownerItemId?: ItemId;
  readonly ownerFunctionId?: FunctionId;
}
```

Origin IDs are HIR-owned because Proof MIR diagnostics should be able to point
to stable source-level constructs without storing CST nodes. The origin table is
also the bridge from later path-sensitive diagnostics back to source locations:

- the source expression that opened an obligation
- the call site that instantiated a requirement
- the receiver field whose loan conflicts with a later use
- the predicate call or `ensure` that produced a fact
- the private-state transition that invalidated older facts
- the image/device declaration that minted a root capability
- the platform function declaration and call site tied to a target contract

Origins must be sorted deterministically by module ID, span, owner IDs, and
source-order tie breakers. They should not rely on object identity from AST
view wrappers.

## HIR-Owned IDs

HIR introduces proof-relevant ID families that later phases preserve and
instantiate:

```ts
export type HirOriginId = number & { readonly __brand: "HirOriginId" };
export type HirExpressionId = number & { readonly __brand: "HirExpressionId" };
export type HirProofExpressionId = number & {
  readonly __brand: "HirProofExpressionId";
};
export type HirStatementId = number & { readonly __brand: "HirStatementId" };
export type HirLocalId = number & { readonly __brand: "HirLocalId" };
export type HirTerminalCallId = number & { readonly __brand: "HirTerminalCallId" };

export type ObligationId = number & { readonly __brand: "ObligationId" };
export type SessionId = number & { readonly __brand: "SessionId" };
export type BrandId = number & { readonly __brand: "BrandId" };
export type ResourcePlaceId = number & { readonly __brand: "ResourcePlaceId" };
export type HirRequirementId = number & { readonly __brand: "HirRequirementId" };
export type CallSiteRequirementId = number & {
  readonly __brand: "CallSiteRequirementId";
};
export type ValidationId = number & { readonly __brand: "ValidationId" };
export type AttemptId = number & { readonly __brand: "AttemptId" };
export type PrivateStateTransitionId = number & {
  readonly __brand: "PrivateStateTransitionId";
};
export type FactOriginId = number & { readonly __brand: "FactOriginId" };
export type HirPlatformContractEdgeId = number & {
  readonly __brand: "HirPlatformContractEdgeId";
};
export type HirImageOriginId = number & { readonly __brand: "HirImageOriginId" };
```

The implementation may choose separate files or constructors, but each ID
family must be branded and must have a deterministic allocation rule. Numeric
values may be function-local for compactness, but the semantic identity of a
HIR proof ID before monomorphization is always its owner plus the branded ID:

```ts
export type HirProofOwner =
  | { readonly kind: "function"; readonly functionId: FunctionId }
  | { readonly kind: "image"; readonly imageId: ImageId }
  | { readonly kind: "type"; readonly typeId: TypeId };

export interface HirOwnedId<Id> {
  readonly owner: HirProofOwner;
  readonly id: Id;
}
```

Proof metadata IDs are owner-local. `ObligationId(7)` in function A and
`ObligationId(7)` in function B are distinct IDs. Public records and all
cross-record references use `HirOwnedId<T>`; a bare proof ID may appear only
inside `HirOwnedId.id` or inside allocator internals. `HirOriginId`,
`HirExpressionId`, `HirProofExpressionId`, `HirStatementId`, and `HirLocalId`
remain HIR-local numeric IDs because they are not proof metadata identities.
They are interpreted inside their enclosing function or requirement owner,
except `HirOriginId`, which is program-global. Cross-function references to
expressions, statements, or locals must include the enclosing `FunctionId` or an
origin ID.

Allocation rules:

- Use item-index order for declarations, then source preorder within each
  declaration or function body.
- Allocate function-local expression, statement, local, obligation, session,
  resource-place, requirement, validation, attempt, private-state transition,
  fact-origin, platform-contract-edge, terminal-call, and call-site requirement
  IDs from deterministic per-function cursors.
- Allocate requirement-local `HirProofExpressionId`s from the owning
  requirement's source preorder. They do not share a namespace with ordinary
  body `HirExpressionId`s.
- Allocate image/device origin and root resource-place IDs from image ID, device
  source order, and unique-edge-root source order.
- Allocate `BrandId`s by brand minting origin, not by an arbitrary function
  cursor. Image/device brands are keyed by image ID, device field ID, and
  `UniqueEdgeRootKey`; platform-token brands are keyed by the certified source
  function and contract that can mint them, not by an individual call edge;
  validation and `take` member brands are keyed by their validation or session
  origin. This lets two functions refer to the same device-origin or
  declaration-origin brand after monomorphization.
- Maintain a deterministic brand registry while building HIR. Global brands use
  non-function owners: image/device brands are owned by
  `{ kind: "image"; imageId }`, and declaration-level platform-token brands are
  owned by the certified platform function owner. Function-local brands, such
  as stream item brands, validation brands, and `take` member brands, are owned
  by the enclosing function. The registry allocates brands by sorted minting
  origin before any per-function traversal can observe them.
- Include owner IDs in all public proof metadata records and cross-references
  so diagnostics and monomorphization can explain where an ID came from.
- Do not derive IDs from source text hashes as the primary identity. Hashes may
  be useful as test fingerprints, but source coordinates and deterministic
  traversal should define production identity.

Brand registry construction is a two-pass process:

1. Pre-scan selected image devices, unique-edge roots, and certified platform
   declarations. Build global brand minting keys as canonical strings:
   `image:<imageId>:field:<fieldId>:root:<UniqueEdgeRootKey>` and
   `platform:<functionId>:contract:<contractId>`. Sort by code-unit order and
   allocate image-owned or declaration-owned brand IDs.
2. Lower function bodies in deterministic function/source order. Allocate
   function-owned brands for stream items, validations, attempts, and `take`
   members from the function cursor when their source construct is lowered.
   Function traversal may reference preallocated global brands but must not
   allocate them.

Monomorphization does not mutate HIR-owned IDs in place. It creates
instantiated proof identities by pairing the HIR owner/ID with a monomorphized
function or image instance:

```ts
export interface InstantiatedProofId<Id> {
  readonly hirOwner: HirProofOwner;
  readonly hirId: Id;
  readonly instanceId: MonoInstanceId;
}

export type MonoInstanceId = string & { readonly __brand: "MonoInstanceId" };
```

Generic body cloning is therefore 1:N at the instantiated ID layer. The original
HIR ID remains the source-origin identity used for diagnostics and stable
summaries; the `instanceId` identifies the concrete monomorphized copy that
Proof MIR checks.

Image/device and platform-token brands are global by their minting origin before
monomorphization. Session, validation, attempt, and `take` member brands are
owner-scoped and become distinct instantiated brands for each monomorphized
clone. Two generic clones must not share a session or validation brand merely
because they came from the same generic HIR source ID.

`HirOwnedId<T>` is intentionally stored on public records even when the owner is
the enclosing function. This keeps cross-references self-contained after HIR is
instantiated, split into Proof MIR blocks, or surfaced in diagnostics.

## Resource Places

HIR must represent resource-bearing places as structured paths. A place is not
a string such as `"self.rx"` and not just an expression ID.

```ts
export interface HirResourcePlace {
  readonly placeId: HirOwnedId<ResourcePlaceId>;
  readonly canonicalKey: HirPlaceKey;
  readonly root: HirPlaceRoot;
  readonly projection: readonly HirPlaceProjection[];
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export type HirPlaceRoot =
  | { readonly kind: "parameter"; readonly parameterId: ParameterId }
  | { readonly kind: "receiver"; readonly parameterId: ParameterId }
  | { readonly kind: "local"; readonly localId: HirLocalId }
  | { readonly kind: "temporary"; readonly expressionId: HirExpressionId }
  | { readonly kind: "imageDevice"; readonly imageId: ImageId; readonly fieldId: FieldId };

export type HirPlaceKey = string & { readonly __brand: "HirPlaceKey" };

export type HirPlaceProjection =
  | { readonly kind: "field"; readonly fieldId: FieldId }
  | { readonly kind: "validatedLayoutField"; readonly fieldId: FieldId }
  | {
      readonly kind: "validatedPayload";
      readonly typeId: TypeId;
      readonly payloadFieldId?: FieldId;
      readonly sourceOrigin: HirOriginId;
    };
```

Receiver access must be field-sensitive. HIR should create distinct places for
the whole receiver and for accessed fields such as `self.rx` and `self.tx`.
Later loan checking then has enough structure to allow disjoint-field use while
rejecting whole-receiver use during a field loan.

The first implementation may limit projection depth, but the data model should
not prevent deeper paths. If the parser and semantic surface can identify a
field chain, HIR should preserve that chain.

Resource places are canonical within their owner. The place interner maps
`(owner, root, projection, type, resourceKind)` to one `ResourcePlaceId`; two
source occurrences of `self.rx` in the same function must point to the same HIR
place when their checked type and resource kind match. Distinct field
projections have distinct canonical keys, which lets Proof MIR compare exact
place identity and disjoint-field relationships without re-parsing expressions.
Syntactic occurrences still have their own `HirOriginId`s on the statements or
expressions that use the place.

A `ResourcePlaceId` is a static HIR place identity, not a path-sensitive state
identity. The same canonical place is shared across branches and loop bodies.
Proof MIR refines every HIR place, including ordinary receiver/local places and
temporary roots, into per-block resource-state facts after CFG construction.

Indexed projections are not part of production HIR until bounded arrays or
collections have checked place-sensitive semantics. When they do, the design
must add an explicit projection kind with array resource semantics, index range
facts, and aliasing rules instead of using an underspecified catch-all
projection.

`temporary` roots are static HIR places for proof-relevant expression results.
They are not dynamic runtime instances. In a loop, one HIR temporary place may
represent many dynamic executions; Proof MIR refines those static places into
per-block resource-state facts after CFG construction. HIR should create
temporary places only when a non-place expression carries affine, linear, or
proof-relevant state that later phases must track.

Named compiler-introduced temporaries that can be referenced again during HIR
lowering receive `HirLocalId`s. Anonymous expression results that only need a
resource-state identity receive `temporary` place roots. The boundary is reuse:
if later HIR expressions can name it, make it a local; if only Proof MIR needs
to track the produced resource value, make it a temporary place.

HIR allocates resource places for:

- receiver and parameter places with non-copy, affine, linear, or
  proof-relevant resource kinds
- source locals and pattern bindings whose checked resource kind is not plain
  copy, plus copy locals used as validation or requirement anchors
- member and field projections used as assignment targets, receiver arguments,
  `take` operands, validation sources, or consume/observe call arguments
- take-only stream call results and other unbound proof-relevant expression
  results that later phases must track
- image device roots and unique-edge roots

HIR should not allocate places for ordinary copy-only intermediate expressions
unless a diagnostic or proof surface needs to name that expression as a place.

Validated payload projections carry a `sourceOrigin` because the projection is
introduced by validation or validation-match syntax rather than by a named
field access. Ordinary field projections use their `FieldId` plus the enclosing
place/expression origin for diagnostics.

## Proof Metadata

`HirProofMetadata` centralizes all proof-relevant surfaces that later phases
instantiate:

```ts
export interface HirProofMetadata {
  readonly obligations: HirObligationTable;
  readonly sessions: HirSessionTable;
  readonly brands: HirBrandTable;
  readonly resourcePlaces: HirResourcePlaceTable;
  readonly callSiteRequirements: HirCallSiteRequirementTable;
  readonly validations: HirValidationTable;
  readonly attempts: HirAttemptTable;
  readonly terminalCalls: HirTerminalCallTable;
  readonly privateStateTransitions: HirPrivateStateTransitionTable;
  readonly factOrigins: HirFactOriginTable;
  readonly platformContractEdges: HirPlatformContractEdgeTable;
  readonly imageOrigins: HirImageOriginTable;
}

export type HirObligationTable = HirTable<HirOwnedId<ObligationId>, HirObligation>;
export type HirSessionTable = HirTable<HirOwnedId<SessionId>, HirSession>;
export type HirBrandTable = HirTable<HirOwnedId<BrandId>, HirBrand>;
export type HirResourcePlaceTable = HirTable<HirOwnedId<ResourcePlaceId>, HirResourcePlace>;
export type HirCallSiteRequirementTable = HirTable<
  HirOwnedId<CallSiteRequirementId>,
  HirCallSiteRequirement
>;
export type HirValidationTable = HirTable<HirOwnedId<ValidationId>, HirValidation>;
export type HirAttemptTable = HirTable<HirOwnedId<AttemptId>, HirAttempt>;
export type HirTerminalCallTable = HirTable<HirOwnedId<HirTerminalCallId>, HirTerminalCall>;
export type HirPrivateStateTransitionTable = HirTable<
  HirOwnedId<PrivateStateTransitionId>,
  HirPrivateStateTransition
>;
export type HirFactOriginTable = HirTable<HirOwnedId<FactOriginId>, HirFactOrigin>;
export type HirPlatformContractEdgeTable = HirTable<
  HirOwnedId<HirPlatformContractEdgeId>,
  HirPlatformContractEdge
>;
export type HirImageOriginTable = HirTable<HirOwnedId<HirImageOriginId>, HirImageOrigin>;
```

Proof metadata records source origins and semantic references. It should not
store mutable proof state. Proof MIR owns live-state tracking.

The core proof metadata records are identifiers plus origin and classification,
not live proof state:

```ts
export interface HirObligation {
  readonly obligationId: HirOwnedId<ObligationId>;
  readonly kind:
    | "takeStreamClosure"
    | "takeBufferDischarge"
    | "validatedBufferClosure"
    | "terminalClosure"
    | "callRequirement"
    | "validation"
    | "attempt";
  readonly subject:
    | {
        readonly kind: "takeStreamClosure";
        readonly takeStatementId: HirStatementId;
        readonly sessionId: HirOwnedId<SessionId>;
      }
    | {
        readonly kind: "takeBufferDischarge";
        readonly takeStatementId: HirStatementId;
        readonly bufferPlace: HirResourcePlace;
      }
    | {
        readonly kind: "validatedBufferClosure";
        readonly takeStatementId: HirStatementId;
        readonly sessionId: HirOwnedId<SessionId>;
      }
    | {
        readonly kind: "terminalClosure";
        readonly terminalCallId: HirOwnedId<HirTerminalCallId>;
      }
    | {
        readonly kind: "callRequirement";
        readonly requirementId: HirOwnedId<CallSiteRequirementId>;
      }
    | { readonly kind: "validation"; readonly validationId: HirOwnedId<ValidationId> }
    | { readonly kind: "attempt"; readonly attemptId: HirOwnedId<AttemptId> };
  readonly sourceOrigin: HirOriginId;
}

export interface HirSession {
  readonly sessionId: HirOwnedId<SessionId>;
  readonly sourcePlace: HirResourcePlace;
  readonly sourceOrigin: HirOriginId;
}

export interface HirBrand {
  readonly brandId: HirOwnedId<BrandId>;
  readonly origin:
    | {
        readonly kind: "imageDevice";
        readonly imageId: ImageId;
        readonly fieldId: FieldId;
        readonly key: UniqueEdgeRootKey;
      }
    | { readonly kind: "sessionMember"; readonly sessionId: HirOwnedId<SessionId> }
    | { readonly kind: "validation"; readonly validationId: HirOwnedId<ValidationId> }
    | {
        readonly kind: "platformToken";
        readonly sourceFunctionId: FunctionId;
        readonly primitiveId: PlatformPrimitiveId;
        readonly contractId: PlatformContractId;
        readonly targetId: TargetId;
      };
  readonly sourceOrigin: HirOriginId;
}
```

HIR must preserve these relationships:

- `requires` declarations from semantic surface become `HirRequirement` records
  attached to the owning function.
- Calls to functions with `requires` sections instantiate owner-scoped
  `CallSiteRequirementId`s that reference the callee requirement surfaces,
  concrete call type arguments, and the call origin.
- Calls to certified platform functions carry the source `FunctionId`,
  `PlatformPrimitiveId`, `PlatformContractId`, target ID, and certification
  fingerprint from semantic surface.
- Predicate calls create owner-scoped `FactOriginId`s when the callee signature
  is marked predicate.
- Source `ensure` facts create owner-scoped `FactOriginId`s from typed
  parser-backed `ensure` statements. HIR records source-origin candidates;
  Proof MIR proves dominance and availability.
- Target ensured facts create owner-scoped `FactOriginId`s only from structured
  certified target fact records. HIR must not parse raw target proof text or
  emit `platformEnsure` fact origins from rejected or uncertified bindings.
- Private-state advancing calls create owner-scoped
  `PrivateStateTransitionId`s that identify the state place, source-order
  transition ordinal, and transition origin. HIR does not list invalidated live
  facts; Proof MIR computes stale-fact invalidation from transition events and
  fact origins.
- Terminal calls are marked as terminal-call edges, but terminal reachability is
  not proven in HIR.
- Image device declarations create image/device origins and root resource
  places for capabilities minted by the selected image profile.

## Proof-Relevant Constructs

HIR must not erase these constructs into ordinary control flow or ordinary
function calls.

### `take`

`take` lowers to a distinct HIR statement:

```ts
export interface HirTakeStatement {
  readonly statementId: HirStatementId;
  readonly operand: HirTakeOperand;
  readonly takeKind: HirTakeKind;
  readonly aliasLocal?: HirLocalId;
  readonly body: HirBlock;
  readonly sourceOrigin: HirOriginId;
}

export type HirTakeOperand =
  | { readonly kind: "place"; readonly place: HirResourcePlace }
  | {
      readonly kind: "takeOnlyCall";
      readonly expressionId: HirExpressionId;
      readonly call: HirCallExpression;
      readonly resultPlace: HirResourcePlace;
    }
  | { readonly kind: "error"; readonly diagnosticOrigin: HirOriginId };

export type HirTakeKind =
  | {
      readonly kind: "stream";
      readonly sessionId: HirOwnedId<SessionId>;
      readonly itemBrandId: HirOwnedId<BrandId>;
      readonly closureObligationId: HirOwnedId<ObligationId>;
    }
  | {
      readonly kind: "buffer";
      readonly bufferPlace: HirResourcePlace;
      readonly obligationId: HirOwnedId<ObligationId>;
    }
  | {
      readonly kind: "validatedBuffer";
      readonly sessionId: HirOwnedId<SessionId>;
      readonly memberBrandId: HirOwnedId<BrandId>;
      readonly closureObligationId: HirOwnedId<ObligationId>;
    }
  | { readonly kind: "error"; readonly diagnosticOrigin: HirOriginId };
```

HIR records the operand shape, take mode, body scope, and any opened session,
brand, or obligation. Proof MIR checks that every exit path closes or
discharges the state correctly.

The language has three proof-relevant `take` modes:

- `take stream` opens an affine one-shot stream session. Its operand may be a
  take-only stream-producing call such as `take self.rx.receive() as batch:`.
  The call result cannot be bound outside the `take`; HIR represents it as a
  `takeOnlyCall` operand plus a temporary result place.
- `take buffer` opens a linear buffer obligation. It may not mint a stream item
  brand, but it must allocate an obligation ID tied to the buffer place.
- `take` on an already validated buffer opens a validated-buffer session with a
  session/member brand and closure obligation.

Every lowered `take` allocates exactly the proof identities required by its
`takeKind`. `aliasLocal` is present when source wrote `take expr as name`;
without an alias, uses inside the body refer to the taken source place or
take-only result place directly. If HIR cannot classify the mode, it lowers
`takeKind: "error"` and does not mint proof-authorizing session or brand
metadata.

### `requires`

Function `requires` sections are declaration-level requirements already checked
by semantic surface. HIR attaches them to the function and records call-site
instantiations:

```ts
export type HirRequirementExpression =
  | {
      readonly kind: "structured";
      readonly expression: HirProofExpression;
      readonly references: readonly CheckedRequirementReference[];
      readonly completedMembers: readonly CheckedRequirementReference[];
    }
  | {
      readonly kind: "error";
      readonly reason: "unloweredRequirement" | "unsupportedRequirementForm" | "referenceMismatch";
      readonly diagnosticOrigin: HirOriginId;
    };

export interface HirProofExpression {
  readonly expressionId: HirProofExpressionId;
  readonly type: CheckedType;
  readonly kind: HirProofExpressionKind;
  readonly sourceOrigin: HirOriginId;
}

export type HirProofExpressionKind =
  | { readonly kind: "literal"; readonly value: HirLiteralValue }
  | { readonly kind: "name"; readonly reference: HirNameReference }
  | {
      readonly kind: "member";
      readonly receiver: HirProofExpression;
      readonly memberReference?: ResolvedReference;
    }
  | {
      readonly kind: "callReference";
      readonly calleeFunctionId: FunctionId;
      readonly arguments: readonly HirProofExpression[];
      readonly typeArguments: readonly CheckedType[];
    }
  | {
      readonly kind: "binary";
      readonly operator: HirBinaryOperator;
      readonly left: HirProofExpression;
      readonly right: HirProofExpression;
    }
  | { readonly kind: "error"; readonly diagnosticOrigin: HirOriginId };

export interface HirRequirement {
  readonly requirementId: HirOwnedId<HirRequirementId>;
  readonly owner: HirRequirementOwner;
  readonly expression: HirRequirementExpression;
  readonly sourceOrigin: HirOriginId;
}

export type HirRequirementOwner =
  | { readonly kind: "function"; readonly functionId: FunctionId }
  | { readonly kind: "validatedBuffer"; readonly typeId: TypeId };

export interface HirCallSiteRequirement {
  readonly id: HirOwnedId<CallSiteRequirementId>;
  readonly callerFunctionId: FunctionId;
  readonly calleeFunctionId: FunctionId;
  readonly requirementId: HirOwnedId<HirRequirementId>;
  readonly typeArguments: readonly CheckedType[];
  readonly callOrigin: HirOriginId;
}
```

HIR does not prove that the caller satisfies the requirement. It records the
source-level obligation for Proof MIR and diagnostics. `HirRequirement` records
are stored once on the owning `HirFunction`; `HirCallSiteRequirement` points to
the callee's requirement ID and must not copy or mutate the requirement body.

`CheckedRequirementExpression` is a seed, not the final proof expression IR.
HIR lowers requirements in requirement mode to `HirProofExpression`, a separate
expression tree that can reference calls and members but cannot mint ordinary
call metadata, predicate facts, terminal calls, private-state transitions, or
platform contract edges. For a `checked` seed, the checked references and
completed members are retained as provenance and as a consistency check against
the re-lowered proof expression; `HirProofExpression` is the authoritative
expression read by Proof MIR. If the seed is `opaque`, HIR still attempts to
lower from the AST by span. If it cannot produce a structured typed expression,
it emits a HIR diagnostic and records an error requirement.

`HirProofExpression` intentionally has its own ID namespace and a smaller ADT
than ordinary `HirExpression`. Requirements are scalar proof expressions over
stable values and references; they do not carry resource kinds and cannot contain
object literals, attempts, ordinary calls, assignments, or proof-producing
syntax. Unsupported forms produce `HIR_UNSUPPORTED_REQUIREMENT_FORM` and an
error requirement. If the re-lowered proof expression disagrees with the checked
requirement seed for a shared `SyntaxReferenceKey`, HIR emits
`HIR_REQUIREMENT_REFERENCE_MISMATCH` and records an error requirement rather
than choosing one source silently.

An error requirement is fail-closed. Every call to the owning function still
gets a `HirCallSiteRequirement`, but that call-site requirement points at the
error requirement and cannot discharge a proof obligation or authorize a
platform call in later phases. Proof MIR must reject reachable call sites that
depend on an error requirement.

Generic requirements are still stored once on the generic HIR function, but
each call records the concrete type arguments visible at that call site.
Monomorphization substitutes those arguments into requirement expressions and
creates instantiated call-site requirement IDs for each reachable generic
instance.

### Validation And Attempt

Validation and attempt lower to explicit HIR nodes with IDs and source
relationships:

```ts
export interface HirValidation {
  readonly validationId: HirOwnedId<ValidationId>;
  readonly validationExpressionId: HirExpressionId;
  readonly sourcePlace: HirResourcePlace;
  readonly pendingResultPlace: HirResourcePlace;
  readonly resultLocalId?: HirLocalId;
  readonly validatedBufferType: CheckedType;
  readonly sourceOrigin: HirOriginId;
}

export interface HirValidationMatchStatement {
  readonly statementId: HirStatementId;
  readonly validationId: HirOwnedId<ValidationId>;
  readonly okArm?: HirValidationArm;
  readonly errArm?: HirValidationArm;
  readonly sourceOrigin: HirOriginId;
}

export interface HirValidationArm {
  readonly kind: "ok" | "err";
  readonly bindingLocal?: HirLocalId;
  readonly body: HirBlock;
  readonly sourceOrigin: HirOriginId;
}

export interface HirAttempt {
  readonly attemptId: HirOwnedId<AttemptId>;
  readonly attemptExpressionId: HirExpressionId;
  readonly fallibleExpression: HirExpression;
  readonly alternativeExpression?: HirExpression;
  readonly declaredInputPlaces: readonly HirResourcePlace[];
  readonly sourceOrigin: HirOriginId;
}
```

HIR records validation creation, the pending validation result, and the match
statement that consumes it. The `Ok` and `Err` arms are preserved as source
blocks; HIR does not prove that the pending result is matched exactly once or
that the arms converge.

Validation discovery is type-directed and fail-closed:

- a creation expression is validation-relevant only when the callee or
  constructor result type is the checked validation result type for a
  `HirValidatedBuffer`
- the source place must be place-like and must have the validated buffer source
  type expected by the declaration
- a validation match is recognized only when the scrutinee is the pending result
  place of a recorded `HirValidation`
- if the scrutinee has the checked validation result type but cannot be linked
  to a recorded `HirValidation`, HIR emits `HIR_UNLINKED_VALIDATION_MATCH` and
  lowers an error validation match rather than an ordinary match
- if a validation creation is bound to a local, HIR records `resultLocalId` and
  the local's place aliases the pending result place; a later match on that
  local resolves through the local-to-validation map
- the success arm must bind or project the validated payload place with the
  expected `validatedPayload` projection; the error arm preserves the checked
  error payload or remains absent after recovery
- if the result shape is ambiguous, HIR emits an error validation node or match
  rather than lowering an ordinary call or ordinary match that could hide a
  proof obligation

HIR records attempt syntax as a fallible expression plus optional alternative
expression from `AttemptExpressionView.alternative()`. When source uses `?`
without an explicit alternative, the alternative is absent and Proof MIR models
the propagated error edge. `declaredInputPlaces` come from the checked
`Attempt[Ok, Err, Inputs]` contract after mapping the declared inputs to HIR
places; HIR must not re-guess those inputs from call arguments. If the contract
names an input that cannot be mapped to a place, HIR emits an error attempt and
does not authorize success-path consumption for that input. Proof MIR creates
the explicit success/error split, checks resource-state convergence, and
decides which places are live after the attempt.

The checked attempt contract must name inputs by callee receiver/parameter
identity, not only by type. HIR maps each declared input through the typed call:
receiver input to the receiver place, positional or named parameter input to
the corresponding `HirCallArgument.value` place, and rejected non-place inputs
to an error attempt. This mapping consults call arguments to bind declared
inputs to concrete caller places; it does not infer a new input set from consume
modes or argument shapes.

A validation created and never matched is not a HIR diagnostic by itself. HIR
records the validation and pending result place; Proof MIR reports any reachable
unmatched validation obligation after CFG construction.

### Terminal Calls

Calls to terminal functions and certified terminal platform primitives remain
calls, but they also carry terminal metadata:

```ts
export interface HirTerminalCall {
  readonly terminalCallId: HirOwnedId<HirTerminalCallId>;
  readonly callExpressionId: HirExpressionId;
  readonly calleeFunctionId: FunctionId;
  readonly terminalObligationId: HirOwnedId<ObligationId>;
  readonly platformContractEdge?: HirOwnedId<HirPlatformContractEdgeId>;
  readonly sourceOrigin: HirOriginId;
}
```

HIR records terminal call sites and terminal obligations. Whole-image terminal
reachability and per-exit closure belong to monomorphization and Proof MIR.

### Private State And Facts

Private state and facts are explicit because stale facts are a language error:

```ts
export interface HirFactOrigin {
  readonly factOriginId: HirOwnedId<FactOriginId>;
  readonly fact: HirFactContent;
  readonly sourceOrigin: HirOriginId;
}

export type HirFactContent =
  | {
      readonly kind: "predicateCall";
      readonly predicateFunctionId: FunctionId;
      readonly arguments: readonly HirExpression[];
      readonly statePlace?: HirResourcePlace;
      readonly relatedTransition?: HirOwnedId<PrivateStateTransitionId>;
    }
  | {
      readonly kind: "ensure";
      readonly expression: HirExpression;
      readonly statePlace?: HirResourcePlace;
      readonly relatedTransition?: HirOwnedId<PrivateStateTransitionId>;
    }
  | {
      readonly kind: "platformEnsure";
      readonly edgeId: HirOwnedId<HirPlatformContractEdgeId>;
      readonly ensuredFact: HirCertifiedPlatformEnsuredFact;
    }
  | {
      readonly kind: "matchRefinement";
      readonly scrutinee: HirExpression;
      readonly variantReference: HirNameReference;
      readonly fieldBindings: readonly HirLocalId[];
    };

export type HirCertifiedPlatformEnsuredFact =
  | {
      readonly kind: "predicate";
      readonly predicateFunctionId: FunctionId;
      readonly argumentBindings: readonly HirPlatformFactArgumentBinding[];
      readonly fingerprint: string;
    }
  | {
      readonly kind: "state";
      readonly stateKind: "advanced" | "closed" | "available";
      readonly argumentBindings: readonly HirPlatformFactArgumentBinding[];
      readonly fingerprint: string;
    };

export type HirPlatformFactArgumentBinding =
  | { readonly kind: "receiver"; readonly place: HirResourcePlace }
  | {
      readonly kind: "parameter";
      readonly parameterId: ParameterId;
      readonly place: HirResourcePlace;
    }
  | { readonly kind: "constant"; readonly expression: HirProofExpression };

export interface HirPrivateStateTransition {
  readonly transitionId: HirOwnedId<PrivateStateTransitionId>;
  readonly callExpressionId: HirExpressionId;
  readonly statePlace: HirResourcePlace;
  readonly transitionKind: "advance" | "close" | "unknown";
  readonly transitionOrdinalForPlace: number;
  readonly sourceOrigin: HirOriginId;
}
```

HIR does not decide whether a fact dominates a later use or whether it is stale.
It records enough origin and state-place data for Proof MIR to reject stale
facts after private-state advancement. In particular, HIR must not store
`invalidatedFactOrigins`: the set of live facts at a transition point is a
path-sensitive Proof MIR state, not source-shaped HIR data.

Private-state transition classification is conservative:

- `advance` applies when the receiver place has a concrete
  `CheckedResourceKind` for private state and the callee consumes or mutates
  that receiver without closing it
- `close` applies when the checked callee is a private-state terminal or
  destructor-like operation that consumes the state and returns no live state
  capability
- predicate calls on private state create fact origins, not transitions
- if the receiver resource kind is parametric, recovered, or otherwise not
  concrete enough to classify, HIR records `transitionKind: "unknown"` and
  later phases must treat any facts depending on that state as untrusted until
  proven otherwise

`transitionOrdinalForPlace` is a deterministic source-order ordinal for the
state place, not a proof generation and not a total order across branches. HIR
does not assign private-state generations because branches, loops, early exits,
and joins require CFG context. Proof MIR assigns path-sensitive generations
from the transition events and decides which facts are live at each use.

`matchRefinement` facts are minted when an enum, constructor, or validation
payload pattern narrows a scrutinee to a known variant. The fact content must
include the scrutinee expression, variant or constructor reference, and field
bindings so later diagnostics can explain which pattern introduced the fact.
Proof MIR decides whether such facts dominate later uses.

Production HIR emits every fact-origin variant only from a trustworthy upstream
source:

- `predicateCall` from checked predicate function calls
- `ensure` from parser-backed, name-resolved, typed `ensure` statements
- `platformEnsure` from certified structured target ensured facts
- `matchRefinement` from checked pattern or validation payload narrowing

If any upstream surface is missing or ambiguous, HIR must emit a fail-closed
diagnostic and must not synthesize that fact kind from raw text, source names,
or recovered syntax.

### Image And Device Origins

Image lowering preserves target-selected image metadata:

```ts
export interface HirImage {
  readonly imageId: ImageId;
  readonly profileId: ImageProfileId;
  readonly entryFunctionId?: FunctionId;
  readonly devices: readonly HirImageDevice[];
  readonly sourceOrigin: HirOriginId;
}

export interface HirImageDevice {
  readonly fieldId: FieldId;
  readonly devicePlaceId: HirOwnedId<ResourcePlaceId>;
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly uniqueEdgeRoots: readonly HirUniqueEdgeRootOrigin[];
  readonly sourceOrigin: HirOriginId;
}

export interface HirImageOrigin {
  readonly imageOriginId: HirOwnedId<HirImageOriginId>;
  readonly imageId: ImageId;
  readonly fieldId: FieldId;
  readonly placeId: HirOwnedId<ResourcePlaceId>;
  readonly sourceOrigin: HirOriginId;
}

export interface HirUniqueEdgeRootOrigin {
  readonly key: UniqueEdgeRootKey;
  readonly brandId: HirOwnedId<BrandId>;
  readonly rootPlaceId: HirOwnedId<ResourcePlaceId>;
  readonly sourceOrigin: HirOriginId;
}
```

An image device field is a capability origin, not merely a typed field. HIR
must preserve image ID, device field ID, device surface ID, unique-edge-root
keys, source span, and resource kind. There is one device field place for the
field itself and one root origin per `UniqueEdgeRootKey` minted or bound by the
checked device surface. This keeps unique root identities separate from
ordinary edge/path values that a root may later mint.

## Expression And Call Lowering

Expression lowering uses checked references and completed members from semantic
surface:

- name expressions lower to parameter, local, item, function, type-parameter,
  field, image, or error references
- member access lowers to field-sensitive place projections when the receiver
  is place-like
- calls lower to direct function calls when the callee is a resolved
  `FunctionId`
- calls to certified platform functions attach a platform contract edge
- calls to predicate functions create fact-origin metadata
- calls that may advance private state create private-state transition metadata
- calls to functions with requirements instantiate call-site requirement IDs
- calls to terminal functions create terminal-call metadata
- attempt expressions preserve success/error shape instead of lowering to an
  ordinary result match

The HIR builder should reject or recover from expression shapes that cannot be
typed from existing semantic data. It should not perform target-specific
lowering or proof-state simulation.

Call classification is staged so recovery cannot leave half-authorizing
metadata behind:

1. Lower the callee expression and type arguments. If the callee cannot resolve
   to a direct `FunctionId`, emit an error call expression. Dynamic dispatch is
   outside the current production HIR scope.
2. Read the callee `CheckedFunctionSignature`. Constructor calls use the
   constructor flag and return type from the checked signature; they are not
   platform calls.
3. Type-check arguments against checked parameter and receiver modes, producing
   typed argument expressions and place candidates for consume/observe modes.
4. If recovery left the call target, receiver, arguments, or type arguments
   incomplete, emit an error expression with deterministic diagnostics and mint
   no proof-authorizing metadata for that call.
5. Classify proof metadata needs from the successfully typed call: callee
   requirements, certified platform binding, predicate flag, terminal flag, and
   private-state transition classification.
6. Attach owner-scoped `CallSiteRequirementId`s for every structured
   requirement on the callee. Generic call type arguments are stored on both
   `HirCallExpression` and each `HirCallSiteRequirement` so monomorphization can
   substitute requirement expressions per instance.
7. If `certifiedPlatformBindings.get(calleeFunctionId)` returns a binding,
   attach one per-call `HirPlatformContractEdge` with the binding certificate
   and call origin. If no binding exists, the call remains an ordinary source
   call even when the source declaration used the `platform` modifier; semantic
   surface diagnostics already rejected uncertified primitive bindings.
8. If the callee is predicate, create a predicate fact-origin candidate.
9. If the callee is terminal, create terminal-call metadata and a terminal
   obligation candidate.
10. If the receiver or callee owner is private state and the call is not a
    predicate call, classify the call using the concrete `CheckedResourceKind`,
    receiver mode, callee modifiers, and checked private-transition surface.
    Create a private-state transition candidate with `advance`, `close`, or
    `unknown` transition kind plus the source-order ordinal for that state
    place.

Call metadata interaction rules:

- a platform-certified call may also be terminal when the checked source
  function is terminal
- a predicate call creates a fact origin and never creates a private-state
  transition, even if its receiver is private state
- a terminal private-state call may create both terminal-call metadata and a
  private-state transition when the checked callee consumes or closes the state
- a platform-certified predicate call is allowed only when semantic surface
  accepted that signature and modifier combination; HIR preserves the certified
  platform edge and predicate fact origin
- any error in callee, argument, receiver, or type-argument lowering suppresses
  every proof-authorizing metadata ID for that call

## Local Scope And Parameters

HIR creates local IDs for source locals, pattern bindings, aliases, and
compiler-introduced temporaries that are still source-diagnostic-relevant.
`HirLocalId`s are unique within a `HirFunction`, not within a textual block.
The source language does not allow shadowing inside a function. A source
binding may not reuse a name already introduced by the receiver, a parameter, a
`let`, a pattern binding, a `for` binding, a `take` alias, a validation arm, or
a named compiler temporary in the same function. This ban includes nested
blocks, sibling branches, and separate match arms; a name is single-owner for
the whole function body.

If a duplicate source binding reaches HIR, HIR emits a deterministic
no-shadowing diagnostic and creates an error local for recovery. The duplicate
binding does not shadow the original binding and cannot seed proof-authorizing
metadata. Follow-on references that name the duplicate binding may resolve to
the error local so diagnostics remain source-level and deterministic.

Private-state advancement does not create an exception to this rule. If source
syntax wants to keep the same visible state name across an advancement, it must
use assignment/update syntax for the existing binding rather than introducing a
new `let`, pattern, or alias with the same name.

Function entry scope is seeded from `CheckedFunctionSignature`:

- receiver parameter, if present
- ordinary parameters in source order
- parameter modes and receiver mode
- parameter resource kinds
- generic signature
- return type and return resource kind

`consume` and `observe` modes remain attached to parameter and receiver places.
They are not enforced by HIR beyond basic structural lowering. Proof MIR checks
use-after-move, consume-exactly-once, and loan conflicts.

Pattern binding support should be explicit even if the current parser supports
only simple identifier patterns in many positions. Recovered or unsupported
patterns should lower to error bindings with source diagnostics, not throw.

Every local in `HirFunction.locals` records name, checked type, resource kind,
mode, source origin, annotation type when present, and the construct that
introduced it. Proof MIR should not have to inspect arbitrary let/pattern syntax
to explain a local-related proof diagnostic.

`HirFunction.body` is absent for declarations that have no source body, such as
certified platform declarations and recovered bodyless declarations. A terminal
function may still have a body; terminal behavior is represented by its
signature modifier and terminal metadata, not by absence of a HIR body.

## Validated Buffers

Validated-buffer declarations lower to typed HIR declarations that preserve:

- parameter fields and their checked resource kinds
- layout fields, source order, and explicit wire scalar encoding from
  validated-buffer syntax
- derived fields and source origins
- require sections and requirement expressions
- validation source/output relationships used by validation HIR nodes

HIR does not compute offsets, dynamic payload ends, or `layout.fits` facts.
Layout and Proof MIR own those facts after monomorphization.

The parser and AST views must expose layout field type references in the form
`le U16`, `be U16`, or bare single-byte/opaque byte types. Semantic checking
normalizes `le` and `be` into a checked wire scalar encoding on each
validated-buffer layout field. Multi-byte integer layout fields without an
explicit marker are rejected before HIR lowering; HIR must not recover byte
order from source text, target endianness, or later layout policy.

HIR must also preserve checked finite integer ranges for validated-buffer
parameter fields, decoded layout field values, derived fields, and `source.len`
terms that can participate in layout arithmetic. Layout may refine those ranges
with wire encoding and target object-size facts, but it must not invent a range
for a term whose upstream checked surface did not provide one.

Validated-buffer field access should still preserve enough origin data for
later diagnostics to say which field read required which layout fact.

## Platform Contract Edges

Semantic surface checking certifies target primitive bindings. HIR must carry
those certifications forward without weakening or reinterpreting them:

```ts
export interface HirPlatformContractEdge {
  readonly edgeId: HirOwnedId<HirPlatformContractEdgeId>;
  readonly sourceFunctionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
  readonly certificate: PlatformPrimitiveBindingCertificate;
  readonly sourceRequirementIds: readonly HirOwnedId<HirRequirementId>[];
  readonly callOrigin: HirOriginId;
}
```

A source `platform fn` without a certified binding cannot become a platform
contract edge. Calls to ordinary wrappers around certified platform functions
remain ordinary source calls until their bodies call the certified function.
`HirPlatformContractEdge` is per call site: `sourceFunctionId` names the
certified declaration, while `callOrigin` names the source call that uses that
certificate.

Proof MIR gets platform preconditions from the certified source function's
`HirRequirement`s, structured certified target facts, and the preserved
certificate fingerprint, not from a fresh lookup by source name. Production
semantic surface must reject raw or unsupported target fact text before HIR.
Certified platform bindings that reach HIR carry IDs, a
`PlatformPrimitiveBindingCertificate`, source requirement mappings, and
structured ensured facts. HIR records `sourceRequirementIds` plus the
certificate proving those requirements matched the target proof contract, and
it emits `platformEnsure` fact origins only for the structured ensured facts on
that certified binding.

## Diagnostics

HIR diagnostics are source-level diagnostics:

```ts
export type HirDiagnosticCode = string & { readonly __brand: "HirDiagnosticCode" };

export interface HirDiagnosticRelatedInformation {
  readonly message: string;
  readonly span?: SourceSpan;
  readonly originId?: HirOriginId;
}

export interface HirDiagnostic {
  readonly code: HirDiagnosticCode;
  readonly message: string;
  readonly span?: SourceSpan;
  readonly moduleId?: ModuleId;
  readonly ownerItemId?: ItemId;
  readonly ownerFunctionId?: FunctionId;
  readonly originId?: HirOriginId;
  readonly relatedInformation?: readonly HirDiagnosticRelatedInformation[];
  readonly order: HirDiagnosticOrder;
}

export interface HirDiagnosticOrder {
  readonly moduleId: ModuleId;
  readonly spanStart: number;
  readonly spanEnd: number;
  readonly code: HirDiagnosticCode;
  readonly originId?: HirOriginId;
  readonly tieBreaker: string;
}
```

`HirDiagnosticCode` is a closed, documented set for this phase. Codes use
stable upper-snake names with a `HIR_` prefix, for example
`HIR_UNLOWERABLE_REQUIREMENT`, `HIR_NON_PLACE_ASSIGNMENT_TARGET`, and
`HIR_AMBIGUOUS_VALIDATION_MATCH`. The no-shadowing diagnostic uses
`HIR_LOCAL_NAME_SHADOWS`. The code string is part of deterministic diagnostic
ordering and must not include localized text or source-specific details.

`HirDiagnosticOrder.tieBreaker` is a deterministic, non-localized string of the
form `ownerKind:ownerId:syntaxKind:localOrdinal:messageVariant`. It must be
derived from semantic IDs, syntax kind, source traversal ordinal, and diagnostic
variant. It must not include object identity, memory addresses, unstable map
iteration order, or human-facing message text.

`ownerId` rendering is canonical by owner kind:

- `module:<numericModuleId>` for module-level recovery
- `item:<numericItemId>` for declarations without function owners
- `function:<numericFunctionId>` for function body diagnostics
- `image:<numericImageId>` for image/device diagnostics
- `type:<numericTypeId>` for validated-buffer and type-owned diagnostics

`messageVariant` is a closed per-code enum string such as
`missing-callee`, `bad-argument-2`, or `unresolved-type-parameter-T`. The enum
belongs to the diagnostic code definition and must not be derived from localized
message text.

`HirDiagnosticOrder` is the sorting authority. `HirDiagnostic.span` and
`moduleId` are duplicated as optional display fields so diagnostic aggregation
can carry source locations without decoding the order object. If present, they
must match the order fields.

Examples of HIR diagnostics:

- body-local name or binding shape cannot be lowered after recovery
- local binding shadows or duplicates an existing function-local name
- assignment target is not place-like
- field access cannot be represented as a resource place
- call callee is not callable after semantic recovery
- unsupported pattern shape in a resource-relevant binding
- proof-relevant syntax is missing the source child needed to allocate an ID
- certified platform call edge is missing despite a platform call surface

Diagnostics that depend on path-sensitive state are not HIR diagnostics. For
example, use-after-move, stale facts, live obligations at return, validation
join mismatch, terminal fallthrough, and missing layout facts belong to Proof
MIR or later whole-image checks.

## Error Recovery

HIR lowering is total over recovered syntax. Recovery values are explicit and
must not accidentally authorize later phases:

- error expressions carry an error checked type, error resource kind, a source
  origin, and no proof-authorizing metadata
- error statements reserve a `HirStatementId` at the recovered source position
  and contain only the diagnostic origin
- error locals may be created for unsupported or recovered patterns so later
  references can produce deterministic follow-on diagnostics
- error places may be created for malformed place-like expressions, but they
  have error resource kind and cannot seed obligations, loans, brands, or
  platform edges
- missing platform contract edges remain absent; HIR does not synthesize an
  uncertified edge to keep lowering
- opaque or unlowered requirements become error requirements and cannot
  discharge calls or platform preconditions

Error node allocation follows source traversal. If a malformed construct has a
present syntax node, the error node allocates at that node's span. If a required
child is missing, the parent lowering allocates at the missing child's expected
slot after all present earlier siblings and before all present later siblings.
This keeps IDs stable across repeated parses of the same recovered tree.

## Determinism

HIR output must be deterministic for the same inputs:

- table entries sort by stable semantic IDs or HIR-owned IDs
- diagnostics sort by module, span, code, origin ID, and deterministic
  `HirDiagnosticOrder.tieBreaker` using code-unit string comparison
- local and proof IDs allocate from deterministic source traversal
- object identity from CST red nodes, AST view wrappers, `Map` insertion from
  unsorted sources, and filesystem order must not affect output
- summaries used by tests should use code-unit comparison, not locale-sensitive
  ordering

The total lowering order is:

1. modules in `ItemIndex.modules()` order
2. top-level items in `ItemIndex.items()` order
3. declaration headers and HIR origins
4. type and validated-buffer declaration bodies
5. selected image records in `ImageId` order, checked image devices in source
   field order, unique-root origins sorted by `UniqueEdgeRootKey` code-unit
   order, and global image/platform brand seeds sorted by canonical minting key
6. function bodies in `FunctionId` order, using source preorder within each
   body and consuming only preallocated global brands

Determinism tests should build equivalent module graphs in different input
orders where possible and compare HIR summary fingerprints.

## Production Implementation Milestones

The production implementation should land as separate milestone contracts:

1. HIR skeleton: public API, deterministic tables, origin allocation, recovered
   declarations, selected-image record, body tree traversal, body indexes, local
   tables, no-shadowing diagnostics, and ordinary diagnostics.
2. Ordinary body typing: literals with canonical values, names, copy-only
   expressions, let, assignment, return/yield, ordinary structured control
   flow, direct calls, member access only through completed members, and exact
   call-site generic inference.
3. Place model: canonical resource-place interning for parameters, receiver
   fields, locals, image devices, and proof-relevant temporaries, without
   proof-authorizing metadata beyond places.
4. Requirements and platform calls: requirement-mode lowering, call-site
   requirements, and per-call platform contract edges using current
   certificates and source requirement IDs.
5. Upstream-contract milestone: add and consume checked constructibility,
   take-mode, validation, attempt, private-transition, source-ensure, match
   refinement, and structured platform ensured-fact surfaces. No-forgery,
   `take`, validation, attempt, private-state metadata, source facts, and
   platform facts should not be implemented before their required checked
   surfaces exist.
6. Proof metadata milestone: implement no-forgery diagnostics, all parsed `take`
   modes, validation creation/match, attempt declared input places, predicate
   facts, source `ensure` facts, structured platform ensured facts,
   match-refinement facts, private-state transition events, and image/device
   brand registry.

`break` and `ensure` are language-level source constructs in production scope.
HIR source lowering for them requires frontend tokens, parser nodes, AST views,
name-resolution walks where expressions are present, and body typing before
HIR emits statement or fact metadata.

## Testing Strategy

Unit tests should cover each lowering unit with fakes through dependency
injection:

- ID constructors and deterministic allocation
- origin table creation and sorting
- body expression/statement indexes resolving every proof metadata expression or
  statement reference
- local scope creation from checked signatures
- no-shadowing diagnostics across parameters, let, pattern, for, take aliases,
  validation arms, sibling branches, match arms, and compiler temporaries
- local-table entries for let, pattern, for, take aliases, validation arms, and
  compiler temporaries
- expression lowering for names, calls, member access, object literals, and
  attempt expressions
- canonical literal payloads, including integer radix preservation, default
  integer typing, expected integer typing, and fit diagnostics
- deterministic generic inference success, unresolved type parameters, and
  conflicting type-parameter diagnostics
- call-site generic bound checking through shared semantic-surface helpers
- statement lowering for let, assignment, return, yield, loops, `break`,
  `continue`, match, and `take`
- field-sensitive place construction for receiver fields and disjoint fields
- canonical place interning, proving repeated `self.rx` occurrences share a
  place ID while disjoint fields do not
- call-site requirement instantiation
- structured requirement lowering, including checked and opaque seeds
- error requirements forcing reachable call-site requirements to fail closed
- predicate, source `ensure`, platform ensured fact, private-state transition,
  and match-refinement fact origins
- private-state transition event ordinals across branches, proving HIR does not
  assign path generations
- certified platform contract edge preservation
- certification behavior that unsupported raw target ensured facts are rejected
  before HIR and structured certified ensured facts are preserved
- selected-image-only `HirImageTable` behavior, plus image/device origin and
  unique-edge-root preservation
- image-origin IDs distinct from resource-place IDs
- validated-buffer declaration, validation creation, and validation-match
  metadata preservation
- all three `take` modes: stream take-only call, buffer obligation, and
  validated-buffer session
- attempt metadata preserving declared input places rather than inferred
  candidates
- no-forgery construction diagnostics for sealed/proof-relevant types
- upstream-prerequisite diagnostics proving HIR does not synthesize no-forgery,
  take, validation, attempt, private-state, or structured platform facts before
  semantic surface exposes the required checked contracts
- fact-table behavior for predicate calls, source `ensure`, platform ensured
  facts, and match refinements, plus fail-closed diagnostics when any upstream
  source is missing or ambiguous
- diagnostic sorting and recovered-syntax behavior

Integration tests should parse, index, resolve, check semantic surface, and
lower typed HIR for small source programs that combine:

- ordinary source functions and member calls
- `requires` sections with completed member references
- consumed receivers and field-sensitive receiver access
- `take` with aliases and terminal calls inside the body
- attempt expressions over consuming calls
- validation match over validated-buffer declarations and requirement sections
- predicate facts, match refinements, and private-state advancement
- certified platform primitive calls
- `uefi image` roots with device fields

Add a proof-surface completeness integration test that walks the parsed AST
views for proof-relevant source constructs with an independent recognizer. The
recognizer should use syntax-first cues where they exist, such as `take`, `?`,
`requires`, image devices, and platform declarations, plus a minimal checked
type/kind oracle for validation-like matches, predicate calls, terminal calls,
and private-state calls. It must not call the same lowering classifiers used by
the HIR builder. Every reachable `take`, validation creation/match, attempt,
requirement, predicate call, private-state transition candidate, terminal call,
certified platform call, image device, and future `ensure` must either have a
corresponding metadata record or a fail-closed HIR diagnostic. This test guards
against silently erasing proof-relevant source syntax into ordinary HIR.

The public API test should verify that callers can import `lowerTypedHir` and
the main HIR model types through the intended barrels.

The integration determinism test should compare stable summaries of:

- function table order
- origin table order
- HIR-owned proof ID allocation
- resource-place fingerprints
- call-site requirement fingerprints
- platform contract edge fingerprints
- diagnostics

## Phase Boundary Summary

Semantic surface checking produces typed declarations, signatures, resource
kinds, checked requirement surfaces, certified platform bindings, and image
seeds. Typed HIR consumes that surface, lowers source bodies, assigns proof IDs,
and preserves source-origin metadata.

Whole-image monomorphization instantiates typed HIR for the closed image.
Layout adds representation and ABI facts. Proof MIR normalizes control flow and
checks obligations, sessions, loans, validations, attempts, terminal closure,
private-state facts, platform preconditions, and layout-dependent facts.

If a later phase cannot identify the source origin, resource place, obligation,
session, brand, call-site requirement, fact origin, certified platform contract,
or image/device origin responsible for a proof check, HIR has dropped necessary
proof-relevant surface.
