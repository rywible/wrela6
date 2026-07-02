# Internal Linker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the internal AArch64 linked-image layout phase described in `docs/design/internal-linker-design.md`, consuming verified `AArch64ObjectModule` records plus authenticated linker policy and producing deterministic `AArch64LinkedImageLayout` records for the PE/COFF EFI writer.

**Architecture:** First land the AArch64 object-contract migration vertically so every backend call site continues to pass `bun run agent:check`. Then add a dependency-free `src/linker` subsystem for diagnostics, output models, normalized link graphs, deterministic section layout, symbol resolution, symbol RVA materialization, relocation application, base-relocation planning, synthetic image objects, entry/unwind metadata, provenance, and verification, with `src/linker/aarch64` adapting those mechanics to `wrela-uefi-aarch64-rpi5-v1`.

**Tech Stack:** TypeScript, Bun test runner, existing AArch64 backend object model, existing deterministic sort and stable JSON helpers, dependency-injected synthetic object and veneer providers, `fast-check` for tests only.

---

## Research Notes

- Design source: `docs/design/internal-linker-design.md` with 1321 lines.
- Existing object input contract lives in `src/target/aarch64/backend/object/object-module.ts`. It currently has `isGlobal`, lacks section `classKey`, and drops relocation `addend`, pair keys, structured targets, and encoding-owner data.
- Real contract-migration call sites found by `rg`: `src/target/aarch64/backend/object/layout-encode-fixed-point.ts`, `src/target/aarch64/backend/api/object-assembly.ts`, `src/target/aarch64/backend/finalization/physical-instruction-ir.ts`, `src/target/aarch64/backend/api/machine-lowering-branches.ts`, `src/target/aarch64/backend/verify/encoding-object-verifier.ts`, `tests/support/target/aarch64/backend/object-module-fixtures.ts`, `tests/unit/target/aarch64/backend/object-module.test.ts`, `tests/unit/target/aarch64/backend/object-verifier.test.ts`, `tests/unit/target/aarch64/backend/object-verifier-relocation-policy.test.ts`, `tests/unit/target/aarch64/backend/layout-encode-fixed-point.test.ts`, `tests/unit/target/aarch64/backend/backend-end-to-end.test.ts`, and `tests/unit/target/aarch64/backend/relocation-records.test.ts`.
- Existing backend relocation records already expose `addend` and `pairedRelocationKey` in `src/target/aarch64/backend/object/relocation-records.ts`.
- Existing object assembly currently creates a synthetic `.extern` section in `src/target/aarch64/backend/api/object-assembly.ts`. The implementation must replace that with `external-declaration` symbols.
- Existing object verification lives in `src/target/aarch64/backend/verify/encoding-object-verifier.ts`; it already checks sorted records, patch bounds, catalog-backed opcode ownership, literal pools, veneers, unwind records, and byte provenance coverage.
- Existing policy gate in `scripts/check-policy.ts` already forbids earlier compiler phases from importing linker modules. The linker work must preserve that boundary.
- PE/COFF constants were checked against Microsoft PE format documentation: [PE Format](https://learn.microsoft.com/en-us/windows/win32/debug/pe-format). The v1 linker target policy must encode these concrete values as data, not callbacks:

```ts
export const WRELA_UEFI_AARCH64_RPI5_LINKER_CONSTANTS = Object.freeze({
  preferredImageBase: 0n,
  sectionAlignmentBytes: 4096,
  machine: 0xaa64,
  subsystem: 10,
  maxImageSizeBytes: 128 * 1024 * 1024,
  sectionFlags: Object.freeze({
    ".text": 0x60000020,
    ".rdata": 0x40000040,
    ".data": 0xc0000040,
    ".pdata": 0x40000040,
    ".xdata": 0x40000040,
    ".debug$wrela": 0x42000040,
  }),
});
```

## Shared Helper Imports

Every task that needs deterministic ordering or fingerprints must use these exact imports:

```ts
import { compareCodeUnitStrings } from "../shared/deterministic-sort";
import { stableHash, stableJson } from "../shared/stable-json";
```

Files under `src/linker/aarch64/**` use one extra `../`:

```ts
import { compareCodeUnitStrings } from "../../shared/deterministic-sort";
import { stableHash, stableJson } from "../../shared/stable-json";
import {
  AARCH64_BRANCH14_REACH_BYTES,
  AARCH64_BRANCH19_REACH_BYTES,
  AARCH64_BRANCH26_REACH_BYTES,
  isWithinAArch64SignedScaledBranchReach,
} from "../../target/aarch64/backend/object/branch-reach";
import { wordToU32Le, writeU32Le } from "../../target/aarch64/backend/object/encoding-core";
```

## Key Formats

Every stable key produced by the linker must follow these formats. Tests assert exact strings, so do not invent task-local variants.

```text
input module key:     module:<origin-kind>:<stable-origin-key>
synthetic module key: module:synthetic:<provider-key>:<object-key>
symbol key:           <moduleKey>:symbol:<objectSymbolStableKey>
relocation key:       <moduleKey>:reloc:<objectRelocationStableKey>
contribution key:     <moduleKey>:section:<objectSectionStableKey>
padding key:          padding:<outputSectionKey>:<contributionKey>:<startOffsetBytes>
base relocation key:  base-reloc:<kind>:<sectionKey>:<rva>
veneer module key:    module:synthetic:veneer:<sourceRelocationKey>
veneer symbol key:    <veneerModuleKey>:symbol:<veneerSymbolStableKey>
fact spending key:    fact-spent:<authority>:<stableKey>
```

## Shared Type Ownership

Task 1 owns diagnostics, diagnostic mode, and verification summary types in `src/linker/diagnostics.ts`. Downstream tasks import these from `src/linker/diagnostics.ts`; they must not redeclare them.

```ts
export interface LinkerVerificationSummary {
  readonly runs: readonly LinkerVerifierRun[];
}

export interface LinkerVerifierRun {
  readonly verifierKey: string;
  readonly runKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail?: string;
}

export type LinkerDiagnosticMode = "default" | "debug" | "strict";
```

Task 6 owns all linked-layout subrecord types in `src/linker/linked-image-layout.ts`. Downstream tasks import these from `src/linker/linked-image-layout.ts`; they must not redeclare them.

```ts
export interface LinkedImageInputModule {
  readonly moduleKey: string;
  readonly moduleFingerprint: string;
  readonly syntheticProviderKey?: string;
}

export interface LinkedImageSection {
  readonly stableKey: string;
  readonly classKey: string;
  readonly flags: number;
  readonly alignmentBytes: number;
  readonly rva: number;
  readonly virtualSizeBytes: number;
  readonly bytes: readonly number[];
  readonly contributions: readonly SectionContribution[];
}

export interface SectionContribution {
  readonly stableKey: string;
  readonly sourceModuleKey: string;
  readonly sourceObjectSectionKey: string;
  readonly sourceObjectSectionClass: string;
  readonly outputSectionKey: string;
  readonly offsetBytes: number;
  readonly sizeBytes: number;
  readonly alignmentBytes: number;
}

export interface ResolvedImageSymbol {
  readonly symbolKey: string;
  readonly linkageName?: string;
  readonly binding: "local" | "global";
  readonly sourceModuleKey: string;
  readonly sectionKey: string;
  readonly contributionKey: string;
  readonly rva: number;
  readonly objectOffsetBytes: number;
}

export interface AppliedRelocation {
  readonly relocationKey: string;
  readonly sourceModuleKey: string;
  readonly family: AArch64InternalRelocationFamily;
  readonly patchSectionKey: string;
  readonly patchRva: number;
  readonly targetSymbolKey: string;
  readonly targetRva: number;
  readonly addend: bigint;
  readonly expectedEncodedValue: bigint;
  readonly patchedBytes: readonly number[];
  readonly baseRelocationKey?: string;
}

export interface ImageBaseRelocation {
  readonly stableKey: string;
  readonly kind: "dir64" | "highlow" | "target-specific";
  readonly sectionKey: string;
  readonly rva: number;
  readonly widthBytes: number;
  readonly sourceRelocationKey: string;
}

export interface AArch64LinkedImageEntry {
  readonly loaderEntryLinkageName: string;
  readonly loaderEntryRva: number;
  readonly wrelaBootLinkageName: string;
  readonly wrelaBootRva: number;
}

export interface LinkedUnwindRecord {
  readonly stableKey: string;
  readonly functionSymbolKey: string;
  readonly functionStartRva: number;
  readonly functionEndRva: number;
  readonly unwindInfoSectionKey: string;
  readonly unwindInfoRva: number;
}

export interface LinkedDataDirectorySource {
  readonly stableKey: string;
  readonly directoryKind: "exception" | "base-relocation" | "debug";
  readonly sectionKey: string;
  readonly rva: number;
  readonly sizeBytes: number;
}

export interface LinkedByteProvenance {
  readonly stableKey: string;
  readonly sectionKey: string;
  readonly rva: number;
  readonly byteLength: number;
  readonly sourceModuleKey?: string;
  readonly sourceObjectSectionKey?: string;
  readonly sourceObjectProvenanceKey?: string;
  readonly sourceRelocationKey?: string;
  readonly sourceSyntheticObjectKey?: string;
  readonly factFamilies: readonly string[];
  readonly machineSubjectKey?: string;
}

export interface LinkedFactSpendingRecord {
  readonly stableKey: string;
  readonly authority: string;
  readonly payload: string;
  readonly sourceModuleKeys: readonly string[];
}
```

## Relocation Bounds And Field Placement

Relocation workers must use these exact numeric bounds:

```text
branch26 signed scaled bytes: [-134217728, 134217724]
branch19 signed scaled bytes: [-1048576, 1048572]
branch14 signed scaled bytes: [-32768, 32764]
pagebase-rel21 signed page delta: [-1048576, 1048575] pages
pagebase-rel21 signed byte distance between pages: [-4294967296, 4294963200]
pageoffset-12a low bits: [0, 4095]
pageoffset-12l encoded low bits: low12 / accessScaleBytes, divisible by accessScaleBytes, encoded [0, 4095]
addr32 unsigned absolute: rejected in v1 unless a test target explicitly sets allowAddr32AbsoluteForTest=true
addr32nb unsigned RVA: [0, 4294967295]
rel32 signed relative: [-2147483648, 2147483647]
section-relative unsigned offset: target RVA - containing section RVA, in [0, 4294967295]
```

`bitRange` is an inclusive verifier ownership envelope: `[0, 25]` owns 26 bits. Branch and relative instruction displacements must be divisible by 4 before scaling; non-divisible distances fail with `relocation:unaligned-branch-distance:<relocationKey>:<distanceBytes>`. Non-contiguous instruction relocations use policy-owned field slices:

```ts
export interface AArch64RelocationFieldSlice {
  readonly encodedValueStartBit: number;
  readonly instructionStartBit: number;
  readonly bitCount: number;
}

export const AARCH64_RELOCATION_FIELD_SLICES = Object.freeze({
  branch26: [{ encodedValueStartBit: 0, instructionStartBit: 0, bitCount: 26 }],
  branch19: [{ encodedValueStartBit: 0, instructionStartBit: 5, bitCount: 19 }],
  branch14: [{ encodedValueStartBit: 0, instructionStartBit: 5, bitCount: 14 }],
  "pagebase-rel21": [
    { encodedValueStartBit: 0, instructionStartBit: 29, bitCount: 2 },
    { encodedValueStartBit: 2, instructionStartBit: 5, bitCount: 19 },
  ],
  "pageoffset-12a": [{ encodedValueStartBit: 0, instructionStartBit: 10, bitCount: 12 }],
  "pageoffset-12l": [{ encodedValueStartBit: 0, instructionStartBit: 10, bitCount: 12 }],
});
```

`AARCH64_RELOCATION_FIELD_SLICES` is declared and exported by Task 7 from `src/linker/aarch64/aarch64-relocation-policy.ts`; Task 16 imports it from that file. Section-class vocabulary is declared by Task 2 in `src/target/aarch64/backend/object/object-module.ts` as branded string constants and is runtime-validated rather than a closed TypeScript union.

## Exact Dependency DAG

These are true predecessors, not marketing waves. Braced task sets are genuinely concurrent after their listed predecessors.

```text
Independent roots:
  Task 1
  Task 2

Object contract spine:
  Task 2 -> Task 3 -> Task 4 -> Task 5

Linker model and target spine:
  Task 1 -> Task 6 -> Task 7

API and synthetic object spine:
  {Task 5, Task 7} -> Task 8 -> Task 9 -> Task 10

Link graph spine:
  Task 10 -> Task 11 -> Task 12
  Task 12 -> {Task 13, Task 14, Task 16}
  {Task 13, Task 14} -> Task 15
  {Task 13, Task 16} -> Task 17
  {Task 15, Task 16, Task 17} -> Task 18
  {Task 14, Task 15, Task 17, Task 18} -> Task 19
  Task 19 -> {Task 20, Task 21}
  {Task 14, Task 15, Task 16, Task 18, Task 19, Task 20, Task 21} -> Task 22
  {Task 9, Task 11, Task 12, Task 13, Task 14, Task 15, Task 16, Task 17, Task 18, Task 19, Task 20, Task 21, Task 22} -> Task 23 -> Task 24
```

## Shared File Protocol

Parallel workers must not edit the same file. Shared production files are only touched along serial dependency edges:

```text
src/linker/linked-image-layout.ts      Task 6 owns all public layout types; downstream tasks import only.
src/linker/relocation-application.ts   Task 17 creates pair planning helpers; Task 18 extends serially.
src/linker/section-layout.ts           Task 14 creates one-pass layout; downstream tasks import only.
src/linker/layout-fixed-point.ts       Task 19 owns the cross-stage fixed point to avoid section-layout/import cycles.
src/linker/aarch64/aarch64-linker.ts   Task 8 creates API/preflight; Task 23 wires orchestration serially.
```

Shared fixture files are also serialized. Task 10 owns primitive fixtures, Task 12 owns normalized fixtures, and Tasks 13-24 must use task-local fixture helpers unless a helper is explicitly listed under Task 10 or Task 12. Do not add new helpers to `tests/support/linker/**` from Tasks 13-24 without first updating this plan.

Tests are split by concern:

```text
diagnostics.test.ts
linked-image-layout.test.ts
aarch64-target-policy.test.ts
aarch64-api.test.ts
aarch64-synthetic-objects.test.ts
linker-fixtures-contract.test.ts
object-normalization.test.ts
normalized-link-fixtures.test.ts
symbol-resolution.test.ts
section-layout.test.ts
symbol-rva.test.ts
aarch64-relocation-math.test.ts
paired-relocations.test.ts
relocation-application.test.ts
veneer-fixed-point.test.ts
entry-resolution.test.ts
unwind-metadata.test.ts
linked-image-verifier.test.ts
aarch64-link-orchestration.test.ts
linker-property.test.ts
```

## Task 1: Linker Diagnostics And Result Helpers

**Description:** Create linker-owned diagnostic codes, deterministic sorting, result helpers, diagnostic mode, and verification summary records. This can land independently of the object-contract migration.

**Dependencies:** None.

**Files:**

- Create: `src/linker/diagnostics.ts`
- Create: `tests/unit/linker/diagnostics.test.ts`

**AC:**

- Diagnostic codes are exactly `LINKER_INPUT_INVALID`, `LINKER_SYMBOL_RESOLUTION_FAILED`, `LINKER_SECTION_LAYOUT_FAILED`, `LINKER_RELOCATION_FAILED`, `LINKER_ENTRY_RESOLUTION_FAILED`, and `LINKER_IMAGE_LAYOUT_INVALID`.
- Diagnostics include `ownerKey`, `stableDetail`, `rootCauseKey`, and sorted `provenance`.
- `LinkerDiagnosticMode` is `"default" | "debug" | "strict"`.
- `linkerOk` and `linkerError` freeze results and sort diagnostics deterministically.
- `LinkerVerificationSummary` uses the shared shape in this plan.

**Code Examples:**

```ts
test("sorts linker diagnostics by stable fields", () => {
  const diagnostics = sortLinkerDiagnostics([
    linkerDiagnostic({ code: "LINKER_INPUT_INVALID", stableDetail: "b", ownerKey: "o" }),
    linkerDiagnostic({ code: "LINKER_INPUT_INVALID", stableDetail: "a", ownerKey: "o" }),
  ]);

  expect(diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual(["a", "b"]);
});
```

**Steps:**

- [ ] Add the failing sorting and freezing tests in `tests/unit/linker/diagnostics.test.ts`.
- [ ] Run `bun test ./tests/unit/linker/diagnostics.test.ts`; expect missing module/export failures.
- [ ] Implement `src/linker/diagnostics.ts` with frozen records and code-unit sorting.
- [ ] Run `bun test ./tests/unit/linker/diagnostics.test.ts`; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit `src/linker/diagnostics.ts` and `tests/unit/linker/diagnostics.test.ts`.

## Task 2: Object Section Class Vertical Migration

**Description:** Add explicit object section classes to the AArch64 object module and migrate every section-construction call site so this task lands green on its own.

**Dependencies:** None.

**Files:**

- Modify: `src/target/aarch64/backend/api/ids.ts`
- Modify: `src/target/aarch64/backend/object/object-module.ts`
- Modify: `src/target/aarch64/backend/object/layout-encode-fixed-point.ts`
- Modify: `src/target/aarch64/backend/api/object-assembly.ts`
- Modify: `tests/support/target/aarch64/backend/object-module-fixtures.ts`
- Modify: `tests/unit/target/aarch64/backend/object-module.test.ts`
- Modify: `tests/unit/target/aarch64/backend/layout-encode-fixed-point.test.ts`
- Modify: `tests/unit/target/aarch64/backend/backend-end-to-end.test.ts`

**AC:**

- `AArch64ObjectSection` has required `classKey: AArch64ObjectSectionClassKey`.
- `aarch64ObjectSection` requires `classKey` and rejects empty or untrimmed class keys.
- `src/target/aarch64/backend/object/object-module.ts` exports branded constants `AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT`, `AARCH64_OBJECT_SECTION_CLASS_READ_ONLY_DATA`, `AARCH64_OBJECT_SECTION_CLASS_WRITABLE_DATA`, `AARCH64_OBJECT_SECTION_CLASS_UNWIND_PDATA`, `AARCH64_OBJECT_SECTION_CLASS_UNWIND_XDATA`, and `AARCH64_OBJECT_SECTION_CLASS_DEBUG_PROVENANCE`.
- Layout/encode emits `classKey: "executable-text"` for text sections and backend-owned veneer text.
- Object assembly does not infer section classes by name; it passes through classes from layout sections.
- Section fingerprints and module fingerprints include `classKey`.
- `rg -n "aarch64ObjectSection\\(" src tests` shows every call passes `classKey` or uses a fixture default.

**Code Examples:**

```ts
export interface AArch64ObjectSection {
  readonly stableKey: AArch64ObjectSectionId;
  readonly classKey: AArch64ObjectSectionClassKey;
  readonly alignmentBytes: number;
  readonly bytes: readonly number[];
  readonly fragments: readonly AArch64ObjectFragment[];
}

export const AARCH64_OBJECT_SECTION_CLASS_EXECUTABLE_TEXT =
  aarch64ObjectSectionClassKey("executable-text");
```

```ts
test("includes section class keys in deterministic fingerprints", () => {
  const text = aarch64ObjectModuleForTest({
    sections: [
      sectionForTest({ stableKey: ".same", classKey: "executable-text", bytes: [0, 0, 0, 0] }),
    ],
  });
  const data = aarch64ObjectModuleForTest({
    sections: [
      sectionForTest({ stableKey: ".same", classKey: "writable-data", bytes: [0, 0, 0, 0] }),
    ],
  });

  expect(text.deterministicMetadata.sectionFingerprint).not.toBe(
    data.deterministicMetadata.sectionFingerprint,
  );
});
```

**Steps:**

- [ ] Add the fingerprint and constructor rejection tests.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/object-module.test.ts`; expect `classKey` failures.
- [ ] Add the branded ID and update `AArch64ObjectSection`.
- [ ] Migrate every section-construction call site listed in **Files**.
- [ ] Run the three narrow test files listed in **Verification**; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

**Verification:**

```bash
bun test ./tests/unit/target/aarch64/backend/object-module.test.ts
bun test ./tests/unit/target/aarch64/backend/layout-encode-fixed-point.test.ts
bun test ./tests/unit/target/aarch64/backend/backend-end-to-end.test.ts
bun run agent:check
```

## Task 3: Discriminated Object Symbol Vertical Migration

**Description:** Replace `isGlobal` with a discriminated symbol contract and migrate every backend and test call site that constructs or consumes object symbols.

**Dependencies:** Task 2.

**Files:**

- Modify: `src/target/aarch64/backend/object/object-module.ts`
- Modify: `src/target/aarch64/backend/object/layout-encode-fixed-point.ts`
- Modify: `src/target/aarch64/backend/api/object-assembly.ts`
- Modify: `src/target/aarch64/backend/finalization/physical-instruction-ir.ts`
- Modify: `src/target/aarch64/backend/api/machine-lowering-branches.ts`
- Modify: `src/target/aarch64/backend/verify/encoding-object-verifier.ts`
- Modify: `tests/support/target/aarch64/backend/object-module-fixtures.ts`
- Modify: `tests/unit/target/aarch64/backend/object-module.test.ts`
- Modify: `tests/unit/target/aarch64/backend/layout-encode-fixed-point.test.ts`
- Modify: `tests/unit/target/aarch64/backend/object-verifier.test.ts`
- Modify: `tests/unit/target/aarch64/backend/backend-end-to-end.test.ts`

**AC:**

- `AArch64ObjectSymbol` is a union of `local-definition`, `global-definition`, and `external-declaration`.
- Only global definitions and external declarations carry `linkageName`.
- Only definitions carry `sectionKey` and `offsetBytes`.
- `src/target/aarch64/backend/object/layout-encode-fixed-point.ts` extends its layout-symbol input shape from `{ stableKey, isGlobal? }` to `{ stableKey, kind?: "local-definition" | "global-definition", linkageName? }`.
- `src/target/aarch64/backend/finalization/physical-instruction-ir.ts` extends `definedSymbol` to carry `kind` and optional `linkageName`, preserving public ABI names from upstream lowering.
- `src/target/aarch64/backend/api/machine-lowering-branches.ts` marks generated block labels as local definitions.
- `initialAArch64ObjectSymbolsForProgram` and `aarch64ObjectSymbolsForLayout` assign `linkageName: String(machineFunction.symbol)` for function globals.
- Layout local labels and backend-owned veneer labels become `local-definition`.
- Function entry symbols and public ABI boundary symbols become `global-definition`.
- External declarations do not participate in section cross-checks.
- `rg -n "isGlobal" src/target/aarch64 tests/unit/target/aarch64 tests/support/target/aarch64` returns no object-symbol contract usage.

**Code Examples:**

```ts
export type AArch64ObjectSymbol =
  | {
      readonly kind: "local-definition";
      readonly stableKey: AArch64ObjectSymbolId;
      readonly sectionKey: AArch64ObjectSectionId;
      readonly offsetBytes: number;
    }
  | {
      readonly kind: "global-definition";
      readonly stableKey: AArch64ObjectSymbolId;
      readonly linkageName: string;
      readonly sectionKey: AArch64ObjectSectionId;
      readonly offsetBytes: number;
    }
  | {
      readonly kind: "external-declaration";
      readonly stableKey: AArch64ObjectSymbolId;
      readonly linkageName: string;
    };
```

```ts
test("external declarations have no section placement", () => {
  const module = aarch64ObjectModuleForTest({
    symbols: [
      symbolForTest({
        stableKey: "extern.helper",
        kind: "external-declaration",
        linkageName: "helper",
      }),
    ],
  });

  expect(module.symbols).toEqual([
    expect.objectContaining({ kind: "external-declaration", linkageName: "helper" }),
  ]);
});
```

**Steps:**

- [ ] Add tests for external declarations, local definitions without linkage names, and global definitions with linkage names.
- [ ] Run `bun test ./tests/unit/target/aarch64/backend/object-module.test.ts`; expect type/shape failures.
- [ ] Update object-module symbol types, constructors, metadata, and cross-checks.
- [ ] Migrate every symbol producer and verifier consumer listed in **Files**.
- [ ] Run `rg -n "isGlobal" src/target/aarch64 tests/unit/target/aarch64 tests/support/target/aarch64`; confirm only non-object compatibility text remains or no matches remain.
- [ ] Run narrow tests and `bun run agent:check`.
- [ ] Commit the task files.

**Verification:**

```bash
bun test ./tests/unit/target/aarch64/backend/object-module.test.ts
bun test ./tests/unit/target/aarch64/backend/layout-encode-fixed-point.test.ts
bun test ./tests/unit/target/aarch64/backend/object-verifier.test.ts
bun test ./tests/unit/target/aarch64/backend/backend-end-to-end.test.ts
bun run agent:check
```

## Task 4: Structured Object Relocation Vertical Migration

**Description:** Promote relocation addends, pair keys, structured targets, bit ranges, encoding owners, and linker-veneer requests into public `AArch64ObjectRelocation` records, with exact target-selection rules for local versus linkage references.

**Dependencies:** Task 3.

**Files:**

- Modify: `src/target/aarch64/backend/object/object-module.ts`
- Modify: `src/target/aarch64/backend/object/relocation-records.ts`
- Modify: `src/target/aarch64/backend/object/layout-encode-fixed-point.ts`
- Modify: `src/target/aarch64/backend/verify/encoding-object-verifier.ts`
- Modify: `src/target/aarch64/backend/api/object-assembly.ts`
- Modify: `tests/support/target/aarch64/backend/object-module-fixtures.ts`
- Modify: `tests/unit/target/aarch64/backend/object-module.test.ts`
- Modify: `tests/unit/target/aarch64/backend/relocation-records.test.ts`
- Modify: `tests/unit/target/aarch64/backend/layout-encode-fixed-point.test.ts`
- Modify: `tests/unit/target/aarch64/backend/object-verifier-relocation-policy.test.ts`
- Modify: `tests/unit/target/aarch64/backend/object-verifier.test.ts`
- Modify: `tests/unit/target/aarch64/backend/backend-end-to-end.test.ts`

**AC:**

- Relocations expose `target`, `addend`, required `bitRange`, optional `encodingOwner`, optional `pairedRelocationKey`, optional `linkerVeneer`.
- `targetSymbol` may remain as an optional compatibility read field for existing diagnostics in this task, but every new object record sets structured `target`.
- Target rule: a relocation to a `local-definition` in the same object uses `{ kind: "symbol-stable-key", stableKey }`.
- Target rule: a relocation to a `global-definition`, external declaration, cross-module callee, loader entry, boot function, or runtime helper uses `{ kind: "linkage-name", linkageName }`.
- Layout block labels in existing branch tests use `symbol-stable-key`; private/public callee relocations in backend end-to-end tests use `linkage-name`.
- Object verifier consumes `relocation.target`, not `targetSymbol`, for semantic checks.
- `AArch64ObjectLinkerVeneerRequest` is defined in `object-module.ts` and includes `siteKind`, `scratchRegisters`, `securityLabels`, `provenanceKeys`, and `maxSourceReachBytes`.
- `layout-encode-fixed-point.ts` copies security labels already present on layout instructions into `linkerVeneer.securityLabels` when a backend relocation delegates veneer recovery.
- `rg -n "targetSymbol" src/target/aarch64 tests/unit/target/aarch64 tests/support/target/aarch64` shows only compatibility shims, test descriptions, or no matches.

**Code Examples:**

```ts
export type AArch64ObjectRelocationTarget =
  | { readonly kind: "symbol-stable-key"; readonly stableKey: string }
  | { readonly kind: "linkage-name"; readonly linkageName: string };

export interface AArch64ObjectLinkerVeneerRequest {
  readonly siteKind: "branch26-call" | "branch26-jump";
  readonly scratchRegisters: readonly string[];
  readonly securityLabels: readonly string[];
  readonly provenanceKeys: readonly string[];
  readonly maxSourceReachBytes: number;
}
```

```ts
test("layout local branch relocations target symbol stable keys", () => {
  const result = compileBranchFixtureToObject();

  expect(result.objectModule.relocations[0]).toMatchObject({
    target: { kind: "symbol-stable-key", stableKey: "fixture.function:block:1" },
  });
});
```

**Steps:**

- [ ] Add tests for local branch target shape, public callee linkage-name shape, preserved addends, and pair partners.
- [ ] Run relocation and backend end-to-end tests; expect missing structured target failures.
- [ ] Update relocation record types and constructors.
- [ ] Update layout/encode target classification using the exact target rules in **AC**.
- [ ] Update object verifier and object assembly consumers to use structured targets.
- [ ] Run `rg -n "targetSymbol" ...` and inspect every remaining match.
- [ ] Run narrow tests and `bun run agent:check`.
- [ ] Commit the task files.

**Verification:**

```bash
bun test ./tests/unit/target/aarch64/backend/object-module.test.ts
bun test ./tests/unit/target/aarch64/backend/relocation-records.test.ts
bun test ./tests/unit/target/aarch64/backend/layout-encode-fixed-point.test.ts
bun test ./tests/unit/target/aarch64/backend/object-verifier-relocation-policy.test.ts
bun test ./tests/unit/target/aarch64/backend/backend-end-to-end.test.ts
bun run agent:check
```

## Task 5: Backend Assembly And Verifier Contract Completion

**Description:** Remove `.extern` as an object-section concept, complete object verifier policy for the new contract, and prove backend object compilation remains green.

**Dependencies:** Task 4.

**Files:**

- Modify: `src/target/aarch64/backend/api/object-assembly.ts`
- Modify: `src/target/aarch64/backend/api/compile-aarch64-object.ts`
- Modify: `src/target/aarch64/backend/verify/encoding-object-verifier.ts`
- Modify: `tests/unit/target/aarch64/backend/object-verifier.test.ts`
- Modify: `tests/unit/target/aarch64/backend/object-verifier-relocation-policy.test.ts`
- Modify: `tests/unit/target/aarch64/backend/backend-end-to-end.test.ts`
- Modify: `tests/integration/target/aarch64/backend-object.test.ts`

**AC:**

- External public callees are `external-declaration` symbols with no `.extern` section.
- Object verifier rejects unknown section classes, external declarations with section fields, definitions without valid sections, missing addends, missing pair keys for paired families, missing instruction encoding owners, and missing low-12 access scales.
- Object verifier accepts local stable-key targets only in the source module.
- Object verifier accepts linkage-name targets only when a matching global definition or external declaration exists in the object.
- `rg -n "AARCH64_EXTERNAL_SYMBOL_SECTION|\\.extern" src/target/aarch64 tests/unit/target/aarch64` shows no production `.extern` section path.

**Code Examples:**

```ts
test("object assembly uses external declarations instead of extern sections", () => {
  const module = compileFixtureWithExternalPublicCallee("firmware.helper");

  expect(module.sections.map((section) => String(section.stableKey))).not.toContain(".extern");
  expect(module.symbols).toContainEqual(
    expect.objectContaining({
      kind: "external-declaration",
      linkageName: "firmware.helper",
    }),
  );
});
```

**Steps:**

- [ ] Add `.extern` removal and verifier negative tests.
- [ ] Run backend end-to-end tests; expect existing `.extern` assertions to fail.
- [ ] Remove `.extern` production paths and update assertions to external declarations.
- [ ] Finish verifier policy for structured relocation targets and metadata.
- [ ] Run the grep command in **AC** and inspect any remaining references.
- [ ] Run narrow tests and `bun run agent:check`.
- [ ] Commit the task files.

**Verification:**

```bash
bun test ./tests/unit/target/aarch64/backend/object-verifier.test.ts
bun test ./tests/unit/target/aarch64/backend/object-verifier-relocation-policy.test.ts
bun test ./tests/unit/target/aarch64/backend/backend-end-to-end.test.ts
bun test ./tests/integration/target/aarch64/backend-object.test.ts
bun run agent:check
```

## Task 6: Linked Image Layout Model

**Description:** Define immutable linked-image layout records and every downstream subrecord type in one file so parallel workers import one source of truth.

**Dependencies:** Task 1.

**Files:**

- Create: `src/linker/linked-image-layout.ts`
- Create: `tests/unit/linker/linked-image-layout.test.ts`

**AC:**

- `AArch64LinkedImageLayout` contains target fingerprints, input modules, sections, symbols, applied relocations, base relocations, entry, unwind records, data-directory sources, provenance, fact spending, verification, and deterministic metadata.
- This task defines `ResolvedImageSymbol`, `SectionContribution`, `LinkedImageSection`, `AppliedRelocation`, `ImageBaseRelocation`, `LinkedUnwindRecord`, `LinkedByteProvenance`, and `LinkedFactSpendingRecord`.
- Deterministic metadata includes `schema`, `schemaVersion`, `inputFingerprint`, `sectionFingerprint`, `symbolFingerprint`, `relocationFingerprint`, `baseRelocationFingerprint`, `entryFingerprint`, `provenanceFingerprint`, and `layoutFingerprint`.
- Constructors deeply freeze arrays and sort records by stable keys.

**Code Examples:**

```ts
test("layout metadata exposes every required fingerprint", () => {
  const layout = linkedImageLayoutForModelTest();

  expect(Object.keys(layout.deterministicMetadata)).toEqual([
    "schema",
    "schemaVersion",
    "inputFingerprint",
    "sectionFingerprint",
    "symbolFingerprint",
    "relocationFingerprint",
    "baseRelocationFingerprint",
    "entryFingerprint",
    "provenanceFingerprint",
    "layoutFingerprint",
  ]);
});
```

**Steps:**

- [ ] Add model tests for freezing, sorting, fingerprint field presence, and fingerprint changes.
- [ ] Run `bun test ./tests/unit/linker/linked-image-layout.test.ts`; expect missing export failures.
- [ ] Implement layout records in `src/linker/linked-image-layout.ts`.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 7: AArch64 Linker Target Surface And Section Policy

**Description:** Add authenticated AArch64 linker policy records for target constants, section mappings, relocation-family policy, field slices, entry policy, and base-relocation policy.

**Dependencies:** Task 6.

**Files:**

- Create: `src/linker/image-layout-policy.ts`
- Create: `src/linker/aarch64/aarch64-section-policy.ts`
- Create: `src/linker/aarch64/aarch64-relocation-policy.ts`
- Create: `tests/unit/linker/aarch64-target-policy.test.ts`

**AC:**

- `AArch64LinkerTargetSurface` stores data records and rebuilt lookup tables; runtime linker code does not consume trusted callbacks from callers.
- The production surface key is exactly `"wrela-uefi-aarch64-rpi5-v1"`.
- Section policy maps `executable-text`, `read-only-data`, `writable-data`, `unwind-pdata`, `unwind-xdata`, and `debug-provenance` classes.
- `src/linker/aarch64/aarch64-relocation-policy.ts` exports `AARCH64_RELOCATION_FIELD_SLICES`, `AARCH64_LINK_RELOCATION_BOUNDS`, and `AARCH64_V1_ADDR32_ABSOLUTE_ALLOWED = false`.
- Relocation policy stores numeric bounds, field slices, and v1 `addr32` rejection from this plan.
- Duplicate section mappings, duplicate output sections, missing relocation families, duplicate relocation families, and invalid constants fail with deterministic diagnostics.

**Code Examples:**

```ts
test("authenticates the production linker target surface", () => {
  const result = authenticateAArch64LinkerTargetSurface({
    backendSurfaceFingerprint: "backend-target-surface-fingerprint",
    relocationCatalogFingerprint: "relocation-catalog-fingerprint",
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected target surface");
  expect(result.value.constants).toMatchObject({
    preferredImageBase: 0n,
    sectionAlignmentBytes: 4096,
    machine: 0xaa64,
    subsystem: 10,
  });
});
```

**Steps:**

- [ ] Add authentication happy-path and duplicate-policy tests.
- [ ] Run `bun test ./tests/unit/linker/aarch64-target-policy.test.ts`; expect missing export failures.
- [ ] Implement policy records, authentication, lookup rebuilding, constants, relocation bounds, and field slices.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 8: Public API And Provider Contracts

**Description:** Add `linkAArch64Image`, its input/result types, synthetic object provider contract, veneer provider contract, provider result types, public preflight validation, and module sorting.

**Dependencies:** Tasks 5 and 7.

**Files:**

- Create: `src/linker/aarch64/aarch64-linker.ts`
- Create: `src/linker/index.ts`
- Create: `tests/unit/linker/aarch64-api.test.ts`

**AC:**

- Public API shape matches the design.
- `AArch64LinkInputModule`, `AArch64ImageEntryRequest`, `AArch64SyntheticObjectProvider`, and `AArch64LinkerVeneerProvider` are exported here.
- Synthetic providers return `{ kind: "ok"; modules }` or `{ kind: "error"; diagnostics }`.
- Provider-returned modules must have stable module keys following `module:synthetic:<provider-key>:<object-key>`.
- Empty object module lists fail with `LINKER_INPUT_INVALID`.
- Provider errors stop before normalization and return sorted diagnostics.

**Code Examples:**

```ts
export interface AArch64SyntheticObjectProvider {
  readonly providerKey: string;
  readonly provideObjects: (
    input: AArch64SyntheticObjectProviderInput,
  ) => AArch64SyntheticObjectProviderResult;
}
```

```ts
test("preflight rejects duplicate provider module keys", () => {
  const bootModule = objectModuleForApiTest("module:user:boot");
  const target = targetSurfaceForApiTest();
  const duplicateSyntheticObject = syntheticProviderForApiTest({
    providerKey: "test",
    objectKey: "entry",
    moduleKey: "module:synthetic:test:entry",
  });

  const result = materializeAArch64SyntheticObjectsForLink({
    objectModules: [bootModule],
    syntheticObjects: [duplicateSyntheticObject, duplicateSyntheticObject],
    target,
    entry: { wrelaBootLinkageName: "Boot.main" },
  });

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected duplicate key error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "linker-input:duplicate-module-key:module:synthetic:test:entry",
  ]);
});
```

**Steps:**

- [ ] Add API/preflight tests in `aarch64-api.test.ts` with task-local helpers named `objectModuleForApiTest`, `targetSurfaceForApiTest`, and `syntheticProviderForApiTest`; do not use Task 10 shared fixtures here.
- [ ] Run the narrow test; expect missing export failures.
- [ ] Implement public API types, provider results, preflight checks, and deterministic sorting.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 9: Production Synthetic Entry And Unwind Object Providers

**Description:** Add production provider helpers for the UEFI loader-entry shim and unwind `.pdata`/`.xdata` object materialization. These providers create normal verified `AArch64ObjectModule` records before normalization; post-layout unwind metadata is a separate task.

**Dependencies:** Task 8.

**Files:**

- Create: `src/linker/aarch64/aarch64-entry-objects.ts`
- Create: `tests/unit/linker/aarch64-synthetic-objects.test.ts`

**AC:**

- `createAArch64UefiEntrySyntheticObjectProvider` returns a provider keyed by `uefi-entry`.
- The entry provider emits a global `__wrela_uefi_entry` symbol and a relocation targeting `input.entry.wrelaBootLinkageName` by linkage name.
- Synthetic code bytes are produced through an injected backend-backed factory, not ad hoc instruction words inside the linker.
- `createAArch64UnwindSyntheticObjectProvider` emits relocation-bearing `unwind-pdata` and `unwind-xdata` object sections for backend unwind records.
- Provider outputs pass `verifyAArch64ObjectModule`.

**Code Examples:**

```ts
export interface AArch64SyntheticObjectFactory {
  readonly createEntryObject: (
    input: AArch64EntryObjectFactoryInput,
  ) => AArch64SyntheticObjectFactoryResult;
  readonly createUnwindObjects: (
    input: AArch64UnwindObjectFactoryInput,
  ) => AArch64SyntheticObjectFactoryResult;
}
```

```ts
test("entry provider emits a normal object with loader and boot symbols", () => {
  const provider = createAArch64UefiEntrySyntheticObjectProvider({
    factory: entryObjectFactoryForTest(),
  });

  const result = provider.provideObjects(syntheticProviderInputForTest("Boot.main"));

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected synthetic object");
  expect(result.modules[0]!.objectModule.symbols).toContainEqual(
    expect.objectContaining({ kind: "global-definition", linkageName: "__wrela_uefi_entry" }),
  );
});
```

**Steps:**

- [ ] Add provider contract tests with task-local fakes named `entryObjectFactoryForTest` and `syntheticProviderInputForTest`.
- [ ] Run the narrow test; expect missing provider exports.
- [ ] Implement entry and unwind providers using injected factories.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 10: Primitive Linker Fixtures API

**Description:** Create raw object/module, target, provider, and layout fixture helpers used by downstream tests. This task must not depend on normalized graph types.

**Dependencies:** Task 9.

**Files:**

- Create: `tests/support/linker/linker-fixtures.ts`
- Create: `tests/support/linker/aarch64-object-link-fixtures.ts`
- Create: `tests/unit/linker/linker-fixtures-contract.test.ts`

**AC:**

- The fixture API includes every helper signature in the code block below.
- Fixture object modules use the new object contract and full byte provenance coverage.
- No runtime source imports from `tests/support`.

**Code Examples:**

```ts
export function targetSurfaceForTest(): AArch64LinkerTargetSurface;
export function bootModuleForTest(moduleKey?: string): AArch64LinkInputModule;
export function objectModuleForLinkTest(
  input: ObjectModuleForLinkTestInput,
): AArch64LinkInputModule;
export function textSectionForLinkTest(input: TextSectionForLinkTestInput): AArch64ObjectSection;
export function dataSectionForLinkTest(input: DataSectionForLinkTestInput): AArch64ObjectSection;
export function localSymbolForLinkTest(input: LocalSymbolForLinkTestInput): AArch64ObjectSymbol;
export function globalSymbolForLinkTest(input: GlobalSymbolForLinkTestInput): AArch64ObjectSymbol;
export function externalSymbolForLinkTest(
  input: ExternalSymbolForLinkTestInput,
): AArch64ObjectSymbol;
export function relocationForLinkTest(input: RelocationForLinkTestInput): AArch64ObjectRelocation;
export function entryShimProviderForTest(): AArch64SyntheticObjectProvider;
export function unwindProviderForTest(): AArch64SyntheticObjectProvider;
export function veneerProviderForTest(): AArch64LinkerVeneerProvider;
export function linkedImageLayoutForTest(
  input?: LinkedImageLayoutForTestInput,
): AArch64LinkedImageLayout;
export function completeLinkedImageLayoutForVerifierTest(): AArch64LinkedImageLayout;
export function replaceResolvedSymbolForTest(
  layout: AArch64LinkedImageLayout,
  symbolKey: string,
  replacement: Partial<ResolvedImageSymbol>,
): AArch64LinkedImageLayout;
```

**Steps:**

- [ ] Add fixture contract tests that call every helper.
- [ ] Run `bun test ./tests/unit/linker/linker-fixtures-contract.test.ts`; expect missing helper failures.
- [ ] Implement primitive fixture helpers only.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 11: Input Object Normalization And Fact Spending

**Description:** Convert raw link input modules into a normalized link graph, validate input object invariants, and aggregate fact-spending records with conflict detection.

**Dependencies:** Task 10.

**Files:**

- Create: `src/linker/object-normalization.ts`
- Create: `tests/unit/linker/object-normalization.test.ts`

**AC:**

- Missing, empty, or duplicate module keys fail.
- Input modules sort by `moduleKey`.
- Backend target fingerprint must match the linker target.
- Unknown section classes fail closed.
- Definitions require existing layout sections; external declarations have no section.
- Relocation patch ranges are in bounds and relocation families are known.
- Instruction relocations require bit ranges and encoding-owner metadata.
- Low-12 load/store relocations require `accessScaleBytes`.
- Byte provenance covers every non-empty layout section.
- Fact-spending records with identical payloads coalesce with sorted source module lists.
- Fact-spending records with same stable key but different payloads fail with `LINKER_INPUT_INVALID`.

**Code Examples:**

```ts
export interface NormalizedLinkGraph {
  readonly modules: readonly NormalizedObjectModule[];
  readonly factSpending: readonly LinkedFactSpendingRecord[];
}

export function normalizeAArch64LinkInputs(
  input: NormalizeAArch64LinkInputsInput,
): LinkerResult<NormalizedLinkGraph>;
```

```ts
test("rejects conflicting fact-spending records", () => {
  const result = normalizeAArch64LinkInputs(conflictingFactSpendingInputForTest());

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected fact-spending error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "linker-input:fact-spending-conflict:fact-spent:bounds:packet-length",
  ]);
});
```

**Steps:**

- [ ] Add normalization and fact-spending tests.
- [ ] Run `bun test ./tests/unit/linker/object-normalization.test.ts`; expect missing export failures.
- [ ] Implement normalized graph records and validation.
- [ ] Implement fact-spending aggregation.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 12: Normalized Link Fixture API

**Description:** Add fixture helpers that return normalized graphs and normalized records. This task is sequenced after normalization so helpers do not stub production types.

**Dependencies:** Task 11.

**Files:**

- Create: `tests/support/linker/aarch64-normalized-link-fixtures.ts`
- Create: `tests/unit/linker/normalized-link-fixtures.test.ts`

**AC:**

- The fixture API includes `normalizedGraphForTest`, `moduleWithLocalTarget`, `moduleWithTextSection`, `twoModuleCallFixture`, `addr64Fixture`, `addr32FixtureForTest`, `pairTargetMismatchFixture`, `paddingFixtureForTest`, `symbolRvaFixtureForTest`, `nonExecutableEntryFixture`, `unwindInDataSectionFixture`, `farBranchModulesForTest`, `farBranchWithoutProviderFixture`, `unresolvedExternalLinkInput`, and `compileTinyAArch64ObjectForLinkTest`.
- Every helper calls production normalization rather than constructing object-literal normalized records by hand.

**Code Examples:**

```ts
export function normalizedGraphForTest(input?: NormalizedGraphForTestInput): NormalizedLinkGraph;
export function moduleWithLocalTarget(
  moduleKey: string,
  localStableKey: string,
): AArch64LinkInputModule;
export function twoModuleCallFixture(): NormalizedGraphForTestInput;
export function addr64Fixture(): ApplyRelocationsFixtureInput;
export function addr32FixtureForTest(): ApplyRelocationsFixtureInput;
export function paddingFixtureForTest(): SectionLayoutFixtureInput;
export function symbolRvaFixtureForTest(): SymbolRvaFixtureInput;
export function farBranchWithoutProviderFixture(): LinkLayoutFixedPointFixtureInput;
export function unresolvedExternalLinkInput(): LinkAArch64ImageInput;
export function compileTinyAArch64ObjectForLinkTest(): CompileAArch64ObjectResult & {
  readonly kind: "ok";
};
```

**Steps:**

- [ ] Add fixture contract tests that call every normalized helper.
- [ ] Run the narrow test; expect missing helper failures.
- [ ] Implement normalized fixture helpers by composing primitive fixtures and normalization.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 13: Symbol Resolution

**Description:** Build local and linkage-name namespaces, reject duplicate globals, resolve relocation targets, and produce relocation target records before section layout.

**Dependencies:** Task 12.

**Files:**

- Create: `src/linker/symbol-resolution.ts`
- Create: `tests/unit/linker/symbol-resolution.test.ts`

**AC:**

- Local symbols are scoped by module key.
- Duplicate global definitions fail deterministically.
- Same-module global definitions win for same-module linkage-name relocations.
- Stable-key relocation targets resolve only in the source module.
- UEFI v1 unresolved external declarations fail.
- Relocation target records use keys from the **Key Formats** section.

**Code Examples:**

```ts
export interface ResolveLinkSymbolsOutput {
  readonly symbols: readonly LinkSymbol[];
  readonly relocationTargets: readonly ResolvedLinkRelocationTarget[];
}

