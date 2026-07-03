# Full Image Validation Design

## Purpose

Full image validation is the compiler acceptance phase after the UEFI AArch64
target driver. It proves that representative `uefi image` programs can travel
through the real compiler pipeline and become one self-contained `.efi`
application artifact.

The key confidence target is a `PacketCounterImage`-style program: source that
uses a UEFI image declaration, reachable project modules, stdlib wrappers,
platform primitives, validation/proof obligations, OptIR construction,
AArch64 code generation, linker layout, PE/COFF serialization, and optional
QEMU/OVMF execution. A passing result should mean the emitted `.efi` no longer
depends on source roots, the shipped stdlib tree, host files, external object
files, a C runtime, a system linker, or hidden compiler shortcuts.

This phase does not add another semantic transformation. It is a validation
layer around the completed source-to-bytes pipeline. It compiles real fixtures,
captures the compiler's structured verification summaries, runs independent
binary and reference checks, and reports whether the image is self-contained
enough to be treated as a firmware-runnable Wrela program.

## Phase Boundary

The phase boundary is:

```text
full image validation request
  + validation fixture corpus
  + selected target key
  + stdlib mode matrix
  + optional QEMU/OVMF smoke configuration
  + reference checker set
  -> construct compiler package input for each validation case
  -> compile each case through compileUefiAArch64Image
  -> require expected compiler stage verification runs
  -> inspect package and source-root authority
  -> inspect target metadata and self-contained artifact shape
  -> run binary structure checks on the emitted .efi bytes
  -> run selected independent reference checkers
  -> optionally run QEMU/OVMF smoke cases
  -> FullImageValidationReport
```

The normal compiler pipeline remains:

```text
source package
  -> frontend
  -> semantic
  -> monomorphization
  -> layout-facts
  -> proof-mir
  -> proof-check
  -> opt-ir
  -> aarch64-lowering
  -> aarch64-backend
  -> static-char16-objects
  -> runtime-helper-objects
  -> synthetic-entry-object
  -> linker
  -> pe-coff-writer
  -> UefiAArch64ImageArtifact
```

Full image validation consumes this pipeline. It does not repair missing
symbols, rewrite source, bless stdlib modules, patch PE headers, or reinterpret
compiler diagnostics. A failed lower phase remains a compiler failure. The
validation layer adds context: which fixture failed, which stdlib mode was in
use, which stage stopped, and which independent checks were still able to run.

## Relationship To Existing Phases

The target driver already proves that one package can be compiled into a UEFI
AArch64 image artifact. Full image validation widens that proof in three ways:

- It compiles multiple representative source trees instead of one synthetic
  package fixture.
- It repeats equivalent source programs across stdlib source-root modes:
  compiler-shipped sysroot, ejected project copy, and direct platform primitive
  declarations without stdlib imports.
- It compares high-risk outputs against independent readers and slow checkers
  that are not the same implementation path that produced the artifact.

Earlier phase tests are still required. Parser, semantic, proof, OptIR, backend,
linker, and PE writer unit tests catch localized errors with precise fixtures.
Full image validation catches integration drift across phase boundaries:

- parser imports must discover stdlib and project modules consistently
- semantic platform primitive certification must not depend on stdlib path
- proof facts must survive into OptIR and AArch64 lowering
- target-owned runtime helpers must be linked into the image
- the PE entry point must resolve to the compiler-owned entry thunk
- the final bytes must parse as AArch64 PE32+ EFI application bytes
- optional firmware smoke must observe the declared marker under AArch64 UEFI

The validation harness may call public production APIs and test-only reference
checkers. Production runtime source remains dependency-free. Host effects such
as filesystem fixture loading, temporary ESP creation, subprocess execution, and
QEMU discovery live in tests, scripts, or explicit host adapters.

## Production Commitments

Full image validation has one job, expressed as seven commitments:

```text
fixtures:
  compile a small but representative image corpus, including a
  PacketCounterImage-style fixture with proof and codegen pressure

stdlib:
  compile equivalent programs with stdlib/wrela-std, with an ejected
  src/wrela-std copy, and with direct platform primitive declarations

pipeline:
  require parser, semantic, proof, OptIR, AArch64, linker, PE writer, and
  target-driver stage verification to be present and passed

binary:
  inspect emitted .efi bytes for PE/COFF, section, entry, relocation, unwind,
  data-directory, and no-external-dependency invariants

smoke:
  optionally boot selected emitted images under QEMU plus AArch64 UEFI firmware
  and classify declared console markers with bounded host execution

reference:
  compare selected high-risk compiler subsystems against independent readers,
  slow validators, golden fixtures, or redundant small checkers

report:
  return deterministic validation reports that explain exactly which image,
  stdlib mode, stage, binary check, smoke run, or reference checker failed
```

## Goals

- Compile representative `uefi image` programs through the real public UEFI
  AArch64 target driver.
- Include a `PacketCounterImage`-style fixture that exercises validated-buffer
  layout, source-level proof obligations, source calls, platform calls, stdlib
  wrappers, static `CHAR16` strings, status conversion, and a normal boot
  function.
- Compile with the compiler-shipped sysroot stdlib from `stdlib/wrela-std`.
- Compile with an explicit ejected copy under `src/wrela-std`, loaded as
  ordinary untrusted project source.
- Compile an equivalent source tree with `stdlib` disabled where the project
  declares and wraps the same allowed UEFI platform primitives directly.
- Verify that all source roots in every mode have `trustedForAuthority: false`.
- Require the target-driver verification run keys for every successful
  compiler stage.
- Run the real parser, semantic, monomorphization, layout, proof MIR,
  proof-check, OptIR, AArch64 lowering, backend, linker, PE writer, and target
  artifact path for the production confidence cases.
- Preserve dependency injection for any fixture shortcuts used while the
  compiler is still growing; fakes must be explicit validation cases, not hidden
  production success paths.
- Check that the final `.efi` is self-contained: no imports, no unresolved
  external symbols, no COFF symbol table, no external relocation records, and no
  required runtime object missing from the linked image.
- Check that the PE entry RVA points to the compiler-owned UEFI entry thunk and
  that the thunk reaches the Wrela boot function by linkage name.
