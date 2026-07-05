# Wrela6 World-Class Compiler Review

Date: 2026-07-05

Scope: whole repository, with emphasis on `src`, `tests`, `scripts`, `stdlib`,
`proof-model`, and production-facing documentation.

Goal: identify the bugs, incomplete contracts, structural risks, missing
optimization work, and verification gaps that stand between the current compiler
and a production, world-class compiler for the Wrela UEFI AArch64 use case.

This review intentionally ignores other agents' draft review documents as
deliverables. Prior docs were only used as historical signal where current
source still confirmed the issue.

## Executive Verdict

Wrela6 has unusually strong bones for a young compiler: explicit phases, rich
diagnostic types, deterministic validation language, proof-aware IRs, target
surface authentication, full-image validation, and many audit tests that try to
lock in project values.

It is not production-grade yet.

The most important gap is not volume of code. It is trust. Several subsystems
still trust upstream identity, scope, order, or validation contracts too
eagerly:

- Frontend import discovery can disagree with the parser about what module name
  syntax means.
- Semantic and HIR lowering can collapse distinct proof identities into one
  fact or transition.
- Proof checking can allow companion patches to mutate resource state too
  broadly.
- OptIR optimizations sometimes treat CFGs as sorted operation streams.
- AArch64/PE output has correctness risks in relocation math and unwind data.
- Release validation can be locally green while QEMU, Lean, reproducibility, and
  stdlib claims are either skipped or aliases.

The path to world-class is clear: every phase must fail closed at its public
boundary, every identity-bearing fact must survive lowering without collision,
every optimization must be justified by CFG-aware dataflow and fact lifetime
management, and release gates must produce independent, non-skipped evidence.

## Method

Seven read-only subsystem audits were run in parallel and synthesized with local
repo-wide scans:

- Frontend: lexer, parser, syntax, module graph, frontend tests.
- Semantic/HIR/mono: names, semantic surface, HIR lowering, monomorphization.
- Proof: Proof MIR, proof-check kernel, companion authority, Lean proof model.
- OptIR: analyses, passes, pipeline state, verifier, tests.
- Backend/linker: AArch64 lowering/backend, linker, PE/COFF, UEFI target.
- Validation/release: full-image validation, CLI validation, QEMU/Lean release
  gates.
- Tests/docs/scripts/stdlib: test suite shape, docs drift, release scripts,
  stdlib surface.

Local scan signals:

- About 1,038 TypeScript files under `src`.
- About 804 TypeScript test files under `tests`.
- About 63 documentation files, 10 stdlib files, and 142 proof-model files.
- `wc -l` reported roughly 235k lines under production `src` source files and
  roughly 181k test/support lines.
- 62 production TypeScript files are at least 700 lines; 27 test TypeScript
  files are at least 700 lines.
- `docs/language/invalid.md` contains 183 invalid-language examples, while the
  executable diagnostics corpus surface is tiny by comparison.

Severity used below:

- P0: likely miscompile, invalid binary, proof unsoundness, or release-blocking
  correctness issue.
- P1: serious production readiness issue, phase-boundary flaw, or broad test gap.
- P2: maintainability, scale, performance, or diagnostic quality issue that
  should be fixed before the codebase grows further.
- P3: polish, cleanup, API clarity, or low-risk hardening.

## Highest Priority Fixes

These are the issues I would fix before calling any artifact produced by this
compiler production-worthy.

### P0: ARM64 PE `REL32` Relocation Math Is Off By 4

Files:

- `src/linker/aarch64/aarch64-relocations.ts`
- `src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data.ts`
- `tests/unit/linker/aarch64-relocation-math.test.ts`
- `tests/support/linker/slow-linked-image-validator.ts`

The target catalog maps a relocation family to PE/COFF
`IMAGE_REL_ARM64_REL32`, but the relocation implementation treats it like a
branch displacement from the relocation location. The Microsoft PE/COFF
definition for ARM64 `IMAGE_REL_ARM64_REL32` is the 32-bit relative address
from the byte following the relocation field. That means the patch expression
should be based on `patchRva + 4`, not `patchRva`.

Impact:

- Any emitted object or linked image that uses this relocation can point four
  bytes away from the intended target.
- The current slow validator appears to encode the same rule, so the test oracle
  can agree with the bug.

Fix:

- Split internal branch-relative relocations from PE field-relative relocations,
  or make the current PE `rel32` implementation compute
  `targetRva + addend - (patchRva + 4)`.
- Update the slow validator independently.
- Add boundary tests that compare against known PE/COFF ARM64 relocation
  examples.

Spec anchor: Microsoft PE Format documents `IMAGE_REL_ARM64_REL32` as relative
from the byte following the relocation field:
https://learn.microsoft.com/en-us/windows/win32/debug/pe-format

