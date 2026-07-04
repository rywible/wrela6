# World-Class Remediation Plan

**Date:** 2026-07-03
**Goal:** execute every finding from the four independent 2026-07-03 codebase reviews so that, when this plan is complete, wrela6 is a production, world-class compiler: no known miscompiles, no silent acceptance holes, every declared language construct compiles or is rejected at the frontend with a clear message, a real optimizer, a real user surface (CLI + diagnostics), fast local verification gates centered on `bun run agent:check`, and deeper local verification commands for QEMU, fuzzing, differentials, and Lean proportional to the proof claims the language makes.

**Inputs (all reconciled and cross-verified against source on 2026-07-03):**

1. `docs/review/2026-07-03-whole-codebase-production-review.md` (two-pass, §1–§16) — "REV-A"
2. `docs/thermonuclear-codebase-review.md` — "REV-B"
3. `docs/world-class-compiler-production-review.md` — "REV-C"
4. `docs/reviews/2026-07-03-wrela6-production-readiness-review.md` — "REV-D"

**Verification rulings on conflicting/incorrect review claims** (each was checked against source before planning):

| Claim                                                                                                        | Ruling                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| REV-B/REV-D: "default 8-register GPR pool is a critical production bug"                                      | **Mischaracterized.** Production always passes full pools via `allocationRegisterPools` (`function-pipeline.ts:402,659-689`). The default parameter is a test-only trap. The _actual_ critical register bug is missing callee-saved preservation (REV-A BUG-3 / REV-C #2) — and naively "expanding the pool" per REV-B would make it worse. This plan fixes callee-saved first (W1-01), then pool policy (W5-01).                                                                      |
| REV-B: stdlib "contains a narrow VirtIO net driver"                                                          | **False.** No VirtIO code exists anywhere in `stdlib/` (137 lines total, verified by read). Ignored.                                                                                                                                                                                                                                                                                                                                                                                   |
| REV-B: `src/pe-coff/optional-header.ts`, `section-table.ts`, `src/proof-check/proof-checker.ts` as fix sites | **Phantom paths** (real files: `pe-file-layout.ts`, `proof-check-phases.ts`). Corrected in tasks below.                                                                                                                                                                                                                                                                                                                                                                                |
| REV-B: "enable IMAGE_DLLCHARACTERISTICS_DYNAMIC_BASE (ASLR)" vs REV-D: "do NOT set DYNAMIC_BASE for UEFI"    | **REV-D is right for UEFI.** Current writer already emits `imageBase: 0n`, `dllCharacteristics: 0` (`aarch64-pe-coff-target.ts:126,146`). Plan: pin current behavior with a conformance test; add `NX_COMPAT` (0x0100) as an explicit decision task for 2023+ UEFI CA signing (W2-13). No DYNAMIC_BASE.                                                                                                                                                                                |
| REV-B: "irreducible CFGs make dominance computation incorrect → proof bypass"                                | **Overstated** — dominance is well-defined on irreducible graphs, and structured lowering (if/while/for/match, no goto) cannot produce irreducible CFGs. Kept only as a cheap validator assertion (W2-10).                                                                                                                                                                                                                                                                             |
| REV-B: "LICM hoists whatever callers label pure"                                                             | **Understated.** LICM hoists **nothing** — returns the program unchanged (`licm.ts:55`); REV-A O1 is the accurate statement. Plan uses REV-A's characterization.                                                                                                                                                                                                                                                                                                                       |
| REV-D: "10 copies of deterministic-sort.ts"                                                                  | 6 copies (verified `find`). Task stands with the correct count (W2-12).                                                                                                                                                                                                                                                                                                                                                                                                                |
| REV-A: "the parser has never met a fuzzer"                                                                   | **Partially wrong** — `tests/integration/lexer-fuzz.test.ts`, `import-discovery-fuzz.test.ts`, `module-graph-lexer-fuzz.test.ts` exist. Corrected: W8-01 _extends_ fuzzing to the parser with the reconstruct oracle rather than introducing it.                                                                                                                                                                                                                                       |
| REV-C: draft edge key collision                                                                              | **Confirmed at source level** (`draft-keys.ts:188-196` keys on `functionInstanceId + role` only; `createBranchEdge` passes `role: kind` — bare `"branchTrue"` — at `draft-graph-terminators.ts:276`; callers `if-lowerer.ts:519,529`, `loop-lowerer.ts:115,123` pass no site discriminator). Also confirmed **no fixture has two branch sites in one function**, so the collision is live and untested. W1-05 is therefore the single most user-visible correctness task in this plan. |
| REV-C: `incomingEdges` caller-controlled                                                                     | **Confirmed** — zero references to `incomingEdges` in `src/proof-mir/validation/` (grep). W1-06.                                                                                                                                                                                                                                                                                                                                                                                       |
| REV-D: proof-check resource limits (256 fns / 512 blocks / 64 variants / …)                                  | **Confirmed** (`resource-limits.ts:52-63`); the constants live in `proofCheckResourceLimitsForTest()` and production limit sourcing must be audited as part of W3-01.                                                                                                                                                                                                                                                                                                                  |
| REV-C/REV-D: no default veneer provider                                                                      | **Confirmed** — `veneerProvider` optional (`layout-fixed-point.ts:78`), threaded through `aarch64-linker.ts:330`, and **no file outside the linker provides one**; `binary-spine.ts` does not pass it. W5-06.                                                                                                                                                                                                                                                                          |

Everything else in the four reviews was verified compatible and is covered below. Nothing was dropped: every finding maps to exactly one task ID (see the traceability index at the end).

**2026-07-04 gate ruling:** this plan must not add GitHub Actions or any other remote-only quality gate. Every required check must be runnable locally. The fast required path is `bun run agent:check`; longer proof, QEMU, stress, or release verification can live behind explicit local commands such as `bun run verify:extended`, `bun run verify:qemu`, `bun run verify:lean`, or `bun run verify:release`, but those commands must be ordinary package scripts that any agent can run in the shared workspace.

---

## How to work this plan (subagent protocol)

Every task in this document is written to be executed by an autonomous subagent (junior-engineer skill level) with no additional context. Rules:

1. **One task per branch/session.** Do not combine tasks. Do not do drive-by refactors outside the task's "Files" list; if you find an adjacent bug, note it in the PR description and stop.
2. **Test first.** Every task lists its tests. Write the failing test _first_, confirm it fails for the stated reason, then implement, then confirm it passes.
3. **Gate before handoff:** run `bun run agent:check`. After W0-01 lands, that command is the fast required local gate: typecheck, format check, lint, policy check, full test suite, and non-QEMU full-image validation. Until W0-01 lands, run the current `bun run agent:check`; if your task touches `src/target`, `src/linker`, `src/pe-coff`, `src/validation/full-image`, or target package orchestration, additionally run `bun run validate:full-image -- --json` and paste the summary into the handoff.
4. **Determinism is law.** Never introduce `Date.now`, `Math.random`, unsorted map iteration into any output, or non-length-prefixed string key concatenation. All new diagnostics must have: stable `code` from the subsystem's registry, `ownerKey`, `stableDetail`, and deterministic sort participation.
5. **Diagnostics, not throws,** for anything a user's source can trigger. `throw` is only for compiler-internal invariant violations.
6. **Match house style:** `input`/`context`/`result` object parameters, `readonly` everywhere, `Object.freeze` on returned aggregates, no `any`, no `@ts-ignore`, dependency injection with fakes (never mocks), filesystem access only at compiler edges.
7. **Only assign suffixed task IDs.** Assignable IDs must match `W[0-8]-NNx`, for example `W3-02a`. Unsuffixed IDs such as `W3-02` are parent workstreams and evidence context only.
8. **Task size ceiling:** each suffixed task must fit in one focused PR, normally one failing test plus one implementation seam. If a subagent cannot explain the failing test in one sentence before editing, the task is still too large and must be split before work starts.
9. **Dependencies are hard and exact.** A task may not start until every task in its `Depends:` list is merged. `Depends:` may contain only `none` or exact suffixed task IDs. Parent IDs and prose dependencies are plan defects.
10. **No research tickets in the release-critical path.** Design or research work is allowed only when the AC is a concrete artifact such as a design doc, local script wrapper, coverage matrix, or one deliberately tiny seed implementation.
11. **Giant-file rule:** after W0-04 lands, any task that touches a grandfathered >900-line file must either depend on the matching W0-05 split prerequisite or prove the patch shrinks that file. Growing a grandfathered file is a failed task, even if tests pass.

### Wave order and rationale

```
W0 (harness/gates) ─┬─► W1 (correctness stop-the-line) ─► W2 (fail-closed boundaries)
                    │                                        │
                    │                                        ▼
                    └──────────────► W3 (language completeness) ─► W4 (optimizer)
                                                              │        │
                                                              ▼        ▼
                                                    W5 (backend quality)
                                                              │
                                                              ▼
                                     W6 (product surface) ─► W7 (scale/maintainability)
                                                              │
                                                              ▼
                                                    W8 (verification depth)
```

W4-01 (interpreter differential) is deliberately scheduled **before** the aggressive optimizer/backend work it protects; W8 deepens it. Individual W6/W7 tasks that don't touch IR semantics may run any time after W2.

---

## Authoritative subagent task catalog

The following suffixed tasks are the units to assign to subagents. The unsuffixed wave sections below remain as evidence, rationale, and deeper implementation context.

Each task packet has one invariant, one code seam, one first test, and one acceptance gate. Example snippets are intentionally small: they show the shape a junior engineer should start from, not a full replacement for reading the named files.

For each packet, the first failing test is the `Test/example` assertion or command. The focused command is `bun test <first backticked tests/... path in Files>` when the packet names a test file; otherwise use the exact command named in `Test/example` or `AC`. Every subagent runs that focused command once before implementation to capture the red failure, once after implementation to prove the local fix, and then `bun run agent:check` before handoff.

### WAVE 0 — Harness and local gates

#### W0-01a — Pin toolchain metadata and add `verify:full-image`

- **Depends:** none.
- **Files:** `package.json`, `bun.lock`.
- **Do:** add `"packageManager": "bun@1.3.14"`, pin `@types/bun` to the exact lockfile version, and add `"verify:full-image": "bun run scripts/validate-full-image.ts --json"`.
- **Test/example:** in a new audit test, start with `expect(packageJson.scripts["verify:full-image"]).toBe("bun run scripts/validate-full-image.ts --json");`.
- **AC:** `bun run verify:full-image` exits 0 and prints JSON; no `.github/` directory is created.

#### W0-01b — Make `agent:check` call the complete fast local gate

- **Depends:** W0-01a.
- **Files:** `package.json`, `tests/audit/local-verification-audit.test.ts`.
- **Do:** extend `agent:check` to run typecheck, format check, lint, policy check, full tests, and `verify:full-image`; add `verify:extended` as an executable alias for existing local checks.
- **Test/example:** `expect(packageJson.scripts["agent:check"]).toContain("bun run verify:full-image");`.
- **AC:** `bun run agent:check` runs the new chain; deleting `verify:full-image` from `agent:check` makes the audit fail.

#### W0-02a — Define the negative-diagnostic fixture schema

- **Depends:** none.
- **Files:** `tests/fixtures/diagnostics/README.md`, `tests/fixtures/diagnostics/ok-empty/input.wr`, `tests/fixtures/diagnostics/ok-empty/expected.json`.
- **Do:** document and seed the schema `{ "phase": "parse" | "semantic" | "pipeline", "diagnostics": [...] }`.
- **Test/example:** `{"phase":"parse","diagnostics":[]}` is the first valid fixture expectation.
- **AC:** the README explains `code`, `spanText`, `count`, and the meaning of `ok-*` fixtures.

#### W0-02b — Implement the diagnostic corpus runner

- **Depends:** W0-02a.
- **Files:** `tests/system/diagnostics/diagnostics-corpus.test.ts`.
- **Do:** load each fixture directory, run the requested phase, compare expected diagnostic code/span/count multisets, and print actual diagnostics in failures.
- **Test/example:** `expect(actualCodes).toContain(expectedDiagnostic.code);`.
- **AC:** `bun test tests/system/diagnostics/diagnostics-corpus.test.ts` passes; changing an expected code produces a readable diff.

#### W0-02c — Seed known frontend-hole fixtures as tracked failures

- **Depends:** W0-02b.
- **Files:** `tests/fixtures/diagnostics/top-level-garbage/*`, `tests/fixtures/diagnostics/pub-fn/*`, `tests/fixtures/diagnostics/bad-escape/*`, `tests/fixtures/diagnostics/hex-split/*`.
- **Do:** add fixtures for known zero-diagnostic bugs with expectations that future W1 tasks will flip to real codes.
- **Test/example:** `{"phase":"parse","diagnostics":[],"trackedBy":"W1-02"}` records the current wrong behavior without hiding it.
- **AC:** the corpus is green on the current tree and every seeded wrong-behavior fixture names its owning fix task.

#### W0-03a — Generalize the line-count maintainability audit

- **Depends:** none.
- **Files:** `tests/audit/subsystem-maintainability-audit.test.ts`.
- **Do:** copy the mono audit pattern to a table of subsystem roots, caps, grandfathered files, and recorded line counts.
- **Test/example:** `expect(currentLines).toBeLessThanOrEqual(recordedLines);`.
- **AC:** the audit passes today; increasing any grandfathered file by 30 lines makes it fail.

#### W0-03b — Add scar-tissue bans to the audit

- **Depends:** W0-03a.
- **Files:** `tests/audit/subsystem-maintainability-audit.test.ts`.
- **Do:** ban new `as any`, `@ts-ignore`, `Math.random`, `Date.now`, and unstable `JSON.stringify` in proof/canonicalization paths, with exact grandfathered exceptions.
- **Test/example:** `expect(source).not.toContain("@ts-ignore");`.
- **AC:** adding a new banned pattern under `src/` fails the audit with the file path and pattern.

#### W0-04a — Add a machine-checkable remediation-plan quality audit

- **Depends:** W0-03b.
- **Files:** `tests/audit/remediation-plan-quality-audit.test.ts`, `docs/implementation/2026-07-03-world-class-remediation-plan.md`.
- **Do:** parse the catalog between the two catalog boundary headings; assert every assignable heading matches `^#### W[0-8]-[0-9]{2}[a-z] `, every packet has `Depends`, `Files`, `Do`, `Test/example`, and `AC`, every dependency is `none` or an existing suffixed task ID, and every file/test reference is concrete enough for a cold subagent to open.
- **Test/example:** corrupt one packet in the audit fixture string to `- **Depends:** optimizer/backend complete.` and assert the audit reports `non-machine-checkable dependency`.
- **AC:** `bun test tests/audit/remediation-plan-quality-audit.test.ts` passes on this plan; reintroducing a parent dependency or prose dependency makes it fail.

#### W0-04b — Move giant-file touch enforcement into the fast audit

- **Depends:** W0-04a.
- **Files:** `tests/audit/subsystem-maintainability-audit.test.ts`, `docs/implementation/giant-file-split-map.md`.
- **Do:** record every current `src/**/*.ts` file at or above 900 lines with its line count, owner boundary, and W0-05 split prerequisite. The current verified list is: `src/semantic/names/expression-resolver.ts` 1324, `src/opt-ir/operations.ts` 1045, `src/opt-ir/lower/lower-checked-mir.ts` 1031, `src/target/aarch64/backend/object/layout-encode-fixed-point.ts` 997, `src/proof-check/domains/validation.ts` 988, `src/proof-mir/lower/expression-lowerer.ts` 982, `src/proof-check/kernel/registry/transition-helpers.ts` 979, `src/mono/mono-hir.ts` 976, `src/target/aarch64/backend/object/object-module.ts` 973, `src/target/aarch64/backend/verify/encoding-object-verifier.ts` 972, `src/target/aarch64/lower/lower-function.ts` 964, `src/semantic/names/type-reference-resolver.ts` 956, `src/proof-check/domains/source-calls.ts` 951, `src/proof-check/domains/facts.ts` 951, `src/proof-mir/draft/draft-graph-builder.ts` 946, `src/target/aarch64/backend/api/machine-lowering.ts` 944, `src/proof-check/authority/authority-term-canonicalization.ts` 943, `src/proof-mir/domains/effects-resources.ts` 931, `src/target/uefi-aarch64/runtime-helper-instructions.ts` 929, `src/proof-mir/canonicalization/graph-snapshot-freeze.ts` 929, and `src/mono/reachability.ts` 915.
- **Test/example:** append 10 lines to a copied fixture of `src/semantic/names/expression-resolver.ts` and assert the audit says `grandfathered giant file grew`.
- **AC:** `bun test tests/audit/subsystem-maintainability-audit.test.ts` fails when any grandfathered file grows and prints the matching W0-05 prerequisite.

#### W0-05a — Split semantic name expression resolver before behavior edits

- **Depends:** W0-04b.
- **Files:** `src/semantic/names/expression-resolver.ts`, `src/semantic/names/expression-resolver/simple-name-resolver.ts`, `src/semantic/names/expression-resolver/member-chain-resolver.ts`, `src/semantic/names/expression-resolver/pattern-resolver.ts`, `tests/unit/remediation/w0-05a.test.ts`
- **Do:** perform a pure move: keep the public exports from `expression-resolver.ts`, move simple-name logic, member-chain logic, and pattern logic into the three new modules, and make no behavior changes.
- **Test/example:** `export { resolveSimpleNameExpression } from "./expression-resolver/simple-name-resolver";` remains available from the old module path.
- **AC:** semantic name-resolution tests and `bun run agent:check` pass with zero golden churn; `src/semantic/names/expression-resolver.ts` line count shrinks below its recorded W0-04b count.

#### W0-05b — Split AArch64 function-pipeline allocation/frame seams

- **Depends:** W0-04b.
- **Files:** `src/target/aarch64/backend/api/function-pipeline.ts`, `src/target/aarch64/backend/api/function-pipeline/allocation-stage.ts`, `src/target/aarch64/backend/api/function-pipeline/frame-finalization-stage.ts`, `tests/unit/remediation/w0-05b.test.ts`.
- **Do:** perform a pure move of allocation-pool construction, allocation invocation, frame-finalization orchestration, and their local helper types into the two new modules. Re-export through the existing function-pipeline API.
- **Test/example:** `compileAArch64FunctionToObjectModule` keeps the same import path and returns byte-identical object modules for existing backend fixtures.
- **AC:** backend end-to-end tests pass; fixture object-module fingerprints are unchanged; later W1-01/W2-14/W5-01/W5-04 tasks can touch the smaller stage modules.

#### W0-05c — Split semantic-surface checker contract/resource seams

- **Depends:** W0-04b.
- **Files:** `src/semantic/surface/semantic-surface-checker.ts`, `src/semantic/surface/contract-type-identity.ts`, `src/semantic/surface/dataclass-resource-checker.ts`, `src/semantic/surface/resource-kind-worklist.ts`, `tests/unit/remediation/w0-05c.test.ts`
- **Do:** perform a pure move of stdlib contract type identity helpers, dataclass field resource checks, and resource-kind fixpoint logic into the new modules. Keep `checkSemanticSurface` as the orchestration entry point.
- **Test/example:** `checkSemanticSurface(input)` produces deep-equal checked surfaces before and after the split on existing fixtures.
- **AC:** semantic surface tests pass with no diagnostic/golden changes; later W1-10/W1-12/W4-08 tasks modify the new focused files.

#### W0-05d — Split opt-ir operation schema by domain

- **Depends:** W0-04b.
- **Files:** `src/opt-ir/operations.ts`, `src/opt-ir/operations/scalar-operations.ts`, `src/opt-ir/operations/aggregate-operations.ts`, `src/opt-ir/operations/memory-operations.ts`, `tests/unit/remediation/w0-05d.test.ts`
- **Do:** perform a pure move of scalar, aggregate, and memory operation type/factory definitions into domain modules and re-export the existing public surface from `operations.ts`.
- **Test/example:** existing imports from `src/opt-ir/operations.ts` continue to typecheck without edits outside the split.
- **AC:** `bun run typecheck` and opt-ir tests pass; no operation kind strings or serialized forms change.

#### W0-05e — Split proof-MIR iterator and origin lowering seams

- **Depends:** W0-04b.
- **Files:** `src/proof-mir/lower/iterator-lowerer.ts`, `src/proof-mir/lower/iterator-lowering/array-for-lowerer.ts`, `src/proof-mir/lower/iterator-lowering/stream-for-lowerer.ts`, `src/proof-mir/lower/iterator-lowering/synthetic-origin-ids.ts`, `tests/unit/remediation/w0-05e.test.ts`
- **Do:** perform a pure move of array-loop lowering, stream-loop placeholder logic, and synthetic origin-id allocation helpers into focused modules. Keep the old iterator-lowerer entry point.
- **Test/example:** an existing array `for` fixture lowers to deep-equal proof-MIR before and after the split.
- **AC:** proof-MIR lowering tests pass; later W2-08/W3-02 tasks edit the focused modules instead of expanding `iterator-lowerer.ts`.

#### W0-05f — Split mono reachability traversal from mono state tables

- **Depends:** W0-04b.
- **Files:** `src/mono/reachability.ts`, `src/mono/reachability/work-items.ts`, `src/mono/reachability/state-table.ts`, `tests/unit/remediation/w0-05f.test.ts`
- **Do:** perform a pure move of work-item processing and state-table helpers into the new modules while preserving traversal behavior.
- **Test/example:** existing mono fixture output is byte-identical before and after the split.
- **AC:** mono tests pass; later W1-17/W7-01 tasks modify the focused reachability modules instead of growing `reachability.ts`.

### WAVE 1 — Correctness stop-the-line

#### W1-01a — Remove callee-saved GPRs from the interim public allocation pool

- **Depends:** W0-05b.
- **Files:** `src/target/aarch64/backend/api/function-pipeline.ts`, `tests/unit/target/aarch64/backend/callee-saved-pool.test.ts`.
- **Do:** filter `publicCalleeSavedGprs` out of `allocationRegisterPools` until full save/restore lands in W5-01.
- **Test/example:** `expect(allocatedRegisters).not.toContain("x20");`.
- **AC:** a pressure test allocates without x19-x28; existing full-image validation remains green.

#### W1-01b — Add the ABI verifier for unpreserved callee-saved registers

- **Depends:** W1-01a.
- **Files:** `src/target/aarch64/verify/abi-verifier.ts`, `tests/unit/target/aarch64/backend/callee-saved-pool.test.ts`.
- **Do:** report `AARCH64_ABI_CALLEE_SAVED_UNPRESERVED` when an allocation segment uses a callee-saved register absent from `savedRegisters`.
- **Test/example:** `expect(diagnostics.map((d) => d.code)).toContain("AARCH64_ABI_CALLEE_SAVED_UNPRESERVED");`.
- **AC:** a hand-crafted x20 allocation fails in the verifier; ordinary generated allocations pass.

#### W1-01c — Apply the same interim policy to callee-saved SIMD registers

- **Depends:** W1-01b.
- **Files:** `src/target/aarch64/backend/api/physical-register-model.ts`, `src/target/aarch64/backend/api/function-pipeline.ts`, `tests/unit/remediation/w1-01c.test.ts`.
- **Do:** model v8-v15/d8-d15 as public callee-saved and exclude them until W5-01 preserves them.
- **Test/example:** `expect(vectorPool).not.toContain("v8");`.
- **AC:** vector allocation tests show v8-v15 are unavailable unless saved.

#### W1-02a — Remove unsupported `pub` from repo fixtures and stdlib

- **Depends:** W0-02a, W0-02b, W0-02c.
- **Files:** `stdlib/**/*.wr`, `tests/fixtures/**/*.wr`.
- **Do:** delete `pub ` from all `.wr` sources because `pub` is not a language keyword in this plan.
- **Test/example:** `rg -n "\\bpub\\s+" stdlib tests/fixtures` returns no matches.
- **AC:** the source sweep is complete and existing fixtures still parse.

#### W1-02b — Reject top-level non-declarations in the parser

- **Depends:** W1-02a.
- **Files:** `src/frontend/parser/source-file-parser.ts`, `src/frontend/parser/parser-diagnostics.ts`.
- **Do:** when declaration parsing fails at top level, report `PARSE_EXPECTED_TOP_LEVEL_DECLARATION` and recover to the next top-level starter.
- **Test/example:** `expect(codes).toEqual(["PARSE_EXPECTED_TOP_LEVEL_DECLARATION"]);`.
- **AC:** `banana zebra unicorn` and `pub fn helper()` each produce one diagnostic.

#### W1-02c — Flip corpus expectations for top-level rejection

- **Depends:** W1-02b.
- **Files:** `tests/fixtures/diagnostics/top-level-garbage/expected.json`, `tests/fixtures/diagnostics/pub-fn/expected.json`.
- **Do:** replace tracked zero-diagnostic expectations with the new parser code and span text.
- **Test/example:** `{"code":"PARSE_EXPECTED_TOP_LEVEL_DECLARATION","spanText":"banana","count":1}`.
- **AC:** `bun test tests/system/diagnostics` passes with the corrected expectations.

#### W1-03a — Specify and store cooked string values in lexer tokens

- **Depends:** W0-02a, W0-02b, W0-02c.
- **Files:** `docs/language/happy.md`, `src/frontend/lexer/lexer.ts`, `src/frontend/lexer/token.ts`, `tests/unit/frontend/lexer/string-literal.test.ts`.
- **Do:** define the escape grammar and add a cooked string side channel while preserving raw reconstruct text.
- **Test/example:** `expect(token.cookedValue).toBe("A\\n");`.
- **AC:** valid escapes cook correctly; `tree.reconstruct()` still equals the original source.

#### W1-03b — Diagnose invalid and unterminated string escapes exactly once

- **Depends:** W1-03a.
- **Files:** `src/frontend/lexer/lexer.ts`, `src/frontend/lexer/diagnostics.ts`, `tests/fixtures/diagnostics/bad-escape/input.wr`, `tests/fixtures/diagnostics/bad-escape/expected.json`, `tests/fixtures/diagnostics/unterminated-string/input.wr`, `tests/fixtures/diagnostics/unterminated-string/expected.json`.
- **Do:** report `LEX_INVALID_ESCAPE` for unknown escapes and one `LEX_UNTERMINATED_STRING` for a trailing backslash before newline/EOF.
- **Test/example:** `expect(codes).toEqual(["LEX_INVALID_ESCAPE"]);`.
- **AC:** `"\q"` produces one invalid-escape diagnostic; `"abc\` at EOF produces one unterminated-string diagnostic.

#### W1-03c — Consume cooked strings in HIR and intrinsic collection

- **Depends:** W1-03b.
- **Files:** `src/frontend/ast/expression-views.ts`, `src/hir/expression-lowerer.ts`, `src/semantic/surface/compiler-intrinsic-collector.ts`.
- **Do:** lower string literals from `LiteralExpressionView.cookedStringValue()` and delete the `JSON.parse` fallback path.
- **Test/example:** `expect(hirLiteral.value).toBe("hello");`.
- **AC:** grep confirms `JSON.parse` no longer appears in the intrinsic collector; string literal tests pass.

#### W1-04a — Add canonical integer literal parsing

- **Depends:** W0-02a, W0-02b, W0-02c.
- **Files:** `src/frontend/lexer/lexer.ts`, `src/frontend/lexer/diagnostics.ts`, `src/shared/integer-literal.ts`, `src/hir/expression-lowerer.ts`, `src/hir/layout-expression-lowerer.ts`, `src/hir/requirement-lowerer.ts`, `tests/unit/frontend/lexer/integer-literal.test.ts`, `tests/unit/hir/integer-literal-lowering.test.ts`.
- **Do:** lex decimal separators, `0x`, and `0b`, and route all BigInt conversion through `parseWrIntegerLiteral`.
- **Test/example:** `expect(parseWrIntegerLiteral("0x1F")).toBe(31n);`.
- **AC:** malformed literals report `LEX_MALFORMED_INTEGER`; valid literal forms lower to the same bigint value everywhere.

#### W1-04b — Enforce statement separators

- **Depends:** W1-04a.
- **Files:** `src/frontend/parser/block-parser.ts`, `tests/fixtures/diagnostics/statement-separator/input.wr`, `tests/fixtures/diagnostics/statement-separator/expected.json`.
- **Do:** after a parsed statement, require newline/dedent/EOF or a valid statement continuation.
- **Test/example:** `expect(codes).toContain("PARSE_EXPECTED_STATEMENT_SEPARATOR");`.
- **AC:** `return 0 x1F` no longer parses silently as two same-line statements.

#### W1-05a — Site-discriminate draft control-edge roles

- **Depends:** none.
- **Files:** `src/proof-mir/draft/draft-keys.ts`, `src/proof-mir/draft/draft-graph-terminators.ts`, `tests/unit/remediation/w1-05a.test.ts`
- **Do:** compose branch/validation/panic edge roles from edge kind plus `fromBlock`.
- **Test/example:** `expect(new Set(edgeKeys).size).toBe(edgeKeys.length);`.
- **AC:** two `if` statements in one function produce four distinct branch edge keys.

#### W1-05b — Reject duplicate draft edge and exit keys

- **Depends:** W1-05a.
- **Files:** `src/proof-mir/draft/draft-graph-terminators.ts`, `tests/unit/remediation/w1-05b.test.ts`
- **Do:** check `edges.has(edgeKey)` and exit-key duplicates before mutation.
- **Test/example:** `expect(() => createDuplicateEdge()).toThrow(/duplicate.*edge/i);`.
- **AC:** deliberate duplicate insertion fails before overwrite; normal lowering is unchanged.

#### W1-05c — Add an end-to-end two-branch fixture

- **Depends:** W1-05b.
- **Files:** `tests/fixtures/full-image-validation/two-branch-control-flow/toolchain-stdlib/src/image.wr`, `tests/fixtures/full-image-validation/two-branch-control-flow/ejected-stdlib/src/image.wr`, `tests/fixtures/full-image-validation/two-branch-control-flow/direct-platform/src/image.wr`, `src/validation/full-image/matrix.ts`.
- **Do:** add a `.wr` source with two sequential `if` statements and validate it through full-image fixtures.
- **Test/example:** `if first:\n    ...\nif second:\n    ...` is the source shape.
- **AC:** full-image validation passes and canonical-key snapshot churn is limited to edge-key shapes.

#### W1-06a — Derive predecessor sets in the proof-MIR graph validator

- **Depends:** W1-05a, W1-05b, W1-05c.
- **Files:** `src/proof-mir/validation/graph-validator.ts`, `tests/unit/remediation/w1-06a.test.ts`
- **Do:** build `Map<blockId, Set<edgeId>>` from terminator edges and edge records.
- **Test/example:** `expect(derived.get(targetBlock)).toEqual(new Set([edgeA, edgeB]));`.
- **AC:** well-formed graphs derive the same incoming edge sets stored by builders.

#### W1-06b — Diagnose stored `incomingEdges` mismatches

- **Depends:** W1-06a.
- **Files:** `src/proof-mir/diagnostics.ts`, `src/proof-mir/validation/graph-validator.ts`.
- **Do:** compare derived and stored incoming edges and report `PROOF_MIR_INCOMING_EDGES_MISMATCH`.
- **Test/example:** `expect(stableDetail).toContain("missing:");`.
- **AC:** missing, extra, duplicate, and wrong-from-block cases each fail with the new code.

#### W1-07a — Fix symlink containment with `path.relative`

- **Depends:** none.
- **Files:** `src/frontend/lexer/bun-file-repository.ts`, `tests/unit/frontend/lexer/file-repository.test.ts`.
- **Do:** replace prefix containment with a relative-path escape check on both lexical and real paths.
- **Test/example:** `expect(result.kind).toBe("unreadable");` for `root/link.wr -> ../root-evil/secret.wr`.
- **AC:** outside symlinks are rejected; inside symlinks still load.

#### W1-08a — Reproduce return-of-parameter inlining as a verifier failure

- **Depends:** none.
- **Files:** `tests/unit/opt-ir/whole-program-inlining.test.ts`.
- **Do:** add failing tests for identity callee and callee returning a parameter after using it.
- **Test/example:** `fn id(x) { return x }` should leave every result use defined after inlining.
- **AC:** tests fail before implementation because the call result has no defining op or cloned ops use the wrong id.

#### W1-08b — Split operand substitution from return-result binding

- **Depends:** W1-08a.
- **Files:** `src/opt-ir/passes/whole-program-inlining.ts`.
- **Do:** keep `param -> arg` for cloned operands and append a copy into the call result when a return value is external to cloned ops.
- **Test/example:** `expect(verifyPipelineState(inlined).diagnostics).toHaveLength(0);`.
- **AC:** identity and return-parameter cases inline verifier-clean.

#### W1-09a — Add target-owned endian-fold contract fields

- **Depends:** none.
- **Files:** `src/opt-ir/target-surface.ts`, `src/target/uefi-aarch64/package-pipeline.ts`, `src/target/uefi-aarch64/binary-spine.ts`, `tests/unit/remediation/w1-09a.test.ts`.
- **Do:** add `endianFoldContract` to `OptIrTargetSurface` and populate it at target construction.
- **Test/example:** `expect(surface.endianFoldContract.permitsFirmwareEndianFold).toBe(false);`.
- **AC:** the contract is target data, not pass-local hardcoding.

#### W1-09b — Thread target contract into the Wrela endian pass

- **Depends:** W1-09a.
- **Files:** `src/opt-ir/passes/pipeline-steps.ts`, `src/opt-ir/passes/pipeline-dispatch.ts`, `tests/unit/remediation/w1-09b.test.ts`
- **Do:** pass `input.target` into `runWrelaCluster` and the endian-collapse step.
- **Test/example:** a fake target with `permitsFirmwareEndianFold: true` reaches the candidate pass.
- **AC:** grep shows the hardcoded contract literal is gone from `pipeline-steps.ts`.

#### W1-10a — Resolve canonical stdlib contract type IDs

- **Depends:** W0-05c.
- **Files:** `src/semantic/surface/semantic-surface-checker.ts`, `src/semantic/names/core-types.ts`, `src/semantic/names/module-namespace.ts`, `tests/unit/remediation/w1-10a.test.ts`.
- **Do:** compute `resultTypeId`, `validationTypeId`, and `attemptTypeId` only from `wrela_std.core` modules.
- **Test/example:** `expect(contractTypeIds.resultTypeId).toBe(stdlibResult.typeId);`.
- **AC:** user-defined `Result` types outside stdlib are not recognized as contracts.

#### W1-10b — Replace bare-name attempt/validation inference

- **Depends:** W1-10a.
- **Files:** `src/semantic/surface/semantic-surface-checker.ts`, `src/semantic/surface/proof-contracts/validation-attempt.ts`, `tests/unit/remediation/w1-10b.test.ts`.
- **Do:** swap `"Result"`/`"Validation"`/`"Attempt"` name checks for canonical type-id equality.
- **Test/example:** `expect(surface.attemptContracts).not.toContain(userResultTypeId);`.
- **AC:** stdlib contracts still infer; user collisions do not.

#### W1-11a — Introduce a first-class local scope tier

- **Depends:** W0-05a.
- **Files:** `src/semantic/names/scope.ts`, `src/semantic/names/expression-resolver.ts`.
- **Do:** replace `ReadonlySet<string>` local tracking with records `{ name, span, ordinal }` and consult locals before outer scopes.
- **Test/example:** `expect(reference.kind).toBe("local");`.
- **AC:** a local variable named like a module function resolves to the local.

#### W1-11b — Emit local reference records and document shadowing

- **Depends:** W1-11a.
- **Files:** `src/semantic/names/diagnostics.ts`, `src/semantic/names/reference.ts`, `src/semantic/names/resolution-result.ts`, `docs/language/happy.md`, `tests/unit/remediation/w1-11b.test.ts`.
- **Do:** add `{ kind: "local" }` references and document "locals shadow outers".
- **Test/example:** `expect(referenceKindFromResolved(localRef)).toBe("local");`.
- **AC:** pattern bindings and block locals both shadow parameters/items consistently.

#### W1-12a — Preserve applied constructor resource kind at semantic surface

- **Depends:** none.
- **Files:** `src/semantic/surface/resource-kind-checker.ts`, `src/semantic/surface/resource-kind.ts`.
- **Do:** apply constructor kind rules before falling back to argument joins.
- **Test/example:** `expect(resourceKindForType(streamOfU32).kind).toBe("Stream");`.
- **AC:** semantic and mono resource-kind derivations agree on applied constructors.

#### W1-12b — Reject affine fields in ordinary dataclasses

- **Depends:** W0-05c, W1-12a.
- **Files:** `src/semantic/surface/semantic-surface-checker.ts`, `src/semantic/surface/diagnostics.ts`, `tests/fixtures/diagnostics/dataclass-affine-field/input.wr`, `tests/fixtures/diagnostics/dataclass-affine-field/expected.json`.
- **Do:** report `SEMANTIC_DATACLASS_AFFINE_FIELD` when a dataclass field is proof-relevant or affine.
- **Test/example:** `expect(codes).toContain("SEMANTIC_DATACLASS_AFFINE_FIELD");`.
- **AC:** dataclass affine-field fixtures fail at semantic surface with a source span.

#### W1-13a — Hoist parsed import discovery into the module graph loader

- **Depends:** W1-02a, W1-02b, W1-02c.
- **Files:** `src/frontend/lexer/module-graph-lexer.ts`, `src/frontend/parser/import-declaration-parser.ts`, `src/frontend/ast/declaration-views.ts`, `src/frontend/ast/name-views.ts`, `tests/unit/remediation/w1-13a.test.ts`.
- **Do:** lex and parse each file once, then walk top-level `ImportDeclaration` views for module requests.
- **Test/example:** `expect(importRequests.map((r) => r.moduleName)).toEqual(["wrela_std.core"]);`.
- **AC:** top-level imports produce the same request shape without the lexical second grammar.

#### W1-13b — Delete nested-use import edges and retire lexical discovery

- **Depends:** W1-13a.
- **Files:** `src/frontend/lexer/import-discovery.ts`, `tests/integration/frontend/lexer/import-discovery-fuzz.test.ts`, `tests/unit/remediation/w1-13b.test.ts`.
- **Do:** re-point import-discovery fuzz at parsed imports and delete the old lexical discovery module.
- **Test/example:** `use x from evil` inside a function yields a parse diagnostic and no missing-module diagnostic for `evil`.
- **AC:** `src/frontend/lexer/import-discovery.ts` is gone and all import tests pass.

#### W1-14a — Replace proof/canonicalization `JSON.stringify` with stable JSON

- **Depends:** none.
- **Files:** `src/proof-check/validation/input-validator.ts`, `src/proof-mir/canonicalization/program-freeze-shared.ts`.
- **Do:** use `stableJson` for authority fingerprints and canonical keys.
- **Test/example:** `expect(fingerprint(objectA)).toBe(fingerprint(objectB));` where key insertion order differs.
- **AC:** fingerprint goldens update only for expected stable-json changes.

#### W1-14b — Add an audit for unstable serialization in proof paths

- **Depends:** W1-14a.
- **Files:** `tests/audit/subsystem-maintainability-audit.test.ts`.
- **Do:** fail if new `JSON.stringify` appears in proof-MIR canonicalization or proof-check validation.
- **Test/example:** `expect(offenders).toEqual([]);`.
- **AC:** reintroducing raw stringify in those paths fails locally.

#### W1-15a — Emit diagnostics for missing entry modules and per-site missing imports

- **Depends:** none.
- **Files:** `src/frontend/lexer/module-graph-lexer.ts`, `src/frontend/lexer/diagnostics.ts`.
- **Do:** separate attempted/loaded state and report `LEX_MODULE_READ_FAILED` for entry and every import site.
- **Test/example:** `expect(codes).toEqual(["LEX_MODULE_READ_FAILED", "LEX_MODULE_READ_FAILED"]);` for two missing import sites.
- **AC:** missing entry modules never produce an empty success.

#### W1-15b — Convert module path throws into diagnostics

- **Depends:** W1-15a.
- **Files:** `src/frontend/lexer/module-path.ts`, `src/frontend/lexer/module-resolver.ts`.
- **Do:** return a result for invalid NUL/absolute/parent/drive paths and emit `LEX_MODULE_PATH_INVALID`.
- **Test/example:** `expect(() => resolve("../evil")).not.toThrow();`.
- **AC:** invalid module paths are user diagnostics, never bare throws.

#### W1-16a — Fix pattern member span indexing

- **Depends:** W0-05a.
- **Files:** `src/semantic/names/expression-resolver.ts`, `tests/unit/remediation/w1-16a.test.ts`.
- **Do:** replace `segTexts.indexOf(memberName)` with the current member segment index.
- **Test/example:** `expect(secondBSpan.start).not.toBe(firstBSpan.start);`.
- **AC:** `A.b.b` reports/references the second `b` at the second span.

#### W1-16b — Diagnose image-name misuse as not-a-value

- **Depends:** none.
- **Files:** `src/hir/expression-lowerer.ts`, `src/hir/diagnostics.ts`, `tests/fixtures/diagnostics/image-name-not-value/input.wr`, `tests/fixtures/diagnostics/image-name-not-value/expected.json`.
- **Do:** replace silent error-typed image-name expressions with `HIR_IMAGE_NAME_NOT_A_VALUE`.
- **Test/example:** `expect(codes).toContain("HIR_IMAGE_NAME_NOT_A_VALUE");`.
- **AC:** using an image name as a call argument reports the new code.

#### W1-16c — Put unsupported index-expression diagnostics on the index span

- **Depends:** none.
- **Files:** `src/frontend/parser/expression-parser.ts`, `src/frontend/parser/parser-diagnostics.ts`, `tests/fixtures/diagnostics/unsupported-index-expression/input.wr`, `tests/fixtures/diagnostics/unsupported-index-expression/expected.json`.
- **Do:** report `PARSE_UNSUPPORTED_INDEX_EXPRESSION` spanning `[` through `]`.
- **Test/example:** `{"code":"PARSE_UNSUPPORTED_INDEX_EXPRESSION","spanText":"[0]","count":1}`.
- **AC:** corpus verifies exact span text.

#### W1-16d — Type-check binary and unary operands in HIR

- **Depends:** none.
- **Files:** `src/hir/expression-lowerer.ts`, `src/hir/diagnostics.ts`, `tests/fixtures/diagnostics/binary-type-mismatch/input.wr`, `tests/fixtures/diagnostics/binary-type-mismatch/expected.json`, `tests/fixtures/diagnostics/unary-type-mismatch/input.wr`, `tests/fixtures/diagnostics/unary-type-mismatch/expected.json`.
- **Do:** report mismatch and integer-required diagnostics for mixed or unsupported arithmetic.
- **Test/example:** `"s" + 5` yields `HIR_BINARY_OPERAND_TYPE_MISMATCH`.
- **AC:** `"s"+5`, `1+"s"`, and `-x` each produce deterministic HIR diagnostics.

#### W1-16e — Default unconstrained integer literals to `u64`

- **Depends:** W1-04a.
- **Files:** `src/hir/expression-lowerer.ts`, `src/hir/layout-expression-lowerer.ts`, `tests/unit/remediation/w1-16e.test.ts`.
- **Do:** change the unconstrained integer default from `u32` to `u64` while preserving annotated range checks.
- **Test/example:** `let x = 5000000000` compiles; `let y: u32 = 5000000000` fails.
- **AC:** large unconstrained literals no longer fail spuriously.

#### W1-16f — Remove silent first-picks, fabricated layout keys, and grandfathered `as any`

- **Depends:** W0-05a, W0-03b.
- **Files:** `src/semantic/names/expression-resolver.ts`, `src/layout/platform-abi.ts`, `src/layout/aggregate-layout.ts`, `tests/audit/subsystem-maintainability-audit.test.ts`, `tests/unit/remediation/w1-16f.test.ts`.
- **Do:** diagnose ambiguous matches, reject ambiguous platform function instances, return `undefined` instead of fabricated mono ids, and type the candidate records.
- **Test/example:** `expect(codes).toContain("LAYOUT_PLATFORM_FUNCTION_INSTANCE_AMBIGUOUS");`.
- **AC:** no grandfathered `as any` remains in semantic name resolvers.

#### W1-17a — Add a failed state to mono reachability work items

- **Depends:** W0-05f.
- **Files:** `src/mono/reachability.ts`, `tests/unit/remediation/w1-17a.test.ts`
- **Do:** set work state to `"failed"` on shell/body instantiation errors and make lookup consumers hard-stop on failed entries.
- **Test/example:** `expect(workItem.state).toBe("failed");`.
- **AC:** failed mono items are never marked completed.

#### W1-17b — Delete fake unreachable predecessor handling

- **Depends:** none.
- **Files:** `src/proof-check/kernel/graph-worklist-join-coordinator.ts`.
- **Do:** remove `JoinPredecessorCandidate.unreachable` if the only producer hardcodes `false`.
- **Test/example:** `rg -n "unreachable: false" src/proof-check` returns no matches.
- **AC:** proof-check tests pass and the dead field is gone.

#### W1-17c — Replace fabricated iterator rejection origin with real source origin

- **Depends:** none.
- **Files:** `src/proof-mir/lower/iterator-lowerer.ts`, `src/proof-mir/lower/lowering-origins.ts`, `tests/unit/remediation/w1-17c.test.ts`.
- **Do:** use `input.monoStatement.sourceOrigin` instead of `proofMirOriginId(1)`.
- **Test/example:** `expect(diagnostic.originId).toBe(statement.sourceOrigin);`.
- **AC:** unsupported stream-loop diagnostics point at the real statement.

### WAVE 2 — Fail-closed phase boundaries

#### W2-01a — Add an exhaustive proof-MIR statement reference collector skeleton

- **Depends:** W1-05a, W1-05b, W1-05c, W1-06a, W1-06b.
- **Files:** `src/proof-mir/validation/reference-collector.ts`, `src/proof-mir/validation/graph-validator.ts`, `tests/unit/remediation/w2-01a.test.ts`.
- **Do:** introduce `collectStatementReferences` with reads/writes/facts/loans/sessions/layoutTerms arrays and an exhaustive `never` arm.
- **Test/example:** `const unreachable: never = statement;` is present in the default arm.
- **AC:** adding a statement kind without collector support is a TypeScript error.

#### W2-01b — Wire scalar read/write validation through the collector

- **Depends:** W2-01a.
- **Files:** `src/proof-mir/validation/graph-validator.ts`, `tests/unit/remediation/w2-01b.test.ts`
- **Do:** replace the old scalar-use collector and classify `readValidatedBufferField.result` as a write.
- **Test/example:** `expect(references.writes).toContain(resultRef);`.
- **AC:** dangling scalar reads/writes produce one deterministic diagnostic each.

#### W2-01c — Wire layout/fact/loan/session dangling checks through the collector

- **Depends:** W2-01b.
- **Files:** `src/proof-mir/validation/layout-validator.ts`, `src/proof-mir/validation/operand-validator.ts`.
- **Do:** validate every non-scalar reference category against its table.
- **Test/example:** `expect(stableDetail).toContain("loan");`.
- **AC:** each reference category has one negative test and full fixtures remain clean.

#### W2-02a — Add a source-adjacent opt-ir aggregate-leftover verifier gate

- **Depends:** none.
- **Files:** `src/opt-ir/verify/structural-verifier.ts`, `src/opt-ir/verify/pass-invariant-schema.ts`, `src/opt-ir/diagnostics.ts`, `tests/unit/remediation/w2-02a.test.ts`.
- **Do:** scan after final verification for `aggregateConstruct`/`aggregateExtract`/`aggregateInsert` and report `OPT_IR_UNLOWERED_AGGREGATE`.
- **Test/example:** `expect(codes).toContain("OPT_IR_UNLOWERED_AGGREGATE");`.
- **AC:** hand-built aggregate opt-ir fails with an origin id; existing fixtures pass.

#### W2-03a — Match linker section-RVA rules to the PE writer

- **Depends:** none.
- **Files:** `src/linker/verifier.ts`, `src/linker/linked-image-layout.ts`, `src/linker/diagnostics.ts`, `tests/unit/remediation/w2-03a.test.ts`.
- **Do:** require exact first-section RVA and virtual-order contiguity before writer handoff.
- **Test/example:** `expect(codes).toContain("LINKER_LAYOUT_FIRST_SECTION_RVA_MISMATCH");`.
- **AC:** doctored layouts fail in the linker verifier, not only the PE writer.

#### W2-03b — Promote slow contribution recomputation into production verifier

- **Depends:** W2-03a.
- **Files:** `src/linker/contribution-recompute.ts`, `tests/support/linker/slow-linked-image-validator.ts`, `src/linker/verifier.ts`.
- **Do:** extract recomputation into `src/linker` and call it from production verification.
- **Test/example:** `expect(recomputeLinkedImageContributions(image).diagnostics).toEqual([]);`.
- **AC:** test support imports the production recompute module; corruption tests fail at production verifier time.

#### W2-04a — Check relocation-pair reciprocity in object verification

- **Depends:** none.
- **Files:** `src/target/aarch64/backend/verify/object-verifier-contract.ts`, `src/target/aarch64/backend/verify/encoding-object-verifier.ts`, `src/target/aarch64/backend/verify/object-verifier-byte-provenance.ts`, `tests/unit/remediation/w2-04a.test.ts`.
- **Do:** require pair keys to be reciprocal and to resolve to the same target.
- **Test/example:** `expect(codes).toContain("AARCH64_OBJECT_RELOCATION_PAIR_MISMATCH");`.
- **AC:** one-way pair-key objects fail before linking.

#### W2-04b — Emit or reject large stack adjustments before encoding

- **Depends:** none.
- **Files:** `src/target/aarch64/backend/frame/frame-layout.ts`, `src/target/aarch64/backend/api/frame-instructions.ts`, `src/target/aarch64/backend/verify/frame-verifier.ts`, `tests/unit/remediation/w2-04b.test.ts`.
- **Do:** add `stackAdjustInstructions(totalSizeBytes)` supporting multi-instruction legal adjustments and `AARCH64_FRAME_TOO_LARGE`.
- **Test/example:** `expect(stackAdjustInstructions(5000).length).toBeGreaterThan(1);`.
- **AC:** 5000-byte frames encode; 20MB frames fail at frame layout with the named code.

#### W2-05a — Add opcode-to-encoder coverage audit

- **Depends:** none.
- **Files:** `tests/audit/aarch64-encoding-coverage-audit.test.ts`.
- **Do:** enumerate catalog opcodes and encode canonical sample operands for each real opcode.
- **Test/example:** `expect(result.kind).not.toBe("unsupported-opcode");`.
- **AC:** deleting an encoder branch fails the audit.

#### W2-06a — Preserve source diagnostics in the target diagnostic envelope

- **Depends:** none.
- **Files:** `src/target/uefi-aarch64/diagnostics.ts`, `src/target/uefi-aarch64/package-pipeline.ts`.
- **Do:** add optional `source` payload and map every underlying diagnostic to an enveloped target diagnostic with original code, message, file, and offsets.
- **Test/example:** `expect(diag.source?.originalCode).toBe("PARSE_EXPECTED_TOP_LEVEL_DECLARATION");`.
- **AC:** frontend errors no longer flatten to `frontend-diagnostics:<count>`.

#### W2-06b — Render preserved source locations in validation reports

- **Depends:** W2-06a.
- **Files:** `src/validation/full-image/runner.ts`, `scripts/validate-full-image.ts`, `src/shared/source-text.ts`.
- **Do:** print `file:line:col code message` when diagnostic source payloads are present.
- **Test/example:** `expect(report).toContain("image.wr:1:1 PARSE_");`.
- **AC:** human full-image output contains source locations for bad fixtures.

#### W2-07a — Type reachable platform primitive IDs end to end

- **Depends:** none.
- **Files:** `src/target/uefi-aarch64/package-pipeline.ts`, `src/opt-ir/program.ts`.
- **Do:** replace `readonly unknown[]` and `CheckedFunctionSummary | unknown` seams with concrete types.
- **Test/example:** `const ids: readonly PlatformPrimitiveId[] = reachablePlatformPrimitiveIds;`.
- **AC:** `bun run typecheck` passes with no new casts.

#### W2-07b — Diff reachable primitives against emitted runtime helpers

- **Depends:** W2-07a.
- **Files:** `src/target/uefi-aarch64/binary-spine.ts`, `src/target/uefi-aarch64/diagnostics.ts`, `tests/unit/remediation/w2-07b.test.ts`.
- **Do:** compare reachable primitive ids to helper objects and report `UEFI_AARCH64_PRIMITIVE_COVERAGE_MISMATCH` on symmetric differences.
- **Test/example:** `expect(stableDetail).toContain("missing:");`.
- **AC:** dropping one helper object is caught deterministically.

#### W2-08a — Replace proof-MIR lowering origin casts with a tagged union

- **Depends:** none.
- **Files:** `src/proof-mir/lower/lowering-origins.ts`, `src/proof-mir/lower/function-lowerer.ts`, `src/proof-mir/lower/statement-lowerer.ts`, `src/proof-mir/lower/expression-lowerer.ts`, `src/proof-mir/lower/iterator-lowerer.ts`, `src/proof-mir/lower/call-lowerer.ts`, `tests/unit/remediation/w2-08a.test.ts`.
- **Do:** model origins as `{ kind: "statement" | "expression" | "parameter" | "functionShell"; ... }` and remove all `as never` casts under lowering.
- **Test/example:** `switch (origin.kind) { case "statement": return origin.statementId; }`.
- **AC:** `rg -n "as never" src/proof-mir/lower` returns no matches.

#### W2-08b — Allocate synthetic HIR expression ids from a lowering counter

- **Depends:** W0-05e, W2-08a.
- **Files:** `src/proof-mir/lower/iterator-lowerer.ts`, `src/proof-mir/lower/lowering-context.ts`, `tests/unit/remediation/w2-08b.test.ts`.
- **Do:** replace `hirExpressionId(101)` and `hirExpressionId(102)` with `nextSyntheticHirExpressionId()` seeded above real ids.
- **Test/example:** `expect(syntheticId.value).toBeGreaterThan(maxRealExpressionId.value);`.
- **AC:** every lowered proof-MIR node origin resolves to a source span.

#### W2-09a — Make rewrite/pass fact consumption declarative

- **Depends:** none.
- **Files:** `src/opt-ir/egraph/rule-catalog.ts`, `src/opt-ir/rewrites/catalog-rewrite-builders.ts`, `src/opt-ir/passes/wrela-optimizations/move-copy-wrapper-elision.ts`, `src/opt-ir/passes/wrela-optimizations/bounds-zero-copy.ts`, `src/opt-ir/passes/wrela-optimizations/terminal-platform-specialization.ts`, `tests/unit/remediation/w2-09a.test.ts`.
- **Do:** add `consumedFactFamilies` to applied rewrite/pass decision records.
- **Test/example:** `expect(decision.consumedFactFamilies).toContain("validated-region-shape");`.
- **AC:** all fact-consuming rewrites declare the family they consume.

#### W2-09b — Verify consumed facts are certified

- **Depends:** W2-09a.
- **Files:** `src/opt-ir/verify/fact-verifier.ts`, `src/opt-ir/verify/rewrite-legality.ts`, `tests/unit/remediation/w2-09b.test.ts`.
- **Do:** report `OPT_IR_UNCERTIFIED_FACT_CONSUMPTION` when a decision cites a fact absent from certified input.
- **Test/example:** `expect(codes).toContain("OPT_IR_UNCERTIFIED_FACT_CONSUMPTION");`.
- **AC:** fake rewrite consuming a nonexistent fact fails verification.

#### W2-10a — Add reducibility tripwire to proof-MIR validation

- **Depends:** W1-06a, W1-06b.
- **Files:** `src/proof-mir/validation/graph-validator.ts`, `src/proof-mir/diagnostics.ts`, `tests/unit/remediation/w2-10a.test.ts`.
- **Do:** compute dominators from derived CFG and report `PROOF_MIR_IRREDUCIBLE_CFG` when retreating edges target non-dominators.
- **Test/example:** `expect(codes).toContain("PROOF_MIR_IRREDUCIBLE_CFG");`.
- **AC:** hand-built irreducible graph fails; structured fixtures pass.

#### W2-10b — Record critical-edge counts without diagnosing

- **Depends:** W2-10a.
- **Files:** `src/proof-mir/validation/graph-validator.ts`.
- **Do:** compute multi-successor to multi-predecessor edge counts in validation summary for optimizer planning.
- **Test/example:** `expect(summary.criticalEdgeCount).toBe(1);`.
- **AC:** summary is deterministic and produces no user-facing diagnostic.

#### W2-11a — Parse policy imports with TypeScript AST

- **Depends:** none.
- **Files:** `scripts/check-policy.ts`, `tests/fixtures/policy/import-parsing.ts`, `tests/unit/remediation/w2-11a.test.ts`.
- **Do:** replace regex import/export parsing with `ts.createSourceFile` and AST walking.
- **Test/example:** `ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)`.
- **AC:** current policy output is byte-identical before/after; fixture violations include line/col.

#### W2-12a — Consolidate deterministic-sort copies

- **Depends:** none.
- **Files:** `src/shared/deterministic-sort.ts`, `src/hir/deterministic-sort.ts`, `src/layout/deterministic-sort.ts`, `src/mono/deterministic-sort.ts`, `src/opt-ir/deterministic-sort.ts`, `src/semantic/surface/deterministic-sort.ts`, `tests/audit/subsystem-maintainability-audit.test.ts`.
- **Do:** replace byte-identical or subset copies with imports/re-exports and mark true bespoke copies with `BESPOKE:`.
- **Test/example:** `export { deterministicSort } from "../shared/deterministic-sort";`.
- **AC:** audit allows only ≤3-line re-exports or bespoke-header copies outside `src/shared`.

#### W2-13a — Add PE/COFF UEFI conformance tests

- **Depends:** none.
- **Files:** `tests/integration/pe-coff/pe-coff-uefi-spec-conformance.test.ts`.
- **Do:** parse produced images and assert Machine, Subsystem, ImageBase, alignments, reloc directory, no DYNAMIC_BASE, and NX_COMPAT decision.
- **Test/example:** `expect(optionalHeader.subsystem).toBe(10);`.
- **AC:** conformance test fails on DYNAMIC_BASE and passes on current UEFI shape plus chosen NX_COMPAT behavior.

#### W2-13b — Implement standard PE checksum

- **Depends:** W2-13a.
- **Files:** `src/pe-coff/pe-file-layout.ts`, `src/pe-coff/aarch64/aarch64-pe-coff-efi-writer.ts`, `tests/unit/remediation/w2-13b.test.ts`.
- **Do:** calculate the PE checksum over the file with the checksum field zeroed plus file length.
- **Test/example:** `expect(parsed.optionalHeader.checksum).toBe(computePeChecksum(bytes));`.
- **AC:** checksum is nonzero for nonempty images and reproducible.

#### W2-13c — Make entry-thunk unwind and reloc offsets honest

- **Depends:** W2-13a.
- **Files:** `src/target/uefi-aarch64/entry-thunk.ts`.
- **Do:** either emit correct ARM64 unwind records for the fixed prologue or omit the records, and derive thunk relocation offsets from the instruction byte walk.
- **Test/example:** `expect(relocationPlan.map((r) => r.offset)).toEqual(encodedThunk.relocationOffsets);`.
- **AC:** no hash-byte fake xdata/pdata remains; relocation offsets have one source of truth.

#### W2-13d — Add image reproducibility test

- **Depends:** W2-13b, W2-13c.
- **Files:** `tests/integration/pe-coff/aarch64-efi-writer.test.ts`, `tests/integration/validation/full-image/full-image-validation-runner.test.ts`, `src/validation/full-image/determinism.ts`, `tests/unit/remediation/w2-13d.test.ts`.
- **Do:** build the same fixture twice and compare bytes and final fingerprint.
- **Test/example:** `expect(first.bytes).toEqual(second.bytes);`.
- **AC:** repeated image builds are byte-identical.

#### W2-14a — Audit wipe-on-spill cleanup on trap exits

- **Depends:** W0-05b.
- **Files:** `src/target/aarch64/backend/api/function-pipeline.ts`, `src/target/aarch64/backend/api/frame-instructions.ts`, `tests/audit/subsystem-maintainability-audit.test.ts`, `tests/unit/remediation/w2-14a.test.ts`.
- **Do:** create a wipe-on-spill function with return and trap exits; assert both paths zero the slot.
- **Test/example:** `expect(trapPathInstructions).toContainEqual(expect.objectContaining({ opcode: "str" }));`.
- **AC:** trap exits wipe the same security slots as returns.

#### W2-14b — Audit and fix ExitBootServices retry shape

- **Depends:** none.
- **Files:** `src/target/uefi-aarch64/exit-boot-services.ts`, `src/target/uefi-aarch64/runtime-helper-instructions.ts`, `tests/unit/target/uefi-aarch64/exit-boot-services.test.ts`, `tests/unit/target/uefi-aarch64/runtime-helper-objects.test.ts`.
- **Do:** ensure helper sequence is `GetMemoryMap -> ExitBootServices -> retry once on EFI_INVALID_PARAMETER with fresh map`.
- **Test/example:** `expect(sequence).toEqual(["GetMemoryMap", "ExitBootServices", "GetMemoryMap", "ExitBootServices"]);`.
- **AC:** golden checker proves the retry branch exists.

#### W2-15a — Add inline QEMU smoke execution to the compiler API

- **Depends:** W0-01a, W0-01b.
- **Files:** `src/target/uefi-aarch64/compile-uefi-aarch64-image.ts`, `src/target/uefi-aarch64/qemu-smoke.ts`.
- **Do:** accept `smoke: { kind: "run", hostEffects }`, invoke the existing runner after artifact creation, and return the real smoke report.
- **Test/example:** `expect(result.smoke.status).toBe("passed");` with a fake host runner.
- **AC:** non-disabled smoke no longer always returns `separate-runner-required`.

#### W2-15b — Add a skip-aware QEMU system test

- **Depends:** W2-15a.
- **Files:** `tests/system/uefi-aarch64/qemu-boot.test.ts`, `scripts/smoke-uefi-aarch64.ts`.
- **Do:** run packet-counter under QEMU when configured; otherwise skip with a deterministic reason.
- **Test/example:** `expect(report.markers).toContain("WRELA_UEFI_SMOKE_OK");`.
- **AC:** with QEMU installed the marker is required; without QEMU the skip reason is explicit.

### WAVE 3 — Language completeness

#### W3-01a — Trace and expose production proof-check limit sourcing

- **Depends:** none.
- **Files:** `src/proof-check/kernel/resource-limits.ts`, `src/proof-check/input-contract.ts`, `src/proof-check/proof-check-phases.ts`, `src/target/uefi-aarch64/package-pipeline.ts`, `tests/unit/remediation/w3-01a.test.ts`.
- **Do:** add a test proving what limits production currently passes and make the limit source explicit.
- **Test/example:** `expect(input.resourceLimits.profile).toBe("uefi-aarch64-rpi5");`.
- **AC:** no production proof-check call relies on an implicit test-limit default.

#### W3-01b — Add image-profile production proof-check limits

- **Depends:** W3-01a.
- **Files:** `src/proof-check/kernel/resource-limits.ts`, `src/proof-check/input-contract.ts`, `src/proof-check/proof-check-phases.ts`, `src/target/uefi-aarch64/package-pipeline.ts`.
- **Do:** implement `proofCheckResourceLimitsForImageProfile(profile)` with production-sized limits and named diagnostic messages.
- **Test/example:** `expect(limits.maxReachableFunctions).toBe(16384);`.
- **AC:** a synthetic program above the old 256-function cap passes under production limits.

#### W3-02a — Build the stream-loop CFG skeleton

- **Depends:** W0-05e, W1-05a, W1-05b, W1-05c, W1-06a, W1-06b, W2-01a, W2-01b, W2-01c, W3-01a, W3-01b.
- **Files:** `src/proof-mir/lower/iterator-lowerer.ts`, `tests/unit/remediation/w3-02a.test.ts`
- **Do:** replace the stream arm that currently returns `PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD` with draft-graph construction only. Build a header block, a `next` call statement, a terminus branch using W1-05 site-keyed `createBranchEdge`, a body block that binds the item local, a back-edge, and an exit block. Do not use the existing placeholder metadata keys `instantiatedHirIdKey(functionInstanceId, hirExpressionId(101))` or `hirExpressionId(102)`; resolve the real `next` function instance from `CheckedTakeModeSurface` and allocate synthetic ids through W2-08b's counter.
- **Test/example:** create `tests/unit/proof-mir/lower/stream-loop-cfg.test.ts` with a source fixture containing `for packet in packets:`; the first assertion is `expect(blockKinds).toEqual(["streamHeader", "streamBody", "streamExit"]);` and the pre-fix failure is the existing `PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD`.
- **AC:** `bun test tests/unit/proof-mir/lower/stream-loop-cfg.test.ts` passes; the lowered stream-loop CFG is accepted by the proof-MIR graph validator, even though W3-02b still owns proof obligations.

#### W3-02b — Wire stream-loop proof obligations

- **Depends:** W3-02a.
- **Files:** `src/proof-check/domains/loops.ts`, `src/proof-check/domains/stream-loop.ts`, `src/proof-check/domains/take-sessions.ts`, `src/proof-check/domains/validation.ts`, `tests/unit/remediation/w3-02b.test.ts`.
- **Do:** open item obligations on body entry, require discharge before back-edge, and discharge the stream on the exit edge.
- **Test/example:** dropping an item without discharge yields a proof-check diagnostic.
- **AC:** negative fixture fails proof-check; valid loop proof passes.

#### W3-02c — Enable `streamLoop` and add real-stream fixtures

- **Depends:** W3-02b.
- **Files:** `src/target/uefi-aarch64/runtime-catalog.ts`, `tests/fixtures/full-image-validation/packet-counter-real-stream/toolchain-stdlib/src/image.wr`, `tests/fixtures/full-image-validation/packet-counter-real-stream/ejected-stdlib/src/image.wr`, `tests/fixtures/full-image-validation/packet-counter-real-stream/direct-platform/src/image.wr`, `src/validation/full-image/matrix.ts`.
- **Do:** enable `streamLoop` for UEFI and add packet-counter-real-stream fixtures across applicable stdlib modes.
- **Test/example:** `expect(features).toContain("streamLoop");`.
- **AC:** real stream fixture compiles and validates; QEMU marker passes when QEMU is configured.

#### W3-02d — Update stream-loop docs and disabled-target diagnostic

- **Depends:** W3-02c.
- **Files:** `docs/language/happy.md`, `docs/implementation/2026-07-03-source-level-uefi-bringup-plan.md`, `tests/fixtures/diagnostics/stream-loop-disabled-target/input.wr`, `tests/fixtures/diagnostics/stream-loop-disabled-target/expected.json`.
- **Do:** document stream-loop status and keep a disabled-target corpus case for targets without the feature.
- **Test/example:** `{"code":"PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD","spanText":"for","count":1}` for a disabled target.
- **AC:** docs no longer claim stream loops are blocked for UEFI after implementation.

#### W3-03a — Reject `yield` before proof/opt lowering on unsupported targets

- **Depends:** W0-02a, W0-02b, W0-02c.
- **Files:** `src/hir/statement-lowerer.ts`, `src/hir/diagnostics.ts`, `tests/fixtures/diagnostics/yield-on-uefi/input.wr`, `tests/fixtures/diagnostics/yield-on-uefi/expected.json`.
- **Do:** report `HIR_FEATURE_NOT_AVAILABLE_ON_TARGET` at `yield` when target lacks `coroutineYield`.
- **Test/example:** `expect(codes).toContain("HIR_FEATURE_NOT_AVAILABLE_ON_TARGET");`.
- **AC:** `yield-on-uefi` fails early with `spanText: "yield"`.

#### W3-03b — Turn downstream `yield` arms into invariant-only backstops

- **Depends:** W3-03a.
- **Files:** `src/proof-mir/lower/function-lowerer.ts`, `src/opt-ir/lower/lower-checked-mir.ts`.
- **Do:** replace user-facing late unsupported-yield diagnostics with internal invariant failures after the early gate.
- **Test/example:** direct construction test expects an invariant throw, not a user diagnostic.
- **AC:** normal source cannot reach late `yield` unsupported arms.

#### W3-04a — Add aggregate-lowering pass skeleton and schedule contract

- **Depends:** W2-02a.
- **Files:** `src/opt-ir/passes/aggregate-lowering.ts`, `src/opt-ir/policy/pass-order-policy.ts`, `src/opt-ir/passes/pipeline-dispatch.ts`, `src/opt-ir/passes/pipeline-steps.ts`, `tests/unit/remediation/w3-04a.test.ts`.
- **Do:** add a no-op pass with declared inputs/outputs and move the W2-02 gate after the pass.
- **Test/example:** `expect(schedule).toContain("aggregate-lowering");`.
- **AC:** pipeline runs unchanged on fixtures.

#### W3-04b — Lower aggregate construction to region allocation plus stores

- **Depends:** W3-04a.
- **Files:** `src/opt-ir/passes/aggregate-lowering.ts`, `src/opt-ir/layout-fact-keys.ts`, `src/opt-ir/passes/pipeline-steps.ts`, `tests/unit/remediation/w3-04b.test.ts`.
- **Do:** convert `aggregateConstruct` to a stack/region allocation and per-field stores using layout facts.
- **Test/example:** `expect(ops.map((op) => op.kind)).not.toContain("aggregateConstruct");`.
- **AC:** construct-only aggregate unit tests have no aggregate ops after the pass.

#### W3-04c — Lower aggregate extract and insert

- **Depends:** W3-04b.
- **Files:** `src/opt-ir/passes/aggregate-lowering.ts`, `src/opt-ir/operations.ts`, `tests/unit/remediation/w3-04c.test.ts`.
- **Do:** rewrite `aggregateExtract` to offset loads and `aggregateInsert` to offset stores.
- **Test/example:** `expect(ops).toContainEqual(expect.objectContaining({ kind: "load" }));`.
- **AC:** object construct/mutate/read fixture compiles end to end.

#### W3-05a — Enforce switch exhaustiveness upstream

- **Depends:** none.
- **Files:** `src/proof-mir/validation/graph-validator.ts`, `src/proof-mir/diagnostics.ts`, `tests/unit/remediation/w3-05a.test.ts`.
- **Do:** prove non-exhaustive switch without fallback reports `PROOF_MIR_MISSING_SWITCH_EXHAUSTIVENESS`.
- **Test/example:** `expect(codes).toContain("PROOF_MIR_MISSING_SWITCH_EXHAUSTIVENESS");`.
- **AC:** all switch sources are covered by the validator.

#### W3-05b — Make opt-ir unsupported-switch unreachable-by-construction

- **Depends:** W3-05a.
- **Files:** `src/opt-ir/lower/lower-checked-mir.ts`.
- **Do:** convert the late unsupported-switch branch to an invariant failure with a message naming the upstream guarantee.
- **Test/example:** direct lowering of an invalid switch throws `/upstream switch exhaustiveness/`.
- **AC:** source programs get proof-MIR diagnostics, not opt-ir unsupported switches.

#### W3-06a — Reject generic image entries in semantic checking

- **Depends:** none.
- **Files:** `src/semantic/surface/image-entry-checker.ts`, `tests/fixtures/diagnostics/generic-image-entry/input.wr`, `tests/fixtures/diagnostics/generic-image-entry/expected.json`.
- **Do:** report `SEMANTIC_IMAGE_ENTRY_GENERIC` when selected entry function has type parameters and no concrete external root.
- **Test/example:** `expect(codes).toContain("SEMANTIC_IMAGE_ENTRY_GENERIC");`.
- **AC:** generic image entries are user diagnostics with source spans.

#### W3-06b — Remove error-shaped generic entry placeholders

- **Depends:** W3-06a.
- **Files:** `src/hir/mono-closure-lowerer.ts`, `src/hir/diagnostics.ts`, `tests/unit/remediation/w3-06b.test.ts`.
- **Do:** delete placeholder `errorCheckedType()` synthesis and make that path invariant-only.
- **Test/example:** old placeholder assertion becomes a diagnostic assertion.
- **AC:** no generic entry root is represented as an error-shaped type.

#### W3-07a — Specify the non-recursion language rule

- **Depends:** none.
- **Files:** `docs/language/happy.md`.
- **Do:** document that functions and by-value types are non-recursive and iteration uses loops/streams.
- **Test/example:** doc snippet: `wrela does not allow recursive functions; use loops or streams instead.`
- **AC:** happy.md states bounded recursion is out of this plan.

#### W3-07b — Add early recursion-cycle diagnostics with cycle paths

- **Depends:** W3-07a.
- **Files:** `src/semantic/surface/mono-closure-builder.ts`, `src/semantic/surface/semantic-surface-checker.ts`, `src/semantic/surface/diagnostics.ts`, `src/mono/diagnostics.ts`, `tests/fixtures/diagnostics/recursive-function-cycle/input.wr`, `tests/fixtures/diagnostics/recursive-function-cycle/expected.json`, `tests/fixtures/diagnostics/recursive-type-cycle/input.wr`, `tests/fixtures/diagnostics/recursive-type-cycle/expected.json`.
- **Do:** report direct/mutual recursion at semantic level with cycle names while keeping mono as a backstop.
- **Test/example:** `expect(stableDetail).toContain("a->b->a");`.
- **AC:** direct and mutual recursion corpus cases fail before mono.

#### W3-08a — Promote booleans to real keywords/literals

- **Depends:** W1-04a, W1-04b.
- **Files:** `src/frontend/lexer/keyword-table.ts`, `src/frontend/lexer/token-kind.ts`, `src/frontend/syntax/syntax-kind.ts`, `src/frontend/parser/expression-parser.ts`, `src/hir/expression-lowerer.ts`, `src/proof-mir/lower/expression-lowerer.ts`, `tests/unit/remediation/w3-08a.test.ts`.
- **Do:** lex `true` and `false` as literal tokens and remove magic identifier checks.
- **Test/example:** `expect(parse("let true = 1").diagnostics[0].code).toMatch(/PARSE_/);`.
- **AC:** boolean literals lower correctly and cannot be shadowed as identifiers.

#### W3-08b — Add short-circuit `and`/`or`

- **Depends:** W3-08a.
- **Files:** `src/frontend/parser/expression-parser.ts`, `src/hir/expression-lowerer.ts`, `src/proof-mir/lower/expression-lowerer.ts`, `tests/unit/remediation/w3-08b.test.ts`.
- **Do:** parse `and`/`or` with documented precedence and lower as short-circuit CFG.
- **Test/example:** `expect(evaluate("false and panic()")).toBe(false);` in the interpreter/differential harness once available.
- **AC:** right operand is not evaluated when short-circuit decides the result.

#### W3-08c — Add bitwise tokens, parser precedence, and HIR typing

- **Depends:** W3-08a.
- **Files:** `src/frontend/lexer/token-kind.ts`, `src/frontend/lexer/keyword-table.ts`, `src/frontend/parser/expression-parser.ts`, `src/hir/expression-lowerer.ts`, `src/hir/diagnostics.ts`, `docs/language/happy.md`, `tests/unit/remediation/w3-08c.test.ts`.
- **Do:** implement `& | ^ << >> ~` for same-width unsigned integer operands with Rust-style precedence.
- **Test/example:** parse tree for `a & b == c` proves `&` binds tighter than `==`.
- **AC:** parser and HIR tests cover each operator and mismatch diagnostics.

#### W3-08d — Add opt-ir/backend support for bitwise operations

- **Depends:** W0-05d, W3-08c.
- **Files:** `src/opt-ir/operations.ts`, `src/opt-ir/interpreter.ts`, `src/opt-ir/verify/operation-schema-verifier.ts`, `src/target/aarch64/lower/operation-materialization.ts`, `src/target/aarch64/backend/object/encoding-integer-branch.ts`, `tests/unit/remediation/w3-08d.test.ts`.
- **Do:** add missing bitwise scalar ops and lower to AND/ORR/EOR/LSL/LSR, using register fallback for non-encodable immediates.
- **Test/example:** `expect(machineOpcodes).toContain("orr");`.
- **AC:** end-to-end masked-MMIO fixture validates.

#### W3-08e — Record signed integers as a deferred RFC

- **Depends:** W3-08a.
- **Files:** `docs/language/happy.md`, `docs/design/signed-integers-rfc.md`.
- **Do:** explicitly defer signed integers because proof arithmetic currently assumes unsigned/checked semantics.
- **Test/example:** `i32` in source continues to produce the existing unknown-type diagnostic.
- **AC:** no implementation code for signed integers lands in this plan.

#### W3-09a — Add core stdlib `Option` and enriched `Result` conformance fixtures

- **Depends:** W1-02a, W1-02b, W1-02c, W1-10a, W1-10b.
- **Files:** `stdlib/wrela-std/core/option.wr`, `stdlib/wrela-std/core/result.wr`, `tests/fixtures/full-image-validation/stdlib-core-option-result/toolchain-stdlib/src/image.wr`, `src/validation/full-image/matrix.ts`.
- **Do:** add only constructs expressible by the current language and compile each through full-image validation.
- **Test/example:** `use Option from wrela_std.core.option` compiles in a conformance fixture.
- **AC:** new stdlib modules are covered by source-level fixtures.

#### W3-09b — Add `bits.wr` after bitwise operators land

- **Depends:** W3-08d.
- **Files:** `stdlib/wrela-std/core/bits.wr`, `tests/fixtures/full-image-validation/stdlib-bits/toolchain-stdlib/src/image.wr`, `src/validation/full-image/matrix.ts`.
- **Do:** provide tiny mask/shift helpers used by examples without adding compiler magic.
- **Test/example:** `mask_low(0b1111, 2)` fixture returns `0b0011`.
- **AC:** bits helpers compile and validate through full-image fixtures.

#### W3-09c — Declare target buffer type names and compatibility matrix

- **Depends:** W3-09a.
- **Files:** `stdlib/wrela-std/target/uefi/*`, `stdlib/COMPATIBILITY.md`.
- **Do:** declare `ReadableBuffer`/`WritableBuffer` target type names and document declared-vs-missing happy.md surface.
- **Test/example:** compatibility row: `ReadableBuffer | declared | full-image fixture`.
- **AC:** compatibility doc has no unowned blank status cells.

#### W3-09d — Convert one private full-image fixture set to toolchain stdlib

- **Depends:** W3-09a, W3-09c.
- **Files:** `tests/fixtures/full-image-validation/smoke-console/toolchain-stdlib/src/image.wr`, `tests/fixtures/full-image-validation/packet-counter/toolchain-stdlib/src/image.wr`, `src/validation/full-image/matrix.ts`.
- **Do:** remove copied private stdlib pieces from `tests/fixtures/full-image-validation/smoke-console/toolchain-stdlib/` and import the real toolchain stdlib.
- **Test/example:** fixture source imports `wrela_std.target.uefi.console`.
- **AC:** converted fixture passes in toolchain stdlib mode.

#### W3-10a — Move boot-result ABI classification into the image profile

- **Depends:** W1-10a, W1-10b.
- **Files:** `src/layout/image-entry-abi.ts`, `src/target/uefi-aarch64/package-pipeline-semantic-target.ts`, `src/target/uefi-aarch64/package-pipeline.ts`, `tests/unit/remediation/w3-10a.test.ts`.
- **Do:** make the target profile declare boot-result type identity and EFI_STATUS mapping.
- **Test/example:** `expect(profile.entryResult.bootErrorTypeId).toBe(stdlibBootErrorId);`.
- **AC:** layout no longer matches a bare source name `BootError`.

#### W3-11a — Complete or explicitly exclude full-image matrix slots

- **Depends:** none.
- **Files:** `src/validation/full-image/matrix.ts`, `tests/fixtures/full-image-validation/smoke-console/toolchain-stdlib/src/image.wr`, `tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/src/image.wr`, `tests/fixtures/full-image-validation/smoke-console/direct-platform/src/image.wr`, `tests/fixtures/full-image-validation/packet-counter/toolchain-stdlib/src/image.wr`, `tests/fixtures/full-image-validation/packet-counter/ejected-stdlib/src/image.wr`, `tests/fixtures/full-image-validation/packet-counter/direct-platform/src/image.wr`.
- **Do:** make all 12 scenario/mode slots either runnable or documented-excluded with a reason.
- **Test/example:** `expect(matrixSlots).toHaveLength(12);`.
- **AC:** no silent matrix omissions remain.

#### W3-11b — Promote full-image target keys to a registry

- **Depends:** W3-11a.
- **Files:** `scripts/validate-full-image.ts`, `src/validation/full-image/matrix.ts`.
- **Do:** replace single hardcoded target key with `FULL_IMAGE_TARGETS`.
- **Test/example:** `expect(FULL_IMAGE_TARGETS[0].key).toBe("wrela-uefi-aarch64-rpi5-v1");`.
- **AC:** adding a second target is a registry entry, not a script rewrite.

### WAVE 4 — Optimizer credibility

#### W4-01a — Implement fixture observation loading for differential tests

- **Depends:** W0-01a, W0-01b.
- **Files:** `tests/unit/validation/miscompile-confidence/fixture-observation.test.ts`, `src/opt-ir/interpreter.ts`, `tests/support/opt-ir/opt-ir-interpreter.ts`, `src/validation/full-image/fixture-catalog.ts`.
- **Do:** load each full-image fixture's unoptimized and optimized opt-ir plus packet inputs into a common observation harness.
- **Test/example:** `expect(observation.exitStatus).toBe("returned");`.
- **AC:** harness can execute a trivial fixture without comparing yet.

#### W4-01b — Compare unoptimized vs optimized opt-ir observations

- **Depends:** W4-01a.
- **Files:** `tests/unit/validation/miscompile-confidence/fixture-observation.test.ts`, `tests/unit/remediation/w4-01b.test.ts`.
- **Do:** run both opt-ir programs and fail on observation mismatch.
- **Test/example:** `expect(optimizedObservation).toEqual(unoptimizedObservation);`.
- **AC:** deliberately changing a constant-folding result is caught by a local fault-injection test.

#### W4-01c — Compare optimized opt-ir vs machine-ir interpreter observations

- **Depends:** W4-01b.
- **Files:** `src/target/aarch64/interpreter/machine-ir-interpreter.ts`, `src/target/aarch64/interpreter/machine-ir-differential.ts`, `tests/unit/remediation/w4-01c.test.ts`.
- **Do:** feed backend output into the existing machine-ir interpreter and compare observations to optimized opt-ir.
- **Test/example:** `expect(machineObservation).toEqual(optIrObservation);`.
- **AC:** fixture differential is green before enabling aggressive backend scheduling/fusions.

#### W4-02a — Build natural-loop forest from CFG/dominators

- **Depends:** W4-01a, W4-01b, W4-01c.
- **Files:** `src/opt-ir/passes/licm.ts`, `src/opt-ir/analyses/dominance.ts`, `src/opt-ir/analyses/loop-tree.ts`, `tests/unit/remediation/w4-02a.test.ts`.
- **Do:** compute loops and existing/missing preheaders without moving operations.
- **Test/example:** `expect(loop.header).toBe(blockId("loop.header"));`.
- **AC:** loop analysis tests cover single loop and nested loop.

#### W4-02b — Insert preheaders when needed

- **Depends:** W4-02a.
- **Files:** `src/opt-ir/passes/licm.ts`, `src/opt-ir/cfg-edits.ts`, `tests/unit/remediation/w4-02b.test.ts`.
- **Do:** split/create preheader blocks while preserving verifier-clean CFG.
- **Test/example:** `expect(preheader.successors).toContain(loopHeader);`.
- **AC:** pass changes CFG only when preheader is absent.

#### W4-02c — Mark invariant and effect-safe operations

- **Depends:** W4-02b.
- **Files:** `src/opt-ir/passes/licm.ts`, `src/opt-ir/operation-effects.ts`, `tests/unit/remediation/w4-02c.test.ts`.
- **Do:** hoist only runtime-pure operations whose operands are constants, outside loop, or already invariant.
- **Test/example:** `expect(invariantOps).toContain(addInsideLoop);`.
- **AC:** effectful and loop-varying ops stay in the loop.

#### W4-02d — Perform LICM hoists and emit truthful rewrite records

- **Depends:** W4-02c.
- **Files:** `src/opt-ir/passes/licm.ts`, `src/opt-ir/policy/decision-log.ts`, `tests/unit/remediation/w4-02d.test.ts`.
- **Do:** move safe invariant ops into preheaders and record each move.
- **Test/example:** `expect(rewrite.reason.kind).toBe("licm-hoist");`.
- **AC:** loop fixture changes program shape and W4-01 differential remains green.

#### W4-03a — Detect SROA-eligible aggregate regions

- **Depends:** W4-01a, W4-01b, W4-01c, W3-04a, W3-04b, W3-04c.
- **Files:** `src/opt-ir/passes/scalar-replacement.ts`, `tests/unit/remediation/w4-03a.test.ts`
- **Do:** identify non-escaping regions with static whole-field accesses.
- **Test/example:** `expect(classification.kind).toBe("scalar-replaceable");`.
- **AC:** escaping or partial-overlap regions are rejected conservatively.

#### W4-03b — Rewrite eligible aggregate fields to SSA values

- **Depends:** W4-03a.
- **Files:** `src/opt-ir/passes/scalar-replacement.ts`, `tests/unit/remediation/w4-03b.test.ts`.
- **Do:** replace field loads/stores with SSA values and remove dead region ops.
- **Test/example:** `expect(ops.some((op) => op.kind === "load")).toBe(false);`.
- **AC:** aggregate-heavy fixture has fewer opt-ir ops and differential is green.

#### W4-04a — Detect activation-lifetime stack-promotion candidates

- **Depends:** W4-01a, W4-01b, W4-01c, W3-04a, W3-04b, W3-04c.
- **Files:** `src/opt-ir/passes/stack-promotion.ts`, `tests/unit/remediation/w4-04a.test.ts`
- **Do:** classify non-escaping activation-lifetime regions eligible for stack promotion.
- **Test/example:** `expect(candidate.lifetime).toBe("activation");`.
- **AC:** escaped regions stay unpromoted.

#### W4-04b — Rewrite promoted regions to stack regions

- **Depends:** W4-04a.
- **Files:** `src/opt-ir/passes/stack-promotion.ts`, `tests/unit/remediation/w4-04b.test.ts`.
- **Do:** change region allocation mode and emit truthful rewrite records.
- **Test/example:** `expect(promotedRegion.storage).toBe("stack");`.
- **AC:** promoted fixture verifies and W4-01 differential is green.

#### W4-05a — Clone multi-block callee CFGs with fresh ids

- **Depends:** W4-01a, W4-01b, W4-01c, W1-08a, W1-08b.
- **Files:** `src/opt-ir/passes/whole-program-inlining.ts`, `tests/unit/remediation/w4-05a.test.ts`
- **Do:** remap callee block/op/value ids without splicing into caller yet.
- **Test/example:** `expect(new Set(clonedIds).size).toBe(clonedIds.length);`.
- **AC:** cloned callee verifies as an isolated fragment.

#### W4-05b — Splice cloned callee CFG into caller

- **Depends:** W4-05a.
- **Files:** `src/opt-ir/passes/whole-program-inlining.ts`, `tests/unit/remediation/w4-05b.test.ts`.
- **Do:** rewrite call block to callee entry and callee returns to a merge block.
- **Test/example:** `expect(callerBlocks).toContain(mergeBlockId);`.
- **AC:** callee with `if` inlines verifier-clean.

#### W4-05c — Preserve budget/denial behavior for unsafe calls

- **Depends:** W4-05b.
- **Files:** `src/opt-ir/passes/whole-program-inlining.ts`, `src/opt-ir/policy/expansion-budget.ts`, `src/opt-ir/policy/decision-log.ts`, `tests/unit/remediation/w4-05c.test.ts`.
- **Do:** keep recursion/external roots/escaped callable/budget denials deterministic.
- **Test/example:** `expect(decision.reason).toBe("inline:denied:budget");`.
- **AC:** decision-log golden changes only for newly allowed multi-block inline cases.

#### W4-06a — Expose ownership-derived `mayAlias`

- **Depends:** W4-01a, W4-01b, W4-01c, W4-05a, W4-05b, W4-05c.
- **Files:** `src/opt-ir/analyses/place-alias.ts`, `tests/unit/remediation/w4-06a.test.ts`
- **Do:** return no-alias for distinct roots and disjoint static field paths; conservative otherwise.
- **Test/example:** `expect(mayAlias(aX, bX)).toBe(false);`.
- **AC:** alias analysis unit tests cover distinct roots, same root same field, and same root disjoint fields.

#### W4-06b — Use alias oracle in memory optimization

- **Depends:** W4-06a.
- **Files:** `src/opt-ir/passes/memory-optimization.ts`.
- **Do:** widen load forwarding and DSE through provably non-aliasing intervening stores.
- **Test/example:** store `b.x` between store/load of `a.x` no longer blocks forwarding.
- **AC:** aggregate fixture op count drops and differential is green.

#### W4-07a — Eliminate proof-authorized dead-after copies

- **Depends:** W4-06a, W4-06b, W2-09a, W2-09b.
- **Files:** `src/opt-ir/passes/wrela-optimizations/move-copy-wrapper-elision.ts`, `src/opt-ir/egraph/rule-catalog.ts`, `tests/unit/remediation/w4-07a.test.ts`.
- **Do:** substitute values when ownership facts prove a copy source is dead after transfer.
- **Test/example:** `expect(decision.consumedFactFamilies).toContain("affine-consumption");`.
- **AC:** decision log cites facts; differential is green.

#### W4-08a — Implement SCC/worklist resource-kind evaluation

- **Depends:** W0-05c.
- **Files:** `src/semantic/surface/semantic-surface-checker.ts`, `tests/unit/remediation/w4-08a.test.ts`
- **Do:** replace whole-graph repeated fixpoint with Tarjan SCC topological processing.
- **Test/example:** `expect(newResult).toEqual(referenceFixpointResult);`.
- **AC:** random DAG property tests match the old reference implementation.

#### W4-09a — Replace free-text fact-transfer reasons with a closed union

- **Depends:** W2-09a, W2-09b.
- **Files:** `src/shared/facts/fact-transfer.ts`, `src/opt-ir/rewrites/catalog-rewrite-builders.ts`, `src/target/aarch64/facts/aarch64-fact-rekeying.ts`, `tests/unit/remediation/w4-09a.test.ts`.
- **Do:** define `FactTransferReasonKind` and structured reason payloads.
- **Test/example:** `{ kind: "subject-split", originPassId, subjectKey }`.
- **AC:** typecheck forces every transfer producer to use structured reasons.

#### W4-09b — Audit out free-text fact-transfer reasons

- **Depends:** W4-09a.
- **Files:** `tests/audit/subsystem-maintainability-audit.test.ts`.
- **Do:** fail if transfer constructors receive string literals.
- **Test/example:** `expect(offenders).toEqual([]);`.
- **AC:** new free-text reasons cannot enter the repo.

#### W4-10a — Exit optimizer fixpoints early on no state change

- **Depends:** none.
- **Files:** `src/opt-ir/passes/pipeline-state.ts`, `src/opt-ir/passes/pipeline-dispatch.ts`, `src/opt-ir/passes/pipeline-steps.ts`, `tests/unit/remediation/w4-10a.test.ts`.
- **Do:** stop fixpoint clusters when `stateChanged === false` while keeping round caps as ceilings.
- **Test/example:** `expect(rounds).toBeLessThan(maxRounds);`.
- **AC:** output is unchanged on fixtures except decision logs showing fewer no-op rounds.

#### W4-10b — Reconcile declared pass schedule with dispatch arms

- **Depends:** W4-10a.
- **Files:** `src/opt-ir/policy/pass-order-policy.ts`, `src/opt-ir/passes/pipeline-dispatch.ts`, `tests/audit/subsystem-maintainability-audit.test.ts`, `tests/unit/remediation/w4-10b.test.ts`.
- **Do:** ensure every schedule pass has a dispatch arm or documented alias.
- **Test/example:** `expect(unmappedPassIds).toEqual([]);`.
- **AC:** audit fails on a declared pass id without execution semantics.

#### W4-10c — Add e-graph e-class/e-node ceilings

- **Depends:** W4-10b.
- **Files:** `src/opt-ir/passes/egraph-materialization.ts`, `src/opt-ir/diagnostics.ts`, `tests/unit/remediation/w4-10c.test.ts`.
- **Do:** cap e-classes/e-nodes and emit deterministic `egraph:limit:<kind>` info diagnostics when reached.
- **Test/example:** `expect(infoDiagnostics[0].stableDetail).toBe("egraph:limit:eclass");`.
- **AC:** runaway e-graph growth fails closed or degrades deterministically.

#### W4-11a — Add local cost scorecard script and baselines

- **Depends:** W0-01a, W0-01b.
- **Files:** `scripts/cost-scorecard.ts`, `tests/fixtures/full-image-validation/cost-scorecard-baseline.json`, `src/validation/full-image/runner.ts`, `package.json`.
- **Do:** emit instruction count, image bytes, static cycle estimate, and opt-ir pre/post counts per fixture.
- **Test/example:** `expect(scorecard.machineInstructionCount).toBeGreaterThan(0);`.
- **AC:** `bun run verify:scorecard` checks baselines and fails on >5% regression.

#### W4-11b — Wire scorecard into the appropriate local gate

- **Depends:** W4-11a.
- **Files:** `package.json`, `RELEASING.md`.
- **Do:** include scorecard in `agent:check` if under 2 seconds, otherwise in `verify:extended` with the budget decision documented.
- **Test/example:** `expect(packageJson.scripts["verify:extended"]).toContain("verify:scorecard");` when not in `agent:check`.
- **AC:** local gate ownership is explicit.

### WAVE 5 — Backend quality

#### W5-01a — Compute used callee-saved registers after allocation

- **Depends:** W0-05b, W1-01a, W1-01b, W1-01c, W4-01a, W4-01b, W4-01c.
- **Files:** `src/target/aarch64/backend/api/function-pipeline.ts`, `tests/unit/remediation/w5-01a.test.ts`
- **Do:** derive `usedCalleeSaved` from allocation segments and register aliases.
- **Test/example:** `expect(usedCalleeSaved).toEqual(["x19", "x20"]);`.
- **AC:** pressure tests identify exactly the callee-saved registers used.

#### W5-01b — Add frame save areas and prologue/epilogue restores

- **Depends:** W5-01a.
- **Files:** `src/target/aarch64/backend/frame/frame-layout.ts`, `src/target/aarch64/backend/api/frame-instructions.ts`, `src/target/aarch64/backend/frame/prologue-epilogue.ts`, `src/target/aarch64/backend/frame/unwind-plan.ts`, `tests/unit/remediation/w5-01b.test.ts`.
- **Do:** allocate 16-byte paired save slots and emit `stp`/`ldp` for used callee-saved registers.
- **Test/example:** `expect(prologueOpcodes).toContain("stp"); expect(epilogueOpcodes).toContain("ldp");`.
- **AC:** caller preservation test passes under machine-ir differential.

#### W5-01c — Relax W1-01 pool restrictions and update verifier coverage

- **Depends:** W5-01b.
- **Files:** `src/target/aarch64/backend/api/function-pipeline.ts`, `src/target/aarch64/backend/api/physical-register-model.ts`, `src/target/aarch64/verify/abi-verifier.ts`, `tests/unit/remediation/w5-01c.test.ts`.
- **Do:** allow preserved callee-saved registers and make verifier require save/restore coverage instead of absence.
- **Test/example:** `expect(allocatedRegisters).toContain("x20");`.
- **AC:** full register pool is usable without ABI clobbering.

#### W5-02a — Fill spill weights and evict lower-weight active intervals

- **Depends:** W5-01a, W5-01b, W5-01c, W4-01a, W4-01b, W4-01c.
- **Files:** `src/target/aarch64/backend/allocation/allocator.ts`, `src/target/aarch64/backend/allocation/liveness.ts`, `tests/unit/remediation/w5-02a.test.ts`.
- **Do:** compute use density/loop depth costs and spill the cheaper active interval when pressure requires it.
- **Test/example:** `expect(spilledInterval).toBe(coldInterval);`.
- **AC:** allocator test proves hot interval wins over cold interval.

#### W5-02b — Add preferred-register hints and coalesce satisfied copies

- **Depends:** W5-02a.
- **Files:** `src/target/aarch64/backend/allocation/allocator.ts`, `src/target/aarch64/backend/api/function-copy-resolution.ts`, `tests/unit/remediation/w5-02b.test.ts`.
- **Do:** prefer call/copy registers when legal and delete copies whose src/dst coalesce.
- **Test/example:** `expect(copyInstructions).not.toContain(coalescedCopy);`.
- **AC:** parallel-copy hint test reduces move count.

#### W5-02c — Reassign post-split intervals after call-boundary cuts

- **Depends:** W5-02b.
- **Files:** `src/target/aarch64/backend/allocation/allocator.ts`, `tests/unit/remediation/w5-02c.test.ts`.
- **Do:** re-enqueue post-cut segments unassigned rather than inheriting the same physical register.
- **Test/example:** `expect(postCut.physical).not.toBe(preCut.physical);` when pressure/availability differs.
- **AC:** call-boundary split test avoids unavailable registers.

#### W5-02d — Place spills/reloads per use site

- **Depends:** W5-02c.
- **Files:** `src/target/aarch64/backend/allocation/spill-remat.ts`, `src/target/aarch64/backend/api/machine-lowering-repairs.ts`, `src/target/aarch64/backend/api/function-pipeline.ts`, `tests/unit/remediation/w5-02d.test.ts`.
- **Do:** key spill drafts per use site and place reloads immediately before uses.
- **Test/example:** `expect(reload.order).toBeLessThan(use.order);`.
- **AC:** stress tests show no stale live-range-wide reload placement.

#### W5-03a — Reuse constant materialization for wide rematerialization recipes

- **Depends:** none.
- **Files:** `src/target/aarch64/backend/allocation/spill-remat.ts`, `src/target/aarch64/lower/constant-materialization.ts`, `tests/unit/remediation/w5-03a.test.ts`.
- **Do:** add `movz-movk`/`movn` remat recipes by calling the existing chunker.
- **Test/example:** `expect(recipe.instructions.map((i) => i.shift)).toEqual([0, 16, 32, 48]);`.
- **AC:** wide constants rematerialize to correct instruction sequences.

#### W5-03b — Execute rematerialization recipes in spill repair

- **Depends:** W5-03a.
- **Files:** `src/target/aarch64/backend/allocation/spill-remat.ts`, `src/target/aarch64/backend/api/function-pipeline.ts`, `tests/unit/remediation/w5-03b.test.ts`.
- **Do:** expand multi-instruction recipes at use sites and leave page-base/literal authorities as explicit non-remat.
- **Test/example:** machine interpreter evaluates remat sequence to `0xDEADBEEFn`.
- **AC:** spill fallback behavior is unchanged for nonconstant authorities.

#### W5-04a — Add memory-key totality checks before enabling scheduling

- **Depends:** W4-01a, W4-01b, W4-01c, W5-01a, W5-01b, W5-01c.
- **Files:** `src/target/aarch64/verify/scheduler-verifier.ts`, `src/target/aarch64/backend/api/post-ra-scheduler-classification.ts`, `src/target/aarch64/backend/api/function-pipeline.ts`, `tests/unit/remediation/w5-04a.test.ts`.
- **Do:** classify memory opcodes and fail if any memory instruction lacks a key.
- **Test/example:** `expect(codes).toContain("AARCH64_SCHEDULER_MEMORY_KEY_MISSING");`.
- **AC:** unkeyed memory operations isolate or fail before reordering.

#### W5-04b — Enable latency-aware post-RA scheduling

- **Depends:** W0-05b, W5-04a.
- **Files:** `src/target/aarch64/backend/api/function-pipeline.ts`, `src/target/aarch64/backend/finalization/post-ra-scheduler.ts`, `src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data.ts`, `tests/unit/remediation/w5-04b.test.ts`.
- **Do:** enable load-latency hiding and use stable latency-priority tie breaks.
- **Test/example:** `expect(options.preferLoadLatencyHiding).toBe(true);`.
- **AC:** W4-01 differential remains green with scheduling enabled.

#### W5-04c — Enable and generalize pair load/store peepholes

- **Depends:** W5-04b.
- **Files:** `src/target/aarch64/backend/finalization/peepholes.ts`, `tests/unit/remediation/w5-04c.test.ts`.
- **Do:** scan arbitrary-length adjacent compatible ldr/str runs and form legal pairs.
- **Test/example:** `expect(opcodes).toContain("ldp");`.
- **AC:** pair-formation goldens and differential pass.

#### W5-05a — Implement compare/branch fusion

- **Depends:** W4-01a, W4-01b, W4-01c.
- **Files:** `src/target/aarch64/lower/operation-materialization.ts`, `src/target/aarch64/select/selection-policy.ts`, `tests/unit/remediation/w5-05a.test.ts`.
- **Do:** select compare feeding sole branch as compare plus conditional branch without materialized boolean.
- **Test/example:** `expect(opcodes).toEqual(["cmp", "b.cond"]);`.
- **AC:** branch fusion golden and differential pass.

#### W5-05b — Implement madd/msub fusion

- **Depends:** W5-05a.
- **Files:** `src/target/aarch64/lower/operation-materialization.ts`, `tests/unit/remediation/w5-05b.test.ts`.
- **Do:** fuse `mul` plus add/sub chains into `madd`/`msub` where operands match.
- **Test/example:** `expect(opcodes).toContain("madd");`.
- **AC:** fusion is semantics-preserving under differential.

#### W5-05c — Implement addressing-mode folding

- **Depends:** W5-05a.
- **Files:** `src/target/aarch64/lower/operation-materialization.ts`, `tests/unit/remediation/w5-05c.test.ts`.
- **Do:** fold static `base + index << scale` into load/store operands when encodable.
- **Test/example:** `expect(memoryOperand.indexShift).toBe(3);`.
- **AC:** folded addressing golden passes.

#### W5-05d — Implement immediate and extend fusions

- **Depends:** W5-05a, W3-08d.
- **Files:** `src/target/aarch64/lower/operation-materialization.ts`, `src/target/aarch64/backend/object/encoding-integer-branch.ts`, `tests/unit/remediation/w5-05d.test.ts`.
- **Do:** use immediate forms when encodable and remove redundant zero/sign extends via W-register semantics.
- **Test/example:** `expect(opcodes).not.toContain("mov");` for encodable immediate.
- **AC:** scorecard improves or stays equal and differential passes.

#### W5-06a — Implement default AArch64 veneer provider

- **Depends:** none.
- **Files:** `src/linker/aarch64/default-veneer-provider.ts`, `src/linker/aarch64/aarch64-linker.ts`, `tests/unit/remediation/w5-06a.test.ts`.
- **Do:** build an encoded `adrp/add/br x16` trampoline with relocation records using existing encoders.
- **Test/example:** `expect(veneerOpcodes).toEqual(["adrp", "add", "br"]);`.
- **AC:** far branch unit test links through a veneer.

#### W5-06b — Wire default veneer provider into UEFI binary spine

- **Depends:** W5-06a.
- **Files:** `src/target/uefi-aarch64/binary-spine.ts`.
- **Do:** pass the provider to the linker and keep existing layouts unchanged when veneers are unnecessary.
- **Test/example:** `expect(linkInput.veneerProvider).toBeDefined();`.
- **AC:** normal full-image fingerprints are unchanged unless a veneer is required.

#### W5-07a — Add opt-ir constant-pool schema and verifier support

- **Depends:** W0-05d, W4-01a, W4-01b, W4-01c.
- **Files:** `src/opt-ir/operations.ts`, `src/opt-ir/program.ts`, `src/opt-ir/interpreter.ts`, `src/opt-ir/verify/structural-verifier.ts`, `tests/unit/remediation/w5-07a.test.ts`.
- **Do:** add program-level constants with id, bytes, alignment, section, stable key, and fingerprint.
- **Test/example:** `expect(program.constantPool.get(id)?.section).toBe("rodata");`.
- **AC:** constant-pool verifier rejects duplicate stable keys/fingerprint mismatches.

#### W5-07b — Lower `utf16_static` to constant-pool references

- **Depends:** W5-07a.
- **Files:** `src/semantic/surface/compiler-intrinsic-collector.ts`, `src/hir/expression-lowerer.ts`, `src/proof-mir/lower/expression-lowerer.ts`, `src/opt-ir/lower/lower-checked-mir.ts`, `tests/integration/target/uefi-aarch64/static-char16-constant-pool.test.ts`.
- **Do:** route `utf16_static` through the constant-pool model from W5-07a. The compiler intrinsic collector still validates and cooks the source string, HIR carries the literal's stable string value, proof-MIR carries a constant-pool reference instead of a propagated pointer fact, and opt-ir lowering emits `constAddr(constId)` where `constId` is looked up by the UTF-16LE bytes plus NUL terminator fingerprint. Do not extend `package-pipeline-static-char16.ts`; that side table is deleted in W5-07d.
- **Test/example:** create `tests/integration/target/uefi-aarch64/static-char16-constant-pool.test.ts` with a function that passes one `utf16_static("hello")` value through two source calls before `OutputString`; assert `expect(optIrOps).toContainEqual(expect.objectContaining({ kind: "constAddr" }));` and assert there is exactly one constant-pool entry for the string.
- **AC:** `bun test tests/integration/target/uefi-aarch64/static-char16-constant-pool.test.ts` passes; the two-call string propagation fixture compiles without adding side-table propagation paths.

#### W5-07c — Emit constant pool entries into `.rodata`

- **Depends:** W5-07b.
- **Files:** `src/target/aarch64/backend/object/object-module.ts`, `src/target/uefi-aarch64/package-pipeline-static-char16.ts`, `tests/unit/remediation/w5-07c.test.ts`.
- **Do:** emit one deduplicated `.rodata` contribution per constant-pool fingerprint with standard relocations.
- **Test/example:** `expect(object.sections.map((s) => s.name)).toContain(".rodata");`.
- **AC:** smoke console marker boots with constant-pool-backed strings.

#### W5-07d — Delete char16 side-table propagation

- **Depends:** W5-07c.
- **Files:** `src/target/uefi-aarch64/package-pipeline-static-char16.ts`.
- **Do:** remove `remapStaticChar16MetadataToOptIrValues` and source-call propagation code that the constant pool replaces.
- **Test/example:** `rg -n "propagateStaticChar16Pointers" src` returns no matches.
- **AC:** deleted side-table logic has no remaining consumers.

#### W5-08a — Build seeded backend stress program generators

- **Depends:** W5-01a, W5-01b, W5-01c.
- **Files:** `tests/support/target/aarch64/stress-program-generator.ts`.
- **Do:** generate call-heavy, spill-heavy, wide-constant, parallel-copy, and large-frame shapes with deterministic seeds.
- **Test/example:** `const program = generateStressProgram({ seed: 42, shape: "spill-heavy" });`.
- **AC:** generator output is deterministic by seed.

#### W5-08b — Run stress cases through verifier and interpreter differential

- **Depends:** W5-08a, W4-01a, W4-01b, W4-01c.
- **Files:** `tests/integration/target/aarch64/backend-stress.test.ts`.
- **Do:** run generated cases through the function pipeline, allocation verifier, and machine-ir interpreter oracle.
- **Test/example:** `expect(result.verifierDiagnostics).toEqual([]);`.
- **AC:** 200 seeded cases pass under `bun run verify:extended`.

### WAVE 6 — Product surface

#### W6-01a — Add CLI argument parser and exit-code shell

- **Depends:** W2-06a, W2-06b.
- **Files:** `src/cli/main.ts`, `src/cli/arguments.ts`, `src/cli/exit-codes.ts`, `tests/unit/remediation/w6-01a.test.ts`.
- **Do:** implement subcommand parsing and exit codes 0/1/2/3 without compiling yet.
- **Test/example:** `expect(parseArgs(["build", "."]).command).toBe("build");`.
- **AC:** invalid usage exits 2 with no stack trace.

#### W6-01b — Add package loader for directory inputs

- **Depends:** W6-01a.
- **Files:** `src/cli/package-loader.ts`, `tests/support/full-image/package-fixture-loader.ts`, `tests/integration/cli/package-loader.test.ts`.
- **Do:** load `src/image.wr` plus stdlib mode into `CompilerPackageInput`.
- **Test/example:** `expect(input.entryModulePath).toBe("src/image.wr");`.
- **AC:** loader works on an existing full-image fixture directory.

#### W6-01c — Implement CLI `build`

- **Depends:** W6-01b, W2-15a, W2-15b.
- **Files:** `src/cli/main.ts`, `src/cli/build-command.ts`, `src/cli/reporter-host.ts`, `tests/integration/cli/build-command.test.ts`.
- **Do:** implement `wrela build <dir> [--target uefi-aarch64-rpi5] [--out image.efi] [--json]` by loading the package, calling `compileUefiAArch64ImageWithTrace`, writing artifact bytes to `--out`, and rendering preserved diagnostics through the reporter.
- **Test/example:** `bun test tests/integration/cli/build-command.test.ts` with a good fixture command `bun src/cli/main.ts build tests/fixtures/full-image-validation/smoke-console/toolchain-stdlib --out <tmp>/image.efi`.
- **AC:** good source exits 0 and writes nonempty `.efi` bytes; bad source exits 1 and prints diagnostics; usage errors remain exit 2.

#### W6-01d — Implement CLI `check`

- **Depends:** W6-01b, W2-06a, W2-06b.
- **Files:** `src/cli/main.ts`, `src/cli/check-command.ts`, `src/cli/reporter-host.ts`, `tests/integration/cli/check-command.test.ts`.
- **Do:** implement `wrela check <dir> [--target uefi-aarch64-rpi5] [--json]` by running the compiler through proof-check/resource validation without emitting an image.
- **Test/example:** `bun test tests/integration/cli/check-command.test.ts` asserts a bad proof fixture exits 1 and includes the original diagnostic code in JSON.
- **AC:** valid fixture exits 0 without writing image bytes; invalid fixture exits 1 with source-preserved diagnostics.

#### W6-01e — Implement CLI `validate`

- **Depends:** W0-01b, W6-01a.
- **Files:** `src/cli/main.ts`, `src/cli/validate-command.ts`, `src/validation/full-image/runner.ts`, `tests/integration/cli/validate-command.test.ts`.
- **Do:** implement `wrela validate [--json]` as a CLI wrapper over the full-image validation runner used by `bun run verify:full-image`.
- **Test/example:** `bun test tests/integration/cli/validate-command.test.ts` asserts `wrela validate --json` returns the same case ids as `bun run scripts/validate-full-image.ts --json`.
- **AC:** CLI validation exits 0 on the current matrix and exits 1 when a fake failing case is injected by the test.

#### W6-01f — Implement CLI `run --qemu`

- **Depends:** W6-01c, W2-15b.
- **Files:** `src/cli/main.ts`, `src/cli/run-command.ts`, `tests/integration/cli/run-qemu-command.test.ts`.
- **Do:** implement `wrela run <dir> --qemu` by building the package and invoking the inline QEMU smoke path from W2-15. If QEMU is unavailable, print the same deterministic skip reason as `verify:qemu -- --allow-missing-qemu`.
- **Test/example:** `bun test tests/integration/cli/run-qemu-command.test.ts` uses fake smoke host effects to assert the command requires marker `WRELA_UEFI_SMOKE_OK`.
- **AC:** configured QEMU marker absence exits 1; marker presence exits 0; missing QEMU skip behavior matches W6-05 policy.

#### W6-01g — Implement CLI `--emit` artifacts

- **Depends:** W6-01c.
- **Files:** `src/cli/main.ts`, `src/cli/emit-command.ts`, `tests/integration/cli/emit-command.test.ts`.
- **Do:** support `--emit tokens|ast|hir|proof-mir|opt-ir|asm|object|image` for `wrela build`, writing deterministic artifacts to `<out-dir>/<stage>.*` without changing the image build path.
- **Test/example:** `bun test tests/integration/cli/emit-command.test.ts` asserts two `--emit opt-ir` runs produce byte-identical output.
- **AC:** every listed emit mode has one golden or shape test; unsupported emit names exit 2.

#### W6-02a — Implement human diagnostic renderer

- **Depends:** W2-06a, W2-06b.
- **Files:** `src/cli/reporter.ts`, `tests/golden/cli/diagnostic-renderer/no-color.txt`, `tests/golden/cli/diagnostic-renderer/color.txt`, `tests/unit/remediation/w6-02a.test.ts`.
- **Do:** render `file:line:col: error[CODE]: message` plus source line and caret underline, honoring `NO_COLOR`.
- **Test/example:** `expect(output).toContain("error[HIR_EXPRESSION_TYPE_MISMATCH]");`.
- **AC:** golden output is byte-exact with and without color.

#### W6-02b — Add semantic type formatter for diagnostics

- **Depends:** W6-02a.
- **Files:** `src/semantic/surface/type-formatter.ts`, `src/hir/expression-lowerer.ts`, `src/hir/diagnostics.ts`, `tests/unit/semantic/surface/type-formatter.test.ts`.
- **Do:** format checked types as source-like names and include expected/found text in mismatch diagnostics.
- **Test/example:** `expect(formatCheckedType(resultType)).toBe("Result[u32, BootError]");`.
- **AC:** mismatch-family diagnostics name both types.

#### W6-02c — Add unresolved-name suggestions

- **Depends:** W6-02a.
- **Files:** `src/semantic/names/scope.ts`, `src/semantic/names/expression-resolver.ts`, `src/semantic/names/diagnostics.ts`, `tests/unit/semantic/names/unresolved-name-suggestions.test.ts`.
- **Do:** compute Levenshtein ≤2 suggestions from visible candidates.
- **Test/example:** `helpre` suggests `helper`.
- **AC:** suggestion test is deterministic and stable-sorted.

#### W6-03a — Parse minimal `wrela.toml`

- **Depends:** W6-01a, W6-01b, W6-01c, W6-01d, W6-01e, W6-01f, W6-01g.
- **Files:** `src/cli/manifest.ts`, `tests/unit/remediation/w6-03a.test.ts`.
- **Do:** implement sections plus string/bool keys without adding dependencies.
- **Test/example:** `expect(parseManifest("[package]\\nname = \"demo\"").package.name).toBe("demo");`.
- **AC:** invalid manifests produce usage diagnostics, not throws.

#### W6-03b — Implement `wrela init`

- **Depends:** W6-03a.
- **Files:** `src/cli/init.ts`, `src/cli/templates/wrela.toml`, `src/cli/templates/image.wr`, `src/cli/main.ts`, `tests/unit/remediation/w6-03b.test.ts`.
- **Do:** scaffold `wrela.toml`, `src/image.wr`, and ejected stdlib when requested.
- **Test/example:** `expect(await exists("src/image.wr")).toBe(true);`.
- **AC:** `wrela init --target uefi-aarch64` creates a buildable temp project.

#### W6-03c — Make `wrela build` read manifest defaults

- **Depends:** W6-03b.
- **Files:** `src/cli/build-command.ts`, `src/cli/manifest.ts`, `src/cli/package-loader.ts`, `tests/unit/remediation/w6-03c.test.ts`.
- **Do:** let CLI flags override manifest target and stdlib mode.
- **Test/example:** manifest says toolchain, CLI `--stdlib ejected` wins.
- **AC:** initialized project builds without requiring flags.

#### W6-04a — Add build tsconfig and package exports

- **Depends:** W6-01a, W6-01b, W6-01c, W6-01d, W6-01e, W6-01f, W6-01g.
- **Files:** `package.json`, `tsconfig.json`, `tsconfig.build.json`, `README.md`.
- **Do:** emit `dist/` declarations and JS with exports for API and CLI.
- **Test/example:** `bun run build`.
- **AC:** `dist/` contains `.d.ts` and importable JS.

#### W6-04b — Wire build into local verification or extended gate

- **Depends:** W6-04a.
- **Files:** `package.json`, `RELEASING.md`.
- **Do:** include `bun run build` in `agent:check` if fast, otherwise in `verify:extended` with documented timing.
- **Test/example:** `expect(packageJson.scripts["agent:check"] + packageJson.scripts["verify:extended"]).toContain("bun run build");`.
- **AC:** package build is never an unverified release-only surprise.

#### W6-05a — Add skip-aware `verify:qemu`

- **Depends:** W0-01a, W0-01b, W2-15a, W2-15b.
- **Files:** `package.json`, `scripts/verify-qemu.ts`.
- **Do:** detect QEMU/AAVMF and run smoke/full-image QEMU checks, allowing skips only with `--allow-missing-qemu`.
- **Test/example:** `bun run verify:qemu -- --allow-missing-qemu`.
- **AC:** non-skip mode fails if QEMU is required but missing or smoke marker is absent.

#### W6-05b — Document QEMU as a release requirement

- **Depends:** W6-05a.
- **Files:** `RELEASING.md`, `package.json`.
- **Do:** append skip-allowed QEMU to `verify:extended` and require non-skip QEMU in `verify:release`.
- **Test/example:** `expect(releasing).toContain("bun run verify:qemu");`.
- **AC:** release docs distinguish daily local skip mode from release required mode.

#### W6-06a — Add source-term details to divergent-join diagnostics

- **Depends:** W2-06a, W2-06b, W6-02a, W6-02b, W6-02c.
- **Files:** `src/proof-check/kernel/graph-worklist-helpers.ts`, `src/proof-check/kernel/counterexample-builder.ts`, `tests/unit/remediation/w6-06a.test.ts`.
- **Do:** include failed block, canonical requirement term, source place name, and predecessor path notes.
- **Test/example:** `expect(rendered).toContain("on the path from");`.
- **AC:** divergent fixture golden names failed component in source terms.

#### W6-06b — Write proof divergence recipe documentation

- **Depends:** W6-06a.
- **Files:** `docs/language/proof-divergence-recipes.md`.
- **Do:** add four before/after recipes: hoist fact, consume before merge, split join, duplicate tail.
- **Test/example:** anchor `#hoist-the-fact` exists and is referenced by diagnostics.
- **AC:** doc has four examples and diagnostic note links are valid.

#### W6-07a — Deprecate and audit legacy `src/lexer` shims

- **Depends:** W6-01a, W6-01b, W6-01c, W6-01d, W6-01e, W6-01f, W6-01g.
- **Files:** `src/lexer/module-graph-lexer.ts`, `src/lexer/token.ts`, `src/lexer/token-stream.ts`, `src/lexer/import-discovery.ts`, `src/lexer/module-import-request.ts`, `src/lexer/index.ts`, `src/lexer/diagnostics.ts`, `src/lexer/bun-file-repository.ts`, `src/lexer/module-path.ts`, `src/lexer/module-resolver.ts`, `src/lexer/file-repository.ts`, `src/lexer/trivia-kind.ts`, `src/lexer/source-span.ts`, `src/lexer/token-kind.ts`, `src/lexer/trivia.ts`, `src/lexer/lexer.ts`, `src/lexer/source-text.ts`, `src/lexer/keyword-table.ts`, `src/lexer/cursor.ts`, `tests/audit/subsystem-maintainability-audit.test.ts`.
- **Do:** add `@deprecated` JSDoc and forbid new `src/lexer/*` imports from `src/**`.
- **Test/example:** `expect(importOffenders).toEqual([]);`.
- **AC:** audit catches a new internal shim import.

#### W6-07b — Delete legacy lexer shims after migration

- **Depends:** W6-07a.
- **Files:** `src/lexer/module-graph-lexer.ts`, `src/lexer/token.ts`, `src/lexer/token-stream.ts`, `src/lexer/import-discovery.ts`, `src/lexer/module-import-request.ts`, `src/lexer/index.ts`, `src/lexer/diagnostics.ts`, `src/lexer/bun-file-repository.ts`, `src/lexer/module-path.ts`, `src/lexer/module-resolver.ts`, `src/lexer/file-repository.ts`, `src/lexer/trivia-kind.ts`, `src/lexer/source-span.ts`, `src/lexer/token-kind.ts`, `src/lexer/trivia.ts`, `src/lexer/lexer.ts`, `src/lexer/source-text.ts`, `src/lexer/keyword-table.ts`, `src/lexer/cursor.ts`, `tests/audit/subsystem-maintainability-audit.test.ts`.
- **Do:** migrate remaining internal importers and delete the shim directory.
- **Test/example:** `test ! -d src/lexer`.
- **AC:** suite and policy check pass without the shim directory.

### WAVE 7 — Scale and maintainability

#### W7-01a — Add a deep-call-chain mono overflow regression

- **Depends:** none.
- **Files:** `src/mono/reachability.ts`, `tests/support/mono/monomorphization-fixtures.ts`, `tests/unit/remediation/w7-01a.test.ts`.
- **Do:** generate a deep non-recursive chain that overflows the current recursive traversal.
- **Test/example:** `generateLinearCallChain({ depth: 20000 })`.
- **AC:** test fails before the worklist rewrite for the expected stack/depth reason.

#### W7-01b — Convert mono reachability to an explicit two-phase worklist

- **Depends:** W0-05f, W7-01a.
- **Files:** `src/mono/reachability.ts`, `src/mono/reachability-worklist.ts`.
- **Do:** replace host recursion with `{ phase: "expand" | "finish" }` items while preserving deterministic visit order.
- **Test/example:** `worklist.push({ phase: "finish", functionKey });`.
- **AC:** deep-chain test passes and fixture mono outputs are byte-identical.

#### W7-02a — Convert PE byte writer internals to `Uint8Array`

- **Depends:** W2-13a, W2-13b, W2-13c, W2-13d.
- **Files:** `src/pe-coff/pe-byte-writer.ts`, `src/pe-coff/pe-file-layout.ts`, `tests/unit/remediation/w7-02a.test.ts`.
- **Do:** use typed arrays internally and adapt at current boundaries.
- **Test/example:** `expect(bytes).toBeInstanceOf(Uint8Array);`.
- **AC:** PE output fingerprint is unchanged.

#### W7-02b — Migrate linker byte payloads to `Uint8Array`

- **Depends:** W2-03b, W7-02a.
- **Files:** `src/linker/linked-image-layout.ts`, `src/linker/aarch64/aarch64-linked-image.ts`, `src/linker/object-module-surface.ts`, `src/linker/contribution-recompute.ts`, `src/linker/verifier.ts`, `tests/unit/remediation/w7-02b.test.ts`.
- **Do:** change linker section/contribution byte payloads from `readonly number[]` to `Uint8Array`, adding adapters only at object/PE boundaries that still use arrays.
- **Test/example:** `expect(linkedImage.sections[0].bytes).toBeInstanceOf(Uint8Array);`.
- **AC:** linker tests pass and full-image fingerprints are byte-identical.

#### W7-02c — Migrate AArch64 object byte payloads to `Uint8Array`

- **Depends:** W7-02b.
- **Files:** `src/target/aarch64/backend/object/object-module.ts`, `src/target/aarch64/backend/object/layout-encode-fixed-point.ts`, `src/target/aarch64/backend/object/encoding.ts`, `src/target/aarch64/backend/object/encoding-core.ts`, `src/target/aarch64/backend/object/encoding-integer-branch.ts`, `src/target/aarch64/backend/object/encoding-memory-simd-fp.ts`, `src/target/aarch64/backend/verify/encoding-object-verifier.ts`, `tests/unit/remediation/w7-02c.test.ts`.
- **Do:** change backend object `codeBytes` and encoded contribution bytes to `Uint8Array`, keeping temporary adapters at the linker seam only if W7-02b has not removed all consumers.
- **Test/example:** `expect(objectModule.sections[0].codeBytes).toBeInstanceOf(Uint8Array);`.
- **AC:** backend object tests and object verifier tests pass; generated object fingerprints are unchanged.

#### W7-02d — Migrate entry-thunk and runtime helper byte payloads

- **Depends:** W7-02c.
- **Files:** `src/target/uefi-aarch64/entry-thunk.ts`, `src/target/uefi-aarch64/runtime-helper-instructions.ts`, `src/target/uefi-aarch64/runtime-helper-objects.ts`, `src/target/uefi-aarch64/binary-spine.ts`, `tests/unit/remediation/w7-02d.test.ts`.
- **Do:** return `Uint8Array` from entry-thunk/runtime-helper byte builders and remove array adapters at the UEFI binary-spine seam.
- **Test/example:** `expect(entryThunkObject.sections[0].bytes).toBeInstanceOf(Uint8Array);`.
- **AC:** entry-thunk relocation and PE/COFF conformance tests pass with unchanged final-image fingerprints.

#### W7-02e — Change public artifact bytes to `Uint8Array`

- **Depends:** W7-02d.
- **Files:** `src/target/uefi-aarch64/artifact.ts`, `src/target/uefi-aarch64/compile-uefi-aarch64-image.ts`, `src/validation/full-image/determinism.ts`, `tests/unit/remediation/w7-02e.test.ts`.
- **Do:** make `UefiAArch64ImageArtifact.bytes` a `Uint8Array` and update manual hex fingerprinting.
- **Test/example:** `for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");`.
- **AC:** memory note documents before/after fixture build heap impact.

#### W7-03a — Add lazy HIR member lookup maps

- **Depends:** none.
- **Files:** `src/hir/expression-lowerer.ts`.
- **Do:** replace linear field lookup with `Map<itemId, Map<name, field>>` built in lowering context.
- **Test/example:** `expect(fieldLookup.get(itemId)?.get("name")).toBe(field);`.
- **AC:** suite passes and micro-benchmark shows lookup improvement.

#### W7-03b — Memoize checked type fingerprints

- **Depends:** none.
- **Files:** `src/semantic/surface/type-model.ts`.
- **Do:** cache `checkedTypeFingerprint` in `WeakMap<CheckedType, string>`.
- **Test/example:** `expect(cache.get(type)).toBe(fingerprint);`.
- **AC:** no fingerprint value changes.

#### W7-03c — Memoize proof-check state keys

- **Depends:** none.
- **Files:** `src/proof-check/kernel/state-key.ts`.
- **Do:** cache computed keys per frozen state object.
- **Test/example:** `expect(stateKey(state)).toBe(stateKey(state));`.
- **AC:** proof-check outputs unchanged.

#### W7-03d — Stop rebuilding semantic surface snapshots three times

- **Depends:** W0-05c.
- **Files:** `src/semantic/surface/semantic-surface-checker.ts`.
- **Do:** make builder snapshots cheap or split seed/finalize so `build()` is called once.
- **Test/example:** instrumentation reports `buildCallCount === 1`.
- **AC:** semantic output is byte-identical.

#### W7-04a — Re-audit remaining grandfathered giant files after Waves 1-6

- **Depends:** W0-04b.
- **Files:** `docs/implementation/giant-file-split-map.md`, `tests/audit/subsystem-maintainability-audit.test.ts`.
- **Do:** after Waves 1-6, update the split map with actual remaining >900-line files, remove entries that W0/Wave work already shrank, and keep the no-growth audit strict.
- **Test/example:** `expect(remainingGrandfathered.every((entry) => entry.lineCount <= entry.recordedLineCount)).toBe(true);`.
- **AC:** the grandfathered list only shrinks or preserves recorded counts; no new giant file appears.

#### W7-04b — Write follow-on split tickets for remaining giant files

- **Depends:** W7-04a.
- **Files:** `docs/implementation/remaining-giant-file-splits.md`.
- **Do:** for each still-grandfathered file in the W7-04a map, write one exact future split ticket with owner boundary, new file names, pure-move test command, and the first behavior task that would benefit.
- **Test/example:** ticket row `src/proof-check/domains/facts.ts | split fact-state transitions into src/proof-check/domains/facts/state-transitions.ts | bun test tests/unit/proof-check`.
- **AC:** every remaining giant file has an exact owner-boundary split proposal with concrete file paths.

#### W7-05a — Intern keyword/punctuation green tokens with empty trivia

- **Depends:** none.
- **Files:** `src/frontend/syntax/green-token.ts`, `src/frontend/syntax/green-trivia.ts`, `src/frontend/syntax/syntax-factory.ts`, `src/frontend/lexer/lexer.ts`, `tests/unit/remediation/w7-05a.test.ts`.
- **Do:** cache fixed-vocabulary green tokens only when leading/trailing trivia are empty.
- **Test/example:** `expect(tokenA.green).toBe(tokenB.green);`.
- **AC:** reconstruct-lossless property tests remain green.

#### W7-05b — Benchmark flat CST as a spike, not production work

- **Depends:** W7-05a.
- **Files:** `docs/design/flat-cst-spike.md`, `scripts/benchmark-flat-cst-spike.ts`.
- **Do:** measure current CST vs flat-array prototype on a 100K-line module and record go/no-go recommendation.
- **Test/example:** doc table row `current CST | parse ms | heap MB`.
- **AC:** no production flat-CST migration lands without measured numbers.

#### W7-06a — Design deterministic parallel compilation

- **Depends:** W4-01c, W4-05c, W5-01c, W5-04c, W5-05d.
- **Files:** `docs/design/parallel-compilation.md`.
- **Do:** specify Bun worker boundaries, deterministic diagnostic merge, and artifact ordering.
- **Test/example:** doc pseudocode: `mergeDiagnostics(workers).sort(compareDiagnosticsDeterministically)`.
- **AC:** design doc is merged; no implementation in this plan.

#### W7-06b — Design fingerprint-keyed incremental compilation

- **Depends:** W7-06a.
- **Files:** `docs/design/incremental-compilation.md`.
- **Do:** specify module, graph, semantic, proof, and backend cache keys using the existing fingerprint lattice.
- **Test/example:** doc table `module content hash -> parse cache`.
- **AC:** follow-on implementation scope is explicit and separate.

### WAVE 8 — Bounded verification depth

Wave 8 is deliberately trimmed. Keep bounded local verification in this remediation plan; move research systems into design/roadmap artifacts.

#### W8-01a — Add parser fuzzing for arbitrary and mutated sources

- **Depends:** none.
- **Files:** `tests/integration/frontend/parser/parser-fuzz.test.ts`.
- **Do:** parse arbitrary byte strings and mutated fixture sources; assert parse never throws and reconstruct remains lossless.
- **Test/example:** `expect(tree.reconstruct()).toBe(source.text);`.
- **AC:** 1,000 fast-check cases run under 30 seconds and are included in `agent:check`.

#### W8-01b — Add parser fuel and deterministic diagnostic properties

- **Depends:** W8-01a.
- **Files:** `tests/integration/frontend/parser/parser-fuzz.test.ts`.
- **Do:** shuffle valid token streams with a fuel bound and assert diagnostics are identical across two runs.
- **Test/example:** `expect(runA.diagnostics).toEqual(runB.diagnostics);`.
- **AC:** any found crash or hang becomes a seeded corpus regression before fixing.

#### W8-02a — Add canonicalization double-freeze determinism tests

- **Depends:** W1-14a, W1-14b.
- **Files:** `tests/unit/proof-mir/canonicalization/freeze-determinism.test.ts`.
- **Do:** freeze each fixture draft graph twice and compare canonical bytes/JSON.
- **Test/example:** `expect(freeze(graph)).toEqual(freeze(graph));`.
- **AC:** fixture freeze output is byte-identical across repeated runs.

#### W8-02b — Add insertion-order permutation property tests

- **Depends:** W8-02a.
- **Files:** `tests/unit/proof-mir/canonicalization/freeze-determinism.test.ts`.
- **Do:** build equivalent draft graphs in shuffled insertion orders and assert identical frozen outputs.
- **Test/example:** `expect(freeze(shuffledGraph)).toEqual(freeze(originalGraph));`.
- **AC:** 200 shuffled cases pass locally; gate placement is `agent:check` if under 5 seconds, otherwise `verify:extended`.

#### W8-03a — Add skip-aware local Lean build wrapper

- **Depends:** W0-01a, W0-01b.
- **Files:** `package.json`, `scripts/verify-lean.ts`.
- **Do:** add `verify:lean`; run `lake build Wrela` when Lean is installed; skip only with `--allow-missing-lean`.
- **Test/example:** `bun run verify:lean -- --allow-missing-lean`.
- **AC:** non-skip mode exits nonzero if Lean is absent or proofs fail.

#### W8-03b — Add Lean coverage matrix and audit

- **Depends:** W8-03a.
- **Files:** `proof-model/COVERAGE.md`, `tests/audit/subsystem-maintainability-audit.test.ts`.
- **Do:** map every `src/proof-check/domains/*.ts` file to a Lean file and status `proved | modeled-no-theorem | not-modeled`.
- **Test/example:** coverage row `domains/sessions.ts | Wrela/Sessions.lean | modeled-no-theorem`.
- **AC:** adding a proof-check domain without a coverage row fails the audit.

#### W8-04a — Assemble local release gate script

- **Depends:** W6-05a, W6-05b, W8-01a, W8-01b, W8-02a, W8-02b, W8-03a, W8-03b.
- **Files:** `package.json`, `scripts/verify-release.ts`.
- **Do:** define `verify:release` as a local chain over `agent:check`, non-skip QEMU, non-skip Lean when required, scorecard, reproducible build, CLI smoke, and stdlib conformance.
- **Test/example:** `expect(packageJson.scripts["verify:release"]).toContain("bun run agent:check");`.
- **AC:** required release scripts cannot be skipped silently.

#### W8-04b — Write `RELEASING.md` as an executable checklist

- **Depends:** W8-04a.
- **Files:** `RELEASING.md`.
- **Do:** map every release-readiness claim to the local package script that proves it.
- **Test/example:** checklist row `QEMU boot smoke | bun run verify:qemu`.
- **AC:** no checklist item says "manual" without a command and justification.

#### W8-05a — Design the miscompile-confidence ladder

- **Depends:** W4-01a, W4-01b, W4-01c.
- **Files:** `docs/design/miscompile-confidence-ladder.md`.
- **Do:** define Level 1 fast fixture differential, Level 2 generated source differential, Level 3 QEMU/stress release lane, and Level 4 research/formal lanes.
- **Test/example:** doc table `Level 2 | generated .wr arithmetic programs | verify:extended`.
- **AC:** generated-program and herd7 work are explicitly outside the release-critical remediation path until separately approved.

#### W8-05b — Add one tiny generated arithmetic differential seed

- **Depends:** W8-05a, W4-01a, W4-01b, W4-01c.
- **Files:** `tests/unit/validation/miscompile-confidence/generated-arithmetic-seed.test.ts`.
- **Do:** generate only straight-line unsigned arithmetic expressions over currently supported operators and compare interpreter observations.
- **Test/example:** `a + (b * 3)` generated with seed 1.
- **AC:** 50 seeded programs pass; this is a seed, not the full Wave 8 research system.

#### W8-06a — Write proof-check domain to Lean differential roadmap

- **Depends:** W8-03a, W8-03b.
- **Files:** `docs/design/proof-check-lean-differential-roadmap.md`.
- **Do:** write the architecture for exporting judgment instances and comparing TS vs Lean verdicts plus licensing facts. Do not implement the runner in this remediation plan.
- **Test/example:** doc schema snippet `{ "domain": "sessions", "judgment": "open-obligation", "facts": [] }`.
- **AC:** roadmap names first lane, inputs, outputs, risk, and owner; no release task depends on it.

---

## Parent workstream context

The sections below preserve the original evidence, files, and architectural notes for each parent workstream. They are not direct subagent assignments; assign the suffixed catalog tasks above.

# WAVE 0 — Harness and gates

### W0-01 — Make `agent:check` the complete fast local gate

- **Size:** S. **Depends:** none.
- **Files:** edit `package.json`; create `tests/audit/local-verification-audit.test.ts`; optionally create `scripts/verify-extended.ts` only if the package-script command becomes unreadable. Do **not** create `.github/` or any workflow file in this plan.
- **Current state (verified):** no `.github` directory exists, and this plan intentionally keeps it that way. `package.json` has `"@types/bun": "latest"` and caret ranges for all dev tools; no `packageManager` field. `agent:check` does not include `validate:full-image`.
- **Change:**
  1. Add `"packageManager": "bun@1.3.14"` and pin `@types/bun` to the exact version currently resolved in `bun.lock`.
  2. Add a fast local full-image script:

     ```json
     "verify:full-image": "bun run scripts/validate-full-image.ts --json"
     ```

  3. Extend `agent:check` so it includes the fast full-image validation:

     ```json
     "agent:check": "bun run typecheck && bun run format:check && bun run lint && bun run policy:check && bun test && bun run verify:full-image"
     ```

  4. Add a longer local verification lane for checks that should not run on every handoff. At W0-01 time it should still be executable, so it starts as an alias for the checks that already exist:

     ```json
     "verify:extended": "bun run verify:full-image"
     ```

     W8-03 appends `verify:lean`, W6-05 appends `verify:qemu`, and catalog tasks in Waves 4, 5, and 8 append their stress/differential lanes as they land. Never point `verify:extended` at a missing script.

  5. Add `tests/audit/local-verification-audit.test.ts` that reads `package.json` and asserts `agent:check` contains `verify:full-image`, and asserts no `.github/workflows` path exists.

- **Tests:** run `bun test tests/audit/local-verification-audit.test.ts`; then run `bun run agent:check` to prove the new script chain works.
- **AC:** from a clean checkout, `bun run agent:check` runs typecheck, format check, lint, policy check, tests, and `verify:full-image`; deliberately breaking a full-image fixture makes `agent:check` fail; `bun run verify:full-image` prints JSON; no `.github/` directory is created.

### W0-02 — Negative-diagnostic fixture corpus harness

- **Size:** M. **Depends:** none.
- **Files:** create `tests/system/diagnostics/diagnostics-corpus.test.ts`, `tests/fixtures/diagnostics/README.md`, and per-case directories `tests/fixtures/diagnostics/<case-name>/{input.wr,expected.json}`.
- **Current state (verified):** there is no corpus asserting _exact diagnostic codes for bad programs_. The verified frontend holes (REV-A BUG-1/2/4) each currently produce **0 diagnostics**.
- **Change:** build a data-driven runner: for each fixture directory, lex+parse+run module-graph+semantic surface via the same entry the package pipeline uses (import `Lexer`, `Parser`, and the semantic-surface entry from `src/frontend`/`src/semantic`; for full-pipeline cases, use `compileUefiAArch64ImageWithTrace` with the fixture as `packageInput` and QEMU disabled). `expected.json` schema:

  ```json
  { "phase": "parse" | "semantic" | "pipeline",
    "diagnostics": [ { "code": "PARSE_EXPECTED_TOKEN", "spanText": "pub", "count": 1 } ] }
  ```

  The runner asserts the produced diagnostic multiset ⊇ expected (exact `code`, and the source text sliced at the diagnostic span must equal `spanText` when given), and asserts **zero diagnostics** for fixtures named `ok-*`. Seed the corpus with placeholder cases that currently _document today's wrong behavior_ (e.g. `pub-fn-silently-ignored/expected.json` asserting 0 diagnostics with a `"todo": "W1-02"` field the runner prints as a warning) so W1 tasks flip them to their correct expectations.

- **AC:** `bun test tests/system/diagnostics` green; adding a fixture with a wrong expected code fails with a readable diff showing actual codes+spans.

### W0-03 — Extend the maintainability audit pattern to every subsystem

- **Size:** M. **Depends:** none.
- **Files:** create `tests/audit/subsystem-maintainability-audit.test.ts`; edit nothing in `src`.
- **Current state (verified):** `tests/audit/mono-maintainability-audit.test.ts` enforces a 1000-line cap + scar-tissue negatives, but **only for `src/mono`**. 24 files across other subsystems exceed 880 lines (list in REV-D §21).
- **Change:** generalize the mono audit: a table of `{ subsystemRoot, maxLines, grandfathered: string[] }` covering `src/semantic`, `src/proof-mir`, `src/proof-check`, `src/opt-ir`, `src/target/aarch64`, `src/layout`, `src/linker`, `src/pe-coff`, `src/frontend`. Populate `grandfathered` with the exact current over-limit files (so the audit is green on day one) and assert **no new file** exceeds the cap and **no grandfathered file grows** (record current line counts; fail if `lines(file) > recordedLines`). Add scar-tissue negatives repo-wide: no `as any` outside `src/semantic/names/{expression-resolver,type-reference-resolver}.ts` (grandfathered until W1-16f), no `@ts-ignore`, no `Math.random`/`Date.now` in `src`, no new `JSON.stringify` in `src/proof-mir/canonicalization` or `src/proof-check/validation` (grandfathered occurrences listed until W1-14).
- **AC:** audit green today; appending 30 lines to any grandfathered file turns it red; `touch src/opt-ir/new-file.ts` with 1100 lines turns it red.

---

# WAVE 1 — Correctness stop-the-line

Every task here fixes a **verified** bug. All are independent unless noted.

### W1-01 — Stop clobbering callee-saved registers (interim pool restriction + verifier)

- **Size:** S. **Depends:** none. _(Full save/restore is W5-01; this task removes the miscompile now.)_
- **Files:** `src/target/aarch64/backend/api/function-pipeline.ts`, `src/target/aarch64/verify/abi-verifier.ts`, new test `tests/unit/target/aarch64/backend/callee-saved-pool.test.ts`.
- **Current state (verified):** allocatable GPRs are x0–x28 minus x18/x29/x30 (`physical-register-model.ts:44-48`); the frame only ever saves x30 (`function-pipeline.ts:474`: `savedRegisters: reconciled.value.boundaries.length === 0 ? [] : ["x30"]`); `publicCalleeSavedGprs` (x19–x28, declared `physical-register-model.ts:27`) has **no consumer**. Any function needing >~16 live GPRs hands out x19+ and returns it dirty to firmware.
- **Change:**
  1. In `allocationRegisterPools(target)` (`function-pipeline.ts:659`), filter the GPR pool: `gprs.filter((r) => !target.registerModel.publicCalleeSavedGprs.includes(r))`. (Every compiled function currently sits on a public boundary; when W5-01 lands, this filter becomes conditional on boundary kind.)
  2. Add an ABI-verifier check in `verify/abi-verifier.ts`: given the allocation segments and the frame's `savedRegisters`, report `AARCH64_ABI_CALLEE_SAVED_UNPRESERVED` (add to that file's diagnostic codes, following its existing code-registration pattern) for any segment whose `physical` is in `publicCalleeSavedGprs` (or aliases, via `aarch64RegistersAlias`) and not covered by `savedRegisters`. Wire the check into the function pipeline right after the existing `verify-allocation` stage.
  3. Vector equivalent: also exclude `d8`–`d15`/`v8`–`v15` (callee-saved SIMD low halves per AAPCS64) from the vector/fp pools with the same mechanism — add `publicCalleeSavedSimd: rangeKeys("v", 8, 15)` (plus `d8-d15`) to the register model and filter.
- **Tests:** construct a machine function (use the existing backend test builders in `tests/unit/target/aarch64/backend/backend-end-to-end.test.ts` as the template) with 20 simultaneously-live GPR values; assert (a) allocation succeeds using only non-callee-saved registers plus spills, (b) no allocation segment uses x19–x28, (c) hand-crafting an allocation that uses x20 and running the new verifier yields `AARCH64_ABI_CALLEE_SAVED_UNPRESERVED`.
- **AC:** new tests green; existing `backend-end-to-end.test.ts:121` (which currently proves x20 can be selected — REV-C evidence) updated to prove it _cannot_; `bun run validate:full-image -- --json` green until W0-01 folds that check into `agent:check`.

### W1-02 — Reject top-level non-declarations; decide `pub`

- **Size:** M. **Depends:** W0-02.
- **Files:** `src/frontend/parser/source-file-parser.ts`, `src/frontend/parser/parser-diagnostics.ts`, `stdlib/wrela-std/target/uefi/console.wr` (and any other stdlib/fixture `pub` occurrences — grep `pub ` across `stdlib/` and `tests/fixtures/`), corpus fixtures.
- **Current state (verified by executed probe):** `pub fn helper()` and `banana zebra unicorn` at top level parse with **0 diagnostics**; top-level expression statements are dropped by item-index/name-resolution/HIR (REV-A BUG-1). The stdlib itself uses `pub fn` (`console.wr:5`).
- **Change:**
  1. **Language ruling (already decided by omission):** `pub` is not in the language. Remove `pub ` from every `.wr` file in `stdlib/` and `tests/fixtures/` (verified occurrences: `stdlib/wrela-std/target/uefi/console.wr`; grep for the rest).
  2. In `parseSourceFile` (`source-file-parser.ts`), after `tryParseDeclaration` fails, **do not** fall through to `tryParseStatement`. Instead: `recoverUntil(context, topLevelStarterKinds)`, wrap the skipped tokens in an `ErrorNode`, and report a new diagnostic `PARSE_EXPECTED_TOP_LEVEL_DECLARATION` with message `` `Expected a top-level declaration (use, fn, class, dataclass, enum, interface, stream, validated buffer, or image).` `` at the offending token's span. Add the code to `parser-diagnostics.ts`'s `ParseDiagnosticCode` union.
  3. Keep statement parsing available for REPL-ish future use behind an explicit `parseSourceFile(context, { allowTopLevelStatements: true })` option defaulting to `false` — the module-graph path uses the default.
- **Tests:** corpus fixtures `top-level-garbage` (expects 1× `PARSE_EXPECTED_TOP_LEVEL_DECLARATION`, spanText `banana`), `pub-fn` (expects 1× same code, spanText `pub`), `ok-plain-fn` (0 diagnostics). Full suite green (this is the proof the stdlib/fixture sweep in step 1 was complete).
- **AC:** the W0-02 placeholder fixtures flip to their correct expectations; `bun run validate:full-image -- --json` green until W0-01 folds that check into `agent:check`.

### W1-03 — Define and enforce the string-escape grammar; cook string values once

- **Size:** M. **Depends:** W0-02.
- **Files:** `src/frontend/lexer/lexer.ts` (`scanString`), `src/frontend/lexer/token.ts` (or a sibling — carry a cooked value), `src/frontend/lexer/diagnostics.ts`, `src/frontend/ast/expression-views.ts` (`LiteralExpressionView`), `src/hir/expression-lowerer.ts:163-183`, `src/semantic/surface/compiler-intrinsic-collector.ts:148-158`, `docs/language/happy.md` (spec addition).
- **Current state (verified by executed probe):** `"\q oops"` produces 0 diagnostics anywhere; the lexer skips `\<any>` pairs (`lexer.ts:522-532`); HIR stores the **raw lexeme including quotes** as the string value; the only decoder is `JSON.parse` with a silent `slice(1,-1)` fallback (intrinsic collector). Additionally (REV-C): a trailing backslash before newline/EOF produces **two** diagnostics (unterminated string + invalid character) for one error.
- **Change:**
  1. **Spec:** the escape set is `\\`, `\"`, `\n`, `\r`, `\t`, `\0`, `\xNN` (exactly 2 hex digits), `\u{H+}` (1–6 hex digits, ≤ 0x10FFFF, no surrogates). Document in `happy.md`.
  2. In `scanString`, decode as you scan into a `cookedValue: string`; on an invalid escape, report new `LEX_INVALID_ESCAPE` (message names the escape, span covers `\` through the offending char) and substitute U+FFFD in the cooked value so downstream stays total. Consume a trailing `\` before newline/EOF _into the string token's span_ and emit exactly one `LEX_UNTERMINATED_STRING` (fixes the double-diagnostic).
  3. Add `cookedValue?: string` to string tokens → expose `LiteralExpressionView.cookedStringValue(): string | undefined` (decodes from green token). HIR `lowerLiteral` stores the cooked value (no quotes). Delete `decodedStringLiteralValue` in the intrinsic collector and read the cooked value from the view; if absent, report the existing invalid-intrinsic diagnostic rather than falling back.
- **Tests:** corpus fixtures: `bad-escape` (`"\q"` → 1× `LEX_INVALID_ESCAPE`), `trailing-backslash` (exactly 1× `LEX_UNTERMINATED_STRING`), `ok-escapes` (all valid escapes, 0 diagnostics). Unit test in `tests/unit/frontend/` asserting cooked values: `"\x41\u{1F600}"` cooks to `A😀`. Update any utf16-static tests that relied on JSON semantics. `tree.reconstruct()` must still return the _raw_ source (lossless invariant untouched — cooked value is a side channel).
- **AC:** full suite + `validate:full-image` green; grep confirms `JSON.parse` no longer appears in `compiler-intrinsic-collector.ts`.

### W1-04 — Hex/binary integer literals + statement-separator enforcement

- **Size:** M. **Depends:** W0-02.
- **Files:** `src/frontend/lexer/lexer.ts` (`scanInteger`), `src/frontend/lexer/diagnostics.ts`, `src/hir/expression-lowerer.ts` (BigInt parse of new forms), `src/hir/layout-expression-lowerer.ts:84`, `src/hir/requirement-lowerer.ts:136`, `src/frontend/parser/block-parser.ts`, `docs/language/happy.md`.
- **Current state (verified by executed probe):** `return 0x1F` parses with 0 diagnostics as `return 0` followed by a second same-line statement `x1F`. No hex/binary literals; no statement-separator requirement.
- **Change:**
  1. `scanInteger`: accept `0x[0-9a-fA-F_]+`, `0b[01_]+`, and `_` digit separators in decimal; reject trailing `_` and empty digit runs with new `LEX_MALFORMED_INTEGER` (span = whole literal). Store the lexeme as-is (token kind unchanged: `IntegerLiteral`).
  2. Everywhere integer lexemes become values (the three HIR sites above use `BigInt(text)`): route through one new helper `parseWrIntegerLiteral(text: string): bigint` in `src/shared/` that strips `_` and handles `0x`/`0b` (native `BigInt("0x1F")` already works; strip `_` first). Grep `BigInt(` under `src/hir` and `src/proof-mir/lower` for any other literal-text parse sites and route them too.
  3. In `block-parser.ts`, after each successfully parsed statement, require the next token to be `Newline`/`Dedent`/`Eof` (or the statement-internal continuations already handled); otherwise report new `PARSE_EXPECTED_STATEMENT_SEPARATOR` at the unexpected token and recover with `blockItemRecoveryKinds`.
- **Tests:** corpus: `ok-hex-literals` (`0xFF`, `0b1010`, `1_000_000` in `u32` contexts, 0 diagnostics), `malformed-hex` (`0x` → `LEX_MALFORMED_INTEGER`), `two-statements-one-line` (`return 0 x1F` shape → `PARSE_EXPECTED_STATEMENT_SEPARATOR`). Unit: `parseWrIntegerLiteral("0x1F") === 31n`, `("1_0") === 10n`. HIR range-check still fires: `let x: u8 = 0x1FF` → `HIR_INTEGER_LITERAL_OUT_OF_RANGE`.
- **AC:** suite + corpus green; the probe from REV-A now yields 1 diagnostic instead of 0.

### W1-05 — Proof-MIR draft control-edge keys: site-discriminated, duplicate-rejected

- **Size:** M. **Depends:** none. **This is the highest-priority user-visible bug in the plan.**
- **Files:** `src/proof-mir/draft/draft-keys.ts`, `src/proof-mir/draft/draft-graph-terminators.ts`, `src/proof-mir/lower/if-lowerer.ts`, `src/proof-mir/lower/loop-lowerer.ts`, `src/proof-mir/lower/validation-lowerer.ts`, `tests/unit/proof-mir/draft-keys.test.ts`, `tests/unit/proof-mir/if-lowerer.test.ts`, `tests/unit/proof-mir/loop-lowerer.test.ts`, `tests/fixtures/full-image-validation/two-branch-control-flow/toolchain-stdlib/src/image.wr`, `tests/fixtures/full-image-validation/two-branch-control-flow/ejected-stdlib/src/image.wr`, `tests/fixtures/full-image-validation/two-branch-control-flow/direct-platform/src/image.wr`.
- **Current state (verified):** `draftControlEdgeKey({functionInstanceId, role})` (`draft-keys.ts:188-196`) has no site component. `createBranchEdge` passes `role: edgeMethodInput.kind` — the bare string `"branchTrue"`/`"branchFalse"` (`draft-graph-terminators.ts:274-276`); `createValidationEdge` uses `role ?? kind` (`:326`); callers pass no role. `createEdge` does `edges.set(edgeKey, …)` with **no duplicate check** (`:171-190`). Consequence: **two `if` statements — or an `if` and a `while` — in one function produce colliding edge keys and the second overwrites the first.** `createReturnExit` already shows the correct pattern: `role: \`returnExit:${fromBlock}\`` (`:410-421`). No fixture exercises two branch sites per function (verified), so this ships broken today.
- **Change:**
  1. In every edge-creating method that currently derives `role` from bare `kind` (`createBranchEdge`, `createValidationEdge`, `createPanicEdge`, and any sibling found by reading all `createEdge` call sites in the file), compose the role as `` `${kind}:${String(edgeMethodInput.fromBlock)}` `` — mirroring `createReturnExit`. Block keys are already unique per function, making the edge key unique per (function, site, arm).
  2. In the low-level `createEdge` (`:159-190` region), **before** `edges.set`, check `edges.has(edgeKey)` and, if present, record an internal builder error (the draft builder has an error-collection mechanism — follow how other draft invariant violations are reported in `draft-graph-builder.ts`; if none exists for edges, throw a `RangeError` with the colliding key: this is compiler-internal, not user-triggerable once (1) lands, and a throw is acceptable per protocol rule 5). Same for `createExit`/`draftExitEdgeKey`.
  3. Canonicalization consumes these keys — run the freeze snapshot tests to catch any place that assumed the old shapes; update golden keys where they appear in test expectations (expected churn: proof-mir canonical-key snapshots).
- **Tests:**
  1. Unit: build a draft graph for one function with two independent `if`s; assert 4 distinct control-edge keys and 4 edges present after freeze.
  2. Unit: an `if` followed by a `while` in one function — assert no key collision (`branchTrue` from both sites distinct).
  3. Integration: add a `.wr` fixture function with two sequential `if` statements to `tests/fixtures/full-image-validation/two-branch-control-flow/{toolchain-stdlib,ejected-stdlib,direct-platform}/src/image.wr` and assert full-image validation passes. This is the end-to-end proof, and it currently **must fail before the fix**; if it unexpectedly passes before the fix, stop and re-diagnose because the finding predicts failure.
- **AC:** all three tests green; canonical-key snapshot churn reviewed and confined to edge keys; `validate:full-image` green.

### W1-06 — Derive and validate `incomingEdges` in the proof-MIR graph validator

- **Size:** M. **Depends:** W1-05 (edge identity must be stable first).
- **Files:** `src/proof-mir/validation/graph-validator.ts`, `src/proof-mir/diagnostics.ts`, `tests/unit/proof-mir/graph-validator.test.ts`, `tests/unit/remediation/w1-06a.test.ts`, `tests/unit/remediation/w1-06b.test.ts`.
- **Current state (verified):** `ProofMirBlock.incomingEdges` is stored by builders and consumed by proof-check joins (`graph-worklist-session.ts:76,377`, `graph-worklist-join-coordinator.ts:101`), but no validator cross-checks it against terminator edges (zero grep hits for `incomingEdges` in `src/proof-mir/validation/`). A block that under-reports incoming edges makes the join coordinator merge with fewer predecessors than exist — an unsound merge (REV-C Critical #1).
- **Change:** in `validateFunctionGraph`, derive `predecessors: Map<blockId, Set<edgeId>>` by walking every block's terminator edges + the edge table (mirror the traversal `validateTerminatorEdges` already does). Then for each block, compare the derived set with the stored `incomingEdges` (as sets of edge ids): report new code `PROOF_MIR_INCOMING_EDGES_MISMATCH` naming the block and the symmetric difference (`stableDetail: \`missing:${…}|extra:${…}\``) for any mismatch, including duplicates within `incomingEdges`and edges whose recorded`fromBlockId` differs from the block whose terminator carries them.
- **Tests (all four from REV-C):** two-predecessor block with one stored incoming edge → mismatch; stored incoming edge no terminator produces → mismatch; edge in block A's terminator whose record says from-block B → mismatch; well-formed graph → 0 diagnostics. Build these with the proof-mir test graph builders used by existing `graph-validator` tests.
- **AC:** validator tests green; full suite green (if any existing fixture graph fails the new check, that is a real caught bug — fix the _builder_, never weaken the check).

### W1-07 — Fix symlink containment in the file repository

- **Size:** S. **Depends:** none.
- **Files:** `src/frontend/lexer/bun-file-repository.ts:31-40`, `tests/unit/frontend/lexer/file-repository.test.ts`.
- **Current state (verified):** containment is `realResolved.startsWith(realRoot)` — `root-evil/...` passes a `root` prefix check. Existing test covers a non-prefix outside path only.
- **Change:** replace with `path.relative`:

  ```ts
  import { isAbsolute, relative, sep } from "node:path";
  const relativePath = relative(realRoot, realResolved);
  const escapes = relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
  if (escapes) { return { kind: "unreadable", path, message: … }; }
  ```

  Apply the same containment to the lexical (pre-realpath) `resolved` path as well, so both views agree.

- **Tests:** regression exactly as REV-C specifies: create temp dirs `root/` and `root-evil/`, `root/link.wr → ../root-evil/secret.wr`; assert `unreadable`. Keep the existing outside-path test. Also test that a symlink to a file _inside_ the root still loads.
- **AC:** new tests green; suite green.

### W1-08 — Whole-program inlining: return-of-parameter substitution

- **Size:** S. **Depends:** none.
- **Files:** `src/opt-ir/passes/whole-program-inlining.ts` (`buildValueSubstitution`, `inlineSourceCall`), tests in `tests/unit/opt-ir/`.
- **Current state (verified):** `buildValueSubstitution` (`:348-367`) inserts `param→arg` then `returnValue→resultId`; when the callee returns one of its own parameters the second insertion **overwrites** the first, rewriting cloned operand uses of that parameter to the (now-undefined) call result id; zero-op identity callees leave the caller's result id with no defining op (REV-A BUG-5).
- **Change:** compute the two maps separately. Operand substitution for cloned ops = `param→arg` only. For each return value `rv[i]`: if `rv[i]` is defined by a cloned callee op, rewrite that op's _result id_ to `resultIds[i]` (the current behavior, kept); otherwise (returned parameter or otherwise externally-defined value) append an explicit copy operation `resultIds[i] ← substitute(rv[i])` to the cloned sequence — use the opt-ir copy/identity op the codebase already has (find the op `copy-propagation.ts` recognizes as a copy; if none exists as a constructor, use the canonical `optIr…` factory for a move/copy from `operations.ts`). Deny inlining only if no copy op kind exists for the value's type (report via the existing decision log with reason `inline:denied:return-shape`).
- **Tests:** (1) identity callee `fn id(x) => x` inlined — verify with the structural verifier (`verifyPipelineState` path) that all uses are defined, and SCCP/copy-prop then folds the copy; (2) callee `let y = x + 1; return x` — assert the cloned add still consumes the _argument_, not the result id; (3) run each through `runWholeProgramInliningStep` and assert the pipeline verifier reports no errors.
- **AC:** both shapes previously produced dangling defs (write the tests first and observe the verifier failure); after the fix, green.

### W1-09 — Wire the real target contract into the wrela endian pass

- **Size:** S. **Depends:** none.
- **Files:** `src/opt-ir/passes/pipeline-steps.ts:408-449` (`runWrelaCluster` signature + dispatch), `src/opt-ir/passes/pipeline-dispatch.ts` (pass `input.target` through), `src/opt-ir/target-surface.ts` (add the two contract bits if absent), `src/target/uefi-aarch64/` opt-ir target surface construction (set honest values).
- **Current state (verified):** `runWrelaCluster` hardcodes `targetContract: { permitsFirmwareEndianFold: false, permitsVolatileEndianFold: false }` — the endian/parser-collapse rewrites can never fire regardless of target.
- **Change:** add `endianFoldContract: { permitsFirmwareEndianFold: boolean; permitsVolatileEndianFold: boolean }` to `OptIrTargetSurface`; thread `input.target` into `runWrelaCluster(state, target)` from the dispatcher (the vectorization steps two cases below already receive it — copy that pattern); populate the UEFI surface with the values the target actually guarantees (start conservative-but-real: `permitsFirmwareEndianFold: false`, `permitsVolatileEndianFold: false` **in the target surface**, with a comment stating the DDI0487/firmware rationale — the point of this task is ownership, not enabling).
- **Tests:** unit test that a target surface with `permitsFirmwareEndianFold: true` causes `runWrelaEndianParserCollapse` to receive it (spy via a fake surface + candidate fixture); audit-style grep test asserting the string `permitsFirmwareEndianFold: false` no longer appears in `pipeline-steps.ts`.
- **AC:** suite green.

### W1-10 — Key attempt/validation contract inference to stdlib module identity

- **Size:** M. **Depends:** none.
- **Files:** `src/semantic/surface/semantic-surface-checker.ts:272-300` (`appliedSourceConstructorName`, `appliedSourceTypeNamed`), `src/semantic/names/core-types.ts` or the module namespace (identity source), tests in `tests/unit/semantic/surface/`.
- **Current state (verified):** contract-bearing types are matched by **bare type name** (`"Result"`, `"Validation"`, `"Attempt"`) over any `constructor.kind === "source"` type — a user-defined 2-arg `Result` in any module silently acquires attempt-contract semantics (REV-A BUG-7).
- **Change:** resolve the canonical `TypeId`s once per program: during semantic setup, look up items named `Result`/`Validation`/`Attempt` **only in modules whose path key starts with `wrela_std.core`** (module records carry `pathKey` — see `ItemIndex.module`), yielding `ContractTypeIds { resultTypeId?, validationTypeId?, attemptTypeId? }`. Replace `appliedSourceConstructorName(type) === "Result"` comparisons with `type.constructor.typeId === contractTypeIds.resultTypeId`. When the stdlib is absent (direct-platform mode), the ids are undefined and no inference happens — assert the direct-platform fixture still passes (it must not depend on name-based inference; if it does, that is a real dependency to surface — stop and report).
- **Tests:** (1) user module defines `class Result[A, B]:` and a function returning it → assert **no** attempt contract is inferred (inspect `checkedProofSurface.attemptContracts`); (2) stdlib `Result` still infers as before (existing tests must stay green); (3) all three stdlib fixture modes of full-image validation green.
- **AC:** suite + `validate:full-image` green.

### W1-11 — Block-locals: decide and enforce the shadowing rule

- **Size:** M. **Depends:** none.
- **Files:** `src/semantic/names/expression-resolver.ts` (`ResolutionWalkContext.localNames` → real scope tier), `src/semantic/names/scope.ts`, `src/semantic/names/diagnostics.ts`, `docs/language/happy.md`.
- **Current state (verified):** `resolveSimpleNameExpression` consults `scope.lookupValue` (params/members/module items) **before** `localNames`; a `let x` shadowing a module function resolves later `x` uses to the module function (REV-A BUG-8). Locals carry no reference records at all.
- **Change (ruling: locals shadow outers — least-surprise; document in happy.md):** replace `localNames: ReadonlySet<string>` with a local scope tier that records `{ name, span, ordinal }` at each binding and is consulted **first** in `resolveSimpleNameExpression`/`resolveCalleeName`/member-base resolution. Emit a resolved reference of a new kind `{ kind: "local", bindingSpan }` so HIR/proof surfaces can key on it (extend `ResolvedReference` union + `referenceKindFromResolved`). HIR already has its own local scope — verify `hir/local-scope.ts` agrees with the new records via an integration test (a shadowed name flows through HIR to the local, not the function).
- **Tests:** (1) module fn `helper` + `let helper = 1` then use → resolves to local (assert via `ResolvedReferences` lookup kind); (2) pattern binding in `match` shadowing a parameter; (3) no-shadow case regression (plain param use still resolves to parameter); (4) full-image fixtures green.
- **AC:** suite + corpus green.

### W1-12 — Preserve applied-constructor resource kinds at the semantic surface; enforce the dataclass affine rule

- **Size:** M. **Depends:** none.
- **Files:** `src/semantic/surface/resource-kind-checker.ts:86-93` (applied case), `src/semantic/surface/resource-kind.ts` (join/derivation rules), `src/semantic/surface/semantic-surface-checker.ts` (field checking), `src/semantic/surface/diagnostics.ts`, tests.
- **Current state (verified):** the `applied` case with arguments returns `joinResourceKinds(argumentKinds)` — **ignoring the constructor's own kind** (`Stream[T]` etc.); mono later re-derives via `fieldAggregation`/`appliedConstructor` rules (`mono/resource-kind-concretizer.ts:217+`) — classic phase drift (REV-C High #5). Separately, `happy.md:122-126` requires ordinary `dataclass` to **reject** affine fields rather than lift, and no semantic check implements it (REV-D #5); `joinConcreteResourceKinds` lifts unconditionally.
- **Change:**
  1. Applied case: compute the constructor's declared kind first (source constructors: the `sourceTypeKinds`/`constructorKindRules` context already threaded into `resourceKindForType`; target constructors: `targetTypeKinds`). If the constructor has a declared derivation rule, apply it (constructor kind lifted over argument kinds per the rule); only fall back to the argument join when no rule exists — and report that as the existing "missing constructor kind rule" path rather than silently joining.
  2. Dataclass rule: in `checkFieldTypesAndBuildKinds` (`semantic-surface-checker.ts:89-197`), after computing each field's kind, if the owning item's kind is `dataclass` and the field kind is proof-relevant/affine (use `isProofRelevantKind` + non-`Copy` concrete check), report new `SEMANTIC_DATACLASS_AFFINE_FIELD` at the field span.
  3. Align the blessing test REV-C cites (`tests/unit/semantic/surface/resource-kind-checker.test.ts:82`) with the new behavior, and confirm `tests/unit/mono/resource-kind-concretizer.test.ts:25` (which expects `appliedConstructor` recovery) still passes — mono keeps its rules as a redundant check, now expected to agree with semantic.
- **Tests:** `Stream[u32]` parameter kind is `Stream` at the semantic surface (not `Copy`); `dataclass Holder: token: NetworkWake`-shaped fixture → `SEMANTIC_DATACLASS_AFFINE_FIELD`; existing surface/mono suites green.
- **AC:** suite + `validate:full-image` green.

### W1-13 — Import discovery from parsed syntax (kill the lexical second grammar)

- **Size:** M. **Depends:** W1-02 (top-level statement rejection changes recovery behavior).
- **Files:** `src/frontend/lexer/import-discovery.ts` (retire), `src/frontend/lexer/module-graph-lexer.ts` (drive discovery from parse), `src/frontend/parser/import-declaration-parser.ts` + `ast` import views (source of truth), `src/target/uefi-aarch64/package-pipeline.ts:425-464` (consumes requests — types unchanged), tests.
- **Current state (verified):** `ImportDiscovery` re-implements `use X from mod` at token level and treats **any** `use` token anywhere (including inside function bodies / invalid positions) as a module-graph dependency (REV-A F7, REV-C High #7).
- **Change:** the module-graph loader currently lexes each file and runs `ImportDiscovery` before parsing. Change it to lex **and parse** each file once (the parse is needed later anyway — check `module-graph-parser.ts` for where the parse currently happens and hoist/reuse; do not parse twice), then walk the tree's top-level `ImportDeclaration` views to produce the same `ModuleImportRequest[]` shape (importer, source, moduleName, span). Delete `import-discovery.ts` and its shims after moving its malformed-import diagnostics into the import-declaration parse path (`LEX_IMPORT_MALFORMED` → keep code, re-point producer). A nested `use` now yields the W1-02 top-level diagnostic (or a statement-level parse error) and **no module-graph edge**.
- **Tests:** corpus: `nested-use` fixture (a `use` inside a function body) → parse diagnostic present AND package pipeline reports no missing-module diagnostic for the phantom import (assert via `compileUefiAArch64ImageWithTrace` diagnostics); existing import fixtures green; `import-discovery-fuzz.test.ts` re-pointed at the parsed path (keep the fuzz, swap the subject).
- **AC:** suite + fuzz + `validate:full-image` green; `src/frontend/lexer/import-discovery.ts` deleted.

### W1-14 — Canonicalize all authority fingerprints (stable JSON everywhere)

- **Size:** S. **Depends:** none.
- **Files:** `src/proof-check/validation/input-validator.ts:58-80`, `src/proof-mir/canonicalization/program-freeze-shared.ts:65-86,230`, `src/shared/stable-json.ts` (consumer only), audit entry in W0-03's list.
- **Current state (verified):** `input-validator.ts:59` uses local `JSON.stringify` with a bigint-only replacer feeding layout-authority fingerprints (insertion-order sensitive — REV-C Medium); `program-freeze-shared.ts:65-86` builds canonical place keys with raw `JSON.stringify(record.root)` etc. (deterministic today only because record shapes are statically constructed).
- **Change:** replace every occurrence with `stableJson` from `src/shared/stable-json.ts` (verify it handles bigint — it is used on bigint-bearing structures elsewhere; if not, extend it with the same replacer once, centrally). Update any golden fingerprints in tests (expected: layout-authority fingerprint constants).
- **Tests:** property test: permute object key insertion order of a layout fact input (construct two structurally-equal objects with different key orders) → identical fingerprint; grep-audit (W0-03) that `JSON.stringify` does not appear in those two files.
- **AC:** suite green; churned golden values reviewed as fingerprint-only.

### W1-15 — Module-graph failure diagnostics; module-path errors as diagnostics

- **Size:** S. **Depends:** none.
- **Files:** `src/frontend/lexer/module-graph-lexer.ts:51-61`, `src/frontend/lexer/module-path.ts:12-36`, `src/frontend/lexer/module-resolver.ts`, diagnostics registry in `src/frontend/lexer/diagnostics.ts`.
- **Current state (verified via REV-C, spot-checked):** a module is marked visited before read success and read-failure diagnostics are emitted only when an `importRequest` exists — a missing _entry_ module can produce zero modules and zero diagnostics; multiple import sites of one missing module collapse to the first. `module-path.ts` throws bare `Error` on NUL/absolute/`..`/drive paths — user-triggerable throws.
- **Change:** separate `attempted` from `loaded` state; always emit `LEX_MODULE_READ_FAILED` (new code) for the entry module when it cannot be read (span: synthetic zero-span with module name in message); emit one diagnostic **per import site** (each has its own span) for missing imports. Convert `module-path.ts` throws into a result type consumed by the resolver which emits `LEX_MODULE_PATH_INVALID` with the offending path text.
- **Tests:** missing entry module → exactly 1 diagnostic naming it; two files importing the same missing module → 2 diagnostics with distinct spans; `use x from ../evil` → `LEX_MODULE_PATH_INVALID`, no throw (assert with `expect(() => …).not.toThrow()` plus diagnostic presence).
- **AC:** suite green.

### W1-16 — Small verified-defect cluster (six S-size subtasks, independently landable)

Each subtask: write the failing unit test first, fix, `agent:check`.

- **a. Pattern span indexing** — `src/semantic/names/expression-resolver.ts:1190`: replace `segTexts.indexOf(memberName)` with the loop index (iterate `memberSegments` with positional offset). Test: pattern `A.b.b` — second `b`'s diagnostic/reference span ≠ first's.
- **b. Image-name misuse diagnostic** — `src/hir/expression-lowerer.ts:307-315`: replace the silent error-typed expression with `HIR_IMAGE_NAME_NOT_A_VALUE` (new code in `hir/diagnostics.ts`). Test: using the image name as a call argument → that code.
- **c. Index-expression diagnostic span** — `src/frontend/parser/expression-parser.ts:258-287`: report `PARSE_UNSUPPORTED_INDEX_EXPRESSION` (new code, message pointing at validated buffers) spanning `[`…`]`, and mark the error node from the postfix start (pass the pre-`left` mark into `nodeFromMark`). Test: corpus `index-expression` expects the new code with `spanText: "[0]"`.
- **d. Binary/unary operand typing in HIR** — `src/hir/expression-lowerer.ts:658-715`: `lowerBinaryLike` reports `HIR_BINARY_OPERAND_TYPE_MISMATCH` when `left.type ≉ right.type` (skip error types) and `HIR_ARITHMETIC_REQUIRES_INTEGER` when a `+ - * / %` operand is non-integer (`isIntegerCheckedType` exists at `:123`); `lowerUnary` rejects `-` on any type (language has no signed ints — until W3-08 decides otherwise, unary minus on unsigned is `HIR_ARITHMETIC_REQUIRES_INTEGER` with a message saying negation is unsupported). Tests: `"s" + 5`, `1 + "s"`, `-x` fixtures.
- **e. Integer literal defaulting** — `src/hir/expression-lowerer.ts:183-196`: when no expected type constrains a literal, default to `u64` (not `u32`) and range-check against that; annotate-to-narrow still checks (`let x: u8 = 300` errors). Test: `let x = 5000000000` compiles; `let y: u32 = 5000000000` errors.
- **f. Silent first-picks + fabricated keys** — three sites: `expression-resolver.ts:864` (`matchedItems[0]` → report `ambiguousName` when `length > 1`); `src/layout/platform-abi.ts:192-205` (`findPlatformFunctionInstance` asserts `matches.length === 1`, else new `LAYOUT_PLATFORM_FUNCTION_INSTANCE_AMBIGUOUS`); `src/layout/aggregate-layout.ts:101` (return `undefined` instead of fabricating `monoInstanceId(\`source:${typeId}\`)`— the caller already diagnoses`undefined`). Plus: remove the two `as any`in`src/semantic/names/{expression-resolver,type-reference-resolver}.ts` (REV-D; type the candidate records properly) and un-grandfather them in the W0-03 audit. Tests per site.
- **AC (cluster):** all six landed; corpus updated; audit tightened.

### W1-17 — Mono/proof-check small invariants (from REV-A Part II)

- **Size:** S. **Depends:** none.
- **Files:** `src/mono/reachability.ts:180-184,239-243`; `src/proof-check/kernel/graph-worklist-join-coordinator.ts:299-305`; `src/proof-mir/lower/iterator-lowerer.ts:608`.
- **Change:** (a) introduce a third mono work state `"failed"` (set on shell/body instantiation error instead of `"completed"`) and make `functionTableLookup` consumers treat `failed` as a hard stop with the already-pushed diagnostics; (b) `JoinPredecessorCandidate.unreachable` is hardcoded `false` at the only recording site — delete the field and its check (or wire real exit-pruned unreachability if `graph-worklist-session` has it; read first, prefer deletion); (c) replace the fabricated `proofMirOriginId(1)` in the stream-loop rejection with the statement's real origin (`input.monoStatement.sourceOrigin` is in scope).
- **AC:** suite green; grep confirms `unreachable: false` literal gone.

---

# WAVE 2 — Fail-closed phase boundaries

### W2-01 — Central proof-MIR per-statement reference collector + validation

- **Size:** L. **Depends:** W1-05, W1-06.
- **Files:** new `src/proof-mir/validation/reference-collector.ts`; edit `graph-validator.ts`, `operand-validator.ts:46`, `layout-validator.ts:185`; tests per statement kind.
- **Current state (verified via REV-C, structure confirmed):** operand validation covers `call`/`attempt`/`take`; the scalar-use collector (`graph-validator.ts:679`) ignores most place-bearing statements and misclassifies `readValidatedBufferField.result` as a use though it is a definition.
- **Change:** write one exhaustive `collectStatementReferences(statement): { reads: Ref[]; writes: Ref[]; facts: Key[]; loans: Key[]; sessions: Key[]; layoutTerms: Key[] }` switching on **every** `ProofMirStatement` kind with a `const unreachable: never` arm (compile-time exhaustive, like the kernel dispatch). Rebuild the SSA/use validation and layout-reference validation on top of it; validate every referenced id against the function/program tables with per-category diagnostics (`PROOF_MIR_DANGLING_REFERENCE:<category>` in `stableDetail`). Fix the `readValidatedBufferField.result` def/use classification in the process.
- **Tests:** for each statement kind, a malformed instance with one dangling reference → exactly one diagnostic (table-driven test file; enumerate kinds from `HIR_STATEMENT_KINDS`-style export or the statement union). Positive: full fixture corpus revalidates clean.
- **AC:** suite + `validate:full-image` green; adding a statement kind without extending the collector is a TS compile error.

### W2-02 — Aggregate leftovers: verifier gate now, real lowering in W3-04

- **Size:** S. **Depends:** none.
- **Files:** `src/opt-ir/verify/` (final-verification step), `src/opt-ir/diagnostics.ts`.
- **Current state (verified):** `lower-checked-mir.ts` emits `aggregateExtract`/`aggregateConstruct` (`:554,667`); the AArch64 operation matrix marks aggregate construct/extract/insert unsupported (`operation-matrix.ts:58-61`) and materialization fails closed with a backend-op-kind message (REV-C High #6).
- **Change:** in the opt-ir `final-verification` pass (dispatched at `pipeline-dispatch.ts:134`), after existing checks, scan remaining operations for aggregate kinds; report `OPT_IR_UNLOWERED_AGGREGATE` carrying the **origin id** (operations carry `originId`) so the diagnostic maps to source ("object construction/field projection is not yet lowerable for this target"). This converts an opaque backend failure into a source-adjacent one until W3-04 deletes the gate.
- **Tests:** feed an opt-ir program containing an `aggregateConstruct` through the final-verification step → the new diagnostic; packet-counter fixtures (which currently pass, hence contain no leftovers) stay green.
- **AC:** suite green.

### W2-03 — Linker verifier parity with the PE writer; promote the slow validator

- **Size:** M. **Depends:** none.
- **Files:** `src/linker/verifier.ts:141,165`, `tests/support/linker/slow-linked-image-validator.ts:85` (source of the logic), `src/pe-coff/pe-file-layout.ts:210` (reference semantics).
- **Current state (verified via REV-C):** the linker verifier only rejects a first section below the policy RVA, while the PE writer requires exact `firstSectionRva` and exact virtual-order contiguity — violations surface a phase late. The test-only slow validator independently recomputes contribution offsets/section sizes and catches corruption the production verifier misses.
- **Change:** (1) add exact first-RVA equality and section-contiguity checks to `verifyLinkedImageLayout` with `LINKER_LAYOUT_*` codes mirroring the writer's semantics; (2) extract the slow validator's recomputation into `src/linker/contribution-recompute.ts` and call it from the production verifier (keep the test importing the same module — single source of truth).
- **Tests:** move/keep `linked-image-verifier.test.ts:332` corruption case, now asserting the **production** verifier catches it; writer-level checks retained as defense-in-depth (both fire on a doctored layout).
- **AC:** suite + `validate:full-image` green.

### W2-04 — Object-verifier reloc pair reciprocity; frame-size early validation

- **Size:** M. **Depends:** none.
- **Files:** `src/target/aarch64/backend/verify/object-verifier-contract.ts:109`; `src/target/aarch64/backend/frame/frame-layout.ts:71-89`; `src/target/aarch64/backend/api/frame-instructions.ts:98`.
- **Current state (verified via REV-C):** object verification checks pair-key presence/partner/family but not reciprocity or same-resolved-target (linker application does, later, at `relocation-application.ts:117,488`); frame layout never validates final `totalSizeBytes` against the `sub sp, #imm` encodable range (imm12 `0..0xfff`, optionally LSL 12 — encoder accepts only `0..0xfff` per `encoding-integer-branch.ts:156`), so >4080-byte frames die at encode with an opaque error.
- **Change:** (1) add reciprocal-pair-key + same-target checks to the object verifier (codes mirroring the linker's), keeping linker checks; (2) in frame layout, if `totalSizeBytes > 0xff0`, either emit the multi-instruction adjust (preferred: `sub sp, sp, #imm12` + `sub sp, sp, #imm12, lsl 12` decomposition — implement in `frame-instructions.ts` with a helper `stackAdjustInstructions(totalSizeBytes)` returning 1–2 instructions and reject > 16MB with `AARCH64_FRAME_TOO_LARGE`), and add the frame-layout-time validation producing that code instead of the encode-time failure.
- **Tests:** object module with a one-way pair key → object verifier error; frame of 5000 bytes → prologue contains two `sub sp` instructions and encodes; frame of 20MB → `AARCH64_FRAME_TOO_LARGE` at frame layout.
- **AC:** suite green.

### W2-05 — Opcode↔encoder coverage assertion

- **Size:** S. **Depends:** none.
- **Files:** new `tests/audit/aarch64-encoding-coverage-audit.test.ts`; read `src/target/aarch64/machine-ir/opcode-catalog.ts`, `src/target/aarch64/backend/object/encoding*.ts`.
- **Change:** enumerate every opcode in the opcode catalog; for each, attempt `encodeAArch64PhysicalInstructionForTarget` with a canonical operand shape per form (build a small form→sample-operands table; forms are in `aarch64OpcodeFormById`) and assert the result is not `unsupported-opcode`. Grandfather any legitimately unencodable pseudo-opcodes in an explicit `PSEUDO_OPCODES` list with a comment (pseudos expand pre-encode — confirm against `pseudo-expansion.ts`).
- **AC:** audit green; removing an encoder branch turns it red.

### W2-06 — Package-pipeline diagnostic envelope (stop flattening to counts)

- **Size:** M. **Depends:** none.
- **Files:** `src/target/uefi-aarch64/package-pipeline.ts:425-470` (all `packageStageDiagnostic` call sites that summarize), `src/target/uefi-aarch64/diagnostics.ts`, `src/target/uefi-aarch64/binary-spine.ts:499-515`, `src/validation/full-image/runner.ts` (consumer), `scripts/validate-full-image.ts` (printer).
- **Current state (verified):** frontend/parse diagnostics are flattened to `frontend-diagnostics:<count>` (`package-pipeline.ts:445`); spans and codes are lost at the driver seam (REV-D).
- **Change:** extend `UefiAArch64TargetDiagnostic` with an optional `source?: { originalCode: string; message: string; file: string; start: number; end: number }` payload; at each stage-failure seam, map every underlying diagnostic (they all carry code+span+source already) into one enveloped target diagnostic each, preserving the stage `stableDetail` prefix for stable sorting (`stableDetail: \`${stageKey}:${originalCode}:${ordinal}\``). Update the full-image runner/report to print `file:line:col code message`when`source`is present (compute line/col from`SourceText`— it has offset→position; if not, add a helper in`src/shared/source-text.ts`).
- **Tests:** compile a fixture with one intentional parse error via `compileUefiAArch64ImageWithTrace` → the returned diagnostics include the parse code and correct offsets; validate-full-image human report prints the location line.
- **AC:** suite green; `frontend-diagnostics:` literal no longer produced.

### W2-07 — Type the platform-primitive parity seam and diff it

- **Size:** S. **Depends:** none.
- **Files:** `src/target/uefi-aarch64/package-pipeline.ts:297` (`reachablePlatformPrimitiveIds: readonly unknown[]`), `src/target/uefi-aarch64/binary-spine.ts` (runtime-helper materialization), `src/opt-ir/program.ts` weak spots (`readonly unknown[]` call-graph calls, `CheckedFunctionSummary | unknown` — REV-C).
- **Change:** type the ids as `readonly PlatformPrimitiveId[]` end to end; in the binary spine, after runtime-helper object materialization, assert set-equality between reachable primitive ids and the primitives the helper objects cover — mismatch → `UEFI_AARCH64_PRIMITIVE_COVERAGE_MISMATCH` listing the symmetric difference. Replace the two `unknown` contracts in `opt-ir/program.ts` with their real types (trace producers; the call-graph entries and summaries have concrete shapes at construction sites).
- **Tests:** doctor a helper-object list to drop one primitive → the new diagnostic; typecheck is the main gate for the `unknown` removals.
- **AC:** `bun run typecheck` green with no new casts; suite green.

### W2-08 — Proof-MIR origins: tagged union instead of 24 `as never` casts; counted synthetic HIR ids

- **Size:** M. **Depends:** none.
- **Files:** `src/proof-mir/lower/lowering-origins.ts:11` + the 23 other `as never` sites (grep `as never` under `src/proof-mir/lower` — verified count 24), `src/proof-mir/lower/iterator-lowerer.ts:566,583` (magic `hirExpressionId(101)`/`(102)`).
- **Change:** model origin sources as a tagged union `{ kind: "statement" | "expression" | "parameter" | "functionShell"; … }` and make the origin-map builders dispatch on the tag; delete every `as never`. Replace literal synthesized HIR ids with a per-function-lowering counter allocated from the lowering context (`nextSyntheticHirExpressionId()` seeded above the real id range — find the max real id in the instantiated body index and start after it).
- **Tests:** property test: every lowered proof-mir node's origin resolves to a source span (walk a lowered fixture function; assert `origin-map` lookups all succeed); W0-03 scar-tissue audit extended: `as never` count in `src/proof-mir/lower` == 0.
- **AC:** suite + audit green.

### W2-09 — Opt-ir fact-consumption certification in the fact verifier

- **Size:** M. **Depends:** none.
- **Files:** `src/opt-ir/verify/fact-verifier.ts`, `src/opt-ir/egraph/rule-catalog.ts`, `src/opt-ir/rewrites/catalog-rewrite-builders.ts`, `src/opt-ir/passes/wrela-optimizations/*`.
- **Current state (REV-D High #6):** rewrite rules and wrela passes consult fact ids; nothing asserts every consulted fact id exists in the certified input fact packet (vs. assumed by an upstream pass).
- **Change:** make every rewrite rule and wrela-pass candidate discovery declare `consumedFactFamilies: readonly string[]` in its record (most already carry facts on the decision log — normalize); extend the fact verifier to check, for each applied rewrite in the decision log, that each consumed fact id is present in the certified `state.facts` index (by family + subject), reporting `OPT_IR_UNCERTIFIED_FACT_CONSUMPTION`. Run inside the existing post-cluster `verifyPipelineState` for the wrela/e-graph checkpoints.
- **Tests:** register a fake rewrite consuming a nonexistent fact id → verifier error; existing e-graph tests green.
- **AC:** suite green.

### W2-10 — Cheap CFG insurance: reducibility + critical-edge assertions

- **Size:** S. **Depends:** W1-06.
- **Files:** `src/proof-mir/validation/graph-validator.ts`.
- **Change:** using the derived predecessor map from W1-06, (a) assert reducibility (standard T1/T2 interval collapse or DFS back-edge test: every retreating edge targets a block that dominates its source — dominators are computable from the derived CFG); report `PROOF_MIR_IRREDUCIBLE_CFG` (should be impossible from structured lowering — this is a tripwire, per the REV-B ruling); (b) count critical edges (multi-succ → multi-pred) and record them in the validator's summary (no diagnostic — data for the W4 optimizer work which may need splitting).
- **Tests:** hand-built irreducible graph → diagnostic; every fixture-derived graph → none.
- **AC:** suite green.

### W2-11 — Policy checker: TS-AST import parsing

- **Size:** S. **Depends:** none.
- **Files:** `scripts/check-policy.ts:257` (regex import parsing).
- **Change:** replace the regex with `typescript`'s own parser (already a devDependency): `ts.createSourceFile` per file, walk `ImportDeclaration`/`ExportDeclaration` module specifiers. Emit `file:line:col` in violations (node positions are available).
- **AC:** `bun run policy:check` output identical on the current tree (byte-diff the report before/after on HEAD); a fixture violation reports exact line/col.

### W2-12 — Consolidate `deterministic-sort.ts` copies

- **Size:** S. **Depends:** none.
- **Files:** the 6 copies (verified): `src/shared/deterministic-sort.ts` (canonical) + duplicates under `src/mono`, `src/layout`, and others (`find src -name deterministic-sort.ts`).
- **Change:** diff each against `src/shared/`; byte-identical or subset copies become re-exports (`export * from "../shared/deterministic-sort"`) or direct imports (respect `scripts/check-policy.ts` layering — if a layer may not import `shared`, keep the file as a one-line re-export with a comment); genuinely bespoke comparators stay with a header comment naming what differs. Add a W0-03 audit rule: any file named `deterministic-sort.ts` outside `src/shared` must be ≤ 3 lines or carry the `BESPOKE:` header.
- **AC:** suite + policy check green.

### W2-13 — PE/COFF: UEFI conformance test, checksum, honest unwind, reproducibility

- **Size:** M. **Depends:** none.
- **Files:** new `tests/integration/pe-coff/pe-coff-uefi-spec-conformance.test.ts`; `src/pe-coff/pe-file-layout.ts:796` (checksum 0); `src/target/uefi-aarch64/entry-thunk.ts:409-416` (fabricated `.pdata`/`.xdata`) and `:483-509` (hardcoded reloc offsets).
- **Current state (verified):** `imageBase` defaults `0n`, `dllCharacteristics` defaults `0` (`aarch64-pe-coff-target.ts:126,146`) — REV-D's requirements already hold and REV-B's ASLR advice is rejected (see rulings). Checksum is hardcoded 0. Thunk xdata embeds a hash byte; pdata second word is `1+index`. Thunk relocation _plan_ offsets (20/36/48) are hardcoded separately from the factory's byte-walk.
- **Change:**
  1. Conformance test asserting on the produced artifact bytes (parse with `parsePeCoffImage`): Machine `0xAA64`, Subsystem 10, `ImageBase == 0`, `SectionAlignment >= 0x1000`, `FileAlignment == 0x200`, `SizeOfHeaders % FileAlignment == 0`, BaseReloc directory present when relocations exist, `DYNAMIC_BASE` **not** set. Add one explicit decision line: `NX_COMPAT` (0x0100) — set it (2023+ UEFI CA signing requires it) and assert set; if boot smoke regresses on QEMU/AAVMF, revert to a documented decision.
  2. Implement the standard PE checksum algorithm in the writer (sum of 16-bit words with carry, over the file with the checksum field zeroed, plus file length); verify on the round-trip parse.
  3. Entry thunk: replace `entryThunkXdataBytes`/`entryThunkPdataBytes` with either (a) correct minimal ARM64 unwind codes for the known 48-byte frame-record prologue (preferred; the prologue is fixed: `sub sp,48; stp x29,x30,[sp,32]; add x29,sp,32` → encode the matching epilog-mirrored unwind codes per the PE ARM64 exception-data spec) or (b) omission of the records. Derive the relocation plan's offsets from the encoded instruction walk (single source of truth — export the byte-walk offsets from `encodeThunkInstructions` and build the plan from them).
  4. Reproducibility: build the same fixture twice in one test; assert byte-identical `.efi` and identical `finalImageFingerprint`.
- **AC:** conformance + reproducibility tests green; `validate:full-image` green; QEMU smoke still boots when `bun run verify:qemu` is run on a machine with QEMU/AAVMF configured.

### W2-14 — Security-slot wipes on every exit path; ExitBootServices retry shape

- **Size:** M. **Depends:** none.
- **Files:** `src/target/aarch64/backend/api/function-pipeline.ts` (`securityWipesForFrame`, `observableExitsForFunction`), `src/target/aarch64/backend/api/frame-instructions.ts` (trap prelude), new audit test; `src/target/uefi-aarch64/exit-boot-services.ts` + `runtime-helper-instructions.ts` (retry shape audit).
- **Current state (REV-B §6.3 / REV-D #30 — plausible, unverified):** wipe-on-spill slots are wiped via `wipeSlots` at exits; whether synthetic trap/panic exits are covered is unproven.
- **Change:** (1) write the audit first: for a function with a `wipe-on-spill` fact and both a return exit and a trap exit, assert the emitted instruction stream zeroes the slot on **both** paths (`trapPreludeInstructions` must include the wipe). If it fails, extend `frameFinalizationInstructionsForAArch64Function` to emit wipes in the trap prelude. (2) ExitBootServices: add an integration test asserting the emitted runtime-helper instruction sequence for exit-boot-services follows `GetMemoryMap → ExitBootServices → on EFI_INVALID_PARAMETER retry once with fresh map` (read `runtime-helper-instructions.ts` for the actual current shape; if the retry is absent, implement it there following the file's existing instruction-record pattern, and update the golden references in validation).
- **AC:** both audits green (with fixes if red); TCB golden-reference checkers updated deliberately (call out in PR).

### W2-15 — QEMU smoke: one-shot in-compile execution + gated system test

- **Size:** M. **Depends:** W0-01.
- **Files:** `src/target/uefi-aarch64/compile-uefi-aarch64-image.ts:215-233`, `src/target/uefi-aarch64/qemu-smoke.ts` / `qemu-smoke-host.ts`, new `tests/system/uefi-aarch64/qemu-boot.test.ts`, `scripts/smoke-uefi-aarch64.ts` (simplify to the new path).
- **Current state (verified):** any non-disabled smoke request returns `status: "skipped", stableDetail: "qemu-smoke:separate-runner-required"`; the real runner exists and spawns qemu but only via the standalone script. `tests/system/` has 2 files, effectively one frontend test.
- **Change:** extend `CompileUefiAArch64ImageInput.smoke` to accept `{ kind: "run", hostEffects: UefiAArch64SmokeHostEffects }`; when provided, invoke the existing smoke runner inline after artifact creation and return the real report (markers observed, status passed/failed). Add the system test: skip with reason when `process.env.QEMU_SYSTEM_AARCH64` (or `command -v`) is absent; otherwise compile the packet-counter fixture and assert the `WRELA_UEFI_SMOKE_OK` marker (grep the actual marker string from `stdlib` `write_smoke_marker` / fixture — verified `WRELA_UEFI_SMOKE_OK\r\n` in `console.wr`).
- **AC:** with QEMU installed locally: `bun test tests/system/uefi-aarch64` boots and passes; without: reports skipped with the reason string; W6-05 wires the same path into `bun run verify:qemu`.

---

# WAVE 3 — Language completeness

### W3-01 — Proof-check resource limits: production policy

- **Size:** M. **Depends:** none.
- **Files:** `src/proof-check/kernel/resource-limits.ts:49-63`, `src/proof-check/input-contract.ts:28-76`, `src/proof-check/proof-check-phases.ts:189`, `src/target/uefi-aarch64/package-pipeline.ts` (the `checkProofAndResources` call site — pass explicit limits).
- **Current state (verified):** the only limits constructor is `proofCheckResourceLimitsForTest()` (256 reachable functions, 512 blocks/fn, 1024 edges/fn, 64 state variants/block, 512 facts/state, 128 loans, 128 obligations, 64 validations, 64 attempts, 128 capabilities, 64 counterexample frames, 512 staged packets). **First step of this task: trace what the production pipeline actually passes** (follow `checkProofAndResourcesInput` construction in `package-pipeline.ts`; if limits are optional-and-defaulted, find the default).
- **Change:** add `proofCheckResourceLimitsForImageProfile(profile)` with production values sized for real drivers (reachable functions 16384, blocks/fn 8192, edges 16384, variants/block 64 — variants are a soundness cap, keep tight —, facts/state 8192, loans 1024, obligations 1024, others ×16 current), sourced from the image profile so targets can tune. Keep the ForTest constructor for tests. Every limit breach remains a hard, deterministic error (fail-closed is correct); the fix is honest sizing plus a diagnostic message that names the limit, the observed value, and the per-image override knob.
- **Tests:** synthetic program crossing the old 256-function cap compiles under production limits; breach message names limit+observed+knob; determinism: same program, same diagnostics.
- **AC:** suite + `validate:full-image` green.

### W3-02 — Implement stream `for`-loop lowering (parent context; assign W3-02a..d)

- **Parent workstream. Assignable tasks:** W3-02a, W3-02b, W3-02c, W3-02d. **Depends:** W1-05, W1-06, W2-01, W3-01.
- **Files:** `src/proof-mir/lower/iterator-lowerer.ts:594-660` (the `"stream"` arm), `src/proof-mir/extensions/extension-gates.ts` (gate stays), `src/target/uefi-aarch64/runtime-catalog.ts:139` (`features: []` → add `"streamLoop"` **last**, after lowering exists), proof-check `domains/loops.ts`/`take`-related domains (obligation discharge), Lean note (W8-03 coverage row), fixtures.
- **Current state (verified):** the `stream` arm returns `PROOF_MIR_UNSUPPORTED_EXTENSION_RECORD` unconditionally — even a target enabling the feature would still fail; grammar/HIR/mono support exists end to end (`take`-based iteration works; `classifyForIteration` in `hir/take-lowerer.ts` distinguishes the shapes). The flagship `happy.md` program iterates a stream, so the language's showcase cannot compile (REV-D Critical #1).
- **Catalog split:**
  1. **CFG shape:** build the loop skeleton in the draft graph — header block with a `next`-call statement targeting the stream's certified producer contract (the `nextCall` scaffolding at `iterator-lowerer.ts:560-591` already synthesizes callee metadata — make it real by resolving the actual `next` function instance from the take-mode surface instead of `instantiatedHirIdKey(functionInstanceId, hirExpressionId(101))` placeholders), a two-way branch on the terminus discriminant (use W1-05's site-keyed `createBranchEdge`), body block binding the item local with the item's resource kind from the `CheckedTakeModeSurface`, back-edge, and exit block that discharges the stream obligation (`finishRuntimeCallId` scaffolding exists at `:589`).
  2. **Proof obligations:** open the per-item obligation on body entry, require discharge before back-edge (mirror how `take` blocks do it — `take-lowerer` + `domains/loops.ts` loop-header judgment), and discharge the stream itself at the exit edge.
  3. **Feature enable + fixtures:** add `"streamLoop"` to the UEFI runtime-catalog features; add `tests/fixtures/full-image-validation/packet-counter-real-stream/` (REV-D §15.4) exercising a genuine `for buffer in batch:` over the certified stream producer, in all applicable stdlib modes; corpus fixture for the _disabled-feature_ diagnostic on a target without the feature.
  4. **Docs:** update `happy.md` status and the bringup plan doc (`docs/implementation/2026-07-03-source-level-uefi-bringup-plan.md` — REV-D flagged it stale; reconcile its open-issue note about `validation.ts:539` while there).
- **AC:** real-stream fixture compiles, validates, and boots with the smoke marker under `bun run verify:qemu` when QEMU is configured; disabled-target diagnostic corpus case green; proof-check rejects a fixture that drops an item without discharge (negative test).

### W3-03 — `yield`/coroutines: reject at the frontend now; implementation deferred behind the same gate

- **Size:** S (rejection). **Depends:** W0-02.
- **Files:** `src/hir/statement-lowerer.ts`, `src/hir/diagnostics.ts`, `tests/fixtures/diagnostics/yield-on-uefi/input.wr`, `tests/fixtures/diagnostics/yield-on-uefi/expected.json`.
- **Current state (verified):** `yield` parses, HIR-lowers, mono-clones, then dies at proof-mir (`function-lowerer.ts:353`) / opt-ir (`lower-checked-mir.ts:1025` returns unsupported+unreachable) because no target declares `coroutineYield` (`runtime-catalog.ts:139`).
- **Change:** when lowering a `yield` statement in HIR for a program whose selected target lacks the `coroutineYield` feature (thread target features into the HIR lowering context — they are available in the semantic target surface), report `HIR_FEATURE_NOT_AVAILABLE_ON_TARGET` naming the construct and target, at the statement span, instead of proceeding. Same check for the opt-ir switch: after this, `lower-checked-mir.ts:1025`'s yield arm becomes unreachable-by-construction — replace its diagnostic with an internal invariant error. Full coroutine implementation is explicitly **out of plan** (tracked as a language RFC; the gate machinery is ready when it lands).
- **Tests:** corpus `yield-on-uefi` → the new code with `spanText: "yield"`; existing proof-mir yield-validation unit tests keep passing (they construct gated graphs directly).
- **AC:** corpus green.

### W3-04 — Real aggregate lowering (objects through the backend)

- **Size:** L. **Depends:** W2-02 (gate exists), layout facts (already produced).
- **Files:** new `src/opt-ir/passes/aggregate-lowering.ts` + schedule entry in `pass-order-policy.ts` (between `memory-region-optimization` and `wrela-fact-rounds`), `pipeline-dispatch.ts` case; layout fact consumption via the existing `opt-ir/layout-fact-keys.ts`.
- **Current state:** `aggregateConstruct`/`aggregateExtract`/`aggregateInsert` ops flow to a backend that rejects them; only programs whose aggregates are fully scalarized upstream compile (REV-C High #6).
- **Change:** implement a lowering pass converting aggregate ops into stack-region + field-offset memory ops using the layout facts already threaded into opt-ir (field offsets/sizes per `LayoutFieldFact`): `aggregateConstruct` → region alloc (the region model exists — `optimizationRegionsForProgram`) + per-field stores; `aggregateExtract` → offset load; `aggregateInsert` → offset store. Registers the pass contract per the schedule conventions (requires `memory-region-optimized`, produces `aggregates-lowered`; add the fact to the precondition chain of `wrela-fact-rounds`). Update the W2-02 verifier gate to require zero aggregate ops **after** this pass (move the check later in the schedule), keeping it as the tripwire.
- **Tests:** a `.wr` fixture whose function constructs a 3-field object, mutates one field, and reads another, compiled end-to-end (`validate-full-image` case) — currently blocked, must pass after; unit tests per op kind against hand-built opt-ir; interpreter differential (W4-01, if landed) over the new pass.
- **AC:** new fixture green end to end; `validate:full-image` green.

### W3-05 — Switch-without-fallback: enforce upstream, make opt-ir unreachable-by-construction

- **Size:** S. **Depends:** none.
- **Files:** `src/opt-ir/lower/lower-checked-mir.ts:975`, the proof-mir switch-exhaustiveness validation (`PROOF_MIR_MISSING_SWITCH_EXHAUSTIVENESS` exists in the registry — find its producer).
- **Change:** confirm proof-mir validation rejects non-exhaustive switches without fallback (if the code exists but isn't enforced for all switch sources, enforce it); then convert the opt-ir `unsupported-switch` arm into an internal invariant failure with a message pointing at the upstream guarantee.
- **Tests:** proof-mir validator negative test (non-exhaustive switch → diagnostic); opt-ir arm covered by an invariant-throw unit test.
- **AC:** suite green.

### W3-06 — Generic image entries: semantic rejection replaces error-shaped roots

- **Size:** S. **Depends:** none.
- **Files:** `src/hir/mono-closure-lowerer.ts:174-196`, `src/semantic/surface/image-entry-checker.ts` (the right home for the diagnostic), corpus.
- **Current state (verified):** generic image-entry type parameters are synthesized as `errorCheckedType()` placeholders (`:178`), per design note that generic entries require concrete external roots (REV-C).
- **Change:** in `checkImageEntry`, if the selected entry function has type parameters (and no concrete external entry root is supplied), report `SEMANTIC_IMAGE_ENTRY_GENERIC` at the entry's span; delete the placeholder synthesis in `mono-closure-lowerer.ts` (make it an invariant error). Update `tests/integration/hir/lower-typed-hir-orchestration.test.ts:914` (currently asserts the placeholder) to assert the diagnostic.
- **AC:** corpus + suite green.

### W3-07 — Recursion ban: specify, surface early, message honestly

- **Size:** S. **Depends:** none.
- **Files:** `docs/language/happy.md`, `src/semantic/surface/mono-closure-builder.ts`, `src/semantic/surface/semantic-surface-checker.ts`, `src/semantic/surface/diagnostics.ts`, `src/mono/diagnostics.ts`, `tests/fixtures/diagnostics/recursive-function-cycle/input.wr`, `tests/fixtures/diagnostics/recursive-function-cycle/expected.json`, `tests/fixtures/diagnostics/recursive-type-cycle/input.wr`, `tests/fixtures/diagnostics/recursive-type-cycle/expected.json`.
- **Current state (verified):** all recursion (direct, mutual, type-level) is rejected — but only at monomorphization, with messages that read like compiler limitations (REV-A M-1). REV-B/REV-D propose `@recursive(max_depth)` bounded recursion — **ruling: out of scope for this plan** (it is a language-design RFC with proof-model implications); the plan makes the existing rule explicit and early.
- **Change:** (1) spec section in happy.md: "wrela functions and by-value types are non-recursive; iteration uses loops and streams" with rationale; (2) rewrite the three diagnostic messages to state the _language rule_ ("wrela does not allow recursive functions; restructure as a loop") and include the cycle path (the canonical keys are known — join the active-key chain into `stableDetail`); (3) add a cheap semantic-surface call-graph SCC check over resolved references (name resolution already records call references) reporting the same rule at the _source_ span of the first cycle edge — mono keeps its check as the backstop.
- **Tests:** corpus `direct-recursion`/`mutual-recursion` → semantic-level diagnostic with cycle names; mono backstop test unchanged.
- **AC:** corpus green.

### W3-08 — Language ops decision batch: booleans, logical/bitwise operators, signed integers

- **Size:** L (spec M + implementation M). **Depends:** W1-04 (lexer shape), W0-02.
- **Files:** `docs/language/happy.md`; `keyword-table.ts`, `token-kind.ts`, `syntax-kind.ts`+map, `expression-parser.ts` (binding powers), HIR `lowerBinaryLike`/`lowerName`, proof-mir `expression-lowerer.ts` (requirement terms), opt-ir scalar ops + backend selection for the new ops.
- **Current state (verified):** no `and/or` (only `not`), no bitwise `& | ^ << >> ~`, `true`/`false` are magic identifier strings, unsigned-only integers.
- **Change (rulings, to be confirmed in the spec PR before implementation starts):**
  1. **Booleans:** `true`/`false` become keywords lexed as literal tokens; delete both special-case string checks (`expression-resolver.ts:521`, `expression-lowerer.ts:258`).
  2. **Logical:** keywords `and`/`or` as short-circuiting binary operators (binding powers 30/25, below comparisons); HIR lowers to the existing `if`-shaped short-circuit (or a dedicated logical kind if proof-mir prefers explicit CFG — implement via CFG like other compilers: `a and b` ⇒ branch). Proof-fact refinement for `and` in `require`/conditions comes free from the existing branch-fact machinery.
  3. **Bitwise:** operator tokens `& | ^ << >> ~` with C-like precedence (shifts 55 — above `+`; `&` 45, `^` 44, `|` 43 — between comparisons and `and`... **no**: use Rust-style precedence to avoid the C trap: shifts 55, `&` 52, `^` 51, `|` 50, all _above_ comparisons; document explicitly). Same-width unsigned semantics; shift amounts masked to width (document). opt-ir scalar ops likely exist for masks (check `operations.ts` for `bitAnd`-family; add any missing with schema + interpreter + verifier entries); backend selection: AND/ORR/EOR/LSL/LSR immediate+register forms (encoders for logical-immediate bitmasks are the hard part — implement the AArch64 bitmask-immediate encodability check and fall back to register form via constant materialization when not encodable).
  4. **Signed integers:** **deferred by ruling** — a spec-level RFC note in happy.md, not implemented in this plan (target domain is UINTN-centric; the proof-arithmetic domains assume unsigned/overflow-checked semantics and widening them is a proof-model change).
- **Tests:** parser precedence table tests (golden trees for `a & b == c` etc. proving the documented precedence); HIR/opt-ir/backend unit tests per op; end-to-end fixture computing a masked MMIO-style value; corpus for `let true = 1` now a parse error.
- **AC:** all suites + `validate:full-image` green; W4-01 differential (if landed) covers the new ops.

### W3-09 — stdlib buildout, phase 1

- **Size:** L. **Depends:** W1-02 (no `pub`), W1-10 (module-identity contracts), W3-08 (bit ops for utilities).
- **Files:** `stdlib/wrela-std/core/{option.wr,result.wr,bits.wr}`, `stdlib/wrela-std/target/uefi/*` expansion; fixture dedup.
- **Current state (verified):** 137 lines total; `Result[Ok, Err]` is an empty marker class; every full-image fixture carries a private parallel stdlib (`tests/fixtures/full-image-validation/*/toolchain-stdlib/src/packet_counter/uefi_status.wr` etc.). REV-D lists the happy.md-implied surface that does not exist (`Option`, `Attempt`, `Validation`, buffers, etc.).
- **Change (phase 1 scope — the compile-today subset):** author `Option[T]` and enrich `Result` usage patterns _to the extent the current language can express them_ (no methods-on-generics beyond what the checker supports — validate each addition against a fixture as you go); `bits.wr` utilities once W3-08 lands; declare the intrinsic buffer type _names_ (`ReadableBuffer`, `WritableBuffer` as target-typed declarations per REV-D §15.2 — check how `Utf16Static` is declared and follow that pattern). Establish `stdlib/COMPATIBILITY.md` (versioning policy: stdlib version pinned to compiler version until 1.0). Convert `tests/fixtures/full-image-validation/smoke-console/toolchain-stdlib/src/image.wr` to import from the real toolchain stdlib instead of its private copy, keeping `ejected` and `direct-platform` modes as-is.
- **Tests:** every new stdlib module gets a source-level conformance fixture compiled in `validate-full-image`; happy.md-alignment table in `COMPATIBILITY.md` listing declared-vs-missing surface honestly.
- **AC:** `validate:full-image` green including new conformance cases.

### W3-10 — Move the boot-result ABI mapping out of generic layout

- **Size:** S. **Depends:** none.
- **Files:** `src/layout/image-entry-abi.ts:310` (hardcoded `sourceName: "BootError"` + stdlib-identity assumptions), `src/target/uefi-aarch64/` image-profile surface.
- **Change:** the entry-result classification (which source types constitute the boot result and how they map to `EFI_STATUS`) becomes data on the target's image profile (`UefiAArch64EntryProfile` — it already carries the boot-function contract); layout consumes the profile's declaration instead of matching source type names. Follow W1-10's identity mechanism (module-pinned type ids).
- **Tests:** existing image-entry-abi tests re-pointed; a user type named `BootError` in a non-stdlib module does not classify.
- **AC:** suite green.

### W3-11 — Full-image matrix: complete or justify

- **Size:** S. **Depends:** none.
- **Files:** `src/validation/full-image/matrix.ts` (3 stdlib modes × 4 scenarios, 8 cases run — REV-C), `scripts/validate-full-image.ts:21` (single hardcoded target key → registry).
- **Change:** for each of the 4 missing combinations (`status-error`/`watchdog-or-boot-policy` × `ejected`/`direct-platform`): either add the fixture or add an `excluded: { case, reason }` entry the runner asserts and prints. Promote the target key to a `FULL_IMAGE_TARGETS` registry array (one entry today).
- **AC:** matrix covers 12 slots (run or documented-excluded); audit test asserts no silent omission.

---

# WAVE 4 — The optimizer earns its schedule

### W4-01 — Miscompile-confidence wave 1: interpreter differential on fixtures

- **Size:** L. **Depends:** W0-01. **Blocks:** W4-02..07, W5-04, W5-05.
- **Files:** `tests/unit/validation/miscompile-confidence/` (currently empty — verified), `src/opt-ir/interpreter.ts` (exists, 397 lines), `src/target/aarch64/interpreter/machine-ir-interpreter.ts` + `machine-ir-differential.ts` (exist); design: `docs/design/miscompile-confidence-design.md` (converged r24).
- **Change:** implement the design's Level-1/Level-2 lanes: for every full-image fixture, execute the unoptimized opt-ir program and the optimized opt-ir program on the opt-ir interpreter with the fixture's packet inputs and compare observations (the design defines the observation model; the artifact already carries `unoptimizedOperations` — verified in `package-pipeline-static-char16.ts` adapter); then optimized opt-ir vs machine-ir interpreter through the backend. Wire as `bun test` suites under the empty directory, and as a `validate-full-image` equivalence-evidence section (the runner already has an equivalence-evidence concept — extend it).
- **AC:** differentials green on all fixtures; deliberately perverting one pass (e.g., flip a GVN replacement in a scratch branch) is caught — include that as a self-test using a fault-injection hook, per the design.

### W4-02 — Real LICM

- **Size:** M. **Depends:** W4-01.
- **Files:** `src/opt-ir/passes/licm.ts` (rewrite), `pipeline-steps.ts:370-406` (feed real loop data), `src/opt-ir/analyses/` (loop tree — check for an existing loop-tree analysis; the schedule names `loop-tree` as an analysis id).
- **Current state (verified):** returns the program unchanged; harness feeds all ops as "loop ops"; no operand-invariance check.
- **Change:** per REV-B §5.2's (correct) blueprint: compute the natural-loop forest from the derived CFG (back-edges via dominators — dominance analysis exists), insert preheaders where absent (CFG edit + verifier), iterate invariance marking (all operands constant/defined-outside/invariant), hoist only ops that are runtime-pure **and** whose block dominates all loop exits (or are speculatively-safe pure ops), with the effect-boundary blocking the harness already models. Emit the rewrite records it already fabricates — now truthfully.
- **Tests:** unit: invariant pure op inside a `while` hoists to preheader; op using a loop-varying operand does not; effectful op does not; W4-01 differential green over fixtures with loops.
- **AC:** `runLicmStep` verifier-clean and program-changing on the loop fixture; suite green.

### W4-03 / W4-04 — Real scalar replacement (SROA); real stack promotion

- **Size:** M each. **Depends:** W4-01, W3-04 (aggregate lowering provides the memory shapes SROA consumes).
- **Files:** `scalar-replacement.ts:66`, `stack-promotion.ts:58`, their harnesses in `pipeline-steps.ts`.
- **Change:** SROA: for non-escaping regions (escape analysis exists) whose accesses are all statically-offset loads/stores of whole fields, replace per-field slots with SSA values (use the existing `applyOptIrOperationRewrites` machinery from vector materialization as the rewrite backbone). Stack promotion: promote heap-modeled regions with `activation` lifetime + non-escaping to stack regions (the classification inputs are already computed in the harness — make the result rewrite the program). Both must emit their existing rewrite-record vocabulary truthfully.
- **AC:** unit tests per shape; the packet-counter fixture's opt-ir shrinks (assert operation-count reduction as a golden with tolerance); differential green.

### W4-05 — Multi-block inlining

- **Size:** L. **Depends:** W4-01, W1-08.
- **Files:** `src/opt-ir/passes/whole-program-inlining.ts` (lift `blocks.length !== 1` at `:258` and `operationIsInlineSafe` restrictions), `expansion-budget.ts` (keep).
- **Change:** implement CFG splice: clone callee blocks/edges with id remapping (fresh block/op/value ids from the allocator), rewrite the call block into pre-call block → callee entry, callee return terminators → jumps to a new merge block whose parameters receive return values, preserve edge metadata, allow callee-internal source calls (they become normal call sites in the caller). Keep denies: recursion SCCs (mono bans recursion anyway — the SCC check becomes an invariant), external roots, escaped callables, budget. Run the structural verifier after every splice (already automatic at cluster boundaries; also verify per-inline in tests).
- **Tests:** callee with `if` inlines; callee containing a platform call inlines with the call intact; budget denial still logged; differential green across fixtures; decision-log golden updated.
- **AC:** packet-counter opt-ir shows cross-function folding (golden op-count drop); suite + differential + `validate:full-image` green.

### W4-06 — Ownership-derived alias analysis feeding memory optimization

- **Size:** L. **Depends:** W4-01, W4-05.
- **Files:** `src/opt-ir/analyses/` (new `place-alias.ts`), `src/opt-ir/passes/memory-optimization.ts` (consume), `src/opt-ir/lower/proof-mir-place-aliases.ts` (source of place identity — exists).
- **Change:** expose a `mayAlias(a, b)` oracle: distinct place roots (distinct locals/params/regions by construction of the affine ownership model) → no-alias; same root, disjoint static field paths → no-alias (field offsets from layout facts); everything else conservative. Widen load-forwarding/DSE from exact-range matching to oracle-checked disjointness.
- **Tests:** store to `a.x` then load `a.y` forwards nothing but DSE keeps both; store `a.x`, load `a.x` forwards across an intervening store to `b.x`; differential green.
- **AC:** measurable op-count reduction on an aggregate-heavy fixture (golden); suite green.

### W4-07 — Wrela move/copy elimination via proof authority

- **Size:** M. **Depends:** W4-06, W2-09.
- **Files:** `src/opt-ir/passes/wrela-optimizations/move-copy-wrapper-elision.ts` (extend beyond wrappers), rule catalog.
- **Change:** implement the design-doc goal REV-D #10 names: eliminate materialized copies whose source is provably dead-after (affine consumption facts) — a copy `b ← a` where `a` has no subsequent uses and ownership transferred becomes a rename (value substitution). Declare consumed fact families per W2-09.
- **AC:** unit tests + differential; decision log shows fact-cited eliminations.

### W4-08 — Resource-kind fixpoint via SCC worklist

- **Size:** M. **Depends:** none (independent perf).
- **Files:** `src/semantic/surface/semantic-surface-checker.ts:118-151`.
- **Change:** REV-B §3.1's direction (their blueprint's spirit, not its invented type names — the real types are `TypeId`/`CheckedResourceKind`/`joinResourceKinds` from `resource-kind.ts`): build the type-dependency graph from field entries, Tarjan SCCs, process SCCs in topological order with a per-SCC worklist keyed on actual kind changes; keep the fingerprint-equality convergence check as a debug assertion behind an env flag for one release.
- **Tests:** existing surface tests green; property test: random type DAGs (fast-check) — new algorithm's result equals the old fixpoint's (keep the old as `computeResourceKindsFixpointReference` in the test).
- **AC:** suite green; benchmark note in the PR (1000 synthetic types: before/after ms).

### W4-09 — Structured fact-transfer reasons

- **Size:** M. **Depends:** W2-09.
- **Files:** `src/shared/facts/fact-transfer.ts:16-29` (`reason?: string`), all rule constructors (`weaken`/`invalidate`/`reject` take reasons), producers in opt-ir/backend fact adapters.
- **Change:** replace free-text with `reason: { kind: FactTransferReasonKind; originPassId: OptimizationPassId | AArch64StageKey; subjectKey: string; note?: string }` where `FactTransferReasonKind` is a closed union (`"rewrite-preserves-range" | "subject-split" | "subject-dead" | "conservative-drop" | …` — enumerate from current string usages by grepping `invalidateFactTransferRule(`/`weakenFactTransferRule(` call sites). Keep stable-key derivation deterministic from the structured form.
- **AC:** typecheck forces every producer to declare structure; no free-text reasons remain (audit rule).

### W4-10 — Pipeline hygiene: convergence fuel, dispatch/schedule reconciliation, e-graph caps

- **Size:** M. **Depends:** none.
- **Files:** `pass-order-policy.ts`, `pipeline-dispatch.ts:42-71`, `pipeline-state.ts` (`stateChanged` exists), `egraph-materialization.ts`.
- **Change:** (1) fixpoints exit early on `stateChanged === false` instead of always burning fixed rounds (keep round caps as ceilings); (2) either implement distinct `construction-cleanup`/`post-mandatory-cleanup`/`final-cleanup` behaviors or collapse the declared schedule to the one cluster it actually runs, and give `constant-folding` its own dispatch or rename the pass id — declared vs executed must match (add an audit: every schedule passId has a distinct dispatch arm or a documented alias table); (3) e-graph: add e-class/e-node count ceilings alongside the 1200 worklist cap, with a deterministic `egraph:limit:<kind>` info diagnostic when hit (REV-B §5.1, REV-D bounds question).
- **AC:** schedule-consistency audit green; pipeline output unchanged on fixtures (golden decision logs updated only for early-exit rounds).

### W4-11 — Cost scorecard in local verification

- **Size:** S. **Depends:** W0-01.
- **Files:** new `scripts/cost-scorecard.ts`; extend `validate-full-image` JSON.
- **Change:** per fixture: machine-instruction count, image bytes, static cycle estimate (unit-latency to start), opt-ir op count pre/post. Emit JSON + a checked-in baseline (`tests/fixtures/full-image-validation/<case>/scorecard-baseline.json`). Add a local package script:

  ```json
  "verify:scorecard": "bun run scripts/cost-scorecard.ts --check"
  ```

  If the scorecard remains under a 2-second budget on the current fixture set, append it to `agent:check`; otherwise append it to `verify:extended`.

- **AC:** `bun run verify:scorecard` fails on >5% regression without a baseline update; intentionally disabling GVN in a scratch branch trips it.

---

# WAVE 5 — The backend earns its silicon

### W5-01 — Full callee-saved save/restore (retire the W1-01 pool restriction)

- **Size:** M. **Depends:** W1-01, W4-01.
- **Files:** `function-pipeline.ts` (derive used callee-saved from allocation), `frame/frame-layout.ts` + `frame-instructions.ts` (paired stp/ldp save area), `plan-unwind` inputs, the W1-01 verifier (now checks coverage instead of absence).
- **Change:** after allocation+repair, compute `usedCalleeSaved = sorted(unique(segments.physical ∩ publicCalleeSavedGprs ∪ simd equivalents))`; extend frame layout with a save area (16-byte pairs, x30 paired with x29 or a callee-saved partner); prologue/epilogue emit stp/ldp pairs; unwind records reflect them; then relax the W1-01 pool filter for public boundaries. Private closed-image conventions keep their declared `calleeSaveObligations`.
- **Tests:** REV-C's four: forced x19/x20 pressure in public fn → prologue/epilogue pairs present (assert at instruction level and via machine-ir interpreter differential with a caller that checks register preservation); leaf public fn; private convention; unwind consistency. W5-08 generator covers this continuously.
- **AC:** differential + suite + smoke green.

### W5-02 — Register allocator quality: eviction by spill weight, coalescing hints, split-reassign, per-use spill placement (parent context; assign W5-02a..d)

- **Parent workstream. Assignable tasks:** W5-02a, W5-02b, W5-02c, W5-02d. **Depends:** W5-01, W4-01.
- **Files:** `allocation/allocator.ts`, `allocation/liveness.ts` (real loop-depth/use counts — machine loop info from `plan/machine-dependency-graph.ts` or block-frequency estimate), `function-pipeline.ts` (interval construction), `spill-remat.ts` (per-use-site keys — currently `useSiteKey = liveRangeKey`).
- **Change:** (a) fill `spillCost/useDensity/loopDepth` with real values (uses × 10^loopDepth / length — REV-B's formula is fine) and implement evict-lowest-weight-active when no register is free (instead of immediate spill of the incoming interval); (b) soft `preferredRegister` hints from parallel-copy sources/dests and call-argument constraints, first-fit tries hint first — then delete satisfied copies in `function-copy-resolution.ts`; (c) after a call-boundary cut, re-enqueue post-cut segments unassigned (today they inherit the same register — `allocator.ts:117-138`); (d) spill drafts keyed per use site with reloads placed before uses (extend `AArch64AllocationRepairRequest` with use-site orders from liveness).
- **Tests:** per subtask unit tests + the W5-08 stress corpus; differential green; scorecard shows spill-count reduction on the stress fixtures (baseline update justified in PR).
- **AC:** all subtasks landed; no allocation-verifier regressions.

### W5-03 — Wide-constant rematerialization (movz/movk)

- **Size:** S. **Depends:** none.
- **Files:** `spill-remat.ts:90-111,176-178`, `src/target/aarch64/lower/constant-materialization.ts:132,157` (reuse its chunker — verified it already slices 64-bit constants into 16-bit lanes at selection time).
- **Change:** extend `AArch64RematerializationRecipe` with `{ kind: "movz-movk"; value: bigint; instructions: readonly {opcode: "movz"|"movk"; imm16: number; shift: 0|16|32|48}[] }` (REV-B's sketch is directionally right — but **reuse** the existing chunker instead of reimplementing; handle `value === 0n` (single `movz #0`) and prefer `movn` forms when fewer chunks — the constant-materialization module already decides movz-vs-movn; call it); accept `page-base`/`literal` authorities as explicit spills-with-comment (still not remat) — only the `movz-movk`/`constant` kinds rematerialize. Pseudo-expansion consumes the multi-instruction recipe (extend `lowerAArch64MachineInstructions` repair-draft handling).
- **Tests:** remat of `0xDEADBEEF` and `0x1234_5678_9ABC_DEF0` produce correct sequences (assert exact imm16/shift chunks); machine-ir interpreter executes the sequence to the right value; spill fallback for a page-base authority unchanged.
- **AC:** suite + differential green.

### W5-04 — Turn on post-RA scheduling + pair formation, safely

- **Size:** M. **Depends:** catalog tasks W4-01a, W4-01b, W4-01c, W5-01a, W5-01b, and W5-01c.
- **Files:** `src/target/aarch64/backend/api/function-pipeline.ts`, `src/target/aarch64/backend/finalization/post-ra-scheduler.ts`, `src/target/aarch64/backend/finalization/peepholes.ts`, `src/target/aarch64/verify/scheduler-verifier.ts`, `src/target/aarch64/backend/catalogs/rpi5-backend-catalog-data.ts`.
- **Current state (verified):** scheduler invoked with defaults → identity order; peepholes never run; instructions without `memoryKey` get **no** memory edges (safe only while identity — the r16 edge-completeness trap).
- **Change:** (1) memory-key totality: audit every instruction constructor for `memoryKey` presence on memory-touching opcodes; add the conservative rule to the scheduler — an instruction with memory access (classify by opcode) but no `memoryKey` is an island boundary; add a scheduler-verifier check that fails if any memory opcode lacks a key (edge-completeness backstop). (2) Enable `preferLoadLatencyHiding: true` and `enablePeepholes: true` in the pipeline call. (3) Add an A76 latency table (loads 4, mul 3, default 1, stores 1) to the catalog and use it in `compareTokenPriority` (critical-path-ish: prioritize long-latency defs earlier within ready set, stable-tie-broken). (4) `formAArch64PairLoadPeepholes`: verify it handles arbitrary-length runs (REV-A's 07-01 note said exactly-2-instruction input; fix to scan adjacent compatible ldr/str pairs stream-wide with alignment/offset checks).
- **Tests:** scheduler unit tests (island boundaries respected; unkeyed memory op isolates); pair formation goldens; machine-ir differential across all fixtures (the real gate); scorecard improvement.
- **AC:** differential + suite + smoke green with scheduling on.

### W5-05 — Selection fusions

- **Size:** L. **Depends:** W4-01.
- **Files:** `src/target/aarch64/lower/operation-materialization.ts` + materializer siblings, `select/selection-policy.ts`, encoders as needed.
- **Change:** implement, in priority order, each behind its own PR: (1) cmp+branch fusion (compare feeding a sole branch → `cmp; b.cond` without materialized boolean; `cbz/tbz` classification already exists — make it drive emission); (2) madd/msub (`mul`+`add` chains); (3) addressing-mode folding (`add base, idx<<k` into load/store operands); (4) immediate-operand folding (use imm forms when encodable — bitmask-immediate check from W3-08 reused); (5) zero/sign-extend elimination via `w`-register semantics.
- **AC:** per-fusion goldens + differential + scorecard.

### W5-06 — Default veneer provider

- **Size:** M. **Depends:** none.
- **Files:** new `src/linker/aarch64/default-veneer-provider.ts`, `src/target/uefi-aarch64/binary-spine.ts` (pass it), `layout-fixed-point.ts:335-340` (consumer, unchanged).
- **Change:** implement `AArch64LinkerVeneerProvider` producing the 3-instruction trampoline `adrp x16, target; add x16, x16, :lo12:target; br x16` as a synthetic object module — REV-B's blueprint is directionally usable but **do not hand-roll opcode bytes**: encode via `encodeAArch64PhysicalInstructionForTarget` with proper relocation records (`adrp-page` + `add-immediate-page-offset` families — confirm exact family names in `relocation-records.ts`), mirroring how `entry-thunk.ts` builds its object. x16 is a declared veneer-scratch register (`veneerScratchGprs`) and call-boundary reconciliation already models `potentialVeneerClobberGprs` — no new clobber plumbing needed. Wire through `binary-spine.ts`'s `linkAArch64Image` call.
- **Tests:** REV-D's negative→positive: synthetic image with a `branch26` target beyond ±128MB (construct via section placement in a linker unit test, not a real 128MB image) — without provider: deterministic `LINKER_*` rejection (existing behavior asserted); with provider: link succeeds, veneer bytes verified by parsing the linked image, branch retargeted to the veneer.
- **AC:** linker suite green; `validate:full-image` unchanged (fixtures don't need veneers — the provider is exercised by the unit test).

### W5-07 — First-class opt-ir constant data; delete the char16 side-table propagation

- **Size:** L. **Depends:** W4-01.
- **Files:** `src/opt-ir/operations.ts` (+schema/interpreter/verifier) new `globalConst` value/op; `src/opt-ir/program.ts` (constant pool table); `src/semantic/surface/compiler-intrinsic-collector.ts` → HIR → proof-mir → opt-ir lowering of `utf16_static` to a constant-pool reference; backend materialization (adrp+add to a `.rodata` symbol — literal-pool machinery exists); delete `package-pipeline-static-char16.ts:140-495` (`remapStaticChar16MetadataToOptIrValues` + `propagateStaticChar16PointersThroughSourceCallParameters`) and the pointer-record plumbing it feeds.
- **Change:** constants become IR: a program-level constant pool `{ constId, bytes, alignment, section: "rodata", stableKey, fingerprint }`; `utf16_static` lowers to `constAddr(constId)`; the backend emits one `.rodata` contribution per pool entry (dedup by fingerprint) with standard relocations; the UEFI static-char16 object materializer consumes the pool instead of the side table. Keep the existing fingerprint/verification vocabulary (stableKey/fingerprint checks move onto the pool).
- **Tests:** the existing static-char16 validation checks re-pointed at the pool; a fixture passing a string through **two** function calls (the case the old fixpoint propagation existed for) compiles and boots; differential green.
- **AC:** `package-pipeline-static-char16.ts` shrinks to extraction-only (or is deleted); smoke boots with the console marker.

### W5-08 — Backend stress corpus generator

- **Size:** M. **Depends:** W5-01.
- **Files:** new `tests/support/target/aarch64/stress-program-generator.ts` + `tests/integration/target/aarch64/backend-stress.test.ts`.
- **Change:** fast-check generators producing machine-function shapes (or `.wr` sources where expressible): >16 live values (callee-saved pressure), forced spills, parallel-copy cycles, call-heavy bodies, 5KB frames, wide constants under pressure. Each generated case: run the function pipeline, assert verifier-clean, and execute via the machine-ir interpreter differential against an oracle evaluation.
- **AC:** 200-case run green under `bun run verify:extended` (seeded, deterministic); shrunk counterexamples reproduce locally by seed.

---

# WAVE 6 — Product surface

### W6-01 — `wrela` CLI

- **Size:** L. **Depends:** W2-06 (diagnostic envelope). **Files:** new `src/cli/{main.ts,arguments.ts,reporter-host.ts}`, `package.json` (`"bin": { "wrela": "src/cli/main.ts" }` — bun runs TS directly; W6-04 adds built output).
- **Change:** subcommands: `wrela build <dir> [--target uefi-aarch64-rpi5] [--out image.efi] [--emit tokens|ast|hir|proof-mir|opt-ir|asm|object|image] [--json]`, `wrela check <dir>` (stop after proof-check), `wrela run <dir> --qemu` (build + inline smoke from W2-15), `wrela validate` (full-image runner). Package input discovery: a directory containing `src/image.wr` + optional `wrela.toml` (W6-03); construct `CompilerPackageInput` the same way `tests/support` fixture loaders do (read one, reuse/extract the loader into `src/cli/package-loader.ts`). Exit codes: 0 ok, 1 diagnostics, 2 usage, 3 internal error. All human output through the W6-02 reporter; `--json` emits the diagnostic envelope array.
- **Tests:** CLI integration tests spawning `bun src/cli/main.ts build tests/fixtures/...` asserting exit codes, artifact bytes at `--out`, and JSON schema; a bad-source fixture yields exit 1 with rendered diagnostics on stderr.
- **AC:** `bun x wrela build` compiles packet-counter from a clean checkout.

### W6-02 — Diagnostic rendering: caret frames, type formatter, suggestions

- **Size:** L. **Depends:** W2-06.
- **Files:** new `src/cli/reporter.ts`, new `src/semantic/surface/type-formatter.ts`, `src/hir/expression-lowerer.ts` (mismatch messages), `src/semantic/names/diagnostics.ts` (did-you-mean).
- **Change:** (1) renderer: `file:line:col: error[CODE]: message` + source line + caret underline (offsets→line/col via `SourceText`); honor `NO_COLOR`; secondary spans as notes. (2) `formatCheckedType(type, index): string` producing `Result[u32, BootError]`-style names (source names via item index; core names direct; generic params by declared name) — rewrite `HIR_EXPRESSION_TYPE_MISMATCH`/`HIR_OBJECT_FIELD_TYPE_MISMATCH`/W1-16d messages to `expected {X}, found {Y}`. (3) unresolved-name suggestions: Levenshtein ≤ 2 over the scope candidates name resolution already enumerates (`scopeBuilder` tiers expose candidates — add an enumeration hook), appended as `did you mean 'helper'?`.
- **Tests:** golden rendered output for a fixture with one error of each family (byte-exact goldens, `NO_COLOR=1`); type formatter unit tests; suggestion test (`helpre` → `helper`).
- **AC:** goldens green; every mismatch-family diagnostic names both types.

### W6-03 — `wrela.toml` + `wrela init`

- **Size:** M. **Depends:** W6-01.
- **Files:** new `src/cli/manifest.ts` (hand-rolled minimal TOML subset parser — sections, string/bool keys; no dependency additions per repo policy), `src/cli/init.ts`, template under `src/cli/templates/`.
- **Change:** manifest schema v0: `[package] name`, `[target] key = "wrela-uefi-aarch64-rpi5-v1"`, `[stdlib] mode = "toolchain" | "ejected" | "direct-platform"`. `wrela init --target uefi-aarch64` scaffolds `wrela.toml`, `src/image.wr` (compiling hello-smoke program), and copies the stdlib when `mode = "ejected"`. `wrela build` reads the manifest; CLI flags override.
- **AC:** `wrela init && wrela build && wrela run --qemu` works in an empty temp dir (system test, QEMU-gated).

### W6-04 — Package productionization

- **Size:** S. **Depends:** W6-01.
- **Files:** `package.json`, `tsconfig.json`, new `tsconfig.build.json`, README.
- **Change:** add `build` script (`tsc -p tsconfig.build.json` emitting `dist/` + declarations), `"exports"` map (`.` → compiler API, `./cli` → CLI), `"types"`, `"files"`, `"bin"` pointing at built output, `"engines"`, remove `"private": true` only when a publish decision is made (add `"publishConfig": {"access": "restricted"}` placeholder + a `RELEASING.md` documenting the gate). Keep `noEmit` for the dev tsconfig.
- **AC:** `bun run build` produces `dist/` with `.d.ts`; `node -e "require('./dist/index.js')"` (or bun equivalent) loads; `agent:check` includes `bun run build` after this task lands, unless the build demonstrably exceeds the fast-gate budget, in which case `verify:extended` includes it and the reason is documented in `package.json` script comments or `RELEASING.md`.

### W6-05 — QEMU as a required local release gate

- **Size:** S. **Depends:** W0-01, W2-15.
- **Files:** `package.json`, `scripts/verify-qemu.ts`, `RELEASING.md`.
- **Change:** add a local package script:

  ```json
  "verify:qemu": "bun run scripts/verify-qemu.ts"
  ```

  The script detects `qemu-system-aarch64` and AAVMF paths from env or PATH, runs the W2-15 system test and the full-image matrix with QEMU enabled, and exits nonzero if QEMU is configured but smoke fails. If QEMU is absent, it exits 0 only when called in skip-allowed mode (`--allow-missing-qemu`); `verify:release` must call it without the skip flag. Append the skip-allowed form to `verify:extended`:

  ```json
  "verify:extended": "bun run verify:full-image && bun run verify:qemu -- --allow-missing-qemu"
  ```

- **AC:** `bun run verify:qemu -- --allow-missing-qemu` prints an explicit skip reason when QEMU/AAVMF is absent; `bun run verify:qemu` boots the smoke cases and fails on marker absence when QEMU/AAVMF is configured; `RELEASING.md` says release verification requires the non-skip mode.

### W6-06 — Divergent-join diagnostics that teach

- **Size:** M. **Depends:** W2-06, W6-02.
- **Files:** `src/proof-check/kernel/graph-worklist-helpers.ts` (`divergentJoinDiagnostic`), `counterexample-builder.ts:49-94`, new `docs/language/proof-divergence-recipes.md`.
- **Change:** enrich the divergent-join diagnostic: name each failed component **in source terms** (map component keys → the fact's subject place → place → origin span via the origin map; the counterexample builder already walks witnesses — extend the envelope with `failedBlockId`, canonical requirement term, and per-predecessor "on the path from `<source line>`" notes, REV-D #13). Write the recipes doc: hoist-the-fact, consume-before-merge, split-the-join, duplicate-the-tail — each with a before/after `.wr` example keyed to the `divergent-components:` detail families; the diagnostic's rendered note links to it by anchor.
- **Tests:** a fixture engineered to diverge (validate on one arm only) renders both predecessor paths and the component's source name; golden.
- **AC:** golden green; doc exists with 4 recipes.

### W6-07 — Retire the legacy `src/lexer` shim directory

- **Size:** S. **Depends:** W6-01 (a release exists to note it in).
- **Change:** add `@deprecated` JSDoc to every shim, add a W0-03 audit rule forbidding new imports of `src/lexer/*` from `src/**` (allowed only from `tests/` during migration), migrate remaining internal importers (grep), then delete the directory and the README migration note in a follow-up PR two weeks later.
- **AC:** audit green; directory deleted in the follow-up.

---

# WAVE 7 — Scale and maintainability

### W7-01 — Worklist-ify mono reachability

- **Size:** M. **Depends:** none.
- **Files:** `src/mono/reachability.ts` (whole-file restructure), `reachability-shared.ts`.
- **Current state (verified):** `processFunctionWorkItem → instantiate → processOutgoingFunctionEdges → processFunctionWorkItem` recurses one host stack frame per call-graph depth; a deep non-recursive chain overflows the JS stack with no diagnostic (REV-A M-2).
- **Change:** explicit work queue with two-phase items (`{ phase: "expand" }` pushes instantiate + a `{ phase: "finish" }` continuation after its discovered children — standard iterative DFS with post-order actions so the inProgress/completed state machine and cycle detection behave identically). Keep diagnostics byte-identical (the deterministic sorts guarantee it if visit order is preserved — preserve it by pushing children in the current sorted order onto a stack).
- **Tests:** generated 20,000-deep linear call chain compiles. Write the failing test first at depth 20,000; if the default host stack no longer reproduces the failure, record the measured smallest failing depth in the test name and keep the fixture deterministic. Byte-diff mono output on the fixture corpus before/after; it must be identical.
- **AC:** deep-chain test green; corpus outputs identical.

### W7-02 — `Uint8Array` byte pipeline

- **Size:** L. **Depends:** W2-13 (checksum lands first to avoid rebase pain).
- **Files:** `src/pe-coff/pe-byte-writer.ts` (builder core), then outward: `pe-file-layout`, writer, `src/linker/**` section/contribution bytes, `src/target/aarch64/backend/object/**` `codeBytes`, `entry-thunk.ts`, artifact `bytes`.
- **Change:** convert `readonly number[]` byte payloads to `Uint8Array` bottom-up, one subsystem per PR (pe-byte-writer → pe-coff → linker → object/backend → driver artifact), with boundary adapters (`Uint8Array.from(...)`) at un-migrated seams so each PR is green. Public artifact type change (`UefiAArch64ImageArtifact.bytes`) lands last with the fingerprint helper updated (`fingerprintUefiAArch64ImageBytes` hex loop → `Buffer.from(bytes).toString("hex")`-equivalent without Node Buffer: manual hex over the typed array).
- **AC:** each PR green + `validate:full-image` byte-identical output (fingerprint equality proves it); memory note in final PR (heap snapshot of a fixture build before/after).

### W7-03 — Compiler-perf hotspot cluster

- **Size:** M (4 independent S subtasks). **Depends:** none.
- **a.** HIR member lookup: replace `completedFieldForReceiver`'s linear `fields.entries().find` (`expression-lowerer.ts:439-449`) with a lazily-built `Map<itemId, Map<name, field>>` on the lowering context.
- **b.** Fingerprint memo: `checkedTypeFingerprint` memoized via `WeakMap<CheckedType, string>` in `type-model.ts` (types are frozen — safe).
- **c.** Proof-check state-key memo: attach the computed key to the state object (`WeakMap` in `state-key.ts`).
- **d.** `checkSemanticSurface` triple `builder.build()` (`semantic-surface-checker.ts:686,866,876`): make `build()` snapshot-cheap (reuse frozen tables when unchanged) or split seed/finalize so it's called once.
- **AC:** suite green per subtask; micro-benchmark note in PRs.

### W7-04 — File splits by invariant owner (parent context; assign W7-04a/b)

- **Parent workstream. Assignable tasks:** W7-04a, W7-04b. **Depends:** W0-03 (audit enforces no-growth meanwhile).
- **Change:** split the grandfathered >900-line files along the owner boundaries REV-C §"Thermo-Nuclear" and REV-D §21 name, **only when a catalog task already touches the file** (piggyback rule — no standalone churn): e.g. `expression-resolver.ts` → simple-name/member-chain/pattern resolvers (touched by W1-11a, W1-11b, and W1-16a); `operations.ts` → per-domain op modules (touched by W3-08a, W3-08b, W3-08c, W3-08d, W5-07a, W5-07b, W5-07c, and W5-07d); `function-pipeline.ts` → allocation/frame/finalization stages (touched by W5-01a, W5-01b, W5-01c, W5-02a, W5-02b, W5-02c, and W5-02d); `transition-helpers.ts` → place/certificate/session helpers. Every split PR: pure moves + re-exports, zero behavior diff (suite green, no golden churn).
- **AC:** grandfathered list in W0-03 shrinks monotonically; each split is behavior-neutral.

### W7-05 — Frontend memory: keyword-token cache + flat-CST spike

- **Size:** M. **Depends:** none.
- **Change:** (1) intern green tokens for the fixed keyword/punctuation vocabulary with empty trivia (cache keyed by kind+lexeme; only when leading/trailing trivia are empty — REV-D §3); intern common trivia (single space, newline). (2) Time-boxed spike (3 days) benchmarking a flat-array CST (REV-B §2.1) on a synthetic 100K-line module vs. current; produce `docs/design/flat-cst-spike.md` with numbers and a go/no-go recommendation. **No production flat-CST work without the spike's numbers.**
- **AC:** interning lands with reconstruct-lossless property tests green; spike doc exists with measurements.

### W7-06 — Parallel + incremental compilation (design-first)

- **Size:** M (design docs only, this plan). **Depends:** W4-01c, W4-05c, W5-01c, W5-04c, W5-05d.
- **Change:** two design docs through the repo's normal design review: (1) parallel per-function backend + per-module frontend using Bun workers (function pipeline is already per-function pure — the doc must solve deterministic diagnostic merge and artifact ordering); (2) incremental compilation keyed on the existing fingerprint lattice (module content hash → parse cache; graph fingerprint → semantic cache; per-function proof/backend caches), with invalidation via the already-declared analysis-invalidation vocabulary. Implementation is a follow-on plan.
- **AC:** both docs merged after design review.

---

# WAVE 8 — Bounded verification depth

Wave 8 is not allowed to become a research grab bag. The remediation plan keeps only verification tasks with crisp local invariants and executable acceptance gates. Generated-program differential systems, herd7 lanes, and proof-check↔Lean semantic differentials are valuable, but they move behind design/roadmap artifacts until they have their own implementation plans.

### W8-01 — Parser fuzzing on the reconstruct oracle

- **Assignable tasks:** W8-01a, W8-01b.
- **Kept because:** it is bounded, fast, and directly protects the parser's lossless-tree invariant.
- **Invariant:** parsing arbitrary or mutated source never throws; `tree.reconstruct() === source.text`; diagnostics are deterministic across repeated runs.
- **Gate:** include in `agent:check` only if 1,000 cases stay under 30 seconds.

### W8-02 — Canonicalization freeze determinism

- **Assignable tasks:** W8-02a, W8-02b.
- **Kept because:** deterministic proof-MIR freezing is a keystone invariant, and this is property testing rather than research.
- **Invariant:** equivalent draft graphs freeze to byte-identical canonical output regardless of repeated freeze or insertion order.
- **Gate:** include in `agent:check` if under 5 seconds, otherwise `verify:extended` with the budget reason documented.

### W8-03 — Lean build wrapper and coverage honesty

- **Assignable tasks:** W8-03a, W8-03b.
- **Kept because:** it makes the proof model's current status explicit without pretending the Lean model is complete.
- **Invariant:** `verify:lean` runs `lake build Wrela` when Lean is installed; `proof-model/COVERAGE.md` accounts for every TypeScript proof-check domain as `proved`, `modeled-no-theorem`, or `not-modeled`.
- **Gate:** skip-aware in `verify:extended`; non-skip mode can be required by `verify:release` once release policy says Lean is mandatory.

### W8-04 — Local release gate assembly

- **Assignable tasks:** W8-04a, W8-04b.
- **Kept because:** release readiness must be an executable local checklist, not tribal memory or remote CI.
- **Invariant:** every required release claim maps to a local package script; required release scripts cannot silently skip.
- **Gate:** `bun run verify:release`.

### W8-05 — Miscompile-confidence ladder seed, not research execution

- **Assignable tasks:** W8-05a, W8-05b.
- **Kept because:** the repo needs a roadmapped confidence ladder and one tiny generated-program seed, but not a full generated compiler-verification program in this remediation wave.
- **Invariant:** the ladder doc separates fast required gates, extended local gates, release gates, and research/formal lanes; the seed test covers straight-line unsigned arithmetic only.
- **Gate:** W8-05b may join `verify:extended` if stable and fast; the larger generator/QEMU/herd7 work is outside this plan until approved separately.

### W8-06 — Proof-check domain ↔ Lean differential roadmap

- **Assignable task:** W8-06a.
- **Moved out of release path because:** comparing TS proof-check judgments to Lean verdicts plus licensing facts is a real research project. This plan requires an architecture roadmap, not an implementation that blocks compiler production hardening.
- **Deliverable:** `docs/design/proof-check-lean-differential-roadmap.md` with schema, first lane, risk, owner, and no release dependency.

---

## Traceability index (review finding → task)

**REV-A Part I:** BUG-1→W1-02a/W1-02b/W1-02c · BUG-2→W1-03a/W1-03b/W1-03c · BUG-3→W1-01a/W1-01b/W1-01c/W5-01a/W5-01b/W5-01c · BUG-4→W1-04a/W1-04b · BUG-5→W1-08a/W1-08b · BUG-6→W1-09a/W1-09b · BUG-7→W1-10a/W1-10b · BUG-8→W1-11a/W1-11b · BUG-9→W2-13a/W2-13b/W2-13c/W2-13d · BUG-10→W1-16a · BUG-11→W1-16b · BUG-12→W1-16d · small defects→W1-16e/W1-16f/W2-13a/W2-13b/W2-13c/W2-13d · O1-O10→W4-02a/W4-02b/W4-02c/W4-02d/W4-03a/W4-03b/W4-04a/W4-04b/W4-05a/W4-05b/W4-05c/W4-10a/W4-10b/W4-10c/W1-09a/W1-09b · B1-B10→W1-01a/W1-01b/W1-01c/W5-01a/W5-01b/W5-01c/W5-02a/W5-02b/W5-02c/W5-02d/W5-03a/W5-03b/W5-04a/W5-04b/W5-04c/W5-05a/W5-05b/W5-05c/W5-05d/W2-13a/W2-13b/W2-13c/W2-13d/W7-02a/W7-02b/W7-02c/W7-02d/W7-02e · streams→W3-02a/W3-02b/W3-02c/W3-02d · CLI/diagnostics→W6-01a/W6-01b/W6-01c/W6-01d/W6-01e/W6-01f/W6-01g/W6-02a/W6-02b/W6-02c · stdlib→W3-09a/W3-09b/W3-09c/W3-09d · miscompile-confidence→W4-01a/W4-01b/W4-01c/W8-05a/W8-05b · perf §9→W7-01a/W7-01b/W7-02a/W7-02b/W7-02c/W7-02d/W7-02e/W7-03a/W7-03b/W7-03c/W7-03d/W4-08a · testing §10→W0-02a/W0-02b/W0-02c/W8-01a/W8-01b/W5-08a/W5-08b/W4-11a/W4-11b.
**REV-A Part II:** M-1→W3-07a/W3-07b · M-2→W7-01a/W7-01b · M-3→W7-03b · M-4→W1-17a · L-1→W3-07a/W3-07b · L-2/L-3→W1-16f · PM-1→W3-02a/W3-02b/W3-02c/W3-02d/W3-03a/W3-03b · PM-2→W8-02a/W8-02b · PM-3→W1-17c · PC-1→W6-06a/W6-06b · PC-2→W4-09a/W4-09b · PC-3→W8-06a · PC-4→W1-17b · PC-5→W7-03c.
**REV-B:** §2.1→W7-05a/W7-05b · §2.2/2.3→W8-01a/W8-01b · §3.1→W4-08a · §3.2→W3-07a/W3-07b · §4.1→W4-09a/W4-09b/W2-09a/W2-09b · §4.2→W2-10a/W2-10b · §5.1→W4-10a/W4-10b/W4-10c · §5.2→W4-02a/W4-02b/W4-02c/W4-02d · §6.1→W5-02a/W5-02b/W5-02c/W5-02d · §6.2→W5-03a/W5-03b · §6.3→W2-14a/W2-14b · §7.1→W5-06a/W5-06b · §7.2→W2-13a/W2-13b/W2-13c/W2-13d · §8.1→W3-09a/W3-09b/W3-09c/W3-09d · §8.2→W7-06a/W7-06b · §8.3→W6-02a/W6-02b/W6-02c · §8.4→W8-06a · §8.5→W8-05a/W8-05b.
**REV-C:** Critical#1→W1-06a/W1-06b · #2→W1-01a/W1-01b/W1-01c/W5-01a/W5-01b/W5-01c · #3→W1-07a · #4→W1-05a/W1-05b/W1-05c · #5→W1-12a/W1-12b · #6→W2-02a/W3-04a/W3-04b/W3-04c · #7→W1-13a/W1-13b · #8→W2-01a/W2-01b/W2-01c · #9→W1-14a/W1-14b · #10→W0-01a/W0-01b/W6-05a/W6-05b · #11→W6-04a/W6-04b/W6-01a/W6-01b/W6-01c/W6-01d/W6-01e/W6-01f/W6-01g · #12→W8-03a/W8-03b · module-graph diag→W1-15a/W1-15b · string double-diag→W1-03a/W1-03b/W1-03c · index span→W1-16c · linker parity→W2-03a/W2-03b · slow validator→W2-03a/W2-03b · reloc pairs→W2-04a/W2-04b · large frames→W2-04a/W2-04b · stream/yield/switch→W3-02a/W3-02b/W3-02c/W3-02d/W3-03a/W3-03b/W3-05a/W3-05b · generic entries→W3-06a/W3-06b · smoke→W2-15a/W2-15b · matrix→W3-11a/W3-11b · stdlib→W3-09a/W3-09b/W3-09c/W3-09d · package→W6-04a/W6-04b · layout-knows-UEFI→W3-10a · mono origin fallbacks→W2-08a/W2-08b · regex policy→W2-11a · big files→W0-04b/W0-05a/W0-05b/W0-05c/W0-05d/W0-05e/W0-05f/W7-04a/W7-04b · local gates→W0-01a/W0-01b/W6-05a/W6-05b/W8-04a/W8-04b.
**REV-D:** #1→W3-02a/W3-02b/W3-02c/W3-02d · #2→W3-01a/W3-01b · #3→W6-01a/W6-01b/W6-01c/W6-01d/W6-01e/W6-01f/W6-01g · #4→W3-09a/W3-09b/W3-09c/W3-09d · #5→W1-12a/W1-12b · #6→W2-09a/W2-09b · #7→W2-15a/W2-15b · #8→W6-02a/W6-02b/W6-02c · #9→W1-09a/W1-09b · #10→W4-07a · #11→W2-08a/W2-08b · #12→W0-03a/W0-03b/W0-04b/W0-05a/W0-05b/W0-05c/W0-05d/W0-05e/W0-05f/W7-04a/W7-04b · #13→W6-06a/W6-06b · #14→W2-15a/W2-15b · #15→W6-07a/W6-07b/W2-06a/W2-06b · #16→W1-15a/W1-15b · #17→W0-03a/W0-03b · #18→W2-12a · #19/#20→W2-13a/W2-13b/W2-13c/W2-13d · #21→W3-11a/W3-11b · #22→W2-08a/W2-08b · #23→W2-05a · #24→W2-14a/W2-14b/W3-02a/W3-02b/W3-02c/W3-02d · #25→W6-04a/W6-04b · #26→W5-02a/W5-02b/W5-02c/W5-02d · #27→W5-03a/W5-03b · #28→W5-06a/W5-06b · #29→W5-02a/W5-02b/W5-02c/W5-02d · #30→W2-14a/W2-14b · #31→W3-07a/W3-07b · #32→W4-02a/W4-02b/W4-02c/W4-02d · #33→W2-10a/W2-10b · §2 seam items→W2-06a/W2-06b/W2-07a/W2-07b · §18 stringify→W1-14a/W1-14b · §16 Lean→W8-03a/W8-03b · §17 fuzz/system→W8-01a/W8-01b/W2-15a/W2-15b.

## Completion definition

The plan is done when: every suffixed task's AC is green under its required local command (`agent:check`, `verify:extended`, `verify:qemu`, `verify:lean`, or `verify:release` as specified); the REV-C "Definition of Done" checklist encoded by W8-04a/W8-04b passes; `wrela init && wrela build && wrela run --qemu` works from a clean machine; the happy.md program compiles, validates, and boots (W3-02a/W3-02b/W3-02c/W3-02d/W3-09a/W3-09b/W3-09c/W3-09d/W3-11a/W3-11b); and the four review documents can each be re-read with every finding either fixed (traceable above) or explicitly rejected with the ruling recorded in this document's header.
