# Full Image Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement `docs/design/full-image-validation-design.md` as a deterministic acceptance harness that compiles representative UEFI AArch64 image source trees into self-contained `.efi` artifacts, including `PacketCounterImage` across toolchain stdlib, ejected stdlib, and direct-platform modes.

**Architecture:** Add a focused `src/validation/full-image` subsystem that builds the explicit validation matrix, loads fixture packages through existing compiler source-root APIs, drives the real UEFI AArch64 target pipeline with trace capture, validates stage trails, checks final PE/COFF bytes and linked-layout self-containment, runs independent reference checkers, optionally runs nonce-qualified QEMU/AArch64 UEFI smoke, and returns a compact deterministic report. The harness does not repair compiler failures and does not count injected OptIR fixture dependencies as production confidence.

**Tech Stack:** TypeScript, Bun test runner, existing Wrela compiler phase APIs, existing UEFI AArch64 target driver APIs, existing PE/COFF parser, existing slow linker validator, dependency injection for filesystem/QEMU host effects, no new production dependencies, `fast-check` only for tests if needed.

---

## Research Notes

- Design source: `docs/design/full-image-validation-design.md`.
- Existing target compile entry point: `src/target/uefi-aarch64/compile-uefi-aarch64-image.ts`.
- Existing source package model: `CompilerPackageInput`, `CompilerSourceRoot`, `packageInputFromFixtureProject`, and `defaultUefiAArch64SourceRoots` in `src/target/uefi-aarch64/package-input.ts`.
- Existing compile verification already promotes the inner stage trail from `target-driver-authenticate` through `pe-coff-writer`.
- Existing package pipeline currently parses real source in `parseModuleGraph`, then production adapters fail closed at `semantic`, `monomorphization`, `layout-facts`, `proof-mir`, `proof-check`, and `opt-ir`. Full image validation is not complete until those adapters are wired for the production confidence cases.
- Existing UEFI fixture roots already cover smoke-console variants under `tests/fixtures/uefi-aarch64/smoke-basic`, `smoke-ejected-stdlib`, and `smoke-direct-platform`.
- Existing QEMU harness already supports both default boot path `EFI/BOOT/BOOTAA64.EFI` and UEFI Shell launched path `EFI/WRELA/SMOKEAA64.EFI`, with nonce-qualified shell success/failure markers in `src/target/uefi-aarch64/qemu-smoke.ts`.
- Existing PE/COFF parser is `parsePeCoffImage` in `src/pe-coff/pe-parser.ts`. It parses headers, data directories, section bytes, and base relocation blocks from final bytes.
- Existing slow linked-layout reference checker is `tests/support/linker/slow-linked-image-validator.ts`.
- Existing stdlib console wrapper only has `write_smoke_marker`; `PacketCounterImage` needs a public `write_console_string(message: Utf16Static) -> UefiStatus` wrapper.
- `utf16_static("...")` is used by current UEFI fixtures and stdlib wrappers, but no frontend/semantic/HIR phase currently owns a source-level intrinsic with that name. This plan adds an explicit UEFI compiler-intrinsic task before production semantic/HIR adapter work.

## Existing Repo Grounding

- Runtime source must stay dependency-free. Host filesystem loading belongs in tests, scripts, or explicit validation host adapters.
- UEFI package source roots are explicitly untrusted today: `trustedForAuthority: false` is the only allowed value.
- `compileUefiAArch64Image` returns only the final artifact. Reference checkers need package-pipeline and binary-spine internals, so this plan adds a traceable build path that shares the same underlying target operations and proves it is byte-equivalent to `compileUefiAArch64Image`.
- `productionPackagePipelineDependencies()` is the correct home for real source-to-OptIR adapters. Test fixture dependencies from `tests/support/target/uefi-aarch64/package-pipeline-fixtures.ts` remain allowed for bring-up tests but cannot satisfy production confidence.
- The UEFI semantic platform catalog currently identifies primitives by canonical IDs such as `uefi.console.outputString`, while source declarations use names such as `output_string`. Full source adapters need a deterministic primitive name catalog rather than relying on string guesses.
- The validation matrix is explicitly eight cases in v1:

```text
smoke-console/toolchain-stdlib
smoke-console/ejected-stdlib
smoke-console/direct-platform
packet-counter/toolchain-stdlib
packet-counter/ejected-stdlib
packet-counter/direct-platform
status-error/toolchain-stdlib
watchdog-or-boot-policy/toolchain-stdlib
```

## Parallelization Map

Use this dependency map when dispatching subagents. A task can start when all listed dependencies have landed and their tests pass. Tasks without direct dependencies can run in parallel.

```text
Task 1: validation model, diagnostics, matrix
Task 2 depends on Task 1: stage trail verifier
Task 3 depends on Task 1: traceable UEFI image build API
Task 4 depends on Task 1: fixture manifest and source-root loader
Task 5 depends on Task 4: smoke/status/watchdog fixture expansion and stdlib wrapper
Task 6 depends on Tasks 4, 5, 7A: PacketCounter fixture corpus
Task 7 depends on Task 1: UEFI platform primitive name catalog and validation feature gate
Task 7A depends on Task 7: UEFI utf16_static compiler intrinsic
Task 8 depends on Tasks 7, 7A: semantic and HIR production package adapter
Task 9 depends on Task 8: monomorphization production package adapter
Task 10 depends on Task 9: layout-facts production package adapter
Task 11 depends on Task 10: proof-MIR production package adapter
Task 12 depends on Task 11: proof-check production package adapter
Task 13 depends on Task 12: OptIR production package adapter and static CHAR16 extraction
Task 14 depends on Tasks 7, 13: validation fixture packet-source primitive lowering
Task 15 depends on Tasks 1, 2, 3, 4: full-image validation runner skeleton
Task 16 depends on Task 15: source-root authority and target metadata checks
Task 17 depends on Task 3: binary structure checker
Task 18 depends on Task 3: linked-layout self-contained checker
Task 19 depends on Tasks 1, 3: reference checker framework
Task 20 depends on Task 19: source-root and semantic-platform reference checkers
Task 21 depends on Task 19: proof-fact and OptIR reference checkers
Task 22 depends on Tasks 17, 18, 19: object, linked-layout, and PE reference checkers
Task 23 depends on Task 19: UEFI TCB golden reference checker
Task 24 depends on Tasks 6, 14, 15, 16, 17, 18, 20, 21, 22, 23: equivalence and determinism checker
Task 25 depends on Task 15: QEMU smoke integration
Task 26 depends on Tasks 15, 24, 25: CLI and package scripts
Task 27 depends on all tasks: final integration, audit, and agent checks
```

Safe parallel batches:

```text
Batch A: Task 1
Batch B: Tasks 2, 3, 4, 7
Batch C: Tasks 5, 7A, 15, 17, 18, 19
Batch D: Tasks 6, 8, 16, 20, 21, 22, 23, 25
Batch E: Task 9
Batch F: Task 10
Batch G: Task 11
Batch H: Task 12
Batch I: Task 13
Batch J: Task 14
Batch K: Task 24
Batch L: Task 26
Batch M: Task 27
```

## File Structure

Create production validation files:

```text
src/validation/
  index.ts
  full-image/
    binary-structure-checker.ts
    diagnostics.ts
    determinism.ts
    fixture-catalog.ts
    index.ts
    matrix.ts
    qemu.ts
    reference-checkers/
      index.ts
      types.ts
      stdlib-source-root-reference.ts
      semantic-platform-reference.ts
      proof-fact-reference.ts
      opt-ir-reference.ts
      aarch64-object-reference.ts
      linked-layout-reference.ts
      pe-coff-reference.ts
      uefi-tcb-golden-reference.ts
    report.ts
    runner.ts
    self-contained-checker.ts
    source-authority.ts
    stage-trail.ts
```

Modify target-driver files:

```text
src/target/uefi-aarch64/
  compile-uefi-aarch64-image.ts
  package-input.ts
  package-pipeline.ts
  platform-catalog.ts
  target-surfaces.ts
  index.ts
```

Modify stdlib and fixtures:

```text
stdlib/wrela-std/target/uefi/console.wr

tests/fixtures/full-image-validation/
  smoke-console/
    toolchain-stdlib/
    ejected-stdlib/
    direct-platform/
  packet-counter/
    toolchain-stdlib/
    ejected-stdlib/
    direct-platform/
  status-error/
    toolchain-stdlib/
  watchdog-or-boot-policy/
    toolchain-stdlib/
```

Add tests:

```text
tests/unit/validation/full-image/
  binary-structure-checker.test.ts
  determinism.test.ts
  fixture-catalog.test.ts
  matrix.test.ts
  qemu.test.ts
  reference-checkers.test.ts
  report.test.ts
  self-contained-checker.test.ts
  source-authority.test.ts
  stage-trail.test.ts

tests/integration/validation/full-image/
  full-image-validation-runner.test.ts
  full-image-validation-matrix.test.ts
  packet-counter-production-pipeline.test.ts
  qemu-validation-smoke.test.ts
  reference-checkers.test.ts

tests/audit/
  full-image-validation-audit.test.ts
```

Add scripts:

```text
scripts/validate-full-image.ts
package.json
```

## Shared Constants

Use these exact case and stage keys. Do not create alternate spellings.

```ts
export const FULL_IMAGE_VALIDATION_REQUIRED_STAGE_KEYS = Object.freeze([
  "target-driver-authenticate",
  "frontend",
  "semantic",
  "monomorphization",
  "layout-facts",
  "proof-mir",
  "proof-check",
  "opt-ir",
  "aarch64-lowering",
  "aarch64-backend",
  "static-char16-objects",
  "runtime-helper-objects",
  "synthetic-entry-object",
  "linker",
  "pe-coff-writer",
] as const);

export const FULL_IMAGE_VALIDATION_ALLOWED_EXTRA_STAGE_KEYS = Object.freeze([
  "artifact-sink",
  "qemu-smoke",
] as const);

export const FULL_IMAGE_VALIDATION_CASES = Object.freeze([
  ["smoke-console", "toolchain-stdlib"],
  ["smoke-console", "ejected-stdlib"],
  ["smoke-console", "direct-platform"],
  ["packet-counter", "toolchain-stdlib"],
  ["packet-counter", "ejected-stdlib"],
  ["packet-counter", "direct-platform"],
  ["status-error", "toolchain-stdlib"],
  ["watchdog-or-boot-policy", "toolchain-stdlib"],
] as const);
```

