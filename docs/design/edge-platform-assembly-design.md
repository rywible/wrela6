# Edge Platform Assembly Design

## Purpose

This design replaces freestanding source-visible `platform fn` declarations with
edge-owned platform methods and gives those methods an optional inline
target-assembly implementation form. The goal is to keep Wrela's existing
provenance and proof model as the safety boundary while making low-level target
code honest and local to the edge capability that authorizes it.

This is a hard cut from the legacy binding model. Once this feature lands,
ordinary source may no longer declare freestanding `platform fn` items and the
compiler no longer binds platform authority by simple global name. Stdlib,
fixtures, and target-facing examples must move in the same cutover rather than
depending on a long-lived legacy bridge.

Today, source reaches compiler platform primitives through freestanding
`platform fn` declarations whose simple names bind to a selected target catalog.
That shape is useful for bootstrapping, but it leaks target authority into
ordinary module scope. Stdlib code and fixtures then need extra wrappers to
recover the real meaning: a console output primitive is not merely a global
function named `output_string`; it is an operation permitted because the program
holds a console, firmware, device, MMIO, or stream capability.

The proposed model makes that relationship direct:

```wr
edge class UartMmio:
    region: MmioRegion[UartMmio]

    platform fn write_byte(byte: u8) -> UartMmio
        requires:
            writable_mmio_region(self.region)
        effects:
            mmio_write(self.region)
        asm aarch64:
            clobbers: x0, x1, nzcv
            body:
                strb w1, [x0]
```

The receiver edge is the authority. The platform method may be public because
visibility is not the safety boundary; possession of `self` and discharge of the
method contract are the safety boundary.

## Goals

- Move platform primitives from freestanding declarations to edge-class methods.
- Require every callable platform operation to be authorized by a receiver edge.
- Remove freestanding source-visible platform binding in the same cutover; do
  not preserve a dual-authority mode where both models remain live.
- Allow platform methods to carry inline target assembly in the same declaration
  as their proof/effect contract.
- Keep platform methods as certified platform graph leaves in HIR, Proof MIR,
  proof-check, OptIR, and backend lowering.
- Give optimizers a precise effect summary so assembly-backed calls are not
  removed, duplicated, reordered, or hoisted incorrectly.
- Preserve the current dependency chain: source origin, semantic binding,
  platform contract edge, layout ABI fact, proof-check certificate, OptIR call,
  machine lowering, object byte provenance, linker provenance, and final image
  evidence.
- Keep user-defined platform methods package-scoped and provenance-guarded.
  They do not gain authority from a target-global name.

## Non-Goals

- This design does not add arbitrary inline assembly to ordinary functions.
- This design does not let assembly mint edge capabilities without a target entry
  seed or an explicit platform method contract that produces them.
- This design does not require a wrapper method above every platform method.
  Platform methods are allowed to be the public method on an edge class.
- This design does not use assembly text as optimization authority. The proof
  and optimization contract is the Wrela signature, `requires`, and `effects`
  surface.
- This design does not require the first implementation to accept an external
  assembler or raw `.S` files. A restricted AArch64 assembly form can lower
  through the existing backend object model first.
- This design does not replace target-owned runtime and firmware lowering
  templates with source `asm`. Target primitives that already belong to the
  selected target remain target-owned.

## Feature Boundary

The receiver-edge authority refactor is the required cutover. It changes where
platform authority binds, rejects freestanding platform declarations in ordinary
source, and reuses the existing platform contract edge, proof-check transfer,
effect, layout, OptIR, backend, and provenance chain.

Inline target assembly is a follow-on implementation form for already-certified
edge platform methods. It depends on the receiver-edge model, but the receiver
edge cutover must be useful without it: target-owned firmware and runtime
primitives can continue to lower through target templates while user or package
MMIO-style methods wait for the assembly verifier.

## Current-State Conflict

The current name-resolution design binds only freestanding `platform fn`
declarations to target primitive names. It explicitly treats method-shaped
platform functions as invalid v1 source. This design intentionally changes that
rule.

Old v1 rule:

```wr
platform fn output_string(message: Utf16Static) -> UefiStatus

edge class Console:
    fn write(message: Utf16Static) -> UefiStatus:
        output_string(message=message)
```

New rule:

```wr
edge class Console:
    platform fn write(message: Utf16Static) -> Console
        requires:
            boot_services_available(self)
        effects:
            firmware_call(uefi.console.output_string)
```

Freestanding `platform fn` declarations become invalid for ordinary source in
the same cutover that introduces edge-owned platform methods. Target entry
seeding remains a separate target-driver operation: image entry may receive a
`UefiFirmware`, test fixtures may receive a compiler-owned validation stream,
and other root capabilities may be minted only by target-owned entry rules. Once
a root edge exists, platform operations hang off edge methods.

`Utf16Static` in the console examples means the source-visible form of the
target's static UTF-16 token. The current UEFI pipeline already has static
CHAR16 metadata and `uefi.Utf16Static` target typing; if that surface is not yet
available as an ordinary source type in the package being migrated, exposing or
renaming that token is a prerequisite for the console examples.

## Language Model

### Edge-Owned Platform Methods

A `platform fn` declaration is valid only as a member of an `edge class`.
The receiver is implicit `self`, and `self` is always part of the platform
contract. The method may observe, consume, borrow, or return `self` according to
ordinary receiver and return resource rules.

Examples:

```wr
edge class Console:
    platform fn write(message: Utf16Static) -> Console
        requires:
            boot_services_available(self)
        effects:
            firmware_call(uefi.console.output_string)

edge class UartMmio:
    region: MmioRegion[UartMmio]

    platform fn write_byte(byte: u8) -> UartMmio
        requires:
            writable_mmio_region(self.region)
        effects:
            mmio_write(self.region)
            memory_barrier(device_order)
        asm aarch64:
            clobbers: x0, x1, nzcv
            body:
                dmb oshst
                strb w1, [x0]
```

Platform methods can be public. If a module exports `UartMmio.write_byte`, a
caller still cannot use it without a valid `UartMmio` edge value.

`MmioRegion[Owner]` is a target-certified region descriptor carried by an edge.
It represents the address range, access-width policy, ordering class, and
device identity for one MMIO aperture. Source code may pass the descriptor to
certified proof and effect terms, but it cannot manufacture a valid descriptor
from an integer address. Target entry seeding, firmware discovery, or a
certified platform method must produce the descriptor and its provenance.

The `Owner` parameter is nominal. A `MmioRegion[UartMmio]` is not just a pointer
whose type happens to mention `UartMmio`; it is a region token whose provenance
was certified for that edge owner. Source address arithmetic cannot cast one
owner's region into another owner's region.

### Root Edge Minting

Root edge minting is not a platform method. It belongs to target entry
construction, image/device declarations, compiler-owned validation fixtures, or
other target-driver seed rules. These seed rules must be explicit in target
surface data and must produce provenance records.

This distinction keeps authority flow simple:

```text
target entry seed -> edge value -> edge platform method -> produced edge value
```

No source declaration can mint a root edge merely by naming a primitive.

### Worked MMIO Producer

MMIO regions need an explicit producer before an edge method can require them.
One valid shape is a target-owned bus or firmware edge that discovers and claims
a device aperture, then returns a narrower edge carrying the certified region:

```wr
edge class PlatformBus:
    platform fn claim_uart(name: DeviceName) -> UartMmio
        requires:
            boot_services_available(self)
        effects:
            firmware_call(uefi.locate_device)
            platform_call(device_claim)

edge class UartMmio:
    region: MmioRegion[UartMmio]

    platform fn write_byte(byte: u8) -> UartMmio
        requires:
            writable_mmio_region(self.region)
        effects:
            mmio_write(self.region)
        asm aarch64:
            clobbers: x0, x1, nzcv
            body:
                strb w1, [x0]
```

The target certification for `PlatformBus.claim_uart` is responsible for
producing the `MmioRegion[UartMmio]` token, its stable region identity, its
address aperture, access-width policy, ordering class, device identity, and the
predicate facts such as `writable_mmio_region(region)` that later methods may
require. The asm body for `write_byte` consumes those certified facts; it does
not discover or invent them.

