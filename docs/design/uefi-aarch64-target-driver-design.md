# UEFI AArch64 Target Driver Design

## Purpose

The UEFI AArch64 target driver is the compiler phase that turns the already
defined AArch64 binary spine into a firmware-runnable target product. It owns
the production `wrela-uefi-aarch64-rpi5-v1` target composition: the UEFI image
entry thunk, firmware ABI rules, image-handle and system-table handoff, UEFI
status conversion, target-owned compiler-runtime helpers, final artifact
orchestration, and opt-in QEMU/OVMF smoke validation.

The PE/COFF writer can already produce structurally valid `.efi` bytes from a
linked image layout. This phase proves that those bytes are the right firmware
program: the PE entry point is a compiler-owned UEFI entry function; that entry
receives `EFI_HANDLE` and `EFI_SYSTEM_TABLE*` in the AArch64 UEFI handoff
registers; firmware calls use the selected target ABI and table layouts; source
entry results are converted to `EFI_STATUS`; and a smoke harness can load the
image under an AArch64 UEFI firmware.

This is not a new optimizer, linker, or PE writer. It is the target-owned driver
that binds the contracts from earlier phases into one runnable UEFI AArch64
image.

## Phase Boundary

The phase boundary is:

```text
closed UEFI image compile request
  + selected wrela-uefi-aarch64-rpi5-v1 target surface
  + source/module inputs resolved at compiler edges
  + artifact output request
  + optional firmware smoke-test request
  -> target-driver authentication
  -> target catalog bundle construction
  -> compiler-owned UEFI entry thunk materialization
  -> firmware ABI and status-conversion contract handoff
  -> normal frontend / proof / OptIR / AArch64 / linker / PE writer pipeline
  -> final .efi artifact
  -> optional QEMU/OVMF smoke run
  -> UefiAArch64ImageArtifact
```

The target driver is allowed to call other compiler phases because it is an
edge-level orchestration layer. The lower compiler phases remain independently
testable:

```text
source pipeline:
  frontend -> HIR -> mono -> layout -> Proof MIR -> proof checks -> OptIR

target binary spine:
  OptIR -> AArch64 machine IR -> AArch64 backend object modules
  -> internal linker -> PE/COFF EFI writer

target driver:
  supplies target/catalog authority, target synthetic objects, final sinks,
  and optional firmware smoke validation
```

Core target-driver code should still separate pure planning from host effects.
QEMU invocation, file writes, temporary directories, and firmware-file discovery
belong to a compiler edge or test harness, not to the entry-thunk planner,
status mapper, firmware ABI catalog, or target-surface authenticator.

## Relationship To Existing Phases

Earlier phases deliberately defer parts of the UEFI target story to this phase:

- Representation/layout facts describe the image entry ABI, but they do not
  emit the physical firmware thunk.
- OptIR-to-AArch64 lowering records image-handle and system-table context
  bindings, but it does not own PE entry bytes or firmware launch testing.
- The AArch64 backend emits internal object modules, but it does not decide
  that a firmware-loaded PE image should start at a specific thunk symbol.
- The internal linker consumes synthetic object providers, but it does not hand
  assemble UEFI startup code.
- The PE/COFF EFI writer serializes a linked layout into valid PE32+ bytes, but
  it does not know whether the linked entry function follows the UEFI loader
  contract.

The UEFI AArch64 target driver owns those cross-phase target facts and keeps
them explicit. It supplies target surfaces and synthetic object providers to
the relevant phases instead of letting each phase rediscover UEFI behavior from
strings, file extensions, or host state.

## Source Standards

Primary standards and references:

- UEFI Specification 2.11 overview and AArch64 platform binding:
  <https://uefi.org/specs/UEFI/2.11/02_Overview.html>
- UEFI Specification 2.11 EFI System Table:
  <https://uefi.org/specs/UEFI/2.11/04_EFI_System_Table.html>
- Arm AAPCS64:
  <https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst>
- QEMU system emulator documentation:
  <https://qemu.readthedocs.io/en/v10.0.3/system/introduction.html>
- TianoCore EDK II ArmVirtPkg:
  <https://www.tianocore.org/tianocore-wiki.github.io/platforms-packages/core-packages/arm_virt_pkg.html>

The UEFI spec fixes the relevant UEFI image constants and handoff state for
this phase: UEFI AArch64 images use PE32+ machine `0xaa64`, EFI application
subsystem `10`, and receive the image handle in `x0`, the system table pointer
in `x1`, and the return address in `x30`. `EFI_STATUS` is `UINTN`, so the v1
target treats it as a 64-bit unsigned machine value on AArch64. AAPCS64 supplies
the public call ABI, but this phase does not define another physical register
model. It consumes the authenticated AArch64 backend target surface, physical
register model, ABI classifier, frame/unwind policy, and relocation catalogs.

The target surface owns the subset of those standards that Wrela v1 supports.
Implementation code consumes authenticated target records and table-layout
records; it does not infer firmware behavior from the host OS, installed QEMU
version, firmware file name, or PE artifact name.

## Production Commitments

The target driver has one job, expressed as six commitments:

```text
target:
  authenticate one wrela-uefi-aarch64-rpi5-v1 target bundle containing profile,
  ABI, platform, runtime, linker, PE writer, entry, and smoke-test policy

entry:
  emit a compiler-owned UEFI PE entry thunk that implements the raw firmware
  handoff and calls the ordinary Wrela image boot function

firmware:
  lower firmware primitives through explicit system-table, boot-services,
  runtime-services, console, and protocol table contracts

status:
  convert source image results, terminal paths, and panic/abort paths into
  deterministic EFI_STATUS values

artifact:
  orchestrate the normal compiler phases and return one deterministic .efi
  artifact with target-driver metadata and verification summaries

smoke:
  optionally boot the emitted image under QEMU/OVMF or EDK II AArch64 firmware
  and check observable firmware behavior through a bounded harness
```

