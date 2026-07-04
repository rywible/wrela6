# Whole-Codebase Production-Readiness Review

**Date:** 2026-07-03
**Scope:** every subsystem in `src/` (224,143 lines / 969 TypeScript files), `stdlib/`, `proof-model/`, `scripts/`, and the structure of `tests/` (170,270 lines / 609 test files).
**Question answered:** what separates this codebase, today, from a production, world-class compiler — concretely: bugs that need fixing, stubs and incomplete parts, and optimizations that need to be filled out.

**Method.** Full traversal in pipeline order (frontend → semantic → hir → mono → layout → proof-mir → proof-check → opt-ir → target/aarch64 backend → linker → pe-coff → uefi-aarch64 driver → validation), with complete reads of the core algorithm files in each subsystem, cross-cutting greps for stub/quality markers over all of `src`, and empirical probes run against the real parser to confirm suspected frontend bugs. Claims marked **VERIFIED** were reproduced by executing code during this review; claims marked **suspected** are from code reading and need a confirming test. The full test suite was run: **4,784 tests, 0 failures, 957,087 assertions, 9.0s.** The review was completed in two passes on the same day: Part I (§1–§12) covers the frontend through the binary pipeline; Part II (§13–§16) closes out mono, layout, and the proof-mir/proof-check interiors.

---

## 1. Executive summary

This is not a toy in the pejorative sense — it is an unusually disciplined codebase with real architecture: a lossless Roslyn-style green/red syntax tree, a staged semantic surface with deterministic diagnostics ordering everywhere, a proof-oriented MIR with a fact kernel, a 26-entry contracted optimization schedule with structural verification at cluster boundaries, a genuinely staged AArch64 backend (ABI reconciliation → liveness → allocation → spill repair → frame → encode → object → link), a PE writer that round-trips its own output through its own parser and verifier, a Lean proof model with zero `sorry`s, and a green 4,784-test suite. Marker hygiene is excellent: across 224K lines there are ~162 TODO-adjacent hits and most are false positives on domain vocabulary ("temporary", "placeholder"); exactly one honest "not implemented" exists.

What makes it a toy _today_ is concentrated in five places:

1. **The language front door leaks.** Top-level tokens that don't start a declaration are parsed as expression statements and then _dropped by every later phase with no diagnostic_ — `pub fn f()` and even `banana zebra unicorn` at top level compile silently (VERIFIED). String escape sequences are never validated anywhere; the one consumer that decodes them uses `JSON.parse` with a silent fallback (VERIFIED). Hex literals don't exist and `0x1F` silently parses as two adjacent tokens (VERIFIED).
2. **The optimizer's mid-tier is a set of facades.** LICM, scalar replacement, and stack promotion all return the input program unchanged while emitting "rewrite records" that suggest work happened. Inlining is real but restricted to single-block, pure-op callees — which, in a language whose semantics funnel everything through small functions, is _the_ performance ceiling.
3. **The register allocator is first-fit linear scan with no callee-saved save/restore.** x19–x28 are in the allocatable pool, the frame layout only ever saves x30, and nothing consumes the declared `publicCalleeSavedGprs` obligations — a latent firmware-state-corrupting miscompile that fires as soon as register pressure exceeds ~16 live GPRs in an exported function.
4. **The scheduler and peepholes are built but switched off.** The post-RA dependency-island scheduler runs with default options that make it the identity permutation, and the ldp/stp pairing peephole is behind a flag that the production pipeline never sets.
5. **The stdlib is 137 lines** across 7 files, with `class Result[Ok, Err]:` as an _empty_ marker class, and there is **no CLI** — the compiler is invocable only as a library or via two repo scripts.

None of these are architectural flaws. The pipeline shape, the determinism discipline, the verification hooks, and the test culture are exactly what a production compiler needs. The gap is that a large fraction of the _declared_ machinery (schedule entries, plan records, model fields, catalog capabilities) is not yet _load-bearing_, and the language surface has correctness holes that the proof system cannot see because they happen before or beside it.

### Subsystem scorecard

| Subsystem                   | Lines           | Verdict                        | Biggest gap                                                                |
| --------------------------- | --------------- | ------------------------------ | -------------------------------------------------------------------------- |
| frontend (lexer/parser/AST) | 7.3K + shims    | Solid core, leaky edges        | Top-level garbage silently ignored; no hex/bit-ops/escapes                 |
| semantic                    | 12.9K           | Strong                         | Contract inference keyed to bare type names; shadowing precedence          |
| hir                         | 9.4K            | Adequate                       | Binary-op typing unchecked; string literals carry raw lexemes              |
| mono                        | 13.0K           | Real, well-guarded             | All recursion banned (undocumented?); JS-stack-recursive walk (§13)        |
| layout                      | 10.8K           | Real, correct bigint math      | Declaration-order only, no padding-minimizing reorder (§14)                |
| proof-mir                   | 31.8K           | Real                           | `yield` **and** stream loops feature-gated; no target enables either (§15) |
| proof-check                 | 36.5K           | Real, rigorously fail-closed   | Divergent-join rejection = expressiveness cliff (§16)                      |
| opt-ir                      | 34.0K           | Half real, half facade         | LICM/SROA/stack-promotion no-ops; single-block inliner                     |
| target/aarch64 backend      | ~38K            | Real pipeline, thin algorithms | No callee-saved saves; identity scheduling; first-fit RA                   |
| uefi-aarch64 driver         | ~12K            | Real                           | Fabricated .pdata/.xdata; static-string side-table architecture            |
| linker + pe-coff            | 11.1K           | Strongest subsystem            | PE checksum = 0 (blocks signing)                                           |
| validation (full-image)     | 5.8K            | Real                           | miscompile-confidence implementation not started (empty dir)               |
| stdlib                      | 137 lines       | Skeleton                       | Everything                                                                 |
| proof-model (Lean)          | 4.7K            | Real, 0 `sorry`                | Coverage vs. current ProofMIR unmeasured                                   |
| tests                       | 170K, 609 files | Excellent                      | No end-to-end negative-diagnostic corpus for the frontend holes above      |

---

## 2. Confirmed and suspected bugs

Ordered by severity. Each entry: what happens, where, evidence, and the fix direction.

### BUG-1 (VERIFIED, high): top-level non-declarations are silently discarded

**Where:** `src/frontend/parser/source-file-parser.ts` (falls through to `tryParseStatement`), `src/semantic/names/expression-resolver.ts:123-136` (only declarations are walked), `src/semantic/item-index/*` (only declarations are indexed).

A top-level line that doesn't start a declaration is parsed as an _expression statement_. The parser accepts it without diagnostics; the item index doesn't collect it; name resolution only walks declaration bodies; HIR lowering iterates functions. Net effect: the statement vanishes.

Empirical probe (this review):

- `pub fn helper() -> u32: …` → **0 diagnostics**. `pub` is not in the keyword table (`src/frontend/lexer/keyword-table.ts`), is not a function modifier (`function-signature-parser.ts:9-17`), and is swallowed as a stray top-level name expression.
- `banana zebra unicorn` on a line before a valid function → **0 diagnostics**.

Two aggravating facts: (a) **the shipped stdlib itself uses `pub fn`** (`stdlib/wrela-std/target/uefi/console.wr:5`), i.e. the standard library is written in a dialect the language does not have, and it compiles only because of this hole; (b) any typo'd declaration head (`fnn`, `clas`, a stray paste) degrades to silence instead of an error.

**Fix:** decide whether `pub` exists (add to keyword table + modifier list + semantic meaning, or delete it from the stdlib), and make the source-file parser reject top-level expression statements (or make semantic surface checking walk and reject them). Add a fixture test that garbage at top level fails.

### BUG-2 (VERIFIED, high): string escape sequences are never validated, and decoding is wrong where it exists

**Where:** `src/frontend/lexer/lexer.ts:522-532` (lexer skips `\<any>` pairs without validating), `src/hir/expression-lowerer.ts:163-183` (HIR string literal stores the **raw lexeme including surrounding quotes** as the value), `src/semantic/surface/compiler-intrinsic-collector.ts:148-158` (the only decoder).

The only place a string literal is ever decoded is the compiler-intrinsic collector for `utf16_static`, and it does this:

```ts
const parsed = JSON.parse(text) as unknown;      // JSON escape semantics, not the language's
...
} catch {
  return text.slice(1, -1);                       // silent fallback keeps raw backslashes
}
```

Probe: `let s = "\q oops"` → **0 diagnostics** end to end. Under JSON decode `\q` is a parse error, so the fallback silently produces the literal characters `\q oops`. There is no language-defined escape grammar enforced anywhere: `\n` works by JSON coincidence, `\xNN`/`\u{…}` don't exist, invalid escapes pass silently.

