# OptIR To AArch64 Machine IR Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the production OptIR-to-AArch64 machine IR phase described in `docs/design/opt-ir-to-aarch64-machine-ir-design.md`, producing verified AArch64 virtual-register machine IR plus machine-keyed preserved facts and provenance.

**Architecture:** The phase lives under `src/target/aarch64` and is target-owned while consuming only public optimized OptIR and fact-set APIs plus dependency-injected AArch64 target sub-surfaces. Lowering authenticates the single `wrela-uefi-aarch64-rpi5-v1` profile, tiles OptIR operations with local/window/semantic candidates, lowers ABI/regions/calls/constants/terminators, runs deterministic machine planning, re-keys facts, and verifies the result before returning `kind: "ok"`. Register allocation, final frame offsets, encoding, relocation generation, linking, and object/image writing remain outside this phase.

**Tech Stack:** TypeScript, Bun test runner, existing `src/opt-ir` public models, existing `src/shared` deterministic helpers where suitable, dependency-injected fakes for target sub-surfaces, `fast-check` only in tests, no runtime source dependencies.

---

## Research Notes

- Design source: `docs/design/opt-ir-to-aarch64-machine-ir-design.md`.
- Current repository already has `src/opt-ir` with operation kinds, program records, fact sets, verifiers, optimization passes, and public API exports.
- Current repository has only `src/target/index.ts` and `src/target/target-runtime-selection.ts`; there is no existing AArch64 backend implementation or target/aarch64 test tree.
- OptIR operation vocabulary currently includes constants, scalar integer/boolean operations, aggregate operations, layout operations, memory load/store, source/runtime/platform/intrinsic calls, fixed vector operations, and `proofErasedMarker`.
- Existing conventions use branded numeric IDs, frozen deterministic records, diagnostic-code allowlists, deterministic sort keys, and Bun tests with fakes through dependency injection.
- Existing AGENTS instructions require `bun run agent:check` before handoff and recommend narrow `bun test ...` commands while iterating.
- Runtime source should remain dependency-free; test-only property generation may use `fast-check`.
- No implementation task may read the filesystem, probe host CPU features, use current time, use environment variables, or query benchmark/scorecard data from runtime lowering code.
- Required handoff command:

```bash
PATH="$HOME/.bun/bin:$PATH" bun run agent:check
```

## Implementation Findings

- The final verifier suite needs verifier-family artifacts threaded through the root verifier context. Fact preservation, tiling, superselection, and scheduler descriptors now consume optional preserved facts, selection candidates, semantic candidates, and dependency edges through the default suite instead of exposing helper-only checks.
- UEFI image-context lowering treats `bootFunctionSymbol` from the target image profile as the machine-program entry contract. The PE/COFF loader shim entry remains a later backend/image concern and is not the machine IR entry symbol.
- Semantic operation facts are represented as a target-neutral OptIR fact extension family (`semantic-operation`) so named semantic operations and semantic-region markers have the same preservation/query substrate as memory-order, branch/footprint, FP/numeric, security, vector-state, and call-clobber facts.
- Lowering now accepts an explicit optimized OptIR operation table alongside the program graph. Referenced block operation IDs without definitions are rejected as input-contract errors instead of silently lowering empty block shells.
- The machine-IR verifier derives tiling coverage from real materialized selection records and derives scheduler dependency/required edges from emitted machine functions. This prevents the verifier from passing on synthetic selection indices or empty dependency artifacts.
- `semanticFence` is modeled as an ordered region-token effect, not pure metadata, and extension fact record construction is closed over a registry-provided extension key and packet-kind set.
- The differential harness now compares structured observations for memory bytes, effect-token progress, optional traces, and return values so memory-order, vector, and semantic opcode families exercise the machine interpreter.
- Final public-pipeline hardening found that ABI bindings, memory-order, endian, vector-policy, and validated-buffer decisions must be visible in emitted machine IR, not only in helper-level selection metadata. Operation materialization now consumes AArch64 fact/region/vector decisions while the corresponding public stages summarize actual emitted opcodes and facts.
- Entry block parameters are now bound to ABI locations and treated as verifier-defined machine inputs. Input-contract failures return deterministic AArch64 diagnostics instead of surfacing JavaScript exceptions.
- Machine-instruction construction now rejects extra operands, role order mismatches, invalid operand kinds, register/type mismatches, out-of-range immediates, and malformed memory/barrier shapes. Optional memory offsets and branch condition encodings are represented explicitly in the opcode catalog instead of being accepted accidentally.
- Final review found that immediate-form opcode schemas must constrain operand value kind, not just operand role. Register-register subtract/logical lowering now emits register-form opcodes, immediate forms reject register operands at construction time, and differential fixtures use the canonical register add form.
- Preserved machine facts now carry declared target lineage, and the fact verifier rejects unjustified facts, missing target declarations, invalid memory operand indices, and machine-edge subjects without matching dependency edges.
- Branch and switch terminators must not silently lose CFG successors. Conditional branches now lower with both true and false successor edges represented, and switch lowering emits deterministic compare/conditional-branch chains for numeric cases instead of default-only control flow.
- Call lowering must not fabricate zero-valued indirect targets or zero-valued call results. Runtime/platform call targets are represented through symbolic target materialization, and result values are copied from ABI-return placeholders so later ABI/register-allocation stages can bind the concrete locations.
- Fact preservation is mapping-driven. Selection records may declare precise machine fact subjects, and the preservation stage derives memory-operand, machine-edge, virtual-register, region, and call-site subjects before falling back to instruction-scoped facts.
- Semantic superselection dispatches real semantic plugins and verifies plugin live-outs against catalog-declared manifest live-outs. Unknown semantic manifests and hidden live-outs are surfaced through public verifier diagnostics.
- Region contract validation must run before any memory operation is materialized. Device/MMIO, firmware, and runtime-owned regions require provenance, and validated-payload regions require backing-region plus certified-offset evidence on the public path.
- Machine planning now carries dependency edges, required edges, and block schedule order through planning state. Scheduler metadata is parsed and checked for dependency-graph count, block coverage, schedule-state consistency, and dependency-order preservation instead of accepting placeholder schedule strings.
- Required constraints can be derived from preserved machine-edge facts as well as machine IR, with missing-edge diagnostics naming the provider and subject that required the edge.
- The public `verify-machine-ir` stage now passes semantic candidates and manifest live-outs into the default verifier suite. The superselection verifier is covered through both root verifier and public-stage diagnostics instead of helper-only tests.
- Verifier-family hardening now checks concrete machine-IR metadata for ABI placement and stack-argument contracts, region domain/access-shape constraints, acquire/release/LSE memory-order opcode and edge requirements, FP contraction/resource obligations, and security metadata survival for no-spill, wipe-on-spill, and zeroization constraints.
- Operation-matrix status is now a public lowering contract, not just catalog documentation. The verify-operation-matrix stage installs per-operation support contracts, helper-lowered semantic operations require matching semantic plugin manifests, vector/FP/semantic fact-gated operations require their fact family, and exported operation materialization rejects unauthorised matrix-sensitive operations.
- UEFI image context bindings are installed on the boot machine function. Image-entry OptIR parameters are ABI-offset after the UEFI image handle/system table slots, stack-passed parameters allocate an incoming argument frame area, and scalar returns emit explicit ABI-return copies before `ret`.
- Preserved machine-edge facts now participate in full-pipeline scheduling without changing the documented stage order. The planning stage derives a preview preserved-fact set after the initial dependency graph exists, uses it for required scheduling edges, then the later preserve-machine-facts stage publishes the final fact set.
- The checksum, VirtIO queue, and fixed-vector classifier integration tests now exercise the public `lowerOptIrToAArch64` API in addition to helper/plugin seams, covering CRC32/PMULL, release-plus-barrier VirtIO publication, DotProd classifier lowering, and vector policy behavior.
- Late final-review hardening found several places where helper-level behavior was not strong enough for public lowering. Platform calls now materialize and load a function pointer before `blr`, semantic atomics require operation source indices plus memory-order facts and lower through the memory-order helper, and logical-immediate machine forms reject unencodable immediates while copy idioms use legal `add-immediate #0` forms.
- Validated-buffer zero-copy access now forces validated-payload region validation before ordinary memory-type classification. Empty facts, malformed validated-payload facts, and generic `normalCacheable` region facts all fail closed unless backing-region and certified-offset evidence are present.
- Pair, prefetch, and barrier planning now perform conservative machine-planning-state rewrites rather than explanation-only pass-throughs. Pair formation requires explicit adjacent 64-bit memory-footprint metadata, prefetch insertion is limited to normal-cacheable non-atomic load streams, and barrier insertion uses direction-specific device-ordered and sequentially-consistent rules with hard-boundary schedule metadata.
- Task 25 now uses conservative machine-planning-state transforms instead of placeholder planning records. Post-selection CSE is intra-block and pure-producer only, ADRP sharing is same-block/same-page with call/security barriers, literal-pool entries dedupe by bytes/type/relocation/scope/section/reachability, and rematerialization records are attached to machine functions with symbols, relocation references, resources, facts, and costs.
- Fixed-vector/classifier lowering now distinguishes direct AdvSIMD, scalar-only, and helper-policy paths. Public classifier contracts can select `dotprod`, `tbl`, or `tbx`; vector compare lowers to a lane-compare form; vector select has an explicit blend form; and helper-policy facts avoid direct vector opcodes.
- Debug/provenance output is exposed on successful public lowering when debug or deterministic dump options are requested, and machine-program provenance is populated from target and machine-planning origins. Explicit fact-preservation mappings survive even when the selection record's `factsUsed` array is empty.
- Final independent review found four remaining contract holes. Semantic superselection now preserves plugin-provided consumed operation IDs, authorizes helper-lowered semantic operations per concrete operation ID, and verifier diagnostics reject missing, empty, or manifest-kind-mismatched consumed operations. Memory materialization now resolves region address bases before emitting load/store address producers, so validated-payload accesses incorporate certified backing offsets instead of treating byte offsets as absolute addresses. Device, firmware, and runtime-owned memory accesses reject target-unaligned access shapes on the public path. LSE read-modify-write atomics now lower and verify the full `ldadd` suffix family for relaxed, acquire, release, acquire-release, and sequentially-consistent orders.
- A later reviewer loop found additional public-contract gaps in machine-IR legality and terminator shaping. The structural verifier now validates opcode operand kinds, register classes, register/type compatibility, and duplicate instruction IDs even for deserialized object-literal machine IR that bypassed constructors. Vector helper/scalar fallback policy paths now fail closed instead of emitting illegal vector `add-immediate` copies. Terminator lowering uses a larger deterministic ID stride, records branch/switch policy decisions, preserves symbolic `jumpTablePlan` records on machine functions, and lowers dense switches through a PIC-safe indexed jump-table path using symbolic table operands plus `br`. Semantic plugin dispatch is cached on lowering state during operation-matrix verification so operation support and semantic superselection share one plugin dispatch while preserving dispatch diagnostics.
- The final review loop also tightened constant-time and opcode-form boundaries. The security verifier now checks terminators as well as block instructions and rejects secret-dependent `cbz`/`cbnz`/`tbz`/conditional/indirect branch forms. Register-form opcode catalog entries require virtual-register operands, immediate forms require immediate operands, and the jump-table byte-scale operation uses an explicit `lsl-immediate` form instead of overloading register-register `lsl`. Unused vector fallback plumbing was removed from operation materialization.
- A fresh independent review then found four remaining acceptance gaps. Operation-subject security facts now propagate to result virtual registers, so public lowering rejects branches on results of secret/constant-time operations as well as value-labeled operands. OptIR edge arguments now lower through deterministic edge-copy machine blocks, with real virtual-register block parameters and temporary-backed parallel copies for cyclic assignments. Call materialization now marshals AAPCS64 register and stack arguments before `bl`/`blr`, records register ABI arguments as explicit call uses, and the dependency graph orders memory-effecting stack argument stores before calls. Move-wide constant planning is shared and selects minimal `movz`/`movn`/`movk` sequences for both helper and public operation materialization.
- The subsequent independent review found three remaining production-quality gaps. Aggregate operations no longer use unsafe copy-first placeholder lowering; they fail closed until authenticated scalarization or layout facts identify a correct representation. Layout offset/range operations now consume authenticated layout byte-range facts and otherwise produce deterministic handoff errors instead of emitting `base + 0`. Public memory lowering now uses AArch64 addressing selection for legal unsigned immediate offsets, tightens scaled-offset legality, preserves pair-load/store planning through optional pair offsets, and leaves bitfield lowering fact-gated until bit position/width facts exist. The input-contract stage now owns deterministic operation-table and CFG-shape validation before machine IR materialization begins.
- The latest independent review found four more hardening issues. Specialized opcode forms now constrain `pmull`, `aes-sha-round`, `dotprod`, `cset`, and `prfm` operand classes precisely, and semantic three-register materialization reports deterministic register-class diagnostics instead of throwing on invalid scalar/vector combinations. Classifier table superselection now derives secret-index and constant-time-table authorization from security facts. Sequentially-consistent non-LSE stores lower as `stlr; dmb`, with verifier checks for seq-cst load/store barrier shape. Fact preservation rejects machine facts whose lineage cites explicitly dropped OptIR facts even if the fact ID is otherwise present in the preserved-fact allowlist.
- A follow-up independent review found four final polish gaps. Call-result materialization now reuses the shared copy helper so vector-returning calls lower through `mov-vector` instead of hitting GPR-only `add-immediate`, with unsupported result classes producing deterministic diagnostics. Public machine functions now carry typed relocation references, and direct `bl` calls record `CALL26` relocation references using the authenticated relocation target fingerprint. Operation-matrix construction no longer throws during module import; the verification stage owns future missing-kind diagnostics. The pre-RA scheduler tracks scheduled instruction IDs in a `Set` while preserving deterministic order, avoiding avoidable repeated linear scans on large effect islands.
- A subsequent fresh review found three remaining correctness gaps. Aggregate operations are no longer advertised as unconditionally required in the public operation matrix; they now have an explicit unsupported-until-layout-lowering status, public support-contract generation rejects them deterministically, and direct helper materialization still reports aggregate-specific fail-closed diagnostics. The machine-IR interpreter now starts from the block marked `frequency.kind === "entry"`, binds debug inputs by ABI parameter value keys when parameters exist, and treats `br` as an indirect branch to the block id held in its operand register instead of a synthetic return.
- The next fresh review found two public-path bugs. Ordered vector memory operations now fail closed with deterministic diagnostics instead of trying to construct scalar acquire/release opcodes with vector operands. AAPCS64 stack argument assignment now walks argument classes and records byte offsets; vector128 overflow arguments use 16-byte slots, outgoing and incoming argument frame areas are sized from byte ranges, and the ABI verifier rejects malformed, overlapping, or under-covered stack argument ranges.
- A follow-up fresh review found two remaining input-validation gaps. Opcode schemas now carry explicit immediate domains for condition codes, test-bit indexes, move-wide shifts, page offsets, unsigned memory offsets, and signed pair offsets, with builder and structural-verifier checks covering object-literal machine IR that bypasses constructors. Public array operation input now preserves duplicate operation IDs before map normalization and reports deterministic input-contract diagnostics instead of silently keeping the last duplicate entry.
- Another fresh review found three final verifier/selection gaps. Classifier semantic selection now carries secret-index and constant-time authorization per operation, so one classifier's authorization cannot bless another classifier's secret table index. Call-result copies from synthetic ABI-return registers now receive required call dependency edges, and the scheduler verifier rejects persisted schedules that move those copies before their `bl`/`blr`. The structural verifier reuses the machine-instruction logical-immediate predicate, so deserialized logical-immediate forms reject unencodable values such as zero just like constructed instructions.
- The next independent pass found three remaining machine-legality and policy-enforcement gaps. Ordered scalar memory accesses now materialize effective addresses before `ldar`/`stlr`, and those opcodes are base-only in the catalog. Conditional branches require explicit condition-code operands, and unsigned memory offsets are validated against the accessed value's byte scale instead of a broad vector-sized maximum. The out-of-profile/errata stage now scans emitted machine IR, rejects forbidden production-profile instruction families with deterministic diagnostics, applies declared errata substitutions, and records errata schedule constraints on matching instructions.
- The latest fresh reviewer found three final machine-shape and selector gaps. PIC symbol-address materialization now uses `adrp` plus `add-pageoff` before dereferencing jump-table entries or platform-call pointer slots, and both paths record page plus pageoff relocation metadata. The exported local scalar selector now shares the canonical integer-binary opcode policy with operation materialization, so multiply/divide select `mul`/`udiv`/`sdiv` instead of drifting to add. Conditional data-processing forms now carry explicit condition operands: `csel` requires a condition immediate, `ccmp` requires both fallback NZCV and condition immediates, and the interpreter models conditional compare fallback instead of comparing unconditionally.
- A final verifier pass found that object-literal machine IR could still bypass constructor address-operand checks. The structural verifier now rejects malformed `memoryBase` and `memoryIndex` operands unless they are virtual registers or frame objects, matching machine-instruction construction for deserialized IR.
- Another fresh reviewer found an AAPCS64 mixed-argument placement bug. ABI assignment now maintains independent integer and vector register-bank ordinals, shares one aligned stack overflow area after each bank is exhausted, and call opcode schemas allow the full 8 GPR plus 8 vector register argument uses required by mixed AAPCS64 calls.
- A fresh signoff pass found malformed OptIR operations could still reach AArch64 materialization when operation result/source arity was inconsistent with the operation kind. The shared OptIR operation-schema verifier now validates concrete runtime operand/result shape, and the AArch64 input-contract stage runs OptIR verification plus AArch64 materializer source-minimum checks before any machine IR emission.
- The latest reviewer loop found four final public-contract gaps. Region memory-type decisions now derive from optimization-region kind when explicit region-memory-type facts are absent, so `imageDevice` accesses fail closed through device/MMIO ordering instead of defaulting to ordinary cacheable memory. Legal 64-bit vector constants now lower through `movi` because the opcode schema accepts both vector64 and vector128 defs. Stack and derived validated-payload accesses preserve frame-object memory bases where the opcode form supports them, declare matching `regionBacked` frame objects, and use a typed `frame-address` pseudo only for base-only ordered forms that must materialize an effective address. Classifier semantic selection now applies secret-index/constant-time authorization per concrete operation even when legacy top-level plugin flags indicate an unauthorized secret index. While preserving frame bases through validated-payload derived regions, pair-load/store planning was also tightened to require matching vreg or frame-object bases before forming `ldp`/`stp`.
- A scheduler review found that terminators could be scheduled before earlier side-effecting instructions when the terminator instruction ID sorted first. The machine dependency graph now emits explicit `control` edges from preceding block instructions to each terminator, and the pre-RA scheduler regression covers a low-ID `ret` after a high-ID store.
- The code-quality review decomposed the largest terminator lowering surface into focused modules for terminator dispatch, switch/jump-table lowering, edge-copy lowering, shared terminator instruction helpers, and materialization contract helpers. The public behavior is unchanged, but block-shell lowering is now orchestration-only and pure materialization validation helpers have a dedicated module. A split-induced propagation gap was fixed at the same time: branch and switch terminators now publish temporary virtual registers created by edge-copy blocks, including jump-table case/default edge arguments.
- A fresh signoff review found two structural-verifier correctness gaps. The verifier no longer treats numeric block order as control-flow definition order: same-block use-before-def still fails, but cross-block definitions are considered independently of machine-function block sorting so valid entry blocks with higher IDs can feed lower-ID successors. The structural verifier and opcode catalog also now reject deserialized branch-target operands unless the operand value is a machine block.

## Parallelization Map

This map is the execution contract. A same-wave task must not edit the same production file as another same-wave task unless that file is explicitly marked append-only in the shared-file protocol below.

- **Wave 0, serial foundation:** Tasks 0, 1, 2, 2A, 2B, 3, 3A, 4, 5, and 6 land in order. This front of the project is intentionally not parallel: it creates the policy gate, metadata records, fixtures, instruction records, interpreter seed, containers, structural verifier, and target surface that every other lane depends on.
- **Wave 1, upstream fact lanes:** Task 6A lands first and owns the shared proof-check extension envelope, the target-neutral OptIR fact extension substrate, and the AArch64 adapter slot under `src/target/aarch64/facts`. After 6A, Tasks 7, 8, 9A, 9C, and 9D can run in parallel because each owns a separate target-neutral fact-family module and appends one AArch64 adapter record through the protocol below. Task 9B runs after 9A because both append to the shared OptIR operation vocabulary files.
- **Wave 2, API and matrix:** Task 10 lands after Wave 1 and creates the lowering-stage seam and default pipeline slots. Task 17 lands after the semantic operation families from Wave 1 and folds the operation matrix into the already-authenticated target profile through the Task 6A registry hook.
- **Wave 3, lowering modules:** After Task 10, Tasks 11, 12, 13, and 15 can run in parallel because they own separate stage or selector modules. Task 12A runs after 11 and 12. Task 14 runs after 11, 12, 12A, and 13. Task 16 runs after 15. Each task wires through its owned stage descriptor rather than editing `lower-program.ts`.
- **Wave 4, cross-cutting selection safety:** Task 16A lands after Tasks 9C, 15, and 16. It owns secret/security label propagation so later selection, planning, and verification tasks consume one shared invariant instead of re-implementing it.
- **Wave 5, selection lanes:** Task 18 lands after Tasks 15 and 17. After 18, Tasks 19, 20, and 21A can run in parallel. Task 21B runs after 21A, and Task 22 runs after 21A/21B. Task 23A lands after 18 and supplies the semantic plugin dispatch seam; Tasks 23B-23H then run by semantic family as soon as their individual dependencies are present.
- **Wave 6, planning lanes:** Task 24 lands after Tasks 7, 8, 9C, 16A, 20, and 22. Tasks 25 and 26 can run in parallel after 24 because they own separate planner modules and consume the dependency graph.
- **Wave 7, fact preservation and verifiers:** Task 27 lands after planning metadata exists. Tasks 28A-28H can then run in parallel by verifier family because Task 5 already created stable verifier descriptor slots; each verifier task replaces only its owned descriptor module, except where an individual verifier names a stricter dependency.
- **Wave 8, completion:** Task 29 extends the early interpreter to every production opcode family after Tasks 3A, 13, 15, 16, 19, 20, 21A, 21B, and 28E. Task 30 adds explanations and dumps after selection/planning/fact preservation exists. Task 31 only verifies exports and end-to-end composition; it must not be the first place production stages are wired.

## Executor Protocol

Every task is intended to be picked up by one worker after its dependencies have landed.

- [ ] Read the task description, dependencies, owned files, acceptance criteria, code examples, and verification commands.
- [ ] Confirm dependency tasks are complete.
- [ ] Confirm no other same-wave task owns the same production file.
- [ ] Write the failing tests first in the task-owned test files.
- [ ] Run the narrow verification command and confirm the new tests fail for the expected missing symbol or missing behavior.
- [ ] Implement only the files listed by the task.
- [ ] Use fakes through dependency injection. Do not use mocks or spies.
- [ ] Keep filesystem and Bun access outside runtime source.
- [ ] Run the narrow verification command again and confirm it passes.
- [ ] Run adjacent tests listed by the task.
- [ ] Commit only this task's files. Commits created by automation must end with `-Codex Automated`.

Example commit command for every task:

```bash
git add <task-owned-files>
git commit -m "feat: add aarch64 mir <task topic> -Codex Automated"
```

## File Structure

The implementation should create or modify these files. Each task below owns a subset.

