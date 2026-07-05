# Edge Platform Capabilities Design

This supersedes the earlier `platform fn` framing of this design. That framing
introduced a dedicated `platform fn` declaration form carrying parallel
`requires`, `effects`, and `transitions` contracts plus an inline `asm` block
validated against them. Working the model to its conclusion collapsed almost all
of that apparatus into two kinds of unforgeable value and ordinary Wrela code.
What remains is smaller and, we think, more honest. The Wrela-first goal, the
separation of service identity from implementation provenance, the core
invariants, and the unsafe-authoring boundary from the earlier draft all survive
and are folded into this model.

## The Core Principle

There is no "platform operation" as a language construct. There are only ordinary
operations — read a field, call a value — on **capabilities you could not
possibly hold unless the authority was granted**. The capability is an
unforgeable sealed value; the syntax that uses it is just syntax.

Platform authority in Wrela comes from possessing a sealed value and satisfying
the preconditions on using it, never from naming a global primitive and never
from a keyword attached to a declaration site. This design defines the two
sealed-capability value kinds that carry all platform authority, the rules that
mint them, and how ordinary Wrela code operates on them safely.

## Why This Replaces `platform fn`

The old model marked device operations syntactically: a `platform fn` was a
certified graph leaf, and its `effects`/`transitions` blocks re-declared what the
body did so the optimizer could trust it. But the thing that actually made a
device write safe was never the keyword. It was that the write's operand — the
region descriptor — is unforgeable and could only have come from an edge minted
through the certified authority chain.

Once that is the safety boundary, the wrapper is redundant:

| `platform fn` was…                                   | …becomes                                                                                                                     |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| an MMIO / DMA method                                 | an ordinary typed access on a **sealed region value**                                                                        |
| a firmware call                                      | an ordinary call of a **sealed callable value**                                                                              |
| a region-minting method                              | a sealed callable whose return type is a freshly branded sealed value                                                        |
| an `effects:` block                                  | effects **derived** from the operation, or carried on the callable's type                                                    |
| a `transitions:` block                               | fact invalidation **derived** as the consequence of a write effect                                                           |
| an `asm` block plus operand/clobber/effect validator | deleted; device work is sealed-value operations, and standalone barriers and cache maintenance are compiler-owned intrinsics |

This is a **surface deletion, not an internal deletion.** The middle-end's
platform-contract-edge, effect summaries, sealed brands, and precondition
discharge all persist. They are keyed to _operations on sealed values_ instead of
to declared `platform fn` items. `edge class` stays (the affine home for
capabilities), `requires` stays (preconditions on using a capability you already
hold), and sealing stays (the whole game).

## Goals

- Model all platform authority as two kinds of unforgeable sealed value: sealed
  regions and sealed callables.
- Let ordinary Wrela code perform device work by reading and writing sealed
  region fields and calling sealed callables, with no dedicated statement syntax.
- Carry memory-ordering discipline in region _types_, so ordinary field access
  emits the correct barrier and cannot forget it.
- Obtain effect summaries from typed operations or trusted callable catalogs, so no
  source-level effect vocabulary is authored and cross-checked.
- Mint sealed values only through target entry seeds and the certified claim
  chain; forbid source construction.
- Keep `edge class` as the affine home where capabilities live and thread, and
  keep `requires` as the precondition surface.
- Maximize Wrela-first implementation: device, firmware, stdlib, and project logic
  is ordinary Wrela over sealed values. Source code does not write assembly; the
  only machine code outside normal Wrela lowering and compiler-owned intrinsics is
  the compiler-owned entry thunk.
- Separate a firmware call's target service identity from the package provenance
  of the code that invokes it, and record both in final image evidence.
- Preserve the existing dependency chain: source origin, semantic binding,
  platform contract edge, layout ABI fact, proof-check certificate, OptIR
  operation, machine lowering, object byte provenance, linker provenance, and
  final image evidence.

## Core Invariants

The design is sound only if these stay true across every phase:

- **Capability authority.** An operation on a sealed value is possible only for a
  holder of that value; the value can only be obtained through the mint chain.
- **No freestanding authority.** Ordinary source cannot bind platform authority by
  a global name and cannot construct a sealed value.
- **Separate service and implementation identity.** A sealed callable carries a
  target service identity; the code that invokes it carries package implementation
  provenance. Because a callable cannot be forged, a package can never impersonate
  the target's implementation of a service — it can only invoke the target-minted
  callable.