## Trusted Computing Base

This phase carries some of the compiler's highest-risk trusted target data.
These records are in the TCB:

- UEFI table field offsets, field widths, and table ownership
- UEFI service function signatures and function-pointer paths
- UEFI status constants and status-conversion policy
- UEFI GUID constants used by protocol primitives
- AArch64 UEFI entry handoff locations and PE entry-symbol contract
- watchdog policy, smoke termination policy, and ExitBootServices retry policy
- target-owned UTF-16/CHAR16 materialization rules for firmware strings
- synthetic entry object and runtime-helper materialization plans

These records are not trusted because QEMU boots one image. QEMU smoke is only
an integration sanity check. The trusted data must be reviewed against the UEFI
specification and the authenticated AArch64 backend target surfaces, and tests
must compare against independent golden fixtures or small independent readers.
A test that serializes the production table and reads the same table back is
not sufficient for TCB data.

These records are outside this phase's TCB:

- stdlib source wrappers, including the toolchain `stdlib/wrela-std` tree
- project source `platform fn` declarations before certification
- QEMU stdout/stderr beyond declared smoke markers
- host file names, installed QEMU versions, or local firmware search order

## Goals

- Produce one UEFI AArch64 `.efi` application image for
  `wrela-uefi-aarch64-rpi5-v1`.
- Keep the raw UEFI entry ABI compiler-owned; user source should not manually
  spell `EFI_HANDLE`, `EFI_SYSTEM_TABLE*`, or EFIAPI entry signatures.
- Emit a normal linked executable section contribution for the entry thunk, so
  the linker and PE writer can validate it like other object bytes.
- Preserve `wrela.image.entry_shim` as the PE/COFF loader entry symbol and
  `wrela.image.boot` as the ordinary image boot function symbol.
- Bind the firmware image handle and system table into the machine program
  through authenticated image-profile records.
- Lower firmware calls through explicit firmware-table and function-pointer
  records, using AAPCS64 call clobbers and stack rules.
- Provide table-layout records for the initial v1 firmware primitive catalog:
  console output, boot-services allocation/free, memory-map retrieval,
  stall/timer/event primitives, locate/open protocol, exit, and
  exit-boot-services.
- Provide target-owned runtime materialization records for panic/abort, status
  conversion, entry-context initialization, firmware string materialization, and
  validated-buffer helper reads when not inlined. Coroutine, move-ring, and
  cross-core helpers are out of v1 until a separate UEFI execution-model design
  enables them through the proof/runtime catalog.
- Convert source-level image results into `EFI_STATUS` without relying on a C
  runtime or `main` convention.
- Keep target-driver pure pieces dependency-free and deterministic.
- Keep QEMU/firmware smoke tests opt-in, bounded, hermetic around a temporary
  ESP directory, and skipped with explicit diagnostics when required tools or
  firmware images are unavailable.
- Make repeated builds produce identical `.efi` bytes for identical compiler
  inputs, target surfaces, and artifact names.

## Non-Goals

- This phase does not define a new source language image-entry syntax.
- This phase does not perform semantic checking, proof checking, optimization,
  register allocation, linking, PE serialization, or external signing.
- This phase does not call a C compiler, C linker, libc, CRT, GNU-EFI, or EDK II
  build system to produce application code.
- This phase does not support x64 UEFI, AArch32 UEFI, generic AArch64 profiles,
  Linux kernel boot protocol, bare-metal firmwareless boot, UEFI drivers,
  runtime drivers, Secure Boot signing, authenticated variables, capsules, or
  runtime-services use after `ExitBootServices()` in v1.
- This phase does not infer table offsets by parsing EDK II headers at build
  time. Table layouts are target-authenticated data.
- This phase does not make QEMU a correctness oracle for compiler semantics.
  QEMU smoke tests are an integration sanity check after structural compiler
  verification has already passed.
- This phase does not make QEMU mandatory for `agent:check` unless the
  repository later chooses to provide hermetic firmware/tool fixtures.
- This phase does not treat OVMF/ArmVirtPkg logging as deterministic byte
  output beyond declared smoke markers.

## Repository Shape

The phase should live in a target-owned module rather than inside the linker or
PE writer:

```text
src/
  target/
    uefi-aarch64/
      index.ts
      diagnostics.ts
      target-driver-surface.ts
      entry-thunk.ts
      firmware-abi.ts
      firmware-tables.ts
      status-conversion.ts
      runtime-catalog.ts
      platform-catalog.ts
      compile-uefi-aarch64-image.ts
      artifact.ts
      qemu-smoke.ts

tests/
  support/
    target/
      uefi-aarch64/
        uefi-aarch64-fixtures.ts
        fake-firmware.ts
        fake-qemu-runner.ts

  unit/
    target/
      uefi-aarch64/
        target-driver-surface.test.ts
        entry-thunk.test.ts
        firmware-abi.test.ts
        firmware-tables.test.ts
        status-conversion.test.ts
        runtime-catalog.test.ts
        platform-catalog.test.ts
        qemu-smoke.test.ts

  integration/
    target/
      uefi-aarch64/
        compile-uefi-aarch64-image.test.ts
        qemu-ovmf-smoke.test.ts

  audit/
    uefi-aarch64-target-driver-audit.test.ts
```

`src/target/uefi-aarch64` is an orchestration target module. It may import the
public APIs of earlier compiler phases and the PE writer. Those earlier phases
must not import this target-driver module, except for narrow target-surface
types that are already part of their public input contracts. If a shared
AArch64 target fact is needed below this layer, put it in the existing
`src/target/aarch64/target-surface` authority or pass it as data.

