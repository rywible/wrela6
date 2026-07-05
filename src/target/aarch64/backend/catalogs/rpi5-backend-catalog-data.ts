import { compareCodeUnitStrings } from "../../../../shared/deterministic-sort";
import { createAArch64Rpi5PhysicalRegisterModel } from "../api/physical-register-model";
import type {
  AArch64BackendCatalogInputs,
  AArch64EncodingCatalog,
  AArch64EncodingCatalogEntry,
  AArch64RelocationCatalog,
  AArch64RelocationCatalogMapping,
} from "../api/backend-catalog-interfaces";
import { AARCH64_OPCODE_FORMS } from "../../machine-ir/opcode-catalog";
import { RPI5_KNOWN_BYTE_FIXTURES } from "./known-byte-fixtures";
import { wordToU32Le } from "../object/encoding-core";

export const AARCH64_CLOSED_OPCODE_INVENTORY = Object.freeze([
  "movz",
  "movk",
  "movn",
  "movi",
  "mov-vector",
  "add-immediate",
  "frame-address",
  "add-shifted-register",
  "sub-shifted-register",
  "sub-immediate",
  "and-logical-immediate",
  "and-shifted-register",
  "orr-logical-immediate",
  "orr-shifted-register",
  "eor-logical-immediate",
  "eor-shifted-register",
  "mul",
  "udiv",
  "sdiv",
  "lsl",
  "lsl-immediate",
  "lsr",
  "cmp-shifted-register",
  "cset",
  "csel",
  "ccmp",
  "cbz",
  "cbnz",
  "tbz",
  "tbnz",
  "bl",
  "blr",
  "b",
  "b-cond",
  "ret",
  "br",
  "trap",
  "ldr-unsigned-immediate",
  "ldr-register-offset",
  "str-unsigned-immediate",
  "ldp-signed-offset",
  "stp-signed-offset",
  "adrp",
  "add-pageoff",
  "rev",
  "rev16",
  "rev32",
  "dmb",
  "dsb",
  "ldar",
  "stlr",
  "ldadd",
  "ldadda",
  "ldaddl",
  "ldaddal",
  "prfm",
  "ld1",
  "st1",
  "tbl",
  "tbx",
  "cmeq",
  "bsl",
  "crc32",
  "pmull",
  "aes-sha-round",
  "fmadd",
  "fmla",
  "fcvt-fp16",
  "sqrdmulh",
  "sqrdmlah",
  "sqadd-saturating",
  "dotprod",
] as const);

export const RPI5_BACKEND_RELOCATION_MAPPINGS = Object.freeze([
  mapping("addr32", "IMAGE_REL_ARM64_ADDR32"),
  mapping("addr32nb", "IMAGE_REL_ARM64_ADDR32NB"),
  mapping("addr64", "IMAGE_REL_ARM64_ADDR64"),
  mapping("branch14", "IMAGE_REL_ARM64_BRANCH14"),
  mapping("branch19", "IMAGE_REL_ARM64_BRANCH19"),
  mapping("branch26", "IMAGE_REL_ARM64_BRANCH26"),
  mapping("pagebase-rel21", "IMAGE_REL_ARM64_PAGEBASE_REL21"),
  mapping("pageoffset-12a", "IMAGE_REL_ARM64_PAGEOFFSET_12A"),
  mapping("pageoffset-12l", "IMAGE_REL_ARM64_PAGEOFFSET_12L"),
  mapping("rel32", "IMAGE_REL_ARM64_REL32"),
  mapping("section-relative", "IMAGE_REL_ARM64_SECREL"),
] satisfies readonly AArch64RelocationCatalogMapping[]);

type Rpi5DecoderPattern = {
  readonly mask: number;
  readonly value: number;
  readonly source: "decoder";
};

type Rpi5RelocationHole = NonNullable<AArch64EncodingCatalogEntry["relocationHole"]>;