- Check that `.pdata` and `.xdata` are present when unwind records are required
  and that exception data-directory metadata is structurally consistent.
- Check that base relocation records are valid for every image-base-dependent
  patch and that the serialized `.reloc` directory matches linked layout
  intent.
- Run optional QEMU/OVMF smoke tests for selected fixtures when AArch64 QEMU and
  firmware paths are configured.
- Keep QEMU smoke marker based and bounded; QEMU is not the only correctness
  oracle.
- Make repeated validation of the same case deterministic in emitted bytes,
  metadata, diagnostics, verification runs, and report ordering.
- Keep the validation report compact enough for CI while preserving enough
  stable detail for a developer to reproduce one failing case locally.

## Non-Goals

- This phase does not define new source syntax or new platform primitives.
- This phase does not make the shipped stdlib privileged. The shipped stdlib,
  ejected stdlib, and direct primitive source all certify through the same
  semantic and target catalogs.
- This phase does not replace phase-local unit, fuzz, property, audit, or
  integration tests.
- This phase does not require QEMU or firmware images for default
  `agent:check` unless the repository later provides hermetic tool fixtures.
- This phase does not treat QEMU success as proof of semantic correctness.
  QEMU observes integration behavior after structural compiler checks pass.
- This phase does not use host PE tools, `llvm-readobj`, `objdump`, dumpbin, or
  EDK II tools as production authority. They may be optional development aids,
  but accepted checks must be local and deterministic.
- This phase does not embed validation reports into `.efi` images in v1.
- This phase does not require cross-stdlib-mode byte identity. Source keys,
  module names, and debug/provenance policy may differ. The required comparison
  is semantic and structural equivalence unless the image is explicitly known
  to be stripped of source-origin differences.
- This phase does not support x64 UEFI, UEFI drivers, Secure Boot signing,
  runtime drivers, firmware capsules, or post-`ExitBootServices()` runtime
  service behavior.

## Trusted Computing Base

Full image validation is partly a trust reducer: it asks independent checkers
to inspect the output of high-risk compiler code. Some data remains in the TCB:

- UEFI target-driver surface authentication and fingerprints
- UEFI table offsets, GUIDs, status constants, and primitive catalogs
- AArch64 ABI and register model records
- compiler-owned entry thunk, runtime helper, and unwind object factories
- linker relocation semantics and base relocation records
- PE/COFF writer policy and parse-back verifier
- QEMU smoke command planner and marker classifier
- validation fixture source text and expected markers

The validation harness must not increase the TCB by trusting stdlib path names,
host tool discovery, local firmware search order, or serialized metadata that
was produced by the same code under test. High-risk data must be compared
against either independent golden fixtures or checkers that compute the same
property through a materially different path.

Examples:

- A UEFI status constant test should compare production constants against a
  manually maintained golden fixture, not against `status-conversion.ts`.
- A linked layout check should recompute contribution placement and relocation
  values with a slow independent validator, not reuse the linker planner.
- A PE/COFF check should parse final bytes through a reader and compare parsed
  fields against the planned artifact, not trust the writer's header model.
- A stdlib authority check should inspect `CompilerSourceRoot` records and
  semantic platform primitive certification, not assume `stdlib/wrela-std` is
  safe because it is shipped with the compiler.

## Validation Matrix

The required v1 validation matrix is explicit rather than a full Cartesian
product. Stdlib authority and source-root equivalence are exercised by the
source-equivalence scenarios. Targeted status and boot-policy scenarios run in
the smallest mode that still covers the target-owned behavior.

Source-root modes:

```text
toolchain-stdlib:
  project source imports wrela_std modules loaded from stdlib/wrela-std

ejected-stdlib:
  project source imports wrela_std modules loaded from src/wrela-std

direct-platform:
  project source disables stdlib imports and declares allowed platform
  primitives directly where the semantic catalog permits it
```

Required v1 cases:

```text
smoke-console/toolchain-stdlib:
  minimal boot function imports wrela_std.target.uefi.console from
  stdlib/wrela-std and emits WRELA_UEFI_SMOKE_OK

smoke-console/ejected-stdlib:
  same source behavior, but wrela_std modules are loaded from src/wrela-std

smoke-console/direct-platform:
  same source behavior with no stdlib import; project source declares the
  allowed output_string platform primitive directly

packet-counter/toolchain-stdlib:
  PacketCounterImage imports stdlib wrappers from stdlib/wrela-std

packet-counter/ejected-stdlib:
  PacketCounterImage imports the ejected src/wrela-std copy

packet-counter/direct-platform:
  PacketCounterImage declares and wraps the allowed platform primitives directly

status-error/toolchain-stdlib:
  source-level error return mapped to deterministic EFI_STATUS

watchdog-or-boot-policy/toolchain-stdlib:
  watchdog disable or target-owned entry-context helper path, checked by binary
  and fake-firmware/reference tests rather than QEMU process exit
```

This gives v1 eight required cases. Additional status or watchdog cases may be
added for ejected and direct-platform modes, but they are optional expansion
coverage rather than acceptance criteria.

Scenario intent:

```text
SmokeConsoleImage:
  minimal boot function, stdlib or direct console output, static UTF-16 marker,
  Unit or success result, and no packet-processing pressure

PacketCounterImage:
  validated packet declaration, packet read, proof obligation discharge,
  counter update or count materialization, status/result conversion, and UEFI
  console output through the selected source-root mode

StatusErrorImage:
  source-level error return mapped to a deterministic EFI_STATUS

WatchdogOrBootPolicyImage:
  watchdog disable or target-owned entry-context helper path, checked by binary
  and fake-firmware/reference tests rather than QEMU process exit
```

The validation suite may start with `SmokeConsoleImage` while the compiler is
still maturing, but the phase is not complete until `PacketCounterImage` passes
in all required stdlib modes.

## Representative Image Requirements

`PacketCounterImage` should be small, but it must carry enough surface area to
catch phase-boundary regressions. The fixture should include:

- one `uefi image PacketCounterImage` declaration
- one boot function selected as the image entry source root
- one or more modules outside `image.wr` so module graph traversal is exercised
- a validated packet or packet-like source type with at least one fixed field
  and one checked payload or length-dependent access