- **Honest provenance.** Final image evidence records which package emitted each
  implementation's bytes and which target service each firmware call invokes.
- **Wrela-first.** Device and firmware logic lives in Wrela over sealed values;
  compiler-owned intrinsic lowerings and the entry thunk are the only non-Wrela
  code, and there is no user assembly escape hatch.
- **Leaf validation.** Sealed-value operations are the certified leaves; the
  `fence` intrinsic and cache-op methods have fixed compiler-known effects. There
  is no raw-assembly leaf to validate.
- **Generation discipline.** Every effect that invalidates proof facts advances
  the relevant private-state generation or cites a certified stability policy; the
  advance is derived from the write effect, not declared per call site.
- **Optimizer trust boundary.** Target-independent optimization trusts derived
  sealed-value contracts and region/callable types, not source names, comments, or
  hand-written machine text.
- **Root minting boundary.** Root edges and sealed values are produced only by
  target seed rules or certified claims.

## Non-Goals

- This design does not add general first-class functions, closures, or `dyn`. The
  sealed callable is a narrow, catalog-minted value; it is not a step toward
  arbitrary function values.
- This design does not add `mut self`, `own self`, or a mutable-borrow calculus.
  Effectful-but-preserving operations are expressed as reads and writes of the
  capabilities an edge holds, under the ordinary affine receiver rules.
- This design does not promote `Result`, `Option`, or `Unit` into sealed or core
  compiler types. They protect no authority and remain source-constructible.
- This design does not provide a raw assembly escape hatch such as a `machine` or
  `asm` block. Every device operation is a sealed-value access or call or a
  compiler-owned barrier or cache intrinsic. If a future device needs an
  instruction none of those express, that is a separate design decision — a new
  sealed-value operation or intrinsic with a defined effect — not a hole for
  arbitrary instructions, and it is out of scope here.
- This design does not let project source impersonate the selected target's
  canonical implementation identity; service identity and implementation
  provenance are recorded separately.

## Sealed Capability Values

Whether a value must be sealed reduces to one question: if a program could
construct it out of thin air, would that let it do something it otherwise could
not? If forging the value forges no authority, the type is ordinary and source
construction is correct. If forging the value forges authority, the value must be
sealed — mintable only by a target seed or a certified producer.

```text
ordinary value            forging forges nothing        source-constructible
  Result, Option, Unit, Utf16Static, plain integers, flags, ring indices

sealed capability value   forging forges authority      target/claim-minted only
  sealed regions           (unforgeable typed memory)
  sealed callables         (unforgeable typed foreign code)
```

Wrela already relies on this property for edges: nothing can construct a
`unique edge class UefiFirmware`; a program receives one at image entry and no
other ever exists. This design applies that same unforgeability to the two value
kinds that carry the rest of platform authority.

### Sealed Regions

A sealed region is unforgeable typed memory. It is the authority to touch a
specific piece of the physical address space, and it carries everything the
compiler needs to lower an access:

- stable target-certified region ID
- owner edge type (nominal; a region certified for one owner cannot be cast to
  another owner)
- runtime base address
- aperture size when the target can disclose it
- typed field layout (authenticated offsets, never inferred from source text)
- per-field access ordering discipline (see _Memory Ordering In The Type_)
- per-field or per-region access preconditions (predicate facts required to read
  or write)
- device identity and provenance of the seed or claim that produced it

Region types are target-surface catalog data, not core compiler types. A generic
raw aperture is `MmioRegion[Owner]`. A structured device layout — a virtqueue
available ring, a device config block — is a richer catalog region type such as
`AvailRing[Owner]` whose fields and orderings are declared by the target.

You operate on a sealed region with **ordinary field access**:

```wr
self.avail.idx = self.avail.idx + 1     # a store; ordering comes from idx's type
let device_idx = self.used.idx          # a load;  ordering comes from idx's type
```

The compiler lowers each access to a load or store at
`region.base + authenticated_offset(field)` with the field's declared ordering.
Base, offset, and ordering are all properties of the typed value. There is
nothing to declare at the use site and nothing to forge: you cannot name
`self.avail` without holding the region, and you cannot hold the region without
the mint chain having produced it.

The syntax is ordinary field access, but the semantic operation is not a pure
struct-field read or write. Accessing a sealed region is an effectful platform
operation. The optimizer may preserve, remove, combine, or reorder it only under
the derived region-effect, ordering, and aliasing facts for that sealed value; it
may not treat the access as ordinary memory merely because the surface syntax is
ordinary.

### Sealed Callables

