# Wrela6 Production Compiler Readiness Review

Review date: 2026-07-04

This is a whole-codebase production-readiness review of the current Wrela6 compiler
workspace. It intentionally ignores the separate untracked
`docs/thermonuclear-codebase-review.md` file, per request, and is written as an
independent review document.

The short version: this codebase has made the jump from "compiler-shaped" to
"end-to-end compiler pipeline exists." That is a big threshold. The source tree
contains a real frontend, semantic/HIR layers, monomorphization, layout fact
generation, Proof MIR, a proof checker, OptIR, an AArch64 backend, linker,
PE/COFF EFI image writer, UEFI target driver, and full-image validation
fixtures. The hard truth is that the system is still not production-grade. It
has several correctness bugs that can invalidate core compiler invariants, a few
intentional lowering gaps that still reject real language features, and a
maintainability profile that will become dangerous unless ownership boundaries
are tightened before more features are added.

The path to a world-class compiler is clear: make every phase fail closed at its
boundary, remove caller-controlled truth from internal IRs, make target and ABI
contracts explicit, turn validation into mandatory CI/release gates, and split
large invariant hubs into smaller modules owned by one concept each.

## Review Method

This review used:

- A repo-wide scan of source, tests, scripts, docs, stdlib, and proof model.
- Five focused read-only subsystem audits covering frontend, middle-end,
  proof/proof-checking, backend/linker/PE/UEFI, and repo-level production
  readiness.
- The thermo-nuclear maintainability rubric: no giant abstraction hubs, no
  weakly typed cross-phase contracts, no ambiguous ownership, no regex parsing
  where structured data is available, no "truth by stored field" when truth can
  be derived.
- Local line-count and metadata checks. The current tracked tree includes 969
  TypeScript files under `src`, 729 TypeScript test files, 16 Lean proof files,
  7 stdlib `.wr` files, 50 docs markdown files, and 224,114 lines of tracked
  `src/**/*.ts`.

This document is intentionally direct. It is not saying the design is bad. It is
saying the design is now serious enough that the remaining toy-compiler habits
are too expensive to keep.

## Severity Legend

- Critical: can make the compiler accept or produce incorrect artifacts while
  bypassing intended invariants.
- High: can cause wrong code, unsafe source ingestion, silently incorrect
  phase contracts, or major production release failure.
- Medium: important correctness, determinism, coverage, or diagnostic gap that
  should be fixed before broad use.
- Low: production polish, maintainability, or late-failure issue that should be
  tracked and fixed deliberately.

## Executive Blocker List

Fix these before treating the compiler as production-capable:

1. Critical: Proof MIR CFG predecessor truth is caller-controlled through
   `incomingEdges`, and proof-check joins trust it.
2. High: AArch64 public functions can clobber callee-saved registers because
   allocatable x19-x28 are not saved/restored when used.
3. High: Source ingestion has a symlink root escape through prefix-based
   `realpath` checking.
4. High: Proof MIR draft edge keys collide for repeated branch, validation, and
   panic sites.
5. High: Applied proof/resource constructors can lose their constructor kind
   before mono, weakening resource-kind semantics across signatures.
6. High: Aggregate OptIR can reach AArch64 even though AArch64 lowering
   intentionally rejects aggregate operations.
7. High: Lexical import discovery treats invalid nested `use` tokens as real
   module-graph dependencies.
8. Medium: Structural Proof MIR reference validation is incomplete across many
   statement kinds.
9. Medium: Layout authority fingerprints depend on object insertion order in a
   path that should be canonical.
10. Medium: Full-image validation and live QEMU smoke are not part of the
    default handoff gate or CI.
11. Medium: The package/API/CLI surface is not productionized: no exports,
    declarations, bin entry, release metadata, or build output.
12. Medium: The Lean proof model is valuable but explicitly sidecar, incomplete,
    and not gated.

## Release Blockers In Detail

### Critical: Proof MIR CFG Join Truth Is Caller-Controlled

Evidence:

- `src/proof-mir/model/graph.ts:247` stores
  `ProofMirBlock.incomingEdges`.
- `src/proof-mir/validation/graph-validator.ts:87` and `:117` validate
  terminator edge existence and target block references, but the review found no
  validator that derives a predecessor map and proves each block's
  `incomingEdges` exactly matches real terminator edges.
- Proof-check uses `incomingEdges` to decide join behavior in
  `src/proof-check/kernel/graph-worklist-session.ts:76`,
  `src/proof-check/kernel/graph-worklist-session.ts:377`, and
  `src/proof-check/kernel/graph-worklist-join-coordinator.ts:101`.

Impact:

If a buggy or forged Proof MIR program under-reports incoming edges, the checker
can fail to recognize a merge as a join. That threatens convergence checking and
can make branch-sensitive proof facts appear valid when they were only valid on
one incoming path. For a proof-relevant compiler, this is not a cosmetic issue.
It is the kind of stored-truth bug that can invalidate the checker.

Production fix:

- Derive predecessor maps from terminators during validation.
- Reject missing, extra, duplicate, stale, or mismatched `incomingEdges`.
- Reject any terminator edge whose `fromBlockId` is not the current block.
- Prefer making `incomingEdges` an internal derived view rather than an input
  field accepted from builders.

Tests to add:

- A block with two real predecessors and only one stored incoming edge.
- A block with stored incoming edges that no terminator reaches.
- An edge referenced by block A's terminator but whose edge record says
  `fromBlockId` is block B.
- A branch where an obligation is closed only on one path and the forged join
  would otherwise pass.

### High: AArch64 Callee-Saved Registers Can Be Clobbered

