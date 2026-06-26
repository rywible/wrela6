# Semantic Surface Checking Design

## Purpose

Semantic surface checking is the compiler phase after name resolution and before
typed HIR lowering. It groups the checks that need resolved source references,
selected-target contracts, and source declaration shapes, but that should run
before HIR accepts proof-relevant platform and image edges.

This subsystem has three internal subpasses:

- type and resource kind checking
- platform primitive binding certification
- image surface and image root checking

These subpasses belong together because HIR needs one coherent checked semantic
surface: typed declarations and signatures, resource kinds, certified platform
primitive bindings, and a typed image root that seeds reachability. They should
remain separately testable internally because declaration typing is reusable
across image roots, while image checking is root-specific.

Semantic surface checking does not prove path-sensitive resource behavior. It
classifies declarations, validates contracts, and preserves enough typed,
source-origin information for HIR, monomorphization, layout, and Proof MIR to do
their work without re-walking CSTs or trusting source-written platform claims.

## Goals

- Validate resolved type references in declarations, signatures, bounds,
  interface clauses, image fields, and platform declarations.
- Check generic parameter lists, generic bounds, and interface constraints.
- Assign resource kinds to source type declarations, core builtin types, and
  signature positions.
- Check function signatures, including parameters, receivers, returns,
  parameter modes, receiver modes, and declaration modifiers.
- Complete deferred member references whose receiver owner is known from
  checked declaration, signature, interface, platform, or image surfaces.
- Preserve proof-surface seeds that HIR needs for resource places,
  requirements, predicate facts, terminal behavior, validation/attempt origins,
  private-state transitions, image/device origins, and platform contracts.
- Reject declaration shapes that are illegal before HIR, such as malformed
  target-bound platform declarations.
- Certify name-only platform primitive bindings from name resolution against
  the selected target's full platform primitive catalog.
- Reject missing, mismatched, non-exact, target-unavailable, or
  non-freestanding target-bound platform declarations.
- Select the `uefi image` root for the build.
- Validate `devices:` sections, image device fields, unique edge root binding,
  target platform surface availability, and image entry shape.
- Produce deterministic diagnostics and deterministic checked tables.
- Keep filesystem access, package loading, target selection, HIR lowering, MIR,
  proof checking, code generation, and binary emission outside this phase.

## Non-Goals

- This phase does not parse source files, discover imports, or load modules.
- This phase does not assign module, item, function, type, image, field, or
  parameter IDs. The item index owns those IDs.
- This phase does not perform name resolution. It consumes
  `ResolvedReferences` and name-only `ResolvedPlatformBindings`.
- This phase does not infer or check every block-local variable. HIR lowering
  owns local scope construction and source-shaped expression lowering.
- This phase does not assign final proof IDs for obligations, sessions, brands,
  resource places, validation results, attempt inputs, private-state
  transitions, call-site requirements, or fact origins. HIR owns those IDs after
  it has lowered source-shaped bodies.
- This phase does not run whole-program reachability beyond producing the image
  seed. Monomorphization owns full reachable-function and reachable-type
  closure.
- This phase does not compute representation size, alignment, field offsets,
  enum layouts, stack ABI shapes, or target calling sequences.
- This phase does not prove moves, consumes, loans, `take` closure, terminal
  closure, predicate fact availability, `requires` discharge, or validated
  buffer proofs.
- This phase does not give stdlib source any private compiler authority. A
  vendored or replacement stdlib is checked as ordinary source.
- This phase does not lower platform primitives. It certifies source handles
  against catalog contracts and leaves lowering IDs attached for later phases.
- This phase does not implement incremental compilation.

## Repository Shape

```text
src/
  semantic/
    surface/
      index.ts
      diagnostics.ts
      semantic-surface-checker.ts
      checked-program.ts
      deferred-member-completer.ts
      type-model.ts
      type-reference-checker.ts
      generic-checker.ts
      interface-checker.ts
      resource-kind.ts
      resource-kind-checker.ts
      signature-checker.ts
      platform-surface.ts
      platform-certifier.ts
      image-root-selection.ts
      image-device-checker.ts
      image-entry-checker.ts
      proof-surface.ts
      reference-lookup.ts
      deterministic-sort.ts

tests/
  support/
    semantic/
      semantic-surface-fakes.ts

  unit/
    semantic/
      surface/
        type-reference-checker.test.ts
        generic-checker.test.ts
        interface-checker.test.ts
        resource-kind-checker.test.ts
        signature-checker.test.ts
        platform-certifier.test.ts
        image-root-selection.test.ts
        image-device-checker.test.ts
        image-entry-checker.test.ts
        reference-lookup.test.ts
        diagnostics.test.ts

  integration/
    semantic/
      semantic-surface.test.ts
      semantic-surface-determinism.test.ts
      public-api.test.ts
```

`src/semantic/surface` may depend on `frontend/ast`,
`frontend/module-graph-parser`, `semantic/ids`, `semantic/item-index`,
`semantic/names`, and shared diagnostics. It may depend on target-facing
catalog interfaces that are passed in through dependency injection.

