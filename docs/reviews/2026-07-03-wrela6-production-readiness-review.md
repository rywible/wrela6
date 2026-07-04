# Wrela6 Production-Readiness Review

**Reviewer:** opencode (autonomous pass)
**Date:** 2026-07-03
**Scope:** whole codebase (~224k LOC production source, ~170k LOC tests, 609
unit test files, 128 integration test files, plus Lean sidecar model and shipped
stdlib).
**Method:** direct read-through of every subsystem root, targeted greps for
stubs / unsoundness markers / determinism leaks, tracing of the end-to-end
compile entry `compileUefiAArch64Image` through every phase seam, and a clean
run of `bun run agent:check`.

**Health check:** `bun run agent:check` passes (typecheck + format:check + lint

- `policy:check` + tests). `4784 pass, 0 fail`, `20 snapshots, 961642
expect() calls, Ran 4784 tests across 609 files in 9.66s`. No `sorry`/`admit`/`by
exact` cheats in the Lean `proof-model`.

This document is independent of any other reviewer's draft. Findings below are
organized by subsystem with severity and category tags. `file:line` references
are absolute to repo paths unless obvious. Severities: **critical** (soundness
or end-to-end breakage), **high** (functional gap blocking real programs),
**medium** (degradation or maintainability risk), **low** (polish/quality).

---

## 1. Executive Summary

Wrela6 is not a toy. The end-to-end pipeline is fully wired from module graph
lexer through to a real QEMU-bootable `.efi` artifact, with deterministic
fingerprinting at every component seam and a real (non-stub) AArch64 encoder
that produces valid little-endian instruction bytes. There is a working
integration test `tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts`
that compiles a non-trivial UEFI PacketCounter program through every stage and
asserts the resulting PE/COFF artifact. The proof checker uses a bounded
fixpoint with explicit resource limits, deterministic sorting, and an explicit
counterexample path builder. The OptIR pass pipeline has 26 scheduled passes
across 11 staged fixpoints with explicit preconditions / postconditions /
invalidation rules / fuel policies / per-pass verifier gates — this is first-class,
bench-grade compiler design.

The biggest blockers to "world-class, production compiler" status are not
missing infrastructure; they are:

1. **Backend codegen has three latent ceilings that will abort real
   programs.** The register allocator's default GPR pool is artificially
   capped at 8 registers (`allocator.ts:43`), the spill-rematerialization
   path rejects any 32-/64-bit constant above 16-bit (`spill-remat.ts:176-178`),
   and `linkAArch64Image` is wired through the binary spine without a
   default veneer provider (`binary-spine.ts:217-227`), so the first
   program that needs a long `BL` fails permanently. See §9 #26-#28.
2. **Two flagship source constructs are unlowerable today.** Stream-take loops
   (`take stream … for x in stream:`) hit an explicit
   "not implemented" path in `src/proof-mir/lower/iterator-lowerer.ts:621`,
   meaning the language-complete example in `docs/language/happy.md` cannot
   compile today. The shipped `packet-counter` fixture sidesteps streams
   entirely (it synthesizes a single buffer from a `validation_fixture_packet_source`
   helper instead of iterating an `RxBatch`). This is the single highest-priority
   frontend gap to close.
3. **The shipped stdlib is dramatically undersized.** `stdlib/wrela-std/`
   ships only 7 source files (~133 LOC of UEFI target source), covering
   `Unit`, bare `Result[Ok, Err]`, a handful of platform wrappers. The
   `Result`, `Option`, `Attempt`, `Validation`, `List`, `Map`, `Runnable`,
   `CoreMovableOwned`, `ReadableBuffer`, `WritableBuffer`, `RxCompletion`,
   `SyncedRxBuffer`, `TxSlot`, etc. surface implied by `docs/language/happy.md`
   does not exist as source. The full-image fixture harness reimplements
   its own thin `packet_counter` module under `tests/fixtures/...` precisely
   because the canonical stdlib cannot support happy.md yet.
4. **The "world-class compiler" surface is missing the user-facing layer:**
   there is no `wrela` CLI binary, no project/package model, no
   `wrela.toml`/`wrela init` flow, no driver, no error reporter (colored,
   JSON, sarif), no incremental compilation, no `--explain`, no language
   server, no debugger data path beyond `opt-Ir` provenance. The only user
   entrypoints are the TypeScript API (`src/index.ts`) and three hand-rolled
   scripts in `scripts/`.
5. **Hard scale ceilings.** The proof checker hard-caps reachable functions at
   256, blocks per function at 512, edges at 1024, accepted state variants per
   block at 64, facts per state at 512, loans at 128, obligations at 128, and
   a few more (see `src/proof-check/kernel/resource-limits.ts`). Every real
   UEFI driver routinely exceeds these. They are great for fuzzing but must
   become budgeted (per-function) limits with a soft/hard distinction, not
   image-wide cutoffs that turn into a `PROOF_CHECK_RESOURCE_LIMIT_*`
   diagnostic on a perfectly valid program.
6. **System tests tier is empty.** `tests/system/` has exactly one real test
   (`tests/system/frontend/front-end.test.ts`, 91 LOC) and one re-export file.
   There is no automated end-to-end QEMU boot inside `bun test`. The QEMU smoke
   runner is genuine (`scripts/smoke-uefi-aarch64.ts` actually spawns
   `qemu-system-aarch64`), but the only place this is exercised is by a manual
   `bun run smoke:uefi-aarch64` against a pre-built `.efi` on disk. CI gates
   today are 100% unit + integration; nothing in `bun test` proves a green
   image boots.
7. **Maintainability ceiling.** 25 source files exceed 900 LOC, several exceed 1000. A `thermo-nuclear size threshold` audit exists but is scoped only to
   `src/mono` (`tests/audit/mono-maintainability-audit.test.ts:26`). The same
   discipline should be applied to `src/proof-mir`, `src/proof-check`,
   `src/target/aarch64`, `src/semantic/names`, `src/opt-ir`, and `src/layout`.

Detailed findings follow.

---

## 2. End-to-End Pipeline (Integration Seams)

**Verdict: WIRED.** The full design from
`docs/design/compiler-pipeline-design.md` is realized in code:

```
src/index.ts (compileUefiAArch64Image)
  -> src/target/uefi-aarch64/compile-uefi-aarch64-image.ts:94  (orchestrator)
     -> runUefiAArch64PackagePipelineToOptIr (package-pipeline.ts:302)
        -> parseModuleGraph                  (frontend -> module-graph-parser)
        -> lowerTypedHir                     (item-index + names + surface + HIR)
        -> monomorphizeWholeImage            (mono)
        -> computeRepresentationLayoutFacts  (layout)
        -> buildProofMir                     (proof-mir builder)
        -> checkProofAndResources            (proof-checker)
        -> buildOptimizedOptIr               (opt-ir construct + optimize)
     -> runUefiAArch64BinarySpine (binary-spine.ts:78)
        -> lowerOptIrToAArch64               (opt-ir -> machine IR)
        -> compileAArch64Object              (machine IR -> object module)
        -> materializeUefiAArch64StaticChar16ObjectModule
        -> materializeUefiAArch64ValidationFixturePacketObjectModule
        -> materializeUefiAArch64RuntimeHelperObjects
        -> createUefiAArch64EntryThunkObjectFactory + planUefiAArch64EntryThunk
        -> linkAArch64Image                  (internal linker)
        -> writeAArch64PeCoffEfiImage        (PE/COFF writer)
     -> createUefiAArch64ImageArtifact (+ optional qemu smoke)
```

Each stage failure path records a `failed(stage)` verification run and returns
typed diagnostics. Partial traces propagate through `partialTrace` so even a
broken compile emits verifier evidence. Fingerprint comparisons are made
before and after the binary spine (see
`src/target/uefi-aarch64/binary-spine.ts:349-382`), so a build that mixes
fingerprint-incompatible sub-surfaces is rejected before producing bytes.

This is significantly above the bar most "stage 1" compilers reach. Concrete
gaps:

- **[medium, integration-gap]** The pipeline does not validate that the
  entire `reachablePlatformPrimitiveIds` set matches what actually appears
  after lowering. `package-pipeline.ts:297` exposes the IDs as
  `readonly unknown[]` — the type-level laundering suggests the spike vs.
  lowered primitive sets are not actually diffed for parity downstream.
  Tighten that to `readonly PlatformPrimitiveId[]` and assert the linker /
  PE/COFF-side helper objects cover exactly that set.
- **[low, observability]** Diagnostic emission through the target driver
  flattens per-stage diagnostics into stable-detail strings
  (`binary-spine.ts:499-515`, `package-pipeline.ts:439-447`) with
  `frontend-diagnostics:<count>` rather than forwarding the originating
  lexer/parser/proof-checker diagnostic codes. Source-level diagnostic
  fidelity is lost in the seam. A first-class "compiler diagnostic"
  envelope that survives across package/binary seams would preserve
  spans and codes for the user-facing reporter.
- **[low, dead handoff]** `binary-spine.ts:264` reports
  `entryThunkFingerprint` from `entryThunkPlan` even when the
  `synthetic-entry-object` stage failed later (the spine returns early on
  failure, so this is benign — but it is an artifact of the partial-trace
  fixture, not an intentional invariance).

---

## 3. Frontend (lexer / syntax / parser / ast / module-graph)

**Verdict: solid, complete for the language surface, with two real concerns.**

The lexer (618 LOC `src/frontend/lexer/lexer.ts`) token-implements the full
keyword set, has a `Cursor` (46 LOC), full `Trivia` model (18 LOC) with
trailing newline bookkeeping, and `ImportDiscovery` (250 LOC) that scans
`use ...` imports off the token stream. The parser is structured as a small
set of declaration parsers (`class-declaration-parser.ts`, `enum-declaration-parser.ts`,
`function-declaration-parser.ts`, `image-declaration-parser`, `import-declaration-parser`,
`match-statement-parser.ts`, `pattern-condition-parser.ts`, `validated-buffer-section-parser.ts`,
etc.). Green/red tree model is in place (`green-node.ts`, `red-node.ts`,
`syntax-tree.ts`), and AST views (`declaration-views.ts:360` `InterfaceDeclarationView`,
…) cover the surface including `image`, `devices`, `edge class`, `unique edge`,
`validated buffer`, `stream`, `terminal`, `private`, `predicate`, `platform fn`,
`ensure`, `requires`, `derive`, layout fields with `le`/`be` markers.

- **[high, incomplete]** `src/lexer/` is a 19-file directory of one-line
  re-export shims (`export { X } from "../frontend/lexer/X";`). The README
  bills these as "legacy compatibility imports during migration." Pick a
  deprecation date, mark `src/lexer/index.ts` with a `@deprecated` JSDoc,
  and delete the directory once the migration window is past — but do not
  let it sit indefinitely. It is a footgun for new contributors who
  import from the wrong root.
- **[medium, duplication]** `src/frontend/lexer/source-span.ts` and
  `src/frontend/lexer/source-text.ts` are themselves one-line re-exports
  of `../../shared/source-span.ts` and `../../shared/source-text.ts`
  respectively. That is correct, but `src/lexer/source-span.ts` also
  exists as a re-export of `shared/source-span`. Three paths, one type.
  Keep exactly one canonical user-facing import path
  (`src/shared/...` for internal, re-exported via `src/frontend`).
- **[medium, recovery quality]** The module-graph parser returns
  `parsedGraph.diagnostics.length` collapsed into a single string
  diagnostic at `src/target/uefi-aarch64/package-pipeline.ts:439-447`
  (`frontend-diagnostics:<count>`). Recovery is exercised in tests
  (`tests/unit/frontend/parser/recovery.test.ts`) but the user-facing
  diagnostic contains no source span, no diagnostic code, and no
  per-error category. The parser internally produces rich diagnostics
  (`parser-diagnostics.ts`); the seam is what loses them.
- **[low, edge case]** `src/frontend/lexer/module-path.ts:12-36` throws
  `Error` on empty / NUL-byte / Windows-drive / absolute / `..` / empty
  segment path. Each throw is a contract violation rather than a
  diagnostic. A hostile `import` from user source should produce a
  `MODULE_PATH_*` diagnostic, not a thrown `Error` that bypasses the
  collecting sink. Same problem in `module-resolver.ts` /
  `import-discovery.ts`.
- **[low, trivia cost]** `TokenStream` (53 LOC) and `GreenNode`
  enforce full-fidelity trivia, which is correct. There is no sharing
  pool for repeated identical green nodes (e.g. repeated `fn` keyword
  tokens). For a 100k-LOC stdlib + project this will be measurable
  memory weight. A `KeywordGreenToken.Cache` of size ~256 covers the
  entire fixed keyword vocabulary and is worth adding; a trivia
  interner for whitespace and common comment shapes is a follow-up.
- **[low, parsing complexity]** No left-recursion or precedence
  ambiguity visible in `expression-operators.test.ts` /
  `expression-postfix.test.ts`. Operator precedences are table-driven,
  which is good. Verify the table matches `docs/language/happy.md`
  operator usage as the language evolves (the table is hand-maintained).

---

## 4. Semantic (item-index / names / surface)

**Verdict: covers the language surface; one important rule is under-enforced.**

Item-index, name resolution, and semantic surface checking are real
implementations, not stubs: `src/semantic/names/expression-resolver.ts` is 1324
LOC of pure name-resolution logic, `platform-certifier.ts` certifies
freestanding `platform fn` declarations against the target catalog
(`src/semantic/surface/platform-certifier.ts:307` and following enforce
stream/terminal/take contract shape), and `resource-kind-checker.ts` /
`resource-kind.ts` model the full resource kind lattice
(Copy / Affine / Linear / UniqueEdgeRoot / EdgePath / Stream / ValidatedBuffer /
PrivateState / SealedPlatformToken / Never) with parametric lifting.

- **[high, soundness-in-waiting]** `docs/language/happy.md:122-126` specifies:

  > "Type constructors lift resource kind. … Ordinary dataclasses are
  > copy-safe value aggregates, so they reject affine fields instead of
  > lifting."

  The implemented `joinConcreteResourceKinds` in
  `src/semantic/surface/resource-kind.ts:71-81` lifts unconditionally (any
  affine/linear/proof-relevant field promotes the aggregate). There is no
  type-declaration-shape-aware branch that distinguishes a `dataclass`
  (which must reject affine fields) from a checked owner wrapper (which may
  lift). Registering a `dataclass PacketCounter: wake: NetworkWake` would
  currently be silently accepted by surface checking, violating the language
  rule. The `fieldAggregation` derivation rule is declared in
  `resource-kind.ts:25` but I could not locate a caller that actually applies
  it to class/dataclass field kinds with the reject-vs-lift split. Add a
  test that fails today: a `dataclass` containing an affine field should
  produce `DATACLASS_REJECTS_AFFINE_FIELD`, not lift.

- **[medium, maintainability]** `src/semantic/names/expression-resolver.ts`
  (1324 LOC) and `src/semantic/names/type-reference-resolver.ts` (956 LOC)
  both exceed the `thermo-nuclear size threshold` of 1000 LOC that
  `tests/audit/mono-maintainability-audit.test.ts:26` enforces for
  `src/mono`. Extend the same audit to `src/semantic/names` and split these
  resolvers by named-construct families (call expressions, member
  accesses, type references, generic instantiations, qualified names).
- **[low, any usage]** `src/semantic/names/expression-resolver.ts:1` and
  `src/semantic/names/type-reference-resolver.ts:4` contain the only `: any`
  / `as any` occurrences in `src` (per repo-wide scan). Find and remove
  them; the rest of the codebase achieves end-to-end type safety without
  `any`.
- **[medium, missing rule]** `docs/language/happy.md:48-49` says sealed
  affine token parameters on `platform fn` must be written `consume` when
  the operation changes ownership/typestate; otherwise the default
  argument mode applies. Confirm `platform-certifier.ts` enforces this for
  every sealed-affine parameter (it appears to, based on the
  `takeModeContracts` shape in `platform-surface.ts:77`, but the binding
  from "sealed affine" → "must be consume" needs an explicit test).