const OPCODE_FAMILY_GROUPS = Object.freeze([
  opcodeFamily("move-wide", ["movz", "movk", "movn"]),
  opcodeFamily("simd-fp", [
    "movi",
    "mov-vector",
    "tbl",
    "tbx",
    "cmeq",
    "bsl",
    "fmla",
    "fcvt-fp16",
    "sqrdmulh",
    "sqrdmlah",
    "sqadd-saturating",
  ]),
  opcodeFamily("arithmetic-immediate", [
    "add-immediate",
    "sub-immediate",
    "and-logical-immediate",
    "orr-logical-immediate",
    "eor-logical-immediate",
    "lsl-immediate",
    "frame-address",
  ]),
  opcodeFamily("arithmetic-register", [
    "add-shifted-register",
    "sub-shifted-register",
    "and-shifted-register",
    "orr-shifted-register",
    "eor-shifted-register",
    "mul",
    "udiv",
    "sdiv",
    "lsl",
    "lsr",
  ]),
  opcodeFamily("compare-select", ["cmp-shifted-register", "cset", "csel", "ccmp"]),
  opcodeFamily("branch-control", [
    "cbz",
    "cbnz",
    "tbz",
    "tbnz",
    "bl",
    "blr",
    "b",
    "b-cond",
    "ret",
    "br",
    "trap",
  ]),
  opcodeFamily("load-store-unsigned-immediate", [
    "ldr-unsigned-immediate",
    "str-unsigned-immediate",
  ]),
  opcodeFamily("load-store-register-offset", ["ldr-register-offset"]),
  opcodeFamily("pair-load-store", ["ldp-signed-offset", "stp-signed-offset"]),
  opcodeFamily("adrp-add-pageoff", ["adrp", "add-pageoff"]),
  opcodeFamily("endian", ["rev", "rev16", "rev32"]),
  opcodeFamily("barrier", ["dmb", "dsb"]),
  opcodeFamily("lse-atomic", ["ldar", "stlr", "ldadd", "ldadda", "ldaddl", "ldaddal"]),
  opcodeFamily("prefetch", ["prfm"]),
  opcodeFamily("crc", ["crc32"]),
  opcodeFamily("pmull", ["pmull"]),
  opcodeFamily("aes-sha", ["aes-sha-round"]),
  opcodeFamily("fmadd", ["fmadd"]),
  opcodeFamily("dotprod", ["dotprod"]),
]);

const OPCODE_FAMILY_BY_OPCODE = new Map(
  OPCODE_FAMILY_GROUPS.flatMap((group) =>
    group.opcodes.map((opcode) => [opcode, group.family] as const),
  ),
);

const RELOCATION_HOLE_BY_OPCODE = new Map<string, Rpi5RelocationHole>([
  ["b-cond", relocationHole("branch19", [5, 23], "encoding:b-cond")],
  ["cbz", relocationHole("branch19", [5, 23], "encoding:cbz")],
  ["cbnz", relocationHole("branch19", [5, 23], "encoding:cbnz")],
  ["tbz", relocationHole("branch14", [5, 18], "encoding:tbz")],
  ["tbnz", relocationHole("branch14", [5, 18], "encoding:tbnz")],
  ["b", relocationHole("branch26", [0, 25], "encoding:b")],
  ["bl", relocationHole("branch26", [0, 25], "encoding:bl")],
  ["adrp", relocationHole("pagebase-rel21", [5, 30], "encoding:adrp")],
  ["add-pageoff", relocationHole("pageoffset-12a", [10, 21], "encoding:add-pageoff")],
  [
    "ldr-unsigned-immediate",
    relocationHole("pageoffset-12l", [10, 21], "encoding:ldr-unsigned-immediate"),
  ],
  [
    "str-unsigned-immediate",
    relocationHole("pageoffset-12l", [10, 21], "encoding:str-unsigned-immediate"),
  ],
]);

