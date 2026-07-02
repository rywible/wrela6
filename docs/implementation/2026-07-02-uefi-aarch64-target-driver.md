# UEFI AArch64 Target Driver Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the UEFI AArch64 target driver described in `docs/design/uefi-aarch64-target-driver-design.md`, producing a deterministic `.efi` application image for `wrela-uefi-aarch64-rpi5-v1` and an opt-in QEMU/AAVMF smoke path.

**Architecture:** Add a target-owned `src/target/uefi-aarch64` orchestration module that authenticates the selected AArch64, semantic platform, runtime, linker, and PE writer contracts before byte generation. Keep pure target data and planning dependency-free, materialize the compiler-owned framed UEFI entry thunk and compiler-runtime helpers as ordinary verified AArch64 object modules, wire firmware platform calls into AArch64 lowering, then drive an explicit package-to-PE pipeline. Host effects stay behind artifact-sink and QEMU-runner interfaces with fake implementations in tests.

**Tech Stack:** TypeScript, Bun test runner, existing Wrela compiler phase APIs, existing AArch64 backend/linker/PE writer APIs, `fast-check` for tests only, dependency injection for fakes, no new production dependencies.

---

## Research Notes

- Design source: `docs/design/uefi-aarch64-target-driver-design.md`.
- UEFI 2.11 Boot Manager requires firmware to arm a five-minute watchdog before `StartImage()` after successful `LoadImage()`, which is why the production target default disables it before source boot code runs: <https://uefi.org/specs/UEFI/2.11/03_Boot_Manager.html>.
- UEFI 2.11 Boot Services defines `SetWatchdogTimer`, `GetMemoryMap`, and `ExitBootServices`; `ExitBootServices()` must use the current memory-map key and retry with a fresh map on `EFI_INVALID_PARAMETER`: <https://uefi.org/specs/UEFI/2.11/07_Services_Boot_Services.html>.
- AAPCS64 assigns integer parameters/results to `r0`-`r7`, permits the linker to use `r16`/`r17` as IP scratch registers, and leaves `r18` platform-specific, so this target driver must consume the authenticated backend register model rather than defining another register catalog: <https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst>.
- QEMU smoke is an integration sanity check, not a correctness oracle; the target driver verifies PE/linker/status/table data structurally before optional firmware execution: <https://qemu.readthedocs.io/en/v10.0.3/system/introduction.html>.
- AArch64 QEMU firmware smoke should use the EDK II ArmVirtPkg/AAVMF family for `-machine virt` rather than x86 OVMF binaries: <https://www.tianocore.org/tianocore-wiki.github.io/platforms-packages/core-packages/arm_virt_pkg.html>.

## Existing Repo Grounding

- `src/pe-coff` already exposes `writeAArch64PeCoffEfiImage` and authenticates a PE32+ EFI application writer target.
- `src/linker/aarch64/aarch64-entry-objects.ts` already has a synthetic entry object provider, but its current factory shape only models a generic boot branch. This plan narrows it to a UEFI framed entry thunk supplied by the target driver.
- `src/target/aarch64/lower/uefi-image-lowering.ts` already records `wrela.image.entry_shim`, `wrela.image.boot`, `uefi.imageHandle`, and `uefi.systemTable` context bindings. The target driver must become the authority for those names and locations.
- `src/runtime/runtime-catalog-types.ts` already defines `ProofMirRuntimeCatalog` and `ProofMirRuntimeOperation`; this phase must key runtime materialization by those records instead of creating a parallel runtime catalog.
- `src/semantic/surface/platform-surface.ts` already defines `SemanticTargetSurface` and `PlatformPrimitiveSpec`; this phase must key firmware primitive lowering by those records instead of making a second platform catalog.

## Implementation Findings

- The repository currently has real frontend parsing, OptIR fixtures, AArch64 lowering/backend, linker, and PE writer APIs, but it does not yet expose a production adapter chain from parsed source through typed HIR, monomorphization, layout facts, proof MIR, proof checking, and optimized OptIR. The UEFI target driver therefore implements Task 12B as explicit dependency-injected stages: tests and higher-level orchestration can exercise the real OptIR-to-PE binary spine with injected fixture stages, while production defaults parse frontend input and then fail closed with stable diagnostics at the first unwired compiler bridge. This preserves the target-driver contracts without inventing fake semantic or OptIR generation.
- A fresh implementation review found that firmware platform calls must bind the UEFI image handle and system table through the boot entry ABI context, not by synthesizing ordinary undefined virtual registers. The AArch64 lowering now maps authenticated hidden firmware arguments to ABI-defined synthetic registers whose stable keys match the entry context (`uefi.imageHandle`, `uefi.systemTable`), and function-entry copy resolution/verifier logic recognizes those as public-entry ABI values.
- The same review found that the real smoke script must not try to compile the source fixture with production defaults, because the source-to-OptIR bridge is intentionally absent. Task 15 is therefore implemented as a true post-compile smoke command: QEMU config still comes from explicit QEMU/AAVMF environment variables, while the CLI consumes an explicit prebuilt EFI image at `WRELA_UEFI_AARCH64_SMOKE_EFI` and feeds only those bytes to the QEMU harness.
- Final review hardening found three target-surface gaps. The runtime catalog fingerprint is now derived from selected catalog content and authenticated; `uefi.boot.exitBootServices` is cataloged as the fresh-map compiler-runtime helper that is actually emitted; and source boot results use a concrete target-owned status-code ABI where no-value image-entry returns explicitly produce source success before the status helper maps through the closed EFI status table.
- Independent signoff review also found two entry-object hardening issues. The entry-initialize-context helper now saves and restores `x30` around its nested firmware call on every return path, and the UEFI entry thunk encoder now uses the injected backend target's encoding catalog and register model instead of global RPi5 backend catalogs.
- Final smoke-report review found an auditability gap: artifact-backed QEMU smoke reports and compile-time smoke placeholders now include the authenticated target-driver fingerprint. Prebuilt-image smoke remains metadata-free because it intentionally consumes raw bytes without a target-driver artifact.
- Final target-authentication review found that shape-only firmware tables and metadata-only firmware ABI fingerprints were too weak. Firmware table validation now pins the exact canonical TCB offset/value/availability records, and the firmware ABI surface is bound to the authenticated AArch64 ABI fingerprint and backend register-model fingerprint for this v1 target.
- The real-QEMU signoff review found that hidden UEFI context virtual registers must be function-scoped, not materializer-instance scoped; multiple firmware calls in one image entry now reuse the same `uefi.systemTable`/`uefi.imageHandle` synthetic registers.
- The same signoff review found that `uefiShellSuccessMarker` must imply the expected console marker. QEMU planning and classification now derive the marker from that field, while explicit `expectedConsoleMarkers` remain additional required markers.
- A later signoff review found that the boot contract validator was not enforced on the injected OptIR binary-spine path. `runUefiAArch64BinarySpine` now rejects source-visible image-entry parameters before AArch64 lowering.
- That review also found the canonical semantic platform primitive signatures were placeholder `void` signatures. The canonical UEFI semantic target now carries target-owned signature shapes for the v1 platform primitives, including `outputString(Utf16Static) -> Status`.
- The stdlib source-root tests now prove parse-time import resolution: toolchain and ejected stdlib roots map modules under the `wrela_std` prefix, package parsing discovers `use ... from wrela_std...`, and missing package-local imports fail closed.
- A subsequent independent review found that firmware result rules were adapted but not enforced, runtime-services table calls could use an uninitialized base, and binary-spine failures dropped their stage trail. AArch64 firmware lowering now enforces result-rule arity before copying ABI return values, the UEFI adapter loads `SystemTable.RuntimeServices` for runtime-service calls, and binary-spine failed verification records include the passed/failed stage trail.
- Final signoff hardening found that static `CHAR16` source arguments must be certified data, not arbitrary source registers, and that local smoke skips must not hide invalid smoke requests. Console output lowering now fails closed unless a static `CHAR16` pointer record is provided for the OptIR value and materializes that symbol address into the firmware call; QEMU `allowSkip` only downgrades missing config/tool cases; and semantic platform catalog fingerprints sort primitive entries before hashing.
- Final review hardening also cross-checks compiler-runtime platform lowerings against authenticated runtime materializations, makes the entry thunk factory honor the linker-provided boot linkage name, and wires firmware string materialization into console lowering through a required image-readonly NUL-terminated static `CHAR16` pointer contract. Concrete static `CHAR16` pointer lowering now materializes symbol-address relocations rather than call-site string buffers.
- The real-QEMU follow-up review found the static `CHAR16` contract stopped at lowering. Optimized OptIR artifacts now carry certified static string data plus value-to-pointer records, the binary spine materializes those strings as verified read-only AArch64 object modules, and the AArch64 object path declares external data symbols and pairs PAGE/PAGEOFF relocations before object verification.
- The QEMU smoke classifier was hardened so an EFI app cannot pass by printing the same marker that the shell uses. Real QEMU smoke now relies on a nonce-qualified UEFI Shell `start` success marker for the unit-success image, can require extra app markers when configured, observes shell failure markers first, and keeps invalid smoke requests as failures even with local skip enabled.
- Target-driver authentication now pins the selected AArch64 target, backend target, linker target, and PE/COFF writer fingerprints at the authentication boundary, so stale component surfaces are rejected before orchestration.
- Runtime helper materialization was split into object assembly and instruction-encoding modules, keeping both files below the maintainability threshold while preserving the emitted helper bytes and pure target-driver audit coverage.
- Fresh final review found that runtime helper objects could still be emitted after their runtime materialization records were removed. Runtime materialization authentication now requires the full canonical v1 materialization set and rejects canonical runtime IDs whose linkage, convention, or materialization kind drift from the selected target-owned record.
- Final QEMU harness review found that the standalone smoke CLI treated missing required environment as success even though its request is fail-closed, and that a TERM-ignoring child could hold the harness promise open. The CLI now exits nonzero for missing QEMU/firmware/artifact configuration, and the host runner escalates harness termination from `SIGTERM` to a bounded `SIGKILL` fallback.
- Final compile-verification review found that `compileUefiAArch64Image` still collapsed successful and failed lower orchestration into coarse `package-pipeline`/`binary-spine` runs. The public compile verification summary now promotes the explicit inner stage trail (`frontend` through `opt-ir`, then `aarch64-lowering` through `pe-coff-writer`) and preserves all passed stages plus the failed stage when either lower adapter fails.

## Parallelization Map

Use this dependency map when dispatching subagents. A task can be picked up once all named dependencies have landed and its tests pass locally.

```text
Task 1
  creates target-driver diagnostics, results, metadata, and public barrel

Task 3 depends on Task 1
  owns status constants, conversion policy, and independent TCB golden fixtures

Task 4 depends on Task 1
  owns firmware ABI and firmware table TCB data

Task 5 depends on Tasks 1, 3, 4
  owns platform primitive lowering payload authentication

Task 6 depends on Tasks 1, 3
  owns runtime materialization authentication and runtime catalog extension points

Task 7 depends on Tasks 1, 3, 4
  owns source boot entry contract and hidden UEFI image context policy

Task 2 depends on Tasks 1, 3, 4, 5, 6, 7
  composes the target-driver surface validators and fingerprints the full bundle

Task 8 depends on Tasks 1, 2, 3, 4, 6, 7
  owns the framed compiler UEFI entry thunk planner and object provider

Task 9 depends on Tasks 3, 4, 6, 8
  owns watchdog, entry-context initialization, and emitted helper object behavior

Task 10 depends on Tasks 3, 4, 5, 6
  owns firmware string materialization

Task 11 depends on Tasks 3, 4, 5, 6, 9
  owns GetMemoryMap/ExitBootServices helper policy and emitted helper behavior

Task 11A depends on Tasks 4, 5, 7, 10, 11
  owns firmware platform-call lowering integration in AArch64 machine lowering

Task 12A depends on Tasks 1, 7
  owns CompilerPackageInput, CompilerSourceRoot, and package/source-root fakes

Task 12B depends on Tasks 12A, 3, 4, 5, 6, 7
  owns explicit frontend-to-OptIR package pipeline adapters

Task 12C depends on Tasks 8, 9, 10, 11, 11A, 12B
  owns OptIR-to-PE binary spine composition through existing AArch64/linker/PE APIs

Task 12 depends on Tasks 2, 12C
  owns compileUefiAArch64Image orchestration and artifact metadata

Task 13 depends on Tasks 12A, 5, 12
  owns toolchain stdlib source root integration and smoke source fixtures

Task 14 depends on Tasks 1, 3, 12
  owns pure QEMU command planning and fake runner classification

Task 15 depends on Tasks 12, 13, 14
  owns optional real QEMU/AAVMF smoke command as a post-compile operation

Task 16 depends on Tasks 1 through 15
  owns audit tests, public exports, determinism, and final verification
```

Safe parallel batches:

```text
Batch A: Task 1
Batch B: Tasks 3, 4
Batch C: Tasks 5, 6, 7
Batch D: Task 2
Batch E: Task 8
Batch F: Tasks 9, 10
Batch G: Task 11
Batch H: Task 11A
Batch I: Task 12A
Batch J: Task 12B
Batch K: Task 12C
Batch L: Task 12
Batch M: Tasks 13, 14
Batch N: Task 15
Batch O: Task 16
```

Numeric task order is not execution order; the dependency map is authoritative. Parallel workers may edit `src/target/uefi-aarch64/index.ts` only by appending export lines for files they own. If two branches conflict only in this barrel, resolve by taking the union of export lines in deterministic path order.

## File Structure

Create the target driver in focused files:

```text
src/target/uefi-aarch64/
  index.ts
  diagnostics.ts
  result.ts
  artifact.ts
  target-driver-surface.ts
  status-conversion.ts
  firmware-abi.ts
  firmware-tables.ts
  platform-catalog.ts
  runtime-catalog.ts
  entry-contract.ts
  entry-thunk.ts
  watchdog-policy.ts
  firmware-strings.ts
  static-char16-objects.ts
  exit-boot-services.ts
  firmware-lowering.ts
  runtime-helper-instructions.ts
  runtime-helper-objects.ts
  package-input.ts
  package-pipeline.ts
  binary-spine.ts
  compile-uefi-aarch64-image.ts
  qemu-smoke.ts
```

Add tests and support:

```text
tests/support/target/uefi-aarch64/
  uefi-aarch64-fixtures.ts
  fake-watchdog-firmware.ts
  fake-exit-boot-services.ts
  fake-qemu-runner.ts
  status-golden-fixtures.ts
  firmware-table-golden-fixtures.ts

tests/unit/target/uefi-aarch64/
  diagnostics.test.ts
  target-driver-surface.test.ts
  status-conversion.test.ts
  firmware-abi.test.ts
  firmware-tables.test.ts
  platform-catalog.test.ts
  runtime-catalog.test.ts
  entry-contract.test.ts
  entry-thunk.test.ts
  watchdog-policy.test.ts
  firmware-strings.test.ts
  static-char16-objects.test.ts
  exit-boot-services.test.ts
  firmware-lowering.test.ts
  runtime-helper-objects.test.ts
  qemu-smoke.test.ts

tests/integration/target/uefi-aarch64/
  package-input.test.ts
  package-pipeline.test.ts
  binary-spine.test.ts
  compile-uefi-aarch64-image.test.ts
  stdlib-source-root.test.ts
  qemu-ovmf-smoke.test.ts

tests/audit/
  uefi-aarch64-target-driver-audit.test.ts
```

Modify existing files:

```text
src/index.ts
src/target/index.ts
src/target/aarch64/lower/uefi-image-lowering.ts
src/linker/aarch64/aarch64-entry-objects.ts
src/linker/aarch64/aarch64-linker.ts
src/runtime/runtime-catalog-types.ts
src/runtime/runtime-catalog.ts
src/semantic/surface/platform-surface.ts
scripts/check-policy.ts
package.json
docs/design/uefi-aarch64-target-driver-design.md
docs/design/compiler-pipeline-design.md
```

Add stdlib and fixtures:

```text
stdlib/wrela-std/
  core/
    unit.wr
    result.wr
  target/
    uefi/
      console.wr
      status.wr
      watchdog.wr
      memory.wr

tests/fixtures/uefi-aarch64/
  smoke-basic/
    wrela.toml
    src/image.wr
  smoke-ejected-stdlib/
    wrela.toml
    src/image.wr
    src/wrela-std/
  smoke-direct-platform/
    wrela.toml
    src/image.wr
```

## Shared Conventions

- Use `UefiAArch64TargetDiagnostic` for target-driver errors; do not throw for expected bad inputs.
- Use `stableHash` and `stableJson` from `src/shared/stable-json.ts` for fingerprints.
- Use `compareCodeUnitStrings` from `src/shared/deterministic-sort.ts` for deterministic ordering.
- Keep pure target-driver modules free of `Bun`, `node:fs`, `node:path`, `node:os`, `node:process`, subprocess calls, host clocks, and randomness.
- Use fakes through dependency injection in tests. Do not use mocks.
- Do not add new production dependencies.
- Keep each per-task `src/target/uefi-aarch64/index.ts` edit to one append-only export block. Resolve parallel barrel conflicts by union; do not delete another task's export.
- Any helper used in a snippet must be defined by the task that first uses it or by an earlier dependency. Do not introduce helper names only inside examples.
- Run narrow tests while iterating, then `bun run format`, `git diff --check`, and `bun run agent:check` before handing off.

## Task 1: Diagnostics, Results, Metadata, And Barrels

**Description:** Create the target-driver module skeleton, target-owned diagnostics, result helpers, verification summary types, artifact metadata, and public exports. This gives every later task a stable error/result vocabulary and keeps the orchestration API from leaking lower-phase diagnostics directly.

**Files:**

- Create: `src/target/uefi-aarch64/diagnostics.ts`
- Create: `src/target/uefi-aarch64/result.ts`
- Create: `src/target/uefi-aarch64/artifact.ts`
- Create: `src/target/uefi-aarch64/index.ts`
- Modify: `src/target/index.ts`
- Modify: `src/index.ts`
- Test: `tests/unit/target/uefi-aarch64/diagnostics.test.ts`
- Test: `tests/integration/public-api.test.ts`

**Acceptance Criteria:**

- `src/target/uefi-aarch64` has no host-effect imports.
- Diagnostics sort deterministically by code, owner key, and stable detail.
- Result helpers preserve verification summaries on both success and error.
- `uefiAArch64Ok`, `uefiAArch64Error`, `passedVerification`, `failedVerification`, `finishCatalogAuthentication`, and `isAsciiSymbolName` are defined in this task and reused by later tasks.
- `UefiAArch64TargetMetadata` includes every fingerprint listed in the design.
- `UefiAArch64SmokePolicy`, `UefiAArch64SmokeReport`, and `UefiAArch64ArtifactSink` are defined here so artifact and surface types compile before the QEMU runner is implemented.
- Root public API exposes the `wrela.target.uefiAarch64` namespace for the pure helper types added in this task. The high-level compile API is exported by Task 12 when the real orchestration exists.

- [ ] **Step 1: Write the failing diagnostics and namespace export tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  sortUefiAArch64TargetDiagnostics,
  uefiAArch64TargetDiagnostic,
} from "../../../../src/target/uefi-aarch64";

describe("UEFI AArch64 diagnostics", () => {
  test("sorts diagnostics deterministically", () => {
    const diagnostics = [
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_PIPELINE_FAILED",
        ownerKey: "pipeline",
        stableDetail: "stage:linker",
      }),
      uefiAArch64TargetDiagnostic({
        code: "UEFI_AARCH64_TARGET_AUTH_FAILED",
        ownerKey: "target",
        stableDetail: "targetKey:wrong",
      }),
    ];

    expect(
      sortUefiAArch64TargetDiagnostics(diagnostics).map((diagnostic) => diagnostic.code),
    ).toEqual(["UEFI_AARCH64_TARGET_AUTH_FAILED", "UEFI_AARCH64_PIPELINE_FAILED"]);
  });
});
```

```ts
import { describe, expect, test } from "bun:test";
import * as wrela from "../../src";

