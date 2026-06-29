# OptIR Construction And Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the OptIR construction and optimization phase described in `docs/design/opt-ir-construction-optimization-design.md`, from checked MIR handoff authentication through optimized, fact-preserving, vector-capable OptIR.

**Architecture:** OptIR is a pure downstream compiler phase after proof/resource checking and layout. Construction authenticates checked MIR, checked fact packets, path certificates, semantic-inline policies, layout facts, and target optimization surfaces, then lowers into canonical SSA OptIR with explicit regions, facts, provenance, operation schemas, and verifier coverage. Optimization is a fixed deterministic pass pipeline whose rewrites preserve, derive, or drop facts through pass contracts, rewrite-legality obligations, and provenance records.

**Tech Stack:** TypeScript, Bun test runner, existing proof-check/proof-mir/layout/mono/runtime public models, dependency-injected fakes for target/effect/fact surfaces, `fast-check` only in tests, no runtime source dependencies.

---

## Research Notes

- Design source: `docs/design/opt-ir-construction-optimization-design.md`.
- Current repo has no `src/opt-ir` directory. This plan creates the phase from scratch.
- Current proof-check exports `CheckedMirProgram`, `CheckedFactPacket`, `CheckedFactScope`, `CheckedFactSubject`, `CheckedPacketFactKind`, `CheckedFunctionSummary`, `CheckedTerminalGraphCertificate`, and authority fingerprints through `src/proof-check/index.ts`.
- Current proof-check does not yet expose the full OptIR handoff required by the design: a checked certificate bundle, packet-validation attestation, checked path certificate table, or checked semantic-inline policy table. Tasks 9 and 10 add one fingerprinted `CheckedOptIrHandoff` that embeds `CheckedMirProgram` plus those evidence tables as a concrete prerequisite for construction.
- `CheckedMirProgram` currently owns `mir`, `checkedFunctions`, `summaries`, `facts`, `terminalGraph`, and `originMap`. Its `mir` is a `ProofMirProgram` with `reachableFunctions`, `functions`, `layout`, `proofMetadata`, `origins`, `facts`, `layoutTerms`, `privateStateGenerations`, `callGraph`, `platformEdges`, `runtimeCatalog`, and `runtimeCalls`.
- `CheckedFactPacket` is envelope-shaped. It has fact kind, subject, scope, dependencies, invalidations, certificate, and origin. OptIR typed fact answers must be imported from those envelopes plus checked summaries, Proof MIR references, authenticated layout facts, path certificates, and target/runtime/platform catalogs.
- Layout facts are represented by `LayoutFactProgram` in `src/layout/layout-program.ts`; layout fact keys currently also appear as branded strings in `src/proof-check/model/fact-packet.ts`.
- `ProofAuthorityFingerprint` already exists in `src/shared/proof-authority-types.ts`.
- `scripts/check-policy.ts` already enforces proof-check boundaries and exposes pure test helpers. Task 0 adds an OptIR import-boundary rule before implementation starts.
- Existing top-level exports in `src/index.ts` export namespaces for frontend, hir, layout, mono, proofMir, proofCheck, runtime, semantic, shared, and target. Only the final public export task should add `optIr`.
- Required handoff command from `agents.md`:

```bash
PATH="$HOME/.bun/bin:$PATH" bun run agent:check
```

- Useful narrow commands while iterating:

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/ids.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/operation-schema.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-index.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/construction.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/mandatory-inlining.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/whole-program-specialization.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-gated-egraph.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/opt-ir/validated-buffer-optimization.test.ts
```

## Implementation Findings From Execution

- Task 14B also owns `src/opt-ir/facts/fact-query.ts`; the atomic split matrix has been updated so future workers do not treat fact-query wiring as orphaned shared state.
- Task 13 fact import schema implementation found that `summaryInstantiation` dependencies must validate against summary-instantiation certificate IDs, not function-summary certificate IDs.
- Task 15 path-certificate re-homing now drops excluded edges from the old CFG snapshot after proving they do not survive; retaining removed excluded edges made rehomed certificates reference stale CFG edges.
- Task 15 import rejects an edge allocator that maps two distinct `ProofMirControlEdgeId` values to the same `OptIrEdgeId`, preserving the one-time fresh-edge mapping requirement.
- Task 16 callback-visible regions are conservatively tied to the `externalUnknown` alias class after external memory is materialized, including callback-visible stack locals.
- Task 27A dominance needed a linear-chain regression: immediate dominator selection must choose the closest strict dominator, not the shallowest one.
- Task 23C pass-schedule validation must use the pass contract's declared form preconditions directly; recomputing inferred form requirements from preserved analyses made intentionally narrow contracts look invalid.
- Task 25A dead-code elimination must seed CFG edge arguments as live values. Edge arguments are control-flow uses, not normal operation operands, and omitting them made DCE remove required block-parameter producers.
- Task 24B path-scoped preserved facts must update their `scope.certificateId` to the re-homed OptIR path certificate. Treating a path certificate ID as an edge subject remap or retaining the old scope allowed stale path scopes to pass preservation.
- Task 21 construction cleanup must compute reachability from terminator successor edges, not from every CFG edge leaving a reachable block. Otherwise return blocks with stale outgoing edges keep unreachable blocks, operations, and facts alive.
- Task 25D scalar simplification must iterate under the declared fuel and accumulate all rewrite records, removals, and remaps across rounds. Single-round folding missed constants exposed by earlier rewrites.
- Task 28 memory SSA/effect-token indexes must preserve per-block operation order when computing dependencies. Sorting operations globally by operation ID can invent dependencies that are not present in the actual block sequence.
- Task 22 construction cleanup must feed its returned functions back into the public construction result, and skeleton lowering must preserve basic Proof MIR terminators before cleanup runs. Applying cleanup to edge-only skeletons would make valid multi-block checked MIR appear unreachable.
- Task 29 mandatory inlining must rewrite operation-specific value fields as well as generic operand/result arrays, and must reject callee operation IDs that collide with caller operation IDs when the implementation reuses callee IDs.
- Task 26 SCCP must deduplicate derived impossibility facts across fixpoint rounds, and value numbering must preserve operand order for order-sensitive operations. Sorting every operand made reversed subtraction look commonable.
- Task 34 memory forwarding must require a compatible memory-version or effect-token chain and matching value type. Falling back to forwarding untracked regions with no token chain was unsafe.
- Task 34 memory rewrite records must identify real operation or region subjects. Placeholder operation IDs for scalar replacement or stack promotion hide the rewrite surface from downstream legality checks.
- Task 30 local policy feature vectors must be allowlisted and typed. Rejecting only known dynamic fields still let arbitrary host-derived or malformed feature keys influence deterministic policy decisions.
- Task 36 e-graph import ordering may sort by stable referenced operand IDs, but imported e-node operands must keep schema order. Sorting operands inside the imported entry erases order-sensitive semantics.
- Task 39 SLP vector operation construction must validate idiom-specific source value counts before creating vector operations. Fixed-width store/set idioms need distinct vector and store-value operands, not a default or duplicated source value.
- Task 31 whole-program inlining has the same remapping hazards as mandatory inlining: reject callee operation IDs that collide with caller IDs when IDs are reused, and remap operation-specific value fields rather than only generic operand/result arrays.
- Task 32 binding-time analysis must treat dynamic classifications as terminal/conservative. SCCP-discovered constants or static fact sources must not upgrade values that consume dynamic operands, rely on out-of-scope facts, come from unknown calls, or are produced by effectful operations.
- Task 33 specialization clone candidates must materialize real clone functions or be denied for a concrete policy reason. Logging accepted candidates as `not-materialized` misses the polyvariant cloning and fact/path re-homing requirement.
- Task 37 conjunction fact gates must report the sum of child minimum fact requirements, and extraction records should expose the plan-facing `rulesApplied` field alongside internal rule IDs.
- Task 38 non-interpreter-complete e-graph rewrites must reject unapproved `notApplicable` reasons. Filtering unapproved reasons away lets unsupported slices be accepted without catalog authority.
- Task 40 loop vector store rewrites must preserve the vector memory descriptor type and reject malformed store source-value shapes during legality, before rewrite construction can throw.
- Task 42 packet-parser demonstrations should wrap the real optimizer result and provenance when using explicit demo operations. Fabricating an optimizer result hides pipeline/provenance regressions even if individual Wrela passes are real.
- Independent review found that real proof-check handoffs must emit mandatory semantic-inline policies for every checked summary; otherwise boundary validation rejects actual proof-check output even while synthetic fixtures pass.
- Independent review found that public construction must carry canonical OptIR operations from checked MIR statement lowering into verification and optimization. Verifying construction against an empty operation table masked missing statement-result definitions and stale skeleton-only lowering.
- Independent review found that optimizer inputs must not accept top-level operation or region sidecars. Operation/region optimization state now belongs to the constructed program artifact so callers cannot pass stale side tables beside a program.
- Independent review found that fixed pipeline schedule entries should dispatch the named pass or a deliberate analysis marker, not repeatedly run whole pass clusters under every scalar, memory, or vector entry.
- Independent review found that SSA dominance verification must use CFG dominance, not block-list order. Later-listed dominators are valid, while sibling branch values must be rejected.
- Independent review found that memory-region and Wrela schedule entries still needed production candidate discovery and operation-artifact synchronization. The pipeline now dispatches memory SSA, memory optimization, scalar replacement, stack promotion, LICM, Wrela, e-graph, and vector analysis from real program state, and dead-store removals update both returned operation artifacts and block operation lists.
- Independent review found that the packet-parser demo must not replace the optimizer result with a fabricated operation snapshot. The demo fixture now rewrites the constructed program, inserts the required packet region metadata, and runs the real optimizer result end to end.
- Execution found that memory and vector store constructors emitted a unit result type without a corresponding SSA result ID, which structural verification rejected once store operations flowed through the full pipeline. Store operations now have empty result IDs and empty result types.
- Execution found that vector pass orchestration must not publish vector operations as final optimized artifacts until they are committed into verified program blocks. The pipeline records real SLP and loop-vectorization candidate decisions without returning unattached vector sidecars.
- Execution split production pipeline candidate discovery into `pipeline-candidates.ts` so orchestration stays focused on pass ordering, verification checkpoints, and state transitions.
- Independent review found that public construction still had four end-to-end gaps after the pipeline fixes: validated-buffer reads used a placeholder region, call-backed capability facts received no MIR call lookup evidence, proof erasure was implemented but not invoked by `constructOptIr`, and layout authentication relied on serialized string scanning. Construction now materializes deterministic validated-payload regions, forwards checked MIR call graph IDs into fact import, runs proof erasure before cleanup, and authenticates layout keys from structured layout fact tables only.
- Follow-up review found three narrower authentication/canonicalization gaps: call-backed facts were validated by bare call IDs instead of owned call IDs, layout keys were checked without requiring the layout fingerprint to be attested by packet validation, and public checked-MIR validated-buffer reads still bypassed canonical read metadata. Fact import now validates call subjects against `(functionInstanceId, callId)`, layout references require an attested layout fingerprint, and public construction routes validated-buffer reads through canonical access metadata before emitting the memory load.
- Final review found that validated-buffer reads still needed to consume imported OptIR fact IDs instead of cast Proof MIR fact IDs, proof erasure needed to remove imported facts that reference erased proof-only values, validated-buffer memory loads needed to carry the authenticated buffer-instance layout key, and read metadata needed only the path certificate selected by its imported fact. Public construction now derives lowering authorities from imported validated-buffer fact records, filters proof-only fact lineage after erasure, uses the proof-check buffer instance layout key for validated-payload regions and memory loads, and records only the relevant path certificate on each canonical read.
- Thermo-nuclear code-quality review found that construction orchestration, layout authentication, and stable serialization had duplicated across `public-api.ts`, `boundary-validation.ts`, `fact-import-schema.ts`, and `pipeline.ts`. Construction now runs through `lower/construction-pipeline.ts`, layout attestation flows through `layout-authority-policy.ts`, and canonical stable JSON/digest helpers live in `shared/stable-json.ts`.
- The same review unified memory bounds authority on a single `OptIrBoundsAuthority` model in `operations.ts` (`certifiedFact`, `passDerivedFact`, `runtimeGuard`, `constructionSize`, `layoutFact`, `targetContract`) and removed the JSON-stringify `validatedBuffer` bridge. Construction emits `certifiedFact` directly; Wrela bounds zero-copy re-homes `passDerivedFact`.
- Validated-buffer lowering now lives in `lower/validated-buffer-lowering.ts` with an indexed authority lookup and a single `lowerValidatedBufferFieldRead` entry point; proof-only fact filtering uses explicit scoped Proof MIR value keys from `proof-mir-lowering-support.ts` instead of parsing value-key strings in the public API.
- Pipeline determinism helpers moved to `passes/pipeline-support.ts`; packet-parser integration now exercises one production optimizer path instead of a manual Wrela pass-chain snapshot.
- Thermo-nuclear follow-up split test-only skeleton lowering into `lower/skeleton-lowering.ts` with shared `OptIrSkeletonLoweringResult` in `lower/lowering-types.ts`, leaving `lower-checked-mir.ts` focused on Proof MIR statement lowering.
- Thermo-nuclear follow-up decomposed `passes/pipeline.ts` into `pipeline-types.ts`, `pipeline-state.ts`, `pipeline-diagnostics.ts`, `pipeline-steps.ts`, and `pipeline-dispatch.ts`; the public entry point now re-exports types and `optimizeOptIr` from a ~70-line orchestrator.
- Independent review found that lowering stored raw Proof MIR call-graph edges in `OptIrProgram.callGraph.calls` even though fact import already consumes call subjects from the handoff. Construction now leaves `callGraph.calls` empty until OptIR call edges are modeled explicitly.
- Independent review found that construction proof erasure and imported-fact filtering were split across two paths without documentation. `construction-fact-filter.ts` now owns the program-wide imported-fact drop after per-function IR erasure, with an explicit module comment describing why `eraseProofOnlyOptIr` receives `facts: []`.
- Follow-up wired construction imported-fact preservation through `runProofErasureFactPreservation`, re-homing surviving facts with `proofErasurePreserved` lineage on `OptIrFactRecord` instead of dropping every fact that mentions an erased proof-only value.
- Empirical review found that alias queries match by subject key and ignore dependency liveness; construction now preserves `noalias`/`ownership` facts on surviving places/edges when an erased proof-only `proofMirValue` witness has erasure lineage, and drops them when lineage is missing.

## Executor Protocol

Every task is intended to be small enough for one worker after its dependencies have landed.

- [ ] Read the task description, dependencies, files, acceptance criteria, examples, and verification commands.
- [ ] Confirm every dependency task has landed.
- [ ] Confirm no same-level task owns the same production files.
- [ ] Write failing tests first in the task-owned test file. Use the examples as concrete patterns, then add sibling cases for every acceptance criterion.
- [ ] Run the narrow verification command and confirm the new test fails for the expected missing symbol or missing behavior.
- [ ] Implement only the files listed by the task.
- [ ] Use fakes through dependency injection. Do not use mocks or spies.
- [ ] Keep filesystem and Bun access outside runtime source.
- [ ] Run the narrow verification command again and confirm it passes.
- [ ] Run any adjacent tests listed by the task.
- [ ] Commit only this task's files. Commits created by automation must end with `-Codex Automated`.

Example commit command for each task:

```bash
git add <task-owned-files>
git commit -m "feat: add opt-ir <task topic> -Codex Automated"
```

## File Structure

The implementation should create or modify these files. Each task below owns a subset.

```text
src/
  index.ts                                      # final export task only
  proof-check/
    index.ts                                   # Task 10 export only
    proof-checker.ts                           # Task 10 only
    model/
      opt-ir-handoff.ts                        # Task 9
      function-summary.ts                      # Task 9 only if needed for inline policy links
    proof-check-phases.ts                      # Task 10 only
    validation/
      packet-certificate-types.ts              # Task 9 only if attestation needs shared input shape
  opt-ir/
    index.ts                                   # final export task only
    ids.ts
    diagnostics.ts
    deterministic-sort.ts
    deterministic-ids.ts
    types.ts
    vector-types.ts
    values.ts
    constants.ts
    cfg.ts
    cfg-edits.ts
    program.ts
    regions.ts
    effects.ts
    operations.ts
    operation-schema.ts
    operation-kinds.ts
    operation-schema-core.ts
    operation-schema-effectful.ts
    operation-semantics.ts
    operation-effects.ts
    terminators.ts
    calls.ts
    layout-access.ts
    provenance.ts
    internal-construction-api.ts
    public-api.ts                             # Task 22 creates construction API; Task 41 adds optimization API
    boundary-validation.ts
    target-surface.ts
    interpreter.ts
    differential.ts
    facts/
      fact-import-schema.ts
      fact-index.ts
      fact-query.ts
      fact-lineage.ts
      fact-preservation.ts
      subject-remapping.ts
      bounds-facts.ts
      alias-facts.ts
      layout-facts.ts
      effect-facts.ts
      abi-facts.ts
      capability-facts.ts
      private-state-facts.ts
      path-certificates.ts
    lower/
      lower-checked-mir.ts
      region-builder.ts
      block-argument-builder.ts
      canonical-operations.ts
      validated-buffer-reads.ts
      call-lowering.ts
      proof-erasure.ts
      provenance-builder.ts
    analyses/
      dominance.ts
      loop-tree.ts
      call-graph.ts
      scc.ts
      liveness.ts
      escape-analysis.ts
      alias-analysis.ts
      memory-ssa.ts
      effect-tokens.ts
      range-analysis.ts
      value-numbering.ts
      binding-time-analysis.ts
    policy/
      optimization-profile.ts
      pass-order-policy.ts
      expansion-budget.ts
      inline-policy.ts
      specialization-policy.ts
      memory-policy.ts
      vector-policy.ts
      local-policy.ts
      egraph-extraction-policy.ts
      decision-log.ts
    passes/
      pipeline.ts
      pass-contract.ts
      cleanup.ts
      scalar-simplification.ts
      sccp.ts
      dce.ts
      gvn.ts
      copy-propagation.ts
      cfg-simplification.ts
      licm.ts
      mandatory-inlining.ts
      whole-program-inlining.ts
      whole-program-specialization.ts
      specialization/
        residual-invariant.ts
        static-driving.ts
        clone-signature.ts
        bounded-unroll.ts
      memory-optimization.ts
      scalar-replacement.ts
      stack-promotion.ts
      wrela-optimizations/
        index.ts
        move-copy-wrapper-elision.ts
        bounds-zero-copy.ts
        endian-parser-collapse.ts
        terminal-platform-specialization.ts
      fact-gated-egraph.ts
      slp-vectorization.ts
      loop-vectorization/
        index.ts
        loop-shape.ts
        loop-legality.ts
        loop-rewrite.ts
      vectorization-cleanup.ts
    egraph/
      egraph.ts
      equivalence-class.ts
      rewrite-rule.ts
      fact-gated-rule.ts
      rule-catalog.ts
      saturation.ts
      extraction.ts
      egraph-cost.ts
      region-selection.ts
      egraph-diagnostics.ts
      translation-validation.ts
    verify/
      structural-verifier.ts
      ssa-verifier.ts
      region-verifier.ts
      fact-verifier.ts
      operation-metadata-verifier.ts
      operation-schema-verifier.ts
      cfg-edit-verifier.ts
      path-certificate-verifier.ts
      rewrite-legality.ts
      pass-invariant-schema.ts
      pass-schedule-consistency.ts
      pass-verifier.ts