### P0: Synthetic ARM64 Unwind Metadata Is Not Valid `.pdata` / `.xdata`

Files:

- `src/target/uefi-aarch64/entry-thunk.ts`
- `src/linker/aarch64/aarch64-entry-objects.ts`

The UEFI entry thunk emits synthetic `.pdata` and `.xdata`, but the current
records are not a decoded, spec-valid ARM64 unwind model. The reported issue is
that `.pdata`/`.xdata` relocations are emitted as `rel32`, the xdata relocation
can overwrite the xdata header, and the bytes are placeholder-like rather than
validated ARM64 unwind records.

Impact:

- The PE image can look structurally plausible while containing invalid unwind
  metadata.
- Firmware, debuggers, exception/unwind machinery, or post-link validation tools
  can reject or misinterpret the image.
- Tests that only check exception directory presence or size are insufficient.

Fix:

- Emit the first `.pdata` word as function-start RVA.
- Emit the second `.pdata` word as either valid packed unwind data or an xdata
  RVA, as required for ARM64.
- Add local `.xdata` symbols instead of patching raw headers accidentally.
- Add tests that parse and decode `.pdata` and `.xdata`, not just section
  existence.

Spec anchor: Microsoft ARM64 exception handling describes ordered `.pdata`
records and function-start RVA / packed-or-xdata encoding:
https://learn.microsoft.com/en-us/cpp/build/arm64-exception-handling?view=msvc-170

### P0: Memory SSA And Memory Optimization Are CFG-Unsound

Files:

- `src/opt-ir/analyses/memory-ssa.ts`
- `src/opt-ir/analyses/effect-tokens.ts`
- `src/opt-ir/passes/memory-optimization.ts`

Memory SSA and memory optimization iterate operations by sorted block ID and
linear order. That is not a valid memory model for real CFGs. A store on one
branch can appear to dominate a load at a join even when another executable path
reaches the load without that store. Dead-store elimination can similarly delete
stores that remain observable on some paths.

Impact:

- Load forwarding and DSE can miscompile branchy programs.
- Any proof or rewrite record attached to these rewrites is not enough if the
  underlying memory version model is path-insensitive.

Fix:

- Implement CFG-aware MemorySSA with memory phi nodes or equivalent join-state.
- Require dominance for store-to-load forwarding.
- Require post-dominance/liveness or may-clobber reasoning for DSE.
- Add adversarial CFG tests: diamond stores, loop-carried stores, early exits,
  volatile/observable region boundaries, and non-topological block order.

### P0: SCCP Has No Overdefined Lattice State

Files:

- `src/opt-ir/passes/sccp.ts`

The SCCP pass records constants in a map. When two reachable predecessors supply
different constants for the same value, `setConstant` keeps the earlier value
instead of transitioning to `overdefined`. Standard SCCP needs at least
`unknown`, `constant(value)`, and `overdefined`, plus executable-edge tracking.

Impact:

- A join parameter can remain incorrectly constant.
- Branches can be pruned using facts that were only true on one predecessor.
- This is a direct miscompile risk.

Fix:

- Replace the constant map with a proper SCCP lattice.
- Revisit users when a value changes from constant to overdefined.
- Use executable-edge worklists, not just repeated sorted block scans.
- Add tests for conflicting join constants and loops that discover facts in
  different orders.

### P0: Proof Companion Patches Can Close Or Mutate Resources Too Broadly

Files:

- `src/proof-check/domains/loops.ts`
- `src/proof-check/authority/semantics-companion.ts`
- `src/proof-check/kernel/state-reducer.ts`
- `src/proof-check/kernel/patch-permission-policy.ts`
- `src/proof-check/domains/stream-loop.ts`

`stateJoin` and `loopConvergence` companion patches may close `obligation`,
`validation`, and `attempt` entries without a resource-specific allowlist in the
request. Stream-loop companion handling also allows session entries broadly, and
validation does not appear to limit the mutation to the named stream session key
or reject session opens.

Impact:

- Proof-check authority can erase live obligations or sessions outside the
  intended scope of a join or loop.
- This undermines the proof kernel's most important property: resource state can
  only change for reasons the checked judgment actually authorizes.

Fix:

- Add explicit closable-resource allowlists to companion requests.
- Require the target resource to be live, named, and in scope.
- For stream loops, allow only closing the exact `streamSessionKey` under the
  specific last-member condition; reject arbitrary opens.
- Add negative tests for unrelated obligation, validation, attempt, and session
  mutations.

### P0: Semantic Proof Identity Is Collapsing

Files:

- `src/hir/fact-lowerer.ts`
- `src/hir/call-proof-metadata.ts`
- `src/hir/hir.ts`
- `src/mono/mono-hir.ts`
- `src/semantic/surface/contract-type-identity.ts`
- `src/hir/call-lowerer.ts`

The HIR and mono schemas can represent predicate arguments, but predicate fact
recording only carries `predicateFunctionId` and optional state place. Calls like
`ready(a)` and `ready(b)` can become the same fact if argument identity is not
carried. Private-state transition discovery similarly selects receiver or the
first matching parameter, and HIR lowering selects the first transition.

Impact:

- Proof facts can apply to the wrong resource.
- Calls with multiple proof-relevant inputs can be under-modeled.
- This is a semantic correctness and proof authority risk, not only metadata
  cleanup.

Fix:

- Carry ordered lowered call arguments into predicate facts.
- Either reject multiple private-state inputs semantically or lower one
  transition per proof-relevant receiver/parameter.
- Add tests where two resources share a predicate function but must remain
  distinct.

## P1 Findings By Subsystem

### Frontend: Import Discovery And Parser Grammar Still Disagree

Files:

- `src/frontend/lexer/import-discovery.ts`
- `src/frontend/parser/import-declaration-parser.ts`
- `src/frontend/lexer/module-graph-lexer.ts`

Token import scanning can accept segments that the parser rejects as module-name
segments. For example, a keyword/operator-looking segment can cause module graph
traversal to load a path that the parsed AST does not accept as the import.

This is a phase-boundary bug: the compiler can read and diagnose a graph that is
not the graph represented by the parsed source.

Fix:

- Make module-graph import discovery parser/AST-backed, or derive token scanning
  from the exact same canonical module-name token set.
- Add differential tests that compare token-discovered imports with
  parser-discovered imports for valid and invalid import declarations.

### Frontend: Missing Indented Blocks Produce Misleading Top-Level Errors

Files:

- `src/frontend/parser/block-parser.ts`

Source like:

```wr
fn main():
foo
```

should diagnose "expected indented block after ':'" at the function boundary.
Instead it can recover into a top-level declaration diagnostic. That points the
user at the wrong grammar layer.

Fix:

- Add `PARSE_EXPECTED_INDENTED_BLOCK`.
- Recover to a block or top-level boundary deliberately.
- Cover functions, classes, images, sections, if/else, loops, validation, and
  attempt constructs.

### Frontend: Bracket Expression Ambiguity Is Silent

Files:

- `src/frontend/parser/expression-parser.ts`

`arr[0]` gets an unsupported index diagnostic, but `arr[i]` and `arr[Foo]` can be
parsed as type applications without a diagnostic. This is user-visible
misparsing.

Fix:

- Define the bracket grammar unambiguously.
- If indexing is unsupported, reject every expression-like bracket payload with
  the same unsupported-index diagnostic.
- Add parser and semantic tests for type application versus indexing.

### Frontend: Public API Exposes Internals As Stable Surface

Files:

- `src/index.ts`
- `src/frontend/index.ts`
- `tests/integration/frontend/public-api.test.ts`

The package root exports low-level lexer/parser/syntax classes. That may be
useful today, but public API tests appear to lock implementation classes as
product surface.

Fix:

- Split stable public API from `internal` compiler APIs.
- Make stable API tests assert user-facing compile/parse/diagnostic contracts,
  not raw implementation class availability.
- Keep lower-level exports under an explicit `wrela/internal` or source-tree-only
  path.

### Semantic Names: Ambiguous Imports Can Be Dropped

Files:

- `src/semantic/names/import-resolver.ts`
- `src/semantic/names/scope.ts`
- `src/semantic/names/expression-resolver/simple-name-resolver.ts`
- `src/semantic/names/expression-resolver.ts`
- `src/semantic/names/type-reference-resolver.ts`

Imported candidates are combined and deduped by `namespace:name`, which can drop
same-named candidates from different modules before the scope ambiguity checker
ever sees them.

Impact:

- Ambiguous imports can silently bind to one candidate.
- User code can become order-dependent.

Fix:

- Preserve candidate identity through scope construction.
- Emit `NAME_AMBIGUOUS_NAME` for ambiguous simple lookup.
- Add tests for importing the same simple value/type/function name from two
  modules.

### HIR/Mono: Proof-Relevant Expression Places Can Disappear

Files:

- `src/hir/expression-lowerer.ts`
- `src/hir/call-lowerer.ts`
- `src/hir/validation-lowerer.ts`
- `src/hir/fact-lowerer.ts`

Inline proof-relevant expressions do not always receive a stable place.
Downstream proof metadata then falls back to `unknown` or drops place identity.

Fix:

- Centralize temporary place creation for proof-relevant expression results.
- Emit diagnostics when proof metadata requires a place but none exists.
- Add tests for object literals, inline call arguments, validations, and private
  transitions.

### Mono: Canonical Keys Cross The HIR/Mono Boundary Too Casually

Files:

- `src/mono/proof-metadata-instance-helpers.ts`
- `src/hir/place.ts`
- `src/proof-mir/domains/effects-resources.ts`

Mono resource-place instantiation substitutes type and kind but preserves the
HIR canonical key. If the key includes type/kind fingerprints, a mono instance
can carry a generic identity that no longer describes the substituted resource.

Fix:

- Recompute canonical keys after substitution, or rename the field to
  `hirCanonicalKey` and make downstream mono keying explicitly
  instance-qualified.
- Add tests for two generic instantiations that would collide under the HIR key.

### Proof-Check Boundary: Public Ingress Trusts Builder Validation

Files:

- `src/proof-mir/proof-mir-builder.ts`
- `src/proof-check/validation/input-validator.ts`

`buildProofMir` runs structural validators before returning MIR. But the public
proof-check boundary validates authority/layout/reachability, not the full MIR
structure again. A caller can mutate `ProofMirProgram` after build and pass it
to the checker.

Fix:

- Rerun structural Proof MIR validators at proof-check ingress, or use sealed
  builder output with an integrity fingerprint.
- Add ingress tests for missing entry blocks, dangling operands/facts, invalid
  control edges, and edge-kind mismatches.

### Proof MIR: Terminator Edge-Kind Matrix Is Missing

Files:

- `src/proof-mir/validation/graph-validator.ts`

The graph validator checks outgoing edge IDs and targets, but it does not appear
to enforce edge kind compatibility for terminators such as `matchValidation`,
`matchAttempt`, `return`, `panic`, or `yield`.

Fix:

- Add a terminator-to-edge-kind matrix.
- Add negative tests to `tests/unit/proof-mir/graph-validator.test.ts`.

### OptIR: DCE Depends On Block Array Order

Files:

- `src/opt-ir/passes/dce.ts`
- `tests/unit/opt-ir/verifier.test.ts`

DCE flattens block operations and walks backward in array order. The IR permits
non-topological block order. A later-listed dominator can be deleted before its
use is encountered.

Fix:

- Compute liveness per block to a fixed point, or require and verify a specific
  reverse postorder input before DCE.
- Add tests with valid non-topological blocks and cross-block values.

### OptIR: Imported Facts Are Not Preserved Or Invalidated Centrally

Files:

- `src/opt-ir/passes/pipeline-types.ts`
- `src/opt-ir/passes/pipeline.ts`
- `src/opt-ir/passes/pipeline-steps.ts`

Facts enter `PipelineState`, but passes mutate programs and operations without a
uniform fact-preservation or invalidation contract. Later passes can consume
facts attached to removed, remapped, or semantically changed subjects.

Fix:

- Make fact preservation part of every pass result.
- Apply subject remaps centrally.
- Run fact verification after transformation clusters.
- Treat facts as capabilities with explicit lifetime, not passive metadata.

### OptIR: Structural Verifier Does Not Enforce Edge Ownership

Files:

- `src/opt-ir/terminators.ts`
- `src/opt-ir/verify/structural-verifier.ts`

The verifier checks that terminator edge IDs exist and that edge endpoints exist,
but it does not appear to assert that an edge referenced by a block's terminator
has `edge.from === block.blockId`. Different analyses can then traverse
different CFGs depending on whether they follow terminators or edge endpoints.

Fix:

- Verify edge ownership for every terminator successor.
- Verify ordinal/kind consistency.
- Reject unowned or mismatched edges.

### OptIR: Stack Promotion Is Fail-Open On Escape Evidence

Files:

- `src/opt-ir/passes/pipeline-steps.ts`
- `src/opt-ir/analyses/escape-analysis.ts`
- `src/opt-ir/passes/stack-promotion.ts`

The production pipeline calls escape analysis with only regions, while the
analysis has inputs for address-taken locals, callback captures, exported roots,
unknown calls, and external flows. Missing evidence means a region may simply
not be marked escaped.

Fix:

- Derive escape inputs from operations and facts before promotion.
- Fail closed when escape evidence is incomplete.
- Add tests for address-taken, callback, exported-root, unknown-call, and
  external-flow regions.

### OptIR: LICM Still Needs Dependency-Ordered Hoisting

Files:

- `src/opt-ir/passes/licm.ts`

LICM now uses a whole-program fresh ID allocator, but hoisted operation order is
still derived from loop block/program order. A loop-invariant operation that
depends on another hoistable operation must be emitted after its producer in the
preheader, regardless of block order.