---

## Task 1: Validation Model, Diagnostics, Matrix

**Description:** Add the public full-image validation data model, deterministic diagnostics, closed scenario/mode unions, and the v1 matrix helper.

**Dependencies:** None.

**Files:**

```text
src/validation/index.ts
src/validation/full-image/index.ts
src/validation/full-image/diagnostics.ts
src/validation/full-image/matrix.ts
src/validation/full-image/report.ts
tests/unit/validation/full-image/matrix.test.ts
tests/unit/validation/full-image/report.test.ts
```

**Acceptance Criteria:**

- `FullImageValidationStdlibMode` is exactly `"toolchain-stdlib" | "ejected-stdlib" | "direct-platform"`.
- `FullImageValidationScenarioKey` is exactly `"smoke-console" | "packet-counter" | "status-error" | "watchdog-or-boot-policy"`.
- `fullImageValidationV1Cases()` returns exactly the eight required cases in deterministic order.
- Report types include source roots, source/module counts, target metadata, stage runs, binary checks, reference checks, equivalence evidence, QEMU smoke, artifact fingerprint, artifact byte length, compiler diagnostics, and validation diagnostics.
- `FullImageValidationCheckReport` includes `checkerKey`, `status`, `stableDetail`, `inputAuthority`, and deterministic evidence records so every checker explains what it was allowed to inspect.
- Diagnostics are frozen, sorted by `ownerKey`, `code`, `stableDetail`, and are stable across repeated calls.
- Public barrel exports are available from `src/validation` and `src/validation/full-image`.

**Code Examples:**

```ts
export type FullImageValidationStdlibMode =
  | "toolchain-stdlib"
  | "ejected-stdlib"
  | "direct-platform";

export type FullImageValidationScenarioKey =
  | "smoke-console"
  | "packet-counter"
  | "status-error"
  | "watchdog-or-boot-policy";

export interface FullImageValidationCaseKey {
  readonly scenario: FullImageValidationScenarioKey;
  readonly stdlibMode: FullImageValidationStdlibMode;
}
```

```ts
export interface FullImageValidationCaseReport {
  readonly caseKey: string;
  readonly scenario: FullImageValidationScenarioKey;
  readonly stdlibMode: FullImageValidationStdlibMode;
  readonly packageKey: string;
  readonly artifactName?: string;
  readonly compileStatus: "passed" | "failed";
  readonly sourceRoots: readonly FullImageValidationSourceRootReport[];
  readonly sourceFileCount: number;
  readonly moduleCount: number;
  readonly targetMetadata?: UefiAArch64TargetMetadata;
  readonly stageRuns: readonly FullImageValidationStageRunReport[];
  readonly binaryChecks: readonly FullImageValidationCheckReport[];
  readonly referenceChecks: readonly FullImageValidationCheckReport[];
  readonly equivalenceEvidence: readonly FullImageValidationEquivalenceEvidence[];
  readonly smoke?: UefiAArch64SmokeReport;
  readonly artifactFingerprint?: string;
  readonly artifactByteLength?: number;
  readonly compilerDiagnostics: readonly UefiAArch64TargetDiagnostic[];
  readonly diagnostics: readonly FullImageValidationDiagnostic[];
}
```

```ts
export interface FullImageValidationEvidenceRecord {
  readonly evidenceKey: string;
  readonly authority:
    | "final-bytes"
    | "linked-layout"
    | "compiler-trace"
    | "source-package"
    | "golden";
  readonly stableDetail: string;
}

export interface FullImageValidationCheckReport {
  readonly checkerKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail: string;
  readonly inputAuthority: readonly FullImageValidationEvidenceRecord["authority"][];
  readonly evidence: readonly FullImageValidationEvidenceRecord[];
}
```

**Required Tests:**

```ts
test("v1 matrix is explicit and deterministic", () => {
  expect(fullImageValidationV1Cases().map(fullImageValidationCaseKey)).toEqual([
    "smoke-console/toolchain-stdlib",
    "smoke-console/ejected-stdlib",
    "smoke-console/direct-platform",
    "packet-counter/toolchain-stdlib",
    "packet-counter/ejected-stdlib",
    "packet-counter/direct-platform",
    "status-error/toolchain-stdlib",
    "watchdog-or-boot-policy/toolchain-stdlib",
  ]);
});
```

**Verification Commands:**

```sh
bun test tests/unit/validation/full-image/matrix.test.ts
bun test tests/unit/validation/full-image/report.test.ts
```

---

## Task 2: Stage Trail Verifier

**Description:** Implement a pure verifier that checks `compileUefiAArch64Image` verification runs against the full-image required stage contract.

**Dependencies:** Task 1.

**Files:**

```text
src/validation/full-image/stage-trail.ts
tests/unit/validation/full-image/stage-trail.test.ts
```

**Acceptance Criteria:**

- A successful production confidence case requires each required stage key exactly once and in the required order.
- Stage status must be `"passed"` for every required stage in a successful case.
- `artifact-sink` is allowed only after `pe-coff-writer`.
- `qemu-smoke` is allowed only after an artifact exists.
- Unknown extra stage keys fail unless explicitly listed in `FullImageValidationRequest.allowedExtraStageRunKeys`.
- Duplicate required stage keys fail.
- Missing required stage keys fail with stable details naming the missing key.
- A failed compile report still records the observed stage trail without pretending missing later stages passed.

**Code Examples:**

```ts
export interface VerifyFullImageValidationStageTrailInput {
  readonly runs: readonly UefiAArch64TargetVerifierRun[];
  readonly compileStatus: "passed" | "failed";
  readonly artifactCreated: boolean;
  readonly allowedExtraStageRunKeys?: readonly string[];
}

export type VerifyFullImageValidationStageTrailResult =
  | { readonly kind: "ok"; readonly stageRuns: readonly FullImageValidationStageRunReport[] }
  | {
      readonly kind: "error";
      readonly stageRuns: readonly FullImageValidationStageRunReport[];
      readonly diagnostics: readonly FullImageValidationDiagnostic[];
    };
```

```ts
expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
  "stage-trail:duplicate-required-stage:semantic",
]);
```

**Required Tests:**

```ts
test("allows artifact-sink only after PE writer", () => {
  const result = verifyFullImageValidationStageTrail({
    compileStatus: "passed",
    artifactCreated: true,
    runs: [
      ...requiredRunsThrough("pe-coff-writer"),
      { verifierKey: "uefi-aarch64-compile", runKey: "artifact-sink", status: "passed" },
    ],
  });

  expect(result.kind).toBe("ok");
});
```

**Verification Commands:**

```sh
bun test tests/unit/validation/full-image/stage-trail.test.ts
```

---

## Task 3: Traceable UEFI Image Build API

**Description:** Add a traceable target-driver build path that exposes the same package-pipeline and binary-spine outputs needed by validation reference checkers, while preserving byte equivalence with `compileUefiAArch64Image`.

**Dependencies:** Task 1.

**Files:**

```text
src/target/uefi-aarch64/compile-uefi-aarch64-image.ts
src/target/uefi-aarch64/index.ts
tests/integration/target/uefi-aarch64/compile-uefi-aarch64-image.test.ts
```

**Acceptance Criteria:**

- Add `compileUefiAArch64ImageWithTrace` or an equivalent target-driver API that returns:
  - authenticated target surface
  - package pipeline output
  - binary spine output
  - final artifact
  - diagnostics
  - verification summary
- It must call the same target authentication, package pipeline, binary spine, artifact metadata, and artifact sink behavior as `compileUefiAArch64Image`.
- Existing `compileUefiAArch64Image` behavior and public result shape remain compatible.
- A test compiles the same package with both APIs and asserts identical artifact bytes, target metadata, artifact name, diagnostics, and verification run keys.
- Trace output is absent on failures after the failed phase and present for all completed phases.
- Do not expose test-only fixture dependencies from production validation APIs.

**Code Examples:**

```ts
export interface CompileUefiAArch64ImageTrace {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly packagePipeline: UefiAArch64PackageOptIrPipelineOutput;
  readonly binarySpine: UefiAArch64BinarySpineOutput;
}

export type CompileUefiAArch64ImageWithTraceResult =
  | {
      readonly kind: "ok";
      readonly artifact: UefiAArch64ImageArtifact;
      readonly trace: CompileUefiAArch64ImageTrace;
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
      readonly verification: UefiAArch64TargetVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
      readonly verification: UefiAArch64TargetVerificationSummary;
      readonly partialTrace?: Partial<CompileUefiAArch64ImageTrace>;
    };
```

```ts
test("trace build is byte-equivalent to normal compile", () => {
  const normal = compileUefiAArch64Image(input);
  const traced = compileUefiAArch64ImageWithTrace(input);

  expect(normal.kind).toBe("ok");
  expect(traced.kind).toBe("ok");
  if (normal.kind !== "ok" || traced.kind !== "ok") return;

  expect(traced.artifact.peCoffArtifact.bytes).toEqual(normal.artifact.peCoffArtifact.bytes);
  expect(traced.artifact.targetMetadata).toEqual(normal.artifact.targetMetadata);
  expect(traced.verification.runs).toEqual(normal.verification.runs);
});
```

**Verification Commands:**

```sh
bun test tests/integration/target/uefi-aarch64/compile-uefi-aarch64-image.test.ts
```

---

## Task 4: Fixture Manifest And Source-Root Loader

**Description:** Add a fixture catalog that maps full-image scenario/mode pairs to fixture directories, package keys, stdlib modes, artifact names, expected markers, and enabled validation-only features.

**Dependencies:** Task 1.

**Files:**

```text
src/validation/full-image/fixture-catalog.ts
tests/unit/validation/full-image/fixture-catalog.test.ts
```

**Acceptance Criteria:**

- Every v1 matrix case resolves to exactly one fixture project path.
- Fixture loading uses `packageInputFromFixtureProject` and injected filesystem effects.
- Stdlib mapping is exact:
  - `"toolchain-stdlib"` -> `defaultUefiAArch64SourceRoots({ projectSourceRoot: "src" })`
  - `"ejected-stdlib"` -> `stdlibMode: "project-ejected"`
  - `"direct-platform"` -> `stdlibMode: "none"`