- a proof-relevant branch that requires a layout or range fact
- a source function call so call graph closure and monomorphization are tested
- one stdlib wrapper call in stdlib modes
- one direct platform primitive declaration in direct-platform mode
- one static `utf16_static(...)` marker or equivalent target-owned CHAR16
  materialization
- one source result path that maps to `EFI_SUCCESS`
- one non-success fixture path somewhere in the suite that maps to a target
  status such as `EFI_INVALID_PARAMETER`, `EFI_BAD_BUFFER_SIZE`, or
  `EFI_NOT_FOUND`

The direct-platform source tree must be equivalent in behavior, not identical
in spelling. It may declare `platform fn output_string(...) -> UefiStatus`
directly when that declaration certifies against the same target platform
catalog as the stdlib wrapper uses.

## PacketCounterImage Fixture Contract

`PacketCounterImage` is a source fixture, not a synthetic OptIR fixture. The
implementation may adjust names to match final parser spelling, but it must
preserve the module split, contracts, markers, status paths, and validation
evidence below.

Required source tree for stdlib modes:

```text
src/
  image.wr
  packet_counter/
    packet.wr
    counter.wr
    console.wr
    fixture_source.wr
    uefi_status.wr
```

Required source tree for direct-platform mode:

```text
src/
  image.wr
  packet_counter/
    packet.wr
    counter.wr
    console.wr
    fixture_source.wr
    uefi_status.wr
```

`src/image.wr`:

```wr
use run_packet_counter from packet_counter.counter
use UefiStatus from packet_counter.uefi_status

uefi image PacketCounterImage:

fn boot() -> UefiStatus:
    run_packet_counter()
```

`src/packet_counter/packet.wr`:

```wr
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

`src/packet_counter/counter.wr`:

```wr
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

`src/packet_counter/fixture_source.wr` declares the fixture source provider:

```wr
platform fn validation_fixture_packet_source() -> ReadableBuffer
```

The `validation_fixture_packet_source()` operation is fixture-only for the
full-image validation corpus. It must be target-cataloged, lowered to
compiler-owned static read-only fixture bytes in the image, and disallowed
outside full-image validation fixtures. It is not a hidden stdlib privilege and
not a general user platform primitive.

Stdlib-mode `src/packet_counter/console.wr` should call a public stdlib console
wrapper that forwards to the same certified UEFI `output_string` primitive:

```wr
use write_console_string from wrela_std.target.uefi.console
use UefiStatus from packet_counter.uefi_status

pub fn write_packet_counter_marker(count: usize) -> UefiStatus:
    write_console_string(utf16_static("WRELA_PACKET_COUNTER_OK\r\n"))
```

Stdlib-mode `src/packet_counter/uefi_status.wr` forwards the shipped status
surface. If the language has no re-export syntax when this phase is
implemented, each stdlib-mode module may import `UefiStatus` directly from
`wrela_std.target.uefi.status`; the report must still record that authority came
from the target catalog rather than the toolchain path.

Direct-platform `src/packet_counter/console.wr` declares the platform primitive
directly:

```wr
use UefiStatus from packet_counter.uefi_status

platform fn output_string(message: Utf16Static) -> UefiStatus

pub fn write_packet_counter_marker(count: usize) -> UefiStatus:
    output_string(utf16_static("WRELA_PACKET_COUNTER_OK\r\n"))
```

Direct-platform `src/packet_counter/uefi_status.wr` declares the same status
surface used by the shipped stdlib:

```wr
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

Required fixture bytes:

```text
01 02 41 42
```

Those bytes mean `kind_byte = 1`, `counter_delta = 2`, and two opaque payload
bytes. The success path therefore writes `WRELA_PACKET_COUNTER_OK\r\n`. A
negative sibling fixture uses `01 09 41` and must return
`UefiStatus.bad_buffer_size` through the status conversion helper.

Required proof evidence:

- a `layoutFits` fact for fixed fields through byte offset `2`
- a `layoutFits` or `payloadEnd` fact for the dynamic payload end
- a range/comparison fact proving `source.len <= limits.max_frame_bytes`
- validation success edge consumes the source buffer into `CounterPacket`
- validation error edge leaves the source buffer closed and returns the status
- function exit closure has no live loans, session members, open obligations, or
  pending validation results
- platform call precondition is discharged for `output_string`

Required OptIR evidence:

- at least two packet-region `memoryLoad` operations
- one `layoutEndianDecode` when the selected field width or target rule needs
  endian normalization
- one `integerBinary` operation for counter arithmetic
- one `integerCompare` operation for the `PacketKind.count` branch
- one platform call family matching the canonical UEFI console output primitive
- no remaining validation wrapper, proof wrapper, resource wrapper, or parser
  state operation after production optimizations
- no unsupported operation family reaches AArch64 lowering

Required markers and status paths:

```text
success console marker:
  WRELA_PACKET_COUNTER_OK

negative fixture status:
  UefiStatus.bad_buffer_size -> EFI_BAD_BUFFER_SIZE
```

## Stdlib Source-Root Rules

The compiler-shipped stdlib lives at:

```text
stdlib/
  wrela-std/
    core/
    target/
      uefi/
```

The ejected copy lives under the project source root:

```text
src/
  wrela-std/
    core/
    target/
      uefi/
