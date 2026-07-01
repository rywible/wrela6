# Internal Linker Design

## Purpose

The internal linker is the compiler phase after AArch64 backend object emission
and before the PE/COFF EFI writer. It consumes one closed set of verified
`AArch64ObjectModule` records plus an authenticated image-layout policy. It
returns a deterministic linked image layout: output sections, contribution
placements, resolved symbol addresses, applied relocations, base-relocation
records, entry-point RVA, unwind/image metadata, and provenance that the final
writer can serialize without re-solving compiler semantics.

The previous AArch64 backend pass already implemented the internal object
module. That object model is the linker input contract, not work to repeat
here. It contains sections, encoded bytes, fragments, symbols, relocations,
literal pools, veneers, unwind records, byte provenance, fact-spending records,
verification summaries, and deterministic fingerprints. The linker should
therefore own linking over object modules, not backend object construction.

The linked image layout is still not a PE/COFF file. It is the last structured
compiler artifact before bytes are written. The PE/COFF writer should be able to
serialize the layout by following offsets and records already chosen by the
linker; it should not decide symbol binding, perform branch range recovery, pick
entry symbols, or reinterpret AArch64 relocation semantics.

## Phase Boundary

The phase boundary is:

```text
AArch64ObjectModule[]
  + AArch64 linker/image target surface
  + compiler-owned synthetic object providers
  + requested image entry contract
  -> synthetic object materialization
  -> object input validation
  -> section contribution normalization
  -> symbol table construction and resolution
  -> output section layout
  -> relocation planning, application, and base-relocation creation
  -> entry symbol resolution
  -> linked-image verification
  -> AArch64LinkedImageLayout
```

The backend is responsible for machine code, final stack frames, instruction
encoding, intra-object layout, literal-pool placement, backend-owned veneers,
unwind planning, and object verification. The linker is responsible for
multi-object composition, final output section layout, final symbol addresses,
relocation patching against those addresses, linker-owned veneers when the
backend delegated them, base relocation records, and entry-point resolution.

The PE/COFF writer is responsible for serializing an already-linked layout into
a PE32+ EFI image: DOS stub, PE signature, headers, section table, data
directories, `.reloc` bytes, checksum policy if needed, and final byte buffer.

## Relationship To The PE/COFF Writer

Keep this design separate from the PE/COFF EFI writer design. The two phases are
adjacent, but combining them would blur semantic link decisions with byte-format
serialization. This phase proves that the image has one coherent linked layout.
The next phase should prove that the linked layout is serialized as a valid
PE32+ EFI file.

The companion writer design should live in its own document, for example
`docs/design/pe-coff-efi-writer-design.md`. It should consume
`AArch64LinkedImageLayout` and should not inspect backend object modules. That
boundary keeps two independent validation loops possible:

- the linker gets a layout validator that recomputes section placement, symbol
  RVAs, relocation values, base relocation records, and entry RVA
- the PE/COFF writer gets an independent PE reader that parses emitted bytes and
  checks headers, section table entries, data directories, `.reloc` encoding,
  and `AddressOfEntryPoint`

This document may mention writer-facing constraints because the linker must
choose RVAs, virtual section order, section flags, and base-relocation records
that the writer can serialize. The writer design owns raw file layout and the
final byte format.

## Existing Context

The current backend output lives at:

- `src/target/aarch64/backend/object/object-module.ts`
- `src/target/aarch64/backend/object/layout-encode-fixed-point.ts`
- `src/target/aarch64/backend/object/relocation-records.ts`
- `src/target/aarch64/backend/verify/encoding-object-verifier.ts`
- `src/target/aarch64/backend/api/compile-aarch64-object.ts`

`AArch64ObjectModule` already provides most of the shape the linker needs:

- `sections` with stable keys, alignment, bytes, and fragment offsets
- `symbols` with stable keys, section keys, offsets, and global/local binding
- `relocations` with stable keys, section keys, patch offsets, widths,
  families, target symbols, and bit ranges
- `literalPools`, `veneers`, and `unwindRecords`
- `byteProvenance` and `factSpending`
- target and closed-image-plan fingerprints
- deterministic module fingerprints

The current backend sometimes models external public callee symbols through a
special `.extern` section. The linker design should replace that with explicit
`external-declaration` symbols as part of the object-contract extension. The
linker should not carry `.extern` as a section concept.

Two important gaps remain at the link boundary:

- The object module's public symbol record has only `stableKey`, `sectionKey`,
  `offsetBytes`, and `isGlobal`. That is not enough to distinguish local
  definitions, global definitions, and external declarations. The object
  contract must become a discriminated symbol contract before
  symbol-resolution work starts.
- The object section record has no explicit link class. The linker should not
  classify sections by exact strings or prefixes, so the backend and synthetic
  providers must emit an explicit object section class.
- The backend already computes richer relocation records with explicit addends
  and pair metadata in `relocation-records.ts`, but the public object module
  currently drops those fields. The object contract must carry that richer data
  forward instead of asking the linker to reconstruct it from encoded bytes.
- The object module does not carry an image entry symbol. The linker input must
  name the requested loader entry symbol, and the target image surface must name
  any required Wrela boot-function handoff symbol.

These are object-contract extensions, not a second object-model project. The
linker still consumes `AArch64ObjectModule`; the module must simply expose the
linkage and relocation facts the backend already knows.

## Required Object Contract Extensions

The linker implementation should start by extending the backend object module
contract in place. This is a prerequisite for the linker, not an optional later
cleanup.

Symbols should distinguish stable identity, linkage identity, and declaration
kind:

```ts
export type AArch64ObjectSymbol =
  | {
      readonly kind: "local-definition";
      readonly stableKey: AArch64ObjectSymbolId;
      readonly sectionKey: AArch64ObjectSectionId;
      readonly offsetBytes: number;
    }
  | {
      readonly kind: "global-definition";
      readonly stableKey: AArch64ObjectSymbolId;
      readonly linkageName: string;
      readonly sectionKey: AArch64ObjectSectionId;
      readonly offsetBytes: number;
    }
  | {
      readonly kind: "external-declaration";
      readonly stableKey: AArch64ObjectSymbolId;
      readonly linkageName: string;
    };
```

