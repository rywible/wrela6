# PE/COFF EFI Writer Design

## Purpose

The PE/COFF EFI writer is the compiler phase after the internal AArch64 linker.
It consumes one verified `AArch64LinkedImageLayout` plus an authenticated writer
target policy and emits one deterministic `.efi` image file. The writer owns the
byte serialization required by UEFI loaders: DOS stub, PE signature, COFF file
header, PE32+ optional header, data directories, section table, section bodies,
base relocation table, and entry-point RVA.

The writer is not another linker. The internal linker has already chosen output
section RVAs, applied AArch64 relocations, resolved the loader entry, produced
base-relocation records, and described exception/unwind directory sources. This
phase turns that structured layout into PE/COFF bytes and independently verifies
that the bytes parse back to the same contract.

The production target for v1 is `wrela-uefi-aarch64-rpi5-v1`: AArch64 PE32+,
COFF machine `IMAGE_FILE_MACHINE_ARM64`, EFI application subsystem, page-aligned
sections, deterministic timestamps, no imports, no exports, no resource table,
and a `.reloc` section when image base relocation records exist.

## Phase Boundary

The phase boundary is:

```text
AArch64LinkedImageLayout
  + AArch64 PE/COFF EFI writer target surface
  -> writer input authentication
  -> linked-layout contract validation
  -> writer section planning
  -> data-directory planning
  -> PE header planning
  -> section table planning
  -> base relocation table serialization
  -> final byte assembly
  -> parse-back verification
  -> PeCoffEfiImageArtifact
  -> compiler edge writes one .efi file
```

The writer core returns bytes and metadata. Filesystem I/O belongs at the
compiler edge, not in the runtime writer. This preserves the repository rule
that filesystem access remains at compiler edges and keeps the writer testable
with dependency injection and fakes.

## Relationship To The Internal Linker

The internal linker is responsible for semantic image layout:

- resolving local and global symbols
- selecting final output section RVAs
- applying AArch64 relocation semantics
- recovering out-of-range branches with linker-owned veneers
- choosing the loader entry RVA
- materializing unwind and exception-directory source records
- creating abstract base relocation records
- preserving linked byte provenance and fact-spending records

The PE/COFF writer is responsible for file-format serialization:

- choosing raw file offsets and raw section sizes
- adding writer-owned sections such as `.reloc`
- encoding the PE32+ optional header and section table
- encoding optional-header data directories
- serializing base relocation blocks
- mapping linked section keys to valid image section names
- validating that emitted bytes parse back to the same linked contract

The writer must not inspect backend object modules. It consumes only the linked
layout and writer target policy. It must not re-solve symbols, reapply
relocations, alter executable bytes, reinterpret AArch64 relocation families, or
change linked RVAs.

## Required Linker Precondition

PE images map headers at the image base before any section body. Therefore no
linked section may occupy the RVA range used by headers. The current internal
linker layout algorithm starts `nextSectionRva` at `0`; before this writer can
accept production linker output, the linker must reserve the initial PE header
page and start the first output section at `sectionAlignmentBytes` (`0x1000` for
v1).

The writer must not repair this by shifting sections, because that would
invalidate `AddressOfEntryPoint`, data-directory sources, symbol RVAs, applied
relocation records, provenance RVAs, and base relocation RVAs. The writer
instead validates the precondition:

- `SizeOfHeaders <= firstSectionRva`
- the first planned section starts at `firstSectionRva`
- v1 `firstSectionRva` is `sectionAlignmentBytes`
- sections then follow the v1 contiguous virtual layout rule

This should be implemented as a small linker prerequisite before the writer's
full-image integration tests. A suitable linker target-surface extension is a
literal `firstSectionRva` or `headerReserveBytes` policy field, authenticated in
the same fingerprint as the rest of the linker layout policy.

## Source Standards

The writer uses Microsoft PE/COFF as the byte-format authority. The Microsoft PE
Format reference defines PE and COFF image structure, RVAs, file pointers,
section headers, optional-header data directories, and base relocation blocks:

- <https://learn.microsoft.com/en-us/windows/win32/debug/pe-format>

The authenticated target surface owns the subset of those standards accepted by
Wrela v1. Production code consumes target records, constants, and validated
layout fields. It does not infer UEFI, AArch64, or PE behavior from host state,
file extensions, or object-section names.

## Production Commitments

The writer has one job, expressed as six commitments:

```text
format:
  emit a valid PE32+ image with MZ header, PE signature, COFF header,
  optional header, data directories, section table, and section bodies

target:
  authenticate AArch64 machine type, EFI application subsystem, alignment,
  image-base, section-name, section-flag, and data-directory policy before
  writing any bytes

layout:
  preserve every linked section RVA and virtual size while assigning
  deterministic file offsets and file-aligned raw sizes

relocations:
  serialize linker-owned base relocation records into PE base relocation
  blocks grouped by 4 KiB page, with DIR64 entries for v1 AArch64 images

verification:
  parse emitted bytes back into a compact PE/COFF model and compare headers,
  sections, directories, entry RVA, image size, raw bytes, and relocation blocks
  against the planned writer model

artifact:
  return one `.efi` artifact with bytes, deterministic metadata, diagnostics,
  and verification summary; let a compiler-edge sink write it to disk
```

