# AArch64 Backend Design

## Purpose

The AArch64 backend is the compiler phase after verified AArch64 machine IR and
before the internal linker and PE/COFF EFI writer. It consumes
`AArch64MachineProgram`, preserved machine-keyed facts, provenance, an
authenticated backend target surface, and a closed-image backend plan. It emits
internal AArch64 object code: encoded A64 section fragments, symbols,
relocations, unwind/frame metadata, object provenance, and verification
summaries.

This phase is where Wrela commits to physical registers, concrete stack
addresses, instruction bytes, and relocatable object records. The previous phase
selected and planned virtual-register AArch64 instructions. This phase makes
those instructions executable while preserving the facts that make Wrela's
physical code better than a conventional backend's conservative guess.

This document is intentionally one comprehensive, canonical, production-grade
design document for the backend. Implementation files should be small and
authority-specific, but design authority for ABI classification, instruction
selection/finalization, register allocation, stack frame layout, A64 encoding,
relocation generation, object construction, verification, and Wrela-only
physical-code wins lives here.

This is not an MVP design. Build waves name an implementation order, not a
reduced target. The accepted `wrela-uefi-aarch64-rpi5-v1` backend includes the
whole contract described here.

## Production Commitments

The backend has one job, expressed as six commitments:

```text
abi:
  classify ABI values from authenticated target records
  use public AAPCS64/UEFI conventions at every external, firmware, platform,
  exported, replacement-stdlib, or address-taken boundary
  use Wrela-private conventions only when a closed-image authority finalized
  them before backend object emission begins

allocation:
  assign every virtual register to a physical register or verified spill slot
  satisfy fixed-register, tied-operand, call-clobber, no-spill, wipe-on-spill,
  rematerialization, vector-state, FPCR/FPSR, NZCV, SP, FP, LR, and IP0/IP1
  constraints

frame:
  lay out final stack frames, spill slots, callee-save areas, outgoing argument
  areas, security wipe slots, frame records, prologues, epilogues, and unwind
  metadata with 16-byte stack alignment

finalization:
  lower backend pseudos, copies, spills, reloads, rematerializations,
  prologues, epilogues, tail calls, barriers, veneers, branch relaxations, and
  literal-pool uses to encodable A64 forms

encoding:
  solve layout, relaxation, literal pools, veneers, instruction bytes, patch
  offsets, and relocation records through one monotone layout-and-encode owner
  encode A64 instructions directly from checked bitfield catalogs

object:
  emit deterministic internal object sections, symbols, relocations, unwind
  records, verification summaries, and byte-to-fact provenance
  leave final linking, image-base assignment, PE/COFF serialization, EFI
  headers, and base relocation emission to later phases
```

The production target remains the authenticated
`wrela-uefi-aarch64-rpi5-v1` profile: AArch64, UEFI PE/COFF image output,
Raspberry Pi 5-class Armv8.2-A with LSE, CRC32, AdvSIMD/FP, AES/SHA/PMULL,
FP16, RDM, DotProd, and a Cortex-A76/Raspberry-Pi-5-like tuning model. The
backend emits one instruction stream for that profile. It does not perform host
feature detection, runtime feature detection, multiversioning, JIT generation,
or broad AArch64 profile search.

## Goals

- Produce an internal relocatable AArch64 object module, not textual assembly
  and not a final PE/COFF image.
- Consume only verified `AArch64MachineProgram`, `AArch64PreservedFactSet`,
  `AArch64ProvenanceMap`, `AArch64BackendTargetSurface`, and
  `AArch64ClosedImageBackendPlan`.
- Keep backend internals isolated from source, HIR, proof-checker, layout, and
  OptIR pass internals. Facts reach the backend only through the machine fact
  handoff.
- Reconcile machine ABI records with AAPCS64, UEFI firmware-call constraints,
  Wrela image-entry requirements, and pre-finalized compiler-owned private call
  conventions.
- Allocate physical GPR, SIMD/FP, and fixed resources with deterministic global
  live-range splitting, copy coalescing, rematerialization, spill insertion,
  reload placement, eviction, and verification.
- Reserve fixed and special resources correctly: SP, x29/FP, x30/LR, x16/IP0,
  x17/IP1, x18 when the platform surface does not release it, NZCV, FPCR, FPSR,
  and vector-state resources.
- Honor AAPCS64 caller-saved and callee-saved rules for public calls:
  parameter/result registers x0-x7 and v0-v7, indirect result register x8,
  callee-saved x19-x29, and callee-saved low 64-bit lanes of v8-v15.
- Lay out stack objects, spill slots, preserved-register saves, outgoing
  arguments, local frame objects, security wipe slots, and optional frame
  records with deterministic offsets and 16-byte SP alignment.
- Keep Wrela security facts alive through allocation and frame layout:
  no-spill values are never spilled, wipe-on-spill slots are wiped on every exit,
  secret values are never rematerialized into observable storage, and
  zeroization obligations survive epilogue generation.
- Preserve and exploit rematerialization records for constants, page bases,
  cheap address materializations, literal-pool references, endian transforms,
  and proof-erased helper values.
- Encode instructions directly with a checked A64 encoding catalog. No
  assembler subprocess, no assembly text as authority, and no unvalidated
  mnemonic-to-bytes path.
- Emit relocations for branch/call targets, page-base and low-12 address pairs,
  literal loads, absolute data, local section references, image-entry symbols,
  and final-linker veneer opportunities.
- Distinguish relocation intent from serialized file format. The object model
  records Wrela relocation semantics; a later PE/COFF writer maps those records
  to COFF relocation records and PE image base relocations.
- Preserve deterministic diagnostics, stable object ordering, stable symbol
  ordering, stable relocation ordering, and deterministic bytes for identical
  inputs.
- Keep runtime backend source dependency-free. Tests may use `fast-check`, but
  production code must not import filesystem, Bun, process, OS, host timing,
  external assemblers, benchmark data, scorecard baselines, or OptIR internals.

## Non-Goals

- This phase does not run target-independent OptIR optimization, rewrite source
  programs, create new semantic facts, or re-run proof checking.
- This phase does not accept opaque source or proof metadata as optimization
  authority. Every optimization authority must be a typed machine-keyed fact
  whose lineage and invalidation rules are known.
- This phase does not produce the final PE/COFF EFI image, assign final image
  bases, serialize PE headers, or emit PE base relocation tables.
- This phase does not invoke an assembler, disassembler, linker, host profiler,
  optimizer service, or external binary tool during production compilation.
- This phase does not support a general AArch64 feature matrix, Armv8.0-A
  fallback, no-LSE fallback, SVE/SVE2 lowering, mandatory PAC/BTI/MTE, or
  runtime feature dispatch without a separate target-profile design.
- This phase does not narrow ordinary public AAPCS64 call clobbers. Only a
  finalized closed-image private convention may narrow call clobbers.
- This phase does not let a later linker/export decision invalidate private ABI
  choices after object bytes exist. If a function can later be exported or
  address-taken, it uses public ABI before backend emission.

## Source Standards

Primary standards and references:

- Arm Architecture Reference Manual for A-profile A64 encodings and instruction
  semantics
- AAPCS64 for public procedure calls, argument/result classification,
  callee-saved registers, stack alignment, FP/SIMD preservation, and x18
  platform-register treatment
- AAELF64 relocation semantics as the architectural baseline for AArch64
  relocation intent, even though Wrela's internal object later maps to PE/COFF
- Microsoft PE/COFF AArch64 relocation constraints for final UEFI image
  serialization
- UEFI AArch64 calling, entry, image, and firmware-service constraints
- Raspberry Pi 5/Cortex-A76 public optimization guidance for scheduling,
  pairing, and latency heuristics

The implementation must encode only facts it can cite to the authenticated
target surface or to standards-backed catalogs. The target surface owns profile
choices. Backend code should consume capability records, not infer platform
contracts from strings or host state.

## Wrela-Only Physical-Code Wins

The ordinary backend view of a program is a sea of calls, pointers, aliases,
possible escapes, conservative lifetimes, and ABI boundaries. Wrela's frontend
and proof pipeline deliberately remove that fog before physical code generation.
The backend should spend those facts directly, but only through machine-keyed
records.

| Language or proof feature                                      | Backend-spent fact families                                                                             | Physical-code win                                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| affine `consume`, `take`, `Validation`, and `Attempt` flow     | ownership lifetime, returned-on-error, consumed-on-success, cleanup obligation                          | split live ranges at semantic death points, avoid keeping rejected paths live, reuse registers and spill slots earlier than source-shape liveness            |
| stream/session membership brands                               | session membership, non-escape, terminal discharge, outstanding obligation                              | keep stream cursor and packet bases in registers, reject impossible escapes, omit generic cleanup paths for discharged items                                 |
| sealed ReadableBuffer/WritableBuffer metadata                  | region capacity, source length, initialized prefix, descriptor identity, backing region                 | avoid length loads from packet bytes, pin hot bases, choose direct stores only over initialized ranges, avoid redundant descriptor reloads                   |
| `layout.fits` and validated-buffer fields                      | byte-range containment, endian, field offset, noalias, dereferenceability, payload region               | preserve wide and pair loads, keep ADRP/base values live only when profitable, rematerialize cheap field addresses                                           |
| field-sensitive `self` and private state tokens                | disjoint-field access, private-state generation, private loan, stale-generation invalidation            | color stack slots and registers for disjoint fields while preventing reuse across state-token advances                                                       |
| terminal functions and `Never` control flow                    | noreturn, terminal edge, cleanup obligation, platform discharge                                         | omit fake return paths, avoid restoring dead callee saves, place zeroization only on real exits, encode call/trap/branch endings precisely                   |
| bounded streams, static collections, and MoveRing capacity     | loop/cardinality bound, static-memory capacity, ring endpoint, core owner                               | size frames and outgoing areas statically, unroll or peel bounded hot loops selectively, avoid heap-like fallback paths, schedule handoff barriers           |
| closed image, monomorphized interfaces, replaceable stdlib     | internal-call eligibility, no-address-taken, no-public-escape, final visibility, call-clobber authority | use Wrela-private call conventions, return multiple values in chosen registers, narrow custom clobbers, keep hot capabilities live across calls              |
| security labels and constant-time requirements                 | no-spill, wipe-on-spill, zeroization, secret, key lifetime, constant-time                               | treat security as allocator constraints, prefer rematerialization/register retention, prevent spill-slot sharing or table access that would leak secrets     |
| platform effect and memory-order proofs                        | region memory type, acquire/release, device order, MMIO, volatile, barrier domain                       | keep ordinary spills and remats movable inside effect islands while pinning true device/firmware ordering edges                                              |
| rematerialization authority and relocation-safe address shapes | rematerializable value, page-base authority, relocation pair, literal reference                         | prefer cheap recomputation over spills, preserve ADRP page-base CSE where profitable, avoid illegal remat across relocation or section-placement constraints |
| object linkage and veneer policy                               | symbol binding, section reachability, veneer scratch policy, relocation range, final-linker capability  | choose branch forms, request veneers deterministically, protect IP0/IP1 assumptions, emit relocation records with exact range and scratch-register semantics |