Evidence:

- `src/target/aarch64/backend/api/physical-register-model.ts:24` and `:42`
  mark x19-x28 as public callee-saved and allocatable.
- `src/target/aarch64/backend/api/function-pipeline.ts:659` admits allocatable
  GPRs to the allocation pool.
- `tests/unit/target/aarch64/backend/backend-end-to-end.test.ts:121` proves x20
  can be selected.
- `src/target/aarch64/backend/api/function-pipeline.ts:468` only saves x30 for
  call-site boundaries and saves nothing for leaf functions.
- `src/target/aarch64/backend/api/frame-instructions.ts:13` and `:78` only
  save/restore `frame.savedRegisters`.

Impact:

Compiled public functions can assign live values into callee-saved registers and
return without restoring the caller's values. In UEFI or any public ABI context,
that is wrong code. It can corrupt firmware state or caller state while all
compiler-internal tests still pass unless they explicitly model ABI
preservation.

Production fix:

- Derive saved callee-saved GPR/FP registers from actual physical assignments
  plus ABI obligations.
- Include save/restore and unwind metadata for every used callee-saved register.
- Until that is implemented, remove x19-x28 and d8-d15 from allocatable pools at
  public ABI boundaries.
- Add a backend verifier that rejects any assigned public callee-saved register
  absent frame preservation coverage.

Tests to add:

- Force allocation into x19/x20 in a public function and assert prologue and
  epilogue preserve it.
- Force allocation into x19/x20 in a leaf public function.
- Assert private/internal functions still obey their declared calling convention.
- Add binary-level parse tests for save/restore instruction pairs and unwind
  consistency.

### High: Symlink Root Escape In Source Ingestion

Evidence:

- `src/frontend/lexer/bun-file-repository.ts:31` checks
  `realResolved.startsWith(realRoot)`.
- Existing coverage in
  `tests/unit/frontend/lexer/file-repository.test.ts:76` checks a non-prefix
  outside path, but not a prefix sibling such as `root` and `root-evil`.

Impact:

Prefix checks are not path containment checks. A symlink under an allowed source
root can point to a sibling path whose string begins with the same prefix, and
the repository can treat it as inside the root. This is a source-ingestion
boundary violation and becomes a real security concern if the compiler is ever
run on untrusted workspaces, CI inputs, package dependencies, or editor-opened
projects.

Production fix:

- Use `path.relative(realRoot, realResolved)` and reject values that start with
  `..`, are absolute, or cross device/root expectations.
- Apply the same containment rule to both lexical and real paths.
- Normalize case if supporting case-insensitive filesystems.
- Add a regression where `root/link.wr` points at `root-evil/secret.wr`.

### High: Proof MIR Draft Edge Keys Collide

Evidence:

- `src/proof-mir/draft/draft-keys.ts:188` makes `draftControlEdgeKey` depend
  only on `{ functionInstanceId, role }`.
- `src/proof-mir/draft/draft-graph-terminators.ts:175` writes
  `edges.set(edgeKey, ...)` before accepting the key.
- Branch, validation, and panic paths default to singleton roles like
  `branchTrue`, `validationOk`, and `panicExit` at
  `src/proof-mir/draft/draft-graph-terminators.ts:264`, `:338`, and `:463`.
- Lowerers call those APIs without unique roles in
  `src/proof-mir/lower/if-lowerer.ts:519`,
  `src/proof-mir/lower/loop-lowerer.ts:115`, and
  `src/proof-mir/lower/validation-lowerer.ts:759`.

Impact:

Repeated branch or validation sites in the same function can overwrite each
other's draft edges. That can corrupt the Proof MIR graph before validation and
is especially dangerous because graph-level bugs interact with proof checking.

Production fix:

- Make control-edge identity allocator-owned, like normal edges.
- Or key by source block plus arm plus stable site id.
- Reject duplicate edge keys before mutation, not after `Map.set`.

Tests to add:

- Two independent `if` statements in one function.
- Nested loops with validation branches.
- Multiple panic paths from distinct source sites.
- Snapshot checks that every terminator edge has a unique stable id and correct
  source block.

### High: Applied Resource Constructors Lose Their Constructor Kind

Evidence:

- `src/semantic/surface/resource-kind-checker.ts:86` returns a join of argument
  kinds for any applied type with arguments, ignoring whether the constructor is
  `Stream`, `ValidatedBuffer`, `PrivateState`, `UniqueEdgeRoot`, or `EdgePath`.
- `src/semantic/surface/signature-checker.ts:139` and `:353` bake that value
  into parameters and returns.
- Mono has constructor rules in
  `src/semantic/surface/mono-closure-builder.ts:58`.
- `tests/unit/mono/resource-kind-concretizer.test.ts:25` expects
  `appliedConstructor` recovery, while
  `tests/unit/semantic/surface/resource-kind-checker.test.ts:82` currently
  blesses semantic flattening to `Linear`.

Impact:

The compiler can forget that a resource is a special proof/resource constructor
before monomorphization. That is exactly the kind of phase drift that makes a
language look sound in isolated tests but weakens contracts at the boundaries
where functions, generics, and proof metadata meet.

Production fix:

- Carry source constructor-derived resource kind or `appliedConstructor` at the
  semantic/HIR boundary.
- Make the signature checker preserve constructor identity for all proof and
  resource constructors.
- Add source-level tests for generic `Stream[T]`, `ValidatedBuffer[T]`, private
  state types, unique edge roots, and edge paths through HIR and mono.

### High: Aggregate OptIR Reaches AArch64 And Then Fails Closed