```

Both modes use module names under `wrela_std.*`. The package-input layer maps
the source-root path to those module names. The validation harness must verify:

- the toolchain stdlib root has kind `toolchain` and
  `trustedForAuthority: false`
- the ejected stdlib root has kind `project` and `trustedForAuthority: false`
- nested project source scanning does not duplicate ejected stdlib files through
  the parent `src` root
- equivalent source roots produce the expected module names
- direct-platform mode has only the project root and no `wrela_std.*` source
  files
- semantic platform primitive authority comes from authenticated target
  catalogs, not from `rootKey`, `rootPath`, or package naming

The validation report should record each source root and module count so
source-root mistakes are obvious without dumping every source file by default.

## Public API Shape

The validation harness can live under tests and scripts initially. If it becomes
useful as a developer command, expose a narrow API from a validation-owned
module rather than from the core target driver:

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

export interface FullImageValidationRequest {
  readonly targetKey: "wrela-uefi-aarch64-rpi5-v1";
  readonly scenarios: readonly FullImageValidationScenarioKey[];
  readonly stdlibModes: readonly FullImageValidationStdlibMode[];
  readonly qemuSmoke: "disabled" | "configured-only" | "required";
  readonly qemuLaunchMode?: "default-boot" | "uefi-shell-startup";
  readonly allowedExtraStageRunKeys?: readonly string[];
  readonly artifactNamePrefix?: string;
}

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
  readonly targetMetadata?: FullImageValidationTargetMetadataReport;
  readonly stageRuns: readonly FullImageValidationStageRun[];
  readonly binaryChecks: readonly FullImageValidationCheckRun[];
  readonly referenceChecks: readonly FullImageValidationCheckRun[];
  readonly equivalenceEvidence: readonly FullImageValidationEquivalenceEvidence[];
  readonly smoke?: FullImageValidationSmokeRun;
  readonly artifactFingerprint?: string;
  readonly artifactByteLength?: number;
  readonly compilerDiagnostics: readonly FullImageValidationCompilerDiagnostic[];
  readonly diagnostics: readonly FullImageValidationDiagnostic[];
}

export interface FullImageValidationSourceRootReport {
  readonly kind: "project" | "toolchain";
  readonly rootKey: string;
  readonly rootPath: string;
  readonly trustedForAuthority: false;
  readonly moduleCount: number;
}

export interface FullImageValidationTargetMetadataReport {
  readonly targetDriverFingerprint: string;
  readonly aarch64TargetFingerprint: string;
  readonly backendTargetFingerprint: string;
  readonly linkerTargetFingerprint: string;
  readonly peCoffWriterTargetFingerprint: string;
  readonly semanticPlatformCatalogFingerprint: string;
  readonly proofMirRuntimeCatalogFingerprint: string;
  readonly firmwareAbiFingerprint: string;
  readonly statusPolicyFingerprint: string;
  readonly watchdogPolicyFingerprint: string;
  readonly peCoffImageFingerprint: string;
  readonly finalImageFingerprint: string;
}

export interface FullImageValidationStageRun {
  readonly verifierKey: string;
  readonly runKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail?: string;
}

export interface FullImageValidationCheckRun {
  readonly checkerKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail: string;
  readonly evidenceKey?: string;
  readonly inputAuthority: "final-bytes" | "compiler-artifact" | "source-package" | "qemu-output";
}

export interface FullImageValidationSmokeRun {
  readonly launchMode: "default-boot" | "uefi-shell-startup";
  readonly status: "passed" | "failed" | "skipped";
  readonly expectedMarkers: readonly string[];
  readonly failureMarkers: readonly string[];
  readonly observedMarkers: readonly string[];
  readonly stableDetail: string;
}

export interface FullImageValidationEquivalenceEvidence {
  readonly comparisonKey: string;
  readonly leftCaseKey: string;
  readonly rightCaseKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail: string;
}

export interface FullImageValidationCompilerDiagnostic {
  readonly code: string;
  readonly ownerKey: string;
  readonly stableDetail: string;
}

export interface FullImageValidationDiagnostic {
  readonly code:
    | "FULL_IMAGE_PACKAGE_INPUT_FAILED"
    | "FULL_IMAGE_COMPILE_FAILED"
    | "FULL_IMAGE_STAGE_VERIFICATION_FAILED"
    | "FULL_IMAGE_STDLIB_MODE_FAILED"
    | "FULL_IMAGE_BINARY_STRUCTURE_FAILED"
    | "FULL_IMAGE_SELF_CONTAINED_FAILED"
    | "FULL_IMAGE_REFERENCE_CHECK_FAILED"
    | "FULL_IMAGE_QEMU_SMOKE_FAILED"
    | "FULL_IMAGE_DETERMINISM_FAILED";
  readonly caseKey: string;
  readonly checkerKey: string;
  readonly stableDetail: string;
  readonly nestedCompilerDiagnostic?: FullImageValidationCompilerDiagnostic;
}

export interface FullImageValidationReport {
  readonly schema: "wrela.full-image-validation";
  readonly schemaVersion: 1;
  readonly targetKey: "wrela-uefi-aarch64-rpi5-v1";
  readonly status: "passed" | "failed" | "skipped";
  readonly cases: readonly FullImageValidationCaseReport[];
}
```

The report should use closed status unions and stable details. Avoid open
`Record<string, unknown>` payloads in public report shapes. If a check needs
extra data, add a named optional field with a stable schema.

## Repository Shape

The validation phase should sit mostly under tests and support helpers:

```text
docs/
  design/
    full-image-validation-design.md

scripts/
  validate-full-image.ts

tests/
  fixtures/
    full-image-validation/
      smoke-console-toolchain/
      smoke-console-ejected/
      smoke-console-direct-platform/
      packet-counter-toolchain/
      packet-counter-ejected/
      packet-counter-direct-platform/
      status-error-toolchain/
      watchdog-policy-toolchain/

  integration/
    full-image-validation/
      full-image-validation.test.ts
      stdlib-mode-equivalence.test.ts
      binary-structure.test.ts
      reference-checkers.test.ts

  system/
    full-image-validation/
      qemu-ovmf-full-image.test.ts

  support/
    full-image-validation/
      validation-case.ts
      validation-report.ts
      validation-matrix.ts
      fixture-package-input.ts
      binary-structure-checker.ts
      self-contained-image-checker.ts
      reference-checkers.ts
      qemu-smoke-cases.ts
```

Existing target-driver fixture directories may remain in
`tests/fixtures/uefi-aarch64` if they are still useful. The full image
validation fixtures should become the canonical acceptance corpus once
`PacketCounterImage` exists, because this phase needs a stable matrix across
stdlib modes.

If source code outside tests is needed, keep it under a validation or command
edge such as:

```text
src/
  validation/
    full-image/
      index.ts
      report.ts
      binary-structure-checker.ts
```

Do not import test fixtures from production source. Do not import host APIs into
pure target-driver modules.

## Compiler Stage Coverage

Each successful case must include these target-driver verification run keys in
order:

```text
target-driver-authenticate
frontend
semantic
monomorphization
layout-facts
proof-mir
proof-check
opt-ir
aarch64-lowering
aarch64-backend
static-char16-objects
runtime-helper-objects
synthetic-entry-object
linker
pe-coff-writer
```