The QEMU smoke runner has host effects and should be isolated behind a small
interface. Unit tests use fakes through dependency injection. The production
runner owns filesystem and subprocess access at the compiler/test edge only.

## Target Driver Surface

The target driver authenticates one bundle that pins together the target
contracts consumed across the pipeline:

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

Authentication checks:

- `targetKey` is exactly `wrela-uefi-aarch64-rpi5-v1`.
- Component fingerprints match authenticated AArch64, backend, linker, and
  PE/COFF writer target surfaces.
- Entry symbol names are non-empty, ASCII, deterministic, and not duplicated.
- Firmware ABI locations match the AArch64 UEFI handoff:
  `imageHandle -> x0`, `systemTable -> x1`, return status in `x0`.
- Firmware table offsets, GUIDs, platform lowering payloads, runtime
  materialization records, and status constants are sorted and unique.
- Every platform lowering payload references a canonical
  `PlatformPrimitiveSpec` from the semantic platform catalog fingerprint.
- Every runtime materialization references a canonical `ProofMirRuntimeOperation`
  from the runtime catalog fingerprint.
- Every platform lowering references a table/function-pointer path that exists
  in `firmwareTables`.
- Every runtime materialization references a symbol that the target can
  materialize as a backend object or prove is supplied by compiler-owned source.
- Watchdog policy is explicit.
- Smoke policy is disabled or has a complete tool/firmware discovery contract.

The target-driver fingerprint is computed with stable JSON over every
authenticated field. It is recorded in the final artifact metadata and in the
smoke-test report.

## Entry Profile

The v1 entry profile is:

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

`__wrela_uefi_entry` is the symbol the linker resolves as
`layout.entry.loaderEntryRva` and the PE writer serializes as
`AddressOfEntryPoint`. `wrela.image.entry_shim` is the target-internal stable
symbol for the compiler-owned entry object. `wrela.image.boot` is the ordinary
boot function produced from source lowering.

The current linker has a synthetic entry object provider. This target-driver
design narrows what that provider is allowed to mean: it must materialize the
UEFI entry thunk, not a generic branch stub whose ABI is guessed by the linker.
The provider receives the authenticated entry profile and returns a normal,
verified `AArch64ObjectModule`.

## Entry Thunk Contract

The entry thunk implements this logical shape:

```text
__wrela_uefi_entry(image_handle: EFI_HANDLE, system_table: EFI_SYSTEM_TABLE*) -> EFI_STATUS
  preserve public ABI invariants
  establish compiler-owned image context
  call wrela.image.boot with target-declared hidden context arguments
  convert the boot result to EFI_STATUS
  return status in x0
```

The thunk is generated as AArch64 object bytes through authenticated backend
encoding catalogs. It is not handwritten byte magic in the linker.

Required properties:

- It starts at offset zero of its executable object section.
- It receives `image_handle` in `x0` and `system_table` in `x1`.
- It leaves `sp` 16-byte aligned at all public call boundaries.
- It does not allocate from firmware before the boot function asks for a
  firmware primitive that permits allocation.
- It does not use `x18`.
- It treats `x16` and `x17` as scratch registers that veneers may also use.
- It records ordinary relocation references to `wrela.image.boot` and any
  compiler-owned status conversion helper it calls.
- It creates a real frame, saves the firmware return address from `x30` before
  any `bl`, and emits unwind metadata compatible with the existing
  `.pdata`/`.xdata` pipeline.
- It returns only through `ret` with `x0` containing a target-approved
  `EFI_STATUS`.

The v1 implementation strategy is a framed call. A plain direct-call sketch is
not correct: `bl` overwrites `x30`, so a thunk that calls source code and then
executes `ret` must first preserve the firmware return address. Tail-call entry
would also be ABI-correct only when the source boot function already returns the
final firmware status and can branch directly back through the firmware return
address; the current AArch64 lowering design does not make that a v1 entry
strategy.

```text
framed-call:
  save x29/x30 and establish the target-approved frame shape
  preserve image_handle/system_table as needed by the entry-context plan
  optionally initialize entry context and watchdog policy
  bl wrela.image.boot
  inline or call compiler-owned status conversion
  restore x29/x30
  ret with EFI_STATUS in x0
```

Future tail-call entry is a separate design:

```text
tail-entry:
  preserve firmware x30 as the boot function's return address
  branch, not call, to a boot function that already has the UEFI return ABI
  no post-call status conversion is possible in the thunk
```

V1 must not emit `tail-entry`. If backend tail-call support is later added, the
target driver must introduce a separate authenticated entry profile and tests
that prove no required cleanup, status conversion, watchdog handling, or unwind
obligation is bypassed.

## Source Boot Function Contract

The source boot function is the central source-level input to this phase. V1
pins the contract through the selected image profile:

```text
placement:
  image-owned function selected by ImageProfileSpec.entryFunctionName

source-visible parameters:
  none

compiler-hidden context:
  UEFI image handle capability
  UEFI system table capability
  derived boot-services/runtime-services/console capabilities when validated

allowed source result shapes:
  Unit-like success result -> EFI_SUCCESS
  target-certified Result[Unit, UefiImageError]-like result -> status policy
  Never / terminal path -> no ordinary status return
  panic/abort path -> EFI_ABORTED unless a terminal firmware call succeeds
```

The exact source spelling of `Unit`, `Result`, or `UefiImageError` may evolve
with the language and stdlib surface, but the compiler contract must be a
target-owned `entryResultContract` in the image profile, not a privilege granted
to a module path. A stdlib type used by the default source root must certify
against that target-owned contract like any project-defined type would.