const DECODER_PATTERN_SPECS = Object.freeze([
  decoderPatternSpec("ret", 0xffffffff, 0xd65f03c0),
  decoderPatternSpec("trap", 0xffffffff, 0xd4200000),
  decoderPatternSpec("dmb", 0xffffffff, 0xd5033bbf),
  decoderPatternSpec("dsb", 0xffffffff, 0xd5033b9f),
  decoderPatternSpec("movz", 0xff800000, 0xd2800000),
  decoderPatternSpec("movk", 0xff800000, 0xf2800000),
  decoderPatternSpec("movn", 0xff800000, 0x92800000),
  decoderPatternSpec("movi", 0xffffffe0, 0x6f00e400),
  decoderPatternSpec("mov-vector", 0xfffffc00, 0x4ea01c00),
  decoderPatternSpec("add-immediate", 0xffc00000, 0x91000000),
  decoderPatternSpec("frame-address", 0xffc00000, 0x91000000),
  decoderPatternSpec("add-pageoff", 0xffc00000, 0x91000000),
  decoderPatternSpec("sub-immediate", 0xffc00000, 0xd1000000),
  decoderPatternSpec("add-shifted-register", 0xffe0fc00, 0x8b000000),
  decoderPatternSpec("sub-shifted-register", 0xffe0fc00, 0xcb000000),
  decoderPatternSpec("and-shifted-register", 0xffe0fc00, 0x8a000000),
  decoderPatternSpec("orr-shifted-register", 0xffe0fc00, 0xaa000000),
  decoderPatternSpec("eor-shifted-register", 0xffe0fc00, 0xca000000),
  decoderPatternSpec("and-logical-immediate", 0xff800000, 0x92000000),
  decoderPatternSpec("orr-logical-immediate", 0xff800000, 0xb2000000),
  decoderPatternSpec("eor-logical-immediate", 0xff800000, 0xd2000000),
  decoderPatternSpec("mul", 0xffe0fc00, 0x9b007c00),
  decoderPatternSpec("udiv", 0xffe0fc00, 0x9ac00800),
  decoderPatternSpec("sdiv", 0xffe0fc00, 0x9ac00c00),
  decoderPatternSpec("lsl", 0xffe0fc00, 0x9ac02000),
  decoderPatternSpec("lsl-immediate", 0xffc00000, 0xd3400000),
  decoderPatternSpec("lsr", 0xffe0fc00, 0x9ac02400),
  decoderPatternSpec("cmp-shifted-register", 0xffe0fc1f, 0xeb00001f),
  decoderPatternSpec("cset", 0xffff0c00, 0x9a9f0400),
  decoderPatternSpec("csel", 0xffe00c00, 0x9a800000),
  decoderPatternSpec("ccmp", 0xffe00c10, 0xfa400000),
  decoderPatternSpec("ldr-unsigned-immediate", 0xffc00000, 0x39400000),
  decoderPatternSpec("ldr-unsigned-immediate", 0xffc00000, 0x3d400000),
  decoderPatternSpec("ldr-unsigned-immediate", 0xffc00000, 0x79400000),
  decoderPatternSpec("ldr-unsigned-immediate", 0xffc00000, 0x7d400000),
  decoderPatternSpec("ldr-unsigned-immediate", 0xffc00000, 0xb9400000),
  decoderPatternSpec("ldr-unsigned-immediate", 0xffc00000, 0xbd400000),
  decoderPatternSpec("ldr-unsigned-immediate", 0xffc00000, 0xf9400000),
  decoderPatternSpec("ldr-unsigned-immediate", 0xffc00000, 0xfd400000),
  decoderPatternSpec("ldr-unsigned-immediate", 0xffc00000, 0x3dc00000),
  decoderPatternSpec("str-unsigned-immediate", 0xffc00000, 0x39000000),
  decoderPatternSpec("str-unsigned-immediate", 0xffc00000, 0x3d000000),
  decoderPatternSpec("str-unsigned-immediate", 0xffc00000, 0x79000000),
  decoderPatternSpec("str-unsigned-immediate", 0xffc00000, 0x7d000000),
  decoderPatternSpec("str-unsigned-immediate", 0xffc00000, 0xb9000000),
  decoderPatternSpec("str-unsigned-immediate", 0xffc00000, 0xbd000000),
  decoderPatternSpec("str-unsigned-immediate", 0xffc00000, 0xf9000000),
  decoderPatternSpec("str-unsigned-immediate", 0xffc00000, 0xfd000000),
  decoderPatternSpec("str-unsigned-immediate", 0xffc00000, 0x3d800000),
  decoderPatternSpec("ldr-register-offset", 0xffe0fc00, 0xf8606800),
  decoderPatternSpec("ldp-signed-offset", 0xffc00000, 0xa9400000),
  decoderPatternSpec("stp-signed-offset", 0xffc00000, 0xa9000000),
  decoderPatternSpec("rev", 0xfffffc00, 0xdac00c00),
  decoderPatternSpec("rev16", 0xfffffc00, 0xdac00400),
  decoderPatternSpec("rev32", 0xfffffc00, 0xdac00800),
  decoderPatternSpec("adrp", 0x9f000000, 0x90000000),
  decoderPatternSpec("ldar", 0xfffffc00, 0xc8dffc00),
  decoderPatternSpec("stlr", 0xfffffc00, 0xc89ffc00),
  decoderPatternSpec("ldadd", 0xff20fc00, 0xf8200000),
  decoderPatternSpec("ldadda", 0xff20fc00, 0xf8a00000),
  decoderPatternSpec("ldaddl", 0xff20fc00, 0xf8600000),
  decoderPatternSpec("ldaddal", 0xff20fc00, 0xf8e00000),
  decoderPatternSpec("prfm", 0xffc0001f, 0xf9800000),
  decoderPatternSpec("ld1", 0xfffffc00, 0x4c407000),
  decoderPatternSpec("st1", 0xfffffc00, 0x4c007000),
  decoderPatternSpec("tbl", 0xffe0fc00, 0x4e000000),
  decoderPatternSpec("tbx", 0xffe0fc00, 0x4e001000),
  decoderPatternSpec("cmeq", 0xffe0fc00, 0x6e208c00),
  decoderPatternSpec("bsl", 0xffe0fc00, 0x6e601c00),
  decoderPatternSpec("crc32", 0xffe0fc00, 0x1ac04800),
  decoderPatternSpec("pmull", 0xffe0fc00, 0x0ee0e000),
  decoderPatternSpec("aes-sha-round", 0xffffff00, 0x4e284800),
  decoderPatternSpec("fmadd", 0xffe08000, 0x1f400000),
  decoderPatternSpec("fmla", 0xffe0fc00, 0x4e20cc00),
  decoderPatternSpec("fcvt-fp16", 0xfffffc00, 0x1e23c000),
  decoderPatternSpec("sqrdmulh", 0xffe0fc00, 0x6ea0b400),
  decoderPatternSpec("sqrdmlah", 0xffe0fc00, 0x6e808400),
  decoderPatternSpec("sqadd-saturating", 0xffe0fc00, 0x4ea00c00),
  decoderPatternSpec("dotprod", 0xffe0fc00, 0x6e809400),
  decoderPatternSpec("b", 0xfc000000, 0x14000000),
  decoderPatternSpec("bl", 0xfc000000, 0x94000000),
  decoderPatternSpec("br", 0xfffffc1f, 0xd61f0000),
  decoderPatternSpec("blr", 0xfffffc1f, 0xd63f0000),
  decoderPatternSpec("b-cond", 0xff000010, 0x54000000),
  decoderPatternSpec("cbz", 0x7f000000, 0x34000000),
  decoderPatternSpec("cbnz", 0x7f000000, 0x35000000),
  decoderPatternSpec("tbz", 0x7f000000, 0x36000000),
  decoderPatternSpec("tbnz", 0x7f000000, 0x37000000),
]);