Fix:

- Build a dependency graph for selected hoistable operations.
- Topologically order hoists by operand/result dependencies.
- Add a test where consumer appears before producer in block order but both are
  loop-invariant.

### OptIR: CFG Simplification Silently Stops At Fuel

Files:

- `src/opt-ir/passes/cfg-simplification.ts`

The pass defaults to eight rounds and transforms at most one linear/trivial block
per helper per round. If the graph still has simplifications after fuel, the pass
returns partial output without a diagnostic or `fuelExhausted` signal.

Fix:

- Return `fuelExhausted` or `changedButIncomplete`.
- Prefer worklist/batch simplification over one-change-per-round scans.
- Add long-chain tests that prove the pass reaches a fixed point or reports that
  it did not.

### Backend/Linker: Veneers Drop Addends And Ignore Scratch Register Intent

Files:

- `src/linker/aarch64/aarch64-linker.ts`
- `src/linker/aarch64/default-veneer-provider.ts`
- `src/linker/layout-fixed-point.ts`

Veneer input includes addends, but default veneer generation hardcodes onward
relocations to zero, and original branch retargeting also uses zero addend.
Generated bytes hardcode a scratch register while validation only checks that a
scratch register exists.

Fix:

- Preserve addends in pagebase/low12 relocations, or reject nonzero addends.
- Generate bytes from the requested scratch register.
- Validate the generated veneer against requested scratch intent.

### Backend ABI: Duplicate Fixed Registers Can Be Assigned

Files:

- `src/target/aarch64/backend/abi/abi-classification.ts`
- `src/target/aarch64/lower/abi-lowering.ts`

ABI classification validates register range and kind, but not duplicate fixed
registers. Two live parameter/result locations can both be assigned `x0`.

Fix:

- Reject duplicate live locations at each parameter/result boundary.
- Add tests for two fixed custom classifications pointing at the same register.

### Full-Image Validation: Unexpected Platform Reachability Passes

Files:

- `src/validation/full-image/reference-checkers/semantic-platform-reference.ts`

The semantic platform reference checker fails missing expected primitives, but
does not fail unexpected reachable primitives.

Fix:

- Compare exact expected versus actual primitive sets by default.
- Allow extra platform reachability only through explicit per-scenario
  allowlists.
- Add a negative fixture where an unexpected firmware/platform primitive becomes
  reachable.

### Full-Image QEMU Smoke: Runtime Expectations Are Too Shallow

Files:

- `src/validation/full-image/fixture-catalog.ts`
- `src/validation/full-image/qemu.ts`
- `src/cli/run-command.ts`
- `src/cli/validate-command.ts`
- `scripts/validate-full-image.ts`

Fixture specs contain expected statuses and platform primitives, but QEMU smoke
primarily checks console markers. CLI `run --qemu` can use `allowSkip: true`,
and public `wrela validate` always disables QEMU.

Fix:

- Add expected status/exit semantics to QEMU smoke requests.
- Add scenario-specific side-effect checks for watchdog/platform cases.
- Make `wrela run --qemu` fail on missing QEMU by default, with an explicit
  allow-missing flag.
- Add `wrela validate --qemu --require-qemu`.
- Reject `--qemu-allow-skip` unless `--qemu` is present.

### Release: Local Green Is Not Production Evidence

Files:

- `package.json`
- `scripts/verify-release.ts`
- `scripts/verify-qemu.ts`
- `scripts/verify-lean.ts`
- `RELEASING.md`
- `tests/audit/local-verification-audit.test.ts`

`agent:check` runs broad checks but allows missing QEMU and Lean. That is good
for local developer ergonomics, but it is not production release evidence.
There is also no required CI workflow in the repository, and tests currently
lock in the absence of `.github/workflows`.

Fix:

- Split local handoff from production release:
  - `agent:check`: fast local, may report advisory skipped external gates.
  - `verify:release`: non-skipping, clean tree, frozen install, strict QEMU,
    strict Lean, reproducibility, package checks, and evidence manifest.
  - CI: protected branch workflow that runs the strict lane on configured
    infrastructure.
- Replace "no CI" audit tests with required workflow tests.

### Release: `verify:reproducible` And `verify:stdlib` Are Aliases

Files:

- `package.json`
- `RELEASING.md`

`verify:reproducible` and `verify:stdlib` both alias `verify:full-image`, while
release docs present them as separate claims.

Fix:

- `verify:reproducible`: clean builds in separate directories, byte/hash
  equality for artifacts, locked toolchain, stable timestamps, package tarball
  checksum.
- `verify:stdlib`: exported symbol manifest, source conformance fixtures,
  compatibility doc checks, stdlib ejection parity, and negative misuse cases.