Evidence:

- `src/opt-ir/lower/lower-checked-mir.ts:554` emits
  `optIrAggregateExtractOperation`.
- `src/opt-ir/lower/lower-checked-mir.ts:667` emits
  `optIrAggregateConstructOperation`.
- `src/target/aarch64/target-surface/operation-matrix.ts:58` and `:160` mark
  aggregate construct/extract/insert unsupported until layout lowering.
- `src/target/aarch64/lower/operation-materialization.ts:239` fails closed.
- `tests/unit/target/aarch64/semantic-superselection.test.ts:185` asserts the
  rejection.

Impact:

The compiler can successfully move user-facing object construction/projection
through Proof MIR into OptIR, only to reject it at the target. That is a real
incomplete lowering path, not merely a missing optimization.

Production fix:

- Add aggregate-to-layout/memory lowering before AArch64 selection.
- Or introduce a verifier gate after OptIR construction that turns aggregate
  leftovers into source-oriented diagnostics before backend lowering.
- Define aggregate ABI/layout semantics as a target-independent lowering
  contract, then specialize target materialization.

### High: Lexical Import Discovery Treats Nested `use` As Real Input

Evidence:

- `src/frontend/lexer/import-discovery.ts:27` scans every `Use` token lexically.
- `src/frontend/parser/statement-parser.ts:24` does not accept `use` inside
  blocks.
- Package parsing feeds discovered imports into missing-import diagnostics at
  `src/target/uefi-aarch64/package-pipeline.ts:425` and `:464`.

Impact:

Invalid source inside a function can create real module-graph dependencies and
package diagnostics. That means parsing and module graph construction disagree
about the language grammar. Production compilers need imports to be a parsed
top-level construct, not a lexical side effect.

Production fix:

- Discover imports from parsed top-level `ImportDeclaration` nodes.
- Or make import discovery layout-aware and explicitly ignore/reject non-top-level
  `use` tokens.
- Preserve accurate diagnostics for invalid nested imports without mutating the
  dependency graph.

## More Correctness Bugs And Fail-Closed Gaps

### Proof MIR Structural Reference Validation Is Incomplete

Evidence:

- Proof MIR statement types carry many place, value, fact, binding, loan,
  session, packet, and private-state references.
- `src/proof-mir/validation/operand-validator.ts:46` focuses on `call`,
  `attempt`, and `take`.
- The scalar-use collector in
  `src/proof-mir/validation/graph-validator.ts:679` ignores most
  place-bearing statements and records `readValidatedBufferField.result` as a
  use even though it is a definition.
- `src/proof-mir/validation/layout-validator.ts:185` checks layout references
  and terms but not all statement source places or packet places.

Impact:

Malformed Proof MIR can carry stale or invalid references that are not rejected
at the phase boundary. In a proof-sensitive compiler, every referenced id must
be validated structurally before domain-specific proof checking starts.

Production fix:

- Create one central per-statement reference collector.
- Validate every referenced id against the function/program tables.
- Reuse the collector for diagnostics, verifier checks, use-def analysis, and
  future visualization.
- Add negative tests for each statement kind.

### Layout Authority Fingerprints Are Not Canonical Enough

Evidence:

- `src/proof-check/validation/input-validator.ts:58` and `:80` use a local
  `JSON.stringify` helper that only rewrites bigint.
- That value feeds layout authority fingerprints and selected-vs-embedded layout
  comparison at `src/proof-check/validation/input-validator.ts:212` and `:241`.
- `src/shared/stable-json.ts:5` already has canonical serialization that sorts
  object keys and Maps.

Impact:

Two semantically equal layout fact programs with different object property
insertion order can fingerprint differently. That hurts determinism, caching,
golden tests, and authority comparison.

Production fix:

- Replace the local serializer with `stableJson`.
- Add golden tests that permute object property order and Map insertion order.
- Make all authority fingerprints go through one canonicalization module.

### Module Graph Failures Lose Diagnostics

Evidence:

- `src/frontend/lexer/module-graph-lexer.ts:51` marks a module visited before
  read success.
- Missing or unreadable diagnostics are emitted only when `importRequest` exists
  at `src/frontend/lexer/module-graph-lexer.ts:61`.

Impact:

A missing entry module can return no modules and no diagnostics. Multiple import
sites to the same missing module can collapse to the first diagnostic. This is
bad user experience and bad build-system behavior.

Production fix:

- Separate "load attempted" from "loaded successfully."
- Preserve all import-site spans or emit an aggregate diagnostic with every
  referring module.
- Always emit an entry read failure.

### String Lexing Splits One Error Into Two

Evidence:

- `src/frontend/lexer/lexer.ts:522` stops before a backslash followed by newline
  or EOF.
- `src/frontend/lexer/lexer.ts:539` reports an EOF-style unterminated string.
- `src/frontend/lexer/lexer.ts:582` later emits `LEX_INVALID_CHARACTER` for the
  same backslash.

Impact:

One malformed string becomes two unrelated diagnostics. This is not a production
blocker, but it is a signal that recovery spans need more deliberate ownership.

Production fix:

- Consume the escape marker into the string token/error span.
- Emit one diagnostic that includes the escape and explains the invalid trailing
  escape or newline.

### Unsupported Index Diagnostics Point At The Wrong Span

Evidence:

- `src/frontend/parser/expression-parser.ts:258` creates an error node marked at
  `[`, but includes the already-parsed left expression.
- `src/frontend/parser/node-claim.ts:34` assumes the mark is the node start.

Impact:

`foo[0]` can report an unhelpful zero-width diagnostic around the bracket rather
than a clear postfix expression span.

Production fix:

- Mark the full postfix expression start.
- Or report a concrete diagnostic span on bracket/index tokens independent of
  the recovered node range.

### Linker Verification Is Weaker Than PE/COFF Writer Verification

Evidence:

- `src/linker/verifier.ts:141` only rejects a first section below the policy
  RVA.
- `src/pe-coff/pe-file-layout.ts:210` requires the first section to equal
  `firstSectionRva` and later sections to be exactly contiguous by virtual
  order.

Impact:

The writer catches layout contract violations later than the linker verifier.
The normal path may be fine today, but phase-boundary verifiers should enforce
the strongest contract owned by that phase.

Production fix:

- Move exact first-RVA and virtual-order contiguity checks into
  `verifyLinkedImageLayout`.
- Keep the PE writer check as defense in depth.

### Contribution Placement Is Recomputed Only In Tests

Evidence:

- `src/linker/verifier.ts:165` checks each contribution's range and alignment.
- `tests/support/linker/slow-linked-image-validator.ts:85` independently
  recomputes expected contribution offsets and section sizes.
- `tests/unit/linker/linked-image-verifier.test.ts:332` proves the slow
  validator catches offset corruption.

Impact:

The production verifier does not yet contain the strongest independent check
the test suite already knows how to perform.

Production fix:

- Promote the slow validator's independent recomputation into production, or
  share a verifier component used by both production and tests.

### Object Relocation Pair Verification Is Incomplete

Evidence:

- `src/target/aarch64/backend/verify/object-verifier-contract.ts:109` checks
  pair key presence, partner existence, and family compatibility.
- `src/linker/relocation-application.ts:117` and `:488` later check reciprocal
  keys and same resolved target symbol.

Impact:

Malformed object modules can pass object verification and fail later in link
planning. That is better than generating a bad binary, but worse than a clean
phase boundary.

Production fix:

- Enforce reciprocal pair keys and same relocation target in object verification
  too.
- Treat linker checks as a second line of defense.

### Large Stack Frames Fail Late

Evidence:

- `src/target/aarch64/backend/frame/frame-layout.ts:71` and `:89` check slot
  cursor offsets before outgoing args, but not final total stack size
  encodability.
- `src/target/aarch64/backend/api/frame-instructions.ts:98` emits one
  `sub/add sp, #totalSize`.
- `src/target/aarch64/backend/object/encoding-integer-branch.ts:156` accepts an
  immediate only in `0..0xfff`.

Impact:

Large frames can fail during encoding with an opaque backend error instead of a
clear frame-layout diagnostic.

Production fix:

- Validate final `totalSizeBytes` during frame layout.
- Or synthesize multi-instruction stack adjustment for large frames.

## Explicit Stubs, Incomplete Features, And Toy-Mode Edges

This section names the places where the compiler intentionally does less than a
production compiler must do.

### Stream For-Loop Lowering Is Not Implemented

Evidence:

- `src/proof-mir/lower/iterator-lowerer.ts:594` enters `lowerForImpl`.
- The `"stream"` case at `:607` returns `PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD`.
- The diagnostic at `:621` says "Stream for-loop lowering is not implemented in
  the core Proof MIR builder."

Production requirement:

Implement stream loop lowering, or reject stream loops earlier with a
source-level diagnostic and a documented feature gate. Do not let a
source-language construct travel to Proof MIR only to produce an implementation
gap diagnostic.

### OptIR Lowering Does Not Fully Support Switch/Yield

Evidence:

- `src/opt-ir/lower/lower-checked-mir.ts:975` treats a switch without fallback
  as `unsupported-switch` and returns unreachable.
- `src/opt-ir/lower/lower-checked-mir.ts:1025` treats `yield` as unsupported and
  returns unreachable.

Production requirement:

If `yield` is part of the language/proof model, lower it or reject it at a
declared boundary. If switches without fallback are invalid after earlier
normalization, enforce that invariant before OptIR and make the OptIR path
unreachable by construction.

### Generic Image Entries Are Lowered As Error-Shaped Roots

Evidence:

- `src/hir/mono-closure-lowerer.ts:174` synthesizes generic image-entry type
  arguments as `errorCheckedType()`.
- `src/hir/mono-closure-lowerer.ts:196` skips semantic image-entry roots if one
  already exists.
- `tests/integration/hir/lower-typed-hir-orchestration.test.ts:914` asserts the
  placeholder.
- `docs/design/whole-image-monomorphization-design.md:790` says generic image
  entries require concrete external entry root arguments.

Production requirement:

Either reject generic selected image entries at semantic/HIR with a direct
diagnostic, or preserve and validate a concrete `externalEntryRoot`. Error
placeholders should never be a normal path for selected production image roots.

### Compile API Does Not Run Live QEMU Smoke

Evidence:

- `src/target/uefi-aarch64/compile-uefi-aarch64-image.ts:215` implements
  `smokeReportForCompileRequest`.
- `:219` returns disabled when no smoke request is supplied.
- `:227` returns skipped with `qemu-smoke:separate-runner-required` for any
  non-disabled request.

Production requirement:

For release builds, the compiler should have a first-class smoke execution lane
or an explicit artifact handoff contract that CI enforces. A production target
driver should not make live execution look requested while always reporting
"skipped."

### Full-Image Matrix Is Not The Full Scenario Cross Product

Evidence:

- `src/validation/full-image/matrix.ts:1` declares three stdlib modes.
- `src/validation/full-image/matrix.ts:6` declares four scenarios.
- `src/validation/full-image/matrix.ts:41` runs eight cases, not twelve.
- `status-error` and `watchdog-or-boot-policy` run only under
  `toolchain-stdlib`.

