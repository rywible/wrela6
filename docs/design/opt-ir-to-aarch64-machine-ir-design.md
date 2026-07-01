# OptIR To AArch64 Machine IR Design

## Purpose

OptIR to AArch64 machine IR lowering is the compiler phase after OptIR
construction and optimization and before the AArch64 backend's register
allocation and encoding. It consumes one optimized OptIR program, the
preserved certified fact set that survived optimization, and an authenticated
AArch64 target surface. It returns target-owned AArch64 machine IR: virtual
registers, machine blocks, selected instructions, ABI intent records and
provisional public-boundary bindings, stack frame objects, region-backed
addresses, concrete calls and branches, materialized constants, symbol
references, and relocation references.

Optimized OptIR is the rewrite workbench's final artifact. AArch64 machine IR
is the first artifact that commits to physical target structure. This phase is
the boundary between them. It selects AArch64 instruction patterns, records ABI
intent and provisional public-boundary bindings, lowers explicit OptIR memory
regions to concrete address bases, and then performs target machine planning
over virtual registers: dependency construction, machine CSE, barrier insertion,
prefetch planning, rematerialization marking, branch/switch shaping, and
pre-register allocation scheduling. It does not allocate physical registers, lay
out final frame offsets, finalize private ABI conventions, generate encodings,
or write objects. The output still names values by virtual register so the
backend allocator owns the physical register choice, and the backend owns final
ABI reconciliation after the closed-image plan is available.

The phase has one job, expressed in four commitments:

```text
selection:
  match optimized OptIR operations to AArch64 machine instruction patterns
  use preserved facts only to choose among legal selections, never to re-prove
  produce machine IR over virtual registers with stable, deterministic shape

placement:
  lower ABI parameters, returns, and call arguments into ABI intent records and
  provisional public-boundary bindings
  lower OptIR regions to frame objects, global symbols, firmware-table bases,
  runtime-owned memory, or packet/source addresses

planning:
  construct machine dependencies, including memory, call, vector-state, and
  NZCV flag dependencies
  spend preserved facts on scheduling, pairing, prefetching, barrier placement,
  PIC page-base sharing, literal-pool planning, and rematerialization metadata

preservation:
  carry symbol references, relocation references, debug/source origins, and the
  certified facts that late target passes still need
  re-verify the lowered machine IR structurally, effectfully, and by constraint
  containment; run differential and litmus checks in test/debug soundness lanes
```

This phase consumes the selected target's data model, endian rules, ABI
classifications, fixed vector feature set, relocation kinds, and platform,
device, and runtime catalogs. For the first production target, the selected target
is intentionally narrow: `wrela-uefi-aarch64-rpi5-v1`, a UEFI AArch64 PE/COFF
image profile with a Raspberry Pi 5-class instruction set and VirtIO
device/runtime support. The instruction contract is Armv8.2-A with LSE atomics,
CRC32, AdvSIMD/FP, AES/SHA/PMULL, FP16/AdvSIMD half precision, RDM, and DotProd
required, plus a Raspberry Pi 5/Cortex-A76-like tuning model. UEFI is the boot,
image, firmware-call, and PE/COFF platform contract; VirtIO is a device/runtime
catalog used by near-term images, not a replacement for UEFI. The target profile
remains explicit and authenticated so the contract is testable, but this phase
does not initially promise a broad AArch64 feature matrix.

The phase does not consult source syntax, re-run optimization, or invent new
optimization authority. Every selection that depends on a Wrela proof must cite
a fact that is still present in the preserved fact set; a fact dropped by an
OptIR pass is gone and must not be resurrected here.

## Goals

- Lower optimized OptIR functions, blocks, SSA values, and terminators into
  AArch64 machine functions, machine blocks, virtual registers, and machine
  terminators.
- Select AArch64 scalar instruction patterns for integer arithmetic,
  comparison, boolean, select, address arithmetic, field extraction/insertion,
  load, and store operations.
- Select fixed-width `FEAT_AdvSIMD` vector instruction patterns for OptIR vector
  loads, stores, masked loads/stores, shuffles, compares, selects, and byte
  swaps when the platform/device/runtime contract permits vector register use.
- Exploit the full A64 base ISA for smart scalar selection: flexible
  shifted/extended second operands, rich addressing modes, bitfield field
  access from layout facts, and profitable `csel`/`ccmp` conditional lowering.
- Target the single authenticated `wrela-uefi-aarch64-rpi5-v1` production
  profile: a UEFI AArch64 PE/COFF image target with VirtIO device/runtime
  support over the Raspberry Pi 5 exposed instruction set used by Wrela:
  Armv8.2-A, `FEAT_LSE`, `FEAT_CRC32`, `FEAT_AdvSIMD`, FP, AES/SHA/PMULL,
  FP16/AdvSIMD half precision, RDM, and DotProd.
- Emit one instruction stream for that profile with no runtime feature
  detection, instruction variants, function multiversioning, or dispatch.
- Lower ABI parameters, returns, indirect results, and call arguments into
  target-owned ABI intent records and provisional public-boundary bindings from
  authenticated ABI facts, not from re-derived source types.
- Lower OptIR memory regions to stack frame objects, read-only or read-write
  global symbols, firmware-table accesses, runtime-owned memory, or
  packet/source addresses, preserving zero-copy validated-buffer views.
- Materialize OptIR constants into immediates, constant-pool symbols, or
  movz/movk sequences according to deterministic target planning rules.
- Lower source, runtime, and platform calls into concrete direct or indirect
  machine call sequences with ABI marshaling, ABI-correct register clobbers,
  and fact-informed memory/effect summaries.
- Preserve symbol references, relocation references, debug/source origins, and
  the noalias, ABI, layout/endian, volatility, terminal, effect, and capability
  facts that late target passes consume.
- Use preserved facts to select more aggressive but still legal machine forms:
  merged and speculatable loads, byte-reverse instructions for endian decode,
  reordering freedom from effect tokens, and known-alignment access forms.
- Use a three-tier selector: local instruction forms, multi-operation A64
  windows, and Wrela-only typed semantic-plugin dispatch over named semantic
  operations or manifest-declared certified regions.
- Run production-grade target machine planning after selection: build explicit
  machine dependencies, common and hoist PIC page bases, deduplicate literal
  pool materializations, mark rematerializable constants and addresses, insert
  required barriers, place fact-licensed prefetches, and schedule within legal
  effect islands using the production tuning model.
- Model AArch64 condition flags as an explicit singleton machine resource
  (`NZCV`) with liveness, defs, uses, and scheduling dependencies.
- Lower atomics, fences, volatile accesses, MMIO accesses, and virtio ring
  operations from explicit memory-order and region-memory-type facts, inserting
  `dmb`/`dsb` and choosing LSE acquire/release suffixes where required.
- Use branch probability, switch density, and cold/terminal edge facts when
  deciding between predicted branches, `ccmp`/`csel` chains, compare trees, and
  jump tables.
- Gate floating-point contraction, FP16, RDM, and other numerically visible
  fusions on explicit precision, contraction, rounding, and saturation facts.
- Produce deterministic machine IR and deterministic selection diagnostics.
- Verify lowered machine IR with production structural, ABI, region,
  memory-order, dependency, security, and fact-preservation verifiers; validate
  semantic soundness with differential interpreter and litmus suites in
  merge-time and debug lanes.
- Keep register allocation, frame finalization, prologue/epilogue insertion,
  instruction encoding, relocation generation, linking, and binary writing in
  later phases.

## Production Lowering Bets

This phase is where the Wrela optimization thesis either reaches the metal or
leaks away. OptIR proved that checked facts turn expensive analyses into
certified queries. Machine IR lowering proves the second half: those certified
queries survive selection and let the backend emit instruction forms a
fact-blind backend must guard, widen conservatively, or refuse. The bets here
are small and concrete, and they all consume facts the optimizer already
validated.

| Bet                               | Production commitment                                                                                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| fact-licensed memory selection    | use noalias, field-disjointness, and effect-token facts to merge adjacent loads, pair loads/stores, and reorder inside safe effect islands |
| dereferenceability-aware widening | use bounds authority and path certificates to emit wide or speculatable loads a fact-blind backend cannot prove safe                       |
| endian decode without idioms      | select `rev`/`rev16`/`rev32` directly from layout/endian facts instead of recognizing shift/or trees                                       |
| zero-copy region addressing       | lower validated-buffer reads to direct loads off the packet/source base with no copy and no re-validation                                  |
| ABI placement from facts          | place parameters, returns, and aggregates from authenticated ABI classifications, never from source-type re-analysis                       |
| effect-faithful access lowering   | emit volatile, MMIO, firmware-table, and image-device accesses exactly once, in order, never merged or reordered                           |
| terminal-aware control lowering   | lower terminal and `Never` calls to a call plus trap/unreachable, with no fabricated return path                                           |
| semantic superselection           | dispatch whole typed semantic families, not ad hoc opcode shapes: packet fields, virtio rings, checksum kernels, and classifiers           |
| Pi 5 bit-math acceleration        | use CRC32, PMULL, AES/SHA rounds, RDM, DotProd, and AdvSIMD table forms for explicit semantic operations                                   |
| proof-licensed tail removal       | eliminate scalar tails or bounds branches only when dereferenceability, padding, or vector-tail facts license it                           |
| branch-profitable validation      | choose `ccmp`, `csel`, `tbz`, `cbz`, or predicted branches from facts plus branch-probability and dependency cost                          |
| production machine scheduling     | hide load latency, cluster pairable accesses, hoist safe loads, and avoid serial NZCV chains when branches are cheaper                     |
| barrier-minimal virtio lowering   | emit the weakest correct LSE suffixes and `dmb`/`dsb` barriers from memory-order and device-region facts                                   |
| fact-licensed prefetch            | place `prfm`/streaming hints only where dereferenceability, memory type, and scheduling distance make them profitable                      |
| address-base reuse                | CSE and hoist `adrp` page bases, mark cheap addresses rematerializable, and deduplicate literal-pool entries                               |

These bets are not independent. Memory selection depends on the effect-token
and alias facts to keep reordering sound. Dereferenceability widening depends
on the same bounds authority that OptIR used to delete the runtime check.
Endian selection depends on the layout/endian facts that licensed the folded
read. The honesty boundary is identical to OptIR's: a wrong fact that licenses
a wide load is a miscompile, so this phase re-verifies the machine IR it emits
and backs selection patterns with merge-time differential tests, but it trusts
the fact answers themselves because the optimizer already validated their lineage. Hardware
ordering is not implied by compiler ordering: a preserved effect token prevents
illegal compiler motion, while memory-order and region-memory-type facts decide
which AArch64 barriers, release/acquire instructions, and device-ordering
constraints the target must emit.

This table is motivational, not the authoritative selector contract. The
canonical legality and fallback definitions live in the manifest catalog by
`patternId`; this section names why those patterns exist.

The flagship demonstration is the same zero-copy validated packet parser OptIR
ships. After this phase, its field reads are AArch64 `ldr`/`ldp` plus `rev`
sequences over the incoming packet pointer, those reads are clustered and
scheduled to hide load latency, predictable validation paths remain branches
when prediction beats `ccmp`, unpredictable validation paths collapse into
branchless flags flow, its derived-field switches use compare trees or jump
tables only when density and probability justify them, and its proof and wrapper
scaffolding has no machine instructions at all. The lowered snapshot records
the fact chain, tuning reason, and provenance that licensed each selected form,
so the same explanation that justified the OptIR rewrite justifies the machine
instruction and its placement.

## Performance Ambition

For the `wrela-uefi-aarch64-rpi5-v1` domain, the ambition is not merely respectable
code generation. The ambition is to make Wrela-native packet, virtio, checksum,
classification, validation, and region-heavy systems code the fastest code in
its class. The backend should pursue every conventional AArch64 win and every
Wrela-only certified win that preserves semantics.

This does not make performance a new source of authority. If a fact is missing,
the selector falls back. If vector state is unavailable, vector forms are
illegal. If an effect boundary is ordered, memory motion stops. The performance
contract is ruthless inside the proof boundary and conservative outside it.

## Production Scope And Milestones

This design is intentionally a full production backend design, not an MVP
reduction. The build order later in the document exists to make the work
sequenced and verifiable; it is not a statement that scheduling, memory-order
lowering, UEFI image integration, security labels, tiling, or semantic
superselection are optional for the production target. Intermediate milestones
may land in slices, but the accepted `wrela-uefi-aarch64-rpi5-v1` target is the
whole contract described here.

## Non-Goals

- This phase does not run target-independent OptIR optimization, rewrite the
  source program, or create new semantic facts. Whole-image semantic
  optimization belongs in OptIR. Target machine planning over already-selected
  AArch64 virtual-register code is in scope and required for production
  performance.
- This phase does not allocate physical registers, choose spill slots, lay out
  final stack frame offsets, or insert prologues and epilogues. It emits
  virtual registers, frame objects, scheduling constraints, rematerialization
  metadata, and machine dependencies for the allocator and final backend.
- This phase does not encode instructions, generate or apply relocations, lay
  out sections, resolve symbols, link, or write the final object or image. It
  emits relocation references, not relocations.
- This phase does not accept or reject programs, re-run proof or resource
  checking, re-prove requirements, or recover source intent from syntax.
- This phase does not re-derive type layout, ABI classification, reachability,
  or generic instantiation. It consumes authenticated layout/ABI facts and
  target catalog entries.
- This phase does not create new optimization authority and never resurrects a
  fact that an OptIR pass dropped. It reads only the preserved fact set.
- This phase does not reorder, merge, widen, or vectorize volatile, MMIO,
  firmware-table, image-device, terminal, or platform-effect accesses unless
  the selected target contract explicitly permits that machine form.
- This phase does not consult optimization scorecard baselines, benchmark data,
  host timing, or offline search results during production compilation.
- This phase does not narrow the architectural register-clobber set of an
  ordinary AAPCS64 call based on memory-effect facts. External ABI calls clobber
  the ABI caller-saved register set; only compiler-owned internal calls under a
  declared custom convention may carry narrower register clobbers.
- This phase does not emit instruction variants, runtime feature detection,
  feature dispatch, function multiversioning, runtime code generation, or JIT
  specialization. Production lowering targets the single declared
  `wrela-uefi-aarch64-rpi5-v1` profile and emits one instruction stream.
- This phase does not detect features at compile time or run time. The target
  profile is a declared, authenticated input; running an image on a core that
  does not satisfy it is a deployment error, not a compiler concern.
- This phase does not initially support an Armv8.0-A or Cortex-A53-class
  fallback, a no-LSE fallback, SVE/SVE2 scalable-vector lowering, mandatory
  pointer authentication, mandatory BTI, mandatory MTE, or a cross-product
  feature matrix. Those require an explicit later profile design.
- This phase does not introduce a shared target-independent LIR. AArch64
  machine IR is target-owned while AArch64 is the only backend. A generic LIR
  is deferred until a second backend or a clearly repeated lowering abstraction
  below OptIR justifies it.
- This phase does not own the UEFI image entry ABI, PE/COFF image format, or
  firmware startup thunk. The UEFI AArch64 target module supplies the
  compiler-owned entry shim for the selected `.efi` loader contract; this phase
  lowers ordinary functions and the image boot function the shim calls. VirtIO
  device access is lowered through device/runtime catalog entries after UEFI has
  supplied the image entry context.

## Selection And Backend Boundary

The implementation sequence lists both "OptIR To AArch64 Machine IR" and a
following "AArch64 Backend" phase, and both mention instruction selection. This
design draws the boundary explicitly so the two phases do not overlap:

```text
this phase (OptIR -> AArch64 machine IR):
  instruction selection into machine IR over virtual registers
  ABI intent records and provisional public-boundary bindings for parameters,
    returns, and call arguments
  region lowering to frame objects, symbols, and address bases
  constant materialization and terminator/branch lowering
  target machine planning before register allocation:
    dependency graph construction for registers, memory, calls, barriers, NZCV
    post-selection machine CSE, including `adrp` page-base sharing
    literal-pool planning and rematerialization metadata
    LSE ordering suffix choice and explicit barrier insertion
    fact-licensed prefetch placement
    pre-register-allocation scheduling inside legal effect islands
    branch and switch shaping from probability, density, and tuning facts
  symbol references and relocation references (symbolic, not generated)
  fact preservation and machine-IR verification

AArch64 backend (later phase):
  register allocation of virtual registers to physical registers
  final stack frame layout and offset assignment
  prologue and epilogue generation
  post-register-allocation schedule repair and hazard cleanup that preserves
  the machine dependencies emitted by this phase
  branch relaxation if needed
  instruction encoding
  relocation generation
```

The dividing artifact is the virtual register. This phase produces machine
instructions whose operands are virtual registers, immediates, frame-object
references, and symbol references. The backend consumes that machine IR and
assigns physical registers and encodings. Selection and pre-register-allocation
planning are owned here because preserved facts still decide legality, motion,
ordering, and profitability. Allocation, frame finalization, post-allocation
cleanup, and encoding are owned later because they depend on physical registers
and final layout. The later backend may improve placement only inside the
dependency and ordering constraints this phase emits; it must not recover a
dropped fact or move through a barrier, ordered memory edge, call clobber, or
live `NZCV` dependency.

## Trusted Computing Base

This phase must be honest about what its verification proves. The production
machine-IR verifier proves that the lowered machine IR is well-formed, that
every virtual register use has a definition, that ABI and frame references are
consistent, that `NZCV` flag live ranges are explicit, that effect-ordered
accesses keep their order, and that hardware barriers satisfy the target
memory-order facts. The merge/debug soundness lane can additionally show that
selected pure and effectful fragments evaluate to the same values and memory
state as the source OptIR fragments under the machine-IR and OptIR interpreters.
Neither lane is a proof that every selection pattern in the catalog is a sound
refinement of its OptIR operation.

Production lowering trusts:

- the optimized OptIR program, its operation semantics, and the preserved fact
  set produced by OptIR optimization, including fact lineage
- the authenticated AArch64 target surface: ABI classification rules, register
  classes, relocation kinds, fixed vector feature set, and platform, device, and
  runtime catalogs, each authenticated by fingerprint