It must not depend on filesystem APIs, Bun APIs, package manifest parsing,
actual target backends, HIR, MIR, proof checking, code generation, linkers, or
PE/COFF emission.

## Public API

Semantic surface checking is exported from `src/semantic/surface/index.ts` and
re-exported from the semantic barrel:

```ts
import { buildItemIndex, checkSemanticSurface, resolveNames } from "./src/semantic";

const itemIndexResult = buildItemIndex({
  graph: parsedModuleGraph,
});

const coreTypes = CoreTypeCatalog.default();

const nameResult = resolveNames({
  graph: parsedModuleGraph,
  index: itemIndexResult.index,
  coreTypes,
  platformPrimitiveNames: selectedTarget.platformPrimitiveNames,
});

const surfaceResult = checkSemanticSurface({
  graph: parsedModuleGraph,
  index: itemIndexResult.index,
  references: nameResult.references,
  platformBindings: nameResult.platformBindings,
  coreTypes,
  targetSurface: selectedTarget.semanticSurface,
  imageRoot: requestedImageRoot,
});
```

The phase returns a pure result:

```ts
export interface CheckSemanticSurfaceInput {
  readonly graph: ParsedModuleGraph;
  readonly index: ItemIndex;
  readonly references: ResolvedReferences;
  readonly platformBindings: ResolvedPlatformBindings;
  readonly coreTypes: CoreTypeCatalog;
  readonly targetSurface: SemanticTargetSurface;
  readonly imageRoot?: ImageRootSelection;
}

export interface CheckSemanticSurfaceResult {
  readonly program: CheckedSemanticProgram;
  readonly image: CheckedImageSeed | undefined;
  readonly diagnostics: readonly SemanticSurfaceDiagnostic[];
}

export function checkSemanticSurface(input: CheckSemanticSurfaceInput): CheckSemanticSurfaceResult;
```

The result stays total over recovered syntax and failed checks. When a type or
signature cannot be checked, the checker records an error type or error
resource kind in the affected slot, emits diagnostics, and continues checking
other declarations.

`checkSemanticSurface` does not combine lexer, parser, item-index, or
name-resolution diagnostics. The caller owns diagnostic aggregation and
source-order presentation across phases.

## Target Surface Input

Name resolution receives only the names-and-IDs projection of platform
primitives. Semantic surface checking receives the selected target's full
semantic catalog:

```ts
export type TargetId = string & { readonly __brand: "TargetId" };
export type PlatformContractId = string & { readonly __brand: "PlatformContractId" };
export type ImageProfileId = string & { readonly __brand: "ImageProfileId" };
export type DeviceSurfaceId = string & { readonly __brand: "DeviceSurfaceId" };
export type PlatformPrimitiveFamilyId = string & {
  readonly __brand: "PlatformPrimitiveFamilyId";
};
export type TargetTypeId = string & { readonly __brand: "TargetTypeId" };

export interface SemanticTargetSurface {
  readonly targetId: TargetId;
  readonly platformPrimitives: PlatformPrimitiveCatalog;
  readonly imageProfiles: readonly ImageProfileSpec[];
  readonly deviceSurfaces: readonly DeviceSurfaceSpec[];
}

export interface PlatformPrimitiveSpec {
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly availability: TargetAvailability;
  readonly signature: TargetFunctionSignature;
  readonly proofContract: TargetProofContractSurface;
}

export interface PlatformPrimitiveCatalog {
  get(primitiveId: PlatformPrimitiveId): PlatformPrimitiveSpec | undefined;
  entries(): readonly PlatformPrimitiveSpec[];
}

export interface TargetAvailability {
  readonly targetId: TargetId;
  readonly profiles: readonly ImageProfileId[];
  readonly features: readonly string[];
}

export interface TargetFunctionSignature {
  readonly genericArity: number;
  readonly receiver: TargetParameterSpec | undefined;
  readonly parameters: readonly TargetParameterSpec[];
  readonly returnType: CheckedType;
  readonly returnKind: CheckedResourceKind;
  readonly requiredModifiers: readonly FunctionModifier[];
  readonly forbiddenModifiers: readonly FunctionModifier[];
}

export interface TargetParameterSpec {
  readonly type: CheckedType;
  readonly mode: CheckedParameterMode;
  readonly resourceKind: CheckedResourceKind;
}

export interface TargetProofContractSurface {
  readonly requiredFacts: readonly CheckedRequirementSurface[];
  readonly ensuredFacts: readonly CheckedRequirementSurface[];
}

export interface ImageProfileSpec {
  readonly profileId: ImageProfileId;
  readonly name: string;
  readonly declarationKind: "uefi";
  readonly entryFunctionName: string;
  readonly entrySignature: TargetFunctionSignature;
  readonly availableDeviceSurfaces: readonly DeviceSurfaceId[];
  readonly availablePlatformFamilies: readonly PlatformPrimitiveFamilyId[];
}

export interface DeviceSurfaceSpec {
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly name: string;
  readonly availability: TargetAvailability;
  readonly resourceKind: ConcreteResourceKind;
  readonly uniqueEdgeRoots: readonly UniqueEdgeRootKey[];
}
```