Production requirement:

Either cover the full scenario x stdlib-mode matrix or document why the omitted
combinations are impossible and assert that in tests. A world-class validation
matrix makes exclusions explicit.

### The Standard Library Is Only A Seed

Evidence:

- `stdlib/wrela-std/**/*.wr` totals 137 lines.
- Core includes only tiny `result.wr` and `unit.wr`.
- UEFI coverage is a small set of status, console, memory, watchdog, and
  firmware wrappers.

Production requirement:

The stdlib needs a versioned API policy, compatibility tests, docs, examples,
target abstraction boundaries, and source-level conformance tests. A
compiler can be production-grade before the stdlib is huge, but it cannot be
production-grade if the stdlib surface is incidental.

### The Package/API/CLI Surface Is Not Productionized

Evidence:

- `package.json:3` is private.
- `package.json:5` points `module` at `src/index.ts`.
- There is no `exports`, `types`, `bin`, `files`, build script, declaration
  output, or release metadata.
- `tsconfig.json:16` sets `noEmit`.
- The README documents source-tree imports rather than a stable package API.

Production requirement:

Decide whether Wrela6 is a CLI, library, or private compiler component. Then
add:

- A built output directory.
- Type declaration generation.
- Explicit package exports.
- A `bin` entry if users compile from CLI.
- A versioning policy.
- Compatibility tests for the public API.
- A documented package/project layout for real users.

### The Lean Proof Model Is Valuable But Not A Gate

Evidence:

- `proof-model/README.md:3` says the Lean sidecar is early, not the compiler,
  and not the whole language.
- `proof-model/README.md:138` lists deliberate omissions: real Wrela syntax/HIR,
  unbounded CFGs and loop invariants, full validation typing, terminal
  certificate integration, richer arithmetic/dominance/ABI facts, declarative
  completeness, and HIR-to-Proof-MIR lowering preservation.
- The review found no `sorry`, `admit`, `axiom`, `unsafe`, or `partial` tokens
  in `proof-model`, which is good.
- `package.json:7` does not run `lake build Wrela`.

Production requirement:

Either gate the proof model in CI or explicitly label it non-blocking. Add a
coverage matrix mapping each TypeScript checker feature to a Lean model, theorem
status, and known omission. Do not make formal-sounding claims for behavior that
is not modeled.

## Subsystem Review

### Repository, Tooling, And Release Engineering

Strengths:

- `agent:check` is a strong local gate: typecheck, format check, lint, policy
  check, and tests.
- The repo has boundary policy automation in `scripts/check-policy.ts`.
- Tests are broad: 729 tracked TypeScript test files across unit, integration,
  system, audit, fixture, and support layers.
- Full-image validation exists and exercises the pipeline through PE/COFF image
  production.

Problems:

- No `.github` workflow directory exists, so local gates are not enforced
  remotely.
- `agent:check` omits `validate:full-image`.
- Live QEMU smoke is opt-in and not part of normal validation.
- Tool versions are flexible: `@types/bun` uses `latest`, and several dev tools
  use caret ranges.
- Scripts shell out to `bun`; at least one subagent shell did not have `bun` on
  `PATH`.
- `scripts/check-policy.ts:257` uses regex import parsing for import-boundary
  policy, even though TypeScript AST tooling is available.

Production actions:

- Add CI with frozen lockfile install, `bun run agent:check`,
  `bun run validate:full-image --json`, and a release/nightly QEMU lane.
- Pin or deliberately manage dev tool versions.
- Add `packageManager` and engine requirements.
- Rewrite policy import checks using the TypeScript AST.
- Emit exact line/column diagnostics from policy checks.
- Decide how proof-model `lake build Wrela` participates in CI.

### Frontend

Strengths:

- The frontend has an explicit lexer/parser/green-red AST structure.
- Compatibility re-exports under `src/lexer` are clean shims.
- There is meaningful lexer, parser, file repository, and module resolver
  testing.

Problems:

- Source-root containment is vulnerable to symlink prefix escapes.
- Import discovery is lexical rather than parsed top-level syntax.
- Module graph read failures can lose entry and duplicate import-site
  diagnostics.
- String recovery can emit two diagnostics for one malformed trailing escape.
- Unsupported index-expression diagnostics are poorly spanned.
- Parser diagnostic taxonomy is still small and coarse.
- Identifiers and integer literal handling are limited compared with what a
  mature language frontend will need.
- AST declaration views repeat optional-child patterns and expose false
  capabilities like non-enum declarations returning empty `enumCases()`.
- Red-node query APIs allocate wrapper objects repeatedly during semantic-scale
  traversal.

Production actions:

- Harden file repository containment.
- Derive imports from parsed top-level declarations.
- Expand parser diagnostics into source-oriented categories with stable codes.
- Build a frontend conformance corpus with golden tokens, green trees, red AST
  views, and diagnostics.
- Add fuzz/property tests for lexer and parser recovery.
- Cache or stream red-node child access where semantic traversals are hot.
- Remove false interfaces from AST views.

### Semantic, HIR, Mono, And Layout

Strengths:

- The codebase has clear phase names and substantial separation between
  semantic checking, HIR, monomorphization, layout facts, and proof lowering.
- Mono has closed-boundary checking and reachability logic.
- Layout has target-surface concepts and fact tables rather than hard-coded
  direct backend mutation everywhere.

Problems:

- Applied resource constructors can flatten to joined argument kind and lose
  constructor identity.