### Package-Scoped Identity

The identity of a user-defined platform method is not a simple target-global
string. It is derived from:

```text
package authority
+ edge class identity
+ method identity
+ selected target
```

Target-owned platform methods may additionally map to canonical target primitive
IDs such as `uefi.console.outputString`. Project-defined methods receive
package-scoped primitive IDs. Name collisions are therefore ordinary source API
collisions, not authority collisions.

## Platform Contracts

Every platform method has a contract composed from:

- receiver edge type and receiver mode
- parameter and return types
- `requires` facts and capability requirements
- `effects` entries
- ABI convention
- optional assembly constraints
- target feature requirements

The contract is certified before the method can reach HIR as a platform call.
Certification checks that the method belongs to an edge class, the receiver
resource kind matches the edge, all `requires` expressions lower to known proof
requirements, all `effects` entries are compiler-known effect constructors, and
the selected target supports the requested implementation form.

Certified platform methods remain source declarations, but they do not receive
ordinary function bodies in Proof MIR. A reachable certified platform method is
a graph leaf with a platform contract edge.

`requires:` entries are checked proof terms, not arbitrary field reads. Names
such as `boot_services_available(self)` and
`writable_mmio_region(self.region)` stand for target- or package-certified
predicate facts. The examples use ordinary call syntax to show the required
fact term, but the compiler must resolve each predicate to a certified proof
surface entry before it can certify the platform method.

The predicate vocabulary is closed in the same sense as the effect vocabulary.
An ordinary source function cannot become a proof predicate by choosing a useful
name. Each `requires:` predicate resolves through a platform predicate catalog
selected by the target plus any audited package extension catalogs. Package
extensions must carry stable predicate IDs, a target/proof meaning, operand
typing rules, and a certification rule for which target or platform method may
produce the fact. Unknown predicates are diagnostics.

## Effect Vocabulary

`effects:` is a closed compiler-known vocabulary. Unknown effect constructors
are diagnostics, not comments. Each effect has target-independent proof meaning
and target-specific lowering policy.

The v1 vocabulary is deliberately small:

```wr
effects:
    mmio_read(region)
    mmio_write(region)
    memory_read(region)
    memory_write(region)
    memory_barrier(order)
    firmware_call(service)
    platform_call(kind)
    control_diverges
    may_trap
```

`requires:` says what must be true before the call. `effects:` says what the
call is allowed to do after those requirements are met.

For example:

```wr
edge class UartMmio:
    region: MmioRegion[UartMmio]

    platform fn write_byte(byte: u8) -> UartMmio
        requires:
            writable_mmio_region(self.region)
        effects:
            mmio_write(self.region)
```

This allows proof-check to require the writable-region fact, OptIR to model a
device write to that specific region, and the backend to preserve target
ordering constraints for that effect. It is a scoped replacement for treating
all assembly as globally volatile.

### Region Identity And Aliasing

Region effects are keyed by certified region identity, not by source-level
address arithmetic. A region descriptor contains:

- stable target-certified region ID
- owner edge type
- aperture range when the target can disclose it
- access-width policy
- ordering class
- device identity
- provenance of the target seed or platform method that produced it

Two region effects conflict when their region IDs match, when the target alias
table says the regions overlap, when disclosed aperture ranges overlap, or when
the compiler lacks a certificate proving disjointness. Unknown aliasing is a
conflict by default. Optimizers may reorder, merge, or hoist platform effects
only when disjointness is certified and the relevant ordering class and
`memory_barrier(order)` policy allow it.

This rule is deliberately conservative. It preserves the existing memory-order
and region fact model: address equality is not enough to prove safety, and
address inequality is not enough to prove independence.

Friendly domain effects can be layered later as checked aliases:

```wr
effects:
    console_output
```

is not part of v1. In v1, console output is expressed as a
target-certified firmware call or platform call effect with explicit service
identity.

## Assembly Form