## P2 Findings And Structural Cleanup

### Giant Files Are Still A Growth Brake

The largest production files are near 1k lines each, including:

- `src/target/aarch64/backend/object/layout-encode-fixed-point.ts`
- `src/opt-ir/lower/lower-checked-mir.ts`
- `src/proof-check/domains/validation.ts`
- `src/proof-check/kernel/registry/transition-helpers.ts`
- `src/mono/mono-hir.ts`
- `src/target/aarch64/lower/lower-function.ts`
- `src/proof-mir/draft/draft-graph-builder.ts`
- `src/target/aarch64/backend/api/machine-lowering.ts`
- `src/proof-check/authority/authority-term-canonicalization.ts`

Large files are not automatically bad, but in this repo they cluster around
phase authority, lowering orchestration, and fixed-point behavior. Those are the
worst places to hide implicit contracts.

Recommendation:

- Split by invariant, not by arbitrary line count.
- Each extracted module should own one state transition, verifier family,
  lowering subproblem, or spec table.
- Add "no new giant files" policy for production source, with an allowlist for
  generated/static catalog data only.

### `as never` And Fallback Origins Are Still Scar Tissue

Examples:

- `src/mono/reachability-shared.ts`
- `src/mono/proof-metadata-instance-helpers.ts`
- `src/mono/mono-external-roots.ts`
- `src/target/aarch64/lower/constant-materialization.ts`
- `src/proof-mir/canonicalization/program-freeze-function-draft.ts`
- `src/proof-mir/canonicalization/draft-statement-freeze.ts`
- `src/opt-ir/passes/sccp.ts`

Some casts are narrow TypeScript escape hatches; others fabricate placeholder
IDs such as `0 as never`. In a compiler with proof obligations, fake IDs are
not harmless. They erase ownership, provenance, and phase authority.

Recommendation:

- Replace fake numeric IDs with explicit `missing` / `synthetic` variants.
- Require every synthetic origin to have an owner module/function/item and stable
  reason.
- Ban `0 as never` in production source.

### E-Graph Translation Validation Can Be Vacuous

Files:

- `src/opt-ir/passes/egraph-materialization.ts`
- `src/opt-ir/egraph/translation-validation.ts`
- `src/opt-ir/interpreter.ts`

If validation uses an empty or under-bound context, both original and rewritten
regions can trap the same way for harness reasons rather than semantic
equivalence.

Recommendation:

- Bind real region boundary inputs, memory, and effects.
- Treat "harness missing" traps as validation failure.
- Add negative tests where a bad rewrite currently passes because both sides
  cannot execute.

### Pass Contracts Are Metadata, Not Execution Dependencies

Files:

- `src/opt-ir/policy/pass-order-policy.ts`
- `src/opt-ir/verify/pass-schedule-consistency.ts`
- `src/opt-ir/passes/pipeline-steps.ts`

The schedule declares analysis requirements, but pass implementation does not
appear forced to request or consume those analyses. Recomputable analyses can be
marked available without a strong implementation dependency.

Recommendation:

- Add an analysis manager.
- Make pass adapters request declared analyses through that manager.
- Fail tests if a pass declares an analysis and then ignores the provided result.

### Duplicate IDs Can Collapse In Tables

Files:

- `src/opt-ir/program.ts`
- `src/opt-ir/cfg.ts`

Map constructors can silently last-write-win duplicate function, block, edge,
operation, result, constant, or region IDs.

Recommendation:

- Reject duplicates at construction or verifier boundaries.
- Add property tests for duplicate ID injection.

### Linker Relocation Application Has Avoidable Quadratic Lookup

Files:

- `src/linker/relocation-application.ts`

Each relocation scans section contributions to find its patch contribution.
This is avoidable.

Recommendation:

- Build a `moduleKey + objectSectionKey -> contribution` index once per
  relocation application pass.
- Track this in the cost scorecard.

### Parser Diagnostics Need User-Actionable Context

Files:

- `src/frontend/parser/parser-context.ts`
- `src/frontend/parser/node-claim.ts`
- `src/frontend/syntax/syntax-tree.ts`

Messages such as "Expected SyntaxKind", "Unexpected token", and "Skipped
unexpected tokens" are not enough for a production compiler. Stable detail can
also be recomputed in ways that ignore the drafted diagnostic detail.

Recommendation:

- Include expected grammar role, actual token text/kind, and recovery action.
- Make draft stable detail either honored or removed.
- Build a reviewed malformed-source diagnostic corpus.

### Module Graph Traversal Needs Scale Hardening

Files:

- `src/frontend/lexer/module-graph-lexer.ts`
- `tests/integration/frontend/lexer/module-graph-lexer-fuzz.test.ts`

