# Representation And Layout Facts Design

## Purpose

Representation and layout facts are the compiler phase after whole-image
monomorphization and before Proof MIR. It consumes the closed image-specific
HIR, the selected target's layout and ABI surface, and computes the concrete
type representation facts that later proof and code generation phases must not
guess.

This phase is the first point where representation-sensitive proof facts are
available. Monomorphization has removed unresolved generic parameters and
pruned unreachable declarations. Layout can therefore compute one fact set for
the selected image: type sizes and alignments, source field offsets, enum
representations, validated-buffer layout terms, ABI parameter and return
shapes, and target pointer facts.

"Concrete" means no unresolved source type parameters, no target-independent
placeholder sizes, and no missing ABI classification. Validated-buffer facts may
still contain runtime arithmetic terms such as `source.len` or a packet length
field, but the terms are typed, ordered, target-sized, and tied to concrete
layout-field records.

Proof MIR consumes this fact program. It must not recompute offsets, infer ABI
classification, or reinterpret target pointer width. Code generation also
consumes the same facts so proof checks and emitted machine code agree about the
closed program's representation.

## Goals

- Consume one `MonomorphizedHirProgram` for the selected image.
- Consume a target-owned layout and ABI surface for the selected target.
- Compute sizes, alignments, strides, and representation tags for every
  reachable representable type.
- Compute source field offsets for every reachable source aggregate instance.
- Compute enum discriminants, tag layout, and representation policy.
- Compute validated-buffer layout-field offsets, byte widths, ordered ends,
  dynamic payload terms, and `layout.fits` fact inputs.
- Compute ABI parameter and return shapes for reachable source functions,
  certified platform functions, and image entry boundaries.
- Expose target pointer width, pointer size, pointer alignment, byte order, and
  minimum addressable unit facts.
- Preserve source origins and mono instance identity so diagnostics can explain
  which concrete instance produced a layout error.
- Reject unsupported, unsized, cyclic, overflowed, inconsistent, or
  ABI-unclassifiable representations before Proof MIR.
- Produce deterministic fact tables and deterministic diagnostics.
- Keep filesystem access, package loading, parsing, semantic checking, HIR
  lowering, monomorphization, Proof MIR construction, proof checking, code
  generation, linking, and binary emission outside this phase.

## Non-Goals

- This phase does not choose the target, image root, standard library, package
  graph, or platform primitive catalog.
- This phase does not instantiate generics, discover reachability, clone proof
  metadata, or decide which platform primitives are reachable.
- This phase does not prove `layout.fits`, validated-buffer requirements,
  resource closure, call-site requirements, terminal closure, or path-sensitive
  facts. It only produces the representation facts that Proof MIR checks use.
- This phase does not lower HIR to CFG, SSA, machine IR, or target
  instructions.
- This phase does not assign final stack frame slots, register allocations,
  spill slots, object sections, relocation addresses, PE/COFF layout, or binary
  image addresses.
- This phase does not reorder source fields for packing or optimization.
- This phase does not invent runtime object models for source constructs whose
  representation is not specified. Unsupported runtime interface values and
  payload-bearing enum forms without concrete mono payload metadata and target
  enum payload policy are layout errors.
- This phase does not give stdlib or package source special layout authority.
  Source origin does not affect representation.
- This phase does not define the runtime layout of `MoveRing`, cross-core shared
  memory slots, `Core.pin` worker state transfer, or core-movable eligibility.
  Those are live language concepts, but their layout and memory-sharing facts
  need a dedicated design before implementation.
- This phase does not implement incremental or cached layout.

## Repository Shape

```text
src/
  layout/
    index.ts
    ids.ts
    diagnostics.ts
    deterministic-sort.ts
    target-layout.ts
    layout-program.ts
    type-key.ts
    type-layout.ts
    aggregate-layout.ts
    enum-layout.ts
    validated-buffer-layout.ts
    abi-layout.ts
    layout-fact-builder.ts

tests/
  support/
    layout/
      layout-fakes.ts
      layout-fixtures.ts

  unit/
    layout/
      target-layout.test.ts
      type-key.test.ts
      type-layout.test.ts
      aggregate-layout.test.ts
      enum-layout.test.ts
      validated-buffer-layout.test.ts
      abi-layout.test.ts
      diagnostics.test.ts
      layout-fixtures.test.ts

  integration/
    layout/
      representation-layout-facts.test.ts
      validated-buffer-layout-facts.test.ts
      abi-shapes.test.ts
      layout-determinism.test.ts
      public-api.test.ts
```

`src/layout` may depend on `src/mono`, semantic ID and checked type models,
semantic target IDs, shared diagnostics/source span types, and pure target
layout surfaces supplied through dependency injection.

It must not depend on filesystem APIs, Bun APIs, package manifest parsing, AST
views, name resolution, semantic surface checking, HIR lowering internals,
monomorphization internals, Proof MIR, proof checkers, target code generators,
linkers, or PE/COFF emission.

This repository shape refines the short roadmap sketch in
`docs/design/compiler-pipeline-design.md`. The roadmap remains the end-to-end
phase map; this document defines the layout module contract.

## Public API

Representation and layout facts are exported from `src/layout/index.ts`. Once a
top-level compiler barrel exists, it should re-export this API next to
monomorphization:

```ts
import { monomorphizeWholeImage } from "./src/mono";
import { computeRepresentationLayoutFacts } from "./src/layout";

const monoResult = monomorphizeWholeImage({
  program: hirResult.program,
});

if (monoResult.kind === "ok") {
  const layoutResult = computeRepresentationLayoutFacts({
    program: monoResult.program,
    target: selectedTarget.layoutSurface,
  });
}
```

The phase returns a success value only when every reachable representable type
and every reachable ABI boundary has a complete fact record:

```ts
export interface ComputeRepresentationLayoutFactsInput {
  readonly program: MonomorphizedHirProgram;
  readonly target: LayoutTargetSurface;
}

export type ComputeRepresentationLayoutFactsResult =
  | {
      readonly kind: "ok";
      readonly facts: LayoutFactProgram;
      readonly diagnostics: readonly LayoutDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly LayoutDiagnostic[];
    };

export function computeRepresentationLayoutFacts(
  input: ComputeRepresentationLayoutFactsInput,
): ComputeRepresentationLayoutFactsResult;
```

`computeRepresentationLayoutFacts` does not combine diagnostics from earlier
phases. The caller owns diagnostic aggregation and source-order presentation.
Reachable mono error nodes, error types, or inconsistent mono tables are layout
errors because no representation fact can be trusted for an error-shaped closed
program. `kind: "ok"` may include warning or note diagnostics only; any error
diagnostic makes the result `kind: "error"`.

## Input Contract

The primary input is a `MonomorphizedHirProgram`. It is already closed over the
selected image and has concrete source type instances, concrete function
instances, concrete resource kinds, instantiated validated-buffer metadata,
instantiated proof metadata, and reachable platform primitive IDs.

The layout phase must be able to resolve every type that appears in:

- `MonoTypeInstance.fields`
- `MonoValidatedBuffer` parameter, layout, and derived fields
- `MonoFunctionSignature` receivers, parameters, and return types
- mono locals, expressions, resource places, validation payloads, attempts, and
  call arguments that Proof MIR may later lower
- `MonoPlatformContractEdge` records for certified platform calls
- image entry function signatures and image device surfaces

The target layout surface supplies target-specific facts that are deliberately
not part of semantic checking:

```ts
export interface LayoutTargetSurface {
  readonly targetId: TargetId;
  readonly dataModel: TargetDataModelFacts;
  readonly validatedBufferHandle: TargetValidatedBufferHandleLayout;
  readonly coreTypes: LayoutPrimitiveTypeCatalog<CoreTypeId>;
  readonly targetTypes: LayoutPrimitiveTypeCatalog<TargetTypeId>;
  readonly deviceSurfaces: LayoutDeviceSurfaceCatalog;
  readonly imageProfiles: LayoutImageProfileCatalog;
  readonly wireReadHelpers: LayoutWireReadHelperCatalog;
  readonly enumPolicy: TargetEnumLayoutPolicy;
  readonly abi: TargetAbiSurface;
}

export type LayoutPrimitiveTypeRef =
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId };

export interface TargetDataModelFacts {
  readonly endian: "little" | "big";
  readonly addressableUnit: "byte";
  readonly pointerWidthBits: 32 | 64;
  readonly pointerSizeBytes: bigint;
  readonly pointerAlignmentBytes: bigint;
  readonly sizeType: LayoutPrimitiveTypeRef;
  readonly maximumObjectSizeBytes: bigint;
  readonly maximumAlignmentBytes: bigint;
}

export interface TargetValidatedBufferHandleLayout {
  readonly pointerType: LayoutPrimitiveTypeRef;
  readonly lengthType: LayoutPrimitiveTypeRef;
  readonly pointerFieldName: "__source_ptr";
  readonly lengthFieldName: "__source_len";
}

export interface LayoutDeviceSurfaceSpec {
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly representation:
    | { readonly kind: "zeroSizedCapability" }
    | { readonly kind: "targetHandle"; readonly type: LayoutPrimitiveTypeRef };
  readonly sourceOrigin?: string;
}

export interface LayoutDeviceSurfaceCatalog {
  get(deviceSurfaceId: DeviceSurfaceId): LayoutDeviceSurfaceSpec | undefined;
  entries(): readonly LayoutDeviceSurfaceSpec[];
}

export interface LayoutImageProfileSpec {
  readonly profileId: ImageProfileId;
  readonly physicalEntryCallConvention: TargetCallConventionId;
  readonly physicalEntryArguments: readonly LayoutImageProfileArgumentSpec[];
  readonly physicalEntryResult: LayoutImageProfileResultSpec;
}

export interface LayoutImageProfileArgumentSpec {
  readonly name: string;
  readonly type: LayoutPrimitiveTypeRef;
  readonly provenance: LayoutAbiPointerProvenance | "scalarFirmwareValue";
}

export type LayoutImageProfileResultSpec =
  | { readonly kind: "unit" }
  | { readonly kind: "value"; readonly type: LayoutPrimitiveTypeRef };

export interface LayoutImageProfileCatalog {
  get(profileId: ImageProfileId): LayoutImageProfileSpec | undefined;
  entries(): readonly LayoutImageProfileSpec[];
}

export type TargetWireReadHelperId = string & { readonly __brand: "TargetWireReadHelperId" };

export interface LayoutWireReadHelperSpec {
  readonly helperId: TargetWireReadHelperId;
  readonly callConvention: TargetCallConventionId;
  readonly encoding: WireScalarEncoding;
  readonly resultType: LayoutPrimitiveTypeRef;
  readonly contract: "requiresLayoutReadRequirements";
}

export interface LayoutWireReadHelperCatalog {
  get(helperId: TargetWireReadHelperId): LayoutWireReadHelperSpec | undefined;
  entries(): readonly LayoutWireReadHelperSpec[];
}
```

The semantic target surface remains the authority for platform certification and
resource kinds. The layout target surface is the authority for representation
and ABI. They may be produced by the same selected target package, but they are
different contracts. The layout phase must reject a mono program whose
certified platform edge `targetId` values do not all match
`LayoutTargetSurface.targetId`.

Core and target primitive type catalogs expose deterministic entries:

```ts
export type AbiScalarKind = "integer" | "pointer" | "float" | "opaque";

export type LayoutPrimitiveKind =
  | "unit"
  | "bool"
  | "signedInteger"
  | "unsignedInteger"
  | "float"
  | "address"
  | "opaqueScalar"
  | "never";

export interface LayoutPrimitiveTypeSpec<Id> {
  readonly id: Id;
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
  readonly representation: LayoutPrimitiveKind;
  readonly bitWidth?: number;
  readonly abiScalarKind?: AbiScalarKind;
}

export interface LayoutPrimitiveTypeCatalog<Id> {
  get(id: Id): LayoutPrimitiveTypeSpec<Id> | undefined;
  entries(): readonly LayoutPrimitiveTypeSpec<Id>[];
}
```

Every primitive layout spec must have non-negative size, positive alignment,
power-of-two alignment, and a size that is representable in the compiler's
layout arithmetic. Invalid target surface data is a target-definition
diagnostic, not undefined behavior.

Core unit-like types have `sizeBytes = 0`, `strideBytes = 0`, and
`alignmentBytes = 1`. `Never` has representation `"never"` and may appear as a
return or unreachable expression type, but it is forbidden in stored aggregate
fields. `bool` must be a target-declared integer-sized representation with a
fixed bit width and ABI scalar kind. Integer core types must specify signedness,
bit width, size, and alignment. Pointer-like target types must use
representation `"address"` with the same size and alignment as the target data
model pointer facts unless the target surface names an explicitly non-pointer
address-sized scalar. Floating-point primitive specs, if the selected language
surface and target expose any, must use representation `"float"` and
`abiScalarKind: "float"` so the ABI classifier can place them in the target's
floating-point lanes instead of integer or opaque lanes.

Enum representation policy is target data, not compiler folklore:

```ts
export interface TargetEnumLayoutPolicy {
  readonly candidateTagTypes: readonly LayoutPrimitiveTypeRef[];
  readonly emptyEnumPolicy: "reject";
  readonly discriminantStart: bigint;
  readonly chooseTagType: "smallestUnsignedThatFits";
}
```

`candidateTagTypes` must reference unsigned integer primitive specs sorted by
target preference. For `chooseTagType: "smallestUnsignedThatFits"`, layout
rejects a negative `discriminantStart`, computes every assigned discriminant as
`discriminantStart + sourceOrdinal`, and chooses the first candidate whose bit
width can represent both the minimum and maximum assigned discriminant. If two
candidates have the same byte size, target order breaks the tie. If any
discriminant addition overflows the target `sizeType`, or no candidate fits,
layout emits an enum-discriminant-overflow diagnostic.

### HIR And Mono Prerequisite

Current HIR and mono type records do not preserve enum case order, and current
validated-buffer records preserve ordered parameter, layout, and derived field
IDs without the checked expressions that define their offsets and lengths.
Layout must not read AST views or the item index to recover either surface.

Before this phase can be implemented, typed HIR and mono must retain enum case
metadata:

```ts
export interface HirEnumCaseRecord {
  readonly enumTypeId: TypeId;
  readonly caseItemId: ItemId;
  readonly name: string;
  readonly ordinal: number;
  readonly sourceOrigin: HirOriginId;
}

export interface MonoEnumCaseRecord {
  readonly enumTypeInstanceId: MonoInstanceId;
  readonly caseItemId: ItemId;
  readonly name: string;
  readonly ordinal: number;
  readonly sourceOrigin: string;
}
```

`HirTypeRecord` must grow `enumCases: readonly HirEnumCaseRecord[]`, and
`MonoTypeInstance` must grow `enumCases: readonly MonoEnumCaseRecord[]`. The
arrays are non-empty only for `sourceKind: "enum"` and are sorted by source
ordinal.

Typed HIR and mono must also retain an instantiated validated-buffer layout
surface:

```ts
export type MonoLayoutIntegerWidth =
  | { readonly kind: "targetSize" }
  | { readonly kind: "type"; readonly type: MonoCheckedType };

export type WireEndian = "big" | "little";

export type WireIntegerEncoding =
  | {
      readonly kind: "integer";
      readonly endian: WireEndian;
      readonly signedness: "signed" | "unsigned";
      readonly bitWidth: number;
    }
  | { readonly kind: "byte" };

export type WireScalarEncoding = WireIntegerEncoding | { readonly kind: "opaqueBytes" };

export interface MonoLayoutIntegerRange {
  readonly minimum: bigint;
  readonly maximum: bigint;
  readonly provenance:
    | "checkedType"
    | "wireEncoding"
    | "sourceLength"
    | "derivedCases"
    | "arithmetic";
}

export type MonoLayoutExpression =
  | {
      readonly kind: "integerLiteral";
      readonly value: bigint;
      readonly width: MonoLayoutIntegerWidth;
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "sourceLength";
      readonly width: { readonly kind: "targetSize" };
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly fieldKind: "parameter";
      readonly type: MonoCheckedType;
      readonly range: MonoLayoutIntegerRange;
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly fieldKind: "layout";
      readonly type: MonoCheckedType;
      readonly encoding: WireIntegerEncoding;
      readonly range: MonoLayoutIntegerRange;
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly fieldKind: "derived";
      readonly type: MonoCheckedType;
      readonly range: MonoLayoutIntegerRange;
      readonly sourceOrigin: string;
    }
  | {
      readonly kind: "add" | "subtract" | "multiply";
      readonly left: MonoLayoutExpression;
      readonly right: MonoLayoutExpression;
      readonly width: MonoLayoutIntegerWidth;
      readonly sourceOrigin: string;
    };

export interface MonoDerivedFieldCase {
  readonly condition: MonoLayoutExpression | { readonly kind: "otherwise" };
  readonly result: MonoLayoutExpression;
  readonly sourceOrigin: string;
}

export interface MonoValidatedBufferLayoutField {
  readonly field: MonoFieldRecord;
  readonly offset: MonoLayoutExpression;
  readonly length?: MonoLayoutExpression;
  readonly sourceOrigin: string;
}

export interface MonoValidatedBufferDerivedField {
  readonly field: MonoFieldRecord;
  readonly source: MonoLayoutExpression;
  readonly cases: readonly MonoDerivedFieldCase[];
  readonly sourceOrigin: string;
}
```

`WireIntegerEncoding.bitWidth` is byte-addressed: it must be positive and
divisible by `8`, and layout rejects any encoding whose bit width does not
match the selected type's wire byte width. Sub-byte protocol fields are not
standalone layout fields in this contract; source code reads the containing
byte or integer field and derives masked values through ordinary checked
expressions.

This expression model is intentionally smaller than mono proof expressions. It
can represent integer literals, `source.len`, parameter field values, decoded
earlier layout field values, derived field values, and structural arithmetic.
It cannot represent calls, ordinary locals, heap-dependent expressions, target
operations, or arbitrary proof predicates. HIR lowering owns source-name
resolution for these expressions; mono owns substituting concrete field and type
instances.

