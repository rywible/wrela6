# Source-Level UEFI Bringup Implementation Plan

## Goal

Build the source-visible UEFI PacketCounter bringup fixture described in
`docs/design/source-level-uefi-bringup-design.md` and make it pass full-image
validation through the production compiler pipeline.

## Current Verification Baseline

Use `/Users/ryanwible/.bun/bin/bun` or add `/Users/ryanwible/.bun/bin` to
`PATH` when running commands in this shell.

Focused checks run during the audit:

- `bun test tests/integration/validation/full-image/reference-checkers.test.ts tests/integration/validation/full-image/reference-checkers-proof-optir.test.ts tests/integration/validation/full-image/reference-checkers-source-platform.test.ts`
  passed.
- `bun test tests/integration/target/uefi-aarch64/package-pipeline.test.ts tests/integration/target/uefi-aarch64/stdlib-source-root.test.ts tests/integration/target/uefi-aarch64/status-abi-bridge.test.ts`
  passed.
- `bun test tests/unit/proof-check/source-call-transfer.test.ts tests/unit/proof-check/validation-arm-cleanup.test.ts tests/unit/proof-mir/expression-lowerer.test.ts tests/unit/target/aarch64/fact-preservation.test.ts`
  passed.
- `bun test tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts`
  failed in proof-check with `pending validation result parameter:0 is not owned`
  and `PROOF_CHECK_USE_AFTER_MOVE`.
- `bun run agent:check` currently fails typecheck in
  `tests/unit/proof-check/validation-arm-cleanup.test.ts` because a fixture
  modifier object lacks the full modifier shape.

Stabilizing the current dirty-worktree failures is Task 1. Do not expand the
PacketCounter source fixture before Task 1 is green.

## Task 1: Stabilize Current WIP

**Files:**

- Modify `tests/unit/proof-check/validation-arm-cleanup.test.ts`
- Modify proof-check canonical-place changes only if needed:
  `src/proof-check/domains/validation.ts`,
  `src/proof-check/kernel/registry/transition-helpers.ts`,
  `src/proof-check/kernel/registry/edge-handlers.ts`

**Steps:**

- Add the missing `isPlatform`, `isPredicate`, `isConstructor`, and `isPrivate`
  fields to the failing test fixture modifier object.
- Re-run `bun run typecheck`.
- Reproduce PacketCounter proof-check failure with:
  `bun test tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts`.
- Fix canonical-place handling so validation pending result aliases resolve to
  an owned place instead of `parameter:0` when the actual Proof MIR place is the
  pending validation result.
- Re-run the PacketCounter production-pipeline test.

**Expected Result:** Existing compact PacketCounter tests are green before the
richer UEFI fixture is introduced.

## Task 2: Add Frontend Regression Coverage

**Files:**

- Modify `tests/unit/frontend/parser/image-declaration-parser.test.ts`
- Modify `tests/unit/frontend/ast/expression-views.test.ts` or add a focused
  AST test file if the existing file is already crowded.
- Modify `tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts`

**Steps:**

- Add a parser test for the exact bringup source shape, including `devices:`,
  `boot(firmware: UefiFirmware) -> Result[Never, BootError]`,
  object literal named arguments, method calls, `loop:`, and
  `? BootError.X`.
- Add AST assertions that `AttemptExpressionView.alternative()` sees
  `BootError.X`, `NamedArgumentView.value()` can be an object literal, and the
  image devices section exposes `net0: NetworkDevice`.
- Add a fixture-source assertion that the final PacketCounter fixture contains
  the richer constructs once Task 10 updates it.

**Expected Result:** The parser and AST layer prove the desired source is real
syntax, while later tasks prove it is semantically compiled.

## Task 3: Add Source API Definitions

**Files:**

- Modify `stdlib/wrela-std/core/result.wr`
- Add `stdlib/wrela-std/target/uefi/firmware.wr`
- Add `stdlib/wrela-std/target/uefi/boot.wr`
- Add `stdlib/wrela-std/target/uefi/virtio.wr`
- Add matching ejected-stdlib fixture files under
  `tests/fixtures/full-image-validation/packet-counter/ejected-stdlib/src/wrela-std`