- `packet-counter/*` cases enable exactly `["full-image-validation-fixture"]`.
- Non-packet cases do not enable the validation fixture feature.
- Catalog reports case markers:
  - smoke console marker: `WRELA_UEFI_SMOKE_OK`
  - packet counter marker: `WRELA_PACKET_COUNTER_OK`
  - status error expected status: `bad_buffer_size`
  - watchdog policy expected primitive: `set_watchdog_timer`

**Code Examples:**

```ts
export interface FullImageValidationFixtureSpec {
  readonly scenario: FullImageValidationScenarioKey;
  readonly stdlibMode: FullImageValidationStdlibMode;
  readonly fixtureProjectPath: string;
  readonly packageKey: string;
  readonly entryModuleName: "image";
  readonly artifactName: string;
  readonly packageStdlibMode: "toolchain" | "project-ejected" | "none";
  readonly enabledTargetFeatures: readonly string[];
  readonly expectedConsoleMarkers: readonly string[];
}
```

```ts
expect(
  fixtureSpecForFullImageCase({
    scenario: "packet-counter",
    stdlibMode: "direct-platform",
  }),
).toMatchObject({
  fixtureProjectPath: "tests/fixtures/full-image-validation/packet-counter/direct-platform",
  packageStdlibMode: "none",
  enabledTargetFeatures: ["full-image-validation-fixture"],
});
```

**Verification Commands:**

```sh
bun test tests/unit/validation/full-image/fixture-catalog.test.ts
```

---

## Task 5: Smoke, Status, Watchdog Fixtures And Stdlib Console Wrapper

**Description:** Move the existing smoke fixture pattern into the full-image fixture tree, add status-error and watchdog toolchain fixtures, and add the public stdlib console wrapper needed by PacketCounter.

**Dependencies:** Task 4.

**Files:**

```text
stdlib/wrela-std/target/uefi/console.wr
tests/fixtures/full-image-validation/smoke-console/toolchain-stdlib/src/image.wr
tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/src/image.wr
tests/fixtures/full-image-validation/smoke-console/ejected-stdlib/src/wrela-std/**
tests/fixtures/full-image-validation/smoke-console/direct-platform/src/image.wr
tests/fixtures/full-image-validation/status-error/toolchain-stdlib/src/image.wr
tests/fixtures/full-image-validation/watchdog-or-boot-policy/toolchain-stdlib/src/image.wr
tests/integration/validation/full-image/full-image-validation-matrix.test.ts
```

**Acceptance Criteria:**

- The smoke-console fixture source is equivalent across all three stdlib modes.
- The ejected stdlib copy includes the same `console.wr` wrapper content as `stdlib/wrela-std/target/uefi/console.wr`.
- Direct-platform smoke fixture imports no `wrela_std` modules.
- `status-error/toolchain-stdlib` returns `UefiStatus.bad_buffer_size` through source.
- `watchdog-or-boot-policy/toolchain-stdlib` exercises the stdlib watchdog wrapper or the target boot policy source path.
- All fixture packages parse successfully with `productionPackagePipelineDependencies().parseModuleGraph`.
- The fixture catalog test proves every source root has `trustedForAuthority: false`.

**Code Examples:**

```wrela
// stdlib/wrela-std/target/uefi/console.wr
platform fn output_string(message: Utf16Static) -> UefiStatus

pub fn write_console_string(message: Utf16Static) -> UefiStatus:
    output_string(message)

pub fn write_smoke_marker() -> UefiStatus:
    write_console_string(utf16_static("WRELA_UEFI_SMOKE_OK\r\n"))
```

```wrela
// tests/fixtures/full-image-validation/status-error/toolchain-stdlib/src/image.wr
use UefiStatus from wrela_std.target.uefi.status

uefi image StatusErrorImage:

fn boot() -> UefiStatus:
    UefiStatus.bad_buffer_size
```

**Verification Commands:**

```sh
bun test tests/integration/validation/full-image/full-image-validation-matrix.test.ts
```

---

## Task 6: PacketCounter Fixture Corpus

**Description:** Create the concrete `PacketCounterImage` fixture source trees for toolchain stdlib, ejected stdlib, and direct-platform modes.

**Dependencies:** Tasks 4, 5, and 7A.

**Files:**

```text
tests/fixtures/full-image-validation/packet-counter/toolchain-stdlib/src/image.wr
tests/fixtures/full-image-validation/packet-counter/toolchain-stdlib/src/packet_counter/packet.wr
tests/fixtures/full-image-validation/packet-counter/toolchain-stdlib/src/packet_counter/counter.wr
tests/fixtures/full-image-validation/packet-counter/toolchain-stdlib/src/packet_counter/console.wr
tests/fixtures/full-image-validation/packet-counter/toolchain-stdlib/src/packet_counter/fixture_source.wr
tests/fixtures/full-image-validation/packet-counter/toolchain-stdlib/src/packet_counter/uefi_status.wr
tests/fixtures/full-image-validation/packet-counter/ejected-stdlib/src/**
tests/fixtures/full-image-validation/packet-counter/direct-platform/src/**
tests/fixtures/full-image-validation/packet-counter-bad-payload/toolchain-stdlib/src/**
tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

**Acceptance Criteria:**

- The three PacketCounter fixture variants have the same public module shape:
  - `image`
  - `packet_counter.packet`
  - `packet_counter.counter`
  - `packet_counter.console`
  - `packet_counter.fixture_source`
  - `packet_counter.uefi_status`
- Toolchain and ejected stdlib variants import console/status wrappers from `wrela_std`.
- Direct-platform variant declares only allowed platform primitives directly and imports no `wrela_std`.
- The fixture includes a validation source provider:
  - `platform fn validation_fixture_packet_source() -> ReadableBuffer`
- The positive fixture bytes are exactly `01 02 41 42`.
- The exact negative sibling fixture path is `tests/fixtures/full-image-validation/packet-counter-bad-payload/toolchain-stdlib`.
- The negative sibling fixture uses the same source modules as `packet-counter/toolchain-stdlib`, but the fixture catalog supplies packet bytes `01 09 41`.
- The negative sibling must return `UefiStatus.bad_buffer_size` because `counter_delta = 9` requires a payload ending at byte `11`, while the source has only one payload byte.
- The fixture contains at least one fixed field, one derived enum-like field, one length/layout guard, one source call, one platform call, one static `utf16_static` marker, and one status return.
- Parser import discovery resolves every fixture module in all three modes.

**Code Examples:**

```wrela
// src/image.wr
use run_packet_counter from packet_counter.counter
use UefiStatus from packet_counter.uefi_status

uefi image PacketCounterImage:

fn boot() -> UefiStatus:
    run_packet_counter()
```

```wrela
// src/packet_counter/packet.wr
use UefiStatus from packet_counter.uefi_status

enum PacketKind:
    count
    ignored

dataclass PacketLimits:
    max_frame_bytes: usize

validated buffer CounterPacket:
    params:
        limits: PacketLimits

    layout:
        kind_byte: u8 at 0
        counter_delta: u8 at 1
        payload: bytes at 2 len usize(counter_delta)

    derive:
        kind: PacketKind from kind_byte:
            1 => PacketKind.count
            otherwise => PacketKind.ignored

    require:
        source.len >= 2 else UefiStatus.bad_buffer_size
        source.len <= limits.max_frame_bytes else UefiStatus.bad_buffer_size
        layout.fits else UefiStatus.bad_buffer_size
```

```wrela
// src/packet_counter/counter.wr
use write_packet_counter_marker from packet_counter.console
use validation_fixture_packet_source from packet_counter.fixture_source
use CounterPacket, PacketKind, PacketLimits from packet_counter.packet
use UefiStatus from packet_counter.uefi_status

fn run_packet_counter() -> UefiStatus:
    let limits = PacketLimits(max_frame_bytes=64)

    take validation_fixture_packet_source() as source:
        match CounterPacket.validate(source=source, limits=limits):
            case Ok(packet):
                if packet.kind == PacketKind.count:
                    let count = usize(packet.counter_delta) + 1
                    write_packet_counter_marker(count=count)
                else:
                    write_packet_counter_marker(count=0)

            case Err(status):
                return status
```

```wrela
// stdlib-mode src/packet_counter/console.wr
use write_console_string from wrela_std.target.uefi.console
use UefiStatus from packet_counter.uefi_status

pub fn write_packet_counter_marker(count: usize) -> UefiStatus:
    write_console_string(utf16_static("WRELA_PACKET_COUNTER_OK\r\n"))
```

```wrela
// direct-platform src/packet_counter/console.wr
use UefiStatus from packet_counter.uefi_status

platform fn output_string(message: Utf16Static) -> UefiStatus

pub fn write_packet_counter_marker(count: usize) -> UefiStatus:
    output_string(utf16_static("WRELA_PACKET_COUNTER_OK\r\n"))
```

```wrela
// direct-platform src/packet_counter/uefi_status.wr
pub enum UefiStatus:
    success
    load_error
    invalid_parameter
    unsupported
    bad_buffer_size
    buffer_too_small
    device_error
    not_found
    aborted
    security_violation
```

```ts
expect(packetCounterFixtureBytes("packet-counter/toolchain-stdlib")).toEqual([
  0x01, 0x02, 0x41, 0x42,
]);
expect(packetCounterFixtureBytes("packet-counter-bad-payload/toolchain-stdlib")).toEqual([
  0x01, 0x09, 0x41,
]);
```

**Verification Commands:**

```sh
bun test tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

---

## Task 7: UEFI Platform Primitive Name Catalog And Validation Feature Gate

**Description:** Add deterministic mapping from Wrela source-level platform function names to canonical UEFI primitive IDs, and add a feature-gated validation-only fixture primitive.

**Dependencies:** Task 1.

**Files:**

```text
src/target/uefi-aarch64/platform-catalog.ts
src/target/uefi-aarch64/package-input.ts
src/target/uefi-aarch64/index.ts
tests/unit/target/uefi-aarch64/platform-catalog.test.ts
tests/integration/target/uefi-aarch64/package-input.test.ts
```

**Acceptance Criteria:**