Meanwhile ordinary (non-intrinsic) HIR string literals carry `"hello"` _with quotes_ as their value. Today nothing else consumes string values at runtime, so the bug is latent — but any future consumer (string equality, match on strings, a second intrinsic) inherits a wrong value silently.

**Fix:** define the escape grammar in the lexer (validate during `scanString`, report `LEX_INVALID_ESCAPE`), decode once into the token/AST (cooked value alongside the lexeme), delete the `JSON.parse` and the quote-stripping fallback, and make the HIR literal carry the cooked value.

### BUG-3 (high, latent miscompile): callee-saved registers are allocatable but never saved

**Where:** `src/target/aarch64/backend/api/physical-register-model.ts:44-48` (x0–x28 allocatable except x18/x29/x30), `src/target/aarch64/backend/api/function-pipeline.ts:468-476` (`savedRegisters: boundaries.length === 0 ? [] : ["x30"]` — the frame only ever saves x30), and the fact that `publicCalleeSavedGprs` (x19–x28, declared at `physical-register-model.ts:27`) has **no consumer** that generates save/restore or excludes those registers from the pool for exported functions.

The pool is ordered by encoding number, so first-fit exhausts x0–x17 first; the bug fires once >~16 GPR-class values are live across a range in any function reachable from the UEFI entry — then x19+ is handed out, clobbered, and returned dirty to firmware. Current fixtures are small, so tests stay green. The private-convention machinery has `calleeSaveObligations` fields (`closed-image-backend-plan.ts:58`), but the _public_ boundary classification result is computed (`classifyAArch64PublicAbiBoundary`) and then never used to constrain allocation or frame layout.

**Fix (either is sound; do the first now):**

1. Exclude x19–x28 from the allocatable pool for any function on a public/exported boundary (one-line pool filter), or
2. Implement proper callee-saved handling: track which callee-saved registers allocation actually used, extend `layoutAArch64StackFrame`'s `savedRegisters` with them, and let the prologue/epilogue finalizer emit the stp/ldp pairs. Add an ABI-verifier check that fails if any assigned segment uses a callee-saved register that the frame doesn't save (this belongs in `verify/abi-verifier.ts`, which already exists).

### BUG-4 (VERIFIED at parse level, medium): adjacent-token expressions parse without a separator diagnostic; hex literals dissolve

**Where:** `src/frontend/lexer/lexer.ts:456-478` (`scanInteger` is decimal-only), block/expression statement parsing.

Probe: `return 0x1F` → **0 parse diagnostics**. It lexes as integer `0` followed by identifier `x1F`; the parser accepts `return 0` and then a second statement `x1F` on the same line without requiring a newline between statements. Inside a body, name resolution will later flag `x1F` as unresolved — a misleading error far from the real cause. For a systems language whose whole domain is MMIO offsets, GUIDs, and protocol constants, missing hex literals is both an ergonomics hole (see §4) and, via this parse laxity, a correctness trap.

**Fix:** (a) add `0x`/`0b` literals with `_` separators to `scanInteger`; (b) make statement parsing require a newline/dedent boundary between statements and report `PARSE_EXPECTED_NEWLINE` otherwise.

### BUG-5 (suspected, medium-high): whole-program inlining mis-substitutes callees that return a parameter

**Where:** `src/opt-ir/passes/whole-program-inlining.ts:348-367` (`buildValueSubstitution`).

The substitution map sets `param → arg` for each entry parameter, then `returnValue → resultId` for each returned value. If the callee returns one of its own parameters (`fn f(x): …; return x`), the second insertion **overwrites** the first, so every cloned operation that used `x` as an operand is rewritten to the _call's result id_ — which after call deletion is defined by nothing (or, for `let y = x + 1; return x`, defined _after_ its use). A zero-op identity callee similarly leaves the caller's result id with no defining operation. The structural verifier that runs after scope-expansion mutations (`verifyPipelineState`, dominance + metadata recompute) should catch the dangling-def case as a hard pipeline error rather than a silent miscompile, but either way the pass is wrong for this shape.

**Fix:** treat return-of-parameter (and any return value not defined by a cloned op) by emitting an explicit copy op `resultId ← substituted(returnValue)` instead of aliasing via the map; add a unit test with an identity callee and a use-then-return callee.

### BUG-6 (medium): the wrela endian-collapse optimization can never fire

**Where:** `src/opt-ir/passes/pipeline-steps.ts:414-422`.

`runWrelaCluster` passes a hardcoded contract to `runWrelaEndianParserCollapse`:

```ts
targetContract: { permitsFirmwareEndianFold: false, permitsVolatileEndianFold: false }
```

The real target surface is available in the enclosing pipeline (`input.target` is threaded to the vectorization steps two functions away) but is not consulted here, so the endian/parser-collapse rewrites are permanently disabled regardless of what the target permits. Either wire `input.target` through and derive the contract from it, or delete the pass from the schedule until it can be honest.

### BUG-7 (medium): attempt/validation contracts are inferred from bare type _names_

**Where:** `src/semantic/surface/semantic-surface-checker.ts:272-286` (`appliedSourceConstructorName` compares `index.type(...)?.name` to `"Result"`, `"Validation"`, `"Attempt"`) and the derivations at lines 341-494.

Any _user-defined_ generic type that happens to be named `Result` with two arguments acquires attempt-contract semantics; same for `Validation`/`Attempt`. The check requires `constructor.kind === "source"`, which is exactly what a user type is — the stdlib's `Result` is itself just source (an empty marker class; see §5). Contract-bearing types must be identified by module identity (the `wrela_std.core` item id resolved through the import graph), not by string name. This is the same class of issue the platform certifier already solves correctly with catalog ids — reuse that discipline.

### BUG-8 (medium, likely): block-local names do not shadow outer bindings

**Where:** `src/semantic/names/expression-resolver.ts:527-536` (and the callee variant at 598-625).

`resolveSimpleNameExpression` consults `context.scope.lookupValue(name)` (parameters, member scope, module items, imports) **before** checking `context.localNames`. Block-locals introduced by `let`/patterns are tracked only as a bare name set used to _suppress "unresolved" diagnostics_. Consequence: `let x = …` where `x` collides with a module-level function or parameter resolves subsequent `x` references to the outer item, not the local. If the language intends to forbid shadowing, nothing enforces that either (no duplicate diagnostic for local-vs-module collisions). HIR lowering has its own local scope and may mask some cases, but reference records (used by proof surfaces and HIR member completion) are wrong whenever the names collide.

**Fix:** make locals a real scope tier consulted first (they already have spans available at binding sites), or implement and test an explicit no-shadowing rule with a diagnostic.

### BUG-9 (low-medium): entry-thunk unwind data is fabricated

**Where:** `src/target/uefi-aarch64/entry-thunk.ts:409-416`.

```ts
function entryThunkXdataBytes(frameShape: string): readonly number[] {
  const frameShapeByte = stableHash(frameShape).charCodeAt(0) & 0xff;
  return Object.freeze([1, FRAME_SIZE_BYTES, frameShapeByte, 0xe4]);
}
```

`.xdata` content includes a **hash byte**, and `.pdata`'s second word is `1 + index` — neither is a valid ARM64 exception-data record per the PE ARM64 unwind spec. UEFI loaders don't unwind, so images boot; but any debugger, crash analyzer, or signing/validation tool that parses unwind info will read garbage that _looks_ populated. Prefer honest emptiness (omit the records) or correct minimal unwind codes for the known 48-byte frame-record prologue. Note the thunk's actual code is now correct — the earlier design-review ABI bugs (bl clobbering x30 with a naked `ret`; x0/x1 not preserved across the init call) are fixed by the framed-call plan with the 48-byte frame.

### BUG-10 (low): pattern diagnostics pick the wrong span for repeated segment names

**Where:** `src/semantic/names/expression-resolver.ts:1190` — `segTexts.indexOf(memberName)` returns the _first_ occurrence, so `A.b.b` attributes the second `b`'s member reference to the first `b`'s span. Iterate by index, not by value.

### BUG-11 (low): image-name expressions silently become error-typed

**Where:** `src/hir/expression-lowerer.ts:307-315`. When a name resolves to an image, the lowerer emits a `name` expression with `errorCheckedType()` and **no diagnostic**; `reportTypeMismatch` deliberately skips error types, so misuse of an image name in expression position vanishes. Emit a diagnostic ("image name is not a value") instead.

### BUG-12 (low, typing gap): binary arithmetic never checks operand types