- Add direct-platform ABI files under
  `tests/fixtures/full-image-validation/packet-counter/direct-platform/src/wrela_abi`

**Steps:**

- Replace the non-generic placeholder `Result` with a source-visible
  `Result[Ok, Err]` shape accepted by the type checker.
- Define `BootError` cases used by the fixture.
- Define source-visible `UefiFirmware`, `VirtioDevices`, `MachinePlan`,
  `Machine`, `MachineDevices`, `NetworkDevice`, `NetworkPaths`, `NetworkRx`,
  `NetworkTx`, and `NetworkWake` shapes.
- Use `unique edge class NetworkDevice` for the network root and `edge class`
  for net paths.
- Keep source definitions dependency-free and avoid host imports or generated
  source.

**Expected Result:** The target fixture source can import and name all desired
types in each stdlib mode.

## Task 4: Extend Semantic UEFI Entry And API Contracts

**Files:**

- Modify `src/target/uefi-aarch64/package-pipeline-semantic-target.ts`
- Modify `src/target/uefi-aarch64/platform-catalog.ts`
- Modify `src/semantic/names/platform-binding.ts` only if constrained edge
  handles require a new legal source shape.
- Modify `src/semantic/names/platform-primitives.ts` if the constrained edge
  catalog needs owner or capability-binding metadata.
- Modify `src/semantic/surface/platform-certifier.ts`
- Modify `tests/integration/target/uefi-aarch64/package-pipeline.test.ts`
- Add or modify semantic tests for constrained edge contracts, Wrela source
  wrappers, and the UEFI entry shape.

**Steps:**

- Change the UEFI source profile to accept
  `boot(firmware: UefiFirmware) -> Result[Never, BootError]` while preserving
  the physical image handle/system table ABI in the layout target surface.
- Keep public `firmware.*`, `machine.*`, and `NetworkDevice.*` APIs in Wrela
  source. Their bodies should call the smallest target-bound edge handles needed
  to cross into firmware/hardware behavior.
- Add certified constrained edge primitives for the UEFI boundary operations.
  The exact split between source wrapper and edge handle should keep policy,
  record/device shaping, and ergonomic method names in source.
- Preserve the existing compiler preference for freestanding target-bound
  `platform fn` handles unless this work deliberately implements private
  platform functions inside edge classes with exact-contract certification.
- Add target proof contracts for each constrained edge, especially attempt input
  positions for `bind_virtio_net`, `plan_machine`, and `exit`.
- Add tests rejecting local/forged API declarations that do not match the
  target contract.

**Expected Result:** Semantic checking accepts the intended boot signature,
compiles the ergonomic UEFI API from Wrela source, and attaches real
target-authorized contracts only to the constrained edge calls.

## Task 5: Seed Firmware And Device Capabilities

**Files:**

- Modify `src/hir/image-lowerer.ts`
- Modify `src/proof-check/domains/initial-state.ts`
- Modify `src/proof-check/authority/semantics-companion.ts`
- Modify UEFI target authority/reference-checker files as needed.
- Add unit tests for firmware parameter and image device capability seeding.

**Steps:**

- Make the `UefiFirmware` boot parameter a compiler-seeded affine capability,
  not an ordinary constructible object.
- Preserve existing image device seed behavior for `net0: NetworkDevice`.
- Add authority records that identify firmware capability and image device
  capability origins.
- Reject forged construction of `UefiFirmware`, `MachinePlan`, `Machine`, and
  unique device roots outside the certified paths.

**Expected Result:** Proof-check initial state and retained authority can show
where firmware and device capabilities came from.

## Task 6: Implement HIR/Mono Resource Flow For Bringup

**Files:**

- Modify `src/hir/call-lowerer.ts`
- Modify `src/hir/expression-lowerer.ts`
- Modify `src/hir/statement-lowerer.ts`
- Modify `src/hir/type-resource-kind.ts`
- Modify mono proof metadata cloning files only where metadata is not carried.
- Add unit tests in `tests/unit/hir` and `tests/unit/mono`.

**Steps:**

- Preserve expected resource kind for object literal fields and named call
  arguments.
- Ensure receiver/argument resource places are present for firmware API calls.
- Ensure `Result[Never, BootError]` and infinite-loop terminal behavior do not
  create fake normal returns.
