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
      sections: [sectionForTest({ stableKey: ".empty", bytes: [] })],
      symbols: [],
      relocations: [],
    });

    expect(module.byteProvenance).toEqual([]);
  });

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
      expect.objectContaining({
        stableKey: "extern.helper",
        kind: "external-declaration",
        linkageName: "helper",
      }),
    ]);
    expect(module.symbols[0]).not.toHaveProperty("sectionKey");
    expect(module.symbols[0]).not.toHaveProperty("offsetBytes");
  });

  test("local definitions do not carry linkage names", () => {
    const module = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0, 0, 0, 0] })],
      symbols: [
        symbolForTest({
          stableKey: "label.local",
          kind: "local-definition",
          sectionKey: ".text",
          offsetBytes: 4,
        }),
      ],
    });

    expect(module.symbols).toEqual([
      expect.objectContaining({
        stableKey: "label.local",
        kind: "local-definition",
        sectionKey: ".text",
        offsetBytes: 4,
      }),
    ]);
    expect(module.symbols[0]).not.toHaveProperty("linkageName");
  });

  test("global definitions carry linkage names", () => {
    const module = aarch64ObjectModuleForTest({
      sections: [sectionForTest({ stableKey: ".text", bytes: [0, 0, 0, 0] })],
      symbols: [
        symbolForTest({
          stableKey: "fn.main",
          kind: "global-definition",
          linkageName: "main",
          sectionKey: ".text",
          offsetBytes: 0,
        }),
      ],
    });

    expect(module.symbols).toEqual([
      expect.objectContaining({
        stableKey: "fn.main",
        kind: "global-definition",
        linkageName: "main",
        sectionKey: ".text",
        offsetBytes: 0,
      }),
    ]);
  });

  test("rejects incomplete byte provenance coverage", () => {
    const section = aarch64ObjectSection({
      stableKey: "text",
      classKey: "executable-text",
      bytes: [0, 0, 0, 0],
      alignmentBytes: 1,
    });
    const relocation = aarch64ObjectRelocation({
      stableKey: "r0",
      sectionKey: "text",
      offsetBytes: 0,
      widthBytes: 4,
      family: "branch26",
      target: { kind: "linkage-name", linkageName: "symbol" },
      targetSymbol: "symbol",
      bitRange: [0, 25],
    });
    const symbol = aarch64ObjectSymbol({
      kind: "global-definition",
      stableKey: "s0",
      linkageName: "s0",
      sectionKey: "text",
      offsetBytes: 0,
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

  test("rejects duplicate byte provenance stable keys even when offsets differ", () => {
    expect(() =>
      aarch64ObjectModuleForTest({
        sections: [sectionForTest({ stableKey: "text", bytes: [0, 0, 0, 0] })],
        byteProvenance: [
          byteProvenanceForTest({
            stableKey: "bytes:duplicate",
            sectionKey: "text",
            startOffsetBytes: 0,
            byteLength: 2,
          }),
          byteProvenanceForTest({
            stableKey: "bytes:duplicate",
            sectionKey: "text",
            startOffsetBytes: 2,
            byteLength: 2,
          }),
        ],
      }),
    ).toThrow("Conflicting byte-provenance stable key: bytes:duplicate.");
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

  test("preserves structured relocation addends and pair partners", () => {
    const module = aarch64ObjectModuleForTest({
      sections: [sectionForTest("text.a")],
      symbols: [
        symbolForTest({ stableKey: "target", kind: "local-definition", sectionKey: "text.a" }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:page",
          family: "pagebase-rel21",
          target: { kind: "symbol-stable-key", stableKey: "target" },
          targetSymbol: "target",
          addend: 16n,
          bitRange: [5, 30],
          pairedRelocationKey: "reloc:low12",
        }),
        relocationForTest({
          stableKey: "reloc:low12",
          family: "pageoffset-12a",
          target: { kind: "symbol-stable-key", stableKey: "target" },
          targetSymbol: "target",
          addend: 16n,
          bitRange: [10, 21],
          pairedRelocationKey: "reloc:page",
        }),
      ],
    });

    expect(module.relocations.map((relocation) => relocation.addend)).toEqual([16n, 16n]);
    expect(module.relocations.map((relocation) => String(relocation.pairedRelocationKey))).toEqual([
      "reloc:page",
      "reloc:low12",
    ]);
  });

  test("rejects conflicting structured relocation target and compatibility targetSymbol", () => {
    expect(() =>
      aarch64ObjectModuleForTest({
        sections: [sectionForTest("text.a")],
        symbols: [
          symbolForTest({
            stableKey: "target",
            kind: "local-definition",
            sectionKey: "text.a",
          }),
        ],
        relocations: [
          relocationForTest({
            stableKey: "reloc:conflict",
            target: { kind: "linkage-name", linkageName: "other.target" },
            targetSymbol: "target",
          }),
        ],
      }),
    ).toThrow("Relocation target conflicts with targetSymbol: target.");
  });

  test("classifies compatibility local target symbols by stable key across object sections", () => {
    const module = aarch64ObjectModuleForTest({
      sections: [sectionForTest("text.a"), sectionForTest("data.a")],
      symbols: [
        symbolForTest({
          stableKey: "local.data",
          kind: "local-definition",
          sectionKey: "data.a",
        }),
      ],
      relocations: [
        relocationForTest({
          stableKey: "reloc:local-data",
          sectionKey: "text.a",
          targetSymbol: "local.data",
        }),
      ],
    });

    expect(module.relocations[0]?.target).toEqual({
      kind: "symbol-stable-key",
      stableKey: "local.data",
    });
  });

  test("rejects non-bigint relocation addends", () => {
    expect(() =>
      aarch64ObjectRelocation({
        stableKey: "reloc:bad-addend",
        sectionKey: "text",
        offsetBytes: 0,
        widthBytes: 4,
        family: "branch26",
        target: { kind: "linkage-name", linkageName: "target" },
        addend: 1 as unknown as bigint,
        bitRange: [0, 25],
      }),
    ).toThrow("relocation addend must be a bigint.");
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

  test("requires non-empty trimmed section class keys", () => {
    expect(() =>
      aarch64ObjectSection({
        stableKey: "text",
        classKey: "",
        bytes: [0, 0, 0, 0],
      }),
    ).toThrow("AArch64ObjectSectionClassKey stable key must be non-empty and trimmed.");

    expect(() =>
      aarch64ObjectSection({
        stableKey: "text",
        classKey: " executable-text",
        bytes: [0, 0, 0, 0],
      }),
    ).toThrow("AArch64ObjectSectionClassKey stable key must be non-empty and trimmed.");
  });

  test("includes section class keys in deterministic fingerprints", () => {
    const text = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".same",
          classKey: "executable-text",
          bytes: [0, 0, 0, 0],
        }),
      ],
    });
    const data = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".same",
          classKey: "writable-data",
          bytes: [0, 0, 0, 0],
        }),
      ],
    });

    expect(String(text.sections[0]!.classKey)).toBe("executable-text");
    expect(String(data.sections[0]!.classKey)).toBe("writable-data");
    expect(text.deterministicMetadata.sectionFingerprint).not.toBe(
      data.deterministicMetadata.sectionFingerprint,
    );
    expect(text.deterministicMetadata.moduleFingerprint).not.toBe(
      data.deterministicMetadata.moduleFingerprint,
    );
  });
});