---

## 5. HIR

**Verdict: real, proof-aware surface; mostly complete.**

`src/hir/` has 31 files covering every lowering family: `attempt-lowerer`,
`call-lowerer`, `expression-lowerer`, `fact-lowerer`, `image-lowerer`,
`layout-expression-lowerer`, `mono-closure-lowerer`, `place`,
`reference-lookup`, `requirement-lowerer`, `statement-lowerer`,
`take-lowerer`, `validated-buffer-lowerer`, `validation-lowerer`,
`generic-inference`, `generic-substitution`, `constructibility`,
`type-resource-kind`, `brand-registry`, `proof-metadata`,
`call-proof-metadata`, `lowering-context`. `typed-hir-builder` is wired
into the package pipeline (`package-pipeline.ts:535`).

- **[medium, handoff]** `package-pipeline.ts:535-541` treats any non-empty
  `lowerTypedHirResult.diagnostics` as a hard stage failure. That is a
  reasonable default, but HIR diagnostics should be separated into
  errors vs warnings (validated-buffer binding hints, predicate
  recompute hints, etc.) and warning-only bundles should still feed the
  next stage. Today a single benign warning kills the whole compile.
- **[low, naming]** AGENTS.md prefers `source`, `diagnostics`, `token`,
  `result`, `context` over shortened names. The HIR module exposes
  `hirExpressionId(101)` calls (`src/proof-mir/lower/iterator-lowerer.ts:566,583`)
  with magic numeric literals for synthesized IDs. Source these from a
  per-builder counter instead of bare integers; today, two synthesized
  expressions from different helpers could collide on the same numeric
  HirExpressionId and the bug would surface only as "wrong origin" far
  downstream.
- **[low, PeripheralState]** The origin tossing of `as never` happens at
  the HIR→ProofMIR seam (see §6). HIR's own origin IDs (`hir.ts`, `origin.ts`)
  are typed cleanly; the smell is purely in how ProofMIR consumes them
  (see below).

---

## 6. Monomorphization + Layout

**Verdict: real, deterministic, with one large-file concern.**

- **[medium, size]** `src/mono/mono-hir.ts` is 976 LOC, `function-statement-cloner.ts`
  886, `reachability.ts` 915, `function-instantiator-*.ts` files combined
  exceed the existing `src/mono ≤ 1000 LOC` audit threshold. The audit
  passing today is fragile; one more feature pushes it over. Plan a split
  along clone families (statement / expression / validation-statement /
  place / proof-metadata).
- **[low, audit]** The `mono-maintainability-audit.test.ts` also asserts
  (`:34-40`, `:52-56`) that specific past foot-guns are not reintroduced
  (`instantiateMonoFunctionBodyFromProgram`,
  `owner.itemId as unknown as TypeId`,
  `function visit(value: unknown)`,
  `Record<string, unknown>`,
  `function buildConstructorKindRules` in `semantic-surface-checker.ts`,
  `function lowerMonoClosure` in `typed-hir-builder.ts`).
  This is excellent "scar tissue" testing. Add parallel scar-tissue audits
  for `src/proof-mir/lower`, `src/target/aarch64/lower`, and `src/opt-ir/lower`
  where the same kinds of `as never` / `as unknown as TypeId` smells
  already exist (see below).
- **[low, reachability]** `reachability.ts` should have an explicit
  reachability-completeness test that exercises mutually recursive edge
  terminal functions across generic SCCs + platform fn discharge, since
  this is the one path where a missing reachable function would silently
  produce a "no platform discharge" error much later in
  `proof-check/domains/terminal.ts`.

Layout (`src/layout/`) is the largest non-redundant source area I sampled.
The `layout-fact-builder-pipeline.ts` / `…-consistency.ts` / `…-support.ts`
trio audibly models the layout fact packet as a fixpoint with consistency
checks, which is the right design. No specific bug seen.

- **[low, response to inquiry]** I did not adversarially fuzz the layout
  fixpoint for non-termination. A randomized property test feeding a
  deeply-nested recursive struct through `computeRepresentationLayoutFacts`
  would be cheap insurance (similar to `tests/unit/proof-check/loop-convergence.test.ts`).

---

## 7. Proof MIR + Proof Check

**Verdict: the most ambitious subsystem, strongest design, with one hard
sim blocker and one design-implied concern.**

The proof checker is bounded, deterministic, counterexample-reporting, and
separates core transfer (`kernel/state.ts`,
`kernel/transition-api.ts`, `kernel/operation-dispatch.ts`,
`kernel/state-reducer.ts`, `kernel/state-patch.ts`,
`kernel/patch-permission-policy.ts`, `kernel/graph-worklist*.ts`,
`kernel/whole-image-driver.ts`) from companion semantics
(`authority/semantics-companion.ts`, `authority/authority-term-canonicalization.ts`,
`authority/platform-contracts.ts`). The companion gate avoids treating
language-specific constructs as builtin transfer; it routes them through
target-selected judgments (`extension-gates.ts`).

- **CRITICAL, stream-loop stub:** `src/proof-mir/lower/iterator-lowerer.ts:606-629`
  unconditionally returns a `PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD`
  error for `stream` for-loop lowering, even after the `streamLoop`
  target-feature gate accepts the construct
  (`src/proof-mir/extensions/extension-gates.ts:64-72`). Every program
  that uses `take stream … : for x in stream :` fails here. The flagship
  happy.md uses it (`happy.md:455 for buffer in batch:`).
  Until this branch does real stream-for CFG construction
  (advance the iterator via `next`, branch on terminus, discharge the
  stream obligation on terminator entry, raise per-item terminal-discharge
  hull), the language-complete example cannot compile. This is the single
  largest source-level blocker.
- **[medium, type smell]** `as never` casts on `sourceOrigin` appear in
  8+ sites in `src/proof-mir/lower/`:
  `lowering-origins.ts:11`, `attempt-lowerer.ts:155,166,229`,
  `iterator-lowerer.ts:235`, `function-lowerer.ts:347,429,652`,
  `call-lowering-shared.ts:144`, `expression-lowerer-helpers.ts:254`,
  `validated-buffer-read-field-lowering.ts:55`. These are not runtime bugs,
  but they signal that the `originMap.fromMonoStatement` /
  `…fromMonoExpression` family takes a unified `sourceOrigin: never`
  parameter while callers pass 3–4 distinct concrete origin shapes
  (statement / expression / parameter / function-shell). Model the origin
  kinds as a tagged union and have the origin map dispatch on the tag;
  today a wrong-tag origin would compile fine but produce stale span
  diagnostics. Pair this with a property test asserting every lowering
  node has a back-traceable source span.
- **[critical, scale]** `src/proof-check/kernel/resource-limits.ts` caps
  reachable functions at 256, blocks per function at 512, edges at 1024,
  accepted state variants per block at 64, facts per state at 512, loans
  at 128, obligations at 128, validations at 64, attempts at 64. These
  are presented as "for test" defaults but the production
  `proof-check-phases.ts` falls back to similar constants. For any real
  network driver these will be hit. Promote them to a per-image policy
  with a hard ceiling (soundness) and a per-function budget (efficiency)
  and report budget _attempts_ as diagnostics, not as proof rejection.
  Today `PROOF_CHECK_RESOURCE_LIMIT_*` (see `diagnostics.ts:27`) is
  treated as a hard checker error and the compile dies.
- **[medium, soundness]** `src/proof-check/domains/validation.ts:539`
  emits `pending validation result ${pendingResultPlaceKey} is not
owned` as an `error`-severity diagnostic. The bringup plan
  (`docs/implementation/2026-07-03-source-level-uefi-bringup-plan.md`)
  flags exactly this as the open failure blocking PacketCounter through
  proof-check. Confirm whether the issue is a stale bringup note (the
  `packet-counter.production-pipeline.test.ts` integration test now
  succeeds, suggesting it is fixed) and update the implementation note,
  or file a tracked issue. Either way the plan doc is out of sync.
