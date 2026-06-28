# Proof Resource Checking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the proof and resource checker described in `docs/design/proof-resource-checking-design.md`, including trusted authority authentication, deterministic path-sensitive checking, checked MIR, and the checked fact packet.

**Architecture:** Proof checking is a pure compiler phase after Proof MIR construction. The public API receives one closed `ProofMirProgram`, selected layout facts, selected normalized platform/runtime/type authority catalogs, and a selected proof-semantics companion; it validates all trust boundaries, runs a deterministic checker kernel with a single state reducer, delegates semantic-sensitive judgments through a closed companion adapter, and returns `CheckedMirProgram` plus certified packet facts only on success.

**Tech Stack:** TypeScript, Bun test runner, existing mono/layout/proof-mir models, pure dependency-injected fakes in tests, no runtime dependencies, `fast-check` only in tests.

---

## Research Notes

- Design source: `docs/design/proof-resource-checking-design.md`.
- Current repo already has `src/proof-mir`, `src/runtime`, and `src/target` from the Proof MIR builder implementation. This plan builds on those files instead of recreating that phase.
- There is no `src/proof-check` directory yet.
- `ProofMirProgram` currently has `image`, `functions`, `layout`, `proofMetadata`, `origins`, `facts`, `layoutTerms`, `privateStateGenerations`, `callGraph`, `platformEdges`, `runtimeCatalog`, and `runtimeCalls`; it does not yet expose the explicit `reachableFunctions` set required by the design.
- `ProofMirRuntimeCatalog` currently has `targetId`, `features`, `get`, and `entries`; proof checking needs a selected `ProofCheckRuntimeCatalog` wrapper with authority fingerprint and canonical entry authentication. Do not mutate the current builder-facing runtime API more than needed.
- Existing Proof MIR diagnostics sort by stable keys. Proof-check diagnostics should copy the same deterministic style, but must add template IDs, structured arguments, counterexample paths, root-cause suppression keys, and proof-check-specific diagnostic codes.
- Existing Proof MIR test helpers live in `tests/support/proof-mir`. New proof-check helpers should live in `tests/support/proof-check` and reuse Proof MIR fixtures through public builders and support exports.
- `src/proof-check/index.ts` and the top-level `src/index.ts` are owned only by the final export task. Earlier unit tests import direct implementation files, such as `src/proof-check/diagnostics.ts`, to avoid parallel barrel-file edits.
- The checker must not import frontend, lexer, parser, semantic name resolution, semantic item index internals, HIR lowering internals, Proof MIR lowering internals, optimization, target backends, linkers, PE/COFF, Bun, or filesystem modules.
- Required repository handoff command from `agents.md`:

```bash
PATH="$HOME/.bun/bin:$PATH" bun run agent:check
```

- Useful narrow commands while iterating:

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/diagnostics.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/input-validator.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/state-patch-reducer.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/entailment.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/platform-contract-transfer.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/proof-check/proof-and-resource-checker.test.ts
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/proof-check/deterministic-diagnostics.test.ts
```

## Executor Protocol

Every task is intended to be small enough for one worker. Before starting any task:

- [ ] Read the task description, dependencies, files, acceptance criteria, code examples, and verification commands.
- [ ] Confirm every dependency task has landed.
- [ ] Confirm no same-level task owns the same production files.
- [ ] Write at least one failing test for every acceptance criterion in the task-owned test file. Use the code examples as exact patterns for names, helpers, diagnostics, and assertions, then add sibling tests for the remaining criteria.
- [ ] Run the narrow verification command and confirm the new test fails for the expected missing symbol, missing behavior, or diagnostic mismatch.
- [ ] Implement only the files listed by the task.
- [ ] Run the narrow verification command again and confirm it passes.
- [ ] Run adjacent narrow tests listed by the task.
- [ ] Commit only this task's files. Commit messages created by automation must end with `-Codex Automated`.

## Per-Domain Integration Rule

Domain tasks must land narrow end-to-end coverage as they land, not wait for the final integration sweep. For every domain task listed in the matrix below, the owner must add or extend the named integration test file with:

- one accepted case or fixture-backed accepted case for that domain,
- one rejected case or fixture-backed rejected case for that domain,
- one deterministic diagnostic assertion for the rejected case that checks diagnostic code order plus owner/root-cause keys.

When the current frontend cannot express the exact case before public orchestration exists, use `domainIntegrationFixtureForTest({ source, fixtureFallback })` and name the unsupported syntax in the test title. After Task 36, use `checkProofSourceForTest(source, { fixtureFallback })` for public-API integration coverage. Tasks 37 and 38 are consolidation tasks: they fill any missed cross-domain cases, broaden source-level coverage, and assert packet/result behavior across the assembled checker. They are not the first owner of domain integration coverage.

Before Task 36, domain tasks use the Task 12A domain-integration harness to build source/Proof-MIR fixtures and call the task-owned transfer function directly. After Task 36, Tasks 37 and 38 upgrade representative cases to the public `checkProofAndResources` path through `checkProofSourceForTest`.

The required integration file named in the matrix is part of that domain task's allowed file list even when the task section does not repeat it.

For every matrix task, the task's narrow verification command is amended to include the required integration file. For example, Task 27 must run both `tests/unit/proof-check/validation-transfer.test.ts` and `tests/integration/proof-check/validation-splits.test.ts`.

| Domain Task                              | Required Integration File                                       |
| ---------------------------------------- | --------------------------------------------------------------- |
| Task 18: fact environment and entailment | `tests/integration/proof-check/call-requirements.test.ts`       |
| Task 19: layout and validated buffers    | `tests/integration/proof-check/validated-buffer-bounds.test.ts` |
| Task 20: source-call summary export      | `tests/integration/proof-check/source-call-summaries.test.ts`   |
| Task 21: source-call import              | `tests/integration/proof-check/source-call-summaries.test.ts`   |
| Task 22: platform preconditions          | `tests/integration/proof-check/platform-contracts.test.ts`      |
| Task 23: move/use/consume                | `tests/integration/proof-check/move-use-consume.test.ts`        |
| Task 24: field-sensitive loans           | `tests/integration/proof-check/field-sensitive-loans.test.ts`   |
| Task 25: erasure                         | `tests/integration/proof-check/checked-fact-packet.test.ts`     |
| Task 26: take sessions                   | `tests/integration/proof-check/take-session-closure.test.ts`    |
| Task 27: validation splits               | `tests/integration/proof-check/validation-splits.test.ts`       |
| Task 28: attempt splits                  | `tests/integration/proof-check/attempt-splits.test.ts`          |
| Task 29: private state                   | `tests/integration/proof-check/private-state-threading.test.ts` |
| Task 30: platform effects                | `tests/integration/proof-check/platform-contracts.test.ts`      |
| Task 31: runtime transfer                | `tests/integration/proof-check/platform-contracts.test.ts`      |
| Task 32: loops                           | `tests/integration/proof-check/terminal-graph-checker.test.ts`  |
| Task 33: terminal closure                | `tests/integration/proof-check/terminal-closure.test.ts`        |
| Task 34A: extension gates                | `tests/integration/proof-check/terminal-graph-checker.test.ts`  |
| Task 34B: yield/resume and stream loops  | `tests/integration/proof-check/take-session-closure.test.ts`    |
| Task 34C: cross-core ownership           | `tests/integration/proof-check/platform-contracts.test.ts`      |

## Current Source Syntax Support For Integration Tasks

This list is based on current frontend parser and proof-mir tests. Use it to decide source-level coverage versus fixture fallback.

- Source syntax currently suitable for `checkProofSourceForTest`: `fn` declarations with bodyless or block bodies, parameter lists, return types, `requires:` sections, ordinary expression statements, `let`, `return`, `yield`, `continue`, `loop`, `if`/`else`, `while`, `for`, `match`/`case`, `break`, `ensure`, `take ... as ...`, `take ...`, calls, member access, integer/string/object literals, classes, dataclasses, interfaces, enums, imports, `platform fn`, image declarations, edge classes, stream declarations, validated-buffer declarations with `params:` and `layout:` sections, and validated-buffer field offsets.
- Source syntax that must use `fixtureFallback` unless a task proves it parses and lowers end to end in its own test: compact inline `requires value <= 8 ensures result <= 8`, proof-only `ensures` clauses outside the existing `requires:` block shape, source-level validation/attempt sugar not already accepted by current Proof MIR integration fixtures, cross-core transfer syntax, MoveRing extension syntax, terminal graph declarations beyond existing terminal function forms, and any target-specific extension record syntax.
- Integration helpers must expose `probeProofCheckSourceSyntaxForTest(source)` returning `"supported"` or `"unsupported-source-syntax"` so a junior engineer can check source suitability without reading parser internals.

## File Structure

The implementation should create or modify these files. Each task below owns a subset.

```text
src/
  index.ts
  mono/
    mono-hir.ts
    reachability-finalization.ts
    index.ts
  proof-mir/
    model/program.ts
    proof-mir-builder.ts
    validation/input-compatibility-validator.ts
    index.ts
  runtime/
    runtime-catalog-types.ts
    runtime-catalog.ts
    index.ts
  proof-check/
    index.ts                         # Task 36 only
    proof-checker.ts
    input-contract.ts
    ids.ts
    diagnostics.ts
    authority/
      authority-types.ts
      canonical-serialization.ts
      platform-contracts.ts
      runtime-authority.ts
      type-fact-authority.ts
      semantics-companion.ts
    kernel/
      checker-kernel.ts
      operation-dispatch.ts
      whole-image-driver.ts
      transition-api.ts
      state.ts
      state-key.ts
      state-patch.ts
      state-reducer.ts
      graph-worklist.ts
      counterexample-builder.ts
      resource-limits.ts
      diagnostic-suppression.ts
    model/
      fact-language.ts
      fact-environment.ts
      fact-packet.ts
      checked-mir.ts
      function-summary.ts
      certificates.ts
    domains/
      initial-state.ts
      facts.ts
      layout-entailment.ts
      validated-buffers.ts
      source-calls.ts
      platform-contract-transfer.ts
      runtime-contract-transfer.ts
      ownership.ts
      loans.ts
      erasure.ts
      take-sessions.ts
      validation.ts
      attempts.ts
      private-state.ts
      terminal.ts
      loops.ts
      extension-gates.ts
      yield-resume.ts
      stream-loop.ts
      cross-core-ownership.ts
      extensions.ts
    validation/
      input-validator.ts
      packet-validator.ts

tests/
  support/
    proof-check/
      authority-fakes.ts
      term-fixtures.ts
      state-fixtures.ts
      proof-check-fixtures.ts
      counterexample-fixtures.ts
      property-generators.ts
      integration-fixtures.ts
  unit/
    proof-check/
      diagnostics.test.ts
      public-api.test.ts
      checked-mir-model.test.ts
      packet-envelope-validator.test.ts
      canonical-serialization.test.ts
      authority-catalogs.test.ts
      semantics-companion.test.ts
      fact-normalization.test.ts
      input-validator.test.ts
      proof-check-fixtures.test.ts
      state-key.test.ts
      state-patch-reducer.test.ts
      domain-integration-fixtures.test.ts
      transition-api.test.ts
      operation-dispatch.test.ts
      checker-kernel.test.ts
      resource-limits.test.ts
      diagnostic-suppression.test.ts
      initial-state.test.ts
      resource-kind-lifting.test.ts
      entailment.test.ts
      layout-entailment.test.ts
      source-call-summaries.test.ts
      source-call-transfer.test.ts
      platform-contract-transfer.test.ts
      platform-effects.test.ts
      runtime-contract-transfer.test.ts
      move-use-consume.test.ts
      loan-conflicts.test.ts
      erasure.test.ts
      take-sessions.test.ts
      validation-transfer.test.ts
      attempt-transfer.test.ts
      private-fact-threading.test.ts
      terminal.test.ts
      loop-convergence.test.ts
      extension-gates.test.ts
      yield-resume.test.ts
      stream-loop.test.ts
      cross-core-ownership.test.ts
      extensions.test.ts
      fact-packet-builder.test.ts
      packet-validator.test.ts
  integration/
    proof-check/
      proof-and-resource-checker.test.ts
      call-requirements.test.ts
      source-call-summaries.test.ts
      platform-contracts.test.ts
      move-use-consume.test.ts
      field-sensitive-loans.test.ts
      validation-and-attempts.test.ts
      validation-splits.test.ts
      attempt-splits.test.ts
      take-session-closure.test.ts
      private-state-threading.test.ts
      validated-buffer-bounds.test.ts
      terminal-graph-checker.test.ts
      terminal-closure.test.ts
      deterministic-diagnostics.test.ts
      checked-fact-packet.test.ts
      public-api.test.ts
      property-determinism.test.ts
scripts/
  check-policy.ts
```

## Barrel And Shared-File Ownership

- Task 0 owns the proof-check import-boundary policy in `scripts/check-policy.ts`. This catches forbidden imports from the first proof-check implementation task onward.
- Task 36 is the only task that creates or modifies `src/proof-check/index.ts` and the top-level `src/index.ts`. Every task before Task 36 imports production symbols from direct files in its tests.
- Task 5 owns `src/proof-check/model/certificates.ts`; Task 8 may only import from it, not edit it.
- Task 13 owns `src/proof-check/kernel/state-patch.ts`; Tasks 8 and 14 may only import from it, not edit it.
- Task 15 owns `src/proof-check/kernel/checker-kernel.ts`; domain tasks may only import its extension interfaces until Task 36 wires orchestration.
- Task 12A owns the initial `tests/support/proof-check/integration-fixtures.ts` harness; Task 37 may extend that file with `checkProofSourceForTest` after public orchestration exists.
- Task 39 owns `tests/support/proof-check/property-generators.ts`.
- Any task that needs a helper not listed below must either keep it local to that task's test file or update this helper registry in the same task.

## Shared Test Helper Registry

| Helper                                            | Owning Task                | File                                                         |
| ------------------------------------------------- | -------------------------- | ------------------------------------------------------------ |
| `checkPolicyTextForTest`                          | Task 0                     | `tests/unit/proof-check/import-policy.test.ts`               |
| `emptyProofMirReachableFunctionTableForTest`      | Task 1                     | `tests/unit/proof-mir/input-compatibility-validator.test.ts` |
| `proofMirRuntimeOperationFake`                    | Existing Proof MIR support | `tests/support/proof-mir/proof-mir-fakes.ts`                 |
| `proofMirRuntimeCatalogFake`                      | Existing Proof MIR support | `tests/support/proof-mir/proof-mir-fakes.ts`                 |
| `checkedPacketEnvelopeForTest`                    | Task 5A                    | `tests/unit/proof-check/packet-envelope-validator.test.ts`   |
| `capabilityRequirementForTest`                    | Task 9                     | `tests/support/proof-check/term-fixtures.ts`                 |
| `comparisonTerm`                                  | Task 9                     | `tests/support/proof-check/term-fixtures.ts`                 |
| `valueTerm`                                       | Task 9                     | `tests/support/proof-check/term-fixtures.ts`                 |
| `literalInt`                                      | Task 9                     | `tests/support/proof-check/term-fixtures.ts`                 |
| `proofCheckValueOperandForTest`                   | Task 9                     | `tests/support/proof-check/term-fixtures.ts`                 |
| `factEnvironmentForTest`                          | Task 18                    | `tests/unit/proof-check/entailment.test.ts`                  |
| `activeFactForTest`                               | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `ownedPlaceForTest`                               | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `movedPlaceForTest`                               | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `consumedPlaceForTest`                            | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `proofCheckPlaceForTest`                          | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `exclusiveLoanForTest`                            | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `obligationStateForTest`                          | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `streamSessionForTest`                            | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `streamMemberObligationForTest`                   | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `streamMemberForTest`                             | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `privateGenerationForTest`                        | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `privatePredicateFactForTest`                     | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `privatePredicateRequirementForTest`              | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `proofCheckStateForTest`                          | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `proofCheckStateSnapshotForTest`                  | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `packetSourceForTest`                             | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `proofAuthorityFingerprintForTest`                | Task 11                    | `tests/support/proof-check/authority-fakes.ts`               |
| `proofCheckRuntimeCatalogFake`                    | Task 11                    | `tests/support/proof-check/authority-fakes.ts`               |
| `proofCheckPlatformCatalogFake`                   | Task 11                    | `tests/support/proof-check/authority-fakes.ts`               |
| `proofCheckPlatformContractFake`                  | Task 11                    | `tests/support/proof-check/authority-fakes.ts`               |
| `proofCheckTypeFactCatalogFake`                   | Task 11                    | `tests/support/proof-check/authority-fakes.ts`               |
| `proofSemanticsCompanionFake`                     | Task 11                    | `tests/support/proof-check/authority-fakes.ts`               |
| `proofSemanticsEntailmentOkForTest`               | Task 11                    | `tests/support/proof-check/authority-fakes.ts`               |
| `proofEntailmentRequestForTest`                   | Task 11                    | `tests/support/proof-check/authority-fakes.ts`               |
| `proofCheckDiagnosticForTest`                     | Task 12                    | `tests/support/proof-check/state-fixtures.ts`                |
| `proofCheckClosedFixture`                         | Task 11A                   | `tests/support/proof-check/proof-check-fixtures.ts`          |
| `withProofCheckAuthoritiesForTest`                | Task 11A                   | `tests/support/proof-check/proof-check-fixtures.ts`          |
| `proofCheckProgramWithSingleBlock`                | Task 15                    | `tests/unit/proof-check/checker-kernel.test.ts`              |
| `proofCheckProgramWithBranch`                     | Task 15                    | `tests/unit/proof-check/checker-kernel.test.ts`              |
| `proofCheckProgramWithSourceCall`                 | Task 21                    | `tests/unit/proof-check/source-call-transfer.test.ts`        |
| `proofCheckProgramWithPlatformCall`               | Task 22                    | `tests/unit/proof-check/platform-contract-transfer.test.ts`  |
| `platformTransferInputForTest`                    | Task 22                    | `tests/unit/proof-check/platform-contract-transfer.test.ts`  |
| `platformEffectInputForTest`                      | Task 30                    | `tests/unit/proof-check/platform-effects.test.ts`            |
| `initializedPrefixAdvanceWhenContiguousForTest`   | Task 30                    | `tests/unit/proof-check/platform-effects.test.ts`            |
| `layoutFitsFactForTest`                           | Task 19                    | `tests/unit/proof-check/layout-entailment.test.ts`           |
| `payloadReadForTest`                              | Task 19                    | `tests/unit/proof-check/layout-entailment.test.ts`           |
| `summaryFactForTest`                              | Task 20                    | `tests/unit/proof-check/source-call-summaries.test.ts`       |
| `checkedFunctionForTest`                          | Task 20                    | `tests/unit/proof-check/source-call-summaries.test.ts`       |
| `validationSplitForTest`                          | Task 27                    | `tests/unit/proof-check/validation-transfer.test.ts`         |
| `attemptSplitForTest`                             | Task 28                    | `tests/unit/proof-check/attempt-transfer.test.ts`            |
| `loopConvergenceInputForTest`                     | Task 32                    | `tests/unit/proof-check/loop-convergence.test.ts`            |
| `terminalGraphForTest`                            | Task 33                    | `tests/unit/proof-check/terminal.test.ts`                    |
| `extensionGateInputForTest`                       | Task 34A                   | `tests/unit/proof-check/extension-gates.test.ts`             |
| `yieldResumeInputForTest`                         | Task 34B                   | `tests/unit/proof-check/yield-resume.test.ts`                |
| `crossCoreOwnershipInputForTest`                  | Task 34C                   | `tests/unit/proof-check/cross-core-ownership.test.ts`        |
| `proofCheckStatePatchForTest`                     | Task 13                    | `tests/unit/proof-check/state-patch-reducer.test.ts`         |
| `domainIntegrationFixtureForTest`                 | Task 12A                   | `tests/support/proof-check/integration-fixtures.ts`          |
| `probeProofCheckSourceSyntaxForTest`              | Task 12A                   | `tests/support/proof-check/integration-fixtures.ts`          |
| `expectProofCheckDiagnosticOrderForTest`          | Task 12A                   | `tests/support/proof-check/integration-fixtures.ts`          |
| `transitionForTest`                               | Task 14                    | `tests/unit/proof-check/transition-api.test.ts`              |
| `proofCheckOperationForTest`                      | Task 14A                   | `tests/unit/proof-check/operation-dispatch.test.ts`          |
| `emptyProofCheckOperationTransferRegistryForTest` | Task 14A                   | `tests/unit/proof-check/operation-dispatch.test.ts`          |
| `proofCheckCounterexampleFixture`                 | Task 15                    | `tests/support/proof-check/counterexample-fixtures.ts`       |
| `runProofCheckKernelForTest`                      | Task 15                    | `tests/unit/proof-check/checker-kernel.test.ts`              |
| `proofCheckResourceLimitsForTest`                 | Task 15A                   | `tests/unit/proof-check/resource-limits.test.ts`             |
| `proofCheckProgramPointForTest`                   | Task 15A                   | `tests/unit/proof-check/resource-limits.test.ts`             |
| `initialStateInputForTest`                        | Task 16                    | `tests/unit/proof-check/initial-state.test.ts`               |
| `checkedTypeForTest`                              | Task 17                    | `tests/unit/proof-check/resource-kind-lifting.test.ts`       |
| `optionTypeForTest`                               | Task 17                    | `tests/unit/proof-check/resource-kind-lifting.test.ts`       |
| `proofOnlyValueForTest`                           | Task 25                    | `tests/unit/proof-check/erasure.test.ts`                     |
| `checkedFactPacketForTest`                        | Task 35                    | `tests/unit/proof-check/packet-validator.test.ts`            |
| `ownershipFactForTest`                            | Task 35                    | `tests/unit/proof-check/packet-validator.test.ts`            |
| `checkProofSourceForTest`                         | Task 37                    | `tests/support/proof-check/integration-fixtures.ts`          |
| `smallProofMirProgramArbitrary`                   | Task 39                    | `tests/support/proof-check/property-generators.ts`           |
| `proofCheckResultStableKey`                       | Task 39                    | `tests/support/proof-check/property-generators.ts`           |
| `checkedFactPacketStableKeysForTest`              | Task 39                    | `tests/support/proof-check/property-generators.ts`           |
| `stableJsonForTest`                               | Task 39                    | `tests/support/proof-check/property-generators.ts`           |

## Parallel Execution Model

Tasks in the same level are an antichain: after all dependencies listed for that level are complete, those tasks can be dispatched to separate subagents without shared-file ownership conflicts. Use the task-level dependency list as the source of truth if a scheduler works from individual tasks instead of levels.

```text
Level 0:
  Task 0: Proof-check import-boundary policy and shared-file rules
  Task 1: Reachable function closure inputs
  Task 3: Proof-check IDs and diagnostics