const DECODER_PATTERNS_BY_OPCODE = decoderPatternsByOpcode(DECODER_PATTERN_SPECS);

const STACK_POINTER_OPERAND_OPCODES = new Set([
  "add-immediate",
  "sub-immediate",
  "frame-address",
  "add-pageoff",
  "ldar",
  "stlr",
  "ldadd",
  "ldadda",
  "ldaddl",
  "ldaddal",
  "prfm",
  "ld1",
  "st1",
]);

const ZERO_REGISTER_OPERAND_OPCODES = new Set([
  "movz",
  "movk",
  "movn",
  "movi",
  "mov-vector",
  "and-logical-immediate",
  "orr-logical-immediate",
  "eor-logical-immediate",
  "add-shifted-register",
  "sub-shifted-register",
  "and-shifted-register",
  "orr-shifted-register",
  "eor-shifted-register",
  "mul",
  "udiv",
  "sdiv",
  "lsl",
  "lsr",
  "cmp-shifted-register",
]);

export const RPI5_ENCODING_ENTRIES = Object.freeze(
  AARCH64_CLOSED_OPCODE_INVENTORY.map(
    (opcode): AArch64EncodingCatalogEntry => ({
      opcode,
      stableKey: `encoding:${opcode}`,
      family: familyForOpcode(opcode),
      requiredFeatures: Object.freeze(requiredFeaturesForOpcode(opcode)),
      knownByteFixtureIds: Object.freeze(
        RPI5_KNOWN_BYTE_FIXTURES.filter((fixture) => fixture.opcode === opcode).map(
          (fixture) => fixture.fixtureId,
        ),
      ),
      instructionWordPatterns: Object.freeze(patternsForOpcode(opcode)),
      permitsSp: permitsStackPointerOperand(opcode),
      permitsZr: permitsZeroRegisterOperand(opcode),
      relocationHole: RELOCATION_HOLE_BY_OPCODE.get(opcode),
    }),
  ).sort((left, right) => compareCodeUnitStrings(left.stableKey, right.stableKey)),
);