The target surface is compiler-owned data, but it is not a backend. It is a
pure catalog that describes source-visible semantic contracts:

- platform primitive signatures
- required function modifiers and freestanding-only rules
- parameter modes and receiver modes
- result types and resource kinds
- generic arity and bounds, if any
- proof contract IDs and visible `requires` summaries
- target and image-profile availability
- image entry signature requirements
- device surface names and resource kinds

Actual ABI lowering, firmware call sequences, generated entry thunks, and
binary-specific details belong to later target and backend layers.

Tests should use small fake target surfaces through dependency injection. They
must not use real backend objects or filesystem fixtures.

## Checked Program Model

`CheckedSemanticProgram` is a declaration-level semantic table for HIR lowering:

```ts
export interface CheckedSemanticProgram {
  readonly types: CheckedTypeTable;
  readonly functions: CheckedFunctionTable;
  readonly fields: CheckedFieldTable;
  readonly genericParameters: CheckedGenericParameterTable;
  readonly completedMembers: CompletedMemberReferenceTable;
  readonly proofSurface: CheckedProofSurface;
  readonly certifiedPlatformBindings: CertifiedPlatformBindingTable;
}
```

The tables are keyed by IDs assigned earlier:

```text
TypeId
FunctionId
FieldId
ParameterId
ImageId
```

Type parameters do not need dense global IDs in v1. They can be addressed by an
owner key plus source index:

```text
TypeParameterKey = TypeParameterOwner + index
```

If a later HIR design needs branded type-parameter IDs, it can introduce them
when HIR assigns proof-relevant metadata. This phase should avoid new global ID
families unless an implementation need is concrete.

Checked records preserve source spans for every user-facing component:

- declaration name
- type reference
- bound or interface constraint
- parameter mode
- receiver mode
- return type
- function modifier
- platform binding site
- image root name
- image device field

Those spans let later phases report diagnostics without recovering syntax
locations from raw CST structure.

## Proof Surface Preservation

Semantic surface checking is the last semantic layer before HIR creates the
source-shaped proof surface. It must therefore preserve every checked source
fact that HIR needs to assign proof IDs and every target-owned contract edge
that Proof MIR later checks.

The phase should record proof-surface seeds, not final proof IDs:

```ts
export interface CheckedProofSurface {
  readonly resourceKindByType: ResourceKindTable;
  readonly signatureModes: CheckedSignatureModeTable;
  readonly requirementSurfaces: CheckedRequirementSurfaceTable;
  readonly predicateFactSurfaces: CheckedPredicateFactSurfaceTable;
  readonly terminalSurfaces: CheckedTerminalSurfaceTable;
  readonly validationSurfaces: CheckedValidationSurfaceTable;
  readonly privateStateSurfaces: CheckedPrivateStateSurfaceTable;
  readonly imageSurfaces: CheckedImageSurfaceTable;
  readonly platformContracts: CertifiedPlatformBindingTable;
}

export interface CheckedRequirementSurface {
  readonly expression: CheckedRequirementExpression;
  readonly span: SourceSpan;
}
```

`CheckedRequirementExpression` is an opaque HIR-facing checked expression
surface. It preserves resolved names, checked types, source spans, and member
completion results, but it does not prove entailment or dominance.

`platformContracts` is the same certified binding table exposed at the top
level. It is listed here to make the proof-surface dependency explicit, not to
create a second source of truth.

This table should preserve:

- resource kinds for all checked type positions and declaration fields
- consume, observe, terminal, and receiver modes from checked signatures
- source spans and checked expressions for `requires` clauses
- predicate and `ensure` declaration surfaces, without dominance facts
- terminal modifiers and terminal entry/call-surface declarations, without
  proving terminal reachability
- validated-buffer section identities, source relationships, and requirement
  declarations, including checked finite integer ranges and checked wire scalar
  encodings from `le` and `be` layout-field markers, without layout-derived
  facts
- validation and attempt source origins that HIR will turn into obligation
  seeds
- private-state type identities and transition signatures, without path
  threading
- image, device, and unique-edge-root origins for image-seeded capabilities
- certified platform primitive binding IDs, target contract IDs, visible
  precondition summaries, and target availability facts

HIR lowering consumes these seeds and assigns stable obligation, session, brand,
resource-place, call-site requirement, private-state transition, validation,
attempt, and fact-origin IDs. Monomorphization later instantiates those IDs for
the closed image. Layout adds representation facts for validated buffers and
ABI-sensitive calls. Proof MIR proves the path-sensitive obligations.

Validated-buffer layout field syntax uses contextual wire-endian markers in
type position, for example `size: le U16 @ 0` or
`ethertype: be U16 @ 12`. Semantic surface checking normalizes those markers
into checked wire scalar encodings, rejects multi-byte integer layout fields
that omit them, and rejects markers on single-byte or opaque byte fields where
byte order has no meaning. It also records finite integer ranges for checked
integer, boolean, and enum values that can feed validated-buffer layout
arithmetic. Later phases consume the checked encoding and ranges; they must not
infer byte order from target endianness or invent range bounds.