## Goals

- Emit exactly one `.efi` file artifact for one linked AArch64 image layout.
- Use PE32+ optional-header magic `0x20b`.
- Use AArch64 COFF machine type `0xaa64`.
- Use EFI application subsystem `10`.
- Preserve `layout.entry.loaderEntryRva` as `AddressOfEntryPoint`.
- Preserve the authenticated writer target `imageBase` as `ImageBase`. For the
  production target this mirrors the linker target's preferred image base.
- Preserve linker section RVAs as PE section `VirtualAddress` values.
- Encode section table entries with deterministic raw file offsets, raw sizes,
  virtual sizes, flags, and valid image section names.
- Encode data directories from linked data-directory sources plus writer-owned
  generated directories.
- Encode `.pdata` as the exception directory when the linked layout supplies an
  exception data-directory source.
- Encode `.reloc` as the base relocation directory when base relocation records
  exist.
- Set every unsupported data directory to `{ rva: 0, size: 0 }`.
- Emit no COFF symbol table and no COFF section relocation entries in the image.
- Use deterministic timestamps and version fields.
- Keep runtime writer code dependency-free. Tests may use fixtures and parsers,
  but production writer code does not import filesystem, Bun, process, host OS,
  clocks, external linkers, dumpbin, llvm-readobj, objdump, or PE parsers.
- Provide a parse-back verifier owned by this phase, not by tests alone.

## Non-Goals

- This phase does not compile source, lower HIR, run proof checking, allocate
  registers, encode A64 instructions, construct backend object modules, or link
  object modules.
- This phase does not support PE32, x64, x86, TE images, Mach-O, ELF, COFF
  object output, UEFI drivers, boot-service drivers, runtime drivers, Windows
  executables, DLL exports, imports, resources, TLS, delay imports, CLR headers,
  certificates, or Authenticode signing in v1.
- This phase does not strip, merge, reorder, or garbage-collect linked sections.
- This phase does not invent missing unwind, exception, relocation, debug, or
  provenance records. Missing writer inputs fail closed.
- This phase does not write files from the core writer. A later compiler edge
  may provide a file sink that writes the `.efi` artifact.
- This phase does not rely on a host PE tool for production validation. External
  tools may be useful in development notes, but the accepted verifier is local
  and deterministic.

## Writer Target Surface

The writer uses an authenticated target surface separate from the linker target
surface. The two surfaces share values such as machine type, subsystem, image
base, section alignment, and section flags, but they serve different purposes.
The linker surface authenticates semantic layout. The writer surface
authenticates serialized file policy.

```ts
export interface AArch64PeCoffEfiWriterTargetSurfaceInput {
  readonly targetKey: "wrela-uefi-aarch64-rpi5-v1";
  readonly linkedTargetPolicyFingerprint: string;
  readonly machine: 0xaa64;
  readonly optionalHeaderMagic: 0x20b;
  readonly subsystem: 10;
  readonly imageBase: 0n;
  readonly sectionAlignmentBytes: 4096;
  readonly fileAlignmentBytes: 512;
  readonly firstSectionRva: 4096;
  readonly maxImageSizeBytes: 134_217_728;
  readonly numberOfRvaAndSizes: 16;
  readonly peHeaderOffsetBytes: 0x80;
  readonly coffTimestamp: 0;
  readonly majorLinkerVersion: 0;
  readonly minorLinkerVersion: 0;
  readonly majorOperatingSystemVersion: 0;
  readonly minorOperatingSystemVersion: 0;
  readonly majorImageVersion: 0;
  readonly minorImageVersion: 0;
  readonly majorSubsystemVersion: 0;
  readonly minorSubsystemVersion: 0;
  readonly dllCharacteristics: 0;
  readonly sizeOfStackReserveBytes: 0n;
  readonly sizeOfStackCommitBytes: 0n;
  readonly sizeOfHeapReserveBytes: 0n;
  readonly sizeOfHeapCommitBytes: 0n;
  readonly serializedSectionNames: Readonly<Record<string, string>>;
}
```

The production defaults are:

```ts
export const WRELA_UEFI_AARCH64_RPI5_PE_COFF_EFI_WRITER_CONSTANTS = Object.freeze({
  machine: 0xaa64,
  optionalHeaderMagic: 0x20b,
  subsystem: 10,
  imageBase: 0n,
  sectionAlignmentBytes: 4096,
  fileAlignmentBytes: 512,
  firstSectionRva: 4096,
  maxImageSizeBytes: 128 * 1024 * 1024,
  numberOfRvaAndSizes: 16,
  peHeaderOffsetBytes: 0x80,
  coffTimestamp: 0,
  majorLinkerVersion: 0,
  minorLinkerVersion: 0,
  majorOperatingSystemVersion: 0,
  minorOperatingSystemVersion: 0,
  majorImageVersion: 0,
  minorImageVersion: 0,
  majorSubsystemVersion: 0,
  minorSubsystemVersion: 0,
  dllCharacteristics: 0,
  sizeOfStackReserveBytes: 0n,
  sizeOfStackCommitBytes: 0n,
  sizeOfHeapReserveBytes: 0n,
  sizeOfHeapCommitBytes: 0n,
  serializedSectionNames: Object.freeze({
    ".text": ".text",
    ".rdata": ".rdata",
    ".data": ".data",
    ".pdata": ".pdata",
    ".xdata": ".xdata",
    ".debug$wrela": ".debug",
    ".reloc": ".reloc",
  }),
});
```

All numeric fields must be authenticated before use. V1 does not allow caller
variation for `imageBase`, `dllCharacteristics`, stack/heap reserve and commit
sizes, alignments, header offsets, section count policy, image-size cap, or
version fields. The writer must reject caller-provided surfaces that change v1
constants, omit required section-name mappings, produce duplicate serialized
names, produce names longer than 8 bytes, or produce names that cannot be
encoded as null-padded ASCII. A future target may make image base or stack/heap
sizes configurable, but that target must define exact alignment, range, and bit
mask rules in its own authenticated surface.

`linkedTargetPolicyFingerprint` must match `layout.targetPolicyFingerprint`.
This prevents a caller from linking with one policy and serializing with another
policy.

## Public API Shape

The writer should expose a small pure core API and keep file writing separate:

```ts
export interface WriteAArch64PeCoffEfiImageInput {
  readonly layout: AArch64LinkedImageLayout;
  readonly target: AArch64PeCoffEfiWriterTargetSurface;
  readonly artifactName?: string;
  readonly diagnosticMode?: PeCoffWriterDiagnosticMode;
}

export type WriteAArch64PeCoffEfiImageResult =
  | {
      readonly kind: "ok";
      readonly artifact: PeCoffEfiImageArtifact;
      readonly diagnostics: readonly PeCoffWriterDiagnostic[];
      readonly verification: PeCoffWriterVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly PeCoffWriterDiagnostic[];
      readonly verification: PeCoffWriterVerificationSummary;
    };

export interface PeCoffEfiImageArtifact {
  readonly artifactName: string;
  readonly mediaType: "application/vnd.microsoft.portable-executable";
  readonly fileExtension: ".efi";
  readonly bytes: readonly number[];
  readonly deterministicMetadata: PeCoffEfiDeterministicMetadata;
  readonly verification: PeCoffWriterVerificationSummary;
}
```

`artifactName` defaults to `wrela.efi` when omitted. If supplied, it must be a
single file name ending in `.efi`; path separators belong to the file sink, not
to the artifact identity.

The compiler edge can wrap the artifact in a file sink:

```ts
export type PeCoffWriterResult<T> =
  | {
      readonly kind: "ok";
      readonly value: T;
      readonly diagnostics: readonly PeCoffWriterDiagnostic[];
      readonly verification: PeCoffWriterVerificationSummary;
    }
  | {
      readonly kind: "error";
      readonly diagnostics: readonly PeCoffWriterDiagnostic[];
      readonly verification: PeCoffWriterVerificationSummary;
    };

export interface PeCoffEfiFileSink {
  writeArtifact(artifact: PeCoffEfiImageArtifact): PeCoffWriterResult<void>;
}
```

Tests should use fake sinks through dependency injection. Production writer code
must not write to the filesystem directly.

## Writer Diagnostics And Verification

Diagnostics follow the existing compiler style: stable codes, deterministic
sorting, and optional stable details. The writer should have its own diagnostic
module rather than reusing linker diagnostics directly.

```ts
export interface PeCoffWriterDiagnostic {
  readonly code: PeCoffWriterDiagnosticCode;
  readonly severity: "error" | "warning";
  readonly message: string;
  readonly stableDetail?: string;
}

export interface PeCoffWriterVerificationSummary {
  readonly runs: readonly PeCoffWriterVerifierRun[];
}

export interface PeCoffWriterVerifierRun {
  readonly verifierKey: string;
  readonly runKey: string;
  readonly status: "passed" | "failed" | "skipped";
  readonly stableDetail?: string;
}
```

The orchestration stages are:

```text
authenticate-writer-target
validate-linked-layout
plan-writer-sections
plan-data-directories
plan-pe-headers
serialize-image
parse-emitted-image
verify-emitted-image
```

As in the linker, failed results include all passed stages before the failed
stage and one failed stage. Stage prefixes should be derived from a single
ordered stage list, not hand-maintained at each return site.

## Input Validation

Before planning bytes, the writer validates:

- `layout.targetKey` is `wrela-uefi-aarch64-rpi5-v1`.
- `layout.targetPolicyFingerprint` equals the writer target's
  `linkedTargetPolicyFingerprint`.
- Every run in `layout.verification.runs` has status `passed`.
- `layout.entry.loaderEntryRva` falls inside an executable linked section.
- Each linked section has a unique `stableKey`, non-empty bytes when
  `virtualSizeBytes > 0`, a non-negative `rva`, a positive alignment, and
  `virtualSizeBytes >= bytes.length`.
- Each linked section has `alignmentBytes === sectionAlignmentBytes`.
- Each linked section RVA is aligned to `sectionAlignmentBytes`.
- The first linked section starts at `firstSectionRva`, and
  `SizeOfHeaders <= firstSectionRva`.
- Linked sections follow contiguous aligned virtual order:
  `nextRva === align(previousRva + previousVirtualSize, sectionAlignmentBytes)`.
- Every section key has a valid serialized section name mapping.
- Every section flag value fits an unsigned 32-bit PE section characteristics
  field.
- Every data-directory source points inside the named linked section.
- At most one linked source exists for each v1 data-directory kind.
- Every base relocation RVA range is contained in the linked section named by
  the relocation: `rva >= section.rva` and
  `rva + widthBytes <= section.rva + section.virtualSizeBytes`.
- Every base relocation has a supported kind and a width compatible with that
  kind.
- Every number used in PE headers fits the field width it will be written to.
- The final planned `SizeOfImage`, including headers and generated `.reloc`, is
  less than or equal to `maxImageSizeBytes`.

The writer should reject malformed linked layouts even if their TypeScript shape
looks correct. This preserves the same boundary discipline as the linker and
backend object verifier.

## PE/COFF Image Shape

The emitted file has this linear structure:

```text
0x0000  IMAGE_DOS_HEADER, e_magic = "MZ", e_lfanew = peHeaderOffsetBytes
0x0040  zero padding through peHeaderOffsetBytes
0x0080  PE signature, "PE\0\0"
0x0084  IMAGE_FILE_HEADER
0x0098  IMAGE_OPTIONAL_HEADER64
        IMAGE_DATA_DIRECTORY[16]
        IMAGE_SECTION_HEADER[numberOfSections]
        header padding to FileAlignment
        section raw data in section-table order
```

The writer should use `peHeaderOffsetBytes = 0x80` for v1. The DOS bytes are
fixed: a 64-byte DOS header with `e_magic = 0x5a4d` at offset `0x00`,
`e_lfanew = 0x80` at offset `0x3c`, all other DOS-header bytes zero, followed
by zero padding through offset `0x7f`. The DOS stub is not executed by UEFI, so
v1 does not emit a text stub.

The optional header must be PE32+ (`IMAGE_OPTIONAL_HEADER64`). It omits
`BaseOfData`, which exists in PE32 but not PE32+.

## Section Planning

Writer sections are planned from linked sections plus generated sections.

```ts
export interface PlannedPeSection {
  readonly sectionKey: string;
  readonly serializedName: string;
  readonly virtualAddress: number;
  readonly virtualSizeBytes: number;
  readonly rawDataPointer: number;
  readonly rawDataSizeBytes: number;
  readonly characteristics: number;
  readonly bytes: readonly number[];
  readonly source: "linked-layout" | "writer-generated";
}
```

Linked sections preserve the linker-assigned `rva`, `virtualSizeBytes`, `flags`,
and `bytes`. The writer chooses `rawDataPointer` and `rawDataSizeBytes`.

Generated sections are appended after linked sections in virtual address order.
For v1, the only generated section is `.reloc`. Its RVA is the next
`sectionAlignmentBytes` boundary after the last linked section. Its
`VirtualSize` is the exact serialized relocation table byte length, while
`SizeOfRawData` is file-aligned. Its characteristics are:

```text
IMAGE_SCN_CNT_INITIALIZED_DATA | IMAGE_SCN_MEM_READ | IMAGE_SCN_MEM_DISCARDABLE
0x42000040
```

The writer should omit `.reloc` when there are no base relocation records. When
`.reloc` is omitted, the base relocation data directory is zero and the COFF
file header must still avoid setting `IMAGE_FILE_RELOCS_STRIPPED` unless the
target policy explicitly permits stripped relocations. V1 should not set
`IMAGE_FILE_RELOCS_STRIPPED`.

Raw section data starts at `SizeOfHeaders`, then advances by
`align(bytes.length, fileAlignmentBytes)` for each section in section-table
order. `SizeOfRawData` is the file-aligned raw size. `VirtualSize` is the exact
unrounded in-memory size.

Sections whose `bytes.length` is zero and `virtualSizeBytes` is non-zero are
valid only for future uninitialized-data policy. V1 should reject them because
the current linker emits initialized section bytes.

## Serialized Section Names

PE image section names are stored in an 8-byte field. Executable images do not
have a string table for longer names. The writer therefore cannot blindly write
linked section keys as section names.