**Where:** `src/hir/expression-lowerer.ts:680-715`. `lowerBinaryLike` types the result as `left.type` with no check that `right.type` matches, that either side is an integer type, or that the operator applies. `"s" + 5` types as `string`; mismatches surface only if an outer expected-type exists, and then with the generic message. Same for unary minus on the (unsigned-only) integer types (`lowerUnary`, lines 658-678). Proof-mir/opt-ir will reject some shapes later, but the type error belongs here with a real message.

### Additional small defects

- **`resolveModuleQualifiedChain` takes `matchedItems[0]` silently** on multi-match instead of reporting ambiguity (`expression-resolver.ts:864`); duplicate-checking upstream probably prevents it, but the silent first-pick will hide future regressions.
- **Integer literal defaulting:** in unconstrained contexts literals default to `u32` and are range-checked against that default (`expression-lowerer.ts:183-196`), so `let x = 5000000000` is an out-of-range error even though u64 holds it. Infer from use or default to u64 with a narrowing check.
- **PE checksum is hardcoded 0** (`src/pe-coff/pe-file-layout.ts:796`). Fine for unsigned UEFI boot, but the standard PE checksum algorithm is required for signed images (Secure Boot) — implement it in the writer (it already re-parses its output, so verifying it is one more check).
- **Entry-thunk relocation plan offsets are hardcoded** (20/36/48 at `entry-thunk.ts:483-509`) while the object factory independently re-derives offsets by byte-walking (`entry-thunk.ts:206-223`) — two sources of truth; the plan constants will silently rot the first time an instruction is added. Derive the plan from the encoded walk.

---

## 3. Stubs, facades, and switched-off machinery

The codebase's most distinctive failure mode is **the honest facade**: a pass/stage with real types, real determinism, real diagnostics, real tests — that doesn't do the thing its name says. These are worse than TODOs because the pipeline _looks_ complete: schedule entries exist, decision logs record "accepted", rewrite records are emitted. Inventory, ranked by cost of the illusion:

### 3.1 Optimizer facades (opt-ir)

| Pass                          | File                                         | Reality                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ----------------------------- | -------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LICM**                      | `src/opt-ir/passes/licm.ts:55`               | Returns `program: input.program` **unchanged**. Classifies operations as moved/blocked and emits `effectBoundaryEquivalence` rewrite records, but never hoists anything. Its pipeline harness compounds the fiction: `runLicmStep` (`pipeline-steps.ts:370-406`) passes **all operations in program order** as `loopOperationIds` (not loop members) and all memory loads as `regionSafeOperationIds`. And the classification itself never checks operand loop-invariance — if this were ever wired to actually move code, it would be unsound as written. Needs: real loop tree input, invariance check (operands defined outside loop), preheader insertion, actual block edits. |
| **Scalar replacement (SROA)** | `src/opt-ir/passes/scalar-replacement.ts:66` | Returns program unchanged; emits `replacedRegionIds` + records only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Stack promotion**           | `src/opt-ir/passes/stack-promotion.ts:58`    | Returns program unchanged; escape analysis is consulted, promotion never happens.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **vector-idiom-prep**         | `pipeline-steps.ts:550-570`                  | Diagnostics-only: counts SLP candidates, discards the result, and the subsequent SLP step recomputes the same discovery.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

By contrast, these are **real and verified during this review**: constant folding/scalar simplification, SCCP, DCE, copy propagation, CFG simplification, **GVN** (now removes ops and rewrites uses/terminators/edges — fixed since the 2026-07-01 review), memory optimization (exact-range load-forwarding + DSE with value-forward copy propagation), mandatory + whole-program inlining (with the shape limits below), whole-program specialization, the fact-gated e-graph materialization, and SLP/loop-vector **materialization** (real `replaceSpan` block rewrites with lane-shuffle extraction — also new since 07-01).

### 3.2 Inlining shape limits (the single biggest performance ceiling)

`src/opt-ir/passes/whole-program-inlining.ts:258` — any callee with `blocks.length !== 1` is denied (`inline:denied:rewrite-legality`); callee operations must be runtime-pure or non-terminal platform/intrinsic calls (`operationIsInlineSafe`, line 420-428); callees containing source calls are denied. Mandatory inlining has the same single-block shape. In a language where user code is a web of small functions with `require` blocks and Result-returning helpers, _nothing with an `if` inlines_. This blocks: cross-function constant propagation, the wrela-cluster patterns seeing through helpers, load-forwarding across call boundaries, and essentially all of the cost-model wins the design docs promise. The closed-world guarantee (whole image, no dynamic linking, no external callers except the entry) makes a real multi-block inliner _simpler_ than usual — no profitability cliff, no ABI hazards for private conventions. This is the highest-leverage single work item in the optimizer.

### 3.3 Backend machinery built but not enabled

- **Post-RA scheduler runs as identity.** `scheduleAArch64PostAllocation` is a real dependency-island list scheduler with NZCV/FPCR/memory-key/register edges — but `function-pipeline.ts:550-567` calls it without `preferLoadLatencyHiding` and without `enablePeepholes`, so the ready-list tiebreak is `originalIndex` and the output order is provably the input order. The **ldp/stp pair-forming peephole** (`finalization/peepholes.ts`) is therefore dead code in production.
  - Caution before enabling: dependence edges for memory are keyed on `memoryKey` equality only — two instructions _without_ memory keys get no ordering edge (`post-ra-scheduler.ts:204-213`). That's safe while the scheduler is identity; it is exactly the "edge-completeness vs edge-preservation" trap flagged in the codegen design review. Enabling reordering requires either total memory-key coverage or a conservative "unkeyed memory ops are barriers" rule, plus scheduler-verifier hardening.
- **Pre-RA planning artifacts don't drive emission.** `plan/pre-ra-scheduler.ts`, `plan/pair-load-store-planning.ts`, `plan/adrp-page-base-cse.ts`, `plan/post-selection-cse.ts`, `plan/rematerialization-marking.ts`, `plan/machine-dependency-graph.ts` produce plan records; emission in `lower/operation-materialization.ts` remains 1:1 macro expansion. (Same finding as the 07-01 review; unchanged.)
- **Rematerialization accepts only 16-bit constants.** `spill-remat.ts:90-111` rejects `page-base`, `literal`, and `movz-movk` authority kinds outright and `isMoveWideImmediate` limits constant remat to `0..0xffff`. Everything else spills.
- **QEMU smoke inside the compile driver is a stub result:** `compile-uefi-aarch64-image.ts:215-233` returns `status: "skipped", stableDetail: "qemu-smoke:separate-runner-required"` unless disabled; the real smoke lives only in `scripts/smoke-uefi-aarch64.ts`. Fine as a design, but the in-artifact smoke report shape suggests more than it delivers.

### 3.4 Genuinely missing implementations

- **Stream `for`-loops and `yield`** — the one honest "not implemented" in the tree plus its sibling: `src/proof-mir/lower/iterator-lowerer.ts:617-629` rejects `for … in <stream>`, and `function-lowerer.ts:353` gates `yield` behind the `coroutineYield` target feature (`extensions/extension-gates.ts`). The UEFI target's runtime catalog declares `features: []` (`src/target/uefi-aarch64/runtime-catalog.ts:139`), so **neither construct compiles on the only target that exists**, despite `stream`, `edge`, `take`, and `yield` all being fully supported in the grammar, HIR, and mono. `take` works; stream iteration and generators do not. See §15 for the frontend-rejection recommendation.
- **miscompile-confidence implementation: not started.** The design (`docs/design/miscompile-confidence-design.md`) is converged after four review rounds; `tests/unit/validation/miscompile-confidence/` exists and is **empty**. The seeds exist (`src/opt-ir/interpreter.ts`, `src/target/aarch64/interpreter/machine-ir-interpreter.ts`, `machine-ir-differential.ts`), but the 5-level oracle chain, generated-program differentials, and the allocation-TV production check are all future work. Until it lands, the only semantic backstop for the optimizer is the structural verifier + the fixture suite.
- **No CLI.** There is no `wrelac`/`bin` entry point; `process.argv` appears only in `scripts/validate-full-image.ts`. Compiling a program requires importing `compileUefiAArch64Image` or running repo scripts. A production compiler needs: a CLI with stable exit codes, `--emit` selection (tokens/ast/hir/proof-mir/opt-ir/asm/object/image), diagnostics rendering (see §8), file-based package input discovery, and machine-readable (JSON/SARIF) diagnostic output.
- **Fixed-fuel schedules stand in for convergence detection.** Cleanup fixpoints run `fixedRounds(4-6)` regardless of change (`pass-order-policy.ts:71-76`); dispatch collapses `construction-cleanup`/`post-mandatory-cleanup`/`final-cleanup` to the same `runCleanupCluster`, and the `constant-folding` pass id actually dispatches `runScalarSimplificationStep` (`pipeline-dispatch.ts:42-71`) — declared schedule and executed code drift.