The checker must not erase proof-relevant language constructs into ordinary
calls, fields, or booleans. For example, a certified platform function is not
just a function with a target name; it carries a catalog-owned contract ID. An
image device field is not just a typed field; it carries an image/device origin
and may seed a unique edge root. A `requires` clause is not just a parsed
expression; it is a checked requirement surface that HIR can attach to call
sites.

This contract mirrors
`docs/design/proof-derived-compiler-invariants.md`: if HIR cannot recover a
proof-relevant ID or origin from `CheckedSemanticProgram` and `CheckedImageSeed`,
semantic surface checking has dropped necessary proof surface.

## Type Model

The checker should represent type results explicitly instead of passing strings
or syntax nodes forward:

```ts
export type CheckedType =
  | CoreCheckedType
  | SourceCheckedType
  | GenericParameterCheckedType
  | AppliedCheckedType
  | ErrorCheckedType;
```

`CoreCheckedType` wraps a `CoreTypeId`. `SourceCheckedType` wraps a source
`TypeId`. `GenericParameterCheckedType` wraps a `TypeParameterKey`.
`AppliedCheckedType` stores a constructor plus checked type arguments.
`ErrorCheckedType` is stable and deterministic; it lets later checks continue
after one bad type reference.

```ts
export interface AppliedCheckedType {
  readonly kind: "applied";
  readonly constructor: TypeConstructorId;
  readonly arguments: readonly CheckedType[];
  readonly resourceKind: CheckedResourceKind;
}

export type TypeConstructorId =
  | { readonly kind: "source"; readonly typeId: TypeId }
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId };
```

Function types, references, arrays, slices, buffers, and target-visible handles
should not add ad hoc variants to `CheckedType` unless the parser gives them
distinct type syntax with distinct semantics. In v1 they should be represented
as source or target-declared constructors plus `AppliedCheckedType` arguments.
If a future function-type syntax needs variance or effect metadata, that syntax
should add one explicit variant and a matching resource-kind rule.

Type-reference validation uses `ResolvedReferences` for names. It does not
perform string lookup by re-reading identifier text. The checker verifies that
the resolved item has type meaning in the current position, checks generic
arity, and checks type-argument bounds after the referenced constructor's
generic parameters are known.

Name resolution owns source declarations that shadow core builtin type names in
type position. Semantic surface checking assumes those diagnostics have already
been emitted and treats unresolved or shadowed builtin references like ordinary
failed references. The core type catalog remains language-owned and is not an
implicit stdlib prelude.

## Generic Parameters And Interface Constraints

Generic parameters are checked in declaration context:

- duplicate parameter names within one owner
- illegal self-references in bounds
- unknown or non-interface bounds
- wrong type-argument arity in bounds
- bound cycles that can be detected without monomorphization
- constraints that mention explicit target-declared interface surfaces that are
  unavailable for the selected target profile

Interface constraints are source-level shape checks. The checker records the
declared constraint relationships but does not instantiate generics or solve
whole-program trait/interface dispatch.

The output for each generic owner should include:

```ts
export interface CheckedGenericSignature {
  readonly owner: TypeParameterOwner;
  readonly parameters: readonly CheckedGenericParameter[];
  readonly constraints: readonly CheckedInterfaceConstraint[];
}

export interface CheckedGenericParameter {
  readonly key: TypeParameterKey;
  readonly name: string;
  readonly bounds: readonly CheckedInterfaceConstraint[];
  readonly span: SourceSpan;
}

export interface CheckedInterfaceConstraint {
  readonly interfaceType: CheckedType;
  readonly arguments: readonly CheckedType[];
  readonly span: SourceSpan;
}
```

HIR lowering and monomorphization consume this checked signature. Proof MIR does
not resolve generic bounds directly; it sees monomorphized types and obligations.

## Resource Kind Model

Resource kinds classify how values of a type may participate in ownership,
movement, and proof-relevant operations:

```text
Copy
Affine
Linear
UniqueEdgeRoot
EdgePath
Stream
ValidatedBuffer
PrivateState
SealedPlatformToken
Never
Error
```

These are concrete resource kinds. `Error` is an internal recovery kind. It is
not source-visible.

Pre-monomorphization signatures cannot always have a single concrete kind. A
function returning `T` or `Box[T]` may depend on a generic parameter's eventual
instantiation. The checker therefore records resource-kind expressions:

```ts
export type CheckedResourceKind =
  | { readonly kind: "concrete"; readonly value: ConcreteResourceKind }
  | { readonly kind: "parametric"; readonly parameter: TypeParameterKey }
  | {
      readonly kind: "derived";
      readonly rule: ResourceKindDerivationRule;
      readonly arguments: readonly CheckedResourceKind[];
    }
  | { readonly kind: "error" };
```

`ConcreteResourceKind` excludes `Error`. `CheckedResourceKind` is the type that
appears in checked signatures and applied types. Monomorphization instantiates
all `parametric` and `derived` kinds for the closed image and rejects any
unresolved kind expression at the whole-image boundary.