The flagship backend case is the packet loop from `docs/language/happy.md`.
By this phase, the backend should see a session-bound packet/base register,
validated field ranges, bounded receive cardinality, exact terminal return/drop
obligations, TX initialized-prefix facts, UEFI/VirtIO memory-order facts, and
closed-image helper eligibility. A conventional backend can allocate registers
over selected instructions. Wrela can allocate over selected instructions plus
the proof of why packet ownership cannot escape, where each obligation dies,
which paths are terminal, and which calls are compiler-owned.

The expected physical outcome for that loop is concrete:

- the RX packet base and cursor become high-priority GPR live ranges pinned
  across internal helper calls only when closed-image clobber facts permit it
- validated field offsets lower to direct loads or pair loads without reloading
  descriptor length from packet memory
- endian facts select `rev`/`rev16`/`rev32` forms directly
- ownership death at terminal consume points shortens packet/cursor live ranges
  before TX publication
- TX initialized-prefix facts permit direct stores only to proven initialized
  ranges
- virtio memory-order facts insert the exact release/barrier/MMIO notify
  sequence and prevent scheduler motion across it
- no-spill or secret labels keep key/session material out of frame slots
- internal closed-image helpers use finalized private clobbers; firmware calls
  use public AAPCS64 clobbers
- branch and relocation records explain every emitted byte back to packet-layout,
  session-membership, and memory-order facts

## Fact Authority Rules

There are two honesty rules:

```text
missing fact:
  fall back to the conservative AAPCS64 / ordinary allocation / ordinary frame
  shape, or report a deterministic unsupported-program diagnostic

present fact:
  may be spent only through a typed machine-keyed fact record whose lineage,
  invalidation boundary, subject, transfer rule, and verifier family are known
```

There is no hidden translation-validation pass that independently proves emitted
bytes equivalent to input machine IR. The defense is explicit typed fact handoff,
machine-level revalidation, verifier coverage at every mutating boundary,
deterministic differential and known-byte tests, and refusal to optimize when a
required fact or transfer proof is absent.

The backend does not import source, HIR, proof-checker, layout, OptIR pass, or
language internals. If an upstream phase computes a property that late physical
code needs, that property must become a target-neutral fact extension and then
be re-keyed by AArch64 lowering into the preserved machine fact set.

## Proof-To-Bytes Fact Cascade

The backend is allowed to be aggressive only because earlier phases hand it
checked authority in a form that survives lowering. The production compiler must
make this cascade explicit and testable:

```text
proof / resource checker
  -> checked fact packet
  -> OptIR fact set with lineage, dependencies, invalidations, and origins
  -> OptIR rewrite preservation with subject remapping and dropped-fact records
  -> AArch64 machine fact re-keying with closed machine subjects
  -> backend fact import with typed payloads and verifier ownership
  -> backend rewrite transactions with fact/security/provenance transfer
  -> encoded object bytes, relocations, unwind records, and byte provenance
```

Every load-bearing optimization must identify the fact authority level it
consumes. A backend optimization may spend a fact only when all prior links are
present:

- checked fact packet entry exists with certificate, subject, scope,
  dependencies, invalidations, and origin
- OptIR imported it through a registered fact extension or built-in fact family
- each OptIR pass that touched its subject preserved, weakened, or dropped it
  with deterministic lineage
- AArch64 lowering re-keyed it to a machine subject or recorded why it was
  dropped
- backend fact import validated the payload, subject kind, upstream verifier,
  and target declaration keys
- each backend rewrite transaction transferred, weakened, invalidated, or
  rejected it according to the registered transfer rule
- final object provenance records which fact families justified each emitted
  byte, relocation, frame slot, wipe, save, restore, veneer, and diagnostic

If any link is missing, the backend must not rediscover the fact from earlier
compiler data. It falls back, records a missed optimization when appropriate, or
fails with a deterministic unsupported-program diagnostic when no safe fallback
exists.

## Fact Machinery Readiness Gates

The proof foundation is useful to performance only when the middle of the
cascade is production-ready. Before a backend stage may spend a fact family as
correctness or performance authority, the compiler must satisfy these gates:

1. **Proof authority gate:** the fact has a checked packet kind or registered
   extension authority, certificate family, subject vocabulary, dependencies,
   invalidation kinds, and negative fixtures.
2. **OptIR preservation gate:** every OptIR pass that can move, clone, merge,
   delete, or rewrite the fact subject declares preservation/invalidation
   behavior and has tests for preserve, weaken, drop, and stale-subject cases.
3. **Machine re-keying gate:** AArch64 lowering defines exactly how the fact maps
   to machine instruction, memory operand, virtual register, block edge, frame
   object, call site, symbol, region, target declaration, or dropped-fact record.
4. **Backend import gate:** the backend has a typed payload schema, allowed
   backend subjects, verifier owner, conservative fallback, and malformed/stale
   diagnostics for the fact family.
5. **Backend rewrite gate:** every backend rewrite kind that can touch the
   subject has a transfer rule: identity, move, split, copy, weaken, invalidate,
   reject, or rederive-from-catalog.
6. **Object provenance gate:** final object records retain enough provenance to
   explain the fact-to-byte decision and to prove no stale fact subject survived.

The implementation may land these gates incrementally by fact family, but a fact
family cannot be spent to remove a conservative codegen backstop until all six
gates are complete for that family.

## Prior Phase True-Up Work Required

This backend design intentionally names work that earlier compiler phases must
complete before the backend can spend Wrela-only facts. Those phase changes are
tracked here so this document remains the canonical contract for the AArch64
backend; the prior phase design docs do not need to duplicate the backend
worklist.

Required true-up before production backend fact spending:

1. **Shared fact-extension mechanism:** evolve the current OptIR extension
   registry into the shared typed mechanism described here. The existing
   registry provides useful extension keys, packet kinds, import validation, and
   fixture names, but production backend use requires typed payloads, typed
   subject keying, executable preservation/invalidation rules, and
   rewrite-kind-specific transfer rules.
2. **OptIR pass preservation audit:** every OptIR pass that can move, clone,
   merge, delete, or rewrite a backend-spent fact subject must declare whether
   it preserves, weakens, invalidates, or drops that fact family. Tests must
   cover preserved facts, weakened facts, stale subjects, invalidation crossings,
   and dropped-fact records.
3. **Missing target-neutral fact families:** if ownership lifetime, session
   membership, initialized-prefix, private-generation, terminal cleanup,
   internal-call eligibility, core-owner, rematerialization authority, object
   linkage, or any other backend-spent family is currently computed only as
   analysis-local knowledge, it must become a target-neutral fact extension with
   authority, lineage, invalidation rules, and negative fixtures.
4. **Machine-IR fact re-keying expansion:** AArch64 lowering must re-key
   backend-spent facts to closed machine subjects beyond the early value-to-vreg
   path: instruction, memory operand, virtual register, block edge, frame
   object, call site, symbol, region, target declaration, or explicit
   dropped-fact record.
5. **Backend-importable machine payloads:** `AArch64PreservedFactSet` records
   must carry typed-enough payload data for backend import to validate fact
   family, subject kind, lineage, upstream verifier, target declarations, and
   conservative fallback without reading OptIR internals.
6. **ABI intent handoff:** machine IR may carry ABI intent records and
   provisional public-boundary bindings, but final ABI reconciliation belongs to
   this backend after `AArch64ClosedImageBackendPlan` exists. Any current
   machine-IR API named as final ABI locations should either be interpreted as
   provisional intent or renamed before backend implementation depends on it.
7. **Closed-image plan producer:** codegen orchestration must produce
   `AArch64ClosedImageBackendPlan` after whole-image visibility,
   address-taken, replacement-boundary, and participating-module state is final.
8. **Backend target catalog bundle:** the AArch64 target layer must provide
   authenticated backend catalogs for registers, encodings, relocations, unwind,
   frames, veneers, literal pools, security, and tuning before backend internals
   run.
9. **Dropped-fact diagnostics:** every phase handoff must preserve deterministic
   dropped-fact records so the backend can explain why it used a conservative
   fallback or why no sound fallback existed.
10. **End-to-end cascade fixtures:** add fixtures that start with checked proof
    facts, preserve them through OptIR, re-key them to AArch64 machine subjects,
    import them into backend facts, and prove final object provenance still
    points back to the original proof authority.

Until a true-up item is complete for a fact family, that family may remain in
debug metadata or diagnostics, but it must not remove a conservative physical
codegen backstop.

## Authoritative Backend Fact Table

This table is the backend's fact-family map: fact family to physical win to
fallback to consuming stage.