The current parser exposes validated-buffer layout offset, optional length, and
derived-case expressions through AST views, but it does not yet expose wire
scalar encoding. Before source-backed layout implementation, the pipeline must
add contextual `le` and `be` wire-endian markers to validated-buffer layout
field type position:

```wr
layout:
    size: le U16 @ 0
    ethertype: be U16 @ 12
```

This is a prerequisite across the pipeline implemented so far:

- the lexer/parser treat `le` and `be` as contextual markers in
  `WireLayoutTypeReference`, not as global keywords
- AST views expose the optional marker with the layout field type reference
- semantic surface checking rejects multi-byte integer layout fields without
  `le` or `be`, rejects endian markers where byte order has no meaning, and
  normalizes accepted fields into checked `WireIntegerEncoding`
- typed HIR stores the checked wire scalar encoding with each
  validated-buffer layout field instead of retaining only field IDs
- monomorphization substitutes the field type and preserves the checked wire
  encoding in the instantiated validated-buffer surface
- layout consumes the mono encoding as an input fact and rejects any reachable
  multi-byte wire field whose encoding is missing
- Proof MIR treats decoded layout-field reads as byte-order-specific wire reads
  tied to layout facts
- code generation lowers those reads according to `WireScalarEncoding` and
  never replaces them with ordinary host-endian aggregate loads

Single-byte scalar values do not need byte-order annotation. Multi-byte layout
field references without a wire encoding are rejected rather than decoded with
target endianness. Test fixtures may construct `WireIntegerEncoding` directly
until source syntax lands.

Source-to-mono lowering for validated-buffer layout expressions is restricted:

- `@ expr` lowers to a `byteOffset` expression.
- `len expr` lowers to an `elementCount` expression.
- `source.len` lowers to `sourceLength` in the target `sizeType`.
- references to validated-buffer parameter fields lower as `fieldKind:
"parameter"`.
- references to earlier layout fields lower as decoded wire `fieldKind:
"layout"` values with explicit `WireIntegerEncoding`.
- references to earlier derived fields lower as `fieldKind: "derived"`.
- derived cases preserve source order, condition expressions, `otherwise`, and
  source origins.

## Fact Program Model

The output fact program is image-specific. It preserves mono instance IDs and
source origins, but it does not mutate mono HIR. Later phases use the fact
tables by key.

```ts
export interface LayoutFactProgram {
  readonly target: TargetLayoutFacts;
  readonly types: LayoutTypeFactTable;
  readonly fields: LayoutFieldFactTable;
  readonly enums: LayoutEnumFactTable;
  readonly validatedBuffers: LayoutValidatedBufferFactTable;
  readonly imageDevices: LayoutImageDeviceFactTable;
  readonly functions: LayoutFunctionAbiFactTable;
  readonly platformEdges: LayoutPlatformAbiFactTable;
  readonly imageEntry: LayoutImageEntryAbiFact;
}
```

The fact tables use deterministic keys:

```ts
export type LayoutCanonicalKeyString = string & { readonly __brand: "LayoutCanonicalKeyString" };

export interface LayoutDeterministicTable<Key, Value> {
  get(key: Key): Value | undefined;
  has(key: Key): boolean;
  entries(): readonly Value[];
  keyString(key: Key): LayoutCanonicalKeyString;
}

export interface LayoutFieldKey {
  readonly owner: LayoutTypeKey & { readonly kind: "source" };
  readonly fieldId: FieldId;
}

export type LayoutTypeFactTable = LayoutDeterministicTable<LayoutTypeKey, LayoutTypeFact>;
export type LayoutFieldFactTable = LayoutDeterministicTable<LayoutFieldKey, LayoutFieldFact>;
export type LayoutEnumFactTable = LayoutDeterministicTable<
  LayoutTypeKey & { readonly kind: "source" },
  LayoutEnumFact
>;
export type LayoutValidatedBufferFactTable = LayoutDeterministicTable<
  MonoInstanceId,
  LayoutValidatedBufferFact
>;
export type LayoutImageDeviceFactTable = LayoutDeterministicTable<
  LayoutImageDeviceKey,
  LayoutImageDeviceFact
>;
export type LayoutFunctionAbiFactTable = LayoutDeterministicTable<
  MonoInstanceId,
  LayoutFunctionAbiFact
>;
export type LayoutPlatformAbiFactTable = LayoutDeterministicTable<
  MonoInstantiatedProofId<HirPlatformContractEdgeId>,
  LayoutPlatformAbiFact
>;
```

Every table key has a canonical serializer owned by layout. `get` and `has`
must serialize the structural key value; object identity is never part of table
semantics. Canonical key strings are length-delimited by field and prefixed by
key kind, for example `source:len(12):type:...` rather than ad hoc
concatenation. Sorting uses these canonical key strings with raw code-unit
comparison. Tests must build equivalent key objects with different identities
and assert that lookups and ordering are unchanged.

A layout type key is not just a checked type fingerprint. Source type layout is
owned by a mono type instance, while core and target primitive types are owned
by the selected target catalogs:

```ts
export type LayoutTypeKey =
  | { readonly kind: "source"; readonly instanceId: MonoInstanceId }
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId };

export type MonoPublishedLayoutTypeKey =
  | { readonly kind: "source"; readonly instanceId: MonoInstanceId }
  | { readonly kind: "core"; readonly coreTypeId: CoreTypeId }
  | { readonly kind: "target"; readonly targetTypeId: TargetTypeId };
```

The layout phase does not rederive monomorphization's type-instance keys.
Monomorphization must publish a deterministic type-resolution table that maps
every concrete `MonoCheckedType` fingerprint appearing in the closed program to
the mono-owned layout type key chosen by mono:

```ts
export interface MonoLayoutTypeResolution {
  readonly checkedTypeFingerprint: string;
  readonly type: MonoCheckedType;
  readonly key: MonoPublishedLayoutTypeKey;
  readonly sourceOrigin: string;
}

export interface MonoLayoutTypeResolutionTable {
  getByFingerprint(fingerprint: string): MonoLayoutTypeResolution | undefined;
  entries(): readonly MonoLayoutTypeResolution[];
}
```

`MonomorphizedHirProgram` must grow
`layoutTypeResolutions: MonoLayoutTypeResolutionTable`. Mono owns populating it
while it still has direct access to its canonical instantiation keys.
`MonoPublishedLayoutTypeKey` lives in `src/mono` or in a dependency-neutral
shared type module; `src/mono` must not import `LayoutTypeKey` from
`src/layout`. Layout validates and translates the published key into its local
`LayoutTypeKey` when it builds the fact program.

For source types, `key.kind === "source"` and `key.instanceId` is the
mono-published canonical type instance ID. Zero matches are missing-closure
errors. Duplicate fingerprints in the mono-published table are internal
mono-invariant errors, not ordinary user errors. The implementation may still
use `checkedTypeFingerprint` as the lookup string, but the mapping itself comes
from mono so layout does not duplicate mono's canonical-key algorithm.

All fact tables expose `get(...)`, `has(...)`, and `entries()` in deterministic
key order. Keys sort by kind and then by code-unit string form of their IDs.
This is intentionally lexical, not numeric, ordering for string-rendered IDs.
Field facts sort by owner type key, declaration order, and field ID.

### Target Facts

Target facts are copied and normalized from `LayoutTargetSurface`:

```ts
export interface TargetLayoutFacts {
  readonly targetId: TargetId;
  readonly endian: "little" | "big";
  readonly addressableUnit: "byte";
  readonly pointerWidthBits: 32 | 64;
  readonly pointerSizeBytes: bigint;
  readonly pointerAlignmentBytes: bigint;
  readonly sizeType: LayoutTypeKey;
  readonly maximumObjectSizeBytes: bigint;
  readonly maximumAlignmentBytes: bigint;
}
```

This layout contract is byte-addressed because validated-buffer offsets,
PE/COFF output, and AArch64 UEFI all use byte offsets. Non-byte-addressed
targets are rejected at target surface validation unless the whole pipeline
defines addressable-unit conversion facts.

### Type Facts

Each type fact describes the representation of one core, target, or source
layout key:

```ts
export interface LayoutTypeFact {
  readonly key: LayoutTypeKey;
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
  readonly strideBytes: bigint;
  readonly representation: LayoutTypeRepresentation;
  readonly aggregateStorage?: LayoutAggregateStorageFact;
  readonly sourceOrigin?: string;
}

export type LayoutTypeRepresentation =
  | { readonly kind: "primitive"; readonly primitive: LayoutPrimitiveKind }
  | { readonly kind: "aggregate"; readonly sourceKind: SourceItemKind }
  | { readonly kind: "enum" }
  | {
      readonly kind: "zeroSized";
      readonly reason: "unit" | "emptyAggregate" | "capabilityToken";
    }
  | { readonly kind: "never" };

export interface LayoutPaddingRange {
  readonly offsetBytes: bigint;
  readonly sizeBytes: bigint;
  readonly kind: "interField" | "trailing";
}

export interface LayoutHiddenStorageField {
  readonly name: string;
  readonly type: LayoutTypeKey;
  readonly offsetBytes: bigint;
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
}

export interface LayoutAggregateStorageFact {
  readonly hiddenFields: readonly LayoutHiddenStorageField[];
  readonly paddingRanges: readonly LayoutPaddingRange[];
  readonly transitivePaddingRanges: readonly LayoutPaddingRange[];
  readonly trailingPaddingBytes: bigint;
  readonly paddingExposurePolicy: "fieldwiseCopyOnlyUntilInitialized";
}
```