---

## 4. Language completeness gaps (compiler-visible)

These are language-design-level, but each has a concrete compiler cost today. Verified against `keyword-table.ts`, `syntax-kind.ts`, `expression-parser.ts`, and probe runs.

1. **No hex/binary integer literals** (BUG-4). MMIO offsets, GUID halves, protocol constants, and register masks are the target domain's native vocabulary.
2. **No bitwise operators at all** — no `& | ^ << >> ~` tokens exist, and no `and/or` either; `BINARY_OPERATORS` is `* / % + -` plus comparisons (`expression-parser.ts:34-76`), `not` is the only logical operator, and there are no stdlib bit intrinsics to compensate (the stdlib is 137 lines; §5). A firmware language that cannot mask a status register field forces every driver author through `platform fn` escape hatches.
3. **No signed integer types.** `maximumIntegerValue` (`hir/expression-lowerer.ts:134-143`) knows u8/u16/u32/u64/usize only. UEFI itself is UINTN-centric, so booting works, but device math (deltas, error codes, offsets) will need signed arithmetic or explicit wrap conventions.
4. **No boolean literals in the grammar** — `true`/`false` are magic _identifier strings_ special-cased in the resolver (`expression-resolver.ts:521`) and HIR (`expression-lowerer.ts:258`). `let true = 1` is presumably parseable. Make them keywords.
5. **Indexing is explicitly unsupported** — `x[0]` parses to an ErrorNode by design (`expression-parser.ts:258-287`). Fine as a proof-driven choice (validated buffers replace raw indexing), but the diagnostic is a generic "Unexpected token"; say _why_ and point at the validated-buffer path.
6. **No block comments, no doc comments.** `//` only (`lexer.ts:362`). Doc tooling will want `///` at minimum.
7. **String escapes undefined** (BUG-2) and **no char literals**; **no float literals** (may be permanently out of scope for the target — document it as a decision, not an absence).
8. **First-class function values are untyped** — a function reference types as core `Function` with no signature (`expression-lowerer.ts:317-331`). Either remove function-as-value from the surface or give it a real arrow type; the current state type-checks nothing.
9. **`pub` does not exist** yet the stdlib uses it (BUG-1). Visibility (`private` keyword exists for classes/functions) needs a decided, enforced story at module level.
10. **Import surface duplication:** `ImportDiscovery` re-implements the `use X from mod` grammar at token level for the module-graph pre-pass (`import-discovery.ts`), separate from the real `ImportDeclaration` parser — any grammar evolution must now be made twice, and the two already differ in edge handling (ImportDiscovery treats _any_ `use` token anywhere as an import head).

---

## 5. The stdlib is a placeholder

Total: **137 lines across 7 files.** `stdlib/wrela-std/core/result.wr` in its entirety:

```
// Ordinary stdlib source wrapper; target authority comes from certified platform contracts.
class Result[Ok, Err]:
```

An _empty_ generic marker class — no cases, no constructors, no combinators. `Unit` likewise. The UEFI modules wrap a handful of `platform fn`s (console output, watchdog, memory, firmware tables, status). This is coherent with the certified-platform-contract design (semantics come from the catalog, not source bodies), but a production language needs: Result/Option construction and matching in _source_, integer/bit utilities, slice/buffer views over validated buffers, formatting for diagnostics/console (even minimal hex printing), and enough of a prelude that fixture programs stop hand-rolling `uefi_status.wr` copies per fixture (the full-image fixtures each carry their own parallel stdlib — `tests/fixtures/full-image-validation/*/toolchain-stdlib/src/packet_counter/uefi_status.wr` etc.).

Also note BUG-7 interacts here: since stdlib `Result` is an ordinary source class, the name-keyed contract inference means _any_ user `Result` is contract-bearing. Stdlib identity (module path pinning) is the fix for both.

---

## 6. Optimizer deep-dive: from "passes exist" to "passes pay rent"

### 6.1 Current state, honestly labeled

The production schedule (`src/opt-ir/policy/pass-order-policy.ts`) declares 26 entries across 11 stages with requires/produces facts, fuel policies, an analysis-invalidation matrix, and per-cluster structural verification (`verifyPipelineState` recomputes dominance and operation metadata after every mutating cluster — this is real and catches malformed rewrites as hard errors). The dispatch layer (`pipeline-dispatch.ts`) executes them with policy gates (`enableMandatoryInlining`, `enableWholeProgramSpecialization`, `enableFactGatedRewrites`, `enableVectorization`).

What each stage does today:

- **Real transforms:** SCCP, constant folding/scalar simplification, DCE, GVN (dominance-aware, canonical value replacement with cycle guard), copy propagation, CFG simplification, load-store forwarding + DSE (exact-range, with value-forward copy prop), mandatory inlining, whole-program inlining/specialization (single-block shape), fact-gated e-graph materialization (worklist-capped at 1200), SLP + certified loop vectorization with real span-replacement materialization.
- **Facades:** LICM, scalar replacement, stack promotion (§3.1) — the entire `memory-region-optimization` stage beyond load/store forwarding is currently decorative.
- **Narrow:** loop-vector materialization handles only `memoryLoad → vectorLoad/vectorMaskedLoad` pairs (`vector-materialization.ts:236-252`); arithmetic and stores in vectorized loops stay scalar, so "vectorized" loops today are load-widening only.

### 6.2 The ranked lever list (unchanged in substance from the 2026-07-01 perf review, updated for the new pass structure)

1. **Real multi-block inlining** (master key; §3.2). With the closed world, implement as: callee CFG splice with block-id/value-id remapping, single return-merge block, edge-table rewrite; keep the budget machinery that already exists (`policy/expansion-budget.ts` is real). Then let the existing cleanup fixpoints do their jobs across the newly merged bodies.
2. **Alias analysis that spends the ownership guarantee.** The language's affine ownership + validated-buffer discipline makes "distinct places don't alias" a _theorem_, not a heuristic. The memory optimizer's exact-range matching should widen to place-keyed disjointness (`opt-ir/lower/proof-mir-place-aliases.ts` already carries place identity into opt-ir). This is the wrela-unique lever no mainstream compiler has.
3. **Make LICM real** (with the invariance check it currently lacks), then **SROA and stack promotion** — in that order; each unlocks the next (SROA creates scalars LICM can hoist; promotion feeds load-forwarding).
4. **Selection fusions in the backend** (§7): cmp+branch, madd, add+shift addressing, immediate folding, bitfield extract/insert — today's 1:1 macro expansion leaves the classic 10-20% on the table.
5. **Publication-shape-driven barrier minimization** for the appliance target (dmb placement by proof-visible publication points instead of conservative defaults), gated on the memory-order verifier growing litmus-style sufficiency checks (the design work from the miscompile-confidence rounds).
6. **Static hotness from structure** — terminal/cold classification exists in facts; use it to bias inlining budgets and block layout instead of waiting for PGO.
7. **Bounded-capacity full unroll / exact vector plans** — trip counts are frequently proof-known constants; the trip-count derivation exists.
8. **Custom whole-image ABI for private calls** — the `privateConventions` plumbing (argument/result locations, clobbers, pinned live-through) is already modeled end-to-end (`closed-image-backend-plan.ts`); nothing _generates_ interesting conventions yet.

### 6.3 Pipeline hygiene items

- Wire `input.target` into `runWrelaCluster` (BUG-6) so target contracts stop being hardcoded.
- Reconcile the declared schedule with the dispatcher: distinct pass ids should not silently share one implementation (`constant-folding` → `runScalarSimplificationStep`, three cleanup ids → one cluster). Either implement the distinction or collapse the declaration.
- `runMandatoryInliningCluster` iterates the operation snapshot taken before any inlining (`pipeline-steps.ts:81`), so call sites introduced by inlining are not revisited within the round — document this as one-round semantics or loop to fixpoint under the existing fuel.
- Replace fixed-round fuel with change-detection (state fingerprints already exist for `stateChanged`).

---

## 7. Backend deep-dive (target/aarch64 + uefi-aarch64)

### 7.1 What is genuinely good