| Fact family                           | Primary subjects                                            | Load-bearing when spent for                         | Conservative fallback                                                   | Backend consumers                                    |
| ------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- | ---------------------------------------------------- |
| ownership-lifetime                    | virtual register, edge, call site                           | lifetime shortening, dead restore removal           | ordinary liveness to block/function/call boundaries                     | liveness, splitting, allocation, frame cleanup       |
| returned/consumed path state          | edge, call site, virtual register                           | avoiding rejected ownership paths                   | keep all path-carried values live and run ordinary cleanup              | liveness, epilogue placement, diagnostics            |
| session-membership-and-escape         | virtual register, region, call site, function               | private ABI eligibility, base pinning               | public ABI, no cross-call pinning, ordinary escape cleanup              | ABI, allocation, cleanup finalization                |
| validated-region-shape                | region, memory operand, frame object                        | direct addressing, pair/wide access reach           | narrow access and conservative address materialization                  | frame layout, finalization, scheduler                |
| initialized-prefix-and-capacity       | region, virtual register, memory operand                    | direct writes, zero-fill avoidance, static sizing   | guarded narrow writes or explicit initialization                        | frame layout, stores, object data layout             |
| disjoint-field-and-private-generation | virtual register, memory operand, region                    | register/slot coloring, alias pruning               | no overlap coloring across disputed fields or generations               | allocator, spill-slot coloring, scheduler            |
| terminal-exit-and-cleanup             | edge, block, call site                                      | epilogue removal, zeroization placement             | materialize ordinary return/cleanup path                                | finalization, frame, security                        |
| bounded-cardinality                   | function, block, region, loop                               | frame sizing, pressure weighting, bounded unroll    | ordinary loop pressure and dynamic bounds                               | allocator, scheduler, finalization                   |
| internal-call-eligibility             | call site, function, symbol                                 | private ABI, narrow clobbers, multi-result returns  | public AAPCS64 ABI and full caller-saved clobbers                       | ABI, allocation, call finalization                   |
| final-linkage-and-visibility          | symbol, function, module                                    | private ABI finalization                            | public ABI for any uncertain/exportable/address-taken boundary          | closed-image plan verifier, ABI                      |
| core-owner-and-transfer               | virtual register, region, call site, edge                   | barrier minimization, handoff scheduling            | target-declared conservative barriers                                   | scheduler, barrier finalization, ABI                 |
| security-and-secret-lifetime          | virtual register, frame object, memory operand, edge        | no-spill, wipe-on-spill, constant-time restrictions | secret-safe fallback or hard error when required policy has no fallback | allocation, frame, scheduler, finalization, verifier |
| rematerialization-authority           | instruction, symbol, relocation reference, virtual register | remat instead of spill/reload                       | spill/reload or materialize from canonical symbol/literal               | allocator, finalization, layout-and-encode           |
| memory-order-and-region-type          | memory operand, region, platform action, call               | barrier/suffix selection, access-shape legality     | conservative target-declared sequence or hard error for device/MMIO     | scheduler, finalization, object verifier             |
| vector-state-and-fp-environment       | function, call, instruction, virtual register               | vector forms, FP contraction, FPCR/FPSR behavior    | scalar/helper form or hard error for vector-only semantics              | allocation, scheduler, finalization                  |
| object-linkage-and-veneer-policy      | symbol, relocation reference, call site, section fragment   | branch range, veneer request, IP0/IP1 clobber model | relocation with linker-owned veneer or hard range diagnostic            | layout-and-encode, relocation, object verifier       |

Missing facts are not silent hints. The consuming stage either uses the fallback
listed here, emits a missed-optimization diagnostic in debug mode, or fails with
a deterministic diagnostic when no sound fallback exists.

## Shared Fact-Extension Mechanism

The backend must not hand-roll a third fact registry. The existing OptIR fact
infrastructure proves the compiler already wants a fact-extension registry, but
it is not yet the full production mechanism this backend needs. Today it is
mostly string-keyed metadata and import validation. The backend requires typed
payloads, typed subject keys, executable preservation/invalidation rules, and
rewrite-kind-specific transfer rules. Building that richer shared generic and
migrating OptIR onto it is an explicit prerequisite for production backend fact
spending.

The shared mechanism must preserve the useful OptIR registry concepts:

- extension key
- closed payload validator
- subject keyer
- preservation and invalidation rules
- upstream verifier key
- negative fixtures

It must also add typed payload results and transfer behavior. The production
shape is a shared, subject-parameterized home, for example:

```ts
export interface CompilerFactExtension<Subject, Payload, RewriteKind, RewrittenSubject> {
  readonly extensionKey: CompilerFactExtensionKey;
  readonly validateImport: (payload: unknown) => Result<Payload, FactDiagnostic>;
  readonly indexKeysFor: (payload: Payload) => readonly Subject[];
  readonly preservationRules: readonly FactPreservationRule<Subject>[];
  readonly invalidationRules: readonly FactInvalidationRule<Subject>[];
  readonly transferRules: ReadonlyMap<
    RewriteKind,
    FactTransferRule<Subject, RewrittenSubject, Payload>
  >;
  readonly upstreamVerifierKey: FactVerifierKey;
  readonly negativeFixtures: readonly FactNegativeFixture[];
}
```

OptIR, AArch64 machine IR, and the AArch64 backend each instantiate this shared
contract with their own subject vocabularies. The backend may define
backend-specific fact families, but not a backend-specific registry architecture
that duplicates the same validation and re-keying concepts. The migration path
is part of the design: first introduce the shared generic behind the existing
OptIR registry API, then port OptIR fact extensions to typed payloads and typed
rules, then allow AArch64 machine IR and backend imports to depend on the shared
contract directly.

Backend import follows this sequence:

```text
AArch64PreservedFactSet
  -> validate extension key is registered
  -> validate payload schema
  -> resolve machine subjects
  -> check lineage and upstream verifier family
  -> index by backend subject
  -> attach transfer rule for each mutating stage
  -> expose only typed query interfaces to backend consumers
```

Any malformed, unknown, stale, duplicate-authority, or unverifiable fact is an
input-contract diagnostic. The backend does not continue by treating such facts
as optional hints when the consuming stage planned to spend them.

## Backend Subjects

Backend fact subjects are physical-code entities, not source entities:

- machine function, block, edge, and instruction IDs
- virtual register IDs before allocation
- physical register and alias-set IDs after allocation
- frame object, spill slot, callee-save slot, outgoing-argument slot, and wipe
  slot IDs
- call site, ABI boundary, private-convention record, and call-clobber summary
- symbol, section, fragment, literal-pool island, veneer, and relocation IDs
- memory operand, address materialization, page-base, and literal reference IDs
- security label, zeroization obligation, and constant-time region IDs

The subject vocabulary is closed. A backend fact that names an unknown subject
kind is rejected during import.

## Canonical Rewrite Transaction

Every backend rewrite uses `AArch64BackendRewriteTransaction`. This is the
single owner of instruction mutation, ID allocation, fact transfer, security
label transfer, dependency invalidation, diagnostics, and provenance updates.

The transaction model exists because backend rewrites are unavoidable:

- register allocation inserts spills, reloads, rematerializations, and copies
- move resolution splits critical copy webs and may insert temporaries
- frame layout rewrites abstract frame references to concrete offsets
- prologue and epilogue generation inserts saves, restores, wipes, and stack
  adjustments
- pseudo expansion lowers backend pseudos into encodable physical instructions
- scheduling and peepholes reorder or replace physical instructions
- branch relaxation expands or shrinks branches
- literal-pool placement rewrites literal users
- veneer insertion creates new fragments and call/jump sequences

Those clients are not allowed to mutate instruction arrays or metadata directly.
They describe their requested edit to a transaction:

```ts
export interface AArch64BackendRewriteTransaction {
  readonly kind: AArch64BackendRewriteKind;
  replaceInstruction(
    oldInstruction: AArch64InstructionId,
    replacements: readonly AArch64PhysicalInstructionDraft[],
    transfer: AArch64FactTransferPlan,
  ): AArch64BackendRewriteTransaction;
  splitBlock(block: AArch64BlockId, split: AArch64BlockSplitPlan): AArch64BackendRewriteTransaction;
  createFrameObject(
    object: AArch64FrameObjectDraft,
    provenance: AArch64ProvenanceSource,
  ): AArch64BackendRewriteTransaction;
  createRelocationReference(
    reference: AArch64RelocationReferenceDraft,
    provenance: AArch64ProvenanceSource,
  ): AArch64BackendRewriteTransaction;
  commit(): Result<AArch64BackendRewriteCommit, AArch64BackendDiagnostic>;
}
```

The real implementation may choose different method names, but the ownership
rule is fixed: commit is atomic. It either publishes all structural edits plus
their fact/security/provenance/dependency updates, or it publishes none.

Commit performs these steps:

1. Allocate stable IDs for all new instructions, blocks, frame objects, symbols,
   fragments, relocations, veneers, and literal-pool entries.
2. Build old-to-new subject maps for every edited entity.
3. Apply registered fact transfer rules to each load-bearing fact affected by
   the rewrite.
4. Apply security label transfer and label-conservation rules.
5. Recompute or invalidate liveness, dependencies, call-clobber summaries,
   scheduling barriers, dominator data used by the backend, and layout ranges
   according to the rewrite kind.
6. Attach provenance from each new entity back to old entities and rewrite
   causes.
7. Produce a verifier plan naming all verifier families that must run before the
   next consuming stage may trust the rewritten program.
8. Sort diagnostics deterministically.
9. Publish the committed snapshot only if every mandatory transfer and verifier
   precondition was satisfied.

No rewrite may leave a fact attached to an old subject that no longer exists.
No rewrite may duplicate a load-bearing fact onto multiple new subjects unless
the fact's transfer rule explicitly permits split ownership. No rewrite may
drop a security or zeroization obligation silently.

## Rewrite Granularity And Incrementality

`AArch64BackendRewriteTransaction` is the only mutation path, but transactions
are not required to be whole-function rewrites. A transaction declares its
granularity:

- instruction-local replacement
- block-local rewrite
- edge/block split
- live-range repair region
- frame-layout rewrite
- section-fragment/layout rewrite
- whole-function rewrite
- closed-image metadata rewrite before object emission

The commit produces invalidation sets for exactly the affected subjects:
liveness ranges, dependency edges, fact indexes, security labels, frame objects,
section fragments, relocation records, and provenance nodes. Verifiers consume
those invalidation sets and may run incrementally when their invariant is local.
A verifier may still escalate to a whole-function or whole-object check when the
rewrite kind crosses its summary boundary, but escalation is explicit and
diagnostic traces record it.

This preserves the single-owner correctness model without forcing every spill,
copy, or peephole to recompute the entire function from scratch. Deterministic
debug builds may request full recomputation after every transaction to catch
incremental-verifier bugs; production builds use the same invariants with
bounded invalidation.

## Fact Transfer Rules

A fact family must declare one of these transfer behaviors for each rewrite kind
that can touch its subjects:

| Transfer behavior     | Meaning                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------ |
| identity              | old subject survives unchanged                                                             |
| move                  | fact moves to exactly one new subject                                                      |
| split                 | fact divides across multiple new subjects with an explicit conservation rule               |
| copy                  | fact may duplicate because the payload is pure authority, not linear ownership             |
| weaken                | fact transfers to a weaker payload that preserves correctness but may lose profitability   |
| invalidate            | fact is dropped, and any optimization depending on it must be undone or refused            |
| reject                | rewrite is illegal while the fact is attached                                              |
| rederive-from-catalog | backend may recreate the fact from authenticated target or object catalog data, not source |

Examples:

- An ownership-death fact usually `move`s through copy coalescing and may
  `split` only when the split edges preserve the same semantic death frontier.
- A no-spill security fact `move`s from virtual register to physical register
  live range and `reject`s any spill insertion.
- A wipe-on-spill obligation `split`s into concrete wipe obligations for every
  exit that can observe the spill slot.
- A page-base rematerialization fact may `weaken` when allocation pressure keeps
  the value in memory but must `reject` rematerialization across relocation
  kinds that cannot be reconstructed locally.
- A terminal-edge fact may `move` through block splitting but must `reject` a
  rewrite that fabricates a fallthrough return.

## Security Label Conservation

