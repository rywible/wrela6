# Whole-Image Monomorphization Design

## Purpose

Whole-image monomorphization is the compiler phase after typed HIR and before
representation/layout facts. It starts from the selected image root, computes
the reachable closed program, instantiates generic functions and types, and
rewrites proof-relevant HIR metadata into instance-owned metadata.

The output is the first closed image-specific HIR. Every reachable function,
type, validated buffer, image device, proof ID, call-site requirement, and
platform primitive contract edge must be concrete. Later layout and Proof MIR
phases should not see unresolved type parameters or have to recover which
platform primitives the image can call.

The phase is whole-image because package boundaries do not matter after module
loading. Project source, vendored stdlib source, replacement stdlib source, and
ordinary package modules are all just declarations in the typed HIR program.
Reachability, instantiation, proof metadata preservation, and platform
primitive retention use the same rules for all of them.

## Goals

- Start from the selected HIR image root and entry function.
- Consume one typed HIR program that already carries the type, field, resource
  kind, target-kind, platform certification, and external-entry surfaces needed
  to close an image.
- Collect reachable functions, types, validated buffers, image devices, and
  proof metadata to a fixed point.
- Include every reachable declaration from project modules, vendored stdlib
  modules, replacement stdlib modules, and package modules already present in
  typed HIR.
- Instantiate generic functions, generic owner types, field types, parameter
  types, return types, local types, expression types, requirement expressions,
  and proof expressions.
- Concretize type-parameter-dependent resource kinds for every reachable
  instance.
- Enforce explicit instance-level kind eligibility rules exposed by checked HIR
  mono-closure surfaces.
- Instantiate proof-relevant HIR metadata, including resource places,
  obligations, sessions, brands, validation IDs, attempt IDs, terminal call IDs,
  private-state transition IDs, fact origins, call-site requirements, image
  origins, and platform primitive contract edges.
- Retain reachable platform primitive IDs through certified platform function
  bindings and instantiated platform contract edges.
- Deduplicate identical function and type instances by canonical instantiation
  key.
- Reject unresolved polymorphism at the whole-image boundary.
- Reject reachable function recursion and recursive source type instantiation at
  the whole-image boundary.
- Produce deterministic tables and deterministic diagnostics.
- Keep filesystem access, package loading, target selection, parsing, name
  resolution, semantic surface checking, typed HIR lowering, layout, Proof MIR,
  proof checking, code generation, and binary emission outside this phase.

## Non-Goals

- This phase does not read files, discover imports, load packages, choose a
  stdlib, or decide which modules belong to the source graph.
- This phase does not assign source-level `ItemId`, `FunctionId`, `TypeId`,
  `FieldId`, `ParameterId`, or `ImageId` values. Earlier phases own those IDs.
- This phase does not perform name resolution, member lookup, body type
  inference, platform primitive certification, or image root checking.
- This phase does not give stdlib or package source special authority. A
  vendored or replacement stdlib is ordinary reachable source.
- This phase does not compute representation size, alignment, field offsets,
  enum layout, ABI lowering, stack layout, or target calling sequences.
- This phase does not prove moves, consumes, loans, `take` closure, terminal
  closure, predicate fact availability, validation convergence, attempt
  convergence, or `requires` discharge.
- This phase does not lower platform primitives to target instructions or
  firmware ABI calls. It only preserves the reachable primitive IDs and
  contract edges.
- This phase does not implement incremental compilation.

## Recursion Policy

Compiled images do not allow reachable function recursion. This is a
source-language rule for image code, not merely a monomorphizer workaround.
Direct self-calls, mutual call cycles, same-key generic recursion, and
polymorphic recursion are all rejected once they are reachable from the selected
image root. Earlier semantic phases may diagnose obvious cycles, but whole-image
monomorphization is the authoritative enforcement point because it sees the
selected image, generic instances, external entry roots, certified platform
leaves, and pruned unreachable declarations.

The same boundedness rule applies to reachable source type instantiation.
By-value recursive fields, mutual source type field cycles, and growing generic
type cycles are rejected unless a future language feature introduces an
explicit bounded indirection model. Core and target primitive types are leaves.
Certified platform functions are also leaves: they may be called, but their
target implementation is outside the source call graph.

Unreachable recursive declarations may remain in loaded HIR without affecting
the image. They are not part of the closed program and are not diagnosed by
mono.

## Repository Shape

```text
src/
  mono/
    index.ts
    ids.ts
    mono-hir.ts
    diagnostics.ts
    deterministic-sort.ts
    instantiation-key.ts
    substitution.ts
    resource-kind-concretizer.ts
    instance-eligibility.ts
    type-instantiator.ts
    function-instantiator.ts
    proof-metadata-instantiator.ts
    reachability.ts
    closed-boundary-checker.ts
    platform-primitives.ts
    monomorphizer.ts

tests/
  support/
    mono/
      monomorphization-fakes.ts
      monomorphization-fixtures.ts

  unit/
    mono/
      instantiation-key.test.ts
      substitution.test.ts
      type-instantiator.test.ts
      function-instantiator.test.ts
      proof-metadata-instantiator.test.ts
      reachability.test.ts
      closed-boundary-checker.test.ts
      platform-primitives.test.ts
      diagnostics.test.ts

  integration/
    mono/
      whole-image-monomorphization.test.ts
      generic-instantiation.test.ts
      proof-metadata-instantiation.test.ts
      platform-primitive-reachability.test.ts
      closed-boundary-rejection.test.ts
      monomorphization-determinism.test.ts
      public-api.test.ts
```

`src/mono` may depend on `src/hir`, semantic ID and checked type models,
semantic resource kind helpers, semantic proof-contract structures already
preserved by HIR, and shared diagnostics/source span types.

It must not depend on filesystem APIs, Bun APIs, package manifest parsing,
module graph loading, target backends, layout, MIR, Proof MIR, proof checkers,
code generation, linkers, or PE/COFF emission.

## HIR Prerequisite

Current `TypedHirProgram` is not yet sufficient input for monomorphization. It
contains declarations, functions, selected image data, validated-buffer
surfaces, proof metadata, and origins, but not a complete source type table,
field table, selected target type-kind table, constructor kind rules, platform
binding table, or image external-entry roots. The implementation sequence must
extend typed HIR before implementing mono, rather than making mono consume both
HIR and `CheckedSemanticProgram` and then reconciling them.

Typed HIR should grow a mono-closure surface like this:

```ts
export interface TypedHirProgram {
  readonly declarations: HirDeclarationTable;
  readonly types: HirTypeTable;
  readonly fields: HirFieldTable;
  readonly functions: HirFunctionTable;
  readonly validatedBuffers: HirValidatedBufferTable;
  readonly images: HirImageTable;
  readonly proofMetadata: HirProofMetadata;
  readonly monoClosure: HirMonoClosureSurface;
  readonly origins: HirOriginTable;
}

export interface HirMonoClosureSurface {
  readonly sourceTypeKinds: HirSourceTypeKindTable;
  readonly targetTypeKinds: HirTargetTypeKindTable;
  readonly constructorKindRules: HirConstructorKindRuleTable;
  readonly instanceEligibilityRules: HirInstanceEligibilityRuleTable;
  readonly certifiedPlatformBindings: HirCertifiedPlatformBindingTable;
  readonly externalEntryRoots: readonly HirExternalEntryRoot[];
}

export interface HirDeterministicTable<Key, Value> {
  get(key: Key): Value | undefined;
  has(key: Key): boolean;
  entries(): Iterable<readonly [Key, Value]>;
}

export interface HirTypeRecord {
  readonly typeId: TypeId;
  readonly itemId: ItemId;
  readonly sourceKind: SourceItemKind;
  readonly declaredTypeParameters: readonly TypeParameterKey[];
  readonly fieldIds: readonly FieldId[];
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export interface HirFieldRecord {
  readonly fieldId: FieldId;
  readonly ownerTypeId: TypeId;
  readonly name: string;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export interface HirSourceTypeKindRecord {
  readonly typeId: TypeId;
  readonly kind: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export interface HirTargetTypeKindRecord {
  readonly targetTypeId: TargetTypeId;
  readonly kind: ConcreteResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export interface HirConstructorKindRule {
  readonly constructor: TypeConstructorId;
  readonly rule: ResourceKindDerivationRule;
  readonly resultKind?: CheckedResourceKind;
  readonly sourceOrigin: HirOriginId;
}

export interface HirInstanceEligibilityRule {
  readonly owner:
    | { readonly kind: "function"; readonly functionId: FunctionId }
    | { readonly kind: "type"; readonly typeId: TypeId };
  readonly parameter: TypeParameterKey;
  readonly allowedConcreteKinds: readonly ConcreteResourceKind[];
  readonly sourceOrigin: HirOriginId;
}

export interface HirExternalEntryRoot {
  readonly functionId: FunctionId;
  readonly ownerTypeArguments: readonly CheckedType[];
  readonly functionTypeArguments: readonly CheckedType[];
  readonly reason: "imageEntry" | "deviceHandler" | "hardwareCallback" | "targetRequired";
  readonly sourceOrigin: HirOriginId;
}

export interface HirPlatformContractEdgeLookupKey {
  readonly owner: HirProofOwner;
  readonly callExpressionId: HirExpressionId;
  readonly calleeFunctionId: FunctionId;
}
```

This surface is populated during HIR lowering from semantic facts that have
already been checked or from new semantic facts that must be added before mono
exists. HIR does not re-run semantic checks, but it becomes the single
downstream authority. If a future HIR type or field table disagrees with a HIR
expression, call, or proof metadata record, mono treats that as inconsistent
HIR input and emits a closure diagnostic. Mono must not reach back into
semantic tables to resolve the disagreement.

These tables expose deterministic `entries()` order by source ID code-unit
ordering. `HirTypeRecord.declaredTypeParameters` and the equivalent ordered
function type-parameter list on `HirFunction` are the only authority for zipping
positional type arguments to `TypeParameterKey` values. `HirConstructorKindRule`
reuses the existing `ResourceKindDerivationRule` vocabulary from
`src/semantic/surface/resource-kind.ts`: `"join"`, `"appliedConstructor"`,
`"fieldAggregation"`, and `"targetDeclared"`. `resultKind` is present only when
the checked semantic surface already computed a constructor-specific result
kind in the same `CheckedResourceKind` vocabulary.

`HirFunction` must therefore grow `declaredTypeParameters:
readonly TypeParameterKey[]` alongside its checked signature. Mono must not
recover this ordered list from source text or semantic tables.

Generic method and constructor monomorphization is blocked until
`HirCallExpression` carries checked `ownerTypeId`, `ownerTypeArguments`, and
`ownerTypeArgumentSource` data. Current HIR call expressions expose only callee
and function type arguments, so this is a hard HIR-lowering prerequisite rather
than a mono inference task.

`constructorKindRules` are the critical path in this prerequisite. Current
semantic resource-kind checking does not already produce non-join constructor
rules: applied types are currently classified by joining argument kinds, which
collapses proof-relevant constructor identity such as validated buffers, streams,
private state, edge paths, and sealed platform tokens to `Linear`. Before mono
implementation starts, semantic surface checking must compute constructor
resource-kind rules in the existing `ResourceKindDerivationRule` vocabulary and
HIR lowering must copy those checked rules into `HirMonoClosureSurface`.
`targetTypeKinds` can be copied from the existing target-kind context; constructor
rules cannot be inferred inside HIR lowering or mono.

`program.proofMetadata` must also expose a deterministic lookup index for
platform edges by `HirPlatformContractEdgeLookupKey`. The lookup returns all HIR
edges for that caller/call/callee tuple so mono can reject missing or duplicate
certified platform edges deterministically.

## Public API

Whole-image monomorphization is exported from `src/mono/index.ts`. Once a
top-level compiler barrel exists, it should re-export this API next to HIR:

```ts
import { lowerTypedHir } from "./src/hir";
import { monomorphizeWholeImage } from "./src/mono";

const hirResult = lowerTypedHir({
  graph: parsedModuleGraph,
  index,
  references: nameResult.references,
  coreTypes,
  program: surfaceResult.program,
  image: surfaceResult.image,
});

const monoResult = monomorphizeWholeImage({
  program: hirResult.program,
});
```

The phase returns a success value only when the whole-image boundary is closed:

```ts
export interface MonomorphizeWholeImageInput {
  readonly program: TypedHirProgram;
  readonly imageId?: ImageId;
}

export type MonomorphizeWholeImageResult =
  | {
      readonly kind: "ok";
      readonly program: MonomorphizedHirProgram;
      readonly reachablePlatformPrimitiveIds: readonly PlatformPrimitiveId[];
      readonly diagnostics: readonly MonoDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly MonoDiagnostic[];
    };

export function monomorphizeWholeImage(
  input: MonomorphizeWholeImageInput,
): MonomorphizeWholeImageResult;
```

If `imageId` is omitted, the input HIR program must contain exactly one
selected image. Current HIR lowering emits at most the selected image, so "more
than one selected image" is an inconsistent-input diagnostic for future
multi-image analysis or malformed test fixtures, not a normal user-facing image
selection path. If HIR has no selected image, or a provided `imageId` is absent
from the HIR image table, this phase emits a deterministic diagnostic and
returns `kind: "error"`.

`monomorphizeWholeImage` does not combine diagnostics from earlier phases. The
caller owns diagnostic aggregation and source-order presentation across phases.
Earlier HIR diagnostics are not re-emitted, but a reachable HIR error or
recovery node becomes a whole-image closure error because no closed executable
program can be built from an error-shaped reachable operation.

## Input Contract

Required input is a `TypedHirProgram` from typed HIR lowering after the HIR
prerequisite above has landed. The program contains all loaded source
declarations, the selected image, lowered bodies, proof metadata, source type
and field surfaces, target type-kind data, constructor kind rules, platform
certifications, and image external-entry roots needed to close the image.

The monomorphizer does not know whether a declaration came from project code,
vendored stdlib code, replacement stdlib code, or a package. If the declaration
is present in HIR and reachable from the image root, it is part of the closed
image.

The input HIR must provide:

- the selected `HirImage` and its entry function
- `HirFunction` records with checked signatures, lowered bodies, declared
  requirements, locals, expression indexes, statement indexes, and ordered
  declared type-parameter keys
- `HirValidatedBuffer` records and their requirements
- checked type and resource kind data embedded in HIR signatures, locals,
  expressions, places, fields, and requirements
- proof metadata tables for obligations, sessions, brands, resource places,
  call-site requirements, validations, attempts, terminal calls, private-state
  transitions, fact origins, platform contract edges, and image origins
- source origins for every reachable HIR operation and proof metadata record
- HIR type records and field records for every reachable source type
- selected target type-kind records for every reachable target type
- constructor kind rules for every reachable applied source constructor
- certified platform binding records for every reachable platform source
  function
- image external-entry roots, such as device or hardware callback roots, when
  the image surface declares roots beyond the ordinary entry function. Generic
  external roots must carry concrete owner and function type arguments in HIR;
  otherwise they are closure errors.

Certified platform functions are reachable functions. Their bodies may be
absent, and `program.monoClosure.certifiedPlatformBindings` identifies which
source functions are certified target handles. Reachable calls to those
functions must also have caller-owned `HirPlatformContractEdge` records in HIR
proof metadata. The monomorphizer preserves those call-site edges and records
their `PlatformPrimitiveId`s in the reachable platform primitive set.

## Monomorphized HIR Program Model

The output is an image-specific HIR table set. It preserves source origins,
source semantic IDs, and source HIR IDs for diagnostics, but every executable
clone is keyed by a monomorphized instance ID. This follows the typed HIR proof
surface contract: monomorphization does not mutate HIR-owned IDs in place; it
pairs source HIR identity with a concrete mono instance.

```ts
export type MonoInstanceId = string & { readonly __brand: "MonoInstanceId" };

declare const monoCheckedTypeBrand: unique symbol;

export type MonoCheckedType = CheckedType & {
  readonly [monoCheckedTypeBrand]: "MonoCheckedType";
};

export interface InstantiatedHirId<Id> {
  readonly hirId: Id;
  readonly instanceId: MonoInstanceId;
}

export interface InstantiatedProofId<Id> {
  readonly hirOwner: HirProofOwner;
  readonly hirId: Id;
  readonly instanceId: MonoInstanceId;
}

export interface MonomorphizedHirProgram {
  readonly image: MonoHirImage;
  readonly functions: MonoHirFunctionTable;
  readonly types: MonoHirTypeTable;
  readonly validatedBuffers: MonoHirValidatedBufferTable;
  readonly proofMetadata: MonoProofMetadata;
  readonly instantiationGraph: MonoInstantiationGraph;
  readonly origins: HirOriginTable;
}
```

In `InstantiatedProofId`, `hirId` is the bare ID value such as
`ObligationId`, `ResourcePlaceId`, or `HirRequirementId`, not a
`HirOwnedId<T>`. When source HIR stores `HirOwnedId<T>`, mono splits it into
`hirOwner` and `hirId` before pairing it with `instanceId`.

Each function instance records its source function and concrete type
substitution. Methods and constructors also record the concrete owner type
instance that supplies `self`, field, and owner-type-parameter substitutions:

```ts
export interface MonoFunctionInstance {
  readonly instanceId: MonoInstanceId;
  readonly sourceFunctionId: FunctionId;
  readonly sourceItemId: ItemId;
  readonly ownerTypeInstanceId?: MonoInstanceId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly functionTypeArguments: readonly MonoCheckedType[];
  readonly signature: MonoFunctionSignature;
  readonly bodyStatus: "sourceBody" | "certifiedPlatform";
  readonly locals: MonoLocalTable;
  readonly body?: MonoBlock;
  readonly declaredRequirements: readonly MonoRequirement[];
  readonly sourceOrigin: HirOriginId;
}
```

A type instance records its source type and concrete owner arguments. Every
reachable source type gets a stable mono type instance record, including
non-generic source classes, generic source types, edge classes, streams, and
validated buffers. Core and target types may remain checked type records because
they have no source fields to instantiate.

```ts
export interface MonoTypeInstance {
  readonly instanceId: MonoInstanceId;
  readonly sourceTypeId: TypeId;
  readonly sourceItemId: ItemId;
  readonly sourceKind: SourceItemKind;
  readonly typeArguments: readonly MonoCheckedType[];
  readonly fields: readonly MonoField[];
  readonly resourceKind: ConcreteResourceKind;
  readonly sourceOrigin: HirOriginId;
}
```

`MonoHirValidatedBufferTable` is not a second owner for validated-buffer type
identity. Each mono validated-buffer entry references the `MonoTypeInstance`
for its source `validatedBuffer` type and stores the instantiated parameter,
layout, derived, and requirement sections for that same type instance. The
validated-buffer table key is the validated buffer's `MonoInstanceId`; the
corresponding `MonoTypeInstance` remains the canonical type identity. Divergence
between the two tables is inconsistent mono construction and must be rejected in
tests.

The output should retain enough source identity for later diagnostics to say
"this concrete instance came from `foo[T]` instantiated at this call site"
without making later phases inspect generic HIR.

That provenance is stored as an instantiation graph rather than only on the
deduplicated function/type instance. A single mono instance can be reached from
many call sites or field paths, so the instance record stores its canonical
source identity while the graph stores every retained edge:

```ts
export interface MonoInstantiationGraph {
  readonly edges: readonly MonoInstantiationEdge[];
}

export type MonoInstantiationEdgeSource =
  | { readonly kind: "image"; readonly imageId: ImageId }
  | {
      readonly kind: "function";
      readonly instanceId: MonoInstanceId;
      readonly callExpressionId?: MonoExpressionId;
    }
  | {
      readonly kind: "type";
      readonly instanceId: MonoInstanceId;
      readonly fieldId?: FieldId;
    };

export interface MonoInstantiationEdge {
  readonly source: MonoInstantiationEdgeSource;
  readonly targetInstanceId: MonoInstanceId;
  readonly targetKind: "function" | "type" | "proofMetadata";
  readonly sourceOrigin: HirOriginId;
}
```

Validated-buffer reachability uses `targetKind: "type"` because the
`MonoTypeInstance` is the canonical identity for a validated-buffer type.
Validated-buffer table rows are attached metadata for that type instance, not a
separate graph node kind.

Mono locals, expressions, statements, and requirements are also instance-scoped.
For source body nodes, their IDs pair the HIR ID with the function instance.
Monomorphization should not create new executable temporaries; it clones and
substitutes already-lowered HIR.

```ts
export type MonoLocalId = InstantiatedHirId<HirLocalId>;
export type MonoExpressionId = InstantiatedHirId<HirExpressionId>;
export type MonoStatementId = InstantiatedHirId<HirStatementId>;
export type MonoRequirementId = InstantiatedProofId<HirRequirementId>;
```

### Required Mono HIR Schema

The top-level interfaces above are not enough by themselves. Before body
instantiation lands, `src/mono/mono-hir.ts` must define the concrete schema for
the monomorphized body and proof tables. The schema mirrors HIR structure but
with instance-scoped IDs, `MonoCheckedType` types, concrete resource kinds, and
instantiated proof IDs:

```ts
export interface MonoDeterministicTable<Key, Value> {
  get(key: Key): Value | undefined;
  entries(): Iterable<readonly [Key, Value]>;
}

export interface MonoBlock {
  readonly statements: readonly MonoStatement[];
  readonly sourceOrigin: HirOriginId;
}

export interface MonoStatement {
  readonly statementId: MonoStatementId;
  readonly kind: MonoStatementKind;
  readonly sourceOrigin: HirOriginId;
}

export interface MonoExpression {
  readonly expressionId: MonoExpressionId;
  readonly kind: MonoExpressionKind;
  readonly type: MonoCheckedType;
  readonly resourceKind: ConcreteResourceKind;
  readonly sourceOrigin: HirOriginId;
  readonly place?: MonoResourcePlace;
}

export interface MonoProofMetadata {
  readonly obligations: MonoDeterministicTable<InstantiatedProofId<ObligationId>, MonoObligation>;
  readonly sessions: MonoDeterministicTable<InstantiatedProofId<SessionId>, MonoSession>;
  readonly brands: MonoDeterministicTable<InstantiatedProofId<BrandId>, MonoBrand>;
  readonly resourcePlaces: MonoDeterministicTable<
    InstantiatedProofId<ResourcePlaceId>,
    MonoResourcePlace
  >;
  readonly callSiteRequirements: MonoDeterministicTable<
    InstantiatedProofId<HirRequirementId>,
    MonoCallSiteRequirement
  >;
  readonly validations: MonoDeterministicTable<InstantiatedProofId<ValidationId>, MonoValidation>;
  readonly attempts: MonoDeterministicTable<InstantiatedProofId<AttemptId>, MonoAttempt>;
  readonly terminalCalls: MonoDeterministicTable<
    InstantiatedProofId<HirTerminalCallId>,
    MonoTerminalCall
  >;
  readonly privateStateTransitions: MonoDeterministicTable<
    InstantiatedProofId<PrivateStateTransitionId>,
    MonoPrivateStateTransition
  >;
  readonly factOrigins: MonoDeterministicTable<InstantiatedProofId<FactOriginId>, MonoFactOrigin>;
  readonly platformContractEdges: MonoDeterministicTable<
    InstantiatedProofId<HirPlatformContractEdgeId>,
    MonoPlatformContractEdge
  >;
  readonly imageOrigins: MonoDeterministicTable<
    InstantiatedProofId<HirImageOriginId>,
    MonoImageOrigin
  >;
}

export interface MonoRemapIndex {
  local(id: HirLocalId): MonoLocalId;
  expression(id: HirExpressionId): MonoExpressionId;
  statement(id: HirStatementId): MonoStatementId;
  proof<Id>(id: HirOwnedId<Id>): InstantiatedProofId<Id>;
}
```

The exact `MonoStatementKind`, `MonoExpressionKind`, and individual proof record
unions should be one-for-one mirrors of current HIR unions unless a field is
generic, proof-owned, or recovery-shaped. Generic fields are substituted and
normalized, proof-owned fields are remapped through `MonoRemapIndex`, and
recovery-shaped fields are rejected rather than copied. Table APIs expose
deterministic `entries()` order and no mutation from outside the builder.

## Closed Type Normalization

`MonoCheckedType` is a normalized `CheckedType` accepted at the whole-image
boundary. The TypeScript brand is opaque but shallow; it is not, by itself, a
recursive proof that every nested `CheckedType` is closed. Only the mono
normalization API may construct the brand:

```ts
export type NormalizeMonoCheckedTypeResult =
  | { readonly kind: "ok"; readonly type: MonoCheckedType }
  | { readonly kind: "error"; readonly diagnostics: readonly MonoDiagnostic[] };

export function normalizeMonoCheckedType(
  type: CheckedType,
  context: MonoTypeNormalizationContext,
): NormalizeMonoCheckedTypeResult;
```

The factory recursively validates and returns the original structural type
with the mono brand only after these invariants hold:

- no `genericParameter` node appears anywhere in the type tree
- no `error` type appears in reachable executable or proof-relevant positions
- every `applied.resourceKind` is `{ kind: "concrete" }`
- every nested applied argument is also a `MonoCheckedType`
- every reachable `target` type has a matching entry in
  `program.monoClosure.targetTypeKinds`
- every reachable applied source constructor has a matching
  `program.monoClosure.constructorKindRules` entry

All mono function keys, type keys, local types, expression types, field types,
proof expression types, and platform ensured fact types use `MonoCheckedType`.
The raw pre-mono `CheckedType` remains available only as source diagnostic
context through HIR origins and source records.

Every substituted `CheckedType` must pass through `normalizeMonoCheckedType`
before it is stored in a mono table, mono key, mono expression, mono proof
record, or platform ensured fact. The only permitted `as MonoCheckedType` cast
is inside the normalization factory after recursive validation succeeds.
Code-review and tests should treat any other cast as a correctness bug.

An `error` type never creates additional source type work during graph
expansion, but it is still a hard closure diagnostic in every reachable
executable or proof-relevant position. This avoids cascading work from recovery
nodes while preserving the closed-image invariant.

## Instantiation Keys

Reachability and deduplication use canonical keys, not object identity:

```ts
export interface MonoFunctionKey {
  readonly functionId: FunctionId;
  readonly ownerTypeArguments: readonly MonoCheckedType[];
  readonly functionTypeArguments: readonly MonoCheckedType[];
}

export interface MonoTypeKey {
  readonly typeId: TypeId;
  readonly typeArguments: readonly MonoCheckedType[];
}
```

Canonical key strings are built from source IDs plus `checkedTypeFingerprint`
from `src/semantic/surface/type-model.ts`, but only after type substitution and
resource-kind concretization have produced `MonoCheckedType` values. The
monomorphizer must not invent a second type fingerprint.
`checkedTypeFingerprint` includes `resourceKindFingerprint` for applied types,
so using it on pre-concretized checked types can split equivalent concrete
instances. Key construction therefore rejects any type argument whose type tree
still contains `genericParameter`, `derived`, `parametric`, or `error` kind
data.

Instance identity depends on `checkedTypeFingerprint` being injective for
`CheckedType` values produced by semantic checking. That is an explicit compiler
invariant, not an informal assumption. The canonical key builder treats
fingerprints as opaque segments and length-delimits each segment when producing
the final `MonoInstanceId` string; it must not parse fingerprints by splitting
on `:`, `<`, `>`, or `,`. This outer length-delimiting does not repair an
ambiguous `checkedTypeFingerprint` implementation. Today the invariant relies
on compiler-owned numeric IDs for source items/types/functions and controlled
string IDs for core/target IDs. If future IDs can contain fingerprint
separators, `checkedTypeFingerprint` and `resourceKindFingerprint` themselves
must switch to length-delimited or structured serialization before mono uses
them for identity.

`MonoInstanceId` is the canonical key string branded as `MonoInstanceId`; it is
not allocated from discovery order. Function instance IDs use the canonical
function key, type instance IDs use the canonical type key, and image-owned
metadata uses an image-root key. They must use deterministic code-unit ordering
and must not use `localeCompare`.