The required run keys must appear exactly once and in order. They are an
ordered subsequence of the complete verification run list, not necessarily the
only entries.

Allowed extra v1 run keys:

```text
artifact-sink:
  allowed only after pe-coff-writer, when the validation case asks the compiler
  to write through an explicit artifact sink

qemu-smoke:
  allowed only after artifact creation, when a future compile API records smoke
  as a nested verification run instead of a separate system-test report
```

Unknown extra run keys fail the case unless the validation request names them in
an explicit `allowedExtraStageRunKeys` list. That keeps stage drift visible
while allowing deliberate future expansion.

The validation harness should fail a case when:

- a required run key is absent
- a required run key appears out of order
- any required run key has `failed`
- a run key is present twice unless a future phase explicitly models retries
- an allowed extra run key appears before its required predecessor
- an unknown extra run key appears without an explicit allow-list entry
- a stage succeeds through a fixture-only fake in a production confidence case

During compiler bring-up, the suite may include separate "adapter smoke" cases
that use dependency-injected fakes. Those cases must be labeled as adapter
coverage and must not count toward the final `PacketCounterImage` production
confidence gate.

## Binary Structure Checks

Binary structure checks run on emitted `.efi` bytes plus the structured
artifact metadata. They should be local, deterministic, and independent from
the writer planner where practical.

Required PE/COFF checks:

- DOS header begins with `MZ`
- PE signature is present at the planned PE header offset
- COFF machine is AArch64 `0xaa64`
- optional header is PE32+ `0x20b`
- subsystem is EFI application `10`
- section alignment and file alignment match target policy
- image base matches target policy
- `AddressOfEntryPoint` is nonzero and lies in executable image memory
- data-directory count is the authenticated v1 count
- unsupported directories are zeroed
- import, export, resource, TLS, debug, and certificate directories are absent
  unless a later target policy explicitly enables them
- COFF symbol table pointer and symbol count are zero
- section table entries have valid names, flags, raw offsets, virtual sizes, and
  non-overlapping file ranges
- raw section data is aligned and does not run past the file end
- `SizeOfImage` and `SizeOfHeaders` match parsed section layout

Required linked-image checks:

- entry RVA matches the resolved synthetic entry thunk symbol
- Wrela boot function linkage name is resolved
- all external declarations are resolved or explicitly rejected before PE output
- `.text` contains the entry thunk and source/backend code contributions
- `.rdata` or equivalent read-only data contains static `CHAR16` marker data
- `.pdata` and `.xdata` exist and are nonempty when unwind records require them
- exception directory points at the linked unwind table
- base relocation records exist for every image-base-dependent absolute patch
- `.reloc` contents parse into the same page/block records as linked layout
- no image section has overlapping virtual ranges
- no executable section is writable unless target policy explicitly permits it

Required self-contained checks:

- no import table
- no unresolved external symbol survives into linked layout
- no COFF relocation entries survive in image sections
- no dependency on a source-root path, host temporary path, or stdlib path is
  required to load or run the `.efi`
- all compiler-owned runtime helpers referenced by code are present in linked
  symbols or rejected before writing
- all target-owned static data referenced by code is present in linked sections

The checker should report stable details such as
`binary:entry-rva:not-executable` or `self-contained:import-table-present`
instead of dumping large byte arrays.

## Binary Check Trust Rules

Binary and self-contained checks must record where every fact came from. The
same value may appear in metadata and final bytes, but final bytes win for file
format claims.

| Field family                                                                       | Accepted authority                           | Metadata role                                                    |
| ---------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------------- |
| DOS header, PE signature, COFF header, optional header                             | parse final `.efi` bytes                     | not trusted                                                      |
| section names, raw offsets, virtual addresses, flags, sizes                        | parse final `.efi` bytes                     | comparison target only                                           |
| data directories, import/export absence, exception directory, relocation directory | parse final `.efi` bytes                     | comparison target only                                           |
| `.reloc` block contents                                                            | parse final `.efi` bytes                     | comparison target only                                           |
| `.pdata`/`.xdata` presence and byte ranges                                         | parse final `.efi` bytes                     | comparison target only                                           |
| entry RVA executable membership                                                    | parsed final bytes plus parsed section flags | artifact entry metadata is only the intended value               |
| entry thunk and boot function symbol identity                                      | linked layout artifact                       | must be cross-checked against parsed entry RVA and section bytes |
| unresolved external symbols                                                        | linked layout artifact                       | final bytes cannot prove symbol intent after stripping           |
| target policy constants                                                            | authenticated target surface                 | metadata records which target was selected                       |
| source roots and module counts                                                     | constructed package input                    | not derived from artifact metadata                               |
| final image fingerprint                                                            | recompute over final bytes                   | metadata value is accepted only if it matches recomputation      |

Artifact metadata is explicitly untrusted for PE field truth. It may tell the
checker what the compiler intended, which target fingerprints were selected,
and which linked symbol should be the entry. A passing binary check requires
the parsed final bytes to match those intentions.

## QEMU/OVMF Smoke Validation

QEMU/OVMF smoke is optional in default developer checks and required only for an
explicit smoke command or CI environment that provides hermetic firmware/tool
paths.

The smoke runner uses the target driver's existing QEMU plan and host adapter
rules:

```text
WRELA_QEMU_AARCH64
WRELA_QEMU_AARCH64_EFI_CODE
WRELA_QEMU_AARCH64_EFI_VARS_TEMPLATE
```

For AArch64, the firmware should be an ArmVirtPkg/AAVMF style UEFI image. The
validation report may use the conventional `OVMF` label because repository
tests already use that term. Firmware architecture validation is best effort in
v1: if an optional host-side firmware inspector reads the configured firmware
and parses an obvious x86 or x64 PE/COFF firmware image, required smoke should
fail with `qemu-smoke:firmware-architecture-mismatch`. If the file cannot be
identified locally, the harness reports the configured path and lets QEMU be the
smoke authority. Path names alone are not enough to reject firmware.

The current QEMU planner supports two launch modes.

Default boot mode:

```text
write emitted artifact to EFI/BOOT/BOOTAA64.EFI in a temporary ESP
run qemu-system-aarch64 with bounded timeout
capture serial output
observe every expected marker
terminate QEMU through harness-owned cleanup
delete temporary files unless debug preservation was requested
```

UEFI shell startup mode:

```text
write emitted artifact to EFI/WRELA/SMOKEAA64.EFI in a temporary ESP
write startup.nsh:
  FS0:
  \EFI\WRELA\SMOKEAA64.EFI
  if %lasterror% == 0 then
    echo <success-marker>.<nonce>
  else
    echo <failure-marker>.<nonce> %lasterror%
  endif
run qemu-system-aarch64 with bounded timeout
capture serial output
classify both program markers and shell success/failure markers
terminate QEMU through harness-owned cleanup
delete temporary files unless debug preservation was requested
```

The shell nonce is derived from the temporary directory name and sanitized to
`[A-Za-z0-9_.:-]+`. User-provided shell marker bases must also match that safe
alphabet. The report records the planned expected markers and failure markers
after nonce expansion. This prevents a stale firmware log, a previous run, or an
image that merely prints the base marker from satisfying shell-launch success.

Expected v1 program markers:

```text
WRELA_UEFI_SMOKE_OK
WRELA_PACKET_COUNTER_OK
```

Expected v1 shell marker bases:

```text
WRELA_UEFI_SHELL_START_OK
WRELA_UEFI_SHELL_START_FAIL
```

The classifier fails the smoke run when any failure marker is observed, when any
expected marker is missing, when the run times out, when cleanup fails, or when
`kill-after-marker` was requested but the process was not terminated by the
harness.

The smoke harness must not infer source-level return status from the host QEMU
process exit code. Returning from a UEFI application returns to firmware, not to
the host shell. Status conversion is checked structurally and through fake
firmware/reference tests.

## Reference Checkers

Reference checkers are deliberately small and redundant. They do not need to be
fast, but they must be clear enough to trust during failures.

Required v1 checker set:

```text
stdlib-source-root-reference:
  independently inspect source roots and module names for each stdlib mode

semantic-platform-reference:
  compare reachable primitive declarations against canonical target primitive
  IDs and reject path-based authority

proof-fact-reference:
  inspect accepted fact packets for required validated-buffer, layout, platform,
  and exit-closure facts used by PacketCounterImage

opt-ir-reference:
  inspect OptIR for expected platform/runtime call families, static string
  materialization, and absence of unsupported operation families

aarch64-object-reference:
  run object verifier and selected byte-pattern checks for entry/runtime helper
  linkage, relocation targets, call boundaries, and unwind records

linked-layout-reference:
  run a slow linked-image validator that recomputes contribution placement,
  symbol RVAs, relocation values, base relocation records, and entry RVA

pe-coff-reference:
  parse final bytes and compare headers, section table, data directories,
  relocations, and entry RVA against the artifact contract

uefi-tcb-golden-reference:
  compare status constants, GUIDs, table offsets, table widths, and primitive
  signatures against manually maintained golden fixtures
```

Each checker has a closed input contract:

| Checker                        | Allowed inputs                                                                                    | Required output                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `stdlib-source-root-reference` | `CompilerPackageInput` only                                                                       | source-root reports, module counts, duplicate/nested-root diagnostics                                         |
| `semantic-platform-reference`  | semantic platform catalog fingerprint, reachable primitive IDs, source declaration summaries      | canonical primitive ID matches, stale/missing primitive diagnostics                                           |
| `proof-fact-reference`         | checked proof result, fact packet, proof MIR layout references                                    | required fact-family presence, expected source-to-fact lineage, missing fact diagnostics                      |
| `opt-ir-reference`             | optimized OptIR program, operations, facts, static string table                                   | required operation-family evidence, forbidden operation-family diagnostics, static marker evidence            |
| `aarch64-object-reference`     | backend object modules, static CHAR16 object modules, runtime helper objects, entry object module | object verifier summaries, expected symbol/relocation/unwind records, byte-pattern diagnostics                |
| `linked-layout-reference`      | linked image layout only                                                                          | slow recomputation summary for section placement, symbol RVAs, relocation values, base relocations, entry RVA |
| `pe-coff-reference`            | final `.efi` bytes, writer target policy, linked layout intent                                    | parsed header/section/directory/relocation evidence and byte-vs-intent diagnostics                            |
| `uefi-tcb-golden-reference`    | production UEFI TCB records plus manually maintained golden records                               | per-record equality evidence and stale/missing/extra golden diagnostics                                       |

Checker outputs must use:

```ts
export interface FullImageReferenceCheckResult {
  readonly checkerKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail: string;
  readonly evidence: readonly FullImageReferenceEvidence[];
  readonly diagnostics: readonly FullImageValidationDiagnostic[];
}

export interface FullImageReferenceEvidence {
  readonly evidenceKey: string;
  readonly inputAuthority:
    | "source-package"
    | "semantic-artifact"
    | "proof-artifact"
    | "opt-ir-artifact"
    | "object-artifact"
    | "linked-layout"
    | "final-bytes"
    | "golden-fixture";
  readonly stableSummary: string;
}
```

No checker may read source files, environment variables, host paths, QEMU
output, or production global state unless those values are part of its allowed
input contract. When a checker needs data from an earlier checker, the validation
driver passes the original artifact to both checkers rather than chaining
checker outputs as authority.

Reference checkers should not depend on each other. A binary parse failure
should not prevent the report from saying whether stage verification and source
root checks passed. The top-level status fails if any required checker fails.

## High-Risk Subsystems

The first full-image validation gate should explicitly track these high-risk
subsystems:

| Subsystem                        | Risk                                               | Reference evidence                              |
| -------------------------------- | -------------------------------------------------- | ----------------------------------------------- |
| stdlib authority                 | shipped stdlib accidentally gains private power    | source-root and semantic primitive checker      |
| platform primitive certification | direct declarations bypass catalog policy          | canonical primitive ID comparison               |
| validated-buffer proof           | packet reads lower without required facts          | proof fact packet checker                       |
| status conversion                | source errors map to wrong EFI status              | golden status fixture and binary helper check   |
| firmware table offsets           | platform call loads wrong function pointer         | golden table fixture and lowering payload check |
| static CHAR16 strings            | marker encoding or NUL termination is wrong        | independent UTF-16 reader over `.rdata`         |
| entry thunk                      | PE entry fails UEFI handoff or return-address rule | entry object verifier and byte/linkage checks   |
| unwind metadata                  | image lacks valid `.pdata`/`.xdata`                | linked layout and PE directory checks           |
| relocations                      | absolute addresses lack base relocations           | slow linked-layout and PE `.reloc` parsers      |
| PE headers                       | firmware loader rejects image                      | PE reference parser plus optional QEMU smoke    |