Level 1:
  Task 2 after Task 3: Authority fingerprint base types and runtime catalog fingerprints
  Task 5 after Task 3: Checked MIR and fact packet model
  Task 9 after Task 3: Fact and requirement term language plus term fixtures

Level 2:
  Task 5A after Tasks 2 and 5: Packet envelope validator skeleton
  Task 6 after Task 2: Canonical authority serialization
  Task 12 after Tasks 5 and 9: State model, keys, snapshots, and state fixtures

Level 3:
  Task 7 after Tasks 2, 3, 6, and 9: Platform, runtime, and type authority catalogs
  Task 12A after Task 12: Domain integration fixture harness
  Task 13 after Task 12: State patch reducer
  Task 17 after Tasks 9 and 12: Resource kind lifting and structured places

Level 4:
  Task 8 after Tasks 3, 5, 6, and 13: Semantics companion envelope validation
  Task 14 after Tasks 5, 12, and 13: Transition API and staged packet entries
  Task 16 after Tasks 7, 9, 12, and 13: Initial state and unique-root seeding
  Task 18 after Tasks 9, 12, 12A, and 13: Fact environment and core entailment
  Task 24 after Tasks 12A, 13, and 17: Field-sensitive loans and noalias

Level 5:
  Task 4 after Tasks 5, 7, and 8: Public API skeleton
  Task 11 after Tasks 5, 7, 8, and 9: Authority fakes
  Task 14A after Task 14: Proof-check operation dispatch registry
  Task 19 after Tasks 9, 12, and 18: Layout entailment and validated-buffer requirements
  Task 23 after Tasks 13, 17, and 18: Move, use, consume, and ownership transfer
  Task 29 after Tasks 13 and 18: Private-state threading

Level 6:
  Task 10 after Tasks 1, 4, 5, 7, 8, and 11: Input contract validator
  Task 25 after Tasks 13, 18, 23, and 24: Erasure certification
  Task 26 after Tasks 13, 18, 23, and 24: Take sessions and obligations

Level 7:
  Task 15 after Tasks 10, 12, 13, 14, and 14A: Graph worklist, joins, and counterexamples

Level 8:
  Task 15A after Task 15: Resource limits and diagnostic suppression
  Task 20 after Tasks 14, 15, 16, and 18: Source-call summary export
  Task 22 after Tasks 7, 13, 18, 19, 23, and 24: Platform preconditions and capabilities
  Task 27 after Tasks 19, 23, and 26: Validation split transfer
  Task 28 after Tasks 13, 23, and 24: Attempt split transfer

Level 9:
  Task 11A after Tasks 10, 11, 12, and 15A: Closed fixture authority synthesis
  Task 21 after Tasks 15, 18, and 20: Source-call import and whole-image driver
  Task 30 after Tasks 7, 13, 18, 22, and 29: Platform guarded effects and invalidation
  Task 32 after Tasks 8, 11, 13, 15, 15A, 18, and 29: Companion joins and loop convergence

Level 10:
  Task 31 after Tasks 7, 11, 13, 18, 22, and 30: Runtime catalog authentication and transfer
  Task 34A after Tasks 8, 11, 13, 22, 26, 29, and 32: Extension gate transfer
  Task 34B after Tasks 8, 11, 13, 22, 26, 29, and 32: Yield/resume and stream-loop transfer

Level 11:
  Task 33 after Tasks 13, 15, 21, 22, 26, and 31: Terminal, divergence, and panic closure
  Task 34C after Tasks 8, 11, 13, 22, 29, 31, and 32: Cross-core ownership transfer

Level 12:
  Task 34D after Tasks 34A, 34B, and 34C: Extension dispatch facade

Level 13:
  Task 35 after Tasks 5, 5A, 13, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 33, 34A, 34B, 34C, and 34D: Fact packet builder and packet validator

Level 14:
  Task 36 after Tasks 10, 11A, 14A, 15, 15A, 21, 33, 34D, and 35: Public orchestration and exports

Level 15:
  Task 37 after Tasks 11A and 36: Integration suite for calls, resources, sessions, validation, attempts, and private state
  Task 38 after Tasks 11A and 36: Integration suite for layout, platform/runtime, terminal, loops, extensions, and packets
  Task 39 after Tasks 11A and 36: Property generator and stable result keys

Level 16:
  Task 40 after Tasks 37, 38, and 39: Determinism, policy recheck, and handoff verification