- the reviewed instruction-selection pattern catalog and its `fact gate =>
machine form` choices
- the reviewed ABI-lowering, region-lowering, call-lowering, memory-order,
  scheduler, barrier, and prefetch-placement rules
- the machine-IR interpreter only as merge/debug soundness evidence, never as a
  substitute for production structural, constraint, memory-order, or fact
  verification

Merge gates trust:

- the machine-IR interpreter, including its memory, effect-token, barrier, and
  `NZCV` state, and the OptIR interpreter used for differential selection tests
- deterministic generators and fake target/ABI/relocation/firmware surfaces
- selection-pattern, scheduler, memory-order, and barrier soundness fixtures

Selection-soundness tests are required merge gates, not production authority. A
selection pattern whose fact gate is wrong can still miscompile; the design
therefore keeps the pattern catalog closed, typed, reviewed, differentially
tested, and replayable. Scheduler and CSE passes have the same status: they may
spend only machine dependencies and preserved facts that this phase explicitly
carries. Production authority is the checked input, the preserved facts, and the
reviewed lowering implementation. Source proof text, stdlib identity, scorecard
baselines, host timing, and successful past lowering runs are not authority.

### Verification Limits And Hardening

The verification story must not pretend to close loops it cannot close.
Production lowering does not perform full per-compilation translation validation
from OptIR to machine IR. It verifies structure, facts, dependency preservation,
required-constraint containment, and pattern composition; selected-fragment
behavior is checked by the merge/debug soundness lane. Both lanes still trust
the reviewed pattern catalog and target memory model.

Three limits are explicit:

- a sequential machine-IR interpreter cannot prove AArch64 concurrency behavior;
  missing acquire/release ordering or a too-weak barrier may be invisible under
  sequential execution
- a scheduler verifier that checks only "the schedule preserves the dependency
  graph" is insufficient unless the dependency graph itself is independently
  checked for required edges
- merge-time pattern fixtures do not prove that every composition of patterns on
  an arbitrary production program is semantically equivalent

The hardening requirements follow from those limits:

- memory-order lowering has an axiomatic/litmus-test suite for the target memory
  model, VirtIO publication patterns, MMIO ordering, LSE suffix selection, and
  UEFI firmware/device boundaries; the sequential interpreter is only a value
  and single-thread state check
- the dependency-graph verifier recomputes a conservative required-edge set from
  preserved alias, region, effect, may-trap, call, barrier, `NZCV`, vector-state,
  security, and memory-order facts, then proves the scheduler graph contains
  those edges before schedule preservation is checked
- the tiling verifier checks the actual selected covering for each lowered
  function: no overlapping consumed operations, no uncovered reachable
  operations, no duplicated effects, no missing live-outs, and no superpattern
  boundary mismatch
- debug and scorecard builds may run larger end-to-end differential fixtures for
  selected functions, but those fixtures are test evidence, not production
  authority

This keeps the TCB honest: barrier sufficiency lives in the reviewed memory-model
table plus litmus fixtures; schedule legality lives in both dependency-edge
completeness and schedule preservation; pattern composition lives in the closed
tiler and verifier, not in wishful local peephole reasoning.

The implementation has two verification lanes:

| Lane                       | Runs during normal production lowering                | Authority and purpose                                                                                                                                                                                                                              |
| -------------------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| production verifier lane   | yes                                                   | Structural well-formedness, A64 instruction legality, ABI placement, region/effect preservation, memory-order containment, required-constraint containment, security metadata, fact lineage, deterministic IDs, and target-surface authentication. |
| merge/debug soundness lane | no, except when explicitly requested by debug tooling | Machine-IR interpreter comparisons, OptIR-vs-machine selected-fragment differential checks, AArch64/VirtIO/UEFI litmus suites, selection-pattern soundness fixtures, scheduler stress fixtures, and large explanation traces.                      |

`AArch64LoweringOptions` may request merge/debug soundness artifacts, but an
option may not make their success a replacement for the production verifier
lane. Conversely, production lowering does not depend on a sequential
interpreter to prove concurrency, memory-model, or whole-program translation
correctness.

## Repository Shape

```text
src/
  target/
    aarch64/
      machine-ir/
        ids.ts
        machine-program.ts
        machine-function.ts
        machine-block.ts
        machine-instruction.ts
        operands.ts
        resources.ts
        memory-order.ts
        schedule.ts
        rematerialization.ts
        virtual-register.ts
        frame-object.ts
        abi-location.ts
        symbol-reference.ts
        relocation-reference.ts
        machine-types.ts
        provenance.ts
        diagnostics.ts
        deterministic-ids.ts

      lower/
        lower-program.ts
        lower-function.ts
        lower-block.ts
        abi-lowering.ts
        region-lowering.ts
        call-lowering.ts
        constant-materialization.ts
        memory-order-lowering.ts
        barrier-lowering.ts
        terminator-lowering.ts
        fact-preservation.ts
        provenance-builder.ts

      select/
        selection-context.ts
        pattern-catalog.ts
        local-selector.ts
        window-selector.ts
        semantic-superselector.ts
        production-profile.ts
        profile-authentication.ts
        errata-catalog.ts
        scalar-selection.ts
        addressing-selection.ts
        bitfield-selection.ts
        memory-selection.ts
        endian-selection.ts
        compare-select-selection.ts
        constant-materialization.ts
        vector-selection.ts
        table-shuffle-selection.ts
        checksum-fingerprint-selection.ts
        classifier-selection.ts
        virtio-ring-selection.ts
        packet-superpatterns.ts
        tail-proof-selection.ts
        profitability-policy.ts
        branch-profitability.ts
        switch-lowering-policy.ts
        selection-policy.ts

      plan/
        machine-dependency-graph.ts
        post-selection-cse.ts
        adrp-page-base-cse.ts
        literal-pool-planning.ts
        rematerialization-marking.ts
        prefetch-planning.ts
        pre-ra-scheduler.ts
        pair-load-store-planning.ts
        barrier-placement.ts
        schedule-profitability.ts

      verify/
        machine-ir-verifier.ts
        abi-verifier.ts
        region-verifier.ts
        fact-preservation-verifier.ts
        superselection-verifier.ts
        nzcv-verifier.ts
        memory-order-verifier.ts
        scheduler-verifier.ts

      interpreter/
        machine-ir-interpreter.ts
        machine-memory-state.ts
        machine-effect-state.ts
        machine-ir-differential.ts

      public-api.ts
      index.ts

tests/
  support/
    target/aarch64/
      machine-ir-fakes.ts
      optimized-opt-ir-fixtures.ts
      aarch64-target-surface-fakes.ts
      machine-ir-interpreter-fixtures.ts

  unit/
    target/aarch64/
      machine-ir-model.test.ts
      scalar-selection.test.ts
      addressing-selection.test.ts
      bitfield-selection.test.ts
      memory-selection.test.ts
      endian-selection.test.ts
      vector-selection.test.ts
      window-selector.test.ts
      semantic-superselector.test.ts
      packet-superpatterns.test.ts
      virtio-ring-selection.test.ts
      checksum-fingerprint-selection.test.ts
      classifier-selection.test.ts
      tail-proof-selection.test.ts
      machine-dependency-graph.test.ts
      post-selection-cse.test.ts
      adrp-page-base-cse.test.ts
      literal-pool-planning.test.ts
      rematerialization-marking.test.ts
      prefetch-planning.test.ts
      pre-ra-scheduler.test.ts
      pair-load-store-planning.test.ts
      barrier-placement.test.ts
      memory-order-lowering.test.ts
      production-profile.test.ts
      profile-authentication.test.ts
      errata-gating.test.ts
      abi-lowering.test.ts
      region-lowering.test.ts
      call-lowering.test.ts
      constant-materialization.test.ts
      terminator-lowering.test.ts
      fact-preservation.test.ts
      machine-ir-verifier.test.ts
      superselection-verifier.test.ts
      nzcv-verifier.test.ts
      memory-order-verifier.test.ts
      scheduler-verifier.test.ts
      determinism.test.ts

  integration/
    target/aarch64/
      opt-ir-to-machine-ir.test.ts
      machine-ir-interpreter.test.ts
      validated-buffer-machine-ir.test.ts
      platform-effect-machine-ir.test.ts
      deterministic-machine-ir.test.ts
```

`src/target/aarch64/machine-ir` may depend on optimized OptIR public types, the
preserved fact set public types, layout/ABI fact IDs, semantic target IDs,
shared diagnostics/source-origin types, and the authenticated AArch64 target
surface supplied by dependency injection.

It must not depend on filesystem APIs, Bun APIs, OptIR pass internals, the OptIR
optimizer, register allocator internals, the instruction encoder, the linker,
the object/image writer, or host runtime state.

The repository shape is an ownership map, not a requirement to create every
file before the machine IR model and selection core exist. Implementations may
collapse adjacent modules while preserving the public boundaries and tests.

## Public API

The phase exposes one lowering operation, plus a convenience operation for the
normal compiler pipeline:

```ts
export interface LowerOptIrToAArch64Input {
  readonly program: OptimizedOptIrProgram;
  readonly facts: OptIrFactSet;
  readonly target: AArch64TargetSurface;
  readonly options?: AArch64LoweringOptions;
}

export type LowerOptIrToAArch64Result =
  | {
      readonly kind: "ok";
      readonly machineProgram: AArch64MachineProgram;
      readonly preservedFacts: AArch64PreservedFactSet;
      readonly provenance: AArch64ProvenanceMap;
      readonly diagnostics: readonly AArch64LoweringDiagnostic[];
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly AArch64LoweringDiagnostic[];
    };

export function lowerOptIrToAArch64(input: LowerOptIrToAArch64Input): LowerOptIrToAArch64Result;
```

`AArch64LoweringOptions` may control diagnostics, debug trace capture,
merge/debug soundness harness limits, and whether optional debug-only
explanation records are retained. It must not relax the production verifier
lane, permit unsupported instructions, disable required barriers, ignore
security labels, accept stale facts, or change the production profile. Any
option that changes emitted code must be represented as authenticated
target-surface data, not as an ad hoc compilation flag.

`kind: "ok"` may include note, trace, or selection-explanation diagnostics. Any
unsupported optimized operation, missing required fact authority, missing target
ABI or relocation entry, region-lowering conflict, or machine-IR verifier
failure returns `kind: "error"`.

`OptimizedOptIrProgram` owns the optimized functions, canonical blocks and SSA
values, explicit regions and effect tokens, calls still above machine lowering,
and vector-capable operations. `facts` is the authoritative `OptIrFactSet` that
survived optimization; the program stores only `OptIrFactId` references. This
phase resolves every operation-, region-, or terminator-cited fact in that set
and never recovers a fact answer from program metadata alone. `target` is the
authenticated AArch64 surface; this phase authenticates that every ABI
classification, relocation kind, and catalog entry it uses resolves through the
selected target fingerprint.

The returned `preservedFacts` is the subset of the input fact set that remains
meaningful on machine IR, re-keyed to machine subjects. The returned
`provenance` is a snapshot of `machineProgram.provenance`, not a second source
of authority; its fingerprint must match the returned machine program.

## AArch64 Target Surface

Machine IR lowering is target-bound. The target surface supplies everything
physical the phase needs without exposing the encoder or allocator:

```ts
export interface AArch64SelectionTargetSurface {
  readonly targetId: TargetId;
  readonly selectionFingerprint: AArch64TargetFingerprint;
  readonly dataModel: AArch64DataModel; // pointer width, alignment, endian
  readonly registerClasses: AArch64RegisterClasses; // gpr, fpr/vector, predicate
  readonly profile: AArch64TargetProfile; // authenticated wrela-uefi-aarch64-rpi5-v1 profile
  readonly vectorState: AArch64VectorStatePolicy; // where AdvSIMD/FP may be used
  readonly fpEnvironment: AArch64FpEnvironment; // FPCR/FPSR policy and observability
  readonly profileModel: AArch64ProductionProfileModel; // required/excluded families, errata
}

export interface AArch64AbiTargetSurface {
  readonly abiFingerprint: AArch64TargetFingerprint;
  readonly abi: AArch64AbiSurface; // AAPCS64 argument/return/callee-save rules
}

export interface AArch64RelocationTargetSurface {
  readonly relocationFingerprint: AArch64TargetFingerprint;
  readonly relocations: AArch64RelocationKinds; // PAGE/PAGEOFF/CALL26 families
}

export interface AArch64MemoryOrderTargetSurface {
  readonly memoryModelFingerprint: AArch64TargetFingerprint;
  readonly memoryModel: AArch64MemoryModel; // ordering lattice, barriers, region memory types
}

export interface AArch64PlanningTargetSurface {
  readonly planningFingerprint: AArch64TargetFingerprint;
  readonly schedulerModel: AArch64SchedulerModel; // Cortex-A76-like latency/issue/cost tables
  readonly literalPoolPolicy: AArch64LiteralPoolPolicy; // deduplication and reachability rules
}

export interface AArch64PlatformDeviceTargetSurface {
  readonly platformDeviceFingerprint: AArch64TargetFingerprint;
  readonly imageProfile: AArch64ImageProfile; // UEFI PE/COFF entry/image contract
  readonly platformCatalog: AArch64PlatformCatalog; // UEFI firmware primitive lowering
  readonly deviceCatalog: AArch64DeviceCatalog; // VirtIO and MMIO device primitive lowering
  readonly runtimeCatalog: AArch64RuntimeCatalog; // compiler-runtime helper symbols
}

export interface AArch64TargetSurface
  extends
    AArch64SelectionTargetSurface,
    AArch64AbiTargetSurface,
    AArch64RelocationTargetSurface,
    AArch64MemoryOrderTargetSurface,
    AArch64PlanningTargetSurface,
    AArch64PlatformDeviceTargetSurface {
  readonly fingerprint: AArch64TargetFingerprint;
}
```

Each sub-surface is a closed, fingerprinted contract. The target surface
fingerprint is computed from these component fingerprints plus the production
profile name, and a lowering result records every component fingerprint it
consulted. The first implementation must supply at least these query surfaces:

Selectors, ABI lowering, relocation materialization, memory-order lowering,
machine planning, and platform/device/runtime lowering depend on their narrow
capability interfaces rather than on the full `AArch64TargetSurface`. The public
API still receives the complete production target so the compile either targets
the full `wrela-uefi-aarch64-rpi5-v1` contract or fails authentication, but unit
tests and fakes are scoped to the component being exercised. A component may not
reach sideways into another sub-surface; cross-component decisions must flow
through explicit value records in machine IR or the preserved fact set.