Security and constant-time handling has one owner:
`security-label-conservation`. Allocation, frame, finalization, scheduling, and
object verifiers delegate to that invariant instead of each implementing their
own no-spill or zeroization clauses.

The invariant tracks:

- secret labels and constant-time regions
- no-spill labels
- wipe-on-spill slot obligations
- key lifetime start/end
- zeroization obligations on normal, error, terminal, trap, tail-call, and
  noreturn exits
- table-access, branch-shape, timing-visible rematerialization, and
  timing-visible call constraints

After every rewrite transaction, the security verifier checks:

- every pre-rewrite security label has a legal post-rewrite image
- no-spill values were not assigned spill slots, stack slots, literal pools, or
  memory remats
- wipe-on-spill slots are wiped on every observable exit before the slot can be
  observed or reused
- secret-derived branches, table indices, call targets, and memory addresses
  satisfy the constant-time policy attached to the function or region
- rematerialization of secret or key material is either prohibited or proven to
  recreate only register-local non-observable state
- tail calls, noreturn paths, traps, and veneers do not bypass required wipes

If the invariant fails, backend emission fails. There is no "spill anyway and
mark debug metadata" fallback for no-spill or key-lifetime facts.

## Constant-Time Construction

Constant-time behavior is constructed by policy, then verified. The security
catalog defines the target leakage model for `wrela-uefi-aarch64-rpi5-v1`:

- which instruction families are constant-latency for secret operands on the
  authenticated Cortex-A76/Raspberry-Pi-5-like profile
- which instruction families are forbidden for secret operands because their
  latency, memory footprint, exception behavior, or helper implementation may be
  data-dependent
- whether integer divide, FP operations, table lookup, vector permute, crypto
  instructions, unaligned access, branch prediction effects, and cache-touching
  operations are allowed, forbidden, or require a reviewed helper
- which helper calls are constant-time and what registers/memory they may
  observe
- which public declassification or comparison patterns may convert secret data
  into control flow

Selectors, allocator, scheduler, finalizer, and encoder consume this policy
positively:

- selection must choose only constant-time-approved machine patterns for
  secret-labeled operations
- allocation must keep no-spill secret values out of memory and must reject
  spill/remat choices that would introduce timing-visible memory traffic
- rematerialization of secret-derived values is legal only through approved
  register-local instruction families
- scheduling may not move secret-dependent operations across policy barriers in
  a way that changes observable timing or memory footprint
- branch relaxation and veneer insertion may not introduce secret-dependent
  branches, secret-dependent addresses, or helper calls absent a catalog rule
- encoding rejects an instruction form when the selected operand classes or
  immediate form fall outside the constant-time catalog entry

The verifier checks that construction obeyed the catalog. It does not invent the
timing model after the fact. If the target surface cannot state the relevant
constant-time behavior for an operation family, secret-labeled uses of that
family are rejected or lowered through an explicitly reviewed constant-time
helper.

## Provenance Survival

Every emitted byte, relocation, frame slot, spill slot, callee-save slot,
literal-pool entry, veneer, unwind record, and diagnostic must point back to:

- the machine subject that caused it
- the backend rewrite transaction that created or moved it
- the fact families spent to justify it
- the upstream verifier family that authorized those facts
- the target-surface catalog record that made the encoding, ABI, relocation,
  unwind, or security policy legal

This provenance is not only for debugging. It is how deterministic diagnostics
explain why the backend used a private convention, why a value did not spill,
why a branch needs a veneer, why a callee-save restore disappeared, and why a
relocation form is legal.

## Backend Target Surface Boundary

The backend API accepts an authenticated `AArch64BackendTargetSurface`, not the
earlier `AArch64TargetSurface`. The existing target surface is a source/lowering
contract: profile identity, target fingerprints, and high-level capability
records. The backend requires richer catalogs:

```ts
export interface AArch64BackendTargetSurface {
  readonly profile: AArch64TargetProfileRecord;
  readonly backendSurfaceId: AArch64BackendSurfaceId;
  readonly sourceSurfaceFingerprint: string;
  readonly backendSurfaceFingerprint: string;
  readonly registerModel: AArch64PhysicalRegisterModel;
  readonly encodingCatalog: AArch64EncodingCatalog;
  readonly relocationCatalog: AArch64RelocationCatalog;
  readonly unwindCatalog: AArch64UnwindCatalog;
  readonly frameCatalog: AArch64FrameCatalog;
  readonly veneerCatalog: AArch64VeneerCatalog;
  readonly literalPoolCatalog: AArch64LiteralPoolCatalog;
  readonly securityCatalog: AArch64BackendSecurityCatalog;
  readonly tuningModel: AArch64BackendTuningModel;
}
```

An explicit adapter/authenticator runs before backend internals:

```ts
export function authenticateAArch64BackendTargetSurface(
  input: AArch64BackendSurfaceAuthenticationInput,
): Result<AArch64BackendTargetSurface, AArch64BackendSurfaceDiagnostic>;
```

That adapter may consume the existing `AArch64TargetSurface` plus backend catalog
bundles. After it returns, backend internals depend only on
`AArch64BackendTargetSurface` capability interfaces. No allocator, frame
builder, encoder, or object writer probes optional fields on the source
surface, performs casts, or reconstructs backend catalogs from profile strings.

## Backend Catalog Authoring And Validation

The backend target surface is a checked catalog bundle, not hand-written ambient
knowledge. Catalogs are authored as deterministic target data under the AArch64
target module and authenticated before backend entry:

- register model catalog: physical registers, register classes, operand
  permissions, platform reservations, call-preserved masks, veneer scratch
  masks, and rpi5-v1's x18 policy
- encoding catalog: A64 opcode families, fixed bitfields, operand bitfields,
  feature gates, immediate/range rules, SP/ZR operand permissions, and known-byte
  fixture IDs
- relocation catalog: internal relocation kinds, accepted operand sites, patch
  bit ranges, addend policy, PE/COFF mapping, range policy, and veneer
  delegation policy
- unwind catalog: serializable prologue/epilogue templates, PE/COFF ARM64 unwind
  opcode mapping, no-unwind leaf rules, and rejection rules for unrepresentable
  frames
- frame catalog: stack-alignment rules, frame-record requirements, large-frame
  adjustment templates, callee-save layouts, and encodable offset classes
- veneer catalog: veneer kinds, scratch-register clobbers, branch/call
  eligibility, security restrictions, and linker-owned versus backend-owned
  policy
- literal-pool catalog: allowed literal classes, reach ranges, section
  placement, alignment, relocation compatibility, and security restrictions
- security catalog: constant-time instruction subset, forbidden
  data-dependent-latency operations for secret data, no-spill/wipe policies, and
  target microarchitecture assumptions
- tuning model: deterministic latency/throughput/pressure weights for the
  authenticated Cortex-A76/Raspberry-Pi-5-like profile

Catalog authentication performs schema validation, cross-catalog consistency
checks, and deterministic fingerprinting. Encoding catalog entries must have
known-byte fixtures generated from reviewed reference cases; tests may
cross-check with external assemblers, but production authentication does not
call an assembler or make external tools authoritative. Relocation catalog
entries must name the final PE/COFF writer mapping or state that the relocation
is internal-only and must be resolved before PE/COFF serialization. Unwind/frame
catalog entries must prove the frame builder cannot emit a prologue or epilogue
that the final writer cannot represent.

## Canonical Physical Register Model

The backend uses one authenticated `AArch64PhysicalRegisterModel`. ABI,
allocation, encoding, unwind, frame, and verification code consume this model.
They do not each define their own register universe.

The model contains:

- architectural GPRs x0-x30, SP, ZR, and their 32-bit W views
- SIMD/FP registers v0-v31 and b/h/s/d/q lane views
- pseudo resources NZCV, FPCR, FPSR, and vector-state policy resources
- alias sets across x/w views, SIMD/FP lane forms, and callee-saved low-lane
  preservation obligations
- reserved, caller-saved, callee-saved, fixed, temporary, platform, veneer, and
  unavailable masks
- per-instruction operand permissions for SP, ZR, IP0, IP1, FP, LR, and x18
- encoding numbers and register-class membership
- target-profile constraints for UEFI, platform register x18, and vector use

Interference is a pure function over alias sets from this model. If two
resources alias, they cannot hold simultaneously live incompatible values even
when their textual names differ. If a target profile reserves x18, no allocator
or private convention may use it. If a veneer policy reserves IP0/IP1 around a
relocation, the allocator treats that range as clobbered or unavailable
according to the veneer catalog.

For `wrela-uefi-aarch64-rpi5-v1`, x18 is reserved and unallocatable. The profile
does not use x18 for Wrela private conventions, temporaries, spills,
rematerialization, veneers, or helper calls. A later target profile may release
x18 only by changing the authenticated register model and its tests.

SP and ZR require special treatment. A64 often encodes SP or ZR with register
number 31, but they are not interchangeable storage aliases. SP is the stack
pointer resource and may appear only in operands whose encoding catalog permits
SP. ZR/WZR is a constant-zero source or write-discard sink and never owns a live
range, spill slot, or value. The allocator therefore does not place ordinary
values in an "SP/ZR alias set"; it asks the encoding catalog whether operand
slot 31 means SP, ZR, WSP, or WZR for the specific instruction form.

## Public ABI Rules

Public boundaries use AAPCS64 and UEFI rules:

- integer and pointer parameters/results use x0-x7
- FP/SIMD parameters/results use v0-v7 when the target and ABI classification
  permit
- x8 carries indirect result addresses when required
- x9-x15 are caller-saved temporaries
- x16/IP0 and x17/IP1 are intra-procedure-call temporaries and may be clobbered
  by veneers or call sequences according to the target surface
- x18 is platform-reserved for `wrela-uefi-aarch64-rpi5-v1`
- x19-x29 are callee-saved, with x29 as FP when a frame record is required
- x30 is LR
- SP remains 16-byte aligned at public call boundaries and on function entry
  and exit
- v8-v15 preserve their low 64 bits; v16-v31 are caller-saved
- FPCR, FPSR, NZCV, and vector-state behavior follows the authenticated target
  and function policy

Firmware calls, image entry, platform calls, exported functions, address-taken
functions, replacement-standard-library boundaries, and any boundary not proven
compiler-owned stay public. Memory-effect facts do not narrow public register
clobbers. Public calls conservatively clobber the ABI caller-saved register set
and any additional target-surface clobbers.

## Closed-Image ABI Authority

Private ABI choice is closed-image state established before object emission, not
a decision deferred to backend byte generation. A relocatable object pipeline
cannot emit bytes under a private convention and then discard that convention if
a later linker/export decision changes visibility. Therefore private conventions
are finalized before any backend object emission begins.