```text
src/
  index.ts                                           # Task 31 export verification only
  target/
    index.ts                                         # Task 31 export verification only
    aarch64/
      index.ts                                       # Task 31
      public-api.ts                                  # Task 10 creates; Task 31 export verification only
      machine-ir/
        ids.ts                                       # Task 1
        deterministic-ids.ts                         # Task 1
        diagnostics.ts                               # Task 1
        provenance.ts                                # Task 1
        machine-types.ts                             # Task 2
        virtual-register.ts                          # Task 2
        resources.ts                                 # Task 2
        operands.ts                                  # Task 2
        opcode-catalog.ts                            # Task 3
        machine-instruction.ts                       # Task 3
        memory-order.ts                              # Task 2A creates; Task 20 extends
        schedule.ts                                  # Task 2A creates; Task 24, Task 26 extend
        rematerialization.ts                         # Task 2A creates; Task 13, Task 25 extend
        security.ts                                  # Task 2A creates; Task 16A, Task 28H extend
        frame-object.ts                              # Task 4
        abi-location.ts                              # Task 4, Task 11
        symbol-reference.ts                          # Task 4
        relocation-reference.ts                      # Task 4
        machine-program.ts                           # Task 4
        machine-function.ts                          # Task 4
        machine-block.ts                             # Task 4
        fact-set.ts                                  # Task 27
      target-surface/
        target-surface.ts                            # Task 6
        production-profile.ts                        # Task 6
        profile-authentication.ts                    # Task 6
        errata-catalog.ts                            # Task 6, Task 22
        operation-matrix.ts                          # Task 17
      lower/
        lower-program.ts                             # Task 10 creates and owns orchestration
        pipeline-stages.ts                           # Task 10 creates shared stage interface
        default-pipeline.ts                          # Task 10 creates stable stage slots
        stages/
          authenticate-target.ts                     # Task 10
          verify-input-contract.ts                   # Task 10
          verify-operation-matrix.ts                 # Task 10 placeholder; Task 17 implements
          lower-function-shells.ts                   # Task 10
          lower-abi.ts                               # Task 10 placeholder; Task 11 implements
          lower-regions.ts                           # Task 10 placeholder; Task 12 implements
          lower-uefi-image-context.ts                # Task 10 placeholder; Task 12A implements
          materialize-constants.ts                   # Task 10 placeholder; Task 13 implements
          lower-calls.ts                             # Task 10 placeholder; Task 14 implements
          select-local-scalar.ts                     # Task 10 placeholder; Task 15 implements
          lower-terminators.ts                       # Task 10 placeholder; Task 16 implements
          propagate-security-labels.ts               # Task 10 placeholder; Task 16A implements
          tile-selection-candidates.ts               # Task 10 placeholder; Task 18 implements
          select-smart-memory-and-endian.ts          # Task 10 placeholder; Task 19 implements
          lower-memory-order.ts                      # Task 10 placeholder; Task 20 implements
          select-vectors.ts                          # Task 10 placeholder; Task 21A implements
          select-fp-numeric.ts                       # Task 10 placeholder; Task 21B implements
          apply-out-of-profile-and-errata.ts         # Task 10 placeholder; Task 22 implements
          semantic-superselection.ts                 # Task 10 placeholder; Task 23A implements
          build-dependency-graph.ts                  # Task 10 placeholder; Task 24 implements
          post-selection-cse-and-remat.ts            # Task 10 placeholder; Task 25 implements
          plan-pairs-prefetch-barriers-schedule.ts   # Task 10 placeholder; Task 26 implements
          preserve-machine-facts.ts                  # Task 10 placeholder; Task 27 implements
          verify-machine-ir.ts                       # Task 10 placeholder; Tasks 28A-28H implement through verifier suite
          build-debug-output.ts                      # Task 10 placeholder; Task 30 implements
        lower-function.ts                            # Task 10
        lower-block.ts                               # Task 10
        lowering-context.ts                          # Task 10
        abi-lowering.ts                              # Task 10 placeholder; Task 11 implements
        region-lowering.ts                           # Task 10 placeholder; Task 12 implements
        uefi-image-lowering.ts                       # Task 10 placeholder; Task 12A implements
        constant-materialization.ts                  # Task 10 placeholder; Task 13 implements
        call-lowering.ts                             # Task 10 placeholder; Task 14 implements
        terminator-lowering.ts                       # Task 10 placeholder; Task 16 implements
        branch-switch-profitability.ts               # Task 16
        security-label-lowering.ts                   # Task 16A
        fact-preservation.ts                         # Task 27
        provenance-builder.ts                        # Task 30
      select/
        selection-context.ts                         # Task 15
        selection-policy.ts                          # Task 15, Task 18
        pattern-catalog.ts                           # Task 18
        pattern-tiler.ts                             # Task 18
        local-selector.ts                            # Task 15
        scalar-selection.ts                          # Task 15
        addressing-selection.ts                      # Task 19
        bitfield-selection.ts                        # Task 19
        memory-selection.ts                          # Task 19
        endian-selection.ts                          # Task 19
        compare-select-selection.ts                  # Task 16
        memory-order-selection.ts                    # Task 20
        vector-selection.ts                          # Task 21A
        fp-selection.ts                              # Task 21B
        semantic-superselector.ts                    # Task 23A
        packet-superpatterns.ts                      # Task 23B
        virtio-ring-selection.ts                     # Task 23C
        checksum-fingerprint-selection.ts            # Task 23D
        polynomial-pmull-selection.ts                # Task 23E
        crypto-mix-selection.ts                      # Task 23F
        classifier-selection.ts                      # Task 23G
        tail-proof-selection.ts                      # Task 23H
      plan/
        machine-planning-state.ts                    # Task 24
        required-constraints.ts                      # Task 24
        machine-dependency-graph.ts                  # Task 24
        post-selection-cse.ts                        # Task 25
        adrp-page-base-cse.ts                        # Task 25
        literal-pool-planning.ts                     # Task 25
        rematerialization-marking.ts                 # Task 25
        pair-load-store-planning.ts                  # Task 26
        prefetch-planning.ts                         # Task 26
        barrier-placement.ts                         # Task 26
        pre-ra-scheduler.ts                          # Task 26
      facts/
        aarch64-fact-adapter.ts                      # Task 6A creates; fact-family tasks append target adapters
        aarch64-fact-query.ts                        # Task 6A creates; target-specific query namespaces only
        aarch64-fact-rekeying.ts                     # Task 6A creates; Task 27 consumes for machine facts
      verify/
        verifier-suite.ts                            # Task 5 creates stable descriptor interface
        default-verifier-suite.ts                    # Task 5 creates stable descriptor slots
        machine-ir-verifier.ts                       # Task 5 creates root suite runner only
        structural-verifier.ts                       # Task 5
        abi-verifier.ts                              # Task 5 placeholder; Task 28A implements descriptor
        region-verifier.ts                           # Task 5 placeholder; Task 28B implements descriptor
        fact-preservation-verifier.ts                # Task 5 placeholder; Task 28C implements descriptor
        tiling-verifier.ts                           # Task 5 placeholder; Task 18 and Task 28D implement descriptor
        superselection-verifier.ts                   # Task 5 placeholder; Task 28D implements descriptor
        nzcv-verifier.ts                             # Task 5 creates; Task 28F consumes
        memory-order-verifier.ts                     # Task 5 placeholder; Task 28E implements descriptor
        scheduler-verifier.ts                        # Task 5 placeholder; Task 28F implements descriptor
        fp-environment-verifier.ts                   # Task 5 placeholder; Task 28G implements descriptor
        security-verifier.ts                         # Task 5 placeholder; Task 28H implements descriptor
      interpreter/
        machine-ir-interpreter.ts                    # Task 3A creates; Task 29 extends
        machine-memory-state.ts                      # Task 3A creates; Task 29 extends
        machine-effect-state.ts                      # Task 3A creates; Task 29 extends
        machine-ir-differential.ts                   # Task 3A creates; Task 29 extends
      debug/
        explanation.ts                               # Task 30
        deterministic-dump.ts                        # Task 30
  opt-ir/
    operation-kinds.ts                               # Task 9A, Task 9B shared sequential append
    operations.ts                                    # Task 9A, Task 9B shared sequential append
    operation-schema.ts                              # Task 9A, Task 9B shared sequential append
    operation-schema-core.ts                         # Task 9A
    operation-schema-effectful.ts                    # Task 9B
    operation-semantics.ts                           # Task 9A, Task 9B shared sequential append
    operation-effects.ts                             # Task 9A, Task 9B shared sequential append
    facts/
      fact-extension-registry.ts                     # Task 6A target-neutral extension substrate
      fact-import-schema.ts                          # Task 6A registry hook only
      fact-index.ts                                  # Task 6A registry hook only
      fact-query.ts                                  # Task 6A registry hook only
      memory-order-facts.ts                          # Task 7
      branch-facts.ts                                # Task 8
      fp-numeric-facts.ts                            # Task 9B
      security-facts.ts                              # Task 9C
      vector-state-facts.ts                          # Task 9D
      call-clobber-facts.ts                          # Task 9D
      semantic-operation-facts.ts                    # Task 9A
      footprint-facts.ts                             # Task 8
  proof-check/
    model/
      fact-packet.ts                                 # Task 6A extends closed packet kinds
    validation/
      packet-validator.ts                            # Task 6A validates new packet families
tests/
  support/
    target/aarch64/
      machine-ir/builders.ts                         # Task 2B creates machine IR builders
      machine-ir/metadata-builders.ts                # Task 2B creates metadata builders
      facts/opt-ir-facts.ts                          # Task 2B creates fact fixtures
      facts/aarch64-fact-adapters.ts                 # Task 6A creates target fact adapter fixtures
      selection/optimized-opt-ir-fixtures.ts         # Task 2B creates OptIR selection fixtures
      selection/selection-builders.ts                # Task 15 creates selection fixtures
      planning/planning-fixtures.ts                  # Task 24 creates planning fixtures
      target-surface/fakes.ts                        # Task 6 creates
      interpreter/machine-ir-interpreter-fixtures.ts # Task 3A creates; Task 29 extends
  unit/
    target/aarch64/
      *.test.ts
  integration/
    target/aarch64/
      *.test.ts
```

## Shared File Ownership Protocol

These files are intentionally shared. A task may edit them only under the rule listed here.