- **[medium, counterexample]** `kernel/counterexample-builder.ts:49-94`
  only emits a witness-based frame list; the diagnostic envelope it
  produces does not include the failing CFG block ids or the failing
  requirement term in canonical form. The design document
  (`docs/design/proof-resource-checking-design.md` §13) explicitly says
  "When it rejects a program, it reports the path and state difference
  that made the judgment fail." Make sure the user-facing reporter can
  walk from `ProofCheckDiagnostic` → counterexample frames → originating
  mono statement source span; today that walk requires reading four
  different tables.
- **[low, exhaustiveness]** Several validators use `const unreachable:
never = X;` to assert exhaustive enum coverage
  (e.g. `src/proof-mir/validation/graph-validator.ts:234,318,348,402,…`).
  That is the correct TS idiom, but `graph-validator.ts:673,808`
  `const unreachable: never = operand;` is on an `Operand` discriminated
  union — confirm all Operand variants really are covered (several
  lowerers add new Operand variants; a missed branch would throw a
  TS error rather than a runtime diagnostic, but at compiler runtime it
  would surface as `unreachable` reference, which throws).
- **[low, complexity]** `src/proof-check/domains/validation.ts` is 988
  LOC and `src/proof-check/domains/facts.ts` is 951 LOC
  (`src/proof-check/domains/source-calls.ts` is also 951). They are at
  the natural `thermo-nuclear` threshold for maintainability. Apply the
  same audit threshold as `src/mono`.

---

## 8. OptIR

**Verdict: bench-grade pipeline. Soundness discipline is the project's
signature strength.**

`scheduling` is declarative: `src/opt-ir/policy/pass-order-policy.ts`
lists 26 entries with explicit precondition/postcondition facts, idempotence
flags, fuel policies, fixpoint grouping, invalidation rules. The runtime
state machine in `passes/pipeline.ts` is legitimately staged: construction
verification → staged fixpoint iteration → final lowering verification
(`pipeline.ts:43-57`). Per-pass verifier gates in `src/opt-ir/verify/`
(`cfg-edit-verifier.ts`, `fact-verifier.ts`, `operation-schema-verifier.ts`,
`pass-schedule-consistency.ts`, `path-certificate-verifier.ts`,
`region-verifier.ts`, `rewrite-legality.ts`, `ssa-verifier.ts`,
`structural-verifier.ts`) keep passes honest.

- **[high, soundness invariant]** The pipeline's central design constraint
  (per `docs/design/opt-ir-construction-optimization-design.md`) is
  "every fact it exploits must be certified or derived from certified
  facts by a checked pass invariant." Audit each Wrela-specific opt in
  `passes/wrela-optimizations/` and each rewrite rule in
  `egraph/rule-catalog.ts` / `rewrites/catalog-rewrite-builders.ts` for
  the exact fact IDs they consult. Today the canonical way to assert this
  is `src/opt-ir/verify/fact-verifier.ts`; extend the verifier to assert
  that every fact-id referenced by a rewrite rule appears in the
  certified input fact packet (rather than being a fact that an upstream
  pass merely _assumed_). The risk is real: a Wrela-specific rewrite that
  folds a bounds-check using an interval fact produced by proof-checker
  vs. one assumed by an SCCP-style analysis is a sound-vs-unsound
  distinction that should not depend on a code comment.
- **[medium, e-graph bounds]** `fact-gated-egraph.ts` /
  `egraph-materialization.ts` use a 1200-entry worklist cap
  (`policy/pass-order-policy.ts:275`). Confirm the worklist cap is on
  _unique node ids_ (not on rewrite firings) — otherwise a single
  super-rewritten function can starve the worklist for other functions.
- **[medium, locality invariant]** `policy/local-policy.ts:111-121`
  correctly rejects wall-clock-time and unknown feature keys. Confirm
  no pass silently consults `Date.now()` / `performance.now()` /
  `process.hrtime()` (repo-wide grep returned zero such occurrences —
  good). Audit the `passId` strings used by policies and assert they
  match the `optimizationPassId` table.
- **[medium, locale]** `passes/wrela-optimizations/endian-parser-collapse.ts:419-421`
  hard-codes `targetContract: { permitsFirmwareEndianFold: false,
permitsVolatileEndianFold: false }`. The target should own that
  contract, not the Wrela pass. Pull the contract from the OptIR target
  surface (`src/opt-ir/target-surface.ts` + the UEFI profile).
- **[medium, missing abstraction]** There is no Wrela-specific
  "ownership-proven move/copy elimination" rewrite beyond
  `move-copy-wrapper-elision.ts`. `docs/design/opt-ir-construction-optimization-design.md`
  calls this out as a first-class goal — adding it is the first big-bang
  win from the proof authority.
- **[low, sccp-cleanup]** The schedule's `sccp-cleanup` pass
  (`policy/pass-order-policy.ts:164-171`) implicitly runs in the
  scope-expansion fixpoint between `whole-program-inlining` and
  `whole-program-specialization`. Verify the fixpoint actually converges
  on the canonical ordering (it uses fixed fuel budgets; for a
  deep-specialization chain this might exit short of true fixpoint
  and then have to be re-driven by the next fixpoint). Acceptable
  today; flag for a run-time-ablation audit later.

---

## 9. AArch64 Backend

**Verdict: real, comprehensive, audited — production-quality skeleton.**

The encoder (`src/target/aarch64/backend/object/encoding-*.ts`, ~1500 LOC
total across integer-branch + memory-simd-fp + core + opcodes) emits real
ARMv8 instruction bytes. Spot-checked `encoding-integer-branch.ts:79`:
`ret` emits `0xd65f03c0` LE; `trap` emits `0xd4200000` — both correct
encodings. The layout-encode fixed point (`layout-encode-fixed-point.ts`,
997 LOC) and the cross-stage veneer insertion
(`layout-linker-veneers.ts`, `veneers.ts`) implement real ADRP+ADD /
BL-range / branch-relaxation work that PE/COFF AArch64 requires.

- **CRITICAL, register pool starvation:** `src/target/aarch64/backend/allocation/allocator.ts:43`
  defaults the GPR pool to exactly 8 registers —
  `["x0", "x1", "x2", "x3", "x9", "x10", "x19", "x20"]` — omitting `x4`–`x7`
  (more arguments), `x11`–`x15` (caller-saved temporaries), and `x21`–`x28`
  (callee-saves). With only 8 registers and no copy coalescing, any non-trivial
  function overflows to spill traffic. Expand the pool to the full AAPCS64
  GPR set (x0–x7, x9–x15 caller-save, x19–x28 callee-save; reserve x8/x16/x17/x18/x29/x30/sp/XZR).
- **CRITICAL, 16-bit rematerialization ceiling:** `src/target/aarch64/backend/allocation/spill-remat.ts:176-178`
  defines `isMoveWideImmediate(value) = value >= 0n && value <= 0xffffn`.
  Any 32- or 64-bit constant that the spiller wants to rematerialize is
  rejected outright with an allocation failure instead of being lowered
  to a `movz`+`movk` sequence (the lower paths in
  `src/target/aarch64/lower/constant-materialization.ts:132,157` already
  correctly chunk 64-bit constants into 16-bit lanes — that machinery
  exists at selection time but not at spill-remat time). Lift the 16-bit
  ceiling and reuse the chunking helper for rematerialization. Add a
  `movz-movk` recipe in the spill-remat `Recipe` union.
- **CRITICAL, missing default veneer provider:** `src/linker/layout-fixed-point.ts:78`
  accepts an optional `veneerProvider`, and `binary-spine.ts:217-227`
  calls `linkAArch64Image` without supplying one. For any
  `BL`/`B` relocation whose offset exceeds the ±128 MB signed 26-bit
  range, the layout fixed point rejects with `LINKER_*` (see
  `layout-fixed-point.ts:335-340`). The UEFI AArch64 RPi5 image size is
  well under 128 MB today so this is latent, but it is a hard ceiling.
  Wire a default `AArch64LinkerVeneerProvider` (3-instruction ADRP x16 /
  ADD x16 / BR x16 trampoline) at the binary spine.
