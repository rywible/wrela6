# PE/COFF EFI Writer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the PE/COFF EFI writer described in `docs/design/pe-coff-efi-writer-design.md`, consuming verified `AArch64LinkedImageLayout` records and emitting one deterministic `.efi` artifact.

**Architecture:** First fix the linker-side PE header page precondition so linked RVAs are valid for PE images. Then add a dependency-free `src/pe-coff` subsystem with writer diagnostics, authenticated AArch64 writer target policy, byte writers, section/data-directory/header planners, base relocation serialization, strict parse-back verification, and a pure `writeAArch64PeCoffEfiImage` API. Keep filesystem writes at a small compiler-edge sink and enforce import boundaries with `scripts/check-policy.ts`.

**Tech Stack:** TypeScript, Bun test runner, existing linker layout records, existing deterministic sort and stable JSON helpers, `fast-check` for tests only, no production filesystem or external PE libraries.

---

## Research Notes

- Design source: `docs/design/pe-coff-efi-writer-design.md`.
- Microsoft PE format authority: <https://learn.microsoft.com/en-us/windows/win32/debug/pe-format>.
- Production image format is PE32+ with `Magic = 0x20b`, no `BaseOfData`, and 16 data directories.
- COFF machine for AArch64 is `0xaa64`.
- EFI application subsystem is `10`.
- PE32+ optional header size with 16 data directories is `0xf0` bytes.
- COFF file header size is `20` bytes. PE signature size is `4` bytes. Section header size is `40` bytes.
- V1 DOS layout is fixed: `MZ` at `0x00`, `e_lfanew = 0x80` at `0x3c`, all other bytes through `0x7f` zero.
- V1 section alignment is `4096`, file alignment is `512`, first linked section RVA is `4096`.
- `.reloc` section characteristics are `0x42000040` (`IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ | IMAGE_SCN_MEM_DISCARDABLE`).
- Base relocation block entries are 16-bit `(type << 12) | offset`. V1 production AArch64 emits `dir64` type `10`; `highlow` type `3` is rejected in v1.
- Certificate table directory index `4` is special in PE because it is a file pointer instead of an RVA. V1 emits it as zero.
- Current linker `src/linker/section-layout.ts` starts `nextSectionRva` at `0`; Task 1 changes that before writer integration tests.
- Existing linker fixtures in `tests/support/linker/linker-fixtures.ts` already construct manual layouts with `.text` at `0x1000`; they can be reused by writer tests after adding `.pdata`/`.xdata` where needed.

## Implementation Findings Resolved

- Strict parser hardening was extended beyond the original happy-path serializer fixtures: V1 now rejects DOS/header padding drift, non-fixed `e_lfanew`, nonzero section-name padding after the first NUL, base-relocation page RVA misalignment, and trailing bytes after the final raw section.
- Writer input hardening was tightened after review: exception data directories must be sourced from linked `.pdata`, malformed base-relocation RVAs are rejected before encoding, and the orchestration layer requires a complete authenticated writer target surface rather than accepting fingerprint-only partial objects.
- File-sink boundary behavior was tightened after review: direct malformed artifact inputs now return deterministic `PeCoffWriterResult` diagnostics instead of throwing before the injected write edge.
- Parse-back verification was extended to compare all 16 data-directory slots and raw section bytes, so unsupported directory drift and raw padding drift are visible during serializer verification.
- Byte-writer append paths were changed to avoid argument spreading for large byte/zero runs.

## Parallelization Map

Tasks are atomic, but not all are independent. Use this dependency map for subagent dispatch:

```text
Task 1
  fixes linker section RVAs and unblocks writer integration tests

Task 2
  owns writer diagnostics, result helpers, verification summaries, and artifact metadata types

Task 3 depends on Task 2
  owns authenticated writer target surface

Task 4 depends on Task 2
  owns PE constants and byte writer helpers

Task 5 depends on Tasks 2, 3, 4
  owns base relocation serialization

Task 6 depends on Tasks 2, 3, 4
  owns linked layout validation

Task 7 depends on Tasks 2, 3, 4, 5, 6
  owns section and data-directory planning

Task 8 depends on Tasks 2, 3, 4, 7
  owns header planning

Task 9 depends on Tasks 2, 4, 5, 7, 8
  owns final image serialization

Task 10 depends on Tasks 2, 4, 5, 9
  owns strict PE parser and uses Task 9 serializer fixtures for valid-image bytes

Task 11 depends on Tasks 2, 5, 7, 8, 9, 10
  owns parse-back verifier

Task 12 depends on Tasks 2 through 11
  owns public writer orchestration API

Task 13 depends on Tasks 1 and 12
  owns linker-to-writer integration tests

Task 14 depends on Task 12
  owns file sink, public exports, and policy rules

Task 15 depends on Tasks 1 through 14
  owns property tests, audit tests, and final verification
```

Subagents can run Task 1 and Task 2 immediately. After Task 2 lands, Tasks 3 and 4 can run in parallel. After Tasks 3 and 4 land, Tasks 5 and 6 can run in parallel. Do not run Tasks 7 through 13 against stale linker output where `.text` still starts at RVA `0`.

## File Structure

Create the writer in focused files:

```text
src/pe-coff/
  diagnostics.ts
  headers.ts
  index.ts
  pe-byte-writer.ts
  pe-file-layout.ts
  pe-parser.ts
  pe-relocations.ts
  pe-verifier.ts
  aarch64/
    aarch64-pe-coff-efi-writer.ts
    aarch64-pe-coff-target.ts
```

Tests and support:

```text
tests/support/pe-coff/
  pe-coff-fixtures.ts  # created in Task 3; expanded in Tasks 6 and 13

tests/unit/pe-coff/
  diagnostics.test.ts
  aarch64-target.test.ts
  pe-byte-writer.test.ts
  pe-relocations.test.ts
  linked-layout-validation.test.ts
  pe-file-layout.test.ts
  pe-parser.test.ts
  pe-verifier.test.ts
  aarch64-pe-coff-efi-writer.test.ts
  pe-coff-property.test.ts

tests/integration/pe-coff/
  aarch64-efi-writer.test.ts

tests/audit/
  pe-coff-writer-audit.test.ts
```

Existing files to modify:

```text
src/index.ts
src/linker/aarch64/aarch64-section-policy.ts
src/linker/image-layout-policy.ts
src/linker/section-layout.ts
src/linker/verifier.ts
scripts/check-policy.ts
tests/unit/linker/aarch64-target-policy.test.ts
tests/unit/linker/section-layout.test.ts
tests/unit/linker/linked-image-verifier.test.ts
tests/unit/linker/linked-image-layout.test.ts
tests/unit/linker/relocation-application.test.ts
tests/unit/linker/symbol-rva.test.ts
tests/unit/linker/entry-resolution.test.ts
tests/unit/linker/linker-property.test.ts
tests/unit/linker/unwind-metadata.test.ts
tests/unit/linker/linker-fixtures-contract.test.ts
tests/unit/linker/aarch64-api.test.ts
tests/unit/linker/aarch64-link-orchestration.test.ts
tests/unit/linker/veneer-fixed-point.test.ts
tests/integration/linker/aarch64-linked-image-layout.test.ts
tests/integration/linker/aarch64-backend-to-linker.test.ts
```

## Shared Imports

Use these imports in `src/pe-coff/**` when deterministic ordering or fingerprints are needed:

```ts
import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import { stableHash, stableJson } from "../shared/stable-json";
```

Files under `src/pe-coff/aarch64/**` use one extra `../`:

```ts
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { stableHash, stableJson } from "../../shared/stable-json";
```

Use linker public types only:

```ts
import type {
  AArch64LinkedImageLayout,
  ImageBaseRelocation,
  LinkedDataDirectorySource,
  LinkedImageSection,
} from "../linker";
```

Do not import backend object modules, backend verifier internals, filesystem APIs, Bun APIs, or external PE libraries from runtime writer code.

## Shared Numeric Constants

Writer tasks should use these names and values consistently:

```ts
export const PE_DOS_HEADER_SIZE_BYTES = 64;
export const PE_HEADER_OFFSET_BYTES = 0x80;
export const PE_SIGNATURE_BYTES = Object.freeze([0x50, 0x45, 0x00, 0x00]);
export const PE_COFF_FILE_HEADER_SIZE_BYTES = 20;
export const PE32_PLUS_OPTIONAL_HEADER_SIZE_BYTES = 0xf0;
export const PE32_PLUS_OPTIONAL_HEADER_FIXED_SIZE_BYTES = 112;
export const PE_DATA_DIRECTORY_COUNT = 16;
export const PE_DATA_DIRECTORY_SIZE_BYTES = 8;
export const PE_SECTION_HEADER_SIZE_BYTES = 40;
export const PE32_PLUS_MAGIC = 0x20b;
export const PE_MACHINE_ARM64 = 0xaa64;
export const PE_SUBSYSTEM_EFI_APPLICATION = 10;
export const PE_FILE_ALIGNMENT_BYTES = 512;
export const PE_SECTION_ALIGNMENT_BYTES = 4096;
export const PE_FIRST_SECTION_RVA = 0x1000;
export const PE_IMAGE_REL_BASED_ABSOLUTE = 0;
export const PE_IMAGE_REL_BASED_HIGHLOW = 3;
export const PE_IMAGE_REL_BASED_DIR64 = 10;
export const PE_RELOC_SECTION_CHARACTERISTICS = 0x42000040;
```

## Task 1: Linker Header Page Reservation

**Description:** Update the internal linker so production linked images reserve the PE header page and start the first output section at RVA `0x1000`. This is a prerequisite for writer integration because the writer must preserve linker RVAs and cannot shift sections.

**Dependencies:** None.

**Files:**

- Modify: `src/linker/aarch64/aarch64-section-policy.ts`
- Modify: `src/linker/image-layout-policy.ts`
- Modify: `src/linker/section-layout.ts`
- Modify: `src/linker/verifier.ts`
- Modify: `tests/unit/linker/aarch64-target-policy.test.ts`
- Modify: `tests/unit/linker/section-layout.test.ts`
- Modify: `tests/unit/linker/linked-image-verifier.test.ts`
- Modify: `tests/unit/linker/linked-image-layout.test.ts`
- Modify: `tests/unit/linker/relocation-application.test.ts`
- Modify: `tests/unit/linker/symbol-rva.test.ts`
- Modify: `tests/unit/linker/entry-resolution.test.ts`
- Modify: `tests/unit/linker/linker-property.test.ts`
- Modify: `tests/unit/linker/unwind-metadata.test.ts`
- Modify: `tests/unit/linker/linker-fixtures-contract.test.ts`
- Modify: `tests/unit/linker/aarch64-api.test.ts`
- Modify: `tests/unit/linker/aarch64-link-orchestration.test.ts`
- Modify: `tests/unit/linker/veneer-fixed-point.test.ts`
- Modify: `tests/integration/linker/aarch64-linked-image-layout.test.ts`
- Modify: `tests/integration/linker/aarch64-backend-to-linker.test.ts`

**AC:**

- `AArch64LinkerTargetConstants` has `firstSectionRva: number`.
- Production linker constants set `firstSectionRva: 4096`.
- Target authentication rejects missing, non-integer, negative, unaligned, or changed `firstSectionRva`.
- `targetPolicyFingerprint` changes when `firstSectionRva` changes in tests.
- `layoutImageSections` starts section layout from `target.constants.firstSectionRva`, not `0`.
- Linked image verifier rejects any first section RVA below `target.constants.firstSectionRva`.
- Existing linker integration tests expect entry and boot RVAs at or above `0x1000`.
- All linker tests pass with shifted RVAs: `bun test ./tests/unit/linker ./tests/integration/linker`.
- Veneer range and fixed-point tests are re-derived for the new base RVA when necessary; do not mechanically add `0x1000` to a branch-range expectation without checking the signed branch displacement being tested.

**Code Examples:**

```ts
test("production linker target reserves the PE header page", () => {
  const result = authenticateAArch64LinkerTargetSurface();
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected authenticated target");

  expect(result.value.constants.firstSectionRva).toBe(0x1000);
});
```

```ts
test("places the first linked section after the PE header page", () => {
  const result = layoutImageSections({
    target: targetSurfaceForTest(),
    graph: normalizedGraphForTest({
      sections: [textSectionForLinkTest({ stableKey: ".text.boot" })],
    }),
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected section layout");
  expect(result.value.sections[0]?.rva).toBe(0x1000);
});
```

**Steps:**

- [ ] Add failing target-policy tests for `firstSectionRva`.
- [ ] Add failing section-layout and linked-image-verifier tests for first section RVA.
- [ ] Run `bun test ./tests/unit/linker/aarch64-target-policy.test.ts ./tests/unit/linker/section-layout.test.ts ./tests/unit/linker/linked-image-verifier.test.ts`; expect failures around missing `firstSectionRva` behavior.
- [ ] Add `firstSectionRva` to `AArch64LinkerTargetConstants`, production constants, validation, normalization, and fingerprinting.
- [ ] Change `layoutImageSections` to initialize `nextSectionRva` from `input.target.constants.firstSectionRva`.
- [ ] Add linked-image verifier checks for header-page collisions.
- [ ] Update linker unit and integration expectations that assumed RVA `0`, including symbol RVAs, relocation application sites, unwind metadata, public API smoke tests, and linker property snapshots.
- [ ] Re-derive veneer fixed-point expectations from actual branch displacements after the 4 KiB section-base shift.
- [ ] Run `bun test ./tests/unit/linker ./tests/integration/linker`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the linker prerequisite changes.

## Task 2: PE/COFF Diagnostics, Results, And Artifact Types

**Description:** Create writer-owned diagnostics, deterministic sorting, result helpers, verification summaries, and artifact metadata types. This task is foundational and can land before the writer target surface.

**Dependencies:** None.

**Files:**

- Create: `src/pe-coff/diagnostics.ts`
- Create: `src/pe-coff/index.ts`
- Create: `tests/unit/pe-coff/diagnostics.test.ts`

**AC:**

- `PeCoffWriterDiagnosticCode` includes stable codes for target authentication, input layout validation, section planning, data directory planning, relocation serialization, header planning, serialization, parse failure, verification failure, and file sink failure.
- `PeCoffWriterDiagnostic` follows linker diagnostic shape: `severity`, `code`, `message`, `ownerKey`, `rootCauseKey`, `stableDetail`, sorted `provenance`, and deterministic `order`.
- There is no writer diagnostic mode type in v1; every task emits deterministic errors and optional notes directly through diagnostics.
- `PeCoffWriterVerificationSummary` and `PeCoffWriterVerifierRun` match the design shape.
- `PeCoffWriterResult<T>`, `peCoffOk`, and `peCoffError` freeze records and sort diagnostics deterministically.
- `PeCoffEfiImageArtifact` and `PeCoffEfiDeterministicMetadata` are exported from `src/pe-coff/index.ts`.
- `bun test ./tests/unit/pe-coff/diagnostics.test.ts` passes.