Traversal is recursive, sequential, and only lightly stress-tested.

Recommendation:

- Use iterative traversal with `loading | loaded | failed` state.
- Cache failed reads.
- Preserve deterministic output order.
- Stress 1k+ chains, diamonds, cycles, and missing modules.

### Unicode Span Policy Needs To Be Explicit

Files:

- `src/shared/source-text.ts`
- `src/frontend/lexer/cursor.ts`
- `src/frontend/lexer/lexer.ts`

Positions are UTF-16 code-unit based, and invalid astral characters can split
into multiple diagnostics.

Recommendation:

- Document span units as UTF-16 code units or move to code-point/grapheme-aware
  mapping with display adapters.
- Consume full code points for invalid character diagnostics.
- Add Unicode-heavy diagnostic mapping tests.

### Mono Reachability Drops Field-Specific Provenance

Files:

- `src/mono/reachability/state-table.ts`

Type-instance field discoveries carry `fieldId`, but dedupe keys ignore it. Work
can dedupe by type instance while provenance edges still need field identity.

Recommendation:

- Separate work dedupe key from provenance edge key.
- Emit graph/provenance edges per `(type instance, source, fieldId)`.

### Packet Dependency Sanitizer Is A Footgun

Files:

- `src/proof-check/validation/packet-validation-context.ts`

A sanitizer that silently drops unauthorized dependencies is currently unused,
but if production code ever reuses it, it can repair invalid proof packets
instead of rejecting them.

Recommendation:

- Remove it, move it under tests, or rename it as explicitly test-only.

## Test Suite Review

The test suite is substantial and valuable. It has unit, integration, audit,
system, full-image, property/fuzz, scorecard, and release-surface checks. The
weakness is that several tests lock in the existence of scaffolding rather than
independently proving behavior.

### Good Test Assets

- Audit tests encode project policy: no mocks, filesystem at edges, dependency
  restrictions, release surface expectations.
- Full-image validation tests exercise real phase chains.
- Cost scorecard exists and is part of `agent:check`.
- There are tests for package packing and CLI importability.
- Recent test decomposition reduced one oversized package-pipeline test.

### P1 Test Gaps

1. Miscompile confidence does not yet run generated `.wr` programs through the
   whole compiler. The current seed constructs OptIR slices directly while the
   design ladder describes source-level generated programs.

2. Live QEMU coverage is soft-skipped in local tests and can report success when
   configuration is absent.

3. Lean verification can be skipped in `agent:check` with missing tools.

4. The invalid language spec has 183 invalid sections, but the executable
   diagnostics corpus is tiny.

5. Full-image oracle data is too narrow. Packet-counter positives reuse a small
   byte sequence, with limited negative and boundary cases.

6. Slow validators can encode the same bug as production code, as seen in the
   ARM64 REL32 issue.

7. Parser fuzz checks no-throw/reconstruction more than diagnostic quality,
   importer equivalence, or semantic AST invariants.

### Test Suite Upgrades

- Add a must-reject corpus generated from `docs/language/invalid.md`.
- Add source-level randomized `.wr` program generation for the miscompile
  ladder.
- Add differential oracles: interpreter versus backend, source semantics versus
  QEMU output, independent PE parser versus internal writer.
- Add mutation tests for proof-check companion patches and OptIR fact
  preservation.
- Add adversarial CFG generators: non-topological block order, diamonds, loops,
  irreducible CFGs where unsupported, duplicate IDs, dangling edges.
- Add release CI lanes that produce evidence artifacts and fail on skipped QEMU
  or Lean.

## Stdlib Review

The stdlib is still closer to a marker/intrinsic surface than a production
library. Files such as `stdlib/wrela-std/core/result.wr` and
`stdlib/wrela-std/core/validation.wr` contain empty marker classes. That can be
fine if documented honestly, but it must not look like a complete compatibility
surface.

Needed before production:

- `stdlib/COMPATIBILITY.md` listing every exported symbol as real API,
  compiler intrinsic, marker, experimental, or missing.
- Source-level conformance fixtures for each exported symbol.
- Ejected-stdlib parity tests for every stdlib mode.
- Negative misuse tests for stdlib resource and validation abstractions.
- Versioning policy for stdlib source compatibility and compiler intrinsic
  evolution.

## Documentation Review

The docs are ambitious and useful, but there is drift between design claims and
current executable evidence.

Issues:

- `README.md` imports from `./src/frontend`, while the package exports `dist`
  entrypoints. Public docs should teach package usage, not repo-internal usage.
- Release docs present `verify:reproducible` and `verify:stdlib` as separate
  claims even though they alias full-image validation today.
- Design docs often describe production-grade final architecture while the code
  still has placeholder/stage-slot remnants.