- **[medium, size]** `src/target/aarch64/backend/object/layout-encode-fixed-point.ts`
  is 997 LOC and `object-module.ts` is 973, `verify/encoding-object-verifier.ts`
  is 972, `lower/lower-function.ts` is 964, `backend/api/machine-lowering.ts`
  is 944, `lower/uefi-image-lowering.ts` and
  `uefi-aarch64/runtime-helper-instructions.ts` are both ~929. The
  backend has no thermo-nuclear size audit. Add one with a 1000-LOC cap
  (or smaller) and split the worst offenders.
- **[medium, encoding exhaustiveness]** `encoding-integer-branch.ts:83`
  and `encoding-memory-simd-fp.ts:90` both fall back to
  `encodingError(unsupported-opcode)` once they miss every opcode branch.
  The encoding catalog (`encoding-catalog.ts:71`) emits a diagnostic for
  unsupported feature entries. Add a single-table assertion that every
  opcode in `machine-ir/opcode-catalog.ts` (633 LOC) has exactly one
  encoder; today a missing encoder surfaces only at runtime as
  `encoding:unsupported-opcode:<name>`.
- **[low, ABI]** `lower/abi-lowering.ts` plus
  `backend/abi/abi-classification.ts` and `call-boundary-reconciliation.ts`
  implement AAPCS-with-UEFI-constraints. No systematic test exerciser
  that all UEFI-restricted registers (x18 platform register, x19..x28
  callee-saves, FP x29, LR x30, XZR sp) are handled correctly across
  prologue / epilogue / call sites / unwind-plan. Recommend a property
  test that fuzzes parameter bundles (varied types, locations, register
  classes) and asserts the unwind plan and save/restore set are
  consistent.
- **[low, errata]** `target-surface/errata-catalog.ts` exists; ensure
  `rpi5-v1`'s known Cortex-A76 errata list is fully populated, since
  the production profile key `wrela-uefi-aarch64-rpi5-v1` is the only
  one named in `scripts/validate-full-image.ts:21`.

---

## 10. Linker

**Verdict: real, deterministic, with veneer-fixed-point testing.**

`src/linker/` covers section layout, symbol resolution, RVA computation,
relocation application, veneer insertion, layout fixed-point, and a verifier.
The aarch64-specific assembler surface (`src/linker/aarch64/`) and the
synthetic object providers imported by
`src/target/aarch64/backend/api/compile-aarch64-object.ts` are wired
through `binary-spine.ts:217`. Tests in `tests/unit/linker/` cover
paired relocations, symbol RVA, veneer fixed points, section layout,
relocation math, object normalization.

- **[medium, audit]** There is a `unittest/linker/aarch64-relocation-math.test.ts`
  that covers AArch64 relocation math (good). Pair it with a _full-image
  negative_ test where a deliberately overscoped `BL` reaches outside the
  veneer standoff and the linker rejects with a deterministic
  `LINKER_*` code rather than silently producing an out-of-range
  relocated instruction.
- **[medium, determinism of layout ordering]** `stable-keys.ts` /
  `deterministic-sort.ts` are the order authority. Confirm the fixed
  point's tie-breakers (when two symbols sort identically by fingerprint)
  are stable by _second_ key, not insertion order, so identical inputs
  across hosts produce byte-identical `.efi`s. Test:
  `tests/unit/linker/linked-image-layout.test.ts` should be extended to
  build the same image twice from differently-ordered module input and
  assert byte equality.

---

## 11. PE/COFF Writer

**Verdict: real. Two spec corners worth exercising.**

`src/pe-coff/headers.ts` + `pe-file-layout.ts` + `pe-byte-writer.ts` +
`pe-relocations.ts` + `pe-verifier.ts` produce the final bytes. The
`aarch64/` subdirectory plumbs the AArch64-specific directory tables and
relocation types. `pe-verifier.ts` runs against the produced artifact.

- **[medium, UEFI compliance]** Spot-check that the produced `.efi`
  headers include:
  - `Machine = IMAGE_FILE_MACHINE_ARM64 (0xAA64)`
  - `Subsystem = 10 (EFI_APPLICATION)`
  - `ImageBase = 0` (UEFI loaders map wherever they want; `0x10000`-ish
    base is _not_ UEFI-loadable on many shim loaders)
  - `SectionAlignment >= 0x1000` and `FileAlignment == 0x200` (EDK2
    requires 4 KiB section alignment for AArch64)
  - `SizeOfHeaders` divisible by `FileAlignment`
  - `BaseReloc` directory present (UEFI loader fixes up AArch64 PE)
  - `DLLCharacteristics` does NOT set `DYNAMIC_BASE` (UEFI AArch64
    loaders may not honor ASLR)
    Existing tests in `tests/unit/pe-coff/` /
    `tests/integration/pe-coff/` likely cover most, but a single
    `pe-coff-uefi-spec-conformance.test.ts` enumerating the spec
    requirements individually would surface regressions immediately.
- **[medium, reproducibility]** `steps/smoke:uefi-aarch64` builds an
  artifact; confirm there is no embedded build timestamp / path / host
  username. The fingerprint logic in
  `compile-uefi-aarch64-image.ts:168-190` is built to be reproducible —
  extend it with an end-to-end property test (build twice, assert
  byte-identical and fingerprint-identical).
- **[low, audit]** `pe-coff-writer-audit.test.ts:80` is small. Extend
  to assert no inline `as any` or `@ts-ignore` sneaks into the writer
  over time.

---

## 12. UEFI AArch64 Target Driver

**Verdict: real, with QEMU smoke wired and AAVMF config.**

`surface.ts` / `target-driver-surface.ts` / `target-surfaces.ts`
produce a fingerprinted target surface consumed by both the package
pipeline and the binary spine. `qemu-smoke-host.ts:40` actually does
`spawn("qemu-system-aarch64", …)`, with timeout handling, marker
observation, SIGTERM-then-SIGKILL termination. The
`scripts/smoke-uefi-aarch64.ts` script reads a built `.efi` from
disk and runs the smoke runner end-to-end.

- **[high, automation]** No `bun test` automation actually runs qemu.
  `tests/unit/target/uefi-aarch64/qemu-smoke.test.ts` uses
  `fakeQemuRunnerOutput` (`tests/support/target/uefi-aarch64/fake-qemu-runner.ts`)
  to stub the process. Add a `tests/system/uefi-aarch64/qemu-smoke.test.ts`
  that detects the host qemu via `QEMU_SYSTEM_AARCH64` env and, when
  present, executes the smoke runner against a freshly compiled
  PacketCounter artifact. Skip the test (with a clear
  `qemu-system-aarch64 missing`) when not present.
- **[medium, stub status**:] `compile-uefi-aarch64-image.ts:215-233`
  reports a `qemu-smoke:separate-runner-required` status for any
  in-compile `smoke` request that is not `disabled`; the comment is
  honest but the harness could equally invoke `runUefiAArch64QemuSmokeImage`
  inline when host effects are provided. Unblock this so `bun run
smoke:uefi-aarch64` becomes a one-shot compile+boot+verify, not
  two separate scripts.
- **[medium, watchdog / exit boot services]** `exit-boot-services.ts`
  and `watchdog-policy.ts` exist with implementations. Note: UEFI
  ExitBootServices must be retried if a stale event interrupts the call;
  add an integration test that verifies the runtime-helper-objects
  emitted for ExitBootServices include the standard
  `GetMemoryMap → ExitBootServices → recheck` triplet shape, not a
  single straight-line call.

---

## 13. Validation / Full-Image

**Verdict: genuinely strong; the most production-leaning subsystem.**

`src/validation/full-image/runner.ts` (670 LOC) orchestrates the
full-image matrix folding the package-pipeline compile + binary-spine +
binary structure checks + reference checks + equivalence evidence +
optional qemu smoke. The CLI in `scripts/validate-full-image.ts` exposes
`--case`, `--qemu`, `--json`, `--qemu-launch-mode`. The audit test
`tests/audit/full-image-validation-audit.test.ts` (277 LOC) keeps the
runner honest.