A sealed callable is the dual of a sealed region: unforgeable typed _code_. Where
a region is addressable memory you may touch, a callable is foreign code you may
invoke. It is a narrow, ABI-tagged function pointer minted from a target-provided
table, carrying:

- a typed signature and calling convention (for UEFI, EFI / AAPCS64)
- a target service identity, such as `uefi.console.output_string`
- a declared effect summary — because the compiler has no body to derive from, the
  callable's catalog type states its effects (firmware call, may-trap, divergence,
  which services it touches, and any state it invalidates)
- minting rights — a callable whose return type is a sealed value is authorized by
  the target to produce that value's brand

You invoke a sealed callable with **ordinary call syntax**:

```wr
edge class Console:
    write_line: FirmwareFn[(Utf16Static) -> UefiStatus]   # minted from ConOut

    fn write(self, message: Utf16Static) -> UefiStatus:
        self.write_line(message)
```

The authority to call firmware is possession of the `FirmwareFn`. You cannot
construct one; you can only be handed one, read out of a firmware-provided table
by the target when it minted the edge. A callable may be stored in an edge field,
borrowed, and consumed under the ordinary affine rules, but it cannot be forged
from an integer, a symbol name, or a cast.

Callable receiver syntax is owner-bound. When a sealed callable signature mentions
`self` or `consume self`, that receiver is the owning edge place that stores the
callable, not the callable value itself. Such a callable may only be invoked
through a place path rooted at its owner (`firmware.claim_virtio_net(...)`,
`bus.claim_uart(...)`); a consuming receiver consumes that owner place. Only
callables with no owner receiver may be detached into arbitrary locals and called
as standalone sealed values.

## Service Identity vs Implementation Provenance

A sealed callable's **service identity** (what target service it invokes) is
distinct from the **implementation provenance** of the code that invokes it (which
package authored the surrounding logic).

```text
implementation provenance: my_package.MyConsole.write   (project package source)
service identity:          uefi.console.output_string    (selected target service)
```

A package may write its own `MyConsole.write` that invokes the target's
`output_string` callable, adding retry, buffering, or formatting logic in ordinary
Wrela. Its implementation provenance is the package; the service it ultimately
invokes is the target's. This is safe _by construction_: the package cannot forge
the callable, so it can never supply its own implementation of the target service
itself — it can only invoke the target-minted callable. The impersonation the
earlier draft policed with a rule is now impossible by typing.

Final image evidence records both identities: which target service each firmware
call invokes, and which package emitted each surrounding implementation.

## Minting: Seeds And The Claim Chain

No source declaration mints a sealed value. There are exactly two producers.

**Target entry seeds** mint root edges and their sealed values. Image entry
receives a `UefiFirmware`; test fixtures receive a compiler-owned validation
stream; other roots are minted only by target-driver seed rules declared in target
surface data. Every seed produces a provenance record.

**The claim chain** mints narrower capabilities from a root. A claim is a sealed
callable whose return type is a freshly branded sealed value:

```wr
edge class PlatformBus:
    claim_uart: FirmwareFn[(consume self, DeviceName) -> UartMmio]
        requires: boot_services_available(self)

edge class UartMmio:
    region: MmioRegion[UartMmio]

    fn write_byte(self, byte: u8)
        requires: writable_mmio_region(self.region)
    :
        self.region.data = byte     # a device store; ordering from the region type
```

Calling `claim_uart` is a firmware call (LocateProtocol / PCI) that returns a
sealed `MmioRegion[UartMmio]` with its brand, region ID, runtime base, aperture,
access-width policy, ordering class, device identity, and the predicate facts
(`writable_mmio_region(region)`) later accesses require. The right to mint that
region is declared on the callable's catalog type; only the target may declare
such a callable.

```text
target entry seed -> root edge -> sealed callable (claim) -> narrower sealed value
```

## Memory Ordering In The Type

Memory-ordering discipline is a property of the region, not of the operation. A
region type declares, per field, one access-ordering kind:

- `plain` — an ordinary load/store, no barrier
- `releaseCommit` — writing this field publishes prior writes (store-release)
- `acquireCommit` — reading this field observes prior device writes (load-acquire)
- `deviceOrdered` — device (nGnRE) ordering for MMIO registers and doorbells

An ordinary access to a field emits that field's ordering. In a split virtqueue,
the available ring's `idx` is a `releaseCommit` field and the used ring's `idx` is
an `acquireCommit` field, so:

```wr
self.avail.idx = self.avail.idx + 1     # store-release, because idx is releaseCommit
let seen = self.used.idx                # load-acquire,  because idx is acquireCommit
```

publishes and harvests correctly with no use-site annotation and no way to forget
the fence. The ordering kinds correspond one-to-one with the existing OptIR
memory-order model (`relaxed`, `acquire`, `release`, `acquireRelease`,
`sequentiallyConsistent`, `deviceOrdered`, `compilerOnlyOrdered`); the source never
names them, but a target may reject an ordering kind that is meaningless for a
field or architecture.

**Optional explicit ordering.** For readers who want the fence visible, an access
may carry an explicit ordering ascription that the compiler _checks against_ the
field's declared kind. It is documentation, never a requirement, and a mismatch is
a diagnostic — like a type annotation you may write but never need.

### Barriers And Cache Maintenance

Two low-level effects are neither a value access nor a call. They are the small set
of compiler-owned intrinsics that round out the model — not an escape hatch, and
not user-authored:

- **Standalone barriers.** A full fence not attached to a single field access — for
  example the store-load barrier before reading a device's notification-suppression
  flags — is an **ambient intrinsic** `fence(order)`. A barrier forges no authority
  (it only orders your own accesses), so by the sealing test it needs no capability
  and is available wherever ordering is needed. The compiler lowers it to the target
  barrier instruction, like any codegen.
- **Cache maintenance.** For non-coherent DMA targets, `clean` / `invalidate`
  operate on an address range and are therefore **region methods**
  (`region.clean()`), gated by holding the region. On the coherent flagship target
  they are typically no-ops.

There is no raw-assembly escape hatch. Every device operation the flagship needs is
a sealed-region access, a sealed-callable call, `fence`, or a cache-op method. If a
future device needs an instruction none of these express, adding it is a separate
design decision — a new sealed-value operation or a new intrinsic with a defined
effect — not a hole through which arbitrary instructions enter the model.

## Effects Are Derived Or Cataloged, Not Authored

There is no source-level `effects:` or `transitions:` vocabulary and no mapping
table between two effect languages. Region accesses and compiler-owned intrinsics
derive their effects from the typed operation itself. Sealed callables, whose
foreign bodies the compiler cannot inspect, carry trusted catalog summaries. In
both cases, source callers do not author or restate effects at the use site.

The compiler lowers each operation into the existing internal machinery:

- a read of a sealed region field → a region read (`readRegionVersion`, plus a
  memory-order fact when the field is ordered)
- a write of a sealed region field → a region write (`writeRegionVersion`, plus a
  memory-order fact when the field is ordered)
- a call of a sealed callable → the callable type's declared call summary
  (`callSummaryEffects`, service identity, trap, divergence)
- a standalone `fence` or cache op → the corresponding memory-order effect

**Fact invalidation replaces `transitions`.** A write to a region invalidates the
facts keyed to that region, by construction — that _is_ what advancing a generation
meant. Where the old model made an author restate `transitions: advance self.region`
alongside `mmio_write(self.region)`, the write effect now drives the invalidation
through the region's policy. A firmware call that staleness-invalidates unrelated
state (the memory-map snapshot after an allocation) does so through the _service's_
declared invalidation in the callable catalog, not through a per-call-site
declaration. The existing `advancePrivateState` machinery is retained and driven by
these operation effects.

Effects may still be _rendered_ for a human or an auditor — the compiler can emit
the effect summary of any operation — but source effects are derived from typed
region/intrinsic operations or loaded from trusted callable catalogs, never
authored at call sites and cross-checked against the body.

## Affine Capability Flow

Sealed values are affine capabilities. They flow under the receiver and parameter
modes the language already has — `observe` (a preserving `self`), `consume` (a
moving `consume self`), and `terminal` — with no platform-specific receiver rules:

- a preserving method borrows the edge and returns only its payload; the caller
  does not rebind the edge
- a method returns a new edge only for a genuine capability transform: one
  authority enters, a different authority leaves, and the receiver is consumed

```wr
let uart = bus.claim_uart(name = DeviceName.uart0)   # bus authority -> device authority
let machine = firmware.exit(key = snapshot.key)      # boot services -> running machine
```

Sealed values also live in fields and array elements and move in and out of them
under the ordinary affine rules — this is how a driver lends buffers to a device
and reclaims them, with no special slot syntax.