Assembly is attached to a platform method after the Wrela contract:

```wr
edge class UartMmio:
    region: MmioRegion[UartMmio]

    platform fn write_byte(byte: u8) -> UartMmio
        requires:
            writable_mmio_region(self.region)
        effects:
            mmio_write(self.region)
        asm aarch64:
            abi: wrela-platform
            clobbers: x0, x1, nzcv
            preserves: sp, x19..x28
            body:
                strb w1, [x0]
```

The `asm` block is target-specific implementation data. It is not an ordinary
Wrela statement body and is not visible to target-independent optimization
passes. HIR, Proof MIR, proof-check, and OptIR consume the certified platform
contract. Backend and object emission consume the target assembly block.

The first implementation uses a restricted AArch64 assembly form or a
thin machine-instruction DSL that can emit the existing `AArch64ObjectModule`
contract directly. It does not invoke a host assembler during production
compilation. Raw text assembly can be supported later only if the compiler can
recover and verify the same instruction, relocation, clobber, and byte
provenance records.

### Assembly Constraints

An `asm` block must declare:

- target architecture
- ABI convention
- clobbered registers and flags
- preserved special registers when relevant
- target feature requirements for instructions outside the base profile
- all referenced symbols or relocation sites
- all memory regions it touches through `effects`

The backend verifies mechanical constraints where it has authority:
instruction encodability, target feature availability, relocation shape, symbol
resolution, section policy, byte provenance coverage, and declared clobber
compatibility with the ABI.

The proof checker verifies the semantic envelope:
required capabilities, consumed and produced edge values, effect permission,
and closure of obligations at function boundaries.

## Compiler Pipeline Impact

### Frontend And Name Resolution

The parser already recognizes edge classes and platform functions. The semantic
item index must allow platform methods under edge classes. Name resolution must
stop binding freestanding platform functions by simple global name and instead
bind platform methods by receiver edge identity plus method identity.

Freestanding platform functions are hard diagnostics in ordinary source. The
diagnostic may point users to edge-class platform methods as the replacement
shape, but it must not bind the freestanding item or allow it to reach HIR as a
certified platform call.

### Semantic Surface

Semantic surface checking certifies platform methods. It verifies:

- the owning declaration is an edge class
- the receiver edge is the authority carrier
- the method signature matches the selected target or package-scoped platform
  contract
- `requires` entries lower to proof requirements
- `effects` entries are compiler-known and well-typed
- assembly blocks are permitted only for selected targets that support them

The certification result includes the method's package-scoped platform
identity and, for target-owned methods, the canonical target primitive ID.

### HIR And Monomorphization

HIR records platform contract edges for calls to certified platform methods.
The call edge must include receiver place metadata so later phases know which
edge authorized the platform operation.

Monomorphization treats certified platform methods as reachable graph leaves.
They do not add ordinary source body edges. Generic edge classes may instantiate
platform methods only when the selected target can certify the concrete method
contract.

### Layout

Layout continues to compute ABI facts for platform edges. Receiver and parameter
layout must be authenticated before assembly can rely on a physical convention.
Assembly blocks may not infer field offsets by source text. If an assembly body
needs an offset, the target assembly form must reference a layout-authenticated
constant or receive the value through ABI-bound operands.

### Proof MIR And Proof Check

Proof MIR lowers platform method calls as certified platform calls. The call
edge includes:

- receiver edge place
- consumed, observed, and produced capabilities
- call-site requirements from `requires`
- effect entries from `effects`
- source origin and package-scoped platform identity

Proof-check platform transfer applies the existing pattern: verify contract
lookup, check preconditions by entailment, validate observed operands, consume
owned operands when required, produce returned capabilities, and emit checked
fact packets for capability flow and platform-call precondition discharge.

### OptIR And Optimization

OptIR represents platform methods as opaque effectful calls. Optimizers may use
the effect set to preserve ordering and avoid illegal rewrites:

- calls with `mmio_write(region)` cannot be removed as dead even if the return
  edge is unused
- calls touching the same region cannot be reordered unless the effect policy
  proves it legal