| Component                    | Required production queries                                                                                                                                                                             |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dataModel`                  | pointer width, pointer alignment, endianness, maximum object size, natural access alignment, and whether unaligned normal-memory access of each width is legal.                                         |
| `registerClasses`            | virtual register classes, allocatable physical class names, caller/callee-save sets by convention, tuple classes, tied-operand constraints, and implicit resource names.                                |
| `abi`                        | function parameter, return, aggregate, homogeneous aggregate, indirect-result, variadic/platform-call, stack-argument, custom internal convention, and call-clobber classification queries.             |
| `relocations`                | symbolic relocation kinds, allowed operand sites, addend rules, range preconditions, relaxation ownership, and PE/COFF image constraints for `adrp`, page-offset users, branches, calls, and tables.    |
| `profile` and `profileModel` | required features, excluded families, legal opcode families, semantic-operation support, profile rejection reasons, errata substitutions, and deterministic tuning-model identity.                      |
| `imageProfile`               | UEFI entry symbol, Wrela boot symbol handoff, image handle/system-table source locations, PE/COFF relocation assumptions, firmware-table provenance, and entry-thunk obligations.                       |
| `vectorState`                | per-function mode (`scalarOnly`, `ownsVectorState`, `callsVectorHelper`), helper eligibility, vector clobber/zeroization policy, and the prologue/epilogue obligations later backend phases must honor. |
| `fpEnvironment`              | FPCR/FPSR rounding, exception observability, flush-to-zero/default-NaN, signed-zero, NaN-payload, contraction, and helper-call assumptions.                                                             |
| `memoryModel`                | operation-order lattice, region memory type, shareability domain, barrier table, LSE suffix mapping, prefetch observability, MMIO alignment rules, and VirtIO/UEFI publication sequences.               |
| `schedulerModel`             | latency, throughput, issue class, load-use distance, branch cost, macro-fusion preferences, register-pressure penalties, vector-state cost, and deterministic tie-break costs.                          |
| `literalPoolPolicy`          | pool scope, constant equivalence, deduplication key, reachability group, section constraints, and the backend/image-writer responsibility for final pool placement.                                     |
| `platformCatalog`            | UEFI primitive symbol or table-offset resolution, firmware ABI rule, memory/effect summary, terminal behavior, and volatile/ordered access requirements.                                                |
| `deviceCatalog`              | VirtIO/MMIO region bases, queue/ring contracts, natural-alignment requirements, publication shapes, interrupt/status ordering, and device memory/effect summaries.                                      |
| `runtimeCatalog`             | helper symbol, helper ABI convention, helper memory/effect summary, vector-state ownership, security/zeroization behavior, and profile-required helper availability.                                    |

All query results are immutable value records with stable keys. If a query
would require filesystem access, host CPU probing, current time, environment
variables, or benchmark results, that query does not belong in this phase.

The target surface is the only source of physical AArch64 facts. ABI
classification rules decide where parameters and returns live. Relocation kinds
decide which symbolic relocation reference an address materialization carries.
The image profile supplies the UEFI PE/COFF entry contract, the firmware system
table handoff, image handle handling, relocation/image assumptions visible to
machine IR, and the compiler-owned entry thunk symbol that calls the Wrela image
boot function. The platform catalog decides how UEFI firmware primitives lower
to system-table function-pointer loads and indirect ABI calls. The device
catalog decides how VirtIO and MMIO device primitives lower after the UEFI image
has acquired or been handed device state. The runtime catalog decides how
compiler-owned helpers lower to call sequences. The declared target profile
fixes the machine contract that production lowering supports. For now that
contract is exactly `wrela-uefi-aarch64-rpi5-v1`; the vector-state policy decides
which functions may use AdvSIMD/FP registers; the FP environment defines FPCR/
FPSR assumptions and observability; and the production-profile model
authenticates that the surface satisfies the required features, excludes
unsupported optional families, and applies any declared implementation errata.
The phase does not query the build host or probe the eventual target CPU.

The memory model supplies the ordered forms and barriers this phase may emit:
normal versus UEFI firmware-table versus device/MMIO memory regions,
shareability domain, VirtIO transport ordering requirements, LSE
acquire/release suffix mapping, and the legal `dmb`/`dsb` sequences for fences
and MMIO publication. The scheduler model is not authority to change semantics;
it is the deterministic production-profile cost table used by selection,
scheduling, branch shaping, prefetch placement, and switch lowering. The
literal-pool policy owns pool reachability, deduplication, and placement
constraints so constant materialization and `adrp` sharing are planned
consistently before encoding.

`AArch64VectorStatePolicy` is part of the platform/device/runtime contract, not CPU
feature detection. It answers whether a function may use AdvSIMD/FP registers
directly, must stay scalar, or may call a helper that owns vector state. The
policy has three production modes:

- `scalarOnly`: the function emits no AdvSIMD/FP instructions; CRC32 GPR forms
  remain legal, while popcount, PMULL, AES/SHA, DotProd, FP16, RDM, and table
  classifiers use scalar/SWAR or runtime-helper fallbacks
- `ownsVectorState`: the function may emit AdvSIMD/FP instructions directly;
  the backend prologue/epilogue and call lowering preserve the authenticated
  ABI/platform vector-state obligations
- `callsVectorHelper`: the function itself stays scalar but may call a
  compiler-owned helper whose ABI contract owns any required vector-state save,
  restore, clobber, and zeroization behavior

There is no vague ambient "borrow." A scalar-policy function cannot temporarily
emit vector instructions just because the CPU supports them. It either owns the
state for the whole function under the target policy or calls a helper that
does.

The FP environment is also target authority. `AArch64FpEnvironment` records
FPCR/FPSR assumptions: rounding mode, flush-to-zero/default-NaN policy, whether
floating-point exception flags are observable, NaN payload preservation rules,
and signed-zero behavior. FP16, RDM, `fmadd`/`fmla`, and differential FP
fixtures are legal only under that declared environment plus the operation's
precision/contraction facts.

## Input Contract

The phase accepts one optimized OptIR program plus its preserved fact set and
validates the handoff before lowering:

- the program verifies under the OptIR structural and SSA verifiers; lowering
  does not repair malformed OptIR
- every operation is a closed, supported OptIR operation kind; an unsupported
  reachable operation is a lowering error, not a silent skip
- every `OptIrMemoryAccessDescriptor` resolves a region in the program's region
  table, and its `boundsAuthority`, `layoutPath`, `endian`, `volatility`, and
  `validatedBuffer` evidence resolve against the preserved fact set
- every atomic, fence, volatile, MMIO, firmware-table, or platform-effect access
  resolves an explicit memory-order fact and a region memory-type fact; an
  ordered effect token alone is not enough to select AArch64 hardware ordering
- every branch, switch, or validation-chain profitability decision either
  resolves branch probability/density facts or records that it used the
  conservative static fallback
- every floating-point contraction, FP16 narrowing, RDM saturating multiply, or
  other numerically visible fusion resolves an explicit contraction, precision,
  rounding, saturation, or error-bound fact
- every secret, constant-time, key-lifetime, or zeroization-sensitive operation
  resolves an explicit secrecy/security fact before branch shaping, scheduling,
  rematerialization, CSE, or spill metadata may touch it
- every call resolves a target symbol through the platform, device, or runtime
  catalog, or names an internal function symbol
- every operation-, block-, edge-, function-, region-, call-, image-, device-,
  or target-subject fact that lowering cites is present in the preserved fact
  set or authenticated target surface; a missing fact is a handoff error when no
  conservative fallback exists
- the target surface fingerprint authenticates the ABI, relocation, feature,
  and catalog entries the program references

This phase uses facts that remain valid after optimization, such as noalias,
ABI, layout/endian, volatility, terminal, effect, capability, branch-probability,
security, memory-order, vector-state, and image/device facts. It must not use a
fact that is absent from both the preserved fact set and authenticated target
surface, and it must not reconstruct a dropped fact from program metadata.

## Supported Operation Matrix

The production profile has an explicit supported-operation matrix. This resolves
the apparent tension between "unsupported reachable OptIR operations are errors"
and "every operation has a legal pattern for the profile":

- `required`: every valid optimized OptIR program for this target may contain
  the operation, and this phase must provide a deterministic legal lowering
- `fact-gated`: the operation lowers aggressively when the required facts are
  present and lowers conservatively when they are absent
- `helper-lowered`: the operation is supported only through a reviewed
  compiler-runtime, UEFI platform, or VirtIO/device helper sequence
- `profile-rejected`: the operation is meaningful in OptIR but intentionally
  unsupported by `wrela-uefi-aarch64-rpi5-v1`; reaching this phase is a target
  mismatch error
- `unreachable-after-optir`: the operation must have been eliminated or
  canonicalized by earlier phases; if it remains reachable, this phase reports a
  handoff error

The matrix is target-authenticated data and is tested with positive and negative
fixtures. Selection never infers support from a catch-all fallback. A new OptIR
operation is not production-supported until the matrix names its status, its
fallback or error behavior, and its verification fixtures.

The first production matrix covers the current OptIR operation vocabulary and
the additional semantic operation families required by this backend. The status
is part of the target profile fingerprint.

| OptIR operation family                                               | Production status         | Required lowering behavior                                                                                                                                                                                                                                        |
| -------------------------------------------------------------------- | ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `constant`                                                           | `required`                | Materialize as an inline immediate, logical bitmask immediate, `movz`/`movn`/`movk` sequence, literal-pool entry, or symbol address according to the constant's machine type and relocation requirements.                                                         |
| `integerUnary`                                                       | `required`                | Lower negate and bitwise-not to legal scalar forms, preferring flag-preserving or flag-defining variants only when the selected pattern records the `NZCV` effect.                                                                                                |
| `integerBinary` arithmetic and bitwise ops                           | `required`                | Lower add/sub/mul/and/or/xor/shift with A64 scalar forms, folded shifted/extended operands, and widening multiply forms when result types and facts require them. Division lowers to architectural divide unless a fact-gated constant-divisor sequence is legal. |
| `integerCompare`                                                     | `required`                | Lower to compare/test forms that define `NZCV` or to branch/test instructions such as `cbz`/`tbz` when the consumer boundary permits direct terminator folding.                                                                                                   |
| `booleanNot` and `booleanBinary`                                     | `required`                | Lower to canonical one-bit integer forms, masks, or selected compare/condition-code forms; short-circuit behavior must already be explicit in OptIR control flow.                                                                                                 |
| `aggregateConstruct`, `aggregateExtract`, `aggregateInsert`          | `required`                | Scalarize, tuple, or address through ABI/layout facts; sub-byte and packed-field access may use bitfield forms only when layout facts identify the bit position and width.                                                                                        |
| `layoutOffset` and `layoutByteRange`                                 | `required`                | Lower to constant or address arithmetic from authenticated layout facts; any dynamic layout expression that survives OptIR is a handoff error unless a target catalog entry explicitly owns it.                                                                   |
| `layoutEndianDecode`                                                 | `required`                | Lower to identity, `rev`, `rev16`, `rev32`, vector byte swap, or scalar shift/or fallback according to endian, width, and vector-state policy.                                                                                                                    |
| `memoryLoad` and `memoryStore`                                       | `fact-gated`              | Always have a conservative scalar access lowering for normal memory; widened, paired, reordered, volatile, MMIO, firmware, atomic, or vector forms require the matching facts and region memory type.                                                             |
| `sourceCall`                                                         | `helper-lowered`          | Lower internal calls directly when the symbol and ABI classification resolve; lower external/source-surface calls only through an authenticated internal thunk, runtime helper, or custom convention entry.                                                       |
| `runtimeCall`                                                        | `helper-lowered`          | Lower through the compiler-runtime catalog with ABI-correct register clobbers and the runtime memory/effect summary. Missing catalog entries are lowering errors.                                                                                                 |
| `platformCall`                                                       | `helper-lowered`          | Lower through the UEFI platform catalog, including system-table function-pointer loads, indirect calls, firmware memory types, and exact firmware ABI rules.                                                                                                      |
| `intrinsicCall`                                                      | `helper-lowered`          | Lower only when the target intrinsic catalog names a typed target instruction, reviewed expansion, or runtime helper; `unsupported` intrinsic entries are deterministic target-mismatch errors.                                                                   |
| `vectorLoad`, `vectorStore`, `vectorMaskedLoad`, `vectorMaskedStore` | `fact-gated`              | Direct AdvSIMD lowering requires vector-state ownership, lane legality, alignment/footprint authority, and tail/mask facts when applicable; otherwise the operation uses a scalar expansion or vector-owning helper if the matrix names one.                      |
| `vectorShuffle`, `vectorCompare`, `vectorSelect`, `vectorByteSwap`   | `fact-gated`              | Direct AdvSIMD lowering requires vector-state ownership and exact lane-shape legality; scalar/SWAR or helper fallback is required when the operation is valid in a scalar-policy function.                                                                        |
| `proofErasedMarker`                                                  | `unreachable-after-optir` | Must be removed before target lowering. If reachable, report a failed proof-erasure handoff instead of emitting an artificial machine no-op.                                                                                                                      |

Production also requires additional first-class OptIR semantic operation
families before their AArch64 instruction families are legal selection targets.
These are not optional peephole matches hidden behind `intrinsicCall`; they are
typed semantic operations or closed target-catalog entries with interpreter
semantics, fact gates, and differential fixtures:

| Required semantic family          | Why it must be first-class before AArch64 lowering                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| atomics and fences                | LSE suffixes, `ldar`/`stlr`, `dmb`/`dsb`, single-copy atomicity, and device publication cannot be inferred from ordinary `memoryLoad`/`memoryStore` plus an ordered effect token.                |
| floating-point scalar/vector math | FPCR/FPSR observability, rounding, contraction, signed-zero, NaN, FP16, RDM, and exception behavior require explicit operation semantics rather than integer-like vector placeholders.           |
| checksum and polynomial math      | CRC32 and PMULL require a named polynomial, reduction shape, initial/final xor rules, and width; arbitrary xor/shift idioms must not be silently treated as checksums.                           |
| AES/SHA/block-mix operations      | Crypto and non-crypto mixing uses must carry distinct semantic, constant-time, key-lifetime, and zeroization contracts before AES/SHA instructions may be selected.                              |
| DotProd/RDM/classifier kernels    | Dot-product and rounded doubling multiply forms require lane width, signedness, range, saturation, and error-bound facts.                                                                        |
| security-sensitive operations     | Secret values, constant-time comparisons, no-spill values, wipe-on-spill values, and zeroization stores require machine-visible labels before scheduling, CSE, rematerialization, or allocation. |

Until those semantic families exist upstream, the production profile may ship
the surrounding machine-IR infrastructure, but the corresponding instruction
families remain unreachable in selection except through reviewed runtime helper
catalog entries that carry the same semantic contract.

## AArch64 Machine IR Model

The machine IR is target-owned and sits one level below optimized OptIR:

```text
AArch64MachineProgram
  functions
  globalSymbols          // rodata/data symbol declarations with linkage
  entrySymbol            // image boot function symbol the target thunk calls
  provenance

AArch64MachineFunction
  symbol                 // function symbol with linkage
  virtualRegisters       // typed virtual regs in gpr/fpr-vector/predicate classes
  parameters             // incoming ABI intent records bound to virtual registers
  returns                // ABI return intent records
  frame                  // frame objects (sizes/alignments, not final offsets)
  blocks
  callClobberRecords     // ABI register clobbers plus fact-informed memory effects
  literalPoolPlan        // deduplicated constants and reachability groups
  schedulePlan           // pre-RA ordering regions and dependency metadata
  provenanceRefs

AArch64MachineBlock
  blockId
  parameters             // virtual-register block arguments (SSA joins)
  frequency              // optional branch-probability/frequency class
  instructions
  terminator

AArch64MachineInstruction
  opcode                 // typed AArch64 opcode form, not a free-form mnemonic
  operands               // typed def/use/tied/implicit operands
  memory                 // optional access descriptor for loads/stores
  security               // constant-time, secret, key-lifetime, zeroization constraints
  schedule               // issue class, latency class, motion boundaries, pairability
  rematerialization      // whether this producer can be rebuilt instead of spilled
  flags                  // volatile, ordered, barrier, mayTrap, terminal, artificial
  factRefs               // preserved facts needed by late passes
  origin

AArch64MachineTerminator
  branch | condBranch | switchTableOrTree | indirectBranch | call+fallthrough
  | return | unreachable | trap

FrameObject
  kind                   // incomingArg, outgoingArgArea, local, regionBacked
  size, alignment
  regionRef?             // OptIR region this object backs, when applicable

AbiLocation
  kind                   // intReg, vectorReg, indirectResult, stackArg
  index | offset

SymbolReference
  symbol, addend

RelocationReference
  kind                   // target relocation kind (PAGE, PAGEOFF, CALL26, ...)
  symbol, addend
```

Virtual registers carry a register class and a machine type, not a physical
number. Block arguments stay as virtual-register block parameters so the machine
IR remains a virtual-register SSA graph until the allocator runs. Frame objects
carry size and alignment but not final offsets. Symbol and relocation references
are symbolic; the encoder and linker turn them into bytes later.

`NZCV` is modeled as a singleton physical machine resource, not as a boolean
annotation. Instructions such as `cmp`, `subs`, `ccmp`, `csel`, `adcs`, and
`sbcs` explicitly define or use `NZCV`; schedulers, spill code insertion,
branch lowering, and post-allocation cleanup must preserve its live ranges just
as they preserve virtual-register data dependencies. Any instruction that
clobbers flags creates a real dependency edge, and any selected pattern that
threads flags records the complete producer/consumer chain.

Calls carry two separate clobber concepts. Register clobbers come from the
authenticated calling convention: ordinary AAPCS64 calls clobber the full
caller-saved GPR and vector/FP sets no matter how pure the callee's memory
effects are. Memory/effect clobbers come from OptIR capability and platform
facts and may be narrower. Only compiler-owned internal calls under an
authenticated custom convention may narrow register clobbers below AAPCS64.

The first concrete model uses discriminated records rather than stringly typed
bags. The exact TypeScript names may change during implementation, but these
shapes are semantic commitments:

```ts
type AArch64RegisterClass = "gpr32" | "gpr64" | "fpScalar" | "vector64" | "vector128";

type AArch64ScalarMachineType =
  | { readonly kind: "int"; readonly bits: 1 | 8 | 16 | 32 | 64 | 128 }
  | { readonly kind: "pointer"; readonly addressSpace: string }
  | { readonly kind: "float"; readonly bits: 16 | 32 | 64 }
  | { readonly kind: "token"; readonly token: "effect" | "nzcv" | "vectorState" };

type AArch64MachineType =
  | AArch64ScalarMachineType
  | { readonly kind: "vector"; readonly lanes: number; readonly lane: AArch64ScalarMachineType };

type AArch64MachineResource =
  | { readonly kind: "NZCV" }
  | { readonly kind: "vectorState" }
  | { readonly kind: "FPCR" }
  | { readonly kind: "FPSR" }
  | { readonly kind: "SP" }
  | { readonly kind: "platform"; readonly key: AArch64PlatformResourceKey };

type AArch64Operand =
  | { readonly role: "vreg"; readonly vreg: AArch64VirtualRegisterId }
  | { readonly role: "imm"; readonly value: bigint; readonly encoding: AArch64ImmediateEncoding }
  | { readonly role: "frame"; readonly object: AArch64FrameObjectId; readonly addend: bigint }
  | { readonly role: "symbol"; readonly reference: AArch64SymbolReference }
  | { readonly role: "relocation"; readonly reference: AArch64RelocationReference }
  | { readonly role: "literalPool"; readonly entry: AArch64LiteralPoolEntryId }
  | { readonly role: "block"; readonly block: AArch64MachineBlockId }
  | { readonly role: "resource"; readonly resource: AArch64MachineResource };

type AArch64OperandRole =
  | "def"
  | "use"
  | "tiedDefUse"
  | "implicitDef"
  | "implicitUse"
  | "memoryBase"
  | "memoryIndex"
  | "branchTarget";

interface AArch64InstructionOperand {
  readonly role: AArch64OperandRole;
  readonly operand: AArch64Operand;
  readonly type: AArch64MachineType;
  readonly registerClass?: AArch64RegisterClass;
  readonly tiedGroup?: AArch64TiedOperandGroupId;
}

interface AArch64MemoryOperand {
  readonly region: AArch64MachineRegionId;
  readonly accessKind: "load" | "store" | "atomic" | "prefetch" | "barrier";
  readonly footprint: { readonly byteOffset: bigint; readonly byteWidth: bigint };
  readonly alignment: number;
  readonly regionMemoryType: AArch64RegionMemoryType;
  readonly order: AArch64MemoryOrder;
  readonly mayTrap: boolean;
  readonly volatile: boolean;
  readonly atomicity?: AArch64Atomicity;
}