export function resolveLinkSymbols(
  graph: NormalizedLinkGraph,
): LinkerResult<ResolveLinkSymbolsOutput>;
```

```ts
test("same local stable keys in different modules resolve locally", () => {
  const result = resolveLinkSymbols(
    normalizedGraphForTest({
      modules: [
        moduleWithLocalTarget("module:a", "local.loop"),
        moduleWithLocalTarget("module:b", "local.loop"),
      ],
    }),
  );

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected symbols");
  expect(result.value.relocationTargets.map((target) => target.targetSymbolKey)).toEqual([
    "module:a:symbol:local.loop",
    "module:b:symbol:local.loop",
  ]);
});
```

**Steps:**

- [ ] Add local/global/external resolution tests.
- [ ] Run `bun test ./tests/unit/linker/symbol-resolution.test.ts`; expect missing export failures.
- [ ] Implement symbol namespaces and relocation target resolution.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 14: Section Layout And Linked Provenance

**Description:** Place normalized section contributions into policy-selected output sections with deterministic ordering, alignment, padding, section RVAs, and shifted byte provenance.

**Dependencies:** Task 12.

**Files:**

- Create: `src/linker/section-layout.ts`
- Create: `tests/unit/linker/section-layout.test.ts`

**AC:**

- Output section order follows target policy.
- Contributions sort by section priority, module key, object section class, object section key, and section fingerprint.
- Contribution start offsets align to the maximum of object section alignment and target contribution alignment.
- Padding bytes are zero and have explicit padding provenance using the **Key Formats** rule.
- Section RVAs align to `sectionAlignmentBytes`.
- Layout rejects integer overflow and total image sizes beyond target policy.

**Code Examples:**

```ts
export interface LayoutImageSectionsOutput {
  readonly sections: readonly LinkedImageSection[];
  readonly contributions: readonly SectionContribution[];
  readonly provenance: readonly LinkedByteProvenance[];
}