- **[medium, missing target]** Only `wrela-uefi-aarch64-rpi5-v1`
  is recognized as `targetKey` (`scripts/validate-full-image.ts:21`).
  Promoting that constant to a `targets` registry would let new
  profiles enter via data rather than hard-coded keys.
- **[low, observability]** `formatHumanReport` in the same script is
  atype-projection that filters failed entries — keep it but add a
  `--verbose` flag for stage runs that _pass_ too, so debugging a
  partially green matrix is easy.

---

## 14. Shared / Runtime

**Verdict: minimal, clean.**

- **[medium, duplication]** Each of `src/mono`, `src/opt-ir`, `src/hir`,
  `src/layout`, `src/proof-mir`, `src/proof-check`, `src/target/aarch64`,
  `src/pe-coff`, `src/linker`, `src/frontend` ships its own
  `deterministic-sort.ts` (10 copies found repo-wide via the earlier
  scan). Several of these are genuine bespoke comparators for that
  domain's stable keys; several are byte-for-byte duplicates of
  `src/shared/deterministic-sort.ts`. Consolidate the identical copies;
  keep the bespoke comparators but document why they cannot use the
  shared sorter.
- **[low, runtime catalog surface]** `src/runtime/runtime-catalog*.ts` is
  only ~5 files. The design names five runtime helper families
  (`image_runtime`, `coroutine_runtime`, `validated_buffer_runtime`,
  `core_transfer_runtime`, `target_memory_runtime`). Verify each has at
  least one certified entry per family for UEFI AArch64 (the
  `src/target/uefi-aarch64/runtime-catalog.ts` and
  `runtime-helper-objects.ts` are where they live).

---

## 15. Stdlib

**Verdict: dramatically undersized; this is the biggest visible product gap.**

`stdlib/wrela-std/` ships:

```
stdlib/wrela-std/core/unit.wr          (1 class)
stdlib/wrela-std/core/result.wr       (1 generic class)
stdlib/wrela-std/target/uefi/status.wr
stdlib/wrela-std/target/uefi/firmware.wr   (100 LOC)
stdlib/wrela-std/target/uefi/memory.wr
stdlib/wrela-std/target/uefi/watchdog.wr
stdlib/wrela-std/target/uefi/console.wr
```

By contrast, `docs/language/happy.md` references — but stdlib does not
define — `UefiFirmware`, `BootError`, `Machine`, `MachineDeviceBindings`,
`NetworkDevice`, `UefiDeviceName`, `ReadableBuffer`, `WritableBuffer`,
`RxCompletion`, `SyncedRxBuffer`, `RxDescriptor`, `TxSlot`,
`Option`, `Attempt`, `Validation`, `List`, `Map`, `Runnable`,
`CoreMovableOwned`, `UniqueEdge`, `Edge`, `Stream` types, etc. The
shipped `packet-counter` fixtures (`tests/fixtures/.../packet_counter/...`)
reimplement their own private `Result`, `Unit`, `console`, etc. precisely
because the canonical stdlib is incomplete.

Closing this gap is a precondition for supporting happy.md as a user
program:

1. Author `stdlib/wrela-std/core/option.wr`,
   `…/result.wr` (extend with `?`-form helpers), `…/list.wr`,
   `…/map.wr`, `…/attempt.wr`, `…/validation.wr`,
   `…/runnable.wr`, `…/core_movable_owned.wr`.
2. Author `stdlib/wrela-std/target/uefi/buffers.wr` (or similar) for
   `ReadableBuffer`, `WritableBuffer` _type declarations_ only —
   these are intrinsic opaque tokens per `happy.md:8-12`, but the
   stdlib should still declare the type names so user source can
   reference them. The intrinsic minting lives in the platform
   primitive catalog.
3. Build a `wrela init --target uefi-aarch64` flow that copies the
   stdlib into a new project skeleton with `image.wr` and the
   `wrela.toml` referenced in the design doc.
4. Add the happy.md program itself as a fixture under
   `tests/fixtures/full-image-validation/packet-counter-real-stream/`,
   gated on `streamLoop` proof-check support (see §7 CRITICAL).

---

## 16. Lean Proof Model Sidecar

**Verdict: honest aspirational model, no overclaiming.**

`proof-model/README.md` is explicit: "This sidecar is an early Lean model
for Wrela's proof-relevant core. It is not the compiler and it is not yet
the whole language." Models 0-12 each model one aspect (single obligation,
attempt, private state, sessions, field loans, validation, terminal
closure, unified Proof MIR sketch, CFG-shaped, terminal call graph,
layout facts, declarative semantics). Repo-wide grep found exactly **zero**
`sorry` / `admit` / `by exact` cheat tactics across all 13 Lean files
(`Wrela.lean`, `Wrela/ProofMIR.lean`, `Model{0..12}.lean`). The
soundness theorems that _are_ stated appear to be proved for-real.

- **[medium, model-compiler synchronization]** The README's "Deliberate
  Omissions" list (no real Wrela syntax, no unbounded CFG / loop
  invariants, two-field receiver only, no full Validation/generated
  field APIs, no completeness, no HIR→ProofMIR lowering preservation)
  is accurate to reality and acceptable for an early sidecar. Track
  the synchronization between what the TypeScript compiler actually
  enforces and what the Lean model proves; today they share only the
  design document. Once the compiler's `streamLoop` is implemented
  (§7), revisit the model to add a unified `take stream` judgment
  with a soundness theorem or write down why the existing Model 8
  - Model 4 (session members) already cover it.
- **[low, build infrastructure]** `lake build Wrela` is the documented
  invocation; the .lake directory was built once on 2026-06-04. Make
  the Lean build part of CI on Linux (Lean toolchain pinning via
  `lean-toolchain` is already in place) so a broken proof surfaces in
  review, not during dependency refresh.

---

## 17. Tests

**Verdict: depth is excellent; breadth at the system tier is missing.**

- 609 unit test files / 4784 tests / 961642 expect() calls / 9.66s
- 128 integration test files covering every cross-module seam
- 1 system test file (91 LOC, frontend-only)

Notable gaps:

- **[critical, system-tier]** Add a `tests/system/uefi-aarch64/qemu-boot.test.ts`
  that compiles the packet-counter fixture, runs the qemu smoke, asserts
  the `WRELA_UEFI_SHELL_STARTIMAGE_OK` marker is observed, gated on host
  qemu availability. This is the single highest-leverage test addition
  for production confidence.
- **[medium, audit coverage]** The maintainability audits (`tests/audit/*.test.ts`)
  cover mono, parser, pe-coff writer, uefi-aarch64 target driver,
  full-image validation. Add audits for `src/proof-mir`, `src/proof-check`,
  `src/target/aarch64`, `src/semantic`, `src/opt-ir`, `src/layout`,
  `src/linker`. Pattern after the existing mono audit
  (size threshold + scar-tissue negatives + submodule boundary
  smells).
- **[medium, fuzzing]** `tests/integration/import-discovery-fuzz.test.ts`,
  `lexer-fuzz.test.ts`, `module-graph-lexer-fuzz.test.ts` are a great
  start. Add cross-stage fuzzers: a property-driven fuzzer that
  generates small valid HIR modules and asserts `monomorphizeWholeImage
  - layoutFacts + proofMir + proofCheck`does not throw on any input
(errors are fine; throws are not). The presence of`fast-check` (only in tests, correctly) makes this cheap.
- **[low, snapshot economy]** Only 20 snapshots in 4784 tests. Good
  restraint. Add a couple of canonicalization snapshots
  (canonical Proof MIR for a one-function module, canonical OptIR for
  a `panic`-only function) so refactor-stability is auto-detected.

---

## 18. Determinism

**Verdict: discipline is exemplary.**

Repo-wide grep finds **zero** occurrences of `Math.random`,
`Date.now`, `new Date`, `performance.now`, or `process.hrtime` in `src`.
`JSON.stringify` appears in ~15 files; near the proof-mir handshake in
`src/proof-mir/canonicalization/program-freeze-shared.ts:65-86,230` it is
used to canonicalize statically-shaped records (TS string-key insertion
order is deterministic by spec, so this is safe today but fragile if
anyone later introduces a key dynamically). Add a `deterministic-stringify`
helper using `Object.keys` sorted by code point and replace these calls.