Examples:

```text
fn:12|owner:<>|fn:<>
fn:12|owner:<>|fn:<core:u32>
fn:27|owner:<applied:source:5:concrete:Copy<core:u8>>|fn:<core:bool>
type:5|args:<core:u8>
```

Two instances with the same canonical key are the same monomorphized instance.
The first discovery records a source origin for diagnostics; later discoveries
add instantiation-graph edges but do not duplicate the instance body.

## Reachability Algorithm

Reachability discovery starts from the selected image:

1. Add the selected `HirImage`.
2. Add image-owned proof metadata, image device places, unique-edge-root
   brands, image origins, and image field types.
3. Add the image entry function instance. Non-generic image entries use empty
   owner and function type-argument lists. A generic image entry is valid only
   when HIR records an `externalEntryRoot` with `reason: "imageEntry"` and
   concrete owner/function type arguments; otherwise it is a closure error.
4. Add every type appearing in the entry signature, image devices, image-owned
   resource places, and image-owned proof metadata.
5. Add every non-image-entry external root from
   `program.monoClosure.externalEntryRoots`.

Discovery then expands instances with deterministic depth-first traversal:

1. Expand the current canonical work item. Sort newly discovered outgoing edges
   by canonical edge key before recursing.
2. If it is a function instance, instantiate the signature and declared
   requirements under that function's type substitution. Source-body functions
   also instantiate locals, body expressions, statements, and function-owned
   proof metadata. Certified platform functions instantiate only the signature
   and certified contract surface, add no body call edges, and are graph leaves.
   A reachable `bodylessRecovery` function is a closure error.
3. For each instantiated call, add the callee function instance using the
   extracted concrete owner type arguments and concrete function type arguments.
   If a generic callee has no concrete type arguments, emit an
   unresolved-polymorphism diagnostic.
4. For each instantiated function, add every type referenced by its signature,
   locals, expressions, requirements, proof expressions, resource places,
   attempts, validations, terminal calls, fact origins, private-state
   transitions, and platform contract edges.
5. If an instantiated call targets a certified platform function, instantiate
   the caller-owned HIR platform contract edge for that call site and retain
   its `PlatformPrimitiveId`.
6. If it is a type instance, instantiate fields, validated-buffer sections,
   type-owned requirements, and type-owned proof metadata. Add every type and
   function referenced by those records.
7. Continue until every edge reachable from the image root has either expanded
   a new instance, linked to an already-completed instance, or produced a
   closure diagnostic.

Calls through recovered or unresolved HIR call targets do not add speculative
edges. They produce closure diagnostics and prevent a successful `ok` result.

Discovery tracks every canonical function/type instance as `"unseen"`,
`"inProgress"`, or `"completed"`, where `"inProgress"` is a DFS gray state. A
node stays `"inProgress"` until its full reachable subtree has been expanded.
Rediscovering a completed key adds only an instantiation-graph edge to the
existing instance. Rediscovering an `"inProgress"` function key on the current
ancestry path is reachable function recursion and is a closure error, even when
the canonical key is identical. Discovering the same source function on the
active path with a different concrete type vector is reported as polymorphic
recursion, a more specific form of the same forbidden recursive call cycle.

Type work items carry the same DFS ancestry. Rediscovering an `"inProgress"`
source type key through field, validated-buffer, or type-owned metadata
expansion is a recursive source type instantiation cycle and is a closure
error. Discovering the same source type on the active path with a different
concrete type vector is reported as a polymorphic recursive type-instantiation
cycle. This rejects both direct by-value recursive fields and growing generic
type cycles such as `Foo<T>` containing `Foo<Box<T>>`.

The traversal order is deterministic, but it is not the public table order.
After discovery, mono emits function, type, proof metadata, and platform tables
by canonical key order. It also runs a deterministic SCC/topological validation
over the retained `instantiationGraph`; any multi-node SCC or self-edge in the
function/type graph is a recursion diagnostic. The DFS gray-state check is the
primary termination guard, and the SCC pass is the output invariant check. The
accepted reachable function/type graph is therefore acyclic and can be consumed
downstream in topological order. Whole-image monomorphization does not provide
an implicit runtime stack model, recursion lowering strategy, or inductive
proof rule.

This language rule rules out infinite recursive instantiation, but it does not
pretend finite code growth is free. V1 does not define a semantic instance-count
cap: a finite acyclic image is valid even if it produces many concrete
instances. The implementation may keep defensive counters to produce a compiler
resource-limit diagnostic, but that is an implementation limit rather than a
source-language closure rule.

Reachability is semantic reachability, not package reachability. A package
module can be loaded but absent from the output if no reachable instance refers
to it. A replacement stdlib module can be included if a reachable project,
stdlib, or package function calls into it. No module path receives special
treatment.

Type reachability is derived from normalized checked types:

- `core` and `target` checked types do not create source type work items.
  `target` types still require a reachable target type-kind record.
- `error` checked types do not create source type work items, but every
  reachable `error` type records a closure diagnostic.
- `source` checked types create a `MonoTypeKey` with that `typeId` and an empty
  type-argument list.
- `applied` checked types whose constructor is `source` create a `MonoTypeKey`
  from the constructor `typeId` and the applied type arguments after
  substitution and concretization.
- `applied` checked types whose constructor is `core` or `target` do not create
  source type work items, but their arguments are recursively scanned.
- `genericParameter` in a reachable type is a closure error.

## Generic Substitution

The substitution environment maps generic parameter keys to concrete checked
types. It is built from:

- the reachable function instance's concrete type arguments
- the owner type instance's concrete type arguments for methods, constructors,
  fields, and type-owned requirements
- concrete type arguments already recorded on HIR call expressions

Substitution keys include the full `TypeParameterOwner` (`item` or `function`
plus source owner ID) and parameter index. Owner type parameters and function
type parameters therefore cannot collide even when both use index `0`. Building
the substitution environment validates exact arity for the owner type argument
list and the function type argument list before any body cloning happens.
Positional type arguments are zipped only against ordered parameter-key lists
carried by HIR: `HirTypeRecord.declaredTypeParameters` for owner/type arguments
and `HirFunction.declaredTypeParameters` for function arguments. Missing,
extra, duplicated, or out-of-order keys are inconsistent HIR input and prevent
closure.

Substitution rewrites:

- checked types in signatures, fields, locals, expressions, places,
  validations, attempts, requirements, proof expressions, and platform ensured
  facts
- checked resource kinds that contain type-parameter-dependent kind
  expressions
- owner-qualified references in method calls and constructor calls
- generic `HirRequirement` expressions and call-site requirement records

Owner type arguments for calls come from HIR, not from ad hoc member lookup in
mono. HIR must record enough call target context to expose:

```ts
export interface HirCallExpression {
  readonly calleeFunctionId?: FunctionId;
  readonly ownerTypeId?: TypeId;
  readonly ownerTypeArguments: readonly CheckedType[];
  readonly typeArguments: readonly CheckedType[];
  readonly ownerTypeArgumentSource:
    | "none"
    | "receiverType"
    | "constructorExpectedType"
    | "completedMemberReference"
    | "error";
}
```