```

---

### Task 0: Proof-Check Import-Boundary Policy And Shared-File Rules

**Description:** Add the proof-check dependency-boundary rule before implementation starts and document the no-early-barrel policy in a small test-owned fixture README. This task prevents forbidden imports from landing during domain work and avoids shared barrel-file edits.

**Dependencies:** None.

**Files:**

- Modify: `scripts/check-policy.ts`
- Create: `tests/support/proof-check/README.md`
- Test: `tests/unit/proof-check/import-policy.test.ts`

**Acceptance Criteria:**

- `scripts/check-policy.ts` exposes a pure `checkPolicyTextForTest(input)` helper, a pure `checkPolicyFileText(filePath, sourceText)` helper, and a `runPolicyCheck()` CLI function; the module only executes the CLI when run as the entrypoint, so importing it from unit tests never scans the repository.
- `scripts/check-policy.ts` rejects `src/proof-check/**` imports from frontend, lexer, parser, semantic names, semantic item index, HIR lowering internals, Proof MIR lowering/draft/canonicalization internals, optimization, target backends, codegen, linker, PE/COFF, Bun, and filesystem modules.
- `src/proof-check` is allowed to import public model/API files from `src/proof-mir`, `src/layout`, `src/mono`, `src/runtime`, `src/semantic/ids`, `src/semantic/surface/resource-kind`, and shared diagnostics/source-origin types.
- The policy test writes temporary source strings into the policy checker helper and verifies one allowed import and one forbidden import.
- `tests/support/proof-check/README.md` states that shared helpers may only be added by the owning task in the helper registry above.
- No `src/proof-check/index.ts` or `src/index.ts` changes are made in this task.

**Code Examples:**

```ts
test("proof-check import policy rejects Proof MIR lowering internals", () => {
  const violations = checkPolicyTextForTest({
    filePath: "src/proof-check/domains/source-calls.ts",
    sourceText: 'import { lowerProofMirFunction } from "../proof-mir/lower/function-lowerer";',
  });

  expect(violations.map((violation) => violation.message)).toContain(
    "src/proof-check must not import frontend, lexer, parser, semantic internals, HIR lowering internals, Proof MIR lowering internals, optimization, target backend, linker, PE-COFF, Bun, or filesystem modules.",
  );
});
```

```ts
const proofCheckForbiddenModulePathPatterns = [
  /[^"']*\/frontend\//,
  /[^"']*\/lexer\//,
  /[^"']*\/parser\//,
  /[^"']*\/semantic\/names\//,
  /[^"']*\/semantic\/item-index\//,
  /[^"']*\/hir\/.*lowerer/,
  /[^"']*\/proof-mir\/(?:lower|draft|canonicalization)\//,
  /[^"']*\/(?:opt|optimization|codegen|linker)\//,
  /[^"']*(?:aarch64|pe-coff)/i,
  /(?:bun:|node:fs|node:path|node:os|node:process|fs|path|os|process)/,
] as const;
```

```ts
if (import.meta.main) {
  await runPolicyCheck();
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/import-policy.test.ts
PATH="$HOME/.bun/bin:$PATH" bun run policy:check
```

### Task 1: Reachable Function Closure Inputs

**Description:** Add explicit reachable-function closure records to mono and Proof MIR so proof checking can ignore dead tables for semantic checking while still structurally validating them.

**Dependencies:** None.

**Files:**

- Modify: `src/mono/mono-hir.ts`
- Modify: `src/mono/reachability-finalization.ts`
- Modify: `src/mono/index.ts`
- Modify: `src/proof-mir/model/program.ts`
- Modify: `src/proof-mir/proof-mir-builder.ts`
- Modify: `src/proof-mir/validation/input-compatibility-validator.ts`
- Modify: `src/proof-mir/index.ts`
- Test: `tests/unit/mono/mono-hir.test.ts`
- Test: `tests/unit/proof-mir/input-compatibility-validator.test.ts`
- Test: `tests/integration/proof-mir/proof-mir-builder.test.ts`

**Acceptance Criteria:**

- `MonoReachableFunction` exists with `functionInstanceId`, deterministic `reason`, and `origin`.
- `MonomorphizedHirProgram.reachableFunctions` is deterministic and includes all external roots.
- `ProofMirProgram.reachableFunctions` is copied from mono during Proof MIR build.
- Proof MIR input compatibility rejects a reachable function missing from the function table and rejects an external root outside the reachable set.
- Functions outside `reachableFunctions` remain allowed in `ProofMirProgram.functions` for structural validation.

**Code Examples:**

```ts
test("proof mir preserves explicit reachable function closure", () => {
  const input = proofMirBuildInputForSource("fn main() -> Never:\n    panic()\n");
  const result = buildProofMir(input);

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;

  expect(result.mir.reachableFunctions.entries().map((entry) => entry.reason)).toEqual([
    "imageEntry",
  ]);
  expect(result.mir.reachableFunctions.has(result.mir.image.entryFunctionInstanceId)).toBe(true);
});
```

```ts
export interface MonoReachableFunction {
  readonly functionInstanceId: MonoInstanceId;
  readonly reason:
    | "imageEntry"
    | "deviceHandler"
    | "hardwareCallback"
    | "targetRequired"
    | "sourceCall";
  readonly origin: HirOriginId;
}

export interface ProofMirReachableFunction {
  readonly functionInstanceId: MonoInstanceId;
  readonly reason: MonoReachableFunction["reason"];
  readonly origin: ProofMirOriginId;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/mono/mono-hir.test.ts ./tests/unit/proof-mir/input-compatibility-validator.test.ts ./tests/integration/proof-mir/proof-mir-builder.test.ts
```

---

### Task 2: Authority Fingerprint Base Types And Runtime Catalog Fingerprints

**Description:** Define the shared authority fingerprint type early, then extend runtime catalog entries with stable proof-check authority metadata while preserving existing Proof MIR builder behavior.

**Dependencies:** Task 3.

**Files:**

- Create: `src/proof-check/authority/authority-types.ts`
- Modify: `src/runtime/runtime-catalog-types.ts`
- Modify: `src/runtime/runtime-catalog.ts`
- Modify: `src/runtime/index.ts`
- Test: `tests/unit/proof-mir/runtime-catalog-types.test.ts`

**Acceptance Criteria:**

- `ProofAuthorityFingerprint` exists in `src/proof-check/authority/authority-types.ts` with `authorityKind`, `targetId`, `version`, `digestAlgorithm`, and `digestHex`.
- Runtime catalog construction accepts an optional `fingerprint: ProofAuthorityFingerprint` and deterministic `authorityKey` per entry.
- Existing builder-facing tests pass without requiring callers to provide proof-check authority metadata.
- A helper can compare two runtime catalogs by target, features, operation IDs, authority keys, and normalized entry content.
- Runtime catalog fingerprints never include host paths, timestamps, object identity, or display-only labels.

**Code Examples:**

```ts
test("runtime catalog exposes deterministic authority keys", () => {
  const result = runtimeCatalog({
    targetId: targetId("uefi-aarch64"),
    features: ["timer", "net"],
    fingerprint: runtimeAuthorityFingerprintForRuntimeCatalogTest("uefi-aarch64", "runtime-v1"),
    entries: [
      proofMirRuntimeOperationFake({
        runtimeId: proofMirRuntimeOperationId(7),
        name: "panic_abort",
        authorityKey: "runtime:panic_abort",
      }),
    ],
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.catalog.entries()[0]?.authorityKey).toBe("runtime:panic_abort");
});
```

```ts
function runtimeAuthorityFingerprintForRuntimeCatalogTest(
  targetName: string,
  version: string,
): ProofAuthorityFingerprint {
  return {
    authorityKind: "runtime",
    targetId: targetId(targetName),
    version,
    digestAlgorithm: "sha256",
    digestHex: "00".repeat(32),
  };
}
```

```ts
export interface ProofMirRuntimeOperation {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly name: string;
  readonly authorityKey?: string;
  readonly targetAvailability: ProofMirRuntimeTargetAvailability;
  readonly requiredFactSchemas: readonly ProofMirRuntimeFactSchema[];
  readonly consumedCapabilitySchemas: readonly ProofMirRuntimePlaceSchema[];
  readonly producedCapabilitySchemas: readonly ProofMirRuntimePlaceSchema[];
  readonly effectSchemas: readonly ProofMirRuntimeEffectSchema[];
  readonly abi: ProofMirRuntimeAbiReference;
  readonly loweringOwner: ProofMirRuntimeLoweringOwner;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-mir/runtime-catalog-types.test.ts
```

---

### Task 3: Proof-Check IDs And Diagnostics

**Description:** Create proof-check branded IDs, diagnostic codes, diagnostic construction, deterministic sorting, and counterexample shell types.

**Dependencies:** None.

**Files:**

- Create: `src/proof-check/ids.ts`
- Create: `src/proof-check/diagnostics.ts`
- Test: `tests/unit/proof-check/diagnostics.test.ts`

**Acceptance Criteria:**

- Branded dense IDs exist for proof-check transitions, certificates, packet facts, path certificates, semantics certificates, and summary instantiation certificates.
- `PROOF_CHECK_DIAGNOSTIC_CODES` is the complete closed list below; subsequent tasks may not add proof-check diagnostic codes without explicitly updating this plan.
- `proofCheckDiagnostic` accepts a raw string code in its input, validates and brands it internally, and returns a public diagnostic whose `code` field is `ProofCheckDiagnosticCode`.
- `sortProofCheckDiagnostics` ignores rendered `message` and sorts by origin, function, path frame, code, owner key, root cause key, stable detail.
- Counterexample path and state snapshot shell types exist for dependent tasks.

**Code Examples:**

```ts
test("proof-check diagnostics sort by stable identity, not rendered message", () => {
  const diagnostics = [
    proofCheckDiagnostic({
      severity: "error",
      code: "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
      messageTemplateId: "requirement.missing",
      messageArguments: [{ kind: "text", value: "second" }],
      message: "different rendered text",
      ownerKey: "owner:b",
      rootCauseKey: "missing:fact",
      stableDetail: "fact:b",
    }),
    proofCheckDiagnostic({
      severity: "error",
      code: "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
      messageTemplateId: "requirement.missing",
      messageArguments: [{ kind: "text", value: "first" }],
      message: "rendered text",
      ownerKey: "owner:a",
      rootCauseKey: "missing:fact",
      stableDetail: "fact:a",
    }),
  ];

  expect(sortProofCheckDiagnostics(diagnostics).map((diagnostic) => diagnostic.ownerKey)).toEqual([
    "owner:a",
    "owner:b",
  ]);
});
```

```ts
export const PROOF_CHECK_DIAGNOSTIC_CODES = [
  "PROOF_CHECK_INPUT_CONTRACT_INVALID",
  "PROOF_CHECK_TARGET_MISMATCH",
  "PROOF_CHECK_LAYOUT_AUTHORITY_MISMATCH",
  "PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED",
  "PROOF_CHECK_INVALID_AUTHORITY_FINGERPRINT",
  "PROOF_CHECK_DUPLICATE_AUTHORITY_ENTRY",
  "PROOF_CHECK_PLATFORM_CONTRACT_MISSING",
  "PROOF_CHECK_TYPE_FACT_AUTHORITY_MISSING",
  "PROOF_CHECK_REACHABLE_CLOSURE_INVALID",
  "PROOF_CHECK_SOURCE_CALL_CYCLE",
  "PROOF_CHECK_MISSING_COMPANION_JUDGMENT",
  "PROOF_CHECK_INVALID_SEMANTICS_CERTIFICATE",
  "PROOF_CHECK_INVALID_STATE_PATCH",
  "PROOF_CHECK_DIVERGENT_JOIN",
  "PROOF_CHECK_DIVERGENT_SPLIT_STATE",
  "PROOF_CHECK_RESOURCE_LIMIT_EXCEEDED",
  "PROOF_CHECK_UNSATISFIED_REQUIREMENT",
  "PROOF_CHECK_UNTRUSTED_FACT",
  "PROOF_CHECK_STALE_FACT",
  "PROOF_CHECK_CONTRADICTORY_FACT",
  "PROOF_CHECK_FORGED_TRUSTED_AXIOM",
  "PROOF_CHECK_MISSING_LAYOUT_ENTAILMENT",
  "PROOF_CHECK_USE_AFTER_MOVE",
  "PROOF_CHECK_USE_AFTER_CONSUME",
  "PROOF_CHECK_CONFLICTING_LOAN",
  "PROOF_CHECK_LEAKED_LOAN",
  "PROOF_CHECK_LEAKED_OBLIGATION",
  "PROOF_CHECK_LEAKED_SESSION_MEMBER",
  "PROOF_CHECK_LEAKED_VALIDATION",
  "PROOF_CHECK_LEAKED_PACKET",
  "PROOF_CHECK_WRONG_SESSION_DISCHARGE",
  "PROOF_CHECK_PRIVATE_STATE_ADVANCE_MISMATCH",
  "PROOF_CHECK_INVALID_VALIDATION_SPLIT",
  "PROOF_CHECK_INVALID_ATTEMPT_SPLIT",
  "PROOF_CHECK_PLATFORM_PRECONDITION_FAILED",
  "PROOF_CHECK_PLATFORM_CAPABILITY_FLOW_MISMATCH",
  "PROOF_CHECK_RUNTIME_PRECONDITION_FAILED",
  "PROOF_CHECK_SOURCE_CALL_SUMMARY_MISMATCH",
  "PROOF_CHECK_UNIQUE_ROOT_DUPLICATE",
  "PROOF_CHECK_WRAPPER_RESOURCE_LEAK",
  "PROOF_CHECK_INVALID_PACKET_SOURCE",
  "PROOF_CHECK_INVALID_ERASURE",
  "PROOF_CHECK_INVALID_PANIC_CLOSURE",
  "PROOF_CHECK_TERMINAL_CLOSURE_MISSING",
  "PROOF_CHECK_UNSAFE_EXTENSION",
  "PROOF_CHECK_INVALID_YIELD_BOUNDARY",
  "PROOF_CHECK_CROSS_CORE_CERTIFICATE_MISSING",
  "PROOF_CHECK_LOOP_CONVERGENCE_FAILED",
  "PROOF_CHECK_INVALID_FACT_PACKET",
  "PROOF_CHECK_INVALID_ORIGIN_MAPPING",
] as const;
```

```ts
export interface ProofCheckDiagnostic {
  readonly severity: "error" | "warning" | "note";
  readonly code: ProofCheckDiagnosticCode;
  readonly messageTemplateId: ProofCheckDiagnosticTemplateId;
  readonly messageArguments: readonly ProofCheckDiagnosticArgument[];
  readonly message: string;
  readonly counterexample?: ProofCounterexamplePath;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly order: ProofCheckDiagnosticOrder;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/diagnostics.test.ts
```

---

### Task 4: Public API Skeleton

**Description:** Add the `src/proof-check` public module with the requested input and result types, plus a fail-closed facade that returns an input-contract diagnostic until the kernel is wired.

**Dependencies:** Tasks 5, 7, and 8.

**Files:**

- Create: `src/proof-check/proof-checker.ts`
- Create: `src/proof-check/input-contract.ts`
- Test: `tests/unit/proof-check/public-api.test.ts`

**Acceptance Criteria:**

- `CheckProofAndResourcesInput`, `CheckProofAndResourcesResult`, `ProofCheckNonErrorDiagnostic`, and `checkProofAndResources` are exported from `src/proof-check/proof-checker.ts`.
- This task does not create or modify `src/proof-check/index.ts` or `src/index.ts`; Task 36 owns public barrel exports.
- The temporary facade fails closed with a `PROOF_CHECK_INPUT_CONTRACT_INVALID` diagnostic until Task 36 replaces it with real orchestration.
- The API never accepts raw requirement-surface placeholders.
- `CheckProofAndResourcesInput.limits` is required and is the selected target profile's deterministic proof-check limit set.
- `minimalCheckProofAndResourcesInputForTask4` and its `*ForPublicApiTest` helpers are local to `public-api.test.ts`; they are not exported through shared test support.

**Code Examples:**

```ts
test("public proof-check facade fails closed before kernel orchestration", () => {
  const result = checkProofAndResources(minimalCheckProofAndResourcesInputForTask4());

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_INPUT_CONTRACT_INVALID"),
  );
});
```

```ts
function minimalCheckProofAndResourcesInputForTask4(): CheckProofAndResourcesInput {
  return {
    mir: proofMirProgramForPublicApiTest(),
    layout: layoutFactProgramForPublicApiTest(),
    limits: proofCheckResourceLimitsForPublicApiTest(),
    platformContracts: proofCheckPlatformContractCatalogForPublicApiTest(),
    runtimeCatalog: proofCheckRuntimeCatalogForPublicApiTest(),
    typeFacts: proofCheckTypeFactCatalogForPublicApiTest(),
    semantics: proofSemanticsCompanionForPublicApiTest(),
  };
}
```

```ts
export interface CheckProofAndResourcesInput {
  readonly mir: ProofMirProgram;
  readonly layout: LayoutFactProgram;
  readonly limits: ProofCheckResourceLimits;
  readonly platformContracts: ProofCheckPlatformContractCatalog;
  readonly runtimeCatalog: ProofCheckRuntimeCatalog;
  readonly typeFacts: ProofCheckTypeFactCatalog;
  readonly semantics: ProofSemanticsCompanion;
}

export interface ProofCheckResourceLimits {
  readonly maximumReachableFunctions: number;
  readonly maximumBlocksPerFunction: number;
  readonly maximumEdgesPerFunction: number;
  readonly maximumAcceptedStateVariantsPerBlock: number;
  readonly maximumActiveFactsPerState: number;
  readonly maximumActiveLoansPerState: number;
  readonly maximumOpenObligationsPerState: number;
  readonly maximumOpenValidationsPerState: number;
  readonly maximumOpenAttemptsPerState: number;
  readonly maximumLiveCapabilitiesPerState: number;
  readonly maximumCounterexampleFrames: number;
  readonly maximumStagedPacketEntriesPerFunction: number;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/public-api.test.ts
```

---

### Task 5: Checked MIR And Fact Packet Model

**Description:** Define checked MIR wrapper types, function summaries, certificate unions, packet entries, packet scopes, dependencies, invalidations, and closed packet fact kinds.

**Dependencies:** Task 3.

**Files:**

- Create: `src/proof-check/model/checked-mir.ts`
- Create: `src/proof-check/model/fact-packet.ts`
- Create: `src/proof-check/model/function-summary.ts`
- Create: `src/proof-check/model/certificates.ts`
- Test: `tests/unit/proof-check/checked-mir-model.test.ts`

**Acceptance Criteria:**

- `CheckedMirProgram` preserves the accepted `ProofMirProgram` instead of duplicating CFG shape.
- `CheckedFunctionSummary` includes `functionInstanceId`, `requiredFacts`, `observedInputs`, `consumedInputs`, `mutatedInputs`, `producedPlaces`, `returnedFacts`, `invalidatedFacts`, `privateStateEffects`, `producedCapabilities`, `terminalEffects`, `divergence`, and `certificateId`.
- `CheckedFactPacket` has exactly these packet arrays: `ownership`, `noalias`, `fieldDisjointness`, `erasures`, `validatedBuffers`, `packetSources`, `privateState`, `platformEffects`, `capabilityFlow`, `terminalClosure`, `exitClosure`, `layoutAbi`, and `origins`.
- Packet entry envelopes carry fact ID, kind, subject, scope, dependencies, invalidations, certificate, and origin.
- Certificate ID union supports core, semantics, and summary-instantiation certificates.
- Packet fact kinds are exactly `"ownership" | "noalias" | "fieldDisjointness" | "erasure" | "validatedBuffer" | "packetSource" | "privateState" | "platformEffect" | "capabilityFlow" | "terminalClosure" | "exitClosure" | "layoutAbi" | "origin"` and have branded `CheckedFactKindId` helpers.

**Code Examples:**

```ts
test("checked fact packet kind table rejects unknown fact kind labels", () => {
  expect(() => checkedFactKindId("ownership")).not.toThrow();
  expect(() => checkedFactKindId("not-a-proof-check-fact")).toThrow(RangeError);
});
```

```ts
export interface CheckedMirProgram {
  readonly mir: ProofMirProgram;
  readonly checkedFunctions: CheckedMirFunctionTable;
  readonly summaries: CheckedFunctionSummaryTable;
  readonly facts: CheckedFactPacket;
  readonly terminalGraph: CheckedTerminalGraphCertificate;
  readonly originMap: CheckedOriginMap;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/checked-mir-model.test.ts
```

---

### Task 5A: Packet Envelope Validator Skeleton

**Description:** Define the reusable packet envelope validator early so domain tasks can validate their own packet categories as they land. This task does not know domain-specific subject semantics; it validates the common packet wrapper, dependency, invalidation, certificate, and sorting contract from Task 5.

**Dependencies:** Tasks 2 and 5.

**Files:**

- Create: `src/proof-check/validation/packet-validator.ts`
- Test: `tests/unit/proof-check/packet-envelope-validator.test.ts`

**Acceptance Criteria:**

- `validateCheckedFactPacketEnvelope` validates a single `CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>` without requiring all packet categories to exist.
- The validator accepts only the fact kinds from Task 5 and rejects unknown branded strings even when cast by a caller.
- Dependency kinds are exactly `proofMirNode`, `layoutFact`, `authorityFingerprint`, `coreCertificate`, `semanticsCertificate`, `summaryInstantiationCertificate`, `packetSource`, and `privateGeneration`.
- Invalidation kinds are exactly `placeMutation`, `placeMove`, `placeConsume`, `loanConflict`, `privateStateAdvance`, `platformEffect`, `runtimeEffect`, `packetSourceSplit`, `callResultRewrite`, `cfgRewrite`, `abiRewrite`, and `authorityChange`.
- Envelope validation rejects empty subject keys, empty validity scopes, missing certificate references, duplicate dependency keys, duplicate invalidation keys, and certificate kinds that cannot prove the entry's fact kind.
- `sortCheckedFactPacketEntries` sorts by fact kind, subject key, validity scope key, certificate key, and origin key.
- Domain tasks may import this validator but may not edit `packet-validator.ts` until Task 35; each domain task owns additional subject-specific tests in its own unit and integration files.

**Code Examples:**

```ts
test("packet envelope rejects duplicate dependency keys", () => {
  const entry = checkedPacketEnvelopeForTest({
    kind: checkedFactKindId("ownership"),
    dependencies: [
      { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
      { kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(1) },
    ],
  });

  const diagnostics = validateCheckedFactPacketEnvelope(entry);

  expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
});
```

```ts
export type CheckedFactPacketDependency =
  | { readonly kind: "proofMirNode"; readonly nodeKey: string }
  | { readonly kind: "layoutFact"; readonly layoutKey: string }
  | { readonly kind: "authorityFingerprint"; readonly fingerprint: ProofAuthorityFingerprint }
  | { readonly kind: "coreCertificate"; readonly certificateId: ProofCheckCoreCertificateId }
  | { readonly kind: "semanticsCertificate"; readonly certificateId: ProofSemanticsCertificateId }
  | {
      readonly kind: "summaryInstantiationCertificate";
      readonly certificateId: CheckedSummaryInstantiationCertificateId;
    }
  | { readonly kind: "packetSource"; readonly packetSourceKey: string }
  | { readonly kind: "privateGeneration"; readonly generationKey: string };
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/packet-envelope-validator.test.ts
```

---

### Task 6: Canonical Authority Serialization

**Description:** Implement injective canonical serialization and SHA-256 fingerprint construction for authority schemas.

**Dependencies:** Task 2.

**Files:**

- Create: `src/proof-check/authority/canonical-serialization.ts`
- Test: `tests/unit/proof-check/canonical-serialization.test.ts`

**Acceptance Criteria:**

- Serializer implements exactly these grammar variants: absent, bool, int, string, bytes, id, array, map, record, and union.
- Record fields serialize with explicit field tags; maps sort by serialized key; arrays can be serialized in caller-provided order or sorted by a declared key.
- Integers serialize as signed base-10 mathematical strings with no leading zeroes except `+0`.
- Strings are UTF-8 length-delimited and reject unpaired surrogate input.
- Fingerprint helper produces the `ProofAuthorityFingerprint` type created in Task 2 with target ID, authority kind, version, `sha256`, and hex digest.
- Golden vectors cover empty record, nested record, union variant, absent optional, and a record with a non-ASCII label excluded from payload.

**Code Examples:**

```ts
test("canonical serialization length-delimits strings and includes field tags", () => {
  const bytes = serializeProofAuthorityValue({
    kind: "record",
    recordKind: "Example",
    fields: [
      { name: "name", value: { kind: "string", value: "ab:c" } },
      { name: "count", value: { kind: "int", value: 12n } },
    ],
  });

  expect(new TextDecoder().decode(bytes)).toBe("RExample:2:F4:nameS4:ab:cF5:countI+2:12");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/canonical-serialization.test.ts
```

---

### Task 7: Platform, Runtime, And Type Authority Catalogs

**Description:** Define normalized proof-check authority catalogs for platform contracts, runtime operations, and type-intrinsic facts.

**Dependencies:** Tasks 2, 3, 6, and 9.

**Files:**

- Create: `src/proof-check/authority/platform-contracts.ts`
- Create: `src/proof-check/authority/runtime-authority.ts`
- Create: `src/proof-check/authority/type-fact-authority.ts`
- Test: `tests/unit/proof-check/authority-catalogs.test.ts`

**Acceptance Criteria:**

- `ProofCheckPlatformContractCatalog` resolves by target ID, primitive ID, and contract ID.
- `ProofCheckRuntimeCatalog` wraps selected runtime operations with fingerprint, target ID, features, canonical entry keys, and normalized entries.
- `ProofCheckTypeFactCatalog` looks up entries by concrete type, brand, capability kind, and live-value scope.
- Platform contracts store normalized `ProofCheckRequirementTerm[]` preconditions, `ProofCheckFactTerm[]` postconditions, guarded postconditions, consumed capabilities, produced capabilities, effects, and `authorityKey`.
- Type-fact entries store concrete type, optional brand, optional capability kind, fact schemas, and invalidation entries from the exact invalidation union in Task 9.
- Catalog constructors normalize target-surface placeholders into `ProofCheckRequirementTerm` and `ProofCheckFactTerm` before storage; raw placeholders are rejected and never exposed to the checker.
- Duplicate authority keys are rejected deterministically.
- Display labels are allowed for diagnostics but are excluded from authority equality and fingerprinting.
- `authorityCatalogFingerprintForTask7Test` and `platformContractEntryForTask7Test` are local helpers in `authority-catalogs.test.ts`; they are not exported through shared test support.

**Code Examples:**

```ts
test("platform catalog rejects duplicate authority keys", () => {
  const result = proofCheckPlatformContractCatalog({
    fingerprint: authorityCatalogFingerprintForTask7Test(
      "platform",
      "uefi-aarch64",
      "contracts-v1",
    ),
    entries: [
      platformContractEntryForTask7Test({ authorityKey: "platform:send" }),
      platformContractEntryForTask7Test({ authorityKey: "platform:send" }),
    ],
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_DUPLICATE_AUTHORITY_ENTRY"),
  );
});
```

```ts
export interface ProofCheckRuntimeCatalog {
  readonly fingerprint: ProofAuthorityFingerprint;
  readonly targetId: TargetId;
  readonly features: readonly TargetFeatureId[];
  get(runtimeId: ProofMirRuntimeOperationId): ProofCheckRuntimeOperation | undefined;
  entries(): readonly ProofCheckRuntimeOperation[];
}
```

```ts
export type TargetSurfaceProofPlaceholder =
  | { readonly kind: "receiver"; readonly name: string }
  | { readonly kind: "parameter"; readonly index: number }
  | { readonly kind: "result" }
  | { readonly kind: "capability"; readonly capabilityKey: string }
  | { readonly kind: "layoutTerm"; readonly layoutKey: string };

export function normalizeTargetSurfaceProofTerm(input: {
  readonly targetId: TargetId;
  readonly authorityKey: string;
  readonly placeholders: readonly TargetSurfaceProofPlaceholder[];
  readonly term: TargetSurfaceRequirementExpression;
}): ProofCheckRequirementTerm;
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/authority-catalogs.test.ts
```

---

### Task 8: Semantics Companion Envelope Validation

**Description:** Define the proof-semantics companion request/result surface and validate returned certificate envelopes and typed patches.

**Dependencies:** Tasks 3, 5, 6, and 13.

**Files:**

- Create: `src/proof-check/authority/semantics-companion.ts`
- Test: `tests/unit/proof-check/semantics-companion.test.ts`

**Acceptance Criteria:**

- `ProofSemanticsCompanion` exposes fingerprint, target ID, schema version, provided judgments, and pure `judge`.
- Request variants are exactly `entailment`, `stateJoin`, `loopConvergence`, `terminalClosure`, `yieldResume`, `crossCoreOwnership`, `streamLoop`, and `extensionTransfer`.
- Result variants are exactly `ProofEntailmentJudgmentResult`, `ProofStateJoinJudgmentResult`, `ProofLoopConvergenceJudgmentResult`, `ProofTerminalClosureJudgmentResult`, `ProofYieldResumeJudgmentResult`, `ProofCrossCoreOwnershipJudgmentResult`, `ProofStreamLoopJudgmentResult`, and `ProofExtensionTransferJudgmentResult`.
- Input schema types are closed and include the exact fields shown below; no judgment accepts raw target-surface placeholders or arbitrary `unknown` payloads.
- Result schemas are closed and include request key, companion fingerprint, subject key, dependency keys, certificate ID, and a kind-specific payload; result validation rejects extra fields by checking an explicit allowed-field table per result kind.
- `validateProofSemanticsJudgmentResult` rejects mismatched request kind, companion fingerprint, undeclared judgment, subject key mismatch, unknown dependency key, invalid patch kind, and result fields outside the request schema.
- Entailment and terminal closure judgments cannot return state patches.
- Patch permission checks are closed per judgment kind: `entailment` no patch; `stateJoin` drop/weaken facts, intersect packet/source facts, move place state only to a core meet, close path-local certificates; `loopConvergence` same as `stateJoin` plus generation-role remapping for named loop-carried private state; `terminalClosure` no patch; `yieldResume` add suspend/resume frame facts and drop invalidated path facts only; `crossCoreOwnership` transfer exactly the named source place/capability and add the named ordering fact; `streamLoop` close exactly the named yielded member and drop member-local facts; `extensionTransfer` only entries declared by the selected extension schema.

**Code Examples:**

```ts
test("semantics result rejects a certificate for the wrong normalized request", () => {
  const companion = semanticsCompanionForTask8Test({
    providedJudgments: ["entailment"],
    result: entailmentOkResultForTask8Test({ subjectKey: "other-request" }),
  });

  const result = validateProofSemanticsJudgmentResult({
    companion,
    request: entailmentRequestForTask8Test({ subjectKey: "wanted-request" }),
    dependencyKeys: new Set(["authority:layout"]),
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_INVALID_SEMANTICS_CERTIFICATE"),
  );
});
```

`semanticsCompanionForTask8Test`, `entailmentOkResultForTask8Test`, and `entailmentRequestForTask8Test` are local helpers in `semantics-companion.test.ts`; shared companion fakes are added later by Task 11.

```ts
export type ProofSemanticsJudgmentRequest =
  | { readonly kind: "entailment"; readonly input: ProofEntailmentJudgmentInput }
  | { readonly kind: "stateJoin"; readonly input: ProofStateJoinJudgmentInput }
  | { readonly kind: "loopConvergence"; readonly input: ProofLoopConvergenceJudgmentInput }
  | { readonly kind: "terminalClosure"; readonly input: ProofTerminalClosureJudgmentInput }
  | { readonly kind: "yieldResume"; readonly input: ProofYieldResumeJudgmentInput }
  | { readonly kind: "crossCoreOwnership"; readonly input: ProofCrossCoreOwnershipJudgmentInput }
  | { readonly kind: "streamLoop"; readonly input: ProofStreamLoopJudgmentInput }
  | { readonly kind: "extensionTransfer"; readonly input: ProofExtensionTransferJudgmentInput };
```

```ts
export interface ProofEntailmentJudgmentInput {
  readonly requestKey: string;
  readonly subjectKey: string;
  readonly environmentFactKeys: readonly string[];
  readonly requirement: ProofCheckRequirementTerm;
  readonly allowedAuthorityKeys: readonly string[];
}

export interface ProofStateJoinJudgmentInput {
  readonly requestKey: string;
  readonly functionInstanceId: MonoInstanceId;
  readonly blockId: ProofMirBlockId;
  readonly incomingStateDigests: readonly ProofCheckStateDigest[];
  readonly allowedDropFactKeys: readonly string[];
  readonly allowedPacketSourceKeys: readonly string[];
}

export interface ProofLoopConvergenceJudgmentInput {
  readonly requestKey: string;
  readonly functionInstanceId: MonoInstanceId;
  readonly headerBlockId: ProofMirBlockId;
  readonly backedgeIds: readonly ProofMirControlEdgeId[];
  readonly incomingStateDigests: readonly ProofCheckStateDigest[];
  readonly variantKeys: readonly string[];
  readonly loopCarriedPrivateStateKeys: readonly string[];
}

export interface ProofTerminalClosureJudgmentInput {
  readonly requestKey: string;
  readonly terminalKey: CheckedTerminalClosureKey;
  readonly terminalGraphKey: string;
  readonly platformBaseKeys: readonly string[];
}

export interface ProofYieldResumeJudgmentInput {
  readonly requestKey: string;
  readonly yieldPointKey: string;
  readonly resumePointKey: string;
  readonly stableCapabilityKeys: readonly string[];
  readonly invalidatableFactKeys: readonly string[];
}

export interface ProofCrossCoreOwnershipJudgmentInput {
  readonly requestKey: string;
  readonly sourcePlaceKey: string;
  readonly destinationCoreKey: string;
  readonly capabilityKind: ProofCapabilityKindId;
  readonly orderingFactKey: string;
}

export interface ProofStreamLoopJudgmentInput {
  readonly requestKey: string;
  readonly streamSessionKey: string;
  readonly yieldedMemberKey: string;
  readonly memberLocalFactKeys: readonly string[];
}

export interface ProofExtensionTransferJudgmentInput {
  readonly requestKey: string;
  readonly extensionKind: ProofMirExtensionKind;
  readonly extensionSchemaKey: string;
  readonly operandKeys: readonly string[];
  readonly allowedPatchKinds: readonly ProofCheckPatchKind[];
}
```

```ts
export interface ProofSemanticsJudgmentEnvelope {
  readonly requestKind: ProofSemanticsJudgmentRequest["kind"];
  readonly requestKey: string;
  readonly companionFingerprint: ProofAuthorityFingerprint;
  readonly subjectKey: string;
  readonly dependencyKeys: readonly string[];
  readonly certificateId: ProofSemanticsCertificateId;
}

export type ProofSemanticsJudgmentResult =
  | (ProofSemanticsJudgmentEnvelope & { readonly kind: "entailment"; readonly entailed: true })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "stateJoin";
      readonly patch: ProofCheckStatePatch<"stateJoin">;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "loopConvergence";
      readonly patch: ProofCheckStatePatch<"loopConvergence">;
      readonly replayWitnessKey: string;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "terminalClosure";
      readonly terminalClosureKey: CheckedTerminalClosureKey;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "yieldResume";
      readonly patch: ProofCheckStatePatch<"yieldResume">;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "crossCoreOwnership";
      readonly patch: ProofCheckStatePatch<"crossCoreOwnership">;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "streamLoop";
      readonly patch: ProofCheckStatePatch<"streamLoop">;
    })
  | (ProofSemanticsJudgmentEnvelope & {
      readonly kind: "extensionTransfer";
      readonly patch: ProofCheckStatePatch<"extensionTransfer">;
      readonly packetEntryKeys: readonly string[];
    });
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/semantics-companion.test.ts
```

---

### Task 9: Fact And Requirement Term Language

**Description:** Implement normalized proof-check term types, binder substitution, stable term keys, and validation of legal requirement positions.

**Dependencies:** Task 3.

**Files:**

- Create: `src/proof-check/model/fact-language.ts`
- Create: `src/proof-check/model/fact-environment.ts`
- Create: `tests/support/proof-check/term-fixtures.ts`
- Test: `tests/unit/proof-check/fact-normalization.test.ts`

**Acceptance Criteria:**

- `ProofCheckRequirementTerm` is exactly `comparison | predicate | layoutFits | payloadEnd | fieldAvailable | rangeConstraint | noUnsignedOverflow | capability | packetSource`.
- `ProofCheckFactTerm` is exactly every requirement term plus `matchRefinement` and `terminalCall`.
- `ProofCheckOperandTerm` is exactly `place`, `value`, `layoutTerm`, `literal`, `preState`, and `postState`.
- `ProofCheckPlaceBinder` is exactly `receiver`, `parameter`, `argument`, `result`, `subject`, `proofMirPlace`, and `synthetic`.
- `ProofCheckValueBinder` is exactly `proofMirValue`, `resultValue`, and `synthetic`.
- `ProofCheckBrandBinder` is exactly `proofBrand`, `subjectBrand`, and `sourceBrand`.
- `ProofCheckTypeFactInvalidation` is exactly `moveTransfers`, `consumeRemoves`, `privateStateAdvance`, `platformEffect`, `runtimeEffect`, `validationSplit`, and `attemptSplit`.
- `terminalCall` and `matchRefinement` are rejected in requirement position.
- `preState` and `postState` are accepted only in catalog postconditions, runtime postconditions, and summary-instantiation contexts.
- Equality normalizes commutative operand order by stable key; non-commutative comparisons preserve operand order.
- Binder substitution resolves receiver, parameter, argument, result, source brand, layout term, synthetic, and Proof MIR binders without capture.
- `tests/support/proof-check/term-fixtures.ts` exports `comparisonTerm`, `valueTerm`, `literalInt`, `proofCheckValueOperandForTest`, and `capabilityRequirementForTest`.

**Code Examples:**

```ts
test("normalization sorts equality operands but preserves less-than order", () => {
  const left = proofCheckValueOperandForTest("value:b");
  const right = proofCheckValueOperandForTest("value:a");

  expect(normalizeProofCheckTerm(comparisonTerm(left, "eq", right)).key).toContain(
    "value:a==value:b",
  );
  expect(normalizeProofCheckTerm(comparisonTerm(left, "lt", right)).key).toContain(
    "value:b<value:a",
  );
});
```

```ts
export type ProofCheckRequirementTerm =
  | ProofCheckComparisonTerm
  | ProofCheckPredicateTerm
  | ProofCheckLayoutFitsTerm
  | ProofCheckPayloadEndTerm
  | ProofCheckFieldAvailableTerm
  | ProofCheckRangeConstraintTerm
  | ProofCheckNoUnsignedOverflowTerm
  | ProofCheckCapabilityTerm
  | ProofCheckPacketSourceTerm;
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/fact-normalization.test.ts
```

---

### Task 10: Input Contract Validator

**Description:** Validate proof-check input trust boundaries before any function body is checked.

**Dependencies:** Tasks 1, 4, 5, 7, 8, and 11.

**Files:**

- Create: `src/proof-check/validation/input-validator.ts`
- Modify: `src/proof-check/input-contract.ts`
- Test: `tests/unit/proof-check/input-validator.test.ts`

**Acceptance Criteria:**

- Target IDs match across Proof MIR layout, selected layout, selected runtime catalog, platform contracts, type facts, and semantics companion.
- `input.limits` is required, every limit is a positive safe integer, and invalid limits produce `PROOF_CHECK_INPUT_CONTRACT_INVALID` before any function body is checked.
- Embedded Proof MIR layout and selected layout have matching stable layout content keys.
- Embedded runtime catalog and selected runtime catalog match fingerprint, target ID, features, operation IDs, schemas, effects, ABI references, and authority keys.
- `reachableFunctions` is closed over external roots and source calls.
- Reachable source-call graph cycles are rejected.
- Dead function table entries receive structural-only status and do not produce proof diagnostics.
- Missing platform contract, runtime operation, type-fact authority, enabled extension judgment, terminal graph target, and invalid exit policy each produce deterministic diagnostics.
- `minimalProofCheckInputForValidatorTest`, `proofMirProgramForInputValidatorTest`, and `proofCheckResourceLimitsForInputValidatorTest` are local helpers in `input-validator.test.ts`; shared closed fixtures are added later by Task 11A.

**Code Examples:**

```ts
test("input validator rejects external root outside reachable closure", () => {
  const input = minimalProofCheckInputForValidatorTest({
    mutateMir: (mir) => ({
      ...mir,
      reachableFunctions: emptyProofMirReachableFunctionTableForTest(),
    }),
  });

  const diagnostics = validateProofCheckInput(input);

  expect(diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    proofCheckDiagnosticCode("PROOF_CHECK_REACHABLE_CLOSURE_INVALID"),
  );
});
```

```ts
function minimalProofCheckInputForValidatorTest(input?: {
  readonly mutateMir?: (mir: ProofMirProgram) => ProofMirProgram;
}): CheckProofAndResourcesInput {
  const mir =
    input?.mutateMir?.(proofMirProgramForInputValidatorTest()) ??
    proofMirProgramForInputValidatorTest();
  return {
    mir,
    layout: mir.layout,
    limits: proofCheckResourceLimitsForInputValidatorTest(),
    platformContracts: proofCheckPlatformCatalogFake({ entries: [] }),
    runtimeCatalog: proofCheckRuntimeCatalogFake({ embedded: mir.runtimeCatalog }),
    typeFacts: proofCheckTypeFactCatalogFake({ entries: [] }),
    semantics: proofSemanticsCompanionFake({ providedJudgments: [] }),
  };
}
```

```ts
export interface ValidateProofCheckInputResult {
  readonly diagnostics: readonly ProofCheckDiagnostic[];
  readonly reachableFunctionOrder: readonly MonoInstanceId[];
  readonly sourceCallGraph: ProofCheckSourceCallGraph;
  readonly deadFunctionIds: readonly MonoInstanceId[];
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/input-validator.test.ts
```

---

### Task 11: Proof-Check Authority Fakes

**Description:** Add shared fake authority catalogs and fake proof-semantics companions for unit tests.

**Dependencies:** Tasks 5, 7, 8, and 9.

**Files:**

- Create: `tests/support/proof-check/authority-fakes.ts`
- Test: `tests/unit/proof-check/authority-fakes.test.ts`

**Acceptance Criteria:**

- Fakes are plain dependency-injected objects, not mocks or spies.
- Every fake authority entry includes deterministic authority keys and origins.
- `proofAuthorityFingerprintForTest` returns a `ProofAuthorityFingerprint` with deterministic target ID, version, authority kind, and digest.
- `proofCheckRuntimeCatalogFake`, `proofCheckPlatformCatalogFake`, `proofCheckPlatformContractFake`, and `proofCheckTypeFactCatalogFake` produce catalogs whose entries sort by authority key.
- `proofSemanticsCompanionFake`, `proofSemanticsEntailmentOkForTest`, and `proofEntailmentRequestForTest` produce deterministic companion requests/results and never mutate captured arrays.
- Every helper listed in the shared helper registry for Task 11 is exported exactly once from `authority-fakes.ts`.
- `deterministicHexDigestForTest` is local to `authority-fakes.ts` and is not exported.

**Code Examples:**

```ts
test("authority fakes produce deterministic platform contract entries", () => {
  const catalog = proofCheckPlatformCatalogFake({
    entries: [
      proofCheckPlatformContractFake({ authorityKey: "platform:send" }),
      proofCheckPlatformContractFake({ authorityKey: "platform:recv" }),
    ],
  });

  expect(catalog.entries().map((entry) => entry.authorityKey)).toEqual([
    "platform:recv",
    "platform:send",
  ]);
});
```

```ts
export function proofAuthorityFingerprintForTest(input: {
  readonly authorityKind: ProofAuthorityFingerprint["authorityKind"];
  readonly targetName?: string;
  readonly version?: string;
  readonly digestSeed?: string;
}): ProofAuthorityFingerprint {
  return {
    authorityKind: input.authorityKind,
    targetId: targetId(input.targetName ?? "proof-check-test-target"),
    version: input.version ?? "test-v1",
    digestAlgorithm: "sha256",
    digestHex: deterministicHexDigestForTest(input.digestSeed ?? input.authorityKind),
  };
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/authority-fakes.test.ts
```

---

### Task 11A: Closed Fixture Authority Synthesis

**Description:** Implement `withProofCheckAuthoritiesForTest` and `proofCheckClosedFixture` as the one shared path that synthesizes trust-boundary-valid proof-check inputs from built or hand-authored Proof MIR.

**Dependencies:** Tasks 10, 11, 12, and 15A.

**Files:**

- Create: `tests/support/proof-check/proof-check-fixtures.ts`
- Test: `tests/unit/proof-check/proof-check-fixtures.test.ts`

**Acceptance Criteria:**

- `withProofCheckAuthoritiesForTest({ mir })` derives a selected `ProofCheckRuntimeCatalog` whose fingerprint, target ID, features, operation IDs, schemas, effects, ABI references, and authority keys match `mir.runtimeCatalog`.
- It derives platform contract entries for every reachable `ProofMirPlatformEdge`; each contract includes normalized term placeholders, ABI identity, capability flow arrays, effect arrays, and deterministic authority keys.
- It derives type-fact catalog entries for every concrete type referenced by reachable receiver, parameter, local, result, packet, capability, and platform/runtime contract subjects.
- It derives a semantics companion that provides exactly the judgments required by reachable extension, loop, terminal, yield/resume, stream-loop, cross-core, and non-core entailment records in the supplied MIR.
- It derives layout fingerprints/content keys from the selected `LayoutFactProgram` and does not compare rendered layout text.
- `proofCheckClosedFixture()` can build MIR from source or accept an explicit `mir`; every returned input passes `validateProofCheckInput(input).diagnostics === []`.
- Fixture mutations are pure and return new program/input objects.
- `ProofCheckClosedFixtureOptions.invalidCase` can intentionally produce each invalid fixture named by Tasks 37, 38, and 40 while preserving deterministic diagnostic owner/root-cause keys.
- `ProofCheckClosedFixtureOptions.validCase` can intentionally produce named success fixtures for terminal platform bases, source-call summary import, cross-core success transfer, validated-buffer success, and packet-rich accepted programs.
- Runtime mismatch fixture options include `runtimeCatalogFingerprintName` and `embeddedRuntimeCatalogFingerprintName`; terminal fixtures include `terminalPlatformBase`.

**Code Examples:**

```ts
test("closed fixture synthesizes authorities that satisfy input validation", () => {
  const input = proofCheckClosedFixture({
    source: "fn main() -> Never:\n    panic()\n",
  });

  expect(validateProofCheckInput(input).diagnostics).toEqual([]);
});
```

```ts
export function withProofCheckAuthoritiesForTest(input: {
  readonly mir: ProofMirProgram;
  readonly layout?: LayoutFactProgram;
  readonly invalidCase?: ProofCheckInvalidFixtureCase;
  readonly validCase?: ProofCheckValidFixtureCase;
  readonly runtimeCatalogFingerprintName?: string;
  readonly embeddedRuntimeCatalogFingerprintName?: string;
  readonly terminalPlatformBase?: boolean;
}): CheckProofAndResourcesInput {
  const layout = input.layout ?? input.mir.layout;
  return {
    mir: input.mir,
    layout,
    limits: proofCheckResourceLimitsForTest(),
    platformContracts: synthesizePlatformContractsForMir(input.mir, input.invalidCase),
    runtimeCatalog: synthesizeRuntimeCatalogForMir(input.mir, input.invalidCase),
    typeFacts: synthesizeTypeFactsForMir(input.mir, input.invalidCase),
    semantics: synthesizeSemanticsCompanionForMir(input.mir, input.invalidCase),
  };
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/proof-check-fixtures.test.ts ./tests/unit/proof-check/input-validator.test.ts
```

---

### Task 12: State Model, Keys, And Snapshots

**Description:** Define immutable checker state, canonical state digests, component keys, and compact diagnostic snapshots.

**Dependencies:** Tasks 5 and 9.

**Files:**

- Create: `src/proof-check/kernel/state.ts`
- Create: `src/proof-check/kernel/state-key.ts`
- Create: `tests/support/proof-check/state-fixtures.ts`
- Test: `tests/unit/proof-check/state-key.test.ts`

**Acceptance Criteria:**

- `ProofCheckState` has exactly these maps: `places`, `loans`, `obligations`, `sessions`, `validations`, `attempts`, `facts`, `privateState`, `layout`, `packetSources`, `capabilities`, `terminal`, `divergence`, and `erasures`.
- State objects are immutable at public boundaries.
- `proofCheckStateKey` sorts every map and set by stable component keys.
- `proofCheckStateSnapshot` emits compact canonical summaries and excludes mutable object identity.
- The state snapshot type used by Task 3 counterexample shell types is the same `ProofCheckStateSnapshot` type consumed by `proofCheckStateSnapshot`; Task 12 fills in the implementation and must not create a second snapshot type.
- Equal states constructed with different insertion orders produce identical keys and snapshots.
- `tests/support/proof-check/state-fixtures.ts` exports `proofCheckStateForTest`, `proofCheckStateSnapshotForTest`, `proofCheckDiagnosticForTest`, active fact/place/loan/obligation/session/member/private-state/packet-source fixture constructors listed in the helper registry.

**Code Examples:**

```ts
test("state key ignores map insertion order", () => {
  const first = proofCheckStateForTest({
    facts: [activeFactForTest("fact:b"), activeFactForTest("fact:a")],
  });
  const second = proofCheckStateForTest({
    facts: [activeFactForTest("fact:a"), activeFactForTest("fact:b")],
  });

  expect(proofCheckStateKey(first)).toBe(proofCheckStateKey(second));
  expect(proofCheckStateSnapshot(first)).toEqual(proofCheckStateSnapshot(second));
});
```

```ts
export interface ProofCheckState {
  readonly places: ReadonlyMap<string, CheckedPlaceState>;
  readonly loans: ReadonlyMap<string, CheckedLoanState>;
  readonly obligations: ReadonlyMap<string, CheckedObligationState>;
  readonly sessions: ReadonlyMap<string, CheckedSessionState>;
  readonly validations: ReadonlyMap<string, CheckedValidationState>;
  readonly attempts: ReadonlyMap<string, CheckedAttemptState>;
  readonly facts: ReadonlyMap<string, CheckedActiveFact>;
  readonly privateState: ReadonlyMap<string, CheckedPrivateStateFact>;
  readonly layout: ReadonlyMap<string, CheckedValidatedBufferFact>;
  readonly packetSources: ReadonlyMap<string, CheckedPacketSourceFact>;
  readonly capabilities: ReadonlyMap<string, CheckedCapabilityState>;
  readonly terminal: ReadonlyMap<string, CheckedTerminalClosureFact>;
  readonly divergence: ReadonlyMap<string, CheckedDivergenceFact>;
  readonly erasures: ReadonlyMap<string, CheckedErasureFact>;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/state-key.test.ts
```

---

### Task 12A: Domain Integration Fixture Harness

**Description:** Create the early integration-support harness that domain tasks use before public orchestration exists. The harness builds parser/HIR/mono/layout/Proof MIR fixtures when source syntax is supported, or explicit Proof MIR fixture inputs when it is not, and lets a domain task call its own transfer/check function directly.

**Dependencies:** Task 12.

**Files:**

- Create: `tests/support/proof-check/integration-fixtures.ts`
- Test: `tests/unit/proof-check/domain-integration-fixtures.test.ts`

**Acceptance Criteria:**

- `probeProofCheckSourceSyntaxForTest(source)` returns exactly `"supported"` or `"unsupported-source-syntax"` by running the current parser and the available lowering probes; it does not inspect task-specific expected diagnostics.
- `domainIntegrationFixtureForTest` can return a parsed/lowered source fixture when supported or a hand-built Proof MIR fixture when the caller supplies `fixtureFallback`.
- The harness exposes deterministic origin keys, function keys, block keys, and program-point keys for integration assertions.
- The harness never imports `src/proof-check/proof-checker.ts`, `src/proof-check/index.ts`, or top-level `src/index.ts`; pre-orchestration domain integration tests call the task-owned transfer/check function directly.
- The harness includes `expectProofCheckDiagnosticOrderForTest` for code order plus owner/root-cause key assertions.
- The harness uses fakes through dependency injection and does not use mocks or spies.
- `proofMirDomainFixtureForTask12ATest` is local to `domain-integration-fixtures.test.ts` and is not exported.

**Code Examples:**

```ts
test("domain integration fixture falls back when syntax is unsupported", () => {
  const fixture = domainIntegrationFixtureForTest({
    source: "fn main() -> Never { unsupported_inline_body() }",
    fixtureFallback: () => proofMirDomainFixtureForTask12ATest("unsupported-inline-body"),
  });

  expect(fixture.sourceSyntax).toBe("unsupported-source-syntax");
  expect(fixture.mir.functions.entries().length).toBeGreaterThan(0);
});
```

```ts
export interface ProofCheckDomainIntegrationFixture {
  readonly sourceSyntax: "supported" | "unsupported-source-syntax";
  readonly mir: ProofMirProgram;
  readonly originKeys: readonly string[];
  readonly programPointKeys: readonly string[];
}

export function domainIntegrationFixtureForTest(input: {
  readonly source: string;
  readonly fixtureFallback?: () => ProofMirProgram;
}): ProofCheckDomainIntegrationFixture;
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/domain-integration-fixtures.test.ts
```

---

### Task 13: State Patch Reducer

**Description:** Implement the single reducer that applies core and companion patches after validating replay permissions.

**Dependencies:** Task 12.

**Files:**

- Create: `src/proof-check/kernel/state-patch.ts`
- Create: `src/proof-check/kernel/state-reducer.ts`
- Test: `tests/unit/proof-check/state-patch-reducer.test.ts`

**Acceptance Criteria:**

- `ProofCheckPatchKind` is exactly `coreTransfer`, `stateJoin`, `loopConvergence`, `yieldResume`, `crossCoreOwnership`, `streamLoop`, `extensionTransfer`, and `terminalClosure`.
- `ProofCheckStatePatchEntry` is exactly `placeState`, `loan`, `fact`, `obligation`, `session`, `validation`, `attempt`, `privateState`, `capability`, `terminal`, `divergence`, `layout`, `packetSource`, and `erasure`.
- `reduceProofCheckState` validates patch kind permissions before mutating any state component.
- Companion patch permissions match the closed per-judgment permission list in Task 8.
- Reducer rejects manufactured ownership, unrelated obligation closure, capability production outside typed schema, private-state drops outside dependency set, and wrong patch kind.
- Reducer returns deterministic diagnostics and the unchanged input state on error.

**Code Examples:**

```ts
test("cross-core companion patch cannot close an unrelated obligation", () => {
  const state = proofCheckStateForTest({
    obligations: [obligationStateForTest("obligation:rx")],
  });
  const patch = proofCheckStatePatchForTest({
    kind: "crossCoreOwnership",
    entries: [
      { kind: "obligation", action: "close", obligation: obligationStateForTest("obligation:rx") },
    ],
  });

  const result = reduceProofCheckState(state, patch);

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_INVALID_STATE_PATCH"),
  );
});
```

```ts
export function reduceProofCheckState(
  state: ProofCheckState,
  patch: ProofCheckStatePatch<ProofCheckPatchKind>,
): ProofCheckStateReductionResult;
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/state-patch-reducer.test.ts
```

---

### Task 14: Transition API, Operation Union, And Staged Packet Entries

**Description:** Add transition objects, domain transfer result envelopes, staged packet-entry handling, and reducer integration.

**Dependencies:** Tasks 5, 12, and 13.

**Files:**

- Create: `src/proof-check/kernel/transition-api.ts`
- Test: `tests/unit/proof-check/transition-api.test.ts`

**Acceptance Criteria:**

- `ProofCheckOperation` is a closed union with exactly these variants: `functionEntry`, `statement`, `terminator`, `edge`, `call`, `join`, `loopHeader`, `exit`, and `terminalClosure`.
- `ProofCheckTransition` contains transition ID, function instance, location, input state, and a `ProofCheckOperation`.
- `ProofCheckTransitionResult` supports ok patches, certificates, packet entries, diagnostics, and error diagnostics.
- Staged packet entries are tied to transition or path certificates and are not committed until a block-entry state is accepted.
- Applying an error result does not mutate state or commit packet entries.
- Packet entries generated under a replaced block state can be discarded by stable state key.

**Code Examples:**

```ts
test("failed transition keeps staged packet entries out of committed packet", () => {
  const staged = createProofCheckPacketStage();
  const result = applyProofCheckTransitionResult({
    state: proofCheckStateForTest(),
    staged,
    transition: transitionForTest("statement:1"),
    transfer: {
      kind: "error",
      diagnostics: [proofCheckDiagnosticForTest("PROOF_CHECK_UNSATISFIED_REQUIREMENT")],
    },
  });

  expect(result.kind).toBe("error");
  expect(staged.entries()).toEqual([]);
});
```

```ts
export interface ProofCheckTransition {
  readonly transitionId: ProofCheckTransitionId;
  readonly functionInstanceId: MonoInstanceId;
  readonly location: ProofCheckProgramPoint;
  readonly inputState: ProofCheckState;
  readonly operation: ProofCheckOperation;
}

export type ProofCheckOperation =
  | { readonly kind: "functionEntry"; readonly functionInstanceId: MonoInstanceId }
  | { readonly kind: "statement"; readonly statement: ProofMirStatement }
  | { readonly kind: "terminator"; readonly terminator: ProofMirTerminator }
  | { readonly kind: "edge"; readonly edge: ProofMirControlEdge }
  | { readonly kind: "call"; readonly call: ProofMirCallGraphEdge }
  | { readonly kind: "join"; readonly blockId: ProofMirBlockId }
  | { readonly kind: "loopHeader"; readonly blockId: ProofMirBlockId }
  | { readonly kind: "exit"; readonly exit: ProofMirExitEdge }
  | { readonly kind: "terminalClosure"; readonly terminalKey: CheckedTerminalClosureKey };
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/transition-api.test.ts
```

---

### Task 14A: Proof-Check Operation Dispatch Registry

**Description:** Add the dispatch module that converts Proof MIR program points into `ProofCheckOperation` values and routes operations through a typed transfer registry.

**Dependencies:** Task 14.

**Files:**

- Create: `src/proof-check/kernel/operation-dispatch.ts`
- Test: `tests/unit/proof-check/operation-dispatch.test.ts`

**Acceptance Criteria:**

- `operationForProofMirProgramPoint` maps Proof MIR statements, terminators, edges, call graph edges, block joins, loop headers, exits, function entries, and terminal graph checks to the exact `ProofCheckOperation` variants from Task 14.
- `ProofCheckOperationTransferRegistry` has one handler per operation variant and requires every handler to return `ProofCheckTransitionResult`.
- `dispatchProofCheckOperation` rejects an unregistered handler with `PROOF_CHECK_INPUT_CONTRACT_INVALID` and a stable owner key containing the operation kind.
- Operation dispatch is deterministic: identical MIR program points produce identical operation keys across repeated calls.
- Task 36 must use this registry to wire domain transfer functions; no domain task owns central dispatch.

**Code Examples:**

```ts
test("operation dispatch rejects missing handler by operation kind", () => {
  const result = dispatchProofCheckOperation({
    registry: emptyProofCheckOperationTransferRegistryForTest(),
    transition: transitionForTest({
      operation: proofCheckOperationForTest({ kind: "statement" }),
    }),
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.ownerKey).toBe("operation:statement");
});
```

```ts
export interface ProofCheckOperationTransferRegistry {
  readonly functionEntry: ProofCheckOperationHandler<"functionEntry">;
  readonly statement: ProofCheckOperationHandler<"statement">;
  readonly terminator: ProofCheckOperationHandler<"terminator">;
  readonly edge: ProofCheckOperationHandler<"edge">;
  readonly call: ProofCheckOperationHandler<"call">;
  readonly join: ProofCheckOperationHandler<"join">;
  readonly loopHeader: ProofCheckOperationHandler<"loopHeader">;
  readonly exit: ProofCheckOperationHandler<"exit">;
  readonly terminalClosure: ProofCheckOperationHandler<"terminalClosure">;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/operation-dispatch.test.ts
```

---

### Task 15: Graph Worklist, Joins, And Counterexamples

**Description:** Implement the deterministic per-function worklist, join slots, exact/core meet processing, successor invalidation, and counterexample path reconstruction.

**Dependencies:** Tasks 10, 12, 13, 14, and 14A.

**Files:**

- Create: `src/proof-check/kernel/checker-kernel.ts`
- Create: `src/proof-check/kernel/graph-worklist.ts`
- Create: `src/proof-check/kernel/counterexample-builder.ts`
- Create: `tests/support/proof-check/counterexample-fixtures.ts`
- Test: `tests/unit/proof-check/checker-kernel.test.ts`

**Acceptance Criteria:**

- Blocks are visited in stable block order and outgoing edges in stable edge order.
- Acyclic joins wait for every reachable predecessor candidate or unreachable proof.
- Exact state equality accepts immediately.
- Core meet may drop/weaken facts and intersect packet/source facts but may not create ownership, capabilities, obligations, sessions, validations, attempts, private-state freshness, or terminal facts.
- Failed joins produce one root diagnostic and record stable suppression candidates for downstream transitions that depend on the missing joined state; Task 15A owns public diagnostic suppression.
- Counterexample paths reconstruct function, block, statement/terminator/edge/join/exit, origin, before snapshot, after snapshot, and failed component keys.
- `proofCheckCounterexampleFixture` is exported from `tests/support/proof-check/counterexample-fixtures.ts`.
- `runProofCheckFunctionKernel` accepts `resourceLimitHooks`, `joinPolicyHooks`, and `diagnosticSuppressionHooks` extension slots; Task 15 supplies no-op defaults so Task 15A and Task 32 do not modify `graph-worklist.ts`.

**Code Examples:**

```ts
test("failed join records root diagnostic and suppression candidates", () => {
  const program = proofCheckProgramWithBranch({
    trueState: proofCheckStateForTest({ facts: [activeFactForTest("fact:true-only")] }),
    falseState: proofCheckStateForTest({ facts: [activeFactForTest("fact:false-only")] }),
  });

  const result = runProofCheckKernelForTest(program);

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(
    result.diagnostics.filter((diagnostic) => diagnostic.code === "PROOF_CHECK_DIVERGENT_JOIN"),
  ).toHaveLength(1);
  expect(result.debug.suppressionCandidates.map((candidate) => candidate.rootCauseKey)).toContain(
    "join:block:merge",
  );
});
```

```ts
export interface ProofCheckFunctionKernelResult {
  readonly acceptedBlockStates: readonly CheckedBlockStateCertificate[];
  readonly summaries: readonly CheckedFunctionSummary[];
  readonly packetEntries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
  readonly diagnostics: readonly ProofCheckDiagnostic[];
  readonly debug: {
    readonly suppressionCandidates: readonly ProofCheckSuppressionCandidate[];
  };
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/checker-kernel.test.ts
```

---

### Task 15A: Resource Limits And Diagnostic Suppression

**Description:** Add selected-target proof-check resource limits and the deterministic diagnostic suppression closure required by the design.

**Dependencies:** Task 15.

**Files:**

- Create: `src/proof-check/kernel/resource-limits.ts`
- Create: `src/proof-check/kernel/diagnostic-suppression.ts`
- Test: `tests/unit/proof-check/resource-limits.test.ts`
- Test: `tests/unit/proof-check/diagnostic-suppression.test.ts`

**Acceptance Criteria:**

- `ProofCheckResourceLimits` is the same public input-contract type introduced by Task 4; this task implements validation and default test construction for it rather than defining a second incompatible type.
- The limit set includes `maximumReachableFunctions`, `maximumBlocksPerFunction`, `maximumEdgesPerFunction`, `maximumAcceptedStateVariantsPerBlock`, `maximumActiveFactsPerState`, `maximumActiveLoansPerState`, `maximumOpenObligationsPerState`, `maximumOpenValidationsPerState`, `maximumOpenAttemptsPerState`, `maximumLiveCapabilitiesPerState`, `maximumCounterexampleFrames`, and `maximumStagedPacketEntriesPerFunction`.
- `proofCheckResourceLimitHooks(limits)` plugs into Task 15's `resourceLimitHooks` extension slot; this task does not edit `graph-worklist.ts`.
- Every limit check returns `PROOF_CHECK_RESOURCE_LIMIT_EXCEEDED` with limit key, function/block key when available, and state key when available.
- Hitting a limit rejects deterministically; the checker must not silently widen, drop diagnostics nondeterministically, or accept after exceeding a limit.
- Suppression rules are exactly: missing input authority suppresses diagnostics requiring that authority; missing predecessor state suppresses downstream transition diagnostics reachable only through that predecessor; failed join suppresses successor diagnostics that depend on the joined state; failed function summary suppresses summary-import diagnostics in callers; unsuppressed caller requirements still report when independent of the failed summary.
- Suppressed diagnostics are excluded from the public set but retain their suppressing diagnostic key in debug-only suppression records.
- `applyProofCheckDiagnosticSuppression` consumes the root diagnostics and suppression candidates emitted by Task 15, and it is wired through Task 15's `diagnosticSuppressionHooks` extension slot by Task 36.

**Code Examples:**

```ts
test("state fact limit produces deterministic resource-limit diagnostic", () => {
  const result = enforceProofCheckResourceLimits({
    limits: { ...proofCheckResourceLimitsForTest(), maximumActiveFactsPerState: 1 },
    location: proofCheckProgramPointForTest("block:0"),
    state: proofCheckStateForTest({
      facts: [activeFactForTest("fact:a"), activeFactForTest("fact:b")],
    }),
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_RESOURCE_LIMIT_EXCEEDED"),
  );
  expect(result.diagnostics[0]?.stableDetail).toContain("maximumActiveFactsPerState");
});
```

```ts
export interface ProofCheckResourceLimits {
  readonly maximumReachableFunctions: number;
  readonly maximumBlocksPerFunction: number;
  readonly maximumEdgesPerFunction: number;
  readonly maximumAcceptedStateVariantsPerBlock: number;
  readonly maximumActiveFactsPerState: number;
  readonly maximumActiveLoansPerState: number;
  readonly maximumOpenObligationsPerState: number;
  readonly maximumOpenValidationsPerState: number;
  readonly maximumOpenAttemptsPerState: number;
  readonly maximumLiveCapabilitiesPerState: number;
  readonly maximumCounterexampleFrames: number;
  readonly maximumStagedPacketEntriesPerFunction: number;
}
```

```ts
test("failed join suppresses successor cascade by root cause key", () => {
  const diagnostics = applyProofCheckDiagnosticSuppression({
    diagnostics: [
      proofCheckDiagnosticForTest("PROOF_CHECK_DIVERGENT_JOIN", {
        rootCauseKey: "join:block:merge",
      }),
      proofCheckDiagnosticForTest("PROOF_CHECK_UNSATISFIED_REQUIREMENT", {
        rootCauseKey: "transition:block:after-merge",
      }),
    ],
    candidates: [
      {
        suppressedRootCauseKey: "transition:block:after-merge",
        suppressingRootCauseKey: "join:block:merge",
      },
    ],
  });

  expect(diagnostics.publicDiagnostics.map((diagnostic) => diagnostic.rootCauseKey)).toEqual([
    "join:block:merge",
  ]);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/resource-limits.test.ts ./tests/unit/proof-check/diagnostic-suppression.test.ts
```

---

### Task 16: Initial State And Unique Root Seeding

**Description:** Build authority-seeded entry states for ordinary source functions, image entries, target callbacks, and external roots.

**Dependencies:** Tasks 7, 9, 12, and 13.

**Files:**

- Create: `src/proof-check/domains/initial-state.ts`
- Test: `tests/unit/proof-check/initial-state.test.ts`

**Acceptance Criteria:**

- Ordinary source functions start with symbolic assumptions for their declared requirements and no image/device capabilities unless passed in.
- External roots discharge declared requirements using image-entry facts, firmware ABI facts, target-seeded facts, selected catalog facts, and live type-intrinsic facts.
- Image device capabilities are minted only for external roots and target callbacks from selected target authority.
- Unique edge roots are checked whole-image by concrete device authority and brand; duplicates reject before function checking.
- Entry certificates name function instance, entry reason, parameters, receiver, symbolic assumptions, seeded capabilities, type facts, layout ABI facts, root discharge certificates, and authority fingerprints.

**Code Examples:**

```ts
test("ordinary source function does not receive image device capability", () => {
  const result = buildInitialProofCheckState(
    initialStateInputForTest({ entryReason: "ordinarySource", includeImageDeviceAuthority: true }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect([...result.state.capabilities.keys()]).not.toContain("capability:image-device");
});
```

```ts
export type ProofCheckEntryReason =
  | "ordinarySource"
  | "imageEntry"
  | "targetCallback"
  | "externalRoot";
```

`ProofCheckEntryReason` is a checker-local entry-state category. It must not be reused as `MonoReachableFunction.reason`, which uses the mono/external-root reasons from Task 1.

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/initial-state.test.ts
```

---

### Task 17: Resource Kind Lifting And Structured Places

**Description:** Implement concrete resource-kind lifting and structured place relation helpers used by ownership, loans, wrappers, validation, and summaries.

**Dependencies:** Tasks 9 and 12.

**Files:**

- Create: `src/proof-check/domains/ownership.ts`
- Test: `tests/unit/proof-check/resource-kind-lifting.test.ts`

**Acceptance Criteria:**

- `ProofCheckConcreteResourceKind` is exactly `"Copy" | "Affine" | "Linear" | "UniqueEdgeRoot" | "EdgePath" | "Stream" | "ValidatedBuffer" | "PrivateState" | "SealedPlatformToken" | "Never"`.
- Wrapper lifting handles `Option[T]`, `Result[T, E]`, tuples, `List[T]`, `Map[K, T]`, and checked owner aggregates.
- Dataclasses and ordinary value aggregates reject hidden affine/linear/proof-relevant fields without checked owner semantics.
- Structured place relation returns same, ancestor, descendant, overlapping sibling, disjoint field, and unrelated root without string path comparison.
- Wrapper variants, tuple fields, list elements, and map values are represented by structured projections.

**Code Examples:**

```ts
test("option of writable buffer lifts to affine or linear resource", () => {
  const lifted = liftProofCheckResourceKind(
    optionTypeForTest({ element: checkedTypeForTest("WritableBuffer", "Linear") }),
  );

  expect(lifted).toBe("Linear");
});
```

```ts
test("disjoint fields are not the same place relation", () => {
  const left = proofCheckPlaceForTest("buffer.header");
  const right = proofCheckPlaceForTest("buffer.payload");

  expect(compareProofCheckPlaces(left, right).kind).toBe("disjointField");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/resource-kind-lifting.test.ts
```

---

### Task 18: Fact Environment And Core Entailment

**Description:** Implement active fact storage, contradiction handling, core entailment, and stable certificate selection for the closed structural fragment.

**Dependencies:** Tasks 9, 12, 12A, and 13.

**Files:**

- Create: `src/proof-check/domains/facts.ts`
- Modify: `src/proof-check/model/fact-environment.ts`
- Test: `tests/unit/proof-check/entailment.test.ts`

**Acceptance Criteria:**

- Active facts are keyed by normalized term key, private-state generation, packet/source subject, and numeric domain.
- Contradictory facts on reachable states produce `PROOF_CHECK_CONTRADICTORY_FACT` diagnostics and cannot discharge requirements.
- Core entailment supports identity, authority membership, equality substitution, comparison complements, transitive comparison chains, bounded integer intervals, live type-intrinsic facts, and direct layout-fact membership hooks.
- Entailment chooses the lexicographically smallest stable certificate key when multiple proofs exist.
- Missing-proof explanations identify the missing fact, stale fact, authority entry, or incompatible numeric domain.

**Code Examples:**

```ts
test("core entailment uses equality substitution with stable certificate choice", () => {
  const environment = factEnvironmentForTest([
    comparisonTerm(valueTerm("a"), "eq", valueTerm("b")),
    comparisonTerm(valueTerm("b"), "le", literalInt(8n)),
  ]);

  const result = proveCoreEntailment(
    environment,
    comparisonTerm(valueTerm("a"), "le", literalInt(8n)),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.certificate.rule).toBe("coreEntailment");
});
```

```ts
export type CoreEntailmentResult =
  | { readonly kind: "ok"; readonly certificate: ProofCheckCoreCertificate }
  | { readonly kind: "missing"; readonly diagnostics: readonly ProofCheckDiagnostic[] };
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/entailment.test.ts
```

---

### Task 19: Layout Entailment And Validated-Buffer Requirements

**Description:** Implement bounded layout arithmetic, validated-buffer read requirement proving, and packet/source layout facts.

**Dependencies:** Tasks 9, 12, and 18.

**Files:**

- Create: `src/proof-check/domains/layout-entailment.ts`
- Create: `src/proof-check/domains/validated-buffers.ts`
- Test: `tests/unit/proof-check/layout-entailment.test.ts`

**Acceptance Criteria:**

- Layout terms normalize to bounded affine expressions over layout constants, source-length symbols, field-value symbols, and checked casts.
- `layoutFits`, `payloadEnd`, `fieldAvailable`, `rangeConstraint`, and `noUnsignedOverflow` are proved only from selected layout facts, validation guards, source requirements, and active facts.
- Runtime validation guard binding produces `layoutFits(source, end)` only on the successful edge dominated by that guard.
- Dynamic payload reads require certified `payloadEnd(end)` and `layoutFits(source, end)`.
- Derived fields require a checked derive-table entry, source field read certificate, exhaustive deterministic case mapping, and packet/source relationship.

**Code Examples:**

```ts
test("payload read without payloadEnd is rejected even when fixed fields fit", () => {
  const state = proofCheckStateForTest({
    facts: [layoutFitsFactForTest("source", "payload-end")],
  });

  const result = checkValidatedBufferReadRequirement({
    state,
    read: payloadReadForTest({ source: "source", end: "payload-end" }),
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_MISSING_LAYOUT_ENTAILMENT"),
  );
});
```

```ts
export interface LayoutEntailmentCertificate {
  readonly certificate: ProofCheckCoreCertificate;
  readonly normalizedTermKey: string;
  readonly dependencyKeys: readonly string[];
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/layout-entailment.test.ts
```

---

### Task 20: Source-Call Summary Export

**Description:** Build accepted function summaries from checked callee bodies and reject summaries that would export internal or path-local proof state.

**Dependencies:** Tasks 14, 15, 16, and 18.

**Files:**

- Create: `src/proof-check/domains/source-calls.ts`
- Test: `tests/unit/proof-check/source-call-summaries.test.ts`

**Acceptance Criteria:**

- A summary is exported only after body exits, divergence, terminal behavior, private-state effects, and packet entries are accepted.
- `requiredFacts` are the callee declared symbolic requirements.
- `returnedFacts` contain only facts true on every normal return path and whose dependencies bind to receiver, parameters, result, or produced capabilities.
- Summary effects over-approximate observed, consumed, mutated, produced, terminal, private-state, divergence, and invalidated facts.
- Summaries cannot export live loans, obligations, sessions, validation results, attempts, live packet/source obligations, or unclosed private-state transitions.

**Code Examples:**

```ts
test("source summary does not export internal local refinement facts", () => {
  const checked = checkedFunctionForTest({
    returnFacts: [summaryFactForTest({ key: "local:tmp > 0", dependsOnInternalLocal: true })],
  });

  const result = buildCheckedFunctionSummary(checked);

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.summary.returnedFacts).toEqual([]);
});
```

```ts
export interface CheckedFunctionSummary {
  readonly functionInstanceId: MonoInstanceId;
  readonly requiredFacts: readonly CheckedRequirementFact[];
  readonly observedInputs: readonly CheckedSummaryPlaceEffect[];
  readonly consumedInputs: readonly CheckedSummaryPlaceEffect[];
  readonly mutatedInputs: readonly CheckedSummaryPlaceEffect[];
  readonly producedPlaces: readonly CheckedSummaryPlaceEffect[];
  readonly returnedFacts: readonly CheckedSummaryFact[];
  readonly invalidatedFacts: readonly CheckedFactInvalidation[];
  readonly privateStateEffects: readonly CheckedPrivateStateFact[];
  readonly producedCapabilities: readonly CheckedCapabilityFlowFact[];
  readonly terminalEffects: readonly CheckedTerminalClosureFact[];
  readonly divergence: readonly CheckedDivergenceFact[];
  readonly certificateId: CheckedFunctionSummaryCertificateId;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/source-call-summaries.test.ts
```

---

### Task 21: Source-Call Import And Whole-Image Driver

**Description:** Implement topological whole-image source-call checking and call-site summary import.

**Dependencies:** Tasks 15, 18, and 20.

**Files:**

- Modify: `src/proof-check/domains/source-calls.ts`
- Create: `src/proof-check/kernel/whole-image-driver.ts`
- Test: `tests/unit/proof-check/source-call-transfer.test.ts`

**Acceptance Criteria:**

- Reachable source functions are checked in topological order, callees before callers.
- Reachable source recursion is rejected as an input error.
- A caller imports a callee summary only after discharging substituted summary `requiredFacts` and `ProofMirCall.requirements`.
- Imported facts are instantiated on receiver, arguments, type arguments, and result binders.
- `mustDiverge` callee summaries make successor source code unreachable; `mayDiverge` summaries preserve both outcomes.
- Missing accepted callee summary produces a source-call diagnostic.

**Code Examples:**

```ts
test("source call requires callee preconditions before importing return facts", () => {
  const input = proofCheckProgramWithSourceCall({
    calleeRequiredFact: comparisonTerm(valueTerm("argument:0"), "lt", literalInt(4n)),
    callerFacts: [],
  });

  const result = checkSourceCallTransfer(input);

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_UNSATISFIED_REQUIREMENT"),
  );
});
```

```ts
export interface CheckedSourceCallTransferInput {
  readonly state: ProofCheckState;
  readonly call: ProofMirCallGraphEdge;
  readonly summary: CheckedFunctionSummary;
  readonly substitution: ProofCheckCallSubstitution;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/source-call-transfer.test.ts
```

---

### Task 22: Platform Preconditions And Capabilities

**Description:** Check platform primitive call contract lookup, ABI identity, ownership requirements, capability requirements, and catalog preconditions.

**Dependencies:** Tasks 7, 13, 18, 19, 23, and 24.

**Files:**

- Create: `src/proof-check/domains/platform-contract-transfer.ts`
- Test: `tests/unit/proof-check/platform-contract-transfer.test.ts`

**Acceptance Criteria:**

- `certifiedPlatform` calls resolve `ProofMirPlatformEdge`, mono platform metadata, selected platform contract, primitive ID, contract ID, ABI reference, instantiated signature, and authority key.
- Missing or mismatched platform contract rejects the call.
- Observed operands require ownership and no conflicting exclusive loans.
- Consumed operands require ownership and consume affine/linear values.
- Contract preconditions and capability requirements are checked by deterministic entailment.
- Produced and consumed capabilities are represented as patch entries and packet capability-flow certificates.

**Code Examples:**

```ts
test("platform primitive call without entailed catalog precondition is rejected", () => {
  const input = platformTransferInputForTest({
    preconditions: [capabilityRequirementForTest("capability:tx")],
    state: proofCheckStateForTest({ capabilities: [] }),
  });

  const result = checkPlatformContractTransfer(input);

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_PLATFORM_PRECONDITION_FAILED"),
  );
});
```

```ts
export interface PlatformContractTransferInput {
  readonly state: ProofCheckState;
  readonly call: ProofMirCallGraphEdge;
  readonly platformEdge: ProofMirPlatformEdge;
  readonly contract: ProofCheckPlatformContract;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/platform-contract-transfer.test.ts
```

---

### Task 23: Move, Use, Consume, And Ownership Transfer

**Description:** Implement ownership transfer rules for Proof MIR moves, uses, consumes, assignments, source-call argument effects, and platform/runtime operand effects.

**Dependencies:** Tasks 13, 17, and 18.

**Files:**

- Modify: `src/proof-check/domains/ownership.ts`
- Test: `tests/unit/proof-check/move-use-consume.test.ts`

**Acceptance Criteria:**

- Using a place requires initialized/owned state and rejects moved, consumed, or uninitialized state.
- Moving a field marks the aggregate unavailable as an intact object until reinitialized.
- Consuming affine/linear resources removes active type-intrinsic facts unless the consuming contract produces a replacement.
- Copy resources can be observed without changing place state.
- Whole-object use conflicts with moved fields and live loans below it.
- Ownership transfer emits core certificates and packet ownership facts where valid.

**Code Examples:**

```ts
test("whole object use fails after moving one linear field", () => {
  const state = proofCheckStateForTest({
    places: [ownedPlaceForTest("packet"), movedPlaceForTest("packet.payload")],
  });

  const result = checkUsePlace({ state, place: proofCheckPlaceForTest("packet") });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_USE_AFTER_MOVE"));
});
```

```ts
export function transferMovePlace(input: {
  readonly state: ProofCheckState;
  readonly source: ProofCheckStructuredPlace;
  readonly destination: ProofCheckStructuredPlace;
}): ProofCheckTransitionResult;
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/move-use-consume.test.ts
```

---

### Task 24: Field-Sensitive Loans And Noalias

**Description:** Implement shared/exclusive loan conflicts, loan closure, noalias facts, and field-disjointness packet entries.

**Dependencies:** Tasks 12A, 13, and 17.

**Files:**

- Create: `src/proof-check/domains/loans.ts`
- Test: `tests/unit/proof-check/loan-conflicts.test.ts`

**Acceptance Criteria:**

- Shared observations conflict with active exclusive loans of same place, ancestors, or descendants.
- Mutating or consuming conflicts with any shared or exclusive loan of same place, ancestors, or descendants.
- Disjoint field loans are accepted and produce field-disjointness/noalias facts.
- Returning with any live loan is rejected.
- Loan diagnostics identify both the attempted operation and the conflicting loan origin.

**Code Examples:**

```ts
test("exclusive loan of one field does not block use of disjoint field", () => {
  const state = proofCheckStateForTest({
    loans: [exclusiveLoanForTest("buffer.header")],
    places: [ownedPlaceForTest("buffer.payload")],
  });

  const result = checkUseWithLoans({ state, place: proofCheckPlaceForTest("buffer.payload") });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(
    result.packetEntries.some((entry) => entry.kind === checkedFactKindId("fieldDisjointness")),
  ).toBe(true);
});
```

```ts
export type ProofCheckLoanConflict =
  | { readonly kind: "samePlace"; readonly loanKey: string }
  | { readonly kind: "ancestor"; readonly loanKey: string }
  | { readonly kind: "descendant"; readonly loanKey: string };
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/loan-conflicts.test.ts
```

---

### Task 25: Erasure Certification

**Description:** Certify proof-only and resource-only erasure without performing destructive erasure.

**Dependencies:** Tasks 13, 18, 23, and 24.

**Files:**

- Create: `src/proof-check/domains/erasure.ts`
- Test: `tests/unit/proof-check/erasure.test.ts`

**Acceptance Criteria:**

- Erasure facts are emitted only for subjects with proof-only or resource-only representation in Proof MIR.
- ABI, runtime, platform, layout, stack slot, branch condition, call target, argument order, memory address, and observable target behavior dependencies reject erasure.
- Erasure requires all represented live resources to be closed, transferred, or consumed at all exits in scope.
- Erasure certificates name all facts and transitions that replace the subject's proof role.
- Proof-only value used by runtime ABI or emitted control flow rejects the program.

**Code Examples:**

```ts
test("proof-only branch condition is not certified for erasure", () => {
  const result = certifyProofErasure({
    state: proofCheckStateForTest(),
    subject: proofOnlyValueForTest("value:proof-branch"),
    runtimeUses: [{ kind: "branchCondition", valueKey: "value:proof-branch" }],
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_ERASURE"));
});
```

```ts
export interface ProofErasureCertificationInput {
  readonly state: ProofCheckState;
  readonly subject: ProofCheckErasableSubject;
  readonly runtimeUses: readonly ProofCheckRuntimeUse[];
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/erasure.test.ts
```

---

### Task 26: Take Sessions And Obligations

**Description:** Implement take-stream, take-buffer, take-validated sessions, obligations, members, discharge, closure, and crossed-scope checks.

**Dependencies:** Tasks 13, 18, 23, and 24.

**Files:**

- Create: `src/proof-check/domains/take-sessions.ts`
- Test: `tests/unit/proof-check/take-sessions.test.ts`

**Acceptance Criteria:**

- `take stream` opens a stream session, loans the producer edge path, tracks outstanding members, and brands yielded members.
- `take buffer` opens a linear buffer obligation.
- `take validated` opens a validated-buffer session that cannot be copied, stored, or returned unless a selected contract transfers it.
- Discharge must target the same obligation and session/member brand.
- `return`, `break`, `continue`, `yield`, and fallible error edges cannot cross live linear obligations, sessions, members, validation sources, packets, or attempts unless the edge transfer closes, returns, transfers, or terminally discharges that state.

**Code Examples:**

```ts
test("wrong stream brand cannot close yielded member", () => {
  const state = proofCheckStateForTest({
    sessions: [streamSessionForTest("session:a")],
    obligations: [streamMemberObligationForTest("member:a", "session:a")],
  });

  const result = dischargeTakeMember({
    state,
    member: streamMemberForTest("member:a", "session:b"),
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_WRONG_SESSION_DISCHARGE"),
  );
});
```

```ts
export interface TakeSessionTransferInput {
  readonly state: ProofCheckState;
  readonly operation: "takeStream" | "takeBuffer" | "takeValidated" | "discharge" | "close";
  readonly sessionKey: string;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/take-sessions.test.ts
```

---

### Task 27: Validation Split Transfer

**Description:** Implement single-use validation creation, `Ok`/`Err` split transfer, packet/source relationship creation, arm repair, and split joins.

**Dependencies:** Tasks 19, 23, and 26.

**Files:**

- Create: `src/proof-check/domains/validation.ts`
- Test: `tests/unit/proof-check/validation-transfer.test.ts`

**Acceptance Criteria:**

- `validate` creates one pending validation tied to source place and validated-buffer instance.
- `matchValidation` consumes the pending result exactly once.
- `Ok` edge consumes source into packet and introduces packet/payload places, source membership brand, packet/source link, and validated layout bounds.
- `Err` edge keeps source live and introduces no packet.
- Each arm must close, consume, or transfer arm-local resources to a common output shape before join.
- Pending validation results, live validation sources, and live packet tokens must be closed before function exit.

**Code Examples:**

```ts
test("validation ok arm leaking packet while err arm keeps source fails split join", () => {
  const result = checkValidationSplitJoin(
    validationSplitForTest({
      okState: proofCheckStateForTest({ packetSources: [packetSourceForTest("packet", "source")] }),
      errorState: proofCheckStateForTest({ places: [ownedPlaceForTest("source")] }),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_SPLIT_STATE"),
  );
});
```

```ts
export interface ValidationSplitTransferResult {
  readonly okState: ProofCheckState;
  readonly errorState: ProofCheckState;
  readonly packetSourceCertificate?: ProofCheckCoreCertificate;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/validation-transfer.test.ts
```

---

### Task 28: Attempt Split Transfer

**Description:** Implement fallible affine attempt splits, success/error resource repair, and convergent output-state checking.

**Dependencies:** Tasks 13, 23, and 24.

**Files:**

- Create: `src/proof-check/domains/attempts.ts`
- Test: `tests/unit/proof-check/attempt-transfer.test.ts`

**Acceptance Criteria:**

- `attempt` records declared input places and one pending result.
- Success edge may consume only the declared affine inputs.
- Error edge starts from the original input state.
- A place is usable after the match only when both paths leave it usable.
- Success and error arms must repair to the same declared output resource shape before joining.
- Diagnostics name the first divergent resource, fact, packet/source, private-state generation, or capability.

**Code Examples:**

```ts
test("attempt success consuming input while error leaves input live requires repair", () => {
  const result = checkAttemptSplitJoin(
    attemptSplitForTest({
      successState: proofCheckStateForTest({ places: [consumedPlaceForTest("buffer")] }),
      errorState: proofCheckStateForTest({ places: [ownedPlaceForTest("buffer")] }),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_DIVERGENT_SPLIT_STATE"),
  );
});
```

```ts
export interface AttemptTransferInput {
  readonly state: ProofCheckState;
  readonly attemptKey: string;
  readonly declaredInputs: readonly ProofCheckStructuredPlace[];
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/attempt-transfer.test.ts
```

---

### Task 29: Private-State Threading

**Description:** Track current private-state generations, invalidate stale predicate facts, and certify generation facts.

**Dependencies:** Tasks 13 and 18.

**Files:**

- Create: `src/proof-check/domains/private-state.ts`
- Test: `tests/unit/proof-check/private-fact-threading.test.ts`

**Acceptance Criteria:**

- Predicate facts may bind to current or explicit private-state generation.
- `advancePrivateState` creates a new generation and threads it through state.
- Facts tied to the previous generation are invalidated unless a companion preservation certificate applies.
- Catalog preconditions cannot be satisfied by stale predicate facts.
- Diagnostics identify stale fact origin and the transition that advanced the generation.
- Packet private-state facts are scoped to the accepted program point where the generation is current.

**Code Examples:**

```ts
test("stale private predicate cannot satisfy a subsequent requirement", () => {
  const state = proofCheckStateForTest({
    privateState: [privateGenerationForTest("cell", "generation:2")],
    facts: [privatePredicateFactForTest("cell.is_open", "generation:1")],
  });

  const result = provePrivatePredicateRequirement({
    state,
    requirement: privatePredicateRequirementForTest("cell.is_open", "current"),
  });

  expect(result.kind).toBe("missing");
  if (result.kind !== "missing") return;
  expect(result.diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_STALE_FACT"));
});
```

```ts
export interface ProofCheckPrivateStateAdvance {
  readonly place: ProofMirPlaceId;
  readonly previous: ProofMirPrivateStateGenerationId;
  readonly next: ProofMirPrivateStateGenerationId;
  readonly transitionKey: string;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/private-fact-threading.test.ts
```

---

### Task 30: Platform Guarded Effects And Invalidation

**Description:** Apply platform postconditions, guarded postconditions, private-state effects, terminal effects, and default-deny invalidation.

**Dependencies:** Tasks 7, 13, 18, 22, and 29.

**Files:**

- Modify: `src/proof-check/domains/platform-contract-transfer.ts`
- Test: `tests/unit/proof-check/platform-effects.test.ts`

**Acceptance Criteria:**

- Guarded postconditions evaluate `when` terms against pre/post-state substitution and current fact environment.
- Relational postconditions can preserve descriptor, length, capacity, brand, and packet/source relationships across ownership transfer.
- Sparse writes do not advance initialized-prefix facts.
- Platform/runtime effect invalidation drops all facts depending on touched subjects unless a selected catalog preservation fact applies.
- `doesNotReturn`, terminal, private-state advance, produced capability, consumed capability, and memory effects emit typed patch entries and packet certificates.

**Code Examples:**

```ts
test("sparse write does not produce initialized-prefix advancement fact", () => {
  const result = applyPlatformGuardedPostconditions(
    platformEffectInputForTest({
      preFacts: [comparisonTerm(valueTerm("offset"), "gt", valueTerm("initialized_prefix"))],
      guardedPostconditions: [initializedPrefixAdvanceWhenContiguousForTest()],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.patch.entries.some((entry) => entry.kind === "fact")).toBe(false);
});
```

```ts
export interface PlatformEffectInvalidationInput {
  readonly state: ProofCheckState;
  readonly effect: ProofCheckContractEffect;
  readonly preservationFacts: readonly ProofCheckFactTerm[];
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/platform-effects.test.ts
```

---

### Task 31: Runtime Catalog Authentication And Transfer

**Description:** Authenticate embedded runtime catalog copies and implement compiler-runtime call transfer using the selected proof-check runtime catalog.

**Dependencies:** Tasks 7, 11, 13, 18, 22, and 30.

**Files:**

- Create: `src/proof-check/domains/runtime-contract-transfer.ts`
- Modify: `src/proof-check/authority/runtime-authority.ts`
- Test: `tests/unit/proof-check/runtime-contract-transfer.test.ts`

**Acceptance Criteria:**

- Embedded `ProofMirProgram.runtimeCatalog` must match selected `ProofCheckRuntimeCatalog` fingerprint, target, features, operation IDs, schemas, effects, ABI references, and authority keys before any runtime call is checked.
- Runtime calls expand selected runtime preconditions and required facts.
- Runtime helpers can produce trusted axioms only for their own operation schemas.
- Runtime helpers cannot discharge source obligations or forge platform capabilities unless the selected runtime catalog contract explicitly states that capability flow.
- Runtime effects use the same default-deny invalidation as platform effects.

**Code Examples:**

```ts
test("runtime fingerprint mismatch rejects before runtime transfer", () => {
  const result = authenticateProofCheckRuntimeCatalog({
    embedded: proofMirRuntimeCatalogFake({ fingerprintName: "embedded" }),
    selected: proofCheckRuntimeCatalogFake({ fingerprintName: "selected" }),
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED"),
  );
});
```

```ts
export interface RuntimeContractTransferInput {
  readonly state: ProofCheckState;
  readonly runtimeCall: ProofMirRuntimeCallContract;
  readonly operation: ProofCheckRuntimeOperation;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/runtime-contract-transfer.test.ts
```

---

### Task 32: Companion Joins And Loop Convergence

**Description:** Use the semantics companion for non-exact state joins, loop convergence, finite variant replay, and loop diagnostics.

**Dependencies:** Tasks 8, 11, 13, 15, 15A, 18, and 29.

**Files:**

- Create: `src/proof-check/domains/loops.ts`
- Test: `tests/unit/proof-check/loop-convergence.test.ts`

**Acceptance Criteria:**

- Non-exact joins first attempt exact/core meet, then require a selected `stateJoin` companion judgment.
- Reachable loop headers require a selected `loopConvergence` judgment unless exact loop-state equality is explicitly declared by the companion.
- Loop certificates name backedge IDs, variant keys, loop-carried resources, generation roles, invariant facts, allowed dropped refinements, visit bound, and final replay witness.
- After visit bound, one additional transfer from each accepted backedge must replay into an already accepted `(variantKey, stateKey)` pair.
- Companion loop patches are replayed through the reducer and cannot introduce unrequested resources, capabilities, private-state freshness, or terminal facts.
- `proofCheckLoopJoinPolicyHooks` plugs into Task 15's `joinPolicyHooks` extension slot; this task does not edit `graph-worklist.ts`.

**Code Examples:**

```ts
test("loop header without required companion judgment is rejected", () => {
  const result = checkLoopConvergence(
    loopConvergenceInputForTest({
      companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_MISSING_COMPANION_JUDGMENT"),
  );
});
```

```ts
export interface ProofLoopConvergenceJudgmentInput {
  readonly functionInstanceId: MonoInstanceId;
  readonly headerBlockId: ProofMirBlockId;
  readonly backedgeIds: readonly ProofMirControlEdgeId[];
  readonly incomingStateDigests: readonly ProofCheckStateDigest[];
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/loop-convergence.test.ts
```

---

### Task 33: Terminal, Divergence, And Panic Closure

**Description:** Implement local exit closure, divergence transfer, panic policy checking, terminal summaries, core terminal graph construction, and companion terminal closure.

**Dependencies:** Tasks 13, 15, 21, 22, 26, and 31.

**Files:**

- Create: `src/proof-check/domains/terminal.ts`
- Test: `tests/unit/proof-check/terminal.test.ts`

**Acceptance Criteria:**

- Local terminal returns require no live proof/resource state and terminal reachability.
- `panic`, runtime/platform `mayPanic`, and `doesNotReturn` create divergence exit states.
- `abortNoUnwind` panic may cross live proof/resource state only when the selected exit policy proves it unobservable after abort.
- Terminal graph rejects fallthrough, missing terminal targets, dynamic terminal dispatch, self-cycles, and mutual cycles without a platform-reaching base.
- Core terminal graph cannot add edges after companion validation; the companion only validates the closed graph.
- Terminal packet facts identify terminal call, platform-reaching edge, closure path, and empty exit state.

**Code Examples:**

```ts
test("terminal self-cycle without platform base is rejected", () => {
  const result = checkTerminalGraph(
    terminalGraphForTest({
      edges: [{ from: "terminal:self", to: "terminal:self" }],
      platformBaseNodes: [],
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_TERMINAL_CLOSURE_MISSING"),
  );
});
```

```ts
export interface CheckedTerminalGraphCertificate {
  readonly certificateId: ProofSemanticsCertificateId;
  readonly terminalKey: CheckedTerminalClosureKey;
  readonly closurePath: readonly string[];
  readonly platformEffectKey: string;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/terminal.test.ts
```

---

### Task 34A: Extension Gate Transfer

**Description:** Implement enabled-extension safety for generic Proof MIR extension records without owning yield/resume, stream-loop, or cross-core transfer logic.

**Dependencies:** Tasks 8, 11, 13, 22, 26, 29, and 32.

**Files:**

- Create: `src/proof-check/domains/extension-gates.ts`
- Test: `tests/unit/proof-check/extension-gates.test.ts`

**Acceptance Criteria:**

- Every extension statement or terminator requires an enabled feature gate and a matching `extensionTransfer` companion judgment.
- Core validates extension operands, places, brands, obligations, capabilities, and declared effects before invoking the companion.
- Companion extension patches are replayed through `reduceProofCheckState` and checked against the selected extension schema.
- Extension transfer may emit only extension-specific packet entries named by the selected extension schema.
- Missing gate or missing companion judgment emits `PROOF_CHECK_UNSAFE_EXTENSION`.

**Code Examples:**

```ts
test("extension record without enabled companion judgment is rejected", () => {
  const result = checkExtensionGateTransfer(
    extensionGateInputForTest({
      extensionKind: "targetSpecific",
      companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_UNSAFE_EXTENSION"),
  );
});
```

```ts
export interface ExtensionGateTransferInput {
  readonly state: ProofCheckState;
  readonly extensionKind: ProofMirExtensionKind;
  readonly extensionSchemaKey: string;
  readonly companion: ProofSemanticsCompanion;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/extension-gates.test.ts
```

---

### Task 34B: Yield/Resume And Stream-Loop Transfer

**Description:** Implement scheduler yield/resume boundary checks and stream-loop companion transfer.

**Dependencies:** Tasks 8, 11, 13, 22, 26, 29, and 32.

**Files:**

- Create: `src/proof-check/domains/yield-resume.ts`
- Create: `src/proof-check/domains/stream-loop.ts`
- Test: `tests/unit/proof-check/yield-resume.test.ts`
- Test: `tests/unit/proof-check/stream-loop.test.ts`

**Acceptance Criteria:**

- Yield/resume rejects live linear obligations, validation sources, packets, stream members, sessions, pending attempts, and unclosed private-state transitions before companion dispatch.
- Yield/resume validates the wake capability remains live, is borrowed for the yield, and is still owned by the same receiver after resume.
- Yield/resume invalidates facts depending on unstable scheduler/device state unless selected catalog facts prove preservation.
- Stream-loop transfer closes exactly the named yielded member, updates only that stream's outstanding-member set, and drops only member-local facts.
- Stream-loop companion patches are replayed through the reducer and cannot close unrelated sessions, obligations, validations, attempts, or capabilities.

**Code Examples:**

```ts
test("yield with live stream member is rejected before companion dispatch", () => {
  const result = checkYieldResumeTransfer(
    yieldResumeInputForTest({
      state: proofCheckStateForTest({
        sessions: [streamSessionForTest("session:rx")],
        obligations: [streamMemberObligationForTest("member:rx", "session:rx")],
      }),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_INVALID_YIELD_BOUNDARY"),
  );
});
```

```ts
export interface StreamLoopTransferInput {
  readonly state: ProofCheckState;
  readonly streamSessionKey: string;
  readonly yieldedMemberKey: string;
  readonly companion: ProofSemanticsCompanion;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/yield-resume.test.ts ./tests/unit/proof-check/stream-loop.test.ts
```

---

### Task 34C: Cross-Core Ownership Transfer

**Description:** Implement cross-core eligibility checks, companion ownership/memory-ordering validation, transfer patch replay, and packet facts.

**Dependencies:** Tasks 8, 11, 13, 22, 29, 31, and 32.

**Files:**

- Create: `src/proof-check/domains/cross-core-ownership.ts`
- Test: `tests/unit/proof-check/cross-core-ownership.test.ts`

**Acceptance Criteria:**

- Core validates catalog transfer eligibility, concrete type, brand, capability kind, source place, destination core key, and operation authority before invoking the companion.
- Transfer rejects path-branded, packet/source-bound, private-state-bound, borrowed, partially moved, open-obligation, open-session, pending-validation, pending-attempt, and non-transferable platform-capability dependencies.
- Missing companion ownership/memory-ordering certificate emits `PROOF_CHECK_CROSS_CORE_CERTIFICATE_MISSING`.
- Companion patch transfers exactly the named source place/capability to the named destination core and adds exactly the named ordering fact.
- Accepted transfer emits checked capability-flow and cross-core ordering packet facts.

**Code Examples:**

```ts
test("cross-core transfer without companion certificate is rejected", () => {
  const result = checkCrossCoreOwnershipTransfer(
    crossCoreOwnershipInputForTest({
      companion: proofSemanticsCompanionFake({ providedJudgments: [] }),
      sourcePlace: proofCheckPlaceForTest("buffer"),
    }),
  );

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_CROSS_CORE_CERTIFICATE_MISSING"),
  );
});
```

```ts
export interface CrossCoreOwnershipTransferInput {
  readonly state: ProofCheckState;
  readonly sourcePlace: ProofCheckStructuredPlace;
  readonly destinationCoreKey: string;
  readonly capabilityKind: ProofCapabilityKindId;
  readonly companion: ProofSemanticsCompanion;
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/cross-core-ownership.test.ts
```

---

### Task 34D: Extension Dispatch Facade

**Description:** Add the small extension-domain facade after extension gates, yield/resume, stream-loop, and cross-core ownership have landed. This task owns no domain-specific transfer logic.

**Dependencies:** Tasks 34A, 34B, and 34C.

**Files:**

- Create: `src/proof-check/domains/extensions.ts`
- Test: `tests/unit/proof-check/extensions.test.ts`

**Acceptance Criteria:**

- `checkProofCheckExtensionTransfer` dispatches only by the closed extension operation category: `extensionGate`, `yieldResume`, `streamLoop`, and `crossCoreOwnership`.
- Each branch delegates to the owning domain function from Tasks 34A, 34B, or 34C without duplicating domain validation.
- Unknown extension categories reject with `PROOF_CHECK_UNSAFE_EXTENSION` and stable owner key `extension:<category>`.
- Dispatcher output is exactly the delegated `ProofCheckTransitionResult`; it does not create packet entries, state patches, or diagnostics on success.
- Task 36 uses this facade when wiring the operation registry from Task 14A.

**Code Examples:**

```ts
test("extension dispatcher delegates cross-core ownership by category", () => {
  const result = checkProofCheckExtensionTransfer({
    category: "crossCoreOwnership",
    input: crossCoreOwnershipInputForTest({
      companion: proofSemanticsCompanionFake({ providedJudgments: ["crossCoreOwnership"] }),
    }),
  });

  expect(result.delegatedTo).toBe("crossCoreOwnership");
});
```

```ts
export type ProofCheckExtensionTransferCategory =
  | "extensionGate"
  | "yieldResume"
  | "streamLoop"
  | "crossCoreOwnership";
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/extensions.test.ts
```

---

### Task 35: Fact Packet Builder And Packet Validator

**Description:** Finalize packet assembly by collecting already-certified domain packet entries from accepted states, sorting them deterministically, and revalidating them with the packet envelope validator from Task 5A plus domain-specific category validators.

**Dependencies:** Tasks 5, 5A, 13, 18, 19, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 33, 34A, 34B, 34C, and 34D.

**Files:**

- Modify: `src/proof-check/validation/packet-validator.ts`
- Test: `tests/unit/proof-check/fact-packet-builder.test.ts`
- Test: `tests/unit/proof-check/packet-validator.test.ts`

**Acceptance Criteria:**

- Packet builder accepts staged domain entries for ownership, noalias, field-disjointness, erasure, validated-buffer, packet-source, private-state, platform-effect, capability-flow, terminal-closure, exit-closure, layout/ABI, and origin facts; the domain task that creates each fact category owns the first category-specific success/rejection tests.
- Packet entries cite only existing Proof MIR, layout, authority, core certificate, semantics certificate, summary-instantiation certificate, packet/source, and private-generation dependencies.
- Invalidation entries are exactly `placeMutation`, `placeMove`, `placeConsume`, `loanConflict`, `privateStateAdvance`, `platformEffect`, `runtimeEffect`, `packetSourceSplit`, `callResultRewrite`, `cfgRewrite`, `abiRewrite`, and `authorityChange`.
- Packet validator keeps the Task 5A envelope checks and adds final category-specific validation for invalid subjects, stale authority fingerprints, and packet facts whose certificate does not prove the subject.
- Packet entries sort by fact kind, subject key, validity scope, and origin.
- This task must not add new fact kinds, packet arrays, dependency kinds, or invalidation kinds; any missing category is a defect in the owning domain task.

**Code Examples:**

```ts
test("packet validator rejects dependency on missing core certificate", () => {
  const packet = checkedFactPacketForTest({
    ownership: [
      ownershipFactForTest({
        dependencies: [{ kind: "coreCertificate", certificateId: proofCheckCoreCertificateId(99) }],
      }),
    ],
    certificates: [],
  });

  const diagnostics = validateCheckedFactPacket(packet);

  expect(diagnostics[0]?.code).toBe(proofCheckDiagnosticCode("PROOF_CHECK_INVALID_FACT_PACKET"));
});
```

```ts
export interface CheckedFactPacketBuilderInput {
  readonly acceptedFunctions: readonly CheckedMirFunction[];
  readonly stagedEntries: readonly CheckedFactPacketEntry<CheckedFactKindId, CheckedFactSubject>[];
  readonly certificates: readonly ProofCheckCertificate[];
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/fact-packet-builder.test.ts ./tests/unit/proof-check/packet-validator.test.ts
```

---

### Task 36: Public Orchestration And Exports

**Description:** Replace the fail-closed public facade with complete orchestration: input validation, whole-image driver, terminal closure, packet validation, diagnostics normalization, and checked MIR result construction.

**Dependencies:** Tasks 10, 11A, 14A, 15, 15A, 21, 33, 34D, and 35.

**Files:**

- Modify: `src/proof-check/proof-checker.ts`
- Create: `src/proof-check/index.ts`
- Modify: `src/index.ts`
- Test: `tests/integration/proof-check/proof-and-resource-checker.test.ts`
- Test: `tests/integration/proof-check/public-api.test.ts`

**Acceptance Criteria:**

- `checkProofAndResources` validates inputs, runs checker kernel in reachable topological order, validates terminal closure, builds and validates packet, sorts diagnostics, and returns `kind: "ok"` only when no error diagnostics exist.
- Orchestration builds a `ProofCheckOperationTransferRegistry` from Task 14A and wires domain transfer functions, loop/join hooks, resource-limit hooks, diagnostic-suppression hooks, and the Task 34D extension facade in one place.
- `src/proof-check/index.ts` exports the public proof-check API, public checked-model types, diagnostics, IDs, authority input types, and intentionally excludes internal kernel/domain helper functions.
- Top-level `src/index.ts` exports `proofCheck` namespace exactly once.
- `kind: "ok"` includes `checked` and non-error diagnostics only.
- `kind: "error"` never includes checked MIR or packet.
- `checked.facts` is the only public checked fact packet source.
- Repeated calls with the same input produce equal result kind, diagnostics, checked function keys, summaries, terminal graph, and packet keys.

**Code Examples:**

```ts
test("checkProofAndResources returns checked mir and packet for accepted program", () => {
  const result = checkProofAndResources(proofCheckClosedFixture());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.checked.mir.functions.entries().length).toBeGreaterThan(0);
  expect(result.checked.facts.origins.length).toBeGreaterThan(0);
});
```

```ts
export function checkProofAndResources(
  input: CheckProofAndResourcesInput,
): CheckProofAndResourcesResult {
  const inputResult = validateProofCheckInput(input);
  if (inputResult.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return { kind: "error", diagnostics: sortProofCheckDiagnostics(inputResult.diagnostics) };
  }
  return runProofCheckReferenceChecker(input, inputResult);
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/proof-check/proof-and-resource-checker.test.ts ./tests/integration/proof-check/public-api.test.ts
```

---

### Task 37: Integration Suite For Calls, Resources, Sessions, Validation, Attempts, And Private State

**Description:** Complete and broaden end-to-end integration coverage for calls, resources, sessions, validation, attempts, and private state using real source through HIR, mono, layout, Proof MIR, and proof checking when the syntax is listed as supported in "Current Source Syntax Support For Integration Tasks."

**Dependencies:** Tasks 11A and 36.

**Files:**

- Modify: `tests/support/proof-check/integration-fixtures.ts`
- Modify: `tests/integration/proof-check/call-requirements.test.ts`
- Modify: `tests/integration/proof-check/source-call-summaries.test.ts`
- Modify: `tests/integration/proof-check/move-use-consume.test.ts`
- Modify: `tests/integration/proof-check/field-sensitive-loans.test.ts`
- Modify: `tests/integration/proof-check/validation-and-attempts.test.ts`
- Modify: `tests/integration/proof-check/validation-splits.test.ts`
- Modify: `tests/integration/proof-check/attempt-splits.test.ts`
- Modify: `tests/integration/proof-check/take-session-closure.test.ts`
- Modify: `tests/integration/proof-check/private-state-threading.test.ts`

**Acceptance Criteria:**

- Must-reject cases cover unsatisfied source-call requirements, forged summary facts, use after move/consume, whole-object use with field loan, live loan return, open obligation return, live session member return, wrong-session discharge, ignored validation result, divergent validation split, divergent attempt split, stale private predicate, and wrapper values with hidden affine/linear content treated as droppable.
- Success cases cover ordinary source call with satisfied requirements, certified callee summary import, disjoint field use while another field is loaned, validation success packet/source facts, attempt arms repaired to common state, private generation invalidation and re-proving, and `Option[WritableBuffer]` where `Some` is sent and `None` has no live resource.
- Source-level cases using `checkProofSourceForTest`: ordinary source-call requirements with `requires:` blocks, certified callee summary import, move/use/consume snippets using supported `let`/call/member/return syntax, simple field-loan snippets using supported member access and borrowing forms if the probe returns `"supported"`, and private predicate snippets using supported proof-surface syntax if the probe returns `"supported"`.
- Hand-built Proof MIR fixture cases using `proofCheckClosedFixture({ invalidCase })`: forged summary facts, live loan return, live session member return, wrong-session discharge, ignored validation result, divergent validation split, divergent attempt split, wrapper values with hidden affine/linear content, and any source syntax not accepted by the current frontend.
- `checkProofSourceForTest` is added to `integration-fixtures.ts`; it runs parser/HIR/mono/layout/Proof MIR/proof-check end to end and accepts an optional `fixtureFallback` that supplies a hand-built MIR fixture when a case is intentionally below frontend syntax maturity.
- `probeProofCheckSourceSyntaxForTest` is used at least once in this task to assert that unsupported examples route through fixture fallback rather than silently skipping coverage.
- Each file includes one deterministic diagnostic assertion that checks code order and owner/root-cause keys.

**Code Examples:**

```ts
test("return with open take-buffer obligation is rejected end to end", () => {
  const result = checkProofSourceForTest(`
    fn main(buffer: WritableBuffer) -> WritableBuffer:
      take buffer
      return buffer
  `);

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics.map((diagnostic) => diagnostic.code)).toContain(
    proofCheckDiagnosticCode("PROOF_CHECK_LEAKED_OBLIGATION"),
  );
});
```

```ts
export function checkProofSourceForTest(
  source: string,
  options?: { readonly fixtureFallback?: () => CheckProofAndResourcesInput },
): CheckProofAndResourcesResult {
  const syntaxSupport = probeProofCheckSourceSyntaxForTest(source);
  const built = buildProofMirInputFromSourceForProofCheckTest(source);
  if (
    (syntaxSupport === "unsupported-source-syntax" || built.kind === "unsupported-source-syntax") &&
    options?.fixtureFallback !== undefined
  ) {
    return checkProofAndResources(options.fixtureFallback());
  }
  if (built.kind !== "ok") {
    return { kind: "error", diagnostics: built.diagnostics };
  }
  return checkProofAndResources(withProofCheckAuthoritiesForTest({ mir: built.mir }));
}
```

```ts
test("source call imports certified returned fact after requirement discharge", () => {
  const result = checkProofSourceForTest(`
    fn make_len(value: Length) -> Length:
      requires:
        value <= 8
      return value

    fn main(value: Length) -> Length:
      requires:
        value <= 8
      make_len(value)
  `);

  expect(result.kind).toBe("ok");
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/proof-check/call-requirements.test.ts ./tests/integration/proof-check/source-call-summaries.test.ts ./tests/integration/proof-check/move-use-consume.test.ts ./tests/integration/proof-check/field-sensitive-loans.test.ts ./tests/integration/proof-check/validation-and-attempts.test.ts ./tests/integration/proof-check/validation-splits.test.ts ./tests/integration/proof-check/attempt-splits.test.ts ./tests/integration/proof-check/take-session-closure.test.ts ./tests/integration/proof-check/private-state-threading.test.ts
```

---

### Task 38: Integration Suite For Layout, Platform, Runtime, Terminal, Loops, Extensions, And Packets

**Description:** Complete and broaden end-to-end integration coverage for validated buffers, platform/runtime authority, terminal closure, loops, extensions, cross-core ownership, and checked packet contents using the source-syntax support list and fixture fallback where needed.

**Dependencies:** Tasks 11A and 36.

**Files:**

- Modify: `tests/integration/proof-check/validated-buffer-bounds.test.ts`
- Modify: `tests/integration/proof-check/platform-contracts.test.ts`
- Modify: `tests/integration/proof-check/terminal-graph-checker.test.ts`
- Modify: `tests/integration/proof-check/terminal-closure.test.ts`
- Modify: `tests/integration/proof-check/checked-fact-packet.test.ts`

**Acceptance Criteria:**

- Must-reject cases cover missing `payloadEnd`, missing `layout.fits`, derived field read without source field certificate, sparse write then send length one, mismatched platform capability consumption, missing platform precondition, runtime catalog fingerprint mismatch, invalid panic closure, terminal return without platform reachability, terminal self-cycle, mutual terminal cycle, missing loop convergence, unsupported extension, missing cross-core certificate, and non-core-movable MoveRing transfer.
- Success cases cover `Packet.validate` success and error stream-member closure, derived `Packet.kind` refinement, contiguous `write_u8(offset=0)` send, platform preserved relational facts, consumed/produced capabilities, terminal function delegating to platform terminal primitive, core-movable MoveRing transfer with companion certificate, and checked packet containing ownership, erasure, layout/ABI, terminal, and origin facts.
- Source-level cases using `checkProofSourceForTest`: validated-buffer declarations with `params:` and `layout:` sections, validated-buffer reads when the probe returns `"supported"`, `Packet.validate` snippets when the probe returns `"supported"`, contiguous write/send snippets using supported calls/member access when the probe returns `"supported"`, platform precondition snippets using supported `platform fn` plus `requires:` blocks, and terminal function snippets using supported `terminal fn` forms.
- Hand-built Proof MIR fixture cases using `proofCheckClosedFixture({ invalidCase })`: runtime catalog fingerprint mismatch, terminal self-cycle, mutual terminal cycle, missing loop convergence, unsupported extension, missing cross-core certificate, non-core-movable MoveRing transfer, cross-core success transfer, and any source syntax not accepted by the current frontend.
- Packet integration asserts sorted packet keys and exact dependency kinds for at least ownership, validated-buffer, platform-effect, terminal-closure, layout/ABI, and origin entries.
- `probeProofCheckSourceSyntaxForTest` is used at least once in this task to assert that unsupported examples route through fixture fallback rather than silently skipping coverage.

**Code Examples:**

```ts
test("runtime catalog fingerprint mismatch is rejected end to end", () => {
  const input = proofCheckClosedFixture({
    runtimeCatalogFingerprintName: "selected-runtime",
    embeddedRuntimeCatalogFingerprintName: "embedded-runtime",
  });

  const result = checkProofAndResources(input);

  expect(result.kind).toBe("error");
  if (result.kind !== "error") return;
  expect(result.diagnostics[0]?.code).toBe(
    proofCheckDiagnosticCode("PROOF_CHECK_RUNTIME_CATALOG_AUTHENTICATION_FAILED"),
  );
});
```

```ts
test("accepted packet contains terminal and origin facts", () => {
  const result = checkProofAndResources(proofCheckClosedFixture({ terminalPlatformBase: true }));

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") return;
  expect(result.checked.facts.terminalClosure.length).toBeGreaterThan(0);
  expect(result.checked.facts.origins.length).toBeGreaterThan(0);
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/proof-check/validated-buffer-bounds.test.ts ./tests/integration/proof-check/platform-contracts.test.ts ./tests/integration/proof-check/terminal-graph-checker.test.ts ./tests/integration/proof-check/terminal-closure.test.ts ./tests/integration/proof-check/checked-fact-packet.test.ts
```

---

### Task 39: Property Generator And Stable Result Keys

**Description:** Build the bounded `fast-check` generator and stable result-key helper used by final determinism tests.

**Dependencies:** Tasks 11A and 36.

**Files:**

- Create: `tests/support/proof-check/property-generators.ts`
- Test: `tests/unit/proof-check/property-generators.test.ts`

**Acceptance Criteria:**

- `smallProofMirProgramArbitrary()` generates structurally valid Proof MIR programs that pass `validateProofCheckInput` when wrapped with `proofCheckClosedFixture({ mir })`.
- Generated programs are bounded to at most 4 functions, 6 blocks per function, 10 edges per function, 12 facts, 8 places, 4 loans, 4 obligations, 3 validations, 3 attempts, and 4 exits.
- The generator produces at least one acyclic branch graph, one reachable source-call graph, one validation split shape, one attempt split shape, and one terminal exit shape across 100 runs.
- `proofCheckResultStableKey(result)` includes result kind, diagnostic order keys, counterexample path keys, checked function keys, summary keys, terminal graph key, and packet entry keys; it excludes rendered diagnostic messages.
- `fast-check` remains test-only.

**Code Examples:**

```ts
test("generated programs pass proof-check input validation", () => {
  fastCheck.assert(
    fastCheck.property(smallProofMirProgramArbitrary(), (mir) => {
      const input = proofCheckClosedFixture({ mir });
      expect(validateProofCheckInput(input).diagnostics).toEqual([]);
    }),
  );
});
```

```ts
export function proofCheckResultStableKey(result: CheckProofAndResourcesResult): string {
  if (result.kind === "error") {
    return stableJsonForTest({
      kind: "error",
      diagnostics: result.diagnostics.map((diagnostic) => diagnostic.order),
      counterexamples: result.diagnostics.map(
        (diagnostic) => diagnostic.counterexample?.frames ?? [],
      ),
    });
  }
  return stableJsonForTest({
    kind: "ok",
    checkedFunctions: result.checked.checkedFunctions
      .entries()
      .map((entry) => entry.functionInstanceId),
    summaries: result.checked.summaries.entries().map((entry) => entry.functionInstanceId),
    terminalGraph: result.checked.terminalGraph.terminalKey,
    packet: checkedFactPacketStableKeysForTest(result.checked.facts),
  });
}
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/unit/proof-check/property-generators.test.ts
```

---

### Task 40: Determinism, Policy Recheck, And Handoff Verification

**Description:** Add final deterministic replay coverage, public diagnostic determinism snapshots, property tests using Task 39 generators, and full handoff verification.

**Dependencies:** Tasks 37, 38, and 39.

**Files:**

- Create: `tests/integration/proof-check/deterministic-diagnostics.test.ts`
- Create: `tests/integration/proof-check/property-determinism.test.ts`
- Test: `tests/integration/proof-check/deterministic-diagnostics.test.ts`
- Test: `tests/integration/proof-check/property-determinism.test.ts`

**Acceptance Criteria:**

- Repeated invalid proof-check runs compare diagnostic code order, owner keys, root-cause keys, stable details, and counterexample path keys.
- Repeated accepted proof-check runs compare checked function keys, summary keys, terminal graph keys, and checked packet entry keys.
- Property tests use `smallProofMirProgramArbitrary()` and compare `proofCheckResultStableKey(first)` with `proofCheckResultStableKey(second)`.
- `bun run policy:check` is run again to verify the Task 0 import-boundary rule still passes after all implementation tasks.
- Final handoff command passes: `PATH="$HOME/.bun/bin:$PATH" bun run agent:check`.

**Code Examples:**

```ts
test("diagnostics are deterministic across repeated invalid proof-check runs", () => {
  const input = proofCheckClosedFixture({ invalidCase: "missing-platform-precondition" });

  const first = checkProofAndResources(input);
  const second = checkProofAndResources(input);

  expect(first.kind).toBe("error");
  expect(second.kind).toBe("error");
  if (first.kind !== "error" || second.kind !== "error") return;
  expect(first.diagnostics.map((diagnostic) => diagnostic.order)).toEqual(
    second.diagnostics.map((diagnostic) => diagnostic.order),
  );
});
```

```ts
test("small generated proof-check programs are deterministic", () => {
  fastCheck.assert(
    fastCheck.property(smallProofMirProgramArbitrary(), (program) => {
      const input = proofCheckClosedFixture({ mir: program });
      const first = checkProofAndResources(input);
      const second = checkProofAndResources(input);
      expect(proofCheckResultStableKey(first)).toBe(proofCheckResultStableKey(second));
    }),
  );
});
```

**Verification:**

```bash
PATH="$HOME/.bun/bin:$PATH" bun test ./tests/integration/proof-check/deterministic-diagnostics.test.ts ./tests/integration/proof-check/property-determinism.test.ts
PATH="$HOME/.bun/bin:$PATH" bun run policy:check
PATH="$HOME/.bun/bin:$PATH" bun run agent:check
```

---

## Spec Coverage Self-Review

- Public API, input contract, checked MIR, packet envelope validation, and checked fact packet are covered by Tasks 4, 5, 5A, 10, 35, and 36.
- Authority fingerprints, canonical serialization, platform/runtime/type catalogs, trusted axiom membership, and companion certificate validation are covered by Tasks 2, 6, 7, 8, 22, 30, and 31.
- Deterministic state, reducer, operation dispatch, worklist, joins, loops, counterexamples, diagnostics, suppression, and resource limits are covered by Tasks 12, 13, 14, 14A, 15, 15A, 32, 39, and 40.
- Fact propagation, requirement entailment, type-intrinsic facts, private generations, and layout/validated-buffer entailment are covered by Tasks 9, 18, 19, and 29.
- Source-call summaries, source-call import, whole-image acyclic checking, terminal summaries, and terminal graph closure are covered by Tasks 20, 21, and 33.
- Ownership, move/use/consume, field-sensitive loans, noalias, erasure, take sessions, validation, attempts, extension gates, yield, stream loops, extension dispatch, and cross-core transfer are covered by Tasks 17, 23, 24, 25, 26, 27, 28, 34A, 34B, 34C, and 34D.
- Platform/runtime contracts, guarded postconditions, capability flow, effects, default-deny invalidation, panic, divergence, and terminal effects are covered by Tasks 22, 30, 31, and 33.
- Early domain integration harness and required per-domain success/rejection coverage are covered by Task 12A and each domain task's integration-matrix file; final public-API integration consolidation is covered by Tasks 37 and 38.
- Determinism, property testing, dependency boundaries, no runtime dependencies, fakes through dependency injection, and final `agent:check` are covered by Tasks 0, 39, and 40.