const encodingCatalog: AArch64EncodingCatalog = Object.freeze({
  fingerprint: "backend-encoding-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
  entries: RPI5_ENCODING_ENTRIES,
  entryForOpcode: (opcode: string) =>
    RPI5_ENCODING_ENTRIES.find((entry) => entry.opcode === opcode),
  knownByteFixtureFor: (fixtureId: string) =>
    RPI5_KNOWN_BYTE_FIXTURES.find((fixture) => fixture.fixtureId === fixtureId),
});

const relocationCatalog: AArch64RelocationCatalog = Object.freeze({
  fingerprint: "backend-relocation-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
  mappings: RPI5_BACKEND_RELOCATION_MAPPINGS,
  mappingFor: (family: string) =>
    RPI5_BACKEND_RELOCATION_MAPPINGS.find((mappingEntry) => mappingEntry.internalFamily === family),
});

export const RPI5_BACKEND_CATALOGS = Object.freeze({
  registerModel: createAArch64Rpi5PhysicalRegisterModel(),
  encodingCatalog,
  relocationCatalog,
  unwindCatalog: Object.freeze({
    fingerprint: "backend-unwind-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    templates: Object.freeze([
      { frameShape: "leaf", stableKey: "unwind:leaf" },
      { frameShape: "prologue", stableKey: "unwind:prologue" },
      { frameShape: "frame-record", stableKey: "unwind:frame-record" },
      { frameShape: "large-frame", stableKey: "unwind:large-frame" },
    ]),
    templateForFrame: (shape: string) =>
      [
        { frameShape: "leaf", stableKey: "unwind:leaf" },
        { frameShape: "prologue", stableKey: "unwind:prologue" },
        { frameShape: "frame-record", stableKey: "unwind:frame-record" },
        { frameShape: "large-frame", stableKey: "unwind:large-frame" },
      ].find((template) => template.frameShape === shape),
  }),
  frameCatalog: Object.freeze({
    fingerprint: "backend-frame-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    stackAlignmentBytes: 16,
    frameRecordRules: Object.freeze([
      { stableKey: "frame:leaf", frameShape: "leaf", kind: "leaf" },
    ]),
    encodableOffsetClasses: Object.freeze([
      { stableKey: "offset:unsigned12-scaled", byteAlignment: 8 },
    ]),
  }),
  veneerCatalog: Object.freeze({
    fingerprint: "backend-veneer-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    veneerKinds: Object.freeze([
      {
        siteKind: "call",
        policy: { stableKey: "veneer:call", allow: Object.freeze(["branch26"]) },
      },
    ]),
    policyFor: (site: string) =>
      site === "call"
        ? { stableKey: "veneer:call", allow: Object.freeze(["branch26"]) }
        : undefined,
  }),
  literalPoolCatalog: Object.freeze({
    fingerprint: "backend-literal-pool-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    literalClasses: Object.freeze([{ stableKey: "default" }]),
    placementPolicyFor: (literalClass: string) =>
      literalClass === "default"
        ? { stableKey: "literal:default", maxSpanBytes: 1 << 20 }
        : undefined,
  }),
  securityCatalog: Object.freeze({
    fingerprint: "backend-security-catalog:wrela-uefi-aarch64-rpi5-v1:v1",
    constantTimeInstructions: Object.freeze(["ccmp", "csel", "cset"]),
    constantTimeHelpers: Object.freeze([]),
    secretLiteralPolicy: "forbid",
  }),
  tuningModel: Object.freeze({
    fingerprint: "backend-tuning-model:wrela-uefi-aarch64-rpi5-v1:v1",
    latencyWeights: Object.freeze([{ operationKind: "integer", latency: 1 }]),
    throughputWeights: Object.freeze([{ operationKind: "integer", throughput: 1 }]),
    pressureWeights: Object.freeze([{ resource: "gpr", pressure: 1 }]),
  }),
} satisfies Required<AArch64BackendCatalogInputs>);