The backend input includes an `AArch64ClosedImageBackendPlan`:

```ts
export interface AArch64ClosedImageBackendPlan {
  readonly closureKind: "closed-image" | "relocatable-public-only";
  readonly participatingModules: readonly AArch64ModuleId[];
  readonly symbolVisibility: AArch64FinalSymbolVisibilityTable;
  readonly addressTaken: AArch64FinalAddressTakenTable;
  readonly replacementBoundaries: AArch64ReplacementBoundaryTable;
  readonly publicAbiBoundaries: AArch64PublicBoundaryTable;
  readonly privateConventions: readonly AArch64FinalPrivateConventionRecord[];
  readonly authorityFingerprint: string;
}
```

If `closureKind` is `relocatable-public-only`, every function that can cross an
object boundary, be exported, be address-taken, or be replaced uses public
AAPCS64. If `closureKind` is `closed-image`, the plan covers all object modules
that may participate in private conventions, and every private caller/callee
agreement is frozen before the first module enters backend emission. A later
export/address-taken change invalidates the closed-image plan and requires
recompilation from the appropriate earlier phase; the linker never patches a
private ABI into safety.

The closed-image authority supplies `AArch64ClosedImageBackendPlan`. It is valid
only when:

- the participating object modules are known before backend emission begins
- final visibility for every function and symbol is known
- address-taken state is final for every function candidate
- replacement-stdlib and platform boundaries are marked
- public ABI boundaries are marked
- every private caller/callee pair has a finalized convention record
- the plan fingerprint matches the machine program and target backend surface

Private conventions are forbidden when the backend is compiling a reusable
relocatable object whose later linker/export state can invalidate visibility or
address-taken assumptions. In that mode, all such boundaries use public ABI.

When the plan is closed-image, private conventions may choose:

- custom argument/result physical registers
- multiple direct result registers beyond public ABI shape
- narrower caller-saved clobber sets
- custom callee-saved responsibilities for compiler-owned functions
- pinned capability/base registers across internal calls
- tail-call and sibling-call forms unavailable at public boundaries
- direct treatment of proof-erased helper values

The plan is all-or-nothing for private ABI safety. If a later phase wants to
export or address-take a function that had a private convention, it invalidates
the closed-image plan and requires recompilation. The linker never patches a
private ABI convention into a public one.

## Closed-Image Plan Producer

`AArch64ClosedImageBackendPlan` is produced by the codegen orchestration layer
after monomorphization, reachability, replacement-stdlib selection, visibility
finalization, and AArch64 machine-IR lowering have completed for every
participating module, but before any AArch64 object module is emitted. That
producer is image-scoped, not per-function and not per-object.

The producer consumes:

- final module graph and participating module IDs
- selected target profile and backend target surface fingerprint
- exported symbol list, firmware/platform boundary list, and replacement-stdlib
  boundary list
- final address-taken table from preserved facts and machine call/reference
  subjects
- direct call graph and indirect-call escape summaries
- machine-program fingerprints for every participating module
- internal-call eligibility facts re-keyed to machine functions and call sites
- ABI catalog records for candidate public and private conventions

It emits `closureKind: "closed-image"` only when all participating modules and
private-call candidates are closed under the final image. Otherwise it emits
`closureKind: "relocatable-public-only"` and the backend uses public ABI at every
escape-capable boundary.

`authorityFingerprint` is a deterministic hash over the backend target surface
fingerprint, participating module IDs, machine-program fingerprints, final
visibility table, final address-taken table, replacement/public boundary tables,
direct call graph summary, and every finalized private convention record. The
backend verifies that fingerprint before ABI reconciliation. If any input
changes, the plan is stale and object emission fails.

## ABI Classification Flow

ABI classification proceeds in this order:

```text
machine ABI intent records and provisional public-boundary bindings
  -> target backend surface ABI catalogs
  -> closed-image plan boundary classification
  -> public AAPCS64 classification for public/firmware/platform boundaries
  -> private convention lookup for finalized compiler-owned boundaries
  -> call-clobber summary creation
  -> allocator constraints and verifier records
```

The backend does not recover ABI facts from source types. It finalizes the
machine-IR ABI intent records against the backend target surface and the
closed-image plan. Public boundaries keep or verify AAPCS64 locations; finalized
private boundaries may replace provisional locations with private convention
locations before allocation.

Each call site receives:

- argument location assignments
- result location assignments
- indirect-result handling
- fixed register uses and defs
- caller-saved clobbers
- callee-save obligations for the callee when known
- tail-call eligibility
- IP0/IP1 and veneer scratch policy
- memory/effect barrier summaries
- security and zeroization crossing obligations

The ABI verifier rejects mismatches between caller and callee records, public ABI
violations, private convention use outside the closed-image plan, and any call
whose clobber summary does not match its boundary kind.

## AAPCS64 Classification Coverage

Public ABI classification must cover the full accepted profile before the
backend is considered production-ready:

- integer, pointer, bool, enum, and capability-like machine scalars
- FP and SIMD scalar/vector values permitted by the function vector-state policy
- aggregates by size, alignment, field composition, and pass-by-value versus
  pass-by-reference rules
- homogeneous floating-point aggregates and homogeneous short-vector aggregates
  when the target policy permits their public ABI use
- indirect result pointers and x8 handling for large or non-register returns
- stack arguments, stack alignment, over-aligned arguments, and padding
- multi-register returns and tuples that must remain tied through allocation
- variadic calls rejected or routed through an explicit unsupported diagnostic
  unless a future profile adds a reviewed variadic ABI contract
- firmware-call edge cases from the UEFI platform catalog
- v8-v15 low-lane preservation and full-vector clobber behavior around public
  calls
- x18 platform-register treatment for `wrela-uefi-aarch64-rpi5-v1`, which is
  target-surface data and must be stated by the authenticated register model

Private conventions may choose different locations only for finalized
compiler-owned closed-image boundaries. They do not change public classification
or firmware-call rules.

## Allocator Inputs

Register allocation consumes:

- verified AArch64 machine functions
- virtual-register defs, uses, widths, classes, tied operands, and fixed
  physical constraints
- machine dependencies for memory, calls, NZCV, FPCR/FPSR, vector state, and
  barriers
- ABI call-boundary records and clobber summaries
- rematerialization facts and relocation safety records
- ownership lifetime, terminal, noalias, bounded-cardinality, and internal-call
  facts
- security labels: no-spill, wipe-on-spill, secret, key lifetime, zeroization,
  and constant-time region
- target tuning model and register-class pressure weights
- canonical physical register model

The allocator does not recompute source semantics. It spends only machine-keyed
facts and target-surface records.

## Allocation Strategy

The production allocator is deterministic global live-range allocation with
splitting, coalescing, rematerialization, and spill insertion. It is not a local
linear-scan placeholder. The core strategy:

1. Build virtual live intervals from machine blocks, dependencies, call
   boundaries, and fact-guided semantic death points.
2. Split intervals at ABI boundaries, terminal edges, ownership consumes,
   pressure points, rematerialization points, and security policy boundaries.
3. Coalesce copies and ABI moves when alias sets, call clobbers, and security
   labels permit.
4. Allocate by register class with deterministic priority, spill cost, pressure,
   and target tuning weights.
5. Prefer rematerialization over spill when a remat fact proves the value is
   cheap and legal at the use site.
6. Insert spills/reloads through `AArch64BackendRewriteTransaction`.
7. Resolve physical moves, parallel copies, and tied operands through the same
   transaction model.
8. Recompute liveness and rerun affected verifiers after each committed rewrite.
9. Repeat only through a bounded repair worklist with a well-founded progress
   order.

The allocator termination argument is explicit. Each original virtual live range
receives a finite set of legal split cut points: block boundaries, call
boundaries, fixed-operand boundaries, loop headers/latches, semantic death
points, rematerialization points, and security policy boundaries. Each failed
allocation decision must take the first legal action in this deterministic
order:

1. assign a non-conflicting physical register
2. split at an unused cut point and consume that cut point
3. rematerialize at uses and freeze the original interval
4. spill to a verified stack slot and freeze the original interval
5. fail with a diagnostic if the value is no-spill, has no legal remat/spill
   form, or the required reload/copy cannot be represented

A frozen interval is not promoted back into the same allocation episode. Spill
and rematerialization can create reload, copy, or remat intervals, but those
intervals are bounded by the use site or move web that created them and inherit a
strictly smaller split budget than the original interval. The lexicographic
progress order is:

```text
unresolved hard constraints
  illegal alias interferences
  unfrozen global intervals
  pending move webs
  unmaterialized reload/remat obligations
  remaining split-budget sum
```

Every committed repair reduces that tuple or reports a deterministic failure.
Legal spillable programs are protected from spurious allocation failure by the
frame catalog's emergency materialization rules: each register class that may be
spilled has a verified reload/store strategy, encodable frame-addressing plan, or
predeclared scratch-register protocol. Values marked no-spill, values whose
reload would violate constant-time policy, and frames whose addressing cannot be
encoded are legitimate hard errors. There is no silent "spill everything" escape
hatch.

## Spill And Rematerialization Policy

Spill choice uses:

- dynamic pressure estimate from block frequency and loop depth facts
- call-boundary pressure and clobber sets
- use density and rematerialization cost
- addressability of spill slots from SP or FP
- pair spill/load opportunities
- security labels
- wipe cost and exit count
- ownership death and terminal edges
- noalias and disjoint-field slot-coloring authority

Rematerialization is legal only when:

- the value has a registered rematerialization authority fact
- all symbols, relocations, page-base pairs, literal references, and constants
  can be reconstructed at the remat site
- the reconstruction does not cross forbidden memory/effect, FPCR/FPSR,
  vector-state, or security boundaries
- the target surface declares the required instruction forms
- provenance can point from the new instruction back to the original authority

No-spill values are hard constraints. If a no-spill value cannot be assigned a
legal physical register over its required live range, compilation fails with a
diagnostic naming the live range, register class, blockers, fixed constraints,
and security fact.

Wipe-on-spill values may spill only into slots that carry wipe obligations. Every
observable exit from the function must execute the wipe before the slot can be
observed, reused for incompatible data, or skipped by tail-call/noreturn/trap
finalization.

## Spill Slot Coloring

Spill slots may be shared only when the backend has proof that lifetimes and
security labels permit sharing. The slot colorer consumes:

- live-range non-overlap from allocation liveness
- ownership death facts
- disjoint-field and private-generation facts
- noalias facts
- value width, alignment, and addressability
- wipe-on-spill and secret labels
- outgoing-argument and call-clobber constraints

The colorer must never share:

- slots for simultaneously live values
- slots with incompatible security labels
- slots that require different wipe timing
- slots whose address escapes under incompatible provenance
- slots whose alignment or pair-load placement conflicts
- slots across private-state generation advances unless the generation fact
  explicitly permits the reuse

A verified lifetime rule permits slot overlap only when all of these are true:

- the backend liveness graph proves the two physical live ranges are disjoint
  after spill/reload insertion
- every fact family attached to either value declares `move`, `weaken`, or
  `invalidate` behavior that allows the overlap
- no address to either slot can be observed across the other value's lifetime
- outgoing-argument use is bounded to the call sequence that owns it
- any wipe obligation for the earlier occupant completes before the later
  occupant can be observed

A private-generation fact permits reuse across a generation advance only when
the fact names the old generation, new generation, field or region identity,
stale-reference invalidation point, and verifier family that proved no stale
address can access the reused slot. Absent that exact proof, generation advances
are hard anti-coloring barriers.

## Stack Frame Layout

Frame layout consumes allocation results and emits concrete frame records. It
lays out:

- callee-save GPR saves
- callee-save SIMD/FP low-lane saves
- spill slots
- rematerialization scratch slots when unavoidable
- outgoing argument space
- local frame objects selected by machine lowering
- security wipe slots
- stack-protector or frame metadata slots when required by target policy
- optional frame record with x29/x30
- unwind record storage

Layout goals:

- maintain 16-byte SP alignment at entry, exits, and public call boundaries
- choose SP-relative or FP-relative addressing according to reach and target
  policy
- maximize `stp`/`ldp` pair saves, restores, spills, and reloads when legal
- place hot spill slots within signed scaled offset reach
- keep wipe slots reachable on every exit
- avoid overlap between outgoing argument areas and live spill slots unless a
  verified lifetime rule allows it
- keep frame shape deterministic for identical inputs

Large frames use deterministic materialization sequences for stack adjustments.
The frame builder may split adjustments around probes or calls only when target
policy requires it. UEFI image constraints and the target frame catalog decide
which frame record and unwind forms are legal.

## Prologue And Epilogue Generation

Prologue generation inserts:

- stack adjustment
- frame record setup when required
- callee-save stores
- security initialization or wipe-slot setup if required
- vector-state setup when target policy requires it
- unwind plan markers

Epilogue generation inserts:

- required zeroization and wipe-on-spill clears
- callee-save restores that are live across an observable exit
- frame record teardown
- stack adjustment restore
- return, tail-call branch, trap, or unreachable ending
- unwind plan markers

Terminal, noreturn, trap, and tail-call edges do not fabricate ordinary returns.
They may omit restores only when the exit cannot observe the restored resource
and the unwind/security policy allows the omission. Security wipes are placed
before every observable exit that requires them, including tail calls and
noreturn calls when the called boundary can observe memory or registers covered
by the policy.

## Tail Calls And Sibling Calls

Tail-call eligibility requires:

- ABI-compatible public boundary or finalized private convention
- no pending cleanup, wipe, or restore obligation that must occur after the call
- outgoing arguments can be placed without clobbering live values
- SP alignment and frame teardown are legal at the branch point
- IP0/IP1 and veneer policy are satisfied
- target surface permits the branch/call form
- security and constant-time obligations survive the edge

If any condition fails, the backend emits an ordinary call plus epilogue or a
deterministic unsupported diagnostic when the source operation requires tail
semantics.

## Unwind Planning

Unwind planning is produced from frame layout, not guessed from final bytes. The
unwind plan records:

- frame size and adjustment sequence
- saved register locations
- frame pointer setup when present
- epilogue regions
- tail-call and noreturn treatment
- vector low-lane save/restore records
- security wipe records relevant to diagnostics
- mapping to PE/COFF AArch64 unwind serialization requirements

Frame layout and prologue/epilogue generation are constrained by the unwind
catalog. The backend may emit only one of these unwind classifications:

- `frameless-leaf`: no stack adjustment, no callee-save stores, no unwind body;
  the object still records the classification deterministically
- `serializable-unwind`: prologue and epilogue use a catalog template that maps
  to PE/COFF ARM64 `.xdata` unwind opcodes
- `unreachable-body`: function has no observable return path and still records
  enough frame/security metadata for diagnostics

Any non-leaf function, stack-adjusting function, callee-save function, vector
save function, or function with security wipe slots must use
`serializable-unwind` unless the authenticated target surface declares a more
specific final-image rule. The frame builder chooses from serializable templates
up front. It must not generate arbitrary prologue/epilogue instruction shapes
and hope the later PE/COFF writer can describe them. If no unwind-catalog
template can represent the required frame, backend emission fails before object
bytes are returned.

The object writer carries internal unwind records forward. The later PE/COFF
writer serializes them to the final format and treats any missing mapping as a
backend verifier bug.

## Physical Instruction IR

After register allocation and frame layout, machine instructions become physical
instruction IR. Physical instructions contain:

- opcode identity from the encoding catalog
- physical register operands and alias-set information
- immediate operands with signedness, width, scale, and range metadata
- memory operands with final base register, offset form, access width,
  alignment, memory type, and effect ordering
- branch and call targets as symbols, blocks, fragments, or relocation
  references
- NZCV, FPCR/FPSR, vector-state, memory, and call dependency summaries
- relocation-hole descriptors for operands owned by relocation records
- provenance and fact-spending records
- security labels relevant to final physical shape

Physical instruction IR has no virtual registers, abstract frame objects,
unresolved pseudos, or unowned relocation holes. If an operand cannot be encoded
or delegated to relocation/fixed-point logic, finalization fails before object
emission.

## Finalization

Finalization lowers backend pseudos and abstract operations to physical A64
forms:

- physical moves and zeroing idioms
- parallel-copy resolution artifacts
- spills, reloads, and rematerializations
- concrete frame-object addressing
- prologue and epilogue instructions
- tail-call, sibling-call, trap, and noreturn endings
- barrier instructions from memory-order facts
- ADRP/ADD, ADRP/LDR, literal LDR, MOVZ/MOVK, and constant-pool materialization
- compare/branch and conditional-select forms after NZCV pressure is known
- post-allocation load/store pair formation where security/effect rules permit
- pseudo branches whose final size is owned by layout-and-encode

Finalization may use peepholes and scheduling, but every mutation still goes
through `AArch64BackendRewriteTransaction`. A peephole that changes flags,
memory ordering, security labels, or relocation behavior must declare a transfer
plan and verifier invalidation set.

## Post-Allocation Scheduling

Post-allocation scheduling is production scope because spills, reloads, prologue
code, and rematerializations change the schedule selected by machine lowering.
The scheduler may reorder only inside legal dependency islands:

- memory dependencies and barrier domains
- volatile, MMIO, firmware, image-device, and atomic ordering edges
- call and clobber boundaries
- NZCV def/use chains
- FPCR/FPSR dependencies and FP exception observability
- vector-state ownership and helper-call boundaries
- security and constant-time regions
- relocation pair adjacency when an encoding/relocation form requires it

The tuning model may prefer pair loads/stores, load-latency hiding, short flag
chains, hot-path fallthrough, and spill clustering. It must not consult host
timing, benchmark data, scorecard baselines, or external profilers during
production compilation.

## Encoding Catalog

The encoding catalog is target-surface data. It records:

- opcode family and instruction kind
- fixed bitfields and operand bitfield positions
- register class requirements and SP/ZR permissions
- immediate ranges, scales, rotations, shifts, extensions, and masks
- condition-code encodings
- memory addressing forms
- relocation-hole ownership for patchable operands
- feature gates from the target profile
- verifier requirements and known-byte fixture IDs

Encoding is direct bitfield construction from the catalog. There is no assembly
text, assembler subprocess, string mnemonic parser, or disassembler round-trip
as production authority.

The encoder rejects:

- unsupported opcode/profile combinations
- illegal register classes
- SP or ZR use in operands that forbid them
- immediate values outside the encoding range
- unrepresentable shifted/extended operands
- unresolved frame objects or virtual registers
- relocation holes not owned by a relocation record
- instructions whose security, FP, vector, or memory-order dependencies were
  invalidated by finalization

## Relocation Model

Internal relocation records express Wrela semantics, not a serialized file
format. A later PE/COFF writer maps them to COFF AArch64 relocation records and
PE image-base relocation records when possible.

Relocation records contain:

- relocation kind and semantic family
- target symbol, section, fragment, or external reference
- encoded patch offset and patch bit range
- addend policy: in-place, explicit, paired, page-relative, or none
- range and overflow policy
- veneer eligibility and required scratch-register policy
- paired relocation relationship for ADRP/ADD, ADRP/LDR, or related forms
- section and fragment provenance
- target-writer mapping requirement

The backend emits relocation records for:

- direct branch and call targets
- conditional branch and test-branch targets when relocation is allowed by the
  target format
- ADRP page-base references
- low-12 ADD/LDR/STR references paired with page-base references
- literal loads
- absolute and relative data references
- local section references
- image-entry and firmware symbols
- veneer-capable long branch/call references

If a relocation kind cannot be mapped to the eventual PE/COFF writer for the
authenticated profile, the backend must reject it or choose a different legal
materialization before object emission.

For `wrela-uefi-aarch64-rpi5-v1`, the accepted PE/COFF-facing relocation
families are fixed before encoder work starts:

| Internal family       | Typical A64 site                   | PE/COFF mapping requirement                                  | Addend policy                       |
| --------------------- | ---------------------------------- | ------------------------------------------------------------ | ----------------------------------- |
| `branch26`            | `b` / `bl`                         | `IMAGE_REL_ARM64_BRANCH26` or backend/linker veneer handling | encoded branch immediate            |
| `branch19`            | conditional branch                 | `IMAGE_REL_ARM64_BRANCH19` when supported, else in-object    | encoded branch immediate            |
| `branch14`            | test-and-branch                    | `IMAGE_REL_ARM64_BRANCH14` when supported, else in-object    | encoded branch immediate            |
| `pagebase-rel21`      | `adrp`                             | `IMAGE_REL_ARM64_PAGEBASE_REL21`                             | paired with low-12 user             |
| `pageoffset-12a`      | `add` low-12 page offset           | `IMAGE_REL_ARM64_PAGEOFFSET_12A`                             | paired explicit or encoded low bits |
| `pageoffset-12l`      | `ldr`/`str` low-12 page offset     | `IMAGE_REL_ARM64_PAGEOFFSET_12L`                             | scale checked against access width  |
| `addr64`              | absolute 64-bit data pointer       | `IMAGE_REL_ARM64_ADDR64`                                     | explicit object addend              |
| `addr32` / `addr32nb` | 32-bit data pointer/RVA when legal | matching PE/COFF ARM64 relocation                            | explicit object addend              |
| `rel32`               | 32-bit relative data/reference     | `IMAGE_REL_ARM64_REL32`                                      | explicit object addend              |
| `section-relative`    | debug/provenance section refs      | `SECTION`/`SECREL` families when final writer permits        | explicit addend                     |