- calls with `memory_barrier(order)` form scheduling barriers for affected
  memory classes
- calls with `control_diverges` terminate control flow
- calls with no write/divergence/trap effects may still be pure only when the
  contract explicitly says so

Target-independent passes do not inspect assembly. They trust only the
certified contract.

### AArch64 Backend

The backend lowers platform methods through two non-overlapping implementation
families:

1. Target-owned lowering template, for existing firmware/runtime primitives.
2. Verified assembly block, for package or user edge methods whose implementation
   is not supplied by the selected target catalog.

Both paths emit normal internal object modules or normal machine-program calls
that later become object modules. Assembly-backed output must satisfy the same
backend object contract as compiler-generated code: deterministic sections,
symbols, relocations, verification records, and byte provenance coverage.

The target-owned path remains canonical for primitives the target already
templates, such as firmware calls and runtime helper instructions. Source
`asm aarch64` is not a second spelling for those primitives. If a target later
reimplements one of its own helpers using a lower-level instruction form, that
change happens inside the target package and replaces the template as the
canonical implementation rather than creating two callable source surfaces.

### Linker And PE/COFF

The linker sees assembly-backed platform implementations as ordinary verified
object modules. It must not special-case them as opaque blobs. They participate
in symbol resolution, relocation application, section placement, unwind policy,
base relocation planning, and byte provenance partitioning.

Final image reference checks distinguish compiler-generated
objects, target runtime helpers, and user/package platform-assembly objects by
stable provenance keys.

## Diagnostics

Required diagnostics include:

- freestanding `platform fn` is no longer valid
- `platform fn` declared on a non-edge class
- unknown `requires` predicate or package predicate without target/auditor
  certification
- unknown effect constructor
- effect argument does not resolve to an allowed capability, region, service, or
  order value
- region effect cannot prove disjointness from a conflicting region effect
- platform method contract cannot be certified for selected target
- assembly block target does not match selected target
- undeclared clobber, unsupported instruction, unsupported relocation, or
  missing byte provenance in assembly-backed object output
- platform method attempts to produce a root edge without a target seed rule

Diagnostics include source spans for the declaration, effect entry, and
assembly entry that caused the failure.

## Validation Strategy

Unit coverage:

- name resolution accepts edge-class platform methods and rejects freestanding
  platform functions
- semantic certification rejects unknown predicates, unknown effects, and
  non-edge owners
- proof-check rejects calls without the receiver edge or required facts
- OptIR marks platform methods with the certified effect set
- AArch64 object verifier rejects malformed assembly-backed object modules

Integration coverage:

- a `Console.write` platform method replaces fixture-local `output_string`
  wrappers in direct-platform fixtures
- a small `UartMmio.write_byte` fixture compiles to an assembly-backed object
  with byte provenance and MMIO write effect evidence
- an optimizer test proves `mmio_write(region)` calls are not removed or
  reordered across conflicting region effects
- a negative fixture proves a source package cannot mint a root edge through a
  platform method
- full-image validation reports platform assembly object provenance in the final
  artifact evidence

System coverage:

- QEMU smoke remains optional, but when configured it runs at least one
  platform-method-backed console or MMIO-style fixture through the normal target
  driver.

## Cutover Plan

1. Add edge-class platform method syntax support and reject freestanding
   `platform fn` declarations in ordinary source in the same semantic change.
2. Teach semantic surface checking to certify receiver-edge platform methods and
   emit platform contract edges with receiver provenance.
3. Move UEFI stdlib, direct-platform fixtures, and toolchain examples from
   freestanding primitive handles to edge-owned platform methods as part of the
   same cutover.
4. Add the closed predicate and effect catalogs needed to certify platform
   method contracts.
5. Keep target-owned firmware/runtime primitives on target lowering templates.
6. Add AArch64 assembly blocks for non-template package or user edge methods
   only after receiver-edge platform calls are green through HIR, Proof MIR,
   proof-check, OptIR, and backend call lowering.

This order preserves the existing compiler pipeline while moving authority to
the place the proof model already expects it: provenance-bearing edge values.