Fix:

- Add a docs audit that every public command in README and RELEASING is
  executable in a packed consumer.
- Link every design-stage production claim to an implementation status:
  `implemented`, `partial`, `test-only`, `planned`, or `not started`.
- Keep a single production-readiness dashboard instead of many drifting review
  docs.

## Optimization Roadmap

World-class optimization for Wrela should prioritize correctness-preserving,
proof-aware optimization before cleverness.

### Phase 1: Make Existing Passes Sound

- CFG-aware MemorySSA.
- Proper SCCP lattice.
- CFG liveness for DCE.
- Fact lifetime/invalidation across every pass.
- Edge ownership and duplicate ID verification.
- Escape analysis that fails closed.
- LICM dependency-ordered hoisting.
- CFG simplification fixed-point reporting.

### Phase 2: Build A Real Pass Infrastructure

- Analysis manager.
- Pass result `changed` flags and incremental fingerprints.
- Central subject remap and fact preservation.
- Required verifier checkpoints by pass cluster.
- Translation validation with concrete/symbolic memory and effect context.

### Phase 3: Add Compiler-Grade Middle-End Power

- Dominator/post-dominator utilities hardened by property tests.
- Alias analysis and memory effect summaries.
- GVN / PRE where fact-preserving.
- Inlining cost model, not only mandatory or structural inlining.
- Loop canonicalization before LICM and future strength reduction.
- Region-aware scalar replacement with proof fact preservation.

### Phase 4: Backend Performance

- Real register allocation policy with interference, aliases, spills, and
  rematerialization.
- Instruction scheduling with barriers and firmware/UEFI profile constraints.
- Better veneer placement and branch relaxation.
- Object layout indexing for relocation performance.
- AArch64 peepholes only after independent machine verifier support.

## Production Release Roadmap

### Gate 0: Stop Miscompile/Invalid-Binary Risks

- Fix ARM64 REL32.
- Fix `.pdata`/`.xdata`.
- Disable or guard unsound memory optimization and SCCP until repaired.
- Fail proof companion patches that mutate resources outside explicit scope.
- Preserve predicate/private-state identity.

### Gate 1: Make Boundaries Fail Closed

- Parser-backed module graph import discovery.
- Proof-check ingress structural validation or sealed MIR.
- Exact semantic platform reference checking.
- OptIR edge ownership and duplicate ID verification.
- Escape analysis evidence completeness.

### Gate 2: Make Release Evidence Real

- Add CI with strict QEMU and Lean.
- Add frozen install and toolchain version preflight.
- Add reproducible build verification in clean directories.
- Add stdlib compatibility verification.
- Emit a release evidence JSON manifest with binary hashes, tool versions,
  firmware hashes, proof-model commit/version, and package tarball checksum.

### Gate 3: Make Tests Prove Behavior

- Source-level generated program testing.
- Invalid-language executable corpus.
- Full-image scenario oracle expansion.
- Independent PE/COFF verifier.
- Mutation tests for proof and optimizer authority.

### Gate 4: Make The Architecture Pleasant To Extend

- Reduce giant files by invariant ownership.
- Split public/internal APIs.
- Replace fake ID casts with typed synthetic origins.
- Add one canonical fact registry across semantic/proof/OptIR/backend where
  possible.
- Keep docs tied to executable status.

## Production Definition Of Done

Wrela6 should not be called production-grade until all of these are true:

- No known P0 miscompile, proof-authority, or invalid-binary findings remain.
- `verify:release` cannot pass with QEMU or Lean missing.
- CI runs strict release gates on protected branches.
- Reproducible build verification is independent and byte-level.
- Stdlib compatibility is documented and executable.
- Every unsupported source feature fails with a source-level diagnostic before
  low-level IR or backend materialization.
- Every optimizer pass either proves/validates its rewrites or is disabled for
  production.
- Every proof-check state mutation is scoped to an explicit checked authority.
- PE/COFF and AArch64 output is independently decoded and validated.
- The invalid-language spec is executable.
- Public docs show package usage and match tested behavior.

## Closing Assessment

The project is not a toy in effort or ambition. It already has many of the
ingredients of a serious compiler: proof-aware design, deterministic validation,
target-specific release thinking, and a test culture that catches structural
regressions.

The remaining work is to make every impressive-looking contract binding. The
compiler must stop accepting "probably from the right phase", "probably the same
identity", "probably unreachable", "probably validated upstream", and "probably
ran in release" as implicit proof.

World-class Wrela is the version where phase boundaries are hard, facts have
lifetimes, proof authority is narrow, optimizations are CFG-aware, binaries are
spec-decoded, and release evidence is impossible to fake by accident.