- Carry attempt metadata and image/device resource places through mono.

**Expected Result:** HIR and mono contain enough real resource metadata for
Proof MIR to reason about firmware, plan, machine, and device values.

## Task 7: Fix Proof MIR Attempt Control Flow

**Files:**

- Modify `src/proof-mir/lower/attempt-lowerer.ts`
- Modify `src/proof-mir/lower/tail-return.ts`
- Modify `src/proof-mir/lower/statement-lowerer.ts` if return/propagation
  needs a statement-level continuation.
- Add Proof MIR tests for `? BootError.X` in return and let-binding contexts.

**Steps:**

- Lower attempt success to the continuation that uses the ok value.
- Lower attempt error to the alternative expression and early-return behavior
  required by `?`.
- Make tail return and `Result[Never, BootError]` behavior explicit; do not
  treat attempts as empty unreachable arms.
- Preserve declared input places on success and error edges.
- Make proof-check worklist edge transfer reduce MIR edge effects before split
  comparison so recorded attempt consumption is actually enforced.

**Expected Result:** Proof MIR honestly represents `? BootError.X` and no longer
hides capability loss behind empty arms.

## Task 8: Implement UEFI Proof-Check Phase And Error-Path Rules

**Files:**

- Split `src/proof-check/domains/validation.ts` before expanding it.
- Modify `src/proof-check/domains/attempts.ts`
- Modify `src/proof-check/domains/source-calls.ts`
- Modify `src/proof-check/kernel/registry/call-handlers.ts`
- Modify `src/proof-check/kernel/registry/edge-handlers.ts`
- Modify `src/proof-check/kernel/registry/terminator-handlers.ts`
- Add unit and integration tests under `tests/unit/proof-check` and
  `tests/integration/proof-check`.

**Steps:**

- Add UEFI capability/phase facts for pre-exit firmware, planned machine, and
  post-exit machine.
- Enforce that `exit` consumes firmware and machine plan on success.
- Enforce that error edges retain, reclaim, return, or discharge declared
  inputs; reject silent drops.
- Reject post-exit firmware use, missing device binding, using `net0` after
  `plan_machine`, and normal returns from `Result[Never, BootError]`.

**Expected Result:** The negative capability fixtures fail for proof reasons,
not parser or fixture-loader reasons.

## Task 9: Add OptIR And AArch64 Lowering For UEFI APIs

**Files:**

- Modify `src/target/uefi-aarch64/platform-catalog.ts`
- Modify `src/target/uefi-aarch64/runtime-catalog.ts`
- Modify `src/target/uefi-aarch64/firmware-lowering.ts`
- Modify `src/target/uefi-aarch64/runtime-helper-objects.ts`
- Modify `src/target/aarch64/lower/operation-materializer-calls.ts` if new
  lowering rules reach machine calls.
- Add target lowering tests.

**Steps:**

- Add lowering records for the constrained UEFI edge handles used by the Wrela
  source API wrappers.
- Use inline compiler operations for pure capability bookkeeping and helper
  objects for target-owned runtime work.
- Preserve retained OptIR operations/facts identifying UEFI bringup, device
  binding, machine planning, and exit.
- Ensure AArch64 object output exposes deterministic evidence for helper calls
  or emitted target-owned objects.

**Expected Result:** The new APIs lower through production OptIR and AArch64
code paths without injected OptIR or test-only dependencies.

## Task 10: Expand PacketCounter Fixture

**Files:**

- Modify `tests/fixtures/full-image-validation/packet-counter/*/src/image.wr`
- Modify PacketCounter source modules as needed:
  `packet_counter/counter.wr`, `packet_counter/console.wr`,
  `packet_counter/packet.wr`
- Modify bad-payload sibling only if it remains part of the targeted validation
  story.
- Modify fixture catalog tests.

**Steps:**

- Replace `boot() -> UefiStatus` wrappers with the richer source bringup
  program.
- Keep existing validated packet behavior and marker output so current
  PacketCounter reference checks still have meaningful packet evidence.
- Use direct-platform imports for direct mode and stdlib imports for toolchain
  and ejected modes.
- Re-run the PacketCounter production-pipeline test after each mode is updated.

**Expected Result:** PacketCounter source expresses UEFI bringup honestly in all
selected stdlib modes.