`strideBytes` is the size rounded up to the type's alignment. Aggregate fields
are placed at offsets that satisfy each field's alignment. Aggregate size is
rounded up to aggregate alignment. Empty aggregates are zero-sized with
alignment 1 unless the target surface later defines a different policy.
`SourceItemKind` is the existing semantic item-index source-kind union; layout
does not define a second declaration taxonomy.

Every `MonoFieldRecord` in a source type is a stored source field unless the
HIR schema explicitly marks a different storage role. Proof brands,
sessions, obligations, and other capability metadata are not hidden fields in
`MonoTypeInstance.fields`; they remain in mono proof metadata and therefore do
not receive runtime offsets. Target-private device handles are modeled by
`LayoutImageDeviceFact`, not by source fields.

Zero-sized capability tokens are allowed. For example, an edge root or stream
token whose source type has no stored fields may still carry proof identity in
mono proof metadata. Its runtime type layout has size `0`, stride `0`,
alignment `1`, and representation `zeroSized` with reason `"capabilityToken"`.
Passing such a value through the ABI must preserve the proof value even when no
runtime lanes are emitted.

The initial source aggregate policy is:

| Source kind       | Representation policy                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------ |
| `dataclass`       | Source fields in declaration order.                                                                                |
| `class`           | Source fields in declaration order. No implicit heap identity.                                                     |
| `edgeClass`       | Source fields in declaration order. Proof brands are metadata.                                                     |
| `stream`          | Source fields in declaration order. Session state is metadata.                                                     |
| `validatedBuffer` | Parameter fields are ordinary value fields; layout fields are read from external bytes, not stored in the wrapper. |
| `enum`            | Fieldless enum tag using target enum policy.                                                                       |
| `interface`       | No runtime value representation; reject if reachable as a by-value runtime value.                                  |
| `image`           | No ordinary value representation; image entry and device facts use dedicated image records.                        |
| `function`        | No source type layout. Function pointers must be target or core types.                                             |
| `enumCase`        | No independent type layout. Cases are represented by the owner enum.                                               |

`SourceItemKind` currently has no separate array, tuple, slice, optional, list,
or map source kind. Generic wrappers such as `Option[T]`, `List[T]`, or
`Map[K, V]` are laid out only if they are ordinary reachable source
declarations with one of the source kinds above, or if a core/target primitive
catalog supplies an explicit primitive layout. A by-value constructor that
reaches layout without a source kind row or primitive spec is rejected instead
of receiving an invented representation.

Validated-buffer source types are split deliberately. Parameter fields are part
of the validated-buffer value because they are source values carried with the
validation. The value also has target-defined hidden storage for the external
source-buffer handle: a base pointer and a source length field described by
`TargetValidatedBufferHandleLayout`. Layout fields describe bytes inside that
external source buffer and are represented by `LayoutValidatedBufferFact`, not
by ordinary aggregate source fields inside the wrapper. This prevents the proof
checker from treating a packet byte as an ordinary stored field before
`layout.fits` has been proven.

`paddingRanges` records padding introduced directly by this aggregate.
`transitivePaddingRanges` records every byte in this aggregate's storage that
may contain padding from nested aggregate fields after recursively expanding
stored source fields. A raw observable copy is allowed only when every direct
and transitive padding byte has been initialized, or when codegen lowers the
move recursively to leaf scalar fields and skips padding bytes.

The stored representation of a validated-buffer value is:

1. hidden source pointer
2. hidden source length
3. validated-buffer parameter fields in declaration order

The hidden fields are present in `LayoutAggregateStorageFact.hiddenFields`, not
in source field facts. Parameter field facts come from
`MonoValidatedBuffer.parameterFields`; layout and derived fields never receive
stored wrapper offsets.

`LayoutTypeFact.aggregateStorage.hiddenFields` is the authoritative storage
record for the hidden source pointer and length. `LayoutValidatedBufferFact`
repeats those two fields in `valueStorage` as a convenience index for Proof MIR.
The consistency pass must reject any validated-buffer fact whose `valueStorage`
does not exactly reference the hidden fields in the owning type fact.

Inter-field and trailing padding are explicit layout facts. Until Proof MIR or
codegen proves padding bytes initialized, aggregate copies to observable memory
must be lowered fieldwise or through a target helper that zeroes padding. A
plain byte copy of an aggregate with uninitialized padding into a transmit
buffer is not allowed by layout facts alone.

### Field Facts

Source aggregate fields receive concrete byte offsets:

```ts
export interface LayoutFieldFact {
  readonly owner: LayoutTypeKey & { readonly kind: "source" };
  readonly fieldId: FieldId;
  readonly fieldName: string;
  readonly fieldType: LayoutTypeKey;
  readonly offsetBytes: bigint;
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
  readonly index: number;
  readonly paddingBeforeBytes: bigint;
  readonly sourceOrigin: string;
}
```

Field order is the `MonoTypeInstance.fields` order, except for validated-buffer
parameter fields, which use `MonoValidatedBuffer.parameterFields` after the
hidden source handle fields. Layout does not sort fields by name, alignment, or
size. That keeps diagnostics and generated code aligned with source and
prevents target-specific packing from changing proof-relevant field paths.

If a field type is unsupported, unsized, `Never` in a stored position, or has an
alignment that cannot be satisfied, the owner type does not receive a partial
success fact. The phase emits deterministic diagnostics and returns
`kind: "error"`.

### Enum Facts

Current parser support is fieldless enum cases. A fieldless enum is represented
as a tag only:

```ts
export interface LayoutEnumFact {
  readonly owner: LayoutTypeKey & { readonly kind: "source" };
  readonly tagType: LayoutTypeKey;
  readonly tagOffsetBytes: bigint;
  readonly cases: readonly LayoutEnumCaseFact[];
  readonly sourceOrigin: string;
}

export interface LayoutEnumCaseFact {
  readonly itemId: ItemId;
  readonly name: string;
  readonly ordinal: number;
  readonly discriminant: bigint;
  readonly sourceOrigin: string;
}
```

The target enum policy chooses the smallest supported unsigned integer type that
can represent all case discriminants. A case discriminant is
`TargetEnumLayoutPolicy.discriminantStart + sourceOrdinal`. Empty source enums
are rejected instead of being silently treated as `Never`; the core
`Never` type remains the explicit uninhabited type. `LayoutEnumFact.tagType` is
the authoritative tag type and must be available to ABI classification.
`LayoutTypeFact.representation.kind === "enum"` only marks that the type's
layout is described by the enum fact table. `tagOffsetBytes` is always `0` for
fieldless enums.

Reachable payload-bearing enum shapes are layout errors unless typed HIR and
mono preserve per-case payload metadata and the target enum policy defines the
tag-plus-payload, max-payload-size, and niche rules needed to produce concrete
facts. Layout must not silently collapse payload cases into a fieldless tag.

### Validated-Buffer Facts

Validated-buffer layout facts describe bytes in the external source buffer and
the proof inputs needed to read them safely:

```ts
export interface LayoutValidatedBufferFact {
  readonly instanceId: MonoInstanceId;
  readonly typeKey: LayoutTypeKey & { readonly kind: "source" };
  readonly valueStorage: LayoutValidatedBufferValueStorageFact;
  readonly sourceLengthTerm: LayoutTerm;
  readonly layoutFields: readonly LayoutValidatedBufferFieldFact[];
  readonly derivedFields: readonly LayoutValidatedBufferDerivedFact[];
  readonly fixedEndBytes?: bigint;
  readonly sourceOrigin: string;
}

export interface LayoutValidatedBufferValueStorageFact {
  readonly sourcePointer: LayoutHiddenStorageField;
  readonly sourceLength: LayoutHiddenStorageField;
  readonly parameterFieldsStartOffsetBytes: bigint;
}

export interface LayoutValidatedBufferFieldFact {
  readonly fieldId: FieldId;
  readonly name: string;
  readonly elementType: LayoutTypeKey;
  readonly elementValueSizeBytes: bigint;
  readonly wire: LayoutWireTypeFact;
  readonly offset: LayoutTerm;
  readonly elementCount: LayoutTerm;
  readonly byteLength: LayoutTerm;
  readonly end: LayoutTerm;
  readonly readPolicy: LayoutWireReadPolicy;
  readonly readRequires: readonly LayoutReadRequirement[];
  readonly sourceOrigin: string;
}

export type LayoutWireTypeFact =
  | {
      readonly kind: "scalar";
      readonly type: LayoutTypeKey;
      readonly scalarEncoding: WireScalarEncoding;
      readonly wireSizeBytes: bigint;
      readonly wireStrideBytes: bigint;
      readonly wireCompatible: true;
      readonly reason: "scalar" | "targetProvided";
    }
  | {
      readonly kind: "aggregate";
      readonly type: LayoutTypeKey;
      readonly wireSizeBytes: bigint;
      readonly wireStrideBytes: bigint;
      readonly wireCompatible: true;
      readonly fields: readonly LayoutWireAggregateFieldFact[];
      readonly reservedRanges: readonly LayoutWireReservedRange[];
      readonly reason: "packedAggregate" | "targetProvided";
    };

export interface LayoutWireAggregateFieldFact {
  readonly fieldId: FieldId;
  readonly name: string;
  readonly type: LayoutTypeKey;
  readonly offsetBytes: bigint;
  readonly wire: LayoutWireTypeFact;
  readonly sourceOrigin: string;
}

export interface LayoutWireReservedRange {
  readonly offsetBytes: bigint;
  readonly sizeBytes: bigint;
  readonly meaning: "reservedProtocolBytes";
}

export type LayoutWireReadPolicy =
  | {
      readonly alignment: "unalignedSafe";
      readonly lowering: "bytewiseAssemble" | "targetSafeUnalignedLoad";
    }
  | {
      readonly alignment: "unalignedSafe";
      readonly lowering: "targetProvided";
      readonly helperId: TargetWireReadHelperId;
    };
```