describe("public API", () => {
  test("exports the UEFI AArch64 target helper namespace", () => {
    expect(wrela.target.uefiAarch64).toBeDefined();
    expect(typeof wrela.target.uefiAarch64.uefiAArch64TargetDiagnostic).toBe("function");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/diagnostics.test.ts tests/integration/public-api.test.ts
```

Expected: fail because `src/target/uefi-aarch64` exports do not exist.

- [ ] **Step 3: Add diagnostic and result types**

```ts
export type UefiAArch64TargetDiagnosticCode =
  | "UEFI_AARCH64_TARGET_AUTH_FAILED"
  | "UEFI_AARCH64_ENTRY_THUNK_FAILED"
  | "UEFI_AARCH64_FIRMWARE_ABI_FAILED"
  | "UEFI_AARCH64_STATUS_CONVERSION_FAILED"
  | "UEFI_AARCH64_PIPELINE_FAILED"
  | "UEFI_AARCH64_ARTIFACT_SINK_FAILED"
  | "UEFI_AARCH64_SMOKE_FAILED";

export interface UefiAArch64TargetDiagnostic {
  readonly code: UefiAArch64TargetDiagnosticCode;
  readonly ownerKey: string;
  readonly stableDetail: string;
}

export interface UefiAArch64TargetVerifierRun {
  readonly verifierKey: string;
  readonly runKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail?: string;
}

export interface UefiAArch64TargetVerificationSummary {
  readonly runs: readonly UefiAArch64TargetVerifierRun[];
}
```

```ts
export type UefiAArch64TargetResult<T> =
  | {
      readonly kind: "ok";
      readonly value: T;
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
      readonly verification: UefiAArch64TargetVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
      readonly verification: UefiAArch64TargetVerificationSummary;
    };
```

```ts
export function passedVerification(
  verifierKey: string,
  runKey: string,
): UefiAArch64TargetVerificationSummary {
  return Object.freeze({
    runs: Object.freeze([{ verifierKey, runKey, status: "passed" as const }]),
  });
}

export function failedVerification(
  verifierKey: string,
  runKey: string,
  stableDetail?: string,
): UefiAArch64TargetVerificationSummary {
  return Object.freeze({
    runs: Object.freeze([{ verifierKey, runKey, status: "failed" as const, stableDetail }]),
  });
}

export function uefiAArch64Ok<T>(input: {
  readonly value: T;
  readonly diagnostics?: readonly UefiAArch64TargetDiagnostic[];
  readonly verification: UefiAArch64TargetVerificationSummary;
}): UefiAArch64TargetResult<T> {
  return Object.freeze({
    kind: "ok" as const,
    value: input.value,
    diagnostics: Object.freeze([...(input.diagnostics ?? [])]),
    verification: input.verification,
  });
}

export function uefiAArch64Error<T = never>(input: {
  readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
  readonly verification: UefiAArch64TargetVerificationSummary;
}): UefiAArch64TargetResult<T> {
  return Object.freeze({
    kind: "error" as const,
    diagnostics: Object.freeze([...input.diagnostics]),
    verification: input.verification,
  });
}
```

```ts
export function finishCatalogAuthentication<T>(input: {
  readonly verifierKey: string;
  readonly runKey: string;
  readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
  readonly values: readonly T[];
  readonly sortKey: (value: T) => string;
}): UefiAArch64TargetResult<readonly T[]> {
  if (input.diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics: input.diagnostics,
      verification: failedVerification(input.verifierKey, input.runKey),
    });
  }
  return uefiAArch64Ok({
    value: Object.freeze(
      [...input.values].sort((left, right) =>
        compareCodeUnitStrings(input.sortKey(left), input.sortKey(right)),
      ),
    ),
    verification: passedVerification(input.verifierKey, input.runKey),
  });
}

export function isAsciiSymbolName(value: string): boolean {
  return /^[A-Za-z_.$][A-Za-z0-9_.$]*$/.test(value);
}
```

- [ ] **Step 4: Add artifact and metadata types**

```ts
import type { PeCoffEfiImageArtifact } from "../../pe-coff";

export interface UefiAArch64SmokePolicy {
  readonly kind: "disabled" | "qemu";
  readonly allowSkip?: boolean;
}

export interface UefiAArch64SmokeReport {
  readonly status: "disabled" | "skipped" | "passed" | "failed";
  readonly stableDetail: string;
  readonly observedMarkers: readonly string[];
  readonly targetDriverFingerprint?: string;
}

export interface UefiAArch64ArtifactSink {
  readonly writeArtifact: (
    artifact: UefiAArch64ImageArtifact,
  ) => UefiAArch64TargetResult<{ readonly writtenPath?: string }>;
}

export interface UefiAArch64TargetMetadata {
  readonly schema: "wrela.uefi-aarch64-image";
  readonly schemaVersion: 1;
  readonly targetDriverFingerprint: string;
  readonly aarch64TargetFingerprint: string;
  readonly backendTargetFingerprint: string;
  readonly linkerTargetFingerprint: string;
  readonly peCoffWriterTargetFingerprint: string;
  readonly semanticPlatformCatalogFingerprint: string;
  readonly proofMirRuntimeCatalogFingerprint: string;
  readonly entryThunkFingerprint: string;
  readonly firmwareAbiFingerprint: string;
  readonly statusPolicyFingerprint: string;
  readonly watchdogPolicyFingerprint: string;
  readonly peCoffImageFingerprint: string;
  readonly finalImageFingerprint: string;
}

export interface UefiAArch64ImageArtifact {
  readonly artifactName: string;
  readonly peCoffArtifact: PeCoffEfiImageArtifact;
  readonly targetMetadata: UefiAArch64TargetMetadata;
  readonly smoke?: UefiAArch64SmokeReport;
}
```

- [ ] **Step 5: Wire barrels for the helper namespace**

```ts
export * from "./artifact";
export * from "./diagnostics";
export * from "./result";
```

```ts
export * from "./aarch64";
export * as aarch64 from "./aarch64";
export * from "./uefi-aarch64";
export * as uefiAarch64 from "./uefi-aarch64";
```

```ts
export * from "./target/uefi-aarch64";
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/diagnostics.test.ts tests/integration/public-api.test.ts
```

Expected: pass.

## Task 2: Target Driver Surface Authentication

**Description:** Compose the independently owned target-driver sub-surfaces from Tasks 3 through 7 into `UefiAArch64TargetDriverSurfaceInput` and `UefiAArch64TargetDriverSurface`. This task fingerprints the full bundle and orchestrates validation, but the actual validators and canonical constructors live beside their data records in the earlier tasks.

**Files:**

- Create: `src/target/uefi-aarch64/target-driver-surface.ts`
- Modify: `src/target/uefi-aarch64/index.ts`
- Create: `tests/support/target/uefi-aarch64/uefi-aarch64-fixtures.ts`
- Test: `tests/unit/target/uefi-aarch64/target-driver-surface.test.ts`

**Acceptance Criteria:**

- Authenticated surface accepts only `targetKey: "wrela-uefi-aarch64-rpi5-v1"`.
- Fingerprint is stable under sorted input order and changes when any target field changes.
- Entry symbols are non-empty ASCII and pairwise unique.
- Component fingerprints are required and recorded in the target-driver fingerprint.
- Duplicate primitive IDs and duplicate runtime IDs are rejected.
- Platform lowerings and runtime materializations are sorted in the authenticated surface.
- Every `firmware-call` lowering references an existing firmware table path.
- This task does not define duplicate status, firmware ABI, firmware table, platform lowering, runtime materialization, or entry-profile validators; it imports and composes the validators created by its dependencies.

- [ ] **Step 1: Write failing authentication tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  authenticateUefiAArch64TargetDriverSurface,
  canonicalUefiAArch64TargetDriverSurfaceInput,
} from "../../../../src/target/uefi-aarch64";
import { uefiTargetSurfaceFixture } from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI AArch64 target-driver surface", () => {
  test("authenticates the canonical production surface", () => {
    const result = authenticateUefiAArch64TargetDriverSurface(uefiTargetSurfaceFixture());
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.targetKey).toBe("wrela-uefi-aarch64-rpi5-v1");
      expect(result.value.targetDriverFingerprint).toStartWith("uefi-aarch64-target-driver:");
    }
  });

  test("rejects duplicate entry symbols", () => {
    const input = canonicalUefiAArch64TargetDriverSurfaceInput({
      entryProfile: {
        ...uefiTargetSurfaceFixture().entryProfile,
        imageEntryShimSymbol: "wrela.image.boot",
      },
    });

    const result = authenticateUefiAArch64TargetDriverSurface(input);
    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "entry-profile:duplicate-symbol:wrela.image.boot",
    );
  });

  test("rejects a firmware lowering that points at an absent table path", () => {
    const input = canonicalUefiAArch64TargetDriverSurfaceInput({
      platformLowerings: [
        {
          primitiveId: "uefi.console.outputString" as never,
          semanticPrimitiveFingerprint: "semantic:console-output",
          lowering: {
            kind: "firmware-call",
            tablePath: { kind: "boot-services", field: "missing-service" as never },
            arguments: [],
            result: { kind: "efi-status" },
          },
        },
      ],
    });

    const result = authenticateUefiAArch64TargetDriverSurface(input);
    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.includes("platform-lowering:unknown-table-path"),
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/target-driver-surface.test.ts
```

Expected: fail because target-driver surface types and authenticator are missing.

- [ ] **Step 3: Define the surface and canonical defaults**

```ts
export interface UefiAArch64TargetDriverSurfaceInput {
  readonly targetKey: "wrela-uefi-aarch64-rpi5-v1";
  readonly aarch64TargetFingerprint: string;
  readonly backendTargetFingerprint: string;
  readonly linkerTargetFingerprint: string;
  readonly peCoffWriterTargetFingerprint: string;
  readonly entryProfile: UefiAArch64EntryProfile;
  readonly firmwareAbi: UefiAArch64FirmwareAbiSurface;
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly semanticPlatformCatalogFingerprint: string;
  readonly proofMirRuntimeCatalogFingerprint: string;
  readonly platformLowerings: readonly UefiAArch64PlatformPrimitiveLowering[];
  readonly runtimeMaterializations: readonly UefiAArch64RuntimeMaterialization[];
  readonly statusPolicy: UefiAArch64StatusPolicy;
  readonly watchdogPolicy: UefiAArch64EntryWatchdogPolicy;
  readonly smokePolicy: UefiAArch64SmokePolicy;
}

export interface UefiAArch64TargetDriverSurface extends UefiAArch64TargetDriverSurfaceInput {
  readonly targetDriverFingerprint: string;
}
```

```ts
export function canonicalUefiAArch64TargetDriverSurfaceInput(
  overrides: Partial<UefiAArch64TargetDriverSurfaceInput> = {},
): UefiAArch64TargetDriverSurfaceInput {
  return Object.freeze({
    targetKey: "wrela-uefi-aarch64-rpi5-v1",
    aarch64TargetFingerprint: "aarch64-target:canonical",
    backendTargetFingerprint: "aarch64-backend:canonical",
    linkerTargetFingerprint: "aarch64-linker:canonical",
    peCoffWriterTargetFingerprint: "pe-coff-writer:canonical",
    entryProfile: canonicalUefiAArch64EntryProfile(),
    firmwareAbi: canonicalUefiAArch64FirmwareAbiSurface(),
    firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
    semanticPlatformCatalogFingerprint: "semantic-platform:canonical",
    proofMirRuntimeCatalogFingerprint: "proof-mir-runtime:canonical",
    platformLowerings: canonicalUefiAArch64PlatformLowerings(),
    runtimeMaterializations: canonicalUefiAArch64RuntimeMaterializations(),
    statusPolicy: canonicalUefiAArch64StatusPolicy(),
    watchdogPolicy: { kind: "disable-before-source" },
    smokePolicy: { kind: "disabled" },
    ...overrides,
  });
}
```

- [ ] **Step 4: Implement authentication with precise diagnostics**

```ts
export function authenticateUefiAArch64TargetDriverSurface(
  input: UefiAArch64TargetDriverSurfaceInput,
): UefiAArch64TargetResult<UefiAArch64TargetDriverSurface> {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];

  validateTargetKey(diagnostics, input.targetKey);
  validateComponentFingerprints(diagnostics, input);
  validateEntryProfile(diagnostics, input.entryProfile);
  validateFirmwareAbi(diagnostics, input.firmwareAbi);
  validateFirmwareTables(diagnostics, input.firmwareTables);
  validatePlatformLowerings(diagnostics, input.platformLowerings, input.firmwareTables);
  validateRuntimeMaterializations(diagnostics, input.runtimeMaterializations);
  validateStatusPolicy(diagnostics, input.statusPolicy);
  validateWatchdogPolicy(diagnostics, input.watchdogPolicy);
  validateSmokePolicy(diagnostics, input.smokePolicy);

  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification("uefi-aarch64-target-driver-surface", "authenticate"),
    });
  }

  const surface = freezeAuthenticatedSurface(input);
  return uefiAArch64Ok({
    value: Object.freeze({
      ...surface,
      targetDriverFingerprint: fingerprintTargetDriverSurface(surface),
    }),
    verification: passedVerification("uefi-aarch64-target-driver-surface", "authenticate"),
  });
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/target-driver-surface.test.ts
```

Expected: pass.

## Task 3: UEFI Status Policy And TCB Golden Fixtures

**Description:** Encode EFI status constants, the target-owned status conversion policy, and independent golden fixtures for status values. Keep named constants in one place and prevent numeric literals from spreading through entry thunk, watchdog, and platform lowering code.

**Files:**

- Create: `src/target/uefi-aarch64/status-conversion.ts`
- Create: `tests/support/target/uefi-aarch64/status-golden-fixtures.ts`
- Test: `tests/unit/target/uefi-aarch64/status-conversion.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- Status constants exactly match the design values.
- High-bit error values are derived through an `efiErrorStatus` helper.
- Source success maps to `EFI_SUCCESS`.
- Source target-certified error kinds map through a closed table.
- Panic maps to `EFI_ABORTED`.
- Entry-context validation failure maps to `EFI_INVALID_PARAMETER`.
- Tests compare production constants against independent golden values from test support, not production data re-exported into tests.

- [ ] **Step 1: Write failing status tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64StatusPolicy,
  efiErrorStatus,
  mapUefiAArch64EntryResultToStatus,
} from "../../../../src/target/uefi-aarch64";
import { UEFI_STATUS_GOLDEN } from "../../../support/target/uefi-aarch64/status-golden-fixtures";

describe("UEFI AArch64 status conversion", () => {
  test("freezes v1 EFI_STATUS constants against independent golden data", () => {
    const policy = canonicalUefiAArch64StatusPolicy();
    expect(policy.success).toBe(UEFI_STATUS_GOLDEN.success);
    expect(policy.invalidParameter).toBe(UEFI_STATUS_GOLDEN.invalidParameter);
    expect(policy.unsupported).toBe(UEFI_STATUS_GOLDEN.unsupported);
    expect(policy.bufferTooSmall).toBe(UEFI_STATUS_GOLDEN.bufferTooSmall);
    expect(policy.aborted).toBe(UEFI_STATUS_GOLDEN.aborted);
    expect(policy.securityViolation).toBe(UEFI_STATUS_GOLDEN.securityViolation);
  });

  test("derives error statuses through EFIERR semantics", () => {
    expect(efiErrorStatus(1n)).toBe(0x8000000000000001n);
    expect(efiErrorStatus(0x1an)).toBe(0x800000000000001an);
  });

  test("maps source entry result shapes to firmware status", () => {
    const policy = canonicalUefiAArch64StatusPolicy();
    expect(mapUefiAArch64EntryResultToStatus({ kind: "success" }, policy)).toBe(policy.success);
    expect(mapUefiAArch64EntryResultToStatus({ kind: "panic" }, policy)).toBe(policy.aborted);
    expect(
      mapUefiAArch64EntryResultToStatus(
        { kind: "target-error", errorKind: "securityViolation" },
        policy,
      ),
    ).toBe(policy.securityViolation);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/status-conversion.test.ts
```

Expected: fail because status conversion APIs are missing.

- [ ] **Step 3: Add independent golden fixture values**

```ts
export const UEFI_STATUS_GOLDEN = Object.freeze({
  success: 0x0000000000000000n,
  loadError: 0x8000000000000001n,
  invalidParameter: 0x8000000000000002n,
  unsupported: 0x8000000000000003n,
  badBufferSize: 0x8000000000000004n,
  bufferTooSmall: 0x8000000000000005n,
  deviceError: 0x8000000000000007n,
  notFound: 0x800000000000000en,
  aborted: 0x8000000000000015n,
  securityViolation: 0x800000000000001an,
});
```

- [ ] **Step 4: Implement status constants and conversion**

```ts
export interface UefiAArch64StatusPolicy {
  readonly success: 0x0000000000000000n;
  readonly loadError: bigint;
  readonly invalidParameter: bigint;
  readonly unsupported: bigint;
  readonly badBufferSize: bigint;
  readonly bufferTooSmall: bigint;
  readonly deviceError: bigint;
  readonly notFound: bigint;
  readonly aborted: bigint;
  readonly securityViolation: bigint;
  readonly panicStatus: "aborted";
}

export type UefiAArch64SourceEntryResult =
  | { readonly kind: "success" }
  | { readonly kind: "target-error"; readonly errorKind: UefiAArch64SourceErrorKind }
  | { readonly kind: "panic" }
  | { readonly kind: "entry-context-invalid" };
```

```ts
const EFI_ERROR_BIT_64 = 1n << 63n;

export function efiErrorStatus(value: bigint): bigint {
  if (value <= 0n || value >= EFI_ERROR_BIT_64) {
    throw new RangeError(`EFI error value must be in 1..2^63-1, got ${value}.`);
  }
  return EFI_ERROR_BIT_64 | value;
}
```

- [ ] **Step 5: Add coverage tests for malformed inputs**

```ts
test("rejects invalid EFIERR inputs", () => {
  expect(() => efiErrorStatus(0n)).toThrow(RangeError);
  expect(() => efiErrorStatus(1n << 63n)).toThrow(RangeError);
});
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/status-conversion.test.ts
```

Expected: pass.

## Task 4: Firmware ABI And Firmware Table Surface

**Description:** Implement the UEFI AArch64 firmware ABI surface and table-layout TCB records for system table, boot services, runtime services, simple text output, and protocol paths. Tests must freeze table ownership, field keys, offset values, value kinds, and pre-/post-`ExitBootServices` availability against independent golden fixtures.

**Files:**

- Create: `src/target/uefi-aarch64/firmware-abi.ts`
- Create: `src/target/uefi-aarch64/firmware-tables.ts`
- Create: `tests/support/target/uefi-aarch64/firmware-table-golden-fixtures.ts`
- Test: `tests/unit/target/uefi-aarch64/firmware-abi.test.ts`
- Test: `tests/unit/target/uefi-aarch64/firmware-tables.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- Firmware ABI pins image handle to `{ kind: "intReg", index: 0 }`, system table to `{ kind: "intReg", index: 1 }`, status return to `{ kind: "intReg", index: 0 }`.
- ABI reports pointer/status width `64`, stack alignment `16`, and `redZone: false`.
- ABI stores backend ABI and physical register model fingerprints without hand-listing register sets.
- Table surface includes the fields named in the design, including `set-watchdog-timer`.
- Table path lookup is total for canonical paths and deterministic for missing paths.
- Table data tests use independent fixture values, not production records.

- [ ] **Step 1: Write failing ABI tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64FirmwareAbiSurface,
  validateUefiAArch64FirmwareAbiSurface,
} from "../../../../src/target/uefi-aarch64";

describe("UEFI AArch64 firmware ABI", () => {
  test("pins UEFI handoff locations without owning a register catalog", () => {
    const surface = canonicalUefiAArch64FirmwareAbiSurface({
      backendAbiSurfaceFingerprint: "backend-abi:test",
      physicalRegisterModelFingerprint: "physical-registers:test",
    });

    expect(surface.imageHandleLocation).toEqual({ kind: "intReg", index: 0 });
    expect(surface.systemTableLocation).toEqual({ kind: "intReg", index: 1 });
    expect(surface.returnStatusLocation).toEqual({ kind: "intReg", index: 0 });
    expect("callerSavedRegisters" in surface).toBe(false);
    expect("calleeSavedRegisters" in surface).toBe(false);
  });

  test("rejects ABI records with missing backend fingerprints", () => {
    const result = validateUefiAArch64FirmwareAbiSurface(
      canonicalUefiAArch64FirmwareAbiSurface({
        backendAbiSurfaceFingerprint: "",
      }),
    );

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "firmware-abi:missing-backend-abi-fingerprint",
    );
  });
});
```

- [ ] **Step 2: Write failing table tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64FirmwareTableSurface,
  lookupUefiFirmwareTableField,
} from "../../../../src/target/uefi-aarch64";
import { UEFI_TABLE_FIELD_GOLDEN } from "../../../support/target/uefi-aarch64/firmware-table-golden-fixtures";

describe("UEFI firmware table surface", () => {
  test("includes watchdog, memory map, and exit boot services fields", () => {
    const surface = canonicalUefiAArch64FirmwareTableSurface();

    expect(
      lookupUefiFirmwareTableField(surface, { kind: "boot-services", field: "set-watchdog-timer" }),
    ).toMatchObject(UEFI_TABLE_FIELD_GOLDEN.bootServices.setWatchdogTimer);
    expect(
      lookupUefiFirmwareTableField(surface, { kind: "boot-services", field: "get-memory-map" }),
    ).toMatchObject(UEFI_TABLE_FIELD_GOLDEN.bootServices.getMemoryMap);
    expect(
      lookupUefiFirmwareTableField(surface, { kind: "boot-services", field: "exit-boot-services" }),
    ).toMatchObject(UEFI_TABLE_FIELD_GOLDEN.bootServices.exitBootServices);
  });

  test("returns undefined for unknown paths", () => {
    const surface = canonicalUefiAArch64FirmwareTableSurface();
    expect(
      lookupUefiFirmwareTableField(surface, {
        kind: "boot-services",
        field: "not-a-service" as never,
      }),
    ).toBeUndefined();
  });
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/firmware-abi.test.ts tests/unit/target/uefi-aarch64/firmware-tables.test.ts
```

Expected: fail because firmware ABI and table APIs are missing.

- [ ] **Step 4: Implement firmware ABI records**

```ts
export interface UefiAArch64FirmwareAbiSurface {
  readonly callConvention: "uefi-aapcs64";
  readonly pointerWidthBits: 64;
  readonly statusWidthBits: 64;
  readonly stackAlignmentBytes: 16;
  readonly redZone: false;
  readonly backendAbiSurfaceFingerprint: string;
  readonly physicalRegisterModelFingerprint: string;
  readonly imageHandleLocation: { readonly kind: "intReg"; readonly index: 0 };
  readonly systemTableLocation: { readonly kind: "intReg"; readonly index: 1 };
  readonly returnStatusLocation: { readonly kind: "intReg"; readonly index: 0 };
}
```

```ts
export function canonicalUefiAArch64FirmwareAbiSurface(
  overrides: Partial<UefiAArch64FirmwareAbiSurface> = {},
): UefiAArch64FirmwareAbiSurface {
  return Object.freeze({
    callConvention: "uefi-aapcs64",
    pointerWidthBits: 64,
    statusWidthBits: 64,
    stackAlignmentBytes: 16,
    redZone: false,
    backendAbiSurfaceFingerprint: "backend-abi:canonical",
    physicalRegisterModelFingerprint: "physical-registers:canonical",
    imageHandleLocation: { kind: "intReg", index: 0 },
    systemTableLocation: { kind: "intReg", index: 1 },
    returnStatusLocation: { kind: "intReg", index: 0 },
    ...overrides,
  });
}
```

- [ ] **Step 5: Implement table path types and lookup**

```ts
export type UefiBootServicesField =
  | "allocate-pages"
  | "free-pages"
  | "allocate-pool"
  | "free-pool"
  | "get-memory-map"
  | "exit-boot-services"
  | "set-watchdog-timer"
  | "handle-protocol"
  | "locate-protocol"
  | "open-protocol"
  | "close-protocol"
  | "create-event"
  | "set-timer"
  | "wait-for-event"
  | "stall"
  | "exit";

export type UefiFirmwareTablePath =
  | { readonly kind: "system-table"; readonly field: UefiSystemTableField }
  | { readonly kind: "simple-text-output"; readonly field: UefiSimpleTextOutputField }
  | { readonly kind: "boot-services"; readonly field: UefiBootServicesField }
  | { readonly kind: "runtime-services"; readonly field: UefiRuntimeServicesField }
  | { readonly kind: "protocol"; readonly guid: string; readonly field: string };
```

```ts
export interface UefiFirmwareTableFieldRecord {
  readonly tableKey: string;
  readonly fieldKey: string;
  readonly offsetBytes: number;
  readonly valueKind: "pointer" | "functionPointer" | "u32" | "u64";
  readonly requiredBeforeExitBootServices: boolean;
}
```

- [ ] **Step 6: Add independent golden fixture table values**

```ts
export const UEFI_TABLE_FIELD_GOLDEN = Object.freeze({
  systemTable: {
    conOut: {
      tableKey: "system-table",
      fieldKey: "con-out",
      offsetBytes: 64,
      valueKind: "pointer",
      requiredBeforeExitBootServices: false,
    },
    bootServices: {
      tableKey: "system-table",
      fieldKey: "boot-services",
      offsetBytes: 96,
      valueKind: "pointer",
      requiredBeforeExitBootServices: true,
    },
  },
  bootServices: {
    getMemoryMap: {
      tableKey: "boot-services",
      fieldKey: "get-memory-map",
      offsetBytes: 56,
      valueKind: "functionPointer",
      requiredBeforeExitBootServices: true,
    },
    exitBootServices: {
      tableKey: "boot-services",
      fieldKey: "exit-boot-services",
      offsetBytes: 232,
      valueKind: "functionPointer",
      requiredBeforeExitBootServices: true,
    },
    setWatchdogTimer: {
      tableKey: "boot-services",
      fieldKey: "set-watchdog-timer",
      offsetBytes: 256,
      valueKind: "functionPointer",
      requiredBeforeExitBootServices: true,
    },
  },
});
```

Use the existing design doc as the repo authority for the supported subset. If a value differs from the independent fixture during implementation, check the UEFI 2.11 Boot Services and System Table layouts, update the design doc with the corrected finding, and keep production and fixture data separate.

- [ ] **Step 7: Run tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/firmware-abi.test.ts tests/unit/target/uefi-aarch64/firmware-tables.test.ts
```

Expected: pass.

## Task 5: Platform Primitive Lowering Payloads

**Description:** Add UEFI platform primitive lowering payloads keyed by canonical `PlatformPrimitiveId` records from `SemanticTargetSurface`. This task does not create a second semantic catalog; it authenticates that every lowering is traceable to the selected semantic target surface and firmware table surface.

**Files:**

- Create: `src/target/uefi-aarch64/platform-catalog.ts`
- Modify: `tests/support/semantic/semantic-surface-fakes.ts`
- Test: `tests/unit/target/uefi-aarch64/platform-catalog.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- Canonical lowering payloads exist for the v1 primitive set: console output, allocate/free pool, get memory map, exit boot services helper, set watchdog timer, stall, exit, and protocol locate.
- Authentication rejects missing semantic primitive records.
- Authentication rejects stale `semanticPrimitiveFingerprint`.
- Authentication rejects duplicate primitive IDs.
- Authentication rejects firmware-call lowerings whose table path is absent.
- `semanticPrimitiveFingerprint` is derived with `fingerprintUefiPlatformPrimitiveSpec`, not read from a nonexistent `PlatformPrimitiveSpec.fingerprint` field.
- The semantic platform catalog fingerprint is derived with `fingerprintUefiSemanticPlatformCatalog`, not read from a nonexistent `SemanticTargetSurface.fingerprint` field.
- `UefiFirmwareArgumentRule` and `UefiFirmwareResultRule` are defined in this task before any lowering payload uses them.
- The target driver records the semantic platform catalog fingerprint; it does not trust a source path or module name.

- [ ] **Step 1: Write failing platform-catalog tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  authenticateUefiAArch64PlatformLowerings,
  canonicalUefiAArch64FirmwareTableSurface,
  canonicalUefiAArch64PlatformLowerings,
  fingerprintUefiSemanticPlatformCatalog,
} from "../../../../src/target/uefi-aarch64";
import { semanticTargetSurfaceWithUefiPrimitives } from "../../../support/semantic/semantic-surface-fakes";

describe("UEFI platform primitive lowering payloads", () => {
  test("authenticates v1 lowerings against canonical semantic primitives", () => {
    const semanticTarget = semanticTargetSurfaceWithUefiPrimitives();
    const result = authenticateUefiAArch64PlatformLowerings({
      semanticTarget,
      semanticPlatformCatalogFingerprint: fingerprintUefiSemanticPlatformCatalog(semanticTarget),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      lowerings: canonicalUefiAArch64PlatformLowerings(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.map((lowering) => String(lowering.primitiveId))).toEqual([
        "uefi.boot.allocatePool",
        "uefi.boot.exit",
        "uefi.boot.exitBootServices",
        "uefi.boot.freePool",
        "uefi.boot.getMemoryMap",
        "uefi.boot.setWatchdogTimer",
        "uefi.boot.stall",
        "uefi.console.outputString",
        "uefi.protocol.locate",
      ]);
    }
  });

  test("rejects lowerings without a semantic primitive source record", () => {
    const result = authenticateUefiAArch64PlatformLowerings({
      semanticTarget: semanticTargetSurfaceWithUefiPrimitives({ primitives: [] }),
      semanticPlatformCatalogFingerprint: "semantic:test",
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      lowerings: canonicalUefiAArch64PlatformLowerings(),
    });

    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.startsWith("platform-lowering:missing-semantic-primitive:"),
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/platform-catalog.test.ts
```

Expected: fail because platform-catalog APIs and UEFI semantic fakes are missing.

- [ ] **Step 3: Define lowering payload types**

```ts
import type { PlatformPrimitiveId } from "../../semantic/ids";
import type { ProofMirRuntimeOperationId } from "../../runtime/runtime-catalog-types";

export interface UefiAArch64PlatformPrimitiveLowering {
  readonly primitiveId: PlatformPrimitiveId;
  readonly semanticPrimitiveFingerprint: string;
  readonly lowering: UefiFirmwareLoweringRule;
}

export type UefiFirmwareArgumentRule =
  | { readonly kind: "source-argument"; readonly index: number }
  | { readonly kind: "image-handle" }
  | { readonly kind: "system-table" }
  | { readonly kind: "table-pointer"; readonly tableKey: string }
  | { readonly kind: "constant-u64"; readonly value: bigint };

export type UefiFirmwareResultRule =
  | { readonly kind: "efi-status" }
  | { readonly kind: "pointer-result"; readonly capabilityKey: string }
  | { readonly kind: "terminal-status" }
  | { readonly kind: "unit" };

export type UefiFirmwareLoweringRule =
  | {
      readonly kind: "firmware-call";
      readonly tablePath: UefiFirmwareTablePath;
      readonly arguments: readonly UefiFirmwareArgumentRule[];
      readonly result: UefiFirmwareResultRule;
    }
  | {
      readonly kind: "compiler-runtime-helper";
      readonly runtimeId: ProofMirRuntimeOperationId;
    }
  | {
      readonly kind: "inline";
      readonly operationKey: string;
    };
```

- [ ] **Step 4: Define semantic fingerprint functions**

```ts
export function fingerprintUefiPlatformPrimitiveSpec(primitive: PlatformPrimitiveSpec): string {
  return `uefi-platform-primitive:${stableHash(
    stableJson({
      primitiveId: primitive.primitiveId,
      contractId: primitive.contractId,
      primitiveFamilyId: primitive.primitiveFamilyId,
      availability: primitive.availability,
      signature: primitive.signature,
      proofContract: primitive.proofContract,
    }),
  )}`;
}

export function fingerprintUefiSemanticPlatformCatalog(surface: SemanticTargetSurface): string {
  return `uefi-semantic-platform-catalog:${stableHash(
    stableJson({
      targetId: surface.targetId,
      primitives: surface.platformPrimitives.entries().map((primitive) => ({
        primitiveId: primitive.primitiveId,
        fingerprint: fingerprintUefiPlatformPrimitiveSpec(primitive),
      })),
    }),
  )}`;
}
```

- [ ] **Step 5: Add canonical primitive fakes**

```ts
export function semanticTargetSurfaceWithUefiPrimitives(
  overrides: { readonly primitives?: readonly PlatformPrimitiveSpec[] } = {},
): SemanticTargetSurface {
  const primitives = overrides.primitives ?? [
    semanticPlatformPrimitiveSpecFake({
      primitiveId: "uefi.console.outputString" as PlatformPrimitiveId,
    }),
    semanticPlatformPrimitiveSpecFake({
      primitiveId: "uefi.boot.allocatePool" as PlatformPrimitiveId,
    }),
    semanticPlatformPrimitiveSpecFake({ primitiveId: "uefi.boot.freePool" as PlatformPrimitiveId }),
    semanticPlatformPrimitiveSpecFake({
      primitiveId: "uefi.boot.getMemoryMap" as PlatformPrimitiveId,
    }),
    semanticPlatformPrimitiveSpecFake({
      primitiveId: "uefi.boot.exitBootServices" as PlatformPrimitiveId,
    }),
    semanticPlatformPrimitiveSpecFake({
      primitiveId: "uefi.boot.setWatchdogTimer" as PlatformPrimitiveId,
    }),
    semanticPlatformPrimitiveSpecFake({ primitiveId: "uefi.boot.stall" as PlatformPrimitiveId }),
    semanticPlatformPrimitiveSpecFake({ primitiveId: "uefi.boot.exit" as PlatformPrimitiveId }),
    semanticPlatformPrimitiveSpecFake({
      primitiveId: "uefi.protocol.locate" as PlatformPrimitiveId,
    }),
  ];

  return semanticTargetSurfaceFake({ primitives });
}
```

- [ ] **Step 6: Implement authentication**

```ts
export function authenticateUefiAArch64PlatformLowerings(input: {
  readonly semanticTarget: SemanticTargetSurface;
  readonly semanticPlatformCatalogFingerprint: string;
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly lowerings: readonly UefiAArch64PlatformPrimitiveLowering[];
}): UefiAArch64TargetResult<readonly UefiAArch64PlatformPrimitiveLowering[]> {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const semanticPrimitives = new Map(
    input.semanticTarget.platformPrimitives
      .entries()
      .map((primitive) => [String(primitive.primitiveId), primitive]),
  );

  for (const lowering of input.lowerings) {
    const primitive = semanticPrimitives.get(String(lowering.primitiveId));
    if (primitive === undefined) {
      diagnostics.push(
        platformCatalogDiagnostic(
          `platform-lowering:missing-semantic-primitive:${String(lowering.primitiveId)}`,
        ),
      );
      continue;
    }
    if (fingerprintUefiPlatformPrimitiveSpec(primitive) !== lowering.semanticPrimitiveFingerprint) {
      diagnostics.push(
        platformCatalogDiagnostic(
          `platform-lowering:stale-semantic-fingerprint:${String(lowering.primitiveId)}`,
        ),
      );
    }
    if (lowering.lowering.kind === "firmware-call") {
      const field = lookupUefiFirmwareTableField(input.firmwareTables, lowering.lowering.tablePath);
      if (field === undefined) {
        diagnostics.push(
          platformCatalogDiagnostic(
            `platform-lowering:unknown-table-path:${String(lowering.primitiveId)}`,
          ),
        );
      }
    }
  }

  return finishCatalogAuthentication({
    verifierKey: "uefi-aarch64-platform-catalog",
    runKey: "authenticate",
    diagnostics,
    values: input.lowerings,
    sortKey: (lowering) => String(lowering.primitiveId),
  });
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/platform-catalog.test.ts
```

Expected: pass.

## Task 6: Runtime Operation Materialization

**Description:** Add UEFI runtime materialization records keyed by canonical `ProofMirRuntimeOperation` entries and extend the runtime catalog owner vocabulary for UEFI-specific helpers. This task keeps proof-visible helper identity in `ProofMirRuntimeCatalog` and only records how each selected runtime operation is materialized for UEFI AArch64.

**Files:**

- Create: `src/target/uefi-aarch64/runtime-catalog.ts`
- Modify: `src/runtime/runtime-catalog-types.ts`
- Modify: `src/runtime/runtime-catalog.ts`
- Modify: `tests/support/proof-mir/proof-mir-fakes.ts`
- Test: `tests/unit/target/uefi-aarch64/runtime-catalog.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- Runtime materializations exist for `uefi.status.from-boot-result`, `uefi.panic.to-status`, `uefi.entry.initialize-context`, `uefi.console.write-ascii-debug`, `uefi.string.utf16-static`, and `runtime.validated-buffer.read-slow`.
- Authentication rejects missing runtime operations.
- Authentication rejects stale runtime operation fingerprints.
- Authentication rejects duplicate runtime IDs.
- UEFI-specific lowering owners are represented in the shared runtime catalog types.
- `runtimeOperationFingerprint` is derived from `normalizedProofMirRuntimeOperationContent` in `src/runtime/runtime-catalog.ts`; the plan does not add a fingerprint field to `ProofMirRuntimeOperation`.
- Coroutine, move-ring transfer, cross-core, and MP-services helpers remain unavailable for v1 unless the selected runtime catalog explicitly supplies a supported operation and the target materializes it.

- [ ] **Step 1: Write failing runtime materialization tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  authenticateUefiAArch64RuntimeMaterializations,
  canonicalUefiAArch64RuntimeMaterializations,
} from "../../../../src/target/uefi-aarch64";
import { proofMirRuntimeCatalogWithUefiOperations } from "../../../support/proof-mir/proof-mir-fakes";

describe("UEFI runtime materialization", () => {
  test("authenticates v1 materializations against Proof MIR runtime catalog records", () => {
    const runtimeCatalog = proofMirRuntimeCatalogWithUefiOperations();
    const result = authenticateUefiAArch64RuntimeMaterializations({
      runtimeCatalog,
      runtimeCatalogFingerprint: runtimeCatalog.fingerprint ?? "runtime:test",
      materializations: canonicalUefiAArch64RuntimeMaterializations(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.map((record) => record.linkageName)).toContain(
        "__wrela_uefi_status_from_boot_result",
      );
      expect(result.value.map((record) => record.linkageName)).toContain(
        "__wrela_uefi_entry_initialize_context",
      );
    }
  });

  test("rejects a materialization whose runtime operation is absent", () => {
    const runtimeCatalog = proofMirRuntimeCatalogWithUefiOperations({ operations: [] });
    const result = authenticateUefiAArch64RuntimeMaterializations({
      runtimeCatalog,
      runtimeCatalogFingerprint: "runtime:empty",
      materializations: canonicalUefiAArch64RuntimeMaterializations(),
    });

    expect(result.kind).toBe("error");
    expect(
      result.diagnostics.some((diagnostic) =>
        diagnostic.stableDetail.startsWith("runtime-materialization:missing-runtime-operation:"),
      ),
    ).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/runtime-catalog.test.ts
```

Expected: fail because runtime materialization APIs and fakes are missing.

- [ ] **Step 3: Extend runtime lowering-owner vocabulary**

```ts
export type ProofMirRuntimeLoweringOwner =
  | "panicAbort"
  | "validatedBufferHelper"
  | "coroutineFrame"
  | "moveRingCoreTransfer"
  | "targetMemoryHelper"
  | "uefiStatusConversion"
  | "uefiEntryContext"
  | "uefiFirmwareString"
  | "uefiConsoleDiagnostic";
```

Run:

```bash
bun test tests/integration/proof-mir/public-api.test.ts tests/integration/proof-check/public-api.test.ts
```

Expected: pass after fixture updates.

- [ ] **Step 4: Define materialization records**

```ts
import { normalizedProofMirRuntimeOperationContent } from "../../runtime/runtime-catalog";

export interface UefiAArch64RuntimeMaterialization {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly runtimeOperationFingerprint: string;
  readonly linkageName: string;
  readonly convention: "wrela-private" | "aapcs64";
  readonly materialization: "backend-object" | "source-runtime" | "inline-only";
}

export function fingerprintUefiAArch64RuntimeOperation(
  operation: ProofMirRuntimeOperation,
): string {
  return `uefi-runtime-operation:${stableHash(normalizedProofMirRuntimeOperationContent(operation))}`;
}
```

- [ ] **Step 5: Add runtime catalog fake helper**

```ts
export function proofMirRuntimeCatalogWithUefiOperations(
  overrides: { readonly operations?: readonly ProofMirRuntimeOperation[] } = {},
): ProofMirRuntimeCatalog {
  const operations = overrides.operations ?? [
    proofMirRuntimeOperationFake({
      runtimeId: proofMirRuntimeOperationId(1000),
      name: "uefi.status.from-boot-result",
      authorityKey: "uefi.status.from-boot-result",
      loweringOwner: "uefiStatusConversion",
    }),
    proofMirRuntimeOperationFake({
      runtimeId: proofMirRuntimeOperationId(1001),
      name: "uefi.entry.initialize-context",
      authorityKey: "uefi.entry.initialize-context",
      loweringOwner: "uefiEntryContext",
    }),
  ];

  return proofMirRuntimeCatalogFake({
    targetId: targetId("wrela-uefi-aarch64-rpi5-v1"),
    fingerprint: "proof-mir-runtime:uefi-test",
    operations,
  });
}
```

- [ ] **Step 6: Implement authentication and sorting**

```ts
export function authenticateUefiAArch64RuntimeMaterializations(input: {
  readonly runtimeCatalog: ProofMirRuntimeCatalog;
  readonly runtimeCatalogFingerprint: string;
  readonly materializations: readonly UefiAArch64RuntimeMaterialization[];
}): UefiAArch64TargetResult<readonly UefiAArch64RuntimeMaterialization[]> {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const operationsById = new Map(
    input.runtimeCatalog.entries().map((operation) => [String(operation.runtimeId), operation]),
  );

  for (const materialization of input.materializations) {
    const operation = operationsById.get(String(materialization.runtimeId));
    if (operation === undefined) {
      diagnostics.push(
        runtimeCatalogDiagnostic(
          `runtime-materialization:missing-runtime-operation:${String(materialization.runtimeId)}`,
        ),
      );
      continue;
    }
    if (
      fingerprintUefiAArch64RuntimeOperation(operation) !==
      materialization.runtimeOperationFingerprint
    ) {
      diagnostics.push(
        runtimeCatalogDiagnostic(
          `runtime-materialization:stale-runtime-fingerprint:${String(materialization.runtimeId)}`,
        ),
      );
    }
    if (!isAsciiSymbolName(materialization.linkageName)) {
      diagnostics.push(
        runtimeCatalogDiagnostic(
          `runtime-materialization:invalid-linkage-name:${materialization.linkageName}`,
        ),
      );
    }
  }

  return finishCatalogAuthentication({
    verifierKey: "uefi-aarch64-runtime-catalog",
    runKey: "authenticate",
    diagnostics,
    values: input.materializations,
    sortKey: (materialization) => String(materialization.runtimeId).padStart(12, "0"),
  });
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/runtime-catalog.test.ts tests/integration/proof-mir/public-api.test.ts
```

Expected: pass.

## Task 7: Source Boot Contract And Image Context Policy

**Description:** Encode the source-visible UEFI boot function contract: the image entry has no source-visible raw EFI handle/table parameters, hidden image/system-table capabilities come from target facts, and source result shapes map through the status policy.

**Files:**

- Create: `src/target/uefi-aarch64/entry-contract.ts`
- Test: `tests/unit/target/uefi-aarch64/entry-contract.test.ts`
- Test: `tests/integration/target/aarch64/uefi-platform-call-lowering.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- The canonical entry profile matches the design exactly.
- The boot function source-visible parameter list must be empty for v1.
- Raw `EFI_HANDLE` or `EFI_SYSTEM_TABLE*` source parameters are rejected.
- Hidden context bindings use `uefi.imageHandle` and `uefi.systemTable`.
- Null system table maps to `EFI_INVALID_PARAMETER` before source boot code.
- Allowed result shapes are success, target-certified result error, terminal/never, and panic.
- No file under `src/target/aarch64` imports from `src/target/uefi-aarch64`; the adapter lives in the target-driver module and returns the existing `AArch64UefiImageProfile` data shape.

- [ ] **Step 1: Write failing entry-contract tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64EntryProfile,
  validateUefiAArch64BootFunctionContract,
} from "../../../../src/target/uefi-aarch64";

describe("UEFI source boot function contract", () => {
  test("pins the v1 entry profile", () => {
    expect(canonicalUefiAArch64EntryProfile()).toEqual({
      peEntryLinkageName: "__wrela_uefi_entry",
      imageEntryShimSymbol: "wrela.image.entry_shim",
      bootFunctionSymbol: "wrela.image.boot",
      imageHandleSourceKey: "uefi.imageHandle",
      systemTableSourceKey: "uefi.systemTable",
      entryCallConvention: "uefi-aapcs64",
      bootCallConvention: "wrela-source",
      statusResultRegister: "x0",
      thunkStrategy: "framed-call",
    });
  });

  test("rejects raw firmware parameters in the source boot function", () => {
    const result = validateUefiAArch64BootFunctionContract({
      sourceVisibleParameters: [
        { name: "imageHandle", typeKey: "EFI_HANDLE" },
        { name: "systemTable", typeKey: "EFI_SYSTEM_TABLE*" },
      ],
      resultShape: { kind: "unit-success" },
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "entry-contract:raw-firmware-parameter:imageHandle:EFI_HANDLE",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/entry-contract.test.ts
```

Expected: fail because entry-contract APIs are missing.

- [ ] **Step 3: Implement entry profile and boot contract types**

```ts
export interface UefiAArch64EntryProfile {
  readonly peEntryLinkageName: "__wrela_uefi_entry";
  readonly imageEntryShimSymbol: "wrela.image.entry_shim";
  readonly bootFunctionSymbol: "wrela.image.boot";
  readonly imageHandleSourceKey: "uefi.imageHandle";
  readonly systemTableSourceKey: "uefi.systemTable";
  readonly entryCallConvention: "uefi-aapcs64";
  readonly bootCallConvention: "wrela-source";
  readonly statusResultRegister: "x0";
  readonly thunkStrategy: "framed-call";
}
```

```ts
export type UefiAArch64BootResultShape =
  | { readonly kind: "unit-success" }
  | { readonly kind: "target-certified-result"; readonly errorTypeKey: string }
  | { readonly kind: "never" }
  | { readonly kind: "panic" };
```

- [ ] **Step 4: Add the target-driver adapter to the existing AArch64 image profile shape**

```ts
import type { AArch64UefiImageProfile } from "../aarch64/lower/uefi-image-lowering";

export function aarch64UefiImageProfileFromEntryProfile(
  profile: UefiAArch64EntryProfile,
): AArch64UefiImageProfile {
  return {
    entryShimSymbol: profile.imageEntryShimSymbol,
    bootFunctionSymbol: profile.bootFunctionSymbol,
    imageHandleLocation: { kind: "intReg", index: 0 },
    systemTableLocation: { kind: "intReg", index: 1 },
    firmwareTableKeys: ["uefi.boot-services", "uefi.system-table"],
  };
}
```

Keep the existing `aarch64UefiImageProfileForTargetProfile` behavior in `src/target/aarch64/lower/uefi-image-lowering.ts`. `compileUefiAArch64Image` passes the adapter output into existing AArch64 lowering inputs; lower-level AArch64 code must not import target-driver types.

- [ ] **Step 5: Run entry and AArch64 lowering tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/entry-contract.test.ts tests/integration/target/aarch64/uefi-platform-call-lowering.test.ts
```

Expected: pass.

## Task 8: Framed UEFI Entry Thunk Object Provider

**Description:** Replace the generic synthetic entry object meaning with a UEFI framed-call thunk owned by the target driver. The thunk must save/restore `x29`/`x30`, preserve the firmware return address before any `bl`, initialize target entry context, call `wrela.image.boot`, convert its result to `EFI_STATUS`, and return through `ret`.

**Files:**

- Create: `src/target/uefi-aarch64/entry-thunk.ts`
- Modify: `src/linker/aarch64/aarch64-entry-objects.ts`
- Modify: `src/linker/aarch64/aarch64-linker.ts`
- Test: `tests/unit/target/uefi-aarch64/entry-thunk.test.ts`
- Test: `tests/unit/linker/aarch64-link-orchestration.test.ts`
- Test: `tests/integration/linker/aarch64-linked-image-layout.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- The provider receives an authenticated `UefiAArch64EntryProfile`.
- The generated object defines exactly one global `__wrela_uefi_entry` symbol at offset zero.
- The generated object references `wrela.image.boot` and any compiler-owned status/context helper by relocation, not by hard-coded final RVA.
- The thunk has a real frame and saves `x29`/`x30` before the first `bl`.
- The thunk frame has named stack slots for the firmware image handle, firmware system table, boot result, saved `x29`, and saved `x30`; `x0`/`x1` are reloaded before calling `wrela.image.boot` because public calls may clobber them.
- The thunk restores `x29`/`x30` before `ret`.
- The thunk branches to the epilogue with the entry-initialization status when the entry-context helper reports `continueFlag == 0`.
- The object includes unwind metadata accepted by the existing AArch64 object verifier.
- `AArch64SyntheticEntryObjectFactoryResult` supports plural relocations and entry unwind records; the linker provider emits them into the object module.
- `thunkStrategy: "tail-entry"` is rejected in v1.
- No handwritten entry-thunk bytes live in the linker; encoding flows through target-driver/backend object factories.

- [ ] **Step 1: Write failing entry-thunk tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64EntryProfile,
  createUefiAArch64EntryThunkObjectFactory,
  planUefiAArch64EntryThunk,
} from "../../../../src/target/uefi-aarch64";
import { authenticatedBackendTargetSurfaceForTest } from "../../../support/target/aarch64/backend/backend-fixtures";

describe("UEFI AArch64 entry thunk", () => {
  test("plans a framed call thunk that preserves firmware x30 before BL", () => {
    const plan = planUefiAArch64EntryThunk({
      entryProfile: canonicalUefiAArch64EntryProfile(),
      backendTarget: authenticatedBackendTargetSurfaceForTest(),
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind === "ok") {
      expect(plan.value.strategy).toBe("framed-call");
      expect(plan.value.frameSizeBytes).toBe(48);
      expect(plan.value.frameSlots).toEqual([
        { key: "image-handle", offsetBytes: 0, sizeBytes: 8 },
        { key: "system-table", offsetBytes: 8, sizeBytes: 8 },
        { key: "boot-result", offsetBytes: 16, sizeBytes: 8 },
        { key: "saved-x29", offsetBytes: 32, sizeBytes: 8 },
        { key: "saved-x30", offsetBytes: 40, sizeBytes: 8 },
      ]);
      expect(plan.value.instructions.map((instruction) => instruction.operationKey)).toEqual([
        "sub-sp-frame",
        "stp-x29-x30-frame",
        "add-x29-frame",
        "store-image-handle",
        "store-system-table",
        "call-entry-initialize-context",
        "branch-if-entry-initialization-failed",
        "reload-entry-context-for-boot",
        "call-boot-function",
        "store-boot-result",
        "reload-boot-result-for-status-conversion",
        "call-status-conversion",
        "ldp-x29-x30-frame",
        "add-sp-frame",
        "ret",
      ]);
      const firstBranchIndex = plan.value.instructions.findIndex((instruction) =>
        instruction.operationKey.startsWith("call-"),
      );
      const frameIndex = plan.value.instructions.findIndex(
        (instruction) => instruction.operationKey === "stp-x29-x30-preindex-sp",
      );
      expect(frameIndex).toBeLessThan(firstBranchIndex);
    }
  });

  test("creates a verified synthetic object with expected symbols and relocations", () => {
    const factory = createUefiAArch64EntryThunkObjectFactory({
      entryProfile: canonicalUefiAArch64EntryProfile(),
      backendTarget: authenticatedBackendTargetSurfaceForTest(),
    });

    const result = factory.createEntryObject({ wrelaBootLinkageName: "wrela.image.boot" });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.relocations.map((relocation) => relocation.targetLinkageName)).toContain(
        "wrela.image.boot",
      );
      expect(result.unwindRecords).toHaveLength(1);
    }
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/entry-thunk.test.ts
```

Expected: fail because entry-thunk APIs are missing.

- [ ] **Step 3: Define the thunk plan**

```ts
export interface UefiAArch64EntryThunkPlan {
  readonly strategy: "framed-call";
  readonly entrySymbol: "__wrela_uefi_entry";
  readonly imageEntryShimSymbol: "wrela.image.entry_shim";
  readonly bootFunctionSymbol: "wrela.image.boot";
  readonly frameSizeBytes: number;
  readonly frameSlots: readonly UefiAArch64EntryThunkFrameSlot[];
  readonly instructions: readonly UefiAArch64EntryThunkInstructionPlan[];
  readonly relocations: readonly UefiAArch64EntryThunkRelocationPlan[];
  readonly unwind: UefiAArch64EntryThunkUnwindPlan;
  readonly fingerprint: string;
}

export interface UefiAArch64EntryThunkFrameSlot {
  readonly key: "image-handle" | "system-table" | "boot-result" | "saved-x29" | "saved-x30";
  readonly offsetBytes: number;
  readonly sizeBytes: 8;
}
```

```ts
export type UefiAArch64EntryThunkInstructionPlan =
  | { readonly operationKey: "sub-sp-frame"; readonly frameSizeBytes: 48 }
  | { readonly operationKey: "stp-x29-x30-frame"; readonly savedX29OffsetBytes: 32 }
  | { readonly operationKey: "add-x29-frame"; readonly savedX29OffsetBytes: 32 }
  | {
      readonly operationKey: "store-image-handle";
      readonly sourceRegister: "x0";
      readonly slot: "image-handle";
    }
  | {
      readonly operationKey: "store-system-table";
      readonly sourceRegister: "x1";
      readonly slot: "system-table";
    }
  | { readonly operationKey: "call-entry-initialize-context"; readonly targetLinkageName: string }
  | {
      readonly operationKey: "branch-if-entry-initialization-failed";
      readonly flagRegister: "x1";
      readonly successValue: 1n;
    }
  | {
      readonly operationKey: "reload-entry-context-for-boot";
      readonly imageHandleRegister: "x0";
      readonly systemTableRegister: "x1";
    }
  | { readonly operationKey: "call-boot-function"; readonly targetLinkageName: "wrela.image.boot" }
  | {
      readonly operationKey: "store-boot-result";
      readonly sourceRegister: "x0";
      readonly slot: "boot-result";
    }
  | {
      readonly operationKey: "reload-boot-result-for-status-conversion";
      readonly targetRegister: "x0";
      readonly slot: "boot-result";
    }
  | { readonly operationKey: "call-status-conversion"; readonly targetLinkageName: string }
  | { readonly operationKey: "ldp-x29-x30-frame"; readonly savedX29OffsetBytes: 32 }
  | { readonly operationKey: "add-sp-frame"; readonly frameSizeBytes: 48 }
  | { readonly operationKey: "ret" };
```

- [ ] **Step 4: Implement object factory by delegating encoding to backend helpers**

```ts
export function createUefiAArch64EntryThunkObjectFactory(
  input: CreateUefiAArch64EntryThunkObjectFactoryInput,
): AArch64SyntheticObjectFactory {
  return Object.freeze({
    createEntryObject: (factoryInput) =>
      createUefiAArch64EntryObject({
        ...input,
        bootLinkageName: factoryInput.wrelaBootLinkageName,
      }),
    createUnwindObjects: (factoryInput) =>
      createUefiAArch64UnwindObjects({
        ...input,
        unwindRecords: factoryInput.unwindRecords,
      }),
  });
}
```

Use existing backend encoding catalog helpers to encode the planned operations. If a direct helper for an instruction is missing, add it in the AArch64 backend object encoding module with focused tests; do not embed raw instruction bytes in `entry-thunk.ts`.

- [ ] **Step 5: Update linker synthetic entry factory result shape**

```ts
export type AArch64SyntheticEntryObjectFactoryResult =
  | {
      readonly kind: "ok";
      readonly codeBytes: readonly number[];
      readonly relocations: readonly AArch64EntryObjectRelocationFactoryOutput[];
      readonly unwindRecords: readonly AArch64ObjectUnwindRecord[];
    }
  | AArch64SyntheticObjectFactoryError;
```

Keep `AArch64EntryObjectFactoryInput` limited to `wrelaBootLinkageName`; the authenticated entry profile is captured by the target-driver factory closure. The linker remains generic over `AArch64SyntheticObjectFactory`; it accepts the target-driver factory through dependency injection and does not import `src/target/uefi-aarch64`.

- [ ] **Step 6: Run entry and linker tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/entry-thunk.test.ts tests/unit/linker/aarch64-link-orchestration.test.ts tests/integration/linker/aarch64-linked-image-layout.test.ts
```

Expected: pass.

## Task 9: Watchdog Policy And Entry Context Initialization

**Description:** Implement target-owned watchdog policy behavior and the emitted `__wrela_uefi_entry_initialize_context` helper object. Production default is `disable-before-source`, which validates the system table and boot-services pointer, calls `BootServices.SetWatchdogTimer(0, 0, 0, NULL)`, returns `x0 = EFI_STATUS`, and returns `x1 = 1` only when the thunk should continue into source boot code.

**Files:**

- Create: `src/target/uefi-aarch64/watchdog-policy.ts`
- Create: `src/target/uefi-aarch64/runtime-helper-objects.ts`
- Modify: `src/target/uefi-aarch64/runtime-catalog.ts`
- Create: `tests/support/target/uefi-aarch64/fake-watchdog-firmware.ts`
- Test: `tests/unit/target/uefi-aarch64/watchdog-policy.test.ts`
- Test: `tests/unit/target/uefi-aarch64/runtime-helper-objects.test.ts`
- Test: `tests/unit/target/uefi-aarch64/entry-thunk.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- `disable-before-source` emits a required call to `BootServices.SetWatchdogTimer(0, 0, 0, NULL)`.
- `EFI_SUCCESS` and `EFI_UNSUPPORTED` are non-fatal for watchdog disable.
- Any other watchdog failure maps through the target status policy before source code runs.
- `preserve-firmware-default` emits no automatic watchdog call.
- `source-managed` requires the `uefi.boot.setWatchdogTimer` primitive to be present in the platform lowering payloads.
- Entry context validation returns `EFI_INVALID_PARAMETER` for null system table or missing boot-services pointer in production v1.
- `materializeUefiAArch64EntryInitializeContextHelper` emits a verified AArch64 object module defining `__wrela_uefi_entry_initialize_context`.
- The helper's public contract is `x0=imageHandle`, `x1=systemTable` on entry; `x0=status`, `x1=continueFlag` on return.
- The helper emits conditional branches for null system table and null boot-services pointer, loads `BootServices.SetWatchdogTimer` from the authenticated table offset, performs the indirect firmware call, treats `EFI_SUCCESS` and `EFI_UNSUPPORTED` as continue, and returns all other statuses with `continueFlag = 0`.
- No watchdog behavior exists only as a plan record; the linked image receives helper object bytes or compilation fails.

- [ ] **Step 1: Write failing watchdog tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64StatusPolicy,
  evaluateUefiAArch64WatchdogDisableResult,
  planUefiAArch64EntryContextInitialization,
} from "../../../../src/target/uefi-aarch64";

describe("UEFI watchdog policy", () => {
  test("plans SetWatchdogTimer disable before source for production default", () => {
    const plan = planUefiAArch64EntryContextInitialization({
      watchdogPolicy: { kind: "disable-before-source" },
      hasSystemTable: true,
      hasBootServices: true,
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind === "ok") {
      expect(plan.value.operations).toContainEqual({
        kind: "firmware-call",
        tablePath: { kind: "boot-services", field: "set-watchdog-timer" },
        arguments: [0n, 0n, 0n, null],
      });
    }
  });

  test("treats success and unsupported as non-fatal", () => {
    const policy = canonicalUefiAArch64StatusPolicy();
    expect(evaluateUefiAArch64WatchdogDisableResult(policy.success, policy)).toEqual({
      kind: "continue",
    });
    expect(evaluateUefiAArch64WatchdogDisableResult(policy.unsupported, policy)).toEqual({
      kind: "continue",
    });
  });

  test("maps device errors before source code runs", () => {
    const policy = canonicalUefiAArch64StatusPolicy();
    expect(evaluateUefiAArch64WatchdogDisableResult(policy.deviceError, policy)).toEqual({
      kind: "return-status",
      status: policy.deviceError,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/watchdog-policy.test.ts
```

Expected: fail because watchdog APIs are missing.

- [ ] **Step 3: Implement policy types and planner**

```ts
export type UefiAArch64EntryWatchdogPolicy =
  | { readonly kind: "disable-before-source" }
  | { readonly kind: "preserve-firmware-default" }
  | { readonly kind: "source-managed" };

export type UefiAArch64EntryContextOperation =
  | {
      readonly kind: "firmware-call";
      readonly tablePath: { readonly kind: "boot-services"; readonly field: "set-watchdog-timer" };
      readonly arguments: readonly [0n, 0n, 0n, null];
    }
  | { readonly kind: "validate-system-table" }
  | { readonly kind: "validate-boot-services" };
```

```ts
export function evaluateUefiAArch64WatchdogDisableResult(
  status: bigint,
  policy: UefiAArch64StatusPolicy,
): { readonly kind: "continue" } | { readonly kind: "return-status"; readonly status: bigint } {
  if (status === policy.success || status === policy.unsupported) {
    return { kind: "continue" };
  }
  return { kind: "return-status", status };
}
```

- [ ] **Step 4: Add fake firmware harness for table-pointer validation**

```ts
export interface FakeUefiFirmwareTables {
  readonly systemTable: bigint | null;
  readonly bootServices: bigint | null;
  readonly setWatchdogTimerStatus: bigint;
}

export function fakeFirmwareWithBootServices(
  overrides: Partial<FakeUefiFirmwareTables> = {},
): FakeUefiFirmwareTables {
  return Object.freeze({
    systemTable: 0x1000n,
    bootServices: 0x2000n,
    setWatchdogTimerStatus: 0n,
    ...overrides,
  });
}
```

- [ ] **Step 5: Materialize the entry-initialize-context helper object**

```ts
export function materializeUefiAArch64EntryInitializeContextHelper(input: {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly statusPolicy: UefiAArch64StatusPolicy;
  readonly watchdogPolicy: UefiAArch64EntryWatchdogPolicy;
}): UefiAArch64TargetResult<AArch64ObjectModule> {
  const plan = planUefiAArch64EntryInitializeContextHelper(input);
  if (plan.kind === "error") return plan;

  return encodeUefiAArch64RuntimeHelperObject({
    backendTarget: input.backendTarget,
    linkageName: "__wrela_uefi_entry_initialize_context",
    plan: plan.value,
  });
}
```

```ts
test("entry initialize context helper emits branches and firmware call", () => {
  const result = materializeUefiAArch64EntryInitializeContextHelper({
    backendTarget: authenticatedBackendTargetSurfaceForTest(),
    firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
    statusPolicy: canonicalUefiAArch64StatusPolicy(),
    watchdogPolicy: { kind: "disable-before-source" },
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(objectDefinesLinkageName(result.value, "__wrela_uefi_entry_initialize_context")).toBe(
      true,
    );
    expect(objectInstructionOpcodes(result.value)).toEqual(
      expect.arrayContaining(["cbz", "ldr-unsigned-immediate", "blr", "cmp", "b-cond", "ret"]),
    );
  }
});
```

- [ ] **Step 6: Run watchdog, helper, and entry-thunk tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/watchdog-policy.test.ts tests/unit/target/uefi-aarch64/runtime-helper-objects.test.ts tests/unit/target/uefi-aarch64/entry-thunk.test.ts
```

Expected: pass.

## Task 10: Firmware String Materialization

**Description:** Implement deterministic firmware string materialization for static ASCII/CR/LF smoke strings and checked dynamic UTF-16 slice inputs. UEFI console output consumes NUL-terminated `CHAR16`, so this code belongs in the target/runtime layer rather than ad hoc call-site buffers.

**Files:**

- Create: `src/target/uefi-aarch64/firmware-strings.ts`
- Test: `tests/unit/target/uefi-aarch64/firmware-strings.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- Static ASCII strings materialize as little-endian `CHAR16` bytes with a trailing NUL.
- `\r` and `\n` are accepted.
- NUL in the source string is rejected.
- Non-ASCII characters are rejected in v1 with a diagnostic naming the code point.
- Materialization fingerprint is stable.
- Console output lowering consumes a materialized pointer/lifetime record and does not synthesize string buffers at the call site.

- [ ] **Step 1: Write failing firmware string tests**

```ts
import { describe, expect, test } from "bun:test";
import { materializeUefiAArch64StaticChar16String } from "../../../../src/target/uefi-aarch64";

describe("UEFI firmware string materialization", () => {
  test("materializes ASCII smoke marker as NUL-terminated CHAR16LE", () => {
    const result = materializeUefiAArch64StaticChar16String({
      stableKey: "smoke-marker",
      value: "WRELA_UEFI_SMOKE_OK\r\n",
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.bytes.slice(0, 10)).toEqual([
        0x57, 0x00, 0x52, 0x00, 0x45, 0x00, 0x4c, 0x00, 0x41, 0x00,
      ]);
      expect(result.value.bytes.slice(-2)).toEqual([0x00, 0x00]);
    }
  });

  test("rejects non-ASCII v1 strings", () => {
    const result = materializeUefiAArch64StaticChar16String({
      stableKey: "snowman",
      value: "snowman \u2603",
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "firmware-string:unsupported-code-point:snowman:2603",
    );
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/firmware-strings.test.ts
```

Expected: fail because firmware string APIs are missing.

- [ ] **Step 3: Define materialization types**

```ts
export interface UefiAArch64StaticChar16StringInput {
  readonly stableKey: string;
  readonly value: string;
}

export interface UefiAArch64StaticChar16String {
  readonly stableKey: string;
  readonly codeUnits: readonly number[];
  readonly bytes: readonly number[];
  readonly nulTerminated: true;
  readonly fingerprint: string;
}
```

- [ ] **Step 4: Implement explicit ASCII/CR/LF conversion**

```ts
export function materializeUefiAArch64StaticChar16String(
  input: UefiAArch64StaticChar16StringInput,
): UefiAArch64TargetResult<UefiAArch64StaticChar16String> {
  const diagnostics: UefiAArch64TargetDiagnostic[] = [];
  const codeUnits: number[] = [];

  for (let index = 0; index < input.value.length; index += 1) {
    const codePoint = input.value.codePointAt(index);
    if (codePoint === undefined) continue;
    if (codePoint === 0) {
      diagnostics.push(
        firmwareStringDiagnostic(`firmware-string:nul-code-point:${input.stableKey}:${index}`),
      );
      continue;
    }
    if (!(codePoint === 0x0d || codePoint === 0x0a || (codePoint >= 0x20 && codePoint <= 0x7e))) {
      diagnostics.push(
        firmwareStringDiagnostic(
          `firmware-string:unsupported-code-point:${input.stableKey}:${codePoint.toString(16)}`,
        ),
      );
      continue;
    }
    codeUnits.push(codePoint);
  }

  if (diagnostics.length > 0) {
    return uefiAArch64Error({
      diagnostics,
      verification: failedVerification("uefi-firmware-string", input.stableKey),
    });
  }

  codeUnits.push(0);
  const bytes = codeUnits.flatMap((codeUnit) => [codeUnit & 0xff, (codeUnit >>> 8) & 0xff]);
  return uefiAArch64Ok({
    value: freezeChar16String(input.stableKey, codeUnits, bytes),
    verification: passedVerification("uefi-firmware-string", input.stableKey),
  });
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/firmware-strings.test.ts
```

Expected: pass.

## Task 11: GetMemoryMap And ExitBootServices Helper Policy

**Description:** Implement the target-owned helper policy and emitted helper object that couple `GetMemoryMap` and `ExitBootServices` with bounded retry, preplanned capacity slack, and no boot-services allocation after the final fresh map. The trace evaluator is test support for fake firmware behavior; the production deliverable is a materialized helper object or source-runtime body referenced by the platform/runtime catalogs.

**Files:**

- Create: `src/target/uefi-aarch64/exit-boot-services.ts`
- Modify: `src/target/uefi-aarch64/runtime-helper-objects.ts`
- Create: `tests/support/target/uefi-aarch64/fake-exit-boot-services.ts`
- Test: `tests/unit/target/uefi-aarch64/exit-boot-services.test.ts`
- Test: `tests/unit/target/uefi-aarch64/runtime-helper-objects.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- Helper policy first obtains or sizes a memory-map buffer.
- `EFI_BUFFER_TOO_SMALL` triggers at most one capacity growth per configured attempt.
- Before `ExitBootServices`, the helper reacquires a fresh map and records `MapKey`.
- No non-memory-allocation boot service occurs after the first `ExitBootServices` failure.
- `EFI_INVALID_PARAMETER` retries with a fresh map within a bounded retry count.
- On success, boot-services authority is marked consumed/stale.
- If retry cannot proceed without additional allocation outside policy, the helper fails closed.
- `materializeUefiAArch64ExitBootServicesWithFreshMapHelper` emits a verified helper object or source-runtime body referenced by the `uefi.boot.exitBootServices` compiler-runtime-helper lowering.
- The helper emits the bounded retry loop, calls `GetMemoryMap` immediately before each `ExitBootServices` attempt, and contains no production-only trace-evaluator path.

- [ ] **Step 1: Write failing exit-boot-services tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64ExitBootServicesPolicy,
  evaluateUefiAArch64ExitBootServicesTrace,
} from "../../../../src/target/uefi-aarch64";
import { fakeExitBootServicesTrace } from "../../../support/target/uefi-aarch64/fake-exit-boot-services";

describe("UEFI GetMemoryMap/ExitBootServices policy", () => {
  test("retries stale map key with a fresh map within policy bound", () => {
    const result = evaluateUefiAArch64ExitBootServicesTrace({
      policy: canonicalUefiAArch64ExitBootServicesPolicy({ maxInvalidParameterRetries: 1 }),
      trace: fakeExitBootServicesTrace([
        {
          kind: "getMemoryMap",
          status: "success",
          mapKey: 10n,
          descriptorSize: 48,
          descriptorVersion: 1,
        },
        { kind: "exitBootServices", status: "invalid-parameter", mapKey: 10n },
        {
          kind: "getMemoryMap",
          status: "success",
          mapKey: 11n,
          descriptorSize: 48,
          descriptorVersion: 1,
        },
        { kind: "exitBootServices", status: "success", mapKey: 11n },
      ]),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.bootServicesAuthority).toBe("consumed");
    }
  });

  test("fails closed when retry budget is exhausted", () => {
    const result = evaluateUefiAArch64ExitBootServicesTrace({
      policy: canonicalUefiAArch64ExitBootServicesPolicy({ maxInvalidParameterRetries: 0 }),
      trace: fakeExitBootServicesTrace([
        {
          kind: "getMemoryMap",
          status: "success",
          mapKey: 10n,
          descriptorSize: 48,
          descriptorVersion: 1,
        },
        { kind: "exitBootServices", status: "invalid-parameter", mapKey: 10n },
      ]),
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe("exit-boot-services:retry-budget-exhausted");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/exit-boot-services.test.ts
```

Expected: fail because exit-boot-services APIs are missing.

- [ ] **Step 3: Implement helper policy types**

```ts
export interface UefiAArch64ExitBootServicesPolicy {
  readonly initialDescriptorSlackBytes: number;
  readonly maxBufferTooSmallRetries: number;
  readonly maxInvalidParameterRetries: number;
}

export interface UefiAArch64ExitBootServicesSuccess {
  readonly bootServicesAuthority: "consumed";
  readonly finalMapKey: bigint;
  readonly descriptorSize: number;
  readonly descriptorVersion: number;
}
```

```ts
export function canonicalUefiAArch64ExitBootServicesPolicy(
  overrides: Partial<UefiAArch64ExitBootServicesPolicy> = {},
): UefiAArch64ExitBootServicesPolicy {
  return Object.freeze({
    initialDescriptorSlackBytes: 2 * 48,
    maxBufferTooSmallRetries: 2,
    maxInvalidParameterRetries: 1,
    ...overrides,
  });
}
```

- [ ] **Step 4: Implement trace evaluator**

```ts
export function evaluateUefiAArch64ExitBootServicesTrace(input: {
  readonly policy: UefiAArch64ExitBootServicesPolicy;
  readonly trace: readonly FakeExitBootServicesEvent[];
}): UefiAArch64TargetResult<UefiAArch64ExitBootServicesSuccess> {
  let invalidParameterRetries = 0;
  let latestMap:
    | {
        readonly mapKey: bigint;
        readonly descriptorSize: number;
        readonly descriptorVersion: number;
      }
    | undefined;

  for (const event of input.trace) {
    if (event.kind === "getMemoryMap" && event.status === "success") {
      latestMap = {
        mapKey: event.mapKey,
        descriptorSize: event.descriptorSize,
        descriptorVersion: event.descriptorVersion,
      };
      continue;
    }

    if (event.kind === "exitBootServices" && event.status === "invalid-parameter") {
      if (invalidParameterRetries >= input.policy.maxInvalidParameterRetries) {
        return exitBootServicesError("exit-boot-services:retry-budget-exhausted");
      }
      invalidParameterRetries += 1;
      continue;
    }

    if (
      event.kind === "exitBootServices" &&
      event.status === "success" &&
      latestMap !== undefined
    ) {
      return exitBootServicesOk({
        bootServicesAuthority: "consumed",
        finalMapKey: latestMap.mapKey,
        descriptorSize: latestMap.descriptorSize,
        descriptorVersion: latestMap.descriptorVersion,
      });
    }
  }

  return exitBootServicesError("exit-boot-services:missing-successful-exit");
}
```

- [ ] **Step 5: Materialize the production helper**

```ts
export function materializeUefiAArch64ExitBootServicesWithFreshMapHelper(input: {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly statusPolicy: UefiAArch64StatusPolicy;
  readonly exitBootServicesPolicy: UefiAArch64ExitBootServicesPolicy;
}): UefiAArch64TargetResult<AArch64ObjectModule> {
  const plan = planUefiAArch64ExitBootServicesHelper(input);
  if (plan.kind === "error") return plan;

  return encodeUefiAArch64RuntimeHelperObject({
    backendTarget: input.backendTarget,
    linkageName: "__wrela_uefi_exit_boot_services_with_fresh_map",
    plan: plan.value,
  });
}
```

```ts
test("exit boot services helper emits bounded fresh-map retry loop", () => {
  const result = materializeUefiAArch64ExitBootServicesWithFreshMapHelper({
    backendTarget: authenticatedBackendTargetSurfaceForTest(),
    firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
    statusPolicy: canonicalUefiAArch64StatusPolicy(),
    exitBootServicesPolicy: canonicalUefiAArch64ExitBootServicesPolicy({
      maxInvalidParameterRetries: 1,
    }),
  });

  expect(result.kind).toBe("ok");
  if (result.kind === "ok") {
    expect(
      objectDefinesLinkageName(result.value, "__wrela_uefi_exit_boot_services_with_fresh_map"),
    ).toBe(true);
    expect(objectInstructionOpcodes(result.value)).toEqual(
      expect.arrayContaining(["blr", "cmp", "b-cond", "ret"]),
    );
  }
});
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/exit-boot-services.test.ts tests/unit/target/uefi-aarch64/runtime-helper-objects.test.ts
```

Expected: pass.

## Task 11A: Firmware Platform Call Lowering Integration

**Description:** Teach AArch64 machine lowering to consume authenticated `UefiFirmwareLoweringRule` records for `platformCall` operations. This is the bridge from target-driver catalog data to emitted machine IR: firmware-call lowerings load authenticated table pointers and function pointers, compiler-runtime-helper lowerings become direct helper calls, and inline lowerings remain explicit operation keys.

**Files:**

- Create: `src/target/uefi-aarch64/firmware-lowering.ts`
- Create: `src/target/aarch64/lower/firmware-platform-call-contract.ts`
- Modify: `src/target/aarch64/public-api.ts`
- Modify: `src/target/aarch64/lower/operation-materializer-calls.ts`
- Modify: `src/target/aarch64/lower/operation-materialization.ts`
- Modify: `src/target/aarch64/lower/pipeline-stages.ts`
- Test: `tests/unit/target/uefi-aarch64/firmware-lowering.test.ts`
- Test: `tests/integration/target/aarch64/uefi-platform-call-lowering.test.ts`

**Acceptance Criteria:**

- `AArch64OperationMaterializationContext` accepts an optional AArch64-owned `firmwarePlatformCalls` context with a read-only lowering lookup keyed by platform primitive ID.
- No file under `src/target/aarch64/**` imports from `src/target/uefi-aarch64/**`, including type-only imports; the UEFI target driver adapts its authenticated records into the AArch64-owned structural contract.
- A `firmware-call` lowering resolves its `UefiFirmwareTablePath`, loads the table pointer from the UEFI image context/provenance, loads the function pointer at the authenticated table offset, marshals arguments through the existing AAPCS64 classifier, emits `blr`, and copies the `EFI_STATUS`/result according to `UefiFirmwareResultRule`.
- A `compiler-runtime-helper` lowering records a normal `CALL26` relocation to the authenticated runtime helper linkage name; it does not create a `platform.*` unresolved symbol.
- Unsupported or missing lowering payloads fail with deterministic target diagnostics before object emission.
- Existing non-UEFI platform-call tests keep their behavior by running without a firmware-platform-call lookup.

- [ ] **Step 1: Write failing firmware-lowering tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  canonicalUefiAArch64FirmwareTableSurface,
  canonicalUefiAArch64PlatformLowerings,
  materializeUefiAArch64FirmwarePlatformCall,
} from "../../../../src/target/uefi-aarch64";
import { platformCallOperationForTest } from "../../../support/opt-ir/opt-ir-handoff-fixtures";
import { authenticatedBackendTargetSurfaceForTest } from "../../../support/target/aarch64/backend/backend-fixtures";

describe("UEFI firmware platform-call lowering", () => {
  test("emits table-path load plus indirect firmware call for console output", () => {
    const result = materializeUefiAArch64FirmwarePlatformCall({
      backendTarget: authenticatedBackendTargetSurfaceForTest(),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      platformLowerings: canonicalUefiAArch64PlatformLowerings(),
      operation: platformCallOperationForTest("uefi.console.outputString"),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.instructions.map((instruction) => String(instruction.opcode))).toEqual(
        expect.arrayContaining(["ldr-unsigned-immediate", "blr"]),
      );
      expect(result.value.relocationReferences).toEqual([]);
    }
  });

  test("lowers helper-owned platform calls to runtime helper relocations", () => {
    const result = materializeUefiAArch64FirmwarePlatformCall({
      backendTarget: authenticatedBackendTargetSurfaceForTest(),
      firmwareTables: canonicalUefiAArch64FirmwareTableSurface(),
      platformLowerings: canonicalUefiAArch64PlatformLowerings(),
      operation: platformCallOperationForTest("uefi.boot.exitBootServices"),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(
        result.value.relocationReferences.map((relocation) => String(relocation.symbol)),
      ).toContain("__wrela_uefi_exit_boot_services_with_fresh_map");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/firmware-lowering.test.ts tests/integration/target/aarch64/uefi-platform-call-lowering.test.ts
```

Expected: fail because AArch64 lowering does not yet consume UEFI platform-lowering payloads.

- [ ] **Step 3: Add the AArch64-owned structural lowering contract**

```ts
export type AArch64FirmwareTableBaseKey = "uefi-system-table" | "uefi-boot-services";

export interface AArch64FirmwareTableFieldLayout {
  readonly base: AArch64FirmwareTableBaseKey;
  readonly fieldKey: string;
  readonly offsetBytes: number;
  readonly widthBytes: 8;
}

export type AArch64FirmwarePlatformCallLowering =
  | {
      readonly kind: "firmware-call";
      readonly primitiveId: string;
      readonly tableField: AArch64FirmwareTableFieldLayout;
      readonly argumentRules: readonly AArch64FirmwareArgumentRule[];
      readonly resultRule: AArch64FirmwareResultRule;
    }
  | {
      readonly kind: "compiler-runtime-helper";
      readonly primitiveId: string;
      readonly helperLinkageName: string;
      readonly argumentRules: readonly AArch64FirmwareArgumentRule[];
      readonly resultRule: AArch64FirmwareResultRule;
    };

export interface AArch64FirmwarePlatformCallContext {
  readonly loweringFor: (
    platformPrimitiveId: string,
  ) => AArch64FirmwarePlatformCallLowering | undefined;
}
```

```ts
export interface AArch64OperationMaterializationContext {
  readonly abi?: AArch64AbiTargetSurface;
  readonly fpEnvironment?: AArch64FpEnvironmentPolicy;
  readonly factQuery?: AArch64FactQuery;
  readonly operationSupportContracts?: ReadonlyMap<number, AArch64OperationSupportContract>;
  readonly firmwarePlatformCalls?: AArch64FirmwarePlatformCallContext;
}
```

```ts
export interface AArch64LoweringOptions {
  readonly collectDiagnostics?: boolean;
  readonly debugTrace?: boolean;
  readonly deterministicDump?: boolean;
  readonly semanticPlugins?: readonly AArch64SemanticPlugin[];
  readonly firmwarePlatformCalls?: AArch64FirmwarePlatformCallContext;
}
```

Keep this property optional so non-UEFI AArch64 tests keep their existing behavior. The new contract belongs to `src/target/aarch64`; target-driver-specific names and authenticated UEFI records stay in `src/target/uefi-aarch64`.

- [ ] **Step 4: Implement the firmware-call materializer**

```ts
export function aarch64FirmwarePlatformCallContextFromUefiTarget(
  target: UefiAArch64TargetDriverSurface,
): AArch64FirmwarePlatformCallContext {
  const byPrimitive = new Map(
    target.platformLowerings.map((record) => [
      record.primitiveId,
      uefiLoweringRuleToAArch64FirmwarePlatformCallLowering({
        rule: record.lowering,
        firmwareTables: target.firmwareTables,
      }),
    ]),
  );
  return Object.freeze({
    loweringFor: (platformPrimitiveId: string) => byPrimitive.get(platformPrimitiveId),
  });
}
```

```ts
export function materializeUefiAArch64FirmwarePlatformCall(input: {
  readonly backendTarget: AArch64BackendTargetSurface;
  readonly firmwareTables: UefiAArch64FirmwareTableSurface;
  readonly platformLowerings: readonly UefiAArch64PlatformPrimitiveLowering[];
  readonly operation: OperationOf<"platformCall">;
}): AArch64OperationMaterializationResult {
  const lowering = platformLoweringForOperation(input.platformLowerings, input.operation);
  if (lowering === undefined) {
    return {
      kind: "error",
      stableDetail: `uefi-platform-lowering:missing:${input.operation.target.platformKey}`,
    };
  }
  return materializeUefiFirmwareLoweringRule({
    backendTarget: input.backendTarget,
    firmwareTables: input.firmwareTables,
    lowering,
    operation: input.operation,
  });
}
```

- [ ] **Step 5: Wire `operation-materializer-calls.ts` to use the firmware-platform lowering path**

```ts
if (operation.kind === "platformCall" && this.context.firmwarePlatformCalls !== undefined) {
  const lowering = this.context.firmwarePlatformCalls.loweringFor(
    platformCallTargetKey(operation.target),
  );
  if (lowering !== undefined) {
    return this.materializeFirmwarePlatformCall(operation, lowering);
  }
}
```

If no UEFI lowering is present, preserve the current `platform.*` indirect-symbol behavior for existing tests.

- [ ] **Step 6: Run tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/firmware-lowering.test.ts tests/integration/target/aarch64/uefi-platform-call-lowering.test.ts
```

Expected: pass.

## Task 12A: Package Input And Source Roots

**Description:** Define the compiler-edge package input type used by the UEFI target driver and tests. This is not a TOML parser task: v1 fixture manifests are documentation for humans, while tests and callers pass structured `CompilerPackageInput` directly.

**Files:**

- Create: `src/target/uefi-aarch64/package-input.ts`
- Modify: `tests/support/target/uefi-aarch64/uefi-aarch64-fixtures.ts`
- Test: `tests/integration/target/uefi-aarch64/package-input.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- `CompilerPackageInput`, `CompilerSourceRoot`, and `CompilerSourceFileInput` are concrete types.
- Package inputs are deterministic: source roots and files are sorted by stable keys, and duplicate module/source keys are rejected.
- `packageInputFromFixtureProject` reads `.wr` files under explicit source roots; it does not parse `wrela.toml` and does not require a TOML dependency.
- `defaultUefiAArch64SourceRoots` can add `stdlib/wrela-std` as an ordinary untrusted toolchain source root or use an ejected `src/wrela-std` root.

- [ ] **Step 1: Write failing package-input tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  compilerPackageInput,
  defaultUefiAArch64SourceRoots,
} from "../../../../src/target/uefi-aarch64";

describe("UEFI compiler package input", () => {
  test("sorts source roots and rejects duplicate files", () => {
    const result = compilerPackageInput({
      packageKey: "smoke-basic",
      sourceRoots: [
        { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
        {
          kind: "toolchain",
          rootKey: "stdlib",
          rootPath: "stdlib/wrela-std",
          trustedForAuthority: false,
        },
      ],
      sourceFiles: [
        { sourceKey: "src/image.wr", moduleName: "image", text: "module image\n" },
        { sourceKey: "src/image.wr", moduleName: "image_dup", text: "module image_dup\n" },
      ],
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.stableDetail).toBe(
      "package-input:duplicate-source-key:src/image.wr",
    );
  });

  test("adds toolchain stdlib as untrusted source by default", () => {
    expect(defaultUefiAArch64SourceRoots({ projectSourceRoot: "src" })).toEqual([
      { kind: "project", rootKey: "project", rootPath: "src", trustedForAuthority: false },
      {
        kind: "toolchain",
        rootKey: "toolchain-wrela-std",
        rootPath: "stdlib/wrela-std",
        trustedForAuthority: false,
      },
    ]);
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/package-input.test.ts
```

Expected: fail because package input APIs are missing.

- [ ] **Step 3: Implement package input types**

```ts
export interface CompilerSourceRoot {
  readonly kind: "project" | "toolchain";
  readonly rootKey: string;
  readonly rootPath: string;
  readonly trustedForAuthority: false;
}

export interface CompilerSourceFileInput {
  readonly sourceKey: string;
  readonly moduleName: string;
  readonly text: string;
}

export interface CompilerPackageInput {
  readonly packageKey: string;
  readonly sourceRoots: readonly CompilerSourceRoot[];
  readonly sourceFiles: readonly CompilerSourceFileInput[];
  readonly entryModuleName: string;
}
```

- [ ] **Step 4: Implement deterministic constructor and source roots**

```ts
export function defaultUefiAArch64SourceRoots(input: {
  readonly projectSourceRoot: string;
  readonly stdlibMode?: "toolchain" | "project-ejected" | "none";
}): readonly CompilerSourceRoot[] {
  const project = {
    kind: "project" as const,
    rootKey: "project",
    rootPath: input.projectSourceRoot,
    trustedForAuthority: false as const,
  };
  if (input.stdlibMode === "none") return Object.freeze([project]);
  if (input.stdlibMode === "project-ejected") {
    return Object.freeze([
      project,
      {
        kind: "project" as const,
        rootKey: "project-wrela-std",
        rootPath: `${input.projectSourceRoot}/wrela-std`,
        trustedForAuthority: false as const,
      },
    ]);
  }
  return Object.freeze([
    project,
    {
      kind: "toolchain" as const,
      rootKey: "toolchain-wrela-std",
      rootPath: "stdlib/wrela-std",
      trustedForAuthority: false as const,
    },
  ]);
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/package-input.test.ts
```

Expected: pass.

## Task 12B: Package Pipeline Adapters Through OptIR

**Description:** Build explicit target-driver adapters for the existing source pipeline through optimized OptIR. This task names every stage and makes the shape conversions testable before binary emission is introduced.

**Files:**

- Create: `src/target/uefi-aarch64/package-pipeline.ts`
- Test: `tests/integration/target/uefi-aarch64/package-pipeline.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- The adapter stages are explicit: `parseModuleGraph`, `lowerTypedHir`, `monomorphizeWholeImage`, `computeRepresentationLayoutFacts`, `buildProofMir`, `checkProofAndResources`, and `buildOptimizedOptIr`.
- Each stage consumes the previous stage's real output type or a small adapter record named in this task.
- The pipeline result records passed/failed stage keys without using a monolithic black-box target-driver pipeline helper.
- The test fixture can stop after optimized OptIR and inspect reachable platform primitive IDs and runtime catalog fingerprints.

- [ ] **Step 1: Write failing package-pipeline tests**

```ts
import { describe, expect, test } from "bun:test";
import { runUefiAArch64PackagePipelineToOptIr } from "../../../../src/target/uefi-aarch64";
import {
  uefiCompilePackageInputFixture,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI package pipeline through OptIR", () => {
  test("runs explicit source stages for a smoke package", () => {
    const result = runUefiAArch64PackagePipelineToOptIr({
      packageInput: uefiCompilePackageInputFixture("success"),
      target: uefiTargetSurfaceFixture(),
    });

    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.stages.map((stage) => stage.stageKey)).toEqual([
        "frontend",
        "semantic",
        "hir",
        "monomorphization",
        "layout-facts",
        "proof-mir",
        "proof-check",
        "opt-ir",
      ]);
      expect(result.value.semanticPlatformCatalogFingerprint).toBe(
        result.value.target.semanticPlatformCatalogFingerprint,
      );
    }
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/package-pipeline.test.ts
```

Expected: fail because package-pipeline APIs are missing.

- [ ] **Step 3: Define stage result records and dependencies**

```ts
export type UefiAArch64PackagePipelineStageKey =
  | "frontend"
  | "semantic"
  | "hir"
  | "monomorphization"
  | "layout-facts"
  | "proof-mir"
  | "proof-check"
  | "opt-ir";

export interface UefiAArch64PackagePipelineDependencies {
  readonly parseModuleGraph: typeof parseModuleGraph;
  readonly lowerTypedHir: typeof lowerTypedHir;
  readonly monomorphizeWholeImage: typeof monomorphizeWholeImage;
  readonly computeRepresentationLayoutFacts: typeof computeRepresentationLayoutFacts;
  readonly buildProofMir: typeof buildProofMir;
  readonly checkProofAndResources: typeof checkProofAndResources;
  readonly buildOptimizedOptIr: typeof buildOptimizedOptIr;
}

export interface UefiAArch64OptimizedOptIrArtifact {
  readonly program: OptimizedOptIrProgram;
  readonly operations: readonly OptIrOperation[];
  readonly facts: OptIrFactSet;
}

export interface RunUefiAArch64PackagePipelineToOptIrInput {
  readonly packageInput: CompilerPackageInput;
  readonly target: UefiAArch64TargetDriverSurface;
}

export interface UefiAArch64PackageOptIrPipelineOutput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly optIr: UefiAArch64OptimizedOptIrArtifact;
  readonly semanticPlatformCatalogFingerprint: string;
  readonly proofMirRuntimeCatalogFingerprint: string;
  readonly stages: readonly UefiAArch64StageRecord<UefiAArch64PackagePipelineStageKey>[];
}
```

- [ ] **Step 4: Implement the adapter with injected stage functions**

```ts
export function runUefiAArch64PackagePipelineToOptIr(
  input: RunUefiAArch64PackagePipelineToOptIrInput,
  dependencies: UefiAArch64PackagePipelineDependencies = productionPackagePipelineDependencies(),
): UefiAArch64TargetResult<UefiAArch64PackageOptIrPipelineOutput> {
  const stages = createUefiAArch64StageRecorder<UefiAArch64PackagePipelineStageKey>();
  const parsed = dependencies.parseModuleGraph(
    packageInputToModuleGraphParseInput(input.packageInput),
  );
  if (parsed.kind === "error")
    return packagePipelineError(stages.failed("frontend"), parsed.diagnostics);
  stages.passed("frontend");

  const hir = dependencies.lowerTypedHir(packageParsedGraphToHirInput(parsed.value, input.target));
  if (hir.kind === "error") return packagePipelineError(stages.failed("hir"), hir.diagnostics);
  stages.passed("hir");

  const monomorphized = dependencies.monomorphizeWholeImage(
    packageHirToMonomorphizationInput(hir.value, input.target),
  );
  if (monomorphized.kind === "error") {
    return packagePipelineError(stages.failed("monomorphization"), monomorphized.diagnostics);
  }
  stages.passed("monomorphization");

  const layoutFacts = dependencies.computeRepresentationLayoutFacts(
    monomorphizedImageToLayoutFactsInput(monomorphized.value, input.target),
  );
  if (layoutFacts.kind === "error") {
    return packagePipelineError(stages.failed("layout-facts"), layoutFacts.diagnostics);
  }
  stages.passed("layout-facts");

  const proofMir = dependencies.buildProofMir(
    layoutFactsToProofMirInput(layoutFacts.value, monomorphized.value, input.target),
  );
  if (proofMir.kind === "error") {
    return packagePipelineError(stages.failed("proof-mir"), proofMir.diagnostics);
  }
  stages.passed("proof-mir");

  const proofCheck = dependencies.checkProofAndResources(
    proofMirToCheckInput(proofMir.value, input.target),
  );
  if (proofCheck.kind === "error") {
    return packagePipelineError(stages.failed("proof-check"), proofCheck.diagnostics);
  }
  stages.passed("proof-check");

  const optIr = dependencies.buildOptimizedOptIr(
    proofCheckToOptimizedOptIrInput(proofCheck.value, proofMir.value, input.target),
  );
  if (optIr.kind === "error")
    return packagePipelineError(stages.failed("opt-ir"), optIr.diagnostics);
  stages.passed("opt-ir");

  return uefiAArch64Ok({
    value: Object.freeze({
      target: input.target,
      optIr: Object.freeze({
        program: optIr.value.program,
        operations: optIr.value.operations,
        facts: optIr.value.facts,
      }),
      semanticPlatformCatalogFingerprint: input.target.semanticPlatformCatalogFingerprint,
      proofMirRuntimeCatalogFingerprint: input.target.proofMirRuntimeCatalogFingerprint,
      stages: stages.records(),
    }),
    verification: passedVerification("uefi-aarch64-package-pipeline", "to-opt-ir"),
  });
}
```

The implementation must not hide a multi-stage call behind an unnamed helper. Every stage call above appears directly in `runUefiAArch64PackagePipelineToOptIr`. Small shape adapters such as `packageInputToModuleGraphParseInput`, `packageParsedGraphToHirInput`, and `proofCheckToOptimizedOptIrInput` are defined in this file and covered by focused tests.

- [ ] **Step 5: Run tests**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/package-pipeline.test.ts
```

Expected: pass.

## Task 12C: OptIR To PE Binary Spine Composition

**Description:** Compose the existing optimized OptIR, AArch64 lowering/backend, synthetic object providers, linker, and PE writer APIs into a binary-spine adapter. This task is where target-driver helper objects, firmware lowering, and the framed entry thunk become a linked PE/COFF EFI artifact input.

**Files:**

- Create: `src/target/uefi-aarch64/binary-spine.ts`
- Modify: `src/linker/aarch64/aarch64-entry-objects.ts`
- Test: `tests/integration/target/uefi-aarch64/binary-spine.test.ts`
- Test: `tests/integration/linker/aarch64-linked-image-layout.test.ts`
- Test: `tests/integration/pe-coff/aarch64-efi-writer.test.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- The adapter stages are explicit: `aarch64-lowering`, `aarch64-backend`, `runtime-helper-objects`, `synthetic-entry-object`, `linker`, and `pe-coff-writer`.
- It calls existing public APIs: `lowerOptIrToAArch64`, `compileAArch64Object`, `createAArch64UefiEntrySyntheticObjectProvider`, `linkAArch64Image`, and `writeAArch64PeCoffEfiImage`.
- It includes the entry thunk object and all materialized runtime helper objects in the link inputs, so helper symbols referenced by the thunk or platform lowerings resolve.
- Linked layout entry RVA resolves to `__wrela_uefi_entry`.
- The PE writer output retains machine `0xaa64` and subsystem `10`.

- [ ] **Step 1: Write failing binary-spine tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  runUefiAArch64BinarySpine,
  runUefiAArch64PackagePipelineToOptIr,
} from "../../../../src/target/uefi-aarch64";
import {
  uefiCompilePackageInputFixture,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI AArch64 binary spine", () => {
  test("links entry thunk and helper objects before writing PE", () => {
    const target = uefiTargetSurfaceFixture();
    const optIr = runUefiAArch64PackagePipelineToOptIr({
      packageInput: uefiCompilePackageInputFixture("success"),
      target,
    });
    expect(optIr.kind).toBe("ok");
    if (optIr.kind !== "ok") return;

    const result = runUefiAArch64BinarySpine({
      target,
      optIr: optIr.value,
      artifactName: "smoke.efi",
    });
    expect(result.kind).toBe("ok");
    if (result.kind === "ok") {
      expect(result.value.linkedLayout.entry.loaderEntrySymbol).toBe("__wrela_uefi_entry");
      expect(result.value.peCoffArtifact.artifactName).toBe("smoke.efi");
    }
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/binary-spine.test.ts
```

Expected: fail because binary-spine APIs are missing.

- [ ] **Step 3: Define binary-spine stage records**

```ts
export type UefiAArch64BinarySpineStageKey =
  | "aarch64-lowering"
  | "aarch64-backend"
  | "runtime-helper-objects"
  | "synthetic-entry-object"
  | "linker"
  | "pe-coff-writer";

export interface UefiAArch64BinarySpineOutput {
  readonly stages: readonly UefiAArch64StageRecord<UefiAArch64BinarySpineStageKey>[];
  readonly backendObjects: readonly AArch64LinkInputModule[];
  readonly helperObjects: readonly AArch64LinkInputModule[];
  readonly linkedLayout: AArch64LinkedImageLayout;
  readonly peCoffArtifact: PeCoffEfiImageArtifact;
  readonly entryThunkFingerprint: string;
}

export interface RunUefiAArch64BinarySpineInput {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly optIr: UefiAArch64PackageOptIrPipelineOutput;
  readonly artifactName?: string;
}
```

- [ ] **Step 4: Implement the binary-spine adapter**

```ts
export function runUefiAArch64BinarySpine(
  input: RunUefiAArch64BinarySpineInput,
): UefiAArch64TargetResult<UefiAArch64BinarySpineOutput> {
  const stages = createUefiAArch64StageRecorder<UefiAArch64BinarySpineStageKey>();
  const lowered = lowerOptIrToAArch64({
    program: input.optIr.optIr.program,
    operations: input.optIr.optIr.operations,
    facts: input.optIr.optIr.facts,
    target: selectAArch64TargetSurface(input.target),
    options: {
      firmwarePlatformCalls: aarch64FirmwarePlatformCallContextFromUefiTarget(input.target),
    },
  });
  if (lowered.kind === "error") return binarySpineError("aarch64-lowering", lowered.diagnostics);
  stages.passed("aarch64-lowering");

  const object = compileAArch64Object({
    machineProgram: lowered.machineProgram,
    preservedFacts: lowered.preservedFacts,
    provenance: lowered.provenance,
    target: selectBackendTargetSurface(input.target),
    closedImagePlan: closedImagePlanForUefiTarget(input.target),
  });
  if (object.kind === "error") return binarySpineError("aarch64-backend", object.diagnostics);
  stages.passed("aarch64-backend");

  const helperObjects = materializeUefiAArch64RuntimeHelperObjects({
    target: input.target,
    runtimeMaterializations: input.target.runtimeMaterializations,
  });
  if (helperObjects.kind === "error") {
    return binarySpineError("runtime-helper-objects", helperObjects.diagnostics);
  }
  stages.passed("runtime-helper-objects");

  const entryProvider = createAArch64UefiEntrySyntheticObjectProvider({
    factory: createUefiAArch64EntryThunkObjectFactory({
      entryProfile: input.target.entryProfile,
      backendTarget: selectBackendTargetSurface(input.target),
    }),
  });
  stages.passed("synthetic-entry-object");

  const linkedLayout = linkAArch64Image({
    target: selectLinkerTargetSurface(input.target),
    objectModules: [
      {
        moduleKey: "wrela-source-object",
        objectModule: object.objectModule,
      },
      ...helperObjects.value.modules,
    ],
    entry: { wrelaBootLinkageName: input.target.entryProfile.bootFunctionSymbol },
    syntheticObjects: [entryProvider],
  });
  if (linkedLayout.kind === "error") return binarySpineError("linker", linkedLayout.diagnostics);
  stages.passed("linker");

  const peCoffArtifact = writeAArch64PeCoffEfiImage({
    artifactName: input.artifactName,
    layout: linkedLayout.layout,
    target: selectPeCoffWriterTargetSurface(input.target),
  });
  if (peCoffArtifact.kind === "error")
    return binarySpineError("pe-coff-writer", peCoffArtifact.diagnostics);
  stages.passed("pe-coff-writer");

  return uefiAArch64Ok({
    value: Object.freeze({
      stages: stages.records(),
      backendObjects: [{ moduleKey: "wrela-source-object", objectModule: object.objectModule }],
      helperObjects: helperObjects.value.modules,
      linkedLayout: linkedLayout.layout,
      peCoffArtifact: peCoffArtifact.artifact,
      entryThunkFingerprint: fingerprintUefiAArch64EntryThunk(input.target.entryProfile),
    }),
    verification: passedVerification("uefi-aarch64-binary-spine", "opt-ir-to-pe"),
  });
}
```

- [ ] **Step 5: Run binary-spine, linker, and PE writer tests**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/binary-spine.test.ts tests/integration/linker/aarch64-linked-image-layout.test.ts tests/integration/pe-coff/aarch64-efi-writer.test.ts
```

Expected: pass.

## Task 12: compileUefiAArch64Image Orchestration

**Description:** Add the public target-driver orchestration API by composing the already explicit package pipeline from Task 12B and binary spine from Task 12C. This task authenticates the target surface, runs the two adapters, optionally writes the artifact sink, and returns target metadata plus verification summaries.

**Files:**

- Create: `src/target/uefi-aarch64/compile-uefi-aarch64-image.ts`
- Modify: `src/target/uefi-aarch64/artifact.ts`
- Modify: `src/target/uefi-aarch64/index.ts`
- Modify: `src/target/index.ts`
- Modify: `src/index.ts`
- Test: `tests/integration/target/uefi-aarch64/compile-uefi-aarch64-image.test.ts`
- Test: `tests/integration/pe-coff/aarch64-efi-writer.test.ts`
- Test: `tests/integration/public-api.test.ts`

**Acceptance Criteria:**

- The public API shape matches the design.
- The target-driver authentication stage runs before `runUefiAArch64PackagePipelineToOptIr`.
- Failed results include all passed stages and one failed stage.
- Successful results include the PE/COFF artifact, target metadata, diagnostics, and verification summary.
- Linked layout and PE/COFF invariants are delegated to Task 12C and rechecked in the integration test.
- Artifact sink errors return `UEFI_AARCH64_ARTIFACT_SINK_FAILED` without throwing.
- Final image bytes are deterministic for identical inputs.

- [ ] **Step 1: Write failing orchestration tests with fakes**

```ts
import { describe, expect, test } from "bun:test";
import { compileUefiAArch64Image } from "../../../../src/target/uefi-aarch64";
import {
  uefiCompilePackageInputFixture,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("compileUefiAArch64Image", () => {
  test("compiles a tiny package to a deterministic EFI artifact", () => {
    const input = {
      packageInput: uefiCompilePackageInputFixture("success"),
      target: uefiTargetSurfaceFixture(),
      artifactName: "smoke.efi",
      smoke: { kind: "disabled" as const },
    };

    const first = compileUefiAArch64Image(input);
    const second = compileUefiAArch64Image(input);

    expect(first.kind).toBe("ok");
    expect(second.kind).toBe("ok");
    if (first.kind === "ok" && second.kind === "ok") {
      expect(first.artifact.artifactName).toBe("smoke.efi");
      expect(first.artifact.peCoffArtifact.bytes).toEqual(second.artifact.peCoffArtifact.bytes);
      expect(first.artifact.targetMetadata.schema).toBe("wrela.uefi-aarch64-image");
      expect(first.artifact.targetMetadata.targetDriverFingerprint).toBe(
        second.artifact.targetMetadata.targetDriverFingerprint,
      );
    }
  });

  test("fails before pipeline stages when target authentication fails", () => {
    const result = compileUefiAArch64Image({
      packageInput: uefiCompilePackageInputFixture("success"),
      target: { ...uefiTargetSurfaceFixture(), targetKey: "wrong" as never },
      smoke: { kind: "disabled" },
    });

    expect(result.kind).toBe("error");
    expect(result.diagnostics[0]?.code).toBe("UEFI_AARCH64_TARGET_AUTH_FAILED");
    expect(result.verification.runs.map((run) => run.runKey)).toContain(
      "target-driver-authenticate",
    );
  });
});
```

```ts
import { describe, expect, test } from "bun:test";
import * as wrela from "../../src";

describe("public API", () => {
  test("exports the real UEFI AArch64 compile API", () => {
    expect(typeof wrela.compileUefiAArch64Image).toBe("function");
    expect(typeof wrela.target.uefiAarch64.compileUefiAArch64Image).toBe("function");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/compile-uefi-aarch64-image.test.ts
```

Expected: fail because real orchestration is missing.

- [ ] **Step 3: Define public API input/output types**

```ts
export interface CompileUefiAArch64ImageInput {
  readonly packageInput: CompilerPackageInput;
  readonly target?: UefiAArch64TargetDriverSurfaceInput;
  readonly artifactName?: string;
  readonly output?: UefiAArch64ArtifactSink;
  readonly smoke?: UefiAArch64SmokeRequest;
}

export type CompileUefiAArch64ImageResult =
  | {
      readonly kind: "ok";
      readonly artifact: UefiAArch64ImageArtifact;
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
      readonly verification: UefiAArch64TargetVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly UefiAArch64TargetDiagnostic[];
      readonly verification: UefiAArch64TargetVerificationSummary;
    };
```

- [ ] **Step 4: Export the compile API from the target-driver barrels**

```ts
export * from "./artifact";
export * from "./diagnostics";
export * from "./result";
export * from "./target-driver-surface";
export * from "./compile-uefi-aarch64-image";
```

```ts
export * from "./target/uefi-aarch64";
```

- [ ] **Step 5: Implement orchestration stages**

```ts
const UEFI_AARCH64_ORCHESTRATION_STAGES = [
  "target-driver-authenticate",
  "target-catalogs",
  "frontend",
  "semantic",
  "hir",
  "monomorphization",
  "layout-facts",
  "proof-mir",
  "proof-check",
  "opt-ir",
  "aarch64-lowering",
  "aarch64-backend",
  "synthetic-entry-object",
  "linker",
  "pe-coff-writer",
  "artifact-sink",
  "qemu-smoke",
] as const;
```

```ts
export function compileUefiAArch64Image(
  input: CompileUefiAArch64ImageInput,
): CompileUefiAArch64ImageResult {
  const verification = createUefiAArch64VerificationRecorder();

  const target = authenticateUefiAArch64TargetDriverSurface(
    input.target ?? canonicalUefiAArch64TargetDriverSurfaceInput(),
  );
  if (target.kind === "error") {
    return compileError({
      diagnostics: target.diagnostics,
      verification: verification.failed("target-driver-authenticate"),
    });
  }
  verification.passed("target-driver-authenticate");

  const packagePipeline = runUefiAArch64PackagePipelineToOptIr({
    packageInput: input.packageInput,
    target: target.value,
  });
  if (packagePipeline.kind === "error") {
    return compileError({
      diagnostics: packagePipeline.diagnostics,
      verification: verification.failed("package-pipeline"),
    });
  }

  const binarySpine = runUefiAArch64BinarySpine({
    target: target.value,
    optIr: packagePipeline.value,
    artifactName: input.artifactName,
  });
  if (binarySpine.kind === "error") {
    return compileError({
      diagnostics: binarySpine.diagnostics,
      verification: verification.failed("binary-spine"),
    });
  }

  return finalizeUefiAArch64Artifact({
    input,
    target: target.value,
    packagePipeline: packagePipeline.value,
    binarySpine: binarySpine.value,
    verification,
  });
}
```

`finalizeUefiAArch64Artifact` is a small metadata/sink function in this file; it must not call lower compiler phases.

- [ ] **Step 6: Add artifact metadata construction**

```ts
export function createUefiAArch64TargetMetadata(input: {
  readonly target: UefiAArch64TargetDriverSurface;
  readonly entryThunkFingerprint: string;
  readonly peCoffArtifact: PeCoffEfiImageArtifact;
}): UefiAArch64TargetMetadata {
  return Object.freeze({
    schema: "wrela.uefi-aarch64-image",
    schemaVersion: 1,
    targetDriverFingerprint: input.target.targetDriverFingerprint,
    aarch64TargetFingerprint: input.target.aarch64TargetFingerprint,
    backendTargetFingerprint: input.target.backendTargetFingerprint,
    linkerTargetFingerprint: input.target.linkerTargetFingerprint,
    peCoffWriterTargetFingerprint: input.target.peCoffWriterTargetFingerprint,
    semanticPlatformCatalogFingerprint: input.target.semanticPlatformCatalogFingerprint,
    proofMirRuntimeCatalogFingerprint: input.target.proofMirRuntimeCatalogFingerprint,
    entryThunkFingerprint: input.entryThunkFingerprint,
    firmwareAbiFingerprint: fingerprintUefiAArch64FirmwareAbi(input.target.firmwareAbi),
    statusPolicyFingerprint: fingerprintUefiAArch64StatusPolicy(input.target.statusPolicy),
    watchdogPolicyFingerprint: fingerprintUefiAArch64WatchdogPolicy(input.target.watchdogPolicy),
    peCoffImageFingerprint: input.peCoffArtifact.deterministicMetadata.imageFingerprint,
    finalImageFingerprint: fingerprintUefiAArch64ImageBytes(input.peCoffArtifact.bytes),
  });
}

export function fingerprintUefiAArch64ImageBytes(bytes: readonly number[]): string {
  const hex = bytes.map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `uefi-aarch64-image-bytes:${stableHash(hex)}`;
}
```

- [ ] **Step 7: Run orchestration and PE writer tests**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/compile-uefi-aarch64-image.test.ts tests/integration/pe-coff/aarch64-efi-writer.test.ts tests/integration/public-api.test.ts
```

Expected: pass.

## Task 13: Toolchain Stdlib Source Root And Source Fixtures

**Description:** Add the canonical toolchain stdlib source root at `stdlib/wrela-std`, wire the compiler edge so this root is included by default for the UEFI target, and prove an ejected copy under project `src/wrela-std` has no special authority. The stdlib contains ordinary Wrela source wrappers and `platform fn` declarations; the compiler-owned authority remains the certified target catalog.

**Files:**

- Create: `stdlib/wrela-std/core/unit.wr`
- Create: `stdlib/wrela-std/core/result.wr`
- Create: `stdlib/wrela-std/target/uefi/console.wr`
- Create: `stdlib/wrela-std/target/uefi/status.wr`
- Create: `stdlib/wrela-std/target/uefi/watchdog.wr`
- Create: `stdlib/wrela-std/target/uefi/memory.wr`
- Modify: `src/target/uefi-aarch64/package-input.ts`
- Modify: `tests/support/target/uefi-aarch64/uefi-aarch64-fixtures.ts`
- Create: `tests/fixtures/uefi-aarch64/smoke-basic/wrela.toml`
- Create: `tests/fixtures/uefi-aarch64/smoke-basic/src/image.wr`
- Create: `tests/fixtures/uefi-aarch64/smoke-ejected-stdlib/wrela.toml`
- Create: `tests/fixtures/uefi-aarch64/smoke-ejected-stdlib/src/image.wr`
- Create: `tests/fixtures/uefi-aarch64/smoke-direct-platform/wrela.toml`
- Create: `tests/fixtures/uefi-aarch64/smoke-direct-platform/src/image.wr`
- Test: `tests/integration/target/uefi-aarch64/stdlib-source-root.test.ts`
- Modify: `docs/design/uefi-aarch64-target-driver-design.md`
- Modify: `docs/design/compiler-pipeline-design.md`

**Acceptance Criteria:**

- Default UEFI compile includes the toolchain source root `stdlib/wrela-std`.
- Project ejected copy lives under `src/wrela-std` and is imported as ordinary project source.
- Direct project `platform fn` declarations can certify against the same target primitive IDs without importing the shipped stdlib.
- No code grants authority based on the path `stdlib/wrela-std` or `src/wrela-std`.
- Smoke fixture prints `WRELA_UEFI_SMOKE_OK\r\n` through the stdlib UEFI console wrapper.
- Docs state the repo-maintained stdlib location and ejected project location.
- `wrela.toml` fixture files are not parsed in v1; tests call `packageInputFromFixtureProject` with explicit target/source-root options from `package-input.ts`.

- [ ] **Step 1: Write failing stdlib source-root tests**

```ts
import { describe, expect, test } from "bun:test";
import { compileUefiAArch64Image } from "../../../../src/target/uefi-aarch64";
import {
  packageInputFromFixtureProject,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI stdlib source root", () => {
  test("compiles smoke-basic with toolchain stdlib source root", () => {
    const result = compileUefiAArch64Image({
      packageInput: packageInputFromFixtureProject("tests/fixtures/uefi-aarch64/smoke-basic"),
      target: uefiTargetSurfaceFixture(),
      smoke: { kind: "disabled" },
    });

    expect(result.kind).toBe("ok");
  });

  test("compiles with ejected stdlib under src/wrela-std", () => {
    const result = compileUefiAArch64Image({
      packageInput: packageInputFromFixtureProject(
        "tests/fixtures/uefi-aarch64/smoke-ejected-stdlib",
      ),
      target: uefiTargetSurfaceFixture(),
      smoke: { kind: "disabled" },
    });

    expect(result.kind).toBe("ok");
  });

  test("direct project platform fn declarations have the same certification path", () => {
    const result = compileUefiAArch64Image({
      packageInput: packageInputFromFixtureProject(
        "tests/fixtures/uefi-aarch64/smoke-direct-platform",
      ),
      target: uefiTargetSurfaceFixture(),
      smoke: { kind: "disabled" },
    });

    expect(result.kind).toBe("ok");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/stdlib-source-root.test.ts
```

Expected: fail because stdlib sources and source-root integration are missing.

- [ ] **Step 3: Add Wrela stdlib source examples**

```wrela
// stdlib/wrela-std/core/unit.wr
module wrela_std.core.unit

pub type Unit = ()
```

```wrela
// stdlib/wrela-std/core/result.wr
module wrela_std.core.result

pub enum Result[Ok, Err] {
  Ok(Ok)
  Err(Err)
}
```

```wrela
// stdlib/wrela-std/target/uefi/status.wr
module wrela_std.target.uefi.status

pub enum UefiStatus {
  success
  load_error
  invalid_parameter
  unsupported
  buffer_too_small
  device_error
  aborted
  security_violation
}
```

```wrela
// stdlib/wrela-std/target/uefi/console.wr
module wrela_std.target.uefi.console

platform fn output_string(message: Utf16Static) -> UefiStatus

pub fn write_smoke_marker() -> UefiStatus {
  output_string(utf16_static("WRELA_UEFI_SMOKE_OK\r\n"))
}
```

```wrela
// stdlib/wrela-std/target/uefi/watchdog.wr
module wrela_std.target.uefi.watchdog

platform fn set_watchdog_timer(timeout_seconds: U64) -> UefiStatus

pub fn disable_watchdog() -> UefiStatus {
  set_watchdog_timer(0)
}
```

```wrela
// stdlib/wrela-std/target/uefi/memory.wr
module wrela_std.target.uefi.memory

platform fn exit_boot_services_with_fresh_map() -> UefiStatus
```

```wrela
// tests/fixtures/uefi-aarch64/smoke-basic/src/image.wr
module image

import wrela_std.target.uefi.console.write_smoke_marker

image fn boot() -> Unit {
  write_smoke_marker()
}
```

Before writing these files, run `bun test tests/integration/frontend/parser/happy-snippets.test.ts tests/integration/frontend/parser/source-file.test.ts` and copy the existing module/import/function/image-entry spelling from those parser fixtures. Preserve these semantics exactly: import wrapper, call certified console primitive, return success.

- [ ] **Step 4: Wire toolchain source root selection**

```ts
export interface UefiAArch64StdlibSourceRoot {
  readonly rootKey: "toolchain-wrela-std";
  readonly path: "stdlib/wrela-std";
  readonly trustedForAuthority: false;
}

export function defaultUefiAArch64SourceRoots(input: {
  readonly projectSourceRoot: string;
  readonly stdlibMode?: "toolchain" | "project-ejected" | "none";
}): readonly CompilerSourceRoot[] {
  if (input.stdlibMode === "none") {
    return [
      {
        kind: "project",
        rootKey: "project",
        rootPath: input.projectSourceRoot,
        trustedForAuthority: false,
      },
    ];
  }
  if (input.stdlibMode === "project-ejected") {
    return [
      {
        kind: "project",
        rootKey: "project",
        rootPath: input.projectSourceRoot,
        trustedForAuthority: false,
      },
      {
        kind: "project",
        rootKey: "project-wrela-std",
        rootPath: `${input.projectSourceRoot}/wrela-std`,
        trustedForAuthority: false,
      },
    ];
  }
  return [
    {
      kind: "project",
      rootKey: "project",
      rootPath: input.projectSourceRoot,
      trustedForAuthority: false,
    },
    {
      kind: "toolchain",
      rootKey: "toolchain-wrela-std",
      rootPath: "stdlib/wrela-std",
      trustedForAuthority: false,
    },
  ];
}
```

- [ ] **Step 5: Update docs**

Add to `docs/design/uefi-aarch64-target-driver-design.md` and `docs/design/compiler-pipeline-design.md`:

```md
The canonical stdlib source maintained by this repository lives at
`stdlib/wrela-std`. For normal compilation the compiler edge adds that tree as
a toolchain source root. Users may eject a copy under project `src/wrela-std`,
but both trees are ordinary source. Target authority still comes only from
certified `platform fn` declarations matched to the selected target surface.
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/stdlib-source-root.test.ts
```

Expected: pass.

## Task 14: QEMU Smoke Command Planner And Fake Runner

**Description:** Implement the pure QEMU smoke command planner and fake runner classification. The planner creates a temporary ESP layout containing `EFI/BOOT/BOOTAA64.EFI`, configures AArch64 `qemu-system-aarch64` for `virt` with AAVMF/ArmVirtPkg firmware, and treats marker observation plus harness-owned termination as the default success condition.

**Files:**

- Create: `src/target/uefi-aarch64/qemu-smoke.ts`
- Create: `tests/support/target/uefi-aarch64/fake-qemu-runner.ts`
- Test: `tests/unit/target/uefi-aarch64/qemu-smoke.test.ts`
- Modify: `src/target/uefi-aarch64/artifact.ts`
- Modify: `src/target/uefi-aarch64/index.ts`

**Acceptance Criteria:**

- `UefiAArch64SmokeRequest` and `UefiAArch64QemuSmokeConfig` match the design.
- Planner requires explicit QEMU and firmware paths for non-skip requested smoke unless discovery is injected by config.
- Planner writes image path as `EFI/BOOT/BOOTAA64.EFI` for direct fallback-boot smoke runs.
- When `uefiShellSuccessMarker` is requested, planner writes the image at
  `EFI/WRELA/SMOKEAA64.EFI` and writes root `startup.nsh`; EDK2 BDS does not
  fall through to Shell after a successful default-path `BOOTAA64.EFI` start.
- The Shell script runs the smoke image and emits the expected marker only when
  `%lasterror% == 0`, so the marker is causally tied to `StartImage` returning
  success rather than to QEMU merely reaching Shell.
- `uefiShellSuccessMarker.marker` is automatically included in the observed
  marker set; callers do not need to duplicate it in `expectedConsoleMarkers`.
- Command includes `-machine virt`, AArch64 CPU, memory, `-serial mon:stdio`, `-display none`, read-only pflash firmware code, and FAT ESP drive. It includes writable efivars pflash only when `firmwareVarsTemplatePath` is configured and copied by the host runner.
- Fake runner passes when all markers appear and termination is `kill-after-marker`.
- Fake runner fails on timeout, missing marker, process cleanup failure, or missing tools when `allowSkip` is false.
- QEMU output never feeds image byte generation.

**Implementation finding:** The current package-pipeline smoke dependency is an
optimized-OptIR fixture, not a full source-to-OptIR lowering of
`tests/fixtures/uefi-aarch64/smoke-basic/src/image.wr`. The previous fixture
returned source result code `2`, which the entry bridge correctly converted to
`EFI_INVALID_PARAMETER`; real EDK2 reported `StartImage` failure. The smoke
fixture now uses a unit-success image entry, while the real QEMU marker is
emitted by `startup.nsh` after Shell observes `%lasterror% == 0`.

- [ ] **Step 1: Write failing QEMU smoke tests**

```ts
import { describe, expect, test } from "bun:test";
import {
  classifyUefiAArch64QemuSmokeRun,
  planUefiAArch64QemuSmokeCommand,
} from "../../../../src/target/uefi-aarch64";
import { fakeQemuRunnerOutput } from "../../../support/target/uefi-aarch64/fake-qemu-runner";

describe("UEFI AArch64 QEMU smoke", () => {
  test("plans ESP boot path and AArch64 firmware command", () => {
    const plan = planUefiAArch64QemuSmokeCommand({
      artifactName: "smoke.efi",
      artifactBytes: [0x4d, 0x5a],
      tempDirectory: "/tmp/wrela-smoke",
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        termination: "kill-after-marker",
      },
      config: {
        qemuSystemAarch64Path: "/usr/bin/qemu-system-aarch64",
        firmwareCodePath: "/usr/share/AAVMF/AAVMF_CODE.fd",
        firmwareVarsTemplatePath: "/usr/share/AAVMF/AAVMF_VARS.fd",
        machine: "virt",
        cpu: "cortex-a76",
        memoryMiB: 512,
        accel: "tcg",
      },
    });

    expect(plan.kind).toBe("ok");
    if (plan.kind === "ok") {
      expect(plan.value.espImagePath).toBe("/tmp/wrela-smoke/EFI/BOOT/BOOTAA64.EFI");
      expect(plan.value.args).toContain("-machine");
      expect(plan.value.args).toContain("virt,virtualization=off,pflash0=rom,pflash1=efivars");
    }
  });

  test("classifies marker observation plus harness termination as success", () => {
    const report = classifyUefiAArch64QemuSmokeRun({
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        termination: "kill-after-marker",
      },
      output: fakeQemuRunnerOutput({
        stdout: "Booting...\nWRELA_UEFI_SMOKE_OK\r\n",
        terminatedByHarness: true,
      }),
    });

    expect(report.status).toBe("passed");
  });

  test("fails when process cleanup fails after marker observation", () => {
    const report = classifyUefiAArch64QemuSmokeRun({
      request: {
        kind: "qemu",
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        termination: "kill-after-marker",
      },
      output: fakeQemuRunnerOutput({
        stdout: "WRELA_UEFI_SMOKE_OK\r\n",
        terminatedByHarness: true,
        cleanupFailed: true,
      }),
    });

    expect(report.status).toBe("failed");
    expect(report.stableDetail).toBe("qemu-smoke:cleanup-failed");
  });
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/qemu-smoke.test.ts
```

Expected: fail because QEMU smoke APIs are missing.

- [ ] **Step 3: Implement smoke request, config, report, and command plan types**

```ts
export interface UefiAArch64SmokeRequest {
  readonly kind: "disabled" | "qemu";
  readonly allowSkip?: boolean;
  readonly timeoutMs?: number;
  readonly expectedConsoleMarkers?: readonly string[];
  readonly termination?: "kill-after-marker" | "wait-for-firmware-exit";
}

export interface UefiAArch64QemuSmokeConfig {
  readonly qemuSystemAarch64Path: string;
  readonly firmwareCodePath: string;
  readonly firmwareVarsTemplatePath?: string;
  readonly machine: "virt";
  readonly cpu: "cortex-a76" | "max";
  readonly memoryMiB: number;
  readonly accel: "tcg" | "hvf" | "kvm";
}
```

- [ ] **Step 4: Implement pure command planning**

```ts
export function planUefiAArch64QemuSmokeCommand(
  input: PlanUefiAArch64QemuSmokeCommandInput,
): UefiAArch64TargetResult<UefiAArch64QemuSmokeCommandPlan> {
  const espImagePath = `${input.tempDirectory}/EFI/BOOT/BOOTAA64.EFI`;
  const varsPath =
    input.config.firmwareVarsTemplatePath === undefined
      ? undefined
      : `${input.tempDirectory}/AAVMF_VARS.fd`;
  const pflashMachine =
    varsPath === undefined
      ? "virt,virtualization=off,pflash0=rom"
      : "virt,virtualization=off,pflash0=rom,pflash1=efivars";
  const varsBlockdev =
    varsPath === undefined
      ? []
      : ["-blockdev", `node-name=efivars,driver=file,filename=${varsPath}`];

  return uefiAArch64Ok({
    value: Object.freeze({
      espImagePath,
      firmwareVarsPath: varsPath,
      executable: input.config.qemuSystemAarch64Path,
      args: Object.freeze([
        "-machine",
        pflashMachine,
        "-cpu",
        input.config.cpu,
        "-accel",
        input.config.accel,
        "-m",
        String(input.config.memoryMiB),
        "-serial",
        "mon:stdio",
        "-display",
        "none",
        "-blockdev",
        `node-name=rom,driver=file,filename=${input.config.firmwareCodePath},read-only=true`,
        ...varsBlockdev,
        "-drive",
        `if=none,id=esp,format=raw,file=fat:rw:${input.tempDirectory}`,
        "-device",
        "virtio-blk-device,drive=esp",
      ]),
    }),
    verification: passedVerification("uefi-aarch64-qemu-smoke", "plan-command"),
  });
}
```

- [ ] **Step 5: Implement fake runner classifier**

```ts
export function classifyUefiAArch64QemuSmokeRun(input: {
  readonly request: UefiAArch64SmokeRequest;
  readonly output: UefiAArch64QemuRunnerOutput;
}): UefiAArch64SmokeReport {
  const markers = input.request.expectedConsoleMarkers ?? [];
  const combinedOutput = `${input.output.stdout}\n${input.output.stderr}`;
  const missingMarkers = markers.filter((marker) => !combinedOutput.includes(marker));

  if (input.output.timedOut) {
    return smokeReport("failed", "qemu-smoke:timeout");
  }
  if (input.output.cleanupFailed) {
    return smokeReport("failed", "qemu-smoke:cleanup-failed");
  }
  if (missingMarkers.length > 0) {
    return smokeReport("failed", `qemu-smoke:missing-markers:${missingMarkers.join(",")}`);
  }
  if (input.request.termination !== "wait-for-firmware-exit" && !input.output.terminatedByHarness) {
    return smokeReport("failed", "qemu-smoke:harness-termination-missing");
  }
  return smokeReport("passed", "qemu-smoke:markers-observed");
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64/qemu-smoke.test.ts
```

Expected: pass.

## Task 15: Optional Real QEMU/AAVMF Smoke Command

**Description:** Add the host-effectful post-compile smoke runner and explicit command/script for real QEMU/AAVMF execution. `compileUefiAArch64Image` remains synchronous and deterministic; this runner consumes an already produced artifact and attaches or prints a smoke report outside byte generation.

**Files:**

- Modify: `src/target/uefi-aarch64/qemu-smoke.ts`
- Create: `scripts/smoke-uefi-aarch64.ts`
- Modify: `package.json`
- Test: `tests/integration/target/uefi-aarch64/qemu-ovmf-smoke.test.ts`
- Modify: `docs/design/uefi-aarch64-target-driver-design.md`

**Acceptance Criteria:**

- `bun run smoke:uefi-aarch64` exists.
- The real smoke runner reads only documented environment variables: `WRELA_QEMU_AARCH64`, `WRELA_QEMU_AARCH64_EFI_CODE`, `WRELA_QEMU_AARCH64_EFI_VARS_TEMPLATE`, and `WRELA_UEFI_AARCH64_SMOKE_EFI`.
- `scripts/smoke-uefi-aarch64.ts` consumes the prebuilt EFI image from `WRELA_UEFI_AARCH64_SMOKE_EFI`; it does not invoke source compilation.
- Missing tools produce a skipped report when `allowSkip: true` and an error when `allowSkip: false`.
- Runner creates and cleans a temporary ESP directory through an injected host-effects interface.
- Runner copies firmware vars template when configured.
- Runner terminates QEMU after marker observation by default.
- `runUefiAArch64QemuSmoke` is async and separate from `compileUefiAArch64Image`; smoke output never mutates artifact bytes or target metadata.
- The default `bun run agent:check` does not require QEMU or firmware files.

- [ ] **Step 1: Write skipped integration test**

```ts
import { describe, expect, test } from "bun:test";
import {
  compileUefiAArch64Image,
  qemuSmokeConfigFromEnvironment,
  runUefiAArch64QemuSmoke,
} from "../../../../src/target/uefi-aarch64";
import {
  packageInputFromFixtureProject,
  uefiTargetSurfaceFixture,
} from "../../../support/target/uefi-aarch64/uefi-aarch64-fixtures";

describe("UEFI AArch64 real QEMU smoke", () => {
  test("runs smoke-basic when QEMU and AAVMF are configured", async () => {
    const config = qemuSmokeConfigFromEnvironment(process.env);
    if (config.kind === "skipped") {
      expect(config.stableDetail).toStartWith("qemu-smoke:missing-env:");
      return;
    }

    const result = compileUefiAArch64Image({
      packageInput: packageInputFromFixtureProject("tests/fixtures/uefi-aarch64/smoke-basic"),
      target: uefiTargetSurfaceFixture(),
      smoke: { kind: "disabled" },
    });

    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;

    const smoke = await runUefiAArch64QemuSmoke({
      artifact: result.artifact,
      request: {
        kind: "qemu",
        allowSkip: false,
        expectedConsoleMarkers: ["WRELA_UEFI_SMOKE_OK"],
        termination: "kill-after-marker",
        timeoutMs: 15000,
      },
      config: config.config,
      hostEffects: nodeUefiAArch64QemuHostEffects(),
    });

    expect(smoke.status).toBe("passed");
  }, 30000);
});
```

The direct `process.env` read is allowed only in this integration test and host-effect script. Pure target modules receive an injected environment object.

- [ ] **Step 2: Run the integration test without QEMU configured**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/qemu-ovmf-smoke.test.ts
```

Expected: pass with a skipped branch when environment variables are absent.

- [ ] **Step 3: Implement environment config reader and host runner**

```ts
export function qemuSmokeConfigFromEnvironment(
  environment: Record<string, string | undefined>,
):
  | { readonly kind: "ok"; readonly config: UefiAArch64QemuSmokeConfig }
  | { readonly kind: "skipped"; readonly stableDetail: string } {
  const qemuSystemAarch64Path = environment.WRELA_QEMU_AARCH64;
  const firmwareCodePath = environment.WRELA_QEMU_AARCH64_EFI_CODE;

  if (qemuSystemAarch64Path === undefined || qemuSystemAarch64Path.length === 0) {
    return { kind: "skipped", stableDetail: "qemu-smoke:missing-env:WRELA_QEMU_AARCH64" };
  }
  if (firmwareCodePath === undefined || firmwareCodePath.length === 0) {
    return { kind: "skipped", stableDetail: "qemu-smoke:missing-env:WRELA_QEMU_AARCH64_EFI_CODE" };
  }

  return {
    kind: "ok",
    config: {
      qemuSystemAarch64Path,
      firmwareCodePath,
      firmwareVarsTemplatePath: environment.WRELA_QEMU_AARCH64_EFI_VARS_TEMPLATE,
      machine: "virt",
      cpu: "cortex-a76",
      memoryMiB: 512,
      accel: "tcg",
    },
  };
}
```

```ts
export interface UefiAArch64QemuHostEffects {
  readonly createTempDirectory: (prefix: string) => Promise<string>;
  readonly writeFile: (path: string, bytes: readonly number[]) => Promise<void>;
  readonly copyFile: (sourcePath: string, targetPath: string) => Promise<void>;
  readonly runProcess: (
    command: UefiAArch64QemuSmokeCommandPlan,
    timeoutMs: number,
  ) => Promise<UefiAArch64QemuRunnerOutput>;
  readonly removeDirectory: (path: string) => Promise<void>;
}
```

```ts
export async function runUefiAArch64QemuSmoke(input: {
  readonly artifact: UefiAArch64ImageArtifact;
  readonly request: Extract<UefiAArch64SmokeRequest, { readonly kind: "qemu" }>;
  readonly config: UefiAArch64QemuSmokeConfig;
  readonly hostEffects: UefiAArch64QemuHostEffects;
}): Promise<UefiAArch64SmokeReport> {
  const tempDirectory = await input.hostEffects.createTempDirectory("wrela-uefi-aarch64-");
  try {
    const command = planUefiAArch64QemuSmokeCommand({
      artifactName: input.artifact.artifactName,
      artifactBytes: input.artifact.peCoffArtifact.bytes,
      tempDirectory,
      request: input.request,
      config: input.config,
    });
    if (command.kind === "error")
      return smokeReport(
        "failed",
        command.diagnostics[0]?.stableDetail ?? "qemu-smoke:plan-failed",
      );

    await input.hostEffects.writeFile(
      command.value.espImagePath,
      input.artifact.peCoffArtifact.bytes,
    );
    if (
      input.config.firmwareVarsTemplatePath !== undefined &&
      command.value.firmwareVarsPath !== undefined
    ) {
      await input.hostEffects.copyFile(
        input.config.firmwareVarsTemplatePath,
        command.value.firmwareVarsPath,
      );
    }
    const output = await input.hostEffects.runProcess(
      command.value,
      input.request.timeoutMs ?? 15000,
    );
    return classifyUefiAArch64QemuSmokeRun({ request: input.request, output });
  } finally {
    await input.hostEffects.removeDirectory(tempDirectory);
  }
}
```

- [ ] **Step 4: Add package script**

```json
{
  "scripts": {
    "smoke:uefi-aarch64": "bun scripts/smoke-uefi-aarch64.ts"
  }
}
```

Preserve existing package scripts exactly and add this one entry.

- [ ] **Step 5: Run smoke command in skip mode**

Run:

```bash
bun run smoke:uefi-aarch64
```

Expected when environment variables are absent: exit `0` with a message containing `qemu-smoke:missing-env`.

- [ ] **Step 6: Run integration test**

Run:

```bash
bun test tests/integration/target/uefi-aarch64/qemu-ovmf-smoke.test.ts
```

Expected: pass in skipped mode or pass with real QEMU when configured.

## Task 16: Audit, Determinism, Public Exports, And Final Verification

**Description:** Add import-boundary and TCB audit tests, policy checks for pure modules, final determinism coverage, and public export checks. This task closes the feature by proving the target driver remains an edge orchestration layer and does not let trusted UEFI data drift into self-validating tests.

**Files:**

- Create: `tests/audit/uefi-aarch64-target-driver-audit.test.ts`
- Modify: `scripts/check-policy.ts`
- Modify: `tests/integration/public-api.test.ts`
- Test: `tests/integration/target/uefi-aarch64/compile-uefi-aarch64-image.test.ts`
- Test: `tests/audit/uefi-aarch64-target-driver-audit.test.ts`

**Acceptance Criteria:**

- Earlier phases do not import `src/target/uefi-aarch64/**`.
- Pure target-driver files do not import host-effect APIs.
- Host-effect imports are isolated to `qemu-smoke.ts`, `scripts/smoke-uefi-aarch64.ts`, and test files.
- No UEFI table/status/GUID test imports production data as its golden fixture.
- No linker file contains UEFI entry-thunk instruction bytes.
- Public API exports all intended pure helpers and the compile API.
- Two identical compile inputs produce byte-identical artifacts and matching target metadata.
- `bun run format`, `git diff --check`, and `bun run agent:check` pass.

- [ ] **Step 1: Write failing audit tests**

```ts
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const PURE_UEFI_TARGET_FILES = [
  "diagnostics.ts",
  "result.ts",
  "artifact.ts",
  "target-driver-surface.ts",
  "status-conversion.ts",
  "firmware-abi.ts",
  "firmware-tables.ts",
  "platform-catalog.ts",
  "runtime-catalog.ts",
  "entry-contract.ts",
  "entry-thunk.ts",
  "watchdog-policy.ts",
  "firmware-strings.ts",
  "exit-boot-services.ts",
  "firmware-lowering.ts",
  "runtime-helper-objects.ts",
  "package-input.ts",
  "package-pipeline.ts",
  "binary-spine.ts",
] as const;

const UEFI_TARGET_IMPORT_PATTERN =
  /(?:from\s+["'][^"']*target\/uefi-aarch64(?:\/[^"']*)?["']|import\s+["'][^"']*target\/uefi-aarch64(?:\/[^"']*)?["'])/;

describe("UEFI AArch64 target-driver audit", () => {
  test("pure target-driver files do not import host APIs", () => {
    for (const fileName of PURE_UEFI_TARGET_FILES) {
      const text = readFileSync(join("src/target/uefi-aarch64", fileName), "utf8");
      expect(text).not.toMatch(
        /from\s+["'](?:bun|node:fs|node:path|node:os|node:process|fs|path|os|process)/,
      );
      expect(text).not.toMatch(/\bBun\./);
      expect(text).not.toMatch(/\bprocess\./);
    }
  });

  test("earlier compiler phases do not import the UEFI target driver", () => {
    const forbiddenRoots = [
      "src/frontend",
      "src/semantic",
      "src/hir",
      "src/mono",
      "src/layout",
      "src/proof-mir",
      "src/proof-check",
      "src/opt-ir",
      "src/linker",
      "src/pe-coff",
      "src/target/aarch64",
    ];
    for (const root of forbiddenRoots) {
      const matches = filesUnder(root)
        .map((filePath) => [filePath, readFileSync(filePath, "utf8")] as const)
        .filter(([, text]) => UEFI_TARGET_IMPORT_PATTERN.test(text));
      expect(matches).toEqual([]);
    }
  });
});
```

Use the repo's existing audit helper style if one already exists. Keep `node:fs` imports in audit tests only.

- [ ] **Step 2: Run audit tests to verify failure or expose violations**

Run:

```bash
bun test tests/audit/uefi-aarch64-target-driver-audit.test.ts
```

Expected: fail until policy violations are fixed, then pass.

- [ ] **Step 3: Extend `scripts/check-policy.ts`**

```ts
const uefiAArch64PureTargetImportForbiddenPatterns = [
  /(?:bun(?::|$)|node:fs|node:path|node:os|node:process|fs$|path$|os$|process$)/,
] as const;

function isPureUefiAArch64TargetSource(filePath: string): boolean {
  return (
    filePath.startsWith("src/target/uefi-aarch64/") &&
    !filePath.endsWith("qemu-smoke.ts") &&
    !filePath.endsWith("compile-uefi-aarch64-image.ts")
  );
}
```

Add policy diagnostics that name the violating file and module specifier. `compile-uefi-aarch64-image.ts` may import compiler-edge public APIs, but it still must not import host filesystem/process APIs directly.

- [ ] **Step 4: Add final determinism test**

```ts
test("UEFI AArch64 compile is deterministic for identical inputs", () => {
  const input = {
    packageInput: packageInputFromFixtureProject("tests/fixtures/uefi-aarch64/smoke-basic"),
    target: uefiTargetSurfaceFixture(),
    smoke: { kind: "disabled" as const },
  };

  const first = compileUefiAArch64Image(input);
  const second = compileUefiAArch64Image(input);

  expect(first.kind).toBe("ok");
  expect(second.kind).toBe("ok");
  if (first.kind === "ok" && second.kind === "ok") {
    expect(first.artifact.peCoffArtifact.bytes).toEqual(second.artifact.peCoffArtifact.bytes);
    expect(first.artifact.targetMetadata).toEqual(second.artifact.targetMetadata);
  }
});
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
bun test tests/unit/target/uefi-aarch64 tests/integration/target/uefi-aarch64 tests/audit/uefi-aarch64-target-driver-audit.test.ts
```

Expected: pass.

- [ ] **Step 6: Format and run full gate**

Run:

```bash
bun run format
git diff --check
bun run agent:check
```

Expected: `git diff --check` has no output and `bun run agent:check` exits `0`.

## Final Review Checklist

- [ ] The source boot function contract is implemented and rejects raw EFI parameters.
- [ ] The entry thunk is framed-call only and preserves `x30` before every `bl`.
- [ ] Platform primitive lowering payloads trace to `PlatformPrimitiveSpec`.
- [ ] Runtime materializations trace to `ProofMirRuntimeOperation`.
- [ ] No fifth AArch64 register model exists in the target driver.
- [ ] TCB constants use independent golden fixtures in tests.
- [ ] `SetWatchdogTimer` is present and production default disables the watchdog before source boot code.
- [ ] `GetMemoryMap`/`ExitBootServices` helper policy is bounded and fail-closed.
- [ ] Static firmware strings emit deterministic NUL-terminated `CHAR16` data.
- [ ] Certified static `CHAR16` OptIR records are linked as read-only data objects in the PE binary spine.
- [ ] Toolchain stdlib lives at `stdlib/wrela-std`; ejected copies live under project `src/wrela-std`.
- [ ] Stdlib source has no target authority by path.
- [ ] QEMU smoke is opt-in, shell-gated by a non-spoofable success marker, and never feeds byte generation.
- [ ] The final artifact is deterministic and has target-driver metadata.
- [ ] `bun run agent:check` passes.