`stableKey` remains the deterministic object-local symbol identity. Global
definitions and external declarations carry the cross-module `linkageName`.
Local definitions do not. The linker never treats a module-prefixed `symbolKey`
as a linkage name. Relocations that target a same-module local label reference
that symbol's `stableKey`. Relocations that target another module, an external
declaration, the loader entry, or the Wrela boot function reference a
`linkageName`.

Sections should carry an explicit link class:

```ts
export interface AArch64ObjectSection {
  readonly stableKey: AArch64ObjectSectionId;
  readonly classKey: AArch64ObjectSectionClassKey;
  readonly alignmentBytes: number;
  readonly bytes: readonly number[];
  readonly fragments: readonly AArch64ObjectFragment[];
}
```

Unknown object section classes fail closed during normalization. Exact section
key matching and prefix matching are not linker architecture.

Relocations should carry the fields the backend already computes:

```ts
export interface AArch64ObjectRelocation {
  readonly stableKey: AArch64ObjectRelocationId;
  readonly sectionKey: AArch64ObjectSectionId;
  readonly offsetBytes: number;
  readonly widthBytes: number;
  readonly family: AArch64InternalRelocationFamily;
  readonly target: AArch64ObjectRelocationTarget;
  readonly addend: bigint;
  readonly bitRange: readonly [number, number];
  readonly encodingOwner?: AArch64ObjectRelocationEncodingOwner;
  readonly pairedRelocationKey?: AArch64ObjectRelocationId;
  readonly linkerVeneer?: AArch64ObjectLinkerVeneerRequest;
}

export type AArch64ObjectRelocationTarget =
  | { readonly kind: "symbol-stable-key"; readonly stableKey: string }
  | { readonly kind: "linkage-name"; readonly linkageName: string };

export interface AArch64ObjectRelocationEncodingOwner {
  readonly opcode: AArch64PhysicalOpcode;
  readonly catalogEntryKey: string;
  readonly accessScaleBytes?: number;
}
```

`targetSymbol: string` can remain as a compatibility field during migration, but
the linker should consume only the structured `target`. Unknown relocation
family strings are rejected during object construction or linker normalization.
Instruction relocation families must carry a non-optional `bitRange`; if a
family has one canonical range, the object constructor may derive it from the
authenticated relocation catalog before freezing the module.
Instruction relocations also carry `encodingOwner`. Low-12 load/store
relocations require `accessScaleBytes`, supplied by the backend from the
authenticated encoding owner. The linker may decode bytes to verify the owner
matches the final instruction word, but byte decoding is not semantic
authority.

The current `AArch64ObjectRelocationRecord.addend` and
`pairedRelocationKey` fields should be promoted into `AArch64ObjectRelocation`
rather than decoded later. Reconstruction from in-place bytes is a verifier
check, not the source of truth for linker semantics.

## Goals

- Consume verified `AArch64ObjectModule` records and preserve their bytes unless
  a relocation patch, linker-owned veneer, synthetic image object, or explicit
  relocation-table section changes the final image.
- Treat the existing backend object module as the input object format.
- Extend the existing object module contract before linker work so symbols carry
  discriminated symbol definitions/declarations, sections carry explicit link
  classes, and relocations carry structured targets, addends, pair keys, bit
  ranges, encoding owners, and linker-veneer requests.
- Define a separate linked-image layout model for output sections,
  contributions, resolved symbols, relocation results, base relocation records,
  entry-point metadata, and deterministic fingerprints.
- Support one closed `wrela-uefi-aarch64-rpi5-v1` image link in production,
  while keeping the core linker data structures clean enough for future target
  adapters.
- Materialize compiler-owned image objects, including the PE/COFF loader entry
  thunk, through target-provided object providers that produce normal internal
  object modules.
- Merge object sections into deterministic output image sections according to
  authenticated section-class and writer-layout policy.
- Preserve object contribution boundaries so diagnostics can map every output
  byte back to module, section, fragment, provenance, and fact-spending records.
- Resolve local, global, and external symbols deterministically.
- Reject duplicate global definitions, ambiguous local references, unresolved
  required symbols, symbols placed in non-layout sections, and entry symbols
  outside executable image sections.
- Apply all resolvable relocations to output bytes after final section RVAs are
  known.
- Create PE base-relocation records for absolute image-base-dependent patches,
  without serializing the `.reloc` bytes in this phase.
- Check AArch64 relocation ranges and bitfield encodings after final layout.
- Insert linker-owned veneers only for relocations that the backend and target
  catalog explicitly allowed to be linker-owned.
- Produce deterministic diagnostics, deterministic output section order,
  deterministic symbol order, deterministic relocation order, and deterministic
  layout fingerprints.
- Keep runtime linker source dependency-free: no filesystem reads, no `Bun`
  APIs, no subprocess linker, no assembler, no disassembler, no clock, no host
  environment, and no source/HIR/proof/OptIR inspection.

## Non-Goals

- This phase does not build `AArch64ObjectModule`. The backend owns that.
- This phase does not allocate registers, change stack frames, run machine
  scheduling, rewrite ABI conventions, or re-encode non-relocation instruction
  bytes.
- This phase does not re-run source reachability, monomorphization, proof
  checking, OptIR optimization, or AArch64 lowering.
- This phase does not serialize PE/COFF headers, section tables, data
  directories, or final file bytes.
- This phase does not call an external linker or produce a reusable external
  object file.
- This phase does not support arbitrary dynamic imports for UEFI images. For the
  first target, unresolved external declarations are errors unless a future
  target surface explicitly defines an import-thunk model.
- This phase does not perform general link-time optimization. Dead-section
  elimination is a future optional pass and requires explicit contribution
  reachability metadata. The closed-image pipeline should avoid emitting
  unreachable functions before this phase.