export function layoutImageSections(
  input: LayoutImageSectionsInput,
): LinkerResult<LayoutImageSectionsOutput>;
```

```ts
test("adds deterministic padding provenance for aligned contributions", () => {
  const result = layoutImageSections(paddingFixtureForTest());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected layout");
  expect(result.value.sections[0]!.bytes).toEqual([1, 0, 0, 0, 2, 3, 4, 5]);
  expect(result.value.provenance.map((entry) => entry.stableKey)).toContain(
    "padding:.text:module:b:section:text:1",
  );
});
```

**Steps:**

- [ ] Add section ordering, padding, RVA alignment, and provenance tests.
- [ ] Run the narrow test; expect missing export failures.
- [ ] Implement contribution placement and linked provenance shifting.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 15: Resolved Symbol RVA Materialization

**Description:** Convert resolved defined symbols into final `ResolvedImageSymbol` records using section contributions and object offsets.

**Dependencies:** Tasks 13 and 14.

**Files:**

- Create: `src/linker/symbol-rva.ts`
- Create: `tests/unit/linker/symbol-rva.test.ts`

**AC:**

- Every defined local/global symbol in a layout contribution gets exactly one RVA.
- External declarations never produce `ResolvedImageSymbol` records.
- Symbol offsets outside their contribution fail.
- Symbols in non-layout metadata sections fail.
- The materializer preserves binding, linkage name, source module key, object offset, output section key, and contribution key.

**Code Examples:**

```ts
export interface MaterializeResolvedImageSymbolsOutput {
  readonly symbols: readonly ResolvedImageSymbol[];
}