The catalog may include internal-only relocation families for pre-PE object
assembly, but each internal-only family must be resolved or lowered to one of
the PE/COFF-facing families before final image serialization.

## Layout-And-Encode Fixed Point

The central ownership rule is that layout, encoding, relocation generation,
literal pools, and veneers are one fixed-point system. Relocations need encoded
patch offsets. Encodings need final operand forms. Branch ranges need section
layout. Literal pools change section layout. Veneers change branch reach and
scratch-register clobbers. Splitting those into independent late passes creates
drift. The backend therefore has a single layout-and-encode owner that emits
encoded fragments and relocation records together.

The `AArch64LayoutEncodeFixedPoint` owner solves:

- section and fragment ordering
- instruction sizes and encoded bytes
- branch relaxation
- conditional/test-branch expansion
- literal-pool island placement
- veneer requests
- fragment alignment and padding
- relocation patch offsets
- relocation records
- object provenance for bytes and holes

The production fixed point is grow-only after tentative minimal encoding. A
decision may grow a fragment, insert an island, request a veneer, widen a branch
sequence, or add padding. It does not rely on a later shrink to make an earlier
range proof true. Optional compaction may exist only as a separate
verify-from-scratch optimization pass; success of object emission must never
depend on compaction. Stable keys prevent oscillation:

- branch site key
- target key
- relocation key
- literal value key
- literal-pool island key
- veneer key
- section fragment key

The owner iterates:

```text
build initial fragments
  -> tentatively encode all encodable instructions
  -> compute branch and literal ranges
  -> widen out-of-range branches or request veneers
  -> place or split literal-pool islands
  -> assign fragment offsets and patch offsets
  -> emit relocation records for owned holes
  -> verify all ranges and relocation mappings
  -> repeat only if a monotone layout decision changed
```

Termination requires either a stable layout or a deterministic diagnostic naming
the range, branch/literal/veneer key, section, target, and exhausted legal
expansions. The iteration bound is finite: each branch site has a finite
relaxation state machine, each literal user can request only a bounded sequence
of island splits, each veneer key is inserted at most once per source/target
policy, and each alignment fragment has a bounded padding state for the chosen
section offset. There is no fallback to an assembler or linker guess.

## Veneer Scratch Handshake

Veneer scratch clobbers are modeled before allocation. AArch64 machine lowering
and backend fact import mark every branch, call, tail call, and relocation
reference whose relocation catalog entry is veneer-eligible or range-unknown.
The ABI/call-boundary reconciliation step turns those marks into a
`potentialVeneerClobber` summary, usually IP0/IP1 according to the veneer
catalog.

The allocator treats those scratch registers as clobbered or unavailable at the
marked site even if layout later proves no veneer is needed. Layout-and-encode
may request veneers only for sites that carried a predeclared veneer policy. It
may not introduce a new scratch-register clobber after allocation. If a branch
form unexpectedly needs a veneer but was not predeclared veneer-eligible, the
fixed point fails with a backend bug or stale-catalog diagnostic rather than
silently clobbering IP0/IP1.

## Branch Relaxation

Branch relaxation handles:

- unconditional branches
- conditional branches
- compare-and-branch forms
- test-and-branch forms
- direct calls
- tail-call branches
- trap/unreachable endings when they affect fallthrough layout

The relaxation owner may choose longer sequences when short-range forms overflow.
For direct calls or jumps whose range can be delegated to a linker veneer, the
backend emits a relocation record with explicit veneer policy. For branches
where PE/COFF cannot represent the required relocation or veneer behavior, the
backend emits an in-object expansion when legal or fails deterministically.

Any expansion that introduces IP0/IP1 use, changes NZCV, touches memory, or
crosses a security boundary must be modeled as a rewrite transaction and checked
before final encoding.

## Literal Pools

Literal-pool placement is part of the fixed point. Pools are deterministic and
section-local unless the target surface declares a broader legal sharing rule.

Literal entries record:

- value bytes and alignment
- relocation requirements
- allowed users and reach ranges
- section and island key
- security restrictions
- provenance and fact authority

Secret or key material may not be placed in literal pools unless the security
catalog explicitly permits that representation. If a value has no legal literal
or rematerialization form, finalization fails.

## Veneers

Veneer policy comes from the backend target surface. The backend records veneer
requests instead of inventing ad hoc stubs:

- source call/jump site
- target symbol or fragment
- relocation kind
- range proof that required the veneer
- scratch registers and clobbers, usually IP0/IP1 according to target policy
- security and constant-time constraints
- provenance and diagnostic key

If the backend emits an internal veneer, it is an ordinary section fragment
created by the layout-and-encode fixed point. If the later linker owns the
veneer, the relocation record must say so explicitly and the allocator/call
clobber model must already have accounted for the veneer scratch registers.

## Section And Symbol Model

The internal object contains deterministic sections:

- text
- read-only data
- writable data
- BSS
- literal pools
- unwind records
- backend provenance and verification metadata

Each section contains ordered fragments. Fragments may be code, data, alignment,
literal pool, veneer, unwind, or metadata fragments. Symbols point to fragments
and offsets, not raw mutable arrays.

Symbol records contain:

- name or internal stable symbol ID
- binding and visibility
- section, fragment, and offset
- size and alignment
- function/data/literal/veneer/unwind kind
- ABI boundary classification
- final private convention ID when applicable
- provenance and source/machine subject chain

Symbol ordering is deterministic and independent of host object identity.

## Internal Object Module

`AArch64ObjectModule` contains:

- target backend surface fingerprint
- closed-image plan fingerprint
- section records and encoded fragments
- symbol table
- relocation table
- literal-pool table
- veneer table
- unwind/frame table
- backend diagnostics
- verification summary
- byte-to-provenance map
- fact-spending summary
- deterministic build metadata with no host-specific timing or path data

The object module is not a PE/COFF file. It is the input to Wrela's internal
linker and PE/COFF writer.

## End-To-End Shape

The backend pipeline is:

```text
AArch64MachineProgram
  + AArch64PreservedFactSet
  + AArch64ProvenanceMap
  + AArch64BackendTargetSurface
  + AArch64ClosedImageBackendPlan
  -> input contract verification
  -> backend fact import and shared fact-extension validation
  -> closed-image ABI plan verification
  -> ABI classification and call-boundary reconciliation
  -> virtual-register liveness and dependency import
  -> register allocation, spill/remat insertion, and move resolution
  -> stack frame layout, callee-save planning, and unwind planning
  -> prologue/epilogue, tail-call, trap, and noreturn finalization
  -> post-allocation scheduling and peephole finalization
  -> layout-and-encode fixed point
       section fragments
       tentative instruction encodings
       branch relaxation
       literal-pool placement
       veneer requests
       patch offsets
       relocation records
  -> internal object assembly
  -> final object, fact, security, unwind, and relocation verification
  -> AArch64ObjectModule
```

Relocation generation is not a later side pass. The layout-and-encode owner
emits encoded fragments and relocation records together because relocation
records need final section fragments, encoded patch offsets, addend policy,
literal-pool placement, and veneer decisions. Final verification runs after that
fixed point has reached a stable object layout.

## Repository Shape

The implementation should keep code modules small and authority-specific even
though this design is one canonical document:

```text
src/target/aarch64/
  backend/
    api/
      compile-aarch64-object.ts
      backend-target-surface.ts
      closed-image-backend-plan.ts
      diagnostics.ts
    facts/
      backend-fact-import.ts
      backend-rewrite-transaction.ts
      security-label-conservation.ts
    abi/
      abi-classification.ts
      private-convention-plan.ts
      call-boundary-reconciliation.ts
    allocation/
      liveness.ts
      interference.ts
      allocator.ts
      spill-remat.ts
      move-resolution.ts
    frame/
      frame-layout.ts
      prologue-epilogue.ts
      unwind-plan.ts
    finalization/
      physical-instruction-ir.ts
      pseudo-expansion.ts
      post-ra-scheduler.ts
      peepholes.ts
    object/
      layout-encode-fixed-point.ts
      encoding.ts
      relocations.ts
      veneers.ts
      literal-pools.ts
      object-module.ts
    verify/
      input-contract-verifier.ts
      allocation-verifier.ts
      frame-verifier.ts
      security-verifier.ts
      encoding-object-verifier.ts
```

The AArch64 target tree remains the ownership root for both virtual machine IR
and physical backend code. The shared fact-extension mechanism belongs outside
`src/opt-ir/*` and outside `src/target/aarch64/backend/*`, with OptIR, AArch64
machine IR, and the backend each instantiating it for their own subject
vocabulary. The backend must not design a third bespoke fact registry when the
generic mechanism should be shared.

## Public API

The backend public API names the backend surface and closed-image plan
explicitly:

```ts
export interface CompileAArch64ObjectInput {
  readonly machineProgram: AArch64MachineProgram;
  readonly preservedFacts: AArch64PreservedFactSet;
  readonly provenance: AArch64ProvenanceMap;
  readonly target: AArch64BackendTargetSurface;
  readonly closedImagePlan: AArch64ClosedImageBackendPlan;
  readonly diagnosticMode?: AArch64BackendDiagnosticMode;
  readonly debugArtifacts?: AArch64BackendDebugArtifactRequest;
}

export type CompileAArch64ObjectResult =
  | {
      readonly kind: "ok";
      readonly objectModule: AArch64ObjectModule;
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
      readonly verification: AArch64BackendVerificationSummary;
      readonly debugArtifacts?: AArch64BackendDebugArtifacts;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly AArch64BackendDiagnostic[];
      readonly verification: AArch64BackendVerificationSummary;
    };

export function compileAArch64Object(input: CompileAArch64ObjectInput): CompileAArch64ObjectResult;
```

Diagnostics are always returned. Optional debug artifacts may include allocation
plans, frame plans, layout traces, verifier traces, and fact-transfer graphs,
but those are not part of the primary success product. The primary success
product is `objectModule`.

## Input Contract

Before doing any mutating work, the backend verifies:

- the target backend surface is authenticated and matches the machine program
  target fingerprint
- all machine functions, blocks, instructions, operands, frame objects, symbols,
  relocation references, call sites, and fact subjects resolve exactly once
- the closed-image plan covers every private convention candidate and marks all
  public, firmware, exported, address-taken, and replacement boundaries