- This phase does not let a later export decision invalidate private ABI
  choices. Any symbol that might need public ABI must have been classified
  before backend object emission.

## Repository Shape

```text
src/
  linker/
    index.ts
    diagnostics.ts
    image-layout-policy.ts
    linked-image-layout.ts
    object-normalization.ts
    section-layout.ts
    symbol-resolution.ts
    relocation-application.ts
    entry-resolution.ts
    verifier.ts

    aarch64/
      aarch64-linker.ts
      aarch64-relocations.ts
      aarch64-section-policy.ts
      aarch64-entry-objects.ts
      aarch64-linked-image.ts

tests/
  support/
    linker/
      linker-fixtures.ts
      aarch64-object-link-fixtures.ts

  unit/
    linker/
      object-normalization.test.ts
      section-layout.test.ts
      symbol-resolution.test.ts
      relocation-application.test.ts
      entry-resolution.test.ts
      linked-image-verifier.test.ts
      aarch64-linker.test.ts

  integration/
    linker/
      aarch64-linked-image-layout.test.ts
      aarch64-backend-to-linker.test.ts
```

The generic `src/linker` modules define target-independent layout mechanics:
module identity, contribution placement, symbol tables, diagnostics,
deterministic metadata, and verifier scaffolding. The `src/linker/aarch64`
adapter imports the AArch64 backend object types, AArch64 relocation families,
and the UEFI/AArch64 image-layout policy.

Earlier compiler phases must not import `src/linker/**`. The linker may import
the AArch64 object model because object modules are its input.

## Public API

The AArch64-facing public API should be small:

```ts
export interface LinkAArch64ImageInput {
  readonly objectModules: readonly AArch64LinkInputModule[];
  readonly target: AArch64LinkerTargetSurface;
  readonly entry: AArch64ImageEntryRequest;
  readonly syntheticObjects?: readonly AArch64SyntheticObjectProvider[];
  readonly veneerProvider?: AArch64LinkerVeneerProvider;
  readonly diagnosticMode?: LinkerDiagnosticMode;
}

export interface AArch64LinkInputModule {
  readonly moduleKey: string;
  readonly objectModule: AArch64ObjectModule;
}

export interface AArch64ImageEntryRequest {
  readonly wrelaBootLinkageName: string;
}

export type LinkAArch64ImageResult =
  | {
      readonly kind: "ok";
      readonly layout: AArch64LinkedImageLayout;
      readonly diagnostics: readonly LinkerDiagnostic[];
      readonly verification: LinkerVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly LinkerDiagnostic[];
      readonly verification: LinkerVerificationSummary;
    };

export function linkAArch64Image(input: LinkAArch64ImageInput): LinkAArch64ImageResult;
```

`AArch64SyntheticObjectProvider` is dependency injected for tests and target
profiles. It returns normal `AArch64ObjectModule` records. The production target
uses it for compiler-owned image-entry objects, target runtime helpers, and
other generated image sections that are not emitted from user source functions.

The linker must never construct A64 instruction words ad hoc. If a synthetic
object needs code bytes, the target provider produces an object through the same
authenticated backend catalogs and object-verification path used by ordinary
code.

The same rule applies to linker-owned veneers. A veneer provider must return a
preverified object contribution or normal object module fragment whose bytes
come from authenticated AArch64 encoding catalogs. If the target has no veneer
provider, linker-owned veneer requests fail closed instead of being assembled in
the linker.

## Target Surface

The linker should authenticate its own target surface instead of trusting loose
option bags:

```ts
export interface AArch64LinkerTargetSurface {
  readonly targetKey: "wrela-uefi-aarch64-rpi5-v1";
  readonly linkerSurfaceFingerprint: string;
  readonly backendSurfaceFingerprint: string;
  readonly relocationCatalogFingerprint: string;
  readonly sectionLayout: AArch64ImageSectionLayoutPolicy;
  readonly relocationPolicy: AArch64ImageRelocationPolicy;
  readonly entryPolicy: AArch64ImageEntryPolicy;
  readonly constants: AArch64UefiImageLayoutConstants;
}
```

The target surface owns:

- output section order and section flags
- virtual section alignment
- preferred image base policy
- allowed image base relocation kinds
- relocation-family semantics for final link application
- linker-owned veneer policy
- legal entry section class
- whether debug/provenance sections are included in the image layout
- maximum image size and address range checks
- v1 layout constants: preferred image base, virtual section alignment,
  PE machine expectation, EFI subsystem expectation, and maximum image size

The linker consumes authenticated records. It must not infer platform behavior
from string names like `.text`; it consumes object section classes and target
section-policy records.

For `wrela-uefi-aarch64-rpi5-v1`, the target surface must close these values
before implementation starts:

| Field                   | Required contract                                                                 |
| ----------------------- | --------------------------------------------------------------------------------- |
| `preferredImageBase`    | PE32+ image base used for absolute address patching and base-relocation planning  |
| `sectionAlignmentBytes` | virtual section alignment; power of two and accepted by the PE/COFF writer policy |
| `machine`               | AArch64 COFF machine expectation                                                  |
| `subsystem`             | EFI application subsystem expectation                                             |
| `maxImageSizeBytes`     | maximum linked image size before writer serialization                             |
| `sectionFlags`          | executable/readable/writable/discardable flags for every linked section class     |

The design intentionally stores these as authenticated target records. Linker
runtime code should consume the records, not duplicate PE constants.

The policy records should expose data, not trusted callbacks, wherever possible:

```ts
export interface AArch64ImageSectionLayoutPolicy {
  readonly outputSections: readonly AArch64LinkedSectionClass[];
  readonly objectSectionClassMappings: readonly AArch64ObjectSectionClassMapping[];
  readonly contributionAlignments: readonly AArch64ContributionAlignmentRule[];
}

export interface AArch64ImageRelocationPolicy {
  readonly families: readonly AArch64LinkRelocationFamilyPolicy[];
  readonly baseRelocationKinds: readonly AArch64BaseRelocationKindPolicy[];
}

export interface AArch64ImageEntryPolicy {
  readonly loaderEntryLinkageName: string;
  readonly requiresBootHandoff: boolean;
  readonly requiredEntrySectionClass: "executable";
}
```