export function materializeResolvedImageSymbols(
  input: MaterializeResolvedImageSymbolsInput,
): LinkerResult<MaterializeResolvedImageSymbolsOutput>;
```

```ts
test("materializes symbol rva from contribution rva and object offset", () => {
  const result = materializeResolvedImageSymbols(symbolRvaFixtureForTest());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected symbols");
  expect(result.value.symbols).toContainEqual(
    expect.objectContaining({
      symbolKey: "module:user:boot:symbol:Boot.main",
      rva: 0x1008,
      contributionKey: "module:user:boot:section:.text",
    }),
  );
});
```

**Steps:**

- [ ] Add final-symbol happy path and negative tests.
- [ ] Run the narrow test; expect missing export failures.
- [ ] Implement symbol RVA materialization.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 16: AArch64 Relocation Math Helpers

**Description:** Implement AArch64 relocation value calculation and bitfield patch helpers for branch, page-base, page-offset, absolute, RVA, relative, and section-relative families.

**Dependencies:** Task 12.

**Files:**

- Create: `src/linker/aarch64/aarch64-relocations.ts`
- Create: `tests/unit/linker/aarch64-relocation-math.test.ts`

**AC:**

- Branch helpers enforce the numeric bounds in this plan.
- ADRP uses policy field slices, not one contiguous range.
- ADRP computes `page(S + A) - page(P)`.
- `pageoffset-12l` uses `accessScaleBytes` from encoding owner.
- Little-endian patch helpers modify only declared field slices for split families and only declared bit ranges for contiguous families.
- Out-of-range helpers return linker diagnostics instead of throwing.
- `encodeAArch64RelocationValue` and `patchAArch64InstructionRelocation` are the only exported runtime helpers from this file.

**Code Examples:**

```ts
export interface AArch64RelocationValueResult {
  readonly encodedValue: bigint;
  readonly unscaledValue: bigint;
}