HIR derives those owner arguments while it still has source-shaped context:

- method calls use the lowered receiver expression type. A receiver of
  `source` owner type supplies an empty owner argument list; a receiver of
  `applied(source owner, args)` supplies `args`.
- constructor calls and object construction use the expected constructed type
  or checked return type. A non-generic constructed source type supplies an
  empty owner argument list; an applied constructed source type supplies its
  arguments.
- completed member references may provide the owner type when receiver syntax
  alone is insufficient.
- if HIR cannot determine owner arguments for a generic owner, it records
  `ownerTypeArgumentSource: "error"` and mono rejects the reachable call.

HIR may contain already-checked generic declarations. Monomorphization may
assume declaration-level generic bounds were checked earlier, but it must still
verify that every reachable instance has enough concrete type arguments to
eliminate all type parameters. Missing, extra, or unresolved type arguments are
hard closure errors.

Mono must reuse the existing checked type and resource-kind vocabulary rather
than creating a second semantic model. It should use `checkedTypeFingerprint`,
`checkedTypesEqual`, `resourceKindFingerprint`, `joinConcreteResourceKinds`, and
other pure helpers from semantic surface support. Constructor, field, and target
kind authority comes from `program.monoClosure`, not from rebuilding
`ResourceKindContext` over semantic or item-index state. The current HIR helper
in `src/hir/generic-substitution.ts` is not sufficient as the whole-image
authority because its `substituteKind` path does not resolve parametric kinds;
mono either extends that helper into a shared total substitution API or wraps
the pure helpers in `src/mono/substitution.ts` without forking their fingerprint
or equality rules.

## Resource Kind Concretization

Resource-kind concretization is a required part of whole-image closure. The
closed output must not contain `parametric`, `derived`, or `error` resource
kinds on reachable executable or proof-relevant records.

The evaluator takes a substituted checked type, the concrete substitution
environment, and `program.monoClosure`:

```ts
export type ConcretizeResourceKindResult =
  | { readonly kind: "ok"; readonly value: ConcreteResourceKind }
  | { readonly kind: "error"; readonly diagnostic: MonoDiagnostic };
```

Required rules:

- `concrete(K)` returns `K`.
- `parametric(P)` looks up `P` in the substitution environment, substitutes the
  resulting checked type, and computes that type's concrete resource kind.
  Missing or still-generic substitutions are closure errors.
- `derived("join", args)` concretizes every argument, then applies
  `joinConcreteResourceKinds`.
- `derived("appliedConstructor", args)` concretizes the fully substituted
  applied type by using the HIR constructor kind rule for the concrete
  constructor and arguments. It must not collapse proof-relevant constructor
  identity unless that HIR rule says the result is an ordinary join.
- `derived("fieldAggregation", args)` concretizes every instantiated field kind
  from `program.fields` and applies the source type's HIR field aggregation
  rule.
- `derived("targetDeclared", args)` resolves the concrete target type kind from
  `program.monoClosure.targetTypeKinds`. Missing target kind data is a closure
  error for reachable target types.
- `error` is a reachable HIR/semantic recovery error and prevents a successful
  closed result.

`joinConcreteResourceKinds` is only the rule for HIR constructor rules whose
`rule` is `"join"`. It must not be used as the universal answer for source
constructors whose proof-relevant kind must survive, such as validated buffers,
edge paths, private state, streams, or sealed platform tokens. Therefore
monomorphization is blocked on HIR carrying `constructorKindRules`; v1 does not
silently fall back to join for reachable applied source constructors without an
explicit rule in the existing `ResourceKindDerivationRule` vocabulary.

HIR constructor rules are interpreted as follows:

- `"join"` concretizes the applied arguments and applies
  `joinConcreteResourceKinds`.
- `"fieldAggregation"` expands the source type through the guarded type
  instantiation path and aggregates instantiated field kinds.
- `"targetDeclared"` reads the selected target kind from
  `program.monoClosure.targetTypeKinds`.
- `"appliedConstructor"` substitutes and concretizes `resultKind`; a missing
  `resultKind` is inconsistent HIR input for a reachable constructor.

Resource-kind concretization does not perform an independent recursive walk of
source fields. When a kind rule needs instantiated field kinds, it requests them
through the active type-instantiation path and reuses that DFS ancestry guard.
If field aggregation would revisit an `"inProgress"` source type, mono reports
the recursive source type instantiation cycle before evaluating the aggregate
kind. This keeps the kind evaluator from looping ahead of the reachability
cycle detector.

## Instance Kind Eligibility

Some generic declarations are valid only for particular concrete resource
kinds. Declaration-level generic bounds are checked earlier, but any
eligibility rule that depends on the concrete resource kind of a type argument
must be checked after monomorphization substitutes that argument.

Mono enforces only explicit checked eligibility surfaces carried in
`program.monoClosure.instanceEligibilityRules`. An empty table is valid in v1
and means there are no instance-level eligibility rules to enforce. Mono does
not infer hidden privileges from source names or package paths. For v1,
`MoveRing` and other cross-core transfer APIs continue to lower as ordinary
source calls unless HIR exposes a checked cross-core or resource-eligibility
contract. When such a contract exists, mono evaluates it against concretized
resource kinds and rejects the instance before layout or Proof MIR.

## Proof Metadata Instantiation

HIR proof metadata IDs are source-scoped and owner-scoped. A generic function
instantiated more than once cannot reuse the same proof identity in the closed
program, but mono also must not replace HIR IDs with an unrelated numeric ID
family. It creates instantiated proof identities by pairing the HIR owner and
HIR ID with the concrete `MonoInstanceId`.

```ts
export interface MonoProofRecordBase<IdValue> {
  readonly proofId: InstantiatedProofId<IdValue>;
  readonly sourceOrigin: HirOriginId;
}
```

Before reachability starts, mono builds proof metadata indexes by `HirProofOwner`
and record kind. Function-owned records are instantiated only for reachable
function instances. Type-owned records are instantiated only for reachable type
instances. Image-owned records are instantiated once for the selected image
instance. Body nodes do not scan arbitrary proof tables; they look up the
specific source proof IDs they reference through the owner index.

The global `program.proofMetadata` tables are the source of truth for proof
records. Inline body structures may carry the IDs needed to reference those
records, but they must not carry an independently authoritative copy of the
record. If an inline body record and the proof metadata table disagree for the
same source ID, mono emits inconsistent-proof-metadata and does not close the
image. If a reachable body references proof metadata whose source record is
missing, owned by a different HIR owner, or has already been instantiated with
an incompatible source shape for the same instance, mono emits a
dangling-proof-metadata diagnostic and the result is not closed. Unreferenced
metadata owned by an unreachable function or type is pruned without
diagnostics.

The instantiator rewrites all proof metadata references consistently inside the
owning function, type, or image instance:

- `HirResourcePlace` becomes `MonoResourcePlace` with substituted type,
  concretized resource kind, remapped local references, and an
  `InstantiatedProofId<ResourcePlaceId>`.
- `HirObligation` becomes `MonoObligation` with an instantiated obligation ID
  and a remapped place when present.