V1 uses target-authenticated mapping:

```text
linked key       PE section name
.text            .text
.rdata           .rdata
.data            .data
.pdata           .pdata
.xdata           .xdata
.debug$wrela     .debug
.reloc           .reloc
```

The linked section key remains the internal identity used for diagnostics,
metadata, provenance, and data-directory source validation. The serialized name
is only the PE section-table name. If two planned sections map to the same
serialized name, v1 fails closed.

## COFF File Header

The COFF file header fields are planned as:

```text
Machine:              0xaa64
NumberOfSections:     planned section count
TimeDateStamp:        0
PointerToSymbolTable: 0
NumberOfSymbols:      0
SizeOfOptionalHeader: 0xf0
Characteristics:      executable image flags
```

`SizeOfOptionalHeader` is `240` bytes for PE32+ with 16 data directories.

The v1 characteristics should include:

```text
IMAGE_FILE_EXECUTABLE_IMAGE 0x0002
IMAGE_FILE_LARGE_ADDRESS_AWARE 0x0020
```

The writer should not set:

- `IMAGE_FILE_RELOCS_STRIPPED`, because UEFI images must remain relocatable when
  base relocation records exist
- `IMAGE_FILE_LINE_NUMS_STRIPPED` as a semantic claim, because line numbers are
  already absent through zero fields
- `IMAGE_FILE_LOCAL_SYMS_STRIPPED` as a semantic claim, because no COFF symbol
  table is emitted
- `IMAGE_FILE_DLL`, because v1 emits EFI applications, not DLLs

If tests or a future target require different characteristic bits, those bits
must come from an authenticated writer target surface.

## Optional Header

The PE32+ optional header fields are planned as:

```text
Magic:                       0x20b
MajorLinkerVersion:          0
MinorLinkerVersion:          0
SizeOfCode:                  sum raw sizes for executable code sections
SizeOfInitializedData:       sum raw sizes for initialized non-code sections
SizeOfUninitializedData:     0
AddressOfEntryPoint:         layout.entry.loaderEntryRva
BaseOfCode:                  first executable section RVA
ImageBase:                   target.imageBase
SectionAlignment:            4096
FileAlignment:               512
MajorOperatingSystemVersion: 0
MinorOperatingSystemVersion: 0
MajorImageVersion:           0
MinorImageVersion:           0
MajorSubsystemVersion:       0
MinorSubsystemVersion:       0
Win32VersionValue:           0
SizeOfImage:                 align(max(firstSectionRva, last virtual section end), SectionAlignment)
SizeOfHeaders:               align(end of section table, FileAlignment)
CheckSum:                    checksum policy value
Subsystem:                   10
DllCharacteristics:          target.dllCharacteristics
SizeOfStackReserve:          target.sizeOfStackReserveBytes
SizeOfStackCommit:           target.sizeOfStackCommitBytes
SizeOfHeapReserve:           target.sizeOfHeapReserveBytes
SizeOfHeapCommit:            target.sizeOfHeapCommitBytes
LoaderFlags:                 0
NumberOfRvaAndSizes:         16
DataDirectory[16]:           planned data directories
```

V1 checksum policy writes `0`. The field is still verified as deterministic and
round-tripped by the parser. If a future firmware target requires a real PE
checksum, that becomes an authenticated target policy and a separate writer
task; it should not be hidden behind host tooling.

`BaseOfCode` has no fallback branch in v1: no executable section is an input
validation error because the entry RVA must fall inside executable code.

`SizeOfCode` and `SizeOfInitializedData` use raw sizes because the optional
header describes section data on disk for those aggregate fields. The verifier
must recompute both from the planned section table. `SizeOfImage` covers the
reserved header page, all linked sections, and the generated `.reloc` section
when present.

## Data Directories

The writer always emits 16 data-directory entries. Unsupported entries are zero.

```text
index  name                 v1 source
0      Export Table         zero
1      Import Table         zero
2      Resource Table       zero
3      Exception Table      linked `directoryKind: "exception"`
4      Certificate Table    zero
5      Base Relocation      generated `.reloc`
6      Debug                linked `directoryKind: "debug"` when supported
7      Architecture         zero
8      Global Ptr           zero
9      TLS Table            zero
10     Load Config Table    zero
11     Bound Import         zero
12     Import Address Table zero
13     Delay Import         zero
14     CLR Runtime Header   zero
15     Reserved             zero
```

Exception directory:

- Source is `layout.dataDirectorySources` with `directoryKind: "exception"`.
- V1 expects the source to name `.pdata`.
- The directory RVA and size are copied from the source after validating that
  the range is contained in the named section.

Base relocation directory:

- Source is the writer-generated `.reloc` section.
- The directory RVA is the `.reloc` section RVA.
- The directory size is the exact serialized relocation table byte length, not
  the file-aligned raw section size.

Debug directory:

- The linked layout type already reserves `directoryKind: "debug"`.
- V1 may carry `.debug$wrela` as ordinary discardable read-only bytes, but the
  writer does not emit a PE debug directory unless the linked data-directory
  source explicitly supplies one and the target policy enables it.
- If debug directory support is not enabled, a debug source is an error rather
  than silently ignored.

Certificate table:

- Remains zero in v1.
- Unlike most data directories, the certificate table uses a file pointer rather
  than an RVA in PE. Because v1 does not emit certificates, no special handling
  is needed yet.

## Base Relocation Serialization

The internal linker emits abstract base relocation records:

```ts
export interface ImageBaseRelocation {
  readonly stableKey: string;
  readonly kind: "dir64" | "highlow" | "target-specific";
  readonly sectionKey: string;
  readonly rva: number;
  readonly widthBytes: number;
  readonly sourceRelocationKey: string;
}
```

The writer serializes them into PE base relocation blocks:

```text
IMAGE_BASE_RELOCATION {
  uint32 PageRva;
  uint32 BlockSize;
  uint16 TypeOffset[];
}
```

Planning rules:

- Sort relocations by `rva`, then `stableKey`.
- Reject duplicate relocation RVAs in v1.
- Group by `pageRva = floor(rva / 4096) * 4096`.
- For each relocation, compute `pageOffset = rva - pageRva`.
- `pageOffset` must fit 12 bits.
- For `kind: "dir64"`, require `widthBytes === 8` and encode type `10`
  (`IMAGE_REL_BASED_DIR64`).
- For `kind: "highlow"`, require `widthBytes === 4` and encode type `3`
  (`IMAGE_REL_BASED_HIGHLOW`). The production AArch64 target does not use this
  kind, but the model can reject or support it through target policy.
- Reject `kind: "target-specific"` in v1 until the writer target defines a PE
  relocation type for it.
- Encode each entry as `(type << 12) | pageOffset`.
- If a block has an odd number of entries, append one
  `IMAGE_REL_BASED_ABSOLUTE` entry (`0`) as padding.
- `BlockSize = 8 + 2 * entryCountIncludingPadding`.
- Every block starts on a 32-bit boundary.

The verifier must parse `.reloc` bytes back into blocks, ignore absolute padding
entries, and compare the reconstructed relocation RVAs and types to the planned
base relocation records.

## Header And Section Byte Writers

The writer should use small little-endian writer helpers:

```ts
interface ByteWriter {
  offset(): number;
  writeU8(value: number): void;
  writeU16Le(value: number): void;
  writeU32Le(value: number): void;
  writeU64Le(value: bigint): void;
  writeBytes(bytes: readonly number[]): void;
  writeZeroes(count: number): void;
  patchU32Le(offset: number, value: number): void;
}
```

Every helper validates range before writing. A failed range check returns a
diagnostic result, not a truncated value. `writeU64Le` accepts only unsigned
64-bit values.

Do not build headers with ad-hoc string concatenation or host `Buffer` behavior.
The writer should use explicit little-endian fields so tests can inspect exact
offsets and failure diagnostics.

## File Layout Algorithm

The writer should use this deterministic algorithm:

1. Authenticate the writer target.
2. Validate the linked layout against the writer target.
3. Serialize base relocation records into `.reloc` bytes if any exist.
4. Build linked planned sections from `layout.sections`.
5. Append `.reloc` as a generated planned section when relocation bytes exist.
6. Sort planned sections by `virtualAddress`, then `sectionKey`.
7. Compute `SizeOfHeaders` from DOS header, PE signature, COFF header, optional
   header, data directories, and section headers.
8. Validate `SizeOfHeaders <= firstSectionRva` and contiguous virtual section
   order starting at `firstSectionRva`.
9. Assign `rawDataPointer` values in section-table order starting at
   `SizeOfHeaders`.
10. Compute data-directory RVAs and sizes.
11. Compute optional-header aggregates and enforce `maxImageSizeBytes`.
12. Allocate the final byte array size from the last raw section end.
13. Write DOS header and zero padding.
14. Write PE signature.
15. Write COFF file header.
16. Write PE32+ optional header and data directories.
17. Write section headers.
18. Pad to `SizeOfHeaders`.
19. Write each section body and file-alignment padding.
20. Parse emitted bytes.
21. Verify parsed bytes against the planned model.

The algorithm is single-pass after planning. Any field that depends on later
state is computed in the planning model before serialization starts. The
serializer should not discover facts by looking back at bytes it already wrote.

## Deterministic Metadata

The artifact carries deterministic metadata:

```ts
export interface PeCoffEfiDeterministicMetadata {
  readonly schema: "wrela.pe-coff-efi-image";
  readonly schemaVersion: 1;
  readonly linkedLayoutFingerprint: string;
  readonly writerTargetFingerprint: string;
  readonly sectionTableFingerprint: string;
  readonly dataDirectoryFingerprint: string;
  readonly baseRelocationTableFingerprint: string;
  readonly headerFingerprint: string;
  readonly imageFingerprint: string;
}
```