The exact lattice can evolve, but the checker must centralize the ordering and
combination rules in one small module. It should not scatter resource-kind
conditionals across signature, platform, and image checkers.

Initial rules:

- Core scalar types are `Copy`.
- `Never` is `Never`.
- A generic parameter used as a type has a `parametric` resource kind unless a
  bound fixes it to a concrete kind.
- A type declaration may derive its default concrete ownership class from its
  fields: `Copy` when every field is `Copy` or `Never`, `Affine` when at least
  one field is `Affine` and no field is linear or proof-relevant, and `Linear`
  when any field is `Linear` or proof-relevant.
- A type declaration may declare a more specific proof-relevant concrete kind,
  such as `Stream`, `ValidatedBuffer`, `PrivateState`, or `UniqueEdgeRoot`, only
  when its declaration form or target surface authorizes that kind.
- Field-sensitive proof surfaces preserve each field's own kind. An aggregate
  whose top-level kind is `Linear` may still expose a `Stream` or
  `UniqueEdgeRoot` field as a distinct proof-relevant place in HIR.
- Type constructors use explicit `ResourceKindDerivationRule`s. Common rules
  include fixed concrete kind, transparent argument kind, and conservative join
  of argument ownership classes. If any argument is affine, linear, parametric,
  or proof-relevant, the applied type must not silently become `Copy`.
- Image device fields that mint root capabilities must have resource kind
  `UniqueEdgeRoot` or a target-declared resource kind that lowers to it.
- Platform tokens and private state wrappers must come from target surfaces or
  source declarations that the checker can classify without trusting stdlib
  paths.

Resource-kind joins are conservative:

```text
join(Copy, Copy) = Copy
join(Copy, Affine) = Affine
join(Affine, Affine) = Affine
join(_, Linear) = Linear
join(_, proof-relevant kind) = Linear unless an authorized declaration rule
  preserves a more specific proof-relevant kind
join(_, Parametric or Derived) = Derived(join, [...])
join(_, Error) = Error
```

This rule prevents generic wrappers and ordinary aggregates from erasing
resource ownership. It also avoids manufacturing a specific proof-relevant kind
for an ordinary struct merely because it contains a proof-relevant field; HIR
keeps the field place specific.

Path-sensitive rules such as consume-exactly-once, use-after-move, loan
validity, and terminal closure are not resource-kind assignment. They belong to
Proof MIR.

## Signature Checking

The signature checker validates source declarations before HIR creates typed
function nodes:

- parameter type references
- receiver type and receiver mode
- return type
- parameter modes such as consume, observe, or future mode syntax
- modifier combinations such as `platform`, `terminal`, `predicate`,
  `constructor`, and `private`
- function ownership, including freestanding functions versus methods
- generic parameter lists and constraints
- `requires` declarations that are visible at the signature surface

The output for each source function should include:

```ts
export interface CheckedFunctionSignature {
  readonly functionId: FunctionId;
  readonly ownerItemId: ItemId;
  readonly genericSignature: CheckedGenericSignature | undefined;
  readonly receiver: CheckedReceiver | undefined;
  readonly parameters: readonly CheckedParameter[];
  readonly returnType: CheckedType;
  readonly returnKind: CheckedResourceKind;
  readonly modifiers: CheckedFunctionModifiers;
  readonly sourceSpan: SourceSpan;
}

export interface CheckedReceiver {
  readonly type: CheckedType;
  readonly mode: CheckedParameterMode;
  readonly span: SourceSpan;
}

export interface CheckedParameter {
  readonly parameterId: ParameterId;
  readonly type: CheckedType;
  readonly mode: CheckedParameterMode;
  readonly resourceKind: CheckedResourceKind;
  readonly span: SourceSpan;
}

export type CheckedParameterMode = "observe" | "consume" | "terminal";

export interface CheckedFunctionModifiers {
  readonly isPrivate: boolean;
  readonly isPlatform: boolean;
  readonly isTerminal: boolean;
  readonly isPredicate: boolean;
  readonly isConstructor: boolean;
}
```

The checker should attach diagnostics to the narrowest useful source span. For
example, an invalid return type points at the return type reference, while an
illegal modifier combination points at the modifier token or modifier list.

## Deferred Member Completion

Name resolution resolves owner-explicit member references and records deferred
member references for sites whose owner cannot be known from syntax alone.
Semantic surface checking completes only the deferred sites whose receiver owner
is available from checked declaration-level information:

- fields and layout fields whose containing type is known
- enum cases in checked type or pattern surfaces
- image device fields in selected-image surfaces
- member functions named in interface constraints
- member functions or fields named in platform and requirement surfaces when
  their receiver type is already checked

The result is a `CompletedMemberReferenceTable` keyed by the original
`SyntaxReferenceKey`:

```ts
export interface CompletedMemberReferenceTable {
  get(key: SyntaxReferenceKey): ResolvedReference | undefined;
  entries(): readonly CompletedMemberReference[];
}
```