- The **function pipeline staging** (`backend/api/function-pipeline.ts`) is the right shape: classify public ABI → reconcile call boundaries (clobbers, pinned live-through, veneer clobbers, tail-call eligibility) → liveness (segmented intervals with call-boundary clobbers) → interference (alias-set aware) → allocation → spill/remat repair drafts → parallel-copy resolution (with real cycle-breaking through scratch or memory temporary) → allocation verifier → frame layout → prologue/epilogue finalization → unwind planning → pseudo expansion with repair drafts → post-RA schedule → layout instructions. Every stage returns typed diagnostics with stable keys; everything sorts deterministically.
- **Encoding/object/linker/PE is the most production-grade slice of the repo**: fixed-point layout+encode (`layout-encode-fixed-point.ts`), branch-range expansion, literal pools, relocation records with bit-range patches, object verification (`encoding-object-verifier.ts`), an 876-line linker verifier, and a PE writer that **serializes, then re-parses its own bytes, then verifies planned-vs-parsed** before returning (`aarch64-pe-coff-efi-writer.ts:154-167`). The image round-trip is the kind of self-distrust production toolchains need.
- The **machine-IR interpreter + differential harness** (`interpreter/machine-ir-interpreter.ts`, `machine-ir-differential.ts`) exist as the substrate the miscompile-confidence plan needs.

### 7.2 Register allocation: the gap list

Current: first-fit scan over encoding-ordered pools, priority-sorted by `mustAllocateBeforeUse / loopDepth / spillCost / useDensity` (`allocation/allocator.ts:207-216`), with call-boundary cut points for split-retry and spill repair requests on failure.

1. **Callee-saved handling — BUG-3.** Must fix before anything else; it's a correctness issue, not quality.
2. **No coalescing / move elimination.** Parallel copies at entry and boundaries are materialized as real moves; nothing tries to assign source=dest. Add copy hints to intervals (the `requiredPhysicalRegister` mechanism generalizes to soft hints) and bias first-fit toward hint satisfaction.
3. **No live-range splitting besides call-boundary cuts**, and split segments keep the _same_ physical register across the cut (`allocator.ts:117-138`), which defeats half the point of cutting. Let post-cut segments re-enter the pending queue as free intervals.
4. **Spill placement is per-live-range, not per-use.** Repair drafts key on `useSiteKey = liveRangeKey` (`function-pipeline.ts:747-767`), i.e., one slot and (presumably) reload-at-every-use for the whole range. Fine for bring-up; production wants use-site reload placement and rematerialization beyond 16-bit constants (`isMoveWideImmediate` cap; §3.3).
5. **Cost inputs are placeholders in practice** — `spillCost`/`useDensity`/`loopDepth` fields exist on intervals but nothing computes real loop depth into them at the machine level (the loop tree lives in opt-ir).
6. **Complexity:** allocation is O(intervals × placed-segments) with alias checks per candidate; interference is O(n²) pairwise (`interference.ts:16-25`). Adequate at fixture scale; will wall on large functions. Bucket segments by order-range or adopt the standard active-list linear scan.

### 7.3 Scheduling and selection

- Enable the post-RA scheduler deliberately (§3.3 caution about memory-key completeness), add an A76-class latency table (the rpi5 catalog file is where it belongs: `backend/catalogs/rpi5-backend-catalog-data.ts`), and turn on ldp/stp pair formation — on load/store-dense firmware code, pairing alone is measurable.
- Selection is 1:1 per-operation macro expansion (`lower/operation-materialization.ts` + materializer files); `select/semantic-superselector.ts` and `select/fp-selection.ts` classify shapes (cbz/tbz classification is real) but there is no tiling. Introduce peephole-tier fusions first (cmp+b.cond, madd, uxtb/sxtb folds, immediate operands) — they're local, verifiable with the existing encode-verify loop, and don't need the full pattern-tiling design.

### 7.4 UEFI driver

- Entry thunk code is correct now (framed 48-byte call sequence preserving x0/x1, saving x29/x30, cbz-guarded init failure path, status conversion) — the design-review bugs are fixed. Remaining: fabricated unwind data (BUG-9), duplicated relocation offsets (§2 small defects).
- **Static char16 strings ride a side-table + fixpoint pointer-propagation over stringly-typed value keys** (`package-pipeline-static-char16.ts:140-495`, keys like `optir.value:42` propagated through `sourceCall` argument-parameter joins). This works, but it is a shadow dataflow analysis living in the target driver because opt-ir has no first-class read-only global/constant data. Introduce an opt-ir constant-pool object (`globalConst` value kind + relocation-bearing operand) and delete the propagation pass; every future static datum (tables, GUIDs, format strings) will otherwise need its own side-table.
- Firmware call surface: the runtime helper instruction sequences (`runtime-helper-instructions.ts`, 929 lines of hand-planned instruction records) are the TCB hot spot the design reviews flagged; they have golden-reference checks in validation. Keep treating any edit there as an ABI event.
- `qemu-smoke.ts` is a real external-runner harness (temp dir hygiene, marker scanning); wire it into CI as a gated job (see §10).

---

## 8. Diagnostics and developer experience

The diagnostic _infrastructure_ is strong — stable codes, deterministic ordering, owner keys, spans with sources. The diagnostic _content_ is not production grade:

1. **Messages don't name what they're about.** `HIR_EXPRESSION_TYPE_MISMATCH` says "Expression type does not match expected type." — with no rendering of either type (`hir/expression-lowerer.ts:102-121`). There is no type pretty-printer anywhere. Every mismatch-class message needs `expected X, found Y` with stable type formatting.
2. **No suggestions.** Unresolved names have no "did you mean" (Levenshtein over the scope candidates that resolution already enumerates); unresolved members don't list available members; the unsupported-index error doesn't point to validated buffers.
3. **No rendered output.** Nothing converts `Diagnostic {code, span, source}` into the caret-underline text block users expect from a modern compiler. This belongs in the (missing) CLI layer.
4. **Two-statements-on-one-line laxity** (BUG-4) makes downstream errors land far from causes.
5. **Cross-phase blame:** origin ids exist in HIR/proof-mir/opt-ir; nothing yet maps a backend/verify failure back through provenance snapshots to a source span. The plumbing (provenance snapshots in `withOptimizedProvenance`) exists — connect it before the optimizer gets more aggressive.

---

## 9. Compiler-self performance (the compiler as a program)

None of this blocks correctness; all of it caps scale.

1. **Bytes are `readonly number[]` everywhere** in encode/object/linker/PE (e.g. `codeBytes: number[]` flat-mapped per instruction in the entry factory, section bodies, image bytes, fingerprint hex mapping in `compile-uefi-aarch64-image.ts:192-195`). That is ~8-16× memory vs `Uint8Array`, and every concat copies. Adopt `Uint8Array` + a builder at the pe-byte-writer boundary and let it propagate outward.
2. **Immutable-rebuild hot loops:** GVN/DCE/copy-prop rebuild whole function tables per fixpoint round; each cleanup cluster is ~5 full-program rebuilds × fuel rounds. Fine at 10³ operations, quadratic-ish wall at 10⁵-10⁶. Mitigations: change-detection fuel (§6.3), per-function dirty tracking (the invalidation matrix already names the analyses; add function granularity).
3. **Known quadratic scans:** interference construction (O(n²) interval pairs), allocator candidate probing (§7.2.6), post-RA `dependenciesSatisfied` (O(n²) per pick → O(n³) per island; only matters once scheduling is enabled), `completedFieldForReceiver` linear scan of all program fields per member access in HIR (`expression-lowerer.ts:439-449` — build a per-item field map once).
4. **`checkSemanticSurface` calls `builder.build()` three times** (`semantic-surface-checker.ts:686,866,876`), each presumably materializing full tables; make build() incremental or split seed/finalize.
5. **No parallelism** anywhere (functions are independent through the backend function pipeline — an obvious later win), and **no incrementality/caching** (fingerprints exist for everything; a content-addressed artifact cache would fall out of the existing deterministic metadata).

---

## 10. Testing and validation posture

**Present and excellent:** 4,784 green tests across 609 files with 957K assertions running in 9s; property tests via fast-check in 21 files; audit tests (`tests/audit`) enforcing policy; a policy checker script (`scripts/check-policy.ts`, 579 lines) run in `agent:check`; full-image validation with reference checkers per artifact layer (opt-ir, aarch64 object, PE, proof facts, UEFI TCB golden references, determinism double-build) driven by `scripts/validate-full-image.ts` over fixture programs in three stdlib modes (toolchain/ejected/direct-platform); a QEMU smoke runner; a Lean proof model (4,655 lines, Model0-11, zero `sorry`) with a lake build.

**Missing, ranked:**