- `HirSession` becomes `MonoSession` with an instantiated session ID, remapped
  place, and source session identity.
- `HirBrand` becomes `MonoBrand`. Image-owned and platform-token brands remain
  stable within the image; function-owned brands are copied per function
  instance.
- `HirCallSiteRequirement` becomes `MonoCallSiteRequirement` with substituted
  proof expression and the remapped call expression ID.
- `HirValidation` and `HirAttempt` become mono records with remapped
  expression, place, source, pending-result, and payload IDs.
- `HirTerminalCall` becomes a mono terminal-call record with a remapped closure
  obligation.
- `HirPrivateStateTransition` becomes a mono transition record with a remapped
  private-state place.
- `HirFactOrigin` becomes a mono fact origin with substituted predicate
  arguments, `ensure` expressions, platform ensured facts, or match refinement
  references.
- `HirPlatformContractEdge` becomes a mono platform contract edge with
  preserved `primitiveId`, `contractId`, `targetId`, certificate fingerprint,
  remapped source requirement IDs, substituted ensured facts, and remapped call
  expression ID when the edge came from a call.
- `HirImageOrigin` becomes image-owned mono image origin metadata once for the
  selected image.

Platform ensured facts are owned by `HirPlatformContractEdge`. A
`HirFactOrigin` with `platformEnsure` content is a derived fact-origin record
that must reference an ensured fact present on the edge. If the fact origin and
edge disagree, the edge is authoritative for the platform contract and mono
emits inconsistent-platform-ensured-fact.

Every proof metadata reference in the instantiated body must point at the mono
record, not the source HIR record. Later Proof MIR receives instantiated proof
IDs and source origins; it should not need to consult generic HIR to determine
which obligation, session, brand, or platform edge a concrete operation uses.

## Platform Primitive Retention

Platform primitive reachability flows through certified platform function
bindings preserved in HIR:

```text
source platform fn
  -> reachable instantiated call site
  -> caller-owned certified HIR platform contract edge
  -> caller-owned mono platform contract edge
  -> reachable PlatformPrimitiveId
```

The monomorphizer does not trust source text that claims to be platform-backed.
It only retains a primitive when the reachable HIR metadata contains a
certified `HirPlatformContractEdge` for the source function or call site.

For every reachable platform call, mono first looks up the caller-owned
`HirPlatformContractEdge` by `(caller proof owner, callExpressionId,
calleeFunctionId)`. It then looks up
`program.monoClosure.certifiedPlatformBindings.get(edge.sourceFunctionId)`.
The HIR edge and binding must agree on `functionId`, `primitiveId`,
`contractId`, `targetId`, and certificate fingerprints. Missing bindings,
missing edges, duplicate edges for the same caller/call/callee tuple, or
mismatched edge/binding authority are closure errors. Source requirements and
ensured facts are instantiated only after this consistency check passes.

In v1, platform contract edges are instantiated per reachable call site. The
certified platform function is still a reachable bodyless function instance,
but mono does not add a second per-function platform edge merely because the
function exists. Declaration-level platform-token brands remain keyed by their
minting origin and may be shared by all call-site edges that reference the same
certified source function and target contract.

External entry roots must be source-body functions. A certified platform
function cannot be an image entry, device handler, hardware callback, or
target-required source root in v1 because it has no source body and no
caller-owned platform contract edge. If malformed HIR marks a certified
platform function as an external root, mono emits a closure diagnostic instead
of retaining a primitive from the function declaration alone.

The output `reachablePlatformPrimitiveIds` list is a derived summary of mono
platform contract edges, not an independent source of truth. After proof
metadata instantiation, mono computes the set from reachable
`MonoPlatformContractEdge.primitiveId` values, sorts it by deterministic
code-unit order, and verifies in tests that it exactly matches the primitive IDs
present in `MonomorphizedHirProgram.proofMetadata.platformContractEdges`. A
primitive appears once even if multiple reachable source declarations or
function instances bind to it.

Platform functions may be generic only if every reachable call supplies
concrete type arguments and the certified target contract can be instantiated
without type parameters. A reachable platform edge with unresolved generic
types is a closure error.

## Closed Boundary Checks

After DFS discovery and SCC/topological validation, the phase performs a
closed-boundary scan over the output. The scan rejects:

- any checked type containing an unresolved type parameter
- any resource kind containing an unresolved type parameter or unresolved kind
  expression
- any function signature, local, expression, field, requirement, proof
  expression, proof fact, resource place, validation, attempt, terminal call,
  private-state transition, or platform ensured fact that still refers to a
  generic declaration instead of a concrete instance
- any source type field needed for a reachable type instance that is absent from
  `program.fields`
- any explicit instance-level resource-kind eligibility rule that fails after
  concretization
- any reachable direct or mutual function recursion cycle
- any reachable direct or mutual source type instantiation cycle
- any polymorphic-recursive instantiation cycle that changes the concrete type
  vector for a source function or owner type on the active stack
- any reachable proof metadata reference whose source record is missing or owned
  by the wrong HIR owner
- any inline proof metadata payload that disagrees with the global
  `program.proofMetadata` record for the same HIR proof ID
- any reachable platform contract edge that disagrees with the corresponding
  certified platform binding record
- any reachable HIR error expression, error statement, error resource kind, or
  bodyless recovery function
- any reachable generic function call without concrete type arguments
- any reachable generic type construction without concrete type arguments
- any platform contract edge whose required or ensured facts cannot be
  concretized

These checks are hard errors. The result is `kind: "error"` and no closed
`MonomorphizedHirProgram`.

The scan should report the most specific source origin available. For example,
a missing call type argument should point at the call expression; an unresolved
field type should point at the source field; a platform ensured fact that still
mentions a type parameter should point at the platform call or certified source
platform declaration.

## Diagnostics

Mono diagnostics have severity. A successful `kind: "ok"` result may contain
only warnings or info diagnostics; v1 does not currently need any. Any error
severity diagnostic returns `kind: "error"` and no closed
`MonomorphizedHirProgram`.

User-program closure error families:

- missing selected image
- selected image missing entry function
- missing reachable source function, type, validated buffer, or proof metadata
  record
- missing HIR field data for a reachable source type
- missing HIR target type-kind or constructor-kind rule for a reachable type
- reachable HIR recovery or error node
- generic arity mismatch
- owner type argument arity mismatch
- missing concrete type argument for reachable function or type instance
- recursive function call cycle
- recursive source type instantiation cycle
- polymorphic recursive instantiation cycle
- unresolved type parameter after substitution
- unresolved resource kind after substitution
- instance resource-kind eligibility failure
- dangling or owner-mismatched proof metadata reference
- unresolved call target in reachable code
- certified platform binding missing for a reachable platform function
- platform contract edge missing for a reachable certified platform call
- platform contract edge contains unresolved polymorphism

Inconsistent-HIR error families:

- ambiguous selected image in inconsistent HIR input
- platform contract edge and certified binding mismatch
- duplicate platform contract edge for the same caller/call/callee tuple
- inconsistent proof metadata duplicate
- inconsistent platform ensured fact duplicate
- duplicate canonical instantiation key with incompatible source data
- duplicate or out-of-order declared type-parameter keys in HIR

