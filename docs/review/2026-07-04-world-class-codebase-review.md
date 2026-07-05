# Wrela Whole-Codebase Review — From Production-Capable to World-Class

**Date:** 2026-07-04
**Scope:** every subsystem of `src/` (~235k lines, 1,038 files), `tests/` (~182k lines, 804 files), `scripts/`, `stdlib/`, `proof-model/`, and the package/release surface. Reviewed on branch `remediation` at commit `7ae0fe38`, immediately after the 2026-07-03 World-Class Remediation Plan was completed and verified.
**Method:** full reads of the load-bearing files in each subsystem (lexer, parser core, HIR model, semantic surface checker, mono reachability, all optimizer passes, register allocator, post-RA finalization, entry thunk, module-graph loaders, shared foundations); structural outlines of every remaining directory; repo-wide mechanical sweeps (TODO/FIXME, `as any`/`as never`, `ForTest` leakage, nondeterminism sources, empty catch blocks, silent-fallback `??` patterns); and live gate verification — `bun run agent:check`, non-skip `verify:qemu` (real QEMU boot), and non-skip `verify:lean` all ran green during this review.
**Relationship to prior reviews:** this supersedes the four 2026-07-03 reviews for current-state accuracy. Everything those reviews flagged that the remediation plan fixed is treated as fixed (verified by gates); this document is about what remains between _"production-capable"_ and _"the most elegant, incredible compiler in the world for this use case."_

---

## 0. Executive summary

Wrela is no longer a toy. The remediation waves delivered a real compiler: callee-saved registers are preserved and verified, LICM/SROA/stack-promotion/inlining do real work under a translation-validation differential, the image boots under QEMU with a checksum-correct, conformance-tested PE/COFF, the CLI works from a packed install, and the whole thing is wrapped in an unusually strong determinism-and-audit culture. The gates are honest and they pass.

But "world-class" is a different bar, and against that bar the codebase has a distinctive shape: **the verification machinery is over-built relative to the language and the optimizer.** You have a proof kernel, fact certificates, translation validation, fuzzers, stress lanes, and a Lean model — guarding a language in which a user _cannot write `(a + b) _ c`\*, a standard library that is 146 lines of mostly empty marker classes, a register allocator with no eviction or coalescing, and an end-to-end corpus of nine programs. The scaffolding is world-class; the building inside it is still small.

The top findings, in one paragraph each of severity:

- **One production-adjacent facade survived the remediation sweep**: the post-RA "pair load peephole" (`src/target/aarch64/backend/finalization/peepholes.ts`) fires only when an entire instruction list is _exactly two `ldr` instructions_, checks no addresses or registers, and would drop the second load's operands if it ever fired. It is enabled only by one test; production never turns it on. It is simultaneously dead code, a false AC witness for W5-04c, and a latent miscompile.
- **The language is materially incomplete in ways the compiler is not**: no parenthesized grouping expressions, no index expressions, no enum values (enum payloads have no layout representation), signed integers deferred. These are frontend-week fixes gated behind nothing.
- **A handful of correctness hazards are latent rather than live**: LICM's preheader hoist order assumes block-list order is topological; CFG simplification silently stops at fuel exhaustion; HIR synthesizes neutral values (`0n`, `""`) for malformed nodes instead of error nodes; eight `0 as never` fabricated-ID fallbacks remain.
- **The two biggest architecture debts** are the seven-file hand-written mono cloner family (~3.5k lines that must be edited in sync with every HIR change) and expression type checking living _inside_ HIR lowering instead of a discrete typing phase.
- **The optimizer and backend are honest but shallow**: 17 e-graph rules, 73-line alias analysis, an inliner that refuses any callee containing a store, an allocator with no hints/eviction/coalescing. Nothing lies anymore; there just isn't much there yet.
- **The test suite is deep on units, thin on programs**: 533 unit files vs. 9 end-to-end fixtures and ~20 negative diagnostic cases. The single highest-leverage investment in the whole repo is a source-level program generator feeding the existing differential oracles.

Everything below is organized so it can be converted directly into the next remediation plan: bugs first, then stubs, then language, architecture, backend, performance, diagnostics, tests, and a prioritized roadmap.

---

## 1. What is already world-class (verified, keep and protect)

Credit where due — these are strengths most production compilers don't have, and they should be treated as invariants:

1. **Determinism as law, enforced.** No `Date.now`/`Math.random` anywhere in `src` (swept). Stable sorts and length-aware keys pervade every output path. `stableJson`/`stableDigestHex` handle bigints, Maps, `Uint8Array`, and astral code points correctly. The image reproducibility test and full-image determinism checker pin it.
2. **Fail-closed diagnostic discipline.** The `Diagnostic` contract requires `ownerKey` + `stableDetail` at the type level. Every bare `catch {` I inspected converts to a diagnostic or a `undefined`-that-callers-handle (e.g. `structural-verifier.ts` unknown-opcode → `AARCH64_INSTRUCTION_SCHEMA_MISMATCH`; `packet-envelope-validation.ts` → envelope diagnostic). Throws are reserved for compiler-internal invariants (26 in all of proof-check).
3. **Verifier culture.** Twelve verifier modules in `opt-ir/verify` alone; ABI verifier for callee-saved registers; encoding-object verifier; relocation reciprocity; PE verifier + parser round-trip; linker section-rule parity with the writer; SSA and region verifiers. The compiler distrusts itself in the right places.
4. **The audit layer.** `tests/audit/` enforces line caps with grandfather decay, scar-tissue bans (`as any`, `@ts-ignore`, unstable serialization), plan-quality rules, release-surface honesty (pack → install → `bun x wrela init/build`), and PE/COFF conformance. This is self-defending code health, and it visibly worked — the giant files actually shrank (expression-resolver −782 lines, operations −694, reachability 915 → a 22-line barrel).
5. **A real CST.** Rust-analyzer-style green/red trees with trivia preservation, token interning for fixed lexemes, parser fuel, mark/claim diagnostics, and recovery. The frontend architecture is genuinely good; it is the _language_ that is small (see §4).
6. **External-authority verification lanes.** QEMU boot smoke (ran green, non-skip, during this review), Lean proof model (ditto), 200-case seeded backend stress through the object verifier and machine-IR interpreter differential, parser/lexer fuzzing, canonicalization permutation properties.
7. **Dependency injection with fakes, ending at real edges.** Filesystem access only at compiler edges, realpath-aware symlink containment shared by CLI/validation/scorecard hosts, injected QEMU host effects with skip-aware policy.