1. **Negative frontend corpus.** Every VERIFIED bug in §2 is a test that doesn't exist: top-level garbage, `pub`, bad escapes, `0x` literals, two statements per line. Add a `tests/fixtures/diagnostics/` corpus asserting _exact_ diagnostic codes — this is also the regression net for tightening the parser without breaking the stdlib.
2. **miscompile-confidence implementation** (§3.4): the empty directory is the plan's landing zone; the interpreters exist; the design is converged. This is the backstop that makes optimizer work safe to accelerate, and it should land _before_ the multi-block inliner and scheduler-enable work, not after.
3. **Grammar/lexer fuzzing.** The parser has recursion caps and error nodes but has never met a fuzzer; the lossless-reconstruct property (`tree.reconstruct() === source.text`) is a perfect fuzz oracle, and fast-check is already a dependency.
4. **Register-pressure and ABI stress fixtures**: a generated fixture family that forces >16 live GPRs (exposes BUG-3), forces spills, forces parallel-copy cycles, and checks QEMU-level behavior.
5. **Performance regression instrumentation:** the cost-semantics scorecard from the design docs still doesn't exist — even three numbers per fixture (instruction count, image size, cycle estimate from a static model) tracked in CI would let optimizer work show its receipts.

---

## 11. Security / TCB notes

- The fail-closed pattern is used consistently at the dangerous boundaries: platform certification requires exact catalog matches (signature fingerprint + ordered require-fact text fingerprints + ensured-fact argument binding checks — `semantic/surface/platform-certifier.ts`), the PE writer authenticates its entire target surface field-by-field with fingerprint comparison, and proof-check runs as a mandatory pipeline stage (`package-pipeline.ts:113-120`).
- Security facts flow into the backend concretely: `security.no-spill` and `security.wipe-on-spill` vreg facts are honored by allocation/repair (`function-pipeline.ts:791-807`), wipe slots fail compilation when no scratch register exists, and security placements/wipes/exits are projected per function. This is unusually good.
- Brittleness to accept consciously: require-clause certification is **ordered, whitespace-normalized text equality** (`platform-certifier.ts:607-638`) — reordering `requires` lines or reformatting an expression breaks certification (fails closed, so safe, but structural comparison would remove false negatives).
- The hand-planned runtime helper instruction sequences and firmware table offsets remain the highest-trust hand-written artifacts; the golden-reference checkers in validation are the right control — extend them to cover _every_ helper, and treat the unwind-data fix (BUG-9) as part of the same TCB discipline.
- `stableHash` (`shared/stable-json.ts`) underpins all fingerprints; confirm its collision posture is documented (it gates cache-equality decisions across the toolchain).

---

## 12. Roadmap: toy → production

Sequenced so each phase de-risks the next. Sizes are relative (S < M < L < XL).

### Phase 0 — Correctness stop-the-line (S-M each, do immediately)

1. BUG-3 short fix: exclude x19-x28 from public-boundary allocation; add ABI-verifier check. (S)
2. BUG-1: reject top-level expression statements; decide `pub`; fix stdlib. (S)
3. BUG-2: define + enforce escape grammar in lexer; cooked string values; delete JSON.parse. (S-M)
4. BUG-4: hex/binary literals + statement-separator enforcement. (S)
5. BUG-5 test + fix (inliner return-of-parameter). (S)
6. BUG-6 (endian contract wiring), BUG-7 (contract identity by module), BUG-8 (shadowing rule), BUG-9 (honest unwind), remaining §2 small defects. (S each)
7. Negative-diagnostic fixture corpus locking all of the above. (M)

### Phase 1 — Semantic backstop (M-L)

8. Implement miscompile-confidence per the converged design: interpreter differentials on fixtures first, generated programs second, allocation-TV third. (L)
9. Fuzz the lexer/parser with the reconstruct oracle. (S)
10. Type-mismatch diagnostics with a type formatter; binary-op operand checking in HIR (BUG-12). (M)

### Phase 2 — The optimizer earns its schedule (L)

11. Multi-block inlining (the master key), behind the new differential net. (L)
12. Real LICM (with invariance), SROA, stack promotion — retire the facades. (M each)
13. Ownership-derived alias analysis feeding load/store forwarding + DSE. (L)
14. Cost scorecard in CI (instruction count / image size / static cycles per fixture). (S)

### Phase 3 — The backend earns its silicon (L)

15. Callee-saved save/restore proper (retire the Phase-0 pool restriction). (M)
16. RA quality: coalescing hints, split-and-reassign, use-site spill placement, wider remat. (L)
17. Enable post-RA scheduling + ldp/stp pairing with memory-key completeness audit and latency table. (M)
18. Selection fusions (cmp+branch, madd, addressing modes, immediates). (M-L)
19. Opt-ir constant/global data objects; delete the char16 side-table propagation. (M)

### Phase 4 — Product surface (M-L)

20. `wrelac` CLI: file discovery, `--emit`, rendered diagnostics (caret frames), JSON diagnostics, stable exit codes. (M)
21. Stdlib buildout: real Result/Option surface, bit utilities, formatting, one blessed fixture prelude replacing per-fixture stdlib copies. (L, language-design-coupled)
22. Stream `for`-loop lowering (or formally defer the feature and reject it at _parse_ with a clear message instead of proof-mir). (M-L)
23. PE checksum + signing readiness; QEMU smoke as CI gate; artifact cache keyed on existing fingerprints. (M)

### Deliberately not recommended yet

- PGO, LTO-style cross-image tricks (the image _is_ the world already), debug info (DWARF/CodeView) before the diagnostics+CLI layer exists, and float support — each is either premature or a language decision to make explicitly.

---

# Part II — Mid-pipeline deep dive (mono, layout, proof-mir, proof-check)

Completed as a second pass on 2026-07-03, closing the coverage gap declared in the original Appendix B. Method as before: full reads of the core algorithm files (`reachability.ts`, `instantiation-key.ts`, `function-clone-coverage.ts`, `primitive-layout.ts`, `aggregate-layout.ts`, `platform-abi.ts`, `extension-gates.ts`, `graph-worklist-join-coordinator.ts`, dispatch/handler/registry structure, `fact-transfer.ts`), plus targeted greps over the remaining ~85 files in these four subsystems (diagnostic registries, rejection surfaces, enum/wire layout policies, resource limits, dispatch defaults).

The one-line verdict for all four: **these are the most finished subsystems in the compiler.** No facades were found (in sharp contrast to opt-ir and the backend), diagnostics are registry-typed and exhaustive (34 mono codes, 60 layout codes, 67 proof-mir codes), determinism discipline is unbroken, and the dangerous defaults all fail closed. The findings below are correspondingly a grade softer than Part I's: language-decision gaps, scale hazards, and precision cliffs rather than miscompiles.

---

## 13. mono/ — whole-image monomorphization

**What it is.** A demand-driven instantiation walk from the image roots: functions and types are cloned per (ownerTypeArguments × functionTypeArguments) with canonical instance keys, platform calls are matched edge-by-edge against certified bindings, and the result is a closed set of concrete instances handed to layout and proof-mir.

**Confirmed strengths.**

- **Instance keys are injective by construction** — `canonicalFunctionInstanceId`/`canonicalTypeInstanceId` serialize type-argument lists as _length-prefixed_ fingerprints (`instantiation-key.ts:216-222`), so no delimiter-collision aliasing between distinct instantiations is possible. A `MONO_DUPLICATE_CANONICAL_INSTANCE_KEY` diagnostic exists as a second net.
- **Clone fidelity is compile-time guaranteed**: `function-clone-coverage.ts` declares `Record<(typeof HIR_STATEMENT_KINDS)[number], true>` and the expression equivalent — adding an HIR kind without extending the cloners is a _type error_, not a latent drop. This is the correct answer to the classic "cloner missed a field" bug class; other subsystems should copy the pattern.
- Platform-call handling is exact: each reachable call to a certified platform function must have exactly one HIR platform-contract edge, whose binding and ensured facts are re-verified against the certified binding at mono time (`reachability.ts:305-502`), with distinct diagnostics for missing / duplicate / mismatched edges. Fail-closed.
- Deterministic everywhere: outgoing edges sorted by composite key, discoveries deduped through canonical-key sort.

**Findings.**