Authentication rebuilds lookup tables from these arrays, following the same
pattern as the backend target surface. Linker internals consume the rebuilt
catalogs and reject duplicate or missing policy records deterministically.

## Input Object Normalization

The linker should convert raw object modules into a normalized link graph before
symbol resolution or layout. Normalization makes later algorithms simple and
auditable.

```text
NormalizedObjectModule
  moduleKey
  moduleFingerprint
  targetBackendSurfaceFingerprint
  closedImagePlanFingerprint
  sections
  symbols
  relocations
  provenance
```

`moduleKey` is mandatory. Callers and synthetic providers must supply stable,
unique module keys before linking begins:

```text
module:<origin-kind>:<stable-origin-key>
```

The linker rejects missing or duplicate module keys. It never derives layout
keys from caller input order. Normalization sorts input modules by `moduleKey`
before section layout, symbol indexing, diagnostics, and provenance
construction. Two byte-identical synthetic modules may have the same
fingerprint, but their providers must assign distinct stable module keys.

Normalization checks:

- every object module has the authenticated backend surface fingerprint
  expected by the linker target
- every object module was verified by the backend object verifier
- every object module has sorted repeated records and deterministic metadata
- every section has a known object section class and valid alignment
- every local or global definition's section exists
- every global definition or external declaration has a `linkageName`
- every external declaration has no section or offset
- no local symbol's module-scoped `stableKey` is used as a cross-module linkage
  name
- every relocation's patch section exists and patch range is in bounds
- every relocation family is known to the linker relocation policy
- relocation bit ranges and widths match the authenticated family policy; a
  missing bit range is accepted only when the object constructor has already
  filled the family's canonical bit range
- relocation target records refer either to a same-module symbol stable key or
  to a linkage name
- relocation addends, paired relocation keys, and linker-veneer requests are
  present when required by the family policy
- instruction relocations carry authenticated encoding-owner metadata; low-12
  load/store relocations carry `accessScaleBytes`
- linker-veneer requests include backend-declared scratch assumptions and
  security/provenance labels needed by the veneer policy
- byte provenance covers every non-empty layout section

Normalization produces explicit linker relocations:

```text
LinkRelocation
  relocationKey
  sourceModuleKey
  sourceSectionKey
  sourceOffsetBytes
  sourceWidthBytes
  sourceBitRange
  family
  target
  addend
  encodingOwner?
  pairKey?
  linkerVeneerAllowed
  linkerVeneerRequest?
  baseRelocationPolicy
```

Normalization validates and copies explicit relocation metadata. It does not
decode addends from instruction fields, infer page pairs from adjacency, or
treat missing addends as zero. The fast verifier may decode in-place fields
later to prove that the object bytes and relocation metadata agree, but decoded
bytes are evidence, not authority.

## Section Model

The linker distinguishes three section layers:

```text
ObjectSection
  section emitted by AArch64ObjectModule

SectionContribution
  one object's section bytes placed inside one output image section

LinkedImageSection
  final output section with RVA, bytes, flags, and contribution map
```

Object section keys are internal compiler keys. Object section classes are the
linkable semantic class emitted by the backend or synthetic provider. Linked
image section keys are target-policy keys such as `.text`, `.rdata`, `.data`,
`.pdata`, `.xdata`, or debug/provenance keys. The section policy maps object
section classes to image sections and declares whether the result is executable,
readable, writable, discardable, debug-only, zero-fill, or relocation-bearing
data.

Unknown object section classes are errors. The linker does not classify by
exact section keys, prefixes, or conventional names. There is no fallback where
the linker says "a key named `.text` must be executable"; the object class and
target policy say which contributions are executable.

The first implementation should support bytes-bearing contributions only.
Zero-fill output sections require an explicit `zeroFillSizeBytes` contribution
record in a future object or synthetic-provider contract; the linker must not
invent BSS size from an empty byte array.

For the first AArch64 UEFI target:

| Object section class             | Linked image section | Notes                                                      |
| -------------------------------- | -------------------- | ---------------------------------------------------------- |
| executable text                  | `.text`              | executable, readable, 4-byte instruction alignment minimum |
| read-only constants and metadata | `.rdata`             | readable, not executable                                   |
| writable initialized data        | `.data`              | readable and writable                                      |
| unwind procedure records         | `.pdata` / `.xdata`  | writer-compatible unwind records when present              |
| debug/provenance image sections  | target policy        | included only when target/debug policy permits             |

The backend currently often emits literal pools into the same object section as
text. The linker should preserve that placement unless a later backend object
contract explicitly splits literal-pool sections. Literal-pool reach was already
verified by the backend within the object. Link-time movement must not break it.

## Section Layout

Section layout is deterministic and policy-driven:

1. Normalize all object sections into `SectionContribution` records.
2. Classify each contribution with the authenticated section policy.
3. Sort output sections by target policy order, then stable key.
4. Sort contributions inside an output section by:
   - section priority from target policy
   - source module key
   - object section class
   - object section key
   - object section fingerprint
5. Align each contribution start to the maximum of the object section alignment
   and target contribution alignment.
6. Fill contribution padding with deterministic zero bytes and explicit padding
   provenance.
7. Compute each output section's virtual size, RVA, and alignment.
8. Re-run section layout if linker-owned veneers change section sizes.

The layout is finite because decisions only grow:

- adding a linker-owned veneer adds bytes to an executable section
- section padding can grow when previous sections grow
- no pass removes bytes after a layout iteration starts

The implementation should use that monotone property directly. Each iteration
lays out sections, resolves symbol RVAs, re-evaluates every relocation range,
requests any newly required linker-owned veneers, estimates base relocation
records, and repeats if section sizes changed. The iteration stops only when
the set of veneer contributions, section sizes, symbol RVAs, and structured
base relocation records are unchanged. A fixed iteration cap emits a deterministic
`section-layout:fixed-point-exhausted` diagnostic.

