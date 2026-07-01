# AArch64 Backend Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the production AArch64 backend described in `docs/design/aarch64-backend-design.md`, producing deterministic internal AArch64 object modules from verified machine IR, preserved facts, provenance, an authenticated backend target surface, and a closed-image backend plan. There is no v1, MVP, or intentionally incomplete subset: tasks may be split for execution, but the accepted scope is the full production backend.

**Architecture:** Add a new `src/target/aarch64/backend/` subsystem with one public compile API, one authenticated backend target surface, one backend rewrite transaction owner, one security label-conservation invariant, and one layout-and-encode fixed-point owner. Extract the shared fact-extension contract outside OptIR so OptIR, AArch64 machine IR, and the backend use the same typed validation, preservation, invalidation, and transfer machinery.

**Tech Stack:** TypeScript, Bun test runner, existing AArch64 machine IR/lowering/verifier modules, existing deterministic sort and stable JSON helpers, `fast-check` for tests only.

---

## Research Notes

Research performed before writing this plan:

- The design is `docs/design/aarch64-backend-design.md` and is 2007 lines. The implementation must cover the full production contract, not an MVP.
- Existing AArch64 lowering lives under `src/target/aarch64/` with machine IR, target surface, fact re-keying, planning, selection, interpreter, debug, and verifier subtrees already present.
- Existing public API shape is in `src/target/aarch64/public-api.ts` and uses deterministic `{ kind: "ok" | "error" }` results with diagnostics.
- Existing machine program, function, instruction, operand, frame-object, relocation, provenance, and fact-set records live under `src/target/aarch64/machine-ir/`.
- Existing source-level target surface is in `src/target/aarch64/target-surface/target-surface.ts`; the backend design requires a separate authenticated `AArch64BackendTargetSurface`.
- Existing tests use Bun, fakes through dependency injection, deterministic expected diagnostics, and fixtures under `tests/support/target/aarch64/`.
- Repository instructions require `bun run agent:check` before handoff, targeted `bun test` commands while iterating, runtime source dependency-free code, fakes through dependency injection, and no production filesystem access outside compiler edges.

The standards below are not open-ended per-worker research tasks. Their results must be encoded as checked target catalog data, fixture matrices, or explicit procedures in this plan before the corresponding implementation task starts:

```text
Arm Architecture Reference Manual for A-profile A64
AAPCS64
AAELF64 relocation semantics
Microsoft PE/COFF AArch64 relocations
UEFI AArch64 platform binding
Raspberry Pi 5 / Cortex-A76 public tuning guidance
```

Implementers must not make external tools production authority. Tests may use external assembler/disassembler or reference tables as non-authoritative oracles only when kept outside runtime source.

## Research Completion Ledger

These are the pre-implementation research inputs and the concrete plan decisions they settle. Implementation workers must not redo this research as a spike; they convert these decisions into catalog rows, fixture matrices, and tests.

| Research input                                                                                                                                                                                                                     | Decision captured in this plan                                                                                                                                                                                                                                                                                             | Owning tasks                    | Acceptance evidence                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Arm Architecture Reference Manual for A-profile architecture and A64 instruction descriptions (`https://developer.arm.com/documentation/ddi0487/mb/`, `https://developer.arm.com/documentation/ddi0602/2023-09/Base-Instructions`) | A64 encoding is direct bitfield construction from authenticated catalog rows. No runtime assembler, disassembler, mnemonic parser, or subprocess is authoritative.                                                                                                                                                         | Tasks 26A, 26, 27, 28, 31, 32   | Known-byte fixture per emitted family, encoding-catalog auth, byte re-decode in object verifier                                                                                 |
| AAPCS64 2025Q4 (`https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst`)                                                                                                                                            | Public ABI classification uses AAPCS64 Stage A initialization, Stage B pre-padding/extension, Stage C register/stack assignment, HFA/HVA recognition, x8 indirect result handling, and x0-x7/v0-v7 public locations. Variadic and scalable-vector public ABI are rejected for this profile with deterministic diagnostics. | Tasks 13, 14, 15, 20, 34        | ABI fixture matrix covers scalar, stack overflow, FP/SIMD, HFA/HVA, large aggregate x8, over-aligned stack, multi-register return, x18 rejection, variadic/scalable diagnostics |
| AAELF64 2025Q4 (`https://github.com/ARM-software/abi-aa/blob/main/aaelf64/aaelf64.rst`)                                                                                                                                            | AAELF64 informs AArch64 relocation terminology and A64 relocation pairing, but `wrela-uefi-aarch64-rpi5-v1` final writer compatibility is PE/COFF-facing. Internal-only relocation families must be resolved or lowered before PE/COFF serialization.                                                                      | Tasks 26A, 29, 31, 32           | Relocation catalog mapping table, paired relocation tests, internal-only resolution tests                                                                                       |
| Microsoft PE/COFF ARM64 relocation definitions (`https://learn.microsoft.com/en-us/windows/win32/debug/pe-format`)                                                                                                                 | Accepted PE/COFF-facing relocation families are fixed: `branch26`, `branch19`, `branch14`, `pagebase-rel21`, `pageoffset-12a`, `pageoffset-12l`, `addr64`, `addr32`, `addr32nb`, `rel32`, and section-relative/debug families when final writer permits them.                                                              | Tasks 26A, 29, 31, 32           | Catalog rows for every accepted mapping, unmapped relocation rejection, object verifier patch-range checks                                                                      |
| UEFI Specification 2.11 AArch64 binding (`https://uefi.org/specs/UEFI/2.11/02_Overview.html`)                                                                                                                                      | UEFI calls use the AArch64 binding, all ordinary code exits stay in A64 state, firmware/platform boundaries use public ABI, and optional FP/SIMD/vector state requires target/catalog authorization and save/restore policy.                                                                                               | Tasks 4, 13, 14, 15, 22, 23, 34 | Firmware-call ABI fixtures, A64-only finalization tests, vector-state catalog gates, unwind/frame verifier coverage                                                             |
| Cortex-A76 optimization guidance (`https://developer.arm.com/documentation/PJDOC-466751330-7215/11-0`)                                                                                                                             | Cortex-A76 data is tuning input only. It may influence deterministic weights for scheduling, allocation pressure, pair formation, and latency hiding; it never overrides correctness, security, ABI, relocation, or encoding rules.                                                                                        | Tasks 4, 25, 26A                | Tuning model fingerprint, deterministic scheduler tie-break tests, no correctness diagnostic depends on tuning-only data                                                        |

## Closed Design Decision Ledger

These decisions are closed before implementation. A worker may improve an implementation detail inside the stated boundary, but may not choose a different architecture without revising this plan.

```text
Decision                                             Closed answer
Object format                                        Internal AArch64ObjectModule, not PE/COFF. PE/COFF compatibility is represented by relocation/unwind catalog mappings.
Runtime authority                                    Pure TypeScript runtime source. No production filesystem, assembler, disassembler, subprocess, clock, pid, random, or environment authority.
Fact authority                                       One shared CompilerFactExtension contract. OptIR and AArch64 machine facts migrate onto it; backend imports facts through typed machine subjects only.
Rewrite authority                                    One AArch64BackendRewriteTransaction owns all backend mutations and fact/provenance transfer.
Security authority                                   One security label-conservation verifier owns no-spill, wipe-on-spill, constant-time, secret branch/table/call/helper, and object-level security checks.
Target authority                                     One authenticated AArch64BackendTargetSurface. Backend internals consume catalog interfaces, never source target-surface casts.
Register model                                       One authenticated physical register model feeds ABI, allocator, frame, unwind, encoding, veneers, and verifiers. x18 is reserved for wrela-uefi-aarch64-rpi5-v1.
SP/ZR handling                                       SP and ZR share encoding number 31 but are not storage aliases. Operand permission queries decide where each is legal.
Public ABI                                           AAPCS64/UEFI at all exported, address-taken, replacement, firmware, platform, or uncertain boundaries.
Private ABI                                          Closed-image only, exact caller/callee authorization only, and never for exported/address-taken/replacement/relocatable-public boundaries.
Variadic/scalable ABI                                Unsupported for this profile with deterministic diagnostics.
Allocator                                            Deterministic global worklist with finite split/remat/spill/fail action order and lexicographic progress proof.
Parallel copies                                      Graph-based acyclic emit plus cycle breaking with legal temporary; memory swap only when security policy permits every value.
Frame layout                                         One frame-layout owner chooses slots, coloring, SP/FP addressing, callee-save placement, outgoing args, wipe slots, and encodable offsets.
Unwind                                               Planned before bytes; frame shapes not representable by authenticated unwind catalog fail before object emission.
Scheduling                                           Deterministic post-RA list scheduling inside dependency islands. Barriers, calls, relocation pairs, secret regions, and observable exits split islands.
Encoding                                             Catalog-driven direct bitfield emitters. Known-byte fixtures prove every emitted family.
Relocations                                          Layout-and-encode emits relocations with final patch offsets. Relocation generation is not a later side pass.
Branch/literal/veneer relaxation                     One finite monotone fixed-point system. Decisions only grow and never oscillate or shrink.
Debug artifacts                                      Optional, deterministic, sorted, stable-keyed, and free of host metadata.
```

## Execution Contract

This document is a production handoff, not a compact outline. A subagent may pick up a task only when its dependencies are complete and the task has:

- [ ] exact files to create or modify
- [ ] declared interfaces for every type consumed by another task
- [ ] owned test helpers with import paths and signatures
- [ ] failing test expectations before implementation
- [ ] implementation procedure or algorithm, not only acceptance criteria
- [ ] targeted `bun test` command and expected pass result
- [ ] `bun run agent:check` before handoff
- [ ] a commit step for the task's owned files

For tasks that remain large because the domain is large, split by finite subdomain rather than reducing production coverage. Splitting is allowed; shipping a partial AArch64 backend is not.

All identifier-bearing records in this backend use `stableKey` as their canonical identity field. Human-readable fields may use `displayName`, but tests and cross-task contracts must not drift between `stableKey`, `key`, and `name`.

Shared helpers live in Task 5A. Task-local `*ForTest` helpers may exist only inside the task's test file unless a later task imports them; imported helpers must be promoted to `tests/support/target/aarch64/backend/` with a declared signature first.

## Global Task Packet Template

Every task below uses this execution shape unless it has a stricter task-local **Execution Steps** section. The task-local section wins when present.

- [ ] **Step 1: Write the first failing test.** Use the test file named in **Files** and the first code example in the task. Expected failure is a missing exported symbol, missing fixture helper, or explicit diagnostic mismatch named in the task.
- [ ] **Step 2: Declare the public contract.** Add only the exported types, branded IDs, fixture signatures, and function signatures consumed by downstream tasks. Keep implementation bodies minimal until the failing test proves the contract.
- [ ] **Step 3: Implement the deterministic happy path.** Make the first test pass with frozen records, stable ordering, dependency-injected fakes, and no filesystem or process/environment reads in runtime source.
- [ ] **Step 4: Add the negative fixture tests named in acceptance criteria.** Each diagnostic assertion must check `stableDetail`, not only the diagnostic code.
- [ ] **Step 5: Implement the negative paths and normalization.** Reject malformed inputs with `{ kind: "error" }`, sort diagnostics deterministically, and preserve immutable input records.
- [ ] **Step 6: Run the task command.** Run the exact `bun test ...` command in the task and confirm PASS.
- [ ] **Step 7: Run the handoff gate.** Run `bun run agent:check`. If unrelated repository errors block the gate, record the exact failing files and continue only after the task-specific test passes.
- [ ] **Step 8: Commit the task.** Commit only the files listed in the task with a focused message. Automation commits must include `-Codex Automated`.

## Parallel Execution Model

Tasks are atomic with respect to ownership, but not equal in effort. The true critical path is ABI -> allocation -> frame/finalization and catalog -> encoding -> layout/object; staffing should expect peak parallel width to collapse on those spines. Subagents may work tasks in the same wave in parallel only after all dependency tasks are complete and only when their files do not conflict.

```text
Wave 1 foundation:
  Task 1 shared fact extension core
  Task 2 backend diagnostics and stable ids

Wave 2 contract roots:
  Task 3 backend object module types depends on Task 2
  Task 4 backend target surface catalog interfaces/authentication depends on Task 2
  Task 5 closed-image backend plan model/verifier depends on Task 2
  Task 6 migrate OptIR fact registry to shared core depends on Task 1
  Task 7 expand AArch64 machine fact re-keying depends on Task 1

Wave 3 handoff fixtures and API:
  Task 5A shared backend test fixtures and contract lockfile depends on Tasks 2-5
  Task 8 backend public API and full pipeline shell depends on Tasks 2-5 and 5A
  Task 9 input contract verifier depends on Tasks 1, 2, 4, 5, 5A, 7, 8

Wave 4 rewrite/facts/security/registers:
  Task 10 backend fact import/query depends on Tasks 1, 2, 5A, 7, 9
  Task 11 rewrite transaction and provenance transfer depends on Tasks 2, 3, 10
  Task 12 security label conservation depends on Tasks 4, 10, 11
  Task 13 physical register model depends on Task 4

Wave 5 ABI and allocation:
  Task 14 public ABI classification depends on Tasks 5, 5A, 13
  Task 15 private ABI reconciliation depends on Tasks 5, 13, 14
  Task 16 liveness and interference depends on Tasks 10, 13, 15
  Task 17 allocator worklist depends on Task 16
  Task 18 spill and rematerialization depends on Tasks 11, 12, 17
  Task 19 move resolution depends on Tasks 11, 13, 17
  Task 20 allocation verifier depends on Tasks 12, 13, 16-19

Wave 6 frame and physicalization:
  Task 21 stack frame layout depends on Tasks 12, 13, 18, 20
  Task 22 prologue, epilogue, tail, trap, and noreturn finalization depends on Task 21
  Task 23 unwind planning depends on Tasks 4, 21, 22
  Task 24 physical instruction IR and pseudo expansion depends on Tasks 11, 21, 22
  Task 25 post-allocation scheduler and peepholes depends on Tasks 12, 24

Wave 7 encoding/object:
  Task 26A production backend catalog data depends on Tasks 4, 13, 23, 24
  Task 26 encoding catalog authentication depends on Tasks 4, 26A
  Task 27 integer, branch, and control encoder depends on Tasks 24, 26
  Task 28 load/store, address, atomic, barrier, SIMD, FP encoder depends on Tasks 24, 26
  Task 29 relocation records depends on Tasks 3, 4, 24, 26A
  Task 30 branch relaxation, literal pools, and veneers depends on Tasks 11, 24, 29
  Task 31 layout-and-encode fixed point depends on Tasks 27-30
  Task 32 object verifier depends on Tasks 3, 12, 20, 23, 31

Wave 8 integration:
  Task 33 debug artifacts and provenance dumps depends on Tasks 3, 10, 11, 31, 32
  Task 34 end-to-end compile integration and deterministic acceptance depends on every prior task
```

Every subagent must:

```bash
bun test ./tests/unit/target/aarch64/<focused-test>.test.ts
bun run agent:check
```

Run `bun run format` before large handoffs when formatting changed.

## Planned File Structure

Create these new backend modules. Keep source dependency-free and small.

```text
src/shared/facts/
  compiler-fact-extension.ts
  fact-diagnostics.ts
  fact-transfer.ts
  index.ts

src/target/aarch64/backend/
  api/
    compile-aarch64-object.ts
    backend-pipeline.ts
    backend-catalog-interfaces.ts
    backend-target-surface.ts
    closed-image-backend-plan.ts
    diagnostics.ts
    ids.ts
    physical-register-model.ts
    verification-summary.ts
  catalogs/
    rpi5-backend-catalog-data.ts
    known-byte-fixtures.ts
  facts/
    backend-fact-import.ts
    backend-fact-query.ts
    backend-fact-subjects.ts
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
    allocation-result.ts
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
    encoding-catalog.ts
    encoding-core.ts
    encoding-integer-branch.ts
    encoding-memory-simd-fp.ts
    encoding.ts
    relocation-records.ts
    layout-encode-fixed-point.ts
    branch-relaxation.ts
    literal-pools.ts
    veneers.ts
    object-module.ts
  verify/
    input-contract-verifier.ts
    allocation-verifier.ts
    frame-verifier.ts
    security-verifier.ts
    encoding-object-verifier.ts

tests/support/target/aarch64/backend/
  backend-fixtures.ts
  backend-fixture-contract.ts
  backend-target-surface-fakes.ts
  closed-image-plan-fakes.ts
  object-module-fixtures.ts

tests/unit/shared/facts/
  compiler-fact-extension.test.ts
  fact-transfer.test.ts

tests/unit/target/aarch64/backend/
  backend-public-api.test.ts
  backend-input-contract.test.ts
  backend-target-surface.test.ts
  closed-image-backend-plan.test.ts
  backend-fact-import.test.ts
  backend-rewrite-transaction.test.ts
  security-label-conservation.test.ts
  physical-register-model.test.ts
  abi-classification.test.ts
  private-abi-reconciliation.test.ts
  liveness-interference.test.ts
  allocator.test.ts
  spill-remat.test.ts
  move-resolution.test.ts
  allocation-verifier.test.ts
  frame-layout.test.ts
  prologue-epilogue.test.ts
  unwind-plan.test.ts
  physical-instruction-ir.test.ts
  post-ra-scheduler.test.ts
  encoding-catalog.test.ts
  encoding-integer-branch.test.ts
  encoding-memory-simd-fp.test.ts
  relocation-records.test.ts
  layout-encode-fixed-point.test.ts
  object-module.test.ts
  object-verifier.test.ts
  backend-end-to-end.test.ts
```

Modify these existing modules only where needed to export the backend API or instantiate the shared fact mechanism:

```text
src/opt-ir/facts/fact-extension-registry.ts
src/opt-ir/facts/fact-preservation.ts
src/target/aarch64/facts/aarch64-fact-adapter.ts
src/target/aarch64/facts/aarch64-fact-query.ts
src/target/aarch64/facts/aarch64-fact-rekeying.ts
src/target/aarch64/machine-ir/fact-set.ts
src/target/aarch64/index.ts
src/target/aarch64/public-api.ts
src/target/index.ts
tests/support/target/aarch64/facts/opt-ir-facts.ts
tests/support/target/aarch64/machine-ir/builders.ts
tests/support/target/aarch64/target-surface/fakes.ts
```

## Existing Module Reconciliation

The backend is a new subsystem, but it must not duplicate authority that already exists in the AArch64 target. Each overlapping task must either reuse the existing module below, extend it behind a backend-specific adapter, or document why the old module is only provisional lowering metadata.

```text
Existing module                                           Backend owner
src/target/aarch64/machine-ir/abi-location.ts             Tasks 14-15 interpret current locations as provisional ABI intent only.
src/target/aarch64/lower/abi-lowering.ts                  Tasks 14-15 reuse tested AAPCS64 constants and fixtures, but final classification lives in backend/abi.
src/target/aarch64/machine-ir/resources.ts                Tasks 13, 16, 20 reuse resource stable-key vocabulary for aliases, NZCV, FPCR/FPSR, and vector state.
src/target/aarch64/machine-ir/rematerialization.ts        Tasks 10, 18 import existing remat records as fact-backed rematerialization authorities.
src/target/aarch64/plan/rematerialization-marking.ts      Task 18 treats this as pre-RA authority discovery, not final spill repair.
src/target/aarch64/lower/security-label-lowering.ts       Tasks 10, 12 import existing labels, then backend/security owns conservation after rewrites.
src/target/aarch64/plan/barrier-placement.ts              Tasks 16, 25 reuse dependency/resource summaries and hard-barrier semantics.
src/target/aarch64/plan/adrp-page-base-cse.ts             Tasks 18, 24, 25 reuse page-base pairing constraints and provenance.
src/target/aarch64/plan/literal-pool-planning.ts          Task 30 adapts existing literal identity planning into final section-local islands.
src/target/aarch64/machine-ir/relocation-reference.ts     Tasks 24, 29 reuse relocation reference identities before object relocation records are created.
```

If a task creates a backend file that overlaps one of these modules, its tests must include an adapter/reuse case. New backend code may refine or make final decisions, but it must not create a second incompatible vocabulary.

## Algorithm Contracts

The following algorithm contracts are pre-decided. Task implementations must match these contracts and add the fixture matrices named here.

### Public ABI Classification

Task 14 implements AAPCS64 classification as a pure three-stage function over machine ABI intent and authenticated target catalogs:

1. **Stage A: normalize values.** Convert every parameter and result to one of `integerLike`, `fpScalar`, `simdVector`, `hfa`, `hva`, `aggregateRegisterCandidate`, `aggregateIndirect`, or `unsupported`. Compute size, alignment, field composition, and target vector-state policy here. Reject variadic and scalable-vector values for this profile with deterministic diagnostics.
2. **Stage B: prepare cursors.** Initialize `NGRN = 0`, `NSRN = 0`, `NSAA = 0`, and an optional indirect result location. Use x8 for large or non-register returns before parameter assignment. Round stack cursor for over-aligned values before assigning them.
3. **Stage C: assign locations.** Assign integer-like values to x0-x7, FP/SIMD/HFA/HVA values to v0-v7 when available, otherwise stack-pass with 8-byte slot rounding and final 16-byte outgoing stack alignment. Record tied multi-register groups before allocator handoff.

Required fixtures: scalar x0-x7, ninth integer stack arg, FP/SIMD v0-v7, HFA, HVA, large aggregate x8, over-aligned stack arg, multi-register return, firmware call, x18 rejection, variadic rejection, scalable-vector rejection.

### Liveness And Allocation

Tasks 16-20 implement allocation as a finite repair loop:

1. Build live intervals with backward dataflow over stable block order.
2. Insert legal split points at block boundaries, call boundaries, fixed operands, loop headers/latches, ownership deaths, terminal edges, remat points, and security boundaries.
3. Build interference from interval overlap plus physical alias sets.
4. Allocate with deterministic priority `(mustAllocateBeforeUse, loopDepth desc, spillCost desc, useDensity desc, liveRangeStableKey, vregStableKey)`.
5. Apply actions in this order: assign, coalesce, split, rematerialize, spill, fail.
6. Prove termination by lexicographic decrease of `(unprocessedIntervals, unsplitIntervals, remainingCutPoints, unresolvedRepairRequests, frozenEpisodeCount)`.
7. Verify allocation, security, ABI, call clobbers, fixed resources, spills/remats, and moves before frame layout.

Required fixtures: straight-line, branch join, call-crossing split, no-spill pressure, copy coalesce, security-blocked coalesce, remat wins, remat rejected by relocation pair, spill wipe obligations, x/w alias, SIMD alias, x18 assignment rejection.

### Parallel Copy Resolution

Task 19 resolves copy webs using the standard deterministic graph algorithm:

1. Drop identity moves.
2. Reject conflicting duplicate destinations.
3. Emit acyclic moves by repeatedly selecting destinations that are not live sources in the remaining graph.
4. For cycles, choose the first legal register temporary after removing unavailable veneer scratch, fixed operands, live-through clobbers, and registers holding no-spill values.
5. Break the cycle with `cycleSource -> temporary`, rotate cycle moves, then restore `temporary -> finalDestination`.
6. Use memory swap only when every value permits memory placement and security policy approves the temporary slot.

Required fixtures: acyclic copy, two-register swap, three-register cycle, ABI incoming moves, ABI result moves, tied operand repair, IP0/IP1 unavailable, no-spill memory-swap rejection.

### Layout, Relaxation, And Encoding

Tasks 26A-32 implement layout as a finite monotone fixed point:

1. Build initial stable sections/fragments with tentative 4-byte instruction sizes.
2. Encode using current decisions and catalog-only bitfield emitters.
3. Compute offsets, relocation holes, branch distances, literal reach windows, veneer requirements, and byte provenance.
4. Ask branch, literal-pool, and veneer planners for grow-only decisions.
5. Reiterate only when a decision changes from `unchanged` to `expanded`, `veneer-requested`, `linker-owned`, or `range-exhausted`.
6. Stop successfully when no decisions change. Stop with a deterministic diagnostic if a site reaches `range-exhausted`.
7. Emit encoded fragments and relocation records together. Object verifier re-decodes bytes and checks relocation patch ownership.

Required fixtures: one-pass layout, branch widening, conditional invert-and-branch, test-branch expansion, literal island split, literal security rejection, backend-owned veneer, linker-owned veneer, undeclared scratch, patch-offset update after growth, range exhaustion, byte provenance gap.

### Security Conservation

Task 12 owns security labels as an image over rewrites:

1. Import labels from backend facts and rewrite transaction subject maps.
2. Check no-spill before any repair inserts memory, literal, stack, or rematerialized storage.
3. Propagate wipe-on-spill obligations to every observable exit.
4. Prove wipe dominance before return, error, tail call, noreturn, trap, reuse, and veneer exits.
5. Check constant-time catalog policy for secret operands, secret branches, table indices, memory addresses, call targets, helper calls, and rematerialization.
6. Emit one verifier result consumed by allocation, frame, finalization, object verifier, and end-to-end tests.

Required fixtures: no-spill assign success, no-spill spill rejection, wipe before ordinary return, wipe before error exit, wipe before tail call, wipe before noreturn, secret table rejection, secret branch rejection, approved helper, veneer wipe path.

## Reference Algorithms Appendix

These algorithms are normative for the implementation tasks. They are TypeScript-shaped reference procedures, not sketches. Workers may split helper functions differently, but the observable ordering, diagnostics, progress measures, authority checks, and fixture coverage must match these algorithms.

Research anchors used here:

- AAPCS64 supplies the public call classification shape: Stage A initialization, Stage B argument/result preparation, Stage C register and stack assignment, x0-x7/v0-v7 public argument locations, x8 indirect result location, HFA/HVA treatment, natural alignment, and stack rounding.
- Arm A64 instruction descriptions supply the encoded branch/literal reach constants used by layout: `b`/`bl` `imm26` scaled by 4, conditional branch and compare-and-branch `imm19` scaled by 4, test-and-branch `imm14` scaled by 4, and PC-relative page/address immediate families.
- Microsoft PE/COFF ARM64 relocation definitions supply the final-writer relocation names accepted by the relocation catalog.
- Wrela's design supplies the proof-to-bytes cascade, closed-image private ABI authority, transaction-owned rewrites, and one security label-conservation invariant.

Shared helper conventions used in the reference code:

```ts
type StableKey = string;

interface StableDiagnostic {
  readonly code: string;
  readonly stableDetail: string;
  readonly provenance: readonly StableKey[];
}

type Result<T> =
  | { readonly kind: "ok"; readonly value: T; readonly diagnostics: readonly StableDiagnostic[] }
  | { readonly kind: "error"; readonly diagnostics: readonly StableDiagnostic[] };

function ok<T>(value: T, diagnostics: readonly StableDiagnostic[] = []): Result<T> {
  return { kind: "ok", value, diagnostics };
}

function error(
  code: string,
  stableDetail: string,
  provenance: readonly StableKey[],
): Result<never> {
  return { kind: "error", diagnostics: [{ code, stableDetail, provenance }] };
}

function stableSortBy<T>(items: readonly T[], keyOf: (item: T) => readonly string[]): readonly T[] {
  return [...items].sort((left, right) => {
    const leftKey = keyOf(left);
    const rightKey = keyOf(right);
    for (let index = 0; index < Math.min(leftKey.length, rightKey.length); index += 1) {
      if (leftKey[index] < rightKey[index]) return -1;
      if (leftKey[index] > rightKey[index]) return 1;
    }
    return leftKey.length - rightKey.length;
  });
}

function alignTo(value: bigint, alignment: bigint): bigint {
  return ((value + alignment - 1n) / alignment) * alignment;
}
```

The reference algorithms call task-owned helpers. These helper names are closed contracts, not extra design work:

| Helper                                                                                           | Owning task family | Required behavior                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------ | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `recognizeHomogeneousAggregate(value, mode)`                                                     | Task 14            | Return `{ kind: "ok", value: { memberCount } }` only for 1-4 same-kind FP or SIMD members accepted by the authenticated profile; otherwise return a deterministic non-match result.                           |
| `flattenResultClasses(results)`                                                                  | Task 14            | Preserve source result order, flatten tied multi-result groups, and set `indirectRequired` when any public result cannot be represented in x0-x7/v0-v7 under the accepted profile.                            |
| `assignSingleGeneralOrStack(valueKey, size, cursor, groupKey)`                                   | Task 14            | Allocate one x0-x7 slot for an integer/pointer value when available; otherwise align `nextStackOffset` to 8, emit one stack location, and advance by the rounded size.                                        |
| `assignConsecutiveGeneralsOrStack(valueKey, slots, size, alignment, cursor, groupKey)`           | Task 14            | Allocate all required consecutive GPR slots only when the full value fits. For 16-byte integer-like values, first round `NGRN` to an even register. Otherwise set `NGRN` to 8 and stack-pass the whole value. |
| `alignStackCursor`, `stackLocation`, `stackPaddingMarker`                                        | Task 14            | Produce deterministic stack ABI records with final outgoing argument stack aligned to 16 bytes.                                                                                                               |
| `groupBy`                                                                                        | Tasks 10, 12       | Group by stable string key while preserving stable-sorted value order within each group.                                                                                                                      |
| `observableExitsReachableFrom`                                                                   | Task 12            | Return all observable exits reachable from an instruction in stable CFG order, including synthetic veneer, trap, noreturn, firmware, and error exits.                                                         |
| `everyPathHasWipeBetween`                                                                        | Task 12            | Return true only when every CFG path from source to exit contains a wipe event for the exact subject before the observable exit.                                                                              |
| `initialAllocationEpisode`, `allocationProgress`, `rebuildEpisodeAfterRepair`                    | Tasks 16-18        | Rebuild liveness after each committed repair and compute the lexicographic progress tuple used for the termination proof.                                                                                     |
| `legalRegistersForInterval`, `firstNonInterferingRegister`                                       | Tasks 13, 17       | Filter x18, SP/ZR misuse, alias conflicts, call clobbers, fixed operands, vector/FP authorization, and private ABI clobber policy before choosing the first stable legal register.                            |
| `tryCoalesce`, `trySplitAtFirstLegalCutPoint`, `tryRematerialize`, `trySpillWithWipeObligations` | Tasks 17-18        | Execute the fixed repair order, return only transaction-ready repair requests, and preserve no-spill, wipe, relocation-pair, and provenance constraints.                                                      |
| `emitMoveThroughRewrite`, `emitMemorySwapThroughRewrite`                                         | Tasks 11, 19       | Emit physical moves only by committing rewrite transactions that transfer facts, security labels, dependencies, and provenance.                                                                               |
| `chooseLegalTemporary`, `chooseSecurityApprovedMemorySwap`                                       | Tasks 13, 19       | Exclude unavailable scratch registers, fixed operands, live-through clobbers, no-spill values, and security-incompatible spill slots.                                                                         |
| `encodeFragmentsWithCatalogOnly`                                                                 | Tasks 26-28, 31    | Encode only authenticated catalog rows; reject missing forms, illegal immediates, SP/ZR ambiguity, feature gates, security policy conflicts, and unresolved relocation holes.                                 |
| `analyzeReachAndRelocations`, `growLayoutDecisions`                                              | Tasks 29-31        | Compute exact branch/literal/relocation reach, then transition decisions only forward in the monotone lattice.                                                                                                |
| `assembleObjectModule`, `verifyEncodedObjectModule`                                              | Tasks 31-32        | Emit bytes, relocation records, byte provenance, unwind records, and verification summaries together; then re-check the final object from scratch.                                                            |
| `decodeWithAuthenticatedCatalog`                                                                 | Task 32            | Re-decode final bytes through the authenticated catalog subset used for emission; never shell out to an external disassembler in runtime source.                                                              |
| `targetMemoryOrderSequence`                                                                      | Tasks 4, 22, 25    | Convert Wrela memory-order facts into the exact target-authorized acquire/release/barrier/MMIO sequence or a deterministic diagnostic.                                                                        |

### Reference Algorithm 1: Public ABI Classification

**Owned by:** Tasks 14, 15, 20, 34.

**Why this is Wrela-specific:** The public ABI classifier must implement AAPCS64 for real boundaries while rejecting Wrela profile escapes before allocation. It also preserves Wrela machine facts by emitting stable ABI location groups for tied multi-register returns, x8 indirect results, firmware calls, and private ABI reconciliation.

```ts
interface AbiValueIntent {
  readonly stableKey: StableKey;
  readonly role: "parameter" | "result";
  readonly typeKey: StableKey;
  readonly byteSize: bigint;
  readonly byteAlignment: bigint;
  readonly scalarKind?: "integer" | "pointer" | "bool" | "fp32" | "fp64" | "simd64" | "simd128";
  readonly aggregate?: {
    readonly fields: readonly AbiValueIntent[];
    readonly isHfaCandidate: boolean;
    readonly isHvaCandidate: boolean;
  };
  readonly isVariadicMarker?: boolean;
  readonly isScalableVector?: boolean;
}

interface AbiCursor {
  readonly nextGeneralRegister: number;
  readonly nextSimdRegister: number;
  readonly nextStackOffset: bigint;
}

interface AbiLocation {
  readonly stableKey: StableKey;
  readonly valueKey: StableKey;
  readonly kind:
    | "general-register"
    | "simd-register"
    | "stack"
    | "indirect-result-pointer"
    | "unsupported";
  readonly register?: `x${number}` | `v${number}`;
  readonly stackOffset?: bigint;
  readonly byteSize: bigint;
  readonly tiedGroupKey?: StableKey;
}

interface ClassifiedAbiValue {
  readonly value: AbiValueIntent;
  readonly class:
    | "integerLike"
    | "fpScalar"
    | "simdVector"
    | "hfa"
    | "hva"
    | "aggregateRegisterCandidate"
    | "aggregateIndirect"
    | "unsupported";
  readonly eightByteSlots: number;
  readonly simdSlots: number;
  readonly effectiveAlignment: bigint;
}

function classifyPublicAbi(
  signatureStableKey: StableKey,
  parameters: readonly AbiValueIntent[],
  results: readonly AbiValueIntent[],
): Result<{
  readonly parameters: readonly AbiLocation[];
  readonly results: readonly AbiLocation[];
}> {
  for (const value of [...parameters, ...results]) {
    if (value.isVariadicMarker === true) {
      return error(
        "abi:variadic-unsupported",
        `abi:variadic:${signatureStableKey}:${value.stableKey}`,
        [signatureStableKey, value.stableKey],
      );
    }
    if (value.isScalableVector === true) {
      return error(
        "abi:scalable-vector-unsupported",
        `abi:scalable-vector:${signatureStableKey}:${value.stableKey}`,
        [signatureStableKey, value.stableKey],
      );
    }
  }

  const classifiedResults = results.map(normalizePublicAbiValue);
  const resultLocations = classifyResultLocations(signatureStableKey, classifiedResults);
  if (resultLocations.kind === "error") return resultLocations;

  const classifiedParameters = parameters.map(normalizePublicAbiValue);
  const parameterLocations = assignPublicParameterLocations(
    signatureStableKey,
    classifiedParameters,
    {
      nextGeneralRegister: 0,
      nextSimdRegister: 0,
      nextStackOffset: 0n,
    },
  );
  if (parameterLocations.kind === "error") return parameterLocations;

  return ok({
    parameters: parameterLocations.value,
    results: resultLocations.value,
  });
}

function normalizePublicAbiValue(value: AbiValueIntent): ClassifiedAbiValue {
  const effectiveAlignment = value.byteAlignment > 16n ? 16n : value.byteAlignment;
  const eightByteSlots = Number(alignTo(value.byteSize, 8n) / 8n);

  if (value.scalarKind === "fp32" || value.scalarKind === "fp64") {
    return { value, class: "fpScalar", eightByteSlots: 1, simdSlots: 1, effectiveAlignment };
  }
  if (value.scalarKind === "simd64" || value.scalarKind === "simd128") {
    return { value, class: "simdVector", eightByteSlots, simdSlots: 1, effectiveAlignment };
  }
  if (value.scalarKind !== undefined) {
    return {
      value,
      class: "integerLike",
      eightByteSlots: Math.max(1, eightByteSlots),
      simdSlots: 0,
      effectiveAlignment,
    };
  }

  const hfa = recognizeHomogeneousAggregate(value, "fp");
  if (hfa.kind === "ok") {
    return {
      value,
      class: "hfa",
      eightByteSlots,
      simdSlots: hfa.value.memberCount,
      effectiveAlignment,
    };
  }

  const hva = recognizeHomogeneousAggregate(value, "simd");
  if (hva.kind === "ok") {
    return {
      value,
      class: "hva",
      eightByteSlots,
      simdSlots: hva.value.memberCount,
      effectiveAlignment,
    };
  }

  if (value.byteSize <= 16n) {
    return {
      value,
      class: "aggregateRegisterCandidate",
      eightByteSlots: Math.max(1, eightByteSlots),
      simdSlots: 0,
      effectiveAlignment,
    };
  }

  return { value, class: "aggregateIndirect", eightByteSlots: 1, simdSlots: 0, effectiveAlignment };
}

function classifyResultLocations(
  signatureStableKey: StableKey,
  results: readonly ClassifiedAbiValue[],
): Result<readonly AbiLocation[]> {
  if (results.length === 0) return ok([]);

  const tiedGroupKey = `abi-result-group:${signatureStableKey}`;
  const flattened = flattenResultClasses(results);

  if (flattened.indirectRequired) {
    return ok([
      {
        stableKey: `abi-result:x8:${signatureStableKey}`,
        valueKey: tiedGroupKey,
        kind: "indirect-result-pointer",
        register: "x8",
        byteSize: 8n,
        tiedGroupKey,
      },
    ]);
  }

  const locations: AbiLocation[] = [];
  let nextGeneralRegister = 0;
  let nextSimdRegister = 0;

  for (const value of flattened.values) {
    if (
      value.class === "fpScalar" ||
      value.class === "simdVector" ||
      value.class === "hfa" ||
      value.class === "hva"
    ) {
      if (nextSimdRegister + value.simdSlots > 8) {
        return error(
          "abi:result-too-large",
          `abi:result-registers:${signatureStableKey}:${value.value.stableKey}`,
          [signatureStableKey, value.value.stableKey],
        );
      }
      for (let slot = 0; slot < value.simdSlots; slot += 1) {
        locations.push({
          stableKey: `abi-result:v${nextSimdRegister}:${value.value.stableKey}:${slot}`,
          valueKey: value.value.stableKey,
          kind: "simd-register",
          register: `v${nextSimdRegister}`,
          byteSize: value.value.byteSize,
          tiedGroupKey,
        });
        nextSimdRegister += 1;
      }
      continue;
    }

    if (nextGeneralRegister + value.eightByteSlots > 8) {
      return error(
        "abi:result-too-large",
        `abi:result-registers:${signatureStableKey}:${value.value.stableKey}`,
        [signatureStableKey, value.value.stableKey],
      );
    }
    for (let slot = 0; slot < value.eightByteSlots; slot += 1) {
      locations.push({
        stableKey: `abi-result:x${nextGeneralRegister}:${value.value.stableKey}:${slot}`,
        valueKey: value.value.stableKey,
        kind: "general-register",
        register: `x${nextGeneralRegister}`,
        byteSize: 8n,
        tiedGroupKey,
      });
      nextGeneralRegister += 1;
    }
  }

  return ok(locations);
}

function assignPublicParameterLocations(
  signatureStableKey: StableKey,
  values: readonly ClassifiedAbiValue[],
  initialCursor: AbiCursor,
): Result<readonly AbiLocation[]> {
  let cursor = initialCursor;
  const locations: AbiLocation[] = [];

  for (const classified of values) {
    const tiedGroupKey = `abi-param-group:${signatureStableKey}:${classified.value.stableKey}`;

    if (classified.class === "aggregateIndirect") {
      const assigned = assignSingleGeneralOrStack(
        classified.value.stableKey,
        8n,
        cursor,
        tiedGroupKey,
      );
      cursor = assigned.cursor;
      locations.push(assigned.location);
      continue;
    }

    if (
      classified.class === "fpScalar" ||
      classified.class === "simdVector" ||
      classified.class === "hfa" ||
      classified.class === "hva"
    ) {
      if (cursor.nextSimdRegister + classified.simdSlots <= 8) {
        for (let slot = 0; slot < classified.simdSlots; slot += 1) {
          locations.push({
            stableKey: `abi-param:v${cursor.nextSimdRegister}:${classified.value.stableKey}:${slot}`,
            valueKey: classified.value.stableKey,
            kind: "simd-register",
            register: `v${cursor.nextSimdRegister}`,
            byteSize: classified.value.byteSize,
            tiedGroupKey,
          });
          cursor = { ...cursor, nextSimdRegister: cursor.nextSimdRegister + 1 };
        }
      } else {
        cursor = { ...cursor, nextSimdRegister: 8 };
        cursor = alignStackCursor(cursor, classified.effectiveAlignment);
        const stackByteSize = alignTo(classified.value.byteSize, 8n);
        locations.push(
          stackLocation(
            classified.value.stableKey,
            stackByteSize,
            cursor.nextStackOffset,
            tiedGroupKey,
          ),
        );
        cursor = {
          ...cursor,
          nextStackOffset: cursor.nextStackOffset + stackByteSize,
        };
      }
      continue;
    }

    const assigned = assignConsecutiveGeneralsOrStack(
      classified.value.stableKey,
      classified.eightByteSlots,
      classified.value.byteSize,
      classified.effectiveAlignment,
      cursor,
      tiedGroupKey,
    );
    cursor = assigned.cursor;
    locations.push(...assigned.locations);
  }

  const finalStackSize = alignTo(cursor.nextStackOffset, 16n);
  return ok(
    finalStackSize === cursor.nextStackOffset
      ? locations
      : [
          ...locations,
          stackPaddingMarker(
            signatureStableKey,
            cursor.nextStackOffset,
            finalStackSize - cursor.nextStackOffset,
          ),
        ],
  );
}

function assignSingleGeneralOrStack(
  valueKey: StableKey,
  byteSize: bigint,
  cursor: AbiCursor,
  tiedGroupKey: StableKey,
): { readonly location: AbiLocation; readonly cursor: AbiCursor } {
  if (cursor.nextGeneralRegister < 8) {
    const register = `x${cursor.nextGeneralRegister}` as `x${number}`;
    return {
      location: {
        stableKey: `abi-param:${register}:${valueKey}`,
        valueKey,
        kind: "general-register",
        register,
        byteSize,
        tiedGroupKey,
      },
      cursor: { ...cursor, nextGeneralRegister: cursor.nextGeneralRegister + 1 },
    };
  }

  const stackCursor = alignStackCursor(cursor, 8n);
  return {
    location: stackLocation(valueKey, byteSize, stackCursor.nextStackOffset, tiedGroupKey),
    cursor: {
      ...stackCursor,
      nextStackOffset: stackCursor.nextStackOffset + alignTo(byteSize, 8n),
    },
  };
}

function assignConsecutiveGeneralsOrStack(
  valueKey: StableKey,
  eightByteSlots: number,
  byteSize: bigint,
  effectiveAlignment: bigint,
  cursor: AbiCursor,
  tiedGroupKey: StableKey,
): { readonly locations: readonly AbiLocation[]; readonly cursor: AbiCursor } {
  const registerCursor =
    effectiveAlignment >= 16n && cursor.nextGeneralRegister % 2 !== 0
      ? { ...cursor, nextGeneralRegister: cursor.nextGeneralRegister + 1 }
      : cursor;

  if (registerCursor.nextGeneralRegister + eightByteSlots <= 8) {
    const locations: AbiLocation[] = [];
    for (let slot = 0; slot < eightByteSlots; slot += 1) {
      const registerNumber = registerCursor.nextGeneralRegister + slot;
      const register = `x${registerNumber}` as `x${number}`;
      locations.push({
        stableKey: `abi-param:${register}:${valueKey}:${slot}`,
        valueKey,
        kind: "general-register",
        register,
        byteSize: 8n,
        tiedGroupKey,
      });
    }
    return {
      locations,
      cursor: {
        ...registerCursor,
        nextGeneralRegister: registerCursor.nextGeneralRegister + eightByteSlots,
      },
    };
  }

  const stackCursor = alignStackCursor({ ...cursor, nextGeneralRegister: 8 }, effectiveAlignment);
  return {
    locations: [
      stackLocation(valueKey, alignTo(byteSize, 8n), stackCursor.nextStackOffset, tiedGroupKey),
    ],
    cursor: {
      ...stackCursor,
      nextStackOffset: stackCursor.nextStackOffset + alignTo(byteSize, 8n),
    },
  };
}
```

Required implementation fixtures beyond the task-local examples:

```ts
test("public ABI uses x8 for indirect results before assigning parameters", () => {
  const result = classifyPublicAbi(
    "sig:large-return",
    [u64ForTest("arg0")],
    [aggregateForTest("ret", 24n, 8n)],
  );
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected ABI classification");
  expect(result.value.results.map((location) => location.register)).toEqual(["x8"]);
  expect(result.value.parameters.map((location) => location.register)).toEqual(["x0"]);
});

test("public ABI rejects scalable vectors before private ABI reconciliation", () => {
  const result = classifyPublicAbi("sig:sv", [scalableVectorForTest("arg0")], []);
  expect(result).toEqual({
    kind: "error",
    diagnostics: [
      {
        code: "abi:scalable-vector-unsupported",
        stableDetail: "abi:scalable-vector:sig:sv:arg0",
        provenance: ["sig:sv", "arg0"],
      },
    ],
  });
});

test("public ABI stack-passes a two-slot aggregate instead of splitting x7 plus stack", () => {
  const result = classifyPublicAbi(
    "sig:aggregate-overflow",
    [
      u64ForTest("arg0"),
      u64ForTest("arg1"),
      u64ForTest("arg2"),
      u64ForTest("arg3"),
      u64ForTest("arg4"),
      u64ForTest("arg5"),
      u64ForTest("arg6"),
      aggregateForTest("pair", 16n, 8n),
    ],
    [],
  );
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected ABI classification");
  const pairLocations = result.value.parameters.filter((location) => location.valueKey === "pair");
  expect(pairLocations).toEqual([
    {
      stableKey: "abi-param:stack:pair:0",
      valueKey: "pair",
      kind: "stack",
      stackOffset: 0n,
      byteSize: 16n,
      tiedGroupKey: "abi-param-group:sig:aggregate-overflow:pair",
    },
  ]);
});
```

### Reference Algorithm 2: Wrela Rewrite Transaction And Fact Transfer

**Owned by:** Tasks 1, 7, 10, 11, 12, 18, 24, 30, 33.

**Why this is Wrela-specific:** This is the central proof-to-bytes algorithm. Known compiler rewrite algorithms do not know Wrela's checked fact packets, dropped-fact records, linear authority, proof-spent diagnostics, byte provenance, or security obligations. Every backend mutation must use this transaction so Wrela-specific facts cannot become stale after ordinary compiler rewrites.

```ts
type RewriteKind =
  | "instruction-local-replacement"
  | "block-local-rewrite"
  | "edge-block-split"
  | "live-range-repair-region"
  | "frame-layout-rewrite"
  | "section-fragment-layout-rewrite"
  | "whole-function-rewrite"
  | "closed-image-metadata-rewrite";

type FactTransferAction =
  | { readonly kind: "identity"; readonly toSubject: BackendSubject }
  | { readonly kind: "move"; readonly toSubject: BackendSubject }
  | { readonly kind: "split"; readonly toSubjects: readonly BackendSubject[] }
  | { readonly kind: "copy"; readonly toSubjects: readonly BackendSubject[] }
  | {
      readonly kind: "weaken";
      readonly toSubject: BackendSubject;
      readonly weakenedPayload: unknown;
    }
  | { readonly kind: "invalidate"; readonly droppedFactStableKey: StableKey }
  | { readonly kind: "reject"; readonly diagnostic: StableDiagnostic };

interface BackendSubject {
  readonly kind:
    | "machineFunction"
    | "machineBlock"
    | "machineInstruction"
    | "virtualRegister"
    | "physicalRegister"
    | "frameObject"
    | "spillSlot"
    | "memoryOperand"
    | "callSite"
    | "symbol"
    | "sectionFragment"
    | "relocationReference"
    | "literalPoolEntry"
    | "veneer"
    | "byteRange"
    | "droppedFactRecord";
  readonly stableKey: StableKey;
}

interface BackendFact {
  readonly stableKey: StableKey;
  readonly familyKey: StableKey;
  readonly subject: BackendSubject;
  readonly payload: unknown;
  readonly lineage: readonly StableKey[];
  readonly isLinearAuthority: boolean;
  readonly upstreamVerifierKey: StableKey;
}

interface RewriteRequest {
  readonly rewriteKind: RewriteKind;
  readonly stableKey: StableKey;
  readonly deletedSubjects: readonly BackendSubject[];
  readonly replacedSubjects: readonly BackendSubject[];
  readonly insertedSubjects: readonly BackendSubject[];
  readonly subjectMap: readonly {
    readonly from: BackendSubject;
    readonly to: readonly BackendSubject[];
  }[];
  readonly provenanceSources: readonly StableKey[];
}

function commitBackendRewriteTransaction(input: {
  readonly request: RewriteRequest;
  readonly factsBefore: readonly BackendFact[];
  readonly securityBefore: SecurityIndex;
  readonly provenanceBefore: ProvenanceIndex;
  readonly transferRegistry: FactTransferRegistry;
  readonly subjectIndexBefore: SubjectIndex;
  readonly allocateStableKey: (namespace: string, seed: readonly StableKey[]) => StableKey;
}): Result<{
  readonly factsAfter: readonly BackendFact[];
  readonly securityAfter: SecurityIndex;
  readonly provenanceAfter: ProvenanceIndex;
  readonly droppedFacts: readonly BackendFact[];
  readonly subjectIndexAfter: SubjectIndex;
}> {
  const subjectIndexAfter = buildSubjectIndexAfterRewrite(input.subjectIndexBefore, input.request);
  if (subjectIndexAfter.kind === "error") return subjectIndexAfter;

  const deletedSubjectKeys = new Set(
    input.request.deletedSubjects.map((subject) => subject.stableKey),
  );
  const affectedFacts = input.factsBefore.filter(
    (fact) =>
      deletedSubjectKeys.has(fact.subject.stableKey) ||
      subjectWasReplaced(fact.subject, input.request),
  );
  const unaffectedFacts = input.factsBefore.filter((fact) => !affectedFacts.includes(fact));

  const transferredFacts: BackendFact[] = [];
  const droppedFacts: BackendFact[] = [];

  for (const fact of stableSortBy(affectedFacts, (item) => [
    item.familyKey,
    item.subject.stableKey,
    item.stableKey,
  ])) {
    const rule = input.transferRegistry.lookup(fact.familyKey, input.request.rewriteKind);
    if (rule === undefined) {
      return error(
        "rewrite:missing-transfer-rule",
        `rewrite:transfer-missing:${input.request.rewriteKind}:${fact.familyKey}:${fact.subject.stableKey}`,
        [input.request.stableKey, fact.stableKey],
      );
    }

    const action = rule({
      fact,
      rewrite: input.request,
      subjectIndexAfter: subjectIndexAfter.value,
    });

    if (action.kind === "reject") return { kind: "error", diagnostics: [action.diagnostic] };

    if (action.kind === "invalidate") {
      droppedFacts.push({
        ...fact,
        stableKey: action.droppedFactStableKey,
        subject: {
          kind: "droppedFactRecord",
          stableKey: `dropped-fact:${action.droppedFactStableKey}`,
        },
      });
      continue;
    }

    const targets =
      action.kind === "split" || action.kind === "copy" ? action.toSubjects : [action.toSubject];
    if (fact.isLinearAuthority && targets.length !== 1) {
      return error(
        "rewrite:linear-authority-duplicated",
        `rewrite:linear-duplicate:${fact.familyKey}:${fact.subject.stableKey}`,
        [input.request.stableKey, fact.stableKey],
      );
    }

    for (const target of targets) {
      if (!subjectIndexAfter.value.has(target)) {
        return error(
          "rewrite:target-subject-missing",
          `rewrite:target-missing:${fact.familyKey}:${target.kind}:${target.stableKey}`,
          [input.request.stableKey, fact.stableKey, target.stableKey],
        );
      }
      transferredFacts.push({
        ...fact,
        stableKey: input.allocateStableKey("fact-transfer", [
          fact.stableKey,
          target.stableKey,
          input.request.stableKey,
        ]),
        subject: target,
        payload: action.kind === "weaken" ? action.weakenedPayload : fact.payload,
        lineage: [...fact.lineage, input.request.stableKey],
      });
    }
  }

  const security = conserveSecurityLabels({
    rewrite: input.request,
    securityBefore: input.securityBefore,
    factsBefore: input.factsBefore,
    factsAfter: [...unaffectedFacts, ...transferredFacts],
    subjectIndexAfter: subjectIndexAfter.value,
  });
  if (security.kind === "error") return security;

  const provenance = transferRewriteProvenance({
    rewrite: input.request,
    provenanceBefore: input.provenanceBefore,
    insertedSubjects: input.request.insertedSubjects,
    deletedSubjects: input.request.deletedSubjects,
    provenanceSources: input.request.provenanceSources,
  });
  if (provenance.kind === "error") return provenance;

  return ok({
    factsAfter: stableSortBy([...unaffectedFacts, ...transferredFacts], (fact) => [
      fact.familyKey,
      fact.subject.stableKey,
      fact.stableKey,
    ]),
    securityAfter: security.value,
    provenanceAfter: provenance.value,
    droppedFacts: stableSortBy(droppedFacts, (fact) => [fact.familyKey, fact.stableKey]),
    subjectIndexAfter: subjectIndexAfter.value,
  });
}
```

Required implementation fixtures beyond the task-local examples:

```ts
test("rewrite transaction rejects load-bearing fact without a transfer rule", () => {
  const result = commitBackendRewriteTransaction(
    rewriteTransactionInputForTest({
      rewriteKind: "live-range-repair-region",
      factsBefore: [noSpillFactForTest({ subject: virtualRegisterSubjectForTest("v:secret") })],
      transferRegistry: emptyFactTransferRegistryForTest(),
    }),
  );
  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected rewrite rejection");
  expect(result.diagnostics[0].stableDetail).toBe(
    "rewrite:transfer-missing:live-range-repair-region:security.no-spill:v:secret",
  );
});
```

### Reference Algorithm 3: Wrela Security Conservation

**Owned by:** Tasks 12, 18, 20, 21, 22, 25, 30, 32, 34.

**Why this is Wrela-specific:** This verifier is not a generic constant-time lint pass. It is the one rule set that converts Wrela proof facts into allocation, frame, finalization, veneer, literal-pool, and object-byte obligations. Other stages consume its result instead of reinterpreting security labels.

```ts
type ObservableExitKind =
  | "return"
  | "error-return"
  | "tail-call"
  | "noreturn-call"
  | "trap"
  | "veneer-branch"
  | "firmware-call";

interface SecurityObligation {
  readonly stableKey: StableKey;
  readonly subject: BackendSubject;
  readonly kind: "no-spill" | "wipe-on-spill" | "secret" | "key-lifetime" | "constant-time";
  readonly sourceFactKey: StableKey;
  readonly bornAtInstructionKey: StableKey;
  readonly deadAtInstructionKeys: readonly StableKey[];
}

interface SecurityEvent {
  readonly stableKey: StableKey;
  readonly kind:
    | "assigned-register"
    | "inserted-spill"
    | "inserted-reload"
    | "inserted-remat"
    | "literal-placement"
    | "table-access"
    | "conditional-branch"
    | "helper-call"
    | "wipe"
    | "observable-exit";
  readonly subject: BackendSubject;
  readonly instructionKey: StableKey;
  readonly exitKind?: ObservableExitKind;
}

function verifySecurityConservation(input: {
  readonly obligations: readonly SecurityObligation[];
  readonly events: readonly SecurityEvent[];
  readonly controlFlow: BackendControlFlowGraph;
  readonly catalog: AArch64BackendSecurityCatalog;
}): Result<SecurityVerificationSummary> {
  const diagnostics: StableDiagnostic[] = [];
  const eventsBySubject = groupBy(input.events, (event) => event.subject.stableKey);

  for (const obligation of stableSortBy(input.obligations, (item) => [
    item.kind,
    item.subject.stableKey,
    item.stableKey,
  ])) {
    const events = eventsBySubject.get(obligation.subject.stableKey) ?? [];

    if (obligation.kind === "no-spill") {
      for (const event of events) {
        if (event.kind === "inserted-spill" || event.kind === "literal-placement") {
          diagnostics.push({
            code: "security:no-spill-memory-placement",
            stableDetail: `security:no-spill-memory:${obligation.subject.stableKey}:${event.instructionKey}`,
            provenance: [obligation.sourceFactKey, event.stableKey],
          });
        }
      }
    }

    if (obligation.kind === "wipe-on-spill" || obligation.kind === "key-lifetime") {
      const spillEvents = events.filter((event) => event.kind === "inserted-spill");
      for (const spill of spillEvents) {
        const requiredExits = observableExitsReachableFrom(input.controlFlow, spill.instructionKey);
        for (const exit of requiredExits) {
          const wipeDominatesExit = everyPathHasWipeBetween({
            controlFlow: input.controlFlow,
            fromInstructionKey: spill.instructionKey,
            toInstructionKey: exit.instructionKey,
            subjectStableKey: obligation.subject.stableKey,
          });
          if (!wipeDominatesExit) {
            diagnostics.push({
              code: "security:wipe-not-dominating-exit",
              stableDetail: `security:wipe-missing:${obligation.subject.stableKey}:${spill.instructionKey}:${exit.exitKind}`,
              provenance: [obligation.sourceFactKey, spill.stableKey, exit.stableKey],
            });
          }
        }
      }
    }

    if (obligation.kind === "secret" || obligation.kind === "constant-time") {
      for (const event of events) {
        const policy = input.catalog.policyForSecurityEvent(event.kind);
        if (event.kind === "conditional-branch" && !policy.permitsSecretBranch) {
          diagnostics.push({
            code: "security:secret-dependent-branch",
            stableDetail: `security:secret-branch:${obligation.subject.stableKey}:${event.instructionKey}`,
            provenance: [obligation.sourceFactKey, event.stableKey],
          });
        }
        if (event.kind === "table-access" && !policy.permitsSecretTableIndex) {
          diagnostics.push({
            code: "security:secret-table-index",
            stableDetail: `security:secret-table:${obligation.subject.stableKey}:${event.instructionKey}`,
            provenance: [obligation.sourceFactKey, event.stableKey],
          });
        }
        if (
          event.kind === "helper-call" &&
          !policy.approvedConstantTimeHelpers.has(event.instructionKey)
        ) {
          diagnostics.push({
            code: "security:helper-not-authorized",
            stableDetail: `security:helper:${obligation.subject.stableKey}:${event.instructionKey}`,
            provenance: [obligation.sourceFactKey, event.stableKey],
          });
        }
      }
    }
  }

  const sortedDiagnostics = stableSortBy(diagnostics, (diagnostic) => [
    diagnostic.code,
    diagnostic.stableDetail,
  ]);
  if (sortedDiagnostics.length > 0) return { kind: "error", diagnostics: sortedDiagnostics };

  return ok({
    verifierKey: "security-label-conservation",
    checkedObligationKeys: input.obligations.map((obligation) => obligation.stableKey).sort(),
  });
}
```