- Generic image entries use error-shaped placeholder roots.
- Layout's recovered-node guard is narrower than the mono/layout contract.
- `src/layout/image-entry-abi.ts` hard-codes UEFI/std source identity for
  `Result[Never, BootError]`, despite layout design saying source origin should
  not affect generic representation authority.
- The design says mono should publish layout type resolutions, but
  `MonomorphizedHirProgram` does not expose that table and layout reconstructs
  it by scanning.
- Several mono diagnostics use "first origin or 0" fallbacks:
  `src/mono/reachability-shared.ts:55`,
  `src/mono/mono-external-roots.ts:19`,
  `src/mono/function-instantiator-shell.ts:673`, and
  `src/mono/proof-metadata-instance-helpers.ts:342`.

Production actions:

- Make resource-kind constructor identity explicit in semantic and HIR types.
- Replace generic image-entry error placeholders with real entry-root validation
  or early rejection.
- Share one recovered/error-node scanner between mono closed-boundary checks and
  layout.
- Move UEFI boot-result mapping into a target/image-profile ABI contract.
- Either implement mono-published layout resolutions or update the design and
  tests to say layout owns reconstruction.
- Replace arbitrary origin fallbacks with explicit synthetic boundary origins
  or threaded real origins.

### Proof MIR And Proof Check

Strengths:

- Proof MIR is rich enough to represent obligations, validation, attempts,
  terminal behavior, layout facts, and proof-sensitive domains.
- The checker has a worklist/kernel architecture and domain modules.
- There is a Lean sidecar that models important concepts without obvious Lean
  proof holes.

Problems:

- CFG predecessor truth is stored and trusted.
- Draft edge keys can collide.
- Structural reference validation is incomplete.
- Layout fact fingerprints are not canonical enough.
- Stream loop lowering is explicitly unimplemented.
- The production checker surface is wider than Lean coverage.
- Proof files are large enough that adding more rules in place will increase
  bug risk.

Production actions:

- Make graph shape validation derive all CFG facts.
- Centralize reference collection and validation.
- Use canonical stable JSON for all authority fingerprints.
- Add a TypeScript-to-Lean coverage matrix.
- Gate or explicitly de-scope Lean in CI.
- Split proof-check modules by invariant owner before adding new domains.

### OptIR And Optimization

Strengths:

- OptIR exists as a real boundary between proof-checked MIR and target lowering.
- There is evidence of fact preservation, e-graph experimentation, mandatory
  inlining, analysis, pipeline, and construction tests.
- Construction failures appear to fail closed in many test paths.

Problems:

- Aggregate operations can be emitted but are not fully target-lowerable.
- `yield` is unsupported in terminator lowering.
- Switches without fallback lower to unreachable plus a diagnostic.
- `src/opt-ir/operations.ts` is a 1,045-line operation hub.
- Some operation attributes use `Readonly<Record<string, unknown>>`.
- `src/opt-ir/program.ts` uses weak contracts such as `readonly unknown[]` for
  call graph calls and `CheckedFunctionSummary | unknown` for summaries.

Production actions:

- Define typed schemas for every operation kind, attribute set, and summary.
- Add a verifier that rejects unlowered aggregate/yield/switch constructs at the
  right boundary.
- Split operation definitions into typed domains: scalar, memory, aggregate,
  proof-erasure metadata, target facts, calls, and control flow.
- Add round-trip and translation-validation tests for each optimization pass.
- Define optimization levels and a deterministic pass pipeline.

### AArch64 Backend, Linker, PE/COFF, And UEFI Target

Strengths:

- The backend has a real physical register model, frame layout, lowering
  pipeline, object module model, relocation verification, linker, section
  layout, and PE/COFF writer.
- UEFI target validation reaches binary image production.
- There are audit tests and property tests around linker and target policy.

Problems:

- Callee-saved register preservation is incomplete and can cause wrong code.
- Aggregate OptIR lowering is not complete for AArch64.
- Linker verifier is weaker than PE writer layout checks.
- Production contribution placement verification is weaker than the test slow
  validator.
- Object relocation pair verification is weaker than linker application checks.
- Large stack frames can fail late at instruction encoding.
- UEFI compile smoke reports are disabled/skipped rather than integrated.

Production actions:

- Fix ABI preservation before optimizing register allocation further.
- Add backend verifier checks for frame/register/unwind consistency.
- Move stronger layout and relocation checks earlier.
- Promote independent placement recomputation into production.
- Add stack-adjust synthesis for large frames.
- Make QEMU smoke a real CI/release lane.
- Add hardware or emulator conformance tests for public ABI calls.

### Validation, Tests, And Quality Gates

Strengths:

- There are thousands of tests and many negative/fail-closed tests.
- Full-image validation exists.
- Audit tests already encode some maintainability and target constraints.
- `fast-check` is kept in tests, matching the dependency policy.

Problems:

- `agent:check` does not run full-image validation.
- Full-image validation does not cover the full scenario x stdlib matrix.
- QEMU smoke is separate and disabled by default.
- System tests are thin compared with unit/integration coverage.
- There is no remote CI.
- The line-cap audit is narrow and currently focused on `src/mono`.

Production actions:

- Gate every PR with `agent:check` and non-QEMU full-image validation.
- Gate release/nightly builds with QEMU smoke.
- Add proof model build or explicitly mark it informational.
- Add compiler corpus tests: good programs, bad programs, diagnostics,
  full-image artifacts, and byte-level golden artifacts.