The boot function must not accept raw `EFI_HANDLE` or `EFI_SYSTEM_TABLE*`
parameters in v1 source. If a future profile exposes lower-level entry
capabilities, it must do so through checked capability values and proof
obligations rather than by making the firmware ABI the user's function
signature.

## Image Handle And System Table Handling

The image handle and system table are not ordinary user parameters. They are
firmware-supplied capabilities whose use must be mediated by target facts:

```ts
export interface UefiAArch64ImageContext {
  readonly imageHandle: UefiImageHandleValue;
  readonly systemTable: UefiSystemTablePointerValue;
  readonly bootServices?: UefiBootServicesPointerValue;
  readonly runtimeServices?: UefiRuntimeServicesPointerValue;
  readonly consoleOut?: UefiSimpleTextOutputPointerValue;
}
```

The physical values originate from `x0` and `x1`. Earlier lowering may bind
`uefi.imageHandle` and `uefi.systemTable` as hidden boot-function ABI values.
This target driver supplies the authority that those values are firmware
capabilities, not arbitrary pointers.

Rules:

- The system table pointer is nullable only if the target surface explicitly
  defines a null-tolerant smoke or diagnostic mode. Production v1 treats null as
  firmware failure and returns `EFI_INVALID_PARAMETER`.
- Firmware table base values derived from the system table carry provenance:
  `uefi.system-table`, `uefi.boot-services`, `uefi.runtime-services`,
  `uefi.conout`, or a protocol-specific key.
- A platform primitive may use a table pointer only if its catalog record names
  that table path.
- The image handle may be passed to firmware functions such as
  `HandleProtocol`, `OpenProtocol`, `LoadedImage`, or `Exit` only through
  catalog records that accept image-handle authority.
- The compiler never stores the image handle or system table in global mutable
  state unless a compiler-runtime helper has a checked lifetime contract for
  that storage.

## Watchdog Policy

UEFI boot manager policy arms a boot-services watchdog before invoking a loaded
image. The v1 target must not let long-running UEFI applications accidentally
inherit a five-minute reset.

The `wrela-uefi-aarch64-rpi5-v1` image profile owns an entry watchdog policy:

```ts
export type UefiAArch64EntryWatchdogPolicy =
  | { readonly kind: "disable-before-source" }
  | { readonly kind: "preserve-firmware-default" }
  | { readonly kind: "source-managed" };
```

The production default is `disable-before-source` for application images that
may run indefinitely under boot services. Entry-context initialization calls
`BootServices.SetWatchdogTimer(0, 0, 0, NULL)` after validating the system table
and boot-services pointer and before calling source boot code. `EFI_SUCCESS`
and `EFI_UNSUPPORTED` are non-fatal; other failures map through the status
policy before source code runs. Profiles that want firmware-default watchdog
behavior must opt in explicitly.

The stdlib should still expose a checked wrapper for `SetWatchdogTimer` so
source can extend, re-enable, or intentionally preserve watchdog behavior. The
wrapper is ordinary source over the compiler-owned platform primitive.

## Firmware ABI Surface

Firmware calls are indirect calls through firmware-owned function pointers. The
target driver makes those calls ordinary AAPCS64 calls in machine IR, but with
firmware-specific provenance and effects.

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

Firmware ABI lowering:

1. Resolve a platform primitive to a firmware table path.
2. Load the required table pointer from the image context or a previously
   certified table value.
3. Load the function pointer from an authenticated byte offset.
4. Classify call arguments through the AAPCS64 ABI surface.
5. Emit an indirect call with full public-call clobbers.
6. Convert the returned `EFI_STATUS` or output pointer values into the
   primitive result shape.
7. Attach memory, volatile, ordering, allocation, handle, or terminal effects
   from the platform primitive catalog.

The lowering layer does not know table offsets by name. It consumes
`UefiFirmwareTablePath` values from `firmwareTables`.

The target driver must not hand-list caller-saved, callee-saved, reserved,
allocatable, alias, IP, SP, zero-register, or vector register facts. Those facts
come from the authenticated AArch64 backend target surface named by
`backendAbiSurfaceFingerprint` and `physicalRegisterModelFingerprint`. The
target-driver tests should assert that the UEFI handoff locations agree with
that surface; they should not maintain a parallel register catalog.

## Firmware Table Surface

The table surface is target data, not a host header parser:

```ts
export type UefiFirmwareTablePath =
  | { readonly kind: "system-table"; readonly field: UefiSystemTableField }
  | { readonly kind: "boot-services"; readonly field: UefiBootServicesField }
  | { readonly kind: "runtime-services"; readonly field: UefiRuntimeServicesField }
  | { readonly kind: "protocol"; readonly guid: string; readonly field: string };

export interface UefiFirmwareTableFieldRecord {
  readonly tableKey: string;
  readonly fieldKey: string;
  readonly offsetBytes: number;
  readonly valueKind: "pointer" | "functionPointer" | "u32" | "u64";
  readonly requiredBeforeExitBootServices: boolean;
}
```

V1 must include the table fields needed for initial stdlib and smoke behavior:

```text
system-table:
  hdr
  firmware-vendor
  firmware-revision
  con-out
  boot-services
  runtime-services

simple-text-output:
  output-string

boot-services:
  allocate-pages
  free-pages
  allocate-pool
  free-pool
  get-memory-map
  exit-boot-services
  set-watchdog-timer
  handle-protocol
  locate-protocol
  open-protocol
  close-protocol
  create-event
  set-timer
  wait-for-event
  stall
  exit
```

Only records referenced by the platform catalog are required in the first
implementation wave. The surface may contain more records than the first stdlib
uses, but each record must be covered by unit tests that freeze offset,
value-kind, and table ownership.