**Post-consume scoping is free.** Because a consumed capability's place is gone, the
affine checker enforces the scariest platform invariants at compile time with no
dedicated machinery: after `firmware.exit(...)` consumes the boot-services edge,
every `firmware.*` operation simply fails to resolve — a firmware call after
`ExitBootServices` is a compile error. After a buffer is moved into a device's
possession, touching it is a compile error.

## `requires:` — Preconditions, Not Grants

`requires:` is the one authored contract element, and it never grants a capability —
it constrains how a capability you already hold may be used.

Some preconditions live in the **region or callable type** and are discharged
automatically at each operation: writing an `AvailRing` requires
`writable_ring(region)`; calling a boot-services `FirmwareFn` requires
`boot_services_available(self)`, which in practice is discharged by the mere affine
liveness of the owning firmware edge. Higher-level, program-specific invariants — a
validated length is within a buffer's capacity before the buffer crosses into a
parser — are authored as `requires` and `ensure` in ordinary code.

`requires:` entries are checked proof terms, not arbitrary field reads. Each
predicate resolves through a closed platform predicate catalog selected by the
target plus audited package extension catalogs; unknown predicates are diagnostics.
Package extensions carry stable predicate IDs, target/proof meaning, operand typing,
and a certification rule for which producer may establish the fact.

## `edge class` — The Affine Home

An `edge class` is where sealed capabilities live and thread. It holds sealed
regions and sealed callables as fields, gives them a single non-copyable owner, and
threads them affinely through the program. Its methods are ordinary methods that
read region fields, call callables, and discharge `requires`.

An edge and its methods may be public. Visibility is not the safety boundary:
possession of the edge (and thus of the sealed values it carries) plus discharge of
each operation's preconditions is the boundary. Exporting an edge method does not
let a caller use it without a valid edge value.

The identity of a user-defined edge and its operations is package-scoped — package
authority, edge class identity, member identity, and selected target — never a
target-global name. Name collisions are ordinary source API collisions, not
authority collisions.

## Worked Examples

### UEFI Console — a firmware call, no `platform fn`

```wr
edge class Console:
    write_line: FirmwareFn[(Utf16Static) -> UefiStatus]

    fn write(self, message: Utf16Static) -> UefiStatus:
        self.write_line(message)
```

`Utf16Static` is the source-visible form of the target's static UTF-16 token. The
UEFI pipeline already has static CHAR16 metadata and `uefi.Utf16Static` target
typing; exposing that token as an ordinary source type is a prerequisite for the
console examples. It carries no device authority, so it is ordinary and
source-constructible, not sealed.

### virtio RX driver — sealed regions, ordinary code, no `platform fn`, no assembly

```wr
edge class RxQueue:
    desc:  DescTable[RxQueue]      # region types; idx fields carry commit ordering
    avail: AvailRing[RxQueue]      #   avail.idx is releaseCommit
    used:  UsedRing[RxQueue]       #   used.idx  is acquireCommit
    kick:  Doorbell[RxQueue]       #   deviceOrdered MMIO
    inflight: [RxBuffer?; queue_size]   # an ordinary affine array that owns buffers
    free:  DescFreeList
    last_used: u16
    size:  u16

    fn refill(self, consume buffer: RxBuffer)
        requires: has_free_descriptor(self.free)
    :
        let d = self.free.pop()
        self.desc[d].addr  = buffer.dma_addr
        self.desc[d].len   = buffer.capacity
        self.desc[d].flags = DESC_WRITE
        self.inflight[d]   = buffer                         # affine move; consume discharged
        self.avail.ring[self.avail.idx % self.size] = d
        self.avail.idx     = self.avail.idx + 1             # store-release, from idx's type
        if not self.used.suppresses_notify():
            self.kick.ring()                                # device-ordered doorbell write

    fn harvest(self) -> stream RxBuffer
        requires: readable_ring(self.used)
    :
        let device_idx = self.used.idx                      # load-acquire, from idx's type
        while self.last_used != device_idx:
            let e = self.used.ring[self.last_used % self.size]
            let buffer = self.inflight[e.id]                # affine move-out
            self.free.push(e.id)
            self.last_used = self.last_used + 1
            ensure e.len <= buffer.capacity else:           # the untrusted-device boundary
                recycle buffer
                continue
            yield buffer.with_filled(e.len)
```

Nothing here is a `platform fn`, a graph leaf, or an `asm` block — `refill` and
`harvest` are ordinary `fn`s. The memory model lives in the region field types; the
device authority lives in the sealed region values; the untrusted-device length
check is an ordinary `ensure`. Higher-level operations such as "publish a whole
buffer to a queue" are _library_ functions over these primitives, not language
syntax; virtio and UEFI are libraries.