- machine dependencies include memory, call, NZCV, FPCR/FPSR, vector-state, and
  scheduling-barrier edges required by selected instructions
- preserved fact families have registered schemas, valid lineage, known
  invalidation behavior, and a verifier family
- security facts have label-conservation rules for every backend rewrite family
- rematerialization facts identify relocation-safe and relocation-unsafe forms
- no machine-level fact claims authority that the backend target surface does
  not support

An input contract failure returns `kind: "error"` and does not emit a partial
object module.

## Output Contract

`AArch64ObjectModule` contains:

- deterministic section fragments for text, read-only data, writable data, BSS,
  literal pools, unwind/provenance records, and backend metadata
- encoded A64 instruction bytes and data bytes
- symbol records with visibility, binding, section, offset, size, alignment,
  function/data kind, ABI boundary, and provenance
- relocation records with Wrela relocation semantics, encoded patch offset,
  addend policy, range/veneer policy, and final-writer mapping requirements
- unwind and frame records sufficient for the PE/COFF writer and diagnostics
- object-level provenance from bytes, relocations, spills, saves, frame slots,
  and veneers back to machine IR subjects and fact lineage
- verifier summaries proving that allocation, frame, security, encoding,
  relocation, unwind, and object invariants were checked after the final layout
  fixed point

The object module is still internal. Later phases own multi-object linking,
final image layout, PE/COFF serialization, EFI header generation, and PE base
relocation tables.

## Allocation And Frame Verification

The verifier checks:

- every virtual register is assigned exactly one legal physical location over
  each live segment
- no two simultaneously live values occupy aliasing physical registers
- fixed operands, tied operands, calls, returns, and special resources use legal
  registers
- public ABI boundaries satisfy AAPCS64 and UEFI rules
- private conventions appear only in the closed-image plan and match both
  caller and callee
- call clobbers are honored
- no-spill values were not spilled or rematerialized into observable storage
- wipe-on-spill slots are wiped on every required exit
- spill slots and frame objects do not overlap illegally
- SP is 16-byte aligned wherever required
- stack offsets are encodable or have legal address materialization
- callee-save registers are saved/restored exactly when required
- omitted restores, tail calls, traps, and noreturn paths are justified by
  terminal and unwind/security policies
- unwind records match the generated prologue/epilogue shape

The allocation/frame verifier invokes the shared security label-conservation
verifier for security-specific obligations instead of re-implementing its own
copy of those rules.

## Object Verification

Final object verification runs after the layout-and-encode fixed point is
stable. It checks:

- every instruction byte sequence matches the encoding catalog
- every relocation patch offset points into the encoded fragment and bit range
  it owns
- relocation addend policy matches encoded bytes and object semantics
- every branch, literal load, and veneer-controlled reference is in range or has
  a legal relocation/veneer record
- literal-pool islands are reachable by all users and do not violate section or
  security policy
- veneer scratch-register assumptions match allocation and call-clobber records
- section, fragment, symbol, and relocation ordering is deterministic
- all symbols referenced by relocations are defined or explicitly external under
  the object policy
- unwind records match final prologue/epilogue bytes and frame layout
- byte-to-provenance records cover every emitted byte and relocation hole
- no stale fact subject survives in object metadata

Object verification is the last backend gate before returning
`AArch64ObjectModule`.

## Verification Summary

Verification is an implementation obligation, not a debug convenience. The
backend runs verifier families after every mutating transaction and after final
object assembly:

- input contract verifier
- fact import and fact re-keying verifier
- closed-image ABI plan verifier
- allocation and liveness verifier
- frame, prologue/epilogue, and unwind verifier
- security label-conservation verifier
- final physical instruction legality verifier
- layout, encoding, relocation, veneer, and literal-pool verifier
- object determinism and provenance verifier

Security and constant-time obligations are owned by one label-conservation
invariant. Allocation, frame, finalization, and object verifiers may require
that invariant to have run, but they do not each re-implement their own slightly
different security rule set.

## Diagnostics

Fact diagnostics are stable and specific:

- unknown fact extension key
- malformed payload
- subject does not resolve
- subject resolves to the wrong kind
- upstream verifier family did not run
- fact lineage does not dominate the consuming use
- transfer rule missing for rewrite kind
- transfer rule rejected the rewrite
- fact would need to duplicate linear authority
- security label conservation failed
- private ABI fact conflicts with closed-image plan
- relocation or veneer fact conflicts with target surface

Allocation and frame diagnostics must name concrete blockers:

- register class and live range that cannot be allocated
- fixed operand or tied operand causing pressure
- call boundary and clobber set causing a conflict
- private convention missing from the closed-image plan
- no-spill fact that makes spilling illegal
- wipe obligation that cannot be placed on an exit
- frame object whose offset is not encodable
- callee-save or vector-state rule that cannot be represented in unwind records
- tail-call precondition that failed

Encoding and object diagnostics should identify concrete physical and object
facts:

- opcode and operand that cannot encode
- register class or SP/ZR permission violation
- immediate value and allowed range
- relocation kind and missing target-writer mapping
- branch/literal/veneer range failure
- fragment, section, and target symbol involved in a fixed-point failure
- relocation hole without owner
- relocation record without encoded patch offset
- veneer scratch-register conflict
- literal-pool security violation
- unwind record mismatch
- nondeterministic ordering source

Every diagnostic includes provenance and, when relevant, the fact or target
surface record that the backend attempted to spend.

## Testing Strategy

Production acceptance requires:

- schema import fixtures for every backend-spent fact family
- negative fixtures for unknown keys, malformed payloads, stale subjects,
  missing upstream verifier keys, invalid lineage, and private ABI escape
- property tests for transfer behavior across copy coalescing, spill insertion,
  rematerialization, block splitting, pseudo expansion, scheduling, peepholes,
  branch relaxation, literal-pool placement, and veneer insertion
- security label conservation tests for no-spill, wipe-on-spill, secret branch,
  secret table access, tail-call, noreturn, trap, and veneer paths
- provenance round-trip tests from emitted object records back to machine
  subjects and fact lineage
- public ABI classification fixtures for scalar, aggregate, FP/SIMD, indirect
  result, large aggregate, firmware call, image entry, and exported function
  boundaries
- private ABI fixtures for closed-image eligible, address-taken rejected,
  exported rejected, replacement-boundary rejected, and cross-module closed
  plans
- register-alias interference tests for x/w, SP/ZR, SIMD lane views, NZCV,
  FPCR/FPSR, and vector-state resources
- allocation property tests for live-range splitting, tied operands, fixed
  registers, call clobbers, rematerialization, spill insertion, and move
  resolution
- frame fixtures for leaf, non-leaf, large frame, pair save/restore, vector
  callee-save, outgoing arguments, noreturn, trap, and tail-call shapes
- unwind fixtures that compare internal unwind records to generated prologue and
  epilogue plans
- known-byte fixtures for every instruction encoding family used by the backend
- negative encoding tests for illegal register classes, SP/ZR permissions,
  immediates, shifts/extensions, feature gates, and unresolved operands
- relocation fixtures for branch/call, ADRP, low-12, literal load, data,
  section-relative, external, and paired relocations
- layout fixed-point tests for monotone branch widening, conditional expansion,
  test-branch expansion, literal-pool island splitting, veneer insertion, and
  alignment padding
- range-exhaustion tests that prove deterministic failure when no legal
  expansion remains
- object determinism tests for sections, symbols, relocations, bytes,
  diagnostics, provenance, allocation choices, frame offsets, and verifier
  summaries
- security tests for literal pools, veneers, branch expansion, and relocation
  materialization involving secret or constant-time regions

Where external tools are useful for test validation, they may run only in tests
as non-authoritative oracles. Production compilation does not shell out to them.

## Production Implementation Waves

The implementation may land in waves, but each wave must preserve the final
architecture and avoid temporary APIs that contradict the production contract:

1. Backend target surface authenticator and closed-image backend plan verifier.
2. Proof-to-bytes fact cascade gates: shared fact-extension extraction, OptIR
   migration to typed payload/rule metadata, machine re-keying validation,
   backend fact import, and object-provenance requirements.
3. Canonical rewrite transaction, fact transfer, provenance transfer, and
   security label-conservation skeleton.
4. Physical register model, ABI classification, public ABI verification, and
   closed-image private convention lookup.
5. Deterministic allocator with liveness, interference, splitting, coalescing,
   rematerialization, spill insertion, move resolution, and allocation
   verification.
6. Stack frame layout, prologue/epilogue generation, security wipes, tail calls,
   noreturn/trap handling, and unwind planning.
7. Physical instruction finalization, post-allocation scheduling, peepholes, and
   final instruction legality checks.
8. Encoding catalog, known-byte fixtures, and direct A64 encoder.
9. Layout-and-encode fixed point with branch relaxation, literal pools, veneers,
   relocation records, and object verification.
10. Internal object module integration, deterministic diagnostics, provenance
    dumps, and end-to-end object tests.

Each wave should keep conservative fallbacks correct, but no wave should encode
an API shape that later requires violating the one-surface, one-rewrite-owner,
one-layout-owner, or pre-emission private ABI rules.

## Risk Register

| Risk                                       | Mitigation                                                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| private ABI invalidated after emission     | require closed-image ABI finalization before backend emission; public ABI for any later-relocatable or escape-capable boundary                  |
| source target surface leaks into backend   | public API accepts `AArch64BackendTargetSurface`; one adapter authenticates backend catalogs before internals run                               |
| stale facts after physical rewrites        | all mutation flows through `AArch64BackendRewriteTransaction`; commit requires fact transfer, security transfer, provenance, and verifier plans |
| duplicated fact registry implementation    | extract shared subject-parameterized fact-extension mechanism; backend instantiates it rather than hand-rolling a third registry                |
| layout, encoding, and relocation drift     | one layout-and-encode fixed-point owner emits encoded fragments and relocation records together                                                 |
| security checks scattered across verifiers | one security label-conservation invariant owns no-spill, wipe-on-spill, secret, constant-time, and zeroization transfer                         |
| register model disagreements               | one authenticated physical register model feeds ABI, allocation, encoding, unwind, and verifier code                                            |
| deterministic compile instability          | stable IDs, sorted worklists, deterministic tie-breakers, fixed diagnostic ordering, and object determinism tests                               |

## References

- `docs/design/opt-ir-to-aarch64-machine-ir-design.md`
- `docs/design/compiler-pipeline-design.md`
- `docs/language/happy.md`
- Arm Architecture Reference Manual for A-profile A64
- Procedure Call Standard for the Arm 64-bit Architecture
- AAELF64 relocation semantics
- Microsoft PE/COFF AArch64 relocation documentation
- UEFI specification and AArch64 platform binding notes