export function encodeAArch64RelocationValue(
  input: AArch64RelocationValueInput,
): LinkerResult<AArch64RelocationValueResult>;

export function patchAArch64InstructionRelocation(
  input: AArch64InstructionRelocationPatchInput,
): LinkerResult<AArch64InstructionRelocationPatchResult>;
```

```ts
test("patches adrp split immlo and immhi fields", () => {
  const result = patchAArch64InstructionRelocation({
    family: "pagebase-rel21",
    originalBytes: [0x00, 0x00, 0x00, 0x90],
    symbolRva: 0x401000n,
    patchRva: 0x400000n,
    addend: 0n,
    preferredImageBase: 0n,
    bitRange: [5, 30],
    fieldSlices: AARCH64_RELOCATION_FIELD_SLICES["pagebase-rel21"],
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected patched ADRP");
  expect(result.value.patchedBytes).toEqual([0x00, 0x00, 0x00, 0xb0]);
  expect(result.value.encodedValue).toBe(1n);
});
```

Algorithm for `patchAArch64InstructionRelocation`:

```ts
const originalWord = wordToU32Le(input.originalBytes);
let patchedWord = originalWord;
for (const slice of input.fieldSlices) {
  const mask =
    Number(((1n << BigInt(slice.bitCount)) - 1n) << BigInt(slice.instructionStartBit)) >>> 0;
  const fieldValue = Number(
    (encodedValue >> BigInt(slice.encodedValueStartBit)) & ((1n << BigInt(slice.bitCount)) - 1n),
  );
  patchedWord = ((patchedWord & ~mask) | (fieldValue << slice.instructionStartBit)) >>> 0;
}
return writeU32Le(patchedWord);
```

**Steps:**

- [ ] Add range-boundary, ADRP split-field, low-12 scale, and patch confinement tests.
- [ ] Run the narrow test; expect missing export failures.
- [ ] Implement relocation value and patch helpers using target policy field slices.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 17: Paired Relocation Planning

**Description:** Validate ADRP plus low-12 pairs using explicit `pairedRelocationKey` fields before relocation application.

**Dependencies:** Tasks 13 and 16.

**Files:**

- Create: `src/linker/relocation-application.ts`
- Create: `tests/unit/linker/paired-relocations.test.ts`

**AC:**

- Page-base relocations requiring a low-12 partner reject missing `pairedRelocationKey`.
- Pair partners must exist in the same module unless policy explicitly allows otherwise.
- Pair partners must target the same resolved symbol.
- Pair partners must contain one `pagebase-rel21` and one `pageoffset-12a` or `pageoffset-12l`.
- Pair planning returns all-or-error records; no half-applied pair reaches application.

**Code Examples:**

```ts
export interface PlannedRelocationPair {
  readonly stableKey: string;
  readonly pageRelocationKey: string;
  readonly low12RelocationKey: string;
  readonly targetSymbolKey: string;
}

export function planPairedRelocations(
  input: PlanPairedRelocationsInput,
): LinkerResult<readonly PlannedRelocationPair[]>;
```

```ts
test("rejects paired relocations that target different symbols", () => {
  const result = planPairedRelocations(pairTargetMismatchFixture());

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected pair error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "relocation:pair-target-mismatch:module:main:reloc:page:reloc:low12",
  ]);
});
```

**Steps:**

- [ ] Add paired relocation negative and happy-path tests.
- [ ] Run the narrow test; expect missing export failures.
- [ ] Implement pair planning in `src/linker/relocation-application.ts`.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 18: Relocation Application And Base Relocations

**Description:** Apply planned, resolved relocations to final section bytes after layout and symbol RVAs are known, and emit structured image base relocation records for absolute address-bearing patches.

**Dependencies:** Tasks 15, 16, and 17.

**Files:**

- Modify: `src/linker/relocation-application.ts`
- Create: `tests/unit/linker/relocation-application.test.ts`

**AC:**

- Relocation application copies section bytes before patching and leaves inputs frozen.
- `branch26`, `branch19`, `branch14`, `pagebase-rel21`, `pageoffset-12a`, `pageoffset-12l`, `addr64`, `addr32`, `addr32nb`, `rel32`, and `section-relative` are covered.
- `addr64` writes `preferredImageBase + S + A` and creates a sorted `dir64` base relocation.
- `addr32` returns `relocation:addr32-not-permitted:<relocationKey>` for the production v1 target because `AARCH64_V1_ADDR32_ABSOLUTE_ALLOWED` is `false`.
- `addr32nb` writes `S + A` and creates no base relocation.
- `section-relative` writes `(S + A) - linkedSection.rva` for the target symbol's output section and creates no base relocation.
- `AppliedRelocation` records use the Task 6 type.
- Failed relocations include module, section, relocation, family, target, patch RVA, target RVA, addend, and allowed range in stable details.

**Code Examples:**

```ts
export interface ApplyResolvedRelocationsInput {
  readonly target: AArch64LinkerTargetSurface;
  readonly sections: readonly LinkedImageSection[];
  readonly symbols: readonly ResolvedImageSymbol[];
  readonly relocationTargets: readonly ResolvedLinkRelocationTarget[];
  readonly plannedPairs: readonly PlannedRelocationPair[];
}