- Export `uefiAArch64PlatformPrimitiveNameCatalog()` with this exact name and mapping:
  - `output_string` -> `uefi.console.outputString`
  - `set_watchdog_timer` -> `uefi.boot.setWatchdogTimer`
  - `exit_boot_services_with_fresh_map` -> `uefi.boot.exitBootServices`
  - `validation_fixture_packet_source` -> `uefi.validation.fixturePacketSource`
- The validation fixture primitive is present in the semantic target surface with availability feature `full-image-validation-fixture`.
- `CompilerPackageInput` carries `enabledTargetFeatures: readonly string[]`.
- `CompilerPackageInputOptions` and `FixtureProjectPackageInputOptions` both accept `enabledTargetFeatures?: readonly string[]`.
- `compilerPackageInput` normalizes `enabledTargetFeatures` by sorting with `compareCodeUnitStrings`, removing duplicates, freezing the array, and defaulting to `[]`.
- `packageInputFromFixtureProject` passes `enabledTargetFeatures` through to `compilerPackageInput`.
- `fixtureSpecForFullImageCase` is the only production validation caller that enables `full-image-validation-fixture`, and only for PacketCounter cases.
- Normal packages do not enable `full-image-validation-fixture`.
- A package that declares `validation_fixture_packet_source` without the feature fails semantic binding.
- A PacketCounter validation fixture with the feature binds the primitive successfully.
- Target fingerprints change deterministically when validation-only primitives are included, and tests pin the expected behavior through catalog fingerprints rather than path names.

**Code Examples:**

```ts
export const FULL_IMAGE_VALIDATION_FEATURE = "full-image-validation-fixture";

export interface CompilerPackageInput {
  readonly packageKey: string;
  readonly sourceRoots: readonly CompilerSourceRoot[];
  readonly sourceFiles: readonly CompilerSourceFileInput[];
  readonly entryModuleName: string;
  readonly enabledTargetFeatures: readonly string[];
}

export function uefiAArch64PlatformPrimitiveNameCatalog() {
  return platformPrimitiveNameCatalog([
    { name: "output_string", primitiveId: platformPrimitiveId("uefi.console.outputString") },
    { name: "set_watchdog_timer", primitiveId: platformPrimitiveId("uefi.boot.setWatchdogTimer") },
    {
      name: "exit_boot_services_with_fresh_map",
      primitiveId: platformPrimitiveId("uefi.boot.exitBootServices"),
    },
    {
      name: "validation_fixture_packet_source",
      primitiveId: platformPrimitiveId("uefi.validation.fixturePacketSource"),
    },
  ]);
}
```

```ts
expect(packageWithoutFeature.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
  "platform-binding:feature-disabled:validation_fixture_packet_source:full-image-validation-fixture",
);
```

**Verification Commands:**

```sh
bun test tests/unit/target/uefi-aarch64/platform-catalog.test.ts
bun test tests/integration/target/uefi-aarch64/package-input.test.ts
```

---

## Task 7A: UEFI `utf16_static` Compiler Intrinsic

**Description:** Add explicit source-level ownership for `utf16_static("...")`, producing certified `uefi.Utf16Static` values that the UEFI package pipeline can extract into static `CHAR16` metadata.

**Dependencies:** Task 7.

**Files:**

```text
src/target/uefi-aarch64/platform-catalog.ts
src/semantic/names/name-resolver.ts
src/semantic/surface/semantic-surface-checker.ts
src/hir/call-lowerer.ts
src/target/uefi-aarch64/package-pipeline.ts
src/target/uefi-aarch64/index.ts
tests/unit/target/uefi-aarch64/platform-catalog.test.ts
tests/integration/semantic/semantic-surface.test.ts
tests/integration/hir/lower-typed-hir-orchestration.test.ts
tests/integration/target/uefi-aarch64/package-pipeline.test.ts
```

**Acceptance Criteria:**

- The intrinsic source name is exactly `utf16_static`.
- It is available only when compiling for the UEFI AArch64 target surface; it is not added to target-agnostic core types.
- Name resolution binds `utf16_static` as a compiler intrinsic without requiring an import.
- Semantic checking requires exactly one argument and requires that argument to be a string literal.
- Semantic checking returns target type `uefi.Utf16Static`.
- HIR lowering preserves enough intrinsic metadata to recover the literal text and source value identity.
- The package OptIR adapter converts each accepted intrinsic call into:
  - one `UefiAArch64StaticChar16String`
  - one `UefiAArch64StaticChar16PointerRecord`
- Nonliteral calls such as `utf16_static(marker)` fail before OptIR with a stable diagnostic.
- Existing string literal parsing remains target-agnostic and unchanged.

**Code Examples:**

```ts
export const UEFI_AARCH64_UTF16_STATIC_INTRINSIC = Object.freeze({
  sourceName: "utf16_static",
  intrinsicKey: "uefi.utf16_static",
  parameterShape: ["string-literal"],
  returnTargetType: "uefi.Utf16Static",
});
```

```ts
expect(
  checkSemanticSurfaceForUefiSource('fn marker() -> Utf16Static: utf16_static("OK\\r\\n")'),
).toMatchObject({
  diagnostics: [],
  intrinsicCalls: [
    {
      intrinsicKey: "uefi.utf16_static",
      literalValue: "OK\r\n",
      returnTypeKey: "uefi.Utf16Static",
    },
  ],
});
```

**Verification Commands:**

```sh
bun test tests/integration/semantic/semantic-surface.test.ts
bun test tests/integration/hir/lower-typed-hir-orchestration.test.ts
bun test tests/integration/target/uefi-aarch64/package-pipeline.test.ts
```

---

## Production Adapter Contract For Tasks 8-13

Tasks 8-13 are serial because each phase consumes the previous phase's real artifact. Each task must implement the same four pieces before the next task starts:

```text
1. exact target-surface/input builder for that phase
2. adapter artifact extraction with a malformed-artifact diagnostic
3. phase diagnostic mapper into UEFI_AARCH64_PIPELINE_FAILED
4. one phase-stopping integration test proving the previous phases pass and this phase either passes or fails with its own stable owner
```

Use these helper names consistently in `src/target/uefi-aarch64/package-pipeline.ts`:

```ts
function packageStageDiagnostic(
  stageKey: UefiAArch64PackagePipelineStageKey,
  stableDetail: string,
): UefiAArch64TargetDiagnostic;

function mapPackageStageDiagnostics(
  stageKey: UefiAArch64PackagePipelineStageKey,
  diagnostics: readonly {
    readonly code?: string;
    readonly stableDetail?: string;
    readonly message?: string;
  }[],
): readonly UefiAArch64TargetDiagnostic[];

function missingAdapterArtifactDiagnostic(
  stageKey: UefiAArch64PackagePipelineStageKey,
  artifactKey: string,
): UefiAArch64TargetDiagnostic;
```

Each production adapter result must preserve the real phase input and result object on its adapter type. Do not add placeholder objects that only carry `kind`.

```ts
export interface PackageTypedHirAdapter {
  readonly kind: "typed-hir";
  readonly lowerTypedHirInput: LowerTypedHirInput;
  readonly lowerTypedHirResult: LowerTypedHirResult;
}

export interface PackageMonomorphizedImageAdapter {
  readonly kind: "mono-image";
  readonly monomorphizeWholeImageInput: MonomorphizeWholeImageInput;
  readonly monomorphizeWholeImageResult: MonomorphizeWholeImageResult & { readonly kind: "ok" };
  readonly reachablePlatformPrimitiveIds: readonly PlatformPrimitiveId[];
}
```

Each phase-stopping integration test should override only the next dependency:

```ts
const dependencies = {
  ...productionPackagePipelineDependencies(),
  computeRepresentationLayoutFacts: () => ({
    kind: "error" as const,
    diagnostics: [
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_PIPELINE_FAILED",
        ownerKey: "test-stop",
        stableDetail: "stop-after-monomorphization",
      }),
    ],
  }),
};
```

---

## Task 8: Semantic And HIR Production Package Adapter

**Description:** Replace the fail-closed `lowerTypedHir` production package adapter with a real semantic surface and typed-HIR adapter for UEFI package inputs.

**Dependencies:** Tasks 7 and 7A.

**Files:**