This table does not need to cover every body expression. If a deferred member
site depends on a block-local binding, inference through control flow, or a
source expression that HIR lowering owns, semantic surface checking leaves that
site deferred. HIR lowering then completes it after building local scopes and
expression types, using the same deterministic `MemberNamespace` API from name
resolution.

Every completed or still-deferred site must remain explicit. A deferred member
reference must either become a normal resolved reference at a typed layer or
produce an unresolved/ambiguous diagnostic with the original member span. It
must never disappear because syntax-only resolution could not classify it.

## Platform Primitive Certification

Name resolution produces name-only platform bindings:

```text
source FunctionId -> PlatformPrimitiveId
```

Semantic surface checking turns a valid binding into a certified binding:

```ts
export interface CertifiedPlatformBinding {
  readonly functionId: FunctionId;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
  readonly certificate: PlatformPrimitiveBindingCertificate;
}

export interface PlatformPrimitiveBindingCertificate {
  readonly kind: "exactCatalogMatch";
  readonly signatureFingerprint: string;
  readonly proofContractFingerprint: string;
}
```

Certification compares the source declaration against the full target primitive
specification. The v1 rule is exact structural mirroring: source signatures and
visible proof contracts must match the catalog shape byte-for-byte after the
checker normalizes names to IDs and sorts deterministic lists. It must reject:

- a source `platform fn` that has no name-only binding
- a name-only binding whose primitive ID is absent from the full target catalog
- non-freestanding target-bound platform declarations in v1
- generic arity mismatches
- parameter count mismatches
- parameter type or resource-kind mismatches
- receiver mismatches
- return type or resource-kind mismatches
- missing required modifiers
- forbidden modifiers
- any source `requires` clause, postcondition, or visible fact surface that does
  not exactly mirror the primitive contract
- primitives unavailable for the selected target, image profile, or configured
  target features

The source declaration is not trusted because it says `platform`. Certification
is the only path by which a source function receives a catalog-owned contract ID
that HIR and Proof MIR may consume.

A later checker may allow a source declaration to state a provably stronger
contract than the catalog, but that requires entailment and belongs with the
proof system. Semantic surface v1 does not compare predicate strength.

Platform certification should not inspect call sites. It certifies declaration
handles. Proof MIR later checks primitive preconditions at each call site like
ordinary `requires` obligations.

## Image Root Selection

The image checker starts after declarations and platform bindings have been
checked. It selects a single `uefi image` declaration for the current build.

`ImageRootSelection` is a build-edge value, not a source reference:

```ts
export type ImageRootSelection =
  | { readonly kind: "byImageId"; readonly imageId: ImageId }
  | {
      readonly kind: "byQualifiedName";
      readonly modulePath: ModulePath;
      readonly imageName: string;
      readonly span?: SourceSpan;
    };
```

The compiler edge may build this from a CLI flag, package manifest field, or
API argument. If the value came from source, the edge may also attach a
`SourceSpan` for diagnostics; otherwise selection diagnostics are build-level.

Selection rules:

- If the caller provides `ImageRootSelection`, resolve it to an `ImageId` using
  item-index and name-resolution outputs.
- If the caller provides no selection and there is exactly one source image,
  select it.
- If there are no source images, emit a missing-image-root diagnostic.
- If there are multiple source images and no explicit selection, emit an
  ambiguous-image-root diagnostic with sorted candidates.
- If an explicit selection names a non-image item or an unloaded module, emit a
  source-level diagnostic when a source span exists, otherwise emit a build-level
  diagnostic.

Profile selection is separate from root selection. Each image declaration names
or implies an image profile through its declaration form. In v1, `uefi image`
maps to the selected target's `uefi` image profile. Future image declaration
forms or explicit image-profile syntax can select other `ImageProfileSpec`s, but
the checker must reject an image whose declaration form has no available
profile in `targetSurface.imageProfiles`.

Root selection produces a `CheckedImageSeed` only when the selected image has
enough checked shape to seed HIR and monomorphization:

```ts
export interface CheckedImageSeed {
  readonly imageId: ImageId;
  readonly profileId: ImageProfileId;
  readonly entryFunctionId: FunctionId;
  readonly devices: readonly CheckedImageDevice[];
  readonly sourceSpan: SourceSpan;
}

export interface CheckedImageDevice {
  readonly fieldId: FieldId;
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly type: CheckedType;
  readonly resourceKind: CheckedResourceKind;
  readonly uniqueEdgeRoots: readonly UniqueEdgeRootKey[];
  readonly span: SourceSpan;
}
```

The seed is not the whole reachable program. It is the typed root from which
later phases collect reachable functions, types, generic instantiations, and
platform primitive bindings.

## Image Devices And Unique Roots

Image device fields are checked as image-specific declarations, not ordinary
class fields. The checker validates:

- the `devices:` section shape
- device field type references
- device field resource kinds
- duplicate or conflicting device root bindings
- target availability for each requested device surface
- image-profile availability for each device
- source spans for every device field and root capability

Each bound edge root must be unique within the image graph seed. If two device
fields would mint or bind the same unique edge root, the checker emits a
diagnostic that points at the later binding and includes the earlier binding as
related context.