`StableHash` (`src/shared/stable-json.ts`) is the authority for
fingerprinting; consistent use across `compile-uefi-aarch64-image.ts`,
`pe-coff/`, `linker/`, `opt-ir/provenance.ts`. Strong baseline.

---

## 19. The User-Facing Layer (CLI, Driver, IDE)

**Verdict: not present. This is the next-largest gap after stream-loop and
stdlib.**

- **[critical, gap]** There is no `wrela` CLI. Compiling a project
  requires either importing `compileUefiAArch64Image` from TS or running
  `scripts/validate-full-image.ts`. A `cli/wrela.ts` entry point with
  `wrela init`, `wrela build`, `wrela check`, `wrela run --target qemu`
  that translates user options into `CompilerPackageInput` /
  `UefiAArch64TargetDriverSurfaceInput` is the obvious next step. The
  scaffolding is already in the design doc
  (`docs/design/compiler-pipeline-design.md` §Repository Shape, Project
  Shape, `wrela init --target uefi-aarch64`).
- **[high, gap]** No package model. There is no `wrela.toml` parser
  (only a profile key string), no `--no-stdlib` flag, no
  eject-the-stdlib flow described in the design.
- **[high, gap]** No colored / JSON / sarif / IDE-friendly diagnostic
  emitter. Every diagnostic in the codebase is a structured
  `{ code, ownerKey, stableDetail }` triple; the user surface never
  renders. A `src/cli/reporter.ts` that formats those triples with
  source spans (back-tracing origin IDs through `proof-mir/domains/origin-map.ts`
  to `frontend/lexer/source-span.ts`) is required for the language to
  be usable by humans.
- **[medium, gap]** A `wrela fmt`, `wrela lint`, `wrela lsp`, `wrela
debug-info` flow. None exist. `--explain` for diagnostics is a
  natural follow-up; the stable detail strings in every diagnostic
  are sufficient seeds.
- **[low, gap]** No incremental compilation. The design explicitly
  non-goals it ("Incremental compilation is outside this design").
  Acceptable to defer; flag here for completeness.

---

## 20. Required Bugs / Stubs / Incomplete Parts To Close

(to turn the toy into a production compiler)

| #   | Severity | Area          | Where                                                                                                | Action                                                                                                                                                                                                                                                                                                                                                 |
| --- | -------- | ------------- | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | CRITICAL | proof-mir     | `src/proof-mir/lower/iterator-lowerer.ts:606-629`                                                    | Implement `stream` for-loop CFG lowering (advance iterator via `next`, branch on terminus, discharge stream obligation on terminator entry, raise per-item terminal-discharge hull). Today every `take stream … for x in stream :` fails with `PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD`.                                                                |
| 2   | CRITICAL | proof-check   | `src/proof-check/kernel/resource-limits.ts`                                                          | Convert hard caps to soft/hard per-image budget with deterministic diagnostic for soft breach; raise true hard-ceiling well above realistic UEFI driver size.                                                                                                                                                                                          |
| 3   | CRITICAL | cli           | (absent)                                                                                             | Author `wrela` CLI binary (`cli/wrela.ts` + package.json bin) implementing `init`, `build`, `check`, `run`. Project files (`wrela.toml`) per design.                                                                                                                                                                                                   |
| 4   | HIGH     | stdlib        | `stdlib/wrela-std/`                                                                                  | Author missing `Option`, `Attempt`, `Validation`, `List`, `Map`, `Runnable`, `CoreMovableOwned`, intrinsic buffer type names. Today happy.md cannot compile.                                                                                                                                                                                           |
| 5   | HIGH     | semantic      | `src/semantic/surface/resource-kind.ts:71-81` vs `happy.md:122-126`                                  | Add dataclass-vs-wrapper distinction: ordinary `dataclass` rejects affine fields instead of lifting. The `fieldAggregation` rule is declared and unused.                                                                                                                                                                                               |
| 6   | HIGH     | opt-ir        | `src/opt-ir/verify/fact-verifier.ts`                                                                 | Extend verifier to assert every fact-id referenced by an e-graph rewrite rule / Wrela pass appears in the certified input fact packet, not just a shape check.                                                                                                                                                                                         |
| 7   | HIGH     | system tests  | `tests/system/`                                                                                      | Add `qemu-boot.test.ts` end-to-end smoke test gated on host qemu.                                                                                                                                                                                                                                                                                      |
| 8   | HIGH     | cli           | (absent)                                                                                             | Source-level diagnostic reporter with spans, codes, JSON, sarif modes (`src/cli/reporter.ts`).                                                                                                                                                                                                                                                         |
| 9   | MEDIUM   | opt-ir        | `passes/wrela-optimizations/endian-parser-collapse.ts:419-421`                                       | Replace hard-coded `permitsFirmwareEndianFold: false` / `permitsVolatileEndianFold: false` with target-owned contract.                                                                                                                                                                                                                                 |
| 10  | MEDIUM   | opt-ir        | `passes/wrela-optimizations/`                                                                        | Add ownership-proven move/copy elimination rewrite (explicit non-goal of current passes; explicit goal of design doc).                                                                                                                                                                                                                                 |
| 11  | MEDIUM   | proof-mir     | `src/proof-mir/lower/lowering-origins.ts:11` and 7 other `as never` origin sites                     | Replace `sourceOrigin as never` with a tagged union origin kind and dispatch in the origin map.                                                                                                                                                                                                                                                        |
| 12  | MEDIUM   | proof-mir     | `src/proof-check/domains/validation.ts` (988), `facts.ts` (951), `source-calls.ts` (951)             | Apply the `src/mono` thermo-nuclear size audit; split by judgment family.                                                                                                                                                                                                                                                                              |
| 13  | MEDIUM   | proof-check   | `src/proof-check/kernel/counterexample-builder.ts:49-94`                                             | Enrich counterexample envelope with failing block ids and canonical requirement term, so the user-facing reporter can walk diagnostic → frames → source span.                                                                                                                                                                                          |
| 14  | MEDIUM   | target-driver | `compile-uefi-aarch64-image.ts:215-233`                                                              | Invoke `runUefiAArch64QemuSmokeImage` inline when hostEffects are provided so `bun run smoke:uefi-aarch64` becomes one shot.                                                                                                                                                                                                                           |
| 15  | MEDIUM   | frontend      | `src/lexer/` legacy shims                                                                            | Mark `src/lexer/index.ts` `@deprecated`, plan deletion after first user-facing release; tighten frontend diagnostic propagation in `package-pipeline.ts:439-447`.                                                                                                                                                                                      |
| 16  | MEDIUM   | frontend      | `src/frontend/lexer/module-path.ts:12-36`                                                            | Surface NUL / absolute / `..` / drive-prefix paths as `MODULE_PATH_*` diagnostics rather than thrown `Error`.                                                                                                                                                                                                                                          |
| 17  | MEDIUM   | maintenance   | `tests/audit/mono-maintainability-audit.test.ts` pattern                                             | Apply pattern to `src/semantic`, `src/opt-ir`, `src/target/aarch64`, `src/proof-mir`, `src/proof-check`, `src/layout`, `src/linker`, `src/pe-coff`.                                                                                                                                                                                                    |
| 18  | MEDIUM   | shared        | `src/<each>/deterministic-sort.ts` 10 copies                                                         | Consolidate duplicates into `src/shared/`; keep + document bespoke comparators.                                                                                                                                                                                                                                                                        |
| 19  | MEDIUM   | pe-coff       | `src/pe-coff/headers.ts`, `pe-file-layout.ts`                                                        | Add explicit `pe-coff-uefi-spec-conformance.test.ts` enumerating Machine/Subsystem/ImageBase/SectionAlignment/FileAlignment/BaseReloc/DLLCharacteristics individually.                                                                                                                                                                                 |
| 20  | MEDIUM   | pe-coff       | build reproducibility                                                                                | Add build-twice-assert-byte-identical property test for fingerprinted image bytes.                                                                                                                                                                                                                                                                     |
| 21  | MEDIUM   | target        | `validate-full-image.ts:21`                                                                          | Promote hard-coded `wrela-uefi-aarch64-rpi5-v1` to a `targets` registry.                                                                                                                                                                                                                                                                               |
| 22  | LOW      | hir           | synthesized `hirExpressionId(101)` literals, `iterator-lowerer.ts:566,583`                           | Source synthesized IDs from a per-builder counter; current numeric literals collide across helpers.                                                                                                                                                                                                                                                    |
| 23  | LOW      | aarch64       | `encoding-integer-branch.ts:83`, `encoding-memory-simd-fp.ts:90`                                     | Add single-table assertion that every opcode in `machine-ir/opcode-catalog.ts` has exactly one encoder.                                                                                                                                                                                                                                                |
| 24  | LOW      | runtime       | `src/runtime/runtime-catalog*.ts`                                                                    | Verify each of the five design-named runtime helper families has at least one certified UEFI AArch64 entry.                                                                                                                                                                                                                                            |
| 25  | LOW      | dev           | package.json                                                                                         | Define a `bin` entry and release/publish flow; add an extensible target registry; add `--explain` and JSON reporter CLI surface to format host diagnostics.                                                                                                                                                                                            |
| 26  | CRITICAL | aarch64       | `src/target/aarch64/backend/allocation/allocator.ts:43`                                              | Default GPR pool of only 8 registers causes massive artificial spills. Expand to full AAPCS64 non-reserved GPR set (x0–x7, x9–x15, x19–x28) and reserve x8/x16/x17/x18/x29/x30/sp/XZR.                                                                                                                                                                 |
| 27  | CRITICAL | aarch64       | `src/target/aarch64/backend/allocation/spill-remat.ts:176-178`                                       | `isMoveWideImmediate` rejects any constant above 16-bit, aborting backend on 32/64-bit constants under register pressure. Lift ceiling; reuse `lower/constant-materialization.ts` 16-bit chunker for `movz`+`movk` recipes.                                                                                                                            |
| 28  | CRITICAL | linker        | `src/target/uefi-aarch64/binary-spine.ts:217-227`                                                    | Default `AArch64LinkerVeneerProvider` is not wired into `linkAArch64Image`. Long BL/B relocations fail permanently. Provide a default trampoline provider (ADRP x16 / ADD x16, x16 / BR x16) and pass it through.                                                                                                                                      |
| 29  | MEDIUM   | aarch64       | `src/target/aarch64/backend/allocation/allocator.ts:163+`                                            | No spill-weight estimation, no loop-depth-aware eviction, no move coalescing. Implement a weighted-spill metric `(uses + 10^loopDepth · loopWeight) / length` and integrate copy coalescing into the existing move-resolution path (`move-resolution.ts`, already present).                                                                            |
| 30  | HIGH     | security      | panic / unwind edges from `src/target/aarch64/backend/frame/prologue-epilogue.ts` + `unwind-plan.ts` | Verify `wipe-on-spill` slots are zeroed on _every_ exit edge including synthetic panic/abort edges. Today a `wipe-on-spill` value spilled to a stack slot is zeroed only on the canonical epilogue path; a firmware watchdog timeout or `trap` exit may leave the slot un-zeroed. Add an epilogue-zeroization verifier for security-label spill slots. |
| 31  | MEDIUM   | mono          | `src/mono/reachability.ts`                                                                           | Recursion is strictly banned (`MONO_RECURSIVE_FUNCTION_CYCLE`, `MONO_POLYMORPHIC_RECURSION`) rather than permitting statically bounded monomorphic recursion with a verified stack-frame margin. Realistic driver code (e.g. AST walks) needs bounded recursion. Add an opt-in `recursive(max_depth=N)` attribute backed by a stack-frame audit.       |
| 32  | MEDIUM   | opt-ir        | `src/opt-ir/passes/licm.ts` LICM                                                                     | Pass hoists pre-labeled `loopOperationIds` without driving its own loop-forest / dominance / data-dependency analysis. Refactor to compute natural loop forest from back-edges, insert synthetic pre-headers where missing, apply loop-invariance + dominance-over-exit-correctness before hoisting.                                                   |
| 33  | MEDIUM   | proof-mir     | `src/proof-mir/lower/*` CFG construction                                                             | Enforce critical-edge splitting in Proof MIR construction; add a CFG reducibility verification pass after dominator build so dominance-based fact propagation can never silently allow a fact-via-bypass through an irreducible loop.                                                                                                                  |

