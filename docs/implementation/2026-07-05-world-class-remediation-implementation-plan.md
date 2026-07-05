# World-Class Compiler Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the validated findings from the three world-class review documents into concrete, independently executable remediation tasks that improve correctness, architecture boundaries, diagnostics, release confidence, and compiler maintainability.

**Architecture:** Preserve the current compiler pipeline shape while making each layer honest about ownership: lexer only lexes, parser owns syntax imports, semantic owns names and contracts, HIR owns fail-closed lowering, OptIR owns verified graph and dataflow invariants, target/linker owns PE/COFF semantics, and release tooling owns non-skippable production validation.

**Tech Stack:** TypeScript, Bun, existing in-repo compiler libraries, existing test harnesses, no new runtime dependencies, `fast-check` limited to tests.

---

## Source Reviews Verified

This plan reconciles and verifies findings from:

- `docs/review/2026-07-04-world-class-codebase-review.md`
- `docs/reviews/2026-07-05-world-class-compiler-review.md`
- `docs/ultimate-world-class-compiler-review.md`

The following findings were verified against source and are accepted as valid:

- AArch64 post-register-allocation pair-load peephole can erase a second load.
- ARM64 PE/COFF `REL32` relocation is encoded from the relocation field address instead of field end.
- UEFI AArch64 `.pdata` / `.xdata` entry thunk unwind metadata is structurally underspecified.
- Memory SSA and memory optimization use block-id order instead of CFG/control-flow dominance.
- SCCP lacks an `overdefined` lattice state and keeps stale constants through conflicting assignments.
- DCE ignores CFG liveness at branch joins.
- LICM allocates IDs locally and hoists operations in block-id order rather than dependence order.
- CFG simplification has a fixed tiny fuel budget and only removes one redundant edge per iteration.
- OptIR verification accepts duplicate IDs and CFG edges whose `from` does not match the owning block.
- Stack promotion is fail-open because pipeline inputs omit address-taken, exported, unknown-call, callback, and external-flow facts.
- HIR lowering hides malformed syntax with neutral values like `""`, `0n`, `ownerFunctionId ?? 0`, and `0 as never`.
- Lexer-level module graph code owns parse/import discovery responsibilities.
- Token-based import discovery accepts module segments that the parser later rejects.
- Semantic import resolution deduplicates ambiguous imports and reports them as unresolved.
- Predicate facts and private-state transitions collapse identity for multi-argument predicates and multi-state contracts.
- Proof-check companion policies allow closing broad join/loop/session state without tight allowlists.
- Frontend parser has missing syntax surfaces for parenthesized expressions, general indexing, and explicit indented block diagnostics.
- PE validation and full-image validation do not prove exact data directories, section flags, QEMU execution, or reproducibility as release gates.
- Diagnostics fixture coverage is too small relative to `docs/language/invalid.md`.
- Standard library compatibility surface is undocumented and too small to be production confidence material.
- Public API exports too many internals and lacks stable facade discipline.
- Test files have grown past reviewable size and should be decomposed.

The following review themes are accepted as world-class direction but are implemented here only through concrete steps with acceptance criteria:

- A typed compiler pipeline state replacing magic sidecars.
- A canonical OptIR fresh-ID allocator.
- Expression type-checking boundaries inside semantic/HIR.
- Flat syntax infrastructure as an incremental, compatibility-preserving parser artifact.
- Architecture dependency tests.

## Research Notes Already Folded Into Tasks

ARM64 PE/COFF remediation uses Microsoft PE/COFF and ARM64 exception-handling documentation:

- Microsoft PE Format: `IMAGE_REL_ARM64_REL32` is a 32-bit relative address from the byte following the relocation. See [PE Format](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format).
- Microsoft ARM64 Exception Handling: `.pdata` entries reference function start and unwind data; compact and packed unwind forms have defined layouts. See [ARM64 exception handling](https://learn.microsoft.com/en-us/cpp/build/arm64-exception-handling).

Do not add a new production dependency to implement these tasks. Use in-repo binary readers, byte helpers, and focused test decoders.

## Accepted Plan Feedback Corrections

This plan revision accepts the execution feedback attached to the plan review and makes these corrections:

- Wrela examples use real source shapes: `use Name from module.path`, generic brackets like `Result[Ok, Err]`, unsigned integer types, and existing fixture patterns such as `uefi image`.
- Phantom paths are corrected to current repo paths: `parser-diagnostics.ts`, `expression-views.ts`, `scope.ts`, `semantic/names/expression-resolver`, and `src/pe-coff/pe-parser.ts` / `src/pe-coff/pe-verifier.ts`.
- Release tasks are re-premised against current reality: `verify:release` already avoids the developer `--allow-missing-lean` path; remaining work is strict skip accounting, CLI policy clarity, evidence manifests, and dedicated reproducible/stdlib gates.
- `ImportDiscovery` has a fixed fate: delete the lexical import scanner after the parser-backed module loader lands, then move or delete its tests.
- HIR error handling must reuse existing `kind: "error"` nodes and reasons; do not introduce a duplicate failure-node concept.
- Sum-type payload layout and real `Option` / `Result` are in scope through WCR-39 through WCR-41, WCR-51 through WCR-52, WCR-61, and WCR-53.
- Existing `src/opt-ir/passes/pass-contract.ts` is the fact-preservation, rewrite-legality, scheduling, and invariant-schema contract. New pass execution plumbing belongs in `src/opt-ir/passes/pass-execution.ts`; do not overwrite or rename the existing contract module.
- The OptIR pass manager must preserve the current production schedule's consecutive `fixpointId` semantics from `src/opt-ir/policy/pass-order-policy.ts`.

## Implementation Notes From Execution

The 2026-07-05 implementation stayed within the plan's intent but found several required integration details that were not explicit in the original task text:

- Payload-bearing generic enum declarations required end-to-end type-resolution support before real `Option[Value]` and `Result[Ok, Err]` could replace marker wrappers.
- UEFI source-entry handling needed real `Result` resource-kind joining: `Ok` and `BootError` payloads are now lowered through the same tagged-result path instead of status-specific shortcuts.
- OptIR source ABI lowering needed tag-only enum/status constructors to lower to typed constants and single-field error carriers to alias the payload field.
- Proof-MIR derived-field comparisons needed enum-constructor operands to compare the case ordinal, not the aggregate constructor shape.
- The maintainability audit was kept green by extracting new implementation surface into focused helper modules: HIR call/expression helpers, proof companion patch validation/builders, PE byte readers, parser bracket disambiguation, semantic enum-case collection, and Proof-MIR expression helpers.
- The generated diagnostics corpus remains deterministic fixture generation from the invalid language spec; broader valid-program differential generation remains intentionally out of scope per the separate-plans section.
- Independent review found that WCR-25 and WCR-26 needed actual release evidence, not alias checks: `verify:reproducible` now builds full-image fixtures twice in isolated output directories, compares artifact bytes and target metadata, and writes `dist/release/reproducibility-manifest.json`; `verify:stdlib` compiles documented stdlib module cases with real checked stdlib sources.
- Independent review also found that WCR-13 needed the lexical import scanner deleted, not merely bypassed. `ImportDiscovery`, `ModuleGraphLexer`, and their lexical scanner tests were removed; module graph discovery now flows through parser-owned import declarations.
- WCR-52 required structural enum operations in OptIR. Tagged unions now lower through explicit `enumTagStore`, `enumPayloadStore`, `enumTagLoad`, and `enumPayloadLoad` operations, and the verifier rejects payload loads unless they are reached through a compatible tag-discriminating switch edge.
- Diagnostics fixture drift is now part of `verify:extended` through `bun run generate:diagnostics -- --check`, so generated invalid-language fixtures cannot silently fall behind the spec.
- Ordinary match lowering needed to bind lowercase stdlib `Result` constructors as well as qualified/uppercase spellings; lowercase `ok(...)` and `err(...)` cases now bind payload locals through the same constructor-payload path.
- Final independent review found additional integration gaps after the first full pass:
  - SCCP now marks entry/runtime values and unknown incoming edge arguments overdefined, so joins cannot retain stale constants when one predecessor carries a runtime value.
  - Strict release skip accounting no longer treats echoed `--allow-missing-*` command text as a skipped phase; only actual skipped status markers classify a successful phase as skipped.
  - Tagged enum layout now models payload storage as a per-case union, keeps source-typed payload layouts available to stdlib `Result`/`Option`, and still publishes flat layout field facts for Proof-MIR compatibility.
  - Proof-MIR enum construct lowering now fails closed for dynamic tags instead of inventing case-zero payload metadata.
  - HIR enum constructor lowering now reports missing payload field records through a reachable fail-closed branch.
  - HIR enum-constructor fail-closed paths now register returned error expressions in the body index, preventing expression ID reuse after malformed enum metadata.
  - OptIR pass pipeline change detection now uses reference fast paths and cached stable fingerprints instead of serializing the whole program repeatedly.
  - The enum layout implementation was decomposed into focused payload/diagnostic helper modules to keep layout runtime files below maintainability caps.
  - UEFI AArch64 `.pdata` records now use image-relative `addr32nb` relocations, and PE parsing validates 8-byte AArch64 exception-directory records instead of accepting range-only data.
  - OptIR enum payload-load verification now computes transitive tag-case dominance with a forward must-analysis rather than requiring the immediate predecessor to be the switch block.
- A later independent audit of the completed OptIR work found three additional production correctness gaps and one WCR-47 clarification:
  - WCR-04 was incomplete for vectorization candidates: duplicate `operationId` entries could be silently collapsed by `operationMap`, and vector discovery/materialization could reuse candidate-local IDs. `operationMap` now rejects duplicates, vector discovery reserves IDs through the canonical fresh allocator, and loop/vector materialization allocates against existing scalar and vector operations.
  - WCR-06 was incomplete for cross-block memory order: Memory SSA and memory optimization now traverse CFG-reachable blocks, require dominance for forwarding, and expose deterministic unknown-merge states at joins where only some predecessors define a memory range.
  - WCR-19's audit was too narrow: all production `as never` sentinel casts under `src` were removed, attempt operand expression IDs now flow from lowering into canonicalization, and `tests/audit/wcr18-wcr19-sentinel-audit.test.ts` scans all runtime source for impossible never-cast sentinels.
  - WCR-47's original wording overstated the remaining production work: the top-level pipeline already flowed through `runOptIrPassPipeline`; the remaining `runPipelineStepToFixpoint` call is an internal fact-gated egraph convergence helper. `tests/unit/architecture/dependency-boundaries.test.ts` now locks down the pass manager as the only production pass-context constructor and public OptIR scheduling path.
- A final independent audit found two late closure gaps that were corrected before final verification:
  - WCR-03 still had a function-length mismatch because the entry thunk's logical context reload expands to two physical loads. The thunk unwind length is now derived from linked source symbols and decodes to the real 64-byte body. Source functions classified as `frameless-leaf` are omitted from linked unwind metadata, matching ARM64 exception handling rules instead of emitting false entry-frame xdata for an 8-byte boot leaf.
  - Running the stdlib verifier after that fix exposed real `serializable-unwind` boot functions. Backend unwind records now preserve frame size and saved-register facts, and the UEFI unwind encoder emits frame-size-backed xdata for those non-leaf source functions instead of rejecting them or reusing the entry thunk shape.
  - WCR-09 still exposed a caller-selectable `loopOperationIds` input. LICM now derives loop operations exclusively from the computed loop tree, and the production pipeline no longer imports or constructs a separate LICM loop-candidate list.
- The final UEFI unwind follow-up extracted `src/target/aarch64/backend/object/object-unwind-record.ts` so the additional typed unwind metadata did not grow the grandfathered `object-module.ts` giant file.
- The final fresh-context signoff review found four more closure gaps, all corrected before rerunning verification:
  - WCR-37's production stack-promotion step was still deriving positive non-escape evidence from missing escape facts. Escape analysis now records omitted evidence categories as unknown, `doesNotEscape` is true only with complete evidence, and the production pipeline no longer promotes stack regions from silence.
  - WCR-23's ARM64 PE parser still accepted non-AArch64 exception-directory shapes. Non-empty exception directories are now validated as 8-byte AArch64 `.pdata` records only, and parser fixtures use valid `.pdata` -> `.xdata` records.
  - WCR-16's module-cycle diagnostic reported only the back edge. The iterative module loader now carries the active path and emits stable cycle paths for direct and multi-module cycles while preserving diamond import de-duplication.
  - WCR-04/WCR-46 still allowed whole-program inlining to fall back to a pass-local allocator. Whole-program inlining and LICM now require the pass-manager context allocator, and tests inject allocators only at test boundaries.
- A subsequent fresh-context signoff review found four final hardening gaps, all corrected before rerunning verification:
  - WCR-23's AArch64 exception-directory parser still skipped all-zero `.pdata` rows. Non-empty exception directories now reject empty entries with deterministic offsets.
  - WCR-04's construction verifier handoff still built a `Map` that could collapse duplicate operation IDs before structural verification. Construction now builds a duplicate-checking operation table and returns a fail-closed `OPT_IR_INPUT_CONTRACT_INVALID` diagnostic.
  - WCR-16 import-cycle diagnostics were still warnings, allowing the frontend stage to continue. Import cycles are now error diagnostics, and the typed frontend stage rejects real cyclic module graphs before semantic execution.
  - WCR-24 release skip classification was text-fragile. It now recognizes line-level skip status markers and known skip stable-details, while incidental prose containing "skipped" remains a passing phase when the command exits 0.
- The final fresh-context package/identity/release/pass audit found five more integration gaps, all corrected before rerunning verification:
  - The UEFI package frontend still parsed source files directly and bypassed the parser-backed module loader's active-path cycle gate. Package parsing now uses a synchronous parser-backed loader over package source files, and direct and multi-module package import cycles fail at the target boundary with `LEX_IMPORT_CYCLE` source payloads.
  - WCR-20 still collapsed private predicate call identity and only recorded the first private-state transition for multi-input contracts. HIR predicate facts now preserve call argument expressions, semantic private-state surfaces emit one transition per private input, call lowering records all matching private transitions, and proof-check private predicate requirements compare predicate, place, arguments, and generation.
  - WCR-18/WCR-19 owner handling still hid wrapped `ownerFunctionId ?? functionId(0)` sentinels in attempt, validation, fact, call-proof, and take lowering. These paths now use `requireHirFunctionOwner`, report `HIR_MISSING_OWNER_FUNCTION`, and skip metadata; program-level HIR local/place owners use an explicit `program` owner instead of function zero.
  - WCR-25 reproducibility evidence did not hash source inputs or validation reports. The manifest now includes sorted source input digests and per-build validation report digests, and `verify:reproducible` compares those digests across isolated build passes.
  - WCR-43 pass execution still allowed a decorative `OptIrPassResult.program: unknown` and fixpoint convergence ignored explicit changed flags. Pass results now carry `OptIrProgram`, and the pass manager honors explicit `{ result, changed }` pass outcomes when deciding fixpoint convergence.
- The final fresh-context closure review found three additional low-blast-radius gaps, all corrected before rerunning verification:
  - WCR-37's production stack-promotion step had complete escape-analysis APIs but still omitted production evidence sets. The pipeline now passes explicit address-taken, callback, exported-root, unknown-call, and external-flow evidence, promotes plain activation stack locals, and preserves ordered-effect/external escape boundaries.
  - WCR-07 SCCP could still mark an operation result permanently overdefined when producer constants appeared later in block order but had higher operation IDs. SCCP now keeps foldable operations and edge arguments unknown until their sources become constant or overdefined.
  - WCR-26/WCR-29 stdlib verification duplicated the documented module list outside the compatibility document. `verify:stdlib` now parses the supported public module list from `docs/stdlib/compatibility.md`, and the integration compatibility test consumes that verifier source of truth.
  - The subsystem maintainability gate caught the new stack-promotion escape policy growing `pipeline-steps.ts` past the OptIR line cap. The production evidence policy was extracted to `src/opt-ir/passes/stack-promotion-escape.ts` before final verification.
- The next fresh-context signoff review found three more contract-enforcement gaps, all corrected before rerunning verification:
  - WCR-43's pass-manager contract recorded `requiresVerifierAfterRun` but did not execute the structural verifier per scheduled pass. `runOptIrPassPipeline` now honors that contract, records `after-pass` checkpoints, and fails closed before later optimizers see invalid pass output.
  - WCR-29's stdlib verifier still enforced documented modules more strongly than documented public names. `verify:stdlib` now includes a public-surface case that parses documented exports and enum cases from `docs/stdlib/compatibility.md` and compares them with the stdlib source declarations before running compile smoke cases.
  - Proof-MIR canonicalization still had a maintenance-visible zero-ID fallback when a function draft was missing its monomorphized function instance. `freezeFunctionDraft` now reports `PROOF_MIR_INVALID_CANONICAL_ID_ASSIGNMENT` and returns an error instead of synthesizing `functionId(0)` / `itemId(0)` metadata.
- The resulting full-suite rerun exposed stale iterator Proof-MIR integration fixtures that were still relying on partial `MonoFunctionInstance` objects and the old zero-ID fallback. The iterator harness now builds complete function instances with stable source IDs and full signatures, and the iterator Proof-MIR snapshots were refreshed to lock in the real identities.
- Local strict release probes confirmed the strict release gate is intentionally not satisfied in this dirty implementation environment: `verify:qemu` requires `WRELA_QEMU_AARCH64`, `verify:lean` requires `lake`, and `verify:reproducible` rejects the dirty worktree. The reproducible build was therefore demonstrated with the documented developer flag `--allow-dirty`; a clean `verify:release` pass remains a release-machine gate once required tools and a clean tree are available.

Closure evidence for all WCR tasks is tracked in `docs/reviews/2026-07-05-remediation-status.md`.

## Architecture Program Rules

Architecture tasks in this plan must become canonical, not decorative. A new abstraction is acceptable only when the same numbered program defines:

- the old path it replaces
- the migration sequence
- the deletion point for duplicate APIs or duplicate traversal
- the invariant enforced after migration
- tests that fail if a future change reintroduces the old path

The architecture programs in this plan are:

- **Canonical OptIR pass/dataflow framework:** WCR-04 through WCR-10, WCR-35, WCR-37, WCR-38, and WCR-43 through WCR-47.
- **Typed compiler pipeline contract:** WCR-11, WCR-31, and WCR-48 through WCR-50.
- **Canonical frontend syntax model:** WCR-33 and WCR-58 through WCR-60. This program extends the existing green/red syntax tree; it does not add a second syntax arena.
- **Canonical HIR/mono transform framework:** WCR-34 and WCR-54 through WCR-57. This program migrates the mono cloner family, not only a toy helper.
- **Sum types and real stdlib:** WCR-39 through WCR-41, WCR-51 through WCR-52, WCR-61, and WCR-53.

## Separate Plans Required

These are real world-class concerns, but they are not part of this remediation task graph because adding them here would break file ownership and task atomicity:

- Inliner store-callee conservatism and call-summary precision beyond the return-binding cleanup in WCR-38.
- Register allocator hinting, eviction strategy, and reconciliation with any existing ledger claims.
- Seeded valid-program generation through differential lanes. WCR-27 covers invalid diagnostics; valid differential generation deserves its own generator, oracle, and lane plan.
- Human-readable token names in all parser messages after WCR-14 introduces the missing block/index diagnostics.

## Dependency And Parallel Lane Model

Subagents can work in parallel only when their selected tasks have no shared files and all `Depends` entries are complete. The dependency table is authoritative.

| Task   | Depends                                | Lane                      |
| ------ | -------------------------------------- | ------------------------- |
| WCR-01 | None                                   | backend-peephole          |
| WCR-02 | None                                   | linker-relocation         |
| WCR-03 | WCR-02                                 | unwind-metadata           |
| WCR-04 | None                                   | optir-id-verifier         |
| WCR-05 | WCR-04                                 | optir-id-verifier         |
| WCR-06 | WCR-04, WCR-43, WCR-44                 | optir-memory              |
| WCR-07 | WCR-04, WCR-43, WCR-44                 | optir-sccp                |
| WCR-08 | WCR-04, WCR-43, WCR-44                 | optir-dce                 |
| WCR-09 | WCR-04, WCR-43                         | optir-licm                |
| WCR-10 | WCR-04, WCR-43                         | optir-cfg                 |
| WCR-11 | WCR-04                                 | scalar-replacement-state  |
| WCR-12 | WCR-28                                 | frontend-loader           |
| WCR-13 | WCR-12                                 | frontend-loader           |
| WCR-14 | WCR-18                                 | parser-expression         |
| WCR-15 | WCR-12                                 | semantic-names            |
| WCR-16 | WCR-12                                 | frontend-loader           |
| WCR-17 | WCR-12                                 | architecture-tests        |
| WCR-18 | None                                   | hir-fail-closed           |
| WCR-19 | WCR-18                                 | hir-sentinel-removal      |
| WCR-20 | WCR-18                                 | hir-contract-identity     |
| WCR-21 | None                                   | proof-permissions         |
| WCR-22 | WCR-21                                 | proof-permissions         |
| WCR-23 | WCR-03                                 | pe-validation             |
| WCR-24 | WCR-23                                 | release-policy            |
| WCR-25 | WCR-24                                 | release-policy            |
| WCR-26 | WCR-25                                 | release-policy            |
| WCR-27 | WCR-14, WCR-18                         | diagnostics-corpus        |
| WCR-28 | None                                   | test-decomposition        |
| WCR-29 | WCR-26, WCR-53                         | stdlib-compatibility      |
| WCR-30 | WCR-28, WCR-50                         | public-api                |
| WCR-31 | WCR-11                                 | typed-pipeline-contract   |
| WCR-32 | WCR-18                                 | hir-expression-typing     |
| WCR-33 | None                                   | canonical-frontend-syntax |
| WCR-34 | WCR-18                                 | hir-mono-transform        |
| WCR-35 | WCR-43                                 | optir-pass-diagnostics    |
| WCR-36 | WCR-13, WCR-15, WCR-18, WCR-22         | safety-regression-corpus  |
| WCR-37 | WCR-31, WCR-43, WCR-44                 | optir-stack-promotion     |
| WCR-38 | WCR-04, WCR-43                         | optir-inlining            |
| WCR-39 | None                                   | sum-type-syntax           |
| WCR-40 | WCR-39                                 | sum-type-layout           |
| WCR-41 | WCR-40                                 | sum-type-construction     |
| WCR-42 | WCR-21, WCR-22                         | proof-helper-hygiene      |
| WCR-43 | WCR-04                                 | optir-pass-framework      |
| WCR-44 | WCR-43                                 | optir-dataflow-framework  |
| WCR-45 | WCR-07, WCR-08, WCR-10, WCR-35         | optir-pass-migration      |
| WCR-46 | WCR-06, WCR-09, WCR-37, WCR-38, WCR-35 | optir-pass-migration      |
| WCR-47 | WCR-45, WCR-46                         | optir-pass-manager        |
| WCR-48 | WCR-31, WCR-12, WCR-15                 | typed-pipeline-contract   |
| WCR-49 | WCR-31, WCR-18, WCR-47                 | typed-pipeline-contract   |
| WCR-50 | WCR-23, WCR-48, WCR-49                 | typed-pipeline-contract   |
| WCR-51 | WCR-41                                 | sum-type-matching         |
| WCR-52 | WCR-51                                 | sum-type-optir-lowering   |
| WCR-53 | WCR-61                                 | real-stdlib-option-result |
| WCR-54 | WCR-34                                 | hir-mono-transform        |
| WCR-55 | WCR-54                                 | hir-mono-transform        |
| WCR-56 | WCR-55                                 | hir-mono-transform        |
| WCR-57 | WCR-56                                 | hir-mono-transform        |
| WCR-58 | WCR-33                                 | canonical-frontend-syntax |
| WCR-59 | WCR-58                                 | canonical-frontend-syntax |
| WCR-60 | WCR-17, WCR-59                         | canonical-frontend-syntax |
| WCR-61 | WCR-52                                 | result-attempt-validation |
| WCR-99 | All other WCR tasks                    | remediation-closure       |

Parallel lanes that can start immediately:

- `backend-peephole`: WCR-01.
- `linker-relocation`: WCR-02, then WCR-03, then WCR-23.
- `optir-id-verifier`: WCR-04, then WCR-05 and WCR-43.
- `optir-pass-framework`: WCR-43, then WCR-44, then the existing optimizer correctness tasks, then WCR-45 through WCR-47.
- `hir-fail-closed`: WCR-18, then WCR-14, WCR-19, WCR-20, WCR-27, and WCR-32.
- `canonical-frontend-syntax`: WCR-33, then WCR-58 through WCR-60.
- `hir-mono-transform`: WCR-34, then WCR-54 through WCR-57.
- `test-decomposition`: WCR-28.
- `frontend-loader`: after WCR-28, WCR-12, then WCR-13, WCR-15, WCR-16, and WCR-17.
- `proof-permissions`: WCR-21, then WCR-22, then WCR-42.
- `sum-type-syntax`: WCR-39, then WCR-40 through WCR-41, then WCR-51 through WCR-52, then WCR-61 and WCR-53.

Every implementation task must finish with:

```bash
bun run agent:check
```

For tasks touching formatting-sensitive files, run:

```bash
bun run format
bun run agent:check
```

---

## WCR-01: Replace AArch64 Pair-Load Peephole With Safe Pair Candidate Rewriter

**Files:**

- Modify: `src/target/aarch64/backend/finalization/peepholes.ts`
- Modify: `src/target/aarch64/backend/finalization/post-ra-scheduler.ts`
- Test: `tests/unit/target/aarch64/backend/post-ra-scheduler.test.ts`
- Add: `tests/unit/target/aarch64/backend/peepholes.test.ts`

**Description:**

The current `formAArch64PairLoadPeepholes` collapses two `ldr` instructions into one `ldp` by copying only the first instruction, which loses the destination of the second load. Replace it with a rewriter that only forms a pair when both destination registers, both memory operands, size, base, offset, and adjacency are represented explicitly. If the existing machine instruction model cannot express two destinations and pair memory addressing correctly, disable this peephole and keep both loads unchanged.

**Implementation Steps:**

- [ ] Add a regression test proving two independent loads still produce two destination definitions after post-RA finalization.
- [ ] Add a pair-load positive test only if the instruction model can encode both destination registers and the correct memory offset.
- [ ] Change the peephole API to return either the original instruction list or a fully modeled pair instruction with two destinations.
- [ ] Ensure stable keys are regenerated or composed so no final instruction duplicates a stable key.
- [ ] Ensure post-RA scheduling preserves dataflow definitions for both loaded registers.
- [ ] Run the backend unit tests and `bun run agent:check`.

**Acceptance Criteria:**

- A two-load sequence never loses the second destination register.
- A pair-load is emitted only when both loads are adjacent, same width, same base register, naturally aligned, and offsets differ by one element.
- A negative test covers mismatched width, mismatched base, non-adjacent offsets, and destination loss.
- No final machine instruction duplicates an output register or stable key incorrectly.

**Example Regression Test Shape:**

```ts
test("post-RA peepholes do not drop the second load destination", () => {
  const result = scheduleAArch64PostAllocation({
    enablePeepholes: true,
    instructions: [
      {
        id: 1,
        stableKey: "load-a",
        opcode: "ldr",
        definedRegisters: ["x8"],
        usedRegisters: ["sp"],
        memoryKey: "frame:16",
      },
      {
        id: 2,
        stableKey: "load-b",
        opcode: "ldr",
        definedRegisters: ["x9"],
        usedRegisters: ["sp"],
        memoryKey: "frame:24",
      },
    ],
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected scheduled instructions");
  expect(definedRegisters(result.value.instructions)).toContain("x8");
  expect(definedRegisters(result.value.instructions)).toContain("x9");
});
```

**Example Implementation Shape:**

```ts
type PairLoadCandidate =
  | { readonly kind: "pair"; readonly instruction: AArch64MachineInstruction }
  | { readonly kind: "unchanged"; readonly instructions: readonly AArch64MachineInstruction[] };

function tryFormPairLoadCandidate(
  first: AArch64MachineInstruction,
  second: AArch64MachineInstruction,
): PairLoadCandidate {
  if (!isPairLoadRepresentable(first, second)) {
    return { kind: "unchanged", instructions: [first, second] };
  }

  return {
    kind: "pair",
    instruction: buildPairLoadInstruction({ first, second }),
  };
}
```

**Verification Commands:**

```bash
bun test tests/unit/target/aarch64/backend/post-ra-scheduler.test.ts
bun test tests/unit/target/aarch64/backend/peepholes.test.ts
bun run agent:check
```

**Commit Message:**

```text
Fix AArch64 pair-load peephole destination preservation -Codex Automated
```

---

## WCR-02: Correct ARM64 PE/COFF REL32 Relocation Semantics

**Files:**

- Modify: `src/linker/aarch64/aarch64-relocations.ts`
- Test: `tests/unit/linker/aarch64/aarch64-relocations.test.ts`
- Test: `tests/unit/target/uefi-aarch64/entry-thunk.test.ts`

**Description:**

`IMAGE_REL_ARM64_REL32` is relative to the byte after the relocation field. The current implementation uses `targetRva - patchRva`, which is off by four bytes for 32-bit fields. Update `rel32` only. Do not change branch relocation semantics unless existing branch tests prove a separate issue.

**Implementation Steps:**

- [ ] Add a unit test where `patchRva = 0x1000`, `targetRva = 0x1100`, and the encoded `rel32` value is `0xfc`.
- [ ] Add a negative regression test that would fail under `targetRva - patchRva`.
- [ ] Update the `rel32` calculation to use `patchRva + widthBytes`.
- [ ] Keep `branch26`, `branch19`, and `branch14` tests passing.
- [ ] Add an entry-thunk test proving `.pdata` and `.xdata` relocations encode from the end of each 32-bit relocation slot.

**Acceptance Criteria:**

- `rel32` encodes `targetRva - (patchRva + 4)` for 4-byte relocations.
- Existing branch relocation behavior is unchanged.
- Entry-thunk relocation tests assert exact byte output after relocation application.

**Example Regression Test Shape:**

```ts
test("ARM64 REL32 is relative to the end of the relocation field", () => {
  const encoded = encodeAArch64Relocation({
    family: "rel32",
    patchRva: 0x1000,
    targetRva: 0x1100,
    widthBytes: 4,
  });

  expect(encoded).toBe(0xfc);
});
```

**Example Implementation Shape:**

```ts
if (input.family === "rel32") {
  return input.targetRva - (input.patchRva + input.widthBytes);
}
```

**Verification Commands:**

```bash
bun test tests/unit/linker/aarch64/aarch64-relocations.test.ts
bun test tests/unit/target/uefi-aarch64/entry-thunk.test.ts
bun run agent:check
```

**Commit Message:**

```text
Correct ARM64 PE REL32 relocation basis -Codex Automated
```

---

## WCR-03: Emit Spec-Valid UEFI AArch64 Unwind Metadata

**Files:**

- Modify: `src/target/uefi-aarch64/entry-thunk.ts`
- Modify or add: `src/target/uefi-aarch64/unwind-info.ts`
- Test: `tests/unit/target/uefi-aarch64/entry-thunk.test.ts`
- Test: `tests/unit/linker/unwind-metadata.test.ts`
- Test: `tests/integration/target/uefi-aarch64/compile-uefi-aarch64-image.test.ts`

**Description:**

The entry thunk currently emits short stand-in `.pdata` and `.xdata` bytes. Replace them with a small typed ARM64 unwind encoder for the exact thunk prologue/epilogue shape. Validate `.pdata` entry count, function length, unwind info RVA, alignment, and unwind byte layout.

**Implementation Steps:**

- [ ] Add a typed encoder function for entry-thunk unwind records.
- [ ] Model the thunk frame shape explicitly: saved registers, stack allocation, prologue length, epilogue shape, and function length.
- [ ] Generate `.pdata` with start RVA and unwind-data RVA relocation fields.
- [ ] Generate `.xdata` with version, function length, prologue/epilogue metadata, and unwind opcodes accepted by Windows ARM64 exception handling.
- [ ] Add a test decoder that reads the emitted bytes back into named fields.
- [ ] Add integration coverage that the packaged image contains `.pdata` and `.xdata` sections with expected sizes and relocations.

**Acceptance Criteria:**

- Entry-thunk `.pdata` is exactly two 32-bit fields per function entry.
- Entry-thunk `.xdata` decodes into the same prologue/epilogue shape emitted by the thunk generator.
- Unwind sections are aligned according to PE/COFF requirements.
- Tests fail if unwind bytes are all-zero stand-ins or frame-shape hashes.

**Example Test Decoder Shape:**

```ts
test("entry thunk unwind metadata decodes to the thunk frame shape", () => {
  const objects = createEntryThunkUnwindObjects({ entryThunkIndex: 0, functionLength: 64 });
  const decoded = decodeArm64PackedUnwindInfo(objects.xdata.bytes);

  expect(decoded.functionLength).toBe(64);
  expect(decoded.savedRegisters).toEqual(["x29", "x30"]);
  expect(decoded.stackAllocationBytes).toBe(16);
});
```

**Example Encoder Shape:**

```ts
export interface Arm64ThunkUnwindShape {
  readonly functionLengthBytes: number;
  readonly prologueLengthBytes: number;
  readonly stackAllocationBytes: number;
  readonly savedRegisterPairs: readonly Arm64SavedRegisterPair[];
}

export function encodeArm64ThunkUnwindInfo(shape: Arm64ThunkUnwindShape): Uint8Array {
  validateArm64ThunkUnwindShape(shape);
  return encodePackedUnwindRecord(shape);
}
```

**Verification Commands:**

```bash
bun test tests/unit/target/uefi-aarch64/entry-thunk.test.ts
bun test tests/unit/linker/unwind-metadata.test.ts
bun test tests/integration/target/uefi-aarch64/compile-uefi-aarch64-image.test.ts
bun run agent:check
```

**Commit Message:**

```text
Emit spec-valid AArch64 UEFI unwind metadata -Codex Automated
```

---

## WCR-04: Add Canonical OptIR ID Allocator and Duplicate-ID Verification

**Files:**

- Add: `src/opt-ir/id-allocation.ts`
- Modify: `src/opt-ir/verify/structural-verifier.ts`
- Modify: `src/opt-ir/program.ts`
- Modify: `src/opt-ir/cfg.ts`
- Modify: `src/opt-ir/passes/whole-program-inlining-splice.ts`
- Modify: `src/opt-ir/passes/licm.ts`
- Test: `tests/unit/opt-ir/id-allocation.test.ts`
- Test: `tests/unit/opt-ir/structural-verifier.test.ts`

**Description:**

Create one canonical fresh-ID allocator for whole-program OptIR transformations. It must scan every function, block, edge, operation, value, region, and optimization metadata ID that can collide. Then make table builders and the structural verifier reject duplicate IDs instead of last-write-wins behavior.

**Implementation Steps:**

- [ ] Define `OptIrFreshIdAllocator` with methods for every ID kind used by OptIR transforms.
- [ ] Implement `createOptIrFreshIdAllocator(program)` by scanning the whole program.
- [ ] Replace local allocators in LICM and whole-program inlining with the shared allocator.
- [ ] Update `optIrTable` and `optIrCfgEdgeTable` to return diagnostics or throw a typed internal error on duplicate IDs.
- [ ] Add verifier diagnostics for duplicate operation IDs, value IDs, block IDs, edge IDs, function IDs, and region IDs.
- [ ] Add a multi-function regression where LICM preheader IDs would previously collide with another function.

**Acceptance Criteria:**

- No pass mints IDs by scanning only one function.
- Duplicate IDs are rejected before any transform consumes a table.
- Tests prove duplicate operation and edge IDs are reported with both colliding IDs and owning function/block context.
- Whole-program inlining and LICM share the same allocator module.

**Example Allocator Shape:**

```ts
export interface OptIrFreshIdAllocator {
  nextOperationId(): OptIrOperationId;
  nextValueId(): OptIrValueId;
  nextBlockId(): OptIrBlockId;
  nextEdgeId(): OptIrCfgEdgeId;
  nextRegionId(): OptIrOptimizationRegionId;
}

export function createOptIrFreshIdAllocator(program: OptIrProgram): OptIrFreshIdAllocator {
  const used = collectOptIrIds(program);
  return allocatorFromUsedIds(used);
}
```

**Example Collision Test Shape:**

```ts
test("LICM allocates preheader IDs globally across all functions", () => {
  const program = programWithTwoFunctionsWhereSecondAlreadyUsesNextLocalId();
  const optimized = runLicm(program);

  expect(verifyOptIrProgram(optimized).diagnostics).toEqual([]);
  expect(allOptIrOperationIds(optimized).size).toBe(allOptIrOperations(optimized).length);
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/id-allocation.test.ts
bun test tests/unit/opt-ir/structural-verifier.test.ts
bun test tests/unit/opt-ir/passes/licm.test.ts
bun test tests/unit/opt-ir/passes/whole-program-inlining-splice.test.ts
bun run agent:check
```

**Commit Message:**

```text
Add canonical OptIR fresh ID allocation -Codex Automated
```

---

## WCR-05: Verify CFG Edge Ownership and Terminator Consistency

**Files:**

- Modify: `src/opt-ir/terminators.ts`
- Modify: `src/opt-ir/verify/structural-verifier.ts`
- Test: `tests/unit/opt-ir/terminators.test.ts`
- Test: `tests/unit/opt-ir/structural-verifier.test.ts`

**Description:**

The structural verifier currently checks that terminator edge IDs exist, but not that each edge is owned by the block containing the terminator. Add ownership checks for every terminator edge reference.

**Implementation Steps:**

- [ ] Extend terminator edge verification input to include the owning block ID.
- [ ] Check `edge.from === ownerBlockId` for every terminator edge reference.
- [ ] Check that terminator successor block IDs match the referenced edge `to` IDs.
- [ ] Emit typed diagnostics with owner block, edge ID, actual `from`, and expected `from`.
- [ ] Add tests for branch, conditional branch, switch/table branch, return, and unreachable terminators according to existing terminator kinds.

**Acceptance Criteria:**

- A block cannot point at another block's edge through its terminator.
- A terminator cannot reference an edge whose target disagrees with the terminator successor.
- Diagnostics are stable and do not depend on Map insertion order.

**Example Test Shape:**

```ts
test("verifier rejects terminator edge owned by a different block", () => {
  const program = programWithTerminatorReferencingForeignEdge();
  const result = verifyOptIrProgram(program);

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "OPT_IR_TERMINATOR_EDGE_FROM_MISMATCH",
      edgeId: 7,
      expectedFrom: 1,
      actualFrom: 2,
    }),
  );
});
```

**Example Implementation Shape:**

```ts
verifyOptIrTerminatorEdges({
  ownerBlockId: block.blockId,
  edges,
  terminator: block.terminator,
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/terminators.test.ts
bun test tests/unit/opt-ir/structural-verifier.test.ts
bun run agent:check
```

**Commit Message:**

```text
Verify OptIR terminator edge ownership -Codex Automated
```

---

## WCR-06: Replace Memory SSA Block-ID Ordering With CFG-Aware Traversal

**Files:**

- Modify: `src/opt-ir/analyses/memory-ssa.ts`
- Modify: `src/opt-ir/passes/memory-optimization.ts`
- Modify: `src/opt-ir/analyses/dominance.ts`
- Test: `tests/unit/opt-ir/analyses/memory-ssa.test.ts`
- Test: `tests/unit/opt-ir/passes/memory-optimization.test.ts`

**Description:**

Memory SSA and memory optimization currently process operations by sorted block ID, which is not program order and is unsound across branches and joins. Reuse `computeOptIrDominance` from `src/opt-ir/analyses/dominance.ts` and replace block-id ordering with CFG-aware traversal. At joins, insert or model memory phi states so forwarding and dead-store elimination only happen when all incoming paths agree.

**Implementation Steps:**

- [ ] Reuse `computeOptIrDominance(functionIr)` for per-function dominance queries.
- [ ] Keep the existing set-based dominance implementation unless the new memory optimization tests show it dominates runtime; if it does, upgrade `dominance.ts` in this task and preserve the existing public API.
- [ ] Make memory SSA input a single function plus its CFG, not a program-order flattening by block ID.
- [ ] Represent memory states per block entry and block exit.
- [ ] At a join block, merge incoming memory versions by alias range.
- [ ] Mark a memory value as known only when all predecessors provide the same reaching store for the same range.
- [ ] Update memory optimization to require memory SSA proof before store elimination or load forwarding.
- [ ] Add branch/join tests where one path stores and another path does not.
- [ ] Add loop tests where a store in a loop body must not be eliminated based on preheader state.

**Acceptance Criteria:**

- No memory optimization decision is based on numeric block ID order.
- Load forwarding across a join happens only when every incoming path reaches the same stored value.
- Dead store elimination preserves stores visible on any CFG path.
- Memory SSA exposes deterministic diagnostics or debug metadata for unknown merge states.

**Example Unsoundness Test Shape:**

```ts
test("memory optimization does not forward through a join when only one predecessor stores", () => {
  const program = programWithIfElse({
    thenOps: [store("slot", constant(1))],
    elseOps: [],
    joinOps: [load("slot")],
  });

  const optimized = optimizeMemory(program);

  expect(findLoadFromSlot(optimized, "slot")).toBeDefined();
  expect(findConstantReplacementForJoinLoad(optimized)).toBeUndefined();
});
```

**Example Analysis Shape:**

```ts
interface MemoryBlockState {
  readonly entry: MemoryVersionMap;
  readonly exit: MemoryVersionMap;
}

function mergePredecessorMemoryStates(predecessors: readonly MemoryBlockState[]): MemoryVersionMap {
  return mergeOnlyUnanimousRanges(predecessors.map((state) => state.exit));
}
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/analyses/memory-ssa.test.ts
bun test tests/unit/opt-ir/passes/memory-optimization.test.ts
bun run agent:check
```

**Commit Message:**

```text
Make OptIR memory SSA CFG-aware -Codex Automated
```

---

## WCR-07: Implement Full SCCP Lattice With Overdefined State

**Files:**

- Modify: `src/opt-ir/passes/sccp.ts`
- Test: `tests/unit/opt-ir/passes/sccp.test.ts`

**Description:**

SCCP currently records a constant once and silently ignores conflicting assignments. Implement a standard lattice with `unknown`, `constant`, and `overdefined`. Propagation must move monotonically through that lattice.

**Implementation Steps:**

- [ ] Define a `SccpValueLattice` union type.
- [ ] Replace constant-only maps with lattice maps.
- [ ] Implement `meetSccpValues(left, right)`.
- [ ] Update branch folding to fold only when the condition lattice is `constant`.
- [ ] Update arithmetic folding to return `overdefined` if any operand is `overdefined`.
- [ ] Replace `0 as never` sentinel values with explicit unreachable diagnostics or fail-closed lattice states.
- [ ] Add tests for conflicting assignments into a phi/join value.
- [ ] Add tests proving a branch is not folded when its condition is `overdefined`.

**Acceptance Criteria:**

- Conflicting constants produce `overdefined`, never stale first-writer-wins constants.
- SCCP is monotonic and reaches a stable fixed point.
- No `as never` sentinel remains in `src/opt-ir/passes/sccp.ts`.

**Example Lattice Shape:**

```ts
type SccpValueLattice =
  | { readonly kind: "unknown" }
  | { readonly kind: "constant"; readonly value: OptIrConstant }
  | { readonly kind: "overdefined" };

function meetSccpValues(left: SccpValueLattice, right: SccpValueLattice): SccpValueLattice {
  if (left.kind === "unknown") return right;
  if (right.kind === "unknown") return left;
  if (
    left.kind === "constant" &&
    right.kind === "constant" &&
    sameConstant(left.value, right.value)
  ) {
    return left;
  }
  return { kind: "overdefined" };
}
```

**Example Test Shape:**

```ts
test("SCCP marks conflicting join value overdefined", () => {
  const program = programWithJoinConstants(1n, 2n);
  const optimized = runSccp(program);

  expect(joinValueWasConstantFolded(optimized)).toBe(false);
  expect(branchConditionWasFolded(optimized)).toBe(false);
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/passes/sccp.test.ts
bun run agent:check
```

**Commit Message:**

```text
Implement SCCP overdefined lattice state -Codex Automated
```

---

## WCR-08: Make DCE CFG-Liveness Aware

**Files:**

- Modify: `src/opt-ir/passes/dce.ts`
- Add or modify: `src/opt-ir/analyses/liveness.ts`
- Test: `tests/unit/opt-ir/passes/dce.test.ts`

**Description:**

DCE currently walks a flat reverse operation list and can delete values needed on other CFG paths. Add a backward dataflow liveness analysis over blocks and use it to decide whether each operation result is live.

**Implementation Steps:**

- [ ] Implement `computeOptIrLiveness(functionIr)` with `liveIn` and `liveOut` sets per block.
- [ ] Treat terminator operands, side-effecting operations, memory writes, calls, returns, proofs, and externally visible values as roots.
- [ ] Update DCE to delete pure operations only when every produced value is dead at the operation point.
- [ ] Preserve operations that define values consumed in successor blocks.
- [ ] Add join tests where a value computed in one predecessor is consumed after the join.
- [ ] Add branch tests where deleting a value in one block would break a terminator operand.

**Acceptance Criteria:**

- DCE decisions are based on per-block liveness, not a flat reverse list.
- Values used by successor blocks are preserved.
- Pure dead computations in straight-line code are still removed.

**Example Liveness Shape:**

```ts
interface OptIrBlockLiveness {
  readonly liveIn: ReadonlySet<OptIrValueId>;
  readonly liveOut: ReadonlySet<OptIrValueId>;
}

export function computeOptIrLiveness(
  functionIr: OptIrFunction,
): ReadonlyMap<OptIrBlockId, OptIrBlockLiveness> {
  return solveBackwardDataflow(functionIr, transferLiveness);
}
```

**Example Test Shape:**

```ts
test("DCE preserves values used after a CFG join", () => {
  const program = programWhereThenValueFlowsToJoinReturn();
  const optimized = eliminateDeadCode(program);

  expect(valueDefinitionExists(optimized, "then-value")).toBe(true);
  expect(verifyOptIrProgram(optimized).diagnostics).toEqual([]);
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/passes/dce.test.ts
bun run agent:check
```

**Commit Message:**

```text
Make OptIR DCE CFG-liveness aware -Codex Automated
```

---

## WCR-09: Hoist LICM Operations In Dependency Order

**Files:**

- Modify: `src/opt-ir/passes/licm.ts`
- Test: `tests/unit/opt-ir/passes/licm.test.ts`

**Description:**

LICM selects hoistable operations in block-id/program order and appends them to a preheader. This can move a consumer before its producer. Sort hoisted operations by value dependencies within the hoisted set before insertion.

**Implementation Steps:**

- [ ] Build a dependency graph among hoisted operations using operand value definitions.
- [ ] Topologically sort hoisted operations before moving them.
- [ ] Detect cycles inside the hoisted set and keep cyclic operations in their original loop blocks.
- [ ] Keep side-effecting, memory-dependent, and proof-sensitive operations unhoisted unless existing safety checks prove invariance.
- [ ] Delete the redundant `loopOperationIds` pass input and its empty-set-means-all fallback; LICM must derive loop operations from the loop tree and function body.
- [ ] Add a regression where block IDs would place a consumer before a producer.
- [ ] Add a verifier run inside the LICM test to catch use-before-def after hoisting.

**Acceptance Criteria:**

- Every hoisted operation appears after its hoisted producers in the preheader.
- LICM leaves cyclic dependencies untouched.
- Existing LICM positive cases still hoist independent invariant operations.
- No LICM caller can pass an empty `loopOperationIds` set that changes pass meaning.

**Example Sorting Shape:**

```ts
function orderHoistedOperationsByDependencies(
  operations: readonly OptIrOperation[],
  definitions: ReadonlyMap<OptIrValueId, OptIrOperationId>,
): readonly OptIrOperation[] {
  return topologicalSortOperations({
    operations,
    edges: dependencyEdgesWithinSelection(operations, definitions),
  });
}
```

**Example Test Shape:**

```ts
test("LICM inserts hoisted producer before hoisted consumer", () => {
  const program = loopWhereConsumerBlockIdSortsBeforeProducer();
  const optimized = runLicm(program);
  const preheaderOps = operationsInLoopPreheader(optimized);

  expect(indexOfOperation(preheaderOps, "producer")).toBeLessThan(
    indexOfOperation(preheaderOps, "consumer"),
  );
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/passes/licm.test.ts
bun run agent:check
```

**Commit Message:**

```text
Order LICM hoists by data dependencies -Codex Automated
```

---

## WCR-10: Replace CFG Simplification Tiny Fuel With Worklist Fixed Point

**Files:**

- Modify: `src/opt-ir/passes/cfg-simplification.ts`
- Test: `tests/unit/opt-ir/passes/cfg-simplification.test.ts`

**Description:**

CFG simplification uses a default fuel of 8 and removes only one redundant edge per iteration. Replace this with a bounded worklist fixed point. The bound should scale with graph size and emit a diagnostic if exceeded.

**Implementation Steps:**

- [ ] Replace fixed `fuel = 8` default with `maxIterations = graphSize * 4 + 16`.
- [ ] Use a worklist of changed blocks/edges rather than whole-program repeated scanning.
- [ ] Remove all redundant edges discovered in one local rewrite.
- [ ] Emit an optimizer diagnostic if the worklist exceeds the bound.
- [ ] Add a test with more than 8 simplification opportunities.
- [ ] Add a no-infinite-loop test with a malformed or oscillating graph fixture.

**Acceptance Criteria:**

- A graph requiring more than 8 local simplifications fully simplifies.
- The pass terminates deterministically.
- If the bound is exceeded, the pass returns a diagnostic and leaves the program structurally valid.

**Example Worklist Shape:**

```ts
const maxIterations = countOptIrBlocks(program) * 4 + countOptIrEdges(program) * 2 + 16;
const worklist = initializeCfgSimplificationWorklist(program);

while (worklist.hasItems() && iterations < maxIterations) {
  const item = worklist.take();
  const changes = simplifyCfgItem(program, item);
  worklist.enqueueAll(changes.affectedItems);
}
```

**Example Test Shape:**

```ts
test("CFG simplification reaches fixed point beyond eight rewrites", () => {
  const program = chainOfRedundantBlocks({ length: 20 });
  const result = simplifyCfg(program);

  expect(countRedundantBlocks(result.program)).toBe(0);
  expect(result.diagnostics).toEqual([]);
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/passes/cfg-simplification.test.ts
bun run agent:check
```

**Commit Message:**

```text
Make CFG simplification worklist based -Codex Automated
```

---

## WCR-11: Type Scalar Replacement Pass State

**Files:**

- Modify: `src/opt-ir/passes/scalar-replacement.ts`
- Add or modify: `src/opt-ir/passes/pass-result.ts`
- Modify callers in: `src/opt-ir/passes/pipeline-steps.ts`
- Test: `tests/unit/opt-ir/passes/scalar-replacement.test.ts`

**Description:**

Scalar replacement currently writes `operations` and `optimizationRegions` sidecar fields onto an `OptIrProgram` intersection type. Replace this with an explicit pass result or pipeline state type so pass boundaries are typed and inspectable.

**Implementation Steps:**

- [ ] Define a typed `OptIrPassResult<TProgram, TMetadata>` or specific scalar replacement result type.
- [ ] Return scalar replacement metadata separately from the program.
- [ ] Update downstream callers to consume metadata through a named field.
- [ ] Delete dynamic probes for `program.operations` and `program.optimizationRegions`.
- [ ] Add TypeScript-level tests or compile checks proving `OptIrProgram` does not expose those sidecar fields.
- [ ] Add runtime tests proving scalar replacement metadata is still available to the pipeline.

**Acceptance Criteria:**

- `OptIrProgram` remains the canonical program model and has no magic sidecars.
- Scalar replacement metadata has a named type.
- No code writes undeclared fields to an `OptIrProgram`.

**Example Result Shape:**

```ts
export interface ScalarReplacementResult {
  readonly program: OptIrProgram;
  readonly metadata: ScalarReplacementMetadata;
  readonly diagnostics: readonly OptIrOptimizationDiagnostic[];
}

export function runScalarReplacement(program: OptIrProgram): ScalarReplacementResult {
  return { program: rewrittenProgram, metadata, diagnostics };
}
```

**Example Test Shape:**

```ts
test("scalar replacement returns metadata without mutating OptIrProgram shape", () => {
  const result = runScalarReplacement(programWithAggregate());

  expect("operations" in result.program).toBe(false);
  expect(result.metadata.replacedAggregates.length).toBeGreaterThan(0);
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/passes/scalar-replacement.test.ts
bun run agent:check
```

**Commit Message:**

```text
Type scalar replacement pass metadata -Codex Automated
```

---

## WCR-37: Make Stack Promotion Escape Analysis Fail Closed

**Files:**

- Modify: `src/opt-ir/passes/pipeline-steps.ts`
- Modify: `src/opt-ir/analyses/escape-analysis.ts`
- Modify: `src/opt-ir/passes/stack-promotion.ts`
- Test: `tests/unit/opt-ir/analyses/escape-analysis.test.ts`
- Test: `tests/unit/opt-ir/passes/stack-promotion.test.ts`

**Description:**

The stack-promotion pipeline computes escape analysis with only region information, omitting address-taken, callback, exported, unknown-call, and external-flow facts that the analysis already supports. Change stack promotion so missing evidence prevents promotion. Then wire the available facts through the pipeline.

**Implementation Steps:**

- [ ] Change escape-analysis input so absence of an evidence category is represented as `unknown`, not an empty safe set.
- [ ] Update pipeline construction to pass address-taken, callback, exported, unknown-call, and external-flow facts when available.
- [ ] In `stack-promotion.ts`, promote only when escape analysis returns a positive `doesNotEscape` proof.
- [ ] Add diagnostics explaining why a stack candidate was not promoted when evidence is unknown.
- [ ] Add tests where an address is passed to an unknown call and must not be promoted.
- [ ] Add tests where complete non-escape evidence allows promotion.

**Acceptance Criteria:**

- Missing escape evidence fails closed and blocks promotion.
- Unknown calls, exported values, callbacks, and external flows block promotion unless proven safe.
- Positive stack-promotion cases still work when complete evidence is available.
- Tests verify both the blocked and allowed paths.

**Example Escape Result Shape:**

```ts
type EscapeFact =
  | { readonly kind: "doesNotEscape"; readonly evidence: readonly EscapeEvidence[] }
  | { readonly kind: "escapes"; readonly reason: EscapeReason }
  | { readonly kind: "unknown"; readonly missingEvidence: readonly EscapeEvidenceKind[] };
```

**Example Test Shape:**

```ts
test("stack promotion rejects candidates passed to unknown calls", () => {
  const program = programWithStackSlotPassedToUnknownCall();
  const result = runStackPromotion(program, {
    escapeFacts: { unknownCalls: new Set([unknownCallOperationId]) },
  });

  expect(result.promotedSlots).toEqual([]);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "STACK_PROMOTION_ESCAPE_UNKNOWN_CALL" }),
  );
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/analyses/escape-analysis.test.ts
bun test tests/unit/opt-ir/passes/stack-promotion.test.ts
bun run agent:check
```

**Commit Message:**

```text
Make stack promotion require complete escape evidence -Codex Automated
```

---

## WCR-38: Use Or Delete Whole-Program Inlining Return Binding Helper

**Files:**

- Modify: `src/opt-ir/passes/whole-program-inlining-bindings.ts`
- Modify: `src/opt-ir/passes/whole-program-inlining-splice.ts`
- Test: `tests/unit/opt-ir/passes/whole-program-inlining-splice.test.ts`

**Description:**

`buildReturnBinding` is exported but unused while splice construction performs separate return-edge checks. Make return/result binding a single model by using the helper in the splice builder. If the helper cannot express the real splice semantics, delete it and keep the splice builder's concrete model.

**Implementation Steps:**

- [ ] Add tests for inlining functions with no return value, one return value, and multiple return edges.
- [ ] Add a negative test for mismatched callee return arity and caller result binding.
- [ ] Attempt to route splice return/result binding through `buildReturnBinding`.
- [ ] If the helper is sufficient, make splice construction call it and delete duplicate return-edge checks.
- [ ] If the helper is insufficient, delete `buildReturnBinding` and its export, then keep one tested return-binding implementation in the splice builder.
- [ ] Ensure no exported dead helper remains by running an import/usage check.

**Acceptance Criteria:**

- There is exactly one implementation of whole-program inlining return/result binding.
- No exported inlining helper is unused.
- Return-edge diagnostics are preserved or made more precise.

**Example Usage Check:**

```bash
rg -n "buildReturnBinding" src tests
```

**Example Test Shape:**

```ts
test("inlining validates callee return arity against caller binding", () => {
  const result = inlineCallWithReturnArityMismatch();

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "INLINE_RETURN_BINDING_ARITY_MISMATCH" }),
  );
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/passes/whole-program-inlining-splice.test.ts
rg -n "buildReturnBinding" src tests
bun run agent:check
```

**Commit Message:**

```text
Unify whole-program inlining return binding -Codex Automated
```

---

## WCR-12: Move Module Import Discovery Out Of Lexer Layer

**Files:**

- Add: `src/frontend/module-loader.ts`
- Modify: `src/frontend/module-import-discovery.ts`
- Modify: `src/frontend/lexer/module-graph-lexer.ts`
- Modify: `src/frontend/lexer/index.ts`
- Modify: `src/target/uefi-aarch64/package-pipeline.ts`
- Modify: `tests/integration/public-api.test.ts`
- Modify: `tests/system/frontend/front-end.test.ts`
- Test: `tests/unit/frontend/module-loader.test.ts`
- Test: `tests/integration/target/uefi-aarch64/package-pipeline-diagnostics.test.ts`

**Description:**

Parser and AST concepts leaked into the lexer module graph. Create a frontend module loader that owns lex-parse-import orchestration. The lexer layer should produce tokens and lex diagnostics only. Parser-backed import discovery should be the canonical source of module imports.

**Implementation Steps:**

- [ ] Add `loadFrontendModuleGraph` in a frontend module outside `frontend/lexer`.
- [ ] Have the loader lex source, parse tokens, collect parse diagnostics, and discover imports from the parse result.
- [ ] Move `parseResult` storage out of `LexedModule`; introduce a typed `LoadedFrontendModule` for parse-aware results.
- [ ] Update package pipeline to import from the new loader, not from `frontend/lexer/module-graph-lexer.ts`.
- [ ] Stop exporting `ModuleGraphLexer` from the public frontend lexer barrel.
- [ ] Update public API snapshot tests to export the new loader facade instead of `ModuleGraphLexer`.
- [ ] Delete `unknown` diagnostic casts used to bridge parser diagnostics through the lexer layer.
- [ ] Add an architecture test forbidding `src/frontend/lexer/**` from importing `src/frontend/parser/**`, AST modules, or shared parser diagnostics.

**Acceptance Criteria:**

- No file under `src/frontend/lexer` imports parser, AST, or parser diagnostics.
- Package pipeline obtains import graph data from `src/frontend/module-loader.ts`.
- Parser diagnostics and lexer diagnostics are preserved as typed diagnostics without casts.
- Existing package pipeline import behavior remains covered by integration tests.
- `ModuleGraphLexer` is no longer a public API symbol; existing frontend smoke tests use `loadFrontendModuleGraph`.

**Example Loader Shape:**

```ts
export interface LoadedFrontendModule {
  readonly moduleName: string;
  readonly source: SourceFile;
  readonly lexResult: LexResult;
  readonly parseResult: ParseResult;
  readonly imports: readonly ModuleImport[];
  readonly diagnostics: readonly FrontendDiagnostic[];
}

export function loadFrontendModuleGraph(
  input: FrontendModuleGraphInput,
): FrontendModuleGraphResult {
  const lexResult = lexModule(input.source);
  const parseResult = parseModule(lexResult.tokens);
  const imports = discoverModuleImports(parseResult.module);
  return assembleModuleGraph({ lexResult, parseResult, imports });
}
```

**Example Architecture Test Shape:**

```ts
test("lexer layer does not import parser layer", () => {
  const violations = findImports({
    fromGlob: "src/frontend/lexer/**/*.ts",
    forbidden: ["src/frontend/parser", "src/frontend/ast"],
  });

  expect(violations).toEqual([]);
});
```

**Verification Commands:**

```bash
bun test tests/unit/frontend/module-loader.test.ts
bun test tests/integration/target/uefi-aarch64/package-pipeline-diagnostics.test.ts
bun run agent:check
```

**Commit Message:**

```text
Move module graph parsing out of lexer layer -Codex Automated
```

---

## WCR-13: Make Import Discovery Parser-Backed and Syntax-Exact

**Files:**

- Modify: `src/frontend/module-import-discovery.ts`
- Delete: `src/frontend/lexer/import-discovery.ts`
- Modify or delete: `tests/integration/module-graph-lexer-fuzz.test.ts`
- Modify or delete: `tests/integration/module-graph-lexer.test.ts`
- Test: `tests/unit/frontend/module-import-discovery.test.ts`
- Test: `tests/system/diagnostics/imports.test.ts`

**Description:**

The token-based import scanner accepts module segments that parser grammar rejects. Make parser-backed import discovery authoritative and delete the lexical scanner. Cycle detection and missing-module behavior must use parsed imports from WCR-12's module loader.

**Implementation Steps:**

- [ ] Add invalid import tests for keyword module segments, string module names, missing semicolon/newline forms, and malformed dotted names.
- [ ] Ensure parser-backed discovery returns imports only from valid `use Name from module.path` declarations.
- [ ] Delete the lexical `ImportDiscovery` implementation and any public export of it.
- [ ] Move useful graph fuzz invariants from `module-graph-lexer` tests to module-loader tests.
- [ ] Add diagnostics that point at the invalid segment token, not at the whole file.
- [ ] Update package pipeline tests so malformed imports stop at frontend diagnostics without phantom module loads.

**Acceptance Criteria:**

- Import discovery and parser grammar accept the same module-name syntax.
- A malformed import does not trigger filesystem access for a guessed module path.
- Keywords cannot become module path segments unless the parser explicitly permits them.
- `rg -n "ImportDiscovery|lexer/import-discovery" src tests` returns no production consumers.

**Example Invalid Import Test Shape:**

```ts
test("import discovery rejects keyword module segments in use-from imports", () => {
  const result = parseAndDiscoverImports("use Driver from core.if.driver\n");

  expect(result.imports).toEqual([]);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "PARSE_INVALID_MODULE_IMPORT_SEGMENT" }),
  );
});
```

**Example Implementation Shape:**

```ts
export function discoverModuleImports(parseResult: ParseResult): ModuleImportDiscoveryResult {
  if (parseResult.diagnostics.length > 0) {
    return { imports: [], diagnostics: importDiscoveryDiagnosticsFromParse(parseResult) };
  }

  return importsFromModuleAst(parseResult.module);
}
```

**Verification Commands:**

```bash
bun test tests/unit/frontend/module-import-discovery.test.ts
bun test tests/system/diagnostics/imports.test.ts
bun run agent:check
```

**Commit Message:**

```text
Make module import discovery parser-backed -Codex Automated
```

---

## WCR-14: Add Explicit Parser Support For Parentheses, Indexing, And Indented Block Diagnostics

**Files:**

- Modify: `src/frontend/parser/expression-parser.ts`
- Modify: `src/frontend/parser/block-parser.ts`
- Modify: `src/frontend/parser/parser-diagnostics.ts`
- Modify: `src/frontend/ast/expression-views.ts`
- Modify: `src/hir/expression-lowerer.ts`
- Modify: `src/hir/expression-type-diagnostics.ts`
- Test: `tests/unit/frontend/parser/expression-parser.test.ts`
- Test: `tests/system/diagnostics/parser.test.ts`

**Description:**

Add syntax support or exact diagnostics for parenthesized expressions, general indexing, and missing indented blocks. The current parser has partial bracket handling and lacks clear block diagnostics.

**Implementation Steps:**

- [ ] Add an AST node for parenthesized expressions or preserve parentheses metadata on expression nodes.
- [ ] Parse parenthesized expressions in primary-expression parsing.
- [ ] Replace integer-literal-only bracket disambiguation with a general index expression parser.
- [ ] Add a diagnostic for `if`, `while`, `for`, function, contract, and proof constructs that require an indented block but do not receive one.
- [ ] Add recovery tests proving the parser continues after a missing block.
- [ ] Parse index expressions for literal and non-literal index operands.
- [ ] Update HIR lowering to emit a fail-closed `HIR_INDEX_EXPRESSION_UNSUPPORTED` diagnostic for index expressions until typed/proof-aware indexing is implemented.

**Acceptance Criteria:**

- `(a + b) * c` parses with correct precedence.
- `array[index]` and `array[0]` parse as index expressions.
- Index expressions do not silently lower to another expression shape; unsupported lowering emits a named HIR diagnostic.
- Missing indented blocks report a stable parser diagnostic code.
- Parser recovery preserves subsequent top-level declarations.

**Example Parser Test Shape:**

```ts
test("parser preserves parenthesized expression precedence", () => {
  const module = parseModuleText(
    "use UefiStatus from wrela_std.target.uefi.status\n" +
      "uefi image ParserPrecedence:\n" +
      "    private fn value() -> u64:\n" +
      "        return (1 + 2) * 3\n" +
      "    fn boot() -> UefiStatus:\n" +
      "        return UefiStatus.success\n",
  );
  const expression = returnExpressionOf(module, "value");

  expect(expression.kind).toBe("binary");
  expect(expression.operator).toBe("*");
  expect(expression.left.kind).toBe("parenthesized");
});
```

**Example Diagnostic Shape:**

```ts
{
  code: "PARSE_EXPECTED_INDENTED_BLOCK",
  message: "Expected an indented block after this declaration.",
  span: constructHeaderSpan,
}
```

**Verification Commands:**

```bash
bun test tests/unit/frontend/parser/expression-parser.test.ts
bun test tests/system/diagnostics/parser.test.ts
bun run agent:check
```

**Commit Message:**

```text
Add parser coverage for parentheses indexing and blocks -Codex Automated
```

---

## WCR-15: Preserve Ambiguous Imported Names Through Semantic Resolution

**Files:**

- Modify: `src/semantic/names/import-resolver.ts`
- Modify: `src/semantic/names/scope.ts`
- Modify: `src/semantic/names/expression-resolver/simple-name-resolver.ts`
- Test: `tests/unit/semantic/import-resolver.test.ts`
- Test: `tests/system/diagnostics/import-ambiguity.test.ts`

**Description:**

Import resolution deduplicates candidates by namespace and name, which hides ambiguity when two imported modules export the same simple name. Preserve all candidates with provenance and report ambiguity when lookup sees multiple possible definitions.

**Implementation Steps:**

- [ ] Extend import candidate records with source module identity and declaration identity.
- [ ] Remove deduplication that collapses candidates by `namespace:name`.
- [ ] Ensure scope lookup returns an explicit `ambiguous` result with all candidate origins.
- [ ] Update simple-name expression resolution to report ambiguity diagnostics, not unresolved-name diagnostics.
- [ ] Add tests for two imports exporting `Foo`.
- [ ] Add tests proving duplicate re-export of the same declaration remains non-ambiguous if declaration identity matches.

**Acceptance Criteria:**

- Two distinct imported declarations with the same simple name produce an ambiguity diagnostic.
- The diagnostic lists both imported modules.
- A true duplicate path to the same declaration is deduplicated by declaration identity, not by display name.

**Example Test Shape:**

```ts
test("same simple name from two modules is ambiguous", () => {
  const result = compileModules({
    "driver_a.wr": "class NetworkDevice:\n",
    "driver_b.wr": "class NetworkDevice:\n",
    "image.wr":
      "use NetworkDevice from driver_a\n" +
      "use NetworkDevice from driver_b\n" +
      "uefi image AmbiguousDeviceImage:\n" +
      "    devices:\n" +
      "        net0: NetworkDevice\n",
  });

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "SEMANTIC_AMBIGUOUS_IMPORTED_NAME",
      name: "NetworkDevice",
      candidates: expect.arrayContaining(["driver_a.NetworkDevice", "driver_b.NetworkDevice"]),
    }),
  );
});
```

**Example Candidate Shape:**

```ts
interface ImportedNameCandidate {
  readonly name: string;
  readonly declarationId: SemanticDeclarationId;
  readonly sourceModuleName: string;
  readonly exportedName: string;
}
```

**Verification Commands:**

```bash
bun test tests/unit/semantic/import-resolver.test.ts
bun test tests/system/diagnostics/import-ambiguity.test.ts
bun run agent:check
```

**Commit Message:**

```text
Report ambiguous imported names precisely -Codex Automated
```

---

## WCR-16: Add Frontend Module Graph Cycle Detection Without Recursive Stack Overflow

**Files:**

- Modify: `src/frontend/module-loader.ts`
- Modify: `src/frontend/module-graph-parser.ts`
- Test: `tests/unit/frontend/module-loader.test.ts`
- Test: `tests/system/diagnostics/module-cycles.test.ts`

**Description:**

Module traversal is recursive and serial. Replace recursion with an explicit worklist and add cycle diagnostics with a stable import chain. Keep filesystem access at compiler edges through injected module sources.

**Implementation Steps:**

- [ ] Model module graph traversal state with `unvisited`, `visiting`, and `visited`.
- [ ] Use an explicit stack or queue instead of recursive calls.
- [ ] Detect import cycles and emit a diagnostic containing the exact cycle path.
- [ ] Preserve deterministic traversal order by sorting imports by source span and module name.
- [ ] Add tests for direct cycle, three-module cycle, and diamond import with no cycle.
- [ ] Keep module source loading injected so tests use fakes, not mocks.

**Acceptance Criteria:**

- A deep import chain does not overflow the JavaScript call stack.
- Cycles produce one stable diagnostic per cycle.
- Diamond imports compile each module once.

**Example Traversal Shape:**

```ts
interface ModuleVisitFrame {
  readonly moduleName: string;
  readonly nextImportIndex: number;
}

function loadModuleGraphIteratively(entryModuleName: string): FrontendModuleGraphResult {
  const stack: ModuleVisitFrame[] = [{ moduleName: entryModuleName, nextImportIndex: 0 }];
  return visitWithExplicitStack(stack);
}
```

**Example Cycle Test Shape:**

```ts
test("module loader reports stable three-module import cycle", () => {
  const result = loadModulesFromMemory({
    "a.wr": "use B from b\nclass A:\n",
    "b.wr": "use C from c\nclass B:\n",
    "c.wr": "use A from a\nclass C:\n",
  });

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "FRONTEND_MODULE_IMPORT_CYCLE",
      cycle: ["a", "b", "c", "a"],
    }),
  );
});
```

**Verification Commands:**

```bash
bun test tests/unit/frontend/module-loader.test.ts
bun test tests/system/diagnostics/module-cycles.test.ts
bun run agent:check
```

**Commit Message:**

```text
Make frontend module graph traversal iterative -Codex Automated
```

---

## WCR-17: Add Architecture Dependency Tests For Compiler Layers

**Files:**

- Add: `tests/unit/architecture/dependency-boundaries.test.ts`
- Add or modify: `tests/support/import-graph.ts`
- Modify: `package.json` if test discovery needs the new folder

**Description:**

Prevent layer-boundary regressions by adding import graph tests. These tests should be cheap and deterministic, using source text import parsing only.

**Implementation Steps:**

- [ ] Add a support helper that finds TypeScript imports using a simple parser or existing TypeScript tooling already available in dev dependencies.
- [ ] Assert `src/frontend/lexer/**` cannot import parser, AST, semantic, HIR, OptIR, target, linker, or CLI layers.
- [ ] Assert `src/frontend/parser/**` cannot import semantic, HIR, OptIR, target, linker, or CLI layers.
- [ ] Assert `src/opt-ir/**` cannot import target-specific AArch64 or UEFI modules.
- [ ] Assert runtime source does not import test-only packages like `fast-check`.
- [ ] Add allowlist entries only for intentional shared primitives.

**Acceptance Criteria:**

- Tests fail with actionable file/import pairs.
- There is no broad wildcard allowlist that hides future violations.
- `bun run agent:check` runs the architecture test.

**Example Test Shape:**

```ts
test("lexer layer has no parser imports", () => {
  const violations = findForbiddenImports({
    from: "src/frontend/lexer/**/*.ts",
    forbidden: ["src/frontend/parser", "src/frontend/ast", "src/semantic"],
  });

  expect(violations).toEqual([]);
});
```

**Verification Commands:**

```bash
bun test tests/unit/architecture/dependency-boundaries.test.ts
bun run agent:check
```

**Commit Message:**

```text
Add compiler architecture dependency tests -Codex Automated
```

---

## WCR-18: Make HIR Lowering Fail Closed Instead Of Using Neutral Fallbacks

**Files:**

- Modify: `src/hir/expression-lowerer.ts`
- Modify: `src/hir/layout-expression-lowerer.ts`
- Modify: `src/hir/requirement-lowerer.ts`
- Modify: `src/hir/diagnostics.ts`
- Test: `tests/unit/hir/expression-lowerer.test.ts`
- Test: `tests/system/diagnostics/hir-lowering.test.ts`

**Description:**

HIR lowerers currently hide malformed syntax with `?? ""`, `?? 0n`, and `ownerFunctionId ?? 0`. Replace these with explicit diagnostics and existing HIR `kind: "error"` nodes that prevent later compiler stages from treating invalid syntax as valid zero or empty-name semantics.

**Implementation Steps:**

- [ ] Inventory all neutral fallbacks in HIR lowerers and replace each with a named helper.
- [ ] Add `loweringErrorExpression` helpers that create existing HIR `kind: "error"` expressions with stable reasons.
- [ ] Add diagnostics for missing literal text, missing names, invalid integer literals, and missing owner function ID.
- [ ] Ensure lowerers return diagnostics together with partial HIR.
- [ ] Update downstream consumers to stop compiling `kind: "error"` HIR into OptIR.
- [ ] Add tests for invalid integer literal, missing member name, missing field name, and missing owner function.

**Acceptance Criteria:**

- No `?? ""`, `?? 0n`, or `ownerFunctionId ?? 0` remains in `src/hir/**`.
- Invalid integer text cannot become `0n`.
- Missing names produce diagnostics that include the original source span.
- Later stages do not receive normal HIR for error expressions.

**Example Helper Shape:**

```ts
function requireNodeText(
  context: HirLoweringContext,
  span: SourceSpan,
  value: string | undefined,
  code: HirDiagnosticCode,
): string | HirExpression {
  if (value !== undefined && value.length > 0) return value;
  context.addDiagnostic({ code, span });
  return hirErrorExpression({ reason: code, span });
}
```

**Example Test Shape:**

```ts
test("invalid integer literal does not lower to zero", () => {
  const result = lowerExpressionText("999999999999999999999999999999999999999999u8");

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "HIR_INVALID_INTEGER_LITERAL" }),
  );
  expect(result.expression.kind.kind).toBe("error");
  expect(result.expression.kind.reason).toBe("invalid-integer-literal");
});
```

**Verification Commands:**

```bash
bun test tests/unit/hir/expression-lowerer.test.ts
bun test tests/system/diagnostics/hir-lowering.test.ts
bun run agent:check
```

**Commit Message:**

```text
Make HIR lowering fail closed on malformed syntax -Codex Automated
```

---

## WCR-19: Remove `as never` Sentinel Origin Fallbacks

**Files:**

- Modify: `src/mono/reachability-shared.ts`
- Modify: `src/mono/proof-metadata-instance-helpers.ts`
- Modify: `src/mono/mono-external-roots.ts`
- Modify: `src/mono/function-instantiator-shell.ts`
- Modify: `src/target/aarch64/lower/constant-materialization.ts`
- Modify all remaining runtime files matched by `rg "as never" src`
- Test: `tests/unit/mono/origin-records.test.ts`
- Test: `tests/unit/target/aarch64/lower/constant-materialization.test.ts`

**Description:**

Several runtime modules synthesize impossible IDs using `0 as never`. Replace every sentinel with typed absence handling, explicit diagnostics, or required preconditions checked at construction.

**Implementation Steps:**

- [ ] Run `rg -n "as never" src` and classify each occurrence.
- [ ] For origin records, require a non-empty origin record list before constructing the dependent object.
- [ ] For optional origin cases, represent absence with `undefined` or a typed `NoOrigin` variant.
- [ ] For impossible backend temporaries, allocate real virtual registers or return a diagnostic.
- [ ] Add tests for empty origin records and constant materialization paths that previously used `0 as never`.
- [ ] Add an architecture test banning `as never` outside test fixtures and exhaustive switch helpers.

**Acceptance Criteria:**

- No production code uses `0 as never` to create IDs.
- Any remaining `as never` is inside a named exhaustive assertion helper and is covered by a test.
- Empty origin record cases are diagnosed or represented explicitly.

**Example Origin Shape:**

```ts
type OriginSelection =
  | { readonly kind: "present"; readonly originId: OriginId }
  | { readonly kind: "absent"; readonly reason: "external-root" | "synthetic-proof" };
```

**Example Test Shape:**

```ts
test("monomorphization rejects missing origin records without sentinel IDs", () => {
  const result = instantiateFunctionWithOrigins([]);

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "MONO_MISSING_ORIGIN_RECORD" }),
  );
});
```

**Verification Commands:**

```bash
rg -n "as never" src
bun test tests/unit/mono/origin-records.test.ts
bun test tests/unit/target/aarch64/lower/constant-materialization.test.ts
bun run agent:check
```

**Commit Message:**

```text
Remove production sentinel IDs cast as never -Codex Automated
```

---

## WCR-20: Preserve Predicate Argument Identity And Multiple Private-State Transitions

**Files:**

- Modify: `src/hir/fact-lowerer.ts`
- Modify: `src/hir/call-lowerer.ts`
- Modify: `src/semantic/surface/contract-type-identity.ts`
- Modify: `src/proof-check/kernel/facts.ts` if facts are modeled there
- Test: `tests/unit/hir/fact-lowerer.test.ts`
- Test: `tests/unit/semantic/contract-type-identity.test.ts`
- Test: `tests/system/proof/private-state-transitions.test.ts`

**Description:**

Predicate facts currently record only predicate function identity and optional state place. Private-state calls select the first transition only. Extend facts and transitions to include argument identity and all state transitions represented by the callee signature.

**Implementation Steps:**

- [ ] Extend predicate fact records to include normalized argument references.
- [ ] Update fact composition for predicate calls to include receiver and explicit arguments.
- [ ] Represent private-state transitions as an ordered list keyed by parameter/place identity, not a single first state input.
- [ ] Update call lowering to apply every private-state transition required by the callee.
- [ ] Add diagnostics when a required state transition cannot be mapped to the call arguments.
- [ ] Add tests for two calls to the same predicate with different arguments.
- [ ] Add tests for a function that mutates two private-state parameters.

**Acceptance Criteria:**

- `isSorted(a)` and `isSorted(b)` are different facts unless `a` and `b` are proven aliases.
- A call with two private-state inputs records two transitions.
- No call-lowering code uses `[0]` to select a private transition as the whole model.

**Example Fact Shape:**

```ts
interface PredicateFact {
  readonly predicateFunctionId: HirFunctionId;
  readonly arguments: readonly HirPlaceId[];
  readonly statePlace?: HirPlaceId;
}
```

**Example Test Shape:**

```ts
test("predicate facts include argument identity", () => {
  const facts = lowerFactsForText(`
    require isSorted(left)
    require isSorted(right)
  `);

  expect(facts).toHaveLength(2);
  expect(facts[0].arguments).not.toEqual(facts[1].arguments);
});
```

**Verification Commands:**

```bash
bun test tests/unit/hir/fact-lowerer.test.ts
bun test tests/unit/semantic/contract-type-identity.test.ts
bun test tests/system/proof/private-state-transitions.test.ts
bun run agent:check
```

**Commit Message:**

```text
Preserve predicate and private-state identity -Codex Automated
```

---

## WCR-21: Tighten Proof Companion Patch Permissions

**Files:**

- Modify: `src/proof-check/authority/semantics-companion.ts`
- Modify: `src/proof-check/kernel/patch-permission-policy.ts`
- Test: `tests/unit/proof-check/semantics-companion.test.ts`
- Test: `tests/unit/proof-check/patch-permission-policy.test.ts`

**Description:**

The semantics companion allows join-like patch entries to close broad obligation, validation, and attempt state without a tight allowlist. Replace broad closures with exact allowed key/action pairs for each patch context.

**Implementation Steps:**

- [ ] Define allowed patch entry kinds per companion operation.
- [ ] For join-like patches, allow only the exact obligation keys introduced by that join operation.
- [ ] For loop convergence patches, allow only loop-specific validation keys that the loop checker opened.
- [ ] Reject attempt closures unless the companion owns the corresponding attempt ID.
- [ ] Add negative tests for closing unrelated obligation, validation, and attempt entries.
- [ ] Add positive tests for legitimate companion-owned closures.

**Acceptance Criteria:**

- A proof patch cannot close an unrelated outstanding obligation through a join-like companion.
- Permission policy tests identify the rejected entry key and context.
- Existing legitimate join/loop proof tests still pass.

**Example Policy Shape:**

```ts
interface ProofPatchPermission {
  readonly entryKind: ProofPatchEntryKind;
  readonly action: ProofPatchAction;
  readonly key: ProofPatchKey;
}

function validateCompanionPatchEntry(
  entry: ProofPatchEntry,
  permissions: ReadonlySet<ProofPatchPermission>,
): ProofPatchPermissionDiagnostic | undefined {
  return permissions.has(permissionOf(entry)) ? undefined : rejectPatchEntry(entry);
}
```

**Example Negative Test Shape:**

```ts
test("join companion cannot close unrelated validation entry", () => {
  const result = validateJoinLikePatchEntry({
    entry: closeValidation("validation-from-other-branch"),
    allowedEntries: permissionsForCurrentJoin(),
  });

  expect(result).toEqual(expect.objectContaining({ code: "PROOF_PATCH_ENTRY_NOT_PERMITTED" }));
});
```

**Verification Commands:**

```bash
bun test tests/unit/proof-check/semantics-companion.test.ts
bun test tests/unit/proof-check/patch-permission-policy.test.ts
bun run agent:check
```

**Commit Message:**

```text
Tighten proof companion patch permissions -Codex Automated
```

---

## WCR-22: Restrict Stream-Loop Session Patch Entries

**Files:**

- Modify: `src/proof-check/domains/stream-loop.ts`
- Modify: `src/proof-check/kernel/patch-permission-policy.ts`
- Test: `tests/unit/proof-check/stream-loop.test.ts`
- Test: `tests/unit/proof-check/yield-resume.test.ts`

**Description:**

Stream-loop proof handling permits session entries too broadly and only checks one close condition. Restrict session patch entries to known stream-loop session keys, reject opens from patches unless explicitly owned, and validate close order.

**Implementation Steps:**

- [ ] Define stream-loop session keys created by the stream-loop domain.
- [ ] Reject any `session` patch entry whose key is not in the current loop session set.
- [ ] Reject `session` open actions from proof patches unless the stream-loop checker explicitly grants that action.
- [ ] Validate that closing a session does not skip outstanding member obligations.
- [ ] Add tests for unknown session close, session open injection, wrong loop session close, and valid close.

**Acceptance Criteria:**

- A proof patch cannot invent or close arbitrary session state.
- Diagnostics include session key, action, and stream-loop context.
- Existing yield/resume valid tests still pass.

**Example Validation Shape:**

```ts
function validateStreamLoopSessionEntry(
  entry: ProofPatchEntry,
  context: StreamLoopPatchContext,
): ProofDiagnostic | undefined {
  if (entry.kind !== "session") return undefined;
  if (!context.allowedSessionKeys.has(entry.key)) return unknownSessionPatch(entry);
  if (entry.action !== "close") return rejectedSessionAction(entry);
  return validateNoOutstandingSessionMembers(entry, context);
}
```

**Example Negative Test Shape:**

```ts
test("stream-loop patch rejects unknown session close", () => {
  const result = applyStreamLoopPatch({
    entries: [closeSession("session-from-other-loop")],
  });

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "PROOF_STREAM_LOOP_UNKNOWN_SESSION_PATCH" }),
  );
});
```

**Verification Commands:**

```bash
bun test tests/unit/proof-check/stream-loop.test.ts
bun test tests/unit/proof-check/yield-resume.test.ts
bun run agent:check
```

**Commit Message:**

```text
Restrict stream-loop session patch entries -Codex Automated
```

---

## WCR-23: Validate PE Image Directories, Sections, And Relocations Exactly

**Files:**

- Modify: `scripts/validate-full-image.ts`
- Modify: `src/pe-coff/pe-parser.ts`
- Modify: `src/pe-coff/pe-verifier.ts`
- Test: `tests/unit/pe-coff/pe-parser.test.ts`
- Test: `tests/unit/pe-coff/pe-verifier.test.ts`
- Test: `tests/integration/target/uefi-aarch64/package-pipeline-pe-validation.test.ts`

**Description:**

Full-image validation should prove exact PE/COFF properties, not just that a binary exists. Extend the canonical `src/pe-coff` parser/verifier for data directories, section flags, relocation references, entry point, and exception metadata. Do not add a second PE reader under the linker.

**Implementation Steps:**

- [ ] Extend `parsePeCoffImage` in `src/pe-coff/pe-parser.ts` to expose DOS header, COFF header, optional header, data directories, section table, and relocation directory fields needed by validation.
- [ ] Extend `src/pe-coff/pe-verifier.ts` with UEFI AArch64 image checks.
- [ ] Validate machine type is ARM64 for UEFI AArch64 images.
- [ ] Validate subsystem is EFI application.
- [ ] Validate `.text`, `.rdata`, `.pdata`, `.xdata`, and relocation section names, sizes, RVAs, alignments, and flags.
- [ ] Validate exception data directory points at `.pdata`.
- [ ] Validate relocation directory entries target known relocatable locations.
- [ ] Validate entry point RVA points into executable `.text`.
- [ ] Emit a structured validation report with pass/fail evidence.

**Acceptance Criteria:**

- Corrupting any critical data directory causes validation failure.
- Removing `.pdata` or `.xdata` causes validation failure for AArch64 UEFI images.
- Section flag mismatches are reported by section name.
- Integration test mutates a packaged image and proves validation catches it.

**Example Validation Shape:**

```ts
interface PeImageValidationResult {
  readonly machine: "arm64";
  readonly subsystem: "efi-application";
  readonly sections: readonly PeSectionValidation[];
  readonly dataDirectories: readonly PeDataDirectoryValidation[];
  readonly diagnostics: readonly PeImageDiagnostic[];
}
```

**Example Test Shape:**

```ts
test("full-image validation rejects missing exception directory", () => {
  const image = buildMinimalUefiImage();
  const corrupted = zeroDataDirectory(image, "exception");
  const result = validatePeImage(corrupted);

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "PE_MISSING_EXCEPTION_DIRECTORY" }),
  );
});
```

**Verification Commands:**

```bash
bun test tests/unit/pe-coff/pe-parser.test.ts
bun test tests/unit/pe-coff/pe-verifier.test.ts
bun test tests/integration/target/uefi-aarch64/package-pipeline-pe-validation.test.ts
bun run agent:check
```

**Commit Message:**

```text
Validate PE image structure exactly -Codex Automated
```

---

## WCR-24: Make Release Skip Accounting Explicit And Strict

**Files:**

- Modify: `scripts/verify-release.ts`
- Modify: `scripts/validate-full-image.ts`
- Modify: `src/cli/run-command.ts`
- Modify: `src/cli/validate-command.ts`
- Modify: `package.json`
- Test: `tests/unit/cli/run-command.test.ts`
- Test: `tests/unit/cli/validate-command.test.ts`
- Test: `tests/unit/scripts/verify-release.test.ts`

**Description:**

`verify:release` already invokes the non-developer QEMU and Lean paths and must keep doing that. The remaining gap is explicit per-phase skip accounting, CLI skip-policy clarity, and tests proving release verification fails if any phase returns `skipped`.

**Implementation Steps:**

- [ ] Preserve `package.json`'s `verify:release` command as `bun run scripts/verify-release.ts`.
- [ ] Add a shared validation phase status model: `passed`, `failed`, or `skipped`.
- [ ] In `verify-release.ts`, fail if QEMU is missing, Lean is missing, or any validation phase reports `skipped`.
- [ ] In developer mode, preserve current skip behavior but mark skipped phases in the report.
- [ ] Keep `agent:check` developer-friendly with its existing `--allow-missing-qemu` and `--allow-missing-lean` paths.
- [ ] Update CLI `run` and `validate` commands to expose skip policy clearly.
- [ ] Add tests proving skip exits non-zero in release mode and zero in allowed developer mode.

**Acceptance Criteria:**

- `bun run verify:release` continues to avoid `--allow-missing-qemu` and `--allow-missing-lean`.
- `bun run verify:release` fails when QEMU or Lean is unavailable.
- Validation reports include `passed`, `failed`, or `skipped` for every phase.
- No release script silently accepts a skipped external tool.

**Example CLI Shape:**

```ts
interface ValidationToolPolicy {
  readonly allowMissingQemu: boolean;
  readonly allowMissingLean: boolean;
  readonly failOnSkippedPhase: boolean;
  readonly phaseStatus: "passed" | "failed" | "skipped";
}
```

**Example Test Shape:**

```ts
test("release verification fails on skipped qemu", async () => {
  const result = await runVerifyReleaseWithFakeTools({ qemu: "missing", lean: "present" });

  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("QEMU validation was skipped in release mode");
});
```

**Verification Commands:**

```bash
bun test tests/unit/cli/run-command.test.ts
bun test tests/unit/cli/validate-command.test.ts
bun test tests/unit/scripts/verify-release.test.ts
bun run agent:check
```

**Commit Message:**

```text
Make release validation reject skipped tools -Codex Automated
```

---

## WCR-25: Add Reproducible Build Evidence Manifest

**Files:**

- Modify: `scripts/verify-release.ts`
- Add: `scripts/reproducibility-manifest.ts`
- Modify: `package.json`
- Test: `tests/unit/scripts/reproducibility-manifest.test.ts`

**Description:**

Release verification should record tool versions, source revision, lockfile digest, command list, output digests, and validation evidence. Add a JSON manifest produced by strict release verification.

**Implementation Steps:**

- [ ] Capture `bun --version`, `git rev-parse HEAD`, dirty-tree status, OS, architecture, and key external tool versions.
- [ ] Hash `bun.lock`, source inputs, generated image outputs, and validation reports.
- [ ] Record every release verification command and exit code.
- [ ] Fail strict release verification if the git tree is dirty unless a documented `--allow-dirty` developer flag is provided.
- [ ] Write manifest to `dist/release/reproducibility-manifest.json`.
- [ ] Add tests using fake command runners and fake filesystem input.

**Acceptance Criteria:**

- Release verification produces a deterministic JSON manifest with sorted keys.
- Manifest includes enough evidence to reproduce the image build.
- Dirty tree is a strict release failure by default.

**Example Manifest Shape:**

```json
{
  "schemaVersion": 1,
  "source": {
    "gitCommit": "abc123",
    "dirty": false,
    "lockfileSha256": "..."
  },
  "tools": {
    "bun": "1.x",
    "qemu-system-aarch64": "..."
  },
  "outputs": [
    {
      "path": "dist/uefi-aarch64/main.efi",
      "sha256": "...",
      "bytes": 12345
    }
  ],
  "validation": {
    "qemu": "passed",
    "lean": "passed",
    "peImage": "passed"
  }
}
```

**Example Test Shape:**

```ts
test("reproducibility manifest sorts outputs and hashes content", () => {
  const manifest = buildReproducibilityManifest(fakeReleaseEvidence());

  expect(Object.keys(manifest.tools)).toEqual([...Object.keys(manifest.tools)].sort());
  expect(manifest.outputs[0].sha256).toMatch(/^[0-9a-f]{64}$/);
});
```

**Verification Commands:**

```bash
bun test tests/unit/scripts/reproducibility-manifest.test.ts
bun run agent:check
```

**Commit Message:**

```text
Emit release reproducibility evidence manifest -Codex Automated
```

---

## WCR-26: Replace Reproducible And Stdlib Script Aliases With Real Gates

**Files:**

- Modify: `package.json`
- Add: `scripts/verify-reproducible.ts`
- Add: `scripts/verify-stdlib.ts`
- Test: `tests/unit/scripts/verify-reproducible.test.ts`
- Test: `tests/unit/scripts/verify-stdlib.test.ts`

**Description:**

`verify:reproducible` and `verify:stdlib` currently alias full-image validation. Replace them with dedicated checks.

**Implementation Steps:**

- [ ] Implement `verify-reproducible.ts` to build the same input twice in isolated output directories.
- [ ] Compare output hashes and manifest-stable fields.
- [ ] Implement `verify-stdlib.ts` to compile every documented stdlib module and fixture using the public compiler entry point.
- [ ] Add negative tests where a nondeterministic output differs between builds.
- [ ] Add negative tests where a stdlib module fails to compile.
- [ ] Update package scripts to call the new commands.

**Acceptance Criteria:**

- `bun run verify:reproducible` detects nondeterministic output bytes.
- `bun run verify:stdlib` compiles all stdlib modules and reports module-specific failures.
- Neither script is an alias for full-image validation.

**Example Reproducibility Shape:**

```ts
const first = await buildReleaseImage({ outputDir: "dist/repro-a" });
const second = await buildReleaseImage({ outputDir: "dist/repro-b" });

assertEqualSha256(first.imagePath, second.imagePath);
```

**Example Stdlib Shape:**

```ts
for (const moduleName of listStdlibModules(stdlibRoot)) {
  const result = compileStdlibModule(moduleName);
  assertNoDiagnostics(moduleName, result.diagnostics);
}
```

**Verification Commands:**

```bash
bun test tests/unit/scripts/verify-reproducible.test.ts
bun test tests/unit/scripts/verify-stdlib.test.ts
bun run verify:reproducible
bun run verify:stdlib
bun run agent:check
```

**Commit Message:**

```text
Add real reproducible and stdlib verification gates -Codex Automated
```

---

## WCR-27: Generate Diagnostics Fixtures From Language Invalid Spec

**Files:**

- Modify: `docs/language/invalid.md`
- Add: `scripts/generate-invalid-diagnostics-fixtures.ts`
- Add or modify: `tests/system/diagnostics/generated-invalid.test.ts`
- Add: `tests/fixtures/system/diagnostics/generated/`

**Description:**

`docs/language/invalid.md` lists far more invalid programs than the fixture suite covers. Add machine-readable invalid examples in the doc and generate diagnostics fixtures from them.

**Implementation Steps:**

- [ ] Define a fenced-code convention in `docs/language/invalid.md` for invalid examples, expected diagnostic code, and optional stage.
- [ ] Add a generator that extracts examples and writes fixture files with stable names.
- [ ] Add a system test that compiles every generated fixture and asserts expected diagnostic codes.
- [ ] Backfill at least one fixture for every invalid-language section.
- [ ] Fail the generator if a section has no example.
- [ ] Add the generator to `agent:check` or a diagnostics-specific verification command.

**Acceptance Criteria:**

- Every invalid-language section has at least one executable diagnostic fixture.
- A fixture expecting a diagnostic that is not emitted fails the test.
- Generated fixture names are deterministic and human-readable.

**Example Doc Convention:**

````md
### Invalid: missing indented block

```wr invalid code=PARSE_EXPECTED_INDENTED_BLOCK stage=parser
use UefiStatus from wrela_std.target.uefi.status

uefi image MissingBlock:
    fn boot() -> UefiStatus:
```
````

**Example Generator Shape:**

```ts
interface InvalidFixtureSpec {
  readonly slug: string;
  readonly stage: "lexer" | "parser" | "semantic" | "hir" | "proof" | "target";
  readonly expectedDiagnosticCode: string;
  readonly source: string;
}
```

**Verification Commands:**

```bash
bun run scripts/generate-invalid-diagnostics-fixtures.ts --check
bun test tests/system/diagnostics/generated-invalid.test.ts
bun run agent:check
```

**Commit Message:**

```text
Generate diagnostics fixtures from invalid language spec -Codex Automated
```

---

## WCR-28: Decompose Oversized Package Pipeline Test File

**Files:**

- Modify: `tests/integration/target/uefi-aarch64/package-pipeline.test.ts`
- Add: `tests/integration/target/uefi-aarch64/package-pipeline-diagnostics.test.ts`
- Add: `tests/integration/target/uefi-aarch64/package-pipeline-proof-boundary.test.ts`
- Add: `tests/integration/target/uefi-aarch64/package-pipeline-static-char16.test.ts`
- Add: `tests/integration/target/uefi-aarch64/package-pipeline-support.ts`

**Description:**

Split the oversized package pipeline integration file into focused files. Preserve all existing assertions and shared builders through a support module.

**Implementation Steps:**

- [ ] Move frontend diagnostic tests into `package-pipeline-diagnostics.test.ts`.
- [ ] Move proof-check boundary tests into `package-pipeline-proof-boundary.test.ts`.
- [ ] Move static `CHAR16` tests into `package-pipeline-static-char16.test.ts`.
- [ ] Extract duplicated pipeline builders into `package-pipeline-support.ts`.
- [ ] Keep the original file for core happy-path package tests only.
- [ ] Verify every moved test still runs and no assertions are deleted.

**Acceptance Criteria:**

- No package pipeline test file exceeds 900 lines.
- Test names remain stable or become more descriptive.
- `bun test tests/integration/target/uefi-aarch64` runs all split files.

**Example Support Shape:**

```ts
export function compileUefiPackageFromMemory(
  modules: Record<string, string>,
): Promise<UefiPackageTestResult> {
  return runPackagePipelineWithFakeFilesystem(modules);
}
```

**Verification Commands:**

```bash
wc -l tests/integration/target/uefi-aarch64/package-pipeline*.test.ts
bun test tests/integration/target/uefi-aarch64
bun run agent:check
```

**Commit Message:**

```text
Split UEFI package pipeline integration tests -Codex Automated
```

---

## WCR-29: Define Stdlib Compatibility Contract And Expand Smoke Coverage

**Files:**

- Add: `docs/stdlib/COMPATIBILITY.md`
- Modify or add: `stdlib/**/*.wr`
- Add: `tests/system/stdlib/stdlib-compatibility.test.ts`
- Modify: `scripts/verify-stdlib.ts`

**Description:**

After WCR-53 replaces marker `Option` / `Result` wrappers with real tagged-union stdlib types, define the public surface, versioning rules, unsupported areas, and minimum compile/run smoke coverage.

**Implementation Steps:**

- [ ] Document each public stdlib module, exported type, exported function, and proof contract.
- [ ] Add compile fixtures that import every public stdlib module.
- [ ] Add smoke programs for representative memory, string, array, UEFI, and proof helpers that exist in the repo.
- [ ] Teach `verify-stdlib.ts` to compile those fixtures.
- [ ] Add diagnostics for accidental breaking changes to exported stdlib names by snapshotting the public surface.

**Acceptance Criteria:**

- `docs/stdlib/COMPATIBILITY.md` names every supported public module.
- `verify:stdlib` fails if a documented module does not compile.
- Public stdlib surface snapshots catch accidental removal or rename.

**Example Compatibility Section:**

```md
## Module `wrela_std.core.option`

Supported exports:

- `Option[Value]`: stable tagged union for optional values.
- `Option.some(value: Value)`: stable constructor for present values.
- `Option.none`: stable constructor for absent values.

Compatibility policy:

- Removing or renaming a supported export is a breaking change.
- Strengthening preconditions is a breaking change unless a diagnostic migration is provided.
```

**Example Test Shape:**

```ts
test("documented stdlib public surface compiles", () => {
  const result = compileStdlibCompatibilityFixture("wrela_std.core.option");

  expect(result.diagnostics).toEqual([]);
});
```

**Verification Commands:**

```bash
bun test tests/system/stdlib/stdlib-compatibility.test.ts
bun run verify:stdlib
bun run agent:check
```

**Commit Message:**

```text
Document and verify stdlib compatibility surface -Codex Automated
```

---

## WCR-30: Define A Stable Public Compiler API Facade

**Files:**

- Modify: `src/index.ts`
- Modify: `src/frontend/index.ts`
- Add: `src/compiler-api.ts`
- Add: `tests/unit/public-api/compiler-api.test.ts`
- Add: `docs/api/public-compiler-api.md`

**Description:**

The public package exports internal modules. Create a stable facade for supported API entry points and move internal exports behind explicit internal paths or remove them from the root export.

**Implementation Steps:**

- [ ] Define supported public API functions for lexing, parsing, compiling, validating, and packaging.
- [ ] Export stable result and diagnostic types from `src/compiler-api.ts`.
- [ ] Update `src/index.ts` to export only the stable facade and documented type aliases.
- [ ] Keep internal imports inside repo using direct paths so public facade does not become a dependency magnet.
- [ ] Add tests that snapshot public export names.
- [ ] Document migration for any removed root export.

**Acceptance Criteria:**

- Root API exports are intentional and documented.
- Public export snapshot fails when a new root export is added without review.
- Compiler internals remain importable internally without going through root API.

**Example Facade Shape:**

```ts
export interface CompileModuleInput {
  readonly entryModuleName: string;
  readonly sources: CompilerSourceProvider;
  readonly target: CompilerTarget;
}

export interface CompileModuleResult {
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly artifact?: CompilerArtifact;
}

export function compileModule(input: CompileModuleInput): Promise<CompileModuleResult> {
  return runCompilerPipeline(input);
}
```

**Example Public API Test Shape:**

```ts
test("root public API exports only documented names", async () => {
  const api = await import("../../../src/index");

  expect(Object.keys(api).sort()).toEqual([
    "compileModule",
    "formatDiagnostic",
    "lexSource",
    "parseSource",
    "validateArtifact",
  ]);
});
```

**Verification Commands:**

```bash
bun test tests/unit/public-api/compiler-api.test.ts
bun run agent:check
```

**Commit Message:**

```text
Define stable public compiler API facade -Codex Automated
```

---

## WCR-31: Define Canonical Typed Pipeline Contracts

**Files:**

- Add: `src/pipeline/compiler-stage.ts`
- Add: `src/pipeline/compiler-stage-result.ts`
- Add: `src/pipeline/compiler-stage-metadata.ts`
- Add: `src/pipeline/compiler-pipeline-diagnostics.ts`
- Test: `tests/unit/pipeline/compiler-stage-result.test.ts`
- Test: `tests/unit/pipeline/compiler-stage-metadata.test.ts`

**Description:**

Define the canonical pipeline contract before migrating callers. This task creates the typed result, stage, diagnostics, and metadata-key model used by WCR-48 through WCR-50. It does not migrate stage owners yet; it establishes the types that make those migrations mechanical.

**Implementation Steps:**

- [ ] Define the closed `CompilerStage` union for `source`, `frontend`, `semantic`, `hir`, `proofMir`, `optIr`, `target`, `package`, and `validation`.
- [ ] Define `CompilerStageResult<Stage>` with `kind: "ok" | "error"`, stage artifact, diagnostics, and metadata.
- [ ] Define `CompilerMetadataKey` as a closed union with typed value mapping. Include `scalarReplacement`, `optIrPasses`, `releaseEvidence`, and `frontendModuleGraph` keys.
- [ ] Add `attachCompilerMetadata`, `readCompilerMetadata`, and `requireCompilerMetadata` helpers that cannot write fields onto artifact models.
- [ ] Add tests proving metadata value type mismatches fail at compile time through `// @ts-expect-error`.
- [ ] Add runtime tests proving metadata read/write is immutable and deterministic.

**Acceptance Criteria:**

- Every pipeline metadata entry is keyed by a closed typed key.
- Model artifacts such as `OptIrProgram` cannot receive sidecar metadata through this API.
- `CompilerStageResult` can represent partial artifacts on error only when the stage type explicitly permits partial output.
- No existing pipeline caller changes in this task except imports used by tests.

**Example State Shape:**

```ts
export interface CompilerStageResult<Stage extends CompilerStage> {
  readonly kind: "ok" | "error";
  readonly stage: Stage;
  readonly diagnostics: readonly CompilerDiagnostic[];
  readonly artifact?: CompilerStageArtifactMap[Stage];
  readonly metadata: CompilerPipelineMetadata;
}
```

**Example Metadata Shape:**

```ts
const withSroa = attachCompilerMetadata(result, "scalarReplacement", metadata);
const scalarReplacementMetadata = requireCompilerMetadata(withSroa, "scalarReplacement");
```

**Verification Commands:**

```bash
bun test tests/unit/pipeline/compiler-stage-result.test.ts
bun test tests/unit/pipeline/compiler-stage-metadata.test.ts
bun run agent:check
```

**Commit Message:**

```text
Define typed compiler pipeline contracts -Codex Automated
```

---

## WCR-32: Extract HIR Expression Type Checking From The Lowerer

**Files:**

- Add: `src/hir/expression-type-checker.ts`
- Modify: `src/hir/expression-lowerer.ts`
- Modify: `src/hir/expression-type-diagnostics.ts`
- Modify: `src/semantic/names/expression-resolver/simple-name-resolver.ts`
- Test: `tests/unit/hir/expression-type-checker.test.ts`
- Test: `tests/system/diagnostics/expression-types.test.ts`

**Description:**

Make expression type checking a focused HIR module with explicit inputs and outputs. The extraction source is `src/hir/expression-lowerer.ts` plus the existing diagnostic helpers in `src/hir/expression-type-diagnostics.ts`; name resolution stays in `src/semantic/names/expression-resolver`.

**Implementation Steps:**

- [ ] Define `HirExpressionTypeCheckInput` with HIR lowering context, resolved semantic reference, expected type, and expression view.
- [ ] Define `HirExpressionTypeCheckResult` with typed HIR expression, conversions, constraints, and diagnostics.
- [ ] Move literal, binary, unary, call, member, and index expression typing out of `expression-lowerer.ts` into named functions.
- [ ] Keep name resolution separate from type compatibility checks.
- [ ] Add tests for numeric literal inference, binary operator mismatch, call argument mismatch, member lookup failure, and index expression type failure.
- [ ] Update HIR lowering to consume typed expression results instead of re-inferring basic expression facts.

**Acceptance Criteria:**

- Expression type diagnostics are emitted from the expression checker, not scattered fallback code.
- A single unit test can type-check an expression without running the whole package pipeline.
- HIR lowering receives typed expressions or existing `kind: "error"` expressions with diagnostics.

**Example Result Shape:**

```ts
interface HirExpressionTypeCheckResult {
  readonly expression: TypedExpression;
  readonly diagnostics: readonly SemanticDiagnostic[];
  readonly constraints: readonly TypeConstraint[];
}
```

**Example Test Shape:**

```ts
test("binary operator mismatch reports both operand types", () => {
  const result = typeCheckExpressionText("true + 1u64");

  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "SEMANTIC_INVALID_BINARY_OPERAND_TYPES",
      leftType: "bool",
      rightType: "u64",
    }),
  );
});
```

**Verification Commands:**

```bash
bun test tests/unit/hir/expression-type-checker.test.ts
bun test tests/system/diagnostics/expression-types.test.ts
bun run agent:check
```

**Commit Message:**

```text
Extract semantic expression type checker -Codex Automated
```

---

## WCR-33: Add Stable Identity To The Existing Green/Red Syntax Tree

**Files:**

- Add: `src/frontend/syntax/syntax-identity.ts`
- Modify: `src/frontend/syntax/syntax-tree.ts`
- Modify: `src/frontend/syntax/red-node.ts`
- Modify: `src/frontend/syntax/red-token.ts`
- Test: `tests/unit/frontend/syntax/syntax-identity.test.ts`
- Test: `tests/unit/frontend/syntax/syntax-tree.test.ts`

**Description:**

Make the existing green/red syntax tree the canonical frontend syntax model. Add stable node and token identities derived from root path, child index, kind, and span. Do not introduce a second arena or a parallel syntax tree.

**Implementation Steps:**

- [ ] Define branded `SyntaxNodeId` and `SyntaxTokenId` types in `syntax-identity.ts`.
- [ ] Add `syntaxNodeId(node: RedNode)` and `syntaxTokenId(token: RedToken)` helpers.
- [ ] Add `syntaxElementPathKey(element)` that derives a root-relative path from parent links and child indexes.
- [ ] Base identity on the stable path from root plus kind and span; do not use object identity or allocation order.
- [ ] Add `parentId()` and `childIds()` helpers on `RedNode` through methods or exported functions.
- [ ] Add tests proving repeated calls over the same tree produce identical IDs.
- [ ] Add tests proving two sibling nodes with the same kind and width still receive distinct IDs.

**Acceptance Criteria:**

- There is one canonical syntax model: `SyntaxTree` plus green/red nodes.
- No `src/frontend/syntax/syntax-arena.ts` or `syntax-node.ts` file is added by this task.
- Every red node and red token can produce a stable ID.
- Stable IDs do not change across repeated traversal of the same parse result.

**Example Identity Shape:**

```ts
declare const syntaxNodeIdBrand: unique symbol;
declare const syntaxTokenIdBrand: unique symbol;

export type SyntaxNodeId = string & { readonly [syntaxNodeIdBrand]: true };
export type SyntaxTokenId = string & { readonly [syntaxTokenIdBrand]: true };

export function syntaxNodeId(node: RedNode): SyntaxNodeId {
  return `${syntaxElementPathKey(node)}:${SyntaxKind[node.kind]}:${node.span.start}:${node.span.end}` as SyntaxNodeId;
}
```

**Example Test Shape:**

```ts
test("syntax node ids are stable and sibling-distinct", () => {
  const tree = parseSyntaxTree(
    "use UefiStatus from wrela_std.target.uefi.status\n" +
      "uefi image SyntaxArenaSmoke:\n" +
      "    fn boot() -> UefiStatus:\n" +
      "        return UefiStatus.success\n",
  );
  const first = tree
    .root()
    .children()
    .map((child) => syntaxElementId(child));
  const second = tree
    .root()
    .children()
    .map((child) => syntaxElementId(child));

  expect(second).toEqual(first);
  expect(new Set(first).size).toBe(first.length);
});
```

**Verification Commands:**

```bash
bun test tests/unit/frontend/syntax/syntax-identity.test.ts
bun test tests/unit/frontend/syntax/syntax-tree.test.ts
bun run agent:check
```

**Commit Message:**

```text
Add stable identities to canonical syntax tree -Codex Automated
```

---

## WCR-34: Define Canonical HIR Traversal Primitives

**Files:**

- Add: `src/hir/traversal.ts`
- Add: `src/hir/transform-context.ts`
- Test: `tests/unit/hir/traversal.test.ts`
- Test: `tests/unit/hir/transform-context.test.ts`

**Description:**

Define the traversal primitives that WCR-54 through WCR-57 use to migrate the full mono cloner family. This task introduces no one-off rewrite helper. It creates a canonical traversal cursor, transform context, and child enumeration API for HIR nodes.

**Implementation Steps:**

- [ ] Define `HirTraversalCursor` with current node kind, stable path, parent path, source origin, and optional owning function ID.
- [ ] Define `HirTransformContext` with typed diagnostic accumulation, ID remap storage, and user metadata.
- [ ] Add child enumerators for HIR blocks, statements, expressions, resource places, requirements, validation records, attempts, and proof metadata.
- [ ] Add tests proving traversal order is deterministic for a function body.
- [ ] Add tests proving every expression child reachable through existing hand-written lowerers is reached by traversal.
- [ ] Add tests proving diagnostics are accumulated without mutating source HIR.

**Acceptance Criteria:**

- Traversal primitives cover every HIR node family required by the mono cloner files.
- This task does not migrate mono cloning yet; WCR-55 through WCR-57 do that and delete old traversal.
- Traversal paths are stable and do not depend on object identity.
- No production behavior changes.

**Example Traversal Shape:**

```ts
export interface HirTraversalCursor {
  readonly path: HirTraversalPath;
  readonly parentPath?: HirTraversalPath;
  readonly nodeKind: HirTraversalNodeKind;
  readonly sourceOrigin: HirOriginId;
}

export function walkHirBlock(
  block: HirBlock,
  visitor: HirTraversalVisitor,
  context: HirTransformContext,
): HirTraversalResult {
  return visitBlockChildren({ block, visitor, context });
}
```

**Example Test Shape:**

```ts
test("HIR traversal visits statements and nested expressions in stable order", () => {
  const block = makeHirBlockWithNestedCall();
  const visited = collectHirTraversalPaths(block);

  expect(visited).toEqual([
    "block:0",
    "block:0.statement:0",
    "block:0.statement:0.expression",
    "block:0.statement:0.expression.argument:0",
  ]);
});
```

**Verification Commands:**

```bash
bun test tests/unit/hir/traversal.test.ts
bun test tests/unit/hir/transform-context.test.ts
bun run agent:check
```

**Commit Message:**

```text
Define canonical HIR traversal primitives -Codex Automated
```

---

## WCR-35: Add Canonical OptIR Pass Diagnostics

**Files:**

- Add: `src/opt-ir/passes/optimization-diagnostics.ts`
- Modify: `src/opt-ir/passes/pass-execution.ts`
- Test: `tests/unit/opt-ir/passes/optimization-diagnostics.test.ts`

**Description:**

Add the diagnostic vocabulary used by the canonical OptIR pass execution framework. This task defines structured pass diagnostics only. WCR-45 and WCR-46 migrate existing passes to emit these diagnostics, and WCR-47 makes the pass manager the only way to run optimizer passes.

**Implementation Steps:**

- [ ] Define a shared optimization diagnostic type with pass name, severity, code, message, and optional operation/block/function IDs.
- [ ] Define helper constructors for `info`, `warning`, and `error` pass diagnostics.
- [ ] Add deterministic diagnostic sorting by pass name, function ID, block ID, operation ID, and code.
- [ ] Add a `diagnostics` field to the `OptIrPassResult` type from WCR-43.
- [ ] Add tests proving two passes emitting diagnostics in different insertion orders produce the same sorted output.
- [ ] Add tests proving diagnostic constructors include the pass name and stable code.

**Acceptance Criteria:**

- Every canonical OptIR pass result can carry typed diagnostics.
- Diagnostics are sorted deterministically.
- No pass-specific text-only diagnostic arrays remain in the pass execution contract.
- This task does not add debug dumps; debug dumping must be a separate CLI/tooling plan after diagnostics are stable.

**Example Diagnostic Shape:**

```ts
interface OptIrOptimizationDiagnostic {
  readonly pass: string;
  readonly severity: "info" | "warning" | "error";
  readonly code: string;
  readonly message: string;
  readonly functionId?: OptIrFunctionId;
  readonly blockId?: OptIrBlockId;
  readonly operationId?: OptIrOperationId;
}
```

**Example Test Shape:**

```ts
test("LICM reports dependency cycle instead of hoisting unsafely", () => {
  const diagnostics = sortOptIrOptimizationDiagnostics([
    optIrPassWarning({
      pass: "licm",
      code: "LICM_HOIST_DEPENDENCY_CYCLE",
      functionId: 1,
    }),
  ]);

  expect(diagnostics).toContainEqual(
    expect.objectContaining({ code: "LICM_HOIST_DEPENDENCY_CYCLE" }),
  );
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/passes/optimization-diagnostics.test.ts
bun run agent:check
```

**Commit Message:**

```text
Add structured OptIR optimization diagnostics -Codex Automated
```

---

## WCR-36: Add End-To-End Negative Corpus For Safety-Critical Regressions

**Files:**

- Add: `tests/system/regressions/safety-critical.test.ts`
- Add fixtures under: `tests/fixtures/system/regressions/`

**Description:**

Create an end-to-end regression suite for the validated correctness bugs so future architecture work cannot reintroduce them.

**Implementation Steps:**

- [ ] Add a fixture for malformed import that must not load a guessed file.
- [ ] Add a fixture for ambiguous imports that must report ambiguity.
- [ ] Add a fixture for invalid integer literal that must not become zero.
- [ ] Add a fixture for predicate facts with different arguments.
- [ ] Add a fixture for proof patch attempting to close unrelated state.
- [ ] Add a fixture for AArch64 package validation with unwind metadata expectations if binary fixture support exists.
- [ ] Ensure each fixture asserts a named diagnostic or named output property.

**Acceptance Criteria:**

- Each prior P1/P2 correctness finding has at least one end-to-end regression.
- The suite uses fakes through dependency injection for filesystem inputs.
- No fixture relies on external tools unless the test explicitly checks validation tooling.

**Example Test Shape:**

```ts
test("malformed import does not trigger phantom module load", () => {
  const sourceProvider = fakeSourceProvider({
    "image.wr": "use Driver from core.if.driver\n",
  });

  const result = compileWithSourceProvider(sourceProvider);

  expect(sourceProvider.loadedModules()).toEqual(["image"]);
  expect(result.diagnostics).toContainEqual(
    expect.objectContaining({ code: "PARSE_INVALID_MODULE_IMPORT_SEGMENT" }),
  );
});
```

**Verification Commands:**

```bash
bun test tests/system/regressions/safety-critical.test.ts
bun run agent:check
```

**Commit Message:**

```text
Add safety-critical regression corpus -Codex Automated
```

---

## WCR-39: Add Payload-Bearing Enum Syntax And Metadata

**Files:**

- Modify: `src/frontend/parser/enum-declaration-parser.ts`
- Modify: `src/frontend/ast/declaration-views.ts`
- Modify: `src/semantic/item-index/item-records.ts`
- Modify: `src/semantic/item-index/source-member-collector.ts`
- Modify: `src/hir/hir.ts`
- Modify: `src/hir/typed-hir-builder.ts`
- Test: `tests/unit/frontend/parser/enum-declaration-parser.test.ts`
- Test: `tests/unit/semantic/item-index/enum-payload-fields.test.ts`
- Test: `tests/unit/hir/typed-hir-builder-enum-payload.test.ts`

**Description:**

Fieldless enums already exist, but payload-bearing cases are not represented. Add enum payload syntax and carry payload field metadata through AST views, item indexing, and typed HIR. This task does not compute layout and does not lower construction or matching.

**Implementation Steps:**

- [ ] Extend enum case parsing from a bare identifier to `caseName(fieldName: Type, otherField: Type)` while preserving fieldless `caseName`.
- [ ] Extend declaration views so enum cases expose ordered payload fields with names, type references, and spans.
- [ ] Extend item-index records to represent enum-case payload fields as case-owned fields.
- [ ] Extend HIR enum case records to include payload field IDs.
- [ ] Add diagnostics for duplicate payload field names in one case and unsupported payload field syntax.
- [ ] Keep fieldless enum AST, item-index, and HIR metadata byte-for-byte compatible with existing tests.

**Acceptance Criteria:**

- A newline-separated `enum Result[Ok, Err]` declaration with `ok(value: Ok)` and `err(error: Err)` cases parses and records payload fields using bracket generics.
- Fieldless enums still parse and build typed HIR as before.
- HIR enum case records include ordered payload field IDs and source origins.
- No layout behavior changes in this task.

**Example Source Shape:**

```wr
enum Result[Ok, Err]:
    ok(value: Ok)
    err(error: Err)
```

**Example Metadata Shape:**

```ts
interface HirEnumCaseRecord {
  readonly enumTypeId: TypeId;
  readonly caseItemId: ItemId;
  readonly name: string;
  readonly ordinal: number;
  readonly payloadFieldIds: readonly FieldId[];
  readonly sourceOrigin: HirOriginId;
}
```

**Verification Commands:**

```bash
bun test tests/unit/frontend/parser/enum-declaration-parser.test.ts
bun test tests/unit/semantic/item-index/enum-payload-fields.test.ts
bun test tests/unit/hir/typed-hir-builder-enum-payload.test.ts
bun run agent:check
```

**Commit Message:**

```text
Add payload enum syntax and metadata -Codex Automated
```

---

## WCR-40: Add Tagged-Union Enum Layout

**Files:**

- Modify: `src/layout/enum-layout.ts`
- Modify: `src/layout/layout-program.ts`
- Modify: `src/layout/layout-fact-builder.ts`
- Test: `tests/unit/layout/enum-layout.test.ts`
- Test: `tests/system/diagnostics/enum-layout.test.ts`

**Description:**

Compute layout for the payload metadata introduced by WCR-39. Fieldless enum layout remains compatible. Payload-bearing enums become tagged unions with a tag field and a payload storage area sized and aligned for the largest case payload.

**Implementation Steps:**

- [ ] Replace the active `LAYOUT_UNSUPPORTED_ENUM_PAYLOAD` rejection path with layout computation for supported payload fields.
- [ ] Select the smallest unsigned tag type that fits every case ordinal.
- [ ] Compute payload offset after the tag with target alignment rules.
- [ ] Compute payload size and alignment as the maximum over all case payload records.
- [ ] Record per-case payload field offsets relative to payload base.
- [ ] Add diagnostics for empty enum, tag overflow, payload type with unsupported layout, and payload field alignment overflow.
- [ ] Add tests proving fieldless enum layout output is unchanged.

**Acceptance Criteria:**

- Payload-bearing enum layout records tag offset, payload offset, payload size, case ordinals, and per-case payload field offsets.
- Fieldless enum layout remains compatible with existing expectations.
- `rg -n "LAYOUT_UNSUPPORTED_ENUM_PAYLOAD" src/layout/enum-layout.ts` returns no active rejection path for supported payloads.

**Example Layout Shape:**

```ts
interface EnumPayloadLayout {
  readonly tag: { readonly offsetBytes: bigint; readonly typeKey: LayoutTypeKey };
  readonly payload: {
    readonly offsetBytes: bigint;
    readonly sizeBytes: bigint;
    readonly alignmentBytes: bigint;
  };
  readonly cases: readonly EnumCasePayloadLayout[];
}
```

**Verification Commands:**

```bash
bun test tests/unit/layout/enum-layout.test.ts
bun test tests/system/diagnostics/enum-layout.test.ts
bun run agent:check
```

**Commit Message:**

```text
Add tagged-union enum layout -Codex Automated
```

---

## WCR-41: Lower Tagged-Union Construction Into HIR

**Files:**

- Modify: `src/hir/enum-case-model.ts`
- Modify: `src/hir/expression-lowerer.ts`
- Modify: `src/hir/expression-type-diagnostics.ts`
- Test: `tests/unit/hir/enum-case-model.test.ts`
- Test: `tests/unit/hir/expression-lowerer.test.ts`

**Description:**

Lower enum case construction into HIR using the payload metadata and layout facts from WCR-39 and WCR-40. This task handles construction only. Matching and payload binding are WCR-51.

**Implementation Steps:**

- [ ] Extend enum case metadata lookup to return case ordinal and payload field records.
- [ ] Lower `Result.ok(value=x)` and fieldless `UefiStatus.success` through one enum-constructor path.
- [ ] Emit HIR for tagged-union construction with tag value and payload field bindings.
- [ ] Add diagnostics for missing payload fields, extra payload fields, duplicate payload field assignments, and payload field type mismatch.
- [ ] Preserve fieldless enum construction behavior.

**Acceptance Criteria:**

- Constructing `Result.ok(value=machine)` produces a HIR enum constructor with one payload binding.
- Fieldless enum construction continues to work.
- Incorrect constructor arity emits a named diagnostic and does not lower to a marker value.

**Example Source Shape:**

```wr
use UefiStatus from wrela_std.target.uefi.status

enum Result[Ok, Err]:
    ok(value: Ok)
    err(error: Err)

class BootError:

class Wrapper:
    fn wrap_status(self, status: UefiStatus) -> Result[UefiStatus, BootError]:
        return Result.ok(value=status)
```

**Example Test Shape:**

```ts
test("enum payload construction lowers to HIR constructor", () => {
  const result = lowerEnumConstructorExpression("Result.ok(value=status)");

  expect(result.hirExpression.kind.kind).toBe("enumConstructor");
  expect(result.hirExpression.kind.payloadFields.map((field) => field.name)).toEqual(["value"]);
});
```

**Verification Commands:**

```bash
bun test tests/unit/hir/enum-case-model.test.ts
bun test tests/unit/hir/expression-lowerer.test.ts
bun run agent:check
```

**Commit Message:**

```text
Lower tagged-union construction into HIR -Codex Automated
```

---

## WCR-42: Remove Test-Named Proof Helpers From Production Paths

**Files:**

- Modify: `src/proof-check/domains/validation.ts`
- Modify: `src/proof-check/domains/take-session-operations.ts`
- Modify: `src/proof-check/internal.ts`
- Test: `tests/unit/proof-check/validation.test.ts`
- Test: `tests/unit/proof-check/take-sessions.test.ts`

**Description:**

Production proof-check code calls helpers named `apply*PatchesForTest`, and several reset helpers are exposed for tests. Rename production patch helpers to production names, keep test aliases only in test support or internal test exports, and delete reset scaffolding that has no call sites.

**Implementation Steps:**

- [ ] Rename `applyValidationPatchesForTest` to `applyValidationPatches`.
- [ ] Rename `applyTakeSessionPatchesForTest` to `applyTakeSessionPatches`.
- [ ] Update production call sites to use the production names.
- [ ] Keep `*ForTest` aliases only in `src/proof-check/internal.ts` when tests still import them directly.
- [ ] Run `rg -n "apply.*PatchesForTest" src/proof-check` and remove every production call site.
- [ ] Run `rg -n "reset.*ForTest" src/proof-check tests` and delete reset helpers with no test call sites.
- [ ] Add tests proving renamed helpers produce the same state transitions.

**Acceptance Criteria:**

- No production implementation file calls a `*ForTest` helper.
- Test-only aliases live only in `src/proof-check/internal.ts` or test support files.
- Unused reset helpers are deleted with their exports.
- Proof-check permission tests from WCR-21 and WCR-22 still pass.

**Example Rename Shape:**

```ts
export function applyValidationPatches(
  state: ProofCheckState,
  patches: readonly ProofCheckStatePatch[],
): ProofCheckState {
  return applyValidationPatchEntries(state, patches);
}
```

**Verification Commands:**

```bash
rg -n "apply.*PatchesForTest" src/proof-check
rg -n "reset.*ForTest" src/proof-check tests
bun test tests/unit/proof-check/validation.test.ts
bun test tests/unit/proof-check/take-sessions.test.ts
bun run agent:check
```

**Commit Message:**

```text
Remove test-named proof helpers from production paths -Codex Automated
```

---

## WCR-43: Define Canonical OptIR Pass Execution Contract

**Files:**

- Add: `src/opt-ir/passes/pass-execution.ts`
- Modify: `src/opt-ir/verify/pass-schedule-consistency.ts`
- Test: `tests/unit/opt-ir/passes/pass-execution.test.ts`
- Test: `tests/unit/opt-ir/pass-schedule-consistency.test.ts`

**Description:**

Create the canonical execution API every OptIR pass must use. Do not overwrite `src/opt-ir/passes/pass-contract.ts`: that existing module owns `OptIrPassContract`, fact preservation, rewrite legality, scheduling metadata, and invariant schemas. This task adds `pass-execution.ts` for run-time plumbing only, and each execution definition must reference the existing `OptIrPassContract`.

**Implementation Steps:**

- [ ] Define `OptIrPassName` as a closed union for current passes.
- [ ] Define `OptIrPassContext` with pass name, fresh ID allocator, verifier mode, and diagnostic sink.
- [ ] Define `OptIrPassResult` with `program`, `changed`, `diagnostics`, and typed metadata.
- [ ] Define `OptIrPassDefinition` with `passId`, `contract: OptIrPassContract`, and `execute(context): OptIrPassResult`.
- [ ] Add `unchangedOptIrPassResult` and `changedOptIrPassResult` helper constructors.
- [ ] Add a helper that validates an execution definition's `passId` matches `definition.contract.passId`.
- [ ] Extend `pass-schedule-consistency.ts` so scheduled production passes can be checked against execution definitions without duplicating fact/legality contract rules.
- [ ] Add tests proving pass results cannot omit diagnostics or changed status.
- [ ] Add tests proving pass context always contains a whole-program fresh ID allocator.
- [ ] Add tests proving `pass-execution.ts` imports and uses `OptIrPassContract` instead of redefining or shadowing it.

**Acceptance Criteria:**

- New OptIR pass code can be written without inventing a local result shape.
- Pass context exposes the canonical allocator from WCR-04.
- `src/opt-ir/passes/pass-contract.ts` remains the single home for fact preservation, rewrite legality, scheduling, and invariant schema types.
- `src/opt-ir/passes/pass-execution.ts` is the single home for `OptIrPassContext`, `OptIrPassResult`, and execution-definition helpers.
- The schedule consistency verifier can reject an execution definition whose `passId` disagrees with its attached `OptIrPassContract`.
- No existing pass is migrated in this task.

**Example Execution Shape:**

```ts
import type { OptIrPassContract } from "./pass-contract";

export interface OptIrPassContext {
  readonly passName: OptIrPassName;
  readonly ids: OptIrFreshIdAllocator;
  readonly verify: OptIrPassVerifier;
}

export interface OptIrPassResult<Metadata = undefined> {
  readonly program: OptIrProgram;
  readonly changed: boolean;
  readonly diagnostics: readonly OptIrOptimizationDiagnostic[];
  readonly metadata: Metadata;
}

export interface OptIrPassDefinition<Metadata = undefined> {
  readonly passId: OptimizationPassId;
  readonly contract: OptIrPassContract;
  readonly execute: (context: OptIrPassContext) => OptIrPassResult<Metadata>;
}
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/passes/pass-execution.test.ts
bun test tests/unit/opt-ir/pass-schedule-consistency.test.ts
bun run agent:check
```

**Commit Message:**

```text
Define canonical OptIR pass execution contract -Codex Automated
```

---

## WCR-44: Add Canonical OptIR Dataflow Solver

**Files:**

- Add: `src/opt-ir/analyses/dataflow.ts`
- Add: `src/opt-ir/analyses/dataflow-lattice.ts`
- Test: `tests/unit/opt-ir/analyses/dataflow.test.ts`

**Description:**

Add one worklist dataflow engine for forward and backward CFG analyses. Memory SSA, SCCP, DCE liveness, and stack-promotion evidence must use this solver instead of bespoke block-order traversal.

**Implementation Steps:**

- [ ] Define a generic `OptIrDataflowLattice<Value>` interface with `bottom`, `equals`, `meet`, and `format`.
- [ ] Define `solveForwardOptIrDataflow` over CFG predecessors and successors.
- [ ] Define `solveBackwardOptIrDataflow` over CFG successors and predecessors.
- [ ] Add deterministic worklist ordering by function block order and edge stable order.
- [ ] Add fuel based on block and edge count with a typed diagnostic on exhaustion.
- [ ] Add diamond CFG tests for forward and backward analyses.

**Acceptance Criteria:**

- Dataflow results are deterministic for repeated runs.
- The solver handles branches, joins, loops, and unreachable blocks.
- Fuel exhaustion returns a diagnostic and a structurally valid partial result.

**Example Solver Shape:**

```ts
export function solveForwardOptIrDataflow<State>(input: {
  readonly functionIr: OptIrFunction;
  readonly lattice: OptIrDataflowLattice<State>;
  readonly transferBlock: (block: OptIrBlock, state: State) => State;
}): OptIrDataflowResult<State> {
  return runWorklistDataflow(input);
}
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/analyses/dataflow.test.ts
bun run agent:check
```

**Commit Message:**

```text
Add canonical OptIR dataflow solver -Codex Automated
```

---

## WCR-45: Migrate Local OptIR Passes To Canonical Execution Contract

**Files:**

- Modify: `src/opt-ir/passes/cfg-simplification.ts`
- Modify: `src/opt-ir/passes/sccp.ts`
- Modify: `src/opt-ir/passes/dce.ts`
- Test: `tests/unit/opt-ir/passes/cfg-simplification.test.ts`
- Test: `tests/unit/opt-ir/passes/sccp.test.ts`
- Test: `tests/unit/opt-ir/passes/dce.test.ts`

**Description:**

Migrate the local, pure OptIR passes to the pass execution contract from WCR-43 and dataflow solver from WCR-44. This removes pass-specific result shapes for CFG simplification, SCCP, and DCE.

**Implementation Steps:**

- [ ] Update CFG simplification to accept `OptIrPassContext` and return `OptIrPassResult`.
- [ ] Update SCCP to use the canonical pass result and emit structured lattice diagnostics.
- [ ] Update DCE to use backward dataflow from WCR-44 for liveness.
- [ ] Delete local result interfaces replaced by `OptIrPassResult`.
- [ ] Add tests proving each pass reports `changed: false` when no rewrite happens.
- [ ] Add tests proving diagnostics are returned through the canonical `diagnostics` field.

**Acceptance Criteria:**

- CFG simplification, SCCP, and DCE have no private pass result contract.
- All three passes can be invoked through a shared `runOptIrPass` test helper.
- Existing behavioral tests still pass.

**Example Invocation Shape:**

```ts
const result = runOptIrPass({
  passName: "dce",
  program,
  execute: eliminateDeadCode,
});

expect(result.changed).toBe(true);
expect(result.diagnostics).toEqual([]);
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/passes/cfg-simplification.test.ts
bun test tests/unit/opt-ir/passes/sccp.test.ts
bun test tests/unit/opt-ir/passes/dce.test.ts
bun run agent:check
```

**Commit Message:**

```text
Migrate local OptIR passes to canonical execution -Codex Automated
```

---

## WCR-46: Migrate Global OptIR Passes To Canonical Execution Contract

**Files:**

- Modify: `src/opt-ir/passes/memory-optimization.ts`
- Modify: `src/opt-ir/passes/licm.ts`
- Modify: `src/opt-ir/passes/stack-promotion.ts`
- Modify: `src/opt-ir/passes/whole-program-inlining-splice.ts`
- Test: `tests/unit/opt-ir/passes/memory-optimization.test.ts`
- Test: `tests/unit/opt-ir/passes/licm.test.ts`
- Test: `tests/unit/opt-ir/passes/stack-promotion.test.ts`
- Test: `tests/unit/opt-ir/passes/whole-program-inlining-splice.test.ts`

**Description:**

Migrate passes that depend on whole-program IDs, memory facts, or inlining state to the canonical pass execution contract. This makes allocator ownership, diagnostics, and verifier hooks uniform across the optimizer.

**Implementation Steps:**

- [ ] Update memory optimization to use `OptIrPassContext` and dataflow diagnostics.
- [ ] Update LICM to get fresh IDs only from pass context.
- [ ] Update stack promotion to report escape-evidence diagnostics through the pass result.
- [ ] Update whole-program inlining splice helpers to use pass context for IDs and diagnostics.
- [ ] Delete pass-local allocator plumbing made obsolete by WCR-04 and WCR-43.
- [ ] Add tests proving every migrated pass calls the verifier hook when configured.

**Acceptance Criteria:**

- No migrated pass creates a fresh ID allocator directly.
- No migrated pass returns diagnostics outside `OptIrPassResult`.
- Verifier failures can stop a pass through the canonical context.

**Example Verifier Hook Shape:**

```ts
const result = runLicm(program, {
  ...context,
  verify: failOnInvalidOptIr,
});

expect(result.diagnostics).toEqual([]);
expect(result.program).toBeDefined();
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/passes/memory-optimization.test.ts
bun test tests/unit/opt-ir/passes/licm.test.ts
bun test tests/unit/opt-ir/passes/stack-promotion.test.ts
bun test tests/unit/opt-ir/passes/whole-program-inlining-splice.test.ts
bun run agent:check
```

**Commit Message:**

```text
Migrate global OptIR passes to canonical execution -Codex Automated
```

---

## WCR-47: Replace Ad Hoc OptIR Pipeline With Pass Manager

**Files:**

- Add: `src/opt-ir/passes/pass-manager.ts`
- Modify: `src/opt-ir/policy/pass-order-policy.ts`
- Modify: `src/opt-ir/passes/pipeline-steps.ts`
- Modify: `src/opt-ir/verify/pass-schedule-consistency.ts`
- Test: `tests/unit/opt-ir/passes/pass-manager.test.ts`
- Test: `tests/unit/opt-ir/passes/pipeline-steps.test.ts`
- Test: `tests/unit/opt-ir/pass-schedule-consistency.test.ts`

**Description:**

Make the canonical pass manager the only production path for running OptIR optimization passes. The manager must preserve the existing production schedule semantics from `src/opt-ir/policy/pass-order-policy.ts`, including bounded fixpoint execution for consecutive schedule entries that share a `fixpointId`. Delete ad hoc pass sequencing once every pass migrated in WCR-45 and WCR-46 uses `OptIrPassResult`.

**Implementation Steps:**

- [ ] Add `runOptIrPassPipeline` that builds one allocator/context and runs ordered schedule entries backed by `OptIrPassDefinition`.
- [ ] Consume the production schedule's `fixpoint` / `fixpointId` metadata; do not replace it with a flat string pass list.
- [ ] Partition only consecutive entries with the same `fixpointId` into one fixpoint group.
- [ ] Run each fixpoint group until every pass reports `changed: false` in one full group round or the group's fuel is exhausted.
- [ ] Emit a structured optimization diagnostic when fixpoint fuel is exhausted, including the `fixpointId`, pass IDs, round count, and last changing pass.
- [ ] Add a schedule-consistency check that rejects non-consecutive entries reusing a `fixpointId`, unbounded fixpoint groups, or fixpoint entries whose contracts are not idempotent.
- [ ] Run the structural verifier before and after each pass when verification is enabled.
- [ ] Accumulate pass diagnostics and metadata in deterministic pass order.
- [ ] Replace production callers in `pipeline-steps.ts` with the pass manager.
- [ ] Delete old ad hoc pass sequencing helpers from `pipeline-steps.ts`.
- [ ] Add a test proving pass order and diagnostics are stable.
- [ ] Add tests proving `scope-expansion-fixpoint` and `scalar-simplification-fixpoint` style groups rerun until no pass changes.
- [ ] Add tests proving fixpoint exhaustion returns diagnostics and does not silently claim success.

**Acceptance Criteria:**

- Production optimization goes through `runOptIrPassPipeline`.
- Old ad hoc pass sequencing is deleted.
- The pass manager is the only place that constructs pass contexts.
- Consecutive production entries sharing `fixpointId` still run as bounded state-change fixpoints.
- Existing scorecard/specialization behavior is preserved by the manager migration.
- `verify:scorecard` passes after the migration.

**Example Manager Shape:**

```ts
const optimized = runOptIrPassPipeline({
  program,
  schedule: [
    { pass: "constant-folding", fixpointId: "scalar-simplification-fixpoint" },
    { pass: "sccp", fixpointId: "scalar-simplification-fixpoint" },
    { pass: "dce", fixpointId: "scalar-simplification-fixpoint" },
    { pass: "gvn", fixpointId: "scalar-simplification-fixpoint" },
    { pass: "copy-propagation", fixpointId: "scalar-simplification-fixpoint" },
    { pass: "cfg-simplification", fixpointId: "scalar-simplification-fixpoint" },
    { pass: "memory-ssa" },
    { pass: "licm" },
  ],
  verify: "before-and-after-each-pass",
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/passes/pass-manager.test.ts
bun test tests/unit/opt-ir/passes/pipeline-steps.test.ts
bun test tests/unit/opt-ir/pass-schedule-consistency.test.ts
bun run verify:scorecard
bun run agent:check
```

**Commit Message:**

```text
Replace OptIR pass sequencing with pass manager -Codex Automated
```

---

## WCR-48: Migrate Frontend And Semantic Stages To Pipeline Contract

**Files:**

- Modify: `src/frontend/module-loader.ts`
- Modify: `src/semantic/index.ts`
- Add: `src/pipeline/frontend-semantic-stage.ts`
- Test: `tests/unit/pipeline/frontend-semantic-stage.test.ts`

**Description:**

Move frontend module loading and semantic checking onto the typed pipeline contract from WCR-31. Diagnostics and module graph metadata must flow through `CompilerStageResult`, not loose objects.

**Implementation Steps:**

- [ ] Wrap frontend module graph loading in a `runFrontendStage` function returning `CompilerStageResult<"frontend">`.
- [ ] Attach frontend module graph metadata with the `frontendModuleGraph` metadata key.
- [ ] Wrap semantic checking in `runSemanticStage` returning `CompilerStageResult<"semantic">`.
- [ ] Preserve existing frontend and semantic diagnostics exactly.
- [ ] Add tests proving a frontend error prevents semantic stage execution.

**Acceptance Criteria:**

- Frontend and semantic stage boundaries use `CompilerStageResult`.
- Frontend module graph metadata is not stored on source or parse artifacts.
- Semantic stage tests can run with fake frontend results.

**Example Stage Shape:**

```ts
const frontend = runFrontendStage({ entryModuleName, sources });
if (frontend.kind === "error") return frontend;

const semantic = runSemanticStage({ frontend });
```

**Verification Commands:**

```bash
bun test tests/unit/pipeline/frontend-semantic-stage.test.ts
bun run agent:check
```

**Commit Message:**

```text
Migrate frontend semantic stages to typed pipeline -Codex Automated
```

---

## WCR-49: Migrate HIR Through OptIR Stages To Pipeline Contract

**Files:**

- Add: `src/pipeline/hir-optir-stage.ts`
- Modify: `src/hir/index.ts`
- Modify: `src/opt-ir/lower/construction-pipeline.ts`
- Modify: `src/opt-ir/passes/pipeline-steps.ts`
- Test: `tests/unit/pipeline/hir-optir-stage.test.ts`

**Description:**

Move HIR lowering, Proof MIR/OptIR construction, and OptIR optimization onto the typed pipeline contract. This connects the pass manager from WCR-47 to the compiler-wide pipeline.

**Implementation Steps:**

- [ ] Add `runHirStage` returning `CompilerStageResult<"hir">`.
- [ ] Add `runOptIrConstructionStage` returning `CompilerStageResult<"optIr">`.
- [ ] Add `runOptIrOptimizationStage` that calls `runOptIrPassPipeline`.
- [ ] Attach OptIR pass metadata through the `optIrPasses` metadata key.
- [ ] Delete loose tuple/object return values that duplicate the stage result.
- [ ] Add tests proving HIR errors stop OptIR construction.

**Acceptance Criteria:**

- HIR and OptIR stages use the same `CompilerStageResult` type as frontend/semantic stages.
- OptIR pass diagnostics appear in pipeline metadata and diagnostics.
- No optimization metadata is written onto `OptIrProgram`.

**Example Stage Shape:**

```ts
const optIr = runOptIrOptimizationStage({
  input: constructedOptIr,
  passes: defaultOptIrPasses,
});

const passMetadata = requireCompilerMetadata(optIr, "optIrPasses");
```

**Verification Commands:**

```bash
bun test tests/unit/pipeline/hir-optir-stage.test.ts
bun run agent:check
```

**Commit Message:**

```text
Migrate HIR OptIR stages to typed pipeline -Codex Automated
```

---

## WCR-50: Migrate Target Packaging And Validation To Pipeline Contract

**Files:**

- Add: `src/pipeline/target-package-stage.ts`
- Modify: `src/target/uefi-aarch64/package-pipeline.ts`
- Modify: `src/validation/full-image/runner.ts`
- Test: `tests/unit/pipeline/target-package-stage.test.ts`
- Test: `tests/integration/target/uefi-aarch64/package-pipeline.test.ts`

**Description:**

Finish the typed compiler pipeline migration by moving target lowering, package creation, and full-image validation onto `CompilerStageResult`. This is the deletion point for loose package pipeline stage objects.

**Implementation Steps:**

- [ ] Add `runTargetStage` returning `CompilerStageResult<"target">`.
- [ ] Add `runPackageStage` returning `CompilerStageResult<"package">`.
- [ ] Add `runValidationStage` returning `CompilerStageResult<"validation">`.
- [ ] Thread release evidence through the `releaseEvidence` metadata key.
- [ ] Delete old loose package-pipeline result wrappers that duplicate stage result fields.
- [ ] Add tests proving target errors prevent package and validation stages.

**Acceptance Criteria:**

- End-to-end package pipeline exposes typed stage results.
- Release/full-image validation evidence is pipeline metadata, not an untyped sidecar.
- Public API and CLI callers use the typed pipeline facade.

**Example Stage Shape:**

```ts
const packaged = runPackageStage({ target });
const validated = runValidationStage({ packageResult: packaged });
const evidence = requireCompilerMetadata(validated, "releaseEvidence");
```

**Verification Commands:**

```bash
bun test tests/unit/pipeline/target-package-stage.test.ts
bun test tests/integration/target/uefi-aarch64/package-pipeline.test.ts
bun run agent:check
```

**Commit Message:**

```text
Migrate target packaging validation to typed pipeline -Codex Automated
```

---

## WCR-51: Lower Tagged-Union Matching And Payload Binding

**Files:**

- Modify: `src/hir/statement-lowerer.ts`
- Modify: `src/hir/enum-case-model.ts`
- Modify: `src/mono/function-statement-cloner.ts`
- Test: `tests/unit/hir/statement-lowerer.test.ts`
- Test: `tests/unit/mono/function-statement-cloner.test.ts`

**Description:**

Lower match arms over payload-bearing enum cases. Matching must test the tag first and bind payload fields only inside the selected arm.

**Implementation Steps:**

- [ ] Extend match lowering to recognize enum case patterns with payload binders.
- [ ] Compare enum tags before entering a payload-bearing arm.
- [ ] Bind payload fields to arm-local places using case payload metadata from WCR-39.
- [ ] Update mono statement cloning for payload-bound match arms.
- [ ] Add diagnostics for payload binder count mismatch and duplicate binder names.

**Acceptance Criteria:**

- `Result.err(error)` binds `error` only in the err arm.
- Fieldless enum matching remains unchanged.
- Mono cloning preserves payload-bound locals and remaps their places.

**Example Test Shape:**

```ts
test("enum payload match binds payload only in selected arm", () => {
  const lowered = lowerMatchStatement(
    "match result:\n    Result.err(error):\n        return error\n",
  );

  expect(lowered.diagnostics).toEqual([]);
  expect(payloadBindings(lowered)).toEqual(["error"]);
});
```

**Verification Commands:**

```bash
bun test tests/unit/hir/statement-lowerer.test.ts
bun test tests/unit/mono/function-statement-cloner.test.ts
bun run agent:check
```

**Commit Message:**

```text
Lower tagged-union matching and payload binding -Codex Automated
```

---

## WCR-52: Lower Tagged Unions To OptIR

**Files:**

- Modify: `src/opt-ir/lower/proof-mir-construct-lowering.ts`
- Modify: `src/opt-ir/lower/proof-mir-switch-lowering.ts`
- Modify: `src/opt-ir/lower/canonical-operations.ts`
- Modify: `src/opt-ir/verify/structural-verifier.ts`
- Test: `tests/unit/opt-ir/lower/proof-mir-construct-lowering.test.ts`
- Test: `tests/unit/opt-ir/lower/proof-mir-switch-lowering.test.ts`
- Test: `tests/unit/opt-ir/verify/structural-verifier.test.ts`

**Description:**

Translate tagged-union construction and matching into OptIR operations using the enum layout facts from WCR-40. Construction writes tag and payload. Matching reads tag and branches before payload reads.

**Implementation Steps:**

- [ ] Add canonical operations for enum tag store, enum payload store, enum tag load, and enum payload load if existing operations cannot express them.
- [ ] Lower enum construction to tag write followed by payload writes.
- [ ] Lower enum matching to tag read and switch/conditional branch.
- [ ] Lower payload binding to payload reads inside the selected arm.
- [ ] Add a structural verifier rule that payload reads are dominated by matching tag checks.
- [ ] Add verifier diagnostics that name the enum type, case label, payload field, payload-read operation, and nearest missing tag check.

**Acceptance Criteria:**

- OptIR for `Result.ok(value=x)` contains one tag write and one payload write.
- OptIR for matching on `Result.err` reads payload only after tag discrimination.
- Structural verification rejects an enum payload read not dominated by a compatible tag check.
- Existing fieldless enum lowering remains unchanged.

**Example Test Shape:**

```ts
test("tagged union construction lowers tag before payload", () => {
  const operations = lowerResultOkToOptIr();

  expect(operationKinds(operations)).toEqual(["enumTagStore", "enumPayloadStore"]);
});
```

**Verification Commands:**

```bash
bun test tests/unit/opt-ir/lower/proof-mir-construct-lowering.test.ts
bun test tests/unit/opt-ir/lower/proof-mir-switch-lowering.test.ts
bun test tests/unit/opt-ir/verify/structural-verifier.test.ts
bun run agent:check
```

**Commit Message:**

```text
Lower tagged unions to OptIR -Codex Automated
```

---

## WCR-61: Migrate Attempt And Validation Contracts To Tagged Result

**Files:**

- Modify: `src/semantic/surface/contract-type-identity.ts`
- Modify: `src/hir/attempt-lowerer.ts`
- Modify: `src/hir/validation-lowerer.ts`
- Modify: `src/proof-mir/lower/attempt-lowerer.ts`
- Modify: `src/proof-mir/lower/validation-lowerer.ts`
- Modify: `src/proof-mir/lower/validation-lowerer-support.ts`
- Modify: `src/opt-ir/lower/proof-mir-attempt-operands.ts`
- Modify: `src/target/uefi-aarch64/target-surfaces.ts`
- Test: `tests/unit/semantic/surface/contract-type-identity.test.ts`
- Test: `tests/unit/hir/attempt-lowerer.test.ts`
- Test: `tests/unit/hir/validation-lowerer.test.ts`
- Test: `tests/unit/proof-mir/attempt-lowerer.test.ts`
- Test: `tests/unit/proof-mir/validation-lowerer.test.ts`
- Test: `tests/unit/opt-ir/lower/proof-mir-attempt-operands.test.ts`
- Test: `tests/unit/target/uefi-aarch64/target-surfaces.test.ts`

**Description:**

Move attempt propagation, validation contracts, and UEFI status-carrier recognition from marker/class-style `Result` assumptions to the tagged-union `Result[Ok, Err]` shape lowered by WCR-52. This task lands before the stdlib source files switch in WCR-53 so compiler internals already understand real `Result` metadata.

**Implementation Steps:**

- [ ] Define a semantic `ResultContractIdentity` helper that recognizes the canonical stdlib `Result[Ok, Err]` enum by type ID, generic arguments, `ok` case payload type, and `err` case payload type.
- [ ] Preserve existing validation and attempt contract identity APIs, but have them return tagged-result identity metadata instead of marker-class-only assumptions.
- [ ] Update HIR attempt lowering so `? BootError.X` unwraps only the `Result.ok` payload and propagates only the `Result.err` payload through the mapped error case.
- [ ] Update HIR validation lowering so `ok` and `err` validation arms read payload types from enum case metadata.
- [ ] Update Proof MIR attempt and validation lowerers to carry result enum type ID, ok/err case IDs, tag information, and payload place metadata.
- [ ] Update `proof-mir-attempt-operands.ts` so runtime attempt operands are derived from tagged-result case and payload metadata, not from a marker result constructor type.
- [ ] Update `target-surfaces.ts` status-carrier options to accept tagged-result identity metadata and lower status carrier type, switch labels, and payload extraction through that metadata.
- [ ] Emit diagnostics when the canonical `Result` type is present but lacks exactly `ok(value: Ok)` and `err(error: Err)` payload cases.
- [ ] Add tests for ok propagation, err propagation, validation ok/err payload binding, unsupported Result shape diagnostics, and UEFI status-carrier lowering.

**Acceptance Criteria:**

- No compiler code path assumes `Result` is a fieldless marker class or constructor-only status carrier.
- `? BootError.X` preserves success payloads and propagates original error payloads through tagged `Result.err`.
- Validation matches bind ok/err payloads from enum case metadata.
- Proof MIR and OptIR attempt lowering retain enough case/tag/payload metadata for WCR-52 structural verification.
- UEFI AArch64 status-carrier lowering recognizes tagged `Result` metadata and keeps existing status-code ABI behavior.
- WCR-53 can replace stdlib `Result` source without adding compiler-layer special cases.

**Example Identity Shape:**

```ts
interface ResultContractIdentity {
  readonly resultTypeId: TypeId;
  readonly okCaseId: ItemId;
  readonly errCaseId: ItemId;
  readonly okPayloadType: CheckedType;
  readonly errPayloadType: CheckedType;
}
```

**Example Attempt Test Shape:**

```ts
test("attempt propagation unwraps ok and propagates err payload", () => {
  const lowered = lowerAttemptExpression(
    "let status = firmware.open(handle)? BootError.device_error\n",
  );

  expect(lowered.diagnostics).toEqual([]);
  expect(attemptResultShape(lowered)).toEqual({
    okCase: "Result.ok",
    errCase: "Result.err",
    propagatedErrorPayload: "BootError.device_error",
  });
});
```

**Example Target Surface Shape:**

```ts
const surface = productionUefiAArch64OptIrTargetSurface(target, {
  statusCarrierResult: resultContractIdentity,
});

expect(surface.sourceTypeAbi?.lowerSwitchCaseLabel({ type: resultType, label: "err" })).toBe("1");
```

**Verification Commands:**

```bash
bun test tests/unit/semantic/surface/contract-type-identity.test.ts
bun test tests/unit/hir/attempt-lowerer.test.ts
bun test tests/unit/hir/validation-lowerer.test.ts
bun test tests/unit/proof-mir/attempt-lowerer.test.ts
bun test tests/unit/proof-mir/validation-lowerer.test.ts
bun test tests/unit/opt-ir/lower/proof-mir-attempt-operands.test.ts
bun test tests/unit/target/uefi-aarch64/target-surfaces.test.ts
bun run agent:check
```

**Commit Message:**

```text
Migrate attempts and validation to tagged Result -Codex Automated
```

---

## WCR-53: Replace Marker Option And Result With Real Stdlib Tagged Unions

**Files:**

- Modify: `stdlib/wrela-std/core/option.wr`
- Modify: `stdlib/wrela-std/core/result.wr`
- Modify: `stdlib/wrela-std/target/uefi/firmware.wr`
- Modify: `tests/fixtures/full-image-validation/packet-counter/direct-platform/src/image.wr`
- Modify: `tests/fixtures/full-image-validation/packet-counter-real-stream/direct-platform/src/image.wr`
- Test: `tests/system/stdlib/option-result.test.ts`
- Test: `tests/integration/validation/full-image/full-image-validation-runner.test.ts`

**Description:**

Replace marker stdlib `Option` and `Result` classes with real tagged unions after WCR-61 has moved compiler internals to tagged-result identity. This is the stdlib source and fixture migration endpoint for WCR-39 through WCR-52 and WCR-61.

**Implementation Steps:**

- [ ] Change `Option[Value]` from a class to an enum with `some(value: Value)` and `none`.
- [ ] Change `Result[Ok, Err]` from a class to an enum with `ok(value: Ok)` and `err(error: Err)`.
- [ ] Update firmware helpers to return real `Result.ok` and `Result.err` variants using the compiler behavior from WCR-61.
- [ ] Update packet-counter full-image fixtures to compile with real `Result` payloads.
- [ ] Add stdlib tests for constructing, matching, and propagating `Option` and `Result`.
- [ ] Update compatibility docs or snapshots so `Option` and `Result` are documented as tagged unions.

**Acceptance Criteria:**

- `stdlib/wrela-std/core/option.wr` and `stdlib/wrela-std/core/result.wr` contain enum declarations, not marker classes.
- Full-image validation fixtures compile with real `Result[Never, BootError]` returns.
- Propagation through `? BootError.X` remains green through the WCR-61 test coverage.
- No compatibility doc describes `Option` or `Result` as marker wrappers.

**Example Stdlib Shape:**

```wr
enum Option[Value]:
    some(value: Value)
    none

enum Result[Ok, Err]:
    ok(value: Ok)
    err(error: Err)
```

**Verification Commands:**

```bash
bun test tests/system/stdlib/option-result.test.ts
bun test tests/integration/validation/full-image/full-image-validation-runner.test.ts
bun run agent:check
```

**Commit Message:**

```text
Implement real stdlib Option and Result -Codex Automated
```

---

## WCR-54: Add HIR-To-HIR Transform Adapter

**Files:**

- Add: `src/hir/transform.ts`
- Modify: `src/hir/generic-substitution.ts`
- Test: `tests/unit/hir/transform.test.ts`
- Test: `tests/unit/hir/generic-substitution.test.ts`

**Description:**

Build the first concrete adapter on top of WCR-34 traversal: HIR-to-HIR transformation with identity preservation. Migrate generic substitution to prove checked-type/resource-kind substitution without touching mono cloning yet.

**Implementation Steps:**

- [ ] Define `HirTransformVisitor` returning replacement nodes or `undefined` for identity.
- [ ] Preserve object identity for unchanged subtrees.
- [ ] Add checked-type and resource-kind substitution hooks.
- [ ] Migrate `substituteCheckedSignature` to use the adapter.
- [ ] Add tests proving unchanged signatures preserve identity.

**Acceptance Criteria:**

- HIR-to-HIR transforms use `src/hir/transform.ts`.
- `generic-substitution.ts` no longer owns recursive checked-type traversal logic.
- Existing substitution behavior is structurally unchanged.

**Example Adapter Shape:**

```ts
const result = transformHirExpression(expression, {
  rewriteCheckedType: (type) => substituteCheckedType(type, substitutions),
});
```

**Verification Commands:**

```bash
bun test tests/unit/hir/transform.test.ts
bun test tests/unit/hir/generic-substitution.test.ts
bun run agent:check
```

**Commit Message:**

```text
Add HIR transform adapter and migrate generic substitution -Codex Automated
```

---

## WCR-55: Migrate Mono Expression And Call Cloners To Transform Framework

**Files:**

- Modify: `src/mono/function-expression-cloner.ts`
- Modify: `src/mono/function-call-cloner.ts`
- Modify: `src/mono/function-instantiator-shell.ts`
- Test: `tests/unit/mono/function-expression-cloner.test.ts`
- Test: `tests/unit/mono/function-call-cloner.test.ts`

**Description:**

Move mono expression and call cloning onto the canonical traversal/context framework. This is the first mono migration slice because expressions contain the densest hand-rolled traversal.

**Implementation Steps:**

- [ ] Add a mono transform context adapter that wraps `HirTransformContext`.
- [ ] Route expression ID remapping through the transform context.
- [ ] Migrate literal, name, member, object, call, attempt, validation, unary, binary, and comparison expression cloning.
- [ ] Delete expression-specific traversal helpers that become unused.
- [ ] Add tests proving expression remap keys are unchanged.

**Acceptance Criteria:**

- Expression and call cloning use the canonical traversal context.
- Mono expression output is structurally equal to pre-migration fixtures.
- No expression cloner owns a separate traversal stack.

**Example Context Shape:**

```ts
const cloned = cloneMonoExpressionWithTransform({
  source,
  context: createMonoTransformContext(input),
});
```

**Verification Commands:**

```bash
bun test tests/unit/mono/function-expression-cloner.test.ts
bun test tests/unit/mono/function-call-cloner.test.ts
bun run agent:check
```

**Commit Message:**

```text
Migrate mono expression cloners to HIR transform framework -Codex Automated
```

---

## WCR-56: Migrate Mono Statement Place And Validation Cloners

**Files:**

- Modify: `src/mono/function-statement-cloner.ts`
- Modify: `src/mono/function-place-cloner.ts`
- Modify: `src/mono/function-validation-statement-cloner.ts`
- Test: `tests/unit/mono/function-statement-cloner.test.ts`
- Test: `tests/unit/mono/function-place-cloner.test.ts`
- Test: `tests/unit/mono/function-validation-statement-cloner.test.ts`

**Description:**

Finish migrating mono cloning families that still perform hand traversal after WCR-55. Statements, places, and validation statement cloning must share the same transform context and remap storage.

**Implementation Steps:**

- [ ] Route statement ID remapping through the mono transform context.
- [ ] Migrate block, let, assignment, match, loop, return, validation, and take statement cloning.
- [ ] Migrate resource place cloning and owned proof ID remapping into context helpers.
- [ ] Migrate validation statement cloning to use shared statement traversal.
- [ ] Add tests proving remap output remains stable for a generic instantiation fixture.

**Acceptance Criteria:**

- Statement, place, and validation cloners use the shared transform context.
- No mono cloner duplicates remap storage.
- Generic instantiation fixture output remains stable.

**Example Remap Shape:**

```ts
const monoStatementId = context.ids.statementIdFor(source.statementId);
context.remap.statementRemap.set(source.statementId, monoStatementId);
```

**Verification Commands:**

```bash
bun test tests/unit/mono/function-statement-cloner.test.ts
bun test tests/unit/mono/function-place-cloner.test.ts
bun test tests/unit/mono/function-validation-statement-cloner.test.ts
bun run agent:check
```

**Commit Message:**

```text
Migrate mono statement place validation cloners -Codex Automated
```

---

## WCR-57: Delete Old Mono Cloner Traversal Paths

**Files:**

- Modify: `src/mono/function-clone-coverage.ts`
- Modify: `src/mono/function-expression-cloner.ts`
- Modify: `src/mono/function-statement-cloner.ts`
- Modify: `src/mono/function-call-cloner.ts`
- Modify: `src/mono/function-place-cloner.ts`
- Test: `tests/audit/mono-maintainability-audit.test.ts`
- Test: `tests/integration/mono/generic-instantiation.test.ts`

**Description:**

Make the HIR/mono transform framework canonical by deleting legacy traversal helpers left behind by WCR-55 and WCR-56. Add audits so new mono traversal cannot grow outside the framework.

**Implementation Steps:**

- [ ] Delete unused legacy clone traversal helpers.
- [ ] Update `function-clone-coverage.ts` to measure coverage through the transform framework.
- [ ] Add an audit rejecting new recursive mono traversal functions outside approved transform files.
- [ ] Add an audit rejecting new remap maps outside the mono transform context.
- [ ] Run generic-instantiation integration tests to prove behavior stayed stable.

**Acceptance Criteria:**

- Mono cloning has one traversal context and one remap owner.
- Audit tests fail if a new hand-written mono traversal function is added.
- Generic instantiation output remains stable.

**Example Audit Shape:**

```ts
test("mono cloners use canonical transform context", () => {
  const violations = findMonoTraversalFunctionsOutside([
    "src/hir",
    "src/mono/mono-transform-context.ts",
  ]);
  expect(violations).toEqual([]);
});
```

**Verification Commands:**

```bash
bun test tests/audit/mono-maintainability-audit.test.ts
bun test tests/integration/mono/generic-instantiation.test.ts
bun run agent:check
```

**Commit Message:**

```text
Delete legacy mono cloner traversal paths -Codex Automated
```

---

## WCR-58: Add Syntax Span Lookup And Diagnostic Anchoring

**Files:**

- Add: `src/frontend/syntax/syntax-index.ts`
- Modify: `src/frontend/syntax/syntax-tree.ts`
- Test: `tests/unit/frontend/syntax/syntax-index.test.ts`

**Description:**

Build the first canonical service on top of WCR-33 identities: a syntax index for span lookup and diagnostic anchoring. This replaces ad hoc syntax walks when callers need nodes by span.

**Implementation Steps:**

- [ ] Build `SyntaxIndex` from a `SyntaxTree` root.
- [ ] Index node IDs, token IDs, spans, parent IDs, and child IDs.
- [ ] Add `findSmallestNodeContainingSpan`.
- [ ] Add `findTokenAtOffset`.
- [ ] Add diagnostic anchor helpers that return stable syntax IDs.
- [ ] Add tests for overlapping spans, zero-width spans, EOF token lookup, and nested nodes.

**Acceptance Criteria:**

- Syntax lookup uses the existing green/red tree.
- No second syntax arena exists.
- Diagnostics can anchor to a stable node or token ID.

**Example Index Shape:**

```ts
const index = buildSyntaxIndex(tree);
const anchor = index.findSmallestNodeContainingSpan(diagnostic.span);
expect(anchor?.id).toBeDefined();
```

**Verification Commands:**

```bash
bun test tests/unit/frontend/syntax/syntax-index.test.ts
bun run agent:check
```

**Commit Message:**

```text
Add syntax span lookup and diagnostic anchoring -Codex Automated
```

---

## WCR-59: Migrate AST Views And Import Discovery To Syntax Index

**Files:**

- Modify: `src/frontend/ast/syntax-query.ts`
- Modify: `src/frontend/module-import-discovery.ts`
- Modify: `src/frontend/parser/parser-diagnostics.ts`
- Test: `tests/unit/frontend/ast/syntax-query.test.ts`
- Test: `tests/unit/frontend/module-import-discovery.test.ts`

**Description:**

Make AST views and parser-backed import discovery consume the canonical syntax index from WCR-58 instead of doing local tree walks for span and child lookup.

**Implementation Steps:**

- [ ] Update `syntax-query.ts` to accept `SyntaxIndex`.
- [ ] Route AST view child lookup through indexed child IDs where possible.
- [ ] Route module import discovery spans through diagnostic anchors.
- [ ] Route parser diagnostic stable details through syntax anchors when available.
- [ ] Add tests proving import diagnostic spans remain stable.

**Acceptance Criteria:**

- AST views remain views over canonical syntax, not a second model.
- Import discovery uses syntax-index-backed spans.
- Existing AST view behavior remains unchanged.

**Example Query Shape:**

```ts
const query = createSyntaxQuery({ tree, index: buildSyntaxIndex(tree) });
const imports = discoverModuleImportsFromSyntax(query);
```

**Verification Commands:**

```bash
bun test tests/unit/frontend/ast/syntax-query.test.ts
bun test tests/unit/frontend/module-import-discovery.test.ts
bun run agent:check
```

**Commit Message:**

```text
Migrate AST views and imports to syntax index -Codex Automated
```

---

## WCR-60: Enforce Canonical Frontend Syntax Architecture

**Files:**

- Add: `tests/audit/frontend-syntax-architecture-audit.test.ts`
- Modify: `src/frontend/syntax/index.ts`
- Test: `tests/audit/frontend-syntax-architecture-audit.test.ts`

**Description:**

Close the frontend syntax architecture program by adding audits that prevent a second syntax arena, direct duplicate span lookup infrastructure, or parser-side AST models from returning.

**Implementation Steps:**

- [ ] Add an audit rejecting files named `syntax-arena.ts`, `syntax-node.ts`, or `flat-syntax*.ts` under `src/frontend`.
- [ ] Add an audit requiring syntax identity and lookup imports to come from `src/frontend/syntax`.
- [ ] Add an audit preventing parser files from importing AST view modules.
- [ ] Export only canonical syntax tree, identity, and index APIs from `src/frontend/syntax/index.ts`.
- [ ] Add tests proving the audit reports a synthetic violation path.

**Acceptance Criteria:**

- Frontend has one syntax source of truth: green/red `SyntaxTree` plus identity/index helpers.
- Audit fails on a second syntax arena.
- Parser-to-AST dependency boundary remains enforced.

**Example Audit Shape:**

```ts
test("frontend does not define a parallel syntax arena", () => {
  expect(findFiles("src/frontend/**/syntax-arena.ts")).toEqual([]);
  expect(findFiles("src/frontend/**/flat-syntax*.ts")).toEqual([]);
});
```

**Verification Commands:**

```bash
bun test tests/audit/frontend-syntax-architecture-audit.test.ts
bun run agent:check
```

**Commit Message:**

```text
Enforce canonical frontend syntax architecture -Codex Automated
```

---

## WCR-99: Full Review Closure

**Files:**

- Modify: `docs/review/2026-07-04-world-class-codebase-review.md` only if adding status links is desired
- Modify: `docs/reviews/2026-07-05-world-class-compiler-review.md` only if adding status links is desired
- Modify: `docs/ultimate-world-class-compiler-review.md` only if adding status links is desired
- Add: `docs/reviews/2026-07-05-remediation-status.md`

**Description:**

After all implementation tasks land, write a closure document mapping each original finding to the commit or PR that fixed it. This is a status artifact, not an implementation blocker.

**Implementation Steps:**

- [ ] Create a table with original finding, remediation task ID, commit/PR, tests, and remaining risk.
- [ ] Confirm `rg` checks for banned patterns pass.
- [ ] Confirm all release verification gates pass in strict mode on a machine with required tools.
- [ ] Confirm `bun run agent:check` passes.

**Acceptance Criteria:**

- Every accepted finding maps to one or more completed remediation tasks.
- No accepted finding remains without an owner, test, or documented closure.
- The closure doc links to the strict release manifest produced by WCR-25.

**Example Closure Row:**

```md
| Finding                                             | Task   | Evidence                                              | Status |
| --------------------------------------------------- | ------ | ----------------------------------------------------- | ------ |
| AArch64 pair-load peephole drops second destination | WCR-01 | `tests/unit/target/aarch64/backend/peepholes.test.ts` | Fixed  |
```

**Verification Commands:**

```bash
rg -n "as never|\?\? 0n|\?\? \"\"|ownerFunctionId \?\? 0" src
bun run verify:release
bun run agent:check
```

**Commit Message:**

```text
Document world-class remediation closure -Codex Automated
```

---

## Post-Implementation Review Addendum

An independent fresh-context signoff review found three implementation gaps after the main task set
was completed. The remediation loop treated them as plan findings and fixed them before final
handoff:

- Stack promotion escape evidence was still fail-open in production because
  `productionStackPromotionEscapeAnalysisInput` fabricated empty `addressTakenLocals` and
  `callbackCaptures` evidence. Production now omits evidence categories it cannot derive, so
  `computeOptIrEscapeAnalysis` keeps `doesNotEscape` false until complete evidence exists.
- OptIR construction and optimization still carried `operations` and `optimizationRegions` as
  program sidecars. Construction and optimization results now expose both artifacts as top-level
  typed fields, optimization input requires them explicitly, UEFI/AArch64 lowering threads
  optimization regions through dedicated artifact/state fields, and tests assert that programs do
  not grow these sidecars.
- The canonical pass execution contract was decorative because `pass-manager.ts` owned a separate
  local pass result shape. `pass-execution.ts` now owns the generic canonical pass result/run result
  contract, production pass definitions expose `name`, `passId`, `contract`, and canonical `run`,
  and the pass manager consumes that contract directly.

Additional focused verification added for these findings:

```bash
bun test ./tests/unit/opt-ir/pass-execution.test.ts ./tests/unit/opt-ir/pass-manager.test.ts ./tests/unit/opt-ir/pipeline.test.ts
bun test ./tests/unit/opt-ir/memory-optimization.test.ts ./tests/unit/opt-ir/egraph-region-discovery.test.ts ./tests/unit/opt-ir/egraph-materialization.test.ts
bun test ./tests/integration/opt-ir/checked-mir-to-opt-ir.test.ts ./tests/integration/opt-ir/packet-parser-demo.test.ts ./tests/unit/opt-ir/public-api.test.ts
bun run typecheck
```

## Cross-Task Quality Gates

Every task must satisfy these gates before handoff:

- Run the narrow task tests listed in the task.
- Run `bun run agent:check`.
- Use fakes through dependency injection. Do not use mocks.
- Keep runtime source dependency-free.
- Keep filesystem access at compiler edges.
- Avoid broad rewrites outside task files.
- Add diagnostics with stable codes.
- Prefer typed result objects over casts or dynamic property probes.
- Do not add new `as any`, `as never`, `@ts-ignore`, neutral fallback, or parser/lexer layer violations.

Recommended final repository-wide checks after several tasks land:

```bash
rg -n "as never|as any|@ts-ignore" src
rg -n "\?\? 0n|\?\? \"\"|ownerFunctionId \?\? 0" src/hir src/mono src/opt-ir
rg -n "from .*frontend/parser|from .*frontend/ast" src/frontend/lexer
bun run format
bun run agent:check
```