Required implementation fixtures beyond the task-local examples:

```ts
test("wipe-on-spill must dominate veneer exits introduced during layout", () => {
  const result = verifySecurityConservation(
    securityConservationInputForTest({
      obligations: [wipeOnSpillForTest({ subject: virtualRegisterSubjectForTest("v:key") })],
      events: [
        spillEventForTest({ subject: "v:key", instructionKey: "i:spill" }),
        observableExitForTest({
          subject: "v:key",
          instructionKey: "i:veneer",
          exitKind: "veneer-branch",
        }),
      ],
      controlFlow: pathForTest(["i:spill", "i:veneer"]),
    }),
  );
  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected security failure");
  expect(result.diagnostics[0].stableDetail).toBe(
    "security:wipe-missing:v:key:i:spill:veneer-branch",
  );
});
```

### Reference Algorithm 4: Deterministic Allocation Repair Loop

**Owned by:** Tasks 16, 17, 18, 19, 20, 21, 34.

**Why this is Wrela-specific:** The allocator uses known register-allocation ideas, but the repair loop is specialized around Wrela proof facts: semantic death points, no-spill facts, wipe obligations, rematerialization authority, private call clobbers, and relocation-safe page/literal materialization.

```ts
interface AllocationEpisode {
  readonly stableKey: StableKey;
  readonly intervals: readonly LiveInterval[];
  readonly remainingCutPoints: readonly SplitPoint[];
  readonly unresolvedRepairRequests: readonly RepairRequest[];
  readonly frozenIntervalKeys: readonly StableKey[];
}

interface AllocationProgress {
  readonly unprocessedIntervals: number;
  readonly unsplitIntervals: number;
  readonly remainingCutPoints: number;
  readonly unresolvedRepairRequests: number;
  readonly frozenEpisodeCount: number;
}

function allocatePhysicalRegisters(input: {
  readonly functionKey: StableKey;
  readonly liveness: LivenessResult;
  readonly registerModel: AArch64PhysicalRegisterModel;
  readonly abiBoundaries: readonly AbiBoundary[];
  readonly factIndex: BackendFactIndex;
  readonly rewrite: BackendRewriteApi;
}): Result<AllocationResult> {
  let episode = initialAllocationEpisode(input.functionKey, input.liveness, input.factIndex);
  let previousProgress = allocationProgress(episode);
  const committedRepairs: RewriteRequest[] = [];

  while (episode.intervals.some((interval) => !intervalIsAssigned(interval))) {
    const interval = chooseNextInterval(episode.intervals, input.factIndex);
    const legalRegisters = legalRegistersForInterval(
      interval,
      input.registerModel,
      input.abiBoundaries,
      input.factIndex,
    );

    const assignment = firstNonInterferingRegister(
      interval,
      legalRegisters,
      episode.intervals,
      input.registerModel,
    );
    if (assignment !== undefined) {
      episode = assignInterval(episode, interval.stableKey, assignment);
      continue;
    }

    const repair = chooseFirstLegalRepair({
      interval,
      episode,
      registerModel: input.registerModel,
      abiBoundaries: input.abiBoundaries,
      factIndex: input.factIndex,
    });

    if (repair.kind === "fail") {
      return error(
        "allocation:no-legal-repair",
        `allocation:fail:${input.functionKey}:${interval.stableKey}:${repair.reason}`,
        [input.functionKey, interval.stableKey],
      );
    }

    const transaction = materializeAllocationRepair(repair, input.rewrite);
    const committed = input.rewrite.commit(transaction);
    if (committed.kind === "error") return committed;

    committedRepairs.push(transaction);
    episode = rebuildEpisodeAfterRepair({
      episode,
      committed,
      frozenIntervalKey: interval.stableKey,
    });

    const nextProgress = allocationProgress(episode);
    if (!lexicographicallyDecreased(previousProgress, nextProgress)) {
      return error(
        "allocation:progress-not-decreasing",
        `allocation:progress:${input.functionKey}:${interval.stableKey}`,
        [input.functionKey, interval.stableKey],
      );
    }
    previousProgress = nextProgress;
  }

  const verification = verifyAllocation({
    functionKey: input.functionKey,
    intervals: episode.intervals,
    registerModel: input.registerModel,
    factIndex: input.factIndex,
    committedRepairs,
  });
  if (verification.kind === "error") return verification;

  return ok({
    functionKey: input.functionKey,
    assignments: stableSortBy(episode.intervals.map(intervalAssignment), (assignment) => [
      assignment.intervalKey,
    ]),
    committedRepairKeys: committedRepairs.map((repair) => repair.stableKey),
    verifierRun: verification.value,
  });
}

function chooseNextInterval(
  intervals: readonly LiveInterval[],
  factIndex: BackendFactIndex,
): LiveInterval {
  return stableSortBy(
    intervals.filter((interval) => !intervalIsAssigned(interval)),
    (interval) => [
      interval.mustAllocateBeforeUse ? "0" : "1",
      invertedNumberKey(interval.maxLoopDepth),
      invertedNumberKey(spillCost(interval, factIndex)),
      invertedNumberKey(useDensity(interval)),
      interval.stableKey,
      interval.virtualRegisterKey,
    ],
  )[0];
}

function chooseFirstLegalRepair(input: {
  readonly interval: LiveInterval;
  readonly episode: AllocationEpisode;
  readonly registerModel: AArch64PhysicalRegisterModel;
  readonly abiBoundaries: readonly AbiBoundary[];
  readonly factIndex: BackendFactIndex;
}): RepairRequest | { readonly kind: "fail"; readonly reason: string } {
  const coalesce = tryCoalesce(input);
  if (coalesce.kind === "ok") return coalesce.value;

  const split = trySplitAtFirstLegalCutPoint(input);
  if (split.kind === "ok") return split.value;

  const remat = tryRematerialize(input);
  if (remat.kind === "ok") return remat.value;

  if (input.factIndex.hasFact(input.interval.virtualRegisterKey, "security.no-spill")) {
    return { kind: "fail", reason: "no-spill" };
  }

  const spill = trySpillWithWipeObligations(input);
  if (spill.kind === "ok") return spill.value;

  return { kind: "fail", reason: "pressure" };
}
```

Required implementation fixtures beyond the task-local examples:

```ts
test("allocator prefers rematerialization over spilling when relocation-safe authority exists", () => {
  const result = allocatePhysicalRegisters(
    allocationInputForTest({
      pressure: "one-register-over",
      facts: [
        rematerializableConstantForTest({ virtualRegisterKey: "v:pageoff", relocationSafe: true }),
      ],
    }),
  );
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected allocation");
  expect(result.value.committedRepairKeys).toContain("repair:remat:v:pageoff");
  expect(result.value.committedRepairKeys).not.toContain("repair:spill:v:pageoff");
});
```

### Reference Algorithm 5: Parallel Copy And Tied Operand Resolution

**Owned by:** Tasks 19, 20, 24, 34.

**Why this is Wrela-specific:** The core graph algorithm is standard, but Wrela's legality filter is not: IP0/IP1 may be unavailable because of predeclared veneer policy, no-spill values cannot be routed through memory, tied ABI groups must remain intact, and every inserted move is a rewrite transaction with fact/provenance transfer.

```ts
interface ParallelCopyMove {
  readonly stableKey: StableKey;
  readonly source: PhysicalLocation;
  readonly destination: PhysicalLocation;
  readonly valueKey: StableKey;
  readonly tiedGroupKey?: StableKey;
}

function resolveParallelCopies(input: {
  readonly stableKey: StableKey;
  readonly moves: readonly ParallelCopyMove[];
  readonly unavailableTemporaries: readonly PhysicalLocation[];
  readonly registerModel: AArch64PhysicalRegisterModel;
  readonly factIndex: BackendFactIndex;
  readonly rewrite: BackendRewriteApi;
}): Result<readonly PhysicalMoveInstruction[]> {
  const remaining = new Map(
    stableSortBy(
      input.moves.filter((move) => !samePhysicalLocation(move.source, move.destination)),
      (move) => [move.destination.stableKey, move.source.stableKey, move.valueKey],
    ).map((move) => [move.destination.stableKey, move]),
  );

  if (
    remaining.size !==
    input.moves.filter((move) => !samePhysicalLocation(move.source, move.destination)).length
  ) {
    return error(
      "parallel-copy:duplicate-destination",
      `parallel-copy:duplicate-destination:${input.stableKey}`,
      [input.stableKey],
    );
  }

  const emitted: PhysicalMoveInstruction[] = [];

  while (remaining.size > 0) {
    const acyclic = firstAcyclicMove(remaining);
    if (acyclic !== undefined) {
      emitted.push(emitMoveThroughRewrite(input, acyclic));
      remaining.delete(acyclic.destination.stableKey);
      continue;
    }

    const cycle = firstStableCycle(remaining);
    const temporary = chooseLegalTemporary({
      cycle,
      unavailableTemporaries: input.unavailableTemporaries,
      registerModel: input.registerModel,
      factIndex: input.factIndex,
    });

    if (temporary.kind === "ok") {
      const first = cycle[0];
      emitted.push(emitMoveThroughRewrite(input, { ...first, destination: temporary.value }));
      for (let index = cycle.length - 1; index > 0; index -= 1) {
        emitted.push(emitMoveThroughRewrite(input, cycle[index]));
        remaining.delete(cycle[index].destination.stableKey);
      }
      emitted.push(
        emitMoveThroughRewrite(input, {
          ...first,
          source: temporary.value,
        }),
      );
      remaining.delete(first.destination.stableKey);
      continue;
    }

    const memorySwap = chooseSecurityApprovedMemorySwap(cycle, input.factIndex);
    if (memorySwap.kind === "ok") {
      emitted.push(...emitMemorySwapThroughRewrite(input, cycle, memorySwap.value));
      for (const move of cycle) remaining.delete(move.destination.stableKey);
      continue;
    }

    return error(
      "parallel-copy:no-legal-temporary",
      `parallel-copy:no-temp:${input.stableKey}:${cycle[0].stableKey}`,
      [input.stableKey, cycle[0].stableKey],
    );
  }

  return ok(emitted);
}

function firstAcyclicMove(
  remaining: ReadonlyMap<StableKey, ParallelCopyMove>,
): ParallelCopyMove | undefined {
  const liveSources = new Set([...remaining.values()].map((move) => move.source.stableKey));
  return stableSortBy([...remaining.values()], (move) => [
    move.destination.stableKey,
    move.source.stableKey,
  ]).find((move) => !liveSources.has(move.destination.stableKey));
}
```

Required implementation fixtures beyond the task-local examples:

```ts
test("parallel copy refuses memory swap when any cycle value is no-spill", () => {
  const result = resolveParallelCopies(
    parallelCopyInputForTest({
      moves: twoRegisterSwapForTest("x0", "x1"),
      unavailableTemporaries: allCallerScratchRegistersForTest(),
      facts: [noSpillFactForTest({ subject: physicalRegisterSubjectForTest("x0") })],
    }),
  );
  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected copy resolution failure");
  expect(result.diagnostics[0].stableDetail).toBe(
    "parallel-copy:no-temp:copy-web:test:copy:x0-to-x1",
  );
});
```

### Reference Algorithm 6: Layout, Relaxation, Literal Pools, Veneers, And Encoding

**Owned by:** Tasks 26A, 26, 27, 28, 29, 30, 31, 32, 34.

**Why this is Wrela-specific:** The fixed point is not a generic assembler pass. It must coordinate direct catalog encoding, internal object relocation records, PE/COFF-facing mapping constraints, predeclared veneer scratch clobbers, literal-pool security policy, and byte-to-fact provenance in one monotone owner.

```ts
type LayoutDecisionState =
  | "short-form"
  | "expanded"
  | "literal-island-inserted"
  | "backend-veneer-inserted"
  | "linker-owned-veneer"
  | "range-exhausted";

interface ReachLimit {
  readonly family: "branch26" | "branch19" | "branch14" | "ldr-literal19" | "adrp-page21";
  readonly negativeBytes: bigint;
  readonly positiveBytes: bigint;
}

const A64_REACH_LIMITS: readonly ReachLimit[] = [
  { family: "branch26", negativeBytes: -(1n << 27n), positiveBytes: (1n << 27n) - 4n },
  { family: "branch19", negativeBytes: -(1n << 20n), positiveBytes: (1n << 20n) - 4n },
  { family: "branch14", negativeBytes: -(1n << 15n), positiveBytes: (1n << 15n) - 4n },
  { family: "ldr-literal19", negativeBytes: -(1n << 20n), positiveBytes: (1n << 20n) - 4n },
  { family: "adrp-page21", negativeBytes: -(1n << 32n), positiveBytes: (1n << 32n) - 4096n },
];

function layoutAndEncodeFixedPoint(input: {
  readonly fragments: readonly PhysicalSectionFragment[];
  readonly encodingCatalog: AuthenticatedEncodingCatalog;
  readonly relocationCatalog: AuthenticatedRelocationCatalog;
  readonly veneerCatalog: AuthenticatedVeneerCatalog;
  readonly literalPoolCatalog: AuthenticatedLiteralPoolCatalog;
  readonly securityCatalog: AArch64BackendSecurityCatalog;
}): Result<AArch64ObjectModule> {
  let decisions = initialLayoutDecisions(input.fragments);
  let iteration = 0;
  const maxIterations = countFiniteDecisionTransitions(decisions);

  while (iteration <= maxIterations) {
    const encoded = encodeFragmentsWithCatalogOnly({
      fragments: input.fragments,
      decisions,
      catalog: input.encodingCatalog,
    });
    if (encoded.kind === "error") return encoded;

    const layout = assignSectionOffsets(encoded.value);
    const analysis = analyzeReachAndRelocations({
      encodedFragments: encoded.value,
      layout,
      relocationCatalog: input.relocationCatalog,
      securityCatalog: input.securityCatalog,
    });
    if (analysis.kind === "error") return analysis;

    const nextDecisions = growLayoutDecisions({
      previous: decisions,
      analysis: analysis.value,
      veneerCatalog: input.veneerCatalog,
      literalPoolCatalog: input.literalPoolCatalog,
    });
    if (nextDecisions.kind === "error") return nextDecisions;

    if (sameDecisionMap(decisions, nextDecisions.value)) {
      const objectModule = assembleObjectModule({
        encodedFragments: encoded.value,
        layout,
        relocations: analysis.value.relocations,
        byteProvenance: analysis.value.byteProvenance,
      });
      const verified = verifyEncodedObjectModule(objectModule);
      if (verified.kind === "error") return verified;
      return ok(objectModule);
    }

    if (!decisionMapOnlyGrew(decisions, nextDecisions.value)) {
      return error("layout:decision-regressed", "layout:decision-regressed", []);
    }

    decisions = nextDecisions.value;
    iteration += 1;
  }

  return error("layout:fixed-point-exhausted", "layout:fixed-point-exhausted", []);
}

function growLayoutDecisions(input: {
  readonly previous: LayoutDecisionMap;
  readonly analysis: ReachAnalysis;
  readonly veneerCatalog: AuthenticatedVeneerCatalog;
  readonly literalPoolCatalog: AuthenticatedLiteralPoolCatalog;
}): Result<LayoutDecisionMap> {
  let next = input.previous;

  for (const issue of stableSortBy(input.analysis.outOfRangeSites, (site) => [
    site.family,
    site.siteKey,
    site.targetKey,
  ])) {
    const current = next.get(issue.siteKey);
    if (current === "range-exhausted") continue;

    if (issue.family === "branch14") {
      next = next.set(issue.siteKey, current === "short-form" ? "expanded" : "range-exhausted");
      continue;
    }

    if (issue.family === "branch19") {
      next = next.set(issue.siteKey, current === "short-form" ? "expanded" : "range-exhausted");
      continue;
    }

    if (issue.family === "branch26" && issue.predeclaredVeneerPolicy !== undefined) {
      const veneer = input.veneerCatalog.lookup(issue.predeclaredVeneerPolicy);
      if (veneer.kind === "backend-owned") {
        next = next.set(issue.siteKey, "backend-veneer-inserted");
      } else if (veneer.kind === "linker-owned") {
        next = next.set(issue.siteKey, "linker-owned-veneer");
      } else {
        next = next.set(issue.siteKey, "range-exhausted");
      }
      continue;
    }

    if (issue.family === "ldr-literal19") {
      const island = input.literalPoolCatalog.chooseIsland(issue.literalKey, issue.siteKey);
      next = next.set(
        issue.siteKey,
        island.kind === "ok" ? "literal-island-inserted" : "range-exhausted",
      );
      continue;
    }

    next = next.set(issue.siteKey, "range-exhausted");
  }

  const exhausted = [...next.entries()].find(([, state]) => state === "range-exhausted");
  if (exhausted !== undefined) {
    return error("layout:range-exhausted", `layout:range-exhausted:${exhausted[0]}`, [
      exhausted[0],
    ]);
  }

  return ok(next);
}
```

Required implementation fixtures beyond the task-local examples:

```ts
test("layout cannot introduce a backend veneer when allocation did not predeclare scratch clobbers", () => {
  const result = layoutAndEncodeFixedPoint(
    layoutInputForTest({
      branchDistance: "beyond-branch26",
      predeclaredVeneerPolicy: undefined,
    }),
  );
  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected layout failure");
  expect(result.diagnostics[0].stableDetail).toBe("layout:range-exhausted:branch:fixture:far-call");
});
```

### Reference Algorithm 7: Object Byte, Relocation, And Provenance Verification

**Owned by:** Tasks 3, 29, 31, 32, 33, 34.

**Why this is Wrela-specific:** Wrela's backend object is an internal proof-carrying object, not a plain byte buffer. Verification must walk bytes, relocation holes, unwind records, and fact-spending metadata together so the final object can explain how proof facts became concrete code.

```ts
function verifyAArch64ObjectModule(input: {
  readonly objectModule: AArch64ObjectModule;
  readonly encodingCatalog: AuthenticatedEncodingCatalog;
  readonly relocationCatalog: AuthenticatedRelocationCatalog;
  readonly factIndex: BackendFactIndex;
  readonly securitySummary: SecurityVerificationSummary;
}): Result<ObjectVerificationSummary> {
  const diagnostics: StableDiagnostic[] = [];

  diagnostics.push(...verifyStableObjectOrdering(input.objectModule));
  diagnostics.push(...verifySectionsAndFragments(input.objectModule));
  diagnostics.push(...verifySymbolsPointAtKnownFragments(input.objectModule));
  diagnostics.push(...verifyRelocationPatchOwnership(input.objectModule, input.relocationCatalog));
  diagnostics.push(...verifyByteProvenanceCoverage(input.objectModule));
  diagnostics.push(...verifyNoStaleFactSubjects(input.objectModule, input.factIndex));
  diagnostics.push(...verifySecuritySummaryConsumed(input.objectModule, input.securitySummary));
  diagnostics.push(...verifyUnwindRecordsReferenceFrameFragments(input.objectModule));

  for (const fragment of input.objectModule.sections.flatMap((section) => section.fragments)) {
    if (fragment.kind !== "text") continue;

    const decoded = decodeWithAuthenticatedCatalog(fragment.bytes, input.encodingCatalog);
    if (decoded.kind === "error") {
      diagnostics.push(...decoded.diagnostics);
      continue;
    }

    const expected = input.objectModule.encodingRecords.filter(
      (record) => record.fragmentKey === fragment.stableKey,
    );
    for (const record of stableSortBy(expected, (item) => [
      item.offset.toString(),
      item.instructionKey,
    ])) {
      const decodedAtOffset = decoded.value.instructionsByOffset.get(record.offset);
      if (
        decodedAtOffset === undefined ||
        decodedAtOffset.opcodeStableKey !== record.opcodeStableKey
      ) {
        diagnostics.push({
          code: "object:encoded-byte-mismatch",
          stableDetail: `object:byte-mismatch:${fragment.stableKey}:${record.offset}:${record.opcodeStableKey}`,
          provenance: [fragment.stableKey, record.instructionKey],
        });
      }
    }
  }

  const sortedDiagnostics = stableSortBy(diagnostics, (diagnostic) => [
    diagnostic.code,
    diagnostic.stableDetail,
  ]);
  if (sortedDiagnostics.length > 0) return { kind: "error", diagnostics: sortedDiagnostics };

  return ok({
    verifierKey: "object-module",
    sectionKeys: input.objectModule.sections.map((section) => section.stableKey),
    relocationKeys: input.objectModule.relocations.map((relocation) => relocation.stableKey),
    byteProvenanceRecordCount: input.objectModule.byteProvenance.length,
  });
}
```

Required implementation fixtures beyond the task-local examples:

```ts
test("object verifier rejects an encoded byte without provenance", () => {
  const result = verifyAArch64ObjectModule(
    objectVerifierInputForTest({
      objectModule: objectModuleWithTextByteGapForTest({
        sectionKey: "section:.text",
        fragmentKey: "fragment:main",
        missingByteOffset: 12n,
      }),
    }),
  );
  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected object verification failure");
  expect(result.diagnostics[0].stableDetail).toBe(
    "object:byte-provenance-gap:section:.text:fragment:main:12",
  );
});
```

### Reference Algorithm 8: Packet-Loop Proof Spending

**Owned by:** Tasks 10, 12, 15, 16, 17, 18, 21, 22, 25, 31, 33, 34.

**Why this is Wrela-specific:** This is the flagship path where Wrela's proof system pays off. The algorithm below prevents backend workers from rediscovering semantic truths from source shapes while still converting validated region, ownership, endian, memory-order, and closed-image facts into concrete code choices.

```ts
interface PacketLoopFactBundle {
  readonly packetBase: BackendFact | undefined;
  readonly packetCursor: BackendFact | undefined;
  readonly validatedRegionShape: BackendFact | undefined;
  readonly initializedPrefix: BackendFact | undefined;
  readonly endianAccess: BackendFact | undefined;
  readonly memoryOrder: BackendFact | undefined;
  readonly internalCallEligibility: BackendFact | undefined;
  readonly privateClobbers: BackendFact | undefined;
  readonly noSpill: readonly BackendFact[];
}

function planPacketLoopProofSpending(input: {
  readonly loopKey: StableKey;
  readonly facts: PacketLoopFactBundle;
  readonly closedImagePlan: AArch64ClosedImageBackendPlan;
  readonly targetSurface: AArch64BackendTargetSurface;
}): Result<PacketLoopBackendPlan> {
  const diagnostics: StableDiagnostic[] = [];

  const basePlan =
    input.facts.packetBase !== undefined && input.facts.validatedRegionShape !== undefined
      ? {
          kind: "direct-validated-base" as const,
          baseFactKey: input.facts.packetBase.stableKey,
          regionFactKey: input.facts.validatedRegionShape.stableKey,
        }
      : { kind: "ordinary-base" as const };

  const endianPlan =
    input.facts.endianAccess !== undefined
      ? { kind: "use-rev-family" as const, factKey: input.facts.endianAccess.stableKey }
      : { kind: "ordinary-scalar-access" as const };

  const memoryOrderPlan =
    input.facts.memoryOrder !== undefined
      ? targetMemoryOrderSequence(input.facts.memoryOrder, input.targetSurface)
      : error(
          "packet-loop:memory-order-missing",
          `packet-loop:memory-order-missing:${input.loopKey}`,
          [input.loopKey],
        );
  if (memoryOrderPlan.kind === "error") return memoryOrderPlan;

  const privateCallPlan =
    input.facts.internalCallEligibility !== undefined &&
    input.facts.privateClobbers !== undefined &&
    input.closedImagePlan.authorizesLoopPrivateHelpers(input.loopKey)
      ? {
          kind: "private-helpers" as const,
          eligibilityFactKey: input.facts.internalCallEligibility.stableKey,
          clobberFactKey: input.facts.privateClobbers.stableKey,
        }
      : { kind: "public-helpers" as const };

  for (const fact of input.facts.noSpill) {
    if (!fact.lineage.includes(input.loopKey)) {
      diagnostics.push({
        code: "packet-loop:no-spill-lineage",
        stableDetail: `packet-loop:no-spill-lineage:${input.loopKey}:${fact.stableKey}`,
        provenance: [input.loopKey, fact.stableKey],
      });
    }
  }

  if (diagnostics.length > 0)
    return {
      kind: "error",
      diagnostics: stableSortBy(diagnostics, (item) => [item.code, item.stableDetail]),
    };

  return ok({
    loopKey: input.loopKey,
    basePlan,
    endianPlan,
    memoryOrderPlan: memoryOrderPlan.value,
    privateCallPlan,
    noSpillFactKeys: input.facts.noSpill.map((fact) => fact.stableKey).sort(),
    provenanceKeys: [
      input.facts.packetBase?.stableKey,
      input.facts.validatedRegionShape?.stableKey,
      input.facts.endianAccess?.stableKey,
      input.facts.memoryOrder?.stableKey,
      input.facts.internalCallEligibility?.stableKey,
      input.facts.privateClobbers?.stableKey,
    ].filter((key): key is StableKey => key !== undefined),
  });
}
```

Required implementation fixtures beyond the task-local examples:

```ts
test("packet loop spends complete proof bundle into direct base, endian, memory order, and private helper plans", () => {
  const result = planPacketLoopProofSpending(packetLoopProofSpendingInputForTest("packet-loop:rx"));
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected packet-loop plan");
  expect(result.value).toMatchObject({
    loopKey: "packet-loop:rx",
    basePlan: { kind: "direct-validated-base" },
    endianPlan: { kind: "use-rev-family" },
    privateCallPlan: { kind: "private-helpers" },
  });
  expect(result.value.memoryOrderPlan.stableKey).toBe("memory-order:virtio-release-notify");
});
```

## Spike Closure Ledger

No implementation task may start with an open research spike. These spike outcomes are closed and converted into task work:

| Spike question                                                             | Closed outcome                                                                                                                                                     | Converted into                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| Should the backend emit PE/COFF directly?                                  | No. It emits deterministic internal `AArch64ObjectModule`; PE/COFF compatibility is represented through relocation and unwind catalog mappings.                    | Tasks 3, 23, 29, 31, 32       |
| Can source target-surface data be reused directly?                         | No. A separate authenticated backend surface consumes source target data plus backend catalogs, then backend internals consume only backend capability interfaces. | Tasks 4, 13, 26A              |
| Is an external assembler acceptable for production encoding?               | No. Production encoding is direct bitfield construction. External tools may appear only in tests as non-authoritative fixture cross-checks.                        | Tasks 26A, 26, 27, 28, 32     |
| Who owns facts after machine IR?                                           | The shared compiler fact extension plus backend import layer. No backend stage reads OptIR internals.                                                              | Tasks 1, 6, 7, 10             |
| Who owns mutations and fact transfer?                                      | One backend rewrite transaction owns all rewrites and provenance/fact/security transfer.                                                                           | Task 11                       |
| Who owns security labels?                                                  | One security conservation verifier owns the rule set; other verifiers call it.                                                                                     | Task 12                       |
| What is the public ABI scope?                                              | AAPCS64/UEFI for public/firmware/platform/exported/address-taken/replacement/uncertain boundaries. Variadic/scalable-vector ABI rejected for this profile.         | Tasks 14, 15, 20, 34          |
| What is the private ABI scope?                                             | Exact closed-image caller/callee pairs only, never exported/address-taken/replacement/relocatable-public.                                                          | Tasks 5, 15, 34               |
| How does register allocation terminate?                                    | Deterministic finite worklist with fixed action order and lexicographic progress tuple.                                                                            | Tasks 16-20                   |
| How are parallel copies resolved?                                          | Deterministic graph algorithm with legal temporary; memory swap only under security approval.                                                                      | Task 19                       |
| How are frames and unwind coordinated?                                     | Frame layout precedes unwind planning; unrepresentable unwind shapes fail before bytes exist.                                                                      | Tasks 21-23                   |
| How are branch relaxation, literals, veneers, and relocations coordinated? | One monotone layout-and-encode fixed point emits bytes and relocations together.                                                                                   | Tasks 29-32                   |
| What proves determinism?                                                   | Stable keys, frozen records, sorted diagnostics, no host metadata, repeated compile deep-equality tests, and debug artifact equality.                              | Tasks 2, 3, 5A, 8, 31, 33, 34 |

