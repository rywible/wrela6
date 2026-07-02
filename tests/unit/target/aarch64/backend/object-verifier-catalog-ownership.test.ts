import { describe, expect, test } from "bun:test";

import { AARCH64_OBJECT_SECTION_CLASS_WRITABLE_DATA } from "../../../../../src/target/aarch64/backend/object/object-module";
import { RPI5_KNOWN_BYTE_FIXTURES } from "../../../../../src/target/aarch64/backend/catalogs/known-byte-fixtures";
import { verifyAArch64ObjectModule } from "../../../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import {
  aarch64ObjectModuleForTest,
  byteProvenanceForTest,
  literalPoolForTest,
  relocationForTest,
  sectionForTest,
  symbolForTest,
} from "../../../../../tests/support/target/aarch64/backend/object-module-fixtures";

describe("AArch64 object verifier catalog ownership", () => {
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

  test("does not decode writable data sections as instructions or relocation owners", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".data",
          classKey: AARCH64_OBJECT_SECTION_CLASS_WRITABLE_DATA,
          bytes: [0xff, 0xff, 0xff, 0xff, 0xc0, 0x03, 0x5f, 0xd6],
        }),
      ],
      symbols: [symbolForTest({ stableKey: "target", sectionKey: ".data" })],
      relocations: [
        relocationForTest({
          stableKey: "reloc:absolute",
          sectionKey: ".data",
          offsetBytes: 0,
          widthBytes: 8,
          family: "addr64",
          targetSymbol: "target",
        }),
      ],
      byteProvenance: [
        byteProvenanceForTest({
          stableKey: "bytes",
          sectionKey: ".data",
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
});