- Add fuzzers for lexer/parser/module graph and IR validators.
- Add differential tests for deterministic fingerprints and stable output.
- Add repo-wide maintainability gates for file size, function complexity,
  dependency boundaries, and use of `unknown`/`as never` outside test fixtures.

## Thermo-Nuclear Maintainability Review

The major maintainability risk is not simply "big files." It is big files that
own multiple invariants and weakly typed cross-phase contracts. These are the
files most likely to hide production bugs:

- `src/semantic/names/expression-resolver.ts`: 1,324 lines.
- `src/opt-ir/operations.ts`: 1,045 lines.
- `src/opt-ir/lower/lower-checked-mir.ts`: 1,031 lines.
- `src/target/aarch64/backend/object/layout-encode-fixed-point.ts`: 997 lines.
- `src/proof-check/domains/validation.ts`: 988 lines.
- `src/proof-mir/lower/expression-lowerer.ts`: 982 lines.
- `src/proof-check/kernel/registry/transition-helpers.ts`: 979 lines.
- `src/mono/mono-hir.ts`: 976 lines.
- `src/target/aarch64/backend/object/object-module.ts`: 973 lines.
- `src/target/aarch64/backend/verify/encoding-object-verifier.ts`: 972 lines.
- `src/target/aarch64/lower/lower-function.ts`: 964 lines.
- `src/semantic/names/type-reference-resolver.ts`: 956 lines.
- `src/proof-check/domains/source-calls.ts`: 951 lines.
- `src/proof-check/domains/facts.ts`: 951 lines.
- `src/proof-mir/draft/draft-graph-builder.ts`: 946 lines.
- `src/target/aarch64/backend/api/machine-lowering.ts`: 944 lines.
- `src/proof-check/authority/authority-term-canonicalization.ts`: 943 lines.
- `src/proof-mir/domains/effects-resources.ts`: 931 lines.
- `src/target/uefi-aarch64/runtime-helper-instructions.ts`: 929 lines.
- `src/proof-mir/canonicalization/graph-snapshot-freeze.ts`: 929 lines.
- `src/mono/reachability.ts`: 915 lines.
- `src/proof-mir/lower/local-classifier.ts`: 892 lines.
- `src/proof-check/authority/semantics-companion.ts`: 890 lines.
- `src/mono/function-statement-cloner.ts`: 886 lines.
- `src/semantic/surface/semantic-surface-checker.ts`: 883 lines.
- `src/target/aarch64/backend/api/function-pipeline.ts`: 882 lines.
- `src/proof-check/domains/ownership-transfer.ts`: 882 lines.
- `src/target/uefi-aarch64/package-pipeline.ts`: 879 lines.
- `src/linker/verifier.ts`: 876 lines.

The immediate goal is not to split every file mechanically. The goal is to
split by invariant owner:

- CFG shape and predecessor truth.
- Proof MIR statement reference collection.
- Resource-kind constructor semantics.
- Image entry ABI classification.
- Aggregate layout lowering.
- ABI frame preservation.
- Object relocation pair contracts.
- Linker section placement verification.
- Authority canonicalization/fingerprints.
- UEFI runtime helper code generation.

Specific maintainability smells:

- Layout knows UEFI/stdlib source paths. That is target policy leaking into a
  generic layout phase.
- OptIR operation attributes and program summaries use `unknown` in phase
  contracts.
- Policy checks parse imports with regex.
- AST views expose methods that return empty values for concepts a node cannot
  have.
- Mono code uses fake origin fallbacks instead of explicit origin ownership.
- Test-only slow validators are stronger than production validators.

Thermo-nuclear rule of thumb for this repo: every phase boundary should have a
single authoritative validator, and every validator should derive the facts it
validates from lower-level structure rather than trusting cached fields from a
builder.

## Optimization And Performance Roadmap

The compiler should not chase performance before fixing correctness. Once the
release blockers are fixed, these are the optimization tracks that matter.

### Compiler Throughput

- Add phase timing and memory accounting to full-image validation.
- Cache parsed modules and green trees by content hash.
- Cache semantic item indexes by module graph fingerprint.
- Make monomorphization and layout fact generation deterministic and
  incrementally reusable.
- Use a dependency graph for phase invalidation rather than recompiling the
  whole world for every source edit.
- Add benchmark programs with stable metrics in CI.

### IR Memory And Traversal

- Reduce repeated red-node wrapper allocation during semantic traversal.
- Replace broad `Record<string, unknown>` operation attributes with compact
  typed records.
- Intern high-cardinality ids and stable keys where hot.
- Add structural sharing for immutable graph snapshots only where profiling
  shows churn.

### Optimization Quality

- Define optimization levels: debug/no-opt, checked, release, release-size.
- Specify which proof facts each optimization may consume and must preserve.
- Build a translation-validation harness for every transformation that rewrites
  executable behavior.
- Add target-aware peephole and instruction-selection tests grounded in binary
  encodings.
- Add pass-level determinism tests.

### Backend Quality

- Build a calling-convention test suite for every public ABI class.
- Add register allocation stress tests with forced spills, callee-saved
  pressure, large frames, and call-heavy functions.
- Add relocation overflow and veneer tests at distance boundaries.
- Parse back generated PE/COFF images and compare headers, sections,
  directories, relocations, and entrypoint bytes.

## Diagnostics And User Experience Roadmap

A world-class compiler is judged partly by how well it fails.

Needed improvements:

- Source-level diagnostics for every unsupported feature before low-level IR
  lowering.
- Stable diagnostic codes grouped by phase and user action.
- Multi-span diagnostics for imports, duplicate definitions, and graph/package
  conflicts.