## Design Coverage Matrix

This matrix is the plan's traceability check against `docs/design/aarch64-backend-design.md`.

| Design area                                                                        | Covered by tasks                                          | Proof artifacts                                                                                           |
| ---------------------------------------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Purpose, production commitments, goals, non-goals                                  | Tasks 8, 9, 34                                            | Public API tests, input contract tests, end-to-end deterministic acceptance                               |
| Source standards and target profile                                                | Tasks 4, 13, 14, 23, 26A, 26, 29                          | Authenticated backend target surface, register model, catalog data, ABI fixtures, relocation/unwind tests |
| Fact authority, proof-to-bytes cascade, readiness gates, prior phase true-up       | Tasks 1, 6, 7, 10, 11, 33, 34                             | Shared fact registry, OptIR migration, machine re-keying, backend fact import, fact-transfer graph        |
| Backend subjects, rewrite transaction, rewrite granularity, fact transfer rules    | Tasks 10, 11                                              | Backend subject vocabulary, transaction tests, transfer behavior tests, rollback tests                    |
| Security label conservation, constant-time construction, provenance survival       | Tasks 11, 12, 18, 22, 25, 32, 33, 34                      | Security conservation fixtures, rewrite provenance, object security verifier, debug provenance dumps      |
| Backend target surface, catalog authoring, physical register model                 | Tasks 4, 13, 26A, 26                                      | Capability interfaces, x18/SP/ZR/IP0/IP1 tests, catalog fingerprints, known-byte fixture coverage         |
| Public ABI, closed-image ABI authority, plan producer, ABI classification flow     | Tasks 5, 14, 15, 20, 34                                   | Closed-image plan verifier, public ABI matrix, private ABI reconciliation, allocation verifier checks     |
| Allocation inputs, allocation strategy, spill/remat, spill-slot coloring           | Tasks 16, 17, 18, 19, 20, 21                              | Liveness/interference tests, allocator progress tuple, spill/remat tests, frame coloring tests            |
| Stack frame layout, prologue/epilogue, tail calls, unwind planning                 | Tasks 21, 22, 23                                          | Frame layout fixtures, exit finalization tests, unwind catalog/template tests                             |
| Physical IR, finalization, post-allocation scheduling                              | Tasks 24, 25                                              | Physical IR/pseudo expansion tests, scheduler dependency island tests, peephole transfer tests            |
| Encoding catalog, relocation model, layout fixed point, branch/literal/veneer plan | Tasks 26A, 26, 27, 28, 29, 30, 31, 32                     | Catalog auth, known bytes, relocation records, monotone layout fixed point, object verifier               |
| Section/symbol model, internal object module, output contract                      | Tasks 3, 31, 32, 34                                       | Object module tests, byte provenance, object verifier, integration object tests                           |
| Public API, input contract, verification summary, diagnostics, testing strategy    | Tasks 2, 8, 9, 20, 21, 23, 32, 33, 34                     | Stable diagnostics, verifier run summaries, public exports, debug artifacts, full `agent:check`           |
| Production waves and risk register                                                 | Global execution contract, Parallel Execution, Tasks 1-34 | Dependency waves, stage ownership, spike closure ledger, task-local execution steps                       |

## Task 1: Shared Compiler Fact Extension Core

**Description:** Extract a shared, typed fact-extension contract under `src/shared/facts/` so OptIR, AArch64 machine IR, and the backend all use one registry shape for import validation, subject indexing, preservation, invalidation, and rewrite transfer.

**Dependencies:** None.

**Files:**

- Create: `src/shared/facts/compiler-fact-extension.ts`
- Create: `src/shared/facts/fact-transfer.ts`
- Create: `src/shared/facts/fact-diagnostics.ts`
- Create: `src/shared/facts/index.ts`
- Create: `tests/unit/shared/facts/compiler-fact-extension.test.ts`
- Create: `tests/unit/shared/facts/fact-transfer.test.ts`

**Acceptance Criteria:**

- Defines `CompilerFactExtension<Subject, Payload, RewriteKind, RewrittenSubject>` with typed import, subject indexing, preservation, invalidation, transfer rules, upstream verifier key, and negative fixtures.
- Defines transfer behavior tags: `identity`, `move`, `split`, `copy`, `weaken`, `invalidate`, `reject`, `rederive-from-catalog`.
- Provides deterministic registry helpers that reject duplicate extension keys and unknown keys with stable diagnostics.
- Provides a pure `applyFactTransferRule` helper returning `{ kind: "ok" }` or `{ kind: "error" }` without throwing for normal invalid input.
- Owns the local `factExtensionForTest` helper in `compiler-fact-extension.test.ts`; no backend task may import this helper from runtime source.
- Tests cover duplicate keys, unknown keys, malformed import payload, missing transfer rule, reject behavior, and deterministic diagnostic ordering.

**Execution Steps:**