`LayoutTerm` is a small integer term language, not a general expression tree:

```ts
export type LayoutTermUnit = "byteOffset" | "byteLength" | "elementCount" | "scalarValue";

export interface LayoutIntegerRange {
  readonly minimum: bigint;
  readonly maximum: bigint;
  readonly provenance:
    | "constant"
    | "checkedType"
    | "wireEncoding"
    | "sourceLength"
    | "derivedCases"
    | "arithmetic";
}

export type LayoutTerm =
  | {
      readonly kind: "constant";
      readonly value: bigint;
      readonly unit: LayoutTermUnit;
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "sourceLength";
      readonly unit: "byteLength";
      readonly type: LayoutTypeKey;
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly source: "parameter";
      readonly type: LayoutTypeKey;
      readonly unit: "scalarValue" | "elementCount" | "byteOffset" | "byteLength";
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly source: "layout";
      readonly type: LayoutTypeKey;
      readonly unit: "scalarValue" | "elementCount" | "byteOffset" | "byteLength";
      readonly encoding: WireIntegerEncoding;
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "fieldValue";
      readonly fieldId: FieldId;
      readonly source: "derived";
      readonly type: LayoutTypeKey;
      readonly unit: "scalarValue" | "elementCount" | "byteOffset" | "byteLength";
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "derivedValue";
      readonly fieldId: FieldId;
      readonly type: LayoutTypeKey;
      readonly unit: LayoutTermUnit;
      readonly range: LayoutIntegerRange;
    }
  | {
      readonly kind: "add" | "subtract" | "multiply";
      readonly left: LayoutTerm;
      readonly right: LayoutTerm;
      readonly unit: LayoutTermUnit;
      readonly range: LayoutIntegerRange;
    };
```

Layout expressions accept integer literals, validated-buffer parameter field
references, decoded earlier layout field values, earlier derived field
references, `source.len`, and structural arithmetic. They reject calls,
ordinary locals, heap-dependent expressions, target operations, array-valued
field references without an explicit scalar projection, and any term that
cannot be evaluated or carried as bounded integer arithmetic. `source.len` has
the target `sizeType`; decoded wire field values use their per-field
`WireIntegerEncoding`, never the target endian by default. Byte offsets and byte
lengths are always byte units. Element counts are counts, never bytes.

Every `LayoutTerm` carries a finite `LayoutIntegerRange`. Layout derives ranges
and rejects terms whose range cannot be computed soundly:

- constants have exact ranges
- `source.len` has range `[0, TargetDataModelFacts.maximumObjectSizeBytes]`
- parameter field values use the checked integer, boolean, or enum range
  published by semantic/HIR surfaces
- decoded layout fields derive their range from `WireIntegerEncoding`
- derived fields derive their range from the union of their total case results
- arithmetic terms compute conservative finite ranges in the target `sizeType`

If a term needs a path fact to be non-negative or in range, layout emits an
explicit `LayoutReadRequirement` and records the range that is valid once that
requirement is proven. It does not use path facts during layout.

For a layout field without explicit `len`, `elementCount` is `1`. With explicit
`len`, `elementCount` is the checked length term. `byteLength` is
`elementCount * wire.wireStrideBytes`, and `end` is `offset + byteLength`.
Wire stride is intentionally separate from host `LayoutTypeFact.strideBytes`.
External source-buffer bytes are protocol bytes, not host aggregate storage.
For scalar and packed aggregate wire fields, `wireStrideBytes` equals
`wireSizeBytes` unless a target-provided aggregate fact explicitly describes
reserved protocol bytes between repeated elements.

Layout accepts scalar wire fields and target-provided aggregate wire facts with
complete per-field wire offsets. It rejects arbitrary source aggregate element
types in validated-buffer layout fields unless `LayoutWireTypeFact.kind ===
"aggregate"` and the fact proves every nested field offset, nested wire
encoding, total wire size, repeat stride, and reserved protocol byte range.
Zero-sized wire elements are rejected when `elementCount` can be non-zero; they
do not consume bytes and therefore cannot safely describe a repeated external
byte range.

Wire reads are unaligned-safe by contract. A field at byte offset `3` may still
be read as a `u32` if `layout.fits` and arithmetic requirements are proven;
codegen must lower the read by bytewise assembly, a target-safe unaligned load,
or a target-provided helper. Layout facts must not imply that the external
buffer pointer is aligned for the element type.

`readRequires` records the proof facts that Proof MIR must establish before a
read:

```ts
export type LayoutReadRequirement =
  | { readonly kind: "layoutFits"; readonly end: LayoutTerm }
  | { readonly kind: "payloadEnd"; readonly end: LayoutTerm }
  | { readonly kind: "fieldAvailable"; readonly fieldId: FieldId }
  | {
      readonly kind: "rangeConstraint";
      readonly left: LayoutTerm;
      readonly relation: "<=" | "<" | ">=" | ">";
      readonly right: LayoutTerm;
      readonly width: LayoutTypeKey;
    }
  | {
      readonly kind: "noUnsignedOverflow";
      readonly expression: LayoutTerm;
      readonly width: LayoutTypeKey;
    };
```

Fixed fields with constant offset and constant byte length contribute to
`fixedEndBytes`; dynamic payload fields contribute `payloadEnd` requirements.
The layout phase computes these requirements, but Proof MIR proves them along
control-flow paths. `layout.fits(end)` is a containment proof: the source buffer
must contain at least the half-open byte range `[0, end)`. It is not an
exact-length proof, and trailing source bytes remain opaque unless another
field fact exposes them.

For a given `LayoutValidatedBufferFieldFact`, its `readRequires` list is
intended to be sufficient for a safe read of that field. If Proof MIR proves
every requirement in the list, the read may be lowered using the field's
`readPolicy` without adding hidden extra bounds, alignment, or arithmetic
preconditions. `fieldAvailable` means the referenced earlier field has itself
been safely read and decoded on the same validated-buffer value in the current
control-flow path. `payloadEnd(end)` is a derived proof that the dynamic payload
range ending at `end` has been computed without overflow from already-available
fields.

Runtime layout arithmetic is checked in the target `sizeType`, not in unbounded
compiler `bigint`. Layout uses `bigint` to build and simplify terms, then emits
`rangeConstraint` and `noUnsignedOverflow` requirements for offset, length,
multiplication, subtraction, and end terms whose operands depend on runtime
values. Proof MIR must prove those requirements before using the computed end
for `layout.fits`; otherwise a wrapping or underflowing length calculation
could prove a too-small bound.

The field order is validated-buffer declaration order. A field may depend only
on parameter fields and earlier layout or derived fields. This preserves the
Lean-derived invariant that dynamic payload bounds are derived only after fixed
fields are read. Constant intervals must not overlap. Dynamic intervals must
have either a structural ordering proof from the term language or an explicit
`rangeConstraint` requirement that Proof MIR can prove before the later field is
read. If neither is possible, layout rejects the validated buffer as ambiguous.

The structural ordering check normalizes byte-offset and byte-end terms into an
affine form:

```text
constant + sum(symbol * nonNegativeConstant)
```

where each symbol is `source.len`, a validated-buffer parameter field, an
earlier decoded layout field, or an earlier derived field with a known
non-negative range. Multiplication is accepted only when one side is a
non-negative constant. Subtraction is accepted when the result range is
statically non-negative or when layout can emit a `rangeConstraint` that makes
the non-negativity obligation explicit. Layout proves `left <= right`
statically when `right - left` normalizes to non-negative coefficients and a
non-negative constant, or when both sides are identical. If the normalizer
cannot prove or express the interval order as a proof obligation, layout rejects
the field instead of producing a speculative fact.

Accepted examples:

```text
kind: U8 @ 0
length: be U16 @ 1
payload: U8 @ 3 len length
```

`length` is available before `payload`; `payload.end` normalizes to
`3 + length * 1`, and Proof MIR must prove no overflow plus
`layout.fits(payload.end)`.