export interface ApplyResolvedRelocationsOutput {
  readonly sections: readonly LinkedImageSection[];
  readonly appliedRelocations: readonly AppliedRelocation[];
  readonly baseRelocations: readonly ImageBaseRelocation[];
}

export function applyResolvedRelocations(
  input: ApplyResolvedRelocationsInput,
): LinkerResult<ApplyResolvedRelocationsOutput>;
```

```ts
test("addr64 writes image-base address and creates dir64 base relocation", () => {
  const result = applyResolvedRelocations(addr64Fixture());

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected applied relocation");
  expect(result.value.baseRelocations).toEqual([
    expect.objectContaining({
      stableKey: "base-reloc:dir64:.data:8192",
      kind: "dir64",
      rva: 0x2000,
    }),
  ]);
});
```

```ts
test("production v1 rejects addr32 absolute patches", () => {
  const result = applyResolvedRelocations(addr32FixtureForTest());

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected addr32 policy error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "relocation:addr32-not-permitted:module:user:data:reloc:absolute32",
  ]);
});
```

**Steps:**

- [ ] Add relocation family application tests.
- [ ] Run the narrow test; expect missing application exports.
- [ ] Extend `src/linker/relocation-application.ts` with application and base relocation records.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 19: Linker-Owned Veneers And Layout Fixed Point

**Description:** Implement the finite cross-stage layout fixed point that requests linker-owned veneers through the injected veneer provider, appends veneer contributions deterministically, and retargets eligible out-of-range branch relocations. This logic lives in `layout-fixed-point.ts`, not `section-layout.ts`, to avoid import cycles between one-pass layout, symbol RVA materialization, and relocation application.

**Dependencies:** Tasks 14, 15, 17, and 18.

**Files:**

- Create: `src/linker/layout-fixed-point.ts`
- Create: `tests/unit/linker/veneer-fixed-point.test.ts`

**AC:**

- Delegated veneer requests fail closed when no veneer provider is configured.
- A veneer is inserted only when relocation family, object relocation, target policy, scratch assumptions, and security provenance all allow it.
- Veneer provider output is a normal verified object module with bytes, symbols, relocations, and provenance.
- Each fixed-point iteration re-runs layout, symbol RVAs, relocation range checks, veneer requests, and base relocation planning.
- The fixed point stops only when veneer set, section sizes, symbol RVAs, and base relocation records are unchanged.
- The iteration cap is exactly `8`; exhaustion emits `section-layout:fixed-point-exhausted:8`.
- `runLinkLayoutFixedPoint` receives stage functions through parameters instead of importing task modules back into `section-layout.ts`.

**Code Examples:**

```ts
test("delegated branch fails closed without veneer provider", () => {
  const result = runLinkLayoutFixedPoint(farBranchWithoutProviderFixture());

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected veneer error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "relocation:linker-veneer-provider-missing:module:user:boot:reloc:far-call",
  ]);
});
```

```ts
export interface LinkLayoutFixedPointFunctions {
  readonly layoutSections: typeof layoutImageSections;
  readonly materializeSymbols: typeof materializeResolvedImageSymbols;
  readonly planPairs: typeof planPairedRelocations;
  readonly applyRelocations: typeof applyResolvedRelocations;
}