Conditional and test-branch relocations (`branch19` and `branch14`) are not
veneerable in v1. They must remain in range in every iteration. If adding a
veneer contribution pushes one out of range, the linker fails closed unless the
backend object contract proves the branch target is inside the same rigid
contribution and therefore moves by the same delta.

The linked section record should make virtual layout explicit:

```text
LinkedImageSection
  stableKey
  classKey
  flags
  alignmentBytes
  rva
  virtualSizeBytes
  bytes
  contributions
```

Raw file offsets, PE header reservation, file alignment, raw section-size
rounding, and serialized data-directory byte sizes belong to the PE/COFF
writer. The linker gives the writer final RVAs, virtual section order, section
flags, final section bytes before file padding, symbols, applied relocations,
and structured base-relocation records. The writer may not change RVAs,
section order, symbols, or relocation results while computing raw file offsets.

## Symbol Model

The linker builds two symbol namespaces:

- local symbols are scoped by module key
- linkage names are visible across modules

Each normalized symbol becomes:

```text
LinkSymbol
  symbolKey
  linkageName?
  sourceModuleKey
  objectSymbolKey
  binding: local | global | external
  definition: defined | declaration
  objectSectionKey
  objectOffsetBytes
```

Binding is derived deterministically:

- `local-definition` symbols are local definitions and must not have a
  `linkageName`
- `global-definition` symbols are global definitions and must have a
  `linkageName`
- `external-declaration` symbols are external declarations and must have a
  `linkageName`

Only definitions carry sections and offsets. Local symbols in different modules
may have the same object `stableKey` because their `symbolKey` includes the
module key. Global definitions may not conflict. There is no weak, COMDAT, or
first-definition-wins behavior in v1; duplicate runtime/user global helpers are
an upstream deduplication or reserved-name error.

Resolution rules for a relocation in module `M`:

1. If the target is `{ kind: "symbol-stable-key" }`, resolve only against
   module `M`'s object-local symbol table.
2. If the target is `{ kind: "linkage-name" }` and module `M` defines a global
   symbol with that linkage name, resolve to the same-module global definition.
3. Otherwise, if exactly one global definition has that linkage name, resolve
   to that global symbol.
4. Otherwise, if only external declarations have that linkage name, resolve
   according to the target import policy. For `wrela-uefi-aarch64-rpi5-v1`,
   this is an unresolved-symbol error.
5. Otherwise, emit an ambiguous-symbol diagnostic.

Same-module global definitions intentionally win over cross-module definitions
for a linkage-name relocation emitted by the same module, but object-local
stable-key relocations never resolve cross-module. The object verifier should
already reject duplicate symbol stable keys inside one module.

After section layout, every defined symbol becomes:

```text
ResolvedImageSymbol
  symbolKey
  linkageName?
  binding
  sourceModuleKey
  sectionKey
  contributionKey
  rva
  objectOffsetBytes
```

The linker must reject symbols whose offsets are outside their contribution,
definitions in non-layout sections, external declarations with section data, and
global definitions that map to non-layout sections.

## Entry Symbol Resolution

The linker resolves the image entry after synthetic objects are included and
after symbols are resolved. The target entry policy owns the loader-entry shim
contract. The link input only names the Wrela boot function or requested program
entry:

```text
AArch64ImageEntryRequest
  wrelaBootLinkageName
```

For the UEFI PE/COFF target, the loader entry symbol should normally be the
compiler-owned shim named by `target.entryPolicy.loaderEntryLinkageName`, for
example `__wrela_uefi_entry`. The Wrela boot symbol is the ordinary compiled
function named by `input.entry.wrelaBootLinkageName`, for example the machine
program's `entrySymbol`.

The entry shim is not a PE writer trick. It should be a synthetic object module
that participates in ordinary symbol resolution and relocation application:

```text
__wrela_uefi_entry:
  public AAPCS64/UEFI entry signature
  receive ImageHandle and SystemTable
  initialize the Wrela image context required by the target profile
  call or tail-call the Wrela boot symbol as specified by the target policy
  return EFI_STATUS or enter target-defined terminal handling
```

The linker verifies:

- `loaderEntryLinkageName` resolves to exactly one defined global symbol
- the symbol's output section class satisfies
  `target.entryPolicy.requiredEntrySectionClass`
- the symbol RVA fits the PE32+ entry-point field
- the entry object and boot object use the same backend target fingerprint
- the boot symbol resolves if the entry policy requires a boot handoff
- no unresolved relocation remains in the entry contribution

The linked layout records both symbols:

```text
entry:
  loaderEntryLinkageName
  loaderEntryRva
  wrelaBootLinkageName
  wrelaBootRva
```

The PE writer uses `loaderEntryRva` as `AddressOfEntryPoint`.

## Relocation Semantics

The linker works over Wrela internal relocation families. It does not emit COFF
object relocations for an executable image. It either applies a relocation to
final section bytes or creates an image base-relocation record that the writer
serializes into `.reloc`.

Core values:

```text
S = resolved target symbol RVA
P = RVA of the relocation patch site
A = explicit object relocation addend
B = preferred image base
```

For the first AArch64 target:

| Family             | Link-time action                                                  | Base relocation |
| ------------------ | ----------------------------------------------------------------- | --------------- |
| `branch26`         | patch signed scaled 26-bit branch/call immediate with `S + A - P` | none            |
| `branch19`         | patch signed scaled 19-bit conditional branch immediate           | none            |
| `branch14`         | patch signed scaled 14-bit test-branch immediate                  | none            |
| `pagebase-rel21`   | patch ADRP page delta `page(S + A) - page(P)`                     | none            |
| `pageoffset-12a`   | patch low 12-bit ADD page offset for `S + A`                      | none            |
| `pageoffset-12l`   | patch low 12-bit scaled load/store page offset for `S + A`        | none            |
| `addr64`           | patch `B + S + A` into 64-bit data                                | `DIR64`         |
| `addr32`           | patch absolute 32-bit address only when target policy permits     | target policy   |
| `addr32nb`         | patch 32-bit RVA `S + A`                                          | none            |
| `rel32`            | patch 32-bit relative value `S + A - P` where `P` is patch RVA    | none            |
| `section-relative` | patch section-relative value or writer-owned debug reference      | none            |

