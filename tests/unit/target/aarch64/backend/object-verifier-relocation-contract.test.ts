import { describe, expect, test } from "bun:test";

import { verifyAArch64ObjectModule } from "../../../../../src/target/aarch64/backend/verify/encoding-object-verifier";
import {
  aarch64ObjectModuleForTest,
  byteProvenanceForTest,
  relocationForTest,
  sectionForTest,
  symbolForTest,
} from "../../../../../tests/support/target/aarch64/backend/object-module-fixtures";

describe("AArch64 object verifier relocation contract", () => {
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

  test("rejects relocation patches in fragmentless executable sections", () => {
    const objectModule = aarch64ObjectModuleForTest({
      sections: [
        sectionForTest({
          stableKey: ".text",
          bytes: [0x00, 0x00, 0x00, 0x94],
          fragments: [],
        }),
      ],
      symbols: [symbolForTest({ stableKey: "target", sectionKey: ".text" })],
      relocations: [
        relocationForTest({
          stableKey: "reloc:fragmentless",
          sectionKey: ".text",
          offsetBytes: 0,
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
    if (result.kind !== "error") throw new Error("expected fragment ownership error");
    expect(result.diagnostics.map((diagnostic) => diagnostic.stableDetail)).toEqual([
      "object-verifier:relocation-patch-outside-fragment:reloc:fragmentless:.text:offset:0",
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
});