export function runLinkLayoutFixedPoint(
  input: LinkLayoutFixedPointInput,
  functions: LinkLayoutFixedPointFunctions,
): LinkerResult<LinkLayoutFixedPointOutput>;
```

**Steps:**

- [ ] Add no-provider, provider-success, security-rejection, and cap-exhaustion tests.
- [ ] Run the narrow test; expect missing fixed-point export failures.
- [ ] Implement fixed-point layout and veneer insertion in `src/linker/layout-fixed-point.ts` using injected stage functions.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 20: Entry Resolution

**Description:** Resolve the UEFI loader-entry symbol and Wrela boot handoff symbol after final symbols and relocations are available.

**Dependencies:** Task 19.

**Files:**

- Create: `src/linker/entry-resolution.ts`
- Create: `tests/unit/linker/entry-resolution.test.ts`

**AC:**

- Loader entry linkage name comes from `target.entryPolicy.loaderEntryLinkageName`.
- Wrela boot linkage name comes from `input.entry.wrelaBootLinkageName`.
- Loader entry resolves to exactly one global definition.
- Loader entry output section satisfies `requiredEntrySectionClass: "executable"`.
- Boot symbol resolves when `requiresBootHandoff` is true.
- Entry RVA fits a PE32+ `AddressOfEntryPoint` field.
- Entry resolution rejects entry contributions with unresolved relocations.

**Code Examples:**

```ts
test("rejects a loader entry in read-only data", () => {
  const result = resolveLinkedImageEntry(nonExecutableEntryFixture());

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected entry error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "entry:non-executable-section:__wrela_uefi_entry:.rdata",
  ]);
});
```

**Steps:**

- [ ] Add entry happy-path and negative tests.
- [ ] Run the narrow test; expect missing export failures.
- [ ] Implement entry resolution.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 21: Linked Unwind And Data Directory Metadata

**Description:** Convert synthetic `.pdata`/`.xdata` object contributions and backend unwind records into linked unwind records and writer-facing data-directory source metadata after RVAs are known.

**Dependencies:** Task 19.

**Files:**

- Create: `src/linker/aarch64/aarch64-linked-image.ts`
- Create: `tests/unit/linker/unwind-metadata.test.ts`

**AC:**

- Linked unwind records name resolved executable function start/end RVAs and unwind-info RVAs.
- `.pdata` and `.xdata` bytes come from ordinary linked sections created by the synthetic unwind provider.
- Unwind metadata rejects missing function symbols, unordered ranges, ranges outside executable sections, and unwind-info RVAs outside target unwind data sections.
- Data-directory source records identify exception/unwind sections for the writer without serializing PE directory bytes.

**Code Examples:**

```ts
test("rejects unwind records whose function range is not executable", () => {
  const result = materializeLinkedUnwindRecords(unwindInDataSectionFixture());

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected unwind error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
    "image-layout:unwind-function-not-executable:unwind:Boot.main:.data",
  ]);
});
```

**Steps:**

- [ ] Add linked unwind happy-path and negative tests.
- [ ] Run the narrow test; expect missing export failures.
- [ ] Implement linked unwind/data-directory metadata.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 22: Linked Image Verifier And Slow Test Validator

**Description:** Implement the production structural verifier and the independent test-only slow validator that recomputes layout facts from the linked image.

**Dependencies:** Tasks 14, 15, 16, 18, 19, 20, and 21.

**Files:**

- Create: `src/linker/verifier.ts`
- Create: `tests/support/linker/slow-linked-image-validator.ts`
- Create: `tests/unit/linker/linked-image-verifier.test.ts`

**AC:**

- Verifier checks input module uniqueness, contribution ranges, section RVA alignment, non-overlap, symbol RVAs, relocation encoded values, base relocation target validity, unwind ranges, entry RVA, provenance partitioning, fact-spending aggregation, and deterministic metadata fingerprints.
- Slow validator recomputes section placement, symbol addresses, relocation values, base relocation records, and entry RVA without calling production verifier helpers.
- `validateLinkedImageLayoutSlowly` and `expectSlowLinkedImageValidation` are exported from `tests/support/linker/slow-linked-image-validator.ts`.
- Corruption tests mutate cloned layouts and assert deterministic diagnostics.

**Code Examples:**

```ts
export function verifyLinkedImageLayout(
  layout: AArch64LinkedImageLayout,
): LinkerResult<LinkerVerificationSummary>;

export function validateLinkedImageLayoutSlowly(
  layout: AArch64LinkedImageLayout,
): LinkerResult<LinkerVerificationSummary>;