### UEFI bringup — `call` and affine `consume`, use-after-exit is a compile error

```wr
uefi image PacketApplianceImage:

    fn boot(consume firmware: UefiFirmware) -> UefiStatus:
        firmware.console.write(u"packet-appliance: boot\r\n")
        firmware.set_watchdog(timeout_s = 0)

        let nic  = attempt firmware.claim_virtio_net(id = DeviceId.virtio_net)
            else status: return firmware.console.fail(status)
        let pool = attempt firmware.allocate_dma(pages = QUEUE_POOL_PAGES)
            else status: return firmware.console.fail(status)

        # GetMemoryMap + ExitBootServices consumes `firmware` on success, produces
        # a bare-metal machine, and retains `firmware` on a stale-map retry.
        let machine = attempt hand_off(consume firmware, consume nic, consume pool)
            else status: return status

        # `firmware` is gone here; any `firmware.*` past this point does not resolve.
        run(consume machine)
```

Every metal operation in bringup is a call of a sealed callable
(`firmware.console.write`, `set_watchdog`, `claim_virtio_net`, `allocate_dma`, the
memory-map and exit calls) plus reads of firmware-provided sealed regions (the
system table). The two-call `GetMemoryMap` dance and the `ExitBootServices`
stale-key retry are ordinary control flow; `exit` consumes the firmware edge only on
success, using the existing `Attempt` retain-on-error shape.

## Authoring Model And Safety Boundary

Operating a sealed value at a hardware boundary — a device store or a firmware
call — is an unsafe-authoring capability in the same spirit as `unsafe` in Rust:
the author crosses a low-level boundary, but the compiler still enforces the
boundaries it can check.

The compiler guarantees:

- the code holds the sealed capability required by the operation
- sealed values and root edges are not forged by ordinary source
- ordering, effects, and fact invalidation are computed from typed operations or
  trusted catalogs and enforced, not asserted
- compiler-owned barriers and cache operations lower with fixed, audited effects
  rather than source-supplied machine text
- final image evidence records which package emitted the bytes and which target
  service each firmware call invokes

The compiler does not guarantee that a package-authored driver implements a useful
device protocol, chooses the best polling strategy, or produces the behavior the
author intended. A verified implementation can still be a bad UART driver. The
safety boundary is authority, provenance, effect honesty, ordering, ABI conformance,
and optimizer soundness; the package remains responsible for domain correctness
inside those boundaries.

## Compiler Pipeline Impact

### Frontend And Name Resolution

There is no `platform fn` keyword to bind. Name resolution stops binding
freestanding platform functions by simple global name; a freestanding `platform fn`
in ordinary source is a hard diagnostic pointing at edge-owned capabilities as the
replacement shape. Sealed region and sealed callable _types_ resolve as
target-surface types, like `uefi.Utf16Static` today.

### Semantic Surface

Semantic checking certifies, per edge:

- that sealed-value-typed fields resolve to declared target/package sealed types
- that field accesses on sealed regions target authenticated fields with a declared
  ordering kind and discharge the field's access preconditions
- that calls of sealed callables match the callable's signature and ABI, discharge
  its preconditions, and record its target service identity
- that `requires` entries lower to catalog predicates

No `effects`/`transitions` blocks exist to check; effect summaries are derived from
typed region/intrinsic operations or loaded from callable catalogs. The
certification result records package implementation provenance and any target
service identity a firmware call invokes.

### HIR And Monomorphization

HIR records a platform contract edge for each operation on a sealed value — a region
access or a callable call — including receiver/place metadata identifying the
authorizing capability, plus the operation effect and, for firmware calls, the
target service identity and package implementation provenance. This reuses the
existing `HirPlatformContractEdge` machinery; the change is that its source is a
typed operation, not a declared item. Ordinary Wrela methods that operate sealed
values lower as ordinary bodies. Monomorphization treats sealed-value operations
as reachable leaves and instantiates generic edge classes only when the selected
target can certify the concrete sealed-value contract.

### Layout

Layout authenticates the runtime representation of sealed values: region base and
field offsets, and callable ABI. Accesses may not infer offsets from source text; a
needed offset appears as an authenticated field of a sealed region type.

### Proof MIR And Proof Check