scripts/
  check-policy.ts
tests/
  support/
    opt-ir/
      README.md
      ids-diagnostics-fakes.ts
      types-fakes.ts
      cfg-fakes.ts
      region-effect-fakes.ts
      operation-fakes.ts
      verifier-fixtures.ts
      checked-mir-fixtures.ts
      opt-ir-handoff-fixtures.ts
      fact-packet-fixtures.ts
      fact-import-fixtures.ts
      fact-index-fixtures.ts
      path-certificate-fixtures.ts
      target-optimization-fakes.ts
      small-program-fixtures.ts
      internal-construction-fixtures.ts
      construction-fixtures.ts
      pass-contract-fixtures.ts
      fact-preservation-fixtures.ts
      dataflow-fixtures.ts
      analysis-fixtures.ts
      memory-ssa-fixtures.ts
      egraph-fixtures.ts
      vector-fixtures.ts
      opt-ir-interpreter.ts
      opt-ir-differential.ts
      property-generators.ts
  unit/
    opt-ir/
      import-policy.test.ts
      ids.test.ts
      diagnostics.test.ts
      model.test.ts
      cfg.test.ts
      regions-effects.test.ts
      operation-schema.test.ts
      operation-schema-core.test.ts
      operation-schema-effectful.test.ts
      operation-semantics.test.ts
      verifier.test.ts
      interpreter.test.ts
      opt-ir-handoff.test.ts
      internal-construction-api.test.ts
      public-api.test.ts
      boundary-validation.test.ts
      fact-import-schema.test.ts
      fact-index.test.ts
      fact-preservation.test.ts
      path-certificates.test.ts
      region-builder.test.ts
      construction.test.ts
      canonical-operations.test.ts
      validated-buffer-reads.test.ts
      call-lowering.test.ts
      proof-erasure.test.ts
      construction-orchestration.test.ts
      pass-contract.test.ts
      pass-schedule-consistency.test.ts
      cleanup.test.ts
      scalar-simplification.test.ts
      sccp.test.ts
      gvn.test.ts
      analyses.test.ts
      memory-ssa.test.ts
      mandatory-inlining.test.ts
      expansion-budget.test.ts
      whole-program-inlining.test.ts
      binding-time-analysis.test.ts
      whole-program-specialization.test.ts
      whole-program-specialization.residual.test.ts
      whole-program-specialization.static-driving.test.ts
      whole-program-specialization.clone-signature.test.ts
      memory-optimization.test.ts
      wrela-optimizations.test.ts
      wrela-move-copy-wrapper.test.ts
      wrela-bounds-zero-copy.test.ts
      wrela-endian-parser.test.ts
      wrela-terminal-platform.test.ts
      egraph-core.test.ts
      fact-gated-egraph.test.ts
      egraph-rule-soundness.test.ts
      egraph-translation-validation.test.ts
      vector-types.test.ts
      slp-vectorization.test.ts
      loop-vectorization.test.ts
      loop-vectorization-shape.test.ts
      loop-vectorization-legality.test.ts
      pipeline.test.ts
      determinism.test.ts
  integration/
    opt-ir/
      checked-mir-to-opt-ir.test.ts
      optimized-opt-ir-interpreter.test.ts
      fact-preserving-rewrites.test.ts
      validated-buffer-optimization.test.ts
      platform-effect-boundaries.test.ts
      deterministic-output.test.ts
      packet-parser-demo.test.ts
```

## Shared File Ownership

- Task 0 owns `scripts/check-policy.ts` for OptIR import policy.
- Task 0 owns `tests/support/opt-ir/README.md`.
- Task 1 owns `tests/support/opt-ir/ids-diagnostics-fakes.ts`.
- Task 2 owns `tests/support/opt-ir/types-fakes.ts`.
- Task 3 owns `tests/support/opt-ir/cfg-fakes.ts`.
- Task 4 owns `tests/support/opt-ir/region-effect-fakes.ts`.
- Task 5 owns `tests/support/opt-ir/operation-fakes.ts`.
- Task 6 owns `tests/support/opt-ir/verifier-fixtures.ts`.
- Task 7 owns `tests/support/opt-ir/opt-ir-interpreter.ts` and `tests/support/opt-ir/opt-ir-differential.ts`.
- Task 8 owns `tests/support/opt-ir/checked-mir-fixtures.ts`, `tests/support/opt-ir/opt-ir-handoff-fixtures.ts`, `tests/support/opt-ir/fact-packet-fixtures.ts`, `tests/support/opt-ir/target-optimization-fakes.ts`, and `tests/support/opt-ir/small-program-fixtures.ts`.
- Task 11 owns `tests/support/opt-ir/internal-construction-fixtures.ts`.
- Task 13 owns `tests/support/opt-ir/fact-import-fixtures.ts`.
- Task 14 owns `tests/support/opt-ir/fact-index-fixtures.ts`.
- Task 15 owns `tests/support/opt-ir/path-certificate-fixtures.ts`.
- Task 22 owns `tests/support/opt-ir/construction-fixtures.ts`.
- Task 23 owns `tests/support/opt-ir/pass-contract-fixtures.ts`.
- Task 24 owns `tests/support/opt-ir/fact-preservation-fixtures.ts`.
- Task 26 owns `tests/support/opt-ir/dataflow-fixtures.ts`.
- Task 27 owns `tests/support/opt-ir/analysis-fixtures.ts`.
- Task 28 owns `tests/support/opt-ir/memory-ssa-fixtures.ts`.
- Task 36 owns `tests/support/opt-ir/egraph-fixtures.ts`.
- Task 40 owns `tests/support/opt-ir/vector-fixtures.ts`.
- Task 9 owns `src/proof-check/model/opt-ir-handoff.ts`.
- Task 10 is the only task before final exports that modifies `src/proof-check/index.ts`, `src/proof-check/proof-checker.ts`, or `src/proof-check/proof-check-phases.ts`.
- Task 11 owns `src/opt-ir/internal-construction-api.ts`, `src/opt-ir/target-surface.ts`, and `src/opt-ir/policy/optimization-profile.ts`.
- Task 22 owns `src/opt-ir/public-api.ts` for construction exports. Task 41 modifies it for optimization exports.
- Task 41 is the only task that creates or modifies `src/opt-ir/index.ts` and the top-level `src/index.ts`.
- Task 43 owns `tests/support/opt-ir/property-generators.ts`.
- If a task needs a helper not in this plan, keep it local to that task's test file or update this helper ownership section in the same task.
- Same-level tasks must not modify the same production file. If a dependency level creates a shared interface, later same-level tasks import it but do not edit it.

## Shared Test Helper Registry

| Helper                                               | Owning Task | File                                                     |
| ---------------------------------------------------- | ----------- | -------------------------------------------------------- |
| `checkPolicyTextForTest`                             | Task 0      | `scripts/check-policy.ts`                                |
| `optIrProgramIdForTest`                              | Task 1      | `tests/support/opt-ir/ids-diagnostics-fakes.ts`          |
| `optIrDiagnosticForTest`                             | Task 1      | `tests/support/opt-ir/ids-diagnostics-fakes.ts`          |
| `optIrScalarTypeForTest`                             | Task 2      | `tests/support/opt-ir/types-fakes.ts`                    |
| `optIrBlockForTest`                                  | Task 3      | `tests/support/opt-ir/cfg-fakes.ts`                      |
| `optIrRegionForTest`                                 | Task 4      | `tests/support/opt-ir/region-effect-fakes.ts`            |
| `optIrOperationForTest`                              | Task 5      | `tests/support/opt-ir/operation-fakes.ts`                |
| `optIrVerifierInputForTest`                          | Task 6      | `tests/support/opt-ir/verifier-fixtures.ts`              |
| `verifyOptIrProgramForTest`                          | Task 6      | `tests/support/opt-ir/verifier-fixtures.ts`              |
| `optIrInterpreterFixtureForTest`                     | Task 7      | `tests/support/opt-ir/opt-ir-interpreter.ts`             |
| `checkedMirProgramForOptIrTest`                      | Task 8      | `tests/support/opt-ir/checked-mir-fixtures.ts`           |
| `checkedOptIrHandoffForTest`                         | Task 8      | `tests/support/opt-ir/opt-ir-handoff-fixtures.ts`        |
| `targetOptimizationSurfaceForTest`                   | Task 8      | `tests/support/opt-ir/target-optimization-fakes.ts`      |
| `constructOptIrInputForTest`                         | Task 11     | `tests/support/opt-ir/internal-construction-fixtures.ts` |
| `checkedFactPacketEntryForTest`                      | Task 13     | `tests/support/opt-ir/fact-import-fixtures.ts`           |
| `optIrFactSetForTest`                                | Task 14     | `tests/support/opt-ir/fact-index-fixtures.ts`            |
| `optIrPathCertificateForTest`                        | Task 15     | `tests/support/opt-ir/path-certificate-fixtures.ts`      |
| `optIrConstructionFixtureForTest`                    | Task 22     | `tests/support/opt-ir/construction-fixtures.ts`          |
| `validConstructOptIrInputForTest`                    | Task 22     | `tests/support/opt-ir/construction-fixtures.ts`          |
| `validConstructOptIrInputWithReachableBlocksForTest` | Task 22     | `tests/support/opt-ir/construction-fixtures.ts`          |
| `validConstructOptIrInputWithShuffledTablesForTest`  | Task 22     | `tests/support/opt-ir/construction-fixtures.ts`          |
| `optIrPassContractForTest`                           | Task 23     | `tests/support/opt-ir/pass-contract-fixtures.ts`         |
| `subjectRemapTableForTest`                           | Task 24     | `tests/support/opt-ir/fact-preservation-fixtures.ts`     |
| `programWithStaticSwitchForTest`                     | Task 26     | `tests/support/opt-ir/dataflow-fixtures.ts`              |
| `programWithOrderSensitiveOperationsForTest`         | Task 26     | `tests/support/opt-ir/dataflow-fixtures.ts`              |
| `optIrAnalysisFixtureForTest`                        | Task 27     | `tests/support/opt-ir/analysis-fixtures.ts`              |
| `optIrMemorySsaFixtureForTest`                       | Task 28     | `tests/support/opt-ir/memory-ssa-fixtures.ts`            |
| `optIrEGraphRegionForTest`                           | Task 36     | `tests/support/opt-ir/egraph-fixtures.ts`                |
| `optIrVectorLoopForTest`                             | Task 40     | `tests/support/opt-ir/vector-fixtures.ts`                |
| `optIrProgramStableKeyForTest`                       | Task 43     | `tests/support/opt-ir/property-generators.ts`            |
| `inputFromProgramForTest`                            | Task 43     | `tests/support/opt-ir/property-generators.ts`            |
| `shuffleTablesForTest`                               | Task 43     | `tests/support/opt-ir/property-generators.ts`            |
| `optIrResultStableKeyForTest`                        | Task 43     | `tests/support/opt-ir/property-generators.ts`            |

## Exact Contract Tables

These contracts are part of the plan, not suggestions. If an implementation task changes one of these names or shapes, that task must update every downstream reference in this plan and the task-owned tests in the same commit.

### Public API Contract

Task 11 creates internal construction types only. Task 22 creates public construction entrypoints after construction behavior exists. Task 41 adds optimization entrypoints after the optimizer pipeline exists.

```ts
export interface ConstructOptIrInput;
export interface AuthenticatedLayoutFactProgram;
export type { CheckedOptIrHandoff } from "../proof-check/model/opt-ir-handoff";
export type ConstructOptIrResult;
export interface OptimizeOptIrInput;
export type OptimizeOptIrResult;
export interface OptIrConstructionOptions;
export interface OptIrOptimizationPolicy;
export interface OptimizedOptIrProgram;

export function constructOptIr(input: ConstructOptIrInput): ConstructOptIrResult;
export function optimizeOptIr(input: OptimizeOptIrInput): OptimizeOptIrResult;
export function buildOptimizedOptIr(
  input: ConstructOptIrInput & { readonly policy: OptIrOptimizationPolicy },
): OptimizeOptIrResult;
```

`ConstructOptIrInput` has this authority shape:

```ts
export interface ConstructOptIrInput {
  readonly handoff: CheckedOptIrHandoff;
  readonly layoutFacts: AuthenticatedLayoutFactProgram;
  readonly target: OptIrTargetSurface;
  readonly options?: OptIrConstructionOptions;
}
```

### Operation Schema Contract

Task 5 is executed through the atomic split matrix below. The operation-kind and rule ID unions are exact:

```ts
export type OptIrOperationKind =
  | "constant"
  | "integerUnary"
  | "integerBinary"
  | "integerCompare"
  | "booleanNot"
  | "booleanBinary"
  | "aggregateConstruct"
  | "aggregateExtract"
  | "aggregateInsert"
  | "layoutOffset"
  | "layoutByteRange"
  | "layoutEndianDecode"
  | "memoryLoad"
  | "memoryStore"
  | "sourceCall"
  | "runtimeCall"
  | "platformCall"
  | "intrinsicCall"
  | "vectorLoad"
  | "vectorStore"
  | "vectorMaskedLoad"
  | "vectorMaskedStore"
  | "vectorShuffle"
  | "vectorCompare"
  | "vectorSelect"
  | "vectorByteSwap"
  | "proofErasedMarker";

export type OptIrTypeRuleId =
  | "constant-has-declared-type"
  | "same-integer-width"
  | "integer-compare-to-bool"
  | "same-boolean"
  | "aggregate-field-type"
  | "layout-value"
  | "memory-load-result"
  | "memory-store-unit"
  | "call-signature-results"
  | "vector-lane-result"
  | "proof-erased-no-result";

export type OptIrEffectRuleId =
  | "pure"
  | "read-region-version"
  | "write-region-version"
  | "ordered-region-tokens"
  | "call-summary-effects"
  | "terminal-effects"
  | "proof-erased-no-effect";
```

### Fact Import Contract

Task 13 creates a closed registry with this exact matrix.

```text
kind               subject kinds                         required dependencies                         typed answers
ownership          place,value                           proofMirPlace/proofMirValue, coreCertificate owns
noalias            place,value,edge                      both refs, coreCertificate                    mustNotAlias
fieldDisjointness  place                                 layoutFact, proofMirPlace                     fieldsDisjoint
erasure            place,value                           proofMirPlace/proofMirValue, coreCertificate erasureOf
validatedBuffer    place,value,edge,packetSource          proofMirEdge, layoutFact, coreCertificate     provesInBounds, provesImpossible
packetSource       packetSource                          proofMirPlace pair, coreCertificate           provesInBounds
privateState       privateState                          privateGeneration, coreCertificate            privateStateGeneration
platformEffect     call,authority                        authorityEntry, coreCertificate               callEffects, volatilityOf
capabilityFlow     call,place,authority                  authorityEntry, proofMirCall                  capabilityFlow
terminalClosure    terminal                              semanticsCertificate                         terminalBehavior, provesImpossible
exitClosure        function,block,edge                   coreCertificate, proofMirEdge                 terminalBehavior, provesImpossible
layoutAbi          layout                                layoutFact                                    layoutOf, endianOfLayoutAccess, abiShape
origin             mirOrigin                             proofMirFact or origin-map entry              provenanceContributor
```

Every schema family adds these exact negative tests:

```ts
test("<kind> import rejects wrong subject shape", () => {});
test("<kind> import rejects missing required dependency", () => {});
test("<kind> import rejects mismatched certificate or authority", () => {});
```

### Diagnostic Codes Required By Contract Tasks

Task 1 creates the initial code set; later tasks append only codes named by their acceptance criteria.

```ts
export const OPT_IR_DIAGNOSTIC_CODES = [
  "OPT_IR_INPUT_CONTRACT_INVALID",
  "OPT_IR_TARGET_MISMATCH",
  "OPT_IR_LAYOUT_AUTHORITY_MISMATCH",
  "OPT_IR_MISSING_PATH_CERTIFICATE",
  "OPT_IR_MISSING_SEMANTIC_INLINE_POLICY",
  "OPT_IR_FACT_IMPORT_SCHEMA_MISMATCH",
  "OPT_IR_FACT_IMPORT_MISSING_DEPENDENCY",
  "OPT_IR_FACT_IMPORT_MISSING_PATH_DEPENDENCY",
  "OPT_IR_FACT_IMPORT_AUTHORITY_MISMATCH",
  "OPT_IR_UNSUPPORTED_CHECKED_MIR_OPERATION",
  "OPT_IR_CFG_EDGE_MISSING",
  "OPT_IR_BLOCK_ARGUMENT_MISMATCH",
  "OPT_IR_DUPLICATE_VALUE_DEFINITION",
  "OPT_IR_DOMINANCE_VIOLATION",
  "OPT_IR_MISSING_BOUNDS_AUTHORITY",
  "OPT_IR_STALE_RUNTIME_GUARD",
  "OPT_IR_EFFECT_TOKEN_INCOMPLETE",
  "OPT_IR_OPERATION_METADATA_MISMATCH",
  "OPT_IR_FACT_PRESERVATION_INVALID",
  "OPT_IR_REWRITE_LEGALITY_INVALID",
] as const;
```

### Pass Schedule Contract

Task 23 creates this checked data. Pass implementation tasks register implementations but do not reorder it.

```text
0 construction-cleanup-fixpoint
1 mandatory-semantic-inlining
2 post-mandatory-cleanup-fixpoint
3 scope-expansion-fixpoint
  3.0 whole-program-inlining
  3.1 whole-program-specialization
  3.2 sccp-cleanup