The table is part of the acceptance contract. Adding a new high-risk subsystem
to `PacketCounterImage` should add a reference evidence row or an explicit
reason the existing evidence covers it.

## Equivalence Rules Across Stdlib Modes

For `smoke-console` and `packet-counter`, the three stdlib modes do not need
identical source keys. They must agree on observable target behavior and
selected compiler contracts:

- compile result is `ok`
- required stage run keys all pass
- target key and target-driver fingerprint match
- semantic platform primitive IDs for shared behavior match
- proof/runtime catalog fingerprints match
- expected console marker strings match after decoding
- PE machine, subsystem, entry section, data directories, and self-contained
  checks match
- QEMU smoke markers match when smoke is enabled

The following may differ:

- package key
- source root records
- source file keys
- source-origin IDs
- function or module names for direct-platform wrappers
- final image bytes if origin-dependent debug/provenance bytes are emitted

For stripped v1 images, byte equality across toolchain and ejected stdlib modes
is a useful optional check. It should be reported as an additional comparison,
not the main pass/fail criterion, unless the compiler explicitly guarantees
that source origins never reach emitted bytes.

## Determinism

Every validation case should compile at least twice in-process and compare:

- emitted `.efi` bytes for the same case
- target metadata
- verification run keys and statuses
- diagnostics
- binary structure check results
- reference checker results
- report ordering

Cross-process determinism may be a follow-up CI mode. The v1 in-process check
is enough to catch accidental object key ordering, source-root traversal order,
section ordering, relocation ordering, and nondeterministic metadata.

QEMU smoke output is not byte deterministic. Smoke determinism is limited to
the classification result, expected marker set, timeout policy, and stable
diagnostic details.

## Diagnostics And Reporting

Diagnostics should be validation-owned at the top level and should preserve
nested compiler diagnostics without changing their stable details.

Suggested diagnostic families:

```text
FULL_IMAGE_PACKAGE_INPUT_FAILED
FULL_IMAGE_COMPILE_FAILED
FULL_IMAGE_STAGE_VERIFICATION_FAILED
FULL_IMAGE_STDLIB_MODE_FAILED
FULL_IMAGE_BINARY_STRUCTURE_FAILED
FULL_IMAGE_SELF_CONTAINED_FAILED
FULL_IMAGE_REFERENCE_CHECK_FAILED
FULL_IMAGE_QEMU_SMOKE_FAILED
FULL_IMAGE_DETERMINISM_FAILED
```

Each diagnostic should include:

- case key
- scenario key
- stdlib mode
- checker or stage key
- stable detail
- optional nested compiler diagnostic code

The human report should lead with the first failing case and a compact summary:

```text
full-image-validation: failed
cases: 7 passed, 1 failed
smoke: 2 skipped
first failure:
  case: packet-counter/direct-platform
  checker: semantic-platform-reference
  detail: primitive-id-mismatch:output_string
```

The machine report should be deterministic JSON with closed unions. It may be
snapshotted in tests.

## Error Handling

Full image validation is fail-closed:

- package-input construction failure stops that case before compile
- compile failure skips binary, self-contained, and QEMU checks for that case
- binary parse failure skips checks that require parsed PE data but still
  reports raw-byte checks that can run
- missing QEMU configuration skips smoke only when the request says
  `configured-only`
- missing QEMU configuration fails smoke when the request says `required`
- reference checker exceptions are converted to deterministic validation
  diagnostics with `checker:exception` stable details

The harness should continue running independent cases after one case fails so a
developer can see whether a failure is isolated to one stdlib mode or systemic
across the matrix.

## Import And Host Boundaries

Pure validation checkers that operate on structured artifacts and bytes should
avoid host APIs. Host effects belong to:

- fixture loading
- explicit artifact sinks
- temporary ESP directory creation
- QEMU subprocess execution
- optional report writing from `scripts/validate-full-image.ts`

Audit tests should enforce:

- production target-driver pure modules do not import full-image validation
  helpers
- full-image validation support may import compiler public APIs and test
  support, but production compiler phases do not import test fixtures
- QEMU host adapters remain separate from pure QEMU command planning
- source-root fixture readers are injected instead of using implicit global
  filesystem access inside compiler runtime modules

## Testing Strategy

Unit tests:

- validation matrix generation produces every required scenario/mode pair
- validation report sorting is deterministic
- required stage run checker rejects missing, duplicate, failed, or out-of-order
  run keys
- self-contained checker rejects imports, unresolved externals, surviving COFF
  relocations, and missing runtime helpers
- binary structure checker rejects malformed PE signatures, wrong machine,
  wrong subsystem, overlapping sections, wrong entry RVA, missing `.reloc`, and
  missing unwind directories
- stdlib source-root checker distinguishes toolchain, ejected, and direct
  platform modes without trusting any root
- reference checker exceptions become stable diagnostics
- QEMU smoke policy classifies disabled, configured-only skipped, required
  missing-tools failure, marker success, missing marker, timeout, and cleanup
  failure

Integration tests:

- compile `SmokeConsoleImage` with `stdlib/wrela-std`
- compile `SmokeConsoleImage` with ejected `src/wrela-std`
- compile `SmokeConsoleImage` with direct platform primitives and no stdlib
- compile `PacketCounterImage` with all three stdlib modes
- compile `StatusErrorImage` and verify status conversion evidence
- run parser through OptIR stage coverage checks on the production confidence
  cases
- run AArch64 lowering/backend/linker/PE writer stage coverage checks on the
  production confidence cases
- run binary structure checks on every emitted `.efi`
- run selected reference checkers on every `PacketCounterImage` artifact
- compare equivalence contracts across stdlib modes
- compile the same case twice and compare deterministic outputs