Proof MIR lowers each sealed-value operation as a certified platform call whose
contract carries the authorizing capability place, the affine flow, the operation
effect, the discharged preconditions, and the source origin. Proof-check applies
the existing platform-transfer pattern: verify the contract, check preconditions by
entailment, consume or preserve the capability per its affine mode, produce
returned capabilities, invalidate facts keyed to written regions, and emit checked
fact packets. Minting operations (claims, seeds) produce freshly branded sealed
values with stable provenance.

### OptIR And Optimization

OptIR represents sealed-value operations as effectful operations carrying the
computed effect set. Region writes are not dead even with unused results; operations
on conflicting regions do not reorder unless disjointness is certified; ordered
accesses form scheduling barriers for their memory classes; callables with
divergence or trap effects are not pure. Region conflict is keyed to certified
region identity with default-deny aliasing: two accesses conflict unless a
certificate proves their regions disjoint, and address equality alone proves neither
safety nor independence. Ordinary Wrela bodies that operate sealed values are
optimized normally while their platform summaries are preserved; optimizers trust
only the sealed-value contract.

### AArch64 Backend

The backend lowers a region access to `base + authenticated_offset` with the field's
ordering barrier; a callable call to an indirect ABI call through the callable's
pointer; a `fence` or cache op to the corresponding instruction. All of these are
ordinary compiler codegen; there is no user-supplied assembly to encode. The
Wrela-first direction holds fully: device and firmware logic is ordinary Wrela, and
the **only** machine code not produced from Wrela or a compiler intrinsic is the
compiler-owned UEFI entry thunk.

### Linker And PE/COFF

The linker sees compiler-generated objects and the compiler-owned entry thunk as
ordinary verified object modules participating in symbol resolution, relocation,
section placement, unwind policy, base relocations, and byte-provenance
partitioning. There are no project-authored assembly objects in this design. Final
image reference checks distinguish compiler-generated objects, target package
objects, and project package objects by stable provenance keys, and record both the
service identity a firmware call invokes and the implementation identity that
emitted the surrounding bytes.

## Trusted Computing Base

The trust boundary is intentionally small, and it lives in values and catalogs, not
in source syntax.

Trusted:

- target entry seed rules that mint root edges and sealed values
- target and audited package catalogs: sealed region types (fields, offsets,
  orderings, access preconditions), sealed callable types (signatures, ABI, service
  identity, effect summaries, invalidation, minting rights), predicates, and
  services
- layout authentication for sealed-value representations
- proof-check transfer for sealed-value operations
- the compiler-intrinsic lowerings (barriers, cache ops) and the compiler-generated
  entry thunk
- backend object verifier, byte-provenance emitter, linker, and final image checks

Not trusted:

- source-visible names by themselves
- integer addresses or symbol names supplied by ordinary source
- any value presented as a capability that was not produced by a seed or a certified
  claim
- source-supplied assembly, machine blocks, clobber lists, or relocations
- a package-authored implementation claiming a target service's implementation
  identity (impossible by typing, but also checked in evidence)

Because device and firmware operations are ordinary operations on
sealed-capability-typed values, there is no `platform fn` list to grep for a
device-operation inventory. The compiler instead **derives** that inventory: every
operation on a sealed value is a device operation with a computed effect summary,
and the full list can be emitted on demand. Device access is distinguished from
ordinary memory by the _type of the place_, visible in signatures and optionally in
explicit orderings.

## Hard-Cut Migration Surface

This is a hard cut. Every existing freestanding platform primitive must acquire a
home as a sealed field on an owning edge before the feature is green. For each
primitive, the migration chooses:

- owning edge class
- whether it is a sealed region field (MMIO/DMA) or a sealed callable field
  (firmware call)
- affine flow (`self` or `consume self`) for any method that transforms authority
- `requires` predicates not already implied by the sealed type
- for firmware calls, the target service identity and the package implementation
  provenance of the surrounding Wrela

Expected UEFI migration:

- console output becomes a `FirmwareFn` on a `Console` edge derived from
  `UefiFirmware`; surrounding logic is ordinary package Wrela
- memory-map acquisition becomes a `FirmwareFn` on a boot-services edge whose
  service catalog records the snapshot invalidation
- `ExitBootServices` becomes a `terminal` callable consuming the boot-services edge
  and returning the post-boot machine
- protocol lookup and device discovery become `FirmwareFn` claims returning narrower
  sealed regions or device edges
- watchdog and timer primitives become `FirmwareFn`s on firmware/runtime edges with
  honest implementation provenance
- validation-stream fixtures receive compiler-owned root seeds exposing only
  edge-owned capabilities