export function expectSlowLinkedImageValidation(layout: AArch64LinkedImageLayout): void;
```

```ts
test("verifier catches symbol rva corruption", () => {
  const layout = linkedImageLayoutForTest();
  const corrupted = replaceResolvedSymbolForTest(layout, "Boot.main", { rva: 0x7777 });

  const result = verifyLinkedImageLayout(corrupted);

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected verifier error");
  expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
    "image-layout:symbol-rva-mismatch:Boot.main",
  );
});
```

**Steps:**

- [ ] Add verifier corruption tests and slow-validator tests.
- [ ] Run the narrow test; expect missing export failures.
- [ ] Implement production verifier.
- [ ] Implement test-only slow validator independently.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 23: Link Orchestration

**Description:** Wire `linkAArch64Image` through authenticated stage order: target authentication, synthetic objects, object verification, normalization, symbol resolution, section layout/fixed point, symbol RVAs, relocation planning/application, entry, unwind metadata, linked layout construction, and verification.

**Dependencies:** Tasks 9, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, and 22.

**Files:**

- Modify: `src/linker/aarch64/aarch64-linker.ts`
- Create: `tests/unit/linker/aarch64-link-orchestration.test.ts`

**AC:**

- Stage order is exactly `authenticate-link-target`, `materialize-synthetic-objects`, `verify-input-objects`, `normalize-link-graph`, `resolve-symbols`, `layout-sections`, `materialize-symbol-rvas`, `plan-relocations`, `apply-relocations`, `resolve-entry`, `materialize-unwind-metadata`, `verify-linked-image`.
- Each stage stops on the first unreliable error boundary.
- Successful results include `layout`, sorted non-error diagnostics, and verification summary.
- Error results include diagnostics and verification summary but no partial layout.
- Shuffled module input produces identical layout fingerprint and labeled output records.

**Code Examples:**

```ts
test("returns no partial layout when symbol resolution fails", () => {
  const result = linkAArch64Image(unresolvedExternalLinkInput());

  expect(result.kind).toBe("error");
  if (result.kind !== "error") throw new Error("expected link error");
  expect("layout" in result).toBe(false);
  expect(result.verification.runs.map((run) => run.verifierKey)).toContain("resolve-symbols");
  expect(result.verification.runs.map((run) => run.verifierKey)).not.toContain("layout-sections");
});
```

**Steps:**

- [ ] Add orchestration stage-order, early-stop, success, and shuffle tests.
- [ ] Run the narrow test; expect current API shell to fail stage assertions.
- [ ] Wire each production stage in order.
- [ ] Run the narrow test; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

## Task 24: Public Exports, Integration, And Property Tests

**Description:** Export the linker API and add integration/property tests for backend objects, synthetic entry/unwind objects, cross-module references, absolute data references, shuffle determinism, patch confinement, and provenance partitioning.

**Dependencies:** Task 23.

**Files:**

- Modify: `src/index.ts`
- Modify: `src/target/aarch64/index.ts`
- Modify: `src/linker/index.ts`
- Create: `tests/integration/linker/aarch64-linked-image-layout.test.ts`
- Create: `tests/integration/linker/aarch64-backend-to-linker.test.ts`
- Create: `tests/unit/linker/linker-property.test.ts`
- Modify: `tests/integration/public-api.test.ts`

**AC:**

- `linkAArch64Image` and linked layout types are importable from the project public API.
- Implementation note: the root public API and `src/linker` export the linker API; `src/target/aarch64/index.ts` intentionally does not re-export linker symbols because `scripts/check-policy.ts` forbids target modules from importing the linker subsystem.
- Integration test links a small backend object and checks `.text`, loader entry RVA, applied branch relocation, unwind metadata, and layout fingerprint.
- Integration test links two modules where one references the other's global definition.
- Integration test links an `addr64` data reference and verifies a `dir64` base relocation.
- Property test proves random contribution order produces identical linked section layout.
- Property test proves valid symbol tables resolve deterministically under input shuffling.
- Property test proves generated relocation patches are confined to declared field slices/bit ranges.
- Property test proves byte provenance remains a partition of output section bytes.
- Import-boundary test scans `src/linker/**/*.ts` and rejects imports from frontend, parser, proof-check internals, OptIR pass internals, Bun, filesystem, process, OS, or PE writer modules.

**Code Examples:**

```ts
test("links backend object plus synthetic UEFI entry shim", () => {
  const backend = compileTinyAArch64ObjectForLinkTest();
  const result = linkAArch64Image({
    objectModules: [{ moduleKey: "module:user:boot", objectModule: backend.objectModule }],
    target: targetSurfaceForTest(),
    entry: { wrelaBootLinkageName: "Boot.main" },
    syntheticObjects: [entryShimProviderForTest(), unwindProviderForTest()],
  });

  expect(result.kind).toBe("ok");
  if (result.kind !== "ok") throw new Error("expected linked image");
  expect(result.layout.entry.loaderEntryLinkageName).toBe("__wrela_uefi_entry");
  expect(result.layout.entry.wrelaBootLinkageName).toBe("Boot.main");
  expectSlowLinkedImageValidation(result.layout);
});
```

**Steps:**

- [ ] Add public export, integration, and property tests.
- [ ] Add the linker import-boundary test to `tests/unit/linker/linker-property.test.ts`.
- [ ] Run the three narrow commands in **Verification**; expect export/integration failures.
- [ ] Export the linker API and wire integration helpers.
- [ ] Implement property tests with `fast-check` in tests only.
- [ ] Run narrow commands; expect pass.
- [ ] Run `bun run agent:check`.
- [ ] Commit the task files.

**Verification:**

```bash
bun test ./tests/integration/linker/aarch64-linked-image-layout.test.ts
bun test ./tests/integration/linker/aarch64-backend-to-linker.test.ts
bun test ./tests/unit/linker/linker-property.test.ts
bun test ./tests/integration/public-api.test.ts
bun run agent:check
```

## Post-Implementation Findings

- Linker-owned veneer recovery now only delegates explicit `branch26` out-of-range relocation diagnostics. Other relocation encode failures, such as unaligned branch addends, remain relocation failures and are not masked by veneer generation.
- Authenticated linker target constants canonicalize `sectionFlags` in the production section order before layout uses them, so policy-equivalent surfaces with different object insertion order produce identical section RVAs.
- The public `verify-input-objects` stage composes the backend object verifier with linker input-shape checks. `normalizeAArch64LinkInputs` remains graph-shape normalization for internal tests, and fixed-point veneer graph rebuilds explicitly verify the rebuilt object set before normalization.
- Retargeted caller objects declare synthetic veneer linkages as external symbols, keeping rebuilt object modules valid under the backend object verifier.
- The backend object verifier now decodes only executable-text sections as instructions and applies catalog patch-owner checks only to instruction relocation families, so writable data sections with `addr64` relocations remain valid object input.
- Linked image construction preserves section order as writer-owned virtual section order instead of sorting final sections by stable key; duplicate section stable keys are still rejected.
- The public linker barrel exports the production UEFI entry and unwind synthetic object provider helpers and their factory contract types.
- Linked image verification decodes actual patched section bytes back into relocation encoded values, so corrupted bytes plus corrupted `patchedBytes` metadata cannot satisfy relocation verification by agreeing with each other.
- Linked image metadata recomputation now reports deterministic diagnostics for malformed duplicate-record layouts instead of throwing out of the verifier.
- Link input byte-provenance coverage uses sorted interval scans, preserving gap checks while diagnosing overlapping provenance without per-byte coverage sets.
- Fixed-point graph rebuild retargets linker-owned veneer modules as well as original modules, so nested veneer requests update the delegating veneer relocation instead of leaving it pointed at the far target.
- Linked image verification no longer uses the `addr32` test escape hatch; v1 `addr32` absolute relocations remain rejected in both production and slow verifier paths.
- Relocation application rejects duplicate `addr64` base relocation keys before linked-image construction, so public linking reports an `apply-relocations` diagnostic instead of throwing on duplicate base relocation metadata.
- Backend object verification requires pair keys for low-12 relocation families as well as `pagebase-rel21`, keeping malformed low-12-only objects out of the linker normalization boundary.
- Public linker input and synthetic-provider output paths reject malformed module entries with deterministic linker diagnostics before dereferencing object-module fields.
- Public linker input and synthetic-provider output paths also reject malformed object-module surfaces, including non-array object-module lists, missing `objectModule` fields, and provider results without a concrete module array.
- Linker-owned veneer providers receive the original source/target context and provider output must include an onward relocation to the original target linkage before the caller branch is retargeted to the veneer.
- Public object-module surface validation now requires deterministic metadata with a module fingerprint before normalization freezes modules, keeping malformed caller and provider outputs on diagnostic paths instead of TypeError paths.
- Synthetic unwind objects represent backend unwind source records during final linked-image metadata materialization, so original source records are not materialized a second time when a synthetic unwind module exists for the same function.
- Byte provenance stable keys are unique at both object construction and backend verifier boundaries, preventing malformed object surfaces from reaching linked-image provenance construction as duplicate stable keys.
- Backend object verification decodes `pageoffset-12l` relocation fields with the relocation encoding owner's `accessScaleBytes`, matching the linker relocation math instead of assuming 64-bit loads.
- Synthetic provider preflight validates the provider list and provider entry surfaces before invoking provider callbacks, keeping malformed provider inputs on deterministic `materialize-synthetic-objects` diagnostics.
- The linker import-boundary test resolves relative import specifiers before applying segment-based subsystem checks, covering barrel imports and the real `opt-ir/passes` path.

## Completion Checklist

- [ ] Every task contains checkbox steps and exact verification commands.
- [ ] Object modules expose explicit section classes, discriminated symbols, structured relocation targets, addends, pairs, encoding owners, field-slice-aware relocation policy, and linker-veneer requests.
- [ ] `.extern` is gone from backend object assembly and tests.
- [ ] Linker target policy authenticates concrete v1 constants and mapping records.
- [ ] Fixture helper signatures are centralized and sequenced after their production types.
- [ ] Every stable key format asserted by tests is defined in this plan.
- [ ] Every linker stage returns deterministic diagnostics and frozen records.
- [ ] Linked image layouts contain final bytes, RVAs, symbols, applied relocations, base relocations, entry metadata, unwind metadata, data-directory sources, provenance, fact spending, verification, and deterministic fingerprints.
- [ ] PE/COFF writer responsibilities remain outside `src/linker`.
- [ ] Earlier compiler phases do not import `src/linker/**`.
- [ ] `bun run agent:check` passes.