```text
header: U8 @ 0 len 14
body: U8 @ 14 len source.len - 14
```

Layout emits a `rangeConstraint(14 <= source.len)` requirement for `body` and
uses the range `[0, maximumObjectSizeBytes - 14]` for the length term once that
requirement is proven. Proof MIR, not layout, proves that the constraint holds
on the path before `body` is read.

Rejected examples:

```text
payload: U8 @ 2 len trailer_len
trailer_len: U8 @ 0
```

`payload` depends on a later field.

```text
a: U8 @ offset_a len len_a
b: U8 @ offset_b len len_b
```

This is rejected unless the affine normalizer can prove the ranges do not
overlap or are intentionally the same range.

Derived fields are representation facts over already-available bytes or terms;
they are not stored aggregate fields:

```ts
export interface LayoutValidatedBufferDerivedFact {
  readonly fieldId: FieldId;
  readonly name: string;
  readonly type: LayoutTypeKey;
  readonly source: LayoutTerm;
  readonly cases: readonly LayoutDerivedCaseFact[];
  readonly sourceOrigin: string;
}

export interface LayoutDerivedCaseFact {
  readonly condition: LayoutDerivedCaseCondition;
  readonly result: LayoutTerm;
  readonly sourceOrigin: string;
}

export type LayoutDerivedCaseCondition =
  | { readonly kind: "equals"; readonly value: LayoutTerm }
  | { readonly kind: "otherwise" };
```

Derived cases are checked as an ordered total decision table over the
`source` term. A source case expression means `source == caseValue`; it is not
an arbitrary predicate. At most one `otherwise` case is allowed, and if present
it must be last. If no `otherwise` case exists, layout proves coverage by
forming a finite interval set from the source term's bounded range and removing
each distinct equality value. The table is total only when the remaining set is
empty. Duplicate equality values are rejected because they make later cases
unreachable. If a case value is outside the source range, layout emits a
source-level diagnostic for that case. If coverage, result ranges, or
exclusivity cannot be proven, layout rejects the derived field instead of
producing a partial value.

### Image Device Facts

Image devices are image-seeded capabilities, not ordinary aggregate fields.
Layout records their runtime representation separately from source type layout:

```ts
export interface LayoutImageDeviceKey {
  readonly imageInstanceId: MonoInstanceId;
  readonly fieldId: FieldId;
}

export interface LayoutImageDeviceFact {
  readonly key: LayoutImageDeviceKey;
  readonly deviceSurfaceId: DeviceSurfaceId;
  readonly deviceType: LayoutTypeKey;
  readonly representation:
    | { readonly kind: "zeroSizedCapability" }
    | {
        readonly kind: "targetHandle";
        readonly type: LayoutTypeKey;
        readonly layout: LayoutTypeFact;
      };
  readonly brandIds: readonly MonoInstantiatedProofId<BrandId>[];
  readonly sourceOrigin: string;
}
```

The target layout surface supplies the device representation through
`LayoutDeviceSurfaceCatalog`. A zero-sized device capability carries proof
identity but no runtime bytes. A target-handle device capability stores a
target-defined handle value whose meaning remains target-owned. Source code
cannot inspect target-private device metadata unless the target exposes it
through ordinary certified platform functions and proof contracts.

## ABI Facts

ABI facts classify values at function boundaries. They do not assign concrete
physical registers, stack slots, or spill slots. Code generation and frame
layout use ABI facts later to select registers and stack locations.

```ts
export type TargetCallConventionId = string & { readonly __brand: "TargetCallConventionId" };

export interface LayoutFunctionAbiFact {
  readonly functionInstanceId: MonoInstanceId;
  readonly sourceFunctionId: FunctionId;
  readonly hiddenParameters: readonly LayoutAbiHiddenParameterFact[];
  readonly receiver?: LayoutAbiParameterFact;
  readonly parameters: readonly LayoutAbiParameterFact[];
  readonly returnValue: LayoutAbiReturnFact;
  readonly callConvention: TargetCallConventionId;
  readonly sourceOrigin: string;
}

export interface LayoutAbiParameterFact {
  readonly parameterId: ParameterId;
  readonly mode: "observe" | "consume";
  readonly type: LayoutTypeKey;
  readonly layout: LayoutTypeFact;
  readonly shape: LayoutAbiValueShape;
  readonly sourceOrigin: string;
}

export interface LayoutAbiReturnFact {
  readonly type: LayoutTypeKey;
  readonly layout: LayoutTypeFact;
  readonly shape: LayoutAbiValueShape;
  readonly sourceOrigin: string;
}
```

The target ABI surface classifies each value using the already-computed layout:

```ts
export type LayoutAbiValueShape =
  | {
      readonly kind: "none";
      readonly reason: "unit" | "never" | "emptyAggregate" | "zeroSizedCapability";
      readonly proofCarrying: boolean;
    }
  | {
      readonly kind: "direct";
      readonly lanes: readonly LayoutAbiLane[];
      readonly stack?: LayoutAbiStackRequirement;
    }
  | {
      readonly kind: "indirect";
      readonly pointer: LayoutAbiPointerShape;
      readonly pointee: LayoutTypeKey;
      readonly ownership: "callerAllocated" | "calleeAllocated" | "borrowed";
      readonly hiddenParameter?: LayoutAbiHiddenParameterFact;
      readonly stack?: LayoutAbiStackRequirement;
    };

export interface LayoutAbiHiddenParameterFact {
  readonly kind: "sret" | "context" | "imageEntryThunk";
  readonly physicalIndex: number;
  readonly type: LayoutTypeKey;
  readonly shape: LayoutAbiPointerShape;
  readonly source: "targetAbi" | "imageProfile" | "platformPrimitive";
}

export interface LayoutAbiStackRequirement {
  readonly slotSizeBytes: bigint;
  readonly alignmentBytes: bigint;
  readonly paddingPolicy: "targetOwned";
}

export type LayoutAbiPointerProvenance =
  | "ordinaryAddress"
  | "validatedBufferSource"
  | "imageDevice"
  | "firmware"
  | "platformPrimitive";

export interface LayoutAbiPointerShape {
  readonly widthBits: 32 | 64;
  readonly sizeBytes: bigint;
  readonly alignmentBytes: bigint;
}

export type LayoutAbiLane =
  | {
      readonly kind: "integer";
      readonly sizeBytes: bigint;
      readonly alignmentBytes: bigint;
      readonly signedness: "signed" | "unsigned";
      readonly extension: "none" | "sign" | "zero";
    }
  | {
      readonly kind: "pointer";
      readonly sizeBytes: bigint;
      readonly alignmentBytes: bigint;
      readonly provenance: LayoutAbiPointerProvenance;
    }
  | {
      readonly kind: "float";
      readonly sizeBytes: bigint;
      readonly alignmentBytes: bigint;
      readonly format: "ieee754-binary32" | "ieee754-binary64" | "targetDefined";
    }
  | { readonly kind: "opaque"; readonly sizeBytes: bigint; readonly alignmentBytes: bigint };
```

The target ABI surface is an injected classifier. It receives already-computed
layout facts and returns either an ABI shape or deterministic diagnostics:

```ts
export type AbiClassificationUse =
  | { readonly kind: "receiver"; readonly mode: "observe" | "consume" }
  | {
      readonly kind: "parameter";
      readonly parameterId: ParameterId;
      readonly mode: "observe" | "consume";
    }
  | { readonly kind: "return" }
  | {
      readonly kind: "platformArgument";
      readonly index: number;
      readonly mode: "observe" | "consume";
    }
  | { readonly kind: "platformReturn" }
  | { readonly kind: "imageEntryArgument"; readonly index: number }
  | { readonly kind: "imageEntryReturn" };

export interface ClassifyAbiValueInput {
  readonly target: TargetLayoutFacts;
  readonly callConvention: TargetCallConventionId;
  readonly use: AbiClassificationUse;
  readonly type: LayoutTypeKey;
  readonly layout: LayoutTypeFact;
  readonly enumFact?: LayoutEnumFact;
}

export type ClassifyAbiValueResult =
  | { readonly kind: "ok"; readonly shape: LayoutAbiValueShape }
  | { readonly kind: "error"; readonly diagnostics: readonly LayoutDiagnostic[] };

export interface TargetAbiSurface {
  readonly sourceCallConvention: TargetCallConventionId;
  readonly platformCallConvention: TargetCallConventionId;
  readonly supportsVariadicCalls: false;
  classifyValue(input: ClassifyAbiValueInput): ClassifyAbiValueResult;
}
```

The classifier owns direct-vs-indirect decisions, lane splitting, lane order,
integer extension rules, floating-point lane class selection, hidden return
pointer policy, and target-specific aggregate rules. Lane order is the logical
target ABI order that codegen later maps to registers or stack locations. If
`layout.representation.kind === "enum"`, layout passes the corresponding
`LayoutEnumFact` so the classifier can use the tag type and ABI scalar kind.
If a value is passed indirectly, the classifier must state the pointer shape
and ownership:

For a zero-sized capability token, the classifier must return
`{ kind: "none", reason: "zeroSizedCapability", proofCarrying: true }`. No
runtime lane is emitted, but Proof MIR still carries the value's proof identity.

| Use                                   | Indirect ownership meaning                                                                   |
| ------------------------------------- | -------------------------------------------------------------------------------------------- |
| `observe` receiver or parameter       | `borrowed`; callee sees caller-owned storage for the duration of the call.                   |
| `consume` receiver or parameter       | `callerAllocated`; caller supplies a move-out slot and Proof MIR must prove the value moved. |
| return value                          | `callerAllocated`; caller supplies a hidden result slot when the target ABI requires one.    |
| platform argument with `observe` mode | `borrowed`; primitive cannot consume the source value.                                       |
| platform argument with `consume` mode | `callerAllocated`; primitive contract consumes the value if proof obligations pass.          |

Resource ownership is still checked by Proof MIR. ABI ownership describes the
transport shape that codegen must use; it does not by itself authorize a move or
consume.

Hidden parameters have one source of truth. For each
`LayoutAbiValueShape.kind === "indirect"` with `hiddenParameter` present, the
exact same `LayoutAbiHiddenParameterFact` object must appear once in the
containing `hiddenParameters` array, and `physicalIndex` must equal its physical
argument index in the final ABI argument sequence. The array order is the
physical argument order before visible source parameters unless the selected
call convention explicitly states another order. A hidden parameter that appears
in the array but is not referenced by an indirect shape is rejected. A hidden
parameter referenced by more than one indirect shape is rejected unless the
target ABI surface marks that parameter kind as intentionally shared.

For ordinary source-to-source calls, the selected target still owns the internal
calling convention. The target surface may use one internal convention for all
monomorphized source functions and a target ABI convention for certified
platform calls and image entry thunks, but every convention used by layout must
be explicit in the fact table.

Certified platform functions need two related facts:

- the source function instance ABI, used if source calls are emitted as calls to
  a compiler stub
- the platform edge ABI, used by the target lowering for the primitive contract

```ts
export interface LayoutPlatformAbiFact {
  readonly edgeId: MonoInstantiatedProofId<HirPlatformContractEdgeId>;
  readonly primitiveId: PlatformPrimitiveId;
  readonly contractId: PlatformContractId;
  readonly targetId: TargetId;
  readonly hiddenParameters: readonly LayoutAbiHiddenParameterFact[];
  readonly arguments: readonly LayoutAbiValueShape[];
  readonly result: LayoutAbiValueShape;
  readonly callConvention: TargetCallConventionId;
  readonly sourceOrigin: string;
}
```

The image entry ABI fact records the selected target profile's entry boundary.
For UEFI AArch64 this is the boundary that the compiler-owned entry thunk must
implement, not a C runtime entry point.

```ts
export interface LayoutImageEntryAbiFact {
  readonly imageInstanceId: MonoInstanceId;
  readonly entryFunctionInstanceId?: MonoInstanceId;
  readonly profileId: ImageProfileId;
  readonly physicalProfile: LayoutImageProfileSpec;
  readonly physicalEntryArguments: readonly LayoutAbiValueShape[];
  readonly sourceEntryArguments: readonly LayoutAbiValueShape[];
  readonly thunkConversions: readonly LayoutImageEntryThunkConversion[];
  readonly result: LayoutAbiValueShape;
  readonly physicalCallConvention: TargetCallConventionId;
  readonly sourceCallConvention: TargetCallConventionId;
  readonly sourceOrigin: string;
}

export interface LayoutImageEntryThunkConversion {
  readonly source: "firmwareArgument" | "compilerInitializedCapability";
  readonly targetParameterIndex: number;
  readonly sourceEntryParameterId?: ParameterId;
  readonly shape: LayoutAbiValueShape;
}
```

Image entry classification uses the selected target profile's entry signature
from `LayoutTargetSurface.imageProfiles`. `physicalEntryArguments` classify the
actual firmware ABI boundary under
`physicalProfile.physicalEntryCallConvention`. `sourceEntryArguments` classify
the monomorphized source entry function under
`TargetAbiSurface.sourceCallConvention`. `thunkConversions` describe how
firmware arguments and compiler-initialized capabilities are converted or
materialized before calling the source entry. Every
`thunkConversions.targetParameterIndex` must reference one source entry
argument, and every source entry argument must be produced by exactly one
conversion unless it is a zero-sized proof-carrying capability materialized by
the compiler. If the mono image has no entry function, the selected profile is
missing, or either side of the entry thunk cannot be classified under its
required convention, layout returns `kind: "error"`.

## Layout Algorithm

The layout builder runs as a fixed pipeline over deterministic table entries:

1. Validate and normalize the target layout surface.
2. Check every reachable platform edge target ID against the layout target ID.
3. Build a type resolver from mono checked types to layout type keys.
4. Seed primitive core and target type facts from the target surface.
5. Discover every reachable source type key from `program.types`.
6. Compute source type facts with cycle detection.
7. Compute source field facts for aggregate instances.
8. Compute enum facts for enum instances.
9. Compute image device layout facts from mono image devices and target device
   surface layout specs.
10. Compute validated-buffer wire type facts, hidden handle storage, and
    layout read requirements.
11. Compute function, platform edge, and image entry ABI facts.
12. Run consistency checks over all fact tables.

Source aggregate layout is recursive. The builder keeps a stack of source type
keys currently being computed. If a source type depends by value on itself, or
on a cycle of source types, layout emits a recursive-layout diagnostic. Whole
image monomorphization must already reject reachable recursive source type
instantiation, but layout keeps this check because representation cycles are a
layout safety boundary. The layout check still rejects zero-sized recursive
source type cycles because source-level recursive value identity is not implied
by zero runtime size.

All arithmetic uses `bigint`. The phase rejects negative sizes, negative
alignments, zero alignments, non-power-of-two alignments, negative offsets,
negative lengths, byte ranges whose end precedes their start, and arithmetic
that exceeds `TargetDataModelFacts.maximumObjectSizeBytes` or
`maximumAlignmentBytes`. Conversion to JavaScript `number` is allowed only at
presentation or backend edges that explicitly validate the range.

Aggregate placement:

```text
offset = 0
alignment = 1
paddingRanges = []
transitivePaddingRanges = []
for field in source order:
  fieldAlignment = layout(field.type).alignment
  fieldOffset = alignUp(offset, fieldAlignment)
  paddingBefore = fieldOffset - offset
  if paddingBefore > 0:
    paddingRanges.push({ offset, size: paddingBefore, kind: "interField" })
    transitivePaddingRanges.push({ offset, size: paddingBefore, kind: "interField" })
  for nestedPadding in layout(field.type).aggregateStorage?.transitivePaddingRanges ?? []:
    transitivePaddingRanges.push({
      offset: fieldOffset + nestedPadding.offsetBytes,
      size: nestedPadding.sizeBytes,
      kind: nestedPadding.kind
    })
  offset = fieldOffset + layout(field.type).size
  alignment = max(alignment, fieldAlignment)
size = alignUp(offset, alignment)
trailingPadding = size - offset
if trailingPadding > 0:
  paddingRanges.push({ offset, size: trailingPadding, kind: "trailing" })
  transitivePaddingRanges.push({ offset, size: trailingPadding, kind: "trailing" })
stride = size
```

This is the default target aggregate policy. If the selected target requires a
different aggregate ABI layout, the policy must be represented in
`LayoutTargetSurface` and tested as target data. Source code must not carry
hidden packing directives unless semantic, HIR, mono, and layout facts expose
them explicitly. For validated-buffer values, the aggregate field sequence is
the hidden pointer, hidden length, then parameter fields; for ordinary
aggregates, it is the mono source field sequence.

## Boundary With Proof MIR

Proof MIR receives `MonomorphizedHirProgram` plus `LayoutFactProgram`. It must
preserve layout type keys and field facts on lowered loads, stores, places, and
validated-buffer reads.

Proof MIR uses layout facts to:

- attach concrete byte offsets to field-sensitive places
- create `layout.fits(end)` checks for validated-buffer fixed fields
- create `payloadEnd(end)` and `layout.fits(end)` checks for dynamic payloads
- create `noUnsignedOverflow` checks for runtime layout arithmetic
- treat validated-buffer reads as unaligned-safe wire reads with explicit wire
  encoding
- ensure field reads use the field fact for the concrete owner type instance
- preserve image device representation facts for image-seeded capabilities
- ensure platform call arguments match certified ABI and proof contract facts
- prevent byte-copy exposure of aggregate padding until padding is initialized
- preserve target pointer width for pointer arithmetic and address facts

Proof MIR proves whether those facts are available along each path. Layout only
creates the fact vocabulary and rejects impossible or unsupported
representations.

## Boundary With Code Generation

Code generation consumes the same layout facts after proof checking succeeds. It
uses type and field facts for loads, stores, address calculation, enum tag
selection, validated-buffer byte reads, and aggregate moves. It uses ABI facts
to lower calls and returns.