```text
src/target/uefi-aarch64/package-pipeline.ts
tests/integration/target/uefi-aarch64/package-pipeline.test.ts
tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

**Acceptance Criteria:**

- `productionPackagePipelineDependencies().lowerTypedHir` uses the parsed module graph produced by `parseModuleGraph`.
- It calls `buildItemIndex`, `CoreTypeCatalog.default()`, `resolveNames`, `checkSemanticSurface`, and `lowerTypedHir` from the real phase APIs.
- It passes `uefiAArch64PlatformPrimitiveNameCatalog()` into name resolution.
- It passes the authenticated target semantic surface into `checkSemanticSurface`.
- It passes `packageInput.enabledTargetFeatures` to semantic surface checking.
- It maps item-index, name-resolution, semantic, and HIR diagnostics to `UEFI_AARCH64_PIPELINE_FAILED` with owner key `uefi-aarch64-package-pipeline:semantic`.
- It returns a `PackageTypedHirAdapter` containing `lowerTypedHirInput` and `lowerTypedHirResult`.
- It fails if `parsedGraph.parsedGraph` is missing.
- It keeps existing injected dependency tests working.

**Code Examples:**

```ts
function lowerTypedHir(
  input: PackageTypedHirInput,
): UefiAArch64PackageStageResult<PackageTypedHirAdapter> {
  const graph = input.parsedGraph.parsedGraph;
  if (graph === undefined) return packageStageError("semantic", "parsed-graph:missing");

  const indexResult = buildItemIndex({ graph });
  const coreTypes = CoreTypeCatalog.default();
  const names = resolveNames({
    graph,
    index: indexResult.index,
    coreTypes,
    platformPrimitiveNames: uefiAArch64PlatformPrimitiveNameCatalog(),
  });
  const surface = checkSemanticSurface({
    graph,
    index: indexResult.index,
    references: names.references,
    platformBindings: names.platformBindings,
    coreTypes,
    targetSurface: input.target.semanticTarget,
    enabledFeatures: input.packageInput.enabledTargetFeatures,
  });
  const hir = lowerSourceTypedHir({
    graph,
    index: indexResult.index,
    references: names.references,
    coreTypes,
    program: surface.program,
    image: surface.image,
  });

  return typedHirAdapterOrDiagnostics({ indexResult, names, surface, hir });
}
```

**Required Tests:**

```ts
test("production semantic adapter lowers smoke source without injected fixture stages", () => {
  const result = runUefiAArch64PackagePipelineToOptIr(
    { packageInput, target },
    {
      ...productionPackagePipelineDependencies(),
      monomorphizeWholeImage: fakeStopAfterSemantic,
    },
  );

  expect(result.kind).toBe("error");
  expect(result.verification.runs.map((run) => run.runKey)).toEqual([
    "frontend",
    "semantic",
    "monomorphization",
  ]);
  expect(result.verification.runs[1]?.status).toBe("passed");
});
```

**Verification Commands:**

```sh
bun test tests/integration/target/uefi-aarch64/package-pipeline.test.ts
```

---

## Task 9: Monomorphization Production Package Adapter

**Description:** Replace the fail-closed `monomorphizeWholeImage` adapter with the real monomorphizer for typed-HIR package output.

**Dependencies:** Task 8.

**Files:**

```text
src/target/uefi-aarch64/package-pipeline.ts
tests/integration/target/uefi-aarch64/package-pipeline.test.ts
```

**Acceptance Criteria:**

- Adapter requires `typedHir.lowerTypedHirResult`.
- Adapter calls `monomorphizeWholeImage({ program, imageId })`.
- Image selection uses the single HIR image if exactly one exists; if multiple images exist, the adapter passes the selected image from semantic/HIR image seed.
- Adapter returns `PackageMonomorphizedImageAdapter` with:
  - `monomorphizeWholeImageInput`
  - `monomorphizeWholeImageResult`
  - `reachablePlatformPrimitiveIds`
- Mono diagnostics map to `UEFI_AARCH64_PIPELINE_FAILED` with owner `uefi-aarch64-package-pipeline:monomorphization`.
- Integration test proves the real adapter advances the production pipeline through `monomorphization` for smoke-console and PacketCounter fixture sources.

**Code Examples:**

```ts
const mono = monomorphizeWholeImage({
  program: input.typedHir.lowerTypedHirResult.program,
  imageId: input.typedHir.lowerTypedHirResult.program.images.entries()[0]?.imageId,
});
```

```ts
expect(result.value.reachablePlatformPrimitiveIds.map(String).sort()).toContain(
  "uefi.console.outputString",
);
```

**Verification Commands:**

```sh
bun test tests/integration/target/uefi-aarch64/package-pipeline.test.ts
```

---

## Task 10: Layout-Facts Production Package Adapter

**Description:** Replace the fail-closed layout adapter with real representation layout fact computation for UEFI AArch64.

**Dependencies:** Task 9.

**Files:**

```text
src/target/uefi-aarch64/package-pipeline.ts
src/target/uefi-aarch64/target-surfaces.ts
tests/integration/target/uefi-aarch64/package-pipeline.test.ts
tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

**Acceptance Criteria:**

- Add `productionUefiAArch64LayoutTargetSurface()` with this exact export name.
- The layout target is derived from the authenticated UEFI/AArch64 target data model, semantic target type kinds, image profile, platform edge surface, and pointer width.
- Adapter requires `monomorphizedImage.monomorphizeWholeImageResult`.
- Adapter calls `computeRepresentationLayoutFacts({ program, target })`.
- Adapter returns `PackageRepresentationLayoutFactsAdapter` with input and successful result.
- Layout diagnostics map to `UEFI_AARCH64_PIPELINE_FAILED` with owner `uefi-aarch64-package-pipeline:layout-facts`.
- PacketCounter layout output includes a validated-buffer fact for `CounterPacket`.
- Tests assert `layout.imageEntry` exists and target pointer width is 64.

**Code Examples:**

```ts
export function productionUefiAArch64LayoutTargetSurface(
  target: UefiAArch64TargetDriverSurface,
): LayoutTargetSurface {
  return {
    targetId: target.semanticTarget.targetId,
    dataModel: { endian: "little", pointerWidthBits: 64 },
    primitiveTypes: uefiLayoutPrimitiveTypeCatalog(target.semanticTarget),
    imageProfiles: uefiLayoutImageProfileCatalog(target.entryProfile),
    platformEdges: uefiLayoutPlatformEdgeCatalog(target.platformLowerings),
  };
}
```

```ts
expect(layoutFacts.computeRepresentationLayoutFactsResult.facts.validatedBuffers.entries()).toEqual(
  expect.arrayContaining([expect.objectContaining({ bufferName: "CounterPacket" })]),
);
```

**Verification Commands:**

```sh
bun test tests/integration/target/uefi-aarch64/package-pipeline.test.ts
bun test tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

---

## Task 11: Proof-MIR Production Package Adapter

**Description:** Replace the fail-closed proof-MIR adapter with real proof-MIR construction for UEFI AArch64.

**Dependencies:** Task 10.

**Files:**

```text
src/target/uefi-aarch64/package-pipeline.ts
src/target/uefi-aarch64/target-surfaces.ts
tests/integration/target/uefi-aarch64/package-pipeline.test.ts
tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

**Acceptance Criteria:**

- Add `productionUefiAArch64ProofMirBuildTargetContext()` with this exact export name.
- Target context uses the authenticated UEFI semantic target, runtime catalog, platform lowerings, entry ABI, and target type facts.
- Adapter requires successful monomorphization and layout facts.
- Adapter calls `buildProofMir({ program, layout, target })`.
- Adapter returns `PackageProofMirAdapter` with input and successful result.
- Proof-MIR diagnostics map to `UEFI_AARCH64_PIPELINE_FAILED` with owner `uefi-aarch64-package-pipeline:proof-mir`.
- PacketCounter proof-MIR output includes validation nodes for `CounterPacket.validate`.
- Tests assert source call graph and image entry root are present.

**Code Examples:**

```ts
const proofMirInput: BuildProofMirInput = {
  program: monomorphized.monomorphizeWholeImageResult.program,
  layout: layoutFacts.computeRepresentationLayoutFactsResult.facts,
  target: productionUefiAArch64ProofMirBuildTargetContext(input.target),
};

const result = buildProofMir(proofMirInput);
```

**Verification Commands:**

```sh
bun test tests/integration/target/uefi-aarch64/package-pipeline.test.ts
bun test tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

---

## Task 12: Proof-Check Production Package Adapter

**Description:** Replace the fail-closed proof-check adapter with real resource/proof checking and authority construction for UEFI AArch64.

**Dependencies:** Task 11.

**Files:**

```text
src/target/uefi-aarch64/package-pipeline.ts
src/target/uefi-aarch64/target-surfaces.ts
tests/integration/target/uefi-aarch64/package-pipeline.test.ts
tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

**Acceptance Criteria:**

- Add `productionUefiAArch64ProofCheckInputAuthority()` with this exact export name.
- Authority includes:
  - proof-check resource limits
  - platform contract catalog derived from authenticated semantic platform primitives
  - runtime catalog derived from authenticated UEFI runtime materializations
  - layout type facts from the layout program
  - semantic companion from checked semantic/HIR data
- Adapter requires successful proof-MIR and layout facts.
- Adapter calls `checkProofAndResources`.
- Adapter returns `PackageProofCheckAdapter` with input and successful result.
- Proof-check diagnostics map to `UEFI_AARCH64_PIPELINE_FAILED` with owner `uefi-aarch64-package-pipeline:proof-check`.
- PacketCounter proof-check output contains accepted fact packet entries for validated-buffer source transfer, layout bounds, platform call preconditions, and exit closure.
- Negative PacketCounter bytes or malformed proof obligations fail at proof-check or earlier with stable diagnostics.

**Code Examples:**

```ts
const authority = productionUefiAArch64ProofCheckInputAuthority({
  target: input.target,
  layout: input.layoutFacts.computeRepresentationLayoutFactsResult.facts,
  typedHir: input.proofMir.buildProofMirInput.program.sourceProgram,
});

const result = checkProofAndResources({
  mir: input.proofMir.buildProofMirResult.mir,
  layout: input.layoutFacts.computeRepresentationLayoutFactsResult.facts,
  ...authority,
});
```

**Verification Commands:**

```sh
bun test tests/integration/target/uefi-aarch64/package-pipeline.test.ts
bun test tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

---

## Task 13: OptIR Production Package Adapter And Static CHAR16 Extraction

**Description:** Replace the fail-closed OptIR adapter with real OptIR construction/optimization and extraction of certified static `CHAR16` metadata used by UEFI firmware lowering.

**Dependencies:** Task 12.

**Files:**

```text
src/target/uefi-aarch64/package-pipeline.ts
src/target/uefi-aarch64/target-surfaces.ts
tests/integration/target/uefi-aarch64/package-pipeline.test.ts
tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

**Acceptance Criteria:**

- Add `productionUefiAArch64OptIrTargetSurface()` with this exact export name.
- Adapter requires successful proof-check, proof-MIR, and layout facts.
- Adapter calls `buildOptimizedOptIr` from `src/opt-ir`.
- Adapter uses the repository's default optimization policy for a closed image, with target effects for UEFI platform/runtime operations.
- Adapter extracts certified `utf16_static(...)` string values into `staticChar16Strings`.
- Adapter maps OptIR value keys for static string arguments into `staticChar16Pointers`.
- Adapter returns `PackageOptimizedOptIrAdapter` with:
  - `program`
  - `operations`
  - `facts`
  - `staticChar16Strings`
  - `staticChar16Pointers`
  - `buildOptimizedOptIrInput`
  - `buildOptimizedOptIrResult`
- OptIR diagnostics map to `UEFI_AARCH64_PIPELINE_FAILED` with owner `uefi-aarch64-package-pipeline:opt-ir`.
- PacketCounter OptIR contains at least:
  - two packet-region memory loads
  - one integer binary operation
  - one integer compare operation
  - one canonical UEFI console platform call
  - no unsupported operation diagnostics

**Code Examples:**

```ts
const optIrInput: BuildOptimizedOptIrInput = {
  checked: input.proofCheck.checkProofAndResourcesResult.checked,
  mir: input.proofMir.buildProofMirResult.mir,
  layout: input.layoutFacts.computeRepresentationLayoutFactsResult.facts,
  target: productionUefiAArch64OptIrTargetSurface(input.target),
  policy: productionUefiAArch64OptIrOptimizationPolicy(),
};

const result = buildOptimizedOptIr(optIrInput);
```