The relocation application owner must know how to read, mask, sign-check, and
write the exact little-endian A64 bitfield for each instruction relocation. Bit
ranges are numbered from least significant bit 0 in the encoded 32-bit
instruction word. Branch families use signed scaled immediates with the same
asymmetric A64 limits enforced by the backend branch-reach helpers. Low-12 load
and store relocations get their scale from the authenticated encoding owner
recorded on the object relocation, not from the relocation family string alone
and not from byte decoding as semantic authority. It should reuse backend
encoding helpers where possible, but the linker performs its own final range
and value checks against final RVAs.

Relocation application output:

```text
AppliedRelocation
  relocationKey
  sourceModuleKey
  family
  patchSectionKey
  patchRva
  targetSymbolKey
  targetRva
  addend
  encodingOwner?
  expectedEncodedValue
  patchedBytes
  baseRelocationKey?
```

Failed relocations include stable diagnostics with module, section, relocation,
family, target, patch RVA, target RVA, addend, and allowed range.

## Paired Relocations

ADRP plus low-12 relocation pairs must be validated together. The linker should
reject:

- missing pair partners when the relocation policy requires pairing
- pair partners in different modules unless explicitly allowed by the object
  model
- pair partners targeting different symbols
- low-12 page offsets whose access scale cannot encode the final address
- page-base relocations whose page delta is out of range
- pairs where one half is applied and the other half is left unresolved

The current backend relocation helper already models pairs internally. The
public object module must preserve those pair keys. The linker does not
reconstruct pairs from adjacency. If a family requires pairing and the
normalized relocation lacks `pairedRelocationKey`, the object is invalid.

## Linker-Owned Veneers

The backend can already create backend-owned veneers during layout. Linker-owned
veneers are different: the backend deliberately leaves a branch relocation
against the original target and delegates final range recovery to the linker.

The linker may insert a veneer only when all of these are true:

- the relocation family supports linker-owned veneers
- the normalized relocation says linker-owned veneers are allowed
- the target veneer policy provides a veneer kind for the site
- the link input includes an authenticated `AArch64LinkerVeneerProvider`
- the branch target is resolved and out of range from the final patch site
- the veneer can be placed in an executable section within range of the source
  branch
- the veneer body can reach the final target or can use a target-approved long
  branch sequence
- scratch register assumptions are declared by the backend and accepted by the
  target policy
- security provenance does not mark the site as secret or constant-time
  sensitive in a way that forbids linker-owned expansion

The first implementation should avoid clever veneer islands. It can append
deterministically sorted veneer contributions to the same output `.text` section
or to a target-approved `.text$veneer` contribution group. The veneer
contribution bytes, local symbol, relocation metadata, scratch-register
contract, and provenance all come from the veneer provider. The linker then
continues the section-layout fixed point and patches the original branch to the
veneer symbol.

Every linker-owned veneer becomes normal linked bytes with:

- a synthetic contribution record
- a local symbol
- an applied relocation from the original site to the veneer
- an applied relocation or direct patch from the veneer to the target
- byte provenance naming the source relocation and target policy

If the linker cannot place a legal veneer, it emits a relocation range
diagnostic. It must not silently leave an out-of-range branch for the writer.
If no veneer provider is configured, every linker-owned veneer request fails
closed. Deferring linker-owned veneers is legal for an initial implementation as
long as delegated branch relocations are rejected with deterministic
diagnostics.

## Base Relocations

The final UEFI image may not load at the preferred image base. Any patch that
contains an image-base-dependent absolute address needs a base relocation record.

The linker creates a structured base relocation table:

```text
ImageBaseRelocation
  stableKey
  kind: dir64 | highlow | target-specific
  sectionKey
  rva
  widthBytes
  sourceRelocationKey
```

For the first target, `addr64` normally creates a PE `DIR64` base relocation.
`addr32nb`, branch, page-relative, and relative relocations do not.

The linker output contains structured records, not serialized `.reloc` bytes
and not a linked `.reloc` section. The PE/COFF writer owns grouping by 4 KiB
page, entry encoding, block padding, raw byte count, file offset, and section
table representation. The linker verifies only that each structured base
relocation points at an address-bearing patch that requires image-base
adjustment.

## Unwind And Data Directory Handoff

Backend `unwindRecords` are not enough by themselves for a final PE/COFF image;
the writer needs RVAs for procedure ranges and unwind information. The linker
owns those RVAs because it owns final section layout.

The AArch64 linker target should provide one unwind materialization path:
produce relocation-bearing internal object sections such as `.pdata` and
`.xdata` before normal link layout. Those sections are synthetic object modules
or synthetic sections emitted by a target provider and then handled by ordinary
section layout, symbol resolution, and relocation application.

For the first PE/COFF UEFI target, `.pdata` procedure entries should be modeled
as RVA-bearing data: function start RVA, function end RVA, and unwind-info RVA.
Those fields are patched through the same `addr32nb`/section-relative
relocation machinery. The writer serializes the final `.pdata`/`.xdata` bytes
and data directory from linked sections; it does not infer function ranges from
symbols.

The linker verifies:

- every serialized unwind procedure record names a resolved executable function
  range
- start and end RVAs are ordered and lie in executable sections
- unwind-info RVAs point into the linked unwind data section selected by target
  policy
- `.pdata`/`.xdata` section bytes and data-directory source records come from
  normal linked sections
- functions that require unwind metadata have exactly one linked unwind record

## Linked Image Layout

The output model:

```text
AArch64LinkedImageLayout
  targetKey
  linkerSurfaceFingerprint
  backendSurfaceFingerprint
  inputModules
  preferredImageBase
  sectionAlignmentBytes
  sections
  symbols
  appliedRelocations
  baseRelocations
  entry
  unwindRecords
  provenance
  verification
  deterministicMetadata
```

`inputModules` is an ordered array of `{ moduleKey, moduleFingerprint,
syntheticProviderKey? }` records sorted by `moduleKey`. Fingerprints may repeat
when two synthetic modules are byte-identical; module keys may not.

Sections contain final bytes after relocation application. Symbols contain final
RVAs. Relocation records are an audit trail of what was applied or converted to
base relocation records; they are not work still left for the writer.

The layout may carry writer-facing metadata:

- PE machine type expectation: AArch64
- subsystem expectation: EFI application
- image characteristics required by the target
- data-directory source records for exception/unwind and relocation tables
- section flags chosen by the linker target policy

The writer consumes those records but does not reinterpret object modules.

## Provenance

The linker must preserve enough provenance for binary diagnostics:

```text
LinkedByteProvenance
  stableKey
  sectionKey
  rva
  byteLength
  sourceModuleKey?
  sourceObjectSectionKey?
  sourceObjectProvenanceKey?
  sourceRelocationKey?
  sourceSyntheticObjectKey?
  factFamilies
  machineSubjectKey?
```

Object byte provenance should be shifted by the contribution's output offset.
Padding, linker-owned veneers, relocation table bytes, and synthetic object
bytes must get their own provenance records. Relocation application should
record both the original bytes and patched bytes in debug metadata when
diagnostic mode asks for it, but production metadata should avoid unnecessary
byte duplication.

Fact-spending records from object modules are aggregated by stable key. Duplicate
records with identical payload are allowed and coalesced with source module
lists; conflicting payloads under the same key are rejected.

## Diagnostics

Use linker-owned diagnostic codes instead of reusing backend diagnostic codes:

```text
LINKER_INPUT_INVALID
LINKER_SYMBOL_RESOLUTION_FAILED
LINKER_SECTION_LAYOUT_FAILED
LINKER_RELOCATION_FAILED
LINKER_ENTRY_RESOLUTION_FAILED
LINKER_IMAGE_LAYOUT_INVALID
```

Every diagnostic should include:

- `ownerKey`
- `stableDetail`
- `rootCauseKey`
- optional provenance strings sorted by code-unit order

Examples:

```text
linker-input:target-fingerprint-mismatch:module:0002
symbol-resolution:duplicate-global:Boot.main:module:0000:module:0004
symbol-resolution:unresolved:external.helper:referenced-by:module:0001:reloc:call
section-layout:alignment-overflow:.text:module:0000:.text
relocation:branch26-out-of-range:module:0000:reloc:far:distance:...
relocation:pair-target-mismatch:module:0000:pair:page:...
entry:missing-loader-symbol:__wrela_uefi_entry
entry:non-executable-section:__wrela_uefi_entry:.rdata
```

Diagnostics are sorted deterministically before returning.

## Verification

The runtime verifier should be fast and structural:

- every input `{ moduleKey, moduleFingerprint }` record appears exactly once in
  the layout input list
- every object section maps to exactly one contribution unless its explicit
  object section class is non-layout metadata
- every contribution range is within its linked section
- section RVAs satisfy target virtual alignments
- output section ranges do not overlap in RVA space
- symbol RVAs match their contribution plus object offset
- every relocation target resolved according to symbol rules
- every applied relocation changed only the permitted bytes and bit range
- every applied relocation's encoded value is re-derived from
  `(S, P, A, family, opcode owner)` and matches the final patched bytes
- branch, page, low-12, absolute, and relative relocation ranges are valid
- base relocation records point to address-bearing patches only
- unwind procedure records point to resolved executable ranges and linked unwind
  data
- entry RVA points to the resolved loader entry symbol
- byte provenance covers every non-empty output section without gaps or overlap
- deterministic metadata fingerprints match the layout records

Tests should also include a slow independent validator that recomputes section
placement, symbol addresses, relocation values, and base relocation records from
the linked image layout. The slow validator should live in tests/support or a
debug-only test helper, not production source.

## Determinism

All ordering uses code-unit string comparison or numeric comparisons. No
`localeCompare`, host filesystem order, map insertion order from unsorted user
input, timestamps, random numbers, process IDs, or environment values may affect
the layout.

Deterministic metadata should include:

```text
schema: "aarch64-linked-image-layout"
schemaVersion: "1"
inputFingerprint
sectionFingerprint
symbolFingerprint
relocationFingerprint
baseRelocationFingerprint
entryFingerprint
provenanceFingerprint
layoutFingerprint
```

The layout fingerprint must include final bytes, section addresses, symbol RVAs,
applied relocation payloads, base relocation records, entry metadata, and
target/layout-policy fingerprints.

## Error Handling

The linker returns `{ kind: "error" }` and no partial layout when any required
stage fails. It may include stage verification summaries and debug artifacts,
but the successful `AArch64LinkedImageLayout` only exists on `kind: "ok"`.

Stage order:

```text
authenticate-link-target
materialize-synthetic-objects
verify-input-objects
normalize-link-graph
resolve-symbols
layout-sections
plan-relocations
apply-relocations
resolve-entry
verify-linked-image
```

Failures should stop at the earliest stage whose output would be unreliable.
For example, relocation application should not run if symbol resolution failed.

## Testing Strategy

Unit tests:

- object normalization rejects target fingerprint mismatches
- external declarations do not produce output contributions
- duplicate globals are rejected with deterministic diagnostics
- same local symbol names in different modules resolve within their modules
- unresolved external references fail for the UEFI target
- section layout orders and aligns contributions deterministically
- padding provenance covers inserted bytes
- entry symbol resolution accepts executable loader entry symbols
- entry symbol resolution rejects missing or non-executable entries
- branch relocations patch final immediates and check signed scaled limits
- ADRP plus ADD/LDR pairs patch page and low-12 fields consistently
- `addr64` creates a base relocation record
- `addr32nb` patches an RVA and creates no base relocation
- relocation bit-range ownership prevents writes outside the patch field
- linker-owned veneer insertion retargets an out-of-range branch
- secret or undeclared-scratch linker-owned veneer requests fail closed
- linked-image verifier catches symbol, relocation, section, and provenance
  corruption