interface AArch64MachineInstruction {
  readonly opcode: AArch64OpcodeForm;
  readonly operands: readonly AArch64InstructionOperand[];
  readonly memory?: AArch64MemoryOperand;
  readonly schedule: AArch64ScheduleMetadata;
  readonly rematerialization?: AArch64RematerializationRecord;
  readonly security?: AArch64SecurityMetadata;
  readonly flags: AArch64InstructionFlags;
  readonly factRefs: readonly AArch64MachineFactId[];
  readonly origin: AArch64MachineOrigin;
}
```

The verifier derives `defs` and `uses` from operand roles, not from parallel
arrays that can disagree. An instruction with a memory operand must have exactly
one access descriptor whose footprint, memory type, ordering, volatility,
atomicity, and may-trap status are explicit. An instruction that reads or writes
`NZCV`, FPCR/FPSR, vector state, stack pointer, or a platform-defined implicit
resource records that resource as an operand with `implicitUse`, `implicitDef`,
or `tiedDefUse`; an unrecorded implicit clobber is a verifier failure.
`AArch64InstructionFlags` is the home for non-resource instruction properties:
`barrier`, `terminal`, `artificial`, and non-memory `mayTrap`. Memory-specific
volatility, ordering, and trap behavior stay on `AArch64MemoryOperand`.

### Instruction Schema And Encoding Legality

Machine IR represents only legal A64 instruction families for the selected
profile. An instruction record carries a typed opcode form, not a free-form
mnemonic string. The schema records:

- operand roles: def, use, tied def/use, implicit resource, memory base, memory
  index, immediate, symbol, relocation, frame object, literal-pool entry, and
  branch target
- register width and zero-extension behavior: W-register definitions
  zero-extend into the corresponding X-register value where A64 semantics say
  they do, and instructions that preserve high bits must say so explicitly
- immediate constraints: logical bitmask encodings, add/sub immediates,
  shift/extend limits, load/store scaled/unscaled ranges, branch ranges before
  relaxation, and relocation-compatible address forms
- vector lane shape: element width, lane count, scalar lane extraction/insertion,
  AdvSIMD arrangement, FP type, and whether FPCR/FPSR state participates
- memory access shape: access size, alignment requirement, atomicity,
  single-copy atomicity, volatility, device/firmware restrictions, and whether a
  pair/vector form is allowed
- tied operands and register tuples for operations such as i128 multiply pieces,
  ABI pair values, compare/exchange, and instructions that require the same
  physical register after allocation

An illegal A64 encoding is not represented as "opcode plus bad operands." It is
a lowering error or an ineligible pattern. The encoder may assert that every
machine instruction has already passed the instruction-schema verifier.

The opcode catalog is generated or declared from reviewed data with one entry
per legal opcode form. A catalog entry records:

- the mnemonic family and exact form name, such as `add-shifted-register`,
  `ldr-unsigned-immediate`, `ldaddal-word`, or `rev32-vector-16b`
- operand roles, machine types, register classes, tied groups, immediate
  encodings, implicit resources, and memory access shape
- required profile feature, excluded errata ranges, and any mandatory
  substitution sequence
- interpreter semantics or a reference to a closed semantic helper used by the
  machine-IR interpreter
- verifier predicates for operand ranges, relocation compatibility, lane shape,
  memory legality, and implicit clobbers

Selection chooses opcode catalog entries, not mnemonic strings. The encoder is
allowed to map a verified opcode form to bytes, but it must not reinterpret a
looser machine instruction into a different form.

## Instruction Selection

Selection maps optimized OptIR into closed, reviewed AArch64 machine forms. It
is deterministic and fact-aware, but it is not an open-ended search or an
offline autotuner. Selection is immediately followed by target machine planning,
so pattern choice and placement are designed together: a pattern that is legal
but unschedulable, too flag-serial, impossible to keep ordered, or too expensive
for the Cortex-A76-like model is not the winning production pattern. The
selector has three tiers:

- the **local selector** maps one OptIR operation to one legal AArch64 pattern
  or short fixed sequence
- the **window selector** maps small, adjacent operation windows to better A64
  forms such as load/extract clusters, folded addressing, branchless validation,
  table shuffles, or checksum loops
- the **semantic dispatch selector** maps named semantic operations or
  manifest-declared semantic regions to machine templates: validated packet
  parsers, virtio ring updates, effect-island memory schedules, proof-licensed
  vector bodies, and explicit fingerprint/mixing kernels
- each `required` local operation kind has a legal AArch64 fallback for
  `wrela-uefi-aarch64-rpi5-v1`
- every operation marked `required`, `fact-gated`, or `helper-lowered` in the
  supported-operation matrix has at least one deterministic legal lowering for
  `wrela-uefi-aarch64-rpi5-v1`; `profile-rejected` and
  `unreachable-after-optir` entries are deterministic lowering errors when they
  remain reachable
- a pattern may carry two independent gates: a fact gate (for example, a merged
  load requires field-disjointness or noalias facts) and a profile gate (for
  example, LSE atomics are legal because the production profile requires
  `FEAT_LSE`)
- a local, window, or semantic pattern is eligible only when its facts are in the
  preserved set and its required instruction family is part of the production
  profile
- when several eligible patterns exist, a reviewed local selection policy
  chooses one with stable tie-breakers, never a scorecard query
- selection is optimized for the one production profile; a richer or older
  profile is a different target design, not an implicit mode of this phase
- selection records the chosen tier, pattern, fact gate, profile gate,
  profitability reason, and rejected alternatives for debug and scorecard logs

Because AArch64 is the only backend, selection can exploit the full A64 base ISA
instead of a portable lowest common denominator. The catalog is organized by
instruction family so the smart forms are first-class, not peephole
afterthoughts.

Semantic superselection is the Wrela-only semantic dispatch tier, not a
free-form graph matcher. It is allowed to replace a whole OptIR semantic
operation, semantic-family region, or manifest-declared certified region with a
deterministic machine template only when every legality precondition is
certified by preserved facts. The preferred input is always an upstream named
semantic operation: checksum, polynomial math, AES/SHA mix, virtio publication,
classifier, fixed-vector tail plan, constant-time comparison, and similar
families must become typed OptIR operations or target-catalog entries whenever
that is possible. Certified-region dispatch is reserved for cases whose
semantics genuinely span multiple existing operations, and the manifest must
name the exact boundary. Semantic dispatch does not rediscover facts, run new
proofs, infer cryptographic meaning from idioms, or speculate from shapes alone.
If the fact bundle or semantic boundary is incomplete, it falls back to window or
local selection and records the missed superpattern in diagnostics.

### Pattern Tiling And Cross-Tier Resolution

Instruction selection is a covering problem over optimized OptIR, not a sequence
of independent peepholes. The selector builds a closed candidate set before it
emits machine IR:

1. local candidates cover one operation and exist for every `required` supported
   operation
2. window candidates cover adjacent SSA/control/effect windows with explicit
   input, output, memory, `NZCV`, and consumed-operation boundaries
3. semantic-plugin candidates cover a named OptIR semantic operation or a
   manifest-declared certified region with exact operation IDs, effect tokens,
   facts, and template boundaries

Candidates may overlap. The tiler chooses one deterministic covering per
function region using a target-profile cost model plus hard tier constraints:
an eligible semantic-plugin candidate may beat window/local candidates only when it
covers an exact named semantic boundary and preserves all external values,
effects, traps, security labels, and debug origins; otherwise it is rejected
before costing. Window candidates may beat local candidates only inside their
declared operation window. Local candidates are the total fallback for required
operations.

The covering algorithm is deterministic: candidates sort by covered operation
IDs, tier, fact gate fingerprint, profile gate, estimated cost, code-size cost,
register-pressure estimate, and stable pattern ID. If the region is acyclic and
small enough, the selector uses dynamic programming over the candidate DAG. If a
region is cyclic or exceeds the bounded tiling budget, it tiles each loop body
and effect island with the same candidate order plus a deterministic greedy
fallback. The fallback must be no less correct than local selection; it may only
miss performance.

Every selected candidate marks its covered OptIR operations as consumed and
records its live-in/live-out values, memory effects, `NZCV` resources, vector
state, security labels, and provenance. The superselection verifier rejects
overlapping consumed operations, unconsumed reachable operations, duplicated
effects, missing outputs, and templates that invent a value or effect not
present at the declared boundary.

Every window pattern and semantic-plugin candidate is declared by a manifest, not by
ad hoc selector code. A production manifest contains:

```ts
export interface AArch64SelectionPatternManifest {
  readonly patternId: string;
  readonly tier: "local" | "window" | "semantic";
  readonly dispatcher: "operationPattern" | "semanticPlugin";
  readonly semanticPluginKey?: AArch64SemanticPluginKey;
  readonly semanticOperationKind?: string;
  readonly coveredOperationKinds: readonly OptIrOperationKind[];
  readonly semanticFamily?: string;
  readonly requiredFacts: readonly AArch64FactGate[];
  readonly requiredProfileFeatures: readonly AArch64InstructionFamily[];
  readonly requiredVectorPolicy?: "ownsVectorState" | "callsVectorHelper" | "scalarOnly";
  readonly liveIns: readonly AArch64PatternBoundaryValue[];
  readonly liveOuts: readonly AArch64PatternBoundaryValue[];
  readonly consumedEffects: readonly AArch64PatternEffectBoundary[];
  readonly producedEffects: readonly AArch64PatternEffectBoundary[];
  readonly mayTrap: boolean;
  readonly securityBehavior: AArch64PatternSecurityBehavior;
  readonly fallbackPatternIds: readonly string[];
  readonly verifierFixtures: readonly string[];
}
```

The manifest is the selector's source of truth for legality and diagnostics.
Selector implementation code may compute candidates and costs, but it may not
add hidden fact gates, hidden clobbers, hidden effects, or hidden fallbacks. A
semantic template is production-legal only when its manifest names the exact
semantic boundary and every live-out and effect that crosses that boundary. If a
manifest cannot name those boundaries, the pattern stays in debug experiments
and is not part of `wrela-uefi-aarch64-rpi5-v1`.

Semantic plugins are typed dispatch modules registered by `semanticPluginKey`.
Each plugin exposes one pure candidate-construction function:

```ts
export interface AArch64SemanticSelectionPlugin {
  readonly pluginKey: AArch64SemanticPluginKey;
  readonly supportedSemanticFamilies: readonly string[];
  readonly manifests: readonly AArch64SelectionPatternManifest[];
  readonly candidatesFor: (
    input: AArch64SemanticCandidateInput,
  ) => readonly AArch64SelectionCandidate[];
}
```

A plugin may inspect only the optimized OptIR semantic operation or declared
semantic-region boundary, the preserved fact set, and the authenticated target
sub-surfaces passed to selection. It may not scan arbitrary surrounding code for
secret patterns, mutate OptIR, create facts, or call optimizer analyses. The
candidate it returns must reference a manifest by `patternId`, and the tiling
verifier checks the manifest boundary against the actual consumed operations.

The manifest catalog is the single source of truth for fact-licensed machine
patterns. Production bets, profile-selection prose, fact-driven selection prose,
diagnostics, and tests may summarize or cite patterns, but they must reference
manifest `patternId`s rather than re-defining legality in parallel. A pattern is
production-supported only when its manifest names its tier, dispatcher, fact
gates, profile gates, machine form, fallback, verification fixtures, and
security behavior.

The initial canonical pattern IDs are:

| `patternId`                         | Dispatcher         | Summary machine form                                                                                                |
| ----------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------- |
| `scalar.flex-second-operand`        | `operationPattern` | Fold legal shifts/extends into scalar arithmetic, logical, and compare forms.                                       |
| `address.folded-load-store`         | `operationPattern` | Fold legal base+immediate or base+extended-index address arithmetic into load/store operands.                       |
| `field.bitfield-extract-insert`     | `operationPattern` | Lower layout-backed bit positions to `ubfx`/`sbfx`/`ubfiz`/`sbfiz`/`bfi`/`bfxil`/`extr`.                            |
| `memory.pair-load-store`            | `operationPattern` | Form `ldp`/`stp` only under footprint, alias, ordering, alignment, trap, and volatility gates.                      |
| `memory.wide-deref-load`            | `operationPattern` | Widen or speculate normal-memory loads only when the complete machine footprint is proven dereferenceable.          |
| `endian.rev-decode`                 | `operationPattern` | Select `rev`/`rev16`/`rev32` or vector byte-swap from layout/endian facts.                                          |
| `branch.test-and-conditional`       | `operationPattern` | Select `cmp`, `ccmp`, `csel`, `cbz`, `tbz`, compare trees, and branch shapes from probability and `NZCV` costs.     |
| `constant.materialize-remat`        | `operationPattern` | Choose logical immediates, `movz`/`movn`/`movk`, literal pools, and rematerialization metadata.                     |
| `pic.adrp-page-base-cse`            | `operationPattern` | Share and hoist page bases under dominance, relocation, call, pressure, and schedule constraints.                   |
| `atomic.lse-memory-order`           | `operationPattern` | Select LSE forms, acquire/release suffixes, `ldar`/`stlr`, and required fences from memory-order facts.             |
| `prefetch.fact-licensed`            | `operationPattern` | Emit `prfm`/streaming hints only with memory-type, footprint, loop-distance, and ordered-boundary gates.            |
| `semantic.packet-zero-copy-view`    | `semanticPlugin`   | Lower validated packet/source semantic regions to direct addressed loads with preserved bounds/layout/endian facts. |
| `semantic.virtio-ring-publish`      | `semanticPlugin`   | Lower descriptor writes, avail publication, and notify/status operations with exact VirtIO ordering and MMIO gates. |
| `semantic.checksum-crc32`           | `semanticPlugin`   | Lower named checksum operations to `crc32*`/`crc32c*` when polynomial, width, and init/final rules match.           |
| `semantic.polynomial-pmull`         | `semanticPlugin`   | Lower named carryless multiply and polynomial reductions to `pmull`/`pmull2` or helper fallback.                    |
| `semantic.aes-sha-mix`              | `semanticPlugin`   | Lower explicit crypto or non-crypto mix operations to AES/SHA forms under semantic and security gates.              |
| `semantic.classifier-table-dotprod` | `semanticPlugin`   | Lower finite-alphabet classifiers to `tbl`/`tbx`, lane compares, reductions, or DotProd under bounds/range facts.   |
| `semantic.vector-tail-free`         | `semanticPlugin`   | Lower fixed-vector bodies with no scalar tail, or a certified tail form, from trip-count and footprint facts.       |
| `semantic.rdm-fp16-compact-math`    | `semanticPlugin`   | Lower RDM/FP16 compact math under range, precision, saturation, rounding, and FP-environment gates.                 |

### Production Profile Selection Catalog

These families are available in `wrela-uefi-aarch64-rpi5-v1` and are the only
instruction families production lowering initially optimizes for. The profile
is narrow on purpose: selection can assume Armv8.2-A, LSE atomics, CRC32,
fixed-width AdvSIMD/FP, AES/SHA/PMULL, FP16/AdvSIMD half precision, RDM, and
DotProd exist, and can spend its complexity budget on emitting excellent code
for that path instead of carrying fallback sequences for older
Cortex-A53/Armv8.0-A-class machines or newer SVE/SVE2 machines.

This section is a profile-oriented view of the manifest catalog. Each optimized
instruction family must be reachable from one or more manifest `patternId`s; if
the prose and manifest disagree, the manifest is the implementation contract and
the prose must be corrected.

- flexible second operand: fold a shift (`lsl`/`lsr`/`asr`/`ror`) or an extend
  (`uxtb`..`sxtw`) of one operand into `add`, `sub`, `and`, `orr`, `eor`, and
  `cmp`, so `x + (i << 3)` is one `add x, x, i, lsl #3` and a widened index
  needs no separate extend instruction
- addressing-mode matcher: fold address arithmetic into the load/store operand
  itself: base plus scaled immediate, base plus extended or shifted register
  (`ldr x, [base, index, lsl #3]`), and pre/post-index for walking pointers, so
  a validated-buffer field read is a single addressed load off the packet base
- bitfield instructions: lower layout field access directly to `ubfx`/`sbfx`
  (extract), `ubfiz`/`sbfiz` (extract and shift), `bfi`/`bfxil` (insert), and
  `extr` (field that straddles two registers). A layout fact gives the exact
  bit position and width, so an OptIR `layoutByteRange`, `aggregateExtract`, or
  sub-byte wire field becomes one bitfield instruction instead of a shift/mask
  pair
- branchless conditionals: lower select to `csel`, and the increment, invert,
  and negate variants to `csinc`/`csinv`/`csneg`/`cset`/`csetm`. Lower a chained
  short-circuit condition to a `ccmp`/`ccmn` chain only when branch probability,
  chain length, and tuning facts say the serial `NZCV` dependency is cheaper
  than predicted branches. Predictable hot-valid parser paths may stay as
  `b.cond`/`cbz`/`tbz` chains so the core can speculate past them.
- test-and-branch: lower a single-bit test to `tbz`/`tbnz` and a
  compare-with-zero to `cbz`/`cbnz`, so a validation-flag check is one
  instruction with no separate `cmp`
- constant materialization: build immediates with the cheapest legal form: a
  logical bitmask immediate folded into `and`/`orr`/`eor`, a `movz` plus up to
  three `movk` for an arbitrary 64-bit value, `movn` for inverted patterns, or
  a literal-pool symbol reached with `adrp`+`ldr` when that is smaller. Cheap
  producers are marked rematerializable so the allocator can rebuild them
  instead of spilling them.
- multiply and multiply-accumulate: `madd`/`msub`/`mneg` fuse a multiply with
  an add or subtract, `smull`/`umull`/`smaddl`/`umaddl` do widening 32x32->64
  accumulation, and `smulh`/`umulh` take the high half of a 128-bit product for
  wide-hash and checksum kernels
- division by constant catch: OptIR should normally strength-reduce constant
  `udiv`/`sdiv`, but if one reaches selection, the selector uses reviewed
  magic-multiply/shift sequences when the divisor, signedness, overflow, and
  rounding facts license them; otherwise it emits the architectural divide
- byte and bit permutation: `rev`/`rev16`/`rev32` for endian decode, `rbit` for
  bit reversal, and `clz`/`cls` (or `rbit`+`clz`) for first-set scans over a
  comparison mask
- PIC addressing: every symbol address materializes position-independently with
  `adrp`+`add` (or `adrp`+`ldr` for indirection) carrying the target
  PAGE/PAGEOFF relocation references, because the image may be relocated by the
  loader or packaged as position-independent runtime code. The machine CSE pass
  shares and hoists page bases within legal dominance, relocation, and scheduling
  constraints instead of emitting redundant `adrp` instructions for every
  access.