## Task 11: Extend Full-Image Reference Checks

**Files:**

- Modify `src/validation/full-image/reference-checkers/proof-fact-reference.ts`
- Modify `src/validation/full-image/reference-checkers/semantic-platform-reference.ts`
- Modify `src/validation/full-image/reference-checkers/opt-ir-reference.ts`
- Modify `src/validation/full-image/reference-checkers/aarch64-object-reference.ts`
- Modify `tests/integration/validation/full-image/reference-checkers-*.test.ts`

**Steps:**

- Require semantic platform evidence for the UEFI source API contracts.
- Require proof/Proof MIR evidence for firmware capability, device capability,
  machine plan, exit phase, and net device split.
- Require OptIR evidence for UEFI bringup/device operations from the optimized
  production artifact.
- Require AArch64 object evidence for target-owned helper/runtime material.
- Add negative checker tests proving forged layout/OptIR-only evidence does not
  satisfy proof/device/capability requirements.

**Expected Result:** Full-image validation proves the richer fixture uses
retained compiler-domain evidence, not source text alone.

## Task 12: Add Negative Fixtures And Tests

**Files:**

- Add negative fixture sources under a focused fixture directory or integration
  test helpers.
- Add tests under `tests/integration/validation/full-image` or
  `tests/integration/proof-check`.

**Steps:**

- Add invalid phase use: call a firmware API after `exit`.
- Add dropped capability on error: use `?` on a fallible call whose contract
  does not retain/reclaim a consumed affine input.
- Add missing device binding: plan or boot without binding `net0`.
- Add invalid post-exit firmware use: use `firmware` after a successful
  `firmware.exit(...)`.
- Assert stable diagnostic codes and stable details.

**Expected Result:** The requested invalid programs fail for the intended
semantic/proof reasons.

## Task 13: Documentation And Final Validation

**Files:**

- Update `docs/design/source-level-uefi-bringup-design.md`
- Update this implementation plan with design drift discovered during build.
- Update older full-image/UEFI docs only where they contradict the built model.

**Steps:**

- Run narrow tests for the touched subsystems.
- Run `bun run format`.
- Run `bun run validate:full-image`.
- Run `bun run agent:check`.
- Record any known limitations in docs before handoff.

**Expected Result:** The richer PacketCounter fixture compiles through the full
production pipeline and required validation commands pass.

## Implementation Status

The final implementation followed the source-wrapper direction from the plan:
public UEFI bringup APIs live in Wrela source, and target-owned platform
functions are private constrained edges. The implementation tightened the
example into explicit phase edges: `UefiFirmware -> UefiMemoryReserved ->
VirtioDiscovery/UefiVirtioBinder -> NetworkBinding/MachinePlanner ->
MachinePlan -> Machine`.

Built pieces:

- PacketCounter source in all selected stdlib modes now uses a source-visible
  `firmware: UefiFirmware` entry and returns `Result[Never, BootError]`.
- The production pipeline accepts the firmware entry signature, preserves the
  source API calls through semantic, HIR, mono, Proof MIR, proof-check, OptIR,
  AArch64 lowering/backend, linker, and PE/COFF writer.
- Attempt lowering handles `? BootError.X` in let and return contexts, and the
  proof-check attempt model rejects divergent success/error ownership so error
  paths cannot silently drop live capabilities.
- Object literal lowering now rejects missing checked fields; this makes a
  missing `net0` device binding fail before target lowering.
- Full-image reference checks require semantic, proof, and OptIR evidence for
  the UEFI source API primitives used by PacketCounter.
- Negative coverage includes invalid pre-reservation phase use, missing device
  binding, invalid firmware reuse after the bringup/exit path, and an explicit
  proof-check error-path capability-drop test.

Design drift:

- The final source API does not keep all methods on `UefiFirmware`; phase
  progression is represented by ordinary source-visible edge types instead.
- `MachinePlan.exit()` is the constrained source call for `ExitBootServices`,
  rather than `firmware.exit(machine_plan=...)`.
- The reference checks prove source UEFI edge evidence via reachable primitive
  IDs, platform precondition facts, and OptIR platform calls. More granular
  phase-specific fact families can be added later without changing the fixture
  source shape.