Integration tests:

- compile a small AArch64 object with `compileAArch64Object`, link it, and check
  `.text`, entry symbol, applied branch relocation, and deterministic layout
- link a backend object plus a synthetic UEFI entry object and confirm the
  loader entry RVA points to the synthetic shim while the shim calls the Wrela
  boot symbol
- link two object modules where one references a symbol defined by the other
- link an object containing an `addr64` data reference and verify the base
  relocation record
- run the same link input in shuffled module/section/symbol order and assert the
  same canonical image bytes, layout fingerprint, and full labeled layout

Property tests may use `fast-check` under tests only:

- random contribution order produces identical linked section layout
- valid symbol tables resolve deterministically under input shuffling
- generated relocation patches are confined to declared patch ranges
- byte provenance remains a partition of output section bytes

Required handoff gate remains:

```bash
bun run agent:check
```

Use narrower commands while iterating, for example:

```bash
bun test ./tests/unit/linker/symbol-resolution.test.ts
bun test ./tests/unit/linker/relocation-application.test.ts
bun test ./tests/integration/linker/aarch64-linked-image-layout.test.ts
```

## Build Waves

### Wave 1: Linker Core Records

- Add linker diagnostics and result helpers.
- Extend `AArch64ObjectSymbol` and `AArch64ObjectRelocation` with the
  linker-required contract fields: linkage names, structured relocation targets,
  explicit addends, pair keys, non-optional bit ranges, and linker-veneer
  requests.
- Define `LinkedImageLayout`, `SectionContribution`, `ResolvedImageSymbol`,
  `AppliedRelocation`, `ImageBaseRelocation`, provenance, and deterministic
  metadata records.
- Define `AArch64ImageEntryRequest`, `AArch64SyntheticObjectProvider`, and
  `AArch64LinkerVeneerProvider` interfaces.
- Add test fixtures for small AArch64 object modules.

### Wave 2: Input Normalization

- Materialize synthetic objects before normalization.
- Normalize `AArch64ObjectModule` records into module-scoped link graph records.
- Validate discriminated local/global/external symbol records.
- Authenticate target/backend fingerprints.
- Validate explicit link relocation addends, pair keys, structured targets,
  veneer requests, and binding/linkage-name invariants.

### Wave 3: Symbol Resolution

- Build local and global namespaces.
- Resolve relocation target names with same-module precedence.
- Reject duplicate globals, ambiguous symbols, and unresolved external
  declarations.
- Produce pre-layout symbol records with module scope.

### Wave 4: Section Layout

- Add the AArch64 UEFI section policy.
- Place contributions into output sections with deterministic alignment.
- Compute section RVAs from target virtual-layout constraints.
- Shift object provenance into linked-image provenance.

### Wave 5: Relocation Application

- Implement AArch64 branch, page, low-12, absolute, RVA, relative, and
  section-relative relocation application.
- Validate paired relocations.
- Create structured base relocation records.
- Add linker-owned veneer insertion for allowed branch relocations through the
  target-provided veneer provider, or fail delegated veneer requests closed when
  no provider is present.

### Wave 6: Entry And Unwind

- Resolve loader entry and Wrela boot symbols.
- Record `AddressOfEntryPoint` source metadata for the PE writer.
- Materialize or verify linked `.pdata`/`.xdata` unwind records and their RVA
  fixups.

### Wave 7: Verification And Integration

- Implement `verifyLinkedImageLayout`.
- Add slow test-only validation.
- Wire backend object output to linker input in an integration test.
- Export the AArch64 link API from the target/compiler public API.

## Closed Decisions

| Question                                        | Decision                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------- |
| Is this phase still designing the object model? | No. It consumes `AArch64ObjectModule` and designs the linked image layout.       |
| Does the PE writer resolve symbols?             | No. The linker resolves symbols and records final RVAs.                          |
| Does the PE writer apply relocations?           | No. The linker applies final relocations and creates base relocation records.    |
| Are external declarations output sections?      | No. They are symbol records, not sections.                                       |
| Are unresolved externals allowed for v1 UEFI?   | No. They are linker errors.                                                      |
| How are cross-module symbols named?             | Global and external object symbols use explicit `linkageName` fields.            |
| Does the linker reconstruct addends or pairs?   | No. Public object relocations must carry explicit addends and pair keys.         |
| Where is the UEFI loader entry shim created?    | As a target-provided synthetic object before link layout.                        |
| Can the linker generate raw A64 code directly?  | No. Synthetic code must come through authenticated object providers.             |
| Are linker-owned veneers allowed?               | Only with backend metadata, target policy, and an authenticated veneer provider. |
| Does this phase serialize PE/COFF bytes?        | No. It outputs a structured linked image layout.                                 |
| Should phase 13 and phase 14 share one design?  | No. Keep separate design docs with `AArch64LinkedImageLayout` as the handoff.    |
| Does this phase perform LTO or section GC?      | Not in the first implementation.                                                 |

## Output Contract

On success, the linker returns an `AArch64LinkedImageLayout` where:

- every output section has final bytes, RVA, virtual alignment, flags, and
  contribution records
- every defined symbol has one final RVA
- every relocation has been applied or converted into a base relocation record
- no unresolved external declarations remain
- the entry point resolves to an executable loader-entry symbol
- base relocation records are sorted as structured records for PE writer
  serialization
- unwind and data-directory source records are carried forward for the writer
- byte provenance covers output section bytes
- deterministic metadata fingerprints cover the entire linked layout
- verification summaries prove section layout, symbol resolution, relocation
  application, entry resolution, and provenance partitioning

The PE/COFF writer should be able to serialize this layout without looking back
at `AArch64ObjectModule`.