Validated-buffer byte reads are wire reads. Codegen must honor
`LayoutWireReadPolicy` and `WireScalarEncoding`: it may assemble bytes
explicitly, use a target-safe unaligned load, or call a target helper, but it
must not replace a wire read with an ordinary host-aligned aggregate load.
When `readPolicy.lowering === "targetProvided"`, `helperId` must resolve in
`LayoutTargetSurface.wireReadHelpers`, the helper's `encoding` must match the
field's wire encoding, and the helper's result type must match the field's
layout type. Codegen lowers only to that helper contract; it must not infer a
helper from a string name or target convention.

Aggregate moves that can expose bytes outside the program, such as writes to a
validated transmit buffer or firmware-owned output memory, must respect padding
facts. A fieldwise observable copy must recurse through nested aggregates to
leaf scalar fields or use `transitivePaddingRanges` to skip every padding byte.
Codegen may also zero padding first or call a target helper whose contract
initializes padding. It must not blindly copy uninitialized direct or nested
padding into observable memory.

Frame layout remains a codegen responsibility because it depends on register
allocation, spill decisions, call lowering, and target prologue/epilogue rules.
Object section layout, symbol addresses, relocations, and PE/COFF structures
remain linker and binary-writer responsibilities.

## Diagnostics

Layout diagnostics must be deterministic and source-level when possible.
Every diagnostic includes a stable code, a source origin when available, and a
stable detail key built from target ID, mono instance ID, field ID, function
instance ID, or platform edge ID.

```ts
export interface LayoutDiagnostic {
  readonly severity: "error" | "warning" | "note";
  readonly code: string;
  readonly message: string;
  readonly sourceOrigin?: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
}
```

Important diagnostic families:

- missing primitive layout spec for a reachable core or target type
- invalid target data model, size, alignment, pointer, enum, or ABI rule
- target mismatch between layout surface and reachable platform contract edge
- reachable mono error type or recovered body node at a layout-sensitive
  boundary
- source checked type that cannot be resolved to exactly one mono type instance
- internal mono invariant violation such as duplicate canonical type instances
- unsupported source representation such as runtime interface values
- unsupported enum representation such as payload cases without concrete mono
  payload metadata and target enum payload policy
- negative enum discriminant start or enum discriminant overflow
- recursive by-value type layout
- field type with no layout, no size, no alignment, or forbidden `Never`
  storage
- aggregate size, field offset, stride, or alignment overflow
- validated-buffer layout expression outside the accepted term language
- validated-buffer term with missing finite range provenance
- validated-buffer negative offset, negative length, overlapping fixed fields,
  dynamic fields without structural order, or forward dependency on later
  fields
- validated-buffer multi-byte wire field without explicit endian encoding
- validated-buffer wire field whose element type has no wire-compatible size,
  stride, or unaligned-safe read policy
- validated-buffer target-provided wire read without a matching helper contract
- validated-buffer derived cases that are not provably exclusive and total
- missing validated-buffer hidden handle type, source length type, or
  no-overflow requirement for runtime byte-range arithmetic
- inconsistent hidden source pointer/source length facts between aggregate
  storage and validated-buffer value storage
- missing target device surface layout for an image device
- missing target image profile for the selected image entry boundary
- ABI classification failure for a reachable function, platform edge, return
  type, or image entry boundary
- hidden ABI parameter ordering or shape-linkage inconsistency
- inconsistent mono tables, such as a validated-buffer row without a matching
  source type instance

When several errors have the same root cause, the builder must prefer one
root diagnostic and suppress cascading ABI or field diagnostics that would only
repeat "no layout exists for this type."

Suppression is dependency-based:

- each fact builder records the owner key it is trying to build and the owner
  keys of facts it depends on
- when a builder emits an error for an owner key, downstream builders that
  depend on that owner key skip work and do not emit generic "missing layout"
  follow-up errors
- if a downstream builder can add narrower context, it may emit a note related
  to the root diagnostic rather than a second error
- at most one error with the same `code`, `ownerKey`, and `rootCauseKey` is
  emitted; later duplicates are suppressed by stable detail ordering

This keeps a bad primitive type spec from producing one field error, one
aggregate error, one ABI error, one image-entry error, and one platform-edge
error for the same missing layout.

## Determinism

Layout output must be deterministic for the same mono program and target layout
surface.

- Target catalog entries are sorted by ID.
- Type facts are sorted by `LayoutTypeKey`.
- Source fields are visited in mono field order and then keyed by owner type and
  field ID.
- Enum cases are sorted by source ordinal.
- Validated-buffer fields are sorted by declaration order.
- Function ABI facts are sorted by function instance ID.
- Platform ABI facts are sorted by platform edge ID.
- Diagnostics are sorted by source origin, diagnostic code, and stable detail.

The implementation must not depend on JavaScript `Map` insertion order for
semantic output. Builders may use maps internally only when every public
`entries()` result is sorted by the table's canonical key serializer before it
is exposed.

## Implementation Sequencing

The design is one production phase contract. Implementation can land in smaller
reviewable slices only when each slice preserves the final public shapes and
rejects unsupported reachable programs rather than accepting partial facts:

1. Pipeline syntax prerequisites: parser and AST support for contextual `le`
   and `be` validated-buffer layout type markers, semantic normalization into
   checked wire scalar encodings, enum case metadata, validated-buffer layout
   expression surfaces, HIR and mono preservation of explicit wire scalar
   encodings, mono-owned published layout type keys, and mono-published type
   resolution table.
2. Layout substrate: target surface validation, deterministic canonical key
   serializers, diagnostics, primitive type facts, and source type key
   translation from mono-published keys.
3. Source representation facts: ordinary source aggregates, fieldless enums,
   zero-sized capability tokens, direct and transitive padding facts, image
   device facts, and deterministic diagnostics.
4. Validated-buffer facts: hidden source handle storage, scalar and
   target-provided aggregate wire type facts, unaligned-safe read policies,
   finite range provenance, affine term normalization, range and overflow
   requirements, derived-case totality, and `readRequires` completeness tests.
5. ABI facts: source-call classifier integration, enum tag classification,
   floating-point lane support when target primitives expose floats,
   zero-sized values, indirect transport, hidden parameter invariants, platform
   edge ABI facts, target wire-read helper contracts, and image-entry thunk
   facts from target image profiles.
6. Integration hardening: full closed mono fixtures, independent layout oracle
   tests, cascade suppression, determinism, and public API coverage.

## Testing Strategy

Unit tests should cover each value object and algorithm:

- target data model validation
- primitive type fact seeding
- mono checked type to layout type key resolution
- aggregate field offset and padding computation
- enum tag width selection and discriminant assignment
- validated-buffer fixed and dynamic layout terms
- validated-buffer wire endian and wire-stride rejection for host-padded types
- target-provided aggregate wire facts with per-field wire offsets
- unaligned-safe wire read policy
- validated-buffer dependency and overlap rejection
- validated-buffer runtime arithmetic overflow requirements
- validated-buffer range constraints for subtraction and bounded arithmetic
- validated-buffer source handle storage and source length typing
- derived-case coverage and overlap rejection
- ABI classification for scalar, aggregate, zero-sized, indirect, platform, and
  image entry cases
- hidden ABI parameter ordering and shape linkage
- observe/consume parameter modes mapped to ABI transport ownership
- diagnostic sorting and cascade suppression

Integration tests should build small closed mono programs through fixtures and
assert the complete `LayoutFactProgram` shape. The most important source-level
coverage is:

- a generic aggregate after monomorphization has distinct concrete field facts
- a validated buffer with fixed fields produces `layout.fits(fixedEnd)` inputs
- a validated buffer with dynamic length produces `payloadEnd` and
  `layout.fits` inputs plus overflow checks
- a platform primitive call receives ABI facts tied to its certified edge
- a platform edge whose target ID differs from the selected layout target is
  rejected
- an aggregate with trailing padding records padding ranges and cannot be
  exposed by a raw observable byte copy without initialization facts
- unsupported runtime interface values are rejected before Proof MIR
- output is byte-for-byte deterministic across repeated runs

Property tests may use `fast-check` in tests only. Useful generators include
small aggregate field lists, primitive size/alignment catalogs, fieldless enum
case lists, and validated-buffer term DAGs. Generated tests should compare the
production layout engine against independent oracles: hand-encoded offset and
padding tables for representative aggregate shapes, direct interval-set checks
for derived cases, and a deliberately simple arithmetic-range interpreter for
validated-buffer terms. A slow reference calculator is useful only if it is
implemented from these independent rules rather than copied from production
helpers.

Before handing off layout implementation work, run:

```bash
bun run agent:check
```

## Open Extension Points

These constructs are rejected by this layout contract unless a dedicated design
extends the language, HIR, mono, layout facts, Proof MIR, and codegen contracts
that would make them concrete:

- source-level representation attributes for enum tag type, packing, or
  alignment
- payload-bearing enums with tag-plus-union, niche, or target-specific layout
- runtime interface values with vtables, fat pointers, or static devirtualized
  erasure
- `MoveRing`, cross-core shared-memory slots, `Core.pin` worker state transfer,
  and core-movable eligibility layout facts
- explicit pointer/reference source types
- non-byte-addressed targets
- optimized internal calling conventions distinct from platform ABI
- cached or incremental layout keyed by mono instance and target layout version