- Recovery that avoids cascaded diagnostics when one malformed token caused the
  problem.
- Suggestions for common syntax mistakes.
- A public diagnostic JSON format.
- A CLI that can emit human, JSON, and editor-friendly diagnostics.
- Golden diagnostic tests that assert spans, codes, labels, and notes.

Specific early wins:

- Nested `use` should produce one parser diagnostic and not affect the module
  graph.
- Missing entry module should always produce an entry diagnostic.
- Unsupported stream loop should fail at source or feature-gate level.
- Generic image entry without concrete args should produce a semantic/HIR
  diagnostic, not an error-shaped mono root.
- Aggregate-not-lowerable should mention the source construct and target
  limitation, not just a backend operation kind.

## Security And Trust Boundary Notes

This was not a dedicated security audit, but several findings have security
shape:

- Symlink source-root escape can read outside intended compiler roots.
- Caller-controlled CFG predecessor truth can undermine proof checking.
- Non-canonical authority fingerprints can destabilize trust decisions.
- Weak object relocation verification can let malformed object modules travel
  deeper than they should.
- Missing CI means local-only safeguards are easy to bypass.

Production security posture should include:

- A threat model for untrusted source packages and build workspaces.
- Hardened file repository containment.
- No filesystem access except compiler edges.
- Deterministic artifact fingerprints.
- Signed or pinned target policy inputs for release builds.
- Fuzzing of source ingestion, module graph, and binary parsers/writers.

## Production CI And Release Gate Proposal

Minimum PR gate:

1. Frozen install.
2. `bun run typecheck`.
3. `bun run format:check`.
4. `bun run lint`.
5. `bun run policy:check`.
6. `bun test`.
7. `bun run validate:full-image --json` with QEMU disabled.
8. No generated diff after tests.

Nightly gate:

1. Minimum PR gate.
2. Full scenario x stdlib matrix.
3. QEMU smoke for every bootable validation case.
4. Proof model `lake build Wrela`, or explicit non-blocking reporting.
5. Parser/module graph fuzz seed corpus.
6. Backend/register allocation stress corpus.
7. PE/COFF parse-back artifact comparison.

Release gate:

1. Nightly gate.
2. Reproducible build on clean machine.
3. Public package/CLI smoke install.
4. Versioned stdlib compatibility check.
5. Signed artifacts or documented provenance.
6. Human review of all new unsupported-feature diagnostics.

## Suggested Fix Order

### Phase 1: Stop Wrong Acceptance And Wrong Code

1. Fix Proof MIR CFG predecessor validation.
2. Fix AArch64 callee-saved register preservation.
3. Fix symlink root containment.
4. Fix draft edge key collisions.
5. Fix resource-kind constructor preservation.
6. Canonicalize layout authority fingerprints.

Exit criteria:

- New negative tests fail before each fix and pass after.
- Full local `agent:check` passes.
- Full-image validation passes.

### Phase 2: Make Phase Boundaries Honest

1. Add central Proof MIR reference validation.
2. Move aggregate lowering or reject it earlier.
3. Replace generic image-entry error placeholders.
4. Move UEFI/std boot result classification out of generic layout.
5. Promote stronger linker/object verifiers into production.
6. Replace regex import policy checks with AST checks.

Exit criteria:

- Every unsupported feature has an explicit source-level or phase-boundary
  diagnostic.
- Test-only validators are no stronger than production validators for critical
  invariants.

### Phase 3: Make The Compiler Shippable

1. Add CI.
2. Add package/CLI/public API surface.
3. Gate full-image validation.
4. Decide proof-model gating.
5. Expand full-image scenario matrix.
6. Add release metadata and reproducibility docs.

Exit criteria:

- A fresh checkout can build, test, validate, and run a smoke compile without
  private local assumptions.
- A release artifact can be consumed through a documented interface.

### Phase 4: Make It World-Class

1. Add incremental compilation architecture.
2. Build a conformance suite.
3. Build an optimization validation framework.
4. Add IDE/editor diagnostics and structured output.
5. Split large invariant hubs.
6. Track performance and artifact determinism over time.

Exit criteria:

- The compiler has stable APIs, stable diagnostics, stable artifacts, and
  measurable performance.
- New language features require updating tests, docs, validators, proof coverage,
  and target lowering contracts before merge.

## Definition Of Done For "Production Compiler"

Wrela6 should not be called production-grade until all of these are true:

- No known wrong-code backend ABI bugs.
- No known proof-check bypass through caller-controlled IR facts.
- No known source-root escape.
- Every IR boundary has a fail-closed validator.
- Unsupported language features fail at source or declared feature-gate level.
- Full-image validation is mandatory.
- QEMU smoke runs in a required lane for release candidates.
- Public package or CLI interface exists and is documented.
- Toolchain versions are pinned or explicitly managed.
- Lean proof coverage is either gated or truthfully labeled as advisory.
- The stdlib has a versioned compatibility policy.
- Diagnostics are stable enough for users and editor integrations.
- Large files are being actively split by invariant owner, not growing by habit.

## Final Assessment

This codebase is no longer a toy in architecture. It has too many real compiler
pieces for that label. But it still has toy-mode assumptions in places that
matter: trusted stored CFG facts, prefix-based source containment, weakly typed
cross-phase operation metadata, skipped smoke execution, and production
validators weaker than test validators.

The best next move is not a broad refactor. The best next move is a correctness
campaign: fix the release blockers, add the missing negative tests, and make
phase boundaries derive and verify their own truth. After that, the compiler can
grow toward production with confidence instead of accumulating clever machinery
on top of unstable contracts.