The instruction to future work: **nothing below should be fixed in a way that weakens any of these.**

---

## 2. Bugs and correctness hazards, ranked

None of these is a live miscompile on the current fixture corpus (the gates pass). They are ranked by how badly they'd bite when the corpus, the optimizer, or the language grows.

### B1. The post-RA pair-load "peephole" is a facade that would miscompile if enabled

`src/target/aarch64/backend/finalization/peepholes.ts` — `formAArch64PairLoadPeepholes` fires iff `instructions.length === 2 && both opcodes === "ldr"`. It checks no base registers, no offsets, no adjacency, no destination registers, and the "merged" instruction is `{ ...instructions[0], opcode: "ldp" }` — the second load's destination and address are _discarded_. If any 2-instruction schedulable list ever reached it with `enablePeepholes: true`, the emitted code would silently lose a load. Today the only caller passing `enablePeepholes: true` is `tests/unit/target/aarch64/backend/post-ra-scheduler.test.ts:216`; the production pipeline never enables it. Meanwhile the _real_ pair formation — with actual offset-adjacency, cacheability, and opcode checks — lives upstream in `src/target/aarch64/plan/pair-load-store-planning.ts` (371 lines, wired).
**Fix:** delete `peepholes.ts` and the `enablePeepholes` flag entirely, or implement a genuine post-RA pairing pass (sliding window over same-base, offset-adjacent, register-compatible pairs, with the ldp/stp immediate-range check the planner already has). Do not leave a test asserting behavior production can't reach. Also recheck the W5-04c acceptance claim in the remediation plan — it is currently satisfied by the planner, not by this file, and the file's existence misleads.

### B2. LICM appends hoisted operations to the preheader in block-list order, not dependency order

`src/opt-ir/passes/licm.ts:335` (final hoist set ordered by `loopOperationIdsInProgramOrder`, i.e. `function_.blocks` list order) and `licm.ts:402` (append in that order). If a hoistable operation's producer sits in a block that appears _later_ in the block list than its consumer's block — legal SSA whenever the list isn't topologically sorted, and the multi-block inline splicer now inserts cloned blocks — the preheader receives a use before its def. Structured lowering probably emits dominators first today, which is why nothing fails, but that invariant is (a) nowhere stated, (b) nowhere verified, and (c) one inliner/scheduler change away from breaking. There is exactly one LICM unit test (`tests/unit/remediation/w4-02d.test.ts`).
**Fix:** topologically order the hoist set by intra-set def-use edges before appending (cheap: the fixpoint in `selectLoopInvariantOperations` already knows the producer map), or assert the block-list-order invariant in the SSA verifier so violations fail loudly. Add a test with the def in a later-listed block.

### B3. CFG simplification silently under-delivers at fuel exhaustion

`src/opt-ir/passes/cfg-simplification.ts:40` — default fuel 8, and each round performs **at most one** coalesce plus one merge (`coalesceOneLinearJumpBlock`/`mergeOneTrivialBlock` return after the first hit). A wrapper chain longer than ~8 blocks — exactly what heavy inlining produces, and the reason this coalescing was added (the W4-05/W4-11 scorecard interaction) — quietly leaves residue: no diagnostic, no blocked-work report, nothing in the result to say "I stopped early." It is also quadratic: every round rebuilds all block/edge maps to make one change.
**Fix:** per round, collect all non-overlapping candidates from the single scan already performed and apply them together; report `fuelExhausted: true` (or a residue count) in the result and let the pipeline surface it as an info diagnostic. Both the silence and the O(n²) disappear in the same restructure.

### B4. HIR synthesizes neutral values for malformed input instead of error nodes

`src/hir/expression-lowerer.ts:156` — `parseWrIntegerLiteral(text) ?? 0n`: a malformed integer literal that somehow reaches HIR becomes constant **zero** and compilation proceeds. Same pattern at `:120`/`:229`/`:418`/`:569` (`?? ""` for literal text, names, member names, field names) and `:639`/`:742` (`operator: … ?? ""`). Upstream lexer/parser diagnostics _should_ make these unreachable — but HIR has a first-class `error` expression kind built for exactly this, and the compiler's own design principle is fail-closed. A recovered node slipping through any future frontend change becomes a silent wrong-constant or empty-name resolution instead of a hard stop. Related: diagnostic `ownerKey: \`function:${ownerFunctionId ?? 0}\``fabricates owner id 0 (six sites in the same file).
**Fix:** in every`??`fallback on the lowering path, produce`kind: "error"`(with the reason) instead of a neutral value; assert`value !== undefined` for integer literals post-W1-04. This is a mechanical, low-risk sweep — and worth a scar-tissue audit rule (`?? 0n`, `?? ""`banned in`src/hir/\*\*` lowering paths).

### B5. `0 as never` fabricated-ID fallbacks (8 sites)

`src/opt-ir/passes/sccp.ts:294,310,316` (`selected[0] ?? (0 as never)`, `resultIds[0] ?? (0 as never)`), `src/mono/mono-external-roots.ts:22` (`originRecords()[0]?.originId ?? (0 as never)` — a silent first-pick _and_ a fabricated origin in one expression), plus `rule-catalog.ts:215`, `constant-materialization.ts:41`, `machine-instruction.ts:431`, `layout-entailment.ts:313`, `layout-fact-keys.ts:80`, `production-profile.ts:102`. Each manufactures ID `0` typed as `never` when data is unexpectedly missing. If any is ever hit, downstream consumes a phantom entity deterministically — the worst kind of wrong.
**Fix:** replace with explicit invariant throws (compiler-internal) or diagnostics (user-reachable); then ban the `as never` value-fabrication pattern in the scar-tissue audit exactly as `as any` was banned. W1-16f killed this pattern in the name resolvers; finish the job repo-wide.

### B6. Module import discovery has two owners, and the _lexical_ one drives production