```ts
expect(optIr.staticChar16Strings.map((entry) => entry.stableKey)).toContain(
  "packet-counter-marker",
);
expect(optIr.staticChar16Pointers).toEqual([
  expect.objectContaining({
    valueKey: expect.stringMatching(/^optir\.value:/),
    pointer: expect.objectContaining({ lifetime: "image-readonly", nulTerminated: true }),
  }),
]);
```

**Verification Commands:**

```sh
bun test tests/integration/target/uefi-aarch64/package-pipeline.test.ts
bun test tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

---

## Task 14: Validation Fixture Packet-Source Primitive Lowering

**Description:** Implement the feature-gated `validation_fixture_packet_source()` primitive as a compiler-owned validation fixture source provider lowered to static read-only packet bytes.

**Dependencies:** Tasks 7 and 13.

**Files:**

```text
src/target/uefi-aarch64/platform-catalog.ts
src/target/uefi-aarch64/package-pipeline.ts
src/target/uefi-aarch64/firmware-lowering.ts
src/target/uefi-aarch64/runtime-helper-objects.ts
tests/unit/target/uefi-aarch64/platform-catalog.test.ts
tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

**Acceptance Criteria:**

- The primitive ID is exactly `uefi.validation.fixturePacketSource`.
- The source name is exactly `validation_fixture_packet_source`.
- It is only semantically available when `full-image-validation-fixture` is enabled on the package input.
- It lowers to compiler-owned static read-only fixture bytes, not to a host file read and not to an external symbol.
- `CompilerPackageInput` carries an optional validation fixture packet byte record only when `full-image-validation-fixture` is enabled.
- `packet-counter/*` fixture specs set bytes to exactly `01 02 41 42`.
- `packet-counter-bad-payload/toolchain-stdlib` fixture spec sets bytes to exactly `01 09 41`.
- The byte record is frozen, range-checked to `0x00..0xff`, and rejected for non-validation packages.
- Output is represented as a `ReadableBuffer`/validated-buffer-compatible source according to existing target/type catalogs.
- Final linked image has no unresolved symbol named after the fixture source provider.
- Tests prove that a non-validation package declaring this primitive fails before codegen.

**Code Examples:**

```ts
export interface UefiAArch64ValidationFixturePacketSource {
  readonly primitiveId: "uefi.validation.fixturePacketSource";
  readonly feature: "full-image-validation-fixture";
  readonly bytes: readonly number[];
  readonly stableKey: string;
}
```

```ts
expect(linked.layout.symbols.entries().map((symbol) => symbol.name)).not.toContain(
  "validation_fixture_packet_source",
);
```

**Verification Commands:**

```sh
bun test tests/unit/target/uefi-aarch64/platform-catalog.test.ts
bun test tests/integration/validation/full-image/packet-counter-production-pipeline.test.ts
```

---

## Task 15: Full-Image Validation Runner Skeleton

**Description:** Implement the case-selection and compile-loop skeleton for full-image validation. This task records package construction, compile results, and stage-trail verification only; later tasks plug concrete source, binary, reference, equivalence, and QEMU checks into the runner.

**Dependencies:** Tasks 1, 2, 3, and 4.

**Files:**

```text
src/validation/full-image/runner.ts
src/validation/full-image/index.ts
tests/integration/validation/full-image/full-image-validation-runner.test.ts
```

**Acceptance Criteria:**

- `runFullImageValidation(request, dependencies)` accepts:
  - target key
  - scenario/mode subset or default v1 matrix
  - QEMU smoke policy
  - QEMU launch mode
  - allowed extra stage run keys
  - artifact name prefix
  - injected fixture filesystem
  - optional injected QEMU host effects
- Default request runs the v1 matrix in deterministic order.
- Each case report includes compile result context even when compilation fails.
- Successful production confidence cases must use `productionPackagePipelineDependencies()` and must not pass `packagePipelineDependencies` from test fixtures.
- Runner calls the stage trail verifier for every case.
- Runner accepts injectable arrays for source-root checks, binary checks, self-contained checks, reference checks, equivalence checks, and QEMU checks, but this task wires the default arrays as empty.
- Later tasks own the concrete default checker arrays and must not edit the compile-loop control flow except to register their checker.
- Runner never mutates fixture source files.
- Runner never writes artifacts unless an explicit output/sink dependency is passed.

**Code Examples:**

```ts
export interface FullImageValidationDependencies {
  readonly filesystem: FixtureProjectFilesystem;
  readonly compileImage?: typeof compileUefiAArch64ImageWithTrace;
  readonly qemuHostEffects?: UefiAArch64QemuHostEffects;
  readonly environment?: Record<string, string | undefined>;
}

export function runFullImageValidation(
  request: FullImageValidationRequest,
  dependencies: FullImageValidationDependencies,
): Promise<FullImageValidationReport>;
```

```ts
const report = await runFullImageValidation(
  { targetKey: "wrela-uefi-aarch64-rpi5-v1", qemuSmoke: { kind: "disabled" } },
  { filesystem: nodeFixtureProjectFilesystem },
);

expect(report.cases.map((caseReport) => caseReport.caseKey)).toEqual(
  fullImageValidationV1Cases().map(fullImageValidationCaseKey),
);
```

**Verification Commands:**

```sh
bun test tests/integration/validation/full-image/full-image-validation-runner.test.ts
```

---

## Task 16: Source-Root Authority And Target Metadata Checks

**Description:** Implement validation checks for source-root trust, source/module counts, target metadata presence, and artifact fingerprint recomputation.

**Dependencies:** Task 15.

**Files:**

```text
src/validation/full-image/source-authority.ts
tests/unit/validation/full-image/source-authority.test.ts
tests/integration/validation/full-image/full-image-validation-runner.test.ts
```

**Acceptance Criteria:**

- Every `CompilerSourceRoot.trustedForAuthority` must be `false`.
- Toolchain stdlib mode must contain exactly one toolchain root with `rootKey: "toolchain-wrela-std"` and `rootPath: "stdlib/wrela-std"`.
- Ejected stdlib mode must contain `project-wrela-std` under `src/wrela-std` and no toolchain root.
- Direct-platform mode must contain only the project root and no `wrela_std` modules.
- `sourceFileCount` and `moduleCount` are computed from `CompilerPackageInput`, not filesystem paths after package construction.
- `targetMetadata.finalImageFingerprint` must equal a fresh `fingerprintUefiAArch64ImageBytes(artifact.peCoffArtifact.bytes)` recomputation.
- Metadata is recorded as evidence but is not trusted for binary field truth.

**Code Examples:**

```ts
expect(checkFullImageSourceAuthority({ packageInput, stdlibMode: "direct-platform" })).toEqual({
  status: "passed",
  stableDetail: "source-authority:direct-platform",
});
```

```ts
expect(report.sourceRoots.every((root) => root.trustedForAuthority === false)).toBe(true);
expect(report.artifactFingerprint).toBe(fingerprintUefiAArch64ImageBytes(bytes));
```

**Verification Commands:**

```sh
bun test tests/unit/validation/full-image/source-authority.test.ts
bun test tests/integration/validation/full-image/full-image-validation-runner.test.ts
```

---

## Task 17: Binary Structure Checker

**Description:** Add byte-truth PE/COFF checks that parse the final `.efi` bytes and verify UEFI AArch64 structural invariants before any QEMU run.

**Dependencies:** Task 3.

**Files:**

```text
src/validation/full-image/binary-structure-checker.ts
tests/unit/validation/full-image/binary-structure-checker.test.ts
```

**Acceptance Criteria:**

- Checker uses `parsePeCoffImage(artifact.peCoffArtifact.bytes)`.
- The following facts are read from parsed final bytes, not artifact metadata:
  - DOS/PE signatures
  - COFF machine
  - PE32+ optional header magic
  - EFI application subsystem
  - section headers
  - data directories
  - relocation directory
  - entry RVA
  - COFF symbol table pointer/count
  - final raw section ranges
- Checks require:
  - machine is AArch64
  - subsystem is EFI application
  - symbol table pointer and count are zero
  - section names are deterministic and include executable `.text`
  - entry RVA falls inside an executable section
  - base relocations parse when relocation directory is nonzero
  - exception directory points to `.pdata` when unwind data is required
  - no trailing bytes after final raw section
- Metadata is only used for cross-checking final image fingerprint and artifact name.
- Diagnostics name whether a failure came from bytes, metadata mismatch, or linked-layout mismatch.

**Code Examples:**

```ts
export interface FullImageBinaryStructureCheckInput {
  readonly artifact: UefiAArch64ImageArtifact;
  readonly trace: CompileUefiAArch64ImageTrace;
}

export function checkFullImageBinaryStructure(
  input: FullImageBinaryStructureCheckInput,
): readonly FullImageValidationCheckReport[];
```

```ts
const parsed = parsePeCoffImage(input.artifact.peCoffArtifact.bytes);
if (parsed.kind === "error") {
  return failedCheck("binary.pe.parse", parsed.diagnostics[0]?.stableDetail ?? "parse-failed");
}
expect(parsed.value.coffHeader.pointerToSymbolTable).toBe(0);
expect(parsed.value.coffHeader.numberOfSymbols).toBe(0);
```

**Verification Commands:**

```sh
bun test tests/unit/validation/full-image/binary-structure-checker.test.ts
```

---

## Task 18: Linked-Layout Self-Contained Checker

**Description:** Add linked-layout and object-module checks proving that the emitted image is self-contained and does not depend on source roots, host objects, system linkers, or unresolved externals.

**Dependencies:** Task 3.

**Files:**

```text
src/validation/full-image/self-contained-checker.ts
tests/unit/validation/full-image/self-contained-checker.test.ts
```

**Acceptance Criteria:**

- Checker consumes `CompileUefiAArch64ImageTrace.binarySpine`, not filesystem state.
- It verifies all object modules consumed by the linker are compiler-produced:
  - source backend object
  - static CHAR16 object modules
  - runtime helper object modules
  - synthetic entry/unwind objects