---

## 21. Thermo-Nuclear Maintainability Scorecard

The audit pattern in `tests/audit/mono-maintainability-audit.test.ts` is a
good "thermo-nuclear" baseline. Applying the same threshold (≤1000 LOC per
file under `src/<subsystem>/`) project-wide today yields the following
over-budget files (Wrela6 already passes for `src/mono`; everything below
would currently **fail** the same audit):

```
src/semantic/names/expression-resolver.ts           1324
src/opt-ir/operations.ts                            1045
src/opt-ir/lower/lower-checked-mir.ts               1031
src/target/aarch64/backend/object/layout-encode-fixed-point.ts 997
src/proof-check/domains/validation.ts                988
src/proof-mir/lower/expression-lowerer.ts            982
src/proof-check/kernel/registry/transition-helpers.ts 979
src/mono/mono-hir.ts                                 976
src/target/aarch64/backend/object/object-module.ts   973
src/target/aarch64/backend/verify/encoding-object-verifier.ts 972
src/target/aarch64/lower/lower-function.ts            964
src/semantic/names/type-reference-resolver.ts        956
src/proof-check/domains/source-calls.ts               951
src/proof-check/domains/facts.ts                      951
src/proof-mir/draft/draft-graph-builder.ts            946
src/target/aarch64/backend/api/machine-lowering.ts    944
src/proof-check/authority/authority-term-canonicalization.ts 943
src/proof-mir/domains/effects-resources.ts            931
src/target/uefi-aarch64/runtime-helper-instructions.ts 929
src/proof-mir/canonicalization/graph-snapshot-freeze.ts 929
src/mono/reachability.ts                              915
src/proof-mir/lower/local-classifier.ts              892
src/proof-check/authority/semantics-companion.ts      890
src/mono/function-statement-cloner.ts                 886
```

None are individually catastrophic — the project's typical file size is
already in the few-hundreds LOC range, which is why the cumulative worker
quality is high — but each of these is at the natural "split me by a
construct family" boundary. Treat the audit threshold (1000 LOC, modulo
exempted data tables) as a hard gate.

Scar-tissue audits also worth adding (modeled on lines 34-62 of the mono
audit):

- `aspNeverSourceOrigin` — assert `as never` does not appear in
  `src/proof-mir/lower/` source-origin assignment sites.
- `anyInSemantic` — assert no `: any` or `as any` in
  `src/semantic/names/`.
- `binaryFromOptIl` — assert no `JSON.stringify(record)` (as opposed to
  a stable-stringify helper) keyed into proof-mir canonical keys.
- `legacyLexerShimUsage` — assert `src/lexer/` is never imported from
  `src/frontend` or outside of backward-compat edge code.

---

## 22. Closing

The bones of a production, world-class compiler are already here:

- a fully wired source → `.efi` pipeline with deterministic
  fingerprinting at every seam;
- a real, bounded, counterexample-producing proof checker;
- a real AArch64 encoder producing valid instructions;
- a real QEMU smoke runner that actually spawns qemu-system-aarch64;
- a real OptIR pass pipeline with explicit authority/contract discipline;
- a real Lean proof sidecar with no proof cheats;
- 4784 passing tests with no flaky timeouts.

Turning it from a toy into production means **completing the surface**:
the language-complete stream-loop lowering, the language-complete stdlib,
the user-facing CLI + project model + diagnostic reporter, the
production-scale resource-limit policy, and end-to-end qemu boot
automation in `bun test`. None require architectural rework; all require
focused implementation work against designs that already exist.

— opencode autonomous review pass, 2026-07-03