Unique edge root identity is target-surface-owned:

```ts
export type UniqueEdgeRootKey = string & { readonly __brand: "UniqueEdgeRootKey" };
```

Each `DeviceSurfaceSpec` declares the `UniqueEdgeRootKey`s it mints or binds.
The image checker rejects duplicate keys within one `CheckedImageSeed`. Two
device fields with different `DeviceSurfaceId`s may still conflict if their
target specs declare the same root key; two aliases of the same device surface
therefore cannot accidentally mint the same root capability twice.

The checker may record target-provided initialization facts for devices, but it
must not generate entry-thunk code or firmware calls. Runtime initialization
belongs to image runtime and backend lowering.

## Image Entry Shape

The selected image profile defines entry discovery and entry shape. In v1, a
`uefi image` declaration's entry is the image-owned function whose name matches
the selected `ImageProfileSpec.entryFunctionName`, such as `main` or `entry`.
If the profile allows a freestanding entry instead, the spec must say how the
image declaration refers to that function. The semantic checker must not invent
a naming convention outside the target surface.

For UEFI, the target surface may require an entry function with a particular
source-visible shape, such as:

- freestanding or image-owned placement
- allowed parameter list
- allowed return type
- declared access to image/device capabilities
- declared platform primitive family availability
- terminal or non-terminal behavior

The exact UEFI entry signature can evolve with the target design. The image
checker should therefore consume an `ImageProfileSpec` rather than hard-code
entry rules throughout the semantic layer.

Entry rules in this phase are declaration and signature rules. They may check
what capabilities the entry declares, what platform primitive families the
profile makes available, and whether the signature is compatible with those
declarations. They must not inspect the entry body to prove which devices or
platform primitive families it actually uses. Body use, call reachability, and
terminal reachability belong to HIR, monomorphization, and Proof MIR.

Entry shape diagnostics should point at the selected image declaration, the
entry function name, or the offending signature component. If no entry function
can be identified, the diagnostic should point at the image declaration name.

## Data Flow

The phase boundary is:

```text
ParsedModuleGraph
  + ItemIndex
  + ResolvedReferences
  + ResolvedPlatformBindings
  + CoreTypeCatalog
  + SemanticTargetSurface
  + ImageRootSelection?
    -> SemanticSurfaceChecking
      -> CheckedSemanticProgram
      -> CheckedImageSeed?
      -> SemanticSurfaceDiagnostic[]
```

Internal order:

1. Build deterministic views of source declarations from `ItemIndex`.
2. Validate type declarations and generic parameter surfaces.
3. Build checked type signatures and resource-kind records.
4. Check function signatures and declaration modifier legality.
5. Complete declaration-level deferred member references.
6. Certify platform primitive bindings against the full target surface.
7. Select and check the requested image root.
8. Sort result tables and diagnostics.

The order is important because image checking depends on checked type and
resource-kind information, and HIR lowering depends on proof-surface seeds,
certified platform bindings, and a checked image seed.

## Diagnostics

Diagnostics should be deterministic, source-level where possible, and local to
this phase. Suggested diagnostic families:

- invalid type reference in a type-checked position
- non-type item used as a type
- wrong generic argument count
- unsatisfied or malformed generic bound
- invalid interface constraint
- resource kind mismatch
- invalid receiver type or receiver mode
- invalid parameter mode
- invalid return type for a declaration kind
- illegal function modifier combination
- illegal `platform fn` shape
- missing platform primitive binding for a source `platform fn`
- platform primitive catalog entry missing after name-only binding
- platform primitive signature mismatch
- non-exact source platform contract
- target-unavailable platform primitive
- missing image root
- ambiguous image root
- invalid image root selection
- malformed `devices:` section
- invalid image device type
- duplicate unique edge root binding
- target-unavailable image device
- invalid image entry shape

Diagnostics should carry:

```ts
export interface SemanticSurfaceDiagnostic {
  readonly code: SemanticSurfaceDiagnosticCode;
  readonly message: string;
  readonly severity: "error";
  readonly span?: SourceSpan;
  readonly relatedInformation?: readonly DiagnosticRelatedInformation[];
}
```

Use source spans for source-owned mistakes. Use build-level diagnostics without
spans only when the problem comes from a command-line root selection, missing
root, or invalid injected target catalog.

Malformed CST nodes remain navigable. If an AST accessor returns `undefined`,
the checker should skip that component unless it can attach a useful diagnostic
to a present token or parent declaration.

## Determinism Rules

All outputs are built from stable item-index arrays, stable resolved-reference
keys, and sorted target catalogs:

1. Traverse modules in `ModuleId` order.
2. Traverse item, type, function, image, field, and parameter records in dense
   ID order.
3. Normalize target platform primitive specs by primitive name, then
   `PlatformPrimitiveId`.
4. Normalize image profiles by profile name, then `ImageProfileId`.
5. Normalize device surfaces by device name, then `DeviceSurfaceId`.
6. Sort checked type, field, function, generic, platform, and image-device
   tables by their semantic IDs.