- **M-1 (language decision leaking as a generic error): all recursion is banned, silently as policy.** `MONO_RECURSIVE_FUNCTION_CYCLE` fires for _any_ re-entry of an in-progress instance — direct recursion, mutual recursion, everything — and `MONO_RECURSIVE_TYPE_CYCLE` likewise bans recursive types (`reachability.ts:117-130, 526-539`); polymorphic recursion additionally gets its own code. If this is the language's provable-termination stance (loops only, no recursion), it is a _defining property of the language_ that appears nowhere in the diagnostic text ("Recursive function cycle detected." reads like a compiler limitation, not a rule) and, as far as this review found, is enforced nowhere earlier than monomorphization — so the user discovers the rule only after semantic checking passes their program. Decide, document in the language spec, and reject at semantic surface with a message that states the rule.
- **M-2 (scale hazard): the reachability walk is recursive on the host JS stack.** `processFunctionWorkItem → instantiate body → processOutgoingFunctionEdges → processFunctionWorkItem` nests one host stack frame (several, in fact) per call-graph _depth_. The recursion ban means no cycles, but a deep non-recursive chain — thousands of small functions, exactly what this language's style produces — will overflow the Bun/V8 stack and crash the compiler with no diagnostic. Convert to an explicit worklist (the mono state already has all the makings: `functionStates`, `activeFunctionKeys`).
- **M-3 (perf): per-discovery rework.** `createReachabilityNormalizationContext(program)` is re-created at five call sites per instance, and `collectSourceTypeDiscoveriesFromFunction` walks every expression and place of every instance re-fingerprinting checked types (`reachability.ts:655-728`). Fingerprints are pure functions of the type — cache them (a WeakMap on type objects or a fingerprint memo in the normalization context) before large programs make this quadratic-ish.
- **M-4 (fragility): failed instantiations are marked `"completed"` without a table entry** (`reachability.ts:180-184, 239-243`), so later lookups of that key return `undefined` and every downstream consumer must null-tolerate. Diagnostics guarantee the compile fails anyway, but a distinct `"failed"` state would prevent a future consumer from treating absence as impossibility.
- M-5 (noted, fine): certified platform functions cannot be image entry roots (explicit v1 restriction with its own diagnostic).

---

## 14. layout/ — representation and ABI facts

**What it is.** Seeds primitive layout facts from the target surface, computes C-style aggregate layouts (offsets, alignment, stride, padding ranges), enum discriminant layouts, validated-buffer wire layouts, and classifies function/platform ABIs by delegating to the target surface's classifier.

**Confirmed strengths.**

- **All size/offset arithmetic is `bigint`** — no silent JS `number` precision loss anywhere in the layout math; per-field and aggregate totals are checked against `maximumObjectSizeBytes`/`maximumAlignmentBytes` with dedicated overflow diagnostics (`aggregate-layout.ts:372-483`). Enum discriminants are checked against the target size-type maximum (`enum-layout.ts:245-256`). Wire encodings are validated against the target data model's endianness (`validated-buffer-wire.ts:329`).
- **Padding is a tracked security artifact, not an accident**: every inter-field and trailing padding range is recorded (including transitively through nested aggregates) under an explicit `paddingExposurePolicy: "fieldwiseCopyOnlyUntilInitialized"` (`aggregate-layout.ts:495-507`) — exactly the metadata a padding-leak verifier needs. Few production compilers model this at all.
- Value-recursive types are detected via an active-computation stack (`LAYOUT_RECURSIVE_TYPE_LAYOUT`), field errors accumulate per-field for batched diagnostics, and the whole computation fails closed on any error.
- ABI classification has a **single authority**: `target.abi.classifyValue` on the target surface, consumed identically by source-function and platform ABI paths — the register-model-fragmentation concern from the backend design review did not materialize here.

**Findings.**

- **L-1 (missed optimization + unpinned language decision): layout is declaration-order only.** `buildFieldFacts` lays fields out strictly in source order. Wire-facing layouts (validated buffers) must be, but ordinary class/dataclass layouts could be reordered to minimize padding — a free win in a closed-world compiler with no FFI struct compatibility to preserve. The blocker is that the language spec must first say whether declaration order is observable; nothing in the repo pins it either way. Same family of decision as M-1: decide, document, then either exploit or guarantee.
- **L-2 (landmine pattern): fabricated fallback keys.** `resolveCheckedTypeToLayoutKey` for an unmapped bare source type synthesizes `monoInstanceId("source:" + typeId)` (`aggregate-layout.ts:101`) — a key in a _different format_ from real canonical instance ids (`type:N|args:<…>`). Today the mismatch just yields a "layout not available" diagnostic (fail-closed), but a fabricated near-miss key is exactly the kind of thing that later "works accidentally" when a map is keyed loosely. Return `undefined` and diagnose instead of inventing an id.
- **L-3 (silent first-pick, mirrors S4): `findPlatformFunctionInstance`** filters instances by `sourceFunctionId`, sorts, and takes the first (`platform-abi.ts:192-205`). Platform functions should be mono-monomorphic by shape rules; assert `matches.length === 1` and diagnose otherwise, or the first generic-platform-fn regression will silently classify the wrong instance's ABI.
- L-4 (minor): synthesized `fieldId(index + 1)` for fields lacking ids (`aggregate-layout.ts:434`) — per-owner scoped so no collision today; worth a brand-typed synthetic range if field ids ever become global.

---

## 15. proof-mir/ — the proof-oriented MIR

**What it is.** Lowers mono HIR into a canonical, SSA-checked, effect-annotated graph IR (blocks, control edges with metadata, layout-term bindings, obligations), with a freeze/canonicalization layer producing deterministic canonical keys, and a validator enforcing graph well-formedness before proof-check consumes it.

**Confirmed strengths.**

- The diagnostic registry is the largest and most specific in the compiler — **67 brand-typed codes** (`diagnostics.ts:4-70`) covering CFG validity, SSA, edge metadata, join arguments, yield/resume framing, loan identity, runtime-catalog contract validity, switch exhaustiveness, scope trees, canonical-key validity, and more. Unknown codes throw at construction. This is what a production-grade IR contract looks like.
- `validation/graph-validator.ts` is a real structural validator (block scope, terminator edges, control-edge references and targets, join arguments, block parameters, scalar SSA, return/panic exit closure — 840 lines, all load-bearing).
- The lowering rejection surface is _principled_: unsupported constructs flow through one `rejectUnsupportedProofMirExtensionConstruct` gate (`extensions/extension-gates.ts`) keyed on declared target features, with exhaustive `never`-checked construct handling — not scattered ad-hoc bails.

**Findings.**

- **PM-1 (the completeness headline, sharpened from §3.4): two language constructs are gated on target features that no target declares.** The gate recognizes exactly three constructs: `coroutineYield`, `streamLoop`, `crossCoreOwnership`. The first two require a target feature flag; the UEFI target's runtime catalog is `features: Object.freeze([])` (`runtime-catalog.ts:139`). So `yield` — a keyword with full grammar, HIR statement, mono cloning, and proof-mir yield/resume _validation codes_ (`PROOF_MIR_INVALID_YIELD_RESUME`, `PROOF_MIR_INVALID_YIELD_FRAME_BOUNDARY`) — and stream `for`-loops are both dead on arrival, rejected at the _fifth_ pipeline stage with `PROOF_MIR_MISSING_SEMANTICS_GATE`. All the scaffolding exists and none of the semantics does. Recommendation unchanged from Part I but now two-headed: either implement the lowerings behind the flags, or reject at parse/semantic-surface with "not supported on target uefi-aarch64" so users don't build four phases of program around a construct that cannot compile. The third gate (`crossCoreOwnership`) keys on mono concurrency metadata availability instead of a feature — fine, but the asymmetry deserves a comment.
- **PM-2 (honest scope note): the canonicalization freeze layer was structurally reviewed, not line-audited.** `canonicalization/graph-snapshot-freeze.ts` (929) + `program-freeze-function-draft.ts` (852) + siblings are the determinism keystone — every proof-check state key and every fact canonical key downstream depends on their stability. Their invariants are exercised by the green test suite and the `PROOF_MIR_INVALID_TABLE_CANONICAL_KEY`/`PROOF_MIR_INVALID_CANONICAL_ID_ASSIGNMENT` validator codes, but a dedicated property test — "freeze twice, byte-identical; permute input table insertion order, byte-identical" — would turn that reliance into evidence cheaply. (fast-check is already a dependency; this is a natural target.)
- PM-3 (minor): `iterator-lowerer.ts` hardcodes `proofMirOriginId(1)` as the origin for the stream-loop rejection (line 608) — the one place a diagnostic origin is fabricated rather than derived from the statement; the mono statement's real origin is available in scope.

---

## 16. proof-check/ — the resource/fact checker

**What it is.** The abstract interpreter that makes the language's promises real: a kernel (worklist session, state reducer, join coordinator, transition API, resource limits) dispatching to ~10 domain modules (facts, ownership-transfer, loops, validation, source-calls, platform-contract transfer/effects, cross-core-ownership, hidden-place analysis) over the proof-mir graph, producing checked facts and counterexample-bearing diagnostics. Runs as a mandatory compile stage.

**Confirmed strengths — this is the most rigorously fail-closed code in the repo.**