**Code Examples:**

```ts
export interface PeCoffWriterDiagnostic {
  readonly severity: "error" | "warning" | "note";
  readonly code: PeCoffWriterDiagnosticCode;
  readonly message: string;
  readonly ownerKey: string;
  readonly rootCauseKey: string;
  readonly stableDetail: string;
  readonly provenance: readonly string[];
  readonly order: {
    readonly code: PeCoffWriterDiagnosticCode;
    readonly ownerKey: string;
    readonly rootCauseKey: string;
    readonly stableDetail: string;
    readonly provenance: string;
  };
}
```

```ts
test("sorts PE/COFF diagnostics deterministically", () => {
  const diagnostics = sortPeCoffWriterDiagnostics([
    peCoffWriterDiagnostic({
      code: "PE_COFF_INPUT_INVALID",
      ownerKey: "writer",
      stableDetail: "section:b",
    }),
    peCoffWriterDiagnostic({
      code: "PE_COFF_INPUT_INVALID",
      ownerKey: "writer",
      stableDetail: "section:a",
    }),
  ]);

  expect(diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "section:a",
    "section:b",
  ]);
});
```

```ts
const PE_COFF_WRITER_PASSED_VERIFICATION: PeCoffWriterVerificationSummary = Object.freeze({
  runs: Object.freeze([
    Object.freeze({
      verifierKey: "pe-coff-writer-test",
      runKey: "diagnostics",
      status: "passed" as const,
    }),
  ]),
});
```

**Steps:**