| File                                                                                                                                                                  | Owner                            | Allowed later edits                                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/opt-ir/facts/fact-import-schema.ts`                                                                                                                              | Task 6A                          | No direct family-specific edits. It dispatches to the target-neutral `fact-extension-registry.ts`; it must not import `src/target/aarch64`.      |
| `src/opt-ir/facts/fact-index.ts`                                                                                                                                      | Task 6A                          | No direct family-specific edits. It indexes target-neutral records returned by registered extensions; it must not contain AArch64 feature logic. |
| `src/opt-ir/facts/fact-query.ts`                                                                                                                                      | Task 6A                          | No direct family-specific edits. It exposes only target-neutral extension lookup helpers, not target-specific query namespaces.                  |
| `src/opt-ir/facts/fact-extension-registry.ts`                                                                                                                         | Task 6A                          | Target-neutral extension substrate only. It owns packet/import/index hooks and must not expose machine re-keying or AArch64 query behavior.      |
| `src/target/aarch64/facts/aarch64-fact-adapter.ts`                                                                                                                    | Task 6A                          | Append one `registerAArch64FactAdapter(...)` call per fact-family task, keeping the list sorted by adapter key.                                  |
| `src/target/aarch64/verify/machine-ir-verifier.ts`                                                                                                                    | Task 5                           | Root suite runner only. Later verifier tasks must not edit this file; they implement their owned descriptor module.                              |
| `src/target/aarch64/verify/default-verifier-suite.ts`                                                                                                                 | Task 5                           | Stable descriptor slot imports only. Later verifier tasks must not edit this file unless the verifier-key tuple itself changes.                  |
| `src/opt-ir/operation-kinds.ts`, `src/opt-ir/operations.ts`, `src/opt-ir/operation-schema.ts`, `src/opt-ir/operation-semantics.ts`, `src/opt-ir/operation-effects.ts` | Tasks 9A and 9B                  | Task 9A lands semantic non-FP operation families first; Task 9B appends FP/vector numeric families second. No parallel edits to these files.     |
| `tests/support/target/aarch64/machine-ir/builders.ts`                                                                                                                 | Task 2B                          | Shared core machine builders only. Later tasks add domain-specific builders in their own support subdirectory instead of appending here.         |
| `tests/support/target/aarch64/machine-ir/metadata-builders.ts`                                                                                                        | Task 2B                          | Shared metadata builders only. Later tasks add domain-specific builders in their own support subdirectory instead of appending here.             |
| `tests/support/target/aarch64/selection/optimized-opt-ir-fixtures.ts`                                                                                                 | Task 2B                          | Shared minimal OptIR fixtures only. Later selection tasks add fixtures in `selection/selection-builders.ts` or task-specific support files.      |
| `tests/integration/target/aarch64/*.test.ts`                                                                                                                          | First task that creates the file | Later tasks extend with new `describe(...)` blocks named after their task and must not replace earlier cases.                                    |

If a task needs a non-append edit to a shared file, it is not same-wave parallelizable and must either be split or explicitly re-ordered in the Parallelization Map before execution.

## Pipeline Wiring Protocol

Task 10 owns `lower-program.ts`, `pipeline-stages.ts`, and `default-pipeline.ts`. It creates stable ordered stage slots with unsupported-stage placeholders. Later tasks must not edit `lower-program.ts`; they replace only their owned stage implementation file or export a stage descriptor from their owned module.

`defaultAArch64LoweringPipeline` must be mechanically derived from `AARCH64_LOWERING_STAGE_KEYS`. Task 10 must include an exact-order unit test that asserts `defaultAArch64LoweringPipeline.map((stage) => stage.stageKey)` equals `AARCH64_LOWERING_STAGE_KEYS`. Hand-written subsets of the stage list are not allowed.

Stage descriptors live in `src/target/aarch64/lower/stages/<stage-key>.ts`. Task 10 creates one placeholder file for every key in `AARCH64_LOWERING_STAGE_KEYS`; the default pipeline imports those fixed slot modules and maps the canonical key tuple to descriptors. A later task that implements a stage modifies only its slot file plus its domain implementation files. It must not edit `default-pipeline.ts` or another stage's slot file.

Each production stage task must include a narrow integration test that runs the default pipeline far enough to exercise its stage slot and proves the stage-specific unsupported diagnostic is gone. For selector and planner tasks that are not one-to-one lowering stages, the test may use `buildAArch64LoweringPipelineForTest({ stageOverrides })` from Task 10 to insert the owned stage descriptor at its declared slot, then assert the default slot key and stage output.

Required stage slot keys:

```ts
export const AARCH64_LOWERING_STAGE_KEYS = [
  "authenticate-target",
  "verify-input-contract",
  "verify-operation-matrix",
  "lower-function-shells",
  "lower-abi",
  "lower-regions",
  "lower-uefi-image-context",
  "materialize-constants",
  "lower-calls",
  "select-local-scalar",
  "lower-terminators",
  "propagate-security-labels",
  "tile-selection-candidates",
  "select-smart-memory-and-endian",
  "lower-memory-order",
  "select-vectors",
  "select-fp-numeric",
  "apply-out-of-profile-and-errata",
  "semantic-superselection",
  "build-dependency-graph",
  "post-selection-cse-and-remat",
  "plan-pairs-prefetch-barriers-schedule",
  "preserve-machine-facts",
  "verify-machine-ir",
  "build-debug-output",
] as const;
```

## Verifier Suite Protocol

Task 5 owns `machine-ir-verifier.ts`, `verifier-suite.ts`, and `default-verifier-suite.ts`. It creates the root verifier runner and a stable ordered descriptor slot for every verifier family. Later verifier tasks must not edit `machine-ir-verifier.ts` or `default-verifier-suite.ts`; they replace only their owned verifier module's placeholder descriptor.

Each verifier-family task must export an `AArch64MachineVerifierDescriptor` with the key assigned in `AARCH64_MACHINE_VERIFIER_KEYS`, must include a narrow unit test for the family, and must include an integration assertion that `verifyAArch64MachineProgram` reports the family diagnostic through the default suite. The root suite runner is allowed to sort and aggregate diagnostics only.

## Task 0: AArch64 Target Boundary Policy

**Depends on:** none

**Description:** Add policy checks that protect the new AArch64 lowering boundary from filesystem access, Bun APIs, host-state probes, OptIR pass internals, encoder/linker imports, and register-allocator internals. This lets all later tasks fail fast when they violate the design's dependency boundary.

**Files:**

- Modify: `scripts/check-policy.ts`
- Test: `tests/unit/target/aarch64/policy-boundary.test.ts`

**Acceptance Criteria:**

- `scripts/check-policy.ts` rejects imports from `src/target/aarch64/**` to filesystem modules, Bun runtime APIs, `src/opt-ir/passes/**`, encoder/linker/object-writer paths, and register allocator paths.
- The check allows imports from public `src/opt-ir` modules, `src/shared`, and `src/target/aarch64/**`.
- The policy test covers one accepted import list and at least four rejected import lists.
- Runtime code is not created by this task.

**Code Examples:**

```ts
test("aarch64 lowering policy rejects host state and opt-ir pass internals", () => {
  expect(
    checkImportPolicyForTest({
      importer: "src/target/aarch64/lower/lower-program.ts",
      imported: "node:fs",
    }),
  ).toEqual(["AARCH64_TARGET_HOST_STATE_IMPORT"]);
  expect(
    checkImportPolicyForTest({
      importer: "src/target/aarch64/select/local-selector.ts",
      imported: "../../opt-ir/passes/pipeline-state",
    }),
  ).toEqual(["AARCH64_TARGET_OPT_IR_PASS_INTERNAL_IMPORT"]);
});
```

```ts
const AARCH64_TARGET_ALLOWED_IMPORTS = [
  "src/opt-ir/index.ts",
  "src/opt-ir/program.ts",
  "src/opt-ir/facts/fact-index.ts",
  "src/shared/deterministic-sort.ts",
  "src/target/aarch64/machine-ir/machine-program.ts",
] as const;
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/policy-boundary.test.ts
PATH="$HOME/.bun/bin:$PATH" bun run policy:check
```

## Task 1: Machine IR IDs, Diagnostics, And Provenance

**Depends on:** Task 0

**Description:** Create branded IDs, deterministic allocation helpers, AArch64 diagnostic records, diagnostic sorting, and provenance records. These are the primitive records every later module imports.

**Files:**

- Create: `src/target/aarch64/machine-ir/ids.ts`
- Create: `src/target/aarch64/machine-ir/deterministic-ids.ts`
- Create: `src/target/aarch64/machine-ir/diagnostics.ts`
- Create: `src/target/aarch64/machine-ir/provenance.ts`
- Create: `tests/unit/target/aarch64/ids-diagnostics-provenance.test.ts`

**Acceptance Criteria:**

- ID constructors reject negative, non-integer, and empty-string inputs.
- Deterministic allocators produce dense IDs in stable sorted OptIR input order.
- Diagnostic codes are allowlisted and unknown codes throw.
- Diagnostic ordering is stable across owner/root/detail permutations.
- Provenance records can cite source, HIR, mono, Proof MIR, checked MIR, layout, OptIR, target surface, synthetic lowering, selected pattern, and machine-planning origins.
- Every returned array or record that should be immutable is frozen.

**Code Examples:**

```ts
export type AArch64MachineFunctionId = number & {
  readonly __brand: "AArch64MachineFunctionId";
};
export type AArch64VirtualRegisterId = number & {
  readonly __brand: "AArch64VirtualRegisterId";
};
export type AArch64PatternId = string & {
  readonly __brand: "AArch64PatternId";
};
```

```ts
test("diagnostics sort by deterministic order keys", () => {
  const diagnostics = sortAArch64Diagnostics([
    aarch64DiagnosticForTest({ code: "AARCH64_PROFILE_REJECTED", stableDetail: "b" }),
    aarch64DiagnosticForTest({ code: "AARCH64_PROFILE_REJECTED", stableDetail: "a" }),
  ]);

  expect(diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual(["a", "b"]);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/ids-diagnostics-provenance.test.ts
```

## Task 2: Machine Types, Resources, Virtual Registers, And Operands

**Depends on:** Task 1

**Description:** Define target-owned machine types, register classes, virtual-register records, singleton and platform resources, typed operands, operand roles, and builders that freeze records. This task owns value modeling only, not instructions or programs.

**Files:**

- Create: `src/target/aarch64/machine-ir/machine-types.ts`
- Create: `src/target/aarch64/machine-ir/virtual-register.ts`
- Create: `src/target/aarch64/machine-ir/resources.ts`
- Create: `src/target/aarch64/machine-ir/operands.ts`
- Create: `tests/unit/target/aarch64/machine-types-operands.test.ts`

**Acceptance Criteria:**

- Register classes include `gpr32`, `gpr64`, `fpScalar`, `vector64`, and `vector128`.
- Machine scalar types include integer, pointer, float, token, and resource token shapes from the design.
- Machine vector types carry lane count and lane type, and reject non-positive lane counts.
- Resources include `NZCV`, `vectorState`, `FPCR`, `FPSR`, `SP`, and platform keyed resources.
- Operand roles include `def`, `use`, `tiedDefUse`, `implicitDef`, `implicitUse`, `memoryBase`, `memoryIndex`, and `branchTarget`.
- Virtual registers carry ID, register class, machine type, optional security labels, and optional origin.
- Operand builders reject mismatched register class and machine type combinations such as `gpr32` for a 64-bit pointer.

**Code Examples:**

```ts
test("NZCV is modeled as an implicit resource operand", () => {
  const operand = aarch64InstructionOperand({
    role: "implicitDef",
    operand: { role: "resource", resource: { kind: "NZCV" } },
    type: aarch64TokenMachineType("nzcv"),
  });

  expect(operand).toMatchObject({
    role: "implicitDef",
    operand: { role: "resource", resource: { kind: "NZCV" } },
    type: { kind: "token", token: "nzcv" },
  });
});
```

```ts
const packetPointer = aarch64VirtualRegister({
  vreg: aarch64VirtualRegisterId(1),
  registerClass: "gpr64",
  type: { kind: "pointer", addressSpace: "packet-source" },
  origin: { kind: "optIrValue", valueId: optIrValueId(7) },
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/machine-types-operands.test.ts
```

## Task 2A: Machine Metadata Records

**Depends on:** Task 2

**Description:** Create the metadata record files that instruction and program records need before any later task can compile: memory ordering, scheduling metadata, rematerialization metadata, and security metadata. This task defines initial data shapes only; later tasks extend behavior.

**Files:**

- Create: `src/target/aarch64/machine-ir/memory-order.ts`
- Create: `src/target/aarch64/machine-ir/schedule.ts`
- Create: `src/target/aarch64/machine-ir/rematerialization.ts`
- Create: `src/target/aarch64/machine-ir/security.ts`
- Create: `tests/unit/target/aarch64/machine-metadata-records.test.ts`

**Acceptance Criteria:**

- `AArch64MemoryOrder`, `AArch64RegionMemoryType`, barrier-domain, atomicity, and memory operand footprint records exist.
- `AArch64ScheduleMetadata` records issue class, latency class, motion boundary, pairability, pressure estimate, and optional errata constraints.
- `AArch64RematerializationRecord` records producer kind, cost, required facts, required symbols, relocation references, and implicit resources.
- `AArch64SecurityMetadata` records secret, constant-time, key-lifetime, no-spill, wipe-on-spill, and zeroization labels.
- Builders freeze nested arrays and reject impossible values such as negative latency, zero-width footprints, or empty security label keys.
- No lowering, selection, or scheduling behavior is implemented in this task.

**Code Examples:**

```ts
test("metadata builders freeze nested records", () => {
  const metadata = aarch64ScheduleMetadata({
    issueClass: "integer",
    latencyClass: "singleCycle",
    motion: { kind: "insideEffectIsland" },
    pairability: ["loadPairCandidate"],
    pressure: { gpr: 1, vector: 0 },
    errataConstraints: [],
  });

  expect(Object.isFrozen(metadata)).toBe(true);
  expect(Object.isFrozen(metadata.pairability)).toBe(true);
});
```

```ts
export interface AArch64SecurityMetadata {
  readonly labels: readonly AArch64SecurityLabel[];
  readonly constantTime: boolean;
  readonly spillPolicy: "ordinary" | "noSpill" | "wipeOnSpill";
  readonly zeroization?: AArch64ZeroizationPlan;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/machine-metadata-records.test.ts
```

## Task 2B: Domain-Split AArch64 Test Fixture Foundation

**Depends on:** Task 2A

**Description:** Create small domain-specific AArch64 test fixture foundations used by later tasks. This prevents every subagent from inventing incompatible `*ForTest` builders without creating two append-only support files that will grow across the whole project.

**Files:**

- Create: `tests/support/target/aarch64/machine-ir/builders.ts`
- Create: `tests/support/target/aarch64/machine-ir/metadata-builders.ts`
- Create: `tests/support/target/aarch64/facts/opt-ir-facts.ts`
- Create: `tests/support/target/aarch64/selection/optimized-opt-ir-fixtures.ts`
- Create: `tests/unit/target/aarch64/shared-fixtures.test.ts`

**Acceptance Criteria:**

- `machine-ir/builders.ts` exports minimal builders for IDs, vregs, operands, instructions, blocks, functions, programs, resources, frame objects, symbols, and relocations.
- `machine-ir/metadata-builders.ts` exports minimal memory metadata, schedule metadata, rematerialization metadata, and security metadata builders.
- `facts/opt-ir-facts.ts` exports empty fact-set fixtures and narrowly typed fact-record builders.
- `selection/optimized-opt-ir-fixtures.ts` exports empty program, one-function program, scalar operation, memory operation, call operation, and terminator fixtures.
- Fixture builders use real exported production builders and types where those exist; they do not duplicate production validation logic.
- Later tasks add new fixtures in domain files such as `selection/selection-builders.ts`, `planning/planning-fixtures.ts`, `facts/aarch64-fact-adapters.ts`, or task-owned support files; they do not append unrelated fixtures to the shared foundations.
- Tests prove builders create deterministic frozen records and do not require mocks/spies.

**Code Examples:**

```ts
test("machine fixture builds minimal verified function shape", () => {
  const func = machineFunctionForTest({
    functionId: aarch64MachineFunctionId(1),
    blocks: [machineBlockForTest({ blockId: aarch64MachineBlockId(0) })],
  });

  expect(func.blocks.map((block) => Number(block.blockId))).toEqual([0]);
  expect(Object.isFrozen(func.blocks)).toBe(true);
});
```

```ts
export function emptyOptimizedOptIrProgramForTest(): OptIrProgram {
  return optIrProgram({
    programId: optIrProgramId(0),
    targetId: targetIdForTest("wrela-uefi-aarch64-rpi5-v1"),
    functions: optIrFunctionTable([]),
    regions: optIrRegionTable([]),
    constants: optIrConstantTable([]),
    callGraph: { calls: [] },
    provenance: { originIds: [] },
  });
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/shared-fixtures.test.ts
```

## Task 3: Opcode Catalog And Instruction Records

**Depends on:** Tasks 2A, 2B

**Description:** Add the typed A64 opcode-form catalog and instruction record model. The catalog represents legal forms for the production profile; instruction records reference catalog entries rather than mnemonic strings.

**Files:**

- Create: `src/target/aarch64/machine-ir/opcode-catalog.ts`
- Create: `src/target/aarch64/machine-ir/machine-instruction.ts`
- Create: `tests/unit/target/aarch64/opcode-catalog.test.ts`
- Create: `tests/unit/target/aarch64/machine-instruction.test.ts`

**Acceptance Criteria:**

- Opcode forms cover the initial forms needed by later tests: `movz`, `movk`, `movn`, `add-immediate`, `add-shifted-register`, `sub-immediate`, `and-logical-immediate`, `orr-logical-immediate`, `cmp-shifted-register`, `csel`, `ccmp`, `cbz`, `tbz`, `ldr-unsigned-immediate`, `str-unsigned-immediate`, `ldp-signed-offset`, `stp-signed-offset`, `rev`, `rev16`, `rev32`, `adrp`, `add-pageoff`, `bl`, `blr`, `b`, `b-cond`, `ret`, `br`, `trap`, `dmb`, `dsb`, `ldar`, `stlr`, and representative LSE forms.
- Catalog entries declare operand roles, types, register classes, tied groups, immediate encodings, implicit resources, memory shape, required features, excluded errata, and interpreter semantic keys.
- Instruction builders validate operand count, operand roles, register classes, tied groups, implicit resources, immediate ranges, and memory descriptor presence.
- A malformed instruction is rejected at construction time or by the schema verifier in Task 5.

**Code Examples:**

```ts
test("cmp shifted register form declares NZCV as an implicit def", () => {
  const form = aarch64OpcodeFormById(aarch64OpcodeFormId("cmp-shifted-register"));

  expect(form.implicitResources).toEqual([{ role: "implicitDef", resource: { kind: "NZCV" } }]);
  expect(form.requiredFeatures).toEqual(["BASE_A64"]);
});
```

```ts
const compareInstruction = aarch64MachineInstruction({
  instructionId: aarch64MachineInstructionId(12),
  opcode: aarch64OpcodeFormId("cmp-shifted-register"),
  operands: [
    useVreg(left, aarch64IntMachineType(64)),
    useVreg(right, aarch64IntMachineType(64)),
    implicitDefResource({ kind: "NZCV" }),
  ],
  flags: aarch64InstructionFlags({ mayTrap: false }),
  origin: syntheticAArch64Origin("test:cmp"),
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/opcode-catalog.test.ts ./tests/unit/target/aarch64/machine-instruction.test.ts
```

## Task 3A: Core Machine IR Interpreter And Differential Harness Seed

**Depends on:** Task 3

**Description:** Create the merge/debug soundness lane early with enough interpreter and differential harness support for simple scalar, constant, branch, memory, and `NZCV` fixtures. Later opcode-family tasks extend this interpreter as they add forms.

**Files:**

- Create: `src/target/aarch64/interpreter/machine-ir-interpreter.ts`
- Create: `src/target/aarch64/interpreter/machine-memory-state.ts`
- Create: `src/target/aarch64/interpreter/machine-effect-state.ts`
- Create: `src/target/aarch64/interpreter/machine-ir-differential.ts`
- Create: `tests/support/target/aarch64/interpreter/machine-ir-interpreter-fixtures.ts`
- Create: `tests/unit/target/aarch64/machine-ir-interpreter-core.test.ts`
- Create: `tests/unit/target/aarch64/machine-ir-differential-core.test.ts`

**Acceptance Criteria:**

- Interpreter models virtual registers, integer values, memory bytes, effect tokens, traps, and `NZCV`.
- Initial opcode coverage includes `movz`, `movk`, `add-immediate`, `sub-immediate`, `cmp-shifted-register`, `csel`, `ldr-unsigned-immediate`, `str-unsigned-immediate`, `b`, `b-cond`, `ret`, and `trap`.
- Differential harness compares a closed OptIR fragment and a closed machine fragment over deterministic test inputs and reports `equivalent`, `mismatch`, or `unsupported`.
- Unsupported opcodes return deterministic debug-lane diagnostics; they do not block production lowering.
- Selection tasks that introduce new opcode families must add interpreter fixtures before claiming differential coverage for those patterns.

**Code Examples:**

```ts
test("core interpreter threads NZCV from cmp into conditional branch", () => {
  const result = runAArch64MachineIrInterpreter({
    function: functionWithCmpBranchForTest({ left: 3n, right: 5n, condition: "lo" }),
    inputs: [],
    maxSteps: 32,
  });

  expect(result).toMatchObject({
    kind: "returned",
    trace: ["cmp-shifted-register", "b-cond", "ret"],
  });
});
```

```ts
test("core differential harness reports scalar add equivalence", () => {
  const result = compareOptIrAndAArch64Fragment({
    optIr: optIrAddFragmentForTest(),
    machine: aarch64AddFragmentForTest(),
    inputs: [{ values: [1n, 2n] }],
    interpreterOptions: { maxSteps: 32 },
  });

  expect(result).toEqual({ kind: "equivalent", cases: 1 });
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/machine-ir-interpreter-core.test.ts ./tests/unit/target/aarch64/machine-ir-differential-core.test.ts
```

## Task 4: Program, Function, Block, Frame, Symbol, Relocation, And ABI Records

**Depends on:** Task 3A

**Description:** Define the container model for AArch64 machine programs, machine functions, machine blocks, frame objects, ABI locations, symbol references, relocation references, call-clobber records, literal-pool plan stubs, and schedule-plan stubs.

**Files:**

- Create: `src/target/aarch64/machine-ir/frame-object.ts`
- Create: `src/target/aarch64/machine-ir/abi-location.ts`
- Create: `src/target/aarch64/machine-ir/symbol-reference.ts`
- Create: `src/target/aarch64/machine-ir/relocation-reference.ts`
- Create: `src/target/aarch64/machine-ir/machine-program.ts`
- Create: `src/target/aarch64/machine-ir/machine-function.ts`
- Create: `src/target/aarch64/machine-ir/machine-block.ts`
- Create: `tests/unit/target/aarch64/machine-ir-model.test.ts`

**Acceptance Criteria:**

- `AArch64MachineProgram` owns functions, global symbols, entry symbol, target fingerprint, consulted sub-surface fingerprints, and provenance.
- `AArch64MachineFunction` owns symbol, virtual registers, parameters, returns, frame, blocks, call-clobber records, literal-pool plan, schedule plan, and provenance references.
- Blocks own virtual-register block parameters, frequency metadata, instructions, and one terminator.
- Frame objects include `incomingArg`, `outgoingArgArea`, `local`, and `regionBacked` kinds with size, alignment, region, mutability, and security metadata.
- ABI locations include integer registers, vector registers, indirect-result pointer, and stack arguments without assigning final stack offsets.
- Symbol and relocation records are symbolic and do not encode bytes.
- Table builders sort by ID and return frozen copies.

**Code Examples:**

```ts
test("machine function tables are deterministic and frozen", () => {
  const program = aarch64MachineProgram({
    programId: aarch64MachineProgramId(0),
    functions: [
      machineFunctionForTest({ functionId: aarch64MachineFunctionId(2) }),
      machineFunctionForTest({ functionId: aarch64MachineFunctionId(1) }),
    ],
    globalSymbols: [],
    entrySymbol: aarch64SymbolId("wrela.image.boot"),
    provenance: emptyAArch64ProvenanceMap(),
  });

  expect(program.functions.entries().map((func) => Number(func.functionId))).toEqual([1, 2]);
  expect(Object.isFrozen(program.functions.entries()[0])).toBe(true);
});
```

```ts
const call26Relocation = aarch64RelocationReference({
  kind: "CALL26",
  symbol: aarch64SymbolId("helper.memcpy"),
  addend: 0n,
  targetFingerprint: aarch64TargetFingerprint("reloc:fixture"),
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/machine-ir-model.test.ts
```

## Task 5: Machine IR Verifier Suite And Structural Verifiers

**Depends on:** Task 4

**Description:** Implement the stable production verifier suite runner, descriptor slot system, structural verifier family, and basic `NZCV` verifier. Later verifier tasks fill their owned descriptor module and must not repeatedly edit the root suite runner.

**Files:**

- Create: `src/target/aarch64/verify/verifier-suite.ts`
- Create: `src/target/aarch64/verify/default-verifier-suite.ts`
- Create: `src/target/aarch64/verify/machine-ir-verifier.ts`
- Create: `src/target/aarch64/verify/structural-verifier.ts`
- Create: `src/target/aarch64/verify/nzcv-verifier.ts`
- Create placeholder: `src/target/aarch64/verify/abi-verifier.ts`
- Create placeholder: `src/target/aarch64/verify/region-verifier.ts`
- Create placeholder: `src/target/aarch64/verify/fact-preservation-verifier.ts`
- Create placeholder: `src/target/aarch64/verify/tiling-verifier.ts`
- Create placeholder: `src/target/aarch64/verify/superselection-verifier.ts`
- Create placeholder: `src/target/aarch64/verify/memory-order-verifier.ts`
- Create placeholder: `src/target/aarch64/verify/scheduler-verifier.ts`
- Create placeholder: `src/target/aarch64/verify/fp-environment-verifier.ts`
- Create placeholder: `src/target/aarch64/verify/security-verifier.ts`
- Create: `tests/unit/target/aarch64/machine-ir-verifier.test.ts`
- Create: `tests/unit/target/aarch64/nzcv-verifier.test.ts`

**Acceptance Criteria:**

- The verifier returns `kind: "ok"` for a minimal valid function with entry block, one constant producer, and return.
- `AARCH64_MACHINE_VERIFIER_KEYS` defines the full ordered verifier family tuple: `structural`, `nzcv`, `abi`, `regions`, `facts`, `tiling`, `superselection`, `memory-order`, `scheduler`, `fp-environment`, and `security`.
- `defaultAArch64MachineVerifierSuite` is mechanically derived from `AARCH64_MACHINE_VERIFIER_KEYS` and has an exact-order unit test.
- Placeholder descriptors for future verifier families return a deterministic `AARCH64_VERIFIER_NOT_IMPLEMENTED:<key>` diagnostic only when their preconditions indicate the family is required.
- `machine-ir-verifier.ts` only runs the suite and sorts/merges diagnostics; it contains no ABI, region, tiling, memory-order, scheduler, FP, or security logic.
- Undefined virtual-register uses produce deterministic diagnostics.
- Instruction operands are checked against the opcode catalog from Task 3.
- Frame, symbol, relocation, literal-pool, block, and resource operands must resolve.
- A `b.cond`, `csel`, or `ccmp` that uses `NZCV` without a dominating explicit `NZCV` def is rejected.
- An instruction that clobbers `NZCV` between producer and consumer without an explicit dependency is rejected.
- Diagnostics are sorted and use Task 1 codes.

**Code Examples:**

```ts
test("verifier rejects a conditional branch without an NZCV producer", () => {
  const result = verifyAArch64MachineProgram(
    programWithInstructionsForTest([
      instructionForTest({
        opcode: aarch64OpcodeFormId("b-cond"),
        operands: [implicitUseResource({ kind: "NZCV" }), branchTarget(blockId(1))],
      }),
    ]),
  );

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
    "AARCH64_NZCV_USE_WITHOUT_DEF",
  ]);
});
```

```ts
const verifierResult = verifyAArch64MachineProgram({
  program,
  targetSurface: fakeAArch64TargetSurface(),
  options: { checkInstructionSchema: true, checkResources: true },
});
```

```ts
export const AARCH64_MACHINE_VERIFIER_KEYS = [
  "structural",
  "nzcv",
  "abi",
  "regions",
  "facts",
  "tiling",
  "superselection",
  "memory-order",
  "scheduler",
  "fp-environment",
  "security",
] as const;

export const defaultAArch64MachineVerifierSuite = AARCH64_MACHINE_VERIFIER_KEYS.map(
  (verifierKey) => AARCH64_MACHINE_VERIFIER_DESCRIPTORS[verifierKey],
);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/machine-ir-verifier.test.ts ./tests/unit/target/aarch64/nzcv-verifier.test.ts
```

## Task 6: Target Surface Interfaces And Production Profile Authentication

**Depends on:** Task 5

**Description:** Define the AArch64 target sub-surface interfaces, production profile type, profile fingerprinting, component authentication, errata catalog records, and test fakes. This task supplies target authority but does not lower any OptIR yet.

**Files:**

- Create: `src/target/aarch64/target-surface/target-surface.ts`
- Create: `src/target/aarch64/target-surface/production-profile.ts`
- Create: `src/target/aarch64/target-surface/profile-authentication.ts`
- Create: `src/target/aarch64/target-surface/errata-catalog.ts`
- Create: `tests/support/target/aarch64/target-surface/fakes.ts`
- Create: `tests/unit/target/aarch64/production-profile.test.ts`
- Create: `tests/unit/target/aarch64/profile-authentication.test.ts`
- Create: `tests/unit/target/aarch64/errata-gating.test.ts`

**Acceptance Criteria:**

- `AArch64TargetSurface` extends selection, ABI, relocation, memory-order, planning, and platform/device/runtime sub-surfaces.
- Production profile accepts exactly `wrela-uefi-aarch64-rpi5-v1` with Armv8.2-A, Raspberry Pi 5-class instruction set, UEFI PE/COFF image profile, VirtIO device model, required features, excluded families, and `cortex-a76-rpi5-like` tuning model.
- Missing LSE, CRC32, AdvSIMD/FP, AES/SHA/PMULL, FP16, RDM, DotProd, UEFI, VirtIO, or the expected tuning model rejects authentication.
- Out-of-profile requested families SVE/SVE2/PAuth/BTI/MTE/MOPS reject authentication.
- Component fingerprints are recorded separately and included in the aggregate target fingerprint.
- Errata catalog maps declared implementation IDs to deterministic substitutions or schedule constraints without runtime probing.

**Code Examples:**

```ts
test("production profile rejects no-LSE targets", () => {
  const result = authenticateAArch64TargetSurface(
    fakeAArch64TargetSurface({
      profile: fakeAArch64ProductionProfile({
        requiredFeatures: productionFeaturesExcept("FEAT_LSE"),
      }),
    }),
  );

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "profile:wrela-uefi-aarch64-rpi5-v1:missing-feature:FEAT_LSE",
  ]);
});
```

```ts
export interface AArch64MemoryOrderTargetSurface {
  readonly memoryModelFingerprint: AArch64TargetFingerprint;
  readonly memoryModel: AArch64MemoryModel;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/production-profile.test.ts ./tests/unit/target/aarch64/profile-authentication.test.ts ./tests/unit/target/aarch64/errata-gating.test.ts
```

## Task 6A: Target-Neutral Fact Extensions And AArch64 Fact Adapter Slots

**Depends on:** Task 6

**Description:** Create the target-neutral OptIR fact-extension substrate and generic proof-check extension envelope, then create the AArch64-owned adapter slots for target queries and machine fact re-keying. Later fact-family tasks add target-neutral fact records in `src/opt-ir/facts` and register AArch64-specific adaptation only under `src/target/aarch64/facts`.

**Files:**

- Modify: `src/proof-check/model/fact-packet.ts`
- Modify: `src/proof-check/validation/packet-validator.ts`
- Create: `src/opt-ir/facts/fact-extension-registry.ts`
- Modify: `src/opt-ir/facts/fact-import-schema.ts`
- Modify: `src/opt-ir/facts/fact-index.ts`
- Modify: `src/opt-ir/facts/fact-query.ts`
- Create: `src/target/aarch64/facts/aarch64-fact-adapter.ts`
- Create: `src/target/aarch64/facts/aarch64-fact-query.ts`
- Create: `src/target/aarch64/facts/aarch64-fact-rekeying.ts`
- Create: `tests/support/target/aarch64/facts/aarch64-fact-adapters.ts`
- Test: `tests/unit/opt-ir/fact-extension-registry.test.ts`
- Test: `tests/unit/proof-check/fact-packet-extensions.test.ts`
- Test: `tests/unit/target/aarch64/aarch64-fact-adapter.test.ts`

**Acceptance Criteria:**

- Proof-check packet model supports a generic extension packet envelope with `extensionKey`, `packetKind`, subject IDs, dependency IDs, authority fingerprint, and payload.
- Packet validation rejects unknown registered extension keys, duplicate extension fact IDs, missing dependencies, stale subjects, missing authority fingerprints, and payloads rejected by the target-neutral extension validator.
- `fact-extension-registry.ts` exposes a target-neutral registration API with these hooks only: import schema validation, typed answer extraction, index key extraction, preservation rule, invalidation rule, upstream verifier key, and negative fixture list.
- `fact-extension-registry.ts`, `fact-import-schema.ts`, `fact-index.ts`, and `fact-query.ts` must not import `src/target/aarch64`, name AArch64 features, expose AArch64 query namespaces, or contain machine re-keying logic.
- `aarch64-fact-adapter.ts` exposes the target-owned adapter registration API with target query namespace construction, profile/operation-matrix adaptation keys, and machine re-keying rules.
- `aarch64-fact-query.ts` builds AArch64-specific query namespaces from the target-neutral fact index and registered AArch64 adapters.
- `aarch64-fact-rekeying.ts` maps preserved OptIR fact subjects to machine fact subjects using AArch64 provenance and rejects stale or ambiguous subject mappings.
- The target profile fingerprint includes the registered supported-operation matrix fingerprint through a stable AArch64 adapter key, so Task 17 can add the matrix without rewriting Task 6 profile code.
- Tests demonstrate two fake target-neutral extensions can register in stable order without target imports, and two fake AArch64 adapters can produce separate target query namespaces and machine re-keying rules without editing OptIR registry consumers.

**Code Examples:**

```ts
test("target-neutral fact extension registry dispatches schema validation by extension key", () => {
  const registry = createOptIrFactExtensionRegistryForTest([
    fakeOptIrFactExtension({ extensionKey: "branch-probability" }),
    fakeOptIrFactExtension({ extensionKey: "memory-order" }),
  ]);

  expect(registry.extensionKeys()).toEqual(["branch-probability", "memory-order"]);
  expect(
    registry.validateImport({
      extensionKey: "memory-order",
      entry: extensionPacketEntryForTest("memory-order"),
      context: factImportContextForTest(),
    }).kind,
  ).toBe("ok");
});
```

```ts
export interface OptIrFactExtension {
  readonly extensionKey: string;
  readonly packetKinds: readonly string[];
  readonly validateImport: (input: OptIrFactExtensionImportInput) => OptIrFactExtensionImportResult;
  readonly indexKeysFor: (record: OptIrFactRecord) => readonly string[];
  readonly preservationRules: readonly OptIrFactPreservationRule[];
  readonly invalidationRules: readonly OptIrFactInvalidationRule[];
  readonly upstreamVerifierKey: string;
  readonly negativeFixtures: readonly string[];
}
```

```ts
export interface AArch64OptIrFactAdapter {
  readonly adapterKey: string;
  readonly optIrExtensionKey: string;
  readonly targetQueryNamespace: (
    input: AArch64FactQueryNamespaceInput,
  ) => Readonly<Record<string, unknown>>;
  readonly machineRekeyingRules: readonly AArch64FactMachineRekeyingRule[];
  readonly targetProfileFingerprintInputs: readonly AArch64TargetFingerprintInput[];
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-extension-registry.test.ts ./tests/unit/proof-check/fact-packet-extensions.test.ts ./tests/unit/target/aarch64/aarch64-fact-adapter.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-index.test.ts ./tests/unit/proof-check/packet-validator.test.ts
```

## Task 7: OptIR Memory-Order And Region-Memory Fact Extensions

**Depends on:** Task 6A

**Description:** Extend the OptIR preserved fact model with typed memory-order, region-memory-type, barrier-domain, and publication-shape facts so AArch64 lowering can choose hardware ordering from authenticated facts instead of ordered effect tokens.

**Files:**

- Create: `src/opt-ir/facts/memory-order-facts.ts`
- Append AArch64 adapter: `src/target/aarch64/facts/aarch64-fact-adapter.ts`
- Test: `tests/unit/opt-ir/aarch64-memory-order-facts.test.ts`
- Test: `tests/unit/target/aarch64/memory-order-fact-query.test.ts`

**Acceptance Criteria:**

- Fact payloads represent `relaxed`, `acquire`, `release`, `acquireRelease`, `sequentiallyConsistent`, `deviceOrdered`, and `compilerOnlyOrdered`.
- Region memory types represent normal cacheable, device/MMIO, firmware table, runtime-owned, external/conservative, packet source, and validated payload memory.
- Barrier-domain facts identify target memory-model domain and shareability.
- Publication-shape facts distinguish descriptor writes, avail index publication, used-ring observation, MMIO notification, interrupt/status read, firmware call boundary, and ordinary synchronization.
- The target-neutral extension defines authority sources, preservation rules, invalidation rules for every OptIR pass that can move/clone/delete/rewrite the subject, an upstream verifier key, and negative fixtures; the AArch64 adapter defines target query behavior and machine re-keying rules.
- Fact import rejects malformed subject kinds, stale dependencies, and missing authority through the Task 6A registry hook.
- AArch64 query APIs return facts used and deterministic explanations.
- Existing OptIR fact tests still pass.

**Code Examples:**

```ts
test("memory-order query returns release publication authority", () => {
  const factSet = optIrFactSetFromRecords([
    memoryOrderFactRecordForTest({
      factId: optIrFactId(4),
      subject: { kind: "operation", operationId: optIrOperationId(9) },
      order: "release",
      publicationShape: "virtioAvailIndexPublication",
    }),
  ]);

  expect(createAArch64FactQuery(factSet).memoryOrderForOperation(optIrOperationId(9))).toEqual({
    kind: "yes",
    order: "release",
    publicationShape: "virtioAvailIndexPublication",
    factsUsed: [optIrFactId(4)],
    explanation: ["Fact 4 supplies release ordering for operation:9."],
  });
});
```

```ts
export type OptIrRegionMemoryType =
  | "normalCacheable"
  | "deviceMmio"
  | "firmwareTable"
  | "runtimeOwned"
  | "externalConservative"
  | "packetSource"
  | "validatedPayload";
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/aarch64-memory-order-facts.test.ts ./tests/unit/target/aarch64/memory-order-fact-query.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-index.test.ts
```

## Task 8: OptIR Branch, Switch, Footprint, And Prefetch Fact Extensions

**Depends on:** Task 6A

**Description:** Add branch probability, block frequency, cold/terminal edge, switch density/value range, dereferenceable footprint, and prefetchable footprint facts needed for branch shaping, widened access legality, and prefetch planning.

**Files:**

- Create: `src/opt-ir/facts/branch-facts.ts`
- Create: `src/opt-ir/facts/footprint-facts.ts`
- Append AArch64 adapter: `src/target/aarch64/facts/aarch64-fact-adapter.ts`
- Test: `tests/unit/opt-ir/aarch64-branch-footprint-facts.test.ts`
- Test: `tests/unit/target/aarch64/branch-footprint-fact-query.test.ts`

**Acceptance Criteria:**

- Branch probability is keyed to OptIR edges with numerator/denominator validation and deterministic normalized keys.
- Block frequency facts support `entry`, `hot`, `warm`, `cold`, and `terminalCold`.
- Switch density facts include case count, value span, density ratio, hot cases, cold terminal cases, and value-range authority.
- Footprint facts represent exact byte start/end, may-trap containment, alignment, path certificate, region, and whether the footprint is dereferenceable, prefetchable, or both.
- The target-neutral extension defines authority sources, preservation rules, invalidation rules for every OptIR pass that can move/clone/delete/rewrite the subject, upstream verifier keys, and negative fixtures; the AArch64 adapter defines target query behavior and machine re-keying rules.
- AArch64 query APIs distinguish missing profitability facts from hard correctness facts.
- Widening and prefetch queries return the exact facts used and reject partial containment.

**Code Examples:**

```ts
test("footprint query requires the complete widened access range", () => {
  const factQuery = createAArch64FactQuery(
    optIrFactSetFromRecords([
      dereferenceableFootprintFactForTest({
        factId: optIrFactId(6),
        region: optIrRegionId(2),
        start: 0n,
        endExclusive: 8n,
      }),
    ]),
  );

  expect(
    factQuery.provesDereferenceableFootprint({
      region: optIrRegionId(2),
      start: 0n,
      endExclusive: 16n,
    }),
  ).toEqual({ kind: "no", reason: "missingCompleteFootprint", factsUsed: [optIrFactId(6)] });
});
```

```ts
export interface OptIrSwitchDensityFact {
  readonly switchOperation: OptIrOperationId;
  readonly caseCount: number;
  readonly valueSpan: bigint;
  readonly densityPermille: number;
  readonly hotCases: readonly string[];
  readonly coldTerminalCases: readonly string[];
  readonly factId: OptIrFactId;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/aarch64-branch-footprint-facts.test.ts ./tests/unit/target/aarch64/branch-footprint-fact-query.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-index.test.ts
```

## Task 9A: OptIR Semantic Operation Family Scaffold

**Depends on:** Task 6A

**Description:** Add non-FP named semantic operation families required before AArch64 can legally select atomics/fences, checksum/CRC32, polynomial/PMULL, AES/SHA/block-mix, and classifier kernels. This task creates typed operation vocabulary only; family-specific AArch64 selection happens in Tasks 20 and 23B-23H.

**Files:**

- Create: `src/opt-ir/facts/semantic-operation-facts.ts`
- Modify: `src/opt-ir/operation-kinds.ts`
- Modify: `src/opt-ir/operations.ts`
- Modify: `src/opt-ir/operation-schema.ts`
- Modify: `src/opt-ir/operation-schema-core.ts`
- Modify: `src/opt-ir/operation-schema-effectful.ts`
- Modify: `src/opt-ir/operation-semantics.ts`
- Modify: `src/opt-ir/operation-effects.ts`
- Append AArch64 adapter: `src/target/aarch64/facts/aarch64-fact-adapter.ts`
- Test: `tests/unit/opt-ir/aarch64-semantic-operation-families.test.ts`

**Acceptance Criteria:**

- Operation kinds include atomics, fences, checksum, polynomial math, AES/SHA/block-mix, finite-alphabet classifier, and semantic region marker operations.
- Each operation has schema, construction validation, semantic metadata, effect metadata, interpreter metadata key, and negative malformed-attribute tests.
- The target-neutral extension defines authority source, preservation rules, invalidation rules for every OptIR pass that can move/clone/delete/rewrite the subject, upstream verifier key, and negative fixtures; the AArch64 adapter defines target query behavior and machine re-keying rules.
- Tests prove AES/SHA/PMULL/CRC/DotProd meanings cannot be inferred from arbitrary integer/vector idioms without one of these named operations or a certified semantic-region marker.

**Code Examples:**

```ts
test("AES/SHA forms require named semantic operations instead of integer idioms", () => {
  const operation = defineAArch64EligibleSemanticOperationForTest({
    kind: "aesShaBlockMix",
    semanticContract: {
      family: "sha256Round",
      securityBehavior: "constantTime",
      keyLifetime: "notKeyMaterial",
    },
  });

  expect(operation.semantics.interpreterRuleId).toBe(optIrInterpreterRuleId("aes-sha-block-mix"));
  expect(operation.effects.mayObserveMemory).toBe(false);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/aarch64-semantic-operation-families.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/operation-schema.test.ts ./tests/unit/opt-ir/operation-semantics.test.ts ./tests/unit/opt-ir/operation-effects.test.ts
```

## Task 9B: OptIR FP And Numeric Contract Facts

**Depends on:** Tasks 6A, 9A

**Description:** Add FP and numeric contract facts and the FP/vector numeric operation records needed before `fmadd`, FP16, RDM, DotProd, reassociation, narrowing, saturation, and error-bound-sensitive selections are legal.

**Files:**

- Create: `src/opt-ir/facts/fp-numeric-facts.ts`
- Modify: `src/opt-ir/operation-kinds.ts`
- Modify: `src/opt-ir/operations.ts`
- Modify: `src/opt-ir/operation-schema.ts`
- Modify: `src/opt-ir/operation-schema-effectful.ts`
- Modify: `src/opt-ir/operation-semantics.ts`
- Modify: `src/opt-ir/operation-effects.ts`
- Append AArch64 adapter: `src/target/aarch64/facts/aarch64-fact-adapter.ts`
- Test: `tests/unit/opt-ir/aarch64-fp-numeric-facts.test.ts`

**Acceptance Criteria:**

- FP facts include contraction, rounding, exception observability, precision, saturation, error bounds, signed-zero, NaN payload preservation, flush-to-zero, and default-NaN behavior.
- Numeric range facts include signedness, lane width, overflow behavior, magic-divide legality, RDM saturation, DotProd accumulation width, and FP16 narrowing authority.
- The target-neutral extension defines authority source, preservation rules, invalidation rules for every OptIR pass that can move/clone/delete/rewrite the subject, upstream verifier key, and negative fixtures; the AArch64 adapter defines target query behavior and machine re-keying rules.
- AArch64 query APIs return facts used and stable explanations for contraction, FP environment, numeric range, saturation, and error-bound requests.

**Code Examples:**

```ts
test("fp contraction query requires explicit rounding authority", () => {
  const query = createAArch64FactQuery(
    factSetWithFpContractionForTest({
      operationId: optIrOperationId(12),
      contraction: "allowed",
      rounding: "nearestTiesToEven",
    }),
  );

  expect(query.fpContractionForOperation(optIrOperationId(12))).toMatchObject({
    kind: "yes",
    contraction: "allowed",
    rounding: "nearestTiesToEven",
  });
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/aarch64-fp-numeric-facts.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-index.test.ts
```

## Task 9C: OptIR Security And Constant-Time Facts

**Depends on:** Task 6A

**Description:** Add security-sensitive fact payloads and queries for secret values, constant-time regions, key lifetimes, no-spill values, wipe-on-spill values, and zeroization stores.

**Files:**

- Create: `src/opt-ir/facts/security-facts.ts`
- Append AArch64 adapter: `src/target/aarch64/facts/aarch64-fact-adapter.ts`
- Test: `tests/unit/opt-ir/aarch64-security-facts.test.ts`

**Acceptance Criteria:**

- Security facts can target values, operations, regions, calls, functions, frame objects, and zeroization stores.
- The target-neutral extension defines authority source, preservation rules, invalidation rules for every OptIR pass that can move/clone/delete/rewrite the subject, upstream verifier key, and negative fixtures; the AArch64 adapter defines target query behavior and machine re-keying rules.
- AArch64 query APIs distinguish secret data, public data, constant-time-required operations, no-spill values, wipe-on-spill values, and zeroization stores.
- Negative tests prove stale secret labels, labels without authority, and zeroization facts without a live store subject are rejected.

**Code Examples:**

```ts
test("security query identifies no-spill secret values", () => {
  const query = createAArch64FactQuery(
    factSetWithSecurityFactForTest({
      valueId: optIrValueId(5),
      labels: ["secret", "noSpill"],
    }),
  );

  expect(query.securityForValue(optIrValueId(5))).toMatchObject({
    kind: "yes",
    secret: true,
    spillPolicy: "noSpill",
  });
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/aarch64-security-facts.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-index.test.ts
```

## Task 9D: OptIR Vector-State And Call-Clobber Facts

**Depends on:** Task 6A

**Description:** Add vector-state policy facts and call-convention/clobber authority facts so AArch64 lowering can gate AdvSIMD/FP use and keep AAPCS64 register clobbers distinct from fact-informed memory effects.

**Files:**

- Create: `src/opt-ir/facts/vector-state-facts.ts`
- Create: `src/opt-ir/facts/call-clobber-facts.ts`
- Append AArch64 adapter: `src/target/aarch64/facts/aarch64-fact-adapter.ts`
- Test: `tests/unit/opt-ir/aarch64-vector-state-call-clobber-facts.test.ts`

**Acceptance Criteria:**

- Vector-state facts include `scalarOnly`, `ownsVectorState`, and `callsVectorHelper` with save/restore/zeroization obligations where applicable.
- Call-clobber facts distinguish ordinary AAPCS64 full caller-saved register clobbers from authenticated compiler-owned custom conventions.
- The target-neutral extension defines authority source, preservation rules, invalidation rules for every OptIR pass that can move/clone/delete/rewrite the subject, upstream verifier key, and negative fixtures; the AArch64 adapter defines target query behavior and machine re-keying rules.
- AArch64 query APIs expose vector policy by function/helper call and call-clobber authority by call edge.
- Missing custom convention agreement falls back to full AAPCS64 register clobbers or reports a hard error when the program claimed a custom convention.

**Code Examples:**

```ts
export type OptIrVectorStatePolicyFact =
  | { readonly mode: "scalarOnly"; readonly reason: string; readonly factId: OptIrFactId }
  | { readonly mode: "ownsVectorState"; readonly savePolicy: string; readonly factId: OptIrFactId }
  | {
      readonly mode: "callsVectorHelper";
      readonly helperKey: string;
      readonly factId: OptIrFactId;
    };
```

```ts
test("external AAPCS64 call keeps full caller-saved clobber authority", () => {
  const query = createAArch64FactQuery(factSetWithAapcs64CallClobberForTest(optIrCallId(7)));

  expect(query.callClobbersForCall(optIrCallId(7))).toMatchObject({
    kind: "yes",
    convention: "aapcs64",
    mayNarrowRegisterClobbers: false,
  });
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/aarch64-vector-state-call-clobber-facts.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-index.test.ts
```

## Task 10: Public Lowering API And Orchestration Skeleton

**Depends on:** Tasks 5, 6, 6A, 7, 8, 9A, 9B, 9C, 9D

**Description:** Create the public API, lowering options, result types, lowering context, and deterministic orchestration skeleton. The skeleton authenticates target/profile and input handoff, then calls placeholder-free injected lowering stages that initially return empty verified functions for empty programs and deterministic errors for non-empty unsupported input.

**Files:**

- Create: `src/target/aarch64/public-api.ts`
- Create: `src/target/aarch64/lower/lower-program.ts`
- Create: `src/target/aarch64/lower/pipeline-stages.ts`
- Create: `src/target/aarch64/lower/default-pipeline.ts`
- Create: `src/target/aarch64/lower/stages/authenticate-target.ts`
- Create: `src/target/aarch64/lower/stages/verify-input-contract.ts`
- Create placeholder: `src/target/aarch64/lower/stages/verify-operation-matrix.ts`
- Create: `src/target/aarch64/lower/stages/lower-function-shells.ts`
- Create placeholder: `src/target/aarch64/lower/stages/lower-abi.ts`
- Create placeholder: `src/target/aarch64/lower/stages/lower-regions.ts`
- Create placeholder: `src/target/aarch64/lower/stages/lower-uefi-image-context.ts`
- Create placeholder: `src/target/aarch64/lower/stages/materialize-constants.ts`
- Create placeholder: `src/target/aarch64/lower/stages/lower-calls.ts`
- Create placeholder: `src/target/aarch64/lower/stages/select-local-scalar.ts`
- Create placeholder: `src/target/aarch64/lower/stages/lower-terminators.ts`
- Create placeholder: `src/target/aarch64/lower/stages/propagate-security-labels.ts`
- Create placeholder: `src/target/aarch64/lower/stages/tile-selection-candidates.ts`
- Create placeholder: `src/target/aarch64/lower/stages/select-smart-memory-and-endian.ts`
- Create placeholder: `src/target/aarch64/lower/stages/lower-memory-order.ts`
- Create placeholder: `src/target/aarch64/lower/stages/select-vectors.ts`
- Create placeholder: `src/target/aarch64/lower/stages/select-fp-numeric.ts`
- Create placeholder: `src/target/aarch64/lower/stages/apply-out-of-profile-and-errata.ts`
- Create placeholder: `src/target/aarch64/lower/stages/semantic-superselection.ts`
- Create placeholder: `src/target/aarch64/lower/stages/build-dependency-graph.ts`
- Create placeholder: `src/target/aarch64/lower/stages/post-selection-cse-and-remat.ts`
- Create placeholder: `src/target/aarch64/lower/stages/plan-pairs-prefetch-barriers-schedule.ts`
- Create placeholder: `src/target/aarch64/lower/stages/preserve-machine-facts.ts`
- Create placeholder: `src/target/aarch64/lower/stages/verify-machine-ir.ts`
- Create placeholder: `src/target/aarch64/lower/stages/build-debug-output.ts`
- Create: `src/target/aarch64/lower/lower-function.ts`
- Create: `src/target/aarch64/lower/lower-block.ts`
- Create: `src/target/aarch64/lower/lowering-context.ts`
- Create placeholder: `src/target/aarch64/lower/abi-lowering.ts`
- Create placeholder: `src/target/aarch64/lower/region-lowering.ts`
- Create placeholder: `src/target/aarch64/lower/uefi-image-lowering.ts`
- Create placeholder: `src/target/aarch64/lower/constant-materialization.ts`
- Create placeholder: `src/target/aarch64/lower/call-lowering.ts`
- Create placeholder: `src/target/aarch64/lower/terminator-lowering.ts`
- Create placeholder: `src/target/aarch64/lower/security-label-lowering.ts`
- Create placeholder: `src/target/aarch64/lower/fact-preservation.ts`
- Create placeholder: `src/target/aarch64/lower/provenance-builder.ts`
- Test: `tests/unit/target/aarch64/public-api.test.ts`
- Test: `tests/integration/target/aarch64/opt-ir-to-machine-ir.test.ts`

**Acceptance Criteria:**

- Exports `LowerOptIrToAArch64Input`, `AArch64LoweringOptions`, `LowerOptIrToAArch64Result`, and `lowerOptIrToAArch64`.
- Options may enable diagnostics/debug traces but cannot disable production verification, relax profile auth, skip required barriers, or enable unsupported instruction families.
- Empty optimized OptIR programs lower to an empty verified machine program with target fingerprints recorded.
- Non-empty functions return deterministic `AARCH64_UNSUPPORTED_LOWERING_STAGE` diagnostics until owned lowering tasks replace that path.
- Production verifier lane runs before returning `kind: "ok"`.
- The API accepts complete `AArch64TargetSurface` but passes narrow sub-surfaces to lowering helpers.
- `pipeline-stages.ts` defines `AArch64LoweringPipelineStage`, `AArch64LoweringPipelineInput`, `AArch64LoweringPipelineOutput`, and a deterministic stage-result contract.
- `default-pipeline.ts` imports stable descriptors from `src/target/aarch64/lower/stages/<stage-key>.ts` slot modules. Task 10 creates placeholder descriptors that return `AARCH64_UNSUPPORTED_LOWERING_STAGE`; later tasks replace only their owned slot/domain module and do not edit `lower-program.ts` or `default-pipeline.ts`.
- `defaultAArch64LoweringPipeline` is mechanically derived from `AARCH64_LOWERING_STAGE_KEYS`, not a hand-written subset, and the unit test asserts exact key equality.
- Each later lowering/selection/planning task must include a narrow integration test proving the default pipeline reaches its newly implemented stage and no longer returns that stage's unsupported diagnostic.

**Code Examples:**

```ts
test("public lowering authenticates target before lowering functions", () => {
  const result = lowerOptIrToAArch64({
    program: emptyOptimizedOptIrProgramForTest(),
    facts: emptyOptIrFactSet(),
    target: fakeAArch64TargetSurface({
      profile: fakeAArch64ProductionProfile({ baseline: "armv8.0-a" }),
    }),
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
    "AARCH64_PROFILE_REJECTED",
  ]);
});
```

```ts
export type LowerOptIrToAArch64Result =
  | {
      readonly kind: "ok";
      readonly machineProgram: AArch64MachineProgram;
      readonly preservedFacts: AArch64PreservedFactSet;
      readonly provenance: AArch64ProvenanceMap;
      readonly diagnostics: readonly AArch64LoweringDiagnostic[];
    }
  | { readonly kind: "error"; readonly diagnostics: readonly AArch64LoweringDiagnostic[] };
```

```ts
export interface AArch64LoweringPipelineStage {
  readonly stageKey: AArch64LoweringStageKey;
  readonly run: (input: AArch64LoweringPipelineInput) => AArch64LoweringPipelineStageResult;
}

const AARCH64_LOWERING_STAGE_DESCRIPTORS = {
  "authenticate-target": authenticateTargetStage,
  "verify-input-contract": verifyInputContractStage,
  "verify-operation-matrix": verifyOperationMatrixStage,
  "lower-function-shells": lowerFunctionShellsStage,
  "lower-abi": lowerAbiStage,
  "lower-regions": lowerRegionsStage,
  "lower-uefi-image-context": lowerUefiImageContextStage,
  "materialize-constants": materializeConstantsStage,
  "lower-calls": lowerCallsStage,
  "select-local-scalar": selectLocalScalarStage,
  "lower-terminators": lowerTerminatorsStage,
  "propagate-security-labels": propagateSecurityLabelsStage,
  "tile-selection-candidates": tileSelectionCandidatesStage,
  "select-smart-memory-and-endian": selectSmartMemoryAndEndianStage,
  "lower-memory-order": lowerMemoryOrderStage,
  "select-vectors": selectVectorsStage,
  "select-fp-numeric": selectFpNumericStage,
  "apply-out-of-profile-and-errata": applyOutOfProfileAndErrataStage,
  "semantic-superselection": semanticSuperselectionStage,
  "build-dependency-graph": buildDependencyGraphStage,
  "post-selection-cse-and-remat": postSelectionCseAndRematStage,
  "plan-pairs-prefetch-barriers-schedule": planPairsPrefetchBarriersScheduleStage,
  "preserve-machine-facts": preserveMachineFactsStage,
  "verify-machine-ir": verifyMachineIrStage,
  "build-debug-output": buildDebugOutputStage,
} satisfies Record<AArch64LoweringStageKey, AArch64LoweringPipelineStage>;

export const defaultAArch64LoweringPipeline = AARCH64_LOWERING_STAGE_KEYS.map(
  (stageKey) => AARCH64_LOWERING_STAGE_DESCRIPTORS[stageKey],
);
```

```ts
test("default pipeline stage keys exactly match the canonical stage tuple", () => {
  expect(defaultAArch64LoweringPipeline.map((stage) => stage.stageKey)).toEqual(
    AARCH64_LOWERING_STAGE_KEYS,
  );
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/public-api.test.ts ./tests/integration/target/aarch64/opt-ir-to-machine-ir.test.ts
```

## Task 11: ABI Lowering

**Depends on:** Tasks 9D, 10

**Description:** Implement ABI placement for function parameters, returns, indirect results, call arguments, register tuples, outgoing argument areas, AAPCS64 stack invariants, and ABI register clobber records from authenticated target ABI classifications.

**Files:**

- Modify: `src/target/aarch64/machine-ir/abi-location.ts`
- Modify: `src/target/aarch64/lower/abi-lowering.ts`
- Create: `tests/unit/target/aarch64/abi-lowering.test.ts`
- Extend: `tests/integration/target/aarch64/opt-ir-to-machine-ir.test.ts`

**Acceptance Criteria:**

- Function entry binds each parameter ABI location to a virtual register.
- Return lowering emits moves into authenticated return locations.
- Large aggregate return uses indirect-result location when target ABI surface classifies it that way.
- Call argument lowering creates outgoing argument-area frame objects when stack arguments are required.
- Ordinary AAPCS64 calls always record full caller-saved GPR and vector/FP clobbers.
- The ordinary AAPCS64 clobber test asserts `v0`-`v7` and `v16`-`v31` are caller-saved; it must not imply only `v0`-`v7` are clobbered.
- Authenticated internal custom convention may narrow register clobbers only when the ABI surface returns a closed agreement record.
- Public call-boundary stack-alignment metadata records 16-byte SP alignment and no red-zone assumptions.
- The default pipeline reaches the ABI stage for a one-function fixture and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:lower-abi`.

**Code Examples:**

```ts
test("ordinary AAPCS64 call keeps full caller-saved register clobbers", () => {
  const result = lowerAArch64CallAbi({
    call: optIrRuntimeCallForTest({ callId: optIrCallId(3) }),
    abi: fakeAArch64AbiSurface({
      convention: "aapcs64",
      returnLocations: [{ kind: "intReg", index: 0 }],
    }),
    registerClasses: fakeAArch64RegisterClasses(),
  });

  expect(result.callClobbers.registers).toEqual({
    convention: "aapcs64",
    gpr: [
      "x0",
      "x1",
      "x2",
      "x3",
      "x4",
      "x5",
      "x6",
      "x7",
      "x8",
      "x9",
      "x10",
      "x11",
      "x12",
      "x13",
      "x14",
      "x15",
      "x16",
      "x17",
    ],
    vector: [
      "v0",
      "v1",
      "v2",
      "v3",
      "v4",
      "v5",
      "v6",
      "v7",
      "v16",
      "v17",
      "v18",
      "v19",
      "v20",
      "v21",
      "v22",
      "v23",
      "v24",
      "v25",
      "v26",
      "v27",
      "v28",
      "v29",
      "v30",
      "v31",
    ],
  });
});
```

```ts
const entryParameter = bindAArch64ParameterLocation({
  value: optIrValueId(11),
  location: { kind: "intReg", index: 0 },
  type: { kind: "pointer", addressSpace: "packet-source" },
  origin: { kind: "optIrValue", valueId: optIrValueId(11) },
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/abi-lowering.test.ts
```

## Task 12: Region Lowering

**Depends on:** Task 10

**Description:** Lower OptIR regions to concrete AArch64 address bases while preserving region memory type, alias class, effect ordering, barrier domain, zero-copy validated-buffer backing, firmware/device provenance, and runtime-owned memory ownership.

**Files:**

- Modify: `src/target/aarch64/lower/region-lowering.ts`
- Create: `tests/unit/target/aarch64/region-lowering.test.ts`
- Create: `tests/integration/target/aarch64/validated-buffer-machine-ir.test.ts`
- Create: `tests/integration/target/aarch64/platform-effect-machine-ir.test.ts`

**Acceptance Criteria:**

- Stack/activation regions lower to frame objects.
- Packet source regions lower to incoming pointer parameter bases.
- Validated payload regions lower to the same backing as packet/source plus certified offset with no copy and no re-validation.
- Constant data lowers to read-only global symbols; global data lowers to mutable global symbols.
- Image-device regions lower to MMIO bases from device facts and retain volatile/unmerged constraints.
- Firmware-table regions lower through UEFI image profile/system-table provenance.
- Runtime-owned memory lowers through runtime catalog symbols or pointer-returning helper ownership records.
- External memory lowers to conservative pointer operands with no widening, merging, or reordering authority.
- Missing device/firmware/runtime provenance is a hard lowering error.
- The default pipeline reaches the region stage for region fixtures and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:lower-regions`.

**Code Examples:**

```ts
test("validated payload uses packet backing without copy", () => {
  const result = lowerAArch64Region({
    region: optIrRegionForTest({ kind: "validatedPayload", regionId: optIrRegionId(4) }),
    facts: factSetWithValidatedPayloadForTest({
      payloadRegion: optIrRegionId(4),
      backingRegion: optIrRegionId(1),
      certifiedOffset: 14n,
    }),
    context: aarch64LoweringContextForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected region lowering success");
  expect(result.addressBasis).toMatchObject({
    kind: "derivedRegionBase",
    backingRegion: optIrRegionId(1),
    byteOffset: 14n,
    copyIntroduced: false,
  });
});
```

```ts
export type AArch64RegionAddressBasis =
  | { readonly kind: "frameObject"; readonly object: AArch64FrameObjectId }
  | { readonly kind: "incomingPointer"; readonly vreg: AArch64VirtualRegisterId }
  | { readonly kind: "globalSymbol"; readonly symbol: AArch64SymbolId }
  | {
      readonly kind: "deviceMmioBase";
      readonly deviceKey: string;
      readonly base: AArch64SymbolReference;
    }
  | {
      readonly kind: "firmwareTableBase";
      readonly tableKey: string;
      readonly base: AArch64VirtualRegisterId;
    }
  | {
      readonly kind: "runtimeOwned";
      readonly ownerKey: string;
      readonly base: AArch64VirtualRegisterId;
    }
  | { readonly kind: "externalPointer"; readonly vreg: AArch64VirtualRegisterId };
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/region-lowering.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/validated-buffer-machine-ir.test.ts ./tests/integration/target/aarch64/platform-effect-machine-ir.test.ts
```

## Task 12A: UEFI Image Entry Context Lowering

**Depends on:** Tasks 11, 12

**Description:** Lower the UEFI image-profile context owned by the target surface: image handle, system table, firmware-table bases, compiler-owned entry shim metadata, and the ordinary Wrela image boot function handoff. This task does not generate the PE/COFF entry shim bytes; it records the machine-IR contract that the later target module and backend consume.

**Files:**

- Modify: `src/target/aarch64/lower/uefi-image-lowering.ts`
- Extend: `tests/unit/target/aarch64/region-lowering.test.ts`
- Create: `tests/unit/target/aarch64/uefi-image-lowering.test.ts`
- Extend: `tests/integration/target/aarch64/uefi-platform-call-lowering.test.ts`

**Acceptance Criteria:**

- The image profile supplies the UEFI entry symbol, Wrela boot function symbol, image-handle source location, system-table source location, and firmware-table provenance.
- Image handle and system table are bound as incoming ABI values or region bases according to the target image profile.
- Firmware-table base records preserve provenance and memory type for Task 12 region lowering and Task 14 platform call lowering.
- The machine program entry symbol is the Wrela image boot function that the target-owned shim calls, not the final PE/COFF loader entrypoint.
- Missing image-handle/system-table provenance is a hard lowering error.
- The default pipeline reaches the UEFI image stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:lower-uefi-image-context`.

**Code Examples:**

```ts
test("uefi image context binds image handle and system table from target profile", () => {
  const result = lowerAArch64UefiImageContext({
    imageProfile: fakeAArch64ImageProfile({
      entryShimSymbol: "efi_main",
      bootFunctionSymbol: "wrela.image.boot",
      imageHandleLocation: { kind: "intReg", index: 0 },
      systemTableLocation: { kind: "intReg", index: 1 },
    }),
    context: aarch64LoweringContextForTest(),
  });

  expect(result.entrySymbol).toBe(aarch64SymbolId("wrela.image.boot"));
  expect(result.contextBindings.map((binding) => binding.source)).toEqual([
    "uefi.imageHandle",
    "uefi.systemTable",
  ]);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/uefi-image-lowering.test.ts ./tests/unit/target/aarch64/region-lowering.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/uefi-platform-call-lowering.test.ts
```

## Task 13: Constant Materialization, Literal Pools, And PIC Symbol Addresses

**Depends on:** Task 10

**Description:** Lower constants and symbol addresses deterministically using immediates, logical bitmask immediates, `movz`/`movn`/`movk` sequences, literal-pool entries, and PIC `adrp`+PAGEOFF sequences with relocation references.

**Files:**

- Modify: `src/target/aarch64/lower/constant-materialization.ts`
- Modify: `src/target/aarch64/machine-ir/rematerialization.ts`
- Test: `tests/unit/target/aarch64/constant-materialization.test.ts`
- Test: `tests/unit/target/aarch64/literal-pool-planning.test.ts`
- Extend: `tests/integration/target/aarch64/opt-ir-to-machine-ir.test.ts`

**Acceptance Criteria:**

- Small add/sub immediates materialize inline when the consuming opcode supports the encoding.
- Logical bitmask constants fold into logical-immediate forms when legal.
- Arbitrary 64-bit constants lower to minimal deterministic `movz`/`movn` plus `movk` sequence.
- Large data constants lower to literal-pool entries keyed by type, bytes, relocation constraints, and section constraints.
- Symbol addresses lower PIC-style with `adrp` plus `add-pageoff` or `ldr-pageoff` and relocation references from the target relocation surface.
- Cheap pure producers get rematerialization metadata with cost, facts, symbols, relocations, and implicit resources recorded.
- Literal-pool dedup keys are deterministic.
- The default pipeline reaches the constant-materialization stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:materialize-constants`.

**Code Examples:**

```ts
test("arbitrary u64 constant uses deterministic movz movk sequence", () => {
  const result = materializeAArch64Constant(
    constantForTest({ type: "u64", value: 0x12340000abcd5678n }),
    constantMaterializationContextForTest(),
  );

  expect(result.instructions.map((instruction) => String(instruction.opcode))).toEqual([
    "movz",
    "movk",
    "movk",
  ]);
  expect(result.rematerialization).toMatchObject({ kind: "cheapProducer", cost: 3 });
});
```

```ts
const pageAddress = materializeAArch64SymbolAddress({
  symbol: aarch64SymbolId("global.config"),
  relocationKinds: { page: "PAGE", pageOff: "PAGEOFF12" },
  addend: 0n,
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/constant-materialization.test.ts ./tests/unit/target/aarch64/literal-pool-planning.test.ts
```

## Task 14: Call Lowering

**Depends on:** Tasks 10, 11, 12, 12A, 13

**Description:** Lower internal, runtime helper, UEFI/platform, device, and indirect calls into concrete machine call sequences with ABI marshaling, symbolic call relocations, loaded function pointers, register clobbers, memory/effect summaries, terminal behavior, and tail-call legality checks.

**Files:**

- Modify: `src/target/aarch64/lower/call-lowering.ts`
- Test: `tests/unit/target/aarch64/call-lowering.test.ts`
- Test: `tests/integration/target/aarch64/uefi-platform-call-lowering.test.ts`

**Acceptance Criteria:**

- Internal direct calls lower to `bl` with `CALL26` relocation references.
- Firmware/platform indirect calls lower by loading the catalog-resolved function pointer and emitting `blr`.
- Runtime helper calls resolve through runtime catalog symbols and helper ABI conventions.
- Variadic or firmware-specific ABI calls are accepted only when the platform catalog names the exact ABI rule.
- Terminal and `Never` calls lower to call plus `trap` or unreachable terminator without a fabricated return path.
- Tail calls lower to direct/indirect branch only when ABI placement, outgoing args, stack state, vector-state obligations, security labels, and frame teardown facts prove the shape legal; otherwise they lower as call plus return path.
- Memory/effect clobbers are separate from ABI register clobbers.
- The default pipeline reaches the call stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:lower-calls`.

**Code Examples:**

```ts
test("internal calls lower to bl with CALL26 relocation", () => {
  const result = lowerAArch64Call({
    operation: optIrSourceCallForTest({
      target: { kind: "internalFunction", symbol: "parser.next" },
    }),
    context: aarch64LoweringContextForTest(),
  });

  expect(result.instructions.map((instruction) => String(instruction.opcode))).toContain("bl");
  expect(result.relocations).toEqual([
    { kind: "CALL26", symbol: aarch64SymbolId("parser.next"), addend: 0n },
  ]);
});
```

```ts
const firmwareCall = lowerAArch64PlatformCall({
  catalogEntry: {
    primitiveKey: "uefi.bootServices.allocatePool",
    callShape: "systemTableFunctionPointer",
    tablePath: ["BootServices", "AllocatePool"],
    abiRule: "uefi-aapcs64-firmware",
    effectSummary: { reads: ["firmwareTable"], writes: ["externalMemory"] },
    terminal: false,
  },
  arguments: argumentVregs,
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/call-lowering.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/uefi-platform-call-lowering.test.ts
```

## Task 15: Local Scalar Selection And Explicit NZCV

**Depends on:** Tasks 3A, 10, 13

**Description:** Implement deterministic local selection for required scalar OptIR operations: constants, integer unary/binary arithmetic, integer comparisons, boolean operations, aggregate scalarization basics, layout offset arithmetic, and select/condition forms with explicit `NZCV` resources.

**Files:**

- Create: `src/target/aarch64/select/selection-context.ts`
- Create: `src/target/aarch64/select/selection-policy.ts`
- Create: `src/target/aarch64/select/local-selector.ts`
- Create: `src/target/aarch64/select/scalar-selection.ts`
- Test: `tests/unit/target/aarch64/scalar-selection.test.ts`
- Test: `tests/unit/target/aarch64/nzcv-selection.test.ts`

**Acceptance Criteria:**

- Every required scalar operation in the current OptIR vocabulary has one conservative local lowering.
- Comparisons emit `cmp`/`subs`-style forms with explicit `NZCV` definitions when consumers need flags.
- Boolean values lower to canonical one-bit integer forms.
- W-register definitions record zero-extension behavior where A64 semantics require it.
- Division uses architectural divide unless Task 19's constant-divisor facts license a magic sequence.
- Selection records chosen pattern ID, tier, facts used, profile gate, cost, and rejected alternatives for debug diagnostics.
- Selection is deterministic for repeated equivalent input.
- Scalar add/sub/compare/select patterns have merge/debug differential fixtures using the Task 3A interpreter seed.
- The pipeline reaches the local scalar selection stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:select-local-scalar`.

**Code Examples:**

```ts
test("integer compare selects cmp with explicit NZCV def", () => {
  const result = selectAArch64LocalOperation({
    operation: optIrIntegerCompareForTest({ operator: "unsignedLessThan" }),
    context: scalarSelectionContextForTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected scalar selection success");
  expect(result.instructions.map((instruction) => String(instruction.opcode))).toEqual([
    "cmp-shifted-register",
  ]);
  expect(result.instructions[0]?.operands).toContainEqual(implicitDefResource({ kind: "NZCV" }));
});
```

```ts
const scalarSelectionRecord = {
  tier: "local",
  patternId: aarch64PatternId("scalar.flex-second-operand"),
  factGate: [],
  profileGate: ["BASE_A64"],
  profitability: { reason: "only-legal-local-form", estimatedCost: 1 },
  rejectedAlternatives: [],
} as const;
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/scalar-selection.test.ts ./tests/unit/target/aarch64/nzcv-selection.test.ts
```

## Task 16: Terminator Lowering, Branch Profitability, And Switch Shaping

**Depends on:** Tasks 3A, 8, 10, 15

**Description:** Lower OptIR terminators to AArch64 branches, conditional branches, test-and-branch forms, returns, traps, compare trees, and PIC-safe jump tables using branch probability, density, cold/terminal edge facts, `NZCV` cost, and tuning-model policy.

**Files:**

- Modify: `src/target/aarch64/lower/terminator-lowering.ts`
- Create: `src/target/aarch64/lower/branch-switch-profitability.ts`
- Create: `src/target/aarch64/select/compare-select-selection.ts`
- Test: `tests/unit/target/aarch64/terminator-lowering.test.ts`
- Test: `tests/unit/target/aarch64/branch-profitability.test.ts`
- Test: `tests/unit/target/aarch64/switch-lowering-policy.test.ts`

**Acceptance Criteria:**

- Unconditional jumps lower to `b`; returns lower to ABI return plus `ret`.
- Branches use `b.cond`, `cbz`/`cbnz`, or `tbz`/`tbnz` when operand shape permits.
- Predictable validation chains remain branchy when tuning model says branch prediction beats serial `NZCV`.
- Short unpredictable diamonds if-convert to `csel`/`ccmp` when legal and profitable.
- Missing probability facts use deterministic conservative static fallback and record debug diagnostics.
- Switch lowering chooses jump table, compare tree, bit-test tree, or hot-case split from density/probability/code-size policy.
- Jump-table entries are symbolic PIC-safe references, not absolute addresses.
- Terminal/cold edges preserve no-return shape and do not fabricate fallthrough.
- Branch and return forms have merge/debug differential fixtures using the Task 3A interpreter seed.
- The default pipeline reaches the terminator stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:lower-terminators`.

**Code Examples:**

```ts
test("predictable validation branch stays branchy", () => {
  const decision = chooseAArch64BranchShape({
    chainLength: 4,
    probabilities: [{ edge: optIrEdgeId(1), takenPermille: 990 }],
    terminalEdges: [],
    tuning: fakeCortexA76SchedulerModel(),
    nzcvSerialCost: 4,
  });

  expect(decision).toEqual({
    kind: "predictedBranches",
    reason: "hot-predictable-edge",
    patternId: aarch64PatternId("branch.test-and-conditional"),
  });
});
```

```ts
const jumpTableTerminator = lowerAArch64Switch({
  scrutinee,
  density: { caseCount: 16, valueSpan: 18n, densityPermille: 888 },
  probability: { hotCases: ["0", "1"], coldTerminalCases: [] },
  relocationPolicy: fakeJumpTableRelocationPolicy("pcRelativeDelta"),
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/terminator-lowering.test.ts ./tests/unit/target/aarch64/branch-profitability.test.ts ./tests/unit/target/aarch64/switch-lowering-policy.test.ts
```

## Task 16A: Security Label Propagation And Constant-Time Lowering Constraints

**Depends on:** Tasks 9C, 15, 16

**Description:** Propagate OptIR security facts onto machine virtual registers, instructions, memory operands, calls, frame objects, rematerialization records, and terminators. This task establishes the single invariant consumed by branch shaping, table selection, CSE, scheduling, allocation metadata, and verification.

**Files:**

- Create: `src/target/aarch64/lower/security-label-lowering.ts`
- Modify: `src/target/aarch64/machine-ir/security.ts`
- Test: `tests/unit/target/aarch64/security-label-lowering.test.ts`
- Test: `tests/unit/target/aarch64/constant-time-lowering-constraints.test.ts`

**Acceptance Criteria:**

- A secret OptIR value mapped to multiple machine producers labels every resulting virtual register and instruction that carries the value.
- Secret-dependent conditions are marked as requiring constant-time lowering before Task 16 branch shaping can choose a data-dependent branch or jump table.
- Secret-dependent memory addresses are marked as unsafe for data-dependent table access unless a target helper certifies a constant-time access pattern.
- No-spill and wipe-on-spill labels become allocator-visible virtual-register and frame-object metadata.
- Zeroization stores are marked as preserved side effects and cannot be removed, paired, or moved before the last secret use.
- CSE/rematerialization lifetime-extension checks receive explicit security metadata instead of re-querying OptIR facts.
- Negative tests cover split values, merged window outputs, branch conditions, table addresses, remat duplication, and zeroization ordering.
- The pipeline reaches the security propagation stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:propagate-security-labels`.

**Code Examples:**

```ts
test("secret value split across two machine instructions labels both producers", () => {
  const result = propagateAArch64SecurityLabels({
    mapping: valueMappingForTest({
      optIrValue: optIrValueId(4),
      machineVregs: [aarch64VirtualRegisterId(10), aarch64VirtualRegisterId(11)],
      machineInstructions: [machineInstructionId(20), machineInstructionId(21)],
    }),
    facts: factSetWithSecurityFactForTest({
      valueId: optIrValueId(4),
      labels: ["secret", "noSpill"],
    }),
    machineFunction: machineFunctionForTest(),
  });

  expect(result.vregSecurity.get(aarch64VirtualRegisterId(10))?.spillPolicy).toBe("noSpill");
  expect(result.vregSecurity.get(aarch64VirtualRegisterId(11))?.secret).toBe(true);
});
```

```ts
test("secret-dependent jump table is rejected before profitability", () => {
  const decision = checkAArch64ConstantTimeBranchLegality({
    terminator: jumpTableTerminatorForTest({ scrutinee: aarch64VirtualRegisterId(2) }),
    security: securityMapForTest({
      vreg: aarch64VirtualRegisterId(2),
      labels: ["secret"],
    }),
  });

  expect(decision).toEqual({
    kind: "rejected",
    reason: "secret-dependent-control:jump-table",
  });
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/security-label-lowering.test.ts ./tests/unit/target/aarch64/constant-time-lowering-constraints.test.ts
```

## Task 17: Supported-Operation Matrix

**Depends on:** Tasks 6, 6A, 9A, 9B, 9C, 9D, 10

**Description:** Implement the authenticated production supported-operation matrix for `required`, `fact-gated`, `helper-lowered`, aggregate `unsupported-until-layout-lowering`, `profile-rejected`, and `unreachable-after-optir` operation statuses, including current OptIR operations and new semantic families.

**Files:**

- Create: `src/target/aarch64/target-surface/operation-matrix.ts`
- Test: `tests/unit/target/aarch64/supported-operation-matrix.test.ts`

**Acceptance Criteria:**

- Matrix names every current and Tasks 9A-9D OptIR operation kind.
- `constant`, scalar ops, layout ops, layout endian decode, and terminators are `required`.
- Aggregate construct/extract/insert operations are rejected through an explicit unsupported-until-layout-lowering matrix status until authenticated scalarization or layout-backed aggregate lowering exists.
- Memory and vector operations are `fact-gated` with conservative fallback metadata.
- Source/runtime/platform/intrinsic calls are `helper-lowered` with catalog requirement metadata.
- `proofErasedMarker` is `unreachable-after-optir`.
- Out-of-profile semantic operations return deterministic target-mismatch diagnostics.
- A new OptIR operation kind not in the matrix causes a failing test and matrix verification diagnostic.
- The matrix contributes to the target profile fingerprint through the Task 6A registry hook; Task 17 does not rewrite Task 6 profile authentication code.
- The pipeline reaches the operation-matrix verification stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:verify-operation-matrix`.

**Code Examples:**

```ts
test("matrix covers every OptIR operation kind", () => {
  const coverage = verifyAArch64OperationMatrixCoverage({
    operationKinds: OPT_IR_OPERATION_KINDS,
    matrix: WRELA_UEFI_AARCH64_RPI5_OPERATION_MATRIX,
  });

  expect(coverage).toEqual({ kind: "ok", missing: [] });
});
```

```ts
expect(aarch64OperationSupportForKind("proofErasedMarker")).toEqual({
  status: "unreachable-after-optir",
  diagnosticCode: "AARCH64_PROOF_ERASURE_HANDOFF_FAILED",
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/supported-operation-matrix.test.ts
```

## Task 18: Baseline Cover, Replacement Candidate Tiling, And Window Resolution

**Depends on:** Tasks 15, 17

**Description:** Implement the selection candidate records, baseline local cover, verified replacement proposal model, deterministic contiguous-window resolver, and tiling verifier for local, window, helper, and semantic candidates. Local selection always produces the baseline cover; smart and semantic candidates are accepted only as verified replacements over that baseline.

**Files:**

- Create: `src/target/aarch64/select/pattern-catalog.ts`
- Create: `src/target/aarch64/select/pattern-tiler.ts`
- Modify: `src/target/aarch64/verify/tiling-verifier.ts`
- Test: `tests/unit/target/aarch64/pattern-catalog.test.ts`
- Test: `tests/unit/target/aarch64/window-selector.test.ts`
- Test: `tests/unit/target/aarch64/pattern-tiling.test.ts`

**Acceptance Criteria:**

- Pattern records include pattern ID, tier, dispatcher, semantic plugin key, operation kinds, semantic family, required facts, required profile features, vector policy, live-ins, live-outs, consumed effects, produced effects, may-trap, security behavior, baseline replacement window, fallback baseline IDs, and verifier fixtures.
- Candidate construction cannot add hidden fact gates or hidden effects outside the pattern record.
- Deterministic baseline local cover covers every reachable supported operation exactly once before any window or semantic candidate is considered.
- Replacement candidates must name the exact contiguous baseline window they replace and must prove equivalent live-ins, live-outs, effects, traps, security labels, and fact obligations.
- Non-overlapping verified replacements resolve by covered operation IDs, tier, fact gate fingerprint, profile gate, estimated cost, code-size cost, register-pressure estimate, and stable pattern ID.
- DP is used only inside contiguous baseline windows whose candidate set declares `requiresWindowDp: true`; all other regions retain the baseline cover plus deterministic non-overlapping verified replacements.
- Cyclic, non-contiguous, or over-budget regions keep the baseline local cover for that region and emit a deterministic explanation; there is no secondary global cover algorithm.
- Tiling verifier rejects uncovered operations, overlapping consumed operations, duplicated effects, missing live-outs, invented values, and superpattern boundary mismatch.
- The tiler implements the baseline-and-replacement algorithm below exactly; deviations require updating this plan and tests first.
- The pipeline reaches the tiling stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:tile-selection-candidates`.

**Code Examples:**

```ts
test("overlapping window and local candidates pick deterministic lower cost cover", () => {
  const result = tileAArch64SelectionCandidates({
    baselineCover: [
      localCandidateForTest({ covers: [opId(1)], cost: 2, patternId: aarch64PatternId("local.1") }),
      localCandidateForTest({ covers: [opId(2)], cost: 2, patternId: aarch64PatternId("local.2") }),
    ],
    replacementCandidates: [
      windowCandidateForTest({
        covers: [opId(1), opId(2)],
        replacesBaselinePatternIds: [aarch64PatternId("local.1"), aarch64PatternId("local.2")],
        cost: 3,
        patternId: aarch64PatternId("window.12"),
      }),
    ],
    budget: { maxCandidates: 16 },
  });

  expect(result.selected.map((candidate) => candidate.patternId)).toEqual([
    aarch64PatternId("window.12"),
  ]);
});
```

```ts
const pairLoadPattern: AArch64SelectionPatternRecord = {
  patternId: aarch64PatternId("memory.pair-load-store"),
  tier: "window",
  dispatcher: "operationPattern",
  coveredOperationKinds: ["memoryLoad", "memoryStore"],
  requiredFacts: ["noalias", "dereferenceableFootprint", "alignment"],
  requiredProfileFeatures: ["BASE_A64"],
  liveIns: [],
  liveOuts: [],
  consumedEffects: [],
  producedEffects: [],
  mayTrap: true,
  securityBehavior: { kind: "preserveLabels" },
  baselineReplacementWindow: { kind: "contiguous", operationCount: 2 },
  fallbackBaselinePatternIds: [aarch64PatternId("address.folded-load-store")],
  verifierFixtures: ["memory-pair-load-store-basic"],
};
```

```ts
export function tileAArch64SelectionCandidates(input: TilingInput): TilingResult {
  const baselineCover = requireVerifiedLocalCover(input.operations, input.localCandidates);
  const verifiedReplacements = input.replacementCandidates
    .filter((candidate) => candidateReplacesContiguousBaselineWindow(candidate, baselineCover))
    .filter((candidate) => replacementBoundaryIsLegal(candidate, input.boundary))
    .filter((candidate) => replacementPreservesBaselineSemantics(candidate, baselineCover));

  const selectedReplacements: AArch64SelectionCandidate[] = [];
  for (const window of groupByBaselineWindow(verifiedReplacements)) {
    if (window.requiresWindowDp && window.candidates.length <= input.budget.maxCandidates) {
      selectedReplacements.push(...solveContiguousWindowWithDp(window));
      continue;
    }
    selectedReplacements.push(...chooseDeterministicNonOverlappingReplacements(window));
  }

  return verifyAndReturnCover(applyReplacementsToBaseline(baselineCover, selectedReplacements));
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/pattern-catalog.test.ts ./tests/unit/target/aarch64/window-selector.test.ts ./tests/unit/target/aarch64/pattern-tiling.test.ts
```

## Task 19: Addressing, Bitfield, Memory, Endian, Wide-Load, And Constant-Divisor Selection

**Depends on:** Tasks 8, 15, 18

**Description:** Add smart base-A64 selectors for folded addressing, bitfield extract/insert, pair load/store, wide/speculatable loads, endian decode, and constant-divisor cleanup with fact gates and conservative fallbacks.

**Files:**

- Create: `src/target/aarch64/select/addressing-selection.ts`
- Create: `src/target/aarch64/select/bitfield-selection.ts`
- Create: `src/target/aarch64/select/memory-selection.ts`
- Create: `src/target/aarch64/select/endian-selection.ts`
- Test: `tests/unit/target/aarch64/addressing-selection.test.ts`
- Test: `tests/unit/target/aarch64/bitfield-selection.test.ts`
- Test: `tests/unit/target/aarch64/memory-selection.test.ts`
- Test: `tests/unit/target/aarch64/endian-selection.test.ts`
- Test: `tests/unit/target/aarch64/constant-divisor-cleanup.test.ts`

**Acceptance Criteria:**

- Base+scaled-immediate and base+extended-index address arithmetic folds into load/store operands when immediate ranges and index widths are legal.
- Layout-backed field positions lower to `ubfx`, `sbfx`, `bfi`, `bfxil`, or `extr` only with layout field facts.
- `ldp`/`stp` forms require alias/disjointness, exact footprint containment, alignment, trap, volatility, and region-memory gates.
- Wide/speculatable loads require complete machine footprint containment.
- Volatile/MMIO/firmware/atomic accesses are never paired, widened, merged, or reordered by these selectors.
- Endian decode selects identity, `rev`, `rev16`, `rev32`, vector byte swap, or scalar fallback from explicit layout/endian facts.
- Constant division cleanup emits reviewed magic multiply/high-half/shift sequence only when signedness, range, overflow, and rounding facts license it; otherwise emits architectural divide.
- The pipeline reaches the smart memory/endian selection stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:select-smart-memory-and-endian`.

**Code Examples:**

```ts
test("pair load requires complete footprint and noalias facts", () => {
  const result = selectAArch64MemoryWindow({
    operations: [
      optIrMemoryLoadForTest({ byteOffset: 0n, byteWidth: 8 }),
      optIrMemoryLoadForTest({ byteOffset: 8n, byteWidth: 8 }),
    ],
    facts: factSetForPairLoad({
      disjoint: true,
      dereferenceable: { start: 0n, endExclusive: 16n },
      alignment: 8,
    }),
    regionMemoryType: "normalCacheable",
  });

  expect(result.instructions.map((instruction) => String(instruction.opcode))).toEqual([
    "ldp-signed-offset",
  ]);
});
```

```ts
test("big-endian u16 decode selects rev16 from layout endian fact", () => {
  expect(
    selectAArch64EndianDecode({
      endian: "big",
      widthBits: 16,
      layoutFact: layoutEndianFactForTest({ wireEndian: "big" }),
      hostEndian: "little",
    }).opcode,
  ).toBe(aarch64OpcodeFormId("rev16"));
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/addressing-selection.test.ts ./tests/unit/target/aarch64/bitfield-selection.test.ts ./tests/unit/target/aarch64/memory-selection.test.ts ./tests/unit/target/aarch64/endian-selection.test.ts ./tests/unit/target/aarch64/constant-divisor-cleanup.test.ts
```

## Task 20: Memory-Order Lowering, LSE Atomics, And Barriers

**Depends on:** Tasks 7, 9A, 18

**Description:** Select AArch64 memory-order forms for atomics, fences, volatile/MMIO/firmware/device operations, VirtIO publication, and compiler-only ordered tokens. Insert explicit barriers before scheduling and record hard motion boundaries.

**Files:**

- Modify: `src/target/aarch64/machine-ir/memory-order.ts`
- Create: `src/target/aarch64/select/memory-order-selection.ts`
- Create: `src/target/aarch64/lower/memory-order-lowering.ts`
- Create: `tests/unit/target/aarch64/memory-order-lowering.test.ts`
- Create: `tests/unit/target/aarch64/lse-atomic-selection.test.ts`
- Create: `tests/integration/target/aarch64/virtio-memory-order.test.ts`

**Acceptance Criteria:**

- Relaxed LSE read-modify-write selects unsuffixed LSE forms when legal.
- Acquire, release, and acquire-release operations select the matching LSE suffixes or `ldar`/`stlr` forms.
- Sequentially consistent, device, VirtIO, MMIO, and firmware publication operations get target memory-model barrier sequences.
- Missing memory-order fact is a hard error for atomics/fences/MMIO/VirtIO publication and uses compiler-only conservative ordering for ordinary ordered tokens when target rules allow it.
- Barriers are explicit machine instructions with memory operands and scheduling dependencies.
- Unaligned device accesses are rejected even when normal memory would allow them.
- No no-LSE fallback path is emitted for the production profile.
- LSE atomic and barrier patterns add interpreter/litmus fixtures for the opcode forms they introduce.
- The pipeline reaches the memory-order stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:lower-memory-order`.

**Code Examples:**

```ts
test("release virtio publication emits stlr plus target barrier sequence", () => {
  const result = lowerAArch64MemoryOrder({
    operation: optIrAtomicStoreForTest({ region: optIrRegionId(8) }),
    facts: factSetWithMemoryOrder({
      order: "release",
      regionMemoryType: "deviceMmio",
      publicationShape: "virtioAvailIndexPublication",
    }),
    memoryModel: fakeAArch64MemoryModel({
      barrierFor: () => [{ opcode: "dmb", domain: "ishst" }],
    }),
  });

  expect(result.instructions.map((instruction) => String(instruction.opcode))).toEqual([
    "stlr",
    "dmb",
  ]);
});
```

```ts
const lseSuffix = selectAArch64LseSuffix({
  operation: "ldadd",
  order: "acquireRelease",
  profile: "wrela-uefi-aarch64-rpi5-v1",
});
expect(lseSuffix).toBe("al");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/memory-order-lowering.test.ts ./tests/unit/target/aarch64/lse-atomic-selection.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/virtio-memory-order.test.ts
```

## Task 21A: Fixed AdvSIMD Vector Selection With Policy-Gated Fallbacks

**Depends on:** Tasks 8, 9D, 18, 20

**Description:** Implement fixed AdvSIMD vector load/store, masked load/store, shuffle, compare, select, byte-swap, and scalar/helper fallback selection gated by vector-state, footprint, tail-plan, and region-memory facts.

**Files:**

- Create: `src/target/aarch64/select/vector-selection.ts`
- Test: `tests/unit/target/aarch64/vector-selection.test.ts`
- Test: `tests/unit/target/aarch64/vector-state-policy.test.ts`
- Test: `tests/integration/target/aarch64/fixed-vector-classifier.test.ts`

**Acceptance Criteria:**

- `scalarOnly` functions emit no AdvSIMD/FP instructions and use scalar/SWAR/helper fallback when the matrix names one.
- `ownsVectorState` functions may emit direct AdvSIMD/FP instructions and record backend prologue/epilogue obligations.
- `callsVectorHelper` functions stay scalar but may call compiler-owned helpers with vector-state ownership and zeroization contract.
- Masked and tail forms require tail/footprint facts; otherwise scalar-tail fallback or hard error follows the matrix.
- Vector byte swap respects layout/endian facts and vector policy.
- Vector load/store and byte-swap patterns add interpreter fixtures for the opcode forms they introduce.
- The pipeline reaches the vector-selection stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:select-vectors`.

**Code Examples:**

```ts
test("scalarOnly policy blocks direct AdvSIMD vector load", () => {
  const result = selectAArch64VectorOperation({
    operation: optIrVectorLoadForTest({ lanes: 16, laneBits: 8 }),
    facts: factSetWithVectorPolicy("scalarOnly"),
    target: fakeAArch64TargetSurface(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected scalar fallback");
  expect(
    result.instructions.some((instruction) => String(instruction.opcode).startsWith("ld1")),
  ).toBe(false);
  expect(result.selectionRecord.rejectedAlternatives).toContainEqual({
    patternId: aarch64PatternId("vector.direct-load"),
    reason: "vector-state-policy:scalarOnly",
  });
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/vector-selection.test.ts ./tests/unit/target/aarch64/vector-state-policy.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/fixed-vector-classifier.test.ts
```

## Task 21B: FP, FP16, RDM, And Numeric Fusion Selection

**Depends on:** Tasks 9B, 9D, 18, 20, 21A

**Description:** Implement FP scalar/vector selection, FP16, RDM, DotProd numeric forms, FMA contraction, reassociation, saturation, and precision/error-bound gating from explicit FP/numeric facts and target FP environment.

**Files:**

- Create: `src/target/aarch64/select/fp-selection.ts`
- Test: `tests/unit/target/aarch64/fp-selection.test.ts`
- Test: `tests/unit/target/aarch64/fp-environment-policy.test.ts`

**Acceptance Criteria:**

- FP contraction to `fmadd`/`fmla`, FP16 narrowing, RDM, reassociation, and saturating forms require explicit FP/numeric facts.
- FPCR/FPSR assumptions are recorded on FP instructions and verified later.
- DotProd/RDM selections require lane width, signedness, range, saturation, and accumulation/error facts.
- `scalarOnly` vector-state policy blocks FP/vector forms and uses helper/scalar fallback when the matrix names one.
- FP and numeric fusion patterns add interpreter fixtures for the opcode forms they introduce.
- The pipeline reaches the FP/numeric selection stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:select-fp-numeric`.

**Code Examples:**

```ts
const fpSelection = selectAArch64FusedMultiplyAdd({
  operation: optIrFloatOperationForTest({ kind: "multiplyAdd", bits: 32 }),
  facts: factSetWithFpContraction({ allowed: true, rounding: "nearestTiesToEven" }),
  fpEnvironment: fakeFpEnvironment({ exceptionFlagsObservable: false }),
});
```

```ts
test("fp contraction is rejected when exception flags are observable", () => {
  const result = selectAArch64FusedMultiplyAdd({
    operation: optIrFloatOperationForTest({ kind: "multiplyAdd", bits: 32 }),
    facts: factSetWithFpContraction({ allowed: true, rounding: "nearestTiesToEven" }),
    fpEnvironment: fakeFpEnvironment({ exceptionFlagsObservable: true }),
  });

  expect(result).toMatchObject({
    kind: "rejected",
    reason: "fp-exception-flags-observable",
  });
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/fp-selection.test.ts ./tests/unit/target/aarch64/fp-environment-policy.test.ts
```

## Task 22: Out-Of-Profile Family Rejection And Errata Substitution

**Depends on:** Tasks 6, 18, 21A, 21B

**Description:** Enforce that MOPS, SVE/SVE2, PAuth, BTI, and MTE are never emitted under `wrela-uefi-aarch64-rpi5-v1`, and apply compile-time errata substitutions or schedule constraints by declared implementation ID.

**Files:**

- Modify: `src/target/aarch64/target-surface/errata-catalog.ts`
- Modify: `src/target/aarch64/select/selection-policy.ts`
- Test: `tests/unit/target/aarch64/out-of-profile-instructions.test.ts`
- Test: `tests/unit/target/aarch64/errata-gating.test.ts`

**Acceptance Criteria:**

- Selection rejects opcode families outside the profile before instruction emission.
- Supported operations that would benefit from out-of-profile families use scalar/fixed-AdvSIMD/runtime helper paths named by the matrix.
- No runtime feature detection routine, function multiversioning, dispatch table, host CPU query, or no-LSE fallback is generated.
- Declared MIDR ranges apply errata substitutions at compile time.
- Errata schedule constraints are recorded for Task 24/26 and verified by Task 28F.
- Negative tests prove out-of-profile forms never appear in machine IR dumps.
- The pipeline reaches the out-of-profile/errata stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:apply-out-of-profile-and-errata`.

**Code Examples:**

```ts
test("SVE candidate is rejected under production profile", () => {
  const result = filterAArch64OpcodeCandidateByProfile({
    opcode: aarch64OpcodeFormId("sve-ld1b"),
    profile: fakeProductionProfile(),
    profileModel: fakeProfileModel(),
  });

  expect(result).toEqual({
    kind: "rejected",
    reason: "excluded-instruction-family:FEAT_SVE",
  });
});
```

```ts
const errataDecision = applyAArch64Errata({
  implementation: { implementer: "0x41", part: "0xd0b", variant: 1, revision: 0 },
  opcode: aarch64OpcodeFormId("affected-form"),
  catalog: fakeErrataCatalog(),
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/out-of-profile-instructions.test.ts ./tests/unit/target/aarch64/errata-gating.test.ts
```

## Task 23A: Semantic Superselector Dispatch

**Depends on:** Tasks 9A, 18

**Description:** Implement the typed semantic plugin dispatch seam. This task registers plugins and validates manifest boundaries; it does not implement any production semantic family.

**Files:**

- Create: `src/target/aarch64/select/semantic-superselector.ts`
- Test: `tests/unit/target/aarch64/semantic-superselector.test.ts`

**Acceptance Criteria:**

- Plugins expose pure `candidatesFor` functions over semantic operation/declared-region boundary, preserved facts, and narrow target sub-surfaces.
- Plugins cannot scan arbitrary surrounding code, mutate OptIR, create facts, or call optimizer analyses.
- Dispatcher sorts plugins by `pluginKey`, rejects duplicate keys, and requires every candidate to reference a manifest pattern ID from Task 18.
- Dispatcher rejects candidates whose consumed-operation, live-out, effect, vector-state, or security boundary does not match the manifest.
- The pipeline reaches the semantic-superselection stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:semantic-superselection`.

**Code Examples:**

```ts
test("semantic dispatcher rejects a candidate with hidden effects", () => {
  const result = dispatchAArch64SemanticPlugins({
    plugins: [pluginReturningHiddenEffectForTest()],
    input: semanticCandidateInputForTest(),
    manifests: manifestCatalogForTest(),
  });

  expect(result.diagnostics[0]?.stableDetail).toBe("semantic-candidate:hidden-effect");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/semantic-superselector.test.ts
```

## Task 23B: Zero-Copy Packet Semantic Plugin

**Depends on:** Tasks 8, 19, 23A

**Description:** Implement the `semantic.packet-zero-copy-view` plugin for validated packet/source semantic regions.

**Files:**

- Create: `src/target/aarch64/select/packet-superpatterns.ts`
- Test: `tests/unit/target/aarch64/packet-superpatterns.test.ts`
- Extend: `tests/integration/target/aarch64/validated-buffer-machine-ir.test.ts`

**Acceptance Criteria:**

- Plugin lowers validated packet/source semantic regions to direct addressed loads with preserved bounds, layout, endian, region, and alias facts.
- It emits no copy, no re-validation, and no bounds branch when the certified footprint covers the machine access.
- It falls back to window/local selection with a missed-superpattern diagnostic when any required fact is absent.

**Code Examples:**

```ts
test("packet plugin emits direct packet-base load candidate", () => {
  const candidate = expectSingleCandidate(
    packetZeroCopyPlugin.candidatesFor(packetViewInputForTest()),
  );

  expect(candidate.manifest.patternId).toBe("semantic.packet-zero-copy-view");
  expect(candidate.requiredFacts).toContain("validated-buffer-evidence");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/packet-superpatterns.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/validated-buffer-machine-ir.test.ts
```

## Task 23C: VirtIO Ring Publication Semantic Plugin

**Depends on:** Tasks 7, 20, 23A

**Description:** Implement the `semantic.virtio-ring-publish` plugin for descriptor writes, avail index publication, notification, and status/interrupt observation.

**Files:**

- Create: `src/target/aarch64/select/virtio-ring-selection.ts`
- Test: `tests/unit/target/aarch64/virtio-ring-selection.test.ts`
- Test: `tests/integration/target/aarch64/virtio-queue-machine-ir.test.ts`

**Acceptance Criteria:**

- Plugin emits descriptor writes, avail publication, notify/status operations, exact memory-order barriers, and MMIO gates.
- It never crosses ordered device-effect boundaries and never merges MMIO accesses.
- It records release/acquire facts, region memory type, barrier domain, and VirtIO publication shape in candidate facts used.

**Code Examples:**

```ts
test("virtio ring publish plugin emits release publication and MMIO boundary", () => {
  const candidate = expectSingleCandidate(
    virtioRingSelectionPlugin.candidatesFor(virtioRingPublishInputForTest()),
  );

  expect(candidate.manifest.patternId).toBe("semantic.virtio-ring-publish");
  expect(candidate.consumedEffects.map((effect) => effect.kind)).toEqual([
    "descriptorWrites",
    "availIndexPublication",
    "mmioNotify",
  ]);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/virtio-ring-selection.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/virtio-queue-machine-ir.test.ts
```

## Task 23D: Checksum And CRC32 Semantic Plugin

**Depends on:** Tasks 9A, 18, 23A

**Description:** Implement the `semantic.checksum-crc32` plugin for named checksum operations that match architectural CRC32 or CRC32C forms.

**Files:**

- Create: `src/target/aarch64/select/checksum-fingerprint-selection.ts`
- Test: `tests/unit/target/aarch64/checksum-fingerprint-selection.test.ts`
- Extend: `tests/integration/target/aarch64/checksum-fingerprint-machine-ir.test.ts`

**Acceptance Criteria:**

- CRC32 selection requires named checksum operation, polynomial, width, chunking, init/final xor rules, and profile support.
- Arbitrary xor/shift idioms produce no semantic candidate.
- Unsupported checksum shapes use reviewed scalar/runtime helper fallback from the operation matrix.

**Code Examples:**

```ts
test("checksum plugin refuses arbitrary xor shift idioms", () => {
  const candidates = checksumFingerprintPlugin.candidatesFor({
    semanticBoundary: { kind: "operationWindow", operations: xorShiftIdiomForTest() },
    facts: factSetWithChecksumFacts({ polynomial: undefined }),
    target: checksumPluginTargetForTest(),
  });

  expect(candidates).toEqual([]);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/checksum-fingerprint-selection.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/checksum-fingerprint-machine-ir.test.ts
```

## Task 23E: PMULL Polynomial Semantic Plugin

**Depends on:** Tasks 9A, 21A, 23A

**Description:** Implement the `semantic.polynomial-pmull` plugin for explicit carryless multiply and binary-polynomial reductions.

**Files:**

- Create: `src/target/aarch64/select/polynomial-pmull-selection.ts`
- Test: `tests/unit/target/aarch64/polynomial-pmull-selection.test.ts`
- Extend: `tests/integration/target/aarch64/checksum-fingerprint-machine-ir.test.ts`

**Acceptance Criteria:**

- PMULL selection requires named polynomial operation, chunk width, reduction shape, alignment/footprint authority, vector-state policy, and profile support.
- Scalar/runtime helper fallback is used when vector-state policy forbids direct PMULL.
- Cryptographic and non-cryptographic polynomial uses preserve distinct security behavior.

**Code Examples:**

```ts
test("pmull plugin requires explicit polynomial contract", () => {
  const result = polynomialPmullPlugin.candidatesFor(pmullInputForTest({ polynomial: undefined }));

  expect(result).toEqual([]);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/polynomial-pmull-selection.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/checksum-fingerprint-machine-ir.test.ts
```

## Task 23F: AES/SHA Mix Semantic Plugin

**Depends on:** Tasks 9A, 9C, 21A, 23A

**Description:** Implement the `semantic.aes-sha-mix` plugin for explicit crypto and non-crypto block-mix operations.

**Files:**

- Create: `src/target/aarch64/select/crypto-mix-selection.ts`
- Test: `tests/unit/target/aarch64/crypto-mix-selection.test.ts`
- Extend: `tests/integration/target/aarch64/checksum-fingerprint-machine-ir.test.ts`

**Acceptance Criteria:**

- AES/SHA selection requires explicit semantic family, round/mix shape, vector-state policy, profile support, and security contract.
- Cryptographic operations preserve constant-time, key-lifetime, and zeroization facts; non-crypto mixing records that it does not claim cryptographic security.
- Arbitrary integer/vector idioms produce no AES/SHA candidate.

**Code Examples:**

```ts
test("crypto plugin preserves key lifetime labels", () => {
  const candidate = expectSingleCandidate(cryptoMixPlugin.candidatesFor(cryptoRoundInputForTest()));

  expect(candidate.securityBehavior).toMatchObject({
    constantTime: true,
    preservesKeyLifetime: true,
  });
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/crypto-mix-selection.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/checksum-fingerprint-machine-ir.test.ts
```

## Task 23G: Classifier, Table, And DotProd Semantic Plugin

**Depends on:** Tasks 8, 9A, 9B, 21A, 21B, 23A

**Description:** Implement the `semantic.classifier-table-dotprod` plugin for finite-alphabet classifiers, table/nibble classifiers, lane compares, reductions, and DotProd scoring.

**Files:**

- Create: `src/target/aarch64/select/classifier-selection.ts`
- Test: `tests/unit/target/aarch64/classifier-selection.test.ts`
- Extend: `tests/integration/target/aarch64/fixed-vector-classifier.test.ts`

**Acceptance Criteria:**

- Table forms require finite alphabet, table bounds, validated bytes, constant-time table-safety when relevant, and vector-state policy.
- DotProd forms require signedness, lane width, range, accumulation width, overflow/error facts, and profile support.
- Unsafe secret-dependent table access is rejected before profitability.

**Code Examples:**

```ts
test("classifier plugin rejects secret-dependent table lookup without constant-time table contract", () => {
  const candidates = classifierSelectionPlugin.candidatesFor(
    secretClassifierWithoutTableSafetyForTest(),
  );

  expect(candidates).toEqual([]);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/classifier-selection.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/fixed-vector-classifier.test.ts
```

## Task 23H: Vector Tail-Proof Semantic Plugin

**Depends on:** Tasks 8, 21A, 23A

**Description:** Implement the `semantic.vector-tail-free` plugin for fixed-vector bodies with no scalar tail or with one certified tail form.

**Files:**

- Create: `src/target/aarch64/select/tail-proof-selection.ts`
- Test: `tests/unit/target/aarch64/tail-proof-selection.test.ts`

**Acceptance Criteria:**

- Tail removal requires trip-count, padding/slack, alignment, vector-tail plan, and complete footprint facts.
- Missing tail authority falls back to scalar-tail or masked-tail lowering named by the matrix.
- Candidate records preserve external values, effects, traps, vector-state decisions, and provenance across the semantic boundary.

**Code Examples:**

```ts
test("tail-free plugin requires dereferenceable tail slack", () => {
  const candidates = tailProofSelectionPlugin.candidatesFor(
    vectorLoopInputForTest({ tailSlackFact: undefined }),
  );

  expect(candidates).toEqual([]);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/tail-proof-selection.test.ts
```

## Task 24: Required Constraints And Machine Dependency Graph

**Depends on:** Tasks 5, 7, 8, 9C, 16A, 20, 22

**Description:** Implement the required-constraint framework and machine dependency graph over virtual registers, memory regions, ordered effect tokens, barriers, calls, `NZCV`, vector state, FPCR/FPSR, may-trap operations, security labels, errata constraints, and platform resources.

**Files:**

- Create: `src/target/aarch64/plan/machine-planning-state.ts`
- Create: `src/target/aarch64/plan/required-constraints.ts`
- Create: `src/target/aarch64/plan/machine-dependency-graph.ts`
- Modify: `src/target/aarch64/machine-ir/schedule.ts`
- Test: `tests/unit/target/aarch64/machine-planning-state.test.ts`
- Test: `tests/unit/target/aarch64/required-constraints.test.ts`
- Test: `tests/unit/target/aarch64/machine-dependency-graph.test.ts`

**Acceptance Criteria:**

- Constraint providers recompute conservative required edges from machine IR, preserved facts, and target rules.
- `MachinePlanningState` is the only input/output boundary for mutating planning passes after Task 24. It owns the machine function, dependency graph, required constraint set, preserved fact references, target planning context, planning explanations, and a monotonically increasing planning revision.
- `updateAArch64MachinePlanningState` either recomputes required constraints and dependency graph after a function transform or accepts an explicitly supplied incremental graph update that must pass `verifyRequiredEdgesComplete`.
- Planning transforms in Tasks 25 and 26 must accept `MachinePlanningState` and return `MachinePlanningState`; they must not accept a bare function plus stale graph/fact/explanation side arguments.
- Graph edges include register def/use, memory alias/order, call register clobber, call memory/effect clobber, barrier, `NZCV`, vector state, FPCR/FPSR, stack pointer, may-trap, errata, and security edges.
- Dependency graph construction is deterministic and sorted.
- Scheduler cannot run until dependency-edge completeness is checked.
- Missing required edges produce deterministic diagnostics naming provider and subject.
- Graph metadata can be attached to machine functions without changing instruction order.
- Required-edge construction follows the provider algorithm below; scheduler preservation checks are not allowed to run until `verifyRequiredEdgesComplete` returns `ok`.
- The pipeline reaches the dependency-graph stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:build-dependency-graph`.

**Code Examples:**

```ts
test("dependency graph contains required NZCV edge between cmp and branch", () => {
  const graph = buildAArch64MachineDependencyGraph(
    machineFunctionWithCmpAndBranchForTest(),
    requiredConstraintContextForTest(),
  );

  expect(graph.edges).toContainEqual({
    from: machineInstructionId(1),
    to: machineInstructionId(2),
    kind: "resource",
    resource: { kind: "NZCV" },
    requiredBy: ["nzcv-live-range"],
  });
});
```

```ts
test("planning state recomputes dependencies after a transform changes instruction order", () => {
  const initial = createAArch64MachinePlanningState({
    function: functionWithIndependentLoadsForTest(),
    facts: preservedFactsForTest(),
    target: fakeAArch64PlanningTargetSurface(),
  });

  const updated = updateAArch64MachinePlanningState(initial, {
    reason: "pair-planning",
    function: functionWithLoadPairForTest(),
    graphUpdate: { kind: "recompute" },
    explanation: planningExplanationForTest("paired-loads"),
  });

  expect(updated.revision).toBe(initial.revision + 1);
  expect(verifyRequiredEdgesComplete(updated).kind).toBe("ok");
});
```

```ts
export interface AArch64MachinePlanningState {
  readonly function: AArch64MachineFunction;
  readonly dependencyGraph: AArch64MachineDependencyGraph;
  readonly requiredConstraints: AArch64RequiredConstraintSet;
  readonly preservedFacts: AArch64PreservedFactSet;
  readonly targetPlanning: AArch64PlanningTargetSurface;
  readonly explanations: readonly AArch64PlanningExplanation[];
  readonly revision: number;
}
```

```ts
const provider: AArch64RequiredConstraintProvider = {
  providerKey: "memory-order",
  requiredEdgesFor(input) {
    return requiredMemoryOrderEdges(input.function, input.preservedFacts, input.memoryModel);
  },
};
```

```ts
export function buildAArch64MachineDependencyGraph(input: DependencyGraphInput) {
  const graph = emptyDependencyGraph();
  for (const block of input.function.blocks) {
    addRegisterDefUseEdges(graph, block.instructions);
    addExplicitResourceEdges(graph, block.instructions, [
      "NZCV",
      "vectorState",
      "FPCR",
      "FPSR",
      "SP",
    ]);
    addTerminatorEdges(graph, block.terminator);
  }
  for (const provider of input.requiredConstraintProviders) {
    for (const edge of provider.requiredEdgesFor(input)) {
      graph.add(edge);
    }
  }
  return freezeDependencyGraph(sortDependencyEdges(graph.edges()));
}

export function verifyRequiredEdgesComplete(input: RequiredEdgeCompletenessInput) {
  const emitted = dependencyEdgeKeySet(input.graph.edges);
  const required = input.providers.flatMap((provider) => provider.requiredEdgesFor(input));
  return diagnosticsForMissingEdges(
    required.filter((edge) => !emitted.has(dependencyEdgeKey(edge))),
  );
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/machine-planning-state.test.ts ./tests/unit/target/aarch64/required-constraints.test.ts ./tests/unit/target/aarch64/machine-dependency-graph.test.ts
```

## Task 25: Post-Selection CSE, ADRP Sharing, Literal-Pool Deduplication, And Rematerialization

**Depends on:** Tasks 13, 16A, 24

**Description:** Implement deterministic post-selection machine CSE for cheap pure producers, PIC page-base sharing/hoisting, literal-pool deduplication, and rematerialization marking with relocation, dominance, loop, call, pressure, security, and schedule constraints.

**Files:**

- Create: `src/target/aarch64/plan/post-selection-cse.ts`
- Create: `src/target/aarch64/plan/adrp-page-base-cse.ts`
- Create: `src/target/aarch64/plan/literal-pool-planning.ts`
- Create: `src/target/aarch64/plan/rematerialization-marking.ts`
- Modify: `src/target/aarch64/machine-ir/rematerialization.ts`
- Consume: `src/target/aarch64/plan/machine-planning-state.ts`
- Test: `tests/unit/target/aarch64/post-selection-cse.test.ts`
- Test: `tests/unit/target/aarch64/adrp-page-base-cse.test.ts`
- Test: `tests/unit/target/aarch64/literal-pool-planning.test.ts`
- Test: `tests/unit/target/aarch64/rematerialization-marking.test.ts`

**Acceptance Criteria:**

- Identical cheap pure producers are CSE'd only when dominance, resource, security, and dependency constraints permit it.
- Every planner in this task accepts and returns `AArch64MachinePlanningState`.
- Every transform that changes the function returns through `updateAArch64MachinePlanningState` with `graphUpdate: { kind: "recompute" }` unless the task supplies and verifies a complete incremental graph update.
- `adrp` page bases group by relocation page, dominance, loop depth, section, and motion legality.
- `adrp` sharing never crosses call clobbers unless the value is saved or marked cheap to rebuild.
- Literal-pool entries deduplicate by bytes, type, relocation, pool scope, section constraints, and reachability group.
- Rematerialization records name all required facts, symbols, relocations, implicit resources, and cost.
- Security labels can forbid CSE/remat when they would extend or duplicate secret lifetimes.
- Negative tests cover relocation-page mismatch, dominance miss, call boundary, pressure threshold, and secret lifetime extension.
- The pipeline reaches the CSE/rematerialization stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:post-selection-cse-and-remat`.

**Code Examples:**

```ts
test("adrp CSE refuses to share across relocation page boundary", () => {
  const result = shareAArch64AdrpPageBases({
    function: functionWithTwoSymbolAddressesForTest("rodata.a", "data.b"),
    relocationPolicy: fakeRelocationPolicy({
      samePage: () => false,
    }),
    dependencies: dependencyGraphForTest(),
    schedulerModel: fakeCortexA76SchedulerModel(),
  });

  expect(result.replacements).toEqual([]);
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
    "adrp-share-rejected:relocation-page-mismatch",
  );
});
```

```ts
const rematRecord = markAArch64Rematerializable({
  producer: instructionId(7),
  kind: "symbolPageBase",
  cost: 1,
  requiredFacts: [machineFactId(3)],
  relocations: [relocationReferenceId(2)],
  implicitResources: [],
});
```

```ts
const inputState = planningStateWithDuplicatePureProducerForTest();
const resultState = runAArch64PostSelectionCse({
  state: inputState,
  csePolicy: fakeAArch64PostSelectionCsePolicy(),
});

expect(resultState.revision).toBeGreaterThan(inputState.revision);
expect(verifyRequiredEdgesComplete(resultState).kind).toBe("ok");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/post-selection-cse.test.ts ./tests/unit/target/aarch64/adrp-page-base-cse.test.ts ./tests/unit/target/aarch64/literal-pool-planning.test.ts ./tests/unit/target/aarch64/rematerialization-marking.test.ts
```

## Task 26: Pair Planning, Prefetch Planning, Barrier Placement, And Pre-RA Scheduler

**Depends on:** Tasks 16A, 19, 20, 22, 24

**Description:** Implement the production machine-planning stages that cluster load/store pairs, place barriers, add prefetch/streaming hints, and schedule each block/effect island using the deterministic Cortex-A76-like model.

**Files:**

- Create: `src/target/aarch64/plan/pair-load-store-planning.ts`
- Create: `src/target/aarch64/plan/prefetch-planning.ts`
- Create: `src/target/aarch64/plan/barrier-placement.ts`
- Create: `src/target/aarch64/plan/pre-ra-scheduler.ts`
- Modify: `src/target/aarch64/machine-ir/schedule.ts`
- Consume: `src/target/aarch64/plan/machine-planning-state.ts`
- Test: `tests/unit/target/aarch64/pair-load-store-planning.test.ts`
- Test: `tests/unit/target/aarch64/prefetch-planning.test.ts`
- Test: `tests/unit/target/aarch64/barrier-placement.test.ts`
- Test: `tests/unit/target/aarch64/pre-ra-scheduler.test.ts`

**Acceptance Criteria:**

- Pair planning can reorder adjacent eligible normal-memory loads/stores inside effect islands to form `ldp`/`stp`.
- Pair planning, prefetch planning, barrier placement, and pre-RA scheduling each accept and return `AArch64MachinePlanningState`.
- Pair/prefetch/barrier transforms that insert, delete, or reorder instructions return through `updateAArch64MachinePlanningState`; scheduler may use an incremental schedule-order update only after `verifySchedulePreservesDependencies` and `verifyRequiredEdgesComplete` pass.
- Pair planning rejects volatile, MMIO, firmware, atomic, may-trap unsafe, and incomplete-footprint cases.
- Barrier placement inserts required barriers before scheduling and marks hard boundaries.
- Prefetch emits `prfm` only when memory type permits it, the footprint is certified or non-faulting by target rule, loop distance is useful, and no ordered device/MMIO boundary is crossed.
- Non-temporal `ldnp`/`stnp` eligibility requires reuse facts and target-model approval.
- Scheduler preserves dependency graph edges, compare/branch adjacency when profitable, errata spacing, barrier boundaries, and security constraints.
- Scheduler output is deterministic and records schedule reasons.
- The scheduler implements the deterministic list-scheduling algorithm below inside each block/effect island.
- The pipeline reaches the pair/prefetch/barrier/schedule stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:plan-pairs-prefetch-barriers-schedule`.

**Code Examples:**

```ts
test("prefetch is not emitted across ordered MMIO boundary", () => {
  const result = planAArch64Prefetches({
    function: streamingLoopWithMmioBoundaryForTest(),
    facts: factSetWithPrefetchableFootprint(),
    memoryModel: fakeAArch64MemoryModel({ prefetchDeviceMemory: false }),
    dependencies: dependencyGraphWithOrderedBoundaryForTest(),
    schedulerModel: fakeCortexA76SchedulerModel(),
  });

  expect(result.insertedInstructions).toEqual([]);
  expect(result.rejections.map((rejection) => rejection.reason)).toContain(
    "ordered-device-boundary",
  );
});
```

```ts
const schedule = scheduleAArch64EffectIsland({
  instructions: islandInstructions,
  dependencyGraph,
  model: fakeCortexA76SchedulerModel({ loadUseDistance: 4 }),
  pressureBudget: { gpr: 12, vector: 8 },
});
```

```ts
const scheduledState = scheduleAArch64MachinePlanningState({
  state: planningStateWithReadyDependencyGraphForTest(),
  model: fakeCortexA76SchedulerModel({ loadUseDistance: 4 }),
  pressureBudget: { gpr: 12, vector: 8 },
});

expect(verifySchedulePreservesDependencies(scheduledState).kind).toBe("ok");
expect(verifyRequiredEdgesComplete(scheduledState).kind).toBe("ok");
```

```ts
export function scheduleAArch64EffectIsland(input: ScheduleEffectIslandInput): ScheduleResult {
  const ready = stableReadyQueue(input.instructions, input.dependencyGraph);
  const scheduled: AArch64MachineInstructionId[] = [];
  const state = initialScheduleState(input.model, input.pressureBudget);

  while (ready.length > 0) {
    const ranked = ready
      .map((instruction) => ({
        instruction,
        cost: deterministicScheduleCost(instruction, state, input.model),
      }))
      .sort(compareScheduleCandidateByCostThenStableId);
    const chosen = firstCandidatePreservingHardBoundaries(ranked, state);
    scheduled.push(chosen.instruction.instructionId);
    state.record(chosen.instruction);
    ready.remove(chosen.instruction);
    ready.push(...newlyReadySuccessors(chosen.instruction, input.dependencyGraph, scheduled));
  }

  return verifySchedulePreservesDependencies({
    scheduled,
    dependencyGraph: input.dependencyGraph,
    hardBoundaries: input.hardBoundaries,
  });
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/pair-load-store-planning.test.ts ./tests/unit/target/aarch64/prefetch-planning.test.ts ./tests/unit/target/aarch64/barrier-placement.test.ts ./tests/unit/target/aarch64/pre-ra-scheduler.test.ts
```

## Task 27: Fact Preservation Into Machine IR

**Depends on:** Tasks 10, 24, 25, 26

**Description:** Re-key preserved OptIR facts to machine subjects with lineage, target-surface declarations, dropped-fact debug records, deterministic stable keys, and a verifier-facing closed subject vocabulary.

**Files:**

- Create: `src/target/aarch64/machine-ir/fact-set.ts`
- Create: `src/target/aarch64/lower/fact-preservation.ts`
- Test: `tests/unit/target/aarch64/fact-preservation.test.ts`
- Test: `tests/unit/target/aarch64/machine-fact-set.test.ts`

**Acceptance Criteria:**

- Machine fact subjects include machine function, block, edge, virtual register, instruction, memory operand, frame object, symbol, call site, and region.
- One OptIR fact may map to many machine facts when one operation expands into a sequence.
- Many OptIR facts may justify one machine fact when a window or semantic pattern merges accesses.
- Facts that only justified eliminated values are dropped unless a surviving machine subject still needs them.
- Target-surface declarations are recorded separately from proof-derived preserved facts.
- Every machine fact records OptIR fact lineage and pattern/manifest gate when selection used it.
- Stable keys are deterministic and duplicate conflicting keys are rejected.
- The pipeline reaches the fact-preservation stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:preserve-machine-facts`.

**Code Examples:**

```ts
test("merged load records both input fact lineages", () => {
  const factSet = preserveAArch64Facts({
    optIrFacts: factSetForPairLoad({ leftFact: optIrFactId(1), rightFact: optIrFactId(2) }),
    selectionRecords: [
      selectionRecordForTest({
        patternId: aarch64PatternId("memory.pair-load-store"),
        inputFacts: [optIrFactId(1), optIrFactId(2)],
        machineInstruction: machineInstructionId(9),
      }),
    ],
    machineProgram: programWithInstructionForTest(machineInstructionId(9)),
  });

  expect(factSet.records[0]).toMatchObject({
    subject: { kind: "memoryOperand", instructionId: machineInstructionId(9), operandIndex: 0 },
    lineage: { optIrFactIds: [optIrFactId(1), optIrFactId(2)] },
    manifestGate: "memory.pair-load-store",
  });
});
```

```ts
export type AArch64MachineFactSubject =
  | { readonly kind: "machineFunction"; readonly functionId: AArch64MachineFunctionId }
  | { readonly kind: "machineInstruction"; readonly instructionId: AArch64MachineInstructionId }
  | {
      readonly kind: "memoryOperand";
      readonly instructionId: AArch64MachineInstructionId;
      readonly operandIndex: number;
    }
  | { readonly kind: "virtualRegister"; readonly vreg: AArch64VirtualRegisterId };
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/fact-preservation.test.ts ./tests/unit/target/aarch64/machine-fact-set.test.ts
```

## Task 28A: ABI Verifier

Tasks 28A-28H all follow the Verifier Suite Protocol above: each task modifies only its owned verifier module, exports the descriptor for its stable key, and proves the diagnostic flows through `verifyAArch64MachineProgram` using the default suite.

**Depends on:** Tasks 11, 14, 27

**Description:** Verify ABI placement, stack invariants, register tuples, tied operands, and call clobber contracts.

**Files:**

- Modify: `src/target/aarch64/verify/abi-verifier.ts`
- Test: `tests/unit/target/aarch64/abi-verifier.test.ts`

**Acceptance Criteria:**

- Checks parameters, returns, indirect results, call arguments, stack argument areas, register tuples, tied operands, and ordinary AAPCS64 clobbers.
- Rejects ordinary AAPCS64 calls that omit any caller-saved GPR or caller-saved vector register including `v16`-`v31`.
- Rejects custom internal conventions without closed caller/callee agreement.
- Any ABI verifier failure causes `lowerOptIrToAArch64` to return `kind: "error"`.

**Code Examples:**

```ts
test("abi verifier rejects narrowed external vector clobbers", () => {
  const result = verifyAArch64Abi({
    function: functionWithExternalCallClobbersForTest({ vector: ["v0", "v1"] }),
    abi: fakeAArch64AbiSurface({ convention: "aapcs64" }),
  });

  expect(result.diagnostics[0]?.stableDetail).toBe("aapcs64-clobber-missing:v16");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/abi-verifier.test.ts
```

## Task 28B: Region Verifier

**Depends on:** Tasks 12, 12A, 27

**Description:** Verify region address bases, alias/effect preservation, region memory type, firmware/device provenance, and volatile/MMIO exact access count.

**Files:**

- Modify: `src/target/aarch64/verify/region-verifier.ts`
- Test: `tests/unit/target/aarch64/region-verifier.test.ts`

**Acceptance Criteria:**

- Checks alias class, effect ordering, volatile/MMIO/firmware exact access count, region memory type, barrier domain, and zero-copy backing.
- Rejects firmware/device accesses treated as normal memory.
- Rejects merged or reordered volatile/MMIO/firmware accesses.

**Code Examples:**

```ts
test("region verifier rejects merged MMIO access", () => {
  const result = verifyAArch64Regions(functionWithMergedMmioAccessForTest());

  expect(result.diagnostics[0]?.stableDetail).toBe("mmio-access-count-changed");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/region-verifier.test.ts
```

## Task 28C: Fact Preservation Verifier

**Depends on:** Task 27

**Description:** Verify machine fact lineage, target declarations, dropped facts, stable keys, and no resurrection of facts dropped by OptIR.

**Files:**

- Modify: `src/target/aarch64/verify/fact-preservation-verifier.ts`
- Test: `tests/unit/target/aarch64/fact-preservation-verifier.test.ts`

**Acceptance Criteria:**

- Checks every carried machine fact has valid lineage to preserved OptIR facts or authenticated target-surface declaration.
- Rejects duplicate stable keys with conflicting payloads.
- Rejects a machine fact derived from a dropped or absent OptIR fact.

**Code Examples:**

```ts
test("fact verifier rejects resurrected dropped fact", () => {
  const result = verifyAArch64FactPreservation(machineFactsWithDroppedLineageForTest());

  expect(result.diagnostics[0]?.stableDetail).toBe("resurrected-fact:optIrFact:7");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/fact-preservation-verifier.test.ts
```

## Task 28D: Tiling And Superselection Verifiers

**Depends on:** Tasks 18, 23A, 23B, 23C, 23D, 23E, 23F, 23G, 23H

**Description:** Harden the tiling verifier and add superselection verifier coverage for manifests, semantic boundaries, fallbacks, and consumed-operation accounting.

**Files:**

- Modify: `src/target/aarch64/verify/tiling-verifier.ts`
- Modify: `src/target/aarch64/verify/superselection-verifier.ts`
- Test: `tests/unit/target/aarch64/superselection-verifier.test.ts`

**Acceptance Criteria:**

- Checks fact gates, profile gates, vector-state decisions, profitability reason, fallback shape, and exact consumed-operation boundaries.
- Rejects overlapping consumed operations, unconsumed reachable operations, duplicated effects, missing live-outs, invented values, and hidden semantic plugin effects.

**Code Examples:**

```ts
test("superselection verifier rejects hidden live-out", () => {
  const result = verifyAArch64Superselection(candidateWithHiddenLiveOutForTest());

  expect(result.diagnostics[0]?.stableDetail).toBe("semantic-boundary:hidden-live-out");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/superselection-verifier.test.ts
```

## Task 28E: Memory-Order Verifier

**Depends on:** Tasks 20, 24, 26

**Description:** Verify LSE suffixes, acquire/release loads/stores, barriers, VirtIO/device sequences, and hard memory-order motion edges.

**Files:**

- Modify: `src/target/aarch64/verify/memory-order-verifier.ts`
- Test: `tests/unit/target/aarch64/memory-order-verifier.test.ts`

**Acceptance Criteria:**

- Checks LSE suffixes, `ldar`/`stlr`, barriers, VirtIO/device sequences, compiler-only ordered tokens, and hard motion edges.
- Rejects missing barrier sequences and scheduled motion across hard ordering boundaries.

**Code Examples:**

```ts
test("memory-order verifier catches release store missing barrier", () => {
  const result = verifyAArch64MemoryOrder({
    function: functionWithReleaseVirtioStoreButNoBarrierForTest(),
    facts: preservedFactsWithVirtioRelease(),
    memoryModel: fakeAArch64MemoryModel(),
    dependencyGraph: dependencyGraphForTest(),
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => String(diagnostic.code))).toEqual([
    "AARCH64_MEMORY_ORDER_REQUIRED_SEQUENCE_MISSING",
  ]);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/memory-order-verifier.test.ts
```

## Task 28F: Scheduler And Dependency Verifier

**Depends on:** Tasks 24, 25, 26

**Description:** Verify required-edge completeness, schedule preservation, ADRP sharing, pair planning, prefetch insertion, rematerialization metadata, and errata spacing.

**Files:**

- Modify: `src/target/aarch64/verify/scheduler-verifier.ts`
- Test: `tests/unit/target/aarch64/scheduler-verifier.test.ts`

**Acceptance Criteria:**

- Runs required-edge completeness before schedule preservation.
- Rejects schedules that violate register, memory, call, barrier, `NZCV`, vector-state, FPCR/FPSR, may-trap, errata, or security edges.
- Rejects illegal `adrp` sharing, illegal prefetches, and rematerialization records missing required authority.

**Code Examples:**

```ts
test("scheduler verifier rejects missing required edge before checking order", () => {
  const result = verifyAArch64Schedule(scheduleMissingBarrierEdgeForTest());

  expect(result.diagnostics[0]?.stableDetail).toBe("required-edge-missing:memory-order");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/scheduler-verifier.test.ts
```

## Task 28G: FP Environment Verifier

**Depends on:** Tasks 9B, 21B

**Description:** Verify FPCR/FPSR assumptions, FP contraction authority, FP16/RDM/DotProd numeric facts, and helper-call FP environment obligations.

**Files:**

- Modify: `src/target/aarch64/verify/fp-environment-verifier.ts`
- Test: `tests/unit/target/aarch64/fp-environment-verifier.test.ts`

**Acceptance Criteria:**

- Requires FPCR/FPSR assumptions on FP operations.
- Rejects contraction, FP16, RDM, DotProd, or reassociation forms without matching FP/numeric facts.
- Rejects helper calls whose FP environment assumptions do not match the target surface.

**Code Examples:**

```ts
test("fp verifier rejects fmla without contraction fact", () => {
  const result = verifyAArch64FpEnvironment(functionWithUnlicensedFmlaForTest());

  expect(result.diagnostics[0]?.stableDetail).toBe("fp-contraction-missing:fmla");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/fp-environment-verifier.test.ts
```

## Task 28H: Security Verifier

**Depends on:** Tasks 16A, 25, 26, 27

**Description:** Verify secret and constant-time labels, no-spill/wipe-on-spill metadata, zeroization stores, branch/table legality, CSE/remat lifetime constraints, and scheduler preservation.

**Files:**

- Modify: `src/target/aarch64/verify/security-verifier.ts`
- Test: `tests/unit/target/aarch64/security-verifier.test.ts`

**Acceptance Criteria:**

- Rejects secret-dependent branches, unsafe table access, unsafe remat/CSE, unsanitized spills, and moved zeroization stores.
- Checks no-spill and wipe-on-spill metadata survives onto virtual registers and frame objects.
- Checks vector helpers that process secrets own vector-state clobbers and zeroization behavior.
- The pipeline reaches the full machine verification stage and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:verify-machine-ir`.

**Code Examples:**

```ts
test("security verifier forbids secret-dependent jump table", () => {
  const result = verifyAArch64SecurityConstraints({
    function: functionWithJumpTableOnSecretVregForTest(),
    preservedFacts: secretValueFactsForTest(),
  });

  expect(result.diagnostics[0]?.stableDetail).toBe("secret-dependent-control:jump-table");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/security-verifier.test.ts
```

## Task 29: Interpreter Coverage Completion And Litmus Fixtures

**Depends on:** Tasks 3A, 13, 15, 16, 19, 20, 21A, 21B, 28E

**Description:** Extend the early merge/debug soundness lane to every production opcode family selected so far and add the AArch64/VirtIO/UEFI memory-order litmus fixtures.

**Files:**

- Modify: `src/target/aarch64/interpreter/machine-ir-interpreter.ts`
- Modify: `src/target/aarch64/interpreter/machine-memory-state.ts`
- Modify: `src/target/aarch64/interpreter/machine-effect-state.ts`
- Modify: `src/target/aarch64/interpreter/machine-ir-differential.ts`
- Extend: `tests/support/target/aarch64/interpreter/machine-ir-interpreter-fixtures.ts`
- Test: `tests/unit/target/aarch64/machine-ir-interpreter.test.ts`
- Test: `tests/unit/target/aarch64/machine-ir-differential.test.ts`
- Test: `tests/integration/target/aarch64/memory-model-litmus.test.ts`

**Acceptance Criteria:**

- Interpreter executes the opcode forms introduced by Tasks 3, 13, 15, 16, 19, 20, and 21 at the semantic level needed for fixtures.
- Interpreter models virtual registers, register tuples, memory state, effect-token state, `NZCV`, barriers, atomics, and trap/terminal behavior.
- Differential harness compares selected pure and effectful fragments against the OptIR interpreter and reports deterministic mismatches.
- Litmus fixtures cover relaxed/acquire/release/acqRel/seqCst, VirtIO publication, MMIO ordering, firmware boundary ordering, and barrier table expectations.
- Production lowering does not depend on interpreter success for normal `kind: "ok"` results.
- Debug options can request interpreter/differential artifacts without changing emitted code.

**Code Examples:**

```ts
test("differential harness compares endian load fragment", () => {
  const result = compareOptIrAndAArch64Fragment({
    optIr: optIrEndianLoadFragmentForTest(),
    machine: aarch64LdrRevFragmentForTest(),
    inputs: [{ memory: packetBytes([0x12, 0x34]) }],
    interpreterOptions: { maxSteps: 64 },
  });

  expect(result).toEqual({ kind: "equivalent", cases: 1 });
});
```

```ts
test("virtio release publication litmus requires target barrier table entry", () => {
  const result = runAArch64MemoryModelLitmus({
    litmus: virtioAvailPublicationLitmusForTest(),
    memoryModel: fakeAArch64MemoryModel(),
  });

  expect(result.requiredSequences).toContainEqual(["stlr", "dmb ishst"]);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/machine-ir-interpreter.test.ts ./tests/unit/target/aarch64/machine-ir-differential.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/memory-model-litmus.test.ts
```

## Task 30: Diagnostics, Debug Explanations, And Deterministic Dumps

**Depends on:** Tasks 18, 25, 26, 27, 28A, 28B, 28C, 28D, 28E, 28F, 28G, 28H

**Description:** Add source-oriented explanation records, missed-optimization diagnostics, selected/rejected alternative traces, machine-planning explanations, deterministic debug dumps, and provenance fingerprint checks.

**Files:**

- Create: `src/target/aarch64/debug/explanation.ts`
- Create: `src/target/aarch64/debug/deterministic-dump.ts`
- Create: `src/target/aarch64/lower/provenance-builder.ts`
- Test: `tests/unit/target/aarch64/selection-explanations.test.ts`
- Test: `tests/unit/target/aarch64/machine-planning-explanations.test.ts`
- Test: `tests/unit/target/aarch64/deterministic-dump.test.ts`
- Test: `tests/integration/target/aarch64/deterministic-machine-ir.test.ts`

**Acceptance Criteria:**

- Debug explanations include selected pattern, source location when available, facts used, emitted instructions, preserved facts, rejected alternatives, and profitability reason.
- Missed superselection diagnostics name missing fact gate, missing profile gate, vector-state policy mismatch, or profitability rejection.
- Planning explanations cover `adrp` CSE, literal-pool deduplication, rematerialization, prefetch placement, barrier insertion, pair planning, block scheduling, branch/switch shaping, and terminal traps.
- Debug dumps sort functions, blocks, instructions, frame objects, symbols, relocation references, facts, and provenance by stable IDs.
- Provenance snapshot fingerprint matches returned machine program fingerprint.
- Diagnostics are deterministic across repeated lowering runs.
- The pipeline reaches the debug-output stage when debug options are enabled and no longer emits `AARCH64_UNSUPPORTED_LOWERING_STAGE:build-debug-output`.

**Code Examples:**

```ts
test("selected ldp rev explanation cites facts and emitted instructions", () => {
  const explanation = explainAArch64Selection(
    selectionRecordForTest({
      patternId: aarch64PatternId("memory.pair-load-store"),
      sourceLabel: "packet.wr:42:13",
      factsUsed: [machineFactId(1), machineFactId(2)],
      emittedOpcodes: ["ldp-signed-offset", "rev16"],
    }),
  );

  expect(explanation.lines).toEqual([
    "selected memory.pair-load-store at packet.wr:42:13",
    "emitted: ldp-signed-offset, rev16",
    "facts: 1, 2",
  ]);
});
```

```ts
const dump = dumpAArch64MachineProgramDeterministically({
  program,
  preservedFacts,
  includeDebugExplanations: true,
});
expect(dump).toBe(
  dumpAArch64MachineProgramDeterministically({
    program,
    preservedFacts,
    includeDebugExplanations: true,
  }),
);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/target/aarch64/selection-explanations.test.ts ./tests/unit/target/aarch64/machine-planning-explanations.test.ts ./tests/unit/target/aarch64/deterministic-dump.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64/deterministic-machine-ir.test.ts
```

## Task 31: End-To-End Pipeline Integration And Public Exports

**Depends on:** Tasks 0, 1, 2, 2A, 2B, 3, 3A, 4, 5, 6, 6A, 7, 8, 9A, 9B, 9C, 9D, 10, 11, 12, 12A, 13, 14, 15, 16, 16A, 17, 18, 19, 20, 21A, 21B, 22, 23A, 23B, 23C, 23D, 23E, 23F, 23G, 23H, 24, 25, 26, 27, 28A, 28B, 28C, 28D, 28E, 28F, 28G, 28H, 29, 30

**Description:** Verify the already-incremental lowering pipeline through public exports, run end-to-end integration tests, and ensure `bun run agent:check` passes. This task may add exports and final end-to-end assertions, but it must not be the first task to wire any production lowering stage.

**Files:**

- Create: `src/target/aarch64/index.ts`
- Modify: `src/target/index.ts`
- Verify: `src/index.ts`
- Modify: `src/target/aarch64/public-api.ts`
- Verify: `src/target/aarch64/lower/lower-program.ts`
- Verify: `src/target/aarch64/lower/default-pipeline.ts`
- Test: `tests/integration/target/aarch64/opt-ir-to-machine-ir.test.ts`
- Test: `tests/integration/target/aarch64/validated-buffer-machine-ir.test.ts`
- Test: `tests/integration/target/aarch64/platform-effect-machine-ir.test.ts`
- Test: `tests/integration/target/aarch64/virtio-queue-machine-ir.test.ts`
- Test: `tests/integration/target/aarch64/checksum-fingerprint-machine-ir.test.ts`
- Test: `tests/integration/target/aarch64/fixed-vector-classifier.test.ts`
- Test: `tests/integration/target/aarch64/deterministic-machine-ir.test.ts`

**Acceptance Criteria:**

- `src/target/index.ts` exports `aarch64` namespace and public lowering types/functions.
- Public lowering runs in the exact `AARCH64_LOWERING_STAGE_KEYS` order: `authenticate-target`, `verify-input-contract`, `verify-operation-matrix`, `lower-function-shells`, `lower-abi`, `lower-regions`, `lower-uefi-image-context`, `materialize-constants`, `lower-calls`, `select-local-scalar`, `lower-terminators`, `propagate-security-labels`, `tile-selection-candidates`, `select-smart-memory-and-endian`, `lower-memory-order`, `select-vectors`, `select-fp-numeric`, `apply-out-of-profile-and-errata`, `semantic-superselection`, `build-dependency-graph`, `post-selection-cse-and-remat`, `plan-pairs-prefetch-barriers-schedule`, `preserve-machine-facts`, `verify-machine-ir`, `build-debug-output`.
- Every stage in that order was already wired by its owning task through the Task 10 stage descriptor. If Task 31 discovers an unwired production stage, the fix belongs in that stage's owning task, not as a new Task 31-only patch.
- Validated-buffer parser integration lowers field reads to direct packet-base loads and `rev`/`ldp` forms with no bounds branches and no copies when facts license them.
- Platform/firmware integration emits exactly one volatile/ordered access per source operation and preserves order.
- VirtIO queue integration emits release/acquire LSE/barrier sequences and does not cross device-effect boundaries.
- Checksum/fingerprint integration covers CRC32, PMULL/helper fallback, AES/SHA mix, and scalar fallback paths.
- Fixed-vector classifier integration covers `tbl`/`tbx`, DotProd, lane compares, and scalar/helper paths under vector-state policies.
- Equivalent optimized OptIR plus target inputs produce byte-for-byte identical deterministic dumps.
- Full project check passes.

**Code Examples:**

```ts
test("public API lowers validated packet parser to direct packet-base machine IR", () => {
  const result = lowerOptIrToAArch64(validatedPacketParserLoweringInputForTest());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected lowering success");
  expect(dumpOpcodes(result.machineProgram)).toContainSequence([
    "ldp-signed-offset",
    "rev16",
    "ubfx",
  ]);
  expect(dumpOpcodes(result.machineProgram)).not.toContain("runtime-bounds-check");
});
```

```ts
export * as aarch64 from "./aarch64";
export {
  lowerOptIrToAArch64,
  type LowerOptIrToAArch64Input,
  type LowerOptIrToAArch64Result,
} from "./aarch64";
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/target/aarch64
PATH="$HOME/.bun/bin:$PATH" bun run agent:check
```

## Final Handoff Checklist

- [x] Every task's dependencies have landed.
- [x] Every production task has narrow unit tests and at least one negative fixture.
- [x] Full integration tests cover public API, validated-buffer zero-copy, UEFI/platform effects, VirtIO ordering, checksum/fingerprint, vector classifier, and deterministic output.
- [x] `PATH="$HOME/.bun/bin:$PATH" bun run format` has been run after formatting-sensitive edits.
- [x] `PATH="$HOME/.bun/bin:$PATH" bun run agent:check` passes.
- [x] No runtime source imports filesystem APIs, Bun APIs, OptIR pass internals, host CPU probes, current time, environment variables, scorecard data, encoder/linker/object writer internals, or register allocator internals.
- [x] The final result emits virtual-register AArch64 machine IR only; register allocation, final frame offsets, encoding, relocation generation, linking, and image writing remain outside this phase.

## Implementation Findings Resolved During Final Review

- ABI lowering originally treated `AArch64AbiTargetSurface` as a fingerprint-only proof boundary while parameters, returns, call arguments, call results, UEFI entry bindings, clobbers, and outgoing stack-area sizing were inferred locally from register classes. The implementation now exposes authenticated ABI classification methods on the ABI target surface, routes production AAPCS64 through that surface, threads the surface through function lowering, call materialization, UEFI image context lowering, and ABI verification, and rejects stale classifier authority instead of falling back to `xN`/`vN` defaults.
- Semantic plugin selection originally accepted several helper patterns from global booleans or operation kind alone (`hasFootprint`, `hasMemoryOrder`, `namedChecksum`, global vector/security flags, and synthetic consumed operation `0`). The implementation now builds operation-scoped semantic plugin inputs carrying exact fact records, profile features, vector policy, and security authorization; default plugins require family-specific semantic-operation facts plus the required footprint, memory-order, vector-state, fp-numeric, profile, or security facts; operation support validates manifest-required fact families and propagates accepted candidate `factsUsed` into semantic-plugin operation contracts and selection records.
- Independent review also surfaced two verifier/structural issues: entry-block verification depended on numeric block order, and deserialized branch targets could bypass operand-kind validation. The structural verifier now uses block-scoped definitions independent of block-id ordering and validates branch-target operand kinds through the opcode schema.
- Scheduler review found that terminators could float before earlier side effects when instruction IDs sorted unfavorably. Dependency graph construction now records control edges into terminators, keeping terminator order pinned behind preceding instructions.
- Terminator/switch review found that cyclic edge-copy temporaries were not always published from branch and jump-table switch lowering. Branch and switch lowering now return edge-copy virtual registers from all successor-copy paths, including jump-table cases.
- FP/numeric review found that `fpNumeric` materialization unconditionally emitted `fmadd`, so integer-typed public OptIR could throw from the machine-instruction constructor instead of returning deterministic diagnostics. FP/numeric selection now consumes operation-scoped `fp-numeric` facts and target FP-environment policy before authorizing `fmadd`; validates FP register classes before emission; keeps current integer-typed OptIR `fpNumeric` inputs fail-closed until scalar-float OptIR values exist; extends the fact payload with lane width, signedness, accumulation, saturation, range, and error-bound evidence; gates DotProd classifier candidates on complete numeric payloads; adds catalog/interpreter/verifier coverage for `fmla`, FP16 narrowing, RDM, saturating, and DotProd authorization markers; and rejects forged numeric machine instructions that lack the required metadata.
- Move-wide constant review found that OptIR constant materialization always planned 64-bit move-wide chunks, allowing a `gpr32` destination to receive `movk` shifts at 32 or 48 bits. Constant materialization now plans move-wide chunks from the destination machine width, and the machine-instruction builder plus structural verifier reject width-illegal move-wide shifts for deserialized 32-bit forms.
- Fresh signoff review found three deserialized machine-IR verifier gaps. Structural verification no longer treats every function-level definition as visible in every block; it computes block dominators from static branch targets, accepts cross-block uses only from dominating definitions, and still permits entry blocks whose numeric IDs sort after successors. The verifier also rejects non-terminator instructions in a block terminator slot. ABI verification now mirrors constructor lower-bound and positivity checks for integer/vector/indirect-result registers and stack-argument ordinal, offset, size, and alignment fields.
- A subsequent signoff review found a semantic-region support gate that accepted any footprint fact without requiring the marker operation's own semantic certificate. `semanticRegionMarker` support now requires an operation-scoped `semantic-operation` fact while still letting semantic plugins consume related region-scoped footprint facts through operation input. The same review found that production-stage invariant exceptions could escape the public pipeline; production stage wrappers now translate deterministic stage exceptions into `AARCH64_INPUT_CONTRACT_INVALID` diagnostics instead.
- Another signoff pass found the checksum, PMULL, and AES/SHA semantic plugins were accepting underspecified family/profile contracts. The plugins now require the planned shape fields: CRC32 width, chunking, polynomial, and xor rules; PMULL chunk width, reduction shape, vector policy, profile support, and aligned footprint authority; and AES/SHA round/mix shape, vector-state policy, profile support, constant-time security, key-lifetime, and zeroization facts for cryptographic use. Non-crypto block mixes are recorded as non-cryptographic. The plan-named plugin unit tests now exist for checksum, PMULL, and crypto mix negative and positive gates.
- A fresh review found three remaining polish issues. Authenticated ABI signature classifications now validate concrete location shape, register-bank bounds, stack argument layout, and stack-area coverage before public lowering constructs ABI bindings, so malformed target surfaces return deterministic diagnostics instead of constructor exceptions. OptIR barrier-domain facts no longer carry an AArch64-named target memory model field; the target memory model remains on the AArch64 target surface. The large operation materialization file was split into focused base-emitter, memory/address, and call-lowering modules, leaving the operation dispatch/materialization file below the 1k-line maintainability threshold without changing behavior.
- A later review found that region-backed memory operations could collapse authenticated symbolic bases into abstract constants. Region-backed global, constant-data, device-MMIO, firmware-table, and runtime-owned addresses now keep symbolic PIC materialization through `adrp` plus `add-pageoff` and record PAGE/PAGEOFF12 relocation references for the referenced symbol.
- The same review found that deserialized tiling and semantic-superselection records could forge manifest gates or hide malformed boundaries. The verifiers now reject mismatched manifest tiers, missing fact and profile-feature authority, empty emitted-opcode evidence for manifest-backed local candidates, duplicate consumed operations, overlapping or incomplete coverage, duplicated semantic effects, and effects hidden outside the manifest declaration.
- Direct stage-state convenience helpers no longer swallow deterministic errors. `applyAArch64OutOfProfileAndErrataStageState` and `lowerAArch64UefiImageStageState` now throw stable diagnostic/reason text on failure, while the result-returning public stage APIs remain the non-throwing integration path.
- The final signoff loop found three more low-level polish issues. Move-wide constant planning now starts `movz` at the first nonzero 16-bit chunk, so shifted constants such as `0x10000` emit one instruction. The exported ABI register-location helper now sizes overflow stack slots by register class, preserving 16-byte vector128 stack alignment. Machine-function construction now deep-freezes call-clobber records, register arrays, and memory-effect arrays so retained input objects cannot mutate constructed machine IR.
- A later signoff loop found that authorized vector64 direct vector memory operations could reach `ld1`/`st1` construction even though the current opcode catalog only models vector128 AdvSIMD memory forms. Vector64 direct vector loads and stores now fail closed with deterministic public diagnostics before instruction construction, while vector128 direct memory lowering remains unchanged.
