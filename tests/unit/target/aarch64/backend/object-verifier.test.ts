import { describe, expect, test } from "bun:test";

import { verifyAArch64ObjectModule } from "../../../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import { RPI5_KNOWN_BYTE_FIXTURES } from "../../../../../src/target/aarch64/backend/catalogs/known-byte-fixtures";
import {
  aarch64ObjectModuleForTest,
  byteProvenanceForTest,
  literalPoolForTest,
  relocationForTest,
  sectionForTest,
  symbolForTest,
  unwindRecordForTest,
  veneerForTest,
} from "../../../../../tests/support/target/aarch64/backend/object-module-fixtures";

describe("AArch64 object verifier", () => {
  test("accepts a valid object module", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0xe0, 0x00, 0x80, 0xd2, 0x02, 0x00, 0x01, 0x8b],
        }),
      ],
      symbols: [symbolForTest({ stableKey: "main", sectionKey: ".text" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 8,
        }),
      ],
    });

    expect(verifyAArch64ObjectModule({ objectModule }).kind).toBe("ok");
  });

  test("accepts authenticated catalog fixture opcodes outside the old verifier decoder subset", () => {
    const fixture = RPI5_KNOWN_BYTE_FIXTURES.find(
      (candidate) => candidate.fixtureId === "dotprod-v0-v1-v2",
    );
    if (fixture === undefined) throw new Error("missing dotprod fixture");
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: fixture.bytes })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    expect(verifyAArch64ObjectModule({ objectModule }).kind).toBe("ok");
  });

  test("uses caller-provided encoding catalog patterns for object decoding", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({
      objectModule,
      encodingCatalog: {
        fingerprint: "test-empty-pattern-catalog",
        entries: [],
        entryForOpcode: () => undefined,
        knownByteFixtureFor: () => undefined,
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected catalog-backed decode error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:unknown-encoding:.text:offset:0",
    ]);
  });

  test("rejects corrupted instruction bytes", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xff, 0xff, 0xff, 0xff] })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected encoding error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:unknown-encoding:.text:offset:0",
    ]);
  });

  test("rejects relocation patch outside fragment and missing symbol", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
      symbols: [],
      relocations: [],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });
    const objectModule = {
      ...valid,
      relocations: [
        relocationForTest({
          stableKey: "reloc:bad",
          sectionKey: ".text",
          offsetBytes: 8,
          widthBytes: 4,
          targetSymbol: "missing",
        }),
      ],
    };

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected relocation errors");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:relocation-patch-out-of-range:.text:offset:8:size:4",
      "object-verifier:symbol-missing:reloc:bad:missing",
    ]);
  });

  test("rejects relocation patches outside their encoded fragment", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0x00, 0x00, 0x00, 0x94, 0x00, 0x00, 0x00, 0x94],
          fragments: [{ stableKey: "text.main", startOffsetBytes: 0, sizeBytes: 4 }],
        }),
      ],
      symbols: [symbolForTest({ stableKey: "target", sectionKey: ".text" })],
      relocations: [
        relocationForTest({
          stableKey: "reloc:outside-fragment",
          sectionKey: ".text",
          offsetBytes: 4,
          targetSymbol: "target",
          bitRange: [0, 25],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 8,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected fragment ownership error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:relocation-patch-outside-fragment:reloc:outside-fragment:.text:offset:4",
    ]);
  });

  test("rejects relocation families that are absent from the catalog", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x94] })],
      symbols: [symbolForTest({ stableKey: "target", sectionKey: ".text" })],
      relocations: [
        relocationForTest({
          stableKey: "reloc:unknown",
          sectionKey: ".text",
          offsetBytes: 0,
          widthBytes: 4,
          family: "not-a-family",
          targetSymbol: "target",
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected relocation family error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:relocation-family-unmapped:reloc:unknown:not-a-family",
    ]);
  });

  test("uses caller-provided relocation catalog instead of the default catalog", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x94] })],
      symbols: [symbolForTest({ stableKey: "target", sectionKey: ".text" })],
      relocations: [
        relocationForTest({
          stableKey: "reloc:branch",
          sectionKey: ".text",
          offsetBytes: 0,
          widthBytes: 4,
          family: "branch26",
          targetSymbol: "target",
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({
      objectModule,
      relocationCatalog: {
        fingerprint: "test-relocations-without-branch26",
        mappings: [],
        mappingFor: () => undefined,
      },
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected target catalog error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:relocation-family-unmapped:reloc:branch:branch26",
    ]);
  });

  test("rejects relocation families that do not own the encoded patch opcode", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
      symbols: [symbolForTest({ stableKey: "target", sectionKey: ".text" })],
      relocations: [
        relocationForTest({
          stableKey: "reloc:branch-on-movz",
          sectionKey: ".text",
          offsetBytes: 0,
          widthBytes: 4,
          family: "branch26",
          targetSymbol: "target",
          bitRange: [0, 25],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected relocation owner error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:relocation-owner-missing:reloc:branch-on-movz:branch26:opcode:movz",
    ]);
  });

  test("rejects relocation bit ranges that do not match the catalog owner", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x94] })],
      symbols: [symbolForTest({ stableKey: "target", sectionKey: ".text" })],
      relocations: [
        relocationForTest({
          stableKey: "reloc:wrong-range",
          sectionKey: ".text",
          offsetBytes: 0,
          widthBytes: 4,
          family: "branch26",
          targetSymbol: "target",
          bitRange: [5, 23],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected relocation range error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:relocation-owner-bit-range-mismatch:reloc:wrong-range:branch26:opcode:bl:expected:0-25:actual:5-23",
    ]);
  });

  test("does not decode literal pool data as instructions", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0xc0, 0x03, 0x5f, 0xd6, 0xff, 0xff, 0xff, 0xff],
        }),
      ],
      literalPools: [
        literalPoolForTest({
          stableKey: "literal:data",
          sectionKey: ".text",
          offsetBytes: 4,
          data: [0xff, 0xff, 0xff, 0xff],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 8,
        }),
      ],
    });

    expect(verifyAArch64ObjectModule({ objectModule }).kind).toBe("ok");
  });

  test("does not decode alignment padding provenance as instructions", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0xe0, 0x00, 0x80, 0xd2, 0x00, 0x00, 0x00, 0x00, 0xc0, 0x03, 0x5f, 0xd6],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "byte:.text:movz:first",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
        byteProvenanceForTest({
          stableKey: "byte:.text:align:text.second:offset:4",
          sectionKey: ".text",
          startOffsetBytes: 4,
          byteLength: 4,
          source: "align:text.second",
        }),
        byteProvenanceForTest({
          stableKey: "byte:.text:ret",
          sectionKey: ".text",
          startOffsetBytes: 8,
          byteLength: 4,
        }),
      ],
    });

    expect(verifyAArch64ObjectModule({ objectModule }).kind).toBe("ok");
  });

  test("rejects literal pool byte mismatches, overlaps, and secret provenance", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0xc0, 0x03, 0x5f, 0xd6, 1, 2, 3, 4],
        }),
      ],
      literalPools: [
        literalPoolForTest({
          stableKey: "literal:a",
          sectionKey: ".text",
          offsetBytes: 4,
          data: [4, 3, 2, 1],
        }),
        literalPoolForTest({
          stableKey: "literal:b",
          sectionKey: ".text",
          offsetBytes: 6,
          data: [7, 8],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "insn",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
        byteProvenanceForTest({
          stableKey: "literal",
          sectionKey: ".text",
          startOffsetBytes: 4,
          byteLength: 4,
          factFamilies: ["security-and-secret-lifetime"],
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule: valid });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected literal verifier errors");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:literal-pool-data-mismatch:literal:a",
      "object-verifier:literal-pool-data-mismatch:literal:b",
      "object-verifier:literal-pool-overlap:literal:a:literal:b:.text:offset:6",
      "object-verifier:literal-pool-secret:literal:a",
      "object-verifier:literal-pool-secret:literal:b",
    ]);
  });

  test("rejects literal pool entries outside declared user reach", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0xc0, 0x03, 0x5f, 0xd6, 0, 0, 0, 0, 1, 2, 3, 4],
        }),
      ],
      literalPools: [
        literalPoolForTest({
          stableKey: "literal:far",
          sectionKey: ".text",
          offsetBytes: 8,
          data: [1, 2, 3, 4],
          users: [{ stableKey: "literal:user", useOffsetBytes: 0, maxReachBytes: 4 }],
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "byte:.text:ret",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
        byteProvenanceForTest({
          stableKey: "byte:.text:align:literal:offset:4",
          sectionKey: ".text",
          startOffsetBytes: 4,
          byteLength: 4,
          source: "align:literal",
        }),
        byteProvenanceForTest({
          stableKey: "byte:literal:far",
          sectionKey: ".text",
          startOffsetBytes: 8,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected literal reach error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:literal-pool-reach-out-of-bounds:literal:far:user:literal:user:distance:8:limit:4",
    ]);
  });

  test("rejects malformed relocation ownership metadata", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x94] })],
      symbols: [symbolForTest({ stableKey: "target", sectionKey: ".text" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });
    const objectModule = {
      ...valid,
      relocations: [
        relocationForTest({
          stableKey: "reloc:bad-width",
          sectionKey: ".text",
          offsetBytes: 1,
          widthBytes: 8,
          family: "branch26",
          targetSymbol: "target",
        }),
      ],
    };

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected relocation metadata errors");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:relocation-offset-unaligned:reloc:bad-width:1",
      "object-verifier:relocation-patch-out-of-range:.text:offset:1:size:4",
      "object-verifier:relocation-width-invalid:reloc:bad-width:branch26:8",
    ]);
  });

  test("rejects malformed literal pools, veneers, and unwind records", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
      symbols: [symbolForTest({ stableKey: "main", sectionKey: ".text" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });
    const objectModule = {
      ...valid,
      literalPools: [literalPoolForTest({ stableKey: "literal:bad", offsetBytes: 4, data: [1] })],
      veneers: [veneerForTest({ stableKey: "veneer:bad", targetKey: "missing" })],
      unwindRecords: [
        unwindRecordForTest({
          stableKey: "unwind:missing",
          frameShape: "mystery-frame",
        }),
      ],
    };

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected object metadata errors");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:literal-pool-out-of-range:.text:offset:4:size:4",
      "object-verifier:unwind-frame-shape-unknown:unwind:missing:mystery-frame",
      "object-verifier:unwind-symbol-missing:unwind:missing:missing",
      "object-verifier:veneer-bytes-missing:veneer:bad",
      "object-verifier:veneer-target-missing:veneer:bad:missing",
    ]);
  });

  test("rejects veneers without a branch encoding at their recorded bytes", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xc0, 0x03, 0x5f, 0xd6] })],
      symbols: [symbolForTest({ stableKey: "target", sectionKey: ".text" })],
      veneers: [veneerForTest({ stableKey: "veneer:bad", targetKey: "target" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "byte:veneer:bad",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected veneer byte error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:veneer-encoding-invalid:veneer:bad:opcode:ret",
      "object-verifier:veneer-relocation-missing:veneer:bad",
    ]);
  });

  test("accepts backend-owned veneer bytes with relocation to original target", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0x00, 0x00, 0x00, 0x94, 0x00, 0x00, 0x00, 0x14],
          fragments: [{ stableKey: "text.main", startOffsetBytes: 0, sizeBytes: 4 }],
        }),
      ],
      symbols: [
        symbolForTest({ stableKey: "target", sectionKey: ".text", offsetBytes: 0 }),
        symbolForTest({ stableKey: "veneer:call", sectionKey: ".text", offsetBytes: 4 }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:call",
          sectionKey: ".text",
          offsetBytes: 0,
          family: "branch26",
          targetSymbol: "veneer:call",
          bitRange: [0, 25],
        }),
        relocationForTest({
          stableKey: "reloc:veneer:call",
          sectionKey: ".text",
          offsetBytes: 4,
          family: "branch26",
          targetSymbol: "target",
          bitRange: [0, 25],
        }),
      ],
      veneers: [veneerForTest({ stableKey: "veneer:call", targetKey: "target" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes:call",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
        byteProvenanceForTest({
          stableKey: "byte:veneer:call",
          sectionKey: ".text",
          startOffsetBytes: 4,
          byteLength: 4,
        }),
      ],
    });

    expect(verifyAArch64ObjectModule({ objectModule }).kind).toBe("ok");
  });

  test("validates veneer branch26 reach with asymmetric signed branch scaling", () => {
    const validObjectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x14] })],
      symbols: [
        symbolForTest({
          stableKey: "target",
          sectionKey: ".text",
          offsetBytes: 0,
        }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:veneer:far",
          sectionKey: ".text",
          offsetBytes: 0,
          family: "branch26",
          targetSymbol: "target",
          bitRange: [0, 25],
        }),
      ],
      veneers: [veneerForTest({ stableKey: "veneer:far", targetKey: "target" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "byte:veneer:far",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });
    const objectModule = {
      ...validObjectModule,
      symbols: Object.freeze([
        {
          ...validObjectModule.symbols[0]!,
          offsetBytes: 128 * 1024 * 1024,
        },
      ]),
    };

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected veneer range error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toContain(
      "object-verifier:veneer-target-out-of-range:veneer:far:target:distance:134217728",
    );
  });

  test("rejects backend-owned veneer relocation metadata that targets the wrong symbol", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0x00, 0x00, 0x00, 0x14] })],
      symbols: [
        symbolForTest({ stableKey: "target", sectionKey: ".text" }),
        symbolForTest({ stableKey: "wrong", sectionKey: ".text" }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:veneer:bad",
          sectionKey: ".text",
          offsetBytes: 0,
          family: "branch26",
          targetSymbol: "wrong",
          bitRange: [0, 25],
        }),
      ],
      veneers: [veneerForTest({ stableKey: "veneer:bad", targetKey: "target" })],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "byte:veneer:bad",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
      ],
    });

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected veneer relocation error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:veneer-relocation-target-mismatch:veneer:bad:wrong:expected:target",
    ]);
  });

  test("requires byte provenance coverage for every emitted byte", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
    });
    const objectModule = {
      ...valid,
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "partial",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 3,
        }),
      ],
    };

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected provenance gap");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:byte-provenance-gap:.text:offset:3",
    ]);
  });

  test("rejects overlapping byte provenance records", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
    });
    const objectModule = {
      ...valid,
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "whole",
          sectionKey: ".text",
          startOffsetBytes: 0,
          byteLength: 4,
        }),
        byteProvenanceForTest({
          stableKey: "overlap",
          sectionKey: ".text",
          startOffsetBytes: 2,
          byteLength: 2,
        }),
      ],
    };

    const result = verifyAArch64ObjectModule({ objectModule });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected provenance overlap");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:byte-provenance-overlap:.text:offset:2",
    ]);
  });

  test("reports stale fact subjects and nondeterministic symbol order", () => {
    const valid = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
      symbols: [
        symbolForTest({ stableKey: "a", sectionKey: ".text" }),
        symbolForTest({ stableKey: "z", sectionKey: ".text" }),
      ],
    });
    const objectModule = { ...valid, symbols: [...valid.symbols].reverse() };

    const result = verifyAArch64ObjectModule({
      objectModule,
      staleFactSubjectKeys: ["deleted:fragment"],
    });

    expect(result.kind).toBe("error");
    if (result.kind !== "error") throw new Error("expected verifier errors");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:nondeterministic-symbol-order:z,a",
      "object-verifier:stale-fact-subject:deleted:fragment",
    ]);
  });
});