- LSE atomics: lower atomic read-modify-write and compare/exchange operations
  directly to `ldadd`, `stadd`, `swp`, `cas`, and related LSE forms instead of
  carrying an `ldxr`/`stxr` retry-loop fallback. The selected suffix is chosen
  from the memory-order fact: relaxed, acquire, release, or acquire-release.
  SeqCst and device/virtio ordering may require explicit barriers supplied by
  the target memory model. No-LSE targets are rejected at profile
  authentication.
- CRC32: lower checksum operations that OptIR represents semantically to
  `crc32*`/`crc32c*` forms when the polynomial and width match the instruction
  family. Unsupported checksum shapes use reviewed scalar/runtime helpers, not
  runtime feature dispatch.
- carryless multiply: lower explicit binary-polynomial operations,
  GHASH-style primitives, wide fingerprints, and supported checksum kernels to
  `pmull`/`pmull2`. This is a general bit-math lowering lever as well as a
  cryptographic primitive; the OptIR operation must name the semantic
  polynomial or mixing contract explicitly.
- AES and SHA rounds: lower explicit block-mixing, hashing, and cryptographic
  round operations to `aes*`, `sha1*`, and `sha256*` forms only when the OptIR
  operation carries the right semantic contract. Selection must not infer
  security guarantees from arbitrary integer or vector idioms.
- fixed half-precision and dot-product forms: lower eligible fixed-vector FP16,
  RDM, and int8 dot-product operations to the corresponding AdvSIMD forms when
  the function's vector-state policy permits them.
- fixed AdvSIMD/FP: lower fixed-width vector loads, stores, lane compares,
  shuffles, interleaves, reductions, byte swaps, and floating-point arithmetic
  with NEON/FP forms when the function's ABI/runtime policy permits vector
  register use. Floating-point multiply-add contraction to `fmadd`/`fmla` is
  legal only with an explicit contraction/rounding fact; otherwise separate
  operations remain separate. Kernel or low-level virtio-backed code that has
  not opted into vector state ownership remains scalar even though the CPU
  feature is guaranteed.

### Out-Of-Profile Instruction Families

The first production profile deliberately does not require MOPS, SVE/SVE2,
pointer authentication, BTI, or MTE. Lowering may call reviewed runtime helpers
or use scalar/fixed-AdvSIMD sequences when OptIR contains an operation that would
otherwise benefit from one of these families, but it must not emit those
instructions in `wrela-uefi-aarch64-rpi5-v1`. A later profile can add one of these
families only by updating the profile contract, selection tests, deployment
requirements, and backend acceptance criteria together.

### Ruthless Selection Catalog

These are production goals, not speculative research notes. Each entry is a
closed pattern family with explicit legality facts, deterministic profitability
rules, negative tests, and differential fixtures. The selector should prefer the
most aggressive legal form in Wrela's domain, then fall back cleanly when the
proof bundle is absent.

This table is a readability view over the canonical manifest catalog. New rows
must be added by first adding or updating a manifest `patternId`, then citing
that ID here; this table does not create independent legality.

| Pattern family              | Machine lever                                                                                     | Wrela authority                                                                                      |
| --------------------------- | ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| load-once field clusters    | one `ldr`/`ldp`, then `rev*`, `ubfx`/`sbfx`, `extr`, shifts, and masks for many fields            | layout byte/bit ranges, endian facts, field-disjointness, bounds authority                           |
| proof-licensed overreads    | wider `ldr`/`ldp` or vector load than the source field width                                      | dereferenceable byte range, padding/slack facts, no-fault path certificate                           |
| endian decode clusters      | hoist one `rev`, `rev16`, or `rev32` over a loaded word and extract multiple decoded fields       | wire-endian facts and exact field positions                                                          |
| branchless validators       | `ccmp`/`ccmn`, `csel`, `cset`/`csetm`, `tbz`/`tbnz`, `cbz`/`cbnz`                                 | validation-chain facts, impossibility facts, terminal edges, effect-free predicates                  |
| virtio ring atomics         | acquire/release `ldadd*`, `stadd*`, `cas*`, `swp*`, direct ring-index masking                     | virtio region facts, power-of-two queue facts, alias/effect boundaries, memory-order facts           |
| barrier-minimal publication | `stlr`, `ldar`, LSE acquire/release forms, `dmb ish*`, `dsb` only where required                  | memory-order lattice, region memory type, virtio transport ordering, platform barrier policy         |
| effect-island scheduling    | reorder, pair, and hoist loads/stores inside a pure or noalias island                             | effect-token partitioning, noalias facts, volatility/MMIO exclusion                                  |
| fact-licensed prefetch      | `prfm pldl1keep`/streaming hints and non-temporal pair forms where profitable                     | dereferenceable/prefetchable footprint, memory type, loop distance, no ordered-device boundary       |
| PIC page-base reuse         | shared/hoisted `adrp`, folded PAGEOFF users, loop-invariant page bases                            | relocation equivalence, dominance, loop facts, clobber-free schedule region                          |
| constant rematerialization  | remat `movz`/`movk`, logical immediates, `adrp` bases instead of spilling                         | materialization cost, use count, loop depth, allocator remat metadata                                |
| tail-free fixed vectors     | vector body with no scalar epilogue, or one certified masked/scalar tail                          | trip-count facts, dereferenceable tail slack, alignment facts, vector-tail plan                      |
| table/nibble classifiers    | `tbl`/`tbx`, `uaddlp`, `cnt`, `addv`, `uminv`/`umaxv`, lane compares                              | finite alphabet facts, table bounds, validated bytes, classification semantics                       |
| dot-product classifiers     | `udot`/`sdot` for byte-weighted fingerprints, scoring, and compact classifiers                    | explicit classifier/fingerprint operation, lane width facts, overflow/range facts                    |
| PMULL polynomial kernels    | `pmull`/`pmull2` for CRC folding, GHASH-style math, rolling fingerprints, binary-field transforms | explicit polynomial, chunk width, alignment, and reduction facts                                     |
| AES/SHA mix kernels         | `aes*`, `sha1*`, `sha256*` for named round/mixing operations                                      | explicit block-mix/hash/crypto operation; constant-time/key-handling contract when security-relevant |
| RDM and FP16 compact math   | `sqrdmulh`, `sqrdmlah`, FP16 AdvSIMD forms                                                        | range, precision, saturation, and error-bound facts                                                  |
| constant divisor cleanup    | magic multiply/high-half/shift sequences instead of `udiv`/`sdiv`                                 | constant divisor, signedness, range, overflow, and rounding facts                                    |
| structured AoS/SoA movement | `ld1`/`ld2`/`ld3`/`ld4`, `zip`/`uzp`/`trn`, `ext`, `tbl`                                          | layout-stride facts, alignment, noalias, vector lane facts                                           |
| bitset and mask reductions  | `cnt`, `addv`, `rbit`, `clz`, `cmeq`, `orr`/`and` reductions                                      | mask semantics, finite-width facts, impossible-lane facts                                            |
| flag-threaded switches      | compare trees, `ccmp` chains, `tbz` bit dispatch, jump tables when density facts justify them     | switch density, value-range, impossibility, and terminal facts                                       |
| probability-shaped switches | predicted compare trees, cold jump tables, hot-case split, terminal cold edge sinking             | branch probability, case density, code-size budget, cold/terminal edge facts                         |
| zero-copy packet views      | direct addressed loads from packet/source base with no copy and no re-validation                  | validated-buffer evidence, lifetime/capability facts, region provenance                              |

The nastiest valid machine form is not always the biggest instruction. The
profitability policy must account for Cortex-A76-like issue pressure, register
pressure before allocation, vector-state ownership, load-use distance, code
size, and branch prediction. The policy is deterministic and reviewed; it may
use static tables for the production profile, but it must not consult benchmark
scorecards, host timing, or offline search during compilation.

### Semantic Operation Discipline

Some Pi 5-profile instructions are powerful enough to be dangerous when treated
as peepholes. PMULL, AES, SHA, DotProd, RDM, and FP16 forms are selected only
from explicit OptIR semantic operations or from Wrela-certified superpatterns
that define the exact mathematical contract. Selection must distinguish:

- cryptographic operations, which carry constant-time, key-lifetime, and
  zeroization expectations
- non-cryptographic mixing and fingerprinting, which may use AES/SHA/PMULL as
  fast diffusion or polynomial machinery but does not claim cryptographic
  security
- approximate or saturated numeric kernels, which require range and error facts
  before FP16 or RDM forms are legal

This keeps the backend ruthless without becoming spooky. The generated code can
use exotic instructions for non-obvious purposes, but every such use has a
named semantic source, a fact gate, and a replayable explanation.

### Secret And Constant-Time Discipline

Cryptographic and security-sensitive semantics are machine-visible. If an OptIR
operation or region carries a secret, key-lifetime, constant-time, or
zeroization fact, this phase preserves that label into machine IR and treats it
as a hard legality constraint, not a profitability hint.

The policy is conservative:

- secret-dependent control flow must not lower to data-dependent branches, jump
  tables, or early exits; it uses constant-time selects, masks, fixed-trip loops,
  or reviewed constant-time helpers
- secret-dependent memory addresses must not lower to data-dependent table
  lookups unless the semantic operation and target helper explicitly certify a
  constant-time access pattern for that memory
- machine CSE and rematerialization must not extend a secret value's lifetime or
  duplicate a key-derived producer unless the security fact permits it
- values marked no-spill or wipe-on-spill carry allocator metadata; if the
  allocator must spill them, the spill slot is a scrubbed frame object with an
  explicit zeroization plan
- dead-store elimination, store pairing, scheduling, and epilogue insertion must
  preserve zeroization stores and may not move them before the last secret use
- vector helpers that process secrets own their vector-state clobbers and
  zeroization behavior in the helper ABI contract

Branch profitability, switch lowering, prefetch insertion, and table selection
all consult these labels before ordinary cost. A predictable secret comparison
stays constant-time even if an ordinary branch would be faster.

### Fact-Driven Selection

The preserved facts are what let AArch64 selection beat a fact-blind backend.
Each fact licenses a machine form that is legal only because the optimizer
already proved the precondition:

This table maps fact kinds to manifest gates. It does not define pattern
legality separately from the manifest catalog.

| Preserved fact                             | AArch64 selection lever                                                                                      |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| noalias / field-disjointness               | merge adjacent field loads into `ldp`, pair stores into `stp`, reorder only inside safe effect islands       |
| effect-token ordering                      | build compiler memory-dependency edges; schedule within an effect island but never cross an ordered boundary |
| bounds authority + path certificate        | emit a wide or speculatable `ldr` for a known-dereferenceable range; no guard branch                         |
| dereferenceable footprint fact             | prove the whole widened, paired, vector, or prefetch footprint is contained in accessible memory             |
| alignment fact                             | choose an aligned load/store form, or a known-safe unaligned form, without a runtime check                   |
| layout/endian decode fact                  | select `rev`, `rev16`, or `rev32` directly, or a load-then-reverse, with no idiom matching                   |
| layout field position/width fact           | extract or insert the field with one `ubfx`/`sbfx`/`bfi`/`extr`, not a shift/mask pair                       |
| validation-chain / impossibility facts     | make branchless lowering legal; profitability still depends on branch probability and NZCV cost              |
| branch probability / cold-edge facts       | choose predicted branches, `ccmp`, hot-case split, block order, and switch shape                             |
| validated-buffer evidence                  | address the load off the packet/source base with no copy and no re-validation                                |
| ABI classification fact                    | place the value in the exact AAPCS64 location without re-analyzing the source type                           |
| volatility / MMIO / firmware-table         | emit exactly one ordered access; never merge, widen, reorder, or vectorize                                   |
| terminal / `Never` reachability            | lower the call to `bl`/`blr` plus `trap`/unreachable, with no return path                                    |
| capability / platform effect summary       | refine memory/effect dependencies around calls; never narrow AAPCS64 register clobbers                       |
| vector lane facts (bounds/tail/effect)     | select NEON loads/stores/compares, with masked or scalar-tail forms from the tail plan                       |
| trip-count / padding / tail facts          | eliminate scalar vector tails or select one certified tail form without runtime probing                      |
| polynomial / checksum facts                | select CRC32 or PMULL folding with the exact polynomial and reduction sequence                               |
| classifier / finite alphabet facts         | select `tbl`/`tbx`, DotProd, or lane-compare classifiers with bounded table access                           |
| vector-state policy facts                  | emit AdvSIMD/FP/crypto/vector forms only in functions that own vector state or call vector-owning helpers    |
| memory-order and region memory facts       | choose LSE suffixes, `ldar`/`stlr`, `dmb`/`dsb`, and no-motion boundaries for weak ordering                  |
| FP contraction / rounding facts            | select `fmadd`/`fmla`, FP16, or reassociated forms without changing numeric contracts                        |
| range / precision / saturation facts       | select FP16, RDM, or saturating AdvSIMD forms without changing numeric contracts                             |
| secret / constant-time / zeroization facts | forbid data-dependent branches, unsafe table access, unsafe remat/spill, and lifetime extension              |

Selection consumes these as legality gates, not as hints to second-guess. If a
required fact is absent from the preserved set, selection falls back to the
conservative pattern: a guarded or narrow load, a scalar loop body, an
unmerged access. It never fabricates the fact, and it never widens or reorders
an access whose licensing fact was dropped.

The soundness boundary is explicit. A wide load selected because a bounds fact
claimed a 16-byte range was dereferenceable is a miscompile if that fact was
wrong. This phase does not re-prove the fact; the optimizer validated its
lineage. This phase instead re-verifies that the machine IR it emits is
structurally consistent and that pure and effectful selected fragments match the
OptIR interpreter, and it keeps the pattern catalog closed and differentially
tested so a wrong gate is caught at merge time. The widened-access rule is exact:
the complete machine footprint, including unused bytes from a widened scalar
load, every byte of an `ldp`, every vector lane, and every planned prefetch
address range when the target treats prefetch as potentially observable, must be
contained in the preserved dereferenceable or prefetchable footprint.

## Placement, Scheduling, And Machine Planning

Production AArch64 performance depends on placement as much as selection. This
phase therefore owns a deterministic pre-register-allocation planning pipeline
after local/window/semantic selection:

1. build a machine dependency graph over virtual registers, memory regions,
   ordered effect tokens, barriers, calls, `NZCV`, vector-state ownership, and
   may-trap operations, security labels, and errata constraints
2. run post-selection machine CSE for identical cheap producers, symbol page
   bases, literal-pool loads, and repeated address materializations
3. mark rematerializable producers such as logical immediates, `movz`/`movk`
   constants, `adrp` page bases, frame-object address components, and other
   cheap pure address arithmetic
4. plan load/store pairing and clustering inside legal effect islands, including
   reordering adjacent field loads so `ldp`/`stp` forms become available when
   alias, alignment, footprint, and trap facts allow it
5. insert required acquire/release, fence, device, and virtio barriers before
   the scheduler runs, then treat them as hard motion boundaries
6. place software prefetches and streaming hints only when the memory type,
   dereferenceability/prefetchability facts, loop distance, and tuning model
   justify them
7. schedule each block or effect island with the `cortex-a76-rpi5-like` model,
   then emit the schedule plan and dependency metadata consumed by register
   allocation and post-register-allocation cleanup

The scheduler is not a global semantic optimizer. It may move only instructions
whose machine dependency edges permit motion. Its job is to spend already-proven
freedom: hide load latency, keep address generation ahead of loads, cluster
pairable accesses, keep `adrp` page bases out of hot inner-loop bodies when
legal, preserve macro-fusion-friendly compare/branch adjacency where the tuning
model wants it, preserve errata workaround spacing/ordering, avoid overlong
serial `NZCV` chains, and keep register pressure below the point where spills
erase the win.

The tuning model is a required production input, not decorative metadata. It
provides stable tables for approximate latency, throughput, issue class, load-use
distance, branch cost, pair-load/store preference, vector-state cost, code-size
weight, and register-pressure penalties. The policy can be brutally tuned for
the Raspberry Pi 5/Cortex-A76-like core because the production profile is narrow.
It must still be deterministic: no host benchmarking, no online search, and no
scorecard query during compilation.

Errata workarounds are schedule constraints as well as selection substitutions.
If the errata catalog replaces an instruction or forbids an adjacency, the
planner records a hard constraint in the dependency graph and the scheduler
verifier re-checks the final pre-RA schedule. Post-register-allocation cleanup
must preserve or re-validate the same errata constraints.

### Machine CSE, Rematerialization, And Literal Pools

`adrp` page-base sharing is mandatory. The planner groups symbol references by
relocation page, dominance, loop depth, and motion legality. It hoists or shares
one page base when doing so reduces dynamic work without increasing register
pressure beyond the model's threshold; otherwise it leaves the address local and
marks it rematerializable. `adrp` sharing never crosses a call clobber unless
the value is saved or cheaply rebuilt, and never crosses a relocation or section
boundary the literal-pool policy rejects.

Literal pools are planned per function unless the image writer later owns a
larger deduplication unit. This phase deduplicates identical constants within
the pool, records reachability groups, and emits symbolic references rather than
final pool offsets. Constants and address producers carry a rematerialization
cost so the allocator can prefer rebuilding a cheap value over spilling it.

The register allocator and final backend receive hard obligations from this
phase, not advisory comments:

- virtual registers have fixed register classes, machine types, security labels,
  and rematerialization metadata; allocation may choose physical registers only
  inside those classes
- tied operands, register tuples, compare/exchange operands, ABI pair values,
  and multi-register results must remain physically tied or adjacent exactly as
  the instruction schema requires
- `NZCV`, vector state, FPCR/FPSR, stack pointer, and platform-defined implicit
  resources are real live resources; spill insertion and post-allocation cleanup
  may not clobber them without inserting and verifying replacement dependencies
- barriers, volatile/MMIO/firmware accesses, atomics, terminal calls, and
  security zeroization stores are hard motion boundaries unless a target rule
  explicitly proves a narrower motion legal
- no-spill and wipe-on-spill metadata must either be satisfied or reported as a
  backend error; a backend may not silently spill a no-spill value or leave a
  wipe-on-spill slot unscrubbed