- [ ] Write `compiler-fact-extension.test.ts` with duplicate-key and unknown-key cases using the shown `factExtensionForTest`; expected first failure is missing `compilerFactExtensionRegistry`.
- [ ] Write `fact-transfer.test.ts` with one case per transfer behavior tag: `identity`, `move`, `split`, `copy`, `weaken`, `invalidate`, `reject`, and `rederive-from-catalog`; expected first failure is missing `applyFactTransferRule`.
- [ ] Define `CompilerFactExtension`, branded extension/verifier keys, import result types, transfer behavior tags, preservation/invalidation rule types, and deterministic diagnostic types in `compiler-fact-extension.ts` and `fact-diagnostics.ts`.
- [ ] Implement registry construction as pure normalization: sort by extension key, reject duplicates with `fact-extension:duplicate-key:<key>`, freeze accepted extensions, and expose unknown-key lookup diagnostics.
- [ ] Implement `applyFactTransferRule` in `fact-transfer.ts` as an exhaustive behavior switch returning structured results without throwing for normal invalid input.
- [ ] Export only the shared public surface from `src/shared/facts/index.ts`.
- [ ] Run `bun test ./tests/unit/shared/facts/compiler-fact-extension.test.ts ./tests/unit/shared/facts/fact-transfer.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit `src/shared/facts/*` and `tests/unit/shared/facts/*`.

**Code Examples:**

```ts
// Expected public shape.
export interface CompilerFactExtension<Subject, Payload, RewriteKind, RewrittenSubject> {
  readonly extensionKey: CompilerFactExtensionKey;
  readonly validateImport: (payload: unknown) => CompilerFactImportResult<Payload>;
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

```ts
// Expected test shape.
test("registry rejects duplicate fact extension keys deterministically", () => {
  const first = factExtensionForTest({
    extensionKey: compilerFactExtensionKey("security.no-spill"),
  });
  const second = factExtensionForTest({
    extensionKey: compilerFactExtensionKey("security.no-spill"),
  });

  const result = compilerFactExtensionRegistry([first, second]);

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected duplicate key");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "fact-extension:duplicate-key:security.no-spill",
  ]);
});
```

```bash
bun test ./tests/unit/shared/facts/compiler-fact-extension.test.ts ./tests/unit/shared/facts/fact-transfer.test.ts
```

## Task 2: Backend Diagnostics, Stable IDs, and Verification Summary

**Description:** Add backend-specific diagnostic codes, stable ID constructors, deterministic sorting, and verification summary records. These types are the common language for every later backend task.

**Dependencies:** None.

**Files:**

- Create: `src/target/aarch64/backend/api/diagnostics.ts`
- Create: `src/target/aarch64/backend/api/ids.ts`
- Create: `src/target/aarch64/backend/api/verification-summary.ts`
- Create: `tests/unit/target/aarch64/backend/backend-diagnostics.test.ts`

**Acceptance Criteria:**

- Defines stable branded IDs for backend surface, private convention, ABI boundary, physical register, alias set, live range, allocation segment, frame slot, section, fragment, relocation, literal pool, veneer, object symbol, rewrite transaction, and verifier run.
- Defines backend diagnostic codes covering input contract, fact import, rewrite transfer, security, target surface, closed-image plan, ABI, allocation, frame, unwind, finalization, encoding, relocation, layout fixed point, object verification, and determinism.
- Diagnostic constructors reject unknown codes at construction time.
- `sortAArch64BackendDiagnostics` orders by code, owner key, root-cause key, and stable detail.
- Verification summary records named verifier families and statuses with stable ordering.

**Execution Steps:**

- [ ] Write `backend-diagnostics.test.ts` for diagnostic code acceptance, unknown code rejection, sort order, stable ID construction, and verification summary ordering; expected first failure is missing `aarch64BackendDiagnostic`.
- [ ] Define branded ID constructors in `ids.ts` for every ID family named in acceptance criteria; each constructor accepts a non-empty stable string and returns a frozen branded value.
- [ ] Define `AARCH64_BACKEND_DIAGNOSTIC_CODES`, `AArch64BackendDiagnostic`, `AArch64BackendDiagnosticMode`, and diagnostic constructors in `diagnostics.ts`.
- [ ] Implement deterministic sorting by `(code, ownerKey, rootCauseKey, stableDetail)` with no locale-sensitive comparison.
- [ ] Define `AArch64BackendVerificationSummary`, verifier run keys, verifier statuses, and summary normalization in `verification-summary.ts`.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/backend-diagnostics.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit diagnostics, ID, summary, and test files.

**Code Examples:**

```ts
export const AARCH64_BACKEND_DIAGNOSTIC_CODES = [
  "AARCH64_BACKEND_INPUT_CONTRACT_INVALID",
  "AARCH64_BACKEND_FACT_IMPORT_INVALID",
  "AARCH64_BACKEND_REWRITE_TRANSFER_INVALID",
  "AARCH64_BACKEND_SECURITY_CONSERVATION_FAILED",
  "AARCH64_BACKEND_TARGET_SURFACE_INVALID",
  "AARCH64_BACKEND_CLOSED_IMAGE_PLAN_INVALID",
  "AARCH64_BACKEND_ABI_INVALID",
  "AARCH64_BACKEND_ALLOCATION_FAILED",
  "AARCH64_BACKEND_FRAME_INVALID",
  "AARCH64_BACKEND_UNWIND_INVALID",
  "AARCH64_BACKEND_FINALIZATION_INVALID",
  "AARCH64_BACKEND_ENCODING_INVALID",
  "AARCH64_BACKEND_RELOCATION_INVALID",
  "AARCH64_BACKEND_LAYOUT_FIXED_POINT_FAILED",
  "AARCH64_BACKEND_OBJECT_INVALID",
  "AARCH64_BACKEND_DETERMINISM_INVALID",
] as const;
```

```ts
test("backend diagnostics sort by stable order key", () => {
  const diagnostics = [
    aarch64BackendDiagnostic({
      code: "AARCH64_BACKEND_FRAME_INVALID",
      ownerKey: "frame",
      rootCauseKey: "slot:2",
      stableDetail: "frame:slot-overlap:2:3",
    }),
    aarch64BackendDiagnostic({
      code: "AARCH64_BACKEND_ABI_INVALID",
      ownerKey: "abi",
      rootCauseKey: "call:main:0",
      stableDetail: "abi:public:x18-reserved",
    }),
  ];

  expect(
    sortAArch64BackendDiagnostics(diagnostics).map((diagnostic) => diagnostic.stableDetail),
  ).toEqual(["abi:public:x18-reserved", "frame:slot-overlap:2:3"]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/backend-diagnostics.test.ts
```

## Task 3: Backend Object Module Types

**Description:** Define the immutable internal object model: sections, fragments, symbols, relocations, literal pools, veneers, unwind/frame records, byte provenance, fact-spending summaries, and deterministic metadata.

**Dependencies:** Task 2.

**Files:**

- Create: `src/target/aarch64/backend/object/object-module.ts`
- Create: `tests/support/target/aarch64/backend/object-module-fixtures.ts`
- Create: `tests/unit/target/aarch64/backend/object-module.test.ts`

**Acceptance Criteria:**

- `AArch64ObjectModule` stores backend target fingerprint, closed-image plan fingerprint, ordered sections, symbols, relocations, literal-pool entries, veneers, unwind records, diagnostics, verification summary, byte provenance, fact-spending summary, and deterministic build metadata.
- Section and symbol constructors sort deterministically and reject duplicate stable keys.
- Object metadata contains no host path, timestamp, process ID, random value, or environment data.
- Tests cover deterministic ordering, duplicate rejection, byte provenance coverage table creation, and frozen immutable records.

**Execution Steps:**

- [ ] Write `object-module.test.ts` for sorted sections/symbols/relocations, duplicate section rejection, byte provenance coverage, immutable records, and host-metadata absence; expected first failure is missing `aarch64ObjectModuleForTest`.
- [ ] Define object IDs and records in `object-module.ts`: section, fragment, symbol, relocation, literal-pool entry, veneer, unwind record, byte provenance, fact spending, and deterministic metadata.
- [ ] Implement object module construction as normalization over readonly inputs: sort every repeated field by `stableKey`, reject duplicates with stable diagnostics, freeze the module graph, and preserve input bytes exactly.
- [ ] Implement `object-module-fixtures.ts` with `sectionForTest`, `symbolForTest`, `relocationForTest`, `byteProvenanceForTest`, and `aarch64ObjectModuleForTest`, all using `stableKey`.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/object-module.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit object module source, fixtures, and tests.

**Code Examples:**

```ts
export interface AArch64ObjectModule {
  readonly targetBackendSurfaceFingerprint: string;
  readonly closedImagePlanFingerprint: string;
  readonly sections: readonly AArch64ObjectSection[];
  readonly symbols: readonly AArch64ObjectSymbol[];
  readonly relocations: readonly AArch64ObjectRelocation[];
  readonly literalPools: readonly AArch64ObjectLiteralPoolEntry[];
  readonly veneers: readonly AArch64ObjectVeneer[];
  readonly unwindRecords: readonly AArch64ObjectUnwindRecord[];
  readonly diagnostics: readonly AArch64BackendDiagnostic[];
  readonly verification: AArch64BackendVerificationSummary;
  readonly byteProvenance: readonly AArch64ByteProvenanceRecord[];
  readonly factSpending: readonly AArch64FactSpendingRecord[];
  readonly deterministicMetadata: AArch64BackendDeterministicMetadata;
}
```

```ts
test("object module sorts sections, symbols, and relocations by stable key", () => {
  const module = aarch64ObjectModuleForTest({
    sections: [sectionForTest("text.z"), sectionForTest("text.a")],
    symbols: [symbolForTest("z_symbol"), symbolForTest("a_symbol")],
    relocations: [relocationForTest("reloc.z"), relocationForTest("reloc.a")],
  });

  expect(module.sections.map((section) => section.stableKey)).toEqual(["text.a", "text.z"]);
  expect(module.symbols.map((symbol) => symbol.stableKey)).toEqual(["a_symbol", "z_symbol"]);
  expect(module.relocations.map((relocation) => relocation.stableKey)).toEqual([
    "reloc.a",
    "reloc.z",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/object-module.test.ts
```

## Task 4: Backend Target Surface Catalog and Authentication

**Description:** Add authenticated backend target surface records and catalog bundles for registers, encodings, relocations, unwind, frames, veneers, literal pools, security, and tuning.

**Dependencies:** Task 2.

**Files:**

- Create: `src/target/aarch64/backend/api/backend-catalog-interfaces.ts`
- Create: `src/target/aarch64/backend/api/backend-target-surface.ts`
- Create: `tests/support/target/aarch64/backend/backend-target-surface-fakes.ts`
- Create: `tests/unit/target/aarch64/backend/backend-target-surface.test.ts`

**Acceptance Criteria:**

- Defines `AArch64BackendTargetSurface` exactly as a backend catalog bundle, separate from the existing `AArch64TargetSurface`.
- Defines the canonical capability interfaces for `AArch64PhysicalRegisterModel`, `AArch64EncodingCatalog`, `AArch64RelocationCatalog`, `AArch64UnwindCatalog`, `AArch64FrameCatalog`, `AArch64VeneerCatalog`, `AArch64LiteralPoolCatalog`, `AArch64BackendSecurityCatalog`, and `AArch64BackendTuningModel` in `backend-catalog-interfaces.ts`.
- `authenticateAArch64BackendTargetSurface` consumes an existing `AArch64TargetSurface` and deterministic backend catalog inputs.
- Authentication verifies expected profile ID, source surface fingerprint, cross-catalog consistency, x18 reservation for `wrela-uefi-aarch64-rpi5-v1`, PE/COFF relocation mapping presence, unwind/frame compatibility, and deterministic backend fingerprint.
- Backend internals can consume catalog interfaces without casting back to source target surface records.
- Tests cover success, missing catalog, fingerprint mismatch, x18 released in the rpi5 profile, relocation without PE/COFF mapping, and non-deterministic catalog order normalized by authentication.

**Execution Steps:**

- [ ] Write `backend-target-surface.test.ts` for successful authentication, missing catalog, source fingerprint mismatch, x18 allocatable rejection, missing PE/COFF relocation mapping, and catalog order normalization; expected first failure is missing `authenticateAArch64BackendTargetSurface`.
- [ ] Define every catalog capability interface in `backend-catalog-interfaces.ts` before writing the authenticator body. Do not define concrete catalog data here.
- [ ] Define `AArch64BackendSurfaceAuthenticationInput`, `AArch64BackendTargetSurface`, and authentication result types in `backend-target-surface.ts`.
- [ ] Implement authentication as pure normalization: verify source fingerprint, profile ID, required catalog presence, cross-catalog keys, x18 reservation, relocation mapping presence, unwind/frame compatibility, and deterministic backend fingerprint.
- [ ] Implement `backend-target-surface-fakes.ts` with fakes for each catalog interface and a `fakeBackendSurfaceAuthenticationInput` helper that is valid by default.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/backend-target-surface.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit backend target surface source, fakes, and tests.

**Code Examples:**

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

```ts
export interface AArch64PhysicalRegisterModel {
  readonly fingerprint: string;
  readonly registers: readonly AArch64PhysicalRegisterRecord[];
  readonly aliasSets: readonly AArch64PhysicalAliasSetRecord[];
  readonly publicParameterGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly publicResultGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly publicCallerSavedGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly publicCalleeSavedGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly privateConventionCandidateGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly veneerScratchGprs: readonly AArch64PhysicalRegisterStableKey[];
  readonly encodingNumberOf: (register: AArch64PhysicalRegisterStableKey) => number;
  readonly aliasSetOf: (register: AArch64PhysicalRegisterStableKey) => AArch64PhysicalAliasSetKey;
  readonly canAllocate: (register: AArch64PhysicalRegisterStableKey) => boolean;
  readonly permitsOperand: (input: AArch64RegisterOperandPermissionQuery) => boolean;
}

export interface AArch64EncodingCatalog {
  readonly fingerprint: string;
  readonly entries: readonly AArch64EncodingCatalogEntry[];
  readonly entryForOpcode: (
    opcode: AArch64PhysicalOpcode,
  ) => AArch64EncodingCatalogEntry | undefined;
  readonly knownByteFixtureFor: (
    fixtureId: AArch64KnownByteFixtureId,
  ) => AArch64KnownByteFixture | undefined;
}

export interface AArch64RelocationCatalog {
  readonly fingerprint: string;
  readonly mappings: readonly AArch64RelocationCatalogMapping[];
  readonly mappingFor: (
    family: AArch64InternalRelocationFamily,
  ) => AArch64RelocationCatalogMapping | undefined;
}

export interface AArch64UnwindCatalog {
  readonly fingerprint: string;
  readonly templates: readonly AArch64UnwindTemplate[];
  readonly templateForFrame: (shape: AArch64FrameShapeKey) => AArch64UnwindTemplate | undefined;
}

export interface AArch64FrameCatalog {
  readonly fingerprint: string;
  readonly stackAlignmentBytes: 16;
  readonly frameRecordRules: readonly AArch64FrameRecordRule[];
  readonly encodableOffsetClasses: readonly AArch64FrameOffsetClass[];
}

export interface AArch64VeneerCatalog {
  readonly fingerprint: string;
  readonly veneerKinds: readonly AArch64VeneerKindRecord[];
  readonly policyFor: (site: AArch64VeneerSiteKind) => AArch64VeneerPolicy | undefined;
}

export interface AArch64LiteralPoolCatalog {
  readonly fingerprint: string;
  readonly literalClasses: readonly AArch64LiteralPoolClassRecord[];
  readonly placementPolicyFor: (
    literalClass: AArch64LiteralPoolClassKey,
  ) => AArch64LiteralPoolPlacementPolicy | undefined;
}

export interface AArch64BackendSecurityCatalog {
  readonly fingerprint: string;
  readonly constantTimeInstructions: readonly AArch64PhysicalOpcode[];
  readonly constantTimeHelpers: readonly string[];
  readonly secretLiteralPolicy: "forbid" | "catalog-approved-only";
}

export interface AArch64BackendTuningModel {
  readonly fingerprint: string;
  readonly latencyWeights: readonly AArch64LatencyWeight[];
  readonly throughputWeights: readonly AArch64ThroughputWeight[];
  readonly pressureWeights: readonly AArch64PressureWeight[];
}
```

```ts
test("authenticator rejects rpi5 backend surfaces that make x18 allocatable", () => {
  const result = authenticateAArch64BackendTargetSurface(
    fakeBackendSurfaceAuthenticationInput({
      registerModel: fakeRegisterModel({ x18Policy: "allocatable" }),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected rejected x18 policy");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "backend-target:register-model:x18-must-be-reserved:wrela-uefi-aarch64-rpi5-v1",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/backend-target-surface.test.ts
```

## Task 5: Closed-Image Backend Plan Model and Verifier

**Description:** Implement `AArch64ClosedImageBackendPlan`, private convention records, public-boundary tables, final visibility/address-taken tables, deterministic fingerprinting, and plan verification.

**Dependencies:** Task 2.

**Files:**

- Create: `src/target/aarch64/backend/api/closed-image-backend-plan.ts`
- Create: `tests/support/target/aarch64/backend/closed-image-plan-fakes.ts`
- Create: `tests/unit/target/aarch64/backend/closed-image-backend-plan.test.ts`

**Acceptance Criteria:**

- Supports `closureKind: "closed-image"` and `closureKind: "relocatable-public-only"`.
- Closed-image plans require participating modules, final symbol visibility, final address-taken state, replacement/public boundary tables, private convention records, and an authority fingerprint.
- Relocatable-public-only plans forbid private conventions.
- Verifier rejects stale authority fingerprints, private convention for exported or address-taken function, missing caller/callee agreement, replacement boundary using private ABI, and public boundary missing from tables.
- Tests cover eligible private ABI, address-taken rejected, exported rejected, replacement rejected, stale fingerprint rejected, and relocatable-public-only public fallback.

**Execution Steps:**

- [ ] Write `closed-image-backend-plan.test.ts` for eligible private ABI, address-taken rejection, exported rejection, replacement rejection, stale fingerprint rejection, missing caller/callee agreement, and relocatable-public-only fallback; expected first failure is missing `verifyAArch64ClosedImageBackendPlan`.
- [ ] Define `AArch64ClosedImageBackendPlan`, final visibility/address-taken tables, replacement/public boundary tables, private convention records, and authority fingerprint records in `closed-image-backend-plan.ts`.
- [ ] Implement deterministic table normalization by symbol/caller/callee stable key, rejecting duplicate conflicting records.
- [ ] Implement verifier rules in this order: authority fingerprint freshness, closure-kind restrictions, public-boundary coverage, private-convention eligibility, caller/callee agreement, replacement-boundary public fallback.
- [ ] Implement `closed-image-plan-fakes.ts` with valid-by-default plan, private convention, visibility, and address-taken helpers.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/closed-image-backend-plan.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit closed-image plan source, fakes, and tests.

**Code Examples:**

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

```ts
test("closed-image verifier rejects private convention for address-taken callee", () => {
  const plan = closedImageBackendPlanForTest({
    addressTaken: finalAddressTakenTableForTest([{ symbol: "helper", addressTaken: true }]),
    privateConventions: [privateConventionForTest({ callee: "helper" })],
  });

  const result = verifyAArch64ClosedImageBackendPlan({
    plan,
    machineProgram: singleFunctionMachineProgramForTest("helper"),
    target: authenticatedBackendTargetSurfaceForTest(),
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected invalid private ABI");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "closed-image-plan:private-convention-address-taken:helper",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/closed-image-backend-plan.test.ts
```

## Task 5A: Shared Backend Test Fixtures and Contract Lockfile

**Description:** Own the backend fixture builders and shared type-surface assertions used by every later task. This prevents parallel workers from inventing incompatible `*ForTest` helpers or drifting on `stableKey` names.

**Dependencies:** Tasks 2, 3, 4, 5.

**Files:**

- Create: `tests/support/target/aarch64/backend/backend-fixture-contract.ts`
- Create: `tests/support/target/aarch64/backend/backend-fixtures.ts`
- Extend: `tests/support/target/aarch64/backend/backend-target-surface-fakes.ts`
- Extend: `tests/support/target/aarch64/backend/closed-image-plan-fakes.ts`
- Extend: `tests/support/target/aarch64/backend/object-module-fixtures.ts`
- Create: `tests/unit/target/aarch64/backend/backend-fixture-contract.test.ts`

**Acceptance Criteria:**

- Defines the canonical signatures for `backendInputForTest`, `authenticatedBackendTargetSurfaceForTest`, `staleBackendTargetSurfaceForTest`, `closedImageBackendPlanForTest`, `machineProgramForTest`, `singleFunctionMachineProgramForTest`, `sectionForTest`, `symbolForTest`, `relocationForTest`, and `packetLoopBackendInputForTest`.
- Default `backendInputForTest()` returns a fully authenticated target, valid closed-image plan, empty-but-valid machine program, preserved fact set, provenance map, and deterministic debug request state.
- All helper records use `stableKey` for identity. `sectionForTest("text.z")` and `sectionForTest({ stableKey: "text.z" })` normalize to the same object shape.
- Fixture defaults are production-valid, frozen, deterministic, and free of host path, timestamp, process ID, random, and environment data.
- The contract test compiles against the exported helper signatures and asserts that the helpers satisfy Task 9's input contract with no override data.

**Execution Steps:**

- [ ] Write `backend-fixture-contract.test.ts` importing every helper from `tests/support/target/aarch64/backend/backend-fixtures.ts`; expected failure is a module-not-found/type error for the new fixture module.
- [ ] Add `backend-fixture-contract.ts` with only exported TypeScript interfaces and helper input types; keep it under `tests/support`.
- [ ] Implement `backend-fixtures.ts` using fakes from Tasks 3-5 and existing machine-IR builders from `tests/support/target/aarch64/machine-ir/builders.ts`.
- [ ] Extend the target-surface, closed-image-plan, and object-module support files so every helper returns frozen deterministic records using `stableKey`.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/backend-fixture-contract.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS.
- [ ] Commit only the fixture/support files and contract test.

**Code Examples:**

```ts
export interface BackendInputForTestOptions {
  readonly machineProgram?: AArch64MachineProgram;
  readonly preservedFacts?: AArch64PreservedFactSet;
  readonly provenance?: AArch64ProvenanceMap;
  readonly target?: AArch64BackendTargetSurface;
  readonly closedImagePlan?: AArch64ClosedImageBackendPlan;
  readonly diagnosticMode?: AArch64BackendDiagnosticMode;
  readonly debugArtifacts?: AArch64BackendDebugArtifactRequest;
}

export declare function backendInputForTest(
  options?: BackendInputForTestOptions,
): CompileAArch64ObjectInput;

export declare function authenticatedBackendTargetSurfaceForTest(
  options?: BackendTargetSurfaceForTestOptions,
): AArch64BackendTargetSurface;

export declare function closedImageBackendPlanForTest(
  options?: ClosedImagePlanForTestOptions,
): AArch64ClosedImageBackendPlan;

export declare function sectionForTest(
  input?: string | ObjectSectionForTestOptions,
): AArch64ObjectSection;
```

```ts
test("default backend input fixture satisfies the shared fixture contract", () => {
  const input = backendInputForTest();

  expect(input.target.backendSurfaceFingerprint).toBe(
    authenticatedBackendTargetSurfaceForTest().backendSurfaceFingerprint,
  );
  expect(input.closedImagePlan.closureKind).toBe("closed-image");
  expect(input.machineProgram.functions).toEqual([]);
  expect(input.debugArtifacts).toEqual({});
});
```

```ts
test("object fixtures normalize identity onto stableKey", () => {
  expect(sectionForTest("text.z")).toEqual(sectionForTest({ stableKey: "text.z" }));
  expect(symbolForTest("main").stableKey).toBe("main");
  expect(relocationForTest("reloc.a").stableKey).toBe("reloc.a");
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/backend-fixture-contract.test.ts
```

## Task 6: OptIR Fact Registry Migration to Shared Core

**Description:** Move the existing OptIR fact extension registry behind the shared compiler fact extension contract while preserving existing OptIR public behavior and tests.

**Dependencies:** Task 1.

**Files:**

- Modify: `src/opt-ir/facts/fact-extension-registry.ts`
- Modify: `src/opt-ir/facts/fact-preservation.ts`
- Modify: `tests/unit/opt-ir/fact-extension-registry.test.ts`
- Modify: existing OptIR fact tests that directly assert registry payloads

**Acceptance Criteria:**

- Existing OptIR fact imports still pass all existing tests.
- OptIR fact extensions instantiate `CompilerFactExtension` with OptIR subjects and rewrite kinds.
- Existing OptIR string-keyed callers remain source-compatible through adapter functions.
- Preservation, weakening, invalidation, dropped-fact records, and stale-subject diagnostics use shared transfer/preservation vocabulary.
- Tests cover an OptIR fact extension with typed payload validation, subject indexing, preserve, weaken, invalidate, dropped-fact, and stale-subject cases.

**Execution Steps:**

- [ ] Extend `tests/unit/opt-ir/fact-extension-registry.test.ts` with the shown malformed-payload adapter case; expected first failure is missing shared-extension adapter exports.
- [ ] Extend `tests/unit/opt-ir/fact-preservation.test.ts` with preserve, weaken, invalidate, dropped-fact, and stale-subject assertions using current OptIR fixtures.
- [ ] Inventory current OptIR fact modules that call `createOptIrFactRecordRegistry` and port each to instantiate `CompilerFactExtension` through an OptIR adapter, preserving existing import signatures.
- [ ] Modify `fact-extension-registry.ts` so existing string-keyed callers delegate to the shared registry while keeping source-compatible helper names.
- [ ] Modify `fact-preservation.ts` so preservation and invalidation results use shared transfer vocabulary and deterministic diagnostics.
- [ ] Run `bun test ./tests/unit/opt-ir/fact-extension-registry.test.ts ./tests/unit/opt-ir/fact-preservation.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit only OptIR fact registry/preservation files and updated OptIR fact tests.

**Code Examples:**

```ts
const optIrBoundsFactExtension: CompilerFactExtension<
  OptIrFactSubject,
  OptIrBoundsFactPayload,
  OptIrRewriteKind,
  OptIrRewrittenSubject
> = {
  extensionKey: compilerFactExtensionKey("opt-ir.bounds"),
  validateImport: validateOptIrBoundsPayload,
  indexKeysFor: (payload) => [{ kind: "value", valueId: payload.valueId }],
  preservationRules: [preserveWithinDominatingRegion("value")],
  invalidationRules: [invalidateOnSubjectDeletion("value")],
  transferRules: new Map([["clone-operation", copyPureFactTransferRule()]]),
  upstreamVerifierKey: factVerifierKey("proof.bounds"),
  negativeFixtures: [malformedBoundsFixture()],
};
```

```ts
test("OptIR registry adapter exposes shared typed extension diagnostics", () => {
  const registry = optIrFactExtensionRegistryForTest([optIrBoundsFactExtension]);
  const result = registry.validateImport("opt-ir.bounds", { valueId: "not-a-number" });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected malformed payload");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "fact-extension:malformed-payload:opt-ir.bounds:valueId",
  ]);
});
```

```bash
bun test ./tests/unit/opt-ir/fact-extension-registry.test.ts ./tests/unit/opt-ir/fact-preservation.test.ts
```

## Task 7: AArch64 Machine Fact Re-Keying Expansion

**Description:** Expand machine fact re-keying to typed machine subjects and payloads that the backend can import without reading OptIR internals.

**Dependencies:** Task 1.

**Files:**

- Modify: `src/target/aarch64/machine-ir/fact-set.ts`
- Modify: `src/target/aarch64/facts/aarch64-fact-rekeying.ts`
- Modify: `src/target/aarch64/facts/aarch64-fact-adapter.ts`
- Modify: `src/target/aarch64/facts/aarch64-fact-query.ts`
- Modify: `tests/support/target/aarch64/facts/opt-ir-facts.ts`
- Create: `tests/unit/target/aarch64/backend/machine-fact-rekeying.test.ts`

**Acceptance Criteria:**

- Machine fact records carry an extension key, typed subject kind, payload, lineage, upstream verifier key, target declaration keys, and manifest gate when present.
- Supported backend subject kinds include machine function, block, edge, instruction, virtual register, memory operand, frame object, symbol, call site, region, relocation reference, target declaration, and dropped-fact record.
- Re-keying records deterministic dropped facts when no machine subject exists.
- Query layer can retrieve facts by family and subject without callers scanning raw payloads.
- Tests cover virtual register, memory operand, call site, symbol, region, relocation reference, target declaration, malformed payload, stale subject, and dropped-fact diagnostics.

**Execution Steps:**

- [ ] Write `machine-fact-rekeying.test.ts` for each supported subject kind plus malformed payload, stale subject, and dropped fact diagnostics; expected first failure is missing typed machine subject exports.
- [ ] Extend `machine-ir/fact-set.ts` with typed machine fact records carrying extension key, subject, payload, lineage, upstream verifier key, target declaration keys, and optional manifest gate.
- [ ] Extend `aarch64-fact-rekeying.ts` to map OptIR subjects to typed AArch64 machine subjects or deterministic dropped-fact records.
- [ ] Extend `aarch64-fact-adapter.ts` and `aarch64-fact-query.ts` so callers can query by family and subject without scanning raw payload arrays.
- [ ] Update `tests/support/target/aarch64/facts/opt-ir-facts.ts` with source fixtures for call-site, memory-operand, symbol, region, relocation-reference, and target-declaration facts.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/machine-fact-rekeying.test.ts ./tests/unit/target/aarch64/aarch64-fact-adapter.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit machine fact-set, fact adapter/query/re-keying, support fixtures, and tests.

**Code Examples:**

```ts
export type AArch64MachineFactSubject =
  | { readonly kind: "machineFunction"; readonly functionId: number }
  | { readonly kind: "machineBlock"; readonly blockId: number }
  | { readonly kind: "machineEdge"; readonly edgeKey: string }
  | { readonly kind: "machineInstruction"; readonly instructionId: number }
  | { readonly kind: "virtualRegister"; readonly vreg: number }
  | {
      readonly kind: "memoryOperand";
      readonly instructionId: number;
      readonly operandIndex: number;
    }
  | { readonly kind: "frameObject"; readonly frameObjectId: number }
  | { readonly kind: "symbol"; readonly symbol: string }
  | { readonly kind: "callSite"; readonly callKey: string }
  | { readonly kind: "region"; readonly regionKey: string }
  | { readonly kind: "relocationReference"; readonly relocationId: number }
  | { readonly kind: "targetDeclaration"; readonly targetDeclarationKey: string };
```

```ts
test("re-keying preserves internal-call eligibility on call-site subjects", () => {
  const result = rekeyOptIrFactsToAArch64MachineFacts(
    factRekeyingFixture({
      optIrFacts: [internalCallEligibilityFactForTest({ optIrCallOperationId: 12 })],
      callSites: [{ operationId: 12, callKey: "call:main:helper:0" }],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected re-keying success");
  expect(result.preservedFacts.records.map((record) => record.subject)).toEqual([
    { kind: "callSite", callKey: "call:main:helper:0" },
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/machine-fact-rekeying.test.ts ./tests/unit/target/aarch64/aarch64-fact-adapter.test.ts
```

## Task 8: Backend Public API and Pipeline Shell

**Description:** Add `compileAArch64Object` and a deterministic backend pipeline scaffold that wires every design stage: input verification, fact import, closed-image verification, ABI reconciliation, liveness/dependency import, allocation, spill/remat, move resolution, allocation verification, frame layout, prologue/epilogue finalization, unwind planning, physical IR/pseudo expansion, post-allocation scheduling/peepholes, layout/encode, object assembly, and verification. Stage internals may be typed pass-through only when a later task owns the real implementation.

**Dependencies:** Tasks 2, 3, 4, 5, 5A.

**Files:**

- Create: `src/target/aarch64/backend/api/compile-aarch64-object.ts`
- Create: `src/target/aarch64/backend/api/backend-pipeline.ts`
- Modify: `src/target/aarch64/public-api.ts`
- Modify: `src/target/aarch64/index.ts`
- Modify: `src/target/index.ts`
- Create: `tests/unit/target/aarch64/backend/backend-public-api.test.ts`

**Acceptance Criteria:**

- Public input matches the design: machine program, preserved facts, provenance, backend target, closed-image plan, diagnostic mode, debug artifact request.
- Result returns diagnostics on both success and error.
- Default pipeline exposes canonical backend stage keys for every major design stage and deterministic test override wiring.
- Empty machine program with valid target and plan returns an empty object module only after input contract, verification summary, and object verification stages have run.
- Invalid stage override returning malformed state is rejected with a backend diagnostic rather than a thrown exception.

**Stage Ownership:**

```text
verify-input-contract                         Task 9
import-backend-facts                          Task 10
verify-closed-image-plan                      Task 5
classify-public-abi                           Task 14
reconcile-call-boundaries                     Task 15
build-liveness-and-interference               Task 16
allocate-registers                            Task 17
repair-spills-and-remats                      Task 18
resolve-parallel-copies                       Task 19
verify-allocation                             Task 20
layout-frames                                 Task 21
finalize-prologue-epilogue-tail-trap-noreturn Task 22
plan-unwind                                   Task 23
build-physical-ir-and-expand-pseudos          Task 24
post-ra-schedule-and-peephole                 Task 25
layout-and-encode                             Task 31
assemble-object-module                        Task 3 plus Task 31 output
verify-object-module                          Task 32
debug-artifact-collection                     Task 33
end-to-end-stage-wiring                       Task 34
```

**Execution Steps:**

- [ ] Write `backend-public-api.test.ts` for root export wiring, default stage key order, empty valid input, and malformed test-stage override; expected first failure is missing `compileAArch64Object`.
- [ ] Define `CompileAArch64ObjectInput`, `CompileAArch64ObjectResult`, stage state types, stage result types, and test override injection in `compile-aarch64-object.ts` and `backend-pipeline.ts`.
- [ ] Implement the default pipeline as an ordered readonly stage list using the exact stage keys in the code example.
- [ ] Implement pass-through stage bodies that verify state shape and append verifier runs, leaving real stage internals to their owning later tasks.
- [ ] Export the backend public API from `src/target/aarch64/public-api.ts`, `src/target/aarch64/index.ts`, and `src/target/index.ts`.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/backend-public-api.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit backend API/pipeline files, export files, and public API test.

**Code Examples:**

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
```

```ts
test("public API exports compileAArch64Object from target root", () => {
  expect(compileAArch64ObjectFromTargetRoot).toBe(compileAArch64Object);
  expect(defaultAArch64BackendPipeline.map((stage) => stage.stageKey)).toEqual([
    "verify-input-contract",
    "import-backend-facts",
    "verify-closed-image-plan",
    "classify-public-abi",
    "reconcile-call-boundaries",
    "build-liveness-and-interference",
    "allocate-registers",
    "repair-spills-and-remats",
    "resolve-parallel-copies",
    "verify-allocation",
    "layout-frames",
    "finalize-prologue-epilogue-tail-trap-noreturn",
    "plan-unwind",
    "build-physical-ir-and-expand-pseudos",
    "post-ra-schedule-and-peephole",
    "layout-and-encode",
    "assemble-object-module",
    "verify-object-module",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/backend-public-api.test.ts
```

## Task 9: Backend Input Contract Verifier

**Description:** Implement the non-mutating backend input gate that rejects stale target surfaces, malformed machine programs, stale closed-image plans, unresolved subjects, malformed fact families, and unsupported target authority before any backend rewrite occurs.

**Dependencies:** Tasks 1, 2, 4, 5, 5A, 7, 8.

**Files:**

- Create: `src/target/aarch64/backend/verify/input-contract-verifier.ts`
- Create: `tests/unit/target/aarch64/backend/backend-input-contract.test.ts`

**Acceptance Criteria:**

- Verifies target backend surface fingerprint matches machine program target fingerprint or consulted backend/source fingerprints.
- Verifies all machine functions, blocks, instructions, operands, frame objects, symbols, relocation references, call sites, and fact subjects resolve exactly once.
- Verifies closed-image plan covers private convention candidates and marks public, firmware, exported, address-taken, and replacement boundaries.
- Verifies dependency summaries include memory, call, NZCV, FPCR/FPSR, vector-state, and scheduling barriers needed by selected instructions.
- Verifies facts have known extension schemas, lineage, verifier family, target declaration keys, and rewrite behavior.
- Returns deterministic diagnostics and never emits partial object state on failure.

**Execution Steps:**

- [ ] Write `backend-input-contract.test.ts` for unresolved fact subject, stale target, malformed machine program identity, stale closed-image plan, duplicate machine subject, malformed fact family, and unsupported target authority; expected first failure is missing `verifyAArch64BackendInputContract`.
- [ ] Define input verifier result, resolved subject index, and dependency-summary checks in `input-contract-verifier.ts`.
- [ ] Build a deterministic subject index for functions, blocks, instructions, operands, frame objects, symbols, relocation references, call sites, and fact subjects; reject missing or duplicate subjects before any rewrite state is created.
- [ ] Verify target fingerprints, closed-image plan coverage, dependency summaries, fact extension schemas, fact lineage, upstream verifier keys, target declaration keys, and rewrite behavior.
- [ ] Wire `compileAArch64Object` so input-contract failure stops the pipeline with only an `input-contract` verifier run and no partial object module.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/backend-input-contract.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit input verifier, pipeline wiring changes, and tests.

**Code Examples:**

```ts
test("input contract rejects fact subjects that do not resolve in the machine program", () => {
  const result = verifyAArch64BackendInputContract(
    backendInputForTest({
      preservedFacts: preservedFactsForTest([
        machineFactForTest({
          extensionKey: "security.no-spill",
          subject: { kind: "virtualRegister", vreg: 999 },
        }),
      ]),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected unresolved fact subject");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "input-contract:fact-subject-missing:security.no-spill:vreg:999",
  ]);
});
```

```ts
test("compileAArch64Object stops before fact import when input contract fails", () => {
  const result = compileAArch64Object(
    backendInputForTest({ target: staleBackendTargetSurfaceForTest() }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected contract error");
  expect(result.verification.runs.map((run) => run.verifierKey)).toEqual(["input-contract"]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/backend-input-contract.test.ts
```

## Task 10: Backend Fact Import and Query

**Description:** Import preserved machine facts into backend fact indexes using the shared fact-extension registry and expose typed query interfaces for ABI, allocation, frame, finalization, layout, object, and verification stages.

**Dependencies:** Tasks 1, 2, 5A, 7, 9.

**Files:**

- Create: `src/target/aarch64/backend/facts/backend-fact-subjects.ts`
- Create: `src/target/aarch64/backend/facts/backend-fact-import.ts`
- Create: `src/target/aarch64/backend/facts/backend-fact-query.ts`
- Create: `tests/unit/target/aarch64/backend/backend-fact-import.test.ts`

**Acceptance Criteria:**

- Defines closed backend subject vocabulary for machine entities plus physical allocation, frame, object, relocation, literal-pool, and veneer entities.
- Imports fact families listed in the design's authoritative backend fact table with typed payload validators.
- Validates extension key, payload schema, subject kind, lineage, upstream verifier key, target declarations, duplicate authority, and fallback policy.
- Exposes typed queries such as no-spill by vreg, rematerialization by instruction/vreg, memory-order by memory operand, internal-call eligibility by call site, object-linkage by symbol, and terminal-exit by edge.
- Tests cover unknown key, malformed payload, wrong subject kind, missing upstream verifier, duplicate conflicting facts, conservative fallback facts, and deterministic query ordering.

**Backend Fact Import Matrix:**

```text
family                             subjects                                   fallback owner                   transfer behavior
ownership-lifetime                 virtualRegister, edge, callSite            liveness                         weaken or invalidate on split/delete
returned-consumed-path-state        edge, callSite, virtualRegister            finalization                     move/copy on edge rewrite, invalidate on deleted edge
session-membership-and-escape       virtualRegister, region, callSite, symbol  ABI                              weaken to public ABI on uncertainty
validated-region-shape              region, memoryOperand, frameObject         frame/finalization               move on address rewrite, reject malformed shape
initialized-prefix-and-capacity     region, virtualRegister, memoryOperand     frame/stores                     weaken to guarded writes
disjoint-field-and-private-generation virtualRegister, memoryOperand, region   allocator                        invalidate on overlapping rewrite
terminal-exit-and-cleanup           edge, block, callSite                      epilogue/security                move on edge split, copy to cleanup clone
bounded-cardinality                 function, block, region, loop              allocator/scheduler              weaken to ordinary pressure
internal-call-eligibility           callSite, function, symbol                 ABI                              invalidate on public/replacement boundary
final-linkage-and-visibility        symbol, function, module                   closed-image verifier            reject stale authority
core-owner-and-transfer             virtualRegister, region, callSite, edge    scheduler/ABI                    move or split by rewrite transaction
security-and-secret-lifetime        virtualRegister, frameObject, memoryOperand, edge security verifier         reject unsafe spill/copy, move on legal rewrite
rematerialization-authority         instruction, symbol, relocationReference, virtualRegister spill/remat       rederive-from-catalog or invalidate
memory-order-and-region-type        memoryOperand, region, platformAction, call scheduler/finalization          weaken to conservative barrier
vector-state-and-fp-environment     function, call, instruction, virtualRegister allocation/scheduler          reject unsupported vector-only semantics
object-linkage-and-veneer-policy    symbol, relocationReference, callSite, sectionFragment layout/object        move to relocation/veneer records
```

Each family validator must declare payload schema, allowed subject kinds, upstream verifier key, target declaration requirements, fallback behavior, and rewrite transfer behavior. Importing an unknown family is an error unless a target declaration explicitly marks it debug-only and the consuming stage has a conservative fallback.

**Execution Steps:**

- [ ] Write `backend-fact-import.test.ts` for unknown family, malformed payload, wrong subject kind, missing upstream verifier, duplicate conflicting authority, conservative fallback, and deterministic query ordering; expected first failure is missing `importAArch64BackendFacts`.
- [ ] Define closed backend subject types in `backend-fact-subjects.ts` for machine, allocation, frame, object, relocation, literal-pool, and veneer entities.
- [ ] Define one validator entry per family in the Backend Fact Import Matrix, including payload schema, allowed subjects, upstream verifier key, target declaration requirements, fallback owner, and transfer behavior.
- [ ] Implement import as pure normalization: validate each machine fact, group by family and subject, reject conflicting duplicate authorities, create fallback records where allowed, and sort all diagnostics and query results.
- [ ] Implement `backend-fact-query.ts` with typed query groups for security, calls, rematerialization, memory order, object linkage, terminal exits, vector/FP state, and region shape.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/backend-fact-import.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit backend fact subject/import/query files and tests.

**Code Examples:**

```ts
export interface AArch64BackendFactIndex {
  readonly security: {
    readonly noSpillForVirtualRegister: (
      vreg: AArch64VirtualRegisterId,
    ) => AArch64NoSpillFact | undefined;
    readonly wipeOnSpillForVirtualRegister: (
      vreg: AArch64VirtualRegisterId,
    ) => AArch64WipeOnSpillFact | undefined;
  };
  readonly calls: {
    readonly internalEligibilityForCallSite: (
      callKey: string,
    ) => AArch64InternalCallEligibilityFact | undefined;
  };
  readonly rematerialization: {
    readonly authorityForVirtualRegister: (
      vreg: AArch64VirtualRegisterId,
    ) => readonly AArch64RematerializationAuthorityFact[];
  };
}
```

```ts
test("backend fact import rejects no-spill fact on a memory operand subject", () => {
  const result = importAArch64BackendFacts(
    backendFactImportInputForTest({
      facts: [
        machineFactForTest({
          extensionKey: "security.no-spill",
          subject: { kind: "memoryOperand", instructionId: 3, operandIndex: 1 },
          payload: { label: "session-key" },
        }),
      ],
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected wrong subject kind");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "backend-fact-import:wrong-subject:security.no-spill:memoryOperand",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/backend-fact-import.test.ts
```

## Task 11: Backend Rewrite Transaction and Provenance Transfer

**Description:** Implement the single mutation owner for backend rewrites. Every spill, reload, remat, copy, frame rewrite, pseudo expansion, scheduling change, branch relaxation, literal-pool rewrite, and veneer insertion must go through this transaction.

**Dependencies:** Tasks 2, 3, 10.

**Files:**

- Create: `src/target/aarch64/backend/facts/backend-rewrite-transaction.ts`
- Create: `tests/unit/target/aarch64/backend/backend-rewrite-transaction.test.ts`

**Acceptance Criteria:**

- Supports transaction kinds from the design: instruction-local replacement, block-local rewrite, edge/block split, live-range repair region, frame-layout rewrite, section-fragment/layout rewrite, whole-function rewrite, and closed-image metadata rewrite.
- Commit allocates stable IDs for new instructions, blocks, frame objects, symbols, fragments, relocations, veneers, and literal-pool entries.
- Commit builds old-to-new subject maps, applies registered fact transfer rules, transfers security labels, invalidates backend analyses, attaches provenance, emits verifier plans, sorts diagnostics, and is atomic.
- No transaction can leave facts attached to deleted subjects or silently drop linear/security facts.
- Tests cover successful replace instruction, rejected no-spill spill insertion, split fact transfer, copy pure fact transfer, atomic rollback on one failed transfer, and deterministic verifier plan.

**Execution Steps:**

- [ ] Write `backend-rewrite-transaction.test.ts` for replace-instruction success, rejected no-spill spill insertion, split transfer, pure copy transfer, atomic rollback, and deterministic verifier plan; expected first failure is missing `beginAArch64BackendRewriteTransaction`.
- [ ] Define immutable snapshot, draft edit, rewrite kind, subject map, fact transfer plan, provenance attachment, verifier invalidation, and commit result types in `backend-rewrite-transaction.ts`.
- [ ] Implement transaction staging with no mutation of the input snapshot; every draft edit records old subjects, new draft subjects, provenance reason, fact-transfer behavior, and invalidated analysis families.
- [ ] Implement commit in this order: allocate stable IDs, build old-to-new subject maps, apply fact transfer rules, transfer security labels, attach provenance, build verifier plan, sort diagnostics, freeze output snapshot.
- [ ] Implement atomic rollback by returning the original snapshot unchanged whenever any transfer, security, or verifier-plan step fails.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/backend-rewrite-transaction.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit rewrite transaction source and tests.

**Code Examples:**

```ts
const result = beginAArch64BackendRewriteTransaction({
  kind: "spill-insertion",
  snapshot,
})
  .replaceInstruction({
    oldInstruction: instructionId(4),
    replacements: [spillStoreDraftForTest({ source: vreg(2), slot: frameSlot(0) })],
    transfer: moveFactTransferPlan({ from: subject.vreg(2), to: subject.frameSlot(0) }),
  })
  .commit();

expect(result.kind).toBe("error");
if (result.kind !== "error") throw new Error("expected no-spill rejection");
expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
  "rewrite-transfer:rejected:security.no-spill:spill-insertion:vreg:2",
]);
```

```ts
test("commit is atomic when one replacement transfer fails", () => {
  const snapshot = backendSnapshotForTest({ instructions: [movzInstruction(), addInstruction()] });
  const result = transactionWithOneLegalAndOneIllegalEdit(snapshot).commit();

  expect(result.kind).toBe("error");
  expect(snapshot.instructions.entries().map((instruction) => instruction.instructionId)).toEqual([
    instructionId(0),
    instructionId(1),
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/backend-rewrite-transaction.test.ts
```

## Task 12: Security Label Conservation

**Description:** Implement the single security invariant for no-spill, wipe-on-spill, secret labels, key lifetimes, zeroization obligations, constant-time regions, table access, branch shape, and timing-visible calls.

**Dependencies:** Tasks 4, 10, 11.

**Files:**

- Create: `src/target/aarch64/backend/facts/security-label-conservation.ts`
- Create: `src/target/aarch64/backend/verify/security-verifier.ts`
- Create: `tests/unit/target/aarch64/backend/security-label-conservation.test.ts`

**Acceptance Criteria:**

- Tracks label images across rewrite transactions.
- Rejects no-spill assignment to spill slots, stack slots, literal pools, and memory rematerializations.
- Splits wipe-on-spill obligations across every observable exit and verifies wipe placement before observation, reuse, tail call, noreturn, trap, and veneer exits.
- Enforces constant-time catalog policy for secret operands, secret branches, table indices, call targets, memory addresses, rematerialization, and helper calls.
- Provides verifier results consumed by allocation/frame/finalization/object verifiers without duplicating security rules there.
- Tests cover no-spill allocation success, no-spill spill rejection, wipe placement on normal/error/tail/noreturn exits, secret table access rejection, secret branch rejection, approved constant-time helper, and veneer path with required wipes.

**Execution Steps:**

- [ ] Write `security-label-conservation.test.ts` for no-spill allocation success, no-spill spill rejection, wipe placement on return/error/tail/noreturn exits, secret table rejection, secret branch rejection, approved constant-time helper, and veneer wipe path; expected first failure is missing `verifyAArch64SecurityLabelConservation`.
- [ ] Define security image records for virtual registers, physical registers, frame slots, literal pools, memory operands, exits, helper calls, branch sites, table accesses, and veneer paths in `security-label-conservation.ts`.
- [ ] Implement label-image construction from backend facts and rewrite transaction subject maps, preserving lineage from original fact authority to final subject.
- [ ] Implement no-spill checks for physical assignment, spill slots, stack slots, literal pools, and memory rematerializations before wipe checks run.
- [ ] Implement wipe-on-spill obligation propagation across every observable exit kind and verify wipe dominance before observation, reuse, tail call, noreturn, trap, and veneer exit.
- [ ] Implement constant-time catalog checks for secret operands, secret branches, table indices, memory addresses, call targets, helper calls, and rematerialization.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/security-label-conservation.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit security conservation/verifier source and tests.

**Code Examples:**

```ts
test("wipe-on-spill obligation must be present before tail call exit", () => {
  const result = verifyAArch64SecurityLabelConservation(
    securityScenarioForTest({
      labels: [wipeOnSpillLabelForTest({ vreg: 4, slot: 1 })],
      exits: [tailCallExitForTest({ callKey: "tail:main:exit" })],
      wipes: [],
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected missing wipe");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "security:wipe-on-spill-missing-before-exit:vreg:4:slot:1:tail:main:exit",
  ]);
});
```

```ts
test("approved constant-time helper permits secret operand call", () => {
  const result = verifyAArch64SecurityLabelConservation(
    securityScenarioForTest({
      labels: [secretLabelForTest({ vreg: 2 })],
      calls: [helperCallForTest({ helperKey: "ct.memcmp.fixed", secretArgs: [2] })],
      securityCatalog: securityCatalogForTest({
        constantTimeHelpers: ["ct.memcmp.fixed"],
      }),
    }),
  );

  expect(result).toEqual({ kind: "ok", diagnostics: [] });
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/security-label-conservation.test.ts
```

## Task 13: Canonical Physical Register Model

**Description:** Implement the authenticated physical register model used by ABI classification, allocation, encoding, frame/unwind, veneers, and verification.

**Dependencies:** Task 4.

**Files:**

- Create: `src/target/aarch64/backend/api/physical-register-model.ts`
- Extend: `src/target/aarch64/backend/api/backend-catalog-interfaces.ts` only if the Task 4 interface contract is missing a required query
- Create: `tests/unit/target/aarch64/backend/physical-register-model.test.ts`

**Acceptance Criteria:**

- Models GPR x0-x30, SP, ZR, W views, SIMD/FP v0-v31 with b/h/s/d/q lane views, NZCV, FPCR, FPSR, vector-state resources, alias sets, encoding numbers, register classes, and profile constraints.
- Implements the `AArch64PhysicalRegisterModel` interface declared by Task 4 without adding register-model code to `backend-target-surface.ts`.
- Marks x18 reserved and unallocatable for `wrela-uefi-aarch64-rpi5-v1`.
- Distinguishes SP and ZR despite encoding number 31 and exposes operand permission queries through encoding catalog data.
- Provides caller-saved, callee-saved, fixed, temporary, platform, veneer scratch, unavailable, public ABI parameter/result, and private ABI candidate masks.
- Tests cover aliasing x/w, SIMD low-lane preservation, x18 unavailable, IP0/IP1 veneer clobber masks, SP permitted only in SP operand slots, ZR permitted only in ZR operand slots, and deterministic register ordering.

**Execution Steps:**

- [ ] Write `physical-register-model.test.ts` for x/w aliases, SIMD lane aliases, x18 unavailability, IP0/IP1 veneer masks, SP/ZR operand permissions, public ABI masks, private convention candidates, and deterministic ordering; expected first failure is missing `authenticatedBackendTargetSurfaceForTest().registerModel`.
- [ ] Implement concrete register records in `physical-register-model.ts` for x0-x30, w views, SP, ZR, v0-v31 lane views, NZCV, FPCR, FPSR, vector-state resources, alias sets, and encoding numbers.
- [ ] Implement query methods declared in `AArch64PhysicalRegisterModel`: `encodingNumberOf`, `aliasSetOf`, `canAllocate`, and `permitsOperand`.
- [ ] Enforce profile-specific policies: x18 reserved, SP/ZR unallocatable, SP only in SP operand slots, ZR only in ZR operand slots, IP0/IP1 veneer scratch clobbers, and v8-v15 low-lane public preservation.
- [ ] Wire the concrete model into `authenticateAArch64BackendTargetSurface` through catalog input, not by extending `backend-target-surface.ts` with concrete register logic.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/physical-register-model.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit physical register model source and tests.

**Code Examples:**

```ts
test("SP and ZR share encoding number but are not storage aliases", () => {
  const model = authenticatedBackendTargetSurfaceForTest().registerModel;

  expect(model.encodingNumberOf("sp")).toBe(31);
  expect(model.encodingNumberOf("xzr")).toBe(31);
  expect(model.canAllocate("sp")).toBe(false);
  expect(model.canAllocate("xzr")).toBe(false);
  expect(model.aliasSetOf("sp")).not.toBe(model.aliasSetOf("xzr"));
});
```

```ts
test("rpi5 model reserves x18 for all allocator and private convention queries", () => {
  const model = authenticatedBackendTargetSurfaceForTest().registerModel;

  expect(model.canAllocate("x18")).toBe(false);
  expect(model.privateConventionCandidateGprs).not.toContain("x18");
  expect(model.publicCallerSavedGprs).not.toContain("x18");
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/physical-register-model.test.ts
```

## Task 14: Public ABI Classification

**Description:** Implement public AAPCS64/UEFI ABI classification for backend machine ABI intent records and verified target catalog data.

**Dependencies:** Tasks 5, 5A, 13.

**Files:**

- Create: `src/target/aarch64/backend/abi/abi-classification.ts`
- Create: `tests/unit/target/aarch64/backend/abi-classification.test.ts`

**Acceptance Criteria:**

- Covers integer, pointer, bool, enum, capability-like scalar, FP scalar, SIMD scalar/vector, aggregates by size/alignment/field composition, HFA/HVA when permitted, indirect result pointers, x8 handling, stack arguments, stack alignment, over-aligned arguments, padding, multi-register returns, tuple ties, image entry, firmware call, exported function, address-taken function, replacement boundary, and variadic unsupported diagnostic.
- Uses only machine ABI intent and backend target catalogs, never source/HIR/OptIR internals.
- Public calls conservatively clobber AAPCS64 caller-saved sets plus target-surface clobbers.
- Tests cover scalar register assignment, stack overflow after x0-x7, vector v0-v7 assignment, HFA, large aggregate indirect x8, over-aligned stack argument, multi-register return tied group, firmware-call edge, x18 rejection, and variadic diagnostic.

**Execution Steps:**

- [ ] Write scalar, stack-overflow, HFA, indirect-result, over-aligned stack, multi-register return, firmware-call, x18, and variadic tests in `abi-classification.test.ts`; expected first failure is missing `classifyAArch64PublicAbiBoundary`.
- [ ] Define `AArch64PublicAbiClassification`, `AArch64AbiClassifiedValue`, `AArch64AbiLocationAssignment`, `AArch64AbiRegisterCursor`, and `AArch64AbiStackCursor` in `abi-classification.ts`.
- [ ] Implement Stage A normalization: reject variadic input, normalize each machine ABI value to scalar/vector/aggregate/indirect-candidate records, compute size/alignment from machine ABI intent, and detect HFA/HVA only from field composition and target vector-state policy.
- [ ] Implement Stage B pre-padding: choose indirect result pointer in x8 for non-register returns, initialize NGRN/NSRN/NSAA cursors, round over-aligned stack cursor to the requested alignment, and record tied multi-result groups before assignment.
- [ ] Implement Stage C assignment: allocate integer-like values to x0-x7, FP/SIMD values to v0-v7 when permitted, HFA/HVA elements to consecutive vector registers when available, otherwise stack-pass with 8-byte slot rounding and final 16-byte outgoing stack alignment.
- [ ] Add firmware-call and exported/address-taken boundary modes that force public clobbers from the authenticated register model and forbid x18 as parameter, result, scratch, or temporary.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/abi-classification.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS.
- [ ] Commit `abi-classification.ts` and `abi-classification.test.ts`.

**Code Examples:**

```ts
test("large aggregate public return uses indirect result pointer in x8", () => {
  const result = classifyAArch64PublicAbiBoundary(
    publicAbiBoundaryForTest({
      returns: [aggregateMachineAbiValueForTest({ sizeBytes: 32, alignmentBytes: 8 })],
    }),
    authenticatedBackendTargetSurfaceForTest(),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected public ABI classification");
  expect(result.classification.indirectResult).toEqual({ kind: "gpr", register: "x8" });
  expect(result.classification.returnLocations).toEqual([]);
});
```

```ts
test("ninth public integer argument is stack passed with 16-byte aligned call frame", () => {
  const result = classifyAArch64PublicAbiBoundary(
    publicAbiBoundaryForTest({
      parameters: Array.from({ length: 9 }, (_, index) =>
        scalarMachineAbiValueForTest({ key: `arg${index}`, width: 64 }),
      ),
    }),
    authenticatedBackendTargetSurfaceForTest(),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected public ABI classification");
  expect(result.classification.parameterLocations.at(8)).toEqual({
    valueKey: "arg8",
    location: { kind: "stackArg", ordinal: 0, offsetBytes: 0, size: 8, alignment: 8 },
  });
  expect(result.classification.outgoingStackAlignmentBytes).toBe(16);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/abi-classification.test.ts
```

## Task 15: Private ABI Reconciliation and Call Boundary Records

**Description:** Reconcile public ABI classification with finalized closed-image private convention records and emit call-boundary summaries consumed by the allocator, frame builder, scheduler, and verifier.

**Dependencies:** Tasks 5, 13, 14.

**Files:**

- Create: `src/target/aarch64/backend/abi/private-convention-plan.ts`
- Create: `src/target/aarch64/backend/abi/call-boundary-reconciliation.ts`
- Create: `tests/unit/target/aarch64/backend/private-abi-reconciliation.test.ts`

**Acceptance Criteria:**

- Public, firmware, platform, exported, address-taken, replacement, and uncertain boundaries use public ABI.
- Finalized compiler-owned closed-image calls may use private convention locations, custom clobbers, pinned capability/base registers, multi-result direct returns, and tail-call forms only when the closed-image plan authorizes the exact caller/callee pair.
- Each call site receives argument/result assignments, fixed register uses/defs, caller-saved clobbers, callee-save obligations when known, tail-call eligibility, IP0/IP1 veneer scratch policy, memory/effect barriers, and security/zeroization crossing obligations.
- Verifier rejects private convention outside plan, caller/callee mismatch, public ABI violation, and stale call-clobber summary.
- Tests cover eligible private call, missing private convention, exported fallback public, address-taken fallback public, replacement fallback public, IP0/IP1 predeclared veneer clobber, and multi-result private return.

**Execution Steps:**

- [ ] Write `private-abi-reconciliation.test.ts` for eligible private call, missing convention fallback, exported fallback, address-taken fallback, replacement fallback, IP0/IP1 veneer clobber, multi-result private return, and caller/callee mismatch; expected first failure is missing `reconcileAArch64CallBoundaries`.
- [ ] Define private convention plan records, call boundary records, boundary kinds, call-site summaries, clobber summaries, and tail-call eligibility records.
- [ ] Build public boundary records by invoking Task 14 classifications for every public, firmware, exported, address-taken, replacement, and uncertain call site.
- [ ] Overlay private convention records only when the closed-image plan authorizes the exact caller/callee pair and neither endpoint is exported, replacement, address-taken, firmware, or uncertain.
- [ ] Emit for every call site: argument/result locations, fixed uses/defs, caller-saved clobbers, known callee-save obligations, tail-call eligibility, veneer scratch policy, memory/effect barriers, and security crossing obligations.
- [ ] Verify caller/callee agreement and stale clobber summaries before returning reconciled boundaries.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/private-abi-reconciliation.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit ABI reconciliation source and tests.

**Code Examples:**

```ts
test("closed-image eligible helper receives private clobber summary", () => {
  const result = reconcileAArch64CallBoundaries(
    callBoundaryInputForTest({
      plan: closedImageBackendPlanForTest({
        privateConventions: [
          privateConventionForTest({
            caller: "main",
            callee: "helper",
            clobberedGprs: ["x9", "x10"],
            pinnedGprs: ["x19"],
          }),
        ],
      }),
      callSites: [directCallSiteForTest({ caller: "main", callee: "helper" })],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected private ABI reconciliation");
  expect(result.boundaries[0].boundaryKind).toBe("private");
  expect(result.boundaries[0].clobberedGprs).toEqual(["x9", "x10"]);
  expect(result.boundaries[0].pinnedLiveThroughGprs).toEqual(["x19"]);
});
```

```ts
test("layout cannot introduce veneer scratch registers unless call boundary declared them", () => {
  const boundary = callBoundaryForTest({ potentialVeneerClobberGprs: [] });
  const diagnostic = verifyVeneerScratchPolicy({
    boundary,
    requestedVeneer: veneerRequestForTest({ scratchGprs: ["x16"] }),
  });

  expect(diagnostic?.stableDetail).toBe(
    "call-boundary:undeclared-veneer-scratch:call:main:helper:x16",
  );
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/private-abi-reconciliation.test.ts
```

## Task 16: Liveness and Interference

**Description:** Build virtual live intervals and alias-set interference from machine blocks, dependencies, call boundaries, semantic death facts, terminal edges, fixed operands, and security policy boundaries.

**Dependencies:** Tasks 10, 13, 15.

**Files:**

- Create: `src/target/aarch64/backend/allocation/liveness.ts`
- Create: `src/target/aarch64/backend/allocation/interference.ts`
- Create: `tests/unit/target/aarch64/backend/liveness-interference.test.ts`

**Acceptance Criteria:**

- Computes deterministic live intervals per virtual register with segments keyed by function, block, instruction position, and live-through call/edge markers.
- Splits candidate cut points include block boundaries, call boundaries, fixed operand boundaries, loop headers/latches, ownership death points, terminal edges, rematerialization points, and security policy boundaries.
- Interference uses physical register alias sets from the canonical register model.
- Fixed operands, tied operands, call clobbers, NZCV, FPCR/FPSR, vector state, memory barrier, and platform resources are represented as constraints.
- Tests cover straight-line liveness, branch join, terminal edge shortening, ownership death shortening, call clobber split point, tied operand interference, x/w alias interference, SIMD lane alias interference, NZCV def/use chain, and deterministic interval ordering.

**Execution Steps:**

- [ ] Write `liveness-interference.test.ts` for straight-line liveness, branch join, terminal shortening, ownership death, call-clobber split point, tied operand interference, x/w alias, SIMD lane alias, NZCV chain, and deterministic ordering; expected first failure is missing `buildAArch64LiveIntervals`.
- [ ] Define live position, live segment, live interval, cut point, fixed resource constraint, and interference graph types in `liveness.ts` and `interference.ts`.
- [ ] Import dependencies from existing machine dependency/resource summaries and call-boundary records; do not rescan OptIR or source-level facts.
- [ ] Compute block-local use/def sets, solve backward dataflow to fixed point over stable block order, then build live segments per virtual register with deterministic positions.
- [ ] Insert split candidate cut points at block boundaries, call boundaries, fixed operands, loop headers/latches, ownership death points, terminal edges, rematerialization points, and security policy boundaries.
- [ ] Build interference using register model alias sets for physical constraints and virtual interval overlap for virtual/virtual conflicts.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/liveness-interference.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit liveness/interference source and tests.

**Code Examples:**

```ts
test("ownership death fact shortens live interval before terminal edge", () => {
  const intervals = buildAArch64LiveIntervals(
    livenessInputForTest({
      instructions: [
        defineVregInstructionForTest({ instructionId: 1, vreg: 7 }),
        useVregInstructionForTest({ instructionId: 2, vreg: 7 }),
        terminalConsumeInstructionForTest({ instructionId: 3, vreg: 7 }),
        returnInstructionForTest({ instructionId: 4 }),
      ],
      facts: [ownershipDeathFactForTest({ vreg: 7, instructionId: 3 })],
    }),
  );

  expect(intervals.byVreg(vreg(7))?.segments).toEqual([
    liveSegment({ start: position(1), end: position(3), reason: "ownership-death" }),
  ]);
});
```

```ts
test("x0 and w0 alias and cannot hold simultaneous live incompatible values", () => {
  const model = authenticatedBackendTargetSurfaceForTest().registerModel;
  const graph = buildAArch64InterferenceGraph(
    interferenceInputForTest({
      liveIntervals: [
        liveIntervalForTest({ vreg: 1, registerClass: "gpr64", assignedCandidate: "x0" }),
        liveIntervalForTest({ vreg: 2, registerClass: "gpr32", assignedCandidate: "w0" }),
      ],
      model,
    }),
  );

  expect(graph.interferes(vreg(1), vreg(2))).toBe(true);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/liveness-interference.test.ts
```

## Task 17: Deterministic Allocator Worklist

**Description:** Implement deterministic global live-range allocation with bounded splitting, coalescing decisions, priority ordering, spill/remat delegation, and hard-failure diagnostics.

**Dependencies:** Task 16.

**Files:**

- Create: `src/target/aarch64/backend/allocation/allocation-result.ts`
- Create: `src/target/aarch64/backend/allocation/allocator.ts`
- Create: `tests/unit/target/aarch64/backend/allocator.test.ts`

**Acceptance Criteria:**

- Allocates by register class using deterministic priority, spill cost, pressure, loop depth, call-boundary clobbers, use density, remat cost, security labels, and tuning weights.
- Applies the design's legal action order: assign register, split at unused cut point, rematerialize, spill, or fail.
- Maintains termination progress tuple and exposes it in debug artifacts.
- Does not promote frozen intervals in the same allocation episode.
- Emits diagnostics naming register class, live range, blockers, fixed constraints, call boundary, no-spill fact, or unencodable reload when allocation fails.
- Tests cover simple allocation, pressure split, copy coalescing permitted, copy coalescing blocked by security label, call-clobber split, no-spill hard error, deterministic tie-breakers, and bounded progress.

**Execution Steps:**

- [ ] Write allocator tests for simple assignment, deterministic priority order, pressure split, call-boundary split, coalescing allowed, coalescing blocked, no-spill failure, and termination progress; expected first failure is missing `allocateAArch64Registers`.
- [ ] Define immutable allocation records in `allocation-result.ts`: `AArch64AllocationResult`, `AArch64AllocationSegment`, `AArch64AllocationRepairRequest`, `AArch64AllocationBlocker`, and `AArch64AllocationProgressTuple`.
- [ ] Build the initial worklist sorted by `(mustAllocateBeforeUse, loopDepth desc, spillCost desc, useDensity desc, liveRangeStableKey, vregStableKey)` so equal inputs produce identical allocation choices.
- [ ] For each work item, compute candidate physical registers by register class, alias-set availability, fixed operands, call clobbers, reserved registers, private convention pins, security labels, and target tuning weights.
- [ ] Apply legal actions in this exact order: assign an available register; coalesce only when alias/security/call constraints stay valid; split at the earliest unused legal cut point; delegate rematerialization when authority cost is lower than spill cost; request spill repair; otherwise fail with blockers.
- [ ] Maintain termination progress as `(unprocessedIntervals, unsplitIntervals, remainingCutPoints, unresolvedRepairRequests, frozenEpisodeCount)` and assert the tuple decreases lexicographically on every non-error iteration.
- [ ] Freeze intervals created during one allocation episode so they are not promoted again until spill/remat and move-resolution tasks have repaired the program and re-entered allocation through a new verifier run.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/allocator.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS.
- [ ] Commit `allocation-result.ts`, `allocator.ts`, and `allocator.test.ts`.

**Code Examples:**

```ts
test("allocator splits at call boundary before spilling when a caller-saved register is clobbered", () => {
  const result = allocateAArch64Registers(
    allocationInputForTest({
      intervals: [liveIntervalForTest({ vreg: 5, crossesCall: "call:main:helper" })],
      callBoundaries: [callBoundaryForTest({ callKey: "call:main:helper", clobberedGprs: ["x0"] })],
      availableGprs: ["x0", "x19"],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected allocation success");
  expect(result.allocation.segmentsFor(vreg(5)).map((segment) => segment.reason)).toEqual([
    "pre-call",
    "post-call",
  ]);
});
```

```ts
test("no-spill live range fails with blockers instead of spilling", () => {
  const result = allocateAArch64Registers(
    allocationInputForTest({
      intervals: [liveIntervalForTest({ vreg: 9, registerClass: "gpr64", noSpill: true })],
      availableGprs: [],
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected no-spill allocation error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "allocation:no-spill-unallocatable:vreg:9:class:gpr64:blockers:none-available",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/allocator.test.ts
```

## Task 18: Spill and Rematerialization

**Description:** Insert legal spills, reloads, rematerializations, spill slots, wipe obligations, and emergency materialization sequences through rewrite transactions.

**Dependencies:** Tasks 11, 12, 17.

**Files:**

- Create: `src/target/aarch64/backend/allocation/spill-remat.ts`
- Create: `tests/unit/target/aarch64/backend/spill-remat.test.ts`

**Acceptance Criteria:**

- Chooses rematerialization over spill when a registered remat authority proves legality at the use site.
- Validates symbols, relocations, page-base pairs, literal references, constants, effect boundaries, FPCR/FPSR, vector-state, security, and target instruction forms before remat.
- Creates spill slots with width, alignment, addressability, security metadata, and wipe obligations.
- Rejects secret/key rematerialization into observable storage and no-spill memory placement.
- Inserts spills/reloads/remats only through `AArch64BackendRewriteTransaction`.
- Tests cover cheap constant remat, page-base remat blocked by relocation pair boundary, spill slot creation, wipe-on-spill exit obligation, no-spill rejection, unencodable frame offset diagnostic, and deterministic rewrite provenance.

**Execution Steps:**

- [ ] Write `spill-remat.test.ts` for cheap constant remat, relocation-pair remat block, spill slot creation, wipe-on-spill exit obligation, no-spill rejection, unencodable frame offset, and deterministic provenance; expected first failure is missing `repairAllocationWithSpillsAndRemats`.
- [ ] Define repair request, rematerialization authority, spill slot request, reload draft, spill draft, remat draft, and emergency materialization records in `spill-remat.ts`.
- [ ] For each allocator repair request, choose remat before spill only when a fact-backed remat authority proves the value, required facts, relocation pairing, effect boundaries, security label, and target instruction form are legal at the use site.
- [ ] For spills, allocate spill slot requests with width, alignment, addressability class, security metadata, wipe obligations, and frame catalog reach requirements.
- [ ] Insert every spill, reload, and remat through `AArch64BackendRewriteTransaction`; never mutate machine instructions directly.
- [ ] Emit deterministic diagnostics for no-spill memory placement, secret/key remat into observable storage, and unencodable frame offsets.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/spill-remat.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit spill/remat source and tests.

**Code Examples:**

```ts
test("rematerializes cheap movz constant at use site instead of creating a spill slot", () => {
  const result = repairAllocationWithSpillsAndRemats(
    spillRematInputForTest({
      allocation: allocationNeedingRepairForTest({ vreg: 3, repair: "materialize-at-use" }),
      facts: [rematAuthorityFactForTest({ vreg: 3, opcode: "movz", value: 42n })],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected remat repair");
  expect(result.snapshot.frameSlots.entries()).toEqual([]);
  expect(result.snapshot.instructions.entries().map((instruction) => instruction.opcode)).toContain(
    "movz",
  );
});
```

```ts
test("wipe-on-spill slot records every observable exit", () => {
  const result = repairAllocationWithSpillsAndRemats(
    spillRematInputForTest({
      allocation: allocationNeedingRepairForTest({ vreg: 6, repair: "spill" }),
      facts: [wipeOnSpillFactForTest({ vreg: 6 })],
      exits: [exitForTest("return:main"), exitForTest("tail:main:panic")],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected spill repair");
  expect(result.snapshot.security.wipeObligations.map((obligation) => obligation.exitKey)).toEqual([
    "return:main",
    "tail:main:panic",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/spill-remat.test.ts
```

## Task 19: Move Resolution and Parallel Copies

**Description:** Resolve physical moves, ABI moves, copy coalescing leftovers, parallel copy webs, tied operands, and temporary register needs using the register model and rewrite transaction.

**Dependencies:** Tasks 11, 13, 17.

**Files:**

- Create: `src/target/aarch64/backend/allocation/move-resolution.ts`
- Create: `tests/unit/target/aarch64/backend/move-resolution.test.ts`

**Acceptance Criteria:**

- Resolves acyclic and cyclic parallel copies deterministically.
- Uses legal temporary registers from the register model and call/veneer scratch constraints.
- Handles tied def/use operands and ABI boundary moves.
- Rejects move webs when no legal temporary or stack swap path exists under security policy.
- Emits physical move drafts and fact transfer plans through rewrite transactions.
- Tests cover acyclic copy, two-register swap, three-register cycle, ABI incoming moves, ABI result moves, tied operand repair, IP0/IP1 unavailable near veneer site, and no-spill value not routed through memory.

**Execution Steps:**

- [ ] Write tests for acyclic copy ordering, two-register cycle, three-register cycle, ABI incoming/result copies, tied operand repair, unavailable IP0/IP1, and no-spill memory-swap rejection; expected first failure is missing `resolveAArch64ParallelCopies`.
- [ ] Define `AArch64ParallelCopy`, `AArch64MoveResolutionInput`, `AArch64ResolvedMove`, and `AArch64MoveResolutionTemporaryPolicy` in `move-resolution.ts`.
- [ ] Partition copies by copy web. Within each web, drop identity copies, reject duplicate destinations with different value keys, and sort remaining edges by `(blockStableKey, insertionPoint, destinationStableKey, sourceStableKey, valueStableKey)`.
- [ ] Emit all acyclic moves by repeatedly selecting destinations that are not also live sources in the remaining graph.
- [ ] For each remaining cycle, select the first legal temporary from the register model after removing unavailable veneer scratch, fixed operands, live-through call clobbers, and registers holding no-spill values.
- [ ] Break the cycle with `cycleSource -> temporary`, rotate the remaining cycle moves, then restore `temporary -> finalDestination`. If no register temporary exists, use a stack swap only when all copied values permit memory placement and security policy allows the slot.
- [ ] Emit every resolved move through `AArch64BackendRewriteTransaction` with explicit `move` fact-transfer behavior for value facts and security-label transfer for secret/no-spill facts.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/move-resolution.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS.
- [ ] Commit `move-resolution.ts` and `move-resolution.test.ts`.

**Code Examples:**

```ts
test("resolves two-register cycle with a legal non-veneer temporary", () => {
  const result = resolveAArch64ParallelCopies(
    moveResolutionInputForTest({
      copies: [
        copyForTest({ from: "x0", to: "x1", value: "a" }),
        copyForTest({ from: "x1", to: "x0", value: "b" }),
      ],
      unavailableTemporaries: ["x16", "x17"],
      availableTemporaries: ["x9"],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected move resolution");
  expect(result.moves.map((move) => `${move.from}->${move.to}`)).toEqual([
    "x0->x9",
    "x1->x0",
    "x9->x1",
  ]);
});
```

```ts
test("no-spill cycle fails when only memory swap is possible", () => {
  const result = resolveAArch64ParallelCopies(
    moveResolutionInputForTest({
      copies: twoRegisterCycleForTest({ includesNoSpillValue: true }),
      availableTemporaries: [],
      memorySwapAllowed: true,
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected no-spill cycle error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "move-resolution:no-spill-memory-swap-rejected:value:a",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/move-resolution.test.ts
```

## Task 20: Allocation Verifier

**Description:** Verify final allocation, liveness, aliasing, ABI, call clobber, security, spill/remat, and move-resolution invariants after allocator repair reaches a fixed point.

**Dependencies:** Tasks 12, 13, 16, 17, 18, 19.

**Files:**

- Create: `src/target/aarch64/backend/verify/allocation-verifier.ts`
- Create: `tests/unit/target/aarch64/backend/allocation-verifier.test.ts`

**Acceptance Criteria:**

- Verifies every virtual register has exactly one legal physical location over each live segment or a verified spill/remat obligation at each use.
- Verifies no simultaneously live values occupy aliasing physical registers.
- Verifies fixed operands, tied operands, calls, returns, SP, FP, LR, IP0/IP1, x18, NZCV, FPCR/FPSR, and vector-state constraints.
- Verifies public ABI and private convention call boundaries, caller/callee agreement, call clobber adherence, no-spill, wipe-on-spill, and rematerialization legality.
- Invokes security label-conservation verifier rather than duplicating security checks.
- Tests cover legal allocation, duplicate assignment, alias interference, fixed operand mismatch, x18 assignment, call clobber violation, private ABI mismatch, no-spill spill, missing wipe obligation, and stale verifier summary.

**Execution Steps:**

- [ ] Write `allocation-verifier.test.ts` for legal allocation, missing segment assignment, duplicate assignment, alias interference, fixed operand mismatch, x18 assignment, call clobber violation, private ABI mismatch, no-spill spill, missing wipe, and stale summary; expected first failure is missing `verifyAArch64Allocation`.
- [ ] Define allocation verifier input, result, checked segment summary, and verifier run records in `allocation-verifier.ts`.
- [ ] Verify that each virtual register use is covered by exactly one legal physical location, spill location, or rematerialization obligation over the relevant live segment.
- [ ] Verify alias safety, fixed operands, tied operands, calls, returns, SP/FP/LR/IP0/IP1/x18, NZCV, FPCR/FPSR, vector-state, and private/public ABI call-boundary constraints.
- [ ] Invoke `verifyAArch64SecurityLabelConservation` for no-spill and wipe obligations, then merge diagnostics without duplicating security rules.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/allocation-verifier.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit allocation verifier source and tests.

**Code Examples:**

```ts
test("allocation verifier rejects x18 assignment in rpi5 backend model", () => {
  const result = verifyAArch64Allocation(
    allocationVerifierInputForTest({
      allocation: allocationResultForTest({
        assignments: [assignmentForTest({ vreg: 4, physical: "x18" })],
      }),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected x18 verifier failure");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "allocation-verifier:reserved-register-assigned:vreg:4:x18",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/allocation-verifier.test.ts
```

## Task 21: Stack Frame Layout

**Description:** Layout callee-save areas, spill slots, outgoing arguments, local frame objects, security wipe slots, frame records, stack adjustments, and concrete offsets with 16-byte alignment.

**Dependencies:** Tasks 12, 13, 18, 20.

**Files:**

- Create: `src/target/aarch64/backend/frame/frame-layout.ts`
- Create: `src/target/aarch64/backend/verify/frame-verifier.ts`
- Create: `tests/unit/target/aarch64/backend/frame-layout.test.ts`

**Acceptance Criteria:**

- Maintains 16-byte SP alignment at entry, exits, and public call boundaries.
- Chooses SP-relative or FP-relative addressing based on reach, frame catalog, and unwind templates.
- Places callee-save GPR saves, SIMD/FP low-lane saves, spills, remat scratch slots, outgoing arg space, local frame objects, security wipe slots, stack protector/frame metadata, and optional frame record.
- Maximizes legal `stp`/`ldp` pairing and hot spill reach while respecting security/effect/alignment constraints.
- Slot coloring shares spill/outgoing slots only when verified lifetime and security rules permit.
- Tests cover leaf frame, non-leaf frame, large frame, GPR pair saves, SIMD low-lane saves, outgoing args, wipe slots, anti-coloring for security mismatch, private-generation permitted reuse, unencodable offset diagnostic, and deterministic offsets.

**Execution Steps:**

- [ ] Write `frame-layout.test.ts` for leaf, non-leaf, large frame, GPR pair saves, SIMD low-lane saves, outgoing args, wipe slots, security anti-coloring, private-generation reuse, unencodable offset, and deterministic offsets; expected first failure is missing `layoutAArch64StackFrame`.
- [ ] Define frame layout input, frame slot, save area, outgoing argument area, wipe slot, addressability class, stack adjustment, and frame verifier result records.
- [ ] Collect frame requirements from allocation repair, call boundaries, callee-save obligations, security wipe obligations, local frame objects, outgoing args, and unwind/frame catalogs.
- [ ] Place fixed frame record and callee-save areas first, then security wipe slots, spills/remat scratch slots, locals, and outgoing args, preserving 16-byte SP alignment at entry, every call boundary, and every exit.
- [ ] Apply slot coloring only when lifetime, generation, aliasing, and security labels prove reuse safe; otherwise allocate distinct slots.
- [ ] Choose SP-relative or FP-relative addressing by reach and unwind template compatibility, and emit deterministic diagnostics for unencodable offsets.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/frame-layout.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit frame layout/verifier source and tests.

**Code Examples:**

```ts
test("frame layout keeps SP aligned and places wipe slot before reusable spill slot", () => {
  const result = layoutAArch64StackFrame(
    frameLayoutInputForTest({
      spills: [
        spillSlotRequestForTest({ slotKey: "secret", size: 8, alignment: 8, wipeOnExit: true }),
        spillSlotRequestForTest({ slotKey: "public", size: 8, alignment: 8 }),
      ],
      exits: [exitForTest("return:main")],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected frame layout");
  expect(result.frame.totalSizeBytes % 16).toBe(0);
  expect(result.frame.wipeSlots.map((slot) => slot.slotKey)).toEqual(["secret"]);
});
```

```ts
test("frame verifier rejects overlapping slots with incompatible security labels", () => {
  const result = verifyAArch64FrameLayout(
    frameVerifierInputForTest({
      frame: frameLayoutForTest({
        slots: [
          frameSlotForTest({
            slotKey: "secret",
            offsetBytes: -16,
            size: 8,
            securityLabel: "secret",
          }),
          frameSlotForTest({
            slotKey: "public",
            offsetBytes: -16,
            size: 8,
            securityLabel: "public",
          }),
        ],
      }),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected overlap failure");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "frame-verifier:incompatible-slot-overlap:secret:public",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/frame-layout.test.ts
```

## Task 22: Prologue, Epilogue, Tail, Trap, and Noreturn Finalization

**Description:** Generate prologue and epilogue physical instruction drafts, security wipes, callee-save saves/restores, frame setup/teardown, tail-call forms, traps, and noreturn endings through rewrite transactions.

**Dependencies:** Task 21.

**Files:**

- Create: `src/target/aarch64/backend/frame/prologue-epilogue.ts`
- Create: `tests/unit/target/aarch64/backend/prologue-epilogue.test.ts`

**Acceptance Criteria:**

- Prologue inserts stack adjustment, frame record setup when required, callee-save stores, security initialization/wipe-slot setup, vector-state setup, and unwind markers.
- Epilogue inserts required zeroization, wipe-on-spill clears, live callee-save restores, frame teardown, stack restore, and return/tail/trap/unreachable endings.
- Terminal, noreturn, trap, and tail-call edges do not fabricate ordinary returns.
- Omitted restores require terminal/unwind/security proof.
- Tail calls require ABI compatibility, no pending cleanup, legal outgoing args, SP alignment, frame teardown, IP0/IP1 policy, target branch form, and security survival.
- Tests cover ordinary return, leaf frameless return, non-leaf frame record, callee-save omitted on noreturn, wipe before tail call, tail-call rejected with pending wipe, trap ending, and unreachable body classification.

**Execution Steps:**

- [ ] Write `prologue-epilogue.test.ts` for ordinary return, leaf frameless return, non-leaf frame record, noreturn restore omission, wipe before tail call, tail-call rejected with pending wipe, trap ending, and unreachable body; expected first failure is missing `finalizeAArch64PrologueEpilogue`.
- [ ] Define prologue plan, epilogue plan, terminal exit plan, tail-call decision, trap/noreturn decision, and finalization rewrite records.
- [ ] Generate prologue drafts in deterministic role order: stack adjustment, frame record setup, callee-save stores, security initialization, vector-state setup, unwind markers.
- [ ] For each exit, decide ordinary return, tail-call, ordinary-call-plus-epilogue, trap, noreturn, or unreachable by checking cleanup obligations, ABI compatibility, SP alignment, outgoing args, IP0/IP1 policy, target branch form, and security survival.
- [ ] Emit epilogue drafts in deterministic role order: zeroization, wipe-on-spill clears, callee-save restores, frame teardown, stack restore, terminal instruction.
- [ ] Route all inserted instructions through rewrite transactions with provenance and fact-transfer plans.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/prologue-epilogue.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit prologue/epilogue source and tests.

**Code Examples:**

```ts
test("tail call with pending wipe becomes ordinary call plus epilogue", () => {
  const result = finalizeAArch64PrologueEpilogue(
    prologueEpilogueInputForTest({
      frame: frameWithWipeSlotForTest("secret-slot"),
      exits: [tailCallExitForTest({ callKey: "tail:main:helper" })],
      tailCallEligibility: tailCallEligibilityForTest({ cleanupPending: true }),
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected finalization");
  expect(result.exitPlans[0].ending).toBe("ordinary-call-plus-epilogue");
  expect(result.exitPlans[0].instructions.map((instruction) => instruction.role)).toContain(
    "wipe-slot",
  );
});
```

```ts
test("noreturn exit does not restore dead callee saves when policy permits omission", () => {
  const result = finalizeAArch64PrologueEpilogue(
    prologueEpilogueInputForTest({
      frame: frameWithCalleeSaveForTest("x19"),
      exits: [noreturnExitForTest({ callKey: "panic" })],
      unwindPolicy: unwindPolicyForTest({ mayOmitDeadRestoreOnNoreturn: true }),
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected noreturn finalization");
  expect(result.exitPlans[0].instructions.map((instruction) => instruction.role)).not.toContain(
    "restore:x19",
  );
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/prologue-epilogue.test.ts
```

## Task 23: Unwind Planning

**Description:** Produce internal unwind records from frame layout and prologue/epilogue plans using authenticated unwind and frame catalogs.

**Dependencies:** Tasks 4, 21, 22.

**Files:**

- Create: `src/target/aarch64/backend/frame/unwind-plan.ts`
- Extend: `src/target/aarch64/backend/verify/frame-verifier.ts`
- Create: `tests/unit/target/aarch64/backend/unwind-plan.test.ts`

**Acceptance Criteria:**

- Emits only `frameless-leaf`, `serializable-unwind`, or `unreachable-body` classifications.
- Records frame size, adjustment sequence, saved register locations, frame pointer setup, epilogue regions, tail/noreturn treatment, vector low-lane saves/restores, security wipe records for diagnostics, and PE/COFF ARM64 unwind mapping.
- Rejects frames not representable by authenticated unwind catalog before object bytes exist.
- Verifies unwind records match generated prologue/epilogue plans.
- Tests cover frameless leaf, serializable non-leaf, large frame template, vector low-lane save, noreturn unreachable body, tail-call epilogue region, and unrepresentable frame diagnostic.

**Execution Steps:**

- [ ] Write `unwind-plan.test.ts` for frameless leaf, serializable non-leaf, large frame template, vector low-lane save, noreturn unreachable body, tail-call epilogue region, and unrepresentable frame; expected first failure is missing `planAArch64Unwind`.
- [ ] Define unwind classifications, unwind record, prologue/epilogue region records, saved-register location records, and PE/COFF unwind mapping records.
- [ ] Classify functions as `frameless-leaf`, `serializable-unwind`, or `unreachable-body` from frame layout and terminal exit plans.
- [ ] Match frame/prologue/epilogue shape against authenticated unwind catalog templates before object bytes exist; reject unrepresentable shapes immediately.
- [ ] Verify saved GPR/SIMD low-lane locations, frame pointer setup, epilogue regions, tail/noreturn handling, and security wipe diagnostics against generated finalization plans.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/unwind-plan.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit unwind planning/frame verifier changes and tests.

**Code Examples:**

```ts
test("non-leaf callee-save frame must use serializable unwind template", () => {
  const result = planAArch64Unwind(
    unwindInputForTest({
      frame: frameLayoutForTest({ totalSizeBytes: 48, savedGprs: ["x19", "x20", "x29", "x30"] }),
      prologue: prologuePlanForTest({ templateKey: "frame-record-pair-save-small" }),
      epilogues: [epiloguePlanForTest({ templateKey: "frame-record-pair-save-small" })],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected unwind plan");
  expect(result.unwind.classification).toBe("serializable-unwind");
});
```

```ts
test("unwind planning rejects frame shape missing PE COFF mapping", () => {
  const result = planAArch64Unwind(
    unwindInputForTest({
      frame: frameLayoutForTest({ totalSizeBytes: 4096, dynamicAdjustment: true }),
      unwindCatalog: unwindCatalogForTest({ templates: [] }),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected unwind diagnostic");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "unwind:unrepresentable-frame:function:fixture.function:size:4096",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/unwind-plan.test.ts
```

## Task 24: Physical Instruction IR and Pseudo Expansion

**Description:** Convert allocated machine instructions and backend pseudos to physical instruction IR with physical operands, immediate metadata, final frame addressing, branch targets, relocation holes, dependencies, provenance, and security labels.

**Dependencies:** Tasks 11, 21, 22.

**Files:**

- Create: `src/target/aarch64/backend/finalization/physical-instruction-ir.ts`
- Create: `src/target/aarch64/backend/finalization/pseudo-expansion.ts`
- Create: `tests/unit/target/aarch64/backend/physical-instruction-ir.test.ts`

**Acceptance Criteria:**

- Physical instruction IR contains no virtual registers, abstract frame objects, unresolved pseudos, or unowned relocation holes.
- Pseudo expansion covers physical moves, zeroing idioms, parallel-copy artifacts, spills, reloads, remats, concrete frame-object addressing, prologue/epilogue instructions, tail-call/sibling-call/trap/noreturn endings, barriers, ADRP/ADD, ADRP/LDR, literal LDR, MOVZ/MOVK, compare/branch, conditional select, post-allocation pair load/store, and pseudo branches.
- Every mutation uses rewrite transaction with fact/security/provenance transfer.
- Tests cover vreg rejection, frame offset lowering, move lowering, zeroing idiom, spill reload lowering, remat lowering, barrier lowering, relocation hole ownership, trap lowering, and deterministic physical instruction ordering.

**Execution Steps:**

- [ ] Write `physical-instruction-ir.test.ts` for unresolved vreg rejection, frame offset lowering, move lowering, zeroing idiom, spill reload, remat, barrier, relocation-hole ownership, trap lowering, and deterministic ordering; expected first failure is missing `buildAArch64PhysicalInstructionIr`.
- [ ] Define physical instruction, physical operand, immediate metadata, relocation-hole owner, dependency metadata, provenance pointer, and security label records.
- [ ] Build physical IR by replacing every virtual register and abstract frame object with allocation/frame results; reject unresolved values before pseudo expansion.
- [ ] Expand pseudos in deterministic groups: moves, zeroing, spills/reloads/remats, frame addressing, prologue/epilogue, tail/trap/noreturn, barriers, ADRP/pageoff, literal loads, constants, branches, selects, and pair loads/stores.
- [ ] Attach relocation holes, dependency summaries, provenance, and security labels to every physical instruction draft.
- [ ] Route any expansion that changes instruction identity through rewrite transactions.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/physical-instruction-ir.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit physical IR/pseudo expansion source and tests.

**Code Examples:**

```ts
test("physical IR builder rejects unresolved virtual registers", () => {
  const result = buildAArch64PhysicalInstructionIr(
    physicalIrInputForTest({
      instructions: [allocatedInstructionForTest({ operands: [unresolvedVregOperandForTest(3)] })],
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected unresolved vreg error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "physical-ir:unresolved-virtual-register:instruction:0:vreg:3",
  ]);
});
```

```ts
test("frame object reference lowers to encodable SP-relative physical memory operand", () => {
  const result = expandAArch64BackendPseudos(
    pseudoExpansionInputForTest({
      frame: frameLayoutForTest({
        slots: [frameSlotForTest({ frameObjectId: 1, base: "sp", offsetBytes: 32 })],
      }),
      pseudos: [loadFrameObjectPseudoForTest({ frameObjectId: 1, destination: "x0" })],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected pseudo expansion");
  expect(result.instructions[0].operands).toContainEqual(
    memoryOperandForTest({ base: "sp", offsetBytes: 32 }),
  );
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/physical-instruction-ir.test.ts
```

## Task 25: Post-Allocation Scheduler and Peepholes

**Description:** Schedule physical instructions inside legal dependency islands and apply safe peepholes after allocation and pseudo expansion.

**Dependencies:** Tasks 12, 24.

**Files:**

- Create: `src/target/aarch64/backend/finalization/post-ra-scheduler.ts`
- Create: `src/target/aarch64/backend/finalization/peepholes.ts`
- Create: `tests/unit/target/aarch64/backend/post-ra-scheduler.test.ts`

**Acceptance Criteria:**

- Scheduler respects memory dependencies, barriers, volatile/MMIO/firmware/image-device/atomic ordering, call/clobber boundaries, NZCV chains, FPCR/FPSR dependencies, vector-state ownership, security and constant-time regions, and relocation pair adjacency.
- Tuning model may reorder for pair loads/stores, load-latency hiding, short flag chains, hot-path fallthrough, and spill clustering.
- Peepholes changing flags, memory ordering, security labels, or relocation behavior declare transfer plans and verifier invalidation sets.
- Tests cover legal load-latency hide, barrier prevents motion, NZCV chain prevents motion, ADRP/ADD relocation pair adjacency, secret region prevents timing-visible motion, pair load/store formation, peephole transfer plan, and deterministic schedule tie-breaker.

**Execution Steps:**

- [ ] Write `post-ra-scheduler.test.ts` for load-latency hide, barrier prevention, NZCV chain prevention, ADRP/ADD adjacency, secret-region ordering, pair formation, peephole transfer plan, and deterministic tie-breaker; expected first failure is missing `scheduleAArch64PostAllocation`.
- [ ] Define scheduling island, dependency edge, ready queue key, tuning score, peephole candidate, transfer plan, and invalidation-set records.
- [ ] Partition instructions into dependency islands split by calls, barriers, volatile/MMIO/device operations, relocation pairs, secret constant-time regions, and observable exits.
- [ ] Within each island, run deterministic list scheduling with ready queue ordered by dependency satisfaction, tuning score, original stable position, and instruction stable key.
- [ ] Apply peepholes only when they declare fact transfer, verifier invalidation, flag/memory/security effects, and relocation behavior; reject otherwise.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/post-ra-scheduler.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit scheduler/peephole source and tests.

**Code Examples:**

```ts
test("scheduler keeps ADRP and ADD pageoff adjacent when relocation pair requires it", () => {
  const result = scheduleAArch64PostAllocation(
    postRaScheduleInputForTest({
      instructions: [
        physicalInstructionForTest({ id: 1, opcode: "adrp", relocationPairKey: "page:global" }),
        physicalInstructionForTest({
          id: 2,
          opcode: "add-pageoff",
          relocationPairKey: "page:global",
        }),
        physicalInstructionForTest({ id: 3, opcode: "add-shifted-register" }),
      ],
      tuningModel: tuningModelForTest({ preferLatencyHiding: true }),
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected schedule");
  expect(result.instructions.map((instruction) => instruction.id)).toEqual([1, 2, 3]);
});
```

```ts
test("peephole that removes redundant move records fact transfer", () => {
  const result = applyAArch64PostRaPeepholes(
    peepholeInputForTest({
      instructions: [moveInstructionForTest({ from: "x0", to: "x0", valueKey: "packet-base" })],
      facts: [ownershipLifetimeFactForTest({ subject: "packet-base" })],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected peephole success");
  expect(result.rewriteCommits[0].factTransfers.map((transfer) => transfer.behavior)).toEqual([
    "move",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/post-ra-scheduler.test.ts
```

## Task 26A: Production Backend Catalog Data

**Description:** Author deterministic production catalog data for the authenticated RPi5/Cortex-A76 AArch64 backend profile. This task owns data content; Task 26 owns encoding-catalog authentication over that data.

**Dependencies:** Tasks 4, 13, 23, 24.

**Files:**

- Create: `src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data.ts`
- Create: `src/target/aarch64/backend/catalogs/known-byte-fixtures.ts`
- Create: `tests/unit/target/aarch64/backend/backend-catalog-data.test.ts`

**Acceptance Criteria:**

- Exports checked data tables for register model, relocation mapping, unwind templates, frame rules, veneer policy, literal-pool policy, security policy, tuning weights, and encoding families emitted by existing lowering/finalization.
- Encoding data enumerates every emitted family: move-wide, arithmetic/logical immediate, arithmetic/logical register, compare/select, branch/control, load/store unsigned immediate, load/store register offset, pair load/store, endian, ADRP/ADD pageoff, literal LDR, barriers, LSE atomics, prefetch, SIMD/FP, CRC, PMULL, AES/SHA, FMADD, and DotProd.
- Relocation data contains the PE/COFF-facing mappings from the design: `branch26`, `branch19`, `branch14`, `pagebase-rel21`, `pageoffset-12a`, `pageoffset-12l`, `addr64`, `addr32`, `addr32nb`, `rel32`, and `section-relative`.
- Known-byte fixtures include at least one checked row per encoding family and the exact fixtures consumed by Tasks 27 and 28.
- Security data states the constant-time subset and forbidden data-dependent-latency operations for secret operands; missing rows are a hard catalog-authentication failure, not a conservative runtime guess.
- Tests verify every opcode emitted by `physical-instruction-ir.ts` and `pseudo-expansion.ts` appears in the catalog inventory or has an explicit unsupported diagnostic.

**Closed Opcode Inventory:**

Task 26A must author catalog entries for the exact emitted opcode inventory below, derived from `src/target/aarch64/machine-ir/opcode-catalog.ts`. Task 26 authentication fails if the implemented catalog has extra opcodes without a profile feature gate or is missing any opcode in this list that remains emitted by Task 24.

```text
move-wide and moves:
  movz, movk, movn, movi, mov-vector
integer arithmetic and logical:
  add-immediate, frame-address, add-shifted-register, sub-shifted-register, sub-immediate,
  and-logical-immediate, and-shifted-register, orr-logical-immediate, orr-shifted-register,
  eor-logical-immediate, eor-shifted-register, mul, udiv, sdiv, lsl, lsl-immediate, lsr
compare, select, and flag users:
  cmp-shifted-register, cset, csel, ccmp
branches, calls, returns, and traps:
  cbz, cbnz, tbz, bl, blr, b, b-cond, ret, br, trap
memory, address, and pairs:
  ldr-unsigned-immediate, ldr-register-offset, str-unsigned-immediate,
  ldp-signed-offset, stp-signed-offset, adrp, add-pageoff
endian, barriers, atomics, and prefetch:
  rev, rev16, rev32, dmb, dsb, ldar, stlr, ldadd, ldadda, ldaddl, ldaddal, prfm
SIMD, FP, crypto, and numeric:
  ld1, st1, tbl, tbx, cmeq, bsl, crc32, pmull, aes-sha-round,
  fmadd, fmla, fcvt-fp16, sqrdmulh, sqrdmlah, sqadd-saturating, dotprod
```

Each opcode row must declare `stableKey`, `family`, `requiredFeatures`, operand field mapping, SP/ZR permissions, immediate constraints, relocation-hole owner if applicable, security/timing class, known-byte fixture IDs, and verifier requirements.

**Execution Steps:**

- [ ] Write `backend-catalog-data.test.ts` that imports the inventory and checks for required family keys, required relocation mappings, known-byte fixture coverage, x18 reservation, and deterministic fingerprints; expected first failure is missing catalog-data module.
- [ ] Add `known-byte-fixtures.ts` with fixture IDs, assembly-like comments for readability, expected bytes, and the catalog opcode family each fixture covers.
- [ ] Add `rpi5-backend-catalog-data.ts` with readonly arrays sorted by stable key and no generated host metadata.
- [ ] Add an inventory assertion that compares physical opcode keys from Task 24 and `AARCH64_OPCODE_FORMS` against the Closed Opcode Inventory above.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/backend-catalog-data.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS.
- [ ] Commit only catalog data and catalog-data tests.

**Code Examples:**

```ts
export const RPI5_BACKEND_RELOCATION_MAPPINGS = [
  {
    stableKey: "branch26",
    typicalSite: "b/bl",
    peCoffMapping: "IMAGE_REL_ARM64_BRANCH26",
    addendPolicy: "encoded-branch-immediate",
    veneerPolicy: "backend-or-linker-veneer",
  },
  {
    stableKey: "pagebase-rel21",
    typicalSite: "adrp",
    peCoffMapping: "IMAGE_REL_ARM64_PAGEBASE_REL21",
    addendPolicy: "paired-with-low12",
    veneerPolicy: "not-veneer-eligible",
  },
  {
    stableKey: "pageoffset-12l",
    typicalSite: "ldr/str low-12",
    peCoffMapping: "IMAGE_REL_ARM64_PAGEOFFSET_12L",
    addendPolicy: "scale-checked-against-access-width",
    veneerPolicy: "not-veneer-eligible",
  },
] as const;
```

```ts
export const RPI5_KNOWN_BYTE_FIXTURES = [
  {
    fixtureId: "movz-x0-0x1234",
    opcode: "movz",
    operands: ["x0", "#0x1234"],
    bytes: [0x80, 0x46, 0x82, 0xd2],
  },
  {
    fixtureId: "ldr-x1-x2-16",
    opcode: "ldr-unsigned-immediate",
    operands: ["x1", "[x2,#16]"],
    bytes: [0x41, 0x08, 0x40, 0xf9],
  },
] as const;
```

```bash
bun test ./tests/unit/target/aarch64/backend/backend-catalog-data.test.ts
```

## Task 26: Encoding Catalog Authentication

**Description:** Build the backend encoding catalog schema and authentication checks for fixed bitfields, operand fields, feature gates, immediate ranges, SP/ZR permissions, relocation holes, verifier requirements, and known-byte fixture IDs. This task validates catalog data from Task 26A; it does not invent missing opcode rows.

**Dependencies:** Tasks 4, 26A.

**Files:**

- Create: `src/target/aarch64/backend/object/encoding-catalog.ts`
- Create: `tests/unit/target/aarch64/backend/encoding-catalog.test.ts`

**Acceptance Criteria:**

- Catalog covers every opcode family emitted by existing AArch64 lowering and backend finalization: move-wide, arithmetic/logical, compare/select, branch/control, load/store, pair load/store, endian, ADRP/ADD pageoff, calls, barriers, atomics, prefetch, SIMD/FP, CRC, PMULL, AES/SHA, FMADD, DotProd.
- Catalog records fixed bitfields, operand bitfields, register class rules, SP/ZR permissions, immediate ranges/scales/rotations/shifts/extensions/masks, condition-code encodings, memory addressing forms, relocation-hole ownership, feature gates, verifier requirements, and known-byte fixture IDs.
- Authentication rejects duplicate opcode encodings, missing fixture IDs, unsupported required features, SP/ZR ambiguity, relocation hole without owner, and inconsistent immediate constraints.
- Authentication rejects any emitted physical opcode not present in Task 26A's inventory and any Task 26A row with no corresponding known-byte fixture when the family requires one.
- Tests cover successful catalog auth, duplicate encoding key, missing known-byte fixture, illegal SP permission, illegal ZR permission, missing feature gate, and deterministic fingerprint.

**Execution Steps:**

- [ ] Write authentication tests for duplicate opcode, missing fixture, unsupported feature, SP/ZR ambiguity, missing relocation-hole owner, immediate constraint conflict, and emitted-opcode coverage; expected first failure is missing `authenticateAArch64EncodingCatalog`.
- [ ] Define `AArch64EncodingCatalogEntry`, operand-field records, immediate-constraint records, relocation-hole records, known-byte fixture IDs, and authenticated fingerprint output in `encoding-catalog.ts`.
- [ ] Implement normalization that sorts entries by `stableKey`, freezes authenticated records, and rejects duplicate opcode/profile/operand-form combinations.
- [ ] Implement cross-checks against Task 26A data: every emitted physical opcode has a catalog entry, every fixture ID resolves, and every relocation hole has an owner accepted by the relocation catalog.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/encoding-catalog.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS.
- [ ] Commit `encoding-catalog.ts` and `encoding-catalog.test.ts`.

**Code Examples:**

```ts
test("encoding catalog rejects relocation hole without catalog owner", () => {
  const result = authenticateAArch64EncodingCatalog(
    encodingCatalogForTest({
      entries: [
        encodingEntryForTest({
          opcode: "adrp",
          relocationHole: { bitRange: [5, 23], owner: undefined },
        }),
      ],
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected catalog error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "encoding-catalog:relocation-hole-without-owner:adrp:5-23",
  ]);
});
```

```ts
test("encoding catalog fingerprint is independent of authored entry order", () => {
  const first = authenticateAArch64EncodingCatalog(
    encodingCatalogForTest({ order: ["movz", "add"] }),
  );
  const second = authenticateAArch64EncodingCatalog(
    encodingCatalogForTest({ order: ["add", "movz"] }),
  );

  expect(first.kind).toBe("ok");
  expect(second.kind).toBe("ok");
  if (first.kind !== "ok" || second.kind !== "ok") throw new Error("expected catalog auth");
  expect(first.catalog.fingerprint).toBe(second.catalog.fingerprint);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/encoding-catalog.test.ts
```

## Task 27: Integer, Branch, and Control Encoder

**Description:** Implement direct bitfield encoding for integer data-processing, move-wide, compare/select, branches, calls, returns, traps, and condition-code instructions.

**Dependencies:** Tasks 24, 26.

**Files:**

- Create: `src/target/aarch64/backend/object/encoding-core.ts`
- Create: `src/target/aarch64/backend/object/encoding-integer-branch.ts`
- Create: `tests/unit/target/aarch64/backend/encoding-integer-branch.test.ts`

**Acceptance Criteria:**

- Encodes from checked catalog fields only; no assembler text, mnemonic parser, subprocess, or disassembler authority.
- `encoding-core.ts` defines shared `AArch64InstructionFamilyEncoder` and `encodeAArch64PhysicalInstructionWithFamilies`; it does not import Task 28's memory/SIMD/FP family module.
- Handles MOVZ/MOVK/MOVN, ADD/SUB immediate/register, AND/ORR/EOR logical immediate/register, MUL, UDIV, SDIV, LSL/LSR, CMP, CSET, CSEL, CCMP, B, BL, BR, BLR, RET, B.cond, CBZ/CBNZ, TBZ/TBNZ when cataloged, and trap encoding.
- Rejects unsupported opcode/profile, illegal register class, SP/ZR misuse, immediate out of range, unresolved operands, and relocation holes missing records.
- Emits patch offset and bit-range metadata for branch relocation holes.
- Tests include known-byte fixtures for every encoded family and negative cases for range, condition, register class, SP/ZR, and missing relocation record.

**Execution Steps:**

- [ ] Write `encoding-integer-branch.test.ts` for MOVZ, ADD immediate, ADD register, logical immediate, CMP, CSEL, B, BL, BR, RET, B.cond relocation hole, and negative range/register/SP/ZR cases; expected first failure is missing `encodeAArch64PhysicalInstructionWithFamilies`.
- [ ] Define `AArch64InstructionFamilyEncoder`, encode input/result, byte writer, operand resolver, immediate encoder, and relocation-hole result types in `encoding-core.ts`.
- [ ] Implement family dispatch in `encoding-core.ts`: look up catalog entry by opcode, validate feature/profile/operand count, then delegate to the matching family encoder.
- [ ] Implement integer/branch family encoders in `encoding-integer-branch.ts` using catalog fixed bitfields and operand bit ranges only; do not parse assembler text.
- [ ] Attach branch relocation-hole metadata for branch26, branch19, branch14, and register-indirect branch forms where catalog allows relocation.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/encoding-integer-branch.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit encoding core, integer/branch encoder, and tests.

**Code Examples:**

```ts
test("encodes movz x0, #0x1234 using known bytes", () => {
  const result = encodeAArch64PhysicalInstructionWithFamilies(
    encodeInputForTest({
      instruction: physicalInstructionForTest({
        opcode: "movz",
        operands: [registerDef("x0"), immediate(0x1234n)],
      }),
    }),
    aarch64IntegerBranchEncoderFamilies,
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected encoding");
  expect([...result.bytes]).toEqual([0x80, 0x46, 0x82, 0xd2]);
});
```

```ts
test("conditional branch records branch19 relocation hole", () => {
  const result = encodeAArch64PhysicalInstructionWithFamilies(
    encodeInputForTest({
      instruction: physicalInstructionForTest({
        opcode: "b-cond",
        operands: [condition("eq"), relocationTarget("target.block")],
        relocation: relocationHoleForTest({ kind: "branch19" }),
      }),
    }),
    aarch64IntegerBranchEncoderFamilies,
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected branch encoding");
  expect(result.relocationHole).toEqual({
    kind: "branch19",
    patchOffsetBytes: 0,
    bitRange: [5, 23],
  });
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/encoding-integer-branch.test.ts
```

## Task 28: Memory, Atomic, Barrier, SIMD, and FP Encoder

**Description:** Complete direct encoding for memory addressing, pair load/store, endian transforms, ADRP/pageoff users, literal loads, barriers, LSE atomics, prefetch, SIMD, FP, crypto, CRC, PMULL, FMADD, and DotProd forms emitted by the backend.

**Dependencies:** Tasks 24, 26.

**Files:**

- Create: `src/target/aarch64/backend/object/encoding-memory-simd-fp.ts`
- Create: `tests/unit/target/aarch64/backend/encoding-memory-simd-fp.test.ts`

**Acceptance Criteria:**

- Encodes LDR/STR unsigned immediate, LDR register offset, LDP/STP signed offset, REV/REV16/REV32, ADRP, ADD pageoff, literal LDR, DMB, DSB, LDAR, STLR, LDADD variants, PRFM, LD1/ST1, TBL/TBX, CMEQ, BSL, CRC32, PMULL, AES/SHA round forms, FMADD, and DotProd catalog forms.
- Implements memory/SIMD/FP family encoders against `AArch64InstructionFamilyEncoder` from `encoding-core.ts` without modifying Task 27 files.
- Validates memory scale, pair offset range, alignment, feature gates, relocation low-12 scale, barrier domain, atomic ordering form, vector/FP register class, and security catalog allowance.
- Rejects secret/key literal pool placement unless security catalog permits it.
- Tests include known-byte fixtures for each encoded family and negative cases for unscaled offset, low-12 scale mismatch, missing LSE feature, secret literal violation, FP/vector feature mismatch, and unresolved frame object.

**Execution Steps:**

- [ ] Write `encoding-memory-simd-fp.test.ts` for LDR unsigned immediate, STR unsigned immediate, LDP/STP, REV, ADRP, ADD pageoff, literal LDR, DMB/DSB, LDAR/STLR, LDADD, PRFM, selected SIMD/FP/crypto fixtures, and negative scale/feature/security/frame-object cases; expected first failure is missing `aarch64MemorySimdFpEncoderFamilies`.
- [ ] Implement memory/SIMD/FP family encoders in `encoding-memory-simd-fp.ts` against `AArch64InstructionFamilyEncoder` from Task 27.
- [ ] For memory encoders, validate access width, scaled/unscaled offset class, alignment, base register permissions, relocation low-12 scale, and frame-object resolution before writing bytes.
- [ ] For barrier/atomic encoders, validate feature gates, domain/order fields, and memory-order fact compatibility.
- [ ] For SIMD/FP/crypto encoders, validate register class, lane/view permissions, FP/vector feature gates, FPCR/FPSR requirements, and security catalog allowance.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/encoding-memory-simd-fp.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit memory/SIMD/FP encoder and tests.

**Code Examples:**

```ts
test("encodes ldr x1, [x2, #16] with unsigned scaled offset", () => {
  const result = encodeAArch64PhysicalInstructionWithFamilies(
    encodeInputForTest({
      instruction: physicalInstructionForTest({
        opcode: "ldr-unsigned-immediate",
        operands: [registerDef("x1"), memoryBase("x2"), immediate(16n)],
        accessWidthBytes: 8,
      }),
    }),
    aarch64MemorySimdFpEncoderFamilies,
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected ldr encoding");
  expect([...result.bytes]).toEqual([0x41, 0x08, 0x40, 0xf9]);
});
```

```ts
test("pageoffset-12l rejects offset not scaled for 64-bit load", () => {
  const result = encodeAArch64PhysicalInstructionWithFamilies(
    encodeInputForTest({
      instruction: physicalInstructionForTest({
        opcode: "ldr-unsigned-immediate",
        operands: [registerDef("x0"), memoryBase("x1"), relocationLow12("global", 6n)],
        accessWidthBytes: 8,
      }),
    }),
    aarch64MemorySimdFpEncoderFamilies,
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected scale error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "encoding:pageoffset-12l-scale-mismatch:ldr-unsigned-immediate:offset:6:width:8",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/encoding-memory-simd-fp.test.ts
```

## Task 29: Relocation Records and Catalog Mapping

**Description:** Implement internal relocation records, relocation catalog validation, paired relocation relationships, patch offsets, range/overflow policy, veneer delegation policy, and PE/COFF mapping requirements.

**Dependencies:** Tasks 3, 4, 24, 26A.

**Files:**

- Create: `src/target/aarch64/backend/object/relocation-records.ts`
- Create: `tests/unit/target/aarch64/backend/relocation-records.test.ts`

**Acceptance Criteria:**

- Supports internal families: `branch26`, `branch19`, `branch14`, `pagebase-rel21`, `pageoffset-12a`, `pageoffset-12l`, `addr64`, `addr32`, `addr32nb`, `rel32`, and `section-relative`.
- Records target symbol/section/fragment/external reference, encoded patch offset, bit range, addend policy, range policy, overflow policy, veneer eligibility, scratch policy, paired relocation relationship, section/fragment provenance, and final-writer mapping.
- Rejects relocation kind without PE/COFF mapping for rpi5 profile unless it is internal-only and proven resolved before PE/COFF serialization.
- Tests cover branch/call, conditional branch, test branch, ADRP/ADD pair, ADRP/LDR pair, literal load, addr64 data pointer, rel32, external symbol, section-relative metadata, unmapped relocation rejection, paired relocation mismatch, and deterministic ordering.

**Execution Steps:**

- [ ] Write `relocation-records.test.ts` for branch/call, conditional branch, test branch, ADRP/ADD pair, ADRP/LDR pair, literal load, addr64, rel32, external symbol, section-relative metadata, unmapped relocation rejection, paired mismatch, and deterministic ordering; expected first failure is missing `buildAArch64RelocationRecords`.
- [ ] Define internal relocation family records, target records, patch records, range policy, overflow policy, veneer eligibility, scratch policy, paired relationship, and final-writer mapping records.
- [ ] Normalize encoded holes by `(sectionStableKey, fragmentStableKey, patchOffsetBytes, relocationFamily, targetStableKey)` and reject duplicate patch ownership.
- [ ] Resolve paired relocations by stable pair keys, requiring pagebase/low12 pairs to target the same symbol and compatible addend policy.
- [ ] Validate each relocation family against Task 26A relocation mappings; reject unmapped PE/COFF-facing families unless the catalog proves they are internal-only and resolved before serialization.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/relocation-records.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit relocation records source and tests.

**Code Examples:**

```ts
test("creates paired ADRP and ADD low12 relocation records", () => {
  const records = buildAArch64RelocationRecords(
    relocationInputForTest({
      encodedHoles: [
        encodedHoleForTest({
          key: "page",
          kind: "pagebase-rel21",
          symbol: "global",
          patchOffsetBytes: 0,
        }),
        encodedHoleForTest({
          key: "low12",
          kind: "pageoffset-12a",
          symbol: "global",
          patchOffsetBytes: 4,
        }),
      ],
    }),
  );

  expect(records.kind).toBe("ok");
  if (records.kind !== "ok") throw new Error("expected relocation records");
  expect(records.relocations.map((relocation) => relocation.pairedRelocationKey)).toEqual([
    "low12",
    "page",
  ]);
});
```

```ts
test("rejects branch26 relocation without mapping or veneer policy", () => {
  const result = buildAArch64RelocationRecords(
    relocationInputForTest({
      relocationCatalog: relocationCatalogForTest({ branch26Mapping: undefined }),
      encodedHoles: [encodedHoleForTest({ kind: "branch26", symbol: "far_target" })],
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected relocation mapping error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "relocation:missing-writer-mapping:branch26:far_target",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/relocation-records.test.ts
```

## Task 30: Branch Relaxation, Literal Pools, and Veneers

**Description:** Implement the monotone growth decisions for branch widening, conditional/test branch expansion, literal-pool island placement, veneer requests, and scratch-register validation.

**Dependencies:** Tasks 11, 24, 29.

**Files:**

- Create: `src/target/aarch64/backend/object/branch-relaxation.ts`
- Create: `src/target/aarch64/backend/object/literal-pools.ts`
- Create: `src/target/aarch64/backend/object/veneers.ts`
- Create: `tests/unit/target/aarch64/backend/branch-relaxation.test.ts`
- Create: `tests/unit/target/aarch64/backend/literal-pools.test.ts`
- Create: `tests/unit/target/aarch64/backend/veneers.test.ts`

**Acceptance Criteria:**

- Branch relaxation handles unconditional branches, conditional branches, compare-and-branch, test-and-branch, direct calls, tail-call branches, and trap/unreachable fallthrough effects.
- Literal-pool planner creates deterministic section-local islands with value bytes, alignment, relocation requirements, users, reach ranges, section/island key, security restrictions, provenance, and fact authority.
- Veneer planner records source site, target, relocation kind, range proof, scratch registers, security constraints, and linker-owned/backend-owned policy.
- Layout may request veneers only for sites predeclared veneer-eligible before allocation.
- Tests cover monotone branch widening, conditional expansion, test-branch expansion, literal island splitting, literal security rejection, backend-owned veneer insertion, linker-owned veneer record, undeclared scratch diagnostic, and finite range-exhaustion diagnostic.

**Execution Steps:**

- [ ] Write branch, literal-pool, and veneer tests for the acceptance matrix; expected first failures are missing `relaxAArch64Branches`, `planAArch64LiteralPools`, and `planAArch64Veneers`.
- [ ] Define monotone decision states: `unchanged`, `expanded`, `veneer-requested`, `linker-owned`, and `range-exhausted`; states may only move forward.
- [ ] Implement branch relaxation by checking encoded distance/range policy, then widening unconditional/conditional/test branches through catalog-approved expansions without shrinking later iterations.
- [ ] Implement literal-pool planning by grouping literals by section, literal class, alignment, relocation compatibility, security label, reach window, and stable value key, then splitting islands when reach requires it.
- [ ] Implement veneer planning by validating predeclared eligibility, scratch registers, call-boundary clobbers, security constraints, backend-owned/linker-owned policy, and range proof.
- [ ] Emit finite diagnostics for range exhaustion, literal security rejection, undeclared scratch, and unsupported catalog policy.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/branch-relaxation.test.ts ./tests/unit/target/aarch64/backend/literal-pools.test.ts ./tests/unit/target/aarch64/backend/veneers.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit branch relaxation, literal-pool, veneer source files and tests.

**Code Examples:**

```ts
test("branch relaxation widens out-of-range conditional branch monotonically", () => {
  const result = relaxAArch64Branches(
    branchRelaxationInputForTest({
      branches: [conditionalBranchForTest({ siteKey: "b.eq:1", distanceBytes: 2_000_000 })],
      relocationCatalog: relocationCatalogForTest({ conditionalBranchExpansion: "invert-and-b" }),
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected branch relaxation");
  expect(result.decisions.map((decision) => decision.state)).toEqual(["expanded-invert-and-b"]);
});
```

```ts
test("veneer planner rejects scratch register not predeclared before allocation", () => {
  const result = planAArch64Veneers(
    veneerInputForTest({
      sites: [
        veneerEligibleSiteForTest({
          siteKey: "call:main:far",
          predeclaredScratchGprs: [],
          requestedScratchGprs: ["x16"],
        }),
      ],
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected veneer scratch error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "veneer:undeclared-scratch:call:main:far:x16",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/branch-relaxation.test.ts ./tests/unit/target/aarch64/backend/literal-pools.test.ts ./tests/unit/target/aarch64/backend/veneers.test.ts
```

## Task 31: Layout-And-Encode Fixed Point

**Description:** Implement the single grow-only fixed-point owner for section/fragment ordering, instruction sizes, encoding, branch relaxation, literal pools, veneers, alignment, patch offsets, relocations, and byte provenance.

**Dependencies:** Tasks 27, 28, 29, 30.

**Files:**

- Create: `src/target/aarch64/backend/object/encoding.ts`
- Create: `src/target/aarch64/backend/object/layout-encode-fixed-point.ts`
- Create: `tests/unit/target/aarch64/backend/layout-encode-fixed-point.test.ts`

**Acceptance Criteria:**

- Builds initial fragments, tentatively encodes instructions, computes branch/literal ranges, widens or requests veneers, places/splits literal pools, assigns offsets, emits relocation records, verifies ranges/mappings, and repeats only when a monotone decision changes.
- Uses stable keys for branch sites, targets, relocations, literal values, islands, veneers, and fragments to avoid oscillation.
- Terminates with stable layout or deterministic diagnostic naming range, branch/literal/veneer key, section, target, and exhausted legal expansions.
- Emits encoded fragments and relocation records together.
- Tests cover stable one-pass layout, branch widening iteration, literal-pool island insertion iteration, veneer insertion iteration, alignment padding, relocation patch offset update after growth, object byte provenance, and range-exhaustion diagnostic.

**Execution Steps:**

- [ ] Write fixed-point tests for one-pass layout, branch widening, literal island insertion, veneer insertion, alignment padding, patch-offset update, byte provenance, and range exhaustion; expected first failure is missing `runAArch64LayoutEncodeFixedPoint`.
- [ ] Create `encoding.ts` as the production dispatcher that composes `aarch64IntegerBranchEncoderFamilies` and `aarch64MemorySimdFpEncoderFamilies` through `encodeAArch64PhysicalInstructionWithFamilies`.
- [ ] Define per-site monotone state for branch sites, literal users, veneer requests, alignment padding, fragments, and relocation holes. Each state must only move from smaller/less concrete to larger/more concrete.
- [ ] Build iteration 0 from physical instructions: stable section order, stable fragment order, tentative 4-byte instruction sizes, initial alignment padding, and initial relocation-hole metadata.
- [ ] On each iteration, encode with current decisions, compute offsets, build relocation records, check branch/literal ranges, ask Task 30 planners for grow-only decisions, and append byte provenance for every emitted byte.
- [ ] If no monotone state changes, return encoded fragments, sections, symbols, relocation records, literal pools, veneers, verification plan, and byte provenance together.
- [ ] If a site exhausts legal growth states, emit `layout-fixed-point:range-exhausted:<kind>:<site>:section:<stableKey>:target:<stableKey>` and stop without partial object output.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/layout-encode-fixed-point.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS.
- [ ] Commit `encoding.ts`, `layout-encode-fixed-point.ts`, and `layout-encode-fixed-point.test.ts`.

**Code Examples:**

```ts
test("layout fixed point updates relocation patch offsets after branch widening grows fragment", () => {
  const result = runAArch64LayoutEncodeFixedPoint(
    layoutEncodeInputForTest({
      fragments: [
        textFragmentForTest({
          key: "text.main",
          instructions: [
            conditionalBranchForTest({ siteKey: "b.eq:far", distanceBytes: 2_000_000 }),
            blInstructionForTest({ siteKey: "call:near", target: "helper" }),
          ],
        }),
      ],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected layout fixed point");
  expect(
    result.objectRelocations.find((relocation) => relocation.siteKey === "call:near")
      ?.patchOffsetBytes,
  ).toBe(8);
});
```

```ts
test("fixed point fails deterministically when no branch expansion remains", () => {
  const result = runAArch64LayoutEncodeFixedPoint(
    layoutEncodeInputForTest({
      fragments: [outOfRangeBranchWithNoVeneerPolicyForTest({ siteKey: "b:too_far" })],
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected range exhaustion");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "layout-fixed-point:range-exhausted:branch:b:too_far:section:.text:target:far_target",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/layout-encode-fixed-point.test.ts
```

## Task 32: Object Verifier

**Description:** Implement final object verification after the layout-and-encode fixed point is stable.

**Dependencies:** Tasks 3, 12, 20, 23, 31.

**Files:**

- Create: `src/target/aarch64/backend/verify/encoding-object-verifier.ts`
- Create: `tests/unit/target/aarch64/backend/object-verifier.test.ts`

**Acceptance Criteria:**

- Verifies every instruction byte sequence matches encoding catalog.
- Verifies every relocation patch offset points into encoded fragment and owns its bit range.
- Verifies relocation addend policy, branch/literal/veneer ranges, literal-pool reach/security, veneer scratch assumptions, deterministic section/fragment/symbol/relocation ordering, symbol resolution, unwind records, byte provenance coverage, and absence of stale fact subjects.
- Invokes security label-conservation verifier for object-level security obligations.
- Tests cover valid object, corrupted byte, relocation patch outside fragment, addend mismatch, unreachable literal island, undeclared veneer scratch, symbol missing, unwind mismatch, byte provenance gap, stale fact subject, and nondeterministic symbol order.

**Execution Steps:**

- [ ] Write `object-verifier.test.ts` for valid object, corrupted byte, relocation patch outside fragment, addend mismatch, unreachable literal island, undeclared veneer scratch, missing symbol, unwind mismatch, byte provenance gap, stale fact subject, and nondeterministic ordering; expected first failure is missing `verifyAArch64ObjectModule`.
- [ ] Define object verifier input, verifier result, byte decode check record, relocation coverage record, symbol resolution record, and object-level security check request.
- [ ] Re-decode every encoded instruction byte sequence through the encoding catalog and compare bytes, relocation-hole ownership, and operand metadata.
- [ ] Verify relocation patch offsets, bit ranges, addend policy, range policy, literal-pool reach/security, veneer scratch assumptions, symbol resolution, unwind records, and deterministic ordering.
- [ ] Verify byte provenance covers every emitted byte exactly once and that no fact subject points to a deleted or stale object subject.
- [ ] Invoke security label conservation for object-level obligations and merge diagnostics deterministically.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/object-verifier.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit object verifier source and tests.

**Code Examples:**

```ts
test("object verifier rejects relocation patch offset outside encoded fragment", () => {
  const result = verifyAArch64ObjectModule(
    objectVerifierInputForTest({
      objectModule: objectModuleForTest({
        sections: [sectionForTest({ stableKey: ".text", bytes: [0, 0, 0, 0] })],
        relocations: [relocationForTest({ sectionStableKey: ".text", patchOffsetBytes: 8 })],
      }),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected relocation patch error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "object-verifier:relocation-patch-out-of-range:.text:offset:8:size:4",
  ]);
});
```

```ts
test("object verifier requires byte provenance for every emitted byte", () => {
  const result = verifyAArch64ObjectModule(
    objectVerifierInputForTest({
      objectModule: objectModuleForTest({
        sections: [sectionForTest({ stableKey: ".text", bytes: [0, 0, 0, 0] })],
        byteProvenance: [
          byteProvenanceForTest({ sectionStableKey: ".text", offsetBytes: 0, lengthBytes: 3 }),
        ],
      }),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected provenance gap");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "object-verifier:byte-provenance-gap:.text:offset:3",
  ]);
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/object-verifier.test.ts
```

## Task 33: Debug Artifacts and Provenance Dumps

**Description:** Add optional deterministic debug artifacts for allocation plans, frame plans, layout traces, verifier traces, fact-transfer graphs, object provenance, and missed conservative fallbacks.

**Dependencies:** Tasks 3, 10, 11, 31, 32.

**Files:**

- Extend: `src/target/aarch64/backend/api/compile-aarch64-object.ts`
- Create: `src/target/aarch64/backend/api/backend-debug-artifacts.ts`
- Create: `tests/unit/target/aarch64/backend/backend-debug-artifacts.test.ts`

**Acceptance Criteria:**

- Debug artifacts are optional and never required for successful compilation.
- Artifacts are deterministic, sorted, free of host paths/timestamps/environment data, and use stable IDs.
- Includes allocation plan, frame plan, layout trace, verifier trace, fact-transfer graph, byte provenance dump, fact-spending summary, and missed-optimization diagnostics when diagnostic mode requests them.
- Tests cover artifact request selection, stable output over repeated runs, no artifact when not requested, no host metadata, and fact-to-byte provenance trace.

**Execution Steps:**

- [ ] Write `backend-debug-artifacts.test.ts` for artifact selection, repeated-run stability, absence when not requested, host metadata absence, fact-transfer graph, and fact-to-byte provenance trace; expected first failure is missing `AArch64BackendDebugArtifactRequest`.
- [ ] Define debug artifact request, allocation plan dump, frame plan dump, layout trace, verifier trace, fact-transfer graph, byte provenance dump, fact-spending summary, and missed-optimization diagnostic records.
- [ ] Add optional artifact collection to `compile-aarch64-object.ts` without making artifacts required for successful compilation.
- [ ] Serialize artifacts through stable JSON helpers, sorting every repeated record by `stableKey` and rejecting host path/timestamp/process/environment fields.
- [ ] Add debug-mode missed conservative fallback diagnostics from fact import, ABI, allocation, frame, layout, and object verification stages.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/backend-debug-artifacts.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS or an unrelated pre-existing failure recorded with exact file paths.
- [ ] Commit debug artifact source/API changes and tests.

**Code Examples:**

```ts
test("debug artifact request returns stable layout trace without host metadata", () => {
  const first = compileAArch64Object(
    backendInputForTest({ debugArtifacts: { layoutTrace: true, factTransferGraph: true } }),
  );
  const second = compileAArch64Object(
    backendInputForTest({ debugArtifacts: { layoutTrace: true, factTransferGraph: true } }),
  );

  expect(first.kind).toBe("ok");
  expect(second.kind).toBe("ok");
  if (first.kind !== "ok" || second.kind !== "ok") throw new Error("expected success");
  expect(first.debugArtifacts).toEqual(second.debugArtifacts);
  expect(JSON.stringify(first.debugArtifacts)).not.toContain(process.cwd());
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/backend-debug-artifacts.test.ts
```

## Task 34: End-To-End Compile Integration and Deterministic Acceptance

**Description:** Wire all backend stages together so `compileAArch64Object` produces verified `AArch64ObjectModule` instances for representative machine programs and deterministic diagnostics for unsupported inputs.

**Dependencies:** Tasks 1-33, including Task 5A and Task 26A.

**Files:**

- Modify: `src/target/aarch64/backend/api/compile-aarch64-object.ts`
- Modify: `src/target/aarch64/backend/api/backend-pipeline.ts`
- Create: `tests/unit/target/aarch64/backend/backend-end-to-end.test.ts`
- Create: `tests/integration/target/aarch64/backend-object.test.ts`
- Update: `src/target/aarch64/index.ts`
- Update: `src/target/aarch64/public-api.ts`
- Update: `src/target/index.ts`

**Acceptance Criteria:**

- Empty machine program emits deterministic empty object module with verification summary.
- Simple leaf function emits `.text` bytes, symbol, no-unwind leaf classification, byte provenance, and no relocations.
- Non-leaf call function emits public ABI call boundary, callee-save frame, unwind record, relocation record, and verified object module.
- Closed-image private helper fixture emits private convention call boundary only when plan authorizes it.
- Security fixture with no-spill/wipe-on-spill facts preserves constraints through allocation, frame, finalization, and object verification.
- Packet-loop-inspired fixture demonstrates proof-spent wins: pinned packet base when private clobbers permit, direct validated field load, endian instruction, exact barrier sequence, and fact-to-byte provenance.
- Determinism test compiles the same input multiple times and asserts deep equality for object module, diagnostics, verification summary, debug artifacts, allocation choices, frame offsets, section ordering, symbol ordering, relocation ordering, and bytes.
- Negative end-to-end tests cover stale closed-image plan, invalid fact lineage, no-spill allocation failure, unrepresentable unwind frame, relocation mapping failure, range exhaustion, literal-pool security violation, and stale object fact subject.

**Execution Steps:**

- [ ] Write `backend-end-to-end.test.ts` for empty program, simple leaf, non-leaf public call, closed-image private helper, security fixture, packet-loop fixture, deterministic repeated compile, and all named negative diagnostics; expected first failure is the first unimplemented pipeline stage.
- [ ] Write `tests/integration/target/aarch64/backend-object.test.ts` for representative object-module bytes, relocations, unwind records, provenance, and verification summary across the public API.
- [ ] Replace every pass-through default pipeline stage with the owning task's implementation in the exact stage order from Task 8.
- [ ] Ensure `compileAArch64Object` never returns partial object output after a failing verifier stage and always returns sorted diagnostics and verifier runs.
- [ ] Use the Task 5A `packetLoopBackendInputForTest` fixture, which includes facts for validated region shape, memory order, internal-call eligibility, private clobbers, endian access, barrier sequence, and fact-to-byte provenance.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/backend-end-to-end.test.ts ./tests/integration/target/aarch64/backend-object.test.ts`; expected result is PASS.
- [ ] Run `bun run agent:check`; expected result is PASS.
- [ ] Commit pipeline integration, public exports, end-to-end tests, and integration tests.

**Code Examples:**

```ts
test("simple leaf function emits deterministic text object module", () => {
  const result = compileAArch64Object(
    backendInputForTest({
      machineProgram: machineProgramForTest({
        functions: [leafFunctionReturningConstantForTest({ symbol: "main", value: 7n })],
      }),
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected object module");
  expect(result.objectModule.sections.map((section) => section.stableKey)).toEqual([".text"]);
  expect(result.objectModule.symbols.map((symbol) => symbol.stableKey)).toEqual(["main"]);
  expect(result.objectModule.unwindRecords[0].classification).toBe("frameless-leaf");
  expect(result.verification.runs.every((run) => run.status === "passed")).toBe(true);
});
```

```ts
test("same backend input compiles to deeply equal object modules", () => {
  const input = packetLoopBackendInputForTest();

  const first = compileAArch64Object(input);
  const second = compileAArch64Object(input);

  expect(first.kind).toBe("ok");
  expect(second.kind).toBe("ok");
  if (first.kind !== "ok" || second.kind !== "ok")
    throw new Error("expected deterministic success");
  expect(first.objectModule).toEqual(second.objectModule);
  expect(first.diagnostics).toEqual(second.diagnostics);
  expect(first.verification).toEqual(second.verification);
});
```

```ts
test("packet loop provenance explains direct endian field load", () => {
  const result = compileAArch64Object(packetLoopBackendInputForTest());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected packet loop object");
  const endianByte = result.objectModule.byteProvenance.find(
    (record) =>
      record.factFamilies.includes("validated-region-shape") &&
      record.factFamilies.includes("memory-order-and-region-type") &&
      record.machineSubjectKey.includes("packet.field.ethertype"),
  );
  expect(endianByte).toBeDefined();
});
```

```bash
bun test ./tests/unit/target/aarch64/backend/backend-end-to-end.test.ts ./tests/integration/target/aarch64/backend-object.test.ts
bun run agent:check
```

## Self-Review Checklist

Run this before implementation begins and again after implementation completes:

```text
Spec coverage:
  Purpose and production commitments map to Tasks 8, 9, 10, 11, 14-34.
  Fact authority, cascade, gates, and prior phase true-up map to Tasks 1, 6, 7, 10, 11, 33, 34.
  Target surface and catalogs map to Tasks 4, 13, 26A, 26, 29.
  ABI public/private/closed-image plan maps to Tasks 5, 14, 15.
  Allocation, frame, security, and unwind map to Tasks 12, 16-23.
  Finalization, scheduling, encoding, relocation, fixed point, literals, veneers, object verification map to Tasks 24-32.
  Public API, diagnostics, shared fixtures, tests, and deterministic debug output map to Tasks 2, 3, 5A, 8, 33, 34.

Placeholder scan:
  No task may rely on open-ended external research; standards-derived knowledge must appear as Task 26A catalog data, a task-local algorithm, or a named fixture matrix before implementation starts.
  No task may introduce a consumed type without declaring it in its producer task.
  Every task has files, acceptance criteria, code examples, commands, and the global execution checklist; algorithm-heavy tasks also carry task-local steps.

Type consistency:
  Public API uses CompileAArch64ObjectInput and CompileAArch64ObjectResult consistently.
  Backend target surface stays distinct from existing AArch64TargetSurface.
  Closed-image plan uses AArch64ClosedImageBackendPlan consistently.
  Object output uses AArch64ObjectModule consistently.
  Object sections, symbols, fragments, relocations, literals, veneers, and verifier runs use `stableKey` for identity.
  Backend facts import from AArch64PreservedFactSet through shared CompilerFactExtension.
```

## Final Handoff Commands

```bash
bun run format
bun run agent:check
```