`GetMemoryMap` and `ExitBootServices` are coupled. The map key changes whenever
the firmware memory map changes, and allocation performed to resize the map
buffer can itself change the map. V1 must therefore expose a target-owned
exit-boot helper policy rather than expecting source wrappers to compose the
raw calls correctly:

```text
exitBootServicesWithFreshMap:
  call GetMemoryMap with a caller-owned or helper-owned buffer
  if EFI_BUFFER_TOO_SMALL, allocate a larger buffer with target-declared slack
  call GetMemoryMap again and retain DescriptorSize/DescriptorVersion/MapKey
  perform no further boot-services allocation before ExitBootServices
  call ExitBootServices(image_handle, map_key)
  if EFI_INVALID_PARAMETER, reacquire the map using preplanned capacity and retry within a bounded policy
  on success, consume boot-services authority and mark boot-services stale
```

The retry bound and slack policy are target policy, not an unbounded loop. Any
failure after the retry budget maps through the status policy and must not leave
source with a valid boot-services capability. If the retry path cannot reacquire
the map without additional allocation, it fails closed unless a future design
defines a stronger preallocated-buffer protocol.

## Catalog Origination And Identity

This phase must not create parallel platform/runtime catalogs. It extends and
selects the existing compiler catalogs by identity:

| Concern                                          | Canonical record                                                                       | UEFI target-driver contribution                                                                  |
| ------------------------------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Source `platform fn` certification               | `PlatformPrimitiveSpec` in `SemanticTargetSurface`                                     | UEFI primitive IDs, signatures, proof contracts, and availability in the selected target surface |
| Firmware lowering for certified platform calls   | Target-owned lowering payload keyed by `PlatformPrimitiveId`                           | `UefiFirmwareLoweringRule` plus table-path/effect metadata                                       |
| Compiler runtime operations visible to Proof MIR | `ProofMirRuntimeOperation` in `ProofMirRuntimeCatalog`                                 | UEFI target availability, ABI references, and lowering-owner selection                           |
| Runtime helper bytes or source-runtime bodies    | Backend/runtime materialization keyed by `ProofMirRuntimeOperationId` or authority key | object providers, source-runtime roots, or inline-only plans                                     |
| Firmware table layout                            | `UefiFirmwareTableSurface`                                                             | TCB data consumed by platform lowering payloads                                                  |

The target-driver fingerprint records the fingerprints of the semantic target
surface and selected `ProofMirRuntimeCatalog`. A UEFI primitive or helper that
cannot be traced back to those canonical records is rejected before lowering.

## Platform Primitive Lowering Payloads

The semantic platform catalog maps certified source `platform fn` declarations
to target primitive IDs. The UEFI target driver adds lowering payloads for
those existing primitive IDs:

```ts
export interface UefiAArch64PlatformPrimitiveLowering {
  readonly primitiveId: PlatformPrimitiveId;
  readonly semanticPrimitiveFingerprint: string;
  readonly lowering: UefiFirmwareLoweringRule;
}

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

Initial v1 primitive payloads:

| Primitive                    | Lowering owner                     | Notes                                                      |
| ---------------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `uefi.console.outputString`  | system table `ConOut.OutputString` | UTF-16/UCS-2 buffer handling is explicit; no host encoding |
| `uefi.boot.allocatePool`     | boot services                      | returns pointer capability or EFI status                   |
| `uefi.boot.freePool`         | boot services                      | consumes allocated-memory capability                       |
| `uefi.boot.getMemoryMap`     | boot services                      | produces memory-map snapshot with map key                  |
| `uefi.boot.exitBootServices` | boot services                      | consumes boot-services authority on success                |
| `uefi.boot.setWatchdogTimer` | boot services                      | disables or extends the boot-services watchdog             |
| `uefi.boot.stall`            | boot services                      | ordered firmware call, useful for smoke/debug              |
| `uefi.boot.exit`             | boot services                      | terminal firmware call for explicit exit paths             |
| `uefi.protocol.locate`       | boot services                      | GUID-authenticated protocol lookup                         |

The catalog distinguishes boot-services calls from runtime-services calls.
After `ExitBootServices()` succeeds, boot-services capabilities become stale and
runtime calls are allowed only through a future runtime-services design. V1 may
compile images that call `ExitBootServices()` only through the exit-boot helper
policy described above; it does not support post-exit runtime-service calls.

## Runtime Operation Materialization

Compiler-runtime helpers are target-owned code that the compiler may emit or
link when direct lowering would duplicate complex code. Their proof-visible
identity is always a `ProofMirRuntimeOperation` from the selected
`ProofMirRuntimeCatalog`; this phase only describes how the operation is
materialized for UEFI AArch64:

```ts
export interface UefiAArch64RuntimeMaterialization {
  readonly runtimeId: ProofMirRuntimeOperationId;
  readonly runtimeOperationFingerprint: string;
  readonly linkageName: string;
  readonly convention: "wrela-private" | "aapcs64";
  readonly materialization: "backend-object" | "source-runtime" | "inline-only";
}
```

Initial v1 runtime materialization families:

- `uefi.status.from-boot-result`
- `uefi.panic.to-status`
- `uefi.entry.initialize-context`
- `uefi.console.write-ascii-debug`
- `uefi.string.utf16-static`
- `runtime.validated-buffer.read-slow`

Helpers are ordinary compiler-owned code with contracts. They are not hidden
stdlib magic. If a helper consumes or produces capabilities, the proof checker
must see that through the runtime catalog before backend emission. If a helper
is materialized as object code, it must pass the same backend object verifier as
user code.

Coroutine, move-ring transfer, cross-core handoff, or UEFI MP Services support
is not part of v1. Those operations remain fail-closed through the existing
runtime/semantics gates until a separate UEFI execution-model design defines
which firmware protocols, processor ownership rules, event semantics, and proof
obligations are available.

## Firmware String Materialization

UEFI console output consumes `CHAR16*` strings, not host UTF-8 strings. V1 owns
string materialization in the target/runtime layer:

- Compile-time string literals used for firmware output are materialized as
  deterministic read-only `CHAR16` data with a trailing NUL.
- The materializer accepts the v1 source character subset explicitly. ASCII
  smoke strings and CR/LF are required; broader Unicode support must define
  surrogate handling before it is accepted.
- Dynamic firmware output accepts only a checked `Utf16Slice`-like source value
  whose provenance proves NUL termination and lifetime across the firmware call.
- No firmware string path may depend on host locale, JavaScript string encoding
  behavior, or platform newline conversion.
- The console-output primitive lowering consumes the materialized pointer and
  length/lifetime facts; it does not synthesize ad hoc buffers at the call site.

The first smoke fixture uses a static ASCII marker so the v1 implementation can
exercise deterministic `CHAR16` data emission before dynamic string conversion
exists.

## UEFI Status Conversion

The source image boot function should return a Wrela-level result, not raw
firmware integers. The target status policy owns conversion:

```ts
export interface UefiAArch64StatusPolicy {
  readonly success: 0x0000000000000000n;
  readonly loadError: 0x8000000000000001n;
  readonly invalidParameter: 0x8000000000000002n;
  readonly unsupported: 0x8000000000000003n;
  readonly badBufferSize: 0x8000000000000004n;
  readonly bufferTooSmall: 0x8000000000000005n;
  readonly deviceError: 0x8000000000000007n;
  readonly notFound: 0x800000000000000en;
  readonly aborted: 0x8000000000000015n;
  readonly securityViolation: 0x800000000000001an;
  readonly panicStatus: "aborted";
}
```

The implementation should derive the high bit from `EFIERR(value)` semantics
and use named constants, not numeric literals at call sites. The numeric values
above are included to freeze the AArch64 v1 target contract and make tests
unambiguous.

Conversion rules:

- A source success result maps to `EFI_SUCCESS`.
- A source error result maps through a target-owned `UefiErrorKind` table.
- A proof-checked terminal success path returns the status named by that
  terminal contract.
- Panic/abort paths map to `EFI_ABORTED` by default and may attempt a
  best-effort console diagnostic only when the system table and console output
  capability are valid.
- If entry-context validation fails before source code runs, the thunk returns
  `EFI_INVALID_PARAMETER`.
- If a platform primitive returns a firmware error, the primitive lowering
  either propagates the raw status through a checked result type or maps it to a
  source error enum using a catalog record.

Status conversion is deterministic. It must not inspect firmware strings,
localized messages, timestamps, or host logs.

## Public API Shape

The target driver should expose a single high-level compile API plus smaller
pure helpers for tests:

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

export interface UefiAArch64ImageArtifact {
  readonly artifactName: string;
  readonly peCoffArtifact: PeCoffEfiImageArtifact;
  readonly targetMetadata: UefiAArch64TargetMetadata;
  readonly smoke?: UefiAArch64SmokeReport;
}
```

`CompileUefiAArch64ImageInput` belongs at the compiler edge. Unit tests for
entry-thunk planning, firmware ABI, status conversion, and QEMU command
construction should call smaller pure functions.

## Orchestration Stages

The target-driver orchestration stages are:

```text
target-driver-authenticate
target-catalogs
frontend
semantic
hir
monomorphization
layout-facts
proof-mir
proof-check
opt-ir
aarch64-lowering
aarch64-backend
synthetic-entry-object
linker
pe-coff-writer
artifact-sink
qemu-smoke
```

Failed results include all passed stages before the failed stage and one failed
stage. `qemu-smoke` may be `skipped` when smoke was not requested or when the
environment lacks configured tools. A requested smoke run with missing tools is
an error unless the request explicitly says `allowSkip: true`.

## QEMU/OVMF Smoke Harness

The smoke harness is opt-in and host-effectful. It should be implemented as a
small runner around a pure command plan:

For this AArch64 target, "OVMF" in phase names means the EDK II UEFI firmware
family used by QEMU smoke tests. The concrete firmware should normally be an
AArch64 ArmVirtPkg/AAVMF image, not an x86 OVMF binary.

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

Tool discovery should use explicit environment variables or test config:

```text
WRELA_QEMU_AARCH64
WRELA_QEMU_AARCH64_EFI_CODE
WRELA_QEMU_AARCH64_EFI_VARS_TEMPLATE
```

If those variables are absent, the smoke test may search conservative common
paths for developer convenience, but any discovered path must be reported in
the smoke report.

The command plan:

```text
create temporary ESP directory
write artifact as EFI/BOOT/BOOTAA64.EFI
copy mutable firmware vars template when configured
run qemu-system-aarch64:
  -machine virt,virtualization=off,pflash0=rom,pflash1=efivars
  -cpu cortex-a76 or max
  -accel tcg/hvf/kvm from config
  -m <memory>
  -serial mon:stdio
  -display none
  -blockdev node-name=rom,driver=file,filename=<firmware-code>,read-only=true
  -blockdev node-name=efivars,driver=file,filename=<vars-copy>
  -drive if=none,id=esp,format=raw,file=fat:rw:<esp-dir>
  -device virtio-blk-device,drive=esp
capture stdout/stderr until timeout
classify marker output and process status
when termination is kill-after-marker and all required markers appear, terminate QEMU
delete temporary files unless debug preservation is requested
```