4 scalar-simplification-fixpoint
  4.0 constant-folding
  4.1 sccp
  4.2 dce
  4.3 gvn
  4.4 copy-propagation
  4.5 cfg-simplification
5 memory-region-optimization
  5.0 memory-ssa
  5.1 load-store-forwarding
  5.2 dead-store-elimination
  5.3 scalar-replacement
  5.4 stack-promotion
  5.5 licm
6 wrela-fact-rounds-fixpoint
7 fact-gated-egraph
8 vectorization
  8.0 vector-idiom-prep
  8.1 slp-vectorization
  8.2 certified-loop-vectorization
  8.3 vector-cleanup
9 final-cleanup-fixpoint
10 final-verification
```

The invalidation/recompute matrix is exact for Task 23 tests:

```text
mutation kind           invalidates                         must recompute before
cfg-edit                dominance,loop-tree,liveness,sccp   verifier,sccp,licm,vectorization,path-certificates
operation-replacement   value-numbering,liveness,sccp       gvn,dce,sccp,egraph
memory-edit             memory-ssa,alias,liveness           memory-optimization,egraph,vectorization
call-edit               call-graph,scc,liveness,effects     inlining,specialization,effect-verifier
region-edit             alias,memory-ssa,effects            memory-optimization,egraph,vectorization
fact-edit               fact-index,path-certificates         every fact-gated pass and final verifier
```

### Rewrite Legality Contract

Task 24 creates these exact records; transform tasks populate them.

```ts
export interface RewriteLegalityRecord {
  readonly recordId: RewriteLegalityRecordId;
  readonly passId: OptimizationPassId;
  readonly ruleId?: OptimizationRewriteRuleId;
  readonly original: OptIrRewriteRegionId;
  readonly replacement: OptIrRewriteRegionId;
  readonly invariant: RewriteInvariant;
  readonly factsUsed: readonly OptIrFactId[];
  readonly cfgEdits: readonly OptIrCfgEditId[];
  readonly memoryEdits: readonly OptIrMemoryEditId[];
  readonly callEdits: readonly OptIrCallEditId[];
  readonly subjectRemap?: SubjectRemapTableId;
  readonly origin: OptIrOriginId;
}

export type OptIrMemoryEdit =
  | {
      readonly kind: "regionVersionSubstitution";
      readonly oldVersion: OptIrMemoryVersionId;
      readonly newVersion: OptIrMemoryVersionId;
    }
  | {
      readonly kind: "loadForward";
      readonly oldLoad: OptIrOperationId;
      readonly replacementValue: OptIrValueId;
    }
  | { readonly kind: "deadStore"; readonly removedStore: OptIrOperationId }
  | {
      readonly kind: "scalarReplacement";
      readonly oldRegion: OptIrRegionId;
      readonly replacementValues: readonly OptIrValueId[];
    };

export type OptIrCallEdit =
  | {
      readonly kind: "inline";
      readonly oldCall: OptIrCallId;
      readonly clonedBlocks: readonly OptIrBlockId[];
    }
  | {
      readonly kind: "specialize";
      readonly oldCall: OptIrCallId;
      readonly specializedFunction: OptIrFunctionId;
    }
  | {
      readonly kind: "wrapperCollapse";
      readonly oldCall: OptIrCallId;
      readonly replacementCall: OptIrCallId;
    };
```

### E-Graph Rule Contract

Task 37 adds one rule-family row at a time.

```text
rule id                    pattern                                  replacement                       gate                                 invariant
endian-load-folding         byte loads + shifts + masks              memoryLoad endian access          bounds+layout+effect                 layoutEndianEquivalence
bounds-branch-deletion      range check branch success path          jump to success edge              bounds+path-certificate              boundsDominanceElimination
move-copy-erasure           wrapper move/copy                        value alias or no operation       ownership+alias+erasure+effect       ownershipRuntimeIdentity
layout-arithmetic-folding   layout offset arithmetic                 canonical layoutByteRange         layout                               layoutEndianEquivalence
field-disjoint-memory-cse   reload after disjoint store              previous load value               alias+effect                         noaliasMemoryEquivalence
parser-state-collapse       validate/read/derived-field chain        direct load/switch                bounds+layout+path-certificate        boundsDominanceElimination+layoutEndianEquivalence
platform-wrapper-collapse   source wrapper call                      primitive platform/runtime call   effect+abi+terminal+capabilityFlow   effectBoundaryEquivalence+abiWrapperEquivalence
vector-idiom-prep           adjacent scalar loads/decodes/compares   vector-prep marker or vector op   bounds+alias+effect+layout           vectorLaneEquivalence
```

Default production e-graph fuel:

```text
maxENodes: 600
maxEClasses: 240
maxIterations: 8
maxRuleApplications: 1200
maxExtractionCandidates: 32
uncertaintyPenalty: 1000
```

### Vectorization Contract

Task 39 owns SLP records and Task 40 owns loop records.

```ts
export type OptIrVectorTailPlan =
  | { readonly kind: "exactMultiple"; readonly factId: OptIrFactId }
  | {
      readonly kind: "masked";
      readonly maskValue: OptIrValueId;
      readonly passthroughValues: readonly OptIrValueId[];
    }
  | {
      readonly kind: "scalarEpilogue";
      readonly epilogueBlock: OptIrBlockId;
      readonly pathCertificateId: OptIrPathCertificateId;
    };

export interface OptIrVectorPolicy {
  readonly legalLaneTypes: readonly OptIrScalarType[];
  readonly legalLaneCounts: readonly number[];
  readonly preferredByteWidths: readonly number[];
  readonly maxEstimatedLiveVectorValues: number;
  readonly allowUnalignedPacketLoads: boolean;
  readonly allowEndianSwapVectorIdioms: boolean;
}
```

Production default vector policy:

```text
legalLaneTypes: u8,u16,u32,u64,i8,i16,i32,i64
legalLaneCounts: 2,4,8,16
preferredByteWidths: 16
maxEstimatedLiveVectorValues: 12
allowUnalignedPacketLoads: target.vector.supportsUnalignedPacketLoads
allowEndianSwapVectorIdioms: target.vector.supportsEndianSwapVectorIdioms
```

## Atomic Split Matrix For Large Compiler Areas

The rows below are the dispatchable units for the areas reviewers identified as too large. Do not dispatch the coarse task heading alone; dispatch these atomic rows. Each row still follows the normal protocol: failing test, expected failure, minimal implementation, passing narrow command, commit.

| Subtask                                                            | Depends On     | Owns                                                                                                                                                                               | Required Test Command                                                                     |
| ------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| 5A Operation kind/type/effect/interpreter ID unions                | 2,3,4          | `src/opt-ir/operation-kinds.ts`, `tests/unit/opt-ir/operation-schema.test.ts`                                                                                                      | `bun test ./tests/unit/opt-ir/operation-schema.test.ts -t "operation schema ids"`         |
| 5B Schema registry for constants/scalars/aggregates/layout         | 5A             | `src/opt-ir/operation-schema-core.ts`, `tests/unit/opt-ir/operation-schema-core.test.ts`                                                                                           | `bun test ./tests/unit/opt-ir/operation-schema-core.test.ts`                              |
| 5C Memory/call/vector/proof-erased schemas                         | 5A             | `src/opt-ir/operation-schema-effectful.ts`, `tests/unit/opt-ir/operation-schema-effectful.test.ts`                                                                                 | `bun test ./tests/unit/opt-ir/operation-schema-effectful.test.ts`                         |
| 5D Metadata derivation tables                                      | 5B,5C          | `src/opt-ir/operation-semantics.ts`, `src/opt-ir/operation-effects.ts`, `tests/unit/opt-ir/operation-semantics.test.ts`                                                            | `bun test ./tests/unit/opt-ir/operation-semantics.test.ts`                                |
| 5E Operation constructors and memory access bounds authority       | 5D             | `src/opt-ir/operation-schema.ts`, `src/opt-ir/operations.ts`, `tests/unit/opt-ir/operation-schema.test.ts`                                                                         | `bun test ./tests/unit/opt-ir/operation-schema.test.ts -t "constructors"`                 |
| 14A Authoritative fact-set storage and lineage                     | 13             | `src/opt-ir/facts/fact-index.ts`, `src/opt-ir/facts/fact-lineage.ts`, `tests/unit/opt-ir/fact-index.test.ts`                                                                       | `bun test ./tests/unit/opt-ir/fact-index.test.ts -t "fact set"`                           |
| 14B Bounds/layout/endian/ABI query indexes                         | 14A            | `src/opt-ir/facts/fact-query.ts`, `src/opt-ir/facts/bounds-facts.ts`, `src/opt-ir/facts/layout-facts.ts`, `src/opt-ir/facts/abi-facts.ts`, `tests/unit/opt-ir/fact-index.test.ts`  | `bun test ./tests/unit/opt-ir/fact-index.test.ts -t "layout and bounds"`                  |
| 14C Ownership/alias/field-disjointness query indexes               | 14A            | `src/opt-ir/facts/alias-facts.ts`, `tests/unit/opt-ir/fact-index.test.ts`                                                                                                          | `bun test ./tests/unit/opt-ir/fact-index.test.ts -t "alias and ownership"`                |
| 14D Effect/terminal/capability/private-state/erasure query indexes | 14A            | `src/opt-ir/facts/effect-facts.ts`, `src/opt-ir/facts/capability-facts.ts`, `src/opt-ir/facts/private-state-facts.ts`, `tests/unit/opt-ir/fact-index.test.ts`                      | `bun test ./tests/unit/opt-ir/fact-index.test.ts -t "effect and erasure"`                 |
| 23A Pass contract types and invariant schema shell                 | 6,14           | `src/opt-ir/passes/pass-contract.ts`, `tests/unit/opt-ir/pass-contract.test.ts`                                                                                                    | `bun test ./tests/unit/opt-ir/pass-contract.test.ts -t "contract shape"`                  |
| 23B Fixed pass order and invalidation matrix                       | 23A            | `src/opt-ir/policy/pass-order-policy.ts`, `tests/unit/opt-ir/pass-schedule-consistency.test.ts`                                                                                    | `bun test ./tests/unit/opt-ir/pass-schedule-consistency.test.ts -t "production schedule"` |
| 23C Schedule consistency verifier                                  | 23B            | `src/opt-ir/verify/pass-schedule-consistency.ts`, `tests/unit/opt-ir/pass-schedule-consistency.test.ts`                                                                            | `bun test ./tests/unit/opt-ir/pass-schedule-consistency.test.ts`                          |
| 24A Subject remapping tables                                       | 15,23          | `src/opt-ir/facts/subject-remapping.ts`, `tests/unit/opt-ir/fact-preservation.test.ts`                                                                                             | `bun test ./tests/unit/opt-ir/fact-preservation.test.ts -t "subject remap"`               |
| 24B Fact preservation engine                                       | 24A            | `src/opt-ir/facts/fact-preservation.ts`, `src/opt-ir/verify/fact-verifier.ts`, `tests/unit/opt-ir/fact-preservation.test.ts`                                                       | `bun test ./tests/unit/opt-ir/fact-preservation.test.ts -t "preservation"`                |
| 24C Rewrite legality records and verifier                          | 24B            | `src/opt-ir/verify/rewrite-legality.ts`, `src/opt-ir/verify/pass-invariant-schema.ts`, `tests/unit/opt-ir/fact-preservation.test.ts`                                               | `bun test ./tests/unit/opt-ir/fact-preservation.test.ts -t "rewrite legality"`            |
| 25A DCE and pure unused operation removal                          | 18,24          | `src/opt-ir/passes/dce.ts`, `tests/unit/opt-ir/cleanup.test.ts`                                                                                                                    | `bun test ./tests/unit/opt-ir/cleanup.test.ts -t "dce"`                                   |
| 25B Copy propagation and block-argument simplification             | 25A            | `src/opt-ir/passes/copy-propagation.ts`, `tests/unit/opt-ir/cleanup.test.ts`                                                                                                       | `bun test ./tests/unit/opt-ir/cleanup.test.ts -t "copy propagation"`                      |
| 25C CFG simplification and trivial block merging                   | 25B            | `src/opt-ir/passes/cfg-simplification.ts`, `tests/unit/opt-ir/cleanup.test.ts`                                                                                                     | `bun test ./tests/unit/opt-ir/cleanup.test.ts -t "cfg simplification"`                    |
| 25D Constant folding and compare simplification                    | 25C            | `src/opt-ir/passes/scalar-simplification.ts`, `tests/unit/opt-ir/scalar-simplification.test.ts`                                                                                    | `bun test ./tests/unit/opt-ir/scalar-simplification.test.ts`                              |
| 27A Dominance and liveness                                         | 3,4,6          | `src/opt-ir/analyses/dominance.ts`, `src/opt-ir/analyses/liveness.ts`, `tests/unit/opt-ir/analyses.test.ts`                                                                        | `bun test ./tests/unit/opt-ir/analyses.test.ts -t "dominance and liveness"`               |
| 27B Loop tree                                                      | 27A            | `src/opt-ir/analyses/loop-tree.ts`, `tests/unit/opt-ir/analyses.test.ts`                                                                                                           | `bun test ./tests/unit/opt-ir/analyses.test.ts -t "loop tree"`                            |
| 27C Call graph and SCC                                             | 27A            | `src/opt-ir/analyses/call-graph.ts`, `src/opt-ir/analyses/scc.ts`, `tests/unit/opt-ir/analyses.test.ts`                                                                            | `bun test ./tests/unit/opt-ir/analyses.test.ts -t "call graph"`                           |
| 27D Escape and alias analysis                                      | 27A            | `src/opt-ir/analyses/escape-analysis.ts`, `src/opt-ir/analyses/alias-analysis.ts`, `tests/unit/opt-ir/analyses.test.ts`                                                            | `bun test ./tests/unit/opt-ir/analyses.test.ts -t "escape and alias"`                     |
| 33A Residual-equivalence invariant checker                         | 24,31,32       | `src/opt-ir/passes/specialization/residual-invariant.ts`, `tests/unit/opt-ir/whole-program-specialization.residual.test.ts`                                                        | `bun test ./tests/unit/opt-ir/whole-program-specialization.residual.test.ts`              |
| 33B Static evaluation and branch/switch driving                    | 33A            | `src/opt-ir/passes/specialization/static-driving.ts`, `tests/unit/opt-ir/whole-program-specialization.static-driving.test.ts`                                                      | `bun test ./tests/unit/opt-ir/whole-program-specialization.static-driving.test.ts`        |
| 33C Clone signatures and clone dedup                               | 33B            | `src/opt-ir/passes/specialization/clone-signature.ts`, `tests/unit/opt-ir/whole-program-specialization.clone-signature.test.ts`                                                    | `bun test ./tests/unit/opt-ir/whole-program-specialization.clone-signature.test.ts`       |
| 33D Bounded unrolling, budgets, and boundary refusals              | 33C            | `src/opt-ir/passes/specialization/bounded-unroll.ts`, `src/opt-ir/passes/whole-program-specialization.ts`, `tests/unit/opt-ir/whole-program-specialization.test.ts`                | `bun test ./tests/unit/opt-ir/whole-program-specialization.test.ts`                       |
| 35A Move/copy and wrapper elision                                  | 19,20,24,25,34 | `src/opt-ir/passes/wrela-optimizations/move-copy-wrapper-elision.ts`, `tests/unit/opt-ir/wrela-move-copy-wrapper.test.ts`                                                          | `bun test ./tests/unit/opt-ir/wrela-move-copy-wrapper.test.ts`                            |
| 35B Bounds-check elimination and zero-copy reads                   | 35A            | `src/opt-ir/passes/wrela-optimizations/bounds-zero-copy.ts`, `tests/unit/opt-ir/wrela-bounds-zero-copy.test.ts`                                                                    | `bun test ./tests/unit/opt-ir/wrela-bounds-zero-copy.test.ts`                             |
| 35C Endian folding and parser collapse                             | 35B            | `src/opt-ir/passes/wrela-optimizations/endian-parser-collapse.ts`, `tests/unit/opt-ir/wrela-endian-parser.test.ts`                                                                 | `bun test ./tests/unit/opt-ir/wrela-endian-parser.test.ts`                                |
| 35D Terminal cleanup and platform call specialization              | 35C            | `src/opt-ir/passes/wrela-optimizations/terminal-platform-specialization.ts`, `src/opt-ir/passes/wrela-optimizations/index.ts`, `tests/unit/opt-ir/wrela-terminal-platform.test.ts` | `bun test ./tests/unit/opt-ir/wrela-terminal-platform.test.ts`                            |
| 37A Rewrite rule type system and gates                             | 36             | `src/opt-ir/egraph/rewrite-rule.ts`, `src/opt-ir/egraph/fact-gated-rule.ts`, `tests/unit/opt-ir/fact-gated-egraph.test.ts`                                                         | `bun test ./tests/unit/opt-ir/fact-gated-egraph.test.ts -t "rule gates"`                  |
| 37B Endian/layout/bounds rules                                     | 37A            | `src/opt-ir/egraph/rule-catalog.ts`, `tests/unit/opt-ir/egraph-rule-soundness.test.ts`                                                                                             | `bun test ./tests/unit/opt-ir/egraph-rule-soundness.test.ts -t "endian layout bounds"`    |
| 37C Ownership/memory/parser rules                                  | 37B            | `src/opt-ir/egraph/rule-catalog.ts`, `tests/unit/opt-ir/egraph-rule-soundness.test.ts`                                                                                             | `bun test ./tests/unit/opt-ir/egraph-rule-soundness.test.ts -t "ownership memory parser"` |
| 37D Platform/vector-prep rules                                     | 37C            | `src/opt-ir/egraph/rule-catalog.ts`, `tests/unit/opt-ir/egraph-rule-soundness.test.ts`                                                                                             | `bun test ./tests/unit/opt-ir/egraph-rule-soundness.test.ts -t "platform vector"`         |
| 37E Saturation and deterministic extraction                        | 37D            | `src/opt-ir/egraph/saturation.ts`, `src/opt-ir/egraph/extraction.ts`, `src/opt-ir/policy/egraph-extraction-policy.ts`, `tests/unit/opt-ir/fact-gated-egraph.test.ts`               | `bun test ./tests/unit/opt-ir/fact-gated-egraph.test.ts`                                  |
| 39A Vector operation verifier and policy                           | 5,6,23,35      | `src/opt-ir/policy/vector-policy.ts`, `tests/unit/opt-ir/vector-types.test.ts`                                                                                                     | `bun test ./tests/unit/opt-ir/vector-types.test.ts -t "vector policy"`                    |
| 39B SLP pack discovery                                             | 39A            | `src/opt-ir/passes/slp-vectorization.ts`, `tests/unit/opt-ir/slp-vectorization.test.ts`                                                                                            | `bun test ./tests/unit/opt-ir/slp-vectorization.test.ts -t "pack discovery"`              |
| 39C SLP legality and rewrite                                       | 39B            | `src/opt-ir/passes/slp-vectorization.ts`, `tests/unit/opt-ir/slp-vectorization.test.ts`                                                                                            | `bun test ./tests/unit/opt-ir/slp-vectorization.test.ts -t "legality"`                    |
| 39D Vector cleanup                                                 | 39C            | `src/opt-ir/passes/vectorization-cleanup.ts`, `tests/unit/opt-ir/slp-vectorization.test.ts`                                                                                        | `bun test ./tests/unit/opt-ir/slp-vectorization.test.ts`                                  |
| 40A Loop-vectorization shape recognizer                            | 27,28,39,35    | `src/opt-ir/passes/loop-vectorization/loop-shape.ts`, `tests/unit/opt-ir/loop-vectorization-shape.test.ts`                                                                         | `bun test ./tests/unit/opt-ir/loop-vectorization-shape.test.ts`                           |
| 40B Lane bounds, memory independence, and effect legality          | 40A            | `src/opt-ir/passes/loop-vectorization/loop-legality.ts`, `tests/unit/opt-ir/loop-vectorization-legality.test.ts`                                                                   | `bun test ./tests/unit/opt-ir/loop-vectorization-legality.test.ts`                        |
| 40C Tail plans and vector loop rewrite                             | 40B            | `src/opt-ir/passes/loop-vectorization/loop-rewrite.ts`, `src/opt-ir/passes/loop-vectorization/index.ts`, `tests/unit/opt-ir/loop-vectorization.test.ts`                            | `bun test ./tests/unit/opt-ir/loop-vectorization.test.ts`                                 |

## Parallel Execution Model

Tasks in the same level are an antichain after their dependencies land.
For coarse tasks listed in the atomic split matrix, the scheduler dispatches the subtask rows (`5A`, `5B`, and so on) rather than the coarse heading. The coarse heading remains as an ownership group for the file map and high-level acceptance criteria.

```text
Level 0:
  Task 0: OptIR import-boundary policy
  Task 1: OptIR IDs, diagnostics, deterministic helpers
  Task 9: Proof-check OptIR handoff model