- [ ] Add failing diagnostics tests for sorting, freezing, result helpers, and artifact metadata shape.
- [ ] Run `bun test ./tests/unit/pe-coff/diagnostics.test.ts`; expect missing module/export failures.
- [ ] Implement `src/pe-coff/diagnostics.ts`.
- [ ] Export diagnostics and artifact types from `src/pe-coff/index.ts`.
- [ ] Run `bun test ./tests/unit/pe-coff/diagnostics.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit diagnostics and artifact type files.

## Task 3: Authenticated AArch64 PE/COFF Writer Target Surface

**Description:** Add the authenticated writer target surface for `wrela-uefi-aarch64-rpi5-v1`, including exact v1 constants, section-name mapping, writer target fingerprinting, and validation diagnostics.

**Dependencies:** Task 2.

**Files:**

- Create: `src/pe-coff/aarch64/aarch64-pe-coff-target.ts`
- Modify: `src/pe-coff/index.ts`
- Create: `tests/support/pe-coff/pe-coff-fixtures.ts`
- Create: `tests/unit/pe-coff/aarch64-target.test.ts`

**AC:**

- `authenticateAArch64PeCoffEfiWriterTargetSurface` returns production defaults when given `linkedTargetPolicyFingerprint`.
- V1 constants are pinned: machine `0xaa64`, optional magic `0x20b`, subsystem `10`, image base `0n`, section alignment `4096`, file alignment `512`, first section RVA `4096`, image cap `128 * 1024 * 1024`, 16 data directories, `e_lfanew = 0x80`, zero timestamps and version fields, zero stack/heap sizes, zero `dllCharacteristics`.
- The production serialized section-name mapping includes `.text`, `.rdata`, `.data`, `.pdata`, `.xdata`, `.debug$wrela -> .debug`, and `.reloc`.
- Authentication rejects changed constants, long section names, non-ASCII names, duplicate serialized names, missing required names, and mismatched target key.
- The target fingerprint uses `stableJson` and `stableHash`, includes every authenticated field, and is deterministic under key reordering.
- `tests/support/pe-coff/pe-coff-fixtures.ts` exports `productionWriterTargetInputForTest`, `writerTargetForTest`, and `dir64RelocationForTest`.
- The fixture file intentionally does not export layout or integration helpers yet; Task 6 adds `linkedImageLayoutForPeCoffTest` and Task 13 adds `writerTargetForLinkedLayout`.
- `bun test ./tests/unit/pe-coff/aarch64-target.test.ts` passes.

**Code Examples:**

```ts
test("authenticates the production AArch64 PE/COFF EFI writer target", () => {
  const result = authenticateAArch64PeCoffEfiWriterTargetSurface({
    linkedTargetPolicyFingerprint: "stable-hash:linker-policy",
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected authenticated writer target");
  expect(result.value.machine).toBe(0xaa64);
  expect(result.value.optionalHeaderMagic).toBe(0x20b);
  expect(result.value.subsystem).toBe(10);
  expect(result.value.serializedSectionNames[".debug$wrela"]).toBe(".debug");
});
```

```ts
test("rejects duplicate serialized section names", () => {
  const result = authenticateAArch64PeCoffEfiWriterTargetSurface({
    ...productionWriterTargetInputForTest(),
    serializedSectionNames: {
      ...productionWriterTargetInputForTest().serializedSectionNames,
      ".debug$wrela": ".text",
    },
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
    "target:duplicate-section-name:.text",
  );
});
```

**Steps:**

- [ ] Add failing tests for production authentication and invalid surfaces.
- [ ] Run `bun test ./tests/unit/pe-coff/aarch64-target.test.ts`; expect missing target module failures.
- [ ] Implement writer constants, input/surface interfaces, authentication overloads, and validation.
- [ ] Create `tests/support/pe-coff/pe-coff-fixtures.ts` with `productionWriterTargetInputForTest`, `writerTargetForTest`, and `dir64RelocationForTest`.
- [ ] Export target APIs from `src/pe-coff/index.ts`.
- [ ] Run `bun test ./tests/unit/pe-coff/aarch64-target.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit target surface files.

## Task 4: PE Constants And Little-Endian Byte Writer

**Description:** Add local PE constants and a dependency-free byte writer that performs explicit little-endian writes with range checking and deterministic diagnostics.

**Dependencies:** Task 2.

**Files:**

- Create: `src/pe-coff/headers.ts`
- Create: `src/pe-coff/pe-byte-writer.ts`
- Modify: `src/pe-coff/index.ts`
- Create: `tests/unit/pe-coff/pe-byte-writer.test.ts`

**AC:**

- `headers.ts` exports the shared constants listed in this plan.
- `createPeByteWriter` supports `offset`, `bytes`, `writeU8`, `writeU16Le`, `writeU32Le`, `writeU64Le`, `writeBytes`, `writeZeroes`, and `patchU32Le`.
- Writers reject negative values, non-integers, values above the target width, negative zero counts, and patch offsets outside already-written bytes.
- Writer failures are `PeCoffWriterResult` errors with stable diagnostics, not thrown exceptions for ordinary range failures.
- Returned byte arrays are frozen copies and cannot be mutated through writer internals.
- `bun test ./tests/unit/pe-coff/pe-byte-writer.test.ts` passes.

**Code Examples:**

```ts
test("writes little-endian unsigned integers", () => {
  const writer = createPeByteWriter();
  expect(writer.writeU16Le(0x1234).kind).toBe("ok");
  expect(writer.writeU32Le(0x89abcdef).kind).toBe("ok");
  expect(writer.writeU64Le(0x0102030405060708n).kind).toBe("ok");

  expect(writer.bytes()).toEqual([
    0x34, 0x12, 0xef, 0xcd, 0xab, 0x89, 0x08, 0x07, 0x06, 0x05, 0x04, 0x03, 0x02, 0x01,
  ]);
});
```

```ts
test("rejects u32 overflow without truncating", () => {
  const writer = createPeByteWriter();
  const result = writer.writeU32Le(0x1_0000_0000);

  expect(result.kind).toBe("error");
  expect(writer.bytes()).toEqual([]);
});
```

**Steps:**

- [ ] Add failing byte writer tests for endian output, overflow, patching, zeroes, and frozen copies.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-byte-writer.test.ts`; expect missing module failures.
- [ ] Implement `headers.ts` constants.
- [ ] Implement `pe-byte-writer.ts` with result-returning methods.
- [ ] Export constants and writer helpers from `src/pe-coff/index.ts`.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-byte-writer.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit byte writer and constant files.

## Task 5: Base Relocation Table Serialization

**Description:** Serialize linker `ImageBaseRelocation` records into PE base relocation blocks with deterministic sorting, page grouping, DIR64 entries, fail-closed rejection for unsupported relocation kinds, and ABSOLUTE padding for odd entry counts.

**Dependencies:** Tasks 2, 3, and 4.

**Files:**

- Create: `src/pe-coff/pe-relocations.ts`
- Modify: `src/pe-coff/index.ts`
- Create: `tests/unit/pe-coff/pe-relocations.test.ts`

**AC:**

- `serializePeBaseRelocations` accepts readonly `ImageBaseRelocation[]` and writer target policy.
- Empty input returns empty bytes and empty planned records.
- Relocations sort by `rva`, then `stableKey`.
- Duplicate RVAs fail.
- `dir64` requires `widthBytes === 8` and encodes type `10`.
- `highlow` always fails for production AArch64 in v1, even with `widthBytes === 4`; there is no v1 test policy flag for accepting it.
- `target-specific` fails in v1.
- Relocations group by `floor(rva / 4096) * 4096`.
- Odd entry counts append one ABSOLUTE padding entry.
- `BlockSize` equals `8 + 2 * entryCountIncludingPadding`.
- `bun test ./tests/unit/pe-coff/pe-relocations.test.ts` passes.

**Code Examples:**

```ts
test("serializes one DIR64 base relocation block", () => {
  const result = serializePeBaseRelocations({
    target: writerTargetForTest(),
    relocations: [
      {
        stableKey: "base-reloc:dir64:.data:8192",
        kind: "dir64",
        sectionKey: ".data",
        rva: 0x2000,
        widthBytes: 8,
        sourceRelocationKey: "module:test:reloc:absolute",
      },
    ],
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected relocation bytes");
  expect(result.value.bytes).toEqual([
    0x00, 0x20, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x00, 0x00, 0xa0, 0x00, 0x00,
  ]);
});
```

```ts
test("rejects HIGHLOW base relocations for production AArch64 v1", () => {
  const result = serializePeBaseRelocations({
    target: writerTargetForTest(),
    relocations: [
      {
        stableKey: "base-reloc:highlow:.data:8192",
        kind: "highlow",
        sectionKey: ".data",
        rva: 0x2000,
        widthBytes: 4,
        sourceRelocationKey: "module:test:reloc:absolute32",
      },
    ],
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
    "base-relocation:unsupported-kind:base-reloc:highlow:.data:8192:highlow",
  );
});
```

```ts
test("rejects duplicate base relocation RVAs", () => {
  const result = serializePeBaseRelocations({
    target: writerTargetForTest(),
    relocations: [
      dir64RelocationForTest({ stableKey: "a", rva: 0x2008 }),
      dir64RelocationForTest({ stableKey: "b", rva: 0x2008 }),
    ],
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
    "base-relocation:duplicate-rva:8200",
  );
});
```

**Steps:**

- [ ] Add failing tests for empty, single DIR64, sorted multi-page, odd padding, duplicate RVA, bad width, and unsupported kind.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-relocations.test.ts`; expect missing serializer failures.
- [ ] Implement relocation planning records and serialization in `src/pe-coff/pe-relocations.ts`.
- [ ] Export relocation APIs from `src/pe-coff/index.ts`.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-relocations.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit relocation serializer files.

## Task 6: Linked Layout Validation For Writer Input

**Description:** Validate that a linked layout is safe for PE serialization before any byte planning. This task enforces passed linker verification, first-section RVA, contiguous virtual layout, section-name mapping, data-directory bounds, base relocation containment, and linked-section image-size preconditions.

**Dependencies:** Tasks 2, 3, and 4.

**Files:**

- Create: `src/pe-coff/pe-file-layout.ts`
- Modify: `src/pe-coff/index.ts`
- Modify: `tests/support/pe-coff/pe-coff-fixtures.ts`
- Create: `tests/unit/pe-coff/linked-layout-validation.test.ts`

**AC:**

- `validateLinkedImageForPeCoffWriter` returns `ok` for a complete fixture with `.text`, `.pdata`, `.xdata`, and optional `.data`.
- Validation rejects failed linker verification runs.
- Validation rejects entry RVA outside executable section.
- Validation rejects first section below `firstSectionRva`.
- Validation rejects section `alignmentBytes` not equal to target `sectionAlignmentBytes`.
- Validation rejects non-contiguous aligned virtual order using this exact predicate: the first section RVA must equal `target.constants.firstSectionRva`, and for every adjacent pair, `next.rva === align(previous.rva + previous.virtualSizeBytes, target.constants.sectionAlignmentBytes)`.
- Validation rejects duplicate/missing serialized section names through target validation or layout validation.
- Validation rejects data-directory sources outside their named linked section.
- Validation rejects base relocation ranges that extend past section end.
- Validation rejects linked-section virtual end above `maxImageSizeBytes`; Task 7 enforces the final planned image cap after generated `.reloc` and headers are known.
- `bun test ./tests/unit/pe-coff/linked-layout-validation.test.ts` passes.

**Code Examples:**

```ts
test("rejects layout whose linker verification failed", () => {
  const layout = linkedImageLayoutForPeCoffTest({
    verification: {
      runs: [
        {
          verifierKey: "linker-fixture",
          runKey: "layout",
          status: "failed",
        },
      ],
    },
  });

  const result = validateLinkedImageForPeCoffWriter({
    target: writerTargetForTest(),
    layout,
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
    "layout-verification:failed:linker-fixture:layout",
  );
});
```

```ts
test("rejects base relocation ranges outside the named section", () => {
  const layout = linkedImageLayoutForPeCoffTest({
    baseRelocations: [
      {
        stableKey: "base-reloc:dir64:.data:12284",
        kind: "dir64",
        sectionKey: ".data",
        rva: 0x2ffc,
        widthBytes: 8,
        sourceRelocationKey: "module:test:reloc:absolute",
      },
    ],
  });

  const result = validateLinkedImageForPeCoffWriter({
    target: writerTargetForTest(),
    layout,
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
    "base-relocation:range-outside-section:base-reloc:dir64:.data:12284",
  );
});
```

**Steps:**

- [ ] Add `linkedImageLayoutForPeCoffTest` to `tests/support/pe-coff/pe-coff-fixtures.ts`, reusing the Task 3 target and relocation helpers.
- [ ] Add failing layout validation tests for every AC bullet.
- [ ] Run `bun test ./tests/unit/pe-coff/linked-layout-validation.test.ts`; expect missing validation failures.
- [ ] Implement validation helpers in `src/pe-coff/pe-file-layout.ts`.
- [ ] Export validation helpers from `src/pe-coff/index.ts`.
- [ ] Run `bun test ./tests/unit/pe-coff/linked-layout-validation.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit layout validation files.

## Task 7: Section And Data Directory Planning

**Description:** Plan PE sections from linked sections plus generated `.reloc`, assign raw file offsets and raw sizes, map section names, and produce the 16-entry data-directory table.

**Dependencies:** Tasks 2, 3, 4, 5, and 6.

**Files:**

- Modify: `src/pe-coff/pe-file-layout.ts`
- Create: `tests/unit/pe-coff/pe-file-layout.test.ts`

**AC:**

- `planPeCoffSections` preserves linked section `rva`, `virtualSizeBytes`, `flags`, and `bytes`.
- `planPeCoffSections` maps `.debug$wrela` to serialized name `.debug`.
- `planPeCoffSections` appends `.reloc` only when serialized relocation bytes are non-empty.
- `.reloc` `VirtualSize` is exact relocation table byte length.
- `.reloc` `SizeOfRawData` is aligned to file alignment.
- `SizeOfHeaders` equals aligned end of section table.
- Raw data pointers start at `SizeOfHeaders` and advance by file-aligned raw sizes.
- `planPeDataDirectories` emits 16 entries.
- Exception directory points at the linked `.pdata` source when present.
- Base relocation directory points at generated `.reloc` RVA with exact table length.
- Unsupported directories are zero.
- Debug directory source fails in v1; Task 7 does not add a target policy flag for debug directories.
- Final planned `SizeOfImage`, including the header page, linked sections, and generated `.reloc`, is less than or equal to `target.constants.maxImageSizeBytes`.
- `bun test ./tests/unit/pe-coff/pe-file-layout.test.ts` passes.

**Code Examples:**

```ts
test("plans linked sections and generated reloc section", () => {
  const result = planPeCoffSections({
    target: writerTargetForTest(),
    layout: linkedImageLayoutForPeCoffTest({
      baseRelocations: [dir64RelocationForTest({ rva: 0x3000 })],
    }),
    baseRelocationTableBytes: [
      0x00, 0x30, 0x00, 0x00, 0x0c, 0x00, 0x00, 0x00, 0x00, 0xa0, 0x00, 0x00,
    ],
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected planned sections");
  expect(result.value.sections.map((section) => section.sectionKey)).toContain(".reloc");
  expect(result.value.sections.find((section) => section.sectionKey === ".reloc")).toEqual(
    expect.objectContaining({
      serializedName: ".reloc",
      virtualSizeBytes: 12,
      rawDataSizeBytes: 512,
      characteristics: 0x42000040,
    }),
  );
});
```

```ts
test("emits exception and base relocation directories", () => {
  const result = planPeDataDirectories({
    target: writerTargetForTest(),
    layout: linkedImageLayoutForPeCoffTest(),
    sections: plannedSectionsForDirectoryTest(),
    baseRelocationTableSizeBytes: 12,
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected directories");
  expect(result.value.directories[3]).toEqual({ rva: 0x2000, sizeBytes: 8 });
  expect(result.value.directories[5]).toEqual({ rva: 0x4000, sizeBytes: 12 });
});
```

**Steps:**

- [ ] Add failing section planning tests for linked sections, `.debug$wrela`, `.reloc`, headers size, and raw offsets.
- [ ] Add failing data-directory tests for exception, base relocation, zero unsupported entries, and rejected debug directory sources.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-file-layout.test.ts`; expect missing planner failures.
- [ ] Implement planned section types, `alignPe`, `planPeCoffSections`, `planPeDataDirectories`, and final planned image-cap validation.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-file-layout.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit section and directory planning changes.

## Task 8: PE Header Planning

**Description:** Compute COFF and PE32+ optional header fields from the target, planned sections, data directories, and linked entry RVA.

**Dependencies:** Tasks 2, 3, 4, and 7.

**Files:**

- Modify: `src/pe-coff/headers.ts`
- Modify: `src/pe-coff/pe-file-layout.ts`
- Modify: `tests/unit/pe-coff/pe-file-layout.test.ts`

**AC:**

- `planPeHeaders` computes DOS header config, COFF file header, optional header, and aggregate sizes.
- COFF file header uses machine `0xaa64`, zero symbol table fields, timestamp `0`, `SizeOfOptionalHeader = 0xf0`, and characteristics `0x0022`.
- Optional header uses magic `0x20b`, entry RVA from layout, image base `0n`, section alignment `4096`, file alignment `512`, subsystem `10`, zero checksum, zero stack/heap sizes, zero loader flags, and 16 data directories.
- `BaseOfCode` is first executable planned section RVA and missing executable sections fail.
- `SizeOfCode` sums raw sizes for executable sections.
- `SizeOfInitializedData` sums raw sizes for initialized non-executable sections.
- `SizeOfImage` covers header page, linked sections, and generated `.reloc`.
- `SizeOfHeaders` is file-aligned end of section table.
- Header planning rejects field-width overflow.
- `bun test ./tests/unit/pe-coff/pe-file-layout.test.ts` passes.

**Code Examples:**

```ts
test("plans PE32+ optional header fields", () => {
  const result = planPeHeaders({
    target: writerTargetForTest(),
    layout: linkedImageLayoutForPeCoffTest(),
    sections: plannedSectionsForHeaderTest(),
    dataDirectories: zeroDirectoriesForHeaderTest(),
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected PE headers");
  expect(result.value.optionalHeader.magic).toBe(0x20b);
  expect(result.value.optionalHeader.addressOfEntryPoint).toBe(0x1000);
  expect(result.value.optionalHeader.baseOfCode).toBe(0x1000);
  expect(result.value.optionalHeader.subsystem).toBe(10);
  expect(result.value.optionalHeader.numberOfRvaAndSizes).toBe(16);
});
```

```ts
test("rejects missing executable section instead of using BaseOfCode 0", () => {
  const result = planPeHeaders({
    target: writerTargetForTest(),
    layout: linkedImageLayoutForPeCoffTest({ entryRva: 0x2000 }),
    sections: plannedSectionsForHeaderTest().filter((section) => section.sectionKey !== ".text"),
    dataDirectories: zeroDirectoriesForHeaderTest(),
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
    "optional-header:missing-executable-section",
  );
});
```

**Steps:**

- [ ] Add failing header planning tests for aggregate sizes, PE32+ fields, missing executable section, and overflow.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-file-layout.test.ts`; expect header planner failures.
- [ ] Implement COFF and optional header planning records in `headers.ts`.
- [ ] Implement `planPeHeaders` in `pe-file-layout.ts`.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-file-layout.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit header planning changes.

## Task 9: Full PE Image Serialization

**Description:** Serialize the planned PE model into final bytes: DOS header, zero padding, PE signature, COFF header, PE32+ optional header, data directories, section table, section bodies, and file-alignment padding.

**Dependencies:** Tasks 2, 4, 5, 7, and 8.

**Files:**

- Create: `src/pe-coff/aarch64/aarch64-pe-coff-efi-writer.ts`
- Modify: `src/pe-coff/headers.ts`
- Modify: `src/pe-coff/pe-file-layout.ts`
- Modify: `src/pe-coff/index.ts`
- Modify: `tests/support/pe-coff/pe-coff-fixtures.ts`
- Create: `tests/unit/pe-coff/aarch64-pe-coff-efi-writer.test.ts`

**AC:**

- `serializePlannedPeCoffImage` writes fixed DOS bytes with `MZ` and `e_lfanew = 0x80`.
- PE signature appears at offset `0x80`.
- COFF header starts at offset `0x84`.
- Optional header starts at offset `0x98`.
- Section table follows the optional header and 16 data directories.
- Section names are null-padded ASCII in 8-byte fields.
- Section raw pointers and raw sizes match planned sections.
- Section bodies are written exactly at planned raw pointers.
- File-alignment padding bytes are zero.
- Serialized bytes length equals the end of the final file-aligned raw section.
- Serialization fails if a writer helper reports a field-width error.
- `tests/support/pe-coff/pe-coff-fixtures.ts` exports `plannedImageForWriterTest`, `serializedImageBytesForParserTest`, and `serializedBytesForPlannedImage` for downstream parser and verifier tasks.
- `bun test ./tests/unit/pe-coff/aarch64-pe-coff-efi-writer.test.ts` passes.

**Code Examples:**

```ts
test("serializes fixed DOS and PE signatures", () => {
  const result = serializePlannedPeCoffImage(plannedImageForWriterTest());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected serialized image");
  expect(result.value.bytes.slice(0, 2)).toEqual([0x4d, 0x5a]);
  expect(result.value.bytes.slice(0x3c, 0x40)).toEqual([0x80, 0x00, 0x00, 0x00]);
  expect(result.value.bytes.slice(0x80, 0x84)).toEqual([0x50, 0x45, 0x00, 0x00]);
});
```

```ts
test("writes section bytes at planned raw pointers", () => {
  const result = serializePlannedPeCoffImage(plannedImageForWriterTest());
  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected serialized image");

  const textRawPointer = plannedImageForWriterTest().sections[0]!.rawDataPointer;
  expect(result.value.bytes.slice(textRawPointer, textRawPointer + 4)).toEqual([
    0xc0, 0x03, 0x5f, 0xd6,
  ]);
});
```

**Steps:**

- [ ] Add failing serialization tests for DOS header, PE signature, section table, raw pointers, and section body bytes.
- [ ] Run `bun test ./tests/unit/pe-coff/aarch64-pe-coff-efi-writer.test.ts`; expect missing serializer failures.
- [ ] Implement header/table/section serialization using `createPeByteWriter`.
- [ ] Add `plannedImageForWriterTest`, `serializedImageBytesForParserTest`, and `serializedBytesForPlannedImage` to `tests/support/pe-coff/pe-coff-fixtures.ts`.
- [ ] Export serializer internals needed by parser/verifier tests from `src/pe-coff/index.ts`.
- [ ] Run `bun test ./tests/unit/pe-coff/aarch64-pe-coff-efi-writer.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit serializer changes.

## Task 10: Strict PE Parser

**Description:** Add a strict local parser for Wrela-emitted PE32+ images. The parser returns diagnostics instead of throwing on malformed bytes and extracts enough structure for parse-back verification.

**Dependencies:** Tasks 2, 4, 5, and 9.

**Files:**

- Create: `src/pe-coff/pe-parser.ts`
- Modify: `src/pe-coff/index.ts`
- Create: `tests/unit/pe-coff/pe-parser.test.ts`

**AC:**

- `parsePeCoffImage` accepts readonly byte arrays.
- Parser rejects truncated DOS header, missing `MZ`, invalid `e_lfanew`, missing PE signature, truncated COFF header, non-ARM64 machine, invalid optional header size, invalid PE32+ magic, and directory count not equal to 16.
- Parser returns parsed DOS header, COFF header, PE32+ optional header, data directories, section headers, and base relocation blocks.
- Parser validates section headers stay within the file and raw section ranges do not exceed bytes length.
- Parser validates `.reloc` block size, alignment, and bounds when a base relocation directory is present.
- Parser never throws on arbitrary byte arrays.
- Valid-image parser tests use `serializedImageBytesForParserTest` from the Task 9 serializer fixtures instead of hand-building PE bytes.
- `bun test ./tests/unit/pe-coff/pe-parser.test.ts` passes.

**Code Examples:**

```ts
test("parses a serialized PE32+ image", () => {
  const bytes = serializedImageBytesForParserTest();
  const result = parsePeCoffImage(bytes);

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected parsed image");
  expect(result.value.dosHeader.e_lfanew).toBe(0x80);
  expect(result.value.coffHeader.machine).toBe(0xaa64);
  expect(result.value.optionalHeader.magic).toBe(0x20b);
  expect(result.value.dataDirectories).toHaveLength(16);
});
```

```ts
test("returns diagnostics instead of throwing for arbitrary short bytes", () => {
  const result = parsePeCoffImage([0x4d]);

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
    "dos-header:truncated",
  );
});
```

**Steps:**

- [ ] Add failing parser tests for valid image, malformed headers, malformed section table, malformed relocation blocks, and arbitrary short bytes.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-parser.test.ts`; expect missing parser failures.
- [ ] Implement bounded little-endian readers and parsed PE model types in `pe-parser.ts`.
- [ ] Export parser APIs from `src/pe-coff/index.ts`.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-parser.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit parser changes.

## Task 11: Parse-Back Verifier

**Description:** Compare parsed PE bytes against the planned writer model with semantic field assertions, including headers, sections, data directories, entry RVA, image size, section bytes, and base relocation blocks.

**Dependencies:** Tasks 2, 5, 7, 8, 9, and 10.

**Files:**

- Create: `src/pe-coff/pe-verifier.ts`
- Modify: `src/pe-coff/index.ts`
- Create: `tests/unit/pe-coff/pe-verifier.test.ts`

**AC:**

- `verifyParsedPeCoffImage` passes for planned bytes produced by the serializer.
- Verifier detects mismatched machine, optional header magic, subsystem, entry RVA, image base, alignments, image size, headers size, and data directory count.
- Verifier detects mismatched section names, RVAs, virtual sizes, raw pointers, raw sizes, characteristics, section bytes, and non-zero section relocation fields.
- Verifier detects mismatched exception and base relocation directories.
- Verifier reconstructs `.reloc` entries, ignores ABSOLUTE padding, and compares relocation RVAs and types to planned base relocation records.
- Verifier diagnostics are deterministic.
- Pass-case verifier tests use Task 9 serializer helpers to produce bytes from the planned model before parsing.
- `bun test ./tests/unit/pe-coff/pe-verifier.test.ts` passes.

**Code Examples:**

```ts
test("verifies parsed image against the planned writer model", () => {
  const planned = plannedImageForVerifierTest();
  const parsed = parsePeCoffImage(serializedBytesForPlannedImage(planned));
  expect(parsed.kind).toBe("ok");
  if (parsed.kind !== "ok") throw new Error("expected parsed image");

  const result = verifyParsedPeCoffImage({ planned, parsed: parsed.value });
  expect(result.kind).toBe("ok");
});
```

```ts
test("detects entry RVA mismatch", () => {
  const planned = plannedImageForVerifierTest();
  const parsed = parsedImageForVerifierTest({
    optionalHeader: {
      ...parsedImageForVerifierTest().optionalHeader,
      addressOfEntryPoint: 0x2000,
    },
  });

  const result = verifyParsedPeCoffImage({ planned, parsed });
  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
    "optional-header:entry-rva",
  );
});
```

**Steps:**

- [ ] Add failing verifier tests for pass case and each mismatch category in AC.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-verifier.test.ts`; expect missing verifier failures.
- [ ] Implement verifier comparison helpers and relocation reconstruction in `pe-verifier.ts`.
- [ ] Export verifier APIs from `src/pe-coff/index.ts`.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-verifier.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit verifier changes.

## Task 12: Public AArch64 Writer Orchestration API

**Description:** Implement `writeAArch64PeCoffEfiImage`, connecting target validation, linked layout validation, base relocation serialization, section/data-directory/header planning, serialization, parsing, verification, diagnostics, deterministic metadata, and artifact creation.

**Dependencies:** Tasks 2 through 11.

**Files:**

- Modify: `src/pe-coff/aarch64/aarch64-pe-coff-efi-writer.ts`
- Modify: `src/pe-coff/index.ts`
- Modify: `tests/unit/pe-coff/aarch64-pe-coff-efi-writer.test.ts`

**AC:**

- `writeAArch64PeCoffEfiImage` accepts `layout`, authenticated writer `target`, and optional `artifactName`.
- Omitted artifact name defaults to `wrela.efi`.
- Supplied artifact name must be a single file name ending in `.efi`.
- Error results include passed orchestration stages before the failed stage and one failed stage.
- Stage prefixes are derived from one ordered stage list with exactly these stage keys: `target`, `input-layout`, `base-relocations`, `sections`, `headers`, `serialize`, `parse`, `verify`.
- Successful artifacts have media type `application/vnd.microsoft.portable-executable`, file extension `.efi`, frozen bytes, deterministic metadata, and verification summary.
- Metadata includes linked layout fingerprint, writer target fingerprint, section table fingerprint, data directory fingerprint, base relocation table fingerprint, header fingerprint, and image fingerprint.
- Same layout and target produce identical bytes and fingerprints.
- `bun test ./tests/unit/pe-coff/aarch64-pe-coff-efi-writer.test.ts` passes.

**Code Examples:**

```ts
test("writes a deterministic EFI artifact", () => {
  const target = writerTargetForTest();
  const layout = linkedImageLayoutForPeCoffTest();

  const first = writeAArch64PeCoffEfiImage({ target, layout });
  const second = writeAArch64PeCoffEfiImage({ target, layout });

  expect(first.kind).toBe("ok");
  expect(second.kind).toBe("ok");
  if (first.kind !== "ok" || second.kind !== "ok") throw new Error("expected artifacts");
  expect(first.artifact.artifactName).toBe("wrela.efi");
  expect(first.artifact.bytes).toEqual(second.artifact.bytes);
  expect(first.artifact.deterministicMetadata.imageFingerprint).toBe(
    second.artifact.deterministicMetadata.imageFingerprint,
  );
});
```

```ts
test("rejects artifact names with path separators", () => {
  const result = writeAArch64PeCoffEfiImage({
    target: writerTargetForTest(),
    layout: linkedImageLayoutForPeCoffTest(),
    artifactName: "out/wrela.efi",
  });

  expect(result.kind).toBe("error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
    "artifact-name:path-separator:out/wrela.efi",
  );
});
```

**Steps:**

- [ ] Add failing orchestration tests for success, deterministic output, bad artifact name, validation failure, parse failure, and verification failure.
- [ ] Run `bun test ./tests/unit/pe-coff/aarch64-pe-coff-efi-writer.test.ts`; expect orchestration failures.
- [ ] Implement stage summary helpers and `writeAArch64PeCoffEfiImage`.
- [ ] Compute deterministic metadata using `stableJson` and `stableHash`.
- [ ] Run `bun test ./tests/unit/pe-coff/aarch64-pe-coff-efi-writer.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit writer orchestration changes.

## Task 13: Linker-To-Writer Integration Tests

**Description:** Prove a real linked image can be serialized as one `.efi` artifact and parsed back with PE32+, ARM64 machine, EFI application subsystem, entry RVA, section table, exception directory, and base relocation directory.

**Dependencies:** Tasks 1 and 12.

**Files:**

- Create: `tests/integration/pe-coff/aarch64-efi-writer.test.ts`
- Modify: `tests/support/pe-coff/pe-coff-fixtures.ts`

**AC:**

- Integration test links a tiny AArch64 image using `linkAArch64Image`, `entryShimProviderForTest`, and `unwindProviderForTest`.
- Writer target uses the linked layout's `targetPolicyFingerprint`.
- Writer produces an artifact whose bytes start with `MZ`, contain `PE\0\0` at `0x80`, and parse as PE32+.
- Parsed COFF machine is `0xaa64`.
- Parsed subsystem is `10`.
- Parsed entry RVA equals `layout.entry.loaderEntryRva`.
- Parsed `.text` section bytes match the linked `.text` section bytes.
- Parsed exception directory points at linked `.pdata`.
- A second integration test links an `addr64` data reference and verifies `.reloc` contains a DIR64 relocation for the linked base relocation.
- Identical linker inputs produce identical `.efi` bytes and image fingerprints.
- `tests/support/pe-coff/pe-coff-fixtures.ts` exports `writerTargetForLinkedLayout`, `bootModuleForPeCoffIntegrationTest`, and `peCoffDataRelocationLinkInputForTest`.
- `bun test ./tests/integration/pe-coff/aarch64-efi-writer.test.ts` passes.

**Code Examples:**

```ts
test("links and writes a PE32+ EFI application", () => {
  const linked = linkAArch64Image({
    objectModules: [bootModuleForPeCoffIntegrationTest()],
    target: targetSurfaceForTest(),
    entry: { wrelaBootLinkageName: "Boot.main" },
    syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
  });
  expect(linked.kind).toBe("ok");
  if (linked.kind !== "ok") throw new Error("expected linked image");

  const target = writerTargetForLinkedLayout(linked.layout);
  const written = writeAArch64PeCoffEfiImage({ target, layout: linked.layout });
  expect(written.kind).toBe("ok");
  if (written.kind !== "ok") throw new Error("expected EFI artifact");

  const parsed = parsePeCoffImage(written.artifact.bytes);
  expect(parsed.kind).toBe("ok");
  if (parsed.kind !== "ok") throw new Error("expected parsed image");
  expect(parsed.value.coffHeader.machine).toBe(0xaa64);
  expect(parsed.value.optionalHeader.subsystem).toBe(10);
  expect(parsed.value.optionalHeader.addressOfEntryPoint).toBe(linked.layout.entry.loaderEntryRva);
});
```

```ts
test("serializes linked DIR64 base relocations into .reloc", () => {
  const linked = linkAArch64Image(peCoffDataRelocationLinkInputForTest());
  expect(linked.kind).toBe("ok");
  if (linked.kind !== "ok") throw new Error("expected linked image");
  expect(linked.layout.baseRelocations).toEqual([
    expect.objectContaining({ kind: "dir64", widthBytes: 8 }),
  ]);

  const written = writeAArch64PeCoffEfiImage({
    target: writerTargetForLinkedLayout(linked.layout),
    layout: linked.layout,
  });
  expect(written.kind).toBe("ok");
  if (written.kind !== "ok") throw new Error("expected EFI artifact");

  const parsed = parsePeCoffImage(written.artifact.bytes);
  expect(parsed.kind).toBe("ok");
  if (parsed.kind !== "ok") throw new Error("expected parsed image");
  expect(parsed.value.baseRelocationBlocks.flatMap((block) => block.entries)).toContainEqual(
    expect.objectContaining({ type: 10 }),
  );
});
```

**Steps:**

- [ ] Add `writerTargetForLinkedLayout`, `bootModuleForPeCoffIntegrationTest`, and `peCoffDataRelocationLinkInputForTest` to `tests/support/pe-coff/pe-coff-fixtures.ts`.
- [ ] Add failing integration tests for tiny EFI image, base relocation image, and deterministic output.
- [ ] Run `bun test ./tests/integration/pe-coff/aarch64-efi-writer.test.ts`; expect failures if any public exports or linker RVA prerequisite are missing.
- [ ] Fix fixture/export gaps without adding new writer behavior outside previous tasks.
- [ ] Run `bun test ./tests/integration/pe-coff/aarch64-efi-writer.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit integration tests and fixture helpers.

## Task 14: Public Exports, File Sink, And Import Policy

**Description:** Export the writer through public barrels, add a dependency-injected file sink at the compiler edge, and enforce import-boundary policy so earlier phases do not import `src/pe-coff`.

**Dependencies:** Task 12.

**Files:**

- Modify: `src/index.ts`
- Modify: `src/pe-coff/index.ts`
- Create: `src/pe-coff/efi-file-sink.ts`
- Modify: `scripts/check-policy.ts`
- Create: `tests/unit/pe-coff/efi-file-sink.test.ts`
- Modify: `tests/integration/public-api.test.ts`
- Create: `tests/audit/pe-coff-writer-audit.test.ts`

**AC:**

- Root `src/index.ts` exports `peCoff` namespace and public writer APIs.
- `src/pe-coff/index.ts` exports target authentication, writer API, parser, artifact types, diagnostics, and file sink types.
- `createPeCoffEfiFileSink` accepts an injected write function and does not import filesystem, Bun, process, path, OS, or host state.
- File sink rejects artifact names with path separators and non-`.efi` extensions even if called directly.
- `scripts/check-policy.ts` forbids frontend, parser, layout, proof, proof-mir, proof-check, OptIR, mono, linker, and AArch64 target internals from importing `src/pe-coff`.
- Policy allows `src/index.ts` and tests to import public `src/pe-coff`.
- Public API integration test proves writer exports from root and `peCoff` namespace.
- Audit test checks PE/COFF runtime files do not import forbidden host modules or backend object internals.
- `bun test ./tests/unit/pe-coff/efi-file-sink.test.ts ./tests/integration/public-api.test.ts ./tests/audit/pe-coff-writer-audit.test.ts` passes.

**Code Examples:**

```ts
test("file sink uses injected write function", () => {
  const writes: { readonly name: string; readonly bytes: readonly number[] }[] = [];
  const sink = createPeCoffEfiFileSink({
    writeBytes: (artifactName, bytes) => {
      writes.push({ name: artifactName, bytes });
      return peCoffOk({
        value: undefined,
        diagnostics: [],
        verification: passedFileSinkVerificationForTest(),
      });
    },
  });

  const result = sink.writeArtifact(efiArtifactForSinkTest({ artifactName: "boot.efi" }));
  expect(result.kind).toBe("ok");
  expect(writes).toEqual([{ name: "boot.efi", bytes: [0x4d, 0x5a] }]);
});
```

```ts
test("root public api exports PE/COFF writer", async () => {
  const api = await import("../../src");

  expect(api.peCoff.authenticateAArch64PeCoffEfiWriterTargetSurface).toBeFunction();
  expect(api.peCoff.writeAArch64PeCoffEfiImage).toBeFunction();
});
```

**Steps:**

- [ ] Add failing file sink, public API, and audit tests.
- [ ] Run `bun test ./tests/unit/pe-coff/efi-file-sink.test.ts ./tests/integration/public-api.test.ts ./tests/audit/pe-coff-writer-audit.test.ts`; expect missing export/policy failures.
- [ ] Implement injected file sink in `src/pe-coff/efi-file-sink.ts`.
- [ ] Export writer APIs from `src/pe-coff/index.ts` and root `src/index.ts`.
- [ ] Extend `scripts/check-policy.ts` with PE/COFF import-boundary checks.
- [ ] Run the focused tests listed in AC; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit exports, sink, and policy changes.

## Task 15: Property Tests, Audit Coverage, And Final Verification

**Description:** Add variance-reducing tests for relocation round-trips, raw offset planning, parser robustness, and source hygiene. This task closes the implementation with full verification.

**Dependencies:** Tasks 1 through 14.

**Files:**

- Create: `tests/unit/pe-coff/pe-coff-property.test.ts`
- Modify: `tests/audit/pe-coff-writer-audit.test.ts`

**AC:**

- Property test round-trips generated unique DIR64 relocation RVAs through serializer and parser.
- Property test validates section raw offset planning for generated section byte lengths within v1 image cap.
- Parser property test confirms arbitrary byte arrays never throw and always return `ok` or `error` results.
- Audit test verifies every runtime file under `src/pe-coff` stays below 1000 lines.
- Audit test verifies no runtime file under `src/pe-coff` imports `bun`, `node:fs`, `node:path`, `node:os`, `node:process`, `fs`, `path`, `os`, `process`, backend object modules, backend verifier internals, or external PE libraries.
- `bun run agent:check` passes.

**Code Examples:**

```ts
test("base relocation serialization round-trips generated DIR64 RVAs", () => {
  fastCheck.assert(
    fastCheck.property(
      fastCheck.uniqueArray(fastCheck.integer({ min: 0x1000, max: 0x1ffff }), {
        selector: (rva) => rva,
        minLength: 1,
        maxLength: 32,
      }),
      (rvas) => {
        const relocations = rvas.map((rva, index) =>
          dir64RelocationForTest({ stableKey: `reloc:${index}`, rva }),
        );
        const serialized = serializePeBaseRelocations({
          target: writerTargetForTest(),
          relocations,
        });
        expect(serialized.kind).toBe("ok");
        if (serialized.kind !== "ok") throw new Error("expected relocation bytes");

        const parsed = parseBaseRelocationBlocksForTest(serialized.value.bytes);
        expect(parsed.kind).toBe("ok");
        if (parsed.kind !== "ok") throw new Error("expected parsed relocation blocks");
        expect(parsed.value.relocationRvas.sort((left, right) => left - right)).toEqual(
          [...rvas].sort((left, right) => left - right),
        );
      },
    ),
  );
});
```

```ts
test("PE/COFF runtime files stay dependency-free", async () => {
  const forbidden =
    /(from\s+["'](?:bun|node:fs|node:path|node:os|node:process|fs|path|os|process)|backend\/object|backend\/verify|pe-library)/;
  const filePaths = await runtimePeCoffSourceFilesForAudit();

  for (const filePath of filePaths) {
    const source = await Bun.file(filePath).text();
    expect(source).not.toMatch(forbidden);
  }
});
```

**Steps:**

- [ ] Add failing property tests for base relocations, section raw offsets, and parser robustness.
- [ ] Add failing audit tests for file size and forbidden imports.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-coff-property.test.ts ./tests/audit/pe-coff-writer-audit.test.ts`; expect any missing helper/audit failures.
- [ ] Add only the helper exports needed for property tests; do not widen production APIs beyond test-visible pure helpers.
- [ ] Run `bun test ./tests/unit/pe-coff/pe-coff-property.test.ts ./tests/audit/pe-coff-writer-audit.test.ts`; expect pass.
- [ ] Run `bun run format`.
- [ ] Run `bun run agent:check`; expect pass.
- [ ] Commit property tests and final audit coverage.

## Final Handoff Checklist

- [ ] `bun run format` passes.
- [ ] `bun run agent:check` passes.
- [ ] Placeholder scan over `src/pe-coff`, `tests/unit/pe-coff`, `tests/integration/pe-coff`, and `tests/audit/pe-coff-writer-audit.test.ts` reports no implementation placeholders.
- [ ] `rg -n "from .*backend/(object|verify)|from .*node:|from .*bun|from .*fs|from .*path|from .*process|from .*os" src/pe-coff` prints no forbidden imports.
- [ ] `bun test ./tests/integration/pe-coff/aarch64-efi-writer.test.ts` passes.
- [ ] `bun test ./tests/audit/pe-coff-writer-audit.test.ts` passes.