The final QEMU smoke fixture should be a real Wrela project, not a synthetic
boot function. Its default path should mirror `wrela init --target
uefi-aarch64`: the project contains only project source, while the compiler
edge supplies the installed toolchain stdlib source root from
`stdlib/wrela-std`.

```text
smoke-basic/
  wrela.toml
  src/
    image.wr
```

```text
toolchain source root:
  stdlib/
    wrela-std/
      core/
      target/
        uefi/
          console.wr
          status.wr
```

The toolchain stdlib source may declare `platform fn` handles for
compiler-owned UEFI primitives, but it is not trusted because of its path.
Those declarations must certify against the selected UEFI AArch64 target
catalog exactly like the same declarations would in any other source module.

One additional fixture should exercise the eject/customize mode by physically
copying the same stdlib tree under `src/wrela-std`, but that is not the default
project shape.

The first source-level smoke image should do as little as possible:

```text
entry thunk receives image_handle/system_table
image imports the selected stdlib UEFI console wrapper
stdlib source wrapper calls certified platform fn for ConOut.OutputString
boot function validates system_table is non-null through compiler-owned context
boot function prints "WRELA_UEFI_SMOKE_OK\r\n"
boot function returns source success
entry thunk converts success to EFI_SUCCESS
```

Negative smoke fixtures:

- boot function returns a target-mapped error and the thunk returns that status
- null system table in a fake firmware harness maps to `EFI_INVALID_PARAMETER`
- panic path maps to `EFI_ABORTED`
- QEMU timeout returns a smoke diagnostic without hanging the test runner

The default QEMU smoke success condition is marker based. Returning from a UEFI
application hands control back to firmware or the boot manager, not to the host
test process, so the harness should not require QEMU to exit with a successful
host process status. For normal smoke tests, the runner observes the declared
console marker, sends a bounded termination signal or QEMU monitor quit, and
records the run as passed if process cleanup succeeds. Raw returned
`EFI_STATUS` values are tested with fake firmware and structural thunk/status
tests, not inferred from QEMU process exit.

QEMU smoke tests are not part of default `agent:check` until the repository has
a hermetic firmware/tool strategy. Provide an explicit command such as
`bun run smoke:uefi-aarch64` or a skipped integration test that explains how to
enable it.

## Diagnostics And Metadata

Diagnostics are target-driver owned:

```ts
export type UefiAArch64TargetDiagnosticCode =
  | "UEFI_AARCH64_TARGET_AUTH_FAILED"
  | "UEFI_AARCH64_ENTRY_THUNK_FAILED"
  | "UEFI_AARCH64_FIRMWARE_ABI_FAILED"
  | "UEFI_AARCH64_STATUS_CONVERSION_FAILED"
  | "UEFI_AARCH64_PIPELINE_FAILED"
  | "UEFI_AARCH64_ARTIFACT_SINK_FAILED"
  | "UEFI_AARCH64_SMOKE_FAILED";
```

Metadata records:

```ts
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
```

The metadata is returned with the compile result. It is not embedded into the
`.efi` file in v1 unless a later debug/provenance section policy explicitly
chooses to do so.

## Verification

The target driver does not replace lower-level verification. It adds target
composition checks:

- target-driver surface authenticates and fingerprints all component surfaces
- target-driver catalog payloads trace to canonical `PlatformPrimitiveSpec` and
  `ProofMirRuntimeOperation` records
- entry thunk object verifies as an ordinary AArch64 object module
- entry thunk saves/restores the firmware return address before any `bl`
- entry thunk defines exactly one PE entry linkage name
- entry thunk references the boot function by linkage name
- machine lowering records image handle and system table provenance
- firmware primitive lowering uses only catalog-defined table paths
- watchdog policy is explicit and has deterministic failure handling
- `GetMemoryMap`/`ExitBootServices` lowering uses a bounded fresh-map retry
  policy
- firmware string materialization emits checked `CHAR16` data or checked
  `Utf16Slice` values
- status conversion has total coverage for every source entry result shape
- linked layout entry RVA resolves to the entry thunk symbol
- PE writer output has EFI application subsystem and AArch64 machine type
- optional smoke run observes expected console markers and bounded harness-owned
  process termination

Target-driver verification should be able to run without QEMU. Firmware smoke
is one extra run in the verification summary, not the only evidence that the
artifact is well formed.

## Testing Strategy

Unit tests:

- target-driver surface authentication and fingerprint stability
- entry profile rejects missing or duplicate symbols
- catalog origination rejects UEFI platform/runtime payloads without canonical
  semantic/runtime catalog records
- entry thunk object provider emits a verified object with expected symbols,
  relocation target, section class, and unwind metadata
- entry thunk object provider preserves `x30` with a real frame before boot
  calls or status-helper calls
- firmware ABI classification fixes image handle in `x0`, system table in `x1`,
  status return in `x0`, no red zone, and 16-byte stack alignment
- firmware ABI tests consume the backend register model instead of duplicating
  caller/callee register lists
- firmware table records are sorted, unique, field-width checked, and referenced
  only by known primitive records
- TCB tests compare UEFI table offsets, GUIDs, and status constants against
  independent golden fixtures, not against the production table itself
- platform lowering payload authentication rejects missing table paths,
  duplicate primitive IDs, or stale semantic primitive fingerprints
- runtime materialization authentication rejects stale runtime operation
  fingerprints or helpers without materialization authority
- watchdog policy disables, preserves, or source-manages the watchdog exactly as
  declared
- `GetMemoryMap`/`ExitBootServices` helper retries on stale map keys within a
  bounded policy
- static firmware string materialization produces deterministic NUL-terminated
  `CHAR16` data