Fingerprints use the existing `stableJson` and `stableHash` helpers. The image
fingerprint hashes the final byte sequence by value, not by object identity.
The public artifact uses `readonly number[]` to match the repository's current
byte-array style. A file sink may convert to `Uint8Array` or `Buffer` at the
edge when writing bytes, but runtime writer logic remains independent of host
I/O APIs and the writer target's image-size cap bounds memory use.

The metadata is not serialized into the `.efi` file in v1. It is returned with
the artifact for compiler orchestration, tests, and future reproducibility
reports.

## Parse-Back Verifier

The writer owns a minimal PE parser that reads the emitted bytes back into a
model:

```ts
interface ParsedPeCoffImage {
  readonly dosHeader: ParsedDosHeader;
  readonly coffHeader: ParsedCoffHeader;
  readonly optionalHeader: ParsedPe32PlusOptionalHeader;
  readonly dataDirectories: readonly ParsedDataDirectory[];
  readonly sections: readonly ParsedSectionHeader[];
  readonly baseRelocationBlocks: readonly ParsedBaseRelocationBlock[];
}
```

The parser is not a general-purpose permissive PE parser. It is a strict reader
for Wrela-emitted images. It must still validate enough structure to catch
writer bugs:

- `MZ` magic and `e_lfanew`
- `PE\0\0` signature
- COFF machine, section count, optional-header size, and symbol-table zeros
- PE32+ magic
- image base, alignments, subsystem, entry RVA, image size, headers size, and
  directory count
- section names, virtual addresses, virtual sizes, raw pointers, raw sizes, and
  characteristics
- zero relocation pointers and counts in image section headers
- data-directory RVAs and sizes
- `.reloc` block headers, type/offset entries, block sizes, padding, and bounds

The verifier compares parsed fields to the planned writer model. It should not
compare only snapshots. Every important PE field has a semantic assertion.

## Provenance And Debug Payloads

The writer should preserve linked byte provenance in the artifact metadata and
verification diagnostics. It should not embed a Wrela provenance table into the
`.efi` file unless the linked layout contains a debug-provenance section and the
target policy maps that section to a serialized section name.

For v1, `.debug$wrela` is treated as a normal linked section whose serialized
section name is `.debug`. It is discardable and readable. The writer does not
interpret its contents.

Future debug-directory support can point the PE debug data directory at a
structured debug directory inside `.debug`, but that requires a separate design
section because PE debug directory entries carry their own timestamp, type, size,
RVA, and file pointer fields.

## Error Handling

The writer fails closed on:

- unauthenticated or mismatched target policy
- missing or malformed linked layout fields
- invalid section-name mappings
- overlapping virtual sections
- section RVAs that collide with the reserved PE header range
- non-contiguous virtual sections under the v1 layout policy
- invalid raw or virtual alignment
- entry RVA outside executable code
- data-directory source outside its section
- base relocation ranges outside their linked section
- unsupported base relocation kind
- duplicate base relocation RVA
- integer overflow or field-width overflow
- final byte parser mismatch

Warnings are allowed only for non-fatal, deterministic observations such as an
empty optional debug-provenance section in diagnostic mode. The production path
should prefer errors over warnings at format boundaries.

## Import Boundaries

The writer should live under a new runtime subsystem, for example:

```text
src/pe-coff/
  aarch64/
    aarch64-pe-coff-efi-writer.ts
    aarch64-pe-coff-target.ts
  diagnostics.ts
  headers.ts
  pe-byte-writer.ts
  pe-file-layout.ts
  pe-parser.ts
  pe-relocations.ts
  pe-verifier.ts
  index.ts
```

Allowed imports:

- `src/linker` public linked-layout types
- `src/shared/deterministic-sort`
- `src/shared/stable-json`
- small local PE helpers

Disallowed imports:

- frontend, parser, HIR, OptIR, proof-check, proof-mir, mono internals
- backend object modules
- backend verifier internals
- filesystem, Bun, process, OS, external binary tools
- npm PE libraries

The public root barrel should export the writer through `src/index.ts` after the
writer API is stable. Existing earlier phases must not import `src/pe-coff`.
`scripts/check-policy.ts` should gain an import-boundary rule for the new phase.

## Testing Strategy

Use narrow tests while iterating and `bun run agent:check` before handoff.

Unit tests:

- target authentication rejects altered machine, subsystem, magic, alignments,
  directory count, duplicate serialized names, and long section names
- byte writer emits little-endian fields and rejects overflow
- section planner preserves linked RVAs and assigns deterministic raw offsets
- optional-header planner computes `SizeOfHeaders`, `SizeOfImage`,
  `SizeOfCode`, `SizeOfInitializedData`, `BaseOfCode`, and entry RVA
- data-directory planner emits exception and base relocation directories and
  zeroes unsupported entries