- frame objects carry required size, alignment, lifetime, mutability, region,
  security, and outgoing-argument-area roles; final offset assignment may not
  merge or reuse objects whose region, ABI, or security facts forbid it
- rematerialization is permitted only for producers whose record names all
  required facts, symbols, relocation references, and implicit resources; the
  allocator may rebuild such a producer but may not invent a cheaper equivalent
  not selected by this phase
- post-register-allocation scheduling and branch relaxation must re-run the
  dependency, memory-order, errata, security, and `NZCV` preservation checks for
  any instruction it moves, inserts, deletes, or expands

The handoff is therefore a contract: later backend passes may improve physical
placement and repair hazards, but they cannot weaken the selected instruction
schema, fact gates, memory order, or security obligations.

### Branch, Switch, And If-Conversion Profitability

Branchless is a tool, not a religion. A `ccmp` chain serializes through `NZCV`;
a hot, highly predictable validation path may be faster as ordinary branches
because the core can speculate past it. The profitability policy therefore uses
branch probability, cold-edge, terminal-edge, chain-length, and tuning-model
facts before selecting `ccmp`/`csel`. When probability facts are missing, the
policy uses conservative static heuristics: short unpredictable diamonds may
if-convert, long validation chains stay branchy unless terminal/impossibility
facts make the branchless form clearly smaller and no slower.

Switch lowering uses explicit density and probability criteria. Dense hot
switches may use jump tables when the indirect branch cost and BTB pressure are
worth the code-size win. Sparse or highly biased switches use compare trees,
`tbz`/`tbnz` bit dispatch, hot-case splitting, and cold terminal edge sinking.
The chosen switch shape records its density, probability, and code-size reason.

### Prefetch And Streaming Access Planning

Software prefetch is a Wrela-native opportunity because preserved bounds,
layout, stride, and loop facts can license prefetch placement more precisely than
shape-only code generation. The planner may emit `prfm` hints for streaming
packet, checksum, classifier, copy, and ring-walk kernels when all of these hold:
the target memory model permits prefetch for the region type, the prefetched
footprint is inside a preserved prefetchable/dereferenceable range or the target
declares the hint non-faulting for that region, the access is far enough ahead
to hide latency, and the hint does not cross an ordered device or MMIO boundary.
Non-temporal pair forms such as `ldnp`/`stnp` are eligible only when reuse facts
and the target model say they are a win.

## Memory Ordering, Barriers, And LSE Atomics

AArch64 compiler ordering and AArch64 hardware ordering are different contracts.
An OptIR ordered effect token prevents the compiler from merging, deleting, or
reordering the affected accesses. It does not make the CPU publish normal memory
to a device, order an MMIO notification after ring writes, or choose acquire
semantics for an atomic read. Production lowering therefore requires explicit
memory-order facts and region memory-type facts for every atomic, fence,
volatile, MMIO, firmware-table, and virtio operation.

The OptIR-to-machine handoff must distinguish at least:

- operation ordering: relaxed, acquire, release, acquire-release, sequentially
  consistent, device-ordered, and compiler-only ordered
- region memory type: normal cacheable memory, device/MMIO memory, firmware
  table memory, runtime-owned memory, and external/conservative memory
- shareability and barrier domain: the target memory model decides whether the
  correct barrier is an inner-shareable `dmb ish*`, a stronger `dsb`, or a
  platform-specific sequence
- publication shape: ring descriptor writes, avail index publication, used-ring
  observation, device notification, interrupt/status read, and ordinary
  synchronization are distinct platform operations

Memory-order and region-memory-type facts are originated by semantic operations,
platform primitives, runtime catalog entries, UEFI firmware contracts, device
catalog entries, and explicit atomic/fence operations. They are authenticated
semantic declarations, not facts the optimizer proves from arithmetic. Earlier
passes validate that each declaration is well-formed, preserved through OptIR,
and attached to the correct operation, region, call, or device subject. This
phase trusts the authenticated declaration and never infers ordering from a
plain ordered effect token.

LSE atomics use the weakest correct architectural form. Relaxed operations use
the unsuffixed LSE form when legal. Acquire operations use acquire forms,
release operations use release forms, and acquire-release operations use the
combined form. Sequentially consistent and virtio/device publication may require
additional barriers according to the target memory model. The selector must not
guess from an effect token; if the memory-order fact is absent, production
lowering either emits the conservative target-declared sequence or rejects the
operation as an incomplete handoff, depending on the operation kind.

Barriers are explicit machine instructions with memory and scheduling
dependencies. The scheduler may not move ordinary memory operations, atomics,
MMIO accesses, or calls across them unless the memory model explicitly proves the
motion legal. The memory-order verifier checks that every ordered operation has
the required instruction form or barrier sequence and that no later planning pass
crossed a hard ordering edge.

Device and firmware memory have stricter access-shape rules than normal memory.
Unaligned device accesses are rejected even if normal memory would tolerate the
same width and alignment. `ldp`/`stp` formation must never merge an atomic,
volatile, device, firmware, or MMIO access, because that would change
single-copy atomicity, access count, or architectural device behavior.

## Production Fact Extensions Required

Some facts needed for a production-grade backend are not optional polish. If the
current OptIR fact model lacks them, the OptIR handoff must grow them before the
corresponding machine pattern becomes production-legal.

The backend-spent fact families, transfer rules, and physical rewrite ownership
are canonical in `docs/design/aarch64-backend-design.md`. This section owns the
lowering-side obligation: create, preserve, verify, and re-key the
target-neutral facts into machine subjects before the backend sees them.

The initial required set:

- memory-order lattice and region memory type, so LSE suffixes and barriers are
  chosen from semantics rather than from a binary ordered/not-ordered token
- branch probability, block frequency, cold-edge, terminal-edge, and switch
  density facts, so if-conversion and switch lowering have real profitability
  inputs
- FP contraction, rounding, exception, precision, saturation, and error-bound
  facts, so `fmadd`, FP16, RDM, and related fusions never change numeric
  contracts accidentally
- FP environment facts or target declarations for FPCR/FPSR, NaN, signed-zero,
  flush-to-zero, and exception-flag observability
- secret, constant-time, key-lifetime, no-spill, wipe-on-spill, and zeroization
  facts, so branch shaping, CSE, rematerialization, scheduling, and allocator
  metadata cannot violate security contracts
- dereferenceable and prefetchable footprint facts, stated as machine-footprint
  containment obligations, so widened loads, `ldp`, vector loads, and prefetches
  are checked against the exact bytes they may touch
- call-convention and internal-call clobber facts, so only compiler-owned custom
  conventions can narrow register clobbers while ordinary AAPCS64 calls remain
  ABI-conservative
- vector-state ownership facts, including scalar fallbacks for operations such
  as popcount or polynomial math that are cheap with AdvSIMD but illegal in
  scalar-policy functions

The production fact-extension contract is:

Each row below is owned upstream before AArch64 lowering consumes it. An
extension is production-ready only when the owning phase defines:

- a typed fact payload and closed subject vocabulary
- the authority source that may create the fact
- preservation and invalidation rules for each OptIR pass that can move, clone,
  merge, delete, or rewrite the subject
- a verifier that rejects stale subjects, missing dependencies, and invalid
  lineage before target lowering begins
- a machine re-keying rule that says whether the fact maps to an instruction,
  memory operand, virtual register, block edge, frame object, call site, symbol,
  region, or is dropped with a debug record
- negative fixtures proving AArch64 lowering refuses to consume the fact when
  the upstream verifier did not establish it

AArch64 lowering owns none of those upstream creation rules. It consumes only
verified facts and target-surface declarations, and it reports a handoff error
when a production machine form requires an extension whose upstream verifier did
not run or whose subject no longer resolves.

| Fact extension                         | Subject(s)                                       | Originating authority                                                              | Machine use                                                                                   | Missing-fact behavior                                                                                                       |
| -------------------------------------- | ------------------------------------------------ | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| memory-order lattice                   | operation, call, region edge, platform action    | semantic atomic/fence operation, platform catalog, device catalog, runtime catalog | choose LSE suffixes, `ldar`/`stlr`, `dmb`/`dsb`, and hard motion edges                        | hard error for atomic/fence/MMIO/VirtIO publication; conservative compiler-only ordering for ordinary ordered tokens        |
| region memory type and barrier domain  | region, memory access                            | target memory model plus region construction/fact import                           | forbid illegal pair/vector/device forms and pick barrier domain                               | hard error for device/firmware/MMIO regions; normal-memory conservative fallback only when target declares it               |
| branch probability and block frequency | edge, block, switch case                         | checked path profile, static semantic annotation, or deterministic OptIR analysis  | choose `ccmp`/`csel`, compare tree, jump table, hot/cold splitting, and block schedule weight | use deterministic static fallback and record missed-profitability diagnostic                                                |
| switch density and value range         | switch terminator                                | OptIR range analysis, checked impossibility facts, layout/value-domain facts       | choose jump table, bit-test tree, compare tree, or hot-case split                             | compare-tree fallback unless value range is required for correctness of a compact table                                     |
| FP contraction and environment         | FP operation, function, target profile           | source numeric contract, semantic operation, target FP environment                 | select `fmadd`/`fmla`, FP16, RDM, reassociation, and helper calls                             | no contraction or narrowing; hard error for operation families with no precise scalar fallback                              |
| precision, saturation, range, error    | numeric operation, vector lane, semantic kernel  | proof/resource facts, range analysis with lineage, semantic kernel contract        | select RDM, FP16, saturating AdvSIMD, DotProd, and magic divide sequences                     | architectural precise form or helper fallback; hard error if the semantic operation requires unavailable precision handling |
| security and constant-time labels      | value, operation, region, call, function         | semantic operation, security proof, platform/runtime helper contract               | constrain branch shaping, table access, CSE, scheduling, remat, spill, and zeroization        | conservative secret-safe lowering when possible; hard error for required constant-time operations without safe lowering     |
| no-spill and wipe-on-spill             | value, virtual register, frame object            | security fact imported from proof/resource checking or helper ABI contract         | attach allocator metadata and zeroization obligations                                         | hard error if no allocator/backend contract can satisfy it                                                                  |
| dereferenceable footprint              | memory access, path certificate, region view     | checked bounds/path certificate, layout facts, validated-buffer evidence           | license widened scalar loads, `ldp`/`stp`, vector loads/stores, and may-trap speculation      | narrow guarded access fallback; hard error for selected wide/vector template                                                |
| prefetchable footprint                 | memory access, loop, region view                 | target memory model plus dereferenceable/path/stream facts                         | license `prfm` and non-temporal access planning                                               | no prefetch emitted                                                                                                         |
| call-convention and clobber authority  | function, call edge, runtime/platform helper     | ABI surface, closed-world internal convention contract, runtime/platform catalog   | distinguish AAPCS64 full caller-saved clobbers from narrower internal conventions             | AAPCS64 full caller-saved clobber for external calls; hard error for claimed custom convention without closed agreement     |
| vector-state ownership                 | function, helper call, semantic vector operation | target vector-state policy, platform/runtime contract, helper ABI                  | gate AdvSIMD/FP/crypto/vector instruction emission and prologue/epilogue obligations          | scalar/helper fallback when named by matrix; hard error for vector-only operation in scalar-policy function                 |
| image/device/firmware provenance       | region, call, symbol, entry context              | UEFI image profile, device catalog, platform catalog, OptIR region construction    | resolve system-table bases, image handles, device MMIO bases, and firmware access ordering    | hard error; no synthetic firmware or device base may be invented                                                            |

When one of these facts is missing, the backend does not improvise. It falls
back to the conservative legal form when one exists, emits a deterministic
missed-optimization diagnostic in debug mode, or returns a lowering error when
the program's operation has no sound fallback under the production profile.

## AArch64 Production Profile

Wrela does not initially try to be a universal AArch64 backend. The first
production target is one explicit contract: `wrela-uefi-aarch64-rpi5-v1`, a UEFI
AArch64 PE/COFF `.efi` image profile over a Raspberry Pi 5-class Armv8.2-A
instruction set, with VirtIO device/runtime support as the near-term device
catalog. It is intended to run the same Wrela `uefi image` model on a Raspberry
Pi 5 and in an AArch64 UEFI VM on Apple Silicon or other hosts that expose the
required CPU features and UEFI/VirtIO platform contracts. A compile either
targets this profile or fails profile authentication before lowering begins.
There is no runtime feature detection, no instruction variants, no function
multiversioning, and no hidden fallback to an older or newer ISA family.

### The Declared Production Profile

The compile target is one authenticated profile, supplied as an input:

```ts
export interface AArch64TargetProfile {
  readonly name: "wrela-uefi-aarch64-rpi5-v1";
  readonly baseline: "armv8.2-a";
  readonly instructionSet: "raspberry-pi-5-class";
  readonly imageFormat: "pe-coff-efi";
  readonly imageProfile: "uefi";
  readonly requiredFeatures: ReadonlySet<
    | "FEAT_LSE"
    | "FEAT_CRC32"
    | "FEAT_AdvSIMD"
    | "FEAT_FP"
    | "FEAT_AES"
    | "FEAT_PMULL"
    | "FEAT_SHA1"
    | "FEAT_SHA256"
    | "FEAT_FP16"
    | "FEAT_RDM"
    | "FEAT_DotProd"
  >;
  readonly excludedInstructionFamilies: ReadonlySet<
    "FEAT_SVE" | "FEAT_SVE2" | "FEAT_PAuth" | "FEAT_BTI" | "FEAT_MTE" | "FEAT_MOPS"
  >;
  readonly platform: "uefi";
  readonly deviceModel: "virtio";
  readonly tuningModel: "cortex-a76-rpi5-like";
  readonly implementation?: AArch64ImplementationId; // optional MIDR for errata
  readonly fingerprint: AArch64TargetFingerprint;
}
```

The required set is deliberately focused and useful:

- Armv8.2-A is the architectural floor.
- `FEAT_LSE` is required so atomics lower to single-instruction forms instead
  of `ldxr`/`stxr` retry loops.
- `FEAT_CRC32` is required so checksum-heavy packet and storage code can lower
  to the architectural CRC instructions when the semantic operation matches.
- `FEAT_AES`, `FEAT_PMULL`, `FEAT_SHA1`, and `FEAT_SHA256` are required so
  explicit cryptographic and non-cryptographic mixing, hashing, carryless
  multiply, and fingerprint operations have first-class lowering paths.
- `FEAT_FP16`, `FEAT_RDM`, and `FEAT_DotProd` are required so fixed-width
  vector math, int8 classification, and compact numeric kernels can use the Pi
  5-class AdvSIMD forms when vector state is available.
- `FEAT_AdvSIMD` and FP are required as CPU features, but individual functions
  still need a runtime/ABI policy that permits vector or FP register use before
  selection emits those instructions.

The authenticated target surface rejects any profile that is missing a required
feature, requests an excluded instruction family as a production dependency, or
changes the instruction-set, UEFI image, VirtIO device-model, platform, or
tuning contract. A Raspberry Pi 5, a MacBook Air M4 UEFI VM, or another host may
implement more features than the profile requires, such as SVE or pointer
authentication, but this lowering phase will not emit those instructions until a
new profile is designed and accepted.

### Compile-Time Gating

The production profile fixes the instruction contract once, at compile time.
Selection therefore asks two questions:

- Does the operation's fact gate hold in the preserved fact set?
- Is the instruction family part of `wrela-uefi-aarch64-rpi5-v1`, and is the
  function-level vector/FP policy compatible with using it?

If the fact gate is absent, selection falls back to the conservative pattern for
the same production profile: a narrow load instead of a wide load, an unmerged
access instead of `ldp`/`stp`, a scalar path instead of a vectorized path. If the
instruction family is out of profile, production lowering uses a scalar sequence
or a reviewed runtime helper. It does not generate runtime dispatch and does not
test the host CPU.

### Deployment Responsibility

Because there is no runtime detection, the declared profile is a deployment
contract the builder owns: the image may only run where UEFI loads the PE/COFF
`.efi` image, the device model exposes the required VirtIO/MMIO contracts, and
the target CPU implements Armv8.2-A plus the required feature set. Running it on
a Cortex-A53/Armv8.0-A-class target CPU, on a target CPU without LSE, on a
non-UEFI boot path, or on a target CPU without the required
crypto/PMULL/DotProd/FP16 feature families is a deployment error. Running it on
a newer target CPU is valid only to the extent that the newer CPU also satisfies
the production profile; extra features are ignored by this phase.

On a heterogeneous platform where a thread may run on different physical
cores, the exposed target CPU contract must be the common floor of every core the
system can touch. The compiler trusts the declaration and does nothing at runtime
to check it.

### Errata Gating By Part And Revision

A profile may optionally declare the specific implementation it targets through
an `AArch64ImplementationId` (the `MIDR` implementer, part, variant, and
revision). The target module owns an errata catalog keyed by `MIDR` ranges; when
the declared implementation matches an erratum, selection unconditionally
substitutes the catalogued safe sequence at compile time. Errata gating is a
compile-time declaration independent of runtime feature detection and reads no
register at runtime.

### Trust

The production-profile definition, required-feature checks, exclusion list,
tuning model, vector/FP usage policy, and errata catalog are trusted reviewed
target data. A wrong profile or a mis-gated pattern is a miscompile, so the
profile is closed, typed, fingerprinted, and tested against negative profile
fixtures. The acceptance guarantee is no longer "every operation has an
Armv8.0-A lowering"; it is "every supported operation has a deterministic legal
lowering for `wrela-uefi-aarch64-rpi5-v1`, and unsupported profiles fail before
selection begins."

## ABI Intent Lowering

ABI lowering in this phase records target-owned ABI intent from authenticated
ABI facts, never from re-derived source types. It does not finalize private
conventions or decide the final public/private boundary; the backend does that
after it receives `AArch64ClosedImageBackendPlan`.

- function entry records each incoming parameter classification (integer
  register class, vector register class, indirect-result pointer, or stack
  argument slot) and binds the logical incoming value to a virtual register
- function exit records return classifications, including indirect-result
  requirements for large aggregates
- call sites record argument and result classifications plus provisional
  public-boundary bindings when the boundary is already known to be public