`src/frontend/lexer/module-graph-lexer.ts:73` — production module loading discovers imports by token-scanning (`ImportDiscovery`, with hand-rolled indentation-depth tracking to approximate "top-level `use` only"), while the parse-level `src/frontend/module-import-discovery.ts` serves the semantic layer. Two implementations of "what does this module import," one of which re-derives block structure in token space. Any divergence (recovery-affected token streams, future syntax around imports) means the loader loads a different module set than the semantic layer believes exists — phantom or missing modules with confusing downstream diagnostics.
**Fix (code judo):** the loader already lexes every module and the pipeline parses every module anyway. Merge `ModuleGraphLexer` + `parseModuleGraph` into a single loader that lexes _and parses_ each file on discovery and takes imports from the CST — then delete `ImportDiscovery` (258 lines) and its fuzz target, and the divergence class is gone by construction. This also fixes the O(n²) lexer-vs-parser diagnostic dedup in `module-graph-parser.ts:54-57` (deep-equality matching including message strings — a symptom of the two-owner problem).

### B7. Latent-hazard honorable mentions

- **LICM's `loopOperationIds` empty-set-means-everything** (`licm.ts:432`): a caller passing a legitimately empty candidate list gets _all_ loop operations considered. Production computes the same set LICM recomputes internally (see A-6 in §5), so today it's harmless-but-confusing; it's one confused test author away from surprising hoists.
- **Semantic scope lookup is correct on ambiguity** (`scope.ts:101` returns `ambiguous` for >1 match — verified, not a first-pick), but lookup is a linear filter per tier per query; fine now, a hot spot later (§7).
- **`parseJsonRecord` inside `layout-encode-fixed-point.ts:977`** — encode-stage metadata round-trips through JSON strings mid-pipeline. It fails closed, but structured data smuggled as strings inside the object-encode fixed point is a boundary smell that will eventually hide a bug (§5, A-3).

---

## 3. Stubs, facades, and incomplete implementations

The remediation plan explicitly allowed documented partial models. This section is the honest inventory of what is _still_ partial, so nothing masquerades as complete.