Stdlib, full-image fixtures, and target examples move in the same branch as the
rejection of freestanding platform functions. There is no period in which both
freestanding binding and sealed-value authority are accepted in ordinary source.
Follow-up migration continues moving any remaining target templates into Wrela over
sealed values wherever the boundary is expressible honestly.

## Diagnostics

Required diagnostics include:

- freestanding `platform fn` is no longer valid in ordinary source
- source attempts to construct a sealed value (region or callable)
- a value used as a capability lacks a seed rule, certified claim, or
  brand/provenance origin
- a sealed region access targets an unauthenticated field or infers an offset from
  source text
- a sealed region field access lacks the region's declared access precondition
- an explicit ordering ascription does not match the field's declared ordering kind
- an ordering kind is unsupported or too weak for the selected target and field
- region access cannot prove disjointness from a conflicting region access
- a sealed callable call violates its signature, ABI, or preconditions
- unknown `requires` predicate, or a package predicate without certification
- unknown target service identity
- a package implementation is recorded as, or claims, a target service's
  implementation identity it does not own
- source uses a `machine` or `asm` block, declares clobbers, embeds machine
  instructions, or supplies relocations
- an operation attempts to mint a root edge or sealed value without a seed rule

Diagnostics carry source spans for the operation, the capability, the predicate, and
any explicit ordering that caused the failure.

## Validation Strategy

Unit coverage:

- name resolution rejects freestanding platform functions and resolves sealed region
  and callable types
- constructibility checking rejects source construction of sealed values while
  leaving `Result`, `Option`, and `Unit` constructible
- semantic checking discharges region access preconditions and callable
  preconditions, and rejects unauthenticated field access
- semantic checking records target service identity and package implementation
  provenance for firmware calls, and rejects impersonation of a target service's
  implementation identity
- proof-check consumes capabilities for `consume`, preserves them for `observe`, and
  invalidates facts keyed to written regions
- ordered field access lowers to the correct barrier; an explicit ordering mismatch
  is rejected
- effect derivation and catalog loading map region reads/writes, callable calls,
  barriers, and cache ops onto the existing region-version, ordered-region-token,
  call-summary, terminal, and trap machinery
- source `machine` and `asm` blocks are rejected before platform lowering

Integration coverage:

- a `Console` firmware-callable replaces fixture-local `output_string` wrappers,
  with final image evidence recording package implementation provenance and the
  target service identity
- an `RxQueue`-style fixture compiles ordinary field accesses to ordered device
  loads/stores with region-write and barrier evidence, and no `platform fn` or `asm`
  in the source
- an optimizer test proves region writes are neither removed nor reordered across
  conflicting regions, and that ordered accesses form scheduling barriers
- a negative fixture proves a source package cannot mint a root edge or fabricate a
  sealed region or callable from an integer, literal, or factory
- a bringup fixture proves a firmware call after `ExitBootServices` does not compile
- full-image validation reports sealed-value operation provenance in the final
  artifact evidence

System coverage:

- QEMU smoke, when configured, runs at least one console or MMIO-style fixture
  through the normal target driver.

## Cutover Plan

1. Reject freestanding `platform fn` in ordinary source and add sealed region and
   sealed callable _types_ to the target surface, with per-field ordering and access
   preconditions on region types and service identity, effect summaries, and
   invalidation on callable types.
2. Certify sealed-value fields on edge classes and lower each field access or
   callable call to a platform-contract-edge operation with a computed effect,
   recording service identity and implementation provenance.
3. Teach layout to authenticate sealed-value representations (region base/offsets,
   callable ABI).
4. Lower ordered field access to the correct barrier through the existing
   memory-order machinery; add the `fence` intrinsic and region cache-op methods.
5. Drive fact invalidation from derived write effects through the existing
   `advancePrivateState` machinery; remove the source `effects`/`transitions`
   surface.
6. Move UEFI stdlib, direct-platform fixtures, full-image fixtures, and toolchain
   examples onto sealed-value edges in the same cut.
7. Keep target-owned firmware/runtime primitives as catalog callables and
   compiler-owned intrinsics where needed, migrating wrapper logic into Wrela over
   sealed values as boundaries become expressible.
8. Remove the restricted `machine` / source-assembly path from this feature scope.
   Future target instructions must enter as compiler-owned intrinsics or
   sealed-value operations after a separate design, not as source-authored machine
   text.

This order preserves the existing compiler pipeline while moving authority to where
the proof model already expects it: unforgeable, provenance-bearing values.