7. Sort diagnostics by source path, span start, span end, diagnostic code, and
   stable semantic ID tie-breakers.
8. If two candidates tie on every source-visible property, use dense semantic
   IDs as the final tie-break.

Equivalent module graphs and equivalent target surfaces should produce
byte-for-byte stable result summaries and diagnostics.

Determinism tests should define local summary serializers for the semantic
surface result shape. They should not depend on item-index-specific stable
serialization helpers.

## Layer Boundaries

Semantic surface checking consumes AST views but does not mutate CST nodes,
item-index records, or name-resolution tables.

Later phases consume the result:

```text
HIR lowering
  uses checked signatures, type IDs, resource kinds, proof-surface seeds,
  certified platform primitive bindings, and checked image seed

whole-image monomorphization
  starts from the checked image seed and collects reachable functions, types,
  generic instantiations, and certified platform primitive bindings

layout
  consumes checked and monomorphized types, then computes concrete
  representation and ABI facts

Proof MIR
  consumes resource kinds, obligations, platform contract IDs, and layout facts
  to prove path-sensitive properties

backend lowering
  consumes certified platform primitive IDs and target-owned lowering contracts,
  not source-written platform claims
```

The important boundary is that this phase may trust target catalog data but may
not trust source modules, including stdlib-like source modules.

## Error Recovery

The checker should continue after local failures. Recovery values are explicit:

```text
ErrorCheckedType
Error resource kind
uncertified platform binding
absent CheckedImageSeed
```

Recovery values must not accidentally authorize later phases. HIR lowering may
preserve them for diagnostics, but it must not emit platform primitive contract
edges from uncertified bindings and must not monomorphize from a missing image
seed.

If a declaration has multiple independent errors, the checker should emit all
diagnostics that are useful and non-cascading. For example, a platform function
with the wrong parameter count should report the count mismatch and avoid a
long cascade of per-parameter mismatch diagnostics that follow from the count
failure.

## Testing Strategy

Unit tests should cover:

- core builtin and source type-reference validation
- non-type item used in type position
- generic parameter duplicate names and bound validation
- interface constraint validation
- resource-kind assignment for core, source, applied, image, and error types
- conservative type-constructor resource-kind lifting
- receiver, parameter, return, and modifier checking
- completion of declaration-level deferred member references
- preservation of body-local deferred member references for HIR
- illegal source `platform fn` shapes
- exact platform primitive certification
- platform primitive mismatch diagnostics for arity, parameter, receiver,
  return, modifier, contract, and availability differences
- image root selection with zero, one, many, and explicit roots
- malformed `devices:` sections
- image device type and target availability checks
- duplicate unique edge root diagnostics with related information
- image entry shape diagnostics
- stable diagnostic ordering
- stable checked-table ordering
- proof-surface seeds preserve resource kinds, modes, requirement surfaces,
  platform contract IDs, image/device origins, and validated-buffer section
  identities
- malformed recovered syntax

Integration tests should parse small module graphs and use fake target surfaces:

- a single valid `uefi image`
- multiple images with explicit root selection
- vendored stdlib source declaring ordinary wrappers around certified platform
  functions
- replacement stdlib source receiving no special privilege
- a source `platform fn` that name-resolves but fails certification
- a target-unavailable primitive used by an otherwise valid source declaration
- an image device unavailable for the selected image profile
- an image root that seeds reachable platform primitive bindings
- HIR-facing summaries can recover every proof-surface seed required by
  `docs/design/proof-derived-compiler-invariants.md`

Determinism tests should build equivalent inputs with shuffled module order,
shuffled target primitive catalog order, shuffled image profile order, and
shuffled device surface order. Result summaries and diagnostics must remain
byte-for-byte stable.

Tests use fakes through dependency injection. They do not use mocks, spies,
filesystem reads, or runtime dependencies. `fast-check` may fuzz type graphs,
resource-kind lattice behavior, and diagnostic ordering in tests only.

## Implementation Notes

The first implementation can stay narrow and declaration-focused:

1. Add diagnostic types, result containers, and deterministic sort helpers.
2. Add checked type and resource-kind models, including error recovery values.
3. Validate core and source type references in declaration signatures.
4. Check generic parameters, generic bounds, and interface constraints.
5. Build checked type and field records.
6. Build checked function signatures and modifier legality diagnostics.
7. Add proof-surface seed tables for resource kinds, signature modes,
   requirements, predicates, terminal surfaces, validation/attempt origins,
   private-state transitions, image/device origins, and platform contracts.
8. Complete declaration-level deferred member references through the
   name-resolution `MemberNamespace` API.
9. Add the full `SemanticTargetSurface` fake and platform primitive catalog
   test helpers.
10. Certify name-only platform bindings against target primitive specs.
11. Select image roots and validate `devices:` section shape.
12. Validate image device resource kinds, target availability, and unique edge
    root binding.
13. Validate image entry shape through `ImageProfileSpec`.
14. Add integration tests and public-barrel exports.
15. Add determinism tests.

Each step should keep runtime source dependency-free and use narrow tests while
iterating. The handoff check is `bun run agent:check`.