System tests:

- run QEMU/OVMF smoke for `SmokeConsoleImage` when configured
- run QEMU/OVMF smoke for `PacketCounterImage` when configured
- verify skipped smoke reports explain the required environment variables
- verify required smoke fails cleanly when tools are missing

Audit tests:

- shipped stdlib modules have no hidden compiler authority
- ejected stdlib modules are not scanned twice
- direct-platform fixtures do not import `wrela_std.*`
- validation checkers do not compare production UEFI TCB data to itself
- no full-image validation helper becomes a dependency of frontend, semantic,
  proof, OptIR, backend, linker, PE writer, or target-driver pure modules
- no required confidence case uses dependency-injected fake pipeline stages

## Build Waves

### Wave 1: Validation Model And Matrix

Add validation case, report, diagnostic, and matrix helpers. Implement the stage
run checker and deterministic report ordering. Add unit tests that exercise
success, missing stage, duplicate stage, failed stage, and skipped smoke cases.

### Wave 2: Source Fixture Corpus

Create the full-image fixture tree for smoke console, packet counter, status
error, and watchdog or boot-policy coverage. Add toolchain stdlib, ejected
stdlib, and direct-platform variants for the source-equivalence scenarios; add
targeted toolchain variants for status and watchdog coverage. Keep source text
small and reviewable.

### Wave 3: Real Pipeline Integration

Compile the fixture corpus through `compileUefiAArch64Image`. Production
confidence cases must use real compiler stages. Temporary adapter cases may
exist, but they must not satisfy the final acceptance gate.

### Wave 4: Binary And Self-Contained Checks

Implement the binary structure checker, self-contained image checker, and PE
parser comparisons. Reuse existing parser/verifier APIs where they are already
independent enough, and add small redundant readers for high-risk fields when
needed.

### Wave 5A: Source And Catalog Reference Checkers

Wire the stdlib authority checker, semantic primitive checker, and UEFI TCB
golden comparisons into the validation report. This wave establishes the
source-root and catalog trust boundary before deeper compiler artifacts are
interpreted.

### Wave 5B: Proof And OptIR Reference Checkers

Wire the proof fact checker and OptIR checker. These checkers should use the
exact expected fact families and operation families from the
`PacketCounterImage` fixture contract.

### Wave 5C: Object, Linked Layout, And PE Reference Checkers

Wire the AArch64 object checker, slow linked-image validator, and PE/COFF byte
parser checks. Keep these independent: object evidence comes from object
modules, linked-layout evidence comes from the linked layout, and PE evidence
comes from parsing final bytes.

### Wave 6: QEMU/OVMF Smoke Command

Add or extend a command such as:

```text
bun run smoke:uefi-aarch64
```

or:

```text
bun run validate:full-image -- --smoke=configured-only
```

The command should compile selected cases, write temporary ESP directories, run
QEMU through the host adapter, classify markers, and preserve artifacts only
when requested.

### Wave 7: CI And Agent Check Policy

Add non-QEMU full image validation to default checks once it is fast and
deterministic. Keep QEMU smoke behind an explicit command until firmware/tool
fixtures are hermetic. Update `bun run agent:check` only for the non-host,
non-QEMU validation gate.

## Acceptance Criteria

The phase is complete when:

- the eight required v1 matrix cases exist and run:
  `smoke-console/{toolchain-stdlib,ejected-stdlib,direct-platform}`,
  `packet-counter/{toolchain-stdlib,ejected-stdlib,direct-platform}`,
  `status-error/toolchain-stdlib`, and
  `watchdog-or-boot-policy/toolchain-stdlib`
- `SmokeConsoleImage` compiles successfully in all three source-root modes
- `PacketCounterImage` compiles successfully with `stdlib/wrela-std`
- `PacketCounterImage` compiles successfully with an ejected `src/wrela-std`
  copy
- `PacketCounterImage` compiles successfully with direct platform primitive
  declarations and no stdlib import
- `StatusErrorImage` compiles successfully in toolchain-stdlib mode and returns
  the expected non-success status evidence
- `WatchdogOrBootPolicyImage` compiles successfully in toolchain-stdlib mode and
  produces the expected helper/reference evidence
- every production confidence case includes all required compiler stage run keys
  and all are passed
- every production confidence case emits a `.efi` artifact
- every emitted `.efi` passes binary structure and self-contained checks
- high-risk subsystem checks pass for stdlib authority, platform primitive
  certification, proof facts, OptIR operation shape, entry thunk, unwind,
  relocations, PE headers, firmware table constants, static strings, and status
  conversion
- repeated compiles of the same case produce deterministic bytes and reports
- optional QEMU/OVMF smoke passes for configured environments or reports a
  deterministic skip when smoke is not required
- the validation report can be read by a developer without opening every
  artifact and can be snapshotted without nondeterministic fields

The concrete output is confidence that a `PacketCounterImage`-style source tree
compiles into one self-contained `.efi` through the real compiler pipeline.

## Future Work

- Add more image scenarios for allocation/free, memory-map retrieval,
  `ExitBootServices`, protocol lookup, and runtime-service rejection after
  boot-services exit.
- Add a hermetic AArch64 firmware fixture so QEMU smoke can become a default CI
  gate.
- Add optional external-tool comparison reports for developers with
  `llvm-readobj` or EDK II tools installed, keeping local deterministic checkers
  as the accepted authority.
- Add cross-process and cross-platform determinism checks for emitted bytes.
- Add signed image validation if a future Secure Boot phase introduces
  certificate directories or Authenticode signing.
- Add debug/provenance section checks if the compiler later embeds source
  provenance into `.efi` artifacts.

## Design Defaults

- Full image validation is an acceptance harness, not a new transformation.
- Stdlib source is ordinary source in every mode.
- Direct platform declarations are allowed only when semantic and target
  catalogs certify them.
- Repeated same-case bytes must be deterministic.
- Cross-mode behavior must be equivalent, but cross-mode bytes are compared only
  when source-origin policy makes that meaningful.
- Binary checks and reference checkers are required before QEMU smoke can be
  treated as confidence.
- QEMU smoke is marker based, bounded, and optional unless explicitly required.
- The report uses closed unions, stable details, and deterministic ordering.