Level 1:
  Task 2 after Task 1: OptIR scalar/vector/value model
  Task 10 after Tasks 1 and 9: Proof-check OptIR handoff production and exports

Level 2:
  Task 3 after Tasks 1 and 2: Program tables, CFG edges, deterministic IDs
  Task 4 after Tasks 1 and 2: Regions, effects, and provenance model

Level 3:
  Task 5 after Tasks 2, 3, and 4: Closed operation schemas and constructors
  Task 8 after Tasks 2, 3, 4, and 10: OptIR fakes and fixtures
  Task 11 after Tasks 2, 3, 4, and 10: Internal construction API and target surface

Level 4:
  Task 6 after Task 5: Structural, SSA, region, and schema verifiers
  Task 7 after Task 5: Interpreter and differential harness
  Task 12 after Tasks 8 and 11: Boundary validation
  Task 13 after Tasks 8 and 11: Fact import schemas

Level 5:
  Task 14 after Task 13: Fact indexes, queries, and lineage
  Task 27 after Tasks 3, 4, and 6: Dominance, loops, call graph, SCC, liveness, escape, alias

Level 6:
  Task 15 after Tasks 3, 12, and 14: Path certificates and edge implications
  Task 16 after Tasks 4, 12, and 14: Region builder and target-effect normalization
  Task 23 after Tasks 6 and 14: Pass contracts and schedule policy

Level 7:
  Task 17 after Tasks 6, 15, and 16: Function skeleton and block-argument lowering
  Task 24 after Tasks 15 and 23: Fact preservation, subject remapping, and rewrite legality

Level 8:
  Task 18 after Tasks 5, 14, 16, and 17: Canonical constants/scalars/layout/control lowering

Level 9:
  Task 19 after Tasks 14, 15, 18, and 24: Validated-buffer read lowering
  Task 20 after Tasks 14, 16, and 18: Source/runtime/platform call lowering
  Task 25 after Tasks 18 and 24: Cleanup and scalar simplification cluster

Level 10:
  Task 21 after Tasks 14, 18, 19, 20, and 24: Proof erasure and construction cleanup
  Task 26 after Tasks 25 and 27: SCCP, range analysis, value numbering, and GVN
  Task 28 after Tasks 16, 20, 24, and 27: Memory SSA and effect-token indexes

Level 11:
  Task 22 after Tasks 6, 7, 12, 13, 14, 15, 16, 17, 18, 19, 20, and 21: Construction orchestration
  Task 29 after Tasks 20, 21, and 24: Mandatory semantic inlining
  Task 34 after Tasks 24, 25, and 28: Memory optimization cluster

Level 12:
  Task 30 after Tasks 23, 26, and 29: Scope-expansion budget and policy
  Task 35 after Tasks 19, 20, 24, 25, and 34: Wrela-specific optimizations

Level 13:
  Task 31 after Tasks 27, 29, and 30: Budgeted whole-program inlining
  Task 32 after Tasks 14, 26, and 30: Binding-time analysis
  Task 36 after Tasks 6, 7, 14, 23, 24, and 35: E-graph core and region selection
  Task 39 after Tasks 5, 6, 23, and 35: SLP vectorization and vector cleanup

Level 14:
  Task 33 after Tasks 24, 31, and 32: Whole-program specialization
  Task 37 after Task 36: Fact-gated e-graph rule catalog and extraction
  Task 40 after Tasks 27, 28, 39, and 35: Certified loop vectorization

Level 15:
  Task 38 after Tasks 7 and 37: E-graph translation validation and pass integration

Level 16:
  Task 41 after Tasks 22, 23, 25, 26, 29, 30, 31, 33, 34, 35, 38, 39, and 40: Optimizer orchestration and public exports

Level 17:
  Task 42 after Task 41: Integration demonstrations and optimization explanations
  Task 43 after Task 41: Determinism, property tests, policy recheck, and handoff verification