- It verifies there are no unresolved external symbols in linked layout.
- It verifies compiler runtime helpers required by the UEFI target are present.
- It verifies the PE entry target is the compiler-owned UEFI entry thunk.
- It verifies the entry thunk reaches the Wrela boot function symbol from `target.entryProfile.bootFunctionSymbol`.
- It verifies no linked symbol/path refers to `stdlib/wrela-std`, `src/wrela-std`, or a host temporary path.
- It cross-checks parsed PE section byte ranges against linked layout section RVAs.

**Code Examples:**

```ts
expect(checks).toContainEqual({
  checkerKey: "self-contained.unresolved-externals",
  status: "passed",
  stableDetail: "self-contained:unresolved-externals:none",
});
```

```ts
const linkedSymbols = trace.binarySpine.linkedLayout.symbols.entries().map((symbol) => symbol.name);
expect(linkedSymbols).toContain(trace.target.entryProfile.bootFunctionSymbol);
expect(linkedSymbols.some((symbol) => symbol.includes("stdlib/wrela-std"))).toBe(false);
```

**Verification Commands:**

```sh
bun test tests/unit/validation/full-image/self-contained-checker.test.ts
```

---

## Task 19: Reference Checker Framework

**Description:** Add a typed reference-checker framework with exact checker contracts, deterministic ordering, and isolated inputs.

**Dependencies:** Tasks 1 and 3.

**Files:**

```text
src/validation/full-image/reference-checkers/index.ts
src/validation/full-image/reference-checkers/types.ts
tests/unit/validation/full-image/reference-checkers/framework.test.ts
```

**Acceptance Criteria:**

- Reference checkers have closed keys:
  - `stdlib-source-root-reference`
  - `semantic-platform-reference`
  - `proof-fact-reference`
  - `opt-ir-reference`
  - `aarch64-object-reference`
  - `linked-layout-reference`
  - `pe-coff-reference`
  - `uefi-tcb-golden-reference`
- Each checker declares allowed input fields and may not reach into filesystem or environment.
- Each checker returns deterministic `FullImageValidationCheckReport[]` with nonempty `inputAuthority`.
- Each evidence record names its authority as one of `final-bytes`, `linked-layout`, `compiler-trace`, `source-package`, or `golden`.
- A checker that cannot run because its required trace data is absent returns `skipped` only for failed compile cases; skipped reference checks in successful production cases fail the case.
- Test fakes can implement `FullImageReferenceChecker`, but production runner defaults use the real checker set.
- The framework exports `defaultFullImageReferenceCheckers()` from `index.ts`; individual checker modules do not import each other.

**Code Examples:**

```ts
export type FullImageReferenceCheckerKey =
  | "stdlib-source-root-reference"
  | "semantic-platform-reference"
  | "proof-fact-reference"
  | "opt-ir-reference"
  | "aarch64-object-reference"
  | "linked-layout-reference"
  | "pe-coff-reference"
  | "uefi-tcb-golden-reference";

export interface FullImageReferenceChecker {
  readonly checkerKey: FullImageReferenceCheckerKey;
  readonly allowedAuthorities: readonly FullImageValidationEvidenceRecord["authority"][];
  readonly run: (
    input: FullImageReferenceCheckerInput,
  ) => readonly FullImageValidationCheckReport[];
}
```

**Verification Commands:**

```sh
bun test tests/unit/validation/full-image/reference-checkers/framework.test.ts
```

---

## Task 20: Source-Root And Semantic-Platform Reference Checkers

**Description:** Implement the independent reference checks for stdlib source-root authority and semantic platform binding/certification.

**Dependencies:** Task 19.

**Files:**

```text
src/validation/full-image/reference-checkers/stdlib-source-root-reference.ts
src/validation/full-image/reference-checkers/semantic-platform-reference.ts
tests/integration/validation/full-image/reference-checkers.test.ts
```

**Acceptance Criteria:**

- `stdlib-source-root-reference` input is only `CompilerPackageInput`, case scenario/mode, and fixture spec.
- It independently recomputes expected source-root shape for each stdlib mode.
- It fails if direct-platform mode has any `wrela_std` module.
- It fails if ejected stdlib mode uses a toolchain root.
- It fails if shipped stdlib mode lacks `stdlib/wrela-std`.
- `semantic-platform-reference` input is semantic platform catalog fingerprint, reachable primitive IDs, source declaration summaries, and package input.
- It recomputes expected primitive binding by source function name and canonical primitive ID.
- It fails if PacketCounter does not reach `uefi.console.outputString` and `uefi.validation.fixturePacketSource`.
- It fails if direct-platform declares a primitive that is not in the UEFI primitive name catalog.
- `stdlib-source-root-reference` reports `inputAuthority: ["source-package"]`.
- `semantic-platform-reference` reports `inputAuthority: ["source-package", "compiler-trace"]`.

**Code Examples:**

```ts
expect(referenceChecks).toContainEqual({
  checkerKey: "semantic-platform-reference",
  status: "passed",
  stableDetail:
    "semantic-platform:reachable:uefi.console.outputString,uefi.validation.fixturePacketSource",
});
```

**Verification Commands:**

```sh
bun test tests/integration/validation/full-image/reference-checkers.test.ts
```

---

## Task 21: Proof-Fact And OptIR Reference Checkers

**Description:** Implement independent proof-fact and OptIR checks for the PacketCounter high-risk source-to-codegen path.

**Dependencies:** Task 19.

**Files:**

```text
src/validation/full-image/reference-checkers/proof-fact-reference.ts
src/validation/full-image/reference-checkers/opt-ir-reference.ts
tests/integration/validation/full-image/reference-checkers.test.ts
```

**Acceptance Criteria:**

- `proof-fact-reference` allowed inputs are checked proof result, fact packet, proof-MIR layout references, and scenario key.
- For PacketCounter, it requires evidence for:
  - fixed field layout through byte 2
  - dynamic payload boundary or payload-end fact
  - `source.len <= limits.max_frame_bytes`
  - validation success consuming source into packet
  - validation error preserving/closing source correctly
  - exit closure clean
  - platform call precondition for `output_string`
- `opt-ir-reference` allowed inputs are optimized OptIR program, operations, facts, static string table, and scenario key.
- For PacketCounter, it requires:
  - at least two packet-region memory loads
  - optional or one endian decode for packet field
  - one integer binary operation
  - one integer compare operation
  - one canonical UEFI console platform call
  - one static CHAR16 marker containing `WRELA_PACKET_COUNTER_OK`
  - no unsupported operation diagnostics
- Non-PacketCounter scenarios run a smaller smoke policy and do not claim PacketCounter coverage.
- `proof-fact-reference` reports `inputAuthority: ["compiler-trace"]`.
- `opt-ir-reference` reports `inputAuthority: ["compiler-trace"]`.

**Code Examples:**

```ts
const packetCounterOptIrRequirements = Object.freeze({
  memoryLoadMinimum: 2,
  integerBinaryMinimum: 1,
  integerCompareMinimum: 1,
  requiredPlatformCalls: ["uefi.console.outputString"],
  requiredStaticChar16Markers: ["WRELA_PACKET_COUNTER_OK\r\n"],
});
```

```ts
expect(packetCounterProofFacts).toEqual(
  expect.arrayContaining([
    expect.objectContaining({ family: "validated-buffer-layout", subject: "CounterPacket" }),
    expect.objectContaining({ family: "platform-call-precondition", subject: "output_string" }),
  ]),
);
```

**Verification Commands:**

```sh
bun test tests/integration/validation/full-image/reference-checkers.test.ts
```

---

## Task 22: Object, Linked-Layout, And PE Reference Checkers

**Description:** Implement independent reference checks for AArch64 object modules, linked layout, and final PE bytes.

**Dependencies:** Tasks 17, 18, and 19.

**Files:**

```text
src/validation/full-image/reference-checkers/aarch64-object-reference.ts
src/validation/full-image/reference-checkers/linked-layout-reference.ts
src/validation/full-image/reference-checkers/pe-coff-reference.ts
tests/integration/validation/full-image/reference-checkers.test.ts
```

**Acceptance Criteria:**

- `aarch64-object-reference` allowed inputs are backend/static/helper/entry object modules and target fingerprints.
- It verifies object modules have deterministic keys, no undefined non-whitelisted symbols, and expected relocation families.
- It verifies static CHAR16 object modules are read-only data and NUL terminated.
- `linked-layout-reference` allowed input is linked image layout and artifact section intent.
- It calls `tests/support/linker/slow-linked-image-validator.ts` from tests or a production-safe equivalent under `src/validation/full-image` if needed by runtime validation.
- It verifies section ranges, relocation targets, entry symbol, `.pdata`/`.xdata` relationships, and no unresolved externals.
- `pe-coff-reference` allowed inputs are final bytes, writer policy fingerprint, and linked layout intent.
- It parses final bytes independently and checks data directories, relocations, section raw bytes, image size, header size, entry RVA, and absence of COFF symbol table.
- `aarch64-object-reference` reports `inputAuthority: ["compiler-trace"]`.
- `linked-layout-reference` reports `inputAuthority: ["linked-layout", "compiler-trace"]`.
- `pe-coff-reference` reports `inputAuthority: ["final-bytes", "linked-layout"]`.
- `pe-coff-reference` may reuse `parsePeCoffImage` as the independent byte reader because it consumes only final bytes and does not trust artifact metadata; every metadata comparison must be an explicit evidence row, not parse authority.
- These checkers run before QEMU.

**Code Examples:**

```ts
expect(checks.map((check) => check.checkerKey)).toEqual([
  "aarch64-object-reference",
  "linked-layout-reference",
  "pe-coff-reference",
]);
```

```ts
const parsed = parsePeCoffImage(artifact.peCoffArtifact.bytes);
expect(parsed.kind).toBe("ok");
if (parsed.kind === "ok") {
  expect(parsed.value.baseRelocationBlocks.every((block) => block.pageRva % 0x1000 === 0)).toBe(
    true,
  );
}
```

**Verification Commands:**

```sh
bun test tests/integration/validation/full-image/reference-checkers.test.ts
```

---

## Task 23: UEFI TCB Golden Reference Checker

**Description:** Add a golden checker for high-risk target-owned UEFI constants and ABI/table/runtime records used by full-image validation.

**Dependencies:** Task 19.

**Files:**

```text
src/validation/full-image/reference-checkers/uefi-tcb-golden-reference.ts
tests/support/target/uefi-aarch64/full-image-tcb-golden-fixtures.ts
tests/integration/validation/full-image/reference-checkers.test.ts
```