| #   | Where                                                                                                                                                      | State                                                                                  | Assessment                                                                                                                                                                                                                                                                                                                                                                              |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------------------------------- |
| S1  | `backend/finalization/peepholes.ts`                                                                                                                        | Facade (see B1)                                                                        | Delete or implement. The only outright facade found in the sweep.                                                                                                                                                                                                                                                                                                                       |
| S2  | Register allocator (`backend/allocation/allocator.ts`, 223 lines)                                                                                          | Real but minimal: priority-greedy, call-boundary splitting, spill fallback             | **No eviction** (W5-02a's "evict lower-weight active intervals" is not present — priority ordering only), **no preferred-register hints, no copy coalescing** (W5-02b — `grep preferred                                                                                                                                                                                                 | hint | coalesce` over allocation finds only live-segment coalescing in liveness.ts). Every call-crossing value pays full move traffic. See §6. |
| S3  | E-graph (`opt-ir/egraph/`, core 69 lines, 17 rules in `rule-catalog.ts`)                                                                                   | Real, tiny                                                                             | A seed equality-saturation engine with fact-gated rules and TV. Honest, but 17 rules is a demo. Growth path: measured rule additions with the TV lane as the safety net.                                                                                                                                                                                                                |
| S4  | Analyses: `alias-analysis.ts` (73 lines), `escape-analysis.ts` (57), `range-analysis.ts` (113), `loop-trip-count.ts` (267)                                 | Real, shallow                                                                          | Alias = class equality + fact queries, sound-conservative. Escape/range are skeletal. Memory optimization and future vectorization will starve without deeper versions.                                                                                                                                                                                                                 |
| S5  | Exotic selection plugins (`select/virtio-ring-selection.ts` 42 lines, `crypto-mix`, `polynomial-pmull`, `checksum-fingerprint`, `packet-superpatterns`, …) | Wired into `semantic-superselector.ts`, hit-rate unknown                               | These are the wrela-unique codegen levers for the packet-appliance thesis — and nothing measures whether they ever fire on real fixtures. Add pattern hit-rate telemetry to the stress/scorecard lane before writing any more of them.                                                                                                                                                  |
| S6  | Stdlib (`stdlib/wrela-std/`, **146 lines total**)                                                                                                          | Marker types                                                                           | `Result[Ok, Err]:` and `Validation[Ok, Err, Source]:` are _empty classes_; `Option[Value]` is `has_value: bool, value: Value` (a struct-with-flag, not a sum type); `Bits[Value]` wraps a value. The "standard library" is a set of compiler-blessed contract markers, not a library. Blocked in part by L3 (§4).                                                                       |
| S7  | `tests/golden/`                                                                                                                                            | 2 non-test files, no tests                                                             | Dead directory. Either build the golden-output lane (§9 recommends it: goldens for diagnostics rendering and disassembly) or delete the directory.                                                                                                                                                                                                                                      |
| S8  | `resetLayoutCertificateIdsForTest` / `resetProofCheckPrivateStateCertificateIdsForTest`                                                                    | Exported no-ops                                                                        | `layout-entailment.ts:68` is literally `// nothing to reset`. Vestigial scaffolding implying global state that no longer exists. Delete both and their call sites.                                                                                                                                                                                                                      |
| S9  | `verify-release.ts` steps `reproducible` and `stdlib-conformance`                                                                                          | Aliases                                                                                | Both are `verify:full-image`, which step 1 (`agent:check`) already ran — the same command executes 3× per release under three names, overstating checklist coverage. Implement a true double-build byte-compare for `reproducible` and a stdlib-fixture subset for `stdlib-conformance`, or collapse the steps.                                                                         |
| S10 | Parallel + incremental compilation                                                                                                                         | Design docs only (`docs/design/parallel-compilation.md`, `incremental-compilation.md`) | Explicitly deferred by plan; noted here so the roadmap (§11) carries them.                                                                                                                                                                                                                                                                                                              |
| S11 | `apply*PatchesForTest` used in production                                                                                                                  | Misnamed, not stubbed                                                                  | `proof-check/domains/validation.ts:980` and `take-session-operations.ts:628` call `applyValidationPatchesForTest`/`applyTakeSessionPatchesForTest` inside real transfer loops. The functions are real; the names claim they aren't. Rename to `applyValidationPatches` (keeping a ForTest alias if tests want the name) before someone "cleans up test helpers" and breaks the checker. |

---

## 4. Language completeness: the compiler is ahead of its language

The proof kernel, the optimizer differential, and the backend verifier are guarding a language surface that is startlingly small. These are not compiler-hardening items; they are "can a systems programmer write normal code" items, and most are days-not-months of frontend work given the machinery already in place.

### L1. There are no parenthesized grouping expressions. At all.

`src/frontend/parser/parser-utils.ts` — `EXPRESSION_STARTER_KINDS` does not contain `LeftParenToken`; `parsePrimaryExpression` (`expression-parser.ts:219`) has no `(` case; there is no `ParenthesizedExpression` in `syntax-kind.ts`. A user literally cannot write `(a + b) * c` — they must introduce a `let` for every sub-expression whose precedence doesn't match the operator table. For a language with 13 binary operators across 7 precedence levels, this is the single most user-visible gap in the entire project. The fix is a dozen lines in the Pratt parser (primary case: consume `(`, `parseExpression`, expect `)`), one syntax kind, one HIR pass-through, and corpus cases. Nothing downstream needs to change — HIR has no parenthesization concept to update.

### L2. No index expressions — currently rejected with fragile special-casing

`expression-parser.ts:268-301` rejects `foo[0]` with `PARSE_UNSUPPORTED_INDEX_EXPRESSION` via hand-built mark surgery (`{ ...mark, offset: mark.offset - left.width }` reaching backwards into node-claim internals, plus a raw `TokenKind` check where every neighboring line speaks `SyntaxKind`). Two problems: (a) the language decision — validated buffers and streams are the blessed access paths, but a systems language whose users handle packets will keep asking for indexed access with proof obligations (`buf[i]` where `i < len` is a fact the proof system can already discharge); (b) the implementation — when indexing lands, this branch is deleted; until then, extract the backward-mark trick into `context.markBefore(node)` so the next disambiguation doesn't copy the arithmetic.

### L3. Enums cannot be values, so the language has no sum types, so the stdlib is markers

`src/layout/aggregate-layout.ts:24-30` — `UNSUPPORTED_SOURCE_KINDS` includes `enumCase` (and `validatedBuffer`, `interface`, `image`, `function`, which are fine). Enum _declarations_ parse and check, but an enum-typed value has no layout representation, which means no enum fields, no enum returns, no `Option`/`Result` as real tagged unions. This is why `stdlib/wrela-std/core/result.wr` is an empty class and `Option` is a bool-and-payload struct (S6). Everything needed exists: the layout engine computes field offsets and padding; switch exhaustiveness is enforced upstream (W3-05); OptIR has aggregate construct/extract/insert and switch terminators. Tag+payload layout (discriminant byte/word + max-payload union with per-case field maps) is the one missing piece, and it unblocks the entire stdlib story. **This is the highest-leverage language item after L1.**

### L4. Signed integers are deferred by recorded RFC (W3-08e)

Fine as an explicit decision — but note the interaction: when they land, `licm-speculation.ts`'s speculatable-operator set, the endian-fold contract, range analysis, and the interpreter all grow signed cases. Budget it as a cross-cutting wave, not a lexer patch.

### L5. Forty-seven keywords are usable as identifiers

`parser-utils.ts` `NAME_TOKEN_KINDS` includes `if`, `while`, `return`, `match`, `let`, `for`, … Statement-level dispatch protects statement positions, but in nested expression contexts a stray keyword silently parses as a `NameExpression` and surfaces later as "unresolved name `match`" instead of a parse error at the site. Soft keywords are a legitimate design choice; _universally_ soft keywords trade error quality for a flexibility nobody asked for. Recommend: split the set into (contextual: `layout`, `derive`, `len`, `at`, …) and (reserved-in-expressions: control-flow keywords), and let `parsePrimaryExpression` reject the reserved ones with a targeted message ("`match` is a keyword; rename the variable").

### L6. Strings exist only as static CHAR16 literals

The `utf16_static` intrinsic → constant pool → `.rodata` path (W5-07) is solid for firmware console output, but there is no runtime string/bytes type, no slicing, no formatting. For the appliance use case this may be _correct_ scope — but then say so in `happy.md` as a design ruling (the way `pub` and recursion were ruled), so it reads as a decision rather than an absence.

### L7. Miscellaneous surface gaps worth explicit rulings

- **No block comments** (line comments only) — fine; rule it.
- **ASCII-only identifiers** (`isIdentifierStart` in lexer.ts) — fine for firmware; rule it.
- **Eager `>>` lexing** (`COMPOUND_OPERATORS` in lexer.ts) — harmless today because generics use `[T]`, but the day any angle-bracket syntax appears, remember maximal munch already ate it.
- **Chained comparisons are rejected with a diagnostic** (expression-parser.ts:169-177) — genuinely good design; keep.
- **Import cycles are a warning** (`module-graph-lexer.ts:120-131`, `LEX_IMPORT_CYCLE`, edge skipped) — given the language forbids recursion (W3-07), silently _skipping_ the back-edge and continuing seems inconsistent; consider making module cycles an error with the cycle path printed (recursion-cycle-diagnostics already knows how to render cycles).

---

## 5. Architecture: the load-bearing critiques

### A1. The mono cloner family is seven hand-written tree walkers that must never drift

`src/mono/function-statement-cloner.ts` (886 lines, 16-case switch), `function-expression-cloner.ts` (777), `function-call-cloner.ts`, `function-place-cloner.ts`, `function-validation-statement-cloner.ts`, `function-instantiator-body.ts`, `function-instantiator-shell.ts` (679) — ~3.5k lines whose only job is "deep-copy HIR with substitutions applied." Every HIR node kind addition or field change requires synchronized edits across up to seven files, and a missed field clones stale data _silently_ (the exact bug class W1-08 hit in the OptIR inliner's substitution). Mono has the lowest test-file density of any subsystem (16 unit files for 13k lines).
**Recommendation (code judo):** write one generic HIR rewriter — a single structural fold with per-node hooks (`onType`, `onPlace`, `onCallTarget`, `onLocalId`) — and express instantiation as substitution hooks over it. The seven cloners collapse into one mechanical traversal plus ~200 lines of substitution logic; exhaustiveness comes from one `switch` the type checker enforces, not seven. This also gives HIR a reusable visitor for future passes (the layout-expression instantiator and proof-metadata instantiator would ride the same spine). This is the largest single maintainability win available in the repo.

### A2. Expression type checking lives inside HIR lowering

`semantic/surface` checks declarations, signatures, and fields; expression-level typing happens _during_ `hir/expression-lowerer.ts` + `expression-type-diagnostics.ts` (operand checks, literal defaulting, generic inference in `hir/generic-inference.ts`). Consequences: type rules are entangled with lowering mechanics; there is no typed-AST artifact between "parsed" and "lowered" for tools (a future LSP has nowhere to ask "what is the type of this expression" without running lowering); and testing type rules requires driving the lowerer. World-class compilers separate "check + annotate" from "lower." **Recommendation:** carve a bidirectional expression checker out of the lowerer that produces a type-annotated view keyed by CST node, and make the lowerer a consumer of it. Do it incrementally — comparisons/binaries first (the rules already live in `expression-type-diagnostics.ts`), calls last (generic inference is the hard mass).

### A3. The proof layers treat canonical strings as both identity and data — and parse them back

Length-prefixed canonical keys are the right call for determinism and hashing. But `transition-helpers.ts:284` (`parseProofMirPlaceIdPrefix(placeKey)`) re-parses structure out of keys, draft-graph roles are open `role: string` fields threaded through `draft-keys.ts`, and the object-encode fixed point round-trips metadata through JSON strings (`layout-encode-fixed-point.ts:977`). Once a string is parsed back, the serialization _is_ the schema — silently. **Recommendation:** adopt one rule: structured values travel as typed objects with a `canonicalKey()` serialization used only for identity/ordering/hashing; nothing ever parses a key. Where a role/reason is semantically closed (draft edge roles, fact-transfer reasons — W4-09 already did this for the latter), make it a union type.

### A4. OptIR sidecars are smuggled through structural typing

`scalar-replacement.ts:8-11` extends `OptIrProgram` with optional `operations`/`optimizationRegions` and probes with `"operations" in program && Array.isArray(…)` (`:251`), falling back silently when absent. Stack promotion plays the same game. The pipeline state (`pipeline-state.ts`) is the honest owner of these sidecars — put them there as required, typed fields and pass them explicitly; delete `OptIrProgramWithOptimizationSidecars` and the `as OptIrOperation` re-cast at `:247`.

### A5. The inliner manufactures fake candidates to feed its decision log

`whole-program-inlining.ts:201-208`: non-inlinable effect-boundary calls become candidates with `callee: caller` and a lying `operation as SourceCallOperation` cast, purely so the denial logger fires later. Log the denial at scan time or make the candidate type a union; both the bogus self-candidate and the cast disappear.

### A6. LICM's candidate input is redundant plumbing

The pipeline precomputes loop-block operation IDs (`licm-loop-candidates.ts` builds the loop forest), passes them to `runLicm` — which builds the _same_ loop forest again and intersects (`licm.ts:432`, with the empty-set-means-all hazard of B7). Delete the input and the helper file; LICM self-derives. If tests want restriction, give them an explicitly named `restrictToOperationIds` with no empty-set inversion.

### A7. HIR's model leans on optionality and strings where unions should be

- `operator: string` on unary/binary/comparison nodes — downstream code string-matches operators as far away as `opt-ir/lower/lower-checked-mir.ts:612`. Close it: `type HirBinaryOperator = "add" | "sub" | …`.
- `HirCallExpression` carries `calleeFunctionId?`, `ownerTypeId?`, `receiver?`, `recovered?`, and name expressions carry `localId?/functionId?/parameterId?` — three optional resolutions encoding a five-state union implicitly. A `resolution: { kind: "local" | "parameter" | "function" | "unresolved" | "error", … }` field makes illegal states unrepresentable and deletes downstream `if (x !== undefined)` ladders.
- `HirLiteralValue` integer `value?: bigint` — post-W1-04 this should be required (B4's fix makes it so).

### A8. Semantic surface checker: triple build and one dead call

`semantic-surface-checker.ts` calls `builder.build()` at `:195`, `:384` (result discarded — dead statement), and `:394`. W7-03d's memoization makes the cost fine, but the _shape_ — snapshot, keep mutating builder, snapshot again — invites aliasing confusion between `checkedProgramBeforeProof` and the final program. Delete the dead `:384` call; longer term, split the function into `checkDeclarations() → CheckedCore` and `attachProofSurface(core) → CheckedProgram` so each snapshot is a real phase boundary. (Also: `typeRecord.typeId!` non-null assertions at `:85-86` — use a flatMap guard.)

### A9. Small structural debts (fix opportunistically)

- **deterministic-sort daisy chain:** `hir`/`opt-ir`/`mono` re-export `compareCodeUnitStrings` _via `semantic/surface`_ instead of `shared/`; `layout/deterministic-sort.ts` keeps a bespoke duplicate comparator under a `BESPOKE` marker (only its length-delimited formatter is genuinely bespoke); `shared/diagnostics.ts:40` has a private fourth copy. One canonical import, please.
- **`ForTest` naming in production paths** (S11) plus 53 files exporting `*ForTest` wrappers — most are legitimate seams, but the convention needs a policy line: ForTest functions must not appear in production call graphs (auditable by grep).
- **`ParsedModule`/`LexedModule`/`ModuleGraphLexResult` fields are not `readonly`** — the only house-style break of its kind found in `src`.
- **`CollectingDiagnosticSink.get diagnostics`** copies the array on every access; return a frozen view or document the copy.
- **`package-pipeline.ts:434-481`** conditional-spread optional contract-ID fields threaded through three files, two never-passed `existingIds` parameters, `(left as number)` sorts — tighten when next touched (already flagged in the remediation review).
- **`verify-release` sequentialism** is fine (release is rare), but the alias steps (S9) are not.

---

## 6. Backend deep dive: from "correct" to "good code"

The backend's correctness story is strong (verifiers, differential, stress lane, conformance tests). Its _code quality_ story — the machine code it emits — is early. This section is the codegen-quality roadmap.

### 6.1 Register allocation (`backend/allocation/`)

Current algorithm (allocator.ts, 223 lines): sort intervals by must-allocate/loop-depth/spill-cost/density, then greedily assign the first non-conflicting register, splitting at call-boundary cut points, else spill (or fail for no-spill). Assessment:

- **No eviction / second chance.** Once assigned, an interval keeps its register even if a later, hotter interval must spill. The priority sort approximates the right order globally but cannot fix local mistakes. W5-02a's ledger says eviction landed; the code says it didn't. Reconcile the claim, then implement: when no register is free, compare the candidate's spill weight against the cheapest overlapping assignment and evict if the candidate is hotter.
- **No preferred-register hints, no copy coalescing.** Parallel-copy resolution (`move-resolution.ts`, correct, cycle-aware) cleans up after allocation, but nothing _avoids_ the moves: values feeding call arguments should be hinted toward their ABI registers, copy-related intervals toward each other. Hints alone typically eliminate a large fraction of move traffic. Wire `requiredPhysicalRegister` (exists, hard) with a soft `preferredPhysicalRegister` sibling honored in the candidate ordering.
- **Compile-time complexity:** the availability check is `candidatePhysicalRegisters.find(c => !segments.some(overlaps…))` — O(intervals × registers × segments). Fine at nine fixtures; a wall at real program sizes. A per-register sorted-segment list (or classic active/inactive linear-scan bookkeeping) makes it near-linear.
- **FP/SIMD saves are single** (per the W5-01 note) — add the FP pair-store surface so `d8-d15` saves use `stp`.

### 6.2 Inlining (`opt-ir/passes/whole-program-inlining.ts`)

`operationIsInlineSafe` (`:337-348`) denies inlining for any callee containing a _non-call operation that is not runtime-pure_ — i.e., **any callee with a store never inlines**. Combined with the no-recursion language rule (call graphs are DAGs — the ideal inlining situation!), this leaves the single biggest scalar-perf lever mostly unpulled. The splice engine already handles multi-block CFGs, returns-as-merge-parameters, and budget/SCC/escape denials; memory keys and effect tokens exist in the machine-dependency layer. Extend safety to effectful straight-line callees (stores are fine to inline as long as ordering is preserved — which the splice preserves by construction), keeping denials for terminal effects and runtime calls. Expect this to matter more than every peephole combined.

### 6.3 LICM conservatism (documented, next steps)

The final LICM is real (natural loops, preheader insertion, dominance-checked operands, purity/speculation split in `licm-speculation.ts`). Next rungs, in order: (1) hoist checked arithmetic when a dominating guard proves in-range (range analysis is 113 lines today — grow it for exactly this); (2) region-safe load hoisting driven by the fact system (`regionSafeOperationIds` input exists, nothing produces it in production yet); (3) fix B2 first. Note `integerBinaryOperatorIsSpeculatable(operator: unknown)` should take the typed operator union; and verify shift semantics are mask-defined (they're currently speculated — if wrela ever defines shift-overflow as trapping, this becomes a soundness bug).

### 6.4 Selection and scheduling

- The plugin superselector + 23 selection modules is a good architecture with an evidence gap (S5): add hit-rate counters through the stress lane and scorecard before expanding the catalog.
- Pre-RA and post-RA schedulers are wired (list scheduling over dependency islands). The island model serializes at every boundary instruction — measure before improving, but expect barriers/memoryKey totality (W5-04a) to be the binding constraint, not the heuristic.
- Dominance (`opt-ir/analyses/dominance.ts`) is iterative set-based — O(n²) sets, recomputed _per loop_ inside LICM's `selectLoopInvariantOperations`. Switch to Cooper-Harvey-Kennedy on RPO with idom arrays, compute once per function, share.

### 6.5 The hand-written TCB

`src/target/uefi-aarch64/runtime-helper-instructions.ts` (929 lines) and the entry thunk are hand-authored instruction sequences. The thunk's x29/x30 frame discipline is now correct (`stp-x29-x30-frame`/`ldp`/`ret` verified at `entry-thunk.ts:317-359`), goldens pin the bytes, and the smoke boots. But goldens detect _change_, not _incorrectness_. Two escalation paths, either fine: run the runtime helpers through the machine-IR interpreter differential as fixed programs (cheap, catches semantic drift), or — the world-class endgame — compile them from wrela source and delete the hand-transcription.

---

## 7. Performance program

Nothing in the pipeline is pathological at the current nine-fixture scale, and determinism was correctly prioritized over speed. But the compile-time cost model has a shape — several independent quadratics plus universal sequentialism — that will make the first real user program (hundreds of functions, dozens of modules) feel abrupt. Fix opportunistically, in this order of expected payoff:

**Compile time (throughput):**

1. **Parallelize module loading and per-function backend work.** `ModuleGraphLexer.traverse` awaits one file read at a time; every pipeline stage is a sequential `for` over functions. The function pipeline (lower → allocate → frame → encode) is embarrassingly parallel per function, and determinism is preserved by keying results, not by processing order. The parallel-compilation design doc exists; this is the first slice worth building.
2. **Allocator availability check** — O(intervals × registers × segments) (§6.1). Per-register sorted segment lists.
3. **Dominance** — set-based iterative, recomputed per loop inside LICM (§6.4). CHK on RPO, once per function.
4. **Frontend diagnostic dedup** — `module-graph-parser.ts:54` is O(lexer-diags × parser-diags) with message-string equality; dissolves with B6's single-owner fix.
5. **Pipeline diagnostic accumulation** — `pipeline-steps.ts` re-spreads the full diagnostics array per step; push into one mutable array owned by the pipeline state.
6. **Small hot-path allocations:** `parseWrIntegerLiteral` builds RegExps per call (`shared/integer-literal.ts`); scope lookup filters linearly per tier per query (`scope.ts:97`) — build per-tier Maps in `build()`; `moveOperationsToPreheader` runs `blocks.find(…includes…)` per hoisted op — one op→block index; SROA `allLiveReferencesMatchCandidateFields` scans all operations per candidate — group by region once.
7. **Incremental compilation** — design-doc stage (S10). The fingerprint discipline the codebase already has (checked-type fingerprints, stable digests) is exactly the keying an incremental layer needs; this is closer than it looks.

**Generated code (the scorecard's job):**

1. Inline effectful straight-line callees (§6.2) — expected largest single win.
2. Register hints + copy coalescing (§6.1) — kills move traffic around calls.
3. Eviction in the allocator (§6.1).
4. FP pair saves; extend pair planning coverage.
5. Guard-proven checked-arithmetic hoisting in LICM (§6.3).
6. Grow the e-graph catalog with TV as the net (S3).
7. Measure selection-plugin hit rates before writing more plugins (S5).

**Measurement gap:** `verify:scorecard` tracks object/section sizes — good regression tripwire, blind to speed. Add a QEMU cycle-count (or instruction-count via `-icount`) smoke to the extended lane so runtime performance regressions become visible before anyone benchmarks by hand.

---

## 8. Diagnostics and developer experience

The renderer (W6-02), unresolved-name suggestions, source-location preservation through the target envelope (W2-06), and the proof-divergence recipes doc are a strong base. Gaps, in impact order:

1. **Parser messages leak enum names.** `parser-context.ts:62` → "Expected RightParenToken." Users should read "expected `)`". One `humanTokenName(SyntaxKind)` table, used by `expect()` and friends. (The W6-02 renderer formats _placement_; the message _text_ is born wrong at the parse layer.)
2. **Keyword-as-name softness** (L5) turns "you used a keyword" into "unresolved name" one phase later.
3. **`Expected a statement separator.`** and similar block-parser messages could name what was found and point at the previous statement's end — the claim system has the spans.
4. **The `error` cascade:** HIR error expressions carry `reason: string` — surface these in the renderer when an error type propagates, so users see the root cause, not three knock-on diagnostics. (Check whether knock-on suppression exists; the corpus has few multi-error cases to prove it.)
5. **CLI/manifest**: `wrela.toml` fails closed on unknown keys (good); `wrela init` refuses to overwrite (good). Next: `wrela build --emit` artifact names and the validate report deserve a `--json` contract doc, since the validation JSON is already the machine surface scripts consume.

---

## 9. The test suite, reviewed as a product

**Inventory:** 533 unit test files (121.6k lines), 137 integration (24.8k), 3 system files (0.6k), 121 support files (32.2k), 9 audit suites (2.4k). 11,418 `expect(` calls; ~3.8% boolean-blob assertions (`toBe(true)`/`toBeTruthy`) — healthy specificity. Fuzzing: lexer, module-graph lexer, import discovery, parser (fuel + reconstruct oracle), canonicalization permutation properties, 200-case seeded backend stress, 50-case straight-line interpreter differential. That machinery is genuinely good.

**The strategic imbalance:** the end-to-end surface is nine full-image fixtures (`packet-counter` ×3 variants, `smoke-console`, `status-error`, `stdlib-bits`, `stdlib-core-option-result`, `two-branch-control-flow`, `watchdog-or-boot-policy`), ~20 diagnostics-corpus cases, and 109 `.wr` files repo-wide. The unit layer proves each gear turns; almost nothing proves the gearbox on novel programs. Every future language feature (L1-L4) multiplies the untested cross-product.

**Recommendations, in leverage order:**

1. **Source-level program generation.** The single highest-leverage test investment available: a seeded generator emitting valid `.wr` programs (the grammar is small — this is days, not weeks), compiled and run through the _existing_ opt-ir interpreter differential (W4-01 lanes) and, sampled, through QEMU. This converts the world-class oracle infrastructure from "guards nine programs" to "guards the language."
2. **Grow the diagnostics corpus 10×.** Every diagnostic code in every registry should have at least one corpus case asserting code + span + count. Mechanical: enumerate registries, diff against corpus expectations, fail the audit on uncovered codes (the corpus runner already prints readable diffs).
3. **Retire ticket-named tests.** 52 files named `w4-02d.test.ts` etc. are opaque the day the plan doc archives. Rename to behavior (`licm-preheader-hoisting.test.ts`), keep task IDs inside `describe()` strings for traceability.
4. **Support-fixture giants:** `tests/support/mono/monomorphization-fixtures.ts` (1,715 lines), `optimized-opt-ir-fixtures.ts` (1,142), `layout-fixtures.ts` (1,074), `mir-mutations.ts` (1,018). The audit's line caps don't reach `tests/`; these builders are becoming their own maintenance problem and — worse — fixture builders this large drift from what production constructs. Prefer builders composed from the _production_ constructors (many already are) and split by scenario.
5. **Coverage density skew:** mono has 16 unit files for 13k lines — the lowest ratio in the repo, covering exactly the hand-written cloner family (A1). Either the generic rewriter lands (shrinking what needs testing) or mono needs a cloning property suite (clone-then-compare-structure against the identity substitution).
6. **`tests/golden/` is dead** (2 stray files, no tests). Adopt it for the two things goldens are best at — rendered diagnostic output and disassembly of the nine fixtures — or delete it.
7. **System tier honesty:** `tests/system/` holds only the diagnostics corpus and one frontend test; the real system tests live in `src/validation/full-image` + `verify:qemu`. Fine — but write that tiering down in `tests/README` so nobody "fixes" it by duplication.

---

## 10. Determinism, security, and the TCB

- **Determinism:** no violations found in sweep; the discipline is real (§1.1). One watch item: `stableHash` (FNV-1a over code points) is used for identity in hot paths — fine, but document that it is _not_ collision-resistant and must never gate a security decision (the SHA-256 `stableDigestHex` exists for those).
- **Hand-transcribed TCB:** firmware table offsets, runtime helper instructions (929 lines), entry thunk — pinned by goldens and the UEFI TCB reference checker, boot-verified by QEMU. §6.5 gives the escalation path (interpreter differential now, self-hosted helpers eventually). The r18 finding (x30 clobber) is verifiably fixed in the committed thunk.
- **Symlink containment** is realpath-aware everywhere hosts touch the filesystem (verified in package traversal and validation hosts).
- **Constant-time/secret-taint discipline** (the r16 design finding) remains design-stage: `machine-ir/security.ts` and the security verifier exist, `secretRegionKey` threads through scheduling, but there is no end-to-end "secret in, timing-invariant code out" test. If the appliance thesis ever touches keys, this graduates from design note to work item.
- **UEFI conformance:** DYNAMIC_BASE deliberately absent, NX_COMPAT deliberately unset with a recorded decision, checksum real, `.reloc` correct, watchdog handled (`watchdog-or-boot-policy` fixture). This layer is in good shape.

---

## 11. Prioritized roadmap: the distance to world-class

**P0 — truth and latent correctness (days, do before any new feature):**

1. Delete or implement the post-RA peephole (B1); reconcile the W5-04c claim.
2. Dependency-order LICM hoists or verify the block-order invariant (B2).
3. Make CFG simplification fuel exhaustion loud and batch its per-round work (B3).
4. Sweep HIR neutral-value fallbacks into error nodes (B4); audit-ban the pattern.
5. Replace the eight `0 as never` fabrications (B5); audit-ban.
6. Rename `apply*PatchesForTest` production call sites (S11); delete no-op reset scaffolding (S8).

**P1 — the language stops being the bottleneck (weeks):** 7. Parenthesized expressions (L1). A user-visible embarrassment with a one-day fix. 8. Enum value layout → real sum types → rewrite `Option`/`Result` as tagged unions and give the stdlib actual combinators (L3 + S6). This is the single biggest step from "toy" to "language." 9. Unify import discovery on the parser; delete lexical discovery (B6). 10. Decide index expressions (L2) — implement with proof obligations, or rule them out in happy.md with the same formality as `pub`. 11. Grow the diagnostics corpus to full code coverage (§9.2).

**P2 — the optimizer and backend earn their scaffolding (weeks-months):** 12. Inline effectful callees (§6.2). 13. Allocator: hints → coalescing → eviction, in that order (§6.1). 14. Source-level program generator through the differential lanes (§9.1) — land this _before_ 12-13 so they're born guarded. 15. Range analysis + guard-proven LICM hoisting; region-safe load facts production-wired (§6.3). 16. Selection-plugin hit-rate telemetry; prune or prove the exotic plugins (S5). 17. Cycle-count QEMU perf smoke in the extended lane (§7).

**P3 — architecture consolidation (schedule with feature work, not instead of it):** 18. Generic HIR rewriter replacing the mono cloner family (A1). 19. Discrete expression-typing phase extracted from HIR lowering (A2). 20. Typed sidecars in pipeline state (A4); typed HIR operators and resolution unions (A7); key-parsing eliminated (A3). 21. Parallel per-function backend + module loading (§7.1), then the incremental layer (S10).

**P4 — the endgame markers:** 22. Self-hosted runtime helpers (§6.5). 23. Signed integers as the planned cross-cutting wave (L4). 24. An LSP fed by the typed-AST artifact from item 19 — the reason A2 is a product decision, not aesthetics. 25. Constant-time verification lane if secrets enter scope (§10).

A note on sequencing philosophy: the codebase's greatest asset is that its verification lanes make aggressive change _safe_. The correct strategy is therefore unusual — do the ambitious things (sum types, inlining, allocator) _sooner_, because the differential/TV/stress/QEMU net is already strung. Most compilers can't afford that order. This one can.

---

## Appendix A. Small-nit ledger (fix on touch, no tickets needed)

- `shared/integer-literal.ts` — precompile digit regexes.
- `shared/diagnostics.ts:40` — import `compareCodeUnitStrings` from `./deterministic-sort` instead of redefining.
- `frontend/parser/expression-parser.ts:314` — name the `999` binding power (`PRIMARY_ONLY_BINDING_POWER`).
- `frontend/parser/expression-parser.ts:417` — `parseTypeArgumentListInExpression` duplicates `parseDelimitedList` semantics bespokely; extend the helper with a `skipStrayCommas` option instead.
- `frontend/module-graph-parser.ts` / `module-graph-lexer.ts` — add `readonly` to `ParsedModule`, `ParsedModuleGraph`, `LexedModule`, `ModuleGraphLexResult` fields.
- `frontend/lexer/module-graph-lexer.ts:120` — consider error (not warning) for import cycles, with rendered cycle path (§4 L7).
- `semantic/surface/semantic-surface-checker.ts:384` — delete the discarded `builder.build()`.
- `semantic/surface/semantic-surface-checker.ts:85-86` — replace `typeId!` with a flatMap guard.
- `semantic/names/scope.ts` — per-tier `Map<namespace:name, candidates>` built once in `build()`.
- `hir/expression-lowerer.ts` — six `ownerKey: function:${id ?? 0}` sites; thread the real owner or use an explicit `"<unowned>"` sentinel.
- `opt-ir/passes/licm-speculation.ts:38` — type `operator` as the operator union, not `unknown`.
- `opt-ir/passes/whole-program-inlining.ts:373-407` — `removeUnreferencedInlinedCallees` evaluates the same filter predicate twice (operations, then functions); compute the removal set once.
- `opt-ir/passes/pipeline-state.ts:233` — `Object.keys(input as unknown as Record<string, unknown>)`; give the input a probing-friendly type instead of the double cast.
- `target/uefi-aarch64/package-pipeline.ts:449-481` — drop never-passed `existingIds` params; add `compareTypeIds` instead of `(x as number)` sorts.
- `cli` — no findings; the module split (13 files, max 182 lines) is the healthiest new subsystem in the repo.
- `docs/` — `thermonuclear-codebase-review.md` and `world-class-compiler-production-review.md` at the docs root are 2026-07-03 inputs now fully superseded; move under `docs/review/archive/` so the review directory tells a linear story.

## Appendix B. Subsystem scorecard

| Subsystem      | Lines     | Verdict                                               | Blocking gap to world-class            |
| -------------- | --------- | ----------------------------------------------------- | -------------------------------------- |
| shared         | 0.5k      | Excellent                                             | —                                      |
| frontend       | 8.0k      | Architecture excellent, language small                | L1/L2; B6 dual discovery               |
| hir            | 9.9k      | Good model, string/optional debt                      | A7 unions; B4 fallbacks; A2 extraction |
| semantic       | 13.8k     | Good                                                  | A2; A8 build discipline                |
| mono           | 13.0k     | Works, highest structural risk                        | A1 cloner family; lowest test density  |
| layout         | 10.8k     | Solid                                                 | L3 enum representation                 |
| proof-mir      | 34.4k     | Solid, key-string debt                                | A3                                     |
| proof-check    | 36.9k     | Strong; production limits properly profile-owned      | A3; S11 naming                         |
| opt-ir         | 36.3k     | Honest, shallow                                       | §6.2 inlining; S3/S4 depth; B2/B3      |
| target/aarch64 | 40k       | Correctness strong, quality early                     | §6.1 allocator; B1; S5 evidence        |
| target/uefi    | 11.7k     | Good; thunk fixed; conformance real                   | §6.5 TCB escalation                    |
| linker/pe-coff | 10.6k     | Strong (verifier parity, checksum, reloc reciprocity) | —                                      |
| validation     | 5.9k      | Strong harness                                        | §7 perf smoke                          |
| cli            | 1.2k      | Excellent                                             | —                                      |
| stdlib         | 146 lines | **Markers, not a library**                            | S6/L3                                  |
| tests          | 182k      | Deep units, thin programs                             | §9.1 generator; corpus 10×             |

_End of review._