```

---

### Task 0: OptIR Import-Boundary Policy

**Description:** Add an OptIR dependency-boundary rule before implementation begins. Runtime `src/opt-ir/**` must not import frontend syntax, parser, HIR lowering internals, Proof MIR lowering/draft/canonicalization internals, target backends, filesystem/Bun APIs, scorecard artifacts, or benchmark data.

**Dependencies:** None.

**Files:**

- Modify: `scripts/check-policy.ts`
- Create: `tests/support/opt-ir/README.md`
- Test: `tests/unit/opt-ir/import-policy.test.ts`

**Acceptance Criteria:**

- `checkPolicyTextForTest` rejects forbidden imports from `src/opt-ir/**`.
- `src/opt-ir/**` is allowed to import public model/API files from proof-check, proof-mir model IDs, layout, mono IDs, runtime authority/catalog types, semantic IDs, target selection types, and shared diagnostics/source/fingerprint types.
- `src/opt-ir/**` rejects imports from scorecard, benchmark, frontend, parser, HIR lowerers, Proof MIR lower/draft/canonicalization internals, AArch64 lowering, linkers, PE/COFF, Bun, and filesystem modules.
- `tests/support/opt-ir/README.md` documents helper ownership and the no-early-barrel rule.

**Code Examples:**

```ts
test("opt-ir import policy rejects scorecard authority", () => {
  const violations = checkPolicyTextForTest({
    filePath: "src/opt-ir/policy/egraph-extraction-policy.ts",
    sourceText: 'import { baselineWeights } from "../scorecard/baselines";',
  });

  expect(violations.map((violation) => violation.message)).toContain(
    "src/opt-ir must not import frontend, parser, HIR lowering internals, Proof MIR construction internals, target backends, scorecard baselines, benchmark data, linker, PE-COFF, Bun, or filesystem modules.",
  );
});
```

```ts
test("opt-ir import policy allows checked MIR public model imports", () => {
  const violations = checkPolicyTextForTest({
    filePath: "src/opt-ir/public-api.ts",
    sourceText: 'import type { CheckedMirProgram } from "../proof-check/model/checked-mir";',
  });

  expect(violations).toEqual([]);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/import-policy.test.ts
PATH="$HOME/.bun/bin:$PATH" bun run policy:check
```

### Task 1: OptIR IDs, Diagnostics, And Deterministic Helpers

**Description:** Create branded OptIR IDs, diagnostic types, stable sorting helpers, and deterministic ID namespace utilities used by all later tasks.

**Dependencies:** None.

**Files:**

- Create: `src/opt-ir/ids.ts`
- Create: `src/opt-ir/diagnostics.ts`
- Create: `src/opt-ir/deterministic-sort.ts`
- Create: `src/opt-ir/deterministic-ids.ts`
- Create: `tests/support/opt-ir/ids-diagnostics-fakes.ts`
- Test: `tests/unit/opt-ir/ids.test.ts`
- Test: `tests/unit/opt-ir/diagnostics.test.ts`

**Acceptance Criteria:**

- Dense numeric ID constructors reject negative and non-integer values.
- String ID constructors reject empty strings.
- Diagnostics include severity, stable code, message template, structured arguments, owner key, root-cause key, stable detail, optional origin, optional function, and deterministic order key.
- Diagnostic sorting is deterministic by origin, function, code, owner, root cause, and stable detail.
- Deterministic pass-created ID namespaces include profile version, pass pipeline index, pass ID, function ID, rewrite region ID, creation role, and ordinal.

**Code Examples:**

```ts
test("optIrOperationId rejects negative values", () => {
  expect(() => optIrOperationId(-1)).toThrow("OptIrOperationId must be a non-negative integer");
});
```

```ts
const namespace = optIrPassIdNamespace({
  optimizationProfileVersion: "production-v1",
  pipelineIndex: 7,
  passId: optimizationPassId("bounds-check-elimination"),
  functionId: optIrFunctionId(4),
  rewriteRegionId: optIrRewriteRegionId(2),
  creationRole: "replacementOperation",
});

expect(optIrOperationIdFromNamespace(namespace, 3)).toBe(optIrOperationId(3));
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/ids.test.ts ./tests/unit/opt-ir/diagnostics.test.ts
```

### Task 2: OptIR Scalar, Vector, Constant, And Value Model

**Description:** Define the closed OptIR type vocabulary, value IDs, block parameters, constants, scalar/vector types, vector masks, and type equality helpers.

**Dependencies:** Task 1.

**Files:**

- Create: `src/opt-ir/types.ts`
- Create: `src/opt-ir/vector-types.ts`
- Create: `src/opt-ir/values.ts`
- Create: `src/opt-ir/constants.ts`
- Create: `tests/support/opt-ir/types-fakes.ts`
- Test: `tests/unit/opt-ir/model.test.ts`
- Test: `tests/unit/opt-ir/vector-types.test.ts`

**Acceptance Criteria:**

- Scalar types cover booleans, signed/unsigned integers by width, pointers/addresses as abstract OptIR values, `never`, and unit/zero-sized values.
- Vector types cover lane type, lane count, and mask lane count.
- Constants are interned by type, normalized value, and target data-model interpretation.
- `OptIrBlockParameter` records value ID, type, incoming role, and origin.
- Vector masked operation type rules can distinguish passthrough/inactive-lane behavior later.

**Code Examples:**

```ts
test("vector mask lane counts are part of type identity", () => {
  expect(optIrTypesEqual(vectorMaskType(4), vectorMaskType(8))).toBe(false);
  expect(optIrTypesEqual(vectorMaskType(4), vectorMaskType(4))).toBe(true);
});
```

```ts
const constant = optIrIntegerConstant({
  constantId: optIrConstantId(1),
  type: optIrUnsignedIntegerType(16),
  normalizedValue: 65535n,
});

expect(optIrConstantStableKey(constant)).toBe("u16:65535");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/model.test.ts ./tests/unit/opt-ir/vector-types.test.ts
```

### Task 3: Program Tables, CFG Edges, And Construction ID Allocation

**Description:** Define whole-image program/function/block tables, explicit CFG edge records, terminators, block arguments, and deterministic construction ID allocation.

**Dependencies:** Tasks 1 and 2.

**Files:**

- Create: `src/opt-ir/program.ts`
- Create: `src/opt-ir/cfg.ts`
- Create: `src/opt-ir/cfg-edits.ts`
- Create: `src/opt-ir/terminators.ts`
- Create: `tests/support/opt-ir/cfg-fakes.ts`
- Test: `tests/unit/opt-ir/cfg.test.ts`

**Acceptance Criteria:**

- `OptIrProgram` carries program ID, target ID, functions, regions, constants, call graph, and provenance.
- `OptIrFunction` carries mono instance ID, signature, blocks, edge table, entry block, optional external root, summary, and origin.
- CFG edges are first-class records with edge ID, from, to, ordinal, kind, arguments, optional condition/switch case, and origin.
- Terminators reference edge IDs for every successor.
- Construction ID allocator creates stable IDs from checked MIR traversal order and does not depend on map insertion order.

**Code Examples:**

```ts
test("branch terminator must name existing edge records", () => {
  const result = verifyCfgEdgesForTest({
    edges: [edgeForTest({ edgeId: optIrEdgeId(1), kind: "branchTrue" })],
    terminator: branchTerminatorForTest({
      trueEdge: optIrEdgeId(1),
      falseEdge: optIrEdgeId(2),
    }),
  });

  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "OPT_IR_CFG_EDGE_MISSING",
  );
});
```

```ts
const edit: OptIrCfgEdit = {
  kind: "branchFold",
  oldTerminator: optIrOperationId(9),
  survivingEdge: optIrEdgeId(4),
  removedEdges: [optIrEdgeId(5)],
};
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/cfg.test.ts
```

### Task 4: Regions, Effects, Calls, Layout Access, And Provenance Model

**Description:** Define explicit memory regions, alias classes, effect tokens, call target kinds, layout access records, and provenance records.

**Dependencies:** Tasks 1 and 2.

**Files:**

- Create: `src/opt-ir/regions.ts`
- Create: `src/opt-ir/effects.ts`
- Create: `src/opt-ir/calls.ts`
- Create: `src/opt-ir/layout-access.ts`
- Create: `src/opt-ir/provenance.ts`
- Create: `tests/support/opt-ir/region-effect-fakes.ts`
- Test: `tests/unit/opt-ir/regions-effects.test.ts`

**Acceptance Criteria:**

- Region kinds include `stackLocal`, `sourceAggregate`, `packetSource`, `validatedPayload`, `imageDevice`, `firmwareTable`, `runtimeMemory`, `constantData`, `globalData`, and `externalUnknown`.
- Region records include owner, lifetime, alias class, optional layout key, volatility, effect policy, and origin.
- Effect requirements model observe, mutate, private-state advance, terminal, read-version token, and ordered-effect token modes.
- Provenance records can preserve source, HIR, mono, Proof MIR, checked MIR, layout fact, checked fact, and synthetic contributor origins.
- Calls distinguish source, runtime, platform, intrinsic, and external-unknown targets.

**Code Examples:**

```ts
const packetRegion = optIrRegionForTest({
  kind: "packetSource",
  aliasClass: optIrAliasClassId(3),
  volatility: "nonVolatile",
});

expect(packetRegion.effects.ordering).toBe("readOnlyRegionVersion");
```

```ts
const origin: OptIrOrigin = {
  originId: optIrOriginId(9),
  proofMirNode: { kind: "statement", statementId: proofMirStatementId(4) },
  checkedFact: proofCheckPacketFactId(12),
  synthetic: {
    passId: optimizationPassId("bounds-check-elimination"),
    contributors: [optIrOriginId(3), optIrOriginId(4)],
  },
};
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/regions-effects.test.ts
```

### Task 5: Closed Operation Schemas And Metadata Derivation

**Description:** Implement closed operation variants, schema records, constructor validation, semantics derivation, effect derivation, and operation stable keys.

**Dependencies:** Tasks 2, 3, and 4.

**Files:**

- Create: `src/opt-ir/operations.ts`
- Create: `src/opt-ir/operation-schema.ts`
- Create: `src/opt-ir/operation-kinds.ts`
- Create: `src/opt-ir/operation-schema-core.ts`
- Create: `src/opt-ir/operation-schema-effectful.ts`
- Create: `src/opt-ir/operation-semantics.ts`
- Create: `src/opt-ir/operation-effects.ts`
- Create: `tests/support/opt-ir/operation-fakes.ts`
- Test: `tests/unit/opt-ir/operation-schema.test.ts`
- Test: `tests/unit/opt-ir/operation-schema-core.test.ts`
- Test: `tests/unit/opt-ir/operation-schema-effectful.test.ts`
- Test: `tests/unit/opt-ir/operation-semantics.test.ts`

**Acceptance Criteria:**

- Operation variants cover constants, scalar ops, aggregate ops, layout ops, memory ops, calls, vector ops, and proof-erased markers.
- Constructors derive result types, semantics, and effects from the schema. Callers cannot hand-author cached purity/effect flags.
- Schema records name operand schema, result schema, type rule, semantics rule, effect rule, interpreter rule, canonical form, and lowering requirement.
- Memory access records require region, byte offset, byte width, alignment, value type, endian marker, volatility, optional layout path, and bounds authority.
- Operation metadata recomputation is deterministic and independent of operation display names.

**Code Examples:**

```ts
test("memory access constructors require bounds authority", () => {
  const result = createOptIrLoadOperationForTest({
    region: optIrRegionId(1),
    byteOffset: optIrConstantId(0),
    byteWidth: 2n,
    alignment: 2n,
    valueType: optIrUnsignedIntegerType(16),
    endian: "big",
    volatility: "nonVolatile",
    boundsAuthority: undefined,
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "OPT_IR_MISSING_BOUNDS_AUTHORITY",
  );
});
```

```ts
const schema: OptIrOperationSchema = {
  operationKind: "integerAdd",
  operandSchema: [{ role: "left" }, { role: "right" }],
  resultSchema: [{ role: "sum" }],
  typeRule: optIrTypeRuleId("same-integer-width"),
  semanticsRule: optIrSemanticsRuleId("integer-add-wrapping"),
  effectRule: optIrEffectRuleId("pure"),
  interpreterRule: optIrInterpreterRuleId("integer-add"),
  canonicalForm: optIrCanonicalFormId("commutative-sorted-operands"),
  loweringRequirement: { kind: "core" },
};
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/operation-schema-core.test.ts ./tests/unit/opt-ir/operation-schema-effectful.test.ts ./tests/unit/opt-ir/operation-schema.test.ts ./tests/unit/opt-ir/operation-semantics.test.ts
```

### Task 6: Structural, SSA, Region, And Metadata Verifiers

**Description:** Add the baseline verifier suite for program structure, SSA definitions, dominance, region uses, operation schema metadata, and CFG edge consistency.

**Dependencies:** Task 5.

**Files:**

- Create: `src/opt-ir/verify/structural-verifier.ts`
- Create: `src/opt-ir/verify/ssa-verifier.ts`
- Create: `src/opt-ir/verify/region-verifier.ts`
- Create: `src/opt-ir/verify/operation-schema-verifier.ts`
- Create: `src/opt-ir/verify/operation-metadata-verifier.ts`
- Create: `src/opt-ir/verify/cfg-edit-verifier.ts`
- Create: `tests/support/opt-ir/verifier-fixtures.ts`
- Test: `tests/unit/opt-ir/verifier.test.ts`

**Acceptance Criteria:**

- Every executable value has exactly one defining operation or block parameter.
- Block-argument arity and types match predecessor edge arguments.
- Value, region-version, and effect-token uses are dominated by definitions.
- Every operation's cached metadata matches schema-derived metadata.
- Effectful operations consume and produce the required region tokens.
- CFG edits reference existing old/new edges and blocks.

**Code Examples:**

```ts
test("ssa verifier rejects duplicate value definitions", () => {
  const result = verifyOptIrProgramForTest(
    optIrProgramWithDuplicateValueDefinitionForTest(optIrValueId(8)),
  );

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "OPT_IR_DUPLICATE_VALUE_DEFINITION",
  );
});
```

```ts
const verifierResult = verifyOptIrProgram({
  program,
  facts,
  target,
  options: { checkDominance: true, recomputeOperationMetadata: true },
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/verifier.test.ts
```

### Task 7: OptIR Interpreter And Differential Harness

**Description:** Implement an interpreter for the closed core operation schema and deterministic differential-test harnesses for pure, memory, effect, and vector-ready slices.

**Dependencies:** Task 5.

**Files:**

- Create: `src/opt-ir/interpreter.ts`
- Create: `src/opt-ir/differential.ts`
- Create: `tests/support/opt-ir/opt-ir-interpreter.ts`
- Create: `tests/support/opt-ir/opt-ir-differential.ts`
- Test: `tests/unit/opt-ir/interpreter.test.ts`

**Acceptance Criteria:**

- Interpreter dispatches by schema interpreter rule, not operation names.
- Pure arithmetic covers overflow modes, traps, constants, compares, branches, and returns.
- Memory interpretation uses dependency-injected fake regions and fake effect traces.
- Non-interpreter-complete operations are rejected from translation validation with stable reasons.
- Differential harness compares value results plus memory/effect observations.

**Code Examples:**

```ts
test("interpreter evaluates wrapping integer add", () => {
  const result = interpretOptIrFunctionForTest({
    functionBody: optIrReturnOfAddForTest({ left: 255n, right: 1n, width: 8 }),
  });

  expect(result.kind).toBe("returned");
  expect(result.value).toEqual({ type: "u8", value: 0n });
});
```

```ts
const comparison = compareOptIrSlicesForTest({
  original: endianLoadSliceForTest("big"),
  replacement: byteLoadShiftMaskSliceForTest("big"),
  inputs: deterministicOptIrInputsForTest(),
});

expect(comparison.kind).toBe("equivalent");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/interpreter.test.ts
```

### Task 8: OptIR Fakes, Fixtures, And Test Support

**Description:** Add shared dependency-injected fakes and fixtures for checked MIR, the unified checked OptIR handoff, fact packets, target optimization surfaces, layout facts, and small OptIR programs.

**Dependencies:** Tasks 2, 3, 4, and 10.

**Files:**

- Create: `tests/support/opt-ir/checked-mir-fixtures.ts`
- Create: `tests/support/opt-ir/opt-ir-handoff-fixtures.ts`
- Create: `tests/support/opt-ir/fact-packet-fixtures.ts`
- Create: `tests/support/opt-ir/target-optimization-fakes.ts`
- Create: `tests/support/opt-ir/small-program-fixtures.ts`
- Test: `tests/unit/opt-ir/test-fixtures.test.ts`

**Acceptance Criteria:**

- Fixtures build minimal accepted checked MIR programs through public proof-check/proof-mir models where practical.
- Target fakes expose deterministic platform/runtime effect requirements, vector features, atomic/volatile policy, and intrinsic lowering entries.
- Fact packet fixtures can generate every checked packet kind with valid envelope fields.
- No helper uses mocks, spies, filesystem access, or Bun APIs.
- README helper ownership stays accurate.

**Code Examples:**

```ts
const handoff = checkedOptIrHandoffForTest({
  checkedMir: checkedMirProgramForOptIrTest({ functionCount: 1 }),
  includePathCertificates: true,
});
const target = targetOptimizationSurfaceForTest({ vectorEnabled: true });

expect(handoff.checkedMir.checkedFunctions.size).toBe(1);
expect(target.vector.enabled).toBe(true);
```

```ts
const catalog = targetOptimizationSurfaceForTest({
  platformEffects: [
    {
      targetKey: "get_memory_map",
      requirements: [
        effectRequirementForTest({
          region: "firmwareTable",
          mode: "observe",
          token: "orderedEffect",
        }),
      ],
    },
  ],
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/test-fixtures.test.ts
```

### Task 9: Proof-Check OptIR Handoff Model

**Description:** Add one fingerprinted upstream `CheckedOptIrHandoff` model required by OptIR. The handoff owns checked MIR plus the certificate bundle, packet-validation attestation, path certificate table, semantic-inline policy table, and a handoff fingerprint. OptIR never receives checked MIR and optimization evidence as separate authority objects.

**Dependencies:** None.

**Files:**

- Create: `src/proof-check/model/opt-ir-handoff.ts`
- Modify: `src/proof-check/model/function-summary.ts` only if the semantic-inline policy needs to reference existing summary fields by type
- Modify: `src/proof-check/validation/packet-certificate-types.ts` only if the attestation input shape must be shared with packet validation
- Test: `tests/unit/opt-ir/opt-ir-handoff.test.ts`

**Acceptance Criteria:**

- `CheckedOptIrHandoff` includes `checkedMir`, `certificates`, `packetValidation`, `pathCertificates`, `semanticInlinePolicies`, and `handoffFingerprint`.
- Packet-validation attestation names the checked fact packet, accepted functions, summaries, terminal graph, origin map, and authority fingerprints.
- Path certificate records expose required Proof MIR edges, required dominators, excluded edges, invalidation triggers, and origin.
- Semantic-inline policy records expose function instance ID, policy kind, mandatory reason, source `"checkedSummary"`, and summary certificate ID.
- The handoff fingerprint is deterministic and changes when any checked MIR, packet, certificate, path certificate, inline policy, attestation, or authority fingerprint changes.

**Code Examples:**

```ts
const handoff: CheckedOptIrHandoff = {
  checkedMir: checkedMirProgramForOptIrTest({ functionCount: 1 }),
  certificates: checkedCertificateBundleForTest(),
  packetValidation: checkedPacketValidationAttestationForTest({
    packetStableKey: "packet:validated",
  }),
  pathCertificates: checkedPathCertificateTableForTest([
    checkedPathCertificateForTest({
      certificateId: proofCheckPathCertificateId(1),
      requiredEdges: [proofMirControlEdgeId(4)],
      excludedEdges: [proofMirControlEdgeId(5)],
    }),
  ]),
  semanticInlinePolicies: checkedSemanticInlinePolicyTableForTest([
    checkedSemanticInlinePolicyForTest({
      kind: "mandatory",
      reason: "validationHelper",
    }),
  ]),
  handoffFingerprint: checkedOptIrHandoffFingerprintForTest("accepted:v1"),
};
```

```ts
expect(checkedOptIrHandoffStableKey(handoff)).toContain(
  "semanticInline:mandatory:validationHelper",
);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/opt-ir-handoff.test.ts
```

### Task 10: Proof-Check OptIR Handoff Production And Exports

**Description:** Wire the unified `CheckedOptIrHandoff` into proof-check orchestration so OptIR consumers get one atomically produced, fingerprinted authority object from a successful proof/resource check.

**Dependencies:** Tasks 1 and 9.

**Files:**

- Modify: `src/proof-check/proof-checker.ts`
- Modify: `src/proof-check/proof-check-phases.ts`
- Modify: `src/proof-check/index.ts`
- Test: `tests/unit/opt-ir/opt-ir-handoff.test.ts`

**Acceptance Criteria:**

- Successful `checkProofAndResources` results include one `checkedOptIrHandoff`.
- Error results do not expose partial handoff state as authority.
- Packet-validation attestation is produced only after packet validation succeeds.
- Semantic-inline policies are imported from checked summaries or generated shim classifications, not inferred from source syntax.
- The returned handoff fingerprint covers the embedded checked MIR and every evidence table, so downstream OptIR never compares two separately supplied authority objects.
- Existing proof-check public tests continue to pass.

**Code Examples:**

```ts
const result = checkProofAndResources(proofCheckInputForEvidenceTest());

expect(result.kind).toBe("ok");
if (result.kind === "ok") {
  expect(result.checkedOptIrHandoff.packetValidation.kind).toBe("accepted");
  expect(result.checkedOptIrHandoff.semanticInlinePolicies.entries()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ policy: expect.objectContaining({ kind: "mandatory" }) }),
    ]),
  );
}
```

```ts
expect(Object.keys(proofCheckPublicExportsForTest())).toContain("CheckedOptIrHandoff");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/opt-ir-handoff.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/public-api.test.ts ./tests/integration/proof-check/public-api.test.ts
```

### Task 11: Internal Construction API Types And Target Surface

**Description:** Define internal construction input/result types, authenticated layout wrapper, target optimization surface, and optimization policy shell. This task intentionally does not export public `constructOptIr` or `optimizeOptIr` entrypoints; public entrypoints appear only when construction behavior exists in Task 22 and optimization behavior exists in Task 41.

**Dependencies:** Tasks 2, 3, 4, and 10.

**Files:**

- Create: `src/opt-ir/internal-construction-api.ts`
- Create: `src/opt-ir/target-surface.ts`
- Create: `src/opt-ir/policy/optimization-profile.ts`
- Create: `tests/support/opt-ir/internal-construction-fixtures.ts`
- Test: `tests/unit/opt-ir/internal-construction-api.test.ts`

**Acceptance Criteria:**

- `InternalConstructOptIrInput` accepts one `CheckedOptIrHandoff`, authenticated layout facts, target surface, and options.
- `InternalConstructOptIrInput` has no separate checked-MIR or evidence fields.
- `OptimizeOptIrInput` accepts only program, facts, target, and policy. It does not accept a separate provenance map.
- No public construction or optimization entrypoint exists in this task.
- Target surface models data model, ABI, platform effects, runtime effects, vector features, atomic/volatile policy, and intrinsic lowering.
- No barrel export is added in this task.

**Code Examples:**

```ts
const input: InternalConstructOptIrInput = constructOptIrInputForTest({
  handoff: checkedOptIrHandoffForTest({ includePathCertificates: true }),
});

expect(input.handoff.handoffFingerprint.digestHex).toHaveLength(64);
expect("checkedMir" in input).toBe(false);
expect("evidence" in input).toBe(false);
```

```ts
const target: OptIrTargetSurface = {
  targetId,
  dataModel,
  abi,
  platformEffects,
  runtimeEffects,
  vector: {
    enabled: true,
    legalLaneTypes: [optIrUnsignedIntegerType(8)],
    legalLaneCounts: [8, 16],
    preferredByteWidths: [16],
    supportsUnalignedPacketLoads: true,
    supportsEndianSwapVectorIdioms: true,
  },
  atomicAndVolatile,
  intrinsicLowering,
};
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/internal-construction-api.test.ts
```

### Task 12: Boundary Validation

**Description:** Validate the unified checked OptIR handoff, authenticated layout facts, and target surface before construction begins.

**Dependencies:** Tasks 8 and 11.

**Files:**

- Create: `src/opt-ir/boundary-validation.ts`
- Test: `tests/unit/opt-ir/boundary-validation.test.ts`

**Acceptance Criteria:**

- Every reachable checked function has accepted entry, block-state, exit, and summary certificates.
- Packet-validation attestation matches the checked MIR packet, functions, summaries, terminal graph, origin map, and authority fingerprints.
- Every path-scoped fact resolves through `handoff.pathCertificates`.
- Every mandatory semantic-inline policy resolves through `handoff.semanticInlinePolicies`.
- The handoff fingerprint matches the embedded checked MIR, facts, certificates, path certificates, inline policies, attestation, and authority fingerprints.
- Layout and ABI facts referenced by packet entries exist in the authenticated layout program and match fingerprint.
- Target platform/runtime effect facts match selected catalog fingerprints.
- Missing required handoff artifacts return `kind: "error"` with OptIR diagnostics, not `unknown`.

**Code Examples:**

```ts
test("boundary validation rejects missing path certificate for path-scoped fact", () => {
  const result = validateOptIrConstructionBoundary(
    constructOptIrInputForTest({
      handoff: checkedOptIrHandoffForTest({
        includePathCertificates: false,
        checkedMir: checkedMirProgramForOptIrTest({
          facts: [validatedBufferPathScopedFactForTest()],
        }),
      }),
    }),
  );

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "OPT_IR_MISSING_PATH_CERTIFICATE",
  );
});
```

```ts
expect(validateOptIrConstructionBoundary(validInput).kind).toBe("ok");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/boundary-validation.test.ts
```

### Task 13: Fact Import Schema Registry

**Description:** Define closed import schemas for every checked packet kind and validate subjects, dependencies, certificate rules, Proof MIR lookup requirements, layout/catalog lookup requirements, and typed answer kinds.

**Dependencies:** Tasks 8 and 11.

**Files:**

- Create: `src/opt-ir/facts/fact-import-schema.ts`
- Create: `tests/support/opt-ir/fact-import-fixtures.ts`
- Test: `tests/unit/opt-ir/fact-import-schema.test.ts`

**Acceptance Criteria:**

- Schemas exist for `ownership`, `noalias`, `fieldDisjointness`, `erasure`, `validatedBuffer`, `packetSource`, `privateState`, `platformEffect`, `capabilityFlow`, `terminalClosure`, `exitClosure`, `layoutAbi`, and `origin`.
- Each schema validates subject shape, dependencies, certificate rule, Proof MIR lookup, and typed answer outputs.
- Wrong subject kind, missing dependency, wrong certificate rule, stale scope, authority fingerprint mismatch, missing Proof MIR node, and mismatched layout fingerprint all have negative tests.
- Optional precision returns `unknown` only later in fact queries; schemas must not create weaker yes-answers from partial envelopes.

**Code Examples:**

```ts
test("validatedBuffer schema requires path certificate dependency for path scope", () => {
  const result = validateCheckedFactImportSchemaForTest({
    entry: checkedFactPacketEntryForTest({
      kind: checkedFactKindId("validatedBuffer"),
      scope: { kind: "path", certificateId: proofCheckPathCertificateId(2) },
      dependencies: [],
    }),
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    "OPT_IR_FACT_IMPORT_MISSING_PATH_DEPENDENCY",
  );
});
```

```ts
const schema = checkedFactImportSchemaForKind(checkedFactKindId("layoutAbi"));
expect(schema.typedAnswers).toEqual(["layoutOf", "endianOfLayoutAccess", "abiShape"]);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-import-schema.test.ts
```

### Task 14: Fact Indexes, Typed Queries, And Lineage

**Description:** Import checked fact packet entries into authoritative `OptIrFactSet` records and typed query indexes with lineage, dependencies, explanations, and `unknown` answers where semantic sources are insufficient.

**Dependencies:** Task 13.

**Files:**

- Create: `src/opt-ir/facts/fact-index.ts`
- Create: `src/opt-ir/facts/fact-query.ts`
- Create: `src/opt-ir/facts/fact-lineage.ts`
- Create: `src/opt-ir/facts/bounds-facts.ts`
- Create: `src/opt-ir/facts/alias-facts.ts`
- Create: `src/opt-ir/facts/layout-facts.ts`
- Create: `src/opt-ir/facts/effect-facts.ts`
- Create: `src/opt-ir/facts/abi-facts.ts`
- Create: `src/opt-ir/facts/capability-facts.ts`
- Create: `src/opt-ir/facts/private-state-facts.ts`
- Create: `tests/support/opt-ir/fact-index-fixtures.ts`
- Test: `tests/unit/opt-ir/fact-index.test.ts`

**Acceptance Criteria:**

- `OptIrFactSet` is the authoritative sidecar; programs only store fact IDs and rebuildable indexes.
- `OptIrFactQuery` exposes `owns`, `mustNotAlias`, `fieldsDisjoint`, `provesInBounds`, `layoutOf`, `endianOfLayoutAccess`, `volatilityOf`, `callEffects`, `terminalBehavior`, `abiShape`, `capabilityFlow`, `provesImpossible`, `privateStateGeneration`, and `erasureOf`.
- Every yes/no/unknown answer carries `factsUsed` and explanation strings.
- Lineage records distinguish checked packet facts from pass-derived facts.
- `endianOfLayoutAccess` derives from layout/ABI facts and selected layout program, not a separate packet fact.
- Queries never inspect raw packet arrays after import.

**Code Examples:**

```ts
const answer = factQuery.provesInBounds(packetLoadAccessForTest(), optIrProgramPointForTest());

expect(answer.kind).toBe("yes");
expect(answer.factsUsed).toEqual([optIrFactId(12)]);
expect(answer.explanation.join("\n")).toContain("validated buffer");
```

```ts
const unknown = factQuery.mustNotAlias(stackRefForTest("left"), stackRefForTest("right"), point);

expect(unknown).toEqual({
  kind: "unknown",
  factsUsed: [],
  explanation: ["No checked noalias or pass-derived alias fact is in scope."],
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-index.test.ts
```

### Task 15: Path Certificates And CFG Edge Implications

**Description:** Import checked path certificates into OptIR edge certificates and implement immutable certificate re-homing through CFG edge implication records.

**Dependencies:** Tasks 3, 12, and 14.

**Files:**

- Create: `src/opt-ir/facts/path-certificates.ts`
- Create: `src/opt-ir/verify/path-certificate-verifier.ts`
- Create: `tests/support/opt-ir/path-certificate-fixtures.ts`
- Test: `tests/unit/opt-ir/path-certificates.test.ts`

**Acceptance Criteria:**

- Construction maps upstream `ProofMirControlEdgeId` records to fresh `OptIrEdgeId` records exactly once.
- `OptIrPathCertificate` stores source fact, checked source scope, required edges, required dominators, excluded edges, invalidation triggers, and origin.
- Re-homing creates new certificate IDs with lineage to the checked certificate, CFG edit, and facts used to prove implication.
- Re-homing fails closed when a required edge has no non-empty new path, excluded edge survives, dominator no longer dominates, or invalidation trigger is crossed.
- Original certificates are immutable.

**Code Examples:**

```ts
const result = rehomePathCertificateForTest({
  certificate: optIrPathCertificateForTest({ requiredEdges: [optIrEdgeId(1)] }),
  implications: [
    {
      oldEdge: optIrEdgeId(1),
      newPath: [optIrEdgeId(7), optIrEdgeId(8)],
      conditionFacts: [optIrFactId(3)],
      cfgEdit: optIrCfgEditId(2),
    },
  ],
});

expect(result.kind).toBe("ok");
expect(result.certificate.requiredEdges).toEqual([optIrEdgeId(7), optIrEdgeId(8)]);
```

```ts
expect(rehomePathCertificateForTest({ certificate, implications: [] }).kind).toBe("dropped");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/path-certificates.test.ts
```

### Task 16: Region Builder And Target-Effect Normalization

**Description:** Build region tables before operation lowering and normalize checked platform/runtime effects into OptIR region requirements and token threads through the selected target surface.

**Dependencies:** Tasks 4, 12, and 14.

**Files:**

- Create: `src/opt-ir/lower/region-builder.ts`
- Test: `tests/unit/opt-ir/region-builder.test.ts`
- Test: `tests/integration/opt-ir/platform-effect-boundaries.test.ts`

**Acceptance Criteria:**

- Region builder creates stable regions for stack locals, source aggregates, packet sources, validated payload views, constants, globals, image devices, firmware tables, runtime memory, and external unknown memory.
- Address-taken or callback-visible values are marked escaped and conservatively classified.
- Validated payload regions link back to backing packet-source alias classes and byte ranges.
- Unknown place-bound catalog effects become `externalUnknown` or ordered effects over externally visible regions.
- Multi-region platform/runtime calls require all token threads and cross-region observation edges.

**Code Examples:**

```ts
const regions = buildOptIrRegionsForTest({
  checkedMir: checkedMirProgramForOptIrTest({
    facts: [packetSourceFactForTest({ packet: "packet", source: "bytes" })],
  }),
});

expect(regions.entries().map((region) => region.kind)).toContain("packetSource");
expect(regions.entries().map((region) => region.kind)).toContain("validatedPayload");
```

```ts
const requirements = normalizeTargetEffectRequirementsForTest({
  catalogEffect: { readsMemory: true, writesMemory: true, platformEffect: "unknown" },
});

expect(requirements).toEqual([
  expect.objectContaining({ region: expect.objectContaining({ kind: "externalUnknown" }) }),
]);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/region-builder.test.ts ./tests/integration/opt-ir/platform-effect-boundaries.test.ts
```

### Task 17: Function Skeleton And Block-Argument Lowering

**Description:** Construct OptIR function/block skeletons, explicit edge records, entry parameters, join parameters, and scalar SSA/block-argument mappings from checked MIR.

**Dependencies:** Tasks 6, 15, and 16.

**Files:**

- Create: `src/opt-ir/lower/block-argument-builder.ts`
- Create: `src/opt-ir/lower/provenance-builder.ts`
- Create: `src/opt-ir/lower/lower-checked-mir.ts`
- Test: `tests/unit/opt-ir/construction.test.ts`

**Acceptance Criteria:**

- Functions and blocks are allocated in stable checked MIR order.
- Every successor edge has predecessor terminator arguments matching successor block parameters.
- Loop-header and join parameters are predeclared when checked MIR SSA/place information requires them.
- Values that are proof-only are marked for later erasure and not exposed as executable runtime values.
- Provenance links each function, block, edge, value, and parameter to source/HIR/mono/Proof MIR/checked MIR origins when available.

**Code Examples:**

```ts
const result = lowerCheckedMirSkeletonForTest(checkedMirDiamondForTest());

expect(result.kind).toBe("ok");
expect(result.program.functions.entries()[0]?.blocks).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ parameters: [expect.objectContaining({ role: "joinValue" })] }),
  ]),
);
```

```text
block entry(packet, len):
  ok = ge len, 14
  branch ok, header(packet, len), reject()

block header(packet, len):
  ethertype = load packet + 12 : be u16
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/construction.test.ts
```

### Task 18: Canonical Constants, Scalars, Layout, Aggregates, And Control Lowering

**Description:** Lower executable checked MIR operations into canonical constants, scalar operations, layout terms, aggregate extracts/inserts, branches, switches, returns, traps, panics, terminal calls, and unreachable terminators.

**Dependencies:** Tasks 5, 14, 16, and 17.

**Files:**

- Create: `src/opt-ir/lower/canonical-operations.ts`
- Test: `tests/unit/opt-ir/canonical-operations.test.ts`

**Acceptance Criteria:**

- Constants are interned by type and normalized value.
- Field projections become layout paths plus concrete offsets or aggregate extracts/inserts.
- Enum construction and matching become tag constants/extracts plus canonical switches.
- Branches use canonical boolean conditions and edge IDs.
- Terminal exits lower to terminal call terminators, traps, panics, or unreachable as appropriate.
- Unsupported reachable checked MIR operations return construction errors with provenance.

**Code Examples:**

```ts
const lowered = lowerCanonicalOperationsForTest(checkedMirEnumMatchForTest());

expect(lowered.operations.map((operation) => operation.kind)).toEqual(
  expect.arrayContaining(["layoutAccess", "switch"]),
);
```

```ts
expect(lowerCanonicalOperationsForTest(unsupportedCheckedMirOperationForTest())).toEqual(
  expect.objectContaining({
    kind: "error",
    diagnostics: expect.arrayContaining([
      expect.objectContaining({ code: "OPT_IR_UNSUPPORTED_CHECKED_MIR_OPERATION" }),
    ]),
  }),
);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/canonical-operations.test.ts
```

### Task 19: Validated-Buffer Read Lowering

**Description:** Lower validated-buffer reads into canonical packet/source or validated-payload memory accesses with bounds authority, layout path, endian marker, volatility, and path certificate references.

**Dependencies:** Tasks 14, 15, 18, and 24.

**Files:**

- Create: `src/opt-ir/lower/validated-buffer-reads.ts`
- Test: `tests/unit/opt-ir/validated-buffer-reads.test.ts`
- Test: `tests/integration/opt-ir/validated-buffer-optimization.test.ts`

**Acceptance Criteria:**

- Check-free packet/source accesses cite certified or pass-derived bounds facts.
- Runtime-guarded accesses cite guard operation, success edge, checked byte range, and dominance.
- If a guard is removed later, every affected access must be updated to a certified/pass-derived authority or verification fails.
- Endian marker remains explicit as `target`, `little`, or `big`.
- Layout `readRequires` and path certificates are preserved in access metadata.

**Code Examples:**

```ts
const access = lowerValidatedBufferReadForTest({
  fieldName: "ethertype",
  offsetBytes: 12n,
  widthBytes: 2n,
  wireEndian: "big",
  facts: [validatedBufferBoundsFactForTest()],
});

expect(access.boundsAuthority).toEqual({
  kind: "certifiedFact",
  factId: optIrFactId(1),
});
expect(access.endian).toBe("big");
```

```ts
expect(verifyOptIrProgramForTest(packetLoadWithRemovedRuntimeGuardForTest()).kind).toBe("error");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/validated-buffer-reads.test.ts ./tests/integration/opt-ir/validated-buffer-optimization.test.ts
```

### Task 20: Source, Runtime, And Platform Call Lowering

**Description:** Lower checked MIR calls into source/runtime/platform OptIR call operations with ABI facts, normalized effect requirements, terminal behavior, capability flow, and private-state effects. This task creates the complete effectful operation shape but does not build memory SSA or effect-token indexes.

**Dependencies:** Tasks 14, 16, and 18.

**Files:**

- Create: `src/opt-ir/lower/call-lowering.ts`
- Test: `tests/unit/opt-ir/call-lowering.test.ts`
- Test: `tests/integration/opt-ir/platform-effect-boundaries.test.ts`

**Acceptance Criteria:**

- Source calls carry callee ID, summary, ABI shape, effect summary, terminal behavior, and call-result fact hooks.
- Runtime and platform calls resolve through target-surface catalogs with matching authority fingerprints.
- Multi-region effect calls declare every required ordered region input/output in operation metadata.
- Unknown/callback-capable calls conservatively declare external-unknown and escaped-region ordered requirements.
- Terminal calls produce terminal terminators and preserve earlier observable effects.
- No placeholder effect-token index is created in this task; Task 28 indexes the complete lowered program after this task lands.

**Code Examples:**

```ts
const call = lowerPlatformCallForTest({
  targetKey: "get_memory_map",
  requirements: [
    effectRequirementForTest({ region: "systemTable", mode: "observe", token: "orderedEffect" }),
    effectRequirementForTest({ region: "memoryMap", mode: "mutate", token: "orderedEffect" }),
  ],
});

expect(call.header.effects.orderedRegions).toHaveLength(2);
```

```ts
expect(verifyOptIrProgramForTest(platformCallMissingMemoryMapTokenForTest()).kind).toBe("error");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/call-lowering.test.ts ./tests/integration/opt-ir/platform-effect-boundaries.test.ts
```

### Task 21: Proof Erasure And Construction Cleanup

**Description:** Import erasure facts, preserve lineage for facts depending on erased values, remove proof-only operations from executable OptIR, and run construction cleanup.

**Dependencies:** Tasks 14, 18, 19, 20, and 24.

**Files:**

- Create: `src/opt-ir/lower/proof-erasure.ts`
- Create: `src/opt-ir/passes/cleanup.ts`
- Test: `tests/unit/opt-ir/proof-erasure.test.ts`

**Acceptance Criteria:**

- Erasure runs after fact import.
- Proof-only values and operations are mapped to provenance records before removal.
- Facts depending on erased values survive only through valid lineage/remapping.
- Construction fails if any executable operation still depends on an erased value.
- Cleanup removes trivial aliases, empty proof markers, unreachable proof-only scaffolding, and keeps facts/indexes consistent.

**Code Examples:**

```ts
const result = eraseProofOnlyOptIrForTest({
  program: optIrProgramWithProofWrapperForTest(),
  facts: optIrFactSetForTest([erasureFactForTest({ value: checkedValueIdForTest("proof") })]),
});

expect(result.kind).toBe("ok");
expect(result.program.functions.entries()[0]?.blocks[0]?.operations).not.toContainEqual(
  expect.objectContaining({ kind: "proofOnly" }),
);
```

```ts
expect(eraseProofOnlyOptIrForTest(programWithRuntimeUseOfErasedValueForTest()).kind).toBe("error");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/proof-erasure.test.ts
```

### Task 22: Construction Orchestration And Deterministic Output

**Description:** Create the public construction API and wire boundary validation, region construction, skeleton lowering, canonical lowering, fact import, proof erasure, cleanup, and verification into real `constructOptIr` behavior.

**Dependencies:** Tasks 6, 7, 12, 13, 14, 15, 16, 17, 18, 19, 20, and 21.

**Files:**

- Create: `src/opt-ir/public-api.ts`
- Modify: `src/opt-ir/lower/lower-checked-mir.ts`
- Create: `tests/support/opt-ir/construction-fixtures.ts`
- Test: `tests/unit/opt-ir/public-api.test.ts`
- Test: `tests/unit/opt-ir/construction-orchestration.test.ts`
- Test: `tests/integration/opt-ir/checked-mir-to-opt-ir.test.ts`

**Acceptance Criteria:**

- `constructOptIr` returns `kind: "ok"` with program, facts, provenance snapshot, and diagnostics for valid fixture input.
- Construction returns `kind: "error"` for invalid boundary, unsupported operation, missing required fact authority, or verifier failure.
- Provenance output is a snapshot of `program.provenance` with matching fingerprint.
- Construction is deterministic across repeated runs and changed input map insertion orders.
- No optimization passes beyond construction cleanup run in this task.

**Code Examples:**

```ts
const first = constructOptIr(validConstructOptIrInputForTest());
const second = constructOptIr(validConstructOptIrInputWithShuffledTablesForTest());

expect(stableOptIrConstructionKey(first)).toBe(stableOptIrConstructionKey(second));
```

```ts
expect(constructOptIr(validConstructOptIrInputForTest())).toEqual(
  expect.objectContaining({
    kind: "ok",
    program: expect.any(Object),
    facts: expect.any(Object),
  }),
);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/public-api.test.ts ./tests/unit/opt-ir/construction-orchestration.test.ts ./tests/integration/opt-ir/checked-mir-to-opt-ir.test.ts
```

### Task 23: Pass Contracts, Schedule Policy, And Pass Verifier

**Description:** Define pass contracts, scheduling contracts, fixed production pass order, fixpoint cluster policy, pass verifier, and schedule-consistency checks.

**Dependencies:** Tasks 6 and 14.

**Files:**

- Create: `src/opt-ir/passes/pass-contract.ts`
- Create: `src/opt-ir/policy/pass-order-policy.ts`
- Create: `src/opt-ir/verify/pass-verifier.ts`
- Create: `src/opt-ir/verify/pass-schedule-consistency.ts`
- Create: `tests/support/opt-ir/pass-contract-fixtures.ts`
- Test: `tests/unit/opt-ir/pass-contract.test.ts`
- Test: `tests/unit/opt-ir/pass-schedule-consistency.test.ts`

**Acceptance Criteria:**

- Every pass contract has one pass ID, `invalidatesByDefault: true`, preserves, derives, rewrite obligations, scheduling facet, and `requiresVerifierAfterRun`.
- Production pass order matches the design staging and declares fixpoint memberships and fuel.
- Schedule verifier rejects passes scheduled before producers of preconditions.
- Schedule verifier rejects invalidated analyses consumed without recomputation.
- Fixpoints must contain only idempotent, fuel-bounded passes.

**Code Examples:**

```ts
const contract = optIrPassContractForTest({
  passId: optimizationPassId("cleanup"),
  invalidatesByDefault: true,
  scheduling: {
    requires: ["canonical-ssa"],
    produces: ["clean-cfg"],
    invalidatesAnalyses: ["dominance"],
    idempotent: true,
    fuel: { kind: "fixedRounds", rounds: 4 },
  },
});

expect(validateOptIrPassContract(contract).kind).toBe("ok");
```

```ts
expect(validateProductionPassSchedule(badScheduleMissingDominanceRecompute).kind).toBe("error");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/pass-contract.test.ts ./tests/unit/opt-ir/pass-schedule-consistency.test.ts
```

### Task 24: Fact Preservation, Subject Remapping, And Rewrite Legality

**Description:** Implement mechanical fact preservation, subject remapping, CFG/memory edit handling, path-certificate re-homing hooks, and rewrite-legality validation.

**Dependencies:** Tasks 15 and 23.

**Files:**

- Create: `src/opt-ir/facts/fact-preservation.ts`
- Create: `src/opt-ir/facts/subject-remapping.ts`
- Create: `src/opt-ir/verify/fact-verifier.ts`
- Create: `src/opt-ir/verify/rewrite-legality.ts`
- Create: `src/opt-ir/verify/pass-invariant-schema.ts`
- Create: `tests/support/opt-ir/fact-preservation-fixtures.ts`
- Test: `tests/unit/opt-ir/fact-preservation.test.ts`

**Acceptance Criteria:**

- Preservation applies subject, scope, dependency, CFG, memory, invalidation, and result checks in design order.
- Checked facts are never mutated in place; preserved facts become OptIR facts with lineage.
- Path-scoped facts are dropped unless CFG edits provide valid edge implications and dominance.
- Rewrite-legality obligations must match reviewed invariant schemas and exact facts used.
- `passSpecificInvariant` requires schema, typed checker, and non-empty decomposition into named invariants.

**Code Examples:**

```ts
const result = preserveFactsForRewriteForTest({
  facts: optIrFactSetForTest([pathScopedBoundsFactForTest()]),
  remap: subjectRemapTableForTest({ edges: [[optIrEdgeId(1), optIrEdgeId(7)]] }),
  cfgEdits: [branchFoldEditForTest()],
});

expect(result.preservedFacts).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ lineage: expect.objectContaining({ source: expect.any(Object) }) }),
  ]),
);
```

```ts
expect(validateRewriteLegalityForTest(rewriteWithoutObligationForFactGate()).kind).toBe("error");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-preservation.test.ts
```

### Task 25: Cleanup And Scalar Simplification Cluster

**Description:** Implement the cheap cleanup and scalar simplification passes: constant folding, DCE, copy propagation, CFG simplification, trivial block merging, unreachable block removal, compare simplification, and select preparation.

**Dependencies:** Tasks 18 and 24.

**Files:**

- Create: `src/opt-ir/passes/scalar-simplification.ts`
- Create: `src/opt-ir/passes/dce.ts`
- Create: `src/opt-ir/passes/copy-propagation.ts`
- Create: `src/opt-ir/passes/cfg-simplification.ts`
- Test: `tests/unit/opt-ir/cleanup.test.ts`
- Test: `tests/unit/opt-ir/scalar-simplification.test.ts`

**Acceptance Criteria:**

- Pure unused operations disappear only when semantics allow unused removal.
- Branches and switches simplify only with facts or constants in scope.
- Removed runtime bounds checks re-home bounds authority on affected accesses or are rejected.
- Cleanup updates fact indexes and provenance.
- Passes are idempotent under their declared fuel.

**Code Examples:**

```ts
const result = runScalarSimplificationForTest(programWithConstantBranchForTest(true));

expect(noUnreachableFalseEdgeForTest(result.program)).toBe(true);
expect(result.rewriteRecords).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      invariant: expect.objectContaining({ kind: "terminalReachabilityEquivalence" }),
    }),
  ]),
);
```

```ts
expect(
  stillContainsVolatileLoadForTest(runDceForTest(programWithVolatileUnusedLoadForTest()).program),
).toBe(true);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/cleanup.test.ts ./tests/unit/opt-ir/scalar-simplification.test.ts
```

### Task 26: SCCP, Range Analysis, Value Numbering, And GVN

**Description:** Add monotone sparse conditional constant propagation over block arguments, range/impossibility facts, value numbering, pure CSE, and GVN.

**Dependencies:** Tasks 25 and 27.

**Files:**

- Create: `src/opt-ir/analyses/range-analysis.ts`
- Create: `src/opt-ir/analyses/value-numbering.ts`
- Create: `src/opt-ir/passes/sccp.ts`
- Create: `src/opt-ir/passes/gvn.ts`
- Create: `tests/support/opt-ir/dataflow-fixtures.ts`
- Test: `tests/unit/opt-ir/sccp.test.ts`
- Test: `tests/unit/opt-ir/gvn.test.ts`

**Acceptance Criteria:**

- SCCP propagates constants through SSA values and block parameters and removes unreachable edges in one fixpoint.
- Range analysis derives pass facts with lineage to checked dependencies where applicable.
- GVN/CSE only merges pure interpreter-complete operations with identical schema semantics and compatible provenance.
- Volatile, terminal, platform/runtime, and effect-token operations are not commoned.
- Deterministic worklist order is stable by function, block, operation, and value ID.

**Code Examples:**

```ts
const result = runSccpForTest(programWithStaticSwitchForTest({ discriminant: 4n }));

expect(onlySwitchCaseSurvivesForTest("case4")(result.program)).toBe(true);
expect(result.derivedFacts).toEqual(
  expect.arrayContaining([expect.objectContaining({ kind: "impossibility" })]),
);
```

```ts
expect(
  hasTwoVolatileLoadsForTest(runGvnForTest(programWithTwoVolatileLoadsForTest()).program),
).toBe(true);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/sccp.test.ts ./tests/unit/opt-ir/gvn.test.ts
```

### Task 27: Core Analyses

**Description:** Implement deterministic dominance, loop tree, call graph, SCC, liveness, escape analysis, and alias analysis used by passes and verifiers.

**Dependencies:** Tasks 3, 4, and 6.

**Files:**

- Create: `src/opt-ir/analyses/dominance.ts`
- Create: `src/opt-ir/analyses/loop-tree.ts`
- Create: `src/opt-ir/analyses/call-graph.ts`
- Create: `src/opt-ir/analyses/scc.ts`
- Create: `src/opt-ir/analyses/liveness.ts`
- Create: `src/opt-ir/analyses/escape-analysis.ts`
- Create: `src/opt-ir/analyses/alias-analysis.ts`
- Create: `tests/support/opt-ir/analysis-fixtures.ts`
- Test: `tests/unit/opt-ir/analyses.test.ts`

**Acceptance Criteria:**

- Dominance supports block, value, region-version, and effect-token use checks.
- Loop tree identifies headers, latches, loop depth, and cold/terminal paths.
- Call graph records source, runtime, platform, callback, external-root, and unknown-call edges.
- SCC analysis rejects recursive/maybe-recursive inlining/specialization by default.
- Escape analysis marks address-taken locals, callbacks, exported roots, unknown calls, and external flow.
- Alias analysis combines region alias classes with fact-query answers.

**Code Examples:**

```ts
const dominance = computeOptIrDominance(optIrAnalysisFixtureForTest("diamond"));

expect(dominance.dominates(optIrBlockId(1), optIrBlockId(3))).toBe(true);
expect(dominance.dominates(optIrBlockId(2), optIrBlockId(3))).toBe(false);
```

```ts
const sccs = computeOptIrCallGraphSccs(callGraphWithCallbackCycleForTest());
expect(sccs.entries().some((scc) => scc.kind === "maybeRecursive")).toBe(true);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/analyses.test.ts
```

### Task 28: Memory SSA And Effect-Token Indexes

**Description:** Build deterministic memory SSA and effect-token indexes over the complete lowered OptIR program after call lowering has produced all source/runtime/platform operation effects.

**Dependencies:** Tasks 16, 20, 24, and 27.

**Files:**

- Create: `src/opt-ir/analyses/memory-ssa.ts`
- Create: `src/opt-ir/analyses/effect-tokens.ts`
- Create: `tests/support/opt-ir/memory-ssa-fixtures.ts`
- Test: `tests/unit/opt-ir/memory-ssa.test.ts`

**Acceptance Criteria:**

- Memory SSA is built after validated-buffer and call lowering, and before load/store forwarding, DSE, scalar replacement, stack promotion, and e-graph memory-slice import.
- Immutable constant regions can skip memory SSA.
- Packet/source regions use read-only versions plus certified bounds facts.
- Ordered firmware/image/runtime/platform/private-state regions use effect tokens.
- Multi-region calls consume/produce all required token threads according to the lowered call operation metadata from Task 20.
- Trigger decisions depend only on operation kinds, region kinds, and fixed pass pipeline.

**Code Examples:**

```ts
const index = buildMemorySsaForTest(programWithTwoStackStoresForTest());

expect(index.versionAfter(optIrOperationId(2), optIrRegionId(1))).toBe(optIrMemoryVersionId(2));
```

```ts
expect(buildEffectTokenIndexForTest(multiRegionCallDroppingOneTokenForTest()).kind).toBe("error");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/memory-ssa.test.ts
```

### Task 29: Mandatory Semantic Inlining

**Description:** Inline checked mandatory wrappers and reject impossible mandatory classifications, with fact and path-certificate re-homing.

**Dependencies:** Tasks 20, 21, and 24.

**Files:**

- Create: `src/opt-ir/passes/mandatory-inlining.ts`
- Create: `src/opt-ir/policy/inline-policy.ts`
- Test: `tests/unit/opt-ir/mandatory-inlining.test.ts`

**Acceptance Criteria:**

- Mandatory candidates come only from `OptIrFunctionSummary.semanticInlinePolicy.kind === "mandatory"`.
- Body shape may reject unsafe mandatory inlines but may not create mandatory labels.
- Inlining preserves terminal behavior, panic behavior, divergence, effects, capability flow, private-state generation, ABI obligations, and facts.
- Callee-body facts are remapped to caller-local subjects/scopes or dropped.
- Mandatory inline failure returns `kind: "error"` with internal compiler diagnostic.

**Code Examples:**

```ts
const result = runMandatoryInliningForTest(programWithValidationHelperWrapperForTest());

expect(result.kind).toBe("ok");
expect(noCallsToFunctionForTest("validate_wrapper")(result.program)).toBe(true);
expect(hasCallerLocalRehomedBoundsFactForTest(result.facts)).toBe(true);
```

```ts
expect(runMandatoryInliningForTest(platformWrapperWithExtraLoggingForTest()).kind).toBe("error");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/mandatory-inlining.test.ts
```

### Task 30: Scope-Expansion Budget, Policy, And Decision Logs

**Description:** Implement shared code-growth budget ledger, optimization profile, inline/specialization policy shells, local policy feature vectors, and deterministic decision logs.

**Dependencies:** Tasks 23, 26, and 29.

**Files:**

- Create: `src/opt-ir/policy/expansion-budget.ts`
- Create: `src/opt-ir/policy/specialization-policy.ts`
- Create: `src/opt-ir/policy/local-policy.ts`
- Create: `src/opt-ir/policy/decision-log.ts`
- Test: `tests/unit/opt-ir/expansion-budget.test.ts`

**Acceptance Criteria:**

- Budget ledger has per-function, per-SCC, per-image growth caps and fixpoint fuel.
- Inlining and specialization reserve, commit, or release against the same ledger.
- Accounting uses deterministic static features only.
- Policy units are named, such as normalized operation units and e-node caps.
- Decision logs include candidate key, policy result, facts used, uncertainty, and stable reason.

**Code Examples:**

```ts
const reservation = ledger.reserve(
  { kind: "function", functionId: optIrFunctionId(2) },
  { unit: "normalizedOperation", amount: 12 },
);

expect(reservation).not.toBe("denied");
ledger.commit(reservation as OptIrBudgetReservation);
expect(ledger.remaining({ kind: "image" }).amount).toBe(88);
```

```ts
expect(policyFeatureVectorForTest({ wallClockMs: 4 })).toThrow(
  "wall-clock time is not an OptIR policy feature",
);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/expansion-budget.test.ts
```

### Task 31: Budgeted Whole-Program Inlining

**Description:** Add the budgeted inlining participant inside the shared scope-expansion fixpoint over the closed call graph.

**Dependencies:** Tasks 27, 29, and 30.

**Files:**

- Create: `src/opt-ir/passes/whole-program-inlining.ts`
- Test: `tests/unit/opt-ir/whole-program-inlining.test.ts`

**Acceptance Criteria:**

- Inliner computes call graph SCCs and refuses recursive/maybe-recursive SCCs by default.
- External roots keep ABI entry symbols.
- Callback and address-taken callable identity survives unless escape analysis proves closed rewritability.
- Platform/runtime effect boundaries are hard boundaries unless catalog and rewrite legality approve exact rewrite.
- Budget reservation succeeds before rewrite and commits/releases deterministically.
- Inliner enqueues cleanup/SCCP/specialization work items through stable worklist records.

**Code Examples:**

```ts
const result = runWholeProgramInliningForTest({
  program: programWithSmallCalleeForTest(),
  budget: expansionBudgetForTest({ perImageGrowth: 10 }),
});

expect(callsiteWasInlinedForTest(result.program)).toBe(true);
expect(result.decisionLog).toEqual(
  expect.arrayContaining([expect.objectContaining({ decision: "accepted" })]),
);
```

```ts
expect(
  callsiteStillPresentForTest(runWholeProgramInliningForTest(recursiveSccProgramForTest()).program),
).toBe(true);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/whole-program-inlining.test.ts
```

### Task 32: Binding-Time Analysis

**Description:** Implement deterministic static/dynamic classification over constants, pure operations, layout facts, callee identities, private-state generations, capability tokens, and impossibility facts.

**Dependencies:** Tasks 14, 26, and 30.

**Files:**

- Create: `src/opt-ir/analyses/binding-time-analysis.ts`
- Test: `tests/unit/opt-ir/binding-time-analysis.test.ts`

**Acceptance Criteria:**

- Analysis is a monotone fixpoint over operations and block arguments in stable ID order.
- Static sources include interned constants, constant block arguments, layout/ABI facts, callee identity, pure folded results, exact private-state/capability facts, and impossibility facts.
- Dynamic operands, unknown call results, out-of-scope facts, and effectful results remain dynamic.
- Fact-cited static classifications include facts used and invalidation triggers.
- Results are deterministic under shuffled operation table insertion.

**Code Examples:**

```ts
const result = analyzeBindingTimeForTest(programWithStaticLayoutOffsetForTest());

expect(result.classificationOf(optIrValueId(7))).toEqual({
  kind: "static",
  factsUsed: [optIrFactId(3)],
});
```

```ts
expect(
  analyzeBindingTimeForTest(programWithRuntimeCallResultForTest()).classificationOf(callResult),
).toEqual({
  kind: "dynamic",
  reason: "unknownCallResult",
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/binding-time-analysis.test.ts
```

### Task 33: Whole-Program Specialization

**Description:** Add whole-program specialization as a participant in the shared scope-expansion fixpoint, including static evaluation, static branch/switch driving, bounded unrolling, polyvariant cloning, clone dedup, and fact/path re-homing.

**Dependencies:** Tasks 24, 31, and 32.

**Files:**

- Create: `src/opt-ir/passes/whole-program-specialization.ts`
- Create: `src/opt-ir/passes/specialization/residual-invariant.ts`
- Create: `src/opt-ir/passes/specialization/static-driving.ts`
- Create: `src/opt-ir/passes/specialization/clone-signature.ts`
- Create: `src/opt-ir/passes/specialization/bounded-unroll.ts`
- Test: `tests/unit/opt-ir/whole-program-specialization.test.ts`
- Test: `tests/unit/opt-ir/whole-program-specialization.residual.test.ts`
- Test: `tests/unit/opt-ir/whole-program-specialization.static-driving.test.ts`
- Test: `tests/unit/opt-ir/whole-program-specialization.clone-signature.test.ts`

**Acceptance Criteria:**

- Static pure operations become interned constants with rewrite obligations.
- Static branch/switch driving removes dead successors and records CFG edits/path preservation.
- Bounded loop unrolling requires static trip structure and unroll budget.
- Clone signatures canonicalize static operands by constant ID, layout fact key, callee identity, and facts cited.
- Clone variants respect per-function/SCC/image budget, variant caps, cold-path refusal, recursive-SCC refusal, external-root boundaries, and effect boundaries.
- `specializationResidualEquivalence` pass invariant decomposes into named invariants.

**Code Examples:**

```ts
const result = runWholeProgramSpecializationForTest(schemaDrivenParserForTest());

expect(hasSpecializedCloneForTest("parse_ipv4")(result.program)).toBe(true);
expect(noDescriptorWalkInCloneForTest("parse_ipv4")(result.program)).toBe(true);
```

```ts
expect(runWholeProgramSpecializationForTest(stalePrivateGenerationCloneForTest()).kind).toBe(
  "error",
);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/whole-program-specialization.residual.test.ts ./tests/unit/opt-ir/whole-program-specialization.static-driving.test.ts ./tests/unit/opt-ir/whole-program-specialization.clone-signature.test.ts ./tests/unit/opt-ir/whole-program-specialization.test.ts
```

### Task 34: Memory Optimization Cluster

**Description:** Implement deterministic load/store forwarding, DSE, scalar replacement, stack promotion, and LICM using memory SSA, effect tokens, alias facts, and preservation rules.

**Dependencies:** Tasks 24, 28, and 25.

**Files:**

- Create: `src/opt-ir/passes/memory-optimization.ts`
- Create: `src/opt-ir/passes/scalar-replacement.ts`
- Create: `src/opt-ir/passes/stack-promotion.ts`
- Create: `src/opt-ir/passes/licm.ts`
- Create: `src/opt-ir/policy/memory-policy.ts`
- Test: `tests/unit/opt-ir/memory-optimization.test.ts`

**Acceptance Criteria:**

- Forwarding occurs only within compatible region versions/effect-token chains.
- DSE refuses volatile, firmware, image-device, platform-observable, and external-unknown stores unless target contract permits.
- Scalar replacement accounts for every byte range and cleanup/destructor effect.
- Stack promotion requires non-escaping stack-local regions and valid lifetime facts.
- LICM moves only pure or region-safe operations across effect boundaries.
- Every rewrite records `noaliasMemoryEquivalence` or `effectBoundaryEquivalence`.

**Code Examples:**

```ts
const result = runMemoryOptimizationForTest(nonVolatileOverwriteBeforeReadForTest());

expect(firstStoreRemovedForTest(result.program)).toBe(true);
expect(result.rewriteRecords).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ invariant: { kind: "noaliasMemoryEquivalence" } }),
  ]),
);
```

```ts
expect(
  hasTwoLoadsForTest(runMemoryOptimizationForTest(firmwareVolatileRepeatedLoadForTest()).program),
).toBe(true);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/memory-optimization.test.ts
```

### Task 35: Wrela-Specific Optimization Passes

**Description:** Implement proof-powered Wrela optimizations: move/copy elision, zero-copy validated-buffer reads, bounds-check elimination, endian-aware field-load folding, parser pipeline collapse, terminal cleanup pruning, wrapper elimination, and platform call specialization.

**Dependencies:** Tasks 19, 20, 24, 25, and 34.

**Files:**

- Create: `src/opt-ir/passes/wrela-optimizations/index.ts`
- Create: `src/opt-ir/passes/wrela-optimizations/move-copy-wrapper-elision.ts`
- Create: `src/opt-ir/passes/wrela-optimizations/bounds-zero-copy.ts`
- Create: `src/opt-ir/passes/wrela-optimizations/endian-parser-collapse.ts`
- Create: `src/opt-ir/passes/wrela-optimizations/terminal-platform-specialization.ts`
- Test: `tests/unit/opt-ir/wrela-move-copy-wrapper.test.ts`
- Test: `tests/unit/opt-ir/wrela-bounds-zero-copy.test.ts`
- Test: `tests/unit/opt-ir/wrela-endian-parser.test.ts`
- Test: `tests/unit/opt-ir/wrela-terminal-platform.test.ts`
- Test: `tests/integration/opt-ir/fact-preserving-rewrites.test.ts`
- Test: `tests/integration/opt-ir/validated-buffer-optimization.test.ts`

**Acceptance Criteria:**

- Moves/copies are removed only with ownership/noalias/erasure facts and no observable cleanup.
- Bounds-check elimination re-homes licensing bounds facts onto check-free accesses.
- Endian folding keeps explicit endian markers and refuses volatile/firmware folds unless target contract permits.
- Parser collapse preserves cold rejection paths and diagnostics origins.
- Terminal cleanup pruning preserves observable platform/runtime cleanup calls.
- Platform call specialization uses constants, ABI facts, and target catalog equivalence.
- Debug explanations record eliminated checks, copies, wrappers, and parser states with fact chains.

**Code Examples:**

```ts
const result = runWrelaOptimizationsForTest(validatedPacketParserForTest());

expect(noParserStateObjectsForTest(result.program)).toBe(true);
expect(hasDirectPacketEndianLoadsForTest(["ethertype", "total_length"])(result.program)).toBe(true);
```

```ts
expect(runWrelaOptimizationsForTest(pathScopedBceWithoutCertificateRehomeForTest()).kind).toBe(
  "error",
);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/wrela-move-copy-wrapper.test.ts ./tests/unit/opt-ir/wrela-bounds-zero-copy.test.ts ./tests/unit/opt-ir/wrela-endian-parser.test.ts ./tests/unit/opt-ir/wrela-terminal-platform.test.ts ./tests/integration/opt-ir/fact-preserving-rewrites.test.ts ./tests/integration/opt-ir/validated-buffer-optimization.test.ts
```

### Task 36: E-Graph Core And Region Selection

**Description:** Implement deterministic e-graph data structures, equivalence classes, region selectors, effect-token window checks, local cost feature vectors, and diagnostics.

**Dependencies:** Tasks 6, 7, 14, 23, 24, and 35.

**Files:**

- Create: `src/opt-ir/egraph/egraph.ts`
- Create: `src/opt-ir/egraph/equivalence-class.ts`
- Create: `src/opt-ir/egraph/region-selection.ts`
- Create: `src/opt-ir/egraph/egraph-cost.ts`
- Create: `src/opt-ir/egraph/egraph-diagnostics.ts`
- Create: `tests/support/opt-ir/egraph-fixtures.ts`
- Test: `tests/unit/opt-ir/egraph-core.test.ts`

**Acceptance Criteria:**

- E-graph import order is stable by referenced operation and operand IDs.
- Candidate region selection priority is parser slices, vectorizable loops, single-entry/single-exit memory slices, then pure scalar DAGs.
- Boundaries stop at volatile, terminal, callbacks, unknown calls, external roots, and effect boundaries unless catalog permits import.
- Multi-token operations import all token inputs/outputs/intervening operations or are cut out of the candidate.
- Overlapping candidates are resolved by priority, smaller containing region, then stable root operation ID.

**Code Examples:**

```ts
const candidates = selectEGraphRegionsForTest(parserAndScalarDagProgramForTest());

expect(candidates[0]?.kind).toBe("parserValidationReadDispatchSlice");
expect(candidates.map((candidate) => candidate.regionId)).toEqual([
  optIrRewriteRegionId(1),
  optIrRewriteRegionId(2),
]);
```

```ts
expect(selectEGraphRegionsForTest(multiTokenCallPartialWindowForTest())).toEqual([]);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/egraph-core.test.ts
```

### Task 37: Fact-Gated E-Graph Rule Catalog And Extraction

**Description:** Add fact-gated rewrite rule schemas, production rule catalog, saturation loop, deterministic extraction, and extraction records.

**Dependencies:** Task 36.

**Files:**

- Create: `src/opt-ir/egraph/rewrite-rule.ts`
- Create: `src/opt-ir/egraph/fact-gated-rule.ts`
- Create: `src/opt-ir/egraph/rule-catalog.ts`
- Create: `src/opt-ir/egraph/saturation.ts`
- Create: `src/opt-ir/egraph/extraction.ts`
- Create: `src/opt-ir/policy/egraph-extraction-policy.ts`
- Test: `tests/unit/opt-ir/fact-gated-egraph.test.ts`
- Test: `tests/unit/opt-ir/egraph-rule-soundness.test.ts`

**Acceptance Criteria:**

- `rule-catalog.ts` exports `createDefaultOptIrRuleCatalog(): OptIrRuleCatalog` and `OPT_IR_EGRAPH_RULE_IDS`.
- Rule schemas include stable rule ID, name, pattern, replacement, fact gate, invariant, and preservation rules.
- Gates cover none, bounds, alias, layout, effect, ABI, terminal, capability flow, private state, and conjunction.
- Production rules cover endian load folding, bounds-branch deletion, move/copy erasure, layout arithmetic folding, parser-state collapse, field-disjoint memory CSE, platform wrapper collapse, and vector idiom preparation.
- Saturation is bounded by e-node/e-class/iteration/rule-application caps.
- Extraction tie-breaks by checked-in policy, uncertainty penalty, and stable root ID.
- Failed extraction leaves OptIR unchanged and emits debug diagnostics only when tracing is enabled.

**Code Examples:**

```ts
const ruleCatalog = createDefaultOptIrRuleCatalog();
const rule = ruleCatalog.ruleById(optimizationRewriteRuleId("endian-load-folding"));

expect(rule.gate).toEqual(expect.objectContaining({ kind: "conjunction" }));
expect(rule.obligation).toEqual({ kind: "layoutEndianEquivalence" });
```

```ts
const extraction = saturateAndExtractForTest({
  region: byteLoadShiftMaskRegionForTest(),
  facts: factsForEndianLoadFoldingForTest(),
});

expect(extraction.kind).toBe("replaced");
expect(extraction.record.rulesApplied).toContain(optimizationRewriteRuleId("endian-load-folding"));
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/fact-gated-egraph.test.ts ./tests/unit/opt-ir/egraph-rule-soundness.test.ts
```

### Task 38: E-Graph Translation Validation And Pass Integration

**Description:** Add bounded translation validation for interpreter-complete e-graph slices and wire e-graph rewriting into the OptIR pass framework.

**Dependencies:** Tasks 7 and 37.

**Files:**

- Create: `src/opt-ir/egraph/translation-validation.ts`
- Create: `src/opt-ir/passes/fact-gated-egraph.ts`
- Test: `tests/unit/opt-ir/egraph-translation-validation.test.ts`
- Test: `tests/integration/opt-ir/optimized-opt-ir-interpreter.test.ts`

**Acceptance Criteria:**

- Translation validator derives deterministic finite input sets from operand types, constants, range facts, layout bounds, masks, and edge cases.
- Memory/effect slices use fake regions and fake traces through dependency injection.
- Interpreter-complete disagreements reject extraction and leave original OptIR unchanged.
- Non-interpreter-complete slices record stable `notApplicable` reasons approved by the catalog.
- Pass integration runs structural, effect, dominance, fact, and rewrite-legality validation after replacement.

**Code Examples:**

```ts
const result = validateEGraphExtractionForTest({
  original: byteSwapOriginalSliceForTest(),
  replacement: wrongEndianReplacementForTest(),
});

expect(result.kind).toBe("rejected");
expect(result.reason).toBe("translationValidationMismatch");
```

```ts
expect(runFactGatedEGraphPassForTest(uninterpretedPlatformSliceForTest()).diagnostics).toEqual(
  expect.arrayContaining([
    expect.objectContaining({
      stableDetail: "translationValidation:notApplicable:opaquePlatformEffect",
    }),
  ]),
);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/egraph-translation-validation.test.ts ./tests/integration/opt-ir/optimized-opt-ir-interpreter.test.ts
```

### Task 39: SLP Vectorization And Vector Cleanup

**Description:** Implement vector-capable operations, scalar-preserving vector verifier rules, SLP pack discovery, SLP legality checks, vector idiom preparation consumption, and vector cleanup.

**Dependencies:** Tasks 5, 6, 23, and 35.

**Files:**

- Create: `src/opt-ir/passes/slp-vectorization.ts`
- Create: `src/opt-ir/passes/vectorization-cleanup.ts`
- Create: `src/opt-ir/policy/vector-policy.ts`
- Test: `tests/unit/opt-ir/slp-vectorization.test.ts`
- Test: `tests/unit/opt-ir/vector-types.test.ts`

**Acceptance Criteria:**

- Vector operations include vector load/store, masked load/store, shuffle, compare, select, and byte swap.
- Masked inactive lanes have explicit passthrough/no-effect semantics.
- SLP detects adjacent packet/source field reads, endian decodes, repeated validation comparisons, small fixed-width copies/sets, and parser table checks.
- SLP requires lane bounds, alias/effect safety, endian legality, target vector features, alignment/unaligned policy, and register-pressure policy.
- Scalar passes preserve vector values they do not understand.

**Code Examples:**

```ts
const result = runSlpVectorizationForTest(adjacentPacketFieldReadsForTest({ lanes: 4 }));

expect(hasVectorLoadForTest({ laneType: "u16", lanes: 4 })(result.program)).toBe(true);
expect(result.rewriteRecords).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ invariant: { kind: "vectorLaneEquivalence" } }),
  ]),
);
```

```ts
expect(
  hasOnlyScalarLoadsForTest(runSlpVectorizationForTest(volatileAdjacentReadsForTest()).program),
).toBe(true);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/slp-vectorization.test.ts ./tests/unit/opt-ir/vector-types.test.ts
```

### Task 40: Certified Loop Vectorization

**Description:** Implement certified loop-vectorization legality and rewrite for loops with fact-proven trip count/tail, lane bounds, memory independence, effect-safe body, and legal target vector operations.

**Dependencies:** Tasks 27, 28, 39, and 35.

**Files:**

- Create: `src/opt-ir/passes/loop-vectorization/index.ts`
- Create: `src/opt-ir/passes/loop-vectorization/loop-shape.ts`
- Create: `src/opt-ir/passes/loop-vectorization/loop-legality.ts`
- Create: `src/opt-ir/passes/loop-vectorization/loop-rewrite.ts`
- Create: `tests/support/opt-ir/vector-fixtures.ts`
- Test: `tests/unit/opt-ir/loop-vectorization.test.ts`
- Test: `tests/unit/opt-ir/loop-vectorization-shape.test.ts`
- Test: `tests/unit/opt-ir/loop-vectorization-legality.test.ts`

**Acceptance Criteria:**

- Vectorizer handles only certified trip count, certified vector-width multiple, masked-tail, or scalar-epilogue tail plans.
- Every lane access is proven in bounds.
- Loop body rejects volatile, MMIO, firmware-table, image-device, terminal, callback, and platform/runtime effects unless target catalog permits vector form.
- Carried values are scalar recurrences, recognized reductions, or exactly preserved region/effect tokens.
- Rewrite records selected tail plan and `vectorLaneEquivalence`, memory, and effect invariants.
- Unknown-trip loops are left scalar; no speculative guards or runtime probes are introduced.

**Code Examples:**

```ts
const result = runLoopVectorizationForTest(certifiedPacketByteLoopForTest({ tripCount: 64 }));

expect(hasVectorLoopForTest({ width: 16 })(result.program)).toBe(true);
expect(result.rewriteRecords[0]?.tailPlan).toEqual({ kind: "exactMultiple" });
```

```ts
expect(
  loopRemainsScalarForTest(runLoopVectorizationForTest(unknownTripCountLoopForTest()).program),
).toBe(true);
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/loop-vectorization-shape.test.ts ./tests/unit/opt-ir/loop-vectorization-legality.test.ts ./tests/unit/opt-ir/loop-vectorization.test.ts
```

### Task 41: Optimizer Orchestration And Public Exports

**Description:** Wire the full optimizer pass pipeline, final verification, provenance snapshotting, decision logs, public exports, and combined `buildOptimizedOptIr` operation.

**Dependencies:** Tasks 22, 23, 25, 26, 29, 30, 31, 33, 34, 35, 38, 39, and 40.

**Files:**

- Create: `src/opt-ir/passes/pipeline.ts`
- Modify: `src/opt-ir/public-api.ts`
- Create: `src/opt-ir/index.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/opt-ir/pipeline.test.ts`
- Test: `tests/unit/opt-ir/public-api.test.ts`

**Acceptance Criteria:**

- `optimizeOptIr` runs the fixed production pipeline and returns optimized program, facts, provenance snapshot, decision log, and diagnostics.
- `buildOptimizedOptIr` calls construction and then optimization, propagating construction errors without optimizer execution.
- Verifiers run after construction, after mandatory inlining, after each committed scope-expansion mutation, after major clusters, and before target lowering.
- Stale external provenance maps are never accepted as input.
- Top-level exports include `optIr` namespace and direct `src/opt-ir/index.ts` exports.

**Code Examples:**

```ts
const result = buildOptimizedOptIr({
  ...validConstructOptIrInputForTest(),
  policy: productionOptimizationPolicyForTest(),
});

expect(result.kind).toBe("ok");
if (result.kind === "ok") {
  expect(result.provenance.fingerprint).toBe(result.program.provenance.fingerprint);
}
```

```ts
expect(Object.keys(topLevelExportsForTest())).toContain("optIr");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/pipeline.test.ts ./tests/unit/opt-ir/public-api.test.ts
```

### Task 42: Integration Demonstrations And Optimization Explanations

**Description:** Add integration fixtures for the flagship zero-copy validated packet parser and deterministic debug explanations for eliminated checks, copies, wrappers, parser states, and endian-folded reads.

**Dependencies:** Task 41.

**Files:**

- Test: `tests/integration/opt-ir/packet-parser-demo.test.ts`
- Test: `tests/integration/opt-ir/validated-buffer-optimization.test.ts`
- Test: `tests/integration/opt-ir/fact-preserving-rewrites.test.ts`

**Acceptance Criteria:**

- Proof wrappers, validation wrappers, resource wrappers, and safe field API thunks are gone after mandatory inlining and cleanup.
- Packet/source reads are canonical memory accesses citing bounds, layout, endian, volatility, and path facts.
- Rejected parse paths remain only where semantically observable.
- Derived fields become direct loads, endian decodes, masks, compares, switches, or vector operations.
- Ownership transfers, move/copy helpers, and cleanup paths are removed only with facts proving no runtime work remains.
- Optimized snapshot records every eliminated check, copy, wrapper, and parser state with fact chain and provenance.
- Missing packet-validation attestation, path certificate table, or semantic-inline policy table causes construction failure, not performance fallback.

**Code Examples:**

```ts
const result = buildOptimizedOptIr(packetParserDemoInputForTest());

expect(result.kind).toBe("ok");
if (result.kind === "ok") {
  expect(hasNoProofOrValidationWrappersForTest(result.program)).toBe(true);
  expect(hasCanonicalPacketLoadsForTest(result.program)).toBe(true);
  expect(result.diagnostics).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        message: expect.stringContaining("removed bounds check"),
        stableDetail: expect.stringContaining("facts:"),
      }),
    ]),
  );
}
```

```ts
expect(buildOptimizedOptIr(packetParserMissingSemanticInlinePoliciesForTest()).kind).toBe("error");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/opt-ir/packet-parser-demo.test.ts ./tests/integration/opt-ir/validated-buffer-optimization.test.ts ./tests/integration/opt-ir/fact-preserving-rewrites.test.ts
```

### Task 43: Determinism, Property Tests, Policy Recheck, And Handoff Verification

**Description:** Add final deterministic property coverage, policy tests rejecting forbidden authority sources, stable result keys, and run the complete repository handoff gate.

**Dependencies:** Task 41.

**Files:**

- Create: `tests/support/opt-ir/property-generators.ts`
- Test: `tests/unit/opt-ir/determinism.test.ts`
- Test: `tests/integration/opt-ir/deterministic-output.test.ts`
- Modify: `tests/unit/opt-ir/public-api.test.ts` only for final export assertions if needed

**Acceptance Criteria:**

- Property tests use `fast-check` only in tests.
- Stable result keys cover program, facts, provenance, decision logs, and diagnostics.
- Equivalent checked MIR/target inputs produce identical optimized OptIR under shuffled deterministic table insertion.
- Production policies reject scorecard baselines, benchmark data, host runtime timing, source names, and previous successful compilation choices.
- `bun run agent:check` passes before handoff.

**Code Examples:**

```ts
test("optimized OptIR is deterministic under table insertion order", () => {
  fastCheck.assert(
    fastCheck.property(smallCheckedMirProgramArbitrary(), (program) => {
      const first = buildOptimizedOptIr(inputFromProgramForTest(program));
      const second = buildOptimizedOptIr(inputFromProgramForTest(shuffleTablesForTest(program)));

      expect(optIrResultStableKeyForTest(first)).toBe(optIrResultStableKeyForTest(second));
    }),
  );
});
```

```ts
expect(validateOptimizationPolicyForTest(policyUsingBenchmarkLabelForTest()).kind).toBe("error");
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/opt-ir/determinism.test.ts ./tests/integration/opt-ir/deterministic-output.test.ts
PATH="$HOME/.bun/bin:$PATH" bun run agent:check
```