- status conversion maps every supported source result and panic path
- QEMU command planner creates an ESP layout with `EFI/BOOT/BOOTAA64.EFI`
- fake QEMU runner classifies success by marker observation plus harness-owned
  termination, timeout, missing marker, and cleanup failure

Integration tests:

- compile a tiny source image into an `.efi` artifact through the public target
  driver API
- verify the final artifact's PE entry RVA points at the synthetic entry thunk
- compile a source-level smoke fixture whose `src/image.wr` imports the
  toolchain `stdlib/wrela-std` UEFI console wrapper
- compile the same smoke fixture with an explicit ejected copy under
  `src/wrela-std`
- compile an equivalent source-level fixture that does not import the shipped
  stdlib and declares the same console `platform fn` directly, proving the
  stdlib path has no special authority
- compile a fixture that returns a non-success source error and verify the
  status-conversion plan
- compile a fixture that exercises the watchdog wrapper or entry watchdog
  policy
- compile a fixture that materializes the smoke marker as target-owned `CHAR16`
  data
- optional QEMU/OVMF run for the smoke fixture when tools and firmware are
  configured

Audit tests:

- earlier phases do not import `src/target/uefi-aarch64/**`
- target-driver pure modules do not import filesystem, `Bun`, subprocess,
  process, OS, or host-clock APIs
- host-effect modules are isolated to `qemu-smoke` runner and artifact sink
- no runtime helper or platform primitive bypasses canonical semantic/runtime
  catalog authentication
- no handwritten entry-thunk bytes exist outside authenticated backend object
  factories
- no UEFI table-offset or GUID test compares the production data structure to
  itself

## Build Waves

### Wave 1: Target Surface And Status Policy

- create `src/target/uefi-aarch64`
- define diagnostics, result helpers, target-driver surface, and metadata
- encode status constants and source-result conversion policy
- define the source boot function contract and entry-result contract
- define the TCB ledger for status constants, table offsets, GUIDs, entry
  policy, watchdog policy, and UTF-16 materialization
- add unit tests for authentication, fingerprints, status conversion, and
  independent TCB golden fixtures

Output: pure target-driver authority records.

### Wave 2: Firmware ABI And Table Catalog

- define firmware ABI records for AArch64 UEFI
- define system-table, boot-services, runtime-services, console, and protocol
  table path records
- define initial platform primitive lowering payloads keyed by canonical
  `PlatformPrimitiveId` records
- include `SetWatchdogTimer`, `GetMemoryMap`, and `ExitBootServices` contracts
- add fake firmware ABI tests, table-offset tests, watchdog tests, and
  bounded `GetMemoryMap`/`ExitBootServices` retry tests

Output: target-owned firmware call contracts that machine lowering can consume.

### Wave 3: Entry Thunk Object Provider

- replace the generic linker entry synthetic object meaning with a UEFI entry
  thunk provider
- generate a framed thunk through backend encoding/object factories
- save/restore the firmware return address before any `bl`
- verify symbols, relocations, unwind metadata, and boot-function call contract
- reject v1 tail-entry profiles until backend tail-call support exists
- ensure linked entry RVA resolves to the thunk symbol

Output: linked images start at a real UEFI ABI thunk.

### Wave 4: Target Driver Orchestration API

- implement `compileUefiAArch64Image`
- thread authenticated target/catalog bundles into frontend, proof, AArch64,
  linker, and PE writer public APIs
- thread semantic platform catalog fingerprints and selected
  `ProofMirRuntimeCatalog` fingerprints through the target-driver metadata
- return final target-driver metadata and verification summary
- add integration tests using fakes for source/package/file edges

Output: one public target-driver API that returns one `.efi` artifact.

### Wave 5: QEMU/OVMF Smoke Harness

- implement pure QEMU command planning
- implement host-effect runner behind dependency injection
- add fake runner tests
- terminate QEMU from the harness after declared marker observation unless a
  test explicitly requests a firmware-exit mode
- add skipped/opt-in real QEMU AArch64 firmware smoke test
- document environment variables and expected firmware file behavior

Output: an opt-in smoke command that can run the generated image under firmware.

### Wave 6: Audit And Full Pipeline Hardening

- add import-boundary policy checks
- add artifact determinism tests
- add target-driver metadata fingerprint tests
- add negative tests for firmware-table misuse and post-exit boot-service use
- add negative tests for untraced catalog payloads, unsupported
  coroutine/cross-core helpers, stale map keys, and invalid UTF-16 inputs
- run `bun run agent:check`

Output: production-quality target-driver boundary with smoke-ready artifacts.

## Open Extension Points

These are explicit future targets, not v1 behavior:

- Secure Boot signing and Authenticode certificate table emission
- UEFI boot-service driver or runtime-driver subsystem profiles
- runtime-services calls after `SetVirtualAddressMap`
- real OS-loader handoff after `ExitBootServices`
- ACPI table discovery and device-path parsing beyond initial primitives
- native Raspberry Pi firmware launch outside UEFI
- multi-profile AArch64 support or Armv8.0-A fallback

## Design Defaults

- Keep target facts as data records, not callbacks or string inference.
- Let the entry thunk be an ordinary verified object module.
- Keep UEFI table layouts close to the target driver, not scattered through
  lowering or stdlib wrappers.
- Treat source `platform fn` declarations as untrusted handles until certified
  against the target platform catalog.
- Treat compiler-runtime helpers as ordinary compiler-owned code with explicit
  contracts.
- Prefer fake firmware and fake QEMU runners for unit tests.
- Keep real QEMU/OVMF smoke opt-in and bounded.
- Do not weaken lower-phase verification just because QEMU can boot one image.
- Keep the final product deterministic even when smoke execution is requested;
  smoke reports are metadata, not input to byte generation.