**Acceptance Criteria:**

- `uefi-tcb-golden-reference` compares production records against manually curated golden fixtures, not against the same serializer output.
- Golden coverage includes:
  - EFI status constants used by fixtures
  - UEFI firmware table offsets used by console/watchdog/runtime helpers
  - platform primitive canonical IDs and source names
  - runtime helper linkage names
  - entry thunk linkage/ABI identity
  - target key `wrela-uefi-aarch64-rpi5-v1`
- Drift produces stable diagnostics naming the exact golden key.
- Golden fixtures are small data tables, not snapshots of whole generated artifacts.
- `uefi-tcb-golden-reference` reports `inputAuthority: ["golden", "compiler-trace"]`.

**Code Examples:**

```ts
export const FULL_IMAGE_UEFI_TCB_GOLDEN = Object.freeze({
  status: {
    success: "EFI_SUCCESS",
    badBufferSize: "EFI_BAD_BUFFER_SIZE",
  },
  platformNames: {
    output_string: "uefi.console.outputString",
    validation_fixture_packet_source: "uefi.validation.fixturePacketSource",
  },
  runtimeHelpers: {
    exitBootServicesWithFreshMap: "__wrela_uefi_exit_boot_services_with_fresh_map",
  },
});
```

**Verification Commands:**

```sh
bun test tests/integration/validation/full-image/reference-checkers.test.ts
```

---

## Task 24: Equivalence And Determinism Checker

**Description:** Compare repeated runs and cross-stdlib-mode outputs for deterministic behavior and structural equivalence.

**Dependencies:** Tasks 6, 14, 15, 16, 17, 18, 20, 21, 22, and 23.

**Files:**

```text
src/validation/full-image/determinism.ts
tests/unit/validation/full-image/determinism.test.ts
tests/integration/validation/full-image/full-image-validation-runner.test.ts
```

**Acceptance Criteria:**

- Re-running the same case produces identical:
  - artifact bytes
  - final image fingerprint
  - target metadata
  - diagnostics
  - verification run keys/statuses
  - binary check reports
  - reference check reports
  - case report ordering
- Cross-stdlib-mode comparison does not require byte identity.
- For `smoke-console` and `packet-counter`, cross-mode equivalence requires:
  - same target metadata except source-origin-sensitive fields
  - same required platform primitive IDs
  - same entry profile
  - same required marker strings
  - same binary structural check statuses
  - same reference checker statuses
- Any non-equivalence evidence is recorded in `equivalenceEvidence` with stable detail.

**Code Examples:**

```ts
export interface FullImageValidationEquivalenceEvidence {
  readonly groupKey: string;
  readonly comparedCases: readonly string[];
  readonly status: "passed" | "failed";
  readonly stableDetail: string;
}
```

```ts
expect(evidence).toContainEqual({
  groupKey: "packet-counter:stdlib-modes",
  comparedCases: [
    "packet-counter/toolchain-stdlib",
    "packet-counter/ejected-stdlib",
    "packet-counter/direct-platform",
  ],
  status: "passed",
  stableDetail: "equivalence:platform-primitives-and-binary-structure",
});
```

**Verification Commands:**

```sh
bun test tests/unit/validation/full-image/determinism.test.ts
bun test tests/integration/validation/full-image/full-image-validation-runner.test.ts
```

---

## Task 25: QEMU Smoke Integration And Firmware Diagnostics

**Description:** Integrate optional QEMU/AArch64 UEFI smoke into full-image validation using the existing nonce-qualified harness and explicit firmware diagnostics.

**Dependencies:** Task 15.

**Files:**

```text
src/validation/full-image/qemu.ts
tests/unit/validation/full-image/qemu.test.ts
tests/integration/validation/full-image/qemu-validation-smoke.test.ts
```

**Acceptance Criteria:**

- Full-image validation uses `runUefiAArch64QemuSmokeImage` or `runUefiAArch64QemuSmoke`.
- Default QEMU launch mode is UEFI Shell launch for validation cases:
  - image path `EFI/WRELA/SMOKEAA64.EFI`
  - startup script invokes `\EFI\WRELA\SMOKEAA64.EFI`
  - shell echoes nonce-qualified success/failure markers
- Default boot path `EFI/BOOT/BOOTAA64.EFI` remains supported through request option.
- QEMU expected markers include both shell marker and case-specific app marker when configured.
- QEMU runs only after binary and reference checks have completed.
- Missing QEMU or firmware env is `skipped` only when request `allowSkip` is true.
- Invalid smoke request is failure even when `allowSkip` is true.
- Firmware path diagnostics use a concrete best-effort classifier:
  - Accept basenames containing `AAVMF`, `QEMU_EFI`, `AA64`, or `AARCH64`.
  - Reject basenames containing `OVMF`, `X64`, or `IA32` unless an AArch64 token is also present.
  - Unknown basenames produce `qemu-smoke:firmware-arch-unrecognized` diagnostic but may still run when explicitly configured.
- Tests prove x86-like firmware paths are rejected deterministically.

**Code Examples:**

```ts
export type FullImageValidationQemuLaunchMode = "uefi-shell-startup" | "default-boot-path";

export function fullImageQemuSmokeRequestForCase(input: {
  readonly caseKey: string;
  readonly launchMode: FullImageValidationQemuLaunchMode;
  readonly expectedConsoleMarkers: readonly string[];
}): UefiAArch64QemuSmokeRequest {
  return {
    kind: "qemu",
    allowSkip: true,
    expectedConsoleMarkers: input.expectedConsoleMarkers,
    uefiShellSuccessMarker:
      input.launchMode === "uefi-shell-startup"
        ? { marker: "WRELA_FULL_IMAGE_SMOKE_OK", failureMarker: "WRELA_FULL_IMAGE_SMOKE_FAIL" }
        : undefined,
    termination: "kill-after-marker",
  };
}
```

```ts
expect(classifyAArch64UefiFirmwarePath("/tmp/OVMF_CODE.fd")).toEqual({
  kind: "rejected",
  stableDetail: "qemu-smoke:firmware-arch-likely-x86:OVMF_CODE.fd",
});
```

**Verification Commands:**

```sh
bun test tests/unit/validation/full-image/qemu.test.ts
bun test tests/integration/validation/full-image/qemu-validation-smoke.test.ts
```

---

## Task 26: CLI And Package Scripts

**Description:** Add a developer/CI command for running full-image validation, with QEMU disabled by default and explicit opt-in environment handling.

**Dependencies:** Tasks 15, 24, and 25.

**Files:**

```text
scripts/validate-full-image.ts
package.json
tests/integration/validation/full-image/full-image-validation-runner.test.ts
```

**Acceptance Criteria:**

- Add package script `validate:full-image`.
- CLI defaults:
  - target key `wrela-uefi-aarch64-rpi5-v1`
  - v1 matrix
  - QEMU disabled
  - deterministic text or JSON report
- CLI supports:
  - `--case packet-counter/direct-platform`
  - `--qemu`
  - `--qemu-allow-skip`
  - `--qemu-launch-mode uefi-shell-startup|default-boot-path`
  - `--json`
- CLI exits nonzero when any case has failed compile, binary, reference, equivalence, or non-skipped QEMU checks.
- CLI prints stable reproduction context:
  - case key
  - fixture path
  - artifact name
  - failed stage/check key
  - stable diagnostic detail
- Default `bun run agent:check` does not require QEMU.

**Code Examples:**

```json
{
  "scripts": {
    "validate:full-image": "bun run scripts/validate-full-image.ts"
  }
}
```

```sh
bun run validate:full-image -- --case packet-counter/direct-platform --json
bun run validate:full-image -- --qemu --qemu-allow-skip
```

**Verification Commands:**

```sh
bun run validate:full-image -- --case smoke-console/direct-platform --json
bun run validate:full-image -- --case packet-counter/direct-platform --json
```

---

## Task 27: Final Integration, Audit, And Agent Checks

**Description:** Add final integration/audit coverage and run the repository handoff checks.

**Dependencies:** All prior tasks.

**Files:**

```text
tests/audit/full-image-validation-audit.test.ts
tests/integration/validation/full-image/full-image-validation-matrix.test.ts
tests/integration/validation/full-image/full-image-validation-runner.test.ts
scripts/check-policy.ts
package.json
```

**Acceptance Criteria:**

- The full v1 matrix runs with QEMU disabled in CI/local default mode.
- `PacketCounterImage` passes in:
  - toolchain stdlib mode
  - ejected stdlib mode
  - direct-platform mode
- No production validation file imports `node:fs`, `node:child_process`, Bun APIs, or test-support modules.
- Filesystem access is limited to scripts/tests or injected fixture filesystem edges.
- No production confidence test uses `uefiAArch64PackagePipelineDependenciesForOptimizedFixture`.
- Audit test fails if any report checker key or scenario key is unrecognized.
- Audit test fails if direct-platform fixtures import `wrela_std`.
- Format and agent checks pass.

**Code Examples:**

```ts
test("production confidence path does not use injected OptIR fixture dependencies", () => {
  const validationSources = readRuntimeValidationSourcesForAudit();
  expect(validationSources.join("\n")).not.toContain(
    "uefiAArch64PackagePipelineDependenciesForOptimizedFixture",
  );
});
```

```ts
test("direct-platform fixtures do not import stdlib", () => {
  const directSources = readFixtureSources(
    "tests/fixtures/full-image-validation",
    "direct-platform",
  );
  expect(directSources.join("\n")).not.toContain("wrela_std");
});
```

**Verification Commands:**

```sh
bun test tests/unit/validation/full-image
bun test tests/integration/validation/full-image
bun test tests/audit/full-image-validation-audit.test.ts
bun run format
bun run agent:check
```

## Definition Of Done

Full image validation is complete when these commands pass and the default validation report shows every v1 case passing with QEMU disabled:

```sh
bun run validate:full-image -- --json
bun run agent:check
```

The required output confidence statement is:

```text
PacketCounterImage compiles through the real parser, semantic surface, typed HIR,
monomorphization, layout facts, proof MIR, proof check, OptIR, AArch64 lowering,
backend, linker, and PE writer into one self-contained .efi artifact in all
three stdlib modes.
```
