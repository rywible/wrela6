import { describe, expect, test } from "bun:test";

import {
  aarch64ObjectModule,
  aarch64ObjectSection,
  aarch64ObjectRelocation,
  aarch64ObjectSymbol,
} from "../../../../../src/target/aarch64/backend/object/object-module";
import {
  byteProvenanceForTest,
  relocationForTest,
  sectionForTest,
  symbolForTest,
  aarch64ObjectModuleForTest,
} from "../../../../../tests/support/target/aarch64/backend/object-module-fixtures";

describe("AArch64 backend object module", () => {
  test("sorts sections, symbols, and relocations by stable key", () => {
    const module = aarch64ObjectModuleForTest({
      sections: [sectionForTest("text.z"), sectionForTest("text.a"), sectionForTest("text.m")],
      symbols: [symbolForTest("z_symbol"), symbolForTest("a_symbol")],
      relocations: [relocationForTest("reloc.z"), relocationForTest("reloc.a")],
    });

    expect(module.sections.map((section) => String(section.stableKey))).toEqual([
      "text.a",
      "text.m",
      "text.z",
    ]);
    expect(module.symbols.map((symbol) => String(symbol.stableKey))).toEqual([
      "a_symbol",
      "z_symbol",
    ]);
    expect(module.relocations.map((relocation) => String(relocation.stableKey))).toEqual([
      "reloc.a",
      "reloc.z",
    ]);
  });

  test("rejects duplicate stable keys in core repeated collections", () => {
    expect(() =>
      aarch64ObjectModuleForTest({
        sections: [sectionForTest("dup"), sectionForTest("dup")],
      }),
    ).toThrow("Conflicting section stable key: dup.");
  });

  test("generates full byte provenance coverage when omitted", () => {
    const module = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: "code", bytes: [1, 2, 3, 4] })],
      symbols: [],
      relocations: [],
    });

    expect(module.byteProvenance).toHaveLength(1);
    expect(module.byteProvenance[0]!.stableKey).toBe("coverage:code");
    expect(String(module.byteProvenance[0]!.sectionKey)).toBe("code");
    expect(module.byteProvenance[0]!.startOffsetBytes).toBe(0);
    expect(module.byteProvenance[0]!.byteLength).toBe(4);
  });

  test("does not synthesize zero-length provenance for empty sections", () => {
    const module = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".extern", bytes: [] })],
      symbols: [],
      relocations: [],
    });

    expect(module.byteProvenance).toEqual([]);
  });

  test("rejects incomplete byte provenance coverage", () => {
    const section = aarch64ObjectSection({
      stableKey: "text",
      bytes: [0, 0, 0, 0],
      alignmentBytes: 1,
    });
    const relocation = aarch64ObjectRelocation({
      stableKey: "r0",
      sectionKey: "text",
      offsetBytes: 0,
      widthBytes: 4,
      family: "branch26",
      targetSymbol: "symbol",
    });
    const symbol = aarch64ObjectSymbol({
      stableKey: "s0",
      sectionKey: "text",
      offsetBytes: 0,
      isGlobal: true,
    });

    expect(() =>
      aarch64ObjectModule({
        targetBackendSurfaceFingerprint: "backend-target-fingerprint",
        closedImagePlanFingerprint: "closed-image-fingerprint",
        sections: [section],
        symbols: [symbol],
        relocations: [relocation],
        byteProvenance: [
          byteProvenanceForTest({ stableKey: "partial", sectionKey: "text", byteLength: 1 }),
        ],
      }),
    ).toThrow("Byte provenance");
  });

  test("keeps records deeply frozen and metadata stable and deterministic", () => {
    const module = aarch64ObjectModuleForTest({
      sections: [sectionForTest("text.b"), sectionForTest("text.a")],
      symbols: [symbolForTest("z"), symbolForTest("a")],
      relocations: [relocationForTest("r2"), relocationForTest("r1")],
    });

    expect(Object.isFrozen(module)).toBe(true);
    expect(Object.isFrozen(module.sections)).toBe(true);
    expect(Object.isFrozen(module.deterministicMetadata)).toBe(true);
    expect(Object.isFrozen(module.deterministicMetadata.recordCounts)).toBe(true);
    expect(Object.keys(module.deterministicMetadata)).toEqual([
      "schema",
      "schemaVersion",
      "sectionFingerprint",
      "symbolFingerprint",
      "relocationFingerprint",
      "literalPoolFingerprint",
      "byteProvenanceFingerprint",
      "recordCounts",
      "moduleFingerprint",
    ]);
    expect(module.deterministicMetadata).toMatchObject({
      schema: "aarch64-object-module",
      schemaVersion: "1",
    });
  });

  test("module fingerprints include emitted bytes and record payloads", () => {
    const first = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xe0, 0x00, 0x80, 0xd2] })],
    });
    const second = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0xc0, 0x03, 0x5f, 0xd6] })],
    });

    expect(first.deterministicMetadata.sectionFingerprint).not.toBe(
      second.deterministicMetadata.sectionFingerprint,
    );
    expect(first.deterministicMetadata.moduleFingerprint).not.toBe(
      second.deterministicMetadata.moduleFingerprint,
    );
  });
});