function mapping(internalFamily: string, peCoffFamily: string): AArch64RelocationCatalogMapping {
  return Object.freeze({ internalFamily, peCoffFamilies: Object.freeze([peCoffFamily]) });
}

function opcodeFamily(family: string, opcodes: readonly string[]) {
  return Object.freeze({ family, opcodes: Object.freeze([...opcodes]) });
}

function relocationHole(
  family: Rpi5RelocationHole["family"],
  bitRange: Rpi5RelocationHole["bitRange"],
  owner: string,
): Rpi5RelocationHole {
  return Object.freeze({ family, bitRange, owner });
}

function decoderPatternSpec(opcode: string, mask: number, value: number) {
  return Object.freeze({ opcode, mask, value });
}

function decoderPattern(mask: number, value: number): Rpi5DecoderPattern {
  return Object.freeze({ mask: mask >>> 0, value: value >>> 0, source: "decoder" });
}

function decoderPatternsByOpcode(
  specs: readonly (typeof DECODER_PATTERN_SPECS)[number][],
): ReadonlyMap<string, readonly Rpi5DecoderPattern[]> {
  const patternsByOpcode = new Map<string, Rpi5DecoderPattern[]>();
  for (const spec of specs) {
    const patterns = patternsByOpcode.get(spec.opcode) ?? [];
    patterns.push(decoderPattern(spec.mask, spec.value));
    patternsByOpcode.set(spec.opcode, patterns);
  }
  return new Map(
    [...patternsByOpcode.entries()].map(([opcode, patterns]) => [
      opcode,
      Object.freeze([...patterns]),
    ]),
  );
}

function familyForOpcode(opcode: string): string {
  return OPCODE_FAMILY_BY_OPCODE.get(opcode) ?? "simd-fp";
}

function requiredFeaturesForOpcode(opcode: string): readonly string[] {
  const formRecord = AARCH64_OPCODE_FORMS.find((form) => String(form.id) === opcode);
  return formRecord?.requiredFeatures ?? ["BASE_A64"];
}

function patternsForOpcode(opcode: string): readonly {
  readonly mask: number;
  readonly value: number;
  readonly source: "decoder" | "known-byte-fixture";
}[] {
  const decoderPatterns = decoderPatternsForOpcode(opcode);
  if (decoderPatterns.length > 0) return decoderPatterns;
  return Object.freeze(
    RPI5_KNOWN_BYTE_FIXTURES.filter((fixture) => fixture.opcode === opcode).map((fixture) =>
      Object.freeze({
        mask: 0xffffffff,
        value: wordToU32Le(fixture.bytes),
        source: "known-byte-fixture" as const,
      }),
    ),
  );
}

function decoderPatternsForOpcode(
  opcode: string,
): readonly { readonly mask: number; readonly value: number; readonly source: "decoder" }[] {
  return DECODER_PATTERNS_BY_OPCODE.get(opcode) ?? Object.freeze([]);
}

function permitsStackPointerOperand(opcode: string): boolean {
  return (
    STACK_POINTER_OPERAND_OPCODES.has(opcode) ||
    opcode.includes("unsigned-immediate") ||
    opcode.includes("signed-offset")
  );
}

function permitsZeroRegisterOperand(opcode: string): boolean {
  return ZERO_REGISTER_OPERAND_OPCODES.has(opcode);
}