- **Joins wait for every predecessor**: a merge block is not processed until _all_ non-exit incoming edges have recorded states (`graph-worklist-join-coordinator.ts:101-117`); there is no partial-join acceptance.
- **Imprecision is rejection, not widening**: if the core meet of incoming states diverges, the block is marked failed and a `divergent-join` error is emitted _with a counterexample witness chain_ (path frames from predecessor to join, `join-coordinator.ts:130-183`). A join-policy hook can accept a non-exact meet only by explicitly constructing the accepted state.
- **Resource exhaustion is an error, not an escape hatch**: per-state caps (`maximumActiveFactsPerState`, `maximumActiveLoansPerState`, `maximumOpenObligationsPerState`, …) emit `proof-check.resource-limit.exceeded` diagnostics (`kernel/resource-limits.ts`) — big programs fail loudly rather than being silently under-checked.
- **Dispatch is compile-time exhaustive**: operation and statement dispatch end in `const unreachable: never` arms — there is no default-accept path for an unhandled operation kind. Proof-neutral statements (literal/unary/binary/comparison/…) get explicit `identityTransition`s in the base handler with domain judgments layered on top; the neutrality list is visible and reviewable in one place (`registry/statement-handlers.ts:202-210`).
- Loop headers run the same machinery with a dedicated `loopHeader` judgment and state-key stabilization (`acceptedEntryStates` short-circuits when the merged state key stops changing) — termination rests on meet monotonicity plus the resource caps, both of which hold by construction.

**Findings.**

- **PC-1 (the production friction to plan for): the divergent-join rejection is an expressiveness cliff, and it will be the #1 user-facing wall.** Any program whose fact states legitimately differ across two branches into a join — one arm validated a packet, the other didn't, and the code after the join only touches common state — is _rejected_, because the checker has no widening and no per-path variant tracking beyond `DEFAULT_VARIANT_KEY`. This is the right call for soundness and the design docs choose it deliberately, but production readiness demands the compensating UX: the counterexample witness exists (good), yet the diagnostic teaches nothing about _how to restructure_ (hoist the divergent fact, split the join, consume before merging). As real programs grow past fixtures, invest in (a) join-failure diagnostics that name the divergent fact components in source terms, and (b) a documented catalog of restructuring recipes keyed to `divergent-components:` details.
- **PC-2 (open design-review lead confirmed in code): fact-transfer reasons are unstructured.** `FactTransferRule.reason?: string` (`shared/facts/fact-transfer.ts:19`) — the transfer behaviors (identity/move/split/copy/weaken/invalidate/reject) are typed, but the _reason_ a rewrite claims a transfer is legal is a free-text string with no originator identity or authenticator. This is the r15 adversarial-review survivor, unchanged: when the miscompile-confidence differentials land (§3.4), wrapper/transfer reasons are their raw material, and free text can't be validated. Structure it (enum + originating pass id + subject key) before the optimizer starts leaning on `weaken`/`copy` transfers in anger.
- **PC-3 (complexity concentration, honest scope note): the domain interiors are the remaining un-line-audited code.** The kernel contracts reviewed here (join, dispatch, limits, transitions) are the soundness _chassis_; the ~8K lines of domain judgments (`domains/validation.ts` 988, `domains/source-calls.ts` 951, `domains/facts.ts` 951, `ownership-transfer.ts` 882, `loops.ts` 873, platform-contract pair ~1.6K, `cross-core-ownership.ts` 802) encode the actual rules. They sit behind the exhaustive-dispatch/fail-closed chassis, are exercised by the proof-check test directory, and their designs have had four adversarial review rounds — but rule-level line audit remains the one residual gap in whole-source coverage, and it is best closed _by the Lean differential_ (the proof-model exists precisely to check these judgments against a formal model) rather than by more eyeball passes. That makes the miscompile-confidence implementation (§10.2) the closing move for this subsystem too.
- PC-4 (vestigial): `JoinPredecessorCandidate.unreachable` is checked in `processMerge` but every recording site hardcodes `unreachable: false` (`join-coordinator.ts:299-305`) — either wire real unreachability (exit-pruned edges are already filtered separately) or delete the field before someone assumes it works.
- PC-5 (perf, same family as M-3): state keys are recomputed via `proofCheckStateKey(state)` at every record/merge; join slots key maps by stringified ids per block-variant. Fine at fixture scale; a state-key memo on the state object is the first thing to reach for when proof-check time shows up in profiles.

### Revised roadmap deltas from Part II

Fold into §12: **Phase 0** gains "M-4 failed-state marker" and "PC-4 unreachable-field decision" (both S). **Phase 1** gains "worklist-ify mono reachability (M-2)" (S-M), "canonicalization double-freeze property tests (PM-2)" (S), and "reject `yield`/stream-for at semantic surface with target-feature message (PM-1)" (S). **Phase 2** gains "structured fact-transfer reasons (PC-2)" (M) as a prerequisite for aggressive fact-gated rewrites. **Phase 4** gains "divergent-join diagnostic UX + restructuring catalog (PC-1)" (M) and the language-spec decisions "recursion ban wording (M-1)" and "field-order observability (L-1)" (S each, spec work). The mono/layout/proof-mir/proof-check subsystems need **no** Phase-0 correctness stop-the-line items — nothing found in them miscompiles.

---

## Appendix A — Evidence quick-reference

| Claim                                            | Where verified                                                                         |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- |
| `pub fn` / garbage / `\q` / `0x1F` behavior      | Parser probe executed 2026-07-03 (0 diagnostics each; index expr errors correctly)     |
| Test suite green                                 | `bun test`: 4,784 pass / 0 fail / 957,087 expects / 9.0s                               |
| LICM/SROA/stack-promotion return input unchanged | `licm.ts:55`, `scalar-replacement.ts:66`, `stack-promotion.ts:58`                      |
| Scheduler identity + peepholes off in production | `function-pipeline.ts:550-567` call site vs `post-ra-scheduler.ts:52-68` options       |
| Callee-saved never saved                         | `function-pipeline.ts:468-476`; `publicCalleeSavedGprs` consumers: none (grep)         |
| Inliner single-block                             | `whole-program-inlining.ts:258`                                                        |
| GVN real / vector materialization real           | `gvn.ts` full read; `vector-materialization.ts` full read                              |
| Proof-check mandatory in compile                 | `package-pipeline.ts:113-120` stage keys                                               |
| Lean model 0 `sorry`                             | grep over `proof-model/Wrela/ProofMIR/*.lean`                                          |
| Stdlib 137 lines; `Result` empty                 | `wc -l stdlib/**/*.wr`; `result.wr` contents                                           |
| miscompile-confidence dir empty                  | `tests/unit/validation/miscompile-confidence/` (untracked, no files)                   |
| No CLI                                           | `process.argv` grep: only `scripts/validate-full-image.ts`                             |
| All recursion banned in mono                     | `reachability.ts:117-130` (function), `:526-539` (type), `:154-167` (polymorphic)      |
| Mono clone coverage type-guarded                 | `function-clone-coverage.ts` `Record<Kinds, true>` full read                           |
| Layout math bigint + overflow-checked            | `aggregate-layout.ts`, `primitive-layout.ts`, `enum-layout.ts:245-256` full/spot reads |
| `yield`/stream-for gated, no target enables      | `extension-gates.ts` full read; `runtime-catalog.ts:139` `features: []`                |
| Proof-check joins fail closed w/ counterexamples | `graph-worklist-join-coordinator.ts` full read                                         |
| Resource limits error on exhaustion              | `kernel/resource-limits.ts` grep (`proof-check.resource-limit.exceeded`)               |
| Dispatch exhaustive, no default-accept           | `operation-dispatch.ts:195,439` `never` arms; `statement-handlers.ts:202-210`          |
| Fact-transfer reasons unstructured               | `shared/facts/fact-transfer.ts:19` `reason?: string`                                   |

## Appendix B — Coverage statement

Part I (first pass, 2026-07-03) line-audited the frontend, semantic, hir, opt-ir, backend, uefi driver, linker/pe-coff, and validation subsystems. Part II (second pass, same day; §13–§16) closed the remaining gap: `mono/`, `layout/`, and the `proof-mir`/`proof-check` interiors were audited via full reads of their core algorithm files plus registry/rejection-surface/limit-behavior greps across all remaining files. The single residual un-line-audited region is the proof-check **domain judgment bodies** (~8K lines across `domains/`), deliberately deferred per PC-3: they sit behind a verified fail-closed kernel, and the highest-yield audit instrument for them is the planned Lean proof-model differential (miscompile-confidence, §10.2), not further manual reading. No other subsystem retains unreviewed algorithmic code.