Inconsistent-HIR diagnostics indicate a bug in HIR lowering, an invalid test
fixture, or manual construction of malformed HIR. They are still deterministic
mono errors because mono is the first phase that consumes the closed HIR
surface, but callers should not present them as ordinary source-language
mistakes when an upstream compiler bug report would be more accurate.

Diagnostics are sorted by source span, owner key, diagnostic code, and stable
detail using code-unit string comparison. Suppression uses one simple rule:
emit at most one root diagnostic per `(canonicalInstanceKey, diagnosticCode,
rootCauseKey)`, then attach later discoveries as related context edges. Do not
flood every downstream record derived from the same unresolved substitution.
Diagnostics emitted before an image or canonical instance exists use the stable
bucket key `pre-image` as their `canonicalInstanceKey`. Image-owned diagnostics
use `image:<imageId>` once an image is known.

Root diagnostic selection is deterministic:

- Report arity and missing-substitution errors at the call site or type
  application that created the bad instance.
- Report recursion at the edge that rediscovers an active function or type
  instance, with the active ancestor as related context. If the source function
  or source type is the same but the concrete type vector differs, use the more
  specific polymorphic-recursion diagnostic.
- Report resource-kind concretization and eligibility errors at the source type,
  field, parameter, or call-site requirement whose concrete kind failed.
- Report dangling proof metadata at the body node or metadata record that
  references the missing source proof ID.
- Suppress duplicate downstream unresolved-type or unresolved-kind diagnostics
  inside the same canonical instance after the root substitution failure has
  been emitted.

## Determinism

All observable output must be deterministic for the same typed HIR input:

- Work items are keyed by canonical instantiation keys.
- DFS expansion sorts outgoing edges by canonical edge key before recursing;
  output tables are sorted after discovery.
- Function, type, validated-buffer, proof metadata, and platform primitive
  tables expose deterministic `entries()` order.
- Canonical type fingerprints and source IDs, not object identity, define
  deduplication.
- Sorting uses code-unit comparison only. Do not use `localeCompare`.
- Diagnostics include stable owner keys and stable detail strings.

Deterministic output matters because Proof MIR, layout, codegen, binary
emission, tests, and future cache keys all consume monomorphized HIR.

## Testing Strategy

Unit tests should cover:

- semantic constructor resource-kind rule production for proof-relevant applied
  source constructors, including a regression that ordinary join would collapse
  the kind to `Linear`
- HIR mono-closure surface construction for type, field, target-kind,
  constructor-kind, platform-binding, ordered type-parameter, and
  external-entry-root data
- type source classification preservation from `HirTypeRecord` to
  `MonoTypeInstance`
- mono HIR schema table APIs and remap indexes
- canonical function and type instantiation keys
- injectivity and length-delimited segment behavior for canonical key strings
- substitution of checked types and resource kinds
- `MonoCheckedType` factory rejection for nested generic, derived, parametric,
  and error shapes
- detection of unsafe `MonoCheckedType` construction outside the normalization
  factory through lint-like unit coverage or code-review checklist tests
- resource-kind concretization for parametric, join, applied-constructor,
  field-aggregation, and target-declared cases
- field-aggregation cycle detection through the shared type-instantiation guard
- instance-level resource-kind eligibility checks
- substitution failure diagnostics for unresolved type parameters
- function body instantiation with remapped locals, expressions, and calls
- type instance instantiation with field types and validated-buffer metadata
- source type field lookup through HIR field tables
- proof metadata remapping for every HIR proof metadata table
- dangling proof metadata diagnostics
- call-site requirement instantiation
- platform contract edge instantiation and primitive ID retention
- platform edge lookup by caller owner, call expression, and callee function
- derived `reachablePlatformPrimitiveIds` agreement with mono platform contract
  edges
- direct function recursion rejection
- mutual function recursion rejection
- recursive source type instantiation rejection
- polymorphic recursion rejection for functions and types
- SCC/topological validation of the retained instantiation graph
- pre-image diagnostic suppression buckets
- closed-boundary scanning
- deterministic diagnostic ordering

Integration tests should cover:

- typed HIR exposing all data mono needs without passing `CheckedSemanticProgram`
- a selected image whose entry reaches ordinary project functions
- project code reaching vendored or replacement stdlib source as ordinary HIR
- project or stdlib code reaching package modules
- generic function and generic type instantiation from multiple call sites
- method instantiation for two concrete owner type instances with a non-generic
  method body
- deduplication of identical generic instances
- retained instantiation-graph edges for two call sites that dedupe to one
  function instance
- distinct instantiated proof IDs for two instances of the same generic function
- rejection of reachable direct and mutual function recursion
- rejection of direct and mutual source type recursion through fields
- rejection of polymorphic recursion that grows the concrete type vector
- reachable `take`, validation, attempt, terminal, private-state, predicate,
  `ensure`, match-refinement, and platform ensured-fact metadata
- retention of reachable platform primitive IDs through certified platform
  bindings
- rejection of unresolved polymorphism at the whole-image boundary
- determinism under shuffled HIR table construction where the public tables
  expose the same logical entries

## Suggested Implementation Order

This design is intentionally three deliverables: HIR closure-surface expansion,
monomorphized HIR schema, and the mono algorithm/proof/platform implementation.
The implementation should land them in that order rather than trying to build
all proof and platform behavior in the first slice.

1. Extend semantic surface checking to produce constructor resource-kind rules
   for applied source constructors without collapsing proof-relevant
   constructors through ordinary join.
2. Extend typed HIR with `HirTypeTable`, `HirFieldTable`, type source
   classification, ordered declared type-parameter keys, call owner-argument
   data, deterministic platform-edge lookup indexes, and
   `HirMonoClosureSurface`, populated from checked semantic facts during HIR
   lowering.
3. Add mono IDs, diagnostics, canonical key helpers, `MonoCheckedType`
   normalization, deterministic table helpers, and the concrete
   `MonomorphizedHirProgram` / `MonoBlock` / expression / statement / proof
   metadata schema.
4. Implement the first closable slice: image-root seeding, non-generic
   source-body reachability, minimal function/type instance construction,
   certified platform leaves, DFS recursion rejection, SCC validation, and
   closed output for non-generic HIR without proof metadata cloning.
5. Add checked type substitution and resource-kind concretization over the HIR
   mono-closure surface.
6. Add generic function and type instances, owner/function type-argument
   zipping, recursive function/type cycle rejection, and deduplication.
7. Add validated-buffer metadata attachment to canonical `MonoTypeInstance`
   records.
8. Add instance-level kind eligibility checks for explicit checked surfaces.
9. Add proof metadata instantiation and reference remapping with
   `InstantiatedProofId`.
10. Add platform primitive retention from reachable call-site mono platform
    contract edges and derive `reachablePlatformPrimitiveIds` from the output
    edge table.
11. Add closed-boundary scanning and hard error result behavior.
12. Add public API barrels and integration tests.

The implementation should use fakes through dependency injection, keep runtime
source dependency-free, and run the repository agent check before handoff.