- aggregate classification, register pairs, and stack argument area requirements
  follow the target AAPCS64 surface; this phase reads the classification, it
  does not invent it
- ordinary AAPCS64 calls carry a provisional full caller-saved GPR and vector/FP
  clobber summary, regardless of memory-effect facts; memory-effect facts refine
  memory dependencies only
- compiler-owned internal calls carry internal-call eligibility and clobber
  authority facts, but final narrow clobbers require the backend's closed-image
  plan
- multi-register values, i128 products, widening multiply results, and ABI pair
  arguments/returns are represented as register tuples or tied operands so the
  allocator cannot split a value in a way the ABI or instruction forbids

The image entry ABI is target-owned. The UEFI AArch64 target emits the
compiler-owned PE/COFF `.efi` entry shim for the selected loader contract. That
shim receives the UEFI image handle and system table, establishes the
compiler-owned image context, and calls the ordinary Wrela image boot function
this phase lowers and exposes as the program entry symbol.

The frame handoff records AAPCS64 stack invariants even though final offsets are
later: the stack pointer is 16-byte aligned at public call boundaries, there is
no red zone to borrow for temporaries, outgoing argument areas are explicit frame
objects, and prologue/epilogue insertion must preserve any vector-state save
policy the function selected.

## Region Lowering

OptIR models memory as explicit regions. This phase lowers each region kind to a
concrete AArch64 address basis while preserving the zero-copy and effect
guarantees the region facts encode:

| OptIR region kind        | AArch64 address basis                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------ |
| stack local / activation | frame object, addressed relative to the frame base                                               |
| packet source            | base pointer from the incoming pointer parameter; field reads are direct loads                   |
| validated payload        | same backing as its packet/source region plus a certified offset; no copy                        |
| constant data            | rodata global symbol, materialized with `adrp`+`add` and PAGE/PAGEOFF relocations                |
| global data              | data or bss global symbol with linkage, addressed PIC-style and preserving mutability/effects    |
| image device             | MMIO base from the device fact; accesses stay volatile and unmerged                              |
| firmware table           | UEFI system-table or boot-services base from the entry shim or certified provenance, plus offset |
| runtime-owned memory     | symbol or pointer from the compiler-runtime catalog helper that owns the region                  |
| external memory          | conservative pointer operand; no widening, merging, or reordering without a fact                 |

Region lowering preserves the alias class, effect ordering, region memory type,
and barrier domain attached to the region so the machine-IR verifier and any
late target pass can still ask whether two machine accesses may alias and
whether the hardware may reorder them. A validated-buffer read lowers to an
ordinary load off the packet/source base with the certified byte range, exactly
the zero-copy form OptIR produced, never a re-validated or copied access. An
image-device or firmware-table access keeps its device/firmware memory type all
the way to barrier insertion and scheduling; treating it as normal memory is a
verifier error.

## Call, Constant, And Terminator Lowering

Source, runtime, and platform calls are still abstract in optimized OptIR. This
phase lowers them to concrete machine call sequences:

- internal function calls lower to a direct `bl` with a `CALL26` relocation
  reference to the function symbol
- UEFI firmware and indirect calls lower to a `blr` through a loaded function
  pointer, following the target ABI for the call sequence
- runtime helper calls lower to a call to the compiler-runtime catalog symbol
- tail calls lower to a direct or indirect branch only when the ABI
  classification, outgoing arguments, stack state, vector-state obligations,
  security labels, and frame teardown facts prove the tail-call shape legal;
  otherwise the call lowers as `bl`/`blr` plus an ordinary return path
- each call records argument/result ABI intent, provisional public-boundary
  bindings, the ABI register clobbers required by a known public callee
  convention, and separate memory/effect summaries informed by the call's
  platform, device, runtime, and capability facts
- variadic or firmware-specific ABI calls are supported only when the UEFI
  platform catalog names the exact ABI rule and argument classification;
  otherwise they are rejected as unsupported platform primitives

Constants materialize deterministically: small integers as immediates, larger
integers as `movz`/`movk` sequences, and address or large constants as rodata
symbols reached with `adrp`+`add` and the target relocation kinds. The planner
deduplicates literal-pool entries within the configured pool scope, shares and
hoists `adrp` page bases when profitable, and marks cheap constants and address
producers rematerializable for the allocator.

Terminators lower to `b`, `b.cond`/`cbz`/`cbnz`, `tbz`/`tbnz`, a jump table or
compare tree for switches, `ret`, and `trap`/unreachable for terminal and
impossible edges. Switch lowering records the density, probability, and
code-size decision behind the shape. Jump-table entries are PIC-safe symbolic
references: either PC-relative deltas or target-approved table relocations, not
absolute addresses baked into the instruction stream. Direct branch and call
range are symbolic at machine IR; the later backend owns veneers and relaxation
for branches or calls that exceed the architectural immediate range. Block
arguments on OptIR edges become virtual-register block parameters on machine
blocks.

## Fact Preservation Into Machine IR

Late target passes still need some facts. This phase carries forward only the
facts that remain meaningful on machine IR, re-keyed to machine subjects:

- noalias and field-disjointness, so the allocator and any late scheduler can
  reason about machine memory operands
- ABI classification, so call and return lowering stay consistent through later
  passes
- call-convention and clobber facts, so ABI register clobbers and internal
  custom-convention clobbers remain distinct
- layout/endian and alignment, so a late pass does not undo a byte-reverse or
  widen an access incorrectly
- volatility, terminal, effect, memory-order, and region-memory-type facts, so
  no late pass merges, reorders, drops, under-barriers, or over-moves an ordered
  access
- UEFI image, firmware-table, VirtIO/device, and platform primitive facts, so
  late target passes preserve the right image, firmware, and device boundaries
- branch probability, switch density, and cold-edge facts, so post-selection and
  post-allocation placement preserve the intended control-flow shape
- FP contraction, precision, rounding, and saturation facts, so later machine
  cleanup does not create unlicensed numeric fusions
- FP environment facts, so FPCR/FPSR assumptions remain visible to the encoder,
  runtime helpers, and differential fixtures
- vector-state policy facts, so late passes do not introduce AdvSIMD/FP uses in
  scalar-policy functions
- secret, constant-time, key-lifetime, no-spill, wipe-on-spill, and zeroization
  facts, so late target passes and allocation preserve security-sensitive
  lifetimes and cleanup
- capability and platform effect summaries, so call memory/effect reasoning
  stays precise without changing ABI register clobbers

Preservation is mechanical and lineage-tracked, mirroring OptIR fact
preservation: a machine fact records the OptIR fact it descends from. This phase
never derives a new optimization fact and never resurrects a fact an OptIR pass
dropped. A machine-IR fact that cannot be re-keyed to a machine subject is
dropped, with a dropped-fact record in debug builds.

Machine facts use a closed subject vocabulary:

```ts
type AArch64MachineFactSubject =
  | { readonly kind: "machineFunction"; readonly functionId: AArch64MachineFunctionId }
  | { readonly kind: "machineBlock"; readonly blockId: AArch64MachineBlockId }
  | {
      readonly kind: "machineEdge";
      readonly from: AArch64MachineBlockId;
      readonly to: AArch64MachineBlockId;
    }
  | { readonly kind: "virtualRegister"; readonly vreg: AArch64VirtualRegisterId }
  | { readonly kind: "machineInstruction"; readonly instructionId: AArch64MachineInstructionId }
  | {
      readonly kind: "memoryOperand";
      readonly instructionId: AArch64MachineInstructionId;
      readonly operandIndex: number;
    }
  | { readonly kind: "frameObject"; readonly objectId: AArch64FrameObjectId }
  | { readonly kind: "symbol"; readonly symbol: AArch64SymbolId }
  | { readonly kind: "callSite"; readonly instructionId: AArch64MachineInstructionId }
  | { readonly kind: "region"; readonly regionId: AArch64MachineRegionId };
```

Re-keying is explicit:

- one OptIR fact may map to many machine facts when one operation expands into a
  sequence; each machine fact carries the same lineage plus the selected pattern
  ID that performed the split
- many OptIR facts may justify one machine fact when a window or semantic
  superpattern merges accesses; the machine fact records every input fact and
  the manifest gate that required the conjunction
- a fact that justified only an eliminated OptIR value is dropped unless a later
  machine subject still needs it for correctness or diagnostics
- a target-surface declaration such as ABI, relocation, memory-model, or helper
  clobber data is recorded separately from preserved OptIR facts so late passes
  can distinguish proof-derived authority from target-profile authority
- every machine fact has a deterministic stable key, and the fact-preservation
  verifier rejects duplicate stable keys with conflicting payloads

## Determinism

Machine IR output must be deterministic for equivalent optimized OptIR and
target inputs:

- IDs for virtual registers, machine blocks, frame objects, and symbols are
  allocated in a deterministic order from stable OptIR IDs
- selection uses stable tie-breakers and never consults host state, timing, or
  scorecard data
- tables sort by stable IDs, and debug dumps sort functions, blocks,
  instructions, frame objects, symbols, and relocation references by those IDs
- the provenance snapshot fingerprint is computed from the deterministic machine
  program and must match across repeated runs

## Verification

Lowered machine IR is re-verified before it leaves the phase:

- the required-constraint verifier runs registered constraint providers for
  region alias/order, memory-order, `NZCV`, vector state, calls, barriers,
  may-trap operations, errata, security, footprint containment, and fact
  lineage; each provider recomputes conservative required constraints from
  preserved facts and target rules, then checks the emitted machine IR contains
  those constraints
- the structural verifier checks that every virtual-register use has a
  definition, block parameters and arguments agree, terminators are well-formed,
  frame and symbol references resolve, register tuples/tied operands are
  consistent, instruction operands satisfy the A64 schema, `NZCV` defs and uses
  form legal live ranges, FPCR/FPSR assumptions are explicit for FP operations,
  and relocation references name a valid target relocation kind
- the ABI verifier checks that parameter, return, indirect-result, and call
  argument placements are consistent with the authenticated ABI surface and that
  ordinary AAPCS64 calls retain full caller-saved register clobbers
- the region constraint provider checks that each machine access keeps its
  region's alias class and effect ordering and that volatile/MMIO/firmware
  accesses are neither merged nor reordered
- the memory-order constraint provider checks that atomics use the right LSE
  acquire/release suffixes, fences and virtio/device operations have the
  required `dmb`/`dsb` or load/store-release/acquire sequence, and no scheduled
  instruction crossed a hard ordering edge
- the dependency-graph constraint provider recomputes conservative required
  edges from preserved facts and target rules before the scheduler verifier
  checks preservation of those edges
- the scheduler verifier checks that pre-RA scheduling, `adrp` sharing,
  load/store pairing, prefetch insertion, and rematerialization metadata preserve
  register, memory, `NZCV`, call, barrier, may-trap, vector-state, errata, and
  security dependencies
- the fact-preservation constraint provider checks that every carried machine
  fact has valid lineage to a preserved OptIR fact and that no dropped fact
  reappears
- the superselection verifier checks that every selected window or semantic
  superpattern records its required fact gates, profile gates, vector-state
  decision, profitability reason, fallback shape, and exact consumed-operation
  boundary
- the tiling verifier checks that every reachable supported OptIR operation is
  covered exactly once by a local, window, helper, or semantic candidate and that
  multi-operation templates preserve all live-outs and effects
- widened, paired, vector, and prefetch-planned accesses are checked against the
  exact preserved machine footprint containment obligation
- the security constraint provider checks that secret and constant-time labels
  forbid data-dependent branches, unsafe table access, unsafe rematerialization,
  unsanitized spills, and moved zeroization stores

A verifier failure returns `kind: "error"` with a deterministic diagnostic. The
phase does not emit machine IR it cannot verify.

The merge/debug soundness lane additionally runs the differential machine-IR
interpreter over small pure and effectful selected fragments, including memory
state and effect-token state, and compares results with the OptIR interpreter.
Those checks are required merge evidence for pattern and scheduler changes, but
they are not the production verifier that decides whether one ordinary lowering
result may leave this phase.

## Diagnostics And Debug Output

User-facing semantic errors were reported long before this phase. Machine IR
diagnostics are compiler diagnostics, selection traces, and lowering
explanations:

- unsupported optimized OptIR operation in selection
- missing target ABI, relocation, or catalog entry
- region-lowering conflict or unresolved region base
- missing required fact for a fact-gated selection
- missing memory-order, branch-probability, FP-contraction, footprint, or
  vector-state authority for a production machine form
- missing security/constant-time authority for a cryptographic or secret-labeled
  production machine form
- unsupported operation-matrix entry or operation left uncovered by tiling
- machine-IR, ABI, region, memory-order, dependency-graph, scheduler, tiling,
  security, or fact-preservation verifier failure
- selected machine form explanation in debug mode
- selected or missed window/superselection explanation in debug mode, including
  the decisive fact gate, profile gate, vector-state policy, and profitability
  reason
- machine-planning explanation in debug mode for `adrp` CSE/hoisting,
  literal-pool deduplication, rematerialization choices, prefetch placement,
  barrier insertion, load/store pairing, block scheduling, and branch/switch
  shaping

Selection explanations should be source-level when possible:

```text
selected ldp + rev for ipv4 header read at packet.wr:42:13
  access: ipv4.total_length @ byte range [2, 4) over packet-source region
  facts:
    bounds authority proves byte range [0, 20) dereferenceable
    field-disjointness proves total_length and protocol loads do not alias
    layout/endian fact proves wire endian = big
  emitted:
    ldp over the packet base, rev16 for the big-endian decode
  preserving:
    source span, HIR origin, Proof MIR read, noalias and endian machine facts
```

```text
selected semantic plugin virtio-ring-publish at queue.wr:118:7
  window:
    descriptor writes, avail index increment, notification flag check
  facts:
    ring size is power-of-two and index mask is 255
    descriptor and avail regions are disjoint from device MMIO notify region
    release ordering required before publishing avail.idx
    notification load is ordered and must not be merged
  emitted:
    stp descriptor pair, and masked add for ring index
    stlr/ldadd release form for avail.idx
    dmb sequence required by the virtio memory model before MMIO notify
    ordered MMIO notify path kept behind tbz
  rejected:
    vectorized descriptor store because device-effect boundary is ordered
  preserving:
    virtio region provenance, memory-order fact, effect-token boundary
```

Debug dumps must be deterministic and sorted by stable IDs.

## Output Contract

The phase output is:

```text
AArch64MachineProgram
  machine functions over virtual registers
  machine blocks with virtual-register block parameters
  selected scalar and vector instructions
  local, window, and semantic-superselection provenance records
  machine dependency graph, schedule plan, barriers, prefetches, and remat hints
  ABI parameter, return, and call-argument intent records plus provisional
  public-boundary bindings
  frame objects with sizes and alignments
  region-backed addresses, global symbols, and constants
  concrete direct and indirect calls, branches, switches, and traps
  symbol references and relocation references

AArch64PreservedFactSet
  machine-keyed facts with lineage to preserved OptIR facts
  noalias, ABI, layout/endian, alignment, volatility, terminal, effect, and
  capability facts the backend still needs
  memory-order, region-memory-type, branch-probability, FP-contraction,
  FP-environment, vector-state, security/zeroization, UEFI image/device, and
  call-clobber facts needed by late target passes
  ownership-lifetime, session-membership, non-escape, initialized-prefix,
  bounded-cardinality, private-state-generation, terminal-cleanup,
  internal-call-eligibility, core-owner, and rematerialization-authority facts
  when upstream phases proved them and optimization preserved them
  dropped-fact records in debug builds

AArch64ProvenanceMap
  snapshot of returned machineProgram.provenance
  source/HIR/mono/Proof MIR/checked MIR/layout/OptIR origins
  synthetic lowering origins
```

The AArch64 backend consumes this machine IR plus the preserved fact set. It may
use the facts that remain valid, but it must not resurrect facts this phase
dropped. It owns register allocation, frame finalization, prologue/epilogue,
post-allocation cleanup, encoding, and relocation generation while preserving
the machine dependencies, barriers, schedule constraints, rematerialization
metadata, and fact gates emitted here.

The backend-facing fact list is intentionally broader than the facts selection
itself needs. Selection needs enough facts to choose legal A64 instructions.
The backend needs enough facts to keep those choices profitable after physical
registers, stack slots, prologues, epilogues, branch relaxation, and relocation
holes exist. If the target-neutral fact substrate cannot yet express a required
late fact, the earlier phase that owns the proof should add a target-neutral
fact extension and this phase should re-key it to machine subjects. The backend
must not reach backward into proof, layout, OptIR pass, or source-level data to
recover a fact that was not explicitly handed through this contract.

Machine fact preservation is a typed contract, not an opaque metadata dump. The
generic `AArch64MachineFactRecord` envelope may carry records during early
implementation, but each backend-spent fact family must have a closed payload
schema, allowed subject set, lineage rule, invalidation rule, and verifier
family before the backend may use it as optimization or allocation authority.
Malformed or stale late facts are backend input-contract errors, not hints to
ignore silently.

The detailed backend transfer contract lives in
`docs/design/aarch64-backend-design.md`; this phase's responsibility is to emit
facts that satisfy that contract, not to let the backend rediscover facts from
OptIR internals.

## Deferring A Shared Target-Independent LIR

AArch64 machine IR is target-owned on purpose. While AArch64 is the only
backend, a shared target-independent LIR would add a layer with no second
consumer. This design therefore keeps lowering direct: optimized OptIR lowers
straight to AArch64 machine IR.

The phase is structured so a future LIR is a cheap refactor, not a rewrite. The
lowering steps that are genuinely target-independent in shape are isolated:
region-kind-to-address-basis lowering, ABI marshaling skeleton, call-sequence
shape, constant materialization policy, and fact preservation. If a second
backend appears and these steps start repeating below OptIR, they migrate into a
shared LIR and AArch64 selection consumes the LIR instead of OptIR directly. The
trigger for introducing the LIR is a second backend or a clearly repeated
lowering abstraction, not speculation.

## Testing Strategy

Unit tests should cover:

- deterministic machine-IR ID allocation and table ordering
- explicit machine resources, including `NZCV` defs/uses, vector-state
  resources, register tuples, tied operands, memory-order operands, barriers,
  scheduling metadata, and rematerialization metadata
- instruction schema verification for W/X zero-extension behavior, immediate
  encodings, addressing ranges, vector lane arrangements, FPCR/FPSR state,
  tied operands, register tuples, and illegal A64 encodings rejected before
  encoding
- supported-operation matrix fixtures for required, fact-gated, helper-lowered,
  profile-rejected, and unreachable-after-optir operations
- target-surface component fingerprint fixtures proving each ABI, relocation,
  profile, image, vector-state, FP-environment, memory-model, scheduler,
  literal-pool, platform, device, and runtime catalog query is authenticated and
  deterministic
- required semantic operation family fixtures for atomics/fences, FP, checksum,
  polynomial, AES/SHA/block-mix, DotProd/RDM/classifier, and security-sensitive
  operations, proving selection refuses to infer those meanings from arbitrary
  integer, vector, or intrinsic shapes
- scalar selection for integer arithmetic, comparison, boolean, select, and
  address arithmetic, including pattern tie-breakers
- smart base-ISA forms: shifted/extended second-operand folding, addressing-mode
  matching with pre/post-index, bitfield field access (`ubfx`/`bfi`) from layout
  facts, branchless `csel`/`ccmp` chains, and `tbz`/`cbz` test-and-branch
- constant materialization choosing among logical bitmask immediates,
  `movz`/`movk` sequences, `movn`, and literal-pool symbols
- production-profile authentication: the exact `wrela-uefi-aarch64-rpi5-v1`
  baseline, Raspberry Pi 5-class instruction set, UEFI PE/COFF image profile,
  VirtIO device model, required features, excluded instruction families, tuning
  model, and fingerprint are accepted, while missing LSE, CRC32, AdvSIMD/FP,
  AES/SHA/PMULL, FP16, RDM, DotProd, Cortex-A53/Armv8.0-A-class, no-LSE,
  SVE/SVE2-required, PAuth-required, BTI-required, MTE-required, non-UEFI,
  missing-VirtIO-device-model, and mismatched-instruction-set profiles are
  rejected
- required production families: LSE atomics lower directly to `ldadd`/`stadd`/
  `swp`/`cas` forms, CRC32 semantic operations lower to `crc32*`/`crc32c*`
  forms when applicable, PMULL lowers explicit carryless-multiply and
  binary-polynomial operations, AES/SHA lower only explicit round/mixing
  semantics, and fixed AdvSIMD/FP/FP16/RDM/DotProd forms are emitted only when
  the function-level vector/FP policy permits them
- selector tiering: local selection, window selection, and semantic
  superselection pick deterministic winners with stable tie-breakers and record
  rejected alternatives
- pattern tiling and cross-tier resolution: overlapping semantic/window/local
  candidates produce one deterministic covering, exact consumed-operation
  boundaries, no duplicated effects, and local fallback for every required
  operation
- window patterns for load-once field clusters, endian decode clusters,
  branchless validators, table/nibble classifiers, bitset reductions, and
  structured AoS/SoA movement
- semantic-plugin candidates for zero-copy packet views, virtio ring atomics,
  effect-island scheduling, tail-free fixed vectors, PMULL polynomial kernels,
  AES/SHA mix kernels, DotProd classifiers, and RDM/FP16 compact math
- negative superselection gates: each superpattern falls back to local/window
  selection when a required layout, bounds, noalias, effect, polynomial,
  vector-state, precision, or memory-order fact is absent
- semantic operation discipline: AES/SHA/PMULL/DotProd/RDM/FP16 forms are never
  inferred from arbitrary integer/vector idioms without a named semantic
  operation or certified superpattern
- FP contraction discipline: `fmadd`/`fmla`, FP16 narrowing, RDM, reassociation,
  and saturating forms are emitted only when the preserved precision/rounding/
  contraction/saturation facts license them
- constant divisor cleanup: constant `udiv`/`sdiv` that survives OptIR lowers to
  reviewed magic-multiply/shift forms only when signedness, range, overflow, and
  rounding facts license the sequence
- NZCV discipline: `ccmp` chains, condition consumers, `adcs`/`sbcs`, compare/
  branch adjacency, scheduler motion, and spill-code insertion preserve explicit
  flag liveness and fail verification when a flag clobber is inserted illegally
- branch profitability: predictable validation chains stay branchy, short
  unpredictable diamonds if-convert, missing probability facts use conservative
  heuristics, and debug output records the chosen probability reason
- switch lowering policy: dense hot switches, sparse switches, biased hot-case
  switches, cold terminal cases, and insufficient-density cases select the
  intended jump table, compare tree, bit-test, or hot-case split
- production machine planning: dependency graph construction, pre-RA scheduling,
  load-use latency hiding, pairable-load clustering, effect-island motion,
  barrier boundaries, register-pressure caps, and deterministic schedule output
- `adrp` CSE and hoisting: page-base sharing within a block, across dominated
  blocks, around calls, inside loops, and across relocation-page boundaries where
  sharing must be rejected
- rematerialization and literal pools: cheap constants and page bases carry
  remat costs, literal-pool constants deduplicate deterministically, and spill
  simulations prefer remat over storing cheap producers
- prefetch planning: `prfm` and non-temporal forms are emitted only for allowed
  memory types, certified footprints, useful loop distance, and no ordered
  device/MMIO boundary; negative cases prove no hint is emitted
- memory ordering: relaxed/acquire/release/acqRel/seqCst LSE suffix selection,
  `ldar`/`stlr`, required `dmb`/`dsb` insertion, device-region ordering,
  compiler-only ordered tokens, and conservative fallback/error behavior when
  memory-order facts are missing
- memory-model litmus fixtures for reviewed AArch64/VirtIO/UEFI publication
  patterns, proving the barrier table rather than relying on the sequential
  interpreter for concurrency behavior
- dependency-graph completeness: conservative required memory, call, barrier,
  `NZCV`, may-trap, errata, vector-state, and security edges are recomputed and
  must appear in the scheduler graph before schedule preservation is checked
- secret and constant-time handling: secret-dependent branches stay branchless,
  unsafe table access is rejected, secret remat/CSE/lifetime extension is
  blocked, no-spill/wipe-on-spill metadata is preserved, and zeroization stores
  are not removed or moved before the last secret use
- out-of-profile families: MOPS, SVE/SVE2, PAuth, BTI, and MTE instructions are
  not emitted under `wrela-uefi-aarch64-rpi5-v1`; tests assert scalar or
  runtime-helper lowering where those operations are supported
- single-stream output: the production profile produces no instruction
  variants, feature dispatch, runtime detection routine, or hidden no-LSE
  fallback path
- compile-time errata gating by declared `MIDR` range without runtime feature
  checks or runtime register reads, plus post-schedule errata constraint
  verification
- memory selection for loads and stores, including fact-gated `ldp`/`stp`
  merging and the conservative fallback when the fact is absent
- endian selection of `rev`/`rev16`/`rev32` from layout/endian facts, and the
  refusal to byte-reverse without the fact
- bounds-authority and path-certificate gated wide/speculatable loads, and the
  guarded fallback when the authority is absent
- vector selection for NEON loads, stores, compares, shuffles, and byte swaps,
  gated on the function-level vector/FP policy, with masked and scalar-tail
  forms from the tail plan
- vector-state policy modes: `scalarOnly`, `ownsVectorState`, and
  `callsVectorHelper`, including scalar-policy fallback for popcount and
  polynomial math
- FP environment policy: FPCR/FPSR rounding, flush-to-zero/default-NaN,
  exception observability, signed-zero, and NaN behavior are declared and tested
  for FP16/RDM/FMA lowering and differential fixtures
- ABI lowering of parameters, returns, indirect results, aggregates, and call
  arguments from authenticated ABI facts
- region lowering for stack, packet source, validated payload, constant, global
  data, image device, firmware table, runtime, and external memory, including
  zero-copy validated-buffer reads
- constant materialization for immediates, `movz`/`movk` sequences, and
  symbol-backed constants with relocation references
- terminator lowering for branches, conditional branches, switch tables and
  compare trees, PIC-safe jump tables, returns, tail calls, and terminal/`Never`
  traps
- call lowering for direct internal calls, indirect firmware calls, and runtime
  helper calls, with ABI-correct register clobbers, fact-informed memory/effect
  summaries, and narrower register clobbers only for authenticated internal
  custom conventions
- fact preservation lineage and rejection of resurrected dropped facts
- machine-IR, ABI, region, memory-order, scheduler, and fact-preservation
  verifier failures for undefined uses, inconsistent ABI placement, illegal
  access merging or reordering, stale facts, missing barriers, illegal `NZCV`
  clobbers, illegal prefetches, and illegal schedule motion

Integration tests should cover:

- public API lowering from optimized OptIR fixtures into AArch64 machine IR
- UEFI image fixtures where the PE/COFF `.efi` entry shim context, image handle,
  system table, firmware primitive calls, and Wrela image boot function lower
  through the UEFI AArch64 target surface
- merge/debug soundness harness comparison between the machine-IR interpreter
  and the OptIR interpreter on small pure programs
- merge/debug soundness harness comparison between the machine-IR interpreter
  and the OptIR interpreter on effectful memory fragments, including merged
  loads/stores, reordered noalias islands, widened loads, LSE atomics, barriers,
  and MMIO boundaries
- validated-buffer parser fixtures where field reads become `ldr`/`ldp`+`rev`
  over the packet base with no bounds branches and no copies
- virtio queue fixtures where descriptor ring updates use the required LSE
  acquire/release forms, explicit target memory-model barriers, and never cross
  ordered device-effect boundaries
- checksum and fingerprint fixtures comparing CRC32, PMULL, AES/SHA mix, and
  scalar/runtime-helper paths against the machine-IR interpreter
- fixed-vector classifier fixtures for `tbl`/`tbx`, DotProd, lane compares, and
  bitset reductions under explicit vector-state policies
- fake firmware/platform effect fixtures proving volatile, MMIO, and
  firmware-table accesses are emitted exactly once and in order
- fake VirtIO/device fixtures proving device catalog entries, MMIO bases,
  natural-alignment requirements, and ring publication barriers are preserved
- selection-pattern soundness and negative fact-gate fixtures for every catalog
  entry, including valid-but-insufficient fact cases
- deterministic machine-IR snapshots from equivalent optimized OptIR and target
  inputs
- debug explanation output for merged loads, endian-folded reads, eliminated
  guard branches, barriers, prefetches, `adrp` sharing, rematerialization,
  branch/switch shaping, schedule decisions, and terminal traps

Fakes should be supplied through dependency injection for the narrow AArch64
target sub-surface under test: selection, ABI, relocation, memory-order,
planning, or platform/device/runtime. Full-pipeline tests supply the complete
`AArch64TargetSurface`. Runtime source remains dependency-free. Property
generators may use test-only dependencies.

## Build Order

The implementation should proceed in narrow, verifiable slices:

1. Define machine-IR IDs, virtual registers and register classes, machine types,
   machine program/function/block/instruction records, operands, frame objects,
   ABI intent records, provisional public-boundary bindings, symbol and
   relocation references, `NZCV`/vector-state resources, memory-order records,
   scheduling metadata, rematerialization
   metadata, security metadata, FP environment records, provenance, diagnostics,
   typed A64 instruction-schema records, and the structural machine-IR verifier.
2. Implement the machine-IR interpreter for closed machine operation semantics
   used by the merge/debug soundness lane, including `NZCV`, register tuples,
   memory state, effect-token state, atomics, barriers, and the deterministic
   differential harness against the OptIR interpreter.
3. Implement input-contract and component target-surface authentication,
   including fingerprint checks for selection, ABI, relocation, UEFI image
   profile, production profile, memory model, scheduler model, literal-pool
   policy, platform, device, runtime, and catalog entries.
4. Implement the required OptIR fact-extension handoff: memory-order and region
   memory type, branch probability and switch density, FP contraction and
   precision, FP environment, secret/constant-time/zeroization labels,
   dereferenceable/prefetchable footprint containment, call-clobber convention
   authority, vector-state ownership, upstream typed payloads, preservation
   rules, invalidation rules, extension verifiers, machine-fact subject
   re-keying, dropped-fact records, backend-importable payload schemas, and
   target-surface declaration records.
5. Implement `wrela-uefi-aarch64-rpi5-v1` profile authentication: exact
   baseline, Raspberry Pi 5-class instruction set, UEFI PE/COFF image profile,
   VirtIO device model, required features, excluded instruction families, tuning
   checks, profile fingerprinting, negative profile fixtures, and the
   supported-operation guarantee for that profile.
6. Implement the supported-operation matrix for required, fact-gated,
   helper-lowered, profile-rejected, and unreachable-after-optir operations,
   including the current OptIR operation vocabulary and the production semantic
   operation families that must be added upstream before their AArch64
   instruction families are selectable.
7. Implement scalar instruction selection and terminator lowering for pure
   scalar and control-flow fragments, with `NZCV` modeled explicitly, production
   verifier-lane checks passing, and merge/debug differential fixtures covering
   the selected patterns.
8. Implement ABI lowering for parameters, returns, indirect results,
   register-tuples, call arguments, AAPCS64 stack invariants, and ABI-correct
   call register clobbers.
9. Implement UEFI image-profile lowering for the entry shim context, image
   handle, system table, firmware-table bases, platform primitive calls, and the
   Wrela image boot function handoff.
10. Implement region lowering for every OptIR region kind, including zero-copy
    validated-buffer reads, region memory types, barrier domains, and
    effect-ordered volatile/MMIO/firmware accesses.
11. Implement constant materialization, literal-pool planning, `adrp` page-base
    materialization, and call lowering for internal, firmware, and runtime-helper
    calls with separate ABI register clobbers and memory/effect summaries.
12. Add fact-gated memory and endian selection: `ldp`/`stp` merging, exact
    footprint-checked wide/speculatable loads, and `rev` family selection, each
    with conservative fallback and negative fact-gate tests.
13. Add memory-order lowering: relaxed/acquire/release/acqRel/seqCst LSE forms,
    `ldar`/`stlr`, virtio/device barriers, compiler-only ordered tokens, the
    memory-order constraint provider, and the merge/debug AArch64/VirtIO/UEFI
    litmus-test suite for the reviewed barrier table.
14. Add the base A64 smart-form catalog: flexible second operand,
    addressing-mode matching, bitfield field access, profitable `csel`/`ccmp`
    conditionals, `tbz`/`cbz`, constant divisor cleanup, and smart constant
    materialization.
15. Add secret and constant-time lowering constraints for branch shaping, table
    access, CSE, rematerialization, spills, vector helpers, and zeroization.
16. Add deterministic branch, switch, and if-conversion profitability from
    probability, density, cold-edge, terminal-edge, chain-length, code-size, and
    tuning-model facts.
17. Add post-selection machine CSE, including repeated pure producers, `adrp`
    page-base sharing/hoisting, literal-pool deduplication, rematerialization
    marking, and negative tests for relocation, dominance, call, and pressure
    boundaries.
18. Add the required-constraint framework, machine dependency graph,
    dependency-edge completeness provider, and pre-register-allocation scheduler
    for registers, memory, calls, barriers, `NZCV`, may-trap operations, vector
    state, security labels, errata constraints, load/store pair planning, and
    effect-island motion.
19. Add prefetch and streaming-access planning for `prfm`, `ldnp`/`stnp`, and
    streaming kernels, gated by memory type, footprint, loop distance, reuse
    facts, and ordered-boundary checks.
20. Add required production-profile families: LSE atomics, CRC32 semantic
    checksum forms, PMULL carryless-multiply forms, AES/SHA explicit round and
    mixing forms, FP16/RDM/DotProd forms, and fixed AdvSIMD/FP selection, with
    tests proving no runtime feature dispatch and no no-LSE fallback path.
21. Add FP contraction and numeric-fusion gates for `fmadd`/`fmla`, FP16, RDM,
    reassociation, saturation, error-bound facts, and FPCR/FPSR environment
    assumptions.
22. Add out-of-profile negative tests for MOPS, SVE/SVE2, PAuth, BTI, and MTE
    emission, plus compile-time `MIDR` errata gating.
23. Add vector selection gated on the function-level vector/FP policy, with
    scalar/SWAR or runtime-helper fallbacks for scalar-policy popcount,
    polynomial math, and vector-only operations.
24. Add pattern tiling and cross-tier resolution for local, window, helper, and
    semantic-plugin candidates, including exact consumed-operation boundaries,
    manifest lookup by `patternId`, and the tiling verifier.
25. Add window selection for load-once field clusters, endian decode clusters,
    branchless validation, table/nibble classifiers, bitset reductions, and
    structured AoS/SoA movement.
26. Add typed semantic-selection plugins for zero-copy packet views, virtio ring
    atomics, effect-island scheduling, tail-free fixed vectors, PMULL polynomial
    kernels, AES/SHA mix kernels, DotProd classifiers, and RDM/FP16 compact
    math, each backed by manifest entries and upstream named semantic operation
    families wherever possible.
27. Add deterministic profitability policy and diagnostics for local, window,
    semantic, scheduling, prefetch, barrier, switch, and CSE decisions, including
    rejected alternatives and missed superpatterns.
28. Add fact preservation into machine IR with lineage and the
    fact-preservation verifier.
29. Add the ABI, region, memory-order, dependency-graph, scheduler, tiling,
    security, `NZCV`, FP-environment, required-constraint providers, and full
    production machine-IR verification gate.
30. Add selection and machine-planning explanation debug output and scorecard
    capture hooks.

The machine-IR acceptance gate is the point at which the machine IR itself is
considered stable enough for the backend: the model, interpreter, verifiers,
provenance, deterministic selection, machine planning, memory ordering, ABI and
region lowering, scheduling metadata, rematerialization metadata, and fact
preservation must all pass before register allocation and encoding are allowed
to depend on them.

Output: AArch64 machine IR with virtual registers, symbols, frame objects, ABI
locations, concrete calls, branches, constants, and relocation references, plus
the preserved fact set and provenance the AArch64 backend consumes.