- base relocation serializer groups entries by page, sorts deterministically,
  encodes DIR64 type/offset words, and pads odd entry counts
- parser rejects malformed MZ, PE signature, optional-header magic, truncated
  section table, invalid directory count, and malformed relocation blocks
- verifier detects mismatch between planned and parsed headers, sections,
  directories, and relocation records

Integration tests:

- link a tiny AArch64 image and write one `.efi` artifact
- parse the artifact and assert PE32+, ARM64 machine, EFI application subsystem,
  entry RVA, section table, exception directory, and base relocation directory
- verify `.text` bytes match linked section bytes exactly
- verify `.reloc` contains a DIR64 record for an absolute data relocation
- verify identical linked layouts produce identical artifact bytes and
  fingerprints
- verify section-name mapping serializes `.debug$wrela` as `.debug`

Property tests:

- relocation block serialization round-trips for generated sorted relocation
  sets with unique RVAs
- section raw-offset planning round-trips for generated section sizes and
  alignments within v1 bounds
- parser never throws on arbitrary byte arrays and returns diagnostics instead

Audit tests:

- writer runtime files stay below the repository size threshold
- writer runtime source does not import filesystem, Bun, process, OS, or
  external PE libraries
- earlier compiler phases do not import the writer

## Build Waves

### Wave 0: Linker Header Page Reservation

Update the internal linker target policy and section layout so the first output
section starts at `sectionAlignmentBytes` (`0x1000`) instead of RVA `0`. Add
linker tests proving the loader entry, section contributions, data-directory
sources, symbols, applied relocations, provenance, and base relocation RVAs all
move consistently. The PE/COFF writer integration tests depend on this
precondition.

### Wave 1: Types, Diagnostics, And Target Surface

Add writer diagnostics, verification summaries, result types, public artifact
types, and authenticated target-surface construction. Tests should lock the v1
constants, including `firstSectionRva` and `maxImageSizeBytes`, and reject
malformed surfaces.

### Wave 2: PE Byte Writer And Header Models

Add little-endian byte writer helpers and typed PE header planning records.
Write unit tests for field offsets, range checks, and header-size constants.

### Wave 3: Section And Data Directory Planning

Plan linked sections, generated `.reloc`, raw file offsets, data directories,
optional-header aggregates, and serialized section-name mapping. Tests should
cover `.debug$wrela` name serialization and exception directory bounds.

### Wave 4: Base Relocation Serialization

Serialize `layout.baseRelocations` into PE relocation blocks. Add parser and
round-trip tests for DIR64 records, page grouping, absolute padding, and
malformed blocks.

### Wave 5: Full Image Serialization

Write DOS header, PE signature, COFF header, optional header, data directories,
section table, section bytes, and padding into one artifact. Add deterministic
metadata and artifact fingerprinting.

### Wave 6: Parse-Back Verification

Add the strict local parser and verifier. The writer result is `ok` only when
the emitted bytes parse back to the planned model.

### Wave 7: Public API And Compiler Edge

Export the writer from the PE/COFF subsystem and root barrel. Add a
dependency-injected file sink at the compiler edge that writes the artifact to a
`.efi` path. Keep the core writer pure.

## Acceptance Criteria

- A verified `AArch64LinkedImageLayout` for `wrela-uefi-aarch64-rpi5-v1`
  produces one deterministic `.efi` artifact.
- The artifact starts with `MZ`, has `e_lfanew = 0x80`, and has a `PE\0\0`
  signature at that offset.
- The COFF header uses machine `0xaa64`, has zero symbol table fields, and has
  a PE32+ optional header size of `0xf0`.
- The optional header uses magic `0x20b`, subsystem `10`, image base from
  policy, section alignment `4096`, file alignment `512`, and entry RVA from
  `layout.entry.loaderEntryRva`.
- The first linked section starts at RVA `0x1000`; no section overlaps the PE
  header range.
- Every linked section appears exactly once in the section table with the same
  RVA, virtual size, flags, and bytes.
- Linked and generated sections follow contiguous aligned virtual order.
- Raw section offsets and sizes are file-aligned and deterministic.
- Unsupported data directories are zero.
- The exception directory points at the linked `.pdata` source when present.
- Base relocation records serialize into `.reloc` blocks and the base
  relocation data directory points at the exact table size.
- No COFF image section contains section relocation entries.
- The parse-back verifier independently confirms the emitted headers, section
  table, data directories, entry RVA, image size, and base relocation blocks.
- Runtime writer source remains dependency-free and respects import-boundary
  policy.
- `bun run agent:check` passes.

## Future Work

- Real PE checksum policy if a target or firmware validation path requires it.
- PE debug directory entries for structured Wrela debug/provenance payloads.
- Authenticode certificate table support at a signing edge.
- UEFI driver and runtime-driver subsystem targets.
- TE image emission for firmware environments that prefer TE over PE32+.
- Multiple AArch64 target profiles if future hardware support requires distinct
  writer policies.
